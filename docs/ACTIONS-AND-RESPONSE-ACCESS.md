# Actions, API Response & Workflow – Access & Config-Driven Gaps

## Current: What You CAN Access From Anywhere

| Data | Path | Source |
|------|------|--------|
| Fetch response (extracted) | `{{storeIn}}` | e.g. `{{auth.user}}`, `{{product}}`, `{{order.lastOrder}}` |
| Loading state | `{{slice.loading}}` | From `store.json` engineConventions.loadingSuffix |
| Error message | `{{slice.error}}` | From engineConventions.errorSuffix |
| Form values | `{{form.*}}` or `{{screens.X.form.*}}` | Global variable store |
| Validation errors | `{{errors.*}}` or `{{screens.X.errors.*}}` | From storeErrorsIn |
| Cart, layout, route, etc. | `{{cart.items}}`, `{{layout.drawerOpen}}` | useSduiStore + initialData |

**Flow:** Fetch runs → `setData(storeIn, data)` → data is in store → `onSuccess` runs → next action can use `{{storeIn}}` in its payload (e.g. `path: "/order/{{order.lastOrder.id}}"`).

---

## Gaps: What You CANNOT Access or Configure

### 1. Raw API Response (Before responsePath)

- **Current:** Only the extracted part (via `responsePath`) is stored.
- **Missing:** No way to store the full response for debugging or when the API returns extra fields (e.g. `meta`, `pagination`).
- **Fix:** Add optional `storeFullResponseIn` or `storeRawIn` to fetch actions.

### 2. Error Message Extraction (Hardcoded)

- **Current:** Engine hardcodes:
  - `(errData as { message?: string })?.message ?? \`Fetch failed: ${res.status}\``
  - `err instanceof Error ? err.message : 'Fetch failed'`
- **Missing:** APIs use different shapes: `error.message`, `error.detail`, `errors[0].message`, etc.
- **Fix:** Add to fetch config: `errorMessagePath: "message"` or `errorMessagePath: "error.detail"` (dot path into error JSON).

### 3. Default storeIn (Hardcoded)

- **Current:** `const storeIn = actionDef.storeIn ?? 'data';`
- **Fix:** Move default to `config/store.json` engineConventions: `defaultStoreIn: "data"`.

### 4. submitReview Action (Hardcoded in Engine)

- **Current:** `submitReview` is a special-case in `sdui-engine.tsx` (lines 544–559). Not in `config/actions/`.
- **Logic:** Gets `product`, `reviewForm`, builds `newReview` with hardcoded `author: 'You'`, `id: \`rev-${Date.now()}\``, appends to `product.reviews`, resets `reviewForm`.
- **Fix:** Add a generic action type, e.g. `appendFromForm`:
  ```json
  {
    "type": "appendFromForm",
    "formPath": "reviewForm",
    "targetPath": "product.reviews",
    "map": {
      "id": { "expr": { "cat": ["rev-", { "var": "_timestamp" }] } },
      "author": "You",
      "rating": { "var": "reviewForm.rating" },
      "title": { "var": "reviewForm.title" },
      "body": { "var": "reviewForm.body" },
      "date": { "var": "_now" }
    },
    "resetFormPath": "reviewForm",
    "onSuccess": { "action": "setState", "payload": { "path": "product", "value": { "var": "product" } } }
  }
  ```
  Or introduce a `runComputed`-style action that applies a JSON Logic expression to produce the value to append.

### 5. Last Action / Workflow Context

- **Current:** No built-in `lastAction`, `lastActionResult`, or `lastError`.
- **Use case:** Conditional UI (e.g. "Retry" only after failed action), debugging, analytics.
- **Fix:** Optional convention path, e.g. `_workflow.lastAction`, `_workflow.lastResult`, `_workflow.lastError`, updated by the engine after each action.

### 6. formatCurrency (Partially Hardcoded)

- **Current:** `lib/sdui/computed-runner.ts`: `return c ? \`${c} ${n}\` : String(n);`
- **Missing:** Format string is fixed (e.g. no `1,234.56 AED`).
- **Fix:** Add `formatCurrency` config in `store.json` (e.g. `{ "template": "{{currency}} {{value}}", "locale": "en-AE" }`).

### 7. Fetch Error Storage

- **Current:** Only the message string is stored at `slice.error`.
- **Missing:** No storage of status code, error payload, or field-level errors.
- **Fix:** Add `storeErrorIn` with optional `errorPayloadPath` to store full error object.

---

## Hardcoded Logic Audit

| Location | What's Hardcoded | Configurable? |
|----------|------------------|---------------|
| `sdui-engine.tsx` L343 | `storeIn ?? 'data'` | Add to engineConventions |
| `sdui-engine.tsx` L359 | Error message from `errData.message` or `Fetch failed` | Add errorMessagePath |
| `sdui-engine.tsx` L388 | `'Fetch failed'` fallback | Add to config |
| `sdui-engine.tsx` L544–559 | submitReview logic | Move to config-driven action |
| `computed-runner.ts` L33–36 | formatCurrency template | Add to store.json |
| `variable-store.ts` L56 | `itemPath ?? 'quantity'` in reduce | Part of computed def |
| `form-with-validation.tsx` | `pattern: 'email'` → regex | Already in validation rules |

---

## Recommended Extensions (JSON Schema)

### Fetch Action – Extended

```json
{
  "type": "fetch",
  "url": "/api/orders",
  "method": "POST",
  "body": { "items": { "var": "cart.items" } },
  "storeIn": "order.lastOrder",
  "responsePath": "data",
  "storeFullResponseIn": "order._rawResponse",
  "errorMessagePath": "message",
  "storeErrorIn": "order.lastError",
  "onSuccess": [{ "action": "clearCart" }, { "action": "navigate", "payload": { "path": "/order/{{order.lastOrder.id}}" } }],
  "onError": { "action": "showToast", "payload": { "message": { "var": "order.lastError.message" } } }
}
```

### Engine Conventions (store.json)

```json
{
  "engineConventions": {
    "loadingSuffix": "loading",
    "errorSuffix": "error",
    "defaultStoreErrorsIn": "errors",
    "defaultStoreIn": "data",
    "defaultErrorMessagePath": "message",
    "workflowPath": "_workflow"
  }
}
```

---

## Summary

| Need | Status |
|------|--------|
| Access fetch response | ✅ Via `storeIn` |
| Store raw API response | ✅ `storeFullResponseIn` |
| Access in onSuccess payload | ✅ `{{storeIn}}` works |
| Error message from API | ✅ `errorMessagePath` (configurable) |
| Default storeIn | ✅ `engineConventions.defaultStoreIn` |
| Custom action logic | ✅ `appendToPath` action type (submitReview in config) |
| Special vars `_timestamp`, `_date` | ✅ Available in `{ "var": "_timestamp" }` |
| Last action/result | ✅ `_workflow.lastAction`, `_workflow.lastError` (configurable via `engineConventions.workflowPath`) |
