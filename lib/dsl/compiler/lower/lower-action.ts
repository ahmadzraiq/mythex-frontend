/**
 * lower-action.ts — Scope-aware workflow/action statement lowering.
 *
 * Replaces rewriteBodyForRunJs for the workflow/onClick action path.
 * Handles:
 *   - Variable assignments: myVar = value  →  variables['uuid'] = value
 *   - navigate(path)  →  await wwLib.navigate.to(path)
 *   - workflowCall(args)  →  await wwLib.runStep({ type: 'runProjectWorkflow', ... })
 *   - if / block / multi-statement
 *   - Map param / index resolution (same rules as lowerExpression)
 *
 * Like lowerExpression, uses path.scope.getBinding() to skip locally-bound names.
 */

import traverse from '@babel/traverse'
import * as t from '@babel/types'
import { parseExpr, parseStmts, parseFile, print, printExpr } from './parse'
import type { LoweringEnv } from './env'
import { lowerError, isUnsupported } from './subset'
import { lowerExpression } from './lower-expression'

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Lower a workflow action body (arrow function or block body) to the
 * SDUI `runJavaScript` code string.
 *
 * @param code       Raw JS/TS code (body of an arrow function or function).
 * @param env        Lowering environment.
 * @param sourceFile File path for error reporting.
 */
export function lowerAction(code: string, env: LoweringEnv, sourceFile = '<dsl>'): string {
  // Strip outer braces if the code is already a block body `{ ... }`
  const trimmed = code.trim()
  const unwrapped = trimmed.startsWith('{') && trimmed.endsWith('}')
    ? trimmed.slice(1, -1).trim()
    : trimmed

  let stmts: t.Statement[]
  try {
    stmts = parseStmts(unwrapped)
  } catch {
    // Parse failed — fall back to raw code (safe: golden tests will catch regression)
    return code
  }

  // Wrap in a synthetic module file so traverse can build scope info
  let file: t.File
  try {
    file = parseFile(unwrapped)
  } catch {
    return code
  }

  // Collect locally-bound names within the action body so we don't rewrite them
  const locallyBound = new Set<string>()
  collectActionLocalBindings(file, locallyBound)

  try {
    rewriteActionIdentifiers(file, env, locallyBound, sourceFile)
  } catch (e) {
    if ((e as any)?.name === 'LowerError') throw e
    return code
  }

  // Serialise the rewritten statements
  const parts: string[] = []
  for (const stmt of file.program.body) {
    parts.push(print(stmt))
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Statement / expression rewriting
// ---------------------------------------------------------------------------

function rewriteActionIdentifiers(
  file: t.File,
  env: LoweringEnv,
  locallyBound: Set<string>,
  sourceFile: string,
): void {
  // Build var/workflow maps for fast lookup
  const varMap = buildVarMap(env)
  const wfMap = buildWfMap(env)

  traverse(file, {
    // ── Assignment: myVar = expr ───────────────────────────────────────────
    AssignmentExpression(path) {
      const { left, right, operator } = path.node
      if (operator === '=' && t.isIdentifier(left)) {
        const name = left.name
        if (locallyBound.has(name)) return
        if (path.scope.getBinding(name)) return
        const uuid = varMap.get(name)
        if (uuid) {
          // Rewrite rhs first (the visitor will recurse into it separately
          // so we just need to fix the lhs)
          path.node.left = t.memberExpression(
            t.identifier('variables'),
            t.stringLiteral(uuid),
            true, // computed
          )
        }
      }
    },

    // ── Call expression: navigate / workflow / local fn ───────────────────
    CallExpression(path) {
      const callee = path.node.callee
      if (!t.isIdentifier(callee)) return
      const name = callee.name

      // Skip locally-bound names
      if (locallyBound.has(name)) return
      if (path.scope.getBinding(name)) return

      // navigate(path) → await wwLib.navigate.to(path)
      if (name === 'navigate' && path.node.arguments.length >= 1) {
        // Build: await wwLib.navigate.to(arg)
        const navigateCall = t.callExpression(
          t.memberExpression(
            t.memberExpression(t.identifier('wwLib'), t.identifier('navigate')),
            t.identifier('to'),
          ),
          path.node.arguments as t.Expression[],
        )
        path.replaceWith(t.awaitExpression(navigateCall))
        path.skip()
        return
      }

      // Workflow call: wfName(args) → await wwLib.runStep(...)
      // Heuristic: any identifier used as a call target that maps to a UUID is treated
      // as a workflow call (matching the original rewriteBodyForRunJs logic).
      const wfUuid = wfMap.get(name) ?? env.pathToId.get(name)
      if (wfUuid && wfUuid !== name) {
        const paramsCode = buildRunStepParamsCode(path.node.arguments as t.Expression[], wfUuid, env, sourceFile)
        // Build: await wwLib.runStep({ type: 'runProjectWorkflow', config: { workflowId: '...', params?: ... } })
        const configProps: t.ObjectProperty[] = [
          t.objectProperty(t.identifier('workflowId'), t.stringLiteral(wfUuid)),
        ]
        if (paramsCode) {
          try {
            const paramsExpr = parseExpr(`(${paramsCode})`)
            configProps.push(t.objectProperty(t.identifier('params'), paramsExpr))
          } catch { /* skip */ }
        }
        const runStepCall = t.callExpression(
          t.memberExpression(t.identifier('wwLib'), t.identifier('runStep')),
          [t.objectExpression([
            t.objectProperty(t.identifier('type'), t.stringLiteral('runProjectWorkflow')),
            t.objectProperty(t.identifier('config'), t.objectExpression(configProps)),
          ])],
        )
        path.replaceWith(t.awaitExpression(runStepCall))
        path.skip()
        return
      }
    },

    // ── Identifier: variable reference ────────────────────────────────────
    Identifier(path) {
      const name = path.node.name

      // Skip non-reference positions (same as lowerExpression)
      if (path.parentPath?.isObjectProperty() && path.key === 'key' && !path.parentPath.node.computed) return
      if (path.parentPath?.isMemberExpression() && path.key === 'property' && !path.parentPath.node.computed) return
      if (path.parentPath?.isOptionalMemberExpression() && path.key === 'property') return
      if (path.parentPath?.isLabeledStatement() && path.key === 'label') return
      // Skip the lhs of an assignment that was already handled above
      if (path.parentPath?.isAssignmentExpression() && path.key === 'left') return
      // Skip call targets — handled by CallExpression visitor
      if (path.parentPath?.isCallExpression() && path.key === 'callee') return

      if (locallyBound.has(name)) return
      if (path.scope.getBinding(name)) return

      // Unsupported node check
      if (path.parentPath && isUnsupported(path.parentPath.node)) {
        lowerError(path.parentPath.node, sourceFile)
      }

      // Map param / index resolution
      const mapResult = tryRewriteMapParamAction(name, path, env)
      if (mapResult !== null) {
        path.replaceWithSourceString(mapResult)
        path.skip()
        return
      }

      // Event param
      if (env.eventParam && name === env.eventParam) {
        path.replaceWithSourceString('context.event')
        path.skip()
        return
      }

      // Variable UUID
      const uuid = varMap.get(name)
      if (uuid) {
        path.replaceWithSourceString(`variables['${uuid}']`)
        path.skip()
        return
      }
    },

    // Event param.value → context.event?.value
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
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildVarMap(env: LoweringEnv): Map<string, string> {
  const m = new Map<string, string>()
  for (const [key, uuid] of env.pathToId) {
    if (!key.includes('/') && key !== uuid) m.set(key, uuid)
  }
  return m
}

function buildWfMap(env: LoweringEnv): Map<string, string> {
  const m = new Map<string, string>()
  for (const [key, uuid] of env.pathToId) {
    if (key.startsWith('workflows/')) {
      m.set(key.slice('workflows/'.length), uuid)
    }
  }
  return m
}

function tryRewriteMapParamAction(name: string, path: any, env: LoweringEnv): string | null {
  const stack = env.mapStack
  if (stack.length === 0) return null
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]
    const depth = stack.length - 1 - i
    const parentChain = '.parent'.repeat(depth)
    const base = `context.item${parentChain}`
    if (frame.itemParam && name === frame.itemParam) return `${base}.data`
    if (frame.indexParam && name === frame.indexParam) return `${base}.index`
  }
  return null
}

function collectActionLocalBindings(file: t.File, out: Set<string>): void {
  traverse(file, {
    ArrowFunctionExpression(path) {
      for (const p of path.node.params) collectPatternNames(p, out)
    },
    FunctionExpression(path) {
      for (const p of path.node.params) collectPatternNames(p, out)
    },
    FunctionDeclaration(path) {
      if (path.node.id) out.add(path.node.id.name)
      for (const p of path.node.params) collectPatternNames(p, out)
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
      if (t.isRestElement(prop)) collectPatternNames(prop.argument, out)
      else if (t.isObjectProperty(prop)) collectPatternNames(prop.value as t.LVal, out)
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

/**
 * Build the `params: { ... }` object code for a workflow call.
 * Returns empty string if the workflow has no parameters.
 */
function buildRunStepParamsCode(
  args: t.Expression[],
  _wfUuid: string,
  env: LoweringEnv,
  sourceFile: string,
): string {
  if (args.length === 0) return ''
  // If there's exactly one arg and it's an object literal, use it directly
  if (args.length === 1 && t.isObjectExpression(args[0])) {
    return printExpr(args[0])
  }
  // Otherwise build a positional params object: { arg0: v0, arg1: v1, ... }
  const pairs = args.map((arg, i) => {
    const val = printExpr(arg)
    return `arg${i}: ${val}`
  })
  return `{ ${pairs.join(', ')} }`
}
