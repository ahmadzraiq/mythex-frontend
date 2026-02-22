/**
 * Global Variable Store - Single source of truth for all SDUI state
 * Persists across screens. Path-based get/set. Fine-grained subscriptions.
 *
 * Path conventions:
 * - screens.{screenName}.form.*     - Form values (e.g. screens.signup.form.password)
 * - screens.{screenName}.errors.*  - Validation errors
 * - screens.{screenName}.tabs.*    - Tab state (e.g. screens.shop.tabs.activeTab)
 * - layout.*, auth.*, cart.*, etc. - Global state from store.json
 *
 * Access from anywhere: {{screens.signup.form.password}}, {{screens.shop.tabs.activeTab}}
 * Only components that use a path re-render when that path changes.
 */

import { createVariableStore } from './variable-store';
import storeConfig from '@/config/store-config';

// The global variable store only owns screen-scoped state (screens.*) and paths
// defined in variableStoreInitial. Global data like nav, auth, cart, etc. is
// managed exclusively by the Zustand store and flows into the renderer via computeMergedState.
const variableStoreInitial = (storeConfig as { variableStoreInitial?: Record<string, unknown> }).variableStoreInitial ?? {};
const globalStore = createVariableStore({
  initialState: {
    screens: {} as Record<string, Record<string, unknown>>,
    ...variableStoreInitial,
  },
  adapters: [],
});

export function getGlobalVariableStore() {
  return globalStore;
}
