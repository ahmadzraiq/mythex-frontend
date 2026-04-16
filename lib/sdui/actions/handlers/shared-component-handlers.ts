/**
 * Shared Component action handlers.
 *
 * addSharedComponentHandler       — dynamically adds a shared component instance.
 *   When waitClose=true it returns a Promise that resolves when the instance
 *   is deleted; the resolved value is available as context.workflow[stepId].result.
 *
 * deleteSharedComponentHandler    — deletes the current shared component instance.
 *   If waitClose was used, resolves the promise with an optional returnValue.
 *
 * deleteAllSharedComponentsHandler — deletes all dynamic instances, optionally
 *   filtered by componentId.
 */

import type { ActionHandlerContext, ActionDef } from './types';
import { useSharedComponentInstanceStore } from '../../shared-component-instance-store';
import { evaluateFormula } from '../../formula-evaluator';
import sharedComponentsJson from '../../../../config/shared-components.json';
import { getSharedComponents as getLiveSharedComponents } from '@/lib/builder/shared-component-data';

interface SharedComponentModelLike {
  id: string;
  name: string;
  properties: Array<{ id: string; name: string; type: string; defaultValue?: unknown }>;
  content: Record<string, unknown>;
}

const staticModels = sharedComponentsJson as Record<string, SharedComponentModelLike>;

function getModels(): Record<string, SharedComponentModelLike> {
  try {
    const live = getLiveSharedComponents() as Record<string, SharedComponentModelLike>;
    if (live && Object.keys(live).length > 0) {
      const merged: Record<string, SharedComponentModelLike> = { ...staticModels };
      for (const [id, liveModel] of Object.entries(live)) {
        const liveContent = liveModel.content as { children?: unknown[] } | undefined;
        const hasValidContent = liveContent && Array.isArray(liveContent.children) && liveContent.children.length > 0;
        if (hasValidContent) {
          merged[id] = liveModel;
        } else {
          const staticModel = staticModels[id];
          merged[id] = staticModel
            ? { ...liveModel, content: staticModel.content }
            : liveModel;
        }
      }
      return merged;
    }
  } catch { /* not available */ }
  return staticModels;
}

export const addSharedComponentHandler =
  (ctx: ActionHandlerContext) =>
  async (actionDef: ActionDef): Promise<unknown> => {
    const componentId = actionDef.componentId as string | undefined;
    const propsRaw = (actionDef.props ?? {}) as Record<string, unknown>;
    const waitClose = Boolean(actionDef.waitClose);

    if (!componentId) {
      console.warn('[addSharedComponent] No componentId specified');
      return;
    }

    const models = getModels();
    const model = models[componentId];
    if (!model) {
      console.warn('[addSharedComponent] Shared component model not found:', componentId);
      return;
    }

    const state = ctx.getFullMergedState();
    const resolvedProps: Record<string, unknown> = {};
    for (const [propKey, rawVal] of Object.entries(propsRaw)) {
      if (rawVal && typeof rawVal === 'object' && 'formula' in (rawVal as object)) {
        const formula = (rawVal as { formula: string }).formula;
        resolvedProps[propKey] = evaluateFormula(formula, state).value ?? '';
      } else {
        resolvedProps[propKey] = rawVal;
      }
    }

    for (const prop of model.properties) {
      if (!(prop.id in resolvedProps) && !(prop.name in resolvedProps)) {
        resolvedProps[prop.name] = prop.defaultValue ?? '';
      }
    }

    const store = useSharedComponentInstanceStore.getState();

    if (waitClose) {
      return new Promise<unknown>((resolve) => {
        store.addInstance(componentId, resolvedProps, true, resolve);
      });
    }

    store.addInstance(componentId, resolvedProps, false);
  };

export const deleteSharedComponentHandler =
  (ctx: ActionHandlerContext) =>
  async (actionDef: ActionDef): Promise<void> => {
    const returnValueRaw = actionDef.returnValue;
    let returnValue: unknown = returnValueRaw;

    if (returnValueRaw && typeof returnValueRaw === 'object' && 'formula' in (returnValueRaw as object)) {
      const formula = (returnValueRaw as { formula: string }).formula;
      const state = ctx.getFullMergedState();
      returnValue = evaluateFormula(formula, state).value ?? null;
    }

    // ctx.scope carries context.component.instanceId injected by SharedComponentDynamicRenderer.
    // ctx.get only searches mergedState (not the renderer scope), so we must read from ctx.scope first.
    const scopeCtx = (ctx.scope as { context?: { component?: { instanceId?: string } } } | undefined);
    const instanceId =
      scopeCtx?.context?.component?.instanceId ??
      (ctx.get('context.component.instanceId') as string | undefined);

    if (!instanceId) {
      console.warn('[deleteSharedComponent] No instanceId found in scope — closing all');
      useSharedComponentInstanceStore.getState().removeAll(returnValue);
      return;
    }
    useSharedComponentInstanceStore.getState().removeInstance(instanceId, returnValue);
  };

export const deleteAllSharedComponentsHandler =
  (_ctx: ActionHandlerContext) =>
  async (actionDef: ActionDef): Promise<void> => {
    const componentId = actionDef.componentId as string | undefined;
    const store = useSharedComponentInstanceStore.getState();

    if (componentId) {
      store.removeByComponentId(componentId);
    } else {
      store.removeAll();
    }
  };
