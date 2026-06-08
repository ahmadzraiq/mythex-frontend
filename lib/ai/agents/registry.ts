/**
 * Canonical IDs for parallel builder agents (must match `agent` / `phase` strings in builder-chat SSE).
 * Tool lists stay in `lib/ai/builder-tools.ts`; prompts live under `lib/ai/agents/<name>/`.
 *
 * For full details on each agent's tools, system prompt dynamics, user-message payload,
 * and upstream/downstream data flow — read the block comment at the top of each prompt.ts.
 */

export const BUILDER_AGENT_IDS = [
  'structure',
  'data',
  'binding',
  'styling',
  'animation',
  'workflows',
  'media',
  'sharedComponents',
  'backend',
] as const;

export type BuilderAgentId = (typeof BUILDER_AGENT_IDS)[number];

/** Human-readable labels for Cursor-style activity feed (Phase K / H). */
export const AGENT_DISPLAY_LABELS: Record<BuilderAgentId, string> = {
  structure: 'Planner',
  data: 'Data',
  binding: 'Binding',
  styling: 'UI',
  animation: 'Animation',
  workflows: 'Workflow',
  media: 'UI',
  sharedComponents: 'Components',
  backend: 'Backend',
};

export const AGENT_REGISTRY: Record<
  BuilderAgentId,
  { promptModule: string; notes: string }
> = {
  structure: {
    promptModule: 'lib/ai/agents/structure/prompt.ts',
    notes: 'generate_structure + add_variable; tools: STRUCTURE_AGENT_TOOLS',
  },
  data: {
    promptModule: 'lib/ai/agents/data/prompt.ts',
    notes: 'add/update/delete_data_source — runs once globally in parallel with per-page agents; tools: DATA_AGENT_TOOLS',
  },
  binding: {
    promptModule: 'lib/ai/agents/binding/prompt.ts',
    notes: 'set_text, set_repeat, set_condition — fanned out per page; tools: BINDING_AGENT_TOOLS',
  },
  styling: {
    promptModule: 'lib/ai/agents/layout/prompt.ts (buildStylingAgentPrompt)',
    notes: 'all visual styles via set_style (Icon color/size included) — fanned out per page; tools: STYLING_AGENT_TOOLS',
  },
  animation: {
    promptModule: 'lib/ai/agents/animation/prompt.ts',
    notes: 'enter/exit/loop/hover/press animations — fanned out per page; tools: ANIMATION_AGENT_TOOLS',
  },
  workflows: {
    promptModule: 'lib/ai/agents/workflows/prompt.ts',
    notes: 'workflows — fanned out per pageScope plus one workflows:app agent for isAppTrigger triggers; tools: PHASE_W_TOOLS',
  },
  media: {
    promptModule: 'lib/ai/agents/media/prompt.ts',
    notes: 'set_icon_src / set_src from tree manifest + search (single global agent — search batching makes per-page split unnecessary)',
  },
  sharedComponents: {
    promptModule: 'lib/ai/agents/sharedComponents/prompt.ts',
    notes: 'authors SC content (enter/exit + primitives); shells pre-minted by structure step; runs in parallel with page agents; tools: SC_AGENT_TOOLS',
  },
  backend: {
    promptModule: 'lib/ai/agents/backend/prompt.ts',
    notes: 'creates database tables and server-side workflows (FUNCTION/ENDPOINT/MIDDLEWARE); all tool calls executed server-side; runs in parallel with page agents; tools: BACKEND_AGENT_TOOLS',
  },
};
