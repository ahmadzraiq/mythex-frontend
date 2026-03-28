# Component Cleanup — Deferred Work

## Context

`Button`, `ButtonText`, `ButtonSpinner`, `Link`, and `LinkText` were removed as first-class component
types. They are now aliased to `Box` / `Text` / `Spinner` in the component registry. All styling must
be done via `className`. This is intentional — every component is now a `Box` + `className` by default.

---

## TODO 1 — Re-implement `Link` with real `<a href>` behavior

**Why:** `Link: Box` means `href` on a node renders as a `<div href="...">`, which does nothing.
Browsers don't follow `href` on divs. This breaks:
- SEO (crawlers don't follow non-anchor links)
- Keyboard navigation (tab focus, Enter to open)
- Right-click "Open in new tab"

**What to do:**
- Make the SDUI renderer detect `href` on a `Box` node and upgrade it to a Next.js `<Link>` or `<a>` automatically.
- OR restore `Link` as a real component in the registry (re-import from `@/components/ui/link`) so JSON nodes with `"type": "Box"` and `href` render as anchors.
- Restore `LinkText` if needed as a `Text` alias with sensible underline defaults.

**Files to touch:**
- `lib/sdui/renderer.tsx` — add href detection
- `lib/sdui/component-registry.tsx` — restore `Link` import
- `lib/sdui/types/node.ts` — add `'Link'` back to union

---

## TODO 2 — Map Gluestack `Button` action variants to `className`

**Why:** Config files previously used `"action": "primary"` / `"action": "secondary"` / `"action": "outline"`
on `Button` nodes. With `Button: Box`, these props are silently ignored, leaving buttons unstyled.

**Affected files (as of cleanup):**
- `config/screens/animation-test.json`
- `config/screens/popup-test.json`
- `config/screens/sign-in.json`
- `config/screens/register.json`
- `config/screens/workflow-test.json`
- `config/popups.json`

**What to do (two options):**

**Option A — Handle in renderer:**
Add a `resolveButtonActionClass(action, size)` utility in the renderer that maps known Gluestack variant
strings to Tailwind classes and merges them into `className` when `node.type === 'Box'` and `props.action`
is set. Example mapping:
```ts
const BUTTON_ACTION_CLASSES: Record<string, string> = {
  primary:     'flex flex-row items-center justify-center px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:opacity-90',
  secondary:   'flex flex-row items-center justify-center px-4 py-2 rounded-md bg-gray-100 text-gray-900 text-sm font-medium hover:bg-gray-200',
  outline:     'flex flex-row items-center justify-center px-4 py-2 rounded-md border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50',
  destructive: 'flex flex-row items-center justify-center px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700',
};
const BUTTON_SIZE_CLASSES: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs',
  lg: 'px-6 py-3 text-base',
};
```

**Option B — Update config files:**
Manually update each of the 6 config files above to replace `"action": "primary"` with explicit `className`
values. This is the cleaner long-term solution since it makes the JSON self-describing.

---

## TODO 3 — Remove `Pressable: Box` backward-compat alias

Once all user-generated pages / saved builder outputs have been migrated off `"type": "Pressable"`,
remove the alias from `lib/sdui/component-registry.tsx`:

```ts
// Remove this line when safe:
Pressable: Box, // backward-compat alias — renders as Box
```

Check that no saved page JSON in the database still contains `"type": "Pressable"` before removing.

---

## TODO 4 — InputWithField prop-forwarding requirements

`InputWithField` (mapped as `Input` in the registry) auto-injects an inner `InputField` when no children are provided. It must forward the following props from the `Input` node to the injected `InputField`:

- `placeholder` — shown as input placeholder text
- `name` — used by `FormContainer` for field tracking and `formData`
- `type` — HTML input type (`email`, `password`, `tel`, etc.)
- `value` — for controlled inputs (bound to a variable template)
- `className` — forwarded to `InputField` for text color overrides (`!text-gray-900 dark:!text-gray-100`)
- `placeholderTextColor` — cross-platform placeholder color
- `autoComplete` — browser autofill hint
- `_validation` (top-level node field) — registered with `FormContainer` for submit validation
- `_debounce` (top-level node field) — debounce config for `onChange`
- `actions` — bound to the injected `InputField`'s change handler

**Pattern:** `InputWithField` checks `React.Children.count(children) === 0`. If no children, it reads the above props from the parent `Input` node's props and passes them to an auto-injected `<InputField>`.

**Files to verify:**
- `lib/sdui/components/InputWithField.tsx` (or similar) — ensure all forwarded props listed above are handled
- `app/dev/builder/_panel-right.tsx` — Settings panel reads validation/debounce from `node._validation` / `node._debounce` (top-level), which is correct now that InputField is collapsed into Input
