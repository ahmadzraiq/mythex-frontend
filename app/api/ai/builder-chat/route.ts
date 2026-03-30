/**
 * POST /api/ai/builder-chat
 *
 * Main AI chat endpoint for the builder assistant.
 * Uses Anthropic's tool_use (function calling) to interact with the builder.
 *
 * Flow:
 *  1. Build system prompt with builder context
 *  2. Send to Anthropic with all builder tools
 *  3. Anthropic responds with text + optional tool calls
 *  4. Stream text deltas to client as SSE
 *  5. Collect tool calls → execute client-side via SSE events
 *  6. Continue the conversation loop (tool results → next AI response)
 *  7. Stop when AI sends a final text-only message (stop_reason = "end_turn")
 *
 * Note: Tool execution happens CLIENT-side (the browser has access to the
 * Zustand store). The server tells the client which tools to execute and
 * the client streams back the results on the next request iteration.
 * For simplicity, tool results are injected into the SSE stream as
 * "tool_executed" events that the client processes immediately.
 *
 * For generation tools (generate_app, generate_section), the server
 * triggers the existing generation pipeline.
 */

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ALL_BUILDER_TOOLS } from '@/lib/ai/builder-tools';
import { buildChatSystemPrompt } from '@/lib/ai/builder-knowledge';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Strict hex-only UUID validation — rejects non-hex chars (g-z) and short aliases.
// The AI is instructed to generate proper UUIDs; if it doesn't, we fail fast so it self-corrects.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isUUIDFormat(s: string): boolean { return UUID_RE.test(s); }

// Max tool-call rounds to prevent infinite loops.
// Complex tasks (create page → switch → structure → configure → style → text) need many rounds;
// 100 gives full budget for the most complex multi-section builds.
const MAX_TOOL_ROUNDS = 100;

// Models that support Anthropic extended thinking
const THINKING_MODELS = new Set(['claude-sonnet-4-5']);
const VALID_MODELS = new Set(['claude-haiku-4-5', 'claude-sonnet-4-5']);

interface ChatRequestBody {
  message: string;
  selectedNodeIds?: string[];
  selectedNodesDetails?: unknown[];
  pageTreeSnapshot?: Array<{ id?: string; type?: string; name?: string }>;
  pageId?: string;
  pages?: Array<{ id: string; name: string; route: string }>;
  theme?: Record<string, string>;
  mood?: string;
  animationLevel?: number;
  layoutStructure?: number;
  appName?: string;
  description?: string;
  category?: string;
  variables?: Array<{ id?: string; name: string; label?: string; type: string; initialValue?: unknown }>;
  workflows?: Array<{ name: string; trigger: string }>;
  dataSources?: Array<{ id: string; label: string; path: string }>;
  threadId?: string;
  chatHistory?: Array<{ role: string; content: string }>;
  /** Which Anthropic model to use (defaults to claude-haiku-4-5) */
  model?: string;
  // On subsequent turns (after tool execution), tool results are sent back
  toolResults?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
  /** When true, skip the AI call and return the built system prompt as JSON */
  systemPromptOnly?: boolean;
}

// ── Build palette snapshot from the project's live theme overrides ─────────────
// `themeOverrides` comes from store.themeOverrides on the client — it contains
// the full hex values applied by the active theme preset plus any manual edits.
// Keys are stored WITHOUT the '--' prefix (e.g. 'background', 'primary') —
// _applyLightOverrides prepends '--' when injecting CSS vars into the DOM.
// We map them to the --theme-* names used in className values, with NO fallback
// to config/theme.json — if a value is absent the AI simply won't see it.
// Returns a multi-line string: "  var(--theme-primary)    = #00b4d8  (brand accent)"
const THEME_VAR_MAP: Array<[string, string, string]> = [
  ['background',           '--theme-background',          'page background'],
  ['foreground',           '--theme-foreground',          'primary text'],
  ['primary',              '--theme-primary',             'brand accent'],
  ['primary-foreground',   '--theme-primary-foreground',  'text on primary'],
  ['secondary',            '--theme-secondary',           'secondary'],
  ['secondary-foreground', '--theme-secondary-foreground','text on secondary'],
  ['muted',                '--theme-muted',               'muted bg'],
  ['muted-foreground',     '--theme-muted-foreground',    'secondary text'],
  ['card',                 '--theme-card',                'card surface'],
  ['card-foreground',      '--theme-card-foreground',     'card text'],
  ['border',               '--theme-border',              'borders'],
  ['destructive',          '--theme-destructive',         'error/danger'],
  ['accent',               '--theme-accent',              'accent'],
  ['accent-foreground',    '--theme-accent-foreground',   'text on accent'],
];

function buildPaletteSnapshot(themeOverrides: Record<string, string>): string {
  const lines: string[] = [];
  for (const [sourceVar, themeVar, label] of THEME_VAR_MAP) {
    const hex = themeOverrides[sourceVar];
    if (hex) {
      lines.push(`  ${sourceVar}${' '.repeat(Math.max(1, 28 - sourceVar.length))}= ${hex}  (${label})`);
    }
  }
  return lines.length ? lines.join('\n') : '(no theme palette — user has not applied a theme)';
}

export async function POST(req: NextRequest) {
  const body = await req.json() as ChatRequestBody;
  const {
    message,
    selectedNodeIds = [],
    selectedNodesDetails = [],
    pageTreeSnapshot = [],
    pageId,
    pages = [],
    theme = {},
    mood,
    animationLevel,
    layoutStructure,
    appName,
    description,
    category,
    variables = [],
    workflows = [],
    dataSources = [],
    chatHistory = [],
    toolResults,
    model: requestedModel,
    systemPromptOnly = false,
  } = body;

  // Resolve model — only accept known models, default to haiku
  const modelId = (requestedModel && VALID_MODELS.has(requestedModel)) ? requestedModel : 'claude-haiku-4-5';
  const supportsThinking = THINKING_MODELS.has(modelId);

  // ── Build system prompt ─────────────────────────────────────────────────────

  const currentPage = (pageId ? pages.find(p => p.id === pageId) : undefined) ?? pages[0] ?? { id: 'home', name: 'Home', route: '/' };

  const paletteSnapshot = buildPaletteSnapshot(theme);

  const systemPrompt = buildChatSystemPrompt({
    pages,
    currentPageName: currentPage.name,
    currentPageRoute: currentPage.route,
    paletteSnapshot,
    mood,
    animationLevel,
    layoutStructure,
    appName,
    description,
    category,
  });

  // Recursive page tree printer — emits name (id) [type] for every node up to 3 levels deep.
  // This gives Claude full visibility of nested node IDs so it can reference them directly
  // on follow-up turns without needing to call get_page_tree() first.
  type SnapNode = { id?: string; type?: string; name?: string; text?: string; children?: unknown[]; childCount?: number };
  function printTree(nodes: SnapNode[], indent = ''): string {
    return nodes.map(n => {
      const label = `${indent}• ${n.name ?? n.type ?? 'Node'} (id:${n.id ?? '?'}) [${n.type ?? '?'}]${n.text ? ` "${n.text}"` : ''}`;
      const kids = (n.children ?? []) as SnapNode[];
      return kids.length ? label + '\n' + printTree(kids, indent + '  ') : label;
    }).join('\n');
  }

  // Add context about selected nodes and page tree as a system note
  const fmtInitial = (val: unknown): string => {
    if (Array.isArray(val)) return `array (${val.length} items)`;
    if (typeof val === 'object' && val !== null) return 'object';
    return String(val);
  };

  const contextNote = [
    selectedNodesDetails.length > 0
      ? `Selected: ${selectedNodesDetails.map((n: unknown) => { const node = n as { type?: string; id?: string; name?: string }; return `${node.type ?? 'Node'} "${node.name ?? 'untitled'}" (id: ${node.id ?? '?'})`; }).join(', ')}`
      : `Nothing selected`,
    pageTreeSnapshot.length > 0
      ? `Current page has ${pageTreeSnapshot.length} top-level section(s). Use search_nodes(query) to find a node by name/type/text, or get_page_tree() to inspect the full structure.`
      : `Current page is empty — no nodes yet.`,
    variables.length > 0
      ? `Variables: ${variables.map(v => `${v.label ?? v.name}${v.type ? ` — ${v.type}` : ''}${v.initialValue != null ? `, initial: ${fmtInitial(v.initialValue)}` : ''}${v.id ? ` (id: ${v.id}, path: variables['${v.id}'])` : ''}`).join(', ')}`
      : null,
    workflows.length > 0 ? `Workflows: ${workflows.map(w => `${w.name} (trigger: ${w.trigger})`).join(', ')}` : null,
    dataSources.length > 0 ? `DataSources: ${dataSources.map(d => `${d.label} → ${d.path}`).join(', ')}` : null,
  ].filter(Boolean).join('\n');

  // ── Early return for system prompt inspection ────────────────────────────────
  if (systemPromptOnly) {
    const full = contextNote ? `${systemPrompt}\n\n[Builder Context]\n${contextNote}` : systemPrompt;
    return Response.json({ systemPrompt: full });
  }

  // ── Build message history ────────────────────────────────────────────────────

  const messages: Anthropic.Messages.MessageParam[] = [];

  // Add previous conversation (last 10 turns for context)
  for (const m of chatHistory.slice(-10)) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }
  }

  // Add the current user message (with context note if available)
  const userContent = contextNote
    ? `[Context]\n${contextNote}\n\n[User Request]\n${message}`
    : message;

  messages.push({ role: 'user', content: userContent });

  // If tool results are being sent back (client-side tool execution model),
  // add them as a tool_result message
  if (toolResults?.length) {
    messages.push({
      role: 'user',
      content: toolResults.map(r => ({
        type: 'tool_result' as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error,
      })),
    });
  }

  // ── Set up SSE stream ────────────────────────────────────────────────────────

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });

  const send = (event: Record<string, unknown>) => {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // stream closed
    }
  };

  // ── Run AI loop ──────────────────────────────────────────────────────────────

  void (async () => {
    let currentMessages = [...messages];
    let rounds = 0;
    const allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }> = [];

    try {
      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++;

        // Tell the client a new Anthropic call is starting (shows "Planning…" between rounds)
        send({ type: 'round_start', round: rounds });

        // Create streaming request to Anthropic using the stream helper (has finalMessage())
        const response = client.messages.stream({
          model: modelId,
          // Thinking models need a higher token budget (thinking uses tokens too)
          max_tokens: supportsThinking ? 16000 : 4096,
          // Pass system prompt as an array block with cache_control so Anthropic caches
          // the large (~4-8k token) prompt across rounds — cuts TTFB on rounds 2+ significantly
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          ...(supportsThinking ? { thinking: { type: 'enabled', budget_tokens: 8000 } } : {}),
          tools: ALL_BUILDER_TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          })),
          messages: currentMessages,
        } as Parameters<typeof client.messages.stream>[0]);

        // Collect response blocks incrementally — no need to wait for finalMessage() for tool extraction
        let textContent = '';
        const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
        let stopReason = '';
        // Track the tool_use block currently being streamed
        let currentToolBlock: { id: string; name: string; inputJson: string } | null = null;
        // Track extended thinking block (Sonnet only)
        let currentThinkingBlock: { content: string } | null = null;

        for await (const event of response) {
          if (event.type === 'content_block_start') {
            const blockType = (event.content_block as { type: string }).type;
            if (blockType === 'tool_use') {
              const tb = event.content_block as { id: string; name: string };
              currentToolBlock = { id: tb.id, name: tb.name, inputJson: '' };
            } else if (blockType === 'thinking') {
              currentThinkingBlock = { content: '' };
            }
          } else if (event.type === 'content_block_delta') {
            const deltaType = (event.delta as { type: string }).type;
            if (deltaType === 'text_delta') {
              const text = (event.delta as { type: string; text: string }).text;
              textContent += text;
              send({ type: 'text_delta', content: text });
            } else if (deltaType === 'input_json_delta' && currentToolBlock) {
              currentToolBlock.inputJson += (event.delta as { type: string; partial_json: string }).partial_json;
            } else if (deltaType === 'thinking_delta' && currentThinkingBlock) {
              const thinking = (event.delta as { type: string; thinking: string }).thinking;
              currentThinkingBlock.content += thinking;
              send({ type: 'thinking_delta', content: thinking });
            }
          } else if (event.type === 'content_block_stop') {
            if (currentToolBlock) {
              // Tool input is fully received — parse and store without waiting for finalMessage()
              try {
                toolUseBlocks.push({
                  id: currentToolBlock.id,
                  name: currentToolBlock.name,
                  input: JSON.parse(currentToolBlock.inputJson || '{}') as Record<string, unknown>,
                });
              } catch {
                // Malformed JSON — push empty input so the round can continue
                toolUseBlocks.push({ id: currentToolBlock.id, name: currentToolBlock.name, input: {} });
              }
              currentToolBlock = null;
            }
            if (currentThinkingBlock) {
              currentThinkingBlock = null;
            }
          } else if (event.type === 'message_delta') {
            stopReason = (event.delta as { stop_reason?: string }).stop_reason ?? '';
          }
        }

        // finalMessage() is still needed to get the full content array for the conversation history
        // (it resolves immediately since we already exhausted the stream above)
        const finalMessage = await response.finalMessage();
        stopReason = finalMessage.stop_reason ?? stopReason;

        // Add assistant response to message history for continuation
        currentMessages.push({
          role: 'assistant',
          content: finalMessage.content,
        });

        // If tool calls were made, send them to the client for execution
        if (toolUseBlocks.length > 0) {
          const toolResultsForNextRound: Anthropic.Messages.ToolResultBlockParam[] = [];

          for (const tool of toolUseBlocks) {
            // For read-only tools, execute server-side and return results
            // For mutation tools, the client executes them
            const isReadTool = ['get_page_tree', 'get_node_details', 'get_theme', 'get_variables', 'get_pages', 'get_formula_context', 'get_workflows', 'get_data_sources', 'search_nodes'].includes(tool.name);
            const isSearchTool = ['search_images', 'search_videos', 'search_icons'].includes(tool.name);
            // add_component: AI provides its own hex UUID for nodeId — validate it strictly.
            const isAddComponentTool = tool.name === 'add_component';
            // Media node tools: AI does not provide nodeId — server generates one.
            const isMediaNodeTool = ['add_icon', 'add_image', 'add_video'].includes(tool.name);
            // Variable-creating tool — always generate a server UUID so variable IDs stay stable
            const isVarCreateTool = tool.name === 'add_variable';
            // Page-creating tool — pre-assign a page ID so Claude can use it in switch_page immediately
            const isPageCreateTool = tool.name === 'add_page';

            const rawInput = tool.input as Record<string, unknown>;

            let toolResult: string;
            // input sent to client
            let clientInput: Record<string, unknown> = rawInput;
            // When true, skip sending tool_executed to the client (nothing was created server-side)
            let skipClientExecution = false;

            if (isAddComponentTool) {
              // Validate that the AI provided a proper hex UUID. If not, fail immediately and
              // do NOT send tool_executed to the client — prevents phantom node creation.
              // The AI sees the error and self-corrects; no duplicate node is left on canvas.
              const nodeId = rawInput.nodeId as string | undefined;
              if (!nodeId || !isUUIDFormat(nodeId)) {
                skipClientExecution = true;
                toolResult = JSON.stringify({
                  success: false,
                  error: `nodeId "${nodeId ?? '(missing)'}" is not a valid UUID. ` +
                    `Generate a proper hex UUID (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890") and retry this tool call. ` +
                    `Do NOT call any other tools that reference this nodeId as parentId until this is fixed.`,
                });
              } else {
                // nodeId is valid — pass rawInput directly (nodeId is already in it, no _assignedNodeId needed)
                clientInput = rawInput;
                const placement = rawInput.parentId
                  ? `placed under parentId: ${rawInput.parentId}`
                  : `placed at ROOT of page (no parentId)`;
                toolResult = JSON.stringify({
                  success: true,
                  data: {
                    nodeId,
                    type: rawInput.label ?? 'node',
                    message: `Added ${rawInput.label ?? 'component'} (${placement}). nodeId="${nodeId}". Use as parentId for children or in set_text/set_class/rename_node.`,
                  },
                });
              }
            } else if (isMediaNodeTool) {
              // AI doesn't provide nodeId for icon/image/video — server generates one so the
              // client executor has a stable ID to use.
              const assignedNodeId = crypto.randomUUID();
              clientInput = { ...rawInput, _assignedNodeId: assignedNodeId };
              toolResult = JSON.stringify({ ok: true, pending: 'client_execution' });
            } else if (isVarCreateTool) {
              // Respect the AI's variableId if it is a valid hex UUID (same pattern as add_component).
              // This allows batching: AI pre-assigns a UUID, uses it in create_workflow variableName
              // in the same round without a round-trip. Only generate a server UUID as fallback.
              const aiVarId = rawInput.variableId as string | undefined;
              const assignedVarId = (aiVarId && isUUIDFormat(aiVarId))
                ? aiVarId
                : crypto.randomUUID();
              clientInput = { ...rawInput, variableId: assignedVarId, _assignedVarId: assignedVarId };
              const varName = String(rawInput.name ?? 'variable');
              toolResult = JSON.stringify({
                success: true,
                data: {
                  id: assignedVarId,
                  name: varName,
                  message: `Created variable "${varName}" id="${assignedVarId}". ` +
                    `Use variables['${assignedVarId}'] in formulas, ` +
                    `{{variables['${assignedVarId}']}} in text templates, ` +
                    `variableName:"${assignedVarId}" in changeVariableValue steps.`,
                },
              });
            } else if (isPageCreateTool) {
              // Check if a page with this route already exists before generating a fake success.
              // If the client's addPage silently no-ops (duplicate route), the AI would receive
              // "success" with a ghost pageId and switch_page would navigate nowhere.
              const existingPage = pages.find((p: { id: string; route?: string; name?: string }) =>
                p.route === (rawInput.route as string)
              );
              if (existingPage) {
                clientInput = rawInput; // nothing to execute on the client
                toolResult = JSON.stringify({
                  success: false,
                  error: `A page with route "${rawInput.route}" already exists (pageId: "${existingPage.id}", name: "${existingPage.name}"). Use switch_page with pageId="${existingPage.id}" to navigate to it instead of creating a duplicate.`,
                });
              } else {
                // Pre-assign page ID so Claude can reference it in switch_page immediately
                const assignedPageId = `page-${Date.now()}`;
                clientInput = { ...rawInput, pageId: assignedPageId, _assignedPageId: assignedPageId };
                toolResult = JSON.stringify({
                  success: true,
                  data: {
                    pageId: assignedPageId,
                    route: rawInput.route,
                    name: rawInput.name,
                    message: `Created page "${rawInput.name}" at route "${rawInput.route}". pageId="${assignedPageId}". Use this exact pageId in switch_page to navigate to this page.`,
                  },
                });
              }
            } else if (isReadTool) {
              // Serve real data from the request context
              if (tool.name === 'get_page_tree') {
                const depth = Math.min(Number(rawInput.depth ?? 2), 4);
                const summarize = (n: Record<string, unknown>, d: number): unknown => {
                  const base: Record<string, unknown> = {
                    id: n.id, type: n.type, name: n.name,
                    text: typeof n.text === 'string' ? (n.text as string).slice(0, 60) : undefined,
                    className: (n.props as { className?: string })?.className?.slice(0, 80),
                  };
                  const children = n.children as Record<string, unknown>[] | undefined;
                  if (d > 0 && children?.length) base.children = children.map(c => summarize(c, d - 1));
                  else if (children?.length) base.childCount = children.length;
                  return base;
                };
                const tree = pageTreeSnapshot.map(n => summarize(n as Record<string, unknown>, depth));
                toolResult = JSON.stringify({ pageName: currentPage.name, sections: tree });
              } else if (tool.name === 'get_node_details') {
                const ids = (rawInput.nodeIds as string[]) || [];
                // Search selected nodes first, then fall back to full page tree snapshot
                const findInTree = (nodes: unknown[], targetId: string): unknown | null => {
                  for (const n of nodes) {
                    const node = n as Record<string, unknown>;
                    if (node.id === targetId) return node;
                    const children = node.children as unknown[] | undefined;
                    if (Array.isArray(children)) {
                      const hit = findInTree(children, targetId);
                      if (hit) return hit;
                    }
                  }
                  return null;
                };
                const found = ids.map(id => {
                  // Try selectedNodesDetails first (has full detail), then fall back to page tree
                  const fromSelected = (selectedNodesDetails as Array<Record<string, unknown>>).find(n => n.id === id);
                  if (fromSelected) return fromSelected;
                  return findInTree(pageTreeSnapshot, id) ?? { id, note: 'Node not found in page tree' };
                });
                toolResult = JSON.stringify(found);
              } else if (tool.name === 'get_pages') {
                toolResult = JSON.stringify(pages);
              } else if (tool.name === 'get_theme') {
                toolResult = JSON.stringify(theme);
              } else if (tool.name === 'get_variables') {
                toolResult = JSON.stringify(variables);
              } else if (tool.name === 'get_formula_context') {
                // Return variable UUIDs, data source paths, and standard paths
                toolResult = JSON.stringify({
                  variables: variables.map(v => ({
                    label: v.label ?? v.name,
                    path: v.id ? `variables['${v.id}']` : `variables['${v.name}']`,
                    type: v.type,
                    initialValue: v.initialValue,
                  })),
                  dataSources,
                  repeatContext: null,
                  standard: [
                    { label: 'Route params', examples: ['route.slug', 'route.q', 'route.page'] },
                    { label: 'Auth state', examples: ['auth.user', 'auth.token', 'auth.isLoggedIn'] },
                    { label: 'Workflow result', examples: ['_workflow.lastError', '_workflow.lastAction'] },
                  ],
                });
              } else if (tool.name === 'get_workflows') {
                toolResult = JSON.stringify(workflows);
              } else if (tool.name === 'get_data_sources') {
                toolResult = JSON.stringify(dataSources);
              } else if (tool.name === 'search_nodes') {
                // Search the current page's node tree by substring match on name/type/text/id.
                // Returns all matches with breadcrumb paths so the AI can reference node IDs.
                const query = String(rawInput.query ?? '').toLowerCase();
                const filterType = rawInput.nodeType ? String(rawInput.nodeType).toLowerCase() : undefined;

                type SearchNode = { id?: string; type?: string; name?: string; text?: string; children?: unknown[] };
                const results: Array<{ id: string | undefined; name: string | undefined; type: string | undefined; text: string | undefined; breadcrumb: string; parentId: string | undefined }> = [];

                const walk = (nodes: SearchNode[], breadcrumb: string[], parentId: string | undefined) => {
                  for (const n of nodes) {
                    const crumb = [...breadcrumb, n.name ?? n.type ?? 'Node'];
                    const matchesType = !filterType || (n.type ?? '').toLowerCase() === filterType;
                    const matchesQuery =
                      (n.name ?? '').toLowerCase().includes(query) ||
                      (n.type ?? '').toLowerCase().includes(query) ||
                      (typeof n.text === 'string' ? n.text : '').toLowerCase().includes(query) ||
                      (n.id ?? '').toLowerCase().includes(query);
                    if (matchesQuery && matchesType) {
                      results.push({
                        id: n.id,
                        name: n.name ?? n.type,
                        type: n.type,
                        text: typeof n.text === 'string' ? n.text.slice(0, 80) : undefined,
                        breadcrumb: crumb.join(' > '),
                        parentId,
                      });
                    }
                    if (Array.isArray(n.children) && n.children.length > 0) {
                      walk(n.children as SearchNode[], crumb, n.id);
                    }
                  }
                };

                walk(pageTreeSnapshot as SearchNode[], [], undefined);
                toolResult = JSON.stringify(
                  results.length > 0
                    ? results
                    : { note: `No nodes found matching "${rawInput.query}"${filterType ? ` with type "${rawInput.nodeType}"` : ''}. Try a broader query or call get_page_tree() to see all nodes.` }
                );
              } else {
                toolResult = JSON.stringify({ note: 'Data from client context' });
              }
            } else if (isSearchTool && tool.name === 'search_images') {
              // Execute server-side image search
              try {
                const q = encodeURIComponent(String(rawInput.query ?? ''));
                const count = Number(rawInput.count ?? 5);
                const apiKey = process.env.UNSPLASH_ACCESS_KEY;
                if (apiKey) {
                  const r = await fetch(`https://api.unsplash.com/search/photos?query=${q}&per_page=${count}&client_id=${apiKey}`);
                  if (r.ok) {
                    const d = await r.json() as { results?: Array<{ id: string; urls: { regular: string; small: string }; alt_description: string; user: { name: string } }> };
                    const photos = (d.results ?? []).map(p => ({
                      url: p.urls.regular, thumb: p.urls.small, alt: p.alt_description, credit: p.user.name,
                    }));
                    toolResult = JSON.stringify(photos);
                    // Send results to client so it can display image options
                    send({ type: 'image_results', images: photos });
                  } else {
                    toolResult = JSON.stringify({ error: `Unsplash API error ${r.status}` });
                  }
                } else {
                  toolResult = JSON.stringify({ error: 'UNSPLASH_ACCESS_KEY not configured' });
                }
              } catch (e) {
                toolResult = JSON.stringify({ error: String(e) });
              }
            } else if (isSearchTool && tool.name === 'search_videos') {
              // Execute server-side video search via Pexels
              try {
                const q = encodeURIComponent(String(rawInput.query ?? ''));
                const count = Number(rawInput.count ?? 4);
                const apiKey = process.env.PEXELS_API_KEY;
                if (apiKey) {
                  const url = q
                    ? `https://api.pexels.com/videos/search?query=${q}&page=1&per_page=${count}`
                    : `https://api.pexels.com/videos/popular?page=1&per_page=${count}`;
                  const r = await fetch(url, { headers: { Authorization: apiKey }, next: { revalidate: 300 } });
                  if (r.ok) {
                    const d = await r.json() as { videos?: Array<{ id: number; image: string; video_files: Array<{ quality: string; link: string }> }> };
                    const videos = (d.videos ?? []).map(v => {
                      const sd = v.video_files.find(f => f.quality === 'sd') ?? v.video_files[0];
                      return { src: sd?.link ?? '', poster: v.image };
                    }).filter(v => v.src);
                    toolResult = JSON.stringify(videos);
                  } else {
                    toolResult = JSON.stringify({ error: `Pexels API error ${r.status}` });
                  }
                } else {
                  toolResult = JSON.stringify({ error: 'PEXELS_API_KEY not configured' });
                }
              } catch (e) {
                toolResult = JSON.stringify({ error: String(e) });
              }
            } else if (isSearchTool && tool.name === 'search_icons') {
              // Execute server-side icon search via Iconify
              try {
                const q = encodeURIComponent(String(rawInput.query ?? ''));
                const count = Number(rawInput.count ?? 10);
                const prefix = rawInput.prefix ? `&prefix=${rawInput.prefix}` : '';
                const r = await fetch(`https://api.iconify.design/search?query=${q}&limit=${count}${prefix}`);
                if (r.ok) {
                  const d = await r.json() as { icons?: string[] };
                  toolResult = JSON.stringify(d.icons ?? []);
                  send({ type: 'icon_results', icons: d.icons ?? [] });
                } else {
                  toolResult = JSON.stringify({ error: `Iconify API error ${r.status}` });
                }
              } catch (e) {
                toolResult = JSON.stringify({ error: String(e) });
              }
            } else {
              // Mutation tool — the client will execute it
              toolResult = JSON.stringify({ ok: true, pending: 'client_execution' });
            }

            // Send tool execution event to client — skipped when validation failed so the
            // client never creates a phantom node that the AI will then duplicate on retry.
            if (!skipClientExecution) {
              send({
                type: 'tool_executed',
                id: tool.id,
                name: tool.name,
                input: clientInput,
              });

              allExecutedTools.push({
                name: tool.name,
                input: clientInput,
                result: toolResult,
              });
            }

            toolResultsForNextRound.push({
              type: 'tool_result',
              tool_use_id: tool.id,
              content: toolResult,
            });
          }

          // Add tool results to messages for next round
          currentMessages.push({
            role: 'user',
            content: toolResultsForNextRound,
          });

          // Continue conversation if AI has more to say
          if (stopReason === 'tool_use') {
            continue; // next round
          }
        }

        // No more tool calls — we're done
        break;
      }

      // Send final done event
      send({ type: 'done', tools: allExecutedTools });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'error', message: msg });
    } finally {
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
