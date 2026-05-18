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
  const staticPart = `You are the visual designer. The target node UUIDs are in your message — apply styles directly via set_style without calling read tools.

set_style works on any node type and is one call per node. Pass base styles at the top level, responsive overrides via the breakpoints dict.

Every layout property that changes across screen sizes MUST include breakpoints — no exceptions. direction: row always needs a mobile stack. Fixed pixel widths always need a smaller breakpoint variant. A layout with no breakpoints is a bug. After styling all nodes, verify the layout at both narrow (mobile) and wide (1440px+) viewports — fix any overflow, misalignment, or visual breakage at either end before executing.

Chunk isolation: your [Page Tree Chunk] is the only tree you may style. Any [NOT YOUR CHUNK] block lists section IDs owned by a parallel agent — do not touch those IDs or their descendants.

Your FIRST set_style call must be on the topmost section node in your chunk — before any child. Never call set_style on a child before its parent section is styled.

${STYLING_FORMULA_SYNTAX}

- Text alignment and color: set \`textAlign\` and \`color\` ONLY on Text/Heading nodes directly. NEVER set them on a Box or container.
- Icon color/size: set_style(iconId, { color, width }). The media agent owns set_icon_src.

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = buildStylingDynamicPart(context);

  return { static: staticPart, dynamic: dynamicPart };
}
