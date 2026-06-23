/**
 * VFS path → UUID resolution for the DSL compiler.
 *
 * Builds a path→UUID map from existing on-disk config files, supplemented by
 * a per-project DSL registry (config/dsl-registry.json) that tracks names the
 * DSL compiler itself registered. On first compile, DSL items get new UUIDs and
 * are recorded in the registry; subsequent compiles reuse those UUIDs.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export interface VfsRegistry {
  /** friendly name → UUID */
  pathToId: Map<string, string>
  /** UUID → friendly name */
  idToPath: Map<string, string>
}

interface DslRegistry {
  vars: Record<string, string>        // "displayValue" → UUID
  workflows: Record<string, string>   // "handleClick" → UUID
  datasources: Record<string, string> // "products" → UUID
  components: Record<string, string>  // "productCard" → UUID
  formulas: Record<string, string>    // "formatCurrency" → UUID
  pages: Record<string, string>       // "Calculator" → config key
  triggers: Record<string, string>    // "pageLoad:Calculator" → UUID
}

function emptyRegistry(): DslRegistry {
  return { vars: {}, workflows: {}, datasources: {}, components: {}, formulas: {}, pages: {}, triggers: {} }
}

const REGISTRY_PATH = path.join(process.cwd(), 'config', 'dsl-registry.json')

export function loadDslRegistry(): DslRegistry {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8')
    return { ...emptyRegistry(), ...JSON.parse(raw) }
  } catch {
    return emptyRegistry()
  }
}

export function saveDslRegistry(reg: DslRegistry): void {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true })
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + '\n', 'utf-8')
}

/**
 * Build a path→UUID map from existing config files.
 * Reads variables.json, actions/, datasources.json, shared-components.json.
 */
export function buildVfsRegistry(): VfsRegistry {
  const pathToId = new Map<string, string>()
  const idToPath = new Map<string, string>()

  const configDir = path.join(process.cwd(), 'config')

  // Variables
  try {
    const varsFile = path.join(configDir, 'variables.json')
    const raw = JSON.parse(fs.readFileSync(varsFile, 'utf-8')) as { variables: Record<string, { label: string; _dslName?: string }> }
    for (const [uuid, v] of Object.entries(raw.variables ?? {})) {
      const name = v._dslName ?? v.label ?? uuid
      const vfsPath = `store/${name}`
      pathToId.set(vfsPath, uuid)
      idToPath.set(uuid, vfsPath)
      // Also register bare label
      pathToId.set(`store/${v.label}`, uuid)
      pathToId.set(name, uuid)
    }
  } catch { /* ignore if missing */ }

  // Workflows (config/actions/*.json)
  try {
    const actionsDir = path.join(configDir, 'actions')
    const files = fs.readdirSync(actionsDir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      const raw = JSON.parse(fs.readFileSync(path.join(actionsDir, file), 'utf-8')) as Record<string, { name?: string }>
      for (const [wfId, wf] of Object.entries(raw)) {
        const name = wf.name ?? wfId
        pathToId.set(`workflows/${name}`, wfId)
        pathToId.set(`workflows/${wfId}`, wfId)
        idToPath.set(wfId, `workflows/${name}`)
      }
    }
  } catch { /* ignore */ }

  // Datasources
  try {
    const dsFile = path.join(configDir, 'datasources.json')
    const raw = JSON.parse(fs.readFileSync(dsFile, 'utf-8')) as Record<string, { label?: string; folder?: string }>
    for (const [uuid, ds] of Object.entries(raw)) {
      const name = ds.label ?? uuid
      pathToId.set(`data/${name}`, uuid)
      idToPath.set(uuid, `data/${name}`)
    }
  } catch { /* ignore */ }

  // Shared components
  try {
    const scFile = path.join(configDir, 'shared-components.json')
    const raw = JSON.parse(fs.readFileSync(scFile, 'utf-8')) as Record<string, { name?: string }>
    for (const [id, sc] of Object.entries(raw)) {
      const name = sc.name ?? id
      pathToId.set(`components/${id}`, id)
      pathToId.set(`components/${name}`, id)
      idToPath.set(id, `components/${name}`)
    }
  } catch { /* ignore */ }

  // Load DSL registry and add its entries
  const dslReg = loadDslRegistry()
  for (const [name, uuid] of Object.entries(dslReg.vars)) {
    pathToId.set(`store/${name}`, uuid)
    if (!idToPath.has(uuid)) idToPath.set(uuid, `store/${name}`)
  }
  for (const [name, uuid] of Object.entries(dslReg.workflows)) {
    pathToId.set(`workflows/${name}`, uuid)
    if (!idToPath.has(uuid)) idToPath.set(uuid, `workflows/${name}`)
  }
  for (const [name, uuid] of Object.entries(dslReg.datasources)) {
    pathToId.set(`data/${name}`, uuid)
    if (!idToPath.has(uuid)) idToPath.set(uuid, `data/${name}`)
  }
  for (const [name, uuid] of Object.entries(dslReg.components)) {
    pathToId.set(`components/${name}`, uuid)
    if (!idToPath.has(uuid)) idToPath.set(uuid, `components/${name}`)
  }

  return { pathToId, idToPath }
}

/**
 * Get or create UUID for a VFS path. Stores new UUIDs in the DSL registry.
 */
export function getOrCreateUuid(
  category: keyof DslRegistry,
  name: string,
  registry: VfsRegistry,
  dslReg: DslRegistry,
): string {
  const vfsPath = category === 'vars'
    ? `store/${name}`
    : category === 'workflows'
    ? `workflows/${name}`
    : category === 'datasources'
    ? `data/${name}`
    : category === 'components'
    ? `components/${name}`
    : `${category}/${name}`

  if (registry.pathToId.has(vfsPath)) {
    return registry.pathToId.get(vfsPath)!
  }

  const uuid = crypto.randomUUID()
  registry.pathToId.set(vfsPath, uuid)
  registry.idToPath.set(uuid, vfsPath)
  ;(dslReg[category] as Record<string, string>)[name] = uuid
  return uuid
}

/**
 * Replace all known VFS path references in a JS/JSON string with their UUIDs.
 * Handles:
 *   vars['store/x']    → variables['<uuid>']
 *   'store/x'          → '<uuid>'
 *   "workflows/x"      → '<uuid>'
 */
export function resolvePathRefs(text: string, pathToId: Map<string, string>): string {
  // Sort longest-first to avoid partial matches
  const sorted = [...pathToId.entries()].sort((a, b) => b[0].length - a[0].length)
  let result = text
  for (const [key, uuid] of sorted) {
    if (key === uuid) continue
    result = result.split(`"${key}"`).join(`"${uuid}"`)
    result = result.split(`'${key}'`).join(`'${uuid}'`)
  }
  return result
}

