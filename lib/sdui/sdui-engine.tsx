'use client';

/**
 * SDUI Engine - Variable-based, adapter-agnostic, fine-grained reactivity
 * Uses variable store for state; Zustand for global app state (data, loading, error)
 * Each node subscribes only to the variables it uses
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useColorScheme } from 'nativewind';
import { create } from 'zustand';
import { useSduiStore } from '@/store/sdui-store';
import { SDURenderer } from './renderer';
import { getGlobalVariableStore } from './global-variable-store';
import { RunActionProvider } from './run-action-context';
import type { SDUIConfig, SDUIContext, SDUIAction, SDUIDataSource } from './types';
import jsonLogic from 'json-logic-js';
import { getNestedValue, setNestedValue } from './nested-utils';
import { runComputed, getComputedDeps } from './computed-runner';
import storeConfig from '@/config/store.json';
import { toast } from 'sonner';

type EngineConventions = {
  loadingSuffix?: string;
  errorSuffix?: string;
  defaultStoreErrorsIn?: string;
  defaultStoreIn?: string;
  defaultErrorMessagePath?: string;
  workflowPath?: string;
  screenScopedAliases?: string[];
  graphqlEndpoint?: string;
  graphqlHeaders?: Record<string, string>;
  graphqlCredentials?: RequestCredentials;
};
const engineConventions = (storeConfig as { engineConventions?: EngineConventions }).engineConventions ?? {};
let globalInitHasRun = false;
const CONVENTIONS = {
  loadingSuffix: engineConventions.loadingSuffix,
  errorSuffix: engineConventions.errorSuffix,
  defaultStoreErrorsIn: engineConventions.defaultStoreErrorsIn,
  defaultStoreIn: engineConventions.defaultStoreIn,
  defaultErrorMessagePath: engineConventions.defaultErrorMessagePath,
  workflowPath: engineConventions.workflowPath,
  screenScopedAliases: engineConventions.screenScopedAliases ?? [],
  graphqlEndpoint: engineConventions.graphqlEndpoint,
  graphqlHeaders: engineConventions.graphqlHeaders ?? {},
  graphqlCredentials: engineConventions.graphqlCredentials,
};

function isScreenScopedPath(path: string, aliases: string[]): boolean {
  return aliases.some((a) => path === a || path.startsWith(`${a}.`));
}

/** Config-driven fetch cache: tag + vars key, TTL in seconds, invalidate on mutation */
const fetchCache = new Map<string, { data: unknown; expiresAt: number }>();
function cacheKey(tag: string, vars: Record<string, unknown> | undefined): string {
  const v = vars ? JSON.stringify(vars) : '';
  return `${tag}:${v}`;
}
function cacheGet(tag: string, vars: Record<string, unknown> | undefined): unknown | null {
  const key = cacheKey(tag, vars);
  const e = fetchCache.get(key);
  if (!e || Date.now() > e.expiresAt) {
    if (e) fetchCache.delete(key);
    return null;
  }
  return e.data;
}
function cacheSet(tag: string, vars: Record<string, unknown> | undefined, data: unknown, ttlSec: number): void {
  fetchCache.set(cacheKey(tag, vars), { data, expiresAt: Date.now() + ttlSec * 1000 });
}
function cacheInvalidate(tag: string): void {
  for (const k of fetchCache.keys()) if (k.startsWith(tag + ':')) fetchCache.delete(k);
}

const computedDefs = (storeConfig as { computed?: unknown[] }).computed ?? [];
const computedDepPaths = getComputedDeps(computedDefs as Parameters<typeof getComputedDeps>[0]);

function interpolateUrl(url: string, get: (path: string, scope?: Record<string, unknown>) => unknown, scope?: Record<string, unknown>): string {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const val = get(path.trim(), scope);
    return val != null ? String(val) : '';
  });
}

function resolveActionValue(
  value: unknown,
  get: (path: string, scope?: Record<string, unknown>) => unknown,
  scope?: Record<string, unknown>,
  defaultNum = 1
): number {
  if (value == null) return defaultNum;
  if (typeof value === 'object' && value && 'var' in value) {
    const v = (value as { var: string | [string, unknown] }).var;
    const path = Array.isArray(v) ? String(v[0]) : String(v);
    const fallback = Array.isArray(v) ? v[1] : undefined;
    const resolved = get(path, scope);
    return Number(resolved ?? fallback ?? defaultNum);
  }
  return Number(value ?? defaultNum);
}

function resolvePayload(
  payload: Record<string, unknown>,
  get: (path: string, scope?: Record<string, unknown>) => unknown,
  scope?: Record<string, unknown>,
  fullState?: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = resolveValue(value, get, scope, fullState);
  }
  return result;
}

function resolveValue(
  value: unknown,
  get: (path: string, scope?: Record<string, unknown>) => unknown,
  scope?: Record<string, unknown>,
  fullState?: Record<string, unknown>
): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, get, scope, fullState));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('var' in obj) {
      const v = (obj as { var: string | [string, unknown] }).var;
      const path = Array.isArray(v) ? String(v[0]) : String(v);
      const fallback = Array.isArray(v) ? v[1] : undefined;
      const resolved = get(path, scope);
      return resolved !== undefined && resolved !== null ? resolved : fallback;
    }
    if ('expr' in obj && fullState) {
      try {
        const stateForExpr = {
          ...fullState,
          _timestamp: Date.now(),
          _date: new Date().toISOString().slice(0, 10),
        };
        return jsonLogic.apply((obj as { expr: object }).expr as object, stateForExpr);
      } catch {
        return undefined;
      }
    }
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      resolved[k] = resolveValue(v, get, scope, fullState);
    }
    // Evaluate JSON Logic expressions (e.g. {"-":[a,1]}, {"max":[1,x]}) so payload values become primitives
    const keys = Object.keys(resolved);
    if (keys.length === 1 && typeof keys[0] === 'string') {
      try {
        return jsonLogic.apply(resolved as object, fullState ?? {});
      } catch {
        /* fall through */
      }
    }
    return resolved;
  }
  return value;
}

export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  equals?: string;
  equalsField?: string;
  message?: string;
}

export interface ActionsConfig {
  [actionName: string]: {
    type: string;
    url?: string;
    method?: string;
    body?: Record<string, unknown>;
    storeIn?: string;
    storeFullResponseIn?: string;
    responsePath?: string;
    errorMessagePath?: string;
    path?: string;
    value?: unknown;
    map?: Record<string, string>;
    rules?: Record<string, ValidationRule>;
    storeErrorsIn?: string;
    payload?: Record<string, unknown>;
    actions?: Array<{ action: string; payload?: Record<string, unknown> }>;
    onSuccess?: { action: string; payload?: Record<string, unknown> } | { action: string; payload?: Record<string, unknown> }[];
    formPath?: string;
    targetPath?: string;
    resetFormPath?: string;
    resetFormValue?: Record<string, unknown>;
  };
}

export interface EngineConfig {
  sync?: readonly string[];
}

export interface RouteConfig {
  path: string;
  config?: string;
  dynamic?: boolean;
}

interface SDUIEngineProps {
  config: SDUIConfig;
  configName?: string;
  actionsConfig?: ActionsConfig;
  engineConfig?: EngineConfig;
  routes?: RouteConfig[];
}

export function SDUIEngine({
  config,
  configName = 'default',
  actionsConfig = {},
  engineConfig,
  routes = [],
}: SDUIEngineProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setColorScheme } = useColorScheme();
  const setLoading = useSduiStore((s) => s.setLoading);
  const setData = useSduiStore((s) => s.setData);
  const setError = useSduiStore((s) => s.setError);
  const append = useSduiStore((s) => s.append);

  const computeMergedState = useCallback(
    (state: { data: Record<string, unknown>; loading: Record<string, boolean>; error: Record<string, string | null> }) => {
      const meta = (config as { meta?: Record<string, unknown> }).meta;
      let merged = {
        ...(config.state ?? {}),
        ...(meta ? { meta } : {}),
      } as Record<string, unknown>;
      for (const path of Object.keys(state.data)) {
        merged = setNestedValue(merged, path, state.data[path]);
      }
      for (const path of Object.keys(state.loading)) {
        const slice = path.split('.')[0];
        merged = setNestedValue(merged, `${slice}.${CONVENTIONS.loadingSuffix}`, state.loading[path]);
      }
      for (const path of Object.keys(state.error)) {
        const slice = path.split('.')[0];
        merged = setNestedValue(merged, `${slice}.${CONVENTIONS.errorSuffix}`, state.error[path]);
      }
      if (computedDefs.length > 0) {
        merged = runComputed(merged, computedDefs as Parameters<typeof runComputed>[1], {});
      }
      return merged;
    },
    [config]
  );

  const mergedStore = useMemo(
    () =>
      create<{
        merged: Record<string, unknown>;
        setMerged: (m: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
      }>()((set) => ({
        merged: {},
        setMerged: (m) => set((s) => ({ merged: typeof m === 'function' ? m(s.merged) : m })),
      })),
    []
  );


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

  useEffect(() => {
    mergedStore.getState().setMerged(computeMergedState(useSduiStore.getState()));
  }, []);

  useEffect(() => {
    return store.subscribe(() => {
      const vs = store.getState().getFullState();
      mergedStore.getState().setMerged((prev) => {
        // Deep-merge one level: if both prev[key] and vs[key] are plain objects,
        // spread them together so a partial vs.nav doesn't wipe prev.nav.collections
        let next: Record<string, unknown> = { ...prev };
        for (const [key, val] of Object.entries(vs)) {
          const prevVal = prev[key];
          if (
            val !== null && typeof val === 'object' && !Array.isArray(val) &&
            prevVal !== null && typeof prevVal === 'object' && !Array.isArray(prevVal)
          ) {
            next[key] = { ...(prevVal as object), ...(val as object) };
          } else {
            next[key] = val;
          }
        }
        // Recompute when vs updates (e.g. collectionSkip) so collectionCurrentPage stays in sync with pagination
        if (computedDefs.length > 0) {
          next = runComputed(next, computedDefs as Parameters<typeof runComputed>[1], {});
        }
        return next;
      });
    });
  }, [store, mergedStore]);

  useEffect(() => {
    return useSduiStore.subscribe(() => {
      const state = useSduiStore.getState();
      const data = state.data;

      const depsChanged =
        computedDepPaths.length === 0 ||
        computedDepPaths.some((p) => {
          const prev = prevDepsRef.current;
          const curr = getNestedValue(data, p);
          if (prev == null) return true;
          const i = computedDepPaths.indexOf(p);
          return prev[i] !== curr;
        });

      let merged: Record<string, unknown>;
      if (depsChanged && computedDepPaths.length > 0) {
        merged = computeMergedState(state);
        prevDepsRef.current = computedDepPaths.map((p) => getNestedValue(merged, p));
        prevComputedRef.current = Object.fromEntries(
          (computedDefs as { output: string }[]).map((d) => [d.output, getNestedValue(merged, d.output)])
        );
      } else {
        const meta = (config as { meta?: Record<string, unknown> }).meta;
        merged = {
          ...(config.state ?? {}),
          ...(meta ? { meta } : {}),
        } as Record<string, unknown>;
        for (const path of Object.keys(data)) {
          merged = setNestedValue(merged, path, data[path]);
        }
        for (const path of Object.keys(state.loading)) {
          const slice = path.split('.')[0];
          merged = setNestedValue(merged, `${slice}.${CONVENTIONS.loadingSuffix}`, state.loading[path]);
        }
        for (const path of Object.keys(state.error)) {
          const slice = path.split('.')[0];
          merged = setNestedValue(merged, `${slice}.${CONVENTIONS.errorSuffix}`, state.error[path]);
        }
        for (const [outPath, value] of Object.entries(prevComputedRef.current)) {
          merged = setNestedValue(merged, outPath, value);
        }
      }
      // Merge: Zustand data (merged) as base; variable store (vs) overlays with deep merge
      // so product.selectedOptions from vs is merged into product from Zustand.
      const vs = store.getState().getFullState();
      let next: Record<string, unknown> = { ...merged };
      for (const [key, val] of Object.entries(vs)) {
        const mVal = merged[key];
        if (
          val !== null && typeof val === 'object' && !Array.isArray(val) &&
          mVal !== null && typeof mVal === 'object' && !Array.isArray(mVal)
        ) {
          next[key] = { ...(mVal as object), ...(val as object) };
        } else if (val !== undefined) {
          next[key] = val;
        }
      }
      mergedStore.getState().setMerged(next);
    });
  }, [computeMergedState, config, mergedStore, store]);

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

  const runAction = useCallback(
    async (action: SDUIAction | SDUIAction[], event?: unknown, scope?: Record<string, unknown>) => {
      const get = (path: string, s?: Record<string, unknown>) => {
        const sc = s ?? scope;
        if (sc && (path.startsWith('$item') || path.startsWith('$index') || path.startsWith('$parent') || path === '$item' || path === '$index' || path === '$parent')) {
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
        if (actionDef?.type === 'append') {
          const path = actionDef.path ?? '';
          const rawValue = actionDef.value ?? (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).value : undefined);
          const value =
            rawValue != null && typeof rawValue === 'object' && !Array.isArray(rawValue)
              ? resolvePayload(rawValue as Record<string, unknown>, get, scope)
              : rawValue;
          if (path) append(path, value);
          return;
        }
        if (actionDef?.type === 'appendToPath') {
          const targetPath = ((actionDef as { targetPath?: string }).targetPath ?? actionDef.path ?? '') as string;
          const rawValue = actionDef.value;
          const fullState = getFullMergedState();
          const resolvedValue =
            rawValue != null && typeof rawValue === 'object'
              ? resolveValue(rawValue, get, scope, fullState)
              : rawValue;
          if (targetPath) {
            const parts = targetPath.split('.');
            const parentPath = parts.slice(0, -1).join('.');
            const parent = parentPath ? (get(parentPath) as Record<string, unknown>) : undefined;
            const key = parts[parts.length - 1];
            const currentArr = (parent ? getNestedValue(parent, key) : get(targetPath)) as unknown[] | undefined;
            const arr = Array.isArray(currentArr) ? [...currentArr, resolvedValue] : [resolvedValue];
            if (parentPath) {
              const updated = { ...parent, [key!]: arr };
              setData(parentPath, updated);
            } else {
              setData(targetPath, arr);
            }
          }
          const resetFormPath = (actionDef as { resetFormPath?: string }).resetFormPath;
          const resetFormValue = ((actionDef as { resetFormValue?: Record<string, unknown> }).resetFormValue ?? {}) as Record<string, unknown>;
          if (resetFormPath) {
            const pathToReset = configName && !resetFormPath.startsWith('screens.') ? `screens.${configName}.${resetFormPath}` : resetFormPath;
            store.getState().setState((prev) => setNestedValue(prev, pathToReset, resetFormValue));
          }
          const onSuccess = actionDef.onSuccess;
          if (onSuccess) {
            const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
            for (const a of actions) {
              await runOne(a as SDUIAction);
            }
          }
          return;
        }
        if (actionDef?.type === 'fetch') {
          const storeIn = actionDef.storeIn ?? CONVENTIONS.defaultStoreIn;
          const storeFullResponseIn = (actionDef as { storeFullResponseIn?: string }).storeFullResponseIn;
          const errorMessagePath = ((actionDef as { errorMessagePath?: string }).errorMessagePath ?? CONVENTIONS.defaultErrorMessagePath) as string;
          const url = interpolateUrl(String(actionDef.url ?? ''), get, scope);
          const map = actionDef.map;
          const responsePath = actionDef.responsePath as string | undefined;
          const body = actionDef.body as Record<string, unknown> | undefined;
          const resolvedBody = body ? resolvePayload(body, get, scope) : undefined;
          setLoading(storeIn, true);
          try {
            const fetchOpts: RequestInit = { method: (actionDef.method as string) ?? 'GET' };
            if (resolvedBody && (fetchOpts.method === 'POST' || fetchOpts.method === 'PUT' || fetchOpts.method === 'PATCH')) {
              fetchOpts.headers = { 'Content-Type': 'application/json' };
              fetchOpts.body = JSON.stringify(resolvedBody);
            }
            const res = await fetch(url, fetchOpts);
            const rawResponse = await res.json().catch(() => ({}));
            if (!res.ok) {
              const msg =
                (getNestedValue(rawResponse as Record<string, unknown>, errorMessagePath) as string) ??
                `Fetch failed: ${res.status}`;
              throw new Error(msg);
            }
            let data = rawResponse;
            if (storeFullResponseIn) {
              setData(storeFullResponseIn, rawResponse);
            }
            if (responsePath && typeof responsePath === 'string') {
              const parts = responsePath.split('.');
              for (const p of parts) {
                data = data?.[p];
              }
            }
            if (Array.isArray(data) && map && typeof map === 'object') {
              data = data.map((item: Record<string, unknown>) => {
                const out: Record<string, unknown> = {};
                for (const [ourKey, apiKey] of Object.entries(map)) {
                  const val = item[apiKey] ?? item[ourKey];
                  out[ourKey] = ourKey === 'id' && val != null ? String(val) : val;
                }
                return out;
              });
            }
            setData(storeIn, data);
            const onSuccess = actionDef.onSuccess;
            if (onSuccess) {
              const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
              for (const a of actions) {
                await runOne(a as SDUIAction);
              }
            }
          } catch (err) {
            setError(storeIn, err instanceof Error ? err.message : 'Fetch failed');
          }
          return;
        }
        if (actionDef?.type === 'graphql') {
          const storeIn = actionDef.storeIn ?? CONVENTIONS.defaultStoreIn;
          const storeFullResponseIn = (actionDef as { storeFullResponseIn?: string }).storeFullResponseIn;
          const errorMessagePath = ((actionDef as { errorMessagePath?: string }).errorMessagePath ?? CONVENTIONS.defaultErrorMessagePath) as string;
          const rawEndpoint = (actionDef as { endpoint?: string }).endpoint ?? CONVENTIONS.graphqlEndpoint ?? '';
          const endpoint = interpolateUrl(rawEndpoint, get, scope);
          const query = (actionDef as { query?: string }).query ?? '';
          const rawVariables = (actionDef as { variables?: Record<string, unknown> }).variables;
          const fullState = getFullMergedState();
          const stateWithScope = scope ? { ...fullState, ...scope } : fullState;
          const baseVars = rawVariables ? resolvePayload(rawVariables, get, scope, stateWithScope) : {};
          const payloadVars =
            payload && typeof payload === 'object'
              ? resolvePayload(payload as Record<string, unknown>, get, scope, stateWithScope)
              : {};
          const variables: Record<string, unknown> | undefined =
            Object.keys(baseVars).length || Object.keys(payloadVars).length
              ? { ...baseVars, ...payloadVars }
              : undefined;
          const rawHeaders = (actionDef as { headers?: Record<string, string> }).headers ?? {};
          const resolvedActionHeaders = resolvePayload(rawHeaders as Record<string, unknown>, get, scope) as Record<string, string>;
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...CONVENTIONS.graphqlHeaders,
            ...resolvedActionHeaders,
          };
          // Remove headers with null/undefined/empty values (e.g. Authorization when not logged in)
          for (const key of Object.keys(headers)) {
            if (headers[key] == null || headers[key] === '' || headers[key] === 'null' || headers[key] === 'undefined') {
              delete headers[key];
            }
          }
          const responsePath = actionDef.responsePath as string | undefined;
          const credentials =
            (actionDef as { credentials?: RequestCredentials }).credentials ?? CONVENTIONS.graphqlCredentials;
          const storeHeaderIn = (actionDef as { storeHeaderIn?: Record<string, string> }).storeHeaderIn;
          const cacheTag = (actionDef as { cacheTag?: string }).cacheTag;
          const cacheTTL = (actionDef as { cacheTTL?: number }).cacheTTL ?? 0;
          const invalidateCache = (actionDef as { invalidateCache?: string[] }).invalidateCache;
          const cacheKeyVars = (actionDef as { cacheKeyVars?: string[] }).cacheKeyVars;
          const isQuery = query.trim().toLowerCase().startsWith('query');
          const canCache = isQuery && cacheTag && cacheTTL > 0;
          const cacheVars =
            canCache && cacheKeyVars?.length
              ? { ...variables, ...Object.fromEntries(cacheKeyVars.map((p) => [p, get(p)])) }
              : variables;
          const cached = canCache ? cacheGet(cacheTag, cacheVars) : null;
          if (cached != null) {
            let data: unknown = cached;
            if (responsePath && typeof responsePath === 'string') {
              const parts = responsePath.split('.');
              for (const p of parts) data = (data as Record<string, unknown>)?.[p];
            }
            const skipStoreWhenNull = (actionDef as { skipStoreWhenNull?: boolean }).skipStoreWhenNull;
            if (!skipStoreWhenNull || data != null) setData(storeIn, data);
            return;
          }
          setLoading(storeIn, true);
          try {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify({ query, variables }),
              ...(credentials ? { credentials } : {}),
            });
            const rawResponse = await res.json().catch(() => ({}));
            if (!res.ok) {
              const msg =
                (getNestedValue(rawResponse as Record<string, unknown>, errorMessagePath) as string) ??
                `GraphQL request failed: ${res.status}`;
              throw new Error(msg);
            }
            const gqlErrors = (rawResponse as { errors?: Array<{ message: string }> }).errors;
            if (gqlErrors && gqlErrors.length > 0) {
              throw new Error(gqlErrors[0]?.message ?? 'GraphQL error');
            }
            // Store response headers into state paths (e.g. auth token from vendure-auth-token header)
            if (storeHeaderIn) {
              for (const [storePath, headerName] of Object.entries(storeHeaderIn)) {
                const headerValue = res.headers.get(headerName);
                if (headerValue) setData(storePath, headerValue);
              }
            }
            if (storeFullResponseIn) {
              setData(storeFullResponseIn, rawResponse);
            }
            let data: unknown = rawResponse;
            if (responsePath && typeof responsePath === 'string') {
              const parts = responsePath.split('.');
              for (const p of parts) {
                data = (data as Record<string, unknown>)?.[p];
              }
            }
            const addResult = data as { __typename?: string; errorCode?: string; message?: string } | undefined;
            if (addResult?.errorCode) {
              throw new Error(addResult.message ?? 'Operation failed');
            } else {
              const skipStoreWhenNull = (actionDef as { skipStoreWhenNull?: boolean }).skipStoreWhenNull;
              if (!skipStoreWhenNull || data != null) setData(storeIn, data);
              if (canCache) cacheSet(cacheTag!, cacheVars, rawResponse, cacheTTL);
              if (invalidateCache?.length) for (const t of invalidateCache) cacheInvalidate(t);
              const onSuccess = actionDef.onSuccess;
              if (onSuccess) {
                const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
                for (const a of actions) {
                  await runOne(a as SDUIAction);
                }
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'GraphQL request failed';
            setError(storeIn, msg);
            toast.error(msg);
            throw err;
          }
          return;
        }
        if (actionDef?.type === 'runMultiple' && Array.isArray(actionDef.actions)) {
          for (const a of actionDef.actions) {
            const actionItem = a as { condition?: object; action?: string; [k: string]: unknown };
            if (actionItem.condition != null) {
              const condResult = jsonLogic.apply(actionItem.condition as object, getFullMergedState() ?? {});
              if (!condResult) continue;
            }
            await runOne(a as SDUIAction);
          }
          return;
        }
        if (actionDef?.type === 'validate') {
          const rules = (actionDef.rules ?? {}) as Record<string, ValidationRule>;
          const storeErrorsIn =
            (actionDef.storeErrorsIn as string) ?? CONVENTIONS.defaultStoreErrorsIn ?? 'errors';
          const errorsPath =
            configName && isScreenScopedPath(storeErrorsIn, CONVENTIONS.screenScopedAliases)
              ? `screens.${configName}.${storeErrorsIn}`
              : storeErrorsIn;
          let errors: Record<string, unknown> = {};
          let firstMsg: string | undefined;
          for (const [fieldPath, rule] of Object.entries(rules)) {
            if (!rule) continue;
            const value = get(fieldPath);
            const str = String(value ?? '').trim();
            const msg = rule.message ?? 'Invalid';
            if (rule.required && !str) {
              errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
              if (!firstMsg) firstMsg = msg;
              continue;
            }
            if (!str && !rule.required) continue;
            if (rule.minLength != null && str.length < rule.minLength) {
              errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
              if (!firstMsg) firstMsg = msg;
              continue;
            }
            if (rule.maxLength != null && str.length > rule.maxLength) {
              errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
              if (!firstMsg) firstMsg = msg;
              continue;
            }
            if (rule.pattern === 'email') {
              const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRe.test(str)) {
                errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
                if (!firstMsg) firstMsg = msg;
              }
              continue;
            }
            if (rule.equals != null && str !== String(rule.equals)) {
              errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
              if (!firstMsg) firstMsg = msg;
            }
            if (rule.equalsField != null) {
              const otherVal = get(rule.equalsField);
              if (str !== String(otherVal ?? '')) {
                errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
                if (!firstMsg) firstMsg = msg;
              }
            }
          }
          store.getState().setState((prev) => setNestedValue(prev, errorsPath, errors));
          if (firstMsg) {
            store.getState().setState((prev) =>
              setNestedValue(prev, CONVENTIONS.workflowPath ?? '_workflow', {
                lastAction: actionName,
                lastError: firstMsg,
              })
            );
            const err = new Error(firstMsg) as Error & { __validationError?: boolean };
            err.__validationError = true;
            throw err;
          }
          const onSuccess = actionDef.onSuccess;
          if (onSuccess) {
            const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
            for (const a of actions) {
              await runOne(a as SDUIAction);
            }
          }
          return;
        }
        if (actionDef?.type === 'set') {
          const path = actionDef.path ?? '';
          const rawValue = actionDef.value;
          const fullState = getFullMergedState();
          const value =
            rawValue != null && typeof rawValue === 'object' && !Array.isArray(rawValue)
              ? resolveValue(rawValue, get, scope, fullState)
              : rawValue;
          if (path) setData(path, value);
          const onSuccess = actionDef.onSuccess;
          if (onSuccess) {
            const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
            for (const a of actions) {
              await runOne(a as SDUIAction);
            }
          }
          return;
        }
        if (actionDef?.type === 'increment') {
          const path = (actionDef.path ?? '') as string;
          const amountRaw = (actionDef as { amount?: unknown }).amount;
          const amount = resolveActionValue(amountRaw, get, scope, 1);
          const current = get(path);
          const minVal = Number((actionDef as { min?: number }).min ?? 0);
          const next = Math.max(minVal, (Number(current) || 0) + amount);
          store.getState().setState((prev) => setNestedValue(prev, path, next));
          if (!path.startsWith('screens.')) {
            useSduiStore.getState().setData(path, next);
          }
          return;
        }
        if (actionDef?.type === 'decrement') {
          const path = (actionDef.path ?? '') as string;
          const amountRaw = (actionDef as { amount?: unknown }).amount;
          const amount = resolveActionValue(amountRaw, get, scope, 1);
          const current = get(path);
          const minVal = Number((actionDef as { min?: number }).min ?? 0);
          const next = Math.max(minVal, (Number(current) || 0) - amount);
          store.getState().setState((prev) => setNestedValue(prev, path, next));
          if (!path.startsWith('screens.')) {
            useSduiStore.getState().setData(path, next);
          }
          return;
        }
        if (actionDef?.type === 'toggle') {
          const path = (actionDef.path ?? '') as string;
          const current = get(path);
          store.getState().setState((prev) => setNestedValue(prev, path, !current));
          return;
        }
        // setVar: variable store + Zustand for global paths (so merge has correct value and fetch reads it)
        if (actionDef?.type === 'setVar') {
          const path = (actionDef.path ?? '') as string;
          const rawValue = actionDef.value;
          const value =
            rawValue != null && typeof rawValue === 'object' && !Array.isArray(rawValue)
              ? resolvePayload(rawValue as Record<string, unknown>, get, scope)
              : rawValue;
          store.getState().setState((prev) => setNestedValue(prev, path, value));
          if (!path.startsWith('screens.')) {
            useSduiStore.getState().setData(path, value);
          }
          return;
        }
        // cycleIndex: cycle through array index (for product image carousel prev/next)
        if (actionDef?.type === 'cycleIndex') {
          const path = ((actionDef as { path?: string }).path ?? '') as string;
          const arrayPath = ((actionDef as { arrayPath?: string }).arrayPath ?? '') as string;
          const direction = ((actionDef as { direction?: string }).direction ?? 'next') as string;
          const arr = (get(arrayPath) as unknown[]) ?? [];
          const len = arr.length;
          const current = Number(get(path)) || 0;
          const next = direction === 'prev'
            ? (current - 1 + len) % len
            : (current + 1) % len;
          if (path) {
            store.getState().setState((prev) => setNestedValue(prev, path, next));
            if (!path.startsWith('screens.')) {
              useSduiStore.getState().setData(path, next);
            }
          }
          return;
        }
        // mergeAtPath: merge one key-value into object at path (for product.selectedOptions)
        if (actionDef?.type === 'mergeAtPath') {
          const path = ((actionDef as { path?: string }).path ?? '') as string;
          const keyRaw = (actionDef as { key?: unknown }).key;
          const valueRaw = (actionDef as { value?: unknown }).value;
          const key = resolveValue(keyRaw, get, scope) as string;
          const value = resolveValue(valueRaw, get, scope);
          if (path && key != null) {
            const current = get(path) as Record<string, unknown> | undefined;
            const next = { ...(current ?? {}), [key]: value };
            store.getState().setState((prev) => setNestedValue(prev, path, next));
          }
          return;
        }
        // goToPage: set skip from page number, then run fetch (for pagination with page numbers)
        if (actionDef?.type === 'goToPage') {
          const path = ((actionDef as { path?: string }).path ?? 'collectionSkip') as string;
          const pageRaw = (actionDef as { page?: unknown }).page;
          const page = resolveActionValue(pageRaw, get, scope, 1);
          const pageSizeRaw = (actionDef as { pageSize?: unknown }).pageSize;
          const pageSize = resolveActionValue(pageSizeRaw, get, scope, 12);
          const fetchAction = ((actionDef as { fetchAction?: string }).fetchAction ?? 'fetchCollection') as string;
          const skip = Math.max(0, (page - 1) * pageSize);
          store.getState().setState((prev) => setNestedValue(prev, path, skip));
          if (!path.startsWith('screens.')) {
            useSduiStore.getState().setData(path, skip);
          }
          await runOne({ action: fetchAction });
          return;
        }
        if (actionDef?.type === 'removeAt') {
          const path = (actionDef.path ?? '') as string;
          const rawIndex = (actionDef as { index?: unknown }).index;
          const index = rawIndex != null && typeof rawIndex === 'object' && 'var' in rawIndex
            ? Number(get(String((rawIndex as { var: string }).var), scope)) ?? 0
            : Number(rawIndex ?? 0);
          const arr = get(path) as unknown[];
          if (Array.isArray(arr) && index >= 0 && index < arr.length) {
            const next = [...arr.slice(0, index), ...arr.slice(index + 1)];
            useSduiStore.getState().setData(path, next);
          }
          return;
        }
        if (actionDef?.type === 'share') {
          const titleRaw = (actionDef as { title?: unknown }).title;
          const urlRaw = (actionDef as { url?: unknown }).url;
          const title =
            titleRaw != null && typeof titleRaw === 'object' && 'var' in titleRaw
              ? String(get(String((titleRaw as { var: string }).var), scope) ?? '')
              : String(titleRaw ?? '');
          const urlVal =
            urlRaw != null && typeof urlRaw === 'object' && 'var' in urlRaw
              ? get(String((urlRaw as { var: string }).var), scope)
              : urlRaw;
          const pathOrSlug = typeof urlVal === 'string' ? urlVal : (urlVal as { slug?: string })?.slug ?? '';
          const url =
            typeof window !== 'undefined'
              ? pathOrSlug.startsWith('/')
                ? `${window.location.origin}${pathOrSlug}`
                : `${window.location.origin}/product/${pathOrSlug}`
              : '';
          if (typeof navigator !== 'undefined' && navigator.share && title && url) {
            await navigator.share({ title, url }).catch(() => {});
          }
          return;
        }

        if (actionDef?.type === 'setTheme') {
          const value = ((actionDef as { value?: string }).value ?? 'system') as 'light' | 'dark' | 'system';
          setColorScheme(value);
          setData('nav.colorScheme', value);
          return;
        }

        if (actionName === 'navigate' && payload && typeof payload === 'object') {
          const pl = payload as { path?: string; routeConfig?: string; slug?: unknown };
          if (pl.routeConfig != null) {
            const targetRoute = routes.find(
              (r) => (r as RouteConfig).config === pl.routeConfig && (r as RouteConfig).dynamic
            );
            let slug: string | undefined;
            if (pl.slug != null && typeof pl.slug === 'object' && 'var' in pl.slug) {
              const v = (pl.slug as { var: string | [string, unknown] }).var;
              const varPath = Array.isArray(v) ? v[0] : v;
              const resolved = get(String(varPath), scope);
              slug = typeof resolved === 'string' ? resolved : (resolved as { slug?: string })?.slug;
            } else if (typeof pl.slug === 'string') {
              slug = pl.slug;
            } else {
              const item = scope?.$item as { slug?: string } | undefined;
              slug = item?.slug;
            }
            if (targetRoute?.path && slug) {
              router.push(`${targetRoute.path}/${slug}`);
            }
          } else if ('path' in pl && pl.path) {
            const path = String(pl.path);
            const interpolated = interpolateUrl(path, get, scope);
            const qIdx = interpolated.indexOf('?');
            if (qIdx >= 0) {
              const basePath = interpolated.slice(0, qIdx);
              const newQuery = interpolated.slice(qIdx + 1);
              const merged = new URLSearchParams(searchParams ? searchParams.toString() : '');
              const newParams = new URLSearchParams(newQuery);
              for (const key of newParams.keys()) {
                merged.delete(key);
                for (const v of newParams.getAll(key)) merged.append(key, v);
              }
              const qs = merged.toString();
              router.push(qs ? `${basePath}?${qs}` : basePath);
            } else {
              router.push(interpolated);
            }
          }
        } else if (actionName === 'setState' && payload && typeof payload === 'object' && 'path' in payload) {
          const p = payload as { path: string; value?: unknown; merge?: boolean };
          let value = p.value;
          if (value === '$event' && event !== undefined) {
            const ev = event as { target?: { value?: unknown }; nativeEvent?: { text?: unknown } };
            value =
              typeof event === 'string' ? event : ev?.target?.value ?? ev?.nativeEvent?.text ?? event;
          } else if (value != null && typeof value === 'object' && 'var' in value) {
            const v = (value as { var: string | [string, unknown] }).var;
            const varPath = Array.isArray(v) ? v[0] : v;
            value = get(String(varPath), scope) ?? (Array.isArray(v) ? v[1] : undefined);
          }
          store.getState().setState((prev) => {
            const finalValue = value ?? getNestedValue(prev, p.path);
            return setNestedValue(prev, p.path, finalValue, p.merge);
          });
        } else if (actionName === 'fetch' && payload && typeof payload === 'object' && 'url' in payload) {
          await fetchDataStable(payload as SDUIDataSource);
        } else if (actionName === 'showToast' && payload && typeof payload === 'object') {
          const pl = payload as { message?: string; type?: 'success' | 'error' | 'info' };
          const msg = String(pl.message ?? 'Done');
          if (pl.type === 'error') toast.error(msg);
          else if (pl.type === 'info') toast.info(msg);
          else toast.success(msg);
        } else if (actionName === 'log') {
          console.log('[SDUI]', payload);
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
    [router, searchParams, setColorScheme, fetchDataStable, actionsConfig, store, mergedStore, setLoading, setData, setError, append, routes, configName]
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

  // initActions use ref so they always call the latest runAction (avoids stale closure)
  const variableStoreConfig = useMemo(
    () => ({
      initialState: config.state ?? {},
      adapters: [] as { slice: string; getState: () => Record<string, unknown> }[],
    }),
    [config.state]
  );

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
    }),
    [store, mergedStore, variableStoreConfig, runActionStable, fetchDataStable, actionsConfig, configName]
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

  return (
    <RunActionProvider value={runActionStable}>
      <SDURenderer node={config.ui} context={context} />
    </RunActionProvider>
  );
}
