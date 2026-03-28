# New App Checklist

Use this checklist when creating a new app from this template to avoid common mistakes.

---

## 0. Bootstrap Infrastructure (Do This First)

These three files are the wiring layer. Nothing renders without them. Create them before any screens, layouts, or fragments.

- [ ] **`config/fragments/index.ts`** – Register every fragment. Keys MUST use the full `'fragments/name'` prefix (this is what `$ref` looks up):
  ```ts
  import header from './header.json';
  import drawer from './drawer.json';

  export const fragments = {
    'fragments/header': header,
    'fragments/drawer': drawer,
    'fragments/modals/myModal': myModal,
  } as const;
  ```

- [ ] **`config/layouts/index.ts`** – Register every layout with the required TypeScript cast:
  ```ts
  import authenticated from './authenticated.json';

  export const layouts = {
    authenticated: authenticated as { structure: object },
  } as const;
  ```

- [ ] **`config/app.ts`** – Merge screens, actions, and the registry. This is the single export consumed by `page.tsx`:
  ```ts
  import routes from './routes.json';
  import { layouts } from './layouts';
  import { fragments } from './fragments';
  import { resolveScreenConfig } from '@/lib/sdui/config-resolver';
  import home from './screens/home.json';
  import authActions from './actions/auth.json';

  const registry = { layouts, fragments };
  const rawScreens = { home };
  const screens = Object.fromEntries(
    Object.entries(rawScreens).map(([name, screen]) =>
      [name, resolveScreenConfig(screen as Parameters<typeof resolveScreenConfig>[0], registry)]
    )
  ) as typeof rawScreens;
  const actions = { ...authActions };

  export default { ...routes, screens, actions } as const;
  ```

- [ ] **`app/[[...slug]]/page.tsx` and `lib/sdui/`** – Do NOT modify. They are generic and work as-is for any app.

---

## 1. Config Setup

- [ ] **store.json** – Define complete `engineConventions` (no fallbacks in code). For production, use env vars: `NEXT_PUBLIC_GRAPHQL_ENDPOINT` and `NEXT_PUBLIC_VENDURE_TOKEN` override `graphqlEndpoint` and `graphqlHeaders.vendure-token` via `config/store-config.ts`.
  ```json
  "engineConventions": {
    "loadingSuffix": "loading",
    "errorSuffix": "error",
    "defaultStoreErrorsIn": "errors",
    "defaultStoreIn": "data",
    "defaultErrorMessagePath": "message",
    "workflowPath": "_workflow",
    "screenScopedAliases": ["form", "errors", "reviewForm"],
    "defaultFormPath": "form",
    "graphqlEndpoint": "https://your-store.myshopify.com/api/2024-01/graphql.json",
    "graphqlHeaders": {
      "X-Shopify-Storefront-Access-Token": "your-token"
    }
  }
  ```
  Omit `graphqlEndpoint` / `graphqlHeaders` if not using GraphQL, or if the app provides them per-action.
- [ ] **store.json** – Use nested paths for `initialData` (e.g. `cart: { items: [] }` not `"cart.items": []`)
- [ ] **routes.json** – Add routes; set `config` to screen name (used as `configName` for screen-scoped paths)
- [ ] **app.ts** – Import all new screens and merge into app config

---

## 2. Page & Engine

- [ ] **Page must pass `configName`** to SDUIEngine: `configName={configName}` (from route config)
- [ ] **Engine key** – Use path or unique key so engine remounts on navigation (already done with `engineKey={path}`)

---

## 3. State & Paths

- [ ] **Screen-scoped paths** – Aliases (form, errors, reviewForm, etc.) from `engineConventions.screenScopedAliases` in store.json; use `{{form.password}}` (alias) or `{{screens.signup.form.password}}` (cross-screen)
- [ ] **Global state** – `layout.*`, `auth.*`, `cart.*` from store.json
- [ ] **Workflow** – `{{_workflow.lastAction}}`, `{{_workflow.lastError}}` for last action (null if success)

---

## 4. Actions (No Hardcoded Logic)

- [ ] **Fetch** – Use `type: "fetch"` with `url`, `method`, `body`, `storeFullResponseIn`; access results via `context.workflow[stepId]` in a workflow's steps
- [ ] **GraphQL** – Use `type: "graphql"` with `query`, `variables` (supports `{ "var" }`, `{ "expr" }`), `endpoint`, `headers`. Set defaults in `engineConventions.graphqlEndpoint` + `graphqlHeaders`
- [ ] **Append to nested array** – Use `type: "appendToPath"` with `targetPath`, `value` (supports `{ "var" }`, `{ "expr" }`), `resetFormPath`, `resetFormValue`
- [ ] **Special vars** – `_timestamp`, `_date` available in `{ "var": "_timestamp" }` and JSON Logic `expr`
- [ ] **Never add app-specific action logic in engine** – Define in `config/actions/*.json`

---

## 5. Layout Pitfalls (see sdui-layout-pitfalls.mdc)

- [ ] **Sidebar + content** – Parent needs `flex flex-row flex-1 min-h-0 w-full`
- [ ] **Product grid** – Map wrapper needs `className: "contents"` so items are direct grid children
- [ ] **Content beside sidebar** – No `mx-auto` or `max-w-7xl`; use `w-full` only
- [ ] **Buttons** – Use `Button` with theme vars, not `Pressable` with manual styling
- [ ] **Badge on buttons** – Add `pointer-events-none` to Badge

---

## 6. UI/UX (see ui-ux-contrast.mdc)

- [ ] No duplicate content (e.g. newsletter in one place only)
- [ ] No dark-on-dark text; use `text-white` or `text-white/90` on dark backgrounds
- [ ] Theme in JSON only; use generic `var(--theme-*)` in classNames (`--theme-primary`, `--theme-background`, `--theme-card`, `--theme-muted`, etc. — not domain-prefixed vars)
- [ ] Text on images: strong gradient `bg-gradient-to-t from-black/80`, `drop-shadow-sm` on text
- [ ] Outline buttons on dark: `!border-white/70` not dark borders

---

## 7. Security

- [ ] **Remove password preview** before production (debug-only)
- [ ] No secrets in JSON; use env vars for API keys

---

## 8. Before First Deploy

- [ ] Remove or gate debug UI (password preview, etc.)
- [ ] Add `.env.example` with required vars (see project root; includes `NEXT_PUBLIC_GRAPHQL_ENDPOINT`, `NEXT_PUBLIC_VENDURE_TOKEN`)
- [ ] Verify `cart.items` path structure matches usage (nested vs flat)
