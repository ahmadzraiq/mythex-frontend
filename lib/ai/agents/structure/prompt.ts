/**
 * Structure agent — UI tree shape + variables in one `generate_structure` call.
 *
 * ─── Tools ───────────────────────────────────────────────────────────────────
 * Export: STRUCTURE_AGENT_TOOLS (lib/ai/builder-tools.ts)
 * Tool names: generate_structure
 * Note: tool_choice is forced to "generate_structure" — the agent always
 *       calls it exactly once and terminates.
 *
 * ─── System prompt ───────────────────────────────────────────────────────────
 * Static:  buildStructureAgentPrompt().static (this file)
 * Dynamic: buildStructureAgentPrompt(existingVarsNote).dynamic
 *   - existingVarsNote: list of existing array variables already in the project
 *     (route builds this from the `variables` request field — type === 'array')
 *     purpose: agent reuses existing variable UUIDs instead of creating duplicates
 *
 * ─── User message (injected by route) ────────────────────────────────────────
 * route.ts → runStructureAgent():
 *   `Build: {unit.name}\nDescription: {unit.description}`
 *   `\nSECTION LIMIT: Build EXACTLY {unit.sectionCount ?? 1} section(s). Do NOT add extra sections.`
 *   `\nLayout: {unit.layout}`  (if present)
 *   `\nStructurePattern: {unit.structureHint}`  (if present — e.g. "layered-absolute")
 *   "Declare all needed variables in the `variables` array and build the tree in one generate_structure call."
 *
 * ─── Read handlers ────────────────────────────────────────────────────────────
 * None — structure runs as a single forced tool_choice call with no read loop.
 *
 * ─── Upstream ────────────────────────────────────────────────────────────────
 * Receives: build units from the planner (classifyRequest → plan.buildUnits),
 *           existing variable list from the client (request.variables).
 *
 * ─── Downstream ──────────────────────────────────────────────────────────────
 * Produces: CollectedTree (resolved node tree with server-assigned UUIDs),
 *           markers (loop / showIf per node),
 *           varEvents (add_variable events streamed to client + forwarded to
 *                      binding/colors/workflows as varRoster).
 * Consumed by: binding (compactTree + markers + varRoster),
 *              layout / colors / typo-anim (compactTree + repeatContainerHint),
 *              workflows (compactTree + varRoster),
 *              media (mediaManifest extracted from tree).
 */

import { buildComponentList } from '../../builder-knowledge-v2';

export function buildStructureAgentPrompt(existingVarsNote?: string): { static: string; dynamic: string } {
  const staticContent = `You build UI tree structure AND declare variables — in one generate_structure call.

${buildComponentList()}

Element mapping:
- 2+ siblings with the same tree shape → ONE template node with \`loop: true\` + a declared array variable. Never generate numbered siblings (e.g. "Card 1", "Card 2").
- Photo/illustration → Image (searchQuery:"descriptive visual content")
- Background/ambient video → Video (searchQuery:"descriptive video content")
- Section with real photo background → Box { bgImage: "photo search query" } > [content children]

Media quality:
- Image \`searchQuery\`: describe VISUAL CONTENT (subject, mood), not element role. DISTINCT per sibling.
- Image/Video INSIDE a loop template: use \`avatar\`/\`videoSrc\` fields in \`initialValue\` with distinct URLs per item. Do NOT set \`searchQuery\` on media inside loop templates.

Tree node: { label, name?, text?, icon, searchQuery, bgImage?, loop?, loopKey?, showIf?, children? }
- Only \`Text\` renders visible strings — all other labels are containers. Any visible text must be a \`Text\` child.
- \`loop: true\` — marks the ITEM TEMPLATE node (the repeating child, not the container)
- \`loopKey\` — key field for loop items (default "id")
- \`showIf: "fieldName"\` — marks a node for conditional visibility on that field

Variables: { name, type, initialValue, uuid (hex 8-4-4-4-12) }
- Always provide initialValue.
- Reuse existing variable UUIDs when available (listed in dynamic context).`;

  return { static: staticContent, dynamic: existingVarsNote ?? '' };
}
