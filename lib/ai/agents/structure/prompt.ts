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
 *           markers (_needsRepeat, _needsCondition per node),
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

Design the section as a complete web page — every visible element (button, badge, heading, list item) must have its content. An empty Box renders as an empty rectangle.

Element mapping:
- Heading/paragraph → Text (with text content)
- Button/CTA → Box > Text "label"
- Badge/tag → Box > Text "label"
- Icon + text row → Box direction:"row" > [Icon (icon:"lucide:name"), Text]
- Feature/item list → Box [_needsRepeat] > [item template children]
- Photo/illustration/screenshot → Image (searchQuery:"descriptive photo search terms")
- Background/ambient video → Video (searchQuery:"descriptive video search terms")
- Section with CSS background image → Box { bgImage: "descriptive search query" } > [content children]
- Image with floating overlay/accent card (photo + card that bleeds outside the frame) → nest, do not use a flat row of siblings:
  image-container > [ image-clip-wrapper > Image, accent-card ]
  The outer image-container is the relative positioning context; image-clip-wrapper holds overflow:clip + rounded corners for the photo only; accent-card sits inside image-container so absolute offsets (e.g. negative right) are correct and are not clipped by the photo mask.
- When StructurePattern: layered-absolute — use a single relative container with absolutely-positioned Box wrappers inside it, not flex-row siblings.

Media rules — REQUIRED fields, never omit:
- Icon node MUST have \`icon\` set to a valid Iconify name (e.g. \`"lucide:check"\`, \`"lucide:arrow-right"\`). An Icon without \`icon\` renders nothing.
- Image node MUST have \`searchQuery\` describing the photo to search for (e.g. \`"modern SaaS dashboard UI screenshot"\`, \`"team collaboration office"\`). An Image without \`searchQuery\` gets no photo.
- Video node MUST have \`searchQuery\` describing the video clip to search for. A Video without \`searchQuery\` gets no video.
- Box with CSS background-image MUST have \`bgImage\` set to a search query (e.g. \`"dark purple abstract gradient texture"\`). The media agent searches and calls set_background automatically — never do this manually in the colors phase.

Tree node: { label, name?, text?, direction?, icon, searchQuery, bgImage?, _hint?, _needsRepeat?, _needsRepeatKeyField?, _needsCondition?, children? }
- \`text\` on Text leaf nodes only — NEVER on wrapper nodes
- \`icon\` — Icon nodes (REQUIRED, Iconify \`"set:name"\` format)
- \`searchQuery\` — Image/Video nodes (REQUIRED, describe the visual content to search for)
- \`bgImage\` — Box nodes only, CSS background-image search query. Media agent handles URL lookup + set_background call.
- \`_hint: "role:hero section"\` — semantic role for styling agents (role: prefix only, e.g. "role:content group", "role:primary action group"). Set on structural/container nodes only — not on Text, Image, or Icon leaves.
- \`_needsRepeat: true\` marks a node for repeat binding (downstream agent resolves the variable)
- \`_needsCondition: "fieldName"\` marks a node for conditional visibility

Variables: declare in the \`variables\` array with name, type, initialValue, uuid (hex 8-4-4-4-12).
- Always provide initialValue — undefined breaks repeat/conditions/text silently.
- One template per array with \`_needsRepeat: true\` — never duplicate siblings per item.
- Reuse existing variable UUIDs when available (listed in dynamic context).

Do NOT call styling or binding tools.`;

  return { static: staticContent, dynamic: existingVarsNote ?? '' };
}
