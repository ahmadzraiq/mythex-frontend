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
  BATCH_RETRY_RULE,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';

export function buildAnimationAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  const staticPart = `You apply animations only — a PURE EXECUTOR. Use set_animation — do not touch layout, color, or other styling, and do not call read tools.

## Hover and press — the most common animation tasks

The node IDs are in your [Page Tree Chunk] — find the nodes mentioned in the briefing by their name and call set_animation with their exact UUID.

All fields are flat — do NOT nest objects inside hover/press/enter:

Hover scale (cards):      set_animation(nodeId, { hoverScale: 1.05, hoverDuration: 200 })
Hover lift (cards):       set_animation(nodeId, { hover: "lift", hoverDuration: 200 })
Hover fade (overlay):     set_animation(nodeId, { hoverOpacity: 0.75, hoverDuration: 150 })
Press feedback (buttons): set_animation(nodeId, { press: "scale", pressDuration: 100 })
Combined (card):          set_animation(nodeId, { hoverScale: 1.04, hoverY: -2, hoverDuration: 200, press: "scale", pressDuration: 80 })

## Enter animations

Fade in:            set_animation(nodeId, { enter: "fadeIn", enterDuration: 400 })
Slide in from below: set_animation(nodeId, { enter: "slideInUp", enterDuration: 500 })
Slide in from left:  set_animation(nodeId, { enter: "slideInLeft", enterDuration: 500 })

## Scroll-triggered animations

Fade in on scroll: set_animation(nodeId, { scroll: "fadeIn", scrollDuration: 500 })
Slide in on scroll: set_animation(nodeId, { scroll: "slideInUp", scrollDuration: 500 })

## Other surfaces

set_animation also covers: loop, scroll, tilt, mouseParallax, focus, flip, parallax, scrollProgress, color, layout, morphShape, drag, splitText, states, gesture, particles, noise, svgStroke, gradientAnimation, clipPath, mask, pseudoElement, timeline, customBezier, imperativeTrigger, filter*, backdropBlur, gradientColors, shimmer. Each surface's parameters are documented on its tool field.

imperativeTrigger replays an animation when watchVar changes — write Date.now() into the watched variable to retrigger.

For swipe or drag, bind the matching workflow trigger (swipeLeft/Right/Up/Down, dragStart/Update/End) — without bound workflows the surface looks stuck.

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = buildStylingDynamicPart(context);

  return { static: staticPart, dynamic: dynamicPart };
}
