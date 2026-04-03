/**
 * Layout styling sub-agent — spacing, sizing, layout, position, overflow only.
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: LAYOUT_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_spacing, set_size, set_position, set_overflow, set_layout
 * Note: route strips the `direction` param from set_layout before passing to
 *       this agent (direction is already embedded in node structure).
 * Read tools available via buildReadHandlers: get_page_tree, get_variables,
 *       get_pages, get_workflows, get_formula_context, search_nodes.
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static:  buildLayoutAgentPrompt(context).static (this file)
 * Dynamic: buildLayoutAgentPrompt(context).dynamic via buildStylingDynamicPart(stylingCtx)
 *   stylingCtx fields: pages, currentPageName, currentPageRoute, paletteSnapshot,
 *                      mood, animationLevel, appName, description, category
 *   Injects: ## Project (category, animation level), ## Builder (page info),
 *            ## Theme (live palette snapshot with hex values)
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts parallel block (~line 1127):
 *   "[Context]\n{contextNote}\n\n"  (optional — selected-node info)
 *   "[Layout Agent]\nThe structure ALREADY EXISTS — do NOT create or modify structure. …"
 *   [Page Tree — use exact node UUIDs]
 *   {compactTree}           ← text representation of node tree from structure pass
 *   {repeatContainerHint}   ← REPEAT LAYOUT RULE lines from detectRepeatContainerPairs()
 *   "Original request: {message}{relationsNote}{pageContextNote}"
 *
 * ─── Read handlers ────────────────────────────────────────────────────────────
 * buildReadHandlers: get_page_tree, get_variables, get_pages, get_workflows,
 *                    get_formula_context, search_nodes
 *
 * ─── Upstream ────────────────────────────────────────────────────────────────
 * Receives from structure agent: compactTree, repeatContainerHint
 * Shares stylingCtx with colors and typo-anim (same StylingSubAgentContext).
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * No output consumed by other agents — runs in parallel with binding/colors/typo/workflows.
 * Emits tool_executed SSE events executed client-side by tool-executor.ts.
 */

import {
  buildStylingCore,
  buildStylingDynamicPart,
  LAYOUT_CVT,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';

export function buildLayoutAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  const staticPart = `You apply ONLY spacing, sizing, layout, display, position, and overflow. Do NOT set colors, typography, or animations — parallel agents handle those.

${buildStylingCore(LAYOUT_CVT)}

## Grid Components

set_layout(gridCols) ONLY on the Grid node — NEVER on the Card template or a page wrapper.

**Grid node vs Card template:**
- \`set_layout(gridCols:3)\` → Grid (container)
- \`set_spacing(gap:32)\` → Grid (container)
- \`set_layout(align/justify)\` → Grid (container)
- Per-card padding → Card template (child with repeat markers)

**Item elevation:** \`set_position(position:"relative", top:-20)\` on the template node itself.

## Root Container

The page root wrapper typically needs:
- set_size(width:"screen") to fill the viewport
- set_layout(align:"center") to horizontally center content sections
- set_spacing(p:...) for page-level padding

Content sections inside should use set_size(width:"full") and optional max-width constraints.

## Absolute Cover Pattern

When an element should cover its parent (video background, overlay, image background):
- Position: set_position(id, {position:"absolute", top:0, left:0, zIndex:N})
- Size: set_size(id, {width:"full", height:"full"})
- Use height:"full" (100% of parent) — NOT height:"screen" (100vh). height:"screen" overflows the parent and ignores its actual height. height:"full" matches the parent exactly.
- NEVER use height:"fill" on absolute elements — flex-grow has no effect on absolute positioning.
- The parent MUST have set_position(id, {position:"relative"}) so absolute children stay within it.

## Repeat Item Variants (position/size/display)

When a repeat item has a boolean field and you need conditional position, size, or display:
- \`set_position(id, {position:"relative", top:"context?.item?.data?.featured ? -20 : 0"})\`
- \`set_condition(id, {condition:"context?.item?.data?.featured"})\` (hide/show via condition)

## Efficiency — Skip Default Values

Do NOT call tools when the result would be a no-op (default already applied):
- Leaf nodes (Text, Heading, Icon, Caption, Label) do NOT need set_size(width:"fit",height:"fit") — it is the default.
- Buttons already have built-in padding for consistent height. Do NOT set fixed height (set_size height) on button nodes — let padding control height.

Only call tools when CHANGING something from the default:
- Grid: set_layout(gridCols:N)
- Containers: set_spacing(gap, padding, margin) when non-zero
- Containers: set_layout(align, justify) when not the component default
- Containers: set_size when changing to "full", "screen", or a specific px value
- Position: set_position only when offset is needed

## Rules

- Batch all independent calls in one response.
- On errors, retry with corrected params.`.trim();

  return { static: staticPart, dynamic: buildStylingDynamicPart(context) };
}
