/**
 * Shared field validation logic used by both FormContainer (runtime component) and
 * form-variable-handler (workflow action handler).
 *
 * Previously duplicated in both files; extracted here so any change (new rule type,
 * formula evaluation change, etc.) only needs to happen once.
 */

import { evaluateFormula, storedValueToFormula, FORMULA_FNS, type FormulaValue } from './formula-evaluator';
import type { FieldValidationRule } from './form-context';

/**
 * Validate a single field value against its rules.
 * Returns '' if all rules pass, or the first failing rule's error message.
 */
export function applyFieldRules(
  rules: FieldValidationRule[],
  value: unknown,
  formulaCtx: Record<string, unknown>,
): string {
  // Inject `value` so formula rules can reference it directly (e.g. `value === true`).
  formulaCtx = { ...formulaCtx, value };
  const str = String(value ?? '').trim();
  for (const rule of rules) {
    const msg = rule.message || 'Invalid value';
    let isValid = true;
    const ruleKey = (rule as Record<string, unknown>).rule as string | undefined ?? rule.type;
    switch (ruleKey) {
      case 'required':  isValid = !!str; break;
      case 'email':     isValid = !str || !!(FORMULA_FNS.isEmail as (v: unknown) => boolean)(value); break;
      case 'phone':     isValid = !str || !!(FORMULA_FNS.isPhone as (v: unknown) => boolean)(value); break;
      case 'url':       isValid = !str || !!(FORMULA_FNS.isUrl as (v: unknown) => boolean)(value); break;
      case 'minLength': isValid = !str || !!(FORMULA_FNS.hasMinLength as (v: unknown, n: number) => boolean)(value, Number(rule.value ?? 0)); break;
      case 'maxLength': isValid = !str || !!(FORMULA_FNS.hasMaxLength as (v: unknown, n: number) => boolean)(value, Number(rule.value ?? Infinity)); break;
      case 'pattern':   isValid = !str || !rule.value || !!(FORMULA_FNS.matchesPattern as (v: unknown, p: string) => boolean)(value, rule.value); break;
      case 'equalsField': {
        // rule.value holds the name of the field to compare against
        const otherFieldName = rule.value;
        if (otherFieldName) {
          const formData = (
            (formulaCtx['local'] as Record<string, unknown> | undefined)
              ?.['data'] as Record<string, unknown> | undefined
          )?.['form'] as Record<string, unknown> | undefined;
          const formDataObj = (formData?.['formData'] as Record<string, unknown>) ?? {};
          const otherVal = String(formDataObj[otherFieldName] ?? '').trim();
          isValid = str === otherVal;
        }
        break;
      }
      case 'formula': {
        // Support both rule.formula (FormulaValue object) and rule.value (plain string expression)
        const formulaSource = rule.formula ?? rule.value;
        if (formulaSource) {
          const formulaStr = typeof formulaSource === 'string'
            ? formulaSource
            : storedValueToFormula(formulaSource as FormulaValue);
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
