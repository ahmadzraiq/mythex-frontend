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
 * Tool names: set_style (all visual properties), set_icon (color/size)
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
  // instruction that tells the agent WHICH tool to call (set_icon) and with what params.
  const capabilityTable = buildAgentCapabilityTable(['layout', 'size', 'spacing', 'typography', 'overflow', 'background', 'border', 'shadow', 'icon'])
    .replace(
      /- Icon → icon only.*$/m,
      `- Icon → call set_icon(nodeId, size: N, color: "hex") — NOT set_style. set_style has zero effect on Icon nodes. Always call set_icon with explicit size (16–24px) and color.`
    );

  const staticPart = `You are the visual designer. Use set_style for ALL styling — layout, spacing, size, typography, position, overflow, background, text color, border, shadow, opacity, and transform in one call per node.

CRITICAL — defaults (don't repeat what's already there):
- Box nodes already have \`flex flex-col\` — call set_style(direction:"row") ONLY when you want a row. NEVER pass direction:"column" — it is the default.
- Every other property starts at ZERO — no padding, no margin, no gap, no width, no height, no color.
- Multi-column equal splits: use flex:1 on children, NOT width:%. Asymmetric: use gridCols fr-template (e.g. "3fr 2fr").
- Root node context: page root uses items-start — ALWAYS set width:"100%" on every root section node.

${SHARED_FORMULA_SYNTAX}

## System-Specific Rules

- **Ternary contrast:** When a repeated template gets a ternary background, ALL text/icon descendants MUST use matching ternaries with the same condition. For Text nodes: \`set_style(color: "COND ? 'theme:A' : 'theme:B'")\`. For Icon nodes: \`set_icon(nodeId, { color: "COND ? 'theme:primary-foreground' : 'theme:primary'" })\` — NEVER set_style on an Icon (no effect).
- In nested repeats, use \`context?.item?.parent?.data\` for the outer item's fields.
- Static token: \`set_style(id, {bg:"primary"})\`. Formula ternary: \`"COND ? 'theme:primary' : 'theme:card'"\`.
- **bg = solid colors ONLY.** Never pass a gradient string to \`bg\` — it produces an invalid CSS class. For gradients use the structured \`gradient\` param OR \`bgImage: "linear-gradient(...)"\` (raw CSS string). Example: \`set_style(id, { bgImage: "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)" })\`.
- glowPulse and ripple loops ALWAYS require loopColor. gradientDrift requires gradientColors set first.
- **DarkOverlay** (hint \`"role:dark overlay"\`): \`bg: "rgba(0,0,0,0.55)"\`, \`zIndex: 10\`. Text/content containers above it MUST receive \`zIndex: 20\` — never \`pointer-events-none\`. Only the overlay node itself has \`pointer-events-none\` (applied automatically by the system).
- **Card row** (hint \`"role:card row"\`): always set \`direction: "row"\`. Box defaults to \`flex-col\` — without this the cards stack vertically.

${capabilityTable}

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = [buildStylingDynamicPart(context), buildAnimLevelBlock(context.animationLevel)].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}

// Keep old export for backward compat (used by single-agent edit mode route)
export { buildStylingAgentPrompt as buildColorsAgentPrompt };
