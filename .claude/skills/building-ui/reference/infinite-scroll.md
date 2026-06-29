# Infinite Scroll Pattern

Load more items as the user scrolls, using the `reachEnd` trigger + `fetchData` + `runJavaScript` to append pages.

## State variables (4 per list, mint fresh UUIDs for each feature)

```json
// store/items.json     — accumulated rows
{ "id": "<items-uuid>",   "name": "items",   "type": "array",   "initialValue": [] }

// store/page.json      — current page number
{ "id": "<page-uuid>",    "name": "page",    "type": "number",  "initialValue": 1 }

// store/loading.json   — fetch in progress
{ "id": "<loading-uuid>", "name": "loading", "type": "boolean", "initialValue": false }

// store/hasMore.json   — more pages available
{ "id": "<hasMore-uuid>", "name": "hasMore", "type": "boolean", "initialValue": true }
```

## Initial load trigger (`pages/<name>/triggers/pageLoad.json`)

On page load, reset state and fetch page 1:

```json
{
  "id": "wf-init-load",
  "meta": { "id": "wf-init-load", "trigger": "pageLoad", "isTrigger": true, "pageScope": "<pageName>" },
  "steps": [
    { "type": "changeVariableValue", "config": { "variableName": "<items-uuid>",   "value": [] } },
    { "type": "changeVariableValue", "config": { "variableName": "<page-uuid>",    "value": 1 } },
    { "type": "changeVariableValue", "config": { "variableName": "<loading-uuid>", "value": false } },
    { "type": "changeVariableValue", "config": { "variableName": "<hasMore-uuid>", "value": true } },
    { "type": "runProjectWorkflow",  "config": { "workflowId": "wf-load-more", "params": {} } }
  ]
}
```

## Load-more workflow (`pages/<name>/workflows/loadMore.json`)

```json
{
  "id": "wf-load-more",
  "meta": { "id": "wf-load-more", "name": "Load More", "pageScope": "<pageName>" },
  "steps": [
    {
      "id": "s-guard",
      "type": "branch",
      "config": { "condition": { "js": "variables['<loading-uuid>'] === true || variables['<hasMore-uuid>'] === false" } },
      "trueBranch": [{ "type": "returnValue", "config": { "value": null } }],
      "falseBranch": [
        { "type": "changeVariableValue", "config": { "variableName": "<loading-uuid>", "value": true } },
        {
          "id": "s-fetch",
          "type": "fetchData",
          "config": {
            "url": { "js": "'/api/my-endpoint?page=' + variables['<page-uuid>'] + '&pageSize=20'" },
            "method": "GET"
          }
        },
        {
          "id": "s-append",
          "type": "runJavaScript",
          "config": {
            "code": "const newItems = context.workflow['s-fetch'].result?.data || context.workflow['s-fetch'].result || [];\nvariables['<items-uuid>'] = [...(variables['<items-uuid>'] || []), ...newItems];\nvariables['<hasMore-uuid>'] = newItems.length >= 20;\nvariables['<page-uuid>'] = (variables['<page-uuid>'] || 1) + 1;"
          }
        },
        { "type": "changeVariableValue", "config": { "variableName": "<loading-uuid>", "value": false } }
      ]
    }
  ]
}
```

## Scrollable container node (element scroll)

```json
{
  "type": "Box",
  "props": { "col": true, "overflowY": "auto", "h": 600 },
  "actions": [{ "trigger": "reachEnd", "workflowId": "wf-load-more", "config": { "scrollTarget": "element", "threshold": 80 } }],
  "map": { "js": "variables['<items-uuid>']", "keyField": "id" },
  "children": [
    { "type": "Text", "text": { "js": "context?.item?.data?.name" } }
  ]
}
```

Or use a page-level window-scroll trigger instead (see `reachEnd` docs in SKILL.md).

## Loading indicator

Render a spinner or text conditionally below the list:

```json
{ "type": "Text", "condition": "variables['<loading-uuid>']", "text": "Loading…", "props": { "textColor": "#94a3b8" } }
```

## End-of-list indicator

```json
{ "type": "Text", "condition": "!variables['<hasMore-uuid>'] && !variables['<loading-uuid>']", "text": "No more items", "props": { "textColor": "#64748b" } }
```
