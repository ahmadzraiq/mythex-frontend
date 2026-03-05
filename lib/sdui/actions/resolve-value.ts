/**
 * Value resolution for actions - { var }, { expr }, interpolation
 */

import { evaluateFormula } from '../formula-evaluator';


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
 * Resolves a value that may be a path reference or JSON Logic expression.
 * - { var: "path" } or { var: ["path", fallback] } → get(path, scope) or fallback
 * - { expr: jsonLogic } → jsonLogic.apply(expr, fullState) when fullState provided
 * - Strings with {{path}} → interpolated via get
 * - Recurses into objects and arrays.
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
  // Handle formula strings with {{path}} interpolation
  if (typeof value === 'string' && value.includes('{{') && fullState) {
    const stateWithScope = scope ? { ...fullState, ...scope } : fullState;
    const result = evaluateFormula(value, stateWithScope);
    if (!result.error) return result.value;
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
    // Legacy: single-key object that is a json-logic op (e.g. { "var": "path" } already handled above)
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      resolved[k] = resolveValue(v, get, scope, fullState);
    }
    // If the resolved object looks like a json-logic / formula object, evaluate it
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
