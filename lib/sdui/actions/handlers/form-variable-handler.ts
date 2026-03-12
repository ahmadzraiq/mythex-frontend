/**
 * Handlers for form actions: setFormState, resetForm, submitForm
 *
 * weWeb-style: form state lives at local.data.form.* in the global variable store.
 * Field values are tracked automatically by the form-field-tracker (lib/sdui/form-field-tracker.ts)
 * for any named field node inside a FormContainer. Use setVar to pre-populate field values programmatically.
 *
 * local.data.form = {
 *   formData:     { fieldName: value, ... }
 *   fields:       { fieldName: { value, isValid }, ... }
 *   isSubmitting: boolean
 *   isSubmitted:  boolean
 *   isValid:      boolean
 * }
 */

import type { ActionDef, ActionHandlerContext } from './types';
import { getGlobalVariableStore } from '../../global-variable-store';
import { evaluateFormula, storedValueToFormula, type FormulaValue } from '../../formula-evaluator';
import { applyFieldRules } from '../../validation-utils';
import type { FieldValidationRule } from '../../form-context';

const LOCAL_PATH = 'local';

function getFormState(vs: Record<string, unknown>) {
  const local = (vs[LOCAL_PATH] ?? {}) as Record<string, unknown>;
  const data = (local['data'] ?? {}) as Record<string, unknown>;
  return (data['form'] ?? {
    formData: {},
    fields: {},
    isSubmitting: false,
    isSubmitted: false,
    isValid: false,
  }) as {
    formData: Record<string, unknown>;
    fields: Record<string, { value: unknown; isValid: boolean }>;
    isSubmitting: boolean;
    isSubmitted: boolean;
    isValid: boolean;
  };
}

function writeFormState(
  prev: Record<string, unknown>,
  form: Record<string, unknown>
): Record<string, unknown> {
  const local = (prev[LOCAL_PATH] ?? {}) as Record<string, unknown>;
  const data = (local['data'] ?? {}) as Record<string, unknown>;
  return {
    ...prev,
    [LOCAL_PATH]: {
      ...local,
      data: {
        ...data,
        form,
      },
    },
  };
}

/** setFormState — sets isSubmitting / isSubmitted on the current form */
export const setFormStateHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const vs = getGlobalVariableStore().getState().getFullState();
    const current = getFormState(vs);

    const patch: Record<string, unknown> = {};
    if (actionDef.isSubmitting !== undefined) patch['isSubmitting'] = Boolean(actionDef.isSubmitting);
    if (actionDef.isSubmitted !== undefined) patch['isSubmitted'] = Boolean(actionDef.isSubmitted);

    const nextForm = { ...current, ...patch };
    getGlobalVariableStore().getState().setState((prev) => writeFormState(prev, nextForm));
    ctx.store.getState().setState((prev) => writeFormState(prev, nextForm));
  };

/** resetForm — clears all form fields back to empty */
export const resetFormHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (_ctx) => async (_actionDef) => {
    const emptyForm = {
      formData: {},
      fields: {},
      isSubmitting: false,
      isSubmitted: false,
      isValid: false,
    };
    getGlobalVariableStore().getState().setState((prev) => writeFormState(prev, emptyForm));
    _ctx.store.getState().setState((prev) => writeFormState(prev, emptyForm));
  };

/** submitForm — superseded by FormContainer.doSubmit; kept as no-op for backward compat with
 * any JSON that still references "type": "submitForm" directly in a workflowSteps step. */
export const submitFormHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    await setFormStateHandler(ctx)({ type: 'setFormState', isSubmitting: true });
    try {
      // ── Per-field validation (fieldValidations on the submit action) ──────────
      type FieldDef = {
        required?: boolean;
        requiredMessage?: string;
        formula?: unknown;
        message?: string;
        validationRules?: FieldValidationRule[];
      };
      const fieldValidations = actionDef.fieldValidations as Record<string, FieldDef> | undefined;

      if (fieldValidations && Object.keys(fieldValidations).length > 0) {
        const vs = getGlobalVariableStore().getState().getFullState();
        const current = getFormState(vs);
        const newFields = { ...current.fields } as Record<string, { value: unknown; isValid: unknown }>;
        let hasErrors = false;

        const formulaCtx = {
          ...vs,
          local: {
            ...((vs['local'] as Record<string, unknown>) ?? {}),
            data: { form: { ...current } },
          },
        } as Record<string, unknown>;

        for (const [fieldName, def] of Object.entries(fieldValidations)) {
          if (!def) continue;
          const value = current.formData[fieldName] ?? '';
          let fieldIsValid = '';

          if (def.validationRules && def.validationRules.length > 0) {
            // New rules-array path
            fieldIsValid = applyFieldRules(def.validationRules, value, formulaCtx);
          } else {
            // Legacy path: required + formula
            const str = String(value).trim();
            if (def.required && !str) {
              fieldIsValid = def.requiredMessage ?? def.message ?? 'This field is required';
            } else if (def.formula && str) {
              const formulaStr = storedValueToFormula(def.formula as FormulaValue);
              const result = evaluateFormula(formulaStr, formulaCtx);
              if (result.value === true || result.value === '') fieldIsValid = '';
              else if (typeof result.value === 'string' && result.value) fieldIsValid = result.value;
              else fieldIsValid = def.message ?? 'Invalid value';
            }
          }

          const existing = (newFields[fieldName] ?? {}) as Record<string, unknown>;
          newFields[fieldName] = { ...existing, value, isValid: fieldIsValid };
          if (fieldIsValid) hasErrors = true;
        }

        if (hasErrors) {
          const allValid = Object.values(newFields).every(
            (f) => !(f as { isValid?: unknown }).isValid || (f as { isValid?: unknown }).isValid === true
          );
          const nextForm = { ...current, fields: newFields, isValid: allValid };
          getGlobalVariableStore().getState().setState((prev) => writeFormState(prev, nextForm));
          ctx.store.getState().setState((prev) => writeFormState(prev, nextForm));
          const err = new Error('Validation failed') as Error & { __validationError?: boolean };
          err.__validationError = true;
          throw err;
        }
      }

      // ── Call onSuccess ───────────────────────────────────────────────────────
      const onSuccess = actionDef.onSuccess;
      if (onSuccess) {
        const actions = Array.isArray(onSuccess) ? onSuccess : [onSuccess];
        for (const a of actions) {
          await ctx.runOne(a as import('../../types').SDUIAction);
        }
      }
      await setFormStateHandler(ctx)({ type: 'setFormState', isSubmitting: false, isSubmitted: true });
    } catch (e) {
      await setFormStateHandler(ctx)({ type: 'setFormState', isSubmitting: false });
      const err = e as { __validationError?: boolean };
      if (!err.__validationError) throw e;
      // Validation errors: field-level messages already written to local.data.form.fields.*.isValid
    }
  };
