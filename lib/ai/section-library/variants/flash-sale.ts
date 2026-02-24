/**
 * Flash Sale section variants (2)
 * State paths: flashSale.endsAt, flashSale.badge, flashSaleProducts.products
 */

import type { SectionVariant } from '../types';

const flashSaleCard = {
  type: 'Pressable',
  id: 'flash-sale-card',
  props: { className: 'flex flex-col rounded-xl overflow-hidden shadow-sm bg-white/10 border border-white/20 hover:bg-white/20 transition-colors' },
  actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
  children: [
    {
      type: 'Box',
      props: { className: 'relative w-full h-48' },
      children: [
        { type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } },
        {
          type: 'Box',
          props: { className: 'absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full' },
          children: [{ type: 'Text', props: { className: 'text-white text-xs font-bold' }, text: '{{flashSale.badge}}' }],
        },
      ],
    },
    {
      type: 'Box',
      props: { className: 'p-3 flex flex-col gap-1' },
      children: [
        { type: 'Text', id: 'flash-product-name', props: { className: 'text-sm font-semibold text-white leading-tight' }, text: '{{$item.productName}}' },
        { type: 'Text', props: { className: 'text-sm text-white/80 font-medium' }, text: { expr: { formatCurrency: [{ var: '$item.priceWithTax.value' }, 100] } } },
      ],
    },
  ],
};

export const flashSaleDark: SectionVariant = {
  _meta: {
    variantId: 'flash-sale.dark',
    label: 'Dark dramatic flash sale with countdown timer',
    bestFor: ['bold', 'modern', 'playful'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Flash Sale' },
    statePaths: ['flashSale', 'flashSaleProducts'],
    initActions: ['fetchFlashSale'],
  },
  node: {
    type: 'Box',
    id: 'flash-sale-section',
    props: { className: 'w-full py-16 bg-gray-950' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-col md:flex-row items-center justify-between gap-4' },
            children: [
              {
                type: 'Box',
                props: { className: 'flex flex-col gap-1' },
                children: [
                  { type: 'Text', props: { className: 'text-red-400 text-sm font-bold tracking-widest uppercase' }, text: 'Limited Time' },
                  { type: 'Heading', id: 'flash-sale-title', props: { size: '2xl', className: 'font-bold text-white' }, text: '[[SECTION_TITLE]]' },
                ],
              },
              {
                type: 'Box',
                props: { className: 'flex flex-row items-center gap-3' },
                children: [
                  { type: 'Text', props: { className: 'text-white/60 text-sm' }, text: 'Ends in:' },
                  { type: 'CountdownTimer', id: 'flash-sale-timer', props: { target: '{{flashSale.endsAt}}', className: 'text-white font-mono text-xl font-bold' } },
                ],
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-2 md:grid-cols-4 gap-4 w-full' },
            children: [
              {
                type: 'Box',
                map: 'flashSaleProducts.products',
                key: '$item.id',
                props: { className: 'contents' },
                children: [flashSaleCard],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const flashSaleLight: SectionVariant = {
  _meta: {
    variantId: 'flash-sale.light',
    label: 'Light background flash sale with accent timer',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Today\'s Deals' },
    statePaths: ['flashSale', 'flashSaleProducts'],
    initActions: ['fetchFlashSale'],
  },
  node: {
    type: 'Box',
    id: 'flash-sale-section',
    props: { className: 'w-full py-16 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between w-full' },
            children: [
              { type: 'Heading', id: 'flash-sale-title', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: '[[SECTION_TITLE]]' },
              {
                type: 'Box',
                props: { className: 'flex flex-row items-center gap-2 bg-red-50 px-4 py-2 rounded-full' },
                children: [
                  { type: 'NavIcon', props: { icon: 'Clock', size: 16, className: 'text-red-500' } },
                  { type: 'CountdownTimer', id: 'flash-sale-timer', props: { target: '{{flashSale.endsAt}}', className: 'text-red-600 font-mono text-sm font-bold' } },
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
                map: 'flashSaleProducts.products',
                key: '$item.id',
                props: { className: 'contents' },
                children: [
                  {
                    type: 'Pressable',
                    id: 'flash-sale-card-light',
                    props: { className: 'flex flex-col rounded-xl overflow-hidden shadow-sm bg-[var(--theme-content-bg)] hover:shadow-md transition-shadow' },
                    actions: { click: { action: 'navigate', payload: { routeConfig: 'product', slug: { var: '$item.slug' } } } },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'relative w-full h-48' },
                        children: [
                          { type: 'NextImage', props: { src: '{{$item.productAsset.preview}}', alt: '{{$item.productName}}', fill: true, className: 'object-cover' } },
                          { type: 'Box', props: { className: 'absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full' }, children: [{ type: 'Text', props: { className: 'text-white text-xs font-bold' }, text: '{{flashSale.badge}}' }] },
                        ],
                      },
                      {
                        type: 'Box',
                        props: { className: 'p-3 flex flex-col gap-1' },
                        children: [
                          { type: 'Text', id: 'flash-product-name', props: { className: 'text-sm font-semibold text-[var(--theme-content-text)]' }, text: '{{$item.productName}}' },
                          { type: 'Text', props: { className: 'text-sm text-red-500 font-bold' }, text: { expr: { formatCurrency: [{ var: '$item.priceWithTax.value' }, 100] } } },
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

export const flashSaleVariants = [flashSaleDark, flashSaleLight];
