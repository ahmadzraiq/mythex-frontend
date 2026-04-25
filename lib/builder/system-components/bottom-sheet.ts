import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-bottom-sheet',
  'Bottom Sheet',
  {
    type: 'Box',
    condition: '',
    props: { className: 'fixed inset-0 z-[50] flex items-end' },
    children: [
      { type: 'Box', props: { className: 'absolute inset-0 bg-black/50' } },
      {
        type: 'Box',
        props: {
          className: 'relative z-[1] w-full max-h-[70vh] bg-white dark:bg-gray-900 rounded-t-[16px] p-[24px] flex flex-col gap-[16px]',
          animation: { enter: { type: 'slideInUp', duration: 300 } },
        },
        children: [
          {
            type: 'Box',
            props: { className: 'flex justify-center' },
            children: [{ type: 'Box', props: { className: 'w-[40px] h-[4px] rounded-full bg-gray-300 dark:bg-gray-600' } }],
          },
          { type: 'Text', props: { className: 'text-[18px] font-semibold text-gray-900 dark:text-white' }, text: 'Bottom Sheet' },
          { type: 'Text', props: { className: 'text-[14px] text-gray-600 dark:text-gray-300' }, text: 'Bottom sheet content goes here.' },
        ],
      },
    ],
  },
  { icon: '⬆' },
);
