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
 *   <Text>{vars['store/x']}</Text>  → text: "{{variables['uuid']}}"
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
  resolveExprRefs,
  saveDslRegistry,
  type VfsRegistry,
} from './resolve-vfs'
import {
  resolveStyleParams,
  SHORTHAND_KEYS,
  SHORTHAND_FORMULA_CSS_MAP,
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
  map?: string
  key?: unknown
  condition?: unknown
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
    _inlineWorkflows.set(inlineId, {
      id: inlineId,
      meta: { name: `inline-${workflowId.slice(0, 8)}`, trigger },
      steps: [{
        id: crypto.randomUUID(),
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
          result.set(name, arrowToIife(init.arguments[0] as ts.ArrowFunction | ts.FunctionExpression))
          continue
        }

        // const fn = () => expr  OR  const fn = () => { stmts }
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          result.set(name, arrowToIife(init))
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
 * Inline zero-argument local function calls: `filteredWorkouts()` → their body.
 * Does multiple passes to handle transitive calls (totalCalories → filteredWorkouts).
 */
function inlineLocalFnCalls(code: string): string {
  if (_currentLocalFns.size === 0) return code
  let result = code
  for (let pass = 0; pass < 5; pass++) {
    let changed = false
    for (const [name, iife] of _currentLocalFns) {
      const pattern = new RegExp(`(?<![.\\w])\\b${name}\\s*\\(\\s*\\)`, 'g')
      const next = result.replace(pattern, iife)
      if (next !== result) { result = next; changed = true }
    }
    if (!changed) break
  }
  return result
}

/**
 * Resolve a JS expression string to SDUI format.
 * Handles:
 *   vars['store/x']   → variables['uuid']   (legacy)
 *   display           → variables['uuid']   (new API bare var identifier)
 *   workflows/name    → uuid               (action references)
 */
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
    `(?<![.'"\\[\\w])\\b${name}\\b(?!['\"\\]])${replaceCalls ? '' : '(?!\\s*\\()'}`,
    'g',
  )

  // Fast path: no string literals present
  if (!code.includes('"') && !code.includes("'") && !code.includes('`')) {
    return code.replace(identRe, replacement)
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
          out.push(code.slice(interpStart, i).replace(identRe, replacement))
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
    out.push(code.slice(start, i).replace(identRe, replacement))
  }

  return out.join('')
}

function resolveExprToSdui(exprText: string, pathToId: Map<string, string>): string {
  // First inline any page-local function calls (e.g. filteredWorkouts() → inlined body)
  let result = inlineLocalFnCalls(exprText)
  // Then legacy vars['...'] replacement
  result = resolveExprRefs(result, pathToId)

  // Replace bare variable identifier references (new API).
  // Only replace word-boundary matches that are keys in pathToId (var kind).
  // We avoid replacing inside property accesses (e.g. w.name — only `w`, not `.name`).
  // We also avoid replacing inside string literals (single, double, template literal plain parts).
  for (const [key, uuid] of pathToId) {
    // Only process bare names (no '/' path separators)
    if (key.includes('/') || key === uuid) continue
    // Skip if not an identifier (starts with letter/underscore)
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) continue
    result = replaceIdentInCode(result, key, `variables['${uuid}']`)
  }
  // When compiling an SC render fn, rewrite component prop names →
  // context.component?.props?.['name'] so bindings like {label} resolve correctly.
  for (const propName of _componentPropNames) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propName)) continue
    result = replaceIdentInCode(result, propName, `context.component?.props?.['${propName}']`)
  }
  return result
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

function wrapText(exprText: string): string {
  // If the expr is already a simple variable reference template, keep it
  if (exprText.startsWith('"') || exprText.startsWith("'")) {
    return exprText.slice(1, -1)
  }
  return `{{${exprText}}}`
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
function parseArrowWorkflowCall(
  arrow: ts.ArrowFunction,
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

  // Compile positional args to params
  let params: Record<string, unknown> | undefined
  if (callExpr.arguments.length > 0) {
    params = {}
    callExpr.arguments.forEach((arg, i) => {
      const key = `arg${i}`
      if (ts.isStringLiteral(arg))       params![key] = arg.text
      else if (ts.isNumericLiteral(arg)) params![key] = Number(arg.text)
      else if (arg.kind === ts.SyntaxKind.TrueKeyword)  params![key] = true
      else if (arg.kind === ts.SyntaxKind.FalseKeyword) params![key] = false
      else params![key] = { js: resolveExprToSdui(nodeText(arg), pathToId) }
    })
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
): { className: string; style: Record<string, unknown>; responsiveStyles: Record<string, Record<string, unknown>> } {
  const staticShorthand: Record<string, unknown> = {}
  const dynamicStyle: Record<string, unknown> = {}

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const k = ts.isIdentifier(prop.name) ? prop.name.text
            : ts.isStringLiteral(prop.name) ? prop.name.text
            : null
    if (!k) continue

    const v = prop.initializer

    // () => expr — zero-arg arrow function → formula → camelCase CSS in props.style
    if (ts.isArrowFunction(v) && v.parameters.length === 0) {
      const exprText = arrowToIife(v)
      const resolved = resolveExprToSdui(exprText, pathToId)
      const mapping = SHORTHAND_FORMULA_CSS_MAP[k]
      if (mapping) {
        const wrappedExpr = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
        dynamicStyle[mapping.cssKey] = { js: wrappedExpr }
      } else {
        // unknown shorthand key — emit as-is under the original key
        dynamicStyle[k] = { js: resolved }
      }
      continue
    }

    if (v.kind === ts.SyntaxKind.UndefinedKeyword) continue

    // Static literal value → bucket for resolveStyleParams
    if (ts.isStringLiteral(v))  { staticShorthand[k] = v.text;         continue }
    if (ts.isNumericLiteral(v)) { staticShorthand[k] = Number(v.text); continue }
    if (v.kind === ts.SyntaxKind.TrueKeyword)  { staticShorthand[k] = true;  continue }
    if (v.kind === ts.SyntaxKind.FalseKeyword) { staticShorthand[k] = false; continue }

    // Any other expression — formula → props.style via mapping
    const resolved = resolveExprToSdui(nodeText(v), pathToId)
    const mapping = SHORTHAND_FORMULA_CSS_MAP[k]
    if (mapping) {
      const wrappedExpr = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
      dynamicStyle[mapping.cssKey] = { js: wrappedExpr }
    } else {
      dynamicStyle[k] = { js: resolved }
    }
  }

  const { className, responsiveStyles } = resolveStyleParams(staticShorthand)

  // Convert responsive breakpoint camelCase CSS to the shape compile-page needs
  const rStyles: Record<string, Record<string, unknown>> = {}
  for (const [bp, cssObj] of Object.entries(responsiveStyles)) {
    rStyles[bp] = cssObj as Record<string, unknown>
  }

  return { className, style: dynamicStyle, responsiveStyles: rStyles }
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
      const raw = nodeText(init.expression)
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
  instanceRoot._overrides = []
  // Page-level trigger bindings only. The SC relay action is internal to the SC
  // model and is NOT copied to instances — each instance gets a single direct
  // binding (e.g. trigger:'click' → executeWorkflow(uuid)).
  instanceRoot.actions = triggerActions
  if (mapContext) { instanceRoot.map = mapContext.mapExpr; if (mapContext.keyExpr) instanceRoot.key = mapContext.keyExpr }
  return instanceRoot as unknown as SduiNodeConfig
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
    result.map = mapContext.mapExpr
    if (mapContext.keyExpr) result.key = mapContext.keyExpr
  }

  // Accumulate flat sx props (processed into className after all attrs scanned)
  const flatSxStatic: Record<string, unknown> = {}
  const flatSxDynamic: Record<string, unknown> = {}

  // Process attributes
  for (const attr of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attr)) continue
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
      } else {
        result.props[attrName] = true
      }
      continue
    }

    // String literal: src="..." name="..." etc.
    if (ts.isStringLiteral(init)) {
      // Flat string prop aliases (e.g. color="red" on Text → sx.textColor)
      const flatAlias = FLAT_STRING_ALIASES[attrName]
      if (flatAlias) {
        flatSxStatic[flatAlias] = init.text
        continue
      }
      if (attrName === 'key') {
        result.key = init.text
      } else if (attrName === 'condition') {
        result.condition = init.text
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

      // sx={{ ... }} — typed styling prop → props.className + props.style
      // style={{ ... }} — React-standard alias; treated identically to sx
      if ((attrName === 'sx' || attrName === 'style') && ts.isObjectLiteralExpression(expr)) {
        const { className, style, responsiveStyles } = parseSxProp(expr, pathToId)
        if (className) {
          result.props.className = result.props.className
            ? `${result.props.className as string} ${className}`
            : className
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
        result.condition = resolveExprToSdui(exprText, pathToId)
        continue
      }

      if (attrName === 'key') {
        result.key = resolveExprToSdui(exprText, pathToId)
        continue
      }

      // Flat numeric/dynamic prop aliases (e.g. size={14} on Text, cols={3}, color={() => ...})
      const flatAlias = FLAT_STRING_ALIASES[attrName]
      if (flatAlias) {
        if (ts.isArrowFunction(expr) && expr.parameters.length === 0) {
          const bodyText = arrowToIife(expr)
          const mapping = SHORTHAND_FORMULA_CSS_MAP[flatAlias]
          if (mapping) {
            const resolved = resolveExprToSdui(bodyText, pathToId)
            const wrapped = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
            result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), [mapping.cssKey]: { js: wrapped } }
          } else {
            flatSxDynamic[flatAlias] = { js: resolveExprToSdui(bodyText, pathToId) }
          }
        } else if (ts.isNumericLiteral(expr)) {
          flatSxStatic[flatAlias] = Number(expr.text)
        } else if (ts.isStringLiteral(expr)) {
          flatSxStatic[flatAlias] = expr.text
        } else {
          // General expression → dynamic formula, not className string
          const mapping = SHORTHAND_FORMULA_CSS_MAP[flatAlias]
          if (mapping) {
            const resolved = unwrapArrowBody(resolveExprToSdui(exprText, pathToId))
            const wrapped = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
            result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), [mapping.cssKey]: { js: wrapped } }
          } else {
            flatSxDynamic[flatAlias] = { js: unwrapArrowBody(resolveExprToSdui(exprText, pathToId)) }
          }
        }
        continue
      }

      // Direct sx key as flat numeric prop (e.g. gap={12}, p={16}, radius={8})
      if (SHORTHAND_KEYS.has(attrName)) {
        if (ts.isArrowFunction(expr) && expr.parameters.length === 0) {
          const bodyText = arrowToIife(expr)
          const mapping = SHORTHAND_FORMULA_CSS_MAP[attrName]
          if (mapping) {
            const resolved = resolveExprToSdui(bodyText, pathToId)
            const wrapped = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
            result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), [mapping.cssKey]: { js: wrapped } }
          } else {
            flatSxDynamic[attrName] = { js: resolveExprToSdui(bodyText, pathToId) }
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
          // General expression → dynamic formula, routed to props.style not className
          const mapping = SHORTHAND_FORMULA_CSS_MAP[attrName]
          if (mapping) {
            const resolved = unwrapArrowBody(resolveExprToSdui(exprText, pathToId))
            const wrapped = mapping.wrapExpr ? mapping.wrapExpr(resolved) : resolved
            result.props.style = { ...(result.props.style as Record<string, unknown> ?? {}), [mapping.cssKey]: { js: wrapped } }
          } else {
            flatSxDynamic[attrName] = { js: unwrapArrowBody(resolveExprToSdui(exprText, pathToId)) }
          }
        }
        continue
      }

      // onClick/onChange/onSubmit — new API: direct identifier ref to a workflow
      if (attrName === 'onClick' || attrName === 'onChange' || attrName === 'onSubmit') {
        const eventTrigger = propToTrigger(attrName)
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
        if (ts.isParenthesizedExpression(expr) && ts.isArrowFunction(expr.expression)
            && expr.expression.parameters.length === 0) {
          const action = parseArrowWorkflowCall(expr.expression, pathToId)
          if (action) {
            result.actions = result.actions ?? []
            result.actions.push(buildInlineAction(eventTrigger, action.action, action.params))
            continue
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

      // Generic expression prop
      result.props[attrName] = { js: resolveExprToSdui(exprText, pathToId) }
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
  // arr.map(item => <Box>...)
  if (ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === 'map') {
    return processMapCall(expr, pathToId, relSrc, localComponents)
  }

  // condition && <Box>
  if (ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const right = expr.right
    const conditionText = resolveExprToSdui(nodeText(expr.left), pathToId)

    if (ts.isJsxElement(right) || ts.isJsxSelfClosingElement(right)) {
      const node = convertJsxElement(right, pathToId, relSrc, undefined, localComponents)
      node.condition = conditionText
      return node
    }
    if (ts.isParenthesizedExpression(right)) {
      const inner = right.expression
      if (ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner)) {
        const node = convertJsxElement(inner, pathToId, relSrc, undefined, localComponents)
        node.condition = conditionText
        return node
      }
    }
  }

  // condition ? <A> : <B>
  if (ts.isConditionalExpression(expr)) {
    const condition = resolveExprToSdui(nodeText(expr.condition), pathToId)
    const whenTrue = expr.whenTrue
    const whenFalse = expr.whenFalse

    const trueNode = (ts.isJsxElement(whenTrue) || ts.isJsxSelfClosingElement(whenTrue))
      ? convertJsxElement(whenTrue, pathToId, relSrc, undefined, localComponents)
      : null
    const falseNode = (ts.isJsxElement(whenFalse) || ts.isJsxSelfClosingElement(whenFalse))
      ? convertJsxElement(whenFalse, pathToId, relSrc, undefined, localComponents)
      : null

    const results: SduiNodeConfig[] = []
    if (trueNode) { trueNode.condition = condition; results.push(trueNode) }
    if (falseNode) { falseNode.condition = `!(${condition})`; results.push(falseNode) }
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

  return null
}

function processMapCall(
  call: ts.CallExpression,
  pathToId: Map<string, string>,
  relSrc: string,
  localComponents?: Map<string, LocalComponentDef>,
): SduiNodeConfig | null {
  const arrayExpr = (call.expression as ts.PropertyAccessExpression).expression
  const mapExpr = resolveExprToSdui(nodeText(arrayExpr), pathToId)

  const cbArg = call.arguments[0]
  if (!cbArg || (!ts.isArrowFunction(cbArg) && !ts.isFunctionExpression(cbArg))) return null

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

  return convertJsxElement(innerJsx, pathToId, relSrc, { mapExpr, keyExpr }, localComponents)
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
    const expr = textChildren[0].expression
    if (!expr) return undefined
    // String literals inside JSX expressions: <Text>{"hello"}</Text> → "hello"
    if (ts.isStringLiteral(expr)) return expr.text
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

  // Mixed: concatenate
  const parts: string[] = []
  for (const c of textChildren) {
    if (ts.isJsxText(c)) {
      const t = c.text.trim()
      if (t) parts.push(t)
    } else if (ts.isJsxExpression(c) && c.expression) {
      const resolved = resolveExprToSdui(nodeText(c.expression), pathToId)
      parts.push(`{{${resolved}}}`)
    }
  }
  return parts.join('')
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
    for (const stmt of node.statements) {
      const found = findJsxRoot(stmt)
      if (found) return found
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
function collectLocalComponents(sf: ts.SourceFile): Map<string, LocalComponentDef> {
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

  ts.forEachChild(sf, node => {
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
  })

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
): CompiledPage | null {
  const fakeFilename = 'dsl-chat.tsx'
  const sf = ts.createSourceFile(fakeFilename, sourceCode, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const resolvedPathToId = pathToId ?? new Map<string, string>()
  const localComponents = collectLocalComponents(sf)
  let result: CompiledPage | null = null

  // Set module-level state for this compile call
  _runtimeScMap = runtimeScMap ?? new Map()
  _componentPropNames = componentPropNames ?? []
  _scTriggerNames = scTriggerNames ?? new Map()
  _inlineWorkflows = new Map()  // reset per compile call

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

  function visitNode(node: ts.Node) {
    if (result) return

    // export default definePage(...)
    if (
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'definePage'
    ) {
      const extracted = extractPageCall(node.expression as ts.CallExpression)
      if (extracted) {
        const jsxRoot = findJsxRoot(extracted.fnArg.body)
        if (!jsxRoot) return
        _currentLocalFns = collectPageLocalFns(extracted.fnArg.body)
        try {
          const content = jsxToSduiNodes(jsxRoot, resolvedPathToId, fakeFilename, localComponents)
          result = {
            pageName: extracted.pageName,
            title: extracted.title,
            layout: extracted.layout,
            content: Array.isArray(content) ? content[0] ?? null : content,
            inlineWorkflows: new Map(_inlineWorkflows),
          }
        } finally {
          _currentLocalFns = new Map()
        }
      }
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
          if (extracted) {
            const jsxRoot = findJsxRoot(extracted.fnArg.body)
            if (!jsxRoot) return
            _currentLocalFns = collectPageLocalFns(extracted.fnArg.body)
            try {
              const content = jsxToSduiNodes(jsxRoot, resolvedPathToId, fakeFilename, localComponents)
              result = {
                pageName: extracted.pageName,
                title: extracted.title,
                layout: extracted.layout,
                content: Array.isArray(content) ? content[0] ?? null : content,
                inlineWorkflows: new Map(_inlineWorkflows),
              }
            } finally {
              _currentLocalFns = new Map()
            }
            return
          }
        }
      }
    }

    ts.forEachChild(node, visitNode)
  }

  visitNode(sf)
  _runtimeScMap = new Map()
  _componentPropNames = []
  _scTriggerNames = new Map()
  _inlineWorkflows = new Map()
  return result
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
