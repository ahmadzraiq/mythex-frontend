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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compact step tree — keep id + type + config at all levels; strip verbose metadata. */
function compactStepTree(steps: unknown[]): unknown[] {
  return steps.map(s => {
    const step = s as Record<string, unknown>;
    const out: Record<string, unknown> = { id: step.id, type: step.type };
    if (step.config) out.config = step.config;
    for (const key of ['trueBranch', 'falseBranch', 'tryBody', 'catchBody', 'loopBody']) {
      if (Array.isArray(step[key])) out[key] = compactStepTree(step[key] as unknown[]);
    }
    return out;
  });
}


/** Summarise old chat history turns into a compact block. */
async function summariseChatHistory(
  history: Array<{ role: string; content: string }>,
  anthropic: Anthropic,
): Promise<string> {
  if (history.length <= 6) return '';
  const toSummarise = history.slice(0, history.length - 4);
  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    messages: [{ role: 'user', content: `Summarise this backend build conversation in ≤200 words. Focus on: what tables/workflows were created, key decisions, what was requested.\n\n${toSummarise.map(m => `${m.role}: ${m.content}`).join('\n\n')}` }],
  });
  return `[Prior context summary]\n${(resp.content[0] as { text: string }).text}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { message?: string; projectId?: string; chatHistory?: Array<{ role: string; content: string }> };
  const message = String(body.message ?? '').trim();
  const projectId = String(body.projectId ?? '').trim();
  const chatHistory = Array.isArray(body.chatHistory) ? body.chatHistory : [];

  if (!message || !projectId) {
    return new Response(JSON.stringify({ error: 'message and projectId are required' }), { status: 400 });
  }

  const signalCtl = buildTimeoutSignal(req.signal, MODEL_TIMEOUT_MS);

  // Auth headers — forward cookies from the original request
  const baseAuthHeaders: Record<string, string> = {};
  const cookie = req.headers.get('cookie');
  if (cookie) baseAuthHeaders['cookie'] = cookie;
  const auth = req.headers.get('authorization');
  if (auth) baseAuthHeaders['authorization'] = auth;

  async function backendFetch(path: string, method = 'GET', bodyData?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { ...baseAuthHeaders };
    // Only set Content-Type when we have a body; omitting it for bodyless POSTs (e.g. /publish)
    // prevents the server from rejecting with FST_ERR_CTP_EMPTY_JSON_BODY.
    if (bodyData !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BACKEND_API_URL}${path}`, {
      method,
      headers,
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
    const relevantTables = scoredTables.sort((a, b) => b.score - a.score).slice(0, 14);

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
            const result = await backendFetch(`/v1/projects/${projectId}/tables/import-erd`, 'POST', { erd: input.erd }) as { tables?: Array<{ id: string; name: string; columns?: Array<{ name: string; type?: string }> }>; workflowsCreated?: number };
            const tables = result?.tables ?? [];
            for (const t of tables) createdTables.push({ id: t.id, name: t.name });
            if (tables.length > 0) send({ type: 'backend_created', tables, workflows: [] });
            return {
              success: true,
              tablesCreated: tables.map(t => ({
                id: t.id,
                name: t.name,
                columnNames: (t.columns ?? []).map((c: { name: string }) => c.name),
              })),
              workflowsCreated: result?.workflowsCreated ?? 0,
              note: 'Column names are converted to snake_case (e.g. passwordHash → password_hash, userId → user_id). Use the columnNames above exactly in all formula expressions.',
            };
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
            if (!input.step || typeof input.step !== 'object' || Array.isArray(input.step)) {
              return { success: false, error: 'step must be a JSON object, not a string or array.' };
            }
            const current = await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`) as { workflow?: { graph?: unknown[] } };
            const currentGraph: unknown[] = Array.isArray(current?.workflow?.graph) ? current.workflow.graph : [];
            const newStep = input.step as Record<string, unknown>;
            if (!newStep.id) newStep.id = `s${currentGraph.length + 1}`;
            const updatedGraph = [...currentGraph, newStep];
            await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`, 'PATCH', { graph: updatedGraph });
            // Re-publish after each step so the live endpoint always reflects the latest graph.
            await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}/publish`, 'POST').catch(() => {});
            return {
              success: true,
              stepId: newStep.id,
              currentStepCount: updatedGraph.length,
              allStepIds: updatedGraph.map((s: unknown) => String((s as Record<string, unknown>).id ?? '')),
            };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        replace_workflow_step: async (input) => {
          try {
            const current = await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`) as { workflow?: { graph?: unknown[] } };
            const currentGraph: unknown[] = Array.isArray(current?.workflow?.graph) ? current.workflow.graph : [];
            const idx = currentGraph.findIndex(s => (s as Record<string, unknown>).id === input.stepId);
            if (idx === -1) return { success: false, error: `Step "${input.stepId}" not found in workflow graph.` };
            const updatedGraph = [...currentGraph];
            updatedGraph[idx] = input.step;
            await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`, 'PATCH', { graph: updatedGraph });
            // Re-publish after replacement so the fix is live immediately.
            await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}/publish`, 'POST').catch(() => {});
            return { success: true, replacedStepId: input.stepId, totalSteps: updatedGraph.length };
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
            if (Array.isArray(input.middlewareIds)) payload.middlewareIds = input.middlewareIds;
            return { success: true, workflow: await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`, 'PATCH', payload) };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        publish_server_workflow: async (input) => {
          try {
            const result = await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}/publish`, 'POST') as { workflow?: { id: string; name: string; status: string } };
            return { success: true, published: true, workflowId: result?.workflow?.id, name: result?.workflow?.name, status: result?.workflow?.status };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
        read_workflow: async (input) => {
          try {
            const result = await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`) as { workflow?: { id: string; name: string; kind: string; method?: string; path?: string; status: string; graph?: unknown[] } };
            const wf = result?.workflow;
            const graph = wf?.graph ?? [];
            return {
              workflowId: wf?.id,
              name: wf?.name,
              kind: wf?.kind,
              method: wf?.method,
              path: wf?.path,
              status: wf?.status,
              stepCount: graph.length,
              steps: compactStepTree(graph),
            };
          } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) }; }
        },
      };

      const promptParts = buildBackendAgentPrompt();
      const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: promptParts.static, cache_control: { type: 'ephemeral' } },
      ];

      // Inject summarised chat history as context
      let historyBlock = '';
      if (chatHistory.length > 0) {
        const summary = await summariseChatHistory(chatHistory, client).catch(() => '');
        const recentRaw = chatHistory.slice(-4);
        const rawLines = recentRaw.map(m => `${m.role}: ${m.content}`).join('\n\n');
        historyBlock = [summary, rawLines].filter(Boolean).join('\n\n') + '\n\n';
      }

      const userContent = [
        historyBlock,
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

      try {
        let currentMessages = [...messages];
        while (true) {
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

          // 'pause_turn' must be checked first — it always has zero tool blocks so the length
          // guard below would incorrectly break the loop if it fires first.
          if (finalMessage.stop_reason === 'pause_turn') continue;
          if (finalMessage.stop_reason === 'end_turn' || toolUseBlocks.length === 0) break;

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

        // ── Post-build verify loop — read each ENDPOINT/MIDDLEWARE and self-correct ──
        // The verify loop only gets read/repair tools — no create_server_workflow so it cannot
        // create duplicate workflows when it finds something broken.
        const verifyOnlyTools = tools.filter(t => ['read_workflow', 'replace_workflow_step', 'add_server_workflow_step'].includes(t.name));

        const workflowsToVerify = createdWorkflows.filter(w => w.kind === 'API_ENDPOINT' || w.kind === 'MIDDLEWARE');
        if (workflowsToVerify.length > 0) {
          const verifyUserContent = `[Verify Phase] Check and repair these ${workflowsToVerify.length} workflow(s):

${workflowsToVerify.map(w => `- ${w.name} (id: ${w.id})`).join('\n')}

For each workflow:
1. Call read_workflow to inspect its step graph.
2. Check: every branch/tryCatch must have BOTH arms populated; the final path must end in sendResponse or throwError; step IDs must be unique.
3. Fix issues with replace_workflow_step (rewrite a broken step) or add_server_workflow_step (add a missing step). DO NOT create new workflows.

Stop once every workflow is structurally complete.`;

          const verifyMessages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: verifyUserContent }];
          send({ type: 'agent_context', agent: 'backend:verify', systemPrompt: promptParts.static, tools: verifyOnlyTools.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now(), userMessage: verifyUserContent });

          let verifyCurrentMessages = [...verifyMessages];
          while (true) {
            const vResp = client.messages.stream({
              model: 'claude-haiku-4-5',
              max_tokens: 16384,
              system: systemBlocks,
              tools: verifyOnlyTools,
              messages: verifyCurrentMessages,
            } as unknown as Parameters<typeof client.messages.stream>[0], { signal: signalCtl.signal });

            const vToolBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
            let vCurBlock: { id: string; name: string; inputJson: string } | null = null;
            for await (const ev of vResp) {
              if (ev.type === 'content_block_start' && (ev.content_block as { type: string }).type === 'tool_use') {
                const tb = ev.content_block as { id: string; name: string };
                vCurBlock = { id: tb.id, name: tb.name, inputJson: '' };
              } else if (ev.type === 'content_block_delta' && (ev.delta as { type: string }).type === 'input_json_delta' && vCurBlock) {
                vCurBlock.inputJson += (ev.delta as { partial_json: string }).partial_json;
              } else if (ev.type === 'content_block_stop' && vCurBlock) {
                const parsed = parseStreamedInput(vCurBlock.inputJson);
                vToolBlocks.push({ id: vCurBlock.id, name: vCurBlock.name, input: parsed });
                send({ type: 'tool_executed', id: vCurBlock.id, name: vCurBlock.name, input: parsed, phase: 'backend:verify' });
                toolCount++;
                vCurBlock = null;
              }
            }
            const vFinal = await vResp.finalMessage();
            verifyCurrentMessages.push({ role: 'assistant', content: vFinal.content });

            if (vFinal.stop_reason === 'pause_turn') continue;
            if (vFinal.stop_reason === 'end_turn' || vToolBlocks.length === 0) break;

            const vResults: Anthropic.Messages.ToolResultBlockParam[] = [];
            for (const vt of vToolBlocks) {
              if (vt.input.__parseError) { vResults.push({ type: 'tool_result', tool_use_id: vt.id, content: JSON.stringify({ success: false, error: 'Malformed JSON.' }), is_error: true }); continue; }
              const handler = backendToolHandlers[vt.name];
              if (handler) {
                try { vResults.push({ type: 'tool_result', tool_use_id: vt.id, content: JSON.stringify(await handler(vt.input)) }); }
                catch (e) { vResults.push({ type: 'tool_result', tool_use_id: vt.id, content: JSON.stringify({ success: false, error: String(e) }), is_error: true }); }
              } else {
                vResults.push({ type: 'tool_result', tool_use_id: vt.id, content: JSON.stringify({ error: `Unknown tool "${vt.name}"` }), is_error: true });
              }
            }
            verifyCurrentMessages.push({ role: 'user', content: vResults });
          }
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
