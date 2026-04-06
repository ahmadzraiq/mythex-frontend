/**
 * Root config - single entry point that imports and assembles all config.
 * App loads only root.ts; no build script or giant root.json.
 */

import routes from './routes.json';
import themeJson from './theme.json';
import dataSourcesJson from './datasources.json';

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
import workflowTest from './screens/workflow-test.json';
import animationTest from './screens/animation-test.json';
import popupTest from './screens/popup-test.json';
import heroShowcase from './screens/hero-showcase.json';
import pricingCardTest from './screens/pricing-card-test.json';
import stylingTest from './screens/styling-test.json';
import controlsShowcase from './screens/controls-showcase.json';
import exprCssTest from './screens/expr-css-test.json';
import jsonTest from './screens/json-test.json';
import heroSaaSWorkflow from './screens/hero-saas-workflow.json';
import heightFillTest from './screens/height-fill-test.json';
import layeredDepthHero from './screens/layered-depth-hero.json';
import ctaButtonWfit from './screens/cta-button-wfit.json';
import heroLayeredCollage from './screens/hero-layered-collage.json';
import heroLayeredDepth from './screens/hero-layered-depth.json';
import heroOverlayDepth from './screens/hero-overlay-depth.json';
import heroImageFill from './screens/hero-image-fill.json';
import heroAsymmetricDepth from './screens/hero-asymmetric-depth.json';
import landingShowcase from './screens/landing-showcase.json';
import pricing from './screens/pricing.json';
import videoHero from './screens/video-hero.json';

// Layouts
import storeLayout from './layouts/store.json';
import accountLayout from './layouts/account.json';
import checkoutMinimalLayout from './layouts/checkout-minimal.json';

// Fragments
import navbar from './fragments/layout/navbar.json';
import footer from './fragments/layout/footer.json';
import cartDrawer from './fragments/layout/cart-drawer.json';
import accountSidebar from './fragments/layout/account-sidebar.json';
import productCard from './fragments/cards/product-card.json';
import productImageCarousel from './fragments/cards/product-image-carousel.json';
import productInfo from './fragments/product/product-info.json';
import collectionPagination from './fragments/pagination/collection-pagination.json';
import searchPagination from './fragments/pagination/search-pagination.json';
import checkoutContactStep from './fragments/checkout/contact-step.json';
import checkoutShippingStep from './fragments/checkout/shipping-step.json';
import checkoutPaymentStep from './fragments/checkout/payment-step.json';
import collectionLoadingSkeleton from './fragments/sections/collection-loading-skeleton.json';
import searchLoadingSkeleton from './fragments/sections/search-loading-skeleton.json';
import productCarousel from './fragments/sections/product-carousel.json';
import hero from './fragments/sections/hero.json';
import productGrid from './fragments/sections/product-grid.json';
import featureGrid from './fragments/sections/feature-grid.json';

// Actions
import authActions from './actions/auth.json';
import cartActions from './actions/cart.json';
import checkoutActions from './actions/checkout.json';
import accountActions from './actions/account.json';
import productsActions from './actions/products.json';
import layoutActions from './actions/layout.json';
import dataSourceActions from './actions/datasource-actions.json';
import workflowTestActions from './actions/workflow-test.json';
import animationTestActions from './actions/animation-test.json';
import popupTestActions from './actions/popup-test.json';
import controlsShowcaseActions from './actions/controls-showcase.json';

const screens = {
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
  workflowTest,
  animationTest,
  popupTest,
  heroShowcase,
  pricingCardTest,
  stylingTest,
  controlsShowcase,
  exprCssTest,
  jsonTest,
  heroSaaSWorkflow,
  heightFillTest,
  layeredDepthHero,
  ctaButtonWfit,
  heroLayeredCollage,
  heroLayeredDepth,
  heroOverlayDepth,
  heroImageFill,
  heroAsymmetricDepth,
  landingShowcase,
  pricing,
  videoHero,
};

const layouts = {
  store: storeLayout,
  account: accountLayout,
  checkoutMinimal: checkoutMinimalLayout,
};

const fragments = {
  'fragments/layout/navbar': navbar,
  'fragments/layout/footer': footer,
  'fragments/layout/cart-drawer': cartDrawer,
  'fragments/layout/account-sidebar': accountSidebar,
  'fragments/cards/product-card': productCard,
  'fragments/cards/product-image-carousel': productImageCarousel,
  'fragments/product/product-info': productInfo,
  'fragments/pagination/collection-pagination': collectionPagination,
  'fragments/pagination/search-pagination': searchPagination,
  'fragments/checkout/contact-step': checkoutContactStep,
  'fragments/checkout/shipping-step': checkoutShippingStep,
  'fragments/checkout/payment-step': checkoutPaymentStep,
  'fragments/sections/collection-loading-skeleton': collectionLoadingSkeleton,
  'fragments/sections/search-loading-skeleton': searchLoadingSkeleton,
  'fragments/sections/product-carousel': productCarousel,
  'fragments/sections/hero': hero,
  'fragments/sections/product-grid': productGrid,
  'fragments/sections/feature-grid': featureGrid,
};

const actions = {
  ...authActions,
  ...cartActions,
  ...checkoutActions,
  ...accountActions,
  ...productsActions,
  ...layoutActions,
  ...dataSourceActions,
  ...workflowTestActions,
  ...animationTestActions,
  ...popupTestActions,
  ...controlsShowcaseActions,
};

const actionsByFile = {
  auth: authActions,
  cart: cartActions,
  checkout: checkoutActions,
  account: accountActions,
  products: productsActions,
  layout: layoutActions,
  dataSources: dataSourceActions,
  workflowTest: workflowTestActions,
  animationTest: animationTestActions,
  popupTest: popupTestActions,
  controlsShowcase: controlsShowcaseActions,
};

export const root = {
  routes,
  store: {} as Record<string, never>,
  theme: themeJson,
  screens,
  layouts,
  fragments,
  actions,
  actionsByFile,
  dataSources: dataSourcesJson as Record<string, import('./datasource-types').NamedDataSourceDef>,
};

export default root;
