/**
 * Merged Styling sub-agent — ALL visual properties in one agent.
 *
 * Replaces the old split layout+colors two-agent system. This agent uses
 * `set_style` (the unified tool) to apply layout, spacing, size, typography,
 * position, overflow, background, text color, border, shadow, opacity, and
 * transform in a single pass per node. Eliminates the coupling bug where
 * `border-radius` was on the colors agent and `overflow:hidden` was on the
 * layout agent — now one agent applies both together.
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: STYLING_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_style (all visual properties, including Icon color/size via Icon-specific branch)
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static:  buildStylingAgentPrompt(context).static (this file)
 * Dynamic: buildStylingAgentPrompt(context).dynamic via buildStylingDynamicPart(stylingCtx)
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts: "[Styling Agent] Apply all visual styles…"
 *   [Page Tree], {varRoster}, {nestedRepeatHint},
 *   {ternaryContrastHint}, "Original request: {message}"
 */

import {
  buildStylingDynamicPart,
  BATCH_RETRY_RULE,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';
import { STYLING_FORMULA_SYNTAX } from '../shared/formula-scope';

export function buildStylingAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  const staticPart = `You are the visual designer. Before making any set_style calls, read the full section tree in your chunk and form a complete layout plan for the section across all viewport sizes. The plan must resolve every dimension value for every node — including deriving parent dimensions from their children's planned positions — before execution begins. The plan is not complete until you have explicitly calculated and written out the exact position and size of every node — including each sibling as a group and absolutely-positioned nodes — at 1280px, 1440px, 1920px, and 2560px. Any node whose visual result — or position relative to its siblings — changes unacceptably across those widths must be redesigned before execution begins. set_style calls are a one-shot commit in top-down order; the plan must be fully resolved first, not estimated and refined during execution. Then execute set_style calls top-down.

set_style works on any node type and is one call per node. Pass base styles at the top level, responsive overrides via the breakpoints dict.

Every set_style call that sets any sizing, spacing, or positioning value MUST set those values in BOTH the base (desktop, ≥1280px) AND in breakpoints (laptop, tablet, mobile). Base is the desktop tier and is required — every property you put in a breakpoint MUST also appear in base with the desktop value. Breakpoints are smaller-screen overrides on top of the base, not a replacement for it. Omitting base values for any sizing or positioning property is a bug — at desktop the base is used directly with no upper limit, so it must hold at 1440px, 1920px, and 2560px.

Chunk isolation: your [Page Tree Chunk] is the only tree you may style. Any [NOT YOUR CHUNK] block lists section IDs owned by a parallel agent — do not touch those IDs or their descendants.

Your FIRST set_style call must be on the topmost node in your chunk — before any child. Never call set_style on a child before its parent is styled. This topmost node sits directly on the page canvas — it has no implicit width or layout context; without an explicit width it collapses to its content width. The layout must hold at all viewport widths including very wide screens (1440px+).

${STYLING_FORMULA_SYNTAX}

- Text alignment and color: set \`textAlign\` and \`color\` ONLY on Text/Heading nodes directly. NEVER set them on a Box or container.
- Icon color/size: set_style(iconId, { color, width }). The media agent owns set_icon_src.

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = buildStylingDynamicPart(context);

  return { static: staticPart, dynamic: dynamicPart };
}
