import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-alert',
  'Alert',
  {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-[12px] p-[16px] rounded-[6px] bg-amber-50 border border-amber-200' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:alert-circle', size: 18, color: '#d97706' } },
      { type: 'Text', text: 'This is an alert message.', props: { className: 'text-[14px] text-amber-800' } },
    ],
  },
  { icon: '⚠' },
);
