/**
 * Handlers for increment, decrement, toggle, setVar
 */

import { setNestedValue } from '../../nested-utils';
import { resolveActionValue, resolvePayload } from '../resolve-value';
import type { ActionDef, ActionHandlerContext } from './types';

export const incrementHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const amountRaw = actionDef.amount;
    const amount = resolveActionValue(amountRaw, ctx.get, ctx.scope, 1);
    const current = ctx.get(path);
    const minVal = Number(actionDef.min ?? 0);
    const next = Math.max(minVal, (Number(current) || 0) + amount);
    ctx.store.getState().setState((prev) => setNestedValue(prev, path, next));
    if (!path.startsWith('screens.')) {
      ctx.useSduiStore?.getState().setData(path, next);
    }
  };

export const decrementHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const amountRaw = actionDef.amount;
    const amount = resolveActionValue(amountRaw, ctx.get, ctx.scope, 1);
    const current = ctx.get(path);
    const minVal = Number(actionDef.min ?? 0);
    const next = Math.max(minVal, (Number(current) || 0) - amount);
    ctx.store.getState().setState((prev) => setNestedValue(prev, path, next));
    if (!path.startsWith('screens.')) {
      ctx.useSduiStore?.getState().setData(path, next);
    }
  };

export const toggleHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const current = ctx.get(path);
    ctx.store.getState().setState((prev) => setNestedValue(prev, path, !current));
  };

export const setVarHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const rawValue = actionDef.value;
    const value =
      rawValue != null && typeof rawValue === 'object' && !Array.isArray(rawValue)
        ? resolvePayload(rawValue as Record<string, unknown>, ctx.get, ctx.scope)
        : rawValue;
    ctx.store.getState().setState((prev) => setNestedValue(prev, path, value));
    if (!path.startsWith('screens.')) {
      ctx.useSduiStore?.getState().setData(path, value);
    }
  };
