import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-table',
  'Table',
  {
    type: 'Box',
    props: { className: 'w-full overflow-hidden rounded-[6px] border border-border' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex flex-row bg-muted' },
        children: [
          { type: 'Box', props: { className: 'flex-1 px-[12px] py-[8px] border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-[12px] font-semibold text-foreground uppercase' }, text: 'Name' }] },
          { type: 'Box', props: { className: 'flex-1 px-[12px] py-[8px] border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-[12px] font-semibold text-foreground uppercase' }, text: 'Status' }] },
          { type: 'Box', props: { className: 'flex-1 px-[12px] py-[8px]' }, children: [{ type: 'Text', props: { className: 'text-[12px] font-semibold text-foreground uppercase' }, text: 'Amount' }] },
        ],
      },
      {
        type: 'Box',
        props: { className: 'flex flex-row border-t border-border' },
        children: [
          { type: 'Box', props: { className: 'flex-1 px-[12px] py-[8px] border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Alice' }] },
          { type: 'Box', props: { className: 'flex-1 px-[12px] py-[8px] border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-green-600' }, text: 'Active' }] },
          { type: 'Box', props: { className: 'flex-1 px-[12px] py-[8px]' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: '$120' }] },
        ],
      },
      {
        type: 'Box',
        props: { className: 'flex flex-row border-t border-border' },
        children: [
          { type: 'Box', props: { className: 'flex-1 px-[12px] py-[8px] border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Bob' }] },
          { type: 'Box', props: { className: 'flex-1 px-[12px] py-[8px] border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-yellow-600' }, text: 'Pending' }] },
          { type: 'Box', props: { className: 'flex-1 px-[12px] py-[8px]' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: '$85' }] },
        ],
      },
    ],
  },
  { icon: '⊞' },
);
