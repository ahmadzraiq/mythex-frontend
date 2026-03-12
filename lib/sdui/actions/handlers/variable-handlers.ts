/**
 * Handlers for increment, decrement, toggle, setVar
 */

import { setNestedValue } from '../../nested-utils';
import { resolveActionValue, resolvePayload } from '../resolve-value';
import { evaluateFormula } from '../../formula-evaluator';
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
    let value: unknown;
    if (rawValue != null && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      const obj = rawValue as Record<string, unknown>;
      if (typeof obj.formula === 'string') {
        // FormulaValue { formula: "..." } — evaluate with full state + normalized event
        const sduiData = ((ctx.useSduiStore?.getState() as Record<string, unknown> | undefined)?.data ?? {}) as Record<string, unknown>;
        const storeState = ctx.store?.getState?.() as { getFullState?: () => Record<string, unknown>; data?: Record<string, unknown> } | undefined;
        const vsData = (storeState?.getFullState?.() ?? storeState?.data ?? {}) as Record<string, unknown>;
        const evalCtx = {
          ...sduiData,
          ...vsData,
          ...(ctx.scope ?? {}),
          variables: vsData,
          collections: (sduiData?.collections ?? sduiData?.['collections'] ?? {}) as Record<string, unknown>,
          // Use the live global store's context (set by forEach's setState call) so
          // context.item.data.value resolves correctly inside loop bodies.
          // ctx.scope.context is captured at workflow invocation time and never updated.
          context: (ctx.scope?.context ?? (vsData['context'] as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>,
          event: (ctx.event as Record<string, unknown> | undefined) ?? {},
        };
        value = evaluateFormula(obj.formula, evalCtx).value ?? null;
      } else {
        value = resolvePayload(obj, ctx.get, ctx.scope);
      }
    } else {
      value = rawValue;
    }
    ctx.store.getState().setState((prev) => setNestedValue(prev, path, value));
    if (!path.startsWith('screens.')) {
      ctx.useSduiStore?.getState().setData(path, value);
    }
  };
