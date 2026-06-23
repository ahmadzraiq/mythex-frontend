/**
 * Compiles defineWorkflow() to config/actions/<name>.json.
 *
 * Step compilation strategy:
 *   setVar('store/x', val)          → changeVariableValue step
 *   navigate('/path', params)       → navigateTo step
 *   fetch('data/x')                 → fetchCollection step
 *   if/else block                   → branch step
 *   for...of / array.forEach        → forEach step
 *   Everything else                  → runJavaScript step (whole body or segment)
 *
 * vars['store/x'] and bare variable references in runJavaScript code are rewritten to
 * variables['<uuid>'] via the shared Babel lowering (lowerAction).
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
import { lowerAction, lowerExpression, makeEnv } from './lower/index'
import type { WorkflowParam } from '@/config/types'

export interface WorkflowStep {
  id: string
  name?: string
  type: string
  config?: Record<string, unknown>
  trueBranch?: WorkflowStep[]
  falseBranch?: WorkflowStep[]
  loopBody?: WorkflowStep[]
  branches?: Array<{ condition?: string; steps: WorkflowStep[]; label?: string }>
}

interface WorkflowConfig {
  name: string
  trigger: string
  params?: WorkflowParam[]
  steps: WorkflowStep[]
  _src?: string
}

// ─── Helper: extract WorkflowParam[] from a function parameter list ──────────

function extractWorkflowParams(parameters: ts.NodeArray<ts.ParameterDeclaration>): WorkflowParam[] {
  const params: WorkflowParam[] = []
  parameters.forEach((p, i) => {
    if (!ts.isIdentifier(p.name)) return
    const tsType = p.type ? p.type.getText().trim() : 'string'
    const wfType = tsType === 'number' ? 'Number'
      : tsType === 'boolean' ? 'Boolean'
      : tsType.startsWith('object') || tsType.startsWith('Record') ? 'Object'
      : 'Text'
    params.push({ id: `param-${i}`, name: p.name.text, type: wfType as WorkflowParam['type'] })
  })
  return params
}

// ─── Helper: expression text from source ─────────────────────────────────────

function nodeText(node: ts.Node): string {
  return node.getText().trim()
}

// ─── Workflow parameter replacement ──────────────────────────────────────────

/**
 * Replace a bare identifier in JS code, skipping string literal content.
 * Same semantics as replaceIdentInCode in compile-page.ts.
 */
function replaceParamInCode(code: string, name: string, replacement: string): string {
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

/**
 * Apply all parameter replacements (name → parameters.name) to a JS expression string.
 */
function applyParamMap(code: string, paramMap: Map<string, string>): string {
  let result = code
  for (const [name, ref] of paramMap) {
    result = replaceParamInCode(result, name, ref)
  }
  return result
}

/**
 * Convert a setVar() call to an inline `variables['uuid'] = val` JS statement.
 * The uuid is resolved directly from pathToId — no resolver pass needed for the
 * LHS. The RHS stays as raw text so the bulk resolver pass picks up any variable
 * identifier refs inside it.
 */
function compileSetVarToInlineJs(
  stmt: ts.Statement,
  pathToId: Map<string, string>,
): string {
  if (!ts.isExpressionStatement(stmt)) return nodeText(stmt)
  const expr = stmt.expression

  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'setVar'
  ) {
    const pathArg = expr.arguments[0]
    const valArg  = expr.arguments[1]
    const vfsPath = ts.isStringLiteral(pathArg) ? pathArg.text : nodeText(pathArg)
    const uuid    = pathToId.get(vfsPath) ?? pathToId.get(`store/${vfsPath}`) ?? vfsPath

    if (!valArg) return `variables['${uuid}'] = undefined`

    let val: string
    if (ts.isStringLiteral(valArg)) {
      val = JSON.stringify(valArg.text)
    } else if (ts.isNumericLiteral(valArg)) {
      val = valArg.text
    } else if (valArg.kind === ts.SyntaxKind.TrueKeyword) {
      val = 'true'
    } else if (valArg.kind === ts.SyntaxKind.FalseKeyword) {
      val = 'false'
    } else if (valArg.kind === ts.SyntaxKind.NullKeyword) {
      val = 'null'
    } else {
      val = nodeText(valArg)
    }
    return `variables['${uuid}'] = ${val}`
  }

  // vars['store/x'] = val  (assignment shorthand)
  return nodeText(stmt)
}

/**
 * Convert a single statement to raw JS text for use inside a single-block
 * runJavaScript step:
 *   setVar(x, val)   → variables['uuid'] = val
 *   if/else          → if/else with recursive conversion of bodies
 *   navigate(path)   → await wwLib.navigate.to(path)
 *   fetch(ds)        → await wwLib.collections.refetch('uuid')
 *   everything else  → raw node text (resolvers applied at flush time)
 */
function stmtToInlineJs(
  stmt: ts.Statement,
  pathToId: Map<string, string>,
  paramMap?: Map<string, string>,
): string {
  const kind = classifyStatement(stmt)

  if (kind.kind === 'setVar') {
    return compileSetVarToInlineJs(stmt, pathToId)
  }

  if (kind.kind === 'navigate') {
    const call = (stmt as ts.ExpressionStatement).expression as ts.CallExpression
    const pathArg   = call.arguments[0]
    const paramsArg = call.arguments[1]
    const path   = ts.isStringLiteral(pathArg) ? JSON.stringify(pathArg.text) : nodeText(pathArg)
    const params = paramsArg ? `, ${nodeText(paramsArg)}` : ''
    return `await wwLib.navigate.to(${path}${params})`
  }

  if (kind.kind === 'fetch') {
    const call    = (stmt as ts.ExpressionStatement).expression as ts.CallExpression
    const dsArg   = call.arguments[0]
    const dsPath  = ts.isStringLiteral(dsArg) ? dsArg.text : nodeText(dsArg)
    const uuid    = pathToId.get(dsPath) ?? pathToId.get(`data/${dsPath}`) ?? dsPath
    return `await wwLib.collections.refetch(${JSON.stringify(uuid)})`
  }

  if (kind.kind === 'branch') {
    const ifStmt = stmt as ts.IfStatement
    const thenJs = blockBodyToInlineJs(ifStmt.thenStatement, pathToId, paramMap)
    let result = `if (${nodeText(ifStmt.expression)}) {\n${thenJs}\n}`
    if (ifStmt.elseStatement) {
      if (ts.isIfStatement(ifStmt.elseStatement)) {
        result += ` else ${stmtToInlineJs(ifStmt.elseStatement, pathToId, paramMap)}`
      } else {
        result += ` else {\n${blockBodyToInlineJs(ifStmt.elseStatement, pathToId, paramMap)}\n}`
      }
    }
    return result
  }

  // 'js' | 'forEach' → raw text; resolvers applied on the full block at flush
  return nodeText(stmt)
}

function blockBodyToInlineJs(
  node: ts.Node,
  pathToId: Map<string, string>,
  paramMap?: Map<string, string>,
): string {
  if (ts.isBlock(node)) {
    return node.statements.map(s => stmtToInlineJs(s, pathToId, paramMap)).join('\n')
  }
  if (ts.isStatement(node)) {
    return stmtToInlineJs(node as ts.Statement, pathToId, paramMap)
  }
  return nodeText(node)
}

// ─── Detect step type from statement ─────────────────────────────────────────

interface StepCandidate {
  kind: 'setVar' | 'navigate' | 'fetch' | 'branch' | 'forEach' | 'js'
  node: ts.Node
}

function classifyStatement(stmt: ts.Statement): StepCandidate {
  // Expression statement: setVar(...), navigate(...), fetch(...)
  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      const fn = expr.expression.text
      if (fn === 'setVar')    return { kind: 'setVar',   node: stmt }
      if (fn === 'navigate')  return { kind: 'navigate', node: stmt }
      if (fn === 'fetch')     return { kind: 'fetch',    node: stmt }
    }
    // vars['store/x'] = val (assignment as expression)
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = expr.left
      if (
        ts.isElementAccessExpression(lhs) &&
        ts.isIdentifier(lhs.expression) &&
        lhs.expression.text === 'vars'
      ) {
        return { kind: 'setVar', node: stmt }
      }
    }
  }

  if (ts.isIfStatement(stmt)) return { kind: 'branch', node: stmt }

  if (ts.isForOfStatement(stmt) || ts.isForInStatement(stmt)) {
    return { kind: 'forEach', node: stmt }
  }
  // array.forEach(...) → treat as forEach step
  if (
    ts.isExpressionStatement(stmt) &&
    ts.isCallExpression(stmt.expression) &&
    ts.isPropertyAccessExpression(stmt.expression.expression) &&
    stmt.expression.expression.name.text === 'forEach'
  ) {
    return { kind: 'forEach', node: stmt }
  }

  return { kind: 'js', node: stmt }
}

// ─── Collect top-level non-DSL helper functions from a source file ────────────

const DSL_DEFINE_CALLS = new Set(['defineWorkflow', 'defineVar', 'defineFunction', 'definePage', 'defineComponent'])

/**
 * Collect module-level plain literal constants (const TOTAL = 3, const NAME = 'x', etc.)
 * so they can be inlined into runJavaScript step code where the runtime has no access
 * to the DSL module scope. Mirrors _currentPageLocals in compile-page.ts.
 */
function collectModuleLiteralConsts(sf: ts.SourceFile): Map<string, string> {
  const result = new Map<string, string>()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
      const init = decl.initializer
      // Skip all DSL define* calls
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        DSL_DEFINE_CALLS.has(init.expression.text)
      ) continue
      // Skip functions/arrows — handled by collectHelperDefs
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) continue
      // Collect primitive literals and literal arrays/objects
      if (
        ts.isNumericLiteral(init) ||
        ts.isStringLiteral(init) ||
        ts.isNoSubstitutionTemplateLiteral(init) ||
        init.kind === ts.SyntaxKind.TrueKeyword ||
        init.kind === ts.SyntaxKind.FalseKeyword ||
        ts.isArrayLiteralExpression(init) ||
        ts.isObjectLiteralExpression(init)
      ) {
        result.set(decl.name.text, nodeText(init))
        continue
      }
      // Handle `X.length` where X is a previously-collected array literal —
      // evaluate the length at compile time so `const total = posts.length`
      // becomes `const total = 15` in workflow code.
      if (
        ts.isPropertyAccessExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.name.text === 'length' &&
        result.has(init.expression.text)
      ) {
        const targetName = init.expression.text
        for (const s of sf.statements) {
          if (!ts.isVariableStatement(s)) continue
          for (const d of s.declarationList.declarations) {
            if (
              ts.isIdentifier(d.name) && d.name.text === targetName &&
              d.initializer && ts.isArrayLiteralExpression(d.initializer)
            ) {
              result.set(decl.name.text, String(d.initializer.elements.length))
            }
          }
        }
      }
    }
  }
  return result
}

function collectHelperDefs(sf: ts.SourceFile): Map<string, string> {
  const helpers = new Map<string, string>()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      if (!decl.initializer) continue

      // Capture defineWorkflow bodies as inlineable helpers so one workflow
      // can call another and have it inlined in the same runJavaScript step.
      if (ts.isCallExpression(decl.initializer) &&
          ts.isIdentifier(decl.initializer.expression) &&
          decl.initializer.expression.text === 'defineWorkflow') {
        const innerFn = decl.initializer.arguments[0]
        if (innerFn && (ts.isArrowFunction(innerFn) || ts.isFunctionExpression(innerFn))) {
          const fn = innerFn as ts.ArrowFunction | ts.FunctionExpression
          const params = fn.parameters.map(p => p.getText()).join(', ')
          const bodyText = fn.body.getText()
          helpers.set(decl.name.text, `const ${decl.name.text} = (${params}) => ${bodyText}`)
        }
        continue
      }

      // Skip other DSL define* calls
      if (ts.isCallExpression(decl.initializer) &&
          ts.isIdentifier(decl.initializer.expression) &&
          DSL_DEFINE_CALLS.has(decl.initializer.expression.text)) continue
      // Collect plain arrow functions and regular function expressions
      if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
        helpers.set(decl.name.text, stmt.getText().trim())
      }
    }
  }
  return helpers
}

/**
 * Prepend any referenced helper definitions to the given code block.
 * For helpers extracted from defineWorkflow bodies, variable references are
 * resolved to UUIDs before prepending so they work inside runJavaScript steps.
 */
function prependHelpers(
  code: string,
  helperDefs: Map<string, string>,
  pathToId: Map<string, string>,
  paramMap?: Map<string, string>,
): string {
  const preamble: string[] = []
  for (const [helperName, helperText] of helperDefs) {
    if (!code.includes(helperName)) continue
    let resolved = lowerExpression(helperText, makeEnv({ pathToId }))
    if (paramMap) resolved = applyParamMap(resolved, paramMap)
    preamble.push(resolved)
  }
  return preamble.length > 0 ? `${preamble.join('\n')}\n${code}` : code
}

// ─── Compile a block of statements to a single runJavaScript step ─────────────

/**
 * Compiles the entire workflow body into exactly ONE runJavaScript step.
 * Every statement type (setVar, if/else, for-of, etc.) is converted to its
 * inline JavaScript equivalent via stmtToInlineJs, then the whole block is
 * resolved (variable names → UUIDs) and emitted as a single step.
 * Referenced helper functions (plain helpers and inlined defineWorkflow bodies)
 * are prepended to the step code.
 */
function compileBlockToSteps(
  node: ts.Node,
  pathToId: Map<string, string>,
  paramMap?: Map<string, string>,
  helperDefs?: Map<string, string>,
  constMap?: Map<string, string>,
): WorkflowStep[] {
  const stmts: ts.Statement[] = ts.isBlock(node)
    ? [...node.statements]
    : ts.isStatement(node) ? [node as ts.Statement] : []

  let code = stmts.map(s => stmtToInlineJs(s, pathToId, paramMap)).join('\n').trim()
  if (!code) return []
  code = lowerAction(code, makeEnv({ pathToId }))
  if (paramMap) code = applyParamMap(code, paramMap)
  if (helperDefs) code = prependHelpers(code, helperDefs, pathToId, paramMap)
  // Inline module-level literal constants (e.g. TOTAL → 3) so runJavaScript
  // code doesn't reference identifiers that don't exist in the runtime scope.
  if (constMap) {
    for (const [name, value] of constMap) {
      code = replaceParamInCode(code, name, `(${value})`)
    }
  }
  return [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } }]
}

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

// ─── In-memory compile (no disk I/O) ─────────────────────────────────────────

export interface CompiledWorkflow {
  wfName: string
  uuid: string
  /** wfPath as declared in defineWorkflow({ path: '...' }) */
  wfPath: string
  config: {
    id: string
    meta: { name: string; trigger: string }
    steps: WorkflowStep[]
  }
}

/**
 * Compile a DSL source file containing a defineWorkflow() call to a
 * CompiledWorkflow object. No files are read or written.
 *
 * pathToId maps 'store/<varName>' → uuid for resolving variable references
 * in step code. Pass the map built by compileVarsToJson().
 *
 * uuidSeed should be a stable per-project identifier.
 */
export function compileWorkflowToJson(
  sourceCode: string,
  pathToId: Map<string, string>,
  uuidSeed = 'dsl',
): CompiledWorkflow | null {
  const sf = ts.createSourceFile('dsl-workflow.tsx', sourceCode, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const helperDefs = collectHelperDefs(sf)
  const constMap = collectModuleLiteralConsts(sf)
  let result: CompiledWorkflow | null = null

  function visitNode(node: ts.Node) {
    if (result) return

    const isDefault =
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'defineWorkflow'

    const isNamed =
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)

    let wfName: string | null = null
    let wfPath = ''
    let wfOptions: Record<string, string> = {}
    let wfFn: ts.ArrowFunction | ts.FunctionExpression | null = null

    if (isDefault) {
      const call = node.expression as ts.CallExpression
      const optArg = call.arguments[0]
      const fnArg  = call.arguments[1]
      if (optArg && ts.isObjectLiteralExpression(optArg)) {
        for (const prop of optArg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue
          const k = ts.isIdentifier(prop.name) ? prop.name.text : null
          if (k && ts.isStringLiteral(prop.initializer)) wfOptions[k] = prop.initializer.text
        }
      }
      wfPath = wfOptions.path ?? ''
      wfName = wfPath ? wfPath.split('/').pop() ?? wfPath : null
      if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) wfFn = fnArg
    }

    if (isNamed) {
      for (const decl of (node as ts.VariableStatement).declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineWorkflow') continue
        const optArg = decl.initializer.arguments[0]
        const fnArg  = decl.initializer.arguments[1]
        if (optArg && ts.isObjectLiteralExpression(optArg)) {
          for (const prop of optArg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue
            const k = ts.isIdentifier(prop.name) ? prop.name.text : null
            if (k && ts.isStringLiteral(prop.initializer)) wfOptions[k] = prop.initializer.text
          }
        }
        wfPath = wfOptions.path ?? ''
        wfName = wfPath
          ? wfPath.split('/').pop() ?? wfPath
          : ts.isIdentifier(decl.name) ? decl.name.text : 'workflow'
        if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) wfFn = fnArg
      }
    }

    if (wfName && wfFn) {
      const uuid = seedUuid(`${uuidSeed}:workflow:${wfName}`)
      // Build param map: param name → parameters.paramName (engine passes params by name)
      const paramMap = new Map<string, string>()
      wfFn.parameters.forEach((p) => {
        if (ts.isIdentifier(p.name)) paramMap.set(p.name.text, `parameters.${p.name.text}`)
      })
      const params = extractWorkflowParams(wfFn.parameters)
      let steps: WorkflowStep[] = []
      if (ts.isBlock(wfFn.body)) {
        steps = compileBlockToSteps(wfFn.body, pathToId, paramMap.size > 0 ? paramMap : undefined, helperDefs, constMap)
      } else if (wfFn.body) {
        let code = lowerAction(nodeText(wfFn.body), makeEnv({ pathToId: pathToId }))
        if (paramMap.size > 0) code = applyParamMap(code, paramMap)
        // Prepend any referenced top-level helper functions
        if (helperDefs) {
          for (const [helperName, helperText] of helperDefs) {
            if (code.includes(helperName)) code = `${helperText}\n${code}`
          }
        }
        for (const [name, value] of constMap) {
          code = replaceParamInCode(code, name, `(${value})`)
        }
        steps = [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } }]
      }
      result = {
        wfName,
        uuid,
        wfPath: wfPath || wfName,
        config: {
          id: uuid,
          meta: { name: wfName, trigger: wfOptions.trigger ?? 'click', ...(params.length > 0 ? { params } : {}) },
          steps,
        },
      }
      return
    }

    ts.forEachChild(node, visitNode)
  }

  visitNode(sf)
  return result
}

/**
 * Compile ALL defineWorkflow() calls in a source file.
 * compileWorkflowToJson() stops at the first workflow; this collects every one.
 * Used by the dsl-chat route Pass 1.5 to seed pathToId with all workflow UUIDs.
 */
export function compileAllWorkflowsToJson(
  sourceCode: string,
  pathToId: Map<string, string>,
  uuidSeed = 'dsl',
): CompiledWorkflow[] {
  const sf = ts.createSourceFile('dsl-workflow.tsx', sourceCode, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const helperDefs = collectHelperDefs(sf)
  const constMap = collectModuleLiteralConsts(sf)
  const results: CompiledWorkflow[] = []

  function visitNode(node: ts.Node) {
    const isDefault =
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'defineWorkflow'

    // Accept both exported and non-exported variable statements.
    // Pass 1 adds all defineWorkflow UUIDs to pathToId regardless of export status,
    // so pages can reference them by name. This pass must compile them all too,
    // otherwise the page references a UUID that has no workflow JSON behind it.
    const isNamed = ts.isVariableStatement(node)

    let wfName: string | null = null
    let wfPath = ''
    let wfOptions: Record<string, string> = {}
    let wfFn: ts.ArrowFunction | ts.FunctionExpression | null = null

    if (isDefault) {
      const call = node.expression as ts.CallExpression
      const optArg = call.arguments[0]
      const fnArg  = call.arguments[1]
      if (optArg && ts.isObjectLiteralExpression(optArg)) {
        for (const prop of optArg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue
          const k = ts.isIdentifier(prop.name) ? prop.name.text : null
          if (k && ts.isStringLiteral(prop.initializer)) wfOptions[k] = prop.initializer.text
        }
      }
      wfPath = wfOptions.path ?? ''
      wfName = wfPath ? wfPath.split('/').pop() ?? wfPath : null
      if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) wfFn = fnArg
    }

    if (isNamed) {
      for (const decl of (node as ts.VariableStatement).declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineWorkflow') continue
        wfOptions = {}
        const optArg = decl.initializer.arguments[0]
        const fnArg  = decl.initializer.arguments[1]
        if (optArg && ts.isObjectLiteralExpression(optArg)) {
          for (const prop of optArg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue
            const k = ts.isIdentifier(prop.name) ? prop.name.text : null
            if (k && ts.isStringLiteral(prop.initializer)) wfOptions[k] = prop.initializer.text
          }
        }
        wfPath = wfOptions.path ?? ''
        wfName = wfPath
          ? wfPath.split('/').pop() ?? wfPath
          : ts.isIdentifier(decl.name) ? decl.name.text : 'workflow'
        if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) wfFn = fnArg
      }
    }

    if (wfName && wfFn) {
      const uuid = seedUuid(`${uuidSeed}:workflow:${wfName}`)
      // Build param map: param name → parameters.paramName (engine passes params by name)
      const paramMap = new Map<string, string>()
      wfFn.parameters.forEach((p) => {
        if (ts.isIdentifier(p.name)) paramMap.set(p.name.text, `parameters.${p.name.text}`)
      })
      const params = extractWorkflowParams(wfFn.parameters)
      let steps: WorkflowStep[] = []
      if (ts.isBlock(wfFn.body)) {
        steps = compileBlockToSteps(wfFn.body, pathToId, paramMap.size > 0 ? paramMap : undefined, helperDefs, constMap)
      } else if (wfFn.body) {
        let code = lowerAction(nodeText(wfFn.body), makeEnv({ pathToId: pathToId }))
        if (paramMap.size > 0) code = applyParamMap(code, paramMap)
        if (helperDefs) {
          for (const [helperName, helperText] of helperDefs) {
            if (code.includes(helperName)) code = `${helperText}\n${code}`
          }
        }
        for (const [name, value] of constMap) {
          code = replaceParamInCode(code, name, `(${value})`)
        }
        steps = [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } }]
      }
      results.push({
        wfName,
        uuid,
        wfPath: wfPath || wfName,
        config: {
          id: uuid,
          meta: { name: wfName, trigger: wfOptions.trigger ?? 'click', ...(params.length > 0 ? { params } : {}) },
          steps,
        },
      })
      return  // don't recurse inside a workflow body
    }

    ts.forEachChild(node, visitNode)
  }

  visitNode(sf)
  return results
}

// ─── Disk-based compile ───────────────────────────────────────────────────────

export function compileWorkflowFile(
  srcPath: string,
  registry?: VfsRegistry,
): void {
  const source = fs.readFileSync(srcPath, 'utf-8')
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const helperDefs = collectHelperDefs(sf)
  const constMap = collectModuleLiteralConsts(sf)

  const configDir = path.join(process.cwd(), 'config')
  const actionsDir = path.join(configDir, 'actions')

  const vfsReg = registry ?? buildVfsRegistry()
  const dslReg = loadDslRegistry()
  const relSrc = path.relative(process.cwd(), srcPath)
  let count = 0

  function visitNode(node: ts.Node) {
    const isDefault =
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'defineWorkflow'

    const isNamed =
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)

    let wfName: string | null = null
    let wfOptions: Record<string, string> = {}
    let wfFn: ts.ArrowFunction | ts.FunctionExpression | null = null

    if (isDefault) {
      const call = node.expression as ts.CallExpression
      const optArg = call.arguments[0]
      const fnArg  = call.arguments[1]

      if (optArg && ts.isObjectLiteralExpression(optArg)) {
        for (const prop of optArg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue
          const k = ts.isIdentifier(prop.name) ? prop.name.text : null
          if (!k) continue
          if (ts.isStringLiteral(prop.initializer)) wfOptions[k] = prop.initializer.text
        }
      }

      wfName = wfOptions.path ? wfOptions.path.split('/').pop() ?? wfOptions.path : null
      if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
        wfFn = fnArg
      }
    }

    if (isNamed) {
      for (const decl of (node as ts.VariableStatement).declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineWorkflow') continue

        const optArg = decl.initializer.arguments[0]
        const fnArg  = decl.initializer.arguments[1]

        if (optArg && ts.isObjectLiteralExpression(optArg)) {
          for (const prop of optArg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue
            const k = ts.isIdentifier(prop.name) ? prop.name.text : null
            if (!k) continue
            if (ts.isStringLiteral(prop.initializer)) wfOptions[k] = prop.initializer.text
          }
        }

        wfName = wfOptions.path ? wfOptions.path.split('/').pop() ?? wfOptions.path
          : ts.isIdentifier(decl.name) ? decl.name.text : 'workflow'

        if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
          wfFn = fnArg
        }
      }
    }

    if (wfName && wfFn) {
      const wfUuid = getOrCreateUuid('workflows', wfName, vfsReg, dslReg)

      // Build param map: param name → parameters.paramName (engine passes params by name)
      const paramMap = new Map<string, string>()
      wfFn.parameters.forEach((p) => {
        if (ts.isIdentifier(p.name)) paramMap.set(p.name.text, `parameters.${p.name.text}`)
      })
      const params = extractWorkflowParams(wfFn.parameters)

      // Compile function body to steps
      let steps: WorkflowStep[] = []
      if (ts.isBlock(wfFn.body)) {
        steps = compileBlockToSteps(wfFn.body, vfsReg.pathToId, paramMap.size > 0 ? paramMap : undefined, helperDefs, constMap)
      } else if (wfFn.body) {
        // Concise arrow function body → wrap in runJavaScript
        let code = lowerAction(nodeText(wfFn.body), makeEnv({ pathToId: vfsReg.pathToId }))
        if (paramMap.size > 0) code = applyParamMap(code, paramMap)
        if (helperDefs.size > 0) {
          for (const [helperName, helperText] of helperDefs) {
            if (code.includes(helperName)) code = `${helperText}\n${code}`
          }
        }
        for (const [name, value] of constMap) {
          code = replaceParamInCode(code, name, `(${value})`)
        }
        steps = [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } }]
      }

      const wfConfig: WorkflowConfig = {
        name: wfName,
        trigger: wfOptions.trigger ?? 'click',
        ...(params.length > 0 ? { params } : {}),
        steps,
        _src: relSrc,
      }

      // Optional page scope
      if (wfOptions.pageScope) {
        (wfConfig as unknown as Record<string, unknown>).pageScope = wfOptions.pageScope
      }

      // Write to config/actions/dsl-<name>.json keyed by UUID
      fs.mkdirSync(actionsDir, { recursive: true })
      const outFile = path.join(actionsDir, `dsl-${wfName}.json`)

      let existing: Record<string, unknown> = {}
      try {
        existing = JSON.parse(fs.readFileSync(outFile, 'utf-8'))
      } catch { /* new file */ }

      existing[wfUuid] = wfConfig
      fs.writeFileSync(outFile, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
      count++
    }

    ts.forEachChild(node, visitNode)
  }

  visitNode(sf)

  if (count === 0) return
  saveDslRegistry(dslReg)
  console.log(`[DSL] compiled ${count} workflow(s) from ${relSrc}`)
}
