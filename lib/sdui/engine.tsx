'use client';

/**
 * SDUI Engine - Main entry point for Server-Driven UI
 * Loads config, manages state, fetches data, runs actions
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SDURenderer } from './renderer';
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

interface SDUIEngineProps {
  config: SDUIConfig;
}

export function SDUIEngine({ config }: SDUIEngineProps) {
  const [state, setStateState] = useState<Record<string, unknown>>(
    config.state ?? {}
  );

  const setState = useCallback(
    (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      setStateState(updater);
    },
    []
  );

  const fetchData = useCallback(async (ds: SDUIDataSource) => {
    try {
      const res = await fetch(ds.url, { method: ds.method ?? 'GET' });
      const data = await res.json();
      setStateState((prev) => ({ ...prev, [ds.key]: data }));
    } catch (err) {
      console.error('[SDUI] Fetch failed:', ds.url, err);
      setStateState((prev) => ({ ...prev, [ds.key]: null }));
    }
  }, []);

  const runAction = useCallback(
    async (action: SDUIAction | SDUIAction[], event?: unknown, scope?: Record<string, unknown>) => {
      const getWithScope = (path: string) => get(path, scope);
      const actions = Array.isArray(action) ? action : [action];
      let shouldContinue = true;
      for (const a of actions) {
        if (!shouldContinue) break;
        const { action: type, payload } = a;
        if (type === 'setState' && payload && 'path' in payload) {
          const p = payload as { path: string; value?: unknown; merge?: boolean };
          let value = p.value;
          if (value === '$event' && event !== undefined) {
            value = typeof event === 'string' ? event : (event as { target?: { value?: unknown } })?.target?.value;
          } else if (value && typeof value === 'object' && 'var' in value) {
            const v = (value as { var: string | [string, unknown] }).var;
            const varPath = Array.isArray(v) ? v[0] : v;
            const resolved = getWithScope(String(varPath));
            value = resolved ?? (Array.isArray(v) ? v[1] : undefined);
          }
          setStateState((prev) => {
            const finalValue = value ?? getNestedValue(prev, p.path);
            return setNestedValue(prev, p.path, finalValue, p.merge);
          });
        } else if (type === 'navigate' && payload && 'view' in payload) {
          const p = payload as { view: string; state?: Record<string, unknown> };
          setStateState((prev) => ({
            ...prev,
            currentView: p.view,
            ...(p.state ?? {}),
          }));
        } else if (type === 'fetch' && payload && 'url' in payload) {
          await fetchData(payload as SDUIDataSource);
        } else if (type === 'validate' && payload && 'rules' in payload) {
          const rules = (payload as { rules: Record<string, { required?: boolean; minLength?: number }> }).rules;
          const errors: Record<string, string> = {};
          for (const [path, rule] of Object.entries(rules)) {
            const val = getWithScope(path);
            if (rule.required && (val === undefined || val === null || val === '')) {
              errors[path] = 'Required';
            } else if (rule.minLength && typeof val === 'string' && val.length < rule.minLength) {
              errors[path] = `Min ${rule.minLength} characters`;
            }
          }
          setStateState((prev) => ({ ...prev, errors }));
          shouldContinue = Object.keys(errors).length === 0;
        } else if (type === 'setStateTemporary' && payload && 'path' in payload) {
          const p = payload as { path: string; value: unknown; clearAfter: number };
          setStateState((prev) => setNestedValue(prev, p.path, p.value));
          setTimeout(() => {
            setStateState((prev) => setNestedValue(prev, p.path, null));
          }, p.clearAfter ?? 2000);
        } else if (type === 'log') {
          console.log('[SDUI]', payload ?? state);
        }
      }
    },
    [fetchData, state, get]
  );

  const get = useCallback(
    (path: string, scope?: Record<string, unknown>) => {
      if (scope && (path.startsWith('$item') || path.startsWith('$index') || path === '$item' || path === '$index')) {
        const val = getNestedValue(scope, path);
        if (val !== undefined) return val;
      }
      return getNestedValue(state, path);
    },
    [state]
  );

  const context: SDUIContext = useMemo(
    () => ({
      state,
      setState,
      get,
      runAction,
      fetchData,
    }),
    [state, setState, get, runAction, fetchData]
  );

  // Fetch config-level data sources on mount
  useEffect(() => {
    config.dataSources?.forEach((ds) => fetchData(ds));
  }, [config.dataSources]); // eslint-disable-line react-hooks/exhaustive-deps

  return <SDURenderer node={config.ui} context={context} />;
}
