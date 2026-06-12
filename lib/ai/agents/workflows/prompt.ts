/**
 * Workflows agent — creates and binds all interactive workflows (state, navigation, toggles).
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: PHASE_W_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: switch_page, get_formulas,
 *             create_workflow, add_workflow_step, bind_action, update_workflow_steps, set_workflow_params
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static + dynamic: buildWorkflowsAgentPrompt(context) (this file)
 *   context fields: pages, currentPageName, currentPageRoute, appName, description
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts parallel block (~line 1193):
 *   "[Workflows Agent]\nCreate and bind all workflows needed for interactive behaviors."
 *   [Page Tree — use exact node UUIDs]
 *   {compactTree}       ← text representation of node tree from structure pass
 *   {varRoster}         ← variable name + UUID + field schema
 *   {existingWorkflows} ← "Existing workflows on this page: …" (page/appLoad triggers)
 *   {phaseWPageNote}    ← "Active page: {pageId} (switch_page already called)." if new pages created
 *   "Original request: {message}{relationsNote}"
 *
 * ─── Read handlers ────────────────────────────────────────────────────────────
 * phaseWReadHandlers: get_variables, get_workflows
 *
 * ─── Upstream ────────────────────────────────────────────────────────────────
 * Receives from structure agent: compactTree, varRoster.
 * phaseWPageNote from page creation step (before parallel launch).
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * No output consumed by other agents — runs in parallel with binding/layout/colors/typo.
 * Emits tool_executed SSE events (create_workflow, bind_action, add_variable)
 * executed client-side by tool-executor.ts.
 */

import { SHARED_FORMULA_SYNTAX } from '../shared/formula-scope';
import { BATCH_RETRY_RULE } from '../shared/styling-subagent';

export function buildWorkflowsAgentPrompt(context: {
  pages: Array<{ id: string; name: string; route: string }>;
  currentPageName: string;
  currentPageRoute?: string;
  appName?: string;
  description?: string;
}): { static: string; dynamic: string } {
  const staticPart = `You MUST handle every workflow stub in the WORKFLOW ROSTER before returning. Do not stop, summarize, or say "the rest follow the same pattern" — implement each stub explicitly. Only return end_turn when every workflowId in the roster has been processed (steps added or left intentionally empty).

Your roster lists pre-created workflow stubs. For each one, plan the full step tree first, then add steps with add_workflow_step passing the workflowId exactly as shown. Never create new workflows or bind new triggers — both are already done. If a stub looks unnecessary, leave it empty.

Unimplementable stubs: if a stub cannot be implemented using only the sandbox identifiers (variables, wwLib, context, globalContext, auth, event, fetch) — for example because it would require reading or mutating the DOM, applying CSS, or calling any browser API — leave it empty. Do not attempt to work around the sandbox with runJavaScript. Visual effects on hover (scale, shadow, opacity, translate) are owned by the animation agent via set_animation; no workflow step can produce them.

For every branch arm, verify ALL variables the downstream logic reads are correctly set — not just display-bound ones. An internal state variable left unset in one branch silently produces wrong results on that path.

${SHARED_FORMULA_SYNTAX}

## Step result access

A step's result is at context.workflow['stepId'].result:
- graphql -> parsed json.data
- fetchData -> parsed response JSON body
- other steps -> null

Reference from later steps: context?.workflow?.['step-id']?.result?.fieldName

## Repeat dispatch

For per-item behavior on a REPEAT node use one workflow with multiOptionBranch as the root step. All branches live inline — never create per-type workflows.

${BATCH_RETRY_RULE}`.trim();

  const projectLine = context.description
    ? `## App\n${context.appName ?? 'App'}: ${context.description}`
    : context.appName ? `## App\n${context.appName}` : '';

  const dynamicPart = [
    projectLine.trim() || null,
    `## Builder\n- Page: "${context.currentPageName}"${context.currentPageRoute ? ` (${context.currentPageRoute})` : ''}\n- Pages: ${context.pages.map(p => `${p.name} ${p.route} (${p.id})`).join(', ')}`,
  ].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}

// Backward-compat alias — callers that import buildPhaseWSysPrompt from builder-knowledge-v2
// still resolve correctly via the re-export chain in that file.
export { buildWorkflowsAgentPrompt as buildPhaseWSysPrompt };
