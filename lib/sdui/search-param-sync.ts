/**
 * Search param sync - URL query params to store
 * Config-driven; no hardcoded paths in page
 */

import { setNestedValue } from './nested-utils';

export type SearchParamSyncDef = {
  param: string;
  path: string;
  default?: string;
  type?: 'array';
  transform?: string;
  pageSize?: number;
  variableStorePath?: string;
  triggersParamChange?: boolean;
  /** When set, only apply this sync when pathname.startsWith(routePrefix) */
  routePrefix?: string;
};

/** Shape of a variable entry with optional urlParam field */
type VariableWithUrlParam = {
  initialValue?: unknown;
  urlParam?: {
    param: string;
    /** Zustand path to write the value to (e.g. "route.q"). Defaults to the variable UUID. */
    path?: string;
    default?: string;
    type?: 'array';
    transform?: string;
    pageSize?: number;
    triggersParamChange?: boolean;
    routePrefix?: string;
  };
};

/**
 * Build SearchParamSyncDef array from variables.json entries that have a urlParam field.
 * Replaces store.json searchParamSync — no hardcoded paths needed in page.tsx.
 */
export function buildSyncDefsFromVariables(
  variables: Record<string, VariableWithUrlParam>
): SearchParamSyncDef[] {
  const defs: SearchParamSyncDef[] = [];
  for (const [uuid, variable] of Object.entries(variables)) {
    const urlParam = variable.urlParam;
    if (!urlParam) continue;
    // path in Zustand store (for route.* keys); defaults to UUID (for pagination UUIDs)
    const path = urlParam.path ?? uuid;
    const def: SearchParamSyncDef = {
      param: urlParam.param,
      path,
      variableStorePath: uuid,
    };
    if (urlParam.default !== undefined) def.default = urlParam.default;
    else if (
      typeof variable.initialValue === 'string' &&
      urlParam.type !== 'array'
    ) {
      def.default = variable.initialValue;
    }
    if (urlParam.type) def.type = urlParam.type;
    if (urlParam.transform) def.transform = urlParam.transform;
    if (urlParam.pageSize !== undefined) def.pageSize = urlParam.pageSize;
    if (urlParam.triggersParamChange) def.triggersParamChange = true;
    if (urlParam.routePrefix) def.routePrefix = urlParam.routePrefix;
    defs.push(def);
  }
  return defs;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

type SyncParams = {
  searchParams: URLSearchParams | null;
  syncDefs: SearchParamSyncDef[];
  pathname?: string;
  setData: (path: string, value: unknown) => void;
  getVariableStoreSet: () => (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  getStoreValue: (path: string) => unknown;
  paramChangeAction?: string;
  runParamChangeAction: (action: string) => void;
  paramSyncMountedRef: { current: boolean };
};

/**
 * Syncs URL search params to Zustand store and optionally variable store.
 * When triggersParamChange and paramChangeAction are set, runs the action after sync.
 */
export function syncSearchParams({
  searchParams,
  syncDefs,
  pathname = '/',
  setData,
  getVariableStoreSet,
  getStoreValue,
  paramChangeAction,
  runParamChangeAction,
  paramSyncMountedRef,
}: SyncParams): void {
  let paramSyncDidUpdate = false;
  for (const def of syncDefs) {
    if (def.routePrefix && !pathname.startsWith(def.routePrefix)) continue;
    let value: unknown =
      def.type === 'array'
        ? searchParams?.getAll(def.param) ?? []
        : searchParams?.get(def.param) ?? (def.default ?? '');
    if (def.transform === 'pageToSkip') {
      const page = Math.max(1, parseInt(String(value || def.default || '1'), 10) || 1);
      value = (page - 1) * (def.pageSize ?? 12);
    }
    const current = getStoreValue(def.path);
    if (!valuesEqual(current, value)) {
      setData(def.path, value);
      if (def.variableStorePath) {
        getVariableStoreSet()((prev) => setNestedValue(prev, def.variableStorePath!, value));
      }
      if (def.triggersParamChange) {
        paramSyncDidUpdate = true;
      }
    }
  }
  if (paramSyncMountedRef.current && paramSyncDidUpdate && paramChangeAction) {
    setTimeout(() => runParamChangeAction(paramChangeAction), 0);
  }
  paramSyncMountedRef.current = true;
}
