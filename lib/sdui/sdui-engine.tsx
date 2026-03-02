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
import { getNestedValue, setNestedValue } from './nested-utils';
import { runComputed, getComputedDeps } from './computed-runner';
import storeConfig from '@/config/store-config';
import { CONVENTIONS } from './conventions';
import { isScreenScopedPath, isScopeVariable } from './path-utils';
import { computeMergedState as computeMergedStateFn, finalizeMergedWithVariableStore, mergeDataPaths } from './merge-state';
import { dispatchToHandler } from './actions/handlers';
import type { ValidationRule, ActionsConfig, EngineConfig, RouteConfig, SDUIEngineProps } from './engine-types';

export type { ValidationRule, ActionsConfig, EngineConfig, RouteConfig, SDUIEngineProps } from './engine-types';

let globalInitHasRun = false;

const computedDefs = (storeConfig as { computed?: unknown[] }).computed ?? [];
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
}: SDUIEngineProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setColorScheme } = useColorScheme();
  const setLoading = useSduiStore((s) => s.setLoading);
  const setData = useSduiStore((s) => s.setData);
  const setError = useSduiStore((s) => s.setError);
  const append = useSduiStore((s) => s.append);

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
        ({ ...mergedStore.getState().merged, ...store.getState().getFullState() }) as Record<string, unknown>;

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
