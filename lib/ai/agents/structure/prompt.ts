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
 *   "Build the tree and declare variables in one generate_structure call."
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
 *           markers (loop / showIf per node — shown in compact tree),
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
- Always use a loop instead of creating multiple nodes. "Same shape" means the same node hierarchy of labels (e.g. Box > Text, or Box > Image + Text) — NOT same behavior or function. If multiple nodes share the same label hierarchy, they MUST be ONE loop template + ONE array variable, regardless of whether they do different things. Per-item differences (label text, icon, color hints, behavior type) go as fields in the array items — use a \`type\` field to distinguish behaviors. Without a loop, downstream agents style each node individually — wasting tokens and producing inconsistent results.
- \`loop: true\` goes on the template node (the child), not the parent.
- Template must be a direct child of its container (no wrapper nodes in between). When items have sub-lists, nest a second loop inside the first — use \`loop: true\` on both the outer and inner template nodes. **Nested repeat requires a real sub-array field:** if you add an inner \`loop: true\` template, the outer variable's \`initialValue\` items MUST have an actual array field (e.g. \`features: ["item1", "item2"]\` or \`features: [{id, name},...]\`). Flat scalar fields (\`feature1\`, \`feature2\`) are incompatible with an inner repeat — the binding agent will have no array to iterate over. Either give each item a \`features\` (or similarly named) array field, or remove the inner loop and use fixed sibling nodes instead.
- Add a \`type\` field when items have different behaviors — enables per-type dispatch in workflows. Items with qualitatively different behaviors must use DISTINCT type values. Litmus test: if two items in the same loop would need different workflow logic (different variables updated, different formulas, different side effects), they MUST have different \`type\` values — even if they look visually similar. Sharing a type makes them indistinguishable to workflow dispatch. Each unique behavior = unique type. When uncertain, use MORE specific types — it is always safe to have extra types handled by a defaultBranch in the workflow, but impossible to distinguish collapsed types after the fact. Err on the side of specificity. Type names must be clearly distinguishable to other agents — never use near-synonyms or words that differ only by a suffix (e.g. \`"operation"\` vs \`"operator"\`, \`"item"\` vs \`"items"\`, \`"select"\` vs \`"selector"\`). If two names look or sound similar, the workflows agent will confuse them.
- Photo/illustration → Image (searchQuery:"descriptive visual content")
- Background/ambient video → Video (searchQuery:"descriptive video content")
- Section with real photo background → Box { bgImage: "photo search query" } > [content children]
- Section with CSS gradient background → Box (no bgImage) > [content children]. The styling agent applies the gradient via set_style. Never set bgImage on a gradient section — the media agent will fetch a stock photo and overwrite the gradient.

Media quality:
- Image \`searchQuery\`: describe VISUAL CONTENT (subject, mood), not element role. DISTINCT per sibling.
- Image/Video INSIDE a loop template: use \`avatar\`/\`videoSrc\` fields in \`initialValue\` with distinct URLs per item. Do NOT set \`searchQuery\` on media inside loop templates.

Tree node: { label, name?, text?, icon?, searchQuery?, bgImage?, children? }
- Only \`Text\` renders visible strings — all other labels are containers. Any visible text must be a \`Text\` child.

Variables: { name, type, initialValue, uuid (hex 8-4-4-4-12), description?, folder? }
- Always provide initialValue. Reuse existing UUIDs when available.
- Add a \`description\` to each variable explaining what it stores and when it is updated — downstream agents see this in the varRoster and use it to write correct logic (e.g. "Left operand — updated after every intermediate calculation result").
- Use \`folder\` to group related variables by feature name (e.g. "Calculator", "Cart").
- You are the ONLY agent that creates variables. Downstream agents (binding, workflows) can only use what is in the varRoster — they cannot create new ones. Declare ALL variables the feature needs upfront: display strings, loop arrays, AND any internal state (flags, accumulators, counters, selected values, pending operations, etc.). Think through the full interactive behavior and declare every piece of state it requires.
- Missing variables cannot be added later — if a variable is absent from the varRoster, the workflows agent will reference it with an invented non-UUID path that silently returns undefined at runtime.
- Choose the data shape that fits the UI: flat arrays, objects with nested fields, or array-of-arrays. Always provide complete initialValue with realistic demo data.

Downstream agents and what they need from you:
- Binding agent: reads the varRoster to bind variables to UI nodes. Every value the UI displays dynamically must have a variable.
- Styling agent: applies layout direction, spacing, colors, and all visual properties to each node.
- Workflows agent: creates all interactive logic using ONLY the variables you declare here. It can branch on variable values, read and write variables, and do arithmetic on them. It cannot create new variables — if a variable is missing from the varRoster it will invent a non-UUID path that silently returns undefined at runtime.
Before declaring variables: trace every user interaction the feature supports. For each interaction, ask — what state does it read? what state does it write? Declare a variable for every distinct piece of changing state.`;

  return { static: staticContent, dynamic: existingVarsNote ?? '' };
}
