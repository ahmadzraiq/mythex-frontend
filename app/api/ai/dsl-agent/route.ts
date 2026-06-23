/**
 * POST /api/ai/dsl-agent
 *
 * Server-side DSL agent powered by @anthropic-ai/claude-agent-sdk.
 *
 * Flow:
 *  1. Set up /tmp/dsl-agent-{projectId}/ as the agent's working directory.
 *  2. Seed builder.ts (read-only DSL API reference) from disk.
 *  3. Restore existing DSL source files from the project DB.
 *  4. Run query() — the SDK handles the full agentic loop, tool calls, and
 *     file edits using its native Read / Write / Edit / Glob / Grep tools.
 *  5. Stream every SDK message back to the browser as SSE.
 *  6. After the agent finishes, compile all DSL files inline and send a
 *     `compiled` event with both events and sources.
 *  7. Persist the final sources back to the project DB.
 *
 * ARM64 note: Node.js on this machine is x64 (Rosetta), so we explicitly
 * point the SDK at the darwin-arm64 binary via pathToClaudeCodeExecutable.
 */

import { NextRequest } from 'next/server';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { compileAllSources } from '@/lib/dsl/compiler/compile-file';
import { decompileAllFromConfig } from '@/lib/dsl/decompiler/index';
import { DSL_SYSTEM_PROMPT } from '@/lib/dsl/system-prompt';
import { searchImages, searchPexelsVideos, searchIconify } from '@/lib/ai/media-search';
import { combineAllDiagnostics, formatDiagnostics } from '@/lib/dsl/diagnostics';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

// ── Per-project session resumption ───────────────────────────────────────────
// Maps projectId → last session_id so the agent resumes with full context
// (builder.ts already read, project files already known) instead of starting
// cold every request.  Lives in module scope so it survives across requests
// on the same Node.js process; resets on server restart (graceful degradation).
const sessionStore = new Map<string, string>();

// Point at the native ARM64 binary so it runs without Rosetta SIGILL
const ARM64_BINARY = path.join(
  process.cwd(),
  'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
);
const claudeExe = fs.existsSync(ARM64_BINARY) ? ARM64_BINARY : undefined;

// ── In-process MCP server — combined media search ────────────────────────────
// Exposes a single search_media tool so the agent fetches all needed icons,
// images, and videos in one call instead of multiple separate calls.
function buildMcpServer(_cwd: string) {
  return createSdkMcpServer({
    name: 'media',
    version: '1.0.0',
    tools: [
      tool(
        'search_media',
        'Search for icons, images, and/or videos in one batched call. Pass only the arrays you need. All queries run in parallel.',
        {
          icons:  z.array(z.string()).optional().describe('Icon search queries — one entry per icon needed (e.g. ["calendar", "chevron-left"])'),
          images: z.array(z.string()).optional().describe('Image search queries (e.g. ["sunset beach", "office desk"])'),
          videos: z.array(z.string()).optional().describe('Video search queries (e.g. ["ocean waves"])'),
          prefix: z.string().optional().describe('Icon set prefix: lucide (default) · mdi · tabler · heroicons · ph · ri · solar · mingcute · bi · carbon'),
          count:  z.number().optional().describe('Results per query (1–10, default 5)'),
        },
        async ({ icons, images, videos, prefix, count }) => {
          const n = Math.min(count ?? 5, 10);
          const [iconResults, imageResults, videoResults] = await Promise.all([
            icons  ? Promise.all(icons.map(q  => searchIconify(q, prefix, n)))       : Promise.resolve(undefined),
            images ? Promise.all(images.map(q => searchImages(q, n)))                : Promise.resolve(undefined),
            videos ? Promise.all(videos.map(q => searchPexelsVideos(q, n)))          : Promise.resolve(undefined),
          ]);
          const out: Record<string, unknown> = {};
          if (iconResults)  out.icons  = Object.fromEntries((icons!).map((q, i)  => [q, iconResults[i]]));
          if (imageResults) out.images = Object.fromEntries((images!).map((q, i) => [q, imageResults[i]]));
          if (videoResults) out.videos = Object.fromEntries((videos!).map((q, i) => [q, videoResults[i]]));
          return { content: [{ type: 'text' as const, text: JSON.stringify(out) }] };
        },
      ),
    ],
  })
}

/** Read all user-written DSL source files from the working directory, recursively.
 *  Accepts .ts, .tsx, .js, and .jsx — the in-memory compiler handles all four. */
function readDslFiles(dir: string): Record<string, string> {
  const sources: Record<string, string> = {};
  const DSL_EXTS = ['.ts', '.tsx', '.js', '.jsx'];
  function walk(current: string, rel: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relPath);
      } else if (
        entry.isFile() &&
        DSL_EXTS.some(ext => entry.name.endsWith(ext)) &&
        entry.name !== 'builder.ts'
      ) {
        sources[relPath] = fs.readFileSync(path.join(current, entry.name), 'utf-8');
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir, '');
  return sources;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: { prompt?: string; projectId?: string; workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { prompt, projectId, workspaceId } = body;
  if (!prompt?.trim()) {
    return new Response(JSON.stringify({ error: 'prompt is required' }), { status: 400 });
  }

  // Auth headers for backend calls
  const authHeaders: Record<string, string> = {};
  const cookie = req.headers.get('cookie');
  const auth   = req.headers.get('authorization');
  if (cookie) authHeaders['cookie'] = cookie;
  if (auth)   authHeaders['authorization'] = auth;

  // ── Session resumption ───────────────────────────────────────────────────────
  const resumeId = projectId ? sessionStore.get(projectId) : undefined;

  // ── Working directory ────────────────────────────────────────────────────────
  const safeId = (projectId ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cwd = path.join('/tmp', `dsl-agent-${safeId}`);
  fs.mkdirSync(cwd, { recursive: true });

  // ── Seed builder.ts ──────────────────────────────────────────────────────────
  const builderSrc = path.join(process.cwd(), 'lib', 'dsl', 'builder', 'index.ts');
  if (fs.existsSync(builderSrc)) {
    fs.copyFileSync(builderSrc, path.join(cwd, 'builder.ts'));
  }

  // ── Restore existing DSL sources via decompiler ──────────────────────────────
  // The compiled JSON config on disk IS the source of truth.
  // Decompile it back to .jsx/.js files and write them to /tmp.
  try {
    const reconstructed = decompileAllFromConfig(path.join(process.cwd(), 'config'));
    for (const [filename, content] of Object.entries(reconstructed)) {
      const filePath = path.join(cwd, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  } catch { /* non-critical — agent can still create files from scratch */ }

  // ── SSE stream ───────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const mcpServer = buildMcpServer(cwd);

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (data: unknown) =>
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      // ── Run the agent ──────────────────────────────────────────────────────
      try {
        for await (const msg of query({
          prompt: prompt!,
          options: {
            cwd,
            systemPrompt: DSL_SYSTEM_PROMPT,
            tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
            // Auto-approve all file tools and the entire media MCP server
            allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'mcp__media__*'],
            mcpServers: { media: mcpServer },
            permissionMode: 'acceptEdits',
            // Resume previous session so the agent already knows builder.ts + project files
            ...(resumeId ? { resume: resumeId } : {}),
            // Reduce per-turn thinking overhead for UI generation tasks
            effort: 'low',
            // Stream partial tokens in real-time (text_delta events)
            includePartialMessages: true,
            // Use ARM64 binary explicitly (avoids SIGILL on x64 Rosetta Node.js)
            ...(claudeExe ? { pathToClaudeCodeExecutable: claudeExe } : {}),
            // 1-hour prompt cache TTL so system prompt stays cached between requests
            env: { ...process.env, ENABLE_PROMPT_CACHING_1H: '1' },
          },
        })) {
          // Transform SDK messages into browser-friendly SSE events
          if (msg.type === 'stream_event') {
            // Partial token streaming — forward text deltas as they arrive
            const evt = (msg as { type: 'stream_event'; event: { type: string; delta?: { type: string; text?: string } } }).event;
            if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
              send({ type: 'text_delta', text: evt.delta.text });
            }
          } else if (msg.type === 'assistant') {
            // Text was already streamed as text_delta — only extract tool calls here
            const betaMsg = (msg as { type: 'assistant'; message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }> } }).message;
            for (const block of betaMsg.content ?? []) {
              if (block.type === 'tool_use') {
                // Include startTime so the client can compute per-tool duration
                send({ type: 'tool_call', name: block.name, input: block.input ?? {}, id: block.id, startTime: Date.now() });
              }
            }
          } else if (msg.type === 'user') {
            // Tool results come back as 'user' messages — forward completion timestamps
            const userMsg = (msg as { type: 'user'; message: { content: Array<{ type: string; tool_use_id?: string }> } }).message;
            for (const block of userMsg?.content ?? []) {
              if (block.type === 'tool_result') {
                send({ type: 'tool_result', id: block.tool_use_id, endTime: Date.now() });
              }
            }
          } else if (msg.type === 'result') {
            const result = msg as { type: 'result'; usage: { input_tokens: number; output_tokens: number }; total_cost_usd?: number; session_id?: string };
            // Persist session ID so the next request for this project resumes with full context
            if (result.session_id && projectId) {
              sessionStore.set(projectId, result.session_id);
            }
            send({
              type: 'result',
              usage: { input_tokens: result.usage?.input_tokens ?? 0, output_tokens: result.usage?.output_tokens ?? 0 },
              total_cost_usd: result.total_cost_usd,
              session_id: result.session_id,
            });
          }
          // All other SDK message types (system, status, etc.) are silently dropped
          // — the browser hook only needs text deltas, tool calls, tool results, and final result
        }
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      }

      // ── Diagnostics gate — block compiled until clean ─────────────────────
      try {
        const sources = readDslFiles(cwd);
        const builderPath = path.join(cwd, 'builder.ts');
        const builderSrc = fs.existsSync(builderPath) ? fs.readFileSync(builderPath, 'utf-8') : '';
        const diags = combineAllDiagnostics(sources, builderSrc);
        if (diags.length > 0) {
          send({ type: 'diagnostics', diagnostics: diags, formatted: formatDiagnostics(diags) });
        }
      } catch { /* non-critical — compile will still run */ }

      // ── Compile after agent finishes ─────────────────────────────────────────
      try {
        const sources = readDslFiles(cwd);
        if (Object.keys(sources).length > 0) {
          const events = compileAllSources(sources, projectId ?? 'dsl');
          // Both events (for canvas) and sources (for UI store)
          send({ type: 'compiled', events, sources });
        }
      } catch (err) {
        send({ type: 'compile_error', error: err instanceof Error ? err.message : String(err) });
      }

      // ── Clean up /tmp working directory ──────────────────────────────────────
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch { /* non-critical */ }

      ctrl.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
