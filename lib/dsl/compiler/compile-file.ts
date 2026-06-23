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
      const src = nodeText(node)
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
        .replace(/'/g, '"')
        .replace(/,(\s*[}\]])/g, '$1')
      return { value: JSON.parse(src), type: 'array' }
    } catch { return { value: [], type: 'array' } }
  }

  if (ts.isObjectLiteralExpression(node)) {
    try {
      const src = nodeText(node)
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
        .replace(/'/g, '"')
        .replace(/,(\s*[}\]])/g, '$1')
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

/**
 * Compile a component-internal workflow body (defineWorkflow(() => { ... })).
 * Recognises setVar, navigate, and falls back to runJavaScript for other statements.
 * `nameMap` is used to replace internal SC state names with their `variables[...]` paths.
 */
function compileScWorkflowBody(
  body: ts.Block,
  pathToId: Map<string, string>,
  nameMap: Map<string, string>,
): unknown[] {
  const steps: unknown[] = []
  let jsBuffer: string[] = []

  function flushJs() {
    if (jsBuffer.length === 0) return
    let code = jsBuffer.join('\n').trim()
    if (!code) return
    for (const [name, replacement] of nameMap.entries()) {
      code = replaceIdentInCode(code, name, replacement)
    }
    steps.push({ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } })
    jsBuffer = []
  }

  for (const stmt of body.statements) {
    if (
      ts.isExpressionStatement(stmt) &&
      ts.isCallExpression(stmt.expression) &&
      ts.isIdentifier(stmt.expression.expression)
    ) {
      const fn = stmt.expression.expression.text
      if (fn === 'setVar') {
        flushJs()
        const pathArg = stmt.expression.arguments[0]
        const valArg  = stmt.expression.arguments[1]
        const varName = ts.isIdentifier(pathArg) ? pathArg.text : nodeText(pathArg)
        // Resolve the variable name via the internal name map first, then pathToId
        const variableName = nameMap.has(varName)
          ? nameMap.get(varName)!.replace(/^variables\['(.+)'\]$/, '$1')
          : (pathToId.get(varName) ?? varName)
        let value: unknown = null
        if (valArg) {
          if (ts.isStringLiteral(valArg)) {
            value = valArg.text
          } else {
            let expr = nodeText(valArg)
            for (const [n, r] of nameMap.entries()) {
              expr = replaceIdentInCode(expr, n, r)
            }
            value = { js: expr }
          }
        }
        steps.push({ id: crypto.randomUUID(), type: 'changeVariableValue', config: { variableName, value } })
        continue
      }
      if (fn === 'navigate') {
        flushJs()
        const navPath = ts.isStringLiteral(stmt.expression.arguments[0])
          ? stmt.expression.arguments[0].text
          : nodeText(stmt.expression.arguments[0])
        steps.push({ id: crypto.randomUUID(), type: 'navigateTo', config: { path: navPath } })
        continue
      }
    }
    jsBuffer.push(nodeText(stmt))
  }
  flushJs()
  return steps
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

  // ── Pre-pass: compile ALL defineComponent files first ─────────────────────
  // This builds globalRuntimeScMap so cross-file SC references (e.g. a page
  // using a component defined in components/CalcButton.tsx) are always resolved
  // regardless of file iteration order.
  type ScMapEntry = { id: string; name: string; content: Record<string, unknown>; triggers?: Array<{ id: string; name: string }> }
  const globalRuntimeScMap = new Map<string, ScMapEntry>()

  for (const [srcFile, content] of Object.entries(sources)) {
    if (!content.includes('defineComponent')) continue
    try {
      const scEvents = compileComponents(content, declMap, pathToId, projectId)
      for (const ev of scEvents) {
        if (ev.type === 'component_written') {
          try {
            const parsed = JSON.parse(ev.content) as Record<string, unknown>
            events.push({ ...ev, content: JSON.stringify({ ...parsed, _src: srcFile }) })
            const scId = String(parsed.id ?? '')
            const scName = String(parsed.name ?? scId)
            const uiArr = parsed.ui as unknown[] | undefined
            const scContent = (Array.isArray(uiArr) ? uiArr[0] : parsed.content) as Record<string, unknown> | undefined
            const scTriggers = parsed.triggers as Array<{ id: string; name: string; domEvent?: string }> | undefined
            if (scId && scContent) globalRuntimeScMap.set(scName.toLowerCase(), { id: scId, name: scName, content: scContent, triggers: scTriggers })
          } catch { events.push(ev) }
        } else {
          events.push(ev)
        }
      }
    } catch { /* skip */ }
  }

  // ── Main pass: compile everything except defineComponent ───────────────────
  for (const [srcFile, content] of Object.entries(sources)) {
    // ── Variables ─────────────────────────────────────────────────────────────
    if (content.includes('defineVar')) {
      try {
        // Patch the source so old compileVarsToJson handles new single-arg defineVar
        const patched = patchVarSource(content, declMap)
        const compiledVars = compileVarsToJson(patched, projectId)
        for (const v of compiledVars) {
          const entry = { ...v.entry, _dslName: v.varName, _src: srcFile }
          events.push({ type: 'var_written', path: `store/${v.varName}`, content: JSON.stringify(entry) })
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
          const config = { ...wf.config, _dslName: wf.wfName, _src: srcFile }
          events.push({ type: 'workflow_written', path: `workflows/${wf.wfName}`, content: JSON.stringify(config) })
        }
      } catch { /* skip */ }
    }

    // ── Functions (defineFunction / defineFormula) ─────────────────────────────
    if (content.includes('defineFunction') || content.includes('defineFormula')) {
      try {
        const fnEvents = compileFunctions(content, declMap, pathToId, projectId)
        for (const ev of fnEvents) {
          const parsed = JSON.parse(ev.content) as Record<string, unknown>
          events.push({ ...ev, content: JSON.stringify({ ...parsed, _src: srcFile }) })
        }
      } catch { /* skip */ }
    }

    // ── Datasources ────────────────────────────────────────────────────────────
    if (content.includes('defineDatasource')) {
      try {
        const dsEvents = compileDatasources(content, declMap, projectId)
        for (const ev of dsEvents) {
          const parsed = JSON.parse(ev.content) as Record<string, unknown>
          events.push({ ...ev, content: JSON.stringify({ ...parsed, _src: srcFile }) })
        }
      } catch { /* skip */ }
    }

    // ── Triggers ──────────────────────────────────────────────────────────────
    if (content.includes('defineTrigger')) {
      try {
        const trigEvents = compileTriggers(content, pathToId, srcFile)
        events.push(...trigEvents)
      } catch { /* skip */ }
    }

    // ── Pages — use globalRuntimeScMap so cross-file SCs are resolved ─────────
    if (content.includes('definePage')) {
      try {
        const patched = patchPageSource(content)
        const compiledPages = compilePageToJson(patched, pathToId, globalRuntimeScMap)
        for (const compiled of compiledPages) {
          const pageName = compiled.pageName
          events.push({
            type: 'page_written',
            path: `pages/${pageName}/page`,
            content: JSON.stringify({ meta: { title: compiled.title, _src: srcFile }, ui: [compiled.content] }),
          })
          routes.push({
            path: `/${pageName === 'home' ? '' : pageName}`,
            config: pageName,
            name: compiled.title || pageName,
          })
          // Emit inline workflows under the page path so applyVirtualFile assigns pageScope automatically
          for (const [id, wf] of (compiled.inlineWorkflows ?? new Map())) {
            events.push({ type: 'workflow_written', path: `pages/${pageName}/workflows/${id}`, content: JSON.stringify(wf) })
          }
        }
        if (compiledPages.length === 0) {
          // fallback: register route stub
          const pageName = inferPageNameFromSource(content)
          if (pageName && !routes.find(r => r.config === pageName)) {
            routes.push({ path: `/${pageName === 'home' ? '' : pageName}`, config: pageName, name: pageName })
          }
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

// ─── Trigger compilation ──────────────────────────────────────────────────────

/**
 * Compile all `defineTrigger('type', fn)` or `export const x = defineTrigger(...)` calls
 * in a source file and emit `trigger_written` events.
 *
 * App-level triggers  → path: `actions/app-triggers`
 * Page-level triggers → path: `actions/dsl-triggers-{page}`
 *   (detected from srcFile: pages/home/triggers.ts → page = 'home')
 */
function compileTriggers(
  content: string,
  pathToId: Map<string, string>,
  srcFile: string,
): CompiledEvent[] {
  const events: CompiledEvent[] = []

  // Derive page scope from srcFile path: "pages/home/triggers.ts" → "home"
  let pageScope: string | undefined
  const pageMatch = srcFile.match(/pages\/([^/]+)\//)
  if (pageMatch) pageScope = pageMatch[1]

  const sf = ts.createSourceFile(srcFile, content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  function compileBodyToSteps(body: ts.Block | ts.Expression): unknown[] {
    if (!ts.isBlock(body)) {
      return [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code: nodeText(body) } }]
    }
    const steps: unknown[] = []
    let jsBuffer: string[] = []

    function flushJs() {
      if (jsBuffer.length === 0) return
      const code = jsBuffer.join('\n').trim()
      if (code) steps.push({ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } })
      jsBuffer = []
    }

    for (const stmt of body.statements) {
      if (
        ts.isExpressionStatement(stmt) &&
        ts.isCallExpression(stmt.expression) &&
        ts.isIdentifier(stmt.expression.expression)
      ) {
        const fn = stmt.expression.expression.text
        if (fn === 'fetch') {
          flushJs()
          const dsArg = stmt.expression.arguments[0]
          const dsPath = ts.isStringLiteral(dsArg) ? dsArg.text : nodeText(dsArg)
          const collectionName = pathToId.get(dsPath) ?? pathToId.get(`data/${dsPath}`) ?? dsPath
          steps.push({ id: crypto.randomUUID(), type: 'fetchCollection', config: { collectionName } })
          continue
        }
        if (fn === 'setVar') {
          flushJs()
          const pathArg = stmt.expression.arguments[0]
          const valArg  = stmt.expression.arguments[1]
          const vfsPath = ts.isIdentifier(pathArg) ? pathArg.text : nodeText(pathArg)
          const variableName = pathToId.get(vfsPath) ?? pathToId.get(`store/${vfsPath}`) ?? vfsPath
          const value = valArg
            ? (ts.isStringLiteral(valArg) ? valArg.text : { js: nodeText(valArg) })
            : null
          steps.push({ id: crypto.randomUUID(), type: 'changeVariableValue', config: { variableName, value } })
          continue
        }
        if (fn === 'navigate') {
          flushJs()
          const navPath = ts.isStringLiteral(stmt.expression.arguments[0])
            ? stmt.expression.arguments[0].text
            : nodeText(stmt.expression.arguments[0])
          steps.push({ id: crypto.randomUUID(), type: 'navigateTo', config: { path: navPath } })
          continue
        }
      }
      jsBuffer.push(nodeText(stmt))
    }
    flushJs()
    return steps
  }

  function visitNode(node: ts.Node) {
    // Named: export const onLoad = defineTrigger('appLoad', () => {...})
    // or unnamed: export default defineTrigger('appLoad', () => {...})
    let triggerType: string | null = null
    let dslName: string | null = null
    let fnArg: ts.ArrowFunction | ts.FunctionExpression | null = null

    if (
      ts.isVariableStatement(node)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        if (!ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineTrigger') continue

        dslName = decl.name.text
        const typeArg = decl.initializer.arguments[0]
        const fnArgNode = decl.initializer.arguments[1]
        if (typeArg && ts.isStringLiteral(typeArg)) triggerType = typeArg.text
        if (fnArgNode && (ts.isArrowFunction(fnArgNode) || ts.isFunctionExpression(fnArgNode))) {
          fnArg = fnArgNode as ts.ArrowFunction | ts.FunctionExpression
        }
      }
    }

    if (triggerType && fnArg) {
      const id = crypto.randomUUID()
      const steps = compileBodyToSteps(fnArg.body as ts.Block | ts.Expression)
      const entry: Record<string, unknown> = {
        id,
        name: triggerType,
        trigger: triggerType,
        steps,
        _dslName: dslName ?? triggerType,
        _src: srcFile,
      }
      if (pageScope) entry.pageScope = pageScope

      const targetPath = pageScope ? `actions/dsl-triggers-${pageScope}` : 'actions/app-triggers'
      events.push({ type: 'trigger_written', path: targetPath, content: JSON.stringify({ [id]: entry }) })
    }
    ts.forEachChild(node, visitNode)
  }

  ts.forEachChild(sf, visitNode)
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
  // This is handled by compileAllWorkflowsToJson which uses the Babel lowerAction.
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
 * Hoist all import declarations to the top of the file and deduplicate them.
 *
 * AI-generated multi-page DSL files often emit one `import` block per page
 * section. TypeScript's parser treats the *last* import it encounters as the
 * start of the module body and silently ignores everything declared before it,
 * causing the first page and its workflows to be dropped. This normalisation
 * fixes that by consolidating every `import { … } from '…'` line to the top.
 */
function normalizeImports(source: string): string {
  // Matches single-line `import { … } from 'path'` or `import { … } from "path"`
  // (possibly with a trailing semicolon). DSL files always use this style.
  const importRe = /^import\s+\{[^}\n]*\}\s+from\s+['"][^'"]+['"];?\s*(?:\r?\n)?/gm
  const seen = new Set<string>()
  const collected: string[] = []

  const rest = source.replace(importRe, match => {
    const key = match.trim().replace(/;$/, '')
    if (!seen.has(key)) {
      seen.add(key)
      collected.push(key)
    }
    return ''
  })

  if (collected.length === 0) return source
  return collected.join('\n') + '\n\n' + rest.replace(/^(\r?\n)+/, '')
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

  // Inline module-level literal consts so identifiers like GRAY, DARK, ORANGE
  // are substituted with their values before page compilation.
  // Only string / number / boolean literals are inlined (no side effects).
  const sf2 = ts.createSourceFile('__patch2.tsx', result, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  for (const stmt of sf2.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
      const constName = decl.name.text
      const init = decl.initializer
      if (
        ts.isStringLiteral(init) ||
        ts.isNumericLiteral(init) ||
        init.kind === ts.SyntaxKind.TrueKeyword ||
        init.kind === ts.SyntaxKind.FalseKeyword
      ) {
        result = replaceIdentInCode(result, constName, `(${init.getText(sf2)})`)
      }
    }
  }

  return result
}

// ─── Function (formula) compiler ─────────────────────────────────────────────

/**
 * Replace a bare identifier in a JS code string with a replacement expression,
 * skipping occurrences inside string literals and after property-access dots.
 * Used for global DSL-name → variables['uuid'] resolution only.
 */
function replaceIdentInBodyForParam(code: string, name: string, replacement: string): string {
  const identRe = new RegExp(`(?<![.'"\\w])\\b${name}\\b(?!['"])`, 'g')
  if (!code.includes('"') && !code.includes("'") && !code.includes('`')) {
    return code.replace(identRe, replacement)
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
          out.push(code.slice(s, i).replace(identRe, replacement))
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
    out.push(code.slice(start, i).replace(identRe, replacement))
  }
  return out.join('')
}

const DEFINE_CALL_NAMES_SET = new Set([
  'defineVar', 'defineWorkflow', 'defineFunction', 'defineFormula',
  'defineDatasource', 'defineComponent', 'defineTrigger', 'definePage',
])

/**
 * Collect all module-level non-exported, non-define* const/function declarations
 * as structured entries so callers can filter per function by which names actually
 * appear in the function body (rawBody.includes(name)).
 */
function collectModuleBlob(sf: ts.SourceFile): { entries: Array<{ name: string; decl: string }> } {
  const entries: Array<{ name: string; decl: string }> = []

  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      if ((stmt.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
      const decl_text = nodeText(stmt)
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const init = decl.initializer
        // Skip define* calls — those are handled by their own compiler passes
        if (
          ts.isCallExpression(init) &&
          ts.isIdentifier(init.expression) &&
          DEFINE_CALL_NAMES_SET.has(init.expression.text)
        ) continue
        entries.push({ name: decl.name.text, decl: decl_text })
      }
    } else if (ts.isFunctionDeclaration(stmt)) {
      if ((stmt.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
      if (stmt.name) {
        entries.push({ name: stmt.name.text, decl: nodeText(stmt) })
      }
    }
  }

  return { entries }
}

function compileFunctions(
  source: string,
  declMap: DeclMap,
  pathToId: Map<string, string>,
  _projectId: string,
): CompiledEvent[] {
  const events: CompiledEvent[] = []
  const sf = ts.createSourceFile('__fn.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  // Collect module-level consts/helpers (non-define*, non-exported) as structured
  // entries. Each function filters to only the entries it actually references so
  // unrelated consts (e.g. WEEKDAYS in pad2) are not bundled in.
  const { entries: moduleEntries } = collectModuleBlob(sf)
  const moduleDeclaredSet = new Set(moduleEntries.map(e => e.name))

  // Single pass — visit both exported and non-exported defineFunction declarations.
  ts.forEachChild(sf, function visit(node: ts.Node) {
    if (!ts.isVariableStatement(node)) return
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
      if (!ts.isCallExpression(decl.initializer)) continue
      if (!ts.isIdentifier(decl.initializer.expression)) continue
      const callee = decl.initializer.expression.text
      if (callee !== 'defineFunction' && callee !== 'defineFormula') continue

      const name = decl.name.text
      const fnArg = decl.initializer.arguments[0]
      if (!fnArg) continue

      // Extract raw body text + real param names. Track isConcise (arrow with no block)
      // so we can add an explicit return() when the blob is prepended later.
      let rawBody = ''
      let paramNames: string[] = []
      let isConcise = false
      if (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg)) {
        const fn = fnArg as ts.ArrowFunction | ts.FunctionExpression
        paramNames = fn.parameters
          .map(p => ts.isIdentifier(p.name) ? p.name.text : '')
          .filter(Boolean)
        if (ts.isBlock(fn.body)) {
          rawBody = fn.body.getText().slice(1, -1).trim()
        } else {
          rawBody = nodeText(fn.body as ts.Node)
          isConcise = true
        }
      } else {
        rawBody = nodeText(fnArg)
      }

      // Rewrite params to parameters.X BEFORE global resolution.
      // The lookbehind on '.' in replaceIdentInBodyForParam prevents double-rewriting
      // if the body already contains 'parameters.x' from a prior run.
      let resolvedBody = rawBody
      for (const paramName of paramNames) {
        // Pre-pass: handle spread syntax `...paramName` → `...parameters.paramName`.
        // The main replacer's lookbehind blocks this because `...` ends with `.`.
        resolvedBody = resolvedBody.replace(
          new RegExp(`\\.\\.\\.${paramName}\\b`, 'g'),
          `...parameters.${paramName}`,
        )
        resolvedBody = replaceIdentInBodyForParam(resolvedBody, paramName, `parameters.${paramName}`)
      }
      // Fix shorthand object properties that became invalid after param rewriting.
      // e.g. `{ id: nextId, text, done: false }` → `{ id: parameters.nextId, parameters.text, done: false }`
      // The `parameters.text` in shorthand position is not valid JS; convert to `text: parameters.text`.
      // Lookahead must be `}` only (not `,`) to avoid incorrectly firing on function call arguments
      // where `(a, parameters.b, c)` has commas that would otherwise match.
      resolvedBody = resolvedBody.replace(
        /([{,]\s*)(parameters\.([a-zA-Z_$][\w$]*))\s*(?=\s*})/g,
        (_, prefix, full, propName) => `${prefix}${propName}: ${full}`,
      )

      // Apply global → variables['uuid'] resolution. Module-declared names are skipped
      // (they'll be in scope via the prepended blob). Param names are already gone
      // (rewritten to parameters.X) so the lookbehind naturally prevents double-touch.
      const skipGlobal = moduleDeclaredSet
      for (const [key, uuid] of pathToId) {
        if (key.includes('/') || key === uuid) continue
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) continue
        if (skipGlobal.has(key)) continue
        // Pre-pass: handle spread syntax `...varName` → `...variables['uuid']`.
        // The main replacer's lookbehind on '.' blocks `...players` because the char
        // immediately before `players` is '.', indistinguishable from a property access.
        resolvedBody = resolvedBody.replace(
          new RegExp(`\\.\\.\\.${key}\\b`, 'g'),
          `...variables['${uuid}']`,
        )
        resolvedBody = replaceIdentInBodyForParam(resolvedBody, key, `variables['${uuid}']`)
      }

      // Transitively collect all module entries needed by the function body.
      // A single-pass filter misses indirect deps: if rawBody references `grandTotal`
      // and grandTotal's declaration references `totalAssets`, `totalAssets` must also
      // be included. We recurse until no new entries are added.
      const neededNames = new Set<string>()
      function collectTransitiveDeps(text: string, depth = 0) {
        if (depth > 8) return
        for (const entry of moduleEntries) {
          if (neededNames.has(entry.name)) continue
          if (text.includes(entry.name)) {
            neededNames.add(entry.name)
            collectTransitiveDeps(entry.decl, depth + 1)
          }
        }
      }
      collectTransitiveDeps(rawBody)
      // Preserve original declaration order so earlier deps come before later ones.
      const moduleBlob = moduleEntries.filter(e => neededNames.has(e.name)).map(e => e.decl).join('\n')

      // If a blob is prepended to a concise body, the combined text is a statement
      // block and needs an explicit return so the function doesn't return undefined.
      const formulaBody = moduleBlob
        ? isConcise
          ? `${moduleBlob}\nreturn (${resolvedBody})`
          : `${moduleBlob}\n${resolvedBody}`
        : resolvedBody

      const info = declMap.get(name)
      const uuid = info?.uuid ?? seedUuid(`fn:${name}`)
      const fnParams = paramNames.map((p, i) => ({ id: `p${i + 1}`, name: p, type: 'any' as const }))

      events.push({
        type: 'utils_written',
        path: `utils/${name}`,
        content: JSON.stringify({
          id: uuid, name, label: name,
          formula: { js: formulaBody },
          params: fnParams,
          folder: 'DSL',
          _dslName: name,
        }),
      })
    }
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

        // SC internal state containers (populated during render body scan)
        const scInternalVars: Record<string, unknown> = {}
        const scInternalFormulas: Record<string, unknown> = {}
        const scInternalWorkflows: Record<string, unknown> = {}
        const scInternalReplacements = new Map<string, string>()
        const scInternalNames = new Set<string>()

        if (renderArg && (ts.isArrowFunction(renderArg) || ts.isFunctionExpression(renderArg))) {
          try {
            // ── Local const inlining + component-scoped state detection ──────────
            // Extract local const/let declarations from the render function body.
            // - `defineVar`/`defineWorkflow`/`defineFunction`/`defineFormula` calls
            //   become component-internal variables/workflows/formulas in the SC JSON.
            // - Other consts (e.g. `const bgColor = ...`) are inlined as expressions.
            const renderBody = renderArg.body
            const renderSrc = nodeText(renderArg)
            let processedRenderSrc = renderSrc

            if (ts.isBlock(renderBody)) {
              for (const stmt of renderBody.statements) {
                if (!ts.isVariableStatement(stmt)) continue
                for (const vDecl of stmt.declarationList.declarations) {
                  if (!ts.isIdentifier(vDecl.name) || !vDecl.initializer) continue
                  const constName = vDecl.name.text
                  if (/^[A-Z]/.test(constName)) continue // skip PascalCase component refs

                  if (ts.isCallExpression(vDecl.initializer) && ts.isIdentifier(vDecl.initializer.expression)) {
                    const callee = vDecl.initializer.expression.text

                    if (callee === 'defineVar') {
                      // component-scoped variable
                      const varId = `${componentId}-var-${constName}`
                      const initArg = vDecl.initializer.arguments[0]
                      const { value: initialValue, type: varType } = parseInitialValue(initArg)
                      scInternalVars[varId] = { id: varId, label: constName, type: varType, initialValue }
                      // In render: `count` → `variables['Counter-var-count']`
                      scInternalReplacements.set(constName, `variables['${varId}']`)
                      scInternalNames.add(constName)
                      continue
                    }

                    if (callee === 'defineFunction' || callee === 'defineFormula') {
                      // component-scoped formula
                      const fnId = `${componentId}-fn-${constName}`
                      const fnArg = vDecl.initializer.arguments[0]
                      let formulaExpr = ''
                      if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
                        const fnParams = extractParamNames(fnArg as ts.ArrowFunction | ts.FunctionExpression)
                        const bodyNode = (fnArg as ts.ArrowFunction | ts.FunctionExpression).body
                        const bodyText = ts.isBlock(bodyNode)
                          ? `(() => { ${bodyNode.statements.map(s => nodeText(s)).join('\n')} })()`
                          : nodeText(bodyNode)
                        // Build formula expression: function body with param names as local vars
                        formulaExpr = fnParams.length > 0
                          ? `((${fnParams.join(', ')}) => ${bodyText})`
                          : bodyText
                      } else if (fnArg) {
                        formulaExpr = nodeText(fnArg)
                      }
                      scInternalFormulas[fnId] = { id: fnId, name: constName, formula: formulaExpr }
                      // In render: `display(count)` → the call stays as-is; we just mark it as internal
                      scInternalReplacements.set(constName, `formulas['${fnId}']`)
                      scInternalNames.add(constName)
                      continue
                    }

                    if (callee === 'defineWorkflow') {
                      // component-scoped workflow
                      const wfId = `${componentId}-wf-${constName}`
                      const fnArg = vDecl.initializer.arguments[0]
                      let wfSteps: unknown[] = []
                      if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
                        const bodyNode = (fnArg as ts.ArrowFunction | ts.FunctionExpression).body
                        if (ts.isBlock(bodyNode)) {
                          // Compile steps using the same logic as compileBodyToSteps in compile-trigger.ts
                          wfSteps = compileScWorkflowBody(bodyNode, pathToId, scInternalReplacements)
                        }
                      }
                      scInternalWorkflows[wfId] = { id: wfId, name: constName, params: [], steps: wfSteps }
                      // In render: `increment` as action → the trigger map resolves this; mark as internal
                      scInternalNames.add(constName)
                      // Also register in scTriggerMap so onClick={increment} compiles as a trigger action
                      scTriggerMap.set(constName, wfId)
                      continue
                    }
                  }

                  // Regular const — inline as expression (skip component-scoped names)
                  if (scInternalNames.has(constName)) continue
                  const constExpr = vDecl.initializer.getText().trim()
                  processedRenderSrc = replaceIdentInCode(processedRenderSrc, constName, `(${constExpr})`)
                }
              }
            }

            // Apply component-scoped replacements in the render source
            for (const [name, replacement] of scInternalReplacements.entries()) {
              processedRenderSrc = replaceIdentInCode(processedRenderSrc, name, replacement)
            }

            // Wrap the (processed) render fn in a fake definePage call
            const fakePageSrc = `
              import { Box, Text, Image } from 'builder'
              export default definePage({ path: '/__sc__' }, ${processedRenderSrc})
            `
            // Pass propNames so the compiler rewrites bare prop identifiers →
            // context.component?.props?.['name'] inside the SC render function.
            // Pass scTriggerMap so onClick={triggerName} compiles to actions.
            const [compiled] = compilePageToJson(fakePageSrc, pathToId, undefined, propNames, scTriggerMap)
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
        const allWorkflows = { ...scWorkflows, ...scInternalWorkflows }
        if (Object.keys(allWorkflows).length > 0) config.workflows = allWorkflows
        if (Object.keys(scInternalVars).length > 0) config.variables = scInternalVars
        if (Object.keys(scInternalFormulas).length > 0) config.formulas = scInternalFormulas

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
  // Consolidate any mid-file import declarations to the top so the TypeScript
  // parser sees all declarations in every page section of the file.
  const normalized = Object.fromEntries(
    Object.entries(sources).map(([k, v]) => [k, normalizeImports(v)])
  )
  const declMap = pass1Collect(normalized, projectId)
  return pass2Compile(normalized, declMap, projectId)
}

/** Expose the DeclMap publicly for tooling / testing. */
export type { DeclMap as DeclMapType }
