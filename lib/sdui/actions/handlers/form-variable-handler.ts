/**
 * Handlers for form variable actions: setFormField, resetForm
 *
 * Form variables are keyed by UUID in the global variable store.
 * Shape: { value: {...}, errors: {...}, dirty: {...}, valid: boolean }
 */

import { setNestedValue } from '../../nested-utils';
import { resolveActionValue } from '../resolve-value';
import type { ActionDef, ActionHandlerContext } from './types';
import variablesJson from '@/config/variables.json';

type FieldDef = {
  name: string;
  type?: string;
  initialValue?: unknown;
  validation?: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    equalsField?: string;
    message?: string;
  };
};

type FormVarDef = {
  type: 'form';
  fields?: FieldDef[];
  label?: string;
};

const varsConfig = variablesJson as { variables: Record<string, { type?: string; fields?: FieldDef[]; initialValue?: unknown }> };

function getFormDef(formId: string): FormVarDef | null {
  const def = varsConfig.variables[formId];
  if (!def || def.type !== 'form') return null;
  return def as FormVarDef;
}

function computeValid(formId: string, valueObj: Record<string, unknown>): boolean {
  const def = getFormDef(formId);
  if (!def) return true;
  for (const field of def.fields ?? []) {
    const v = field.validation;
    if (!v) continue;
    const val = valueObj[field.name];
    if (v.required && (val == null || val === '')) return false;
    if (v.minLength && typeof val === 'string' && val.length < v.minLength) return false;
    if (v.maxLength && typeof val === 'string' && val.length > v.maxLength) return false;
    if (v.pattern === 'email' && typeof val === 'string' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return false;
    if (v.equalsField) {
      // Simple check: field names are relative to the form value
      const compareFieldName = v.equalsField.replace(/^form\./, '');
      const compareVal = valueObj[compareFieldName];
      if (val !== compareVal) return false;
    }
  }
  return true;
}

/** setFormField — sets field value, marks dirty=true, recomputes valid */
export const setFormFieldHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const formId = (actionDef.formId ?? '') as string;
    const field = (actionDef.field ?? '') as string;
    if (!formId || !field) return;

    const rawValue = actionDef.value;
    const newValue = rawValue === '$event' ? ctx.event : resolveActionValue(rawValue, ctx.get, ctx.scope, rawValue);

    ctx.store.getState().setState((prev) => {
      const current = (prev[formId] ?? {}) as Record<string, unknown>;
      const currentValue = ((current.value ?? {}) as Record<string, unknown>);
      const newValueObj = { ...currentValue, [field]: newValue };
      const newDirty = { ...((current.dirty ?? {}) as Record<string, unknown>), [field]: true };
      const valid = computeValid(formId, newValueObj);
      return setNestedValue(prev, formId, {
        ...current,
        value: newValueObj,
        dirty: newDirty,
        valid,
        errors: { ...((current.errors ?? {}) as Record<string, unknown>), [field]: null },
      });
    });
  };

/** resetForm — resets to initialValue from config, clears errors and dirty */
export const resetFormHandler: (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void> =
  (ctx) => async (actionDef) => {
    const formId = (actionDef.formId ?? '') as string;
    if (!formId) return;

    const def = getFormDef(formId);
    if (!def) return;

    const value: Record<string, unknown> = {};
    const errors: Record<string, unknown> = {};
    const dirty: Record<string, unknown> = {};
    for (const f of def.fields ?? []) {
      value[f.name] = f.initialValue ?? '';
      errors[f.name] = null;
      dirty[f.name] = false;
    }

    ctx.store.getState().setState((prev) =>
      setNestedValue(prev, formId, { value, errors, dirty, valid: false })
    );
  };
