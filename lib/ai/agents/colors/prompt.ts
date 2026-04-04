/**
 * Colors + Animation styling sub-agent — backgrounds, text colors, borders, shadows, opacity, icon color/size, animations.
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: COLORS_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_background, set_text_color, set_border, set_shadow, set_opacity,
 *             set_icon (color/size variant — icon name stripped via stripIconName),
 *             set_animation, bulk_apply
 * Read tools available via buildReadHandlers: get_page_tree, get_variables,
 *       get_pages, get_workflows, get_formula_context, search_nodes.
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static:  buildColorsAgentPrompt(context).static (this file)
 * Dynamic: buildColorsAgentPrompt(context).dynamic via buildStylingDynamicPart(stylingCtx)
 *   stylingCtx fields: pages, currentPageName, currentPageRoute, paletteSnapshot,
 *                      mood, animationLevel, appName, description, category
 *   Injects: ## Project (category, animation level), ## Builder (page info),
 *            ## Theme (live palette snapshot with hex values)
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts parallel block (~line 1147):
 *   "[Context]\n{contextNote}\n\n"  (optional)
 *   "[Colors Agent]\nApply all colors, backgrounds, text colors, borders, shadows…"
 *   [Page Tree — use exact node UUIDs]
 *   {compactTree}            ← text representation of node tree from structure pass
 *   {varRoster}              ← variable name + UUID + field schema (for ternary formulas)
 *   {repeatContainerHint}    ← REPEAT LAYOUT RULE lines
 *   {nestedRepeatHint}       ← (NESTED) annotations for nodes inside nested repeats
 *   {ternaryContrastHint}    ← TERNARY CONTRAST REQUIRED node list
 *   "Repeat template reminder: style ALL children…"
 *   "Original request: {message}{relationsNote}{pageContextNote}"
 *
 * ─── Read handlers ────────────────────────────────────────────────────────────
 * buildReadHandlers: get_page_tree, get_variables, get_pages, get_workflows,
 *                    get_formula_context, search_nodes
 *
 * ─── Upstream ────────────────────────────────────────────────────────────────
 * Receives from structure agent: compactTree, varRoster, repeatContainerHint,
 *   nestedRepeatHint, ternaryContrastHint (route derives these from collected trees).
 * Shares stylingCtx with layout.
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * No output consumed by other agents — runs in parallel with binding/layout/workflows.
 * Emits tool_executed SSE events executed client-side by tool-executor.ts.
 */

import {
  buildStylingDynamicPart,
  buildAnimLevelBlock,
  BATCH_RETRY_RULE,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';
import { SHARED_FORMULA_SYNTAX } from '../shared/formula-scope';
import { buildAgentCapabilityTable } from '../../component-capabilities';

export function buildColorsAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  const staticPart = `You apply colors, backgrounds, text colors, borders, shadows, opacity, icon color/size, and animations. No spacing, layout, or typography — the layout agent handles those.

glowPulse and ripple loops ALWAYS require loopColor. gradientDrift requires gradientColors set first.

${SHARED_FORMULA_SYNTAX}

## System-Specific Rules

- **Ternary contrast:** When a repeated template gets a ternary background, ALL text/icon descendants MUST use matching ternaries with the same condition.
- In nested repeats, use \`context?.item?.parent?.data\` for the outer item's fields.
- Static token: \`set_background(id, {bg:"primary"})\`. Formula ternary: \`"COND ? 'theme:primary' : 'theme:card'"\`.
- Use bulk_apply for sibling groups with identical colors or animations.

${buildAgentCapabilityTable(['background', 'border', 'shadow', 'typography', 'icon'])}

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = [buildStylingDynamicPart(context), buildAnimLevelBlock(context.animationLevel)].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}
