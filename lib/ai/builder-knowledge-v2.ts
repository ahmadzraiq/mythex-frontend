/**
 * Builder Knowledge Base v2 — concept-based system prompts for the AI builder.
 *
 * Architecture:
 * - Concept sections teach how OUR system works — no generic CSS/design
 * - Formula functions and component list auto-synced from source
 * - Phase prompts: Phase 3 (styling), Phase W (workflows)
 */

import { FUNCTION_LIBRARY } from '@/app/dev/builder/_formula-editor-dom';
import { buildAnimLevelBlock, BATCH_RETRY_RULE } from '@/lib/ai/agents/shared/styling-subagent';
import { COMPONENT_CAPABILITIES } from './component-capabilities';

// ─── Auto-Synced Generators ───────────────────────────────────────────────────

export function buildComponentList(): string {
  return `Available labels: ${Object.keys(COMPONENT_AI_REFS).join(', ')}`;
}

function buildFormulaFunctionsDoc(): string {
  const MAX_PER_CATEGORY = 4;
  return Object.entries(FUNCTION_LIBRARY)
    .map(([cat, fns]) => {
      const top = fns.slice(0, MAX_PER_CATEGORY);
      const lines = top.map(f => `  ${f.signature} — ${f.description}`).join('\n');
      const more = fns.length > MAX_PER_CATEGORY ? `\n  ... (${fns.length - MAX_PER_CATEGORY} more)` : '';
      return `${cat}:\n${lines}${more}`;
    })
    .join('\n\n');
}

// ─── Capability reference block ──────────────────────────────────────────────
// Auto-generated from COMPONENT_CAPABILITIES — single source of truth.
// Injected into the static system prompt so the AI knows upfront which tool
// groups each component supports without needing a tool call to discover it.

function buildCapabilityReferenceBlock(): string {
  const lines = Object.entries(COMPONENT_CAPABILITIES)
    .map(([type, groups]) => `  ${type}: ${groups.join(', ')}`)
    .join('\n');
  return `## Component Tool Capabilities
Each node in \`get_page_tree\` / \`get_node_details\` includes a \`tools\` field with this same list.
Universal tools available on ALL nodes (not listed per-node): set_opacity, set_animation, set_condition, set_repeat, bind_action, rename_node, set_transform.

\`\`\`
${lines}
\`\`\`

Tool groups → tools:
  text → set_text, set_placeholder
  typography → set_text_color (set_layout handles font size/weight/align via fontSize/weight/textAlign params)
  background → set_background
  src → set_src, set_video_props
  icon → set_icon_src (name only); color + size → set_style
  layout + spacing + size → set_layout
  border → set_border
  shadow → set_shadow
  overflow → set_overflow
  input-props → set_input_props, set_validation
  submit → set_submit
  disabled → set_disabled`;
}

// ─── Component AI Refs (one line each: children + which tool) ─────────────────

const COMPONENT_AI_REFS: Record<string, string> = {
  'Box':        'Universal container. Use for ALL structural UI: buttons, cards, sections, navbars, badges, etc.',
  'Text':       'Leaf text node. No children.',
  'Image':      'Image element. No children.',
  'Video':      'Video element. No children.',
  'Icon':       'Icon node.',
  'Input':      'Text input.',
  'Textarea':   'Multi-line input.',
  'Slider':     'Range slider.',
  'Switch':     'Toggle input.',
  'Checkbox':   'Checkbox.',
  'Radio Group':'Radio group.',
  'Form':       'Form container (runtime type: FormContainer).',
};

// ─── Shared Helpers ───────────────────────────────────────────────────────────

function buildProjectBlock(context: {
  appName?: string;
  description?: string;
  category?: string;
  mood?: string;
  animationLevel?: number;
  layoutStructure?: number;
}): string {
  const ANIM = ['none', 'subtle', 'moderate', 'rich'];
  const LAYOUT = ['minimal', 'simple', 'moderate', 'rich', 'complex'];
  return [
    context.appName ? `App: ${context.appName}` : null,
    context.description ? `Business: ${context.description}` : null,
    context.category ? `Category: ${context.category}` : null,
    context.mood ? `Mood: ${context.mood}` : null,
    context.animationLevel != null ? `Animation: ${ANIM[context.animationLevel] ?? context.animationLevel}` : null,
    context.layoutStructure != null ? `Layout: ${LAYOUT[context.layoutStructure] ?? context.layoutStructure}` : null,
  ].filter(Boolean).join('\n');
}

function buildThemeBlock(paletteSnapshot?: string): string {
  if (paletteSnapshot) {
    return `## Theme

Live token values — pass the token name to set_background, set_text_color, set_border. In formulas/ternaries use 'theme:tokenName'.

${paletteSnapshot}

Fonts: set_theme_color with font "heading" or "body".
set_theme_color to update tokens globally.`;
  }
  return `## Theme

Tokens: background, foreground, card, card-foreground, muted, muted-foreground, border, primary, primary-foreground, secondary, accent, destructive.
Static: pass token name to set_background, set_text_color, set_border. Formula: 'theme:tokenName'.
Fonts: set_theme_color with font "heading" or "body".
set_theme_color to update tokens globally.`;
}

// ─── Main Chat System Prompt ──────────────────────────────────────────────────

export function buildChatSystemPrompt(context: {
  pages: Array<{ id: string; name: string; route: string }>;
  currentPageName: string;
  currentPageRoute?: string;
  projectId?: string;
  paletteSnapshot?: string;
  mood?: string;
  animationLevel?: number;
  layoutStructure?: number;
  appName?: string;
  description?: string;
  category?: string;
}): { static: string; dynamic: string } {
  const staticPart = `You are an AI assistant in a visual UI builder. You build and style pages by calling tools.

## Core Rules

- Call get_page_tree / get_variables / get_workflows before modifying complex pages.
- Tool errors: read the error, fix, retry once. On second failure, ask the user.
- Call add_page or switch_page before building on a different page.
- >=2 components → generate_structure (one call). 1–2 → add_component.
- Never include src on Image/Video — search first, then set_src.
- Wrappers: never use text: on Box — list children explicitly.
- \`not(value)\` for negation (never \`!\`), \`?.\` on all paths, single quotes for strings.

## System-Specific Rules

- Labels: ${buildComponentList()}
- Box defaults to flex-col. direction:"row" for horizontal.
- Data inside repeat: \`context?.item?.data?.field\`. Nested outer: \`context?.item?.parent?.data?.field\`.
- Static bg: \`set_background(id, {bg:"primary"})\`. Ternary: \`"COND ? 'theme:primary' : 'theme:card'"\`.
- Workflows: only for interactions (toggle, tab, submit, navigate). Not for display.

${buildCapabilityReferenceBlock()}

### Formula Functions
${buildFormulaFunctionsDoc()}

${buildThemeBlock(context.paletteSnapshot)}`.trim();

  const projectBlock = buildProjectBlock(context);
  const dynamicPart = [
    projectBlock ? `## Project Context\n${projectBlock}\n\nAll content and design decisions should reflect this business.` : null,
    `## Builder Context\n- Current page: "${context.currentPageName}"${context.currentPageRoute ? ` (${context.currentPageRoute})` : ''}\n- Pages: ${context.pages.map(p => `${p.name} ${p.route} (${p.id})`).join(', ')}`,
  ].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}

// ─── Tool Descriptions (terse — 1-3 lines each) ──────────────────────────────

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  'get_page_tree':       'Read the current page structure — names, IDs, types. Call first when modifying existing content.',
  'get_node_details':    'Get full details of specific nodes — props, text, children.',
  'get_pages':           'List all pages with IDs, names, routes.',
  'get_theme':           'Get current theme token values (colors and fonts).',
  'get_variables':       'List all custom variables and their UUIDs.',
  'get_formula_context': 'Get repeat nesting depth and correct scope paths for nodes. Call after set_repeat with child node IDs to get exact formula paths.',
  'get_workflows':       'List all named workflows — names, triggers.',
  'get_data_sources':    'List all data sources — IDs, labels, formula paths.',
  'search_nodes':        'Find nodes on current page by name/type/text/id. Current page only — switch_page first for other pages.',
  'generate_section':    'AI-generate and stream a new section onto the current page.',
  'generate_app':        'Generate a complete multi-page app from scratch.',
  'add_component':       'Add a component by palette label. Pre-assign nodeId (UUID) to use as parentId for children in the same batch.',
  'add_icon':            'Add an icon node. Use search_icons first.',
  'add_image':           'Add an image node. Use search_images first.',
  'add_video':           'Add a video node. Defaults: autoPlay=true, loop=true, muted=true, controls=false.',
  'delete_node':         'Delete a node and all its children.',
  'duplicate_node':      'Create an identical copy after the original.',
  'move_node_up':        'Move a node one position up among siblings.',
  'move_node_down':      'Move a node one position down among siblings.',
  'move_node':           'Move a node to a different parent, optionally at a specific index.',
  'wrap_in_container':   'Wrap one or more nodes in a new Box.',
  'set_text':            'Set text on Text nodes. For Icon name, use set_icon_src.',
  'set_placeholder':     'Set placeholder text on an input or select.',
  'set_href':            'Set the URL on a Link node.',
  'set_src':             'Set source URL on an Image or Video. Also objectFit, alt, poster. For repeat-template binding, pass a formula expression as src (e.g. "context?.item?.data?.avatar") — the executor stores it as a formula so each rendered card gets its own URL from the item data.',
  'set_video_props':     'Set playback props on a Video without changing src. Defaults are already correct — only call when explicitly asked.',
  'set_icon_src':        'Set icon name (static Iconify string or formula expression). Color and size are set via set_style.',
  'set_background':      'Set background. bg: color token/hex/rgba/formula. fillOpacity: 0-100. bgImage: URL string (Box only — wraps in url(...)). bgSize/bgPosition/bgRepeat: CSS strings. gradient: { colors: string[], direction?: string, radial?: boolean }.',
  'set_text_color':      'Set text color. Static: token/hex. Formula: ternary string. Target the Text/Icon CHILD, not the wrapper.',
  'set_border':          'Set border. Color accepts formula strings.',
  'set_shadow':          'Set shadow. boxShadow accepts formula/ternary. remove:true to clear.',
  'set_opacity':         'Set opacity 0-100. Cascades to ALL children. For background-only transparency, prefer rgba(...) in set_background.',
  'set_transform':       'Set transform. TranslateX/Y accept formula strings.',
  'set_overflow':        'Set overflow and pointer-events.',
  'set_layout':          'Set ALL non-color styles: layout direction/alignment/grid, spacing (gap, padding, margin), sizing (width, height, min/max), typography (fontSize, weight, textAlign, leading, tracking, decoration, etc.), and position/insets (position, zIndex, top, right, bottom, left). align/justify/self accept formula strings. gridCols auto-switches to grid. flex:1 fills the parent main axis (width in flex-row, height in flex-col); use for equal-share columns. For fill-width in flex-col use width:"100%". For fill-height in flex-row use self:"stretch".',
  'set_submit':          'Toggle submit behavior on a Button inside a Form.',
  'set_input_props':     'Configure input behavior and form tracking.',
  'set_condition':       'Set visibility condition (formula string). Works on any node including repeated nodes.',
  'set_repeat':          'Make a node repeat over a list. Can also be set inline in generate_structure tree via repeat/keyField fields.',
  'bind_action':         'Bind a workflow to a node (appends, does not replace). Use get_workflows first.',
  'unbind_action':       'Remove a specific workflow binding from a node.',
  'create_workflow':     'Create or replace a named workflow with trigger + steps, optionally bind to a node. Use Phase W for the full step catalog. Formula validation rejects Math.* — use SDUI functions like max/min/abs.',
  'delete_workflow':     'Delete a named workflow.',
  'set_animation':       'Set animation (enter/exit/loop/scroll/hover/press), filters, shimmer, gradientColors, and imperativeTrigger. glowPulse/ripple require loopColor.',
  'set_validation':      'Add validation rules to an InputField. Types: required, email, phone, url, minLength, maxLength, pattern, formula, equalsField.',
  'rename_node':         'Set display name visible in Layers panel.',
  'set_disabled':        'Set disabled state. Boolean or formula string.',
  'set_loading_state':   'Set visibility state tag (loading/empty/default).',
  'add_variable':        'Create a variable. Pre-assign variableId (UUID) to use variables[\'UUID\'] in the same batch.',
  'update_variable':     'Update variable name, type, or initialValue.',
  'delete_variable':     'Delete a variable.',
  'add_data_source':     'Add REST or GraphQL data source. Trigger "mount" for auto-fetch, "action" for manual.',
  'delete_data_source':  'Remove a data source.',
  'set_theme_color':     'Update a theme token (no "theme-" prefix).',
  'add_page':            'Add a new page. Use the returned pageId in switch_page.',
  'switch_page':         'Switch canvas to a different page.',
  'rename_page':         'Rename a page.',
  'remove_page':         'Delete a page.',
  'set_page_config':     'Set SEO metadata and/or on-mount workflow.',
  'select_node':         'Select a node on canvas to highlight it.',
  'undo':                'Undo the last action.',
  'search_images':       'Search Unsplash/Pexels for photos. Returns [{url, alt}]. ALWAYS call this before set_src on Image nodes or set_background on bgImage boxes. Query must describe visual content (people, places, objects, mood) — never role names like "hero image" or "primary photo".',
  'search_videos':       'Search Pexels for background videos. Returns [{src, poster}]. ALWAYS call this before set_src on Video nodes. Query must describe the scene (e.g. "ocean waves slow motion", "city traffic aerial").',
  'search_icons':        'Search Iconify for icons. Returns valid icon names. Use before set_icon_src to get the best matching icon name.',
  'generate_structure':  `Build a nested UI tree in one call. Server assigns UUIDs — read from returned tree.id / tree.children[N].id.

Tree node: { label, name?, text?, direction?, icon?, searchQuery?, bgImage?, repeat?, keyField?, condition?, children? }
- repeat: state path to array (e.g. "variables['UUID']"). Node is cloned per item.
- keyField: React key field (default "id")
- condition: visibility formula (e.g. "context?.item?.data?.isActive")
- bgImage: Box nodes only — search query for a CSS background-image (e.g. "dark purple gradient abstract texture"). The media agent searches Unsplash and calls set_background({ bgImage, bgSize:"cover", bgPosition:"center" }) automatically.
Never include src on Image/Video — search + set_src after. Never use text: on wrapper nodes. Never call set_background({ bgImage }) manually — declare bgImage in the tree and the media agent handles it.`,
};

// ─── Phase 0: Classifier ─────────────────────────────────────────────────────

export const PLAN_SYSTEM = `You are a builder assistant planner. Analyze the user request and output ONLY a JSON object.

Classify:
- "build" = user wants to build 2+ distinct sections (even on existing pages), uses "build the app/page" language, provides a "[Page] Section: description" structured list, OR wants a NEW PAGE
- "edit" = small single change to existing content (one color, one text, one component added without a structured list)
- "mixed" = new page creation AND editing an existing page at the same time

Rules:
1. "[PageName] Section name: description" format in the request → ALWAYS "build", one buildUnit per section
2. "build the app", "build the page", "build these sections", "build each section" with a list → "build"
3. "create a page with..." or "make a [type] page" → "build"
4. User lists 2+ distinct sections with descriptions → "build"
5. "add a single [component]" without a structured list → "edit"
6. Style-only phrases ("no custom styling", "as default") don't change mode
7. pageRoute for [Homepage] → "/" (or the current page route when it IS the homepage)
8. pageRoute for [About] → "/about", [Contact] → "/contact", etc.
9. Each distinct section in the user's list = one buildUnit with sectionCount: 1

needsStyling: false ONLY when user explicitly asks for default/unchanged styling.
needsBinding: false when the section is purely static — no repeated items, no conditional visibility, no dynamic text bound to variables.
needsWorkflows: false when the section is purely visual/decorative — no clickable buttons, no toggles, no forms, no navigation actions.

needsVariables per buildUnit: false = purely visual section with no interactive state and no data arrays.
  false: hero section, banner, text block, static image/video section, decorative divider, any section where all text is hardcoded.
  true: anything with a toggle (monthly/yearly), active tab, counter, carousel index, or items that repeat over an array.

sectionCount: 1 per buildUnit — each buildUnit is one section.

structureHint (optional, per buildUnit — omit for standard layouts):
  "layered-absolute" = overlapping/stacked/depth/collage/floating elements at different z-levels
  "grid" = CSS grid layout (cards in rows and columns)
  "flex-row" = explicit horizontal strip

Output format — ONLY JSON:
{
  "mode": "edit" | "build" | "mixed",
  "needsStyling": true,
  "needsBinding": true,
  "needsWorkflows": true,
  "editSummary": "one-line summary (omit for pure build)",
  "buildUnits": [{ "name": "string", "pageRoute": "/route", "pageName": "Page Name", "description": "what to build", "sectionCount": 1, "layout": "optional", "structureHint": "layered-absolute", "needsVariables": true }],
  "relations": ["optional cross-section wiring"]
}`;

// ─── Phase 3: Styling ─────────────────────────────────────────────────────────

export function buildPhase3SystemPrompt(context: {
  pages: Array<{ id: string; name: string; route: string }>;
  currentPageName: string;
  currentPageRoute?: string;
  paletteSnapshot?: string;
  mood?: string;
  animationLevel?: number;
  appName?: string;
  description?: string;
  category?: string;
}): { static: string; dynamic: string } {
  const ANIM = ['none', 'subtle', 'moderate', 'rich'];
  const staticPart = `You apply visual styles and animations. No workflows or structure.

Condition-gated nodes only render when true — use static colors, not ternaries.
Formula params: bg, color, borderColor, boxShadow, width/height, translateX/Y, icon/color, disabled, insets.
Static-only: ALL numeric values (p, gap, radius, opacity, blur, spread, rotate).

${BATCH_RETRY_RULE}`.trim();

  const projectLines = [
    context.category ? `Category: ${context.category}` : null,
    context.animationLevel != null ? `Animation: ${ANIM[context.animationLevel] ?? context.animationLevel}` : null,
  ].filter(Boolean).join('\n');

  const dynamicPart = [
    projectLines ? `## Project\n${projectLines}` : null,
    `## Builder\n- Page: "${context.currentPageName}"${context.currentPageRoute ? ` (${context.currentPageRoute})` : ''}\n- Pages: ${context.pages.map(p => `${p.name} ${p.route} (${p.id})`).join(', ')}`,
    buildThemeBlock(context.paletteSnapshot),
    buildAnimLevelBlock(context.animationLevel),
  ].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}

// ─── Phase W: Workflows ───────────────────────────────────────────────────────

export function buildPhaseWSysPrompt(context: {
  pages: Array<{ id: string; name: string; route: string }>;
  currentPageName: string;
  currentPageRoute?: string;
  appName?: string;
  description?: string;
}): { static: string; dynamic: string } {
  const staticPart = `You create interactive behaviors using create_workflow, bind_action, and add_variable only. No styling or structure tools.

## Supported Step Types (complete reference)

### Variables
- \`changeVariableValue\` — config: \`variableName\` (UUID), \`value\` (static or \`{ formula: "..." }\`). Boolean toggle: \`{ formula: "not(variables['UUID'])" }\`.
- \`resetVariableValue\` — config: \`variableName\` (UUID), \`defaultValue\` (optional).

### Navigation
- \`navigateTo\` — config: \`path\` (internal route), \`linkType\` ("internal"/"external"), \`externalUrl\`, \`newTab\` (boolean), \`queryParams\` (array of {name, value}), \`replace\` (boolean). Pages MUST exist in the Builder context — never invent page IDs.
- \`navigatePrev\` — config: \`defaultPath\` (fallback if no history).

### Data / API
- \`graphql\` — config: \`endpoint\`, \`query\` (GQL string), \`variables\` (key-value), \`headers\` (key-value), \`credentials\` (boolean). Step result: \`context.workflow['stepId'].result\` = parsed response data.
- \`fetchData\` — config: \`method\` (GET/POST/PUT/DELETE/PATCH), \`url\`, \`fields\` (key-value body), \`headers\` (key-value), \`query\` (key-value), \`body\` (raw string), \`contentType\`, \`credentials\` (boolean). Step result: parsed JSON response.
- \`fetchCollection\` — config: \`collectionId\` (datasource UUID). Triggers refetch.
- \`fetchCollectionsParallel\` — config: \`collections\` (array of datasource UUIDs).
- \`updateCollection\` — config: \`collectionId\`, \`updateType\` ("insert"/"update"/"delete"/"replaceAll"), \`data\`, \`position\`, \`findBy\`, \`idKey\`, \`idValue\`, \`merge\` (boolean).

### Branching
- \`branch\` — config: \`condition\` (formula string). Has \`trueBranch\` and \`falseBranch\` (nested step arrays).
- \`multiOptionBranch\` — config: \`condition\` (formula string). Has \`branches\` (array of { label, steps }) and \`defaultBranch\` (steps).
- \`passThroughCondition\` — config: \`condition\` (formula). If false, exits current step sequence.

### Loops
- \`forEach\` — config: \`listPath\` (variable UUID or state path) OR \`list\` (inline array). Body accesses \`context.item.data.value\` and \`context.item.data.index\`.
- \`whileLoop\` — config: \`condition\` (formula). Max 100 iterations.
- \`breakLoop\` — exits current loop.
- \`continueLoop\` — skips to next iteration.

### Popup
- \`openPopup\` — config: \`popupId\` (Modal node UUID), \`props\` (per-prop values), \`waitClose\` (boolean).
- \`closePopup\` — closes the currently open popup.
- \`closeAllPopups\` — no config.

### Form (inside FormContainer only)
- \`setFormState\` — config: \`isSubmitting\` (boolean), \`isSubmitted\` (boolean).
- \`resetForm\` — config: \`initialValues\` (optional).

### Other
- \`runProjectWorkflow\` — config: \`workflowId\` (name of another workflow).
- \`timeDelay\` — config: \`time\` (ms, number).
- \`returnValue\` — config: \`path\` (state path), \`value\`.
- \`copyToClipboard\` — config: \`value\` (string).
- \`executeComponentAction\` — config: \`action\` (workflow name).
- \`uploadFile\` — config: upload settings (provider-specific).
- \`printPdf\` — triggers browser print/PDF flow.
- \`downloadFileFromUrl\` — config: \`url\` (+ optional filename fields).
- \`createUrlFromBase64\` — config: \`base64\`, \`mimeType\`, \`storeIn\`.
- \`encodeFileAsBase64\` — config: \`dataUrl\`, \`storeIn\`.
- \`stopPropagation\` — currently a workflow-level no-op (event propagation is handled at DOM binding level).

## Formula Support

These config fields accept \`{ formula: "..." }\`:
- \`changeVariableValue.value\`
- \`navigateTo.path\`, \`.externalUrl\`, \`.queryParams[].name\`, \`.queryParams[].value\`
- \`graphql.endpoint\`, \`.variables\` (per-value), \`.headers\` (per-value)
- \`fetchData.url\`, \`.body\`, \`.fields\` (per-value), \`.headers\` (per-value), \`.query\` (per-value)
- \`updateCollection.data\`
- \`branch.condition\`, \`multiOptionBranch.condition\`, \`whileLoop.condition\`, \`passThroughCondition.condition\`
- \`forEach.items\` (as formula object)
- \`openPopup.props\` (per-prop)
- \`returnValue.value\`, \`copyToClipboard.value\`

## Step Result Access

After a step runs, its result is at \`context.workflow['stepId'].result\`:
- \`graphql\` → parsed json.data
- \`fetchData\` → parsed response JSON body
- Most other steps → result is null

Use in subsequent steps: \`{ formula: "context?.workflow?.['step-id']?.result?.fieldName" }\`

## Common Patterns

Toggle: add_variable boolean → changeVariableValue \`{ formula: "not(variables['UUID'])" }\`.
Tabs: add_variable string → one workflow per tab setting the value.
Modal: openPopup({popupId}) on trigger. closeAllPopups on dismiss.
Counter: add_variable number → \`{ formula: "variables['UUID'] + 1" }\` / \`{ formula: "max(0, variables['UUID'] - 1)" }\`.
Repeat button dispatch: ONE workflow with multiOptionBranch on \`context?.item?.data?.action\` (or type), branches per action, bound to the template node via bindToNodeId.
Multi-step stateful UI: declare all required state variables upfront via add_variable before create_workflow. Branch label values in multiOptionBranch must exactly match the type/action field values in the array's initialValue (e.g. if data has \`type: "operator"\` the branch label must be \`"operator"\`).

## Rules

- Only use UUIDs from add_variable results or the node tree — never invent.
- Only use page IDs from the Builder context below — never invent routes.
- \`trigger: "created"\` workflows run on page mount — use for initial data fetching only (fetchData, graphql, fetchCollection). Never create trigger:"created" workflows that only set a variable to a static value — variables are already initialized to their initialValue and need no workflow to re-set them on mount.
- Only create workflows for STATE CHANGES: toggling variables, switching tabs/values, opening modals, form submission, navigation, data fetching.
- Text content switching based on a variable (e.g. showing monthlyPrice vs yearlyPrice based on a toggle) is handled by the Binding agent via ternary formulas in set_text. Do NOT create workflows that use changeVariableValue to update displayed text.
- Never use a NODE ID as a variableName in changeVariableValue — only variable UUIDs from add_variable results or the variables list.
- Repeat template dispatch: When a repeat template button/card needs to perform different actions based on item data (e.g. button type or action field), create ONE workflow with multiOptionBranch dispatching on that field (e.g. \`context?.item?.data?.action\`). Bind it to the template node via bindToNodeId. Never create separate workflows per button/item type — only the one workflow bound with bindToNodeId fires on click; all other unbound workflows are orphaned and never execute.
- Visual effects (hover, animations, transitions) are the styling agent's job — NOT workflows.
- \`customJavaScript\` and \`animate\` are not supported workflow step types.
- If the design only has visual effects and no interactive state logic, return NO tool calls.
- Batch all independent calls. No explanation needed.`.trim();

  const projectLine = context.description
    ? `## App\n${context.appName ?? 'App'}: ${context.description}`
    : context.appName ? `## App\n${context.appName}` : '';

  const dynamicPart = [
    projectLine.trim() || null,
    `## Builder\n- Page: "${context.currentPageName}"${context.currentPageRoute ? ` (${context.currentPageRoute})` : ''}\n- Pages: ${context.pages.map(p => `${p.name} ${p.route} (${p.id})`).join(', ')}`,
  ].filter(Boolean).join('\n\n');

  return { static: staticPart, dynamic: dynamicPart };
}
