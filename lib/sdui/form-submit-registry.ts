/**
 * form-submit-registry.ts
 *
 * Module-level registry that bridges FormContainer's doSubmit() to action step
 * handlers. Each FormContainer registers itself by its formStoreKey on mount
 * and unregisters on unmount.
 *
 * The "submitForm" workflow step reads _activeFormKey from the global variable
 * store (set by FormContainer.doSubmit or by scopedRunAction before the action
 * runs), looks up the submit function here, and calls it synchronously.
 *
 * doSubmit returns:
 *   true  — all fields valid, onSubmitAction will be called
 *   false — validation failed, errors written to the store
 *
 * The step handler throws a __validationError when false so the workflow stops.
 */

type SubmitFn = () => boolean;

const registry = new Map<string, SubmitFn>();

export const formSubmitRegistry = {
  register(key: string, fn: SubmitFn): void {
    registry.set(key, fn);
  },
  unregister(key: string): void {
    registry.delete(key);
  },
  /** Call the registered submit fn. Returns true=valid, false=invalid. */
  submit(key: string): boolean {
    const fn = registry.get(key);
    if (!fn) return true; // no form registered — treat as no-op
    return fn();
  },
  /** Returns the first registered key (for single-form pages where _activeFormKey is unset). */
  firstKey(): string | undefined {
    return registry.keys().next().value;
  },
};
