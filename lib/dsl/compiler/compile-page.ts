/**
 * Compiles definePage() JSX to config/screens/<PageName>.json.
 *
 * JSX → SDUI transformation rules:
 *   tw="flex gap-3"             → props.className = "flex gap-3"
 *   tw={expr}                   → props.classFormulas = { js: expr }
 *   style={{ k: expr }}         → props.style.k = { js: expr } OR k: literal
 *   laptop/tablet/mobile={{}}   → responsive.laptop/tablet/mobile
 *   animation={{ name, ... }}   → props.animation
 *   condition={expr}            → node.condition = expr
 *   key={expr}                  → node.key = expr
 *   onClick={workflow(...)}     → node.actions = [{ trigger: 'click', steps: [executeWorkflow(uuid)] }]
 *   arr.map(x => <Box>)         → node.map + node.key on child
 *   {condition && <Box>}        → Box gets condition: "condition"
 *   <Text>{vars['store/x']}</Text>  → text: { js: "variables['uuid']" }
 *   <Text>static string</Text>  → text: "static string"
 *   <Text>{expr}</Text>         → text: { js: "resolvedExpr" }
 */

import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import crypto from 'crypto'
import {
  buildVfsRegistry,
  getOrCreateUuid,
  loadDslRegistry,
  saveDslRegistry,
  type VfsRegistry,
} from './resolve-vfs'
import { lowerExpression, lowerAction as lowerActionBabel, makeEnv } from './lower/index'

import {
  resolveStyleParams,
  SHORTHAND_KEYS,
  SHORTHAND_FORMULA_CSS_MAP,
  SHORTHAND_FORMULA_CLASS_MAP,
  styleKeyToCssProps,
  RESPONSIVE_BPS,
  DSL_BP_TO_INTERNAL,
  type BreakpointKey,
} from './resolve-style'
import sharedComponentsJson from '@/config/shared-components.json'

// ─── Shared component registry (name → model) ─────────────────────────────────

/** Map from SC display name (case-insensitive) → model entry for fast lookup. */
const _scByName: Map<string, { id: string; name: string; content: Record<string, unknown> }> = new Map()
for (const [id, raw] of Object.entries(sharedComponentsJson as Record<string, Record<string, unknown>>)) {
  const name = String(raw.name ?? '')
  if (name) _scByName.set(name.toLowerCase(), { id, name, content: (raw.content ?? {}) as Record<string, unknown> })
}

// ─── SDUI node shape ──────────────────────────────────────────────────────────

interface SduiNodeConfig {
  type: string
  id: string
  props: Record<string, unknown>
  children?: SduiNodeConfig[]
  text?: unknown
  map?: string | { js: string; as?: string; key?: string }
  key?: unknown
  condition?: unknown
  /** Render-body local consts — evaluated into the subtree scope at runtime */
  locals?: Array<{ name: string; js: string }>
  actions?: Array<
    | { action: string; params?: Record<string, unknown>; trigger?: string }
    | { trigger: string; steps: object[] }
    | { trigger: string; workflowId: string }
  >
  responsive?: Record<string, { className?: string; styles?: Record<string, unknown> }>
  _src?: string
  // forward-compat: anything else
  [key: string]: unknown
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeText(n: ts.Node): string {
  return n.getText().trim()
}

// ─── Page-scope local function registry ──────────────────────────────────────
// Thread-local set per compilePageToJson call so we don't need to plumb through
// every helper signature. Keyed by function name → inlinable IIFE string.

let _currentLocalFns = new Map<string, string>()

// Page-local parameterized functions (const X = defineFunction((a,b)=>…) inside a page body).
// These are NOT project-level functions — they live inside the page closure and often
// reference page-local consts like `rates`. Stored here with page-local consts already
// inlined so that lowerExpression can inline `X(arg1,arg2)` → `(fnBody)(arg1,arg2)`.
let _currentLocalParamFns = new Map<string, string>()

// Module-level const literals (arrays, objects) defined in the page source file
// but outside the definePage fn (e.g. `const WEEKDAYS = [...]`).
// Inlined into formula expressions that reference them so the renderer evaluator
// can resolve the value without a state-path lookup.
let _currentPageLocals = new Map<string, string>()

// AST nodes for page-level local functions (arrow, expression, or declaration).
// Used so onClick={prevMonth} is compiled as an action AND {Tab('A','a')} can be inlined.
let _currentPageLocalNodes = new Map<string, ts.FunctionLikeDeclaration>()

// The current .map() callback parameter name (e.g. `cell` in `.map((cell) => ...)`).
// Set by processMapCall before compiling the callback JSX so lowerExpression/lowerAction
// can rewrite `cell.field` → `context.item.field` via the LoweringEnv mapStack.
let _currentMapParam: string | undefined = undefined

// The current .map() callback index parameter name (e.g. `i` in `.map((cell, i) => ...)`).
// Passed into LoweringEnv mapStack so lowerExpression rewrites `i` → `context.item.index`.
let _currentMapIndexParam: string | undefined = undefined

// Parent (outer) map params — set when an inner nested map is being compiled so that
// lowerExpression/lowerAction can resolve outer-map param refs (e.g. `qi`) inside the
// inner map's click handlers to `context.item.parent.index`.
let _parentMapParam: string | undefined = undefined
let _parentMapIndexParam: string | undefined = undefined

// Stack of callback-local declarations from nested .map() block bodies.
// Each entry carries the raw locals map and the outer map's param/index names so that
// lowerExpression can inline parameterised calls like `choose(i)` in formulas/workflow code.
// Pushed/popped by processMapCall around every convertJsxElement call.
let _mapCallbackLocalsStack: Array<{
  locals: Map<string, string>
  paramName: string | undefined
  indexParamName: string | undefined
}> = []

// Maps workflow UUID → declared parameter names (e.g. 'deleteExpense' uuid → ['id']).
// Populated by scanning the source for defineWorkflow calls at the start of each compile.
// Used by parseArrowWorkflowCall and buildRunStepParams so that positional call-site args
// are keyed by the workflow's declared param name (e.g. `id`) instead of `arg0`, keeping
// the caller's `params.id` consistent with `parameters.id` in the workflow's code.
let _workflowParamNames: Map<string, string[]> = new Map()

// Runtime SC registry — populated from DSL-compiled defineComponent() calls in
// the same compilation pass. Overrides the static _scByName during page compile.
let _runtimeScMap = new Map<string, { id: string; name: string; content: Record<string, unknown>; triggers?: Array<{ id: string; name: string }> }>()

// Prop names of the component currently being compiled. When set, resolveExprToSdui
// rewrites bare prop identifiers to context.component?.props?.['name'].
let _componentPropNames: string[] = []

// SC trigger names active during an SC render function compilation.
// Maps triggerName → internal workflow ID so onClick={triggerName} compiles
// to an inline executeWorkflow action instead of a bare JS binding.
let _scTriggerNames: Map<string, string> = new Map()

// ─── Babel lowering env builder ───────────────────────────────────────────────

/**
 * Build a LoweringEnv from the current module-level globals.
 * Called at each resolveExprToSdui / rewriteBodyForRunJs call site so the
 * Babel lowerers have access to the current compilation context.
 *
 * @param pathToId  The per-page variable/workflow UUID map.
 * @param eventParam  Optional event handler parameter name (e.g. "e").
 */
function buildLoweringEnv(
  pathToId: Map<string, string>,
  eventParam?: string,
): ReturnType<typeof makeEnv> {
  // Build mapStack from the current nested-map globals.
  // _mapCallbackLocalsStack is pushed BEFORE convertJsxElement and its last entry IS
  // the current (innermost) map frame — so we only iterate the stack, never add
  // _currentMapParam separately (that would double-count the innermost frame).
  const mapStack: ReturnType<typeof makeEnv>['mapStack'] = _mapCallbackLocalsStack.map(frame => ({
    itemParam: frame.paramName,
    indexParam: frame.indexParamName,
    locals: frame.locals,
  }))

  const env = makeEnv({
    pathToId,
    pageLocals: _currentPageLocals,
    localFns: _currentLocalFns,
    localParamFns: _currentLocalParamFns,
    componentProps: _componentPropNames,
    eventParam,
    mapStack,
  })
  return env
}

// ─── Inline action builder ────────────────────────────────────────────────────

/**
 * Accumulator for auto-generated node-level inline workflows.
 * When a node calls a project workflow with arguments (e.g. `onClick={() => handle('7')}`),
 * `buildInlineAction` creates a thin inline workflow that holds a single `runProjectWorkflow`
 * step carrying those args — keeping the action object clean `{ trigger, workflowId }`.
 * Reset at the start of each `compilePageToJson` call.
 */
let _inlineWorkflows: Map<string, Record<string, unknown>> = new Map();

/**
 * Build a node action object `{ trigger, workflowId }`.
 * When params are present an inline (node-level) workflow is created automatically:
 *   steps: [{ type: 'runProjectWorkflow', config: { workflowId, params } }]
 * The action references that inline workflow's UUID — no params on the action itself.
 */
function buildInlineAction(
  trigger: string,
  workflowId: string,
  params?: Record<string, unknown>,
): { trigger: string; workflowId: string } {
  if (params && Object.keys(params).length > 0) {
    const inlineId = crypto.randomUUID();
    const stepId = crypto.createHash('sha256').update(`${inlineId}:step0`).digest('hex').slice(0, 32)
    _inlineWorkflows.set(inlineId, {
      id: inlineId,
      meta: { name: `inline-${workflowId.slice(0, 8)}`, trigger },
      steps: [{
        id: stepId,
        type: 'runProjectWorkflow',
        config: { workflowId, params },
      }],
    });
    return { trigger, workflowId: inlineId };
  }
  return { trigger, workflowId };
}

/** Map a JSX prop name (e.g. "onClick") to its trigger name (e.g. "click"). */
function propToTrigger(propName: string): string {
  // onClick → click, onChange → change, onSubmit → submit, onKeyDown → keyDown, etc.
  if (!propName.startsWith('on')) return propName;
  const rest = propName.slice(2);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

/**
 * Collect `const name = defineFunction(fn)` and `const name = () => ...` declarations
 * from the body of a page function (statements before the return statement).
 * Returns a map of name → inlinable expression (IIFE wraps block-body fns).
 */
function collectPageLocalFns(fnBody: ts.Node): Map<string, string> {
  const result = new Map<string, string>()

  function scanBlock(block: ts.Block | ts.Node) {
    const stmts: ts.Statement[] = ts.isBlock(block)
      ? Array.from(block.statements)
      : []

    for (const stmt of stmts) {
      if (!ts.isVariableStatement(stmt)) continue
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const name = decl.name.text
        const init = decl.initializer
        if (!init) continue

        // const fn = defineFunction(arrowFn)
        if (
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          init.expression.text === 'defineFunction' &&
          init.arguments[0] &&
          (ts.isArrowFunction(init.arguments[0]) || ts.isFunctionExpression(init.arguments[0]))
        ) {
          const arrow = init.arguments[0] as ts.ArrowFunction | ts.FunctionExpression
          if (arrow.parameters.length === 0) {
            // Zero-arg: store as IIFE so lowerExpression replaces `name()` → inlined body
            result.set(name, arrowToIife(arrow))
          } else {
            // Parameterized: store fn text with:
            //   1. Parameters renamed to _p0, _p1, … so lowerExpression cannot confuse
            //      a parameter name (e.g. `cur`) with a variable identifier and
            //      produce invalid syntax like `((variables['uuid']) => …)`.
            //   2. Any page-local consts (e.g. `rates`) already substituted in, so the
            //      inline form is self-contained.
            let fnText = nodeText(arrow)
            // Step 1: rename params
            arrow.parameters.forEach((p, i) => {
              if (ts.isIdentifier(p.name)) {
                fnText = replaceIdentInCode(fnText, p.name.text, `_p${i}`)
              }
            })
            // Step 2: inline page-local consts
            for (const [constName, constVal] of _currentPageLocals) {
              fnText = replaceIdentInCode(fnText, constName, `(${constVal})`)
            }
            _currentLocalParamFns.set(name, fnText)
          }
          continue
        }

        // const fn = () => expr  OR  const fn = (a, b) => expr
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          // Also register in _currentPageLocalNodes so that calls like {Tab('A','a')}
          // in JSX children can be inlined by processJsxExpression.
          _currentPageLocalNodes.set(name, init)
          if (init.parameters.length === 0) {
            // Zero-arg: store as IIFE so lowerExpression replaces `name()` → inlined body.
            result.set(name, arrowToIife(init))
          } else {
            // Parameterized plain arrow: rename params to _p0, _p1, … and store in
            // _currentLocalParamFns so lowerExpression replaces `name(` with `(fn)(`.
            // This mirrors the defineFunction parameterized path, avoiding variable name
            // collisions when the parameter shares a name with a DSL variable.
            let fnText = nodeText(init)
            init.parameters.forEach((p, i) => {
              if (ts.isIdentifier(p.name)) {
                fnText = replaceIdentInCode(fnText, p.name.text, `_p${i}`)
              }
            })
            // Inline any page-local consts already collected so the fn text is self-contained.
            for (const [constName, constVal] of _currentPageLocals) {
              fnText = replaceIdentInCode(fnText, constName, `(${constVal})`)
            }
            _currentLocalParamFns.set(name, fnText)
          }
          continue
        }

        // const data = [...] or const data = {...}
        // Register into _currentPageLocals so resolveExprToSdui can inline them.
        if (ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init)) {
          _currentPageLocals.set(name, nodeText(init))
          continue
        }

        // const derived = someArray.filter(...) / .slice() / .sort() etc.
        // Register as a computed local so formula references to it get the transitive
        // IIFE preamble treatment in resolveExprToSdui (which will also pull in deps
        // like `recipes` that appear in the expression).
        if (ts.isCallExpression(init) || ts.isPropertyAccessExpression(init)) {
          _currentPageLocals.set(name, nodeText(init))
          continue
        }
      }
    }
  }

  if (ts.isBlock(fnBody)) {
    scanBlock(fnBody)
  } else {
    ts.forEachChild(fnBody, child => {
      if (ts.isBlock(child)) scanBlock(child)
    })
  }

  return result
}

/**
 * Collect top-level module-level `const name = [...]` or `const name = {...}` declarations
 * from a page source file. These are plain data literals (not functions, not define* calls).
 * They are inlined into formula expressions so `{ js: "WEEKDAYS" }` resolves correctly.
 */
function collectPageLocalConsts(sf: ts.SourceFile): Map<string, string> {
  const result = new Map<string, string>()
  _currentPageLocalNodes = new Map()
  ts.forEachChild(sf, node => {
    // const foo = (...) => ...  or  const foo = function(...) { ... }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const init = decl.initializer
        if (
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          init.expression.text.startsWith('define')
        ) continue
        if (
          ts.isArrayLiteralExpression(init) ||
          ts.isObjectLiteralExpression(init) ||
          ts.isArrowFunction(init) ||
          ts.isFunctionExpression(init)
        ) {
          result.set(decl.name.text, nodeText(init))
          // Store arrow/function nodes so onClick={fnName} compiles as an action
          // and {Factory('a','b')} factory calls can be inlined.
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            _currentPageLocalNodes.set(decl.name.text, init)
          }
        }
        // Call expressions: e.g. `const currencies = Object.keys(rates)`.
        // Collected so resolveExprToSdui can inline them (with their dependencies) as
        // IIFE preambles when they are referenced in page formulas or map sources.
        if (ts.isCallExpression(init) || ts.isPropertyAccessExpression(init)) {
          result.set(decl.name.text, nodeText(init))
        }
        // Primitive module-level consts (numbers, strings, booleans) used in formula
        // expressions, e.g. `const totalHabits = 6` referenced in text bindings.
        if (
          ts.isNumericLiteral(init) ||
          ts.isStringLiteral(init) ||
          ts.isNoSubstitutionTemplateLiteral(init) ||
          init.kind === ts.SyntaxKind.TrueKeyword ||
          init.kind === ts.SyntaxKind.FalseKeyword
        ) {
          result.set(decl.name.text, nodeText(init))
        }
        // Catch-all for any other expression types not covered above:
        // binary expressions (e.g. `subtotal + SHIPPING`), template expressions,
        // conditional expressions, prefix/postfix unary, etc.
        if (!result.has(decl.name.text) && ts.isExpression(init)) {
          result.set(decl.name.text, nodeText(init))
        }
      }
      return
    }
    // function Foo(label, desc, ...) { return <JSX> }
    // Register as inlinable factory so {Foo('a','b')} in JSX children works.
    if (ts.isFunctionDeclaration(node) && node.name) {
      _currentPageLocalNodes.set(node.name.text, node)
    }
  })
  return result
}

/**
 * Collect render-body `const` declarations from a page/component render function body.
 * These are preserved as `locals[]` on the root node so they can be evaluated into
 * the subtree scope at runtime (exact round-trip — no inlining).
 *
 * Only const declarations that are NOT `define*` calls are collected.
 * Imperative statements (`let`, assignments) are skipped — they live in workflow bodies.
 */
function collectRenderBodyLocals(fnBody: ts.Node): Array<{ name: string; js: string }> {
  const locals: Array<{ name: string; js: string }> = []

  function scanBlock(block: ts.Block) {
    for (const stmt of block.statements) {
      // Stop at return — anything after return is unreachable
      if (ts.isReturnStatement(stmt)) break
      if (!ts.isVariableStatement(stmt)) continue
      // Only `const`, not `let` or `var`
      if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) continue

      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const name = decl.name.text
        const init = decl.initializer

        // Skip define* calls
        if (
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          init.expression.text.startsWith('define')
        ) continue

        locals.push({ name, js: nodeText(init) })
      }
    }
  }

  if (ts.isBlock(fnBody)) {
    scanBlock(fnBody)
  }

  return locals
}

/**
 * Convert an arrow/function expression to an IIFE string for call-site inlining.
 * Zero-param arrow `() => expr`  → `(expr)`
 * Zero-param block  `() => { }` → `((() => { })())`
 */
function arrowToIife(fn: ts.ArrowFunction | ts.FunctionExpression): string {
  if (fn.parameters.length === 0) {
    if (ts.isBlock(fn.body)) {
      return `(${nodeText(fn)}())`
    }
    // Concise body: () => expr
    return `(${nodeText(fn.body as ts.Expression)})`
  }
  // Has params → wrap as a function that can accept arguments inline
  return nodeText(fn)
}


/**
 * Replace a bare identifier `name` with `replacement` in JS/TS code,
 * but ONLY in code contexts — not inside string literals (single/double/backtick).
 * For template literals, only replaces inside ${...} interpolations.
 */
export function replaceIdentInCode(code: string, name: string, replacement: string, replaceCalls = false): string {
  // replaceCalls=true is used for prop substitution in localConsts where we DO want to
  // replace call-site identifiers (e.g. `highlight()` → `(()=>shouldHighlight('÷'))()`).
  // replaceCalls=false (default) is used for variable resolution where we skip calls to
  // avoid accidentally replacing global function names like `formatDisplay(...)`.
  const identRe = new RegExp(
    `(?<![.'"\\w])\\b${name}\\b(?!['"])${replaceCalls ? '' : '(?!\\s*\\()'}`,
    'g',
  )

  // Replace within a non-string segment, guarding against object property key position.
  // An identifier in key position is preceded (ignoring whitespace) by `{` or `,` AND
  // immediately followed by `:`.  This prevents `{ dept: 'v' }` from becoming
  // `{ variables['uuid']: 'v' }` while still replacing the identifier in expressions.
  function applySegment(segment: string): string {
    return segment.replace(identRe, (match: string, offset: number) => {
      const afterSlice = segment.slice(offset + match.length)
      if (/^\s*:/.test(afterSlice)) {
        const beforeTrimmed = segment.slice(0, offset).trimEnd()
        const lastCh = beforeTrimmed.length > 0 ? beforeTrimmed[beforeTrimmed.length - 1] : ''
        if (lastCh === '{' || lastCh === ',') return match
      }
      return replacement
    })
  }

  // Fast path: no string literals present
  if (!code.includes('"') && !code.includes("'") && !code.includes('`')) {
    return applySegment(code)
  }

  const out: string[] = []
  let i = 0

  while (i < code.length) {
    const ch = code[i]

    // Single-quoted string — copy verbatim (no identifier replacement)
    if (ch === "'") {
      let j = i + 1
      while (j < code.length) {
        if (code[j] === '\\') { j += 2; continue }
        if (code[j] === "'") { j++; break }
        j++
      }
      out.push(code.slice(i, j))
      i = j
      continue
    }

    // Double-quoted string — copy verbatim
    if (ch === '"') {
      let j = i + 1
      while (j < code.length) {
        if (code[j] === '\\') { j += 2; continue }
        if (code[j] === '"') { j++; break }
        j++
      }
      out.push(code.slice(i, j))
      i = j
      continue
    }

    // Template literal — copy plain parts verbatim, replace inside ${...} only
    if (ch === '`') {
      out.push('`')
      i++
      while (i < code.length) {
        if (code[i] === '\\') { out.push(code.slice(i, i + 2)); i += 2; continue }
        if (code[i] === '`') { out.push('`'); i++; break }
        if (code[i] === '$' && code[i + 1] === '{') {
          out.push('${')
          i += 2
          // find matching closing brace (handling nested braces)
          let depth = 1
          const interpStart = i
          while (i < code.length && depth > 0) {
            if (code[i] === '{') depth++
            else if (code[i] === '}') depth--
            if (depth > 0) i++
            else break
          }
          // Apply replacement inside interpolation content
          out.push(applySegment(code.slice(interpStart, i)))
          out.push('}')
          i++ // skip the closing }
          continue
        }
        // Plain template literal text — copy verbatim
        const start = i
        while (i < code.length && code[i] !== '`' && code[i] !== '\\' && !(code[i] === '$' && code[i + 1] === '{')) i++
        out.push(code.slice(start, i))
      }
      continue
    }

    // Regular code — accumulate until next string start, then apply replacement
    const start = i
    while (i < code.length && code[i] !== "'" && code[i] !== '"' && code[i] !== '`') i++
    out.push(applySegment(code.slice(start, i)))
  }

  return out.join('')
}

function resolveExprToSdui(exprText: string, pathToId: Map<string, string>): string {
  return lowerExpression(exprText, buildLoweringEnv(pathToId))
}

/**
 * If `s` is a zero-arg arrow function string (`() => expr` or `() => { stmts }`),
 * return just the body so it can be used directly as a `{ js: body }` statement block.
 * This handles the case where prop substitution left a parenthesised arrow like
 * `(()=>...)` that the TypeScript AST re-parse no longer recognises as an ArrowFunction.
 */
function unwrapArrowBody(s: string): string {
  const trimmed = s.trim()
  const match = trimmed.match(/^\(?\s*\(\s*\)\s*=>\s*/)
  if (!match) return s
  // If the regex consumed a leading `(` (parenthesised arrow `(() => ...)`),
  // the closing `)` of the outer parens is still present at the end of `body`
  // and must be stripped before we check for a block body.
  const consumedOuterParen = match[0].trimStart().startsWith('(')
  let body = trimmed.slice(match[0].length)
  if (consumedOuterParen && body.endsWith(')')) body = body.slice(0, -1).trim()
  // Block body: strip outer { }
  if (body.startsWith('{') && body.endsWith('}')) return body.slice(1, -1).trim()
  return body
}

/** Parse `workflow('path', { k: v })` call */
function parseWorkflowCall(
  call: ts.CallExpression,
  pathToId: Map<string, string>,
): { action: string; params?: Record<string, unknown> } | null {
  if (!ts.isIdentifier(call.expression) || call.expression.text !== 'workflow') return null

  const pathArg = call.arguments[0]
  if (!pathArg) return null

  const wfPath = ts.isStringLiteral(pathArg) ? pathArg.text : nodeText(pathArg).replace(/^['"]|['"]$/g, '')
  const wfName = wfPath.split('/').pop() ?? wfPath
  const action = pathToId.get(wfPath) ?? pathToId.get(`workflows/${wfName}`) ?? wfPath

  const paramsArg = call.arguments[1]
  let params: Record<string, unknown> | undefined
  if (paramsArg && ts.isObjectLiteralExpression(paramsArg)) {
    params = {}
    for (const prop of paramsArg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      const k = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null
      if (!k) continue
      const v = prop.initializer
      if (ts.isStringLiteral(v)) {
        params[k] = v.text
      } else if (ts.isNumericLiteral(v)) {
        params[k] = Number(v.text)
      } else if (v.kind === ts.SyntaxKind.TrueKeyword) {
        params[k] = true
      } else if (v.kind === ts.SyntaxKind.FalseKeyword) {
        params[k] = false
      } else {
        params[k] = { js: resolveExprToSdui(nodeText(v), pathToId) }
      }
    }
  }

  return { action, ...(params ? { params } : {}) }
}

/**
 * Parse `() => workflowRef(args)` — new API direct workflow call with args.
 * Returns an action entry if the arrow body is a single call to a known workflow.
 */
/**
 * Resolve a workflow-call param value expression to a JS string,
 * rewriting map callback param references to context.item.* paths.
 */
function resolveWfParamExpr(node: ts.Expression, pathToId: Map<string, string>): string {
  // Bare map item param (e.g. `f` in ['all','unread'].map(f => ...) → context.item.data
  if (ts.isIdentifier(node)) {
    if (_currentMapParam && node.text === _currentMapParam) return 'context.item.data'
    if (_currentMapIndexParam && node.text === _currentMapIndexParam) return 'context.item.index'
  }
  // Property access on the map param: n.id, n.type → context.item.data.id, context.item.data.type
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    if (_currentMapParam && node.expression.text === _currentMapParam) {
      return `context.item.data.${node.name.text}`
    }
  }
  return resolveExprToSdui(nodeText(node), pathToId)
}

function parseArrowWorkflowCall(
  arrow: ts.ArrowFunction | ts.FunctionExpression,
  pathToId: Map<string, string>,
): { action: string; params?: Record<string, unknown> } | null {
  let callExpr: ts.CallExpression | null = null

  if (ts.isCallExpression(arrow.body)) {
    callExpr = arrow.body
  } else if (ts.isBlock(arrow.body) && arrow.body.statements.length === 1) {
    const stmt = arrow.body.statements[0]
    if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
      callExpr = stmt.expression
    }
  }

  if (!callExpr) return null

  // Skip the old workflow('path', ...) pattern — handled by parseWorkflowCall
  if (ts.isIdentifier(callExpr.expression) && callExpr.expression.text === 'workflow') return null

  // setVar / navigate / fetch — these are inline steps, not action refs
  if (ts.isIdentifier(callExpr.expression)) {
    const fnName = callExpr.expression.text
    if (fnName === 'setVar' || fnName === 'navigate' || fnName === 'fetch') return null
  }

  // Check if the callee is a known workflow identifier
  if (!ts.isIdentifier(callExpr.expression)) return null
  const wfName = callExpr.expression.text
  const uuid = pathToId.get(wfName) ?? pathToId.get(`workflows/${wfName}`)
  if (!uuid) return null

  // Compile args to params
  let params: Record<string, unknown> | undefined
  if (callExpr.arguments.length > 0) {
    params = {}
    const firstArg = callExpr.arguments[0]
    const declaredParams = _workflowParamNames.get(uuid)
    // Single object literal arg: workflow({ id: item.id, name: item.name })
    // Two possible conventions:
    //   WRAP — workflow has exactly one param whose name does NOT appear as a key in the
    //          object (e.g. addToCart({id, name, price}) with (args)). The AI passes a
    //          whole struct that the workflow accesses as args.id → parameters.args.id.
    //   SPREAD — all other cases: props match declared param names (e.g. saveEdit({id})
    //            with (id)), or there are multiple declared params. The object's keys are
    //            mapped directly to top-level params → parameters.id = value.
    if (callExpr.arguments.length === 1 && ts.isObjectLiteralExpression(firstArg)) {
      // Collect the property names present in the object literal
      const objPropNames = firstArg.properties
        .filter((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p))
        .map(p => (ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : null))
        .filter((k): k is string => k !== null)

      // WRAP only when the workflow has exactly one declared param whose name does NOT
      // appear in the object's own property list — meaning the param is a container.
      const shouldWrap = !!(declaredParams &&
        declaredParams.length === 1 &&
        declaredParams[0] &&
        !objPropNames.includes(declaredParams[0]))

      if (shouldWrap) {
        // Build a formula string that evaluates to the entire object at runtime
        const wrapperKey = declaredParams![0]
        const propParts: string[] = []
        for (const prop of firstArg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue
          const k = ts.isIdentifier(prop.name) ? prop.name.text
                  : ts.isStringLiteral(prop.name) ? prop.name.text : null
          if (!k) continue
          const val = prop.initializer
          let valExpr: string
          if (ts.isStringLiteral(val))       valExpr = JSON.stringify(val.text)
          else if (ts.isNumericLiteral(val)) valExpr = val.text
          else if (val.kind === ts.SyntaxKind.TrueKeyword)  valExpr = 'true'
          else if (val.kind === ts.SyntaxKind.FalseKeyword) valExpr = 'false'
          else {
            valExpr = (ts.isArrowFunction(val) && val.parameters.length === 0 && !ts.isBlock(val.body))
              ? resolveWfParamExpr(val.body as ts.Expression, pathToId)
              : resolveWfParamExpr(val, pathToId)
          }
          propParts.push(`${JSON.stringify(k)}: ${valExpr}`)
        }
        params[wrapperKey] = { js: `{${propParts.join(', ')}}` }
      } else {
        // Spread object properties as individual top-level params
        for (const prop of firstArg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue
          const k = ts.isIdentifier(prop.name) ? prop.name.text
                  : ts.isStringLiteral(prop.name) ? prop.name.text : null
          if (!k) continue
          const val = prop.initializer
          if (ts.isStringLiteral(val))       params[k] = val.text
          else if (ts.isNumericLiteral(val)) params[k] = Number(val.text)
          else if (val.kind === ts.SyntaxKind.TrueKeyword)  params[k] = true
          else if (val.kind === ts.SyntaxKind.FalseKeyword) params[k] = false
          else {
            const raw = (ts.isArrowFunction(val) && val.parameters.length === 0 && !ts.isBlock(val.body))
              ? resolveWfParamExpr(val.body as ts.Expression, pathToId)
              : resolveWfParamExpr(val, pathToId)
            params[k] = { js: raw }
          }
        }
      }
    } else {
      // Positional args: workflow(a, b) — key by declared param name when available
      // so the caller's params.id matches `parameters.id` in the workflow's code.
      const declaredParams = _workflowParamNames.get(uuid)
      callExpr.arguments.forEach((arg, i) => {
        const key = declaredParams?.[i] ?? `arg${i}`
        if (ts.isStringLiteral(arg))       params![key] = arg.text
        else if (ts.isNumericLiteral(arg)) params![key] = Number(arg.text)
        else if (arg.kind === ts.SyntaxKind.TrueKeyword)  params![key] = true
        else if (arg.kind === ts.SyntaxKind.FalseKeyword) params![key] = false
        else params![key] = { js: resolveWfParamExpr(arg, pathToId) }
      })
    }
  }

  return { action: uuid, ...(params ? { params } : {}) }
}

/**
 * Parse sx={{ ... }} prop — the typed styling API.
 *
 * Static values (string/number/boolean) → fed into resolveStyleParams → className.
 * Dynamic values (() => expr arrow functions) → routed through SHORTHAND_FORMULA_CSS_MAP
 *   to camelCase CSS keys in props.style with { js } bindings.
 * Unknown keys (not in SHORTHAND_KEYS) pass through as raw camelCase CSS in props.style.
 *
 * Returns { className, style, responsiveStyles } so the caller can spread them
 * onto the correct node fields.
 */
function parseSxProp(
  obj: ts.ObjectLiteralExpression,
  pathToId: Map<string, string>,
): { className: string; style: Record<string, unknown>; classFormulas: Record<string, unknown>; responsiveStyles: Record<string, Record<string, unknown>> } {
  const staticShorthand: Record<string, unknown> = {}
  const dynamicStyle: Record<string, unknown> = {}
  const dynamicClassFormulas: Record<string, unknown> = {}

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const k = ts.isIdentifier(prop.name) ? prop.name.text
            : ts.isStringLiteral(prop.name) ? prop.name.text
            : null
    if (!k) continue

    const v = prop.initializer

    // () => expr — zero-arg arrow function → formula
    if (ts.isArrowFunction(v) && v.parameters.length === 0) {
      const exprText = arrowToIife(v)
      const resolved = resolveExprToSdui(exprText, pathToId)
      const classWrapper = SHORTHAND_FORMULA_CLASS_MAP[k]
      if (classWrapper) {
        dynamicClassFormulas[k] = { js: classWrapper(resolved) }
      } else {
        const mapping = SHORTHAND_FORMULA_CSS_MAP[k]
        if (mapping) {
          const wrappedExpr = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
          dynamicStyle[mapping.cssKey] = { js: wrappedExpr }
        } else {
          // unknown shorthand key — emit as-is under the original key
          dynamicStyle[k] = { js: resolved }
        }
      }
      continue
    }

    if (v.kind === ts.SyntaxKind.UndefinedKeyword) continue

    // Static literal value → bucket for resolveStyleParams
    if (ts.isStringLiteral(v))  { staticShorthand[k] = v.text;         continue }
    if (ts.isNumericLiteral(v)) { staticShorthand[k] = Number(v.text); continue }
    if (v.kind === ts.SyntaxKind.TrueKeyword)  { staticShorthand[k] = true;  continue }
    if (v.kind === ts.SyntaxKind.FalseKeyword) { staticShorthand[k] = false; continue }

    // Any other expression — formula
    const resolved = resolveExprToSdui(nodeText(v), pathToId)
    const classWrapper = SHORTHAND_FORMULA_CLASS_MAP[k]
    if (classWrapper) {
      dynamicClassFormulas[k] = { js: classWrapper(resolved) }
    } else {
      const mapping = SHORTHAND_FORMULA_CSS_MAP[k]
      if (mapping) {
        const wrappedExpr = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
        dynamicStyle[mapping.cssKey] = { js: wrappedExpr }
      } else {
        dynamicStyle[k] = { js: resolved }
      }
    }
  }

  const { className, responsiveStyles } = resolveStyleParams(staticShorthand)

  // Convert responsive breakpoint camelCase CSS to the shape compile-page needs
  const rStyles: Record<string, Record<string, unknown>> = {}
  for (const [bp, cssObj] of Object.entries(responsiveStyles)) {
    rStyles[bp] = cssObj as Record<string, unknown>
  }

  return { className, style: dynamicStyle, classFormulas: dynamicClassFormulas, responsiveStyles: rStyles }
}

/**
 * Parse a breakpoint sx object (laptop/tablet/mobile={{ ... }}).
 * Static values are converted to camelCase CSS via styleKeyToCssProps.
 * Dynamic values (() => expr) go to camelCase CSS with { formula }.
 * Returns a styles object for responsive[bp].styles.
 */
function parseBreakpointSx(
  obj: ts.ObjectLiteralExpression,
  pathToId: Map<string, string>,
): Record<string, unknown> {
  const styles: Record<string, unknown> = {}

  // Flat alias mappings for responsive breakpoints (same as top-level flat props)
  const BP_STRING_ALIASES: Record<string, string> = {
    cols: 'gridCols',
    size: 'text',
    color: 'textColor',
    align: 'textAlign',
  }

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const rawK = ts.isIdentifier(prop.name) ? prop.name.text
               : ts.isStringLiteral(prop.name) ? prop.name.text
               : null
    if (!rawK) continue
    const k = BP_STRING_ALIASES[rawK] ?? rawK  // normalize flat aliases

    const v = prop.initializer

    // () => expr → formula in camelCase CSS
    if (ts.isArrowFunction(v) && v.parameters.length === 0) {
      const exprText = arrowToIife(v)
      const resolved = resolveExprToSdui(exprText, pathToId)
      const mapping = SHORTHAND_FORMULA_CSS_MAP[k]
      if (mapping) {
        const wrappedExpr = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
        styles[mapping.cssKey] = { js: wrappedExpr }
      } else {
        styles[k] = { js: resolved }
      }
      continue
    }

    if (v.kind === ts.SyntaxKind.UndefinedKeyword) continue

    // Static literal → camelCase CSS via styleKeyToCssProps
    let rawVal: unknown
    if (ts.isStringLiteral(v))  rawVal = v.text
    else if (ts.isNumericLiteral(v)) rawVal = Number(v.text)
    else if (v.kind === ts.SyntaxKind.TrueKeyword)  rawVal = true
    else if (v.kind === ts.SyntaxKind.FalseKeyword) rawVal = false
    else {
      const resolved = resolveExprToSdui(nodeText(v), pathToId)
      const mapping = SHORTHAND_FORMULA_CSS_MAP[k]
      if (mapping) {
        const wrappedExpr = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
        styles[mapping.cssKey] = { js: wrappedExpr }
      } else {
        styles[k] = { js: resolved }
      }
      continue
    }

    const cssPairs = styleKeyToCssProps(k, rawVal)
    if (Object.keys(cssPairs).length) {
      Object.assign(styles, cssPairs)
    } else {
      // Unknown key — pass through as-is
      styles[k] = rawVal
    }
  }

  return styles
}


/**
 * Parse animation prop: animation={{ press: { opacity: 0.6 } }} — object literal
 */
function parseAnimationProp(
  expr: ts.Expression,
): Record<string, unknown> | null {
  if (!ts.isObjectLiteralExpression(expr)) return null

  const result: Record<string, unknown> = {}
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const k = ts.isIdentifier(prop.name) ? prop.name.text : null
    if (!k) continue
    const v = prop.initializer

    // Nested object (e.g. press: { opacity: 0.6 })
    if (ts.isObjectLiteralExpression(v)) {
      const nested: Record<string, unknown> = {}
      for (const sp of v.properties) {
        if (!ts.isPropertyAssignment(sp)) continue
        const sk = ts.isIdentifier(sp.name) ? sp.name.text : null
        if (!sk) continue
        if (ts.isStringLiteral(sp.initializer))  nested[sk] = sp.initializer.text
        else if (ts.isNumericLiteral(sp.initializer)) nested[sk] = Number(sp.initializer.text)
        else if (sp.initializer.kind === ts.SyntaxKind.TrueKeyword)  nested[sk] = true
        else if (sp.initializer.kind === ts.SyntaxKind.FalseKeyword) nested[sk] = false
      }
      result[k] = nested
      continue
    }

    if (ts.isStringLiteral(v))  result[k] = v.text
    else if (ts.isNumericLiteral(v)) result[k] = Number(v.text)
    else if (v.kind === ts.SyntaxKind.TrueKeyword)  result[k] = true
    else if (v.kind === ts.SyntaxKind.FalseKeyword) result[k] = false
  }
  return result
}

// ─── Validation rule parsers ─────────────────────────────────────────────────

/**
 * Parse an ObjectLiteralExpression representing a single validation rule
 * e.g. { rule: 'required', message: 'Required' }
 *      { rule: 'minLength', value: 3, message: 'Too short' }
 *      { rule: 'formula', formula: 'value === true', message: 'Must agree' }
 */
function parseValidationRule(expr: ts.ObjectLiteralExpression): Record<string, unknown> | null {
  const obj: Record<string, unknown> = {}
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null
    if (!key) continue
    const val = prop.initializer
    if (ts.isStringLiteral(val))         obj[key] = val.text
    else if (ts.isNumericLiteral(val))   obj[key] = Number(val.text)
    else if (val.kind === ts.SyntaxKind.TrueKeyword)  obj[key] = true
    else if (val.kind === ts.SyntaxKind.FalseKeyword) obj[key] = false
  }
  return Object.keys(obj).length > 0 ? obj : null
}

/** Parse _validation={[...]} — array of rule objects → stored as-is (trigger defaults to submit) */
function parseValidationRules(expr: ts.ArrayLiteralExpression): Record<string, unknown>[] {
  const rules: Record<string, unknown>[] = []
  for (const el of expr.elements) {
    if (ts.isObjectLiteralExpression(el)) {
      const rule = parseValidationRule(el)
      if (rule) rules.push(rule)
    }
  }
  return rules
}

/** Parse _validation={{ trigger: 'submit', rules: [...] }} — object with trigger + rules */
function parseValidationObject(expr: ts.ObjectLiteralExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null
    if (!key) continue
    const val = prop.initializer
    if (key === 'trigger' && ts.isStringLiteral(val)) {
      result.trigger = val.text
    } else if (key === 'rules' && ts.isArrayLiteralExpression(val)) {
      result.rules = parseValidationRules(val)
    }
  }
  return result
}

/** Parse popover={{ trigger, placement, offset, ... }} object literal */
function parsePopoverConfig(expr: ts.ObjectLiteralExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null
    if (!key) continue
    const val = prop.initializer
    if (ts.isStringLiteral(val)) {
      result[key] = val.text
    } else if (ts.isNumericLiteral(val)) {
      result[key] = Number(val.text)
    } else if (val.kind === ts.SyntaxKind.TrueKeyword) {
      result[key] = true
    } else if (val.kind === ts.SyntaxKind.FalseKeyword) {
      result[key] = false
    }
  }
  return result
}

// ─── Flat prop lookup tables ──────────────────────────────────────────────────
// Maps flat boolean shorthands to their equivalent sx key/value pairs.

const FLAT_BOOL_PROPS: Record<string, Record<string, unknown>> = {
  flex:     { display: 'flex' },
  col:      { display: 'flex', direction: 'col' },
  row:      { display: 'flex', direction: 'row' },
  grid:     { display: 'grid' },
  center:   { items: 'center', justify: 'center' },
  flex1:    { flex1: true },
  absolute: { position: 'absolute' },
  relative: { position: 'relative' },
  fixed:    { position: 'fixed' },
  sticky:   { position: 'sticky' },
  inset0:   { inset0: true },
  uppercase: { textTransform: 'uppercase' },
  lowercase: { textTransform: 'lowercase' },
  colSpanFull: { colSpanFull: true },
}

// Maps flat prop aliases to their canonical sx key.
const FLAT_STRING_ALIASES: Record<string, string> = {
  size:  'text',         // size={14} → sx.text = 14
  color: 'textColor',    // color="#fff" → sx.textColor = '#fff'
  align: 'textAlign',    // align="center" → sx.textAlign = 'center'
  cols:  'gridCols',     // cols={3} → sx.gridCols = 3
  shadow: 'shadow',
}

// ─── JSX element → SduiNodeConfig ────────────────────────────────────────────

/**
 * Compile a shared-component reference into the correct SDUI instance format.
 * Accepts either the direct-tag form (<Card title="…" />) or the legacy SC form (<SC id="Card" …>).
 * Emits a deep-clone of the model content with fresh node IDs and _sharedKey so each
 * instance is independently selectable in the builder.
 */
function convertScReference(
  jsxNode: ts.JsxElement | ts.JsxSelfClosingElement,
  pathToId: Map<string, string>,
  relSrc: string,
  mapContext?: { mapExpr: string; keyExpr?: string },
  localComponents?: Map<string, LocalComponentDef>,
  scNameOverride?: string,
): SduiNodeConfig {
  const opening = ts.isJsxElement(jsxNode) ? jsxNode.openingElement : jsxNode

  // When called from a PascalCase tag (<CalcButton />), the component name comes
  // from the tag itself. In the <SC id="Name"> form it comes from the id attribute.
  let scName = scNameOverride ?? ''

  // Pre-scan: determine SC name so we can look up its triggers before the main loop.
  // Only needed for the <SC id="Name"> form where scNameOverride is not provided.
  if (!scNameOverride) {
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr)) continue
      const attrName = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText()
      if (attrName === 'id' && attr.initializer && ts.isStringLiteral(attr.initializer)) {
        scName = (attr.initializer as ts.StringLiteral).text
        break
      }
    }
  }

  // Look up SC triggers so trigger-named props are bound as wrapper workflows
  // instead of being passed as regular props.
  const preLookup = scName
    ? (_scByName.get(scName.toLowerCase()) ?? _runtimeScMap.get(scName.toLowerCase()))
    : undefined
  const scTriggerIds = new Map<string, { triggerId: string; domEvent?: string }>()
  if (preLookup) {
    const tArr = (preLookup as { triggers?: Array<{ id: string; name: string; domEvent?: string }> }).triggers ?? []
    for (const t of tArr) scTriggerIds.set(t.name, { triggerId: t.id, domEvent: t.domEvent })
  }

  const passedProps: Record<string, unknown> = {}
  const triggerActions: Array<{ trigger: string; workflowId: string }> = []

  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue
    const attrName = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText()
    const init = attr.initializer

    // Skip `id` attr when not using the <SC> form (name already set via override)
    if (attrName === 'id' && !scNameOverride) {
      // scName already resolved in pre-scan; just skip in main loop
      continue
    }
    if (attrName === 'id' && scNameOverride) continue

    // Trigger binding: onPress={handleClear} or onPress={() => handleNumber('7')}
    // Emit an inline action directly on the instance node — no sc-tw-* wrapper needed.
    if (scTriggerIds.has(attrName) && init && ts.isJsxExpression(init) && init.expression) {
      const expr = init.expression
      let actionItem: { action: string; params?: Record<string, unknown> } | null = null

      if (ts.isIdentifier(expr)) {
        // Bare reference: onPress={handleClear}
        const wfId = pathToId.get(expr.text) ?? pathToId.get(`workflows/${expr.text}`) ?? null
        if (wfId) actionItem = { action: wfId }
      } else if (ts.isArrowFunction(expr) && expr.parameters.length === 0) {
        // Arrow function: onPress={() => handleNumber('7')}
        actionItem = parseArrowWorkflowCall(expr, pathToId) ?? null
      } else if (ts.isParenthesizedExpression(expr) && ts.isArrowFunction(expr.expression)
                 && expr.expression.parameters.length === 0) {
        // Parenthesised arrow: onPress={(()=>handleNumber('7'))}
        actionItem = parseArrowWorkflowCall(expr.expression, pathToId) ?? null
      }

      if (actionItem) {
        const { domEvent } = scTriggerIds.get(attrName)!
        // Use the DOM event name ('click', 'change', etc.) from the SC trigger definition.
        // Fall back to the prop name converted to trigger form (e.g. onPress → press).
        const trigger = domEvent ?? propToTrigger(attrName)
        triggerActions.push(buildInlineAction(trigger, actionItem.action, actionItem.params))
      }
      continue // don't add to passedProps
    }

    if (!init) {
      passedProps[attrName] = true
      continue
    }
    if (ts.isStringLiteral(init)) {
      passedProps[attrName] = init.text
      continue
    }
    if (ts.isJsxExpression(init) && init.expression) {
      const expr = init.expression
      // Literal values — emit as plain primitives, not {js: "..."} bindings
      if (ts.isNumericLiteral(expr)) {
        passedProps[attrName] = Number(expr.text)
        continue
      }
      if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken
          && ts.isNumericLiteral(expr.operand)) {
        passedProps[attrName] = -Number((expr.operand as ts.NumericLiteral).text)
        continue
      }
      if (expr.kind === ts.SyntaxKind.TrueKeyword)  { passedProps[attrName] = true;  continue }
      if (expr.kind === ts.SyntaxKind.FalseKeyword) { passedProps[attrName] = false; continue }
      const raw = nodeText(expr)
      // Arrow functions need their body unwrapped so the renderer can evaluate them as formulas
      const resolved = resolveExprToSdui(unwrapArrowBody(raw), pathToId)
      passedProps[attrName] = { js: resolved }
    }
  }

  // Re-resolve scName for <SC id="Name"> form from the init value if not in pre-scan
  if (!scNameOverride && !scName) {
    for (const attr of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attr)) continue
      const attrName = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText()
      const init = attr.initializer
      if (attrName === 'id' && init && !ts.isStringLiteral(init)) {
        scName = nodeText(init)
        break
      }
    }
  }

  // Look up the SC model by name — static registry first, then DSL-compiled runtime registry
  const scModel = scName
    ? (_scByName.get(scName.toLowerCase()) ?? _runtimeScMap.get(scName.toLowerCase()))
    : undefined

  if (!scModel) {
    // Not a registered SC — if it matches a local component, inline it
    if (scName && localComponents?.has(scName)) {
      const inlined = inlineLocalComponent(jsxNode, localComponents.get(scName)!, pathToId, relSrc, localComponents)
      if (Array.isArray(inlined)) {
        const wrapper: SduiNodeConfig = { type: 'Box', id: crypto.randomUUID(), props: {} }
        wrapper.children = inlined
        if (mapContext) { wrapper.map = mapContext.mapExpr; if (mapContext.keyExpr) wrapper.key = mapContext.keyExpr }
        return wrapper
      }
      if (mapContext) { inlined.map = mapContext.mapExpr; if (mapContext.keyExpr) inlined.key = mapContext.keyExpr }
      return inlined
    }
    // Unknown SC — emit a placeholder
    const placeholder: SduiNodeConfig = {
      type: 'Box',
      id: crypto.randomUUID(),
      props: { className: 'sc-unknown-placeholder' },
    }
    if (mapContext) { placeholder.map = mapContext.mapExpr; if (mapContext.keyExpr) placeholder.key = mapContext.keyExpr }
    return placeholder
  }

  // Deep-clone the model content tree with fresh node IDs for this instance.
  // Preserves _sharedKey so the builder can match instance nodes back to model nodes.
  // Stamps a fresh _sharedKey on any node that doesn't have one yet (DSL-compiled models).
  function cloneWithFreshIds(node: Record<string, unknown>): Record<string, unknown> {
    const clone: Record<string, unknown> = { ...node, id: crypto.randomUUID() }
    if (!clone._sharedKey) clone._sharedKey = crypto.randomUUID()
    if (Array.isArray(clone.children))
      clone.children = (clone.children as Record<string, unknown>[]).map(c => cloneWithFreshIds({ ...c }))
    return clone
  }

  // Emit the correct shared-component instance format.
  // The instance root IS the model content root — no extra wrapper.
  // Each instance gets its own node IDs so the builder selects them individually.
  const modelRoot = scModel.content as Record<string, unknown>
  const instanceRoot = cloneWithFreshIds(JSON.parse(JSON.stringify(modelRoot)))
  // Instance props overlay the model defaults
  instanceRoot.props = { ...(modelRoot.props as Record<string, unknown> ?? {}), ...passedProps }
  instanceRoot._shared = { id: scModel.id, name: scModel.name }
  instanceRoot._overrides = Object.keys(passedProps)
  // Page-level trigger bindings only. The SC relay action is internal to the SC
  // model and is NOT copied to instances — each instance gets a single direct
  // binding (e.g. trigger:'click' → executeWorkflow(uuid)).
  instanceRoot.actions = triggerActions
  if (mapContext) { instanceRoot.map = mapContext.mapExpr; if (mapContext.keyExpr) instanceRoot.key = mapContext.keyExpr }
  return instanceRoot as unknown as SduiNodeConfig
}


// ─── Action factory parsers (run / when / seq / set) ─────────────────────────

interface ParsedAction {
  trigger: string
  workflowId: string
  params?: Record<string, unknown>
}
interface InlineStep {
  id: string
  type: string
  config: Record<string, unknown>
}

/**
 * Parse `run(wf, { key: val })` → action entry.
 * Returns null if not a recognized run() call.
 */
function parseRunCall(
  expr: ts.CallExpression,
  trigger: string,
  pathToId: Map<string, string>,
): ParsedAction | null {
  const args = expr.arguments
  if (args.length < 1) return null

  const wfArg = args[0]
  let wfUuid: string | undefined

  if (ts.isIdentifier(wfArg)) {
    wfUuid = pathToId.get(wfArg.text) ?? pathToId.get(`workflows/${wfArg.text}`)
  }
  if (!wfUuid) return null

  let params: Record<string, unknown> | undefined
  if (args.length >= 2 && ts.isObjectLiteralExpression(args[1])) {
    params = {}
    for (const prop of (args[1] as ts.ObjectLiteralExpression).properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      const k = ts.isIdentifier(prop.name) ? prop.name.text
               : ts.isStringLiteral(prop.name) ? prop.name.text : null
      if (!k) continue
      const val = prop.initializer
      if (ts.isStringLiteral(val))       params[k] = val.text
      else if (ts.isNumericLiteral(val)) params[k] = Number(val.text)
      else if (val.kind === ts.SyntaxKind.TrueKeyword)  params[k] = true
      else if (val.kind === ts.SyntaxKind.FalseKeyword) params[k] = false
      else if (ts.isPropertyAccessExpression(val) && val.name.text === 'value' &&
               ts.isIdentifier(val.expression) && val.expression.text === 'ev') {
        // ev.value → event-value binding
        params[k] = { js: '__ev_value__' }
      } else {
        // () => expr — unwrap arrow
        const resolved = (ts.isArrowFunction(val) && val.parameters.length === 0 && !ts.isBlock(val.body))
          ? resolveExprToSdui(nodeText(val.body as ts.Expression), pathToId)
          : resolveExprToSdui(nodeText(val), pathToId)
        params[k] = { js: resolved }
      }
    }
  }

  return buildInlineAction(trigger, wfUuid, params)
}

/**
 * Parse `set(varRef, value)` → inline workflow with changeVariableValue step.
 * Returns the inline workflow UUID if recognized.
 */
function parseSetCall(
  expr: ts.CallExpression,
  trigger: string,
  pathToId: Map<string, string>,
): { trigger: string; workflowId: string } | null {
  const args = expr.arguments
  if (args.length < 2) return null

  const varArg = args[0]
  let varUuid: string | undefined

  if (ts.isIdentifier(varArg)) {
    varUuid = pathToId.get(varArg.text)
  }
  if (!varUuid) return null

  const valArg = args[1]
  let value: unknown

  if (ts.isStringLiteral(valArg))       value = valArg.text
  else if (ts.isNumericLiteral(valArg)) value = Number(valArg.text)
  else if (valArg.kind === ts.SyntaxKind.TrueKeyword)  value = true
  else if (valArg.kind === ts.SyntaxKind.FalseKeyword) value = false
  // ev.value
  else if (ts.isPropertyAccessExpression(valArg) && valArg.name.text === 'value' &&
           ts.isIdentifier(valArg.expression) && valArg.expression.text === 'ev') {
    value = { js: '__ev_value__' }
  }
  // () => expr
  else if (ts.isArrowFunction(valArg) && valArg.parameters.length === 0 && !ts.isBlock(valArg.body)) {
    value = { js: resolveExprToSdui(nodeText(valArg.body as ts.Expression), pathToId) }
  }
  else {
    value = { js: resolveExprToSdui(nodeText(valArg), pathToId) }
  }

  const inlineId = crypto.randomUUID()
  _inlineWorkflows.set(inlineId, {
    id: inlineId,
    meta: { name: `set-${varUuid.slice(0, 8)}`, trigger },
    steps: [{
      id: crypto.randomUUID(),
      type: 'changeVariableValue',
      config: { variableName: varUuid, value: value },
    }],
  })
  return { trigger, workflowId: inlineId }
}

/**
 * Parse `when(cond, action)` → inline workflow with passThroughCondition + action step.
 */
function parseWhenCall(
  expr: ts.CallExpression,
  trigger: string,
  pathToId: Map<string, string>,
): { trigger: string; workflowId: string } | null {
  const args = expr.arguments
  if (args.length < 2) return null

  const condArg = args[0]
  let condExpr: string
  if (ts.isArrowFunction(condArg) && condArg.parameters.length === 0 && !ts.isBlock(condArg.body)) {
    condExpr = resolveExprToSdui(nodeText(condArg.body as ts.Expression), pathToId)
  } else {
    condExpr = resolveExprToSdui(nodeText(condArg), pathToId)
  }

  const actionArg = args[1]
  if (!ts.isCallExpression(actionArg)) return null
  if (!ts.isIdentifier(actionArg.expression)) return null

  const innerName = actionArg.expression.text
  let innerAction: { trigger: string; workflowId: string } | null = null

  if (innerName === 'run') {
    innerAction = parseRunCall(actionArg, trigger, pathToId)
  } else if (innerName === 'set') {
    innerAction = parseSetCall(actionArg, trigger, pathToId)
  }
  if (!innerAction) return null

  // Wrap in a passThroughCondition inline workflow
  const inlineId = crypto.randomUUID()
  _inlineWorkflows.set(inlineId, {
    id: inlineId,
    meta: { name: `when-${inlineId.slice(0, 8)}`, trigger },
    steps: [
      {
        id: crypto.randomUUID(),
        type: 'passThroughCondition',
        config: { condition: { js: condExpr } },
      },
      {
        id: crypto.randomUUID(),
        type: 'runProjectWorkflow',
        config: { workflowId: innerAction.workflowId },
      },
    ],
  })
  return { trigger, workflowId: inlineId }
}

/**
 * Parse `seq(action1, action2, ...)` → inline workflow with multiple steps.
 */
function parseSeqCall(
  expr: ts.CallExpression,
  trigger: string,
  pathToId: Map<string, string>,
): { trigger: string; workflowId: string } | null {
  const steps: InlineStep[] = []

  for (const arg of expr.arguments) {
    if (!ts.isCallExpression(arg) || !ts.isIdentifier(arg.expression)) continue
    const name = arg.expression.text
    let action: { trigger: string; workflowId: string } | null = null

    if (name === 'run') action = parseRunCall(arg, trigger, pathToId)
    else if (name === 'set') action = parseSetCall(arg, trigger, pathToId)
    else if (name === 'when') action = parseWhenCall(arg, trigger, pathToId)

    if (action) {
      steps.push({
        id: crypto.randomUUID(),
        type: 'runProjectWorkflow',
        config: { workflowId: action.workflowId },
      })
    }
  }

  if (steps.length === 0) return null

  const inlineId = crypto.randomUUID()
  _inlineWorkflows.set(inlineId, {
    id: inlineId,
    meta: { name: `seq-${inlineId.slice(0, 8)}`, trigger },
    steps,
  })
  return { trigger, workflowId: inlineId }
}

/**
 * Rewrite an arrow function body into a JavaScript string suitable for a
 * `runJavaScript` step. The engine's runJavaScript handler provides:
 *   - `variables['uuid']`           — writable Proxy for the variable store
 *   - `wwLib.runStep({ type, config })` — dispatches any step type
 *   - `context`                     — full formula context (context.event?.value etc.)
 *
 * Rewriting performed:
 *   - Known variable identifiers → `variables['uuid']`
 *   - Known workflow calls wfName(args) → `await wwLib.runStep({ type:'runProjectWorkflow', ... })`
 *   - eventParam.value → `context.event?.value`
 */
function rewriteBodyForRunJs(
  arrow: ts.ArrowFunction | ts.FunctionExpression,
  pathToId: Map<string, string>,
  eventParam: string | undefined,
): string {
  const bodyText = ts.isBlock(arrow.body)
    ? arrow.body.statements.map(s => nodeText(s)).join('\n')
    : nodeText(arrow.body)
  const env = buildLoweringEnv(pathToId, eventParam)
  return lowerActionBabel(bodyText, env)
}


/**
 * Parse any arrow function as an event action, emitting a single `runJavaScript`
 * inline workflow step. The step body has all variable/workflow references
 * rewritten to their runtime forms (`variables['uuid']`, `wwLib.runStep(...)`).
 *
 * Handles all JS patterns natively: if/else, assignments, workflow calls,
 * multi-statement blocks, event param (`e.value` → `context.event?.value`).
 */
function parseArrowAction(
  arrow: ts.ArrowFunction | ts.FunctionExpression,
  trigger: string,
  pathToId: Map<string, string>,
): { trigger: string; workflowId: string } | null {
  const eventParam =
    arrow.parameters.length > 0 && ts.isIdentifier(arrow.parameters[0].name)
      ? arrow.parameters[0].name.text
      : undefined

  // ── Zero-param single workflow call: () => wf(args) — fast path ───────────
  // Delegate to existing parseArrowWorkflowCall for zero-param arrows that call
  // a single known workflow. This preserves the existing params → payload mapping.
  if (!ts.isBlock(arrow.body) || (ts.isBlock(arrow.body) && arrow.body.statements.length === 1)) {
    const existing = parseArrowWorkflowCall(arrow, pathToId)
    if (existing) {
      return buildInlineAction(trigger, existing.action, existing.params)
    }
  }

  // ── All other patterns: emit runJavaScript ─────────────────────────────────
  let code = rewriteBodyForRunJs(arrow, pathToId, eventParam)
  if (!code.trim()) return null

  // ── Inline page-local zero-arg function calls (e.g. isCorrect(), progress()) ──
  // Zero-arg defineFunction bodies live in _currentLocalFns as IIFE strings like
  // "((() => body)())". Strip the IIFE wrapper to get the raw body, apply UUID resolution,
  // then substitute every fnName() call with the inlined (body) expression.
  const iifePrefix = '((() => '
  const iifeSuffix = ')())'
  for (const [localName, iife] of _currentLocalFns) {
    const callRe = new RegExp(`\\b${localName}\\s*\\(\\)`, 'g')
    if (!callRe.test(code)) continue
    // Extract raw body from IIFE wrapper
    let body = (iife.startsWith(iifePrefix) && iife.endsWith(iifeSuffix))
      ? iife.slice(iifePrefix.length, -iifeSuffix.length).trim()
      : iife
    // Apply variable UUID resolution to the body
    for (const [varName, uuid] of pathToId) {
      if (varName.includes('/') || varName === uuid) continue
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(varName)) continue
      body = replaceIdentInCode(body, varName, `variables['${uuid}']`)
    }
    code = code.replace(new RegExp(`\\b${localName}\\s*\\(\\)`, 'g'), `(${body})`)
  }

  // ── Inline parameterised map-callback local function calls (e.g. choose(i)) ──
  // These functions are defined inside an outer .map() block body and are not available
  // at runtime. The _mapCallbackLocalsStack exposes outer map locals to inner map handlers.
  // Stack[0] = outermost map locals, Stack[last] = innermost — depth = stack.length-1-si.
  for (let si = 0; si < _mapCallbackLocalsStack.length; si++) {
    const entry = _mapCallbackLocalsStack[si]
    // How many context.item levels need to be bumped for this stack entry:
    // innermost locals are at depth 0 (current map's own, if any), outermost at depth N-1.
    const contextDepth = _mapCallbackLocalsStack.length - 1 - si
    for (const [localName, localExpr] of entry.locals) {
      const callTestRe = new RegExp(`(?<![.'"\\w])\\b${localName}\\b(?=\\s*\\()`)
      if (!callTestRe.test(code)) continue
      // Build inlined form from raw text: rewrite param → context refs, resolve UUIDs, bump depth
      let inlinedVal = localExpr
      if (entry.paramName) {
        inlinedVal = inlinedVal.replace(
          new RegExp(`(?<![.'"\`\\w])\\b${entry.paramName}\\.`, 'g'),
          'context.item.data.',
        )
        inlinedVal = replaceIdentInCode(inlinedVal, entry.paramName, 'context.item.data')
      }
      if (entry.indexParamName) {
        inlinedVal = replaceIdentInCode(inlinedVal, entry.indexParamName, 'context.item.index')
      }
      for (const [varName, uuid] of pathToId) {
        if (varName.includes('/') || varName === uuid) continue
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(varName)) continue
        inlinedVal = replaceIdentInCode(inlinedVal, varName, `variables['${uuid}']`)
      }
      // Bump context depth: context.item.data → context.item.parent.data (per depth level)
      if (contextDepth > 0) {
        const parentChain = 'parent.'.repeat(contextDepth)
        inlinedVal = inlinedVal
          .replace(/\bcontext\.item\.data\b/g, `context.item.${parentChain}data`)
          .replace(/\bcontext\.item\.index\b/g, `context.item.${parentChain}index`)
      }
      // Replace call: localName(args) → (inlinedVal)(args)
      const callRe = new RegExp(`(?<![.'"\\w])\\b${localName}\\b(?=\\s*\\()`, 'g')
      code = code.replace(callRe, `(${inlinedVal})`)
    }
  }

  // ── Prepend page-local const declarations referenced in the workflow code ──
  // Uses transitive dependency collection (same approach as resolveExprToSdui) so
  // that indirect deps like `total` (needed by `totalPages`'s value) are included.
  const wfNeeded = new Set<string>()
  function collectWfDeps(scope: string, depth = 0) {
    if (depth > 8) return
    // Strip single/double-quoted literals to avoid false-positive identifier matches
    const scopeNoStrings = scope
      .replace(/'(?:[^'\\]|\\.)*'/g, '""')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    for (const [localName, localValue] of _currentPageLocals) {
      if (wfNeeded.has(localName)) continue
      // Skip local component factories — functions whose bodies contain JSX syntax.
      // These are valid in JSX render context only and must not appear in runJavaScript preambles.
      // Non-JSX helper functions (e.g. setSort, toggle helpers) ARE included.
      if (_currentPageLocalNodes.has(localName)) {
        const isJsxFactory = /<\/|return\s*\(?\s*<[A-Z]|=>\s*\(?[\s\S]{0,20}<[A-Z]/.test(localValue)
        if (isJsxFactory) continue
      }
      const re = new RegExp(`(?<![.'"[/\\w])\\b${localName}\\b`)
      if (!re.test(scopeNoStrings)) continue
      wfNeeded.add(localName)
      collectWfDeps(localValue, depth + 1)  // recurse for transitive deps
    }
  }
  collectWfDeps(code)

  const wfPreamble: string[] = []
  for (const [localName, localValue] of _currentPageLocals) {
    if (!wfNeeded.has(localName)) continue
    let resolvedValue = localValue
    for (const [varName, uuid] of pathToId) {
      if (varName.includes('/') || varName === uuid) continue
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(varName)) continue
      resolvedValue = replaceIdentInCode(resolvedValue, varName, `variables['${uuid}']`)
    }
    wfPreamble.push(`const ${localName} = ${resolvedValue};`)
  }
  if (wfPreamble.length > 0) code = wfPreamble.join('\n') + '\n' + code

  const inlineId = crypto.randomUUID()
  _inlineWorkflows.set(inlineId, {
    id: inlineId,
    meta: { name: `js-${inlineId.slice(0, 8)}`, trigger },
    steps: [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } }],
  })
  return { trigger, workflowId: inlineId }
}

/**
 * Top-level event factory dispatcher — handles run/when/seq/set call expressions
 * in onClick/onChange/onSubmit props.
 */
function parseActionFactory(
  expr: ts.CallExpression,
  trigger: string,
  pathToId: Map<string, string>,
): { trigger: string; workflowId: string } | null {
  if (!ts.isIdentifier(expr.expression)) return null
  const name = expr.expression.text
  if (name === 'run')  return parseRunCall(expr, trigger, pathToId)
  if (name === 'set')  return parseSetCall(expr, trigger, pathToId)
  if (name === 'when') return parseWhenCall(expr, trigger, pathToId)
  if (name === 'seq')  return parseSeqCall(expr, trigger, pathToId)
  return null
}

function convertJsxElement(
  jsxNode: ts.JsxElement | ts.JsxSelfClosingElement,
  pathToId: Map<string, string>,
  relSrc: string,
  mapContext?: { mapExpr: string; keyExpr?: string },
  localComponents?: Map<string, LocalComponentDef>,
): SduiNodeConfig {
  const opening = ts.isJsxElement(jsxNode) ? jsxNode.openingElement : jsxNode
  const tagName = opening.tagName.getText().trim()

  // Inline locally-defined function components rather than emitting an unknown type
  if (localComponents?.has(tagName)) {
    const inlined = inlineLocalComponent(jsxNode, localComponents.get(tagName)!, pathToId, relSrc, localComponents)
    if (Array.isArray(inlined)) {
      // Wrap multiple root nodes in a Box
      const wrapper: SduiNodeConfig = { type: 'Box', id: crypto.randomUUID(), props: {} }
      wrapper.children = inlined
      if (mapContext) { wrapper.map = mapContext.mapExpr; if (mapContext.keyExpr) wrapper.key = mapContext.keyExpr }
      return wrapper
    }
    if (mapContext) { inlined.map = mapContext.mapExpr; if (mapContext.keyExpr) inlined.key = mapContext.keyExpr }
    return inlined
  }

  // Shared component reference — two supported forms:
  //   Direct tag:  <Card title="…" />         (preferred)
  //   Legacy form: <SC id="Card" title="…" /> (still supported for backwards compat)
  if (tagName === 'SC') {
    return convertScReference(jsxNode, pathToId, relSrc, mapContext, localComponents)
  }
  const tagLower = tagName.toLowerCase()
  if (_scByName.has(tagLower) || _runtimeScMap.has(tagLower)) {
    return convertScReference(jsxNode, pathToId, relSrc, mapContext, localComponents, tagName)
  }

  const result: SduiNodeConfig = {
    type: tagName,
    id: crypto.randomUUID(),
    props: {},
  }

  if (mapContext) {
    result.map = { js: mapContext.mapExpr }
    if (mapContext.keyExpr) result.key = mapContext.keyExpr
  }

  // Accumulate flat sx props (processed into className after all attrs scanned)
  const flatSxStatic: Record<string, unknown> = {}
  const flatSxDynamic: Record<string, unknown> = {}

  // Process attributes
  for (const attr of opening.attributes.properties) {
    // JSX spread: {...props} — extract known object literal spreads, resolve identifier spreads
    if (ts.isJsxSpreadAttribute(attr)) {
      const spreadExpr = attr.expression
      // Helper: process a parsed object literal's properties into flatSxStatic/result.props
      // using the same Tailwind alias tables as regular attribute processing.
      function applySpreadObj(objExpr: ts.ObjectLiteralExpression, getSrc: (n: ts.Node) => string) {
        for (const prop of objExpr.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue
          const k = prop.name.text
          const v = prop.initializer
          if (v.kind === ts.SyntaxKind.TrueKeyword) {
            const flatBool = FLAT_BOOL_PROPS[k]
            if (flatBool) { for (const [fk, fv] of Object.entries(flatBool)) flatSxStatic[fk] = fv }
            else { flatSxStatic[k] = true }
          } else if (v.kind === ts.SyntaxKind.FalseKeyword) {
            flatSxStatic[k] = false
          } else if (ts.isNumericLiteral(v)) {
            // size: 12 → text: 12; mb: 8 → mb: 8
            const alias = FLAT_STRING_ALIASES[k]
            flatSxStatic[alias ?? k] = Number(v.text)
          } else if (ts.isStringLiteral(v)) {
            // color: '#94a3b8' → textColor; tracking: 'widest' → tracking
            const alias = FLAT_STRING_ALIASES[k]
            const sxKey = alias ?? k
            if (SHORTHAND_KEYS.has(sxKey)) flatSxStatic[sxKey] = v.text
            else result.props[k] = v.text
          } else {
            const vText = getSrc(v)
            result.props[k] = { js: resolveExprToSdui(vText, pathToId) }
          }
        }
      }
      if (ts.isObjectLiteralExpression(spreadExpr)) {
        applySpreadObj(spreadExpr, n => nodeText(n))
      } else if (ts.isIdentifier(spreadExpr)) {
        // Identifier spread: look up in _currentPageLocals and expand as sx props
        const localVal = _currentPageLocals.get(spreadExpr.text)
        if (localVal) {
          const tmpSrc = ts.createSourceFile('__sp__.ts', `(${localVal})`, ts.ScriptTarget.Latest, true)
          const first = tmpSrc.statements[0]
          if (ts.isExpressionStatement(first)) {
            const inner = ts.isParenthesizedExpression(first.expression)
              ? first.expression.expression : first.expression
            if (ts.isObjectLiteralExpression(inner)) {
              applySpreadObj(inner, n => n.getFullText(tmpSrc).trim())
            }
          }
        }
      }
      continue
    }
    if (!ts.isJsxAttribute(attr)) continue

    const attrName = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText()
    const init = attr.initializer

    // Boolean shorthand: <Box disabled /> — also catches flat layout shorthands
    if (!init) {
      const flatBool = FLAT_BOOL_PROPS[attrName]
      if (flatBool) {
        // Merge into accumulated flat sx
        for (const [k, v] of Object.entries(flatBool)) {
          flatSxStatic[k] = v
        }
      } else if (attrName === '_popoverContent') {
        result._popoverContent = true
      } else {
        result.props[attrName] = true
      }
      continue
    }

    // String literal: src="..." name="..." etc.
    if (ts.isStringLiteral(init)) {
      // Icon: color is a direct prop passed to the CDN URL, not a CSS text-color class
      if (result.type === 'Icon' && attrName === 'color') {
        result.props.color = init.text
        continue
      }
      // Flat string prop aliases (e.g. color="red" on Text → sx.textColor)
      const flatAlias = FLAT_STRING_ALIASES[attrName]
      if (flatAlias) {
        flatSxStatic[flatAlias] = init.text
        continue
      }
      if (attrName === 'key') {
        result.key = init.text
      } else if (attrName === 'condition') {
        result.condition = { js: init.text }
      } else if (attrName === 'name') {
        result.name = init.text
      } else if (SHORTHAND_KEYS.has(attrName)) {
        // Direct sx key as flat string prop (e.g. overflow="hidden")
        flatSxStatic[attrName] = init.text
      } else {
        result.props[attrName] = init.text
      }
      continue
    }

    // JSX expression: attr={...}
    if (ts.isJsxExpression(init) && init.expression) {
      const expr = init.expression
      const exprText = nodeText(expr)

      // sx={{ ... }} — typed styling prop → props.className + props.classFormulas + props.style
      // style={{ ... }} — React-standard alias; treated identically to sx
      if ((attrName === 'sx' || attrName === 'style') && ts.isObjectLiteralExpression(expr)) {
        const { className, style, classFormulas, responsiveStyles } = parseSxProp(expr, pathToId)
        if (className) {
          result.props.className = result.props.className
            ? `${result.props.className as string} ${className}`
            : className
        }
        if (Object.keys(classFormulas).length) {
          result.props.classFormulas = { ...(result.props.classFormulas as Record<string, unknown> ?? {}), ...classFormulas }
        }
        if (Object.keys(style).length) {
          result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), ...style }
        }
        // Merge responsive overrides from static responsive shorthand values (e.g. gap: { mobile: 8 })
        if (Object.keys(responsiveStyles).length) {
          result.responsive = result.responsive ?? {}
          for (const [bp, cssObj] of Object.entries(responsiveStyles)) {
            const existing = (result.responsive[bp]?.styles ?? {}) as Record<string, unknown>
            result.responsive[bp] = { ...result.responsive[bp], styles: { ...existing, ...cssObj } }
          }
        }
        continue
      }

      // Responsive breakpoint props: md/lg/xl or legacy laptop/tablet/mobile={{ ... }} → responsive[bp].styles
      if (attrName in DSL_BP_TO_INTERNAL && ts.isObjectLiteralExpression(expr)) {
        const bp = DSL_BP_TO_INTERNAL[attrName]
        result.responsive = result.responsive ?? {}
        const bpStyles = parseBreakpointSx(expr, pathToId)
        const existing = (result.responsive[bp]?.styles ?? {}) as Record<string, unknown>
        result.responsive[bp] = { ...result.responsive[bp], styles: { ...existing, ...bpStyles } }
        continue
      }

      // animation={{ ... }}
      if (attrName === 'animation') {
        const parsed = parseAnimationProp(expr)
        if (parsed) {
          result.props.animation = parsed
          continue
        }
      }

      if (attrName === 'condition') {
        const condExpr = (ts.isArrowFunction(expr) && expr.parameters.length === 0)
          ? arrowToIife(expr)
          : exprText
        result.condition = { js: resolveExprToSdui(condExpr, pathToId) }
        continue
      }

      if (attrName === 'key') {
        result.key = resolveExprToSdui(exprText, pathToId)
        continue
      }

      // Icon: size and color are direct props (CDN URL params), not CSS aliases
      if (result.type === 'Icon' && (attrName === 'color' || attrName === 'size')) {
        if (ts.isNumericLiteral(expr)) {
          result.props[attrName] = Number(expr.text)
        } else if (ts.isStringLiteral(expr)) {
          result.props[attrName] = expr.text
        } else {
          const resolved = (ts.isArrowFunction(expr) && expr.parameters.length === 0)
            ? arrowToIife(expr)
            : exprText
          result.props[attrName] = { js: resolveExprToSdui(resolved, pathToId) }
        }
        continue
      }

      // Flat numeric/dynamic prop aliases (e.g. size={14} on Text, cols={3}, color={() => ...})
      const flatAlias = FLAT_STRING_ALIASES[attrName]
      if (flatAlias) {
        if (ts.isArrowFunction(expr) && expr.parameters.length === 0) {
          const bodyText = arrowToIife(expr)
          const resolved = resolveExprToSdui(bodyText, pathToId)
          const classWrapper = SHORTHAND_FORMULA_CLASS_MAP[flatAlias]
          if (classWrapper) {
            result.props.classFormulas = { ...(result.props.classFormulas as Record<string, unknown> ?? {}), [flatAlias]: { js: classWrapper(resolved) } }
          } else {
            const mapping = SHORTHAND_FORMULA_CSS_MAP[flatAlias]
            if (mapping) {
              const wrapped = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
              result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), [mapping.cssKey]: { js: wrapped } }
            } else {
              flatSxDynamic[flatAlias] = { js: resolved }
            }
          }
        } else if (ts.isNumericLiteral(expr)) {
          flatSxStatic[flatAlias] = Number(expr.text)
        } else if (ts.isStringLiteral(expr)) {
          flatSxStatic[flatAlias] = expr.text
        } else {
          // General expression → dynamic formula
          const resolved = unwrapArrowBody(resolveExprToSdui(exprText, pathToId))
          const classWrapper = SHORTHAND_FORMULA_CLASS_MAP[flatAlias]
          if (classWrapper) {
            result.props.classFormulas = { ...(result.props.classFormulas as Record<string, unknown> ?? {}), [flatAlias]: { js: classWrapper(resolved) } }
          } else {
            const mapping = SHORTHAND_FORMULA_CSS_MAP[flatAlias]
            if (mapping) {
              const wrapped = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
              result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), [mapping.cssKey]: { js: wrapped } }
            } else {
              flatSxDynamic[flatAlias] = { js: resolved }
            }
          }
        }
        continue
      }

      // Direct sx key as flat numeric prop (e.g. gap={12}, p={16}, radius={8})
      if (SHORTHAND_KEYS.has(attrName)) {
        if (ts.isArrowFunction(expr) && expr.parameters.length === 0) {
          const bodyText = arrowToIife(expr)
          const resolved = resolveExprToSdui(bodyText, pathToId)
          const classWrapper = SHORTHAND_FORMULA_CLASS_MAP[attrName]
          if (classWrapper) {
            result.props.classFormulas = { ...(result.props.classFormulas as Record<string, unknown> ?? {}), [attrName]: { js: classWrapper(resolved) } }
          } else {
            const mapping = SHORTHAND_FORMULA_CSS_MAP[attrName]
            if (mapping) {
              const wrapped = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
              result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), [mapping.cssKey]: { js: wrapped } }
            } else {
              flatSxDynamic[attrName] = { js: resolved }
            }
          }
        } else if (ts.isNumericLiteral(expr)) {
          flatSxStatic[attrName] = Number(expr.text)
        } else if (ts.isStringLiteral(expr)) {
          flatSxStatic[attrName] = expr.text
        } else if (expr.kind === ts.SyntaxKind.TrueKeyword) {
          flatSxStatic[attrName] = true
        } else if (expr.kind === ts.SyntaxKind.FalseKeyword) {
          flatSxStatic[attrName] = false
        } else {
          // General expression → dynamic formula
          const resolved = unwrapArrowBody(resolveExprToSdui(exprText, pathToId))
          const classWrapper = SHORTHAND_FORMULA_CLASS_MAP[attrName]
          if (classWrapper) {
            result.props.classFormulas = { ...(result.props.classFormulas as Record<string, unknown> ?? {}), [attrName]: { js: classWrapper(resolved) } }
          } else {
            const mapping = SHORTHAND_FORMULA_CSS_MAP[attrName]
            if (mapping) {
              const wrapped = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
              result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), [mapping.cssKey]: { js: wrapped } }
            } else {
              flatSxDynamic[attrName] = { js: resolved }
            }
          }
        }
        continue
      }

      // onClick/onChange/onSubmit — event factory API (run/when/seq/set) + legacy patterns
      if (attrName === 'onClick' || attrName === 'onChange' || attrName === 'onSubmit') {
        const eventTrigger = propToTrigger(attrName)

        // ── New API: run(wf, args) / when(cond, action) / seq(...) / set(var, val) ──
        if (ts.isCallExpression(expr)) {
          const action = parseActionFactory(expr, eventTrigger, pathToId)
          if (action) {
            result.actions = result.actions ?? []
            result.actions.push(action)
            continue
          }
        }

        // Pattern: onClick={triggerName} — bare identifier matching a known SC trigger
        // (used inside SC render functions: onClick={onPress} → inline action on node)
        if (ts.isIdentifier(expr)) {
          const scWfId = _scTriggerNames.get(expr.text)
          if (scWfId) {
            result.actions = result.actions ?? []
            result.actions.push(buildInlineAction(eventTrigger, scWfId))
            continue
          }
        }
        // Pattern: onClick={workflowRef} — bare identifier
        if (ts.isIdentifier(expr)) {
          const uuid = pathToId.get(expr.text) ?? pathToId.get(`workflows/${expr.text}`)
          if (uuid) {
            result.actions = result.actions ?? []
            result.actions.push(buildInlineAction(eventTrigger, uuid))
            continue
          }
        }
        // Pattern: onClick={prevMonth} — page-level const arrow (not a defineWorkflow)
        if (ts.isIdentifier(expr)) {
          const localFn = _currentPageLocalNodes.get(expr.text)
          // parseArrowAction requires an ArrowFunction or FunctionExpression body
          if (localFn && (ts.isArrowFunction(localFn) || ts.isFunctionExpression(localFn))) {
            const action = parseArrowAction(localFn, eventTrigger, pathToId)
            if (action) {
              result.actions = result.actions ?? []
              result.actions.push(action)
              continue
            }
          }
        }
        // Pattern: onClick={() => workflowRef(args)} — zero-arg arrow calling a workflow
        if (ts.isArrowFunction(expr) && expr.parameters.length === 0) {
          const action = parseArrowWorkflowCall(expr, pathToId)
          if (action) {
            result.actions = result.actions ?? []
            result.actions.push(buildInlineAction(eventTrigger, action.action, action.params))
            continue
          }
        }
        // Defensive unwrap: onClick={(()=>workflowRef(args))} — parenthesised arrow.
        // Also handles prop-substituted handlers like onClick={(()=>{var=val})} that
        // arise when a local component prop (e.g. onDec, onInc) is an arrow function.
        if (ts.isParenthesizedExpression(expr) && ts.isArrowFunction(expr.expression)
            && expr.expression.parameters.length === 0) {
          const action = parseArrowWorkflowCall(expr.expression, pathToId)
          if (action) {
            result.actions = result.actions ?? []
            result.actions.push(buildInlineAction(eventTrigger, action.action, action.params))
            continue
          }
          // Fall back to full arrow action (handles block bodies, setVar, etc.)
          const arrowAction = parseArrowAction(expr.expression, eventTrigger, pathToId)
          if (arrowAction) {
            result.actions = result.actions ?? []
            result.actions.push(arrowAction)
            continue
          }
        }
        // Natural arrow functions: e => var = e.value, () => var = val, () => { ... }
        if (ts.isArrowFunction(expr)) {
          const action = parseArrowAction(expr, eventTrigger, pathToId)
          if (action) {
            result.actions = result.actions ?? []
            result.actions.push(action)
            continue
          }
        }

        // Ternary with boolean-literal condition: cond ? arrowA : arrowB
        // Arises when a boolean prop (e.g. isFrom={true}) is substituted into a local
        // component that uses onClick={isFrom ? () => doA : () => doB}.
        // After substitution: onClick={true ? () => doA : () => doB} → select doA.
        if (ts.isConditionalExpression(expr)) {
          const ternary = expr as ts.ConditionalExpression
          const condKind = ternary.condition.kind
          const selectedBranch =
            condKind === ts.SyntaxKind.TrueKeyword  ? ternary.whenTrue  :
            condKind === ts.SyntaxKind.FalseKeyword ? ternary.whenFalse : null
          if (selectedBranch) {
            const unwrapped = ts.isParenthesizedExpression(selectedBranch)
              ? selectedBranch.expression : selectedBranch
            if (ts.isArrowFunction(unwrapped)) {
              const action = parseArrowAction(unwrapped, eventTrigger, pathToId)
              if (action) {
                result.actions = result.actions ?? []
                result.actions.push(action)
                continue
              }
            }
          }
        }
      }

      // onClick/onChange → workflow() → actions (old API)
      if ((attrName === 'onClick' || attrName === 'onChange' || attrName === 'onSubmit') && ts.isCallExpression(expr)) {
        const action = parseWorkflowCall(expr, pathToId)
        if (action) {
          const eventTrigger = propToTrigger(attrName)
          result.actions = result.actions ?? []
          result.actions.push(buildInlineAction(eventTrigger, action.action, action.params))
          continue
        }
      }

      // ── Form special props — top-level node fields, NOT inside props ────────────
      // The renderer reads _initialValue, _debounce, _controlled, _validation directly
      // from the node object; they must never land in result.props.

      if (attrName === '_initialValue') {
        if (ts.isStringLiteral(expr))              result._initialValue = expr.text
        else if (ts.isNumericLiteral(expr))        result._initialValue = Number(expr.text)
        else if (expr.kind === ts.SyntaxKind.TrueKeyword)  result._initialValue = true
        else if (expr.kind === ts.SyntaxKind.FalseKeyword) result._initialValue = false
        else if (expr.kind === ts.SyntaxKind.NullKeyword)  result._initialValue = null
        continue
      }

      if (attrName === '_debounce' && ts.isObjectLiteralExpression(expr)) {
        const obj: Record<string, unknown> = {}
        for (const prop of expr.properties) {
          if (!ts.isPropertyAssignment(prop)) continue
          const key = ts.isIdentifier(prop.name) ? prop.name.text : null
          if (!key) continue
          const val = prop.initializer
          if (val.kind === ts.SyntaxKind.TrueKeyword)       obj[key] = true
          else if (val.kind === ts.SyntaxKind.FalseKeyword) obj[key] = false
          else if (ts.isNumericLiteral(val))                obj[key] = Number(val.text)
        }
        result._debounce = obj
        continue
      }

      if (attrName === '_controlled') {
        if (ts.isObjectLiteralExpression(expr)) {
          const obj: Record<string, unknown> = {}
          for (const prop of expr.properties) {
            if (!ts.isPropertyAssignment(prop)) continue
            const key = ts.isIdentifier(prop.name) ? prop.name.text : null
            if (key && ts.isStringLiteral(prop.initializer)) obj[key] = prop.initializer.text
          }
          result._controlled = obj
        }
        continue
      }

      if (attrName === '_validation') {
        if (ts.isArrayLiteralExpression(expr)) {
          result._validation = parseValidationRules(expr)
        } else if (ts.isObjectLiteralExpression(expr)) {
          result._validation = parseValidationObject(expr)
        }
        continue
      }

      if (attrName === 'popover' && ts.isObjectLiteralExpression(expr)) {
        result.popover = parsePopoverConfig(expr)
        continue
      }

      if (attrName === '_popoverContent') {
        // Value form: _popoverContent={true} / _popoverContent={false}
        if (expr.kind === ts.SyntaxKind.TrueKeyword)  { result._popoverContent = true; continue }
        if (expr.kind === ts.SyntaxKind.FalseKeyword) { continue } // false = don't set
      }

      // Generic expression prop.
      // Unwrap parentheses so that `(() => expr)` (produced by inlineLocalComponent when a
      // zero-arg arrow-function prop is substituted) is recognised as an ArrowFunction and
      // converted to its body via arrowToIife — giving `(expr)` instead of the unevaluated
      // function reference `(() => expr)`.
      let unwrappedExpr: ts.Expression = expr
      while (ts.isParenthesizedExpression(unwrappedExpr))
        unwrappedExpr = unwrappedExpr.expression
      const genericExpr = (ts.isArrowFunction(unwrappedExpr) && unwrappedExpr.parameters.length === 0)
        ? arrowToIife(unwrappedExpr)
        : exprText
      result.props[attrName] = { js: resolveExprToSdui(genericExpr, pathToId) }
    }
  }

  // Apply accumulated flat sx props
  if (Object.keys(flatSxStatic).length || Object.keys(flatSxDynamic).length) {
    const fakeExpr = { ...flatSxStatic }
    const { className, responsiveStyles } = resolveStyleParams(fakeExpr)
    if (className) result.props.className = [result.props.className, className].filter(Boolean).join(' ')
    if (Object.keys(responsiveStyles).length) {
      result.responsive = result.responsive ?? {}
      for (const [bp, cssObj] of Object.entries(responsiveStyles)) {
        const existing = (result.responsive[bp]?.styles ?? {}) as Record<string, unknown>
        result.responsive[bp] = { ...result.responsive[bp], styles: { ...existing, ...cssObj } }
      }
    }
    if (Object.keys(flatSxDynamic).length) {
      result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), ...flatSxDynamic }
    }
  }

  // Process children
  if (ts.isJsxElement(jsxNode)) {
    result.children = processJsxChildren(jsxNode.children, pathToId, relSrc, localComponents)
  }

  // Extract text content for Text nodes at any nesting depth
  postProcess(result, jsxNode, pathToId)

  return result
}

// ─── Process JSX children ─────────────────────────────────────────────────────

function processJsxChildren(
  children: ts.NodeArray<ts.JsxChild>,
  pathToId: Map<string, string>,
  relSrc: string,
  localComponents?: Map<string, LocalComponentDef>,
): SduiNodeConfig[] {
  const nodes: SduiNodeConfig[] = []

  for (const child of children) {
    const childNode = processJsxChild(child, pathToId, relSrc, localComponents)
    if (childNode) {
      if (Array.isArray(childNode)) nodes.push(...childNode)
      else nodes.push(childNode)
    }
  }

  return nodes
}

function processJsxChild(
  child: ts.JsxChild,
  pathToId: Map<string, string>,
  relSrc: string,
  localComponents?: Map<string, LocalComponentDef>,
): SduiNodeConfig | SduiNodeConfig[] | null {
  // Text content
  if (ts.isJsxText(child)) {
    const text = child.text.trim()
    if (!text) return null
    return {
      type: 'Text',
      id: crypto.randomUUID(),
      props: {},
      text,
    }
  }

  // <Element> or <Element />
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
    // Inline local function components before falling through to standard conversion
    const tagName = ts.isJsxElement(child)
      ? child.openingElement.tagName.getText().trim()
      : child.tagName.getText().trim()
    if (localComponents?.has(tagName)) {
      return inlineLocalComponent(child, localComponents.get(tagName)!, pathToId, relSrc, localComponents)
    }
    return convertJsxElement(child, pathToId, relSrc, undefined, localComponents)
  }

  // <> ... </> Fragment
  if (ts.isJsxFragment(child)) {
    return processJsxChildren(child.children, pathToId, relSrc, localComponents)
  }

  // {expression}
  if (ts.isJsxExpression(child) && child.expression) {
    return processJsxExpression(child.expression, pathToId, relSrc, localComponents)
  }

  return null
}

function processJsxExpression(
  expr: ts.Expression,
  pathToId: Map<string, string>,
  relSrc: string,
  localComponents?: Map<string, LocalComponentDef>,
): SduiNodeConfig | SduiNodeConfig[] | null {
  // () => <expr> — strip zero-param arrow wrapper used for lazy/reactive JSX children
  if (ts.isArrowFunction(expr) && expr.parameters.length === 0) {
    const body = expr.body
    if (ts.isParenthesizedExpression(body)) {
      return processJsxExpression(body.expression, pathToId, relSrc, localComponents)
    }
    if (ts.isExpression(body)) {
      return processJsxExpression(body, pathToId, relSrc, localComponents)
    }
    // () => { const x = init; return expr } — block body: inline const locals, then process
    if (ts.isBlock(body)) {
      const locals = new Map<string, string>()
      let returnExpr: ts.Expression | null = null
      for (const stmt of body.statements) {
        if (
          ts.isVariableStatement(stmt) &&
          (stmt.declarationList.flags & ts.NodeFlags.Const)
        ) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.initializer) {
              locals.set(decl.name.text, nodeText(decl.initializer))
            }
          }
        } else if (ts.isReturnStatement(stmt) && stmt.expression) {
          returnExpr = stmt.expression
        }
      }
      if (returnExpr) {
        let retText = nodeText(returnExpr)
        // Run substitution rounds until stable so that transitive references are
        // resolved. Example: `const fd = local.form.formData; const ready = fd.x`
        // — first round expands `ready` to `fd.x`; second round replaces the `fd`
        // that was introduced by expanding `ready`. Circular const refs are
        // impossible in valid TypeScript so this always terminates.
        let prevText: string
        do {
          prevText = retText
          for (const [localName, localValue] of locals) {
            retText = replaceIdentInCode(retText, localName, `(${localValue})`, true)
          }
        } while (retText !== prevText)
        const fakeSrc = `const __r = ${retText}`
        const tmpSf = ts.createSourceFile('__blk.tsx', fakeSrc, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
        let retNode: ts.Expression | null = null
        const findInit = (n: ts.Node): void => {
          if (!retNode && ts.isVariableDeclaration(n) && n.initializer) {
            retNode = n.initializer
            return
          }
          ts.forEachChild(n, findInit)
        }
        findInit(tmpSf)
        if (retNode) return processJsxExpression(retNode, pathToId, relSrc, localComponents)
      }
    }
  }

  // (() => expr) — parenthesised arrow produced by inlineLocalComponent when a prop that
  // was passed as `() => someExpr` gets wrapped in parens before text-substitution into
  // the component body.  Unwrap the outer parens so the ArrowFunction branch above fires.
  if (ts.isParenthesizedExpression(expr)) {
    return processJsxExpression(expr.expression, pathToId, relSrc, localComponents)
  }

  // arr.map(item => <Box>...)
  if (ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === 'map') {
    return processMapCall(expr, pathToId, relSrc, localComponents)
  }

  // Local JSX factory call: {FilterBtn('All', 'all')} where FilterBtn is a page-level const
  // arrow/function-declaration returning JSX. Inline the call by AST-substituting params →
  // arg texts using substituteIdentifiers (which correctly skips JSX attribute names),
  // re-parsing the substituted JSX, and compiling the result.
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    const factoryFn = _currentPageLocalNodes.get(expr.expression.text)
    if (factoryFn) {
      const paramNames = factoryFn.parameters
        .map(p => (ts.isIdentifier(p.name) ? p.name.text : ''))
        .filter(Boolean)
      const argTexts = Array.from(expr.arguments).map(a => nodeText(a))
      if (paramNames.length === argTexts.length) {
        // For block-body functions (function declarations and block-body arrows),
        // extract the JSX text from the return statement rather than using the whole
        // block `{ return (<JSX>) }` — which TypeScript would misparse as an object literal.
        let bodyText: string
        if (ts.isBlock(factoryFn.body)) {
          const jsxRoot = findJsxRoot(factoryFn.body)
          bodyText = jsxRoot ? nodeText(jsxRoot) : nodeText(factoryFn.body)
        } else {
          bodyText = nodeText(factoryFn.body as ts.Expression)
        }
        // Build param→arg map and use AST-aware substituteIdentifiers so that
        // JSX attribute names (e.g. `onClick` in `onClick={onClick}`) are skipped
        // and only the VALUE identifiers are replaced.
        const paramValues = new Map<string, string>()
        for (let i = 0; i < paramNames.length; i++) {
          paramValues.set(paramNames[i], argTexts[i])
        }
        bodyText = substituteIdentifiers(bodyText, paramValues)
        // Re-parse the substituted JSX body as TSX to get a fresh AST
        const fakeSrc = `const __r = ${bodyText}`
        const tmpSf = ts.createSourceFile('__inline.tsx', fakeSrc, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
        let inlinedJsx: ts.JsxElement | ts.JsxSelfClosingElement | null = null
        const findInlined = (n: ts.Node): void => {
          if (!inlinedJsx && (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n))) {
            inlinedJsx = n as ts.JsxElement | ts.JsxSelfClosingElement
            return
          }
          ts.forEachChild(n, findInlined)
        }
        findInlined(tmpSf)
        if (inlinedJsx) {
          return convertJsxElement(inlinedJsx, pathToId, relSrc, undefined, localComponents)
        }
      }
    }
  }

  // condition && <Box>  (or condition && (<Box/>))  or  condition && arr.map(...)
  if (ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const conditionText = resolveExprToSdui(nodeText(expr.left), pathToId)
    // Unwrap parentheses around the RHS
    let rhs: ts.Expression = expr.right
    while (ts.isParenthesizedExpression(rhs)) rhs = rhs.expression
    if (ts.isJsxElement(rhs) || ts.isJsxSelfClosingElement(rhs)) {
      const node = convertJsxElement(rhs, pathToId, relSrc, undefined, localComponents)
      node.condition = { js: conditionText }
      return node
    }
    // Also handle map calls, ternaries, etc. on the RHS (e.g. condition && arr.map(...))
    const rhsResult = processJsxExpression(rhs, pathToId, relSrc, localComponents)
    if (rhsResult && !Array.isArray(rhsResult) && ('map' in rhsResult || 'children' in rhsResult)) {
      // Merge with any existing per-item condition (e.g. inner && set by processMapCall)
      // rather than overwriting it — both conditions must hold simultaneously.
      const existingCond = (rhsResult.condition as { js: string } | undefined)?.js
      if (existingCond) {
        rhsResult.condition = { js: `(${conditionText}) && (${existingCond})` }
      } else {
        rhsResult.condition = { js: conditionText }
      }
      return rhsResult
    }
    if (Array.isArray(rhsResult) && rhsResult.length > 0) {
      for (const n of rhsResult) { if (!n.condition) n.condition = { js: conditionText } }
      return rhsResult
    }
  }

  // condition ? <A> : <B>
  if (ts.isConditionalExpression(expr)) {
    const condition = resolveExprToSdui(nodeText(expr.condition), pathToId)
    // Unwrap parenthesized arms — AI often writes `cond ? (<Box/>) : (<Box/>)`
    const unwrapJsx = (e: ts.Expression): ts.JsxElement | ts.JsxSelfClosingElement | null => {
      if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e)) return e
      if (ts.isParenthesizedExpression(e)) return unwrapJsx(e.expression)
      return null
    }
    const trueJsx = unwrapJsx(expr.whenTrue)
    const falseJsx = unwrapJsx(expr.whenFalse)

    const trueNode = trueJsx ? convertJsxElement(trueJsx, pathToId, relSrc, undefined, localComponents) : null
    const falseNode = falseJsx ? convertJsxElement(falseJsx, pathToId, relSrc, undefined, localComponents) : null

    // Negate a condition string without creating double-negations
    const negateCondition = (cond: string): string => {
      if (cond.startsWith('!(') && cond.endsWith(')')) return cond.slice(2, -1)  // !(expr) → expr
      if (/^![^(]/.test(cond)) return cond.slice(1)                               // !expr  → expr
      return `!(${cond})`
    }

    const results: SduiNodeConfig[] = []
    if (trueNode) { trueNode.condition = { js: condition }; results.push(trueNode) }

    if (falseNode) {
      // Simple case: false branch is a JSX element
      falseNode.condition = { js: negateCondition(condition) }
      results.push(falseNode)
    } else {
      // The false branch may be a chained ternary (A ? B : C ? D : E).
      // Unwrap parentheses, recursively expand, and prepend !(outerCond) to
      // each returned node's condition so all three branches become siblings.
      let falseExpr: ts.Expression = expr.whenFalse
      while (ts.isParenthesizedExpression(falseExpr)) falseExpr = (falseExpr as ts.ParenthesizedExpression).expression
      const outer = negateCondition(condition)
      const innerResult = processJsxExpression(falseExpr, pathToId, relSrc, localComponents)
      if (innerResult) {
        const nodes = Array.isArray(innerResult) ? innerResult : [innerResult as SduiNodeConfig]
        for (const n of nodes) {
          const sn = n as SduiNodeConfig
          if (sn.condition && typeof sn.condition === 'object' && 'js' in (sn.condition as object)) {
            sn.condition = { js: `${outer} && (${(sn.condition as { js: string }).js})` }
          } else {
            sn.condition = { js: outer }
          }
          results.push(sn)
        }
      }
    }

    return results.length > 0 ? results : null
  }

  // Parenthesized expression
  if (ts.isParenthesizedExpression(expr)) {
    return processJsxExpression(expr.expression, pathToId, relSrc, localComponents)
  }

  // Raw JSX inside expression
  if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)) {
    return convertJsxElement(expr, pathToId, relSrc, undefined, localComponents)
  }

  // JSX fragment
  if (ts.isJsxFragment(expr)) {
    return processJsxChildren(expr.children, pathToId, relSrc, localComponents)
  }

  // Value expression children: {count}, {'text'}, {items.length}, {ok ? 'Yes' : 'No'}
  // Emit as inline Text nodes with the expression as a formula.
  // This handles: numeric literals, string literals, template literals, ternaries/binary ops on values.
  if (
    ts.isNumericLiteral(expr) ||
    ts.isStringLiteral(expr) ||
    ts.isTemplateExpression(expr) ||
    ts.isNoSubstitutionTemplateLiteral(expr) ||
    ts.isConditionalExpression(expr) ||
    ts.isBinaryExpression(expr) ||
    ts.isPropertyAccessExpression(expr) ||
    ts.isElementAccessExpression(expr) ||
    ts.isCallExpression(expr) ||
    ts.isIdentifier(expr)
  ) {
    let textValue: unknown
    if (ts.isNumericLiteral(expr)) {
      textValue = Number(expr.text)
    } else if (ts.isStringLiteral(expr)) {
      textValue = expr.text
    } else {
      // Dynamic: wrap as formula
      const resolved = resolveExprToSdui(nodeText(expr), pathToId)
      textValue = { js: resolved }
    }
    return {
      type: 'Text',
      id: crypto.randomUUID(),
      props: {},
      text: textValue,
    }
  }

  return null
}

/**
 * For inline array literals used as map sources, strip zero-arg arrow wrappers from
 * object property values before building the reactive formula string.
 * `{ value: () => expr }` → `{ value: expr }`
 * This is safe because the entire map source is already a reactive {js} formula that
 * re-evaluates when variables change, so wrapping values in arrows gains nothing and
 * causes the renderer to receive a function reference instead of a computed value.
 */
function resolveInlineArrayMapSource(
  arrayExpr: ts.ArrayLiteralExpression,
  pathToId: Map<string, string>,
): string {
  const srcFile = arrayExpr.getSourceFile()
  const srcText = srcFile.getText()
  const arrStart = arrayExpr.getStart()
  const arrEnd = arrayExpr.getEnd()
  const subs: Array<[number, number, string]> = []

  function visit(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isArrowFunction(node.initializer) &&
      node.initializer.parameters.length === 0 &&
      !ts.isBlock(node.initializer.body)
    ) {
      const arrowFn = node.initializer
      const bodyText = (arrowFn.body as ts.Expression).getText()
      subs.push([arrowFn.getStart(), arrowFn.getEnd(), bodyText])
      return  // don't recurse into the arrow body
    }
    ts.forEachChild(node, visit)
  }

  visit(arrayExpr)

  subs.sort((a, b) => b[0] - a[0])
  let result = srcText.slice(arrStart, arrEnd)
  for (const [s, e, repl] of subs) {
    result = result.slice(0, s - arrStart) + repl + result.slice(e - arrStart)
  }

  return resolveExprToSdui(result, pathToId)
}

function processMapCall(
  call: ts.CallExpression,
  pathToId: Map<string, string>,
  relSrc: string,
  localComponents?: Map<string, LocalComponentDef>,
): SduiNodeConfig | null {
  const arrayExpr = (call.expression as ts.PropertyAccessExpression).expression
  const mapExpr = ts.isArrayLiteralExpression(arrayExpr)
    ? resolveInlineArrayMapSource(arrayExpr as ts.ArrayLiteralExpression, pathToId)
    : resolveExprToSdui(nodeText(arrayExpr), pathToId)

  const cbArg = call.arguments[0]
  if (!cbArg || (!ts.isArrowFunction(cbArg) && !ts.isFunctionExpression(cbArg))) return null

  // Extract the callback parameter names (e.g. `item, i` in `.map((item, i) => ...)`)
  // so we can rewrite `item.field` → `context.item.field` and `i` → `context.item.index`.
  const callbackParam =
    cbArg.parameters.length > 0 && ts.isIdentifier(cbArg.parameters[0].name)
      ? cbArg.parameters[0].name.text
      : undefined
  const indexParam =
    cbArg.parameters.length > 1 && ts.isIdentifier(cbArg.parameters[1].name)
      ? cbArg.parameters[1].name.text
      : undefined

  // ─── Ternary callback: (item) => condition ? <TrueJsx> : <FalseJsx> ──────────
  // When the map callback returns a ternary of two JSX branches, compile BOTH with
  // opposite conditions inside a transparent container. This preserves onClick
  // handlers (and all other attributes) in the false branch.
  {
    const unwrapExpr = (n: ts.Node): ts.Node => {
      while (ts.isParenthesizedExpression(n as ts.Expression))
        n = (n as ts.ParenthesizedExpression).expression
      return n
    }
    let bodyNode: ts.Node = unwrapExpr(cbArg.body)
    if (ts.isBlock(bodyNode)) {
      for (const stmt of (bodyNode as ts.Block).statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression) {
          bodyNode = unwrapExpr(stmt.expression)
          break
        }
      }
    }
    if (ts.isConditionalExpression(bodyNode)) {
      // ── Flatten nested ternaries: A ? X : B ? Y : Z  →  [{cond:A,jsx:X}, {cond:B,jsx:Y}, {cond:null,jsx:Z}]
      const unwrapJsx = (e: ts.Expression): ts.JsxElement | ts.JsxSelfClosingElement | null => {
        if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e)) return e
        if (ts.isParenthesizedExpression(e)) return unwrapJsx(e.expression)
        return null
      }
      type TernaryBranch = { condition: ts.Expression | null; jsx: ts.JsxElement | ts.JsxSelfClosingElement }
      const flattenTernary = (expr: ts.Expression): TernaryBranch[] | null => {
        const unwrap = (e: ts.Expression): ts.Expression => {
          while (ts.isParenthesizedExpression(e)) e = e.expression
          return e
        }
        const branches: TernaryBranch[] = []
        let cur: ts.Expression = unwrap(expr)
        while (ts.isConditionalExpression(cur)) {
          const t = cur as ts.ConditionalExpression
          const trueJsx = unwrapJsx(t.whenTrue)
          if (!trueJsx) return null
          branches.push({ condition: t.condition, jsx: trueJsx })
          cur = unwrap(t.whenFalse)
        }
        const elseJsx = unwrapJsx(cur)
        if (!elseJsx) return null
        branches.push({ condition: null, jsx: elseJsx })
        return branches.length >= 2 ? branches : null
      }

      const branches = flattenTernary(bodyNode as ts.Expression)
      if (branches) {
        // Extract key from the first (true) branch, resolving param names to context paths
        let ternaryKeyExpr: string | undefined
        const firstOpening = ts.isJsxElement(branches[0].jsx) ? branches[0].jsx.openingElement : branches[0].jsx
        for (const attr of firstOpening.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name) || attr.name.text !== 'key') continue
          if (attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression)
            ternaryKeyExpr = resolveExprToSdui(nodeText(attr.initializer.expression), pathToId)
          else if (attr.initializer && ts.isStringLiteral(attr.initializer))
            ternaryKeyExpr = attr.initializer.text
          break
        }
        // Rewrite callback/index param names in the key expression
        if (ternaryKeyExpr && callbackParam)
          ternaryKeyExpr = replaceIdentInCode(ternaryKeyExpr, callbackParam, 'context.item.data')
        if (ternaryKeyExpr && indexParam)
          ternaryKeyExpr = replaceIdentInCode(ternaryKeyExpr, indexParam, 'context.item.index')

        // Collect block-local consts declared before the return ternary
        const callbackLocals = new Map<string, string>()
        if (ts.isBlock(cbArg.body)) {
          for (const stmt of (cbArg.body as ts.Block).statements) {
            if (!ts.isVariableStatement(stmt)) continue
            for (const decl of stmt.declarationList.declarations) {
              if (ts.isIdentifier(decl.name) && decl.initializer)
                callbackLocals.set(decl.name.text, nodeText(decl.initializer))
            }
          }
        }

        const prevMapParam            = _currentMapParam
        const prevMapIndexParam       = _currentMapIndexParam
        const prevParentMapParam      = _parentMapParam
        const prevParentMapIndexParam = _parentMapIndexParam
        _parentMapParam      = _currentMapParam
        _parentMapIndexParam = _currentMapIndexParam
        if (callbackParam) _currentMapParam      = callbackParam
        if (indexParam)    _currentMapIndexParam = indexParam

        // Compile all branches (map/key omitted — container carries them)
        _mapCallbackLocalsStack.push({ locals: callbackLocals, paramName: callbackParam, indexParamName: indexParam })
        const compiled = branches.map(b => convertJsxElement(b.jsx, pathToId, relSrc, undefined, localComponents))
        _mapCallbackLocalsStack.pop()

        _currentMapParam      = prevMapParam
        _currentMapIndexParam = prevMapIndexParam
        _parentMapParam      = prevParentMapParam
        _parentMapIndexParam = prevParentMapIndexParam

        if (compiled.every(Boolean)) {
          const rewriteCond = (raw: string): string => {
            if (!callbackParam) return raw
            let s = raw.replace(new RegExp(`\\b${callbackParam}\\.`, 'g'), 'context.item.data.')
            return replaceIdentInCode(s, callbackParam, 'context.item.data')
          }
          const negateCondition = (cond: string): string => {
            if (cond.startsWith('!(') && cond.endsWith(')')) return cond.slice(2, -1)
            if (/^![^(]/.test(cond)) return cond.slice(1)
            return `!(${cond})`
          }

          // Build mutually-exclusive conditions:
          // branch[0]: cond_0
          // branch[1]: !(cond_0) && cond_1
          // branch[N] (else, condition===null): !(cond_0) && !(cond_1) && …
          const negatedSoFar: string[] = []
          const rewritten: SduiNodeConfig[] = []
          for (let i = 0; i < branches.length; i++) {
            const node = compiled[i]!
            const rawCond = branches[i].condition
            let branchCond: string
            if (rawCond === null) {
              // else branch: all prior conditions negated
              branchCond = negatedSoFar.join(' && ')
            } else {
              const resolvedCond = rewriteCond(resolveExprToSdui(nodeText(rawCond), pathToId))
              branchCond = negatedSoFar.length > 0
                ? `${negatedSoFar.join(' && ')} && ${resolvedCond}`
                : resolvedCond
              negatedSoFar.push(negateCondition(rewriteCond(resolveExprToSdui(nodeText(rawCond), pathToId))))
            }
            node.condition = { js: branchCond }
            rewritten.push(node)
          }

          const container: SduiNodeConfig = {
            type:     'Box',
            id:       crypto.randomUUID(),
            props:    {},
            map:      { js: mapExpr },
            children: rewritten,
            actions:  [],
          }
          if (ternaryKeyExpr) container.key = ternaryKeyExpr
          return container
        }
      }
    }
  }
  // ─── End ternary callback handling ────────────────────────────────────────────

  // ─── AND callback: (item) => condition && <JSX> ───────────────────────────────
  // When the map callback returns `condition && <JSX>`, compile the JSX and attach
  // the condition.  This covers patterns like:
  //   activeTab === tabKey && (<Box>...</Box>)
  // The condition is resolved via resolveExprToSdui which calls lowerExpression,
  // converting any callback-param references (e.g. `tabKey`) to `context.item.data`.
  {
    const unwrapExpr = (n: ts.Node): ts.Node => {
      while (ts.isParenthesizedExpression(n as ts.Expression))
        n = (n as ts.ParenthesizedExpression).expression
      return n
    }
    let bodyNode: ts.Node = unwrapExpr(cbArg.body)
    if (ts.isBlock(bodyNode)) {
      for (const stmt of (bodyNode as ts.Block).statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression) {
          bodyNode = unwrapExpr(stmt.expression)
          break
        }
      }
    }
    if (
      ts.isBinaryExpression(bodyNode) &&
      (bodyNode as ts.BinaryExpression).operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      let rhs: ts.Expression = (bodyNode as ts.BinaryExpression).right
      while (ts.isParenthesizedExpression(rhs)) rhs = rhs.expression
      if (ts.isJsxElement(rhs) || ts.isJsxSelfClosingElement(rhs)) {
        const condText = resolveExprToSdui(nodeText((bodyNode as ts.BinaryExpression).left), pathToId)
        // Extract key from the JSX element
        let andKeyExpr: string | undefined
        const opening = ts.isJsxElement(rhs) ? rhs.openingElement : rhs
        for (const attr of opening.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name) || attr.name.text !== 'key') continue
          if (attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression)
            andKeyExpr = resolveExprToSdui(nodeText(attr.initializer.expression), pathToId)
          else if (attr.initializer && ts.isStringLiteral(attr.initializer))
            andKeyExpr = attr.initializer.text
          break
        }
        const prevMapParam      = _currentMapParam
        const prevMapIndexParam = _currentMapIndexParam
        const prevParentMapParam      = _parentMapParam
        const prevParentMapIndexParam = _parentMapIndexParam
        _parentMapParam      = _currentMapParam
        _parentMapIndexParam = _currentMapIndexParam
        if (callbackParam) _currentMapParam      = callbackParam
        if (indexParam)    _currentMapIndexParam = indexParam
        const compiled = convertJsxElement(rhs, pathToId, relSrc, { mapExpr, keyExpr: andKeyExpr }, localComponents)
        _currentMapParam      = prevMapParam
        _currentMapIndexParam = prevMapIndexParam
        _parentMapParam      = prevParentMapParam
        _parentMapIndexParam = prevParentMapIndexParam
        if (compiled) {
          compiled.condition = { js: condText }
          return compiled
        }
      }
    }
  }
  // ─── End AND callback handling ────────────────────────────────────────────────

  // Find the JSX return inside the callback
  let innerJsx: ts.JsxElement | ts.JsxSelfClosingElement | null = null
  let keyExpr: string | undefined

  function findJsx(n: ts.Node) {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      if (!innerJsx) innerJsx = n
    }
    ts.forEachChild(n, findJsx)
  }
  findJsx(cbArg.body)

  if (!innerJsx) return null

  // Collect const declarations from the callback block body so they can be inlined
  // into formulas that reference them (e.g. `const isToday = day.X === Y`).
  const callbackLocals = new Map<string, string>()
  if (ts.isBlock(cbArg.body)) {
    for (const stmt of cbArg.body.statements) {
      if (!ts.isVariableStatement(stmt)) continue
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer)
          callbackLocals.set(decl.name.text, nodeText(decl.initializer))
      }
    }
  }

  // Extract key={...} from the inner JSX
  const opening = ts.isJsxElement(innerJsx) ? innerJsx.openingElement : innerJsx
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue
    if (!ts.isIdentifier(attr.name) || attr.name.text !== 'key') continue
    if (attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      keyExpr = resolveExprToSdui(nodeText(attr.initializer.expression), pathToId)
    } else if (attr.initializer && ts.isStringLiteral(attr.initializer)) {
      keyExpr = attr.initializer.text
    }
    break
  }

  const prevMapParam = _currentMapParam
  const prevMapIndexParam = _currentMapIndexParam
  const prevParentMapParam = _parentMapParam
  const prevParentMapIndexParam = _parentMapIndexParam
  _parentMapParam = _currentMapParam
  _parentMapIndexParam = _currentMapIndexParam
  if (callbackParam) _currentMapParam = callbackParam
  if (indexParam) _currentMapIndexParam = indexParam
  // Expose this map's block-body locals so inner-map onClick handlers (parseArrowAction)
  // can inline calls like `choose(i)` from the outer map's callback block body.
  _mapCallbackLocalsStack.push({ locals: callbackLocals, paramName: callbackParam, indexParamName: indexParam })
  const compiled = convertJsxElement(innerJsx, pathToId, relSrc, { mapExpr, keyExpr }, localComponents)
  _mapCallbackLocalsStack.pop()
  _currentMapParam = prevMapParam
  _currentMapIndexParam = prevMapIndexParam
  _parentMapParam = prevParentMapParam
  _parentMapIndexParam = prevParentMapIndexParam
  if (!compiled || !callbackParam) return compiled
  return compiled
}

// ─── Extract text content from a JSX element ─────────────────────────────────

function extractTextContent(
  jsxEl: ts.JsxElement | ts.JsxSelfClosingElement,
  pathToId: Map<string, string>,
): unknown | undefined {
  if (!ts.isJsxElement(jsxEl)) return undefined

  const textChildren = jsxEl.children.filter(c => !ts.isJsxText(c) || c.text.trim())
  if (textChildren.length === 0) return undefined

  // Single expression child: <Text>{expr}</Text>
  if (textChildren.length === 1 && ts.isJsxExpression(textChildren[0])) {
    let expr = textChildren[0].expression
    if (!expr) return undefined
    // String literals inside JSX expressions: <Text>{"hello"}</Text> → "hello"
    if (ts.isStringLiteral(expr)) return expr.text
    // Unwrap parentheses: (() => expr) produced by inlineLocalComponent when a zero-arg
    // arrow prop is substituted into the component body as a text child.
    while (ts.isParenthesizedExpression(expr)) expr = expr.expression
    // Arrow function: {() => expr} — strip the () => wrapper so the formula evaluator
    // receives the inner expression directly (not a function object).
    if (ts.isArrowFunction(expr) && expr.parameters.length === 0) {
      const body = ts.isBlock(expr.body)
        ? `(${nodeText(expr)})()`  // block-body: wrap as IIFE
        : nodeText(expr.body as ts.Expression)  // concise body: just the expression
      return { js: resolveExprToSdui(body, pathToId) }
    }
    // All other single expressions → { js } so the JS evaluator handles them.
    return { js: resolveExprToSdui(nodeText(expr), pathToId) }
  }

  // Single text literal: <Text>Hello</Text>
  if (textChildren.length === 1 && ts.isJsxText(textChildren[0])) {
    const t = textChildren[0].text.trim()
    return t || undefined
  }

  // Mixed: build a JS string-concatenation expression emitted as {js: "..."}
  // e.g. <Text>Hello {name}!</Text> → { js: "'Hello ' + variables['uuid'] + '!'" }
  const jsParts: string[] = []
  for (const c of textChildren) {
    if (ts.isJsxText(c)) {
      // JSX whitespace normalization:
      // - Strip indentation noise (whitespace around newlines) so multiline
      //   JSX formatting doesn't inject literal newline text.
      // - Preserve a single space adjacent to expressions on the same line
      //   (e.g. `{expr} pts` — the leading " pts" space is a word separator).
      // - Skip text nodes that are entirely whitespace containing newlines.
      const t = c.text
        .replace(/[ \t]*\n[ \t]*/g, '\n')   // collapse whitespace around each newline
        .replace(/^\n+/, '')                 // strip leading newlines
        .replace(/\n+$/, '')                 // strip trailing newlines
        .replace(/\n+/g, ' ')               // remaining internal newlines → single space
        .replace(/ {2,}/g, ' ')             // collapse multiple spaces to one
      if (t.trim()) jsParts.push(JSON.stringify(t))
    } else if (ts.isJsxExpression(c) && c.expression) {
      let expr: ts.Expression = c.expression
      // Unwrap (() => body) from inlineLocalComponent prop substitution
      while (ts.isParenthesizedExpression(expr)) expr = expr.expression
      let exprText: string
      if (ts.isArrowFunction(expr) && expr.parameters.length === 0) {
        exprText = ts.isBlock(expr.body)
          ? `(${nodeText(expr)})()`
          : nodeText(expr.body as ts.Expression)
      } else {
        exprText = nodeText(expr)
      }
      const resolved = resolveExprToSdui(exprText, pathToId)
      jsParts.push(`(${resolved})`)
    }
  }
  return { js: jsParts.join(' + ') }
}

// ─── Post-process node: extract text from Text nodes ─────────────────────────

function postProcess(
  node: SduiNodeConfig,
  jsxEl: ts.JsxElement | ts.JsxSelfClosingElement,
  pathToId: Map<string, string>,
): void {
  if (node.type === 'Text') {
    const text = extractTextContent(jsxEl, pathToId)
    if (text !== undefined) {
      node.text = text
      // Text elements don't have children in SDUI
      delete node.children
    }
  }
}

// ─── Find JSX in a JSX element, then post-process ────────────────────────────

function convertAndPostProcess(
  jsxNode: ts.JsxElement | ts.JsxSelfClosingElement,
  pathToId: Map<string, string>,
  relSrc: string,
  mapContext?: { mapExpr: string; keyExpr?: string },
  localComponents?: Map<string, LocalComponentDef>,
): SduiNodeConfig {
  // postProcess is now called inside convertJsxElement after children are processed,
  // so all Text nodes at any depth get their text extracted automatically.
  return convertJsxElement(jsxNode, pathToId, relSrc, mapContext, localComponents)
}

// ─── Find JSX root in a function body ────────────────────────────────────────

function findJsxRoot(node: ts.Node): ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    return node
  }
  if (ts.isParenthesizedExpression(node)) {
    return findJsxRoot(node.expression)
  }
  if (ts.isReturnStatement(node) && node.expression) {
    return findJsxRoot(node.expression)
  }
  if (ts.isBlock(node)) {
    // Only look in return statements — skip variable declarations (their arrow-function
    // bodies may contain JSX helper components that are NOT the page root).
    for (const stmt of node.statements) {
      if (ts.isReturnStatement(stmt)) {
        const found = findJsxRoot(stmt)
        if (found) return found
      }
    }
  }
  let found: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null = null
  ts.forEachChild(node, child => {
    if (!found) found = findJsxRoot(child)
  })
  return found
}

// ─── Local component inlining ─────────────────────────────────────────────────

interface LocalComponentDef {
  /** param name → default value source text (empty when no default) */
  paramDefaults: Map<string, string>
  /** local const name → expression source text (for inlining into JSX) */
  localConsts: Map<string, string>
  /** raw source text of the JSX the component returns */
  bodyText: string
}

/** True if name starts with an uppercase letter (React component convention). */
function isComponentName(name: string): boolean {
  return name.length > 0 && name[0] >= 'A' && name[0] <= 'Z'
}

/**
 * Scan a source file for locally-defined function components (uppercase names)
 * and return a map of component name → body info for inlining.
 * Only top-level declarations are collected (not nested functions).
 */
function collectLocalComponents(sf: ts.SourceFile, extraBlock?: ts.Block): Map<string, LocalComponentDef> {
  const result = new Map<string, LocalComponentDef>()
  const src = sf.getFullText()

  function extractDef(fn: ts.FunctionLikeDeclaration): LocalComponentDef | null {
    const paramDefaults = new Map<string, string>()
    for (const param of fn.parameters) {
      if (ts.isObjectBindingPattern(param.name)) {
        for (const el of param.name.elements) {
          if (!ts.isBindingElement(el)) continue
          const name = ts.isIdentifier(el.name) ? el.name.text : null
          if (!name) continue
          const def = el.initializer
            ? src.slice(el.initializer.getStart(), el.initializer.getEnd()).trim()
            : ''
          paramDefaults.set(name, def)
        }
      }
    }
    const body = (fn as ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression).body
    if (!body) return null

    // Collect local const declarations (non-uppercase names, before the return/JSX)
    const localConsts = new Map<string, string>()
    if (ts.isBlock(body)) {
      for (const stmt of body.statements) {
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.initializer && !isComponentName(decl.name.text)) {
              localConsts.set(decl.name.text, src.slice(decl.initializer.getStart(), decl.initializer.getEnd()).trim())
            }
          }
        }
      }
    }

    const jsxRoot = findJsxRoot(body)
    if (!jsxRoot) return null
    const bodyText = src.slice(jsxRoot.getStart(), jsxRoot.getEnd()).trim()
    return { paramDefaults, localConsts, bodyText }
  }

  function scanNode(node: ts.Node) {
    // const CalcButton = (...) => <JSX>  or  const CalcButton = function(...) { ... }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !isComponentName(decl.name.text)) continue
        if (!decl.initializer) continue
        const fn = ts.isArrowFunction(decl.initializer) ? decl.initializer
          : ts.isFunctionExpression(decl.initializer) ? decl.initializer
          : null
        if (!fn) continue
        const def = extractDef(fn)
        if (def) result.set(decl.name.text, def)
      }
    }
    // function Toggle({ on, onClick }) { return <JSX> }
    if (ts.isFunctionDeclaration(node) && node.name && isComponentName(node.name.text)) {
      const def = extractDef(node)
      if (def) result.set(node.name.text, def)
    }
  }

  ts.forEachChild(sf, scanNode)

  // Also scan inside the page render-function body for components defined there
  // (e.g. `const Field = ({ label, child }) => <Box>...</Box>` inside definePage).
  if (extraBlock) {
    for (const stmt of extraBlock.statements) scanNode(stmt)
  }

  return result
}

/**
 * Rewrite `bodyText` so every identifier (or shorthand property) that matches
 * a prop name is replaced with the prop's literal source text.
 *
 * Works by walking the TypeScript AST of bodyText to find exact character
 * ranges, then applies replacements from end to start so earlier positions
 * remain valid. This handles:
 *   - `{label}` JSX expression → `{"AC"}`
 *   - `onClick={onClick}` attr → `onClick={workflow(...)}`
 *   - `sx={{ bg, radius: 999 }}` shorthand → `sx={{ bg: "#A5A5A5", radius: 999 }}`
 */
function substituteIdentifiers(bodyText: string, propValues: Map<string, string>): string {
  const sf = ts.createSourceFile('__body.tsx', bodyText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const subs: Array<[number, number, string]> = []

  function visit(node: ts.Node) {
    // ShorthandPropertyAssignment: { bg } → bg: "#A5A5A5"
    if (ts.isShorthandPropertyAssignment(node) && propValues.has(node.name.text)) {
      subs.push([node.getStart(), node.getEnd(), `${node.name.text}: ${propValues.get(node.name.text)!}`])
      return  // don't recurse — the name identifier is already covered
    }

    // Any identifier whose text matches a prop name, unless it IS a key/tag/attr name
    if (ts.isIdentifier(node) && propValues.has(node.text)) {
      const p = node.parent
      // Skip: key side of property assignment `{ foo: <here> }` vs `{ <here>: val }`
      if (ts.isPropertyAssignment(p) && p.name === node) { ts.forEachChild(node, visit); return }
      // Skip: JSX tag name `<Box>`, `</Box>`, `<Box />`
      if (
        (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) &&
        p.tagName === node
      ) { ts.forEachChild(node, visit); return }
      // Skip: JSX attribute name `onClick={...}` — only the name part, not the value
      if (ts.isJsxAttribute(p) && p.name === node) { ts.forEachChild(node, visit); return }

      // Beta-reduce: identifier is callee of a call expression and its value is a
      // parameterized arrow function (e.g. onPick(c) with onPick = "(c) => val = c").
      // Replace the entire CallExpression with the inlined body to avoid the
      // malformed `(c) => body(c)` that plain identifier substitution would produce.
      if (ts.isCallExpression(p) && p.expression === node) {
        const rawVal = propValues.get(node.text)!.trim()
        const arrowMatch = rawVal.match(/^\(([^()]*)\)\s*=>([\s\S]+)$/)
        if (arrowMatch) {
          const params = arrowMatch[1].split(',').map(s => s.trim()).filter(Boolean)
          let body = arrowMatch[2].trim()
          p.arguments.forEach((arg, i) => {
            if (params[i]) body = replaceIdentInCode(body, params[i], arg.getText())
          })
          subs.push([p.getStart(), p.getEnd(), body])
          return  // don't recurse — entire call expression is replaced
        }
      }

      subs.push([node.getStart(), node.getEnd(), propValues.get(node.text)!])
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)

  // Apply from end to start so earlier positions remain valid after each splice
  subs.sort((a, b) => b[0] - a[0])
  let result = bodyText
  for (const [start, end, replacement] of subs) {
    result = result.slice(0, start) + replacement + result.slice(end)
  }
  return result
}

/**
 * Inline a local component by substituting call-site props into its body JSX
 * and recompiling. Produces real SDUI nodes (Box, Text, etc.) instead of an
 * unknown `CalcButton` node that the renderer can't handle.
 */
function inlineLocalComponent(
  jsxNode: ts.JsxElement | ts.JsxSelfClosingElement,
  comp: LocalComponentDef,
  pathToId: Map<string, string>,
  relSrc: string,
  localComponents: Map<string, LocalComponentDef>,
): SduiNodeConfig | SduiNodeConfig[] {
  const opening = ts.isJsxElement(jsxNode) ? jsxNode.openingElement : jsxNode

  // Collect call-site attribute values as raw source text
  const callProps = new Map<string, string>()
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr)) continue
    const attrName = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText()
    const init = attr.initializer
    if (!init) {
      callProps.set(attrName, 'true')
    } else if (ts.isStringLiteral(init)) {
      callProps.set(attrName, JSON.stringify(init.text))
    } else if (ts.isJsxExpression(init) && init.expression) {
      callProps.set(attrName, init.expression.getText())
    }
  }

  // If the component accepts `children` and the call site has JSX children,
  // collect them as a single fragment text so `{children}` in the body resolves.
  if (ts.isJsxElement(jsxNode) && jsxNode.children.length > 0 && comp.paramDefaults.has('children')) {
    const childTexts = jsxNode.children
      .map(c => c.getText().trim())
      .filter(t => t.length > 0)
    if (childTexts.length > 0) {
      callProps.set('children', childTexts.length === 1 ? childTexts[0] : `<>${childTexts.join('')}</>`)
    }
  }

  // Merge param defaults with call-site values (call-site wins).
  // When a param has no default and is not passed, use 'undefined' so ternaries
  // like `wide ? 'full' : 78` remain valid JS (evaluating to 78 at runtime).
  const propValues = new Map<string, string>()
  for (const [name, def] of comp.paramDefaults) {
    propValues.set(name, callProps.get(name) ?? (def || 'undefined'))
  }
  for (const [k, v] of callProps) {
    if (!propValues.has(k)) propValues.set(k, v)
  }

  // ① Arrow-wrap FIRST — before localConsts are resolved.
  // Prop values that are arrow functions (e.g. `isActive = () => op === '÷'`)
  // must be parenthesised NOW so that when they are substituted into localConst
  // bodies the `?.()` optional-call syntax binds to the function, not to the
  // right-hand side of a comparison:
  //   WRONG (wrap after):  `() => op === '÷'?.()` → `?.()` calls string '÷'
  //   RIGHT (wrap before): `(() => op === '÷')?.()` → `?.()` calls the arrow
  // Event-handler props are SKIPPED: they compile to `actions`, not JS expressions.
  // Wrapping them would turn the ArrowFunction into a ParenthesizedExpression
  // that breaks `ts.isArrowFunction` detection in the onClick handler.
  const EVENT_HANDLER_PROPS = new Set(['onClick', 'onChange', 'onSubmit'])
  for (const [k, v] of propValues) {
    if (EVENT_HANDLER_PROPS.has(k)) continue
    const trimmed = v.trim()
    if (trimmed.startsWith('()') && trimmed.includes('=>')) {
      propValues.set(k, `(${trimmed})`)
    }
  }

  // ② Resolve local const expressions by substituting the (now-wrapped) prop
  // values into them, then add them to the substitution map so they inline into
  // the JSX body.
  // e.g. `const bgColor = type === 'operator' ? '#ff9f0a' : '#333'`
  //   → after substituting type="function" → `"function" === 'operator' ? ...`
  for (const [name, expr] of comp.localConsts) {
    let resolvedExpr = expr
    for (const [pname, pval] of propValues) {
      // replaceCalls=true so that `highlight()` call sites are also substituted,
      // not just standalone `highlight` references.
      resolvedExpr = replaceIdentInCode(resolvedExpr, pname, pval, /* replaceCalls */ true)
    }
    propValues.set(name, resolvedExpr)
  }

  // Substitute prop values directly into the body source text so the SDUI compiler
  // sees literals instead of unresolved identifiers when it re-parses the JSX.
  const substitutedBody = substituteIdentifiers(comp.bodyText, propValues)
  const synthetic = `import{Box,Text,Input,Textarea,Image,Icon,Video,Iframe,FormContainer,workflow,vars,setVar,navigate}from'builder';\nconst __r=(${substitutedBody});`

  const synSf = ts.createSourceFile('__inline.tsx', synthetic, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const jsxRoot = findJsxRoot(synSf)
  if (!jsxRoot) {
    return { type: 'Box', id: crypto.randomUUID(), props: {} }
  }

  return jsxToSduiNodes(jsxRoot, pathToId, relSrc, localComponents)
}

// ─── Main compiler ────────────────────────────────────────────────────────────

function jsxToSduiNodes(
  jsxRoot: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  pathToId: Map<string, string>,
  relSrc: string,
  localComponents?: Map<string, LocalComponentDef>,
): SduiNodeConfig | SduiNodeConfig[] {
  if (ts.isJsxFragment(jsxRoot)) {
    return processJsxChildren(jsxRoot.children, pathToId, relSrc, localComponents)
  }
  return convertAndPostProcess(jsxRoot, pathToId, relSrc, undefined, localComponents)
}

// ─── In-memory compile (no disk I/O) ─────────────────────────────────────────

export interface CompiledPage {
  pageName: string
  title: string
  layout: string
  content: unknown   // SduiNodeConfig root
  /** Auto-generated inline workflows (one per node-action-with-params). */
  inlineWorkflows: Map<string, Record<string, unknown>>
}

/**
 * Compile DSL source code to a page config object in memory.
 * No files are read or written — source is passed as a string.
 * Used by the dsl-chat route to push results directly to the builder canvas.
 */
export function compilePageToJson(
  sourceCode: string,
  pathToId?: Map<string, string>,
  runtimeScMap?: Map<string, { id: string; name: string; content: Record<string, unknown>; triggers?: Array<{ id: string; name: string }> }>,
  componentPropNames?: string[],
  scTriggerNames?: Map<string, string>,
): CompiledPage[] {
  const fakeFilename = 'dsl-chat.tsx'
  const sf = ts.createSourceFile(fakeFilename, sourceCode, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const resolvedPathToId = pathToId ?? new Map<string, string>()
  const localComponents = collectLocalComponents(sf)
  const results: CompiledPage[] = []

  // Set module-level state for this compile call
  _runtimeScMap = runtimeScMap ?? new Map()
  _componentPropNames = componentPropNames ?? []
  _scTriggerNames = scTriggerNames ?? new Map()
  _inlineWorkflows = new Map()  // reset per compile call
  _currentPageLocals = collectPageLocalConsts(sf)

  // Scan source for defineWorkflow declarations and map UUID → param names so that
  // positional call-site args (deleteExpense(item.id)) are keyed by declared param name
  // ('id') instead of positional 'arg0', keeping them consistent with the workflow's
  // generated code which uses `parameters.id`.
  _workflowParamNames = new Map()
  function collectWorkflowParams(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const call = node.initializer
      if (ts.isIdentifier(call.expression) && call.expression.text === 'defineWorkflow') {
        const wfName = node.name.text
        const fnArg = call.arguments[0]
        if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
          const paramNames = fnArg.parameters
            .map(p => (ts.isIdentifier(p.name) ? p.name.text : ''))
            .filter(Boolean)
          if (paramNames.length > 0) {
            const uuid =
              resolvedPathToId.get(wfName) ?? resolvedPathToId.get(`workflows/${wfName}`)
            if (uuid) _workflowParamNames.set(uuid, paramNames)
          }
        }
      }
    }
    ts.forEachChild(node, collectWorkflowParams)
  }
  collectWorkflowParams(sf)

  function extractPageCall(call: ts.CallExpression): { pageName: string; layout: string; title: string; fnArg: ts.ArrowFunction | ts.FunctionExpression } | null {
    const firstArg = call.arguments[0]
    const secondArg = call.arguments[1]
    let pageName = ''
    let layout = 'store'
    let title = ''
    let fnArg: ts.ArrowFunction | ts.FunctionExpression | null = null

    // New API: definePage('/path', fn)
    if (firstArg && ts.isStringLiteral(firstArg)) {
      pageName = firstArg.text
      fnArg = secondArg && (ts.isArrowFunction(secondArg) || ts.isFunctionExpression(secondArg))
        ? secondArg : null
    }
    // Old API: definePage({ path: '/...' }, fn)
    else if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
      for (const prop of firstArg.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        const k = ts.isIdentifier(prop.name) ? prop.name.text : null
        if (!k) continue
        if (ts.isStringLiteral(prop.initializer)) {
          if (k === 'path') pageName = prop.initializer.text
          if (k === 'layout') layout = prop.initializer.text
          if (k === 'title') title = prop.initializer.text
        }
      }
      fnArg = secondArg && (ts.isArrowFunction(secondArg) || ts.isFunctionExpression(secondArg))
        ? secondArg : null
    }

    if (!fnArg) return null
    pageName = pageName.replace(/^\/+/, '') || 'home'
    title = title || pageName
    return { pageName, layout, title, fnArg }
  }

  function compileOnePage(extracted: { pageName: string; layout: string; title: string; fnArg: ts.ArrowFunction | ts.FunctionExpression }) {
    const jsxRoot = findJsxRoot(extracted.fnArg.body)
    if (!jsxRoot) return
    // Reset inline workflows for each page so they don't bleed across pages
    _inlineWorkflows = new Map()
    _currentLocalParamFns = new Map()
    _mapCallbackLocalsStack = []
    _currentPageLocals = collectPageLocalConsts(sf)
    _currentLocalFns = collectPageLocalFns(extracted.fnArg.body)
    const renderLocals = collectRenderBodyLocals(extracted.fnArg.body)
    // Merge page-body local components (e.g. const Field = ({ label, child }) => ...)
    // into the module-level component map so inline expansion works for both.
    const pageBodyBlock = ts.isBlock(extracted.fnArg.body) ? extracted.fnArg.body : undefined
    const effectiveLocalComponents = pageBodyBlock
      ? collectLocalComponents(sf, pageBodyBlock)
      : localComponents
    try {
      const content = jsxToSduiNodes(jsxRoot, resolvedPathToId, fakeFilename, effectiveLocalComponents)
      const rootNode = Array.isArray(content) ? content[0] ?? null : content
      if (rootNode && renderLocals.length > 0) {
        rootNode.locals = renderLocals.map(local => ({
          name: local.name,
          js: resolveExprToSdui(local.js, resolvedPathToId),
        }))
      }
      results.push({
        pageName: extracted.pageName,
        title: extracted.title,
        layout: extracted.layout,
        content: rootNode,
        inlineWorkflows: new Map(_inlineWorkflows),
      })
    } finally {
      _currentLocalFns = new Map()
    }
  }

  function visitNode(node: ts.Node) {
    // export default definePage(...)
    if (
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'definePage'
    ) {
      const extracted = extractPageCall(node.expression as ts.CallExpression)
      if (extracted) compileOnePage(extracted)
      return
    }

    // export const <name> = definePage(...)
    if (ts.isVariableStatement(node)) {
      const isExported = (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      if (isExported) {
        for (const decl of node.declarationList.declarations) {
          if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
          if (!ts.isIdentifier(decl.initializer.expression)) continue
          if (decl.initializer.expression.text !== 'definePage') continue
          const extracted = extractPageCall(decl.initializer as ts.CallExpression)
          if (extracted) compileOnePage(extracted)
        }
        return
      }
    }

    ts.forEachChild(node, visitNode)
  }

  visitNode(sf)
  _runtimeScMap = new Map()
  _componentPropNames = []
  _scTriggerNames = new Map()
  _inlineWorkflows = new Map()
  _currentPageLocals = new Map()
  _currentPageLocalNodes = new Map()
  _currentMapParam = undefined
  _currentMapIndexParam = undefined
  _parentMapParam = undefined
  _parentMapIndexParam = undefined
  _mapCallbackLocalsStack = []
  _workflowParamNames = new Map()
  return results
}

// ─── Disk-based compile ───────────────────────────────────────────────────────

export function compilePageFile(
  srcPath: string,
  registry?: VfsRegistry,
): void {
  const source = fs.readFileSync(srcPath, 'utf-8')
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const localComponents = collectLocalComponents(sf)

  const configDir = path.join(process.cwd(), 'config')
  const screensDir = path.join(configDir, 'screens')

  const vfsReg = registry ?? buildVfsRegistry()
  const dslReg = loadDslRegistry()
  const relSrc = path.relative(process.cwd(), srcPath)

  function visitNode(node: ts.Node) {
    const isDefault =
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'definePage'

    if (!isDefault) {
      ts.forEachChild(node, visitNode)
      return
    }

    const call = node.expression as ts.CallExpression
    const optArg = call.arguments[0]
    const fnArg  = call.arguments[1]

    if (!optArg || !ts.isObjectLiteralExpression(optArg)) return

    // Extract options
    let pageName: string = ''
    let layout = 'store'
    let title = ''
    for (const prop of optArg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      const k = ts.isIdentifier(prop.name) ? prop.name.text : null
      if (!k) continue
      if (ts.isStringLiteral(prop.initializer)) {
        if (k === 'path') pageName = prop.initializer.text
        if (k === 'layout') layout = prop.initializer.text
        if (k === 'title') title = prop.initializer.text
      }
    }

    // Strip any leading slash so path: '/calculator' and path: 'calculator' both work
    pageName = pageName.replace(/^\/+/, '')

    if (!pageName) return
    title = title || pageName

    if (!fnArg || (!ts.isArrowFunction(fnArg) && !ts.isFunctionExpression(fnArg))) return

    // Find JSX root in the function body
    const jsxRoot = findJsxRoot(fnArg.body)
    if (!jsxRoot) {
      console.warn(`[DSL] No JSX found in ${relSrc}`)
      return
    }

    const content = jsxToSduiNodes(jsxRoot, vfsReg.pathToId, relSrc, localComponents)
    const pageConfig = {
      meta: { title, _src: relSrc },
      layout,
      content: Array.isArray(content) ? content[0] ?? null : content,
    }

    const screenFile = path.join(screensDir, `${pageName.toLowerCase()}.json`)
    fs.mkdirSync(screensDir, { recursive: true })
    fs.writeFileSync(screenFile, JSON.stringify(pageConfig, null, 2) + '\n', 'utf-8')

    // Register page in DSL registry
    dslReg.pages[pageName] = pageName.toLowerCase()
    saveDslRegistry(dslReg)

    console.log(`[DSL] compiled page '${pageName}' from ${relSrc} → ${path.relative(process.cwd(), screenFile)}`)
  }

  visitNode(sf)
}
