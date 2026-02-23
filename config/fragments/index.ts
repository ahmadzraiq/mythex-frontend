/**
 * Fragment registry - reusable JSON UI fragments
 * Reference with $ref: "fragments/name" in layouts or screens
 * Structure: layout/, sections/, cards/, product/, pagination/, checkout/
 */

import navbar from './layout/navbar.json';
import footer from './layout/footer.json';
import cartDrawer from './layout/cart-drawer.json';
import accountSidebar from './layout/account-sidebar.json';
import productCard from './cards/product-card.json';
import productImageCarousel from './cards/product-image-carousel.json';
import productInfo from './product/product-info.json';
import collectionPagination from './pagination/collection-pagination.json';
import searchPagination from './pagination/search-pagination.json';
import checkoutContactStep from './checkout/contact-step.json';
import checkoutShippingStep from './checkout/shipping-step.json';
import checkoutPaymentStep from './checkout/payment-step.json';
import collectionLoadingSkeleton from './sections/collection-loading-skeleton.json';
import searchLoadingSkeleton from './sections/search-loading-skeleton.json';
import productCarousel from './sections/product-carousel.json';
import hero from './sections/hero.json';
import productGrid from './sections/product-grid.json';
import featureGrid from './sections/feature-grid.json';

export const fragments = {
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
} as const;
