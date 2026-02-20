/**
 * App config - merges routes, screens, actions, layouts, and fragments
 * Uses config resolver for $ref, $slot, and layout composition
 */

import routes from './routes.json';
import login from './screens/login.json';
import signup from './screens/signup.json';
import forgotPassword from './screens/forgotPassword.json';
import resetPassword from './screens/resetPassword.json';
import home from './screens/home.json';
import shop from './screens/shop.json';
import category from './screens/category.json';
import search from './screens/search.json';
import product from './screens/product.json';
import cart from './screens/cart.json';
import checkout from './screens/checkout.json';
import orderConfirmation from './screens/order-confirmation.json';
import account from './screens/account.json';
import accountOrders from './screens/account-orders.json';
import accountAddresses from './screens/account-addresses.json';
import accountWishlist from './screens/account-wishlist.json';
import accountReturns from './screens/account-returns.json';
import accountLoyalty from './screens/account-loyalty.json';
import accountOrderDetails from './screens/account-order-details.json';
import about from './screens/about.json';
import contact from './screens/contact.json';
import faq from './screens/faq.json';
import shippingPolicy from './screens/shipping-policy.json';
import returnsPolicy from './screens/returns-policy.json';
import privacyPolicy from './screens/privacy-policy.json';
import terms from './screens/terms.json';
import sizeGuide from './screens/size-guide.json';
import error500 from './screens/error-500.json';
import maintenance from './screens/maintenance.json';
import emailVerification from './screens/email-verification.json';
import accountActivation from './screens/account-activation.json';
import notFound from './screens/not-found.json';
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
  forgotPassword,
  resetPassword,
  home,
  shop,
  category,
  search,
  product,
  cart,
  checkout,
  orderConfirmation,
  account,
  accountOrders,
  accountAddresses,
  accountWishlist,
  accountReturns,
  accountLoyalty,
  accountOrderDetails,
  about,
  contact,
  faq,
  shippingPolicy,
  returnsPolicy,
  privacyPolicy,
  terms,
  sizeGuide,
  error500,
  maintenance,
  emailVerification,
  accountActivation,
  notFound,
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
