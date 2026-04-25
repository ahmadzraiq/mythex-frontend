import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-toast',
  'Toast',
  {
    type: 'Box',
    condition: '',
    props: {
      className: 'fixed top-[16px] right-[16px] z-[60] w-[360px] bg-white dark:bg-gray-900 rounded-[8px] p-[16px] border border-gray-200 dark:border-gray-700 flex flex-row items-start gap-[12px]',
      style: { boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)' },
      animation: { enter: { type: 'slideInRight', duration: 200 } },
    },
    children: [
      { type: 'Icon', props: { icon: 'lucide:check-circle', size: 20, color: '#22c55e' } },
      {
        type: 'Box',
        props: { className: 'flex-1 flex flex-col gap-[2px]' },
        children: [
          { type: 'Text', props: { className: 'text-[14px] font-semibold text-gray-900 dark:text-white' }, text: 'Success' },
          { type: 'Text', props: { className: 'text-[12px] text-gray-500 dark:text-gray-400' }, text: 'Your action was completed successfully.' },
        ],
      },
      { type: 'Box', props: { className: 'cursor-pointer p-[2px]' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 16, color: '#9ca3af' } }] },
    ],
  },
  { icon: '🔔' },
);
