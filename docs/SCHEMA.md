# SDUI Schema Reference

**Purpose:** This document defines the JSON schema for building screens, layouts, fragments, and actions. Use it when generating or modifying config files.

---

## 1. Project Structure

```
config/
├── app.ts              # Merges all config, resolves $slot
├── routes.json         # Paths, redirects, auth, layout
├── screens/            # One .json per screen
├── layouts/            # Layout structures (authenticated.json)
├── fragments/          # Reusable UI (header, drawer, modals/*)
└── actions/            # Action definitions (auth, products, layout, other)
```

**To add a screen:** Create `screens/myScreen.json`, add route in `routes.json`, import in `app.ts`.

---

## 2. Screen Schema

### Option A: Screen with layout (header + drawer)

```
layout: "authenticated"  → wraps content with header + drawer
content: { ... } or [ ... ]  → injected into layout's $slot
```

```json
{
  "meta": { "title": "Dashboard", "description": "..." },
  "state": { "modal": { "create": false } },
  "layout": "authenticated",
  "content": { "type": "Box", "children": [...] }
}
```

### Option B: Screen without layout (standalone)

```
ui: { ... }  → direct root
```

```json
{
  "meta": { "title": "Login" },
  "state": { "form": { "email": "", "password": "" } },
  "ui": { "type": "Box", "children": [...] }
}
```

### Screen fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| meta | object | no | title, description |
| state | object | no | Initial state (form, modal, etc.) |
| layout | string | no | "authenticated" or omit |
| content | node or array | if layout | Content for $slot |
| ui | node | if no layout | Root UI tree |

---

## 3. UI Node Schema

Every UI node has:

| Field | Type | Description |
|-------|------|-------------|
| type | string | Component: Box, Text, HStack, VStack, Input, Heading, Icon, Image, etc. |
| props | object | Component props (className, size, variant, etc.) |
| children | array | Child nodes |
| text | string | Text content (use with {{variable}} interpolation) |
| condition | JSON Logic | Render only when truthy |
| map | string | State path to array; renders node per item |
| actions | object | Event handlers: click, change, etc. |
| $slot | string | Layout placeholder: "content" |
| _shared | object | Shared component marker: `{ "id": "sc-product-card", "name": "Product Card" }` |
| id | string | **Anchor ID** — stable identifier for element-level edits (Tier 1–2). Required on key nodes in section library variants. See Section Library below. |

### Anchor ID Convention (Section Library)

Key nodes in reusable sections should carry a stable `id` attribute so the builder can locate and target them programmatically.

**Standard IDs by section:**

| Section | Required IDs |
|---------|-------------|
| Hero | `hero-section`, `hero-heading`, `hero-subheading`, `hero-image`, `hero-cta-primary` |
| Product Grid | `product-grid-section`, `product-grid-title`, `product-grid-view-all` |
| Carousel | `product-carousel-section`, `carousel-title`, `carousel-card` |
| Categories | `categories-section`, `categories-title`, `category-card` |
| Newsletter | `newsletter-section`, `newsletter-heading`, `newsletter-input`, `newsletter-submit` |
| Testimonials | `testimonials-section`, `testimonials-title`, `testimonial-card` |
| Flash Sale | `flash-sale-section`, `flash-sale-title`, `flash-sale-timer` |
| Brand Story | `brand-story-section`, `brand-story-heading`, `brand-story-body` |

**The `id` field on a node is NOT rendered as HTML `id`** — it's used by the builder to traverse the JSON tree programmatically.

**Rules:**
- `id` values must be unique within a page
- Use kebab-case with section-type prefix: `hero-cta-primary`, `newsletter-input`
- Do NOT add `id` to every node — only key anchor points (headings, CTAs, images, section roots, form inputs)

### Linked instance markers

The builder writes a small set of metadata keys onto nodes that are instances of a Shared Component. **These are builder-managed — AI and hand-authored JSON should never produce them.**

| Field | Type | Meaning |
|-------|------|---------|
| `_shared` | `{ id, name }` | Marks the root of a Shared Component instance. `id` is the model id in `config/shared-components.json`. |
| `_sharedKey` | `string (uuid)` | Stable per-node identity inside a linked subtree. Stamped on every node of the model content at module init; cloned verbatim to instances so the sync engine can pair instance nodes to model nodes even after the user edits local copies. |
| `_overrides` | `object` | Per-instance overrides (props, classNames, deleted/added descendants) applied on top of the model's current content. Preserved across model edits by `_syncSharedInstances` in `app/dev/builder/_store.ts`. |
| `_popoverContent` | `boolean` | On a Box inside a node whose parent declares `popover`, marks that Box as the popover's content subtree. |

Only `_shared` and `_overrides` ever appear at a subtree root. `_sharedKey` appears on every node inside a linked subtree.

### Interpolation & inline formula

**String:** Use `{{path}}` to inject state:

- `{{form.email}}` – current screen's form (alias for `screens.{screenName}.form.email`)
- `{{screens.signup.form.password}}` – cross-screen: signup form from any screen
- `{{screens.shop.tabs.activeTab}}` – screen-scoped tabs
- `{{auth.user.name}}` – auth user
- `{{meta.title}}` – screen title (from meta)
- `{{layout.drawerOpen}}` – drawer state (Zustand)
- `{{route.path}}` – current path (/dashboard, /profile, etc.)
- `{{_workflow.lastAction}}` – last action name (e.g. "login", "fetchProductBySlug")
- `{{_workflow.lastError}}` – last action error (null if success); configurable via `engineConventions.workflowPath`
- `{{$item.name}}` – current item in map loop
- `{{$index}}` – index in map loop

**Global variable store (path conventions):**
- `screens.{screenName}.form.*` – Form values per screen (e.g. `screens.signup.form.password`)
- `screens.{screenName}.errors.*` – Validation errors per screen
- `screens.{screenName}.tabs.*` – Tab state (e.g. `screens.shop.tabs.activeTab`)
- `layout.*`, `auth.*`, `cart.*` – Global state from store.json
- Access any value from anywhere; only components using a path re-render when it changes

**Inline formula:** For derived values, use `{ "formula": <formula string>, "suffix"?, "prefix"?, "template"? }`:

```json
{ "type": "Text", "text": { "formula": "collections['a1b2c3d4']?.data?.activeOrder?.lines?.reduce((acc, l) => acc + (l.quantity || 1), 0)", "suffix": " items" } }
```

- `formula` – JavaScript formula string (evaluated against merged state)
- `suffix` – appended after result
- `prefix` – prepended before result
- `template` – e.g. `"{0} items"` replaces `{0}` with result

**Examples:**
- Cart count: `{ "formula": "collections['a1b2c3d4']?.data?.activeOrder?.lines?.reduce((acc, l) => acc + (l.quantity || 1), 0)", "suffix": " items" }`
- Subtotal: `{ "formula": "formatCurrency(collections['a1b2c3d4']?.data?.activeOrder?.subTotalWithTax / 100, 'AED')" }`
- Conditional: `{ "formula": "(collections['a1b2c3d4']?.data?.activeOrder?.lines?.length || 0) === 0 ? '—' : (collections['a1b2c3d4']?.data?.activeOrder?.shippingEstimate?.label || 'Free')" }`

**Inline JavaScript binding (`{ "js": "..." }`):** As an alternative to formula expressions, properties can be bound to a JavaScript function body. The value the function returns becomes the resolved value. Variables and collections are addressed by **name** (not UUID) via WeWeb-style proxies:

```json
{ "type": "Text", "text": { "js": "const items = collections.products.data ?? [];\nreturn `Total: $${items.reduce((s, p) => s + p.price, 0).toFixed(2)}`;" } }
{ "type": "Box",  "props": { "style": { "js": "return { backgroundColor: variables.cartCount > 0 ? '#10b981' : '#6b7280' };" } } }
```

Inside a `{ js }` body these globals are available: `variables.<name>`, `collections.<name>.data`, `context.item.<field>`, `parameters.<name>`, plus the helper API `wwLib.variables.get/set` (see §13). The body is evaluated synchronously (single-expression bodies auto-`return`).

### Condition (JSON Logic)

```json
{ "var": "showGradient" }
{ "==": [{ "var": "route.path" }, "/dashboard"] }
{ "!=": [{ "var": "route.path" }, "/dashboard"] }
{ "and": [{ ">": [{ "var": "count" }, 0] }, { "var": "isActive" }] }
```

### Map (loop)

```json
{
  "type": "Box",
  "map": "products.list",
  "key": "product",
  "children": [{ "type": "Text", "text": "{{context.item.data.name}}" }]
}
```

### Actions

```json
"actions": {
  "click": { "action": "navigate", "payload": { "path": "/dashboard" } },
  "change": { "action": "setState", "payload": { "path": "form.email", "value": "$event" } }
}
```

---

## 4. Layout Schema

Layouts define structure with `$slot` and inlined shared components:

```json
{
  "structure": {
    "type": "Box",
    "children": [
      { "type": "Box", "_shared": { "id": "sc-navbar", "name": "Navbar" }, "children": [...] },
      { "type": "Box", "children": [{ "$slot": "content" }] },
      { "type": "Box", "_shared": { "id": "sc-footer", "name": "Footer" }, "children": [...] }
    ]
  }
}
```

- `_shared` – marks a node as an instance of a shared component model (builder tracking)
- `$slot` – replaced with the screen's `content` when resolving the layout

---

## 5. Shared Component Schema

Shared components are reusable UI models defined in `config/shared-components.json`.

**Model format:**
```json
{
  "id": "sc-product-card",
  "name": "Product Card",
  "properties": [],
  "content": { "type": "Box", "children": [...] }
}
```

**Usage (inline at the usage site):**
```json
{ "type": "Box", "_shared": { "id": "sc-product-card", "name": "Product Card" }, "children": [...] }
```

The `_shared` marker is for the builder only — the runtime renders the inline content tree directly.

**Path format for `_shared.id`:** `sc-navbar`, `sc-footer`, `sc-product-card`, etc.

**Register:** Add to `config/fragments/index.ts`: `'fragments/name': import`

**Example fragment:** `config/fragments/modals/createProduct.json` – a single UI node (Modal, Box, etc.).

---

**Inner-element action bindings — bare ref (canonical):**

When an inner element of an SC (e.g. a day cell in `sc-datepicker`) invokes one of the SC's own workflows, write the `actions` entry as a bare ref:

```json
"actions": [
  { "action": "<wfId>" },
  { "action": "<wfId>", "args": { "paramName": { "formula": "context?.item?.data?.dateStr" } } }
]
```

The engine's `runOne` (`lib/sdui/sdui-engine.tsx`) performs an ambient-SC lookup: when the action name is not a top-level `actionsConfig` entry AND `scope.context.component.id` is set (rendering inside a `_shared` subtree), it resolves the name against the ambient model's `workflows` map and synthesizes an `executeComponentAction` definition so dispatch runs under the ambient `compInfo` (model + instance resolved automatically). Omit `args` entirely for parameterless workflows.

**Legacy fallback (do not author):** the inline-workflow wrapper shape `{ "type": "workflow", "steps": [{ "type": "executeComponentAction", "config": {...} }] }` still resolves correctly and is kept for older content, but new bindings should always use the bare ref above.

**Trigger model:** `ScopedWorkflow.trigger` accepts both lifecycle triggers (`created`, `mounted`, `propertyChange`, …) and DOM events (`click`, `doubleClick`, `keydown`, …). Lifecycle workflows surface in the Component Editor's Actions tab; DOM-event workflows surface in the right-panel Workflow tab while the SC is being edited.

**Custom triggers (component events):** A component can declare named events that parent pages listen to on each instance. Authored in the Component Editor's Triggers section and persisted on the model:

```json
"triggers": [
  { "id": "dp-t-on-date-selected", "name": "On date selected", "eventSchema": "{ \"date\": \"2026-01-15\" }" }
]
```

Fire from an internal workflow with an `emitComponentTrigger` step:

```json
{
  "type": "emitComponentTrigger",
  "config": {
    "triggerId": "dp-t-on-date-selected",
    "payload": { "formula": "{ date: context?.item?.data?.dateStr }" }
  }
}
```

Parent-page listener workflows bind on a specific instance with `trigger: "<triggerId>"` and read the payload via `context?.event?.<field>`. See the "Custom triggers" subsection in `.cursor/rules/visual-builder.mdc` for runtime plumbing and visibility rules.

For full implementation details (sync engine, instance operations, parser unwrap logic) see the Shared Components section in `.cursor/rules/visual-builder.mdc` and `docs/BUILDER-ARCHITECTURE.md`.

---

## 6. Action Schema

Actions live in `config/actions/*.json`. Reference by name: `{ "action": "login" }`.

**stopPropagation:** Add `"stopPropagation": true` to actions triggered from inside clickable parents (e.g. product card buttons) so the parent's click handler doesn't also fire. Example: `addToWishlistFromCard`, `quickAddToCart`, `openQuickView`.

### fetch

```json
{
  "type": "fetch",
  "url": "/api/products",
  "method": "GET",
  "storeFullResponseIn": "products._raw",
  "body": { "email": { "var": "form.email" } }
}
```

- `storeFullResponseIn` – optional; store the full raw API response

### graphql

Sends a GraphQL query or mutation. Always uses HTTP POST. Handles both HTTP errors and `errors` in the GraphQL response body.

```json
{
  "type": "graphql",
  "query": "query GetProducts($first: Int) { products(first: $first) { edges { node { id title handle } } } }",
  "variables": {
    "first": 20,
    "handle": { "formula": "globalContext?.browser?.query?.slug" }
  },
  "endpoint": "{{config.graphqlEndpoint}}",
  "headers": {
    "X-Shopify-Storefront-Access-Token": "{{config.storefrontToken}}"
  }
}
```

| Field | Description |
|-------|-------------|
| `query` | GraphQL query or mutation string |
| `variables` | Variables object; values support `{ "var": "path" }` and `{ "formula": "<JS expression>" }` |
| `endpoint` | GraphQL URL; supports `{{var}}` interpolation; falls back to `engineConventions.graphqlEndpoint` |
| `headers` | Per-action headers merged on top of `engineConventions.graphqlHeaders`; values support `{ "var": "path" }` |

**Global config in `store.json`:**

```json
{
  "engineConventions": {
    "graphqlEndpoint": "https://my-store.myshopify.com/api/2024-01/graphql.json",
    "graphqlHeaders": {
      "X-Shopify-Storefront-Access-Token": "your-token-here"
    }
  }
}
```

- Per-action `headers` always override `engineConventions.graphqlHeaders`
- Use `{{config.someToken}}` in headers if the token lives in store state (e.g. loaded from env at runtime)

### set (Zustand state)

```json
{
  "type": "set",
  "path": "layout",
  "value": { "drawerOpen": true }
}
```

### setState (screen state)

```json
{
  "action": "setState",
  "payload": { "path": "modal.create", "value": true }
}
```

### navigate

```json
{ "action": "navigate", "payload": { "path": "/dashboard" } }
```

### validate

Validates form fields. Stores errors in nested structure at `storeErrorsIn` (default `errors`).

| Rule | Description |
|------|-------------|
| `required` | Field must be non-empty |
| `minLength` | Minimum string length |
| `maxLength` | Maximum string length |
| `pattern: "email"` | Email format |
| `equals` | Must match fixed value |
| `equalsField` | Must match another field (e.g. `"form.password"` for confirm) |
| `message` | Error message when rule fails |

```json
{
  "type": "validate",
  "rules": {
    "form.email": { "required": true, "pattern": "email", "message": "Please enter a valid email" },
    "form.password": { "required": true, "minLength": 8, "message": "Password must be at least 8 characters" },
    "form.confirmPassword": { "required": true, "equalsField": "form.password", "message": "Passwords do not match" }
  },
  "storeErrorsIn": "errors"
}
```

### runMultiple

```json
{
  "type": "runMultiple",
  "actions": [
    { "action": "closeDrawer" },
    { "action": "navigate", "payload": { "path": "/dashboard" } }
  ]
}
```

### mergeArraysByKey

Merge two arrays by a key path (e.g. cart lines by `productVariant.id`). Config-driven—no app-specific logic in engine.

| Field | Description |
|-------|-------------|
| `targetPath` | Path to the object that has the array and receives the merged result |
| `sourcePath` | Path to the new data to merge in |
| `arrayPath` | Key of the array in both objects (default: `lines`) |
| `keyPath` | Dot path to get the merge key from each item (e.g. `productVariant.id`) |
| `aggregate` | When keys match, aggregate fields: `{ "quantity": "sum" }` |
| `recomputePerItem` | Recompute fields after merge: `{ "linePriceWithTax": { "multiply": ["unitPriceWithTax", "quantity"] } }` |
| `totalFields` | Recompute parent fields from merged array: `{ "totalQuantity": { "from": "lines", "field": "quantity" } }` |

```json
{
  "type": "mergeArraysByKey",
  "targetPath": "cart",
  "sourcePath": "cart._addResult",
  "arrayPath": "lines",
  "keyPath": "productVariant.id",
  "aggregate": { "quantity": "sum" },
  "recomputePerItem": { "linePriceWithTax": { "multiply": ["unitPriceWithTax", "quantity"] } },
  "totalFields": {
    "totalQuantity": { "from": "lines", "field": "quantity" },
    "subTotalWithTax": { "from": "lines", "field": "linePriceWithTax" },
    "totalWithTax": { "from": "lines", "field": "linePriceWithTax" }
  }
}
```

### appendToPath

Append to a nested array (e.g. `product.reviews`). Supports `{ "var": "path" }` and `{ "formula": "<JS expression>" }` in value. Special vars: `_timestamp`, `_date`.

```json
{
  "type": "appendToPath",
  "targetPath": "product.reviews",
  "value": {
    "id": { "formula": "'rev-' + _timestamp" },
    "author": "You",
    "rating": { "var": "reviewForm.rating" },
    "date": { "var": "_date" },
    "title": { "var": "reviewForm.title" },
    "body": { "var": "reviewForm.body" }
  },
  "resetFormPath": "reviewForm",
  "resetFormValue": { "rating": 0, "title": "", "body": "" }
}
```

---

## 7. Store Config & Derived Values

**`config/store.json`** – Initial state and path mappings:

| Key | Description |
|-----|-------------|
| initialData | Initial Zustand state (layout, cart, route, etc.) |
| paths | Optional key→path mapping (e.g. `authUser` → `auth.user`, `routePath` → `route.path`) |
| computed | Optional array of `{ output, formula }` for shared derived state |
| engineConventions | **Required** for apps using forms/fetch/workflow/graphql. No fallbacks in code—all values come from JSON: `loadingSuffix`, `errorSuffix`, `defaultStoreErrorsIn`, `workflowPath`, `screenScopedAliases`, `defaultFormPath`, `graphqlEndpoint` (default GraphQL URL), `graphqlHeaders` (default headers applied to all graphql actions) |

**Derived values – prefer inline formula:** For one-off computed values (cart count, subtotal, totals), use inline `text: { formula, suffix?, prefix?, template? }` in UI nodes. See §3 Interpolation & inline formula.

**Store-based computed (optional):** For values reused across many screens, add to `store.json`:

```json
"computed": [
  { "output": "cartCount", "formula": "collections['a1b2c3d4']?.data?.activeOrder?.lines?.reduce((acc, l) => acc + (l.quantity || 1), 0)" }
]
```

**JSON Logic:** `+`, `*`, `-`, `/`, `var`, `reduce`, `map`, `filter`, `if`, `cat`, etc. See [jsonlogic.com](https://jsonlogic.com/operations.html).

**Custom op:** `formatCurrency` (num, currency) – rounds and formats (e.g. `{"formatCurrency": [{"var": "cart.subtotal"}, "AED"]}`).

---

## 8. Route Schema

`config/routes.json`:

```json
{
  "defaultRedirect": "/login",
  "routes": [
    { "path": "/dashboard", "config": "dashboard", "auth": true, "layout": "full" },
    { "path": "/login", "config": "login", "auth": false, "layout": "centered" }
  ]
}
```

| Field | Description |
|-------|-------------|
| path | URL path |
| config | Screen name (matches config key in app.ts) |
| auth | true = requires auth |
| layout | "full" = authenticated layout, "centered" = centered |
| redirect | Redirect path (no config) |

---

## 9. Form Schema

Form must wrap FormInputWithLabel and FormSubmitButton. FormSubmitButton must be a child of Form.

```json
{
  "type": "Form",
  "props": {
    "defaultValues": { "form": { "product": { "var": ["form.product", {}] } } },
    "validationRules": {
      "form.product.name": { "required": true, "minLength": 2 },
      "form.product.price": { "required": true, "min": 0 }
    },
    "submitAction": "createProduct"
  },
  "children": [
    { "type": "Box", "children": [/* FormInputWithLabel */] },
    { "type": "ModalFooter", "children": [
      { "type": "Box", "children": [{ "type": "Text", "text": "Cancel" }], "actions": [{ "action": "closeCreateModal" }] },
      { "type": "FormSubmitButton", "props": { "action": "primary" }, "text": "Save" }
    ]}
  ]
}
```

---

## 10. Modal Schema

```json
{
  "type": "Modal",
  "props": {
    "isOpen": "{{modal.create}}",
    "onClose": { "action": "closeCreateModal" },
    "closeOnOverlayClick": true
  },
  "children": [
    { "type": "ModalBackdrop", "actions": { "click": { "action": "closeCreateModal" } } },
    { "type": "ModalContent", "children": [...] }
  ]
}
```

---

## 11. Available Components

All components from `@/components/ui/*` are supported. Use `type` in JSON to reference them.

### Layout
| Component | Description |
|-----------|-------------|
| Box | Flex container, base layout — use for any container, card surface, divider, or clickable area |
| HStack | Horizontal stack |
| VStack | Vertical stack |
| Center | Centered content |
| Grid | CSS grid layout |
| GridItem | Grid cell |

### Typography
| Component | Description |
|-----------|-------------|
| Text | Body text |
| Heading | Headings (size: xs–6xl) |

### Interactive
| Component | Description |
|-----------|-------------|
| Box | Any clickable/actionable container. Add actions array with a named workflow. Use `className` for all styling. |
| Link | `Box` with `cursor-pointer` and a `Text` child. Navigate via a `click` action workflow. |

### Form
| Component | Description |
|-----------|-------------|
| FormContainer | Form wrapper |
| Input | Text input (`InputWithField` — no children needed; pass placeholder, name, type, value directly as props) |
| Checkbox | Checkbox (value required) |
| CheckboxGroup | Checkbox group |
| CheckboxIndicator | Checkbox indicator |
| CheckboxLabel | Checkbox label |
| Switch | Toggle switch |
| Textarea | Multi-line input |
| TextareaInput | Textarea field |
| Radio | Radio option (value required) |
| RadioGroup | Radio group |
| RadioIndicator | Radio indicator |
| RadioLabel | Radio label |
| Select | Dropdown select |
| SelectTrigger | Select trigger |
| SelectInput | Select input |
| SelectPortal | Select portal |
| SelectBackdrop | Select backdrop |
| SelectContent | Select content |
| SelectDragIndicator | Select drag indicator |
| SelectDragIndicatorWrapper | Wrapper for drag indicator |
| SelectItem | Select option (label, value required) |
| SelectScrollView | Select scroll container |
| SelectVirtualizedList | Virtualized list for select |
| SelectFlatList | Flat list for select |
| SelectSectionList | Section list for select |
| SelectSectionHeaderText | Section header text |

### Data display
| Component | Description |
|-----------|-------------|
| Skeleton | Loading skeleton |
| SkeletonText | Skeleton text |
| Progress | Progress bar |
| ProgressFilledTrack | Progress fill |

> **Note:** Card, Badge, Avatar, Alert, Table, Divider are replaced by `Box` + `Text` + `Icon` + `className`. Use Box with border/bg/rounded for cards and surfaces, Box with h-px for dividers, and Box + Text for badges/pills.

### Overlay
| Component | Description |
|-----------|-------------|
| Tooltip | Tooltip (needs trigger) |
| TooltipContent | Tooltip content |
| TooltipText | Tooltip text |

### Feedback & media
| Component | Description |
|-----------|-------------|
| Spinner | Loading spinner |
| Icon | Icon (Iconify format: `set:name`, e.g. `lucide:search`) |
| Image | Image (src, alt) |

### Scroll & layout
| Component | Description |
|-----------|-------------|
| ScrollView | Scrollable container |
| SafeAreaView | Safe area wrapper |

### Accordion
| Component | Description |
|-----------|-------------|
| Accordion | Accordion container |
| AccordionItem | Accordion item (value, children) |
| AccordionHeader | Accordion header |
| AccordionTrigger | Accordion trigger |
| AccordionContent | Accordion content |

### Slider
| Component | Description |
|-----------|-------------|
| Slider | Slider input |
| SliderThumb | Slider thumb |
| SliderTrack | Slider track |
| SliderFilledTrack | Slider filled track |

---

## 12. Node Animation (`props.animation`)

Any SDUI node can be animated by adding an `animation` object to its `props`. The renderer wraps it in an `AnimatedNode` driven by React Native Reanimated.

> **Builder rule:** In the AI builder, always use the `set_animation` tool — never write raw animation JSON. The tool merges into existing config so only pass what you want to change.

```json
{
  "type": "Box",
  "props": {
    "className": "w-[64px] h-[64px] rounded-[9999px] bg-yellow-400",
    "animation": { "enter": { "type": "fadeIn", "duration": 400 } }
  }
}
```

### Enter animation

Plays once when the node mounts.

| Field | Description | Default |
|---|---|---|
| `type` | Enter type (see full list below) | — |
| `duration` | ms | `300` |
| `delay` | ms before starting | `0` |
| `stagger` | ms per-child offset for mapped lists (set on the container) | `0` |
| `easing` | CSS easing string | `"ease"` |
| `spring` | boolean — use spring physics instead of timing | `false` |

**All enter types:**
`fadeIn`, `slideInUp`, `slideInDown`, `slideInLeft`, `slideInLeftSubtle`, `slideInRight`,
`riseFade`, `dropIn`, `zoomIn`, `expandIn`, `bounceIn`,
`flipInX`, `flipInY`, `flipIn3D`, `tiltIn`, `skewIn`, `skewInY`,
`blurIn`, `glowIn`, `rollIn`, `revealUp`, `charFall`, `charBounce`

Unknown types fall back to `opacity: 0 → 1`.

### Stagger (mapped lists)

Set `enter.stagger` on the **parent container** node. Each child's delay is automatically offset by `stagger × $index`. Do NOT set stagger on individual child nodes.

```json
"animation": {
  "enter": { "type": "slideInUp", "duration": 400, "stagger": 80 }
}
```

### Exit animation

Plays when the node unmounts (requires conditional rendering via `condition`).

| Field | Description |
|---|---|
| `type` | Exit type (confirmed-working, see list below) |
| `duration` | ms (default `300`) |

**Confirmed-working exit types:**
`fadeOut`, `slideOutUp`, `slideOutDown`, `slideOutLeft`, `slideOutRight`,
`zoomOut`, `shrinkOut`, `blurOut`, `skewOut`

### Loop animation

Continuously repeats while the node is mounted.

| Field | Description | Default |
|---|---|---|
| `type` | Loop type (see table below) | — |
| `duration` | ms per cycle | `1500` |
| `repeatCount` | number of repeats; `-1` = infinite | `-1` |
| `direction` | `"normal"` or `"alternate"` | `"alternate"` |
| `color` | CSS color for shadow-based types (`glowPulse`, `ripple`) | `"#a855f7"` |

**All loop types:**

| `type` | Effect |
|---|---|
| `pulse` | Opacity 1 → 0.6, alternate |
| `breathe` | Scale 1 → 1.06, alternate |
| `float` | TranslateY 0 → -10px, alternate |
| `flash` | Opacity 1 → 0, alternate |
| `shake` | Fast left/right shake burst |
| `wiggle` | Gentle left/right wiggle |
| `wobble` | Side-to-side arc |
| `swing` | Rotate ±15°, alternate |
| `spin` | Continuous 360° rotation |
| `ticker` | Same as spin |
| `bounce` | TranslateY bounce |
| `heartbeat` | Fast double-pulse scale |
| `ripple` | Shadow ring expands outward and fades. Requires `color`. |
| `glowPulse` | Expanding box-shadow halo. Requires `color`. Add `outerStyle: { borderRadius: N }` to match inner shape. |
| `gradientDrift` | Drifts `backgroundPosition` left ↔ right. **Requires** gradient on `animation.outerStyle` — see below. |

**`glowPulse` example:**
```json
{
  "type": "Box",
  "props": {
    "className": "w-[64px] h-[64px] rounded-[9999px] bg-yellow-400",
    "animation": {
      "outerStyle": { "borderRadius": 9999 },
      "loop": { "type": "glowPulse", "duration": 1500, "repeatCount": -1, "direction": "alternate", "color": "#facc15" }
    }
  }
}
```

**`gradientDrift` example:**
```json
{
  "type": "Box",
  "props": {
    "className": "rounded-[8px] flex items-center justify-center",
    "animation": {
      "outerStyle": {
        "backgroundImage": "linear-gradient(to right, #667eea, #764ba2, #f64f59, #c471ed, #667eea)",
        "backgroundSize": "400% 100%",
        "backgroundRepeat": "no-repeat",
        "borderRadius": 8
      },
      "loop": { "type": "gradientDrift", "duration": 3000, "repeatCount": -1 }
    }
  }
}
```

**Why `outerStyle` for gradientDrift:** Reanimated animates `backgroundPosition` on the `Animated.View` wrapper. The gradient must be on the same element Reanimated controls (`animation.outerStyle`), not on `props.style` (the inner element).

### Hover animation

Fields on `HoverConfig`: `scale`, `opacity`, `y`, `duration`, `easing`. No `type` or `value` fields.

```json
"animation": {
  "hover": { "scale": 1.05, "duration": 200 }
}
```

### Press animation

Fields on `PressConfig`: `scale`, `opacity`, `x`, `y`, `duration`, `easing`. No `type` or `value` fields.

```json
"animation": {
  "press": { "scale": 0.95, "duration": 100 }
}
```

### Scroll-triggered enter

Fires the enter animation when the element scrolls into the viewport.

```json
"animation": {
  "scroll": { "type": "slideInUp", "duration": 400, "threshold": 0.2, "once": true }
}
```

### Shimmer

Loading skeleton shimmer sweep effect.

```json
"animation": {
  "shimmer": { "baseColor": "#e5e7eb", "highlightColor": "#f9fafb", "duration": 1500 }
}
```

### Imperative trigger

Re-plays a one-shot animation whenever a variable changes. Useful for shaking an input on validation error.

```json
"animation": {
  "imperativeTrigger": {
    "type": "shake",
    "watchVar": "variables['UUID']",
    "duration": 500
  }
}
```

- `watchVar` is a **formula expression** (not a template string) — e.g. `"variables['UUID']"`.
- Use `changeVariableValue` with `formula: "Date.now()"` to guarantee a new value on every trigger.

### States machine

Animates smoothly between named visual states. Powers carousels, tabs, and any multi-state element.

```json
"animation": {
  "states": {
    "watchVar": "variables['UUID']",
    "defaultState": "idle",
    "duration": 300,
    "easing": "ease",
    "states": {
      "idle":   { "opacity": "1", "scale": "1" },
      "active": { "opacity": "1", "scale": "1.05", "backgroundColor": "#7c3aed" },
      "hidden": { "opacity": "0", "scale": "0.8" }
    }
  }
}
```

- `watchVar` is a formula expression that resolves to the current state name string.
- State values are CSS-like strings: `opacity`, `scale`, `translateX`, `translateY`, `backgroundColor`, `borderRadius`, `width`, `height`.

### Split text

Animates text character-by-character, word-by-word, or line-by-line. The renderer auto-fills `text` and `className` from the node if not set.

```json
"animation": {
  "splitText": {
    "split": "char",
    "type": "charFall",
    "duration": 400,
    "stagger": 30,
    "delay": 0
  }
}
```

| `split` | Effect |
|---|---|
| `"char"` | Animate each character |
| `"word"` | Animate each word |
| `"line"` | Animate each line |

### Outer style / class

Applied to the `Animated.View` wrapper (not the inner component). Required for `gradientDrift`, `glowPulse` shape-matching, and CSS properties Reanimated should own.

```json
"animation": {
  "outerStyle": { "borderRadius": 9999, "overflow": "hidden" },
  "outerClassName": "absolute inset-0"
}
```

---

## 13. JavaScript bindings & `runJavaScript` workflow step

Two places accept user-written JavaScript:

1. **`{ "js": "..." }` bindings** — evaluated synchronously when a property is read. Replaces / augments the existing `{ "formula": "..." }` shape on any prop, prop.style, condition, etc.
2. **`runJavaScript` workflow step** — async function body run as part of a workflow. Result is stored at `context.workflow["<stepId>"].result` like every other step.

### Globals available in JS code

| Global | Description |
| --- | --- |
| `variables.<name>` | Read (and in `runJavaScript`, write) variables by their human-readable name. Resolves through the variable-name registry to the underlying UUID. |
| `collections.<name>` | The live `{ data, error, isFetching }` snapshot of the named datasource. |
| `context.item.<field>`, `context.workflow[stepId].result` | Same shapes as in formula expressions. |
| `parameters.<name>` | Global-workflow parameters. |
| `wwLib` | Helper API (see below). |

### `wwLib` helper API

`wwLib` exposes typed wrappers around every workflow `ActionStepType` so a single `runJavaScript` step can do everything the canvas can. Each typed helper synthesizes a one-step workflow internally and routes through the canvas dispatcher (`runSteps`), so behavior matches a regular step exactly (including `context.workflow[id]` being populated).

```js
// ── State ────────────────────────────────────────────────────────────
wwLib.variables.get('cartCount')                  // read by human name
wwLib.variables.set('cartCount', 5)               // write (runJavaScript only)
wwLib.variables.reset('cartCount')                // reset to null
wwLib.collections.get('products')                 // { data, error, isFetching }
await wwLib.collections.refetch('products')       // refetchDataSource
await wwLib.collections.update('products', 'add', { id, name }, 'id') // updateCollection

// ── Navigation ───────────────────────────────────────────────────────
await wwLib.navigate.to({ path: '/home', queryParams: { from: 'js' } })
await wwLib.navigate.to({ linkType: 'external', externalUrl: 'https://x.com', newTab: true })
await wwLib.navigate.prev('/fallback')            // navigatePrev

// ── Workflows ────────────────────────────────────────────────────────
const out = await wwLib.workflows.run('jsDemoIncrementCart', { delta: 5 })
await wwLib.workflows.return(out)                 // returnValue (early-return host workflow)

// ── Component actions / triggers ─────────────────────────────────────
await wwLib.components.run(instanceId, workflowId, { foo: 1 })   // executeComponentAction
await wwLib.components.emit(instanceId, 'onClick', { x, y })      // emitComponentTrigger

// ── Shared component dynamic CRUD ────────────────────────────────────
await wwLib.shared.add('toast', { title: 'Hi' })  // addSharedComponent
await wwLib.shared.delete(instanceId)             // deleteSharedComponent
await wwLib.shared.deleteAll('toast')             // deleteAllSharedComponents

// ── Popovers ─────────────────────────────────────────────────────────
await wwLib.popovers.open('id') / .close('id') / .toggle('id')

// ── Forms ────────────────────────────────────────────────────────────
await wwLib.forms.setState(formId, { valid: true })
await wwLib.forms.reset(formId)

// ── Auth ─────────────────────────────────────────────────────────────
await wwLib.auth.authenticate({ url, method, body, tokenPath, userPath, persist })
await wwLib.auth.setUser({ id, email })
await wwLib.auth.restoreSession()
await wwLib.auth.clearSession()

// ── Files / browser ──────────────────────────────────────────────────
await wwLib.files.upload({ url, file, fieldName, headers })
await wwLib.files.download('https://…/foo.pdf', 'foo.pdf')
await wwLib.files.encodeBase64(file)
await wwLib.files.fromBase64(base64, 'image/png', 'pixel.png')
await wwLib.clipboard.copy('text')
await wwLib.scroll.to(elementId, { behavior: 'smooth' })
await wwLib.print.pdf({ elementId, filename })
await wwLib.event.stopPropagation()
await wwLib.timing.delay(800)

// ── Generic escape hatch (any ActionStepType) ────────────────────────
await wwLib.actions.run({ type: 'copyToClipboard', config: { text: 'hi' } })
await wwLib.actions.runRaw({ type: 'graphql', query: '…' })   // raw SDUI action

// ── Read-only ────────────────────────────────────────────────────────
wwLib.workflow['stepId'].result    // prior step results
wwLib.parameters.someParam         // current workflow parameters
```

**Sync `{ js }` bindings** see the same `wwLib` object but `wwLib.<group>.<call>(...)` for action helpers throws `wwLib.<type>() is only available inside runJavaScript workflow steps, not in { js } bindings.` Bindings should remain pure reads (text/style/condition) — use `runJavaScript` for any side effect.

### Workflow step shape

```json
{
  "id": "step-1",
  "type": "runJavaScript",
  "name": "Compute total",
  "config": {
    "code": "const r = await fetch('/api/data');\nconst json = await r.json();\nreturn json.total * 1.05;"
  }
}
```

The body is wrapped in `new AsyncFunction(...)`, so `await` is supported. Single-expression bodies (no `;`, no `\n`, no `return`) auto-return their value. The return value is written to `context.workflow["step-1"].result` and can be read by downstream steps via `{ "formula": "context.workflow['step-1'].result" }` or `{ "js": "return context.workflow['step-1'].result;" }`.

---

## 14. Quick Reference: Adding a New Screen

1. Create `config/screens/myScreen.json`
2. Add route in `config/routes.json`
3. Import screen in `config/app.ts`

**With layout (header + drawer):**
```json
{ "meta": { "title": "My Screen" }, "layout": "authenticated", "content": {...} }
```

**Without layout:**
```json
{ "meta": { "title": "My Screen" }, "layout": "authenticated", "ui": {...} }
```

**With modals:** Use `content: [ mainContent, { "type": "Box", "_shared": { "id": "sc-my-modal", "name": "My Modal" }, "children": [...] } ]` — inline the modal content with `_shared` marker.
