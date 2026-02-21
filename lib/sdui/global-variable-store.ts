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

// The global variable store only owns screen-scoped state (screens.*).
// Global data like nav, auth, cart, etc. is managed exclusively by the Zustand store
// (sdui-store.ts) and flows into the renderer via computeMergedState.
// Keeping them here too would cause the stale initial values to overwrite
// freshly fetched Zustand data in the shallow merge inside sdui-engine.tsx.
const globalStore = createVariableStore({
  initialState: {
    screens: {} as Record<string, Record<string, unknown>>,
    collectionSkip: 0,
    sortMenuOpen: false,
    product: { selectedOptions: {} as Record<string, string>, imageIndex: 0 },
  },
  adapters: [],
});

export function getGlobalVariableStore() {
  return globalStore;
}
