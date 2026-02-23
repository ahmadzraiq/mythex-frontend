/**
 * Navbar node IDs - single source of truth for override-targetable nodes.
 * When adding `id` to a navbar fragment, add it here so the AI knows about it.
 */

export const NAVBAR_NODE_IDS = [
  'navbar-root',
  'navbar-inner',
  'navbar-row',
  'navbar-left',
  'navbar-right',
  'navbar-actions',
  'navbar-search',
  'navbar-collections',
  'navbar-theme',
  'navbar-cart',
  'navbar-auth',
  'navbar-sign-in',
  'navbar-cart-button',
  'navbar-theme-button',
  'navbar-logo-image',
  'navbar-search-field',
  'navbar-cart-badge',
] as const;

export type NavbarNodeId = (typeof NAVBAR_NODE_IDS)[number];
