/**
 * Handler for type: "validate" - form validation before mutation
 */

import { setNestedValue } from '../../nested-utils';
import { isScreenScopedPath } from '../../path-utils';
import type { ActionDef, ActionHandlerContext } from './types';
import type { ValidationRule } from '../../engine-types';

export const validateHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const CONVENTIONS = ctx.CONVENTIONS as {
      defaultStoreErrorsIn?: string;
      screenScopedAliases?: string[];
      workflowPath?: string;
    };
    const rules = (actionDef.rules ?? {}) as Record<string, ValidationRule>;
    const storeErrorsIn = (actionDef.storeErrorsIn ?? CONVENTIONS.defaultStoreErrorsIn ?? 'errors') as string;
    const errorsPath =
      ctx.configName && isScreenScopedPath(storeErrorsIn, CONVENTIONS.screenScopedAliases ?? [])
        ? `screens.${ctx.configName}.${storeErrorsIn}`
        : storeErrorsIn;

    let errors: Record<string, unknown> = {};
    let firstMsg: string | undefined;

    for (const [fieldPath, rule] of Object.entries(rules)) {
      if (!rule) continue;
      const value = ctx.get(fieldPath);
      const str = String(value ?? '').trim();
      const msg = rule.message ?? 'Invalid';

      if (rule.required && !str) {
        errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
        if (!firstMsg) firstMsg = msg;
        continue;
      }
      if (!str && !rule.required) continue;
      if (rule.minLength != null && str.length < rule.minLength) {
        errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
        if (!firstMsg) firstMsg = msg;
        continue;
      }
      if (rule.maxLength != null && str.length > rule.maxLength) {
        errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
        if (!firstMsg) firstMsg = msg;
        continue;
      }
      if (rule.pattern === 'email') {
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(str)) {
          errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
          if (!firstMsg) firstMsg = msg;
        }
        continue;
      }
      if (rule.equals != null && str !== String(rule.equals)) {
        errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
        if (!firstMsg) firstMsg = msg;
      }
      if (rule.equalsField != null) {
        const otherVal = ctx.get(rule.equalsField);
        if (str !== String(otherVal ?? '')) {
          errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
          if (!firstMsg) firstMsg = msg;
        }
      }
    }

    ctx.store.getState().setState((prev) => setNestedValue(prev, errorsPath, errors));

    if (firstMsg) {
      ctx.store.getState().setState((prev) =>
        setNestedValue(prev, CONVENTIONS.workflowPath ?? '_workflow', {
          lastAction: ctx.actionName,
          lastError: firstMsg,
        })
      );
      const err = new Error(firstMsg) as Error & { __validationError?: boolean };
      err.__validationError = true;
      throw err;
    }

    const onSuccess = actionDef.onSuccess;
    if (onSuccess) {
      const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
      for (const a of actions) {
        await ctx.runOne(a as import('../../types').SDUIAction);
      }
    }
  };
