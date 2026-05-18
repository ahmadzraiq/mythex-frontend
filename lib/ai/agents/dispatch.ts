/**
 * New-architecture dispatcher. Pipeline:
 *
 *   user message
 *     → runContextAgent  (resolves "what is the user pointing at?" — search/read tools)
 *     → runPlanner       (single-shot, receives resolved context, produces manifest)
 *     → runStructureStep (deterministic — no LLM)
 *
 * SSE events: context_started, context_complete, planner_started, planner_complete,
 *             structure_started, structure_complete.
 *
 * If the context agent sets needsClarification, dispatch returns early with the
 * question — no agents run.
 */

import { runContextAgent, type ContextAgentInput } from './context-agent';
import { runPlanner } from './planner/agent';
import { runStructureStep } from './structure/structure-step';
import type { ContractManifest } from './manifest';
import { buildReadContext, type ReadContext } from '@/lib/ai/tools/read-tools';
import { embedNodes } from '@/lib/ai/tools/semantic-search';


export interface NewDispatchInput {
  projectId: string;
  message: string;
  selectedNodeIds: string[];
  pageId: string;
  pageNodes: unknown[];

  // Full search context — used by Context Agent
  nodeFlat: Array<{ id: string; name?: string; type?: string; text?: string; path: string; parentId?: string; blob: string }>;
  otherPagesIndex: Array<{ pageId: string; pageName: string; pageRoute?: string; nodes: Array<{ id: string; name?: string; type?: string; text?: string; blob?: string }> }>;
  variables: Array<{ id?: string; name: string; label?: string; type: string; initialValue?: unknown }>;
  workflows: Array<{ id?: string; name: string; trigger?: string; stepTypes?: string[]; steps?: unknown; scope?: string }>;
  globalFormulas: Array<{ name: string; preview: string }>;
  dataSources: Array<{ id: string; label: string; path: string; schema?: string; sampleResponse?: string }>;
  sharedComponents?: Array<{ id: string; name: string }>;
  pages?: Array<{ id: string; name: string; route: string }>;
  theme?: Record<string, string>;
  currentPageRoute?: string;

  signal?: AbortSignal;
}

export interface NewDispatchResult {
  manifest: ContractManifest;
  structureCounts: { nodes: number; variables: number; formulas: number; workflows: number; dataSources: number };
  needsClarification: { question: string; options?: string[] } | null;
}

export interface DispatchEmitter {
  (event: Record<string, unknown>): void;
}


export async function runNewAgentDispatch(
  input: NewDispatchInput,
  emit: DispatchEmitter,
): Promise<NewDispatchResult> {
  // Build the ReadContext once — reused by Context Agent and legacy read handlers in route.ts
  const readContext: ReadContext = buildReadContext({
    nodeFlat: input.nodeFlat,
    otherPagesIndex: input.otherPagesIndex,
    variables: input.variables,
    workflows: input.workflows,
    globalFormulas: input.globalFormulas,
    dataSources: input.dataSources,
    sharedComponents: input.sharedComponents ?? [],
    pages: input.pages ?? [],
    theme: input.theme,
    currentPageId: input.pageId,
    currentPageRoute: input.currentPageRoute ?? '/',
  });

  // 1) Context Agent — resolves which existing nodes/variables/datasources the user means.
  //    Phase 1 bypasses instantly for BUILD requests or when nodes are pre-selected.
  //    Phase 2 runs an agentic Haiku mini-loop (search + read + semantic_search tools, max 8 rounds).
  const contextStartedAt = Date.now();
  emit({ type: 'context_started', startedAt: contextStartedAt });

  // Start embedding nodes in parallel — does NOT block.
  // Embeds ALL pages (current + other) so semantic search works across the whole project.
  // Cleanup is based on the combined live-ID set, so truly deleted nodes are removed.
  // Autosave also warms the cache via /api/ai/retrieval/ensure-index (fire-and-forget, all pages).
  const nodeEmbeddingsPromise: Promise<Map<string, number[]>> =
    process.env.OPENAI_API_KEY && input.nodeFlat.length > 0
      ? (() => {
          const themeMap = input.theme ?? {};
          const expandBlob = (blob: string) =>
            blob.replace(/var\(--theme-([^)]+)\)/g, (match, key: string) => {
              const hex = themeMap[key];
              return hex ? `${match} /* ${key} ${hex} */` : match;
            });

          // Current page nodes (full NodeFlat data + theme expansion)
          const currentPageNodes = input.nodeFlat.map(n => ({
            ...n,
            blob: expandBlob(n.blob),
            pageRoute: input.currentPageRoute ?? '/',
          }));

          // Other pages' nodes (compact index — include only nodes with blob data)
          const otherPagesNodes = input.otherPagesIndex.flatMap(p =>
            p.nodes
              .filter(n => n.blob)
              .map(n => ({
                id: n.id,
                name: n.name,
                type: n.type,
                blob: expandBlob(n.blob!),
                path: n.id,
                pageRoute: p.pageRoute ?? '/',
              }))
          );

          const allPagesNodes = [...currentPageNodes, ...otherPagesNodes];
          return embedNodes(allPagesNodes).catch(err => {
            console.warn('[dispatch] embedNodes failed:', err instanceof Error ? err.message : err);
            return new Map<string, number[]>();
          });
        })()
      : Promise.resolve(new Map<string, number[]>());

  const contextAgentInput: ContextAgentInput = {
    message: input.message,
    selectedNodeIds: input.selectedNodeIds,
    readContext,
    nodeEmbeddingsPromise,
    signal: input.signal,
  };
  const contextResult = await runContextAgent(contextAgentInput);

  const contextDuration = Date.now() - contextStartedAt;
  emit({
    type: 'context_complete',
    duration: contextDuration,
    skippedSearch: contextResult.skippedSearch,
    resolvedNodeCount: contextResult.resolvedNodes.length,
    resolvedVariableCount: contextResult.resolvedVariables.length,
    toolCalls: contextResult.toolCalls ?? [],
  });

  // If context agent couldn't determine target, surface clarification early
  if (contextResult.needsClarification) {
    // Build a minimal stub manifest so the caller can read needsClarification
    const stubManifest: ContractManifest = {
      intent: '',
      needsClarification: contextResult.needsClarification,
      operations: [],
    };
    return {
      manifest: stubManifest,
      structureCounts: { nodes: 0, variables: 0, formulas: 0, workflows: 0, dataSources: 0 },
      needsClarification: contextResult.needsClarification,
    };
  }

  // 2) Planner — single-shot LLM call. Receives the user message + resolved context.
  const plannerStartedAt = Date.now();
  emit({ type: 'planner_started', startedAt: plannerStartedAt });

  const manifest = await runPlanner({
    message: input.message,
    selectedNodeIds: input.selectedNodeIds,
    contextResult,
    signal: input.signal,
  });

  const plannerDuration = Date.now() - plannerStartedAt;
  emit({ type: 'planner_complete', manifest, duration: plannerDuration });

  // 3) Clarification early return — if the planner flagged ambiguity, stop here
  if (manifest.needsClarification) {
    return {
      manifest,
      structureCounts: { nodes: 0, variables: 0, formulas: 0, workflows: 0, dataSources: 0 },
      needsClarification: manifest.needsClarification,
    };
  }

  // 4) Structure step (deterministic — no LLM)
  const structurePreStartedAt = Date.now();
  emit({ type: 'structure_started', startedAt: structurePreStartedAt });
  const struct = runStructureStep(manifest);
  for (const e of struct.emitted) emit(e as unknown as Record<string, unknown>);
  emit({ type: 'structure_complete', ...struct.counts, duration: Date.now() - structurePreStartedAt });

  return {
    manifest,
    structureCounts: struct.counts,
    needsClarification: null,
  };
}
