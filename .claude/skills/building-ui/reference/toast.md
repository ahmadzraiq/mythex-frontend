# Toast Notification Pattern

Show dismissible toast messages from any workflow.

## Required store variables (create once, globally — mint fresh UUIDs)

```json
// store/toastList.json
{ "id": "<toastList-uuid>", "name": "toastList", "type": "array", "initialValue": [] }

// store/toastPos.json
{ "id": "<toastPos-uuid>", "name": "toastPos", "type": "string", "initialValue": "bottom-right" }
```

Mint a standard UUID v4 for each file's `id` field. Use those UUIDs everywhere below — in workflow code strings, bindings, and the overlay node's `map`.

## Show-toast workflow (`workflows/showToast.json`)

Accepts `message`, `type` (`"success"` | `"error"` | `"warning"` | `"info"`), `duration` (ms, default 3000), `limit` (max visible at once, default 5), `position` (overrides the position variable).

Replace `<toastList-uuid>` and `<toastPos-uuid>` with the actual `id` values from the store files above.

```json
{
  "id": "<showToast-wf-uuid>",
  "meta": { "id": "<showToast-wf-uuid>", "name": "Show Toast", "trigger": "execution" },
  "steps": [
    {
      "id": "s-add",
      "type": "runJavaScript",
      "config": {
        "code": "const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);\nconst limit = parameters['limit'] || 5;\nconst dur = parameters['duration'] !== undefined ? Number(parameters['duration']) : 3000;\nconst pos = parameters['position'] || variables['<toastPos-uuid>'] || 'bottom-right';\nconst arr = variables['<toastList-uuid>'] || [];\nconst trimmed = arr.length >= limit ? arr.slice(arr.length - limit + 1) : arr;\nvariables['<toastList-uuid>'] = [...trimmed, { id, message: parameters['message'] || '', type: parameters['type'] || 'info', position: pos }];\nif (dur > 0) { setTimeout(function() { variables['<toastList-uuid>'] = (variables['<toastList-uuid>'] || []).filter(function(t) { return t.id !== id; }); }, dur); }"
      }
    }
  ]
}
```

## Dismiss-toast workflow (`workflows/dismissToast.json`)

```json
{
  "id": "<dismissToast-wf-uuid>",
  "meta": { "id": "<dismissToast-wf-uuid>", "name": "Dismiss Toast", "trigger": "execution" },
  "steps": [
    {
      "id": "s-dismiss",
      "type": "runJavaScript",
      "config": {
        "code": "const tid = parameters['id'];\nvariables['<toastList-uuid>'] = (variables['<toastList-uuid>'] || []).filter(function(t) { return t.id !== tid; });"
      }
    }
  ]
}
```

## Toast overlay node

Place this once — at the root of every page, or inside a layout shared component. Uses `map` over the toast list and renders one Box per active toast.

```json
{
  "type": "Box",
  "props": { "fixed": true, "bottom": 24, "right": 24, "col": true, "gap": 8, "z": 100 },
  "map": { "js": "variables['<toastList-uuid>']", "keyField": "id" },
  "children": [
    {
      "type": "Box",
      "props": { "row": true, "items": "center", "justify": "between", "gap": 12, "px": 16, "py": 12, "radius": 8, "shadow": "lg", "bg": "#1e293b", "minW": 280, "maxW": 400 },
      "children": [
        {
          "type": "Text",
          "props": { "text": 14, "textColor": "#f1f5f9", "flex1": true },
          "text": { "js": "context?.item?.data?.message" }
        },
        {
          "type": "Icon",
          "props": { "icon": "lucide:x", "size": 16, "color": "#94a3b8", "cursor": "pointer" },
          "actions": [
            {
              "trigger": "click",
              "workflowId": "<dismissToast-wf-uuid>",
              "params": { "id": { "js": "context?.item?.data?.id" } }
            }
          ]
        }
      ]
    }
  ]
}
```

## Triggering a toast from any workflow

Use `runProjectWorkflow` with `params`:

```json
{
  "type": "runProjectWorkflow",
  "config": {
    "workflowId": "<showToast-wf-uuid>",
    "params": { "message": "Saved successfully!", "type": "success", "duration": 3000 }
  }
}
```

- `type` values: `"success"` | `"error"` | `"warning"` | `"info"`
- `duration: 0` — toast stays until manually dismissed
- `limit` — max toasts shown at once (default 5, oldest trimmed)
