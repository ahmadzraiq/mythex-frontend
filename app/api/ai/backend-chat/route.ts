/**
 * POST /api/ai/backend-chat
 *
 * Dedicated backend-only AI endpoint — bypasses the full builder pipeline
 * (context agent, planner, structure step) and runs only the backend agent.
 *
 * Use this for testing backend AI capabilities directly from the Data & API tab,
 * or for requests that are purely backend (tables, workflows, endpoints) with
 * no frontend UI to build.
 *
 * Request body:
 *   { message: string; projectId: string }
 *
 * Response: SSE stream
 *   agent_context  — backend agent started
 *   tool_executed  — each backend tool call (read: returns data to AI)
 *   backend_created — { tables: [{id,name}], workflows: [{id,name,kind}] }
 *   agent_complete — backend agent finished
 *   done           — stream finished
 *   error          — fatal error
 */

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { BACKEND_AGENT_TOOLS } from '@/lib/ai/builder-tools';
import { buildBackendAgentPrompt } from '@/lib/ai/agents/backend/prompt';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BACKEND_API_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';
const MODEL_TIMEOUT_MS = 300_000;

function buildTimeoutSignal(baseSignal: AbortSignal, ms: number): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(new Error('Request aborted by client'));
  baseSignal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new Error(`Timed out after ${ms}ms`)), ms);
  return {
    signal: ctrl.signal,
    cleanup: () => { clearTimeout(timer); baseSignal.removeEventListener('abort', onAbort); },
  };
}

type ToolParam = { name: string; description: string; input_schema: Record<string, unknown> };
const toToolParam = (t: { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] } }): ToolParam => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema as Record<string, unknown>,
});

function parseStreamedInput(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw || '{}') as Record<string, unknown>; } catch { return { __parseError: true }; }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { message?: string; projectId?: string };
  const message = String(body.message ?? '').trim();
  const projectId = String(body.projectId ?? '').trim();

  if (!message || !projectId) {
    return new Response(JSON.stringify({ error: 'message and projectId are required' }), { status: 400 });
  }

  const signalCtl = buildTimeoutSignal(req.signal, MODEL_TIMEOUT_MS);

  // Auth headers — forward cookies from the original request
  const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  const cookie = req.headers.get('cookie');
  if (cookie) authHeaders['cookie'] = cookie;
  const auth = req.headers.get('authorization');
  if (auth) authHeaders['authorization'] = auth;

  async function backendFetch(path: string, method = 'GET', bodyData?: unknown): Promise<unknown> {
    const res = await fetch(`${BACKEND_API_URL}${path}`, {
      method,
      headers: authHeaders,
      ...(bodyData !== undefined ? { body: JSON.stringify(bodyData) } : {}),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Backend ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  // Fetch compact backend context index
  let backendContextBlock = '';
  try {
    const [tablesRaw, workflowsRaw] = await Promise.all([
      backendFetch(`/v1/projects/${projectId}/tables`).catch(() => []),
      backendFetch(`/v1/projects/${projectId}/workflows`).catch(() => []),
    ]);

    interface RawColumn { name: string; type?: string; refTableId?: string | null }
    interface RawTable { id: string; name: string; columns?: RawColumn[] }
    const tablesObj = tablesRaw as { tables?: RawTable[] };
    const tables = Array.isArray(tablesObj?.tables) ? tablesObj.tables : [];
    const msgWords = message.toLowerCase().split(/\W+/).filter(w => w.length > 2);

    const compactTables = tables.map(t => ({
      id: t.id,
      name: t.name,
      columnNames: (t.columns ?? []).map((c: RawColumn) => c.name),
      relations: (t.columns ?? []).filter((c: RawColumn) => c.type === 'RELATION' && c.refTableId)
        .map((c: RawColumn) => ({ column: c.name, refTableId: c.refTableId })),
    }));
    const scoredTables = compactTables.map(t => {
      const haystack = [t.name, ...t.columnNames].join(' ').toLowerCase();
      return { ...t, score: msgWords.reduce((n, w) => n + (haystack.includes(w) ? 1 : 0), 0) };
    });
    const topTables = scoredTables.sort((a, b) => b.score - a.score).slice(0, 10);
    const relevantTables = topTables.slice(0, 14);

    interface RawWorkflow { id: string; name?: string; kind?: string; status?: string; method?: string; path?: string }
    const workflowsObj = workflowsRaw as { workflows?: RawWorkflow[] };
    const wfs = Array.isArray(workflowsObj?.workflows) ? workflowsObj.workflows : [];
    const topWorkflows = wfs.map(w => {
      const haystack = [w.name ?? '', w.kind ?? '', w.path ?? ''].join(' ').toLowerCase();
      return { ...w, score: msgWords.reduce((n, wd) => n + (haystack.includes(wd) ? 1 : 0), 0) };
    }).sort((a, b) => b.score - a.score).slice(0, 10);

    const tableLines = relevantTables.map(t => {
      const cols = t.columnNames.join(', ');
      return `  ${t.name} (${t.id})  columns: ${cols || '(none)'}`;
    });
    const wfLines = topWorkflows.map(w => {
      const method = w.method ? ` ${w.method}` : '';
      const path = w.path ? ` ${w.path}` : '';
      return `  ${w.name ?? 'unnamed'} (${w.id}) — ${w.kind ?? '?'}${method}${path}${w.status === 'PUBLISHED' ? ' [published]' : ''}`;
    });

    const parts: string[] = [];
    if (tableLines.length > 0) parts.push(`tables:\n${tableLines.join('\n')}`);
    if (wfLines.length > 0) parts.push(`server workflows:\n${wfLines.join('\n')}`);
    if (parts.length > 0) backendContextBlock = `[Backend Context]\n${parts.join('\n\n')}`;
  } catch (err) {
    console.warn('[backend-chat] context fetch failed:', err instanceof Error ? err.message : err);
  }

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* controller closed */ }
      };

      const createdTables: Array<{ id: string; name: string }> = [];
      const createdWorkflows: Array<{ id: string; name: string; kind: string }> = [];

      // Backend tool handlers
      const backendToolHandlers: Record<string, (input: Record<string, unknown>) => unknown> = {
        create_table: async (input) => {
          try {
            const payload: Record<string, unknown> = {
              name: input.tableName,
              displayName: input.tableName,
              createApiActions: false,
            };
            if (Array.isArray(input.columns) && input.columns.length > 0) payload.columns = input.columns;
            const result = await backendFetch(`/v1/projects/${projectId}/tables`, 'POST', payload) as { table?: { id: string; name: string } };
            const tbl = result?.table;
            if (tbl?.id) {
              createdTables.push({ id: tbl.id, name: tbl.name });
              send({ type: 'backend_created', tables: [{ id: tbl.id, name: tbl.name }], workflows: [] });
            }
            return { success: true, tableId: tbl?.id, tableName: tbl?.name };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        add_table_column: async (input) => {
          try {
            return { success: true, column: await backendFetch(`/v1/projects/${projectId}/tables/${input.tableId}/columns`, 'POST', input.column) };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        import_erd: async (input) => {
          try {
            const result = await backendFetch(`/v1/projects/${projectId}/tables/import-erd`, 'POST', { erd: input.erd }) as { tables?: Array<{ id: string; name: string }>; workflowsCreated?: number };
            const tables = result?.tables ?? [];
            for (const t of tables) createdTables.push({ id: t.id, name: t.name });
            if (tables.length > 0) send({ type: 'backend_created', tables, workflows: [] });
            return { success: true, tablesCreated: tables.map(t => ({ id: t.id, name: t.name })), workflowsCreated: result?.workflowsCreated ?? 0 };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        read_table: async (input) => {
          try { return await backendFetch(`/v1/projects/${projectId}/tables/${input.tableId}`); }
          catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        create_server_workflow: async (input) => {
          try {
            const slug = String(input.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const payload: Record<string, unknown> = {
              name: input.name,
              slug,
              kind: input.kind,
              ...(input.description ? { description: input.description } : {}),
              ...(input.method ? { method: input.method } : {}),
              ...(input.path ? { path: input.path } : {}),
            };
            const result = await backendFetch(`/v1/projects/${projectId}/workflows`, 'POST', payload) as { workflow?: { id: string; name: string; kind: string } };
            const wf = result?.workflow;
            if (wf?.id) {
              createdWorkflows.push({ id: wf.id, name: wf.name, kind: wf.kind });
              send({ type: 'backend_created', tables: [], workflows: [{ id: wf.id, name: wf.name, kind: wf.kind }] });
            }
            return { success: true, workflowId: wf?.id, name: wf?.name, kind: wf?.kind };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        add_server_workflow_step: async (input) => {
          try {
            // Fetch current graph (array), append new step, PATCH back
            const current = await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`) as { workflow?: { graph?: unknown[] } };
            const currentGraph: unknown[] = Array.isArray(current?.workflow?.graph) ? current.workflow.graph : [];
            const newStep = input.step as Record<string, unknown>;
            if (!newStep.id) newStep.id = `s${currentGraph.length + 1}`;
            const updatedGraph = [...currentGraph, newStep];
            const updated = await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`, 'PATCH', { graph: updatedGraph });
            return { success: true, stepId: newStep.id, workflow: updated };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        update_server_workflow: async (input) => {
          try {
            const payload: Record<string, unknown> = {};
            if (input.name) payload.name = input.name;
            if (input.description) payload.description = input.description;
            if (input.method) payload.method = input.method;
            if (input.path) payload.path = input.path;
            if (input.params) payload.inputSchema = input.params;
            return { success: true, workflow: await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`, 'PATCH', payload) };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        publish_server_workflow: async (input) => {
          try { return { success: true, workflow: await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}/publish`, 'POST') }; }
          catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        read_workflow: async (input) => {
          try { return await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`); }
          catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
      };

      const promptParts = buildBackendAgentPrompt();
      const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: promptParts.static, cache_control: { type: 'ephemeral' } },
      ];
      const userContent = [
        backendContextBlock ? `${backendContextBlock}\n\n` : '',
        `Original request: ${message}`,
      ].filter(Boolean).join('');

      const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: userContent }];
      const tools = BACKEND_AGENT_TOOLS.map(toToolParam);
      const allowedTools = new Set(tools.map(t => t.name));

      send({ type: 'agent_context', agent: 'backend', systemPrompt: promptParts.static, tools: tools.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now(), userMessage: userContent });

      const startedAt = Date.now();
      let rounds = 0;
      let toolCount = 0;
      const maxRounds = 20;

      try {
        let currentMessages = [...messages];
        while (rounds < maxRounds) {
          rounds++;
          const response = client.messages.stream({
            model: 'claude-haiku-4-5',
            max_tokens: 16384,
            system: systemBlocks,
            tools,
            messages: currentMessages,
          } as unknown as Parameters<typeof client.messages.stream>[0], { signal: signalCtl.signal });

          const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
          let currentToolBlock: { id: string; name: string; inputJson: string } | null = null;

          for await (const event of response) {
            if (event.type === 'content_block_start' && (event.content_block as { type: string }).type === 'tool_use') {
              const tb = event.content_block as { id: string; name: string };
              currentToolBlock = { id: tb.id, name: tb.name, inputJson: '' };
            } else if (event.type === 'content_block_delta' && (event.delta as { type: string }).type === 'input_json_delta' && currentToolBlock) {
              currentToolBlock.inputJson += (event.delta as { partial_json: string }).partial_json;
            } else if (event.type === 'content_block_stop' && currentToolBlock) {
              const input = parseStreamedInput(currentToolBlock.inputJson);
              const toolBlock = { id: currentToolBlock.id, name: currentToolBlock.name, input };
              toolUseBlocks.push(toolBlock);
              if (allowedTools.has(toolBlock.name)) {
                send({ type: 'tool_executed', id: toolBlock.id, name: toolBlock.name, input: toolBlock.input, phase: 'backend' });
                toolCount++;
              }
              currentToolBlock = null;
            }
          }

          const finalMessage = await response.finalMessage();
          currentMessages.push({ role: 'assistant', content: finalMessage.content });

          if (toolUseBlocks.length === 0) break;

          const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
          for (const tool of toolUseBlocks) {
            if (tool.input.__parseError) {
              toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify({ success: false, error: 'Malformed JSON input.' }), is_error: true });
              continue;
            }
            if (!allowedTools.has(tool.name)) {
              toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify({ error: `Unknown tool "${tool.name}".` }), is_error: true });
              continue;
            }
            const handler = backendToolHandlers[tool.name];
            if (handler) {
              try {
                const result = await handler(tool.input);
                toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(result) });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify({ success: false, error: msg }), is_error: true });
              }
            }
          }
          currentMessages.push({ role: 'user', content: toolResults });
        }

        send({ type: 'agent_complete', agent: 'backend', rounds, toolCallCount: toolCount, duration: Date.now() - startedAt, endedAt: Date.now() });
        if (createdTables.length > 0 || createdWorkflows.length > 0) {
          send({ type: 'backend_created', tables: createdTables, workflows: createdWorkflows });
        }
        send({ type: 'done', tools: [] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[backend-chat] agent failed:', msg);
        send({ type: 'error', message: msg });
      } finally {
        signalCtl.cleanup();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
