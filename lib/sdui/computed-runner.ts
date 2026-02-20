/**
 * JSON Logic–based computed state runner.
 * Uses json-logic-js for generic, standards-based expressions.
 * No app-specific reduce types—all logic expressed as JSON Logic.
 */

import jsonLogic from 'json-logic-js';
import { setNestedValue } from './nested-utils';

/** Extract data paths from JSON Logic expr (excludes reduce scope: current, accumulator) */
function extractPathsFromExpr(obj: unknown): string[] {
  if (obj == null) return [];
  if (typeof obj === 'object' && !Array.isArray(obj) && 'var' in obj) {
    const v = (obj as { var: string | [string, unknown] }).var;
    const path = Array.isArray(v) ? String(v[0]) : String(v);
    if (path === 'current' || path === 'accumulator' || path.startsWith('current.')) return [];
    return [path];
  }
  if (typeof obj === 'object') {
    return (Array.isArray(obj) ? obj : Object.values(obj)).flatMap(extractPathsFromExpr);
  }
  return [];
}

/** Root paths that computed reads from (excludes outputs of other computed) */
export function getComputedDeps(computed: ComputedDef[]): string[] {
  const outputs = new Set(computed.map((d) => d.output));
  const allPaths = computed.flatMap((d) => extractPathsFromExpr(d.expr));
  return [...new Set(allPaths.filter((p) => !outputs.has(p)))];
}

// Custom ops for formatting (json-logic has no built-in round/format)
jsonLogic.add_operation('formatCurrency', (num: unknown, currency: unknown) => {
  const n = Math.round(Number(num) || 0);
  const c = String(currency ?? '');
  return c ? `${c} ${n}` : String(n);
});

export type ComputedDef = {
  output: string;
  expr: object; // JSON Logic expression; data = merged state
};

export function runComputed(
  merged: Record<string, unknown>,
  computed: ComputedDef[],
  _config: Record<string, unknown>
): Record<string, unknown> {
  let result = merged;
  for (const def of computed) {
    try {
      const value = jsonLogic.apply(def.expr as object, result);
      result = setNestedValue(result, def.output, value);
    } catch (err) {
      console.error('[SDUI] computed error:', def, err);
    }
  }
  return result;
}
