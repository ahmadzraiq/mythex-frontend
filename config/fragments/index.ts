/**
 * Fragment registry - reusable JSON UI fragments
 * Reference with $ref: "fragments/name" in layouts or screens
 */

import header from './header.json';
import drawer from './drawer.json';
import announcementBar from './announcement-bar.json';
import storeHeader from './store-header.json';
import storeFooter from './store-footer.json';
import productCard from './product-card.json';
import createProductModal from './modals/createProduct.json';
import editProductModal from './modals/editProduct.json';
import deleteProductModal from './modals/deleteProduct.json';

export const fragments = {
  'fragments/header': header,
  'fragments/drawer': drawer,
  'fragments/announcement-bar': announcementBar,
  'fragments/store-header': storeHeader,
  'fragments/store-footer': storeFooter,
  'fragments/product-card': productCard,
  'fragments/modals/createProduct': createProductModal,
  'fragments/modals/editProduct': editProductModal,
  'fragments/modals/deleteProduct': deleteProductModal,
} as const;
