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
import { FORMULA_FNS } from './formula-functions';

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
  /**
   * Single-step dispatcher injected by workflow-steps-handler.runJavaScript so
   * typed wwLib helpers can synthesize a step and route through the canvas
   * runtime (covers every ActionStepType). Undefined in the sync binding path.
   */
  runStep?: (step: { id?: string; type: string; config?: Record<string, unknown> }) => Promise<unknown>;
  /** Raw SDUI action passthrough — exposed as wwLib.actions.runRaw. */
  runOne?: (action: Record<string, unknown>) => Promise<unknown>;
}

export function makeWwLib(ctx: WwLibContext = {}) {
  // Routes typed wwLib calls through the workflow runtime injected by
  // workflow-steps-handler. In sync-binding mode (no runStep) we throw so users
  // get a clear error instead of a silent no-op.
  const invoke = async (type: string, config: Record<string, unknown> = {}): Promise<unknown> => {
    if (!ctx.runStep) {
      throw new Error(`wwLib.${type}() is only available inside runJavaScript workflow steps, not in { js } bindings.`);
    }
    return await ctx.runStep({ type, config });
  };

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
      /**
       * Mutate a local datasource via the canvas updateCollection action.
       * mode: 'add' | 'update' | 'remove' | 'replace'.
       */
      async update(
        nameOrUuid: string,
        mode: 'add' | 'update' | 'remove' | 'replace',
        item?: unknown,
        key?: string,
      ): Promise<unknown> {
        const collectionId = getCollectionUuidByName(nameOrUuid) ?? nameOrUuid;
        return await invoke('updateCollection', { collectionId, mode, item, key });
      },
      uuid: (name: string) => getCollectionUuidByName(name),
      name: (uuid: string) => getCollectionNameByUuid(uuid),
    },
    workflow: ctx.workflow ?? {},
    parameters: ctx.parameters ?? {},

    // ── Navigation ─────────────────────────────────────────────────────────
    navigate: {
      to(opts: string | {
        path?: string;
        linkType?: 'internal' | 'external';
        externalUrl?: string;
        newTab?: boolean;
        queryParams?: Record<string, unknown>;
        replace?: boolean;
      }): Promise<unknown> {
        const cfg = typeof opts === 'string' ? { path: opts } : opts;
        return invoke('navigateTo', cfg as Record<string, unknown>);
      },
      prev(defaultPath?: string): Promise<unknown> {
        return invoke('navigatePrev', defaultPath ? { defaultPath } : {});
      },
    },

    // ── Project workflows ──────────────────────────────────────────────────
    workflows: {
      run(workflowId: string, parameters?: Record<string, unknown>): Promise<unknown> {
        return invoke('runProjectWorkflow', { workflowId, parameters });
      },
      return(value: unknown): Promise<unknown> {
        return invoke('returnValue', { value });
      },
    },

    // ── Component actions / triggers ───────────────────────────────────────
    components: {
      run(instanceId: string, workflowId: string, parameters?: Record<string, unknown>): Promise<unknown> {
        return invoke('executeComponentAction', { instanceId, workflowId, parameters });
      },
      emit(instanceId: string, triggerName: string, payload?: unknown): Promise<unknown> {
        return invoke('emitComponentTrigger', { instanceId, triggerName, payload });
      },
    },

    // ── Shared component dynamic CRUD ──────────────────────────────────────
    shared: {
      add(typeId: string, props?: Record<string, unknown>): Promise<unknown> {
        return invoke('addSharedComponent', { typeId, props });
      },
      delete(instanceId: string): Promise<unknown> {
        return invoke('deleteSharedComponent', { instanceId });
      },
      deleteAll(typeId?: string): Promise<unknown> {
        return invoke('deleteAllSharedComponents', typeId ? { typeId } : {});
      },
    },

    // ── Popovers ───────────────────────────────────────────────────────────
    popovers: {
      open(id: string): Promise<unknown> { return invoke('openPopover', { id }); },
      close(id: string): Promise<unknown> { return invoke('closePopover', { id }); },
      toggle(id: string): Promise<unknown> { return invoke('togglePopover', { id }); },
    },

    // ── Forms ──────────────────────────────────────────────────────────────
    forms: {
      setState(formId: string, state: Record<string, unknown>): Promise<unknown> {
        return invoke('setFormState', { formId, state });
      },
      reset(formId: string): Promise<unknown> {
        return invoke('resetForm', { formId });
      },
    },

    // ── Auth ───────────────────────────────────────────────────────────────
    auth: {
      authenticate(opts: {
        url?: string;
        method?: string;
        body?: unknown;
        tokenPath?: string;
        userPath?: string;
        persist?: boolean;
        headers?: Record<string, string>;
      }): Promise<unknown> {
        return invoke('authenticate', opts as Record<string, unknown>);
      },
      setUser(user: Record<string, unknown>): Promise<unknown> {
        return invoke('setUser', { user });
      },
      clearSession(): Promise<unknown> {
        return invoke('clearSession', {});
      },
      restoreSession(): Promise<unknown> {
        return invoke('restoreSession', {});
      },
    },

    // ── Files / browser ────────────────────────────────────────────────────
    files: {
      upload(opts: {
        url: string;
        file: unknown;
        fieldName?: string;
        headers?: Record<string, string>;
      }): Promise<unknown> {
        return invoke('uploadFile', opts as Record<string, unknown>);
      },
      download(url: string, filename?: string): Promise<unknown> {
        return invoke('downloadFileFromUrl', filename ? { url, filename } : { url });
      },
      encodeBase64(file: unknown): Promise<unknown> {
        return invoke('encodeFileAsBase64', { file });
      },
      fromBase64(base64: string, mimeType: string, filename?: string): Promise<unknown> {
        return invoke('createUrlFromBase64', { base64, mimeType, filename });
      },
    },
    clipboard: {
      copy(text: string): Promise<unknown> {
        return invoke('copyToClipboard', { text });
      },
    },
    scroll: {
      to(elementId: string, opts?: { behavior?: 'auto' | 'smooth'; block?: 'start' | 'center' | 'end' | 'nearest' }): Promise<unknown> {
        return invoke('scrollToElement', { elementId, ...(opts ?? {}) });
      },
    },
    print: {
      pdf(opts?: { elementId?: string; filename?: string }): Promise<unknown> {
        return invoke('printPdf', (opts ?? {}) as Record<string, unknown>);
      },
    },
    event: {
      stopPropagation(): Promise<unknown> {
        return invoke('stopPropagation', {});
      },
    },
    timing: {
      delay(ms: number): Promise<unknown> {
        return invoke('timeDelay', { duration: ms, ms });
      },
    },

    // ── Generic escape hatch ───────────────────────────────────────────────
    actions: {
      run(step: { type: string; config?: Record<string, unknown> }): Promise<unknown> {
        if (!step || typeof step.type !== 'string') {
          return Promise.reject(new Error('wwLib.actions.run requires { type, config }'));
        }
        return invoke(step.type, step.config ?? {});
      },
      runRaw(action: Record<string, unknown>): Promise<unknown> {
        if (!ctx.runOne) {
          return Promise.reject(new Error('wwLib.actions.runRaw is only available inside runJavaScript workflow steps.'));
        }
        return ctx.runOne(action);
      },
    },

    // Legacy: keep top-level navigateTo for backward compat with v1 examples.
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
      'variables', 'collections', 'context', 'globalContext', 'pages', 'theme', 'event', 'parameters', 'route', 'auth', 'wwLib', 'fns',
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
      FORMULA_FNS,
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
      'variables', 'collections', 'context', 'globalContext', 'pages', 'theme', 'event', 'parameters', 'route', 'auth', 'wwLib', 'fns',
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
      FORMULA_FNS,
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
