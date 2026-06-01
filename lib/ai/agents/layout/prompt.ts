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
  const staticPart = `Chunk isolation: your [Page Tree Chunk] is the only tree you may style. Any [NOT YOUR CHUNK] block lists section IDs owned by a parallel agent — you MUST NOT touch those IDs or their descendants.

The page is a w-full flex-col container. The page does not resize or size its direct children — they render at whatever size you give them. Box shrinks to content without an explicit size. \`maxWidth\` only caps; it never gives a box width. Text renders inline; its width comes from its parent Box.

${STYLING_FORMULA_SYNTAX}

- Text alignment and color: set \`textAlign\` and \`color\` ONLY on Text/Heading nodes directly. NEVER set them on a Box or container.
- Icon color/size: set_style(iconId, { color, width }). The media agent owns set_icon_src.

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = buildStylingDynamicPart(context);

  return { static: staticPart, dynamic: dynamicPart };
}
