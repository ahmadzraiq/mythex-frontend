/**
 * primitive-components.ts
 *
 * Single source of truth for all draggable builder components.
 * Imported by:
 *  - app/dev/builder/_components-tab.tsx  (palette UI)
 *  - lib/ai/sdui-component-schema.ts      (AI tool templates)
 *  - lib/ai/builder-tools.ts              (Anthropic tool enum)
 *  - app/api/ai/generate-sections/route.ts (section prompt labels)
 *
 * Pure TypeScript — no React, no 'use client'.
 */

export interface PrimitiveComponent {
  type: string;
  label: string;
  icon: string;
  defaultNode: object;
  /**
   * Controls how the AI template is stripped before being handed to the AI:
   *   'placeholder' — remove only sample Heading/Text children (e.g. Card's "Card Title")
   *   'all'         — remove ALL defaultNode children (e.g. Form's preset email+password+submit)
   *   undefined     — keep children as-is
   */
  aiStrip?: 'all' | 'placeholder';
}

export const PRIMITIVE_COMPONENTS: Record<string, PrimitiveComponent[]> = {
  Layout: [
    { type: 'Box',    label: 'Box',        icon: '□',
      defaultNode: { type: 'Box',    props: { className: 'flex flex-col' } } },
    { type: 'Box',    label: 'Row',        icon: '⬌',
      defaultNode: { type: 'Box',    props: { className: 'flex flex-row items-center' } } },
    { type: 'VStack', label: 'VStack',     icon: '⬇',
      defaultNode: { type: 'Box', props: { className: 'flex flex-col' } } },
    { type: 'HStack', label: 'HStack',     icon: '➡',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center' } } },
    { type: 'Center', label: 'Center',     icon: '⊕',
      defaultNode: { type: 'Box', props: { className: 'flex flex-col items-center justify-center' } } },
    { type: 'Grid',   label: 'Grid',       icon: '⊞',
      defaultNode: { type: 'Grid', props: { className: 'grid' } } },
    { type: 'Box',    label: 'Card',       icon: '▣', aiStrip: 'placeholder',
      defaultNode: { type: 'Box', props: { className: 'rounded-[8px] border border-border bg-[var(--theme-card)] p-[16px] flex flex-col gap-[8px]' }, children: [{ type: 'Heading', text: 'Card Title', props: { className: 'text-[18px] font-semibold' } }, { type: 'Text', text: 'Card content goes here.', props: { className: 'text-[14px] text-muted-foreground' } }] } },
    { type: 'Box',    label: 'Divider',    icon: '—',
      defaultNode: { type: 'Box', props: { className: 'w-full h-px bg-border' } } },
    { type: 'Box',    label: 'ScrollView', icon: '↕',
      defaultNode: { type: 'Box', props: { className: 'flex flex-col overflow-auto', style: { maxHeight: '200px' } }, children: [{ type: 'Text', text: 'Scroll content here', props: { className: 'text-[14px] text-foreground' } }] } },
  ],
  Typography: [
    { type: 'Text',    label: 'Text',    icon: 'T',
      defaultNode: { type: 'Text',    text: 'Text block', props: { className: 'text-[16px] text-foreground' } } },
    { type: 'Heading', label: 'Heading', icon: 'H',
      defaultNode: { type: 'Heading', text: 'Heading',    props: { className: 'text-[24px] font-bold text-foreground' } } },
    { type: 'Text',    label: 'Label',   icon: 'L',
      defaultNode: { type: 'Text',    text: 'Label',      props: { className: 'text-[14px] font-medium text-foreground' } } },
    { type: 'Text',    label: 'Caption', icon: 'C',
      defaultNode: { type: 'Text',    text: 'Caption',    props: { className: 'text-[12px] text-muted-foreground' } } },
    { type: 'Box',  label: 'Link',    icon: '🔗',
      defaultNode: { type: 'Box', props: { href: '#' }, children: [{ type: 'Text', text: 'Link text', props: { className: 'text-[14px] text-primary underline cursor-pointer' } }] } },
  ],
  Buttons: [
    { type: 'Box', label: 'Btn Solid',       icon: '◼',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-[20px] py-[10px] rounded-[6px] bg-[var(--theme-primary)] hover:opacity-90 active:opacity-80' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-[var(--theme-primary-foreground)]' }, text: 'Button' }] } },
    { type: 'Box', label: 'Btn Destructive', icon: '⛔',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-[20px] py-[10px] rounded-[6px] bg-red-600 hover:bg-red-700 active:bg-red-800' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-white' }, text: 'Delete' }] } },
    { type: 'Box', label: 'Btn Outline',     icon: '◻',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-[20px] py-[10px] rounded-[6px] border border-[var(--theme-foreground)] hover:bg-[var(--theme-foreground)]/10' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-[var(--theme-foreground)]' }, text: 'Button' }] } },
    { type: 'Box', label: 'Btn Ghost',       icon: '○',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-[20px] py-[10px] rounded-[6px] hover:bg-[var(--theme-foreground)]/10' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-[var(--theme-foreground)]' }, text: 'Button' }] } },
    { type: 'Box', label: 'Btn + Icon L',    icon: '◀',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center gap-[8px] px-[20px] py-[10px] rounded-[6px] bg-[var(--theme-primary)] hover:opacity-90' }, children: [{ type: 'Icon', props: { icon: 'lucide:star', size: 16, color: 'var(--theme-primary-foreground)' } }, { type: 'Text', props: { className: 'text-[14px] font-medium text-[var(--theme-primary-foreground)]' }, text: 'Button' }] } },
    { type: 'Box', label: 'Btn + Icon R',    icon: '▶',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center gap-[8px] px-[20px] py-[10px] rounded-[6px] bg-[var(--theme-primary)] hover:opacity-90' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-[var(--theme-primary-foreground)]' }, text: 'Button' }, { type: 'Icon', props: { icon: 'lucide:arrow-right', size: 16, color: 'var(--theme-primary-foreground)' } }] } },
    { type: 'Box', label: 'Icon Btn',        icon: '⬚',
      defaultNode: { type: 'Box', props: { className: 'flex items-center justify-center w-[40px] h-[40px] rounded-[6px] hover:bg-[var(--theme-muted)] transition-colors' }, children: [{ type: 'Icon', props: { icon: 'lucide:star', size: 18, color: 'var(--theme-muted-foreground)' } }] } },
    { type: 'Box', label: 'Icon Btn Round',  icon: '◉',
      defaultNode: { type: 'Box', props: { className: 'flex items-center justify-center w-[40px] h-[40px] rounded-[9999px] hover:bg-[var(--theme-muted)] transition-colors' }, children: [{ type: 'Icon', props: { icon: 'lucide:star', size: 18, color: 'var(--theme-muted-foreground)' } }] } },
    { type: 'Box', label: 'Link Btn',        icon: '⇒',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center gap-[4px]' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-[var(--theme-foreground)] underline' }, text: 'Learn more' }, { type: 'Icon', props: { icon: 'lucide:arrow-right', size: 14, color: 'currentColor' } }] } },
    { type: 'Box', label: 'FAB',             icon: '⊕',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center gap-[8px] px-[20px] py-[12px] rounded-[9999px] bg-[var(--theme-primary)] shadow-lg hover:opacity-90' }, children: [{ type: 'Icon', props: { icon: 'lucide:plus', size: 20, color: 'var(--theme-primary-foreground)' } }, { type: 'Text', text: 'Add', props: { className: 'text-[14px] font-medium text-[var(--theme-primary-foreground)]' } }] } },
  ],
  Form: [
    {
      type: 'FormContainer',
      label: 'Form',
      icon: '⊞',
      aiStrip: 'all',
      defaultNode: {
        type: 'FormContainer',
        props: { className: 'flex flex-col gap-[16px] w-full', initialFormData: {} },
        children: [
          {
            type: 'Input',
            props: { variant: 'outline', size: 'md', className: 'w-full !rounded-[6px] !border-gray-200 !bg-white dark:!border-gray-700 dark:!bg-gray-900', placeholder: 'Email', name: 'email' },
          },
          {
            type: 'Input',
            props: { variant: 'outline', size: 'md', className: 'w-full !rounded-[6px] !border-gray-200 !bg-white dark:!border-gray-700 dark:!bg-gray-900', placeholder: 'Password', name: 'password', type: 'password' },
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-center w-full px-[16px] py-[10px] rounded-[6px] bg-[var(--theme-foreground)] hover:opacity-90 cursor-pointer' },
            children: [{ type: 'Text', text: 'Submit', props: { className: 'text-[14px] font-medium text-[var(--theme-background)]' } }],
            actions: { click: { type: 'submitForm' } },
          },
        ],
      },
    },
    { type: 'Input',    label: 'Input',        icon: '▭',
      defaultNode: { type: 'Input', props: { variant: 'outline', size: 'md', className: 'w-full !rounded-[6px] !border-border !bg-background', placeholder: 'Enter text…' } } },
    { type: 'Box',    label: 'Input Search', icon: '🔍',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center gap-[8px] px-[12px] rounded-[6px] border border-border bg-background' }, children: [{ type: 'Icon', props: { icon: 'lucide:search', size: 16, color: '#9ca3af' } }, { type: 'Input', props: { variant: 'unstyled', size: 'md', className: 'flex-1 !border-none !bg-transparent', placeholder: 'Search…' } }] } },
    { type: 'Textarea', label: 'Textarea',     icon: '≡',
      defaultNode: { type: 'Textarea', props: { className: 'w-full !rounded-[6px] !border-border !bg-background' }, children: [{ type: 'TextareaInput', props: { placeholder: 'Enter text…', className: '!text-foreground' } }] } },
    { type: 'Select',   label: 'Select',       icon: '▽',
      defaultNode: { type: 'Select', props: {}, children: [{ type: 'SelectTrigger', props: { className: 'flex flex-row items-center justify-between px-[12px] py-[8px] rounded-[6px] border border-border bg-background' }, children: [{ type: 'SelectInput', props: { placeholder: 'Select option…', className: '!text-foreground' } }, { type: 'Icon', props: { icon: 'lucide:chevron-down', size: 16, color: '#6b7280' } }] }, { type: 'SelectPortal', children: [{ type: 'SelectBackdrop' }, { type: 'SelectContent', children: [{ type: 'SelectItem', props: { label: 'Option 1', value: 'option1' } }, { type: 'SelectItem', props: { label: 'Option 2', value: 'option2' } }] }] }] } },
    { type: 'Slider',   label: 'Slider',       icon: '⊸',
      defaultNode: { type: 'Slider', props: { defaultValue: 50, minValue: 0, maxValue: 100, className: 'w-full' }, children: [{ type: 'SliderTrack', children: [{ type: 'SliderFilledTrack' }] }, { type: 'SliderThumb' }] } },
    { type: 'RadioGroup', label: 'Radio',      icon: '◎',
      defaultNode: { type: 'RadioGroup', props: { className: 'flex flex-col gap-[12px]' }, children: [{ type: 'Radio', props: { value: 'option' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option' }] }] } },
    { type: 'RadioGroup', label: 'Radio Group', icon: '⊙',
      defaultNode: { type: 'RadioGroup', props: { className: 'flex flex-col gap-[12px]' }, children: [{ type: 'Radio', props: { value: 'a' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option A' }] }, { type: 'Radio', props: { value: 'b' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option B' }] }] } },
    { type: 'Progress', label: 'Progress',     icon: '▬',
      defaultNode: { type: 'Progress', props: { value: 60, className: 'w-full h-[8px] rounded-[9999px] bg-muted' }, children: [{ type: 'ProgressFilledTrack', props: { className: 'h-full rounded-[9999px] bg-primary' } }] } },
    {
      type: 'Box',
      label: 'Toggle',
      icon: '⏻',
      defaultNode: {
        type: 'Box',
        props: { className: 'relative w-[48px] h-[24px] rounded-[9999px] bg-gray-300 justify-center px-[2px]' },
        children: [{ type: 'Box', props: { className: 'w-[20px] h-[20px] rounded-[9999px] bg-white shadow-sm' } }],
      },
    },
    { type: 'Checkbox', label: 'Checkbox',     icon: '☑',
      defaultNode: { type: 'Checkbox', props: { defaultIsChecked: false }, children: [{ type: 'CheckboxIndicator' }, { type: 'CheckboxLabel', text: 'Label' }] } },
    { type: 'CheckboxGroup', label: 'Checkbox Group', icon: '☑☑',
      defaultNode: { type: 'CheckboxGroup', props: { className: 'flex flex-col gap-[12px]' }, children: [{ type: 'Checkbox', props: { value: 'a' }, children: [{ type: 'CheckboxIndicator' }, { type: 'CheckboxLabel', text: 'Option A' }] }, { type: 'Checkbox', props: { value: 'b' }, children: [{ type: 'CheckboxIndicator' }, { type: 'CheckboxLabel', text: 'Option B' }] }] } },
    {
      type: 'Box',
      label: 'Switch',
      icon: '⏵',
      defaultNode: {
        type: 'Box',
        props: { className: 'relative w-[48px] h-[24px] rounded-[9999px] bg-gray-300 justify-center' },
        children: [{ type: 'Box', props: { className: 'absolute left-[2px] top-[2px] w-[20px] h-[20px] rounded-[9999px] bg-white shadow-sm' } }],
      },
    },
    {
      type: 'Box',
      label: 'Switch On',
      icon: '⏸',
      defaultNode: {
        type: 'Box',
        props: { className: 'relative w-[48px] h-[24px] rounded-[9999px] bg-primary justify-center' },
        children: [{ type: 'Box', props: { className: 'absolute right-[2px] top-[2px] w-[20px] h-[20px] rounded-[9999px] bg-white shadow-sm' } }],
      },
    },
  ],
  Composite: [
    {
      type: 'Box',
      label: 'Chip',
      icon: '⬡',
      defaultNode: {
        type: 'Box',
        props: { className: 'self-start flex flex-row items-center gap-[4px] px-[12px] py-[4px] rounded-[9999px] bg-secondary' },
        children: [
          { type: 'Text', props: { className: 'text-[14px] font-medium text-secondary-foreground' }, text: 'Label' },
          { type: 'Icon', props: { icon: 'lucide:x', size: 12, color: 'primary' } },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Tag',
      icon: '🏷',
      defaultNode: {
        type: 'Box',
        props: { className: 'self-start flex flex-row items-center px-[12px] py-[4px] rounded-[9999px] bg-muted' },
        children: [{ type: 'Text', props: { className: 'text-[12px] font-medium text-foreground' }, text: 'Tag' }],
      },
    },
    {
      type: 'Box',
      label: 'Tabs',
      icon: '⬜',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-col w-full gap-0' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row border-b border-border' },
            children: [
              { type: 'Box', props: { className: 'px-[16px] py-[8px] border-b-[2px] border-primary' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-primary' }, text: 'Tab 1' }] },
              { type: 'Box', props: { className: 'px-[16px] py-[8px] border-b-[2px] border-transparent' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-muted-foreground' }, text: 'Tab 2' }] },
              { type: 'Box', props: { className: 'px-[16px] py-[8px] border-b-[2px] border-transparent' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-muted-foreground' }, text: 'Tab 3' }] },
            ],
          },
          { type: 'Box', props: { className: 'p-[16px] w-full' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Tab 1 content goes here.' }] },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Stepper',
      icon: '①',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center w-full' },
        children: [
          { type: 'Box', props: { className: 'flex flex-col items-center gap-[4px]' }, children: [{ type: 'Box', props: { className: 'w-[32px] h-[32px] rounded-[9999px] bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-bold text-primary-foreground' }, text: '1' }] }, { type: 'Text', props: { className: 'text-[12px] text-primary' }, text: 'Step 1' }] },
          { type: 'Box', props: { className: 'flex-1 h-px bg-primary mx-[8px]' } },
          { type: 'Box', props: { className: 'flex flex-col items-center gap-[4px]' }, children: [{ type: 'Box', props: { className: 'w-[32px] h-[32px] rounded-[9999px] bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-bold text-primary-foreground' }, text: '2' }] }, { type: 'Text', props: { className: 'text-[12px] text-primary' }, text: 'Step 2' }] },
          { type: 'Box', props: { className: 'flex-1 h-px bg-border mx-[8px]' } },
          { type: 'Box', props: { className: 'flex flex-col items-center gap-[4px]' }, children: [{ type: 'Box', props: { className: 'w-[32px] h-[32px] rounded-[9999px] border-[2px] border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-bold text-muted-foreground' }, text: '3' }] }, { type: 'Text', props: { className: 'text-[12px] text-muted-foreground' }, text: 'Step 3' }] },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Pagination',
      icon: '⟨⟩',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row gap-[4px] items-center' },
        children: [
          { type: 'Box', props: { className: 'w-[32px] h-[32px] rounded-[6px] border border-border flex items-center justify-center' }, children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 14, color: '#6b7280' } }] },
          { type: 'Box', props: { className: 'w-[32px] h-[32px] rounded-[6px] bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-primary-foreground' }, text: '1' }] },
          { type: 'Box', props: { className: 'w-[32px] h-[32px] rounded-[6px] border border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-foreground' }, text: '2' }] },
          { type: 'Box', props: { className: 'w-[32px] h-[32px] rounded-[6px] border border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-foreground' }, text: '3' }] },
          { type: 'Box', props: { className: 'w-[32px] h-[32px] rounded-[6px] border border-border flex items-center justify-center' }, children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 14, color: '#6b7280' } }] },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Star Rating',
      icon: '★',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row gap-[4px] items-center' },
        children: [
          { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: '#f59e0b' } },
          { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: '#f59e0b' } },
          { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: '#f59e0b' } },
          { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: '#f59e0b' } },
          { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: '#d1d5db' } },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Breadcrumbs',
      icon: '›',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-[4px]' },
        children: [
          { type: 'Text', props: { className: 'text-[14px] text-primary' }, text: 'Home' },
          { type: 'Icon', props: { icon: 'lucide:chevron-right', size: 14, color: '#9ca3af' } },
          { type: 'Text', props: { className: 'text-[14px] text-primary' }, text: 'Category' },
          { type: 'Icon', props: { icon: 'lucide:chevron-right', size: 14, color: '#9ca3af' } },
          { type: 'Text', props: { className: 'text-[14px] text-foreground font-medium' }, text: 'Page' },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Accordion',
      icon: '▾',
      defaultNode: {
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
    },
    {
      type: 'Box',
      label: 'Table',
      icon: '⊞',
      defaultNode: {
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
    },
    {
      type: 'Box',
      label: 'Autocomplete',
      icon: '⌕',
      defaultNode: {
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
    },
    {
      type: 'Box',
      label: 'Snackbar',
      icon: '🔔',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center justify-between gap-[12px] px-[16px] py-[12px] rounded-[8px] bg-gray-900 shadow-lg w-full max-w-[384px]' },
        children: [
          { type: 'Icon', props: { icon: 'lucide:check-circle', size: 18, color: '#4ade80' } },
          { type: 'Text', props: { className: 'flex-1 text-[14px] font-medium text-white' }, text: 'Action completed successfully.' },
          { type: 'Box', props: { className: 'ml-[8px]' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 16, color: '#9ca3af' } }] },
        ],
      },
    },
  ],
  Media: [
    { type: 'Image',       label: 'Image',        icon: '🖼',
      defaultNode: { type: 'Image', props: { style: { width: '300px', height: '192px' } }, src: 'https://placehold.co/600x400' } },
    { type: 'Icon', label: 'Icon',          icon: '◈',
      defaultNode: { type: 'Icon', props: { icon: 'heroicons:star', size: 24, color: 'primary' } } },
    { type: 'Box',   label: 'Icon Tap',      icon: '⊙',
      defaultNode: { type: 'Box', props: { className: 'flex items-center justify-center w-[40px] h-[40px] rounded-[9999px] bg-secondary' }, children: [{ type: 'Icon', props: { icon: 'heroicons:star', size: 18, color: 'currentColor' } }] } },
    { type: 'Video',       label: 'Video',         icon: '▶',
      defaultNode: { type: 'Video', props: { controls: false, muted: true, loop: true, autoPlay: true, style: { width: '400px', height: '240px' } }, src: '' } },
  ],
  'Data & Media': [
    { type: 'DatePicker',     label: 'Date Picker',  icon: '📅',
      defaultNode: { type: 'DatePicker',     props: { label: 'Date', style: { width: '220px' } } } },
    { type: 'TimePicker',     label: 'Time Picker',  icon: '⏱',
      defaultNode: { type: 'TimePicker',     props: { label: 'Time', style: { width: '220px' } } } },
    { type: 'DateTimePicker', label: 'Date & Time',  icon: '📆',
      defaultNode: { type: 'DateTimePicker', props: { label: 'Date & Time', style: { width: '260px' } } } },
    { type: 'ColorPicker',    label: 'Color Picker', icon: '🎨',
      defaultNode: { type: 'ColorPicker',    props: { label: 'Color', value: '#6366f1', style: { width: '220px' } } } },
    { type: 'FileUpload',     label: 'File Upload',  icon: '📎',
      defaultNode: { type: 'FileUpload',     props: { label: 'Click or drag to upload', style: { width: '280px', minHeight: '120px' } } } },
    { type: 'Iframe',         label: 'Iframe',       icon: '⬜',
      defaultNode: { type: 'Iframe',         props: { title: 'Embedded', style: { width: '400px', height: '240px' } } } },
    { type: 'SvgViewer',      label: 'SVG Viewer',   icon: '⬡',
      defaultNode: { type: 'SvgViewer',      props: { style: { width: '120px', height: '120px' } } } },
    { type: 'JsonViewer',     label: 'JSON Viewer',  icon: '{}',
      defaultNode: { type: 'JsonViewer',     props: { data: { name: 'Alice', age: 30, active: true }, style: { width: '320px' } } } },
    { type: 'Chart',          label: 'Chart',        icon: '📊',
      defaultNode: { type: 'Chart',          props: { chartType: 'bar', style: { width: '340px', height: '260px' } } } },
    { type: 'QRCodeWidget',   label: 'QR Code',      icon: '▦',
      defaultNode: { type: 'QRCodeWidget',   props: { value: 'https://example.com', size: 160 } } },
    { type: 'MarkdownViewer', label: 'Markdown',     icon: 'M',
      defaultNode: { type: 'MarkdownViewer', props: { style: { width: '360px' } } } },
    { type: 'GoogleMap',      label: 'Google Map',   icon: '🗺',
      defaultNode: { type: 'GoogleMap',      props: { lat: 37.7749, lng: -122.4194, zoom: 13, style: { width: '400px', height: '280px' } } } },
    { type: 'GoogleMapPlaces', label: 'Places Search', icon: '📍',
      defaultNode: { type: 'GoogleMapPlaces', props: { placeholder: 'Search for a place…', style: { width: '320px' } } } },
  ],
  Display: [
    {
      type: 'Box',
      label: 'Badge',
      icon: '🏷',
      defaultNode: { type: 'Box', props: { className: 'w-fit inline-flex flex-row items-center px-[10px] py-[2px] rounded-[9999px] bg-[var(--theme-primary)]' }, children: [{ type: 'Text', props: { className: 'text-[12px] font-medium text-white' }, text: 'Badge' }] },
    },
    {
      type: 'Box',
      label: 'Avatar',
      icon: '👤',
      defaultNode: { type: 'Box', props: { className: 'w-[48px] h-[48px] rounded-[9999px] bg-gray-200 flex items-center justify-center overflow-hidden' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-gray-600' }, text: 'AB' }] },
    },
    { type: 'Spinner',  label: 'Spinner',  icon: '↺',
      defaultNode: { type: 'Spinner', props: { size: 'small', color: '#6b7280' } } },
    { type: 'Skeleton', label: 'Skeleton', icon: '░',
      defaultNode: { type: 'Skeleton', props: { className: 'rounded-[6px] w-full' }, children: [{ type: 'SkeletonText', props: { _lines: 3, className: 'w-full' } }] } },
    {
      type: 'Box',
      label: 'Alert',
      icon: '⚠',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-start gap-[12px] p-[16px] rounded-[6px] bg-amber-50 border border-amber-200' }, children: [{ type: 'Icon', props: { icon: 'lucide:alert-circle', size: 18, color: '#d97706' } }, { type: 'Text', text: 'This is an alert message.', props: { className: 'text-[14px] text-amber-800' } }] },
    },
  ],
  Overlays: [
    {
      type: 'Modal',
      label: 'Modal',
      icon: '⬜',
      defaultNode: {
        type: 'Modal',
        props: { isOpen: true, className: '' },
        children: [
          { type: 'ModalBackdrop', props: {} },
          {
            type: 'ModalContent',
            props: { className: 'rounded-[8px] bg-background p-0 w-full max-w-[448px]' },
            children: [
              { type: 'ModalHeader', props: { className: 'p-[16px] border-b border-border flex flex-row items-center justify-between' }, children: [{ type: 'Text', props: { className: 'text-[18px] font-semibold text-foreground' }, text: 'Modal Title' }, { type: 'ModalCloseButton', props: {} }] },
              { type: 'ModalBody', props: { className: 'p-[16px]' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Modal body content goes here.' }] },
              { type: 'ModalFooter', props: { className: 'p-[16px] border-t border-border flex flex-row gap-[8px] justify-end' }, children: [{ type: 'Box', props: { className: 'px-[16px] py-[8px] rounded-[6px] border border-border' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Cancel' }] }, { type: 'Box', props: { className: 'px-[16px] py-[8px] rounded-[6px] bg-primary' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-primary-foreground' }, text: 'Confirm' }] }] },
            ],
          },
        ],
      },
    },
    {
      type: 'Tooltip',
      label: 'Tooltip',
      icon: '💬',
      defaultNode: {
        type: 'Tooltip',
        props: { isOpen: true, placement: 'top' },
        children: [
          { type: 'Box', props: { className: 'px-[16px] py-[8px] rounded-[6px] bg-primary' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-primary-foreground' }, text: 'Hover me' }] },
          { type: 'TooltipContent', props: { className: 'bg-gray-900 rounded-[4px] px-[8px] py-[4px]' }, children: [{ type: 'TooltipText', props: { className: 'text-[12px] text-white' }, text: 'Tooltip text' }] },
        ],
      },
    },
    {
      type: 'AlertDialog',
      label: 'Alert Dialog',
      icon: '⚠',
      defaultNode: {
        type: 'AlertDialog',
        props: { isOpen: true },
        children: [
          { type: 'AlertDialogBackdrop', props: {} },
          {
            type: 'AlertDialogContent',
            props: { className: 'rounded-[8px] bg-background w-full max-w-[384px] p-0' },
            children: [
              { type: 'AlertDialogHeader', props: { className: 'p-[16px] border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-[18px] font-semibold text-foreground' }, text: 'Confirm Action' }] },
              { type: 'AlertDialogBody', props: { className: 'p-[16px]' }, children: [{ type: 'Text', props: { className: 'text-[14px] text-foreground' }, text: 'Are you sure you want to continue?' }] },
              { type: 'AlertDialogFooter', props: { className: 'p-[16px] border-t border-border flex flex-row gap-[8px] justify-end' }, children: [{ type: 'Box', props: { className: 'px-[16px] py-[8px] rounded-[6px] border border-border' }, children: [{ type: 'Text', props: { className: 'text-[14px]' }, text: 'Cancel' }] }, { type: 'Box', props: { className: 'px-[16px] py-[8px] rounded-[6px] bg-destructive' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-white' }, text: 'Delete' }] }] },
            ],
          },
        ],
      },
    },
  ],
};

/** Flat list of all primitive components across all sections */
export const ALL_PRIMITIVES: PrimitiveComponent[] = Object.values(PRIMITIVE_COMPONENTS).flat();
