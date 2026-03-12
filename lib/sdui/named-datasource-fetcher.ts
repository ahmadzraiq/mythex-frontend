'use client';

/**
 * Named data source fetcher — extracted from sdui-engine.tsx.
 *
 * Provides the `useNamedDataSourceFetcher` hook that handles fetching data from
 * named datasources (REST and GraphQL) and storing results in the Zustand store.
 *
 * Data is stored at `collections.{name}` so it's accessible via
 * `{{collections.UUID.data.field}}` throughout screen/fragment configs.
 */

import { useEffect, useRef } from 'react';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from './global-variable-store';
import { getNestedValue } from './nested-utils';
import { evaluateFormula } from './formula-evaluator';
import { dsCacheGet, dsCacheSet } from './ds-cache';
import { extractReferencedDataSources } from './nested-utils';
import { CONVENTIONS } from './conventions';
import { computeMergedState as computeMergedStateFn, finalizeMergedWithVariableStore } from './merge-state';
import type { SDUIConfig } from './types';
import type { NamedDataSourceDef } from './engine-types';

import storeConfig from '@/config/store-config';

const computedDefs = (storeConfig as { computed?: unknown[] }).computed ?? [];

type SduiStore = ReturnType<typeof useSduiStore>;

export function useNamedDataSourceFetcher(
  dataSources: Record<string, NamedDataSourceDef> | undefined,
  dsRefetchKeys: Record<string, number>,
  config: SDUIConfig,
  store: SduiStore,
) {
  const prevDsRefetchKeysRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!dataSources || Object.keys(dataSources).length === 0) return;
    const conventions = CONVENTIONS as { loadingSuffix?: string; errorSuffix?: string };
    const loadingSuffix = conventions.loadingSuffix ?? '_loading';
    const errorSuffix = conventions.errorSuffix ?? '_error';

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

    const resolveVariables = (vars: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(vars)) {
        if (typeof v === 'object' && v !== null && 'expr' in (v as object)) {
          const expr = (v as { expr: unknown }).expr;
          try {
            result[k] = evaluateFormula(expr as string | object, currentState).value;
          } catch {
            result[k] = null;
          }
        } else if (typeof v === 'object' && v !== null && 'var' in (v as object)) {
          const varRef = (v as { var: string | [string, unknown] }).var;
          const pathStr = Array.isArray(varRef) ? varRef[0] : varRef;
          const defaultVal = Array.isArray(varRef) ? varRef[1] : null;
          const resolved = getNestedValue(currentState, pathStr as string);
          result[k] = resolved !== undefined && resolved !== null ? resolved : defaultVal;
        } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          result[k] = resolveVariables(v as Record<string, unknown>);
        } else if (typeof v === 'string') {
          const orMatch = v.match(/^\{\{([^}]+)\}\}\s*\|\|\s*(.+)$/);
          if (orMatch) {
            const pathVal = getNestedValue(currentState, orMatch[1].trim());
            if (pathVal !== null && pathVal !== undefined && pathVal !== '') {
              result[k] = pathVal;
            } else {
              const fallback = orMatch[2].trim();
              try { result[k] = JSON.parse(fallback); } catch { result[k] = fallback; }
            }
          } else if (/^\{\{([^}]+)\}\}$/.test(v)) {
            const m = v.match(/^\{\{([^}]+)\}\}$/)!;
            result[k] = getNestedValue(currentState, m[1].trim()) ?? null;
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

    const triggeredNames = new Set(
      Object.keys(dsRefetchKeys).filter(n => dsRefetchKeys[n] !== (prevDsRefetchKeysRef.current[n] ?? 0))
    );
    prevDsRefetchKeysRef.current = { ...dsRefetchKeys };

    const allNames = Object.keys(dataSources);
    const referencedNames = new Set(extractReferencedDataSources(config, allNames));

    const neededNames = triggeredNames.size > 0
      ? new Set([...triggeredNames].filter(n => referencedNames.has(n)))
      : referencedNames;

    Object.entries(dataSources)
      .filter(([name]) => neededNames.has(name))
      .forEach(([name, ds]: [string, NamedDataSourceDef]) => {
        const storeKey = `collections.${name}`;
        sduiStore.setData(`${storeKey}.${loadingSuffix}`, true);
        sduiStore.setData(`${storeKey}.${errorSuffix}`, null);

        if (ds.type === 'graphql') {
          const cacheTag = ds.cacheTag ?? '';
          const cacheTTL = Number(ds.cacheTTL ?? 0);
          const cacheKeyVars = (ds.cacheKeyVars ?? []) as string[];

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
}
