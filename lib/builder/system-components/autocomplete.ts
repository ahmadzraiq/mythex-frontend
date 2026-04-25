import { makeSystemComponent } from './_make';

export default makeSystemComponent(
  'sys-autocomplete',
  'Autocomplete',
  {
    type: 'Box',
    props: { className: 'relative flex flex-col w-full' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-[8px] px-[12px] rounded-[6px] border border-border bg-background' },
        children: [
          { type: 'Icon', props: { icon: 'lucide:search', size: 16, color: '#9ca3af' } },
          { type: 'Input', props: { variant: 'unstyled', size: 'md', className: 'flex-1 !border-none !bg-transparent', placeholder: 'Search…' } },
        ],
      },
      {
        type: 'Box',
        props: { className: 'absolute top-full left-0 right-0 z-[50] bg-background border border-border rounded-[6px] shadow-md mt-[4px] overflow-hidden' },
        children: [
          { type: 'Box', props: { className: 'px-[12px] py-[8px] hover:bg-muted border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Option 1' }] },
          { type: 'Box', props: { className: 'px-[12px] py-[8px] hover:bg-muted border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Option 2' }] },
          { type: 'Box', props: { className: 'px-[12px] py-[8px] hover:bg-muted' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Option 3' }] },
        ],
      },
    ],
  },
  { icon: '⌕' },
);
