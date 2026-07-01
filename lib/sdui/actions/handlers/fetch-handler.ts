/**
 * REST fetch action handler — type: "fetch"
 *
 * Sends a REST HTTP request.
 * Supports:
 *   url (with {{interpolation}}), method, headers, body, queryParams,
 *   responsePath, storeIn, storeFullResponseIn,
 *   errorMessagePath, onSuccess
 */

import { getNestedValue } from '../../nested-utils';
import { resolveValue, interpolateUrl } from '../resolve-value';
import { getApiBase } from '../../api-base';
import type { ActionDef, ActionHandlerContext } from './types';

export const fetchHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<unknown> =
  (ctx) => async (actionDef) => {
    const storeIn = (actionDef.storeIn ?? '') as string;
    const fullState = ctx.getFullMergedState();

    // ── URL ───────────────────────────────────────────────────────────────────
    // url may be a plain string or a FormulaValue { formula: "..." } object —
    // resolve it before interpolation so { formula } evaluates correctly.
    const rawUrl = String(resolveValue(actionDef.url ?? '', ctx.get, ctx.scope, fullState) ?? '');
    if (!rawUrl) {
      console.warn('[fetch] no url defined in action');
      return;
    }
    let url = interpolateUrl(rawUrl, ctx.get, ctx.scope);

    // Append query params defined in the action
    const queryParams = actionDef.queryParams as Array<{ key: string; value: string; enabled?: boolean }> | undefined;
    if (queryParams?.length) {
      const qs = queryParams
        .filter(p => p.enabled !== false && p.key.trim())
        .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(interpolateUrl(p.value, ctx.get, ctx.scope))}`)
        .join('&');
      if (qs) url = `${url}${url.includes('?') ? '&' : '?'}${qs}`;
    }

    // ── Headers ───────────────────────────────────────────────────────────────
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const rawHeaders = actionDef.headers as Record<string, unknown> | undefined;
    if (rawHeaders) {
      for (const [k, v] of Object.entries(rawHeaders)) {
        const resolved = resolveValue(v, ctx.get, ctx.scope, fullState);
        if (resolved != null && resolved !== '') headers[k] = String(resolved);
      }
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    const method = ((actionDef.method as string) ?? 'GET').toUpperCase();
    let body: BodyInit | undefined;
    const rawBody = actionDef.body;
    if (rawBody != null && method !== 'GET' && method !== 'HEAD') {
      if (typeof rawBody === 'string') {
        body = interpolateUrl(rawBody, ctx.get, ctx.scope);
      } else if (typeof rawBody === 'object') {
        const resolved = resolveValue(rawBody, ctx.get, ctx.scope, fullState);
        body = JSON.stringify(resolved);
      }
    }

    if (storeIn) ctx.setLoading(storeIn, true);

    try {
      const useProxy = !!(actionDef.useProxy as boolean | undefined) || !!(actionDef.proxy as boolean | undefined);
      let res: Response;

      if (useProxy) {
        const backendBase = getApiBase();
        res = await fetch(`${backendBase}/v1/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            endpoint: url,
            method,
            headers: Object.keys(headers).length ? headers : undefined,
            body: body ?? undefined,
          }),
        });
      } else {
        res = await fetch(url, { method, headers, body });
      }

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const errBody = await res.json() as Record<string, unknown>;
          const errPath = (actionDef.errorMessagePath ?? 'message') as string;
          const extracted = getNestedValue(errBody, errPath);
          if (extracted) errMsg = String(extracted);
        } catch { /* ignore */ }
        if (storeIn) ctx.setError(storeIn, errMsg);
        ctx.setStepResult?.(undefined, errMsg);
        return undefined;
      }

      const json = await res.json() as unknown;

      // ── Build _response envelope ─────────────────────────────────────────────
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => { responseHeaders[key] = value; });
      const _response = { status: res.status, statusText: res.statusText, headers: responseHeaders };

      if (actionDef.storeFullResponseIn) {
        ctx.setData(actionDef.storeFullResponseIn as string, json);
      }

      const responsePath = (actionDef.responsePath ?? '') as string;
      const data = responsePath
        ? getNestedValue(json as Record<string, unknown>, responsePath)
        : json;

      if (storeIn) {
        ctx.setData(storeIn, data);
        ctx.setError(storeIn, null);
      }

      // Include _response alongside the body so workflow formulas can access
      // status, headers, etc.:
      //   context?.workflow?.['step-id']?._response?.headers?.['x-token']
      const stepResult = typeof json === 'object' && json !== null
        ? { ...(json as object), _response }
        : { data: json, _response };

      ctx.setStepResult?.(stepResult, null);

      // Invalidate datasource caches by tag/name after a successful mutation
      const invalidateTags = actionDef.invalidateCache as string[] | string | undefined;
      if (invalidateTags) {
        const tags = Array.isArray(invalidateTags) ? invalidateTags : [invalidateTags];
        for (const tag of tags) {
          ctx.triggerDataSourceRefetch?.(tag);
        }
      }

      const onSuccess = actionDef.onSuccess;
      if (onSuccess) {
        const nexts = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
        for (const a of nexts) {
          await ctx.runOne(a as import('../../types').SDUIAction);
        }
      }

      return stepResult;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (storeIn) ctx.setError(storeIn, msg);
      ctx.setStepResult?.(undefined, msg);
      return undefined;
    } finally {
      if (storeIn) ctx.setLoading(storeIn, false);
    }
  };
