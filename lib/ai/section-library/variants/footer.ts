/**
 * Footer variants (4)
 *
 * Slots:
 *   [[BRAND_NAME]]     — brand name shown in footer (default: "Brand")
 *   [[TAGLINE]]        — brand tagline (default: "Quality products, delivered.")
 *   [[COPYRIGHT_YEAR]] — copyright year (default: "2025")
 *
 * State paths: nav.collections (for category links)
 */

import type { SectionVariant } from '../types';

// ─── Variant 1: Multi-column (standard) ──────────────────────────────────────

export const footerStandard: SectionVariant = {
  _meta: {
    variantId: 'footer.standard',
    label: 'Multi-column: brand · categories · links · newsletter',
    bestFor: ['modern', 'fashion', 'default', 'marketplace'],
    requiredSlots: [],
    optionalSlots: ['BRAND_NAME', 'TAGLINE', 'COPYRIGHT_YEAR'],
    slotDefaults: { BRAND_NAME: 'Brand', TAGLINE: 'Quality products, delivered.', COPYRIGHT_YEAR: '2025' },
    statePaths: ['nav'],
    initActions: ['fetchNavCollections'],
  },
  node: {
    type: 'Box',
    id: 'footer-root',
    props: { className: 'w-full border-t border-[var(--theme-header-border)] bg-[var(--theme-footer-bg)]' },
    children: [{
      type: 'Box',
      id: 'footer-inner',
      props: { className: 'w-full max-w-screen-xl mx-auto px-4 py-12' },
      children: [
        {
          type: 'Box',
          id: 'footer-grid',
          props: { className: 'w-full grid grid-cols-1 md:grid-cols-4 gap-8 mb-12' },
          children: [
            {
              type: 'Box',
              id: 'footer-brand',
              props: { className: 'flex flex-col gap-3' },
              children: [
                { type: 'Text', id: 'footer-brand-name', props: { className: 'text-base font-bold text-[var(--theme-footer-text)]' }, text: '[[BRAND_NAME]]' },
                { type: 'Text', id: 'footer-tagline', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] leading-relaxed' }, text: '[[TAGLINE]]' },
                {
                  type: 'Box',
                  id: 'footer-social',
                  props: { className: 'flex flex-row gap-3 mt-2' },
                  children: [
                    { type: 'Pressable', props: { className: 'h-8 w-8 rounded-full border border-[var(--theme-header-border)] flex items-center justify-center hover:bg-[var(--theme-content-text)]/10' }, children: [{ type: 'NavIcon', props: { icon: 'Instagram', size: 15, className: 'text-[var(--theme-footer-text)]' } }] },
                    { type: 'Pressable', props: { className: 'h-8 w-8 rounded-full border border-[var(--theme-header-border)] flex items-center justify-center hover:bg-[var(--theme-content-text)]/10' }, children: [{ type: 'NavIcon', props: { icon: 'Twitter', size: 15, className: 'text-[var(--theme-footer-text)]' } }] },
                    { type: 'Pressable', props: { className: 'h-8 w-8 rounded-full border border-[var(--theme-header-border)] flex items-center justify-center hover:bg-[var(--theme-content-text)]/10' }, children: [{ type: 'NavIcon', props: { icon: 'Facebook', size: 15, className: 'text-[var(--theme-footer-text)]' } }] },
                  ],
                },
              ],
            },
            {
              type: 'Box',
              children: [
                { type: 'Text', props: { className: 'text-sm font-semibold mb-4 text-[var(--theme-footer-text)] uppercase tracking-wider' }, text: 'Shop' },
                { type: 'Box', props: { className: 'flex flex-col gap-2' }, children: [{ type: 'Box', map: 'nav.collections', key: 'footerCol', props: { className: 'contents' }, children: [{ type: 'Pressable', actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: { var: '$item.slug' } } } }, children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] hover:text-[var(--theme-footer-text)]' }, text: '{{$item.name}}' }] }] }] },
              ],
            },
            {
              type: 'Box',
              children: [
                { type: 'Text', props: { className: 'text-sm font-semibold mb-4 text-[var(--theme-footer-text)] uppercase tracking-wider' }, text: 'Help' },
                { type: 'Box', props: { className: 'flex flex-col gap-2' }, children: [
                  { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] hover:text-[var(--theme-footer-text)]' }, text: 'FAQ' }] },
                  { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] hover:text-[var(--theme-footer-text)]' }, text: 'Shipping & Returns' }] },
                  { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] hover:text-[var(--theme-footer-text)]' }, text: 'Size Guide' }] },
                  { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] hover:text-[var(--theme-footer-text)]' }, text: 'Contact Us' }] },
                ] },
              ],
            },
            {
              type: 'Box',
              id: 'footer-newsletter',
              children: [
                { type: 'Text', props: { className: 'text-sm font-semibold mb-2 text-[var(--theme-footer-text)] uppercase tracking-wider' }, text: 'Stay in the loop' },
                { type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] mb-4' }, text: 'Get new arrivals and exclusive offers.' },
                { type: 'Box', props: { className: 'flex flex-row items-center gap-2' }, children: [
                  { type: 'Input', props: { variant: 'outline', size: 'sm', className: 'flex-1 !rounded-md !border-gray-300 dark:!border-gray-600' }, children: [{ type: 'InputField', props: { placeholder: 'Email address', placeholderTextColor: '#9ca3af', className: '!text-[var(--theme-footer-text)]' } }] },
                  { type: 'Button', props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] !rounded-md' }, children: [{ type: 'ButtonText', text: 'Join' }] },
                ] },
              ],
            },
          ],
        },
        {
          type: 'Box',
          id: 'footer-bottom',
          props: { className: 'w-full pt-8 border-t border-[var(--theme-header-border)] flex flex-col md:flex-row justify-between items-center gap-4' },
          children: [
            { type: 'Text', id: 'footer-copyright', props: { className: 'text-sm text-[var(--theme-footer-textMuted)]' }, text: '© [[COPYRIGHT_YEAR]] [[BRAND_NAME]]. All rights reserved.' },
            { type: 'Box', props: { className: 'flex flex-row gap-4' }, children: [
              { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-xs text-[var(--theme-footer-textMuted)] hover:underline' }, text: 'Privacy Policy' }] },
              { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-xs text-[var(--theme-footer-textMuted)] hover:underline' }, text: 'Terms of Service' }] },
            ] },
          ],
        },
      ],
    }],
  },
};

// ─── Variant 2: Minimal single-row ───────────────────────────────────────────

export const footerMinimal: SectionVariant = {
  _meta: {
    variantId: 'footer.minimal',
    label: 'Single row: brand name left · links right · copyright',
    bestFor: ['minimalist', 'landing', 'campaign', 'single-product'],
    requiredSlots: [],
    optionalSlots: ['BRAND_NAME', 'COPYRIGHT_YEAR'],
    slotDefaults: { BRAND_NAME: 'Brand', COPYRIGHT_YEAR: '2025' },
    statePaths: [],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'footer-root',
    props: { className: 'w-full border-t border-[var(--theme-header-border)] bg-[var(--theme-footer-bg)] py-6 px-4' },
    children: [{
      type: 'Box',
      id: 'footer-inner',
      props: { className: 'w-full max-w-screen-xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4' },
      children: [
        { type: 'Text', id: 'footer-brand-name', props: { className: 'text-sm font-semibold text-[var(--theme-footer-text)]' }, text: '[[BRAND_NAME]]' },
        { type: 'Box', props: { className: 'flex flex-row gap-6' }, children: [
          { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] hover:underline' }, text: 'About' }] },
          { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] hover:underline' }, text: 'Contact' }] },
          { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] hover:underline' }, text: 'Privacy' }] },
        ] },
        { type: 'Text', id: 'footer-copyright', props: { className: 'text-xs text-[var(--theme-footer-textMuted)]' }, text: '© [[COPYRIGHT_YEAR]] [[BRAND_NAME]]' },
      ],
    }],
  },
};

// ─── Variant 3: Dark brand footer ────────────────────────────────────────────

export const footerDark: SectionVariant = {
  _meta: {
    variantId: 'footer.dark',
    label: 'Dark background with brand statement and social icons',
    bestFor: ['luxury', 'editorial', 'bold', 'streetwear'],
    requiredSlots: [],
    optionalSlots: ['BRAND_NAME', 'TAGLINE', 'COPYRIGHT_YEAR'],
    slotDefaults: { BRAND_NAME: 'Brand', TAGLINE: 'Crafted with purpose.', COPYRIGHT_YEAR: '2025' },
    statePaths: ['nav'],
    initActions: ['fetchNavCollections'],
  },
  node: {
    type: 'Box',
    id: 'footer-root',
    props: { className: 'w-full bg-gray-950 dark:bg-black' },
    children: [{
      type: 'Box',
      id: 'footer-inner',
      props: { className: 'w-full max-w-screen-xl mx-auto px-4 py-16' },
      children: [
        {
          type: 'Box',
          id: 'footer-top',
          props: { className: 'flex flex-col md:flex-row justify-between gap-12 mb-12' },
          children: [
            {
              type: 'Box',
              id: 'footer-brand',
              props: { className: 'flex flex-col gap-4 max-w-xs' },
              children: [
                { type: 'Text', id: 'footer-brand-name', props: { className: 'text-2xl font-bold text-white tracking-tight' }, text: '[[BRAND_NAME]]' },
                { type: 'Text', id: 'footer-tagline', props: { className: 'text-sm text-gray-400 leading-relaxed' }, text: '[[TAGLINE]]' },
                { type: 'Box', props: { className: 'flex flex-row gap-3 mt-2' }, children: [
                  { type: 'Pressable', props: { className: 'h-9 w-9 rounded-full border border-gray-700 flex items-center justify-center hover:border-gray-500' }, children: [{ type: 'NavIcon', props: { icon: 'Instagram', size: 16, color: '#9ca3af' } }] },
                  { type: 'Pressable', props: { className: 'h-9 w-9 rounded-full border border-gray-700 flex items-center justify-center hover:border-gray-500' }, children: [{ type: 'NavIcon', props: { icon: 'Twitter', size: 16, color: '#9ca3af' } }] },
                  { type: 'Pressable', props: { className: 'h-9 w-9 rounded-full border border-gray-700 flex items-center justify-center hover:border-gray-500' }, children: [{ type: 'NavIcon', props: { icon: 'Youtube', size: 16, color: '#9ca3af' } }] },
                ] },
              ],
            },
            {
              type: 'Box',
              props: { className: 'flex flex-row flex-wrap gap-12' },
              children: [
                { type: 'Box', children: [
                  { type: 'Text', props: { className: 'text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4' }, text: 'Shop' },
                  { type: 'Box', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Box', map: 'nav.collections', key: 'footerCol', props: { className: 'contents' }, children: [{ type: 'Pressable', actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: { var: '$item.slug' } } } }, children: [{ type: 'Text', props: { className: 'text-sm text-gray-400 hover:text-white' }, text: '{{$item.name}}' }] }] }] },
                ] },
                { type: 'Box', children: [
                  { type: 'Text', props: { className: 'text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4' }, text: 'Company' },
                  { type: 'Box', props: { className: 'flex flex-col gap-3' }, children: [
                    { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-gray-400 hover:text-white' }, text: 'About' }] },
                    { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-gray-400 hover:text-white' }, text: 'Careers' }] },
                    { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-gray-400 hover:text-white' }, text: 'Press' }] },
                  ] },
                ] },
                { type: 'Box', children: [
                  { type: 'Text', props: { className: 'text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4' }, text: 'Support' },
                  { type: 'Box', props: { className: 'flex flex-col gap-3' }, children: [
                    { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-gray-400 hover:text-white' }, text: 'FAQ' }] },
                    { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-gray-400 hover:text-white' }, text: 'Shipping' }] },
                    { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-sm text-gray-400 hover:text-white' }, text: 'Returns' }] },
                  ] },
                ] },
              ],
            },
          ],
        },
        {
          type: 'Box',
          id: 'footer-bottom',
          props: { className: 'pt-8 border-t border-gray-800 flex flex-col md:flex-row justify-between items-center gap-4' },
          children: [
            { type: 'Text', id: 'footer-copyright', props: { className: 'text-xs text-gray-600' }, text: '© [[COPYRIGHT_YEAR]] [[BRAND_NAME]]. All rights reserved.' },
            { type: 'Box', props: { className: 'flex flex-row gap-4' }, children: [
              { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-xs text-gray-600 hover:text-gray-400' }, text: 'Privacy Policy' }] },
              { type: 'Pressable', children: [{ type: 'Text', props: { className: 'text-xs text-gray-600 hover:text-gray-400' }, text: 'Terms' }] },
            ] },
          ],
        },
      ],
    }],
  },
};

// ─── Variant 4: Centered / symmetrical ───────────────────────────────────────

export const footerCentered: SectionVariant = {
  _meta: {
    variantId: 'footer.centered',
    label: 'Centered layout: logo · tagline · links in a row',
    bestFor: ['warm', 'artisan', 'boutique', 'beauty'],
    requiredSlots: [],
    optionalSlots: ['BRAND_NAME', 'TAGLINE', 'COPYRIGHT_YEAR'],
    slotDefaults: { BRAND_NAME: 'Brand', TAGLINE: 'Made with love.', COPYRIGHT_YEAR: '2025' },
    statePaths: ['nav'],
    initActions: ['fetchNavCollections'],
  },
  node: {
    type: 'Box',
    id: 'footer-root',
    props: { className: 'w-full border-t border-[var(--theme-header-border)] bg-[var(--theme-footer-bg)] py-12 px-4' },
    children: [{
      type: 'Box',
      id: 'footer-inner',
      props: { className: 'w-full max-w-screen-xl mx-auto flex flex-col items-center gap-8' },
      children: [
        { type: 'Text', id: 'footer-brand-name', props: { className: 'text-xl font-bold text-[var(--theme-footer-text)] text-center' }, text: '[[BRAND_NAME]]' },
        { type: 'Text', id: 'footer-tagline', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] text-center max-w-sm' }, text: '[[TAGLINE]]' },
        {
          type: 'Box',
          id: 'footer-nav-links',
          props: { className: 'flex flex-row flex-wrap justify-center gap-x-6 gap-y-2' },
          children: [{ type: 'Box', map: 'nav.collections', key: 'footerCol', props: { className: 'contents' }, children: [{ type: 'Pressable', actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: { var: '$item.slug' } } } }, children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-footer-textMuted)] hover:text-[var(--theme-footer-text)]' }, text: '{{$item.name}}' }] }] }],
        },
        {
          type: 'Box',
          id: 'footer-social',
          props: { className: 'flex flex-row gap-4' },
          children: [
            { type: 'Pressable', children: [{ type: 'NavIcon', props: { icon: 'Instagram', size: 18, className: 'text-[var(--theme-footer-textMuted)] hover:text-[var(--theme-footer-text)]' } }] },
            { type: 'Pressable', children: [{ type: 'NavIcon', props: { icon: 'Pinterest', size: 18, className: 'text-[var(--theme-footer-textMuted)] hover:text-[var(--theme-footer-text)]' } }] },
            { type: 'Pressable', children: [{ type: 'NavIcon', props: { icon: 'Twitter', size: 18, className: 'text-[var(--theme-footer-textMuted)] hover:text-[var(--theme-footer-text)]' } }] },
          ],
        },
        { type: 'Text', id: 'footer-copyright', props: { className: 'text-xs text-[var(--theme-footer-textMuted)] text-center' }, text: '© [[COPYRIGHT_YEAR]] [[BRAND_NAME]]. All rights reserved.' },
      ],
    }],
  },
};

export const footerVariants: SectionVariant[] = [
  footerStandard,
  footerMinimal,
  footerDark,
  footerCentered,
];
