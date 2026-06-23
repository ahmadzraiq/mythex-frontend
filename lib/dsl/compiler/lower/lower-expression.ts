/**
 * lower-expression.ts — Scope-aware formula/condition/prop lowering.
 *
 * Replaces resolveExprToSdui + rewriteMapParam + inlineLocalFnCalls +
 * replaceIdentInCode for the formula/binding path.
 *
 * Single @babel/traverse pass over the expression AST:
 *   - Uses path.scope.getBinding() so locally-bound names (arrow params,
 *     inner let/const) are NEVER rewritten — fixes the shadowing bug.
 *   - Map param/index resolved via mapStack (depth = stack.length - 1 - frameIdx).
 *   - Variable refs → variables['uuid'].
 *   - Component prop refs → context.component?.props?.['name'].
 *   - Event param.value → context.event?.value.
 *   - Local const refs → collected for IIFE preamble.
 *   - Local fn calls → inlined as IIFEs.
 */

import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { parseExpr, parseFile, print, printExpr } from './parse'
import type { LoweringEnv, MapFrame } from './env'
import { mapDepth } from './env'
import { lowerError, isUnsupported } from './subset'

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Lower a JS expression string to SDUI formula format.
 *
 * @param code       Raw JS expression text (as extracted from the TSX AST).
 * @param env        Lowering environment (vars, maps, locals, etc.)
 * @param sourceFile File path for error reporting.
 */
export function lowerExpression(code: string, env: LoweringEnv, sourceFile = '<dsl>'): string {
  // ── Fast path: pure string (no interpolations) or numeric literal ─────────
  const trimmed = code.trim()
  // Only short-circuit for single/double quoted strings (no ${...} template literals)
  // and plain numbers. Template literals may contain expressions that need rewriting.
  if (/^(['"])(?:[^'"\\]|\\.)*\1$/.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return code
  }

  // ── Parse the expression ──────────────────────────────────────────────────
  let expr: t.Expression
  try {
    expr = parseExpr(code)
  } catch {
    // If Babel can't parse it, fall back to the expression as-is.
    // The golden harness will catch any semantic regression.
    return code
  }

  // Wrap in a tiny "file" so @babel/traverse can build scope info
  const wrappedCode = `(${code})`
  let file: t.File
  try {
    file = parseFile(wrappedCode)
  } catch {
    return code
  }

  // Collect identifiers that are locally bound WITHIN the expression
  // (arrow function params, destructuring, etc.) so we never rewrite them.
  const locallyBound = new Set<string>()
  collectLocalBindings(file, locallyBound)

  // ── Rewrite identifiers ───────────────────────────────────────────────────
  // Track which page-locals are needed for the const-preamble
  const neededLocals = new Set<string>()

  try {
    rewriteIdentifiers(file, env, locallyBound, neededLocals, sourceFile)
  } catch (e) {
    if ((e as any)?.name === 'LowerError') throw e
    // Non-fatal parse/traverse error — return original
    return code
  }

  // ── Extract the rewritten expression from the file ────────────────────────
  const stmt = file.program.body[0]
  if (!stmt || stmt.type !== 'ExpressionStatement') return code
  let rewrittenExpr = (stmt as t.ExpressionStatement).expression
  if (rewrittenExpr.type === 'ParenthesizedExpression') {
    rewrittenExpr = (rewrittenExpr as t.ParenthesizedExpression).expression
  }

  let result = printExpr(rewrittenExpr)

  // ── Const-preamble IIFE ───────────────────────────────────────────────────
  if (neededLocals.size > 0) {
    result = buildPreambleIife(result, neededLocals, env, sourceFile)
  }

  return result
}

// ---------------------------------------------------------------------------
// Identifier rewriting via traverse
// ---------------------------------------------------------------------------

function rewriteIdentifiers(
  file: t.File,
  env: LoweringEnv,
  locallyBound: Set<string>,
  neededLocals: Set<string>,
  sourceFile: string,
): void {
  traverse(file, {
    Identifier(path) {
      const name = path.node.name

      // ── Skip non-reference positions ──────────────────────────────────────
      // Object property keys: { foo: ... } — `foo` is not a reference
      if (path.parentPath?.isObjectProperty() && path.key === 'key' && !path.parentPath.node.computed) return
      // Member expression non-computed property: obj.foo — `foo` is not a ref
      if (path.parentPath?.isMemberExpression() && path.key === 'property' && !path.parentPath.node.computed) return
      if (path.parentPath?.isOptionalMemberExpression() && path.key === 'property') return
      // Label identifiers
      if (path.parentPath?.isLabeledStatement() && path.key === 'label') return
      // Import specifiers
      if (path.parentPath?.isImportSpecifier() || path.parentPath?.isImportDefaultSpecifier()) return

      // ── Skip locally-bound names (arrow params, let/const in block) ───────
      // This is the key fix: if the binding of this identifier is INSIDE
      // the expression tree, don't rewrite it.
      if (locallyBound.has(name)) return

      // Also check Babel's scope — if the binding is within the current
      // traversal scope (not at module level), don't rewrite.
      const binding = path.scope.getBinding(name)
      if (binding) {
        // The binding exists in a local scope — don't touch it
        return
      }

      // ── Check for unsupported construct on parent ─────────────────────────
      if (path.parentPath && isUnsupported(path.parentPath.node)) {
        lowerError(path.parentPath.node, sourceFile)
      }

      // ── Map parameter rewriting ───────────────────────────────────────────
      const mapResult = tryRewriteMapParam(name, path, env)
      if (mapResult !== null) {
        path.replaceWithSourceString(mapResult)
        path.skip()
        return
      }

      // ── Component prop rewriting ──────────────────────────────────────────
      if (env.componentProps.includes(name)) {
        path.replaceWithSourceString(`context.component?.props?.['${name}']`)
        path.skip()
        return
      }

      // ── Event param rewriting ─────────────────────────────────────────────
      if (env.eventParam && name === env.eventParam) {
        // event.value → handled via MemberExpression visitor below; bare `e` → context.event
        path.replaceWithSourceString('context.event')
        path.skip()
        return
      }

      // ── Map callback locals (e.g. `status`, `iconColor` inside .map() block) ──
      // These are simple computed consts declared in the map block body; they
      // must be inlined as their value expression (with the map param already rewritten
      // by the traversal since we do NOT skip after replacement).
      // Check BEFORE page-locals so inner-scope locals shadow outer ones.
      // Only inline in non-call-target position (calls are handled by CallExpression visitor).
      if (!path.parentPath?.isCallExpression() || path.key !== 'callee') {
        const mapLocal = findMapLocal(name, env)
        if (mapLocal !== null) {
          // Inline the raw expression. Do NOT skip — traversal rewrites var/param refs inside.
          path.replaceWithSourceString(mapLocal)
          return
        }
      }

      // ── Page-local const / fn ─────────────────────────────────────────────
      if (env.pageLocals.has(name)) {
        neededLocals.add(name)
        collectTransitiveDeps(name, env, neededLocals)
        // Leave the identifier as-is — it will be declared in the preamble
        return
      }
      if (env.localFns.has(name)) {
        // Zero-arg local fn: referenced bare (no call parens) → inline IIFE.
        // Do NOT skip — traversal must continue into the inlined body to rewrite
        // any variable/map-param references inside the function body.
        const iife = env.localFns.get(name)!
        path.replaceWithSourceString(iife)
        return
      }
      if (env.localParamFns.has(name)) {
        // Parameterised fn: will be handled by CallExpression visitor
        return
      }

      // ── Variable UUID rewriting ───────────────────────────────────────────
      const uuid = resolveVar(name, env)
      if (uuid) {
        path.replaceWithSourceString(`variables['${uuid}']`)
        path.skip()
        return
      }
    },

    // Handle member access rewrites
    MemberExpression(path) {
      const obj = path.node.object

      // vars['store/x'] → variables['uuid'] (legacy VFS variable syntax)
      if (t.isIdentifier(obj) && obj.name === 'vars' && path.node.computed && !path.scope.getBinding('vars')) {
        const prop = path.node.property
        if (t.isStringLiteral(prop)) {
          const key = prop.value
          const uuid = env.pathToId.get(key) ?? env.pathToId.get(`store/${key}`)
          path.replaceWithSourceString(`variables[${JSON.stringify(uuid ?? key)}]`)
          path.skip()
          return
        }
      }

      // Event param member access: e.value → context.event?.value
      if (!env.eventParam) return
      if (t.isIdentifier(obj) && obj.name === env.eventParam && !path.scope.getBinding(env.eventParam)) {
        const prop = path.node.property
        if (t.isIdentifier(prop) && prop.name === 'value') {
          path.replaceWithSourceString('context.event?.value')
          path.skip()
        }
      }
    },

    // Handle parameterised local fn calls: fn(a,b) → ((p,q)=>body)(a,b)
    CallExpression(path) {
      const callee = path.node.callee
      if (!t.isIdentifier(callee)) return
      const name = callee.name
      if (path.scope.getBinding(name)) return // locally bound — skip
      if (env.localParamFns.has(name)) {
        const fnText = env.localParamFns.get(name)!
        // Replace callee identifier with the inlined function text so
        // fn(a, b) → ((p1,p2) => body)(a, b).
        // Do NOT skip — traversal must continue into body to rewrite var refs.
        try {
          const fnExpr = parseExpr(fnText)
          path.node.callee = t.parenthesizedExpression(fnExpr)
        } catch {
          // parse failed — leave as-is
        }
      } else if (env.localFns.has(name)) {
        // Zero-arg fn called as fn() → inline the IIFE.
        // Do NOT skip — traversal must continue into body to rewrite var refs.
        const iife = env.localFns.get(name)!
        path.replaceWithSourceString(`(${iife})`)
      } else {
        // Check map callback locals (e.g. `isOpen` defined inside a .map() block body).
        // Search from innermost frame outward; inline as IIFE.
        const mapLocal = findMapLocal(name, env)
        if (mapLocal !== null) {
          const args = path.node.arguments
          try {
            const localExpr = parseExpr(mapLocal)
            if (args.length === 0) {
              path.replaceWith(
                t.callExpression(t.parenthesizedExpression(localExpr), []),
              )
            } else {
              path.node.callee = t.parenthesizedExpression(localExpr)
            }
          } catch {
            // parse failed — leave as-is
          }
        }
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Map callback locals lookup
// ---------------------------------------------------------------------------

/**
 * Search for `name` in the map callback locals (all frames, innermost first).
 * Returns the raw initialiser expression text (e.g. `() => openIndex === i`)
 * or null if not found.
 */
function findMapLocal(name: string, env: LoweringEnv): string | null {
  const stack = env.mapStack
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].locals.has(name)) {
      return stack[i].locals.get(name)!
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Map param resolution
// ---------------------------------------------------------------------------

/**
 * Try to rewrite `name` as a map context reference.
 * Returns the replacement string or null if `name` is not a map param.
 *
 * The mapStack is ordered outermost-first: stack[0] = outermost.
 * For the INNERMOST (current) map, the identifier maps to:
 *   itemParam  → context.item.data
 *   indexParam → context.item.index
 * For ONE level up (stack[len-2]):
 *   itemParam  → context.item.parent.data
 *   indexParam → context.item.parent.index
 * For TWO levels up (stack[len-3]):
 *   itemParam  → context.item.parent.parent.data
 *   indexParam → context.item.parent.parent.index
 * etc.
 */
function tryRewriteMapParam(name: string, path: any, env: LoweringEnv): string | null {
  const stack = env.mapStack
  if (stack.length === 0) return null

  // Check from innermost to outermost
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]
    const depth = stack.length - 1 - i  // 0 for innermost, 1 for parent, etc.
    const parentChain = '.parent'.repeat(depth)
    const base = `context.item${parentChain}`

    if (frame.itemParam && name === frame.itemParam) {
      // Check if it's a property access: name.field → base.data.field
      // The MemberExpression visitor handles the full path; here we just
      // handle the bare identifier case.
      return `${base}.data`
    }
    if (frame.indexParam && name === frame.indexParam) {
      return `${base}.index`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Local binding collection
// ---------------------------------------------------------------------------

/**
 * Walk the AST and collect all parameter/binding names that are
 * LOCALLY introduced within the expression (arrow params, destructuring, etc.).
 * These must NOT be rewritten even if they shadow a page variable.
 */
function collectLocalBindings(file: t.File, out: Set<string>): void {
  traverse(file, {
    ArrowFunctionExpression(path) {
      for (const param of path.node.params) {
        collectPatternNames(param, out)
      }
    },
    FunctionExpression(path) {
      for (const param of path.node.params) {
        collectPatternNames(param, out)
      }
    },
    VariableDeclarator(path) {
      collectPatternNames(path.node.id, out)
    },
    CatchClause(path) {
      if (path.node.param) collectPatternNames(path.node.param, out)
    },
  })
}

function collectPatternNames(node: t.LVal | t.PatternLike | t.Expression, out: Set<string>): void {
  if (t.isIdentifier(node)) {
    out.add(node.name)
  } else if (t.isObjectPattern(node)) {
    for (const prop of node.properties) {
      if (t.isRestElement(prop)) {
        collectPatternNames(prop.argument, out)
      } else if (t.isObjectProperty(prop)) {
        collectPatternNames(prop.value as t.LVal, out)
      }
    }
  } else if (t.isArrayPattern(node)) {
    for (const el of node.elements) {
      if (el) collectPatternNames(el, out)
    }
  } else if (t.isRestElement(node)) {
    collectPatternNames(node.argument, out)
  } else if (t.isAssignmentPattern(node)) {
    collectPatternNames(node.left, out)
  }
}

// ---------------------------------------------------------------------------
// Variable resolution
// ---------------------------------------------------------------------------

function resolveVar(name: string, env: LoweringEnv): string | undefined {
  for (const [key, uuid] of env.pathToId) {
    if (key === name && key !== uuid && !key.includes('/')) return uuid
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Const-preamble IIFE
// ---------------------------------------------------------------------------

/**
 * Build `((() => { const a = ...; const b = ...; return (expr); })())`
 * for all page-locals needed in the expression.
 * The preamble consts are emitted in declaration order, with UUIDs resolved.
 */
function buildPreambleIife(
  expr: string,
  neededLocals: Set<string>,
  env: LoweringEnv,
  sourceFile: string,
): string {
  const preamble: string[] = []
  for (const [name, rawValue] of env.pageLocals) {
    if (!neededLocals.has(name)) continue
    // Resolve the preamble value itself through the lowerer
    // (so bare var names inside the local value also become variables['uuid'])
    let resolvedValue: string
    try {
      // Use a shallow env (no mapStack, no locals) to avoid infinite recursion
      const shallowEnv: LoweringEnv = {
        ...env,
        pageLocals: new Map(), // prevent recursion
        localFns: new Map(),
        localParamFns: new Map(),
        mapStack: [],
      }
      resolvedValue = lowerExpression(rawValue, shallowEnv, sourceFile)
    } catch {
      resolvedValue = rawValue
    }
    preamble.push(`const ${name} = ${resolvedValue}`)
  }
  if (preamble.length === 0) return expr
  return `((() => { ${preamble.join('; ')}; return (${expr}); })())`
}

/**
 * Transitively collect dependencies of a page-local const.
 * e.g. if `filtered` uses `recipes`, add `recipes` to neededLocals too.
 */
function collectTransitiveDeps(
  name: string,
  env: LoweringEnv,
  neededLocals: Set<string>,
): void {
  const value = env.pageLocals.get(name)
  if (!value) return
  for (const [depName] of env.pageLocals) {
    if (!neededLocals.has(depName)) {
      // Check if depName appears in value
      const depRe = new RegExp(`(?<![.'"\`\\w])\\b${depName}\\b`)
      if (depRe.test(value)) {
        neededLocals.add(depName)
        collectTransitiveDeps(depName, env, neededLocals)
      }
    }
  }
}
