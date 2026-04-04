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
import { ALL_BUILDER_TOOLS, PHASE3_BUILDER_TOOLS, PHASE_W_TOOLS, STRUCTURE_AGENT_TOOLS, BINDING_AGENT_TOOLS, LAYOUT_AGENT_TOOLS, COLORS_AGENT_TOOLS } from '@/lib/ai/builder-tools';
import { buildChatSystemPrompt, buildPhase3SystemPrompt, PLAN_SYSTEM } from '@/lib/ai/builder-knowledge-v2';
import { buildStructureAgentPrompt, buildBindingAgentPrompt, buildWorkflowsAgentPrompt, buildLayoutAgentPrompt, buildColorsAgentPrompt } from '@/lib/ai/agents';
import { TOOL_CAPABILITY_GROUP, getCapabilities, buildBlockedGroupSuggestion, buildCapabilityNote } from '@/lib/ai/component-capabilities';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL_TIMEOUT_MS = 120_000;
const EXTERNAL_FETCH_TIMEOUT_MS = 15_000;

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

function parseStreamedToolInput(raw: string): { input: Record<string, unknown>; parseError?: string } {
  try {
    return { input: JSON.parse(raw || '{}') as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      input: { __parseError: true, __rawInputJson: raw },
      parseError: `Invalid tool JSON input: ${msg}`,
    };
  }
}

// ── Build-mode types ─────────────────────────────────────────────────────────

interface BuildUnit {
  name: string;
  pageRoute: string;
  pageName: string;
  description: string;
  sectionCount?: number;
  layout?: string;
  /** When false, the structure agent is told to declare zero variables — purely visual section with no interactive state or data arrays. */
  needsVariables?: boolean;
  /** Machine-readable layout pattern key emitted by the classify agent when a specific tree shape is required. */
  structureHint?: 'layered-absolute' | 'grid' | 'flex-row';
}

interface BuildPlan {
  mode: 'edit' | 'build' | 'mixed';
  /** When false, Phase 3 styling is skipped — components render with their defaultNode styles. */
  needsStyling?: boolean;
  /** When false, the binding agent is skipped — no repeat, condition, or text binding needed. */
  needsBinding?: boolean;
  /** When false, the workflows agent is skipped — purely visual/decorative section with no interactions. */
  needsWorkflows?: boolean;
  editSummary?: string;
  buildUnits?: BuildUnit[];
  relations?: string[];
}

interface CollectedTree {
  unitName: string;
  tree: Record<string, unknown>;
  pageId: string | null;
  atIndex?: number;
  // Populated by onStructureReady via extractMediaFromTree — no post-hoc scanning
  mediaManifest?: {
    icons: Array<{ id: string; icon: string }>;
    images: Array<{ id: string; searchQuery: string }>;
    videos: Array<{ id: string; searchQuery: string }>;
    bgImages: Array<{ id: string; searchQuery: string }>;
  };
}

// A non-structure tool call made by the mini-model during Phase 2 (add_variable, set_repeat, set_text).
// These are collected and streamed to the client in order before Phase 3.
interface ToolEvent {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

// ── Server-side UUID assignment for generate_structure ───────────────────────
// Keep AI pre-assigned UUIDs when valid; generate only for missing/invalid ones;
// deduplicate across the whole tree (second occurrence of the same UUID gets a fresh one).

const TREE_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function assignTreeIds(
  node: Record<string, unknown>,
  seen: Set<string> = new Set()
): Record<string, unknown> {
  const raw = typeof node.id === 'string' ? node.id : '';
  const id = TREE_UUID_RE.test(raw) && !seen.has(raw) ? raw : crypto.randomUUID();
  seen.add(id);
  const children = Array.isArray(node.children)
    ? (node.children as Record<string, unknown>[]).map(c => assignTreeIds(c, seen))
    : [];
  const result: Record<string, unknown> = { ...node, id, children };
  if (result.condition === 'true' || result.condition === true) {
    delete result.condition;
  }
  // Auto-fix: Grid with repeat + single child → move repeat to the child
  const label = (result.label as string ?? '').toLowerCase();
  if (label === 'grid' && typeof result.repeat === 'string' && children.length === 1) {
    const child = children[0] as Record<string, unknown>;
    if (!child.repeat) {
      child.repeat = result.repeat;
      if (result.keyField) child.keyField = result.keyField;
      delete result.repeat;
      delete result.keyField;
    }
  }
  // Auto-fix: Grid with _needsRepeat marker + single child → move marker to the child
  if (label === 'grid' && result._needsRepeat && children.length === 1) {
    const child = children[0] as Record<string, unknown>;
    if (!child._needsRepeat) {
      child._needsRepeat = result._needsRepeat;
      if (result._needsRepeatKeyField) child._needsRepeatKeyField = result._needsRepeatKeyField;
      delete result._needsRepeat;
      delete result._needsRepeatKeyField;
    }
  }
  return result;
}

/** Strip _needs* marker fields from a tree before sending to client.
 *  Returns the markers extracted from the tree for use by hint detectors and the Binding agent. */
function extractAndStripMarkers(tree: Record<string, unknown>): Array<{
  nodeId: string;
  _needsRepeat?: string | boolean;
  _needsRepeatKeyField?: string;
  _needsCondition?: string;
}> {
  const markers: Array<{
    nodeId: string;
    _needsRepeat?: string | boolean;
    _needsRepeatKeyField?: string;
    _needsCondition?: string;
  }> = [];
  const walk = (node: Record<string, unknown>) => {
    const hasMarker = node._needsRepeat || node._needsCondition;
    if (hasMarker) {
      markers.push({
        nodeId: node.id as string,
        _needsRepeat: node._needsRepeat as string | boolean | undefined,
        _needsRepeatKeyField: node._needsRepeatKeyField as string | undefined,
        _needsCondition: node._needsCondition as string | undefined,
      });
      delete node._needsRepeat;
      delete node._needsRepeatKeyField;
      delete node._needsCondition;
    }
    for (const child of (Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [])) {
      walk(child);
    }
  };
  walk(tree);
  return markers;
}

const DOM_MANIPULATION_RE = /querySelector|querySelectorAll|getElementById|createElement|\.style\.|\.classList\.|event\.target|\.innerHTML|\.appendChild|window\.addEventListener|document\./;

function isCustomJsDomWorkflow(input: Record<string, unknown>): boolean {
  const steps = input.steps as Array<{ type?: string; config?: { code?: string } }> | undefined;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  const jsSteps = steps.filter(s => s.type === 'customJavaScript');
  if (jsSteps.length === 0) return false;
  return jsSteps.every(s => DOM_MANIPULATION_RE.test(s.config?.code ?? ''));
}

function detectNestedRepeatNodes(trees: Array<{ tree: Record<string, unknown> }>): string {
  const innerNodeIds: string[] = [];
  const walk = (node: Record<string, unknown>, repeatDepth: number, outerRepeatPath: string | null) => {
    const hasRepeat = (typeof node.repeat === 'string' && node.repeat.length > 0) || !!node._needsRepeat;
    const newDepth = hasRepeat ? repeatDepth + 1 : repeatDepth;
    const repeatPath = (node.repeat as string) ?? '';
    const newOuterPath = hasRepeat && repeatDepth >= 1 ? repeatPath : outerRepeatPath;
    if (newDepth >= 2 && !hasRepeat) {
      innerNodeIds.push(node.id as string);
    }
    const children = node.children as Record<string, unknown>[] | undefined;
    if (Array.isArray(children)) {
      for (const child of children) walk(child, newDepth, newOuterPath);
    }
  };
  for (const ct of trees) walk(ct.tree, 0, null);
  if (innerNodeIds.length === 0) return '';
  return `\nNESTED REPEAT SCOPE: Nodes [${innerNodeIds.join(', ')}] are inside an inner repeat. To access OUTER template fields from these nodes, use context?.item?.parent?.data?.FIELD. context?.item?.data on these nodes refers to the inner repeat item (use .value for primitives, .index for position).`;
}

/**
 * Detect repeat templates that have boolean variant fields (e.g. "featured").
 * When a template node will receive a ternary background, ALL descendant text/icon
 * nodes need matching ternary colors for contrast. Phase 3 often styles nested
 * repeat children but forgets the outer template's direct children.
 *
 * Returns a hint string listing the descendant node IDs that need contrast ternaries.
 */
function detectTernaryContrastNodes(
  trees: Array<{ tree: Record<string, unknown> }>,
  varEvents: Array<{ name: string; input: Record<string, unknown> }>,
): string {
  const arrayVarData = new Map<string, unknown[]>();
  for (const ev of varEvents) {
    if (ev.name === 'add_variable' && ev.input.type === 'array' && Array.isArray(ev.input.initialValue)) {
      const id = String(ev.input.variableId ?? ev.input._assignedVarId ?? '');
      if (id) arrayVarData.set(id, ev.input.initialValue as unknown[]);
    }
  }

  const results: Array<{ templateId: string; templateName: string; boolField: string; descendants: Array<{ id: string; nested: boolean }> }> = [];

  const walk = (node: Record<string, unknown>) => {
    const inlineRepeat = node.repeat as string | undefined;
    const markerRepeat = node._needsRepeat;
    const hasRepeat = (typeof inlineRepeat === 'string' && inlineRepeat.length > 0) || !!markerRepeat;
    if (hasRepeat) {
      // Resolve array data: inline repeat has UUID in path, boolean marker matches any array variable with boolean fields
      let arrData: unknown[] | undefined;
      if (typeof inlineRepeat === 'string') {
        const varIdMatch = inlineRepeat.match(/variables\['([^']+)'\]/);
        const varId = varIdMatch ? varIdMatch[1] : inlineRepeat;
        arrData = arrayVarData.get(varId);
      } else {
        // Boolean _needsRepeat: find first array variable that has boolean fields
        for (const [, data] of arrayVarData) {
          if (data.length > 0) {
            const sample = data[0] as Record<string, unknown>;
            if (Object.values(sample).some(v => typeof v === 'boolean')) { arrData = data; break; }
          }
        }
        // Fallback: use any array variable
        if (!arrData) { for (const [, data] of arrayVarData) { if (data.length > 0) { arrData = data; break; } } }
      }
      if (Array.isArray(arrData) && arrData.length > 0) {
        const sample = arrData[0] as Record<string, unknown>;
        const boolFields = Object.entries(sample)
          .filter(([, v]) => typeof v === 'boolean')
          .map(([k]) => k);
        if (boolFields.length > 0) {
          const descendants: Array<{ id: string; nested: boolean }> = [];
          const collectDescendants = (n: Record<string, unknown>, repeatDepth: number) => {
            const children = n.children as Record<string, unknown>[] | undefined;
            if (!Array.isArray(children)) return;
            for (const child of children) {
              const hasInnerRepeat = (typeof child.repeat === 'string' && (child.repeat as string).length > 0) || !!child._needsRepeat;
              const childDepth = hasInnerRepeat ? repeatDepth + 1 : repeatDepth;
              const label = (child.label as string ?? '').toLowerCase();
              if (['text', 'heading', 'label', 'caption', 'icon', 'btn solid', 'btn outline', 'btn ghost', 'btn destructive', 'btn + icon l', 'btn + icon r', 'divider'].includes(label) ||
                  (child.children && Array.isArray(child.children))) {
                if (child.id) descendants.push({ id: child.id as string, nested: childDepth >= 2 });
              }
              collectDescendants(child, childDepth);
            }
          };
          collectDescendants(node, 1);
          if (descendants.length > 0) {
            results.push({
              templateId: node.id as string,
              templateName: (node.name as string) ?? 'template',
              boolField: boolFields[0],
              descendants,
            });
          }
        }
      }
    }
    const children = node.children as Record<string, unknown>[] | undefined;
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
    }
  };
  for (const ct of trees) walk(ct.tree);
  if (results.length === 0) return '';

  return results.map(r => {
    const lines = r.descendants.map(d =>
      d.nested
        ? `  - ${d.id} (NESTED): context?.item?.parent?.data?.${r.boolField}`
        : `  - ${d.id}: context?.item?.data?.${r.boolField}`
    ).join('\n');
    return `\nTERNARY CONTRAST REQUIRED: Template "${r.templateName}" (${r.templateId}) has boolean "${r.boolField}". Set ternary background on template, then set matching ternary text/icon colors on EACH descendant using EXACTLY the scope shown:\n${lines}`;
  }).join('');
}

/**
 * Detect repeat templates and their parent containers.
 * Phase 3 frequently confuses these, applying ternary context?.item?.data formulas
 * to the parent (which is OUTSIDE the repeat scope — resolves to undefined) and
 * applying grid layout to the template (creating N grids instead of 1).
 *
 * Returns a hint string clearly identifying which node is the container vs template.
 */
function detectRepeatContainerPairs(trees: Array<{ tree: Record<string, unknown> }>): string {
  const pairs: Array<{ containerId: string; containerName: string; templateId: string; templateName: string }> = [];
  const walk = (node: Record<string, unknown>) => {
    const children = node.children as Record<string, unknown>[] | undefined;
    if (!Array.isArray(children)) return;
    for (const child of children) {
      const hasRepeat = (typeof child.repeat === 'string' && child.repeat.length > 0) || !!child._needsRepeat;
      if (hasRepeat) {
        pairs.push({
          containerId: node.id as string,
          containerName: (node.name as string) ?? 'container',
          templateId: child.id as string,
          templateName: (child.name as string) ?? 'template',
        });
      }
      walk(child);
    }
  };
  for (const ct of trees) walk(ct.tree);
  if (pairs.length === 0) return '';
  return pairs.map(p =>
    `\nREPEAT LAYOUT RULE: "${p.containerName}" (${p.containerId}) is the CONTAINER — set grid/flex layout, gap, maxWidth, width on THIS node. "${p.templateName}" (${p.templateId}) is the TEMPLATE with repeat — set per-item styling (bg ternary, border ternary, shadow ternary, padding, hover animation, position offset) on THIS node. NEVER apply context?.item?.data formulas to the container (${p.containerId}) — it is outside the repeat scope and those formulas return undefined. NEVER apply set_layout(gridCols) to the template (${p.templateId}) — it creates N grids instead of 1.`
  ).join('');
}

// ── Phase 0: classify the request ────────────────────────────────────────────

async function classifyRequest(
  message: string,
  pages: Array<{ id: string; name: string; route: string }>,
  modelId: string,
  currentPageRoute?: string,
  signal?: AbortSignal,
): Promise<BuildPlan> {
  const pageList = pages.map(p => `- "${p.name}" at ${p.route} (id: ${p.id})`).join('\n');
  const prompt = `Current page: "${currentPageRoute ?? '/'}"\nAll pages:\n${pageList || '(none)'}\n\nUser request:\n${message}`;
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: PLAN_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }, signal ? { signal } : undefined);
    const text = res.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as BuildPlan;
  } catch {
    // fall through to edit mode on any error
  }
  return { mode: 'edit' };
}

// ── Server-side media search helpers (Tier 0 pre-fetch) ──────────────────────

async function searchUnsplashServer(query: string, count = 5, signal?: AbortSignal): Promise<Array<{ url: string; alt: string }>> {
  try {
    const apiKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!apiKey || !query) return [];
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&client_id=${apiKey}`, { signal });
    if (!r.ok) return [];
    const d = await r.json() as { results?: Array<{ urls: { regular: string }; alt_description: string }> };
    return (d.results ?? []).map(p => ({ url: p.urls.regular, alt: p.alt_description ?? '' }));
  } catch { return []; }
}

async function searchPexelsServer(query: string, count = 4, signal?: AbortSignal): Promise<Array<{ src: string; poster: string }>> {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) return [];
    const q = encodeURIComponent(query || 'nature');
    const r = await fetch(`https://api.pexels.com/videos/search?query=${q}&page=1&per_page=${count}`, { headers: { Authorization: apiKey }, next: { revalidate: 300 }, signal });
    if (!r.ok) return [];
    const d = await r.json() as { videos?: Array<{ image: string; video_files: Array<{ quality: string; link: string }> }> };
    return (d.videos ?? []).map(v => {
      const sd = v.video_files.find(f => f.quality === 'sd') ?? v.video_files[0];
      return { src: sd?.link ?? '', poster: v.image };
    }).filter(v => v.src);
  } catch { return []; }
}

/** Walk the resolved tree, extract icon/searchQuery/bgImage media hints from Phase 2, strip them from tree.
 *  Returns a manifest of media nodes to process server-side.
 *  Tree is modified in place — icon/searchQuery/bgImage fields are removed so they don't reach the client.
 */
function extractMediaFromTree(tree: Record<string, unknown>): {
  icons: Array<{ id: string; icon: string }>;
  images: Array<{ id: string; searchQuery: string }>;
  videos: Array<{ id: string; searchQuery: string }>;
  bgImages: Array<{ id: string; searchQuery: string }>;
} {
  const manifest = {
    icons: [] as Array<{ id: string; icon: string }>,
    images: [] as Array<{ id: string; searchQuery: string }>,
    videos: [] as Array<{ id: string; searchQuery: string }>,
    bgImages: [] as Array<{ id: string; searchQuery: string }>,
  };

  const walk = (node: Record<string, unknown>) => {
    const label = String(node.label ?? '').toLowerCase();
    const id = node.id as string | undefined;

    if (id) {
      if (label === 'icon') {
        const icon = node.icon as string | undefined;
        if (icon) {
          manifest.icons.push({ id, icon });
          delete node.icon; // strip — not an SDUI prop
        }
      } else if (label === 'image') {
        const searchQuery = node.searchQuery as string | undefined;
        delete node.searchQuery; // strip
        manifest.images.push({ id, searchQuery: searchQuery ?? '' });
      } else if (label === 'video') {
        const searchQuery = node.searchQuery as string | undefined;
        delete node.searchQuery; // strip
        manifest.videos.push({ id, searchQuery: searchQuery ?? '' });
      }
      // Box with bgImage — CSS background-image set via set_background by media agent
      if (node.bgImage) {
        const bgImageQuery = node.bgImage as string;
        delete node.bgImage; // strip — media agent handles the URL lookup
        if (id) manifest.bgImages.push({ id, searchQuery: bgImageQuery });
      }
    }

    // Strip icon/searchQuery/bgImage from any node type (defensive cleanup)
    if ('icon' in node && label !== 'icon') delete node.icon;
    if ('searchQuery' in node) delete node.searchQuery;
    if ('bgImage' in node) delete node.bgImage;

    for (const child of (Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [])) {
      walk(child);
    }
  };

  walk(tree);
  return manifest;
}

// ── Reusable Haiku agent loop (used by Phase 3 and Phase W) ──────────────────

async function runHaikuAgentLoop(
  messages: Anthropic.Messages.MessageParam[],
  systemBlocks: Anthropic.Messages.TextBlockParam[],
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
  readToolHandlers: Record<string, (input: Record<string, unknown>) => unknown>,
  send: (event: Record<string, unknown>) => void,
  allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }>,
  maxRounds = 15,
  phase?: string,
  signal?: AbortSignal,
  capabilityValidator?: (toolName: string, args: Record<string, unknown>) => string | null,
): Promise<void> {
  let currentMessages = [...messages];
  let rounds = 0;
  // Maps tool call ID → error string for client-side tools blocked by capability check.
  // These never reach the client; the model receives the real error for self-correction.
  const blockedToolErrors = new Map<string, string>();

  // Build allowed tool set — any tool name NOT in this set gets an error back to the LLM
  const allowedTools = new Set([
    ...tools.map(t => t.name),
    ...Object.keys(readToolHandlers),
    'search_icons',
  ]);

  while (rounds < maxRounds) {
    rounds++;

    const response = client.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 16384,
      system: systemBlocks,
      tools,
      messages: currentMessages,
    } as unknown as Parameters<typeof client.messages.stream>[0], signal ? { signal } : undefined);

    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    // Track tool IDs emitted during streaming so the post-stream loop doesn't double-emit.
    const streamEmittedIds = new Set<string>();
    let stopReason = '';
    let currentToolBlock: { id: string; name: string; inputJson: string } | null = null;

    for await (const event of response) {
      if (event.type === 'content_block_start' && (event.content_block as { type: string }).type === 'tool_use') {
        const tb = event.content_block as { id: string; name: string };
        currentToolBlock = { id: tb.id, name: tb.name, inputJson: '' };
      } else if (event.type === 'content_block_delta' && (event.delta as { type: string }).type === 'input_json_delta' && currentToolBlock) {
        currentToolBlock.inputJson += (event.delta as { partial_json: string }).partial_json;
      } else if (event.type === 'content_block_stop' && currentToolBlock) {
        const parsed = parseStreamedToolInput(currentToolBlock.inputJson);
        const parsedInput = parsed.input;
        const toolBlock = { id: currentToolBlock.id, name: currentToolBlock.name, input: parsedInput };
        toolUseBlocks.push(toolBlock);
        // Only emit for known, non-read tools — unknown tools are rejected in the results loop
        const isReadTool = !!readToolHandlers[toolBlock.name];
        if (!isReadTool && allowedTools.has(toolBlock.name)) {
          // Server-side capability guard: validate before emitting to client.
          // Blocked tools are never sent to the client; the model receives the real error.
          const capBlockError = capabilityValidator?.(toolBlock.name, toolBlock.input) ?? null;
          if (capBlockError) {
            blockedToolErrors.set(toolBlock.id, capBlockError);
          } else {
            streamEmittedIds.add(toolBlock.id);
            send({ type: 'tool_executed', id: toolBlock.id, name: toolBlock.name, input: toolBlock.input, phase });
            allExecutedTools.push({ name: toolBlock.name, input: toolBlock.input });
          }
        }
        currentToolBlock = null;
      } else if (event.type === 'message_delta') {
        stopReason = (event.delta as { stop_reason?: string }).stop_reason ?? '';
      }
    }

    const finalMessage = await response.finalMessage();
    stopReason = finalMessage.stop_reason ?? stopReason;

    // Reconcile streamed toolUseBlocks with finalMessage.content.
    // When max_tokens is hit mid-response, the last tool_use block may not receive a
    // content_block_stop event, so it ends up in finalMessage.content but not in
    // toolUseBlocks. Without this reconciliation, the assistant message has an orphaned
    // tool_use block with no corresponding tool_result → Anthropic 400 on the next round.
    {
      const streamedIds = new Set(toolUseBlocks.map(t => t.id));
      for (const block of finalMessage.content) {
        if (block.type !== 'tool_use') continue;
        const tb = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
        if (!streamedIds.has(tb.id)) {
          toolUseBlocks.push({ id: tb.id, name: tb.name, input: tb.input ?? {} });
        }
      }
    }

    currentMessages.push({ role: 'assistant', content: finalMessage.content });

    // No tools called → the agent is done
    if (toolUseBlocks.length === 0) break;

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const tool of toolUseBlocks) {
      const hadParseError = tool.input.__parseError === true;
      if (hadParseError) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify({
            success: false,
            error: 'Malformed tool JSON input. Re-emit this tool call with valid JSON.',
          }),
          is_error: true,
        });
        continue;
      }
      // Reject hallucinated tools that are not in this agent's schema
      if (!allowedTools.has(tool.name)) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify({ error: `Unknown tool "${tool.name}". Your available tools are: ${tools.map(t => t.name).join(', ')}. Use ONLY these tools.` }),
          is_error: true,
        });
        continue;
      }
      const readHandler = readToolHandlers[tool.name];
      if (readHandler) {
        try {
          const result = readHandler(tool.input);
          const resultStr = result instanceof Promise ? JSON.stringify(await result) : JSON.stringify(result);
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: resultStr });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify({ success: false, error: `Read tool failed: ${msg}` }),
            is_error: true,
          });
        }
      } else if (tool.name === 'search_icons') {
        try {
          const q = encodeURIComponent(String(tool.input.query ?? ''));
          const count = Number(tool.input.count ?? 10);
          const prefix = tool.input.prefix ? `&prefix=${tool.input.prefix}` : '';
          const r = await fetch(`https://api.iconify.design/search?query=${q}&limit=${count}${prefix}`, { signal });
          const d = r.ok ? await r.json() as { icons?: string[] } : { icons: [] as string[] };
          // Emit as 'media' phase so icon searches group with image/video searches in the chat log
          send({ type: 'tool_executed', id: tool.id, name: tool.name, input: tool.input, phase: 'media' });
          allExecutedTools.push({ name: tool.name, input: tool.input });
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(d.icons ?? []) });
        } catch {
          send({ type: 'tool_executed', id: tool.id, name: tool.name, input: tool.input, phase: 'media' });
          allExecutedTools.push({ name: tool.name, input: tool.input });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify({ success: false, error: 'search_icons failed (network/timeout).' }),
            is_error: true,
          });
        }
      } else if (tool.name === 'create_workflow' && isCustomJsDomWorkflow(tool.input)) {
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify({
          success: false,
          error: 'customJavaScript with DOM manipulation is not supported in the SDUI engine. Visual effects (hover, press, entrance animations) are handled by set_animation in the styling phase. Only create workflows for state changes (toggle, tab switch, form submit, navigation). If no state logic is needed, stop.',
        }) });
      } else if (blockedToolErrors.has(tool.id)) {
        // Capability-blocked tool — return the real error so the model can self-correct.
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify({ success: false, error: blockedToolErrors.get(tool.id) }),
          is_error: true,
        });
      } else if (streamEmittedIds.has(tool.id)) {
        // Already emitted during streaming — just add the tool result.
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify({ ok: true, pending: 'client_execution' }) });
      } else {
        // Not emitted during streaming (e.g. max_tokens reconciliation path) — check capability first.
        const capBlockError = capabilityValidator?.(tool.name, tool.input) ?? null;
        if (capBlockError) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify({ success: false, error: capBlockError }),
            is_error: true,
          });
        } else {
          send({ type: 'tool_executed', id: tool.id, name: tool.name, input: tool.input, phase });
          allExecutedTools.push({ name: tool.name, input: tool.input });
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify({ ok: true, pending: 'client_execution' }) });
        }
      }
    }

    currentMessages.push({ role: 'user', content: toolResults });

    // Continue if the model wants more tool calls or was truncated (max_tokens).
    // Only stop when the model explicitly ends the turn (end_turn).
    if (stopReason !== 'tool_use' && stopReason !== 'max_tokens') break;
  }
}

// ── Structure Agent: builds tree shape + declares variables in one call ───────

async function runStructureAgent(
  unit: BuildUnit,
  assignedPageId: string | null,
  existingVariables: Array<{ id?: string; label?: string; name?: string; type?: string }>,
  send: (event: Record<string, unknown>) => void,
  allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }>,
  signal?: AbortSignal,
): Promise<{
  tree: CollectedTree | null;
  markers: Array<{ nodeId: string; _needsRepeat?: string | boolean; _needsRepeatKeyField?: string; _needsCondition?: string }>;
  varEvents: ToolEvent[];
}> {
  const arrayVars = existingVariables.filter(v => v.type === 'array' && v.id);
  const existingVarsNote = arrayVars.length > 0
    ? `\nExisting array variables (prefer reusing these instead of creating duplicates):\n${arrayVars.map(v => `  - "${v.label ?? v.name}" id="${v.id}" type="${v.type}"`).join('\n')}\n`
    : '';

  const sysPrompt = buildStructureAgentPrompt(existingVarsNote || undefined);
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    { type: 'text', text: sysPrompt.static, cache_control: { type: 'ephemeral' } },
    ...(sysPrompt.dynamic ? [{ type: 'text', text: sysPrompt.dynamic } as Anthropic.Messages.TextBlockParam] : []),
  ];

  const sectionLimit = `\nSECTION LIMIT: Build EXACTLY ${unit.sectionCount ?? 1} section(s). Do NOT add extra sections.`;
  const noVarsNote = unit.needsVariables === false
    ? '\nVARIABLES: None needed — this section is purely visual. Leave the variables array empty [].'
    : '';
  const structureHintLine = unit.structureHint ? `\nStructurePattern: ${unit.structureHint}` : '';
  const prompt = `Build: ${unit.name}\nDescription: ${unit.description}${sectionLimit}\n${unit.layout ? `Layout: ${unit.layout}` : ''}${structureHintLine}${noVarsNote}\n\nDeclare all needed variables in the \`variables\` array and build the tree in one generate_structure call.`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
    max_tokens: 16384,
    system: systemBlocks,
    tools: STRUCTURE_AGENT_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    tool_choice: { type: 'tool' as const, name: 'generate_structure' },
    messages: [{ role: 'user', content: prompt }],
  }, signal ? { signal } : undefined);

    for (const block of response.content) {
    if (block.type !== 'tool_use' || block.name !== 'generate_structure') continue;
      const rawInput = block.input as Record<string, unknown>;
        const treeInput = rawInput.tree as Record<string, unknown> | undefined | null;
    if (!treeInput || typeof treeInput !== 'object') continue;

        const atIndex = rawInput.atIndex as number | undefined;
        const resolvedTree = assignTreeIds(treeInput);
    const markers = extractAndStripMarkers(resolvedTree);
        const collectedTree: CollectedTree = { unitName: unit.name, tree: resolvedTree, pageId: assignedPageId, atIndex };

    const declaredVars = (Array.isArray(rawInput.variables) ? rawInput.variables : []) as Array<{ name: string; type: string; initialValue?: unknown; uuid: string }>;
    const varEvents: ToolEvent[] = [];
    for (const v of declaredVars) {
      const assignedId = (v.uuid && isUUIDFormat(v.uuid)) ? v.uuid : crypto.randomUUID();
      const varName = String(v.name ?? 'variable');
      const clientInput: Record<string, unknown> = { name: varName, type: v.type, initialValue: v.initialValue, variableId: assignedId, _assignedVarId: assignedId };
      varEvents.push({ name: 'add_variable', input: clientInput, result: { success: true } });
      send({ type: 'tool_executed', id: `var-${varName.replace(/[^a-zA-Z0-9_-]/g, '-')}-${assignedId.slice(0, 8)}`, name: 'add_variable', input: clientInput, phase: 'structure' });
      allExecutedTools.push({ name: 'add_variable', input: clientInput });
    }

    return { tree: collectedTree, markers, varEvents };
  }

  return { tree: null, markers: [], varEvents: [] };
}

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
  /** When true, the client is continuing a Phase 3 styling session across a tool-result request.
   *  The server must restore inPhase3Mode=true so Phase 3 tool restrictions are preserved. */
  isPhase3Continuation?: boolean;
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
    threadId,
    chatHistory = [],
    toolResults,
    model: requestedModel,
    systemPromptOnly = false,
    isPhase3Continuation = false,
  } = body;

  // Resolve model — only accept known models, default to haiku
  const modelId = (requestedModel && VALID_MODELS.has(requestedModel)) ? requestedModel : 'claude-haiku-4-5';
  const supportsThinking = THINKING_MODELS.has(modelId);
  const requestId = threadId || crypto.randomUUID();
  const modelSignalCtl = buildTimeoutSignal(req.signal, MODEL_TIMEOUT_MS);
  const externalSignalCtl = buildTimeoutSignal(req.signal, EXTERNAL_FETCH_TIMEOUT_MS);

  // ── Build system prompt ─────────────────────────────────────────────────────

  const currentPage = (pageId ? pages.find(p => p.id === pageId) : undefined) ?? pages[0] ?? { id: 'home', name: 'Home', route: '/' };

  const paletteSnapshot = buildPaletteSnapshot(theme);

  const mainPromptParts = buildChatSystemPrompt({
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
    const mainFull = mainPromptParts.static + '\n\n' + mainPromptParts.dynamic;
    const full = contextNote ? `${mainFull}\n\n[Builder Context]\n${contextNote}` : mainFull;
    const phase3PromptParts = buildPhase3SystemPrompt({
      pages,
      currentPageName: currentPage.name,
      currentPageRoute: currentPage.route,
      paletteSnapshot,
      mood,
      animationLevel,
      appName,
      description,
      category,
    });
    const structurePromptParts = buildStructureAgentPrompt();
    const workflowsPromptParts = buildWorkflowsAgentPrompt({ pages, currentPageName: currentPage.name, currentPageRoute: currentPage.route, appName, description });
    return Response.json({
      systemPrompt: mainFull,
      planningPrompt: PLAN_SYSTEM,
      structurePrompt: structurePromptParts.static + (structurePromptParts.dynamic ? '\n\n' + structurePromptParts.dynamic : ''),
      phase3Prompt: phase3PromptParts.static + '\n\n' + phase3PromptParts.dynamic,
      workflowsPrompt: workflowsPromptParts.static + '\n\n' + workflowsPromptParts.dynamic,
      structureTools: STRUCTURE_AGENT_TOOLS.map(t => t.name),
      phase3Tools: PHASE3_BUILDER_TOOLS.map(t => t.name),
      workflowsTools: PHASE_W_TOOLS.map(t => t.name),
      mainTools: ALL_BUILDER_TOOLS.map(t => t.name),
    });
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
  send({ type: 'request_start', requestId, pageId: currentPage.id, model: modelId });

  // ── Detect build / mixed mode ────────────────────────────────────────────────
  // Always call Phase 0 classifier for first-round messages — it uses Haiku (fast, cheap)
  // and correctly returns "edit" for non-build requests, so there is no routing cost.
  // A regex heuristic would silently miss any request that doesn't match the pattern.
  const mightBeBuildRequest = !toolResults?.length;

  // ── Run AI loop ──────────────────────────────────────────────────────────────

  void (async () => {
    let currentMessages = [...messages];
    let rounds = 0;
    const allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }> = [];
    // Restored from isPhase3Continuation when the client sends back tool results across requests.
    let inPhase3Mode = isPhase3Continuation;

    // ── Build / mixed mode orchestrator ──────────────────────────────────────
    async function runBuildOrMixedMode(plan: BuildPlan): Promise<boolean> {
      // Phase 1 (mixed only): run sequential edit loop first
      if (plan.mode === 'mixed' && plan.editSummary) {
        send({ type: 'build_phase', phase: 'editing', message: 'Applying changes...' });
        const editMsgs: Anthropic.Messages.MessageParam[] = [
          ...currentMessages.slice(0, -1),
          { role: 'user', content: `${contextNote ? `[Context]\n${contextNote}\n\n` : ''}[Edit Operations]\n${plan.editSummary}\n\nApply ONLY the edit operations listed above. Do NOT create new pages or sections.` },
        ];
        await runEditLoop(editMsgs);
      }

      const units = plan.buildUnits ?? [];
      if (units.length === 0) { send({ type: 'done', tools: allExecutedTools }); return false; }

      send({ type: 'build_phase', phase: 'building', total: units.length, message: `Building ${units.length} section${units.length !== 1 ? 's' : ''} with parallel agents...`, buildUnits: units.map(u => ({ name: u.name, description: u.description, pageRoute: u.pageRoute, sectionCount: u.sectionCount })) });

      // ── Page creation (sequential) ──────────────────────────────────────────
      const pageIdMap: Record<string, string> = {};
      for (const unit of units) {
        const isCurrent = !unit.pageRoute || unit.pageRoute === '/' || unit.pageRoute === currentPage.route;
        if (isCurrent) { pageIdMap[unit.pageRoute ?? '/'] = pageId ?? currentPage.id; continue; }
        const existing = pages.find(p => p.route === unit.pageRoute);
        if (existing) { pageIdMap[unit.pageRoute] = existing.id; continue; }
        const newPageId = `page-${crypto.randomUUID().slice(0, 8)}`;
        pageIdMap[unit.pageRoute] = newPageId;
        send({ type: 'tool_executed', id: `page-create-${newPageId}`, name: 'add_page', input: { route: unit.pageRoute, name: unit.pageName, pageId: newPageId, _assignedPageId: newPageId }, phase: 'structure' });
      }

      // ── Phase 1: Structure (tree + variables in one LLM call) ─────────────────
      send({ type: 'build_phase', phase: 'structure', message: 'Building structure & variables...' });
      const structureStartedAt = Date.now();
      send({ type: 'agent_context', agent: 'structure', systemPrompt: buildStructureAgentPrompt().static, tools: STRUCTURE_AGENT_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: structureStartedAt });

      const imagePreFetches = new Map<string, Promise<Array<{ url: string; alt: string }>>>();
      const videoPreFetches = new Map<string, Promise<Array<{ src: string; poster: string }>>>();

      type StructureSubResult = {
        result: Awaited<ReturnType<typeof runStructureAgent>>;
        unit: BuildUnit;
        index: number;
        ctWithMedia?: CollectedTree;
      };

      const structureSubResultsSettled = await Promise.allSettled(units.map(async (unit, i): Promise<StructureSubResult> => {
        const assignedPid = pageIdMap[unit.pageRoute ?? '/'] ?? null;
        const result = await runStructureAgent(unit, assignedPid, variables, send, allExecutedTools, modelSignalCtl.signal);

        let ctWithMedia: CollectedTree | undefined;
        if (result.tree) {
          const ct = result.tree;
          const mediaManifest = extractMediaFromTree(ct.tree);
          ctWithMedia = { ...ct, mediaManifest };

            if (mediaManifest.images.length > 0) {
              const query = mediaManifest.images[0]?.searchQuery || unit.description;
            imagePreFetches.set(ct.unitName, searchUnsplashServer(query, mediaManifest.images.length + 1, externalSignalCtl.signal));
            }
            if (mediaManifest.videos.length > 0) {
              const query = mediaManifest.videos[0]?.searchQuery || unit.description;
            videoPreFetches.set(ct.unitName, searchPexelsServer(query, mediaManifest.videos.length + 1, externalSignalCtl.signal));
          }
        }

        send({ type: 'section_progress', done: i + 1, total: units.length, name: unit.name });
        return { result, unit, index: i, ctWithMedia };
      }));
      const structureSubResults: StructureSubResult[] = [];
      for (const [idx, settled] of structureSubResultsSettled.entries()) {
        if (settled.status === 'fulfilled') {
          structureSubResults.push(settled.value);
          continue;
        }
        send({
          type: 'agent_error',
          agent: 'structure',
          section: units[idx]?.name,
          message: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
        });
      }

      // Collect variable events from all structure sub-results
      const addVarEventsCollected = structureSubResults.flatMap(s => s.result.varEvents);

      const boolVarIds = addVarEventsCollected
        .filter(e => (e.input as Record<string, unknown>).type === 'boolean')
        .map(e => String((e.input as Record<string, unknown>).variableId ?? ''));

      const collectedTrees: CollectedTree[] = [];
      const allMarkers: Array<{ nodeId: string; _needsRepeat?: string | boolean; _needsRepeatKeyField?: string; _needsCondition?: string }>[] = [];

      for (const sub of structureSubResults) {
        if (sub.ctWithMedia) {
          const ct = sub.ctWithMedia;
          const isCurrentPage = !ct.pageId || ct.pageId === (pageId ?? currentPage.id);
          collectedTrees.push(ct);
          allMarkers.push(sub.result.markers);

          send({ type: 'tool_executed', id: `build-${ct.unitName}-imm-${sub.index}`, name: 'generate_structure', input: { tree: ct.tree, parentId: undefined, atIndex: ct.atIndex, _pageId: isCurrentPage ? undefined : ct.pageId, _boolVarIds: boolVarIds }, phase: 'structure' });
          allExecutedTools.push({ name: 'generate_structure', input: { tree: ct.tree } });
        }
      }

      send({ type: 'agent_complete', agent: 'structure', rounds: structureSubResults.length, toolCallCount: collectedTrees.length + addVarEventsCollected.length, duration: Date.now() - structureStartedAt, endedAt: Date.now() });

      if (collectedTrees.length === 0) {
        send({ type: 'done', tools: allExecutedTools });
        return false;
      }

      // ── Compute hints (between structure and parallel fan-out) ──────────────
      // Hints are computed from the trees BEFORE markers are stripped (they're still on the trees at this point for hint detectors)
      const nestedRepeatHint = detectNestedRepeatNodes(collectedTrees);
      const ternaryContrastHint = detectTernaryContrastNodes(collectedTrees, addVarEventsCollected.map(e => ({ name: e.name, input: e.input as Record<string, unknown> })));
      const repeatContainerHint = detectRepeatContainerPairs(collectedTrees);

      const relations = plan.relations ?? [];
      const relationsNote = relations.length > 0 ? `\n\nAlso wire these connections:\n${relations.join('\n')}` : '';
      const createdPageIds = [...new Set(collectedTrees.map(t => t.pageId).filter((id): id is string => !!id && id !== (pageId ?? currentPage.id)))];
      const pageContextNote = createdPageIds.length > 0
        ? `\n\nNOTE: switch_page(${createdPageIds[0]}) has already been called. Do NOT call switch_page again.\n\nRULES: DO NOT call get_page_tree. DO NOT call generate_structure again.`
        : '';

      // ── Build compact text tree for downstream agents ────────────────────────
      // Plain text tree summary replaces raw tool_use synthetic messages.
      // This prevents downstream agents from hallucinating generate_structure calls
      // and reduces input tokens significantly.
      function buildCompactTreeText(
        trees: CollectedTree[],
        markers: Array<{ nodeId: string; _needsRepeat?: string | boolean; _needsRepeatKeyField?: string; _needsCondition?: string }>[],
      ): string {
        const markerMap = new Map<string, { repeat?: string; condition?: string }>();
        for (const mks of markers) {
          for (const m of mks) {
            markerMap.set(m.nodeId, {
              repeat: m._needsRepeat ? `REPEAT(key=${m._needsRepeatKeyField ?? 'id'})` : undefined,
              condition: m._needsCondition ? `CONDITION(${m._needsCondition})` : undefined,
            });
          }
        }

        // Build set of node IDs inside nested repeats (depth >= 2) for inline annotation
        const nestedSet = new Set<string>();
        const walkNested = (node: Record<string, unknown>, repeatDepth: number) => {
          const hasRepeat = (typeof node.repeat === 'string' && node.repeat.length > 0) || !!node._needsRepeat || !!markerMap.get(node.id as string)?.repeat;
          const newDepth = hasRepeat ? repeatDepth + 1 : repeatDepth;
          if (newDepth >= 2 && !hasRepeat && node.id) nestedSet.add(node.id as string);
          const children = node.children as Record<string, unknown>[] | undefined;
          if (Array.isArray(children)) { for (const child of children) walkNested(child, newDepth); }
        };
        for (const ct of trees) walkNested(ct.tree, 0);

        // Infer semantic role from structure alone — no names, no hints required.
        const LEAF_TYPES = new Set(['Text', 'Icon']);
        function inferRole(
          node: Record<string, unknown>,
          kids: Record<string, unknown>[],
          parentRole: string,
          depth: number,
        ): string {
          // Structure trees use `label`; resolved SDUI uses `type` — mirror walkForTypes / walkNode.
          const nType = ((node.type ?? node.label) as string | undefined) ?? 'Box';

          // Non-Box nodes: annotate based on parent context only
          if (nType === 'Text') {
            if (parentRole === 'button' || parentRole === 'icon-button') return 'button-text';
            return '';
          }
          if (nType === 'Icon') {
            if (parentRole === 'button' || parentRole === 'icon-button') return 'button-icon';
            return '';
          }
          if (nType !== 'Box') return ''; // Image, Video, Input, etc. — type is self-describing

          if (kids.length === 0) return '';

          const childTypes = kids.map(k => ((k.type ?? k.label) as string | undefined) ?? 'Box');
          const allLeaf = childTypes.every(t => LEAF_TYPES.has(t));

          if (allLeaf) {
            // Icon-only → icon-button; anything else all-leaf → button (CTA, badge, chip, tag)
            return childTypes.length === 1 && childTypes[0] === 'Icon' ? 'icon-button' : 'button';
          }
          if (kids.length === 1 && childTypes[0] === 'Image') return 'image-wrap';
          if (kids.length === 1 && childTypes[0] === 'Video') return 'video-wrap';

          const mk = markerMap.get(node.id as string);
          if (mk?.repeat || node._needsRepeat || node.repeat) return 'list';

          if (depth === 0) return 'section';
          if (childTypes.some(t => t === 'Box')) return 'group';

          return '';
        }

        function walkNode(node: Record<string, unknown>, indent: string, parentRole = '', depth = 0): string {
          const nId = node.id as string ?? '?';
          const nType = ((node.type ?? node.label) as string | undefined) ?? 'Box';
          const nName = node.name as string ?? '';
          const nText = node.text as string ?? '';
          const nHint = node._hint as string ?? '';
          const nRepeat = typeof node.repeat === 'string' ? node.repeat : '';
          const nCondition = typeof node.condition === 'string' ? node.condition : '';
          const mk = markerMap.get(nId);
          const nested = nestedSet.has(nId) ? '(NESTED)' : '';
          const tags = [
            mk?.repeat,
            mk?.condition,
            nRepeat ? `repeat="${nRepeat}"` : '',
            nCondition ? `condition="${nCondition}"` : '',
            nested,
          ].filter(Boolean).join(' ');

          const kids = (Array.isArray(node.children) ? node.children : []) as Record<string, unknown>[];
          const role = inferRole(node, kids, parentRole, depth);
          const displayType = role ? `${nType}(${role})` : nType;

          let line = `${indent}[${nId}] ${displayType}${nName ? ` "${nName}"` : ''}${nText ? ` text="${nText}"` : ''}`;
          if (nHint) line += ` | ${nHint}`;
          // Structure-declared flex direction — layout agent must not override without reason.
          const nDir = nType === 'Box' ? String(node.direction ?? '').trim() : '';
          if (nDir) line += ` [dir:${nDir}]`;
          if (tags) line += ` — ${tags}`;

          return kids.length
            ? line + '\n' + kids.map(c => walkNode(c, indent + '  ', role, depth + 1)).join('\n')
            : line;
        }
        return trees.map(t => {
          const root = t.tree as Record<string, unknown>;
          return `=== ${t.unitName} ===\n${walkNode(root, '')}`;
        }).join('\n\n');
      }

      const compactTree = buildCompactTreeText(collectedTrees, allMarkers);

      // Build id→type map from all collected trees for the server-side capability validator.
      // This lets runHaikuAgentLoop resolve component types without accessing the Zustand store.
      const nodeTypeMap = new Map<string, string>();
      {
        const walkForTypes = (node: Record<string, unknown>) => {
          const id = node.id as string | undefined;
          // Structure trees use `label`; resolved SDUI trees use `type`. Handle both.
          const type = (node.type ?? node.label) as string | undefined;
          if (id && type) nodeTypeMap.set(id, type);
          for (const child of (Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [])) {
            walkForTypes(child);
          }
        };
        for (const ct of collectedTrees) {
          if (ct.tree) walkForTypes(ct.tree as Record<string, unknown>);
        }
      }

      // Emit switch_page for created pages (still needed for client-side execution)
      if (createdPageIds.length > 0) {
        const switchId = `auto-switch-${createdPageIds[0]}`;
        send({ type: 'tool_executed', id: switchId, name: 'switch_page', input: { pageId: createdPageIds[0] }, phase: 'styling:layout' });
        allExecutedTools.push({ name: 'switch_page', input: { pageId: createdPageIds[0] } });
      }

      send({ type: 'build_phase', phase: 'parallel', message: 'Running Styling, Binding, Workflows, Media agents in parallel...' });

      // ── Build markers summary for Binding agent ─────────────────────────────
      const flatMarkers = allMarkers.flat();
      const markersNote = flatMarkers.length > 0
        ? `\nMarkers from structure (apply these bindings):\n${flatMarkers.map(m => {
            const parts: string[] = [`  Node ${m.nodeId}:`];
            if (m._needsRepeat) parts.push(`needs set_repeat (keyField: "${m._needsRepeatKeyField ?? 'id'}") — match to an array variable from the list below`);
            if (m._needsCondition) parts.push(`set_condition(condition: "context?.item?.data?.${m._needsCondition}")`);
            return parts.join(' ');
          }).join('\n')}`
        : '';

      // ── Variable roster for downstream agents ───────────────────────────────
      const varRoster = addVarEventsCollected.length > 0
        ? `Available variables (ONLY these UUIDs are valid):\n${addVarEventsCollected.map(e => {
            const inp = e.input as Record<string, unknown>;
            const n = String(inp.name ?? '');
            const id = String(inp.variableId ?? '');
            const t = String(inp.type ?? 'string');
            let fields = '';
            if (t === 'array' && Array.isArray(inp.initialValue) && (inp.initialValue as unknown[]).length > 0) {
              const firstItem = (inp.initialValue as unknown[])[0] as Record<string, unknown>;
              const fieldDescs = Object.entries(firstItem).map(([k, v]) => {
                if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
                  return `${k}[{${Object.keys(v[0] as Record<string, unknown>).join(', ')}}]`;
                }
                return k;
              });
              fields = ` — fields: ${fieldDescs.join(', ')}`;
            }
            return `  "${n}" (${t}) → variables['${id}']${fields}`;
          }).join('\n')}`
        : `No variables were created. Do NOT reference variables['UUID'].`;

      // ── Read handlers shared by Styling and Binding ─────────────────────────
      const buildReadHandlers: Record<string, (input: Record<string, unknown>) => unknown> = {
        get_page_tree: () => ({ pageName: currentPage.name, sections: pageTreeSnapshot }),
        get_variables: () => variables,
        get_pages: () => pages,
        get_workflows: () => workflows,
        get_formula_context: () => ({ variables, collections: [] }),
        search_nodes: (inp) => {
          const q = String(inp.query ?? '').toLowerCase();
          const typeFilter = inp.nodeType ? String(inp.nodeType).toLowerCase() : undefined;
          type SN = { id?: string; type?: string; name?: string; children?: unknown[] };
          const hits: Array<{ id: string | undefined; name: string | undefined; type: string | undefined }> = [];
          const wk = (nodes: SN[]) => {
            for (const n of nodes) {
              const name = (n.name ?? '').toLowerCase();
              const type = (n.type ?? '').toLowerCase();
              const text = (String((n as Record<string, unknown>).text ?? '')).toLowerCase();
              const id = (n.id ?? '').toLowerCase();
              const matches = name.includes(q) || type.includes(q) || text.includes(q) || id.includes(q);
              const typeMatches = !typeFilter || type === typeFilter;
              if (matches && typeMatches) hits.push({ id: n.id, name: n.name, type: n.type });
              if (Array.isArray(n.children)) wk(n.children as SN[]);
            }
          };
          wk(pageTreeSnapshot as SN[]);
          return hits.length ? hits : { note: `No nodes found matching "${inp.query}"` };
        },
      };

      // ── Binding Agent ───────────────────────────────────────────────────────
      const bindingPromptParts = buildBindingAgentPrompt();
      const bindingSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: bindingPromptParts.static, cache_control: { type: 'ephemeral' } },
      ];
      const bindingMessages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content: `[Binding Agent] Connect data to all nodes. Apply set_repeat, set_text, set_condition based on the structure tree and variable data.

[Page Tree — use exact node UUIDs]
${compactTree}
${markersNote}

${varRoster}

Apply data bindings: use set_text only for formula expressions (context, variables, ternaries). Static text and inline repeat/condition visible in the tree are already applied — do not re-apply them.

Original request:
${message}`,
        },
      ];

      // ── Styling Sub-Agents (3 parallel) ────────────────────────────────────
      const stylingCtx = { pages, currentPageName: currentPage.name, currentPageRoute: currentPage.route, paletteSnapshot, mood, animationLevel, appName, description, category };

      const layoutPromptParts = buildLayoutAgentPrompt(stylingCtx);
      const layoutSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: layoutPromptParts.static, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: layoutPromptParts.dynamic },
      ];
      const layoutMessages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content: `${contextNote ? `[Context]\n${contextNote}\n\n` : ''}[Layout Agent]
The structure ALREADY EXISTS — do NOT create or modify structure. Apply layout, spacing, sizing, typography (fontSize, weight, textAlign, etc.), position offsets, and overflow. Do NOT set colors or animations — the colors agent handles those.
Use SAFE-FIRST composition by default: prioritize clean flow layout, avoid heavy absolute layering unless explicitly requested, and avoid defaulting root to viewport-forced geometry.

[Page Tree — use exact node UUIDs]
${compactTree}
${repeatContainerHint}

Original request:
${message}${relationsNote}${pageContextNote}`,
        },
      ];

      const colorsPromptParts = buildColorsAgentPrompt(stylingCtx);
      const colorsSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: colorsPromptParts.static, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: colorsPromptParts.dynamic },
      ];
      const colorsMessages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content: `${contextNote ? `[Context]\n${contextNote}\n\n` : ''}[Colors Agent]
Apply all colors, backgrounds, text colors, borders, shadows, opacity, icon color/size, and animations (enter, scroll, hover, press, loop). Apply TERNARY CONTRAST on all repeated template descendants. Do NOT set spacing, layout, or typography — the layout agent handles those.

[Page Tree — use exact node UUIDs]
${compactTree}

${varRoster}
${repeatContainerHint}${nestedRepeatHint}${ternaryContrastHint}
Repeat template reminder: style ALL children (buttons, icons, text/headings). When boolean fields exist in repeat data, apply ternary expressions for background, text color, border, shadow.

Original request:
${message}${relationsNote}${pageContextNote}`,
        },
      ];

      // ── Workflows Agent ─────────────────────────────────────────────────────
      const phaseWPromptParts = buildWorkflowsAgentPrompt({ pages, currentPageName: currentPage.name, currentPageRoute: currentPage.route, appName, description });
      const phaseWSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: phaseWPromptParts.static, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: phaseWPromptParts.dynamic },
      ];
      const phaseWPageNote = createdPageIds.length > 0
        ? `\n\nActive page: ${createdPageIds[0]} (switch_page already called).`
        : '';
      const phaseWMessages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content: `[Workflows Agent]
Create and bind all workflows needed for interactive behaviors.

[Page Tree — use exact node UUIDs]
${compactTree}

${varRoster}

Original request:
${message}${relationsNote}${phaseWPageNote}`,
        },
      ];
      const phaseWReadHandlers: Record<string, (input: Record<string, unknown>) => unknown> = {
        get_variables: () => variables,
        get_workflows: () => workflows,
      };

      // ── Media Agent (deterministic — no LLM) ───────────────────────────────
      const mediaStartedAt = Date.now();
      send({ type: 'agent_context', agent: 'media', systemPrompt: '(deterministic — icons from tree manifest, images/videos from search)', tools: ['set_icon', 'set_src'], syntheticMessageCount: 0, startedAt: mediaStartedAt });

      const mediaInjectionPromise = (async () => {
        for (const ct of collectedTrees) {
          const manifest = ct.mediaManifest;
          if (!manifest) continue;

          for (const { id: iconId, icon: iconValue } of manifest.icons) {
            const setInput = { nodeId: iconId, icon: iconValue };
            send({ type: 'tool_executed', id: `icon-${iconId}`, name: 'set_icon', input: setInput, phase: 'media' });
            allExecutedTools.push({ name: 'set_icon', input: setInput });
          }

          if (manifest.images.length > 0) {
            const images = await (imagePreFetches.get(ct.unitName) ?? Promise.resolve([]));
            if (images.length > 0) {
              manifest.images.forEach((imageNode, idx) => {
                const img = images[idx] ?? images[0];
                if (!img) return;
                const input = { nodeId: imageNode.id, src: img.url, alt: img.alt, objectFit: 'cover' };
                send({ type: 'tool_executed', id: `src-img-${imageNode.id}`, name: 'set_src', input, phase: 'media' });
                allExecutedTools.push({ name: 'set_src', input });
              });
            }
          }

          if (manifest.videos.length > 0) {
            const videos = await (videoPreFetches.get(ct.unitName) ?? Promise.resolve([]));
            if (videos.length > 0) {
              manifest.videos.forEach((videoNode, idx) => {
                const vid = videos[idx] ?? videos[0];
                if (!vid) return;
                const input = { nodeId: videoNode.id, src: vid.src, poster: vid.poster };
                send({ type: 'tool_executed', id: `src-vid-${videoNode.id}`, name: 'set_src', input, phase: 'media' });
                allExecutedTools.push({ name: 'set_src', input });
              });
            }
          }

          // CSS background-image on Box nodes (declared via bgImage in generate_structure tree)
          if (manifest.bgImages && manifest.bgImages.length > 0) {
            const firstQuery = manifest.bgImages[0].searchQuery;
            const bgImageUrls = firstQuery
              ? await searchUnsplashServer(firstQuery, manifest.bgImages.length, externalSignalCtl.signal)
              : [];
            manifest.bgImages.forEach((bgNode, idx) => {
              const img = bgImageUrls[idx] ?? bgImageUrls[0];
              if (!img) return;
              const input = { nodeId: bgNode.id, bgImage: img.url, bgSize: 'cover', bgPosition: 'center' };
              send({ type: 'tool_executed', id: `bg-img-${bgNode.id}`, name: 'set_background', input, phase: 'media' });
              allExecutedTools.push({ name: 'set_background', input });
            });
          }
        }
        send({ type: 'agent_complete', agent: 'media', rounds: 0, toolCallCount: collectedTrees.reduce((sum, ct) => sum + (ct.mediaManifest?.icons.length ?? 0) + (ct.mediaManifest?.images.length ?? 0) + (ct.mediaManifest?.videos.length ?? 0) + (ct.mediaManifest?.bgImages?.length ?? 0), 0), duration: Date.now() - mediaStartedAt, endedAt: Date.now() });
      })();

      // ── Emit agent_context for LLM agents ───────────────────────────────────
      send({ type: 'agent_context', agent: 'binding', systemPrompt: bindingPromptParts.static, tools: BINDING_AGENT_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now() });
      send({ type: 'agent_context', agent: 'styling:layout', systemPrompt: layoutPromptParts.static + '\n\n' + layoutPromptParts.dynamic, tools: LAYOUT_AGENT_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now() });
      send({ type: 'agent_context', agent: 'styling:colors', systemPrompt: colorsPromptParts.static + '\n\n' + colorsPromptParts.dynamic, tools: COLORS_AGENT_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now() });
      send({ type: 'agent_context', agent: 'workflows', systemPrompt: phaseWPromptParts.static + '\n\n' + phaseWPromptParts.dynamic, tools: PHASE_W_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now() });

      const toToolParam = (t: { name: string; description: string; input_schema: unknown }) =>
        ({ name: t.name, description: t.description, input_schema: t.input_schema as Record<string, unknown> });

      // ── Capability validator for styling/binding sub-agents ─────────────────
      // Resolves component type from the nodeTypeMap built above and checks against
      // the component capability registry. Blocked calls are returned as real errors
      // to the model (instead of the usual ok:true/pending response) for self-correction.
      const capabilityValidator = (toolName: string, args: Record<string, unknown>): string | null => {
        const group = TOOL_CAPABILITY_GROUP[toolName];
        if (!group) return null; // tool has no capability constraint
        const nodeId = args.nodeId as string | undefined;
        if (!nodeId) return null;
        const nodeType = nodeTypeMap.get(nodeId);
        if (!nodeType) return null;
        const caps = getCapabilities(nodeType);
        if (caps === null) return null; // unknown type → no restriction
        if (caps.includes(group)) return null; // allowed
        const suggestion = buildBlockedGroupSuggestion(group, nodeType);
        return `"${group}" tools are not supported on ${nodeType}. ${suggestion} ${buildCapabilityNote(nodeType)}`;
      };

      // ── Launch agents in parallel (conditionally based on plan flags) ────────
      const shouldStyle    = plan.needsStyling   !== false;
      const shouldBind     = plan.needsBinding   !== false;
      const shouldWorkflow = plan.needsWorkflows !== false;

      const agentRuns: Array<{ agent: string; promise: Promise<void> }> = [
        ...(shouldBind ? [{ agent: 'binding', promise: runHaikuAgentLoop(bindingMessages, bindingSystemBlocks, BINDING_AGENT_TOOLS.map(toToolParam), {}, send, allExecutedTools, 10, 'binding', modelSignalCtl.signal, capabilityValidator) }] : []),
        ...(shouldStyle ? [{ agent: 'styling:layout', promise: runHaikuAgentLoop(layoutMessages, layoutSystemBlocks, LAYOUT_AGENT_TOOLS.map(toToolParam), buildReadHandlers, send, allExecutedTools, 10, 'styling:layout', modelSignalCtl.signal, capabilityValidator) }] : []),
        ...(shouldStyle ? [{ agent: 'styling:colors', promise: runHaikuAgentLoop(colorsMessages, colorsSystemBlocks, COLORS_AGENT_TOOLS.map(toToolParam), buildReadHandlers, send, allExecutedTools, 10, 'styling:colors', modelSignalCtl.signal, capabilityValidator) }] : []),
        ...(shouldWorkflow ? [{ agent: 'workflows', promise: runHaikuAgentLoop(phaseWMessages, phaseWSystemBlocks, PHASE_W_TOOLS.map(toToolParam), phaseWReadHandlers, send, allExecutedTools, 15, 'workflows', modelSignalCtl.signal) }] : []),
        { agent: 'media', promise: mediaInjectionPromise },
      ];
      const settledAgents = await Promise.allSettled(agentRuns.map(a => a.promise));
      settledAgents.forEach((res, idx) => {
        if (res.status === 'fulfilled') return;
        send({
          type: 'agent_error',
          agent: agentRuns[idx]?.agent,
          message: res.reason instanceof Error ? res.reason.message : String(res.reason),
        });
      });

      send({ type: 'done', tools: allExecutedTools });
      return false;
    }

    // ── Focused edit loop (used by mixed mode for edit phase) ────────────────
    async function runEditLoop(editMsgs: Anthropic.Messages.MessageParam[]): Promise<void> {
      let editRounds = 0;
      while (editRounds < MAX_TOOL_ROUNDS) {
        editRounds++;
        send({ type: 'round_start', round: editRounds });
        const editResp = client.messages.stream({
          model: modelId, max_tokens: 4096,
          system: [
            { type: 'text', text: mainPromptParts.static, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: mainPromptParts.dynamic },
          ],
          tools: ALL_BUILDER_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
          messages: editMsgs,
        } as unknown as Parameters<typeof client.messages.stream>[0], { signal: modelSignalCtl.signal });
        const editToolBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
        let editStop = '';
        let editToolBlock: { id: string; name: string; inputJson: string } | null = null;
        for await (const ev of editResp) {
          if (ev.type === 'content_block_start' && (ev.content_block as { type: string }).type === 'tool_use') {
            const tb = ev.content_block as { id: string; name: string };
            editToolBlock = { id: tb.id, name: tb.name, inputJson: '' };
          } else if (ev.type === 'content_block_delta') {
            const dt = (ev.delta as { type: string }).type;
            if (dt === 'text_delta') send({ type: 'text_delta', content: (ev.delta as { text: string }).text });
            else if (dt === 'input_json_delta' && editToolBlock) editToolBlock.inputJson += (ev.delta as { partial_json: string }).partial_json;
          } else if (ev.type === 'content_block_stop' && editToolBlock) {
            const parsed = parseStreamedToolInput(editToolBlock.inputJson);
            editToolBlocks.push({ id: editToolBlock.id, name: editToolBlock.name, input: parsed.input });
            editToolBlock = null;
          } else if (ev.type === 'message_delta') {
            editStop = (ev.delta as { stop_reason?: string }).stop_reason ?? '';
          }
        }
        const editFinal = await editResp.finalMessage();
        editStop = editFinal.stop_reason ?? editStop;
        {
          const streamedIds = new Set(editToolBlocks.map(t => t.id));
          for (const block of editFinal.content) {
            if (block.type !== 'tool_use') continue;
            const tb = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
            if (!streamedIds.has(tb.id)) {
              editToolBlocks.push({ id: tb.id, name: tb.name, input: tb.input ?? {} });
            }
          }
        }
        editMsgs.push({ role: 'assistant', content: editFinal.content });
        if (editToolBlocks.length === 0) break;
        const editResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = [];
        for (const t of editToolBlocks) {
          const ri = t.input;
          if (ri.__parseError === true) {
            editResultBlocks.push({
              type: 'tool_result',
              tool_use_id: t.id,
              content: JSON.stringify({ success: false, error: 'Malformed tool JSON input. Re-emit the tool call with valid JSON.' }),
              is_error: true,
            });
            continue;
          }
          let tr = JSON.stringify({ ok: true, pending: 'client_execution' });
          if (t.name === 'get_page_tree') tr = JSON.stringify({ pageName: currentPage.name, sections: pageTreeSnapshot });
          else if (t.name === 'get_pages') tr = JSON.stringify(pages);
          else if (t.name === 'get_variables') tr = JSON.stringify(variables);
          else if (t.name === 'get_workflows') tr = JSON.stringify(workflows);
          else if (t.name === 'search_nodes') {
            const q = String(ri.query ?? '').toLowerCase();
            type SN = { id?: string; type?: string; name?: string; children?: unknown[] };
            const hits: Array<{ id: string | undefined; name: string | undefined; type: string | undefined; breadcrumb: string }> = [];
            const wk = (nodes: SN[], bc: string[]) => { for (const n of nodes) { const c = [...bc, n.name ?? n.type ?? 'Node']; if ((n.name ?? '').toLowerCase().includes(q) || (n.type ?? '').toLowerCase().includes(q)) hits.push({ id: n.id, name: n.name, type: n.type, breadcrumb: c.join(' > ') }); if (Array.isArray(n.children)) wk(n.children as SN[], c); } };
            wk(pageTreeSnapshot as SN[], []);
            tr = JSON.stringify(hits.length ? hits : { note: `No nodes found matching "${ri.query}"` });
          } else if (t.name === 'generate_structure') {
            const resolved = assignTreeIds(ri.tree as Record<string, unknown>);
            const ci = { tree: resolved, parentId: ri.parentId, atIndex: ri.atIndex };
            send({ type: 'tool_executed', id: t.id, name: t.name, input: ci });
            allExecutedTools.push({ name: t.name, input: ci });
            tr = JSON.stringify({ success: true, data: { tree: resolved, message: 'Structure created. Read the id field from each node in the returned tree to get its server-assigned UUID.' } });
            editResultBlocks.push({ type: 'tool_result', tool_use_id: t.id, content: tr });
            continue;
          }
          send({ type: 'tool_executed', id: t.id, name: t.name, input: ri });
          allExecutedTools.push({ name: t.name, input: ri });
          editResultBlocks.push({ type: 'tool_result', tool_use_id: t.id, content: tr });
        }
        editMsgs.push({ role: 'user', content: editResultBlocks });
        if (editStop !== 'tool_use' && editStop !== 'max_tokens') break;
      }
    }

    // Pre-compute Phase 3 prompt parts once — static block is identical every round so
    // Anthropic can serve it from cache; only the dynamic block (palette + project + page) is fresh.
    const phase3PromptParts = buildPhase3SystemPrompt({
      pages,
      currentPageName: currentPage.name,
      currentPageRoute: currentPage.route,
      paletteSnapshot,
      mood,
      animationLevel,
      appName,
      description,
      category,
    });


    try {
      // ── Phase 0: classify for build / mixed mode ──────────────────────────
      if (mightBeBuildRequest) {
        send({ type: 'build_phase', phase: 'planning', message: 'Planning your request...' });
        const plan = await classifyRequest(message, pages, modelId, currentPage.route, modelSignalCtl.signal);
        send({
          type: 'tool_executed',
          id: 'classify-request',
          name: 'classify_request',
          input: { message },
          result: plan,
          phase: 'planning',
        });

        if (plan.mode === 'build' || plan.mode === 'mixed') {
          const needsWiring = await runBuildOrMixedMode(plan);
          if (!needsWiring) return; // done — no wiring phase needed
          // needsWiring=true: currentMessages set for wiring, fall through to standard loop
        }
        // mode === 'edit' falls through to the standard loop
      }

      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++;

        // Tell the client a new Anthropic call is starting (shows "Planning…" between rounds)
        send({ type: 'round_start', round: rounds });

        // Create streaming request to Anthropic using the stream helper (has finalMessage())
        // Phase 3 (post-build styling) uses haiku with a focused prompt + filtered tools.
        // inPhase3Mode persists across all rounds so rounds 2+ don't revert to full prompt/tools.
        const isPhase3 = inPhase3Mode;
        const activeModel = isPhase3 ? 'claude-haiku-4-5' : modelId;
        const activeSupportsThinking = supportsThinking && activeModel === modelId;
        // Phase 3 gets only styling tools — structure tools are architecturally excluded
        const activeTools = isPhase3 ? PHASE3_BUILDER_TOOLS : ALL_BUILDER_TOOLS;
        // Build system blocks: Phase 3 uses two-block split (static cached + dynamic fresh);
        // main edit mode uses the full prompt in one cached block.
        const activeSystemBlocks: Anthropic.Messages.TextBlockParam[] = isPhase3
          ? [
              { type: 'text', text: phase3PromptParts.static, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: phase3PromptParts.dynamic },
            ]
          : [
              { type: 'text', text: mainPromptParts.static, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: mainPromptParts.dynamic },
            ];
        const response = client.messages.stream({
          model: activeModel,
          // Thinking models need a higher token budget (thinking uses tokens too)
          max_tokens: 16000,
          system: activeSystemBlocks,
          ...(activeSupportsThinking ? { thinking: { type: 'enabled', budget_tokens: 8000 } } : {}),
          tools: activeTools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          })),
          messages: currentMessages,
        } as unknown as Parameters<typeof client.messages.stream>[0], { signal: modelSignalCtl.signal });

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
              const parsed = parseStreamedToolInput(currentToolBlock.inputJson);
              toolUseBlocks.push({
                id: currentToolBlock.id,
                name: currentToolBlock.name,
                input: parsed.input,
              });
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

        // Reconcile streamed toolUseBlocks with finalMessage.content.
        // When max_tokens is hit mid-response, the last tool_use block may not receive a
        // content_block_stop event, so it ends up in finalMessage.content but not in
        // toolUseBlocks. Without this reconciliation, the assistant message has an orphaned
        // tool_use block with no corresponding tool_result → Anthropic 400 on the next round.
        {
          const streamedIds = new Set(toolUseBlocks.map(t => t.id));
          for (const block of finalMessage.content) {
            if (block.type !== 'tool_use') continue;
            const tb = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
            if (!streamedIds.has(tb.id)) {
              toolUseBlocks.push({ id: tb.id, name: tb.name, input: tb.input ?? {} });
            }
          }
        }

        // Add assistant response to message history for continuation
        currentMessages.push({
          role: 'assistant',
          content: finalMessage.content,
        });

        // If tool calls were made, send them to the client for execution
        if (toolUseBlocks.length > 0) {
          const toolResultsForNextRound: Anthropic.Messages.ToolResultBlockParam[] = [];

          for (const tool of toolUseBlocks) {
            if (tool.input.__parseError === true) {
              toolResultsForNextRound.push({
                type: 'tool_result',
                tool_use_id: tool.id,
                content: JSON.stringify({ success: false, error: 'Malformed tool JSON input. Re-emit this tool call with valid JSON.' }),
                is_error: true,
              });
              continue;
            }
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
                    `Use variables['${assignedVarId}'] in all tools (set_text, conditions, formulas). ` +
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
                const assignedPageId = `page-${crypto.randomUUID().slice(0, 8)}`;
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
            } else if (tool.name === 'generate_structure') {
              // Server assigns UUIDs to every node in the tree, returns name→id map to Claude.
              // Client receives the resolved tree (with real UUIDs) via tool_executed and
              // materializes each node through getTemplate(label) + AI prop merge.
              const treeInput = rawInput.tree as Record<string, unknown> | undefined | null;
              const parentId = rawInput.parentId as string | undefined;
              const atIndex = rawInput.atIndex as number | undefined;
              if (!treeInput || typeof treeInput !== 'object') {
                toolResult = JSON.stringify({ success: false, error: 'generate_structure requires a "tree" object. Provide the full nested UI tree under the "tree" key.' });
              } else {
                const resolvedTree = assignTreeIds(treeInput);
                clientInput = { tree: resolvedTree, parentId, atIndex };
                toolResult = JSON.stringify({
                  success: true,
                  data: {
                    tree: resolvedTree,
                    message: 'Structure created. Read the id field from each node in the returned tree to get its server-assigned UUID.',
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
                // Variables and data sources are already in the system prompt contextNote.
                // This handler only computes the repeat context, which depends on which
                // specific node is selected and cannot be pre-injected into the system prompt.
                const targetNodeId = (rawInput as Record<string, unknown>).nodeId as string | undefined;

                function findAncestors(nodes: unknown[], id: string, path: unknown[] = []): unknown[] | null {
                  for (const n of nodes as Record<string, unknown>[]) {
                    if (n.id === id) return path;
                    const kids = n.children as unknown[] | undefined;
                    if (Array.isArray(kids)) {
                      const hit = findAncestors(kids, id, [...path, n]);
                      if (hit !== null) return hit;
                    }
                  }
                  return null;
                }

                let repeatContext = null;
                if (targetNodeId) {
                  const ancestors = findAncestors(pageTreeSnapshot, targetNodeId) ?? [];
                  const mapAncestors = (ancestors as Record<string, unknown>[])
                    .filter(a => a.map)
                    .reverse(); // innermost first
                  if (mapAncestors.length > 0) {
                    repeatContext = mapAncestors.map((a, i) => ({
                      level: i === 0 ? 'current' : 'parent',
                      mapPath: a.map,
                      accessPath: i === 0 ? 'context.item.data.*' : 'context.item.parent.data.*',
                    }));
                  }
                }

                toolResult = JSON.stringify({
                  note: 'Variables and data sources are already in your context. Only repeat context is returned here.',
                  repeatContext,
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
                  const r = await fetch(`https://api.unsplash.com/search/photos?query=${q}&per_page=${count}&client_id=${apiKey}`, { signal: externalSignalCtl.signal });
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
                  const r = await fetch(url, { headers: { Authorization: apiKey }, next: { revalidate: 300 }, signal: externalSignalCtl.signal });
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
                const r = await fetch(`https://api.iconify.design/search?query=${q}&limit=${count}${prefix}`, { signal: externalSignalCtl.signal });
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
          if (stopReason === 'tool_use' || stopReason === 'max_tokens') {
            continue; // next round
          }
        }

        break;
      }

      // Send final done event
      send({ type: 'done', tools: allExecutedTools });
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
