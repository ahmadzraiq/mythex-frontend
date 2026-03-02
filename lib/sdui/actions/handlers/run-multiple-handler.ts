/**
 * Handler for type: "runMultiple" - run multiple actions, optionally with conditions
 */

import { evaluateFormula } from '../../formula-evaluator';
import type { ActionDef, ActionHandlerContext } from './types';

export const runMultipleHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const actions = actionDef.actions as Array<{ condition?: string | object; action?: string; [k: string]: unknown }> | undefined;
    if (!Array.isArray(actions)) return;

    for (const a of actions) {
      const actionItem = a;
      if (actionItem.condition != null) {
        const evalResult = evaluateFormula(
          actionItem.condition as string | object,
          ctx.getFullMergedState() ?? {}
        );
        if (!evalResult.value) continue;
      }
      await ctx.runOne(a as import('../../types').SDUIAction);
    }
  };
