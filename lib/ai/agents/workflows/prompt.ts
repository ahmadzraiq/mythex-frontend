/**
 * Workflows agent — creates and binds all interactive workflows (state, navigation, toggles).
 * Prompt implementation lives in builder-knowledge-v2 (buildPhaseWSysPrompt).
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: PHASE_W_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: switch_page, get_variables, get_workflows,
 *             create_workflow, bind_action, add_variable
 * Note: add_variable is included so workflows can create new boolean/string state
 *       variables for toggles, tab selectors, etc. at wiring time.
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static + dynamic: buildPhaseWSysPrompt(context) in lib/ai/builder-knowledge-v2.ts
 *   context fields: pages, currentPageName, currentPageRoute, appName, description
 *   (No paletteSnapshot — workflows are behavior, not style.)
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts parallel block (~line 1193):
 *   "[Workflows Agent]\nCreate and bind all workflows needed for interactive behaviors."
 *   [Page Tree — use exact node UUIDs]
 *   {compactTree}       ← text representation of node tree from structure pass
 *   {varRoster}         ← variable name + UUID + field schema
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

export { buildPhaseWSysPrompt as buildWorkflowsAgentPrompt } from '../../builder-knowledge-v2';
