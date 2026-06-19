/**
 * Compiles defineTheme() to config/theme.json.
 * Merges DSL theme overrides with existing theme (DSL wins on conflicts).
 *
 * Input:
 *   export default defineTheme({
 *     brand: 'my-app',
 *     cssVariables: {
 *       root: { '--primary': '#3b82f6', '--radius': '0.5rem' },
 *       dark: { '--primary': '#60a5fa' },
 *     }
 *   })
 */

import fs from 'fs'
import path from 'path'
import ts from 'typescript'

function extractObjectProps(node: ts.ObjectLiteralExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
      ? prop.name.text
      : null
    if (!key) continue

    if (ts.isStringLiteral(prop.initializer)) {
      result[key] = prop.initializer.text
    } else if (ts.isObjectLiteralExpression(prop.initializer)) {
      result[key] = extractObjectProps(prop.initializer)
    } else if (ts.isNumericLiteral(prop.initializer)) {
      result[key] = Number(prop.initializer.text)
    } else if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
      result[key] = true
    } else if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) {
      result[key] = false
    }
  }
  return result
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        result[k] && typeof result[k] === 'object' && !Array.isArray(result[k])) {
      result[k] = deepMerge(result[k] as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      result[k] = v
    }
  }
  return result
}

export function compileThemeFile(srcPath: string): void {
  const source = fs.readFileSync(srcPath, 'utf-8')
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  const configDir = path.join(process.cwd(), 'config')
  const themeFile = path.join(configDir, 'theme.json')

  let themeConfig: Record<string, unknown> = {}
  try {
    themeConfig = JSON.parse(fs.readFileSync(themeFile, 'utf-8'))
  } catch { /* start fresh */ }

  let found = false
  const relSrc = path.relative(process.cwd(), srcPath)

  function visitNode(node: ts.Node) {
    const isDefaultExport =
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'defineTheme'

    const isNamedExport =
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)

    if (isDefaultExport) {
      const call = node.expression as ts.CallExpression
      const optArg = call.arguments[0]
      if (optArg && ts.isObjectLiteralExpression(optArg)) {
        const themeOverrides = extractObjectProps(optArg)
        themeConfig = deepMerge(themeConfig, { ...themeOverrides, _src: relSrc })
        found = true
      }
    }

    if (isNamedExport) {
      for (const decl of (node as ts.VariableStatement).declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineTheme') continue

        const optArg = decl.initializer.arguments[0]
        if (optArg && ts.isObjectLiteralExpression(optArg)) {
          const themeOverrides = extractObjectProps(optArg)
          themeConfig = deepMerge(themeConfig, { ...themeOverrides, _src: relSrc })
          found = true
        }
      }
    }

    ts.forEachChild(node, visitNode)
  }
  visitNode(sf)

  if (!found) return
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(themeFile, JSON.stringify(themeConfig, null, 2) + '\n', 'utf-8')
  console.log(`[DSL] compiled theme from ${relSrc}`)
}
