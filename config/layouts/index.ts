/**
 * Layout registry - layout structures with $ref and $slot
 * Use with layout: "authenticated" in screen config
 */

import authenticated from './authenticated.json';
import store from './store.json';
import shop from './shop.json';
import product from './product.json';
import cart from './cart.json';
import checkoutMinimal from './checkout-minimal.json';
import accountLayout from './account.json';

export const layouts = {
  authenticated: authenticated as { structure: object },
  store: store as { structure: object },
  shop: shop as { structure: object },
  product: product as { structure: object },
  cart: cart as { structure: object },
  checkoutMinimal: checkoutMinimal as { structure: object },
  account: accountLayout as { structure: object },
} as const;
