/**
 * Compiles defineDatasource() calls to config/datasources.json entries.
 *
 * Input:
 *   export default defineDatasource({
 *     path: 'data/products',
 *     type: 'rest',
 *     url: 'https://api.example.com/products',
 *     method: 'GET',
 *     folder: 'Products',
 *   })
 *
 * Output entry in config/datasources.json keyed by UUID.
 */

import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import {
  buildVfsRegistry,
  getOrCreateUuid,
  loadDslRegistry,
  saveDslRegistry,
  type VfsRegistry,
} from './resolve-vfs'

interface DatasourceEntry {
  label: string
  type: string
  url?: string
  method?: string
  query?: string
  folder?: string
  headers?: Record<string, string>
  _dslPath: string
  _src: string
}

function extractObjectProps(obj: ts.ObjectLiteralExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
      ? prop.name.text
      : null
    if (!key) continue

    if (ts.isStringLiteral(prop.initializer)) {
      result[key] = prop.initializer.text
    } else if (ts.isNumericLiteral(prop.initializer)) {
      result[key] = Number(prop.initializer.text)
    } else if (ts.isObjectLiteralExpression(prop.initializer)) {
      result[key] = extractObjectProps(prop.initializer)
    } else if (ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
      result[key] = prop.initializer.text
    } else {
      result[key] = prop.initializer.getText()
    }
  }
  return result
}

export function compileDatasourceFile(
  srcPath: string,
  registry?: VfsRegistry,
): void {
  const source = fs.readFileSync(srcPath, 'utf-8')
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  const configDir = path.join(process.cwd(), 'config')
  const dsFile = path.join(configDir, 'datasources.json')

  let dsConfig: Record<string, unknown> = {}
  try {
    dsConfig = JSON.parse(fs.readFileSync(dsFile, 'utf-8'))
  } catch { /* start fresh */ }

  const vfsReg = registry ?? buildVfsRegistry()
  const dslReg = loadDslRegistry()
  const relSrc = path.relative(process.cwd(), srcPath)
  let count = 0

  function visitNode(node: ts.Node) {
    // export default defineDatasource({...}) OR export const x = defineDatasource({...})
    const isDefault =
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'defineDatasource'

    const isNamed =
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)

    if (isDefault) {
      const call = node.expression as ts.CallExpression
      const optArg = call.arguments[0]
      if (!optArg || !ts.isObjectLiteralExpression(optArg)) return

      const opts = extractObjectProps(optArg) as { path?: string; type?: string; url?: string; method?: string; query?: string; folder?: string; headers?: Record<string, string> }
      const dsPath = opts.path ?? 'data/unnamed'
      const dsName = dsPath.split('/').pop() ?? dsPath

      const uuid = getOrCreateUuid('datasources', dsName, vfsReg, dslReg)
      const entry: DatasourceEntry = {
        label: dsName,
        type: opts.type ?? 'rest',
        ...(opts.url ? { url: opts.url } : {}),
        ...(opts.method ? { method: opts.method } : {}),
        ...(opts.query ? { query: opts.query } : {}),
        folder: opts.folder ?? 'DSL',
        ...(opts.headers ? { headers: opts.headers as Record<string, string> } : {}),
        _dslPath: dsPath,
        _src: relSrc,
      }

      dsConfig[uuid] = { ...(dsConfig[uuid] as Record<string, unknown> ?? {}), ...entry }
      count++
    }

    if (isNamed) {
      for (const decl of (node as ts.VariableStatement).declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineDatasource') continue

        const optArg = decl.initializer.arguments[0]
        if (!optArg || !ts.isObjectLiteralExpression(optArg)) continue

        const opts = extractObjectProps(optArg) as { path?: string; type?: string; url?: string; method?: string; query?: string; folder?: string; headers?: Record<string, string> }
        const exportName = ts.isIdentifier(decl.name) ? decl.name.text : 'unnamed'
        const dsPath = opts.path ?? `data/${exportName}`
        const dsName = dsPath.split('/').pop() ?? exportName

        const uuid = getOrCreateUuid('datasources', dsName, vfsReg, dslReg)
        const entry: DatasourceEntry = {
          label: dsName,
          type: opts.type ?? 'rest',
          ...(opts.url ? { url: opts.url } : {}),
          ...(opts.method ? { method: opts.method } : {}),
          ...(opts.query ? { query: opts.query } : {}),
          folder: opts.folder ?? 'DSL',
          ...(opts.headers ? { headers: opts.headers as Record<string, string> } : {}),
          _dslPath: dsPath,
          _src: relSrc,
        }

        dsConfig[uuid] = { ...(dsConfig[uuid] as Record<string, unknown> ?? {}), ...entry }
        count++
      }
    }

    ts.forEachChild(node, visitNode)
  }

  visitNode(sf)

  if (count === 0) return
  saveDslRegistry(dslReg)
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(dsFile, JSON.stringify(dsConfig, null, 2) + '\n', 'utf-8')
  console.log(`[DSL] compiled ${count} datasources from ${relSrc}`)
}
