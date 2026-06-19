/**
 * Global Variable Store - Single source of truth for all SDUI state
 * Persists across screens. Path-based get/set. Fine-grained subscriptions.
 *
 * Path conventions:
 * - screens.{screenName}.form.*     - Form values (e.g. screens.signup.form.password)
 * - screens.{screenName}.errors.*  - Validation errors
 * - {UUID}                          - User-defined variables from config/variables.json
 *
 * Access from anywhere: {{variables['UUID']}}, {{variables['UUID'].field}}
 * Only components that use a path re-render when that path changes.
 */

import { createVariableStore } from './variable-store';
import variablesJson from '@/config/variables.json';

type VariableDef = {
  type: string;
  initialValue?: unknown;
  saveInLocalStorage?: boolean;
  fields?: Array<{ name: string; initialValue?: unknown }>;
};

// ── Initial-value registry ────────────────────────────────────────────────────
// Environment-agnostic: populated from JSON at startup AND can be extended by
// any backend-loading path that calls registerVariableInitialValue().
const _initialValues: Record<string, unknown> = {};

/**
 * Register the initialValue for a variable UUID so resetVariableValue can
 * restore it correctly regardless of whether variables were loaded from the
 * local JSON config or from a backend API.
 * Stores a deep copy so runtime mutations never corrupt the reset target.
 */
export function registerVariableInitialValue(uuid: string, value: unknown): void {
  try {
    _initialValues[uuid] = JSON.parse(JSON.stringify(value ?? null));
  } catch {
    _initialValues[uuid] = value ?? null;
  }
}

/**
 * Returns the registered initialValue for a UUID.
 * Returns undefined when the UUID was never registered (caller should fall
 * back to null or cfg.defaultValue in that case).
 */
export function getVariableInitialValue(uuid: string): unknown {
  return _initialValues[uuid];
}

/** Build the initial variable store state from config/variables.json */
function buildInitialState(): Record<string, unknown> {
  const vars = (variablesJson as { variables: Record<string, VariableDef> }).variables ?? {};
  const state: Record<string, unknown> = {
    screens: {} as Record<string, Record<string, unknown>>,
  };
  for (const [uuid, def] of Object.entries(vars)) {
    if (def.type === 'form') {
      // Form variables are initialized with value/errors/dirty/valid sub-structure
      const value: Record<string, unknown> = {};
      const errors: Record<string, unknown> = {};
      const dirty: Record<string, unknown> = {};
      for (const field of def.fields ?? []) {
        value[field.name] = field.initialValue ?? '';
        errors[field.name] = null;
        dirty[field.name] = false;
      }
      state[uuid] = { value, errors, dirty, valid: false };
    } else if (def.initialValue !== undefined) {
      state[uuid] = def.initialValue;
      registerVariableInitialValue(uuid, def.initialValue);
    } else {
      state[uuid] = null;
    }
  }
  return state;
}

const globalStore = createVariableStore({
  initialState: { ...buildInitialState(), _form_reset_v: 0, _formulas_v: 0 },
  adapters: [],
});

// Expose the store on window in development so E2E tests can read/write variables
// without going through the UI (e.g. to test formula reactivity).
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>).__globalVariableStore = globalStore;
}

export function getGlobalVariableStore() {
  return globalStore;
}

/**
 * Bump the `_formulas_v` counter so all SDUI binding components that
 * subscribe to the variable store re-render and pick up the newly registered
 * user-defined formula functions (e.g. formatDisplay, typeColor).
 * Called by registerGlobalFormulas in formula-evaluator.ts.
 */
export function bumpFormulasVersion(): void {
  if (typeof window === 'undefined') return;
  globalStore.getState().setState((prev: Record<string, unknown>) => ({
    ...prev,
    _formulas_v: ((prev._formulas_v as number) || 0) + 1,
  }));
}

// ── Per-variable localStorage persistence ─────────────────────────────────────

const VAR_STORAGE_PREFIX = 'sdui_var_';

/**
 * Module-level registry: UUID → initialValue.
 * Only variables in this map are synced to localStorage.
 * Storing the initialValue lets the subscription skip writes when the live
 * value has reverted to the default (and clear any stale stored entry).
 */
const _storageVarMap = new Map<string, unknown>();
let _storageSyncActive = false;

function _ensureStorageSync() {
  if (_storageSyncActive || typeof window === 'undefined') return;
  _storageSyncActive = true;

  const _prevStr = new Map<string, string>();

  globalStore.subscribe((state: { data: Record<string, unknown> }) => {
    if (_storageVarMap.size === 0) return;
    for (const [uuid, initialValue] of _storageVarMap) {
      const newStr = JSON.stringify(state.data[uuid]);
      if (newStr === _prevStr.get(uuid)) continue;
      _prevStr.set(uuid, newStr);

      // Only persist when value differs from the declared default.
      // When the value reverts to the default, remove the stored key so
      // the next page load uses the default naturally without a stale entry.
      if (newStr !== JSON.stringify(initialValue)) {
        try { localStorage.setItem(`${VAR_STORAGE_PREFIX}${uuid}`, newStr); }
        catch { /* ignore quota errors */ }
      } else {
        localStorage.removeItem(`${VAR_STORAGE_PREFIX}${uuid}`);
      }
    }
  });
}

/**
 * Register a variable UUID for localStorage persistence.
 *
 * - Tracks `initialValue` so the subscription can skip writes when the live
 *   value equals the default (and remove any stale stored key on revert).
 * - On the FIRST registration (page-load restore path): immediately reads any
 *   stored value from localStorage and patches the global variable store.
 * - On subsequent calls (e.g. default changed): updates the comparison target
 *   without re-reading localStorage (the live value already won).
 */
export function registerStorageVar(uuid: string, initialValue?: unknown): void {
  if (typeof window === 'undefined') return;
  const isNew = !_storageVarMap.has(uuid);
  _storageVarMap.set(uuid, initialValue);
  _ensureStorageSync();

  // Only restore from localStorage on the first registration so that a
  // subsequent "default changed" call doesn't clobber the live value.
  if (isNew) {
    const raw = localStorage.getItem(`${VAR_STORAGE_PREFIX}${uuid}`);
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        globalStore.getState().setState((prev: Record<string, unknown>) => ({ ...prev, [uuid]: parsed }));
      } catch { /* ignore parse errors — stale/corrupt storage */ }
    }
  }
}

/**
 * Unregister a variable UUID from localStorage persistence.
 * Pass `clearStorage = true` to also delete the stored key.
 */
export function unregisterStorageVar(uuid: string, clearStorage = false): void {
  _storageVarMap.delete(uuid);
  if (clearStorage && typeof window !== 'undefined') {
    localStorage.removeItem(`${VAR_STORAGE_PREFIX}${uuid}`);
  }
}

// ── Per-component-instance variable slots ──────────────────────────────────────
//
// Stores scoped variable values at:  _componentInstances[instanceId][uuid]
//
// These UUIDs belong to a SharedComponentModel.variables record, NOT to
// config/variables.json — they are separate namespaces.  The renderer looks up
// `_componentInstances[instanceId]` before falling back to the top-level store.
//
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Ensure a per-instance slot exists in the global variable store.
 * Called by the renderer on every component instance mount.
 */
export function ensureComponentInstanceSlot(
  instanceId: string,
  componentVariables: Record<string, { initialValue: unknown }>,
): void {
  const state = globalStore.getState();
  const current = (state.data['_componentInstances'] as Record<string, Record<string, unknown>> | undefined) ?? {};
  if (current[instanceId]) return; // already seeded

  const initialValues: Record<string, unknown> = {};
  for (const [uuid, def] of Object.entries(componentVariables)) {
    initialValues[uuid] = def.initialValue ?? null;
  }

  state.setState((prev: Record<string, unknown>) => ({
    ...prev,
    _componentInstances: {
      ...(prev['_componentInstances'] as Record<string, Record<string, unknown>> ?? {}),
      [instanceId]: initialValues,
    },
  }));
}

/**
 * Read a component variable value by UUID from the per-instance slot.
 * Returns `undefined` when the UUID is not in the instance slot (i.e. it's a global variable).
 */
export function getComponentInstanceVar(instanceId: string, uuid: string): unknown {
  const state = globalStore.getState();
  const instances = state.data['_componentInstances'] as Record<string, Record<string, unknown>> | undefined;
  return instances?.[instanceId]?.[uuid];
}

/**
 * Write a component variable value by UUID to the per-instance slot.
 * This keeps each instance's state isolated from sibling instances of the same component.
 */
export function setComponentInstanceVar(instanceId: string, uuid: string, value: unknown): void {
  const state = globalStore.getState();
  state.setState((prev: Record<string, unknown>) => {
    const instances = (prev['_componentInstances'] as Record<string, Record<string, unknown>> ?? {});
    return {
      ...prev,
      _componentInstances: {
        ...instances,
        [instanceId]: { ...(instances[instanceId] ?? {}), [uuid]: value },
      },
    };
  });
}

/**
 * Get the full per-instance variable map (UUID → value) for a component instance.
 * Returns an empty object when the instance has no slot yet.
 */
export function getComponentInstanceVars(instanceId: string): Record<string, unknown> {
  const state = globalStore.getState();
  const instances = state.data['_componentInstances'] as Record<string, Record<string, unknown>> | undefined;
  return instances?.[instanceId] ?? {};
}

/**
 * Check whether a UUID belongs to a component instance's variable slot.
 */
export function isComponentInstanceVar(instanceId: string, uuid: string): boolean {
  const instances = (globalStore.getState().data['_componentInstances'] as Record<string, Record<string, unknown>> | undefined) ?? {};
  return instanceId in instances && uuid in (instances[instanceId] ?? {});
}

// ── Auto-register static config variables with saveInLocalStorage: true ───────
// Runs once at module load (browser only). No-op on the server.
if (typeof window !== 'undefined') {
  const vars = (variablesJson as { variables: Record<string, VariableDef> }).variables ?? {};
  for (const [uuid, def] of Object.entries(vars)) {
    if (def.saveInLocalStorage) {
      registerStorageVar(uuid, def.initialValue);
    }
  }
}
