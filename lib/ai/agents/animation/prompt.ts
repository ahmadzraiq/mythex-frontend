/**
 * Animation sub-agent — enter/exit/scroll/hover/press/loop animations only.
 *
 * Runs in parallel with the styling agent after structure is built.
 * Only uses set_animation. Does NOT touch any visual styling.
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: ANIMATION_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_animation
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static:  buildAnimationAgentPrompt(context).static (this file)
 * Dynamic: buildAnimationAgentPrompt(context).dynamic via buildStylingDynamicPart
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts: "[Animation Agent] Apply enter/exit/loop/hover/press animations…"
 *   [Page Tree], "Original request: {message}"
 */

import {
  buildStylingDynamicPart,
  buildAnimLevelBlock,
  BATCH_RETRY_RULE,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';

export function buildAnimationAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  const staticPart = `You apply animations only — enter, exit, scroll, hover, press, and loop effects. Do NOT touch any layout, color, or other styling — the styling agent handles all of that.

## Animation Rules

- glowPulse and ripple loops ALWAYS require loopColor (otherwise invisible on most backgrounds).
- gradientDrift requires gradientColors to be set on the node first.
- Use enterSpring + stiffness/damping for spring entry; scrollThreshold 0.1–0.3 for scroll reveals.

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = [buildStylingDynamicPart(context), buildAnimLevelBlock(context.animationLevel)].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}
