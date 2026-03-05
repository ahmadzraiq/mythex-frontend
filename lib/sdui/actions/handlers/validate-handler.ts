/**
 * Handler for type: "validate" - form validation before mutation
 *
 * Supports two modes:
 * 1. Inline rules: { rules: { "form.field": { required: true, ... } }, storeErrorsIn: "errors" }
 * 2. FormId mode: { formId: "UUID" } — reads rules from config/variables.json and writes
 *    errors to variables[formId].errors
 */

import { setNestedValue } from '../../nested-utils';
import { isScreenScopedPath } from '../../path-utils';
import type { ActionDef, ActionHandlerContext } from './types';
import type { ValidationRule } from '../../engine-types';
import variablesJson from '@/config/variables.json';

type FieldDef = {
  name: string;
  type?: string;
  initialValue?: unknown;
  validation?: ValidationRule & { equalsField?: string };
};

const varsConfig = variablesJson as { variables: Record<string, { type?: string; fields?: FieldDef[] }> };

/** Build validate rules from a form variable's field definitions */
function rulesFromFormId(formId: string): Record<string, ValidationRule & { equalsField?: string }> {
  const def = varsConfig.variables[formId];
  if (!def || def.type !== 'form') return {};
  const rules: Record<string, ValidationRule & { equalsField?: string }> = {};
  for (const field of def.fields ?? []) {
    if (field.validation) {
      rules[`${formId}.value.${field.name}`] = field.validation;
    }
  }
  return rules;
}

export const validateHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const CONVENTIONS = ctx.CONVENTIONS as {
      defaultStoreErrorsIn?: string;
      screenScopedAliases?: string[];
      workflowPath?: string;
    };

    const formId = (actionDef.formId ?? '') as string;
    const useFormId = !!formId;

    // Determine rules and where to store errors
    let rules: Record<string, ValidationRule & { equalsField?: string }>;
    let errorsPath: string;

    if (useFormId) {
      rules = rulesFromFormId(formId);
      errorsPath = `${formId}.errors`;
    } else {
      rules = (actionDef.rules ?? {}) as Record<string, ValidationRule & { equalsField?: string }>;
      const storeErrorsIn = (actionDef.storeErrorsIn ?? CONVENTIONS.defaultStoreErrorsIn ?? 'errors') as string;
      errorsPath =
        ctx.configName && isScreenScopedPath(storeErrorsIn, CONVENTIONS.screenScopedAliases ?? [])
          ? `screens.${ctx.configName}.${storeErrorsIn}`
          : storeErrorsIn;
    }

    let errors: Record<string, unknown> = {};
    let firstMsg: string | undefined;

    for (const [fieldPath, rule] of Object.entries(rules)) {
      if (!rule) continue;

      // For formId mode, we need to get the value from the form variable
      let actualPath = fieldPath;
      if (useFormId) {
        // fieldPath is like "formId.value.fieldName" — resolve from variable store
        actualPath = fieldPath;
      } else {
        // For screen-scoped aliases, resolve the path
        if (ctx.configName && isScreenScopedPath(fieldPath, CONVENTIONS.screenScopedAliases ?? [])) {
          actualPath = `screens.${ctx.configName}.${fieldPath}`;
        }
      }

      const value = ctx.get(actualPath);
      const str = String(value ?? '').trim();
      const msg = rule.message ?? 'Invalid';

      // Determine error key (last segment for nested form paths, full path for inline)
      const errorKey = useFormId ? fieldPath.split('.').pop()! : fieldPath;

      if (rule.required && !str) {
        errors = setNestedValue(errors, errorKey, msg) as Record<string, unknown>;
        if (!firstMsg) firstMsg = msg;
        continue;
      }
      if (!str && !rule.required) continue;
      if (rule.minLength != null && str.length < rule.minLength) {
        errors = setNestedValue(errors, errorKey, msg) as Record<string, unknown>;
        if (!firstMsg) firstMsg = msg;
        continue;
      }
      if (rule.maxLength != null && str.length > rule.maxLength) {
        errors = setNestedValue(errors, errorKey, msg) as Record<string, unknown>;
        if (!firstMsg) firstMsg = msg;
        continue;
      }
      if (rule.pattern === 'email') {
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(str)) {
          errors = setNestedValue(errors, errorKey, msg) as Record<string, unknown>;
          if (!firstMsg) firstMsg = msg;
        }
        continue;
      }
      if (rule.equals != null && str !== String(rule.equals)) {
        errors = setNestedValue(errors, errorKey, msg) as Record<string, unknown>;
        if (!firstMsg) firstMsg = msg;
      }
      if (rule.equalsField != null) {
        let compareField = rule.equalsField;
        if (useFormId) {
          // equalsField is like "form.password" — map to formId.value.password
          compareField = `${formId}.value.${compareField.replace(/^form\./, '')}`;
        } else if (ctx.configName && isScreenScopedPath(compareField, CONVENTIONS.screenScopedAliases ?? [])) {
          compareField = `screens.${ctx.configName}.${compareField}`;
        }
        const otherVal = ctx.get(compareField);
        if (str !== String(otherVal ?? '')) {
          errors = setNestedValue(errors, errorKey, msg) as Record<string, unknown>;
          if (!firstMsg) firstMsg = msg;
        }
      }
    }

    if (useFormId) {
      // For formId mode, write errors to the form variable's errors object
      ctx.store.getState().setState((prev) => {
        const current = (prev[formId] ?? {}) as Record<string, unknown>;
        return setNestedValue(prev, formId, { ...current, errors });
      });
    } else {
      ctx.store.getState().setState((prev) => setNestedValue(prev, errorsPath, errors));
    }

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
