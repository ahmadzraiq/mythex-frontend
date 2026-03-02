/**
 * Handler for type: "navigate" - router navigation (path or routeConfig + slug)
 */

import { CONVENTIONS } from '../../conventions';
import { setNestedValue } from '../../nested-utils';
import { interpolateUrl, resolveValue } from '../resolve-value';
import type { ActionDef, ActionHandlerContext } from './types';

export const navigateHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const router = ctx.router;
    const routes = ctx.routes ?? [];
    const payload = ctx.payload ?? actionDef;
    const pl = payload as { path?: string | Record<string, unknown>; routeConfig?: string; slug?: unknown };

    if (!router) return;

    if (pl.routeConfig != null) {
      const targetRoute = routes.find(
        (r) => r.config === pl.routeConfig && r.dynamic
      );
      let slug: string | undefined;
      if (pl.slug != null && typeof pl.slug === 'object' && 'var' in pl.slug) {
        const v = (pl.slug as { var: string | [string, unknown] }).var;
        const varPath = Array.isArray(v) ? v[0] : v;
        const resolved = ctx.get(String(varPath), ctx.scope);
        slug = typeof resolved === 'string' ? resolved : (resolved as { slug?: string })?.slug;
      } else if (typeof pl.slug === 'string') {
        slug = pl.slug.includes('{{') ? interpolateUrl(pl.slug, ctx.get, ctx.scope) : pl.slug;
      } else {
        const item = ctx.scope?.$item as { slug?: string } | undefined;
        slug = item?.slug;
      }
      if (targetRoute?.path && slug) {
        router.push(`${targetRoute.path}/${slug}`);
      }
    } else if ('path' in pl && pl.path) {
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
