/**
 * Handler for type: "graphql" - GraphQL queries and mutations
 */

import { toast } from 'sonner';
import { getNestedValue } from '../../nested-utils';
import { cacheGet, cacheSet, cacheInvalidate } from '../../fetch-cache';
import { interpolateUrl, resolvePayload } from '../resolve-value';
import type { ActionDef, ActionHandlerContext } from './types';

export const graphqlHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const CONVENTIONS = ctx.CONVENTIONS as {
      defaultStoreIn?: string;
      defaultErrorMessagePath?: string;
      graphqlEndpoint?: string;
      graphqlHeaders?: Record<string, string>;
      graphqlCredentials?: RequestCredentials;
    };
    const storeIn = (actionDef.storeIn ?? CONVENTIONS.defaultStoreIn) as string;
    const storeFullResponseIn = actionDef.storeFullResponseIn as string | undefined;
    const errorMessagePath = (actionDef.errorMessagePath ?? CONVENTIONS.defaultErrorMessagePath) as string;
    const rawEndpoint = (actionDef.endpoint as string) ?? CONVENTIONS.graphqlEndpoint ?? '';
    const endpoint = interpolateUrl(rawEndpoint, ctx.get, ctx.scope);
    const query = (actionDef.query as string) ?? '';
    const rawVariables = actionDef.variables as Record<string, unknown> | undefined;
    const fullState = ctx.getFullMergedState();
    const stateWithScope = ctx.scope ? { ...fullState, ...ctx.scope } : fullState;
    const baseVars = rawVariables ? resolvePayload(rawVariables, ctx.get, ctx.scope, stateWithScope) : {};
    const payloadVars =
      ctx.payload && typeof ctx.payload === 'object'
        ? resolvePayload(ctx.payload, ctx.get, ctx.scope, stateWithScope)
        : {};
    const variables: Record<string, unknown> | undefined =
      Object.keys(baseVars).length || Object.keys(payloadVars).length
        ? { ...baseVars, ...payloadVars }
        : undefined;

    const rawHeaders = (actionDef.headers as Record<string, string>) ?? {};
    const resolvedActionHeaders = resolvePayload(rawHeaders as Record<string, unknown>, ctx.get, ctx.scope, stateWithScope) as Record<string, string>;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...CONVENTIONS.graphqlHeaders,
      ...resolvedActionHeaders,
    };
    for (const key of Object.keys(headers)) {
      if (headers[key] == null || headers[key] === '' || headers[key] === 'null' || headers[key] === 'undefined') {
        delete headers[key];
      }
    }

    const responsePath = actionDef.responsePath as string | undefined;
    const credentials = (actionDef.credentials as RequestCredentials) ?? CONVENTIONS.graphqlCredentials;
    const storeHeaderIn = actionDef.storeHeaderIn as Record<string, string> | undefined;
    const cacheTag = actionDef.cacheTag as string | undefined;
    const cacheTTL = (actionDef.cacheTTL as number) ?? 0;
    const invalidateCache = actionDef.invalidateCache as string[] | undefined;
    const cacheKeyVars = actionDef.cacheKeyVars as string[] | undefined;
    const isQuery = query.trim().toLowerCase().startsWith('query');
    const canCache = isQuery && !!cacheTag && cacheTTL > 0;
    const cacheVars =
      canCache && cacheKeyVars?.length
        ? { ...variables, ...Object.fromEntries(cacheKeyVars.map((p) => [p, ctx.get(p)])) }
        : variables;

    const cached = canCache ? cacheGet(cacheTag!, cacheVars) : null;
    if (cached != null) {
      let data: unknown = cached;
      if (responsePath && typeof responsePath === 'string') {
        const parts = responsePath.split('.');
        for (const p of parts) data = (data as Record<string, unknown>)?.[p];
      }
      const skipStoreWhenNull = actionDef.skipStoreWhenNull as boolean | undefined;
      if (!skipStoreWhenNull || data != null) {
        const toStore =
          data != null && typeof data === 'object' && !Array.isArray(data)
            ? JSON.parse(JSON.stringify(data))
            : data;
        ctx.setData(storeIn, toStore);
      }
      return;
    }

    ctx.setLoading(storeIn, true);
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

      if (storeHeaderIn) {
        for (const [storePath, headerName] of Object.entries(storeHeaderIn)) {
          const headerValue = res.headers.get(headerName);
          if (headerValue) ctx.setData(storePath, headerValue);
        }
      }
      if (storeFullResponseIn) {
        ctx.setData(storeFullResponseIn, rawResponse);
      }

      let data: unknown = rawResponse;
      if (responsePath && typeof responsePath === 'string') {
        const parts = responsePath.split('.');
        for (const p of parts) {
          data = (data as Record<string, unknown>)?.[p];
        }
      }

      const addResult = data as { __typename?: string; errorCode?: string; message?: string } | undefined;
      if (addResult?.errorCode || addResult?.__typename === 'ErrorResult') {
        throw new Error(addResult?.message ?? 'Operation failed');
      }

      const skipStoreWhenNull = actionDef.skipStoreWhenNull as boolean | undefined;
      if (!skipStoreWhenNull || data != null) {
        const toStore =
          data != null && typeof data === 'object' && !Array.isArray(data)
            ? JSON.parse(JSON.stringify(data))
            : data;
        ctx.setData(storeIn, toStore);
      }
      if (canCache) cacheSet(cacheTag!, cacheVars, rawResponse, cacheTTL);
      if (invalidateCache?.length) for (const t of invalidateCache) cacheInvalidate(t);

      const onSuccess = actionDef.onSuccess;
      if (onSuccess) {
        const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
        for (const a of actions) {
          await ctx.runOne(a as import('../../types').SDUIAction);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GraphQL request failed';
      ctx.setError(storeIn, msg);
      toast.error(msg);
      throw err;
    }
  };
