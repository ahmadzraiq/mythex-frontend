/**
 * Binding agent — connects data to nodes (text, repeat, condition, icons, media src).
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: BINDING_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_text, set_src, set_repeat, set_condition, set_disabled,
 *             set_icon_src (icon name only — color/size handled by styling agent via set_style)
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static only: buildBindingAgentPrompt().static (this file)
 * No dynamic block — the agent receives all context via the user message.
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts parallel block (~line 1101):
 *   "[Binding Agent] Connect data to all nodes. Apply set_repeat, set_text, set_condition…"
 *   [Page Tree — use exact node UUIDs]
 *   {compactTree}       ← text representation of node tree from structure pass
 *   {markersNote}       ← list of node IDs with loop / showIf markers
 *   {varRoster}         ← "Available variables (ONLY these UUIDs are valid): …"
 *   "Bind ALL text nodes with their data fields from the variable initialValue."
 *   "Original request: {message}"
 *
 * ─── Read handlers ────────────────────────────────────────────────────────────
 * None attached for binding loop (binding uses static data from user message).
 *
 * ─── Upstream ────────────────────────────────────────────────────────────────
 * Receives from structure agent:
 *   - compactTree (text tree with UUIDs)
 *   - markersNote (extracted loop / showIf markers)
 *   - varRoster (add_variable events → variable name + UUID + field schema)
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * No output consumed by other agents — runs in parallel with layout/colors/typo/workflows.
 * Emits tool_executed SSE events (set_text, set_repeat, set_condition, set_icon_src)
 * executed client-side by tool-executor.ts.
 */

import { SHARED_FORMULA_SYNTAX } from '../shared/formula-scope';
import { BATCH_RETRY_RULE } from '../shared/styling-subagent';
import { buildAgentCapabilityTable } from '../../component-capabilities';

export function buildBindingAgentPrompt(): { static: string; dynamic: string } {
  const staticContent = `You connect data to UI nodes. Do NOT style or create workflows.

${SHARED_FORMULA_SYNTAX}

## System-Specific Rules

- Read \`loop\` / \`showIf\` markers from the tree and bind accordingly.
- NEVER set_condition on the template root (the node with set_repeat) — it hides items instead of filtering. Use conditions only on child nodes inside the template.
- In nested repeats: \`context?.item?.data\` = inner item, \`context?.item?.parent?.data\` = outer item.
- Use EXACT field names from the variable roster — misspelled names resolve to undefined.
- **Image or Video inside a repeat template**: call \`set_src(imageId, { src: "context?.item?.data?.avatar" })\` using the exact field name from the variable's initialValue schema (e.g. \`avatar\`, \`videoSrc\`). The executor stores it as a formula — each rendered card gets its own URL from the item data.
- **Only call \`set_src\` inside repeat templates.** For Image/Video nodes outside a repeat template, skip entirely — the media agent owns their source. Never call \`set_src\` with a static URL string.
- **Boolean toggle → ternary text binding**: When a boolean variable is in the varRoster and the repeat template's data schema has two variant fields for the same concept (two alternative values a text node could display depending on state), bind that text node as a ternary: \`variables['BOOL_UUID'] ? context?.item?.data?.fieldA : context?.item?.data?.fieldB\`. Do NOT bind to a single static field when a boolean variable controls which value is visible. Apply the same ternary to every text node whose displayed value depends on that boolean.

${buildAgentCapabilityTable(['text', 'src', 'disabled', 'icon'])}

${BATCH_RETRY_RULE}`;

  return { static: staticContent, dynamic: '' };
}
