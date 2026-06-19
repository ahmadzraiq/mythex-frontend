/**
 * compile-file.ts — Unified 2-pass DSL compiler.
 *
 * Replaces the separate compile-var / compile-workflow / compile-page passes
 * with a single coherent scan that works across any file layout the AI chooses.
 *
 * PASS 1 — Collect declarations from ALL source files
 *   Scans every file for defineVar / defineWorkflow / defineFunction /
 *   defineDatasource / defineComponent / defineTrigger / definePage calls and
 *   builds a nameToUuid + nameToKind map.  UUIDs are deterministic (seedUuid).
 *
 * PASS 2 — Compile each file using the collected map
 *   Variables   → var_written events
 *   Workflows   → workflow_written events (steps use UUIDs from the map)
 *   Functions   → utils_written events
 *   Datasources → datasource_written events
 *   Components  → component_written events
 *   Pages       → page_written + routes_written events
 *
 * The enriched pathToId passed to existing compilers in Pass 2 contains both
 * the legacy `store/<name>` paths AND bare variable/workflow/function names so
 * identifier-style references in the new API are resolved to UUIDs.
 */

import crypto from 'crypto'
import ts from 'typescript'

// ─── Compiled event shape (matches what _virtual-files.ts consumes) ────────────

export type CompiledEvent = {
  type:
    | 'var_written'
    | 'workflow_written'
    | 'page_written'
    | 'routes_written'
    | 'utils_written'
    | 'datasource_written'
    | 'component_written'
    | 'trigger_written'
  path: string
  content: string
}

// ─── Declaration kinds ────────────────────────────────────────────────────────

export type DeclKind = 'var' | 'workflow' | 'function' | 'datasource' | 'component' | 'trigger' | 'page'

export interface DeclInfo {
  kind: DeclKind
  uuid: string
  exportName: string
  exported: boolean
  /** For workflows/functions: the parameter names from the fn signature */
  fnParams?: string[]
  /** For vars: the initial value */
  initialValue?: unknown
  /** For vars: the inferred type */
  varType?: string
  /** For pages: the route path */
  pagePath?: string
  /** For datasources: the options object literal source text */
  dsOpts?: Record<string, unknown>
  /** For components: the explicit id string from defineComponent('id', ...) */
  componentId?: string
  /** For triggers: the trigger type string */
  triggerType?: string
}

export type DeclMap = Map<string, DeclInfo>  // exportName → DeclInfo

// ─── Deterministic UUID ───────────────────────────────────────────────────────

function seedUuid(seed: string): string {
  const hash = crypto.createHash('sha256').update(seed).digest('hex')
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeText(n: ts.Node): string {
  return n.getText().trim()
}

/** Parse a literal initial value from a TypeScript AST node. */
function parseInitialValue(node: ts.Expression | undefined): { value: unknown; type: string } {
  if (!node) return { value: null, type: 'string' }

  if (ts.isStringLiteral(node))   return { value: node.text, type: 'string' }
  if (ts.isNumericLiteral(node))  return { value: Number(node.text), type: 'number' }
  if (node.kind === ts.SyntaxKind.TrueKeyword)  return { value: true,  type: 'boolean' }
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false, type: 'boolean' }
  if (node.kind === ts.SyntaxKind.NullKeyword)  return { value: null,  type: 'string' }
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return { value: null, type: 'string' }

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    if (ts.isNumericLiteral(node.operand)) return { value: -Number(node.operand.text), type: 'number' }
  }

  if (ts.isArrayLiteralExpression(node)) {
    try {
      const src = nodeText(node).replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":').replace(/'/g, '"')
      return { value: JSON.parse(src), type: 'array' }
    } catch { return { value: [], type: 'array' } }
  }

  if (ts.isObjectLiteralExpression(node)) {
    try {
      const src = nodeText(node).replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":').replace(/'/g, '"')
      return { value: JSON.parse(src), type: 'object' }
    } catch { return { value: {}, type: 'object' } }
  }

  return { value: nodeText(node), type: 'string' }
}

/** Extract parameter names from an arrow/function expression. */
function extractParamNames(fn: ts.ArrowFunction | ts.FunctionExpression): string[] {
  const names: string[] = []
  for (const p of fn.parameters) {
    if (ts.isIdentifier(p.name)) names.push(p.name.text)
    else names.push('_')
  }
  return names
}

// ─── PASS 1: Collect all declarations across all source files ─────────────────

const VALID_DEFINE_FNS = new Set([
  'defineVar', 'defineWorkflow', 'defineFunction', 'defineFormula',
  'defineDatasource', 'defineComponent', 'defineTrigger', 'definePage',
])

const OLD_VAR_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object'])

/**
 * Scan a single source file for `define*` declarations.
 * Both exported and non-exported are collected (exported flag distinguishes them).
 */
function collectDeclarations(
  sourceCode: string,
  projectId: string,
  declMap: DeclMap,
): void {
  const sf = ts.createSourceFile('__scan.tsx', sourceCode, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  ts.forEachChild(sf, function visit(node: ts.Node) {
    // export const <name> = define*(...)
    // const <name> = define*(...)   (non-exported, page-scoped)
    if (ts.isVariableStatement(node)) {
      const isExported = (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        const exportName = decl.name.text
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        const fnName = decl.initializer.expression.text
        if (!VALID_DEFINE_FNS.has(fnName)) continue

        const args = decl.initializer.arguments
        processDecl(exportName, fnName, args, isExported, projectId, declMap)
      }
      return
    }

    ts.forEachChild(node, visit)
  })
}

function processDecl(
  exportName: string,
  fnName: string,
  args: ts.NodeArray<ts.Expression>,
  exported: boolean,
  projectId: string,
  declMap: DeclMap,
): void {
  if (fnName === 'defineVar') {
    // New API: defineVar(initial)
    // Old API: defineVar('type', initial)  — detect by checking if arg[0] is a recognized type string
    const firstArg = args[0]
    let varType: string
    let initialValue: unknown

    const isOldApi = firstArg && ts.isStringLiteral(firstArg) && OLD_VAR_TYPES.has(firstArg.text) && args.length >= 2
    if (isOldApi) {
      varType = (firstArg as ts.StringLiteral).text
      const parsed = parseInitialValue(args[1])
      initialValue = parsed.value
    } else {
      const parsed = parseInitialValue(firstArg)
      varType = parsed.type
      initialValue = parsed.value
    }

    const uuid = seedUuid(`${projectId}:var:${exportName}`)
    declMap.set(exportName, { kind: 'var', uuid, exportName, exported, varType, initialValue })
    return
  }

  if (fnName === 'defineWorkflow') {
    // New API: defineWorkflow(fn)         — fn as first arg
    // Old API: defineWorkflow(opts, fn)   — options object first
    const firstArg = args[0]
    let fnNode: ts.ArrowFunction | ts.FunctionExpression | null = null
    let fnParams: string[] = []

    if (firstArg && (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg))) {
      // New API
      fnNode = firstArg
    } else if (args[1] && (ts.isArrowFunction(args[1]) || ts.isFunctionExpression(args[1]))) {
      // Old API
      fnNode = args[1]
    }
    if (fnNode) fnParams = extractParamNames(fnNode)

    const uuid = seedUuid(`${projectId}:workflow:${exportName}`)
    declMap.set(exportName, { kind: 'workflow', uuid, exportName, exported, fnParams })
    return
  }

  if (fnName === 'defineFunction' || fnName === 'defineFormula') {
    const fn = args[0]
    let fnParams: string[] = []
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      fnParams = extractParamNames(fn)
    }
    const uuid = seedUuid(`${projectId}:fn:${exportName}`)
    declMap.set(exportName, { kind: 'function', uuid, exportName, exported, fnParams })
    return
  }

  if (fnName === 'defineDatasource') {
    const uuid = seedUuid(`${projectId}:ds:${exportName}`)
    const dsOpts: Record<string, unknown> = {}
    const optsArg = args[0]
    if (optsArg && ts.isObjectLiteralExpression(optsArg)) {
      for (const prop of optsArg.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        const k = ts.isIdentifier(prop.name) ? prop.name.text : null
        if (!k) continue
        if (ts.isStringLiteral(prop.initializer)) dsOpts[k] = prop.initializer.text
        else if (ts.isNumericLiteral(prop.initializer)) dsOpts[k] = Number(prop.initializer.text)
      }
    }
    declMap.set(exportName, { kind: 'datasource', uuid, exportName, exported, dsOpts })
    return
  }

  if (fnName === 'defineComponent') {
    // defineComponent('ComponentId', schema, render)
    const idArg = args[0]
    const componentId = idArg && ts.isStringLiteral(idArg) ? idArg.text : exportName
    const uuid = componentId  // SC uses explicit string id as UUID
    declMap.set(exportName, { kind: 'component', uuid, exportName, exported, componentId })
    return
  }

  if (fnName === 'defineTrigger') {
    // New API: defineTrigger('type', fn)
    // Old API: defineTrigger({ type: '...' }, fn)
    const firstArg = args[0]
    let triggerType = 'appLoad'
    if (ts.isStringLiteral(firstArg)) {
      triggerType = firstArg.text
    } else if (ts.isObjectLiteralExpression(firstArg)) {
      for (const prop of firstArg.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        if (ts.isIdentifier(prop.name) && prop.name.text === 'type' && ts.isStringLiteral(prop.initializer)) {
          triggerType = prop.initializer.text
        }
      }
    }
    const uuid = seedUuid(`${projectId}:tr:${exportName}`)
    declMap.set(exportName, { kind: 'trigger', uuid, exportName, exported, triggerType })
    return
  }

  if (fnName === 'definePage') {
    // New API: definePage('/path', fn)    — path as string first arg
    // Old API: definePage({ path: '/...' }, fn)
    const firstArg = args[0]
    let pagePath = ''
    if (ts.isStringLiteral(firstArg)) {
      pagePath = firstArg.text
    } else if (ts.isObjectLiteralExpression(firstArg)) {
      for (const prop of firstArg.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        if (ts.isIdentifier(prop.name) && prop.name.text === 'path' && ts.isStringLiteral(prop.initializer)) {
          pagePath = prop.initializer.text
        }
      }
    }
    const uuid = seedUuid(`${projectId}:page:${exportName}`)
    declMap.set(exportName, { kind: 'page', uuid, exportName, exported, pagePath })
    return
  }
}

/**
 * Pass 1: scan all source files and return the declaration map.
 */
export function pass1Collect(
  sources: Record<string, string>,
  projectId: string,
): DeclMap {
  const declMap: DeclMap = new Map()
  for (const [, content] of Object.entries(sources)) {
    try {
      collectDeclarations(content, projectId, declMap)
    } catch { /* skip malformed */ }
  }
  return declMap
}

// ─── Build enriched pathToId from DeclMap ─────────────────────────────────────

/**
 * Build the pathToId map that the existing compilers (compile-var, compile-workflow,
 * compile-page) accept. Contains both legacy `store/<name>` paths AND bare names
 * so identifier-style references in the new API resolve correctly.
 */
export function buildPathToId(declMap: DeclMap): Map<string, string> {
  const m = new Map<string, string>()
  for (const [name, info] of declMap) {
    if (info.kind === 'var') {
      // Bare name AND legacy path → UUID for expression resolution
      m.set(name, info.uuid)
      m.set(`store/${name}`, info.uuid)
    }
    if (info.kind === 'workflow') {
      // Bare name for onClick={workflowRef} resolution (only used in action resolution, not in expressions)
      m.set(name, info.uuid)
      m.set(`workflows/${name}`, info.uuid)
      m.set(info.uuid, info.uuid)
    }
    if (info.kind === 'datasource') {
      // Bare name for fetch(dsRef) + .map() resolution
      m.set(name, info.uuid)
      m.set(`data/${name}`, info.uuid)
    }
    if (info.kind === 'function') {
      // Only prefixed path — functions keep their name in expressions (not variables['uuid'])
      m.set(`utils/${name}`, info.uuid)
    }
    if (info.kind === 'component') {
      m.set(`components/${name}`, info.uuid)
      if (info.componentId) m.set(`components/${info.componentId}`, info.uuid)
    }
  }
  return m
}

// ─── PASS 2: Compile each declaration to events ────────────────────────────────

import { compileVarsToJson }                    from './compile-var'
import { compileAllWorkflowsToJson }            from './compile-workflow'
import { compilePageToJson, replaceIdentInCode } from './compile-page'

/** Infer page name from path: '/' → 'home', '/products' → 'products' */
function pathToPageName(pagePath: string): string {
  const cleaned = pagePath.replace(/^\/+/, '').trim()
  if (!cleaned || cleaned === '') return 'home'
  return cleaned.split('/').pop() ?? cleaned
}

/**
 * Pass 2: compile all source files to events using the collected DeclMap.
 */
export function pass2Compile(
  sources: Record<string, string>,
  declMap: DeclMap,
  projectId: string,
): CompiledEvent[] {
  const events: CompiledEvent[] = []
  const pathToId = buildPathToId(declMap)

  const routes: Array<{ path: string; config: string; name: string }> = []

  for (const [, content] of Object.entries(sources)) {
    // ── Variables ─────────────────────────────────────────────────────────────
    if (content.includes('defineVar')) {
      try {
        // Patch the source so old compileVarsToJson handles new single-arg defineVar
        const patched = patchVarSource(content, declMap)
        const compiledVars = compileVarsToJson(patched, projectId)
        for (const v of compiledVars) {
          events.push({ type: 'var_written', path: `store/${v.varName}`, content: JSON.stringify(v.entry) })
        }
      } catch { /* skip */ }
    }

    // ── Workflows ─────────────────────────────────────────────────────────────
    if (content.includes('defineWorkflow')) {
      try {
        // Patch the source so old compileAllWorkflowsToJson handles new fn-as-first-arg
        const patched = patchWorkflowSource(content, declMap, pathToId)
        const compiledWfs = compileAllWorkflowsToJson(patched, pathToId, projectId)
        for (const wf of compiledWfs) {
          events.push({ type: 'workflow_written', path: `workflows/${wf.wfName}`, content: JSON.stringify(wf.config) })
        }
      } catch { /* skip */ }
    }

    // ── Functions (defineFunction / defineFormula) ─────────────────────────────
    if (content.includes('defineFunction') || content.includes('defineFormula')) {
      try {
        const fnEvents = compileFunctions(content, declMap, pathToId, projectId)
        events.push(...fnEvents)
      } catch { /* skip */ }
    }

    // ── Datasources ────────────────────────────────────────────────────────────
    if (content.includes('defineDatasource')) {
      try {
        const dsEvents = compileDatasources(content, declMap, projectId)
        events.push(...dsEvents)
      } catch { /* skip */ }
    }

    // ── Shared Components ─────────────────────────────────────────────────────
    const runtimeScMap = new Map<string, { id: string; name: string; content: Record<string, unknown>; triggers?: Array<{ id: string; name: string }> }>()
    if (content.includes('defineComponent')) {
      try {
        const scEvents = compileComponents(content, declMap, pathToId, projectId)
        events.push(...scEvents)
        for (const ev of scEvents) {
          if (ev.type === 'component_written') {
            try {
              const parsed = JSON.parse(ev.content) as Record<string, unknown>
              const scId = String(parsed.id ?? '')
              const scName = String(parsed.name ?? scId)
              // Support both old (ui: [tree]) and new (content: tree) shapes
              const uiArr = parsed.ui as unknown[] | undefined
              const scContent = (Array.isArray(uiArr) ? uiArr[0] : parsed.content) as Record<string, unknown> | undefined
              const scTriggers = parsed.triggers as Array<{ id: string; name: string; domEvent?: string }> | undefined
              if (scId && scContent) runtimeScMap.set(scName.toLowerCase(), { id: scId, name: scName, content: scContent, triggers: scTriggers })
            } catch { /* skip malformed */ }
          }
        }
      } catch { /* skip */ }
    }

    // ── Pages ─────────────────────────────────────────────────────────────────
    if (content.includes('definePage')) {
      try {
        const patched = patchPageSource(content)
        const compiled = compilePageToJson(patched, pathToId, runtimeScMap)
        if (compiled) {
          const pageName = compiled.pageName
          events.push({
            type: 'page_written',
            path: `pages/${pageName}/page`,
            content: JSON.stringify({ meta: { title: compiled.title }, ui: [compiled.content] }),
          })
          routes.push({
            path: `/${pageName === 'home' ? '' : pageName}`,
            config: pageName,
            name: compiled.title || pageName,
          })
          // SC trigger binding workflows are now emitted as inline actions on instance nodes —
          // no separate sc-tw-* wrapper workflow events needed.
        }
      } catch {
        // fallback: register route stub
        const pageName = inferPageNameFromSource(content)
        if (pageName && !routes.find(r => r.config === pageName)) {
          routes.push({ path: `/${pageName === 'home' ? '' : pageName}`, config: pageName, name: pageName })
        }
      }
    }
  }

  if (routes.length > 0) {
    events.push({ type: 'routes_written', path: 'routes', content: JSON.stringify({ routes }) })
  }

  return events
}

// ─── Source patching helpers ──────────────────────────────────────────────────

/**
 * Patch single-arg defineVar(init) → defineVar('type', init) so the existing
 * compileVarsToJson (which expects two args) handles it correctly.
 * Also rewrites non-exported vars to add export so the compiler sees them.
 */
function patchVarSource(source: string, declMap: DeclMap): string {
  const sf = ts.createSourceFile('__patch.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const patches: Array<[number, number, string]> = []

  ts.forEachChild(sf, function visit(node: ts.Node) {
    if (ts.isVariableStatement(node)) {
      const isExported = (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        if (!ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineVar') continue

        const args = decl.initializer.arguments
        if (args.length === 1) {
          const name = decl.name.text
          const info = declMap.get(name)
          const typeStr = info?.varType ?? 'string'
          const firstArg = args[0]
          // Insert type string before the existing arg
          patches.push([firstArg.getStart(), firstArg.getStart(), `'${typeStr}', `])
        }
        if (!isExported) {
          // Add export keyword so compiler picks it up
          patches.push([node.getStart(), node.getStart(), 'export '])
        }
      }
    }
    ts.forEachChild(node, visit)
  })

  // Apply patches end-to-start
  patches.sort((a, b) => b[0] - a[0])
  let result = source
  for (const [start, end, replacement] of patches) {
    result = result.slice(0, start) + replacement + result.slice(end)
  }
  return result
}

/**
 * Patch defineWorkflow(fn) → defineWorkflow({ path: 'name' }, fn) so the
 * existing compileAllWorkflowsToJson handles it.
 * Also patches setVar(varRef, val) → setVar(resolvedPath, val).
 */
function patchWorkflowSource(
  source: string,
  declMap: DeclMap,
  pathToId: Map<string, string>,
): string {
  const sf = ts.createSourceFile('__patch.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const patches: Array<[number, number, string]> = []

  ts.forEachChild(sf, function visit(node: ts.Node) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        if (!ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineWorkflow') continue

        const name = decl.name.text
        const args = decl.initializer.arguments
        const firstArg = args[0]

        // New API: defineWorkflow(fn) — fn is first arg
        if (firstArg && (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg))) {
          // Insert options object before fn
          patches.push([firstArg.getStart(), firstArg.getStart(), `{ path: 'workflows/${name}' }, `])
        }

        // Patch setVar(varRef, val) calls inside fn body
        if (firstArg) {
          const fnNode = ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg)
            ? firstArg
            : (args[1] && (ts.isArrowFunction(args[1]) || ts.isFunctionExpression(args[1])) ? args[1] : null)
          if (fnNode) {
            patchSetVarCalls(fnNode, declMap, pathToId, patches)
            patchWorkflowCalls(fnNode, declMap, pathToId, patches)
            patchFetchCalls(fnNode, declMap, pathToId, patches)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  })

  patches.sort((a, b) => b[0] - a[0])
  let result = source
  for (const [start, end, replacement] of patches) {
    result = result.slice(0, start) + replacement + result.slice(end)
  }
  return result
}

/**
 * In a workflow function body, patch:
 *   setVar(varRef, val)  →  setVar('store/name', val)
 * where varRef is an identifier known to be a variable.
 */
function patchSetVarCalls(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  declMap: DeclMap,
  _pathToId: Map<string, string>,
  patches: Array<[number, number, string]>,
): void {
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'setVar' &&
      node.arguments.length >= 1
    ) {
      const firstArg = node.arguments[0]
      // If first arg is an identifier (var reference), patch it to string path
      if (ts.isIdentifier(firstArg)) {
        const varInfo = declMap.get(firstArg.text)
        if (varInfo && varInfo.kind === 'var') {
          patches.push([firstArg.getStart(), firstArg.getEnd(), `'store/${firstArg.text}'`])
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(fn.body)
}

/**
 * In a workflow function body, patch workflow-reference calls:
 *   addToCart(id, price)  →  keep as-is (compileWorkflow will emit runJavaScript, that's fine)
 * Actually we handle this at compile-workflow level by detecting known workflow names.
 * For now just ensure fetch(dsRef) → fetch('data/dsName').
 */
function patchWorkflowCalls(
  _fn: ts.ArrowFunction | ts.FunctionExpression,
  _declMap: DeclMap,
  _pathToId: Map<string, string>,
  _patches: Array<[number, number, string]>,
): void {
  // Workflow-to-workflow calls are emitted as runJavaScript steps
  // (the code is preserved as-is with var refs substituted).
  // This is handled by compileAllWorkflowsToJson which uses resolveExprRefs.
}

/**
 * Patch fetch(dsRef) → fetch('data/dsName') where dsRef is a datasource identifier.
 */
function patchFetchCalls(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  declMap: DeclMap,
  _pathToId: Map<string, string>,
  patches: Array<[number, number, string]>,
): void {
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'fetch' &&
      node.arguments.length === 1
    ) {
      const arg = node.arguments[0]
      if (ts.isIdentifier(arg)) {
        const dsInfo = declMap.get(arg.text)
        if (dsInfo && dsInfo.kind === 'datasource') {
          patches.push([arg.getStart(), arg.getEnd(), `'data/${arg.text}'`])
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(fn.body)
}

/**
 * Patch definePage('/path', fn) → definePage({ path: '/path' }, fn) for the old compiler.
 * Also normalizes `export default definePage(...)` to `export const <name> = definePage(...)`.
 */
function patchPageSource(source: string): string {
  const sf = ts.createSourceFile('__patch.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const patches: Array<[number, number, string]> = []

  ts.forEachChild(sf, function visit(node: ts.Node) {
    // Handle: const/export const <name> = definePage(stringPath, fn)
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'definePage') continue

        const args = decl.initializer.arguments
        const firstArg = args[0]
        if (firstArg && ts.isStringLiteral(firstArg)) {
          // Patch: '/path' → { path: '/path' }
          patches.push([
            firstArg.getStart(),
            firstArg.getEnd(),
            `{ path: ${JSON.stringify(firstArg.text)} }`,
          ])
        }
      }
    }

    // Handle: export default definePage(...)
    if (
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'definePage'
    ) {
      const args = node.expression.arguments
      const firstArg = args[0]
      if (firstArg && ts.isStringLiteral(firstArg)) {
        patches.push([
          firstArg.getStart(),
          firstArg.getEnd(),
          `{ path: ${JSON.stringify(firstArg.text)} }`,
        ])
      }
    }

    ts.forEachChild(node, visit)
  })

  patches.sort((a, b) => b[0] - a[0])
  let result = source
  for (const [start, end, replacement] of patches) {
    result = result.slice(0, start) + replacement + result.slice(end)
  }
  return result
}

// ─── Function (formula) compiler ─────────────────────────────────────────────

/**
 * Replace a bare parameter identifier in a JS code string with parameters.paramName,
 * skipping occurrences inside string literals.
 */
function replaceIdentInBodyForParam(code: string, name: string, replacement?: string): string {
  // Skip replacing if already prefixed with "parameters."
  const prefixed = replacement ?? `parameters.${name}`
  const identRe = new RegExp(`(?<![.'"\\[\\w])\\b${name}\\b(?!['"\\]])`, 'g')
  if (!code.includes('"') && !code.includes("'") && !code.includes('`')) {
    return code.replace(identRe, prefixed)
  }
  const out: string[] = []
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < code.length) {
        if (code[j] === '\\') { j += 2; continue }
        if (code[j] === ch) { j++; break }
        j++
      }
      out.push(code.slice(i, j)); i = j; continue
    }
    if (ch === '`') {
      out.push('`'); i++
      while (i < code.length) {
        if (code[i] === '\\') { out.push(code.slice(i, i + 2)); i += 2; continue }
        if (code[i] === '`') { out.push('`'); i++; break }
        if (code[i] === '$' && code[i + 1] === '{') {
          out.push('${'); i += 2
          let depth = 1; const s = i
          while (i < code.length && depth > 0) {
            if (code[i] === '{') depth++; else if (code[i] === '}') depth--
            if (depth > 0) i++; else break
          }
          out.push(code.slice(s, i).replace(identRe, prefixed))
          out.push('}'); i++; continue
        }
        const start = i
        while (i < code.length && code[i] !== '`' && code[i] !== '\\' && !(code[i] === '$' && code[i + 1] === '{')) i++
        out.push(code.slice(start, i))
      }
      continue
    }
    const start = i
    while (i < code.length && code[i] !== "'" && code[i] !== '"' && code[i] !== '`') i++
    out.push(code.slice(start, i).replace(identRe, prefixed))
  }
  return out.join('')
}

function compileFunctions(
  source: string,
  declMap: DeclMap,
  pathToId: Map<string, string>,
  _projectId: string,
): CompiledEvent[] {
  const events: CompiledEvent[] = []
  const sf = ts.createSourceFile('__fn.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  ts.forEachChild(sf, function visit(node: ts.Node) {
    if (ts.isVariableStatement(node)) {
      const isExported = (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      if (!isExported) return
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        if (!ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        const callee = decl.initializer.expression.text
        if (callee !== 'defineFunction' && callee !== 'defineFormula') continue

        const name = decl.name.text
        const info = declMap.get(name)
        if (!info || info.kind !== 'function') continue

        const fnArg = decl.initializer.arguments[0]
        if (!fnArg) continue

        // Extract just the function body (without the `(args) =>` wrapper) so it
        // matches GlobalFormulaDef.formula — the inner expression or statements only.
        // Parameter names are rewritten to parameters.paramName so the body is
        // consistent with the builder convention (access via the parameters object).
        let formulaBody = ''
        let fnParamNames: string[] = []
        if (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg)) {
          const fn = fnArg as ts.ArrowFunction | ts.FunctionExpression
          fnParamNames = fn.parameters.map(p =>
            ts.isIdentifier(p.name) ? p.name.text : ''
          ).filter(Boolean)
          if (ts.isBlock(fn.body)) {
            // Block body: strip outer { }
            formulaBody = fn.body.getText().slice(1, -1).trim()
          } else {
            // Concise body: the expression itself
            formulaBody = nodeText(fn.body as ts.Node)
          }
        } else {
          formulaBody = nodeText(fnArg)
        }
        // Replace bare param names with parameters.paramName (builder convention)
        for (const paramName of fnParamNames) {
          formulaBody = replaceIdentInBodyForParam(formulaBody, paramName)
        }

        // Resolve bare DSL variable/function names → variables['uuid'] / __userFns__['name']
        for (const [key, uuid] of pathToId) {
          if (key.includes('/') || key === uuid) continue
          if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) continue
          if (fnParamNames.includes(key)) continue  // already rewritten above
          formulaBody = replaceIdentInBodyForParam(formulaBody, key, `variables['${uuid}']`)
        }

        const config = {
          id: info.uuid,
          name,
          label: name,
          formula: { js: formulaBody },
          params: (info.fnParams ?? []).map((p, i) => ({ id: `p${i + 1}`, name: p, type: 'any' as const })),
          folder: 'DSL',
          _dslName: name,
        }

        events.push({ type: 'utils_written', path: `utils/${name}`, content: JSON.stringify(config) })
      }
    }
    ts.forEachChild(node, visit)
  })

  return events
}

// ─── Datasource compiler ──────────────────────────────────────────────────────

function compileDatasources(
  source: string,
  declMap: DeclMap,
  _projectId: string,
): CompiledEvent[] {
  const events: CompiledEvent[] = []
  const sf = ts.createSourceFile('__ds.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  ts.forEachChild(sf, function visit(node: ts.Node) {
    if (ts.isVariableStatement(node)) {
      const isExported = (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      if (!isExported) return
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        if (!ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineDatasource') continue

        const name = decl.name.text
        const info = declMap.get(name)
        if (!info || info.kind !== 'datasource') continue

        const config = {
          id: info.uuid,
          label: name,
          folder: 'DSL',
          ...(info.dsOpts ?? {}),
        }
        events.push({ type: 'datasource_written', path: `data/${name}`, content: JSON.stringify(config) })
      }
    }
    ts.forEachChild(node, visit)
  })

  return events
}

// ─── Shared Component compiler ────────────────────────────────────────────────

function stampKeys(node: Record<string, unknown>): void {
  if (!node._sharedKey) node._sharedKey = crypto.randomUUID()
  for (const c of (node.children ?? []) as Record<string, unknown>[]) stampKeys(c)
}

function compileComponents(
  source: string,
  declMap: DeclMap,
  pathToId: Map<string, string>,
  _projectId: string,
): CompiledEvent[] {
  const events: CompiledEvent[] = []
  const sf = ts.createSourceFile('__sc.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  ts.forEachChild(sf, function visit(node: ts.Node) {
    if (ts.isVariableStatement(node)) {
      const isExported = (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      if (!isExported) return
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        if (!ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineComponent') continue

        const exportName = decl.name.text
        const info = declMap.get(exportName)
        if (!info || info.kind !== 'component') continue

        const componentId = info.componentId ?? exportName
        const schemaArg = decl.initializer.arguments[1]
        const props: Record<string, { type: string; defaultValue?: unknown }> = {}
        const parsedTriggers: string[] = []

        if (schemaArg && ts.isObjectLiteralExpression(schemaArg)) {
          for (const schemaProp of schemaArg.properties) {
            if (!ts.isPropertyAssignment(schemaProp)) continue
            const schemaKey = ts.isIdentifier(schemaProp.name) ? schemaProp.name.text : null
            if (!schemaKey) continue

            // Parse props
            if (schemaKey === 'props' && ts.isObjectLiteralExpression(schemaProp.initializer)) {
              for (const propEntry of schemaProp.initializer.properties) {
                if (!ts.isPropertyAssignment(propEntry)) continue
                const propName = ts.isIdentifier(propEntry.name) ? propEntry.name.text : null
                if (!propName) continue
                if (!ts.isObjectLiteralExpression(propEntry.initializer)) continue
                const propDef: { type: string; defaultValue?: unknown } = { type: 'string' }
                for (const defProp of propEntry.initializer.properties) {
                  if (!ts.isPropertyAssignment(defProp)) continue
                  const k = ts.isIdentifier(defProp.name) ? defProp.name.text : null
                  if (k === 'type' && ts.isStringLiteral(defProp.initializer)) {
                    propDef.type = defProp.initializer.text
                  }
                  if (k === 'default') {
                    propDef.defaultValue = parseInitialValue(defProp.initializer).value
                  }
                }
                props[propName] = propDef
              }
            }

            // Parse triggers: triggers: ['onPress', 'onChange']
            if (schemaKey === 'triggers' && ts.isArrayLiteralExpression(schemaProp.initializer)) {
              for (const elem of schemaProp.initializer.elements) {
                if (ts.isStringLiteral(elem)) parsedTriggers.push(elem.text)
              }
            }
          }
        }

        // Build SC trigger model entries and trigger-name → workflow-id map.
        // Also scan the render source for onX={triggerName} to derive the DOM event
        // each trigger is bound to (e.g. onClick={onPress} → domEvent: 'click').
        const scTriggers: Array<{ id: string; name: string; domEvent?: string }> = []
        const scWorkflows: Record<string, unknown> = {}
        const scTriggerMap = new Map<string, string>() // triggerName → internalWorkflowId

        // Pre-scan render source for onX={triggerName} bindings before compiling.
        const domEventMap = new Map<string, string>() // triggerName → domEvent ('click', etc.)
        if (parsedTriggers.length > 0) {
          const triggerSet = new Set(parsedTriggers)
          const renderArgNode = decl.initializer.arguments[2]
          if (renderArgNode) {
            const renderText = nodeText(renderArgNode)
            // Parse as a mini TSX source to walk JSX attributes safely.
            const miniSf = ts.createSourceFile('__scan.tsx', renderText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
            ts.forEachChild(miniSf, function scanNode(n: ts.Node) {
              if (ts.isJsxAttribute(n)) {
                const attrNameNode = n.name
                const attrName = ts.isIdentifier(attrNameNode) ? attrNameNode.text : attrNameNode.getText()
                if (attrName.startsWith('on') && attrName.length > 2 && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression && ts.isIdentifier(n.initializer.expression)) {
                  const identName = n.initializer.expression.text
                  if (triggerSet.has(identName) && !domEventMap.has(identName)) {
                    // onClick → 'click', onChange → 'change', onFocus → 'focus', etc.
                    const domEvent = attrName.charAt(2).toLowerCase() + attrName.slice(3)
                    domEventMap.set(identName, domEvent)
                  }
                }
              }
              ts.forEachChild(n, scanNode)
            })
          }
        }

        for (const triggerName of parsedTriggers) {
          const triggerId = `${componentId}-t-${triggerName}`
          const wfId = `${componentId}-wf-${triggerName}`
          const domEvent = domEventMap.get(triggerName)
          scTriggers.push({ id: triggerId, name: triggerName, ...(domEvent ? { domEvent } : {}) })
          scWorkflows[wfId] = {
            id: wfId,
            name: triggerName,
            trigger: domEvent ?? 'click',
            params: [],
            steps: [{ id: crypto.randomUUID(), type: 'emitComponentTrigger', config: { triggerId } }],
          }
          scTriggerMap.set(triggerName, wfId)
        }

        // Compile the render JSX
        let uiTree = null
        const propNames = Object.keys(props)
        const renderArg = decl.initializer.arguments[2]
        if (renderArg && (ts.isArrowFunction(renderArg) || ts.isFunctionExpression(renderArg))) {
          try {
            // ── Local const inlining ──────────────────────────────────────────
            // Extract local const/let declarations from the render function body
            // (e.g. `const bgColor = type === 'operator' ? '#FF9F0A' : ...`)
            // and substitute their names in the render source so they don't become
            // bare `{ js: "bgColor" }` bindings that resolve to undefined at runtime.
            const renderBody = renderArg.body
            const renderSrc = nodeText(renderArg)
            let processedRenderSrc = renderSrc

            if (ts.isBlock(renderBody)) {
              for (const stmt of renderBody.statements) {
                if (!ts.isVariableStatement(stmt)) continue
                for (const vDecl of stmt.declarationList.declarations) {
                  if (!ts.isIdentifier(vDecl.name) || !vDecl.initializer) continue
                  const constName = vDecl.name.text
                  // Skip PascalCase names (local component references, not value consts)
                  if (/^[A-Z]/.test(constName)) continue
                  const constExpr = vDecl.initializer.getText().trim()
                  // Inline: replace every bare reference to constName with its expression
                  processedRenderSrc = replaceIdentInCode(processedRenderSrc, constName, `(${constExpr})`)
                }
              }
            }

            // Wrap the (processed) render fn in a fake definePage call
            const fakePageSrc = `
              import { Box, Text, Image } from 'builder'
              export default definePage({ path: '/__sc__' }, ${processedRenderSrc})
            `
            // Pass propNames so the compiler rewrites bare prop identifiers →
            // context.component?.props?.['name'] inside the SC render function.
            // Pass scTriggerMap so onClick={triggerName} compiles to actions.
            const compiled = compilePageToJson(fakePageSrc, pathToId, undefined, propNames, scTriggerMap)
            if (compiled?.content) {
              uiTree = compiled.content
              // Stamp _sharedKey on every node so the builder can identify
              // individual instances and match them back to the model.
              stampKeys(uiTree as Record<string, unknown>)
            }
          } catch { /* skip render compilation */ }
        }

        // Convert props object to SharedComponentModel properties array
        const properties = Object.entries(props).map(([propName, propDef]) => {
          const typeMap: Record<string, string> = { string: 'Text', number: 'Number', boolean: 'Boolean', array: 'Array', object: 'Object' }
          return {
            id: propName,
            name: propName,
            type: typeMap[propDef.type?.toLowerCase() ?? ''] ?? 'Text',
            ...(propDef.defaultValue !== undefined ? { defaultValue: propDef.defaultValue } : {}),
          }
        })

        const config: Record<string, unknown> = {
          id: componentId,
          name: componentId,
          properties,
          content: uiTree ?? {},
          folder: 'DSL',
          _dslName: exportName,
        }
        if (scTriggers.length > 0) config.triggers = scTriggers
        if (Object.keys(scWorkflows).length > 0) config.workflows = scWorkflows

        events.push({ type: 'component_written', path: `components/${componentId}/component`, content: JSON.stringify(config) })
      }
    }
    ts.forEachChild(node, visit)
  })

  return events
}

// ─── Page name fallback ───────────────────────────────────────────────────────

function inferPageNameFromSource(content: string): string | null {
  // New API: definePage('/path', fn)
  const strMatch = content.match(/definePage\s*\(\s*['"`](\/[^'"`]*|\/?)['"`]/)
  if (strMatch) {
    const p = strMatch[1].replace(/^\/+/, '') || 'home'
    return p.split('/').pop() ?? p
  }
  // Old API: definePage({ path: '/...' })
  if (/definePage\s*\(\s*\{[^}]*path\s*:\s*['"`]\/['"`]/.test(content)) return 'home'
  const pathMatch = content.match(/definePage\s*\(\s*\{[^}]*path\s*:\s*['"`]([^'"`/\s]+)/)
  if (pathMatch?.[1]) return pathMatch[1]
  const slashMatch = content.match(/definePage\s*\(\s*\{[^}]*path\s*:\s*['"`]\/([^'"`\s]+)/)
  if (slashMatch?.[1]) return slashMatch[1].split('/').pop() ?? null
  return null
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Compile all DSL source files in two passes and return the list of events
 * that describe every change to be applied to the builder store.
 */
export function compileAllSources(
  sources: Record<string, string>,
  projectId = 'dsl',
): CompiledEvent[] {
  const declMap = pass1Collect(sources, projectId)
  return pass2Compile(sources, declMap, projectId)
}

/** Expose the DeclMap publicly for tooling / testing. */
export type { DeclMap as DeclMapType }
