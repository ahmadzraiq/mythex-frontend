/**
 * Creates a getter for resolving variable paths in SDUI renderer
 * Resolution order: scope vars → merged state → variable store → undefined
 */

import { getNestedValue } from './nested-utils';
import { isScreenScopedPath, isScopeVariable } from './path-utils';

export type CreateGetStore = {
  getState: () => {
    get: (path: string, scope?: Record<string, unknown>) => unknown;
  };
};

export type CreateGetMergedStore = {
  getState: () => { merged: Record<string, unknown> };
};

/**
 * Creates a getter that resolves paths in this order:
 * 1. Scope vars ($item, $index, $parent) when scope is provided
 * 2. Merged state (Zustand + variable store overlay + computed)
 * 3. Variable store (fallback when not in merged)
 * 4. undefined
 * Screen-scoped paths (form, errors) are resolved to screens.{screenName}.{path}.
 */
export function createGet(
  store: CreateGetStore,
  mergedState: Record<string, unknown> | undefined,
  scope: Record<string, unknown> | undefined,
  mergedStore: CreateGetMergedStore | undefined,
  screenName: string | undefined,
  screenScopedAliases: string[]
): (path: string, s?: Record<string, unknown>) => unknown {
  return (path: string, s?: Record<string, unknown>) => {
    const sc = s ?? scope;
    if (sc) {
      // Resolve from scope when: it's a known scope variable ($item etc / context.*)
      // OR the root key of the path exists directly in the scope object.
      const rootKey = path.split('.')[0];
      if (isScopeVariable(path) || rootKey in (sc as Record<string, unknown>)) {
        return getNestedValue(sc, path);
      }
    }
    const resolvedPath =
      screenName && isScreenScopedPath(path, screenScopedAliases)
        ? `screens.${screenName}.${path}`
        : path;
    const merged = mergedStore?.getState().merged ?? mergedState;
    if (merged) {
      const fromMerged = getNestedValue(merged, resolvedPath);
      if (fromMerged !== undefined) return fromMerged;
    }
    return store.getState().get(resolvedPath, sc);
  };
}
