# Build Guide — SDUI JSON-Driven UI

Read this first, then drill down into linked docs as needed.

---

## 1. Project Structure

```
config/
├── app.ts              # Merges routes, screens, actions; resolves $ref/$slot
├── routes.json         # Paths, auth, layout, paramChangeAction
├── store.json          # initialData, engineConventions, computed, searchParamSync
├── theme.json          # Brand colors: cssVariables (root/dark), colors + colorsDark → generic var(--theme-*), fonts
├── screens/            # One .json per screen (meta, state, layout, content/ui)
├── layouts/            # Layout structures (navbar + $slot + footer)
├── fragments/          # Reusable UI (navbar, product-card, modals/*)
└── actions/            # Action definitions (auth, cart, checkout, products, layout)
```

**Key paths:**
- `config/screens/` — Screen definitions
- `config/fragments/` — Reusable UI; register in `fragments/index.ts`
- `config/layouts/` — Layout shells; register in `layouts/index.ts`
- `config/actions/` — Fetch, GraphQL, validate, set, navigate, etc.
- `config/store.json` — Initial state, conventions, computed, URL sync

---

## 2. Fragment Structure

Fragments are organized by semantic role:

| Folder | Purpose | Examples |
|--------|---------|----------|
| `fragments/layout/` | Shell: navbar, footer, cart-drawer | `fragments/layout/navbar` |
| `fragments/sections/` | Page-level building blocks | `fragments/sections/collection-loading-skeleton` |
| `fragments/cards/` | Item-level UI | `fragments/cards/product-card` |
| `fragments/product/` | Product-detail specific | `fragments/product/product-info` |
| `fragments/pagination/` | Pagination controls | `fragments/pagination/collection-pagination` |
| `fragments/checkout/` | Checkout steps | `fragments/checkout/contact-step` |

**Note:** Collection and search use pure JSON for facet filters: `groupBy` computed op produces `collection.facetGroups` / `search.facetGroups`; `navigateWithQuery` action toggles facets in URL; `arrayIncludes` / `arrayLength` for conditions.

---

## 3. Composition: $ref and $slot

| Pattern | Usage |
|---------|-------|
| `$ref` | Reference a fragment: `{ "$ref": "fragments/cards/product-card" }` |
| `$slot` | Layout placeholder: `{ "$slot": "content" }` — replaced with screen content |

**Fragment keys** in `fragments/index.ts` must use full path: `'fragments/layout/navbar'`, `'fragments/cards/product-card'`.

**Layouts** wrap screen content. Screen uses `layout: "store"` and `content: { ... }`; content is injected into the layout's `$slot`.

---

## 3b. Key Order Convention

Use this order on every UI node for predictable AI scanning:

1. `type`
2. `props`
3. `condition`
4. `map` / `key`
5. `children`
6. `actions`
7. `text` / `$ref` / `$slot`

---

## 3c. Section Patterns

**Loading + content:** Screen with loading skeleton and main content as siblings, each with `condition` (formula string, NOT JSON Logic):

```json
"children": [
  { "$ref": "fragments/sections/collection-loading-skeleton" },
  {
    "type": "Box",
    "condition": "!collections?.['UUID']?.loading",
    "props": { "className": "grid ..." },
    "children": [...]
  }
]
```

**Product grid:** `map` on Box with `className: "contents"`, `$ref` to product-card:

```json
{
  "type": "Box",
  "map": "collections.UUID.data.search.items",
  "props": { "className": "contents" },
  "children": [{ "$ref": "fragments/cards/product-card" }]
}
```

---

## 3. State & Paths

| Path | Description |
|------|-------------|
| `variables['UUID']` | Named variables declared in `config/variables.json` (mutable state) |
| `collections['UUID'].data.*` | Datasource data fetched via `fetchCollection` / `graphql` |
| `local.data.form.formData.*` | Form field values (auto-tracked by `FormContainer` via `name` prop) |
| `local.data.form.fields.*.isValid` | Per-field validation errors |
| `local.data.form.isSubmitting` / `isSubmitted` | Form lifecycle flags |
| `auth.*`, `cart.*`, `route.*`, `layout.*` | Global state from store.json |
| `context.item.data.*` | Current item fields inside a `map` / repeat loop |
| `context.item.parent.data.*` | Outer item fields inside a nested repeat |
| `_workflow.lastAction`, `_workflow.lastError` | Last action name and error (null if success) |

**`screens.*` paths are NOT supported.** All mutable state must be declared in `config/variables.json` with a UUID and accessed via `variables['UUID']`.

**Text templates** use `{{path}}`: `"text": "{{variables['UUID']}}"`, `"text": "{{collections['UUID'].data.product.name}}"`.

**Formula expressions** (conditions, `{ "expr" }`, `{ "formula" }`) use direct JS: `"condition": "variables['UUID'] > 0"`, `"condition": "collections['UUID']?.data?.items?.length > 0"`.

---

## 4. Common Patterns

### Form field with validation (FormContainer)

```json
{
  "type": "FormContainer",
  "id": "sign-in-form",
  "actions": [{ "action": "submitSignIn" }],
  "children": [
    { "type": "Text", "text": "Email *" },
    {
      "type": "Input",
      "id": "email-input",
      "props": { "variant": "outline" },
      "children": [{
        "type": "InputField",
        "props": { "name": "email", "placeholder": "Enter email" },
        "_validation": {
          "trigger": "submit",
          "rules": [
            { "type": "required", "message": "Email is required" },
            { "type": "email", "message": "Please enter a valid email" }
          ]
        }
      }]
    },
    {
      "type": "Text",
      "condition": "local?.data?.form?.fields?.email?.isValid",
      "props": { "className": "text-xs text-red-500" },
      "text": "{{local.data.form.fields.email.isValid}}"
    }
  ]
}
```

### Navigation (always named workflows)

All navigation uses named workflows in `config/actions/layout.json`:
```json
"actions": [{ "action": "navigateToHome" }]
"actions": [{ "action": "navigateToProduct" }]
```

Dynamic slugs from repeat scope use `{ "var": "context.item.data.slug" }` in the workflow step config.

### Actions (named workflow array format)

```json
"actions": [{ "action": "submitSignIn" }]
"actions": [{ "action": "fetchCollection" }]
```

The `trigger` (click, submit, change, etc.) is defined in the workflow, not on the node. See `build-guide.mdc` for the full workflow step types reference.

---

## 6. JSON Editing Rules

- **No trailing commas** — JSON disallows them; one breaks the build
- **Escape quotes** in strings: `"message": "Please enter a valid \"email\""`
- **2-space indent** — Use `npm run validate:json` before commit
- **Complex logic** — Prefer `store.json` computed over inline `{ "expr": {...} }` in nodes

---

## 6. Key Documentation

| Doc | Purpose |
|-----|---------|
| [docs/SCHEMA.md](SCHEMA.md) | Full JSON schema for screens, UI nodes, actions |
| [docs/NEW-APP-CHECKLIST.md](NEW-APP-CHECKLIST.md) | Bootstrap checklist for new apps |
| [.cursor/rules/sdui-layout-pitfalls.mdc](../.cursor/rules/sdui-layout-pitfalls.mdc) | Layout gotchas (sidebar, grid, form validation) |
| [.cursor/rules/sdui-computed-and-sync.mdc](../.cursor/rules/sdui-computed-and-sync.mdc) | Computed ops, searchParamSync |
| [.cursor/rules/nativewind-sdui-json.mdc](../.cursor/rules/nativewind-sdui-json.mdc) | Icons, Input, Select, layout, Pressable/Box text must use Text child |
| [.cursor/rules/build-guide.mdc](../.cursor/rules/build-guide.mdc) | Migration and build order |


---

## 8. Adding a New Screen

1. Create `config/screens/myScreen.json` with `meta`, `state`, `layout` (or omit for standalone), `content`/`ui`. On-mount data fetching is done via a named workflow with `trigger: "created"`.
2. Add route in `config/routes.json` with `config: "myScreen"`
3. Import screen in `config/app.ts` and add to `rawScreens`

---

## 9. Adding a New Fragment

1. Create `config/fragments/my-fragment.json` (single UI node)
2. Add to `config/fragments/index.ts`: `'fragments/my-fragment': import`
3. Use `{ "$ref": "fragments/my-fragment" }` in layouts or screens
