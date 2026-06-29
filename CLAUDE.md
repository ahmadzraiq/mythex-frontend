# SDUI Builder — JSON Agent Reference

You are a JSON-based SDUI builder agent. Edit the project's JSON entity files using native Read/Write/Edit/Glob/Grep tools. Every validated write is immediately live on the canvas.

---

## Virtual File System layout

Files are stored with a `.json` extension. Paths below show the **VFS path** (no extension).

```
routes                                — route definitions
design/theme                          — theme CSS variable overrides
design/colors                         — custom color palette
store/<name>                          — global variable
store/<folder>/<name>                 — variable in a folder
utils/<name>                          — global formula / utility function
utils/<folder>/<name>                 — formula in a folder
workflows/<name>                      — global reusable workflow
workflows/<folder>/<name>             — workflow in a folder
data/<id>                             — datasource (REST or GraphQL)
data/<folder>/<id>                    — datasource in a folder
triggers/<type>                       — app-level lifecycle trigger  e.g. appLoad
pages/<name>/page                     — full page UI tree
pages/<name>/workflows/<name>         — page-scoped workflow
pages/<name>/triggers/<type>          — page lifecycle trigger  e.g. pageLoad
components/<id>/component             — shared component model
components/<id>/store/<varId>         — SC-internal variable
components/<id>/utils/<formulaId>     — SC-internal formula
components/<id>/workflows/<wfId>      — SC-internal workflow
components/<id>/triggers/<triggerId>  — SC custom event

server/models/<Name>                  — backend data model (source of truth for schema)
server/models/<folder>/<Name>         — model in a folder
server/enums/<Name>                   — shared enum (name + values[])
server/apis/<slug>                    — backend HTTP endpoint workflow (API_ENDPOINT)
server/middleware/<name>              — backend middleware workflow (auth/guards)
server/functions/<name>               — backend reusable function workflow (hooks/events)
server/seeds/<Model>                  — seed rows for a model
```

### Seeds and relational IDs

Seed rows are inserted independently per model. There is **no cross-seed reference syntax** — you cannot reference another seed file's auto-generated ID (e.g. you cannot set `authorId` in a `Post` seed to the DB ID of a `User` seed row, because User IDs are only created at apply time).

**Rule**: when a model has a required `relation` field pointing to another model, seed both models but leave the FK field `null` in the dependent seed. Cross-seed FK values cannot be wired at generation time — IDs only exist after apply.

On disk, every path ends in `.json`. Example: `store/displayValue.json`, `pages/dashboard/page.json`, `server/models/Post.json`.

Every entity that can be foldered (`store`, `utils`, `workflows`, `data`, colors in `design/colors`, and all `server/*` entities) supports an optional `"folder": "Name"` string field. The folder is the path segment between the root and the entity name. For `server/*`, the folder is presentation-only — it never changes the table name, route, or endpoint URL.

---

## Backend (`server/`) — model-first

The backend is **model-first**: `server/models/<Name>.json` is the single source of truth. Writing a model file runs a migration (create/alter table) automatically; deleting requires confirmation.

To expose model data over HTTP, write an explicit `server/apis/<slug>.json` (`kind: "API_ENDPOINT"`) that uses ORM steps (`ormFindMany`, `ormCreate`, `ormFindOne`, `ormUpdate`, `ormDelete`). Always create the necessary `server/apis/` files alongside every model.

Model JSON shape:

```
{
  "id": "uuid",                  // stable model id (auto-generated if omitted)
  "name": "Post",               // PascalCase model name
  "table": "posts",             // snake_case physical table
  "folder": "Blog",             // optional, presentation only
  "timestamps": true,            // created_at / updated_at (default true)
  "softDelete": false,           // deleted_at column + auto-filter
  "actorTracking": false,        // created_by / updated_by from identity
  "fields": [
    { "id": "uuid", "name": "title", "type": "text", "required": true, "unique": false, "searchable": true },
    { "name": "publishedAt", "type": "datetime" },
    { "name": "status", "type": "enum", "enum": "PostStatus" },
    { "name": "cover", "type": "file" },
    { "name": "slug", "type": "text", "computed": { "expr": "lower(row.title)", "persisted": true } },
    { "name": "author", "type": "relation", "relation": { "kind": "manyToOne", "to": "User" } }
  ],
  // IMPORTANT: name relation fields after the related model (e.g. "author", "owner"), NOT after the FK column (e.g. NOT "authorId", "ownerId").
  // The system creates the FK column automatically as <fieldName>Id. Naming it "ownerId" makes the include return { ownerId: {...} } instead of { owner: {...} }.
  "indexes": [{ "fields": ["title"], "unique": false }],
  "search": ["title"],            // full-text searchable fields
  "validations": { "title": "row.title.length > 0" },   // boolean expr (refs row.*) enforced on write
  "hooks": { "beforeCreate": "functionName" },  // -> server/functions/<name>, runs in write tx
  "events": { "onCreate": "functionName" },     // -> server/functions/<name>, async after commit
  "access": { "create": ["requireAuth"], "*": ["requireAuth"] }  // -> server/middleware/<name>
}
```

Field `type`: `text | int | bigint | decimal | float | money | bool | json | uuid | date | datetime | timestamp | enum | file | relation`. Each field has a stable `id` (UUID) — keep it on rename; it is auto-generated when omitted on first write. Computed `expr` and `validations` reference fields as `row.<field>`.

Authorization is **never** policy logic inside the model — `access` maps a CRUD op (`list`/`read`/`create`/`update`/`delete`/`*`) to MIDDLEWARE workflow names in `server/middleware/`. Reusable logic goes in `server/functions/` and is referenced by `hooks`/`events`. Compose RBAC, auth flows, and notifications from these primitives.

### Wiring the frontend to backend data

To render backend data on a page:
1. Create a `server/apis/<slug>.json` endpoint (e.g. `server/apis/list-posts.json`) with `"path": "/posts"` and ORM steps.
2. Create a `data/<id>.json` datasource whose `url` matches the endpoint `path`:

```json
{ "id": "posts-ds", "name": "Posts", "type": "rest", "url": "/posts", "method": "GET", "trigger": "mount" }
```

The engine automatically prepends the backend run URL and project ID to any datasource `url` that starts with `/`. Use an absolute URL (e.g. `https://...`) only for third-party APIs.

Read the fetched data in bindings via `collections['posts-ds']` (direct array, no `.data` wrapper).

> Forbidden API fields: do NOT add `outputSchema` or `security` to any `server/apis/` file — they are not part of the schema and the validator will reject them.

---

## Formula binding scope

Use these in `text`, `src`, `condition`, `value`, workflow step `config`, etc.

```
variables['550e8400-e29b-41d4-a716-446655440000']  — read a store variable by its UUID id field
collections['<uuid>']                     — datasource fetched data (array or object); no .data wrapper
collections['<uuid>'].loading             — true while fetching
collections['<uuid>'].error               — error object if last fetch failed
context?.item?.data?.field                — map-item field
context?.item?.data?.index                — 0-based index in list
context?.item?.parent?.data               — outer map item (nested maps)
variables['auth0001-a5b6-4000-c000-000000000001']  — auth token (string)
variables['auth0002-a5b6-4000-c000-000000000002']  — current user (object)
event.value                               — change/focus/blur (Input/Textarea only)
globalContext?.browser?.path              — current URL path
globalContext?.browser?.params?.<name>    — URL path parameter (set by :name in routes.json)
globalContext?.browser?.query?.<key>      — query string value
globalContext.browser.breakpoint          — "desktop"|"laptop"|"tablet"|"mobile"
globalContext.screen.width                — viewport width in px
local.data.form.formData.<field>          — form field value (inside FormContainer)
context.component.props.<name>            — SC property value (inside shared component)
context?.component?.variables?.['<uuid>'] — SC-scoped variable (always use UUID, not name)
context.workflow['stepId'].result         — step result (set id: 'stepId' on the step)
parameters['name']                        — global workflow only (called via runProjectWorkflow)
route?.<paramName>                        — URL path parameter shorthand (same as browser.params)
theme?.['colors']?.['primary']            — resolved hex of a theme color token
fns.<utilName>(args)                      — call a user-defined formula from utils/<name>.json by its name field
```

Dynamic bindings use `{ "js": "JS expression" }`. `{ "formula": "…" }` also works and is equivalent.  
`condition` on a node is a raw JS string (no wrapper).  
**Always use the `id` field from the entity's JSON file in bindings — never path strings.**  
Example: if `store/displayValue.json` has `"id": "550e8400-e29b-41d4-a716-446655440000"`, write `variables['550e8400-e29b-41d4-a716-446655440000']` everywhere that variable is read or written.

---

## Variable entity — `store/<name>.json`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "displayValue",
  "label": "Display Value",
  "type": "string",
  "initialValue": "0",
}
```

- `id`: UUID. For NEW variables, mint one (standard UUID v4: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`). For EXISTING variables, read the file first to get the current id — never change it.
- `type`: `string` | `number` | `boolean` | `object` | `array`
- `initialValue`: must match the type exactly (`"string"` → string, `"number"` → number literal, etc.)
- `folder`: optional grouping label
- `saveInLocalStorage`: optional `true` — persists value across page refreshes (required for auth token variable)
- `resetOnNavigate`: optional `true` — clears value on every page navigation

---

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

---

## UINode shape

```json
{
  "type": "Box|Text|Input|Textarea|FormContainer|Image|Icon|Video|Iframe|Chart|QRCodeWidget|MarkdownViewer|GoogleMap|GoogleMapPlaces|LottiePlayer|HtmlContent",
  "name": "optionalCamelCaseLabel",
  "props": {
    "...SxProps keys flat here — see table below..."
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
- `map` belongs on the **item node** (the node that becomes one repeated row/card), never on the container that wraps the list. The container (e.g. a `Box` with `grid` or `col`) is the parent; the node with `map` is its direct child.
- `_disabledOverlay: { "color": "#000", "opacity": 0.4, "blur": 2 }` — visual overlay over the node when `props.disabled` is truthy. All fields optional.

### map — list rendering

`map` goes on the **item node** (the child), not on the container. The container is the grid/col Box; the item is its direct child:

```json
{
  "type": "Box",
  "props": { "grid": true, "cols": 4, "gap": 12 },
  "children": [
    {
      "type": "Box",
      "map": { "js": "variables['uuid-of-items-variable']", "keyField": "id" },
      "props": { "radius": 999, "cursor": "pointer" },
      "children": [...]
    }
  ]
}
```

Rich form — use when you need to rename the loop variable:
```json
"map": { "js": "variables['uuid']", "as": "row", "keyField": "id" }
```
- `as`: renames the loop variable (default: `item`). With `"as": "row"`, write `context?.row?.data?.field` instead of `context?.item?.data?.field`.
- `keyField`: the property name on each item used as the React key (e.g. `"id"`, `"uuid"`).

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
- **Form integration**: inside a `FormContainer`, set `name` on the node. Add `"_validation": { "trigger": "submit", "rules": [] }` as a sibling field on the same node for validation.
- **Workflow trigger**: use `"trigger": "change"` — `event.value` is the typed text.

### Textarea node

Same as Input except:
- No `format` mask (multiline free text only).
- `type` is not applicable.
- Everything else (value tracking, form integration, `change` trigger, `readOnly`, SxProp styling) works identically.

---

## SxProps — flat in `props`

Write all styling as flat keys directly in `props`. The server converts them to CSS.

### Layout

| key | values |
|-----|--------|
| `flex` | `true` — enables `display: flex` |
| `col` | `true` — flex + direction col (vertical stack) |
| `row` | `true` — flex + direction row (horizontal stack) |
| `grid` | `true` — enables `display: grid` |
| `center` | `true` — items: center + justify: center |
| `display` | `"flex"` \| `"grid"` \| `"block"` \| `"inline-block"` \| `"inline"` \| `"none"` — layout switching only; use `condition` to show/hide nodes |
| `direction` | `"row"` \| `"col"` \| `"row-reverse"` \| `"col-reverse"` |
| `items` | `"start"` \| `"end"` \| `"center"` \| `"stretch"` \| `"baseline"` |
| `justify` | `"start"` \| `"end"` \| `"center"` \| `"between"` \| `"around"` \| `"evenly"` |
| `self` | `"auto"` \| `"start"` \| `"center"` \| `"end"` \| `"stretch"` |
| `wrap` | `"wrap"` \| `"nowrap"` \| `"wrap-reverse"` |
| `flex1` | `true` — flex: 1 |
| `cols` / `gridCols` | number — grid columns |
| `gridRows` | number |
| `gridFlow` | `"row"` \| `"col"` \| `"dense"` |
| `colSpan` | number |
| `colSpanFull` | `true` |
| `rowSpan` | number |
| `gap` | number (px) |
| `gapX` | number (px) |
| `gapY` | number (px) |

### Size

| key | values |
|-----|--------|
| `w` | number (px) \| `"full"` \| `"screen"` \| `"fit"` \| `"auto"` |
| `h` | number (px) \| `"full"` \| `"screen"` \| `"fit"` \| `"auto"` |
| `minW` | number (px) \| `"full"` \| `"fit"` \| `"auto"` |
| `maxW` | number (px) \| `"full"` \| `"fit"` |
| `minH` | number (px) \| `"full"` \| `"screen"` \| `"fit"` |
| `maxH` | number (px) \| `"full"` \| `"screen"` \| `"fit"` |

### Spacing

| key | values |
|-----|--------|
| `p` | number (px) |
| `px` | number (px) |
| `py` | number (px) |
| `pt` `pr` `pb` `pl` | number (px) |
| `m` | number (px) \| `"auto"` |
| `mx` | number (px) \| `"auto"` |
| `my` | number (px) \| `"auto"` |
| `mt` `mr` `mb` `ml` | number (px) |

### Color & typography

| key | values |
|-----|--------|
| `bg` | hex / css color string |
| `text` / `size` | number (font-size in px) |
| `textColor` / `color` | hex / css color string |
| `weight` | `"thin"` \| `"light"` \| `"normal"` \| `"medium"` \| `"semibold"` \| `"bold"` \| `"extrabold"` \| `"black"` |
| `textAlign` / `align` | `"left"` \| `"center"` \| `"right"` \| `"justify"` |
| `leading` | `"none"` \| `"tight"` \| `"snug"` \| `"normal"` \| `"relaxed"` \| `"loose"` |
| `tracking` | `"tighter"` \| `"tight"` \| `"normal"` \| `"wide"` \| `"wider"` \| `"widest"` |
| `textDecoration` | `"underline"` \| `"line-through"` \| `"no-underline"` |
| `textTransform` | `"uppercase"` \| `"lowercase"` \| `"capitalize"` |
| `uppercase` | `true` — shorthand for textTransform uppercase |
| `lowercase` | `true` — shorthand for textTransform lowercase |
| `textOverflow` | `"truncate"` |
| `whitespace` | `"nowrap"` \| `"pre"` \| `"normal"` |
| `wordBreak` | `"all"` \| `"words"` \| `"keep"` |

### Border & shape

| key | values |
|-----|--------|
| `border` | number (px width) |
| `borderStyle` | `"solid"` \| `"dashed"` \| `"dotted"` \| `"none"` |
| `borderColor` | hex / css color string |
| `radius` | number (px) — use `999` for pill/circle |
| `radiusTL` `radiusTR` `radiusBR` `radiusBL` | number (px) |

### Position & z

| key | values |
|-----|--------|
| `position` | `"relative"` \| `"absolute"` \| `"fixed"` \| `"sticky"` \| `"static"` |
| `absolute` | `true` — shorthand for position absolute |
| `relative` | `true` — shorthand for position relative |
| `fixed` | `true` — shorthand for position fixed |
| `sticky` | `true` — shorthand for position sticky |
| `inset0` | `true` — inset: 0 |
| `top` `right` `bottom` `left` | number (px) |
| `z` | number |

### Misc

| key | values |
|-----|--------|
| `overflow` | `"hidden"` \| `"auto"` \| `"visible"` \| `"scroll"` |
| `cursor` | `"pointer"` \| `"default"` \| `"not-allowed"` \| `"grab"` \| `"move"` \| `"text"` |
| `opacity` | number (0–1) |
| `objectFit` | `"cover"` \| `"contain"` \| `"fill"` \| `"none"` |
| `shadow` | `"sm"` \| `"md"` \| `"lg"` \| `"xl"` \| `"2xl"` \| `"none"` |

### Dynamic SxProp

Any SxProp value can be dynamic using `{ "js": "expr" }`:

```json
"bg": { "js": "isActive ? '#007AFF' : '#333333'" }
```

Dynamic `{ "js": "..." }` values are resolved at render time.

### Responsive — desktop-first, breakpoints as sibling props

Base props apply to all screens. Override smaller screens with `xl`, `lg`, or `md` sibling props inside `props`:

| sibling key | applies when viewport is |
|-------------|--------------------------|
| `xl` | ≤ 1280px |
| `lg` | ≤ 1024px |
| `md` | ≤ 768px |

```json
{
  "type": "Box",
  "props": {
    "p": 40,
    "lg": { "p": 24 },
    "md": { "p": 16 }
  }
}
```

- The base value (`"p": 40`) covers desktop and above.
- `lg` and `md` objects accept the same flat SxProps keys as base `props`.
- There is **no** `{ "default": ... }` per-key wrapper — use the sibling format above.

---

## Animation — hover/press/scroll styles

For interactive state styling (color change on hover, scale on press, etc.) write `hover`, `press`, or `scroll` directly in `props` alongside other SxProp keys. Any SxProp key inside the object is converted to CSS automatically:

```json
"props": {
  "bg": "#6366f1",
  "cursor": "pointer",
  "hover": { "bg": "#4f46e5", "scale": 1.02, "duration": 150 },
  "press": { "scale": 0.97, "opacity": 0.85, "duration": 100 }
}
```

SxProp keys (`bg`, `textColor`, `borderColor`, `opacity`, `radius`, etc.) go into `styles`. Animation-control keys (`scale`, `opacity` as number, `duration`, `easing`, `y`, `x`) stay flat on the phase.

## Animation — enter/exit/loop/scroll (motion)

For entrance animations, looping effects, and scroll-triggered transitions use `props.animation`:

```json
"animation": {
  "enter": {
    "type": "fadeIn",
    "duration": 400,
    "delay": 0,
    "easing": "easeOut",
    "stagger": 80
  },
  "exit": {
    "type": "fadeOut",
    "duration": 300
  },
  "loop": {
    "type": "pulse",
    "duration": 1500,
    "repeatCount": -1
  },
  "scroll": {
    "type": "slideInUp",
    "duration": 500,
    "threshold": 0.2,
    "once": true
  }
}
```

**Enter types:** `fadeIn` | `slideInUp` | `slideInDown` | `slideInLeft` | `slideInRight` | `zoomIn` | `bounceIn` | `flipInX` | `blurIn` | `glowIn` | `revealUp` | `dropIn` | `riseFade`  
**Exit types:** `fadeOut` | `slideOutUp` | `slideOutDown` | `slideOutLeft` | `slideOutRight` | `zoomOut` | `blurOut`  
**Loop types:** `pulse` | `breathe` | `float` | `flash` | `spin` | `shake` | `wiggle` | `bounce` | `heartbeat` | `glowPulse`  
**Easing:** `linear` | `easeIn` | `easeOut` | `easeInOut` | `backIn` | `backOut` | `backInOut`

---

## Popover — floating panel / dropdown / tooltip

Add a `popover` config to any `Box` node to turn it into a trigger for a floating panel (dropdown menu, context menu, tooltip, etc.). One child of that node must have `"_popoverContent": true` — it renders in the float, not inline.

```json
{
  "type": "Box",
  "props": { "cursor": "pointer", "row": true, "items": "center", "gap": 8 },
  "popover": {
    "trigger": "click",
    "placement": "bottom-start",
    "offset": 4,
    "closeOnOutsideClick": true,
    "closeOnEscape": true,
    "matchTriggerWidth": false
  },
  "children": [
    {
      "type": "Text",
      "props": { "text": 14 },
      "text": "Options"
    },
    {
      "type": "Box",
      "_popoverContent": true,
      "props": { "col": true, "bg": "#ffffff", "radius": 8, "shadow": "lg", "p": 8, "minW": 160 },
      "children": [
        { "type": "Text", "props": { "text": 14, "p": 8, "cursor": "pointer" }, "text": "Edit" },
        { "type": "Text", "props": { "text": 14, "p": 8, "cursor": "pointer" }, "text": "Delete" }
      ]
    }
  ]
}
```

**`popover` fields:**

| field | type | default | notes |
|---|---|---|---|
| `trigger` | `"click"` \| `"hover"` | required | what opens the panel |
| `placement` | string | `"bottom"` | `top` \| `bottom` \| `left` \| `right`, each with optional `-start` or `-end` suffix |
| `offset` | number | `4` | px gap between trigger and panel |
| `closeOnOutsideClick` | boolean | `true` | close when clicking outside |
| `closeOnEscape` | boolean | `true` | close on Escape key |
| `matchTriggerWidth` | boolean | `false` | panel min-width matches trigger — useful for select dropdowns |
| `openVariable` | UUID string | — | syncs open/close state to a store variable for programmatic control |
| `componentId` | string | — | use a shared component as the floating content instead of an inline `_popoverContent` child |

**Rules:**
- The `_popoverContent` child is **not** rendered in the normal child flow — it always appears in the floating panel.
- Use `"trigger": "hover"` for tooltips.
- For a `select`-style dropdown, set `matchTriggerWidth: true`.
- `openVariable` UUID must point to a boolean variable; the popover reads and writes it automatically.

---

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
- Inside content, access props via `context.component.props.<name>` and local variables via `context?.component?.variables?.['<uuid>']` (always use the UUID from the variable file's `id` field, not the name)
- **Prefer a shared component when a UI block repeats within a page or is reused across pages.** Create the component once, then place instances (with `_shared: { id, name }`) instead of duplicating the node tree. This keeps `page.json` small and changes localized.
- **SC-internal state**: if a variable or workflow is only needed inside this SC, create it under `components/<id>/store/` and `components/<id>/workflows/` — never in global `store/` or `workflows/`. Examples of SC-only state: display value, active tab, open accordion, carousel index, form step.

**SC-internal variable + workflow — file structure:**
```
components/sc-card/store/isOpen.json      ← { "id": "uuid-sc-open",   "name": "isOpen",   ... }
components/sc-card/store/activeTab.json   ← { "id": "uuid-sc-tab",    "name": "activeTab", ... }
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

---

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

### Step types (config shapes)

| type | key config fields |
|------|-------------------|
| `changeVariableValue` | `variableName` (UUID from the variable's `id` field), `value` (literal or `{ js }`) |
| `resetVariableValue` | `variableName` (UUID) |
| `branch` | `condition: { js }` + top-level `trueBranch: []`, `falseBranch: []` |
| `multiOptionBranch` | `condition: { js }` + top-level `branches: [{ label, steps }]`, `defaultBranch: []` |
| `navigateTo` | `path` (route), `linkType: "internal"\|"external"`, `newTab`, optional `queryParams: { key: value }` to set/merge URL query params (use `null` to remove a param). Hardcode the destination path or embed JS inline — do NOT create a shared "navigate" helper workflow whose only job is calling navigateTo. |
| `runJavaScript` | **code must be nested under `config`**: `{ "type": "runJavaScript", "config": { "code": "..." } }`. Globals: `variables` (writable; UUID or name), `parameters` (params from the calling action), `fns`, `wwLib`, `context` |
| `fetchData` | `url`, `method`, `headers`, `body` (all support `{ "js": "…" }` expressions). Result at `context.workflow['stepId'].result`. Use for ad-hoc HTTP calls (login, API mutations, etc.) |
| `fetchCollection` | `collectionId` (datasource UUID from `data/<id>.json`) — triggers a named datasource refetch |
| `forEach` | `items: { js }` + top-level `loopBody: []` |
| `whileLoop` | `condition: { js }` + top-level `loopBody: []` |
| `timeDelay` | `ms` |
| `runProjectWorkflow` | `workflowId` (UUID from the workflow's `id` field), `params: {}` |
| `returnValue` | `value` |
| `passThroughCondition` | `condition: { js }` — no-op if true; short-circuits (stops) the workflow if false |
| `copyToClipboard` | `text` |
| `scrollToElement` | `targetNodeId` (node `name` field) |
| `controlAnimation` | `targetNodeId`, `action: "trigger"\|"exit"\|"startLoop"\|"stopLoop"` |

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

---

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

---

## Routes entity — `routes.json`

```json
{
  "routes": [
    { "path": "/dashboard", "config": "dashboard", "name": "Dashboard" },
    { "path": "/items/:id", "config": "itemDetail", "name": "Item Detail" },
    { "path": "/", "config": "home", "name": "Home" }
  ]
}
```

- Every page MUST have a route entry — without one, the page is unreachable.
- `config` = the page name (VFS folder name under `pages/`).
- Use `:paramName` in `path` for dynamic segments. Read params in formulas via `route?.<paramName>` or `globalContext?.browser?.params?.<paramName>`.

### List→detail navigation: always carry the item ID

When navigating from a list to a detail or edit page you **must** pass the item's ID. Two valid patterns — choose either:

**Option A — path param** (cleaner URL):
```json
// routes.json
{ "path": "/products/:id", "config": "productDetail" }

// navigateTo step config
{ "path": { "js": "'/products/' + context.item.data.id" }, "linkType": "internal" }

// on the detail page — read the ID
// formula:  route?.id   OR  globalContext?.browser?.params?.id
// datasource url: { "js": "'/products/' + route?.id" }
```

**Option B — query param** (static route is fine):
```json
// routes.json
{ "path": "/productdetail", "config": "productDetail" }

// navigateTo step config
{ "path": "/productdetail", "linkType": "internal", "queryParams": { "id": { "js": "context.item.data.id" } } }

// on the detail page — read the ID
// formula:  globalContext?.browser?.query?.id
// datasource url: { "js": "'/products/' + globalContext?.browser?.query?.id" }
```

Never navigate to a detail/edit page without embedding the ID in the path or query params. A detail page that reads an ID that was never passed will always get `undefined`.

---

## Datasource entity — `data/<id>.json`

```json
{
  "id": "items",
  "name": "Items",
  "type": "rest",
  "url": "/items",
  "method": "GET",
  "trigger": "mount"
}
```

- `folder`: optional grouping label; omit if no folder

---

## Formula entity — `utils/<name>.json`

```json
{
  "name": "formatDate",
  "description": "Format a date value for display",
  "formula": "new Date(parameters?.['value']).toLocaleDateString()",
  "params": [
    { "name": "value", "type": "String", "testValue": "2024-01-15" }
  ]
}
```

---

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

---

## Design theme — `design/theme.json`

```json
{
  "overrides": {
    "--primary": "#6366f1",
    "--background": "#0f0f0f"
  },
  "darkOverrides": {
    "--primary": "#818cf8"
  }
}
```

**CSS variable naming**: each theme token `"--primary": "#6366f1"` generates two CSS variables at runtime:
- `--primary` — an RGB triplet (e.g. `30 41 59`) used internally by Tailwind for opacity utilities (`bg-primary/50`)
- `--theme-primary` — the original hex value (`#6366f1`) for direct CSS references

**Always use the `--theme-` prefixed variable** when referencing a theme color in SxProps or inline CSS:
```json
"bg": "var(--theme-primary)",
"textColor": "var(--theme-foreground)"
```
Using `var(--primary)` directly will produce a broken color because `30 41 59` is not a valid CSS color string.

---

## Media tool

Use `search_media` before using any `Image`, `Icon`, or `Video` node to find the correct URL or icon name.

---

## How to reference entities in actions

Always reference workflows by their UUID `id` field — never by path string.

Node `actions` array:
```json
"actions": [
  { "workflowId": "wf-a1b2c3d4-1111-4aaa-8bbb-000000000001", "trigger": "click" },
  { "workflowId": "wf-global-uuid-here", "params": { "mode": "add" }, "trigger": "click" }
]
```

Workflow step calling another global workflow:
```json
{ "type": "runProjectWorkflow", "config": { "workflowId": "wf-global-uuid-here", "params": { "mode": "reset" } } }
```
---

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

