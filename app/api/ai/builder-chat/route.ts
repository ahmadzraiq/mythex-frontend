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
import { ALL_BUILDER_TOOLS, PHASE_W_TOOLS, BINDING_AGENT_TOOLS, STYLING_AGENT_TOOLS, ANIMATION_AGENT_TOOLS, MEDIA_AGENT_TOOLS, DATA_AGENT_TOOLS, SC_AGENT_TOOLS, BACKEND_AGENT_TOOLS } from '@/lib/ai/builder-tools';
import { buildBindingAgentPrompt, buildWorkflowsAgentPrompt, buildStylingAgentPrompt, buildAnimationAgentPrompt, buildMediaAgentPrompt, buildDataAgentPrompt } from '@/lib/ai/agents';
import type { CollectedTree, ToolEvent, Marker } from '@/lib/ai/tools/process-structure-tree';
import { buildSharedComponentAgentPrompt } from '@/lib/ai/agents/sharedComponents/prompt';
import { buildBackendAgentPrompt } from '@/lib/ai/agents/backend/prompt';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Feature flags ─────────────────────────────────────────────────────────────
// Set to false to skip that agent entirely during parallel build.
const ANIMATION_AGENT_ENABLED = true;

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
  /** Machine-readable layout pattern key emitted by the classify agent when a specific tree shape is required. */
  structureHint?: 'layered-absolute' | 'grid' | 'flex-row';
  /** Aggregated briefings from all specialist agents (styling, animation, binding, media) for this section.
   *  Passed to the structure agent so it builds a DOM that every specialist can work with upfront. */
  agentContext?: string;
}


// CollectedTree, ToolEvent, Marker are imported from @/lib/ai/tools/process-structure-tree

// ── Server-side UUID assignment for generate_structure ───────────────────────
// Keep AI pre-assigned UUIDs when valid; generate only for missing/invalid ones;
// deduplicate across the whole tree (second occurrence of the same UUID gets a fresh one).

const TREE_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function normalizeWorkflowId(raw: string, wfIdMap: Map<string, string>): string {
  if (TREE_UUID_RE.test(raw)) return raw;
  if (!wfIdMap.has(raw)) wfIdMap.set(raw, crypto.randomUUID());
  return wfIdMap.get(raw)!;
}

function assignTreeIds(
  node: Record<string, unknown>,
  seen: Set<string> = new Set(),
  wfIdMap: Map<string, string> = new Map(),
): Record<string, unknown> {
  const raw = typeof node.id === 'string' ? node.id : '';
  const id = TREE_UUID_RE.test(raw) && !seen.has(raw) ? raw : crypto.randomUUID();
  seen.add(id);

  // Normalize workflowId in actions so malformed AI-generated IDs become valid hex UUIDs
  if (Array.isArray(node.actions)) {
    (node.actions as Array<Record<string, unknown>>).forEach(act => {
      const wfRaw = typeof act.workflowId === 'string' ? act.workflowId : '';
      if (wfRaw) act.workflowId = normalizeWorkflowId(wfRaw, wfIdMap);
    });
  }

  const children = Array.isArray(node.children)
    ? (node.children as Record<string, unknown>[]).map(c => assignTreeIds(c, seen, wfIdMap))
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
  return result;
}

/** Strip loop/showIf marker fields from a tree before sending to client.
 *  Returns the markers extracted from the tree for use by hint detectors and downstream agents via the compact tree.
 *  All annotations are pure hints for AI agents — none are consumed by client-side code. */
function extractAndStripMarkers(tree: Record<string, unknown>): Array<{
  nodeId: string;
  loop?: string | boolean;
  loopKey?: string;
  showIf?: string;
}> {
  const markers: Array<{
    nodeId: string;
    loop?: string | boolean;
    loopKey?: string;
    showIf?: string;
  }> = [];
  const walk = (node: Record<string, unknown>) => {
    const loop = node.loop;
    const loopKey = node.loopKey;
    const showIf = node.showIf;
    delete node.loop;
    delete node.loopKey;
    delete node.showIf;
    // Strip direction from the resolved tree (styling agent decides layout independently)
    delete node.direction;

    if (loop || showIf) {
      markers.push({
        nodeId: node.id as string,
        loop: loop as string | boolean | undefined,
        loopKey: loopKey as string | undefined,
        showIf: showIf as string | undefined,
      });
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
  const innerTemplateIds: string[] = [];
  const walk = (node: Record<string, unknown>, repeatDepth: number, outerRepeatPath: string | null) => {
    const hasRepeat = (typeof node.repeat === 'string' && node.repeat.length > 0) || !!node.loop;
    const newDepth = hasRepeat ? repeatDepth + 1 : repeatDepth;
    const repeatPath = (node.repeat as string) ?? '';
    const newOuterPath = hasRepeat && repeatDepth >= 1 ? repeatPath : outerRepeatPath;
    if (newDepth >= 2 && !hasRepeat) {
      innerNodeIds.push(node.id as string);
    }
    if (hasRepeat && repeatDepth >= 1) {
      innerTemplateIds.push(node.id as string);
    }
    const children = node.children as Record<string, unknown>[] | undefined;
    if (Array.isArray(children)) {
      for (const child of children) walk(child, newDepth, newOuterPath);
    }
  };
  for (const ct of trees) walk(ct.tree, 0, null);
  // Nodes annotated [nested] in the compact tree are inside an inner repeat.
  // context?.item?.data is the inner item; use context?.item?.parent?.data for outer fields.
  if (innerNodeIds.length === 0 && innerTemplateIds.length === 0) return '';
  const parts: string[] = [];
  if (innerNodeIds.length > 0) parts.push(`[nested] nodes (${innerNodeIds.join(', ')}): context?.item?.parent?.data?.FIELD = outer item field.`);
  if (innerTemplateIds.length > 0) parts.push(`Inner repeat templates (${innerTemplateIds.join(', ')}): context?.item?.data?.FIELD per sub-item.`);
  return '\n' + parts.join('\n');
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
    const markerRepeat = node.loop;
    const hasRepeat = (typeof inlineRepeat === 'string' && inlineRepeat.length > 0) || !!markerRepeat;
    if (hasRepeat) {
      // Resolve array data: inline repeat has UUID in path, boolean marker matches any array variable with boolean fields
      let arrData: unknown[] | undefined;
      if (typeof inlineRepeat === 'string') {
        const varIdMatch = inlineRepeat.match(/variables\['([^']+)'\]/);
        const varId = varIdMatch ? varIdMatch[1] : inlineRepeat;
        arrData = arrayVarData.get(varId);
        } else {
        // Boolean loop marker: find first array variable that has boolean fields
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
              const hasInnerRepeat = (typeof child.repeat === 'string' && (child.repeat as string).length > 0) || !!child.loop;
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

// ── Server-side media search helpers (Tier 0 pre-fetch) ──────────────────────

// Random page offset (1–4) so repeated runs with identical queries get different photos/videos.
function randPage(max = 4): number { return Math.ceil(Math.random() * max); }

async function searchUnsplashServer(query: string, count = 5, signal?: AbortSignal): Promise<Array<{ url: string; alt: string }>> {
  try {
    const apiKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!apiKey || !query) return [];
    const page = randPage(4);
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&page=${page}&client_id=${apiKey}`, { signal });
    if (!r.ok) return [];
    const d = await r.json() as { results?: Array<{ urls: { regular: string }; alt_description: string }> };
    return (d.results ?? []).map(p => ({ url: p.urls.regular, alt: p.alt_description ?? '' }));
  } catch { return []; }
}

async function searchPexelsServer(query: string, count = 4, signal?: AbortSignal): Promise<Array<{ src: string; poster: string }>> {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) return [];
    if (!query) return [];
    const q = encodeURIComponent(query);
    const page = randPage(3);
    const r = await fetch(`https://api.pexels.com/videos/search?query=${q}&page=${page}&per_page=${count}`, { headers: { Authorization: apiKey }, signal });
    if (!r.ok) return [];
    const d = await r.json() as { videos?: Array<{ image: string; video_files: Array<{ quality: string; link: string }> }> };
    return (d.videos ?? []).map(v => {
      // Prefer hd (1280x720) over sd (640x360) so background videos aren't tiny/blurry.
      const file = v.video_files.find(f => f.quality === 'hd') ?? v.video_files.find(f => f.quality === 'sd') ?? v.video_files[0];
      return { src: file?.link ?? '', poster: v.image };
    }).filter(v => v.src);
  } catch { return []; }
}

async function searchPexelsPhotosServer(query: string, count = 5, signal?: AbortSignal): Promise<Array<{ url: string; alt: string }>> {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey || !query) return [];
    const q = encodeURIComponent(query);
    const page = randPage(4);
    const r = await fetch(`https://api.pexels.com/v1/search?query=${q}&page=${page}&per_page=${count}`, { headers: { Authorization: apiKey }, signal });
    if (!r.ok) return [];
    const d = await r.json() as { photos?: Array<{ src: { large: string }; alt: string }> };
    return (d.photos ?? []).map(p => ({ url: p.src.large, alt: p.alt ?? '' }));
  } catch { return []; }
}

/** Walk the resolved tree, extract icon/searchQuery/bgImage media hints from Phase 2, strip them from tree.
 *  Returns a manifest of media nodes to process server-side.
 *  Tree is modified in place — icon/searchQuery/bgImage fields are removed so they don't reach the client.
 */
function extractMediaFromTree(
  tree: Record<string, unknown>,
  // IDs of nodes that are loop templates — extracted from `ct.markers` after
  // `extractAndStripMarkers` processes the tree. When the AI correctly sets
  // `loop: true`, those node IDs land here so their children are treated as
  // inside a repeat even though the tree has been stripped of the `loop` prop.
  loopNodeIds: ReadonlySet<string> = new Set(),
): {
  icons: Array<{ id: string; icon: string; name?: string }>;
  images: Array<{ id: string; searchQuery: string; name?: string }>;
  videos: Array<{ id: string; searchQuery: string; name?: string }>;
  bgImages: Array<{ id: string; searchQuery: string; name?: string }>;
} {
  const manifest = {
    icons: [] as Array<{ id: string; icon: string; name?: string }>,
    images: [] as Array<{ id: string; searchQuery: string; name?: string }>,
    videos: [] as Array<{ id: string; searchQuery: string; name?: string }>,
    bgImages: [] as Array<{ id: string; searchQuery: string; name?: string }>,
  };

  const walk = (node: Record<string, unknown>, insideRepeat = false) => {
    const label = String(node.label ?? '').toLowerCase();
    const id = node.id as string | undefined;
    const nodeName = node.name as string | undefined;
    // Track repeat context — Images/Videos inside a repeat subtree get their src
    // from binding agent formula expressions, not from the media agent.
    // Also treat nodes whose IDs appear in the markers loop set as loop templates
    // (their `loop: true` was stripped by extractAndStripMarkers before this runs).
    const isLoopTemplate = !!(id && loopNodeIds.has(id));
    const nowInsideRepeat = insideRepeat || !!node.repeat || !!node.loop || isLoopTemplate;

    if (id) {
      if (label === 'icon') {
        const icon = node.icon as string | undefined;
        if (icon) {
          if (!insideRepeat) {
            manifest.icons.push({ id, icon, name: nodeName });
          }
          delete node.icon; // always strip — not an SDUI prop
        }
      } else if (label === 'image') {
        const searchQuery = node.searchQuery as string | undefined;
        delete node.searchQuery; // strip
        if (!insideRepeat && searchQuery) {
          // Only add to manifest when NOT inside a repeat AND a searchQuery was provided.
          // The structure prompt instructs the AI to omit searchQuery on loop-template images
          // (those use per-item avatar/videoSrc fields in initialValue instead).
          // Skipping images without a searchQuery ensures the media agent never overwrites
          // the formula binding the binding agent applies for repeat-template images.
          manifest.images.push({ id, searchQuery, name: nodeName });
        }
      } else if (label === 'video') {
        const searchQuery = node.searchQuery as string | undefined;
        delete node.searchQuery; // strip
        if (!insideRepeat && searchQuery) {
          // Same guard as images — loop-template videos carry no searchQuery.
          manifest.videos.push({ id, searchQuery, name: nodeName });
        }
      }
      // Box with bgImage — CSS background-image set via set_background by media agent.
      // Skip gradient strings — the executor already applies them as inline style;
      // trying to photo-search a gradient expression would produce garbage results.
      // Also skip search queries that mention "gradient" — these describe a desired
      // visual effect (e.g. "gradient background abstract modern"), not a real photo.
      // The structure agent should never set bgImage on gradient-only sections, but
      // if it does, this filter prevents the media agent from overwriting the gradient
      // with a stock photo.
      if (node.bgImage) {
        const bgImageQuery = node.bgImage as string;
        delete node.bgImage; // strip — media agent handles the URL lookup
        const isGradientCss = /^(linear|radial|conic)-gradient/i.test(bgImageQuery.trim());
        const isGradientQuery = /\bgradient\b/i.test(bgImageQuery);
        if (id && !isGradientCss && !isGradientQuery) {
          manifest.bgImages.push({ id, searchQuery: bgImageQuery, name: nodeName });
        }
      }
    }

    // Strip icon/searchQuery/bgImage from any node type (defensive cleanup)
    if ('icon' in node && label !== 'icon') delete node.icon;
    if ('searchQuery' in node) delete node.searchQuery;
    if ('bgImage' in node) delete node.bgImage;

    for (const child of (Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [])) {
      walk(child, nowInsideRepeat);
    }
  };

  walk(tree);
  return manifest;
}

// ── Richer client-side tool echo ──────────────────────────────────────────────

function buildRegisteredEcho(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = { ok: true, pending: 'client_execution' };
  switch (toolName) {
    case 'add_workflow_step':
      return { ...base, registered: { workflowId: input.workflowId ?? input.workflowName, stepId: input.stepId, type: input.type, parentStepId: input.parentStepId ?? null, branchKey: input.branchKey ?? null } };
    case 'update_workflow_steps':
      return { ...base, registered: { workflowName: input.workflowName, stepCount: Array.isArray(input.steps) ? (input.steps as unknown[]).length : '?', stepTypes: Array.isArray(input.steps) ? (input.steps as Array<{ type?: string }>).map(s => s.type ?? '?') : [] } };
    case 'set_style':
      return { ...base, registered: { nodeId: input.id ?? input.nodeId, appliedProperties: Object.keys((input.style as Record<string, unknown>) ?? {}) } };
    case 'set_text':
      return { ...base, registered: { nodeId: input.id ?? input.nodeId, formula: input.formula ?? input.text } };
    case 'set_condition':
      return { ...base, registered: { nodeId: input.id ?? input.nodeId, condition: input.condition } };
    case 'set_repeat':
      return { ...base, registered: { nodeId: input.id ?? input.nodeId, dataPath: input.dataPath ?? input.mapPath } };
    case 'set_animation':
      return { ...base, registered: { nodeId: input.id ?? input.nodeId, trigger: input.trigger, effect: input.effect } };
    case 'set_component_props':
      return { ...base, registered: { nodeId: input.id ?? input.nodeId, appliedProps: Object.keys((input.props as Record<string, unknown>) ?? {}) } };
    default:
      return base;
  }
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
  _capabilityValidator?: unknown,
  modelId?: string,
  _schemaValidator?: unknown,
  /**
   * Multi-page support: maps node UUID → owning pageId. When the agent emits a write tool for
   * a node living on a non-focused page, we tag the input with `_pageId` so the client executor
   * can switch focus before applying the mutation. Without this, every cross-page write fails
   * with "Node not found on the current page".
   */
  nodeIdToPageMap?: Map<string, string>,
  /**
   * When set, forces this tool_choice on the FIRST round only. Use `{ type: 'any' }` for agents
   * that must call at least one tool (e.g. animation) — prevents the model from returning with
   * 0 tool calls when it decides the task is optional.
   */
  toolChoice?: { type: 'auto' | 'any' | 'tool'; name?: string },
  /**
   * Optional server-side validators keyed by tool name. When a client-side tool call arrives,
   * the validator runs before returning `{ ok: true, pending: 'client_execution' }`. If the
   * validator returns a non-null string, that error is sent back to Claude as `is_error: true`
   * so the model can self-correct without being blind to client-side failures.
   */
  serverSideValidators?: Record<string, (input: Record<string, unknown>) => string | null>,
  /** Optional accumulator — populated with token counts from each Anthropic API call */
  tokenAccumulator?: { inputTokens: number; outputTokens: number },
): Promise<void> {
  const startedAt = Date.now();
  let localToolCount = 0;
  let currentMessages = [...messages];
  let rounds = 0;

  // Tag a tool input with the owning page when the referenced node lives on a non-focused page.
  // Returns the same object unchanged when no remap is needed (no map, no nodeId/parentId, or
  // the input already carries _pageId — e.g. generate_structure already sets it explicitly).
  const enrichInputWithPageId = (input: Record<string, unknown>): Record<string, unknown> => {
    if (!nodeIdToPageMap || !input || typeof input !== 'object') return input;
    if (input._pageId !== undefined) return input;
    const refId = (input.nodeId ?? input.parentId) as unknown;
    if (typeof refId !== 'string') return input;
    const pageId = nodeIdToPageMap.get(refId);
    if (!pageId) return input;
    return { ...input, _pageId: pageId };
  };
  // Build allowed tool set — any tool name NOT in this set gets an error back to the LLM
  const allowedTools = new Set([
    ...tools.map(t => t.name),
    ...Object.keys(readToolHandlers),
    'search_icons',
    'search_images',
    'search_videos',
  ]);

  const resolvedLoopModel = (modelId && VALID_MODELS.has(modelId)) ? modelId : 'claude-haiku-4-5';
  const loopSupportsThinking = THINKING_MODELS.has(resolvedLoopModel);
  let lastStopReason = '';

  try {
  while (rounds < maxRounds) {
    rounds++;

    const response = client.messages.stream({
      model: resolvedLoopModel,
      max_tokens: loopSupportsThinking ? 32768 : 16384,
      ...(loopSupportsThinking ? { temperature: 1, thinking: { type: 'enabled', budget_tokens: 8192 } } : {}),
      system: systemBlocks,
      tools,
      messages: currentMessages,
      ...(toolChoice && rounds === 1 ? { tool_choice: toolChoice } : {}),
    } as unknown as Parameters<typeof client.messages.stream>[0], signal ? { signal } : undefined);

    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    // Track tool IDs emitted during streaming so the post-stream loop doesn't double-emit.
    const streamEmittedIds = new Set<string>();
    // Track tools that failed server-side validation during streaming.
    // These are NOT emitted as tool_executed — the client never runs them.
    // The post-stream loop converts these to is_error results so the AI self-corrects.
    const streamValidationErrors = new Map<string, string>(); // tool.id → error message
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
        // Only emit for known, non-read tools — unknown tools are rejected in the results loop.
        // Read tools are surfaced to the client so the Cursor-style activity feed can show
        // them as they happen.
        const isReadTool = !!readToolHandlers[toolBlock.name];
        if (isReadTool && allowedTools.has(toolBlock.name)) {
          const enriched = enrichInputWithPageId(toolBlock.input);
          send({ type: 'tool_executed', id: toolBlock.id, name: toolBlock.name, input: enriched, phase });
          allExecutedTools.push({ name: toolBlock.name, input: enriched });
          localToolCount++;
        }
        if (!isReadTool && allowedTools.has(toolBlock.name)) {
          // Run server-side validator BEFORE emitting. If it fails, defer the error
          // without emitting tool_executed — the client never receives or executes the call,
          // so aiBlind cannot be set for validator-catchable mistakes.
          const ssValidator = serverSideValidators?.[toolBlock.name];
          const ssError = ssValidator ? ssValidator(toolBlock.input as Record<string, unknown>) : null;
          if (ssError) {
            streamValidationErrors.set(toolBlock.id, ssError);
          } else {
            const enriched = enrichInputWithPageId(toolBlock.input);
            streamEmittedIds.add(toolBlock.id);
            send({ type: 'tool_executed', id: toolBlock.id, name: toolBlock.name, input: enriched, phase });
            allExecutedTools.push({ name: toolBlock.name, input: enriched });
            localToolCount++;
          }
        }
        currentToolBlock = null;
      } else if (event.type === 'message_delta') {
        stopReason = (event.delta as { stop_reason?: string }).stop_reason ?? '';
      }
    }

    const finalMessage = await response.finalMessage();
    stopReason = finalMessage.stop_reason ?? stopReason;

    // Report token usage via the send callback so the outer POST handler can accumulate
    if (finalMessage.usage) {
      send({
        type: '_internal_token_usage',
        inputTokens: finalMessage.usage.input_tokens ?? 0,
        outputTokens: finalMessage.usage.output_tokens ?? 0,
      });
      if (tokenAccumulator) {
        tokenAccumulator.inputTokens += finalMessage.usage.input_tokens ?? 0;
        tokenAccumulator.outputTokens += finalMessage.usage.output_tokens ?? 0;
      }
    }

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
    lastStopReason = stopReason;
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
          // search_icons is a read tool — return data to AI without emitting tool_executed
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(d.icons ?? []) });
        } catch {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify({ success: false, error: 'search_icons failed (network/timeout).' }),
            is_error: true,
          });
        }
      } else if (tool.name === 'search_images') {
        try {
          const q = String(tool.input.query ?? '');
          const count = Math.min(5, Number(tool.input.count ?? 3));
          let results = await searchUnsplashServer(q, count, signal);
          if (!results.length) results = await searchPexelsPhotosServer(q, count, signal);
          // search_images is a read tool — return data to AI without emitting tool_executed
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(results) });
        } catch {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify({ success: false, error: 'search_images failed (network/timeout).' }),
            is_error: true,
          });
        }
      } else if (tool.name === 'search_videos') {
        try {
          const q = String(tool.input.query ?? '');
          const count = Math.min(4, Number(tool.input.count ?? 2));
          const results = await searchPexelsServer(q, count, signal);
          // search_videos is a read tool — return data to AI without emitting tool_executed
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(results) });
        } catch {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify({ success: false, error: 'search_videos failed (network/timeout).' }),
            is_error: true,
          });
        }
      } else if (tool.name === 'create_workflow' && isCustomJsDomWorkflow(tool.input)) {
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify({
          success: false,
          error: 'customJavaScript with DOM manipulation is not supported in the SDUI engine. Visual effects (hover, press, entrance animations) are handled by set_animation in the styling phase. Only create workflows for state changes (toggle, tab switch, form submit, navigation). If no state logic is needed, stop.',
        }) });
      } else if (streamValidationErrors.has(tool.id)) {
        // Validator rejected this tool during streaming — it was never emitted to the client.
        // Return is_error so the AI sees the exact validation message and self-corrects.
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify({ success: false, error: streamValidationErrors.get(tool.id) }),
          is_error: true,
        });
      } else if (streamEmittedIds.has(tool.id)) {
        // Already emitted during streaming — client executed it; report registered echo.
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(buildRegisteredEcho(tool.name, tool.input)) });
      } else {
        // Not emitted during streaming (e.g. max_tokens reconciliation path) — emit now.
        const ssValidator = serverSideValidators?.[tool.name];
        const ssError = ssValidator ? ssValidator(tool.input as Record<string, unknown>) : null;
        if (ssError) {
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify({ success: false, error: ssError }), is_error: true });
        } else {
          const enriched = enrichInputWithPageId(tool.input);
          send({ type: 'tool_executed', id: tool.id, name: tool.name, input: enriched, phase });
          allExecutedTools.push({ name: tool.name, input: enriched });
          localToolCount++;
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(buildRegisteredEcho(tool.name, enriched)) });
        }
      }
    }

    // pause_turn: server paused generation, no tool calls; re-send without a user message.
    if (stopReason === 'pause_turn') continue;

    currentMessages.push({ role: 'user', content: toolResults });

    // Continue if the model wants more tool calls or was truncated (max_tokens).
    // Only stop when the model explicitly ends the turn (end_turn).
    if (stopReason !== 'tool_use' && stopReason !== 'max_tokens') break;
  }
  } catch (e) {
    if (phase) {
      send({ type: 'agent_error', agent: phase, message: e instanceof Error ? e.message : String(e) });
    }
    throw e;
  } finally {
    if (toolChoice && localToolCount === 0) {
      console.error('[builder] forced tool_choice produced 0 tool calls', {
        phase,
        rounds,
        toolChoice,
        lastStopReason,
        messagesCount: currentMessages.length,
      });
    }
    if (phase) {
      send({ type: 'agent_complete', agent: phase, rounds, toolCallCount: localToolCount, duration: Date.now() - startedAt, endedAt: Date.now() });
    }
  }
}

// ── Structure Agent: removed — functionality moved to Smart Planner ───────────
// The Smart Planner (lib/ai/agents/planner/agent.ts) now calls generate_structure
// directly in its agentic loop. processStructureTree() (lib/ai/tools/process-structure-tree.ts)
// handles UUID assignment, marker extraction, and variable processing.

async function _runStructureAgentLegacy_REMOVED(
  unit: BuildUnit,
  assignedPageId: string | null,
  existingVariables: Array<{ id?: string; label?: string; name?: string; type?: string; initialValue?: unknown }>,
  send: (event: Record<string, unknown>) => void,
  allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }>,
  signal?: AbortSignal,
  modelId?: string,
  /** Original user request — passed directly so the structure agent works from the
   *  user's own words instead of a Planner-generated SDUI description that may use
   *  wrong node-type terminology. For multi-page builds, prefixed with the page scope. */
  userRequest?: string,
  tokenAccumulator?: { inputTokens: number; outputTokens: number },
): Promise<{
  tree: CollectedTree | null;
  markers: Array<{ nodeId: string; loop?: string | boolean; loopKey?: string; showIf?: string }>;
  varEvents: ToolEvent[];
}> {
  const allExistingVars = existingVariables.filter(v => v.id);
  const existingVarsNote = allExistingVars.length > 0
    ? `\nExisting variables (reuse a UUID ONLY when the variable is semantically identical — same feature area, same purpose, same data shape. NEVER repurpose a variable from a different feature just because the name sounds similar; always create a fresh UUID in that case):\n${allExistingVars.map(v => {
        let schema = '';
        if (v.type === 'array' && Array.isArray(v.initialValue) && (v.initialValue as unknown[]).length > 0) {
          const first = (v.initialValue as unknown[])[0];
          if (first && typeof first === 'object' && !Array.isArray(first))
            schema = ` [fields: ${Object.keys(first as object).join(', ')}]`;
        } else if (v.type === 'object' && v.initialValue && typeof v.initialValue === 'object' && !Array.isArray(v.initialValue)) {
          schema = ` [fields: ${Object.keys(v.initialValue as object).join(', ')}]`;
        }
        return `  - "${v.label ?? v.name}" id="${v.id}" type="${v.type}"${schema}`;
      }).join('\n')}\n`
    : '';

  // Legacy: prompt building removed — this function is no longer called
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [];

  const prompt = userRequest
    ? `${userRequest}\n\nBuild the tree and declare variables in one generate_structure call.`
    : `Build: ${unit.name}\nDescription: ${unit.description}\n${unit.layout ? `Layout: ${unit.layout}` : ''}\n\nBuild the tree and declare variables in one generate_structure call.`;

  const structureMessages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: prompt }];

  const resolvedStructureModel = (modelId && VALID_MODELS.has(modelId)) ? modelId : 'claude-haiku-4-5';

  {
    const response = await client.messages.create({
      model: resolvedStructureModel,
      max_tokens: 16384,
      system: systemBlocks,
      tools: [] as never[],
      tool_choice: { type: 'tool' as const, name: 'generate_structure' },
      messages: structureMessages,
    } as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming, signal ? { signal } : undefined);

    if (response.usage) {
      send({
        type: '_internal_token_usage',
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
      });
      if (tokenAccumulator) {
        tokenAccumulator.inputTokens += response.usage.input_tokens ?? 0;
        tokenAccumulator.outputTokens += response.usage.output_tokens ?? 0;
      }
    }

    for (const block of response.content) {
      if (block.type !== 'tool_use' || block.name !== 'generate_structure') continue;
      const rawInput = block.input as Record<string, unknown>;
      const treeInput = rawInput.tree as Record<string, unknown> | undefined | null;
      if (!treeInput || typeof treeInput !== 'object') continue;

      const atIndex = rawInput.atIndex as number | undefined;
      const wfIdMap = new Map<string, string>();
      const resolvedTree = assignTreeIds(treeInput, new Set(), wfIdMap);
      const markers = extractAndStripMarkers(resolvedTree);
      const rawPageActions = Array.isArray(rawInput.pageActions)
        ? (rawInput.pageActions as Array<{ workflowId?: string; trigger?: string }>)
            .filter((pa): pa is { workflowId: string; trigger: string } => typeof pa.workflowId === 'string' && typeof pa.trigger === 'string')
            .map(pa => ({ ...pa, workflowId: normalizeWorkflowId(pa.workflowId, wfIdMap) }))
        : undefined;
      const collectedTree: CollectedTree = { unitName: unit.name, tree: resolvedTree, pageId: assignedPageId, atIndex, structureHint: unit.structureHint, pageActions: rawPageActions?.length ? rawPageActions : undefined };

      const declaredVars = (Array.isArray(rawInput.variables) ? rawInput.variables : []) as Array<{ name: string; type: string; initialValue?: unknown; uuid: string; description?: string; folder?: string; schema?: string }>;
      const varEvents: ToolEvent[] = [];
      // Track UUIDs assigned within this batch to catch intra-batch collisions
      // (the LLM sometimes emits the same UUID for two different new variables).
      const batchAssignedIds = new Set<string>();
      for (const v of declaredVars) {
        const varName = String(v.name ?? 'variable');
        const requestedId = (v.uuid && isUUIDFormat(v.uuid)) ? v.uuid : null;

        // ── UUID drift guard ────────────────────────────────────────────────
        // 1. Reuse-by-name: if a variable with this name + type already exists in
        //    the project, reuse its ID. The varRoster then matches the actual
        //    store ID instead of inventing a fresh UUID the agents can't reach.
        // 2. UUID collision: if the LLM happened to emit an ID already in use by
        //    a *different* variable (pre-existing OR earlier in this same batch),
        //    generate a fresh one so we don't silently overwrite the existing
        //    variable. The client-side `add_variable` handler also has a collision
        //    check, but catching it here means the `tool_executed` payload + the
        //    varRoster the downstream agents see all reference the *same* canonical ID.
        const sameNameVar = existingVariables.find(ev =>
          (ev.name === varName || ev.label === varName) && ev.type === v.type
        );
        let assignedId: string;
        if (sameNameVar?.id) {
          assignedId = sameNameVar.id;
        } else if (
          requestedId &&
          !existingVariables.some(ev => ev.id === requestedId) &&
          !batchAssignedIds.has(requestedId)
        ) {
          assignedId = requestedId;
        } else {
          assignedId = crypto.randomUUID();
        }
        batchAssignedIds.add(assignedId);

        const clientInput: Record<string, unknown> = { name: varName, type: v.type, initialValue: v.initialValue, variableId: assignedId, _assignedVarId: assignedId, description: v.description, folder: v.folder };
        if (typeof v.schema === 'string' && v.schema.trim() !== '') clientInput.schema = v.schema.trim();
        const varMediaHints = Array.isArray((v as Record<string, unknown>).mediaHints)
          ? ((v as Record<string, unknown>).mediaHints as Array<{ field: string; searchQuery: string }>)
              .filter(h => typeof h.field === 'string' && typeof h.searchQuery === 'string')
          : [];
        if (varMediaHints.length > 0) clientInput.mediaHints = varMediaHints;
        varEvents.push({ name: 'add_variable', input: clientInput, result: { success: true } });
        send({ type: 'tool_executed', id: `var-${varName.replace(/[^a-zA-Z0-9_-]/g, '-')}-${assignedId.slice(0, 8)}`, name: 'add_variable', input: clientInput, phase: 'structure' });
        allExecutedTools.push({ name: 'add_variable', input: clientInput });
      }

      return { tree: collectedTree, markers, varEvents };
    }
  }

  return { tree: null, markers: [], varEvents: [] };
}

// Strict hex-only UUID validation — rejects non-hex chars (g-z) and short aliases.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isUUIDFormat(s: string): boolean { return UUID_RE.test(s); }

// Max tool-call rounds to prevent infinite loops.
// Complex tasks (create page → switch → structure → configure → style → text) need many rounds;
// 100 gives full budget for the most complex multi-section builds.
const MAX_TOOL_ROUNDS = 100;

// Models that support Anthropic extended thinking
const THINKING_MODELS = new Set(['claude-sonnet-4-5']);
const VALID_MODELS = new Set(['claude-haiku-4-5', 'claude-sonnet-4-5']);

interface NodeFlat {
  id: string;
  name?: string;
  type?: string;
  text?: string;
  path: string;
  parentId?: string;
  blob: string;
}

// ─── Universal search helper ───────────────────────────────────────────────
// Fans a regex pattern across all indexed artifacts and returns tagged results.
// Sources: current-page nodeFlat (full blob), other-pages compact index,
// variables, workflows (page + global), globalFormulas, dataSources, sharedComponents.
function runSearchNodes(
  rawQuery: unknown,
  nodeFlat: NodeFlat[],
  otherPagesIndex: Array<{ pageId: string; pageName: string; nodes: Array<{ id: string; name?: string; type?: string; text?: string }> }>,
  variables: Array<{ id?: string; name: string; label?: string; type: string }>,
  workflows: Array<{ id?: string; name: string; trigger?: string; stepTypes?: string[]; scope?: string }>,
  globalFormulas: Array<{ name: string; preview: string }>,
  dataSources: Array<{ id: string; label: string; path: string }>,
  sharedComponents: Array<{ id: string; name: string }>,
): unknown {
  const q = String(rawQuery ?? '');
  let matcher: (s: string) => boolean;
  try {
    const re = new RegExp(q, 'i');
    matcher = (s) => re.test(s);
  } catch {
    const lc = q.toLowerCase();
    matcher = (s) => s.toLowerCase().includes(lc);
  }

  const results: unknown[] = [];

  // 1. Current page — full blob search
  for (const n of nodeFlat) {
    if (matcher(n.blob ?? '')) {
      results.push({ kind: 'node', id: n.id, name: n.name, type: n.type, path: n.path, parentId: n.parentId });
    }
  }

  // 2. Other pages — compact name/type/text search
  for (const page of otherPagesIndex) {
    for (const n of page.nodes) {
      const searchable = [n.name, n.type, n.id, n.text].filter(Boolean).join(' ');
      if (matcher(searchable)) {
        results.push({ kind: 'node_other_page', pageId: page.pageId, pageName: page.pageName, id: n.id, name: n.name, type: n.type, text: n.text });
      }
    }
  }

  // 3. Variables
  for (const v of variables) {
    const searchable = [v.id, v.name, v.label, v.type].filter(Boolean).join(' ');
    if (matcher(searchable)) {
      results.push({ kind: 'variable', id: v.id, name: v.name, label: v.label, type: v.type });
    }
  }

  // 4. Workflows (page + global)
  for (const wf of workflows) {
    const searchable = [wf.id, wf.name, wf.trigger, ...(wf.stepTypes ?? [])].filter(Boolean).join(' ');
    if (matcher(searchable)) {
      results.push({ kind: 'workflow', scope: wf.scope ?? 'page', id: wf.id, name: wf.name, trigger: wf.trigger, stepTypes: wf.stepTypes });
    }
  }

  // 5. Global formulas
  for (const f of globalFormulas) {
    if (matcher([f.name, f.preview].join(' '))) {
      results.push({ kind: 'formula', name: f.name, preview: f.preview });
    }
  }

  // 6. Data sources
  for (const ds of dataSources) {
    if (matcher([ds.id, ds.label, ds.path].join(' '))) {
      results.push({ kind: 'dataSource', id: ds.id, name: ds.label });
    }
  }

  // 7. Shared components
  for (const sc of sharedComponents) {
    if (matcher([sc.id, sc.name].join(' '))) {
      results.push({ kind: 'sharedComponent', id: sc.id, name: sc.name });
    }
  }

  const capped = results.slice(0, 30);
  if (capped.length > 0) return capped;
  return {
    note: `No match for "${q}". Try a broader pattern — e.g. search_nodes("<label>|<name>") or search_nodes("<color-name>|<hex>|<tailwind-class>") for color, or search_nodes("variables\\\\'uuid\\\\'") for bindings. Searches: all pages, variables, workflows, formulas, data sources, shared components.`,
  };
}

interface ChatRequestBody {
  message: string;
  selectedNodeIds?: string[];
  selectedNodesDetails?: unknown[];
  pageTreeSnapshot?: Array<{ id?: string; type?: string; name?: string }>;
  nodeFlat?: NodeFlat[];
  /** Compact node index for all non-current pages — includes blob (props+styles serialized) for full style/color search parity with current-page nodes */
  otherPagesIndex?: Array<{ pageId: string; pageName: string; pageRoute?: string; nodes: Array<{ id: string; name?: string; type?: string; text?: string; blob?: string }> }>;
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
  workflows?: Array<{ id?: string; name: string; trigger?: string; stepTypes?: string[]; scope?: string }>;
  dataSources?: Array<{ id: string; label: string; path: string; schema?: string }>;
  /** Compact global formula index — name + first 80 chars of expression */
  globalFormulas?: Array<{ name: string; preview: string }>;
  /** Compact shared component index — id + name */
  sharedComponents?: Array<{ id: string; name: string }>;
  threadId?: string;
  chatHistory?: Array<{ role: string; content: string }>;
  /** Which Anthropic model to use (defaults to claude-haiku-4-5) */
  model?: string;
  // On subsequent turns (after tool execution), tool results are sent back
  toolResults?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
  /** When true, the client is continuing a Phase 3 styling session across a tool-result request.
   *  The server must restore inPhase3Mode=true so Phase 3 tool restrictions are preserved. */
  isPhase3Continuation?: boolean;
  /** Workspace ID — used for AI token usage tracking */
  workspaceId?: string;
  /** Project ID — used for context in token usage tracking */
  projectId?: string;
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
    nodeFlat = [],
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
    otherPagesIndex = [],
    globalFormulas = [],
    sharedComponents: sharedComponentsIndex = [],
    threadId,
    chatHistory = [],
    toolResults,
    model: requestedModel,
    isPhase3Continuation = false,
  } = body;

  // Resolve model — only accept known models, default to haiku
  const modelId = (requestedModel && VALID_MODELS.has(requestedModel)) ? requestedModel : 'claude-haiku-4-5';
  const supportsThinking = THINKING_MODELS.has(modelId);
  const requestId = threadId || crypto.randomUUID();
  const modelSignalCtl = buildTimeoutSignal(req.signal, MODEL_TIMEOUT_MS);
  const externalSignalCtl = buildTimeoutSignal(req.signal, EXTERNAL_FETCH_TIMEOUT_MS);

  // ── AI quota pre-check ──────────────────────────────────────────────────────
  const { workspaceId: wsIdForQuota } = body as { workspaceId?: string };
  if (wsIdForQuota) {
    try {
      const usageResp = await fetch(
        `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/v1/workspaces/${wsIdForQuota}/usage`,
        { headers: { Cookie: req.headers.get('cookie') ?? '' } },
      );
      if (usageResp.ok) {
        const usageData = await usageResp.json() as { usage?: { aiTokens?: { remaining: number | null } } };
        const remaining = usageData.usage?.aiTokens?.remaining;
        if (remaining !== null && remaining !== undefined && remaining <= 0) {
          return new Response(
            JSON.stringify({ error: 'AI token quota exhausted for this billing period. Please upgrade your plan.', code: 'AI_QUOTA_EXCEEDED' }),
            { status: 402, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }
    } catch { /* non-critical — allow through if check fails */ }
  }

  // ── Build system prompt ─────────────────────────────────────────────────────

  const currentPage = (pageId ? pages.find(p => p.id === pageId) : undefined) ?? pages[0] ?? { id: 'home', name: 'Home', route: '/' };

  const paletteSnapshot = buildPaletteSnapshot(theme);

  // Add context about selected nodes and page tree as a system note
  // Show enough of the initialValue that the AI can IDENTIFY the variable (grep use).
  // IMPORTANT: This is a preview only — the AI must call get_variables for the full value
  // before calling update_variable_initial_value to avoid data loss.
  const fmtInitial = (val: unknown): string => {
    if (Array.isArray(val)) {
      if (val.length === 0) return 'array (empty)';
      // Show keys + first value of each top-level item to help the agent identify the variable.
      // Deliberately compact — not for reconstruction, only for grep/identification.
      const preview = val.slice(0, 2).map(item => {
        if (typeof item === 'object' && item !== null) {
          // Show only the first 3 keys per item, values truncated to 30 chars
          const entries = Object.entries(item as Record<string, unknown>).slice(0, 3)
            .map(([k, v]) => {
              const vs = typeof v === 'string' ? `"${v}"` : String(v);
              return `${k}:${vs.length > 30 ? vs.slice(0, 27) + '…' : vs}`;
            }).join(',');
          return `{${entries}}`;
        }
        const s = typeof item === 'string' ? `"${item}"` : String(item);
        return s.length > 40 ? s.slice(0, 37) + '…' : s;
      }).join(', ');
      return `array[${val.length}] preview (call get_variables for full): [${preview}${val.length > 2 ? ', …' : ''}]`;
    }
    if (typeof val === 'object' && val !== null) {
      const s = JSON.stringify(val);
      return s.length > 100 ? s.slice(0, 97) + '…' : s;
    }
    return String(val);
  };

  const contextNote = [
    selectedNodesDetails.length > 0
      ? `Selected: ${selectedNodesDetails.map((n: unknown) => { const node = n as { type?: string; id?: string; name?: string }; return `${node.type ?? 'Node'} "${node.name ?? 'untitled'}" (id: ${node.id ?? '?'})`; }).join(', ')}`
      : `Nothing selected`,
    nodeFlat.length > 0
      ? `Current page has ${pageTreeSnapshot.length} top-level section(s) and ${nodeFlat.length} nodes total. Use search_nodes(query) with regex to find any node — searches name, type, text, styles, and bindings.`
      : `Current page is empty — no nodes yet.`,
    variables.length > 0
      ? `Variables: ${variables.map(v => `${v.label ?? v.name}${v.type ? ` — ${v.type}` : ''}${v.initialValue != null ? `, initial: ${fmtInitial(v.initialValue)}` : ''}${v.id ? ` (id: ${v.id}, path: variables['${v.id}'])` : ''}`).join(', ')}`
      : null,
    workflows.length > 0 ? `Workflows: ${workflows.map(w => `${w.name} (trigger: ${w.trigger})`).join(', ')}` : null,
    dataSources.length > 0 ? `DataSources:\n${dataSources.map(d => `  ${d.label} → ${d.path}${d.schema ? `  schema: ${d.schema}` : ''}`).join('\n')}` : null,
  ].filter(Boolean).join('\n');

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

  // Phase O \u2014 turn instrumentation captured by wrapping `send`.
  const turnStartedAt = Date.now();
  const turnCounters = { ops: 0, agents: new Set<string>(), toolCalls: 0, inputTokens: 0, outputTokens: 0 };
  const rawSend = (event: Record<string, unknown>) => {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // stream closed
    }
  };
  const send = (event: Record<string, unknown>) => {
    const t = event.type as string | undefined;
    if (t === 'tool_executed') turnCounters.toolCalls += 1;
    else if (t === 'agent_context' && typeof event.agent === 'string') turnCounters.agents.add(event.agent);
    else if (t === 'planner_complete' && event.manifest && Array.isArray((event.manifest as Record<string, unknown>).operations)) turnCounters.ops = ((event.manifest as Record<string, unknown>).operations as unknown[]).length;
    else if (t === '_internal_token_usage') {
      turnCounters.inputTokens += (event.inputTokens as number) ?? 0;
      turnCounters.outputTokens += (event.outputTokens as number) ?? 0;
      return; // don't forward internal events to the SSE stream
    }
    rawSend(event);
  };
  send({ type: 'request_start', requestId, pageId: currentPage.id, model: modelId });


  // ── Run AI loop ──────────────────────────────────────────────────────────────

  void (async () => {
    const allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }> = [];

    // ── Build pipeline (always runs — planner decides dynamic vs specialist) ──
    async function runBuildPipeline(): Promise<void> {
      // Default to a single build unit on the current page.
      // The planner/structure agent will determine the actual structure from the message.
      const units: BuildUnit[] = [{
        name: message.slice(0, 60),
        pageRoute: currentPage.route,
        pageName: currentPage.name,
        description: message,
      }];

      // Emit build plan for diagnostic log.
      send({ type: 'build_plan', mode: 'build', buildUnits: units });

      // Phase H — planner → structure step pipeline.
      // Emits Phase O envelope events (planner_complete, structure_complete, …)
      // that the Cursor-style chat surfaces in Copy Debug.
      // We also capture the resulting manifest so the legacy dispatch below can
      // pluck out predicted dataSourceIds (so per-page binders can reference
      // collections['…'] formulas while the data agent is still working).
      type PredictedDataSource = { id: string; name?: string; type?: 'rest' | 'graphql' };
      let predictedDataSources: PredictedDataSource[] = [];
      let plannerWantsData = false;
      // Manifest-derived agent gate set — populated from the planner's ContractManifest.
      // Source of truth for which agent families run.
      let manifestAgentSet = new Set<string>();
      let manifestOperations: import('@/lib/ai/agents/manifest').ManifestOperation[] = [];
      // Human-readable intent string from the manifest (used for the completion text bubble).
      let manifestIntent = '';
      let capturedManifest: import('@/lib/ai/agents/manifest').ContractManifest = { intent: '', operations: [] };
      // Structure output — captured from dispatchResult inside the try block
      let builtCollectedTrees: CollectedTree[] = [];
      let builtAllMarkers: Marker[][] = [];
      let builtAddVarEventsCollected: ToolEvent[] = [];
      // Planner-refined working spec for all specialist agents. Falls back to the raw user message.
      let effectiveMessage = message;
      try {
        const { runNewAgentDispatch } = await import('@/lib/ai/agents/dispatch');
        const dispatchResult = await runNewAgentDispatch(
          {
            projectId: (body as { projectId?: string }).projectId ?? threadId ?? requestId,
            message,
            selectedNodeIds: selectedNodeIds ?? [],
            pageId: currentPage.id,
            pageNodes: (pageTreeSnapshot ?? []) as never,
            nodeFlat: nodeFlat ?? [],
            otherPagesIndex: otherPagesIndex ?? [],
            variables: variables ?? [],
            workflows: workflows ?? [],
            globalFormulas: globalFormulas ?? [],
            dataSources: dataSources ?? [],
            sharedComponents: sharedComponentsIndex ?? [],
            pages: pages ?? [],
            theme: theme ?? {},
            currentPageRoute: currentPage.route,
            // Pass compact chat history for planner context
            chatHistory: chatHistory.slice(-5).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            // Share the allExecutedTools accumulator so the planner populates it
            allExecutedTools,
            signal: modelSignalCtl.signal,
          },
          send,
        );
        // If context agent couldn't find a target, surface the clarification question and stop.
        if (dispatchResult.needsClarification) {
          send({ type: 'turn_stats', totalDurationMs: Date.now() - turnStartedAt, toolCalls: 0, ops: 0, agents: 0 });
          send({ type: 'text_delta', content: dispatchResult.needsClarification.question });
          send({ type: 'done', tools: [] });
          return;
        }
        // Capture top-level manifest intent for the completion text bubble.
        if (dispatchResult.manifest.intent) manifestIntent = dispatchResult.manifest.intent;
        capturedManifest = dispatchResult.manifest;
        builtCollectedTrees = dispatchResult.collectedTrees;
        builtAllMarkers = dispatchResult.allMarkers;
        builtAddVarEventsCollected = [...dispatchResult.addVarEventsCollected];
        // Use the planner's refined request as the working spec for all specialist agents.
        // Falls back to the raw user message when refinedRequest is absent (e.g. clarification flows).
        if (dispatchResult.manifest.refinedRequest) effectiveMessage = dispatchResult.manifest.refinedRequest;
        // Capture operations for dynamic agent detection.
        manifestOperations = dispatchResult.manifest.operations ?? [];
        // Walk the manifest for predicted datasources + signal whether the
        // planner asked for a data agent (so we can avoid spawning one for
        // prompts that don't need any external data).
        for (const op of manifestOperations) {
          if (op.agents?.data) plannerWantsData = true;
          // Collect all agent family keys emitted by the planner.
          for (const key of Object.keys(op.agents ?? {})) manifestAgentSet.add(key);
          const dctx = (op.agents?.data?.context ?? {}) as Record<string, unknown>;
          if (Array.isArray(dctx.dataSources)) {
            for (const d of dctx.dataSources as Array<Record<string, unknown>>) {
              const id = (d.dataSourceId ?? d.id) as string | undefined;
              if (typeof id === 'string' && id.length > 0) {
                predictedDataSources.push({
                  id,
                  name: typeof d.name === 'string' ? d.name : undefined,
                  type: (d.type as 'rest' | 'graphql' | undefined),
                });
              }
            }
          }
        }
        // Dedupe by id.
        const seen = new Set<string>();
        predictedDataSources = predictedDataSources.filter(d => {
          if (seen.has(d.id)) return false;
          seen.add(d.id);
          return true;
        });
      } catch (err) {
        console.warn('[new-arch] dispatch failed', err);
      }

      // Rebuild build units from manifest operations — one per distinct pageRoute.
      // The Planner outputs pageRoute + pageName per operation; we derive units from
      // that rather than defaulting everything to the current page.
      if (manifestOperations.length > 0) {
        const routeMap = new Map<string, BuildUnit>();
        for (const op of manifestOperations) {
          const route = op.pageRoute ?? currentPage.route;
          if (!route || routeMap.has(route)) continue;
          routeMap.set(route, {
            name: op.id,
            pageRoute: route,
            pageName: op.pageName ?? (route === currentPage.route ? currentPage.name : undefined),
            description: op.id,
            sectionCount: 1,
          });
        }
        if (routeMap.size > 0) {
          units.length = 0;
          units.push(...routeMap.values());
          send({ type: 'build_plan', mode: 'build', buildUnits: units });
        }
      }

      send({ type: 'build_phase', phase: 'building', total: units.length, message: `Building ${units.length} section${units.length !== 1 ? 's' : ''} with parallel agents...`, buildUnits: units.map(u => ({ name: u.name, description: u.description, pageRoute: u.pageRoute, sectionCount: u.sectionCount })) });

      // ── Structure comes from the smart planner (dispatch) ─────────────────────
      // The planner built the DOM tree and emitted tool_executed events during its
      // agentic loop. We just pick up the results here.
      const collectedTrees: CollectedTree[] = builtCollectedTrees;
      const allMarkers: Marker[][] = builtAllMarkers;
      let addVarEventsCollected: ToolEvent[] = builtAddVarEventsCollected;

      // Attach media manifests to trees (extractMediaFromTree needs loop node IDs)
      for (const ct of collectedTrees) {
        if (!ct.mediaManifest) {
          const loopNodeIds = new Set(
            allMarkers.flat().filter(m => m.loop).map(m => m.nodeId),
          );
          ct.mediaManifest = extractMediaFromTree(ct.tree, loopNodeIds);
        }
      }

      // Build pageIdMap from collected trees for downstream pageSplits lookups
      const pageIdMap: Record<string, string> = {};
      pageIdMap[currentPage.route] = pageId ?? currentPage.id;
      for (const ct of collectedTrees) {
        if (ct.pageId) {
          // Find matching unit by pageId
          const matchedUnit = units.find(u => {
            const existing = pages.find(p => p.route === u.pageRoute);
            return existing?.id === ct.pageId;
          });
          if (matchedUnit?.pageRoute) pageIdMap[matchedUnit.pageRoute] = ct.pageId;
        }
      }

      const boolVarIds = addVarEventsCollected
        .filter(e => (e.input as Record<string, unknown>).type === 'boolean')
        .map(e => String((e.input as Record<string, unknown>).variableId ?? ''));

      // ── Compute hints (between structure and parallel fan-out) ──────────────
      // Hints are computed from the trees BEFORE markers are stripped (they're still on the trees at this point for hint detectors)
      const nestedRepeatHint = detectNestedRepeatNodes(collectedTrees);
      const ternaryContrastHint = detectTernaryContrastNodes(collectedTrees, addVarEventsCollected.map(e => ({ name: e.name, input: e.input as Record<string, unknown> })));

      const relations: string[] = [];
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
        markers: Marker[][],
      ): string {
        const markerMap = new Map<string, { repeat?: string; condition?: string }>();
        for (const mks of markers) {
          for (const m of mks) {
            markerMap.set(m.nodeId, {
              repeat: m.loop ? `REPEAT(key=${m.loopKey ?? 'id'})` : undefined,
              condition: m.showIf ? `CONDITION(${m.showIf})` : undefined,
            });
          }
        }

        // Build set of node IDs inside nested repeats (depth >= 2) for inline annotation
        const nestedSet = new Set<string>();
        const walkNested = (node: Record<string, unknown>, repeatDepth: number) => {
          const hasRepeat = (typeof node.repeat === 'string' && node.repeat.length > 0) || !!node.loop || !!markerMap.get(node.id as string)?.repeat;
          const newDepth = hasRepeat ? repeatDepth + 1 : repeatDepth;
          if (newDepth >= 2 && !hasRepeat && node.id) nestedSet.add(node.id as string);
          const children = node.children as Record<string, unknown>[] | undefined;
          if (Array.isArray(children)) { for (const child of children) walkNested(child, newDepth); }
        };
        for (const ct of trees) walkNested(ct.tree, 0);

        // Infer semantic role from structure alone — no names, no hints required.
        // Roles use square-bracket notation: Box[role] so agents can tell role from type at a glance.
        // Disambiguation rule: Box[button] = the OUTER container (gets bg/radius/padding).
        //                       Text[button-label] = the INNER label (gets color/font only).
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
            if (parentRole === 'button' || parentRole === 'icon-button') return 'button-label';
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
            // Icon-only → icon-button
            if (childTypes.length === 1 && childTypes[0] === 'Icon') return 'icon-button';
            // Display-section names: output panels, result screens, info badges — NOT buttons.
            const nodeName = (node.name as string | undefined) ?? '';
            const isDisplaySection = /Display|Output|Result|Screen|Panel|Indicator|Status/i.test(nodeName);
            if (isDisplaySection && childTypes.every(t => t === 'Text' || t === 'Heading')) return 'group';
            // All other all-leaf Box nodes (CTA, badge, chip, tag, nav link) → button
            return 'button';
          }
          if (kids.length === 1 && childTypes[0] === 'Image') return 'image-wrap';
          if (kids.length === 1 && childTypes[0] === 'Video') return 'video-wrap';

          const mk = markerMap.get(node.id as string);
          if (mk?.repeat || node.loop || node.repeat) return 'list';

          if (depth === 0) return 'section';
          if (childTypes.some(t => t === 'Box')) return 'group';

          return '';
        }

        function walkNode(node: Record<string, unknown>, indent: string, parentRole = '', depth = 0): string {
          const nId = node.id as string ?? '?';
          const nType = ((node.type ?? node.label) as string | undefined) ?? 'Box';
          const nName = node.name as string ?? '';
          const rawText = node.text;
          // Static text for display; if it's a binding object, show abbreviated form
          const nText = typeof rawText === 'string' ? rawText
            : rawText && typeof rawText === 'object' && ('formula' in (rawText as object) || 'js' in (rawText as object))
              ? '' // shown as existing binding below
              : '';
          const nRepeat = typeof node.repeat === 'string' ? node.repeat : '';
          const nCondition = typeof node.condition === 'string' ? node.condition : '';
          const mk = markerMap.get(nId);
          const nested = nestedSet.has(nId) ? '[nested]' : '';

          // ── Existing binding annotations ──────────────────────────────────
          // Show what's already bound so downstream agents don't re-bind or duplicate.
          const existingTags: string[] = [];
          // Text binding (formula or js object)
          if (rawText && typeof rawText === 'object') {
            const textObj = rawText as Record<string, unknown>;
            const expr = (textObj.formula ?? textObj.js ?? '') as string;
            if (expr) existingTags.push(`text:${expr.slice(0, 60)}(existing)`);
          }
          // Workflow/action bindings
          const nodeActions = node.actions as unknown;
          if (Array.isArray(nodeActions)) {
            for (const a of nodeActions as Record<string, unknown>[]) {
              const wfName = (a.action ?? a.workflow) as string | undefined;
              const trigger = (a.trigger ?? '') as string;
              if (wfName) existingTags.push(`${trigger || 'click'}:${wfName}(existing)`);
            }
          } else if (nodeActions && typeof nodeActions === 'object') {
            for (const [trigger, def] of Object.entries(nodeActions as Record<string, unknown>)) {
              const wfName = (def as Record<string, unknown>)?.action ?? (def as Record<string, unknown>)?.workflow;
              if (wfName) existingTags.push(`${trigger}:${wfName}(existing)`);
            }
          }

          const tags = [
            mk?.repeat,
            mk?.condition,
            nRepeat ? `REPEAT(mapPath=${nRepeat})` : '',
            nCondition ? `CONDITION(${nCondition})` : '',
            nested,
            ...existingTags,
          ].filter(Boolean).join(' ');

          const kids = (Array.isArray(node.children) ? node.children : []) as Record<string, unknown>[];
          const role = inferRole(node, kids, parentRole, depth);
          // Use square brackets for role: Box[button] vs Text[button-label] is unambiguous.
          const displayType = role ? `${nType}[${role}]` : nType;

          let line = `${indent}[${nId}] ${displayType}${nName ? ` "${nName}"` : ''}${nText ? ` text="${nText}"` : ''}`;
          if (tags) line += ` — ${tags}`;

          return kids.length
            ? line + '\n' + kids.map(c => walkNode(c, indent + '  ', role, depth + 1)).join('\n')
            : line;
        }
        return trees.map(t => {
          const root = t.tree as Record<string, unknown>;
          const layoutHint = '';
          return `=== ${t.unitName}${layoutHint} ===\n${walkNode(root, '')}`;
        }).join('\n\n');
      }

      const compactTree = buildCompactTreeText(collectedTrees, allMarkers);

      // Build a filtered context note for styling/animation agents — only include variables
      // and workflows whose IDs appear in the current compactTree. This prevents variables and
      // workflows from unrelated pages from leaking into the build context.
      const buildContextNote = (() => {
        // Filter variables to only those whose UUID appears in the current compactTree.
        // Workflows are omitted entirely — styling/animation agents don't need them,
        // and there is no reliable way to map workflow names to the compactTree nodes.
        const filteredVars = variables.filter(v => v.id && compactTree.includes(v.id));
        return [
          selectedNodesDetails.length > 0
            ? `Selected: ${selectedNodesDetails.map((n: unknown) => { const node = n as { type?: string; id?: string; name?: string }; return `${node.type ?? 'Node'} "${node.name ?? 'untitled'}" (id: ${node.id ?? '?'})`; }).join(', ')}`
            : `Nothing selected`,
          pageTreeSnapshot.length > 0
            ? `Current page has ${pageTreeSnapshot.length} top-level section(s). Use search_nodes(query) to find a node by name/type/text, or get_page_tree() to inspect the full structure.`
            : `Current page is empty — no nodes yet.`,
          filteredVars.length > 0
            ? `Variables: ${filteredVars.map((v: { label?: string; name?: string; type?: string; initialValue?: unknown; id?: string }) => `${v.label ?? v.name}${v.type ? ` — ${v.type}` : ''}${v.initialValue != null ? `, initial: ${fmtInitial(v.initialValue)}` : ''}${v.id ? ` (id: ${v.id}, path: variables['${v.id}'])` : ''}`).join(', ')}`
            : null,
          dataSources.length > 0 ? `DataSources:\n${dataSources.map((d: { label?: string; path?: string; schema?: string }) => `  ${d.label} → ${d.path}${d.schema ? `  schema: ${d.schema}` : ''}`).join('\n')}` : null,
        ].filter(Boolean).join('\n');
      })();

      // Build id→type map from all collected trees for the server-side capability validator.
      // This lets runHaikuAgentLoop resolve component types without accessing the Zustand store.
      const nodeTypeMap = new Map<string, string>();
      // Build id→pageId map so downstream agents can write to nodes on non-focused pages.
      // Without this, a styling tool emitted for a node on page B fails on the client because
      // the executor only scans store.pageNodes (the active page).
      const nodeIdToPageMap = new Map<string, string>();
      {
        const walkForTypes = (node: Record<string, unknown>, pageId: string | undefined) => {
          const id = node.id as string | undefined;
          const type = (node.type ?? node.label) as string | undefined;
          if (id && type) nodeTypeMap.set(id, type);
          if (id && pageId) nodeIdToPageMap.set(id, pageId);
          for (const child of (Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [])) {
            walkForTypes(child, pageId);
          }
        };
        for (const ct of collectedTrees) {
          if (ct.tree) walkForTypes(ct.tree as Record<string, unknown>, ct.pageId);
        }
      }

      // Emit switch_page for created pages (still needed for client-side execution)
      if (createdPageIds.length > 0) {
        const switchId = `auto-switch-${createdPageIds[0]}`;
        send({ type: 'tool_executed', id: switchId, name: 'switch_page', input: { pageId: createdPageIds[0] }, phase: 'structure' });
        allExecutedTools.push({ name: 'switch_page', input: { pageId: createdPageIds[0] } });
      }

      // ── Flatten markers for diagnostic log ──────────────────────────────────
      const flatMarkers = allMarkers.flat();
      // Emit markers for diagnostic log only — all annotations are in the compact tree.
      send({ type: 'structure_markers', markers: flatMarkers });

      // ── Defensive binding gate ───────────────────────────────────────────────
      // If the structure step produced loop markers OR declared variables, the planner
      // MUST have included binding — if it forgot, force it in now.
      // This prevents the binding agent from being skipped for set_repeat / set_text.
      const hasLoopsOrVars = flatMarkers.some(m => m.loop) || addVarEventsCollected.length > 0;
      if (hasLoopsOrVars && !manifestAgentSet.has('binding')) {
        manifestAgentSet.add('binding');
      }

      // ── Variable roster for downstream agents ───────────────────────────────
      // Merge: newly-created vars (with full schema) + pre-existing vars not re-created this run.
      // This ensures binding/workflows agents can reference variables from previous runs without
      // inventing UUIDs or creating duplicates.
      const newVarIds = new Set(addVarEventsCollected.map(e => String((e.result as Record<string, unknown> | undefined)?.id ?? (e.input as Record<string, unknown>).variableId ?? '')));
      // Only include pre-existing variables whose UUID actually appears in the compact tree.
      // Without this filter, every variable from every other page (e.g. Calculator Buttons) bleeds
      // into the downstream varRoster, causing the workflows agent to generate logic for the wrong page.
      const existingVarsForRoster = variables.filter(v => v.id && !newVarIds.has(v.id) && compactTree.includes(v.id));

      const renderVarRosterEntry = (inp: Record<string, unknown>): string => {
        const n = String(inp.name ?? '');
        const id = String(inp.variableId ?? '');
        const t = String(inp.type ?? 'string');
        const desc = inp.description ? ` — ${inp.description}` : '';
        const valueStr = inp.initialValue !== undefined
          ? ` = ${JSON.stringify(inp.initialValue)}`
          : '';
        return `  "${n}" (${t}) → variables['${id}']${valueStr}${desc}`;
      };

      const newVarEntries = addVarEventsCollected.map(e => {
        const inp = e.input as Record<string, unknown>;
        const resolvedId = (e.result as Record<string, unknown> | undefined)?.id ?? inp.variableId;
        return renderVarRosterEntry({ ...inp, variableId: resolvedId });
      });
      const existingVarEntries = existingVarsForRoster.map(v =>
        renderVarRosterEntry({ name: v.label ?? v.name, variableId: v.id, type: v.type, initialValue: v.initialValue })
      );
      const allVarEntries = [...newVarEntries, ...existingVarEntries];

      // Build merged variable list for get_variables tool handlers.
      // Newly-created vars from structure phase + pre-existing vars not re-created this run.
      // Without this, parallel agents call get_variables, get a stale empty list, and invent fake UUIDs.
      const newVarsForHandler = addVarEventsCollected.map(e => {
        const inp = e.input as Record<string, unknown>;
        const resolvedId = String((e.result as Record<string, unknown> | undefined)?.id ?? inp.variableId ?? '');
        return {
          id: resolvedId,
          label: String(inp.name ?? ''),
          name: String(inp.name ?? ''),
          type: String(inp.type ?? 'string'),
          initialValue: inp.initialValue,
        };
      });
      const mergedVariables = [...newVarsForHandler, ...existingVarsForRoster];

      const varRoster = allVarEntries.length > 0
        ? `Available variables (ONLY these UUIDs are valid):\n${allVarEntries.join('\n')}`
        : `No variables were created. Do NOT reference variables['UUID'].`;

      // Workflows agent uses the same hard-constraint framing as other agents — all variables
      // are pre-declared by the structure agent. The add_variable tool has been removed from
      // PHASE_W_TOOLS so this message matches what the agent can actually do.
      const varRosterForWorkflows = allVarEntries.length > 0
        ? `Variables (pre-declared — use these UUIDs only, do NOT create new variables):\n${allVarEntries.join('\n')}`
        : `No variables were declared by the structure agent for this feature.`;

      // Emit compact tree + var roster for the diagnostic log (client stores these for "Copy log").
      send({ type: 'structure_context', compactTree, varRoster });

      // ── Read handlers shared by Styling and Binding ─────────────────────────
      // search_nodes now uses the full runSearchNodes engine — blob, regex, all pages,
      // variables, workflows, formulas, dataSources. The old simple tree-walk is replaced.
      // Legacy get_* shims kept for one release so specialist agent prompts still work.
      const buildReadHandlers: Record<string, (input: Record<string, unknown>) => unknown> = {
        // v2 unified tools
        search: (inp) => runSearchNodes(
          inp.query,
          nodeFlat,
          otherPagesIndex,
          mergedVariables,
          workflows,
          globalFormulas,
          dataSources,
          sharedComponentsIndex,
        ),
        read: (inp) => {
          const kind = String(inp.kind ?? '');
          const id = String(inp.id ?? '');
          if (kind === 'page' || id === '*') return pages;
          if (kind === 'variable') return mergedVariables.find((v: { id?: string; name?: string }) => (v.id ?? v.name) === id) ?? null;
          if (kind === 'workflow') return workflows.find((w: { id?: string; name?: string }) => (w.id ?? w.name) === id) ?? null;
          if (kind === 'dataSource') return dataSources.find((d: { id: string }) => d.id === id) ?? null;
          if (kind === 'theme') return theme;
          if (kind === 'node') return nodeFlat.find(nf => nf.id === id) ?? null;
          return null;
        },
        // Legacy shims — deprecated
        get_page_tree: () => ({ pageName: currentPage.name, sections: pageTreeSnapshot }),
        get_variables: () => mergedVariables,
        get_pages: () => pages,
        get_workflows: () => workflows,
        get_data_sources: () => dataSources,
        get_formulas: () => globalFormulas,
        get_shared_components: () => sharedComponentsIndex,
        get_theme: () => theme,
        // Full-blob search replacing the old simple tree-walk
        search_nodes: (inp) => runSearchNodes(
          inp.query,
          nodeFlat,
          otherPagesIndex,
          mergedVariables,
          workflows,
          globalFormulas,
          dataSources,
          sharedComponentsIndex,
        ),
        get_node_details: (inp) => {
          const ids = Array.isArray(inp.nodeIds) ? inp.nodeIds as string[] : [String(inp.nodeId ?? inp.id ?? '')];
          return ids.map(id => nodeFlat.find(n => n.id === id) ?? { id, error: 'not found' });
        },
      };

      // ── Binding Agent (system prompt — user messages are built per-page below) ──
      const bindingPromptParts = buildBindingAgentPrompt();
      const bindingSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: bindingPromptParts.static, cache_control: { type: 'ephemeral' } },
      ];

      // ── Predicted-datasource roster ─────────────────────────────────────────
      // The Planner / new-arch dispatcher pre-declares dataSourceIds the rest of
      // the build expects to exist. Per-page binding agents reference these as
      // collections['<predicted-id>'].data.… in formulas — the data agent (running
      // in parallel) confirms or aliases them when it actually creates the source.
      const predictedDsRosterText = predictedDataSources.length > 0
        ? `Predicted data sources (binding may reference collections['<id>']):\n${predictedDataSources
            .map(d => `  - ${d.id}${d.name ? ` (${d.name})` : ''}${d.type ? ` — ${d.type}` : ''}`)
            .join('\n')}`
        : '';

      // ── Styling + Animation + Binding + Workflow Sub-Agents (one set per built page, fully parallel) ──
      // The legacy implementation ran ONE styling agent + ONE animation agent over the
      // whole multi-page tree, which meant the user saw a single "styling" row in the
      // activity feed and the work proceeded section-by-section even though the canvas
      // patches had already been split per-page. Splitting the agents themselves means:
      //   1. Two pages → two styling agents and two animation agents, each chewing on
      //      a smaller compact tree → genuine wall-clock speedup.
      //   2. The activity feed shows one row per (agent × page) so the user can see
      //      "styling:Hero" and "styling:About" advancing simultaneously.
      const stylingCtx = { pages, currentPageName: currentPage.name, currentPageRoute: currentPage.route, paletteSnapshot, mood, appName, description, category };
      const stylingPromptParts = buildStylingAgentPrompt(stylingCtx);
      const stylingSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: stylingPromptParts.static, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: stylingPromptParts.dynamic },
      ];
      const animationPromptParts = buildAnimationAgentPrompt(stylingCtx);
      const animationSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: animationPromptParts.static, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: animationPromptParts.dynamic },
      ];

      // Slugify the page label so the agent name stays predictable (`styling:hero` etc.)
      // while keeping a human-readable display name for the activity feed.
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'page';

      // Per-page split for binding and workflows (always 1 per page).
      type PageAgentSplit = {
        unit: BuildUnit;
        ct: CollectedTree;
        pageId: string | null;       // resolved page id for this split (null = canvas/global)
        agentLabel: string;          // e.g. "Hero" — surfaced in the activity feed
        slug: string;                // slugged label, used as the agent suffix
        bindingAgentName: string;    // e.g. "binding:hero"
        workflowsAgentName: string;  // e.g. "workflows:hero"
        bindingMessages: Anthropic.Messages.MessageParam[];
        workflowsMessages: Anthropic.Messages.MessageParam[];
        workflowServerValidators: Record<string, (input: Record<string, unknown>) => string | null>;
      };

      // Per-chunk split for styling and animation. The planner controls how many chunks
      // to emit per page via multiple ops with styling agents. Each chunk receives its
      // slice of depth-1 sections plus the full page tree as read-only context.
      type StyleChunk = {
        stylingAgentName: string;    // e.g. "styling:op-style-a"
        animationAgentName: string;  // e.g. "animation:op-style-a"
        agentLabel: string;
        stylingMessages: Anthropic.Messages.MessageParam[];
        animationMessages: Anthropic.Messages.MessageParam[];
      };

      // ── Existing workflow roster builder ────────────────────────────────────
      // Surfaces page-level and app-level triggers upfront so agents don't create
      // duplicate pageLoad/appLoad workflows. Node-level bindings (click, change, text)
      // are already annotated inline in the compact tree as (existing).
      function buildExistingWorkflowRoster(targetPageId: string | null): string {
        type WorkflowEntry = { name?: string; id?: string; trigger?: string; pageScope?: string; isAppTrigger?: boolean };
        const pageWfs = (workflows as WorkflowEntry[]).filter(w => {
          if (!w.trigger) return false;
          const isDomTrigger = /^(click|change|submit|valueChange|enterKey|drag|mouse|swipe|focus|blur)/.test(w.trigger ?? '');
          if (isDomTrigger) return false; // node-level: already in compact tree
          if (w.isAppTrigger) return false; // app-level: shown in app agent message
          // Page-scoped: when targetPageId is known, only include workflows that
          // explicitly belong to that page. Workflows without pageScope are excluded
          // — they may belong to other pages and would pollute the roster with stale entries.
          return !targetPageId || w.pageScope === targetPageId;
        });
        if (pageWfs.length === 0) return '';
        return `Existing workflows on this page (add steps to these instead of creating duplicates):\n${
          pageWfs.map(w => `  "${w.name ?? '?'}"${w.id ? ` (id: ${w.id})` : ''} — trigger: ${w.trigger ?? '?'}`).join('\n')
        }`;
      }

      function buildExistingAppWorkflowRoster(): string {
        type WorkflowEntry = { name?: string; id?: string; trigger?: string; isAppTrigger?: boolean };
        const appWfs = (workflows as WorkflowEntry[]).filter(w => w.isAppTrigger);
        if (appWfs.length === 0) return '';
        return `Existing app-level workflows (add steps to these instead of creating duplicates):\n${
          appWfs.map(w => `  "${w.name ?? '?'}"${w.id ? ` (id: ${w.id})` : ''} — trigger: ${w.trigger ?? '?'}`).join('\n')
        }`;
      }

      // Walk the AI-generated tree (before client execution) and collect declared actions[]/pageActions[].
      // These stubs are minted by the generate_structure executor on the client — we surface them here
      // so the workflows agent knows exactly which stubs exist and only needs to add steps.
      //
      // We surface the workflowId UUID directly — UUIDs never collide, so no name-derivation or
      // suffix logic is needed. The agent passes the UUID to add_workflow_step.
      function buildMintedWorkflowRoster(ct: CollectedTree): string {
        const stubs: Array<{ workflowId: string; trigger: string; nodeName?: string; isPage?: boolean }> = [];

        function walkTree(node: Record<string, unknown>) {
          const acts = Array.isArray(node.actions) ? node.actions as Array<{ workflowId?: string; trigger?: string }> : [];
          const nodeName = (node.name ?? '') as string;
          for (const a of acts) {
            if (a.workflowId && a.trigger) {
              stubs.push({ workflowId: a.workflowId, trigger: a.trigger, nodeName: nodeName || undefined });
            }
          }
          const kids = Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [];
          for (const child of kids) walkTree(child);
        }

        walkTree(ct.tree as Record<string, unknown>);

        // pageActions are stored on the CollectedTree directly (preserved from the AI's input).
        for (const pa of ct.pageActions ?? []) {
          if (pa.workflowId && pa.trigger) {
            stubs.push({ workflowId: pa.workflowId, trigger: pa.trigger, isPage: true });
          }
        }

        if (stubs.length === 0) return '';
        const lines = stubs.map(s =>
          s.isPage
            ? `  workflowId: "${s.workflowId}" — page lifecycle — trigger: ${s.trigger}`
            : `  workflowId: "${s.workflowId}" — trigger: ${s.trigger}${s.nodeName ? ` — node: "${s.nodeName}"` : ''}`
        );
        return `WORKFLOW ROSTER (pass workflowId exactly as shown to add_workflow_step — do not create_workflow or bind_action):\n${lines.join('\n')}`;
      }

      /** Returns the set of all workflowId UUIDs minted by the structure agent in this tree. */
      function collectMintedWorkflowIds(ct: CollectedTree): Set<string> {
        const ids = new Set<string>();
        function walk(node: Record<string, unknown>) {
          const acts = Array.isArray(node.actions) ? node.actions as Array<{ workflowId?: string }> : [];
          for (const a of acts) { if (a.workflowId) ids.add(a.workflowId); }
          const kids = Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [];
          for (const child of kids) walk(child);
        }
        walk(ct.tree as Record<string, unknown>);
        for (const pa of ct.pageActions ?? []) { if (pa.workflowId) ids.add(pa.workflowId); }
        return ids;
      }

      const pageSplits: PageAgentSplit[] = collectedTrees.map((ct, idx) => {
        const pageCompactTree = buildCompactTreeText([ct], allMarkers);
        const unit = units.find(u => (pageIdMap[u.pageRoute ?? '/'] ?? null) === ct.pageId) ?? units[idx] ?? units[0];
        const rawLabel = unit?.name || ct.unitName || ct.pageId || `page-${idx + 1}`;
        const agentLabel = rawLabel;
        const slug = slugify(rawLabel);
        const bindingMessages: Anthropic.Messages.MessageParam[] = [{
          role: 'user',
          content: `[Binding Agent — ${agentLabel}]

[Page Tree — use exact node UUIDs]
${pageCompactTree}

${varRoster}${predictedDsRosterText ? `\n\n${predictedDsRosterText}` : ''}

Original request:
${effectiveMessage}`,
        }];
        // Use pageIdMap to resolve the authoritative page ID for this split.
        // ct.pageId is null when the section was placed on the "current page" without an
        // explicit _pageId. currentPage.id is wrong when the user is on a different page
        // than the one being built — use the unit's route to get the correct ID instead.
        const splitFullPageId = ct.pageId ?? pageIdMap[unit.pageRoute ?? '/'] ?? currentPage.id;
        const existingWfRoster = buildExistingWorkflowRoster(splitFullPageId);
        const mintedWfRoster = buildMintedWorkflowRoster(ct);
        const mintedWorkflowIds = collectMintedWorkflowIds(ct);
        const workflowServerValidators: Record<string, (input: Record<string, unknown>) => string | null> = {
          add_workflow_step: (input: Record<string, unknown>) => {
            if (!input.workflowId) {
              // Model used wrong field name — tell it exactly what to fix
              const hint = input.workflowName
                ? `Use the "workflowId" field (not "workflowName") — you sent workflowName="${input.workflowName}". Copy that UUID into the workflowId field.`
                : 'add_workflow_step requires workflowId. Use the exact UUID from your WORKFLOW ROSTER.';
              return hint;
            }
            const wfId = input.workflowId as string;
            if (!mintedWorkflowIds.has(wfId)) {
              const list = [...mintedWorkflowIds].join(', ');
              return `Workflow "${wfId}" not found. Your WORKFLOW ROSTER has: ${list || '(none)'}. Use the exact UUID shown — not a human-readable name.`;
            }
            // Block any browser global usage in runJavaScript — the sandbox only
            // exposes variables, wwLib, context, globalContext, auth, event, fetch,
            // Promise, JSON, Math, Date, console. Nothing else exists.
            if (input.type === 'runJavaScript') {
              const code = (input.code ?? '') as string;
              const BROWSER_GLOBALS = /\b(document|window|navigator|location|history|localStorage|sessionStorage|HTMLElement|Element|querySelector|getElementById|getElementsBy)\b/;
              if (BROWSER_GLOBALS.test(code)) {
                const sid = (input.stepId ?? 'step') as string;
                return (
                  `Step "${sid}" runJavaScript uses a browser global that does not exist in the sandbox. ` +
                  `Only variables, wwLib, context, globalContext, auth, event, fetch, Promise, JSON, Math, Date, console are available — no DOM or BOM APIs. ` +
                  `For visual hover effects use set_animation (animation agent). For navigation use wwLib.navigate.to(path). For state use variables['UUID'] = value.`
                );
              }
            }
            return null;
          },
        };
        const workflowsMessages: Anthropic.Messages.MessageParam[] = [{
          role: 'user',
          content: `[Workflows Agent — ${agentLabel}]
Page: ${splitFullPageId}

[Page Tree — use exact node UUIDs]
${pageCompactTree}

${varRosterForWorkflows}${mintedWfRoster ? `\n\n${mintedWfRoster}` : ''}${existingWfRoster ? `\n\n${existingWfRoster}` : ''}

Original request:
${effectiveMessage}${relationsNote}`,
        }];
        return {
          unit,
          ct,
          pageId: ct.pageId ?? null,
          agentLabel,
          slug,
          bindingAgentName: `binding:${slug}`,
          workflowsAgentName: `workflows:${slug}`,
          bindingMessages,
          workflowsMessages,
          workflowServerValidators,
        };
      });

      // ── Style chunks: planner-controlled parallel styling/animation splits ──────
      // For each page, find how many styling ops the planner emitted targeting that
      // page route. Split the page's depth-1 children (sections) positionally across
      // those ops. Each styling/animation agent pair receives its chunk tree plus the
      // full page as read-only context. Falls back to 1 chunk per page if the manifest
      // has no pageRoute-tagged styling ops.
      const styleChunks: StyleChunk[] = [];
      for (const ct of collectedTrees) {
        const pageRoute = ct.pageId
          ? (Object.entries(pageIdMap).find(([, id]) => id === ct.pageId)?.[0] ?? '/')
          : '/';
        // Collect styling ops for this page from the manifest.
        const pageStylingOps = manifestOperations.filter(
          op => op.agents?.styling && (!op.pageRoute || op.pageRoute === pageRoute),
        );
        const N = Math.max(1, pageStylingOps.length);
        const rootChildren = Array.isArray((ct.tree as Record<string, unknown>)?.children)
          ? ((ct.tree as Record<string, unknown>).children as Record<string, unknown>[])
          : [];
        const chunkSize = Math.ceil(rootChildren.length / N) || 1;

        for (let i = 0; i < N; i++) {
          const chunk = rootChildren.slice(i * chunkSize, (i + 1) * chunkSize);
          if (chunk.length === 0 && i > 0) break; // no sections left for this chunk

          // Build compact tree for just this chunk of sections.
          const chunkCt: CollectedTree = { ...ct, tree: { ...(ct.tree as Record<string, unknown>), children: chunk } as CollectedTree['tree'] };
          const chunkCompactTree = buildCompactTreeText([chunkCt], allMarkers);

          const op = pageStylingOps[i];
          const opId = op?.id ?? slugify(ct.unitName || pageRoute);
          const chunkLabel = ct.unitName || pageRoute;
          const stylingAgentName = N > 1 ? `styling:${opId}` : `styling:${slugify(ct.unitName || pageRoute)}`;
          const animationAgentName = N > 1 ? `animation:${opId}` : `animation:${slugify(ct.unitName || pageRoute)}`;

          const contextBlock = buildContextNote ? `[Context]\n${buildContextNote}\n\n` : '';
          const fullPageBlock = N > 1 ? (() => {
            // List only the top-level section IDs that belong to OTHER chunks.
            // This replaces the full-page compact tree (hundreds of tree-text tokens)
            // with a compact denial line — the agent cannot style what it cannot see.
            const chunkSectionIds = new Set(
              (chunk as { id?: string }[]).map(c => c.id).filter(Boolean)
            );
            const forbidden = (rootChildren as { id?: string }[])
              .map(c => c.id)
              .filter((id): id is string => !!id && !chunkSectionIds.has(id));
            return forbidden.length > 0
              ? `\n\n[NOT YOUR CHUNK — do NOT call set_style on these section IDs or any of their children: ${forbidden.join(' ')}]`
              : '';
          })() : '';

          const stylingMessages: Anthropic.Messages.MessageParam[] = [{
            role: 'user',
            content: `${contextBlock}[Styling Agent — ${chunkLabel}]

[Page Tree Chunk — use exact node UUIDs]
${chunkCompactTree}${fullPageBlock}

${varRoster}
${nestedRepeatHint}${ternaryContrastHint}
Original request:
${effectiveMessage}${relationsNote}${pageContextNote}`,
          }];

          const animationMessages: Anthropic.Messages.MessageParam[] = [{
            role: 'user',
            content: `[Animation Agent — ${chunkLabel}]

[Page Tree Chunk — use exact node UUIDs]
${chunkCompactTree}${fullPageBlock}

Original request:
${effectiveMessage}${relationsNote}${pageContextNote}`,
          }];

          styleChunks.push({ stylingAgentName, animationAgentName, agentLabel: chunkLabel, stylingMessages, animationMessages });
        }
      }

      // ── Edit-mode fallback: create agent slots from manifest resolvedNodeIds ──
      // When structure is skipped (edit-only request), collectedTrees is empty so the
      // loop above produces no styleChunks/pageSplits. Build slots directly from
      // manifest ops that have resolvedNodeIds — agents receive exact UUIDs, no search.
      if (collectedTrees.length === 0) {
        const editOps = manifestOperations.filter(op =>
          op.resolvedNodeIds && op.resolvedNodeIds.length > 0
        );

        if (editOps.length > 0 && styleChunks.length === 0 && (manifestAgentSet.has('styling') || manifestAgentSet.has('animation'))) {
          const contextBlock = buildContextNote ? `[Context]\n${buildContextNote}\n\n` : '';
          for (const op of editOps) {
            if (!op.agents?.styling && !op.agents?.animation) continue;
            const opSlug = slugify(op.id ?? 'edit');
            const label = op.id ?? 'Edit';
            const uuidHint = `\nTarget node UUIDs: ${op.resolvedNodeIds.join(', ')}`;

            const stylingMessages: Anthropic.Messages.MessageParam[] = [{
              role: 'user',
              content: `${contextBlock}[Styling Agent — ${label}]
The page structure ALREADY EXISTS — do NOT call generate_structure. Apply visual styles directly to the target nodes.
${uuidHint}

${varRoster}

Original request:
${effectiveMessage}`,
            }];
            const animationMessages: Anthropic.Messages.MessageParam[] = [{
              role: 'user',
              content: `${contextBlock}[Animation Agent — ${label}]
The page structure ALREADY EXISTS. Apply animations to the target nodes.
${uuidHint}

Original request:
${effectiveMessage}`,
            }];
            styleChunks.push({
              stylingAgentName: `styling:${opSlug}`,
              animationAgentName: `animation:${opSlug}`,
              agentLabel: label,
          stylingMessages,
          animationMessages,
            });
          }
        }

        if (editOps.length > 0 && pageSplits.length === 0 && (manifestAgentSet.has('binding') || manifestAgentSet.has('workflows'))) {
          const contextBlock = buildContextNote ? `[Context]\n${buildContextNote}\n\n` : '';
          for (const op of editOps) {
            if (!op.agents?.binding && !op.agents?.workflows) continue;
            const opSlug = slugify(op.id ?? 'edit');
            const label = op.id ?? 'Edit';
            const uuidHint = `\nTarget node UUIDs: ${op.resolvedNodeIds.join(', ')}`;
            const resolvedPageId = pages.find((p: { route: string }) => p.route === (op.pageRoute ?? currentPage.route))?.id ?? currentPage.id;

            const bindingMessages: Anthropic.Messages.MessageParam[] = [{
              role: 'user',
              content: `${contextBlock}[Binding Agent — ${label}]
${uuidHint}

${varRoster}${predictedDsRosterText ? `\n\n${predictedDsRosterText}` : ''}

Original request:
${effectiveMessage}`,
            }];
            const editExistingWfRoster = buildExistingWorkflowRoster(resolvedPageId ?? null);
            const workflowsMessages: Anthropic.Messages.MessageParam[] = [{
              role: 'user',
              content: `${contextBlock}[Workflows Agent — ${label}]
Page: ${resolvedPageId} (page-scoped workflows must include pageScope: '${resolvedPageId}').
${uuidHint}
${varRosterForWorkflows}${editExistingWfRoster ? `\n\n${editExistingWfRoster}` : ''}

Original request:
${effectiveMessage}`,
            }];
            pageSplits.push({
              unit: units[0] ?? { name: 'Edit', pageRoute: op.pageRoute ?? '/' } as never,
              ct: {} as never,
              pageId: resolvedPageId ?? null,
              agentLabel: label,
              slug: opSlug,
              bindingAgentName: `binding:${opSlug}`,
              workflowsAgentName: `workflows:${opSlug}`,
              bindingMessages,
              workflowsMessages,
              workflowServerValidators: {},
            });
          }
        }
      }

      // ── Workflows Agent (system prompt — page-scoped user messages live in pageSplits, plus a global "app" agent below) ──
      const phaseWPromptParts = buildWorkflowsAgentPrompt({ pages, currentPageName: currentPage.name, currentPageRoute: currentPage.route, appName, description });
      const phaseWSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: phaseWPromptParts.static, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: phaseWPromptParts.dynamic },
      ];
      // The workflows:app agent only emits app-level (isAppTrigger) workflows. The
      // per-page workflows:<page> agents handle pageScope/DOM-trigger workflows.
      const appWfRoster = buildExistingAppWorkflowRoster();
      const appWorkflowsMessages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content: `[Workflows Agent — App]
Create ONLY app-level workflows (isAppTrigger: true) — analytics init, restoreSession, app-wide listeners.
${appWfRoster ? `\n${appWfRoster}\n` : ''}
${varRosterForWorkflows}

Original request:
${effectiveMessage}${relationsNote}`,
        },
      ];
      const phaseWReadHandlers: Record<string, (input: Record<string, unknown>) => unknown> = {
        get_variables: () => mergedVariables,
        get_workflows: () => {
          // Augment the stale snapshot with steps dispatched during this session.
          // add_workflow_step is a client-side tool — we track dispatched calls in allExecutedTools.
          const stepCountByWorkflow = new Map<string, number>();
          const stepIdsByWorkflow = new Map<string, string[]>();
          for (const t of allExecutedTools) {
            if (t.name === 'add_workflow_step') {
              const inp = t.input as Record<string, unknown>;
              const wfKey = String(inp.workflowId ?? inp.workflowName ?? '');
              if (!wfKey) continue;
              stepCountByWorkflow.set(wfKey, (stepCountByWorkflow.get(wfKey) ?? 0) + 1);
              const ids = stepIdsByWorkflow.get(wfKey) ?? [];
              ids.push(String(inp.stepId ?? '?'));
              stepIdsByWorkflow.set(wfKey, ids);
            }
          }
          return (workflows as Array<Record<string, unknown>>).map(wf => {
            const key = String(wf.id ?? wf.name ?? '');
            const count = stepCountByWorkflow.get(key) ?? 0;
            return count > 0
              ? { ...wf, _stepsAddedThisSession: count, _stepIds: stepIdsByWorkflow.get(key) }
              : wf;
          });
        },
      };

      // ── Media Agent (real AI — searches and applies images/videos/icons) ─────
      // Build a compact media manifest showing only media nodes so the AI knows exactly
      // what to process. Sibling nodes in the same section are listed together so the
      // AI can reason about diversifying queries for siblings.
      // Build loop-variable media entries from mediaHints stored on each variable event.
      // UUID is resolved at add_variable time — no cross-call coordination needed.
      const loopVarManifestLines: string[] = [];
      for (const e of addVarEventsCollected) {
        const inp = e.input as Record<string, unknown>;
        const hints = Array.isArray(inp.mediaHints)
          ? (inp.mediaHints as Array<{ field: string; searchQuery?: string; queryField?: string }>)
          : [];
        if (!hints.length) continue;
        const varId = String(inp.variableId ?? inp._assignedVarId ?? '');
        const varName = String(inp.name ?? varId);
        for (const h of hints) {
          if (h.queryField) {
            // Per-item icon search: extract query text from each initialValue item using queryField
            const items = Array.isArray(inp.initialValue)
              ? (inp.initialValue as Array<Record<string, unknown>>)
              : [];
            const perItemQueries = items
              .map(item => String(item[h.queryField!] ?? ''))
              .filter(Boolean);
            if (perItemQueries.length > 0) {
              loopVarManifestLines.push(`LoopVariable "${varName}" — variableId: ${varId} | patchField: ${h.field} | iconQueries: ${JSON.stringify(perItemQueries)}`);
            }
          } else if (h.searchQuery) {
            // Auto-detect: if searchQuery is a single word matching a field name in items, treat as queryField.
            // This corrects the common model mistake of writing searchQuery: "title" instead of queryField: "title".
            const possibleField = h.searchQuery.trim();
            const items = Array.isArray(inp.initialValue)
              ? (inp.initialValue as Array<Record<string, unknown>>)
              : [];
            const looksLikeFieldName = /^\w+$/.test(possibleField) && items.length > 0 && possibleField in items[0];
            if (looksLikeFieldName) {
              const perItemQueries = items.map(item => String(item[possibleField] ?? '')).filter(Boolean);
              if (perItemQueries.length > 0) {
                loopVarManifestLines.push(`LoopVariable "${varName}" — variableId: ${varId} | patchField: ${h.field} | iconQueries: ${JSON.stringify(perItemQueries)}`);
              }
            } else {
              loopVarManifestLines.push(`LoopVariable "${varName}" — variableId: ${varId} | patchField: ${h.field} | searchQuery: "${h.searchQuery}"`);
            }
          }
        }
      }

      const mediaManifestLines: string[] = [];
      for (const ct of collectedTrees) {
        const manifest = ct.mediaManifest;
        const hasNodeMedia = manifest ? manifest.icons.length + manifest.images.length + manifest.videos.length + (manifest.bgImages?.length ?? 0) > 0 : false;
        if (!hasNodeMedia) continue;

        mediaManifestLines.push(`=== ${ct.unitName} ===`);
        if (manifest) {
          for (const n of manifest.images) {
            const nameTag = n.name ? ` "${n.name}"` : '';
            mediaManifestLines.push(`[${n.id}] Image${nameTag} | hint: searchQuery="${n.searchQuery}"`);
          }
          for (const n of manifest.videos) {
            const nameTag = n.name ? ` "${n.name}"` : '';
            mediaManifestLines.push(`[${n.id}] Video${nameTag} | hint: searchQuery="${n.searchQuery}"`);
          }
          for (const n of manifest.bgImages ?? []) {
            const nameTag = n.name ? ` "${n.name}"` : '';
            mediaManifestLines.push(`[${n.id}] Box(bgImage)${nameTag} | hint: searchQuery="${n.searchQuery}"`);
          }
          for (const n of manifest.icons) {
            const nameTag = n.name ? ` "${n.name}"` : '';
            mediaManifestLines.push(`[${n.id}] Icon${nameTag} | hint: icon="${n.icon}"`);
          }
        }
      }
      // Append loop-variable entries after node entries
      mediaManifestLines.push(...loopVarManifestLines);
      const mediaManifestText = mediaManifestLines.length > 0
        ? mediaManifestLines.join('\n')
        : '(no media nodes in this build)';

      // ── shouldMedia: computed here (before the promise is created) so the
      // agent loop is only started when there are actual media nodes to process.
      const totalMediaNodesEarly = collectedTrees.reduce((n, ct) => {
        const m = ct.mediaManifest;
        return n + (m ? m.icons.length + m.images.length + m.videos.length + (m.bgImages?.length ?? 0) : 0);
      }, 0) + loopVarManifestLines.length;
      const shouldMediaEarly = totalMediaNodesEarly > 0;

      const mediaPromptParts = buildMediaAgentPrompt();
      const mediaSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: mediaPromptParts.static, cache_control: { type: 'ephemeral' } },
      ];
      const mediaMessages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content: `[Media Agent] Find and apply media for every node listed below.

${mediaManifestText}

Original request:
${effectiveMessage}`,
        },
      ];

      const toToolParam = (t: { name: string; description: string; input_schema: unknown }) =>
        ({ name: t.name, description: t.description, input_schema: t.input_schema as Record<string, unknown> });

      const getFirstUserMsg = (msgs: Anthropic.Messages.MessageParam[]): string => {
        const first = msgs[0];
        if (!first) return '';
        return typeof first.content === 'string' ? first.content : JSON.stringify(first.content);
      };

      // Media stays as a single global agent — only start the loop when there are real
      // media nodes; otherwise the promise resolves immediately and no event is emitted.
      const mediaInjectionPromise = shouldMediaEarly
        ? runHaikuAgentLoop(mediaMessages, mediaSystemBlocks, MEDIA_AGENT_TOOLS.map(toToolParam), {}, send, allExecutedTools, 15, 'media', modelSignalCtl.signal, undefined, undefined, undefined, nodeIdToPageMap)
        : Promise.resolve();

      // ── Data Agent (global, runs in parallel with the per-page fan-out) ──────
      // Owns project-level datasource creation. Per-page binding agents reference
      // collections['<predicted-id>'].data.… formulas in parallel; codegen reconciles
      // when both sides finish via the predicted-id alias.
      const dataPromptParts = buildDataAgentPrompt();
      const dataSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: 'text', text: dataPromptParts.static, cache_control: { type: 'ephemeral' } },
      ];
      const predictedDsBlock = predictedDataSources.length > 0
        ? `\nPredicted dataSourceIds (use these via the \`dataSourceId\` parameter so binders that already reference collections['…'] keep working):\n${predictedDataSources.map(d => `  - ${d.id}${d.name ? ` (${d.name})` : ''}${d.type ? ` — ${d.type}` : ''}`).join('\n')}\n`
        : '';
      const dataMessages: Anthropic.Messages.MessageParam[] = [
        {
          role: 'user',
          content: `[Data Agent]
Create the project-level datasources this build needs.${predictedDsBlock}
${varRosterForWorkflows}

Original request:
${effectiveMessage}`,
        },
      ];
      const dataReadHandlers: Record<string, (input: Record<string, unknown>) => unknown> = {
        get_variables: () => mergedVariables,
        get_data_sources: () => dataSources,
      };

      // ── Data agent gate — driven entirely by the Planner manifest ──────────
      const shouldData = predictedDataSources.length > 0 || plannerWantsData;

      // ── Manifest-driven agent gates ────────────────────────────────────────
      // Planner is always the source of truth for which families run.
      // All gates require an explicit planner signal — no fallback defaults.
      const hasManifest = manifestAgentSet.size > 0;
      const shouldStyle     = manifestAgentSet.has('styling');
      const shouldBind      = manifestAgentSet.has('binding');
      const shouldWorkflow  = manifestAgentSet.has('workflows');
      const shouldAnimation = manifestAgentSet.has('animation');
      const skipStructureAgent = collectedTrees.length === 0;
      // Media gate — reuse the value computed before the promise was created.
      const shouldMedia = shouldMediaEarly;

      // ── Backend agent gate ─────────────────────────────────────────────────
      const shouldBackend = manifestAgentSet.has('backend');
      const projectId = (body as { projectId?: string }).projectId ?? threadId ?? requestId;

      // ── Backend context: compact table/workflow index ──────────────────────
      // Fetched only when the planner requested the backend agent.
      // Returns a [Backend Context] block injected into the backend agent user message.
      const BACKEND_API_URL = process.env.BACKEND_URL ?? 'http://localhost:4000';
      const baseBackendAuthHeaders: Record<string, string> = (() => {
        const h: Record<string, string> = {};
        const cookie = req.headers.get('cookie');
        if (cookie) h['cookie'] = cookie;
        const auth = req.headers.get('authorization');
        if (auth) h['authorization'] = auth;
        return h;
      })();

      async function backendFetch(path: string, method = 'GET', bodyData?: unknown): Promise<unknown> {
        const url = `${BACKEND_API_URL}${path}`;
        const headers: Record<string, string> = { ...baseBackendAuthHeaders };
        // Only set Content-Type when we have a body; omitting it for bodyless POSTs (e.g. /publish)
        // prevents the server from rejecting with FST_ERR_CTP_EMPTY_JSON_BODY.
        if (bodyData !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(url, {
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

      let backendContextBlock = '';
      if (shouldBackend && projectId) {
        try {
          const [tablesRaw, workflowsRaw] = await Promise.all([
            backendFetch(`/v1/projects/${projectId}/tables`).catch(() => []),
            backendFetch(`/v1/projects/${projectId}/workflows`).catch(() => []),
          ]);

          // Strip tables to compact form: name + column names
          interface RawColumn { name: string; type?: string; refTableId?: string | null }
          interface RawTable { id: string; name: string; columns?: RawColumn[] }
          const tablesObj = tablesRaw as { tables?: RawTable[] };
          const tables = Array.isArray(tablesObj?.tables) ? tablesObj.tables : [];
          const compactTables = tables.map(t => ({
            id: t.id,
            name: t.name,
            columnNames: (t.columns ?? []).map((c: RawColumn) => c.name),
          }));

          // Semantic keyword match: score each table by how many words from the message appear in name/columnNames
          const msgWords = message.toLowerCase().split(/\W+/).filter(w => w.length > 2);
          const scoredTables = compactTables.map(t => {
            const haystack = [t.name, ...t.columnNames].join(' ').toLowerCase();
            const score = msgWords.reduce((n, w) => n + (haystack.includes(w) ? 1 : 0), 0);
            return { ...t, score };
          });
          const relevantTables = scoredTables.sort((a, b) => b.score - a.score).slice(0, 14);

          // Compact workflow index
          interface RawWorkflow { id: string; name?: string; kind?: string; status?: string; method?: string; path?: string }
          const workflowsObj = workflowsRaw as { workflows?: RawWorkflow[] };
          const workflows = Array.isArray(workflowsObj?.workflows) ? workflowsObj.workflows : [];
          const scoredWorkflows = workflows.map(w => {
            const haystack = [w.name ?? '', w.kind ?? '', w.path ?? ''].join(' ').toLowerCase();
            const score = msgWords.reduce((n, wd) => n + (haystack.includes(wd) ? 1 : 0), 0);
            return { ...w, score };
          });
          const relevantWorkflows = scoredWorkflows.sort((a, b) => b.score - a.score).slice(0, 10);

          // Format as text block
          const tableLines = relevantTables.map(t => {
            return `  ${t.name} (${t.id})  columns: ${t.columnNames.join(', ') || '(none)'}`;
          });
          const workflowLines = relevantWorkflows.map(w => {
            const method = w.method ? ` ${w.method}` : '';
            const path = w.path ? ` ${w.path}` : '';
            const pub = w.status === 'PUBLISHED' ? ' [published]' : '';
            return `  ${w.name ?? 'unnamed'} (${w.id}) — ${w.kind ?? '?'}${method}${path}${pub}`;
          });

          const parts: string[] = [];
          if (tableLines.length > 0) parts.push(`tables:\n${tableLines.join('\n')}`);
          if (workflowLines.length > 0) parts.push(`server workflows:\n${workflowLines.join('\n')}`);
          if (parts.length > 0) backendContextBlock = `[Backend Context]\n${parts.join('\n\n')}`;
        } catch (err) {
          console.warn('[backend-agent] failed to fetch backend context:', err instanceof Error ? err.message : err);
        }
      }

      // App-level workflows agent — Planner manifest is the sole gate.
      const shouldAppWorkflow = shouldWorkflow && manifestAgentSet.has('appWorkflows');

      // ── SC pre-minted models (collected from structure step tool calls) ──────
      // The structure agent calls create_shared_component for each SC the planner
      // requested. We pluck those IDs here (same pattern as predictedDataSources)
      // so SC content agents can enter edit mode immediately, in parallel with page agents.
      const predictedSCModels = allExecutedTools
        .filter(t => t.name === 'create_shared_component' && t.input?.id)
        .map(t => ({
          modelId: String(t.input.id),
          label:   String(t.input.name ?? t.input.id),
          slug:    slugify(String(t.input.name ?? t.input.id)),
        }));
      const shouldAuthSC = predictedSCModels.length > 0 || (hasManifest && manifestAgentSet.has('sharedComponents'));

      // ── Build SC agent system blocks ─────────────────────────────────────────
      // One system block per SC — the agent is told exactly which model to author.
      // Re-used across all SC agents (same static prompt, only user message differs).
      const scPromptParts = shouldAuthSC ? buildSharedComponentAgentPrompt({ varRoster }) : null;
      const scSystemBlocks: Anthropic.Messages.TextBlockParam[] = scPromptParts
        ? [{ type: 'text', text: scPromptParts.static, cache_control: { type: 'ephemeral' } }]
        : [];
      const scReadHandlers: Record<string, (input: Record<string, unknown>) => unknown> = {
        get_variables: () => mergedVariables,
        // SC models created by the structure step are available through the client store;
        // we return a placeholder here so the agent knows to trust its user-message context.
        get_shared_components: () => [],
      };

      // ── Launch agents in parallel ─────────────────────────────────────────
      // Single batch: SC + data + media + per-page family agents (shape depends on dispatchMode).
      // Nothing awaits anything else. SC agents enter edit mode on pre-minted shells concurrently
      // with page agents — the store routes per-node mutations to the correct model.
      const agentRuns: Array<{ agent: string; promise: Promise<void> }> = [];

      // Guard: if the planner produced no work (empty manifest / context failure), surface an error
      // instead of silently completing with zero agents.
      const hasAnyWork = styleChunks.length > 0 || shouldBind || shouldWorkflow || shouldMedia || shouldData || shouldAuthSC || shouldBackend;
      if (!hasAnyWork) {
        send({ type: 'build_error', message: 'Build produced no work — the planner may have failed or returned an empty manifest. Please try again.' });
        return;
      }

      // Emit the parallel phase message now that we know the actual dispatch shape.
      {
        const activeAgents: string[] = [];
          if (shouldStyle)     activeAgents.push('Styling');
          if (shouldAnimation) activeAgents.push('Animation');
          if (shouldBind)      activeAgents.push('Binding');
          if (shouldWorkflow)  activeAgents.push('Workflows');
        if (shouldMedia) activeAgents.push('Media');
        if (shouldData)  activeAgents.push('Data');
        if (shouldAuthSC) activeAgents.push('Components');
        if (shouldBackend) activeAgents.push('Backend');
        const agentLabel = activeAgents.length > 0
          ? activeAgents.join(', ')
          : 'agents';
        send({ type: 'build_phase', phase: 'parallel', message: `Running ${agentLabel} in parallel...` });
      }

      // ── Flat pool: separate specialist agents per family, styling/animation split into chunks ──
      // Emit agent_context for styling/animation chunks first, then per-page binding/workflows.
      if (shouldStyle || shouldAnimation) {
        for (const chunk of styleChunks) {
          if (shouldStyle)     send({ type: 'agent_context', agent: chunk.stylingAgentName,   displayLabel: chunk.agentLabel, systemPrompt: stylingPromptParts.static + '\n\n' + stylingPromptParts.dynamic,   tools: STYLING_AGENT_TOOLS.map(t => t.name),   syntheticMessageCount: 0, startedAt: Date.now(), userMessage: getFirstUserMsg(chunk.stylingMessages) });
          if (shouldAnimation) send({ type: 'agent_context', agent: chunk.animationAgentName, displayLabel: chunk.agentLabel, systemPrompt: animationPromptParts.static + '\n\n' + animationPromptParts.dynamic, tools: ANIMATION_AGENT_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now(), userMessage: getFirstUserMsg(chunk.animationMessages) });
        }
      }
        for (const split of pageSplits) {
        if (shouldBind)     send({ type: 'agent_context', agent: split.bindingAgentName,   displayLabel: split.agentLabel, systemPrompt: bindingPromptParts.static,                                          tools: BINDING_AGENT_TOOLS.map(t => t.name),   syntheticMessageCount: 0, startedAt: Date.now(), userMessage: getFirstUserMsg(split.bindingMessages) });
        if (shouldWorkflow) send({ type: 'agent_context', agent: split.workflowsAgentName, displayLabel: split.agentLabel, systemPrompt: phaseWPromptParts.static + '\n\n' + phaseWPromptParts.dynamic,     tools: PHASE_W_TOOLS.map(t => t.name),         syntheticMessageCount: 0, startedAt: Date.now(), userMessage: getFirstUserMsg(split.workflowsMessages) });
        }
        if (shouldAppWorkflow) {
          send({ type: 'agent_context', agent: 'workflows:app', displayLabel: 'App', systemPrompt: phaseWPromptParts.static + '\n\n' + phaseWPromptParts.dynamic, tools: PHASE_W_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now(), userMessage: getFirstUserMsg(appWorkflowsMessages) });
        }

        agentRuns.push(
          ...(shouldStyle
          ? styleChunks.map(chunk => ({
              agent: chunk.stylingAgentName,
              promise: runHaikuAgentLoop(chunk.stylingMessages, stylingSystemBlocks, STYLING_AGENT_TOOLS.map(toToolParam), buildReadHandlers, send, allExecutedTools, 10, chunk.stylingAgentName, modelSignalCtl.signal, undefined, undefined, undefined, nodeIdToPageMap),
              }))
            : []),
          ...(shouldAnimation
          ? styleChunks.map(chunk => ({
              agent: chunk.animationAgentName,
              promise: runHaikuAgentLoop(chunk.animationMessages, animationSystemBlocks, ANIMATION_AGENT_TOOLS.map(toToolParam), buildReadHandlers, send, allExecutedTools, 10, chunk.animationAgentName, modelSignalCtl.signal, undefined, undefined, undefined, nodeIdToPageMap, { type: 'tool', name: 'set_animation' }),
              }))
            : []),
          ...(shouldBind
            ? pageSplits.map(split => ({
                agent: split.bindingAgentName,
              promise: runHaikuAgentLoop(split.bindingMessages, bindingSystemBlocks, BINDING_AGENT_TOOLS.map(toToolParam), {}, send, allExecutedTools, 10, split.bindingAgentName, modelSignalCtl.signal, undefined, undefined, undefined, nodeIdToPageMap),
              }))
            : []),
          ...(shouldWorkflow
            ? pageSplits.map(split => ({
                agent: split.workflowsAgentName,
              promise: runHaikuAgentLoop(split.workflowsMessages, phaseWSystemBlocks, PHASE_W_TOOLS.map(toToolParam), phaseWReadHandlers, send, allExecutedTools, 25, split.workflowsAgentName, modelSignalCtl.signal, undefined, modelId, undefined, nodeIdToPageMap, undefined, split.workflowServerValidators),
              }))
            : []),
          ...(shouldAppWorkflow
          ? [{ agent: 'workflows:app', promise: runHaikuAgentLoop(appWorkflowsMessages, phaseWSystemBlocks, PHASE_W_TOOLS.map(toToolParam), phaseWReadHandlers, send, allExecutedTools, 8, 'workflows:app', modelSignalCtl.signal, undefined, modelId, undefined, nodeIdToPageMap) }]
            : []),
        );

      // ── Data agent (global, always in parallel regardless of dispatch mode) ──
      if (shouldData) {
        send({ type: 'agent_context', agent: 'data', systemPrompt: dataPromptParts.static, tools: DATA_AGENT_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now(), userMessage: getFirstUserMsg(dataMessages) });
        agentRuns.push({
          agent: 'data',
          promise: runHaikuAgentLoop(dataMessages, dataSystemBlocks, DATA_AGENT_TOOLS.map(toToolParam), dataReadHandlers, send, allExecutedTools, 8, 'data', modelSignalCtl.signal, undefined, undefined, undefined, nodeIdToPageMap),
        });
      }

      // ── Backend agent (global, server-side tool execution) ────────────────
      if (shouldBackend && projectId) {
        const backendPromptParts = buildBackendAgentPrompt();
        const backendSystemBlocks: Anthropic.Messages.TextBlockParam[] = [
          { type: 'text', text: backendPromptParts.static, cache_control: { type: 'ephemeral' } },
        ];
        const backendMessages: Anthropic.Messages.MessageParam[] = [{
          role: 'user',
          content: [
            backendContextBlock ? `${backendContextBlock}\n\n` : '',
            `Original request: ${effectiveMessage}`,
          ].filter(Boolean).join(''),
        }];

        // Track created backend resources for backend_created SSE event
        const createdTables: Array<{ id: string; name: string }> = [];
        const createdWorkflows: Array<{ id: string; name: string; kind: string }> = [];

        // Backend tool handlers — all execute server-side against the platform API
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
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
          add_table_column: async (input) => {
            try {
              const result = await backendFetch(`/v1/projects/${projectId}/tables/${input.tableId}/columns`, 'POST', input.column);
              return { success: true, column: result };
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
          import_erd: async (input) => {
            try {
              const result = await backendFetch(`/v1/projects/${projectId}/tables/import-erd`, 'POST', { erd: input.erd }) as { tables?: Array<{ id: string; name: string }>; workflowsCreated?: number };
              const tables = result?.tables ?? [];
              for (const t of tables) createdTables.push({ id: t.id, name: t.name });
              if (tables.length > 0) send({ type: 'backend_created', tables, workflows: [] });
              return { success: true, tablesCreated: tables.map(t => ({ id: t.id, name: t.name })), workflowsCreated: result?.workflowsCreated ?? 0 };
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
          read_table: async (input) => {
            try {
              return await backendFetch(`/v1/projects/${projectId}/tables/${input.tableId}`);
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
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
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
          add_server_workflow_step: async (input) => {
            try {
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
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
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
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
          update_server_workflow: async (input) => {
            try {
              const payload: Record<string, unknown> = {};
              if (input.name) payload.name = input.name;
              if (input.description) payload.description = input.description;
              if (input.method) payload.method = input.method;
              if (input.path) payload.path = input.path;
              if (input.params) payload.inputSchema = input.params;
              const result = await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`, 'PATCH', payload);
              return { success: true, workflow: result };
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
          publish_server_workflow: async (input) => {
            try {
              const result = await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}/publish`, 'POST') as { workflow?: { id: string; name: string; status: string } };
              return { success: true, published: true, workflowId: result?.workflow?.id, name: result?.workflow?.name, status: result?.workflow?.status };
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
          read_workflow: async (input) => {
            try {
              const result = await backendFetch(`/v1/projects/${projectId}/workflows/${input.workflowId}`) as { workflow?: { id: string; name: string; kind: string; method?: string; path?: string; status: string; graph?: unknown[] } };
              const wf = result?.workflow;
              const graph = wf?.graph ?? [];
              function compactStep(s: Record<string, unknown>): Record<string, unknown> {
                const out: Record<string, unknown> = { id: s.id, type: s.type };
                if (s.config) out.config = s.config;
                for (const key of ['trueBranch', 'falseBranch', 'tryBody', 'catchBody', 'loopBody']) {
                  if (Array.isArray(s[key])) out[key] = (s[key] as unknown[]).map(x => compactStep(x as Record<string, unknown>));
                }
                return out;
              }
              return { workflowId: wf?.id, name: wf?.name, kind: wf?.kind, method: wf?.method, path: wf?.path, status: wf?.status, stepCount: graph.length, steps: graph.map(s => compactStep(s as Record<string, unknown>)) };
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
        };

        send({ type: 'agent_context', agent: 'backend', systemPrompt: backendPromptParts.static, tools: BACKEND_AGENT_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now(), userMessage: getFirstUserMsg(backendMessages) });
        agentRuns.push({
          agent: 'backend',
          promise: runHaikuAgentLoop(backendMessages, backendSystemBlocks, BACKEND_AGENT_TOOLS.map(toToolParam), backendToolHandlers, send, allExecutedTools, 20, 'backend', modelSignalCtl.signal),
        });
      }

      // ── Media agent (global; only fires when tree has media nodes) ────────
      if (shouldMedia) {
        send({ type: 'agent_context', agent: 'media', systemPrompt: mediaPromptParts.static, tools: MEDIA_AGENT_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now(), userMessage: getFirstUserMsg(mediaMessages) });
        agentRuns.push({ agent: 'media', promise: mediaInjectionPromise });
      }

      // ── SC agents (one per pre-minted model; joins parallel batch) ────────
      // Shells were created by the structure step. SC agents call enter_shared_component_edit
      // on pre-minted IDs, author content, then exit. The store's editingSharedComponentIds
      // stack safely handles multiple SCs in edit simultaneously (per-model isolation).
      if (shouldAuthSC && scPromptParts) {
        for (const sc of predictedSCModels) {
          const scAgentName = `sharedComponents:${sc.slug}`;
          const scMessages: Anthropic.Messages.MessageParam[] = [{
            role: 'user',
            content: `[Shared Component Agent — ${sc.label}]
modelId: "${sc.modelId}". The shell already exists — do NOT call create_shared_component again.
Instance nodes were placed on pages by the structure step — skip add_shared_component_instance.

${varRoster}

Original request:
${effectiveMessage}`,
          }];
          send({ type: 'agent_context', agent: scAgentName, displayLabel: sc.label, systemPrompt: scPromptParts.static, tools: SC_AGENT_TOOLS.map(t => t.name), syntheticMessageCount: 0, startedAt: Date.now(), userMessage: getFirstUserMsg(scMessages) });
          agentRuns.push({
            agent: scAgentName,
            promise: runHaikuAgentLoop(scMessages, scSystemBlocks, SC_AGENT_TOOLS.map(toToolParam), scReadHandlers, send, allExecutedTools, 12, scAgentName, modelSignalCtl.signal, undefined, undefined, undefined, nodeIdToPageMap),
          });
        }
      }

      // Agents whose agent_context was sent unconditionally but won't run — emit a zero-duration
      // agent_complete so the frontend doesn't show them as perpetually active.
      const launchedAgentNames = new Set(agentRuns.map(r => r.agent));
      const expectedAgentNames = new Set<string>();
        if (shouldAppWorkflow) expectedAgentNames.add('workflows:app');
      for (const chunk of styleChunks) {
        if (shouldStyle)     expectedAgentNames.add(chunk.stylingAgentName);
        if (shouldAnimation) expectedAgentNames.add(chunk.animationAgentName);
      }
        for (const split of pageSplits) {
        if (shouldBind)     expectedAgentNames.add(split.bindingAgentName);
        if (shouldWorkflow) expectedAgentNames.add(split.workflowsAgentName);
      }
      if (shouldData) expectedAgentNames.add('data');
      if (shouldMedia) expectedAgentNames.add('media');
      if (shouldAuthSC) predictedSCModels.forEach(sc => expectedAgentNames.add(`sharedComponents:${sc.slug}`));
      if (shouldBackend) expectedAgentNames.add('backend');
      for (const agent of expectedAgentNames) {
        if (!launchedAgentNames.has(agent)) {
          send({ type: 'agent_complete', agent, rounds: 0, toolCallCount: 0, duration: 0, endedAt: Date.now() });
        }
      }
      const settledAgents = await Promise.allSettled(agentRuns.map(a => a.promise));
      settledAgents.forEach((res, idx) => {
        if (res.status === 'fulfilled') return;
        send({
          type: 'agent_error',
          agent: agentRuns[idx]?.agent,
          message: res.reason instanceof Error ? res.reason.message : String(res.reason),
        });
      });

      // Verify pass disabled.

      // Phase O — turn stats before `done`.
      send({
        type: 'turn_stats',
        totalDurationMs: Date.now() - turnStartedAt,
        toolCalls: turnCounters.toolCalls,
        ops: turnCounters.ops,
        agents: turnCounters.agents.size,
        inputTokens: turnCounters.inputTokens,
        outputTokens: turnCounters.outputTokens,
      });

      // Report token usage to backend (fire-and-forget, don't block the response)
      const { workspaceId: wsId, projectId: projId } = body as { workspaceId?: string; projectId?: string };
      if (wsId && (turnCounters.inputTokens + turnCounters.outputTokens) > 0) {
        fetch(`${process.env.BACKEND_URL ?? 'http://localhost:4000'}/v1/workspaces/${wsId}/usage/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...req.headers.get('cookie') ? { Cookie: req.headers.get('cookie')! } : {} },
          body: JSON.stringify({
            projectId: projId,
            inputTokens: turnCounters.inputTokens,
            outputTokens: turnCounters.outputTokens,
            model: modelId,
          }),
        }).catch(() => { /* non-critical */ });
      }

      // Emit a brief completion message.
      const completionText = manifestIntent
        ? `Done — ${manifestIntent}`
        : `Done.`;
      send({ type: 'text_delta', content: completionText });

      send({ type: 'done', tools: allExecutedTools });
    }


    try {
      // ── Always run the build pipeline — planner decides if dynamic or specialist ──
      await runBuildPipeline();
      return; // runBuildPipeline sends its own 'done' event

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
