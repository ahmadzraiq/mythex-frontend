/**
 * Newsletter section variants (3)
 * State paths: newsletter.heading, newsletter.subheading, form.email
 */

import type { SectionVariant } from '../types';

const EMAIL_INPUT = {
  type: 'Input',
  id: 'newsletter-input',
  props: { variant: 'outline', size: 'md', className: 'flex-1 !rounded-md !border-gray-600 !bg-transparent' },
  children: [
    {
      type: 'InputField',
      props: { placeholder: 'Your email address', placeholderTextColor: '#9ca3af', className: '!text-white' },
      actions: { change: { type: 'runMultiple', actions: [{ action: 'setState', payload: { path: 'screens.home.form.email', value: '$event' } }] } },
    },
  ],
};

const SUBSCRIBE_BUTTON = {
  type: 'Button',
  id: 'newsletter-submit',
  props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] flex-none' },
  actions: { click: { action: 'subscribeNewsletter' } },
  children: [{ type: 'ButtonText', text: 'Subscribe' }],
};

export const newsletterDarkBand: SectionVariant = {
  _meta: {
    variantId: 'newsletter.dark-band',
    label: 'Dark full-width band, centered text and email input',
    bestFor: ['luxury', 'bold', 'modern', 'editorial'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['newsletter'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'newsletter-section',
    props: { className: 'w-full py-20 bg-[var(--theme-footer-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-2xl mx-auto px-4 flex flex-col items-center gap-6 text-center' },
        children: [
          {
            type: 'Heading',
            id: 'newsletter-heading',
            props: { size: '2xl', className: 'font-bold text-[var(--theme-footer-text)] text-center' },
            text: '{{newsletter.heading}}',
          },
          {
            type: 'Text',
            id: 'newsletter-subheading',
            props: { className: 'text-[var(--theme-footer-textMuted)] text-base text-center' },
            text: '{{newsletter.subheading}}',
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-3 w-full max-w-md' },
            children: [EMAIL_INPUT, SUBSCRIBE_BUTTON],
          },
        ],
      },
    ],
  },
};

export const newsletterTwoCol: SectionVariant = {
  _meta: {
    variantId: 'newsletter.two-col',
    label: 'Text left, input right — two column split layout',
    bestFor: ['modern', 'minimalist', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['newsletter'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'newsletter-section',
    props: { className: 'w-full py-20 bg-[var(--theme-shop-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-6xl mx-auto px-4 flex flex-row items-center gap-12' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-col gap-4' },
            children: [
              {
                type: 'Heading',
                id: 'newsletter-heading',
                props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)]' },
                text: '{{newsletter.heading}}',
              },
              {
                type: 'Text',
                id: 'newsletter-subheading',
                props: { className: 'text-[var(--theme-content-textMuted)] text-base max-w-sm' },
                text: '{{newsletter.subheading}}',
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-row gap-3' },
            children: [
              {
                type: 'Input',
                id: 'newsletter-input',
                props: { variant: 'outline', size: 'md', className: 'flex-1 !rounded-md !border-gray-200' },
                children: [
                  {
                    type: 'InputField',
                    props: { placeholder: 'Your email address', placeholderTextColor: '#9ca3af', className: '!text-gray-900 dark:!text-gray-100' },
                    actions: { change: { type: 'runMultiple', actions: [{ action: 'setState', payload: { path: 'screens.home.form.email', value: '$event' } }] } },
                  },
                ],
              },
              {
                type: 'Button',
                id: 'newsletter-submit',
                props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] flex-none' },
                actions: { click: { action: 'subscribeNewsletter' } },
                children: [{ type: 'ButtonText', text: 'Subscribe' }],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const newsletterMinimal: SectionVariant = {
  _meta: {
    variantId: 'newsletter.minimal',
    label: 'Minimal inline — text and input in one horizontal row',
    bestFor: ['minimalist', 'modern', 'luxury'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['newsletter'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'newsletter-section',
    props: { className: 'w-full py-10 border-t border-[var(--theme-content-textMuted)]/20 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'w-full max-w-5xl mx-auto px-4 flex flex-row items-center justify-between gap-6 flex-wrap' },
        children: [
          {
            type: 'Text',
            id: 'newsletter-heading',
            props: { className: 'font-medium text-base text-[var(--theme-content-text)]' },
            text: '{{newsletter.heading}}',
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row gap-3 flex-1 max-w-sm' },
            children: [
              {
                type: 'Input',
                id: 'newsletter-input',
                props: { variant: 'outline', size: 'sm', className: 'flex-1 !rounded-md !border-gray-200' },
                children: [
                  {
                    type: 'InputField',
                    props: { placeholder: 'Enter email', placeholderTextColor: '#9ca3af', className: '!text-gray-900 dark:!text-gray-100' },
                    actions: { change: { type: 'runMultiple', actions: [{ action: 'setState', payload: { path: 'screens.home.form.email', value: '$event' } }] } },
                  },
                ],
              },
              {
                type: 'Button',
                id: 'newsletter-submit',
                props: { size: 'sm', className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] flex-none' },
                actions: { click: { action: 'subscribeNewsletter' } },
                children: [{ type: 'ButtonText', text: 'Join' }],
              },
            ],
          },
        ],
      },
    ],
  },
};

export const newsletterVariants = [newsletterDarkBand, newsletterTwoCol, newsletterMinimal];
