# SDUI Code Architecture

Read this before modifying lib/sdui/, actions, or the engine. For JSON config changes, see [BUILD-GUIDE.md](./BUILD-GUIDE.md).

---

## 1. lib/sdui/ Structure

```
lib/sdui/
├── sdui-engine.tsx      # Entry: state merge, subscriptions, action dispatch
├── renderer.tsx         # JSON → React; conditions, map, actions
├── config-resolver.ts   # $slot, layout composition
├── merge-state.ts       # computeMergedState, path merging
├── variable-store.ts    # Path-based store
├── dependency-extractor.ts  # extractNodeDependencies, extractPathsFromObject, expandComputedDeps
├── computed-runner.ts   # store.json computed (output/formula)
├── fetch-cache.ts       # Config-driven fetch cache (tag + vars, TTL)
├── conventions.ts       # engineConventions from store.json
├── path-utils.ts        # isScreenScopedPath, isScopeVariable
├── nested-utils.ts      # getNestedValue, setNestedValue
├── utils.ts             # interpolate, resolveProps, resolveText, evaluateCondition
├── global-variable-store.ts  # Singleton variable store instance
├── component-registry.tsx    # COMPONENT_REGISTRY, getComponent
├── icons.tsx                # Legacy Lucide icon map (internal use only)
├── components/              # IconifyIcon, NextImage (Image alias), HtmlContent, InputWithField, Video
├── run-action-context.tsx   # RunActionProvider, useRunAction
├── carousel.tsx         # Carousel (custom component)
├── types/               # SDUINode, SDUIConfig, payloads, etc.
├── create-get.ts        # createGet (path resolution)
├── action-binding.ts    # bindActionsToProps
├── search-param-sync.ts # syncSearchParams, SearchParamSyncDef
├── route-utils.ts       # matchRoute, sortRoutes
├── index.ts             # Public exports
└── actions/
    ├── index.ts         # Re-exports resolve-value
    ├── resolve-value.ts # interpolateUrl, resolvePayload, resolveValue
    └── handlers/         # Per-type action handlers (fetch, graphql, set, etc.)
```

---

## 2. Data Flow

```
config/store.json, screens/*.json, actions/*.json
         │
         ▼
   config-resolver.ts  ($slot → screen content injection)
         │
         ▼
   config/app.ts  (resolveScreenConfig, merge actions)
         │
         ▼
   sdui-engine.tsx
   ├── computeMergedState (merge-state.ts)
   ├── finalizeMergedWithVariableStore (variable store overlay + computed)
   ├── mergedStore (Zustand) ← subscriptions
   └── runAction → action handlers
         │
         ▼
   renderer.tsx
   ├── createGet (create-get.ts)
   ├── extractNodeDependencies (dependency-extractor.ts)
   ├── useVariablePaths (selective subscription)
   └── SDURendererInner (conditions, map, props, actions)
         │
         ▼
   component-registry.tsx (getComponent) → React components
```

---

## 3. Key Concepts

### Two "Computed" Systems

| System | File | Shape | Purpose |
|--------|------|-------|---------|
| **Variable store computed** | variable-store.ts | `{ type, source, path }` | Reduce-style (e.g. cart.totalQuantity from lines) |
| **store.json computed** | computed-runner.ts | `{ output, formula }` | Formula-based derived values (collectionCurrentPage, sortLabel) |

### Resolution Order (createGet)

1. Scope vars (`context.item.data.*`, `context.item.parent.data.*`) when scope provided
2. Merged state (Zustand + variable store overlay + store.json computed)
3. Variable store (fallback — `variables['UUID']`)
4. undefined

**`screens.*` paths are dead.** All mutable state uses `variables['UUID']` from `config/variables.json`. Form state lives at `local.data.form.*` (scoped per FormContainer).

### Adding a New Action Type

1. In `sdui-engine.tsx`, add `if (actionDef?.type === 'myType') { ... }` in `runOne`.
2. (Phase 2) Or add a handler in `lib/sdui/actions/handlers/` and register in `ACTION_HANDLERS`.

---

## 4. Dependencies

- **sdui-engine.tsx** imports: renderer, global-variable-store, run-action-context, merge-state, computed-runner, conventions, path-utils, actions/resolve-value, nested-utils
- **renderer.tsx** imports: component-registry, utils, variable-store, types, nested-utils, path-utils
- **merge-state.ts** imports: nested-utils, computed-runner, conventions
- **variable-store.ts** imports: nested-utils, types
- No circular dependencies.

---

## 5. Config Sources

| Config | Purpose |
|--------|---------|
| config/store.json | initialData, engineConventions, computed, searchParamSync |
| config/routes.json | Paths, auth, layout, paramChangeAction |
| config/actions/*.json | Action definitions (fetch, graphql, validate, set, etc.) |
| config/screens/*.json | Screen meta, state, layout, content |
| config/layouts/*.json | Layout structures with `$slot` and inlined shared components |
| config/shared-components.json | Reusable UI models (navbar, footer, product cards, etc.) |
| config/store-config.ts | Merges store.json with env vars (NEXT_PUBLIC_GRAPHQL_*, NEXT_PUBLIC_VENDURE_TOKEN) |

---

## 6. Engine & Performance Patterns (AI Must Preserve)

When modifying lib/sdui/, preserve these patterns:

| Pattern | Location | Purpose |
|---------|----------|---------|
| **Structural sharing in setNestedValue** | nested-utils.ts | Only clones path branch, not entire tree. O(depth) not O(tree). Do not revert to JSON.parse(JSON.stringify). |
| **useVariablePaths — no early return** | variable-store.ts | Must always call useSyncExternalStore. When expanded.length === 0, use no-op subscribe and return EMPTY_ARRAY from getSnapshot. React hooks rules require unconditional hook calls. |
| **Computed memoization** | computed-runner.ts | Memo cache per output; skip jsonLogic.apply when deps unchanged. Do not remove. |
| **Fetch cache LRU** | fetch-cache.ts | Max 100 entries; evict expired first, then oldest. Prevents unbounded memory growth. |
| **searchParamSync routePrefix** | search-param-sync.ts, store.json | When routePrefix is set, only apply sync when pathname.startsWith(routePrefix). Used for collectionSkip vs searchSkip (independent pagination). |
| **collectionSkip vs searchSkip** | store.json, products.json, pagination fragments | Collection and search have independent pagination. collectionSkip for /collection, searchSkip for /search. goToPage/increment/decrement must use correct path. |
