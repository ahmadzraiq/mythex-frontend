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
