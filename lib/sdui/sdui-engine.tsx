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
import { dsCacheClear } from './ds-cache';
import { CONVENTIONS } from './conventions';
import { PAGES_MAP, THEME_OBJ } from './engine-static-data';
import { isScopeVariable } from './path-utils';
import { computeMergedState as computeMergedStateFn, finalizeMergedWithVariableStore, mergeDataPaths } from './merge-state';
import { dispatchToHandler } from './actions/handlers';
import type { ValidationRule, ActionsConfig, EngineConfig, RouteConfig, SDUIEngineProps, NamedDataSourceDef } from './engine-types';
import { applyPreviewStatePatch, applyPreviewDataPatch } from './builder-preview';
import { useNamedDataSourceFetcher } from './named-datasource-fetcher';
import { PopupRenderer } from './components/PopupRenderer';

export type { ValidationRule, ActionsConfig, EngineConfig, RouteConfig, SDUIEngineProps, NamedDataSourceDef } from './engine-types';


/** Ref for page to trigger fetch when searchParams change (avoids engine remount) */
export const paramChangeRunActionRef: { current: ((action: string) => void) | null } = { current: null };


export function SDUIEngine({
  config,
  configName = 'default',
  actionsConfig = {},
  engineConfig,
  routes = [],
  paramChangeAction,
  builderMode = false,
  showPopups = true,
  builderViewportHeight,
  popupModels,
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
  // Stable ref so the handler always calls the latest setter without stale closure issues.
  const triggerDataSourceRefetchRef = useRef<(name: string) => void>(() => {});
  triggerDataSourceRefetchRef.current = (name: string) => {
    dsCacheClear(name);
    setDsRefetchKeys(prev => ({ ...prev, [name]: (prev[name] ?? 0) + 1 }));
  };

  const computeMergedState = useCallback(
    (state: { data: Record<string, unknown>; loading: Record<string, boolean>; error: Record<string, string | null> }) =>
      computeMergedStateFn(state, config as { state?: Record<string, unknown>; meta?: Record<string, unknown> }, []),
    [config]
  );

  const mergedStore = useMemo(() => {
    // Initialize with patches pre-applied so the first useSyncExternalStore snapshot is
    // already patched (prevents a flash / "click to see state" symptom).
    const base = computeMergedStateFn(
      useSduiStore.getState(),
      config as { state?: Record<string, unknown>; meta?: Record<string, unknown> },
      []
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
      next = applyPreviewDataPatch(next, pd);
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
    mergedStore.getState().setMerged(builderMode ? applyBuilderPatches(withVs) : withVs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Batch variable-store writes into a single mergedStore update per animation frame.
    // Without batching, every single keystroke (or rapid setVar call) fires synchronously:
    //   store.subscribe → mergedStore.setMerged → ALL SDURendererInner snapshot fns run
    //   → O(N × D) JSON.stringify calls → 200ms+ "input" handler violations.
    // With rAF batching, rapid writes are coalesced: the React update runs at most once
    // per 16 ms frame, keeping the input event handler <1 ms.
    let frameId: ReturnType<typeof requestAnimationFrame> | null = null;
    const unsubscribe = store.subscribe(() => {
      if (typeof requestAnimationFrame === 'undefined') {
        // SSR / test env: update synchronously
        const vs = store.getState().getFullState();
        const next = finalizeMergedWithVariableStore(store.getState().getFullState(), vs);
        mergedStore.getState().setMerged(builderMode ? applyBuilderPatches(next) : next);
        return;
      }
      if (frameId != null) return; // already scheduled for this frame
      frameId = requestAnimationFrame(() => {
        frameId = null;
        const vs = store.getState().getFullState();
        mergedStore.getState().setMerged((prev) => {
          const next = finalizeMergedWithVariableStore(prev, vs);
          return builderMode ? applyBuilderPatches(next) : next;
        });
      });
    });
    return () => {
      if (frameId != null) cancelAnimationFrame(frameId);
      unsubscribe();
    };
  }, [store, mergedStore, applyBuilderPatches]);

  useEffect(() => {
    return useSduiStore.subscribe(() => {
      const state = useSduiStore.getState();
      const merged = computeMergedState(state);
      const vs = store.getState().getFullState();
      const withVs = finalizeMergedWithVariableStore(merged, vs);
      const next = builderMode ? applyBuilderPatches(withVs) : withVs;
      mergedStore.getState().setMerged(next);
    });
  }, [computeMergedState, config, mergedStore, store, applyBuilderPatches, builderMode]);

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
        const fromVarStore = store.getState().get(path, sc);
        if (fromVarStore !== undefined) return fromVarStore;
        const merged = mergedStore.getState().merged;
        const fromMerged = getNestedValue(merged, path);
        if (fromMerged !== undefined) return fromMerged;
        return undefined;
      };

      const getFullMergedState = () =>
        mergedStore.getState().merged as Record<string, unknown>;

      const runOne = async (a: SDUIAction): Promise<unknown> => {
        const actionName = String((a as { action: string }).action);
        let payload = a.payload;
        let actionDef = actionsConfig[actionName] as {
          type?: string;
          url?: string;
          path?: string;
          value?: unknown;
          map?: Record<string, string>;
          method?: string;
          body?: Record<string, unknown>;
          rules?: Record<string, ValidationRule>;
          storeErrorsIn?: string;
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

        // Per-call result ref — populated by setStepResult so workflow-steps-handler
        // can capture the return value without changing the runOne call signature.
        const resultRef: { current: unknown } = { current: undefined };

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
          router,
          pathname: pathname ?? '/',
          searchParams: searchParams ?? null,
          routes,
          setColorScheme,
          useSduiStore: useSduiStore as { getState: () => { setData: (path: string, value: unknown) => void } },
          triggerDataSourceRefetch: (name: string) => triggerDataSourceRefetchRef.current(name),
          setStepResult: (result) => { resultRef.current = result; },
        };
        const handlerResult = await dispatchToHandler(actionDef as import('./actions/handlers/types').ActionDef, handlerCtx);
        if (handlerResult !== false) {
          // Handler was found and ran — return the result it produced.
          return resultRef.current !== undefined ? resultRef.current : handlerResult;
        }
        // Canvas step type fallback: if actionDef.type has no registered handler, treat it
        // as a single-step workflow so workflowStepsHandler can convert canvas types like
        // navigateTo, changeVariableValue, etc. (backward compat with flat element workflows).
        // Guard: skip if this is already a fallback-wrapped step (prevents infinite loop when
        // stepToSdui returns the same type and no handler exists, e.g. openPopup, closeAllPopups).
        const fbType = actionDef?.type;
        const alreadyWrapped = actionDef != null && !!(actionDef as Record<string, unknown>).__fallbackWrapped;
        if (fbType && typeof fbType === 'string' && !alreadyWrapped) {
          const singleStep: import('./actions/handlers/types').ActionDef = {
            type: 'workflowSteps',
            steps: [{ id: '__auto', __fallbackWrapped: true, ...actionDef }],
          };
          await dispatchToHandler(singleStep, handlerCtx);
        }
        return undefined;
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
      screenScopedAliases: [],
      previewState: activePreviewStateForOverrides,
    }),
    [store, mergedStore, variableStoreConfig, runActionStable, fetchDataStable, actionsConfig, configName, activePreviewStateForOverrides]
  );

  // Fetch named data sources (REST + GraphQL) on mount and on explicit refetch triggers.
  useNamedDataSourceFetcher(dataSources, dsRefetchKeys, config, useSduiStore);

  const builderContextValue = useMemo(() => ({ builderMode }), [builderMode]);

  return (
    <BuilderContext.Provider value={builderContextValue}>
      <RunActionProvider value={runActionStable}>
        <SDURenderer node={config.ui} context={context} />
        {showPopups && <PopupRenderer context={context} viewportHeight={builderViewportHeight} popupModels={popupModels as Record<string, import('./actions/handlers/popup-handlers').PopupModel> | undefined} />}
      </RunActionProvider>
    </BuilderContext.Provider>
  );
}
