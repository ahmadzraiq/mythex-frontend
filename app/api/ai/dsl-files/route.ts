/**
 * GET /api/ai/dsl-files
 * Returns a map of relative path → file content for all src/ DSL files.
 * Used by the DslChatPanel Files tab to display source files.
 */

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

function collectFiles(dir: string, base: string): Record<string, string> {
  const result: Record<string, string> = {}
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      const relPath = path.join(base, entry.name)
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        Object.assign(result, collectFiles(fullPath, relPath))
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && entry.name !== 'tsconfig.json') {
        try {
          result[relPath] = fs.readFileSync(fullPath, 'utf-8')
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* ignore */ }
  return result
}

export async function GET() {
  const srcDir = path.join(process.cwd(), 'src')
  const files = collectFiles(srcDir, '')

  // Clean up leading path separator
  const normalized = Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k.replace(/^[/\\]/, ''), v])
  )

  return NextResponse.json({ files: normalized })
}
