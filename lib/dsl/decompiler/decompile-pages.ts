/**
 * decompile-pages.ts — reconstructs `definePage` declarations from screens/*.json.
 *
 * Only pages with `meta._src` are emitted.
 */

import fs from 'fs'
import path from 'path'
import type { DecompiledEntry } from './decompile-vars'
import { nodeToJsx } from './decompile-node'
import type { UuidMap } from './uuid-map'

interface PageJson {
  meta?: { title?: string; _src?: string }
  ui?: unknown[]
  content?: unknown
  layout?: string
}

export function decompilePages(uuidMap: UuidMap, knownScNames: Set<string>, configDir?: string): DecompiledEntry[] {
  const dir = configDir ?? path.join(process.cwd(), 'config')
  const screensDir = path.join(dir, 'screens')
  const results: DecompiledEntry[] = []

  if (!fs.existsSync(screensDir)) return results

  let order = 0
  for (const filename of fs.readdirSync(screensDir).sort()) {
    // Screens are flat JSON files: adminProducts.json, home.json, etc.
    if (!filename.endsWith('.json')) continue
    const pageFile = path.join(screensDir, filename)

    let pageJson: PageJson | null = null
    try {
      pageJson = JSON.parse(fs.readFileSync(pageFile, 'utf-8'))
    } catch { continue }

    const src = pageJson?.meta?._src
    if (!src) continue

    // DSL-compiled pages use { meta: { title, _src }, ui: [rootNode] }
    const ui = pageJson.ui?.[0] as Record<string, unknown> | undefined
    if (!ui) continue

    const pageName = filename.replace(/\.json$/, '')
    const routePath = pageName === 'home' ? '/' : `/${pageName}`
    const varName = toCamelCase(pageName) + 'Page'

    const jsxTree = nodeToJsx(ui as never, uuidMap, 1, knownScNames)

    results.push({
      text: `export const ${varName} = definePage('${routePath}', () => (\n${jsxTree}\n))`,
      srcFile: src,
      kind: 'page',
      order: order++,
    })
  }

  return results
}

function toCamelCase(str: string): string {
  return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
}
