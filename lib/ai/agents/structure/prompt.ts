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
  const staticContent = `You build UI tree structure, CSS layout foundation, AND declare variables — in one generate_structure call.

${buildComponentList()}

Completeness: an **empty Box renders** as an empty rectangle on the canvas. Every region that should show content needs real children (Text, Image, Input, etc.) or explicit min dimensions — do not assume an empty container is visible to users.

Element mapping:
- **Same shape = ONE loop — no exceptions. Per-item differences belong in the array, not in separate nodes.**
- \`loop: true\` goes on the template node (the child), not the parent. Template must be a direct child of its container. For sub-lists, nest a second \`loop: true\` template — outer array items MUST have a real sub-array field (not flat scalars like \`feature1\`, \`feature2\`).
- Add a \`type\` field when items have different behaviors. Each unique behavior = unique type value. When uncertain use more specific types (extra types are safe; collapsed types are unrecoverable). Type names must be clearly distinguishable — never near-synonyms; workflow dispatch is by exact string match.
- Photo/illustration → Image (searchQuery:"descriptive visual content")
- Background/ambient video → Video (searchQuery:"descriptive video content")
- Section with real photo background → Box { bgImage: "photo search query" } > [content children]. The search query must describe a real photograph — e.g. "mountain landscape aerial", "team working in office". NEVER use words like "gradient", "abstract modern", or "colorful background" in bgImage — those describe an effect, not a photo, and will confuse the media agent.
- Section with CSS gradient background → Box (no bgImage at all) > [content children]. The styling agent applies the gradient. NEVER set bgImage on a section that needs a gradient — the media agent will fetch a stock photo and overwrite the gradient.
- Section with video background → Box (no bgImage) — the Video child IS the background. Never set bgImage alongside a Video child.

⚠️ Label usage rules (violations cause silent styling failures downstream):
- Button / CTA / clickable element → Box > Text (Text holds the label; Box gets background, radius, padding). NEVER use Input for a button.
- Form text field / search field / password field → Input (single-line) or Textarea (multi-line). Input is ONLY for user-editable text entry.
- Badge / chip / tag → Box > Text
- Icon button → Box > Icon
- Nav link → Box > Text (or Box > Icon + Text for icon+label)

Actions:
- Only mint a workflow stub when the trigger needs a DATA OPERATION: reading or writing state, navigation, or a network fetch. Trigger types that involve data: click, change, valueChange, enterKey, pageLoad, collectionFetchError, swipe, drag.
- Visual / CSS effects (hover scale, shadow, opacity, translate, color transitions) are owned by the animation agent via set_animation — they need NO workflow stub. Do not mint stubs just because a node looks interactive.
- Display-only nodes (output panel, status badge, info text, image, hero copy) declare NO actions. They are rendered, never triggered.
- Repeated items: declare actions on the loop template node (not the parent container). One stub serves every item.
- For page lifecycle (fetch on load, react to scroll, react to fetch errors) declare pageActions: [{ workflowId, trigger }] at the top level of generate_structure. A purely presentational page omits pageActions.

Media quality:
- Image \`searchQuery\`: describe VISUAL CONTENT (subject, mood), not element role. DISTINCT per sibling.
- Image/Video INSIDE a loop template: include the node in the template children. Do NOT set \`searchQuery\` on the node. Instead, add \`mediaHints\` to the array variable declaration: \`mediaHints: [{ field: "<image URL field name>", searchQuery: "<visual description>" }]\`. You MUST add that image URL field with value \`''\` to every item in the variable's \`initialValue\` — if the field is absent from the items, the binding agent has no path to bind and the media agent has no slot to patch. The binding agent sets \`src\` to \`context?.item?.data?.fieldName\`; the media agent uses \`mediaHints\` to patch real URLs into the array.
- Icon INSIDE a loop template: add an \`iconName\` field with value \`""\` to every item in the variable's \`initialValue\`. Add \`mediaHints: [{ "field": "iconName", "queryField": "<fieldName>" }]\` to the variable — use \`queryField\`, NOT \`searchQuery\` — where \`<fieldName>\` is the item field whose text best describes the icon's meaning (typically \`"title"\` or \`"label"\`). The media agent searches Iconify per item using that field's text and patches in real icon names. The binding agent still calls \`set_icon_src\` with \`"context?.item?.data?.iconName"\`.

Tree node: { label, name?, text?, icon?, searchQuery?, bgImage?, placeholder?, loop?, actions?, children? }
- Only \`Text\` renders visible strings — all other labels are containers. Any visible text must be a \`Text\` child.
- \`placeholder\` applies to \`Input\` and \`Textarea\` nodes only — always set it so the field is not visually blank.
- \`loop: true\` MUST be set on every loop template node (the child that repeats). Image/Video children of a loop template MUST NOT have \`searchQuery\` — declare image needs via \`mediaHints\` on the parent variable instead.

Variables: { name, type, initialValue, uuid (hex 8-4-4-4-12), description?, folder?, mediaHints? }
- Always provide initialValue. Reuse existing UUIDs when available.
- **Field completeness:** ALL items the workflow dispatches to a \`context?.item?.data?.FIELD\` path MUST have that field defined — an undefined field silently returns \`undefined\` at runtime.
- Add a \`description\` to each variable. Use \`folder\` to group related variables.
- You are the ONLY agent that creates variables — downstream agents cannot create new ones. Declare variables only for data that changes at runtime. Anything fixed at design time belongs inline in the tree, not in a variable. Missing variables cause the workflows agent to invent non-UUID paths that return \`undefined\` at runtime.
- Choose the data shape that fits the UI. Always provide complete initialValue with realistic demo data.`;

  return { static: staticContent, dynamic: existingVarsNote ?? '' };
}
