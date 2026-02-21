/**
 * Layout registry - layout structures with $ref and $slot
 * Use with layout: "store" | "account" | "checkoutMinimal" in screen config
 */

import store from './store.json';
import account from './account.json';
import checkoutMinimal from './checkout-minimal.json';

export const layouts = {
  store: store as { structure: object },
  account: account as { structure: object },
  checkoutMinimal: checkoutMinimal as { structure: object },
} as const;
