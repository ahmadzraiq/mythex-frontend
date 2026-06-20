/**
 * POST /api/ai/builder-chat
 *
 * File-agent path only. Receives virtualFiles (DSL source map),
 * runs the file-agent agentic loop, and streams SSE events back to the client.
 *
 * SSE events emitted:
 *   { type: 'request_start', requestId, pageId, model }
 *   { type: 'build_plan', mode: 'file-agent', buildUnits: [...] }
 *   { type: 'agent_context', agent: 'file-agent', ... }
 *   { type: 'text_delta', content: '...' }         — streaming answer text
 *   { type: 'tool_use', toolName, input }
 *   { type: 'tool_result', toolName, content }
 *   { type: 'page_written', path, content }         — compiled page JSON
 *   { type: 'workflow_written', path, content }
 *   { type: 'agent_complete', agent, rounds, ... }
 *   { type: 'turn_stats', ... }
 *   { type: 'done', tools: [] }
 *   { type: 'error', message: '...' }
 */

import { NextRequest } from 'next/server';

const MODEL_TIMEOUT_MS = 120_000;
const EXTERNAL_FETCH_TIMEOUT_MS = 15_000;

const VALID_MODELS = new Set(['claude-haiku-4-5', 'claude-sonnet-4-5']);

function buildTimeoutSignal(baseSignal: AbortSignal, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(new Error('Request aborted by client'));
  baseSignal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      baseSignal.removeEventListener('abort', onAbort);
    },
  };
}

interface ChatRequestBody {
  message: string;
  pageId?: string;
  pages?: Array<{ id: string; name: string; route: string }>;
  chatHistory?: Array<{ role: string; content: string }>;
  model?: string;
  /** Workspace ID — used for AI token usage tracking */
  workspaceId?: string;
  /** Project ID — used for context in token usage tracking */
  projectId?: string;
  threadId?: string;
  /** File-agent payload: map of filename → DSL source */
  virtualFiles?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as ChatRequestBody;
  const {
    message,
    pageId,
    pages = [],
    chatHistory = [],
    model: requestedModel,
    workspaceId: wsId,
    projectId: projId,
    threadId,
    virtualFiles,
  } = body;

  const isFileAgentRequest = virtualFiles && typeof virtualFiles === 'object' && Object.keys(virtualFiles).length > 0;
  const modelId = (requestedModel && VALID_MODELS.has(requestedModel)) ? requestedModel : 'claude-haiku-4-5';
  const requestId = threadId || crypto.randomUUID();
  const modelSignalCtl = buildTimeoutSignal(req.signal, MODEL_TIMEOUT_MS);
  const externalSignalCtl = buildTimeoutSignal(req.signal, EXTERNAL_FETCH_TIMEOUT_MS);

  // ── AI quota pre-check ──────────────────────────────────────────────────────
  if (wsId) {
    try {
      const usageResp = await fetch(
        `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/v1/workspaces/${wsId}/usage`,
        { headers: { Cookie: req.headers.get('cookie') ?? '' } },
      );
      if (usageResp.ok) {
        const usageData = await usageResp.json() as { isSuperAdmin?: boolean; usage?: { aiTokens?: { remaining: number | null } } };
        if (!usageData.isSuperAdmin) {
          const remaining = usageData.usage?.aiTokens?.remaining;
          if (remaining !== null && remaining !== undefined && remaining <= 0) {
            return new Response(
              JSON.stringify({ error: 'AI token quota exhausted for this billing period. Please upgrade your plan.', code: 'AI_QUOTA_EXCEEDED' }),
              { status: 402, headers: { 'Content-Type': 'application/json' } },
            );
          }
        }
      }
    } catch { /* non-critical */ }
  }

  const currentPage = (pageId ? pages.find(p => p.id === pageId) : undefined) ?? pages[0] ?? { id: 'home', name: 'Home', route: '/' };

  // ── SSE stream ──────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });

  const turnStartedAt = Date.now();
  const turnCounters = { inputTokens: 0, outputTokens: 0 };

  /** Fire-and-forget token recording */
  const recordTokens = (inputTokens: number, outputTokens: number) => {
    if (!wsId || (inputTokens + outputTokens) === 0) return;
    fetch(`${process.env.BACKEND_URL ?? 'http://localhost:4000'}/v1/workspaces/${wsId}/usage/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') ?? '' },
      body: JSON.stringify({ projectId: projId, inputTokens, outputTokens, model: modelId }),
    }).catch(err => console.error('[token-record] failed:', err));
  };

  const send = (event: Record<string, unknown>) => {
    if (event.type === '_internal_token_usage') {
      const roundInput = (event.inputTokens as number) ?? 0;
      const roundOutput = (event.outputTokens as number) ?? 0;
      turnCounters.inputTokens += roundInput;
      turnCounters.outputTokens += roundOutput;
      recordTokens(roundInput, roundOutput);
      return;
    }
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // stream closed
    }
  };

  send({ type: 'request_start', requestId, pageId: currentPage.id, model: modelId });

  void (async () => {
    try {
      if (!isFileAgentRequest) {
        send({ type: 'error', message: 'No virtualFiles provided. This endpoint requires the file-agent payload.' });
        return;
      }

      // ── File-agent path ─────────────────────────────────────────────────────
      const { runFileAgent, FILE_AGENT_DEFAULT_MODEL } = await import('@/lib/ai/agents/file-agent/agent');
      const { FILE_AGENT_SYSTEM_PROMPT } = await import('@/lib/ai/agents/file-agent/prompt');
      const { FILE_AGENT_TOOLS } = await import('@/lib/ai/agents/file-agent/tools');
      const { embedFiles } = await import('@/lib/ai/vfs/embed-files');

      send({ type: 'build_plan', mode: 'file-agent', buildUnits: [{ name: message.slice(0, 60), pageRoute: currentPage.route, pageName: currentPage.name, description: message }] });

      const fileAgentStartedAt = Date.now();
      send({
        type: 'agent_context',
        agent: 'file-agent',
        displayLabel: 'File Agent',
        systemPrompt: FILE_AGENT_SYSTEM_PROMPT,
        userMessage: message,
        tools: (FILE_AGENT_TOOLS as Array<{ name: string }>).map(t => t.name),
        syntheticMessageCount: 0,
        startedAt: fileAgentStartedAt,
      });

      const entityIndex = await embedFiles(virtualFiles!).catch(() => new Map<string, { vector: number[]; entity: import('@/lib/ai/vfs/entities').Entity }>());

      const result = await runFileAgent({
        files: virtualFiles!,
        message,
        chatHistory: chatHistory.slice(-6).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        model: modelId ?? FILE_AGENT_DEFAULT_MODEL,
        entityIndex,
        emit: send,
        signal: modelSignalCtl.signal,
      });

      send({
        type: 'agent_complete',
        agent: 'file-agent',
        rounds: result.rounds,
        toolCallCount: result.toolCallCount,
        duration: Date.now() - fileAgentStartedAt,
        endedAt: Date.now(),
      });

      send({
        type: 'turn_stats',
        totalDurationMs: Date.now() - turnStartedAt,
        toolCalls: result.ops.length,
        ops: result.ops.length,
        agents: 1,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      if (!result.answer) send({ type: 'text_delta', content: 'Done.' });
      send({ type: 'done', tools: [] });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[builder-chat] request failed', { requestId, pageId: currentPage.id, modelId, message: msg });
      send({ type: 'error', message: msg });
    } finally {
      modelSignalCtl.cleanup();
      externalSignalCtl.cleanup();
      try { controller.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
