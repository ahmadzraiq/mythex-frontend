/**
 * Sustainability section variants (2)
 * State paths: sustainability.headline, sustainability.body
 */

import type { SectionVariant } from '../types';

export const sustainabilityIconGrid: SectionVariant = {
  _meta: {
    variantId: 'sustainability.icon-grid',
    label: 'Centered icon + headline + body with leaf motif',
    bestFor: ['warm', 'modern', 'minimalist'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['sustainability'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'sustainability-section',
    props: { className: 'w-full py-20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-4xl mx-auto px-4 flex flex-col items-center gap-8 text-center' },
        children: [
          { type: 'NavIcon', id: 'sustainability-icon', props: { icon: 'Leaf', size: 48, className: 'text-[var(--theme-shop-button)]' } },
          { type: 'Heading', id: 'sustainability-heading', props: { size: '3xl', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: '{{sustainability.headline}}' },
          { type: 'Text', id: 'sustainability-body', props: { className: 'text-[var(--theme-content-textMuted)] text-lg leading-relaxed text-center max-w-2xl' }, text: '{{sustainability.body}}' },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-8 flex-wrap justify-center mt-4' },
            children: [
              { type: 'Box', props: { className: 'flex flex-col items-center gap-2' }, children: [{ type: 'NavIcon', props: { icon: 'Recycle', size: 28, className: 'text-green-500' } }, { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)] text-center' }, text: 'Recycled Materials' }] },
              { type: 'Box', props: { className: 'flex flex-col items-center gap-2' }, children: [{ type: 'NavIcon', props: { icon: 'Droplets', size: 28, className: 'text-blue-500' } }, { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)] text-center' }, text: 'Water Conscious' }] },
              { type: 'Box', props: { className: 'flex flex-col items-center gap-2' }, children: [{ type: 'NavIcon', props: { icon: 'Truck', size: 28, className: 'text-[var(--theme-shop-button)]' } }, { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)] text-center' }, text: 'Carbon Neutral Shipping' }] },
            ],
          },
        ],
      },
    ],
  },
};

export const sustainabilityStorySplit: SectionVariant = {
  _meta: {
    variantId: 'sustainability.story-split',
    label: 'Dark band with split — values left, image right',
    bestFor: ['editorial', 'bold', 'luxury', 'warm'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['sustainability'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'sustainability-section',
    props: { className: 'w-full py-20 bg-[var(--theme-footer-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-row items-center gap-12' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-col gap-6' },
            children: [
              { type: 'NavIcon', props: { icon: 'Leaf', size: 40, className: 'text-green-400' } },
              { type: 'Heading', id: 'sustainability-heading', props: { size: '2xl', className: 'font-bold text-[var(--theme-footer-text)]' }, text: '{{sustainability.headline}}' },
              { type: 'Text', id: 'sustainability-body', props: { className: 'text-[var(--theme-footer-textMuted)] leading-relaxed' }, text: '{{sustainability.body}}' },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex-1 grid grid-cols-2 gap-4' },
            children: [
              { type: 'Box', id: 'sus-value-0', props: { className: 'p-4 rounded-xl bg-white/10 flex flex-col gap-2' }, children: [{ type: 'NavIcon', props: { icon: 'Recycle', size: 24, className: 'text-green-400' } }, { type: 'Text', props: { className: 'text-[var(--theme-footer-text)] text-sm font-medium' }, text: '100% Recycled Packaging' }] },
              { type: 'Box', id: 'sus-value-1', props: { className: 'p-4 rounded-xl bg-white/10 flex flex-col gap-2' }, children: [{ type: 'NavIcon', props: { icon: 'Droplets', size: 24, className: 'text-blue-400' } }, { type: 'Text', props: { className: 'text-[var(--theme-footer-text)] text-sm font-medium' }, text: '50% Less Water Used' }] },
              { type: 'Box', id: 'sus-value-2', props: { className: 'p-4 rounded-xl bg-white/10 flex flex-col gap-2' }, children: [{ type: 'NavIcon', props: { icon: 'Truck', size: 24, className: 'text-[var(--theme-footer-text)]' } }, { type: 'Text', props: { className: 'text-[var(--theme-footer-text)] text-sm font-medium' }, text: 'Carbon Neutral by 2026' }] },
              { type: 'Box', id: 'sus-value-3', props: { className: 'p-4 rounded-xl bg-white/10 flex flex-col gap-2' }, children: [{ type: 'NavIcon', props: { icon: 'Heart', size: 24, className: 'text-red-400' } }, { type: 'Text', props: { className: 'text-[var(--theme-footer-text)] text-sm font-medium' }, text: 'Fair Trade Certified' }] },
            ],
          },
        ],
      },
    ],
  },
};

export const sustainabilityVariants = [sustainabilityIconGrid, sustainabilityStorySplit];
