/**
 * Root config - single entry point that imports and assembles all config.
 * App loads only root.ts; no build script or giant root.json.
 */

import routes from './routes.json';
import themeJson from './theme.json';
import dataSourcesJson from './datasources.json';
import sharedComponentsJson from './shared-components.json';

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
import javascriptTest from './screens/javascript-test.json';
import animationTest from './screens/animation-test.json';
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
import techHero from './screens/tech-hero.json';
import calculator from './screens/calculator.json';
import counterExample from './screens/counter-example.json';
import pricingNested from './screens/pricing-nested.json';
import videoHeroTest from './screens/video-hero-test.json';
import responsiveTest from './screens/responsive-test.json';
import sharedComponentTest from './screens/shared-component-test.json';
import navbarTypes from './screens/navbar-types.json';
import navbarFixed from './screens/navbar-fixed.json';
import navbarSticky from './screens/navbar-sticky.json';
import navbarTransparent from './screens/navbar-transparent.json';
import navbarBlur from './screens/navbar-blur.json';
import navbarFloating from './screens/navbar-floating.json';
import navbarCentered from './screens/navbar-centered.json';
import navbarSidebar from './screens/navbar-sidebar.json';
import navbarBottom from './screens/navbar-bottom.json';
import navbarScrollAware from './screens/navbar-scroll-aware.json';
import popoverTest from './screens/popover-test.json';
import animationShowcase from './screens/animation-showcase.json';
import triggersTest from './screens/triggers-test.json';
import workflowCallTest from './screens/workflow-call-test.json';
import datepickerTest from './screens/datepicker-test.json';

// Layouts
import storeLayout from './layouts/store.json';
import accountLayout from './layouts/account.json';
import checkoutMinimalLayout from './layouts/checkout-minimal.json';


// Actions
import authActions from './actions/auth.json';
import cartActions from './actions/cart.json';
import checkoutActions from './actions/checkout.json';
import accountActions from './actions/account.json';
import productsActions from './actions/products.json';
import layoutActions from './actions/layout.json';
import dataSourceActions from './actions/datasource-actions.json';
import workflowTestActions from './actions/workflow-test.json';
import javascriptTestActions from './actions/javascript-test.json';
import animationTestActions from './actions/animation-test.json';
import controlsShowcaseActions from './actions/controls-showcase.json';
import calculatorActions from './actions/calculator.json';
import counterExampleActions from './actions/counter-example.json';
import pricingNestedActions from './actions/pricing-nested.json';
import responsiveTestActions from './actions/responsive-test.json';
import sharedComponentTestActions from './actions/shared-component-test.json';
import popoverTestActions from './actions/popover-test.json';
import animationShowcaseActions from './actions/animation-showcase.json';
import triggersTestActions from './actions/triggers-test.json';
import scComponentShowcaseActions from './actions/sc-component-showcase.json';
import datepickerTestActions from './actions/datepicker-test.json';

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
  javascriptTest,
  animationTest,
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
  techHero,
  calculator,
  counterExample,
  pricingNested,
  videoHeroTest,
  responsiveTest,
  sharedComponentTest,
  navbarTypes,
  navbarFixed,
  navbarSticky,
  navbarTransparent,
  navbarBlur,
  navbarFloating,
  navbarCentered,
  navbarSidebar,
  navbarBottom,
  navbarScrollAware,
  popoverTest,
  animationShowcase,
  triggersTest,
  workflowCallTest,
  datepickerTest,
};

const layouts = {
  store: storeLayout,
  account: accountLayout,
  checkoutMinimal: checkoutMinimalLayout,
};

const fragments = {};

const actions = {
  ...authActions,
  ...cartActions,
  ...checkoutActions,
  ...accountActions,
  ...productsActions,
  ...layoutActions,
  ...dataSourceActions,
  ...workflowTestActions,
  ...javascriptTestActions,
  ...animationTestActions,
  ...controlsShowcaseActions,
  ...calculatorActions,
  ...counterExampleActions,
  ...pricingNestedActions,
  ...responsiveTestActions,
  ...sharedComponentTestActions,
  ...popoverTestActions,
  ...animationShowcaseActions,
  ...triggersTestActions,
  ...scComponentShowcaseActions,
  ...datepickerTestActions,
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
  javascriptTest: javascriptTestActions,
  animationTest: animationTestActions,
  controlsShowcase: controlsShowcaseActions,
  calculator: calculatorActions,
  counterExample: counterExampleActions,
  pricingNested: pricingNestedActions,
  responsiveTest: responsiveTestActions,
  sharedComponentTest: sharedComponentTestActions,
  popoverTest: popoverTestActions,
  animationShowcase: animationShowcaseActions,
  triggersTest: triggersTestActions,
  scComponentShowcase: scComponentShowcaseActions,
  datepickerTest: datepickerTestActions,
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
  sharedComponents: sharedComponentsJson as Record<string, import('./shared-component-types').SharedComponentModel>,
};

export default root;
