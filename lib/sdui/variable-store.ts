/**
 * Variable Store - Generic reactive state for SDUI
 * Path-based get/set, adapters for external state (Zustand, etc.), computed variables
 * Uses Zustand for fine-grained subscriptions - only re-render when watched paths change
 *
 * Variable store computed (ComputedDef: type/source/path): reduce-style, e.g. cart.totalQuantity
 * from cart.lines. Distinct from store.json computed (output/expr) in computed-runner.ts.
 */

import { useRef, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { getNestedValue, setNestedValue } from './nested-utils';
import { expandComputedDeps } from './dependency-extractor';

export interface ComputedDef {
  type: string;
  source: string;
  path?: string;
  initial?: number;
  op?: string;
}

export interface StoreAdapter {
  slice: string;
  getState: () => Record<string, unknown>;
}

export interface VariableStoreConfig {
  initialState?: Record<string, unknown>;
  computed?: Record<string, ComputedDef>;
  adapters?: StoreAdapter[];
}

interface StoreState {
  data: Record<string, unknown>;
}

interface StoreActions {
  get: (path: string, scope?: Record<string, unknown>) => unknown;
  set: (path: string, value: unknown, merge?: boolean) => void;
  mergeSlice: (slice: string, value: Record<string, unknown>) => void;
  getFullState: () => Record<string, unknown>;
  replaceState: (data: Record<string, unknown>) => void;
  setState: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
}

type Store = StoreState & StoreActions & { _config: VariableStoreConfig };

function computeValue(
  path: string,
  data: Record<string, unknown>,
  config: VariableStoreConfig
): unknown {
  if (path == null || typeof path !== 'string') return undefined;
  const computedDef = config.computed?.[path];
  if (computedDef?.type === 'reduce' && computedDef.source) {
    const arr = (getNestedValue(data, computedDef.source) as unknown[]) ?? [];
    const itemPath = computedDef.path ?? 'quantity';
    return arr.reduce(
      (sum: number, item: unknown) =>
        sum + (Number(getNestedValue(item as Record<string, unknown>, itemPath)) || 0),
      computedDef.initial ?? 0
    );
  }
  return getNestedValue(data, path);
}

export function createVariableStore(config: VariableStoreConfig = {}) {
  const { initialState = {}, computed = {}, adapters = [] } = config;

  const useStore = create<Store>()(
    subscribeWithSelector((set, get) => ({
      _config: config,
      data: JSON.parse(JSON.stringify(initialState)),

      get: (path: string, scope?: Record<string, unknown>) => {
        if (scope && (path.startsWith('$item') || path.startsWith('$index') || path.startsWith('$parent') || path === '$item' || path === '$index' || path === '$parent')) {
          return getNestedValue(scope, path);
        }
        const state = get();
        let data = { ...state.data };
        for (const adapter of adapters) {
          if (path === adapter.slice || path.startsWith(adapter.slice + '.')) {
            data[adapter.slice] = adapter.getState();
            break;
          }
        }
        return computeValue(path, data, config);
      },

      set: (path: string, value: unknown, merge = false) => {
        set((state) => ({
          data: setNestedValue(state.data, path, value, merge),
        }));
      },

      mergeSlice: (slice: string, value: Record<string, unknown>) => {
        set((state) => ({
          data: { ...state.data, [slice]: value },
        }));
      },

      getFullState: () => {
        const state = get();
        let data = { ...state.data };
        for (const adapter of adapters) {
          data[adapter.slice] = adapter.getState();
        }
        return data;
      },

      replaceState: (nextData: Record<string, unknown>) => {
        set({ data: nextData });
      },

      setState: (updater) => {
        const next = updater(get().getFullState());
        set({ data: next });
      },
    }))
  );

  return useStore;
}

const EMPTY_SNAPSHOT = '';

type MergedStore = { getState: () => { merged: Record<string, unknown> }; subscribe: (cb: () => void) => () => void };

/** Hook: subscribe to paths - only re-renders when these values change.
 *  When mergedStore is provided, subscribes to both for selective re-renders.
 *  Returns a stable string snapshot (useSyncExternalStore requires cached result to avoid infinite loop). */
export function useVariablePaths(
  store: ReturnType<typeof createVariableStore>,
  paths: string[],
  scope?: Record<string, unknown>,
  mergedStore?: MergedStore
): unknown[] {
  const config = (store.getState() as Store)._config;
  const expanded = expandComputedDeps(paths, config.computed);
  const serverSnapshotRef = useRef<string | null>(null);
  const clientSnapshotRef = useRef<string>(EMPTY_SNAPSHOT);

  const getSnapshot = (): string => {
    if (expanded.length === 0) return EMPTY_SNAPSHOT;
    const values = expanded.map((p) => {
      if (typeof p !== 'string') return undefined;
      if (scope && (p.startsWith('$item') || p.startsWith('$index') || p.startsWith('$parent'))) {
        return getNestedValue(scope, p);
      }
      if (mergedStore) {
        return getNestedValue(mergedStore.getState().merged, p);
      }
      const state = store.getState();
      return computeValue(p, state.data, config);
    });
    try {
      const str = JSON.stringify(values);
      if (str === clientSnapshotRef.current) return clientSnapshotRef.current;
      clientSnapshotRef.current = str;
      return str;
    } catch {
      return clientSnapshotRef.current;
    }
  };

  const getServerSnapshot = (): string => {
    if (serverSnapshotRef.current === null) {
      serverSnapshotRef.current = getSnapshot();
    }
    return serverSnapshotRef.current;
  };

  const subscribe =
    expanded.length === 0
      ? () => () => {}
      : mergedStore
        ? (cb: () => void) => mergedStore.subscribe(cb)
        : (cb: () => void) => store.subscribe(cb);

  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [];
}
