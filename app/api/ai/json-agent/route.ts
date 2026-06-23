/**
 * POST /api/ai/json-agent
 *
 * SDK agent that reads/writes JSON entity files directly — no JSX, no compiler.
 *
 * Flow:
 *  1. Create /tmp/json-agent-{projectId}/ as the agent's working directory.
 *  2. Seed the cwd with CLAUDE.md (schema reference) and the project's current
 *     VFS entity files sent by the client (vfsFiles payload).
 *  3. Run query() — the agent edits entity files with native Read/Write/Edit tools.
 *  4. PostToolUse hook: validate each written file; on pass, stream a
 *     { type: 'file', path, content } SSE event so the client's applyVirtualFile
 *     updates the canvas in real-time.
 *  5. After the agent finishes, persist the final entity file map to the
 *     project DB and close the stream.
 *
 * ARM64 note: Node.js on this machine is x64 (Rosetta), so we explicitly
 * point the SDK at the darwin-arm64 binary via pathToClaudeCodeExecutable.
 */

import { NextRequest } from 'next/server';
import {
  query,
  createSdkMcpServer,
  tool,
  type HookCallback,
  type PostToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { JSON_AGENT_SYSTEM_PROMPT } from '@/lib/ai/agents/json-agent/system-prompt';
import { validateEntityFile, toVfsPath } from '@/lib/ai/agents/json-agent/validator';
import { resolveNodeTree } from '@/lib/ai/agents/shared/resolve-style';
import { searchImages, searchPexelsVideos, searchIconify } from '@/lib/ai/media-search';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';

// ── Per-project session resumption ───────────────────────────────────────────
const sessionStore = new Map<string, string>();

// Point at the native ARM64 binary so it runs without Rosetta SIGILL
const ARM64_BINARY = path.join(
  process.cwd(),
  'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
);
const claudeExe = fs.existsSync(ARM64_BINARY) ? ARM64_BINARY : undefined;

// ── CLAUDE.md path (seeded from project root) ─────────────────────────────────
const CLAUDE_MD_SRC = path.join(process.cwd(), 'CLAUDE.md');

// ── In-process MCP server — combined media search ────────────────────────────
function buildMcpServer() {
  return createSdkMcpServer({
    name: 'media',
    version: '1.0.0',
    tools: [
      tool(
        'search_media',
        'Search for icons, images, and/or videos in one batched call. Pass only the arrays you need.',
        {
          icons:  z.array(z.string()).optional().describe('Icon search queries (e.g. ["calendar", "chevron-left"])'),
          images: z.array(z.string()).optional().describe('Image search queries (e.g. ["sunset beach"])'),
          videos: z.array(z.string()).optional().describe('Video search queries (e.g. ["ocean waves"])'),
          prefix: z.string().optional().describe('Icon set prefix: lucide (default) · mdi · tabler · heroicons · ph · ri'),
          count:  z.number().optional().describe('Results per query (1–10, default 5)'),
        },
        async ({ icons, images, videos, prefix, count }) => {
          const n = Math.min(count ?? 5, 10);
          const [iconResults, imageResults, videoResults] = await Promise.all([
            icons  ? Promise.all(icons.map(q  => searchIconify(q, prefix, n))) : Promise.resolve(undefined),
            images ? Promise.all(images.map(q => searchImages(q, n)))          : Promise.resolve(undefined),
            videos ? Promise.all(videos.map(q => searchPexelsVideos(q, n)))    : Promise.resolve(undefined),
          ]);
          const out: Record<string, unknown> = {};
          if (iconResults)  out.icons  = Object.fromEntries((icons!).map((q, i)  => [q, iconResults[i]]));
          if (imageResults) out.images = Object.fromEntries((images!).map((q, i) => [q, imageResults[i]]));
          if (videoResults) out.videos = Object.fromEntries((videos!).map((q, i) => [q, videoResults[i]]));
          return { content: [{ type: 'text' as const, text: JSON.stringify(out) }] };
        },
      ),
    ],
  });
}

/** Read all .json entity files from the agent's cwd recursively. */
function readEntityFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(current: string, rel: string) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          files[relPath] = fs.readFileSync(path.join(current, entry.name), 'utf-8');
        } catch { /* skip */ }
      }
    }
  }
  walk(dir, '');
  return files;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: {
    prompt?: string;
    projectId?: string;
    workspaceId?: string;
    /** Current VFS entity files from the client, keyed by VFS path (no extension) */
    vfsFiles?: Record<string, string>;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { prompt, projectId, workspaceId, vfsFiles } = body;
  if (!prompt?.trim()) {
    return new Response(JSON.stringify({ error: 'prompt is required' }), { status: 400 });
  }

  const authHeaders: Record<string, string> = {};
  const cookie = req.headers.get('cookie');
  const auth   = req.headers.get('authorization');
  if (cookie) authHeaders['cookie'] = cookie;
  if (auth)   authHeaders['authorization'] = auth;

  const resumeId = projectId ? sessionStore.get(projectId) : undefined;

  // ── Working directory ────────────────────────────────────────────────────────
  const safeId = (projectId ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cwdRaw = path.join('/tmp', `json-agent-${safeId}`);
  fs.mkdirSync(cwdRaw, { recursive: true });
  // Resolve symlinks (macOS: /tmp → /private/tmp) so filePath comparisons work
  const cwd = fs.realpathSync(cwdRaw);

  // ── Seed CLAUDE.md ───────────────────────────────────────────────────────────
  if (fs.existsSync(CLAUDE_MD_SRC)) {
    fs.copyFileSync(CLAUDE_MD_SRC, path.join(cwd, 'CLAUDE.md'));
  }

  // ── Seed VFS entity files from client payload ────────────────────────────────
  // Each key is a VFS path (no extension), value is JSON string content.
  // We write them as <path>.json on disk so the agent can read/edit them.
  if (vfsFiles && typeof vfsFiles === 'object') {
    for (const [vfsPath, content] of Object.entries(vfsFiles)) {
      const diskPath = path.join(cwd, `${vfsPath}.json`);
      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      try {
        fs.writeFileSync(diskPath, content, 'utf-8');
      } catch { /* skip unwritable paths */ }
    }
  }

  // ── SSE stream ───────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const mcpServer = buildMcpServer();

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (data: unknown) =>
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      // Track files written during this run (VFS path → content)
      const writtenFiles = new Map<string, string>();

      // ── PostToolUse hook: validate + stream file events ──────────────────────
      const postToolUseHook: HookCallback = async (input) => {
        const hookInput = input as PostToolUseHookInput;
        const toolInput = hookInput.tool_input as Record<string, unknown> | undefined;

        // Only process Write and Edit tool calls on .json files
        const toolName = hookInput.tool_name;
        if (toolName !== 'Write' && toolName !== 'Edit') {
          return {};
        }

        const filePath = (toolInput?.file_path ?? toolInput?.path) as string | undefined;
        if (!filePath || !filePath.endsWith('.json')) return {};

        // Get the content — for Write it's in tool_input, for Edit read from disk
        let content: string;
        if (toolName === 'Write') {
          content = (toolInput?.content as string | undefined) ?? '';
        } else {
          // Edit: read the updated file from disk (filePath may be absolute or relative)
          const diskPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
          try {
            content = fs.readFileSync(diskPath, 'utf-8');
          } catch {
            return {};
          }
        }

        // filePath may be an absolute disk path; normalise to a relative VFS path.
        const relFilePath = filePath.startsWith(cwd + '/')
          ? filePath.slice(cwd.length + 1)
          : filePath;
        const vfsPath = toVfsPath(relFilePath);

        // Validate the entity file
        const validation = validateEntityFile(vfsPath, content);
        if (!validation.ok) {
          return {
            hookSpecificOutput: {
              hookEventName: 'PostToolUse' as const,
              additionalContext: `⚠ VALIDATION ERROR in ${vfsPath}: ${validation.error}. Please fix the file to match the CLAUDE.md schema and retry.`,
            },
          };
        }

        // Resolve flat SxProps → className on page/component UI trees before
        // sending to the client. The agent writes shorthand keys; the resolver
        // converts them so the rendering engine sees the expected className shape.
        let resolvedContent = content;
        if (
          /^pages\/[^/]+\/page$/.test(vfsPath) ||
          /^components\/[^/]+\/component$/.test(vfsPath)
        ) {
          try {
            const data = JSON.parse(content) as Record<string, unknown>;
            if (Array.isArray(data.ui)) {
              // Page format: { ui: [...nodes] }
              data.ui = resolveNodeTree(data.ui);
              resolvedContent = JSON.stringify(data);
            } else if (data.content && typeof data.content === 'object' && !Array.isArray(data.content)) {
              // Component format: { content: { type, props, children } }
              const resolved = resolveNodeTree([data.content]);
              data.content = resolved[0];
              resolvedContent = JSON.stringify(data);
            } else if (Array.isArray(data.content)) {
              // Component format: { content: [...nodes] }
              data.content = resolveNodeTree(data.content as unknown[]);
              resolvedContent = JSON.stringify(data);
            }
          } catch { /* leave content unchanged on parse error */ }
        }

        send({ type: 'file', path: vfsPath, content: resolvedContent });
        writtenFiles.set(vfsPath, resolvedContent);

        return {};
      };

      // ── Run the agent ──────────────────────────────────────────────────────
      try {
        for await (const msg of query({
          prompt: prompt!,
          options: {
            cwd,
            systemPrompt: JSON_AGENT_SYSTEM_PROMPT,
            tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
            allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'mcp__media__*'],
            mcpServers: { media: mcpServer },
            permissionMode: 'acceptEdits',
            settingSources: ['project'],
            ...(resumeId ? { resume: resumeId } : {}),
            effort: 'low',
            includePartialMessages: true,
            ...(claudeExe ? { pathToClaudeCodeExecutable: claudeExe } : {}),
            env: { ...process.env, ENABLE_PROMPT_CACHING_1H: '1' },
            hooks: {
              PostToolUse: [{ matcher: 'Write|Edit', hooks: [postToolUseHook] }],
            },
          },
        })) {
          if (msg.type === 'stream_event') {
            const evt = (msg as {
              type: 'stream_event';
              event: { type: string; delta?: { type: string; text?: string } };
            }).event;
            if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
              send({ type: 'text_delta', text: evt.delta.text });
            }
          } else if (msg.type === 'assistant') {
            const betaMsg = (msg as {
              type: 'assistant';
              message: { content: Array<{ type: string; name?: string; input?: unknown; id?: string }> };
            }).message;
            for (const block of betaMsg.content ?? []) {
              if (block.type === 'tool_use') {
                send({ type: 'tool_call', name: block.name, input: block.input ?? {}, id: block.id, startTime: Date.now() });
              }
            }
          } else if (msg.type === 'user') {
            const userMsg = (msg as {
              type: 'user';
              message: { content: Array<{ type: string; tool_use_id?: string }> };
            }).message;
            for (const block of userMsg?.content ?? []) {
              if (block.type === 'tool_result') {
                send({ type: 'tool_result', id: block.tool_use_id, endTime: Date.now() });
              }
            }
          } else if (msg.type === 'result') {
            const result = msg as {
              type: 'result';
              usage: { input_tokens: number; output_tokens: number };
              total_cost_usd?: number;
              session_id?: string;
            };
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
        }
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      }

      // ── Persist written entity files to project DB ────────────────────────────
      // PATCH the project meta with the latest entity file snapshot so the
      // client can restore it on reload.
      if (projectId && writtenFiles.size > 0) {
        try {
          const entitySnapshot: Record<string, string> = {};
          for (const [vfsPath, content] of writtenFiles) {
            entitySnapshot[vfsPath] = content;
          }
          await fetch(`${BACKEND_URL}/v1/projects/${projectId}/config/meta`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ jsonAgentFiles: entitySnapshot }),
          }).catch(() => {});
          send({ type: 'persisted', count: writtenFiles.size });
        } catch { /* non-critical */ }
      }

      // ── Clean up working directory ────────────────────────────────────────────
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
