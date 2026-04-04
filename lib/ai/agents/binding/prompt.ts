/**
 * Binding agent — connects data to nodes (text, repeat, condition, icons).
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: BINDING_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: set_text, set_repeat, set_condition, set_disabled,
 *             set_icon (icon-name-only variant — color/size stripped via stripIconColorSize)
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
 *   {markersNote}       ← list of node IDs with _needsRepeat / _needsCondition markers
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
 *   - markersNote (extracted _needsRepeat / _needsCondition markers)
 *   - varRoster (add_variable events → variable name + UUID + field schema)
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * No output consumed by other agents — runs in parallel with layout/colors/typo/workflows.
 * Emits tool_executed SSE events (set_text, set_repeat, set_condition, set_icon)
 * executed client-side by tool-executor.ts.
 */

import { SHARED_FORMULA_SYNTAX } from '../shared/formula-scope';
import { BATCH_RETRY_RULE } from '../shared/styling-subagent';
import { buildAgentCapabilityTable } from '../../component-capabilities';

export function buildBindingAgentPrompt(): { static: string; dynamic: string } {
  const staticContent = `You connect data to UI nodes. Do NOT style or create workflows.

${SHARED_FORMULA_SYNTAX}

## System-Specific Rules

- Read \`_needsRepeat\` / \`_needsCondition\` markers from the tree and bind accordingly.
- NEVER set_condition on the template root (the node with set_repeat) — it hides items instead of filtering. Use conditions only on child nodes inside the template.
- In nested repeats: \`context?.item?.data\` = inner item, \`context?.item?.parent?.data\` = outer item.
- Use EXACT field names from the variable roster — misspelled names resolve to undefined.

${buildAgentCapabilityTable(['text', 'disabled', 'icon'])}

${BATCH_RETRY_RULE}`;

  return { static: staticContent, dynamic: '' };
}
