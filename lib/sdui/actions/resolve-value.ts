/**
 * Value resolution for actions — { var }, { expr }, {{path}} interpolation.
 *
 * {{path}} interpolation in action configs (headers, body params, URLs) is handled here
 * via direct resolveVar calls — it is a separate concern from the formula evaluator.
 */

import { evaluateFormula } from '../formula-evaluator';
import { resolveVar } from '../formula-utils';


export function interpolateUrl(
  url: string,
  get: (path: string, scope?: Record<string, unknown>) => unknown,
  scope?: Record<string, unknown>
): string {
  if (!url || typeof url !== 'string') return url;
  return url.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const val = get(path.trim(), scope);
    return val != null ? String(val) : '';
  });
}

export function resolveActionValue(
  value: unknown,
  get: (path: string, scope?: Record<string, unknown>) => unknown,
  scope?: Record<string, unknown>,
  defaultNum = 1
): number {
  if (value == null) return defaultNum;
  if (typeof value === 'object' && value && 'var' in value) {
    const v = (value as { var: string | [string, unknown] }).var;
    const path = Array.isArray(v) ? String(v[0]) : String(v);
    const fallback = Array.isArray(v) ? v[1] : undefined;
    const resolved = get(path, scope);
    return Number(resolved ?? fallback ?? defaultNum);
  }
  return Number(value ?? defaultNum);
}

/**
 * Recursively resolves all values in a payload using resolveValue.
 * Handles { var: path }, { var: [path, fallback] }, { expr: ... }, and {{interpolation}}.
 */
export function resolvePayload(
  payload: Record<string, unknown>,
  get: (path: string, scope?: Record<string, unknown>) => unknown,
  scope?: Record<string, unknown>,
  fullState?: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = resolveValue(value, get, scope, fullState);
  }
  return result;
}

/**
 * Resolves a value that may be a path reference or formula expression.
 * - { var: "path" } or { var: ["path", fallback] } → get(path, scope) or fallback
 * - { expr: "formula" } → evaluateFormula(expr, fullState) when fullState provided
 * - Strings with {{path}} → resolved via direct resolveVar (NOT evaluateFormula)
 * - Recurses into plain objects and arrays.
 */
export function resolveValue(
  value: unknown,
  get: (path: string, scope?: Record<string, unknown>) => unknown,
  scope?: Record<string, unknown>,
  fullState?: Record<string, unknown>
): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, get, scope, fullState));
  }
  // Handle {{path}} interpolation in action config strings (headers, body params, etc.)
  // Uses direct resolveVar — independent from the formula evaluator.
  if (typeof value === 'string' && value.includes('{{') && fullState) {
    const stateWithScope = scope ? { ...fullState, ...scope } : fullState;
    // Single {{path}} — return the resolved value directly (preserves type)
    const single = value.match(/^\{\{([^}]+)\}\}$/);
    if (single) return resolveVar(single[1].trim(), stateWithScope) ?? null;
    // Embedded {{path}} in a string — interpolate into string
    return value.replace(/\{\{([^}]+)\}\}/g, (_, p) => {
      const v = resolveVar(p.trim(), stateWithScope);
      return v != null ? String(v) : '';
    });
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('var' in obj) {
      const v = (obj as { var: string | [string, unknown] }).var;
      const path = Array.isArray(v) ? String(v[0]) : String(v);
      const fallback = Array.isArray(v) ? v[1] : undefined;
      const resolved = get(path, scope);
      return resolved !== undefined && resolved !== null ? resolved : fallback;
    }
    if ('expr' in obj && fullState) {
      try {
        const stateForExpr = {
          ...fullState,
          ...(scope ?? {}),
          _timestamp: Date.now(),
          _date: new Date().toISOString().slice(0, 10),
        };
        const exprVal = (obj as { expr: string | object }).expr;
        return evaluateFormula(exprVal, stateForExpr).value;
      } catch {
        return undefined;
      }
    }
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      resolved[k] = resolveValue(v, get, scope, fullState);
    }
    // If the resolved single-key object is evaluable as a formula, try it
    const keys = Object.keys(resolved);
    if (keys.length === 1 && fullState) {
      try {
        const evalResult = evaluateFormula(obj as object, fullState ?? {});
        if (!evalResult.error) return evalResult.value;
      } catch {
        /* fall through */
      }
    }
    return resolved;
  }
  return value;
}
