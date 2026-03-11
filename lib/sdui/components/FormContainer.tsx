'use client';

/**
 * FormContainer — weWeb-style local form state provider
 *
 * Provides `local.data.form.*` scope to all children:
 *   local.data.form.formData.fieldName   — current field values
 *   local.data.form.fields.fieldName     — { value, isValid } per field
 *   local.data.form.isSubmitting         — boolean
 *   local.data.form.isSubmitted          — boolean
 *   local.data.form.isValid              — all fields valid?
 *
 * State is synced to the global variable store so formula evaluation works.
 * Actions: setFormState, resetForm, submitForm
 *
 * In builder mode, renders a <div> instead of <form> to prevent any form
 * submission from interfering with the builder UI (e.g. the formula editor).
 *
 * Submit model:
 *   A <Button type="submit"> (or any native submit) fires the form's onSubmit.
 *   FormContainer validates all registered _validation rules on submit-trigger fields.
 *   If all pass, it calls onSubmitAction which runs the bound workflow (trigger: "submit").
 *   No separate submitForm step needed — validation lives here, not in the workflow.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { FormContext, EMPTY_FORM_STATE, type FormState, type FieldValidationConfig, type ValidationRule } from '../form-context';
import { getGlobalVariableStore } from '../global-variable-store';
import { useBuilderMode } from '../builder-context';
import { evaluateFormula, storedValueToFormula, FORMULA_FNS, type FormulaValue } from '../formula-evaluator';

/** Validate a single field value against its rules. Returns '' if valid, error message if not. */
function applyFieldRules(
  rules: ValidationRule[],
  value: unknown,
  formulaCtx: Record<string, unknown>,
): string {
  const str = String(value ?? '').trim();
  for (const rule of rules) {
    const msg = rule.message || 'Invalid value';
    let isValid = true;
    switch (rule.type) {
      case 'required':  isValid = !!str; break;
      case 'email':     isValid = !str || !!(FORMULA_FNS.isEmail as (v: unknown) => boolean)(value); break;
      case 'phone':     isValid = !str || !!(FORMULA_FNS.isPhone as (v: unknown) => boolean)(value); break;
      case 'url':       isValid = !str || !!(FORMULA_FNS.isUrl as (v: unknown) => boolean)(value); break;
      case 'minLength': isValid = !str || !!(FORMULA_FNS.hasMinLength as (v: unknown, n: number) => boolean)(value, Number(rule.value ?? 0)); break;
      case 'maxLength': isValid = !str || !!(FORMULA_FNS.hasMaxLength as (v: unknown, n: number) => boolean)(value, Number(rule.value ?? Infinity)); break;
      case 'pattern':   isValid = !str || !rule.value || !!(FORMULA_FNS.matchesPattern as (v: unknown, p: string) => boolean)(value, rule.value); break;
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

interface FormContainerProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Called when the form submits (all built-in validation passes) */
  onSubmitAction?: () => void;
  /**
   * Pre-declare field names so the formula editor shows them immediately on drop.
   * E.g. { email: '', password: '' } — values are the initial field values.
   */
  initialFormData?: Record<string, unknown>;
  /**
   * Injected by the SDUI renderer — the FormContainer's SDUI node ID.
   * Used to write form state to variables['{_formNodeId}-form'] so formulas like
   * variables['uuid-form']?.['formData']?.['fieldName'] resolve correctly.
   */
  _formNodeId?: string;
  [key: string]: unknown;
}

export function FormContainer({ children, className, style, onSubmitAction, initialFormData, _formNodeId, ...rest }: FormContainerProps) {
  const { builderMode } = useBuilderMode();
  const [formState, setFormState] = useState<FormState>(() => {
    if (initialFormData && Object.keys(initialFormData).length > 0) {
      const fields = Object.fromEntries(
        Object.entries(initialFormData).map(([k, v]) => [k, { value: v, isValid: '' }])
      );
      return { ...EMPTY_FORM_STATE, formData: initialFormData, fields };
    }
    return EMPTY_FORM_STATE;
  });
  const stateRef = useRef(formState);
  stateRef.current = formState;

  // Stable per-instance ID: prefer the injected SDUI node id, fall back to a generated UUID.
  // This ref is set once on mount so the id is stable across re-renders even when the
  // node has no explicit id in the JSON config (e.g. screens loaded from config/*.json).
  const stableIdRef = useRef<string>(_formNodeId || `fc-${crypto.randomUUID()}`);
  // If the renderer later provides an explicit id (after the first render), use it.
  if (_formNodeId && stableIdRef.current.startsWith('fc-')) {
    stableIdRef.current = _formNodeId;
  }
  const formStoreKey = `${stableIdRef.current}-form`;

  // Registry of field _validation rules — populated by child InputField nodes via context
  const fieldValidationsRef = useRef<Record<string, FieldValidationConfig>>({});

  // Sync to global variable store so {{local.data.form.*}} resolves in formulas.
  // Also write to variables['{stableId}-form'] so formulas like
  // variables['uuid-form']?.['formData']?.['fieldName'] resolve correctly.
  useEffect(() => {
    getGlobalVariableStore().getState().setState((prev) => {
      const next = { ...prev, local: { data: { form: formState } } };
      next[formStoreKey] = formState;
      return next;
    });
  }, [formState, formStoreKey]);

  // Clean up on unmount so stale form data doesn't linger
  useEffect(() => {
    const key = formStoreKey;
    return () => {
      getGlobalVariableStore().getState().setState((prev) => {
        const next = { ...prev };
        delete next['local'];
        delete next[key];
        return next;
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = useCallback((name: string, value: unknown, isValid = true) => {
    setFormState((prev) => {
      const newFormData = { ...prev.formData, [name]: value };
      const newFields = {
        ...prev.fields,
        [name]: { value, isValid },
      };
      const allValid = Object.values(newFields).every((f) => f.isValid);
      return {
        ...prev,
        formData: newFormData,
        fields: newFields,
        isValid: allValid,
      };
    });
  }, []);

  const setFormStatePatch = useCallback(
    (patch: Partial<Pick<FormState, 'isSubmitting' | 'isSubmitted'>>) => {
      setFormState((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const reset = useCallback(() => {
    setFormState(EMPTY_FORM_STATE);
  }, []);

  /** Called by child nodes when they mount with a `name` prop inside a FormContainer */
  const registerField = useCallback((name: string, initialValue: unknown = '') => {
    setFormState((prev) => {
      if (name in prev.formData) return prev; // already registered — preserve current value
      const newFormData = { ...prev.formData, [name]: initialValue };
      const newFields = { ...prev.fields, [name]: { value: initialValue, isValid: '' } };
      return { ...prev, formData: newFormData, fields: newFields };
    });
  }, []);

  /** Called when a child node with a `name` prop unmounts */
  const unregisterField = useCallback((name: string) => {
    setFormState((prev) => {
      if (!(name in prev.formData)) return prev;
      const { [name]: _fd, ...formData } = prev.formData;
      const { [name]: _f, ...fields } = prev.fields;
      void _fd; void _f;
      const allValid = Object.values(fields).every((f) => f.isValid);
      return { ...prev, formData, fields, isValid: allValid };
    });
  }, []);

  /** Called by child InputField nodes to register their _validation config */
  const registerFieldValidation = useCallback((name: string, config: FieldValidationConfig) => {
    fieldValidationsRef.current[name] = config;
  }, []);

  /** Called when a child InputField unmounts to remove its validation config */
  const unregisterFieldValidation = useCallback((name: string) => {
    delete fieldValidationsRef.current[name];
  }, []);

  /**
   * Core submit logic: reads current form data from the global variable store
   * (written by the form-field-tracker on each change), validates all registered _validation fields,
   * writes errors immediately to the store so error nodes re-render, and if all
   * fields are valid calls onSubmitAction to run the bound workflow.
   *
   * Exposed via FormContext.submit() so the renderer can call it when a Button
   * with type="submit" is pressed (Gluestack Button is a <div>, not <button>,
   * so the HTML form's onSubmit never fires naturally from a button click).
   */
  const doSubmit = useCallback((onSuccess?: () => void) => {
    if (builderMode) return;

    // The form-field-tracker writes directly to the global variable store (not to FormContainer React state).
    // Read form data from there so validation runs against what the user actually typed.
    const vs = getGlobalVariableStore().getState().getFullState();
    const storedLocal = (vs['local'] ?? {}) as Record<string, unknown>;
    const storedData = (storedLocal['data'] ?? {}) as Record<string, unknown>;
    const storedForm = (storedData['form'] ?? stateRef.current) as FormState;

    const validations = fieldValidationsRef.current;
    const formulaCtx = { local: { data: { form: storedForm } } } as Record<string, unknown>;

    // Validate all fields that have trigger: "submit" rules
    let hasErrors = false;
    const newFields = { ...storedForm.fields } as Record<string, { value: unknown; isValid: unknown }>;

    for (const [fieldName, config] of Object.entries(validations)) {
      if (config.trigger !== 'submit') continue;
      const value = (storedForm.formData ?? {})[fieldName] ?? '';
      const error = applyFieldRules(config.rules, value, formulaCtx);
      const existing = (newFields[fieldName] ?? { value, isValid: '' }) as Record<string, unknown>;
      newFields[fieldName] = { ...existing, value, isValid: error };
      if (error) hasErrors = true;
    }

    if (hasErrors) {
      const nextForm: FormState = { ...storedForm, fields: newFields as FormState['fields'], isValid: false };
      // Write errors immediately to the global variable store so the renderer shows them
      getGlobalVariableStore().getState().setState((prev) => {
        const local = (prev['local'] ?? {}) as Record<string, unknown>;
        const data = (local['data'] ?? {}) as Record<string, unknown>;
        return { ...prev, local: { ...local, data: { ...data, form: nextForm } } };
      });
      // Also update React state (triggers the sync useEffect which re-confirms the write)
      setFormState(nextForm);
      return;
    }

    // Use the caller-provided success callback (e.g. from a child element with trigger:"submit")
    // or fall back to the FormContainer's own onSubmitAction workflow.
    if (onSuccess) onSuccess();
    else if (onSubmitAction) onSubmitAction();
  }, [onSubmitAction, builderMode]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      doSubmit();
    },
    [doSubmit]
  );

  // Filter out SDUI-specific props that shouldn't reach the DOM
  const { onSubmitAction: _osa, initialFormData: _ifd, ...domRest } = { onSubmitAction, initialFormData, ...rest };
  void _osa; void _ifd;

  const ctxValue = {
    state: formState,
    setField,
    setFormState: setFormStatePatch,
    reset,
    registerField,
    unregisterField,
    registerFieldValidation,
    unregisterFieldValidation,
    submit: doSubmit,
  };

  // In builder mode, render a plain <div> to prevent form submission from
  // interfering with the builder UI (e.g. formula editor, binding icons).
  if (builderMode) {
    return (
      <FormContext.Provider value={ctxValue}>
        <div
          className={className}
          style={style}
          {...(domRest as React.HTMLAttributes<HTMLDivElement>)}
        >
          {children}
        </div>
      </FormContext.Provider>
    );
  }

  return (
    <FormContext.Provider value={ctxValue}>
      <form
        className={className}
        style={style}
        onSubmit={handleSubmit}
        noValidate
        {...(domRest as React.FormHTMLAttributes<HTMLFormElement>)}
      >
        {children}
      </form>
    </FormContext.Provider>
  );
}

export default FormContainer;
