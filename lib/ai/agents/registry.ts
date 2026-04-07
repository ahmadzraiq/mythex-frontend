/**
 * Canonical IDs for parallel builder agents (must match `agent` / `phase` strings in builder-chat SSE).
 * Tool lists stay in `lib/ai/builder-tools.ts`; prompts live under `lib/ai/agents/<name>/`.
 *
 * For full details on each agent's tools, system prompt dynamics, user-message payload,
 * and upstream/downstream data flow — read the block comment at the top of each prompt.ts.
 */

export const BUILDER_AGENT_IDS = [
  'structure',
  'binding',
  'styling',
  'animation',
  'workflows',
  'media',
] as const;

export type BuilderAgentId = (typeof BUILDER_AGENT_IDS)[number];

export const AGENT_REGISTRY: Record<
  BuilderAgentId,
  { promptModule: string; notes: string }
> = {
  structure: {
    promptModule: 'lib/ai/agents/structure/prompt.ts',
    notes: 'generate_structure + add_variable; tools: STRUCTURE_AGENT_TOOLS',
  },
  binding: {
    promptModule: 'lib/ai/agents/binding/prompt.ts',
    notes: 'set_text, set_repeat, set_condition; tools: BINDING_AGENT_TOOLS',
  },
  styling: {
    promptModule: 'lib/ai/agents/layout/prompt.ts (buildStylingAgentPrompt)',
    notes: 'all visual styles via set_style (Icon color/size included); tools: STYLING_AGENT_TOOLS',
  },
  animation: {
    promptModule: 'lib/ai/agents/animation/prompt.ts',
    notes: 'enter/exit/loop/hover/press animations; tools: ANIMATION_AGENT_TOOLS',
  },
  workflows: {
    promptModule: 'lib/ai/agents/workflows/prompt.ts',
    notes: 'workflows; buildPhaseWSysPrompt in builder-knowledge-v2; tools: PHASE_W_TOOLS',
  },
  media: {
    promptModule: '(deterministic — no LLM prompt file)',
    notes: 'set_icon_src / set_src from tree manifest + search (color/size via styling agent)',
  },
};
