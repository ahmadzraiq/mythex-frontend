/**
 * Lookbook section variants (2)
 * State paths: lookbook.headline, lookbook.images — string[]
 */

import type { SectionVariant } from '../types';

export const lookbookMasonry: SectionVariant = {
  _meta: {
    variantId: 'lookbook.masonry',
    label: '3-column image masonry grid with headline',
    bestFor: ['editorial', 'fashion', 'luxury', 'beauty'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['lookbook'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'lookbook-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-8' },
        children: [
          {
            type: 'Heading',
            id: 'lookbook-heading',
            props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' },
            text: '{{lookbook.headline}}',
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-3 gap-3 w-full' },
            children: [
              {
                type: 'Box',
                map: 'lookbook.images',
                key: '$item',
                props: { className: 'contents' },
                children: [
                  {
                    type: 'Box',
                    id: 'lookbook-image',
                    props: { className: 'relative w-full h-64 rounded-lg overflow-hidden' },
                    children: [
                      { type: 'NextImage', props: { src: '{{$item}}', alt: 'Lookbook', fill: true, className: 'object-cover hover:scale-105 transition-transform duration-300' } },
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

export const lookbookMagazine: SectionVariant = {
  _meta: {
    variantId: 'lookbook.magazine',
    label: 'Magazine-style editorial with 1 hero image + smaller grid',
    bestFor: ['editorial', 'luxury', 'bold'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['lookbook'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'lookbook-section',
    props: { className: 'w-full py-16 md:py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-7xl mx-auto px-4 flex flex-col gap-8' },
        children: [
          { type: 'Heading', id: 'lookbook-heading', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: '{{lookbook.headline}}' },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-4 w-full h-[480px]' },
            children: [
              {
                type: 'Box',
                props: { className: 'flex-1 relative rounded-xl overflow-hidden' },
                children: [{ type: 'NextImage', props: { src: '{{lookbook.images[0]}}', alt: 'Lookbook hero', fill: true, className: 'object-cover' } }],
              },
              {
                type: 'Box',
                props: { className: 'w-56 flex flex-col gap-4' },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'flex-1 relative rounded-xl overflow-hidden' },
                    children: [{ type: 'NextImage', props: { src: '{{lookbook.images[1]}}', alt: 'Lookbook', fill: true, className: 'object-cover' } }],
                  },
                  {
                    type: 'Box',
                    props: { className: 'flex-1 relative rounded-xl overflow-hidden' },
                    children: [{ type: 'NextImage', props: { src: '{{lookbook.images[2]}}', alt: 'Lookbook', fill: true, className: 'object-cover' } }],
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

export const lookbookVariants = [lookbookMasonry, lookbookMagazine];
