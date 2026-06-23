/**
 * decompile-triggers.ts — reconstructs `defineTrigger` declarations from
 * config/actions/app-triggers.json and config/actions/dsl-triggers-*.json.
 *
 * Only entries with `_dslName` + `_src` are emitted (DSL-authored triggers).
 */

import fs from 'fs'
import path from 'path'
import type { DecompiledEntry } from './decompile-vars'

interface TriggerStep {
  id: string
  type: string
  config?: Record<string, unknown>
}

interface TriggerEntry {
  id: string
  name: string
  trigger: string
  pageScope?: string
  steps?: TriggerStep[]
  _dslName?: string
  _src?: string
}

/** Reconstruct workflow steps back to DSL statements. */
function stepsToStatements(steps: TriggerStep[]): string[] {
  const stmts: string[] = []
  for (const step of steps) {
    const cfg = step.config ?? {}
    if (step.type === 'fetchCollection') {
      stmts.push(`  fetch(${JSON.stringify(String(cfg.collectionName ?? ''))})`)
    } else if (step.type === 'changeVariableValue') {
      const varName = String(cfg.variableName ?? '')
      const val = cfg.value
      let valStr: string
      if (val === null || val === undefined) {
        valStr = 'null'
      } else if (typeof val === 'object' && 'js' in (val as Record<string, unknown>)) {
        valStr = String((val as Record<string, unknown>).js)
      } else {
        valStr = JSON.stringify(val)
      }
      stmts.push(`  setVar(${JSON.stringify(varName)}, ${valStr})`)
    } else if (step.type === 'navigateTo') {
      stmts.push(`  navigate(${JSON.stringify(String(cfg.path ?? ''))})`)
    } else if (step.type === 'runJavaScript') {
      const code = String(cfg.code ?? '').trim()
      if (code) stmts.push(`  ${code}`)
    }
  }
  return stmts
}

function decompileTriggerFile(
  filePath: string,
): DecompiledEntry[] {
  const results: DecompiledEntry[] = []
  let data: Record<string, TriggerEntry>
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return results
  }

  let order = 0
  for (const [, entry] of Object.entries(data)) {
    const dslName = entry._dslName
    const src = entry._src
    if (!dslName || !src) continue

    const triggerType = entry.trigger
    const stmts = stepsToStatements(entry.steps ?? [])
    const bodyStr = stmts.length > 0 ? `{\n${stmts.join('\n')}\n}` : '{}'
    const text = `export const ${dslName} = defineTrigger(${JSON.stringify(triggerType)}, () => ${bodyStr})`

    results.push({ text, srcFile: src, kind: 'trigger', order: order++ })
  }

  return results
}

export function decompileTriggers(configDir?: string): DecompiledEntry[] {
  const dir = configDir ?? path.join(process.cwd(), 'config')
  const actionsDir = path.join(dir, 'actions')
  const results: DecompiledEntry[] = []

  if (!fs.existsSync(actionsDir)) return results

  for (const entry of fs.readdirSync(actionsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const isAppTriggers = entry.name === 'app-triggers.json'
    const isDslTriggers = entry.name.startsWith('dsl-triggers-') && entry.name.endsWith('.json')
    if (!isAppTriggers && !isDslTriggers) continue

    results.push(...decompileTriggerFile(path.join(actionsDir, entry.name)))
  }

  return results
}
