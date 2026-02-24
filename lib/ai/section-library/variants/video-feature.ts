/**
 * Video Feature section variants (2)
 * State paths: videoFeature.heading, videoFeature.subheading, videoFeature.videoUrl
 */

import type { SectionVariant } from '../types';

export const videoFeatureFullWidth: SectionVariant = {
  _meta: {
    variantId: 'video-feature.full-width',
    label: 'Full-width video embed with text overlay',
    bestFor: ['editorial', 'luxury', 'bold', 'modern'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/shop' },
    statePaths: ['videoFeature'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'video-feature-section',
    props: { className: 'w-full py-0 relative overflow-hidden bg-black' },
    children: [
      {
        type: 'Box',
        props: { className: 'relative w-full aspect-video' },
        children: [
          {
            type: 'Box',
            id: 'video-embed',
            props: {
              className: 'absolute inset-0',
              style: { position: 'relative', paddingBottom: '56.25%' },
            },
            children: [
              {
                type: 'Box',
                props: {
                  className: 'absolute inset-0 flex items-center justify-center bg-gray-900',
                },
                children: [
                  { type: 'NavIcon', props: { icon: 'Play', size: 64, className: 'text-white/80' } },
                ],
              },
            ],
          },
          { type: 'Box', props: { className: 'absolute inset-0 bg-gradient-to-t from-black/60 to-transparent' } },
          {
            type: 'Box',
            props: { className: 'absolute bottom-8 left-8 md:left-16 flex flex-col gap-4 max-w-xl' },
            children: [
              { type: 'Heading', id: 'video-heading', props: { size: '3xl', className: 'text-white font-bold drop-shadow-lg' }, text: '{{videoFeature.heading}}' },
              { type: 'Text', id: 'video-subheading', props: { className: 'text-white/90 text-base drop-shadow' }, text: '{{videoFeature.subheading}}' },
              {
                type: 'Button',
                id: 'video-cta',
                props: { className: '!bg-white !text-gray-900 self-start' },
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'ButtonText', text: 'Watch Now' }],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const videoFeatureContained: SectionVariant = {
  _meta: {
    variantId: 'video-feature.contained',
    label: 'Contained card with text + video thumbnail side by side',
    bestFor: ['modern', 'warm', 'minimalist'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/shop' },
    statePaths: ['videoFeature'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'video-feature-section',
    props: { className: 'w-full py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-row items-center gap-12' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-col gap-6' },
            children: [
              { type: 'Heading', id: 'video-heading', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: '{{videoFeature.heading}}' },
              { type: 'Text', id: 'video-subheading', props: { className: 'text-[var(--theme-content-textMuted)] leading-relaxed' }, text: '{{videoFeature.subheading}}' },
              {
                type: 'Button',
                id: 'video-cta',
                props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] self-start' },
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'ButtonText', text: 'Watch Now' }],
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex-1 relative h-72 rounded-2xl overflow-hidden bg-gray-900 flex items-center justify-center' },
            children: [
              { type: 'NavIcon', props: { icon: 'Play', size: 48, className: 'text-white/80' } },
            ],
          },
        ],
      },
    ],
  },
};

export const videoFeatureVariants = [videoFeatureFullWidth, videoFeatureContained];
