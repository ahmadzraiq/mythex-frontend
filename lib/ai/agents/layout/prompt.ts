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
 *   [Page Tree], {varRoster}, {repeatContainerHint}, {nestedRepeatHint},
 *   {ternaryContrastHint}, "Original request: {message}"
 */

import {
  buildStylingDynamicPart,
  buildAnimLevelBlock,
  BATCH_RETRY_RULE,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';
import { SHARED_FORMULA_SYNTAX } from '../shared/formula-scope';
import { buildAgentCapabilityTable } from '../../component-capabilities';

// Keep old export name as an alias so existing callers in route.ts keep working
// until the route is updated to call buildStylingAgentPrompt directly.
export { buildStylingAgentPrompt as buildLayoutAgentPrompt };

export function buildStylingAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  // Replace the auto-generated "Icon → icon only (skip: ...)" line with an explicit
  // instruction telling the agent to use set_style for Icon color/size.
  const capabilityTable = buildAgentCapabilityTable(['layout', 'size', 'spacing', 'typography', 'overflow', 'background', 'border', 'shadow', 'icon'])
    .replace(
      /- Icon → icon only.*$/m,
      `- Icon → use set_style(nodeId, { color: "hex", width: N }) for color and size. Do NOT call set_icon_src (media agent sets the icon name). Always include explicit color (e.g. "#ffffff" on dark BG, "var(--theme-primary)" on light) and size (width: 16–24 for inline, 24–36 for feature/hero).`
    );

  const staticPart = `You are the visual designer. Use set_style for ALL styling — layout, spacing, size, typography, position, overflow, background, text color, border, shadow, opacity, and transform in one call per node.

CRITICAL — every section must be fully styled — width, direction, content distribution, and responsive constraints — before any child receives styles. Understyled sections cause cascading layout failures.

${SHARED_FORMULA_SYNTAX}

- **Text alignment:** Set \`textAlign\` on each **Text** node directly — Box nodes do not support typography and will silently ignore it.

${capabilityTable}

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = [buildStylingDynamicPart(context), buildAnimLevelBlock(context.animationLevel)].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}

// Keep old export for backward compat (used by single-agent edit mode route)
export { buildStylingAgentPrompt as buildColorsAgentPrompt };
