# Visual Builder Architecture

The visual builder lives at `app/dev/builder/`. It renders SDUI components directly in the same React tree (no iframe). This document describes every file, the split strategy, and guidelines for working with the large files.

---

## File Map

| File | Lines | Purpose |
|---|---|---|
| `page.tsx` | ~120 | Top-level layout: mounts left panel + canvas + right panel + workflow canvas overlay |
| `_store.ts` | ~1,770 | Zustand store implementation: all state mutations, history, datasource loading |
| `_store-types.ts` | ~290 | **Pure types extracted from `_store.ts`**: `GridOverlayConfig`, `ViewportSize`, `DataSourceConfig`, `CustomVar`, `Folder`, `BuilderPage`, `WorkflowMeta`, `WorkflowCanvasTarget`, `BuilderStore` |
| `_store-helpers.ts` | _future_ | Tree utilities: `REQUIRED_PARENT`, `ALLOWED_CHILDREN`, `findNode`, `findParentNode`, `hasFormContainerAncestor` (currently still in `_store.ts` ~lines 25–375) |
| `_canvas.tsx` | ~2,433 | Live SDUI render in builder mode: DnD, selection, zoom/pan, drop targets |
| `_overlay.tsx` | ~1,115 | Visual overlays: selection rings, hover outline, gap fills, distance lines |
| `_panel-left.tsx` | ~2,260 | Left panel: **7 tabs** — Layers, Components, Data, Logic, **App Triggers** (filters `isAppTrigger === true`), Assets, **Theme** (moved from right panel) |
| `_panel-right.tsx` | ~3,400 | Right panel: **Design / Settings / Workflows / JSON** tabs. When no node is selected, renders `<PageTriggersInRightPanel />` auto-scoped to the focused page. |
| `_panel-right-page-triggers.tsx` | ~100 | `PageTriggersInRightPanel` — page-scoped triggers shown in the right panel's empty-selection state |
| `_panel-right-design.tsx` | _future_ | `DesignTab` (~1,696 lines, lines 279–1975): all 17 design-property sections |
| `_panel-right-settings.tsx` | ~2,300 | `SettingsTab` — form `_validation` rules editor; uses `useResponsivePropPatch` for all prop writes at non-desktop breakpoints |
| `_panel-right-workflows.tsx` | ~600 | `ElementWorkflowsTab`, `WorkflowRowMenu`, `PreviewDataEditor`; supports `responsive[bp].actions` override toggle + chip |
| `_workflow-canvas.tsx` | ~3,013 | Full-screen workflow editor overlay (imports types from `_workflow-types.tsx`) |
| `_workflow-types.tsx` | ~460 | **Pure types + constants extracted from `_workflow-canvas.tsx`**: `ActionStepType`, `ActionStep`, `BranchDef`, `ACTION_CATEGORIES`, `FORM_ACTION_CATEGORY`, trigger definitions, serialization helpers |
| `_formula-editor.tsx` | ~3,639 | Formula editor overlay: variable tree, collections tree, function library, formula input |
| `_formula-panel.tsx` | ~500 | Compact formula pill + binding icon used inline in design panel rows |
| `_data-tab.tsx` | ~2,309 | Data tab: REST/GraphQL datasource config forms, variable editor |
| `_logic-tab.tsx` | ~1,007 | Logic tab: conditions, actions, repeat, visibility settings |
| `_panel-logic.tsx` | ~1,007 | Logic panel slide-out for per-node logic editing |
| `_overlay.tsx` | ~1,115 | Canvas overlays |
| `_theme-panel.tsx` | ~500 | Theme color overrides panel |
| `_tw-utils.ts` | ~600 | Tailwind class utilities (token tables, parse/replace helpers) |
| `_showcase.ts` | ~200 | Pre-built component showcase nodes |
| `_color-picker.tsx` | ~300 | Color picker widget |
| `_action-builder.tsx` | ~200 | Action builder slide-out panel |
| `_state-bar.tsx` | ~200 | StateBar — single-select state preview chips (Normal / Loading / Validation / Empty / Disabled / Custom). State changes wrapped in `startTransition` for performance. |
| `_canvas-helpers.tsx` | ~280 | `PageEngine` (memoized active-page SDUI wrapper), `InactivePageEngine` (memoized background-page SDUI wrapper, applies `applyStateTagOverrides` inside its own `useMemo`), `InactivePagesGrid` (isolated component with targeted store subscription — renders all inactive pages without re-rendering on hover/select). |
| `_floating-toolbar.tsx` | ~250 | Floating mini-toolbar for selected nodes |
| `_theme-panel.tsx` | ~500 | Theme color overrides panel — **now in the left panel's Theme tab** (was right panel) |
| `_triggers-tab.tsx` | ~400 | **App Triggers** tab — shows page-lifecycle triggers with `isAppTrigger === true` only; `PageScopeDropdown` deleted |
| `_panel-right-design-sections.tsx` | ~750 | `VisibilityInDesign`, `DisableInDesign`, `RepeatInDesign` — all route writes to `responsive[bp]` at non-desktop |
| `_animation-panel.tsx` | ~1,800 | `AnimationInDesign` — derives `effectiveCfg` from `getCascadedAnimation` at non-desktop; uses `writeAnim` to write per-key into `responsive[bp].animation.<key>` |

---

## Responsive Channels (`ResponsiveOverride` in `lib/sdui/types/node.ts`)

Every write in the right panel at a non-desktop breakpoint goes to `node.responsive[bp].<channel>`:

| Channel | Type | UI Component |
|---|---|---|
| `styles` | `Record<string, string>` | CSS properties (position, size, typography, gap, etc.) |
| `style` | `Record<string, string>` | `props.style` inline styles (transform, translateX, etc.) |
| `props` | `Record<string, unknown>` | Component props (disabled, objectFit, icon size, etc.) |
| `text` | `string \| object` | Text node content / formula |
| `condition` | `unknown` | Visibility toggle / formula |
| `map` | `string \| null` | Repeat/list data binding; `null` = disable repeat |
| `animation` | `DeepPartial<AnimationConfig>` | Animation config — deep-merged over base by `getCascadedAnimation` |
| `actions` | `SDUIAction[]` | Workflow bindings — whole-array override; toggle materialises current effective actions |
| `_disabledOverlay` | `{color?, opacity?, blur?}` | Disabled overlay fields per-breakpoint |

**Resolver:** `lib/sdui/responsive-resolver.ts` — `resolveResponsiveNode` cascades all channels from laptop → tablet → mobile for the active breakpoint.

---

## Split Strategy

### Done

| Split | Before | After | New File |
|---|---|---|---|
| `_workflow-canvas.tsx` types | 3,448 lines | 3,013 lines | `_workflow-types.tsx` (460 lines) |
| `_store.ts` types | 2,130 lines | 1,771 lines | `_store-types.ts` (290 lines) |

**Rule:** When adding new types or constants, put them in the types file, not the implementation file.

### Planned (not yet done)

These splits are documented here for the next refactor. Do NOT attempt without running E2E tests to verify after each extraction.

#### `_store-helpers.ts` (safe to extract)
Extract from `_store.ts` lines 25–375:
- `REQUIRED_PARENT` (lines 25–80)
- `ALLOWED_CHILDREN` (lines 86–110)
- `findNode`, `findParentNode`, `hasFormContainerAncestor` (lines 220–308)

These are exported pure functions/constants with no Zustand dependency. Keep `patchNodeById`, `removeNodesByIds`, and `insertNode` in `_store.ts` (they're private helpers).

#### `_panel-right-design.tsx` (~1,700 lines)
The entire `DesignTab` component (lines 279–1975). Depends on shared primitive inputs (`NumberInput`, `SelectInput`, etc.) defined at lines 104–278 — those primitives must be extracted to a shared file first or duplicated.

**Risk:** High. The primitives are used by multiple tabs; wrong extraction breaks the Settings and Workflows tabs too.

#### `_panel-right-settings.tsx` (~710 lines)
The `SettingsTab` component (lines 2538–3248). Self-contained; uses only the shared primitive inputs.

#### `_panel-right-workflows.tsx` (~450 lines)
`ElementWorkflowsTab`, `WorkflowRowMenu`, `PreviewDataEditor` (lines 2086–2537).

#### `_formula-editor.tsx` splits (safe, high value)
1. `_formula-editor-helpers.ts` — lines 58–603: pure DOM/chip parsing utilities, no React
2. `_formula-editor-variable-tree.tsx` — lines 1052–1612: `VariableEntry`, `PageComponentsSection`, `VariableTree`
3. `_formula-editor-collections.tsx` — lines 1613–2701: collection/data sections
4. `_formula-editor-fn-library.tsx` — lines 2702–2793: `FunctionLibrary`, `FnRow`
5. Keep main `_formula-editor.tsx` at ~1,100 lines

---

## Import Rules

### Types vs Implementation
```ts
// Prefer type-only import from _store-types.ts (no store code loaded)
import type { DataSourceConfig, WorkflowMeta } from './_store-types';

// Only import from _store.ts when you need the hook or functions
import { useBuilderStore, findNode } from './_store';
```

### Workflow canvas types
```ts
// Types only — import from _workflow-types.tsx
import type { ActionStep, ActionStepType } from './_workflow-types';

// Functions from types file
import { deserializeStep, serializeStep, getActionLabel } from './_workflow-types';

// For WorkflowCanvas component or WorkflowBindButton:
import { WorkflowCanvas, WorkflowBindButton, toHumanName } from './_workflow-canvas';
```

---

## Routing & URL Structure

| URL | Who can access | What happens |
|---|---|---|
| `builder-dev.localhost:3001/` | Dev only (`NODE_ENV=development`) | Rewrites to `/dev/builder` — admin mode, static config, no auth |
| `builder-dev.localhost:3001/<anything>` | Dev only | Redirects to `/` on the same subdomain |
| `preview-dev.localhost:3001/<route>` | Dev only | Passes through to `app/[[...slug]]/page.tsx` — static SDUI app, no auth |
| `preview.localhost:3001/<route>` | All environments | Rewrites to `/app-preview/<route>` — needs `projectId` cookie + preview JWT |
| `localhost:3001/builder/<projectId>` | Authenticated users only | Rewrites to `/dev/builder?projectId=<id>` after auth check |
| `localhost:3001/builder` | — | Redirects to `/login` (no auth) or `/workspaces` (auth) |
| `localhost:3001/workspaces/**` | Authenticated users only | Protected — redirects to `/login` if no `auth_token` cookie |
| `localhost:3001/` | — | Redirects to `/login` (no auth) or `/workspaces` (auth) |

**Dev-only subdomains** (`builder-dev`, `preview-dev`) are blocked in production — any request to them is redirected to the main domain's root. The guard is `process.env.NODE_ENV === 'development'` in `middleware.ts`.

**Platform links:** Workspace project cards open `/builder/<projectId>` (protected). The middleware handles auth and internally rewrites to `/dev/builder`.

---

## Preview System

### `↗ Preview` button / `⌘P`

**Disabled** when the current page has no app route (e.g. the `✦ Component Showcase` page). Button is grayed out; tooltip explains why.

Always writes a snapshot to `localStorage` under `BUILDER_PREVIEW_KEY` (`'builder_preview'`).

#### builder-dev mode (no `projectId`)
1. Opens `preview-dev.localhost:3001/<pageRoute>` in a named tab (`sdui-dev-preview`).
2. Stores a `previewWinRef` — subsequent preview clicks reuse the same tab.
3. Sends the current config to the preview tab via **`postMessage`** (`{ type: 'BUILDER_LIVE_CONFIG', config: {...} }`). localStorage is **not** shared between subdomains.
4. `app/[[...slug]]/page.tsx` detects `preview-dev.*` hostname on mount, signals `{ type: 'PREVIEW_READY' }` to the opener, and listens for `BUILDER_LIVE_CONFIG`. On receipt it overrides the static `SDUIEngine` config with the builder's current nodes + workflows + theme — **no page reload needed**.

#### project mode (has `projectId`)
1. Opens `about:blank` **immediately** (while user-gesture token is active — see pitfall below).
2. Saves current config to the backend (`PATCH /api/projects/:id/config`).
3. Fetches a short-lived JWT (`POST /api/projects/:id/preview-token`).
4. Navigates the already-open window to `preview.localhost:3001/<pageRoute>?projectId=...&token=...`.
5. Middleware strips params, sets `preview_project_id` + `preview_token` cookies, redirects to the clean URL.

### `window.open` — User-Gesture Pitfall

> **Bug pattern:** Browsers expire popup permission after the first `await`. A `window.open()` call that comes after any `await` silently **navigates the current tab** instead of opening a new one, destroying the builder's browser history.

**Fix:** Call `window.open('about:blank', name)` **before the first `await`**, then after all async work is done set `.location.href` on the returned reference:

```ts
// ✅ CORRECT — open before any await
const previewWin = window.open('about:blank', 'sdui-preview');  // ← user gesture valid
const { serializeBuilderState } = await import('...');          // ← gesture expired here
const res = await fetch('/api/...');
// Safe — we already have the window reference
if (previewWin) previewWin.location.href = finalUrl;

// ❌ WRONG — window.open after await navigates the current tab
await fetch('/api/...');
window.open(finalUrl, '_blank');  // ← gesture expired → current tab navigates
```

---

## Key Patterns

### Builder Store Access
```tsx
// In React components — use the hook
const { pageNodes, selectedIds, select } = useBuilderStore();

// In non-React code (Playwright, effects) — window.__builderStore
window.__builderStore.getState().patchNodeField(id, 'props.className', newClass);
```

### Workflow Deserialization
When a workflow step is stored as `{ "action": "uuid" }` (ActionRef), `deserializeStep` looks up the UUID in `store.directActionsMap`. If found and it's a direct action (graphql/fetch/etc.), it's inlined as a typed step. On save, `serializeStep` writes it back as an ActionRef. This keeps JSON compact while showing the real type in the canvas.

### directActionsMap
`store.directActionsMap` is populated from `GET /api/builder/config` → `directActions`. It contains all direct actions from `config/actions/*.json` keyed by UUID (graphql, fetch, navigateTo, etc.). Used exclusively by the workflow canvas for ActionRef resolution.

### FormContainer Submit Pattern
Gluestack `Button` renders as `<div role="button">` — clicking it does NOT fire the HTML form's `onSubmit`. The renderer (`lib/sdui/renderer.tsx`) auto-wires `onPress`/`onClick` to `formCtx.submit()` when a Button has `type="submit"` props and is inside a `FormContainer`. `formCtx.submit()` reads from the global variable store, validates `_validation` rules, writes errors, and calls `onSubmitAction` (the bound workflow).

### State Preview System

`lib/sdui/builder-preview.ts` contains all builder-only state simulation logic:

| Export | Purpose |
|---|---|
| `applyPreviewStatePatch` | Modifies merged state for `loading` / `validation` / `empty` preview. **Validation** scans `merged.variables` for keys ending in `-form` (FormContainer store keys) and injects `isValid: 'This field is required'` into all registered fields. |
| `applyStateTagOverrides` | Deep-walks node trees and applies `_forceShowInEditor: true` or `condition: false` overrides based on `_stateTag` and active preview states. Fast-paths (no clone) when no relevant state is active. |
| `applyPreviewDataPatch` | Overlays preview data on top of merged state. |

**`_stateTag` values:** `"loading"` / `"empty"` / `"default"` / `"custom-*"` — set via the Design panel's Visibility section when a node has a `condition`. Never rendered at runtime.

**FormContainer stable `id` rule:** FormContainers MUST have a stable `id` field in JSON config so the validation preview can find `variables['${id}-form']`. Without it, the component falls back to `crypto.randomUUID()` on every mount and the form state key is unpredictable.

**StateBar single-select + `startTransition`:** Clicking a chip calls `setPreviewState` (replacing the active state). Re-clicking the active chip reverts to `'normal'`. All calls are wrapped in `React.startTransition` to prevent blocking pan/mouse interactions during the heavy re-render.

**`InactivePagesGrid`:** Inactive pages are rendered in a dedicated `memo`-wrapped component (`_canvas-helpers.tsx`) that subscribes only to `pages`, `currentPageId`, `activePreviewStates`, and `switchPage` from the store. This prevents hover/select events from triggering inactive page re-renders. `applyStateTagOverrides` runs inside each `InactivePageEngine`'s `useMemo` — not inline in JSX.

---

## System Components

Built-in editable component templates that ship with the builder. Parallel architecture to Shared Components — the same sync engine, override model, and linked-instance metadata cover both kinds.

### File Map

| File | Purpose |
|---|---|
| `lib/builder/system-components/` | Per-component definitions. Static SCs use `makeSystemComponent()` (e.g. `accordion.ts`); complex ones pair a thin `.ts` with a sibling `.data.json` (e.g. `datepicker.ts` + `datepicker.data.json`) |
| `lib/builder/system-components/index.ts` | Aggregates all entries into `SYSTEM_COMPONENT_DEFAULTS` |
| `lib/builder/system-component-data.ts` | Runtime registry — merges defaults with per-project overrides; stamps `_sharedKey` on every model node at module init |
| `lib/builder/system-component-types.ts` | `SystemComponentModel` (mirrors `SharedComponentModel` with `isBuiltIn: true`) |

### Data flow

```
SYSTEM_COMPONENT_DEFAULTS          <─ code-defined defaults (stamped with _sharedKey)
        │
        ▼
getSystemComponents()              <─ merges defaults with user overrides
        │
        ▼
systemComponentOverrides in        <─ persisted by autosave (lib/builder/autosave.ts)
autosave snapshot
```

Dropped instances carry `_system: { modelId, sharedKey }` plus `_overrides`, analogous to `_shared`. The sync engine `_syncSharedInstances` in `app/dev/builder/_store.ts` is kind-agnostic and walks both `_shared` and `_system` roots; `findLinkedRoot(node, 'any')` in `app/dev/builder/_store-node-helpers.ts` resolves either. Per-instance overrides are preserved when the model is edited.

### Instance operations

- **Edit System Component** — sets `editingSharedComponentIds` for that `modelId`, opens Component Editor; edits flow to every instance live.
- **Detach from System** — strips `_system` + `_overrides`, instance becomes a plain node tree.
- **Reset to System** — clears local overrides, snaps back to the model's current content.

### Trigger model

`ScopedWorkflow.trigger` accepts both component lifecycle triggers (`created`, `mounted`, `propertyChange`, …) and DOM-event literals (`click`, `doubleClick`, `keydown`, …). Lifecycle workflows are managed in the Component Editor's Actions tab; DOM-event workflows appear in the right-panel Workflow tab only while the SC is being edited.

For JSON conventions — the canonical bare-ref shape for SC inner-element bindings (`{ action: "<wfId>", args: {...} }`), which the engine auto-routes to `executeComponentAction` under the ambient `compInfo` — see the `## System Components` section in `.cursor/rules/visual-builder.mdc`. The legacy inline-workflow wrapper still resolves but should not be used for new bindings.

### Custom triggers (component events)

Components can declare named events (WeWeb-parity) so parent pages bind listener workflows on specific instances. The model carries `triggers: ComponentTrigger[]`; internal workflows fire via an `emitComponentTrigger` step; `lib/sdui/component-trigger-registry.ts` routes emissions to instance-scoped dispatchers registered by `renderer.tsx` on mount, ensuring multi-instance isolation. The listener runs with `context.event = payload` in scope. See the `### Custom triggers (component events)` subsection in `.cursor/rules/visual-builder.mdc` for the full contract and visibility rules.

---

## AI Chat System

The builder has an AI assistant that calls semantic builder actions via Anthropic's `tool_use` API. It operates client-side — the server streams tool calls, the browser executes them against the Zustand store.

### File Map

| File | Purpose |
|---|---|
| `app/api/ai/builder-chat/route.ts` | POST endpoint — builds system prompt with live theme palette + project context, runs the Anthropic multi-round tool loop, streams SSE events |
| `lib/ai/builder-knowledge.ts` | `buildChatSystemPrompt()` — the edit-mode system prompt. Accepts `paletteSnapshot`, `mood`, `appName`, `description`. Auto-generates formula function reference from `FUNCTION_LIBRARY`. |
| `lib/ai/builder-knowledge-v2.ts` | Phase-specific system prompts for parallel build: `buildPhase2SysPrompt` (structure), `buildPhase3SystemPrompt` (styling), `buildPhaseWSysPrompt` (workflows). Contains anti-hallucination rules and concept blocks (`CONCEPT_REPEAT`, `CONCEPT_COLORS`, `CONCEPT_FORMULA`). |
| `lib/ai/agents/` | Parallel agent prompts — one subfolder per agent (`structure`, `binding`, `layout`, `colors`, `typo-anim`, `workflows`) and `shared/` (formula/scope + styling context). `registry.ts` documents agent IDs aligned with SSE `agent` / `phase` strings. Barrel: `lib/ai/agents/index.ts`; also re-exported from `lib/ai/agent-prompts.ts` for stable imports. |
| `lib/ai/builder-tools.ts` | `ALL_BUILDER_TOOLS` — all Anthropic `tool_use` tool definitions (add_component, create_workflow, set_text, etc.) |
| `lib/ai/tool-executor.ts` | `executeTool()` — maps AI tool calls to Zustand store mutations client-side. Contains `validateFormula()` for formula linting. |
| `lib/ai/sdui-component-schema.ts` | Maps component labels to default JSON node templates |
| `app/dev/builder/_use-ai-chat.ts` | React hook — sends messages to `/api/ai/builder-chat`, streams SSE, executes client-side tools |

### Design Principles

**Semantic actions, never raw JSON.** The AI calls `add_component("Card")`, `set_text(id, "Hello")`, `create_workflow(...)` — tools map these to Zustand mutations. The AI never writes node JSON directly, and never manipulates raw Tailwind class strings.

**Semantic design tools, not free-form class manipulation.** There are no `set_class`, `add_class`, `remove_class`, `swap_class`, or `set_prop` tools. Every design property is controlled via a dedicated semantic tool that mirrors the builder's right-panel UI controls:
- `set_background(nodeId, {bg})` — background color or image
- `set_text_color(nodeId, {color})` — text/foreground color
- `set_typography(nodeId, {size, weight, align, …})` — font styling
- `set_border(nodeId, {width, radius, color, …})` — border properties
- `set_shadow / set_opacity / set_spacing / set_size / set_position / set_transform / set_layout` — mirror each design panel section
- `set_submit / set_input_props` — component-specific controls

**Tool validation, not prompt rules.** Constraints are enforced by tools returning errors, not by "NEVER do X" instructions in the prompt. Example: `create_workflow` calls `validateFormula()` before storing; if a formula uses `Math.max`, the tool returns `{ success: false, error: "..." }` and the AI self-corrects on the next attempt.

**Live context, not static examples.** The system prompt includes:
- The actual theme palette with hex values (built from `themeOverrides` sent by the client in `buildPaletteSnapshot()` — no static fallback to `config/theme.json`)
- Project mood, app name, description (sent from `store.projectMood` etc. in `_use-ai-chat.ts`)
- Full formula function signatures (auto-generated from `FUNCTION_LIBRARY` in `_formula-editor-dom.ts`)
- Component structure reference (from `aiRef` on each `PrimitiveComponent` in `primitive-components.ts`)

**Full CRUD for variables, workflows, and data sources.**
- Variables: `add_variable`, `update_variable`, `delete_variable`
- Workflows: `create_workflow`, `delete_workflow`, plus `bind_action` (append-only) and `unbind_action`
- Data sources: `add_data_source`, `delete_data_source`
- Pages: `add_page`, `rename_page`, `remove_page`, `set_page_config` (SEO + on-mount workflow)
- Structure: `move_node` (cross-container reparenting)

### Formula Validator

`validateFormula(expr: string): string | null` in `tool-executor.ts`:
- Detects `Math.*` usage → returns an error describing the correct SDUI formula function to use
- Returns `null` when valid

`validateWorkflowFormulas(steps)` iterates all `changeVariableValue` steps and runs the validator. Called in `create_workflow` before storing — failure returns `{ success: false, error: "Step X: ..." }`.

### Theme Palette Injection

`buildPaletteSnapshot(themeOverrides)` in `route.ts`:
- Reads **only** from the `themeOverrides` object sent by the client — **no static fallback** to `config/theme.json`
- Maps CSS variable names (e.g. `--primary`) to the `--theme-*` format the AI uses in `className` values
- Produces a formatted string: `var(--theme-primary) = #00b4d8  (brand accent)`
- Passed to `buildChatSystemPrompt` as `paletteSnapshot`
- The prompt renders this as the live "Current Theme Palette" section so the AI makes informed color choices using actual project values

### `generate_structure` — Full Tree in One Call

`generate_structure` is the primary tool for creating new multi-component sections. Instead of N sequential `add_component` calls, the AI describes the full nested tree in a single call.

**Server side (`route.ts`):**
- `assignTreeIds` recursively walks the input tree and calls `crypto.randomUUID()` on every node that lacks an `id`.
- The server sends the resolved tree (with all UUIDs pre-assigned), `parentId`, and `atIndex` back to the client via a `tool_executed` SSE event.
- The server also returns a `name→nodeId` map to Claude so subsequent tool calls (set_repeat, create_workflow, set_text) can reference the inserted nodes by name.

**Client side (`tool-executor.ts`):**
- `materialize(node)` walks the server-resolved tree. For each node, `getTemplate(node.label)` loads the component's default template from `COMPONENT_SCHEMA`.
- Components are inserted with their **default styles only** — no custom styles are applied during materialization.
- The materialized tree is inserted via `store.addNode(tree, parentId, atIndex)` (current page) or `store.insertNodeIntoPage(targetPageId, tree)` (parallel build targeting another page).

**Tree node shape — structure only:**
```
{ label, name?, text?, src?, children?: [...] }
  label = palette component name ("Box", "Heading", "Text", "Button", "Image", etc.)
  name  = layers panel label + key in the returned "nodes" map
  text  = text content shortcut
  src   = image or video URL
```

`generate_structure` is intentionally **structure-only**. It never carries styling parameters. All custom styling is applied in Phase 3 using the returned node IDs with `set_spacing`, `set_layout`, `set_background`, `set_border`, `set_typography`, `bulk_apply`, etc. — the AI never writes raw Tailwind anywhere.

---

### `bulk_apply` — Batch Style Operations

`bulk_apply` applies the same style tool to multiple nodes in a single call. Pattern: `search_nodes` → collect IDs → `bulk_apply(nodeIds, tool, params)`.

```ts
bulk_apply({ nodeIds: ["uuid-1", "uuid-2", "uuid-3"], tool: "set_spacing", params: { py: 96 } })
```

Supported tools: `set_spacing`, `set_border`, `set_background`, `set_typography`, `set_opacity`, `set_size`, `set_position`.

The executor iterates `nodeIds` and delegates to the named handler for each, returning a combined error if any node fails.

---

### Build Mode & Parallel Orchestration

For requests involving multiple pages or sections, the AI system runs in one of three modes determined by a lightweight planning phase.

**Phase 0 — Classification (`classifyRequest`)**
A fast haiku call analyzes the user's message and returns a `BuildPlan`:
```ts
{ mode: 'build' | 'edit' | 'mixed', buildUnits: [...], relations: [...], editOps: [...] }
```

**Mode: `edit`**
Standard sequential tool loop — no change from the baseline behavior.

**Mode: `build`** (new page(s)/section(s) only)

The build pipeline is a multi-tier parallel system. The agreed architecture and the implementation target is:

```
Phase 0 (~300ms)
  classifyRequest → BuildPlan { buildUnits, descriptions }

Tier 0 — Media Pre-fetch (starts immediately, runs in parallel with Phase 2)
  searchUnsplash(unit.description) + searchPexels(unit.description) per unit

Phase 2a — Structure (~2s, all units in parallel)
  runBuildUnit per unit (claude-haiku, tools: generate_structure / add_variable)
  → onStructureReady callback fires per unit when generate_structure returns
  → canvas renders skeleton IMMEDIATELY at ~2s
  → allStructuresReadyPromise resolves when last unit fires onStructureReady

After allStructuresReadyPromise resolves — three branches run in parallel:

  ┌─────────────────────┬──────────────────────┬──────────────────────┐
  │  Phase 2b           │  Phase 3 — Styling   │  Phase W — Workflows │
  │  (Binding)          │                      │                      │
  │  set_repeat         │  set_background      │  create_workflow     │
  │  set_text           │  set_spacing         │  bind_action         │
  │  +                  │  set_typography      │  switch_page         │
  │  Media Injection    │  set_animation       │                      │
  │  set_src (Tier 0    │  set_border          │  claude-haiku        │
  │  pre-fetched URLs)  │  set_size            │  PHASE_W_TOOLS only  │
  │                     │  set_layout          │                      │
  │  unitResultsPromise │  set_condition       │                      │
  │  .then(mediaInject) │  set_icon            │                      │
  │                     │                      │                      │
  │                     │  claude-haiku        │                      │
  │                     │  PHASE3_STYLING_TOOLS│                      │
  └─────────────────────┴──────────────────────┴──────────────────────┘

Promise.all([phase2bAndMedia, phase3, phaseW]) → done (~4-5s total)
```

**Key dependency rules (why three-way parallel is correct):**
- Phase 3 needs: node IDs (from `generate_structure`) + variable UUIDs (from `add_variable`) — both available when `allStructuresReadyPromise` resolves
- Phase 3 does NOT need: `set_repeat`, `set_text`, or media injection to complete first
- Phase W needs: same node IDs + variable UUIDs — also available immediately
- Phase 2b (`set_repeat`, `set_text`) and media injection have no downstream dependencies — they can run alongside Phase 3 + Phase W

**`runBuildUnit` internal flow:**
- `add_variable` → `generate_structure` → fires `onStructureReady(varEvents, tree)` immediately when structure resolves
- `set_repeat` / `set_text` continue running after `onStructureReady` fires and are returned when the unit promise resolves
- `onStructureReady` increments a counter; when all units have fired, `allStructuresReadyPromise` resolves

**`syntheticMessages` for Phase 3 + Phase W:**
Only `add_variable` and `generate_structure` results are included. Wiring events (`set_repeat`, `set_text`) are excluded — neither phase has those tools in their tool list, and the exclusion allows Phase 3 + Phase W to start without waiting for Phase 2b.

**Phase-tagged SSE events:**
Every `tool_executed` SSE event carries a `phase` field so the chat panel can render grouped sections:
- `'structure'` — `add_page`, `add_variable`, `generate_structure`, `set_repeat`, `set_text`
- `'media'` — `set_src` (injected from Tier 0 pre-fetched URLs)
- `'styling'` — all Phase 3 setter calls
- `'workflows'` — all Phase W calls

**Timeline comparison:**
```
BEFORE — fully sequential, ~14s total
  [classify][var+structure][set_repeat/text][img-search][styling+workflows]
  User sees NOTHING until ~12s

AFTER — parallel, ~4-5s total
  [classify ~300ms]
  [img pre-fetch ─────────────────────]
  [var + generate_structure] → canvas skeleton at ~2s ✓
  [set_repeat + set_text + set_src ───┐
  [Phase 3 styling ───────────────────┤ → all done at ~4-5s ✓
  [Phase W workflows ─────────────────┘
```

**Mode: `mixed`** (edits + new builds in one prompt)
1. **Phase 1** — A focused edit loop runs first (sequential) with a `build_phase: 'editing'` SSE event.
2. **Phase 2a** — Parallel structure builds execute for all new units.
3. **Phase 2b + Phase 3 + Phase W** — Three-way parallel after all structures are ready.

**SSE progress events streamed to client:**
```ts
{ type: 'build_phase', phase: 'planning' | 'editing' | 'building' | 'wiring' }
{ type: 'section_progress', done: number, total: number, name: string }
{ type: 'tool_executed', name: string, input: {...}, phase: 'structure' | 'media' | 'styling' | 'workflows' }
```

**`AiChatMessage` progress fields** (in `_store-types.ts`):
- `buildPhase` — current phase string
- `buildTotal` / `buildDone` — section count for progress bar
- `buildCurrentName` — name of section currently being inserted

**`AiToolCall.phase` field** (in `_store-types.ts`):
- `'structure'` | `'media'` | `'styling'` | `'workflows'` — populated from the SSE event
- Used by `ToolCallsGroup` in `_ai-chat-panel.tsx` to render phase-grouped collapsible sections instead of a flat list

The AI chat panel (`_ai-chat-panel.tsx`) displays a progress bar during `building` phase and groups completed tool calls into labelled phase sections (Structure / Media / Styling / Workflows) for clarity.

---

### Anti-Hallucination Architecture

The multi-phase AI build system is prone to specific hallucination patterns. This section documents the **proven approaches** for preventing them — every fix follows one of two principles.

#### Principle 1 — Server-Side Guards (Tool Errors > Prompt Rules)

Prompt-level "NEVER do X" instructions are unreliable. When the AI must not do something, **enforce it in `route.ts`** by intercepting the tool call and returning `{ success: false, error: "..." }`. The AI reads the error and self-corrects on the next round.

**Implemented guards:**

| Guard | Location | What it catches |
|---|---|---|
| `isCustomJsDomWorkflow` | `runHaikuAgentLoop` | Phase W creating `customJavaScript` workflows for visual effects (hover/press animations, DOM manipulation). Returns error directing AI to `set_animation`. |
| `requireNode` | `tool-executor.ts` | Any setter tool (`set_text`, `set_icon`, `set_background`, etc.) targeting a `nodeId` that doesn't exist on the page. Returns error telling AI to call `get_page_tree`. |
| `validateFormula` | `tool-executor.ts` | `create_workflow` steps using `Math.*` instead of SDUI formula functions. Returns error with correct function name. |
| `assignTreeIds` cleanup | `route.ts` | Strips `condition: "true"` (literal boolean true) from generated tree nodes — a common Phase 2 hallucination that adds no-op conditions. |

**Pattern for adding a new guard:**
1. Identify the hallucination from build debug output
2. Add a detection function (regex, tree scan, etc.) in `route.ts`
3. In the appropriate loop (`runHaikuAgentLoop`, `runBuildUnit`), intercept the tool call before execution
4. Return `{ success: false, error: "<actionable message>" }` — tell the AI what to do instead
5. Add the prompt-level note as a secondary reinforcement (belt + suspenders)

#### Principle 2 — Dynamic Context Injection (Computed Hints > Static Rules)

Generic prompt rules ("use parent.data for nested repeats") are often ignored when the AI has many nodes to process. **Compute specific context** from the generated tree and inject it into the user message for later phases.

**Implemented injections:**

| Injection | Phase | What it provides |
|---|---|---|
| `detectNestedRepeatNodes` | Phase 3 user message | Scans `collectedTrees` for nested repeats. Injects exact node IDs and a reminder: "Node X is inside a nested repeat — use `context?.item?.parent?.data?.field` for outer-item fields." |
| `detectTernaryContrastNodes` | Phase 3 user message | Scans `collectedTrees` + `addVarEventsCollected` for repeat templates with boolean fields. Lists ALL descendant node IDs that need matching ternary text/icon colors when the template gets a ternary bg. Fixes the "styled nested repeat but forgot outer children" pattern. |
| `sectionCount` limit | Phase 2 user message | From planner output. Injects: "SECTION LIMIT: Build EXACTLY N section(s). Do NOT add extra sections..." |
| `wiringEventsCollected` | Phase 3 user message | Counts already-bound `set_text`, `set_repeat`, `set_icon`, `set_condition` from Phase 2. Tells Phase 3 how many bindings exist so it doesn't duplicate them. |
| `existingVarsNote` | Phase 2 system (dynamic block) | Lists existing array variables so Phase 2 reuses them instead of creating duplicates. |

**Pattern for adding a new injection:**
1. Identify which phase needs the context (e.g., Phase 3 needs to know about nested repeats)
2. Write a helper that scans `collectedTrees`, `variableEvents`, or planner output
3. Produce a short, specific string (prefer node IDs and concrete instructions over abstract rules)
4. Append to the appropriate user message in `runBuildOrMixedMode` or `runBuildUnit`

#### Principle 3 — Generic Prompt Design

Prompt rules in `builder-knowledge-v2.ts` must be **abstract and tool-oriented**. Never use domain-specific examples (pricing cards, featured badges, team members). Use generic terms:
- "cards, list items, entries" instead of "pricing cards, feature lists, testimonials"
- "an item boolean field that changes appearance" instead of "featured vs normal"
- `context?.item?.data?.boolField` instead of `context?.item?.data?.featured`

Domain-specific examples cause the AI to hallucinate those exact patterns into unrelated builds. The prompt teaches tool mechanics; the planner description provides domain context.

---

### Adding a New Tool

1. Add the Anthropic tool definition to the appropriate array in `lib/ai/builder-tools.ts` (e.g. `semanticDesignTools`, `logicTools`, `variableTools`, `dataTools`, `pageTools`, `batchTools`)
2. Add the executor handler to `handlers` in `lib/ai/tool-executor.ts`
3. Add the tool name to `CLIENT_SIDE_TOOLS` set in `tool-executor.ts` (all tools that need Zustand store access are client-side)
4. If server-side only (generation, search), handle it in the SSE loop in `route.ts`
5. Update the "Semantic Design Tool Reference" table in `buildChatSystemPrompt` in `lib/ai/builder-knowledge.ts`
6. If the new tool controls a design property, consider pairing it with a builder UI panel section — the tool should mirror what the right panel already exposes

---

## Cursor AI Tips

When working on a specific area, read ONLY the relevant file:

| Task | Read these files |
|---|---|
| Add a new action step type | `_workflow-types.tsx` (add to `ActionStepType` union + `ACTION_CATEGORIES`) |
| Add store types / interfaces | `_store-types.ts` |
| Work on workflow canvas UI | `_workflow-canvas.tsx` (imports types from `_workflow-types.tsx`) |
| Work on design panel | `_panel-right.tsx` lines 279–1975 |
| Work on form validation rules panel | `_panel-right.tsx` lines 2538–3248 |
| Work on datasource forms | `_data-tab.tsx` |
| Work on SDUI form submission | `lib/sdui/form-context.ts`, `lib/sdui/components/FormContainer.tsx`, `lib/sdui/renderer.tsx` |
| Work on formula evaluation | `lib/sdui/formula-evaluator.ts` |
| Work on config API | `app/api/builder/config/route.ts` |
| Work on StateBar / state preview | `_state-bar.tsx`, `lib/sdui/builder-preview.ts`, `_canvas-helpers.tsx` |
| Work on inactive page rendering | `_canvas-helpers.tsx` (`InactivePageEngine`, `InactivePagesGrid`) |
| Add / modify `_stateTag` behaviour | `lib/sdui/builder-preview.ts` (`applyStateTagOverrides`), `_panel-right-design-sections.tsx` (StateTagPicker), `_layers-panel.tsx` (badges) |
| Work on AI chat / tools | `lib/ai/tool-executor.ts`, `lib/ai/builder-knowledge.ts`, `lib/ai/builder-knowledge-v2.ts`, `lib/ai/builder-tools.ts`, `app/api/ai/builder-chat/route.ts` |
| Fix AI hallucinations | `app/api/ai/builder-chat/route.ts` (server guards + dynamic injection), `lib/ai/builder-knowledge-v2.ts` (phase prompts). See "Anti-Hallucination Architecture" above. |
