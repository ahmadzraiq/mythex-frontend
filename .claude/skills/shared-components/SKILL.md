---
name: shared-components
description: Build reusable shared components (SCs) — the component entity, component properties, SC-internal state (store) and SC-scoped workflows, and placing instances. Use when creating components/<id>/component.json, reusing a UI block across pages, or managing component-local variables.
---

# Shared Components

## Component entity — `components/<id>/component.json`

```json
{
  "id": "sc-status-badge",
  "name": "Status Badge",
  "properties": [
    { "id": "prop-sb-status", "name": "status", "type": "text", "defaultValue": "active" }
  ],
  "content": {
    "type": "Box",
    "props": { "row": true, "items": "center", "gap": 6 },
    "children": [
      {
        "type": "Text",
        "props": { "text": 14, "textColor": "#ffffff" },
        "text": { "js": "context.component.props.status" }
      }
    ]
  }
}
```

- `id`: kebab-case identifier, e.g. `sc-my-card`
- `properties`: array of `{ id, name, type: "text"|"number"|"boolean"|"object", defaultValue }`
- `content`: single root UINode (same flat SxProps format as pages)
- Inside content, access props via `context.component.props.<name>` and local variables via `context?.component?.variables?.['<uuid>']` (always use UUID, not variable name)
- **Prefer a shared component when a UI block repeats within a page or is reused across pages.** Create the component once, then place instances (with `_shared: { id, name }`) instead of duplicating the node tree. This keeps `page.json` small and changes localized.
- **SC-internal state**: if a variable or workflow is only needed inside this SC, create it under `components/<id>/store/` and `components/<id>/workflows/` — never in global `store/` or `workflows/`. Examples of SC-only state: display value, active tab, open accordion, carousel index, form step.

**SC-internal variable + workflow — file structure:**
```
components/sc-card/store/isOpen.json       ← { "id": "uuid-sc-open",   "name": "isOpen",    ... }
components/sc-card/store/activeTab.json    ← { "id": "uuid-sc-tab",    "name": "activeTab", ... }
components/sc-card/workflows/onToggle.json ← { "id": "uuid-sc-toggle", ... }
```

Inside SC `content` — read an SC variable (UUID from the variable file's `id`):
```json
{ "js": "context?.component?.variables?.['uuid-sc-open']" }
```

Inside an SC workflow — write back to an SC variable:
```js
variables['uuid-sc-open'] = newValue;
```

Action on a node inside the SC — invoke an SC workflow (same syntax as global):
```json
{ "trigger": "click", "workflowId": "uuid-sc-toggle" }
```

## SC lifecycle triggers

SC workflows can use these `meta.trigger` values (in addition to `click`, `change`, etc.):
- `mounted` — fires when the SC is mounted. Use for auth guard checks, initial data fetches.
- `beforeUnmount` — fires just before SC is removed.
- `propertyChange` — fires when a prop value changes.
- `execution` — custom named trigger; fired externally via the `emitComponentTrigger` step.

## `emitComponentTrigger` step

Fires a custom trigger on a specific SC instance from an external workflow. The config key is **`triggerId`** (not `trigger`):
```json
{ "type": "emitComponentTrigger", "config": { "componentId": "sc-auth-layout", "triggerId": "myCustomTrigger" } }
```
The SC must have a workflow whose `meta.trigger` equals the trigger id string (e.g. `"myCustomTrigger"`). SC custom triggers are declared in the component model's `triggers: [{ id, name, payload }]` array — they are not separate VFS files.
