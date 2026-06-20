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
import { query } from '@anthropic-ai/claude-agent-sdk';
import { compileAllSources } from '@/lib/dsl/compiler/compile-file';
import { DSL_SYSTEM_PROMPT } from '@/lib/dsl/system-prompt';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

// Point at the native ARM64 binary so it runs without Rosetta SIGILL
const ARM64_BINARY = path.join(
  process.cwd(),
  'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
);
const claudeExe = fs.existsSync(ARM64_BINARY) ? ARM64_BINARY : undefined;

/** Read all user-written .ts/.tsx files from the working directory. */
function readDslFiles(dir: string): Record<string, string> {
  const sources: Record<string, string> = {};
  if (!fs.existsSync(dir)) return sources;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      entry.name !== 'builder.ts'
    ) {
      sources[entry.name] = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
    }
  }
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

  // ── Working directory ────────────────────────────────────────────────────────
  const safeId = (projectId ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cwd = path.join('/tmp', `dsl-agent-${safeId}`);
  fs.mkdirSync(cwd, { recursive: true });

  // ── Seed builder.ts ──────────────────────────────────────────────────────────
  const builderSrc = path.join(process.cwd(), 'lib', 'dsl', 'builder', 'index.ts');
  if (fs.existsSync(builderSrc)) {
    fs.copyFileSync(builderSrc, path.join(cwd, 'builder.ts'));
  }

  // ── Restore existing DSL sources ─────────────────────────────────────────────
  if (projectId) {
    try {
      const metaRes = await fetch(
        `${BACKEND_URL}/v1/projects/${projectId}/config/meta`,
        { headers: authHeaders },
      );
      if (metaRes.ok) {
        const meta = await metaRes.json() as Record<string, unknown>;
        const sources = meta?.dslSources as Record<string, string> | undefined;
        if (sources) {
          for (const [fp, content] of Object.entries(sources)) {
            // Security: strip any directory components — files live flat in cwd
            const name = path.basename(fp);
            fs.writeFileSync(path.join(cwd, name), content, 'utf-8');
          }
        }
      }
    } catch { /* non-critical */ }
  }

  // ── SSE stream ───────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();

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
            // Restrict to file operations only
            tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
            // Auto-approve all of them — no interactive prompts
            allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
            permissionMode: 'acceptEdits',
            // Use ARM64 binary explicitly (avoids SIGILL on x64 Rosetta Node.js)
            ...(claudeExe ? { pathToClaudeCodeExecutable: claudeExe } : {}),
            // Inherit PATH/HOME/ANTHROPIC_API_KEY from server process
            env: { ...process.env },
          },
        })) {
          // Transform SDK messages into browser-friendly SSE events
          if (msg.type === 'assistant') {
            // Extract text and tool_use content blocks
            const betaMsg = (msg as { type: 'assistant'; message: { content: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }> } }).message;
            for (const block of betaMsg.content ?? []) {
              if (block.type === 'text' && block.text) {
                send({ type: 'assistant_text', text: block.text });
              } else if (block.type === 'tool_use') {
                send({ type: 'tool_call', name: block.name, input: block.input ?? {}, id: block.id });
              }
            }
          } else if (msg.type === 'result') {
            const result = msg as { type: 'result'; usage: { input_tokens: number; output_tokens: number }; total_cost_usd?: number };
            send({
              type: 'result',
              usage: { input_tokens: result.usage?.input_tokens ?? 0, output_tokens: result.usage?.output_tokens ?? 0 },
              total_cost_usd: result.total_cost_usd,
            });
          }
          // All other SDK message types (system, status, etc.) are silently dropped
          // — the browser hook only needs assistant text, tool calls, and result
        }
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      }

      // ── Compile after agent finishes ─────────────────────────────────────────
      try {
        const sources = readDslFiles(cwd);
        if (Object.keys(sources).length > 0) {
          const events = compileAllSources(sources, projectId ?? 'dsl');
          // Both events (for canvas) and sources (for UI store)
          send({ type: 'compiled', events, sources });

          // Persist sources to project DB (fire-and-forget)
          if (projectId) {
            fetch(`${BACKEND_URL}/v1/projects/${projectId}/config/meta`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify({ dslSources: sources }),
            }).catch(() => {});
          }
        }
      } catch (err) {
        send({ type: 'compile_error', error: err instanceof Error ? err.message : String(err) });
      }

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
