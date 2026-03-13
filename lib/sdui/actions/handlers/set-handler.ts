/**
 * Handler for type: "set" - set path to value in Zustand and variable store
 */

import { setNestedValue } from '../../nested-utils';
import { resolveValue } from '../resolve-value';
import { PERSIST_PATHS } from '../../variable-config';
import type { ActionDef, ActionHandlerContext } from './types';

export const setHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const rawValue = actionDef.value;
    const fullState = ctx.getFullMergedState();
    const shouldResolve =
      rawValue != null &&
      ((typeof rawValue === 'object' && !Array.isArray(rawValue)) ||
        (typeof rawValue === 'string' && rawValue.includes('{{')));
    const value = shouldResolve
      ? resolveValue(rawValue, ctx.get, ctx.scope, fullState)
      : rawValue;

    if (path) {
      ctx.setData(path, value);
      if (!path.startsWith('screens.')) {
        ctx.store.getState().setState((prev) => setNestedValue(prev, path, value));
      }
      if (PERSIST_PATHS.includes(path) && typeof value === 'string' && value) {
        try {
          if (typeof window !== 'undefined') window.sessionStorage.setItem(path, value);
        } catch (_) {}
      }
    }

    const onSuccess = actionDef.onSuccess;
    if (onSuccess) {
      const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
      for (const a of actions) {
        await ctx.runOne(a as import('../../types').SDUIAction);
      }
    }
  };
