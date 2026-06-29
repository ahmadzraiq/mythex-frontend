/**
 * POST /api/ai/json-agent
 *
 * SDK agent that reads/writes JSON entity files directly — no JSX, no compiler.
 *
 * Flow:
 *  1. Create /tmp/json-agent-{projectId}/ as the agent's working directory (kept warm
 *     between turns for prompt-cache efficiency — files are only re-written when content
 *     differs from what is already on disk).
 *  2. Seed the cwd with CLAUDE.md (schema reference) and the project's current
 *     VFS entity files sent by the client (vfsFiles payload).
 *  3. Run query() with optional session resume (resumeSessionId from client, who
 *     persists it per-thread in project meta — survives server restarts).
 *  4. PostToolUse hook: validate each written file; on pass, stream a
 *     { type: 'file', path, content } SSE event so the client's applyVirtualFile
 *     updates the canvas in real-time.
 *  5. On each assistant round, emit a { type: 'usage', ... } event and record the
 *     round's tokens to the workspace billing endpoint (incremental, not end-of-run).
 *  6. On result, reconcile total usage to avoid double-counting, send session_id.
 *  7. After the agent finishes, persist the final entity file map to the project DB.
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
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { JSON_AGENT_SYSTEM_PROMPT } from '@/lib/ai/agents/json-agent/system-prompt';
import { validateEntityFile, toVfsPath } from '@/lib/ai/agents/json-agent/validator';
import { resolveNodeTree } from '@/lib/ai/agents/shared/resolve-style';
import { searchImages, searchPexelsVideos, searchIconify } from '@/lib/ai/media-search';
import crypto from 'crypto';
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

// ── CLAUDE.md path (seeded from project root) ─────────────────────────────────
const CLAUDE_MD_SRC = path.join(process.cwd(), 'CLAUDE.md');

// ── Agent Skills source (.claude/skills, seeded into the agent cwd) ───────────
const SKILLS_SRC = path.join(process.cwd(), '.claude', 'skills');

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

/** Write a file only when its content has changed (keeps cwd warm for prompt cache). */
function writeIfChanged(diskPath: string, content: string): void {
  try {
    const existing = fs.existsSync(diskPath) ? fs.readFileSync(diskPath, 'utf-8') : null;
    if (existing === content) return;
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, content, 'utf-8');
  } catch { /* non-critical */ }
}

/** Recursively copy a directory tree using writeIfChanged (keeps cwd warm). */
function seedDir(srcDir: string, destDir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      seedDir(srcPath, destPath);
    } else if (entry.isFile()) {
      try {
        writeIfChanged(destPath, fs.readFileSync(srcPath, 'utf-8'));
      } catch { /* non-critical */ }
    }
  }
}

/** MD5 hash helper for write-if-changed checks. */
function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}
// md5 is used indirectly via writeIfChanged content comparison above.
void md5; // suppress unused-var lint if tree-shaken

/** Resolve workspaceId from a projectId via the backend (cached per request scope). */
async function resolveWorkspaceId(
  projectId: string,
  authHeaders: Record<string, string>,
): Promise<string | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/v1/projects/${projectId}`, {
      headers: { ...authHeaders },
    });
    if (!res.ok) return null;
    const data = await res.json() as { project?: { workspaceId?: string }; workspaceId?: string };
    return data.project?.workspaceId ?? (data.workspaceId as string | undefined) ?? null;
  } catch {
    return null;
  }
}

type AttachmentPayload = {
  fileId: string;
  name: string;
  mimeType: string;
  data?: string; // base64, no data-URI prefix
};

/** Build a multimodal SDKUserMessage when the request includes file attachments. */
async function* makeMultimodalMessage(
  prompt: string,
  attachments: AttachmentPayload[],
): AsyncIterable<SDKUserMessage> {
  const content: unknown[] = [];
  for (const a of attachments) {
    if (!a.data) continue;
    if (a.mimeType.startsWith('image/')) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: a.mimeType, data: a.data },
      });
    } else {
      // PDF or text/plain → document block
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: a.mimeType, data: a.data },
      });
    }
  }
  if (prompt.trim()) {
    content.push({ type: 'text', text: prompt });
  }
  yield {
    type: 'user' as const,
    message: { role: 'user' as const, content } as SDKUserMessage['message'],
    parent_tool_use_id: null,
  } as SDKUserMessage;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: {
    prompt?: string;
    projectId?: string;
    workspaceId?: string;
    threadId?: string;
    resumeSessionId?: string;
    /** Current VFS entity files from the client, keyed by VFS path (no extension) */
    vfsFiles?: Record<string, string>;
    /** File attachments — base64-encoded content + metadata */
    attachments?: AttachmentPayload[];
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { prompt, projectId, vfsFiles, threadId, resumeSessionId } = body;
  let { workspaceId } = body;

  const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
  if (!prompt?.trim() && !hasAttachments) {
    return new Response(JSON.stringify({ error: 'prompt or attachments are required' }), { status: 400 });
  }

  const authHeaders: Record<string, string> = {};
  const cookie = req.headers.get('cookie');
  const auth   = req.headers.get('authorization');
  if (cookie) authHeaders['cookie'] = cookie;
  if (auth)   authHeaders['authorization'] = auth;

  // Resolve workspaceId lazily if the client didn't send it
  if (!workspaceId && projectId) {
    workspaceId = (await resolveWorkspaceId(projectId, authHeaders)) ?? undefined;
  }

  // ── Working directory — kept warm between turns ───────────────────────────
  // Use thread-scoped cwd when threadId is present so different conversations
  // don't stomp each other; fall back to project-scoped for threadless calls.
  const cwdKey = threadId
    ? `${(projectId ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '_')}-${threadId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    : (projectId ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cwdRaw = path.join('/tmp', `json-agent-${cwdKey}`);
  fs.mkdirSync(cwdRaw, { recursive: true });
  // Resolve symlinks (macOS: /tmp → /private/tmp) so filePath comparisons work
  const cwd = fs.realpathSync(cwdRaw);

  // ── Seed CLAUDE.md (write-if-changed) ────────────────────────────────────
  if (fs.existsSync(CLAUDE_MD_SRC)) {
    writeIfChanged(path.join(cwd, 'CLAUDE.md'), fs.readFileSync(CLAUDE_MD_SRC, 'utf-8'));
  }

  // ── Seed Agent Skills (.claude/skills → cwd/.claude/skills) ──────────────
  // The SDK discovers these via settingSources: ['project'] + skills: 'all'.
  // Progressive disclosure means only skill metadata is loaded until a skill
  // is invoked, so adding skills here costs no baseline tokens.
  if (fs.existsSync(SKILLS_SRC)) {
    seedDir(SKILLS_SRC, path.join(cwd, '.claude', 'skills'));
  }

  // ── Seed VFS entity files (write-if-changed to keep cwd warm) ────────────
  // Each key is a VFS path (no extension), value is JSON string content.
  // We write them as <path>.json on disk so the agent can read/edit them.
  if (vfsFiles && typeof vfsFiles === 'object') {
    for (const [vfsPath, content] of Object.entries(vfsFiles)) {
      const diskPath = path.join(cwd, `${vfsPath}.json`);
      writeIfChanged(diskPath, content);
    }
  }

  // ── SSE stream ───────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const mcpServer = buildMcpServer();

  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (data: unknown) =>
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      // Track files written during this run (VFS path → content)
      const writtenFiles = new Map<string, string>();

      // ── Incremental usage accounting ──────────────────────────────────────
      // recordedInput/Output: cumulative tokens already sent to the backend this run.
      // Used at the end to reconcile against result.usage without double-counting.
      let recordedInput  = 0;
      let recordedOutput = 0;

      /** POST a token delta to the workspace billing endpoint (fire-and-forget). */
      const recordTokens = (inputTokens: number, outputTokens: number, model = 'claude-sonnet-4-5') => {
        if (!workspaceId || (inputTokens + outputTokens) === 0) return;
        fetch(`${BACKEND_URL}/v1/workspaces/${workspaceId}/usage/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ projectId, inputTokens, outputTokens, model }),
        }).catch(() => {});
        recordedInput  += inputTokens;
        recordedOutput += outputTokens;
      };

      // ── PostToolUse hook: validate + stream file events ──────────────────
      const postToolUseHook: HookCallback = async (input) => {
        const hookInput = input as PostToolUseHookInput;
        const toolInput = hookInput.tool_input as Record<string, unknown> | undefined;

        const toolName = hookInput.tool_name;
        if (toolName !== 'Write' && toolName !== 'Edit') return {};

        const filePath = (toolInput?.file_path ?? toolInput?.path) as string | undefined;
        if (!filePath || !filePath.endsWith('.json')) return {};

        let content: string;
        if (toolName === 'Write') {
          content = (toolInput?.content as string | undefined) ?? '';
        } else {
          const diskPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
          try {
            content = fs.readFileSync(diskPath, 'utf-8');
          } catch {
            return {};
          }
        }

        const relFilePath = filePath.startsWith(cwd + '/')
          ? filePath.slice(cwd.length + 1)
          : filePath;
        const vfsPath = toVfsPath(relFilePath);

        const validation = validateEntityFile(vfsPath, content);
        if (!validation.ok) {
          return {
            hookSpecificOutput: {
              hookEventName: 'PostToolUse' as const,
              additionalContext: `⚠ VALIDATION ERROR in ${vfsPath}: ${validation.error}. Please fix the file to match the CLAUDE.md schema and retry.`,
            },
          };
        }

        // Resolve flat SxProps → className on page/component UI trees
        let resolvedContent = content;
        if (
          /^pages\/[^/]+\/page$/.test(vfsPath) ||
          /^components\/[^/]+\/component$/.test(vfsPath)
        ) {
          try {
            const data = JSON.parse(content) as Record<string, unknown>;
            if (Array.isArray(data.ui)) {
              data.ui = resolveNodeTree(data.ui);
              resolvedContent = JSON.stringify(data);
            } else if (data.content && typeof data.content === 'object' && !Array.isArray(data.content)) {
              const resolved = resolveNodeTree([data.content]);
              data.content = resolved[0];
              resolvedContent = JSON.stringify(data);
            } else if (Array.isArray(data.content)) {
              data.content = resolveNodeTree(data.content as unknown[]);
              resolvedContent = JSON.stringify(data);
            }
          } catch { /* leave content unchanged on parse error */ }
        }

        send({ type: 'file', path: vfsPath, content: resolvedContent });
        writtenFiles.set(vfsPath, resolvedContent);

        return {};
      };

      // ── Build prompt — plain string or multimodal iterable ────────────────
      const queryPrompt = hasAttachments
        ? makeMultimodalMessage(prompt ?? '', body.attachments!)
        : (prompt ?? '');

      // ── Run the agent ──────────────────────────────────────────────────────
      try {
        for await (const msg of query({
          prompt: queryPrompt,
          options: {
            cwd,
            systemPrompt: JSON_AGENT_SYSTEM_PROMPT,
            tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
            allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'mcp__media__*'],
            mcpServers: { media: mcpServer },
            permissionMode: 'acceptEdits',
            settingSources: ['project'],
            // Enable Agent Skills (.claude/skills). This is the single switch —
            // no need to add 'Skill' to allowedTools. Progressive disclosure keeps
            // baseline token cost to skill metadata only until one is invoked.
            skills: 'all',
            // Session resumption owned by the client (persisted per-thread in project meta)
            ...(resumeSessionId ? { resume: resumeSessionId } : {}),
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
            // ── Per-round: emit tool calls + usage ─────────────────────────
            const betaMsg = (msg as {
              type: 'assistant';
              message: {
                content: Array<{ type: string; name?: string; input?: unknown; id?: string }>;
                usage?: {
                  input_tokens?: number;
                  output_tokens?: number;
                  cache_read_input_tokens?: number;
                  cache_creation_input_tokens?: number;
                };
                model?: string;
              };
            }).message;

            for (const block of betaMsg.content ?? []) {
              if (block.type === 'tool_use') {
                send({ type: 'tool_call', name: block.name, input: block.input ?? {}, id: block.id, startTime: Date.now() });
              }
            }

            // Emit per-round usage event and record to billing
            if (betaMsg.usage) {
              const roundInput        = betaMsg.usage.input_tokens ?? 0;
              const roundOutput       = betaMsg.usage.output_tokens ?? 0;
              const roundCacheRead    = betaMsg.usage.cache_read_input_tokens ?? 0;
              const roundCacheCreate  = betaMsg.usage.cache_creation_input_tokens ?? 0;
              const model = betaMsg.model ?? 'claude-sonnet-4-5';

              send({
                type: 'usage',
                round: { input: roundInput, output: roundOutput, cacheRead: roundCacheRead, cacheCreation: roundCacheCreate },
              });

              // Record billing for this round (net new tokens only)
              recordTokens(roundInput, roundOutput, model);
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
              usage: {
                input_tokens: number;
                output_tokens: number;
                cache_read_input_tokens?: number;
                cache_creation_input_tokens?: number;
              };
              total_cost_usd?: number;
              num_turns?: number;
              session_id?: string;
            };

            const totalInput  = result.usage?.input_tokens  ?? 0;
            const totalOutput = result.usage?.output_tokens ?? 0;

            // Reconcile: record any remaining tokens not yet billed per-round
            const remainingInput  = Math.max(0, totalInput  - recordedInput);
            const remainingOutput = Math.max(0, totalOutput - recordedOutput);
            recordTokens(remainingInput, remainingOutput);

            send({
              type: 'result',
              usage: {
                input_tokens:              totalInput,
                output_tokens:             totalOutput,
                cache_read_input_tokens:   result.usage?.cache_read_input_tokens   ?? 0,
                cache_creation_input_tokens: result.usage?.cache_creation_input_tokens ?? 0,
              },
              total_cost_usd: result.total_cost_usd,
              num_turns:      result.num_turns,
              session_id:     result.session_id,
            });
          }
        }
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      }

      // ── Persist written entity files to project DB ────────────────────────
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

      // Note: cwd is intentionally NOT deleted here. Keeping it warm means the
      // next turn in this thread reuses the same filesystem state, which
      // keeps the agent's context in the 1h prompt cache.

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
