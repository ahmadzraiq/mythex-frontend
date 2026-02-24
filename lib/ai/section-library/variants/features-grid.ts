/**
 * Features Grid (USP bar) section variants (3)
 * State paths: features — [{icon, title, description}] (3 items)
 */

import type { SectionVariant } from '../types';

const featureItem = (index: number) => ({
  type: 'Box',
  id: `feature-item-${index}`,
  props: { className: 'flex flex-col items-center text-center gap-3' },
  children: [
    { type: 'NavIcon', props: { icon: `{{features[${index}].icon}}`, size: 32, className: 'text-[var(--theme-shop-button)]' } },
    { type: 'Heading', props: { size: 'sm', className: 'font-bold text-[var(--theme-content-text)] text-center' }, text: `{{features[${index}].title}}` },
    { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] text-sm text-center' }, text: `{{features[${index}].description}}` },
  ],
});

const numberedItem = (index: number, num: string) => ({
  type: 'Box',
  id: `feature-item-${index}`,
  props: { className: 'flex flex-col gap-3' },
  children: [
    { type: 'Text', props: { className: 'text-[var(--theme-shop-button)] text-5xl font-bold leading-none' }, text: num },
    { type: 'Heading', props: { size: 'sm', className: 'font-bold text-[var(--theme-content-text)] mt-2' }, text: `{{features[${index}].title}}` },
    { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] text-sm leading-relaxed' }, text: `{{features[${index}].description}}` },
  ],
});

export const featuresIconRow: SectionVariant = {
  _meta: {
    variantId: 'features-grid.icon-row',
    label: '3-column icon grid with centered text',
    bestFor: ['modern', 'minimalist', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['features'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'features-section',
    props: { className: 'w-full py-16 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8' },
        children: [featureItem(0), featureItem(1), featureItem(2)],
      },
    ],
  },
};

export const featuresNumbered: SectionVariant = {
  _meta: {
    variantId: 'features-grid.numbered',
    label: 'Numbered list — bold numbers as visual anchor',
    bestFor: ['bold', 'editorial', 'luxury'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['features'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'features-section',
    props: { className: 'w-full py-16 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-10' },
        children: [numberedItem(0, '01'), numberedItem(1, '02'), numberedItem(2, '03')],
      },
    ],
  },
};

export const featuresAlternating: SectionVariant = {
  _meta: {
    variantId: 'features-grid.alternating',
    label: 'Alternating rows — icon left, text right, full-width',
    bestFor: ['warm', 'modern', 'vintage'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['features'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'features-section',
    props: { className: 'w-full py-16 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-4xl mx-auto px-4 flex flex-col gap-12' },
        children: [
          {
            type: 'Box',
            id: 'feature-item-0',
            props: { className: 'flex flex-row items-center gap-8' },
            children: [
              { type: 'NavIcon', props: { icon: '{{features[0].icon}}', size: 48, className: 'text-[var(--theme-shop-button)] flex-none' } },
              {
                type: 'Box',
                props: { className: 'flex flex-col gap-2' },
                children: [
                  { type: 'Heading', props: { size: 'md', className: 'font-bold text-[var(--theme-content-text)]' }, text: '{{features[0].title}}' },
                  { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] leading-relaxed' }, text: '{{features[0].description}}' },
                ],
              },
            ],
          },
          {
            type: 'Box',
            id: 'feature-item-1',
            props: { className: 'flex flex-row-reverse items-center gap-8' },
            children: [
              { type: 'NavIcon', props: { icon: '{{features[1].icon}}', size: 48, className: 'text-[var(--theme-shop-button)] flex-none' } },
              {
                type: 'Box',
                props: { className: 'flex flex-col gap-2' },
                children: [
                  { type: 'Heading', props: { size: 'md', className: 'font-bold text-[var(--theme-content-text)]' }, text: '{{features[1].title}}' },
                  { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] leading-relaxed' }, text: '{{features[1].description}}' },
                ],
              },
            ],
          },
          {
            type: 'Box',
            id: 'feature-item-2',
            props: { className: 'flex flex-row items-center gap-8' },
            children: [
              { type: 'NavIcon', props: { icon: '{{features[2].icon}}', size: 48, className: 'text-[var(--theme-shop-button)] flex-none' } },
              {
                type: 'Box',
                props: { className: 'flex flex-col gap-2' },
                children: [
                  { type: 'Heading', props: { size: 'md', className: 'font-bold text-[var(--theme-content-text)]' }, text: '{{features[2].title}}' },
                  { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] leading-relaxed' }, text: '{{features[2].description}}' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const featuresGridVariants = [featuresIconRow, featuresNumbered, featuresAlternating];
