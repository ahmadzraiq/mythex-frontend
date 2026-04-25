import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-accordion',
  'Accordion',
  {
    type: 'Box',
    props: { className: 'w-full border border-border rounded-[6px] overflow-hidden' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex flex-row items-center justify-between p-[16px] bg-background' },
        children: [
          { type: 'Text', props: { className: 'text-[14px] font-medium text-foreground' }, text: 'Section Title' },
          { type: 'Icon', props: { icon: 'lucide:chevron-down', size: 16, color: '#6b7280' } },
        ],
      },
      { type: 'Box', props: { className: 'p-[16px] bg-muted border-t border-border' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Accordion content goes here.' }] },
    ],
  },
  { icon: '▾' },
);
