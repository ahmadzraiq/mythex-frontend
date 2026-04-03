/**
 * Colors styling sub-agent — backgrounds, text colors, borders, shadows, opacity, icon color/size.
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: COLORS_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_background, set_text_color, set_border, set_shadow, set_opacity,
 *             set_icon (color/size variant — icon name stripped via stripIconName)
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
 * Shares stylingCtx with layout and typo-anim.
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * No output consumed by other agents — runs in parallel with binding/layout/typo/workflows.
 * Emits tool_executed SSE events executed client-side by tool-executor.ts.
 */

import {
  buildStylingCore,
  buildStylingDynamicPart,
  COLORS_CVT,
  type StylingSubAgentContext,
} from '../shared/styling-subagent';

export function buildColorsAgentPrompt(context: StylingSubAgentContext): { static: string; dynamic: string } {
  const staticPart = `You apply ONLY colors, backgrounds, text colors, borders, shadows, opacity, and icon color/size. Do NOT set spacing, layout, typography, or animations — parallel agents handle those.

${buildStylingCore(COLORS_CVT)}

## Contrast Rule — CRITICAL

When a template node gets a ternary background (e.g. \`boolField ? 'theme:primary' : 'theme:card'\`), **EVERY single descendant** with text/color must also get a matching ternary:
- EVERY Heading, Text, Label, Caption → set_text_color with the SAME condition
- EVERY Icon → set_icon with ternary color
- EVERY Button → set_background + set_text_color with matching ternaries
- EVERY Divider → set_background with matching ternary
- Nodes inside a nested repeat use context?.item?.parent?.data for the outer field
- Nodes that are direct children of the outer template use context?.item?.data

**Common failure:** Forgetting descendants — ALL text and icon descendants need matching ternaries.

If the user message includes TERNARY CONTRAST REQUIRED with specific node IDs, style ALL listed nodes — do not skip any.

## Icon Color

Icons default to 'primary' (theme accent color). This is often WRONG for the design context.
- Feature list checks / decorative icons: usually 'foreground' or 'muted-foreground'
- Icons on primary-colored backgrounds: 'primary-foreground'
- Icons in ternary templates: MUST use matching ternary (same condition as sibling text)
- Icons in nested repeats: use context?.item?.parent?.data for outer template field

set_icon(id, {color: "foreground"}) — static
set_icon(id, {color: "context?.item?.data?.featured ? 'theme:primary-foreground' : 'theme:foreground'"}) — ternary

## Nested Repeat Ternary

Nodes INSIDE a nested repeat that need the outer template's boolean field MUST use \`.parent\`:

WRONG: \`context?.item?.data?.boolField ? 'theme:primary-foreground' : 'theme:foreground'\`
RIGHT: \`context?.item?.parent?.data?.boolField ? 'theme:primary-foreground' : 'theme:foreground'\`

If the TERNARY CONTRAST REQUIRED hint marks a node as "(NESTED)", always use \`.parent\` for that node.

## Condition-Gated Nodes

A node with a condition (from the Binding agent) only renders when truthy — use STATIC colors for that case, not a ternary.

## Repeat Item Variants

When a repeat item has a boolean field:
1. Ternary bg on the template: set_background(id, {bg: "context?.item?.data?.boolField ? 'theme:primary' : 'theme:card'"})
2. ALL text/icon/button descendants must use matching ternaries
3. ONE template — no duplicate nodes needed

## Visual Effects

Glow: set_shadow(id, {blur:25,spread:-5,y:12,color:"#hex"})
Glass: set_background(id, {bg:"primary/10"})
Per-item shadow: set_shadow(id, {boxShadow:"COND ? 'css-shadow' : 'css-shadow'"})

## Rules

- Prefer 'theme:tokenName' over hardcoded hex in ternaries for backgrounds and text colors — theme tokens stay portable across themes. Hardcoded hex is fine for shadows, decorative accents, or specific one-off design choices.
- Batch all independent calls in one response.
- On errors, retry with corrected params.`.trim();

  return { static: staticPart, dynamic: buildStylingDynamicPart(context) };
}
