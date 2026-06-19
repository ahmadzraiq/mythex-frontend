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
 * vars['store/x'] references in runJavaScript code are rewritten to
 * variables['<uuid>'] via resolveExprRefs.
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
  resolveVarIdents,
  saveDslRegistry,
  type VfsRegistry,
} from './resolve-vfs'

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
  params?: Record<string, { type: string; defaultValue?: unknown }>
  steps: WorkflowStep[]
  _src?: string
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
  const identRe = new RegExp(`(?<![.'"\\[\\w])\\b${name}\\b(?!['"\\]])`, 'g')
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
 * Apply all parameter replacements (name → parameters.argN) to a JS expression string.
 */
function applyParamMap(code: string, paramMap: Map<string, string>): string {
  let result = code
  for (const [name, ref] of paramMap) {
    result = replaceParamInCode(result, name, ref)
  }
  return result
}

// ─── Single-JS compilation (blocks with local variable declarations) ─────────

/**
 * Returns true if the node (recursively, but NOT descending into nested
 * function/arrow bodies) contains any const/let/var declaration.
 * Used to detect workflows that must be compiled as a single runJavaScript
 * step to preserve variable scope across what would otherwise be split steps.
 */
function blockHasDeclarations(node: ts.Node): boolean {
  let found = false
  function walk(n: ts.Node) {
    if (found) return
    // Don't descend into closures — their declarations are isolated anyway
    if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return
    if (ts.isVariableStatement(n)) { found = true; return }
    ts.forEachChild(n, walk)
  }
  walk(node)
  return found
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

// ─── Compile individual steps ─────────────────────────────────────────────────

function compileSetVarStep(stmt: ts.Statement, pathToId: Map<string, string>, paramMap?: Map<string, string>): WorkflowStep {
  const id = crypto.randomUUID()
  let variableName = ''
  let value: unknown = null

  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression

    // setVar('store/x', val)
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'setVar') {
      const pathArg = expr.arguments[0]
      const valArg  = expr.arguments[1]

      const vfsPath = ts.isStringLiteral(pathArg) ? pathArg.text : nodeText(pathArg)
      variableName = pathToId.get(vfsPath) ?? pathToId.get(`store/${vfsPath}`) ?? vfsPath

      if (valArg) {
        if (ts.isStringLiteral(valArg)) {
          value = valArg.text
        } else if (ts.isNumericLiteral(valArg)) {
          value = Number(valArg.text)
        } else if (valArg.kind === ts.SyntaxKind.TrueKeyword) {
          value = true
        } else if (valArg.kind === ts.SyntaxKind.FalseKeyword) {
          value = false
        } else {
          let resolved = resolveExprRefs(nodeText(valArg), pathToId)
          resolved = resolveVarIdents(resolved, pathToId)
          if (paramMap) resolved = applyParamMap(resolved, paramMap)
          value = { js: resolved }
        }
      }
    }

    // vars['store/x'] = val
    if (
      ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(expr.left)
    ) {
      const keyNode = expr.left.argumentExpression
      const vfsPath = ts.isStringLiteral(keyNode) ? keyNode.text : nodeText(keyNode)
      variableName = pathToId.get(vfsPath) ?? pathToId.get(`store/${vfsPath.replace(/^['"]|['"]$/g, '')}`) ?? vfsPath

      const rhs = expr.right
      if (ts.isStringLiteral(rhs)) {
        value = rhs.text
      } else if (ts.isNumericLiteral(rhs)) {
        value = Number(rhs.text)
      } else if (rhs.kind === ts.SyntaxKind.TrueKeyword) {
        value = true
      } else if (rhs.kind === ts.SyntaxKind.FalseKeyword) {
        value = false
      } else {
        let resolved = resolveExprRefs(nodeText(rhs), pathToId)
        resolved = resolveVarIdents(resolved, pathToId)
        if (paramMap) resolved = applyParamMap(resolved, paramMap)
        value = { js: resolved }
      }
    }
  }

  return {
    id,
    type: 'changeVariableValue',
    config: { variableName, value },
  }
}

function compileNavigateStep(stmt: ts.ExpressionStatement, pathToId: Map<string, string>): WorkflowStep {
  const call = stmt.expression as ts.CallExpression
  const pathArg = call.arguments[0]
  const paramsArg = call.arguments[1]

  const navPath = ts.isStringLiteral(pathArg) ? pathArg.text : resolveExprRefs(nodeText(pathArg), pathToId)

  const config: Record<string, unknown> = { path: navPath }
  if (paramsArg) {
    config.query = { js: resolveExprRefs(nodeText(paramsArg), pathToId) }
  }

  return { id: crypto.randomUUID(), type: 'navigateTo', config }
}

function compileFetchStep(stmt: ts.ExpressionStatement, pathToId: Map<string, string>): WorkflowStep {
  const call = stmt.expression as ts.CallExpression
  const dsArg = call.arguments[0]
  const dsPath = ts.isStringLiteral(dsArg) ? dsArg.text : nodeText(dsArg)
  const collectionName = pathToId.get(dsPath) ?? pathToId.get(`data/${dsPath}`) ?? dsPath

  return {
    id: crypto.randomUUID(),
    type: 'fetchCollection',
    config: { collectionName },
  }
}

function compileBranchStep(
  stmt: ts.IfStatement,
  pathToId: Map<string, string>,
  paramMap?: Map<string, string>,
): WorkflowStep {
  let condition = resolveExprRefs(nodeText(stmt.expression), pathToId)
  condition = resolveVarIdents(condition, pathToId)
  if (paramMap) condition = applyParamMap(condition, paramMap)

  const trueBranch = compileBlockToSteps(stmt.thenStatement, pathToId, paramMap)
  const falseBranch = stmt.elseStatement
    ? compileBlockToSteps(stmt.elseStatement, pathToId, paramMap)
    : []

  return {
    id: crypto.randomUUID(),
    type: 'branch',
    config: { condition },
    trueBranch,
    falseBranch,
  }
}

// ─── Compile a block of statements to steps ───────────────────────────────────

function compileBlockToSteps(node: ts.Node, pathToId: Map<string, string>, paramMap?: Map<string, string>): WorkflowStep[] {
  const stmts: ts.Statement[] = []

  if (ts.isBlock(node)) {
    for (const stmt of node.statements) stmts.push(stmt)
  } else if (ts.isStatement(node)) {
    stmts.push(node as ts.Statement)
  }

  // If this block declares any local variables (const/let/var), compile the
  // entire block as ONE runJavaScript step. Splitting into multiple steps
  // would create isolated function scopes, making those declarations invisible
  // to subsequent steps (setVar values, branch conditions, etc.).
  if (ts.isBlock(node) && blockHasDeclarations(node)) {
    let code = stmts.map(s => stmtToInlineJs(s, pathToId, paramMap)).join('\n').trim()
    if (!code) return []
    code = resolveExprRefs(code, pathToId)
    code = resolveVarIdents(code, pathToId)
    if (paramMap) code = applyParamMap(code, paramMap)
    return [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } }]
  }

  const steps: WorkflowStep[] = []
  let jsBuffer: string[] = []

  function flushJs() {
    if (jsBuffer.length === 0) return
    let code = jsBuffer.join('\n').trim()
    if (code) {
      code = resolveExprRefs(code, pathToId)
      code = resolveVarIdents(code, pathToId)
      if (paramMap) code = applyParamMap(code, paramMap)
      steps.push({
        id: crypto.randomUUID(),
        type: 'runJavaScript',
        config: { code },
      })
    }
    jsBuffer = []
  }

  for (const stmt of stmts) {
    const candidate = classifyStatement(stmt)
    if (candidate.kind !== 'js') flushJs()

    switch (candidate.kind) {
      case 'setVar':
        steps.push(compileSetVarStep(stmt, pathToId, paramMap))
        break
      case 'navigate':
        steps.push(compileNavigateStep(stmt as ts.ExpressionStatement, pathToId))
        break
      case 'fetch':
        steps.push(compileFetchStep(stmt as ts.ExpressionStatement, pathToId))
        break
      case 'branch':
        steps.push(compileBranchStep(stmt as ts.IfStatement, pathToId, paramMap))
        break
      case 'forEach':
        // Compile forEach body as runJavaScript (complex iteration often needs context)
        jsBuffer.push(nodeText(stmt))
        break
      case 'js':
        jsBuffer.push(nodeText(stmt))
        break
    }
  }

  flushJs()
  return steps
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
      // Build param map: param name → parameters.argN
      const paramMap = new Map<string, string>()
      wfFn.parameters.forEach((p, i) => {
        if (ts.isIdentifier(p.name)) paramMap.set(p.name.text, `parameters.arg${i}`)
      })
      let steps: WorkflowStep[] = []
      if (ts.isBlock(wfFn.body)) {
        steps = compileBlockToSteps(wfFn.body, pathToId, paramMap.size > 0 ? paramMap : undefined)
      } else if (wfFn.body) {
        let code = resolveExprRefs(nodeText(wfFn.body), pathToId)
        code = resolveVarIdents(code, pathToId)
        if (paramMap.size > 0) code = applyParamMap(code, paramMap)
        steps = [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } }]
      }
      result = {
        wfName,
        uuid,
        wfPath: wfPath || wfName,
        config: {
          id: uuid,
          meta: { name: wfName, trigger: wfOptions.trigger ?? 'click' },
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
  const results: CompiledWorkflow[] = []

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
      // Build param map: param name → parameters.argN
      const paramMap = new Map<string, string>()
      wfFn.parameters.forEach((p, i) => {
        if (ts.isIdentifier(p.name)) paramMap.set(p.name.text, `parameters.arg${i}`)
      })
      let steps: WorkflowStep[] = []
      if (ts.isBlock(wfFn.body)) {
        steps = compileBlockToSteps(wfFn.body, pathToId, paramMap.size > 0 ? paramMap : undefined)
      } else if (wfFn.body) {
        let code = resolveExprRefs(nodeText(wfFn.body), pathToId)
        code = resolveVarIdents(code, pathToId)
        if (paramMap.size > 0) code = applyParamMap(code, paramMap)
        steps = [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } }]
      }
      results.push({
        wfName,
        uuid,
        wfPath: wfPath || wfName,
        config: {
          id: uuid,
          meta: { name: wfName, trigger: wfOptions.trigger ?? 'click' },
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

      // Compile function body to steps
      let steps: WorkflowStep[] = []
      if (ts.isBlock(wfFn.body)) {
        steps = compileBlockToSteps(wfFn.body, vfsReg.pathToId)
      } else if (wfFn.body) {
        // Concise arrow function body → wrap in runJavaScript
        const code = resolveVarIdents(resolveExprRefs(nodeText(wfFn.body), vfsReg.pathToId), vfsReg.pathToId)
        steps = [{ id: crypto.randomUUID(), type: 'runJavaScript', config: { code } }]
      }

      const wfConfig: WorkflowConfig = {
        name: wfName,
        trigger: wfOptions.trigger ?? 'click',
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
