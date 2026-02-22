/**
 * Handlers for append and appendToPath
 */

import { getNestedValue, setNestedValue } from '../../nested-utils';
import { resolvePayload, resolveValue } from '../resolve-value';
import type { ActionDef, ActionHandlerContext } from './types';

export const appendHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const path = (actionDef.path ?? '') as string;
    const rawValue =
      actionDef.value ??
      (ctx.payload && typeof ctx.payload === 'object' ? (ctx.payload as Record<string, unknown>).value : undefined);
    const value =
      rawValue != null && typeof rawValue === 'object' && !Array.isArray(rawValue)
        ? resolvePayload(rawValue as Record<string, unknown>, ctx.get, ctx.scope)
        : rawValue;
    if (path) ctx.append(path, value);
  };

export const appendToPathHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const targetPath = ((actionDef.targetPath ?? actionDef.path) ?? '') as string;
    const rawValue = actionDef.value;
    const fullState = ctx.getFullMergedState();
    const resolvedValue =
      rawValue != null && typeof rawValue === 'object'
        ? resolveValue(rawValue, ctx.get, ctx.scope, fullState)
        : rawValue;

    if (targetPath) {
      const parts = targetPath.split('.');
      const parentPath = parts.slice(0, -1).join('.');
      const parent = parentPath ? (ctx.get(parentPath) as Record<string, unknown>) : undefined;
      const key = parts[parts.length - 1];
      const currentArr = (parent ? getNestedValue(parent, key!) : ctx.get(targetPath)) as unknown[] | undefined;
      const arr = Array.isArray(currentArr) ? [...currentArr, resolvedValue] : [resolvedValue];
      if (parentPath) {
        const updated = { ...parent, [key!]: arr };
        ctx.setData(parentPath, updated);
      } else {
        ctx.setData(targetPath, arr);
      }
    }

    const resetFormPath = actionDef.resetFormPath as string | undefined;
    const resetFormValue = (actionDef.resetFormValue ?? {}) as Record<string, unknown>;
    if (resetFormPath) {
      const pathToReset =
        ctx.configName && !resetFormPath.startsWith('screens.') ? `screens.${ctx.configName}.${resetFormPath}` : resetFormPath;
      ctx.store.getState().setState((prev) => setNestedValue(prev, pathToReset, resetFormValue));
    }

    const onSuccess = actionDef.onSuccess;
    if (onSuccess) {
      const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
      for (const a of actions) {
        await ctx.runOne(a as import('../../types').SDUIAction);
      }
    }
  };
