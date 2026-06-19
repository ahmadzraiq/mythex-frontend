/**
 * Aider-style repo map for the DSL src/ directory.
 *
 * Walks src/ using the TypeScript compiler API, extracts:
 *   - define*() call type (page, workflow, var, trigger, etc.)
 *   - exported names and their define*() options
 *   - JSDoc @description or first comment as a brief description
 *
 * Returns a compact string (~500-1000 tokens) injected into every Claude call
 * so Claude knows what already exists and can avoid duplication.
 *
 * No vectors, no database, no embeddings — pure AST.
 */

import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import { detectAllDefines, type ExportedDefine, type CompilerType } from './compiler/detect'

const MAX_TOKENS_APPROX = 1000
const CHARS_PER_TOKEN = 4

const DEFINE_LABELS: Record<CompilerType, string> = {
  page: 'page',
  workflow: 'workflow',
  var: 'var',
  trigger: 'trigger',
  component: 'component',
  formula: 'formula',
  datasource: 'datasource',
  route: 'route',
  theme: 'theme',
  group: 'group',
  unknown: '?',
}

interface FileEntry {
  relPath: string
  defines: ExportedDefine[]
  comment?: string
}

function extractFirstComment(srcPath: string): string | undefined {
  let source: string
  try {
    source = fs.readFileSync(srcPath, 'utf-8')
  } catch {
    return undefined
  }

  // Look for leading /** ... */ or // comment before first import/export
  const lines = source.split('\n')
  for (const line of lines.slice(0, 5)) {
    const stripped = line.trim()
    if (stripped.startsWith('/**') || stripped.startsWith('//')) {
      return stripped
        .replace(/^\/\*\*?\s*/, '')
        .replace(/^\s*\*\s*/, '')
        .replace(/\*\/$/, '')
        .replace(/^\/\/\s*/, '')
        .trim()
        .slice(0, 80)
    }
    if (stripped.startsWith('import') || stripped.startsWith('export')) break
  }
  return undefined
}

function collectSrcFiles(srcDir: string): string[] {
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const full = path.join(srcDir, entry.name)
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        results.push(...collectSrcFiles(full))
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && entry.name !== 'tsconfig.json') {
        results.push(full)
      }
    }
  } catch { /* ignore */ }
  // Sort by modification time (newest first — most relevant to Claude)
  results.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
    } catch {
      return 0
    }
  })
  return results
}

function formatDefine(def: ExportedDefine): string {
  const label = DEFINE_LABELS[def.type] ?? def.type
  const opts = Object.entries(def.options)
    .map(([k, v]) => `${k}:'${v}'`)
    .join(', ')
  if (def.type === 'var') {
    return `  ${def.exportName} = defineVar(...)`
  }
  return `  ${def.exportName} = define${capitalize(label)}(${opts ? `{ ${opts} }` : ''})`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function detectDefinesFromSource(source: string, filename: string): ExportedDefine[] {
  try {
    // Use detectAllDefines via a temp approach: parse inline
    const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
    const results: ExportedDefine[] = []
    // Minimal inline detection matching detectAllDefines logic
    sf.forEachChild(node => {
      let callNode: ts.CallExpression | null = null
      if (ts.isExportAssignment(node) && ts.isCallExpression(node.expression)) {
        callNode = node.expression
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.initializer && ts.isCallExpression(decl.initializer)) {
            callNode = decl.initializer
          }
        }
      }
      if (!callNode) return
      const name = ts.isIdentifier(callNode.expression) ? callNode.expression.text : null
      if (!name || !name.startsWith('define')) return
      const typeMap: Record<string, string> = {
        definePage: 'page', defineWorkflow: 'workflow', defineVar: 'var',
        defineTrigger: 'trigger', defineComponent: 'component', defineFormula: 'formula',
        defineDatasource: 'datasource', defineRoute: 'route', defineTheme: 'theme',
      }
      const type = typeMap[name] ?? 'unknown'
      const opts: Record<string, string> = {}
      const optArg = callNode.arguments[0]
      if (optArg && ts.isObjectLiteralExpression(optArg)) {
        for (const prop of optArg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue
          const k = ts.isIdentifier(prop.name) ? prop.name.text : null
          if (k && ts.isStringLiteral(prop.initializer)) opts[k] = prop.initializer.text
        }
      }
      results.push({ exportName: opts.path ?? opts.name ?? name, type: type as ExportedDefine['type'], options: opts, line: 0 })
    })
    return results
  } catch {
    return []
  }
}

/**
 * Build an Aider-style repo map.
 * Accepts either a filesystem directory path (string) or an in-memory VFS (Map<path, source>).
 * Returns a string suitable for insertion into Claude's system prompt.
 */
export function buildRepoMap(srcDirOrVfs?: string | Map<string, string>): string {
  // In-memory VFS path
  if (srcDirOrVfs instanceof Map) {
    const vfs = srcDirOrVfs
    if (vfs.size === 0) return '(no src/ files yet — write your first DSL file to get started)'

    const entries: FileEntry[] = []
    for (const [relPath, source] of vfs.entries()) {
      if (!/\.(ts|tsx)$/.test(relPath)) continue
      const defines = detectDefinesFromSource(source, relPath)
      entries.push({ relPath, defines })
    }

    return formatEntries(entries)
  }

  // Filesystem path
  const dir = (typeof srcDirOrVfs === 'string' ? srcDirOrVfs : null) ?? path.join(process.cwd(), 'src')

  if (!fs.existsSync(dir)) {
    return '(no src/ files yet — write your first DSL file to get started)'
  }

  const files = collectSrcFiles(dir)
  if (files.length === 0) return '(src/ is empty — no DSL files yet)'

  const entries: FileEntry[] = []
  for (const filePath of files) {
    const defines = detectAllDefines(filePath)
    const relPath = path.relative(dir, filePath)
    const comment = defines.length === 0 ? extractFirstComment(filePath) : undefined
    entries.push({ relPath, defines, comment })
  }

  return formatEntries(entries)
}

function formatEntries(entries: FileEntry[]): string {
  const lines: string[] = ['## Current src/ files\n']
  let approxChars = 0

  for (const entry of entries) {
    if (entry.defines.length === 0 && !entry.comment) continue

    const defLines = entry.defines.map(formatDefine)
    const commentLine = entry.comment ? `  // ${entry.comment}` : ''
    const block = [entry.relPath, ...defLines, ...(commentLine ? [commentLine] : '')].join('\n')
    approxChars += block.length

    if (approxChars > MAX_TOKENS_APPROX * CHARS_PER_TOKEN) break

    lines.push(block)
    lines.push('')
  }

  return lines.join('\n')
}

export async function buildRepoMapAsync(srcDirOrVfs?: string | Map<string, string>): Promise<string> {
  return buildRepoMap(srcDirOrVfs)
}
