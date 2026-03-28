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
  /** One-liner for the AI: default frame (from defaultNode), children (required vs sample), and how set_text / set_placeholder / set_prop apply. */
  aiRef?: string;
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
    { type: 'Box',    label: 'Box',        icon: '□', aiRef: 'Empty flex-col container. Default frame: padding + gap + w-full (see defaultNode in code — no min-height). Add any children freely. Use set_layout / set_display to customise direction and alignment.',
      defaultNode: { type: 'Box',    props: { className: 'flex flex-col p-4 gap-4 w-full' } } },
    { type: 'Box',    label: 'Row',        icon: '⬌', aiRef: 'Empty flex-row container. Default frame: gap + padding + w-full + vertically centered children. Add any children freely.',
      defaultNode: { type: 'Box',    props: { className: 'flex flex-row gap-4 p-4 w-full items-center' } } },
    { type: 'VStack', label: 'VStack',     icon: '⬇', aiRef: 'Empty vertical stack (Gluestack VStack). Default frame: gap + padding + w-full. Add any children freely.',
      defaultNode: { type: 'VStack', props: { className: 'flex flex-col gap-4 p-4 w-full' } } },
    { type: 'HStack', label: 'HStack',     icon: '➡', aiRef: 'Empty horizontal stack (Gluestack HStack). Default frame: gap + padding + w-full + vertically centered children. Add any children freely.',
      defaultNode: { type: 'HStack', props: { className: 'flex flex-row gap-4 p-4 w-full items-center' } } },
    { type: 'Center', label: 'Center',     icon: '⊕', aiRef: 'Empty centering container (items-center justify-center + padding + w-full). Add any children freely.',
      defaultNode: { type: 'Center', props: { className: 'flex flex-col items-center justify-center p-4 w-full' } } },
    { type: 'Grid',   label: 'Grid',       icon: '⊞', aiRef: 'Empty CSS grid container (grid-cols-2 by default). Add child boxes freely; use set_display(id, {gridCols: N}) to change column count.',
      defaultNode: { type: 'Grid', props: { className: 'grid grid-cols-2 gap-4 w-full' } } },
    { type: 'Box',    label: 'Card',       icon: '▣', aiStrip: 'placeholder', aiRef: 'Styled surface (Box with border, bg, rounded, padding). AI receives it EMPTY — no Heading or Text children. Add your own Heading, Text, Form, etc. as children.',
      defaultNode: { type: 'Box', props: { className: 'rounded-lg border border-border bg-[var(--theme-card)] p-4 w-full flex flex-col gap-2' }, children: [{ type: 'Heading', text: 'Card Title', props: { className: 'text-lg font-semibold' } }, { type: 'Text', text: 'Card content goes here.', props: { className: 'text-sm text-muted-foreground' } }] } },
    { type: 'Box',    label: 'Divider',    icon: '—', aiRef: 'Thin horizontal rule (1 px height, bg-border). No children needed.',
      defaultNode: { type: 'Box', props: { className: 'w-full h-px bg-border' } } },
    { type: 'Box',    label: 'ScrollView', icon: '↕', aiRef: 'Scrollable container with overflow-auto. Ships with a sample Text child — replace or remove it and add real content.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-col gap-4 overflow-auto w-full', style: { maxHeight: '200px' } }, children: [{ type: 'Text', text: 'Scroll content here', props: { className: 'text-sm text-foreground' } }] } },
  ],
  Typography: [
    { type: 'Text',    label: 'Text',    icon: 'T', aiRef: 'Leaf text node. Use set_text() to change the text. No children.',
      defaultNode: { type: 'Text',    text: 'Text block', props: { className: 'text-base text-foreground' } } },
    { type: 'Heading', label: 'Heading', icon: 'H', aiRef: 'Leaf heading node. Use set_text() to change the text. No children.',
      defaultNode: { type: 'Heading', text: 'Heading',    props: { className: 'text-2xl font-bold text-foreground' } } },
    { type: 'Text',    label: 'Label',   icon: 'L', aiRef: 'Small bold label text. Use set_text() to change. No children.',
      defaultNode: { type: 'Text',    text: 'Label',      props: { className: 'text-sm font-medium text-foreground' } } },
    { type: 'Text',    label: 'Caption', icon: 'C', aiRef: 'Extra-small muted caption. Use set_text() to change. No children.',
      defaultNode: { type: 'Text',    text: 'Caption',    props: { className: 'text-xs text-muted-foreground' } } },
    { type: 'Box',  label: 'Link',    icon: '🔗', aiRef: 'Inline text link. REQUIRED child: Text (holds the visible label). set_text(linkId) targets the Text child automatically. Use set_href(linkId) to set the URL (stored as props.href).',
      defaultNode: { type: 'Box', props: { href: '#' }, children: [{ type: 'Text', text: 'Link text', props: { className: 'text-sm text-primary underline cursor-pointer' } }] } },
  ],
  Buttons: [
    { type: 'Box', label: 'Btn Solid',       icon: '◼', aiRef: 'Solid filled button. REQUIRED child: Text (label). set_text(btnId) targets the Text child automatically. Use set_background / set_text_color to customise colors.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-[var(--theme-foreground)] hover:opacity-90 active:opacity-80' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-background)]' }, text: 'Button' }] } },
    { type: 'Box', label: 'Btn Destructive', icon: '⛔', aiRef: 'Red destructive button. REQUIRED child: Text (label). set_text(btnId) targets the Text child automatically.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-red-600 hover:bg-red-700 active:bg-red-800' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Delete' }] } },
    { type: 'Box', label: 'Btn Outline',     icon: '◻', aiRef: 'Outlined button. REQUIRED child: Text (label). set_text(btnId) targets the Text child automatically. Use set_border / set_text_color to customise colors.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md border border-[var(--theme-foreground)] hover:bg-[var(--theme-foreground)]/10' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-foreground)]' }, text: 'Button' }] } },
    { type: 'Box', label: 'Btn Ghost',       icon: '○', aiRef: 'Ghost/text-only button. REQUIRED child: Text (label). set_text(btnId) targets the Text child automatically.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md hover:bg-[var(--theme-foreground)]/10' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-foreground)]' }, text: 'Button' }] } },
    { type: 'Box', label: 'Btn + Icon L',    icon: '◀', aiRef: 'Button with icon on the left. Children: Icon (icon) + Text (label). set_text(btnId) targets Text. Use set_icon to change the icon.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-[var(--theme-foreground)] hover:opacity-90' }, children: [{ type: 'Icon', props: { icon: 'lucide:star', size: 16, color: 'var(--theme-background)' } }, { type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-background)]' }, text: 'Button' }] } },
    { type: 'Box', label: 'Btn + Icon R',    icon: '▶', aiRef: 'Button with icon on the right. Children: Text (label) + Icon (icon). set_text(btnId) targets Text.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-[var(--theme-foreground)] hover:opacity-90' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-background)]' }, text: 'Button' }, { type: 'Icon', props: { icon: 'lucide:arrow-right', size: 16, color: 'var(--theme-background)' } }] } },
    { type: 'Box', label: 'Icon Btn',        icon: '⬚', aiRef: 'Square icon-only button. Child: Icon. No text child. Use set_icon or set_prop(id, "props.icon", "IconName") to change the icon.',
      defaultNode: { type: 'Box', props: { className: 'flex items-center justify-center w-10 h-10 rounded-md bg-[var(--theme-foreground)] hover:opacity-90' }, children: [{ type: 'Icon', props: { icon: 'lucide:star', size: 18, color: 'var(--theme-background)' } }] } },
    { type: 'Box', label: 'Icon Btn Round',  icon: '◉', aiRef: 'Circular icon-only button. Child: Icon. No text child. Use set_icon or set_prop to change the icon.',
      defaultNode: { type: 'Box', props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-[var(--theme-foreground)] hover:opacity-90' }, children: [{ type: 'Icon', props: { icon: 'lucide:star', size: 18, color: 'var(--theme-background)' } }] } },
    { type: 'Box', label: 'Link Btn',        icon: '⇒', aiRef: 'Inline link-style button with arrow. Children: Text (label) + Icon (arrow). set_text targets Text.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center gap-1' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-foreground)] underline' }, text: 'Learn more' }, { type: 'Icon', props: { icon: 'lucide:arrow-right', size: 14, color: 'currentColor' } }] } },
    { type: 'Box', label: 'FAB',             icon: '⊕', aiRef: 'Floating action button (Box). Children: Icon + Text. set_text targets the Text child. Use set_icon to change the icon.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center justify-center gap-2 px-5 py-3 rounded-full bg-[var(--theme-foreground)] shadow-lg hover:opacity-90' }, children: [{ type: 'Icon', props: { icon: 'lucide:plus', size: 20, color: 'var(--theme-background)' } }, { type: 'Text', text: 'Add', props: { className: 'text-sm font-medium text-[var(--theme-background)]' } }] } },
  ],
  Form: [
    {
      type: 'FormContainer',
      label: 'Form',
      icon: '⊞',
      aiStrip: 'all',
      aiRef: 'Form wrapper. AI receives it EMPTY — no preset inputs. Add Input, Textarea, Select, and a Btn Solid (type=submit) as children. Each Input auto-injects the field; use set_placeholder(inputId, text) to set its placeholder.',
      defaultNode: {
        type: 'FormContainer',
        props: { className: 'flex flex-col gap-4 w-full', initialFormData: { email: '', password: '' } },
        children: [
          {
            type: 'Input',
            props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-gray-200 !bg-white dark:!border-gray-700 dark:!bg-gray-900', placeholder: 'Email', name: 'email' },
          },
          {
            type: 'Input',
            props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-gray-200 !bg-white dark:!border-gray-700 dark:!bg-gray-900', placeholder: 'Password', name: 'password', type: 'password' },
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-center w-full px-4 py-2.5 rounded-md bg-[var(--theme-foreground)] hover:opacity-90 cursor-pointer' },
            children: [{ type: 'Text', text: 'Submit', props: { className: 'text-sm font-medium text-[var(--theme-background)]' } }],
            actions: { click: { type: 'submitForm' } },
          },
        ],
      },
    },
    { type: 'Input',    label: 'Input',        icon: '▭', aiRef: 'Text input. Uses InputWithField — no children needed; props (placeholder, name, type, value, className) go directly on the Input node.',
      defaultNode: { type: 'Input', props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-border !bg-background', placeholder: 'Enter text…' } } },
    { type: 'Box',    label: 'Input Search', icon: '🔍', aiRef: 'Search field with icon. Structure: Box (flex-row) > Icon (search icon) + Input. set_placeholder targets Input. set_icon targets the Icon.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-center gap-2 px-3 rounded-md border border-border bg-background' }, children: [{ type: 'Icon', props: { icon: 'lucide:search', size: 16, color: '#9ca3af' } }, { type: 'Input', props: { variant: 'unstyled', size: 'md', className: 'flex-1 !border-none !bg-transparent', placeholder: 'Search…' } }] } },
    { type: 'Textarea', label: 'Textarea',     icon: '≡', aiRef: 'Multi-line text input. REQUIRED child: TextareaInput. set_placeholder(textareaId, text) patches TextareaInput automatically.',
      defaultNode: { type: 'Textarea', props: { className: 'w-full !rounded-md !border-border !bg-background' }, children: [{ type: 'TextareaInput', props: { placeholder: 'Enter text…', className: '!text-foreground' } }] } },
    { type: 'Select',   label: 'Select',       icon: '▽', aiRef: 'Dropdown select. Structure: Select > SelectTrigger (SelectInput + Icon) + SelectPortal (SelectBackdrop + SelectContent (SelectItem[])). Add/edit SelectItem children to set options.',
      defaultNode: { type: 'Select', props: {}, children: [{ type: 'SelectTrigger', props: { className: 'flex flex-row items-center justify-between px-3 py-2 rounded-md border border-border bg-background' }, children: [{ type: 'SelectInput', props: { placeholder: 'Select option…', className: '!text-foreground' } }, { type: 'Icon', props: { icon: 'lucide:chevron-down', size: 16, color: '#6b7280' } }] }, { type: 'SelectPortal', children: [{ type: 'SelectBackdrop' }, { type: 'SelectContent', children: [{ type: 'SelectItem', props: { label: 'Option 1', value: 'option1' } }, { type: 'SelectItem', props: { label: 'Option 2', value: 'option2' } }] }] }] } },
    { type: 'Slider',   label: 'Slider',       icon: '⊸', aiRef: 'Range slider. Internal structure: SliderTrack > SliderFilledTrack, plus SliderThumb. Set minValue/maxValue/defaultValue via set_prop on the Slider node.',
      defaultNode: { type: 'Slider', props: { defaultValue: 50, minValue: 0, maxValue: 100, className: 'w-full' }, children: [{ type: 'SliderTrack', children: [{ type: 'SliderFilledTrack' }] }, { type: 'SliderThumb' }] } },
    { type: 'RadioGroup', label: 'Radio',      icon: '◎', aiRef: 'Single radio button. Structure: RadioGroup > Radio > RadioIndicator + RadioLabel. set_text targets RadioLabel.',
      defaultNode: { type: 'RadioGroup', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Radio', props: { value: 'option' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option' }] }] } },
    { type: 'RadioGroup', label: 'Radio Group', icon: '⊙', aiRef: 'Group of radio buttons. Each Radio child has RadioIndicator + RadioLabel. set_text targets RadioLabel of each Radio.',
      defaultNode: { type: 'RadioGroup', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Radio', props: { value: 'a' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option A' }] }, { type: 'Radio', props: { value: 'b' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option B' }] }] } },
    { type: 'Progress', label: 'Progress',     icon: '▬', aiRef: 'Progress bar. Structure: Progress > ProgressFilledTrack. Set value (0-100) via set_prop on Progress. No text children needed.',
      defaultNode: { type: 'Progress', props: { value: 60, className: 'w-full h-2 rounded-full bg-muted' }, children: [{ type: 'ProgressFilledTrack', props: { className: 'h-full rounded-full bg-primary' } }] } },
    {
      type: 'Box',
      label: 'Toggle',
      icon: '⏻',
      aiRef: 'CSS toggle switch (off state). Child: Box (the thumb). Use set_condition to show/hide between Toggle and Switch On nodes based on a boolean variable.',
      defaultNode: {
        type: 'Box',
        props: { className: 'relative w-12 h-6 rounded-full bg-gray-300 justify-center px-0.5' },
        children: [{ type: 'Box', props: { className: 'w-5 h-5 rounded-full bg-white shadow-sm' } }],
      },
    },
    { type: 'Checkbox', label: 'Checkbox',     icon: '☑', aiRef: 'Single checkbox. Structure: Checkbox > CheckboxIndicator + CheckboxLabel (text). set_text targets CheckboxLabel.',
      defaultNode: { type: 'Checkbox', props: { defaultIsChecked: false }, children: [{ type: 'CheckboxIndicator' }, { type: 'CheckboxLabel', text: 'Label' }] } },
    { type: 'CheckboxGroup', label: 'Checkbox Group', icon: '☑☑', aiRef: 'Group of checkboxes. Each Checkbox child has CheckboxIndicator + CheckboxLabel. set_text targets CheckboxLabel of each Checkbox.',
      defaultNode: { type: 'CheckboxGroup', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Checkbox', props: { value: 'a' }, children: [{ type: 'CheckboxIndicator' }, { type: 'CheckboxLabel', text: 'Option A' }] }, { type: 'Checkbox', props: { value: 'b' }, children: [{ type: 'CheckboxIndicator' }, { type: 'CheckboxLabel', text: 'Option B' }] }] } },
    {
      type: 'Box',
      label: 'Switch',
      icon: '⏵',
      aiRef: 'CSS toggle switch (off state). Child: Box (thumb, positioned left). Pair with Switch On for the active state.',
      defaultNode: {
        type: 'Box',
        props: { className: 'relative w-12 h-6 rounded-full bg-gray-300 justify-center' },
        children: [{ type: 'Box', props: { className: 'absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm' } }],
      },
    },
    {
      type: 'Box',
      label: 'Switch On',
      icon: '⏸',
      aiRef: 'CSS toggle switch (on/active state, bg-primary). Child: Box (thumb, positioned right). Use with Switch for off state.',
      defaultNode: {
        type: 'Box',
        props: { className: 'relative w-12 h-6 rounded-full bg-primary justify-center' },
        children: [{ type: 'Box', props: { className: 'absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm' } }],
      },
    },
  ],
  Composite: [
    {
      type: 'Box',
      label: 'Chip',
      icon: '⬡',
      aiRef: 'Dismissible pill — use ONLY when the user can remove/close the chip (e.g. selected filter tags, active selections). Has a built-in X dismiss icon. Children: Text (label) + Icon (X). set_text targets Text. For status labels or badges with no dismiss, use Badge instead.',
      defaultNode: {
        type: 'Box',
        props: { className: 'self-start flex flex-row items-center gap-1 px-3 py-1 rounded-full bg-secondary' },
        children: [
          { type: 'Text', props: { className: 'text-sm font-medium text-secondary-foreground' }, text: 'Label' },
          { type: 'Icon', props: { icon: 'lucide:x', size: 12, color: 'var(--primary)' } },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Tag',
      icon: '🏷',
      aiRef: 'Pill-shaped non-interactive tag. Child: Text (label). set_text targets Text.',
      defaultNode: {
        type: 'Box',
        props: { className: 'self-start flex flex-row items-center px-3 py-1 rounded-full bg-muted' },
        children: [{ type: 'Text', props: { className: 'text-xs font-medium text-foreground' }, text: 'Tag' }],
      },
    },
    {
      type: 'Box',
      label: 'Tabs',
      icon: '⬜',
      aiRef: 'Tab strip with content panel. Structure: Box(row border-b) with Box tabs + Box(content panel). set_text targets the Text inside each tab Box. Add more Box children to the header row for extra tabs.',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-col w-full gap-0' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row border-b border-border' },
            children: [
              { type: 'Box', props: { className: 'px-4 py-2 border-b-2 border-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary' }, text: 'Tab 1' }] },
              { type: 'Box', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-muted-foreground' }, text: 'Tab 2' }] },
              { type: 'Box', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-muted-foreground' }, text: 'Tab 3' }] },
            ],
          },
          { type: 'Box', props: { className: 'p-4 w-full' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Tab 1 content goes here.' }] },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Stepper',
      icon: '①',
      aiRef: 'Step-progress indicator. Each step is a Box with a numbered circle + Text label. Connector lines are thin Box(h-px). set_text targets step labels.',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center w-full' },
        children: [
          { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-primary-foreground' }, text: '1' }] }, { type: 'Text', props: { className: 'text-xs text-primary' }, text: 'Step 1' }] },
          { type: 'Box', props: { className: 'flex-1 h-px bg-primary mx-2' } },
          { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-primary-foreground' }, text: '2' }] }, { type: 'Text', props: { className: 'text-xs text-primary' }, text: 'Step 2' }] },
          { type: 'Box', props: { className: 'flex-1 h-px bg-border mx-2' } },
          { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full border-2 border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-muted-foreground' }, text: '3' }] }, { type: 'Text', props: { className: 'text-xs text-muted-foreground' }, text: 'Step 3' }] },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Pagination',
      icon: '⟨⟩',
      aiRef: 'Page navigation row. Children: prev Box (ChevronLeft icon) + numbered Box(s) + next Box (ChevronRight icon). set_text targets page number Text children.',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row gap-1 items-center' },
        children: [
          { type: 'Box', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 14, color: '#6b7280' } }] },
          { type: 'Box', props: { className: 'w-8 h-8 rounded-md bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: '1' }] },
          { type: 'Box', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: '2' }] },
          { type: 'Box', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: '3' }] },
          { type: 'Box', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 14, color: '#6b7280' } }] },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Star Rating',
      icon: '★',
      aiRef: 'Five Icon stars. Filled stars use color #f59e0b; empty star uses #d1d5db. Change individual star colors via set_prop(starId, "props.color", "#hex").',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row gap-1 items-center' },
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
      aiRef: 'Breadcrumb trail. Alternates Text (crumb label) and Icon (ChevronRight separator). set_text targets each Text crumb.',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-1' },
        children: [
          { type: 'Text', props: { className: 'text-sm text-primary' }, text: 'Home' },
          { type: 'Icon', props: { icon: 'lucide:chevron-right', size: 14, color: '#9ca3af' } },
          { type: 'Text', props: { className: 'text-sm text-primary' }, text: 'Category' },
          { type: 'Icon', props: { icon: 'lucide:chevron-right', size: 14, color: '#9ca3af' } },
          { type: 'Text', props: { className: 'text-sm text-foreground font-medium' }, text: 'Page' },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Accordion',
      icon: '▾',
      aiRef: 'Collapsible section. Children: Box header (Text + ChevronDown icon) + Box body panel. set_text targets the section title Text. The body panel can contain any children.',
      defaultNode: {
        type: 'Box',
        props: { className: 'w-full border border-border rounded-md overflow-hidden' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between p-4 bg-background' },
            children: [
              { type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: 'Section Title' },
              { type: 'Icon', props: { icon: 'lucide:chevron-down', size: 16, color: '#6b7280' } },
            ],
          },
          { type: 'Box', props: { className: 'p-4 bg-muted border-t border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Accordion content goes here.' }] },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Table',
      icon: '⊞',
      aiRef: 'HTML-style table built from Box rows. First row (bg-muted) is the header; subsequent rows are data rows. Each row is a flex-row Box with flex-1 cell Boxes. set_text targets cell Text nodes.',
      defaultNode: {
        type: 'Box',
        props: { className: 'w-full overflow-hidden rounded-md border border-border' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row bg-muted' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-foreground uppercase' }, text: 'Name' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-foreground uppercase' }, text: 'Status' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-foreground uppercase' }, text: 'Amount' }] },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row border-t border-border' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Alice' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-green-600' }, text: 'Active' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: '$120' }] },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row border-t border-border' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Bob' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-yellow-600' }, text: 'Pending' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: '$85' }] },
            ],
          },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Autocomplete',
      icon: '⌕',
      aiRef: 'Search input with absolute dropdown. Children: Box (flex-row search field with Icon + Input) + absolute Box (the dropdown with Box options). set_placeholder targets Input. set_text targets option Text nodes.',
      defaultNode: {
        type: 'Box',
        props: { className: 'relative flex flex-col w-full' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center gap-2 px-3 rounded-md border border-border bg-background' },
            children: [
              { type: 'Icon', props: { icon: 'lucide:search', size: 16, color: '#9ca3af' } },
              { type: 'Input', props: { variant: 'unstyled', size: 'md', className: 'flex-1 !border-none !bg-transparent', placeholder: 'Search…' } },
            ],
          },
          {
            type: 'Box',
            props: { className: 'absolute top-full left-0 right-0 z-50 bg-background border border-border rounded-md shadow-md mt-1 overflow-hidden' },
            children: [
              { type: 'Box', props: { className: 'px-3 py-2 hover:bg-muted border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Option 1' }] },
              { type: 'Box', props: { className: 'px-3 py-2 hover:bg-muted border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Option 2' }] },
              { type: 'Box', props: { className: 'px-3 py-2 hover:bg-muted' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Option 3' }] },
            ],
          },
        ],
      },
    },
    {
      type: 'Box',
      label: 'Snackbar',
      icon: '🔔',
      aiRef: 'Toast/snackbar notification. Children: Icon (status icon) + Text (message) + Box (X dismiss). set_text targets the message Text. Use set_prop to change the icon color or icon name.',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center justify-between gap-3 px-4 py-3 rounded-lg bg-gray-900 shadow-lg w-full max-w-sm' },
        children: [
          { type: 'Icon', props: { icon: 'lucide:check-circle', size: 18, color: '#4ade80' } },
          { type: 'Text', props: { className: 'flex-1 text-sm font-medium text-white' }, text: 'Action completed successfully.' },
          { type: 'Box', props: { className: 'ml-2' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 16, color: '#9ca3af' } }] },
        ],
      },
    },
  ],
  Media: [
    { type: 'Image',       label: 'Image',        icon: '🖼', aiRef: 'Image element. ALWAYS add via add_image(src, alt, parentId) — never add_component("Image") (src is silently ignored). Change src later with set_src. set width/height via set_prop(id, "props.style", {width:"Xpx",height:"Ypx"}). No children.',
      defaultNode: { type: 'Image', props: { className: 'rounded-md', style: { width: '300px', height: '192px' } }, src: 'https://placehold.co/600x400' } },
    { type: 'Icon', label: 'Icon',          icon: '◈', aiRef: 'Iconify icon. Props: icon (Iconify string like "heroicons:star" or a URL), size (number), color (hex or CSS var). Use the Settings panel to pick from the icon library or enter a URL. No children.',
      defaultNode: { type: 'Icon', props: { icon: 'heroicons:star', size: 24, color: 'var(--primary)' } } },
    { type: 'Box',   label: 'Icon Tap',      icon: '⊙', aiRef: 'Circular tappable icon button. Child: Icon. Use set_prop or the Settings panel to change icon name/color. Attach actions for tap behaviour.',
      defaultNode: { type: 'Box', props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-secondary' }, children: [{ type: 'Icon', props: { icon: 'heroicons:star', size: 18, color: 'currentColor' } }] } },
    { type: 'Video',       label: 'Video',         icon: '▶', aiRef: 'Video player. Default: autoPlay=true, loop=true, muted=true, controls=false (ambient/background style). Call set_video_props to change these. Props: controls, muted, loop, autoPlay, poster (thumbnail URL), objectFit. No children.',
      defaultNode: { type: 'Video', props: { controls: false, muted: true, loop: true, autoPlay: true, style: { width: '400px', height: '240px' }, className: 'rounded-md' }, src: '' } },
  ],
  'Data & Media': [
    { type: 'DatePicker',     label: 'Date Picker',  icon: '📅', aiRef: 'Self-contained date picker widget. Set label via set_prop(id, "props.label", "text"). No children.',
      defaultNode: { type: 'DatePicker',     props: { label: 'Date', style: { width: '220px' } } } },
    { type: 'TimePicker',     label: 'Time Picker',  icon: '⏱', aiRef: 'Self-contained time picker widget. Set label via set_prop. No children.',
      defaultNode: { type: 'TimePicker',     props: { label: 'Time', style: { width: '220px' } } } },
    { type: 'DateTimePicker', label: 'Date & Time',  icon: '📆', aiRef: 'Combined date+time picker. Set label via set_prop. No children.',
      defaultNode: { type: 'DateTimePicker', props: { label: 'Date & Time', style: { width: '260px' } } } },
    { type: 'ColorPicker',    label: 'Color Picker', icon: '🎨', aiRef: 'Color picker with swatch. Set initial value via set_prop(id, "props.value", "#hex"). No children.',
      defaultNode: { type: 'ColorPicker',    props: { label: 'Color', value: '#6366f1', style: { width: '220px' } } } },
    { type: 'FileUpload',     label: 'File Upload',  icon: '📎', aiRef: 'Drag-and-drop file upload zone. Set label via set_prop(id, "props.label", "text"). No children.',
      defaultNode: { type: 'FileUpload',     props: { label: 'Click or drag to upload', style: { width: '280px', minHeight: '120px' } } } },
    { type: 'Iframe',         label: 'Iframe',       icon: '⬜', aiRef: 'Embedded iframe. Set src via set_prop(id, "props.src", "url"). Set title via set_prop(id, "props.title", "text"). No children.',
      defaultNode: { type: 'Iframe',         props: { title: 'Embedded', style: { width: '400px', height: '240px' } } } },
    { type: 'SvgViewer',      label: 'SVG Viewer',   icon: '⬡', aiRef: 'SVG rendering widget. Set svgContent via set_prop(id, "props.svgContent", "<svg.../>"). No children.',
      defaultNode: { type: 'SvgViewer',      props: { style: { width: '120px', height: '120px' } } } },
    { type: 'JsonViewer',     label: 'JSON Viewer',  icon: '{}', aiRef: 'Pretty-prints a JSON object. Set data via set_prop(id, "props.data", {...}). No children.',
      defaultNode: { type: 'JsonViewer',     props: { data: { name: 'Alice', age: 30, active: true }, style: { width: '320px' } } } },
    { type: 'Chart',          label: 'Chart',        icon: '📊', aiRef: 'Chart widget. Set chartType (bar/line/pie) and data via set_prop. No children.',
      defaultNode: { type: 'Chart',          props: { chartType: 'bar', style: { width: '340px', height: '260px' } } } },
    { type: 'QRCodeWidget',   label: 'QR Code',      icon: '▦', aiRef: 'QR code generator. Set value (URL or text) via set_prop(id, "props.value", "text"). No children.',
      defaultNode: { type: 'QRCodeWidget',   props: { value: 'https://example.com', size: 160 } } },
    { type: 'MarkdownViewer', label: 'Markdown',     icon: 'M', aiRef: 'Renders markdown. Set content via set_prop(id, "props.content", "## Heading\\n..."). No children.',
      defaultNode: { type: 'MarkdownViewer', props: { style: { width: '360px' } } } },
    { type: 'GoogleMap',      label: 'Google Map',   icon: '🗺', aiRef: 'Embedded Google Map. Set lat/lng/zoom via set_prop. No children.',
      defaultNode: { type: 'GoogleMap',      props: { lat: 37.7749, lng: -122.4194, zoom: 13, style: { width: '400px', height: '280px' } } } },
    { type: 'GoogleMapPlaces', label: 'Places Search', icon: '📍', aiRef: 'Google Places search input. Set placeholder via set_prop. No children.',
      defaultNode: { type: 'GoogleMapPlaces', props: { placeholder: 'Search for a place…', style: { width: '320px' } } } },
  ],
  Display: [
    {
      type: 'Box',
      label: 'Badge',
      icon: '🏷',
      aiRef: 'Status badge / version label (Box + Text). Use for "New", "Beta", "Now in beta", "Pro", "Sale", etc. set_text targets the Text child. No dismiss icon — use Chip for dismissible items. Ships with w-fit so it never stretches in column containers while still respecting the parent\'s alignment (center, start, etc).',
      defaultNode: { type: 'Box', props: { className: 'w-fit inline-flex flex-row items-center px-2.5 py-0.5 rounded-full bg-[var(--theme-primary)]' }, children: [{ type: 'Text', props: { className: 'text-xs font-medium text-white' }, text: 'Badge' }] },
    },
    {
      type: 'Box',
      label: 'Avatar',
      icon: '👤',
      aiRef: 'Circular avatar (Box with Image or initials Text). Use Image src for a photo, or Text for initials.',
      defaultNode: { type: 'Box', props: { className: 'w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-gray-600' }, text: 'AB' }] },
    },
    { type: 'Spinner',  label: 'Spinner',  icon: '↺', aiRef: 'Loading spinner. Props: size (small/large) and color. No children. Use set_prop to change size/color.',
      defaultNode: { type: 'Spinner', props: { size: 'small', color: '#6b7280' } } },
    { type: 'Skeleton', label: 'Skeleton', icon: '░', aiRef: 'Placeholder skeleton loader. Child: SkeletonText (_lines prop controls line count). Use set_prop to change _lines.',
      defaultNode: { type: 'Skeleton', props: { className: 'rounded-md w-full' }, children: [{ type: 'SkeletonText', props: { _lines: 3, className: 'w-full' } }] } },
    {
      type: 'Box',
      label: 'Alert',
      icon: '⚠',
      aiRef: 'Inline alert banner (Box + Icon + Text). set_text targets the Text child. Use set_prop to change icon name/color.',
      defaultNode: { type: 'Box', props: { className: 'flex flex-row items-start gap-3 p-4 rounded-md bg-amber-50 border border-amber-200' }, children: [{ type: 'Icon', props: { icon: 'lucide:alert-circle', size: 18, color: '#d97706' } }, { type: 'Text', text: 'This is an alert message.', props: { className: 'text-sm text-amber-800' } }] },
    },
  ],
  Overlays: [
    {
      type: 'Modal',
      label: 'Modal',
      icon: '⬜',
      aiRef: 'Dialog overlay. Structure: Modal > ModalBackdrop + ModalContent > ModalHeader (title + ModalCloseButton) + ModalBody (content) + ModalFooter (action buttons). set_text targets title/body Text. Add children to ModalBody for content.',
      defaultNode: {
        type: 'Modal',
        props: { isOpen: true, className: '' },
        children: [
          { type: 'ModalBackdrop', props: {} },
          {
            type: 'ModalContent',
            props: { className: 'rounded-lg bg-background p-0 w-full max-w-md' },
            children: [
              { type: 'ModalHeader', props: { className: 'p-4 border-b border-border flex flex-row items-center justify-between' }, children: [{ type: 'Text', props: { className: 'text-lg font-semibold text-foreground' }, text: 'Modal Title' }, { type: 'ModalCloseButton', props: {} }] },
              { type: 'ModalBody', props: { className: 'p-4' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Modal body content goes here.' }] },
              { type: 'ModalFooter', props: { className: 'p-4 border-t border-border flex flex-row gap-2 justify-end' }, children: [{ type: 'Box', props: { className: 'px-4 py-2 rounded-md border border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Cancel' }] }, { type: 'Box', props: { className: 'px-4 py-2 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Confirm' }] }] },
            ],
          },
        ],
      },
    },
    {
      type: 'Tooltip',
      label: 'Tooltip',
      icon: '💬',
      aiRef: 'Hover tooltip. Children: Box (trigger) + TooltipContent > TooltipText (tooltip body). set_text targets TooltipText for the tooltip message and the trigger Text child for the trigger label.',
      defaultNode: {
        type: 'Tooltip',
        props: { isOpen: true, placement: 'top' },
        children: [
          { type: 'Box', props: { className: 'px-4 py-2 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm text-primary-foreground' }, text: 'Hover me' }] },
          { type: 'TooltipContent', props: { className: 'bg-gray-900 rounded px-2 py-1' }, children: [{ type: 'TooltipText', props: { className: 'text-xs text-white' }, text: 'Tooltip text' }] },
        ],
      },
    },
    {
      type: 'AlertDialog',
      label: 'Alert Dialog',
      icon: '⚠',
      aiRef: 'Confirmation dialog. Structure: AlertDialog > AlertDialogBackdrop + AlertDialogContent > AlertDialogHeader (title) + AlertDialogBody (message) + AlertDialogFooter (Cancel + Confirm buttons). set_text targets title/body/button Text nodes.',
      defaultNode: {
        type: 'AlertDialog',
        props: { isOpen: true },
        children: [
          { type: 'AlertDialogBackdrop', props: {} },
          {
            type: 'AlertDialogContent',
            props: { className: 'rounded-lg bg-background w-full max-w-sm p-0' },
            children: [
              { type: 'AlertDialogHeader', props: { className: 'p-4 border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-lg font-semibold text-foreground' }, text: 'Confirm Action' }] },
              { type: 'AlertDialogBody', props: { className: 'p-4' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Are you sure you want to continue?' }] },
              { type: 'AlertDialogFooter', props: { className: 'p-4 border-t border-border flex flex-row gap-2 justify-end' }, children: [{ type: 'Box', props: { className: 'px-4 py-2 rounded-md border border-border' }, children: [{ type: 'Text', props: { className: 'text-sm' }, text: 'Cancel' }] }, { type: 'Box', props: { className: 'px-4 py-2 rounded-md bg-destructive' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Delete' }] }] },
            ],
          },
        ],
      },
    },
  ],
};

/** Flat list of all primitive components across all sections */
export const ALL_PRIMITIVES: PrimitiveComponent[] = Object.values(PRIMITIVE_COMPONENTS).flat();
