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

An empty Box renders as an empty rectangle.

Element mapping:
- Heading/paragraph → Text
- Button/CTA → Box > Text "label"
- Badge/tag → Box > Text "label"
- Icon + text row → Box [_hint:"role:icon-text pair"] > [Icon (icon:"lucide:name"), Text]
- Feature/item list OR any 2+ siblings that share the same tree shape (same node type hierarchy, regardless of whether text content differs) → ONE template node with \`_needsRepeat: true\` + a declared array variable. Applies regardless of layout direction (list, grid, row). Never generate numbered siblings (e.g. "Card 1", "Card 2") — always use a single template node + variable array where each item holds the distinct values.
- Photo/illustration/screenshot → Image (searchQuery:"descriptive photo search terms")
- Background/ambient video → Video (searchQuery:"descriptive video search terms")
- Section with CSS background image → Box { bgImage: "descriptive search query" } > [content children]
- Image in ANY collage, split-hero, layered, or positioned layout → ALWAYS wrap each Image in a Box clip-wrapper. Pattern: \`gallery-container > [Box > Image, Box > Image]\`. The Box owns position/overflow/clipping; Image inside uses width:"100%" + height:"100%" only. ❌ NEVER place an Image as a direct child that needs position or percentage sizing. Image with floating overlay/accent card → nest as: image-container > [image-clip-wrapper > Image, accent-card]. Do not use flat siblings.

Media rules — REQUIRED fields, never omit:
- Icon node MUST have \`icon\` set to a valid Iconify name (e.g. \`"lucide:check"\`, \`"lucide:arrow-right"\`). An Icon without \`icon\` renders nothing.
- Image node MUST have \`searchQuery\` — describe VISUAL CONTENT (subject, setting, mood), never the element role ("primary image", "hero photo", "background image"). Each Image in the same section MUST have a DISTINCT searchQuery — vary subject matter entirely between siblings.
- Image or Video INSIDE a repeat template: include an \`avatar\` field (or \`videoSrc\` for videos) in the variable's \`initialValue\` array with a **distinct URL per item** (e.g. \`"https://i.pravatar.cc/150?img=1"\`, \`"?img=2"\`, \`"?img=3"\`). The binding agent will bind the Image/Video \`src\` from that field — each card renders its own unique image. Do NOT give the Image node a \`searchQuery\` when it is inside a repeat template (the media agent would overwrite the binding).
- Video node MUST have \`searchQuery\` describing the video clip to search for (e.g. \`"aerial city timelapse night lights"\`, \`"abstract particles flowing dark background"\`). A Video without \`searchQuery\` gets no video.
- Box with a **real photo** background MUST have \`bgImage\` set to a descriptive photo search query (e.g. \`"dark purple abstract gradient texture"\`). The media agent fetches the URL and calls set_background automatically. ❌ \`bgImage\` is for **photo searches only** — NEVER use it for CSS gradient sections. For a CSS gradient background, add a child Box with a descriptive name like "Gradient Background" and let the styling agent apply the gradient via style; do NOT set \`bgImage\` on it.
- Contrast overlay — triggers: (a) Text physically overlaps Image nodes — this includes full-bleed heroes AND collage/layered layouts where text container and image containers are ALL \`position:absolute\` siblings (they always overlap at some viewport range) → insert \`{label:"Box", name:"Dark Overlay", _hint:"role:dark overlay"}\` as a SIBLING after the last image container but BEFORE the text container. (b) Box with \`bgImage\` AND text children rendered over it → insert the same node as the FIRST child of that Box. ❌ DO NOT add for true side-by-side layouts (text column + image column in a flex-row with no absolute positioning). ❌ DO NOT add for CSS gradient sections — gradient backgrounds provide their own contrast; a dark overlay on top of a gradient makes it look dirty and broken. CRITICAL: \`label\` MUST be \`"Box"\`. \`_hint\` MUST be \`"role:dark overlay"\` exactly — not "role:backdrop", "role:scrim", "depth-shadow-layer", etc.

Tree node: { label, name?, text?, icon, searchQuery, bgImage?, _hint?, _needsRepeat?, _needsRepeatKeyField?, _needsCondition?, children? }
- \`text\` on Text leaf nodes only — NEVER on wrapper nodes
- \`icon\` — Icon nodes (REQUIRED, Iconify \`"set:name"\` format)
- \`searchQuery\` — Image/Video nodes (REQUIRED, describe the visual content to search for)
- \`bgImage\` — Box nodes only, CSS background-image search query. Media agent handles URL lookup + set_background call.
- \`_hint: "role:hero section"\` — semantic role for styling agents (role: prefix only, e.g. "role:content group", "role:primary action group", "role:card row"). Set on structural/container nodes only — not on Text, Image, or Icon leaves. Use \`"role:card row"\` when a parent holds a repeat-template child that should render cards horizontally side-by-side (e.g. testimonials, pricing tiers, team members).
- \`_needsRepeat: true\` marks a node for repeat binding (downstream agent resolves the variable)
- \`_needsCondition: "fieldName"\` marks a node for conditional visibility
- **Nested repeat \`map\` path**: when a node inside a repeat template itself maps over a sub-array (e.g. a feature list inside a pricing card), set \`map\` to plain dot notation — \`"context.item.data.features"\` — NEVER optional-chaining like \`"context?.item?.data?.features"\`. Optional-chaining in a \`map\` string breaks scope resolution (the path prefix \`"context?"\` is not recognized as a scope variable).

Variables: declare in the \`variables\` array with name, type, initialValue, uuid (hex 8-4-4-4-12).
- Always provide initialValue — undefined breaks repeat/conditions/text silently.
- One template per array with \`_needsRepeat: true\` — never duplicate siblings per item.
- Reuse existing variable UUIDs when available (listed in dynamic context).
- If you set \`repeat\` directly on a node (e.g. \`repeat: "variables['UUID']"\`), the UUID MUST be the EXACT uuid you declared in the variables array for this call — never invent a different UUID. Mismatched UUIDs produce empty lists silently.

Do NOT pass \`_pageId\` in generate_structure — it is a system-only field injected at build time. Do NOT call styling or binding tools.`;

  return { static: staticContent, dynamic: existingVarsNote ?? '' };
}
