/**
 * Fragment registry - reusable JSON UI fragments
 * Reference with $ref: "fragments/name" in layouts or screens
 */

import navbar from './navbar.json';
import footer from './footer.json';
import productCard from './product-card.json';
import productImageCarousel from './product-image-carousel.json';
import productInfo from './product-info.json';
import cartDrawer from './cart-drawer.json';
import accountSidebar from './account-sidebar.json';
import facetFilters from './facet-filters.json';
import collectionPagination from './collection-pagination.json';
import searchPagination from './search-pagination.json';

export const fragments = {
  'fragments/navbar': navbar,
  'fragments/footer': footer,
  'fragments/product-card': productCard,
  'fragments/product-image-carousel': productImageCarousel,
  'fragments/product-info': productInfo,
  'fragments/cart-drawer': cartDrawer,
  'fragments/account-sidebar': accountSidebar,
  'fragments/facet-filters': facetFilters,
  'fragments/collection-pagination': collectionPagination,
  'fragments/search-pagination': searchPagination,
} as const;
