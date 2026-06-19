/**
 * File watcher for the DSL src/ directory.
 * Uses chokidar to detect changes and trigger the compiler.
 * Debounced per file to avoid multiple compiles for rapid saves.
 *
 * Usage:
 *   import { startDslWatcher } from '@/lib/dsl/watcher'
 *   startDslWatcher()   // in next.config.mjs webpack hook (dev only)
 */

import path from 'path'
import { compileFile, compileAll } from './compiler/index'

let watcher: ReturnType<typeof import('chokidar')['watch']> | null = null
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const DEBOUNCE_MS = 150

function scheduleCompile(filePath: string) {
  const existing = debounceTimers.get(filePath)
  if (existing) clearTimeout(existing)

  debounceTimers.set(
    filePath,
    setTimeout(async () => {
      debounceTimers.delete(filePath)
      try {
        await compileFile(filePath)
      } catch (err) {
        console.error('[DSL watcher] compile error:', err)
      }
    }, DEBOUNCE_MS),
  )
}

export async function startDslWatcher(srcDir?: string): Promise<void> {
  if (watcher) return // already running

  const watchDir = srcDir ?? path.join(process.cwd(), 'src')
  const chokidar = await import('chokidar')

  console.log(`[DSL watcher] watching ${watchDir}`)

  // Initial compile of all existing files
  await compileAll(watchDir)

  watcher = chokidar.watch(watchDir, {
    ignored: /(^|[/\\])\..|(tsconfig\.json$)/,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  })

  watcher
    .on('add',    (f: string) => scheduleCompile(f))
    .on('change', (f: string) => scheduleCompile(f))
    .on('unlink', (f: string) => {
      console.log(`[DSL watcher] file removed: ${path.relative(process.cwd(), f)}`)
      // Note: we intentionally do NOT delete compiled config on unlink —
      // the builder user can delete config entries via the builder UI.
    })
    .on('error',  (err: unknown) => console.error('[DSL watcher] error:', err))

  process.on('exit', () => { void stopDslWatcher() })
}

export async function stopDslWatcher(): Promise<void> {
  if (!watcher) return
  await watcher.close()
  watcher = null
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
}
