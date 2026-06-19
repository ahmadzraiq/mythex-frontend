/**
 * DSL compiler orchestrator.
 *
 * Detects the file type from the define*() call, runs the correct compiler,
 * then saves the DSL registry. Called by the chokidar watcher on every src/ change.
 */

import path from 'path'
import { detectFileType, detectAllDefines } from './detect'
import { buildVfsRegistry } from './resolve-vfs'
import { compileVarFile } from './compile-var'
import { compileWorkflowFile } from './compile-workflow'
import { compileTriggerFile } from './compile-trigger'
import { compilePageFile } from './compile-page'
import { compileComponentFile } from './compile-component'
import { compileFormulaFile } from './compile-formula'
import { compileDatasourceFile } from './compile-datasource'
import { compileRouteFile } from './compile-route'
import { compileThemeFile } from './compile-theme'

export async function compileFile(srcPath: string): Promise<void> {
  const ext = path.extname(srcPath)
  if (!['.ts', '.tsx'].includes(ext)) return

  // Build VFS registry once per file compile (shared across all compilers)
  const registry = buildVfsRegistry()

  // A single file may contain multiple define*() calls (e.g. store files with multiple defineVar)
  // OR it may have a single primary define*() call that determines the file type.

  // Check all define*() calls in the file
  const allDefines = detectAllDefines(srcPath)
  const types = new Set(allDefines.map(d => d.type))

  // Var files: multiple defineVar exports in one file
  if (types.has('var')) {
    compileVarFile(srcPath, registry)
  }

  // Formula files
  if (types.has('formula')) {
    compileFormulaFile(srcPath)
  }

  // Datasource files
  if (types.has('datasource')) {
    compileDatasourceFile(srcPath, registry)
  }

  // Route files
  if (types.has('route')) {
    compileRouteFile(srcPath)
  }

  // Theme files
  if (types.has('theme')) {
    compileThemeFile(srcPath)
  }

  // Workflow files
  if (types.has('workflow')) {
    compileWorkflowFile(srcPath, registry)
  }

  // Trigger files
  if (types.has('trigger')) {
    compileTriggerFile(srcPath, registry)
  }

  // Page files (usually one per file)
  if (types.has('page') || types.has('group')) {
    compilePageFile(srcPath, registry)
  }

  // Component files
  if (types.has('component')) {
    compileComponentFile(srcPath, registry)
  }

  // If no defines found, fall back to primary type detection
  if (allDefines.length === 0) {
    const primary = detectFileType(srcPath)
    if (primary.type !== 'unknown') {
      console.warn(`[DSL] No exported define*() found in ${srcPath}, but detected type: ${primary.type}`)
    }
  }
}

/**
 * Compile all .ts/.tsx files in src/ directory (initial build).
 */
export async function compileAll(srcDir: string = path.join(process.cwd(), 'src')): Promise<void> {
  const { globby } = await import('globby').catch(() => ({ globby: null }))
  let files: string[]

  if (globby) {
    files = await globby(['**/*.{ts,tsx}', '!**/node_modules/**', '!tsconfig.json'], {
      cwd: srcDir,
      absolute: true,
    })
  } else {
    // Fallback: use fs.readdirSync recursively
    files = collectFiles(srcDir)
  }

  for (const f of files) {
    try {
      await compileFile(f)
    } catch (err) {
      console.error(`[DSL] Error compiling ${f}:`, err)
    }
  }
}

function collectFiles(dir: string): string[] {
  const fs = require('fs') as typeof import('fs')
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        results.push(...collectFiles(fullPath))
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && entry.name !== 'tsconfig.json') {
        results.push(fullPath)
      }
    }
  } catch { /* ignore unreadable dirs */ }
  return results
}
