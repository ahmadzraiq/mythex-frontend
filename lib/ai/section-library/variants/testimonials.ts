/**
 * Testimonials section variants (3)
 * State paths: testimonials.items — {id, review, author, rating}[]
 */

import type { SectionVariant } from '../types';

export const testimonialsCardsDark: SectionVariant = {
  _meta: {
    variantId: 'testimonials.cards-dark',
    label: 'Dark background, 3-column card grid',
    bestFor: ['luxury', 'bold', 'modern', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'What Our Customers Say' },
    statePaths: ['testimonials'],
    initActions: ['fetchTestimonials'],
  },
  node: {
    type: 'Box',
    id: 'testimonials-section',
    props: { className: 'w-full py-20 bg-[var(--theme-footer-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Heading',
            id: 'testimonials-title',
            props: { size: '2xl', className: 'font-bold text-[var(--theme-footer-text)] text-center' },
            text: '[[SECTION_TITLE]]',
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-1 md:grid-cols-3 gap-6 w-full' },
            children: [
              {
                type: 'Box',
                map: 'testimonials.items',
                key: '$item.id',
                props: { className: 'contents' },
                children: [
                  {
                    type: 'Box',
                    id: 'testimonial-card',
                    props: { className: 'flex flex-col gap-4 p-6 rounded-xl bg-white/10 border border-white/20' },
                    children: [
                      {
                        type: 'Text',
                        id: 'testimonial-review',
                        props: { className: 'text-[var(--theme-footer-text)] text-base leading-relaxed italic' },
                        text: '{{$item.review}}',
                      },
                      {
                        type: 'Text',
                        id: 'testimonial-author',
                        props: { className: 'text-[var(--theme-footer-textMuted)] text-sm font-medium' },
                        text: '— {{$item.author}}',
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

export const testimonialsLargeFeatured: SectionVariant = {
  _meta: {
    variantId: 'testimonials.large-featured',
    label: 'Single oversized quote, editorial style',
    bestFor: ['luxury', 'minimalist', 'editorial'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['testimonials'],
    initActions: ['fetchTestimonials'],
  },
  node: {
    type: 'Box',
    id: 'testimonials-section',
    props: { className: 'w-full py-24 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-3xl mx-auto px-4 flex flex-col items-center gap-8 text-center' },
        children: [
          {
            type: 'Text',
            props: { className: 'text-[var(--theme-shop-button)] text-7xl font-serif leading-none' },
            text: '\u201c',
          },
          {
            type: 'Text',
            id: 'testimonial-review',
            props: { className: 'text-[var(--theme-content-text)] text-2xl font-medium leading-relaxed italic text-center' },
            text: '{{testimonials.items[0].review}}',
          },
          {
            type: 'Text',
            id: 'testimonial-author',
            props: { className: 'text-[var(--theme-content-textMuted)] text-base font-semibold tracking-widest uppercase text-center' },
            text: '— {{testimonials.items[0].author}}',
          },
        ],
      },
    ],
  },
};

export const testimonialsGrid: SectionVariant = {
  _meta: {
    variantId: 'testimonials.grid',
    label: 'Light background grid with star ratings',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
    slotDefaults: { SECTION_TITLE: 'Customer Reviews' },
    statePaths: ['testimonials'],
    initActions: ['fetchTestimonials'],
  },
  node: {
    type: 'Box',
    id: 'testimonials-section',
    props: { className: 'w-full py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-col gap-10' },
        children: [
          {
            type: 'Heading',
            id: 'testimonials-title',
            props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] text-center' },
            text: '[[SECTION_TITLE]]',
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-1 md:grid-cols-3 gap-6 w-full' },
            children: [
              {
                type: 'Box',
                map: 'testimonials.items',
                key: '$item.id',
                props: { className: 'contents' },
                children: [
                  {
                    type: 'Box',
                    id: 'testimonial-card',
                    props: { className: 'flex flex-col gap-3 p-6 rounded-xl bg-[var(--theme-content-bg)] shadow-sm border border-[var(--theme-content-textMuted)]/10' },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'flex flex-row gap-1' },
                        children: [
                          { type: 'NavIcon', props: { icon: 'Star', size: 16, className: 'text-amber-400' } },
                          { type: 'NavIcon', props: { icon: 'Star', size: 16, className: 'text-amber-400' } },
                          { type: 'NavIcon', props: { icon: 'Star', size: 16, className: 'text-amber-400' } },
                          { type: 'NavIcon', props: { icon: 'Star', size: 16, className: 'text-amber-400' } },
                          { type: 'NavIcon', props: { icon: 'Star', size: 16, className: 'text-amber-400' } },
                        ],
                      },
                      {
                        type: 'Text',
                        id: 'testimonial-review',
                        props: { className: 'text-[var(--theme-content-text)] text-sm leading-relaxed' },
                        text: '{{$item.review}}',
                      },
                      {
                        type: 'Text',
                        id: 'testimonial-author',
                        props: { className: 'text-[var(--theme-content-textMuted)] text-xs font-semibold' },
                        text: '{{$item.author}}',
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

export const testimonialsVariants = [testimonialsCardsDark, testimonialsLargeFeatured, testimonialsGrid];
