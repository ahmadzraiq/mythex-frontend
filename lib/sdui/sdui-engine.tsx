'use client';

/**
 * SDUI Engine - Variable-based, adapter-agnostic, fine-grained reactivity
 * Uses variable store for state; Zustand for global app state (data, loading, error)
 * Each node subscribes only to the variables it uses
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BuilderContext } from './builder-context';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useColorScheme } from 'nativewind';
import { create } from 'zustand';
import { useSduiStore } from '@/store/sdui-store';
import { SDURenderer } from './renderer';
import { getGlobalVariableStore } from './global-variable-store';
import { RunActionProvider } from './run-action-context';
import type { SDUIConfig, SDUIContext, SDUIAction, SDUIDataSource } from './types';
import { getNestedValue, setNestedValue, extractReferencedDataSources } from './nested-utils';
import { dsCacheGet, dsCacheSet, dsCacheClear } from './ds-cache';
import { runComputed, getComputedDeps } from './computed-runner';
import { evaluateFormula } from './formula-evaluator';
import storeConfig from '@/config/store-config';
import routesConfig from '@/config/routes.json';
import themeConfig from '@/config/theme.json';
import { CONVENTIONS } from './conventions';
import { isScreenScopedPath, isScopeVariable } from './path-utils';
import { computeMergedState as computeMergedStateFn, finalizeMergedWithVariableStore, mergeDataPaths } from './merge-state';
import { dispatchToHandler } from './actions/handlers';
import type { ValidationRule, ActionsConfig, EngineConfig, RouteConfig, SDUIEngineProps, NamedDataSourceDef } from './engine-types';

export type { ValidationRule, ActionsConfig, EngineConfig, RouteConfig, SDUIEngineProps, NamedDataSourceDef } from './engine-types';

let globalInitHasRun = false;

const computedDefs = (storeConfig as { computed?: unknown[] }).computed ?? [];

/** Static pages map built from config/routes.json — keyed by route config name (or UUID if present) */
const PAGES_MAP: Record<string, {
  id: string; name: string; path: string; dynamic: boolean; auth: boolean;
}> = {};
{
  type RouteEntry = { path: string; config: string; id?: string; auth?: boolean; dynamic?: boolean };
  const routes = (routesConfig as { routes?: RouteEntry[] }).routes ?? [];
  for (const r of routes) {
    const key = r.id ?? r.config;
    PAGES_MAP[key] = {
      id: r.id ?? r.config,
      name: r.config,
      path: r.path,
      dynamic: r.dynamic ?? false,
      auth: r.auth ?? false,
    };
  }
}

/** Static theme object built from config/theme.json */
const THEME_OBJ: Record<string, unknown> = {
  colors: (themeConfig as Record<string, unknown>).colors ?? {},
  colorsDark: (themeConfig as Record<string, unknown>).colorsDark ?? {},
  sections: (themeConfig as Record<string, unknown>).sections ?? {},
  sectionsDark: (themeConfig as Record<string, unknown>).sectionsDark ?? {},
  fonts: (themeConfig as Record<string, unknown>).fonts ?? {},
  cssVariables: (themeConfig as Record<string, unknown>).cssVariables ?? {},
  /** Border-radius token → Tailwind class, e.g. theme?.['radius']?.['sm'] → 'rounded-sm' */
  radius: {
    none: 'rounded-none', sm: 'rounded-sm', base: 'rounded',
    md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl',
    '2xl': 'rounded-2xl', '3xl': 'rounded-3xl', full: 'rounded-full',
  },
};
const computedDepPaths = getComputedDeps(computedDefs as Parameters<typeof getComputedDeps>[0]);

/** Ref for page to trigger fetch when searchParams change (avoids engine remount) */
export const paramChangeRunActionRef: { current: ((action: string) => void) | null } = { current: null };

/** Recursively replace all arrays in a value with empty arrays. */
function deepClearArrays(val: unknown): unknown {
  if (Array.isArray(val)) return [];
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, deepClearArrays(v)])
    );
  }
  return val;
}

/** Apply a preview-state patch on top of the merged state for builder simulation. */
function applyPreviewStatePatch(
  merged: Record<string, unknown>,
  previewState: string,
  configName: string,
  loadingSuffix: string | undefined
): Record<string, unknown> {
  if (previewState === 'normal' || !previewState) return merged;
  if (previewState === 'loading') {
    let next = { ...merged };
    // Set _workflow.loading = true
    next = setNestedValue(next, '_workflow.loading', true);
    // Set every top-level <key>.{loadingSuffix} to true
    if (loadingSuffix) {
      for (const key of Object.keys(merged)) {
        if (key.startsWith('_') || typeof merged[key] !== 'object') continue;
        next = setNestedValue(next, `${key}.${loadingSuffix}`, true);
      }
    }
    return next;
  }
  if (previewState === 'error') {
    let next = setNestedValue(
      setNestedValue({ ...merged }, '_workflow.lastError', 'Preview error'),
      '_workflow.lastAction', 'preview'
    );
    if (configName) {
      // Form fields live at top-level `form.*` (from config state) — fall back if screen-scoped is empty
      const screenForm = (getNestedValue(merged, `screens.${configName}.form`) ??
        getNestedValue(merged, 'form')) as Record<string, unknown> | undefined;
      if (screenForm && typeof screenForm === 'object') {
        for (const field of Object.keys(screenForm)) {
          if (typeof (screenForm as Record<string, unknown>)[field] !== 'object') {
            next = setNestedValue(next, `screens.${configName}.errors.form.${field}`, 'Preview error');
          }
        }
      }
      // Also patch any already-existing error fields
      const screenErrors = (getNestedValue(merged, `screens.${configName}.errors`) ??
        getNestedValue(merged, 'errors')) as Record<string, unknown> | undefined;
      if (screenErrors && typeof screenErrors === 'object') {
        for (const field of Object.keys(screenErrors)) {
          next = setNestedValue(next, `screens.${configName}.errors.${field}`, 'Preview error');
        }
      }
    }
    return next;
  }
  if (previewState === 'validation') {
    let next = { ...merged };
    if (configName) {
      // Form fields live at top-level `form.*` (from config state) — fall back if screen-scoped is empty.
      // Does NOT set _workflow.lastError — no API error banner, only per-field errors.
      const screenForm = (getNestedValue(merged, `screens.${configName}.form`) ??
        getNestedValue(merged, 'form')) as Record<string, unknown> | undefined;
      if (screenForm && typeof screenForm === 'object') {
        for (const field of Object.keys(screenForm)) {
          if (typeof (screenForm as Record<string, unknown>)[field] !== 'object') {
            next = setNestedValue(next, `screens.${configName}.errors.form.${field}`, 'This field is required');
          }
        }
      }
    }
    return next;
  }
  if (previewState === 'empty') {
    return deepClearArrays(merged) as Record<string, unknown>;
  }
  if (previewState === 'disabled') {
    return setNestedValue({ ...merged }, '_preview_disabled', true);
  }
  // custom states — no global patch; _stateOverrides handled per-node in renderer
  return merged;
}

export function SDUIEngine({
  config,
  configName = 'default',
  actionsConfig = {},
  engineConfig,
  routes = [],
  paramChangeAction,
  builderMode = false,
  previewState,
  previewStates,
  previewData,
  dataSources,
}: SDUIEngineProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setColorScheme } = useColorScheme();
  const setLoading = useSduiStore((s) => s.setLoading);
  const setData = useSduiStore((s) => s.setData);
  const setError = useSduiStore((s) => s.setError);
  const append = useSduiStore((s) => s.append);

  // Tracks per-datasource refetch triggers incremented by the refetchDataSource action.
  const [dsRefetchKeys, setDsRefetchKeys] = useState<Record<string, number>>({});
  const prevDsRefetchKeysRef = useRef<Record<string, number>>({});
  // Stable ref so the handler always calls the latest setter without stale closure issues.
  const triggerDataSourceRefetchRef = useRef<(name: string) => void>(() => {});
  triggerDataSourceRefetchRef.current = (name: string) => {
    dsCacheClear(name);
    setDsRefetchKeys(prev => ({ ...prev, [name]: (prev[name] ?? 0) + 1 }));
  };

  const computeMergedState = useCallback(
    (state: { data: Record<string, unknown>; loading: Record<string, boolean>; error: Record<string, string | null> }) =>
      computeMergedStateFn(state, config as { state?: Record<string, unknown>; meta?: Record<string, unknown> }, computedDefs as { output: string; expr: object }[]),
    [config]
  );

  const mergedStore = useMemo(() => {
    // Initialize with patches pre-applied so the first useSyncExternalStore snapshot is
    // already patched (prevents a flash / "click to see state" symptom).
    const base = computeMergedStateFn(
      useSduiStore.getState(),
      config as { state?: Record<string, unknown>; meta?: Record<string, unknown> },
      computedDefs as { output: string; expr: object }[]
    );
    const vs = getGlobalVariableStore().getState().getFullState();
    let initial = finalizeMergedWithVariableStore(base, vs);
    const activeStates = previewStates ?? (previewState ? [previewState] : ['normal']);
    for (const ps of activeStates) {
      if (ps && ps !== 'normal') {
        initial = applyPreviewStatePatch(initial, ps, configName ?? 'default', CONVENTIONS.loadingSuffix);
      }
    }
    if (previewData && Object.keys(previewData).length > 0) {
      initial = mergeDataPaths(initial, previewData);
    }
    return create<{
      merged: Record<string, unknown>;
      setMerged: (m: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
    }>()((set) => ({
      merged: initial,
      setMerged: (m) => set((s) => ({ merged: typeof m === 'function' ? m(s.merged) : m })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const prevDepsRef = useRef<unknown[] | null>(null);
  const prevComputedRef = useRef<Record<string, unknown>>({});

  const meta = (config as { meta?: Record<string, unknown> }).meta;
  const store = getGlobalVariableStore();

  // Merge screen state into global store at screens.{configName}
  useEffect(() => {
    if (!configName) return;
    const screenState = {
      ...(config.state ?? {}),
      ...(meta ? { meta } : {}),
    };
    store.getState().setState((prev) => {
      const screens = (prev.screens as Record<string, unknown>) ?? {};
      return setNestedValue(prev, `screens.${configName}`, { ...(screens[configName] as Record<string, unknown> ?? {}), ...screenState });
    });
  }, [configName, config.state, meta, store]);

  // Refs so subscription callbacks always see the latest preview values without re-subscribing
  const previewStateRef = useRef(previewState);
  previewStateRef.current = previewState;
  const previewStatesRef = useRef(previewStates);
  previewStatesRef.current = previewStates;
  const previewDataRef = useRef(previewData);
  previewDataRef.current = previewData;
  // Track serialized previewData to skip re-applying patches when only object reference changed
  const previewDataSerialRef = useRef<string>('');
  const prevPreviewStatesSerialRef = useRef<string>('');
  const prevConfigNameRef = useRef<string>('');
  const configNameRef = useRef(configName);
  configNameRef.current = configName;

  const applyBuilderPatches = useCallback((base: Record<string, unknown>): Record<string, unknown> => {
    let next = base;
    const cn = configNameRef.current ?? 'default';
    const pd = previewDataRef.current;
    // Support both single previewState and multi previewStates array
    const activeStates = previewStatesRef.current ?? (previewStateRef.current ? [previewStateRef.current] : ['normal']);
    for (const ps of activeStates) {
      if (ps && ps !== 'normal') {
        next = applyPreviewStatePatch(next, ps, cn, CONVENTIONS.loadingSuffix);
      }
    }
    if (pd && Object.keys(pd).length > 0) {
      next = mergeDataPaths(next, pd);
    }
    return next;
  }, []);

  // ── globalContext: browser/screen runtime object — injected into merged state ──
  // We update this whenever pathname or searchParams changes so formulas that
  // reference globalContext.browser.path / query / etc. always see fresh values.
  const globalContextRef = useRef<Record<string, unknown>>({});
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query: Record<string, string> = {};
    searchParams?.forEach((v, k) => { query[k] = v; });
    const url = window.location.href;
    const domain = window.location.hostname;
    const baseUrl = window.location.origin;
    globalContextRef.current = {
      browser: {
        url,
        path: pathname ?? window.location.pathname,
        domain,
        baseUrl,
        query,
        // breakpoint / environment / theme are best-effort at this point
        breakpoint: (() => {
          const w = window.innerWidth;
          if (w < 640) return 'sm';
          if (w < 768) return 'md';
          if (w < 1024) return 'lg';
          if (w < 1280) return 'xl';
          return '2xl';
        })(),
        environment: process.env.NODE_ENV ?? 'production',
      },
      screen: {
        width: window.innerWidth,
        height: window.innerHeight,
        scroll: {
          x: window.scrollX,
          y: window.scrollY,
          xPercent: document.documentElement.scrollWidth > window.innerWidth
            ? Math.round((window.scrollX / (document.documentElement.scrollWidth - window.innerWidth)) * 100)
            : 0,
          yPercent: document.documentElement.scrollHeight > window.innerHeight
            ? Math.round((window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100)
            : 0,
        },
      },
    };
    mergedStore.getState().setMerged((prev) => ({
      ...prev,
      globalContext: globalContextRef.current,
      pages: PAGES_MAP,
      theme: THEME_OBJ,
    }));
  }, [pathname, searchParams, mergedStore]);

  useEffect(() => {
    const base = computeMergedState(useSduiStore.getState());
    const vs = store.getState().getFullState();
    const withVs = finalizeMergedWithVariableStore(base, vs);
    mergedStore.getState().setMerged(applyBuilderPatches(withVs));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return store.subscribe(() => {
      const vs = store.getState().getFullState();
      mergedStore.getState().setMerged((prev) =>
        applyBuilderPatches(finalizeMergedWithVariableStore(prev, vs))
      );
    });
  }, [store, mergedStore, applyBuilderPatches]);

  useEffect(() => {
    return useSduiStore.subscribe(() => {
      const state = useSduiStore.getState();
      const merged = computeMergedState(state);
      const vs = store.getState().getFullState();
      const withVs = finalizeMergedWithVariableStore(merged, vs);
      const next = applyBuilderPatches(withVs);
      prevDepsRef.current =
        computedDepPaths.length > 0
          ? computedDepPaths.map((p) => getNestedValue(next, p))
          : prevDepsRef.current;
      prevComputedRef.current = Object.fromEntries(
        (computedDefs as { output: string }[]).map((d) => [d.output, getNestedValue(next, d.output)])
      );
      mergedStore.getState().setMerged(next);
    });
  }, [computeMergedState, config, mergedStore, store, applyBuilderPatches]);

  // Re-apply patches whenever previewState/previewStates/previewData/configName changes in builder mode.
  // Uses serialization guards so only actual content changes trigger a re-computation — prevents
  // thrashing when a parent component creates new object references on every render.
  // configName is included so switching pages (same SDUIEngine instance, key="builder-engine")
  // always recomputes the merged state with the new screen's form fields.
  // Uses requestAnimationFrame to batch inactive-page updates after the active page paints.
  useEffect(() => {
    if (!builderMode) return;
    const statesSerial = JSON.stringify(previewStates ?? previewState ?? 'normal');
    const dataSerial = previewData ? JSON.stringify(previewData) : '';
    const cn = configName ?? '';
    if (
      statesSerial === prevPreviewStatesSerialRef.current &&
      dataSerial === previewDataSerialRef.current &&
      cn === prevConfigNameRef.current
    ) return;
    prevPreviewStatesSerialRef.current = statesSerial;
    previewDataSerialRef.current = dataSerial;
    prevConfigNameRef.current = cn;
    const raf = requestAnimationFrame(() => {
      const base = computeMergedState(useSduiStore.getState());
      const vs = store.getState().getFullState();
      const withVs = finalizeMergedWithVariableStore(base, vs);
      mergedStore.getState().setMerged(applyBuilderPatches(withVs));
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewState, previewStates, previewData, builderMode, configName, computeMergedState, store, mergedStore, applyBuilderPatches]);

  const fetchDataStable = useCallback(
    async (ds: SDUIDataSource) => {
      try {
        const res = await fetch(ds.url, { method: ds.method ?? 'GET' });
        const data = await res.json();
        store.getState().mergeSlice(ds.key, data as Record<string, unknown>);
      } catch (err) {
        console.error('[SDUI] Fetch failed:', ds.url, err);
        store.getState().mergeSlice(ds.key, null as unknown as Record<string, unknown>);
      }
    },
    [store]
  );

  /**
   * Dispatches an action by name or inline definition.
   * @param action - Named ref: `{ action: "fetchCollection" }` or inline: `{ type: "increment", path: "..." }`.
   *                Named actions are looked up in actionsConfig; inline objects are used as the definition.
   * @param event - Optional event (e.g. click event); passed as $event to resolveValue/resolvePayload.
   * @param scope - Optional scope with $item, $index, $parent for map/loop context.
   */
  const runAction = useCallback(
    async (action: SDUIAction | SDUIAction[], event?: unknown, scope?: Record<string, unknown>) => {
      const get = (path: string, s?: Record<string, unknown>) => {
        const sc = s ?? scope;
        if (sc && isScopeVariable(path)) {
          return getNestedValue(sc, path);
        }
        if (path === '_timestamp') return Date.now();
        if (path === '_date') return new Date().toISOString().slice(0, 10);
        // Resolve screen-scoped aliases from engineConventions.screenScopedAliases
        const resolvedPath =
          configName && isScreenScopedPath(path, CONVENTIONS.screenScopedAliases)
            ? `screens.${configName}.${path}`
            : path;
        const fromVarStore = store.getState().get(resolvedPath, sc);
        if (fromVarStore !== undefined) return fromVarStore;
        const merged = mergedStore.getState().merged;
        const fromMerged = getNestedValue(merged, resolvedPath);
        if (fromMerged !== undefined) return fromMerged;
        return undefined;
      };

      const getFullMergedState = () =>
        mergedStore.getState().merged as Record<string, unknown>;

      const runOne = async (a: SDUIAction) => {
        const actionName = String((a as { action: string }).action);
        let payload = a.payload;
        let actionDef = actionsConfig[actionName] as {
          type?: string;
          url?: string;
          storeIn?: string;
          path?: string;
          value?: unknown;
          map?: Record<string, string>;
          method?: string;
          body?: Record<string, unknown>;
          responsePath?: string;
          rules?: Record<string, ValidationRule>;
          storeErrorsIn?: string;
          onSuccess?: { action: string; payload?: { path: string } };
          actions?: Array<{ action: string; payload?: Record<string, unknown> }>;
        } | undefined;
        // Fall back to treating the action object itself as the definition when no named action found
        // This allows inline types like { "type": "increment", "path": "..." } inside runMultiple
        if (!actionDef && 'type' in (a as object)) {
          actionDef = a as typeof actionDef;
        }
        if (actionDef && 'action' in actionDef && typeof (actionDef as { action?: string }).action === 'string') {
          const alias = actionDef as { action: string; payload?: Record<string, unknown> };
          return runOne({ action: alias.action, payload: alias.payload ?? payload });
        }
        const handlerCtx: import('./actions/handlers/types').ActionHandlerContext = {
          get,
          getFullMergedState,
          setData,
          setLoading,
          setError,
          append,
          runOne,
          store,
          configName: configName ?? 'default',
          actionName,
          payload,
          scope,
          event,
          CONVENTIONS,
          router,
          pathname: pathname ?? '/',
          searchParams: searchParams ?? null,
          routes,
          setColorScheme,
          useSduiStore: useSduiStore as { getState: () => { setData: (path: string, value: unknown) => void } },
          triggerDataSourceRefetch: (name: string) => triggerDataSourceRefetchRef.current(name),
        };
        if (actionDef && (await dispatchToHandler(actionDef as import('./actions/handlers/types').ActionDef, handlerCtx))) {
          return;
        }
        if (!actionDef && payload && typeof payload === 'object') {
          const synthetic: Record<string, unknown> = { type: actionName, ...payload };
          if (['navigate', 'setState', 'showToast', 'log'].includes(actionName) && (await dispatchToHandler(synthetic as import('./actions/handlers/types').ActionDef, handlerCtx))) {
            return;
          }
        }
        if (actionName === 'fetch' && payload && typeof payload === 'object' && 'url' in payload) {
          await fetchDataStable(payload as SDUIDataSource);
        }
      };

      const workflowPath = CONVENTIONS.workflowPath;
      const actions = Array.isArray(action) ? action : [action];
      for (const a of actions) {
        const actionName = String((a as { action: string }).action);
        try {
          await runOne(a as SDUIAction);
          store.getState().setState((prev) =>
            setNestedValue(prev, workflowPath, { lastAction: actionName, lastError: null })
          );
        } catch (err) {
          store.getState().setState((prev) =>
            setNestedValue(prev, workflowPath, {
              lastAction: actionName,
              lastError: err instanceof Error ? err.message : 'Action failed',
            })
          );
          throw err;
        }
      }
    },
    [router, pathname, searchParams, setColorScheme, fetchDataStable, actionsConfig, store, mergedStore, setLoading, setData, setError, append, routes, configName]
  );

  const runActionStable = useCallback(
    (action: SDUIAction | SDUIAction[], event?: unknown, scope?: Record<string, unknown>) => {
      runAction(action, event, scope).catch((err) => {
        // Don't log validation errors - they're expected and already shown in the UI
        if ((err as Error & { __validationError?: boolean }).__validationError) return;
        console.error('[SDUI] runAction error:', err);
      });
    },
    [runAction]
  );

  const runActionRef = useRef(runActionStable);
  runActionRef.current = runActionStable;

  useEffect(() => {
    if (paramChangeAction) {
      paramChangeRunActionRef.current = (action: string) =>
        runActionRef.current({ action });
      return () => {
        paramChangeRunActionRef.current = null;
      };
    }
  }, [paramChangeAction]);

  // initActions use ref so they always call the latest runAction (avoids stale closure)
  const variableStoreConfig = useMemo(
    () => ({
      initialState: config.state ?? {},
      adapters: [] as { slice: string; getState: () => Record<string, unknown> }[],
    }),
    [config.state]
  );

  // For per-node _stateOverrides, use the first non-normal active state
  const activePreviewStateForOverrides = useMemo(() => {
    const states = previewStates ?? (previewState ? [previewState] : ['normal']);
    return states.find(s => s !== 'normal') ?? 'normal';
  }, [previewState, previewStates]);

  const context = useMemo(
    () => ({
      store,
      mergedStore,
      storeConfig: variableStoreConfig,
      runAction: runActionStable,
      fetchData: fetchDataStable,
      actionsConfig,
      screenName: configName,
      screenScopedAliases: CONVENTIONS.screenScopedAliases,
      previewState: activePreviewStateForOverrides,
    }),
    [store, mergedStore, variableStoreConfig, runActionStable, fetchDataStable, actionsConfig, configName, activePreviewStateForOverrides]
  );

  useEffect(() => {
    config.dataSources?.forEach((ds) => fetchDataStable(ds));
  }, [config.dataSources]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch named data sources from config/datasources.json on mount.
  // Results are stored at the source's name path via setData(name, result).
  useEffect(() => {
    if (!dataSources || Object.keys(dataSources).length === 0) return;
    const conventions = CONVENTIONS as { loadingSuffix?: string; errorSuffix?: string };
    const loadingSuffix = conventions.loadingSuffix ?? '_loading';
    const errorSuffix = conventions.errorSuffix ?? '_error';

    // Use the fully-merged state: Zustand + variable store + _conventions + computed.
    // _conventions (sortInputMap, defaultSortInput, etc.) is only injected by
    // finalizeMergedWithVariableStore, so skipping it would cause sort formulas to fail.
    const mergedBase = computeMergedStateFn(
      useSduiStore.getState(),
      config as { state?: Record<string, unknown>; meta?: Record<string, unknown> },
      computedDefs as { output: string; expr: object }[]
    );
    const vs = getGlobalVariableStore().getState().getFullState();
    const currentState = finalizeMergedWithVariableStore(mergedBase, vs);
    const interpolate = (str: string): string =>
      str.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
        const v = getNestedValue(currentState, path.trim());
        return v != null ? String(v) : '';
      });

    const extractPath = (json: unknown, responsePath?: string): unknown => {
      if (!responsePath) return json;
      let result: unknown = json;
      for (const part of responsePath.split('.')) {
        result = (result as Record<string, unknown>)?.[part];
      }
      return result;
    };

    // Deep-walk a variables object and resolve values using the current merged state.
    // Handles four patterns:
    //   1. {"expr": "..."} or {"expr": <json-logic>}  → evaluated via evaluateFormula
    //   2. {"var": "path"} or {"var": ["path", default]} → direct state lookup (type-preserving)
    //   3. "{{path}} || fallback"  → path lookup with JSON-parsed fallback (type-preserving)
    //   4. "{{path}}" (pure)       → type-preserving state lookup
    //   5. "mixed {{path}} text"   → string interpolation
    const resolveVariables = (vars: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(vars)) {
        if (typeof v === 'object' && v !== null && 'expr' in (v as object)) {
          // Pattern 1: {"expr": "..."} — evaluate formula
          const expr = (v as { expr: unknown }).expr;
          try {
            result[k] = evaluateFormula(expr as string | object, currentState).value;
          } catch {
            result[k] = null;
          }
        } else if (typeof v === 'object' && v !== null && 'var' in (v as object)) {
          // Pattern 2: {"var": "path"} JSON Logic
          const varRef = (v as { var: string | [string, unknown] }).var;
          const pathStr = Array.isArray(varRef) ? varRef[0] : varRef;
          const defaultVal = Array.isArray(varRef) ? varRef[1] : null;
          const resolved = getNestedValue(currentState, pathStr as string);
          result[k] = resolved !== undefined && resolved !== null ? resolved : defaultVal;
        } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          // Nested object — recurse
          result[k] = resolveVariables(v as Record<string, unknown>);
        } else if (typeof v === 'string') {
          // Pattern 3: "{{path}} || fallback" — OR fallback with type preservation
          const orMatch = v.match(/^\{\{([^}]+)\}\}\s*\|\|\s*(.+)$/);
          if (orMatch) {
            const pathVal = getNestedValue(currentState, orMatch[1].trim());
            if (pathVal !== null && pathVal !== undefined && pathVal !== '') {
              result[k] = pathVal;
            } else {
              const fallback = orMatch[2].trim();
              try { result[k] = JSON.parse(fallback); } catch { result[k] = fallback; }
            }
          // Pattern 4: "{{path}}" pure — preserve type
          } else if (/^\{\{([^}]+)\}\}$/.test(v)) {
            const m = v.match(/^\{\{([^}]+)\}\}$/)!;
            result[k] = getNestedValue(currentState, m[1].trim()) ?? null;
          // Pattern 5: mixed string
          } else {
            result[k] = interpolate(v);
          }
        } else {
          result[k] = v;
        }
      }
      return result;
    };

    const sduiStore = useSduiStore.getState();

    // Determine which sources were explicitly triggered by a refetchDataSource action.
    const triggeredNames = new Set(
      Object.keys(dsRefetchKeys).filter(n => dsRefetchKeys[n] !== (prevDsRefetchKeysRef.current[n] ?? 0))
    );
    prevDsRefetchKeysRef.current = { ...dsRefetchKeys };

    // Only fetch data sources actually referenced by this page's config.
    const allNames = Object.keys(dataSources);
    const referencedNames = new Set(extractReferencedDataSources(config, allNames));

    // If specific sources were triggered, only re-fetch those; otherwise fetch all referenced.
    const neededNames = triggeredNames.size > 0
      ? new Set([...triggeredNames].filter(n => referencedNames.has(n)))
      : referencedNames;

    Object.entries(dataSources)
      .filter(([name]) => neededNames.has(name))
      .forEach(([name, ds]: [string, NamedDataSourceDef]) => {
        // Data is stored under collections.UUID so JSON can access it as
        // {{collections.UUID.data.field}} — matches the path convention used
        // throughout all screen/fragment configs.
        const storeKey = `collections.${name}`;
        sduiStore.setData(`${storeKey}.${loadingSuffix}`, true);
        sduiStore.setData(`${storeKey}.${errorSuffix}`, null);

      if (ds.type === 'graphql') {
        // ── GraphQL data source ──────────────────────────────────────────────
        const cacheTag = ds.cacheTag ?? '';
        const cacheTTL = Number(ds.cacheTTL ?? 0);
        const cacheKeyVars = (ds.cacheKeyVars ?? []) as string[];

        // Build cache key and check before fetching
        let cacheKey = '';
        if (cacheTag && cacheTTL > 0) {
          const keyParts = cacheKeyVars.map(p => String(getNestedValue(currentState, p) ?? ''));
          cacheKey = `ds:${cacheTag}:${keyParts.join(':')}`;
          const cached = dsCacheGet(cacheKey);
          if (cached !== undefined) {
            sduiStore.setData(storeKey, cached);
            sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
            return;
          }
        }

        const endpoint = interpolate(ds.endpoint);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (ds.headers) {
          for (const [k, v] of Object.entries(ds.headers)) {
            const resolved = interpolate(String(v));
            if (resolved) headers[k] = resolved;
          }
        }
        const resolvedVariables = resolveVariables((ds.variables ?? {}) as Record<string, unknown>);
        const gqlCredentials = (CONVENTIONS as { graphqlCredentials?: RequestCredentials }).graphqlCredentials;
        fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query: ds.query, variables: resolvedVariables }),
          ...(gqlCredentials ? { credentials: gqlCredentials } : {}),
        })
          .then(res => res.json())
          .then((json: unknown) => {
            const data = json as { data?: unknown; errors?: Array<{ message: string }> };
            if (data.errors?.length) {
              sduiStore.setData(`${storeKey}.${errorSuffix}`, data.errors[0]?.message ?? 'GraphQL error');
              sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
              return;
            }
            const result = extractPath(json, ds.responsePath);
            if (result === null && ds.skipStoreWhenNull) return;
            if (cacheKey && cacheTTL > 0) dsCacheSet(cacheKey, result, cacheTTL);
            sduiStore.setData(storeKey, result);
            sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
          })
          .catch((err: unknown) => {
            sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
            sduiStore.setData(`${storeKey}.${errorSuffix}`, String(err));
          });
      } else {
        // ── REST data source ─────────────────────────────────────────────────
        const rawHeaders = ds.headers;
        const headers: Record<string, string> = {};
        if (Array.isArray(rawHeaders)) {
          rawHeaders.filter(h => h.enabled !== false && h.key.trim()).forEach(h => {
            headers[h.key] = h.value;
          });
        } else if (rawHeaders && typeof rawHeaders === 'object') {
          for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
            headers[k] = interpolate(v);
          }
        }
        const enabled = (ds.queryParams ?? []).filter(p => p.enabled !== false && p.key.trim());
        let url = ds.url;
        if (enabled.length) {
          const qs = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
          url = `${url}${url.includes('?') ? '&' : '?'}${qs}`;
        }
        const fetchOpts: RequestInit = { method: ds.method ?? 'GET', headers };
        if (ds.sendCredentials) fetchOpts.credentials = 'include';

        fetch(url, fetchOpts)
          .then(res => res.json())
          .then((json: unknown) => {
            const result = extractPath(json, ds.responsePath);
            sduiStore.setData(storeKey, result);
            sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
          })
          .catch((err: unknown) => {
            sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
            sduiStore.setData(`${storeKey}.${errorSuffix}`, String(err));
          });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSources, dsRefetchKeys]);

  const globalInitActions = (storeConfig as { globalInitActions?: Array<{ action: string }> }).globalInitActions ?? [];
  useEffect(() => {
    if (globalInitHasRun) return;
    globalInitHasRun = true;
    globalInitActions.forEach((action) => runActionRef.current(action));
  }, [globalInitActions]);

  useEffect(() => {
    config.initActions?.forEach((action) => runActionRef.current(action));
  }, [config.initActions]); // runActionRef.current always has latest runAction

  const builderContextValue = useMemo(() => ({ builderMode }), [builderMode]);

  return (
    <BuilderContext.Provider value={builderContextValue}>
      <RunActionProvider value={runActionStable}>
        <SDURenderer node={config.ui} context={context} />
      </RunActionProvider>
    </BuilderContext.Provider>
  );
}
