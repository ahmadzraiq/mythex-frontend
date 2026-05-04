/**
 * utils-template.ts — Generate the lib/utils.ts file for the exported app.
 *
 * This is a clean port of formula-functions.ts from the engine,
 * renamed to developer-idiomatic names (no "formula" terminology).
 * Key renames:
 *   FORMULA_FNS.if     → ifThen   (reserved word)
 *   FORMULA_FNS.switch → switchOn (reserved word)
 */

import type { EmittedFile } from '../types';

export function emitUtilsTs(): EmittedFile {
  const content = `/**
 * lib/utils.ts — Helper utilities for formatting, math, arrays, and logic.
 *
 * All functions are pure and have no dependencies on the builder engine.
 */

// ── Internal helpers ──────────────────────────────────────────────────────────

function getNested(obj: unknown, path: string): unknown {
  if (!path || typeof obj !== 'object' || obj == null) return undefined;
  return path.split('.').reduce(
    (o: unknown, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

// ── Conditional ───────────────────────────────────────────────────────────────

/** Ternary: if cond is truthy return v1, else v2 */
export const ifThen = (cond: unknown, v1: unknown, v2: unknown): unknown => (cond ? v1 : v2);
export const ifEmpty = (v: unknown, fallback: unknown): unknown =>
  v == null || v === '' || (Array.isArray(v) && v.length === 0) ? fallback : v;
export const not = (v: unknown): boolean => !v;
export const and = (...args: unknown[]): boolean => args.every(Boolean);
export const or = (...args: unknown[]): boolean => args.some(Boolean);
export const equal = (a: unknown, b: unknown): boolean => a === b;
export const notEqual = (a: unknown, b: unknown): boolean => a !== b;
/** Switch/case: switchOn(expr, case1, val1, case2, val2, ..., defaultVal) */
export const switchOn = (...args: unknown[]): unknown => {
  const [expr, ...rest] = args;
  for (let i = 0; i < rest.length - 1; i += 2) {
    if (expr === rest[i]) return rest[i + 1];
  }
  return rest[rest.length - 1];
};

// ── Math ──────────────────────────────────────────────────────────────────────

export const average = (...args: unknown[]): number => {
  const nums = args.flat(1) as number[];
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};
export const rollupSum = (arr: Record<string, number>[], key: string): number =>
  arr.reduce((s, o) => s + (o[key] ?? 0), 0);
export const round = (n: number, p = 0): number =>
  Math.round(n * Math.pow(10, p)) / Math.pow(10, p);
export const sum = (...args: unknown[]): number =>
  (args.flat(1) as number[]).reduce((a, b) => a + b, 0);
export const toNumber = (v: unknown): number => Number(v);
export const abs = (n: unknown): number => Math.abs(Number(n) || 0);
export const ceil = (n: unknown): number => Math.ceil(Number(n) || 0);
export const clamp = (n: unknown, lo: unknown, hi: unknown): number =>
  Math.min(Math.max(Number(n) || 0, Number(lo) || 0), Number(hi) || 0);
export const floor = (n: unknown): number => Math.floor(Number(n) || 0);
export const max = (...args: unknown[]): number => Math.max(...(args.flat(1) as number[]));
export const min = (...args: unknown[]): number => Math.min(...(args.flat(1) as number[]));
export const mod = (a: unknown, b: unknown): number => (Number(a) || 0) % (Number(b) || 1);
export const pow = (base: unknown, exp: unknown): number => Math.pow(Number(base) || 0, Number(exp) || 1);
export const sqrt = (n: unknown): number => Math.sqrt(Number(n) || 0);
export const toFixed = (n: unknown, decimals: unknown): string =>
  Number(n ?? 0).toFixed(Math.max(0, Math.floor(Number(decimals) || 0)));

// ── String ────────────────────────────────────────────────────────────────────

export const lower = (s: unknown): string => String(s ?? '').toLowerCase();
export const upper = (s: unknown): string => String(s ?? '').toUpperCase();
export const capitalize = (s: unknown): string => {
  const str = String(s ?? '');
  return str.charAt(0).toUpperCase() + str.slice(1);
};
export const trim = (s: unknown): string => String(s ?? '').trim();
export const startsWith = (s: unknown, prefix: unknown): boolean =>
  String(s ?? '').startsWith(String(prefix ?? ''));
export const endsWith = (s: unknown, suffix: unknown): boolean =>
  String(s ?? '').endsWith(String(suffix ?? ''));
export const replace = (s: unknown, from: unknown, to: unknown): string =>
  String(s ?? '').replaceAll(String(from ?? ''), String(to ?? ''));
export const split = (s: unknown, sep: unknown): string[] =>
  String(s ?? '').split(String(sep ?? ''));
export const concat = (...args: unknown[]): string => args.map(a => String(a ?? '')).join('');
export const textLength = (s: unknown): number => String(s ?? '').length;
export const substring = (s: unknown, start: unknown, end?: unknown): string =>
  String(s ?? '').substring(Number(start) || 0, end != null ? Number(end) : undefined);
export const padStart = (s: unknown, len: unknown, fill = ' '): string =>
  String(s ?? '').padStart(Number(len) || 0, String(fill));
export const padEnd = (s: unknown, len: unknown, fill = ' '): string =>
  String(s ?? '').padEnd(Number(len) || 0, String(fill));

// ── Formatting ────────────────────────────────────────────────────────────────

export const formatCurrency = (amount: unknown, currency = 'USD', locale = 'en-US'): string => {
  try {
    return new Intl.NumberFormat(String(locale), {
      style: 'currency',
      currency: String(currency),
    }).format(Number(amount) || 0);
  } catch {
    return String(amount ?? '');
  }
};

export const formatNumber = (n: unknown, locale = 'en-US', opts?: Intl.NumberFormatOptions): string => {
  try {
    return new Intl.NumberFormat(String(locale), opts).format(Number(n) || 0);
  } catch {
    return String(n ?? '');
  }
};

export const formatDate = (d: unknown, locale = 'en-US', opts?: Intl.DateTimeFormatOptions): string => {
  try {
    const date = d instanceof Date ? d : new Date(String(d ?? ''));
    if (isNaN(date.getTime())) return String(d ?? '');
    return new Intl.DateTimeFormat(String(locale), opts).format(date);
  } catch {
    return String(d ?? '');
  }
};

export const formatRelativeTime = (d: unknown, locale = 'en-US'): string => {
  try {
    const date = d instanceof Date ? d : new Date(String(d ?? ''));
    if (isNaN(date.getTime())) return String(d ?? '');
    const now = Date.now();
    const diff = date.getTime() - now;
    const rtf = new Intl.RelativeTimeFormat(String(locale), { numeric: 'auto' });
    const absDiff = Math.abs(diff);
    if (absDiff < 60_000) return rtf.format(Math.round(diff / 1_000), 'second');
    if (absDiff < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
    if (absDiff < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
    return rtf.format(Math.round(diff / 86_400_000), 'day');
  } catch {
    return String(d ?? '');
  }
};

// ── Array ─────────────────────────────────────────────────────────────────────

export const add = (arr: unknown[], ...vals: unknown[]): unknown[] => [...arr, ...vals];
export const contains = (a: unknown, v: unknown): boolean =>
  Array.isArray(a) ? a.includes(v) : typeof a === 'string' ? a.includes(String(v)) : false;
export const includes = contains;
export const createArray = (...args: unknown[]): unknown[] => args;
export const distinct = (arr: unknown[]): unknown[] => [...new Set(arr)];
export const filterByKey = (arr: Record<string, unknown>[], key: string, val: unknown) =>
  arr.filter(o => o[key] === val);
export const findIndex = (arr: unknown[], val: unknown): number => arr.indexOf(val);
export const getByIndex = (arr: unknown[], i: number): unknown => arr[i];
export const join = (arr: unknown[], sep = ','): string => arr.join(String(sep));
export const length = (arr: unknown): number =>
  Array.isArray(arr) ? arr.length : typeof arr === 'string' ? arr.length : 0;
export const lookup = (arr: Record<string, unknown>[], val: unknown, key = 'id') =>
  arr.find(o => o[key] === val);
export const merge = (...arrs: unknown[][]): unknown[] => arrs.flat(1);
export const prepend = (arr: unknown[], ...vals: unknown[]): unknown[] => [...vals, ...arr];
export const remove = (arr: unknown[], val: unknown): unknown[] => arr.filter(v => v !== val);
export const removeByIndex = (arr: unknown[], i: number): unknown[] => arr.filter((_, idx) => idx !== i);
export const reverse = (arr: unknown[]): unknown[] => [...arr].reverse();
export const slice = (arr: unknown[], s: number, e?: number): unknown[] => arr.slice(s, e);
export const sort = (arr: unknown[], order = 'asc', key?: string): unknown[] => {
  const a = [...arr];
  a.sort((x, y) => {
    const vx = key ? getNested(x, key) : x;
    const vy = key ? getNested(y, key) : y;
    return (order === 'asc' ? 1 : -1) * (vx! > vy! ? 1 : vx! < vy! ? -1 : 0);
  });
  return a;
};
export const flat = (arr: unknown[], depth = 1): unknown[] => arr.flat(depth);
export const arrayIncludes = (arr: unknown[], value: unknown): boolean =>
  arr.some(x => x === value);
export const arrayLength = (arr: unknown): number => Array.isArray(arr) ? arr.length : 0;
export const toggleInArray = (arr: unknown[], value: unknown): unknown[] => {
  const has = arr.some(x => x === value);
  return has ? arr.filter(x => x !== value) : [...arr, value];
};

// ── Object ────────────────────────────────────────────────────────────────────

export const keys = (obj: unknown): string[] => (obj && typeof obj === 'object' ? Object.keys(obj) : []);
export const values = (obj: unknown): unknown[] => (obj && typeof obj === 'object' ? Object.values(obj) : []);
export const entries = (obj: unknown): [string, unknown][] =>
  (obj && typeof obj === 'object' ? Object.entries(obj) : []);
export const has = (obj: unknown, key: string): boolean =>
  (obj && typeof obj === 'object' ? key in (obj as object) : false);
export const get = (obj: unknown, path: string): unknown => getNested(obj, path);
export const set = (obj: Record<string, unknown>, key: string, val: unknown): Record<string, unknown> => ({
  ...obj,
  [key]: val,
});
export const omit = (obj: Record<string, unknown>, ...omitKeys: string[]): Record<string, unknown> => {
  const result = { ...obj };
  for (const k of omitKeys) delete result[k];
  return result;
};
export const pick = (obj: Record<string, unknown>, ...pickKeys: string[]): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const k of pickKeys) if (k in obj) result[k] = obj[k];
  return result;
};

// ── Date helpers ──────────────────────────────────────────────────────────────

export const now = (): number => Date.now();
export const today = (): string => new Date().toISOString().slice(0, 10);
export const toDate = (v: unknown): Date => new Date(String(v ?? ''));
export const isBefore = (a: unknown, b: unknown): boolean =>
  new Date(String(a ?? '')).getTime() < new Date(String(b ?? '')).getTime();
export const isAfter = (a: unknown, b: unknown): boolean =>
  new Date(String(a ?? '')).getTime() > new Date(String(b ?? '')).getTime();

// ── Engine-compatible helpers ─────────────────────────────────────────────────

/** Get a value from an object/map by key */
export const getFromMap = (map: unknown, key: unknown): unknown => {
  if (!map || typeof map !== 'object') return undefined;
  return (map as Record<string, unknown>)[String(key ?? '')];
};

/** Get a value from an object by key (alias for getFromMap) */
export const getKeyValue = getFromMap;

/** Find the first item in an array whose id/ID/_id matches the given value */
export const findItemById = (arr: unknown, id: unknown): unknown => {
  if (!Array.isArray(arr)) return undefined;
  return arr.find((x: unknown) => {
    if (!x || typeof x !== 'object') return false;
    const o = x as Record<string, unknown>;
    return o.id === id || o.ID === id || o._id === id;
  });
};

/** Clamp a number within a range */
export const clampNumber = (n: unknown, lo: unknown, hi: unknown): number =>
  Math.min(Math.max(Number(n) || 0, Number(lo) || 0), Number(hi) || 0);

/** Format a full name from parts */
export const formatFullName = (first: unknown, last: unknown): string =>
  [String(first ?? ''), String(last ?? '')].filter(Boolean).join(' ');

/** Convert any value to a string */
export const toText = (v: unknown): string => String(v ?? '');

/** JSON.stringify a value */
export const stringify = (v: unknown, pretty?: boolean): string =>
  pretty ? JSON.stringify(v, null, 2) : JSON.stringify(v);

/**
 * Group an array of objects by the value at keyPath.
 * Optionally use idPath as a key instead of the raw group value.
 * Returns an array of { id, key, items } group objects.
 */
export const groupBy = (
  arr: unknown,
  keyPath: string,
  idPath?: string,
): Array<{ id: unknown; key: unknown; items: unknown[] }> => {
  if (!Array.isArray(arr)) return [];
  const map = new Map<unknown, { id: unknown; key: unknown; items: unknown[] }>();
  for (const item of arr) {
    const keyVal = getNested(item, keyPath);
    const idVal = idPath ? getNested(item, idPath) : keyVal;
    if (!map.has(keyVal)) map.set(keyVal, { id: idVal, key: keyVal, items: [] });
    map.get(keyVal)!.items.push(item);
  }
  return Array.from(map.values());
};

/**
 * Generate a pagination page list: returns an array of page numbers to show.
 * Includes first, last, current neighbourhood and ellipsis markers (null).
 */
export const paginationPages = (
  total: unknown,
  current: unknown,
  pageSize: unknown,
): Array<number | null> => {
  const t = Math.max(1, Math.ceil(Number(total) / Math.max(1, Number(pageSize))));
  const c = Math.min(t, Math.max(1, Number(current)));
  const pages: Array<number | null> = [];
  const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };
  add(1);
  for (let p = Math.max(2, c - 2); p <= Math.min(t - 1, c + 2); p++) add(p);
  if (t > 1) add(t);
  const result: Array<number | null> = [];
  let prev = 0;
  for (const p of pages) {
    if ((p as number) - prev > 1) result.push(null);
    result.push(p);
    prev = p as number;
  }
  return result;
};

/** Find an item in an array by matching multiple field values */
export const lookupInArray = (
  arr: unknown,
  ...fieldValuePairs: unknown[]
): unknown => {
  if (!Array.isArray(arr)) return undefined;
  return arr.find(item => {
    if (!item || typeof item !== 'object') return false;
    for (let i = 0; i < fieldValuePairs.length - 1; i += 2) {
      if (getNested(item, String(fieldValuePairs[i])) !== fieldValuePairs[i + 1]) return false;
    }
    return true;
  });
};

/** Look up a key in a map-like object (alias for getFromMap) */
export const lookupMap = getFromMap;

/** Filter array excluding items matching field/value, with optional slice */
export const filterExcludeByFieldAndSlice = (
  arr: unknown,
  field: string,
  value: unknown,
  start?: number,
  end?: number,
): unknown[] => {
  if (!Array.isArray(arr)) return [];
  const filtered = arr.filter(item => getNested(item, field) !== value);
  return start != null || end != null ? filtered.slice(start, end) : filtered;
};

/** Find an item by matching any of the option field values */
export const findItemByOptionsMatch = (
  arr: unknown,
  optionsPath: string,
  ...matchValues: unknown[]
): unknown => {
  if (!Array.isArray(arr)) return undefined;
  return arr.find(item => {
    const opts = getNested(item, optionsPath);
    if (!Array.isArray(opts)) return false;
    return matchValues.some(v => opts.includes(v));
  });
};
`;

  return { path: 'lib/utils.ts', content };
}
