import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-badge',
  'Badge',
  {
    type: 'Box',
    props: { className: 'w-fit inline-flex flex-row items-center px-[10px] py-[2px] rounded-[9999px] bg-[var(--theme-primary)]' },
    children: [
      { type: 'Text', props: { className: 'text-[12px] font-medium text-white' }, text: 'Badge' },
    ],
  },
  { icon: '🏷' },
);
