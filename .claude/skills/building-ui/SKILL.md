---
name: building-ui
description: Build page UI structure — the page entity, the UINode tree, Box/Text/Input/Textarea/Icon nodes, list rendering with map, and special widgets (QR, Markdown, GoogleMap, etc.). Use when creating or editing pages/<name>/page.json or any node tree. For styling those nodes, also load the styling-and-animation skill.
---

# Building UI

## Page entity — `pages/<name>/page.json`

```json
{
  "meta": { "title": "Dashboard" },
  "ui": [
    {
      "type": "Box",
      "props": {
        "col": true,
        "items": "center",
        "w": "full",
        "minH": "screen",
        "bg": "#000000"
      },
      "children": [
        {
          "type": "Text",
          "props": { "text": 88, "weight": "thin", "textColor": "#ffffff", "textAlign": "right", "w": "full", "px": 32 },
          "text": { "js": "variables['550e8400-e29b-41d4-a716-446655440000']" }
        }
      ]
    }
  ]
}
```

- `ui`: array of root UINodes
- `meta`: optional `{ title, description }`

## UINode shape

```json
{
  "type": "Box|Text|Input|Textarea|FormContainer|Image|Icon|Video|Iframe|Chart|QRCodeWidget|MarkdownViewer|GoogleMap|GoogleMapPlaces|LottiePlayer|HtmlContent",
  "name": "optionalCamelCaseLabel",
  "props": {
    "...SxProps keys flat here — see the styling-and-animation skill..."
  },
  "text": "static string or { \"js\": \"expr\" }",
  "condition": "raw JS boolean expression",
  "map": { "js": "variables['uuid-of-items-variable']" },
  "actions": [
    { "workflowId": "uuid-of-workflow-from-its-id-field", "trigger": "click" }
  ],
  "children": []
}
```

**RULES:**
- `text` belongs ONLY on `Text` nodes. `Box` never has a `text` field.
- A button = `Box` with `cursor: "pointer"` containing a `Text` child.
- `map` belongs on the **item node** (the child that repeats), NOT on the container that holds the list. The container is the grid/col parent; `map` is on its direct child.
- `_disabledOverlay: { "color": "#000", "opacity": 0.4, "blur": 2 }` — visual overlay over the node when `props.disabled` is truthy. All fields optional.

### map — list rendering

`map` goes on the child item node, not the container:

```json
{
  "type": "Box",
  "props": { "grid": true, "cols": 4, "gap": 12 },
  "children": [
    {
      "type": "Box",
      "map": { "js": "variables['uuid-of-items-variable']", "keyField": "id" },
      "props": { "radius": 8, "cursor": "pointer" },
      "children": [...]
    }
  ]
}
```

Simple form (no keyField needed):
```json
"map": { "js": "variables['uuid-of-items-variable']" }
```

Rich form — use when you need to specify the key field:
```json
"map": { "js": "variables['uuid']", "keyField": "id" }
```
- `keyField`: the property name on each item used as the React key (e.g. `"id"`, `"uuid"`).
- **Always access the repeated item via `context?.item?.data?.field`** — this is canonical and always works.
- `"as": "entry"` is supported: it makes the item available as a bare name in `{ js }` expressions (e.g. `entry.title`), but does **not** create `context.entry.data`. Prefer `context.item.data` to avoid confusion.

### Icon node

```json
{
  "type": "Icon",
  "props": {
    "icon": "lucide:search",
    "size": 20,
    "color": "#ffffff",
    "cursor": "pointer"
  }
}
```

- `icon`: `"prefix:name"` — e.g. `"lucide:search"`, `"mdi:star"`, `"tabler:home"`, `"ph:heart"`. Always call `search_media` first.
- `size`: number in px (default 24).
- `color`: hex string or CSS variable for the icon fill.

### Input node

```json
{
  "type": "Input",
  "name": "emailField",
  "props": {
    "placeholder": "Enter email",
    "type": "email",
    "border": 1,
    "borderColor": "#334155",
    "radius": 8,
    "bg": "#1e293b",
    "px": 14,
    "py": 12,
    "w": "full"
  }
}
```

- `placeholder`: placeholder text
- `type`: `"text"` (default) | `"email"` | `"password"` | `"number"` | `"tel"`
- `readOnly`: `true` to disable editing
- `format`: positional input mask — `#` = digit, `A` = letter, other chars are literals. Example: `"####-##-##"` for a date mask.
- Style entirely with SxProps (`border`, `borderColor`, `radius`, `bg`, `px`, `py`, `w`, etc.) directly on the node.
- **Value binding**: the current value is auto-tracked and readable as `variables['{node-id}-value']` or via `event.value` in a `change` workflow.
- **Form integration**: inside a `FormContainer`, set `name` on the node. Add `"_validation": { "trigger": "submit", "rules": [...] }` as a sibling field on the same node for validation. Supported rule keys:
  - `required: true` — field must not be empty
  - `minLength: N` / `maxLength: N` — string length bounds
  - `pattern: "regex"` — must match regex string
  - `email: true` / `phone: true` / `url: true` — format checks
  - `equalsField: "fieldName"` — must equal another field's current value (e.g. confirm password)
  - `formula: "JS boolean expr"` — custom validation; access value as `value`
  - `message: "Error text"` — custom error message for this rule
- **Workflow trigger**: use `"trigger": "change"` — `event.value` is the typed text.

### Textarea node

Same as Input except:
- No `format` mask (multiline free text only).
- `type` is not applicable.
- Everything else (value tracking, form integration, `change` trigger, `readOnly`, SxProp styling) works identically.

## Special widgets

These are leaf nodes (no children). Use SxProps (`w`, `h`, etc.) for sizing unless noted.

### QRCodeWidget

```json
{ "type": "QRCodeWidget", "props": { "value": "https://example.com", "size": 200, "fgColor": "#000000", "bgColor": "#ffffff", "level": "M" } }
```

- `value`: string to encode (required for a real QR; omit to show placeholder)
- `size`: px (default 160)
- `fgColor` / `bgColor`: hex colors
- `level`: error correction — `"L"` | `"M"` | `"Q"` | `"H"` (default `"M"`)

### MarkdownViewer

```json
{ "type": "MarkdownViewer", "props": { "content": "## Hello\n\n**Bold** text and a [link](https://example.com)." } }
```

- `content`: markdown string; supports standard GFM (headings, bold, italic, links, lists, code blocks)

### GoogleMap

```json
{ "type": "GoogleMap", "props": { "apiKey": "YOUR_KEY", "lat": 37.7749, "lng": -122.4194, "zoom": 13, "w": "full", "h": 320 } }
```

- `apiKey`: Google Maps API key
- `lat` / `lng`: center coordinates (defaults: San Francisco)
- `zoom`: zoom level (default 13)
- `mapId`: optional Google Maps map ID for cloud styling
- Set dimensions with SxProps `w` / `h`

### GoogleMapPlaces

```json
{ "type": "GoogleMapPlaces", "props": { "apiKey": "YOUR_KEY", "placeholder": "Search for a place…" } }
```

- `apiKey`: Google Maps API key
- `placeholder`: search input placeholder text
- Renders a place-search input; bind a `change` workflow to capture `event.value`

## Placing a Shared Component instance on a page

Use `_shared` on any Box to render a SC instead of an ad-hoc node tree. The `children` array holds the page content that goes inside the SC layout:

```json
{
  "type": "Box",
  "_shared": { "id": "sc-auth-layout", "name": "Auth Layout" },
  "children": [
    { "type": "Text", "text": "Page content here" }
  ]
}
```

- `_shared.id`: the SC's `id` field from `components/<id>/component.json`
- `_shared.name`: display label (any string)
- Use this for layout SCs (nav + footer shells, auth guards). Never duplicate their node tree on each page.

## `reachEnd` trigger — infinite scroll

Fires when the user scrolls near the bottom of an element or the window. Attach to a scrollable Box node:

```json
{
  "trigger": "reachEnd",
  "workflowId": "wf-load-more",
  "config": { "scrollTarget": "element", "threshold": 80 }
}
```

Or as a page-level trigger in `pages/<name>/triggers/reachEnd.json` (window scroll):
```json
{
  "id": "reachEndTrigger",
  "meta": { "id": "reachEndTrigger", "name": "On Reach End", "trigger": "reachEnd", "isTrigger": true, "pageScope": "<pageName>" },
  "config": { "scrollTarget": "window", "threshold": 200 },
  "steps": []
}
```

- `scrollTarget`: `"element"` (scroll within the Box) | `"window"` (page scroll)
- `threshold`: px from the bottom at which the trigger fires (default 80)

For the full infinite scroll recipe (state variables, load-more workflow), read [reference/infinite-scroll.md](reference/infinite-scroll.md).

## UI pattern recipes

For reusable UI patterns, read the relevant file in [reference/](reference/):
- [reference/toast.md](reference/toast.md) — toast notification system (fixed UUIDs + show/dismiss workflows)
- [reference/overlays.md](reference/overlays.md) — modal, side drawer, and bottom-sheet pattern
- [reference/infinite-scroll.md](reference/infinite-scroll.md) — infinite scroll with pagination

## Media tool

Use `search_media` before using any `Image`, `Icon`, or `Video` node to find the correct URL or icon name.
