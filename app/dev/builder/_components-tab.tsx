'use client';

/**
 * _components-tab.tsx
 *
 * Components tab for the Builder Left Panel.
 * Contains the draggable primitives registry and the ComponentsTab UI.
 * Extracted from _panel-left.tsx.
 *
 * Exports:
 *  - PRIMITIVE_COMPONENTS  — registry of all draggable node types
 *  - SectionHeader         — collapsible section header
 *  - DraggablePrimitive    — single draggable component tile
 *  - ComponentsTab         — full components tab panel
 */

import React, { useState } from 'react';
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';

// ─── Primitive components registry ───────────────────────────────────────────

export const PRIMITIVE_COMPONENTS: Record<string, { type: string; label: string; icon: string; defaultNode: object }[]> = {
  Layout: [
    { type: 'Box',    label: 'Box',    icon: '□', defaultNode: { type: 'Box',    props: { className: 'flex flex-col p-4 gap-4 w-full min-h-[80px]' } } },
    { type: 'Box',    label: 'Row',    icon: '⬌', defaultNode: { type: 'Box',    props: { className: 'flex flex-row gap-4 p-4 w-full min-h-[60px] items-center' } } },
    { type: 'VStack', label: 'VStack', icon: '⬇', defaultNode: { type: 'VStack', props: { className: 'flex flex-col gap-4 p-4 w-full min-h-[80px]' } } },
    { type: 'HStack', label: 'HStack', icon: '➡', defaultNode: { type: 'HStack', props: { className: 'flex flex-row gap-4 p-4 w-full min-h-[60px] items-center' } } },
    // Center — horizontally & vertically centers children
    { type: 'Center', label: 'Center', icon: '⊕', defaultNode: { type: 'Center', props: { className: 'flex flex-col items-center justify-center p-4 w-full min-h-[60px]' } } },
    // Grid — CSS grid container; children are GridItems
    { type: 'Grid',   label: 'Grid',   icon: '⊞', defaultNode: { type: 'Grid', props: { className: 'grid grid-cols-2 gap-4 w-full min-h-[60px]' } } },
    // Card — bordered surface container
    { type: 'Card',   label: 'Card',   icon: '▣', defaultNode: { type: 'Card', props: { className: 'rounded-lg border border-border bg-card p-4 w-full flex flex-col gap-2' }, children: [{ type: 'Heading', text: 'Card Title', props: { className: 'text-lg font-semibold text-foreground' } }, { type: 'Text', text: 'Card content goes here.', props: { className: 'text-sm text-muted-foreground' } }] } },
    // Divider — horizontal rule
    { type: 'Box',    label: 'Divider', icon: '—', defaultNode: { type: 'Box', props: { className: 'w-full h-px bg-border' } } },
    // ScrollView — scrollable container (overflow-auto)
    { type: 'Box',    label: 'ScrollView', icon: '↕', defaultNode: { type: 'Box', props: { className: 'flex flex-col gap-4 overflow-auto w-full', style: { maxHeight: '200px' } }, children: [{ type: 'Text', text: 'Scroll content here', props: { className: 'text-sm text-foreground' } }] } },
  ],
  Typography: [
    { type: 'Text',    label: 'Text',    icon: 'T', defaultNode: { type: 'Text',    text: 'Text block', props: { className: 'text-base text-foreground' } } },
    { type: 'Heading', label: 'Heading', icon: 'H', defaultNode: { type: 'Heading', text: 'Heading',    props: { className: 'text-2xl font-bold text-foreground' } } },
    { type: 'Text',    label: 'Label',   icon: 'L', defaultNode: { type: 'Text',    text: 'Label',      props: { className: 'text-sm font-medium text-foreground' } } },
    { type: 'Text',    label: 'Caption', icon: 'C', defaultNode: { type: 'Text',    text: 'Caption',    props: { className: 'text-xs text-muted-foreground' } } },
    // Navigable link text
    { type: 'Link',    label: 'Link',    icon: '🔗', defaultNode: { type: 'Link', props: { href: '#' }, children: [{ type: 'LinkText', text: 'Link text', props: { className: 'text-sm text-primary underline' } }] } },
  ],
  Buttons: [
    // Solid — primary fill
    { type: 'Pressable', label: 'Btn Solid',       icon: '◼', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Button' }] } },
    // Destructive — danger fill
    { type: 'Pressable', label: 'Btn Destructive', icon: '⛔', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-destructive' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-destructive-foreground' }, text: 'Delete' }] } },
    // Outline — border only
    { type: 'Pressable', label: 'Btn Outline',     icon: '◻', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md border border-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary' }, text: 'Button' }] } },
    // Ghost — no bg, no border
    { type: 'Pressable', label: 'Btn Ghost',       icon: '○', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary' }, text: 'Button' }] } },
    // Icon + Text (left icon)
    { type: 'Pressable', label: 'Btn + Icon L',    icon: '◀', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'NavIcon', props: { icon: 'Star', size: 16, color: '#ffffff' } }, { type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Button' }] } },
    // Text + Icon (right icon)
    { type: 'Pressable', label: 'Btn + Icon R',    icon: '▶', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Button' }, { type: 'NavIcon', props: { icon: 'ArrowRight', size: 16, color: '#ffffff' } }] } },
    // Icon only — square
    { type: 'Pressable', label: 'Icon Btn',        icon: '⬚', defaultNode: { type: 'Pressable', props: { className: 'flex items-center justify-center w-10 h-10 rounded-md bg-primary' }, children: [{ type: 'NavIcon', props: { icon: 'Star', size: 18, color: '#ffffff' } }] } },
    // Icon only — circular
    { type: 'Pressable', label: 'Icon Btn Round',  icon: '◉', defaultNode: { type: 'Pressable', props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-primary' }, children: [{ type: 'NavIcon', props: { icon: 'Star', size: 18, color: '#ffffff' } }] } },
    // Link-style
    { type: 'Pressable', label: 'Link Btn',        icon: '⇒', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center gap-1' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary underline' }, text: 'Learn more' }, { type: 'NavIcon', props: { icon: 'ArrowRight', size: 14, color: 'currentColor' } }] } },
    // Bare Pressable
    { type: 'Pressable', label: 'Pressable',       icon: '●', defaultNode: { type: 'Pressable', props: { className: 'px-4 py-2 items-center justify-center' }, children: [{ type: 'Text', text: 'Press me' }] } },
    // Floating Action Button — use NavIcon directly (FabIcon wraps Gluestack UIIcon which needs `as` prop, not children)
    { type: 'Fab',       label: 'FAB',             icon: '⊕', defaultNode: { type: 'Fab', props: { className: 'flex flex-row items-center justify-center gap-2 px-5 py-3 rounded-full bg-primary shadow-lg' }, children: [{ type: 'NavIcon', props: { icon: 'Plus', size: 20, color: '#ffffff' } }, { type: 'FabLabel', text: 'Add', props: { className: 'text-sm font-medium text-primary-foreground' } }] } },
  ],
  Form: [
    // FormContainer — weWeb-style local form state (local.data.form.*)
    {
      type: 'FormContainer',
      label: 'Form',
      icon: '⊞',
      defaultNode: {
        type: 'FormContainer',
        props: { className: 'flex flex-col gap-4 w-full', initialFormData: { email: '', password: '' } },
        children: [
          {
            type: 'Input',
            props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-gray-200 !bg-white dark:!border-gray-700 dark:!bg-gray-900' },
            children: [
              {
                type: 'InputField',
                props: { placeholder: 'Email', name: 'email', className: '!text-gray-900 dark:!text-gray-100' },
                actions: {
                  change: {
                    type: 'setFormField',
                    field: 'email',
                    value: '$event',
                  },
                },
              },
            ],
          },
          {
            type: 'Input',
            props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-gray-200 !bg-white dark:!border-gray-700 dark:!bg-gray-900' },
            children: [
              {
                type: 'InputField',
                props: { placeholder: 'Password', name: 'password', type: 'password', className: '!text-gray-900 dark:!text-gray-100' },
                actions: {
                  change: {
                    type: 'setFormField',
                    field: 'password',
                    value: '$event',
                  },
                },
              },
            ],
          },
          {
            type: 'Button',
            props: { action: 'primary', className: 'w-full' },
            children: [{ type: 'ButtonText', text: 'Submit' }],
            actions: { click: { type: 'submitForm' } },
          },
        ],
      },
    },
    // Input — plain text
    { type: 'Input',    label: 'Input',       icon: '▭', defaultNode: { type: 'Input', props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-border !bg-background' }, children: [{ type: 'InputField', props: { placeholder: 'Enter text…', className: '!text-foreground' } }] } },
    // Input with leading search icon
    { type: 'Input',    label: 'Input Search', icon: '🔍', defaultNode: { type: 'Input', props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-border !bg-background' }, children: [{ type: 'InputSlot', props: { className: 'pl-3 pointer-events-none' }, children: [{ type: 'NavIcon', props: { icon: 'Search', size: 16, color: '#9ca3af' } }] }, { type: 'InputField', props: { placeholder: 'Search…', className: '!text-foreground' } }] } },
    // Textarea — must include TextareaInput child to render the actual <textarea> element
    { type: 'Textarea', label: 'Textarea',    icon: '≡', defaultNode: { type: 'Textarea', props: { className: 'w-full !rounded-md !border-border !bg-background' }, children: [{ type: 'TextareaInput', props: { placeholder: 'Enter text…', className: '!text-foreground' } }] } },
    // Select — dropdown picker (Gluestack compound)
    { type: 'Select',   label: 'Select',      icon: '▽', defaultNode: { type: 'Select', props: {}, children: [{ type: 'SelectTrigger', props: { className: 'flex flex-row items-center justify-between px-3 py-2 rounded-md border border-border bg-background' }, children: [{ type: 'SelectInput', props: { placeholder: 'Select option…', className: '!text-foreground' } }, { type: 'SelectIcon', children: [{ type: 'NavIcon', props: { icon: 'ChevronDown', size: 16, color: '#6b7280' } }] }] }, { type: 'SelectPortal', children: [{ type: 'SelectBackdrop' }, { type: 'SelectContent', children: [{ type: 'SelectItem', props: { label: 'Option 1', value: 'option1' } }, { type: 'SelectItem', props: { label: 'Option 2', value: 'option2' } }] }] }] } },
    // Slider — range input (Gluestack compound)
    { type: 'Slider',   label: 'Slider',      icon: '⊸', defaultNode: { type: 'Slider', props: { defaultValue: 50, minValue: 0, maxValue: 100, className: 'w-full' }, children: [{ type: 'SliderTrack', children: [{ type: 'SliderFilledTrack' }] }, { type: 'SliderThumb' }] } },
    // RadioGroup — always wrap Radio items in a group to provide required context (standalone Radio crashes)
    { type: 'RadioGroup', label: 'Radio',       icon: '◎', defaultNode: { type: 'RadioGroup', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Radio', props: { value: 'option' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option' }] }] } },
    // RadioGroup — mutually exclusive radio options
    { type: 'RadioGroup', label: 'Radio Group', icon: '⊙', defaultNode: { type: 'RadioGroup', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Radio', props: { value: 'a' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option A' }] }, { type: 'Radio', props: { value: 'b' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option B' }] }] } },
    // Progress — progress bar (Gluestack compound)
    { type: 'Progress', label: 'Progress',    icon: '▬', defaultNode: { type: 'Progress', props: { value: 60, className: 'w-full h-2 rounded-full bg-muted' }, children: [{ type: 'ProgressFilledTrack', props: { className: 'h-full rounded-full bg-primary' } }] } },
    // Toggle — primitive Pressable (track) + Box (thumb); both parts selectable and fully styleable
    {
      type: 'Pressable',
      label: 'Toggle',
      icon: '⏻',
      defaultNode: {
        type: 'Pressable',
        props: { className: 'relative w-12 h-6 rounded-full bg-gray-300 justify-center px-0.5' },
        children: [
          { type: 'Box', props: { className: 'w-5 h-5 rounded-full bg-white shadow-sm' } },
        ],
      },
    },
    { type: 'Checkbox', label: 'Checkbox',    icon: '☑', defaultNode: { type: 'Checkbox', props: { defaultIsChecked: false }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Label' }] } },
    // CheckboxGroup — group of related checkboxes
    { type: 'CheckboxGroup', label: 'Checkbox Group', icon: '☑☑', defaultNode: { type: 'CheckboxGroup', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Checkbox', props: { value: 'a' }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Option A' }] }, { type: 'Checkbox', props: { value: 'b' }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Option B' }] }] } },
    // Switch — primitive: Pressable track + Box thumb (fully selectable/styleable)
    {
      type: 'Pressable',
      label: 'Switch',
      icon: '⏵',
      defaultNode: {
        type: 'Pressable',
        props: { className: 'relative w-12 h-6 rounded-full bg-gray-300 justify-center' },
        children: [
          { type: 'Box', props: { className: 'absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm' } },
        ],
      },
    },
    // Switch (on) — same but in active state
    {
      type: 'Pressable',
      label: 'Switch On',
      icon: '⏸',
      defaultNode: {
        type: 'Pressable',
        props: { className: 'relative w-12 h-6 rounded-full bg-primary justify-center' },
        children: [
          { type: 'Box', props: { className: 'absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm' } },
        ],
      },
    },
  ],
  Composite: [
    // Chip — removable tag with X button
    {
      type: 'Pressable',
      label: 'Chip',
      icon: '⬡',
      defaultNode: {
        type: 'Pressable',
        props: { className: 'flex flex-row items-center gap-1 px-3 py-1 rounded-full bg-secondary' },
        children: [
          { type: 'Text', props: { className: 'text-sm font-medium text-secondary-foreground' }, text: 'Label' },
          { type: 'NavIcon', props: { icon: 'X', size: 12, color: '#6b7280' } },
        ],
      },
    },
    // Chip (static) — no remove button
    {
      type: 'Box',
      label: 'Tag',
      icon: '🏷',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center px-3 py-1 rounded-full bg-muted' },
        children: [{ type: 'Text', props: { className: 'text-xs font-medium text-foreground' }, text: 'Tag' }],
      },
    },
    // Tabs — HStack tab strip + content area (all primitive)
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
              { type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary' }, text: 'Tab 1' }] },
              { type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-muted-foreground' }, text: 'Tab 2' }] },
              { type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-muted-foreground' }, text: 'Tab 3' }] },
            ],
          },
          { type: 'Box', props: { className: 'p-4 w-full' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Tab 1 content goes here.' }] },
        ],
      },
    },
    // Stepper — step progress indicator
    {
      type: 'Box',
      label: 'Stepper',
      icon: '①',
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
    // Pagination bar — prev/next + page numbers
    {
      type: 'Box',
      label: 'Pagination',
      icon: '⟨⟩',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row gap-1 items-center' },
        children: [
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'NavIcon', props: { icon: 'ChevronLeft', size: 14, color: '#6b7280' } }] },
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: '1' }] },
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: '2' }] },
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: '3' }] },
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'NavIcon', props: { icon: 'ChevronRight', size: 14, color: '#6b7280' } }] },
        ],
      },
    },
    // Star Rating — 5 star icons
    {
      type: 'Box',
      label: 'Star Rating',
      icon: '★',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row gap-1 items-center' },
        children: [
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#d1d5db' } },
        ],
      },
    },
    // Breadcrumbs — nav path
    {
      type: 'Box',
      label: 'Breadcrumbs',
      icon: '›',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-1' },
        children: [
          { type: 'Text', props: { className: 'text-sm text-primary' }, text: 'Home' },
          { type: 'NavIcon', props: { icon: 'ChevronRight', size: 14, color: '#9ca3af' } },
          { type: 'Text', props: { className: 'text-sm text-primary' }, text: 'Category' },
          { type: 'NavIcon', props: { icon: 'ChevronRight', size: 14, color: '#9ca3af' } },
          { type: 'Text', props: { className: 'text-sm text-foreground font-medium' }, text: 'Page' },
        ],
      },
    },
    // Accordion (primitive) — collapsible section
    {
      type: 'Box',
      label: 'Accordion',
      icon: '▾',
      defaultNode: {
        type: 'Box',
        props: { className: 'w-full border border-border rounded-md overflow-hidden' },
        children: [
          {
            type: 'Pressable',
            props: { className: 'flex flex-row items-center justify-between p-4 bg-background' },
            children: [
              { type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: 'Section Title' },
              { type: 'NavIcon', props: { icon: 'ChevronDown', size: 16, color: '#6b7280' } },
            ],
          },
          { type: 'Box', props: { className: 'p-4 bg-muted border-t border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Accordion content goes here.' }] },
        ],
      },
    },
    // Table (primitive) — flex-based rows
    {
      type: 'Box',
      label: 'Table',
      icon: '⊞',
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
    // Autocomplete — Input + dropdown options (fully primitive)
    {
      type: 'Box',
      label: 'Autocomplete',
      icon: '⌕',
      defaultNode: {
        type: 'Box',
        props: { className: 'relative flex flex-col w-full' },
        children: [
          { type: 'Input', props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-border !bg-background' }, children: [{ type: 'InputSlot', props: { className: 'pl-3 pointer-events-none' }, children: [{ type: 'NavIcon', props: { icon: 'Search', size: 16, color: '#9ca3af' } }] }, { type: 'InputField', props: { placeholder: 'Search…', className: '!text-foreground' } }] },
          {
            type: 'Box',
            props: { className: 'absolute top-full left-0 right-0 z-50 bg-background border border-border rounded-md shadow-md mt-1 overflow-hidden' },
            children: [
              { type: 'Pressable', props: { className: 'px-3 py-2 hover:bg-muted border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Option 1' }] },
              { type: 'Pressable', props: { className: 'px-3 py-2 hover:bg-muted border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Option 2' }] },
              { type: 'Pressable', props: { className: 'px-3 py-2 hover:bg-muted' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Option 3' }] },
            ],
          },
        ],
      },
    },
    // Notification / Snackbar — bottom alert bar
    {
      type: 'Box',
      label: 'Snackbar',
      icon: '🔔',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center justify-between gap-3 px-4 py-3 rounded-lg bg-gray-900 shadow-lg w-full max-w-sm' },
        children: [
          { type: 'NavIcon', props: { icon: 'CheckCircle', size: 18, color: '#4ade80' } },
          { type: 'Text', props: { className: 'flex-1 text-sm font-medium text-white' }, text: 'Action completed successfully.' },
          { type: 'Pressable', props: { className: 'ml-2' }, children: [{ type: 'NavIcon', props: { icon: 'X', size: 16, color: '#9ca3af' } }] },
        ],
      },
    },
  ],
  Media: [
    // NextImage used instead of Gluestack Image: supports forwardRef (data-builder-id), shows gray placeholder when no src, works with Next.js image optimization on web
    { type: 'NextImage', label: 'Image', icon: '🖼', defaultNode: { type: 'NextImage', props: { className: 'rounded-md', style: { width: '300px', height: '192px' } }, src: 'https://placehold.co/600x400' } },
    { type: 'NavIcon', label: 'Icon',     icon: '✦', defaultNode: { type: 'NavIcon', props: { icon: 'Star', size: 24, color: '#6b7280' } } },
    // Icon inside a tappable circle
    { type: 'Pressable', label: 'Icon Tap', icon: '⊙', defaultNode: { type: 'Pressable', props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-secondary' }, children: [{ type: 'NavIcon', props: { icon: 'Star', size: 18, color: '#6b7280' } }] } },
  ],
  'Data & Media': [
    // DatePicker — native HTML date input wrapper
    { type: 'DatePicker',     label: 'Date Picker',     icon: '📅', defaultNode: { type: 'DatePicker',     props: { label: 'Date', style: { width: '220px' } } } },
    // TimePicker — native HTML time input wrapper
    { type: 'TimePicker',     label: 'Time Picker',     icon: '⏱', defaultNode: { type: 'TimePicker',     props: { label: 'Time', style: { width: '220px' } } } },
    // DateTimePicker — native HTML datetime-local input wrapper
    { type: 'DateTimePicker', label: 'Date & Time',     icon: '📆', defaultNode: { type: 'DateTimePicker', props: { label: 'Date & Time', style: { width: '260px' } } } },
    // ColorPicker — color swatch + native input[type=color]
    { type: 'ColorPicker',    label: 'Color Picker',    icon: '🎨', defaultNode: { type: 'ColorPicker',    props: { label: 'Color', value: '#6366f1', style: { width: '220px' } } } },
    // FileUpload — dashed drop zone + hidden file input
    { type: 'FileUpload',     label: 'File Upload',     icon: '📎', defaultNode: { type: 'FileUpload',     props: { label: 'Click or drag to upload', style: { width: '280px', minHeight: '120px' } } } },
    // Iframe — embedded web page with placeholder
    { type: 'Iframe',         label: 'Iframe',          icon: '⬜', defaultNode: { type: 'Iframe',         props: { title: 'Embedded', style: { width: '400px', height: '240px' } } } },
    // SvgViewer — dangerouslySetInnerHTML SVG display with placeholder
    { type: 'SvgViewer',      label: 'SVG Viewer',      icon: '⬡', defaultNode: { type: 'SvgViewer',      props: { style: { width: '120px', height: '120px' } } } },
    // JsonViewer — syntax-colored JSON pretty-printer
    { type: 'JsonViewer',     label: 'JSON Viewer',     icon: '{}', defaultNode: { type: 'JsonViewer',     props: { data: { name: 'Alice', age: 30, active: true }, style: { width: '320px' } } } },
    // Chart — recharts Line / Bar / Pie
    { type: 'Chart',          label: 'Chart',           icon: '📊', defaultNode: { type: 'Chart',          props: { chartType: 'bar', style: { width: '340px', height: '260px' } } } },
    // QR Code — qrcode.react SVG output
    { type: 'QRCodeWidget',   label: 'QR Code',         icon: '▦', defaultNode: { type: 'QRCodeWidget',   props: { value: 'https://example.com', size: 160 } } },
    // Markdown viewer — react-markdown with prose styling
    { type: 'MarkdownViewer', label: 'Markdown',        icon: 'M', defaultNode: { type: 'MarkdownViewer', props: { style: { width: '360px' } } } },
    // Google Map — embedded map (placeholder when no apiKey)
    { type: 'GoogleMap',      label: 'Google Map',      icon: '🗺', defaultNode: { type: 'GoogleMap',      props: { lat: 37.7749, lng: -122.4194, zoom: 13, style: { width: '400px', height: '280px' } } } },
    // Google Map Places — autocomplete input with Places API
    { type: 'GoogleMapPlaces', label: 'Places Search',  icon: '📍', defaultNode: { type: 'GoogleMapPlaces', props: { placeholder: 'Search for a place…', style: { width: '320px' } } } },
  ],
  Display: [
    { type: 'Badge',    label: 'Badge',    icon: '🏷', defaultNode: { type: 'Badge', props: { className: 'flex flex-row items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary' }, children: [{ type: 'BadgeText', props: { className: 'text-xs font-medium text-primary-foreground' }, text: 'Badge' }] } },
    { type: 'Avatar',   label: 'Avatar',   icon: '👤', defaultNode: { type: 'Avatar', props: { className: 'w-12 h-12 rounded-full' }, children: [{ type: 'AvatarFallbackText', text: 'AB', props: { className: 'text-sm font-medium text-primary-foreground' } }] } },
    // Spinner — animated loading indicator
    { type: 'Spinner',  label: 'Spinner',  icon: '↺', defaultNode: { type: 'Spinner', props: { size: 'small', color: '#6b7280' } } },
    // Skeleton — placeholder shimmer for loading states
    { type: 'Skeleton', label: 'Skeleton', icon: '░', defaultNode: { type: 'Skeleton', props: { className: 'rounded-md w-full' }, children: [{ type: 'SkeletonText', props: { _lines: 3, className: 'w-full' } }] } },
    // Alert — informational / warning callout — use NavIcon directly (AlertIcon wraps Gluestack UIIcon which needs `as` prop, not children)
    { type: 'Alert',    label: 'Alert',    icon: '⚠', defaultNode: { type: 'Alert', props: { className: 'flex flex-row items-start gap-3 p-4 rounded-md bg-amber-50 border border-amber-200' }, children: [{ type: 'NavIcon', props: { icon: 'AlertCircle', size: 18, color: '#d97706' } }, { type: 'AlertText', text: 'This is an alert message.', props: { className: 'text-sm text-amber-800' } }] } },
  ],
  Overlays: [
    // Modal — Gluestack portal-based overlay; isOpen must be true to render content in builder
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
            props: { className: 'rounded-lg bg-background p-0 w-full max-w-md' },
            children: [
              { type: 'ModalHeader', props: { className: 'p-4 border-b border-border flex flex-row items-center justify-between' }, children: [{ type: 'Text', props: { className: 'text-lg font-semibold text-foreground' }, text: 'Modal Title' }, { type: 'ModalCloseButton', props: {} }] },
              { type: 'ModalBody', props: { className: 'p-4' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Modal body content goes here.' }] },
              { type: 'ModalFooter', props: { className: 'p-4 border-t border-border flex flex-row gap-2 justify-end' }, children: [{ type: 'Pressable', props: { className: 'px-4 py-2 rounded-md border border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Cancel' }] }, { type: 'Pressable', props: { className: 'px-4 py-2 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Confirm' }] }] },
            ],
          },
        ],
      },
    },
    // Tooltip — hover popup label
    {
      type: 'Tooltip',
      label: 'Tooltip',
      icon: '💬',
      defaultNode: {
        type: 'Tooltip',
        props: { isOpen: true, placement: 'top' },
        children: [
          { type: 'Pressable', props: { className: 'px-4 py-2 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm text-primary-foreground' }, text: 'Hover me' }] },
          { type: 'TooltipContent', props: { className: 'bg-gray-900 rounded px-2 py-1' }, children: [{ type: 'TooltipText', props: { className: 'text-xs text-white' }, text: 'Tooltip text' }] },
        ],
      },
    },
    // AlertDialog — confirmation dialog with portal
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
            props: { className: 'rounded-lg bg-background w-full max-w-sm p-0' },
            children: [
              { type: 'AlertDialogHeader', props: { className: 'p-4 border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-lg font-semibold text-foreground' }, text: 'Confirm Action' }] },
              { type: 'AlertDialogBody', props: { className: 'p-4' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Are you sure you want to continue?' }] },
              { type: 'AlertDialogFooter', props: { className: 'p-4 border-t border-border flex flex-row gap-2 justify-end' }, children: [{ type: 'Pressable', props: { className: 'px-4 py-2 rounded-md border border-border' }, children: [{ type: 'Text', props: { className: 'text-sm' }, text: 'Cancel' }] }, { type: 'Pressable', props: { className: 'px-4 py-2 rounded-md bg-destructive' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Delete' }] }] },
            ],
          },
        ],
      },
    },
  ],
};

// ─── Components tab ───────────────────────────────────────────────────────────

export function ComponentsTab() {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
      {/* Search */}
      <div style={{ padding: '0 10px 8px' }}>
        <input
          placeholder="Search components…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 5, color: '#d1d5db', fontSize: 11, padding: '5px 8px', boxSizing: 'border-box' }}
        />
      </div>

      {/* ── Primitive components ── */}
      <SectionHeader label="Primitives" />
      {Object.entries(PRIMITIVE_COMPONENTS).map(([group, items]) => {
        const filtered = items.filter(
          it => !q || it.label.toLowerCase().includes(q) || it.type.toLowerCase().includes(q)
        );
        if (!filtered.length) return null;
        return (
          <div key={group} style={{ marginBottom: 4 }}>
            <div style={{ padding: '4px 12px 2px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              {group}
            </div>
            {filtered.map(p => (
              <DraggablePrimitive key={p.label} primitive={p} />
            ))}
          </div>
        );
      })}

    </div>
  );
}

export function SectionHeader({ label, collapsible, collapsed, onToggle }: { label: string; collapsible?: boolean; collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div
      style={{ padding: '8px 12px 4px', fontSize: 11, color: '#9ca3af', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: collapsible ? 'pointer' : 'default', borderTop: '1px solid #1f2937', marginTop: 4 }}
      onClick={onToggle}
    >
      <span>{label}</span>
      {collapsible && <Chevron open={!collapsed} size={10} />}
    </div>
  );
}

export function DraggablePrimitive({ primitive }: { primitive: { type: string; label: string; icon: string; defaultNode: object } }) {
  return (
    <div
      draggable
      onDragStart={e => {
        const data = JSON.stringify(primitive.defaultNode);
        e.dataTransfer.setData('text/primitive-node', data);
        e.dataTransfer.effectAllowed = 'copy';
        // Fallback for CDP-simulated drags (e.g. Playwright headless) where
        // subsequent dragover/drop events may receive an empty dataTransfer.
        (window as unknown as Record<string, unknown>).__primitiveDrag = data;
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        cursor: 'grab',
        borderRadius: 4,
        margin: '1px 4px',
        userSelect: 'none',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ width: 36, height: 24, background: '#1f2937', borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#9ca3af', border: '1px solid #374151' }}>
        {primitive.icon}
      </div>
      <span style={{ fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {primitive.label}
      </span>
    </div>
  );
}

