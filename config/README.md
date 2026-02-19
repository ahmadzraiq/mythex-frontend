# SDUI Configuration

The app config is split into a folder structure for maintainability. `app.ts` imports and merges everything, and the **config resolver** composes layouts and fragments via `$ref` and `$slot`.

**→ Full schema reference for AI/build: [`docs/SCHEMA.md`](../docs/SCHEMA.md)**

## Folder Structure

```
config/
├── app.ts              # Entry point - merges routes, screens, actions, resolves layouts
├── routes.json         # defaultRedirect + routes
├── screens/            # One JSON file per screen
│   ├── login.json
│   ├── signup.json
│   ├── dashboard.json
│   ├── products.json
│   ├── forgotPassword.json
│   ├── resetPassword.json
│   └── profile.json
├── layouts/            # Reusable layout structures with $ref and $slot
│   ├── authenticated.json
│   └── index.ts
├── fragments/          # Reusable UI fragments (header, drawer, modals)
│   ├── header.json
│   ├── drawer.json
│   ├── modals/
│   │   ├── createProduct.json
│   │   ├── editProduct.json
│   │   └── deleteProduct.json
│   └── index.ts
└── actions/            # Actions grouped by domain
    ├── auth.json       # login, signup, logout, forgotPassword, etc.
    ├── products.json   # fetchProducts, createProduct, CRUD modals
    ├── layout.json     # openDrawer, closeDrawer, navigation
    └── other.json      # addToCart, etc.
```

## JSON Composition: Layouts, Fragments, $ref, $slot

### Layouts
Use `layout: "authenticated"` in a screen to wrap content with a shared layout (header + drawer).

```json
{
  "meta": { "title": "Dashboard" },
  "layout": "authenticated",
  "content": { "type": "Box", "children": [...] },
  "initActions": [...]
}
```

### Fragments ($ref)
Reference reusable UI fragments with `"$ref": "fragments/name"`:

```json
{ "$ref": "fragments/header" }
{ "$ref": "fragments/drawer" }
{ "$ref": "fragments/modals/createProduct" }
```

Add new fragments in `config/fragments/` and register in `fragments/index.ts`.

### Content Slot
Layouts use `"$slot": "content"` as a placeholder. The screen's `content` (or `ui`) is injected there.

### Reusing Modals
Screens can compose content from fragments. Example (products screen):

```json
{
  "layout": "authenticated",
  "content": [
    { "type": "Box", "children": [/* main content */] },
    { "$ref": "fragments/modals/createProduct" },
    { "$ref": "fragments/modals/editProduct" },
    { "$ref": "fragments/modals/deleteProduct" }
  ]
}
```

To add a new screen: create `screens/myScreen.json`, add it to `app.ts`, and optionally use `layout` + `content` + `$ref`.

## Merged Structure (app.ts output)

```json
{
  "defaultRedirect": "/login",
  "routes": [...],
  "screens": {
    "login": { "meta": {...}, "state": {...}, "ui": {...} },
    "dashboard": { ... }
  },
  "actions": { "login": {...}, "logout": {...} }
}
```

### Variables (dynamic)
- **Config store** – All state (auth, ecommerce, etc.) comes from JSON-configured actions
- **Fetch** – `type: "fetch"` actions store data by `storeIn` path
- **Screen state** – Initial variables per screen (e.g. `form`, `errors`)

Use `{{path}}` in JSON: `{{form.email}}`, `{{auth.user}}`, `{{ecommerce.products}}`

### Fetch actions (fully JSON-configured, no hardcoded logic)
```json
"fetchProducts": {
  "type": "fetch",
  "url": "https://api.example.com/products",
  "storeIn": "ecommerce.products",
  "map": { "id": "id", "name": "title", "price": "price", "image": "image" }
}
```

**POST/PUT with body (e.g. login, signup):**
```json
"login": {
  "type": "fetch",
  "method": "POST",
  "url": "/api/auth/login",
  "body": { "email": { "var": "form.email" }, "password": { "var": "form.password" } },
  "storeIn": "auth.user",
  "responsePath": "user",
  "onSuccess": { "action": "navigate", "payload": { "path": "/dashboard" } }
}
```

**Multiple onSuccess actions** (array):
```json
"onSuccess": [
  { "action": "setState", "payload": { "path": "form", "value": {} } },
  { "action": "navigate", "payload": { "path": "/dashboard" } }
]
```

### Set action (clear/update state)
```json
"logout": {
  "type": "set",
  "path": "auth",
  "value": { "user": null, "error": null },
  "onSuccess": { "action": "navigate", "payload": { "path": "/login" } }
}
```

### Append actions (dynamic state updates)
```json
"addToCart": {
  "type": "append",
  "path": "ecommerce.cart",
  "value": { "product": { "var": "$item" }, "quantity": 1 }
}
```
States (path, value) are defined in JSON; cartCount is computed from any `.cart` path.

## Screen Schema

### Root Structure (per screen)
```json
{
  "meta": { "title": "...", "description": "..." },
  "state": { /* initial variables */ },
  "ui": { /* root SDUINode */ }
}
```

### Node Structure
| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Component: Box, Text, HStack, VStack, NextImage, Button, Card, etc. |
| `condition` | JSON Logic | Render only when condition is truthy |
| `map` | string | Variable path to array - renders node for each item |
| `props` | object | Component props (className, size, variant, etc.) |
| `className` | string | Tailwind classes shorthand |
| `text` | string | Text content with `{{variable}}` interpolation |
| `children` | SDUINode[] | Child nodes |
| `src` | string | Image source (for Image/NextImage) |
| `alt` | string | Image alt text |

### Interpolation
Use `{{path}}` in strings to inject variables:
- `{{user.name}}` - nested state
- `{{$item.icon}}` - current item in `map` loop
- `{{$index}}` - current index in `map` loop

### Conditions (JSON Logic)
```json
{ "var": "showGradient" }
{ "==": [{ "var": "count" }, 5] }
{ "and": [{ ">": [{ "var": "score" }, 10] }, { "var": "isActive" }] }
```

### Map (Arrays)
```json
{
  "type": "Box",
  "map": "features",
  "children": [
    {
      "type": "Text",
      "text": "{{$item.name}}"
    }
  ]
}
```

### Actions
```json
{
  "actions": {
    "click": { "action": "setState", "payload": { "path": "count", "value": 1 } },
    "click": [
      { "action": "navigate", "payload": { "view": "edit" } },
      { "action": "fetch", "payload": { "url": "https://api.example.com/data", "key": "data" } }
    ]
  }
}
```
Actions: `setState`, `fetch`, `navigate`, `validate`, `setStateTemporary` (toast), `log`

### Data Sources
```json
{
  "dataSources": [
    { "url": "https://api.example.com/todos/1", "method": "GET", "key": "todo" }
  ]
}
```

### Validation
Rules: `required`, `minLength`, `maxLength`, `pattern` (or `"email"`), `equals` (compare with another path), `message` (custom error).

**Action type (with onSuccess when valid):**
```json
"validateSignup": {
  "type": "validate",
  "rules": {
    "form.name": { "required": true },
    "form.email": { "required": true, "pattern": "email" },
    "form.password": { "required": true, "minLength": 8 },
    "form.confirmPassword": { "required": true, "equals": "form.password", "message": "Passwords must match" }
  },
  "storeErrorsIn": "errors",
  "onSuccess": { "action": "signup" }
}
```

**Inline payload:**
```json
{
  "action": "validate",
  "payload": {
    "rules": {
      "form.title": { "required": true, "minLength": 3 }
    },
    "storeErrorsIn": "errors"
  }
}
```

### Supported Components (AI-ready)
Box, Text, HStack, VStack, Card, Heading, Button, Input, Checkbox, Switch, Drawer, FormControl, Badge, Alert, Skeleton, Avatar, Modal, and more.

### Action types (all JSON-configured)
- **fetch** – GET/POST/PUT with `url`, `method`, `body`, `storeIn`, `responsePath`, `map`
- **set** – Set state at `path` with `value`
- **append** – Append to array at `path`
- **navigate** – Navigate to `path`
- **setState** – Update screen state

