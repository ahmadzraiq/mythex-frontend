/**
 * store.json computed runner (output/expr).
 * Runs after merge; produces derived values like collectionCurrentPage, sortLabel, resultsHeaderText.
 * Uses json-logic-js. All custom ops are generic and parameterized—no app-specific logic.
 * Distinct from variable-store computed (type/source/path) which handles reduce-style values.
 */

import jsonLogic from 'json-logic-js';

/** Custom JSON Logic ops. Used by AI generators. Add new ops here when extending. */
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

/** Memo cache: output -> { depsValues, outputValue }. Skip jsonLogic.apply when deps unchanged. */
const computedMemo = new Map<string, { depsValues: unknown[]; outputValue: unknown }>();

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

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

// Custom ops for formatting and math (json-logic has no built-in ceil/floor)
jsonLogic.add_operation('ceil', (n: unknown) => Math.ceil(Number(n) || 0));
jsonLogic.add_operation('floor', (n: unknown) => Math.floor(Number(n) || 0));

// Custom ops for formatting (json-logic has no built-in round/format)
jsonLogic.add_operation('formatCurrency', (num: unknown, currency: unknown) => {
  const n = Number(num) || 0;
  const c = String(currency ?? 'USD').trim();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(n);
  } catch {
    return c ? `${c} ${n}` : String(n);
  }
});

// Generic: lookup key in map/object, return value or default (config-driven via engineConventions.sortInputMap)
jsonLogic.add_operation('lookupMap', (map: unknown, key: unknown, defaultVal: unknown) => {
  const m = (map as Record<string, unknown>) ?? {};
  const k = String(key ?? '');
  const val = k ? m[k] : undefined;
  return val !== undefined && val !== null ? val : defaultVal;
});

// Generic: get item at index from array. Args: arr, index.
jsonLogic.add_operation('at', (arr: unknown, index: unknown) => {
  const a = (arr as unknown[]) ?? [];
  const i = Math.max(0, Math.min(Math.floor(Number(index) ?? 0), a.length - 1));
  return a[i];
});

// Generic: find first item where preferPath exists, else first item; return valuePath.
// Args: items, preferPath?, valuePath?
jsonLogic.add_operation('findFirstByPreference', (items: unknown, preferPath?: unknown, valuePath?: unknown) => {
  const arr = (items as Record<string, unknown>[]) ?? [];
  const prefer = String(preferPath ?? 'parent.id').trim();
  const value = String(valuePath ?? 'slug').trim();
  if (arr.length === 0) return '';
  const getNested = (obj: Record<string, unknown>, path: string) =>
    path.split('.').reduce((o: unknown, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
  const withPrefer = arr.find((c) => getNested(c as Record<string, unknown>, prefer) != null);
  const item = withPrefer ?? arr[0];
  return (item && getNested(item as Record<string, unknown>, value)) ?? '';
});

// Generic: filter items where item[excludeField] !== excludeValue, then slice to limit.
// Args: items, excludeField?, excludeValue, limit
jsonLogic.add_operation('filterExcludeByFieldAndSlice', (items: unknown, excludeField: unknown, excludeValue: unknown, limit: unknown) => {
  const arr = (items as Record<string, unknown>[]) ?? [];
  const field = String(excludeField ?? 'productId').trim();
  const val = excludeValue;
  const max = Number(limit ?? 12);
  return arr.filter((i) => i && (i as Record<string, unknown>)[field] !== val).slice(0, max);
});

// Generic: lookup key in map/object. Alias for lookupMap with 2 args (returns null if not found).
jsonLogic.add_operation('getFromMap', (map: unknown, key: unknown) => {
  const m = (map as Record<string, unknown>) ?? {};
  const k = String(key ?? '');
  const v = k ? m[k] : undefined;
  return v !== undefined && v !== null ? v : null;
});

// Generic: find item in array by id field. Returns item or null.
// Args: items, id, idField?
jsonLogic.add_operation('findItemById', (items: unknown, id: unknown, idField?: unknown) => {
  const arr = (items as Record<string, unknown>[]) ?? [];
  const target = String(id ?? '');
  const field = String(idField ?? 'id').trim();
  return arr.find((x) => x && String((x as Record<string, unknown>)[field] ?? '') === target) ?? null;
});

// Generic: find item whose options match selectedOptions (groupId -> optionId). Returns item[returnField] or null.
// Args: items, optionGroups, selectedOptions, optionsKey?, optionIdKey?, groupIdKey?, returnField?
jsonLogic.add_operation('findItemByOptionsMatch', (
  items: unknown,
  optionGroups: unknown,
  selectedOptions: unknown,
  optionsKey?: unknown,
  optionIdKey?: unknown,
  groupIdKey?: unknown,
  returnField?: unknown
) => {
  const arr = (items as Record<string, unknown>[]) ?? [];
  const groups = (optionGroups as Record<string, unknown>[]) ?? [];
  const sel = (selectedOptions as Record<string, string>) ?? {};
  const optKey = String(optionsKey ?? 'options').trim();
  const optIdKey = String(optionIdKey ?? 'id').trim();
  const grpIdKey = String(groupIdKey ?? 'id').trim();
  const retKey = String(returnField ?? 'id').trim();
  if (arr.length === 1) return (arr[0] as Record<string, unknown>)?.[retKey] ?? null;
  const selectedIds = groups.map((g) => sel[String((g as Record<string, unknown>)[grpIdKey] ?? '')]).filter(Boolean);
  if (selectedIds.length !== groups.length) return null;
  const match = arr.find((item) => {
    const opts = ((item as Record<string, unknown>)[optKey] as Record<string, unknown>[]) ?? [];
    const itemOptIds = opts.map((o) => String((o as Record<string, unknown>)[optIdKey] ?? ''));
    return selectedIds.every((id) => itemOptIds.includes(id));
  });
  return (match && (match as Record<string, unknown>)[retKey]) ?? null;
});

// Generic: lookup in array by key field, return display field (or keyValue if not found)
jsonLogic.add_operation('lookupInArray', (arr: unknown, keyField: unknown, keyValue: unknown, returnField: unknown) => {
  const a = (arr as Record<string, unknown>[]) ?? [];
  const kf = String(keyField ?? '').trim();
  const kv = keyValue;
  const rf = String(returnField ?? '').trim();
  if (!kf) return typeof kv === 'string' ? kv : '';
  const found = a.find((item) => item && String(item[kf] ?? '') === String(kv ?? ''));
  if (!found || !rf) return typeof kv === 'string' ? kv : '';
  const val = found[rf];
  return val != null ? String(val) : (typeof kv === 'string' ? kv : '');
});

// Generic: returns page numbers to display with ellipsis: [1, 2, 3, "...", 10].
// Args: totalItems, skip, pageSize, delta? (pages around current, default 2)
jsonLogic.add_operation('paginationPages', (totalItems: unknown, collectionSkip: unknown, pageSize: unknown, delta?: unknown) => {
  const total = Number(totalItems ?? 0);
  const skip = Number(collectionSkip ?? 0);
  const size = Math.max(1, Number(pageSize ?? 12));
  const totalPages = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(totalPages, Math.floor(skip / size) + 1);
  const d = Math.max(0, Number(delta ?? 2));
  const range: number[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - d && i <= currentPage + d)) {
      range.push(i);
    }
  }
  const rangeWithDots: (number | string)[] = [];
  let prev = 0;
  for (const i of range) {
    if (prev && i - prev > 1) rangeWithDots.push('...');
    rangeWithDots.push(i);
    prev = i;
  }
  return rangeWithDots;
});

// Generic: group array by key path. Args: items, groupKeyPath, groupIdPath?
// Returns: [{ key, id?, items }] — key from groupKeyPath, id from groupIdPath of first item, items = grouped array
function getNested(obj: unknown, path: string): unknown {
  if (!path || typeof obj !== 'object' || obj == null) return undefined;
  return path.split('.').reduce((o: unknown, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
jsonLogic.add_operation('groupBy', (items: unknown, groupKeyPath: unknown, groupIdPath?: unknown) => {
  const arr = (items as Record<string, unknown>[]) ?? [];
  const keyPath = String(groupKeyPath ?? '').trim();
  const idPath = groupIdPath != null ? String(groupIdPath).trim() : undefined;
  const map = new Map<string, { key: string; id?: string; items: unknown[] }>();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const key = String(getNested(item, keyPath) ?? '');
    if (!map.has(key)) {
      const id = idPath ? getNested(item, idPath) : undefined;
      map.set(key, { key, id: id != null ? String(id) : undefined, items: [] });
    }
    map.get(key)!.items.push(item);
  }
  return [...map.values()];
});

// Generic: toggle value in array — add if absent, remove if present.
jsonLogic.add_operation('toggleInArray', (arr: unknown, value: unknown) => {
  const a = (arr as unknown[]) ?? [];
  const v = value;
  const has = a.some((x) => x === v || (typeof x === 'string' && typeof v === 'string' && x === v));
  if (has) return a.filter((x) => x !== v && !(typeof x === 'string' && typeof v === 'string' && x === v));
  return [...a, v];
});

// Generic: check if array includes value.
jsonLogic.add_operation('arrayIncludes', (arr: unknown, value: unknown) => {
  const a = (arr as unknown[]) ?? [];
  return a.some((x) => x === value || (typeof x === 'string' && typeof value === 'string' && x === value));
});

// Generic: array length.
jsonLogic.add_operation('arrayLength', (arr: unknown) => {
  return Array.isArray(arr) ? arr.length : 0;
});

// Generic: reverse array. Args: arr. Returns new array in reverse order.
jsonLogic.add_operation('reverseArray', (arr: unknown) => {
  const a = (arr as unknown[]) ?? [];
  return [...a].reverse();
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
      const deps = extractPathsFromExpr(def.expr);
      const currentValues = deps.map((p) => getNestedValue(result, p));
      const cached = computedMemo.get(def.output);
      let value: unknown;
      if (cached && arraysEqual(cached.depsValues, currentValues)) {
        value = cached.outputValue;
      } else {
        value = jsonLogic.apply(def.expr as object, result);
        computedMemo.set(def.output, { depsValues: currentValues, outputValue: value });
      }
      result = setNestedValue(result, def.output, value);
    } catch (err) {
      console.error('[SDUI] computed error:', def, err);
    }
  }
  return result;
}
