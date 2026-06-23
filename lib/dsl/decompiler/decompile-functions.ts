/**
 * decompile-functions.ts — reconstructs `defineFunction` declarations from formulas.json.
 *
 * Only entries with `_dslName` + `_src` are emitted.
 * The formula body is restored:
 *   - `parameters.paramName` → `paramName`
 *   - `variables['uuid']` → DSL variable name
 */

import fs from 'fs'
import path from 'path'
import type { DecompiledEntry } from './decompile-vars'
import { resolveUuidsInExpr, type UuidMap } from './uuid-map'

interface FormulaEntry {
  _dslName?: string
  _src?: string
  name?: string
  formula?: string | { js?: string; formula?: string }
  params?: Array<{ id: string; name: string; type: string }>
}

/**
 * Read formulas.json and reconstruct `defineFunction` declarations for DSL-authored functions.
 */
export function decompileFunctions(uuidMap: UuidMap, configDir?: string): DecompiledEntry[] {
  const dir = configDir ?? path.join(process.cwd(), 'config')
  const results: DecompiledEntry[] = []

  let formulasJson: Record<string, FormulaEntry> | null = null
  try {
    formulasJson = JSON.parse(fs.readFileSync(path.join(dir, 'formulas.json'), 'utf-8'))
  } catch {
    return results
  }

  if (!formulasJson) return results

  let order = 0
  for (const [, entry] of Object.entries(formulasJson)) {
    const name = entry._dslName ?? entry.name
    const src = entry._src
    if (!name || !src) continue

    // Extract formula body string
    let body = ''
    if (typeof entry.formula === 'string') {
      body = entry.formula
    } else if (entry.formula && typeof entry.formula === 'object') {
      body = (entry.formula as { js?: string; formula?: string }).js ?? (entry.formula as { js?: string; formula?: string }).formula ?? ''
    }

    // Restore param names: parameters.paramName → paramName
    const paramNames = (entry.params ?? []).map(p => p.name).filter(Boolean)
    for (const param of paramNames) {
      body = body
        .replace(new RegExp(`\\bparameters\\.${param}\\b`, 'g'), param)
        .replace(new RegExp(`parameters\\[['"]${param}['"]\\]`, 'g'), param)
    }

    // Restore variable UUIDs → DSL names
    body = resolveUuidsInExpr(body, uuidMap)

    // Determine if body is a single expression or multi-statement
    const trimmed = body.trim()
    const isMultiStatement = trimmed.includes('\n') || trimmed.includes(';') || trimmed.startsWith('const ') || trimmed.startsWith('let ') || trimmed.startsWith('if (') || trimmed.startsWith('return ')

    let fnText: string
    if (paramNames.length === 0) {
      if (isMultiStatement) {
        fnText = `(${paramNames.join(', ')}) => {\n${indent(trimmed)}\n}`
      } else {
        fnText = `() => ${trimmed}`
      }
    } else {
      if (isMultiStatement) {
        fnText = `(${paramNames.join(', ')}) => {\n${indent(trimmed)}\n}`
      } else {
        fnText = `(${paramNames.join(', ')}) => ${trimmed}`
      }
    }

    results.push({
      text: `export const ${name} = defineFunction(${fnText})`,
      srcFile: src,
      kind: 'function',
      order: order++,
    })
  }

  return results
}

function indent(code: string, spaces = 2): string {
  return code.split('\n').map(l => ' '.repeat(spaces) + l).join('\n')
}
