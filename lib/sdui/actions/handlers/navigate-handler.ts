/**
 * Handler for type: "navigate" - router navigation via path (with optional inline query string)
 */

import { setNestedValue } from '../../nested-utils';
import { interpolateUrl, resolveValue } from '../resolve-value';
import { RESET_ON_NAVIGATE_PATHS } from '../../variable-config';
import type { ActionDef, ActionHandlerContext } from './types';

export const navigateHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const router = ctx.router;
    const payload = ctx.payload ?? actionDef;
    const pl = payload as { path?: string | Record<string, unknown> };

    if (!router) return;

    if ('path' in pl && pl.path) {
      const fullState = ctx.getFullMergedState();
      const stateWithScope = ctx.scope ? { ...fullState, ...ctx.scope } : fullState;
      const resolvedPath = typeof pl.path === 'object'
        ? resolveValue(pl.path, ctx.get, ctx.scope, stateWithScope)
        : pl.path;
      const path = String(resolvedPath ?? '');
      const interpolated = path.includes('{{') ? interpolateUrl(path, ctx.get, ctx.scope) : path;
      const qIdx = interpolated.indexOf('?');
      if (qIdx >= 0 && ctx.searchParams) {
        const basePath = interpolated.slice(0, qIdx);
        const newQuery = interpolated.slice(qIdx + 1);
        const merged = new URLSearchParams(ctx.searchParams.toString());
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

    const resetPaths = RESET_ON_NAVIGATE_PATHS;
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
