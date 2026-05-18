import type { SymbolMap } from '../types';
import { rewritePropValue } from '../formula-rewrite';

type FormStep = {
  type: 'validate' | 'resetForm' | 'setFormState' | 'submitForm';
  field?: string;
  name?: string;
  value?: unknown;
  formId?: string;
  payload?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export function emitFormAction(step: FormStep, symbols: SymbolMap): string {
  const cfg = step.config ?? {};

  switch (step.type) {
    case 'validate': {
      const field = (cfg.field ?? cfg.fieldName ?? step.field ?? step.payload?.field) as string | undefined;
      return field ? `await form?.trigger(${JSON.stringify(field)});` : `await form?.trigger();`;
    }
    case 'resetForm': {
      const defaults = cfg.defaults ?? step.payload?.defaults;
      return defaults ? `form?.reset(${rewritePropValue(defaults, symbols)});` : `form?.reset();`;
    }
    case 'setFormState': {
      // config.path is "local.data.form.<fieldPath>" — strip the form prefix
      const rawPath = (cfg.path ?? cfg.fieldName ?? step.name ?? step.payload?.name ?? '') as string;
      const fieldKey = rawPath.replace(/^local\.data\.form\./, '');
      if (!fieldKey) return `/* setFormState: no field path */`;
      const rawValue = cfg.value !== undefined ? cfg.value
        : step.value !== undefined ? step.value
        : step.payload?.value;
      const valueExpr = rewritePropValue(rawValue, symbols);
      return `form?.setValue(${JSON.stringify(fieldKey)}, ${valueExpr}, { shouldValidate: true });`;
    }
    case 'submitForm': {
      // Trigger RHF validation; if valid the form data is collected. The workflow continues after.
      return `await form?.handleSubmit?.(async (_d: unknown) => { void _d; })?.();`;
    }
    default:
      return `/* unknown form action */`;
  }
}
