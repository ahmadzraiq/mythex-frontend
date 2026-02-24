/**
 * Product Carousel section variants (3) — horizontal scroll strip
 * State paths: bestSellers.products
 */

import type { SectionVariant } from '../types';

export const productCarouselStandard: SectionVariant = {
  _meta: {
    variantId: 'product-carousel.standard',
    label: 'Horizontal scroll strip with standard product cards',
    bestFor: ['modern', 'warm', 'playful', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'Best Sellers', CTA_PATH: '/shop' },
    statePaths: ['bestSellers'],
    initActions: ['fetchBestSellers'],
  },
  node: {
    type: 'Box',
    id: 'product-carousel-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-8' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between w-full' },
            children: [
              { type: 'Heading', id: 'carousel-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: '[[SECTION_TITLE]]' },
              {
                type: 'Pressable',
                id: 'carousel-view-all',
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-shop-button)] font-medium underline underline-offset-4' }, text: 'View All' }],
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-4 overflow-x-auto pb-2 snap-x snap-mandatory' },
            children: [
              {
                type: 'Pressable',
                map: 'bestSellers.products',
                key: '$item.id',
                id: 'carousel-card',
                props: { className: 'flex-none w-48 flex flex-col rounded-xl overflow-hidden shadow-sm bg-[var(--theme-content-bg)] hover:shadow-md transition-shadow snap-start' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-full h-48' },
                    children: [{ type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } }],
                  },
                  {
                    type: 'Box',
                    props: { className: 'p-3 flex flex-col gap-1' },
                    children: [
                      { type: 'Text', id: 'carousel-product-name', props: { className: 'text-sm font-semibold text-[var(--theme-content-text)] leading-tight' }, text: '{{$item.productName}}' },
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
};

export const productCarouselLargeCard: SectionVariant = {
  _meta: {
    variantId: 'product-carousel.large-card',
    label: 'Large card scroll strip with taller images',
    bestFor: ['editorial', 'luxury', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
    slotDefaults: { SECTION_TITLE: 'Best Sellers', CTA_PATH: '/shop' },
    statePaths: ['bestSellers'],
    initActions: ['fetchBestSellers'],
  },
  node: {
    type: 'Box',
    id: 'product-carousel-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-8' },
        children: [
          { type: 'Heading', id: 'carousel-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: '[[SECTION_TITLE]]' },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-6 overflow-x-auto pb-4 snap-x snap-mandatory' },
            children: [
              {
                type: 'Pressable',
                map: 'bestSellers.products',
                key: '$item.id',
                id: 'carousel-card-large',
                props: { className: 'flex-none w-64 flex flex-col rounded-2xl overflow-hidden shadow-md bg-[var(--theme-shop-bg)] hover:shadow-xl transition-shadow snap-start' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-full h-72' },
                    children: [{ type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } }],
                  },
                  {
                    type: 'Box',
                    props: { className: 'p-4 flex flex-col gap-1.5' },
                    children: [
                      { type: 'Text', id: 'carousel-product-name', props: { className: 'font-semibold text-[var(--theme-content-text)]' }, text: '{{$item.productName}}' },
                      { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)] font-medium' }, text: { expr: { formatCurrency: [{ var: '$item.priceWithTax.value' }, 100] } } },
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

export const productCarouselCompact: SectionVariant = {
  _meta: {
    variantId: 'product-carousel.compact',
    label: 'Compact horizontal strip with small cards',
    bestFor: ['minimalist', 'modern', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Trending Now' },
    statePaths: ['bestSellers'],
    initActions: ['fetchBestSellers'],
  },
  node: {
    type: 'Box',
    id: 'product-carousel-section',
    props: { className: 'w-full py-12 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-6' },
        children: [
          { type: 'Text', id: 'carousel-title', props: { className: 'text-sm font-bold tracking-widest uppercase text-[var(--theme-content-textMuted)]' }, text: '[[SECTION_TITLE]]' },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-3 overflow-x-auto pb-2' },
            children: [
              {
                type: 'Pressable',
                map: 'bestSellers.products',
                key: '$item.id',
                id: 'carousel-card-compact',
                props: { className: 'flex-none w-36 flex flex-col rounded-lg overflow-hidden bg-[var(--theme-shop-bg)]' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-full h-36' },
                    children: [{ type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } }],
                  },
                  {
                    type: 'Box',
                    props: { className: 'p-2 flex flex-col gap-0.5' },
                    children: [
                      { type: 'Text', props: { className: 'text-xs font-medium text-[var(--theme-content-text)] leading-tight' }, text: '{{$item.productName}}' },
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
};

export const productCarouselVariants = [productCarouselStandard, productCarouselLargeCard, productCarouselCompact];
