/**
 * Shared SDUI config context for AI generators.
 * Builds reference documentation from config so the AI understands schema, actions, and syntax.
 * All builders import from actual sources—when you change logic, the AI knows automatically.
 * Import in navbar-structure-spec, layout-generator, etc.
 */

import root from '@/config/root';

const layoutActions = (root.actionsByFile as Record<string, Record<string, unknown>>)?.layout ?? {};
const authActions = (root.actionsByFile as Record<string, Record<string, unknown>>)?.auth ?? {};
const cartActions = (root.actionsByFile as Record<string, Record<string, unknown>>)?.cart ?? {};
const checkoutActions = (root.actionsByFile as Record<string, Record<string, unknown>>)?.checkout ?? {};
const accountActions = (root.actionsByFile as Record<string, Record<string, unknown>>)?.account ?? {};
const productsActions = (root.actionsByFile as Record<string, Record<string, unknown>>)?.products ?? {};
const routes = root.routes;
const storeJson = root.store;
const themeJson = root.theme;
const fragments = root.fragments;
const layouts = root.layouts;
import { COMPONENT_NAMES } from '@/config/component-names';
import { JSON_LOGIC_CUSTOM_OPS } from '@/lib/sdui/computed-runner';
import { VALIDATION_RULE_KEYS } from '@/lib/sdui/engine-types';
import { ALLOWED_SDUI_TYPES } from '@/config/schema/layout-schema';
import { SECTION_VARIANTS } from '@/config/section-variants';
import {
  UI_NODE_FIELDS,
  UI_NODE_KEY_ORDER,
} from '@/config/ui-node-schema';

/** Build JSON syntax rules - critical for valid output */
export function buildJsonSyntaxContext(): string {
  return `JSON SYNTAX (config/*.json):
- No trailing commas — never add , before } or ]
- Escape quotes in strings — use \\" inside strings, not raw "
- No comments — JSON does not support // or /* */
- Run npm run validate:json after edits`;
}

/** Build UI node schema reference */
export function buildUiNodeContext(): string {
  const fieldLines = Object.entries(UI_NODE_FIELDS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  return `UI NODE (JSON tree structure):
${fieldLines}

Key order: ${UI_NODE_KEY_ORDER.join(' → ')}. Interpolation: {{path}}. In map: {{$item.field}}, {{$index}}.`;
}

/** Build component reference - all types and addNodes subset */
export function buildComponentContext(): string {
  const allTypes = [...COMPONENT_NAMES].slice(0, 50).join(', ');
  const addNodesTypes = [...ALLOWED_SDUI_TYPES].join(', ');
  return `COMPONENTS (type field):
- Full registry: ${allTypes}${COMPONENT_NAMES.length > 50 ? '...' : ''}
- addNodes (restricted): ${addNodesTypes} only. Never invent types.`;
}

/** Build JSON Logic reference - uses imported ops list */
export function buildJsonLogicContext(): string {
  const customOps = [...JSON_LOGIC_CUSTOM_OPS].join(', ');
  return `JSON LOGIC (condition, mapSourceOverrides.expr, textOverrides.expr):
- var: { "var": "path" } or { "var": ["path", default] }. In map: $item, $index.
- Comparisons: { "==": [a,b] }, { "!=": [a,b] }, { ">": [a,b] }, { "<": [a,b] }.
- Logic: { "and": [...] }, { "or": [...] }, { "!": [expr] }.
- Conditional: { "if": [cond, thenVal, elseVal] }.
- Array: { "reverseArray": [...] }, { "reduce": [arr, fn, init] }.
- Custom ops: ${customOps}. Signatures: findItemById([arr, id]), findItemByOptionsMatch([variants, optionGroups, selectedOptions]), groupBy([arr, groupByField, keyField]), paginationPages([totalItems, skip, pageSize, delta?]), filterExcludeByFieldAndSlice([items, field, excludeValue, limit]), lookupMap([map, key, default]), getFromMap([map, key]), at([arr, index]), formatCurrency([num, currency]).`;
}

/** Build computed ops reference with real examples from codebase */
export function buildComputedOpsContext(): string {
  const customOps = [...JSON_LOGIC_CUSTOM_OPS].join(', ');
  return `COMPUTED OPS (text.expr, condition, store.json computed):
- Custom ops: ${customOps}
- formatCurrency([num, currency]): { "formatCurrency": [{ "var": "cart.subTotalWithTax" }, "USD"] } for money display
- findItemById([arr, id]): { "findItemById": [{ "var": "product.variants" }, { "var": "product.selectedVariantId" }] } for variant lookup
- findItemByOptionsMatch([variants, optionGroups, selectedOptions]): match variant by selected options
- groupBy([arr, groupByField, keyField]): { "groupBy": [{ "var": "collection.products" }, "optionGroupId", "id"] } for facet groups
- paginationPages([totalItems, skip, pageSize, delta?]): page numbers with ellipsis for pagination UI
- getFromMap([map, key]): { "getFromMap": [{ "var": "product.selectedOptions" }, { "var": "$parent.id" }] } for option value
- lookupMap([map, key, default]): sort label lookup. at([arr, index]): get item at index
- filterExcludeByFieldAndSlice([items, field, excludeValue, limit]): related products excluding current`;
}

/** Build validation rules reference */
export function buildValidationContext(): string {
  const rules = [...VALIDATION_RULE_KEYS].join(', ');
  return `VALIDATION (type: "validate", rules per field):
- Keys: ${rules}.
- pattern: "email" for email format. equalsField: "form.password" for confirm password.
- storeErrorsIn: path for errors (default "errors"). onSuccess: action to run when valid.`;
}

/** Build screen schema reference */
export function buildScreenContext(): string {
  return `SCREEN (config/screens/*.json):
- meta: { title, description }
- state: initial state (form, errors, modal, etc.)
- layout: "store" | "account" | "checkoutMinimal" — wraps content with navbar + $slot + footer
- content: UI tree injected into layout $slot (or use ui for standalone screens)
- initActions: [{ action: "fetchX" }] — run on mount. Use for data fetching.`;
}

/** Build layout schema reference */
export function buildLayoutContext(): string {
  const layoutNames = Object.keys(layouts).join(', ');
  return `LAYOUT (config/layouts/*.json):
- structure: { type, children: [$ref, { $slot: "content" }, $ref] }
- $ref: "fragments/layout/navbar", "fragments/layout/footer", etc.
- $slot: "content" — replaced with screen content
- Available: ${layoutNames}`;
}

/** Build layout part context (navbar structure, hero/footer overrides) */
export function buildLayoutPartOverridesContext(): string {
  const addNodesTypes = [...ALLOWED_SDUI_TYPES].join(', ');
  const nodeIds = [
    'navbar-root',
    'navbar-inner',
    'navbar-row',
    'navbar-left',
    'navbar-right',
    'navbar-search',
    'navbar-actions',
    'navbar-collections',
    'navbar-theme',
    'navbar-theme-button',
    'navbar-cart',
    'navbar-cart-badge',
    'navbar-auth',
    'navbar-sign-in',
    'navbar-logo',
    'navbar-logo-image',
  ].join(', ');
  return `LAYOUT PARTS:
- Navbar: full structure from scratch. Output { structure: <root node> }. Root must have id: "navbar-root". node.type: ${addNodesTypes} only.
- Navbar node IDs (use for consistency): ${nodeIds}
- Hero/Footer: use override pattern (variant + overrides) when implemented.`;
}

/** Build navbar-specific theme vars from theme.json or predefined random theme */
export function buildNavbarThemeVarsContext(predefinedTheme?: {
  themeVars: Record<string, string>;
}): string {
  if (predefinedTheme?.themeVars && Object.keys(predefinedTheme.themeVars).length > 0) {
    const lines = Object.entries(predefinedTheme.themeVars)
      .map(([name, value]) => `  ${name}: ${value}`)
      .join('\n');
    return `NAVBAR THEME VARS (predefined - use these exactly, do not change):
\`\`\`
${lines}
\`\`\`
- Use in className: bg-[var(--theme-header-bg)], text-[var(--theme-header-text)], border-[var(--theme-header-border)]
- Cart badge: bg-[var(--theme-shop-button)], text-[var(--theme-shop-buttonText)]
- Dropdown: border-[var(--border)], bg-[var(--theme-content-bg)]
- Theme vars are predefined. Focus on navbar structure only.`;
  }

  const sections = themeJson.sections as Record<string, Record<string, string>> | undefined;
  const vars: string[] = [];
  if (sections) {
    for (const [section, values] of Object.entries(sections)) {
      for (const key of Object.keys(values)) {
        vars.push(`--theme-${section}-${key}`);
      }
    }
  }
  const fallback = '--theme-header-bg, --theme-header-text, --theme-header-border, --theme-content-bg, --theme-content-text, --theme-content-textMuted, --theme-shop-button, --theme-shop-buttonHover, --theme-shop-buttonText, --border';
  const varList = vars.length ? vars.join(', ') : fallback;
  return `NAVBAR THEME VARS (use in className, never hardcode hex):
- ${varList}
- Example: bg-[var(--theme-header-bg)], text-[var(--theme-header-text)], border-[var(--theme-header-border)]
- Cart badge: bg-[var(--theme-shop-button)], text-[var(--theme-shop-buttonText)]
- Dropdown: border-[var(--border)], bg-[var(--theme-content-bg)]`;
}

/** Build navbar-relevant layout actions from config/actions/layout.json */
export function buildNavbarActionsContext(): string {
  const layout = layoutActions as Record<string, unknown>;
  const names = Object.keys(layout).join(', ');
  return `LAYOUT ACTIONS (use exact action name in actions.click):
- ${names}
- Theme: toggleThemeMenu, closeThemeMenu, setThemeLight, setThemeDark, setThemeSystem
- Cart: goToCart, openCartDrawer, closeCartDrawer
- Navigate: { "action": "navigate", "payload": { "path": "/..." } } or { "action": "navigate", "payload": { "routeConfig": "collection", "slug": { "var": "$item.slug" } } }`;
}

/** Build navbar state paths from store.json initialData */
export function buildNavbarStateContext(): string {
  const data = storeJson.initialData as Record<string, unknown>;
  const nav = data?.nav as Record<string, unknown> | undefined;
  const auth = data?.auth as Record<string, unknown> | undefined;
  const cart = data?.cart as Record<string, unknown> | undefined;
  const navKeys = nav ? Object.keys(nav).join(', ') : 'collections, searchQuery, themeMenuOpen, colorScheme';
  const authKeys = auth ? Object.keys(auth).join(', ') : 'user';
  const cartKeys = cart ? Object.keys(cart).join(', ') : 'totalQuantity, lines, ...';
  return `NAVBAR STATE (store.json initialData):
- nav: ${navKeys}. Use nav.collections for map, nav.themeMenuOpen for theme dropdown, nav.colorScheme for current theme.
- auth.user: null when logged out. Use for Sign in vs logged-in UI.
- cart.totalQuantity: for cart badge. Condition: { ">": [{ "var": ["cart.totalQuantity", 0] }, 0] }`;
}

/** Build navbar node IDs - use for consistency with existing structure */
export function buildNavbarNodeIdsContext(): string {
  const ids = [
    'navbar-root',
    'navbar-inner',
    'navbar-row',
    'navbar-left',
    'navbar-right',
    'navbar-search',
    'navbar-actions',
    'navbar-collections',
    'navbar-theme',
    'navbar-theme-button',
    'navbar-cart',
    'navbar-cart-badge',
    'navbar-auth',
    'navbar-sign-in',
    'navbar-logo',
    'navbar-logo-image',
  ];
  return `NAVBAR NODE IDS (use for consistency): ${ids.join(', ')}`;
}

/** Build section types and variants for layout schema */
export function buildSectionContext(): string {
  const sectionTypes = Object.keys(SECTION_VARIANTS).join(', ');
  const variantLines = Object.entries(SECTION_VARIANTS).map(
    ([type, variants]) =>
      `  ${type}: ${variants.map((v) => v.id).join(', ')}`
  );
  const contentTypes = ['hero', 'product-grid', 'product-carousel', 'feature-grid'].join(', ');
  return `SECTIONS (layout schema):
- Section types: ${sectionTypes}
- Variants per type:
${variantLines.join('\n')}
- Content section types (for schema-to-screen): ${contentTypes}`;
}

/** Build action type details (fetch, graphql, validate, etc.) */
export function buildActionTypeDetailsContext(): string {
  return `ACTION TYPE DETAILS:
- fetch: url, method, storeIn, responsePath, body (supports { "var": "path" }), onSuccess
- graphql: query, variables (supports { "var": "path" }), storeIn, responsePath, errorMessagePath, onSuccess. Uses engineConventions.graphqlEndpoint.
- validate: rules { "form.field": { required, minLength, pattern: "email", equalsField, message } }, storeErrorsIn, onSuccess
- set: path, value (Zustand)
- setVar: path, value — variable store (same as increment/decrement/toggle). Use for collectionSkip, sortMenuOpen, etc.
- increment/decrement: path, amount, min (default 0). Variable store.
- toggle: path — variable store
- runMultiple: actions: [{ action }, { type, path, value }]
- navigate: payload: { path } or { routeConfig, slug: { "var": "$item.slug" } }
- appendToPath: targetPath, value (supports { "var" }, { "expr" }), resetFormPath
- mergeArraysByKey: targetPath, sourcePath, arrayPath, keyPath, aggregate
- navigateWithQuery: for facet filters (toggle facets in URL). goToPage: pagination. setTheme: theme switching.`;
}

/** Build theme variables reference */
export function buildThemeContext(): string {
  const sections = themeJson.sections as Record<string, Record<string, string>> | undefined;
  const sectionKeys = sections ? Object.keys(sections).join(', ') : 'header, footer, hero, content, shop';
  const colorKeys = 'heroBg, headerBg, headerText, headerBorder, button, buttonHover, buttonText, footerBg, footerText, footerTextMuted';
  const presets = themeJson.presets as Record<string, Record<string, unknown>> | undefined;
  const presetKeys = presets ? Object.keys(presets).join(', ') : 'modern, luxury';
  return `THEME (config/theme.json):
- Sections: ${sectionKeys}. Each has bg, text, textMuted, border, etc.
- Use in className: bg-[var(--theme-header-bg)], text-[var(--theme-header-text)], etc.
- Flat keys: ${colorKeys}
- Presets: ${presetKeys}. Structure: theme.presets.<name>.sections.<section>.<key> (e.g. presets.luxury.sections.hero.bg, presets.modern.sections.shop.button).`;
}

/** Build engineConventions reference */
export function buildEngineConventionsContext(): string {
  const conv = storeJson.engineConventions as Record<string, unknown> | undefined;
  if (!conv) return 'ENGINE CONVENTIONS: See store.json engineConventions.';
  const keys = Object.keys(conv).join(', ');
  const globalInit = (storeJson.globalInitActions as Array<{ action: string }> | undefined)?.map((a) => a.action).join(', ') ?? 'fetchNavCollections, fetchCart';
  const varStore = storeJson.variableStoreInitial as Record<string, unknown> | undefined;
  const varPaths = varStore ? Object.keys(varStore).join(', ') : 'collectionSkip, sortMenuOpen, product.selectedOptions';
  return `ENGINE CONVENTIONS (store.json):
- Keys: ${keys}
- loadingSuffix/errorSuffix: appended to storeIn path for loading/error state
- screenScopedAliases: form, errors — use {{form.field}} not {{screens.x.form.field}}
- workflowPath: _workflow — lastAction, lastError for API/validation errors
- globalInitActions: run on every page load (e.g. ${globalInit}). Use for layout-level data.
- variableStoreInitial: initial values for variable store paths (${varPaths}). Variable store vs Zustand: setVar/increment/decrement/toggle write to variable store; set writes to Zustand.`;
}

/** Build searchParamSync reference */
export function buildSearchParamSyncContext(): string {
  const sync = storeJson.searchParamSync as Array<Record<string, unknown>> | undefined;
  if (!sync?.length) return 'SEARCH PARAM SYNC: Define in store.json searchParamSync for URL-driven state.';
  const examples = sync.slice(0, 4).map((s) => `${s.param}→${s.path}`).join('; ');
  return `SEARCH PARAM SYNC (store.json):
- param, path, default, variableStorePath, triggersParamChange, routePrefix, transform (pageToSkip), pageSize
- Examples: ${examples}
- triggersParamChange: true → runs route paramChangeAction on URL change`;
}

/** Build component-specific patterns (Input, Select, Form) */
export function buildComponentPatternsContext(): string {
  return `COMPONENT PATTERNS:
- Pressable, Box, View: never use raw text as direct child — wrap in { type: "Text", text: "..." }. Raw text causes runtime error.
- Input: Use Input > InputSlot + InputField. Override Gluestack tokens with ! (e.g. !text-gray-900). placeholderTextColor prop for placeholder.
- Select: Select > SelectTrigger (SelectInput, SelectIcon) + SelectPortal (SelectBackdrop, SelectContent, SelectItem per option). valueChange action.
- Form: Form wraps ModalBody + ModalFooter. FormSubmitButton inside Form. submitAction triggers validate then mutation.
- Form validation paths: condition uses full path screens.signIn.errors.form.email; setState path must be full screens.signIn.form.email; text interpolation {{errors.form.email}} works (alias).
- Map in grid: Box with grid + child Box map className "contents" so items become direct grid children.`;
}

/** Build event handlers reference */
export function buildEventHandlersContext(): string {
  return `EVENT HANDLERS (actions on nodes):
- click: Pressable, Button, MenuItem
- change: InputField, TextareaInput — $event = value
- keyDown: InputField (e.g. Enter to search)
- valueChange: Select — $event = selected value
- Clear field error on change: runMultiple with setState + clear errors path`;
}

/** Build state paths reference from store.json with nested paths */
export function buildStateContext(): string {
  const initialData = storeJson.initialData as Record<string, unknown>;
  const topLevel = Object.keys(initialData ?? {}).join(', ');
  const paths = storeJson.paths as Record<string, string> | undefined;
  const pathMappings = paths ? Object.entries(paths).map(([k, v]) => `${k}→${v}`).join(', ') : '';
  const conventions = storeJson.engineConventions as Record<string, unknown> | undefined;
  const aliases = (conventions?.screenScopedAliases as string[])?.join(', ') ?? 'form, errors';

  const nestedStr = `
- Nested paths: auth.user, auth.token, cart.totalQuantity, cart.lines, cart.subTotalWithTax, nav.collections, nav.themeMenuOpen, nav.searchQuery, route.path, route.slug, route.q, route.facets, collectionSkip, searchSkip, layout.drawerOpen, layout.cartDrawerOpen, checkout.step, _workflow.lastAction, _workflow.lastError`;

  return `STATE (store.json):
- Top-level: ${topLevel}.
- Paths: ${pathMappings || 'authUser, routePath, routeSlug, etc.'}
- Screen-scoped aliases: ${aliases}. Use {{form.field}} or {{screens.{name}.form.field}}.
- Workflow: _workflow.lastAction, _workflow.lastError.${nestedStr}`;
}

/** Build fragment keys reference for $ref */
export function buildFragmentContext(): string {
  const keys = Object.keys(fragments).slice(0, 25);
  return `FRAGMENTS ($ref): ${keys.join(', ')}${Object.keys(fragments).length > 25 ? '...' : ''}`;
}

/** Build action types from all action configs */
export function buildActionTypesContext(): string {
  const allActions = {
    ...(layoutActions as Record<string, unknown>),
    ...(authActions as Record<string, unknown>),
    ...(cartActions as Record<string, unknown>),
    ...(checkoutActions as Record<string, unknown>),
    ...(accountActions as Record<string, unknown>),
    ...(productsActions as Record<string, unknown>),
  };
  const types = new Set<string>();
  for (const def of Object.values(allActions)) {
    if (def && typeof def === 'object' && 'type' in def) {
      types.add(String((def as { type: string }).type));
    }
    if (def && typeof def === 'object' && 'action' in def) {
      types.add('navigate');
    }
  }
  return `ACTION TYPES: ${[...types].sort().join(', ')}`;
}

/** Compact action ref for layout generator (single line) */
export function buildActionContextCompact(): string {
  const layoutActionNames = Object.keys(layoutActions as Record<string, unknown>);
  const navRelevant = layoutActionNames.filter(
    (n) =>
      !n.startsWith('apply') &&
      n !== 'setThemeLight' &&
      n !== 'setThemeDark' &&
      n !== 'setThemeSystem'
  );
  return `Format: { "action": "name" } or { "action": "navigate", "payload": { "path": "/..." } }. Names: ${navRelevant.join(', ')}.`;
}

/** Build action reference section - how to reference/call actions in JSON */
export function buildActionContext(): string {
  const layoutActionNames = Object.keys(layoutActions as Record<string, unknown>);
  const navRelevant = layoutActionNames.filter(
    (n) =>
      !n.startsWith('apply') &&
      n !== 'setThemeLight' &&
      n !== 'setThemeDark' &&
      n !== 'setThemeSystem'
  );

  return `ACTIONS (config/actions/*.json):
- Named: { "action": "actionName" } — references action from config. Use for: ${navRelevant.join(', ')}.
- Inline navigate: { "action": "navigate", "payload": { "path": "/cart" } } or { "action": "navigate", "payload": { "routeConfig": "collection", "slug": { "var": "$item.slug" } } } for dynamic routes.
- Inline setState: { "action": "setState", "payload": { "path": "nav.searchQuery", "value": "$event" } } — $event = input value in change handlers.
- runMultiple: { "type": "runMultiple", "actions": [{ "action": "closeDrawer" }, { "action": "navigate", "payload": { "path": "/" } }] }.
- set (Zustand): { "type": "set", "path": "layout.drawerOpen", "value": true }.
- toggle: { "type": "toggle", "path": "nav.themeMenuOpen" }.
- stopPropagation: true on actions inside clickable parents (e.g. addToWishlistFromCard) so parent click does not fire.`;
}

/** Build routes reference for navigation payloads */
export function buildRoutesContext(): string {
  const routesList = (routes as { routes?: Array<{ path: string; config: string; dynamic?: boolean }> })
    .routes ?? [];
  const staticPaths = routesList
    .filter((r) => !r.dynamic)
    .map((r) => `${r.path} (config: ${r.config})`)
    .slice(0, 12);
  const dynamicRoutes = routesList
    .filter((r) => r.dynamic)
    .map((r) => `${r.path} → routeConfig: "${r.config}", slug: { "var": "$item.slug" }`);

  return `ROUTES (config/routes.json):
- Static: path "/", "/cart", "/sign-in", "/collection", etc.
- Dynamic: use routeConfig + slug. Examples: ${dynamicRoutes.join('; ')}.
- paramChangeAction: for routes with searchParamSync triggersParamChange, set to exact action name (e.g. fetchCollection, fetchSearchResults). Must match config/actions key.`;
}

/** Build full SDUI reference for AI - comprehensive schema, components, validation, state, actions */
export function buildSduiReference(): string {
  return [
    buildJsonSyntaxContext(),
    buildScreenContext(),
    buildLayoutContext(),
    buildLayoutPartOverridesContext(),
    buildSectionContext(),
    buildUiNodeContext(),
    buildComponentContext(),
    buildComponentPatternsContext(),
    buildEventHandlersContext(),
    buildJsonLogicContext(),
    buildComputedOpsContext(),
    buildValidationContext(),
    buildStateContext(),
    buildEngineConventionsContext(),
    buildThemeContext(),
    buildSearchParamSyncContext(),
    buildFragmentContext(),
    buildActionTypesContext(),
    buildActionTypeDetailsContext(),
    buildActionContext(),
    buildRoutesContext(),
  ].join('\n\n');
}
