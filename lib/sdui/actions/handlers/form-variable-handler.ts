/**
 * Handlers for form actions: setFormField, setFormState, resetForm, submitForm
 *
 * weWeb-style: form state lives at local.data.form.* in the global variable store.
 * No UUID or formId needed — always writes to the nearest FormContainer's state.
 *
 * local.data.form = {
 *   formData:     { fieldName: value, ... }
 *   fields:       { fieldName: { value, isValid }, ... }
 *   isSubmitting: boolean
 *   isSubmitted:  boolean
 *   isValid:      boolean
 * }
 */

import { resolveActionValue } from '../resolve-value';
import type { ActionDef, ActionHandlerContext } from './types';
import { getGlobalVariableStore } from '../../global-variable-store';
import { evaluateFormula, storedValueToFormula, FORMULA_FNS, type FormulaValue } from '../../formula-evaluator';

const LOCAL_PATH = 'local';

type ValidationRule = { type: string; message?: string; value?: string; formula?: unknown };

/** Module-level debounce timers keyed by field name */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

function runValidationAndWrite(
  field: string,
  newValue: unknown,
  actionDef: ActionDef,
  baseFormState: ReturnType<typeof getFormState>,
  vs: Record<string, unknown>,
  store: ActionHandlerContext['store'],
) {
  const newFormData = { ...baseFormState.formData, [field]: newValue };
  const formulaCtx = {
    ...vs,
    local: {
      ...(vs['local'] as Record<string, unknown> ?? {}),
      data: { form: { ...baseFormState, formData: newFormData } },
    },
  } as Record<string, unknown>;

  let fieldIsValid: unknown = '';
  const validationRules = actionDef.validationRules as ValidationRule[] | undefined;
  if (validationRules && validationRules.length > 0) {
    fieldIsValid = applyValidationRules(validationRules, newValue, formulaCtx);
  } else {
    const str = String(newValue ?? '').trim();
    const required = actionDef.required as boolean | undefined;
    const requiredMessage = (actionDef.requiredMessage as string | undefined) ?? 'This field is required';
    const customFormula = actionDef.validationFormula;
    if (required && !str) {
      fieldIsValid = requiredMessage;
    } else if (customFormula) {
      const formulaStr = storedValueToFormula(customFormula as FormulaValue);
      const result = evaluateFormula(formulaStr, formulaCtx);
      if (result.value === true || result.value === '') fieldIsValid = '';
      else if (typeof result.value === 'string' && result.value) fieldIsValid = result.value;
      else fieldIsValid = typeof (actionDef.message) === 'string' ? actionDef.message : 'Invalid value';
    }
  }

  // Read latest form state again (may have changed during debounce delay).
  // Always update formData with newValue so the controlled input's bound value updates.
  const latest = getFormState(getGlobalVariableStore().getState().getFullState());
  const newFormDataFinal = { ...latest.formData, [field]: newValue };
  const newFields = {
    ...latest.fields,
    [field]: { value: newValue, isValid: fieldIsValid },
  };
  const allValid = Object.values(newFields).every((f) => !f.isValid || f.isValid === true);
  const nextForm = { ...latest, formData: newFormDataFinal, fields: newFields, isValid: allValid };

  getGlobalVariableStore().getState().setState((prev) => writeFormState(prev, nextForm));
  store.getState().setState((prev) => writeFormState(prev, nextForm));
}

/** setFormField — sets field value in local.data.form, updates fields + isValid */
export const setFormFieldHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const field = (actionDef.field ?? '') as string;
    if (!field) return;

    const rawValue = actionDef.value;
    const newValue = rawValue === '$event' ? ctx.event : resolveActionValue(rawValue, ctx.get, ctx.scope, rawValue);

    const vs = getGlobalVariableStore().getState().getFullState();
    const current = getFormState(vs);
    const newFormData = { ...current.formData, [field]: newValue };

    // Always write the new value immediately (keeps controlled input responsive)
    const debounce = actionDef._debounce as { enabled?: boolean; delay?: number } | undefined;
    const isChangeTrigger = actionDef.validationTrigger === 'change';

    if (isChangeTrigger && debounce?.enabled) {
      // Write value now, keeping existing isValid until debounce fires
      const existingIsValid = current.fields[field]?.isValid ?? '';
      const quickFields = {
        ...current.fields,
        [field]: { value: newValue, isValid: existingIsValid },
      };
      const quickForm = { ...current, formData: newFormData, fields: quickFields };
      getGlobalVariableStore().getState().setState((prev) => writeFormState(prev, quickForm));
      ctx.store.getState().setState((prev) => writeFormState(prev, quickForm));

      // Schedule debounced validation
      clearTimeout(debounceTimers.get(field));
      debounceTimers.set(field, setTimeout(() => {
        debounceTimers.delete(field);
        const freshVs = getGlobalVariableStore().getState().getFullState();
        const freshForm = getFormState(freshVs);
        runValidationAndWrite(field, newValue, actionDef, freshForm, freshVs, ctx.store);
      }, debounce.delay ?? 300));
      return;
    }

    // Non-debounced path
    let fieldIsValid: unknown = current.fields[field]?.isValid ?? '';
    if (isChangeTrigger) {
      runValidationAndWrite(field, newValue, actionDef, current, vs, ctx.store);
      return;
    } else if (actionDef.validationTrigger === 'submit') {
      fieldIsValid = '';
    } else if (actionDef.isValid !== undefined) {
      fieldIsValid = Boolean(actionDef.isValid);
    }

    const newFields = {
      ...current.fields,
      [field]: { value: newValue, isValid: fieldIsValid },
    };
    const allValid = Object.values(newFields).every((f) => !f.isValid || f.isValid === true);
    const nextForm = { ...current, formData: newFormData, fields: newFields, isValid: allValid };

    getGlobalVariableStore().getState().setState((prev) => writeFormState(prev, nextForm));
    ctx.store.getState().setState((prev) => writeFormState(prev, nextForm));
  };

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
