/**
 * GraphQL action handler — type: "graphql"
 *
 * Sends a GraphQL query or mutation via HTTP POST.
 * Supports:
 *   endpoint, query, variables (JSON Logic-resolvable),
 *   headers (merged on top of engineConventions.graphqlHeaders),
 *   responsePath, storeIn, storeFullResponseIn, skipStoreWhenNull,
 *   errorMessagePath, onSuccess, cacheTag/cacheTTL/cacheKeyVars (pass-through)
 */

import { getNestedValue } from '../../nested-utils';
import { resolveValue, interpolateUrl } from '../resolve-value';
import type { ActionDef, ActionHandlerContext } from './types';

// ─── Simple LRU cache ────────────────────────────────────────────────────────

interface CacheEntry { value: unknown; expiresAt: number }
const _cache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 50;

function cacheGet(key: string): unknown | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return undefined; }
  return entry.value;
}
function cacheSet(key: string, value: unknown, ttlSec: number) {
  if (_cache.size >= MAX_CACHE_SIZE) {
    const firstKey = _cache.keys().next().value;
    if (firstKey) _cache.delete(firstKey);
  }
  _cache.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

// ─── UUID detection ───────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** When storeIn is a bare UUID, data lives under collections.UUID to match the
 *  {{collections.UUID.data.*}} path convention used in all screen/fragment configs. */
function resolveStoreKey(storeIn: string): string {
  return UUID_RE.test(storeIn) ? `collections.${storeIn}` : storeIn;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const graphqlHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const CONVENTIONS = ctx.CONVENTIONS as {
      graphqlEndpoint?: string;
      graphqlHeaders?: Record<string, string>;
      graphqlCredentials?: RequestCredentials;
      loadingSuffix?: string;
      errorSuffix?: string;
    };

    const storeIn = resolveStoreKey((actionDef.storeIn ?? '') as string);
    const fullState = ctx.getFullMergedState();

    // ── Endpoint ──────────────────────────────────────────────────────────────
    const rawEndpoint = (actionDef.endpoint ?? CONVENTIONS.graphqlEndpoint ?? '') as string;
    const endpoint = interpolateUrl(rawEndpoint, ctx.get, ctx.scope);
    if (!endpoint) {
      console.warn('[graphql] no endpoint defined; set engineConventions.graphqlEndpoint or action.endpoint');
      return;
    }

    // ── Headers ───────────────────────────────────────────────────────────────
    const globalHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(CONVENTIONS.graphqlHeaders ?? {})) {
      globalHeaders[k] = interpolateUrl(String(v), ctx.get, ctx.scope);
    }
    const actionHeaders: Record<string, string> = {};
    const rawHeaders = actionDef.headers as Record<string, unknown> | undefined;
    if (rawHeaders) {
      for (const [k, v] of Object.entries(rawHeaders)) {
        const resolved = resolveValue(v, ctx.get, ctx.scope, fullState);
        if (resolved != null && resolved !== '') {
          actionHeaders[k] = String(resolved);
        }
      }
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...globalHeaders,
      ...actionHeaders,
    };

    // ── Variables ─────────────────────────────────────────────────────────────
    // Start with actionDef.variables, then overlay ctx.payload so callers can
    // override specific variables (e.g. adjusted quantity from a +/- button).
    const rawVars = actionDef.variables as Record<string, unknown> | undefined;
    const variables: Record<string, unknown> = {};
    if (rawVars) {
      for (const [k, v] of Object.entries(rawVars)) {
        variables[k] = resolveValue(v, ctx.get, ctx.scope, fullState);
      }
    }
    if (ctx.payload && typeof ctx.payload === 'object') {
      for (const [k, v] of Object.entries(ctx.payload)) {
        variables[k] = resolveValue(v as Parameters<typeof resolveValue>[0], ctx.get, ctx.scope, fullState);
      }
    }

    // ── Cache check ───────────────────────────────────────────────────────────
    const cacheTag = (actionDef.cacheTag ?? '') as string;
    const cacheTTL = Number(actionDef.cacheTTL ?? 0);
    const cacheKeyVars = (actionDef.cacheKeyVars as string[] | undefined) ?? [];
    let cacheKey = '';
    if (cacheTag && cacheTTL > 0) {
      const keyParts = cacheKeyVars.map(p => String(ctx.get(p, ctx.scope) ?? ''));
      cacheKey = `gql:${cacheTag}:${keyParts.join(':')}`;
      const cached = cacheGet(cacheKey);
      if (cached !== undefined) {
        if (storeIn) ctx.setData(storeIn, cached);
        return;
      }
    }

    // ── Loading state ─────────────────────────────────────────────────────────
    if (storeIn) ctx.setLoading(storeIn, true);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: actionDef.query, variables }),
        ...(CONVENTIONS.graphqlCredentials ? { credentials: CONVENTIONS.graphqlCredentials } : {}),
      });

      // ── HTTP error ──────────────────────────────────────────────────────────
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const errBody = await res.json() as Record<string, unknown>;
          const errPath = (actionDef.errorMessagePath ?? 'errors[0].message') as string;
          const extracted = getNestedValue(errBody, errPath);
          if (extracted) errMsg = String(extracted);
        } catch { /* ignore */ }
        if (storeIn) ctx.setError(storeIn, errMsg);
        return;
      }

      const json = await res.json() as { data?: unknown; errors?: Array<{ message: string }> };

      // ── GraphQL errors ──────────────────────────────────────────────────────
      if (json.errors && json.errors.length > 0) {
        const gqlErr = json.errors[0]?.message ?? 'GraphQL error';
        if (storeIn) ctx.setError(storeIn, gqlErr);
        return;
      }

      // ── Response extraction ─────────────────────────────────────────────────
      if (actionDef.storeFullResponseIn) {
        ctx.setData(actionDef.storeFullResponseIn as string, json);
      }

      const responsePath = (actionDef.responsePath ?? '') as string;
      let data: unknown = json;
      if (responsePath) {
        data = getNestedValue(json as Record<string, unknown>, responsePath);
      }

      // ── Store ───────────────────────────────────────────────────────────────
      if (storeIn) {
        if (data === null && actionDef.skipStoreWhenNull) {
          // skip
        } else {
          ctx.setData(storeIn, data);
        }
      }

      // ── Cache write ─────────────────────────────────────────────────────────
      if (cacheKey && cacheTTL > 0) {
        cacheSet(cacheKey, data, cacheTTL);
      }

      if (storeIn) ctx.setError(storeIn, null);

      // ── onSuccess ───────────────────────────────────────────────────────────
      const onSuccess = actionDef.onSuccess;
      if (onSuccess) {
        const nexts = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
        for (const a of nexts) {
          await ctx.runOne(a as import('../../types').SDUIAction);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (storeIn) ctx.setError(storeIn, msg);
    } finally {
      if (storeIn) ctx.setLoading(storeIn, false);
    }
  };
