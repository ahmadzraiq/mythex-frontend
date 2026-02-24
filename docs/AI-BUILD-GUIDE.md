# AI Build Guide — SDUI JSON-Driven UI

**Single entry point for AI assistants.** Read this first, then drill down into linked docs as needed.

---

## 1. Project Structure

```
config/
├── app.ts              # Merges routes, screens, actions; resolves $ref/$slot
├── routes.json         # Paths, auth, layout, paramChangeAction
├── store.json          # initialData, engineConventions, computed, searchParamSync
├── theme.json          # Brand colors, sections (header, footer, hero)
├── screens/            # One .json per screen (meta, state, layout, content/ui, initActions)
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

**Loading + content:** Screen with loading skeleton and main content as siblings, each with `condition`:

```json
"children": [
  { "$ref": "fragments/sections/collection-loading-skeleton" },
  {
    "type": "Box",
    "condition": { "!": [{ "var": "collection.loading" }] },
    "props": { "className": "grid ..." },
    "children": [...]
  }
]
```

**Product grid:** `map` on Box with `className: "contents"`, `$ref` to product-card:

```json
{
  "type": "Box",
  "map": "collection.search.items",
  "props": { "className": "contents" },
  "children": [{ "$ref": "fragments/cards/product-card" }]
}
```

---

## 3. State & Paths

| Path | Description |
|------|-------------|
| `screens.{screenName}.form.*` | Form values per screen |
| `screens.{screenName}.errors.*` | Validation errors per screen |
| `auth.*`, `cart.*`, `route.*`, `layout.*` | Global state from store.json |
| `{{form.field}}` | Alias for current screen's form (when `screenScopedAliases` includes `form`) |
| `{{$item.field}}` | Current item in `map` loop |
| `{{_workflow.lastAction}}`, `{{_workflow.lastError}}` | Last action name and error |

**Condition paths** use full path: `screens.checkout.errors.form.emailAddress` (not alias).

**setState path** must be full: `screens.checkout.form.emailAddress` (not `form.emailAddress`).

---

## 4. Common Patterns

### Form field + error + clear on change

```json
{
  "type": "Box",
  "children": [
    { "type": "Text", "text": "Email *" },
    {
      "type": "Input",
      "children": [{
        "type": "InputField",
        "props": { "value": "{{form.email}}" },
        "actions": {
          "change": {
            "type": "runMultiple",
            "actions": [
              { "action": "setState", "payload": { "path": "screens.signIn.form.email", "value": "$event" } },
              { "action": "setState", "payload": { "path": "screens.signIn.errors.form.email", "value": "" } }
            ]
          }
        }
      }]
    },
    {
      "type": "Box",
      "condition": { "var": ["screens.signIn.errors.form.email"] },
      "children": [{ "type": "Text", "text": "{{errors.form.email}}" }]
    }
  ]
}
```

### Navigation

- Static: `{ "action": "navigate", "payload": { "path": "/shop" } }`
- Dynamic: `{ "action": "navigate", "payload": { "routeConfig": "product", "slug": { "var": "$item.slug" } } }`

### Actions

- Named: `{ "action": "login" }` or `{ "action": "fetchCollection" }`
- Inline in runMultiple: `{ "type": "setVar", "path": "collectionSkip", "value": 0 }`

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
| [.cursor/rules/ai-build-schema.mdc](../.cursor/rules/ai-build-schema.mdc) | Migration and build order |
| [.cursor/rules/ai-section-library.mdc](../.cursor/rules/ai-section-library.mdc) | Section library, anchor IDs, 4-tier edit system |

---

## 10. Section Library Architecture

The page generator uses a **Select + Inject** pattern instead of generating 500+ lines of SDUI JSON from scratch.

### How it works

```
User request → BriefAgent (section types) → StructureAgent (picks variant IDs)
             → SectionLibrary.instantiate() (fills [[SLOT]] markers)
             → Full SDUI page JSON assembled in milliseconds
```

### Key files

| File | Purpose |
|------|---------|
| `lib/ai/section-library/types.ts` | Shared types: `SectionVariant`, `ManifestEntry`, `SectionSelection` |
| `lib/ai/section-library/manifest.ts` | Compact manifest for AI prompts (`buildManifestContext()`) |
| `lib/ai/section-library/index.ts` | `SectionLibrary` class: `getVariants()`, `instantiate()`, `collectInitActions()` |
| `lib/ai/section-library/variants/` | 35 section types × 2-5 variants each (~72 total) |
| `lib/ai/section-library/customizer.ts` | Edit operations: swap, add, remove, style patch, subtree edit |
| `lib/ai/editing/intent-classifier.ts` | Routes user edit requests to Tier 1–4 |
| `lib/ai/editing/style-interpreter.ts` | Tier 1: zero-AI Tailwind class mutations |
| `lib/ai/editing/node-locator.ts` | Find nodes by anchor ID or dot path |
| `lib/ai/agents/edit-agent.ts` | Tier 2: micro-AI on 5-40 line subtrees only |

### Slot syntax

- `[[SLOT_NAME]]` — replaced at instantiation (library level)
- `{{state.path}}` — SDUI runtime interpolation (do NOT confuse them)

### 35 supported section types

Hero/Above-fold, Product Discovery, Brand & Story, Social Proof, Engagement — see `ai-section-library.mdc` for the full taxonomy.

### Adding a new variant

1. Add to `lib/ai/section-library/variants/*.ts`
2. Register in `lib/ai/section-library/index.ts`
3. Add compact entry to `lib/ai/section-library/manifest.ts`
4. Tag key nodes with stable `id` attributes (anchor IDs)

### 4-Tier Edit System

| Tier | When | Mechanism |
|------|------|-----------|
| 1 | Color, padding, text, remove | `StyleInterpreter` — regex rules, zero AI |
| 2 | Add elements, change actions | `EditAgent` — AI sees only 5-40 line subtree |
| 3 | Swap variant | `SectionCustomizer.swapSection()` — no AI |
| 4 | New page / new section | Full pipeline |

---

## 8. Adding a New Screen

1. Create `config/screens/myScreen.json` with `meta`, `state`, `layout` (or omit for standalone), `content`/`ui`, `initActions`
2. Add route in `config/routes.json` with `config: "myScreen"`
3. Import screen in `config/app.ts` and add to `rawScreens`

---

## 9. Adding a New Fragment

1. Create `config/fragments/my-fragment.json` (single UI node)
2. Add to `config/fragments/index.ts`: `'fragments/my-fragment': import`
3. Use `{ "$ref": "fragments/my-fragment" }` in layouts or screens
