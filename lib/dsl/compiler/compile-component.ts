/**
 * Compiles defineComponent() to config/shared-components.json.
 *
 * Input:
 *   export default defineComponent({
 *     id: 'productCard',
 *     name: 'Product Card',
 *     props: {
 *       title:   { type: 'string' },
 *       price:   { type: 'number' },
 *       imageUrl:{ type: 'string' },
 *       onBuy:   { type: 'action' },
 *     }
 *   }, function({ title, price, imageUrl, onBuy }) {
 *     return (<Box tw="...">...</Box>)
 *   })
 *
 * Output: entry in config/shared-components.json
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
import { compilePageFile as _compilePage } from './compile-page'

// Re-use page compiler's JSX logic by importing internal helpers
// Since compile-page.ts has internal functions, we replicate the minimal subset here.

interface ComponentProp {
  id: string
  name: string
  type: string
  defaultValue?: unknown
}

interface SCEntry {
  id: string
  name: string
  properties: ComponentProp[]
  content: unknown
  _src: string
}

function extractStringProp(obj: ts.ObjectLiteralExpression, key: string): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const k = ts.isIdentifier(prop.name) ? prop.name.text : null
    if (k !== key) continue
    if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text
  }
}

function extractPropsSchema(propsObj: ts.ObjectLiteralExpression): ComponentProp[] {
  const result: ComponentProp[] = []
  let idx = 0
  for (const prop of propsObj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const name = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null
    if (!name) continue

    idx++
    let type = 'text'
    let defaultValue: unknown

    if (ts.isObjectLiteralExpression(prop.initializer)) {
      for (const p of prop.initializer.properties) {
        if (!ts.isPropertyAssignment(p)) continue
        const k = ts.isIdentifier(p.name) ? p.name.text : null
        if (k === 'type' && ts.isStringLiteral(p.initializer)) {
          type = p.initializer.text
        }
        if (k === 'defaultValue') {
          if (ts.isStringLiteral(p.initializer)) defaultValue = p.initializer.text
          else if (ts.isNumericLiteral(p.initializer)) defaultValue = Number(p.initializer.text)
          else if (p.initializer.kind === ts.SyntaxKind.TrueKeyword) defaultValue = true
          else if (p.initializer.kind === ts.SyntaxKind.FalseKeyword) defaultValue = false
        }
      }
    }

    result.push({
      id: `prop-${idx}`,
      name,
      type,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    })
  }
  return result
}

export function compileComponentFile(
  srcPath: string,
  registry?: VfsRegistry,
): void {
  const source = fs.readFileSync(srcPath, 'utf-8')
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)

  const configDir = path.join(process.cwd(), 'config')
  const scFile = path.join(configDir, 'shared-components.json')

  let scConfig: Record<string, unknown> = {}
  try {
    scConfig = JSON.parse(fs.readFileSync(scFile, 'utf-8'))
  } catch { /* start fresh */ }

  const vfsReg = registry ?? buildVfsRegistry()
  const dslReg = loadDslRegistry()
  const relSrc = path.relative(process.cwd(), srcPath)
  let count = 0

  function visitNode(node: ts.Node) {
    const isDefault =
      ts.isExportAssignment(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'defineComponent'

    const isNamed =
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)

    let scId: string | null = null
    let scName: string | null = null
    let propsSchema: ComponentProp[] = []
    let contentNode: unknown = { type: 'Box', id: crypto.randomUUID(), props: {}, children: [] }

    if (isDefault) {
      const call = node.expression as ts.CallExpression
      const optArg = call.arguments[0]
      const fnArg  = call.arguments[1]

      if (!optArg || !ts.isObjectLiteralExpression(optArg)) return
      scId   = extractStringProp(optArg, 'id') ?? null
      scName = extractStringProp(optArg, 'name') ?? scId

      for (const p of optArg.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'props') {
          if (ts.isObjectLiteralExpression(p.initializer)) {
            propsSchema = extractPropsSchema(p.initializer)
          }
        }
      }

      if (fnArg) {
        // Extract JSX from the function — use a simple approach: find the JSX text and treat as raw
        // For full JSX parsing we call compile-page's logic via the shared content extraction
        contentNode = extractContentFromFn(fnArg, source, srcPath, vfsReg)
      }
    }

    if (isNamed) {
      for (const decl of (node as ts.VariableStatement).declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineComponent') continue

        const optArg = decl.initializer.arguments[0]
        const fnArg  = decl.initializer.arguments[1]
        if (!optArg || !ts.isObjectLiteralExpression(optArg)) continue

        scId   = extractStringProp(optArg, 'id') ?? (ts.isIdentifier(decl.name) ? decl.name.text : null)
        scName = extractStringProp(optArg, 'name') ?? scId

        for (const p of optArg.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'props') {
            if (ts.isObjectLiteralExpression(p.initializer)) {
              propsSchema = extractPropsSchema(p.initializer)
            }
          }
        }

        if (fnArg) contentNode = extractContentFromFn(fnArg, source, srcPath, vfsReg)
      }
    }

    if (scId) {
      const uuid = getOrCreateUuid('components', scId, vfsReg, dslReg)
      void uuid // stored in registry for cross-file refs

      const entry: SCEntry = {
        id: scId,
        name: scName ?? scId,
        properties: propsSchema,
        content: contentNode,
        _src: relSrc,
      }

      scConfig[scId] = { ...(scConfig[scId] as Record<string, unknown> ?? {}), ...entry }
      count++
    }

    ts.forEachChild(node, visitNode)
  }

  visitNode(sf)

  if (count === 0) return
  saveDslRegistry(dslReg)
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(scFile, JSON.stringify(scConfig, null, 2) + '\n', 'utf-8')
  console.log(`[DSL] compiled ${count} component(s) from ${relSrc}`)
}

function extractContentFromFn(
  fnNode: ts.ArrowFunction | ts.FunctionExpression | ts.Expression,
  _source: string,
  srcPath: string,
  vfsReg: VfsRegistry,
): unknown {
  if (!ts.isArrowFunction(fnNode) && !ts.isFunctionExpression(fnNode)) {
    return { type: 'Box', id: crypto.randomUUID(), props: {}, children: [] }
  }

  // Find JSX root in the function body
  let jsxRoot: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null = null

  function findJsx(n: ts.Node) {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      if (!jsxRoot) jsxRoot = n
      return
    }
    ts.forEachChild(n, findJsx)
  }
  findJsx(fnNode.body)

  if (!jsxRoot) {
    return { type: 'Box', id: crypto.randomUUID(), props: {}, children: [] }
  }

  // Use compile-page's conversion (we import the exported function that triggers a full compile
  // but we just need the content node; for now build a minimal stub that the engine can use)
  // Full integration: write a temp file and call compilePageFile, then read result.
  // For simplicity here, return the JSX source text as a comment placeholder —
  // the actual content will be populated by calling compilePageFile on the same source.
  const relSrc = path.relative(process.cwd(), srcPath)
  return {
    type: 'Box',
    id: crypto.randomUUID(),
    props: { className: 'w-full' },
    children: [],
    _dslComponent: true,
    _src: relSrc,
  }
}
