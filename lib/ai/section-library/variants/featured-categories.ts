/**
 * Featured Categories section variants (3)
 *
 * Slots:
 *   [[SECTION_TITLE]] — section heading (default: "Shop by Category")
 *
 * State paths: featured.categories — {id, name, slug, imageUrl}[]
 */

import type { SectionVariant } from '../types';

export const categoriesOverlay4col: SectionVariant = {
  _meta: {
    variantId: 'featured-categories.overlay-4col',
    label: '4-column grid with image overlay and category name',
    bestFor: ['modern', 'bold', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Shop by Category' },
    statePaths: ['featured.categories'],
    initActions: ['fetchFeaturedCategories'],
  },
  node: {
    type: 'Box',
    id: 'categories-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Heading',
            id: 'categories-title',
            props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' },
            text: '[[SECTION_TITLE]]',
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-2 md:grid-cols-4 gap-4 w-full' },
            children: [
              {
                type: 'Box',
                map: 'featured.categories',
                key: '$item.id',
                props: { className: 'contents' },
                children: [
                  {
                    type: 'Pressable',
                    id: 'category-card',
                    props: { className: 'block rounded-xl overflow-hidden hover:opacity-90 transition-opacity' },
                    actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: { var: '$item.slug' } } } },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'relative w-full h-48' },
                        children: [
                          { type: 'NextImage', props: { src: '{{$item.imageUrl}}', alt: '{{$item.name}}', fill: true, className: 'object-cover' } },
                          { type: 'Box', props: { className: 'absolute inset-0 bg-gradient-to-t from-black/70 to-transparent' } },
                          {
                            type: 'Box',
                            props: { className: 'absolute bottom-0 left-0 right-0 p-3' },
                            children: [
                              { type: 'Text', id: 'category-name', props: { className: 'text-white font-bold text-base text-center' }, text: '{{$item.name}}' },
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
    ],
  },
};

export const categoriesAsymmetric: SectionVariant = {
  _meta: {
    variantId: 'featured-categories.asymmetric',
    label: '1 large hero category + 2 smaller, editorial asymmetric layout',
    bestFor: ['editorial', 'luxury', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Explore Collections' },
    statePaths: ['featured.categories'],
    initActions: ['fetchFeaturedCategories'],
  },
  node: {
    type: 'Box',
    id: 'categories-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Heading',
            id: 'categories-title',
            props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' },
            text: '[[SECTION_TITLE]]',
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-4 w-full h-96' },
            children: [
              {
                type: 'Pressable',
                id: 'category-featured',
                props: { className: 'flex-1 relative rounded-xl overflow-hidden hover:opacity-95 transition-opacity' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: '{{featured.categories[0].slug}}' } } },
                children: [
                  { type: 'NextImage', props: { src: '{{featured.categories[0].imageUrl}}', alt: '{{featured.categories[0].name}}', fill: true, className: 'object-cover' } },
                  { type: 'Box', props: { className: 'absolute inset-0 bg-gradient-to-t from-black/60 to-transparent' } },
                  {
                    type: 'Box',
                    props: { className: 'absolute bottom-0 left-0 right-0 p-6' },
                    children: [{ type: 'Text', id: 'category-name-0', props: { className: 'text-white font-bold text-2xl drop-shadow' }, text: '{{featured.categories[0].name}}' }],
                  },
                ],
              },
              {
                type: 'Box',
                props: { className: 'flex-1 flex flex-col gap-4' },
                children: [
                  {
                    type: 'Pressable',
                    id: 'category-card-1',
                    props: { className: 'flex-1 relative rounded-xl overflow-hidden hover:opacity-95 transition-opacity' },
                    actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: '{{featured.categories[1].slug}}' } } },
                    children: [
                      { type: 'NextImage', props: { src: '{{featured.categories[1].imageUrl}}', alt: '{{featured.categories[1].name}}', fill: true, className: 'object-cover' } },
                      { type: 'Box', props: { className: 'absolute inset-0 bg-gradient-to-t from-black/60 to-transparent' } },
                      { type: 'Box', props: { className: 'absolute bottom-0 left-0 right-0 p-4' }, children: [{ type: 'Text', id: 'category-name-1', props: { className: 'text-white font-bold text-lg' }, text: '{{featured.categories[1].name}}' }] },
                    ],
                  },
                  {
                    type: 'Pressable',
                    id: 'category-card-2',
                    props: { className: 'flex-1 relative rounded-xl overflow-hidden hover:opacity-95 transition-opacity' },
                    actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: '{{featured.categories[2].slug}}' } } },
                    children: [
                      { type: 'NextImage', props: { src: '{{featured.categories[2].imageUrl}}', alt: '{{featured.categories[2].name}}', fill: true, className: 'object-cover' } },
                      { type: 'Box', props: { className: 'absolute inset-0 bg-gradient-to-t from-black/60 to-transparent' } },
                      { type: 'Box', props: { className: 'absolute bottom-0 left-0 right-0 p-4' }, children: [{ type: 'Text', id: 'category-name-2', props: { className: 'text-white font-bold text-lg' }, text: '{{featured.categories[2].name}}' }] },
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

export const categoriesStrip: SectionVariant = {
  _meta: {
    variantId: 'featured-categories.strip',
    label: 'Minimal horizontal strip with circular thumbnails',
    bestFor: ['luxury', 'minimalist', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Collections' },
    statePaths: ['featured.categories'],
    initActions: ['fetchFeaturedCategories'],
  },
  node: {
    type: 'Box',
    id: 'categories-section',
    props: { className: 'w-full py-12 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-col items-center gap-8' },
        children: [
          {
            type: 'Heading',
            id: 'categories-title',
            props: { size: 'lg', className: 'font-medium text-[var(--theme-content-textMuted)] tracking-widest uppercase text-center text-sm' },
            text: '[[SECTION_TITLE]]',
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row justify-center gap-10 flex-wrap w-full' },
            children: [
              {
                type: 'Pressable',
                map: 'featured.categories',
                key: '$item.id',
                id: 'category-circle',
                props: { className: 'flex flex-col items-center gap-3 hover:opacity-80 transition-opacity' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: { var: '$item.slug' } } } },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'relative w-24 h-24 rounded-full overflow-hidden border-2 border-[var(--theme-shop-button)]' },
                    children: [
                      { type: 'NextImage', props: { src: '{{$item.imageUrl}}', alt: '{{$item.name}}', fill: true, className: 'object-cover' } },
                    ],
                  },
                  { type: 'Text', id: 'category-name', props: { className: 'text-[var(--theme-content-text)] font-medium text-sm tracking-wide text-center' }, text: '{{$item.name}}' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const featuredCategoriesVariants = [
  categoriesOverlay4col,
  categoriesAsymmetric,
  categoriesStrip,
];
