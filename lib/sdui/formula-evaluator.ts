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
import { evaluateJsBinding, isJsBinding } from './javascript-evaluator';

// ─── Global Formula Registry ──────────────────────────────────────────────────

/** Shape of a global formula definition (mirrors GlobalFormulaDef from _store-types.ts) */
interface _GlobalFormulaDef {
  name: string;
  folder?: string;
  description?: string;
  params: Array<{ id: string; name: string; type: string; testValue?: unknown }>;
  formula: string;
}

/** Module-level registry, updated via registerGlobalFormulas() */
let _registeredFormulas: Record<string, _GlobalFormulaDef> = {};

/**
 * Register (or replace) the full set of global formula definitions.
 * Called by the builder store whenever formulas are loaded or changed.
 * Normalises the `formula` field to always be a string.
 */
export function registerGlobalFormulas(formulas: Record<string, unknown>): void {
  // Normalise each entry: extract formula string if stored as { formula: '...' } object
  const normalised: Record<string, _GlobalFormulaDef> = {};
  for (const [key, rawDef] of Object.entries(formulas)) {
    if (!rawDef || typeof rawDef !== 'object') continue;
    const def = rawDef as Record<string, unknown>;
    const rawFormula = def.formula;
    const formulaStr = typeof rawFormula === 'string'
      ? rawFormula
      : (rawFormula && typeof rawFormula === 'object' && 'formula' in (rawFormula as object)
          ? String((rawFormula as { formula: unknown }).formula ?? '')
          : '');
    normalised[key] = { ...(def as unknown as _GlobalFormulaDef), formula: formulaStr };
  }
  _registeredFormulas = normalised;
  if (typeof window !== 'undefined') {
    (globalThis as Record<string, unknown>).__debugRegisteredFormulas = normalised;
  }
}

/**
 * Get the current global formula registry (read-only snapshot).
 */
export function getRegisteredFormulas(): Record<string, _GlobalFormulaDef> {
  return _registeredFormulas;
}

// ─── Core evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate a formula string against a context object.
 *
 * Supports:
 *   - Plain JS expressions using named scopes: "variables['UUID'] > 0", "collections['UUID']?.data?.total"
 *   - Function calls: "if(variables['UUID'], null, variables['UUID2'])", "sum(1, 2, 3)"
 */
export function evaluateFormula(formula: string | object, context: Record<string, unknown>, ctxGet?: (path: string) => unknown): EvalResult {
  // { "js": "<body>" } — JavaScript binding; route to the JS evaluator
  if (isJsBinding(formula)) {
    return evaluateJsBinding(formula, context);
  }
  // { "formula": "expression" } — wrapper for inline formula; evaluate the inner expression
  if (typeof formula === 'object' && formula !== null && 'formula' in formula) {
    const inner = (formula as { formula: string | object }).formula;
    return evaluateFormula(inner as string | object, context, ctxGet);
  }
  // Non-string, non-formula object — not a supported formula type
  if (typeof formula === 'object' && formula !== null) {
    return { value: null, error: 'Invalid formula' };
  }

  const formulaStr = String(formula);
  if (!formulaStr.trim()) return { value: undefined, error: null };

  // Normalise natural-language operators.
  // Negative lookahead (?!\s*\() preserves `and(...)` / `or(...)` function-call
  // syntax so they are handled by the FORMULA_FNS rewrite pass below instead of
  // being broken into invalid `&&(...)` / `||(...)` JavaScript.
  const resolved = formulaStr.trim()
    .replace(/\band\b(?!\s*\()/g, '&&')
    .replace(/\bor\b(?!\s*\()/g, '||');

  // Rewrite function calls: sum( → __fns__['sum'](
  // Using bracket notation handles reserved keywords like 'if', 'switch'
  // Negative lookbehind (?<![.\w]) prevents matching method calls like Math.max(
  // so "Math.max(0, x)" is NOT rewritten to "Math.__fns__['max'](0, x)" (invalid)
  //
  // JS_KEYWORD_FNS — names that collide with JS reserved keywords (`if`, `switch`).
  // Inside IIFEs (detected by `function` or arrow-function presence), these keywords
  // are likely used as JS statements, not formula-function calls. Rewriting `if(` to
  // `__fns__['if'](` breaks `if(cond) stmt;` syntax → SyntaxError.
  const JS_KEYWORD_FNS = new Set(['if', 'switch']);
  const hasStatementBlock = /\bfunction\s*\(|=>\s*\{/.test(resolved);
  let processed = resolved;
  for (const name of Object.keys(FORMULA_FNS)) {
    if (hasStatementBlock && JS_KEYWORD_FNS.has(name)) continue;
    processed = processed.replace(
      new RegExp(`(?<![.\\w])\\b${name}\\s*\\(`, 'g'),
      `__fns__['${name}'](`
    );
  }

  // Rewrite user-defined global formula calls: formatFullName( → __userFns__['formatFullName'](
  // Uses def.name (not the registry key) so user-created formulas with UUID keys also work.
  // Same negative-lookbehind guard — won't rewrite method calls (obj.formatFullName())
  for (const [, def] of Object.entries(_registeredFormulas)) {
    const fnName = (def as _GlobalFormulaDef)?.name;
    if (!fnName) continue;
    processed = processed.replace(
      new RegExp(`(?<![.\\w])\\b${fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'g'),
      `__userFns__['${fnName}'](`
    );
  }

  // Build userFns wrapper object — keyed by def.name so both UUID-keyed and name-keyed
  // registry entries are callable by their human-readable function name.
  const userFns: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [, def] of Object.entries(_registeredFormulas)) {
    const formulaDef = def as _GlobalFormulaDef;
    const fnName = formulaDef?.name;
    if (!fnName) continue;
    userFns[fnName] = (...args: unknown[]) => {
      const paramCtx: Record<string, unknown> = {};
      (formulaDef.params ?? []).forEach((p, i) => {
        paramCtx[p.name] = args[i];
      });
      const innerCtx = { ...context, parameters: paramCtx };
      const result = evaluateFormula(formulaDef.formula, innerCtx, ctxGet);
      return result.value;
    };
  }

  try {
    // Named scopes: variables['UUID'], collections['UUID'], context.item, route.*, auth.*,
    // _workflow.*, local.data.form.*, _conventions.*, globalContext, pages, theme, event.
    // get('path') is an escape hatch for arbitrary flat-key state access.
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      '__fns__', '__userFns__', '__collections__', '__variables__', '__ctx__', '__globalCtx__', '__pages__', '__theme__', '__event__', '__state__', '__ctxGet__', '__parameters__',
      `"use strict"; ` +
      `const collections = __collections__ ?? {}; ` +
      `const variables = __variables__ ?? {}; ` +
      `const context = __ctx__ ?? {}; ` +
      `const globalContext = __globalCtx__ ?? {}; ` +
      `const pages = __pages__ ?? {}; ` +
      `const theme = __theme__ ?? {}; ` +
      `const event = __event__ ?? {}; ` +
      `const parameters = __parameters__ ?? {}; ` +
      `const route = (__state__ ?? {})['route'] ?? {}; ` +
      `const auth = (__state__ ?? {})['auth'] ?? {}; ` +
      `const _workflow = (__state__ ?? {})['_workflow'] ?? {}; ` +
      `const local = (__state__ ?? {})['local'] ?? {}; ` +
      `const value = (__state__ ?? {})['value']; ` +
      `const get = (p) => { if (!p) return undefined; if (__ctxGet__) return __ctxGet__(p); if (!__state__) return undefined; if (p in __state__) return __state__[p]; const parts = p.split('.'); let c = __state__; for (const k of parts) { if (c == null || typeof c !== 'object') return undefined; c = c[k]; } return c; }; ` +
      `return (${processed});`
    );
    const value = fn(
      FORMULA_FNS,
      userFns,
      (context.collections ?? {}) as Record<string, unknown>,
      (context.variables ?? {}) as Record<string, unknown>,
      (context.context ?? {}) as Record<string, unknown>,
      (context.globalContext ?? {}) as Record<string, unknown>,
      (context.pages ?? {}) as Record<string, unknown>,
      (context.theme ?? {}) as Record<string, unknown>,
      (context.event ?? {}) as Record<string, unknown>,
      context,
      ctxGet ?? null,
      (context.parameters ?? {}) as Record<string, unknown>,
    );
    return { value, error: null };
  } catch (e) {
    // TypeError = accessing a property on undefined/null (e.g. variables['UUID'].field
    // when the variable isn't initialised yet). Treat as undefined — not a formula error.
    if (e instanceof TypeError) return { value: undefined, error: null };
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

/** True when a stored value is a JavaScript binding `{ js: "..." }`. */
export function isJsBoundValue(v: FormulaValue): boolean {
  return v !== null && typeof v === 'object' && typeof (v as Record<string, unknown>).js === 'string';
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
    if (typeof v.js === 'string') return v.js;
    if (typeof v.formula === 'string') return v.formula;
    // Fallback: show raw JSON for JSON Logic or other object conditions so the editor isn't blank
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return String(value);
}
