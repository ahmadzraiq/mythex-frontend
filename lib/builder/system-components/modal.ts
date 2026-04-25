import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-modal',
  'Modal',
  {
    type: 'Box',
    condition: '',
    props: { className: 'fixed inset-0 z-[50] flex items-center justify-center' },
    children: [
      { type: 'Box', props: { className: 'absolute inset-0 bg-black/50' } },
      {
        type: 'Box',
        props: {
          className: 'relative z-[1] w-[480px] max-w-[90vw] bg-white dark:bg-gray-900 rounded-[12px] p-[24px] flex flex-col gap-[16px]',
          animation: { enter: { type: 'zoomIn', duration: 200 } },
        },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between' },
            children: [
              { type: 'Text', props: { className: 'text-[18px] font-semibold text-gray-900 dark:text-white' }, text: 'Modal Title' },
              { type: 'Box', props: { className: 'cursor-pointer p-[4px]' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 18, color: '#6b7280' } }] },
            ],
          },
          { type: 'Text', props: { className: 'text-[14px] text-gray-600 dark:text-gray-300' }, text: 'Modal body content goes here.' },
          {
            type: 'Box',
            props: { className: 'flex flex-row justify-end gap-[8px] pt-[8px]' },
            children: [
              { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-[16px] py-[8px] rounded-[6px] bg-gray-200 dark:bg-gray-700 hover:opacity-90 cursor-pointer' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-gray-800 dark:text-gray-200' }, text: 'Cancel' }] },
              { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-[16px] py-[8px] rounded-[6px] bg-[var(--theme-primary)] hover:opacity-90 cursor-pointer' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-[var(--theme-primary-foreground)]' }, text: 'Confirm' }] },
            ],
          },
        ],
      },
    ],
  },
  { icon: '🗔' },
);
