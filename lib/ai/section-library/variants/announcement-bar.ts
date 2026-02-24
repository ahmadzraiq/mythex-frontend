/**
 * Announcement Bar section variants (1)
 * State paths: announcement.text, announcement.ctaLabel, announcement.ctaPath
 */

import type { SectionVariant } from '../types';

export const announcementBarDefault: SectionVariant = {
  _meta: {
    variantId: 'announcement-bar.default',
    label: 'Top promo strip with dismiss button',
    bestFor: ['modern', 'bold', 'playful', 'warm', 'luxury', 'minimalist', 'editorial', 'vintage'],
    requiredSlots: [],
    optionalSlots: [],
    slotDefaults: {},
    statePaths: ['announcement'],
    initActions: [],
  },
  node: {
    type: 'Box',
    id: 'announcement-bar',
    props: { className: 'w-full bg-[var(--theme-announcement-bg)] py-2 px-4 flex flex-row items-center justify-between' },
    condition: { '!': [{ var: 'screens.home.announcementDismissed' }] },
    children: [
      { type: 'Box', props: { className: 'flex-1' } },
      {
        type: 'Text',
        id: 'announcement-text',
        props: { className: 'flex-1 text-[var(--theme-announcement-text)] text-sm text-center' },
        text: '{{announcement.text}}',
      },
      {
        type: 'Pressable',
        id: 'announcement-dismiss',
        props: { className: 'flex-none' },
        actions: { click: { action: 'setState', payload: { path: 'screens.home.announcementDismissed', value: true } } },
        children: [
          { type: 'Text', props: { className: 'text-[var(--theme-announcement-text)] text-lg leading-none px-2' }, text: '\u00d7' },
        ],
      },
    ],
  },
};

export const announcementBarVariants = [announcementBarDefault];
