/**
 * Compiles defineRoute() calls to config/routes.json.
 *
 * Input:
 *   export const routes = [
 *     defineRoute({ path: '/',         config: 'home',     name: 'Home',     layout: 'full' }),
 *     defineRoute({ path: '/products', config: 'products', name: 'Products', auth: false }),
 *   ]
 *
 * Output: merges routes into config/routes.json (DSL routes keyed by path, existing non-DSL routes preserved).
 */

import fs from 'fs'
import path from 'path'
import ts from 'typescript'

interface RouteEntry {
  path: string
  config: string
  name?: string
  auth?: boolean
  layout?: string
  _src: string
}

interface RoutesConfig {
  defaultRedirect?: string
  routes: RouteEntry[]
}

function extractStringProp(obj: ts.ObjectLiteralExpression, key: string): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const k = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null
    if (k !== key) continue
    if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text
  }
}

function extractBoolProp(obj: ts.ObjectLiteralExpression, key: string): boolean | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const k = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null
    if (k !== key) continue
    if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true
    if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  }
}

export function compileRouteFile(srcPath: string): void {
  const source = fs.readFileSync(srcPath, 'utf-8')
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  const configDir = path.join(process.cwd(), 'config')
  const routesFile = path.join(configDir, 'routes.json')

  let routesConfig: RoutesConfig = { routes: [] }
  try {
    routesConfig = JSON.parse(fs.readFileSync(routesFile, 'utf-8'))
  } catch { /* start fresh */ }

  // Non-DSL routes to preserve
  const existingNonDsl = (routesConfig.routes ?? []).filter(r => !('_src' in r))
  const dslRoutes: RouteEntry[] = []
  const relSrc = path.relative(process.cwd(), srcPath)

  function visitNode(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineRoute'
    ) {
      const optArg = node.arguments[0]
      if (!optArg || !ts.isObjectLiteralExpression(optArg)) return

      const routePath = extractStringProp(optArg, 'path')
      const config = extractStringProp(optArg, 'config')
      if (!routePath || !config) return

      const entry: RouteEntry = {
        path: routePath,
        config,
        ...(extractStringProp(optArg, 'name') ? { name: extractStringProp(optArg, 'name') } : {}),
        ...(extractBoolProp(optArg, 'auth') !== undefined ? { auth: extractBoolProp(optArg, 'auth') } : {}),
        ...(extractStringProp(optArg, 'layout') ? { layout: extractStringProp(optArg, 'layout') } : {}),
        _src: relSrc,
      }
      dslRoutes.push(entry)
    }
    ts.forEachChild(node, visitNode)
  }
  visitNode(sf)

  if (dslRoutes.length === 0) return

  routesConfig.routes = [...existingNonDsl, ...dslRoutes]
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(routesFile, JSON.stringify(routesConfig, null, 2) + '\n', 'utf-8')
  console.log(`[DSL] compiled ${dslRoutes.length} routes from ${relSrc}`)
}
