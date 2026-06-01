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

export function buildBindingAgentPrompt(): { static: string; dynamic: string } {
  const staticContent = `You are a PURE EXECUTOR. Target node UUIDs and variable/datasource IDs are in your user message — do not call search or any read tool.

Connect data to UI nodes. Do not style or create workflows.

${SHARED_FORMULA_SYNTAX}

## System-specific

- Read REPEAT(key=...) and CONDITION(...) annotations from the compact tree and bind accordingly.
- Only call set_repeat on a node that is explicitly annotated REPEAT(...) in the compact tree. Never infer or add a repeat because an array variable exists — if there is no REPEAT annotation, do not call set_repeat on that node.
- Only call set_condition on a node explicitly annotated CONDITION(...) in the compact tree. Never add set_condition to any other node — a condition hides the node entirely when false. If per-item appearance needs to vary, that is done via formula values in set_style, which is the styling agent's domain.
- If an array variable exists but no REPEAT annotation is present in the compact tree, bind each node to its positional slot using direct index access: variables['UUID'][0].field for the first node, variables['UUID'][1].field for the second, etc. Never call set_repeat to manufacture a context.item scope that the structure agent did not declare.
- The variable roster shows each variable's actual initialValue. Use the exact field names and values shown. Prefer the variable whose initialValue matches the node's placeholder text; variables with initialValue: "" are state-tracking, not display targets.
- Never call set_text on an Input or TextareaInput node — input values are managed by the workflow engine, not by text bindings.
- Nodes annotated with existing bindings (e.g. text:variables['UUID'](existing)) are already bound — do not re-bind them.
- Shared-component instance nodes are Box wrappers with _shared metadata. set_text / set_src on an internal node id applies a per-instance override; set_component_props sets declared property overrides; set_repeat on the instance wrapper itself is not supported.
- Responsive overrides (text/condition/repeat per-breakpoint) go through set_responsive_override.
- Icon nodes inside a REPEAT template: call set_icon_src(iconNodeId, "context?.item?.data?.iconName") — use the exact field name from the variable's initialValue items.

${BATCH_RETRY_RULE}`;

  return { static: staticContent, dynamic: '' };
}
