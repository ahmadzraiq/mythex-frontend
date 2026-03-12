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
import { FormContext, EMPTY_FORM_STATE, type FormState, type FieldValidationConfig, type FieldValidationRule } from '../form-context';
import { getGlobalVariableStore } from '../global-variable-store';
import { useBuilderMode } from '../builder-context';
import { applyFieldRules } from '../validation-utils';

interface FormContainerProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Called when the form submits (all built-in validation passes) */
  onSubmitAction?: () => void;
  /** Called when form submission is blocked by validation errors */
  onValidationErrorAction?: () => void;
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

export function FormContainer({ children, className, style, onSubmitAction, onValidationErrorAction, initialFormData, _formNodeId, ...rest }: FormContainerProps) {
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
  //
  // MERGE, not overwrite: directWriteField bypasses React state for zero-latency typing.
  // When a new field registers it calls setFormState → this effect fires with React state
  // that may lag behind what the user has typed. Overwriting would clobber live values.
  // Fix: for existing fields, prefer the current store value; only add NEW fields from state.
  useEffect(() => {
    getGlobalVariableStore().getState().setState((prev) => {
      const storedLocal = (prev['local'] ?? {}) as Record<string, unknown>;
      const storedData = (storedLocal['data'] ?? {}) as Record<string, unknown>;
      const storedForm = (storedData['form'] ?? {}) as Record<string, unknown>;
      const storedFormData = (storedForm['formData'] ?? {}) as Record<string, unknown>;
      const storedFields = (storedForm['fields'] ?? {}) as Record<string, unknown>;

      // React state supplies the authoritative shape (field list, isSubmitting, etc.).
      // For each field value, the store wins if it already has a value — user may have
      // typed since the last React render (directWriteField path).
      const mergedFormData = { ...formState.formData, ...storedFormData };
      const mergedFields: Record<string, unknown> = { ...formState.fields };
      for (const [name, storedField] of Object.entries(storedFields)) {
        if (name in mergedFields) {
          // Keep store's field object (has latest typed value + isValid from validation)
          mergedFields[name] = storedField;
        }
      }

      const mergedForm = { ...formState, formData: mergedFormData, fields: mergedFields };
      const next = { ...prev, local: { ...storedLocal, data: { ...storedData, form: mergedForm } } };
      next[formStoreKey] = mergedForm;
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

  // Updates formData + fields[name].value only — does NOT touch isValid/error state.
  // Used by onChange tracking in form-field-tracker so live typing doesn't reset
  // validation errors shown after a submit attempt.
  const setFieldValue = useCallback((name: string, value: unknown) => {
    setFormState((prev) => {
      const existing = prev.fields[name] ?? { value, isValid: '' };
      return {
        ...prev,
        formData: { ...prev.formData, [name]: value },
        fields: { ...prev.fields, [name]: { ...existing, value } },
      };
    });
  }, []);

  // Zero-React-render fast path for live typing.
  // Updates stateRef directly (no React re-render) and writes both
  //   local.data.form.formData.{name}
  //   variables['{formStoreKey}'].formData.{name}
  // in ONE atomic global-store write — single subscription trigger, one re-render pass.
  const directWriteField = useCallback((name: string, value: unknown) => {
    // Keep stateRef in sync so doSubmit reads the latest values without a React render.
    const prev = stateRef.current;
    const existingField = prev.fields[name] ?? { value, isValid: '' };
    stateRef.current = {
      ...prev,
      formData: { ...prev.formData, [name]: value },
      fields: { ...prev.fields, [name]: { ...existingField, value } },
    };

    // Single atomic write — updates ALL formula-accessible paths in one pass:
    //   local.data.form.formData.{name}
    //   local.data.form.fields.{name}.value
    //   variables['uuid-form']?.['formData']?.['name']
    //   variables['uuid-form']?.['fields']?.['name']?.['value']
    const key = formStoreKey;
    getGlobalVariableStore().getState().setState(vs => {
      const local = (vs['local'] ?? {}) as Record<string, unknown>;
      const data  = (local['data']  ?? {}) as Record<string, unknown>;
      const form  = (data['form']   ?? {}) as Record<string, unknown>;
      const fd    = (form['formData'] ?? {}) as Record<string, unknown>;
      const flds  = (form['fields']  ?? {}) as Record<string, unknown>;
      const fld   = (flds[name]      ?? { value, isValid: '' }) as Record<string, unknown>;
      const existingVar    = (vs[key] ?? stateRef.current) as Record<string, unknown>;
      const existingVarFd  = (existingVar['formData'] ?? {}) as Record<string, unknown>;
      const existingVarFlds = (existingVar['fields']  ?? {}) as Record<string, unknown>;
      const existingFld    = (existingVarFlds[name]   ?? { value, isValid: '' }) as Record<string, unknown>;
      const updatedFields = { ...existingVarFlds, [name]: { ...existingFld, value } };
      return {
        ...vs,
        local: {
          ...local,
          data: {
            ...data,
            form: {
              ...form,
              formData: { ...fd, [name]: value },
              fields:   { ...flds, [name]: { ...fld, value } },
            },
          },
        },
        [key]: {
          ...existingVar,
          formData: { ...existingVarFd,  [name]: value },
          fields:   updatedFields,
        },
      };
    });
  }, [formStoreKey]);

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
      // Fire the submitValidationError workflow if one is bound
      onValidationErrorAction?.();
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
  const { onSubmitAction: _osa, onValidationErrorAction: _ovea, initialFormData: _ifd, ...domRest } = { onSubmitAction, onValidationErrorAction, initialFormData, ...rest };
  void _osa; void _ovea; void _ifd;

  const ctxValue = {
    state: formState,
    setField,
    setFieldValue,
    directWriteField,
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
