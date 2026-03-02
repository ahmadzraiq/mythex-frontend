/**
 * Shared formula evaluator — used by both the SDUI runtime engine and the builder formula editor.
 *
 * Replaces json-logic-js for all expression evaluation.
 * Formula strings use plain JavaScript expressions with {{path}} variable interpolation.
 *
 * Examples:
 *   "cart.count > 0"
 *   "{{cart.totalQuantity}} item(s)"
 *   "if(product.loading, null, product.title)"
 *   "formatCurrency(cart.total / 100, 'USD')"
 */

export type FormulaValue = string | number | boolean | object | null;
export type EvalResult = { value: unknown; error: null } | { value: null; error: string };

// ─── Variable resolution ───────────────────────────────────────────────────────

function getNestedVal(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function resolveVar(path: string, context: Record<string, unknown>): unknown {
  // Try flat key first (Zustand stores flat keys like "product.variants")
  if (path in context) return context[path];
  // Try nested traversal
  return getNestedVal(context, path);
}

// ─── Function registry ─────────────────────────────────────────────────────────

// Helper shared by groupBy implementations
function getNested(obj: unknown, path: string): unknown {
  if (!path || typeof obj !== 'object' || obj == null) return undefined;
  return path.split('.').reduce(
    (o: unknown, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    obj
  );
}

export const FORMULA_FNS: Record<string, (...args: unknown[]) => unknown> = {
  // ── CONDITIONAL ──────────────────────────────────────────────────────────────
  if: (cond, v1, v2) => cond ? v1 : v2,
  ifEmpty: (v, fallback) => (v == null || v === '' || (Array.isArray(v) && v.length === 0)) ? fallback : v,
  not: (v) => !v,
  switch: (...args) => {
    const [expr, ...rest] = args;
    for (let i = 0; i < rest.length - 1; i += 2) {
      if (expr === rest[i]) return rest[i + 1];
    }
    return rest[rest.length - 1];
  },

  // ── MATH ─────────────────────────────────────────────────────────────────────
  average: (...args) => {
    const nums = args.flat(1) as number[];
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  },
  rollupSum: (arr, key) => (arr as Record<string, number>[]).reduce((s, o) => s + (o[key as string] ?? 0), 0),
  round: (n, p = 0) => Math.round((n as number) * Math.pow(10, p as number)) / Math.pow(10, p as number),
  sum: (...args) => (args.flat(1) as number[]).reduce((a, b) => a + b, 0),
  toNumber: (v) => Number(v),
  ceil: (n) => Math.ceil(Number(n) || 0),
  floor: (n) => Math.floor(Number(n) || 0),
  max: (...args) => Math.max(...(args.flat(1) as number[])),
  min: (...args) => Math.min(...(args.flat(1) as number[])),

  // ── ARRAY ─────────────────────────────────────────────────────────────────────
  add: (arr, ...vals) => [...(arr as unknown[]), ...vals],
  contains: (a, v) => Array.isArray(a) ? a.includes(v) : typeof a === 'string' ? (a as string).includes(v as string) : false,
  createArray: (...args) => args,
  compare: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  distinct: (arr) => [...new Set(arr as unknown[])],
  filterByKey: (arr, key, val) => (arr as Record<string, unknown>[]).filter(o => o[key as string] === val),
  findIndex: (arr, val) => (arr as unknown[]).indexOf(val),
  findIndexByKey: (arr, key, val) => (arr as Record<string, unknown>[]).findIndex(o => o[key as string] === val),
  getByIndex: (arr, i) => (arr as unknown[])[i as number],
  groupBy: (items, groupKeyPath, groupIdPath?) => {
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
  },
  join: (arr, sep = ',') => (arr as unknown[]).join(sep as string),
  length: (arr) => Array.isArray(arr) ? arr.length : typeof arr === 'string' ? arr.length : 0,
  lookup: (arr, val, key = 'id') => (arr as Record<string, unknown>[]).find(o => o[key as string] === val),
  lookupArray: (arr, vals, key) => (arr as Record<string, unknown>[]).filter(o => (vals as unknown[]).includes(o[key as string])),
  map: (arr, key) => (arr as Record<string, unknown>[]).map(o => o[key as string]),
  merge: (...arrs) => (arrs as unknown[][]).flat(1),
  prepend: (arr, ...vals) => [...vals, ...(arr as unknown[])],
  remove: (arr, val) => (arr as unknown[]).filter(v => v !== val),
  removeByIndex: (arr, i) => (arr as unknown[]).filter((_, idx) => idx !== i),
  removeByKey: (arr, key, val) => (arr as Record<string, unknown>[]).filter(o => o[key as string] !== val),
  reverse: (arr) => [...(arr as unknown[])].reverse(),
  rollup: (arr, key, distinct = false) => {
    const vals = (arr as Record<string, unknown>[]).map(o => o[key as string]);
    return distinct ? [...new Set(vals)] : vals;
  },
  slice: (arr, s, e?) => (arr as unknown[]).slice(s as number, e as number),
  sort: (arr, order = 'asc', key?) => {
    const a = [...(arr as unknown[])];
    a.sort((x, y) => {
      const vx = key ? (x as Record<string, unknown>)[key as string] : x;
      const vy = key ? (y as Record<string, unknown>)[key as string] : y;
      return (order === 'asc' ? 1 : -1) * (vx! > vy! ? 1 : vx! < vy! ? -1 : 0);
    });
    return a;
  },
  flat: (arr, depth = 1) => (arr as unknown[]).flat(depth as number),

  // Custom array ops (ported from computed-runner)
  at: (arr, index) => {
    const a = (arr as unknown[]) ?? [];
    const i = Math.max(0, Math.min(Math.floor(Number(index) ?? 0), a.length - 1));
    return a[i];
  },
  toggleInArray: (arr, value) => {
    const a = (arr as unknown[]) ?? [];
    const v = value;
    const has = a.some(x => x === v || (typeof x === 'string' && typeof v === 'string' && x === v));
    if (has) return a.filter(x => !(x === v || (typeof x === 'string' && typeof v === 'string' && x === v)));
    return [...a, v];
  },
  arrayIncludes: (arr, value) => {
    const a = (arr as unknown[]) ?? [];
    return a.some(x => x === value || (typeof x === 'string' && typeof value === 'string' && x === value));
  },
  arrayLength: (arr) => Array.isArray(arr) ? arr.length : 0,
  reverseArray: (arr) => [...((arr as unknown[]) ?? [])].reverse(),
  filterExcludeByFieldAndSlice: (items, excludeField, excludeValue, limit) => {
    const arr = (items as Record<string, unknown>[]) ?? [];
    const field = String(excludeField ?? 'productId').trim();
    const val = excludeValue;
    const max = Number(limit ?? 12);
    return arr.filter(i => i && (i as Record<string, unknown>)[field] !== val).slice(0, max);
  },
  findItemById: (items, id, idField?) => {
    const arr = (items as Record<string, unknown>[]) ?? [];
    const target = String(id ?? '');
    const field = String(idField ?? 'id').trim();
    return arr.find(x => x && String((x as Record<string, unknown>)[field] ?? '') === target) ?? null;
  },
  findItemByOptionsMatch: (items, optionGroups, selectedOptions, optionsKey?, optionIdKey?, groupIdKey?, returnField?) => {
    const arr = (items as Record<string, unknown>[]) ?? [];
    const groups = (optionGroups as Record<string, unknown>[]) ?? [];
    const sel = (selectedOptions as Record<string, string>) ?? {};
    const optKey = String(optionsKey ?? 'options').trim();
    const optIdKey = String(optionIdKey ?? 'id').trim();
    const grpIdKey = String(groupIdKey ?? 'id').trim();
    const retKey = String(returnField ?? 'id').trim();
    if (arr.length === 1) return (arr[0] as Record<string, unknown>)?.[retKey] ?? null;
    const selectedIds = groups.map(g => sel[String((g as Record<string, unknown>)[grpIdKey] ?? '')]).filter(Boolean);
    if (selectedIds.length !== groups.length) return null;
    const match = arr.find(item => {
      const opts = ((item as Record<string, unknown>)[optKey] as Record<string, unknown>[]) ?? [];
      const itemOptIds = opts.map(o => String((o as Record<string, unknown>)[optIdKey] ?? ''));
      return selectedIds.every(id => itemOptIds.includes(id));
    });
    return (match && (match as Record<string, unknown>)[retKey]) ?? null;
  },
  findFirstByPreference: (items, preferPath?, valuePath?) => {
    const arr = (items as Record<string, unknown>[]) ?? [];
    const prefer = String(preferPath ?? 'parent.id').trim();
    const value = String(valuePath ?? 'slug').trim();
    if (arr.length === 0) return '';
    const withPrefer = arr.find(c => getNested(c as Record<string, unknown>, prefer) != null);
    const item = withPrefer ?? arr[0];
    return (item && getNested(item as Record<string, unknown>, value)) ?? '';
  },
  lookupInArray: (arr, keyField, keyValue, returnField) => {
    const a = (arr as Record<string, unknown>[]) ?? [];
    const kf = String(keyField ?? '').trim();
    const kv = keyValue;
    const rf = String(returnField ?? '').trim();
    if (!kf) return typeof kv === 'string' ? kv : '';
    const found = a.find(item => item && String(item[kf] ?? '') === String(kv ?? ''));
    if (!found || !rf) return typeof kv === 'string' ? kv : '';
    const val = found[rf];
    return val != null ? String(val) : (typeof kv === 'string' ? kv : '');
  },
  paginationPages: (totalItems, collectionSkip, pageSize, delta?) => {
    const total = Number(totalItems ?? 0);
    const skip = Number(collectionSkip ?? 0);
    const size = Math.max(1, Number(pageSize ?? 12));
    const totalPages = Math.max(1, Math.ceil(total / size));
    const currentPage = Math.min(totalPages, Math.floor(skip / size) + 1);
    const d = Math.max(0, Number(delta ?? 2));
    const range: number[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - d && i <= currentPage + d)) range.push(i);
    }
    const rangeWithDots: (number | string)[] = [];
    let prev = 0;
    for (const i of range) {
      if (prev && i - prev > 1) rangeWithDots.push('...');
      rangeWithDots.push(i);
      prev = i;
    }
    return rangeWithDots;
  },

  // ── TEXT ──────────────────────────────────────────────────────────────────────
  capitalize: (s) => String(s).replace(/\b\w/g, c => c.toUpperCase()),
  // "cat" is the json-logic string concatenation op — keep as alias for migration
  cat: (...args) => args.map(a => (a == null ? '' : String(a))).join(''),
  concatenate: (...args) => args.map(a => (a == null ? '' : String(a))).join(''),
  indexOf: (s, sub) => String(s).indexOf(sub as string),
  lower: (s) => String(s).toLowerCase(),
  split: (s, sep) => String(s).split(sep as string),
  subText: (s, start, end?) => String(s).slice(start as number, end as number),
  textLength: (s) => String(s).length,
  toText: (v) => String(v),
  uppercase: (s) => String(s).toUpperCase(),

  // ── OBJECT ────────────────────────────────────────────────────────────────────
  createObject: (...args) => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < args.length - 1; i += 2) o[args[i] as string] = args[i + 1];
    return o;
  },
  getKeyValue: (o, key) => (o as Record<string, unknown>)[key as string],
  keys: (o) => Object.keys(o as object),
  omit: (o, ...ks) => {
    const r = { ...(o as object) };
    for (const k of ks) delete (r as Record<string, unknown>)[k as string];
    return r;
  },
  pick: (o, ...ks) => Object.fromEntries(ks.map(k => [k, (o as Record<string, unknown>)[k as string]])),
  setKeyValue: (o, key, val) => ({ ...(o as object), [key as string]: val }),
  values: (o) => Object.values(o as object),

  // ── UTILS ─────────────────────────────────────────────────────────────────────
  toBool: (v) => Boolean(v),

  // ── FORMATTING ────────────────────────────────────────────────────────────────
  formatCurrency: (num, divisorOrCurrency) => {
    let n = Number(num) || 0;
    let currencyCode = 'USD';
    if (typeof divisorOrCurrency === 'number' && divisorOrCurrency > 0) {
      n = n / divisorOrCurrency;
    } else if (typeof divisorOrCurrency === 'string' && divisorOrCurrency.trim()) {
      currencyCode = divisorOrCurrency.trim();
    }
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(n);
    } catch {
      return `$${n.toFixed(2)}`;
    }
  },

  // ── LOOKUP MAP ────────────────────────────────────────────────────────────────
  lookupMap: (map, key, defaultVal?) => {
    const m = (map as Record<string, unknown>) ?? {};
    const k = String(key ?? '');
    const val = k ? m[k] : undefined;
    return val !== undefined && val !== null ? val : defaultVal;
  },
  getFromMap: (map, key) => {
    const m = (map as Record<string, unknown>) ?? {};
    const k = String(key ?? '');
    const v = k ? m[k] : undefined;
    return v !== undefined && v !== null ? v : null;
  },
};

// ─── Core evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate a formula string against a context object.
 *
 * Supports:
 *   - Plain JS expressions: "cart.count > 0", "42 * 2"
 *   - Variable interpolation: "{{cart.total}} items"
 *   - Function calls: "if(loading, null, title)", "sum(1, 2, 3)"
 *   - Legacy json-logic objects (passed through as-is for backward compat)
 */
export function evaluateFormula(formula: string | object, context: Record<string, unknown>): EvalResult {
  // Legacy: json-logic object passed directly — evaluate inline using the fn registry
  if (typeof formula === 'object' && formula !== null) {
    return evaluateJsonLogicObject(formula as Record<string, unknown>, context);
  }

  const formulaStr = String(formula);
  if (!formulaStr.trim()) return { value: undefined, error: null };

  // Normalise natural-language operators
  let resolved = formulaStr.trim()
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||');

  // Replace {{path}} → resolved JSON value
  resolved = resolved.replace(/\{\{([^}]+)\}\}/g, (_m, p) => {
    const v = resolveVar(p.trim(), context);
    return JSON.stringify(v ?? null);
  });

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
    // eslint-disable-next-line no-new-func
    const fn = new Function('__fns__', `"use strict"; return (${processed});`);
    const value = fn(FORMULA_FNS);
    return { value, error: null };
  } catch {
    // Fall back: try resolving as a bare variable path
    const varVal = resolveVar(formulaStr.trim(), context);
    if (varVal !== undefined) return { value: varVal, error: null };
    return { value: null, error: 'Invalid formula' };
  }
}

/**
 * Evaluate a legacy json-logic object using the formula function registry.
 * Handles the common ops used in config files: var, ==, !=, >, <, >=, <=,
 * !, and, or, +, -, *, /, %, cat, if, max, min, and all custom ops.
 */
function evalNode(node: unknown, context: Record<string, unknown>): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(v => evalNode(v, context));

  const obj = node as Record<string, unknown>;

  // { "var": "path" } or { "var": ["path", default] }
  if ('var' in obj) {
    const v = obj.var;
    const path = Array.isArray(v) ? String(v[0]) : String(v);
    const fallback = Array.isArray(v) ? v[1] : undefined;
    if (!path) return context;
    const val = resolveVar(path, context);
    return val !== undefined && val !== null ? val : fallback;
  }

  // Get operator and args
  const [op, rawArgs] = Object.entries(obj)[0];
  const args = Array.isArray(rawArgs) ? rawArgs.map(a => evalNode(a, context)) : [evalNode(rawArgs, context)];

  // Built-in arithmetic / comparison ops
  switch (op) {
    case '==': return args[0] == args[1];  // eslint-disable-line eqeqeq
    case '===': return args[0] === args[1];
    case '!=': return args[0] != args[1];  // eslint-disable-line eqeqeq
    case '!==': return args[0] !== args[1];
    case '>': return (args[0] as number) > (args[1] as number);
    case '>=': return (args[0] as number) >= (args[1] as number);
    case '<': return (args[0] as number) < (args[1] as number);
    case '<=': return (args[0] as number) <= (args[1] as number);
    case '+': return args.reduce((a: number, b) => a + (Number(b) || 0), 0);
    case '-': return args.length === 1 ? -(args[0] as number) : (args[0] as number) - (args[1] as number);
    case '*': return (args[0] as number) * (args[1] as number);
    case '/': return (args[0] as number) / (args[1] as number);
    case '%': return (args[0] as number) % (args[1] as number);
    case '!': return !args[0];
    case '!!': return !!args[0];
    // Short-circuit: evaluate against original context
    case 'and': {
      const rawArr = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
      for (const a of rawArr) {
        const v = evalNode(a, context);
        if (!v) return v;
        // return last truthy
      }
      return evalNode(rawArr[rawArr.length - 1], context);
    }
    case 'or': {
      const rawArr = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
      for (const a of rawArr) {
        const v = evalNode(a, context);
        if (v) return v;
      }
      return evalNode(rawArr[rawArr.length - 1], context);
    }
    case 'if':
    case '?:': {
      // if(cond, then, else) or ternary chain
      const rawArr = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
      for (let i = 0; i < rawArr.length - 1; i += 2) {
        if (evalNode(rawArr[i], context)) return evalNode(rawArr[i + 1], context);
      }
      return rawArr.length % 2 === 0 ? null : evalNode(rawArr[rawArr.length - 1], context);
    }
    case 'merge': return (args as unknown[][]).flat(1);
    case 'in': return Array.isArray(args[1]) ? args[1].includes(args[0]) : false;
    case 'cat': return (FORMULA_FNS.cat as (...a: unknown[]) => unknown)(...args);
    case 'substr': {
      const s = String(args[0]);
      const start = args[1] as number;
      const len = args[2] as number | undefined;
      return len !== undefined ? s.substr(start, len) : s.substr(start);
    }
    case 'max': return Math.max(...(args as number[]));
    case 'min': return Math.min(...(args as number[]));
    case 'reduce': {
      // json-logic reduce: [array, logic, initial]
      const arr = Array.isArray(rawArgs) ? rawArgs[0] : null;
      const logic = Array.isArray(rawArgs) ? rawArgs[1] : null;
      const initial = Array.isArray(rawArgs) ? rawArgs[2] : null;
      const evalArr = evalNode(arr, context);
      let acc = evalNode(initial, context);
      for (const item of (evalArr as unknown[]) ?? []) {
        acc = evalNode(logic, { ...context, current: item, accumulator: acc });
      }
      return acc;
    }
    case 'map': {
      const arr = Array.isArray(rawArgs) ? evalNode(rawArgs[0], context) : [];
      const logic = Array.isArray(rawArgs) ? rawArgs[1] : rawArgs;
      return ((arr as unknown[]) ?? []).map(item => evalNode(logic, { ...context, current: item }));
    }
    case 'filter': {
      const arr = Array.isArray(rawArgs) ? evalNode(rawArgs[0], context) : [];
      const logic = Array.isArray(rawArgs) ? rawArgs[1] : rawArgs;
      return ((arr as unknown[]) ?? []).filter(item => evalNode(logic, { ...context, current: item }));
    }
    case 'all': {
      const arr = Array.isArray(rawArgs) ? evalNode(rawArgs[0], context) : [];
      const logic = Array.isArray(rawArgs) ? rawArgs[1] : rawArgs;
      return ((arr as unknown[]) ?? []).every(item => evalNode(logic, { ...context, current: item }));
    }
    case 'some': {
      const arr = Array.isArray(rawArgs) ? evalNode(rawArgs[0], context) : [];
      const logic = Array.isArray(rawArgs) ? rawArgs[1] : rawArgs;
      return ((arr as unknown[]) ?? []).some(item => evalNode(logic, { ...context, current: item }));
    }
    case 'none': {
      const arr = Array.isArray(rawArgs) ? evalNode(rawArgs[0], context) : [];
      const logic = Array.isArray(rawArgs) ? rawArgs[1] : rawArgs;
      return !((arr as unknown[]) ?? []).some(item => evalNode(logic, { ...context, current: item }));
    }
    case 'log': console.log(args[0]); return args[0];
    case 'missing': {
      const keys = Array.isArray(rawArgs) ? rawArgs.flat() : [rawArgs];
      return keys.filter(k => resolveVar(String(k), context) == null);
    }
    case 'missing_some': {
      const need = Number(Array.isArray(rawArgs) ? rawArgs[0] : 1);
      const keys = Array.isArray(rawArgs) && Array.isArray(rawArgs[1]) ? rawArgs[1] : [];
      const missing = keys.filter(k => resolveVar(String(evalNode(k, context)), context) == null);
      return missing.length >= need ? missing : [];
    }
    default: {
      // Custom op from FORMULA_FNS
      const fn = FORMULA_FNS[op];
      if (fn) return fn(...args);
      console.warn('[SDUI] Unknown json-logic op:', op);
      return null;
    }
  }
}

function evaluateJsonLogicObject(obj: Record<string, unknown>, context: Record<string, unknown>): EvalResult {
  try {
    const value = evalNode(obj, context);
    return { value, error: null };
  } catch (err) {
    return { value: null, error: String(err) };
  }
}

// ─── Value helpers ────────────────────────────────────────────────────────────

export function isBoundValue(v: FormulaValue): boolean {
  if (typeof v === 'string' && v.includes('{{')) return true;
  if (v !== null && typeof v === 'object') return true;
  return false;
}

/** Convert editable formula string → storage format */
export function formulaToStoredValue(formula: string): FormulaValue {
  const trimmed = formula.trim();
  if (!trimmed) return '';
  // Simple variable reference (no parens, no operators, no spaces): store as {{path}}
  const isSimpleVar = /^[\w.[\]]+$/.test(trimmed);
  if (isSimpleVar) return `{{${trimmed}}}`;
  // Template string with {{}} already: store as-is
  if (trimmed.includes('{{') && !trimmed.match(/[^}]\(/)) return trimmed;
  // Complex formula: store as { formula: "..." }
  return { formula: trimmed };
}

/** Convert stored value → editable formula string */
export function storedValueToFormula(value: FormulaValue): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    // {{path}} → path (simple var)
    const m = value.match(/^\{\{([^}]+)\}\}$/);
    if (m) return m[1];
    return value;
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.formula === 'string') return v.formula;
    // Legacy json-logic — show as JSON
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
