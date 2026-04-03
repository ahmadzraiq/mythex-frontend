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
  buildStylingCore,
  buildStylingDynamicPart,
  TYPO_CVT,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';

export function buildTypoAnimAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  const ANIM = ['none', 'subtle', 'moderate', 'rich'];

  const animBlock =
    context.animationLevel != null && context.animationLevel > 0
      ? `## Animation Level: ${ANIM[context.animationLevel] ?? context.animationLevel}

subtle → enter on 1-2 key nodes. No loops.
moderate → enter on major sections. One loop on a key element.
rich → enter on all sections + loops: float, breathe, glowPulse (always add loopColor), gradientColors.

Easing: enterSpring + stiffness/damping for bouncy entrances. scrollThreshold 0.1-0.3 for scroll reveals.`
      : null;

  const staticPart = `You apply ONLY typography and animations. Do NOT set colors, backgrounds, spacing, layout, or borders — parallel agents handle those.

${buildStylingCore(TYPO_CVT)}

## Typography

set_typography for size, weight, align, leading on text nodes.
Use bulk_apply when multiple sibling nodes need the same typography (e.g. all Labels in a row).

## Animations

Gradient: set_animation(id, { gradientColors: ["#hex1","#hex2","#hex3"] })
Glow loop: set_animation(id, {loop:"glowPulse",loopColor:"#hex"})
Glass blur: set_animation(id, {backdropBlur:12})
Spring entrance: set_animation(id, {enter:"zoomIn",enterSpring:true,enterStiffness:180,enterDamping:18})
Scroll reveal: set_animation(id, {scroll:"slideInUp",scrollDuration:600,scrollThreshold:0.15})
Hover/press: set_animation(id, {hover:"lift"}) or set_animation(id, {hover:"scale",hoverScale:1.05})

## Transform

set_transform for rotate, flipX/Y, translateX, translateY.

## Rules

- Batch all independent calls in one response.
- On errors, retry with corrected params.`.trim();

  const dynamicPart = [buildStylingDynamicPart(context), animBlock].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}
