/**
 * Handlers for restore, clearPersistedPaths, goToPage, removeAt, share, setTheme, setState, showToast, log, cycleIndex, mergeAtPath
 */

import { toast } from 'sonner';
import { getNestedValue, setNestedValue } from '../../nested-utils';
import { resolveActionValue, resolveValue } from '../resolve-value';
import { PERSIST_PATHS, THEME_PATH } from '../../variable-config';
import type { ActionDef, ActionHandlerContext } from './types';

export const restoreHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const storageKey = (actionDef.storageKey ?? path) as string;
    if (path && typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (raw != null && raw !== '') {
          const value = raw.startsWith('{') || raw.startsWith('[') ? JSON.parse(raw) : raw;
          ctx.setData(path, value);
          if (!path.startsWith('screens.')) {
            ctx.store.getState().setState((prev) => setNestedValue(prev, path, value));
          }
        }
      } catch (_) {}
    }
  };

export const clearPersistedPathsHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const pathsRaw = actionDef.paths as string[] | undefined;
    const paths = Array.isArray(pathsRaw) && pathsRaw.length > 0 ? pathsRaw : PERSIST_PATHS;
    if (typeof window !== 'undefined' && paths.length > 0) {
      try {
        for (const p of paths) {
          window.sessionStorage.removeItem(p);
        }
      } catch (_) {}
    }
    const onSuccess = actionDef.onSuccess;
    if (onSuccess) {
      const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
      for (const a of actions) {
        await ctx.runOne(a as import('../../types').SDUIAction);
      }
    }
  };

export const goToPageHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    if (!path) {
      console.warn('[goToPage] missing required "path" config; add path to the goToPage step');
      return;
    }
    const page = resolveActionValue(actionDef.page, ctx.get, ctx.scope, 1);
    const pageSize = resolveActionValue(actionDef.pageSize, ctx.get, ctx.scope, 12);
    const fetchAction = (actionDef.fetchAction ?? '') as string;
    if (!fetchAction) {
      console.warn('[goToPage] missing required "fetchAction" config; add fetchAction to the goToPage step');
      return;
    }
    const skip = Math.max(0, (page - 1) * pageSize);
    ctx.store.getState().setState((prev) => setNestedValue(prev, path, skip));
    if (!path.startsWith('screens.')) {
      ctx.useSduiStore?.getState().setData(path, skip);
    }
    await ctx.runOne({ action: fetchAction });
  };

export const removeAtHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const rawIndex = actionDef.index;
    const index =
      rawIndex != null && typeof rawIndex === 'object' && 'var' in rawIndex
        ? Number(ctx.get(String((rawIndex as { var: string }).var), ctx.scope)) ?? 0
        : Number(rawIndex ?? 0);
    const arr = ctx.get(path) as unknown[];
    if (Array.isArray(arr) && index >= 0 && index < arr.length) {
      const next = [...arr.slice(0, index), ...arr.slice(index + 1)];
      ctx.useSduiStore?.getState().setData(path, next);
    }
  };

export const shareHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const titleRaw = actionDef.title;
    const urlRaw = actionDef.url as unknown;
    const title =
      titleRaw != null && typeof titleRaw === 'object' && 'var' in titleRaw
        ? String(ctx.get(String((titleRaw as { var: string }).var), ctx.scope) ?? '')
        : String(titleRaw ?? '');
    const urlVal: unknown =
      urlRaw != null && typeof urlRaw === 'object' && 'var' in (urlRaw as object)
        ? ctx.get(String((urlRaw as { var: string }).var), ctx.scope)
        : urlRaw;
    // url must be a full URL (e.g. "https://example.com/product/my-slug") — no prefix fallback
    const url = typeof urlVal === 'string' ? urlVal : '';
    if (typeof navigator !== 'undefined' && navigator.share && title && url) {
      await navigator.share({ title, url }).catch(() => {});
    }
  };

export const setThemeHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const value = (actionDef.value ?? 'system') as 'light' | 'dark' | 'system';
    ctx.setColorScheme?.(value);
    ctx.setData(THEME_PATH, value);
  };

export const setStateHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const payload = ctx.payload ?? actionDef;
    if (typeof payload !== 'object' || !payload || !('path' in payload)) return;
    const p = payload as { path: string; value?: unknown; merge?: boolean };
    let value = p.value;
    if (value === '$event' && ctx.event !== undefined) {
      const ev = ctx.event as { target?: { value?: unknown }; nativeEvent?: { text?: unknown } };
      value =
        typeof ctx.event === 'string' ? ctx.event : ev?.target?.value ?? ev?.nativeEvent?.text ?? ctx.event;
    } else if (value != null && typeof value === 'object' && 'var' in value) {
      const v = (value as { var: string | [string, unknown] }).var;
      const varPath = Array.isArray(v) ? v[0] : v;
      value = ctx.get(String(varPath), ctx.scope) ?? (Array.isArray(v) ? v[1] : undefined);
    } else if (typeof value === 'string' && value.includes('{{') && ctx.getFullMergedState) {
      const fullState = ctx.getFullMergedState();
      const resolved = resolveValue(value, ctx.get, ctx.scope, fullState);
      if (resolved !== value) value = resolved;
    }
    ctx.store.getState().setState((prev) => {
      const finalValue = value ?? getNestedValue(prev, p.path);
      return setNestedValue(prev, p.path, finalValue, p.merge);
    });
  };

export const showToastHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const payload = ctx.payload ?? actionDef;
    const pl = (typeof payload === 'object' && payload ? payload : {}) as { message?: string; type?: 'success' | 'error' | 'info' };
    const msg = String(pl.message ?? 'Done');
    if (pl.type === 'error') toast.error(msg);
    else if (pl.type === 'info') toast.info(msg);
    else toast.success(msg);
  };

export const logHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async () => {
    console.log('[SDUI]', ctx.payload);
  };

export const cycleIndexHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const arrayPath = (actionDef.arrayPath ?? '') as string;
    const direction = (actionDef.direction ?? 'next') as string;
    const arr = (ctx.get(arrayPath) as unknown[]) ?? [];
    const len = arr.length;
    const current = Number(ctx.get(path)) || 0;
    const next = direction === 'prev' ? (current - 1 + len) % len : (current + 1) % len;
    if (path) {
      ctx.store.getState().setState((prev) => setNestedValue(prev, path, next));
      if (!path.startsWith('screens.')) {
        ctx.useSduiStore?.getState().setData(path, next);
      }
    }
  };

export const mergeAtPathHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const keyRaw = actionDef.key;
    const valueRaw = actionDef.value;
    const fullState = ctx.getFullMergedState();
    const stateWithScope = ctx.scope ? { ...fullState, ...ctx.scope } : fullState;
    const key = resolveValue(keyRaw, ctx.get, ctx.scope, stateWithScope) as string;
    const value = resolveValue(valueRaw, ctx.get, ctx.scope, stateWithScope);
    if (path && key != null) {
      const current = ctx.get(path) as Record<string, unknown> | undefined;
      const next = { ...(current ?? {}), [key]: value };
      ctx.store.getState().setState((prev) => setNestedValue(prev, path, next));
    }
  };
