# SDUI Schema Reference

**Purpose:** This document defines the JSON schema for building screens, layouts, fragments, and actions. Use it when generating or modifying config files.

---

## 1. Project Structure

```
config/
├── app.ts              # Merges all config, resolves $ref/$slot
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
| type | string | Component: Box, Text, HStack, VStack, Button, Card, Form, Modal, etc. |
| props | object | Component props (className, size, variant, etc.) |
| children | array | Child nodes |
| text | string | Text content (use with {{variable}} interpolation) |
| condition | JSON Logic | Render only when truthy |
| map | string | State path to array; renders node per item |
| actions | object | Event handlers: click, change, etc. |
| $ref | string | Reference fragment: "fragments/modals/createProduct" |
| $slot | string | Layout placeholder: "content" |
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

### Interpolation & inline expr

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

**Inline expr:** For derived values, use `{ "expr": <JSON Logic>, "suffix"?, "prefix"?, "template"? }`:

```json
{ "type": "Text", "text": { "expr": { "reduce": [{"var": "cart.items"}, {"+": [{"var": "accumulator"}, {"var": ["current.quantity", 1]}]}, 0] }, "suffix": " items" } }
```

- `expr` – JSON Logic expression (data = merged state)
- `suffix` – appended after result
- `prefix` – prepended before result
- `template` – e.g. `"{0} items"` replaces `{0}` with result

**Examples:**
- Cart count: `{ "expr": { "reduce": [{"var": "cart.items"}, {"+": [{"var": "accumulator"}, {"var": ["current.quantity", 1]}]}, 0] }, "suffix": " items" }`
- Subtotal: `{ "expr": { "formatCurrency": [{ "reduce": [{"var": "cart.items"}, {"+": [{"var": "accumulator"}, {"*": [{"var": ["current.product.price", 0]}, {"var": ["current.quantity", 1]}]}]}, 0] }, "AED"] } }`
- Conditional: `{ "expr": { "if": [{ "==": [{ "reduce": [{"var": "cart.items"}, {"+": [{"var": "accumulator"}, 1]}, 0] }, 0] }, "—", { "var": ["cart.shippingEstimate.label", "Free"] }] } }`

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
  "type": "Card",
  "map": "products.list",
  "key": "product",
  "children": [{ "type": "Text", "text": "{{$item.name}}" }]
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

Layouts define structure with `$ref` and `$slot`:

```json
{
  "structure": {
    "type": "Box",
    "children": [
      { "$ref": "fragments/header" },
      { "type": "Box", "children": [{ "$slot": "content" }] },
      { "$ref": "fragments/drawer" }
    ]
  }
}
```

- `$ref` – resolved to fragment content
- `$slot` – replaced with screen's content

---

## 5. Fragment Schema

Fragments are reusable UI pieces. Reference with `$ref`.

**Path format:** `fragments/header`, `fragments/drawer`, `fragments/modals/createProduct`

**Register:** Add to `config/fragments/index.ts`: `'fragments/name': import`

**Example fragment:** `config/fragments/modals/createProduct.json` – a single UI node (Modal, Box, etc.).

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
    "handle": { "var": "route.slug" }
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
| `variables` | Variables object; values support `{ "var": "path" }` and `{ "expr": <JSON Logic> }` |
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

Append to a nested array (e.g. `product.reviews`). Supports `{ "var": "path" }` and `{ "expr": <JSON Logic> }` in value. Special vars: `_timestamp`, `_date`.

```json
{
  "type": "appendToPath",
  "targetPath": "product.reviews",
  "value": {
    "id": { "expr": { "cat": ["rev-", { "var": "_timestamp" }] } },
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
| computed | Optional array of `{ output, expr }` for shared derived state (JSON Logic) |
| engineConventions | **Required** for apps using forms/fetch/workflow/graphql. No fallbacks in code—all values come from JSON: `loadingSuffix`, `errorSuffix`, `defaultStoreErrorsIn`, `workflowPath`, `screenScopedAliases`, `defaultFormPath`, `graphqlEndpoint` (default GraphQL URL), `graphqlHeaders` (default headers applied to all graphql actions) |

**Derived values – prefer inline expr:** For one-off computed values (cart count, subtotal, totals), use inline `text: { expr, suffix?, prefix?, template? }` in UI nodes. See §3 Interpolation & inline expr.

**Store-based computed (optional):** For values reused across many screens, add to `store.json`:

```json
"computed": [
  { "output": "cartCount", "expr": { "reduce": [{"var": "cart.items"}, {"+": [{"var": "accumulator"}, {"var": ["current.quantity", 1]}]}, 0] } }
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
      { "type": "Button", "text": "Cancel", "actions": { "click": { "action": "closeCreateModal" } } },
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
| Box | Flex container, base layout |
| View | Base view (react-native) |
| HStack | Horizontal stack |
| VStack | Vertical stack |
| Center | Centered content |
| Grid | CSS grid layout |
| GridItem | Grid cell |
| Divider | Horizontal/vertical divider |

### Typography
| Component | Description |
|-----------|-------------|
| Text | Body text |
| Heading | Headings (size: xs–6xl) |

### Interactive
| Component | Description |
|-----------|-------------|
| Button | Primary action (use `text` or children). Use `props.textClassName` to override ButtonText color when Gluestack defaults don't apply (e.g. `!text-gray-900` on light backgrounds). |
| ButtonText | Button label |
| ButtonIcon | Button icon |
| ButtonSpinner | Loading spinner in button |
| Pressable | Pressable area |
| Link | Navigation link |
| LinkText | Link label |

### Form
| Component | Description |
|-----------|-------------|
| Form | Form wrapper (defaultValues, validationRules, submitAction) |
| FormInputWithLabel | Input with label (name, label required) |
| FormSubmitButton | Submit button (must be inside Form) |
| Input | Text input (composite: Input + InputField) |
| InputField | Raw input field |
| InputIcon | Input icon |
| Checkbox | Checkbox (value required) |
| CheckboxIndicator | Checkbox indicator |
| CheckboxIcon | Checkbox check icon |
| CheckboxLabel | Checkbox label |
| Switch | Toggle switch |
| Textarea | Multi-line input |
| TextareaInput | Textarea field |
| Radio | Radio option (value required) |
| RadioGroup | Radio group |
| RadioIndicator | Radio indicator |
| RadioLabel | Radio label |
| RadioIcon | Radio icon |
| Select | Dropdown select |
| SelectTrigger | Select trigger |
| SelectInput | Select input |
| SelectIcon | Select icon |
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
| FormControl | Form control wrapper |
| FormControlLabel | Form control label |
| FormControlLabelText | Form control label text |
| FormControlError | Error message |
| FormControlErrorText | Error text |
| FormControlHelper | Helper text |
| FormControlHelperText | Helper text content |

### Data display
| Component | Description |
|-----------|-------------|
| Table | Table container |
| TableHeader | Table header |
| TableBody | Table body |
| TableRow | Table row |
| TableHead | Table header cell |
| TableData | Table data cell |
| Card | Card container |
| Badge | Badge/tag |
| BadgeText | Badge text |
| BadgeIcon | Badge icon |
| Alert | Alert message |
| AlertText | Alert text |
| AlertIcon | Alert icon |
| Skeleton | Loading skeleton |
| SkeletonText | Skeleton text |
| Avatar | User avatar |
| AvatarImage | Avatar image |
| AvatarFallbackText | Avatar fallback |
| Progress | Progress bar |
| ProgressFilledTrack | Progress fill |

### Overlay
| Component | Description |
|-----------|-------------|
| Modal | Modal dialog |
| ModalBackdrop | Modal backdrop |
| ModalContent | Modal content |
| ModalHeader | Modal header |
| ModalBody | Modal body |
| ModalFooter | Modal footer |
| ModalCloseButton | Modal close button |
| Drawer | Drawer/sidebar |
| DrawerBackdrop | Drawer backdrop |
| DrawerContent | Drawer content |
| DrawerHeader | Drawer header |
| DrawerBody | Drawer body |
| DrawerFooter | Drawer footer |
| DrawerCloseButton | Drawer close button |
| Popover | Popover |
| PopoverBackdrop | Popover backdrop |
| PopoverContent | Popover content |
| PopoverHeader | Popover header |
| PopoverBody | Popover body |
| PopoverFooter | Popover footer |
| PopoverCloseButton | Popover close button |
| Tooltip | Tooltip (needs trigger) |
| TooltipContent | Tooltip content |
| TooltipText | Tooltip text |
| Menu | Menu (needs trigger) |
| MenuItem | Menu item |
| MenuItemLabel | Menu item label |
| MenuSeparator | Menu separator |
| Actionsheet | Action sheet |
| ActionsheetContent | Actionsheet content |
| ActionsheetItem | Actionsheet item |
| ActionsheetItemText | Actionsheet item text |
| ActionsheetDragIndicator | Actionsheet drag indicator |
| ActionsheetDragIndicatorWrapper | Wrapper for drag indicator |
| ActionsheetBackdrop | Actionsheet backdrop |
| ActionsheetScrollView | Actionsheet scroll |
| ActionsheetIcon | Actionsheet icon |
| ActionsheetVirtualizedList | Virtualized list |
| ActionsheetFlatList | Flat list |
| ActionsheetSectionList | Section list |
| ActionsheetSectionHeaderText | Section header text |
| AlertDialog | Confirmation dialog |
| AlertDialogContent | AlertDialog content |
| AlertDialogCloseButton | AlertDialog close |
| AlertDialogHeader | AlertDialog header |
| AlertDialogFooter | AlertDialog footer |
| AlertDialogBody | AlertDialog body |
| AlertDialogBackdrop | AlertDialog backdrop |
| BottomSheet* | Bottom sheet (requires react-native-gesture-handler, react-native-reanimated) |

### Feedback & media
| Component | Description |
|-----------|-------------|
| Spinner | Loading spinner |
| Icon | Icon (as, name, size) |
| Image | Image (source, alt) |
| NextImage | Next.js Image (src, alt, fill, width, height) |

### Scroll & layout
| Component | Description |
|-----------|-------------|
| ScrollView | Scrollable container |
| SafeAreaView | Safe area wrapper |

### FAB
| Component | Description |
|-----------|-------------|
| Fab | Floating action button |
| FabLabel | FAB label |
| FabIcon | FAB icon |

### Accordion
| Component | Description |
|-----------|-------------|
| Accordion | Accordion container |
| AccordionItem | Accordion item (value, children) |
| AccordionHeader | Accordion header |
| AccordionTrigger | Accordion trigger |
| AccordionTitleText | Accordion title |
| AccordionContentText | Accordion content text |
| AccordionIcon | Accordion icon |
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

Any SDUI node can be animated by adding an `animation` object to its `props`. The renderer wraps the node in an `AnimatedNode` that drives all animation via React Native Reanimated.

```json
{
  "type": "Box",
  "props": {
    "className": "w-16 h-16 rounded-full bg-yellow-400",
    "animation": { ... }
  }
}
```

### Enter animation

Plays once when the node mounts.

```json
"animation": {
  "enter": {
    "type": "fadeUp",
    "duration": 400,
    "delay": 0,
    "easing": "spring"
  }
}
```

| Field | Values | Default |
|---|---|---|
| `type` | `"fade"`, `"fadeUp"`, `"fadeDown"`, `"fadeLeft"`, `"fadeRight"`, `"scale"`, `"scaleUp"`, `"slideUp"`, `"slideDown"`, `"flipX"`, `"flipY"` | — |
| `duration` | ms | `400` |
| `delay` | ms | `0` |
| `easing` | `"spring"`, `"ease"`, `"easeIn"`, `"easeOut"`, `"easeInOut"`, `"bounce"` | `"ease"` |

### Exit animation

Plays when the node unmounts (requires conditional rendering).

```json
"animation": {
  "exit": { "type": "fadeDown", "duration": 300 }
}
```

Same `type` options as enter.

### Loop animation

Continuously repeats while the node is mounted.

```json
"animation": {
  "loop": {
    "type": "breathe",
    "duration": 2000,
    "repeatCount": -1,
    "direction": "alternate"
  }
}
```

| Field | Description | Default |
|---|---|---|
| `type` | See loop type table below | — |
| `duration` | ms per cycle | `1000` |
| `delay` | ms before first cycle | `0` |
| `repeatCount` | number of repeats; `-1` = infinite | `-1` |
| `direction` | `"normal"` or `"alternate"` (reverse on even cycles) | `"normal"` |
| `color` | CSS color string for shadow-based types (`glowPulse`, `ripple`) | purple-500 |

**Loop types:**

| `type` | Effect |
|---|---|
| `breathe` | Scale 1 → 1.08, alternate |
| `float` | TranslateY 0 → -8px, alternate |
| `wiggle` | Small left/right wiggle sequence |
| `shake` | Fast shake sequence then pause |
| `spin` | Continuous 360° rotation |
| `ticker` | Same as spin |
| `flash` | Opacity 1 → 0.4, alternate |
| `swing` | Rotate ±15°, alternate |
| `rubber` | Scale squash/stretch sequence |
| `tada` | Combined scale + rotation burst |
| `heartbeat` | Fast double-pulse scale |
| `glowPulse` | Expanding box-shadow halo using `color`. Put `"outerStyle": { "borderRadius": N }` to match inner shape. |
| `ripple` | Shadow ring expands outward and fades, using `color`. Put `"outerStyle": { "borderRadius": N }` to match inner shape. |
| `gradientDrift` | Drifts `backgroundPosition` left ↔ right. **Requires** the gradient on `animation.outerStyle` (not `props.style`) — see example below. |

**`glowPulse` and `ripple` example (circular element):**

```json
{
  "type": "Box",
  "props": {
    "className": "w-16 h-16 rounded-full bg-yellow-400",
    "animation": {
      "outerStyle": { "borderRadius": 9999 },
      "loop": {
        "type": "glowPulse",
        "duration": 1500,
        "repeatCount": -1,
        "direction": "alternate",
        "color": "#facc15"
      }
    }
  }
}
```

- `color` must contrast with its background (default purple-500 works on both light and dark backgrounds)
- `outerStyle.borderRadius` makes the shadow follow the inner element's shape

**`gradientDrift` example:**

```json
{
  "type": "Box",
  "props": {
    "className": "w-24 h-16 rounded-lg flex items-center justify-center",
    "animation": {
      "outerStyle": {
        "backgroundImage": "linear-gradient(to right, #667eea, #764ba2, #f64f59, #c471ed, #667eea)",
        "backgroundSize": "400% 100%",
        "backgroundRepeat": "no-repeat",
        "borderRadius": 8
      },
      "loop": {
        "type": "gradientDrift",
        "duration": 3000,
        "repeatCount": -1
      }
    }
  }
}
```

**Why `outerStyle` for the gradient:** Reanimated animates `backgroundPosition` on the `Animated.View` wrapper. For the animation to work, the gradient background must be on the **same element** that Reanimated controls — i.e. `animation.outerStyle`, not `props.style`. Using `props.style` puts the gradient on the inner element, which Reanimated cannot reach.

### Hover animation

```json
"animation": {
  "hover": { "scale": 1.05, "opacity": 1.0, "y": -4, "duration": 200 }
}
```

### Press animation

```json
"animation": {
  "press": { "scale": 0.95, "opacity": 0.85, "duration": 100 }
}
```

### Stagger children

Staggers the enter animation of each direct child:

```json
"animation": {
  "staggerChildren": { "delay": 80, "startDelay": 0 }
}
```

### Outer style / class

Applied to the `Animated.View` wrapper (not the inner component). Required for `gradientDrift`, `glowPulse` shape-matching, and any CSS property Reanimated should own:

```json
"animation": {
  "outerStyle": { "borderRadius": 9999, "overflow": "hidden" },
  "outerClassName": "absolute inset-0"
}
```

---

## 13. Quick Reference: Adding a New Screen

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

**With modals:** Use `content: [ mainContent, { "$ref": "fragments/modals/myModal" } ]` and register modal in `fragments/index.ts`.
