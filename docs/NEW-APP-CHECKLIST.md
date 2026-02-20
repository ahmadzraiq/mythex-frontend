# New App Checklist

Use this checklist when creating a new app from this template to avoid common mistakes.

---

## 1. Config Setup

- [ ] **store.json** – Define complete `engineConventions` (no fallbacks in code):
  ```json
  "engineConventions": {
    "loadingSuffix": "loading",
    "errorSuffix": "error",
    "defaultStoreErrorsIn": "errors",
    "defaultStoreIn": "data",
    "defaultErrorMessagePath": "message",
    "workflowPath": "_workflow",
    "screenScopedAliases": ["form", "errors", "reviewForm"],
    "defaultFormPath": "form"
  }
  ```
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

- [ ] **Fetch** – Use `storeIn`, `responsePath`, `errorMessagePath`, `storeFullResponseIn`; all configurable
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
- [ ] Theme in JSON only; use `var(--theme-*)` in classNames
- [ ] Text on images: strong gradient `bg-gradient-to-t from-black/80`, `drop-shadow-sm` on text
- [ ] Outline buttons on dark: `!border-white/70` not dark borders

---

## 7. Security

- [ ] **Remove password preview** before production (debug-only)
- [ ] No secrets in JSON; use env vars for API keys

---

## 8. Before First Deploy

- [ ] Remove or gate debug UI (password preview, etc.)
- [ ] Add `.env.example` with required vars
- [ ] Verify `cart.items` path structure matches usage (nested vs flat)
