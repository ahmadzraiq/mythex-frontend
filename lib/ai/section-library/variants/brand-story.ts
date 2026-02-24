/**
 * Brand Story section variants (3)
 * State paths: brandStory.headline, brandStory.body, brandStory.imageUrl
 */

import type { SectionVariant } from '../types';

export const brandStorySplitImage: SectionVariant = {
  _meta: {
    variantId: 'brand-story.split-image',
    label: 'Image left, text right — editorial split layout',
    bestFor: ['warm', 'editorial', 'luxury', 'vintage'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/about' },
    statePaths: ['brandStory'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'brand-story-section',
    props: { className: 'w-full py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center gap-12' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex-1 relative h-80 rounded-2xl overflow-hidden' },
            children: [
              { type: 'NextImage', id: 'brand-story-image', props: { src: '{{brandStory.imageUrl}}', alt: 'Our Story', fill: true, className: 'object-cover' } },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-col gap-6' },
            children: [
              {
                type: 'Heading',
                id: 'brand-story-heading',
                props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' },
                text: '{{brandStory.headline}}',
              },
              {
                type: 'Text',
                id: 'brand-story-body',
                props: { className: 'text-[var(--theme-content-textMuted)] text-base leading-relaxed' },
                text: '{{brandStory.body}}',
              },
              {
                type: 'Button',
                id: 'brand-story-cta',
                props: { variant: 'outline', className: '!border-[var(--theme-shop-button)] !text-[var(--theme-shop-button)] self-start' },
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'ButtonText', text: 'Learn More' }],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const brandStoryTextLeft: SectionVariant = {
  _meta: {
    variantId: 'brand-story.text-left',
    label: 'Text right, image fills left — reversed split',
    bestFor: ['modern', 'bold', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/about' },
    statePaths: ['brandStory'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'brand-story-section',
    props: { className: 'w-full py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center gap-12' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-col gap-6' },
            children: [
              {
                type: 'Heading',
                id: 'brand-story-heading',
                props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' },
                text: '{{brandStory.headline}}',
              },
              {
                type: 'Text',
                id: 'brand-story-body',
                props: { className: 'text-[var(--theme-content-textMuted)] text-base leading-relaxed' },
                text: '{{brandStory.body}}',
              },
              {
                type: 'Button',
                id: 'brand-story-cta',
                props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] self-start' },
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'ButtonText', text: 'Our Story' }],
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex-1 relative h-80 rounded-2xl overflow-hidden' },
            children: [
              { type: 'NextImage', id: 'brand-story-image', props: { src: '{{brandStory.imageUrl}}', alt: 'Our Story', fill: true, className: 'object-cover' } },
            ],
          },
        ],
      },
    ],
  },
};

export const brandStoryFullWidth: SectionVariant = {
  _meta: {
    variantId: 'brand-story.full-width',
    label: 'Full-bleed image with quote card overlay — cinematic',
    bestFor: ['luxury', 'editorial', 'bold'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['brandStory'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'brand-story-section',
    props: { className: 'relative w-full min-h-[60vh] overflow-hidden' },
    children: [
      { type: 'NextImage', id: 'brand-story-image', props: { src: '{{brandStory.imageUrl}}', alt: 'Our Story', fill: true, className: 'object-cover' } },
      { type: 'Box', props: { className: 'absolute inset-0 bg-black/50' } },
      {
        type: 'Box',
        id: 'brand-story-card',
        props: { className: 'absolute bottom-8 left-8 max-w-lg bg-white/90 dark:bg-gray-900/90 p-8 rounded-xl' },
        children: [
          {
            type: 'Heading',
            id: 'brand-story-heading',
            props: { size: 'xl', className: 'font-bold text-gray-900 dark:text-white mb-4' },
            text: '{{brandStory.headline}}',
          },
          {
            type: 'Text',
            id: 'brand-story-body',
            props: { className: 'text-gray-600 dark:text-gray-300 text-sm leading-relaxed' },
            text: '{{brandStory.body}}',
          },
        ],
      },
    ],
  },
};

export const brandStoryVariants = [brandStorySplitImage, brandStoryTextLeft, brandStoryFullWidth];
