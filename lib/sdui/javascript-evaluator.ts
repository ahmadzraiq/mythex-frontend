/**
 * JavaScript binding & workflow-action evaluator.
 *
 * Two execution modes:
 *   1. Sync — used for `{ "js": "<body>" }` bindings (Text.text, props.style, etc.).
 *      Wraps the user code in `new Function()` and returns the result.
 *   2. Async — used for the `runJavaScript` workflow step. Wraps the body in
 *      `new AsyncFunction()` so users can `await fetch(...)` and call the
 *      `wwLib` helper API for side effects (set variables, refetch collections).
 *
 * In both modes, the user code sees these globals (mirrors WeWeb's DX):
 *   variables       — Proxy keyed by variable NAME (label) → reads/writes the
 *                     global variable store. `variables.cartCount` ↔ store[uuid].
 *   collections     — Proxy keyed by datasource NAME → returns the live
 *                     `{ data, error, isFetching }` snapshot.
 *   context         — Repeat / event / component scope (same as formulas).
 *   parameters      — Global-workflow parameters (when applicable).
 *   wwLib           — Helper API: variables.{get,set}, collections.{get,refetch},
 *                     workflow (prior step results), navigate, route, fetch.
 *
 * Storage shape on disk: `{ "js": "const x = variables.cartCount;\nreturn x > 0;" }`
 */

import { getGlobalVariableStore } from './global-variable-store';
import {
  getVariableUuidByName,
  getVariableNameByUuid,
  getCollectionUuidByName,
  getCollectionNameByUuid,
  getAllVariableNames,
  getAllCollectionNames,
} from './variable-name-registry';

// ─── Types ────────────────────────────────────────────────────────────────────

export type JsBinding = { js: string };

export type JsEvalResult = { value: unknown; error: null } | { value: null; error: string };

/** Detects the on-disk { js: "..." } shape — symmetric to isBoundValue/{ formula }. */
export function isJsBinding(v: unknown): v is JsBinding {
  return v !== null && typeof v === 'object' && typeof (v as Record<string, unknown>).js === 'string';
}

// ─── Proxy builders ───────────────────────────────────────────────────────────

/**
 * Build a name-keyed Proxy over the variable UUID-keyed store snapshot.
 * Reads: `proxy.cartCount` → `state[uuid_of_cartCount]`.
 * Writes (sync mode): no-op (binding context is read-only — return false from set).
 * Writes (async / wwLib): use wwLib.variables.set instead.
 */
function makeVariablesProxy(state: Record<string, unknown>, allowWrite: boolean): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      // Direct UUID access — keep backward-compat with formula-style bracket paths.
      if (prop in state) return state[prop];
      const uuid = getVariableUuidByName(prop);
      if (uuid) return state[uuid];
      return undefined;
    },
    set(_t, prop: string | symbol, value: unknown) {
      if (!allowWrite || typeof prop !== 'string') return false;
      const uuid = getVariableUuidByName(prop) ?? prop;
      getGlobalVariableStore().getState().setState((prev) => ({ ...prev, [uuid]: value }));
      return true;
    },
    has(_t, prop) {
      if (typeof prop !== 'string') return false;
      return prop in state || !!getVariableUuidByName(prop);
    },
    ownKeys() {
      return [...new Set([...Object.keys(state), ...getAllVariableNames()])];
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
  });
}

/**
 * Build a name-keyed Proxy over the datasource snapshots living at
 * `state.collections[uuid]` (mirrors how the formula evaluator resolves them).
 */
function makeCollectionsProxy(state: Record<string, unknown>): Record<string, unknown> {
  const collections = (state.collections as Record<string, unknown> | undefined) ?? {};
  return new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      if (prop in collections) return collections[prop];
      const uuid = getCollectionUuidByName(prop);
      if (uuid) return collections[uuid];
      return undefined;
    },
    has(_t, prop) {
      if (typeof prop !== 'string') return false;
      return prop in collections || !!getCollectionUuidByName(prop);
    },
    ownKeys() {
      return [...new Set([...Object.keys(collections), ...getAllCollectionNames()])];
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
  });
}

// ─── wwLib helper API ────────────────────────────────────────────────────────

export interface WwLibContext {
  /** Optional override hook to refetch a datasource by UUID — wired by workflow-steps-handler. */
  refetchCollection?: (uuid: string) => Promise<unknown> | unknown;
  /** Workflow step results so far (context.workflow). */
  workflow?: Record<string, { result: unknown; error: unknown }>;
  /** Global-workflow parameters. */
  parameters?: Record<string, unknown>;
}

export function makeWwLib(ctx: WwLibContext = {}) {
  return {
    variables: {
      get(name: string): unknown {
        const uuid = getVariableUuidByName(name) ?? name;
        return getGlobalVariableStore().getState().getFullState()[uuid];
      },
      set(name: string, value: unknown): void {
        const uuid = getVariableUuidByName(name) ?? name;
        getGlobalVariableStore().getState().setState((prev) => ({ ...prev, [uuid]: value }));
      },
      reset(name: string): void {
        const uuid = getVariableUuidByName(name) ?? name;
        getGlobalVariableStore().getState().setState((prev) => ({ ...prev, [uuid]: null }));
      },
      uuid: (name: string) => getVariableUuidByName(name),
      name: (uuid: string) => getVariableNameByUuid(uuid),
    },
    collections: {
      get(name: string): unknown {
        const uuid = getCollectionUuidByName(name) ?? name;
        const collections = getGlobalVariableStore().getState().getFullState().collections as
          | Record<string, unknown>
          | undefined;
        return collections?.[uuid];
      },
      async refetch(name: string): Promise<unknown> {
        const uuid = getCollectionUuidByName(name) ?? name;
        if (ctx.refetchCollection) return await ctx.refetchCollection(uuid);
        return undefined;
      },
      uuid: (name: string) => getCollectionUuidByName(name),
      name: (uuid: string) => getCollectionNameByUuid(uuid),
    },
    workflow: ctx.workflow ?? {},
    parameters: ctx.parameters ?? {},
    /** Navigate via `window.location.href = ...`. */
    navigateTo(url: string): void {
      if (typeof window !== 'undefined') window.location.href = url;
    },
  };
}

// ─── Sync evaluator (for bindings) ───────────────────────────────────────────

/**
 * Evaluate a `{ js: "<body>" }` binding synchronously.
 *
 * The body is wrapped as the body of a regular function — users typically use
 * `return <expr>;`. Single-expression bodies are also supported (they auto-`return`).
 */
export function evaluateJsBinding(
  binding: JsBinding | string,
  context: Record<string, unknown>,
): JsEvalResult {
  const code = typeof binding === 'string' ? binding : binding.js;
  if (!code || !code.trim()) return { value: undefined, error: null };

  const body = ensureReturn(code);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'variables', 'collections', 'context', 'globalContext', 'pages', 'theme', 'event', 'parameters', 'route', 'auth', 'wwLib',
      `"use strict";\n${body}`,
    );
    const value = fn(
      makeVariablesProxy(context, /* allowWrite */ false),
      makeCollectionsProxy(context),
      (context.context ?? {}) as Record<string, unknown>,
      (context.globalContext ?? {}) as Record<string, unknown>,
      (context.pages ?? {}) as Record<string, unknown>,
      (context.theme ?? {}) as Record<string, unknown>,
      (context.event ?? {}) as Record<string, unknown>,
      (context.parameters ?? {}) as Record<string, unknown>,
      (context.route ?? {}) as Record<string, unknown>,
      (context.auth ?? {}) as Record<string, unknown>,
      makeWwLib({ workflow: context.workflow as Record<string, { result: unknown; error: unknown }>, parameters: context.parameters as Record<string, unknown> }),
    );
    return { value, error: null };
  } catch (e) {
    if (e instanceof TypeError) return { value: undefined, error: null };
    return { value: null, error: (e as Error).message ?? 'Invalid JavaScript' };
  }
}

// ─── Async evaluator (for runJavaScript workflow action) ─────────────────────

const AsyncFunctionCtor: new (...args: string[]) => (...a: unknown[]) => Promise<unknown> =
  Object.getPrototypeOf(async function () {}).constructor;

/**
 * Run a `runJavaScript` workflow step body asynchronously.
 *
 * Variables proxy is writable here — `variables.cartCount = 5` updates the store.
 * Users can also `await fetch(...)` and use the full `wwLib` helper API.
 */
export async function evaluateJsAsync(
  code: string,
  context: Record<string, unknown>,
  wwLibCtx: WwLibContext = {},
): Promise<JsEvalResult> {
  if (!code || !code.trim()) return { value: undefined, error: null };
  const body = ensureReturn(code);
  try {
    const fn = new AsyncFunctionCtor(
      'variables', 'collections', 'context', 'globalContext', 'pages', 'theme', 'event', 'parameters', 'route', 'auth', 'wwLib',
      `"use strict";\n${body}`,
    );
    const value = await fn(
      makeVariablesProxy(context, /* allowWrite */ true),
      makeCollectionsProxy(context),
      (context.context ?? {}) as Record<string, unknown>,
      (context.globalContext ?? {}) as Record<string, unknown>,
      (context.pages ?? {}) as Record<string, unknown>,
      (context.theme ?? {}) as Record<string, unknown>,
      (context.event ?? {}) as Record<string, unknown>,
      (wwLibCtx.parameters ?? context.parameters ?? {}) as Record<string, unknown>,
      (context.route ?? {}) as Record<string, unknown>,
      (context.auth ?? {}) as Record<string, unknown>,
      makeWwLib(wwLibCtx),
    );
    return { value, error: null };
  } catch (e) {
    return { value: null, error: (e as Error).message ?? 'Invalid JavaScript' };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wrap a single-expression body so it returns implicitly, leave multi-statement
 * bodies (those containing `;`, `\n`, or a `return`) as-is.
 */
function ensureReturn(code: string): string {
  const trimmed = code.trim();
  // Already has a return statement, statements separated by ;, multiple lines,
  // or a trailing semicolon — assume the user wrote a full function body.
  if (
    /\breturn\b/.test(trimmed) ||
    /[\n;]/.test(trimmed) ||
    trimmed.startsWith('{')
  ) return code;
  return `return (${trimmed});`;
}
