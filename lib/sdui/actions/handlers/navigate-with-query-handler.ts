/**
 * Handler for type: "navigateWithQuery" - navigate with explicit query param overrides
 * Merges queryParams with current searchParams, then navigates.
 * Use null in queryParams to remove a param.
 */

import { CONVENTIONS } from '../../conventions';
import { setNestedValue } from '../../nested-utils';
import { resolveValue } from '../resolve-value';
import type { ActionDef, ActionHandlerContext } from './types';

function serializeParamValue(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v ?? '')).filter(Boolean);
  return [String(value)];
}

export const navigateWithQueryHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const router = ctx.router;
    const payload = ctx.payload ?? actionDef;
    const pl = payload as { path?: unknown; queryParams?: Record<string, unknown> };

    if (!router) return;

    const fullState = { ...ctx.getFullMergedState(), ...(ctx.scope ?? {}) };
    const path = pl.path != null
      ? resolveValue(pl.path, ctx.get, ctx.scope, fullState)
      : ctx.pathname ?? '/';
    const basePath = typeof path === 'string' ? path.split('?')[0] : '/';

    const merged = new URLSearchParams(ctx.searchParams?.toString() ?? '');
    const queryParams = pl.queryParams;
    if (queryParams && typeof queryParams === 'object') {
      for (const [key, rawVal] of Object.entries(queryParams)) {
        const value = resolveValue(rawVal, ctx.get, ctx.scope, fullState);
        if (value === null || value === undefined) {
          merged.delete(key);
        } else {
          merged.delete(key);
          const parts = serializeParamValue(value);
          for (const v of parts) merged.append(key, v);
        }
      }
    }

    const qs = merged.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);

    // Reset variable store paths configured to clear on navigation (e.g. open menus)
    const resetPaths = CONVENTIONS.resetVarsOnNavigate;
    if (resetPaths.length > 0) {
      ctx.store.getState().setState((prev) => {
        let next = prev;
        for (const p of resetPaths) {
          next = setNestedValue(next, p, false);
        }
        return next;
      });
    }
  };
