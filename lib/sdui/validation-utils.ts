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
