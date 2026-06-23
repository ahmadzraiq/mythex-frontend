/**
 * Compiles a DSL vars file to config/variables.json entries.
 *
 * Input pattern (any file with exported defineVar() calls):
 *   export const displayValue = defineVar('string', '0')
 *   export const buttons = defineVar('array', [...])
 *
 * Output: merges new/updated entries into config/variables.json
 *   { "variables": { "<uuid>": { "label": "displayValue", "type": "string", "initialValue": "0", "folder": "DSL", "_dslName": "displayValue", "_src": "..." } } }
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import ts from 'typescript'
import { buildVfsRegistry, getOrCreateUuid, loadDslRegistry, saveDslRegistry, type VfsRegistry } from './resolve-vfs'
import { detectAllDefines } from './detect'

interface VarEntry {
  label: string
  type: string
  initialValue: unknown
  folder: string
  _dslName: string
  _src: string
}

/**
 * Recursively evaluate a literal expression to a primitive JS value.
 * Handles string/number/boolean literals, unary minus, binary string
 * concatenation (a + b), and parenthesised forms.
 * Returns undefined when the expression is too complex to evaluate statically.
 */
function evalLiteralExpr(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return null
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    if (ts.isNumericLiteral(node.operand)) return -Number(node.operand.text)
  }
  if (ts.isParenthesizedExpression(node)) return evalLiteralExpr(node.expression)
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = evalLiteralExpr(node.left)
    const right = evalLiteralExpr(node.right)
    if (typeof left === 'string' && typeof right === 'string') return left + right
    if (typeof left === 'number' && typeof right === 'number') return left + right
  }
  return undefined
}

/**
 * Build a resolver that looks up module-level `const NAME = LITERAL` declarations
 * in a SourceFile. Supports string/number/boolean literals and string concatenation.
 * Used to resolve identifier references in defineVar(IDENTIFIER) initial values.
 */
function buildConstResolver(sf: ts.SourceFile): (name: string) => unknown {
  const consts = new Map<string, unknown>()
  ts.forEachChild(sf, node => {
    if (!ts.isVariableStatement(node)) return
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
      const val = evalLiteralExpr(decl.initializer)
      if (val !== undefined) consts.set(decl.name.text, val)
    }
  })
  return (name: string) => consts.get(name)
}

function parseInitialValue(
  argNode: ts.Expression | undefined,
  resolveConst?: (name: string) => unknown,
): unknown {
  if (!argNode) return null

  if (ts.isStringLiteral(argNode)) return argNode.text
  if (ts.isNumericLiteral(argNode)) return Number(argNode.text)
  if (argNode.kind === ts.SyntaxKind.TrueKeyword) return true
  if (argNode.kind === ts.SyntaxKind.FalseKeyword) return false
  if (argNode.kind === ts.SyntaxKind.NullKeyword) return null
  if (argNode.kind === ts.SyntaxKind.UndefinedKeyword) return null

  if (ts.isPrefixUnaryExpression(argNode) && argNode.operator === ts.SyntaxKind.MinusToken) {
    if (ts.isNumericLiteral(argNode.operand)) return -Number(argNode.operand.text)
  }

  // Identifier: look up in module-level const declarations (e.g. defineVar(SAMPLE))
  if (ts.isIdentifier(argNode) && resolveConst) {
    const resolved = resolveConst(argNode.text)
    if (resolved !== undefined) return resolved
  }

  // Static expressions: string/number concatenation, parenthesised forms
  const literal = evalLiteralExpr(argNode)
  if (literal !== undefined) return literal

  // Arrays and objects: try to parse source text as JSON
  if (ts.isArrayLiteralExpression(argNode) || ts.isObjectLiteralExpression(argNode)) {
    try {
      // Convert TS literal to JSON-compatible text
      const srcText = argNode.getText()
      // Replace single quotes with double quotes, unquoted keys → quoted keys,
      // and strip trailing commas (valid JS, invalid JSON).
      const jsonLike = srcText
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
        .replace(/'/g, '"')
        .replace(/,(\s*[}\]])/g, '$1')
      return JSON.parse(jsonLike)
    } catch {
      // Return raw source text as string if parsing fails
      return argNode.getText()
    }
  }

  // Fallback: return the source text for complex expressions
  return argNode.getText()
}

// ─── Deterministic UUID from a seed string ────────────────────────────────────

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

export interface CompiledVar {
  varName: string
  uuid: string
  entry: {
    id: string
    name: string
    label: string
    type: string
    initialValue: unknown
    folder: string
  }
}

/**
 * Compile DSL source code containing defineVar() calls to an array of
 * CompiledVar objects. No files are read or written.
 *
 * uuidSeed should be a stable per-project identifier so the same variable
 * always gets the same UUID across requests (session restore).
 */
export function compileVarsToJson(sourceCode: string, uuidSeed = 'dsl'): CompiledVar[] {
  const sf = ts.createSourceFile('dsl-vars.ts', sourceCode, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const resolveConst = buildConstResolver(sf)
  const results: CompiledVar[] = []

  function visit(node: ts.Node) {
    if (
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineVar') continue

        const exportName = ts.isIdentifier(decl.name) ? decl.name.text : null
        if (!exportName) continue

        const typeArg = decl.initializer.arguments[0]
        const initArg = decl.initializer.arguments[1]
        const typeStr = ts.isStringLiteral(typeArg) ? typeArg.text : 'string'
        const initial = parseInitialValue(initArg, resolveConst)

        const uuid = seedUuid(`${uuidSeed}:var:${exportName}`)
        results.push({
          varName: exportName,
          uuid,
          entry: {
            id: uuid,
            name: uuid,
            label: exportName,
            type: typeStr,
            initialValue: initial,
            folder: 'DSL',
          },
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return results
}

// ─── Disk-based compile ───────────────────────────────────────────────────────

export function compileVarFile(
  srcPath: string,
  registry?: VfsRegistry,
): void {
  const defines = detectAllDefines(srcPath).filter(d => d.type === 'var')
  if (defines.length === 0) return

  const configDir = path.join(process.cwd(), 'config')
  const varsFile = path.join(configDir, 'variables.json')

  // Read existing variables.json
  let varsConfig: { variables: Record<string, unknown>; varFolders?: unknown[] } = { variables: {} }
  try {
    varsConfig = JSON.parse(fs.readFileSync(varsFile, 'utf-8'))
  } catch {
    varsConfig = { variables: {} }
  }
  varsConfig.variables = varsConfig.variables ?? {}

  const vfsReg = registry ?? buildVfsRegistry()
  const dslReg = loadDslRegistry()

  // Parse the source file to extract defineVar calls with their initialValues
  const source = fs.readFileSync(srcPath, 'utf-8')
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const resolveConst = buildConstResolver(sf)

  const defineCalls = new Map<string, { typeStr: string; initial: unknown }>()

  function visit(node: ts.Node) {
    if (
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineVar') continue

        const exportName = ts.isIdentifier(decl.name) ? decl.name.text : null
        if (!exportName) continue

        const typeArg = decl.initializer.arguments[0]
        const initArg = decl.initializer.arguments[1]

        const typeStr = ts.isStringLiteral(typeArg) ? typeArg.text : 'string'
        const initial = parseInitialValue(initArg, resolveConst)

        defineCalls.set(exportName, { typeStr, initial })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  const relSrc = path.relative(process.cwd(), srcPath)

  for (const [name, { typeStr, initial }] of defineCalls) {
    const uuid = getOrCreateUuid('vars', name, vfsReg, dslReg)

    const entry: VarEntry = {
      label: name,
      type: typeStr,
      initialValue: initial,
      folder: 'DSL',
      _dslName: name,
      _src: relSrc,
    }

    // Preserve existing non-DSL fields (folder override, etc.) if entry existed before
    const existing = varsConfig.variables[uuid] as Record<string, unknown> | undefined
    if (existing) {
      varsConfig.variables[uuid] = { ...existing, ...entry }
    } else {
      varsConfig.variables[uuid] = entry
    }
  }

  saveDslRegistry(dslReg)
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(varsFile, JSON.stringify(varsConfig, null, 2) + '\n', 'utf-8')

  console.log(`[DSL] compiled vars from ${relSrc} (${defineCalls.size} vars)`)
}
