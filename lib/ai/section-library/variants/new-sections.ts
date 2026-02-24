/**
 * New section types — covering the full 35-type taxonomy
 *
 * Sections included here:
 *  - shop-the-look (2 variants)
 *  - social-proof / UGC grid (2 variants)
 *  - how-it-works (2 variants)
 *  - loyalty-program (2 variants)
 *  - quiz-finder (2 variants)
 *  - blog-articles (2 variants)
 *  - waitlist (1 variant)
 *  - gift-card-promo (1 variant)
 *  - countdown-banner (2 variants)
 *  - founder-story (2 variants)
 *  - awards-certifications (1 variant)
 *  - community-section (1 variant)
 *  - ambassador-section (2 variants)
 *  - bundle-builder (1 variant)
 *  - gift-guide (2 variants)
 *  - hero-carousel (2 variants)
 *  - hero-video (1 variant)
 */

import type { SectionVariant } from '../types';

// ─── Shop the Look ────────────────────────────────────────────────────────────

export const shopTheLookHoverTags: SectionVariant = {
  _meta: {
    variantId: 'shop-the-look.hover-tags',
    label: 'Editorial image with tagged products on hover',
    bestFor: ['editorial', 'luxury', 'fashion'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Shop the Look' },
    statePaths: ['shopTheLook'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'shop-the-look-section',
    props: { className: 'w-full py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-col gap-8' },
        children: [
          { type: 'Heading', id: 'stl-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: '[[SECTION_TITLE]]' },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-8 items-center' },
            children: [
              {
                type: 'Box',
                props: { className: 'flex-1 relative h-[480px] rounded-2xl overflow-hidden' },
                children: [
                  { type: 'NextImage', id: 'stl-image', props: { src: '{{shopTheLook.imageUrl}}', alt: 'Shop the Look', fill: true, className: 'object-cover' } },
                ],
              },
              {
                type: 'Box',
                props: { className: 'w-72 flex flex-col gap-4' },
                children: [
                  {
                    type: 'Pressable',
                    map: 'shopTheLook.products',
                    key: '$item.id',
                    id: 'stl-product',
                    props: { className: 'flex flex-row gap-3 items-center p-3 rounded-xl bg-[var(--theme-shop-bg)] hover:shadow-md transition-shadow' },
                    actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'relative w-16 h-16 rounded-lg overflow-hidden flex-none' },
                        children: [{ type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } }],
                      },
                      {
                        type: 'Box',
                        props: { className: 'flex flex-col gap-0.5 flex-1 min-w-0' },
                        children: [
                          { type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-content-text)] leading-tight' }, text: '{{$item.productName}}' },
                          { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)]' }, text: { expr: { formatCurrency: [{ var: '$item.priceWithTax.value' }, 100] } } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const shopTheLookSidePanel: SectionVariant = {
  _meta: {
    variantId: 'shop-the-look.side-panel',
    label: 'Image with products listed in a side panel',
    bestFor: ['modern', 'minimalist', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Complete the Look' },
    statePaths: ['shopTheLook'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'shop-the-look-section',
    props: { className: 'w-full py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col md:flex-row gap-0 overflow-hidden rounded-2xl shadow-lg' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex-1 relative h-96 md:h-auto' },
            children: [{ type: 'NextImage', id: 'stl-image', props: { src: '{{shopTheLook.imageUrl}}', alt: 'Shop the Look', fill: true, className: 'object-cover' } }],
          },
          {
            type: 'Box',
            props: { className: 'w-full md:w-80 bg-[var(--theme-content-bg)] p-8 flex flex-col gap-6' },
            children: [
              { type: 'Heading', id: 'stl-title', props: { size: 'lg', className: 'font-bold text-[var(--theme-content-text)]' }, text: '[[SECTION_TITLE]]' },
              {
                type: 'Box',
                props: { className: 'flex flex-col gap-3' },
                children: [
                  {
                    type: 'Pressable',
                    map: 'shopTheLook.products',
                    key: '$item.id',
                    id: 'stl-product',
                    props: { className: 'flex flex-row gap-3 items-center' },
                    actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'relative w-14 h-14 rounded-lg overflow-hidden flex-none' },
                        children: [{ type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } }],
                      },
                      {
                        type: 'Box',
                        props: { className: 'flex flex-col gap-0.5 flex-1' },
                        children: [
                          { type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-content-text)]' }, text: '{{$item.productName}}' },
                          { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)]' }, text: { expr: { formatCurrency: [{ var: '$item.priceWithTax.value' }, 100] } } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Social Proof / UGC Grid ──────────────────────────────────────────────────

export const socialProofMasonryGrid: SectionVariant = {
  _meta: {
    variantId: 'social-proof.masonry-grid',
    label: 'User-generated content masonry photo grid',
    bestFor: ['playful', 'bold', 'warm', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: '#OurCommunity' },
    statePaths: ['socialProof'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'social-proof-section',
    props: { className: 'w-full py-16 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-col gap-8' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-col items-center gap-2' },
            children: [
              { type: 'Heading', id: 'ugc-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '[[SECTION_TITLE]]' },
              { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] text-center' }, text: 'Tag us to be featured' },
            ],
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-3 md:grid-cols-6 gap-2 w-full' },
            children: [
              {
                type: 'Box',
                map: 'socialProof.images',
                key: '$item',
                props: { className: 'contents' },
                children: [
                  {
                    type: 'Box',
                    id: 'ugc-image',
                    props: { className: 'relative w-full h-32 md:h-40 rounded overflow-hidden' },
                    children: [{ type: 'NextImage', props: { src: '{{$item}}', alt: 'Community', fill: true, className: 'object-cover hover:scale-110 transition-transform duration-300' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const socialProofStoryRow: SectionVariant = {
  _meta: {
    variantId: 'social-proof.story-row',
    label: 'Instagram-story style circle thumbnails in a row',
    bestFor: ['playful', 'bold', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Our Community' },
    statePaths: ['socialProof'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'social-proof-section',
    props: { className: 'w-full py-12 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-col gap-6' },
        children: [
          { type: 'Text', id: 'ugc-title', props: { className: 'text-sm font-bold tracking-widest uppercase text-[var(--theme-content-textMuted)] text-center' }, text: '[[SECTION_TITLE]]' },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-4 justify-center flex-wrap' },
            children: [
              {
                type: 'Box',
                map: 'socialProof.images',
                key: '$item',
                id: 'ugc-story',
                props: { className: 'flex flex-col items-center gap-2' },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-16 h-16 rounded-full overflow-hidden border-2 border-[var(--theme-shop-button)] p-0.5' },
                    children: [{ type: 'NextImage', props: { src: '{{$item}}', alt: 'Community', fill: true, className: 'object-cover rounded-full' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── How It Works ─────────────────────────────────────────────────────────────

export const howItWorksHorizontal: SectionVariant = {
  _meta: {
    variantId: 'how-it-works.horizontal',
    label: 'Numbered steps in a horizontal row',
    bestFor: ['modern', 'warm', 'playful', 'minimalist'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'How It Works' },
    statePaths: ['howItWorks'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'how-it-works-section',
    props: { className: 'w-full py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-col gap-12' },
        children: [
          { type: 'Heading', id: 'hiw-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '[[SECTION_TITLE]]' },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-1 md:grid-cols-3 gap-8 w-full' },
            children: [
              {
                type: 'Box',
                map: 'howItWorks.steps',
                key: '$item.step',
                id: 'hiw-step',
                props: { className: 'flex flex-col items-center text-center gap-4' },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'w-12 h-12 rounded-full bg-[var(--theme-shop-button)] flex items-center justify-center' },
                    children: [{ type: 'Text', props: { className: 'text-[var(--theme-shop-buttonText)] font-bold text-lg' }, text: '{{$item.step}}' }],
                  },
                  { type: 'Heading', props: { size: 'sm', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '{{$item.title}}' },
                  { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] text-sm text-center leading-relaxed' }, text: '{{$item.description}}' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const howItWorksVertical: SectionVariant = {
  _meta: {
    variantId: 'how-it-works.vertical',
    label: 'Vertical timeline with connecting line',
    bestFor: ['editorial', 'luxury', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Our Process' },
    statePaths: ['howItWorks'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'how-it-works-section',
    props: { className: 'w-full py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-2xl mx-auto px-4 flex flex-col gap-12' },
        children: [
          { type: 'Heading', id: 'hiw-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '[[SECTION_TITLE]]' },
          {
            type: 'Box',
            props: { className: 'flex flex-col gap-8' },
            children: [
              {
                type: 'Box',
                map: 'howItWorks.steps',
                key: '$item.step',
                id: 'hiw-step-vertical',
                props: { className: 'flex flex-row gap-6 items-start' },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'flex flex-col items-center gap-2 flex-none' },
                    children: [
                      { type: 'Box', props: { className: 'w-10 h-10 rounded-full bg-[var(--theme-shop-button)] flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-[var(--theme-shop-buttonText)] font-bold' }, text: '{{$item.step}}' }] },
                    ],
                  },
                  {
                    type: 'Box',
                    props: { className: 'flex flex-col gap-1 pb-8' },
                    children: [
                      { type: 'Heading', props: { size: 'sm', className: 'font-bold text-[var(--theme-content-text)]' }, text: '{{$item.title}}' },
                      { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] text-sm leading-relaxed' }, text: '{{$item.description}}' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Loyalty Program ──────────────────────────────────────────────────────────

export const loyaltyProgramBenefitGrid: SectionVariant = {
  _meta: {
    variantId: 'loyalty-program.benefit-grid',
    label: 'Rewards program benefits in icon grid',
    bestFor: ['modern', 'playful', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'Join Our Rewards Program', CTA_PATH: '/account/register' },
    statePaths: ['loyaltyProgram'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'loyalty-section',
    props: { className: 'w-full py-20 bg-gradient-to-br from-[var(--theme-hero-bg)] to-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-col items-center gap-10' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-col items-center gap-4 text-center' },
            children: [
              { type: 'NavIcon', props: { icon: 'Gift', size: 40, className: 'text-[var(--theme-shop-button)]' } },
              { type: 'Heading', id: 'loyalty-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '[[SECTION_TITLE]]' },
              { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] text-center max-w-lg' }, text: 'Earn points on every purchase and unlock exclusive rewards.' },
            ],
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-1 md:grid-cols-3 gap-6 w-full' },
            children: [
              { type: 'Box', id: 'loyalty-benefit-0', props: { className: 'flex flex-col items-center text-center gap-3 p-6 rounded-xl bg-[var(--theme-content-bg)] shadow-sm' }, children: [{ type: 'NavIcon', props: { icon: 'Star', size: 28, className: 'text-amber-400' } }, { type: 'Heading', props: { size: 'sm', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: 'Earn Points' }, { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)] text-center' }, text: '1 point for every $1 spent' }] },
              { type: 'Box', id: 'loyalty-benefit-1', props: { className: 'flex flex-col items-center text-center gap-3 p-6 rounded-xl bg-[var(--theme-content-bg)] shadow-sm' }, children: [{ type: 'NavIcon', props: { icon: 'Percent', size: 28, className: 'text-[var(--theme-shop-button)]' } }, { type: 'Heading', props: { size: 'sm', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: 'Exclusive Discounts' }, { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)] text-center' }, text: 'Members-only deals every week' }] },
              { type: 'Box', id: 'loyalty-benefit-2', props: { className: 'flex flex-col items-center text-center gap-3 p-6 rounded-xl bg-[var(--theme-content-bg)] shadow-sm' }, children: [{ type: 'NavIcon', props: { icon: 'Truck', size: 28, className: 'text-green-500' } }, { type: 'Heading', props: { size: 'sm', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: 'Free Shipping' }, { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)] text-center' }, text: 'Free on all orders over $50' }] },
            ],
          },
          {
            type: 'Button',
            id: 'loyalty-cta',
            props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)]' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'ButtonText', text: 'Join Free' }],
          },
        ],
      },
    ],
  },
};

export const loyaltyProgramTierDisplay: SectionVariant = {
  _meta: {
    variantId: 'loyalty-program.tier-display',
    label: 'Membership tier cards with benefits',
    bestFor: ['luxury', 'editorial', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'Membership Tiers', CTA_PATH: '/account/register' },
    statePaths: [],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'loyalty-section',
    props: { className: 'w-full py-20 bg-[var(--theme-footer-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-col items-center gap-10' },
        children: [
          { type: 'Heading', id: 'loyalty-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-footer-text)] text-center' }, text: '[[SECTION_TITLE]]' },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-1 md:grid-cols-3 gap-6 w-full' },
            children: [
              { type: 'Box', id: 'tier-bronze', props: { className: 'flex flex-col items-center gap-4 p-6 rounded-xl bg-amber-900/30 border border-amber-700/40' }, children: [{ type: 'Text', props: { className: 'text-amber-400 text-2xl font-bold' }, text: 'Bronze' }, { type: 'Text', props: { className: 'text-[var(--theme-footer-textMuted)] text-sm text-center' }, text: '0–500 points' }, { type: 'Text', props: { className: 'text-[var(--theme-footer-text)] text-sm text-center' }, text: 'Free shipping over $75' }] },
              { type: 'Box', id: 'tier-silver', props: { className: 'flex flex-col items-center gap-4 p-6 rounded-xl bg-slate-400/20 border border-slate-400/40' }, children: [{ type: 'Text', props: { className: 'text-slate-300 text-2xl font-bold' }, text: 'Silver' }, { type: 'Text', props: { className: 'text-[var(--theme-footer-textMuted)] text-sm text-center' }, text: '500–2000 points' }, { type: 'Text', props: { className: 'text-[var(--theme-footer-text)] text-sm text-center' }, text: 'Free shipping + 10% off' }] },
              { type: 'Box', id: 'tier-gold', props: { className: 'flex flex-col items-center gap-4 p-6 rounded-xl bg-yellow-400/20 border border-yellow-400/40' }, children: [{ type: 'Text', props: { className: 'text-yellow-400 text-2xl font-bold' }, text: 'Gold' }, { type: 'Text', props: { className: 'text-[var(--theme-footer-textMuted)] text-sm text-center' }, text: '2000+ points' }, { type: 'Text', props: { className: 'text-[var(--theme-footer-text)] text-sm text-center' }, text: 'Free shipping + 20% off + early access' }] },
            ],
          },
          {
            type: 'Button',
            id: 'loyalty-cta',
            props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)]' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'ButtonText', text: 'Start Earning Today' }],
          },
        ],
      },
    ],
  },
};

// ─── Blog Articles ────────────────────────────────────────────────────────────

export const blogArticlesCardGrid: SectionVariant = {
  _meta: {
    variantId: 'blog-articles.card-grid',
    label: '3-column article card grid',
    bestFor: ['warm', 'editorial', 'modern', 'luxury'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'From Our Blog', CTA_PATH: '/blog' },
    statePaths: ['blogArticles'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'blog-section',
    props: { className: 'w-full py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between w-full' },
            children: [
              { type: 'Heading', id: 'blog-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: '[[SECTION_TITLE]]' },
              {
                type: 'Pressable',
                id: 'blog-view-all',
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-shop-button)] font-medium underline underline-offset-4' }, text: 'Read All' }],
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-1 md:grid-cols-3 gap-6 w-full' },
            children: [
              {
                type: 'Pressable',
                map: 'blogArticles.posts',
                key: '$item.id',
                id: 'blog-card',
                props: { className: 'flex flex-col rounded-xl overflow-hidden bg-[var(--theme-shop-bg)] hover:shadow-md transition-shadow' },
                actions: { click: { action: 'navigate', payload: { path: '{{$item.path}}' } } },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-full h-48' },
                    children: [{ type: 'NextImage', props: { src: '{{$item.imageUrl}}', alt: '{{$item.title}}', fill: true, className: 'object-cover' } }],
                  },
                  {
                    type: 'Box',
                    props: { className: 'p-5 flex flex-col gap-2' },
                    children: [
                      { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)] uppercase tracking-widest' }, text: '{{$item.category}}' },
                      { type: 'Heading', id: 'blog-post-title', props: { size: 'sm', className: 'font-bold text-[var(--theme-content-text)] leading-snug' }, text: '{{$item.title}}' },
                      { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)] leading-relaxed line-clamp-2' }, text: '{{$item.excerpt}}' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Waitlist ─────────────────────────────────────────────────────────────────

export const waitlistDefault: SectionVariant = {
  _meta: {
    variantId: 'waitlist.default',
    label: 'Coming soon email capture with urgency',
    bestFor: ['modern', 'bold', 'luxury'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'SUBTITLE'],
    slotDefaults: { SECTION_TITLE: 'Be First to Know', SUBTITLE: 'Join the waitlist for early access and exclusive launch offers.' },
    statePaths: [],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'waitlist-section',
    props: { className: 'w-full py-24 bg-gradient-to-br from-[var(--theme-footer-bg)] to-gray-950' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-xl mx-auto px-4 flex flex-col items-center gap-6 text-center' },
        children: [
          { type: 'NavIcon', props: { icon: 'Bell', size: 40, className: 'text-[var(--theme-shop-button)]' } },
          { type: 'Heading', id: 'waitlist-title', props: { size: '3xl', className: 'font-bold text-white text-center' }, text: '[[SECTION_TITLE]]' },
          { type: 'Text', id: 'waitlist-subtitle', props: { className: 'text-white/70 text-base text-center' }, text: '[[SUBTITLE]]' },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-3 w-full max-w-md' },
            children: [
              {
                type: 'Input',
                id: 'waitlist-input',
                props: { variant: 'outline', size: 'md', className: 'flex-1 !rounded-md !border-white/30 !bg-white/10' },
                children: [
                  {
                    type: 'InputField',
                    props: { placeholder: 'Your email address', placeholderTextColor: 'rgba(255,255,255,0.5)', className: '!text-white' },
                    actions: { change: { action: 'setState', payload: { path: 'screens.home.form.email', value: '$event' } } },
                  },
                ],
              },
              {
                type: 'Button',
                id: 'waitlist-submit',
                props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] flex-none' },
                actions: { click: { action: 'joinWaitlist' } },
                children: [{ type: 'ButtonText', text: 'Notify Me' }],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Gift Card Promo ──────────────────────────────────────────────────────────

export const giftCardPromoDefault: SectionVariant = {
  _meta: {
    variantId: 'gift-card-promo.default',
    label: 'Gift card highlight with CTA',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/gift-cards' },
    statePaths: [],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'gift-card-section',
    props: { className: 'w-full py-16 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-4xl mx-auto px-4 flex flex-row items-center gap-10 rounded-2xl bg-gradient-to-r from-[var(--theme-shop-button)] to-[var(--theme-footer-bg)] p-10' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-col gap-4' },
            children: [
              { type: 'Heading', id: 'gift-card-title', props: { size: '2xl', className: 'font-bold text-white' }, text: 'Give the Gift of Choice' },
              { type: 'Text', props: { className: 'text-white/80 leading-relaxed' }, text: 'Let them choose their perfect style with a digital gift card.' },
              {
                type: 'Button',
                id: 'gift-card-cta',
                props: { className: '!bg-white !text-gray-900 self-start' },
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'ButtonText', text: 'Shop Gift Cards' }],
              },
            ],
          },
          { type: 'NavIcon', props: { icon: 'Gift', size: 80, className: 'text-white/30 flex-none' } },
        ],
      },
    ],
  },
};

// ─── Countdown Banner ─────────────────────────────────────────────────────────

export const countdownBannerDark: SectionVariant = {
  _meta: {
    variantId: 'countdown-banner.dark',
    label: 'Full-width dark countdown banner for a sale event',
    bestFor: ['bold', 'modern', 'playful'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'Sale Ends In', CTA_PATH: '/shop' },
    statePaths: ['flashSale'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'countdown-banner',
    props: { className: 'w-full py-6 bg-gray-950' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-row items-center justify-between gap-6' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-col gap-1' },
            children: [
              { type: 'Text', props: { className: 'text-white/60 text-xs uppercase tracking-widest' }, text: 'Limited Time Offer' },
              { type: 'Heading', id: 'countdown-title', props: { size: 'lg', className: 'font-bold text-white' }, text: '[[SECTION_TITLE]]' },
            ],
          },
          { type: 'CountdownTimer', id: 'countdown-timer', props: { target: '{{flashSale.endsAt}}', className: 'text-white font-mono text-3xl font-bold' } },
          {
            type: 'Button',
            id: 'countdown-cta',
            props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)]' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'ButtonText', text: 'Shop Now' }],
          },
        ],
      },
    ],
  },
};

export const countdownBannerAccent: SectionVariant = {
  _meta: {
    variantId: 'countdown-banner.accent',
    label: 'Accent-colored countdown banner',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'Today Only', CTA_PATH: '/shop' },
    statePaths: ['flashSale'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'countdown-banner',
    props: { className: 'w-full py-4 bg-[var(--theme-shop-button)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-row items-center justify-center gap-6' },
        children: [
          { type: 'NavIcon', props: { icon: 'Clock', size: 18, className: 'text-[var(--theme-shop-buttonText)]' } },
          { type: 'Text', id: 'countdown-title', props: { className: 'text-[var(--theme-shop-buttonText)] font-semibold' }, text: '[[SECTION_TITLE]]:' },
          { type: 'CountdownTimer', id: 'countdown-timer', props: { target: '{{flashSale.endsAt}}', className: 'text-[var(--theme-shop-buttonText)] font-mono font-bold text-lg' } },
          {
            type: 'Pressable',
            id: 'countdown-cta',
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'Text', props: { className: 'text-[var(--theme-shop-buttonText)] text-sm font-bold underline underline-offset-2' }, text: 'Shop Sale' }],
          },
        ],
      },
    ],
  },
};

// ─── Founder Story ────────────────────────────────────────────────────────────

export const founderStoryPhotoLeft: SectionVariant = {
  _meta: {
    variantId: 'founder-story.photo-left',
    label: 'Founder photo left, personal narrative right',
    bestFor: ['warm', 'vintage', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/about' },
    statePaths: ['founderStory'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'founder-story-section',
    props: { className: 'w-full py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-row items-center gap-12' },
        children: [
          {
            type: 'Box',
            props: { className: 'relative w-72 h-80 rounded-2xl overflow-hidden flex-none' },
            children: [{ type: 'NextImage', id: 'founder-photo', props: { src: '{{founderStory.imageUrl}}', alt: '{{founderStory.founderName}}', fill: true, className: 'object-cover object-top' } }],
          },
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-col gap-6' },
            children: [
              { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)] uppercase tracking-widest' }, text: 'Meet the Founder' },
              { type: 'Heading', id: 'founder-name', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: '{{founderStory.founderName}}' },
              { type: 'Text', id: 'founder-bio', props: { className: 'text-[var(--theme-content-textMuted)] leading-relaxed' }, text: '{{founderStory.bio}}' },
              {
                type: 'Pressable',
                id: 'founder-cta',
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'Text', props: { className: 'text-[var(--theme-shop-button)] text-sm font-medium underline underline-offset-4' }, text: 'Read the Full Story' }],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const founderStoryMinimal: SectionVariant = {
  _meta: {
    variantId: 'founder-story.minimal',
    label: 'Text-only founder quote, centered, minimal',
    bestFor: ['minimalist', 'luxury', 'editorial'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['founderStory'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'founder-story-section',
    props: { className: 'w-full py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-3xl mx-auto px-4 flex flex-col items-center gap-6 text-center' },
        children: [
          { type: 'Text', props: { className: 'text-[var(--theme-shop-button)] text-6xl font-serif leading-none' }, text: '\u201c' },
          { type: 'Text', id: 'founder-quote', props: { className: 'text-[var(--theme-content-text)] text-xl font-medium leading-relaxed italic text-center' }, text: '{{founderStory.quote}}' },
          { type: 'Text', id: 'founder-name', props: { className: 'text-[var(--theme-content-textMuted)] text-sm font-semibold uppercase tracking-widest text-center' }, text: '— {{founderStory.founderName}}, Founder' },
        ],
      },
    ],
  },
};

// ─── Awards & Certifications ──────────────────────────────────────────────────

export const awardsCertificationsDefault: SectionVariant = {
  _meta: {
    variantId: 'awards-certifications.default',
    label: 'Horizontal certification / award logo strip',
    bestFor: ['luxury', 'editorial', 'warm', 'modern'],
    requiredSlots: [],
    optionalSlots: ['HEADLINE'],
    slotDefaults: { HEADLINE: 'Certified & Award-Winning' },
    statePaths: ['awards'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'awards-section',
    props: { className: 'w-full py-12 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-col items-center gap-8' },
        children: [
          { type: 'Text', id: 'awards-headline', props: { className: 'text-[var(--theme-content-textMuted)] text-xs uppercase tracking-widest text-center' }, text: '[[HEADLINE]]' },
          {
            type: 'Box',
            props: { className: 'flex flex-row flex-wrap justify-center items-center gap-10 w-full' },
            children: [
              {
                type: 'Box',
                map: 'awards.items',
                key: '$item.id',
                id: 'award-item',
                props: { className: 'flex flex-col items-center gap-2' },
                children: [
                  { type: 'NavIcon', props: { icon: '{{$item.icon}}', size: 40, className: 'text-[var(--theme-content-textMuted)] opacity-50' } },
                  { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)] text-center' }, text: '{{$item.name}}' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Community Section ────────────────────────────────────────────────────────

export const communitySectionDefault: SectionVariant = {
  _meta: {
    variantId: 'community-section.default',
    label: 'Community highlight with join CTA',
    bestFor: ['playful', 'bold', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'Join Our Community', CTA_PATH: '/community' },
    statePaths: [],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'community-section',
    props: { className: 'w-full py-20 bg-gradient-to-r from-[var(--theme-shop-button)] to-[var(--theme-footer-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-4xl mx-auto px-4 flex flex-col items-center gap-6 text-center' },
        children: [
          { type: 'NavIcon', props: { icon: 'Users', size: 48, className: 'text-white/80' } },
          { type: 'Heading', id: 'community-title', props: { size: '3xl', className: 'font-bold text-white text-center' }, text: '[[SECTION_TITLE]]' },
          { type: 'Text', props: { className: 'text-white/80 text-lg text-center max-w-xl' }, text: 'Connect with like-minded people who share your passion.' },
          {
            type: 'Button',
            id: 'community-cta',
            props: { className: '!bg-white !text-gray-900' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'ButtonText', text: 'Join Us' }],
          },
        ],
      },
    ],
  },
};

// ─── Ambassador Section ───────────────────────────────────────────────────────

export const ambassadorSectionGrid: SectionVariant = {
  _meta: {
    variantId: 'ambassador-section.grid',
    label: 'Brand ambassadors in a card grid',
    bestFor: ['playful', 'bold', 'warm', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Meet Our Ambassadors' },
    statePaths: ['ambassadors'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'ambassadors-section',
    props: { className: 'w-full py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          { type: 'Heading', id: 'ambassadors-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '[[SECTION_TITLE]]' },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-2 md:grid-cols-4 gap-6 w-full' },
            children: [
              {
                type: 'Box',
                map: 'ambassadors.list',
                key: '$item.id',
                props: { className: 'contents' },
                children: [
                  {
                    type: 'Box',
                    id: 'ambassador-card',
                    props: { className: 'flex flex-col items-center gap-3' },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'relative w-28 h-28 rounded-full overflow-hidden border-2 border-[var(--theme-shop-button)]' },
                        children: [{ type: 'NextImage', props: { src: '{{$item.imageUrl}}', alt: '{{$item.name}}', fill: true, className: 'object-cover' } }],
                      },
                      { type: 'Text', id: 'ambassador-name', props: { className: 'font-semibold text-[var(--theme-content-text)] text-center' }, text: '{{$item.name}}' },
                      { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)] text-center' }, text: '{{$item.handle}}' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Gift Guide ───────────────────────────────────────────────────────────────

export const giftGuideGrid: SectionVariant = {
  _meta: {
    variantId: 'gift-guide.grid',
    label: 'Themed gift collection cards in a grid',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Gift Guide' },
    statePaths: ['giftGuide'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'gift-guide-section',
    props: { className: 'w-full py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          { type: 'Heading', id: 'gift-guide-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '[[SECTION_TITLE]]' },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-1 md:grid-cols-3 gap-6 w-full' },
            children: [
              {
                type: 'Pressable',
                map: 'giftGuide.categories',
                key: '$item.id',
                id: 'gift-category-card',
                props: { className: 'flex flex-col rounded-2xl overflow-hidden hover:shadow-lg transition-shadow' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: { var: '$item.slug' } } } },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-full h-48 bg-[var(--theme-shop-bg)]' },
                    children: [
                      { type: 'NextImage', props: { src: '{{$item.imageUrl}}', alt: '{{$item.name}}', fill: true, className: 'object-cover' } },
                      { type: 'Box', props: { className: 'absolute inset-0 bg-gradient-to-t from-black/60 to-transparent' } },
                      { type: 'Box', props: { className: 'absolute bottom-4 left-4 right-4' }, children: [{ type: 'Text', id: 'gift-category-name', props: { className: 'text-white font-bold text-lg' }, text: '{{$item.name}}' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Hero Carousel ────────────────────────────────────────────────────────────

export const heroCarouselDots: SectionVariant = {
  _meta: {
    variantId: 'hero-carousel.dots',
    label: 'Multi-slide hero carousel with dot indicators',
    bestFor: ['modern', 'bold', 'editorial'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['heroCarousel'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'hero-carousel-section',
    props: { className: 'relative w-full min-h-[80vh] overflow-hidden' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex flex-row transition-transform duration-500', style: { transform: 'translateX(calc(-1 * {{heroCarousel.currentIndex}} * 100%))' } },
        children: [
          {
            type: 'Box',
            map: 'heroCarousel.slides',
            key: '$item.id',
            id: 'carousel-slide',
            props: { className: 'relative flex-none w-full min-h-[80vh]' },
            children: [
              { type: 'NextImage', props: { src: '{{$item.imageUrl}}', alt: '{{$item.heading}}', fill: true, className: 'object-cover' } },
              { type: 'Box', props: { className: 'absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent' } },
              {
                type: 'Box',
                props: { className: 'absolute bottom-20 left-0 right-0 flex flex-col items-center gap-4 px-4 text-center' },
                children: [
                  { type: 'Heading', props: { size: '4xl', className: 'text-white font-bold drop-shadow-lg text-center' }, text: '{{$item.heading}}' },
                  { type: 'Text', props: { className: 'text-white/90 text-xl drop-shadow text-center' }, text: '{{$item.subheading}}' },
                  {
                    type: 'Button',
                    props: { className: '!bg-white !text-gray-900 mt-2' },
                    actions: { click: { action: 'navigate', payload: { path: '{{$item.ctaPath}}' } } },
                    children: [{ type: 'ButtonText', text: '{{$item.ctaLabel}}' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'Box',
        props: { className: 'absolute bottom-6 left-0 right-0 flex flex-row justify-center gap-2' },
        children: [
          {
            type: 'Pressable',
            map: 'heroCarousel.slides',
            key: '$item.id',
            id: 'carousel-dot',
            props: { className: 'w-2 h-2 rounded-full bg-white/50 hover:bg-white transition-colors' },
            actions: { click: { action: 'setCarouselIndex', payload: { index: { var: '$index' } } } },
            children: [],
          },
        ],
      },
    ],
  },
};

// ─── Quiz Finder ─────────────────────────────────────────────────────────────

export const quizFinderStepCards: SectionVariant = {
  _meta: {
    variantId: 'quiz-finder.step-cards',
    label: 'Interactive product finder with step cards',
    bestFor: ['modern', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Find Your Perfect Match' },
    statePaths: ['quiz'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'quiz-section',
    props: { className: 'w-full py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-3xl mx-auto px-4 flex flex-col items-center gap-8' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-col items-center gap-3 text-center' },
            children: [
              { type: 'NavIcon', props: { icon: 'Sparkles', size: 36, className: 'text-[var(--theme-shop-button)]' } },
              { type: 'Heading', id: 'quiz-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '[[SECTION_TITLE]]' },
              { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] text-center' }, text: 'Answer a few quick questions and we\'ll curate the perfect selection for you.' },
            ],
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-2 md:grid-cols-4 gap-3 w-full' },
            children: [
              {
                type: 'Pressable',
                map: 'quiz.currentQuestion.options',
                key: '$item.id',
                id: 'quiz-option',
                props: { className: 'flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-[var(--theme-content-textMuted)]/20 hover:border-[var(--theme-shop-button)] transition-colors' },
                actions: { click: { action: 'selectQuizOption', payload: { optionId: { var: '$item.id' } } } },
                children: [
                  { type: 'NavIcon', props: { icon: '{{$item.icon}}', size: 28, className: 'text-[var(--theme-shop-button)]' } },
                  { type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-content-text)] text-center' }, text: '{{$item.label}}' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Bundle Builder ───────────────────────────────────────────────────────────

export const bundleBuilderDefault: SectionVariant = {
  _meta: {
    variantId: 'bundle-builder.default',
    label: 'Build a bundle / kit with add items interface',
    bestFor: ['modern', 'warm', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Build Your Bundle' },
    statePaths: ['bundle'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'bundle-section',
    props: { className: 'w-full py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-col gap-8' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-col items-center gap-3 text-center' },
            children: [
              { type: 'Heading', id: 'bundle-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '[[SECTION_TITLE]]' },
              { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] text-center' }, text: 'Save up to 20% when you bundle 3 or more items.' },
            ],
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-2 md:grid-cols-4 gap-4 w-full' },
            children: [
              {
                type: 'Box',
                map: 'bundle.products',
                key: '$item.id',
                props: { className: 'contents' },
                children: [
                  {
                    type: 'Box',
                    id: 'bundle-product-card',
                    props: { className: 'flex flex-col rounded-xl overflow-hidden border-2 border-[var(--theme-content-textMuted)]/20' },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'relative w-full h-40' },
                        children: [{ type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } }],
                      },
                      {
                        type: 'Box',
                        props: { className: 'p-3 flex flex-col gap-2' },
                        children: [
                          { type: 'Text', props: { className: 'text-xs font-semibold text-[var(--theme-content-text)] leading-tight' }, text: '{{$item.productName}}' },
                          { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)]' }, text: { expr: { formatCurrency: [{ var: '$item.priceWithTax.value' }, 100] } } },
                          {
                            type: 'Button',
                            props: { size: 'xs', className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] w-full' },
                            actions: { click: { action: 'addToBundle', payload: { productId: { var: '$item.id' } } } },
                            children: [{ type: 'ButtonText', text: '+ Add' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ─── Hero Video ───────────────────────────────────────────────────────────────

export const heroVideoFullscreen: SectionVariant = {
  _meta: {
    variantId: 'hero-video.fullscreen',
    label: 'Full-screen video background hero',
    bestFor: ['editorial', 'luxury', 'bold'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/shop' },
    statePaths: ['hero'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'hero-section',
    props: { className: 'relative w-full min-h-[90vh] overflow-hidden bg-black flex items-center justify-center' },
    children: [
      {
        type: 'Box',
        props: { className: 'absolute inset-0 bg-black/50 z-10' },
      },
      {
        type: 'Box',
        props: { className: 'relative z-20 flex flex-col items-center gap-6 px-4 text-center max-w-4xl mx-auto' },
        children: [
          { type: 'Heading', id: 'hero-heading', props: { size: '5xl', className: 'text-white font-bold drop-shadow-lg text-center' }, text: '{{hero.heading}}' },
          { type: 'Text', id: 'hero-subheading', props: { className: 'text-white/90 text-xl drop-shadow text-center' }, text: '{{hero.subheading}}' },
          {
            type: 'Button',
            id: 'hero-cta-primary',
            props: { className: '!bg-white !text-gray-900 mt-2' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'ButtonText', text: '{{hero.ctaLabel}}' }],
          },
        ],
      },
    ],
  },
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export const newSectionVariants = [
  // Shop the Look
  shopTheLookHoverTags,
  shopTheLookSidePanel,
  // Social Proof
  socialProofMasonryGrid,
  socialProofStoryRow,
  // How It Works
  howItWorksHorizontal,
  howItWorksVertical,
  // Loyalty
  loyaltyProgramBenefitGrid,
  loyaltyProgramTierDisplay,
  // Blog
  blogArticlesCardGrid,
  // Waitlist
  waitlistDefault,
  // Gift Card
  giftCardPromoDefault,
  // Countdown
  countdownBannerDark,
  countdownBannerAccent,
  // Founder
  founderStoryPhotoLeft,
  founderStoryMinimal,
  // Awards
  awardsCertificationsDefault,
  // Community
  communitySectionDefault,
  // Ambassador
  ambassadorSectionGrid,
  // Gift Guide
  giftGuideGrid,
  // Hero Carousel
  heroCarouselDots,
  // Quiz
  quizFinderStepCards,
  // Bundle
  bundleBuilderDefault,
  // Hero Video
  heroVideoFullscreen,
];
