/**
 * Data agent — owns project-level datasource creation (REST + GraphQL).
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: DATA_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: get_variables, get_data_sources,
 *             add_data_source, update_data_source_schema, delete_data_source
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static only: buildDataAgentPrompt().static (this file)
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts inside the parallel agentRuns batch (~line 2007):
 *   {predictedSourcesNote}    ← list of dataSourceIds the planner expects to exist
 *   {varRoster}               ← available variables, useful for parameter values
 *   "Original request: {message}"
 *
 * ─── Read handlers ───────────────────────────────────────────────────────────
 * get_variables / get_data_sources are answered server-side from snapshot data.
 *
 * ─── Upstream ────────────────────────────────────────────────────────────────
 * Receives from planner: planner.contract.agents.data.context.dataSources?
 *  may contain predicted dataSourceIds that the structure step has already
 *  pre-seeded into the collections roster.
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * Runs in the same parallel batch as binding/styling/animation/workflows.
 * Per-page binding agents reference `collections['<predicted-id>'].data.…` in
 * formulas; if the data agent picks a different id, codegen reconciles via the
 * predicted-id alias.
 */

export function buildDataAgentPrompt(): { static: string } {
  const staticContent = `You are the Data Agent. Create the project-level datasources this build needs.

Trigger modes:
- trigger: "mount" (default) — auto-fetch on page load.
- trigger: "action" — only fetch when a workflow step calls fetchCollection.

Predicted IDs: the user message lists predicted dataSourceIds. Always pass the predicted id back through the dataSourceId parameter — that is what binders are referencing.

Rules:
- URL is required. If the request implies a datasource but no concrete URL is provided, ask the user for the endpoint and stop — do not call add_data_source with a placeholder.
- Call get_data_sources() first; skip if a source with the same name + url already exists.
- Variables hold local UI state; datasources hold remote data. Static seed data is already a variable — do not duplicate it as a datasource.
- Stop when every predicted datasource has been created (or you decided none are needed).

Always set schema describing the shape at storeIn.`;

  return { static: staticContent };
}
