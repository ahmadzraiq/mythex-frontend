/**
 * Product Grid section variants (4)
 *
 * Slots:
 *   [[SECTION_TITLE]] — section heading (default: "New Arrivals")
 *   [[CTA_PATH]] — "View All" link destination (default: /shop)
 *
 * State paths read at runtime:
 *   newArrivals.products — array of MockProduct
 *   Fields: $item.productName, $item.productAsset.preview, $item.slug, $item.priceWithTax.value
 */

import type { SectionVariant } from '../types';

const PRODUCT_CARD_PRICE = {
  type: 'Text',
  id: 'product-price',
  props: { className: 'text-sm text-[var(--theme-content-textMuted)] font-medium' },
  text: { expr: { formatCurrency: [{ var: '$item.priceWithTax.value' }, 100] } },
};

export const productGrid4col: SectionVariant = {
  _meta: {
    variantId: 'product-grid.4col',
    label: 'Uniform 4-column product grid',
    bestFor: ['modern', 'minimalist', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'New Arrivals', CTA_PATH: '/shop' },
    statePaths: ['newArrivals'],
    initActions: ['fetchNewArrivals'],
  },
  node: {
    type: 'Box',
    id: 'product-grid-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between w-full' },
            children: [
              {
                type: 'Heading',
                id: 'product-grid-title',
                props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' },
                text: '[[SECTION_TITLE]]',
              },
              {
                type: 'Pressable',
                id: 'product-grid-view-all',
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [
                  {
                    type: 'Text',
                    props: { className: 'text-sm text-[var(--theme-shop-button)] font-medium underline underline-offset-4' },
                    text: 'View All',
                  },
                ],
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-2 md:grid-cols-4 gap-6 w-full' },
            children: [
              {
                type: 'Box',
                map: 'newArrivals.products',
                key: '$item.id',
                props: { className: 'contents' },
                children: [
                  {
                    type: 'Pressable',
                    id: 'product-card',
                    props: { className: 'flex flex-col rounded-xl overflow-hidden shadow-sm bg-[var(--theme-shop-bg)] hover:shadow-md transition-shadow' },
                    actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'relative w-full h-52' },
                        children: [
                          {
                            type: 'NextImage',
                            props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' },
                          },
                        ],
                      },
                      {
                        type: 'Box',
                        props: { className: 'p-3 flex flex-col gap-1' },
                        children: [
                          {
                            type: 'Text',
                            id: 'product-name',
                            props: { className: 'text-sm font-semibold text-[var(--theme-content-text)] leading-tight' },
                            text: '{{$item.productName}}',
                          },
                          PRODUCT_CARD_PRICE,
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

export const productGridFeatured3col: SectionVariant = {
  _meta: {
    variantId: 'product-grid.featured-3col',
    label: 'One featured large card + 2 smaller cards in 3-col layout',
    bestFor: ['editorial', 'luxury', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'Featured Products', CTA_PATH: '/shop' },
    statePaths: ['newArrivals'],
    initActions: ['fetchNewArrivals'],
  },
  node: {
    type: 'Box',
    id: 'product-grid-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Heading',
            id: 'product-grid-title',
            props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' },
            text: '[[SECTION_TITLE]]',
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-3 gap-6 w-full' },
            children: [
              {
                type: 'Pressable',
                id: 'product-card-featured',
                props: { className: 'col-span-2 flex flex-col rounded-xl overflow-hidden shadow-sm bg-[var(--theme-shop-bg)] hover:shadow-md transition-shadow' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: '{{newArrivals.products[0].slug}}' } } },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-full h-72' },
                    children: [
                      {
                        type: 'NextImage',
                        props: { src: '{{newArrivals.products[0].productAsset.preview}}', alt: '{{newArrivals.products[0].productName}}', fill: true, className: 'object-cover' },
                      },
                    ],
                  },
                  {
                    type: 'Box',
                    props: { className: 'p-4 flex flex-col gap-1' },
                    children: [
                      { type: 'Text', props: { className: 'font-semibold text-[var(--theme-content-text)]' }, text: '{{newArrivals.products[0].productName}}' },
                      {
                        type: 'Text',
                        props: { className: 'text-sm text-[var(--theme-content-textMuted)]' },
                        text: { expr: { formatCurrency: [{ var: 'newArrivals.products[0].priceWithTax.value' }, 100] } },
                      },
                    ],
                  },
                ],
              },
              {
                type: 'Box',
                props: { className: 'col-span-1 flex flex-col gap-6' },
                children: [
                  {
                    type: 'Pressable',
                    props: { className: 'flex flex-col rounded-xl overflow-hidden shadow-sm bg-[var(--theme-shop-bg)] hover:shadow-md transition-shadow flex-1' },
                    actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: '{{newArrivals.products[1].slug}}' } } },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'relative w-full h-40' },
                        children: [
                          { type: 'NextImage', props: { src: '{{newArrivals.products[1].productAsset.preview}}', alt: '{{newArrivals.products[1].productName}}', fill: true, className: 'object-cover' } },
                        ],
                      },
                      {
                        type: 'Box',
                        props: { className: 'p-3 flex flex-col gap-1' },
                        children: [
                          { type: 'Text', props: { className: 'text-sm font-semibold text-[var(--theme-content-text)]' }, text: '{{newArrivals.products[1].productName}}' },
                          { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)]' }, text: { expr: { formatCurrency: [{ var: 'newArrivals.products[1].priceWithTax.value' }, 100] } } },
                        ],
                      },
                    ],
                  },
                  {
                    type: 'Pressable',
                    props: { className: 'flex flex-col rounded-xl overflow-hidden shadow-sm bg-[var(--theme-shop-bg)] hover:shadow-md transition-shadow flex-1' },
                    actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: '{{newArrivals.products[2].slug}}' } } },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'relative w-full h-40' },
                        children: [
                          { type: 'NextImage', props: { src: '{{newArrivals.products[2].productAsset.preview}}', alt: '{{newArrivals.products[2].productName}}', fill: true, className: 'object-cover' } },
                        ],
                      },
                      {
                        type: 'Box',
                        props: { className: 'p-3 flex flex-col gap-1' },
                        children: [
                          { type: 'Text', props: { className: 'text-sm font-semibold text-[var(--theme-content-text)]' }, text: '{{newArrivals.products[2].productName}}' },
                          { type: 'Text', props: { className: 'text-xs text-[var(--theme-content-textMuted)]' }, text: { expr: { formatCurrency: [{ var: 'newArrivals.products[2].priceWithTax.value' }, 100] } } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex justify-center' },
            children: [
              {
                type: 'Button',
                id: 'product-grid-view-all',
                props: { variant: 'outline', className: '!border-[var(--theme-shop-button)] !text-[var(--theme-shop-button)]' },
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'ButtonText', text: 'View All Products' }],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const productGridHorizontal: SectionVariant = {
  _meta: {
    variantId: 'product-grid.horizontal',
    label: 'Horizontal card list — catalog / editorial style',
    bestFor: ['editorial', 'luxury', 'minimalist'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'New Arrivals', CTA_PATH: '/shop' },
    statePaths: ['newArrivals'],
    initActions: ['fetchNewArrivals'],
  },
  node: {
    type: 'Box',
    id: 'product-grid-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-4xl mx-auto px-4 flex flex-col gap-8' },
        children: [
          {
            type: 'Heading',
            id: 'product-grid-title',
            props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' },
            text: '[[SECTION_TITLE]]',
          },
          {
            type: 'Box',
            props: { className: 'flex flex-col gap-4 w-full' },
            children: [
              {
                type: 'Pressable',
                map: 'newArrivals.products',
                key: '$item.id',
                id: 'product-card-horizontal',
                props: { className: 'flex flex-row gap-0 rounded-xl overflow-hidden shadow-sm bg-[var(--theme-shop-bg)] hover:shadow-md transition-shadow w-full' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-36 h-28 flex-none' },
                    children: [
                      { type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } },
                    ],
                  },
                  {
                    type: 'Box',
                    props: { className: 'flex-1 p-4 flex flex-col justify-center gap-1' },
                    children: [
                      { type: 'Text', id: 'product-name', props: { className: 'font-semibold text-[var(--theme-content-text)]' }, text: '{{$item.productName}}' },
                      PRODUCT_CARD_PRICE,
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

export const productGridMasonry: SectionVariant = {
  _meta: {
    variantId: 'product-grid.masonry',
    label: 'Pinterest-style masonry grid with alternating heights',
    bestFor: ['bold', 'playful', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'Discover', CTA_PATH: '/shop' },
    statePaths: ['newArrivals'],
    initActions: ['fetchNewArrivals'],
  },
  node: {
    type: 'Box',
    id: 'product-grid-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Heading',
            id: 'product-grid-title',
            props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' },
            text: '[[SECTION_TITLE]]',
          },
          {
            type: 'Box',
            props: { className: 'columns-2 md:columns-3 gap-4 w-full' },
            children: [
              {
                type: 'Pressable',
                map: 'newArrivals.products',
                key: '$item.id',
                id: 'product-card-masonry',
                props: { className: 'break-inside-avoid mb-4 flex flex-col rounded-xl overflow-hidden shadow-sm bg-[var(--theme-content-bg)] hover:shadow-md transition-shadow' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-full h-48' },
                    children: [
                      { type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } },
                    ],
                  },
                  {
                    type: 'Box',
                    props: { className: 'p-3 flex flex-col gap-1' },
                    children: [
                      { type: 'Text', id: 'product-name', props: { className: 'text-sm font-semibold text-[var(--theme-content-text)]' }, text: '{{$item.productName}}' },
                      PRODUCT_CARD_PRICE,
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

export const productGridVariants = [
  productGrid4col,
  productGridFeatured3col,
  productGridHorizontal,
  productGridMasonry,
];
