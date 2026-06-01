/**
 * store.ts — Emit lib/store.ts: Zustand store for the exported app.
 *
 * Shape mirrors the engine's named scopes:
 *   state.variables   — custom vars with initial values
 *   state.collections — datasource response data
 *   state.route       — current route params / search params
 *   state.auth        — auth token + user
 *   state.local       — form field state
 *   state._workflow   — workflow execution state
 *   state.pages       — page-level state objects
 *   state.sharedComponents — SC visibility flags (post-flatten)
 *
 * Path helpers (setNestedValue, mergeAtPath, etc.) are included directly
 * in the store file so the exported project has zero dependencies on engine code.
 */

import type { CodegenCtx, EmittedFile } from './types';

export function emitStoreTs(ctx: CodegenCtx): EmittedFile {
  const { store, symbols, flags } = ctx;

  const lines: string[] = [];

  lines.push(`import { create } from 'zustand';`);
  if (flags.hasPersistedVars) {
    lines.push(`import { persist, createJSONStorage } from 'zustand/middleware';`);
  }
  lines.push('');

  // ── Path helpers ────────────────────────────────────────────────────────────
  lines.push(`// ── Path helpers ──────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`export function getNestedValue(obj: unknown, path: string[]): unknown {`);
  lines.push(`  let cur: unknown = obj;`);
  lines.push(`  for (const key of path) {`);
  lines.push(`    if (cur == null || typeof cur !== 'object') return undefined;`);
  lines.push(`    cur = (cur as Record<string, unknown>)[key];`);
  lines.push(`  }`);
  lines.push(`  return cur;`);
  lines.push(`}`);
  lines.push('');
  lines.push(`export function setNestedValue<T>(obj: T, path: string[], value: unknown): T {`);
  lines.push(`  if (path.length === 0) return value as T;`);
  lines.push(`  const [head, ...rest] = path;`);
  lines.push(`  const current = (obj as Record<string, unknown>)[head!] ?? {};`);
  lines.push(`  return { ...obj, [head!]: setNestedValue(current, rest, value) } as T;`);
  lines.push(`}`);
  lines.push('');
  lines.push(`export function mergeAtPath<T>(obj: T, path: string[], partial: unknown): T {`);
  lines.push(`  const current = getNestedValue(obj, path) ?? {};`);
  lines.push(`  const merged = typeof partial === 'object' && partial !== null`);
  lines.push(`    ? { ...(current as object), ...(partial as object) }`);
  lines.push(`    : partial;`);
  lines.push(`  return setNestedValue(obj, path, merged);`);
  lines.push(`}`);
  lines.push('');
  lines.push(`export function appendToPath<T>(obj: T, path: string[], item: unknown): T {`);
  lines.push(`  const current = (getNestedValue(obj, path) ?? []) as unknown[];`);
  lines.push(`  return setNestedValue(obj, path, [...current, item]);`);
  lines.push(`}`);
  lines.push('');
  lines.push(`export function removeAtPath<T>(obj: T, path: string[], index: unknown): T {`);
  lines.push(`  const current = (getNestedValue(obj, path) ?? []) as unknown[];`);
  lines.push(`  return setNestedValue(obj, path, current.filter((_, i) => i !== Number(index)));`);
  lines.push(`}`);
  lines.push('');
  lines.push(`export function toggleAtPath<T>(obj: T, path: string[]): T {`);
  lines.push(`  const current = getNestedValue(obj, path);`);
  lines.push(`  return setNestedValue(obj, path, !current);`);
  lines.push(`}`);
  lines.push('');
  lines.push(`export function bumpAtPath<T>(obj: T, path: string[], delta: number): T {`);
  lines.push(`  const current = Number(getNestedValue(obj, path) ?? 0);`);
  lines.push(`  return setNestedValue(obj, path, current + delta);`);
  lines.push(`}`);
  lines.push('');
  lines.push(`export function cycleAtPath<T>(obj: T, path: string[], length: unknown): T {`);
  lines.push(`  const current = Number(getNestedValue(obj, path) ?? 0);`);
  lines.push(`  const mod = Number(length) || 1;`);
  lines.push(`  return setNestedValue(obj, path, (current + 1) % mod);`);
  lines.push(`}`);
  lines.push('');
  lines.push(`export function buildQueryString(params: Record<string, unknown>): string {`);
  lines.push(`  const qs = new URLSearchParams();`);
  lines.push(`  for (const [k, v] of Object.entries(params ?? {})) {`);
  lines.push(`    if (v != null) qs.set(k, String(v));`);
  lines.push(`  }`);
  lines.push(`  const s = qs.toString();`);
  lines.push(`  return s ? '?' + s : '';`);
  lines.push(`}`);
  lines.push('');
  lines.push(`export function persistKey(path: string): string {`);
  lines.push(`  return 'app-store:' + path;`);
  lines.push(`}`);
  lines.push('');

  // ── State shape ─────────────────────────────────────────────────────────────
  lines.push(`// ── State shape ───────────────────────────────────────────────────────────`);
  lines.push('');

  // Variables initial state — use camelCase identifier as the key (consistent with JSX reads)
  const varInitials: Record<string, unknown> = {};
  const persistedVarNames: string[] = [];
  for (const v of store.customVars ?? []) {
    const ident = symbols.vars.get(v.name) ?? symbols.vars.get(v.id ?? '') ?? v.name;
    varInitials[ident] = v.initialValue ?? defaultForType(v.type);
    if (v.saveInLocalStorage) persistedVarNames.push(ident);
  }

  // Collections initial state — start with loading:true so the skeleton is shown on the
  // very first render (before any useEffect/useLayoutEffect fires), avoiding the empty-state flash.
  const collInitials: Record<string, unknown> = {};
  for (const ds of store.pageDataSources ?? []) {
    const ident = symbols.collections.get(ds.id) ?? ds.name;
    if (ident) collInitials[ident] = { loading: true };
  }

  lines.push(`export interface AppState {`);
  lines.push(`  variables: {`);
  for (const [k, v] of Object.entries(varInitials)) {
    // Primitive types get strict TS types; objects/arrays/null use `any` for flexible property access
    let tsType: string;
    if (typeof v === 'object' || v === null) tsType = 'any';
    else if (typeof v === 'string') tsType = 'string';
    else if (typeof v === 'number') tsType = 'number';
    else if (typeof v === 'boolean') tsType = 'boolean';
    else tsType = 'any';
    lines.push(`    ${k}: ${tsType};`);
  }
  lines.push(`  };`);
  // Collections use `any` — their shape is determined by API responses at runtime
  lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`  collections: Record<string, any> & {`);
  for (const k of Object.keys(collInitials)) {
    lines.push(`    // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    lines.push(`    ${k}: any;`);
  }
  lines.push(`  };`);
  lines.push(`  route: Record<string, string>;`);
  lines.push(`  auth: { token: string | null; user: unknown };`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`  local: Record<string, any>;`);
  lines.push(`  _workflow: { lastAction: unknown; lastError: unknown };`);
  lines.push(`  pages: Record<string, unknown>;`);
  lines.push(`  sharedComponents: Record<string, boolean>;`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lines.push(`  /** Per-instance state for shared components (variables keyed by instance node ID) */`);
  lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`  componentVars: Record<string, Record<string, any>>;`);
  lines.push(`}`);
  lines.push('');

  const initialState: Record<string, unknown> = {
    variables: varInitials,
    collections: collInitials,
    route: {},
    auth: { token: null, user: null },
    local: {},
    _workflow: { lastAction: null, lastError: null },
    pages: {},
    sharedComponents: {},
    componentVars: {},
  };

  lines.push(`const initialState: AppState = ${JSON.stringify(initialState, null, 2)};`);
  lines.push('');

  // Create the store
  if (flags.hasPersistedVars && persistedVarNames.length > 0) {
    lines.push(`export const useStore = create<AppState>()(persist(`);
    lines.push(`  () => initialState,`);
    lines.push(`  {`);
    lines.push(`    name: 'app-store',`);
    lines.push(`    storage: createJSONStorage(() => localStorage),`);
    lines.push(`    partialize: (state) => ({`);
    lines.push(`      variables: {`);
    for (const name of persistedVarNames) {
      lines.push(`        ${name}: state.variables.${name},`);
    }
    lines.push(`      },`);
    lines.push(`    }),`);
    lines.push(`  },`);
    lines.push(`));`);
  } else {
    lines.push(`export const useStore = create<AppState>()(() => initialState);`);
  }

  lines.push('');

  // ── Typed selectors ─────────────────────────────────────────────────────────
  // Use these in components instead of reading raw state to get typed access
  // without verbose optional chaining (e.g. `useAuth()` vs `state.auth`).
  lines.push(`// ── Typed selectors ──────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`/** Read the current auth state (token + user) from anywhere in the component tree. */`);
  lines.push(`export const useAuth = () => useStore(s => s.auth);`);
  lines.push('');
  lines.push(`/** Read the variables slice of the store. */`);
  lines.push(`export const useVariables = () => useStore(s => s.variables);`);
  lines.push('');
  lines.push(`/**`);
  lines.push(` * Read a single collection by its store key (e.g. "activeOrder", "productDetail").`);
  lines.push(` * Returns \`{ loading: true }\` while the fetch is in progress, then the full data object.`);
  lines.push(` */`);
  lines.push(`export const useCollection = (name: string) => useStore(s => s.collections?.[name] as Record<string, unknown> | undefined);`);
  lines.push('');
  lines.push(`/** Shorthand that extracts \`.data\` from a collection, typed as an arbitrary record. */`);
  lines.push(`// eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`export const useCollectionData = (name: string): any => useStore(s => (s.collections?.[name] as Record<string, unknown> | undefined)?.data);`);
  lines.push('');

  return { path: 'lib/store.ts', content: lines.join('\n') };
}

function defaultForType(type: string): unknown {
  switch (type) {
    case 'number': return 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': case 'form': return {};
    default: return '';
  }
}
