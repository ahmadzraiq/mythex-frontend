/**
 * Builder Knowledge Base — live exports consumed by agent prompts.
 *
 * Dead prompt builders (buildChatSystemPrompt, buildPhase3SystemPrompt, PLAN_SYSTEM)
 * and their private concept blocks have been removed. The live pipeline is:
 *   Context Agent → Planner (PLANNER_SYSTEM) → Structure (deterministic) → parallel specialists
 * Each specialist carries its own focused prompt under lib/ai/agents/<scope>/prompt.ts.
 *
 * TOOL_DESCRIPTIONS lives in lib/ai/tool-descriptions.ts.
 */

// ─── Component AI Refs (the 8 real primitives) ───────────────────────────────
// Everything else (cards, navbars, lists, forms, sliders, switches, etc.) is
// composed via Box + child primitives OR placed via add_shared_component_instance.

export const COMPONENT_AI_REFS: Record<string, string> = {
  'Box':      'Universal container. Use for ALL structural UI: buttons, cards, sections, navbars, badges, sliders, switches, checkboxes, etc.',
  'Text':     'Leaf text node. No children.',
  'Input':    'Single-line text input. No children.',
  'Textarea': 'Multi-line text input. No children.',
  'Image':    'Image element. No children.',
  'Icon':     'Iconify icon node. No children.',
  'Video':    'Video element. No children.',
  'Iframe':   'Embedded iframe. No children.',
};

export function buildComponentList(): string {
  return `Available labels: ${Object.keys(COMPONENT_AI_REFS).join(', ')}`;
}

// Re-export TOOL_DESCRIPTIONS for any callers that still import from this module.
export { TOOL_DESCRIPTIONS } from './tool-descriptions';
