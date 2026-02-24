/**
 * Hero section variants (5)
 *
 * Slots:
 *   [[CTA_PATH]] — primary CTA navigation path (default: /shop)
 *   [[CTA_PATH_2]] — secondary CTA navigation path (default: /about)
 *
 * State paths read at runtime (already in prebuiltState):
 *   hero.heading, hero.subheading, hero.ctaLabel, hero.imageUrl
 */

import type { SectionVariant } from '../types';

export const heroOverlayCentered: SectionVariant = {
  _meta: {
    variantId: 'hero.overlay-centered',
    label: 'Full-bleed image, gradient overlay, centered text',
    bestFor: ['luxury', 'bold', 'editorial', 'modern'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/shop' },
    statePaths: ['hero'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'hero-section',
    props: { className: 'relative w-full min-h-[80vh] flex flex-col items-center justify-center overflow-hidden' },
    children: [
      {
        type: 'NextImage',
        id: 'hero-image',
        props: { src: '{{hero.imageUrl}}', alt: 'Hero', fill: true, className: 'object-cover' },
      },
      {
        type: 'Box',
        props: { className: 'absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent' },
      },
      {
        type: 'Box',
        props: { className: 'relative z-10 flex flex-col items-center gap-6 px-4 text-center max-w-3xl mx-auto' },
        children: [
          {
            type: 'Heading',
            id: 'hero-heading',
            props: { size: '4xl', className: 'text-white font-bold drop-shadow-lg text-center' },
            text: '{{hero.heading}}',
          },
          {
            type: 'Text',
            id: 'hero-subheading',
            props: { className: 'text-white/90 text-xl drop-shadow text-center' },
            text: '{{hero.subheading}}',
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-4 mt-2' },
            children: [
              {
                type: 'Button',
                id: 'hero-cta-primary',
                props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)]' },
                actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
                children: [{ type: 'ButtonText', text: '{{hero.ctaLabel}}' }],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const heroSplitLeft: SectionVariant = {
  _meta: {
    variantId: 'hero.split-left',
    label: 'Text left, image right, full height',
    bestFor: ['modern', 'minimalist', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/shop' },
    statePaths: ['hero'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'hero-section',
    props: { className: 'w-full min-h-[80vh] flex flex-row items-stretch overflow-hidden bg-[var(--theme-hero-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex-1 flex flex-col justify-center gap-6 px-12 md:px-16 py-16' },
        children: [
          {
            type: 'Heading',
            id: 'hero-heading',
            props: { size: '4xl', className: 'font-bold text-[var(--theme-content-text)] leading-tight' },
            text: '{{hero.heading}}',
          },
          {
            type: 'Text',
            id: 'hero-subheading',
            props: { className: 'text-[var(--theme-content-textMuted)] text-xl max-w-md' },
            text: '{{hero.subheading}}',
          },
          {
            type: 'Button',
            id: 'hero-cta-primary',
            props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] self-start mt-2' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'ButtonText', text: '{{hero.ctaLabel}}' }],
          },
        ],
      },
      {
        type: 'Box',
        props: { className: 'flex-1 relative min-h-[80vh]' },
        children: [
          {
            type: 'NextImage',
            id: 'hero-image',
            props: { src: '{{hero.imageUrl}}', alt: 'Hero', fill: true, className: 'object-cover' },
          },
        ],
      },
    ],
  },
};

export const heroSplitRight: SectionVariant = {
  _meta: {
    variantId: 'hero.split-right',
    label: 'Image left, bold text right',
    bestFor: ['editorial', 'luxury', 'vintage'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
    slotDefaults: { CTA_PATH: '/shop' },
    statePaths: ['hero'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'hero-section',
    props: { className: 'w-full min-h-[80vh] flex flex-row items-stretch overflow-hidden bg-[var(--theme-hero-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex-1 relative min-h-[80vh]' },
        children: [
          {
            type: 'NextImage',
            id: 'hero-image',
            props: { src: '{{hero.imageUrl}}', alt: 'Hero', fill: true, className: 'object-cover' },
          },
        ],
      },
      {
        type: 'Box',
        props: { className: 'flex-1 flex flex-col justify-center gap-6 px-12 md:px-16 py-16 bg-[var(--theme-hero-bg)]' },
        children: [
          {
            type: 'Heading',
            id: 'hero-heading',
            props: { size: '4xl', className: 'font-bold text-[var(--theme-content-text)] leading-tight' },
            text: '{{hero.heading}}',
          },
          {
            type: 'Text',
            id: 'hero-subheading',
            props: { className: 'text-[var(--theme-content-textMuted)] text-xl max-w-md' },
            text: '{{hero.subheading}}',
          },
          {
            type: 'Button',
            id: 'hero-cta-primary',
            props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] self-start mt-2' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'ButtonText', text: '{{hero.ctaLabel}}' }],
          },
        ],
      },
    ],
  },
};

export const heroTextOnly: SectionVariant = {
  _meta: {
    variantId: 'hero.text-only',
    label: 'Typographic, no image, brand gradient background',
    bestFor: ['minimalist', 'bold', 'modern'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH', 'CTA_PATH_2'],
    slotDefaults: { CTA_PATH: '/shop', CTA_PATH_2: '/about' },
    statePaths: ['hero'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'hero-section',
    props: { className: 'w-full min-h-[70vh] flex flex-col items-center justify-center gap-8 bg-gradient-to-br from-[var(--theme-hero-bg)] to-[var(--theme-content-bg)] px-4' },
    children: [
      {
        type: 'Heading',
        id: 'hero-heading',
        props: { size: '5xl', className: 'text-center font-bold text-[var(--theme-content-text)] max-w-4xl leading-tight' },
        text: '{{hero.heading}}',
      },
      {
        type: 'Text',
        id: 'hero-subheading',
        props: { className: 'text-[var(--theme-content-textMuted)] text-xl text-center max-w-2xl' },
        text: '{{hero.subheading}}',
      },
      {
        type: 'Box',
        props: { className: 'flex flex-row gap-4 mt-2' },
        children: [
          {
            type: 'Button',
            id: 'hero-cta-primary',
            props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)]' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'ButtonText', text: '{{hero.ctaLabel}}' }],
          },
          {
            type: 'Button',
            id: 'hero-cta-secondary',
            props: { variant: 'outline', className: '!border-[var(--theme-content-text)] !text-[var(--theme-content-text)]' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH_2]]' } } },
            children: [{ type: 'ButtonText', text: 'Our Story' }],
          },
        ],
      },
    ],
  },
};

export const heroAsymmetric: SectionVariant = {
  _meta: {
    variantId: 'hero.asymmetric',
    label: 'Text card floats bottom-left over full-bleed image',
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
    props: { className: 'relative w-full min-h-[85vh] overflow-hidden' },
    children: [
      {
        type: 'NextImage',
        id: 'hero-image',
        props: { src: '{{hero.imageUrl}}', alt: 'Hero', fill: true, className: 'object-cover object-top' },
      },
      {
        type: 'Box',
        props: { className: 'absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-transparent' },
      },
      {
        type: 'Box',
        props: { className: 'absolute bottom-12 left-8 md:left-16 max-w-lg flex flex-col gap-4' },
        children: [
          {
            type: 'Heading',
            id: 'hero-heading',
            props: { size: '4xl', className: 'text-white font-bold drop-shadow-lg' },
            text: '{{hero.heading}}',
          },
          {
            type: 'Text',
            id: 'hero-subheading',
            props: { className: 'text-white/90 text-lg drop-shadow' },
            text: '{{hero.subheading}}',
          },
          {
            type: 'Button',
            id: 'hero-cta-primary',
            props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] self-start' },
            actions: { click: { action: 'navigate', payload: { path: '[[CTA_PATH]]' } } },
            children: [{ type: 'ButtonText', text: '{{hero.ctaLabel}}' }],
          },
        ],
      },
    ],
  },
};

export const heroVariants = [
  heroOverlayCentered,
  heroSplitLeft,
  heroSplitRight,
  heroTextOnly,
  heroAsymmetric,
];
