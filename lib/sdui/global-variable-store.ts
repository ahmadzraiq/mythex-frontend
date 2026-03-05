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
  fields?: Array<{ name: string; initialValue?: unknown }>;
};

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
    } else {
      state[uuid] = null;
    }
  }
  return state;
}

const globalStore = createVariableStore({
  initialState: buildInitialState(),
  adapters: [],
});

export function getGlobalVariableStore() {
  return globalStore;
}
