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
import { computeMergedState as computeMergedStateFn, finalizeMergedWithVariableStore } from './merge-state';
import type { SDUIConfig } from './types';
import type { NamedDataSourceDef } from './engine-types';

function getAllSCs(): Record<string, { content?: unknown }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const live = require('@/lib/builder/shared-component-data').getSharedComponents?.();
    if (live) return live as Record<string, { content?: unknown }>;
  } catch { /* noop */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@/config/shared-components.json') as Record<string, { content?: unknown }>;
  } catch { /* noop */ }
  return {};
}

/**
 * Walk a config tree and collect the `content` objects from any `_shared` SC nodes.
 * Pages reference shared components via `_shared: { id }` stubs — the SC content is not
 * pre-expanded into the page config, so `extractReferencedDataSources` would miss any
 * datasources used inside the SC (e.g. Nav Collections in the navbar). This function
 * traverses the full config tree and collects every SC's content for the datasource scan.
 */
function collectSharedComponentContents(node: unknown, out: unknown[] = [], visited = new Set<string>()): unknown[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) collectSharedComponentContents(child, out, visited);
    return out;
  }
  const n = node as Record<string, unknown>;

  if (n._shared && typeof n._shared === 'object') {
    const shared = n._shared as { id?: string };
    if (shared.id && !visited.has(shared.id)) {
      visited.add(shared.id);
      const scModel = getAllSCs()[shared.id];
      if (scModel?.content) {
        out.push(scModel.content);
        collectSharedComponentContents(scModel.content, out, visited);
      }
    }
  }

  for (const val of Object.values(n)) {
    if (val && typeof val === 'object') {
      collectSharedComponentContents(val, out, visited);
    }
  }
  return out;
}


const computedDefs: { output: string; expr: object }[] = [];

type SduiStore = ReturnType<typeof useSduiStore>;

export function useNamedDataSourceFetcher(
  dataSources: Record<string, NamedDataSourceDef> | undefined,
  dsRefetchKeys: Record<string, number>,
  config: SDUIConfig,
  store: SduiStore,
  globalContext?: Record<string, unknown>,
  onDatasourceError?: (datasourceId: string, error: string) => void,
) {
  const prevDsRefetchKeysRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!dataSources || Object.keys(dataSources).length === 0) return;
    const loadingSuffix = 'loading';
    const errorSuffix = 'error';

    const mergedBase = computeMergedStateFn(
      useSduiStore.getState(),
      config as { state?: Record<string, unknown>; meta?: Record<string, unknown> },
      computedDefs as { output: string; expr: object }[]
    );
    const vs = getGlobalVariableStore().getState().getFullState();
    const currentState = {
      ...finalizeMergedWithVariableStore(mergedBase, vs),
      ...(globalContext ? { globalContext } : {}),
    };

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
        if (typeof v === 'object' && v !== null && ('formula' in (v as object) || 'js' in (v as object))) {
          try {
            result[k] = evaluateFormula(v as object, currentState).value;
          } catch {
            result[k] = null;
          }
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

    const triggeredKeys = new Set(
      Object.keys(dsRefetchKeys).filter(n => dsRefetchKeys[n] !== (prevDsRefetchKeysRef.current[n] ?? 0))
    );
    prevDsRefetchKeysRef.current = { ...dsRefetchKeys };

    const allNames = Object.keys(dataSources);
    // Also scan contents of any _shared SC nodes so datasources used inside shared
    // components (e.g. navbar's Nav Collections) are fetched even though they are not
    // pre-expanded into the page config tree.
    const scContents = collectSharedComponentContents(config);
    const referencedNames = new Set([
      ...extractReferencedDataSources(config, allNames),
      ...scContents.flatMap(sc => extractReferencedDataSources(sc, allNames)),
    ]);

    // Build a set of triggered datasource UUIDs. Entries in triggeredKeys may be
    // either a datasource UUID (direct) or a cacheTag (from invalidateCache: ["tag"]).
    // Helper to get cacheTag from either REST or GraphQL datasource def
    const getDsCacheTag = (ds: NamedDataSourceDef): string | undefined =>
      (ds as { cacheTag?: string }).cacheTag;

    // Match both so invalidateCache works without knowing the UUID.
    const triggeredNames = triggeredKeys.size > 0
      ? new Set(
          allNames.filter(n => {
            const ds = dataSources[n];
            const tag = ds ? getDsCacheTag(ds) : undefined;
            return triggeredKeys.has(n) || (tag && triggeredKeys.has(tag));
          })
        )
      : new Set<string>();

    // When explicitly triggered by a workflow action, fetch those datasources regardless
    // of whether they appear in the screen config — the user/workflow requested it explicitly.
    // Auto-fetches (no explicit trigger) are still filtered to only referenced datasources.
    const neededNames = triggeredNames.size > 0
      ? triggeredNames
      : referencedNames;

    // Datasources triggered by cacheTag should bypass cache (same as UUID-triggered ones)
    const forcedByTag = new Set(
      allNames.filter(n => {
        const ds = dataSources[n];
        const tag = ds ? getDsCacheTag(ds) : undefined;
        return tag && triggeredKeys.has(tag);
      })
    );

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
            const isForced = forcedByTag.has(name);
            if (!isForced) {
              const cached = dsCacheGet(cacheKey);
              if (cached !== undefined) {
                sduiStore.setData(storeKey, cached);
                sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
                return;
              }
            }
          }

          const endpoint = interpolate(ds.endpoint);
          const extraHeaders: Record<string, string> = {};
          if (ds.headers) {
            for (const [k, v] of Object.entries(ds.headers)) {
              if (typeof v === 'object' && v !== null && ('formula' in (v as object) || 'js' in (v as object))) {
                try {
                  const result = evaluateFormula(v as object, currentState).value;
                  if (result != null) extraHeaders[k] = String(result);
                } catch { /* skip header if formula fails */ }
              } else {
                const resolved = interpolate(String(v));
                if (k.toLowerCase() === 'authorization' && /^bearer\s*$/i.test(resolved)) continue;
                if (resolved) extraHeaders[k] = resolved;
              }
            }
          }
          const resolvedVariables = resolveVariables((ds.variables ?? {}) as Record<string, unknown>);

          // Route through /api/proxy when ds.proxy is true (per-datasource opt-in).
          const useProxy = !!ds.proxy;
          const fetchUrl = useProxy ? '/api/proxy' : endpoint;
          const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
          const body = useProxy
            ? JSON.stringify({
                endpoint,
                method: 'POST',
                headers: Object.keys(extraHeaders).length ? extraHeaders : undefined,
                body: JSON.stringify({ query: ds.query, variables: resolvedVariables }),
              })
            : JSON.stringify({ query: ds.query, variables: resolvedVariables });

          fetch(fetchUrl, {
            method: 'POST',
            headers: useProxy ? { 'Content-Type': 'application/json' } : headers,
            body,
            credentials: 'include',
          })
            .then(res => res.json())
            .then((json: unknown) => {
              const data = json as { data?: unknown; errors?: Array<{ message: string }> };
              if (data.errors?.length) {
                const errMsg = data.errors[0]?.message ?? 'GraphQL error';
                sduiStore.setData(`${storeKey}.${errorSuffix}`, errMsg);
                sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
                onDatasourceError?.(name, errMsg);
                return;
              }
              const result = extractPath(json, ds.responsePath);
              if (result === null && ds.skipStoreWhenNull) return;
              if (cacheKey && cacheTTL > 0) dsCacheSet(cacheKey, result, cacheTTL);
              sduiStore.setData(storeKey, result);
              sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
            })
            .catch((err: unknown) => {
              const errMsg = String(err);
              sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
              sduiStore.setData(`${storeKey}.${errorSuffix}`, errMsg);
              onDatasourceError?.(name, errMsg);
            });
        } else {
          const rawHeaders = ds.headers;
          const headers: Record<string, string> = {};
          if (Array.isArray(rawHeaders)) {
            rawHeaders.filter(h => h.enabled !== false && h.key.trim()).forEach(h => {
              headers[h.key] = h.value;
            });
          } else if (rawHeaders && typeof rawHeaders === 'object') {
            for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
              if (typeof v === 'object' && v !== null && ('formula' in (v as object) || 'js' in (v as object))) {
                try {
                  const result = evaluateFormula(v as object, currentState).value;
                  if (result != null) headers[k] = String(result);
                } catch { /* skip header if formula fails */ }
              } else {
                const resolved = interpolate(String(v));
                // Skip Authorization header when the token is missing (e.g., guest users)
                // to avoid sending "Bearer " and avoid an unnecessary preflight.
                if (k.toLowerCase() === 'authorization' && /^bearer\s*$/i.test(resolved)) continue;
                if (resolved) headers[k] = resolved;
              }
            }
          }
          const enabled = (ds.queryParams ?? []).filter(p => p.enabled !== false && p.key.trim());
          // Resolve URL: support formula objects { formula: "..." } and {{interpolation}} strings
          let url: string;
          const rawUrl = ds.url as unknown;
          if (typeof rawUrl === 'object' && rawUrl !== null && 'formula' in (rawUrl as object)) {
            try {
              const resolved = evaluateFormula((rawUrl as { formula: string | object }).formula, currentState).value;
              url = String(resolved ?? '');
            } catch {
              url = '';
            }
          } else {
            url = interpolate(String(rawUrl ?? ''));
          }
          if (enabled.length) {
            const qs = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
            url = `${url}${url.includes('?') ? '&' : '?'}${qs}`;
          }

          // REST cache — same logic as graphql branch
          const restCacheTag = ds.cacheTag ?? '';
          const restCacheTTL = Number(ds.cacheTTL ?? 0);
          const restCacheKeyVars = (ds.cacheKeyVars ?? []) as string[];
          let restCacheKey = '';
          if (restCacheTag && restCacheTTL > 0) {
            const keyParts = restCacheKeyVars.map(p => String(getNestedValue(currentState, p) ?? ''));
            restCacheKey = `ds:${restCacheTag}:${keyParts.join(':')}`;
            const isForced = forcedByTag.has(name);
            if (!isForced) {
              const cached = dsCacheGet(restCacheKey);
              if (cached !== undefined) {
                sduiStore.setData(storeKey, cached);
                sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
                return;
              }
            }
          }

          if (ds.proxy) {
            // Route through /api/proxy — generic HTTP forwarder
            fetch('/api/proxy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                endpoint: url,
                method: ds.method ?? 'GET',
                headers: Object.keys(headers).length ? headers : undefined,
                body: ds.body ?? undefined,
              }),
            })
              .then(res => res.json())
              .then((json: unknown) => {
                const result = extractPath(json, ds.responsePath);
                if (result === null && ds.skipStoreWhenNull) return;
                if (restCacheKey && restCacheTTL > 0) dsCacheSet(restCacheKey, result, restCacheTTL);
                sduiStore.setData(storeKey, result);
                sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
              })
              .catch((err: unknown) => {
                const errMsg = String(err);
                sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
                sduiStore.setData(`${storeKey}.${errorSuffix}`, errMsg);
                onDatasourceError?.(name, errMsg);
              });
          } else {
            const fetchOpts: RequestInit = { method: ds.method ?? 'GET', headers };
            if (ds.sendCredentials) fetchOpts.credentials = 'include';

            fetch(url, fetchOpts)
              .then(res => res.json())
              .then((json: unknown) => {
                const result = extractPath(json, ds.responsePath);
                if (result === null && ds.skipStoreWhenNull) return;
                if (restCacheKey && restCacheTTL > 0) dsCacheSet(restCacheKey, result, restCacheTTL);
                sduiStore.setData(storeKey, result);
                sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
              })
              .catch((err: unknown) => {
                const errMsg = String(err);
                sduiStore.setData(`${storeKey}.${loadingSuffix}`, false);
                sduiStore.setData(`${storeKey}.${errorSuffix}`, errMsg);
                onDatasourceError?.(name, errMsg);
              });
          }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSources, dsRefetchKeys, globalContext]);
}
