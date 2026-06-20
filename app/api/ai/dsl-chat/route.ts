/**
 * POST /api/ai/dsl-chat
 *
 * DSL chat using @anthropic-ai/sdk directly — no subprocess, scales to 1000+ users.
 *
 * Flow:
 *  1. Accept { message, projectId?, dslSources? } from client
 *  2. Restore dslSources into per-project in-memory VFS
 *  3. Run agentic tool loop: Claude uses write_file / read_file / edit_file / list_files / search_files
 *  4. After loop: compile any written page.tsx files with compilePageToJson()
 *  5. Emit page_written events → client calls applyVirtualFile() → builder canvas updates
 *  6. Emit dsl_sources event → client persists DSL sources to project DB
 *
 * Client receives streaming events:
 *   { type: 'text', content: '...' }
 *   { type: 'tool_use', toolName: '...', input: {...} }
 *   { type: 'tool_result', toolName: '...', content: '...' }
 *   { type: 'page_written', path: 'pages/X/page', content: '{"meta":...,"ui":[...]}' }
 *   { type: 'dsl_sources', sources: { 'calculator/page.tsx': '...' } }
 *   { type: 'done' }
 *   { type: 'error', error: '...' }
 */

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildRepoMap } from '@/lib/dsl/repo-map'
import { DSL_SYSTEM_PROMPT } from '@/lib/dsl/system-prompt'
import { compilePageToJson } from '@/lib/dsl/compiler/compile-page'
import { compileVarsToJson } from '@/lib/dsl/compiler/compile-var'
import { compileAllWorkflowsToJson, type CompiledWorkflow } from '@/lib/dsl/compiler/compile-workflow'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ─── Per-project in-memory VFS ────────────────────────────────────────────────
// Map<projectId, Map<relativePath, sourceCode>>
// Keyed by projectId so each project has isolated file state.
// Falls back to a single shared VFS when no projectId (dev/admin mode).

const PROJECT_VFS = new Map<string, Map<string, string>>()
const DEV_VFS = new Map<string, string>()

function getVfs(projectId?: string): Map<string, string> {
  if (!projectId) return DEV_VFS
  if (!PROJECT_VFS.has(projectId)) PROJECT_VFS.set(projectId, new Map())
  return PROJECT_VFS.get(projectId)!
}

// ─── SDK-native tools (Anthropic owns the schemas) ───────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DSL_TOOLS: any[] = [
  { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' },
  { type: 'bash_20250124',        name: 'bash' },
]

const READONLY_FILES = new Set(['builder.ts'])

// ─── Tool executor ────────────────────────────────────────────────────────────

function executeTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>,
  vfs: Map<string, string>,
  writtenFiles: Set<string>,
): string {
  // ── text_editor: view / create / str_replace / insert ──────────────────────
  if (name === 'str_replace_based_edit_tool') {
    const cmd = (input.command ?? '') as string
    const p   = ((input.path ?? '') as string).replace(/^\/+/, '')

    if (READONLY_FILES.has(p) && cmd !== 'view') {
      return `Error: "${p}" is read-only. You may only view it.`
    }

    switch (cmd) {
      case 'view': {
        if (!p || p === '.' || p === '/') {
          const keys = [...vfs.keys()]
          return keys.length > 0 ? keys.join('\n') : '(empty)'
        }
        const content = vfs.get(p)
        if (content === undefined) return `Error: file not found: ${p}`
        if (input.view_range) {
          const [start, end] = input.view_range as [number, number]
          const lines = content.split('\n')
          return lines.slice(start - 1, end === -1 ? undefined : end).join('\n')
        }
        return content
      }

      case 'create': {
        vfs.set(p, (input.file_text ?? '') as string)
        writtenFiles.add(p)
        return `Created ${p}`
      }

      case 'str_replace': {
        const current = vfs.get(p)
        if (current === undefined) return `Error: file not found: ${p}. View it first.`
        const oldStr = (input.old_str ?? '') as string
        if (!current.includes(oldStr)) {
          return `Error: old_str not found in ${p}. Must match exactly (including whitespace).`
        }
        const newStr = (input.new_str ?? '') as string
        vfs.set(p, current.replace(oldStr, newStr))
        writtenFiles.add(p)
        return `Updated ${p}`
      }

      case 'insert': {
        const current = vfs.get(p) ?? ''
        const lines = current.split('\n')
        const insertLine = Number(input.insert_line ?? 0)
        lines.splice(insertLine, 0, (input.new_str ?? '') as string)
        vfs.set(p, lines.join('\n'))
        writtenFiles.add(p)
        return `Inserted into ${p} at line ${insertLine}`
      }

      default:
        return `Error: unknown command "${cmd}". Supported: view, create, str_replace, insert`
    }
  }

  // ── bash: grep / ls / find / cat against VFS ───────────────────────────────
  if (name === 'bash') {
    const cmd = ((input.command ?? '') as string).trim()

    // grep [-flags] pattern [path]
    const grepM = cmd.match(/^grep\s+(?:-[a-zA-Z]+\s+)*["']?([^"'\s]+)["']?/)
    if (grepM) {
      const results: string[] = []
      try {
        const re = new RegExp(grepM[1], 'gi')
        for (const [fp, content] of vfs.entries()) {
          content.split('\n').forEach((line, i) => {
            re.lastIndex = 0
            if (re.test(line)) results.push(`${fp}:${i + 1}: ${line.trim()}`)
          })
        }
      } catch {
        for (const [fp, content] of vfs.entries()) {
          content.split('\n').forEach((line, i) => {
            if (line.includes(grepM[1])) results.push(`${fp}:${i + 1}: ${line.trim()}`)
          })
        }
      }
      return results.length > 0 ? results.join('\n') : '(no matches)'
    }

    // ls / find
    if (/^(ls|find)/.test(cmd)) {
      const keys = [...vfs.keys()]
      return keys.length > 0 ? keys.join('\n') : '(empty)'
    }

    // cat <path>
    const catM = cmd.match(/^cat\s+(.+)/)
    if (catM) {
      const p = catM[1].trim().replace(/^\/+/, '')
      const content = vfs.get(p)
      return content !== undefined ? content : `Error: file not found: ${p}`
    }

    return `Error: only grep, ls, find, and cat are supported in bash`
  }

  return `Error: unknown tool "${name}"`
}

// ─── Encoding ─────────────────────────────────────────────────────────────────

function enc(obj: unknown): string {
  return JSON.stringify(obj) + '\n'
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: {
    message?: string
    messages?: Array<{ role: string; content: string }>
    projectId?: string
    dslSources?: Record<string, string>
  }

  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 })
  }

  const userMessage = body.message ?? body.messages?.find(m => m.role === 'user')?.content ?? ''
  if (!userMessage.trim()) {
    return new Response(JSON.stringify({ error: 'No message provided' }), { status: 400 })
  }

  const projectId = body.projectId
  const vfs = getVfs(projectId)

  // Always seed builder.ts so the AI can read it for the correct API reference
  if (!vfs.has('builder.ts')) {
    try {
      const fs = await import('fs')
      const path = await import('path')
      const builderPath = path.join(process.cwd(), 'lib', 'dsl', 'builder', 'index.ts')
      const builderSrc = fs.readFileSync(builderPath, 'utf-8')
      vfs.set('builder.ts', builderSrc)
    } catch { /* skip if not found */ }
  }

  // Restore DSL sources from client (previous session or passed-in state)
  if (body.dslSources) {
    for (const [p, src] of Object.entries(body.dslSources)) {
      if (!vfs.has(p)) vfs.set(p, src)
    }
  }

  const repoMap = buildRepoMap(vfs)
  const systemPrompt = `${DSL_SYSTEM_PROMPT}\n\n${repoMap}`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: unknown) {
        controller.enqueue(encoder.encode(enc(obj)))
      }

      try {
        const messages: Anthropic.MessageParam[] = [
          { role: 'user', content: userMessage },
        ]

        const writtenFiles = new Set<string>()

        // Agentic tool loop
        while (true) {
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 8192,
            system: systemPrompt,
            tools: DSL_TOOLS,
            messages,
          })

          // Stream text blocks to client
          for (const block of response.content) {
            if (block.type === 'text' && block.text) {
              send({ type: 'text', content: block.text })
            }
          }

          // If no tool calls, we're done
          if (response.stop_reason !== 'tool_use') break

          // Collect tool uses, execute, build result
          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const block of response.content) {
            if (block.type !== 'tool_use') continue

            send({ type: 'tool_use', toolName: block.name, input: block.input })

            const output = executeTool(
              block.name,
              block.input as Record<string, string>,
              vfs,
              writtenFiles,
            )

            send({ type: 'tool_result', toolName: block.name, content: output })

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: output,
            })
          }

          // Append assistant turn + tool results to conversation
          messages.push({ role: 'assistant', content: response.content })
          messages.push({ role: 'user', content: toolResults })
        }

        // ── Pass 1: compile all non-page .ts files to variables ───────────────
        // Build pathToId so subsequent compiles resolve variable references to UUIDs.
        const pathToId = new Map<string, string>()
        for (const [filePath, src] of vfs.entries()) {
          if (!filePath.endsWith('.ts') || filePath.endsWith('page.tsx')) continue
          try {
            const compiledVars = compileVarsToJson(src, projectId ?? 'dsl')
            for (const v of compiledVars) {
              pathToId.set(`store/${v.varName}`, v.uuid)
              pathToId.set(v.varName, v.uuid)
              send({
                type: 'var_written',
                path: `store/${v.varName}`,
                content: JSON.stringify(v.entry),
              })
            }
          } catch { /* skip malformed var files */ }
        }

        // ── Pass 1.5: pre-compute workflow UUIDs → add to pathToId ───────────────
        // Pages need to reference workflows by UUID in their actions. This pass
        // compiles EVERY workflow in the VFS (a file may contain multiple defineWorkflow
        // exports) so all their UUIDs are in pathToId before pages are compiled.
        const cachedWorkflows: CompiledWorkflow[] = []

        for (const [filePath, src] of vfs.entries()) {
          if (!src.includes('defineWorkflow')) continue
          try {
            const compiled = compileAllWorkflowsToJson(src, pathToId, projectId ?? 'dsl')
            for (const wf of compiled) {
              pathToId.set(wf.wfPath, wf.uuid)          // e.g. "workflows/handleButton"
              pathToId.set(`workflows/${wf.wfName}`, wf.uuid) // e.g. "workflows/handleButton" (wfName is last segment)
              cachedWorkflows.push(wf)
            }
          } catch (e) {
            console.error(`[pass1.5] ${filePath}:`, e)
          }
        }

        // ── Pass 2: compile pages (with resolved pathToId) + emit workflows ─────
        // Accumulate routes so we can emit a single routes event at the end.
        const collectedRoutes: Array<{ path: string; config: string; name: string }> = []

        for (const filePath of writtenFiles) {
          const src = vfs.get(filePath)
          if (!src) continue

          if (filePath.endsWith('page.tsx')) {
            try {
              const compiled = compilePageToJson(src, pathToId)
              if (!compiled) continue
              send({
                type: 'page_written',
                path: `pages/${compiled.pageName}/page`,
                content: JSON.stringify({
                  meta: { title: compiled.title },
                  ui: [compiled.content],
                }),
              })
              // Register a default route for this page so it appears in the nav
              collectedRoutes.push({
                path: `/${compiled.pageName.toLowerCase()}`,
                config: compiled.pageName,
                name: compiled.title || compiled.pageName,
              })
            } catch { /* skip malformed page files */ }
          }
        }

        // Emit cached workflow results (compiled in Pass 1.5)
        for (const compiled of cachedWorkflows) {
          send({
            type: 'workflow_written',
            path: `workflows/${compiled.wfName}`,
            content: JSON.stringify(compiled.config),
          })
        }

        // Emit routes so the page(s) appear in the builder navigation sidebar
        if (collectedRoutes.length > 0) {
          send({
            type: 'routes_written',
            path: 'routes',
            content: JSON.stringify({ routes: collectedRoutes }),
          })
        }

        // Send all current sources so client can persist them to project DB
        send({ type: 'dsl_sources', sources: Object.fromEntries(vfs) })

        send({ type: 'done' })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        send({ type: 'error', error: errorMsg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
