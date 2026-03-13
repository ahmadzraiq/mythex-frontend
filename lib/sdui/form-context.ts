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

export type FieldValidationRule = { type: string; message?: string; value?: string; formula?: unknown };
export type FieldValidationConfig = { trigger: string; rules: FieldValidationRule[] };

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
  /**
   * Update a field's value without touching its isValid / error state.
   * Use from onChange handlers that should not clear or set validation state
   * (e.g. live typing tracking). Preserves whatever isValid is currently set,
   * so error messages shown after a submit attempt are not cleared mid-edit.
   */
  setFieldValue: (name: string, value: unknown) => void;
  /**
   * Zero-React-render fast path for live typing.
   * Writes both `local.data.form.formData.{name}` and `variables[formStoreKey].formData.{name}`
   * in a single atomic global-store update — no FormContainer re-render, no useEffect round-trip,
   * one subscription trigger. Use this in onChange trackers for maximum responsiveness.
   */
  directWriteField: (name: string, value: unknown) => void;
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
   * Register a `{parentInputId}-value` top-level store slot owned by an InputField child.
   * Called when an InputField with a parentInputId mounts inside this FormContainer so
   * reset() can clear the slot synchronously via the reliable top-level subscription path.
   */
  registerFieldSlot: (slotKey: string) => void;
  /** Remove the slot registration when the InputField unmounts */
  unregisterFieldSlot: (slotKey: string) => void;
  /**
   * Register a named variable that is bound as the `value` prop of an InputField child.
   * When reset() fires, the variable is cleared back to `initialValue` so the input
   * visually clears without needing explicit changeVariableValue steps in the workflow.
   */
  registerVariableBinding: (uuid: string, initialValue: unknown) => void;
  /** Remove the variable binding when the InputField unmounts */
  unregisterVariableBinding: (uuid: string) => void;
  /**
   * Programmatically submit the form: validates all registered _validation fields,
   * shows errors if any, and calls onSubmitAction (or the provided callback) if all valid.
   * Called by the renderer when a Button with type="submit" is clicked, or when any
   * element with trigger:"submit" is clicked inside this container.
   */
  submit: (onSuccess?: () => void) => void;
};

export const FormContext = createContext<FormContextValue | null>(null);

export function useFormContext(): FormContextValue | null {
  return useContext(FormContext);
}
