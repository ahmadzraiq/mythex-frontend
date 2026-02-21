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
  "content": { "type": "Box", "children": [...] },
  "initActions": [{ "action": "fetchProducts" }]
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
  "ui": { "type": "Box", "children": [...] },
  "initActions": []
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
| initActions | array | no | Actions to run on mount |

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
  "storeIn": "products.list",
  "storeFullResponseIn": "products._raw",
  "responsePath": "data",
  "errorMessagePath": "message",
  "body": { "email": { "var": "form.email" } },
  "onSuccess": { "action": "navigate", "payload": { "path": "/dashboard" } }
}
```

- `storeIn` – where to store extracted response (default from `store.json` engineConventions.defaultStoreIn)
- `storeFullResponseIn` – optional; store raw API response before responsePath extraction
- `errorMessagePath` – dot path into error JSON for message (default: "message")

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
  },
  "responsePath": "data.products.edges",
  "storeIn": "products.list",
  "storeFullResponseIn": "products._raw",
  "errorMessagePath": "errors[0].message",
  "onSuccess": { "action": "..." }
}
```

| Field | Description |
|-------|-------------|
| `query` | GraphQL query or mutation string |
| `variables` | Variables object; values support `{ "var": "path" }` and `{ "expr": <JSON Logic> }` |
| `endpoint` | GraphQL URL; supports `{{var}}` interpolation; falls back to `engineConventions.graphqlEndpoint` |
| `headers` | Per-action headers merged on top of `engineConventions.graphqlHeaders`; values support `{ "var": "path" }` |
| `responsePath` | Dot path into response (e.g. `data.products.edges`); applied after GraphQL error check |
| `storeIn` | State path to store the extracted data |
| `skipStoreWhenNull` | When true, do not overwrite storeIn when response data is null |
| `storeFullResponseIn` | Optional; stores the full raw response before `responsePath` extraction |
| `errorMessagePath` | Dot path for error message in HTTP error body (default from `engineConventions.defaultErrorMessagePath`) |
| `onSuccess` | Action(s) to run on success |

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

```json
{
  "type": "validate",
  "rules": {
    "form.email": { "required": true, "pattern": "email" },
    "form.password": { "required": true, "minLength": 8 }
  },
  "storeErrorsIn": "errors",
  "onSuccess": { "action": "login" }
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
| engineConventions | **Required** for apps using forms/fetch/workflow/graphql. No fallbacks in code—all values come from JSON: `loadingSuffix`, `errorSuffix`, `defaultStoreErrorsIn`, `defaultStoreIn`, `defaultErrorMessagePath`, `workflowPath`, `screenScopedAliases`, `defaultFormPath`, `graphqlEndpoint` (default GraphQL URL), `graphqlHeaders` (default headers applied to all graphql actions) |

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

## 12. Quick Reference: Adding a New Screen

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
