/**
 * Formula function registry — extracted from formula-evaluator.ts.
 *
 * Contains the `FORMULA_FNS` object with all built-in and custom functions
 * available in formula expressions (if, sum, formatCurrency, arrayIncludes, etc.).
 *
 * Import from here when you need to add new formula functions or when other
 * modules (validation-utils, computed-runner) need to call specific functions
 * without importing the full evaluator.
 */

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
  and: (...args) => args.every(Boolean),
  or: (...args) => args.some(Boolean),
  equal: (a, b) => a === b,
  notEqual: (a, b) => a !== b,
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
  abs: (n) => Math.abs(Number(n) || 0),
  ceil: (n) => Math.ceil(Number(n) || 0),
  clamp: (n, lo, hi) => Math.min(Math.max(Number(n) || 0, Number(lo) || 0), Number(hi) || 0),
  floor: (n) => Math.floor(Number(n) || 0),
  max: (...args) => Math.max(...(args.flat(1) as number[])),
  min: (...args) => Math.min(...(args.flat(1) as number[])),
  mod: (a, b) => (Number(a) || 0) % (Number(b) || 1),
  pow: (base, exp) => Math.pow(Number(base) || 0, Number(exp) || 1),
  sqrt: (n) => Math.sqrt(Number(n) || 0),

  // ── ARRAY ─────────────────────────────────────────────────────────────────────
  add: (arr, ...vals) => [...(arr as unknown[]), ...vals],
  contains: (a, v) => Array.isArray(a) ? a.includes(v) : typeof a === 'string' ? (a as string).includes(v as string) : false,
  includes: (a, v) => Array.isArray(a) ? (a as unknown[]).includes(v) : typeof a === 'string' ? (a as string).includes(v as string) : false,
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
  // "cat" / "concat" / "concatenate" are string concatenation aliases
  cat: (...args) => args.map(a => (a == null ? '' : String(a))).join(''),
  concat: (...args) => args.map(a => (a == null ? '' : String(a))).join(''),
  concatenate: (...args) => args.map(a => (a == null ? '' : String(a))).join(''),
  indexOf: (s, sub) => String(s).indexOf(sub as string),
  lower: (s) => String(s).toLowerCase(),
  split: (s, sep) => String(s).split(sep as string),
  subText: (s, start, end?) => String(s).slice(start as number, end as number),
  textLength: (s) => String(s).length,
  toText: (v) => String(v),
  toString: (v) => String(v),
  // "string" / "number" — natural aliases the AI commonly generates; map to toText/toNumber
  string: (v) => String(v ?? ''),
  number: (v) => Number(v),
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

  // ── VALIDATION ───────────────────────────────────────────────────────────────
  isEmail: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '')),
  isEmpty: (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0),
  isNotEmpty: (v) => !(v == null || v === '' || (Array.isArray(v) && v.length === 0)),
  hasMinLength: (v, n) => String(v ?? '').length >= Number(n),
  hasMaxLength: (v, n) => String(v ?? '').length <= Number(n),
  isPhone: (v) => /^\+?[\d\s\-().]{7,20}$/.test(String(v ?? '')),
  isUrl: (v) => { try { new URL(String(v)); return true; } catch { return false; } },
  matchesPattern: (v, pattern) => new RegExp(String(pattern)).test(String(v ?? '')),
};
