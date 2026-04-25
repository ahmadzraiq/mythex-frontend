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
  /** AI-facing template. Minimal shell — what `add_component(label)` inserts. */
  defaultNode: object;
  /**
   * Palette-only richer default used by drag-and-drop in the builder.
   * The AI never sees this — `sdui-component-schema.ts` keeps reading `defaultNode`.
   * Use this to pre-populate structure (e.g. Form with email/password inputs + submit)
   * or layout tokens (e.g. empty Box with `flex flex-col p-[16px] gap-[16px]`) that
   * improve the drag-drop UX but would clutter the AI's tool output.
   */
  builderDefaultNode?: object;
  /**
   * Controls how the AI template is stripped before being handed to the AI:
   *   'placeholder' — remove only sample Heading/Text children (e.g. Card's "Card Title")
   *   'all'         — remove ALL defaultNode children (e.g. Form's preset email+password+submit)
   *   undefined     — keep children as-is
   */
  aiStrip?: 'all' | 'placeholder';
  /**
   * If set, dragging this palette entry creates a *linked instance* of the
   * system component with this id (from `lib/builder/system-components/`),
   * stamping `_system: { id, name }` + `_overrides: []` onto the cloned content.
   * `defaultNode` still ships a minimal snapshot so the AI schema export stays
   * sensible (AI-generated JSON simply doesn't carry `_system`).
   */
  systemComponentId?: string;
}

export const PRIMITIVE_COMPONENTS: Record<string, PrimitiveComponent[]> = {
  Layout: [
    { type: 'Box',  label: 'Box',        icon: '□',
      defaultNode: { type: 'Box', props: {} },
      builderDefaultNode: { type: 'Box', props: { className: 'flex flex-col p-[16px] gap-[16px] w-full' } } },
    { type: 'Box',  label: 'Row',        icon: '⬌',
      defaultNode: { type: 'Box', props: {} },
      builderDefaultNode: { type: 'Box', props: { className: 'flex flex-row gap-[16px] p-[16px] w-full items-center' } } },
    { type: 'Box',  label: 'Grid',        icon: '⊞',
      defaultNode: { type: 'Box', props: {} },
      builderDefaultNode: { type: 'Box', props: { className: 'grid grid-cols-2 gap-[16px] w-full' } } },
    { type: 'Box',  label: 'Card',       icon: '▣', aiStrip: 'placeholder',
      defaultNode: { type: 'Box', props: { className: 'rounded-[8px] border border-border bg-[var(--theme-card)] p-[16px] flex flex-col gap-[8px]' }, children: [{ type: 'Text', text: 'Card Title', props: { className: 'text-[18px] font-semibold text-foreground' } }, { type: 'Text', text: 'Card content goes here.', props: { className: 'text-[14px] text-muted-foreground' } }] } },
    { type: 'Box',  label: 'Divider',    icon: '—',
      defaultNode: { type: 'Box', props: { className: 'w-full h-px bg-border' } } },
    { type: 'Box',  label: 'ScrollView', icon: '↕',
      defaultNode: { type: 'Box', props: { style: { maxHeight: '200px' } }, children: [{ type: 'Text', text: 'Scroll content here', props: { className: 'text-[14px] text-foreground' } }] },
      builderDefaultNode: { type: 'Box', props: { className: 'flex flex-col gap-[16px] overflow-auto w-full', style: { maxHeight: '200px' } }, children: [{ type: 'Text', text: 'Scroll content here', props: { className: 'text-[14px] text-foreground' } }] } },
  ],
  Typography: [
    { type: 'Text', label: 'Text',    icon: 'T',
      defaultNode: { type: 'Text', text: 'Text block', props: { className: 'text-[16px] text-foreground' } } },
    { type: 'Text', label: 'Heading', icon: 'H',
      defaultNode: { type: 'Text', text: 'Heading', props: { className: 'text-[32px] font-bold text-foreground' } } },
    { type: 'Text', label: 'Label',   icon: 'L',
      defaultNode: { type: 'Text', text: 'Label', props: { className: 'text-[14px] font-medium text-foreground' } } },
    { type: 'Text', label: 'Caption', icon: 'C',
      defaultNode: { type: 'Text', text: 'Caption', props: { className: 'text-[12px] text-muted-foreground' } } },
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
      defaultNode: {
        type: 'FormContainer',
        props: { className: 'flex flex-col gap-[16px] w-full', initialFormData: {} },
      },
      builderDefaultNode: {
        type: 'FormContainer',
        props: { className: 'flex flex-col gap-[16px] w-full', initialFormData: { email: '', password: '' } },
        children: [
          {
            type: 'Input',
            props: { variant: 'outline', size: 'md', className: 'w-full !rounded-[6px] !border-border !bg-background', placeholder: 'Email', name: 'email' },
          },
          {
            type: 'Input',
            props: { variant: 'outline', size: 'md', className: 'w-full !rounded-[6px] !border-border !bg-background', placeholder: 'Password', name: 'password', type: 'password' },
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-center w-full px-[16px] py-[10px] rounded-[6px] bg-[var(--theme-primary)] hover:opacity-90 cursor-pointer' },
            children: [{ type: 'Text', text: 'Submit', props: { className: 'text-[14px] font-medium text-[var(--theme-primary-foreground)]' } }],
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
    { type: 'Switch', label: 'Switch', icon: '⏵',
      defaultNode: { type: 'Switch', props: { defaultIsChecked: false, size: 'md' } } },
    { type: 'Box', label: 'DatePicker', icon: '📅',
      systemComponentId: 'sys-datepicker',
      defaultNode: { type: 'Box', props: { className: 'flex flex-col gap-[8px] p-[12px] rounded-[8px] border border-border bg-background' }, children: [{ type: 'Text', props: { className: 'text-[12px] font-medium text-foreground' }, text: 'DatePicker' }] } },
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
      systemComponentId: 'sys-accordion',
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
      systemComponentId: 'sys-table',
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
      systemComponentId: 'sys-autocomplete',
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
      systemComponentId: 'sys-snackbar',
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
    { type: 'Image', label: 'Image', icon: '🖼',
      defaultNode: { type: 'Image', props: { className: 'w-full h-full' }, src: 'https://placehold.co/600x400' } },
    { type: 'Icon', label: 'Icon', icon: '◈',
      defaultNode: { type: 'Icon', props: { icon: 'heroicons:star', size: 24, color: 'primary' } } },
    { type: 'Box', label: 'Icon Tap', icon: '⊙',
      defaultNode: { type: 'Box', props: { className: 'flex items-center justify-center w-[40px] h-[40px] rounded-[9999px] bg-secondary' }, children: [{ type: 'Icon', props: { icon: 'heroicons:star', size: 18, color: 'currentColor' } }] } },
    { type: 'Video', label: 'Video', icon: '▶',
      defaultNode: { type: 'Video', props: { controls: false, muted: true, loop: true, autoPlay: true, className: 'w-full h-full' }, src: '' } },
  ],
  'Data & Media': [
    { type: 'FileUpload',     label: 'File Upload',  icon: '📎',
      defaultNode: { type: 'FileUpload',     props: { label: 'Click or drag to upload', style: { width: '280px', minHeight: '120px' } } } },
    { type: 'Iframe',         label: 'Iframe',       icon: '⬜',
      defaultNode: { type: 'Iframe',         props: { title: 'Embedded', style: { width: '400px', height: '240px' } } } },
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
      systemComponentId: 'sys-badge',
      defaultNode: { type: 'Box', props: { className: 'w-fit inline-flex flex-row items-center px-[10px] py-[2px] rounded-[9999px] bg-[var(--theme-primary)]' }, children: [{ type: 'Text', props: { className: 'text-[12px] font-medium text-white' }, text: 'Badge' }] },
    },
    {
      type: 'Box',
      label: 'Avatar',
      icon: '👤',
      systemComponentId: 'sys-avatar',
      defaultNode: { type: 'Box', props: { className: 'w-[48px] h-[48px] rounded-[9999px] bg-gray-200 flex items-center justify-center overflow-hidden' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-gray-600' }, text: 'AB' }] },
    },
    // Spinner replaced with animated Box + icon (no Gluestack dependency)
    {
      type: 'Box',
      label: 'Spinner',
      icon: '↺',
      defaultNode: {
        type: 'Box',
        props: {
          className: 'flex items-center justify-center',
          animation: { loop: { type: 'spin', duration: 1000, repeatCount: -1 } },
        },
        children: [{ type: 'Icon', props: { icon: 'lucide:loader-2', size: 24, color: '#6b7280' } }],
      },
    },
    { type: 'Skeleton', label: 'Skeleton', icon: '░',
      defaultNode: { type: 'Skeleton', props: { className: 'rounded-[6px] w-full' }, children: [{ type: 'SkeletonText', props: { _lines: 3, className: 'w-full' } }] } },
    {
      type: 'Box',
      label: 'Alert',
      icon: '⚠',
      systemComponentId: 'sys-alert',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-start gap-[12px] p-[16px] rounded-[6px] bg-amber-50 border border-amber-200' }, children: [{ type: 'Icon', props: { icon: 'lucide:alert-circle', size: 18, color: '#d97706' } }, { type: 'Text', text: 'This is an alert message.', props: { className: 'text-[14px] text-amber-800' } }] },
    },
  ],
  Overlays: [
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
      type: 'Box',
      label: 'Modal',
      icon: '🗔',
      systemComponentId: 'sys-modal',
      defaultNode: {
        type: 'Box',
        condition: '',
        props: { className: 'fixed inset-0 z-[50] flex items-center justify-center' },
        children: [
          { type: 'Box', props: { className: 'absolute inset-0 bg-black/50' } },
          {
            type: 'Box',
            props: { className: 'relative z-[1] w-[480px] max-w-[90vw] bg-white dark:bg-gray-900 rounded-[12px] p-[24px] flex flex-col gap-[16px]', animation: { enter: { type: 'zoomIn', duration: 200 } } },
            children: [
              { type: 'Box', props: { className: 'flex flex-row items-center justify-between' }, children: [
                { type: 'Text', props: { className: 'text-[18px] font-semibold text-gray-900 dark:text-white' }, text: 'Modal Title' },
                { type: 'Box', props: { className: 'cursor-pointer p-[4px]' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 18, color: '#6b7280' } }] },
              ] },
              { type: 'Text', props: { className: 'text-[14px] text-gray-600 dark:text-gray-300' }, text: 'Modal body content goes here.' },
              { type: 'Box', props: { className: 'flex flex-row justify-end gap-[8px] pt-[8px]' }, children: [
                { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-[16px] py-[8px] rounded-[6px] bg-gray-200 dark:bg-gray-700 hover:opacity-90 cursor-pointer' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-gray-800 dark:text-gray-200' }, text: 'Cancel' }] },
                { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-[16px] py-[8px] rounded-[6px] bg-[var(--theme-primary)] hover:opacity-90 cursor-pointer' }, children: [{ type: 'Text', props: { className: 'text-[14px] font-medium text-[var(--theme-primary-foreground)]' }, text: 'Confirm' }] },
              ] },
            ],
          },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Bottom Sheet',
      icon: '⬆',
      systemComponentId: 'sys-bottom-sheet',
      defaultNode: {
        type: 'Box',
        condition: '',
        props: { className: 'fixed inset-0 z-[50] flex items-end' },
        children: [
          { type: 'Box', props: { className: 'absolute inset-0 bg-black/50' } },
          {
            type: 'Box',
            props: { className: 'relative z-[1] w-full max-h-[70vh] bg-white dark:bg-gray-900 rounded-t-[16px] p-[24px] flex flex-col gap-[16px]', animation: { enter: { type: 'slideInUp', duration: 300 } } },
            children: [
              { type: 'Box', props: { className: 'flex justify-center' }, children: [
                { type: 'Box', props: { className: 'w-[40px] h-[4px] rounded-full bg-gray-300 dark:bg-gray-600' } },
              ] },
              { type: 'Text', props: { className: 'text-[18px] font-semibold text-gray-900 dark:text-white' }, text: 'Bottom Sheet' },
              { type: 'Text', props: { className: 'text-[14px] text-gray-600 dark:text-gray-300' }, text: 'Bottom sheet content goes here.' },
            ],
          },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Drawer',
      icon: '☰',
      systemComponentId: 'sys-drawer',
      defaultNode: {
        type: 'Box',
        condition: '',
        props: { className: 'fixed inset-0 z-[50] flex flex-row' },
        children: [
          {
            type: 'Box',
            props: { className: 'relative z-[1] w-[320px] h-full bg-white dark:bg-gray-900 p-[24px] flex flex-col gap-[16px]', animation: { enter: { type: 'slideInLeft', duration: 300 } } },
            children: [
              { type: 'Box', props: { className: 'flex flex-row items-center justify-between' }, children: [
                { type: 'Text', props: { className: 'text-[18px] font-semibold text-gray-900 dark:text-white' }, text: 'Drawer' },
                { type: 'Box', props: { className: 'cursor-pointer p-[4px]' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 18, color: '#6b7280' } }] },
              ] },
              { type: 'Text', props: { className: 'text-[14px] text-gray-600 dark:text-gray-300' }, text: 'Drawer content goes here.' },
            ],
          },
          { type: 'Box', props: { className: 'flex-1 bg-black/50' } },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Toast',
      icon: '🔔',
      systemComponentId: 'sys-toast',
      defaultNode: {
        type: 'Box',
        condition: '',
        props: { className: 'fixed top-[16px] right-[16px] z-[60] w-[360px] bg-white dark:bg-gray-900 rounded-[8px] p-[16px] border border-gray-200 dark:border-gray-700 flex flex-row items-start gap-[12px]', style: { boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)' }, animation: { enter: { type: 'slideInRight', duration: 200 } } },
        children: [
          { type: 'Icon', props: { icon: 'lucide:check-circle', size: 20, color: '#22c55e' } },
          { type: 'Box', props: { className: 'flex-1 flex flex-col gap-[2px]' }, children: [
            { type: 'Text', props: { className: 'text-[14px] font-semibold text-gray-900 dark:text-white' }, text: 'Success' },
            { type: 'Text', props: { className: 'text-[12px] text-gray-500 dark:text-gray-400' }, text: 'Your action was completed successfully.' },
          ] },
          { type: 'Box', props: { className: 'cursor-pointer p-[2px]' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 16, color: '#9ca3af' } }] },
        ],
      },
    },
  ],
};

/** Flat list of all primitive components across all sections */
export const ALL_PRIMITIVES: PrimitiveComponent[] = Object.values(PRIMITIVE_COMPONENTS).flat();
