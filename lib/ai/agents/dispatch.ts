/**
 * New-architecture dispatcher. Pipeline:
 *
 *   user message
 *     → runSmartPlanner (Sonnet agentic loop)
 *         - searches existing page context if needed
 *         - calls generate_structure to build the DOM
 *         - calls add_variable / create_shared_component as needed
 *         - calls emit_plan when done → ContractManifest + collectedTrees
 *
 * SSE events: planner_started, planner_complete.
 *
 * If the planner sets needsClarification, dispatch returns early with the
 * question — no specialist agents run.
 */

import { runSmartPlanner, type SmartPlannerInput, type SmartPlannerResult } from './planner/agent';
import type { ContractManifest } from './manifest';
import type { CollectedTree, ToolEvent, Marker } from '@/lib/ai/tools/process-structure-tree';
import { buildReadContext, type ReadContext } from '@/lib/ai/tools/read-tools';

export interface NewDispatchInput {
  projectId: string;
  message: string;
  selectedNodeIds: string[];
  pageId: string;
  pageNodes: unknown[];

  // Full search context — used by the smart planner's search tools
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

  /** Last N compact turn summaries from previous planner calls (passed as chatHistory) */
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;

  /** Shared allExecutedTools accumulator — populated by the smart planner */
  allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }>;

  signal?: AbortSignal;
}

export interface NewDispatchResult {
  manifest: ContractManifest;
  /** Trees built by generate_structure calls inside the smart planner */
  collectedTrees: CollectedTree[];
  /** Variable events emitted during the planner loop */
  addVarEventsCollected: ToolEvent[];
  /** Loop/showIf markers per tree, in the same order as collectedTrees */
  allMarkers: Marker[][];
  /** Compact summary written by the planner for session history */
  summary: string;
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
  // Build the ReadContext — used by the planner's search/read tools
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

  // Run the Smart Planner
  const plannerStartedAt = Date.now();
  emit({ type: 'planner_started', startedAt: plannerStartedAt });

  const plannerInput: SmartPlannerInput = {
    message: input.message,
    chatHistory: input.chatHistory ?? [],
    readContext,
    currentPageId: input.pageId,
    pages: input.pages ?? [],
    existingVariables: input.variables,
    emit,
    allExecutedTools: input.allExecutedTools,
    signal: input.signal,
  };

  let plannerResult: SmartPlannerResult;
  try {
    plannerResult = await runSmartPlanner(plannerInput);
  } catch (err) {
    console.error('[dispatch] runSmartPlanner failed:', err);
    throw err;
  }

  const plannerDuration = Date.now() - plannerStartedAt;
  emit({
    type: 'planner_complete',
    manifest: plannerResult.manifest,
    summary: plannerResult.summary,
    duration: plannerDuration,
    collectedTreeCount: plannerResult.collectedTrees.length,
    varCount: plannerResult.addVarEventsCollected.length,
  });

  // Clarification early return
  if (plannerResult.needsClarification) {
    return {
      manifest: plannerResult.manifest,
      collectedTrees: [],
      addVarEventsCollected: [],
      allMarkers: [],
      summary: '',
      structureCounts: { nodes: 0, variables: 0, formulas: 0, workflows: 0, dataSources: 0 },
      needsClarification: plannerResult.needsClarification,
    };
  }

  // Count what was built
  const nodeCount = plannerResult.collectedTrees.reduce(
    (sum, ct) => sum + countNodes(ct.tree as Record<string, unknown>),
    0,
  );
  const varCount = plannerResult.addVarEventsCollected.length;

  return {
    manifest: plannerResult.manifest,
    collectedTrees: plannerResult.collectedTrees,
    addVarEventsCollected: plannerResult.addVarEventsCollected,
    allMarkers: plannerResult.allMarkers,
    summary: plannerResult.summary,
    structureCounts: { nodes: nodeCount, variables: varCount, formulas: 0, workflows: 0, dataSources: 0 },
    needsClarification: null,
  };
}

function countNodes(node: Record<string, unknown>): number {
  let n = 1;
  const children = node.children as Record<string, unknown>[] | undefined;
  if (Array.isArray(children)) for (const c of children) n += countNodes(c);
  return n;
}
