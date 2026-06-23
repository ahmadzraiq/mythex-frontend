/**
 * uuid-map.ts — builds a reverse map from UUID → DSL name for all compiled entities.
 *
 * Used by all decompiler modules to replace `variables['uuid']` with bare variable
 * names, workflow UUIDs with function names, etc.
 */

import fs from 'fs'
import path from 'path'

export interface UuidMap {
  /** uuid → dslName (variables, workflows, functions, components, datasources) */
  vars: Map<string, string>
  workflows: Map<string, string>
  functions: Map<string, string>
  components: Map<string, string>
  datasources: Map<string, string>
  /** Combined map for any entity (for quick lookup without knowing type) */
  all: Map<string, string>
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Build UUID→name reverse maps by reading compiled JSON config files from disk.
 * configDir defaults to <cwd>/config.
 */
export function buildUuidMap(configDir?: string): UuidMap {
  const dir = configDir ?? path.join(process.cwd(), 'config')

  const vars = new Map<string, string>()
  const workflows = new Map<string, string>()
  const functions = new Map<string, string>()
  const components = new Map<string, string>()
  const datasources = new Map<string, string>()

  // ── Variables ──────────────────────────────────────────────────────────────
  const varsJson = readJson(path.join(dir, 'variables.json')) as { variables?: Record<string, { _dslName?: string; label?: string }> } | null
  if (varsJson?.variables) {
    for (const [uuid, entry] of Object.entries(varsJson.variables)) {
      const name = entry._dslName ?? entry.label
      if (name) {
        vars.set(uuid, name)
      }
    }
  }

  // ── Workflows (all actions/*.json files) ───────────────────────────────────
  const actionsDir = path.join(dir, 'actions')
  if (fs.existsSync(actionsDir)) {
    for (const file of fs.readdirSync(actionsDir)) {
      if (!file.endsWith('.json')) continue
      const actionJson = readJson(path.join(actionsDir, file)) as Record<string, { _dslName?: string; name?: string; _src?: string }> | null
      if (!actionJson) continue
      for (const [key, entry] of Object.entries(actionJson)) {
        const name = entry._dslName ?? entry.name ?? key
        if (name) {
          workflows.set(key, name)
        }
      }
    }
  }

  // ── Functions (formulas.json) ──────────────────────────────────────────────
  const formulasJson = readJson(path.join(dir, 'formulas.json')) as Record<string, { _dslName?: string; name?: string }> | null
  if (formulasJson) {
    for (const [uuid, entry] of Object.entries(formulasJson)) {
      const name = entry._dslName ?? entry.name
      if (name) {
        functions.set(uuid, name)
      }
    }
  }

  // ── Shared Components (shared-components.json) ────────────────────────────
  const scJson = readJson(path.join(dir, 'shared-components.json')) as Record<string, { _dslName?: string; name?: string }> | null
  if (scJson) {
    for (const [id, entry] of Object.entries(scJson)) {
      const name = entry._dslName ?? entry.name ?? id
      if (name) {
        components.set(id, name)
      }
    }
  }

  // ── Datasources (datasources.json) ────────────────────────────────────────
  const dsJson = readJson(path.join(dir, 'datasources.json')) as Record<string, { _dslName?: string; label?: string }> | null
  if (dsJson) {
    for (const [uuid, entry] of Object.entries(dsJson)) {
      const name = entry._dslName ?? entry.label
      if (name) {
        datasources.set(uuid, name)
      }
    }
  }

  const all = new Map<string, string>([...vars, ...workflows, ...functions, ...components, ...datasources])

  return { vars, workflows, functions, components, datasources, all }
}

/**
 * Replace all occurrences of `variables['uuid']` with the DSL variable name.
 * Also replaces `variables["uuid"]` (double-quote form).
 */
export function resolveUuidsInExpr(expr: string, uuidMap: UuidMap): string {
  return expr
    .replace(/variables\[['"]([a-f0-9-]+)['"]\]/g, (match, uuid) => {
      const name = uuidMap.vars.get(uuid)
      return name ?? match
    })
    .replace(/parameters\?\.\[['"](\w+)['"]\]/g, '$1')
    .replace(/parameters\[['"](\w+)['"]\]/g, '$1')
    .replace(/context\.component\?\.props\?\.['"](\w+)['"]/g, '$1')
    .replace(/context\.component\?\.props\?.\[['"](\w+)['"]\]/g, '$1')
    .replace(/context\.item\.data\.(\w+)/g, 'item.$1')
    .replace(/context\.item\?\.data\?\.(\w+)/g, 'item.$1')
}
