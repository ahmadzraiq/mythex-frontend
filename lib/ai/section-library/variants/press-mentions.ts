/**
 * Press Mentions section variants (2) — "As Seen In"
 * State paths: pressMentions.headline, pressMentions.outlets — string[]
 */

import type { SectionVariant } from '../types';

export const pressMentionsLogoOnly: SectionVariant = {
  _meta: {
    variantId: 'press-mentions.logo-only',
    label: 'Logo strip — outlet names as styled text logos',
    bestFor: ['luxury', 'editorial', 'modern', 'bold'],
    requiredSlots: [],
    optionalSlots: ['HEADLINE'],
    slotDefaults: { HEADLINE: 'As Seen In' },
    statePaths: ['pressMentions'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'press-section',
    props: { className: 'w-full py-12 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-col items-center gap-8' },
        children: [
          {
            type: 'Text',
            id: 'press-headline',
            props: { className: 'text-[var(--theme-content-textMuted)] text-sm uppercase tracking-widest text-center' },
            text: '[[HEADLINE]]',
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row flex-wrap justify-center items-center gap-8 w-full' },
            children: [
              {
                type: 'Text',
                map: 'pressMentions.outlets',
                key: '$item',
                id: 'press-outlet',
                props: { className: 'text-[var(--theme-content-textMuted)] text-xl font-semibold tracking-tight opacity-50 hover:opacity-100 transition-opacity' },
                text: '{{$item}}',
              },
            ],
          },
        ],
      },
    ],
  },
};

export const pressMentionsQuoteLogo: SectionVariant = {
  _meta: {
    variantId: 'press-mentions.quote-logo',
    label: 'Featured quote + logo strip below',
    bestFor: ['luxury', 'editorial', 'bold'],
    requiredSlots: [],
    optionalSlots: ['HEADLINE'],
    slotDefaults: { HEADLINE: 'As Seen In' },
    statePaths: ['pressMentions'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'press-section',
    props: { className: 'w-full py-16 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-col items-center gap-10' },
        children: [
          {
            type: 'Text',
            id: 'press-quote',
            props: { className: 'text-[var(--theme-content-text)] text-xl italic text-center max-w-2xl leading-relaxed' },
            text: '{{pressMentions.featuredQuote}}',
          },
          { type: 'Box', props: { className: 'w-12 h-0.5 bg-[var(--theme-shop-button)]' } },
          {
            type: 'Text',
            id: 'press-headline',
            props: { className: 'text-[var(--theme-content-textMuted)] text-xs uppercase tracking-widest text-center' },
            text: '[[HEADLINE]]',
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row flex-wrap justify-center items-center gap-8 w-full' },
            children: [
              {
                type: 'Text',
                map: 'pressMentions.outlets',
                key: '$item',
                id: 'press-outlet',
                props: { className: 'text-[var(--theme-content-textMuted)] text-lg font-semibold tracking-tight opacity-50 hover:opacity-100 transition-opacity' },
                text: '{{$item}}',
              },
            ],
          },
        ],
      },
    ],
  },
};

export const pressMentionsVariants = [pressMentionsLogoOnly, pressMentionsQuoteLogo];
