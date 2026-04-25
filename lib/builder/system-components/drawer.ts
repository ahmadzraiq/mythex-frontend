import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-drawer',
  'Drawer',
  {
    type: 'Box',
    condition: '',
    props: { className: 'fixed inset-0 z-[50] flex flex-row' },
    children: [
      {
        type: 'Box',
        props: {
          className: 'relative z-[1] w-[320px] h-full bg-white dark:bg-gray-900 p-[24px] flex flex-col gap-[16px]',
          animation: { enter: { type: 'slideInLeft', duration: 300 } },
        },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between' },
            children: [
              { type: 'Text', props: { className: 'text-[18px] font-semibold text-gray-900 dark:text-white' }, text: 'Drawer' },
              { type: 'Box', props: { className: 'cursor-pointer p-[4px]' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 18, color: '#6b7280' } }] },
            ],
          },
          { type: 'Text', props: { className: 'text-[14px] text-gray-600 dark:text-gray-300' }, text: 'Drawer content goes here.' },
        ],
      },
      { type: 'Box', props: { className: 'flex-1 bg-black/50' } },
    ],
  },
  { icon: '☰' },
);
