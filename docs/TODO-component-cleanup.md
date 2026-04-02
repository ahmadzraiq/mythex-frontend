# Component Cleanup — Status

## Context

`Button`, `ButtonText`, `ButtonSpinner`, `Link`, and `LinkText` were removed as first-class component
types. They are now aliased to `Box` / `Text` / `Spinner` in the component registry. All styling must
be done via `className`. This is intentional — every component is now a `Box` + `className` by default.

---

## TODO 1 — Re-implement `Link` with real `<a href>` behavior (OPEN)

**Why:** `Link: Box` means `href` on a node renders as a `<div href="...">`, which does nothing.
Browsers don't follow `href` on divs. This breaks SEO, keyboard nav, and right-click context menu.

**What to do:**
- Make the SDUI renderer detect `href` on a `Box` node and upgrade it to a Next.js `<Link>` or `<a>` automatically.
- OR restore `Link` as a real component in the registry.

**Files to touch:**
- `lib/sdui/renderer.tsx` — add href detection
- `lib/sdui/component-registry.tsx` — restore `Link` import

**Status:** No config files currently use `"type": "Link"` — low priority until link nodes are reintroduced.

---

## ~~TODO 2 — Map Gluestack Button action variants~~ (DONE)

Button now uses `action="custom"` when `className` has `bg-*`/`text-*`, plus `cssInterop` on Root.
No config files use the old `"action": "primary"` variant strings. See `sdui-layout-pitfalls.mdc` "Button — Custom Colors (Gluestack v3)".

---

## ~~TODO 3 — Remove Pressable backward-compat alias~~ (DONE)

`Pressable` alias has been removed from `component-registry.tsx`. No config files reference `"type": "Pressable"`.

---

## TODO 4 — InputWithField prop-forwarding requirements (OPEN)

`InputWithField` (mapped as `Input` in the registry) auto-injects an inner `InputField` when no children are provided. It must forward these props to the injected `InputField`:

- `placeholder`, `name`, `type`, `value`, `className`, `placeholderTextColor`, `autoComplete`
- `_validation` (top-level node field) — registered with `FormContainer` for submit validation
- `_debounce` (top-level node field) — debounce config for `onChange`
- `actions` — bound to the injected `InputField`'s change handler

**Pattern:** `InputWithField` checks `React.Children.count(children) === 0`. If no children, it reads props from the parent `Input` node and passes them to an auto-injected `<InputField>`.

**Files to verify:**
- `lib/sdui/components/InputWithField.tsx` — ensure all forwarded props listed above are handled
