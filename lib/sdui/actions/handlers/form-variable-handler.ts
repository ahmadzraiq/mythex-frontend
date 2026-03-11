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
import { evaluateFormula, storedValueToFormula, FORMULA_FNS, type FormulaValue } from '../../formula-evaluator';

const LOCAL_PATH = 'local';

type ValidationRule = { type: string; message?: string; value?: string; formula?: unknown };

/** Apply an array of validation rules to a single field value. Returns '' if valid, or an error message string. */
function applyValidationRules(
  rules: ValidationRule[],
  value: unknown,
  formulaCtx: Record<string, unknown>,
): string {
  const str = String(value ?? '').trim();
  for (const rule of rules) {
    const msg = rule.message || 'Invalid value';
    let isValid = true;
    switch (rule.type) {
      case 'required':   isValid = !!str; break;
      case 'email':      isValid = !str || !!(FORMULA_FNS.isEmail as (v: unknown) => boolean)(value); break;
      case 'phone':      isValid = !str || !!(FORMULA_FNS.isPhone as (v: unknown) => boolean)(value); break;
      case 'url':        isValid = !str || !!(FORMULA_FNS.isUrl as (v: unknown) => boolean)(value); break;
      case 'minLength':  isValid = !str || !!(FORMULA_FNS.hasMinLength as (v: unknown, n: number) => boolean)(value, Number(rule.value ?? 0)); break;
      case 'maxLength':  isValid = !str || !!(FORMULA_FNS.hasMaxLength as (v: unknown, n: number) => boolean)(value, Number(rule.value ?? Infinity)); break;
      case 'pattern':    isValid = !str || !rule.value || !!(FORMULA_FNS.matchesPattern as (v: unknown, p: string) => boolean)(value, rule.value); break;
      case 'formula': {
        if (rule.formula) {
          const formulaStr = storedValueToFormula(rule.formula as FormulaValue);
          const result = evaluateFormula(formulaStr, formulaCtx);
          if (result.value === true || result.value === '') { isValid = true; }
          else if (typeof result.value === 'string' && result.value) { return result.value; }
          else { isValid = false; }
        }
        break;
      }
    }
    if (!isValid) return msg;
  }
  return '';
}

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

/** setFormState — sets isSubmitting / isSubmitted */
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

/** submitForm — validates via fieldValidations map, then fires onSuccess */
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
        validationRules?: ValidationRule[];
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
            fieldIsValid = applyValidationRules(def.validationRules, value, formulaCtx);
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
