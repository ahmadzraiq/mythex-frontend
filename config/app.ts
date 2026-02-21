/**
 * App config - merges routes, screens, actions, layouts, and fragments
 * Uses config resolver for $ref, $slot, and layout composition
 */

import routes from './routes.json';

// Screens
import home from './screens/home.json';
import cart from './screens/cart.json';
import checkout from './screens/checkout.json';
import product from './screens/product.json';
import collection from './screens/collection.json';
import search from './screens/search.json';
import signIn from './screens/sign-in.json';
import register from './screens/register.json';
import forgotPassword from './screens/forgot-password.json';
import resetPassword from './screens/reset-password.json';
import verify from './screens/verify.json';
import verifyPending from './screens/verify-pending.json';
import accountOrders from './screens/account-orders.json';
import accountOrderDetail from './screens/account-order-detail.json';
import accountAddresses from './screens/account-addresses.json';
import accountProfile from './screens/account-profile.json';
import orderConfirmation from './screens/order-confirmation.json';
import notFound from './screens/not-found.json';

// Actions
import authActions from './actions/auth.json';
import cartActions from './actions/cart.json';
import checkoutActions from './actions/checkout.json';
import accountActions from './actions/account.json';
import productsActions from './actions/products.json';
import layoutActions from './actions/layout.json';

import { layouts } from './layouts';
import { fragments } from './fragments';
import { resolveScreenConfig, type ConfigRegistry } from '@/lib/sdui/config-resolver';

const registry: ConfigRegistry = {
  layouts: layouts as ConfigRegistry['layouts'],
  fragments: fragments as ConfigRegistry['fragments'],
};

const rawScreens = {
  home,
  cart,
  checkout,
  product,
  collection,
  search,
  signIn,
  register,
  forgotPassword,
  resetPassword,
  verify,
  verifyPending,
  accountOrders,
  accountOrderDetail,
  accountAddresses,
  accountProfile,
  orderConfirmation,
  notFound,
};

const screens = Object.fromEntries(
  Object.entries(rawScreens).map(([name, screen]) => [
    name,
    resolveScreenConfig(screen as Parameters<typeof resolveScreenConfig>[0], registry),
  ])
) as unknown as Record<string, { meta?: object; state?: object; ui: object; initActions?: object[] }>;

const actions = {
  ...authActions,
  ...cartActions,
  ...checkoutActions,
  ...accountActions,
  ...productsActions,
  ...layoutActions,
};

export default {
  ...routes,
  screens,
  actions,
} as const;
