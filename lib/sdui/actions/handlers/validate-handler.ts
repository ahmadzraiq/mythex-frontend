/**
 * Handler for type: "validate" - form validation before mutation
 *
 * Supports two modes:
 * 1. FormContainer mode (default): reads field values from local.data.form.formData.*
 *    and writes field-level isValid to local.data.form.fields.*
 * 2. Inline rules mode: { rules: { "path": { required: true, ... } }, storeErrorsIn: "errors" }
 *    — legacy; writes errors to a named store path (e.g. screens.signIn.errors)
 */

import { setNestedValue } from '../../nested-utils';
import { isScreenScopedPath } from '../../path-utils';
import type { ActionDef, ActionHandlerContext } from './types';
import type { ValidationRule } from '../../engine-types';
import { getGlobalVariableStore } from '../../global-variable-store';

export const validateHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const CONVENTIONS = ctx.CONVENTIONS as {
      defaultStoreErrorsIn?: string;
      screenScopedAliases?: string[];
      workflowPath?: string;
    };

    const useFormContainer = !actionDef.rules && !actionDef.storeErrorsIn;

    let errors: Record<string, unknown> = {};
    let firstMsg: string | undefined;

    if (useFormContainer) {
      // FormContainer mode: validate local.data.form.formData fields using
      // per-field validation rules defined in actionDef.fields or inline props
      const vs = getGlobalVariableStore().getState().getFullState();
      const local = (vs['local'] ?? {}) as Record<string, unknown>;
      const data = (local['data'] ?? {}) as Record<string, unknown>;
      const form = (data['form'] ?? {}) as {
        formData?: Record<string, unknown>;
        fields?: Record<string, { value: unknown; isValid: boolean }>;
      };
      const formData = form.formData ?? {};

      const fieldRules = (actionDef.fields ?? {}) as Record<
        string,
        ValidationRule & { equalsField?: string }
      >;

      // isValid is stored as '' (valid/pristine) or an error message string (invalid)
      const newFields: Record<string, { value: unknown; isValid: unknown }> = { ...(form.fields ?? {}) };

      for (const [fieldName, rule] of Object.entries(fieldRules)) {
        if (!rule) continue;
        const value = formData[fieldName];
        const str = String(value ?? '').trim();
        const msg = rule.message ?? 'Invalid';
        let fieldValid = true;

        if (rule.required && !str) { fieldValid = false; if (!firstMsg) firstMsg = msg; }
        if (fieldValid && str && rule.minLength != null && str.length < rule.minLength) {
          fieldValid = false; if (!firstMsg) firstMsg = msg;
        }
        if (fieldValid && str && rule.maxLength != null && str.length > rule.maxLength) {
          fieldValid = false; if (!firstMsg) firstMsg = msg;
        }
        if (fieldValid && str && rule.pattern === 'email') {
          const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRe.test(str)) { fieldValid = false; if (!firstMsg) firstMsg = msg; }
        }
        if (fieldValid && rule.equals != null && str !== String(rule.equals)) {
          fieldValid = false; if (!firstMsg) firstMsg = msg;
        }
        if (fieldValid && rule.equalsField != null) {
          const otherVal = formData[rule.equalsField];
          if (str !== String(otherVal ?? '')) { fieldValid = false; if (!firstMsg) firstMsg = msg; }
        }

        // Store '' for valid, error message string for invalid — matches {{local.data.form.fields.X.isValid}} pattern
        newFields[fieldName] = { value, isValid: fieldValid ? '' : msg };
        if (!fieldValid) errors[fieldName] = msg;
      }

      // A field is considered valid if isValid is '' (pristine/valid) or boolean true
      const allValid = Object.values(newFields).every((f) => !f.isValid || f.isValid === true);
      const nextForm = { ...form, fields: newFields, isValid: allValid };
      const writeLocal = (prev: Record<string, unknown>) => ({
        ...prev,
        local: {
          ...(prev['local'] as object ?? {}),
          data: {
            ...(data as object),
            form: nextForm,
          },
        },
      });
      getGlobalVariableStore().getState().setState(writeLocal);
      ctx.store.getState().setState(writeLocal);

    } else {
      // Legacy inline rules mode
      const rules = (actionDef.rules ?? {}) as Record<string, ValidationRule & { equalsField?: string }>;
      const storeErrorsIn = (actionDef.storeErrorsIn ?? CONVENTIONS.defaultStoreErrorsIn ?? 'errors') as string;
      const errorsPath =
        ctx.configName && isScreenScopedPath(storeErrorsIn, CONVENTIONS.screenScopedAliases ?? [])
          ? `screens.${ctx.configName}.${storeErrorsIn}`
          : storeErrorsIn;

      for (const [fieldPath, rule] of Object.entries(rules)) {
        if (!rule) continue;
        let actualPath = fieldPath;
        if (ctx.configName && isScreenScopedPath(fieldPath, CONVENTIONS.screenScopedAliases ?? [])) {
          actualPath = `screens.${ctx.configName}.${fieldPath}`;
        }
        const value = ctx.get(actualPath);
        const str = String(value ?? '').trim();
        const msg = rule.message ?? 'Invalid';

        if (rule.required && !str) {
          errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
          if (!firstMsg) firstMsg = msg; continue;
        }
        if (!str && !rule.required) continue;
        if (rule.minLength != null && str.length < rule.minLength) {
          errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
          if (!firstMsg) firstMsg = msg; continue;
        }
        if (rule.maxLength != null && str.length > rule.maxLength) {
          errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
          if (!firstMsg) firstMsg = msg; continue;
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
          let compareField = rule.equalsField;
          if (ctx.configName && isScreenScopedPath(compareField, CONVENTIONS.screenScopedAliases ?? [])) {
            compareField = `screens.${ctx.configName}.${compareField}`;
          }
          const otherVal = ctx.get(compareField);
          if (str !== String(otherVal ?? '')) {
            errors = setNestedValue(errors, fieldPath, msg) as Record<string, unknown>;
            if (!firstMsg) firstMsg = msg;
          }
        }
      }

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
