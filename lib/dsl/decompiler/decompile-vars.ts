/**
 * decompile-vars.ts — reconstructs `defineVar` declarations from variables.json entries.
 *
 * Only entries that have `_dslName` and `_src` are emitted (DSL-authored variables).
 */

import fs from 'fs'
import path from 'path'

export interface DecompiledEntry {
  text: string
  srcFile: string
  kind: 'var' | 'function' | 'workflow' | 'component' | 'page' | 'datasource' | 'trigger'
  order: number
}

/**
 * Read variables.json and emit `export const name = defineVar(initial)` for every
 * DSL-authored entry (_dslName + _src present).
 */
export function decompileVars(configDir?: string): DecompiledEntry[] {
  const dir = configDir ?? path.join(process.cwd(), 'config')
  const results: DecompiledEntry[] = []

  let varsJson: { variables?: Record<string, { _dslName?: string; _src?: string; type?: string; initialValue?: unknown; label?: string }> } | null = null
  try {
    varsJson = JSON.parse(fs.readFileSync(path.join(dir, 'variables.json'), 'utf-8'))
  } catch {
    return results
  }

  if (!varsJson?.variables) return results

  let order = 0
  for (const [, entry] of Object.entries(varsJson.variables)) {
    const name = entry._dslName
    const src = entry._src
    if (!name || !src) continue

    const initial = entry.initialValue
    const initialLiteral = formatLiteral(initial)

    results.push({
      text: `export const ${name} = defineVar(${initialLiteral})`,
      srcFile: src,
      kind: 'var',
      order: order++,
    })
  }

  return results
}

function formatLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'string') return JSON.stringify(val)
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return JSON.stringify(val)
  if (typeof val === 'object') return JSON.stringify(val)
  return JSON.stringify(val)
}
