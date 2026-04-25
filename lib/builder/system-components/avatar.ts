import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-avatar',
  'Avatar',
  {
    type: 'Box',
    props: { className: 'w-[48px] h-[48px] rounded-[9999px] bg-gray-200 flex items-center justify-center overflow-hidden' },
    children: [
      { type: 'Text', props: { className: 'text-[14px] font-medium text-gray-600' }, text: 'AB' },
    ],
  },
  { icon: '👤' },
);
