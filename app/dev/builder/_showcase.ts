/**
 * Component Showcase
 *
 * Pre-built pageNodes that demonstrate every palette component.
 * Loaded as the initial state of the "home" builder page.
 *
 * Structure: one section per palette category →
 *   section heading + flex-wrap row of labelled examples.
 */

import type { SDUINode } from '@/lib/sdui/types/node';

// ─── ID factory ──────────────────────────────────────────────────────────────

let _n = 0;
const uid = () => `sc-${String(++_n).padStart(3, '0')}`;

/**
 * Recursively ensures every node in the tree has a unique `id`.
 * Nodes defined inline (e.g. deep children inside card patterns) are often
 * written without an explicit `id`. The SDUI renderer only stamps
 * `data-builder-id` on nodes that have an `id`, so without this walk those
 * inner nodes are invisible to the builder's hit-test and cannot be selected.
 */
function ensureIds(node: SDUINode): SDUINode {
  return {
    ...node,
    id: node.id ?? uid(),
    children: node.children?.map(ensureIds),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wraps a component with a label underneath. */
function labeled(label: string, node: SDUINode): SDUINode {
  return {
    id: uid(),
    type: 'Box',
    props: { className: 'flex flex-col items-center gap-2 shrink-0' },
    children: [
      { ...node, id: uid() },
      {
        id: uid(),
        type: 'Text',
        props: { className: 'text-[10px] text-gray-400 text-center whitespace-nowrap' },
        text: label,
      },
    ],
  };
}

/** A 3-column grid of labelled examples — items wrap into multiple rows naturally. */
function row(items: SDUINode[]): SDUINode {
  return {
    id: uid(),
    type: 'Box',
    props: { className: 'grid grid-cols-3 gap-6 items-start w-full' },
    children: items,
  };
}

/** Full-width section card: title + examples row. */
function section(title: string, examples: SDUINode[]): SDUINode {
  return {
    id: uid(),
    type: 'Box',
    props: { className: 'flex flex-col gap-4 p-6 bg-white rounded-xl border border-gray-100 shadow-sm w-full' },
    children: [
      {
        id: uid(),
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-3' },
        children: [
          {
            id: uid(),
            type: 'Box',
            props: { className: 'w-1 h-6 rounded-full bg-blue-500' },
          },
          {
            id: uid(),
            type: 'Heading',
            props: { className: 'text-sm font-semibold text-gray-700 uppercase tracking-wider' },
            text: title,
          },
        ],
      },
      {
        id: uid(),
        type: 'Box',
        props: { className: 'w-full h-px bg-gray-100' },
      },
      row(examples),
    ],
  };
}

// ─── Typography ──────────────────────────────────────────────────────────────

const typographySection = section('Typography', [
  labeled('Heading 1', { type: 'Heading', props: { className: 'text-3xl font-bold text-gray-900' }, text: 'Heading 1' }),
  labeled('Heading 2', { type: 'Heading', props: { className: 'text-2xl font-bold text-gray-900' }, text: 'Heading 2' }),
  labeled('Heading 3', { type: 'Heading', props: { className: 'text-xl font-semibold text-gray-900' }, text: 'Heading 3' }),
  labeled('Heading 4', { type: 'Heading', props: { className: 'text-lg font-semibold text-gray-800' }, text: 'Heading 4' }),
  labeled('Body Text', { type: 'Text', props: { className: 'text-base text-gray-700' }, text: 'Body text — readable paragraph copy.' }),
  labeled('Small Text', { type: 'Text', props: { className: 'text-sm text-gray-600' }, text: 'Small text helper copy.' }),
  labeled('Caption', { type: 'Text', props: { className: 'text-xs text-gray-400' }, text: 'Caption / metadata' }),
  labeled('Bold', { type: 'Text', props: { className: 'text-sm font-bold text-gray-900' }, text: 'Bold text' }),
  labeled('Muted', { type: 'Text', props: { className: 'text-sm text-gray-400' }, text: 'Muted text' }),
  labeled('Link', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-1' },
    children: [
      { type: 'Text', props: { className: 'text-sm text-blue-600 underline' }, text: 'Clickable link' },
    ],
  }),
]);

// ─── Layout ──────────────────────────────────────────────────────────────────

const layoutSection = section('Layout', [
  labeled('Box (col)', {
    type: 'Box',
    props: { className: 'flex flex-col gap-2 p-3 border border-dashed border-gray-300 rounded-lg w-28 min-h-[80px]' },
    children: [
      { type: 'Box', props: { className: 'h-5 bg-blue-200 rounded w-full' } },
      { type: 'Box', props: { className: 'h-5 bg-blue-200 rounded w-full' } },
      { type: 'Box', props: { className: 'h-5 bg-blue-200 rounded w-full' } },
    ],
  }),
  labeled('Box (row)', {
    type: 'Box',
    props: { className: 'flex flex-row gap-2 p-3 border border-dashed border-gray-300 rounded-lg min-h-[50px] items-center' },
    children: [
      { type: 'Box', props: { className: 'w-10 h-6 bg-indigo-200 rounded' } },
      { type: 'Box', props: { className: 'w-10 h-6 bg-indigo-200 rounded' } },
      { type: 'Box', props: { className: 'w-10 h-6 bg-indigo-200 rounded' } },
    ],
  }),
  labeled('VStack', {
    type: 'Box',
    props: { className: 'flex flex-col gap-2 p-3 border border-dashed border-purple-300 rounded-lg w-24' },
    children: [
      { type: 'Box', props: { className: 'h-4 bg-purple-200 rounded w-full' } },
      { type: 'Box', props: { className: 'h-4 bg-purple-200 rounded w-3/4' } },
      { type: 'Box', props: { className: 'h-4 bg-purple-200 rounded w-1/2' } },
    ],
  }),
  labeled('HStack', {
    type: 'Box',
    props: { className: 'flex flex-row gap-2 p-3 border border-dashed border-green-300 rounded-lg items-center' },
    children: [
      { type: 'Box', props: { className: 'w-8 h-8 bg-green-200 rounded' } },
      { type: 'Box', props: { className: 'w-12 h-8 bg-green-200 rounded' } },
      { type: 'Box', props: { className: 'w-6 h-8 bg-green-200 rounded' } },
    ],
  }),
  labeled('Center', {
    type: 'Box',
    props: { className: 'flex items-center justify-center w-24 h-16 border border-dashed border-orange-300 rounded-lg bg-orange-50' },
    children: [
      { type: 'Box', props: { className: 'w-8 h-8 bg-orange-400 rounded-full' } },
    ],
  }),
  labeled('Grid 2-col', {
    type: 'Box',
    props: { className: 'grid grid-cols-2 gap-2 p-3 border border-dashed border-pink-300 rounded-lg w-32' },
    children: [
      { type: 'Box', props: { className: 'h-8 bg-pink-200 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-pink-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-pink-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-pink-200 rounded' } },
    ],
  }),
  labeled('Grid 3-col', {
    type: 'Box',
    props: { className: 'grid grid-cols-3 gap-2 p-3 border border-dashed border-rose-300 rounded-lg w-40' },
    children: [
      { type: 'Box', props: { className: 'h-8 bg-rose-200 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-rose-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-rose-200 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-rose-300 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-rose-200 rounded' } },
      { type: 'Box', props: { className: 'h-8 bg-rose-300 rounded' } },
    ],
  }),
  labeled('Card', {
    type: 'Box',
    props: { className: 'flex flex-col gap-2 p-4 rounded-xl border border-gray-200 bg-white shadow-sm w-44' },
    children: [
      { type: 'Heading', props: { className: 'text-sm font-semibold text-gray-900' }, text: 'Card Title' },
      { type: 'Text', props: { className: 'text-xs text-gray-500' }, text: 'A card container with border and shadow.' },
    ],
  }),
  labeled('Divider', {
    type: 'Box',
    props: { className: 'flex flex-col gap-3 w-40' },
    children: [
      { type: 'Text', props: { className: 'text-sm text-gray-700' }, text: 'Above' },
      { type: 'Box', props: { className: 'w-full h-px bg-gray-200' } },
      { type: 'Text', props: { className: 'text-sm text-gray-700' }, text: 'Below' },
    ],
  }),
  labeled('ScrollView', {
    type: 'Box',
    props: { className: 'flex flex-col gap-1 overflow-auto rounded-lg border border-dashed border-teal-300 p-2 w-32', style: { maxHeight: '80px' } },
    children: [
      { type: 'Text', props: { className: 'text-xs text-gray-600' }, text: 'Item 1' },
      { type: 'Text', props: { className: 'text-xs text-gray-600' }, text: 'Item 2' },
      { type: 'Text', props: { className: 'text-xs text-gray-600' }, text: 'Item 3' },
      { type: 'Text', props: { className: 'text-xs text-gray-600' }, text: 'Item 4' },
      { type: 'Text', props: { className: 'text-xs text-gray-600' }, text: 'Item 5' },
      { type: 'Text', props: { className: 'text-xs text-gray-600' }, text: 'Item 6' },
    ],
  }),
]);

// ─── Buttons ─────────────────────────────────────────────────────────────────

const buttonsSection = section('Buttons', [
  labeled('Solid', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md bg-blue-600' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Button' }],
  }),
  labeled('Destructive', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md bg-red-500' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Delete' }],
  }),
  labeled('Outline', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md border border-blue-600' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-blue-600' }, text: 'Button' }],
  }),
  labeled('Ghost', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md hover:bg-gray-100' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-gray-700' }, text: 'Button' }],
  }),
  labeled('Secondary', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center justify-center px-4 py-2 rounded-md bg-gray-100' },
    children: [{ type: 'Text', props: { className: 'text-sm font-medium text-gray-700' }, text: 'Button' }],
  }),
  labeled('Icon + Text', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center gap-2 px-4 py-2 rounded-md bg-blue-600' },
    children: [
      { type: 'NavIcon', props: { icon: 'Plus', size: 15, color: '#ffffff' } },
      { type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Add Item' },
    ],
  }),
  labeled('Text + Icon', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center gap-2 px-4 py-2 rounded-md bg-blue-600' },
    children: [
      { type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Next' },
      { type: 'NavIcon', props: { icon: 'ArrowRight', size: 15, color: '#ffffff' } },
    ],
  }),
  labeled('Icon Only', {
    type: 'Pressable',
    props: { className: 'flex items-center justify-center w-9 h-9 rounded-md bg-blue-600' },
    children: [{ type: 'NavIcon', props: { icon: 'Settings', size: 18, color: '#ffffff' } }],
  }),
  labeled('Icon Round', {
    type: 'Pressable',
    props: { className: 'flex items-center justify-center w-9 h-9 rounded-full bg-blue-600' },
    children: [{ type: 'NavIcon', props: { icon: 'Heart', size: 18, color: '#ffffff' } }],
  }),
  labeled('Icon Outline', {
    type: 'Pressable',
    props: { className: 'flex items-center justify-center w-9 h-9 rounded-md border border-gray-300' },
    children: [{ type: 'NavIcon', props: { icon: 'Share', size: 16, color: '#6b7280' } }],
  }),
  labeled('Link Btn', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center gap-1' },
    children: [
      { type: 'Text', props: { className: 'text-sm font-medium text-blue-600 underline' }, text: 'Learn more' },
      { type: 'NavIcon', props: { icon: 'ArrowRight', size: 13, color: '#2563eb' } },
    ],
  }),
  labeled('FAB', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center gap-2 px-5 py-3 rounded-full bg-blue-600 shadow-lg' },
    children: [
      { type: 'NavIcon', props: { icon: 'Plus', size: 18, color: '#ffffff' } },
      { type: 'Text', props: { className: 'text-sm font-semibold text-white' }, text: 'Add' },
    ],
  }),
]);

// ─── Form ─────────────────────────────────────────────────────────────────────

const formSection = section('Form', [
  labeled('Input', {
    type: 'Input',
    props: { variant: 'outline', size: 'md', className: 'w-44 !rounded-md !border-gray-300 !bg-white' },
    children: [{ type: 'InputField', props: { placeholder: 'Enter text…', className: '!text-gray-900' } }],
  }),
  labeled('Input Search', {
    type: 'Input',
    props: { variant: 'outline', size: 'md', className: 'w-44 !rounded-md !border-gray-300 !bg-white' },
    children: [
      { type: 'InputSlot', props: { className: 'pl-3 pointer-events-none' }, children: [{ type: 'NavIcon', props: { icon: 'Search', size: 15, color: '#9ca3af' } }] },
      { type: 'InputField', props: { placeholder: 'Search…', className: '!text-gray-900' } },
    ],
  }),
  labeled('Input Password', {
    type: 'Input',
    props: { variant: 'outline', size: 'md', className: 'w-44 !rounded-md !border-gray-300 !bg-white' },
    children: [
      { type: 'InputField', props: { placeholder: 'Password', type: 'password', className: '!text-gray-900' } },
      { type: 'InputSlot', props: { className: 'pr-3 pointer-events-none' }, children: [{ type: 'NavIcon', props: { icon: 'Eye', size: 15, color: '#9ca3af' } }] },
    ],
  }),
  labeled('Textarea', {
    type: 'Textarea',
    props: { className: 'w-44 h-20 !rounded-md !border-gray-300 !bg-white' },
    children: [{ type: 'TextareaInput', props: { placeholder: 'Write something…', className: '!text-gray-900' } }],
  }),
  labeled('Select', {
    type: 'Select',
    props: {},
    children: [
      {
        type: 'SelectTrigger',
        props: { className: 'flex flex-row items-center justify-between px-3 py-2 rounded-md border border-gray-300 bg-white w-44' },
        children: [
          { type: 'SelectInput', props: { placeholder: 'Choose option…', className: '!text-gray-900' } },
          { type: 'SelectIcon', children: [{ type: 'NavIcon', props: { icon: 'ChevronDown', size: 15, color: '#6b7280' } }] },
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
      { type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] },
      { type: 'CheckboxLabel', text: 'Accept terms' },
    ],
  }),
  labeled('Checked', {
    type: 'Checkbox',
    props: { defaultIsChecked: true },
    children: [
      { type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] },
      { type: 'CheckboxLabel', text: 'Enabled' },
    ],
  }),
  labeled('Checkbox Group', {
    type: 'CheckboxGroup',
    props: { className: 'flex flex-col gap-2' },
    children: [
      { type: 'Checkbox', props: { value: 'a' }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Option A' }] },
      { type: 'Checkbox', props: { value: 'b', defaultIsChecked: true }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Option B' }] },
      { type: 'Checkbox', props: { value: 'c' }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Option C' }] },
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
    type: 'Pressable',
    props: { className: 'relative w-12 h-6 rounded-full bg-gray-300 justify-center' },
    children: [{ type: 'Box', props: { className: 'absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm' } }],
  }),
  labeled('Switch On', {
    type: 'Pressable',
    props: { className: 'relative w-12 h-6 rounded-full bg-blue-500 justify-center' },
    children: [{ type: 'Box', props: { className: 'absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm' } }],
  }),
  labeled('Slider', {
    type: 'Slider',
    props: { defaultValue: 60, minValue: 0, maxValue: 100, className: 'w-44' },
    children: [
      { type: 'SliderTrack', children: [{ type: 'SliderFilledTrack' }] },
      { type: 'SliderThumb' },
    ],
  }),
  labeled('Progress 60%', {
    type: 'Progress',
    props: { value: 60, className: 'w-44 h-2 rounded-full bg-gray-200' },
    children: [{ type: 'ProgressFilledTrack', props: { className: 'h-full rounded-full bg-blue-500' } }],
  }),
  labeled('Progress 90%', {
    type: 'Progress',
    props: { value: 90, className: 'w-44 h-2 rounded-full bg-gray-200' },
    children: [{ type: 'ProgressFilledTrack', props: { className: 'h-full rounded-full bg-green-500' } }],
  }),
]);

// ─── Display / Feedback ───────────────────────────────────────────────────────

const displaySection = section('Display & Feedback', [
  labeled('Badge Blue', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-2 py-0.5 rounded-full bg-blue-100' },
    children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-blue-700' }, text: 'New' }],
  }),
  labeled('Badge Green', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-2 py-0.5 rounded-full bg-green-100' },
    children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-green-700' }, text: 'Active' }],
  }),
  labeled('Badge Red', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-2 py-0.5 rounded-full bg-red-100' },
    children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-red-700' }, text: 'Error' }],
  }),
  labeled('Badge Yellow', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-2 py-0.5 rounded-full bg-yellow-100' },
    children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-yellow-700' }, text: 'Warning' }],
  }),
  labeled('Tag', {
    type: 'Box',
    props: { className: 'flex flex-row items-center px-3 py-1 rounded-full bg-gray-100 border border-gray-200' },
    children: [{ type: 'Text', props: { className: 'text-xs text-gray-600' }, text: 'Design' }],
  }),
  labeled('Chip', {
    type: 'Pressable',
    props: { className: 'flex flex-row items-center gap-1 px-3 py-1 rounded-full bg-blue-50 border border-blue-200' },
    children: [
      { type: 'Text', props: { className: 'text-xs font-medium text-blue-700' }, text: 'React' },
      { type: 'NavIcon', props: { icon: 'X', size: 11, color: '#3b82f6' } },
    ],
  }),
  labeled('Avatar Initials', {
    type: 'Box',
    props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-blue-500' },
    children: [{ type: 'Text', props: { className: 'text-sm font-bold text-white' }, text: 'JD' }],
  }),
  labeled('Avatar XL', {
    type: 'Box',
    props: { className: 'flex items-center justify-center w-16 h-16 rounded-full bg-purple-500' },
    children: [{ type: 'Text', props: { className: 'text-xl font-bold text-white' }, text: 'AB' }],
  }),
  labeled('Spinner', {
    type: 'Spinner',
    props: { size: 'large', color: '#3b82f6' },
  }),
  labeled('Alert Info', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 w-56' },
    children: [
      { type: 'NavIcon', props: { icon: 'Info', size: 16, color: '#2563eb' } },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-blue-800' }, text: 'Info' },
        { type: 'Text', props: { className: 'text-xs text-blue-700' }, text: 'This is an info alert.' },
      ]},
    ],
  }),
  labeled('Alert Success', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200 w-56' },
    children: [
      { type: 'NavIcon', props: { icon: 'CheckCircle', size: 16, color: '#16a34a' } },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-green-800' }, text: 'Success' },
        { type: 'Text', props: { className: 'text-xs text-green-700' }, text: 'Your changes were saved.' },
      ]},
    ],
  }),
  labeled('Alert Error', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200 w-56' },
    children: [
      { type: 'NavIcon', props: { icon: 'AlertCircle', size: 16, color: '#dc2626' } },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-red-800' }, text: 'Error' },
        { type: 'Text', props: { className: 'text-xs text-red-700' }, text: 'Something went wrong.' },
      ]},
    ],
  }),
  labeled('Alert Warning', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-3 rounded-lg bg-yellow-50 border border-yellow-200 w-56' },
    children: [
      { type: 'NavIcon', props: { icon: 'AlertTriangle', size: 16, color: '#d97706' } },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-yellow-800' }, text: 'Warning' },
        { type: 'Text', props: { className: 'text-xs text-yellow-700' }, text: 'Review before saving.' },
      ]},
    ],
  }),
  labeled('Skeleton Text', {
    type: 'Box',
    props: { className: 'flex flex-col gap-2 w-44' },
    children: [
      { type: 'Box', props: { className: 'w-full h-4 bg-gray-200 rounded animate-pulse' } },
      { type: 'Box', props: { className: 'w-3/4 h-4 bg-gray-200 rounded animate-pulse' } },
      { type: 'Box', props: { className: 'w-1/2 h-4 bg-gray-200 rounded animate-pulse' } },
    ],
  }),
  labeled('Skeleton Card', {
    type: 'Box',
    props: { className: 'flex flex-col gap-3 p-4 w-44 border border-gray-100 rounded-xl' },
    children: [
      { type: 'Box', props: { className: 'w-full h-24 bg-gray-200 rounded-lg animate-pulse' } },
      { type: 'Box', props: { className: 'w-2/3 h-4 bg-gray-200 rounded animate-pulse' } },
      { type: 'Box', props: { className: 'w-1/2 h-3 bg-gray-200 rounded animate-pulse' } },
    ],
  }),
  labeled('Toast', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-3 px-4 py-3 rounded-lg bg-gray-900 shadow-xl w-64' },
    children: [
      { type: 'NavIcon', props: { icon: 'CheckCircle', size: 16, color: '#4ade80' } },
      { type: 'Text', props: { className: 'text-sm text-white flex-1' }, text: 'Changes saved successfully!' },
    ],
  }),
]);

// ─── Navigation ───────────────────────────────────────────────────────────────

const navigationSection = section('Navigation', [
  labeled('Breadcrumbs', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-1' },
    children: [
      { type: 'Text', props: { className: 'text-sm text-blue-600 hover:underline' }, text: 'Home' },
      { type: 'NavIcon', props: { icon: 'ChevronRight', size: 13, color: '#9ca3af' } },
      { type: 'Text', props: { className: 'text-sm text-blue-600 hover:underline' }, text: 'Products' },
      { type: 'NavIcon', props: { icon: 'ChevronRight', size: 13, color: '#9ca3af' } },
      { type: 'Text', props: { className: 'text-sm font-medium text-gray-800' }, text: 'Detail' },
    ],
  }),
  labeled('Tabs', {
    type: 'Box',
    props: { className: 'flex flex-col w-64' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex flex-row border-b border-gray-200' },
        children: [
          { type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-blue-500' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-blue-600' }, text: 'Overview' }] },
          { type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm text-gray-500' }, text: 'Details' }] },
          { type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm text-gray-500' }, text: 'Reviews' }] },
        ],
      },
      { type: 'Box', props: { className: 'p-4' }, children: [{ type: 'Text', props: { className: 'text-xs text-gray-500' }, text: 'Tab content area' }] },
    ],
  }),
  labeled('Stepper', {
    type: 'Box',
    props: { className: 'flex flex-row items-center w-64' },
    children: [
      { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center' }, children: [{ type: 'NavIcon', props: { icon: 'Check', size: 14, color: '#fff' } }] }, { type: 'Text', props: { className: 'text-xs text-blue-600' }, text: 'Cart' }] },
      { type: 'Box', props: { className: 'flex-1 h-0.5 bg-blue-500 mx-2' } },
      { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-white' }, text: '2' }] }, { type: 'Text', props: { className: 'text-xs text-blue-600' }, text: 'Shipping' }] },
      { type: 'Box', props: { className: 'flex-1 h-0.5 bg-gray-200 mx-2' } },
      { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-gray-400' }, text: '3' }] }, { type: 'Text', props: { className: 'text-xs text-gray-400' }, text: 'Payment' }] },
    ],
  }),
  labeled('Pagination', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-1' },
    children: [
      { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-gray-200 flex items-center justify-center' }, children: [{ type: 'NavIcon', props: { icon: 'ChevronLeft', size: 13, color: '#6b7280' } }] },
      { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: '1' }] },
      { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-gray-200 flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm text-gray-600' }, text: '2' }] },
      { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-gray-200 flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm text-gray-600' }, text: '3' }] },
      { type: 'Text', props: { className: 'text-sm text-gray-400 px-1' }, text: '…' },
      { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-gray-200 flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm text-gray-600' }, text: '10' }] },
      { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-gray-200 flex items-center justify-center' }, children: [{ type: 'NavIcon', props: { icon: 'ChevronRight', size: 13, color: '#6b7280' } }] },
    ],
  }),
  labeled('Star Rating', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-0.5' },
    children: [
      { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
      { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
      { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
      { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
      { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#d1d5db' } },
      { type: 'Text', props: { className: 'text-xs text-gray-500 ml-1' }, text: '4.0 (128)' },
    ],
  }),
  labeled('Accordion', {
    type: 'Box',
    props: { className: 'w-64 border border-gray-200 rounded-lg overflow-hidden' },
    children: [
      {
        type: 'Pressable',
        props: { className: 'flex flex-row items-center justify-between px-4 py-3 bg-white' },
        children: [
          { type: 'Text', props: { className: 'text-sm font-medium text-gray-800' }, text: 'What is SDUI?' },
          { type: 'NavIcon', props: { icon: 'ChevronDown', size: 16, color: '#6b7280' } },
        ],
      },
      {
        type: 'Box',
        props: { className: 'px-4 py-3 bg-gray-50 border-t border-gray-200' },
        children: [{ type: 'Text', props: { className: 'text-xs text-gray-600' }, text: 'SDUI = Server-Driven UI. JSON configs define the interface.' }],
      },
    ],
  }),
  labeled('Table', {
    type: 'Box',
    props: { className: 'w-72 overflow-hidden rounded-lg border border-gray-200' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex flex-row bg-gray-50 border-b border-gray-200' },
        children: [
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-gray-600 uppercase' }, text: 'Name' }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-gray-600 uppercase' }, text: 'Status' }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-gray-600 uppercase' }, text: 'Amount' }] },
        ],
      },
      {
        type: 'Box',
        props: { className: 'flex flex-row border-b border-gray-100' },
        children: [
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs text-gray-700' }, text: 'Alice Smith' }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Box', props: { className: 'inline-flex px-2 py-0.5 rounded-full bg-green-100' }, children: [{ type: 'Text', props: { className: 'text-xs text-green-700' }, text: 'Active' }] }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs text-gray-700' }, text: '$120.00' }] },
        ],
      },
      {
        type: 'Box',
        props: { className: 'flex flex-row' },
        children: [
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs text-gray-700' }, text: 'Bob Jones' }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Box', props: { className: 'inline-flex px-2 py-0.5 rounded-full bg-yellow-100' }, children: [{ type: 'Text', props: { className: 'text-xs text-yellow-700' }, text: 'Pending' }] }] },
          { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs text-gray-700' }, text: '$45.00' }] },
        ],
      },
    ],
  }),
]);

// ─── Icon palette helper: dense 6-column icon tile grid ──────────────────────

function iconTile(name: string, color = '#374151'): SDUINode {
  return {
    id: uid(),
    type: 'Box',
    props: { className: 'flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-gray-100 cursor-default' },
    children: [
      { id: uid(), type: 'NavIcon', props: { icon: name, size: 22, color } },
      { id: uid(), type: 'Text', props: { className: 'text-[9px] text-gray-400 text-center leading-tight' }, text: name },
    ],
  };
}

function iconGrid(icons: { name: string; color?: string }[]): SDUINode {
  return {
    id: uid(),
    type: 'Box',
    props: { className: 'grid grid-cols-6 gap-1 w-full' },
    children: icons.map(({ name, color }) => iconTile(name, color)),
  };
}

// ─── Media / Icons ────────────────────────────────────────────────────────────

const mediaSection: SDUINode = {
  id: uid(),
  type: 'Box',
  props: { className: 'flex flex-col gap-6 p-6 bg-white rounded-xl border border-gray-100 shadow-sm w-full' },
  children: [
    // Section header
    {
      id: uid(),
      type: 'Box',
      props: { className: 'flex flex-row items-center gap-3' },
      children: [
        { id: uid(), type: 'Box', props: { className: 'w-1 h-6 rounded-full bg-blue-500' } },
        { id: uid(), type: 'Heading', props: { className: 'text-sm font-semibold text-gray-700 uppercase tracking-wider' }, text: 'Icons  ·  Media' },
      ],
    },
    { id: uid(), type: 'Box', props: { className: 'w-full h-px bg-gray-100' } },

    // ── Navigation & Layout
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'Navigation & Layout' },
    iconGrid([
      { name: 'Home' }, { name: 'Menu' }, { name: 'Settings' }, { name: 'LayoutGrid' },
      { name: 'List' }, { name: 'Layers' }, { name: 'Maximize' }, { name: 'Minimize' },
      { name: 'MoreHorizontal' }, { name: 'MoreVertical' }, { name: 'Filter' },
    ]),

    // ── User & Auth
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'User & Auth' },
    iconGrid([
      { name: 'User' }, { name: 'Users' }, { name: 'UserPlus', color: '#16a34a' }, { name: 'UserCheck', color: '#16a34a' },
      { name: 'LogIn', color: '#2563eb' }, { name: 'LogOut', color: '#dc2626' },
      { name: 'Lock' }, { name: 'Unlock', color: '#6b7280' },
    ]),

    // ── Communication
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'Communication' },
    iconGrid([
      { name: 'Bell', color: '#f59e0b' }, { name: 'Mail', color: '#2563eb' }, { name: 'Send', color: '#2563eb' },
      { name: 'MessageCircle' }, { name: 'MessageSquare' }, { name: 'Phone', color: '#16a34a' }, { name: 'Inbox' },
    ]),

    // ── Actions
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'Actions' },
    iconGrid([
      { name: 'Search' }, { name: 'Plus', color: '#2563eb' }, { name: 'Minus', color: '#dc2626' },
      { name: 'X', color: '#dc2626' }, { name: 'Check', color: '#16a34a' }, { name: 'CheckCircle2', color: '#16a34a' },
      { name: 'SquareCheck', color: '#16a34a' }, { name: 'Pencil', color: '#f59e0b' }, { name: 'PenLine', color: '#f59e0b' },
      { name: 'Trash', color: '#dc2626' }, { name: 'Trash2', color: '#dc2626' }, { name: 'Copy' },
      { name: 'Upload', color: '#2563eb' }, { name: 'Download', color: '#2563eb' }, { name: 'RefreshCw' },
      { name: 'ExternalLink', color: '#2563eb' }, { name: 'Link', color: '#2563eb' }, { name: 'Share' },
    ]),

    // ── Arrows & Chevrons
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'Arrows & Chevrons' },
    iconGrid([
      { name: 'ArrowRight', color: '#2563eb' }, { name: 'ArrowLeft', color: '#2563eb' },
      { name: 'ArrowUp', color: '#16a34a' }, { name: 'ArrowDown', color: '#dc2626' },
      { name: 'ChevronDown' }, { name: 'ChevronUp' }, { name: 'ChevronLeft' }, { name: 'ChevronRight' },
      { name: 'ChevronsLeft' }, { name: 'ChevronsRight' },
    ]),

    // ── Status & Indicators
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'Status & Indicators' },
    iconGrid([
      { name: 'Star', color: '#f59e0b' }, { name: 'Heart', color: '#ef4444' }, { name: 'Bookmark', color: '#6366f1' },
      { name: 'Flag', color: '#f59e0b' }, { name: 'Award', color: '#f59e0b' }, { name: 'Zap', color: '#f59e0b' },
      { name: 'ShieldCheck', color: '#16a34a' }, { name: 'AlertCircle', color: '#f59e0b' },
      { name: 'AlertTriangle', color: '#dc2626' }, { name: 'HelpCircle', color: '#6b7280' },
      { name: 'Info', color: '#2563eb' }, { name: 'Loader', color: '#6b7280' },
      { name: 'TrendingUp', color: '#16a34a' }, { name: 'TrendingDown', color: '#dc2626' }, { name: 'Activity', color: '#6366f1' },
    ]),

    // ── E-commerce
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'E-commerce' },
    iconGrid([
      { name: 'ShoppingCart', color: '#2563eb' }, { name: 'ShoppingBag', color: '#6366f1' }, { name: 'Package' },
      { name: 'Tag', color: '#f59e0b' }, { name: 'CreditCard' }, { name: 'DollarSign', color: '#16a34a' },
      { name: 'CircleDollarSign', color: '#16a34a' }, { name: 'Percent' }, { name: 'Truck' },
    ]),

    // ── Data, Files & Code
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'Data, Files & Code' },
    iconGrid([
      { name: 'ChartBar', color: '#6366f1' }, { name: 'ChartPie', color: '#6366f1' },
      { name: 'SlidersHorizontal' }, { name: 'ToggleLeft', color: '#6b7280' }, { name: 'ToggleRight', color: '#16a34a' },
      { name: 'FileText' }, { name: 'File' }, { name: 'Folder', color: '#f59e0b' }, { name: 'Code', color: '#6366f1' },
      { name: 'Calendar', color: '#2563eb' }, { name: 'Clock' },
    ]),

    // ── Location, Media & Misc
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'Location, Media & Misc' },
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

    // ── Image component
    { id: uid(), type: 'Box', props: { className: 'w-full h-px bg-gray-100' } },
    { id: uid(), type: 'Text', props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, text: 'Image Component' },
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
              props: { className: 'flex flex-col items-center justify-center w-40 h-28 bg-gray-100 rounded-xl border border-dashed border-gray-300' },
              children: [
                { id: uid(), type: 'NavIcon', props: { icon: 'Image', size: 28, color: '#9ca3af' } },
                { id: uid(), type: 'Text', props: { className: 'text-xs text-gray-400 mt-1' }, text: '320 × 224' },
              ],
            },
            { id: uid(), type: 'Text', props: { className: 'text-[10px] text-gray-400' }, text: 'Placeholder' },
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
            { id: uid(), type: 'Text', props: { className: 'text-[10px] text-gray-400' }, text: 'Image' },
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
      colors: ['#3b82f6'],
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
      colors: ['#3b82f6', '#6366f1', '#8b5cf6'],
    },
  }),
  labeled('QR Code', {
    type: 'QRCodeWidget',
    props: { value: 'https://example.com', size: 120, fgColor: '#1e293b', bgColor: '#ffffff' },
  }),
  labeled('Markdown', {
    type: 'MarkdownViewer',
    props: {
      className: 'w-72',
      content: '## Hello World\n\nThis is **bold**, _italic_ and `inline code`.\n\n- Item 1\n- Item 2\n- Item 3',
    },
  }),
  labeled('JSON Viewer', {
    type: 'JsonViewer',
    props: {
      className: 'w-72',
      data: { user: { name: 'Alice', role: 'admin' }, active: true, score: 42 },
      collapsed: 1,
    },
  }),
  labeled('Iframe', {
    type: 'Iframe',
    props: {
      src: 'https://example.com',
      className: 'w-72 h-40 rounded-xl border border-gray-200',
    },
  }),
]);

// ─── Cards & Patterns ─────────────────────────────────────────────────────────

const patternsSection = section('Common UI Patterns', [
  labeled('Profile Card', {
    type: 'Box',
    props: { className: 'flex flex-col items-center gap-3 p-6 w-52 bg-white rounded-2xl border border-gray-100 shadow-md' },
    children: [
      { type: 'Box', props: { className: 'flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-blue-600' }, children: [{ type: 'Text', props: { className: 'text-xl font-bold text-white' }, text: 'JD' }] },
      { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-gray-900' }, text: 'John Doe' },
        { type: 'Text', props: { className: 'text-xs text-gray-500' }, text: 'Product Designer' },
      ]},
      { type: 'Box', props: { className: 'flex flex-row gap-3' }, children: [
        { type: 'Pressable', props: { className: 'flex flex-row items-center gap-1.5 px-4 py-1.5 rounded-full bg-blue-600' }, children: [{ type: 'Text', props: { className: 'text-xs font-medium text-white' }, text: 'Follow' }] },
        { type: 'Pressable', props: { className: 'flex flex-row items-center gap-1.5 px-4 py-1.5 rounded-full border border-gray-200' }, children: [{ type: 'Text', props: { className: 'text-xs font-medium text-gray-700' }, text: 'Message' }] },
      ]},
    ],
  }),
  labeled('Product Card', {
    type: 'Box',
    props: { className: 'flex flex-col w-44 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden' },
    children: [
      { type: 'Box', props: { className: 'flex items-center justify-center w-full h-28 bg-gradient-to-br from-indigo-50 to-blue-100' }, children: [{ type: 'NavIcon', props: { icon: 'Package', size: 40, color: '#6366f1' } }] },
      { type: 'Box', props: { className: 'flex flex-col gap-2 p-3' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-gray-900' }, text: 'Wireless Headphones' },
        { type: 'Box', props: { className: 'flex flex-row items-center gap-0.5' }, children: [
          { type: 'NavIcon', props: { icon: 'Star', size: 12, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 12, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 12, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 12, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 12, color: '#d1d5db' } },
        ]},
        { type: 'Box', props: { className: 'flex flex-row items-center justify-between' }, children: [
          { type: 'Text', props: { className: 'text-sm font-bold text-gray-900' }, text: '$79.99' },
          { type: 'Pressable', props: { className: 'flex items-center justify-center w-8 h-8 rounded-full bg-blue-600' }, children: [{ type: 'NavIcon', props: { icon: 'Plus', size: 14, color: '#fff' } }] },
        ]},
      ]},
    ],
  }),
  labeled('Stat Card', {
    type: 'Box',
    props: { className: 'flex flex-col gap-3 p-5 w-44 bg-white rounded-2xl border border-gray-100 shadow-sm' },
    children: [
      { type: 'Box', props: { className: 'flex flex-row items-center justify-between' }, children: [
        { type: 'Text', props: { className: 'text-xs font-medium text-gray-500 uppercase tracking-wide' }, text: 'Total Revenue' },
        { type: 'Box', props: { className: 'flex items-center justify-center w-8 h-8 rounded-lg bg-green-100' }, children: [{ type: 'NavIcon', props: { icon: 'TrendingUp', size: 16, color: '#16a34a' } }] },
      ]},
      { type: 'Text', props: { className: 'text-2xl font-bold text-gray-900' }, text: '$24,531' },
      { type: 'Box', props: { className: 'flex flex-row items-center gap-1' }, children: [
        { type: 'NavIcon', props: { icon: 'ArrowUp', size: 13, color: '#16a34a' } },
        { type: 'Text', props: { className: 'text-xs font-medium text-green-600' }, text: '+12.5% vs last month' },
      ]},
    ],
  }),
  labeled('Login Form', {
    type: 'Box',
    props: { className: 'flex flex-col gap-4 p-6 w-64 bg-white rounded-2xl border border-gray-200 shadow-md' },
    children: [
      { type: 'Heading', props: { className: 'text-lg font-bold text-gray-900' }, text: 'Welcome back' },
      { type: 'Text', props: { className: 'text-xs text-gray-500 -mt-2' }, text: 'Sign in to your account' },
      { type: 'Box', props: { className: 'flex flex-col gap-1' }, children: [
        { type: 'Text', props: { className: 'text-xs font-medium text-gray-700' }, text: 'Email' },
        { type: 'Input', props: { variant: 'outline', className: 'w-full !rounded-lg !border-gray-300' }, children: [{ type: 'InputField', props: { placeholder: 'you@example.com', className: '!text-gray-900' } }] },
      ]},
      { type: 'Box', props: { className: 'flex flex-col gap-1' }, children: [
        { type: 'Text', props: { className: 'text-xs font-medium text-gray-700' }, text: 'Password' },
        { type: 'Input', props: { variant: 'outline', className: 'w-full !rounded-lg !border-gray-300' }, children: [{ type: 'InputField', props: { placeholder: '••••••••', type: 'password', className: '!text-gray-900' } }] },
      ]},
      { type: 'Pressable', props: { className: 'flex items-center justify-center py-2.5 rounded-lg bg-blue-600 w-full' }, children: [{ type: 'Text', props: { className: 'text-sm font-semibold text-white' }, text: 'Sign in' }] },
    ],
  }),
  labeled('Notification', {
    type: 'Box',
    props: { className: 'flex flex-row items-start gap-3 p-4 w-72 bg-white rounded-xl border border-gray-100 shadow-sm' },
    children: [
      { type: 'Box', props: { className: 'flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-blue-100' }, children: [{ type: 'NavIcon', props: { icon: 'Bell', size: 18, color: '#2563eb' } }] },
      { type: 'Box', props: { className: 'flex flex-col gap-0.5 flex-1' }, children: [
        { type: 'Text', props: { className: 'text-sm font-semibold text-gray-900' }, text: 'New message' },
        { type: 'Text', props: { className: 'text-xs text-gray-500' }, text: 'Alice sent you a message: "Hey, are you free tomorrow?"' },
        { type: 'Text', props: { className: 'text-xs text-blue-500' }, text: '2 min ago' },
      ]},
      { type: 'Box', props: { className: 'w-2 h-2 rounded-full bg-blue-500 mt-1 flex-shrink-0' } },
    ],
  }),
  labeled('Empty State', {
    type: 'Box',
    props: { className: 'flex flex-col items-center gap-3 py-8 px-6 w-60 bg-gray-50 rounded-2xl border border-dashed border-gray-200' },
    children: [
      { type: 'Box', props: { className: 'flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100' }, children: [{ type: 'NavIcon', props: { icon: 'Inbox', size: 30, color: '#9ca3af' } }] },
      { type: 'Text', props: { className: 'text-sm font-semibold text-gray-700 text-center' }, text: 'Nothing here yet' },
      { type: 'Text', props: { className: 'text-xs text-gray-400 text-center' }, text: 'Create your first item to get started.' },
      { type: 'Pressable', props: { className: 'flex flex-row items-center gap-2 px-4 py-2 rounded-lg bg-blue-600' }, children: [{ type: 'NavIcon', props: { icon: 'Plus', size: 14, color: '#fff' } }, { type: 'Text', props: { className: 'text-xs font-semibold text-white' }, text: 'Create Item' }] },
    ],
  }),
  labeled('Search Bar', {
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-2 px-3 py-2 w-72 rounded-full bg-gray-100 border border-gray-200' },
    children: [
      { type: 'NavIcon', props: { icon: 'Search', size: 15, color: '#9ca3af' } },
      { type: 'Box', props: { className: 'flex-1' }, children: [{ type: 'Text', props: { className: 'text-sm text-gray-400' }, text: 'Search anything…' }] },
      { type: 'Box', props: { className: 'flex items-center px-2 py-0.5 rounded bg-white border border-gray-200' }, children: [{ type: 'Text', props: { className: 'text-xs text-gray-400' }, text: '⌘K' }] },
    ],
  }),
]);

// ─── Root showcase node ───────────────────────────────────────────────────────

const showcaseRaw: SDUINode[] = [
  {
    id: 'sc-root',
    type: 'Box',
    props: { className: 'flex flex-col gap-6 p-8 w-full bg-gray-50 max-w-5xl mx-auto' },
    children: [
      // ── Page header ─────────────────────────────────────────────────────
      {
        id: 'sc-page-header',
        type: 'Box',
        props: { className: 'flex flex-col gap-1 pb-2' },
        children: [
          { id: 'sc-page-title', type: 'Heading', props: { className: 'text-3xl font-bold text-gray-900' }, text: 'Component Showcase' },
          { id: 'sc-page-sub', type: 'Text', props: { className: 'text-sm text-gray-500' }, text: 'All available palette components — drag any example onto your canvas.' },
        ],
      },

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
  },
];

// Apply ensureIds so every node at every depth has a unique id.
// This is critical: the builder renderer only stamps `data-builder-id`
// on nodes that have an `id`, so inner card children defined without
// an explicit id would be invisible to hit-testing (unselectable).
export const showcaseNodes: SDUINode[] = showcaseRaw.map(ensureIds);
