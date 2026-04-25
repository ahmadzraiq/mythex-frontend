/**
 * Component Showcase
 *
 * Pre-built pageNodes that demonstrate every palette component.
 *
 * Color strategy:
 *  - Section cards / text / borders → CSS variables (theme-aware, dark/light mode)
 *  - Demo accent boxes inside layouts → fixed bright colors (blue, purple, pink, etc.)
 *    so the showcase is visually rich regardless of the active theme palette.
 *  - Semantic indicators (success/error/warning/info badges) → fixed semantic colors.
 * Fonts are inherited via globals.css → var(--font-heading) / var(--font-body).
 */

import type { SDUINode } from '@/lib/sdui/types/node';

// ─── ID factory ──────────────────────────────────────────────────────────────

let _n = 0;
const uid = () => `sc-${String(++_n).padStart(3, '0')}`;

function ensureIds(node: SDUINode): SDUINode {
  return {
    ...node,
    id: node.id ?? uid(),
    children: node.children?.map(ensureIds),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function labeled(label: string, node: SDUINode): SDUINode {
  return {
    id: uid(),
    type: 'Box',
    props: { className: 'flex flex-col items-center gap-2 min-w-0' },
    children: [
      { ...node, id: uid() },
      {
        id: uid(),
        type: 'Text',
        props: { className: 'text-[10px] text-[rgb(var(--muted-foreground))] text-center whitespace-nowrap' },
        text: label,
      },
    ],
  };
}

function row(items: SDUINode[], mobileCols: 1 | 2 | 3 = 2): SDUINode {
  // Mobile → tablet → laptop column progression per density tier:
  //   1 (large items):  1 → 2 → 3   (wide cells at every breakpoint)
  //   2 (medium items): 2 → 3 → 3   (default)
  //   3 (small items):  3 → 4 → 5   (compact indicators)
  const colClass = mobileCols === 3
    ? 'grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
    : mobileCols === 2
      ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-3'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
  return {
    id: uid(),
    type: 'Box',
    props: { className: `grid ${colClass} gap-4 md:gap-6 items-start w-full` },
    children: items,
  };
}

/** Full-width section card using theme variables */
function section(title: string, examples: SDUINode[], mobileCols: 1 | 2 = 2): SDUINode {
  return {
    id: uid(),
    type: 'Box',
    props: { className: 'flex flex-col gap-4 p-4 md:p-6 bg-[rgb(var(--card))] rounded-xl border border-[rgb(var(--border))] shadow-sm w-full' },
    children: [
      {
        id: uid(),
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-3' },
        children: [
          {
            id: uid(),
            type: 'Box',
            props: { className: 'w-1 h-6 rounded-full bg-[rgb(var(--primary))]' },
          },
          {
            id: uid(),
            type: 'Text',
            props: { className: 'text-sm font-semibold text-[rgb(var(--foreground))] uppercase tracking-wider' },
            text: title,
          },
        ],
      },
      {
        id: uid(),
        type: 'Box',
        props: { className: 'w-full h-px bg-[rgb(var(--border))]' },
      },
      row(examples, mobileCols),
    ],
  };
}

// ─── Typography ──────────────────────────────────────────────────────────────

const typographySection = section('Typography', [
  labeled('Heading 1', { type: 'Text', props: { className: 'text-3xl font-bold text-[rgb(var(--foreground))]' }, text: 'Heading 1' }),
  labeled('Heading 2', { type: 'Text', props: { className: 'text-2xl font-bold text-[rgb(var(--foreground))]' }, text: 'Heading 2' }),
  labeled('Heading 3', { type: 'Text', props: { className: 'text-xl font-semibold text-[rgb(var(--foreground))]' }, text: 'Heading 3' }),
  labeled('Heading 4', { type: 'Text', props: { className: 'text-lg font-semibold text-[rgb(var(--foreground))]' }, text: 'Heading 4' }),
  labeled('Body Text', { type: 'Text', props: { className: 'text-base text-[rgb(var(--foreground))]' }, text: 'Body text — readable paragraph copy.' }),
  labeled('Small Text', { type: 'Text', props: { className: 'text-sm text-[rgb(var(--muted-foreground))]' }, text: 'Small text helper copy.' }),
  labeled('Caption', { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Caption / metadata' }),
  labeled('Bold', { type: 'Text', props: { className: 'text-sm font-bold text-[rgb(var(--foreground))]' }, text: 'Bold text' }),
  labeled('Muted', { type: 'Text', props: { className: 'text-sm text-[rgb(var(--muted-foreground))]' }, text: 'Muted text' }),
  labeled('Link', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-1' },
    children: [
      { type: 'Text', props: { className: 'text-sm text-[rgb(var(--primary))] underline' }, text: 'Clickable link' },
    ],
  }),
]);

// ─── Layout ──────────────────────────────────────────────────────────────────

const layoutSection = section('Layout', [
  labeled('Box (col)', {
    type: 'Box',
    props: { className: 'flex flex-col gap-2 p-3 border border-dashed border-[rgb(var(--border))] rounded-lg w-28 min-h-[80px]' },
    children: [
      { type: 'Box', props: { className: 'h-5 bg-blue-400 rounded w-full' } },
      { type: 'Box', props: { className: 'h-5 bg-indigo-400 rounded w-full' } },
      { type: 'Box', props: { className: 'h-5 bg-purple-400 rounded w-full' } },
    ],
  }),
  labeled('Box (row)', {
    type: 'Box',
    props: { className: 'flex flex-row gap-2 p-3 border border-dashed border-[rgb(var(--border))] rounded-lg min-h-[50px] items-center' },
    children: [
      { type: 'Box', props: { className: 'w-10 h-6 bg-teal-400 rounded' } },
      { type: 'Box', props: { className: 'w-10 h-6 bg-cyan-400 rounded' } },
      { type: 'Box', props: { className: 'w-10 h-6 bg-sky-400 rounded' } },
    ],
  }),
  labeled('VStack', {
    type: 'Box',
    props: { className: 'flex flex-col gap-2 p-3 border border-dashed border-[rgb(var(--border))] rounded-lg w-24' },
    children: [
      { type: 'Box', props: { className: 'h-4 bg-pink-400 rounded w-full' } },
      { type: 'Box', props: { className: 'h-4 bg-rose-400 rounded w-3/4' } },
      { type: 'Box', props: { className: 'h-4 bg-fuchsia-400 rounded w-1/2' } },
    ],
  }),
  labeled('HStack', {
    type: 'Box',
    props: { className: 'flex flex-row gap-2 p-3 border border-dashed border-[rgb(var(--border))] rounded-lg items-center' },
    children: [
      { type: 'Box', props: { className: 'w-8 h-8 bg-orange-400 rounded' } },
      { type: 'Box', props: { className: 'w-12 h-8 bg-amber-400 rounded' } },
      { type: 'Box', props: { className: 'w-6 h-8 bg-yellow-400 rounded' } },
    ],
  }),
  labeled('Center', {
    type: 'Box',
    props: { className: 'flex items-center justify-center w-24 h-16 border border-dashed border-[rgb(var(--border))] rounded-lg bg-[rgb(var(--muted))]' },
    children: [
      { type: 'Box', props: { className: 'w-8 h-8 bg-violet-500 rounded-full' } },
    ],
  }),
  labeled('Grid 2-col', {
    type: 'Box',
    props: { className: 'grid grid-cols-2 gap-2 p-3 border border-dashed border-[rgb(var(--border))] rounded-lg w-32' },
    children: [
      { type: 'Box', props: { className: 'h-8 bg-blue-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-green-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-pink-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-orange-300 rounded' } },
    ],
  }),
  labeled('Grid 3-col', {
    type: 'Box',
    props: { className: 'grid grid-cols-3 gap-2 p-3 border border-dashed border-[rgb(var(--border))] rounded-lg w-40' },
    children: [
      { type: 'Box', props: { className: 'h-8 bg-cyan-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-purple-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-rose-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-amber-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-teal-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-indigo-300 rounded' } },
    ],
  }),
  labeled('Card', {
    type: 'Box',
    props: { className: 'flex flex-col gap-2 p-4 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] shadow-sm w-44' },
    children: [
      { type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--foreground))]' }, text: 'Card Title' },
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'A card container with border and shadow.' },
    ],
  }),
  labeled('Divider', {
    type: 'Box',
    props: { className: 'flex flex-col gap-3 w-40' },
    children: [
      { type: 'Text', props: { className: 'text-sm text-[rgb(var(--foreground))]' }, text: 'Above' },
      { type: 'Box', props: { className: 'w-full h-px bg-[rgb(var(--border))]' } },
      { type: 'Text', props: { className: 'text-sm text-[rgb(var(--foreground))]' }, text: 'Below' },
    ],
  }),
  labeled('ScrollView', {
    type: 'Box',
    props: { className: 'flex flex-col gap-1 overflow-auto rounded-lg border border-dashed border-[rgb(var(--border))] p-2 w-32', style: { maxHeight: '80px' } },
    children: [
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Item 1' },
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Item 2' },
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Item 3' },
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Item 4' },
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Item 5' },
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Item 6' },
    ],
  }),
]);

// ─── Buttons ─────────────────────────────────────────────────────────────────

const buttonsSection = section('Buttons', [
  labeled('Solid', {
    type: 'Box',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md bg-[rgb(var(--primary))]' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--primary-foreground))]' }, text: 'Button' }],
  }),
  labeled('Destructive', {
    type: 'Box',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md bg-[rgb(var(--destructive))]' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Delete' }],
  }),
  labeled('Outline', {
    type: 'Box',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md border border-[rgb(var(--primary))]' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--primary))]' }, text: 'Button' }],
  }),
  labeled('Ghost', {
    type: 'Box',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md hover:bg-[rgb(var(--muted))]' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--foreground))]' }, text: 'Button' }],
  }),
  labeled('Secondary', {
    type: 'Box',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md bg-[rgb(var(--secondary))]' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--secondary-foreground))]' }, text: 'Button' }],
  }),
  labeled('Icon + Text', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-2 px-4 py-2 rounded-md bg-[rgb(var(--primary))]' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:plus', size: 15, color: 'rgb(var(--primary-foreground))' } },
      { type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--primary-foreground))]' }, text: 'Add Item' },
    ],
  }),
  labeled('Text + Icon', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-2 px-4 py-2 rounded-md bg-[rgb(var(--primary))]' },
    children: [
      { type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--primary-foreground))]' }, text: 'Next' },
      { type: 'Icon', props: { icon: 'lucide:arrow-right', size: 15, color: 'rgb(var(--primary-foreground))' } },
    ],
  }),
  labeled('Icon Only', {
    type: 'Box',
    props: { className: 'flex items-center justify-center w-9 h-9 rounded-md bg-[rgb(var(--primary))]' },
    children: [{ type: 'Icon', props: { icon: 'lucide:settings', size: 18, color: 'rgb(var(--primary-foreground))' } }],
  }),
  labeled('Icon Round', {
    type: 'Box',
    props: { className: 'flex items-center justify-center w-9 h-9 rounded-full bg-[rgb(var(--primary))]' },
    children: [{ type: 'Icon', props: { icon: 'lucide:heart', size: 18, color: 'rgb(var(--primary-foreground))' } }],
  }),
  labeled('Icon Outline', {
    type: 'Box',
    props: { className: 'flex items-center justify-center w-9 h-9 rounded-md border border-[rgb(var(--border))]' },
    children: [{ type: 'Icon', props: { icon: 'lucide:share', size: 16, color: 'rgb(var(--muted-foreground))' } }],
  }),
  labeled('Link Btn', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-1' },
    children: [
      { type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--primary))] underline' }, text: 'Learn more' },
      { type: 'Icon', props: { icon: 'lucide:arrow-right', size: 13, color: 'rgb(var(--primary))' } },
    ],
  }),
  labeled('FAB', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-2 px-5 py-3 rounded-full bg-[rgb(var(--primary))] shadow-lg' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:plus', size: 18, color: 'rgb(var(--primary-foreground))' } },
      { type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--primary-foreground))]' }, text: 'Add' },
    ],
  }),
]);

// ─── Form ─────────────────────────────────────────────────────────────────────

const formSection = section('Form', [
  labeled('Input', {
    type: 'Input',
    props: { variant: 'outline', size: 'md', placeholder: 'Enter text…', className: 'w-full !rounded-md !border-[rgb(var(--border))] !bg-[rgb(var(--card))] !text-[rgb(var(--foreground))]' },
  }),
  labeled('Input Search', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-2 w-full rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:search', size: 15, color: 'rgb(var(--muted-foreground))' } },
      { type: 'Input', props: { variant: 'outline', size: 'md', placeholder: 'Search…', className: 'flex-1 !border-0 !bg-transparent !text-[rgb(var(--foreground))]' } },
    ],
  }),
  labeled('Input Password', {
    type: 'FormContainer',
    children: [{
      type: 'Box',
      props: { className: 'flex flex-row items-center gap-2 w-full rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3' },
      children: [
        { type: 'Input', props: { variant: 'outline', size: 'md', placeholder: 'Password', type: 'password', className: 'flex-1 !border-0 !bg-transparent !text-[rgb(var(--foreground))]' } },
        { type: 'Icon', props: { icon: 'lucide:eye', size: 15, color: 'rgb(var(--muted-foreground))' } },
      ],
    }],
  }),
  labeled('Textarea', {
    type: 'Textarea',
    props: { className: 'w-full h-20 !rounded-md !border-[rgb(var(--border))] !bg-[rgb(var(--card))]' },
    children: [{ type: 'TextareaInput', props: { placeholder: 'Write something…', className: '!text-[rgb(var(--foreground))]' } }],
  }),
  labeled('Select', {
    type: 'Select',
    props: {},
    children: [
      {
        type: 'SelectTrigger',
        props: { className: 'flex flex-row items-center justify-between px-3 py-2 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--card))] w-full' },
        children: [
          { type: 'SelectInput', props: { placeholder: 'Choose option…', className: '!text-[rgb(var(--foreground))]' } },
          { type: 'Icon', props: { icon: 'lucide:chevron-down', size: 15, color: 'rgb(var(--muted-foreground))' } },
        ],
      },
      {
        type: 'SelectPortal',
        children: [
          { type: 'SelectBackdrop' },
          {
            type: 'SelectContent',
            children: [
              { type: 'SelectItem', props: { label: 'Option 1', value: 'a' } },
              { type: 'SelectItem', props: { label: 'Option 2', value: 'b' } },
              { type: 'SelectItem', props: { label: 'Option 3', value: 'c' } },
            ],
          },
        ],
      },
    ],
  }),
  labeled('Checkbox', {
    type: 'Checkbox',
    props: { defaultIsChecked: false },
    children: [
      { type: 'CheckboxIndicator' },
      { type: 'CheckboxLabel', text: 'Accept terms' },
    ],
  }),
  labeled('Checked', {
    type: 'Checkbox',
    props: { defaultIsChecked: true },
    children: [
      { type: 'CheckboxIndicator' },
      { type: 'CheckboxLabel', text: 'Enabled' },
    ],
  }),
  labeled('Checkbox Group', {
    type: 'CheckboxGroup',
    props: { className: 'flex flex-col gap-2' },
    children: [
      { type: 'Checkbox', props: { value: 'a' }, children: [{ type: 'CheckboxIndicator' }, { type: 'CheckboxLabel', text: 'Option A' }] },
      { type: 'Checkbox', props: { value: 'b', defaultIsChecked: true }, children: [{ type: 'CheckboxIndicator' }, { type: 'CheckboxLabel', text: 'Option B' }] },
      { type: 'Checkbox', props: { value: 'c' }, children: [{ type: 'CheckboxIndicator' }, { type: 'CheckboxLabel', text: 'Option C' }] },
    ],
  }),
  labeled('Radio Group', {
    type: 'RadioGroup',
    props: { className: 'flex flex-col gap-2' },
    children: [
      { type: 'Radio', props: { value: 'a' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option A' }] },
      { type: 'Radio', props: { value: 'b' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option B' }] },
    ],
  }),
  labeled('Switch Off', {
    type: 'Box',
    props: { className: 'relative w-12 h-6 rounded-full bg-[rgb(var(--muted))] justify-center' },
    children: [{ type: 'Box', props: { className: 'absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-[rgb(var(--background))] shadow-sm' } }],
  }),
  labeled('Switch On', {
    type: 'Box',
    props: { className: 'relative w-12 h-6 rounded-full bg-[rgb(var(--primary))] justify-center' },
    children: [{ type: 'Box', props: { className: 'absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-[rgb(var(--primary-foreground))] shadow-sm' } }],
  }),
  labeled('Slider', {
    type: 'Slider',
    props: { defaultValue: 60, minValue: 0, maxValue: 100, className: 'w-full' },
    children: [
      { type: 'SliderTrack', children: [{ type: 'SliderFilledTrack' }] },
      { type: 'SliderThumb' },
    ],
  }),
  labeled('Progress 60%', {
    type: 'Progress',
    props: { value: 60, className: 'w-full h-2 rounded-full bg-[rgb(var(--muted))]' },
    children: [{ type: 'ProgressFilledTrack', props: { className: 'h-full rounded-full bg-[rgb(var(--primary))]' } }],
  }),
  labeled('Progress 90%', {
    type: 'Progress',
    props: { value: 90, className: 'w-full h-2 rounded-full bg-[rgb(var(--muted))]' },
    children: [{ type: 'ProgressFilledTrack', props: { className: 'h-full rounded-full bg-green-500' } }],
  }),
]);

// ─── Display / Feedback ───────────────────────────────────────────────────────

// Small indicators — 3 per row on mobile (compact enough to share a row)
const displaySmallItems = [
  labeled('Badge Primary', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-2 py-0.5 rounded-full bg-[rgb(var(--primary))]' },
    children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--primary-foreground))]' }, text: 'New' }],
  }),
  labeled('Badge Success', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-2 py-0.5 rounded-full bg-green-100' },
    children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-green-700' }, text: 'Active' }],
  }),
  labeled('Badge Error', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-2 py-0.5 rounded-full bg-[rgb(var(--destructive))]' },
    children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-white' }, text: 'Error' }],
  }),
  labeled('Badge Warn', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-2 py-0.5 rounded-full bg-yellow-100' },
    children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-yellow-700' }, text: 'Warning' }],
  }),
  labeled('Tag', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-3 py-1 rounded-full bg-[rgb(var(--muted))] border border-[rgb(var(--border))]' },
    children: [{ type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Design' }],
  }),
  labeled('Chip', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-1 px-3 py-1 rounded-full bg-[rgb(var(--accent))] border border-[rgb(var(--border))]' },
    children: [
      { type: 'Text', props: { className: 'text-xs font-medium text-[rgb(var(--foreground))]' }, text: 'React' },
      { type: 'Icon', props: { icon: 'lucide:x', size: 11, color: 'rgb(var(--muted-foreground))' } },
    ],
  }),
  labeled('Avatar', {
    type: 'Box',
    props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-[rgb(var(--primary))]' },
    children: [{ type: 'Text', props: { className: 'text-sm font-bold text-[rgb(var(--primary-foreground))]' }, text: 'JD' }],
  }),
  labeled('Avatar XL', {
    type: 'Box',
    props: { className: 'flex items-center justify-center w-16 h-16 rounded-full bg-[rgb(var(--accent))]' },
    children: [{ type: 'Text', props: { className: 'text-xl font-bold text-[rgb(var(--foreground))]' }, text: 'AB' }],
  }),
  labeled('Spinner', {
    type: 'Box',
    props: {
      className: 'flex items-center justify-center',
      animation: { loop: { type: 'spin', duration: 1000, repeatCount: -1 } },
    },
    children: [{ type: 'Icon', props: { icon: 'lucide:loader-2', size: 24, color: 'rgb(var(--primary))' } }],
  }),
];

// Larger feedback items — 1 per row on mobile (need full width)
const displayLargeItems = [
  labeled('Alert Info', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-3 rounded-lg bg-[rgb(var(--accent))] border border-[rgb(var(--border))] w-full' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:info', size: 16, color: '#2563eb' } },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--foreground))]' }, text: 'Info' },
        { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'This is an info alert.' },
      ]},
    ],
  }),
  labeled('Alert Success', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200 w-full' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:check-circle', size: 16, color: '#16a34a' } },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-green-800' }, text: 'Success' },
        { type: 'Text', props: { className: 'text-xs text-green-700' }, text: 'Your changes were saved.' },
      ]},
    ],
  }),
  labeled('Alert Error', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200 w-full' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:alert-circle', size: 16, color: '#dc2626' } },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-red-800' }, text: 'Error' },
        { type: 'Text', props: { className: 'text-xs text-red-700' }, text: 'Something went wrong.' },
      ]},
    ],
  }),
  labeled('Alert Warning', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-3 rounded-lg bg-yellow-50 border border-yellow-200 w-full' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:alert-triangle', size: 16, color: '#d97706' } },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-yellow-800' }, text: 'Warning' },
        { type: 'Text', props: { className: 'text-xs text-yellow-700' }, text: 'Review before saving.' },
      ]},
    ],
  }),
  labeled('Skeleton Text', {
    type: 'Box',
    props: { className: 'flex flex-col gap-2 w-full' },
    children: [
      { type: 'Box', props: { className: 'w-full h-4 bg-[rgb(var(--muted))] rounded animate-pulse' } },
      { type: 'Box', props: { className: 'w-3/4 h-4 bg-[rgb(var(--muted))] rounded animate-pulse' } },
      { type: 'Box', props: { className: 'w-1/2 h-4 bg-[rgb(var(--muted))] rounded animate-pulse' } },
    ],
  }),
  labeled('Skeleton Card', {
    type: 'Box',
    props: { className: 'flex flex-col gap-3 p-4 w-full border border-[rgb(var(--border))] rounded-xl bg-[rgb(var(--card))]' },
    children: [
      { type: 'Box', props: { className: 'w-full h-24 bg-[rgb(var(--muted))] rounded-lg animate-pulse' } },
      { type: 'Box', props: { className: 'w-2/3 h-4 bg-[rgb(var(--muted))] rounded animate-pulse' } },
      { type: 'Box', props: { className: 'w-1/2 h-3 bg-[rgb(var(--muted))] rounded animate-pulse' } },
    ],
  }),
  labeled('Toast', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-3 px-4 py-3 rounded-lg bg-[rgb(var(--foreground))] shadow-xl w-full' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:check-circle', size: 16, color: '#4ade80' } },
      { type: 'Text', props: { className: 'text-sm text-[rgb(var(--background))] flex-1' }, text: 'Changes saved successfully!' },
    ],
  }),
];

const displaySection: SDUINode = {
  id: uid(),
  type: 'Box',
  props: { className: 'flex flex-col gap-4 p-4 md:p-6 bg-[rgb(var(--card))] rounded-xl border border-[rgb(var(--border))] shadow-sm w-full' },
  children: [
    {
      id: uid(),
      type: 'Box',
      props: { className: 'flex flex-row items-center gap-3' },
      children: [
        { id: uid(), type: 'Box', props: { className: 'w-1 h-6 rounded-full bg-[rgb(var(--primary))]' } },
        { id: uid(), type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--foreground))] uppercase tracking-wider' }, text: 'Display & Feedback' },
      ],
    },
    { id: uid(), type: 'Box', props: { className: 'w-full h-px bg-[rgb(var(--border))]' } },
    row(displaySmallItems, 3),
    row(displayLargeItems, 1),
  ],
};

// ─── Navigation ───────────────────────────────────────────────────────────────

const navigationSection = section('Navigation', [
  labeled('Breadcrumbs', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-1' },
    children: [
      { type: 'Text', props: { className: 'text-sm text-[rgb(var(--primary))] hover:underline' }, text: 'Home' },
      { type: 'Icon', props: { icon: 'lucide:chevron-right', size: 13, color: 'rgb(var(--muted-foreground))' } },
      { type: 'Text', props: { className: 'text-sm text-[rgb(var(--primary))] hover:underline' }, text: 'Products' },
      { type: 'Icon', props: { icon: 'lucide:chevron-right', size: 13, color: 'rgb(var(--muted-foreground))' } },
      { type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--foreground))]' }, text: 'Detail' },
    ],
  }),
  labeled('Tabs', {
    type: 'Box',
    props: { className: 'flex flex-col w-64' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex flex-row border-b border-[rgb(var(--border))]' },
        children: [
          { type: 'Box', props: { className: 'px-4 py-2 border-b-2 border-[rgb(var(--primary))]' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--primary))]' }, text: 'Overview' }] },
          { type: 'Box', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm text-[rgb(var(--muted-foreground))]' }, text: 'Details' }] },
          { type: 'Box', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm text-[rgb(var(--muted-foreground))]' }, text: 'Reviews' }] },
        ],
      },
      { type: 'Box', props: { className: 'p-4 bg-[rgb(var(--card))]' }, children: [{ type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Tab content area' }] },
    ],
  }),
  labeled('Stepper', {
    type: 'Box',
    props: { className: 'flex flex-row items-center w-64' },
    children: [
      { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full bg-[rgb(var(--primary))] flex items-center justify-center' }, children: [{ type: 'Icon', props: { icon: 'lucide:check', size: 14, color: 'rgb(var(--primary-foreground))' } }] }, { type: 'Text', props: { className: 'text-xs text-[rgb(var(--primary))]' }, text: 'Cart' }] },
      { type: 'Box', props: { className: 'flex-1 h-0.5 bg-[rgb(var(--primary))] mx-2' } },
      { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full bg-[rgb(var(--primary))] flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-[rgb(var(--primary-foreground))]' }, text: '2' }] }, { type: 'Text', props: { className: 'text-xs text-[rgb(var(--primary))]' }, text: 'Shipping' }] },
      { type: 'Box', props: { className: 'flex-1 h-0.5 bg-[rgb(var(--border))] mx-2' } },
      { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full border-2 border-[rgb(var(--border))] flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-[rgb(var(--muted-foreground))]' }, text: '3' }] }, { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Payment' }] },
    ],
  }),
  labeled('Pagination', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-1' },
    children: [
      { type: 'Box', props: { className: 'w-8 h-8 rounded-md border border-[rgb(var(--border))] flex items-center justify-center' }, children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 13, color: 'rgb(var(--muted-foreground))' } }] },
      { type: 'Box', props: { className: 'w-8 h-8 rounded-md bg-[rgb(var(--primary))] flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--primary-foreground))]' }, text: '1' }] },
      { type: 'Box', props: { className: 'w-8 h-8 rounded-md border border-[rgb(var(--border))] flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm text-[rgb(var(--muted-foreground))]' }, text: '2' }] },
      { type: 'Box', props: { className: 'w-8 h-8 rounded-md border border-[rgb(var(--border))] flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm text-[rgb(var(--muted-foreground))]' }, text: '3' }] },
      { type: 'Text', props: { className: 'text-sm text-[rgb(var(--muted-foreground))] px-1' }, text: '…' },
      { type: 'Box', props: { className: 'w-8 h-8 rounded-md border border-[rgb(var(--border))] flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm text-[rgb(var(--muted-foreground))]' }, text: '10' }] },
      { type: 'Box', props: { className: 'w-8 h-8 rounded-md border border-[rgb(var(--border))] flex items-center justify-center' }, children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 13, color: 'rgb(var(--muted-foreground))' } }] },
    ],
  }),
  labeled('Star Rating', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-0.5' },
    children: [
      { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: '#f59e0b' } },
      { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: '#f59e0b' } },
      { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: '#f59e0b' } },
      { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: '#f59e0b' } },
      { type: 'Icon', props: { icon: 'lucide:star', size: 20, color: 'rgb(var(--border))' } },
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))] ml-1' }, text: '4.0 (128)' },
    ],
  }),
  labeled('Accordion', {
    type: 'Box',
    props: { className: 'w-64 border border-[rgb(var(--border))] rounded-lg overflow-hidden' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex flex-row items-center justify-between px-4 py-3 bg-[rgb(var(--card))]' },
        children: [
          { type: 'Text', props: { className: 'text-sm font-medium text-[rgb(var(--foreground))]' }, text: 'What is SDUI?' },
          { type: 'Icon', props: { icon: 'lucide:chevron-down', size: 16, color: 'rgb(var(--muted-foreground))' } },
        ],
      },
      {
        type: 'Box',
        props: { className: 'px-4 py-3 bg-[rgb(var(--muted))] border-t border-[rgb(var(--border))]' },
        children: [{ type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'SDUI = Server-Driven UI. JSON configs define the interface.' }],
      },
    ],
  }),
  labeled('Table', {
    type: 'Box',
    props: { className: 'w-72 overflow-hidden rounded-lg border border-[rgb(var(--border))]' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex flex-row bg-[rgb(var(--muted))] border-b border-[rgb(var(--border))]' },
        children: [
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase' }, text: 'Name' }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase' }, text: 'Status' }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase' }, text: 'Amount' }] },
        ],
      },
      {
        type: 'Box',
        props: { className: 'flex flex-row border-b border-[rgb(var(--border))] bg-[rgb(var(--card))]' },
        children: [
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs text-[rgb(var(--foreground))]' }, text: 'Alice Smith' }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Box', props: { className: 'inline-flex px-2 py-0.5 rounded-full bg-green-100' }, children: [{ type: 'Text', props: { className: 'text-xs text-green-700' }, text: 'Active' }] }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs text-[rgb(var(--foreground))]' }, text: '$120.00' }] },
        ],
      },
      {
        type: 'Box',
        props: { className: 'flex flex-row bg-[rgb(var(--card))]' },
        children: [
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs text-[rgb(var(--foreground))]' }, text: 'Bob Jones' }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Box', props: { className: 'inline-flex px-2 py-0.5 rounded-full bg-yellow-100' }, children: [{ type: 'Text', props: { className: 'text-xs text-yellow-700' }, text: 'Pending' }] }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs text-[rgb(var(--foreground))]' }, text: '$45.00' }] },
        ],
      },
    ],
  }),
], 1);

// ─── Icon palette helper ──────────────────────────────────────────────────────

function toLucideIconify(name: string): string {
  return 'lucide:' + name.replace(/([A-Z])/g, (m: string, l: string, i: number) => (i === 0 ? '' : '-') + l.toLowerCase());
}

function iconTile(name: string, color = 'rgb(var(--foreground))'): SDUINode {
  return {
    id: uid(),
    type: 'Box',
    props: { className: 'flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-[rgb(var(--muted))] cursor-default' },
    children: [
      { id: uid(), type: 'Icon', props: { icon: toLucideIconify(name), size: 22, color } },
      { id: uid(), type: 'Text', props: { className: 'text-[9px] text-[rgb(var(--muted-foreground))] text-center leading-tight' }, text: name },
    ],
  };
}

function iconGrid(icons: { name: string; color?: string }[]): SDUINode {
  return {
    id: uid(),
    type: 'Box',
    props: { className: 'grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1 w-full' },
    children: icons.map(({ name, color }) => iconTile(name, color)),
  };
}

// ─── Media / Icons ────────────────────────────────────────────────────────────

const mediaSection: SDUINode = {
  id: uid(),
  type: 'Box',
  props: { className: 'flex flex-col gap-6 p-6 bg-[rgb(var(--card))] rounded-xl border border-[rgb(var(--border))] shadow-sm w-full' },
  children: [
    {
      id: uid(),
      type: 'Box',
      props: { className: 'flex flex-row items-center gap-3' },
      children: [
        { id: uid(), type: 'Box', props: { className: 'w-1 h-6 rounded-full bg-[rgb(var(--primary))]' } },
        { id: uid(), type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--foreground))] uppercase tracking-wider' }, text: 'Icons  ·  Media' },
      ],
    },
    { id: uid(), type: 'Box', props: { className: 'w-full h-px bg-[rgb(var(--border))]' } },

    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'Navigation & Layout' },
    iconGrid([
      { name: 'Home' }, { name: 'Menu' }, { name: 'Settings' }, { name: 'LayoutGrid' },
      { name: 'List' }, { name: 'Layers' }, { name: 'Maximize' }, { name: 'Minimize' },
      { name: 'MoreHorizontal' }, { name: 'MoreVertical' }, { name: 'Filter' },
    ]),

    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'User & Auth' },
    iconGrid([
      { name: 'User' }, { name: 'Users' }, { name: 'UserPlus', color: '#16a34a' }, { name: 'UserCheck', color: '#16a34a' },
      { name: 'LogIn', color: '#2563eb' }, { name: 'LogOut', color: '#dc2626' },
      { name: 'Lock' }, { name: 'Unlock', color: '#6b7280' },
    ]),

    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'Communication' },
    iconGrid([
      { name: 'Bell', color: '#f59e0b' }, { name: 'Mail', color: '#2563eb' }, { name: 'Send', color: '#2563eb' },
      { name: 'MessageCircle' }, { name: 'MessageSquare' }, { name: 'Phone', color: '#16a34a' }, { name: 'Inbox' },
    ]),

    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'Actions' },
    iconGrid([
      { name: 'Search' }, { name: 'Plus', color: '#2563eb' }, { name: 'Minus', color: '#dc2626' },
      { name: 'X', color: '#dc2626' }, { name: 'Check', color: '#16a34a' }, { name: 'CheckCircle2', color: '#16a34a' },
      { name: 'SquareCheck', color: '#16a34a' }, { name: 'Pencil', color: '#f59e0b' }, { name: 'PenLine', color: '#f59e0b' },
      { name: 'Trash', color: '#dc2626' }, { name: 'Trash2', color: '#dc2626' }, { name: 'Copy' },
      { name: 'Upload', color: '#2563eb' }, { name: 'Download', color: '#2563eb' }, { name: 'RefreshCw' },
      { name: 'ExternalLink', color: '#2563eb' }, { name: 'Link', color: '#2563eb' }, { name: 'Share' },
    ]),

    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'Arrows & Chevrons' },
    iconGrid([
      { name: 'ArrowRight', color: '#2563eb' }, { name: 'ArrowLeft', color: '#2563eb' },
      { name: 'ArrowUp', color: '#16a34a' }, { name: 'ArrowDown', color: '#dc2626' },
      { name: 'ChevronDown' }, { name: 'ChevronUp' }, { name: 'ChevronLeft' }, { name: 'ChevronRight' },
      { name: 'ChevronsLeft' }, { name: 'ChevronsRight' },
    ]),

    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'Status & Indicators' },
    iconGrid([
      { name: 'Star', color: '#f59e0b' }, { name: 'Heart', color: '#ef4444' }, { name: 'Bookmark', color: '#6366f1' },
      { name: 'Flag', color: '#f59e0b' }, { name: 'Award', color: '#f59e0b' }, { name: 'Zap', color: '#f59e0b' },
      { name: 'ShieldCheck', color: '#16a34a' }, { name: 'AlertCircle', color: '#f59e0b' },
      { name: 'AlertTriangle', color: '#dc2626' }, { name: 'HelpCircle', color: '#6b7280' },
      { name: 'Info', color: '#2563eb' }, { name: 'Loader', color: '#6b7280' },
      { name: 'TrendingUp', color: '#16a34a' }, { name: 'TrendingDown', color: '#dc2626' }, { name: 'Activity', color: '#6366f1' },
    ]),

    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'E-commerce' },
    iconGrid([
      { name: 'ShoppingCart', color: '#2563eb' }, { name: 'ShoppingBag', color: '#6366f1' }, { name: 'Package' },
      { name: 'Tag', color: '#f59e0b' }, { name: 'CreditCard' }, { name: 'DollarSign', color: '#16a34a' },
      { name: 'CircleDollarSign', color: '#16a34a' }, { name: 'Percent' }, { name: 'Truck' },
    ]),

    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'Data, Files & Code' },
    iconGrid([
      { name: 'ChartBar', color: '#6366f1' }, { name: 'ChartPie', color: '#6366f1' },
      { name: 'SlidersHorizontal' }, { name: 'ToggleLeft', color: '#6b7280' }, { name: 'ToggleRight', color: '#16a34a' },
      { name: 'FileText' }, { name: 'File' }, { name: 'Folder', color: '#f59e0b' }, { name: 'Code', color: '#6366f1' },
      { name: 'Calendar', color: '#2563eb' }, { name: 'Clock' },
    ]),

    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'Location, Media & Misc' },
    iconGrid([
      { name: 'MapPin', color: '#dc2626' }, { name: 'Map' }, { name: 'Globe', color: '#2563eb' },
      { name: 'Image' }, { name: 'Camera' }, { name: 'Video', color: '#6366f1' }, { name: 'Music', color: '#6366f1' },
      { name: 'Eye' }, { name: 'EyeOff', color: '#6b7280' },
      { name: 'Sun', color: '#f59e0b' }, { name: 'Moon', color: '#6366f1' }, { name: 'Monitor' },
      { name: 'Wifi', color: '#16a34a' }, { name: 'Bluetooth', color: '#2563eb' },
      { name: 'Battery' }, { name: 'Power', color: '#dc2626' },
      { name: 'Coffee', color: '#92400e' }, { name: 'Gift', color: '#ec4899' },
      { name: 'Smile', color: '#f59e0b' }, { name: 'Briefcase' }, { name: 'Building' },
      { name: 'Circle', color: '#6b7280' }, { name: 'Square', color: '#6b7280' },
    ]),

    { id: uid(), type: 'Box', props: { className: 'w-full h-px bg-[rgb(var(--border))]' } },
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'Image Component' },
    {
      id: uid(),
      type: 'Box',
      props: { className: 'flex flex-row gap-6 items-start flex-wrap' },
      children: [
        {
          id: uid(),
          type: 'Box',
          props: { className: 'flex flex-col items-center gap-2' },
          children: [
            {
              id: uid(),
              type: 'Box',
              props: { className: 'flex flex-col items-center justify-center w-40 h-28 bg-[rgb(var(--muted))] rounded-xl border border-dashed border-[rgb(var(--border))]' },
              children: [
                { id: uid(), type: 'Icon', props: { icon: 'lucide:image', size: 28, color: 'rgb(var(--muted-foreground))' } },
                { id: uid(), type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))] mt-1' }, text: '320 × 224' },
              ],
            },
            { id: uid(), type: 'Text', props: { className: 'text-[10px] text-[rgb(var(--muted-foreground))]' }, text: 'Placeholder' },
          ],
        },
        {
          id: uid(),
          type: 'Box',
          props: { className: 'flex flex-col items-center gap-2' },
          children: [
            {
              id: uid(),
              type: 'Image',
              props: {
                src: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=320&q=80',
                alt: 'Mountain landscape',
                className: 'w-40 h-28 rounded-xl object-cover',
              },
            },
            { id: uid(), type: 'Text', props: { className: 'text-[10px] text-[rgb(var(--muted-foreground))]' }, text: 'Image' },
          ],
        },
      ],
    },
  ],
};

// ─── Data Viz & Rich Content ──────────────────────────────────────────────────

const dataSection = section('Data, Charts & Rich Content', [
  labeled('Bar Chart', {
    type: 'Chart',
    props: {
      chartType: 'bar',
      className: 'w-64 h-52',
      data: [
        { name: 'Mon', value: 40 },
        { name: 'Tue', value: 72 },
        { name: 'Wed', value: 55 },
        { name: 'Thu', value: 89 },
        { name: 'Fri', value: 63 },
      ],
      colors: ['rgb(var(--primary))'],
    },
  }),
  labeled('Line Chart', {
    type: 'Chart',
    props: {
      chartType: 'line',
      className: 'w-64 h-52',
      data: [
        { name: 'Jan', value: 30 },
        { name: 'Feb', value: 45 },
        { name: 'Mar', value: 38 },
        { name: 'Apr', value: 60 },
        { name: 'May', value: 55 },
        { name: 'Jun', value: 72 },
      ],
      colors: ['#6366f1'],
    },
  }),
  labeled('Pie Chart', {
    type: 'Chart',
    props: {
      chartType: 'pie',
      className: 'w-56 h-52',
      data: [
        { name: 'Mobile', value: 55 },
        { name: 'Desktop', value: 35 },
        { name: 'Tablet', value: 10 },
      ],
      colors: ['rgb(var(--primary))', '#6366f1', '#8b5cf6'],
    },
  }),
  labeled('QR Code', {
    type: 'QRCodeWidget',
    props: { value: 'https://example.com', size: 120, fgColor: 'rgb(var(--foreground))', bgColor: 'rgb(var(--background))' },
  }),
  labeled('Markdown', {
    type: 'MarkdownViewer',
    props: {
      className: 'w-72',
      content: '## Hello World\n\nThis is **bold**, _italic_ and `inline code`.\n\n- Item 1\n- Item 2\n- Item 3',
    },
  }),
  labeled('Iframe', {
    type: 'Iframe',
    props: {
      src: 'https://example.com',
      className: 'w-72 h-40 rounded-xl border border-[rgb(var(--border))]',
    },
  }),
], 1);

// ─── Cards & Patterns ─────────────────────────────────────────────────────────

const patternsSection = section('Common UI Patterns', [
  labeled('Profile Card', {
    type: 'Box',
    props: { className: 'flex flex-col items-center gap-3 p-6 w-52 bg-[rgb(var(--card))] rounded-2xl border border-[rgb(var(--border))] shadow-md' },
    children: [
      { type: 'Box', props: { className: 'flex items-center justify-center w-16 h-16 rounded-full bg-[rgb(var(--primary))]' }, children: [{ type: 'Text', props: { className: 'text-xl font-bold text-[rgb(var(--primary-foreground))]' }, text: 'JD' }] },
      { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--foreground))]' }, text: 'John Doe' },
        { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Product Designer' },
      ]},
      { type: 'Box', props: { className: 'flex flex-row gap-3' }, children: [
        { type: 'Box', props: { className: 'flex flex-row items-center gap-1.5 px-4 py-1.5 rounded-full bg-[rgb(var(--primary))]' }, children: [{ type: 'Text', props: { className: 'text-xs font-medium text-[rgb(var(--primary-foreground))]' }, text: 'Follow' }] },
        { type: 'Box', props: { className: 'flex flex-row items-center gap-1.5 px-4 py-1.5 rounded-full border border-[rgb(var(--border))]' }, children: [{ type: 'Text', props: { className: 'text-xs font-medium text-[rgb(var(--foreground))]' }, text: 'Message' }] },
      ]},
    ],
  }),
  labeled('Product Card', {
    type: 'Box',
    props: { className: 'flex flex-col w-44 bg-[rgb(var(--card))] rounded-2xl border border-[rgb(var(--border))] shadow-sm overflow-hidden' },
    children: [
      { type: 'Box', props: { className: 'flex items-center justify-center w-full h-28 bg-[rgb(var(--muted))]' }, children: [{ type: 'Icon', props: { icon: 'lucide:package', size: 40, color: 'rgb(var(--muted-foreground))' } }] },
      { type: 'Box', props: { className: 'flex flex-col gap-2 p-3' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--foreground))]' }, text: 'Wireless Headphones' },
        { type: 'Box', props: { className: 'flex flex-row items-center gap-0.5' }, children: [
          { type: 'Icon', props: { icon: 'lucide:star', size: 12, color: '#f59e0b' } },
          { type: 'Icon', props: { icon: 'lucide:star', size: 12, color: '#f59e0b' } },
          { type: 'Icon', props: { icon: 'lucide:star', size: 12, color: '#f59e0b' } },
          { type: 'Icon', props: { icon: 'lucide:star', size: 12, color: '#f59e0b' } },
          { type: 'Icon', props: { icon: 'lucide:star', size: 12, color: 'rgb(var(--border))' } },
        ]},
        { type: 'Box', props: { className: 'flex flex-row items-center justify-between' }, children: [
          { type: 'Text', props: { className: 'text-sm font-bold text-[rgb(var(--foreground))]' }, text: '$79.99' },
          { type: 'Box', props: { className: 'flex items-center justify-center w-8 h-8 rounded-full bg-[rgb(var(--primary))]' }, children: [{ type: 'Icon', props: { icon: 'lucide:plus', size: 14, color: 'rgb(var(--primary-foreground))' } }] },
        ]},
      ]},
    ],
  }),
  labeled('Stat Card', {
    type: 'Box',
    props: { className: 'flex flex-col gap-3 p-5 w-44 bg-[rgb(var(--card))] rounded-2xl border border-[rgb(var(--border))] shadow-sm' },
    children: [
      { type: 'Box', props: { className: 'flex flex-row items-center justify-between' }, children: [
        { type: 'Text', props: { className: 'text-xs font-medium text-[rgb(var(--muted-foreground))] uppercase tracking-wide' }, text: 'Total Revenue' },
        { type: 'Box', props: { className: 'flex items-center justify-center w-8 h-8 rounded-lg bg-green-100' }, children: [{ type: 'Icon', props: { icon: 'lucide:trending-up', size: 16, color: '#16a34a' } }] },
      ]},
      { type: 'Text', props: { className: 'text-2xl font-bold text-[rgb(var(--foreground))]' }, text: '$24,531' },
      { type: 'Box', props: { className: 'flex flex-row items-center gap-1' }, children: [
        { type: 'Icon', props: { icon: 'lucide:arrow-up', size: 13, color: '#16a34a' } },
        { type: 'Text', props: { className: 'text-xs font-medium text-green-600' }, text: '+12.5% vs last month' },
      ]},
    ],
  }),
  labeled('Login Form', {
    type: 'FormContainer',
    props: { className: 'flex flex-col gap-4 p-6 w-64 bg-[rgb(var(--card))] rounded-2xl border border-[rgb(var(--border))] shadow-md' },
    children: [
      { type: 'Text', props: { className: 'text-lg font-bold text-[rgb(var(--foreground))]' }, text: 'Welcome back' },
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))] -mt-2' }, text: 'Sign in to your account' },
      { type: 'Box', props: { className: 'flex flex-col gap-1' }, children: [
        { type: 'Text', props: { className: 'text-xs font-medium text-[rgb(var(--foreground))]' }, text: 'Email' },
        { type: 'Input', props: { variant: 'outline', placeholder: 'you@example.com', className: 'w-full !rounded-lg !border-[rgb(var(--border))] !bg-[rgb(var(--card))] !text-[rgb(var(--foreground))]' } },
      ]},
      { type: 'Box', props: { className: 'flex flex-col gap-1' }, children: [
        { type: 'Text', props: { className: 'text-xs font-medium text-[rgb(var(--foreground))]' }, text: 'Password' },
        { type: 'Input', props: { variant: 'outline', placeholder: '••••••••', type: 'password', className: 'w-full !rounded-lg !border-[rgb(var(--border))] !bg-[rgb(var(--card))] !text-[rgb(var(--foreground))]' } },
      ]},
      { type: 'Box', props: { className: 'flex items-center justify-center py-2.5 rounded-lg bg-[rgb(var(--primary))] w-full' }, children: [{ type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--primary-foreground))]' }, text: 'Sign in' }] },
    ],
  }),
  labeled('Notification', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-4 w-72 bg-[rgb(var(--card))] rounded-xl border border-[rgb(var(--border))] shadow-sm' },
    children: [
      { type: 'Box', props: { className: 'flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-[rgb(var(--accent))]' }, children: [{ type: 'Icon', props: { icon: 'lucide:bell', size: 18, color: 'rgb(var(--primary))' } }] },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--foreground))]' }, text: 'New message' },
        { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))]' }, text: 'Alice sent you a message: "Hey, are you free tomorrow?"' },
        { type: 'Text', props: { className: 'text-xs text-[rgb(var(--primary))]' }, text: '2 min ago' },
      ]},
      { type: 'Box', props: { className: 'w-2 h-2 rounded-full bg-[rgb(var(--primary))] mt-1 flex-shrink-0' } },
    ],
  }),
  labeled('Empty State', {
    type: 'Box',
    props: { className: 'flex flex-col items-center gap-3 py-8 px-6 w-60 bg-[rgb(var(--muted))] rounded-2xl border border-dashed border-[rgb(var(--border))]' },
    children: [
      { type: 'Box', props: { className: 'flex items-center justify-center w-16 h-16 rounded-2xl bg-[rgb(var(--card))]' }, children: [{ type: 'Icon', props: { icon: 'lucide:inbox', size: 30, color: 'rgb(var(--muted-foreground))' } }] },
      { type: 'Text', props: { className: 'text-sm font-semibold text-[rgb(var(--foreground))] text-center' }, text: 'Nothing here yet' },
      { type: 'Text', props: { className: 'text-xs text-[rgb(var(--muted-foreground))] text-center' }, text: 'Create your first item to get started.' },
      { type: 'Box', props: { className: 'flex flex-row items-center gap-2 px-4 py-2 rounded-lg bg-[rgb(var(--primary))]' }, children: [{ type: 'Icon', props: { icon: 'lucide:plus', size: 14, color: 'rgb(var(--primary-foreground))' } }, { type: 'Text', props: { className: 'text-xs font-semibold text-[rgb(var(--primary-foreground))]' }, text: 'Create Item' }] },
    ],
  }),
], 1);

// ─── Page background ──────────────────────────────────────────────────────────

/**
 * Root wrapper: uses the theme background color so the canvas always matches
 * whatever --background is set to in the Theme panel.
 */
const pageRoot: SDUINode = {
  id: uid(),
  type: 'Box',
  props: { className: 'flex flex-col gap-6 md:gap-8 p-4 md:p-8 min-h-screen w-full bg-[rgb(var(--background))]' },
  children: [
    typographySection,
    layoutSection,
    buttonsSection,
    formSection,
    displaySection,
    navigationSection,
    mediaSection,
    dataSection,
    patternsSection,
  ],
};

export const showcaseNodes: SDUINode[] = [pageRoot].map(ensureIds);
