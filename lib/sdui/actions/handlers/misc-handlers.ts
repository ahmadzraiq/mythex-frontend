/**
 * Handlers for restore, clearPersistedPaths, goToPage, removeAt, share, setTheme, setState, showToast, log, cycleIndex, mergeAtPath
 */

import { toast } from 'sonner';
import { getNestedValue, setNestedValue } from '../../nested-utils';
import { resolveActionValue, resolveValue } from '../resolve-value';
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
    const CONVENTIONS = ctx.CONVENTIONS as { persistPaths?: string[] };
    const pathsRaw = actionDef.paths as string[] | undefined;
    const paths = Array.isArray(pathsRaw) && pathsRaw.length > 0 ? pathsRaw : (CONVENTIONS.persistPaths ?? []);
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
    const CONVENTIONS = ctx.CONVENTIONS as { defaultPaginationPath?: string; defaultPaginationFetchAction?: string };
    const path = (actionDef.path ?? CONVENTIONS.defaultPaginationPath ?? 'collectionSkip') as string;
    const page = resolveActionValue(actionDef.page, ctx.get, ctx.scope, 1);
    const pageSize = resolveActionValue(actionDef.pageSize, ctx.get, ctx.scope, 12);
    const fetchAction = (actionDef.fetchAction ?? CONVENTIONS.defaultPaginationFetchAction ?? 'fetchCollection') as string;
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
    const CONVENTIONS = ctx.CONVENTIONS as { shareSlugPrefix?: string };
    const titleRaw = actionDef.title;
    const urlRaw = actionDef.url;
    const title =
      titleRaw != null && typeof titleRaw === 'object' && 'var' in titleRaw
        ? String(ctx.get(String((titleRaw as { var: string }).var), ctx.scope) ?? '')
        : String(titleRaw ?? '');
    const urlVal =
      urlRaw != null && typeof urlRaw === 'object' && 'var' in urlRaw
        ? ctx.get(String((urlRaw as { var: string }).var), ctx.scope)
        : urlRaw;
    const pathOrSlug = typeof urlVal === 'string' ? urlVal : (urlVal as { slug?: string })?.slug ?? '';
    const prefix = CONVENTIONS.shareSlugPrefix ?? '/product';
    const url =
      typeof window !== 'undefined'
        ? pathOrSlug.startsWith('/')
          ? `${window.location.origin}${pathOrSlug}`
          : `${window.location.origin}${prefix}${pathOrSlug.startsWith('/') ? '' : '/'}${pathOrSlug}`
        : '';
    if (typeof navigator !== 'undefined' && navigator.share && title && url) {
      await navigator.share({ title, url }).catch(() => {});
    }
  };

export const setThemeHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const CONVENTIONS = ctx.CONVENTIONS as { themePath?: string };
    const value = (actionDef.value ?? 'system') as 'light' | 'dark' | 'system';
    ctx.setColorScheme?.(value);
    ctx.setData(CONVENTIONS.themePath ?? 'nav.colorScheme', value);
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
    const key = resolveValue(keyRaw, ctx.get, ctx.scope) as string;
    const value = resolveValue(valueRaw, ctx.get, ctx.scope);
    if (path && key != null) {
      const current = ctx.get(path) as Record<string, unknown> | undefined;
      const next = { ...(current ?? {}), [key]: value };
      ctx.store.getState().setState((prev) => setNestedValue(prev, path, next));
    }
  };
