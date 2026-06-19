/**
 * Compiles defineFormula() calls to config/formulas.json entries.
 *
 * Input:
 *   export const formatCurrency = defineFormula(
 *     (amount: number, currency = 'USD') =>
 *       new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount),
 *     { description: 'Format a number as currency', params: [{ name: 'amount', type: 'Number' }] }
 *   )
 *
 * Output entry in config/formulas.json:
 *   { "formatCurrency": { "name": "formatCurrency", "formula": "...", "params": [...], "_src": "..." } }
 */

import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import { detectAllDefines } from './detect'

interface FormulaEntry {
  name: string
  folder?: string
  description?: string
  params?: Array<{ id: string; name: string; type: string; testValue?: unknown }>
  formula: string
  _src: string
}

function extractFunctionBody(fnNode: ts.ArrowFunction | ts.FunctionExpression): string {
  if (ts.isConciseBody(fnNode.body) && !ts.isBlock(fnNode.body)) {
    return fnNode.body.getText()
  }
  if (ts.isBlock(fnNode.body)) {
    // Strip outer braces
    const text = fnNode.body.getText().slice(1, -1).trim()
    return text
  }
  return fnNode.body.getText()
}

function extractParams(fn: ts.ArrowFunction | ts.FunctionExpression): Array<{ id: string; name: string; type: string }> {
  return fn.parameters.map((p, i) => {
    const name = ts.isIdentifier(p.name) ? p.name.text : `p${i + 1}`
    // TypeScript type annotation → map to a simple string
    let type = 'Text'
    if (p.type) {
      const typeText = p.type.getText().toLowerCase()
      if (typeText.includes('number')) type = 'Number'
      else if (typeText.includes('boolean')) type = 'Boolean'
      else if (typeText.includes('array') || typeText.includes('[]')) type = 'Array'
    }
    return { id: `p${i + 1}`, name, type }
  })
}

export function compileFormulaFile(srcPath: string): void {
  const defines = detectAllDefines(srcPath).filter(d => d.type === 'formula')
  if (defines.length === 0) return

  const configDir = path.join(process.cwd(), 'config')
  const formulasFile = path.join(configDir, 'formulas.json')

  let formulasConfig: Record<string, unknown> = {}
  try {
    formulasConfig = JSON.parse(fs.readFileSync(formulasFile, 'utf-8'))
  } catch { /* start fresh section */ }

  const source = fs.readFileSync(srcPath, 'utf-8')
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  const relSrc = path.relative(process.cwd(), srcPath)
  let count = 0

  function visit(node: ts.Node) {
    if (
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineFormula') continue

        const exportName = ts.isIdentifier(decl.name) ? decl.name.text : null
        if (!exportName) continue

        const fnArg = decl.initializer.arguments[0]
        if (!fnArg || (!ts.isArrowFunction(fnArg) && !ts.isFunctionExpression(fnArg))) continue

        const params = extractParams(fnArg)
        const formula = extractFunctionBody(fnArg)

        // Optional second meta arg
        let description: string | undefined
        const metaArg = decl.initializer.arguments[1]
        if (metaArg && ts.isObjectLiteralExpression(metaArg)) {
          for (const prop of metaArg.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
              if (prop.name.text === 'description' && ts.isStringLiteral(prop.initializer)) {
                description = prop.initializer.text
              }
            }
          }
        }

        const entry: FormulaEntry = {
          name: exportName,
          folder: 'DSL',
          ...(description ? { description } : {}),
          params,
          formula,
          _src: relSrc,
        }

        formulasConfig[exportName] = { ...(formulasConfig[exportName] as Record<string, unknown> ?? {}), ...entry }
        count++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(formulasFile, JSON.stringify(formulasConfig, null, 2) + '\n', 'utf-8')
  console.log(`[DSL] compiled ${count} formulas from ${relSrc}`)
}
