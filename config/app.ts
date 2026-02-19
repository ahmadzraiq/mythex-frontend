/**
 * App config - merges routes, screens, actions, layouts, and fragments
 * Uses config resolver for $ref, $slot, and layout composition
 */

import routes from './routes.json';
import login from './screens/login.json';
import signup from './screens/signup.json';
import dashboard from './screens/dashboard.json';
import products from './screens/products.json';
import forgotPassword from './screens/forgotPassword.json';
import resetPassword from './screens/resetPassword.json';
import profile from './screens/profile.json';
import home from './screens/home.json';
import shop from './screens/shop.json';
import product from './screens/product.json';
import cart from './screens/cart.json';
import checkout from './screens/checkout.json';
import account from './screens/account.json';
import accountOrders from './screens/account-orders.json';
import accountAddresses from './screens/account-addresses.json';
import accountWishlist from './screens/account-wishlist.json';
import accountReturns from './screens/account-returns.json';
import authActions from './actions/auth.json';
import productActions from './actions/products.json';
import layoutActions from './actions/layout.json';
import otherActions from './actions/other.json';
import ecommerceActions from './actions/ecommerce.json';
import { layouts } from './layouts';
import { fragments } from './fragments';
import { resolveScreenConfig } from '@/lib/sdui/config-resolver';

const registry = { layouts, fragments };

const rawScreens = {
  login,
  signup,
  dashboard,
  products,
  forgotPassword,
  resetPassword,
  profile,
  home,
  shop,
  product,
  cart,
  checkout,
  account,
  accountOrders,
  accountAddresses,
  accountWishlist,
  accountReturns,
};

const screens = Object.fromEntries(
  Object.entries(rawScreens).map(([name, screen]) => [
    name,
    resolveScreenConfig(screen as Parameters<typeof resolveScreenConfig>[0], registry),
  ])
) as typeof rawScreens;

const actions = {
  ...authActions,
  ...productActions,
  ...layoutActions,
  ...otherActions,
  ...ecommerceActions,
};

export default {
  ...routes,
  screens,
  actions,
} as const;
