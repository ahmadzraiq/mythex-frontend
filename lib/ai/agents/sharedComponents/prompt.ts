/**
 * Shared Components agent — edits EXISTING SC models (enter/exit scope + primitives).
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: SC_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: get_shared_components, get_variables,
 *             enter_shared_component_edit, exit_shared_component_edit,
 *             update_shared_component_metadata, update_shared_component_properties,
 *             update_shared_component_variables, update_shared_component_formulas,
 *             update_shared_component_triggers,
 *             add_component, set_style, set_text, set_src,
 *             set_repeat, set_condition, set_animation,
 *             create_workflow, add_workflow_step, bind_action, update_workflow_steps
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static + dynamic: buildSharedComponentAgentPrompt(context) (this file)
 *   context fields: varRoster (optional)
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts parallel batch (~line 2266):
 *   "[Shared Components Agent] Author the shared component model: {name}"
 *   {varRoster}   ← available variables for formula bindings
 *   "Original request: {message}"
 *
 * ─── Upstream ────────────────────────────────────────────────────────────────
 * The structure step pre-mints the SC shell via create_shared_component.
 * This agent only edits the model — it never creates a new shell.
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * Runs in the same parallel batch as binding/styling/animation/workflows.
 * Emits tool_executed SSE events executed client-side by tool-executor.ts.
 */

import { BATCH_RETRY_RULE } from '../shared/styling-subagent';

export function buildSharedComponentAgentPrompt(context: {
  varRoster?: string;
}): { static: string; dynamic: string } {
  const staticPart = `You are a PURE EXECUTOR editing a shared-component model that the structure agent already created.

The shell already exists — do NOT call create_shared_component. Fill it with content and behavior.

Workflow:
1. enter_shared_component_edit(modelId) — scopes all subsequent primitives.
2. add_component / set_style / set_text / set_src / set_repeat / set_condition / set_animation — build the content tree.
3. create_workflow / add_workflow_step / bind_action — add interactions.
4. update_shared_component_properties / _variables / _formulas / _triggers — declare the model surface.
5. exit_shared_component_edit when done. Repeat enter -> edit -> exit for each model in your batch.

Rules:
- get_shared_components is the only read tool — use it to inspect the current model surface if needed.
- Declare instance-configurable values as properties on the model; bind them inside the content via property accessor formulas.
- Use update_shared_component_triggers to declare custom events; fire them with emitComponentTrigger workflow steps.

${BATCH_RETRY_RULE}`.trim();

  const dynamicPart = context.varRoster
    ? `## Available Variables\n${context.varRoster}`
    : '';

  return { static: staticPart, dynamic: dynamicPart };
}
