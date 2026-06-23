/**
 * Compiles defineTrigger() to config/actions/app-triggers.json (or page-triggers).
 *
 * Input:
 *   export default defineTrigger({ type: 'pageLoad', page: 'Products' }, function() {
 *     fetch('data/products')
 *   })
 *
 * Output: entry in config/actions/app-triggers.json (or dsl-triggers-<page>.json for page-scoped)
 *   { "<uuid>": { "name": "pageLoad:Products", "trigger": "pageLoad", "pageScope": "Products", "steps": [...] } }
 */

import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import crypto from 'crypto'
import {
  buildVfsRegistry,
  loadDslRegistry,
  saveDslRegistry,
  type VfsRegistry,
} from './resolve-vfs'
import { lowerAction, makeEnv } from './lower/index'
import { compileWorkflowFile as _compileWorkflow } from './compile-workflow'
import type { WorkflowStep } from './compile-workflow'

interface TriggerEntry {
  name: string
  trigger: string
  pageScope?: string
  steps: WorkflowStep[]
  _src: string
}

function extractObjectStringProp(obj: ts.ObjectLiteralExpression, key: string): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const k = ts.isIdentifier(prop.name) ? prop.name.text : null
    if (k !== key) continue
    if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text
  }
}

function nodeText(node: ts.Node): string {
  return node.getText().trim()
}

function compileBodyToSteps(
  body: ts.Block | ts.Expression,
  pathToId: Map<string, string>,
): WorkflowStep[] {
  if (!ts.isBlock(body)) {
    const code = lowerAction(nodeText(body), makeEnv({ pathToId }))
    return [{
      id: crypto.randomUUID(),
      type: 'runJavaScript',
      config: { code },
    }]
  }

  // Re-use the step compilation logic from compile-workflow.ts
  // We inline the key logic here to avoid circular imports on heavy imports
  const steps: WorkflowStep[] = []
  let jsBuffer: string[] = []

  function flushJs() {
    if (jsBuffer.length === 0) return
    const code = jsBuffer.join('\n').trim()
    if (code) {
      steps.push({
        id: crypto.randomUUID(),
        type: 'runJavaScript',
        config: { code: lowerAction(code, makeEnv({ pathToId })) },
      })
    }
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
        const vfsPath = ts.isStringLiteral(pathArg) ? pathArg.text : nodeText(pathArg)
        const variableName = pathToId.get(vfsPath) ?? pathToId.get(`store/${vfsPath}`) ?? vfsPath
        const value = valArg ? (ts.isStringLiteral(valArg) ? valArg.text : { js: lowerAction(nodeText(valArg), makeEnv({ pathToId })) }) : null
        steps.push({ id: crypto.randomUUID(), type: 'changeVariableValue', config: { variableName, value } })
        continue
      }
      if (fn === 'navigate') {
        flushJs()
        const navPath = ts.isStringLiteral(stmt.expression.arguments[0]) ? stmt.expression.arguments[0].text : nodeText(stmt.expression.arguments[0])
        steps.push({ id: crypto.randomUUID(), type: 'navigateTo', config: { path: navPath } })
        continue
      }
    }
    jsBuffer.push(nodeText(stmt))
  }
  flushJs()
  return steps
}

export function compileTriggerFile(
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
      node.expression.expression.text === 'defineTrigger'

    const isNamed =
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword)

    let triggerType: string | null = null
    let page: string | undefined
    let fn: ts.ArrowFunction | ts.FunctionExpression | null = null

    if (isDefault) {
      const call = node.expression as ts.CallExpression
      const optArg = call.arguments[0]
      const fnArg  = call.arguments[1]

      if (optArg && ts.isObjectLiteralExpression(optArg)) {
        triggerType = extractObjectStringProp(optArg, 'type') ?? null
        page = extractObjectStringProp(optArg, 'page')
      }
      if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
        fn = fnArg
      }
    }

    if (isNamed) {
      for (const decl of (node as ts.VariableStatement).declarationList.declarations) {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) continue
        if (!ts.isIdentifier(decl.initializer.expression)) continue
        if (decl.initializer.expression.text !== 'defineTrigger') continue

        const optArg = decl.initializer.arguments[0]
        const fnArg  = decl.initializer.arguments[1]
        if (optArg && ts.isObjectLiteralExpression(optArg)) {
          triggerType = extractObjectStringProp(optArg, 'type') ?? null
          page = extractObjectStringProp(optArg, 'page')
        }
        if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
          fn = fnArg
        }
      }
    }

    if (triggerType && fn) {
      const triggerKey = page ? `${triggerType}:${page}` : triggerType
      const uuid = dslReg.triggers[triggerKey] ?? crypto.randomUUID()
      dslReg.triggers[triggerKey] = uuid

      const steps = compileBodyToSteps(fn.body as ts.Block | ts.Expression, vfsReg.pathToId)

      const entry: TriggerEntry = {
        name: triggerKey,
        trigger: triggerType,
        ...(page ? { pageScope: page } : {}),
        steps,
        _src: relSrc,
      }

      // Write to config/actions/app-triggers.json or page-specific triggers file
      const outFileName = page ? `dsl-triggers-${page.toLowerCase()}.json` : 'app-triggers.json'
      const outFile = path.join(actionsDir, outFileName)
      fs.mkdirSync(actionsDir, { recursive: true })

      let existing: Record<string, unknown> = {}
      try {
        existing = JSON.parse(fs.readFileSync(outFile, 'utf-8'))
      } catch { /* new file */ }

      existing[uuid] = entry
      fs.writeFileSync(outFile, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
      count++
    }

    ts.forEachChild(node, visitNode)
  }

  visitNode(sf)

  if (count === 0) return
  saveDslRegistry(dslReg)
  console.log(`[DSL] compiled ${count} trigger(s) from ${relSrc}`)
}
