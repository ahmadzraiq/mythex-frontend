import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-snackbar',
  'Snackbar',
  {
    type: 'Box',
    props: { className: 'flex flex-row items-center justify-between gap-[12px] px-[16px] py-[12px] rounded-[8px] bg-gray-900 shadow-lg w-full max-w-[384px]' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:check-circle', size: 18, color: '#4ade80' } },
      { type: 'Text', props: { className: 'flex-1 text-[14px] font-medium text-white' }, text: 'Action completed successfully.' },
      { type: 'Box', props: { className: 'ml-[8px]' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 16, color: '#9ca3af' } }] },
    ],
  },
  { icon: '🔔' },
);
