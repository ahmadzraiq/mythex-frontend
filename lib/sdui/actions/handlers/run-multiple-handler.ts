/**
 * Handler for type: "runMultiple" - run multiple actions, optionally with conditions
 */

import jsonLogic from 'json-logic-js';
import type { ActionDef, ActionHandlerContext } from './types';

export const runMultipleHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const actions = actionDef.actions as Array<{ condition?: object; action?: string; [k: string]: unknown }> | undefined;
    if (!Array.isArray(actions)) return;

    for (const a of actions) {
      const actionItem = a;
      if (actionItem.condition != null) {
        const condResult = jsonLogic.apply(actionItem.condition as object, ctx.getFullMergedState() ?? {});
        if (!condResult) continue;
      }
      await ctx.runOne(a as import('../../types').SDUIAction);
    }
  };
