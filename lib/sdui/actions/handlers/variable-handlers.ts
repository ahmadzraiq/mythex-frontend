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
        const mergedState = ctx.getFullMergedState?.() ?? {};

        // If we're inside a shared-component workflow, rebuild context.component.variables
        // from the LIVE per-instance slot so sequential formulas see each other's writes.
        let ctxForFormula = (ctx.scope?.context ?? (vsData['context'] as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
        const compInfo = ctxForFormula.component as Record<string, unknown> | undefined;
        const liveInstanceId = compInfo?.instanceId as string | undefined;
        if (liveInstanceId) {
          const instances = (vsData['_componentInstances'] as Record<string, Record<string, unknown>> | undefined) ?? {};
          const liveVars = instances[liveInstanceId] ?? {};
          ctxForFormula = {
            ...ctxForFormula,
            component: { ...(compInfo ?? {}), variables: liveVars },
          };
        }

        const evalCtx = {
          ...mergedState,
          ...sduiData,
          ...vsData,
          ...(ctx.scope ?? {}),
          variables: vsData,
          collections: (sduiData?.collections ?? sduiData?.['collections'] ?? {}) as Record<string, unknown>,
          context: ctxForFormula,
          event: (ctx.event as Record<string, unknown> | undefined) ?? {},
        };
        if (typeof window !== 'undefined' && String(obj.formula ?? '').includes("parameters?.['")) {
          console.log('[setVarHandler] evaluating formula with parameters:', {
            path,
            formula: obj.formula,
            parameters: evalCtx.parameters,
            hasScope: !!ctx.scope,
            scopeKeys: Object.keys(ctx.scope ?? {}),
          });
        }
        value = evaluateFormula(obj.formula, evalCtx, ctx.get).value ?? null;
      } else {
        value = resolvePayload(obj, ctx.get, ctx.scope);
      }
    } else {
      value = rawValue;
    }
    // If the path is a UUID and we're inside a component workflow with a known instance,
    // redirect the write to the per-instance variable slot instead of the global store.
    const componentCtx = ctx.scope?.context as Record<string, unknown> | undefined;
    const instanceId = componentCtx?.component
      ? (componentCtx.component as Record<string, unknown>).instanceId as string | undefined
      : undefined;
    const modelId = componentCtx?.component
      ? (componentCtx.component as Record<string, unknown>).id as string | undefined
      : undefined;
    const scModel = modelId ? (() => {
      try { return require('@/lib/builder/shared-component-data').getSharedComponents()[modelId]; } catch { /* noop */ }
      try { return require('@/config/shared-components.json')[modelId]; } catch { /* noop */ }
      return undefined;
    })() : undefined;
    const isComponentVar = instanceId && scModel?.variables && path in scModel.variables;
    if (isComponentVar) {
      // Write to per-instance slot instead of global
      try {
        const { setComponentInstanceVar } = require('@/lib/sdui/global-variable-store') as typeof import('@/lib/sdui/global-variable-store');
        setComponentInstanceVar(instanceId, path, value);
      } catch { /* fallback to global */ }
      return;
    }
    ctx.store.getState().setState((prev) => setNestedValue(prev, path, value));
    if (!path.startsWith('screens.')) {
      ctx.useSduiStore?.getState().setData(path, value);
    }
  };
