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
      if (typeof obj.formula === 'string' || typeof obj.js === 'string') {
        // FormulaValue { formula: "..." } — evaluate with full state + normalized event
        const sduiData = ((ctx.useSduiStore?.getState() as Record<string, unknown> | undefined)?.data ?? {}) as Record<string, unknown>;
        const storeState = ctx.store?.getState?.() as { getFullState?: () => Record<string, unknown>; data?: Record<string, unknown> } | undefined;
        const vsData = (storeState?.getFullState?.() ?? storeState?.data ?? {}) as Record<string, unknown>;
        const mergedState = ctx.getFullMergedState?.() ?? {};

        // Build context by merging the variable-store's context (which carries
        // context.workflow[stepId].result after flushWorkflowCtx) with the action
        // scope's context (which carries context.item.data.* from repeat clicks).
        // Must be a MERGE, not ??, so that workflow results are never shadowed when
        // the triggering element is inside a map/repeat (where ctx.scope.context is set).
        const stateCtx = (vsData['context'] as Record<string, unknown> | undefined) ?? {};
        const scopeCtxData = (ctx.scope?.context as Record<string, unknown> | undefined) ?? {};
        let ctxForFormula = { ...stateCtx, ...scopeCtxData };
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

        const evalCtx: Record<string, unknown> = {
          ...mergedState,
          ...sduiData,
          ...vsData,
          ...(ctx.scope ?? {}),
          variables: vsData,
          collections: (sduiData?.collections ?? sduiData?.['collections'] ?? {}) as Record<string, unknown>,
          context: ctxForFormula,
          event: (ctx.event as Record<string, unknown> | undefined) ?? {},
        };
        // Pass the wrapper object so evaluateFormula auto-routes between
        // { formula } and { js } bindings.
        value = evaluateFormula(obj as object, evalCtx, ctx.get).value ?? null;
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
      try {
        const m = require('@/lib/builder/shared-component-data').getSharedComponents()[modelId];
        if (m) return m;
      } catch { /* noop */ }
      try {
        const m = require('@/config/shared-components.json')[modelId];
        if (m) return m;
      } catch { /* noop */ }
      return undefined;
    })() : undefined;
    const isComponentVar = instanceId && scModel?.variables && path in scModel.variables;
    if (isComponentVar) {
      try {
        const { setComponentInstanceVar } = require('@/lib/sdui/global-variable-store') as typeof import('@/lib/sdui/global-variable-store');
        setComponentInstanceVar(instanceId, path, value);
      } catch { /* fallback to global */ }
      return;
    }
    // ── Deduplication: skip Zustand write when value hasn't changed ────────────
    // onDragUpdate fires at ~60fps. Without this check every pointer-move would
    // call setState, batching React re-renders for all subscribed components even
    // when targetIndex/targetCol hasn't crossed a slot boundary.
    if (typeof value === 'object' && value !== null) {
      try {
        const prevValue = ctx.get(path);
        if (typeof prevValue === 'object' && prevValue !== null &&
            JSON.stringify(prevValue) === JSON.stringify(value)) {
          return; // identical — skip setState, no re-render
        }
      } catch { /* ignore serialization errors */ }
    }

    // ── Dev logs ───────────────────────────────────────────────────────────────
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
      if (path === 'showcase-kanban-drag') {
        const v = value as Record<string, unknown>;
        console.log('[kanban-drag] col:', v?.targetCol, '| idx:', v?.targetIndex, '| card:', v?.cardId);
      } else if (path === 'showcase-kanban-cards') {
        console.log('[kanban-cards] updated, count:', Array.isArray(value) ? value.length : '?');
      }
    }

    ctx.store.getState().setState((prev) => setNestedValue(prev, path, value));
    if (!path.startsWith('screens.')) {
      ctx.useSduiStore?.getState().setData(path, value);
    }
  };
