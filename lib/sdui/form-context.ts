/**
 * Form Context — weWeb-style local form state
 *
 * When a FormContainer is rendered, it provides this context to all children.
 * State is also synced to the global variable store under `local.data.form.*`
 * so formulas like {{local.data.form.formData.email}} resolve in the SDUI engine.
 */

import { createContext, useContext } from 'react';

export type FormFieldState = {
  value: unknown;
  /** '' means valid (no error); a non-empty string is the validation error message */
  isValid: boolean | string;
};

export type ValidationRule = { type: string; message?: string; value?: string; formula?: unknown };
export type FieldValidationConfig = { trigger: string; rules: ValidationRule[] };

export type FormState = {
  formData: Record<string, unknown>;
  fields: Record<string, FormFieldState>;
  isSubmitting: boolean;
  isSubmitted: boolean;
  isValid: boolean;
};

export const EMPTY_FORM_STATE: FormState = {
  formData: {},
  fields: {},
  isSubmitting: false,
  isSubmitted: false,
  isValid: false,
};

export type FormContextValue = {
  state: FormState;
  setField: (name: string, value: unknown, isValid?: boolean) => void;
  setFormState: (patch: Partial<Pick<FormState, 'isSubmitting' | 'isSubmitted'>>) => void;
  reset: () => void;
  /** Declare a field so it appears in formData/fields before the user types */
  registerField: (name: string, initialValue?: unknown) => void;
  /** Remove a field when its input unmounts */
  unregisterField: (name: string) => void;
  /** Register _validation rules for a field so FormContainer can validate on submit */
  registerFieldValidation: (name: string, config: FieldValidationConfig) => void;
  /** Remove validation rules when the field unmounts */
  unregisterFieldValidation: (name: string) => void;
  /**
   * Programmatically submit the form: validates all registered _validation fields,
   * shows errors if any, and calls onSubmitAction if all valid.
   * Called by the renderer when a Button with type="submit" is clicked inside this container.
   */
  submit: () => void;
};

export const FormContext = createContext<FormContextValue | null>(null);

export function useFormContext(): FormContextValue | null {
  return useContext(FormContext);
}
