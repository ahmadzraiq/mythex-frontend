/**
 * Layout styling sub-agent — layout, spacing, sizing, typography, position, overflow, transform.
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: LAYOUT_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_layout (layout + spacing + sizing + typography + position + insets), set_overflow, set_transform
 * Note: set_layout direction param is available — use it to switch a node to row when
 *       needed. Box defaults to flex-col; never override column to row speculatively.
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
 * Shares stylingCtx with colors (same StylingSubAgentContext).
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * No output consumed by other agents — runs in parallel with binding/colors/workflows.
 * Emits tool_executed SSE events executed client-side by tool-executor.ts.
 */

import {
  buildStylingDynamicPart,
  BATCH_RETRY_RULE,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';
import { buildAgentCapabilityTable } from '../../component-capabilities';

export function buildLayoutAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  const staticPart = `You are a layout and typography designer. Use set_layout for ALL non-color styles: flex/grid layout, spacing (gap, padding, margin), sizing (width, height, min/max), typography (fontSize, weight, textAlign, leading, tracking, decoration, etc.), and position/insets (position, zIndex, top, right, bottom, left). Also use set_overflow and set_transform. No colors or animations — parallel agents handle those.

CRITICAL: Every node starts with ZERO styling — no padding, no margin, no gap, no width, no height, no flex alignment (align, justify), no typography. The ONE exception: Box nodes default to \`flex flex-col\` — you do NOT need to call set_layout to set direction:column. Only call set_layout(direction:"row") when you explicitly want a row. Never override a column container to row just because it has multiple children.

Fill-axis rule: flex:1 fills the parent's MAIN AXIS — width in flex-row parents, height in flex-col parents (the default). Use it for equal-share columns: set parent direction:"row", set flex:1 on each child. For fill-width in a flex-col parent use width:"100%" instead. For fill-height in a flex-row parent use self:"stretch" instead.

Root node context: the outermost node in the tree is a direct child of the page's flex-col column.

Read the tree and the original request to understand each element's role — node names, structure, and children tell you everything. Think in layout systems first — choose a flex or grid distribution strategy per container, then apply spacing, sizing, and typography to each node.


${buildAgentCapabilityTable(['layout', 'size', 'spacing', 'typography', 'overflow'])}

${BATCH_RETRY_RULE}`.trim();

  return { static: staticPart, dynamic: buildStylingDynamicPart(context) };
}
