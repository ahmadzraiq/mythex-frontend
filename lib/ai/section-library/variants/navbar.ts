/**
 * Navbar variants (5)
 *
 * Slots:
 *   [[BRAND_NAME]]   — brand/store name shown as text (default: "Brand")
 *   [[LOGO_PATH]]    — path to logo image (default: /vendure.svg)
 *   [[SHOP_PATH]]    — CTA button path (default: /shop)
 *
 * All variants include: logo, nav links (nav.collections), theme switcher,
 * cart icon with badge, auth (sign in / Hi {user}).
 */

import type { SectionVariant } from '../types';

// ─── Shared sub-trees ─────────────────────────────────────────────────────────

const THEME_SWITCHER = {
  type: 'Box',
  props: { className: 'relative' },
  children: [
    {
      type: 'Pressable',
      props: { className: 'fixed inset-0 z-40' },
      condition: { var: 'nav.themeMenuOpen' },
      actions: { click: { action: 'closeThemeMenu' } },
    },
    {
      type: 'Pressable',
      id: 'navbar-theme-button',
      props: { className: 'relative z-50 inline-flex items-center justify-center h-8 w-8 rounded hover:bg-[var(--theme-content-text)]/10' },
      actions: { click: { action: 'toggleThemeMenu' } },
      children: [
        { type: 'NavIcon', props: { icon: 'Sun', size: 18, className: 'text-[var(--theme-header-text)]' }, condition: { '==': [{ var: 'nav.colorScheme' }, 'dark'] } },
        { type: 'NavIcon', props: { icon: 'Moon', size: 18, className: 'text-[var(--theme-header-text)]' }, condition: { '!=': [{ var: 'nav.colorScheme' }, 'dark'] } },
      ],
    },
    {
      type: 'Box',
      props: { className: 'absolute right-0 top-full mt-1 w-36 rounded-md border border-[var(--theme-header-border)] bg-[var(--theme-content-bg)] shadow-md z-50 py-1' },
      condition: { var: 'nav.themeMenuOpen' },
      children: [
        { type: 'Pressable', props: { className: 'w-full flex flex-row items-center gap-2 px-3 py-2 hover:bg-[var(--theme-content-text)]/10' }, actions: { click: { action: 'setThemeLight' } }, children: [{ type: 'NavIcon', props: { icon: 'Sun', size: 16, className: 'text-[var(--theme-header-text)]' } }, { type: 'Text', props: { className: 'flex-1 text-left text-sm text-[var(--theme-content-text)]' }, text: 'Light' }, { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)]' }, text: '✓', condition: { '==': [{ var: 'nav.colorScheme' }, 'light'] } }] },
        { type: 'Pressable', props: { className: 'w-full flex flex-row items-center gap-2 px-3 py-2 hover:bg-[var(--theme-content-text)]/10' }, actions: { click: { action: 'setThemeDark' } }, children: [{ type: 'NavIcon', props: { icon: 'Moon', size: 16, className: 'text-[var(--theme-header-text)]' } }, { type: 'Text', props: { className: 'flex-1 text-left text-sm text-[var(--theme-content-text)]' }, text: 'Dark' }, { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)]' }, text: '✓', condition: { '==': [{ var: 'nav.colorScheme' }, 'dark'] } }] },
        { type: 'Pressable', props: { className: 'w-full flex flex-row items-center gap-2 px-3 py-2 hover:bg-[var(--theme-content-text)]/10' }, actions: { click: { action: 'setThemeSystem' } }, children: [{ type: 'NavIcon', props: { icon: 'Monitor', size: 16, className: 'text-[var(--theme-header-text)]' } }, { type: 'Text', props: { className: 'flex-1 text-left text-sm text-[var(--theme-content-text)]' }, text: 'System' }] },
      ],
    },
  ],
};

const CART_BUTTON = {
  type: 'Box',
  id: 'navbar-cart',
  children: [{
    type: 'Pressable',
    id: 'navbar-cart-button',
    props: { className: 'relative inline-flex items-center justify-center h-8 w-8 rounded hover:bg-[var(--theme-content-text)]/10' },
    actions: { click: { action: 'goToCart' } },
    children: [
      { type: 'NavIcon', props: { icon: 'ShoppingBag', size: 18, className: 'text-[var(--theme-header-text)]' } },
      {
        type: 'Box',
        id: 'navbar-cart-badge',
        props: { className: 'absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-[var(--theme-shop-button)] flex items-center justify-center pointer-events-none' },
        condition: { '>': [{ var: ['cart.totalQuantity', 0] }, 0] },
        children: [{ type: 'Text', props: { className: 'text-[var(--theme-shop-buttonText)] text-[9px] font-bold' }, text: { expr: { var: 'cart.totalQuantity' } } }],
      },
    ],
  }],
};

const AUTH_SECTION = {
  type: 'Box',
  id: 'navbar-auth',
  children: [
    {
      type: 'Pressable',
      id: 'navbar-sign-in',
      props: { className: 'inline-flex flex-row items-center h-8 px-2 rounded hover:bg-[var(--theme-content-text)]/10' },
      condition: { '==': [{ var: 'auth.user' }, null] },
      actions: { click: { action: 'navigate', payload: { path: '/sign-in' } } },
      children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-header-text)]' }, text: 'Sign in' }],
    },
    {
      type: 'Box',
      props: { className: 'flex flex-row items-center gap-1' },
      condition: { '!=': [{ var: 'auth.user' }, null] },
      children: [
        { type: 'Pressable', props: { className: 'inline-flex flex-row items-center gap-1.5 h-8 px-2 rounded hover:bg-[var(--theme-content-text)]/10' }, actions: { click: { action: 'navigate', payload: { path: '/account/orders' } } }, children: [{ type: 'NavIcon', props: { icon: 'User', size: 16, className: 'text-[var(--theme-header-text)]' } }, { type: 'Text', props: { className: 'hidden sm:flex text-sm font-medium text-[var(--theme-header-text)]' }, text: 'Hi, {{auth.user.firstName}}' }] },
        { type: 'Pressable', props: { className: 'h-8 px-2 rounded hover:bg-[var(--theme-content-text)]/10' }, actions: { click: { action: 'logout' } }, children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)]' }, text: 'Sign out' }] },
      ],
    },
  ],
};

const NAV_LINKS = {
  type: 'Box',
  id: 'navbar-collections',
  props: { className: 'hidden md:flex flex-row items-center gap-1' },
  children: [{
    type: 'Box',
    map: 'nav.collections',
    key: 'navCollection',
    props: { className: 'contents' },
    children: [{
      type: 'Pressable',
      props: { className: 'px-2 py-1.5 rounded text-sm hover:bg-[var(--theme-content-text)]/10' },
      actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: { var: '$item.slug' } } } },
      children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-header-text)]' }, text: '{{$item.name}}' }],
    }],
  }],
};

// ─── Variant 1: Standard (logo-left · links · icons) ─────────────────────────

export const navbarStandard: SectionVariant = {
  _meta: {
    variantId: 'navbar.standard',
    label: 'Logo left · nav links · cart + auth right',
    bestFor: ['modern', 'minimalist', 'fashion', 'default'],
    requiredSlots: [],
    optionalSlots: ['BRAND_NAME', 'LOGO_PATH'],
    slotDefaults: { BRAND_NAME: 'Brand', LOGO_PATH: '/vendure.svg' },
    statePaths: ['nav', 'cart', 'auth'],
    initActions: ['fetchNavCollections', 'fetchCart'],
  },
  node: {
    type: 'Box',
    id: 'navbar-root',
    props: { className: 'fixed top-0 left-0 right-0 z-50 border-b border-[var(--theme-header-border)] bg-[var(--theme-header-bg)] w-full' },
    children: [{
      type: 'Box',
      id: 'navbar-inner',
      props: { className: 'w-full max-w-screen-xl mx-auto px-4' },
      children: [{
        type: 'Box',
        id: 'navbar-row',
        props: { className: 'w-full flex flex-row items-center justify-between h-16' },
        children: [
          {
            type: 'Box',
            id: 'navbar-left',
            props: { className: 'flex flex-row items-center gap-6' },
            children: [
              { type: 'Pressable', id: 'navbar-logo', actions: { click: { action: 'navigate', payload: { path: '/' } } }, children: [{ type: 'Text', id: 'navbar-brand-name', props: { className: 'text-lg font-bold text-[var(--theme-header-text)]' }, text: '[[BRAND_NAME]]' }] },
              NAV_LINKS,
            ],
          },
          {
            type: 'Box',
            id: 'navbar-right',
            props: { className: 'flex flex-row items-center gap-1' },
            children: [THEME_SWITCHER, CART_BUTTON, AUTH_SECTION],
          },
        ],
      }],
    }],
  },
};

// ─── Variant 2: With search bar ───────────────────────────────────────────────

export const navbarWithSearch: SectionVariant = {
  _meta: {
    variantId: 'navbar.with-search',
    label: 'Logo · search bar center · cart + auth',
    bestFor: ['marketplace', 'modern', 'tech', 'large-catalog'],
    requiredSlots: [],
    optionalSlots: ['BRAND_NAME'],
    slotDefaults: { BRAND_NAME: 'Brand' },
    statePaths: ['nav', 'cart', 'auth'],
    initActions: ['fetchNavCollections', 'fetchCart'],
  },
  node: {
    type: 'Box',
    id: 'navbar-root',
    props: { className: 'fixed top-0 left-0 right-0 z-50 border-b border-[var(--theme-header-border)] bg-[var(--theme-header-bg)] w-full' },
    children: [{
      type: 'Box',
      id: 'navbar-inner',
      props: { className: 'w-full max-w-screen-xl mx-auto px-4' },
      children: [{
        type: 'Box',
        id: 'navbar-row',
        props: { className: 'w-full flex flex-row items-center gap-4 h-16' },
        children: [
          { type: 'Pressable', id: 'navbar-logo', props: { className: 'flex-shrink-0' }, actions: { click: { action: 'navigate', payload: { path: '/' } } }, children: [{ type: 'Text', id: 'navbar-brand-name', props: { className: 'text-lg font-bold text-[var(--theme-header-text)]' }, text: '[[BRAND_NAME]]' }] },
          {
            type: 'Box',
            id: 'navbar-search',
            props: { className: 'flex-1 max-w-md' },
            children: [{
              type: 'Input',
              props: { variant: 'outline', size: 'sm', className: 'w-full !rounded-full !border-gray-200 !bg-gray-50 dark:!border-gray-700 dark:!bg-gray-900' },
              children: [
                { type: 'InputSlot', props: { className: 'pl-3 pointer-events-none' }, children: [{ type: 'NavIcon', props: { icon: 'Search', size: 15, className: '!text-gray-400' } }] },
                { type: 'InputField', props: { placeholder: 'Search products…', placeholderTextColor: '#9ca3af', className: '!text-gray-900 dark:!text-gray-100' }, actions: { change: { action: 'setState', payload: { path: 'screens.search.form.q', value: '$event' } } } },
              ],
            }],
          },
          {
            type: 'Box',
            id: 'navbar-right',
            props: { className: 'flex-shrink-0 flex flex-row items-center gap-1' },
            children: [THEME_SWITCHER, CART_BUTTON, AUTH_SECTION],
          },
        ],
      }],
    }],
  },
};

// ─── Variant 3: Centered logo ─────────────────────────────────────────────────

export const navbarCenteredLogo: SectionVariant = {
  _meta: {
    variantId: 'navbar.centered-logo',
    label: 'Links left · centered logo · cart + auth right',
    bestFor: ['luxury', 'editorial', 'fashion', 'beauty'],
    requiredSlots: [],
    optionalSlots: ['BRAND_NAME'],
    slotDefaults: { BRAND_NAME: 'BRAND' },
    statePaths: ['nav', 'cart', 'auth'],
    initActions: ['fetchNavCollections', 'fetchCart'],
  },
  node: {
    type: 'Box',
    id: 'navbar-root',
    props: { className: 'fixed top-0 left-0 right-0 z-50 border-b border-[var(--theme-header-border)] bg-[var(--theme-header-bg)] w-full' },
    children: [{
      type: 'Box',
      id: 'navbar-inner',
      props: { className: 'w-full max-w-screen-xl mx-auto px-4' },
      children: [{
        type: 'Box',
        id: 'navbar-row',
        props: { className: 'w-full flex flex-row items-center h-16 relative' },
        children: [
          {
            type: 'Box',
            id: 'navbar-left',
            props: { className: 'flex flex-row items-center gap-1' },
            children: [NAV_LINKS],
          },
          {
            type: 'Box',
            id: 'navbar-logo',
            props: { className: 'absolute left-1/2 -translate-x-1/2' },
            children: [{ type: 'Pressable', actions: { click: { action: 'navigate', payload: { path: '/' } } }, children: [{ type: 'Text', id: 'navbar-brand-name', props: { className: 'text-xl font-bold tracking-widest uppercase text-[var(--theme-header-text)]' }, text: '[[BRAND_NAME]]' }] }],
          },
          {
            type: 'Box',
            id: 'navbar-right',
            props: { className: 'ml-auto flex flex-row items-center gap-1' },
            children: [THEME_SWITCHER, CART_BUTTON, AUTH_SECTION],
          },
        ],
      }],
    }],
  },
};

// ─── Variant 4: Transparent / Hero-overlay ────────────────────────────────────

export const navbarTransparent: SectionVariant = {
  _meta: {
    variantId: 'navbar.transparent',
    label: 'Transparent over hero, white text, border on scroll',
    bestFor: ['luxury', 'editorial', 'bold', 'outdoor'],
    requiredSlots: [],
    optionalSlots: ['BRAND_NAME'],
    slotDefaults: { BRAND_NAME: 'Brand' },
    statePaths: ['nav', 'cart', 'auth'],
    initActions: ['fetchNavCollections', 'fetchCart'],
  },
  node: {
    type: 'Box',
    id: 'navbar-root',
    props: { className: 'fixed top-0 left-0 right-0 z-50 w-full bg-transparent border-b border-white/10' },
    children: [{
      type: 'Box',
      id: 'navbar-inner',
      props: { className: 'w-full max-w-screen-xl mx-auto px-4' },
      children: [{
        type: 'Box',
        id: 'navbar-row',
        props: { className: 'w-full flex flex-row items-center justify-between h-16' },
        children: [
          {
            type: 'Box',
            id: 'navbar-left',
            props: { className: 'flex flex-row items-center gap-6' },
            children: [
              { type: 'Pressable', id: 'navbar-logo', actions: { click: { action: 'navigate', payload: { path: '/' } } }, children: [{ type: 'Text', id: 'navbar-brand-name', props: { className: 'text-lg font-bold text-white' }, text: '[[BRAND_NAME]]' }] },
              {
                type: 'Box',
                id: 'navbar-collections',
                props: { className: 'hidden md:flex flex-row items-center gap-1' },
                children: [{ type: 'Box', map: 'nav.collections', key: 'navCollection', props: { className: 'contents' }, children: [{ type: 'Pressable', props: { className: 'px-2 py-1.5 rounded text-sm hover:bg-white/10' }, actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: { var: '$item.slug' } } } }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: '{{$item.name}}' }] }] }],
              },
            ],
          },
          {
            type: 'Box',
            id: 'navbar-right',
            props: { className: 'flex flex-row items-center gap-1' },
            children: [
              { type: 'Pressable', id: 'navbar-cart-button', props: { className: 'relative inline-flex items-center justify-center h-8 w-8 rounded hover:bg-white/10' }, actions: { click: { action: 'goToCart' } }, children: [{ type: 'NavIcon', props: { icon: 'ShoppingBag', size: 18, className: '!text-white' } }, { type: 'Box', id: 'navbar-cart-badge', props: { className: 'absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-[var(--theme-shop-button)] flex items-center justify-center pointer-events-none' }, condition: { '>': [{ var: ['cart.totalQuantity', 0] }, 0] }, children: [{ type: 'Text', props: { className: 'text-[var(--theme-shop-buttonText)] text-[9px] font-bold' }, text: { expr: { var: 'cart.totalQuantity' } } }] }] },
              { type: 'Pressable', id: 'navbar-sign-in', props: { className: 'inline-flex flex-row items-center h-8 px-3 rounded border border-white/40 hover:bg-white/10' }, condition: { '==': [{ var: 'auth.user' }, null] }, actions: { click: { action: 'navigate', payload: { path: '/sign-in' } } }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Sign in' }] },
            ],
          },
        ],
      }],
    }],
  },
};

// ─── Variant 5: Minimal one-row (compact) ────────────────────────────────────

export const navbarMinimal: SectionVariant = {
  _meta: {
    variantId: 'navbar.minimal',
    label: 'Ultra-compact: brand text + cart only, no nav links',
    bestFor: ['minimalist', 'landing', 'campaign', 'single-product'],
    requiredSlots: [],
    optionalSlots: ['BRAND_NAME', 'SHOP_PATH'],
    slotDefaults: { BRAND_NAME: 'Brand', SHOP_PATH: '/shop' },
    statePaths: ['cart', 'auth'],
    initActions: ['fetchCart'],
  },
  node: {
    type: 'Box',
    id: 'navbar-root',
    props: { className: 'fixed top-0 left-0 right-0 z-50 bg-[var(--theme-header-bg)] border-b border-[var(--theme-header-border)] w-full' },
    children: [{
      type: 'Box',
      id: 'navbar-inner',
      props: { className: 'w-full max-w-screen-xl mx-auto px-6' },
      children: [{
        type: 'Box',
        id: 'navbar-row',
        props: { className: 'w-full flex flex-row items-center justify-between h-14' },
        children: [
          { type: 'Pressable', id: 'navbar-logo', actions: { click: { action: 'navigate', payload: { path: '/' } } }, children: [{ type: 'Text', id: 'navbar-brand-name', props: { className: 'text-base font-semibold tracking-tight text-[var(--theme-header-text)]' }, text: '[[BRAND_NAME]]' }] },
          {
            type: 'Box',
            id: 'navbar-right',
            props: { className: 'flex flex-row items-center gap-2' },
            children: [
              CART_BUTTON,
              { type: 'Pressable', id: 'navbar-shop-cta', props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] h-8 px-4 rounded-md text-sm font-medium' }, actions: { click: { action: 'navigate', payload: { path: '[[SHOP_PATH]]' } } }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-shop-buttonText)]' }, text: 'Shop' }] },
            ],
          },
        ],
      }],
    }],
  },
};

export const navbarVariants: SectionVariant[] = [
  navbarStandard,
  navbarWithSearch,
  navbarCenteredLogo,
  navbarTransparent,
  navbarMinimal,
];
