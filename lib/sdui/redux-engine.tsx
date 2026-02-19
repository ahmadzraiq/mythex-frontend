'use client';

/**
 * SDUI Engine - Variable-based, adapter-agnostic, fine-grained reactivity
 * Uses variable store for state; adapters inject external sources (Redux, etc.)
 * Each node subscribes only to the variables it uses
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { shallowEqual } from 'react-redux';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setLoading, setData, setError, append } from '@/store/slices/configSlice';
import { SDURenderer } from './renderer';
import { createVariableStore } from './variable-store';
import type { SDUIConfig, SDUIContext, SDUIAction, SDUIDataSource } from './types';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
  merge = false
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(obj));
  const parts = path.split('.');
  let current = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (merge && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    current[last] = { ...(current[last] as object), ...(value as object) };
  } else {
    current[last] = value;
  }
  return result;
}

function interpolateUrl(url: string, get: (path: string, scope?: Record<string, unknown>) => unknown, scope?: Record<string, unknown>): string {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const val = get(path.trim(), scope);
    return val != null ? String(val) : '';
  });
}

function resolvePayload(
  payload: Record<string, unknown>,
  get: (path: string, scope?: Record<string, unknown>) => unknown,
  scope?: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value != null && typeof value === 'object' && !Array.isArray(value) && 'var' in value) {
      const v = (value as { var: string | [string, unknown] }).var;
      const path = Array.isArray(v) ? v[0] : v;
      const fallback = Array.isArray(v) ? v[1] : undefined;
      const resolved = get(String(path), scope);
      result[key] = resolved !== undefined && resolved !== null ? resolved : fallback;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export interface ValidationRule {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  equals?: string;
  message?: string;
}

export interface ActionsConfig {
  [actionName: string]: {
    type: string;
    url?: string;
    method?: string;
    body?: Record<string, unknown>;
    storeIn?: string;
    responsePath?: string;
    path?: string;
    value?: unknown;
    map?: Record<string, string>;
    rules?: Record<string, ValidationRule>;
    storeErrorsIn?: string;
    payload?: Record<string, unknown>;
    actions?: Array<{ action: string; payload?: Record<string, unknown> }>;
    onSuccess?: { action: string; payload?: Record<string, unknown> } | { action: string; payload?: Record<string, unknown> }[];
  };
}

export interface EngineConfig {
  sync?: readonly string[]; // optional: if empty/undefined, syncs all Redux slices
}

export interface RouteConfig {
  path: string;
  config?: string;
  dynamic?: boolean;
}

interface ReduxSDUIEngineProps {
  config: SDUIConfig;
  actionsConfig?: ActionsConfig;
  engineConfig?: EngineConfig;
  routes?: RouteConfig[];
}

export function ReduxSDUIEngine({
  config,
  actionsConfig = {},
  engineConfig = {},
  routes = [],
}: ReduxSDUIEngineProps) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const syncSlices = engineConfig.sync;
  const reduxState = useAppSelector(
    (state) => {
      const s = state as Record<string, unknown>;
      const configSlice = s.config as { data?: Record<string, unknown>; loading?: Record<string, boolean>; error?: Record<string, string | null> } | undefined;
      const configData = configSlice?.data ?? {};
      const configLoading = configSlice?.loading ?? {};
      const configError = configSlice?.error ?? {};
      const slices = syncSlices?.length ? syncSlices : Object.keys(s).filter((k) => k !== 'config');
      const out: Record<string, unknown> = {};
      for (const slice of slices) {
        const val = s[slice];
        if (val !== undefined) out[slice] = val;
      }
      // Start with config.state + meta so screen-specific state and {{meta.title}} work
      const meta = (config as { meta?: Record<string, unknown> }).meta;
      let merged = {
        ...(config.state ?? {}),
        ...(meta ? { meta } : {}),
        ...out,
      } as Record<string, unknown>;
      for (const path of Object.keys(configData)) {
        merged = setNestedValue(merged, path, configData[path]);
      }
      for (const path of Object.keys(configLoading)) {
        const slice = path.split('.')[0];
        merged = setNestedValue(merged, `${slice}.loading`, configLoading[path]);
      }
      for (const path of Object.keys(configError)) {
        const slice = path.split('.')[0];
        merged = setNestedValue(merged, `${slice}.error`, configError[path]);
      }
      for (const slice of Object.keys(merged)) {
        const cart = getNestedValue(merged, `${slice}.cart`) as { quantity?: number }[] | undefined;
        if (Array.isArray(cart)) {
          const count = cart.reduce((sum, i) => sum + (i?.quantity ?? 1), 0);
          merged = setNestedValue(merged, `${slice}.cartCount`, count);
        }
      }
      return merged;
    },
    shallowEqual
  );

  const meta = (config as { meta?: Record<string, unknown> }).meta;
  const store = useMemo(
    () =>
      createVariableStore({
        initialState: {
          ...(config.state ?? {}),
          ...(meta ? { meta } : {}),
        },
        adapters: [],
      }),
    [config.state, meta]
  );

  useEffect(() => {
    const state = reduxState as Record<string, unknown>;
    // Deep merge redux state into store - single update to avoid multiple re-renders
    const current = store.getState().getFullState();
    const merged = JSON.parse(JSON.stringify(current));
    for (const key of Object.keys(state)) {
      const val = state[key];
      if (val !== undefined) {
        merged[key] =
          val !== null && typeof val === 'object' && !Array.isArray(val)
            ? { ...(merged[key] as object), ...(val as object) }
            : val;
      }
    }
    store.getState().replaceState(merged);
  }, [reduxState, store]);

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
      const get = (path: string, s?: Record<string, unknown>) => store.getState().get(path, s ?? scope);

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
        } | undefined;
        // Support action aliases: { action: "setState", payload: {...} }
        if (actionDef && 'action' in actionDef && typeof (actionDef as { action?: string }).action === 'string') {
          const alias = actionDef as { action: string; payload?: Record<string, unknown> };
          return runOne({ action: alias.action, payload: alias.payload ?? payload });
        }
        if (actionDef?.type === 'validate' && actionDef.rules) {
          const rules = actionDef.rules;
          const storeErrorsIn = actionDef.storeErrorsIn ?? 'errors';
          const flatErrors: Record<string, string> = {};
          for (const [path, rule] of Object.entries(rules)) {
            const val = get(path);
            if (rule.required && (val === undefined || val === null || val === '')) {
              flatErrors[path] = rule.message ?? 'Required';
            } else if (rule.minLength && typeof val === 'string' && val.length < rule.minLength) {
              flatErrors[path] = rule.message ?? `Min ${rule.minLength} characters`;
            } else if (rule.maxLength && typeof val === 'string' && val.length > rule.maxLength) {
              flatErrors[path] = rule.message ?? `Max ${rule.maxLength} characters`;
            } else if (rule.pattern && typeof val === 'string') {
              const regex = rule.pattern === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/ : new RegExp(rule.pattern);
              if (!regex.test(val)) {
                flatErrors[path] = rule.message ?? 'Invalid format';
              }
            } else if (rule.equals != null) {
              const otherVal = get(rule.equals);
              if (val !== otherVal) {
                flatErrors[path] = rule.message ?? 'Must match';
              }
            }
          }
          const nestedErrors: Record<string, unknown> = {};
          for (const [path, msg] of Object.entries(flatErrors)) {
            setNestedValue(nestedErrors, path, msg);
          }
          store.getState().setState((prev) => setNestedValue(prev, storeErrorsIn, nestedErrors));
          if (Object.keys(flatErrors).length === 0) {
            const onSuccess = actionDef.onSuccess;
            if (onSuccess) {
              const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
              for (const a of actions) {
                await runOne(a as SDUIAction);
              }
            }
          }
          return;
        }
        if (actionDef?.type === 'append') {
          const path = actionDef.path ?? '';
          const rawValue = actionDef.value ?? (payload && typeof payload === 'object' ? (payload as Record<string, unknown>).value : undefined);
          const value =
            rawValue != null && typeof rawValue === 'object' && !Array.isArray(rawValue)
              ? resolvePayload(rawValue as Record<string, unknown>, get, scope)
              : rawValue;
          if (path) dispatch(append({ path, value }));
          return;
        }
        if (actionDef?.type === 'fetch') {
          const storeIn = actionDef.storeIn ?? 'data';
          const url = interpolateUrl(String(actionDef.url ?? ''), get, scope);
          const map = actionDef.map;
          const responsePath = actionDef.responsePath as string | undefined;
          const body = actionDef.body as Record<string, unknown> | undefined;
          const resolvedBody = body ? resolvePayload(body, get, scope) : undefined;
          dispatch(setLoading({ path: storeIn, loading: true }));
          try {
            const fetchOpts: RequestInit = { method: (actionDef.method as string) ?? 'GET' };
            if (resolvedBody && (fetchOpts.method === 'POST' || fetchOpts.method === 'PUT' || fetchOpts.method === 'PATCH')) {
              fetchOpts.headers = { 'Content-Type': 'application/json' };
              fetchOpts.body = JSON.stringify(resolvedBody);
            }
            const res = await fetch(url, fetchOpts);
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              const msg = (errData as { message?: string })?.message ?? `Fetch failed: ${res.status}`;
              throw new Error(msg);
            }
            let data = await res.json();
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
            dispatch(setData({ path: storeIn, value: data }));
            const onSuccess = actionDef.onSuccess;
            if (onSuccess) {
              const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
              for (const a of actions) {
                await runOne(a as SDUIAction);
              }
            }
          } catch (err) {
            dispatch(setError({ path: storeIn, error: err instanceof Error ? err.message : 'Fetch failed' }));
          }
          return;
        }
        if (actionDef?.type === 'runMultiple' && Array.isArray(actionDef.actions)) {
          for (const a of actionDef.actions) {
            await runOne(a as SDUIAction);
          }
          return;
        }
        if (actionDef?.type === 'set') {
          const path = actionDef.path ?? '';
          const rawValue = actionDef.value;
          const value =
            rawValue != null && typeof rawValue === 'object' && !Array.isArray(rawValue)
              ? resolvePayload(rawValue as Record<string, unknown>, get, scope)
              : rawValue;
          if (path) dispatch(setData({ path, value }));
          const onSuccess = actionDef.onSuccess;
          if (onSuccess) {
            const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
            for (const a of actions) {
              await runOne(a as SDUIAction);
            }
          }
          return;
        }

        if (actionName === 'navigate' && payload && typeof payload === 'object') {
          const pl = payload as { path?: string; routeConfig?: string; slug?: unknown };
          if (pl.routeConfig != null) {
            // Dynamic route: find route by config, resolve slug from payload/scope
            const targetRoute = routes.find(
              (r) => (r as RouteConfig).config === pl.routeConfig && (r as RouteConfig).dynamic
            );
            let slug: string | undefined;
            if (pl.slug != null && typeof pl.slug === 'object' && 'var' in pl.slug) {
              const v = (pl.slug as { var: string | [string, unknown] }).var;
              const varPath = Array.isArray(v) ? v[0] : v;
              const item = get(String(varPath), scope) as { slug?: string } | undefined;
              slug = item?.slug;
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
            router.push(interpolated);
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
        } else if (actionName === 'validate' && payload && typeof payload === 'object' && 'rules' in payload) {
          const pl = payload as { rules: Record<string, ValidationRule>; storeErrorsIn?: string };
          const rules = pl.rules;
          const storeErrorsIn = pl.storeErrorsIn ?? 'errors';
          const flatErrors: Record<string, string> = {};
          for (const [path, rule] of Object.entries(rules)) {
            const val = get(path);
            if (rule.required && (val === undefined || val === null || val === '')) {
              flatErrors[path] = rule.message ?? 'Required';
            } else if (rule.minLength && typeof val === 'string' && val.length < rule.minLength) {
              flatErrors[path] = rule.message ?? `Min ${rule.minLength} characters`;
            } else if (rule.maxLength && typeof val === 'string' && val.length > rule.maxLength) {
              flatErrors[path] = rule.message ?? `Max ${rule.maxLength} characters`;
            } else if (rule.pattern && typeof val === 'string') {
              const regex = rule.pattern === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/ : new RegExp(rule.pattern);
              if (!regex.test(val)) flatErrors[path] = rule.message ?? 'Invalid format';
            } else if (rule.equals != null && val !== get(rule.equals)) {
              flatErrors[path] = rule.message ?? 'Must match';
            }
          }
          const nestedErrors: Record<string, unknown> = {};
          for (const [path, msg] of Object.entries(flatErrors)) {
            setNestedValue(nestedErrors, path, msg);
          }
          store.getState().setState((prev) => setNestedValue(prev, storeErrorsIn, nestedErrors));
        } else if (actionName === 'log') {
          console.log('[SDUI]', payload);
        }
      };

      const actions = Array.isArray(action) ? action : [action];
      for (const a of actions) {
        await runOne(a as SDUIAction);
      }
    },
    [dispatch, router, fetchDataStable, actionsConfig, store]
  );

  const runActionStable = useCallback(
    (action: SDUIAction | SDUIAction[], event?: unknown, scope?: Record<string, unknown>) => {
      runAction(action, event, scope).catch((err) => {
        console.error('[SDUI] runAction error:', err);
      });
    },
    [runAction]
  );

  const storeConfig = useMemo(
    () => ({
      initialState: config.state ?? {},
      adapters: [] as { slice: string; getState: () => Record<string, unknown> }[],
    }),
    [config.state]
  );

  const context = useMemo(
    () => ({
      store,
      storeConfig,
      runAction: runActionStable,
      fetchData: fetchDataStable,
    }),
    [store, storeConfig, runActionStable, fetchDataStable]
  );

  useEffect(() => {
    config.dataSources?.forEach((ds) => fetchDataStable(ds));
  }, [config.dataSources]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    config.initActions?.forEach((action) => runAction(action));
  }, [config.initActions]); // eslint-disable-line react-hooks/exhaustive-deps

  return <SDURenderer node={config.ui} context={context} />;
}
