---
name: frontend-workflows
description: Build client-side interactivity — page/global/SC workflows, their step types (changeVariableValue, branch, navigateTo, runJavaScript, forEach, etc.), triggers, and scoping best practices. Use when wiring node actions, handling events (click/change/submit/pageLoad), or editing any workflows/ or triggers/ file.
---

# Frontend Workflows

## Workflow entity — `pages/<name>/workflows/<name>.json` or `workflows/<name>.json`

```json
{
  "id": "wf-a1b2c3d4-1111-4aaa-8bbb-000000000001",
  "meta": {
    "id": "wf-a1b2c3d4-1111-4aaa-8bbb-000000000001",
    "name": "Handle Button Click",
    "trigger": "click",
    "pageScope": "myPage"
  },
  "steps": [
    {
      "id": "step1",
      "type": "changeVariableValue",
      "config": {
        "variableName": "550e8400-e29b-41d4-a716-446655440000",
        "value": { "js": "variables['550e8400-e29b-41d4-a716-446655440000'] + context.item.data.label" }
      }
    }
  ]
}
```

- `meta.trigger`: `click` | `change` | `focus` | `blur` | `valueChange` | `enterKey` | `submit` | `appLoad` | `pageLoad` | `pageUnload` | `reachEnd` | `mounted` | `beforeUnmount` | `propertyChange` | `execution`
- `meta.pageScope`: required for `pages/<name>/workflows/` path; must equal the page name
- For global `workflows/<name>.json`: omit `pageScope`
- For app-level triggers (e.g. `appLoad` session restore): add `meta.isAppTrigger: true` and omit `pageScope`

### Step types (config shapes)

| type | key config fields |
|------|-------------------|
| `changeVariableValue` | `variableName` (UUID from the variable's `id` field), `value` (literal or `{ js }`) |
| `resetVariableValue` | `variableName` (UUID) |
| `branch` | `condition: { js }` + top-level `trueBranch: []`, `falseBranch: []` |
| `multiOptionBranch` | `condition: { js }` + top-level `branches: [{ label, steps }]`, `defaultBranch: []` |
| `navigateTo` | `path` (route), `linkType: "internal"\|"external"`, `newTab`, optional `queryParams: { key: value }` to set/merge URL query params (use `null` to remove a param) |
| `runJavaScript` | **code must be nested under `config`**: `{ "type": "runJavaScript", "config": { "code": "..." } }`. Globals: `variables` (writable; UUID or name), `parameters` (params from the calling action), `fns`, `wwLib`, `context` |
| `fetchData` | `url`, `method`, `headers`, `body` (all support `{ "js": "…" }`). Result at `context.workflow['stepId'].result`. Use for ad-hoc HTTP calls (login, mutations, etc.) |
| `fetchCollection` | `collectionId` (datasource UUID) — triggers a named datasource refetch |
| `forEach` | `items: { js }` + top-level `loopBody: []` |
| `whileLoop` | `condition: { js }` + top-level `loopBody: []` — hard-capped at **100 iterations** client-side (backend caps at 1000) |
| `breakLoop` | exits the nearest `forEach` or `whileLoop` |
| `continueLoop` | skips to next iteration of the nearest loop |
| `timeDelay` | `ms` |
| `runProjectWorkflow` | `workflowId` (UUID from the workflow's `id` field), `params: {}` |
| `executeComponentAction` | `componentId`, `workflowId` — calls a workflow on a specific SC instance |
| `emitComponentTrigger` | `componentId`, `triggerId` (trigger id string) — fires a custom trigger on a SC |
| `returnValue` | `value` |
| `passThroughCondition` | `condition: { js }` — no-op if true; short-circuits the workflow if false (useful as an early-exit guard) |
| `copyToClipboard` | `text` |
| `scrollToElement` | `targetNodeId` (node `name` field) |
| `controlAnimation` | `targetNodeId`, `action: "trigger"\|"exit"\|"startLoop"\|"stopLoop"` |
| `navigatePrev` | go back one step in browser history (no config needed) |
| `submitForm` | `formId` — submits a FormContainer |
| `setFormState` | `formId`, `fieldName`, `value` — sets a form field programmatically |
| `resetForm` | `formId` — resets FormContainer fields to initial state |
| `graphql` | like `fetchData` but sends a GraphQL request (`query`, `variables`, `operationName`) |
| `stopPropagation` | no config — stops the click event from bubbling to parent nodes; use on any nested clickable element (e.g. a button inside a clickable card, close button inside a modal backdrop) |
| `fetchCollectionsParallel` | `collectionIds: []` — array of datasource UUIDs; fetches all in parallel |
| `updateCollection` | `collectionId` — updates a single datasource's cached data |
| `pickFile` | `accept` (MIME type string e.g. `"image/*"`), `multiple` (boolean) — opens OS file picker; result at `context.workflow['stepId'].result` |
| `encodeFileAsBase64` | `file` — converts a file value to base64; result: `{ data, type, name, size }` |
| `downloadFileFromUrl` | `url`, `fileName` — triggers a browser file download |
| `createUrlFromBase64` | `data`, `type` — creates a blob URL from base64; result: `{ url }` |
| `printPdf` | no config — prints the current page as PDF via the browser print dialog |

**`runJavaScript` step — correct shape:**
```json
{
  "id": "step-1",
  "type": "runJavaScript",
  "config": {
    "code": "const key = parameters['key'];\nvariables['uuid'] = key;"
  }
}
```
`code` goes under `config`, never at the step root. Inside the code body, `parameters['key']` reads params passed from the action's `params` field, and `variables['uuid'] = value` writes back to the store.

> If a workflow uses `parameters['...']` in any step, its `meta` must declare a matching `params` array: `"params": [{ "name": "key", "type": "text" }]`. Without this declaration the caller cannot pass values.

> Anti-pattern: do NOT create a shared `workflows/navigate.json` whose sole job is a `navigateTo` step. Instead, inline `navigateTo` directly in the page/component workflow, with the path hardcoded or as an inline JS expression (e.g. `{ "js": "'/items/' + context.item.data.id" }`).

## Trigger entity — `pages/<name>/triggers/<type>.json`

```json
{
  "id": "pageLoadTrigger",
  "meta": {
    "id": "pageLoadTrigger",
    "name": "On Page Load",
    "trigger": "pageLoad",
    "isTrigger": true,
    "pageScope": "myPage"
  },
  "steps": []
}
```

For app-level triggers (run once when the app starts, not tied to a page): place in `workflows/<name>.json` and add `"meta": { "trigger": "appLoad", "isAppTrigger": true }`. Omit `pageScope`.

## Workflow best practices

- SC-scoped workflow (`components/<id>/workflows/<name>`) = logic private to one shared component; accesses SC variables via `variables['uuid']` and reads them in bindings via `context?.component?.variables?.['uuid']`.
- Page-scoped workflow (`pages/<name>/workflows/<name>`) = one node, one action.
- Global workflow (`workflows/<name>`) = shared across multiple nodes; called via `runProjectWorkflow` with `params`.
- Inside a mapped container: use `context?.item?.data?.field` in step configs.
- `branch` and `whileLoop` conditions MUST be `{ "js": "boolExpr" }` objects, not raw strings.

**Scoping decision — choose the narrowest scope that covers the need:**
- State/logic only used inside one SC → SC-scoped (`components/<id>/store` + `components/<id>/workflows`)
- State/logic only used on one page → page-scoped (`pages/<name>/workflows`)
- State/logic shared across pages or components → global (`store` + `workflows`)
