/**
 * Context Agent — resolves "what is the user pointing at?" before the Planner runs.
 *
 * Architecture:
 *   Phase 1 (instant):   deterministic bypass — selectedNodes provided
 *   Phase 2 (code + 1–2 LLMs):
 *     Code:              semantic_search driven directly (no Round 1 LLM)
 *     Code:              auto-commit if exactly 1 node hit
 *     Code:              regex fallback + tiny r0 LLM if 0 hits (BUILD vs clarification)
 *     Round 2 (Haiku):   forced resolve_context — identifies the match from compact candidates
 *   Phase 3:             ContextResult passed to Planner
 */

import Anthropic from '@anthropic-ai/sdk';
import { runSearch, runRead, buildReadContext, type ReadContext } from '@/lib/ai/tools/read-tools';
import { runSemanticSearch, type SemanticHit } from '@/lib/ai/tools/semantic-search';
import { READ_TOOLS_V2 } from '@/lib/ai/builder-tools';
import { OPERATION_TYPE_LINES } from '@/lib/ai/agents/shared/taxonomy';

const ROUND_1_MODEL = 'claude-haiku-4-5';  // fast; 0-hit BUILD/clarification detection
const ROUND_2_MODEL = 'claude-haiku-4-5';  // fast; identifies from pre-ranked candidates

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextAgentInput {
  message: string;
  selectedNodeIds: string[];
  readContext: ReadContext;
  /**
   * Promise for node embeddings — started in parallel in dispatch.ts.
   * Awaited lazily inside handleSemanticSearch, so it only blocks when semantic_search is
   * actually called (by which time it is nearly done on a warm cache).
   */
  nodeEmbeddingsPromise?: Promise<Map<string, number[]>>;
  signal?: AbortSignal;
}

export interface ResolvedNode {
  id: string;
  name?: string;
  type?: string;
  pageRoute: string;
  parentId?: string;
  parentName?: string;
}

export interface ResolvedVariable {
  id: string;
  name: string;
  type: string;
  useField?: string;
  inferredShape?: Record<string, string>;
}

export interface ResolvedDataSource {
  id: string;
  label: string;
  relevantPath?: string;
}

export interface ContextToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

export interface ContextResult {
  resolvedNodes: ResolvedNode[];
  resolvedVariables: ResolvedVariable[];
  resolvedDataSources: ResolvedDataSource[];
  resolvedWorkflows: Array<{ id: string; name: string }>;
  /** true when Phase 1 bypassed — BUILD intent or selectedNodes provided */
  skippedSearch: boolean;
  /** Set when context agent could not determine target — Planner will ask user */
  needsClarification?: { question: string; options?: string[] };
  /**
   * Operation types determined by the context agent. Present when resolvedNodes is
   * non-empty — allows dispatch.ts to skip the Planner and build the manifest directly.
   */
  operationTypes?: ('styling' | 'animation' | 'binding' | 'workflows' | 'data')[];
  /** All search/read tool calls made during the agent loop — for UI observability */
  toolCalls?: ContextToolCall[];
}

// ─── System prompt for Context Agent ─────────────────────────────────────────

const CONTEXT_AGENT_SYSTEM = `You are the Context Agent for a no-code visual builder. Your ONLY job is to identify exactly what the user is referring to in their message — not to plan what to do, not to make changes.

You have two search tools:
- search(query, kinds?, scope?) — case-insensitive regex search across all artifacts
- semantic_search(query) — finds nodes by meaning, not exact text

And one output tool:
- resolve_context(result) — call this when you are confident you know what the user means

## Choosing the right search tool

Pick ONE primary search tool. NEVER call both in the same round.

Use search(regex) when the user refers to:
- A specific name or label: "header", "submit button", "Hero CTA", "sidebar"
- An exact text snippet visible on the page: "the text 'Get Started'"
- A known identifier, class name, or route

Use semantic_search(naturalLanguage) when the user describes:
- A visual property: "the red button", "the dark card", "the large banner"
- A role or concept: "the form at the top", "the navigation menu", "the hero"
- Anything where the literal word may not appear in the stored markup

When unsure, prefer semantic_search — it understands colors, styles, and design vocabulary.

## Regex search skills (when using search)
- Plain words do substring match (no special syntax needed)
- a|b — alternation for synonyms
- signal1.*signal2 — both signals anywhere in the record
- ^prefix — starts with, suffix$ — ends with
- Use scope: "currentPage" when the user refers to the active page

## After Round 1 — call resolve_context

After your search, you will automatically receive the full details of all matching candidates.
Call resolve_context with the node ID that best matches the user's description.
If no candidate matches, call resolve_context with needsClarification.

## Text leaf → Box parent rule (CRITICAL)
When a result has type "Text" and the user wants to change background, border, padding, size, or layout:
- The TEXT node does NOT support these styles — its parent Box does.
- Use the parentId as the target. Do NOT call read() to confirm — parentId is already available.

## Rules
- Call ONLY ONE search tool per round.
- The system automatically falls back to the other search tool if yours returns zero hits.
- For pure BUILD requests (no existing target to find), call resolve_context with empty arrays and skippedSearch: true.
- NEVER call resolve_context with empty resolvedNodes AND skippedSearch: false AND no needsClarification.
- NEVER plan. NEVER suggest changes. ONLY identify targets.

## operationTypes — set this in resolve_context

When resolvedNodes is non-empty, set operationTypes to ALL specialists needed:
${OPERATION_TYPE_LINES}`;


// ─── Minimal system prompt for Round 2 (identification only) ─────────────────
// Round 2 only needs to identify a node and call resolve_context.
// Keeping this small (~250 tokens) vs the full CONTEXT_AGENT_SYSTEM (~1,500 tokens):
//   - Reduces Round 2 input tokens → faster LLM call
//   - Stable constant enables cache_control to work across requests

const ROUND_2_SYSTEM = `You identify which node a user is referring to, then call resolve_context.

You will receive a list of candidate nodes sorted by semantic similarity (rank 1 = highest score).
Each candidate has: rank, score, id, name, type, text (visible label), path, blob (style properties), parentName.

## How to pick the right node

1. Read the user's description carefully — what visual property, label, or role are they describing?
2. Check each candidate's blob and text against that description:
   - blob contains CSS classes/values: background color, padding, border, font, etc.
   - text contains the visible label (e.g. "Submit", "Get Started")
3. The candidate whose blob/text best matches the description is the target — even if it is not rank 1.
4. When scores are close (within 0.10), always verify via blob/text rather than trusting rank alone.

## Text leaf → Box parent rule
When the best match has type "Text" and the user wants background/border/padding/size:
use parentId as the target, not the Text node itself.

## operationTypes — required when resolvedNodes is non-empty
${OPERATION_TYPE_LINES}

Call resolve_context. If no candidate matches, set needsClarification.`;

// ─── resolve_context tool definition ─────────────────────────────────────────

const resolveContextTool: Anthropic.Messages.Tool = {
  name: 'resolve_context',
  description: 'Output the resolved context — call this when you have identified the targets. For pure BUILD requests with no existing targets, call with empty arrays and skippedSearch: true.',
  input_schema: {
    type: 'object' as const,
    properties: {
      resolvedNodes: {
        type: 'array',
        description: 'Node UUIDs the user is targeting for edits.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Node UUID' },
            name: { type: 'string' },
            type: { type: 'string' },
            pageRoute: { type: 'string', description: 'Page route this node is on (e.g. "/" or "/about")' },
            parentId: { type: 'string' },
            parentName: { type: 'string' },
          },
          required: ['id', 'pageRoute'],
        },
      },
      resolvedVariables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string' },
            useField: { type: 'string', description: 'Specific field to use, e.g. "firstName"' },
            inferredShape: { type: 'object' },
          },
          required: ['id', 'name', 'type'],
        },
      },
      resolvedDataSources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            relevantPath: { type: 'string', description: 'Dot-path to the relevant field, e.g. "response.data[0].customer.email"' },
          },
          required: ['id', 'label'],
        },
      },
      resolvedWorkflows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
        },
      },
      operationTypes: {
        type: 'array',
        description: 'What specialists are needed for this edit (required when resolvedNodes is non-empty).',
        items: {
          type: 'string',
          enum: ['styling', 'animation', 'binding', 'workflows', 'data'],
        },
      },
      skippedSearch: {
        type: 'boolean',
        description: 'true if this is a BUILD request with no existing targets to resolve',
      },
      needsClarification: {
        type: 'object',
        description: 'Set when you cannot identify the target after searching',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['question'],
      },
    },
    required: ['resolvedNodes', 'resolvedVariables', 'resolvedDataSources', 'resolvedWorkflows', 'skippedSearch'],
  },
};

// ─── Tool handlers ────────────────────────────────────────────────────────────

function handleToolCall(
  name: string,
  inputRaw: Record<string, unknown>,
  ctx: ReadContext,
): unknown {
  if (name === 'search') {
    return runSearch(
      {
        query: String(inputRaw.query ?? ''),
        kinds: Array.isArray(inputRaw.kinds) ? inputRaw.kinds as never : undefined,
        scope: inputRaw.scope as 'currentPage' | 'allPages' | undefined,
        limit: typeof inputRaw.limit === 'number' ? inputRaw.limit : 30,
      },
      ctx,
    );
  }
  if (name === 'read') {
    return runRead(
      {
        kind: String(inputRaw.kind ?? '') as never,
        id: String(inputRaw.id ?? ''),
        path: inputRaw.path ? String(inputRaw.path) : undefined,
        depth: typeof inputRaw.depth === 'number' ? inputRaw.depth : 1,
      },
      ctx,
    );
  }
  return { error: `Unknown tool: ${name}` };
}

async function handleSemanticSearch(
  inputRaw: Record<string, unknown>,
  nodeEmbeddingsPromise: Promise<Map<string, number[]>>,
  ctx: ReadContext,
): Promise<{ results: SemanticHit[]; totalMatches: number; note?: string }> {
  const query = String(inputRaw.query ?? '');
  if (!query) return { results: [], totalMatches: 0, note: 'query is required' };
  // Await lazily — by the time semantic_search is called (post Round 1), embedNodes is likely done
  const nodeEmbeddings = await nodeEmbeddingsPromise;
  if (nodeEmbeddings.size === 0) {
    return { results: [], totalMatches: 0, note: 'No node embeddings available — use search() instead.' };
  }
  // Build a combined node list spanning all pages so SemanticHit.pageRoute is accurate
  const allPagesNodes = [
    ...ctx.nodeFlat.map(n => ({ ...n, pageRoute: ctx.currentPageRoute ?? '/' })),
    ...ctx.otherPagesIndex.flatMap(p =>
      p.nodes
        .filter(n => n.blob)
        .map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
          blob: n.blob!,
          path: n.id,
          pageRoute: p.pageRoute ?? '/',
        }))
    ),
  ];
  const hits = await runSemanticSearch(query, nodeEmbeddings, allPagesNodes);
  return {
    results: hits,
    totalMatches: hits.length,
    ...(hits.length === 0 ? { note: `No semantic matches for "${query}". Try search() with a regex instead.` } : {}),
  };
}

// ─── Helper: extract candidates with scores from a set of tool call results ────
// Semantic results first (sorted by score desc by runSemanticSearch), then regex.
// Score is preserved so Round 2 can see how close the race is and verify via blob.

interface Candidate { id: string; score?: number; pageRoute?: string }

function extractCandidates(toolCalls: ContextToolCall[]): Candidate[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  const addHit = (id: string, score?: number, pageRoute?: string) => {
    if (!seen.has(id)) { seen.add(id); candidates.push({ id, score, pageRoute }); }
  };

  for (const tc of toolCalls) {
    if (tc.name !== 'semantic_search') continue;
    const res = tc.result as { results?: Array<{ id?: string; kind?: string; score?: number; pageRoute?: string }> };
    for (const hit of res.results ?? []) {
      if (hit.id && hit.kind === 'node') addHit(hit.id, hit.score, hit.pageRoute);
    }
  }

  for (const tc of toolCalls) {
    if (tc.name !== 'search') continue;
    const res = tc.result as { results?: Array<{ id?: string; kind?: string; pageRoute?: string }> };
    for (const hit of res.results ?? []) {
      if (hit.id && hit.kind === 'node') addHit(hit.id, undefined, hit.pageRoute);
    }
  }

  return candidates;
}

// ─── Helper: run the fallback search tool (opposite of what LLM chose) ────────

async function runFallbackSearch(
  primaryToolName: string,
  primaryInput: Record<string, unknown>,
  nodeEmbeddingsPromise: Promise<Map<string, number[]>>,
  ctx: ReadContext,
): Promise<{ tc: ContextToolCall; nodeHitIds: string[] }> {
  if (primaryToolName === 'search') {
    // Primary was regex; fallback to semantic with same description
    const query = String(primaryInput.query ?? '').replace(/[.*+?^${}()|[\]\\]/g, ' ').trim();
    const result = await handleSemanticSearch({ query }, nodeEmbeddingsPromise, ctx);
    const tc: ContextToolCall = { name: 'semantic_search', input: { query }, result };
    const nodeHitIds = (result.results ?? []).filter(h => h.kind === 'node' && h.id).map(h => h.id!);
    return { tc, nodeHitIds };
  } else {
    // Primary was semantic; fallback to regex with query words joined
    const query = String(primaryInput.query ?? '').replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).join('.*');
    const result = runSearch({ query, scope: primaryInput.scope as 'currentPage' | 'allPages' | undefined ?? 'currentPage' }, ctx);
    const tc: ContextToolCall = { name: 'search', input: { query }, result };
    const nodeHitIds = ((result as { results?: Array<{ id?: string; kind?: string }> }).results ?? [])
      .filter(h => h.kind === 'node' && h.id).map(h => h.id!);
    return { tc, nodeHitIds };
  }
}

// ─── Helper: build ContextResult from a resolve_context tool use block ────────

function buildContextResult(
  resolveBlock: Anthropic.Messages.ToolUseBlock,
  message: string,
  toolCalls: ContextToolCall[],
): ContextResult {
  const raw = resolveBlock.input as Record<string, unknown>;
  const resolvedNodes = (raw.resolvedNodes as ResolvedNode[] | undefined) ?? [];
  const skippedSearch = Boolean(raw.skippedSearch);
  let needsClarification = raw.needsClarification as ContextResult['needsClarification'];

  // Server-side guard: if the LLM searched but found nothing and forgot needsClarification
  if (resolvedNodes.length === 0 && !skippedSearch && !needsClarification) {
    needsClarification = {
      question: `I couldn't find "${message}" on this page. Can you describe where it is, or select it directly on the canvas?`,
    };
  }

  return {
    resolvedNodes,
    resolvedVariables: (raw.resolvedVariables as ResolvedVariable[] | undefined) ?? [],
    resolvedDataSources: (raw.resolvedDataSources as ResolvedDataSource[] | undefined) ?? [],
    resolvedWorkflows: (raw.resolvedWorkflows as Array<{ id: string; name: string }> | undefined) ?? [],
    skippedSearch,
    needsClarification,
    operationTypes: Array.isArray(raw.operationTypes) ? raw.operationTypes as ContextResult['operationTypes'] : undefined,
    toolCalls,
  };
}

// ─── Main agent ───────────────────────────────────────────────────────────────

export async function runContextAgent(input: ContextAgentInput): Promise<ContextResult> {
  const {
    message,
    selectedNodeIds,
    readContext,
    nodeEmbeddingsPromise = Promise.resolve(new Map<string, number[]>()),
    signal,
  } = input;

  // Phase 1: Deterministic bypass — only when user has explicitly selected nodes.
  if (selectedNodeIds.length > 0) {
    const pageRoute = readContext.currentPageRoute ?? '/';
    const nodes: ResolvedNode[] = selectedNodeIds.map(id => {
      const n = readContext.nodeFlat.find(f => f.id === id);
      return {
        id,
        name: n?.name,
        type: n?.type,
        pageRoute,
      };
    });
    return {
      resolvedNodes: nodes,
      resolvedVariables: [],
      resolvedDataSources: [],
      resolvedWorkflows: [],
      skippedSearch: true,
    };
  }

  // Phase 2: Code-driven search — no Round 1 LLM.
  // Semantic search is always the primary strategy (understands colors, styles, roles).
  // Code drives the search directly — saving ~2s vs asking an LLM to pick the tool.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      resolvedNodes: [],
      resolvedVariables: [],
      resolvedDataSources: [],
      resolvedWorkflows: [],
      skippedSearch: true,
    };
  }

  const client = new Anthropic({ apiKey });
  const tools: Anthropic.Messages.Tool[] = [
    ...READ_TOOLS_V2.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Messages.Tool['input_schema'],
    })),
    {
      ...resolveContextTool,
      cache_control: { type: 'ephemeral' },
    } as Anthropic.Messages.Tool,
  ];

  const collectedToolCalls: ContextToolCall[] = [];

  // ── Code-driven semantic search (replaces Round 1 LLM) ─────────────────────
  // Semantic search is always the primary strategy — understands colors, styles, roles.
  // Uses the user's message directly as the query; the Planner will disambiguate if
  // multiple candidates match, eliminating the need for a Round 2 LLM call here.
  const semanticResult = await handleSemanticSearch({ query: message }, nodeEmbeddingsPromise, readContext);
  const primaryTc: ContextToolCall = { name: 'semantic_search', input: { query: message }, result: semanticResult };
  collectedToolCalls.push(primaryTc);
  let nodeHits = semanticResult.results.filter(h => h.kind === 'node' && h.id).map(h => h.id!);

  // ── Auto-commit: exactly 1 node hit ─────────────────────────────────────────
  const tryAutoCommit = (hits: string[]): ContextResult | null => {
    if (hits.length !== 1) return null;
    const nodeId = hits[0];
    const nodeInfo = readContext.nodeFlat.find(n => n.id === nodeId);
    const targetId = nodeInfo?.type === 'Text' && nodeInfo.parentId ? nodeInfo.parentId : nodeId;
    const targetInfo = readContext.nodeFlat.find(n => n.id === targetId);
    collectedToolCalls.push({ name: 'auto_commit', input: { nodeId }, result: { committed: targetId } });
    return {
      resolvedNodes: [{
        id: targetId, name: targetInfo?.name, type: targetInfo?.type,
        pageRoute: readContext.currentPageRoute ?? '/', parentId: targetInfo?.parentId,
      }],
      resolvedVariables: [], resolvedDataSources: [], resolvedWorkflows: [],
      skippedSearch: false, toolCalls: collectedToolCalls,
    };
  };

  const autoCommitResult = tryAutoCommit(nodeHits);
  if (autoCommitResult) return autoCommitResult;

  // ── Code-driven regex fallback: 0 semantic hits → try regex ─────────────────
  const allSearchToolCalls: ContextToolCall[] = [primaryTc];

  if (nodeHits.length === 0) {
    const { tc: fallbackTc, nodeHitIds: fallbackHits } = await runFallbackSearch(
      'semantic_search', { query: message }, nodeEmbeddingsPromise, readContext,
    );
    collectedToolCalls.push(fallbackTc);
    allSearchToolCalls.push(fallbackTc);
    nodeHits = fallbackHits;

    const fallbackAutoCommit = tryAutoCommit(nodeHits);
    if (fallbackAutoCommit) return fallbackAutoCommit;

    // Both searches returned 0 hits.
    // Run a single tiny LLM call (forced resolve_context) to distinguish:
    //   BUILD request ("create a landing page") → skippedSearch: true
    //   Ambiguous reference               → needsClarification
    // This is cheaper than the former Round 1 + Round 2 path because the context is minimal.
    if (nodeHits.length === 0) {
      const r0 = await client.messages.create(
        {
          model: ROUND_1_MODEL,
          max_tokens: 256,
          system: [{ type: 'text', text: CONTEXT_AGENT_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: message }],
          tools,
          tool_choice: { type: 'tool', name: 'resolve_context' },
        } as Parameters<typeof client.messages.create>[0],
        signal ? { signal } : undefined,
      ) as Anthropic.Messages.Message;
      const r0Block = r0.content.find(b => b.type === 'tool_use' && b.name === 'resolve_context') as Anthropic.Messages.ToolUseBlock | undefined;
      if (r0Block) return buildContextResult(r0Block, message, collectedToolCalls);
      // Absolute fallback
      return {
        resolvedNodes: [], resolvedVariables: [], resolvedDataSources: [], resolvedWorkflows: [],
        skippedSearch: false,
        needsClarification: { question: `I couldn't find "${message}" on this page. Can you describe where it is, or select it directly on the canvas?` },
        toolCalls: collectedToolCalls,
      };
    }
  }

  // ── N candidates found — build compact summaries with scores, then Round 2 Haiku identifies the match ──
  // score lets Round 2 know how close the race is — when scores are close (within 0.10),
  // it must verify via blob/text rather than blindly trusting rank.
  const candidates = extractCandidates(allSearchToolCalls);

  // Build a lookup across ALL pages for compact candidate construction
  type OtherPageNode = { id: string; name?: string; type?: string; text?: string; blob?: string; parentId?: string };
  const allNodesLookup = new Map<string, { node: typeof readContext.nodeFlat[0] | OtherPageNode; pageRoute: string }>();
  for (const n of readContext.nodeFlat) {
    allNodesLookup.set(n.id, { node: n, pageRoute: readContext.currentPageRoute ?? '/' });
  }
  for (const p of readContext.otherPagesIndex) {
    for (const n of p.nodes) {
      if (!allNodesLookup.has(n.id)) {
        allNodesLookup.set(n.id, { node: n, pageRoute: p.pageRoute ?? '/' });
      }
    }
  }

  const compactCandidates = candidates.map(({ id, score, pageRoute: candidatePageRoute }, rank) => {
    const entry = allNodesLookup.get(id);
    const n = entry?.node;
    const resolvedPageRoute = candidatePageRoute ?? entry?.pageRoute ?? readContext.currentPageRoute ?? '/';
    // Derive parentName: look up parent in current page first, then other pages
    const parentId = (n as typeof readContext.nodeFlat[0])?.parentId;
    const parentEntry = parentId ? allNodesLookup.get(parentId) : undefined;
    return {
      rank: rank + 1,
      score: score !== undefined ? Math.round(score * 100) / 100 : undefined,
      id,
      pageRoute: resolvedPageRoute,
      name: n?.name,
      type: n?.type,
      text: n?.text,
      path: (n as typeof readContext.nodeFlat[0])?.path ?? id,
      blob: n?.blob,
      parentName: parentEntry?.node?.name,
    };
  });

  // Record reads in collectedToolCalls for UI observability
  candidates.forEach(({ id }) => {
    const entry = allNodesLookup.get(id);
    collectedToolCalls.push({ name: 'read', input: { kind: 'node', id, depth: 0 }, result: entry?.node ?? { id } });
  });

  // ── ROUND 2 (Haiku) ─ identify the match from the pre-ranked candidate set ──
  // Uses a dedicated minimal system prompt (~250 tokens) instead of CONTEXT_AGENT_SYSTEM (~1,500 tokens).
  // The stable constant enables cache_control to work across all Round 2 calls.
  const r2Messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: message },
    { role: 'assistant', content: [{ type: 'text', text: 'I searched and found the following candidate nodes.' }] },
    {
      role: 'user',
      content: [{
        type: 'text',
        text: `Candidate nodes sorted by semantic relevance (rank 1 = most likely match):\n${JSON.stringify(compactCandidates)}`,
      }],
    },
  ];

  const r2 = await client.messages.create(
    {
      model: ROUND_2_MODEL,
      max_tokens: 512,
      system: [{ type: 'text', text: ROUND_2_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: r2Messages,
      tools,
      tool_choice: { type: 'tool', name: 'resolve_context' },
    } as Parameters<typeof client.messages.create>[0],
    signal ? { signal } : undefined,
  ) as Anthropic.Messages.Message;

  const r2ResolveBlock = r2.content.find(
    b => b.type === 'tool_use' && b.name === 'resolve_context',
  ) as Anthropic.Messages.ToolUseBlock | undefined;

  if (r2ResolveBlock) {
    return buildContextResult(r2ResolveBlock, message, collectedToolCalls);
  }

  // Absolute fallback — should never be reached with forced tool_choice.
  return {
    resolvedNodes: [],
    resolvedVariables: [],
    resolvedDataSources: [],
    resolvedWorkflows: [],
    skippedSearch: false,
    needsClarification: {
      question: `I wasn't able to identify what you're referring to in "${message}". Can you describe it more specifically, or select it directly on the canvas?`,
    },
    toolCalls: collectedToolCalls,
  };
}
