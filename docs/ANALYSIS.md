# Project Analysis: Issues, Performance & Configurability

A scan of the JSON-based SDUI project to identify issues, performance opportunities, and config-driven improvements.

---

## 1. Page.tsx – Make UI Configurable

**Current:** Redirect/loading/fallback UI is hardcoded in `app/[[...slug]]/page.tsx`:

```tsx
// Lines 82-96, 104
<p className="text-typography-600">Redirecting...</p>
<p className="text-typography-600">Page not found</p>
```

**Recommendation:** Add a `pageOverrides` (or `ui`) section to `config/routes.json` or a new `config/page.json`:

```json
{
  "defaultRedirect": "/login",
  "ui": {
    "redirecting": {
      "text": "Redirecting...",
      "className": "text-[var(--theme-content-textMuted)]"
    },
    "pageNotFound": {
      "text": "Page not found",
      "className": "text-[var(--theme-content-textMuted)]"
    },
    "layoutClasses": {
      "centered": "w-full min-h-screen flex items-center justify-center",
      "full": "w-full"
    }
  },
  "routes": [...]
}
```

Then in `page.tsx`, read from `app.ui.redirecting`, `app.ui.pageNotFound`, and `app.ui.layoutClasses[route?.layout ?? 'full']` instead of hardcoding.

**Benefits:** Theme alignment, i18n-ready, consistent with project conventions.

---

## 2. Code Duplication – Shared Utilities

**Issue:** `getNestedValue` and `setNestedValue` are duplicated in 4 files:

- `lib/sdui/sdui-engine.tsx`
- `lib/sdui/renderer.tsx`
- `lib/sdui/variable-store.ts`
- `lib/sdui/engine.tsx` (legacy)

**Recommendation:** Extract to `lib/sdui/nested-utils.ts`:

```ts
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown { ... }
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown, merge?: boolean): Record<string, unknown> { ... }
```

Import from there in all consumers. Reduces drift and maintenance.

---

## 3. Hardcoded Business Logic in Engine

**Issue:** Cart logic in `sdui-engine.tsx` (lines 162–179) is hardcoded:

- Tax rate: `0.05` (5%)
- Currency: `AED`
- Format: `AED ${Math.round(...)}`
- Shipping: `cartArr.length > 0 ? 0 : 0` (free when items exist)

**Recommendation:** Move to config, e.g. `config/store.json` or `config/ecommerce.json`:

```json
{
  "cart": {
    "taxRate": 0.05,
    "currency": "AED",
    "currencyFormat": "{{currency}} {{value}}",
    "freeShippingThreshold": 0
  }
}
```

Or extend `config/theme.json` with a `shop.currency` section. The engine should read these values instead of literals.

---

## 4. Performance – Merged State & Subscriptions

**Current behavior:**

- `computeMergedState` runs on every Zustand store change.
- It rebuilds the full merged state and recalculates cart totals.
- `useEffect` subscribes to the whole store: `useSduiStore.subscribe(() => setMergedState(...))`.

**Issues:**

- Any `setData`/`setLoading`/`setError` triggers a full recompute.
- Cart math runs even when cart hasn’t changed.
- No memoization of cart subtotal/tax/shipping.

**Recommendations:**

1. **Selective subscription:** Use Zustand’s `subscribeWithSelector` (or similar) so only relevant slices trigger updates.
2. **Memoize cart logic:** Compute cart totals only when `cart.items` or `cart.shippingEstimate` change.
3. **Lazy cart computation:** Move cart totals into a separate computed slice or a `useMemo` that depends only on cart-related paths.

---

## 5. Layout Class Mapping – Extend Routes Schema

**Current:** `page.tsx` maps `route.layout` to CSS classes with a simple ternary:

```tsx
route?.layout === 'centered' ? '...' : 'w-full'
```

**Recommendation:** Support arbitrary layout names via config. In `config/routes.json`:

```json
{
  "layoutClasses": {
    "centered": "w-full min-h-screen flex items-center justify-center",
    "full": "w-full",
    "minimal": "w-full max-w-2xl mx-auto"
  },
  "routes": [...]
}
```

Then: `app.layoutClasses[route?.layout ?? 'full'] ?? 'w-full'`.

---

## 6. Orphaned Config – Drawer & Authenticated Layout

**Issue:** After removing dashboard/products/profile:

- `config/fragments/drawer.json` still references `/dashboard`, `/dashboard/products`, `/profile`.
- `config/layouts/authenticated.json` is unused.
- `config/actions/layout.json` has `navigateToDashboard`, `navigateToProducts`, `navigateToProfile`.

**Recommendation:** Either:

1. **Remove:** Delete drawer, authenticated layout, and those layout actions if not needed, or
2. **Repurpose:** Point drawer links to `/account`, `/shop`, etc., and wire them to screens that use the authenticated layout.

---

## 7. Legacy Files

**`config/app.json`** – Old single-file config; app uses `config/app.ts` + `routes.json` + individual screens. Consider removing or documenting as legacy.

**`lib/sdui/engine.tsx`** – Simpler engine; `sdui-engine.tsx` is the active one. Remove `engine.tsx` if unused, or document its role.

---

## 8. Theme Consistency – `text-typography-*`

**Issue:** `page.tsx` and `SDUIWithAuth.tsx` use `text-typography-600`, which is a Gluestack token. Other config uses theme variables like `text-[var(--theme-header-textMuted)]`.

**Recommendation:** Prefer theme variables for consistency:

- `text-[var(--theme-content-textMuted)]` or `text-[var(--theme-auth-bgAlt)]` instead of `text-typography-600`.

---

## 9. Route Matching – Dynamic Routes

**Current:** Dynamic routes are matched with `path.startsWith(r.path + '/')`. That can overlap (e.g. `/account` vs `/account/orders`).

**Recommendation:** Match more specific routes first. Sort routes by path length (descending) before matching, or use a trie/prefix matcher so `/account/orders` is preferred over `/account` when the path is `/account/orders`.

---

## 10. initActions / dataSources – Stale Closure Risk

**Current:** In `sdui-engine.tsx`:

```tsx
useEffect(() => {
  config.initActions?.forEach((action) => runAction(action));
}, [config.initActions]); // eslint-disable-line react-hooks/exhaustive-deps
```

`runAction` is in the dependency array of its own `useCallback`, which depends on `mergedState`. If `config.initActions` is stable but `runAction` changes, the effect may run with an outdated `runAction`.

**Recommendation:** Use a ref for the latest `runAction`, or ensure `runAction` is stable (e.g. via refs for changing parts) so init actions always see current state.

---

## 11. Config Resolver – Deep Copy Cost

**Current:** `config-resolver.ts` uses `JSON.parse(JSON.stringify(...))` for deep copies when resolving `$ref` and `$slot`.

**Impact:** Can be costly for large config trees.

**Recommendation:** For production, consider a structural clone or shallow copy where safe. Or resolve once at app load and cache the result.

---

## 12. Variable Store – Adapter Sync

**Current:** The variable store has an `adapters` concept, but the Zustand store is not wired as an adapter. `mergedState` is built manually in the engine.

**Recommendation:** If the architecture allows, treat the Zustand store as an adapter so the variable store is the single source of truth and adapters are synced into it. That could simplify `computeMergedState` and reduce duplication.

---

## Summary: Quick Wins

| Priority | Item | Effort | Status |
|----------|------|--------|--------|
| High | Make page.tsx redirect/fallback UI configurable | Low | ✅ Done |
| High | Extract `getNestedValue` / `setNestedValue` to shared util | Low | ✅ Done |
| Medium | Move cart tax/currency to config | Low | ✅ Done |
| Medium | Add `layoutClasses` to routes config | Low | ✅ Done |
| Medium | Clean up orphaned drawer/authenticated layout | Low | ✅ Done |
| Low | Memoize/optimize cart computation in engine | Medium | Pending |
| Low | Remove or document `config/app.json`, `engine.tsx` | Low | ✅ Done |

---

## Config Extensions Checklist

To align with “no hardcoded values in code”:

- [x] Page overlay UI (redirect, not found) → `config/routes.json` `ui`
- [x] Layout CSS classes → `config/routes.json` `ui.layoutClasses`
- [x] Cart totals, tax, currency → `config/store.json` `computed` (JSON Logic)
- [x] Theme variables for all text/backgrounds (replace `text-typography-*` where possible)

## All Conventions Now Config-Driven ✅

- **Loading/error paths:** Engine defaults (`loading`, `error`, `errors`)
- **Auth/route paths:** `config/store.json` → `paths.authUser`, `routePath`, `routeSlug`, `routeQ`
- **Action paths:** Defined in `config/actions/*.json` (storeIn, path) – already config-driven

## Engine is App-Agnostic ✅

**No app-specific logic in the engine.** Derived state (cart totals, etc.) is fully JSON-driven:

- **Engine:** Generic merge (data + loading + error) + JSON Logic `computed` from `config/store.json`
- **Computed runner:** `lib/sdui/computed-runner.ts` uses **json-logic-js** – same library as conditions; no custom reduce types
- **Config:** `config/store.json` → `computed` array; `{ output, expr }` per entry; `expr` is JSON Logic (data = merged state)
- **Different apps:** Add different `expr` logic in store.json for any derived state; fully generic
