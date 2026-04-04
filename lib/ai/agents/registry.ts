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
  'styling:layout',
  'styling:colors',
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
  'styling:layout': {
    promptModule: 'lib/ai/agents/layout/prompt.ts',
    notes: 'layout, spacing, sizing, typography, position, overflow, transform; tools: LAYOUT_AGENT_TOOLS',
  },
  'styling:colors': {
    promptModule: 'lib/ai/agents/colors/prompt.ts',
    notes: 'colors, borders, shadows, animations, bulk_apply; tools: COLORS_AGENT_TOOLS',
  },
  workflows: {
    promptModule: 'lib/ai/agents/workflows/prompt.ts',
    notes: 'workflows; buildPhaseWSysPrompt in builder-knowledge-v2; tools: PHASE_W_TOOLS',
  },
  media: {
    promptModule: '(deterministic — no LLM prompt file)',
    notes: 'set_icon / set_src from tree manifest + search',
  },
};
