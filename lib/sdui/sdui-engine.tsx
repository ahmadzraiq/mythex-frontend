'use client';

/**
 * SDUI Engine - Variable-based, adapter-agnostic, fine-grained reactivity
 * Uses variable store for state; Zustand for global app state (data, loading, error)
 * Each node subscribes only to the variables it uses
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BuilderContext, PopoverShownContext } from './builder-context';
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
import { SharedComponentDynamicRenderer } from './components/SharedComponentDynamicRenderer';

export type { ValidationRule, ActionsConfig, EngineConfig, RouteConfig, SDUIEngineProps, NamedDataSourceDef } from './engine-types';


/** Ref for page to trigger fetch when searchParams change (avoids engine remount) */
export const paramChangeRunActionRef: { current: ((action: string) => void) | null } = { current: null };

/** Ref always populated by SDUIEngine so page.tsx can trigger startupAction regardless of paramChangeAction. */
export const startupRunActionRef: { current: ((action: string) => void) | null } = { current: null };


export function SDUIEngine({
  config,
  configName = 'default',
  actionsConfig = {},
  engineConfig,
  routes = [],
  paramChangeAction,
  builderMode = false,
  builderViewportHeight,
  builderViewport,
  shownPopovers,
  previewState,
  previewStates,
  previewData,
  dataSources,
  builderQueryParams,
  pathParams,
  builderPath,
}: SDUIEngineProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setColorScheme } = useColorScheme();

  const routerRef = useRef(router);
  routerRef.current = router;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const setColorSchemeRef = useRef(setColorScheme);
  setColorSchemeRef.current = setColorScheme;

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

  const configState = config.state;
  const configMeta = config.meta;
  const computeMergedState = useCallback(
    (state: { data: Record<string, unknown>; loading: Record<string, boolean>; error: Record<string, string | null> }) => ({
      ...computeMergedStateFn(state, { state: configState, meta: configMeta }, []),
      theme: THEME_OBJ,
      pages: PAGES_MAP,
    }),
    [configState, configMeta]
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
    // Always include static theme and pages in the initial merged state.
    // The globalContext+theme useEffect runs AFTER the mount-only useEffect that resets
    // merged state, so without pre-seeding here, theme would be absent on the very first
    // render and any formula like theme?.['colors']?.['primary'] would return undefined.
    initial = { ...initial, theme: THEME_OBJ, pages: PAGES_MAP };

    // Pre-seed path params so route.<name> and globalContext.browser.params are available
    // on the very first render (before useEffect/useLayoutEffect run).
    // The component remounts (via key) whenever pathParams changes, so the closure value
    // here is always the correct value for this mount.
    if (pathParams && Object.keys(pathParams).length > 0) {
      const routeParamFlat: Record<string, string> = {};
      for (const [k, v] of Object.entries(pathParams)) {
        routeParamFlat[`route.${k}`] = v;
      }
      initial = mergeDataPaths(initial, routeParamFlat);
    }
    const existingGlobalCtx = (initial.globalContext as Record<string, unknown>) ?? {};
    const existingBrowser = (existingGlobalCtx.browser as Record<string, unknown>) ?? {};
    initial = {
      ...initial,
      globalContext: {
        ...existingGlobalCtx,
        browser: {
          ...existingBrowser,
          params: pathParams ?? {},
        },
      },
    };
    return create<{
      merged: Record<string, unknown>;
      patchVersion: number;
      setMerged: (m: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
      bumpPatchVersion: () => void;
    }>()((set) => ({
      merged: initial,
      patchVersion: 0,
      setMerged: (m) => set((s) => ({ merged: typeof m === 'function' ? m(s.merged) : m })),
      bumpPatchVersion: () => set((s) => ({ patchVersion: s.patchVersion + 1 })),
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

  // ── Responsive breakpoint ─────────────────────────────────────────────────────
  // In builder mode: derived from the builder's viewport preset (simulated width).
  // In production: derived from window.innerWidth with a resize listener.
  const [productionBreakpoint, setProductionBreakpoint] = useState<import('./responsive-resolver').ActiveBreakpoint>('desktop');

  useEffect(() => {
    if (builderMode || typeof window === 'undefined') return;
    const { getBreakpointFromWidth } = require('./responsive-resolver') as typeof import('./responsive-resolver');
    const update = () => setProductionBreakpoint(getBreakpointFromWidth(window.innerWidth));
    update();
    let rafId: number | null = null;
    const onResize = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => { update(); rafId = null; });
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); if (rafId !== null) cancelAnimationFrame(rafId); };
  }, [builderMode]);

  // ── Live scroll tracking — writes { y, direction, yPercent } to variables['scroll'] ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let prevY = window.scrollY;
    let rafId = 0;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const y = window.scrollY;
        const totalH = document.documentElement.scrollHeight - window.innerHeight;
        const yPercent = totalH > 0 ? Math.round((y / totalH) * 100) : 0;
        const direction = y > prevY + 4 ? 'down' : y < prevY - 4 ? 'up' : 'none';
        if (direction !== 'none') prevY = y;
        getGlobalVariableStore().getState().set('scroll', { y, direction, yPercent });
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(rafId); };
  }, []);

  const activeBreakpoint: import('./responsive-resolver').ActiveBreakpoint =
    builderMode ? (builderViewport ?? 'desktop') : productionBreakpoint;

  // ── globalContext: browser/screen runtime object — injected into merged state ──
  // Computed at render time via useMemo so datasource fetcher always sees fresh
  // query params on the same render cycle (useEffect would be one cycle late).
  const globalContextRef = useRef<Record<string, unknown>>({});
  const globalContext = useMemo(() => {
    if (typeof window === 'undefined') return {};
    const query: Record<string, string> = {};
    searchParams?.forEach((v, k) => { query[k] = v; });
    if (builderMode && builderQueryParams) {
      for (const p of builderQueryParams) {
        if (p.name.trim()) query[p.name] = p.value;
      }
    }
    return {
      browser: {
        url: window.location.href,
        path: (builderMode && builderPath) ? builderPath : (pathname ?? window.location.pathname),
        domain: window.location.hostname,
        baseUrl: window.location.origin,
        query,
        params: pathParams ?? {},
        breakpoint: activeBreakpoint,
        environment: process.env.NODE_ENV ?? 'production',
      },
      screen: {
        width: window.innerWidth,
        height: window.innerHeight,
        scroll: { x: 0, y: 0, xPercent: 0, yPercent: 0 },
      },
    };
  }, [pathname, searchParams, activeBreakpoint, builderMode, builderQueryParams, pathParams, builderPath]);
  globalContextRef.current = globalContext;

  useEffect(() => {
    mergedStore.getState().setMerged((prev) => ({
      ...prev,
      globalContext,
      pages: PAGES_MAP,
      theme: THEME_OBJ,
    }));
  }, [globalContext, mergedStore]);

  useEffect(() => {
    const base = computeMergedState(useSduiStore.getState());
    const vs = store.getState().getFullState();
    const withVs = finalizeMergedWithVariableStore(base, vs);
    // Preserve static theme + pages + globalContext so they are never lost when
    // this effect replaces the full merged state (they were already set by
    // earlier effects but this runs last on mount and would overwrite them).
    const prev = mergedStore.getState().merged;
    const withStatic = {
      ...withVs,
      globalContext: prev.globalContext,
      theme: THEME_OBJ,
      pages: PAGES_MAP,
    };
    mergedStore.getState().setMerged(builderMode ? applyBuilderPatches(withStatic) : withStatic);
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
        const next = { ...finalizeMergedWithVariableStore(mergedStore.getState().merged, vs), theme: THEME_OBJ, pages: PAGES_MAP };
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

  // Re-inject theme into merged state whenever patchThemeColors() fires (live theme tab updates).
  // patchThemeColors replaces THEME_OBJ.colors with a new object; this effect propagates that
  // new reference into mergedStore so formula expressions like theme?.['colors']?.['primary-foreground']
  // reflect the updated hex value without a full page remount.
  useEffect(() => {
    const handler = () => {
      mergedStore.getState().setMerged((prev) => ({
        ...prev,
        theme: { ...THEME_OBJ },
      }));
    };
    window.addEventListener('sdui:theme-colors-patched', handler);
    return () => window.removeEventListener('sdui:theme-colors-patched', handler);
  }, [mergedStore]);

  useEffect(() => {
    return useSduiStore.subscribe(() => {
      const state = useSduiStore.getState();
      const merged = computeMergedState(state);
      const vs = store.getState().getFullState();
      const withVs = finalizeMergedWithVariableStore(merged, vs);
      const prev = mergedStore.getState().merged;
      const next = {
        ...withVs,
        globalContext: prev.globalContext,
        theme: prev.theme ?? THEME_OBJ,
        pages: prev.pages ?? PAGES_MAP,
      };
      mergedStore.getState().setMerged(builderMode ? applyBuilderPatches(next) : next);
    });
  }, [computeMergedState, mergedStore, store, applyBuilderPatches, builderMode]);

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
      const prev = mergedStore.getState().merged;
      const next = {
        ...withVs,
        globalContext: prev.globalContext,
        theme: prev.theme ?? THEME_OBJ,
        pages: prev.pages ?? PAGES_MAP,
      };
      mergedStore.getState().setMerged(applyBuilderPatches(next));
      mergedStore.getState().bumpPatchVersion();
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewState, previewStates, previewData, builderMode, configName, computeMergedState, store, mergedStore, applyBuilderPatches]);

  // When registerGlobalFormulas runs (after async message delivery), _formulas_v increments.
  // Bumping patchVersion forces all renderer nodes to re-evaluate their bindings so formula
  // function calls (e.g. formatDisplay) resolve correctly on first render.
  useEffect(() => {
    let prev = store.getState().data._formulas_v as number | undefined;
    return store.subscribe((state) => {
      const next = (state as { data: Record<string, unknown> }).data._formulas_v as number | undefined;
      if (next !== prev) {
        prev = next;
        mergedStore.getState().bumpPatchVersion();
      }
    });
  }, [store, mergedStore]);

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
        const _ref = a as unknown as Record<string, unknown>;
        const actionName = typeof _ref.workflowId === 'string'
          ? _ref.workflowId
          : String(_ref.action ?? '');
        let payload = a.payload;
        if (a.params && !(payload as Record<string, unknown> | undefined)?.parameters) {
          payload = { ...(payload as Record<string, unknown> | undefined), parameters: a.params };
        }
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
        // Ambient Shared Component lookup: when the action name isn't a
        // known top-level actionsConfig entry AND we're rendering inside an SC
        // subtree (scope.context.component.id set by the renderer on `_shared`
        // roots), try resolving the name as a component-scoped workflow
        // on the ambient model. If found, synthesize an `executeComponentAction`
        // actionDef so element bindings can be written as plain
        //   `{ action: "<scWfId>", args: {...} }`
        // instead of an inline `{ type: "workflow", steps: [...] }` wrapper.
        if (!actionDef && scope) {
          const ambientComp = ((scope.context as Record<string, unknown> | undefined)?.component) as Record<string, unknown> | undefined;
          const ambientModelId = ambientComp?.id as string | undefined;
          if (ambientModelId) {
            let scModel: { workflows?: Record<string, unknown> } | undefined;
            try { scModel = require('@/lib/builder/shared-component-data').getSharedComponents()[ambientModelId]; } catch { /* noop */ }
            if (!scModel) {
              try { scModel = require('@/config/shared-components.json')[ambientModelId]; } catch { /* noop */ }
            }
            if (scModel?.workflows?.[actionName]) {
              const ambientArgs = (a as { args?: Record<string, unknown> }).args;
              actionDef = {
                type: 'executeComponentAction',
                config: { action: actionName, args: ambientArgs },
              } as unknown as typeof actionDef;
            }
          }
        }
        // Fall back to treating the action object itself as the definition when no named action found.
        // Accepts either:
        //   - inline step-typed actions: { "type": "increment", "path": "..." } inside runMultiple
        //   - inline workflows: { "trigger": "change", "steps": [ ... ] } produced by element actions arrays
        //     (dispatchToHandler auto-routes any def with `steps` to workflowStepsHandler).
        if (!actionDef && (
          'type' in (a as object) ||
          Array.isArray((a as Record<string, unknown>).steps)
        )) {
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
          router: routerRef.current,
          pathname: pathnameRef.current ?? '/',
          searchParams: searchParamsRef.current ?? null,
          routes,
          setColorScheme: setColorSchemeRef.current,
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
        // as a single-step workflow so the step converter can handle canvas types like
        // navigateTo, changeVariableValue, etc. (backward compat with flat element workflows).
        // Guard: skip if this is already a fallback-wrapped step (prevents infinite loop when
        // stepToSdui returns the same type and no handler exists).
        const fbType = actionDef?.type;
        const alreadyWrapped = actionDef != null && !!(actionDef as Record<string, unknown>).__fallbackWrapped;
        if (fbType && typeof fbType === 'string' && !alreadyWrapped) {
          const singleStep: import('./actions/handlers/types').ActionDef = {
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
    [fetchDataStable, actionsConfig, store, mergedStore, setLoading, setData, setError, append, routes, configName]
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

  // Always expose a way for page.tsx to trigger actions (e.g. startupAction)
  // regardless of whether paramChangeAction is set on this route.
  useEffect(() => {
    startupRunActionRef.current = (action: string) => runActionRef.current({ action });
    return () => { startupRunActionRef.current = null; };
  });

  useEffect(() => {
    if (paramChangeAction) {
      paramChangeRunActionRef.current = (action: string) =>
        runActionRef.current({ action });
      return () => {
        paramChangeRunActionRef.current = null;
      };
    }
  }, [paramChangeAction]);

  // Defensive ref-based stabilization: if config.state is shallowly equal to
  // the previous value, keep the old reference to prevent context invalidation.
  const prevConfigStateRef = useRef(config.state);
  const stableConfigState = useMemo(() => {
    const prev = prevConfigStateRef.current;
    const next = config.state;
    if (prev === next) return prev;
    if (prev && next && typeof prev === 'object' && typeof next === 'object') {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && prevKeys.every(k => (prev as Record<string, unknown>)[k] === (next as Record<string, unknown>)[k])) {
        return prev;
      }
    }
    prevConfigStateRef.current = next;
    return next;
  }, [config.state]);

  const variableStoreConfig = useMemo(
    () => ({
      initialState: stableConfigState ?? {},
      adapters: [] as { slice: string; getState: () => Record<string, unknown> }[],
    }),
    [stableConfigState]
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

  // Collect collectionFetchError trigger workflows once (stable ref).
  const collectionFetchErrorWorkflowsRef = useRef<string[]>([]);
  useEffect(() => {
    type TriggerDef = { trigger?: string; isTrigger?: boolean; isAppTrigger?: boolean; pageScope?: string };
    collectionFetchErrorWorkflowsRef.current = Object.entries(actionsConfig as Record<string, TriggerDef>)
      .filter(([, def]) => def.isTrigger && def.trigger === 'collectionFetchError' &&
        (def.isAppTrigger === true || (!!def.pageScope && def.pageScope.toLowerCase() === (configName ?? '').toLowerCase())))
      .map(([key]) => key);
  }, [actionsConfig, configName]);

  // Fetch named data sources (REST + GraphQL) on mount and on explicit refetch triggers.
  // Pass an error callback so collectionFetchError trigger workflows fire automatically.
  const onDatasourceError = useCallback((datasourceId: string, error: string) => {
    for (const key of collectionFetchErrorWorkflowsRef.current) {
      runActionRef.current({ action: key }, { datasourceId, error });
    }
  }, []);

  useNamedDataSourceFetcher(dataSources, dsRefetchKeys, config, useSduiStore, globalContext, onDatasourceError);

  // ── Declarative trigger listeners ─────────────────────────────────────────────
  // Scans actionsConfig for workflows with isTrigger:true and wires up the
  // appropriate lifecycle or browser event handler automatically.
  // pageScope (if set) is matched against configName so page-scoped triggers
  // only fire on their assigned page.
  const actionsConfigRef = useRef(actionsConfig);
  actionsConfigRef.current = actionsConfig;

  useEffect(() => {
    console.log('[triggers] effect fired — builderMode:', builderMode, '| configName:', configName);
    if (builderMode) {
      console.log('[triggers] skipped — builderMode is true');
      return;
    }

    type TriggerDef = { trigger?: string; isTrigger?: boolean; isAppTrigger?: boolean; pageScope?: string };

    const cfg = actionsConfigRef.current as Record<string, TriggerDef>;
    console.log('[triggers] actionsConfig keys:', Object.keys(cfg));

    // isAppTrigger: true  → fires on every page (global)
    // pageScope set       → fires only on the matching page
    // empty pageScope + no isAppTrigger → defensive no-op (shouldn't exist post-migration)
    const matchesPage = (def: TriggerDef) =>
      def.isAppTrigger === true || (!!def.pageScope && def.pageScope.toLowerCase() === (configName ?? '').toLowerCase());

    // Group workflow keys by trigger type, filtered by page scope.
    const byTrigger = new Map<string, string[]>();
    for (const [key, def] of Object.entries(cfg)) {
      if (!def.isTrigger || !def.trigger) continue;
      const matches = matchesPage(def);
      console.log(`[triggers] wf="${key}" trigger="${def.trigger}" pageScope="${def.pageScope}" isAppTrigger=${def.isAppTrigger} → matchesPage=${matches}`);
      if (!matches) continue;
      let list = byTrigger.get(def.trigger);
      if (!list) { list = []; byTrigger.set(def.trigger, list); }
      list.push(key);
    }

    console.log('[triggers] byTrigger map:', Object.fromEntries(byTrigger));

    const run = (key: string, eventData?: Record<string, unknown>) => {
      console.log('[triggers] running key:', key);
      runActionRef.current({ action: key }, eventData);
    };

    // Lifecycle — fire on mount
    for (const t of ['appLoadBefore', 'pageLoadBefore', 'appLoad', 'pageLoad'] as const) {
      for (const key of (byTrigger.get(t) ?? [])) run(key);
    }

    // Browser event listeners
    const scrollKeys = byTrigger.get('scroll') ?? [];
    const resizeKeys = byTrigger.get('resize') ?? [];
    const keydownKeys = byTrigger.get('keydown') ?? [];
    const keyupKeys = byTrigger.get('keyup') ?? [];
    const reachEndKeys = byTrigger.get('reachEnd') ?? [];

    const handleScroll = () => {
      const eventData = { scrollY: window.scrollY, scrollX: window.scrollX };
      for (const key of scrollKeys) run(key, eventData);
    };
    const handleResize = () => {
      const eventData = { width: window.innerWidth, height: window.innerHeight };
      for (const key of resizeKeys) run(key, eventData);
    };
    const handleKeydown = (e: KeyboardEvent) => {
      const eventData = { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey };
      for (const key of keydownKeys) run(key, eventData);
    };
    const handleKeyup = (e: KeyboardEvent) => {
      const eventData = { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey };
      for (const key of keyupKeys) run(key, eventData);
    };

    // reachEnd — fire once when window scrolls to within threshold px of the bottom.
    // Each workflow tracks its own fired state so independent thresholds work correctly.
    const reachEndStates = reachEndKeys.map(key => {
      const wfDef = cfg[key] as { config?: { threshold?: number } } | undefined;
      const threshold = typeof wfDef?.config?.threshold === 'number' ? wfDef.config.threshold : 100;
      return { key, threshold, fired: false };
    });
    const handleReachEndScroll = () => {
      const remaining = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      for (const state of reachEndStates) {
        if (remaining <= state.threshold) {
          if (!state.fired) {
            state.fired = true;
            run(state.key);
          }
        } else {
          state.fired = false;
        }
      }
    };

    if (scrollKeys.length) window.addEventListener('scroll', handleScroll, { passive: true });
    if (reachEndKeys.length) window.addEventListener('scroll', handleReachEndScroll, { passive: true });
    if (resizeKeys.length) window.addEventListener('resize', handleResize);
    if (keydownKeys.length) window.addEventListener('keydown', handleKeydown);
    if (keyupKeys.length) window.addEventListener('keyup', handleKeyup);

    // pageUnload — fire on unmount
    const pageUnloadKeys = byTrigger.get('pageUnload') ?? [];
    const appUnloadKeys = byTrigger.get('appUnload') ?? [];

    return () => {
      for (const key of [...pageUnloadKeys, ...appUnloadKeys]) run(key);
      if (scrollKeys.length) window.removeEventListener('scroll', handleScroll);
      if (reachEndKeys.length) window.removeEventListener('scroll', handleReachEndScroll);
      if (resizeKeys.length) window.removeEventListener('resize', handleResize);
      if (keydownKeys.length) window.removeEventListener('keydown', handleKeydown);
      if (keyupKeys.length) window.removeEventListener('keyup', handleKeyup);
    };
  // Re-run when the page changes (configName) so page-scoped triggers re-bind.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builderMode, configName]);

  const builderContextValue = useMemo(
    () => ({ builderMode, activeBreakpoint }),
    [builderMode, activeBreakpoint],
  );

  return (
    <BuilderContext.Provider value={builderContextValue}>
      <PopoverShownContext.Provider value={shownPopovers}>
        <RunActionProvider value={runActionStable}>
          <SDURenderer node={config.ui} context={context} />
          <SharedComponentDynamicRenderer context={context} viewportHeight={builderViewportHeight} />
        </RunActionProvider>
      </PopoverShownContext.Provider>
    </BuilderContext.Provider>
  );
}
