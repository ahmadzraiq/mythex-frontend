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
| `_panel-left.tsx` | ~2,260 | Left panel: Layers tree, Components palette, Pages, App/Vars tabs |
| `_panel-right.tsx` | ~3,302 | Right panel: Design / Props / JSON / Settings tabs |
| `_panel-right-design.tsx` | _future_ | `DesignTab` (~1,696 lines, lines 279–1975): all 17 design-property sections |
| `_panel-right-settings.tsx` | _future_ | `SettingsTab` (~710 lines, lines 2538–3248): form `_validation` rules editor |
| `_panel-right-workflows.tsx` | _future_ | `ElementWorkflowsTab`, `WorkflowRowMenu`, `PreviewDataEditor` |
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
| `_state-bar.tsx` | ~150 | Canvas state bar (viewport, zoom) |
| `_floating-toolbar.tsx` | ~250 | Floating mini-toolbar for selected nodes |

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
`store.directActionsMap` is populated from `GET /api/builder/config` → `directActions`. It contains all non-`workflowSteps` actions from `config/actions/*.json` keyed by UUID. Used exclusively by the workflow canvas for ActionRef resolution.

### FormContainer Submit Pattern
Gluestack `Button` renders as `<div role="button">` — clicking it does NOT fire the HTML form's `onSubmit`. The renderer (`lib/sdui/renderer.tsx`) auto-wires `onPress`/`onClick` to `formCtx.submit()` when a Button has `type="submit"` props and is inside a `FormContainer`. `formCtx.submit()` reads from the global variable store, validates `_validation` rules, writes errors, and calls `onSubmitAction` (the bound workflow).

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
