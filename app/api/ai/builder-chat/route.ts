/**
 * POST /api/ai/builder-chat
 *
 * Main AI chat endpoint for the builder assistant.
 * Uses Anthropic's tool_use (function calling) to interact with the builder.
 *
 * Flow:
 *  1. Build system prompt with builder context
 *  2. Send to Anthropic with all builder tools
 *  3. Anthropic responds with text + optional tool calls
 *  4. Stream text deltas to client as SSE
 *  5. Collect tool calls → execute client-side via SSE events
 *  6. Continue the conversation loop (tool results → next AI response)
 *  7. Stop when AI sends a final text-only message (stop_reason = "end_turn")
 *
 * Note: Tool execution happens CLIENT-side (the browser has access to the
 * Zustand store). The server tells the client which tools to execute and
 * the client streams back the results on the next request iteration.
 * For simplicity, tool results are injected into the SSE stream as
 * "tool_executed" events that the client processes immediately.
 *
 * For generation tools (generate_app, generate_section), the server
 * triggers the existing generation pipeline.
 */

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ALL_BUILDER_TOOLS, PHASE3_BUILDER_TOOLS } from '@/lib/ai/builder-tools';
import { buildChatSystemPrompt, buildPhase3SystemPrompt, buildComponentList } from '@/lib/ai/builder-knowledge';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Phase 2 mini-model system prompt ─────────────────────────────────────────
// Extracted to module level so it can be included in the debug capture response.
// Pass existingVarsNote='' for the debug snapshot (no per-request context needed).
function buildPhase2SysPrompt(existingVarsNote = ''): string {
  return `You are a UI builder. Your job is: create variables, build structure, wire repeat, bind text — in that order.

Available component labels (use exact label as the "label" field in generate_structure):
${buildComponentList()}

tree node shape: { label, name?, text?, children?: [...] }
  label = exact component label from the list above
  name  = layers panel label
  text  = text content (for Heading/Text/Badge nodes only)

STRUCTURE ONLY — the tree must contain ZERO style information:
  - No icon names, color props, or any design values on any node.
  - No style info. Phase 3 calls set_icon, set_background, set_text_color, etc.

SCOPE: Generate ONLY the structure explicitly requested. Never add extra sections or supplementary content not mentioned in the request.

The "tree" key is REQUIRED in generate_structure. Always pass the full nested structure under "tree".
${existingVarsNote}
STEP ORDER — follow this sequence for components with repeated items:

STEP 1 — add_variable FIRST (before generate_structure):
  Create the array variable with realistic demo data. Pre-assign a hex UUID as variableId:
    add_variable("Items", "array", '[{"id":"1","title":"...","value":"..."},{"id":"2",...},{"id":"3",...}]', variableId:"<hex-uuid>")
  Keys in the array objects must match the field names you will bind in STEP 4.
  If an existing array variable (listed above) already matches the data you need, skip add_variable and use that variable's id directly in STEP 3.
  If the existing variable does NOT match (different fields or data), create a new variable with a FRESH UUID — NEVER call add_variable with an existing variable's UUID, as this overwrites the global variable and corrupts every page that uses it.
  CRITICAL UUID RULE: After add_variable returns, the tool result contains the confirmed UUID.
  That UUID is the ONLY one you may use in ALL subsequent set_text and set_repeat calls.
  NEVER invent a UUID that was not returned by add_variable.
  Also create any non-array state variables (boolean, string, number) the component needs for interactive behavior — Phase 3 needs their UUIDs for set_condition formulas.

STEP 2 — generate_structure (ONE template node):
  Build EXACTLY ONE template wrapper named "*-template".
  NEVER build N static copies. Styling differences between items are handled via formula expressions in Phase 3.
  Only add an optional child node when it is structurally present but should be conditionally shown.

  CRITICAL — what counts as "repeated items" (always use STEP 1-4):
  - Pricing / plan cards (Basic / Pro / Premium — differences are DATA, not structure)
  - Feature cards, testimonial cards, team member cards, blog post cards
  - FAQ items, step items, service tiles, comparison table rows
  - Any list of items that share the same visual shape, even if the copy differs

STEP 3 — set_repeat immediately after generate_structure:
  The tool result contains a "tree" object — the resolved structure with a server-assigned UUID in
  every node's "id" field. Read the template node's id directly from that tree:
    set_repeat("<id from tree.id or tree.children[N].id>", "variables['<variableId-from-step1>']", "id")
  NEVER use the name field (e.g. "card-template") as a nodeId — always use the UUID from the id field.

STEP 4 — set_text to bind data fields:
  Read each child node's id from the returned tree and use it as nodeId:
    set_text("<id from tree.children[N].id>", "context.item.data.title")
  NEVER use a node's name as a nodeId — always use the UUID from the id field in the returned tree.

NESTED REPEATS — for any inner list (sub-items, bullets, tags, etc.):
  NEVER use a string array. ALWAYS use an object array: [{"id":"1","text":"..."},{"id":"2","text":"..."}]
  This makes the text accessible as context.item.data.text in the inner repeat scope.
  All node IDs come from the returned tree's id fields — read them from tree.children[N].id.
  Bind inner item fields:  set_text("<inner-text-uuid from tree>", "context.item.data.text")
  Wire inner repeat:       set_repeat("<inner-template-uuid from tree>", "context.item.data.items", "id")
  Bind OUTER item fields (from inside the inner repeat): set_text("<uuid from tree>", "context.item.parent.data.field")
  Use context.item.parent.data.* whenever an inner node needs a field from the outer (enclosing) repeat item.

Phase 3 handles ALL visual styling (set_spacing, set_layout, set_background, set_border, etc.).
Do NOT apply any styling here.

For components WITHOUT repeated items: just call generate_structure. Skip STEP 1/3.

STEP 5 — search and set src for media nodes:
  After generate_structure, if the component includes any media nodes (images, videos), search for relevant content based on the request immediately — in the same round as set_repeat/set_text:
    search_images("query") → set_src(nodeId, url)
    search_videos("query") → set_src(nodeId, url)
  Use the first result URL. Do not skip this step.
`;
}

// ── Build-mode types ─────────────────────────────────────────────────────────

interface BuildUnit {
  name: string;
  pageRoute: string;
  pageName: string;
  description: string;
  sectionCount?: number;
  layout?: string;
}

interface BuildPlan {
  mode: 'edit' | 'build' | 'mixed';
  editSummary?: string;
  buildUnits?: BuildUnit[];
  relations?: string[];
}

interface CollectedTree {
  unitName: string;
  tree: Record<string, unknown>;
  pageId: string | null;
  atIndex?: number;
}

// A non-structure tool call made by the mini-model during Phase 2 (add_variable, set_repeat, set_text).
// These are collected and streamed to the client in order before Phase 3.
interface ToolEvent {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

// ── Server-side UUID assignment for generate_structure ───────────────────────
// Keep AI pre-assigned UUIDs when valid; generate only for missing/invalid ones;
// deduplicate across the whole tree (second occurrence of the same UUID gets a fresh one).

const TREE_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function assignTreeIds(
  node: Record<string, unknown>,
  seen: Set<string> = new Set()
): Record<string, unknown> {
  const raw = typeof node.id === 'string' ? node.id : '';
  const id = TREE_UUID_RE.test(raw) && !seen.has(raw) ? raw : crypto.randomUUID();
  seen.add(id);
  const children = Array.isArray(node.children)
    ? (node.children as Record<string, unknown>[]).map(c => assignTreeIds(c, seen))
    : [];
  return { ...node, id, children };
}

// ── Phase 0: classify the request ────────────────────────────────────────────

const PLAN_SYSTEM = `You are a builder assistant planner. Analyze the user request and output ONLY a JSON object.

Classify:
- "edit" = modifying existing components (rename, restyle, move, delete, update workflows/variables)
- "build" = creating new pages or sections from scratch (no edits to existing)
- "mixed" = both editing existing AND creating new content

For "build" or "mixed", extract every independent build unit (page or section).
Each unit = one generate_structure call that creates one top-level section or page.

Output format — ONLY valid JSON, no markdown, no explanation:
{
  "mode": "edit" | "build" | "mixed",
  "editSummary": "one-line summary of the edit operations (omit for pure build)",
  "buildUnits": [
    { "name": "string", "pageRoute": "/route", "pageName": "Page Name", "description": "what to build", "sectionCount": 1, "layout": "optional layout hint" }
  ],
  "relations": ["optional: cross-section wiring needed after building"]
}`;

async function classifyRequest(
  message: string,
  pages: Array<{ id: string; name: string; route: string }>,
  modelId: string,
): Promise<BuildPlan> {
  const pageList = pages.map(p => `- "${p.name}" at ${p.route} (id: ${p.id})`).join('\n');
  const prompt = `Current pages:\n${pageList || '(none)'}\n\nUser request:\n${message}`;
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: PLAN_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as BuildPlan;
  } catch {
    // fall through to edit mode on any error
  }
  return { mode: 'edit' };
}

// ── Phase 1b: run one parallel build unit ────────────────────────────────────

async function runBuildUnit(
  unit: BuildUnit,
  assignedPageId: string | null,
  existingVariables: Array<{ id?: string; label?: string; name?: string; type?: string; initialValue?: unknown }> = [],
): Promise<{ trees: CollectedTree[]; toolEvents: ToolEvent[] }> {
  const trees: CollectedTree[] = [];
  // Non-structure tool calls (add_variable, set_repeat, set_text) collected here
  // and streamed to the client in dependency order before Phase 3.
  const toolEvents: ToolEvent[] = [];
  // Track variable UUIDs created in this session so set_text can warn about hallucinated UUIDs.
  const createdVarIds = new Set<string>();

  // Inject existing array variables so Phase 2 can reuse them instead of creating duplicates.
  const arrayVars = existingVariables.filter(v => v.type === 'array' && v.id);
  const existingVarsNote = arrayVars.length > 0
    ? `\nExisting array variables (prefer reusing these for set_repeat before creating new ones):\n${arrayVars.map(v => `  - "${v.label ?? v.name}" id="${v.id}" → use variables['${v.id}'] in set_repeat`).join('\n')}\n`
    : '';

  const sysPrompt = buildPhase2SysPrompt(existingVarsNote);

  const prompt = `Build: ${unit.name}
Description: ${unit.description}
${unit.sectionCount ? `Sections: ${unit.sectionCount}` : ''}
${unit.layout ? `Layout: ${unit.layout}` : ''}`;

  let currentMessages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: prompt }];
  let rounds = 0;

  while (rounds < 10) {
    rounds++;
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: sysPrompt,
      tools: ALL_BUILDER_TOOLS
        .filter(t => ['generate_structure', 'add_variable', 'set_repeat', 'set_text',
                      'search_images', 'search_videos', 'search_icons', 'set_src'].includes(t.name))
        .map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      messages: currentMessages,
    });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    currentMessages.push({ role: 'assistant', content: response.content });

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const rawInput = block.input as Record<string, unknown>;

      if (block.name === 'add_variable') {
        // Accept the AI's pre-assigned variableId if valid hex UUID, otherwise generate one.
        const aiVarId = rawInput.variableId as string | undefined;
        const assignedVarId = (aiVarId && isUUIDFormat(aiVarId)) ? aiVarId : crypto.randomUUID();
        const varName = String(rawInput.name ?? 'variable');
        // Track so set_text can warn about hallucinated UUIDs in the same session.
        createdVarIds.add(assignedVarId);
        const clientInput = { ...rawInput, variableId: assignedVarId, _assignedVarId: assignedVarId };
        toolEvents.push({ name: 'add_variable', input: clientInput, result: { success: true } });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({
            success: true,
            data: {
              id: assignedVarId,
              name: varName,
              message: `Created variable "${varName}" id="${assignedVarId}". ` +
                `Use variables['${assignedVarId}'] in formulas and set_repeat mapPath.`,
            },
          }),
        });

      } else if (block.name === 'generate_structure') {
        const treeInput = rawInput.tree as Record<string, unknown> | undefined | null;
        if (!treeInput || typeof treeInput !== 'object') {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ success: false, error: 'Missing required "tree" property. Pass the nested node tree under the "tree" key.' }),
          });
          continue;
        }
        const atIndex = rawInput.atIndex as number | undefined;
        const resolvedTree = assignTreeIds(treeInput);
        trees.push({ unitName: unit.name, tree: resolvedTree, pageId: assignedPageId, atIndex });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ success: true, data: { tree: resolvedTree, message: 'Structure created. Read the id field from each node in the returned tree to get its server-assigned UUID.' } }),
        });

      } else if (block.name === 'set_repeat') {
        const srMapPath = rawInput.mapPath as string | undefined;
        // Reject legacy/hallucinated params — same validation as tool-executor.ts
        if (!srMapPath && (rawInput.dataSource || rawInput.collectionExpression || rawInput.itemName)) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({
              success: false,
              error: 'Unknown parameter(s). Use mapPath (e.g. "variables[\'UUID\']") and keyField. ' +
                'Item scope is always context?.item?.data.* — never use custom aliases.',
            }),
          });
        } else if (!srMapPath) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ success: false, error: 'mapPath is required for set_repeat.' }),
          });
        } else {
          toolEvents.push({ name: 'set_repeat', input: rawInput, result: { success: true } });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ success: true, message: `Repeat wired over "${srMapPath}".` }),
          });
        }

      } else if (block.name === 'search_images') {
        try {
          const q = encodeURIComponent(String(rawInput.query ?? ''));
          const count = Number(rawInput.count ?? 5);
          const apiKey = process.env.UNSPLASH_ACCESS_KEY;
          if (apiKey) {
            const r = await fetch(`https://api.unsplash.com/search/photos?query=${q}&per_page=${count}&client_id=${apiKey}`);
            if (r.ok) {
              const d = await r.json() as { results?: Array<{ urls: { regular: string; small: string }; alt_description: string; user: { name: string } }> };
              const photos = (d.results ?? []).map(p => ({ url: p.urls.regular, thumb: p.urls.small, alt: p.alt_description, credit: p.user.name }));
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(photos) });
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: `Unsplash API error ${r.status}` }) });
            }
          } else {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'UNSPLASH_ACCESS_KEY not configured' }) });
          }
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: String(e) }) });
        }

      } else if (block.name === 'search_videos') {
        try {
          const q = encodeURIComponent(String(rawInput.query ?? ''));
          const count = Number(rawInput.count ?? 4);
          const apiKey = process.env.PEXELS_API_KEY;
          if (apiKey) {
            const url = q
              ? `https://api.pexels.com/videos/search?query=${q}&page=1&per_page=${count}`
              : `https://api.pexels.com/videos/popular?page=1&per_page=${count}`;
            const r = await fetch(url, { headers: { Authorization: apiKey }, next: { revalidate: 300 } });
            if (r.ok) {
              const d = await r.json() as { videos?: Array<{ image: string; video_files: Array<{ quality: string; link: string }> }> };
              const videos = (d.videos ?? []).map(v => {
                const sd = v.video_files.find(f => f.quality === 'sd') ?? v.video_files[0];
                return { src: sd?.link ?? '', poster: v.image };
              }).filter(v => v.src);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(videos) });
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: `Pexels API error ${r.status}` }) });
            }
          } else {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'PEXELS_API_KEY not configured' }) });
          }
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: String(e) }) });
        }

      } else if (block.name === 'search_icons') {
        try {
          const q = encodeURIComponent(String(rawInput.query ?? ''));
          const count = Number(rawInput.count ?? 10);
          const prefix = rawInput.prefix ? `&prefix=${rawInput.prefix}` : '';
          const r = await fetch(`https://api.iconify.design/search?query=${q}&limit=${count}${prefix}`);
          if (r.ok) {
            const d = await r.json() as { icons?: string[] };
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(d.icons ?? []) });
          } else {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: `Iconify API error ${r.status}` }) });
          }
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: String(e) }) });
        }

      } else if (block.name === 'set_src') {
        // Client-side mutation — record so the client executes it
        toolEvents.push({ name: 'set_src', input: rawInput, result: { success: true } });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ success: true, message: 'src queued for client execution.' }) });

      } else if (block.name === 'set_text') {
        toolEvents.push({ name: 'set_text', input: rawInput, result: { success: true } });
        // Warn if the text formula references a variables['UUID'] that was not created in this session.
        // This catches the hallucination pattern where haiku invents a UUID instead of using the one
        // returned by add_variable. The warning message tells the AI exactly which UUIDs are unknown
        // so it can self-correct in the next tool call.
        const textValue = String(rawInput.text ?? '');
        const uuidMatches = [...textValue.matchAll(/variables\['([0-9a-fA-F-]{36})'\]/g)].map(m => m[1]);
        const unknownUUIDs = uuidMatches.filter(id => !createdVarIds.has(id));
        const warningMsg = unknownUUIDs.length > 0
          ? ` ⚠️ WARNING: formula references variable UUID(s) not created in this session: [${unknownUUIDs.join(', ')}]. ` +
            `Re-read your add_variable tool results and replace with the exact UUID that was returned. ` +
            `Valid variable UUIDs in this session: [${[...createdVarIds].join(', ') || 'none yet'}].`
          : '';
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ success: true, message: `Text bound.${warningMsg}` }),
        });

      }
    }

    // Stop when AI signals it is done
    if (response.stop_reason === 'end_turn') break;
    // Continue the conversation if there are tool results to feed back
    if (toolResults.length > 0) {
      currentMessages.push({ role: 'user', content: toolResults });
    } else {
      break; // no tools called and not end_turn — stop to avoid infinite loop
    }
  }

  return { trees, toolEvents };
}

// Strict hex-only UUID validation — rejects non-hex chars (g-z) and short aliases.
// The AI is instructed to generate proper UUIDs; if it doesn't, we fail fast so it self-corrects.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isUUIDFormat(s: string): boolean { return UUID_RE.test(s); }

// Max tool-call rounds to prevent infinite loops.
// Complex tasks (create page → switch → structure → configure → style → text) need many rounds;
// 100 gives full budget for the most complex multi-section builds.
const MAX_TOOL_ROUNDS = 100;

// Models that support Anthropic extended thinking
const THINKING_MODELS = new Set(['claude-sonnet-4-5']);
const VALID_MODELS = new Set(['claude-haiku-4-5', 'claude-sonnet-4-5']);

interface ChatRequestBody {
  message: string;
  selectedNodeIds?: string[];
  selectedNodesDetails?: unknown[];
  pageTreeSnapshot?: Array<{ id?: string; type?: string; name?: string }>;
  pageId?: string;
  pages?: Array<{ id: string; name: string; route: string }>;
  theme?: Record<string, string>;
  mood?: string;
  animationLevel?: number;
  layoutStructure?: number;
  appName?: string;
  description?: string;
  category?: string;
  variables?: Array<{ id?: string; name: string; label?: string; type: string; initialValue?: unknown }>;
  workflows?: Array<{ name: string; trigger: string }>;
  dataSources?: Array<{ id: string; label: string; path: string }>;
  threadId?: string;
  chatHistory?: Array<{ role: string; content: string }>;
  /** Which Anthropic model to use (defaults to claude-haiku-4-5) */
  model?: string;
  // On subsequent turns (after tool execution), tool results are sent back
  toolResults?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
  /** When true, the client is continuing a Phase 3 styling session across a tool-result request.
   *  The server must restore inPhase3Mode=true so Phase 3 tool restrictions are preserved. */
  isPhase3Continuation?: boolean;
  /** When true, skip the AI call and return the built system prompt as JSON */
  systemPromptOnly?: boolean;
}

// ── Build palette snapshot from the project's live theme overrides ─────────────
// `themeOverrides` comes from store.themeOverrides on the client — it contains
// the full hex values applied by the active theme preset plus any manual edits.
// Keys are stored WITHOUT the '--' prefix (e.g. 'background', 'primary') —
// _applyLightOverrides prepends '--' when injecting CSS vars into the DOM.
// We map them to the --theme-* names used in className values, with NO fallback
// to config/theme.json — if a value is absent the AI simply won't see it.
// Returns a multi-line string: "  var(--theme-primary)    = #00b4d8  (brand accent)"
const THEME_VAR_MAP: Array<[string, string, string]> = [
  ['background',           '--theme-background',          'page background'],
  ['foreground',           '--theme-foreground',          'primary text'],
  ['primary',              '--theme-primary',             'brand accent'],
  ['primary-foreground',   '--theme-primary-foreground',  'text on primary'],
  ['secondary',            '--theme-secondary',           'secondary'],
  ['secondary-foreground', '--theme-secondary-foreground','text on secondary'],
  ['muted',                '--theme-muted',               'muted bg'],
  ['muted-foreground',     '--theme-muted-foreground',    'secondary text'],
  ['card',                 '--theme-card',                'card surface'],
  ['card-foreground',      '--theme-card-foreground',     'card text'],
  ['border',               '--theme-border',              'borders'],
  ['destructive',          '--theme-destructive',         'error/danger'],
  ['accent',               '--theme-accent',              'accent'],
  ['accent-foreground',    '--theme-accent-foreground',   'text on accent'],
];

function buildPaletteSnapshot(themeOverrides: Record<string, string>): string {
  const lines: string[] = [];
  for (const [sourceVar, themeVar, label] of THEME_VAR_MAP) {
    const hex = themeOverrides[sourceVar];
    if (hex) {
      lines.push(`  ${sourceVar}${' '.repeat(Math.max(1, 28 - sourceVar.length))}= ${hex}  (${label})`);
    }
  }
  return lines.length ? lines.join('\n') : '(no theme palette — user has not applied a theme)';
}

export async function POST(req: NextRequest) {
  const body = await req.json() as ChatRequestBody;
  const {
    message,
    selectedNodeIds = [],
    selectedNodesDetails = [],
    pageTreeSnapshot = [],
    pageId,
    pages = [],
    theme = {},
    mood,
    animationLevel,
    layoutStructure,
    appName,
    description,
    category,
    variables = [],
    workflows = [],
    dataSources = [],
    chatHistory = [],
    toolResults,
    model: requestedModel,
    systemPromptOnly = false,
    isPhase3Continuation = false,
  } = body;

  // Resolve model — only accept known models, default to haiku
  const modelId = (requestedModel && VALID_MODELS.has(requestedModel)) ? requestedModel : 'claude-haiku-4-5';
  const supportsThinking = THINKING_MODELS.has(modelId);

  // ── Build system prompt ─────────────────────────────────────────────────────

  const currentPage = (pageId ? pages.find(p => p.id === pageId) : undefined) ?? pages[0] ?? { id: 'home', name: 'Home', route: '/' };

  const paletteSnapshot = buildPaletteSnapshot(theme);

  const systemPrompt = buildChatSystemPrompt({
    pages,
    currentPageName: currentPage.name,
    currentPageRoute: currentPage.route,
    paletteSnapshot,
    mood,
    animationLevel,
    layoutStructure,
    appName,
    description,
    category,
  });

  // Recursive page tree printer — emits name (id) [type] for every node up to 3 levels deep.
  // This gives Claude full visibility of nested node IDs so it can reference them directly
  // on follow-up turns without needing to call get_page_tree() first.
  type SnapNode = { id?: string; type?: string; name?: string; text?: string; children?: unknown[]; childCount?: number };
  function printTree(nodes: SnapNode[], indent = ''): string {
    return nodes.map(n => {
      const label = `${indent}• ${n.name ?? n.type ?? 'Node'} (id:${n.id ?? '?'}) [${n.type ?? '?'}]${n.text ? ` "${n.text}"` : ''}`;
      const kids = (n.children ?? []) as SnapNode[];
      return kids.length ? label + '\n' + printTree(kids, indent + '  ') : label;
    }).join('\n');
  }

  // Add context about selected nodes and page tree as a system note
  const fmtInitial = (val: unknown): string => {
    if (Array.isArray(val)) return `array (${val.length} items)`;
    if (typeof val === 'object' && val !== null) return 'object';
    return String(val);
  };

  const contextNote = [
    selectedNodesDetails.length > 0
      ? `Selected: ${selectedNodesDetails.map((n: unknown) => { const node = n as { type?: string; id?: string; name?: string }; return `${node.type ?? 'Node'} "${node.name ?? 'untitled'}" (id: ${node.id ?? '?'})`; }).join(', ')}`
      : `Nothing selected`,
    pageTreeSnapshot.length > 0
      ? `Current page has ${pageTreeSnapshot.length} top-level section(s). Use search_nodes(query) to find a node by name/type/text, or get_page_tree() to inspect the full structure.`
      : `Current page is empty — no nodes yet.`,
    variables.length > 0
      ? `Variables: ${variables.map(v => `${v.label ?? v.name}${v.type ? ` — ${v.type}` : ''}${v.initialValue != null ? `, initial: ${fmtInitial(v.initialValue)}` : ''}${v.id ? ` (id: ${v.id}, path: variables['${v.id}'])` : ''}`).join(', ')}`
      : null,
    workflows.length > 0 ? `Workflows: ${workflows.map(w => `${w.name} (trigger: ${w.trigger})`).join(', ')}` : null,
    dataSources.length > 0 ? `DataSources: ${dataSources.map(d => `${d.label} → ${d.path}`).join(', ')}` : null,
  ].filter(Boolean).join('\n');

  // ── Early return for system prompt inspection ────────────────────────────────
  if (systemPromptOnly) {
    const full = contextNote ? `${systemPrompt}\n\n[Builder Context]\n${contextNote}` : systemPrompt;
    const phase3Prompt = buildPhase3SystemPrompt({
      pages,
      currentPageName: currentPage.name,
      currentPageRoute: currentPage.route,
      paletteSnapshot,
      mood,
      animationLevel,
      appName,
      description,
      category,
    });
    return Response.json({
      systemPrompt: full,
      phase2Prompt: buildPhase2SysPrompt(),
      phase3Prompt,
      phase2Tools: ['generate_structure', 'add_variable', 'set_repeat', 'set_text',
                    'search_images', 'search_videos', 'search_icons', 'set_src'],
      phase3Tools: PHASE3_BUILDER_TOOLS.map(t => t.name),
      mainTools: ALL_BUILDER_TOOLS.map(t => t.name),
    });
  }

  // ── Build message history ────────────────────────────────────────────────────

  const messages: Anthropic.Messages.MessageParam[] = [];

  // Add previous conversation (last 10 turns for context)
  for (const m of chatHistory.slice(-10)) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }
  }

  // Add the current user message (with context note if available)
  const userContent = contextNote
    ? `[Context]\n${contextNote}\n\n[User Request]\n${message}`
    : message;

  messages.push({ role: 'user', content: userContent });

  // If tool results are being sent back (client-side tool execution model),
  // add them as a tool_result message
  if (toolResults?.length) {
    messages.push({
      role: 'user',
      content: toolResults.map(r => ({
        type: 'tool_result' as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error,
      })),
    });
  }

  // ── Set up SSE stream ────────────────────────────────────────────────────────

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });

  const send = (event: Record<string, unknown>) => {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // stream closed
    }
  };

  // ── Detect build / mixed mode ────────────────────────────────────────────────
  // Always call Phase 0 classifier for first-round messages — it uses Haiku (fast, cheap)
  // and correctly returns "edit" for non-build requests, so there is no routing cost.
  // A regex heuristic would silently miss any request that doesn't match the pattern.
  const mightBeBuildRequest = !toolResults?.length;

  // ── Run AI loop ──────────────────────────────────────────────────────────────

  void (async () => {
    let currentMessages = [...messages];
    let rounds = 0;
    const allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }> = [];
    // Set to true by runBuildOrMixedMode after Phase 2 completes — Phase 3 uses haiku for speed
    let useHaikuForNextRound = false;
    // Stays true for ALL Phase 3 rounds once first activated — prevents revert to full prompt/tools.
    // Also restored from isPhase3Continuation when the client sends back tool results across requests.
    let inPhase3Mode = isPhase3Continuation;

    // ── Build / mixed mode orchestrator ──────────────────────────────────────
    async function runBuildOrMixedMode(plan: BuildPlan): Promise<boolean> {
      // Phase 1 (mixed only): run sequential edit loop first
      if (plan.mode === 'mixed' && plan.editSummary) {
        send({ type: 'build_phase', phase: 'editing', message: 'Applying changes...' });
        const editMsgs: Anthropic.Messages.MessageParam[] = [
          ...currentMessages.slice(0, -1),
          { role: 'user', content: `${contextNote ? `[Context]\n${contextNote}\n\n` : ''}[Edit Operations]\n${plan.editSummary}\n\nApply ONLY the edit operations listed above. Do NOT create new pages or sections.` },
        ];
        await runEditLoop(editMsgs);
      }

      // Phase 2: parallel build
      const units = plan.buildUnits ?? [];
      if (units.length === 0) { send({ type: 'done', tools: allExecutedTools }); return false; }

      send({ type: 'build_phase', phase: 'building', total: units.length, message: `Building ${units.length} section${units.length !== 1 ? 's' : ''} in parallel...`, buildUnits: units.map(u => ({ name: u.name, description: u.description, pageRoute: u.pageRoute, sectionCount: u.sectionCount })) });

      // Create new pages upfront (sequential — avoids ID/Zustand conflicts)
      const pageIdMap: Record<string, string> = {};
      for (const unit of units) {
        const isCurrent = !unit.pageRoute || unit.pageRoute === '/' || unit.pageRoute === currentPage.route;
        if (isCurrent) { pageIdMap[unit.pageRoute ?? '/'] = pageId ?? currentPage.id; continue; }
        const existing = pages.find(p => p.route === unit.pageRoute);
        if (existing) { pageIdMap[unit.pageRoute] = existing.id; continue; }
        const newPageId = `page-${crypto.randomUUID().slice(0, 8)}`;
        pageIdMap[unit.pageRoute] = newPageId;
        send({ type: 'tool_executed', id: `page-create-${newPageId}`, name: 'add_page', input: { route: unit.pageRoute, name: unit.pageName, pageId: newPageId, _assignedPageId: newPageId } });
      }

      // Run all unit builds in parallel (no store writes — just collect trees + tool events)
      const unitResults = await Promise.all(units.map(unit => runBuildUnit(unit, pageIdMap[unit.pageRoute ?? '/'] ?? null, variables)));

      // Sequential insertion — prevents concurrent Zustand writes.
      // Dependency order per unit: add_variable → generate_structure → set_repeat/set_text
      let done = 0;
      for (const { trees, toolEvents: unitEvents } of unitResults) {
        // 1. Stream add_variable events first (variable must exist before structure or set_repeat)
        for (const event of unitEvents.filter(e => e.name === 'add_variable')) {
          send({ type: 'tool_executed', id: `var-${done}-${Date.now()}`, name: event.name, input: event.input });
          allExecutedTools.push({ name: event.name, input: event.input });
        }

        // 2. Stream generate_structure trees
        for (const t of trees) {
          const isCurrentPage = !t.pageId || t.pageId === (pageId ?? currentPage.id);
          send({ type: 'tool_executed', id: `build-${t.unitName}-${done}`, name: 'generate_structure', input: { tree: t.tree, parentId: undefined, atIndex: t.atIndex, _pageId: isCurrentPage ? undefined : t.pageId } });
          allExecutedTools.push({ name: 'generate_structure', input: { tree: t.tree } });
        }

        // 3. Stream set_repeat and set_text events (depend on node IDs from generate_structure)
        for (const event of unitEvents.filter(e => e.name !== 'add_variable')) {
          send({ type: 'tool_executed', id: `wire-${event.name}-${done}-${Date.now()}`, name: event.name, input: event.input });
          allExecutedTools.push({ name: event.name, input: event.input });
        }

        done++;
        send({ type: 'section_progress', done, total: units.length, name: units[done - 1]?.name ?? '' });
      }

      // Phase 3: STYLING ONLY — variables and repeat wiring done above by mini-model
      const allTrees = unitResults.flatMap(r => r.trees);
      if (allTrees.length > 0) {
        const relations = plan.relations ?? [];
        const relationsNote = relations.length > 0
          ? `\n\nAlso wire these connections:\n${relations.join('\n')}`
          : '';
        // Collect pages that are NOT the current page — the AI must switch to them first
        const createdPageIds = [...new Set(
          allTrees
            .map(t => t.pageId)
            .filter((id): id is string => !!id && id !== (pageId ?? currentPage.id))
        )];
        const pageContextNote = createdPageIds.length > 0
          ? `\n\nIMPORTANT: The structure was built on page(s): ${createdPageIds.join(', ')}\nCall switch_page(pageId) FIRST, then apply styling using the UUIDs from the generate_structure results above.\n\nCRITICAL RULES — follow exactly:\n1. DO NOT call get_page_tree or search_nodes — all node IDs are in the generate_structure results above. Use them directly.\n2. DO NOT call add_page or generate_structure — the structure already exists.\n3. The system prompt may still show the old current page; that context is outdated. Ignore it and use the node IDs from the generate_structure results.`
          : '';

        // Build synthetic conversation turns so Phase 3 sees add_variable + generate_structure
        // tool results in the exact same format as normal sessions. This gives Phase 3 native
        // access to the resolved tree (with UUID in each node's id field) AND the full variable
        // definitions (field names, initial values) so it can use correct field names in formulas.
        const syntheticMessages: Anthropic.Messages.MessageParam[] = [];

        // Inject add_variable events FIRST — Phase 3 must see the initialValue to know exact
        // field names (e.g. "highlight" not "featured") before writing set_condition formulas.
        const addVarEvents = unitResults.flatMap(r => r.toolEvents.filter(e => e.name === 'add_variable'));
        for (const e of addVarEvents) {
          const varName = String((e.input as Record<string, unknown>).name ?? 'variable');
          const varId = String((e.input as Record<string, unknown>).variableId ?? '');
          const toolUseId = `add-var-${varName.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          syntheticMessages.push({
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolUseId, name: 'add_variable', input: e.input }],
          });
          syntheticMessages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: JSON.stringify({
                success: true,
                data: {
                  id: varId,
                  name: varName,
                  message: `Created variable "${varName}" (${varId}). Use exact field names from initialValue in set_condition formulas and set_text bindings.`,
                },
              }),
            }],
          });
        }

        for (const t of allTrees) {
          const toolUseId = `gen-struct-${t.unitName.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          // Synthetic assistant turn: the AI "called" generate_structure with this tree
          syntheticMessages.push({
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolUseId, name: 'generate_structure', input: { tree: t.tree } }],
          });
          // Synthetic user turn: return resolved tree with server-assigned UUIDs in each id field
          syntheticMessages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: JSON.stringify({
                success: true,
                data: {
                  tree: t.tree,
                  message: 'Structure created. Read the id field from each node in the returned tree to get its server-assigned UUID.',
                },
              }),
            }],
          });
        }

        // Inject set_repeat and set_text events so Phase 3 sees the completed wiring.
        // Without this, Phase 3 is told wiring is done but has no evidence — it tries to redo it.
        const wiringEvents = unitResults.flatMap(r =>
          r.toolEvents.filter(e =>
            ['set_repeat', 'set_text', 'set_src', 'search_images', 'search_videos', 'search_icons'].includes(e.name)
          )
        );
        for (const e of wiringEvents) {
          const toolUseId = `wire-${e.name}-${(e.input as Record<string, unknown>).nodeId}`;
          syntheticMessages.push({
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolUseId, name: e.name, input: e.input }],
          });
          syntheticMessages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: JSON.stringify({ success: true, message: `${e.name} applied in Phase 2.` }),
            }],
          });
        }

        send({ type: 'build_phase', phase: 'wiring', message: 'Styling...' });
        currentMessages = [
          ...syntheticMessages,
          {
            role: 'user',
            content: `${contextNote ? `[Context]\n${contextNote}\n\n` : ''}[Post-Build Styling and Wiring]
Structure, variables, repeat wiring, and media src are complete. Now do two things:
1. Apply all visual styling the request calls for.
2. Create and bind any workflows needed for interactive behavior (toggles, navigation, form submissions, etc.).

All node IDs are in the generate_structure results above — read the id field from each node in the returned tree to get its UUID.
If a switch_page instruction is present, call it FIRST.

Repeat template reminder: style ALL children (buttons, icons, text/headings) — no exceptions. When any boolean field exists in the repeat data, apply ternary expressions for background, text color, border, shadow, icon name, and icon color per item.

Original request:
${message}${relationsNote}${pageContextNote}`,
          },
        ];
        // Signal caller to continue with standard loop for Phase 3 styling
        // Phase 3 uses haiku — fast and cheap for mechanical styling operations
        useHaikuForNextRound = true;
        return true;
      }

      send({ type: 'done', tools: allExecutedTools });
      return false;
    }

    // ── Focused edit loop (used by mixed mode for edit phase) ────────────────
    async function runEditLoop(editMsgs: Anthropic.Messages.MessageParam[]): Promise<void> {
      let editRounds = 0;
      while (editRounds < MAX_TOOL_ROUNDS) {
        editRounds++;
        send({ type: 'round_start', round: editRounds });
        const editResp = client.messages.stream({
          model: modelId, max_tokens: 4096,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          tools: ALL_BUILDER_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
          messages: editMsgs,
        } as Parameters<typeof client.messages.stream>[0]);
        const editToolBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
        let editStop = '';
        let editToolBlock: { id: string; name: string; inputJson: string } | null = null;
        for await (const ev of editResp) {
          if (ev.type === 'content_block_start' && (ev.content_block as { type: string }).type === 'tool_use') {
            const tb = ev.content_block as { id: string; name: string };
            editToolBlock = { id: tb.id, name: tb.name, inputJson: '' };
          } else if (ev.type === 'content_block_delta') {
            const dt = (ev.delta as { type: string }).type;
            if (dt === 'text_delta') send({ type: 'text_delta', content: (ev.delta as { text: string }).text });
            else if (dt === 'input_json_delta' && editToolBlock) editToolBlock.inputJson += (ev.delta as { partial_json: string }).partial_json;
          } else if (ev.type === 'content_block_stop' && editToolBlock) {
            try { editToolBlocks.push({ id: editToolBlock.id, name: editToolBlock.name, input: JSON.parse(editToolBlock.inputJson || '{}') as Record<string, unknown> }); }
            catch { editToolBlocks.push({ id: editToolBlock.id, name: editToolBlock.name, input: {} }); }
            editToolBlock = null;
          } else if (ev.type === 'message_delta') {
            editStop = (ev.delta as { stop_reason?: string }).stop_reason ?? '';
          }
        }
        const editFinal = await editResp.finalMessage();
        editStop = editFinal.stop_reason ?? editStop;
        editMsgs.push({ role: 'assistant', content: editFinal.content });
        if (editToolBlocks.length === 0) break;
        const editResultBlocks: Anthropic.Messages.ToolResultBlockParam[] = [];
        for (const t of editToolBlocks) {
          const ri = t.input;
          let tr = JSON.stringify({ ok: true, pending: 'client_execution' });
          if (t.name === 'get_page_tree') tr = JSON.stringify({ pageName: currentPage.name, sections: pageTreeSnapshot });
          else if (t.name === 'get_pages') tr = JSON.stringify(pages);
          else if (t.name === 'get_variables') tr = JSON.stringify(variables);
          else if (t.name === 'get_workflows') tr = JSON.stringify(workflows);
          else if (t.name === 'search_nodes') {
            const q = String(ri.query ?? '').toLowerCase();
            type SN = { id?: string; type?: string; name?: string; children?: unknown[] };
            const hits: Array<{ id: string | undefined; name: string | undefined; type: string | undefined; breadcrumb: string }> = [];
            const wk = (nodes: SN[], bc: string[]) => { for (const n of nodes) { const c = [...bc, n.name ?? n.type ?? 'Node']; if ((n.name ?? '').toLowerCase().includes(q) || (n.type ?? '').toLowerCase().includes(q)) hits.push({ id: n.id, name: n.name, type: n.type, breadcrumb: c.join(' > ') }); if (Array.isArray(n.children)) wk(n.children as SN[], c); } };
            wk(pageTreeSnapshot as SN[], []);
            tr = JSON.stringify(hits.length ? hits : { note: `No nodes found matching "${ri.query}"` });
          } else if (t.name === 'generate_structure') {
            const resolved = assignTreeIds(ri.tree as Record<string, unknown>);
            const ci = { tree: resolved, parentId: ri.parentId, atIndex: ri.atIndex };
            send({ type: 'tool_executed', id: t.id, name: t.name, input: ci });
            allExecutedTools.push({ name: t.name, input: ci });
            tr = JSON.stringify({ success: true, data: { tree: resolved, message: 'Structure created. Read the id field from each node in the returned tree to get its server-assigned UUID.' } });
            editResultBlocks.push({ type: 'tool_result', tool_use_id: t.id, content: tr });
            continue;
          }
          send({ type: 'tool_executed', id: t.id, name: t.name, input: ri });
          allExecutedTools.push({ name: t.name, input: ri });
          editResultBlocks.push({ type: 'tool_result', tool_use_id: t.id, content: tr });
        }
        editMsgs.push({ role: 'user', content: editResultBlocks });
        if (editStop !== 'tool_use') break;
      }
    }

    try {
      // ── Phase 0: classify for build / mixed mode ──────────────────────────
      if (mightBeBuildRequest) {
        send({ type: 'build_phase', phase: 'planning', message: 'Planning your request...' });
        const plan = await classifyRequest(message, pages, modelId);

        if (plan.mode === 'build' || plan.mode === 'mixed') {
          const needsWiring = await runBuildOrMixedMode(plan);
          if (!needsWiring) return; // done — no wiring phase needed
          // needsWiring=true: currentMessages set for wiring, fall through to standard loop
        }
        // mode === 'edit' falls through to the standard loop
      }

      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++;

        // Tell the client a new Anthropic call is starting (shows "Planning…" between rounds)
        send({ type: 'round_start', round: rounds });

        // Create streaming request to Anthropic using the stream helper (has finalMessage())
        // Phase 3 (post-build styling) uses haiku with a focused prompt + filtered tools.
        // inPhase3Mode persists across all rounds so rounds 2+ don't revert to full prompt/tools.
        if (useHaikuForNextRound) {
          inPhase3Mode = true;
          useHaikuForNextRound = false;
          // Signal to client that Phase 3 has started — client passes isPhase3Continuation=true
          // on all subsequent tool-result requests so the server can restore inPhase3Mode.
          send({ type: 'phase3_started' });
        }
        const isPhase3 = inPhase3Mode;
        const activeModel = isPhase3 ? 'claude-haiku-4-5' : modelId;
        const activeSupportsThinking = supportsThinking && activeModel === modelId;
        // Phase 3 gets a focused styling-only system prompt; edit mode gets the full prompt
        const activeSystemPrompt = isPhase3
          ? buildPhase3SystemPrompt({ pages, currentPageName: currentPage.name, currentPageRoute: currentPage.route, paletteSnapshot, mood, animationLevel, appName, description, category })
          : systemPrompt;
        // Phase 3 gets only styling tools — structure tools are architecturally excluded
        const activeTools = isPhase3 ? PHASE3_BUILDER_TOOLS : ALL_BUILDER_TOOLS;
        const response = client.messages.stream({
          model: activeModel,
          // Thinking models need a higher token budget (thinking uses tokens too)
          max_tokens: 16000,
          // Pass system prompt as an array block with cache_control so Anthropic caches
          // the large prompt across rounds — cuts TTFB on rounds 2+ significantly
          system: [{ type: 'text', text: activeSystemPrompt, cache_control: { type: 'ephemeral' } }],
          ...(activeSupportsThinking ? { thinking: { type: 'enabled', budget_tokens: 8000 } } : {}),
          tools: activeTools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          })),
          messages: currentMessages,
        } as Parameters<typeof client.messages.stream>[0]);

        // Collect response blocks incrementally — no need to wait for finalMessage() for tool extraction
        let textContent = '';
        const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
        let stopReason = '';
        // Track the tool_use block currently being streamed
        let currentToolBlock: { id: string; name: string; inputJson: string } | null = null;
        // Track extended thinking block (Sonnet only)
        let currentThinkingBlock: { content: string } | null = null;

        for await (const event of response) {
          if (event.type === 'content_block_start') {
            const blockType = (event.content_block as { type: string }).type;
            if (blockType === 'tool_use') {
              const tb = event.content_block as { id: string; name: string };
              currentToolBlock = { id: tb.id, name: tb.name, inputJson: '' };
            } else if (blockType === 'thinking') {
              currentThinkingBlock = { content: '' };
            }
          } else if (event.type === 'content_block_delta') {
            const deltaType = (event.delta as { type: string }).type;
            if (deltaType === 'text_delta') {
              const text = (event.delta as { type: string; text: string }).text;
              textContent += text;
              send({ type: 'text_delta', content: text });
            } else if (deltaType === 'input_json_delta' && currentToolBlock) {
              currentToolBlock.inputJson += (event.delta as { type: string; partial_json: string }).partial_json;
            } else if (deltaType === 'thinking_delta' && currentThinkingBlock) {
              const thinking = (event.delta as { type: string; thinking: string }).thinking;
              currentThinkingBlock.content += thinking;
              send({ type: 'thinking_delta', content: thinking });
            }
          } else if (event.type === 'content_block_stop') {
            if (currentToolBlock) {
              // Tool input is fully received — parse and store without waiting for finalMessage()
              try {
                toolUseBlocks.push({
                  id: currentToolBlock.id,
                  name: currentToolBlock.name,
                  input: JSON.parse(currentToolBlock.inputJson || '{}') as Record<string, unknown>,
                });
              } catch {
                // Malformed JSON — push empty input so the round can continue
                toolUseBlocks.push({ id: currentToolBlock.id, name: currentToolBlock.name, input: {} });
              }
              currentToolBlock = null;
            }
            if (currentThinkingBlock) {
              currentThinkingBlock = null;
            }
          } else if (event.type === 'message_delta') {
            stopReason = (event.delta as { stop_reason?: string }).stop_reason ?? '';
          }
        }

        // finalMessage() is still needed to get the full content array for the conversation history
        // (it resolves immediately since we already exhausted the stream above)
        const finalMessage = await response.finalMessage();
        stopReason = finalMessage.stop_reason ?? stopReason;

        // Reconcile streamed toolUseBlocks with finalMessage.content.
        // When max_tokens is hit mid-response, the last tool_use block may not receive a
        // content_block_stop event, so it ends up in finalMessage.content but not in
        // toolUseBlocks. Without this reconciliation, the assistant message has an orphaned
        // tool_use block with no corresponding tool_result → Anthropic 400 on the next round.
        {
          const streamedIds = new Set(toolUseBlocks.map(t => t.id));
          for (const block of finalMessage.content) {
            if (block.type !== 'tool_use') continue;
            const tb = block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
            if (!streamedIds.has(tb.id)) {
              toolUseBlocks.push({ id: tb.id, name: tb.name, input: tb.input ?? {} });
            }
          }
        }

        // Add assistant response to message history for continuation
        currentMessages.push({
          role: 'assistant',
          content: finalMessage.content,
        });

        // If tool calls were made, send them to the client for execution
        if (toolUseBlocks.length > 0) {
          const toolResultsForNextRound: Anthropic.Messages.ToolResultBlockParam[] = [];

          for (const tool of toolUseBlocks) {
            // For read-only tools, execute server-side and return results
            // For mutation tools, the client executes them
            const isReadTool = ['get_page_tree', 'get_node_details', 'get_theme', 'get_variables', 'get_pages', 'get_formula_context', 'get_workflows', 'get_data_sources', 'search_nodes'].includes(tool.name);
            const isSearchTool = ['search_images', 'search_videos', 'search_icons'].includes(tool.name);
            // add_component: AI provides its own hex UUID for nodeId — validate it strictly.
            const isAddComponentTool = tool.name === 'add_component';
            // Media node tools: AI does not provide nodeId — server generates one.
            const isMediaNodeTool = ['add_icon', 'add_image', 'add_video'].includes(tool.name);
            // Variable-creating tool — always generate a server UUID so variable IDs stay stable
            const isVarCreateTool = tool.name === 'add_variable';
            // Page-creating tool — pre-assign a page ID so Claude can use it in switch_page immediately
            const isPageCreateTool = tool.name === 'add_page';

            const rawInput = tool.input as Record<string, unknown>;

            let toolResult: string;
            // input sent to client
            let clientInput: Record<string, unknown> = rawInput;
            // When true, skip sending tool_executed to the client (nothing was created server-side)
            let skipClientExecution = false;

            if (isAddComponentTool) {
              // Validate that the AI provided a proper hex UUID. If not, fail immediately and
              // do NOT send tool_executed to the client — prevents phantom node creation.
              // The AI sees the error and self-corrects; no duplicate node is left on canvas.
              const nodeId = rawInput.nodeId as string | undefined;
              if (!nodeId || !isUUIDFormat(nodeId)) {
                skipClientExecution = true;
                toolResult = JSON.stringify({
                  success: false,
                  error: `nodeId "${nodeId ?? '(missing)'}" is not a valid UUID. ` +
                    `Generate a proper hex UUID (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890") and retry this tool call. ` +
                    `Do NOT call any other tools that reference this nodeId as parentId until this is fixed.`,
                });
              } else {
                // nodeId is valid — pass rawInput directly (nodeId is already in it, no _assignedNodeId needed)
                clientInput = rawInput;
                const placement = rawInput.parentId
                  ? `placed under parentId: ${rawInput.parentId}`
                  : `placed at ROOT of page (no parentId)`;
              toolResult = JSON.stringify({
                success: true,
                data: {
                    nodeId,
                  type: rawInput.label ?? 'node',
                    message: `Added ${rawInput.label ?? 'component'} (${placement}). nodeId="${nodeId}". Use as parentId for children or in set_text/set_class/rename_node.`,
                },
              });
              }
            } else if (isMediaNodeTool) {
              // AI doesn't provide nodeId for icon/image/video — server generates one so the
              // client executor has a stable ID to use.
              const assignedNodeId = crypto.randomUUID();
              clientInput = { ...rawInput, _assignedNodeId: assignedNodeId };
              toolResult = JSON.stringify({ ok: true, pending: 'client_execution' });
            } else if (isVarCreateTool) {
              // Respect the AI's variableId if it is a valid hex UUID (same pattern as add_component).
              // This allows batching: AI pre-assigns a UUID, uses it in create_workflow variableName
              // in the same round without a round-trip. Only generate a server UUID as fallback.
              const aiVarId = rawInput.variableId as string | undefined;
              const assignedVarId = (aiVarId && isUUIDFormat(aiVarId))
                ? aiVarId
                : crypto.randomUUID();
              clientInput = { ...rawInput, variableId: assignedVarId, _assignedVarId: assignedVarId };
              const varName = String(rawInput.name ?? 'variable');
              toolResult = JSON.stringify({
                success: true,
                data: {
                  id: assignedVarId,
                  name: varName,
                  message: `Created variable "${varName}" id="${assignedVarId}". ` +
                    `Use variables['${assignedVarId}'] in all tools (set_text, conditions, formulas). ` +
                    `variableName:"${assignedVarId}" in changeVariableValue steps.`,
                },
              });
            } else if (isPageCreateTool) {
              // Check if a page with this route already exists before generating a fake success.
              // If the client's addPage silently no-ops (duplicate route), the AI would receive
              // "success" with a ghost pageId and switch_page would navigate nowhere.
              const existingPage = pages.find((p: { id: string; route?: string; name?: string }) =>
                p.route === (rawInput.route as string)
              );
              if (existingPage) {
                clientInput = rawInput; // nothing to execute on the client
                toolResult = JSON.stringify({
                  success: false,
                  error: `A page with route "${rawInput.route}" already exists (pageId: "${existingPage.id}", name: "${existingPage.name}"). Use switch_page with pageId="${existingPage.id}" to navigate to it instead of creating a duplicate.`,
                });
              } else {
              // Pre-assign page ID so Claude can reference it in switch_page immediately
                const assignedPageId = `page-${crypto.randomUUID().slice(0, 8)}`;
                clientInput = { ...rawInput, pageId: assignedPageId, _assignedPageId: assignedPageId };
              toolResult = JSON.stringify({
                success: true,
                data: {
                  pageId: assignedPageId,
                  route: rawInput.route,
                  name: rawInput.name,
                  message: `Created page "${rawInput.name}" at route "${rawInput.route}". pageId="${assignedPageId}". Use this exact pageId in switch_page to navigate to this page.`,
                },
              });
              }
            } else if (tool.name === 'generate_structure') {
              // Server assigns UUIDs to every node in the tree, returns name→id map to Claude.
              // Client receives the resolved tree (with real UUIDs) via tool_executed and
              // materializes each node through getTemplate(label) + AI prop merge.
              const treeInput = rawInput.tree as Record<string, unknown> | undefined | null;
              const parentId = rawInput.parentId as string | undefined;
              const atIndex = rawInput.atIndex as number | undefined;
              if (!treeInput || typeof treeInput !== 'object') {
                toolResult = JSON.stringify({ success: false, error: 'generate_structure requires a "tree" object. Provide the full nested UI tree under the "tree" key.' });
              } else {
                const resolvedTree = assignTreeIds(treeInput);
                clientInput = { tree: resolvedTree, parentId, atIndex };
                toolResult = JSON.stringify({
                  success: true,
                  data: {
                    tree: resolvedTree,
                    message: 'Structure created. Read the id field from each node in the returned tree to get its server-assigned UUID.',
                  },
                });
              }
            } else if (isReadTool) {
              // Serve real data from the request context
              if (tool.name === 'get_page_tree') {
                const depth = Math.min(Number(rawInput.depth ?? 2), 4);
                const summarize = (n: Record<string, unknown>, d: number): unknown => {
                  const base: Record<string, unknown> = {
                    id: n.id, type: n.type, name: n.name,
                    text: typeof n.text === 'string' ? (n.text as string).slice(0, 60) : undefined,
                    className: (n.props as { className?: string })?.className?.slice(0, 80),
                  };
                  const children = n.children as Record<string, unknown>[] | undefined;
                  if (d > 0 && children?.length) base.children = children.map(c => summarize(c, d - 1));
                  else if (children?.length) base.childCount = children.length;
                  return base;
                };
                const tree = pageTreeSnapshot.map(n => summarize(n as Record<string, unknown>, depth));
                toolResult = JSON.stringify({ pageName: currentPage.name, sections: tree });
              } else if (tool.name === 'get_node_details') {
                const ids = (rawInput.nodeIds as string[]) || [];
                // Search selected nodes first, then fall back to full page tree snapshot
                const findInTree = (nodes: unknown[], targetId: string): unknown | null => {
                  for (const n of nodes) {
                    const node = n as Record<string, unknown>;
                    if (node.id === targetId) return node;
                    const children = node.children as unknown[] | undefined;
                    if (Array.isArray(children)) {
                      const hit = findInTree(children, targetId);
                      if (hit) return hit;
                    }
                  }
                  return null;
                };
                const found = ids.map(id => {
                  // Try selectedNodesDetails first (has full detail), then fall back to page tree
                  const fromSelected = (selectedNodesDetails as Array<Record<string, unknown>>).find(n => n.id === id);
                  if (fromSelected) return fromSelected;
                  return findInTree(pageTreeSnapshot, id) ?? { id, note: 'Node not found in page tree' };
                });
                toolResult = JSON.stringify(found);
              } else if (tool.name === 'get_pages') {
                toolResult = JSON.stringify(pages);
              } else if (tool.name === 'get_theme') {
                toolResult = JSON.stringify(theme);
              } else if (tool.name === 'get_variables') {
                toolResult = JSON.stringify(variables);
              } else if (tool.name === 'get_formula_context') {
                // Variables and data sources are already in the system prompt contextNote.
                // This handler only computes the repeat context, which depends on which
                // specific node is selected and cannot be pre-injected into the system prompt.
                const targetNodeId = (rawInput as Record<string, unknown>).nodeId as string | undefined;

                function findAncestors(nodes: unknown[], id: string, path: unknown[] = []): unknown[] | null {
                  for (const n of nodes as Record<string, unknown>[]) {
                    if (n.id === id) return path;
                    const kids = n.children as unknown[] | undefined;
                    if (Array.isArray(kids)) {
                      const hit = findAncestors(kids, id, [...path, n]);
                      if (hit !== null) return hit;
                    }
                  }
                  return null;
                }

                let repeatContext = null;
                if (targetNodeId) {
                  const ancestors = findAncestors(pageTreeSnapshot, targetNodeId) ?? [];
                  const mapAncestors = (ancestors as Record<string, unknown>[])
                    .filter(a => a.map)
                    .reverse(); // innermost first
                  if (mapAncestors.length > 0) {
                    repeatContext = mapAncestors.map((a, i) => ({
                      level: i === 0 ? 'current' : 'parent',
                      mapPath: a.map,
                      accessPath: i === 0 ? 'context.item.data.*' : 'context.item.parent.data.*',
                    }));
                  }
                }

                toolResult = JSON.stringify({
                  note: 'Variables and data sources are already in your context. Only repeat context is returned here.',
                  repeatContext,
                });
              } else if (tool.name === 'get_workflows') {
                toolResult = JSON.stringify(workflows);
              } else if (tool.name === 'get_data_sources') {
                toolResult = JSON.stringify(dataSources);
              } else if (tool.name === 'search_nodes') {
                // Search the current page's node tree by substring match on name/type/text/id.
                // Returns all matches with breadcrumb paths so the AI can reference node IDs.
                const query = String(rawInput.query ?? '').toLowerCase();
                const filterType = rawInput.nodeType ? String(rawInput.nodeType).toLowerCase() : undefined;

                type SearchNode = { id?: string; type?: string; name?: string; text?: string; children?: unknown[] };
                const results: Array<{ id: string | undefined; name: string | undefined; type: string | undefined; text: string | undefined; breadcrumb: string; parentId: string | undefined }> = [];

                const walk = (nodes: SearchNode[], breadcrumb: string[], parentId: string | undefined) => {
                  for (const n of nodes) {
                    const crumb = [...breadcrumb, n.name ?? n.type ?? 'Node'];
                    const matchesType = !filterType || (n.type ?? '').toLowerCase() === filterType;
                    const matchesQuery =
                      (n.name ?? '').toLowerCase().includes(query) ||
                      (n.type ?? '').toLowerCase().includes(query) ||
                      (typeof n.text === 'string' ? n.text : '').toLowerCase().includes(query) ||
                      (n.id ?? '').toLowerCase().includes(query);
                    if (matchesQuery && matchesType) {
                      results.push({
                        id: n.id,
                        name: n.name ?? n.type,
                        type: n.type,
                        text: typeof n.text === 'string' ? n.text.slice(0, 80) : undefined,
                        breadcrumb: crumb.join(' > '),
                        parentId,
                      });
                    }
                    if (Array.isArray(n.children) && n.children.length > 0) {
                      walk(n.children as SearchNode[], crumb, n.id);
                    }
                  }
                };

                walk(pageTreeSnapshot as SearchNode[], [], undefined);
                toolResult = JSON.stringify(
                  results.length > 0
                    ? results
                    : { note: `No nodes found matching "${rawInput.query}"${filterType ? ` with type "${rawInput.nodeType}"` : ''}. Try a broader query or call get_page_tree() to see all nodes.` }
                );
              } else {
                toolResult = JSON.stringify({ note: 'Data from client context' });
              }
            } else if (isSearchTool && tool.name === 'search_images') {
              // Execute server-side image search
              try {
                const q = encodeURIComponent(String(rawInput.query ?? ''));
                const count = Number(rawInput.count ?? 5);
                const apiKey = process.env.UNSPLASH_ACCESS_KEY;
                if (apiKey) {
                  const r = await fetch(`https://api.unsplash.com/search/photos?query=${q}&per_page=${count}&client_id=${apiKey}`);
                  if (r.ok) {
                    const d = await r.json() as { results?: Array<{ id: string; urls: { regular: string; small: string }; alt_description: string; user: { name: string } }> };
                    const photos = (d.results ?? []).map(p => ({
                      url: p.urls.regular, thumb: p.urls.small, alt: p.alt_description, credit: p.user.name,
                    }));
                    toolResult = JSON.stringify(photos);
                    // Send results to client so it can display image options
                    send({ type: 'image_results', images: photos });
                  } else {
                    toolResult = JSON.stringify({ error: `Unsplash API error ${r.status}` });
                  }
                } else {
                  toolResult = JSON.stringify({ error: 'UNSPLASH_ACCESS_KEY not configured' });
                }
              } catch (e) {
                toolResult = JSON.stringify({ error: String(e) });
              }
            } else if (isSearchTool && tool.name === 'search_videos') {
              // Execute server-side video search via Pexels
              try {
                const q = encodeURIComponent(String(rawInput.query ?? ''));
                const count = Number(rawInput.count ?? 4);
                const apiKey = process.env.PEXELS_API_KEY;
                if (apiKey) {
                  const url = q
                    ? `https://api.pexels.com/videos/search?query=${q}&page=1&per_page=${count}`
                    : `https://api.pexels.com/videos/popular?page=1&per_page=${count}`;
                  const r = await fetch(url, { headers: { Authorization: apiKey }, next: { revalidate: 300 } });
                  if (r.ok) {
                    const d = await r.json() as { videos?: Array<{ id: number; image: string; video_files: Array<{ quality: string; link: string }> }> };
                    const videos = (d.videos ?? []).map(v => {
                      const sd = v.video_files.find(f => f.quality === 'sd') ?? v.video_files[0];
                      return { src: sd?.link ?? '', poster: v.image };
                    }).filter(v => v.src);
                    toolResult = JSON.stringify(videos);
                  } else {
                    toolResult = JSON.stringify({ error: `Pexels API error ${r.status}` });
                  }
                } else {
                  toolResult = JSON.stringify({ error: 'PEXELS_API_KEY not configured' });
                }
              } catch (e) {
                toolResult = JSON.stringify({ error: String(e) });
              }
            } else if (isSearchTool && tool.name === 'search_icons') {
              // Execute server-side icon search via Iconify
              try {
                const q = encodeURIComponent(String(rawInput.query ?? ''));
                const count = Number(rawInput.count ?? 10);
                const prefix = rawInput.prefix ? `&prefix=${rawInput.prefix}` : '';
                const r = await fetch(`https://api.iconify.design/search?query=${q}&limit=${count}${prefix}`);
                if (r.ok) {
                  const d = await r.json() as { icons?: string[] };
                  toolResult = JSON.stringify(d.icons ?? []);
                  send({ type: 'icon_results', icons: d.icons ?? [] });
                } else {
                  toolResult = JSON.stringify({ error: `Iconify API error ${r.status}` });
                }
              } catch (e) {
                toolResult = JSON.stringify({ error: String(e) });
              }
            } else {
              // Mutation tool — the client will execute it
              toolResult = JSON.stringify({ ok: true, pending: 'client_execution' });
            }

            // Send tool execution event to client — skipped when validation failed so the
            // client never creates a phantom node that the AI will then duplicate on retry.
            if (!skipClientExecution) {
            send({
              type: 'tool_executed',
              id: tool.id,
              name: tool.name,
              input: clientInput,
            });

            allExecutedTools.push({
              name: tool.name,
              input: clientInput,
              result: toolResult,
            });
            }

            toolResultsForNextRound.push({
              type: 'tool_result',
              tool_use_id: tool.id,
              content: toolResult,
            });
          }

          // Add tool results to messages for next round
          currentMessages.push({
            role: 'user',
            content: toolResultsForNextRound,
          });

          // Continue conversation if AI has more to say
          if (stopReason === 'tool_use' || stopReason === 'max_tokens') {
            continue; // next round
          }
        }

        break;
      }

      // Send final done event
      send({ type: 'done', tools: allExecutedTools });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: 'error', message: msg });
    } finally {
      try { controller.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
