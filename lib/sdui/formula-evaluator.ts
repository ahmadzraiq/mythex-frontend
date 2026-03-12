/**
 * Shared formula evaluator — used by both the SDUI runtime engine and the builder formula editor.
 *
 * All expressions are plain JavaScript using named variable scopes.
 *
 * Examples:
 *   "variables['UUID'] >= 60"
 *   "collections['UUID']?.data?.cart?.totalQuantity > 0"
 *   "if(variables['UUID'], null, variables['UUID2'])"
 *   "formatCurrency(collections['UUID']?.data?.cart?.total / 100, 'USD')"
 *   "context?.item?.data?.productName"
 *
 * Named variable scopes available in every formula:
 *   variables['UUID']          — global named variables (config/variables.json)
 *   collections['UUID']        — datasource data (config/datasources.json)
 *   context.item / context.index / context.parent — repeat-item scope
 *   globalContext.browser / globalContext.screen  — device/browser info
 *   pages['UUID']              — page-level state
 *   theme.colors / theme.sections / theme.fonts   — theme config
 *   event / event?.['value']   — action trigger event value
 *   route.sort / route.facets  — URL route params (from store.json initialData)
 *   auth.user / auth.token     — auth state (from store.json initialData)
 *   _workflow.lastAction / _workflow.lastError — workflow execution state
 *   local.data.form.fields.*   — form field validation state
 *   _conventions.*             — engine computed conventions (sortInputMap, etc.)
 *   get('path')                — escape hatch for arbitrary state path access
 *
 * Implementation is split across two modules:
 *   - formula-utils.ts     — getNestedVal, resolveVar
 *   - formula-functions.ts — FORMULA_FNS registry
 */

export type FormulaValue = string | number | boolean | object | null;
export type EvalResult = { value: unknown; error: null } | { value: null; error: string };

export { resolveVar } from './formula-utils';
export { FORMULA_FNS } from './formula-functions';

import { resolveVar } from './formula-utils';
import { FORMULA_FNS } from './formula-functions';

// ─── Core evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate a formula string against a context object.
 *
 * Supports:
 *   - Plain JS expressions using named scopes: "variables['UUID'] > 0", "collections['UUID']?.data?.total"
 *   - Function calls: "if(variables['UUID'], null, variables['UUID2'])", "sum(1, 2, 3)"
 */
export function evaluateFormula(formula: string | object, context: Record<string, unknown>): EvalResult {
  // { "expr": formula } — wrapper for inline formula; evaluate the inner expression
  if (typeof formula === 'object' && formula !== null && 'expr' in formula) {
    const inner = (formula as { expr: string | object }).expr;
    return evaluateFormula(inner as string | object, context);
  }
  // Non-string, non-expr object — not a supported formula type
  if (typeof formula === 'object' && formula !== null) {
    return { value: null, error: 'Invalid formula' };
  }

  const formulaStr = String(formula);
  if (!formulaStr.trim()) return { value: undefined, error: null };

  // Normalise natural-language operators
  const resolved = formulaStr.trim()
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||');

  // Rewrite function calls: sum( → __fns__['sum'](
  // Using bracket notation handles reserved keywords like 'if', 'switch'
  let processed = resolved;
  for (const name of Object.keys(FORMULA_FNS)) {
    processed = processed.replace(
      new RegExp(`\\b${name}\\s*\\(`, 'g'),
      `__fns__['${name}'](`
    );
  }

  try {
    // Named scopes: variables['UUID'], collections['UUID'], context.item, route.*, auth.*,
    // _workflow.*, local.data.form.*, _conventions.*, globalContext, pages, theme, event.
    // get('path') is an escape hatch for arbitrary flat-key state access.
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      '__fns__', '__collections__', '__variables__', '__ctx__', '__globalCtx__', '__pages__', '__theme__', '__event__', '__state__',
      `"use strict"; ` +
      `const collections = __collections__ ?? {}; ` +
      `const variables = __variables__ ?? {}; ` +
      `const context = __ctx__ ?? {}; ` +
      `const globalContext = __globalCtx__ ?? {}; ` +
      `const pages = __pages__ ?? {}; ` +
      `const theme = __theme__ ?? {}; ` +
      `const event = __event__ ?? {}; ` +
      `const route = (__state__ ?? {})['route'] ?? {}; ` +
      `const auth = (__state__ ?? {})['auth'] ?? {}; ` +
      `const _workflow = (__state__ ?? {})['_workflow'] ?? {}; ` +
      `const local = (__state__ ?? {})['local'] ?? {}; ` +
      `const _conventions = (__state__ ?? {})['_conventions'] ?? {}; ` +
      `const get = (p) => { if (!p || !__state__) return undefined; if (p in __state__) return __state__[p]; const parts = p.split('.'); let c = __state__; for (const k of parts) { if (c == null || typeof c !== 'object') return undefined; c = c[k]; } return c; }; ` +
      `return (${processed});`
    );
    const value = fn(
      FORMULA_FNS,
      (context.collections ?? {}) as Record<string, unknown>,
      (context.variables ?? {}) as Record<string, unknown>,
      (context.context ?? {}) as Record<string, unknown>,
      (context.globalContext ?? {}) as Record<string, unknown>,
      (context.pages ?? {}) as Record<string, unknown>,
      (context.theme ?? {}) as Record<string, unknown>,
      (context.event ?? {}) as Record<string, unknown>,
      context,
    );
    return { value, error: null };
  } catch {
    // Fall back: try resolving as a bare variable path
    const varVal = resolveVar(formulaStr.trim(), context);
    if (varVal !== undefined) return { value: varVal, error: null };
    return { value: null, error: 'Invalid formula' };
  }
}

// ─── Value helpers ────────────────────────────────────────────────────────────

export function isBoundValue(v: FormulaValue): boolean {
  if (v !== null && typeof v === 'object') return true;
  return false;
}

/** Convert editable formula string → storage format */
export function formulaToStoredValue(formula: string): FormulaValue {
  const trimmed = formula.trim();
  if (!trimmed) return '';
  // Pure numbers (int or float, optionally negative)
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { formula: trimmed };
  // String literals ("text" or 'text') — store as the plain string
  const dblQuote = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (dblQuote) return dblQuote[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const sglQuote = trimmed.match(/^'((?:[^'\\]|\\.)*)'$/);
  if (sglQuote) return sglQuote[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  // Everything else (variable access, expressions): store as { formula: "..." }
  // Use variables['UUID'], collections['UUID'].data.path, context.item?.['field'], etc.
  return { formula: trimmed };
}

/** Convert stored value → editable formula string */
export function storedValueToFormula(value: FormulaValue): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    // Return the raw stored string as-is (including any legacy {{path}} syntax).
    // Callers that see {{path}} in the formula editor should migrate to variables['UUID'] syntax.
    return value;
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.formula === 'string') return v.formula;
    // { expr: "..." } inline expression — show just the expression
    if (typeof v.expr === 'string') return v.expr;
    return '';
  }
  return String(value);
}
