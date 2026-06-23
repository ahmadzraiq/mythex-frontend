/**
 * lib/dsl/decompiler/index.ts — orchestrates all decompilers.
 *
 * Exports two entry points:
 *
 *   decompileStore(builderStore)     — browser-side: reads live builder state
 *   decompileAllFromConfig(dir?)     — server-side: reads compiled JSON config from disk
 */

import path from 'path'
import { buildUuidMap } from './uuid-map'
import { decompileVars } from './decompile-vars'
import { decompileFunctions } from './decompile-functions'
import { decompileWorkflows } from './decompile-workflows'
import { decompileComponents } from './decompile-components'
import { decompilePages } from './decompile-pages'
import { decompileTriggers } from './decompile-triggers'
import type { DecompiledEntry } from './decompile-vars'
import fs from 'fs'

// Browser-side decompiler (uses live builder store)
import { buildResolveContext } from './resolve'
import { decompilePage } from './decompile-page'
import type { BuilderStore } from '@/app/dev/builder/_store-types'

export type { DecompiledEntry }

/**
 * Decompile the live builder store to a map of filename → DSL source.
 * Used by the browser (files panel) to show current canvas state as code.
 */
export function decompileStore(store: BuilderStore): Record<string, string> {
  const ctx = buildResolveContext(store)
  const result: Record<string, string> = {}

  for (const page of store.pages ?? []) {
    const filename = `${page.name ?? 'page'}.jsx`
    try {
      result[filename] = decompilePage(page, ctx)
    } catch {
      // skip pages that fail to decompile
    }
  }

  return result
}

/**
 * Build the complete set of DSL source files from compiled config JSON.
 *
 * Kind ordering within each file:
 *   1. vars
 *   2. functions
 *   3. workflows
 *   4. components
 *   5. pages
 *
 * @param configDir  Path to the config directory (default: <cwd>/config)
 * @returns Record<filename, reconstructed file content>
 */
export function decompileAllFromConfig(configDir?: string): Record<string, string> {
  const dir = configDir ?? path.join(process.cwd(), 'config')

  // Build UUID→name reverse map
  const uuidMap = buildUuidMap(dir)

  // Collect known SC names for JSX tag resolution
  const knownScNames = new Set<string>(uuidMap.components.values())

  // Run all decompilers
  const allEntries: DecompiledEntry[] = [
    ...decompileVars(dir),
    ...decompileFunctions(uuidMap, dir),
    ...decompileWorkflows(uuidMap, dir),
    ...decompileComponents(uuidMap, knownScNames, dir),
    ...decompilePages(uuidMap, knownScNames, dir),
    ...decompileTriggers(dir),
  ]

  if (allEntries.length === 0) return {}

  // Group by srcFile
  const byFile = new Map<string, DecompiledEntry[]>()
  for (const entry of allEntries) {
    const existing = byFile.get(entry.srcFile) ?? []
    existing.push(entry)
    byFile.set(entry.srcFile, existing)
  }

  // Sort within each file by kind order, then original order
  const kindOrder: Record<string, number> = { var: 0, function: 1, workflow: 2, component: 3, page: 4, datasource: 5, trigger: 6 }

  const result: Record<string, string> = {}
  for (const [srcFile, entries] of byFile) {
    entries.sort((a, b) => {
      const kDiff = (kindOrder[a.kind] ?? 99) - (kindOrder[b.kind] ?? 99)
      return kDiff !== 0 ? kDiff : a.order - b.order
    })

    const blocks = entries.map(e => e.text)
    // Determine relative import depth from srcFile path segments
    const depth = srcFile.split('/').length - 1
    const builderRelPath = depth === 0 ? './builder' : '../'.repeat(depth) + 'builder'
    const header = `import { defineVar, defineFunction, defineWorkflow, defineComponent, defineDatasource, defineTrigger, definePage } from '${builderRelPath}'\nimport { Box, Text, Image, Icon, Input, Textarea, Video, FormContainer, For, Show } from '${builderRelPath}'\nimport { run, set, when, seq, ev } from '${builderRelPath}'\n\n`
    const fileContent = header + blocks.join('\n\n') + '\n'
    result[srcFile] = fileContent
  }

  return result
}
