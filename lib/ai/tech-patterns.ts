/**
 * Senior tech logic persona context for AI generators.
 * Encodes state path rules, form pattern, loading/error, initActions, runMultiple, auth, computed.
 * Inject into navbar-structure-spec, screen-generator prompts.
 */

export function buildTechPatternsContext(): string {
  return `TECH PATTERNS (senior developer rules):

STATE PATH RULES:
- Zustand owns: fetched data (set, fetch, graphql), cart, auth, nav, products, collection. Use set/storeIn.
- Variable store owns: UI state (toggle, increment, decrement, setVar, setState). Use for sortMenuOpen, collectionSkip, nav.themeMenuOpen, form fields.
- Never mix: do not use set for paths that increment/toggle writes to; do not use toggle for Zustand-owned paths.
- Screen-scoped: screens.{screenName}.form.*, screens.{screenName}.errors.*. setState path must be full path.

FORM PATTERN:
- state.form.* for field values. state.errors.* for validation errors (or storeErrorsIn path).
- validate action: rules per field (required, minLength, pattern: "email", equalsField), storeErrorsIn: "errors", onSuccess: mutation.
- submitAction triggers validate → onSuccess runs mutation when valid.
- Clear field error on change: runMultiple with setState field + setState errors.path to "".

LOADING / ERROR STATES:
- Every fetch/graphql action has {storeIn}Loading and {storeIn}Error automatically (engineConventions.loadingSuffix, errorSuffix).
- Skeleton: condition { "var": "productsLoading" } to show loading UI.
- Error display: condition on {storeIn}Error, show {{productsError}} or similar.

initActions:
- Run on mount. Order: globalInitActions first (fetchNavCollections, fetchCart), then screen-specific fetches.
- Do not reset variable store paths (e.g. collectionSkip) in initActions when searchParamSync owns them.

runMultiple PATTERN:
- Use for compound actions: setState field + clear error + trigger fetch. Or: closeDrawer + navigate.
- actions: [{ "action": "setState", "payload": { "path": "...", "value": "$event" } }, { "action": "setState", "payload": { "path": "errors.field", "value": "" } }]

AUTH PATTERN:
- Logged out: { "==": [{ "var": "auth.user" }, null] }. Logged in: { "!=": [{ "var": "auth.user" }, null] }.
- Sign in flow: validate (rules: form.username, form.password) → onSuccess: loginMutation → onSuccess: navigate.
- Use auth.user, not auth.isLoggedIn. Greeting: {{auth.user.firstName}}.

COMPUTED VS INTERPOLATION:
- Simple values: {{cart.totalQuantity}}, {{form.field}}, {{product.name}}.
- Math/conditional: text: { "expr": { "+": [...] } } or { "if": [cond, then, else] }.
- Money: { "formatCurrency": [{ "var": "cart.subTotalWithTax" }, "USD"] }.
- In map scope: {{$item.field}}, {{$index}}. JSON Logic: { "var": "$item.slug" }.

MODAL PATTERN:
- Fragment in config/fragments/modals/. Form wraps ModalBody + ModalFooter.
- FormSubmitButton inside Form. submitAction on Form triggers validate then mutation.
- Open/close: setState path for modal visibility (e.g. layout.drawerOpen, modal.create).`;
}
