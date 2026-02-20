/**
 * Variable Store - Generic reactive state for SDUI
 * Path-based get/set, adapters for external state (Zustand, etc.), computed variables
 * Uses Zustand for fine-grained subscriptions - only re-render when watched paths change
 */

import { useRef, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { getNestedValue, setNestedValue } from './nested-utils';
import type { SDUINode } from './types';

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
        if (scope && (path.startsWith('$item') || path.startsWith('$index') || path === '$item' || path === '$index')) {
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

/** Extract variable paths from {{path}} in strings */
export function extractPathsFromTemplate(template: string): string[] {
  if (!template || typeof template !== 'string') return [];
  return [...(template.matchAll(/\{\{([^}]+)\}\}/g) ?? [])].map((m) => m[1].trim());
}

/** Extract variable paths from objects (e.g. { var: "path" }) and strings (e.g. "{{path}}") */
export function extractPathsFromObject(obj: unknown): string[] {
  if (obj == null) return [];
  if (typeof obj === 'string') return extractPathsFromTemplate(obj);
  if (typeof obj === 'object' && !Array.isArray(obj) && 'var' in obj) {
    const v = (obj as { var: string | [string, unknown] }).var;
    return [Array.isArray(v) ? String(v[0]) : String(v)];
  }
  if (typeof obj === 'object') {
    return Object.values(obj).flatMap(extractPathsFromObject);
  }
  return [];
}

/** Extract all variable paths used by a node - for selective subscription */
export function extractNodeDependencies(node: Pick<SDUINode, 'text' | 'props' | 'condition' | 'map'>): string[] {
  const paths: string[] = [];
  if (node.text != null) {
    if (typeof node.text === 'string') paths.push(...extractPathsFromTemplate(node.text));
    else if (typeof node.text === 'object' && 'expr' in node.text) {
      const exprPaths = extractPathsFromObject((node.text as { expr: unknown }).expr);
      paths.push(...exprPaths.filter((p) => p !== 'current' && p !== 'accumulator' && !p.startsWith('current.')));
    }
  }
  if (node.props) paths.push(...extractPathsFromObject(node.props));
  if (node.condition) paths.push(...extractPathsFromObject(node.condition));
  if (node.map && typeof node.map === 'string') paths.push(node.map);
  return [...new Set(paths)].filter((p): p is string => typeof p === 'string');
}

/** Expand computed paths to their source dependencies for subscription */
export function expandComputedDeps(
  paths: string[],
  computed?: Record<string, ComputedDef>
): string[] {
  if (!computed) return paths;
  const expanded = new Set(paths);
  for (const p of paths) {
    const def = computed[p];
    if (def?.type === 'reduce' && def.source) {
      expanded.add(def.source);
    }
  }
  return [...expanded];
}

const EMPTY_ARRAY: unknown[] = [];

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

type MergedStore = { getState: () => { merged: Record<string, unknown> }; subscribe: (cb: () => void) => () => void };

/** Hook: subscribe to paths - only re-renders when these values change.
 *  When mergedStore is provided, subscribes to both for selective re-renders. */
export function useVariablePaths(
  store: ReturnType<typeof createVariableStore>,
  paths: string[],
  scope?: Record<string, unknown>,
  mergedStore?: MergedStore
): unknown[] {
  const config = (store.getState() as Store)._config;
  const expanded = expandComputedDeps(paths, config.computed);
  const serverSnapshotRef = useRef<unknown[] | null>(null);
  const clientSnapshotRef = useRef<unknown[]>(EMPTY_ARRAY);

  if (expanded.length === 0) return EMPTY_ARRAY;

  const getSnapshot = () => {
    const next = expanded.map((p) => {
      if (typeof p !== 'string') return undefined;
      if (scope && (p.startsWith('$item') || p.startsWith('$index'))) {
        return getNestedValue(scope, p);
      }
      if (mergedStore) {
        return getNestedValue(mergedStore.getState().merged, p);
      }
      const state = store.getState();
      return computeValue(p, state.data, config);
    });
    if (arraysEqual(next, clientSnapshotRef.current)) {
      return clientSnapshotRef.current;
    }
    clientSnapshotRef.current = next;
    return next;
  };

  const getServerSnapshot = () => {
    if (serverSnapshotRef.current === null) {
      serverSnapshotRef.current = getSnapshot();
    }
    return serverSnapshotRef.current;
  };

  const subscribe = mergedStore
    ? (cb: () => void) => mergedStore.subscribe(cb)
    : (cb: () => void) => store.subscribe(cb);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
