/**
 * store.json computed runner (output/expr).
 * Runs after merge; produces derived values like collectionCurrentPage, sortLabel, resultsHeaderText.
 * Uses formula-evaluator. All ops are generic and parameterized—no app-specific logic.
 * Distinct from variable-store computed (type/source/path) which handles reduce-style values.
 */

import { evaluateFormula } from './formula-evaluator';

/** Custom ops available in formulas. Used by AI generators. Add new ops here when extending. */
export const JSON_LOGIC_CUSTOM_OPS = [
  'ceil',
  'floor',
  'formatCurrency',
  'lookupMap',
  'at',
  'findFirstByPreference',
  'filterExcludeByFieldAndSlice',
  'getFromMap',
  'findItemById',
  'findItemByOptionsMatch',
  'lookupInArray',
  'paginationPages',
  'groupBy',
  'toggleInArray',
  'arrayIncludes',
  'arrayLength',
  'reverseArray',
] as const;
import { getNestedValue, setNestedValue } from './nested-utils';

/** Memo cache: output -> { depsValues, outputValue }. Skip re-evaluation when deps unchanged. */
const computedMemo = new Map<string, { depsValues: unknown[]; outputValue: unknown }>();

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Extract data paths from an expr (json-logic object OR formula string).
 *  Used for dependency tracking / memoization. */
function extractPathsFromExpr(expr: unknown): string[] {
  if (expr == null) return [];
  // Formula string: extract {{path}} references
  if (typeof expr === 'string') {
    const matches = [...expr.matchAll(/\{\{([^}]+)\}\}/g)];
    return matches
      .map(m => m[1].trim())
      .filter(p => p && p !== 'current' && p !== 'accumulator' && !p.startsWith('current.'));
  }
  // Legacy json-logic object: walk { "var": "path" } nodes
  if (typeof expr === 'object') {
    if (!Array.isArray(expr) && 'var' in (expr as Record<string, unknown>)) {
      const v = (expr as { var: string | [string, unknown] }).var;
      const path = Array.isArray(v) ? String(v[0]) : String(v);
      if (path === 'current' || path === 'accumulator' || path.startsWith('current.')) return [];
      return [path];
    }
    return (Array.isArray(expr) ? expr : Object.values(expr as object)).flatMap(extractPathsFromExpr);
  }
  return [];
}

/** Root paths that computed reads from (excludes outputs of other computed) */
export function getComputedDeps(computed: ComputedDef[]): string[] {
  const outputs = new Set(computed.map((d) => d.output));
  const allPaths = computed.flatMap((d) => extractPathsFromExpr(d.expr));
  return [...new Set(allPaths.filter((p) => !outputs.has(p)))];
}

export type ComputedDef = {
  output: string;
  /** Formula string or legacy json-logic object; data = merged state */
  expr: string | object;
};

export function runComputed(
  merged: Record<string, unknown>,
  computed: ComputedDef[],
  _config: Record<string, unknown>
): Record<string, unknown> {
  let result = merged;
  for (const def of computed) {
    try {
      const deps = extractPathsFromExpr(def.expr);
      const currentValues = deps.map((p) => getNestedValue(result, p));
      const cached = computedMemo.get(def.output);
      let value: unknown;
      if (cached && arraysEqual(cached.depsValues, currentValues)) {
        value = cached.outputValue;
      } else {
        const evalResult = evaluateFormula(def.expr, result);
        value = evalResult.value;
        computedMemo.set(def.output, { depsValues: currentValues, outputValue: value });
      }
      result = setNestedValue(result, def.output, value);
    } catch (err) {
      console.error('[SDUI] computed error:', def, err);
    }
  }
  return result;
}
