# Overlay Pattern — Modal, Drawer, Bottom Sheet

There is no `modal` node type. All overlays are built from a `Box` with `position: "fixed"` controlled by a **boolean store variable + `condition`**.

## Core pattern

1. Create a boolean store variable per overlay (mint a fresh UUID):

```json
{ "id": "<overlay-uuid>", "name": "isModalOpen", "type": "boolean", "initialValue": false }
```

2. Create a toggle workflow:

```json
{
  "id": "wf-toggle-modal",
  "meta": { "id": "wf-toggle-modal", "name": "Toggle Modal", "trigger": "click" },
  "steps": [
    { "type": "changeVariableValue", "config": { "variableName": "<overlay-uuid>", "value": { "js": "!variables['<overlay-uuid>']" } } }
  ]
}
```

3. Place the overlay node on the page with `condition` on the outer backdrop:

```json
{
  "type": "Box",
  "condition": "variables['<overlay-uuid>']",
  "props": { "fixed": true, "inset0": true, "z": 50, "center": true, "bg": { "js": "'rgba(0,0,0,0.5)'" } },
  "actions": [{ "trigger": "click", "workflowId": "wf-close-modal" }],
  "children": [
    {
      "type": "Box",
      "props": { "col": true, "bg": "#ffffff", "radius": 12, "shadow": "xl", "p": 24, "maxW": 480, "w": "full" },
      "actions": [{ "trigger": "click", "workflowId": "wf-stop-propagation" }],
      "children": [...]
    }
  ]
}
```

**Key rules:**
- The outer backdrop Box handles click-to-close via `changeVariableValue → false`
- The inner panel has a `stopPropagation` workflow on its `click` action — without this, clicking inside the panel also fires the backdrop's close handler
- `"inset0": true` is shorthand for `inset: 0` (fills the full viewport)
- `condition` is a raw JS string — no `{ js }` wrapper

## `stopPropagation` workflow (create once per page/SC)

```json
{
  "id": "wf-stop-propagation",
  "meta": { "id": "wf-stop-propagation", "name": "Stop Propagation", "trigger": "click" },
  "steps": [{ "type": "stopPropagation" }]
}
```

---

## Modal (centered)

```json
{
  "type": "Box",
  "condition": "variables['<overlay-uuid>']",
  "props": { "fixed": true, "inset0": true, "z": 50, "center": true, "bg": { "js": "'rgba(0,0,0,0.5)'" } },
  "actions": [
    { "trigger": "click", "workflowId": "wf-close-modal" }
  ],
  "children": [
    {
      "type": "Box",
      "props": { "col": true, "bg": "#ffffff", "radius": 12, "shadow": "xl", "p": 24, "maxW": 480, "w": "full", "mx": 16 },
      "actions": [{ "trigger": "click", "workflowId": "wf-stop-propagation" }],
      "children": [
        {
          "type": "Box",
          "props": { "row": true, "items": "center", "justify": "between", "mb": 16 },
          "children": [
            { "type": "Text", "props": { "text": 18, "weight": "semibold" }, "text": "Modal Title" },
            { "type": "Icon", "props": { "icon": "lucide:x", "size": 20, "cursor": "pointer" },
              "actions": [{ "trigger": "click", "workflowId": "wf-close-modal" }] }
          ]
        }
      ]
    }
  ]
}
```

---

## Side Drawer (right)

```json
{
  "type": "Box",
  "condition": "variables['<overlay-uuid>']",
  "props": { "fixed": true, "inset0": true, "z": 50, "bg": { "js": "'rgba(0,0,0,0.4)'" } },
  "actions": [{ "trigger": "click", "workflowId": "wf-close-drawer" }],
  "children": [
    {
      "type": "Box",
      "props": {
        "fixed": true, "top": 0, "right": 0, "h": "screen", "w": 400,
        "col": true, "bg": "#ffffff", "shadow": "xl", "overflow": "auto",
        "animation": { "enter": { "type": "slideInRight", "duration": 250 }, "exit": { "type": "slideOutRight", "duration": 200 } }
      },
      "actions": [{ "trigger": "click", "workflowId": "wf-stop-propagation" }],
      "children": [...]
    }
  ]
}
```

For a **left drawer** swap `"right": 0` → `"left": 0` and animation types to `slideInLeft` / `slideOutLeft`.

---

## Bottom Sheet

```json
{
  "type": "Box",
  "condition": "variables['<overlay-uuid>']",
  "props": { "fixed": true, "inset0": true, "z": 50, "bg": { "js": "'rgba(0,0,0,0.4)'" }, "justify": "end", "col": true },
  "actions": [{ "trigger": "click", "workflowId": "wf-close-sheet" }],
  "children": [
    {
      "type": "Box",
      "props": {
        "w": "full", "col": true, "bg": "#ffffff", "radiusTL": 16, "radiusTR": 16,
        "shadow": "xl", "p": 24, "maxH": 600, "overflow": "auto",
        "animation": { "enter": { "type": "slideInUp", "duration": 300 }, "exit": { "type": "slideOutDown", "duration": 250 } }
      },
      "actions": [{ "trigger": "click", "workflowId": "wf-stop-propagation" }],
      "children": [
        {
          "type": "Box",
          "props": { "w": 40, "h": 4, "radius": 999, "bg": "#e2e8f0", "mx": "auto", "mb": 16 }
        }
      ]
    }
  ]
}
```

---

## Summary

| Variant | Key SxProps on inner panel |
|---|---|
| Modal | `center: true` on backdrop, `maxW`, `radius`, `shadow` |
| Side drawer | `fixed`, `top: 0`, `right/left: 0`, `h: "screen"`, `w: <px>` |
| Bottom sheet | `justify: "end"` on backdrop, `w: "full"`, `radiusTL/radiusTR`, `maxH` |

All three use the same boolean variable + `condition` approach. Always attach `stopPropagation` to the inner panel's click action.
