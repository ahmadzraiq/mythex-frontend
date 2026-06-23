/**
 * decompile-workflows.ts — reconstructs `defineWorkflow` declarations from actions/*.json.
 *
 * Only entries with `_dslName` + `_src` are emitted.
 * Step types handled:
 *   changeVariableValue → setVar(varName, expr)
 *   branch              → if (cond) { ... } else { ... }
 *   multiOptionBranch   → if/else-if chain
 *   runJavaScript       → raw code block
 *   navigateTo          → navigate(route)
 *   runProjectWorkflow  → workflowName(args)
 *   emitComponentTrigger → (skipped — internal SC relay)
 *   fetchCollection     → fetch(dsName)
 */

import fs from 'fs'
import path from 'path'
import type { DecompiledEntry } from './decompile-vars'
import { resolveUuidsInExpr, type UuidMap } from './uuid-map'

interface WfStep {
  id?: string
  type: string
  config?: Record<string, unknown>
  trueBranch?: WfStep[]
  falseBranch?: WfStep[]
  branches?: Array<{ label: string; steps: WfStep[]; condition?: string }>
  defaultBranch?: WfStep[]
  steps?: WfStep[]
}

interface WfEntry {
  _dslName?: string
  _src?: string
  name?: string
  meta?: { name?: string; params?: string[] }
  steps?: WfStep[]
  params?: string[]
}

export function decompileWorkflows(uuidMap: UuidMap, configDir?: string): DecompiledEntry[] {
  const dir = configDir ?? path.join(process.cwd(), 'config')
  const results: DecompiledEntry[] = []

  const actionsDir = path.join(dir, 'actions')
  if (!fs.existsSync(actionsDir)) return results

  let order = 0
  for (const file of fs.readdirSync(actionsDir).sort()) {
    if (!file.endsWith('.json')) continue
    let actionJson: Record<string, WfEntry> | null = null
    try {
      actionJson = JSON.parse(fs.readFileSync(path.join(actionsDir, file), 'utf-8'))
    } catch {
      continue
    }
    if (!actionJson) continue

    for (const [, entry] of Object.entries(actionJson)) {
      const name = entry._dslName ?? entry.name
      const src = entry._src
      if (!name || !src) continue

      const paramNames: string[] = entry.params ?? entry.meta?.params ?? []
      const steps = entry.steps ?? []

      const body = stepsToCode(steps, uuidMap, paramNames, 2)
      const paramStr = paramNames.length > 0 ? `(${paramNames.join(', ')})` : '()'
      const fnBody = body.trim() ? `${paramStr} => {\n${body}\n}` : `${paramStr} => {}`

      results.push({
        text: `export const ${name} = defineWorkflow(${fnBody})`,
        srcFile: src,
        kind: 'workflow',
        order: order++,
      })
    }
  }

  return results
}

function stepsToCode(steps: WfStep[], uuidMap: UuidMap, paramNames: string[], depth: number): string {
  const pad = ' '.repeat(depth)
  const lines: string[] = []

  for (const step of steps) {
    const line = stepToCode(step, uuidMap, paramNames, depth)
    if (line != null) lines.push(line)
  }

  return lines.join('\n')
}

function stepToCode(step: WfStep, uuidMap: UuidMap, paramNames: string[], depth: number): string | null {
  const pad = ' '.repeat(depth)

  switch (step.type) {
    case 'changeVariableValue': {
      const cfg = step.config ?? {}
      const varUuid = String(cfg.variableName ?? '')
      const varName = uuidMap.vars.get(varUuid) ?? varUuid
      const val = cfg.value
      const valExpr = resolveValue(val, uuidMap)
      return `${pad}setVar(${varName}, ${valExpr})`
    }

    case 'branch': {
      const cfg = step.config ?? {}
      const cond = resolveExpr(String(cfg.condition ?? 'true'), uuidMap)
      const trueBranch = step.trueBranch ?? []
      const falseBranch = step.falseBranch ?? []
      const trueCode = stepsToCode(trueBranch, uuidMap, paramNames, depth + 2)
      const falseCode = stepsToCode(falseBranch, uuidMap, paramNames, depth + 2)
      let out = `${pad}if (${cond}) {\n${trueCode}\n${pad}}`
      if (falseCode.trim()) {
        out += ` else {\n${falseCode}\n${pad}}`
      }
      return out
    }

    case 'multiOptionBranch': {
      const cfg = step.config ?? {}
      const cond = resolveExpr(String(cfg.condition ?? ''), uuidMap)
      const branches = step.branches ?? []
      const defaultBranch = step.defaultBranch ?? []
      const parts: string[] = []
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i]
        const branchCode = stepsToCode(b.steps ?? [], uuidMap, paramNames, depth + 2)
        const keyword = i === 0 ? `${pad}if` : ` else if`
        parts.push(`${keyword} (${cond} === ${JSON.stringify(b.label)}) {\n${branchCode}\n${pad}}`)
      }
      if (defaultBranch.length > 0) {
        const defCode = stepsToCode(defaultBranch, uuidMap, paramNames, depth + 2)
        parts.push(` else {\n${defCode}\n${pad}}`)
      }
      return parts.join('')
    }

    case 'runJavaScript': {
      const cfg = step.config ?? {}
      const code = resolveExpr(String(cfg.code ?? ''), uuidMap)
      // Indent the code block
      const indented = code.split('\n').map(l => pad + l).join('\n')
      return indented
    }

    case 'navigateTo': {
      const cfg = step.config ?? {}
      const route = cfg.route ?? cfg.path ?? ''
      if (route === 'back' || route === -1) return `${pad}navigate(-1)`
      return `${pad}navigate(${JSON.stringify(route)})`
    }

    case 'runProjectWorkflow': {
      const cfg = step.config ?? {}
      const wfId = String(cfg.workflowId ?? '')
      const wfName = uuidMap.workflows.get(wfId) ?? wfId
      const params = cfg.params as Record<string, unknown> | undefined
      if (params && Object.keys(params).length > 0) {
        const argList = Object.values(params).map(v => resolveValue(v, uuidMap)).join(', ')
        return `${pad}${wfName}(${argList})`
      }
      return `${pad}${wfName}()`
    }

    case 'fetchCollection': {
      const cfg = step.config ?? {}
      const dsId = String(cfg.datasourceId ?? cfg.collectionId ?? '')
      const dsName = uuidMap.datasources.get(dsId) ?? dsId
      return `${pad}fetch(${dsName})`
    }

    case 'emitComponentTrigger':
      // Internal SC relay — skip
      return null

    default:
      // Unknown step — emit a comment
      return `${pad}// step: ${step.type}`
  }
}

function resolveValue(val: unknown, uuidMap: UuidMap): string {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'boolean') return String(val)
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') return JSON.stringify(val)
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if ('formula' in obj) return resolveExpr(String(obj.formula), uuidMap)
    if ('js' in obj) return resolveExpr(String(obj.js), uuidMap)
  }
  return JSON.stringify(val)
}

function resolveExpr(expr: string, uuidMap: UuidMap): string {
  return resolveUuidsInExpr(expr, uuidMap)
}

