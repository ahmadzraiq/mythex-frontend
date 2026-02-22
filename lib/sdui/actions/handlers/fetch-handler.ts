/**
 * Handler for type: "fetch" - REST API calls
 */

import { getNestedValue } from '../../nested-utils';
import { interpolateUrl, resolvePayload } from '../resolve-value';
import type { ActionDef, ActionHandlerContext } from './types';

export const fetchHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const CONVENTIONS = ctx.CONVENTIONS as { defaultStoreIn?: string; defaultErrorMessagePath?: string };
    const storeIn = (actionDef.storeIn ?? CONVENTIONS.defaultStoreIn) as string;
    const storeFullResponseIn = actionDef.storeFullResponseIn as string | undefined;
    const errorMessagePath = (actionDef.errorMessagePath ?? CONVENTIONS.defaultErrorMessagePath) as string;
    const url = interpolateUrl(String(actionDef.url ?? ''), ctx.get, ctx.scope);
    const map = actionDef.map as Record<string, string> | undefined;
    const responsePath = actionDef.responsePath as string | undefined;
    const body = actionDef.body as Record<string, unknown> | undefined;
    const resolvedBody = body ? resolvePayload(body, ctx.get, ctx.scope) : undefined;

    ctx.setLoading(storeIn, true);
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
      let data: unknown = rawResponse;
      if (storeFullResponseIn) {
        ctx.setData(storeFullResponseIn, rawResponse);
      }
      if (responsePath && typeof responsePath === 'string') {
        const parts = responsePath.split('.');
        for (const p of parts) {
          data = (data as Record<string, unknown>)?.[p];
        }
      }
      if (Array.isArray(data) && map && typeof map === 'object') {
        data = (data as Record<string, unknown>[]).map((item: Record<string, unknown>) => {
          const out: Record<string, unknown> = {};
          for (const [ourKey, apiKey] of Object.entries(map)) {
            const val = item[apiKey] ?? item[ourKey];
            out[ourKey] = ourKey === 'id' && val != null ? String(val) : val;
          }
          return out;
        });
      }
      ctx.setData(storeIn, data);
      const onSuccess = actionDef.onSuccess;
      if (onSuccess) {
        const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
        for (const a of actions) {
          await ctx.runOne(a as import('../../types').SDUIAction);
        }
      }
    } catch (err) {
      ctx.setError(storeIn, err instanceof Error ? err.message : 'Fetch failed');
    }
  };
