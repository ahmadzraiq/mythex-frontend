/**
 * Typography + animation styling sub-agent.
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: TYPO_ANIM_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_typography, set_transform, set_animation, bulk_apply
 * Read tools available via buildReadHandlers: get_page_tree, get_variables,
 *       get_pages, get_workflows, get_formula_context, search_nodes.
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static:  buildTypoAnimAgentPrompt(context).static (this file)
 * Dynamic: buildTypoAnimAgentPrompt(context).dynamic
 *   = buildStylingDynamicPart(stylingCtx)  +  optional animation level block
 *   stylingCtx fields: pages, currentPageName, currentPageRoute, paletteSnapshot,
 *                      mood, animationLevel, appName, description, category
 *   Animation level block: injected only when animationLevel > 0; describes
 *     subtle/moderate/rich guidance for enter, scroll, and loop animations.
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts parallel block (~line 1170):
 *   "[Context]\n{contextNote}\n\n"  (optional)
 *   "[Typography + Animation Agent]\nApply typography … and all animations…"
 *   [Page Tree — use exact node UUIDs]
 *   {compactTree}   ← text representation of node tree from structure pass
 *   "Original request: {message}{relationsNote}{pageContextNote}"
 *
 * ─── Read handlers ────────────────────────────────────────────────────────────
 * buildReadHandlers: get_page_tree, get_variables, get_pages, get_workflows,
 *                    get_formula_context, search_nodes
 *
 * ─── Upstream ────────────────────────────────────────────────────────────────
 * Receives from structure agent: compactTree.
 * Shares stylingCtx with layout and colors.
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * No output consumed by other agents — runs in parallel with binding/layout/colors/workflows.
 * Emits tool_executed SSE events executed client-side by tool-executor.ts.
 */

import {
  buildStylingDynamicPart,
  buildAnimLevelBlock,
  BATCH_RETRY_RULE,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';
import { buildAgentCapabilityTable } from '../../component-capabilities';

export function buildTypoAnimAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  const staticPart = `You apply ONLY typography and animations. No colors, backgrounds, spacing, layout, or borders.

glowPulse and ripple loops ALWAYS require loopColor. gradientDrift requires gradientColors set first.

${buildAgentCapabilityTable(['typography'])}

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = [buildStylingDynamicPart(context), buildAnimLevelBlock(context.animationLevel)].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}
