/**
 * Fragment registry - reusable JSON UI fragments
 * Reference with $ref: "fragments/name" in layouts or screens
 */

import header from './header.json';
import drawer from './drawer.json';
import announcementBar from './announcement-bar.json';
import storeHeader from './store-header.json';
import storeFooter from './store-footer.json';
import mobileNavDrawer from './mobile-nav-drawer.json';
import searchDrawer from './search-drawer.json';
import cartDrawer from './cart-drawer.json';
import filterDrawer from './filter-drawer.json';
import filterSidebar from './filter-sidebar.json';
import filterChips from './filter-chips.json';
import sortDropdown from './sort-dropdown.json';
import breadcrumb from './breadcrumb.json';
import pagination from './pagination.json';
import productCard from './product-card.json';
import productCardWishlist from './product-card-wishlist.json';
import productCardList from './product-card-list.json';
import productImageGallery from './product-image-gallery.json';
import createProductModal from './modals/createProduct.json';
import editProductModal from './modals/editProduct.json';
import deleteProductModal from './modals/deleteProduct.json';
import sizeGuideModal from './modals/size-guide.json';
import quickViewModal from './modals/quick-view.json';
import megaMenuNavItem from './mega-menu-nav-item.json';
import accountSidebar from './account-sidebar.json';

export const fragments = {
  'fragments/header': header,
  'fragments/drawer': drawer,
  'fragments/announcement-bar': announcementBar,
  'fragments/store-header': storeHeader,
  'fragments/store-footer': storeFooter,
  'fragments/mobile-nav-drawer': mobileNavDrawer,
  'fragments/search-drawer': searchDrawer,
  'fragments/cart-drawer': cartDrawer,
  'fragments/filter-drawer': filterDrawer,
  'fragments/filter-sidebar': filterSidebar,
  'fragments/filter-chips': filterChips,
  'fragments/sort-dropdown': sortDropdown,
  'fragments/breadcrumb': breadcrumb,
  'fragments/pagination': pagination,
  'fragments/product-card': productCard,
  'fragments/product-card-wishlist': productCardWishlist,
  'fragments/product-card-list': productCardList,
  'fragments/product-image-gallery': productImageGallery,
  'fragments/modals/createProduct': createProductModal,
  'fragments/modals/editProduct': editProductModal,
  'fragments/modals/deleteProduct': deleteProductModal,
  'fragments/modals/size-guide': sizeGuideModal,
  'fragments/modals/quick-view': quickViewModal,
  'fragments/mega-menu-nav-item': megaMenuNavItem,
  'fragments/account-sidebar': accountSidebar,
} as const;
