/**
 * Layout registry - layout structures with $ref and $slot
 * Use with layout: "authenticated" in screen config
 */

import authenticated from './authenticated.json';
import store from './store.json';

export const layouts = {
  authenticated: authenticated as { structure: object },
  store: store as { structure: object },
} as const;
