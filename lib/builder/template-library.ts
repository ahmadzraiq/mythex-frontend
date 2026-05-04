/**
 * Template Library — a hardcoded catalogue of importable shared component templates.
 *
 * Each item's `definition` matches Omit<SharedComponentModel, 'id'> so it can be
 * passed directly to `createSharedComponent` after supplying a fresh id.
 */

import type { SharedComponentModel, SharedComponentProperty } from '@/config/shared-component-types';

export type TemplateCategory =
  | 'Layout'
  | 'Typography'
  | 'Form inputs'
  | 'Navigation'
  | 'Feedback'
  | 'Composite'
  | 'Overlays';

export interface TemplateLibraryItem {
  /** Stable template identifier — used to detect already-imported templates. */
  id: string;
  name: string;
  category: TemplateCategory;
  /** Emoji or short label used as the visual icon in the library grid. */
  icon: string;
  description?: string;
  /** The component variable name that represents this template's "value" (used by FormContainer). */
  valueVariable?: string;
  definition: Omit<SharedComponentModel, 'id'>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prop(
  id: string,
  name: string,
  type: SharedComponentProperty['type'],
  defaultValue?: unknown,
  options?: Array<{ label: string; value: string }>,
): SharedComponentProperty {
  return { id, name, type, defaultValue, ...(options ? { options } : {}) };
}

// ─── Template Catalogue ───────────────────────────────────────────────────────

export const TEMPLATE_LIBRARY: TemplateLibraryItem[] = [
  // ── Layout ─────────────────────────────────────────────────────────────────

  {
    id: 'tpl-row',
    name: 'Row',
    category: 'Layout',
    icon: '↔',
    description: 'Horizontal flex container with configurable gap.',
    definition: {
      name: 'Row',
      description: 'Horizontal row layout.',
      properties: [
        prop('p-row-gap', 'gap', 'select', '2', [
          { label: 'None', value: '0' },
          { label: 'XS (1)', value: '1' },
          { label: 'SM (2)', value: '2' },
          { label: 'MD (4)', value: '4' },
          { label: 'LG (6)', value: '6' },
          { label: 'XL (8)', value: '8' },
        ]),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-2 w-full' },
        children: [],
      },
    },
  },

  {
    id: 'tpl-card',
    name: 'Card',
    category: 'Layout',
    icon: '▭',
    description: 'Card with padding, border, and optional shadow.',
    definition: {
      name: 'Card',
      description: 'Content card container.',
      properties: [
        prop('p-card-title', 'title', 'text', 'Card Title'),
        prop('p-card-body', 'body', 'text', 'Card body text goes here.'),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-3 p-5 rounded-xl border border-gray-200 bg-white shadow-sm w-full' },
        children: [
          {
            type: 'Text',
            text: '{{context.component.props.title}}',
            props: { className: 'text-base font-semibold text-gray-900' },
          },
          {
            type: 'Text',
            text: '{{context.component.props.body}}',
            props: { className: 'text-sm text-gray-500 leading-relaxed' },
          },
        ],
      },
    },
  },

  {
    id: 'tpl-stack',
    name: 'Stack',
    category: 'Layout',
    icon: '☰',
    description: 'Vertical stack with spacing.',
    definition: {
      name: 'Stack',
      description: 'Vertical flex stack.',
      properties: [
        prop('p-stack-gap', 'gap', 'select', '4', [
          { label: 'None', value: '0' },
          { label: 'XS (1)', value: '1' },
          { label: 'SM (2)', value: '2' },
          { label: 'MD (4)', value: '4' },
          { label: 'LG (6)', value: '6' },
        ]),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-4 w-full' },
        children: [],
      },
    },
  },

  // ── Typography ─────────────────────────────────────────────────────────────

  {
    id: 'tpl-heading',
    name: 'Heading',
    category: 'Typography',
    icon: 'H',
    description: 'Bold heading with configurable size.',
    definition: {
      name: 'Heading',
      description: 'Section heading.',
      properties: [
        prop('p-heading-text', 'text', 'text', 'Heading'),
        prop('p-heading-size', 'size', 'select', '2xl', [
          { label: 'XL', value: 'xl' },
          { label: '2XL', value: '2xl' },
          { label: '3XL', value: '3xl' },
          { label: '4XL', value: '4xl' },
        ]),
      ],
      content: {
        type: 'Text',
        text: '{{context.component.props.text}}',
        props: { className: 'text-2xl font-bold text-gray-900 leading-tight' },
      },
    },
  },

  {
    id: 'tpl-label',
    name: 'Label',
    category: 'Typography',
    icon: 'T',
    description: 'Small all-caps label.',
    definition: {
      name: 'Label',
      description: 'Field or section label.',
      properties: [
        prop('p-label-text', 'text', 'text', 'Label'),
        prop('p-label-color', 'color', 'color', '#6b7280'),
      ],
      content: {
        type: 'Text',
        text: '{{context.component.props.text}}',
        props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-widest' },
      },
    },
  },

  {
    id: 'tpl-paragraph',
    name: 'Paragraph',
    category: 'Typography',
    icon: '¶',
    description: 'Body paragraph text.',
    definition: {
      name: 'Paragraph',
      description: 'Body text block.',
      properties: [
        prop('p-para-text', 'text', 'text', 'Enter your text here.'),
      ],
      content: {
        type: 'Text',
        text: '{{context.component.props.text}}',
        props: { className: 'text-sm text-gray-700 leading-relaxed' },
      },
    },
  },

  // ── Form inputs ────────────────────────────────────────────────────────────

  {
    id: 'tpl-button',
    name: 'Button',
    category: 'Form inputs',
    icon: '⏎',
    description: 'Primary button with label and variant.',
    definition: {
      name: 'Button',
      description: 'Clickable button element.',
      properties: [
        prop('p-btn-label', 'label', 'text', 'Button'),
        prop('p-btn-variant', 'variant', 'select', 'solid', [
          { label: 'Solid', value: 'solid' },
          { label: 'Outline', value: 'outline' },
          { label: 'Ghost', value: 'ghost' },
        ]),
      ],
      content: {
        type: 'Box',
        props: { className: 'bg-primary-500 rounded-lg px-4 py-2 flex flex-row items-center justify-center cursor-pointer select-none' },
        children: [
          {
            type: 'Text',
            text: '{{context.component.props.label}}',
            props: { className: 'text-white font-semibold text-sm' },
          },
        ],
      },
    },
  },

  {
    id: 'tpl-icon-button',
    name: 'Icon Button',
    category: 'Form inputs',
    icon: '⊕',
    description: 'Square button with an icon.',
    definition: {
      name: 'Icon Button',
      description: 'A round / square icon-only button.',
      properties: [
        prop('p-ibtn-icon', 'icon', 'icon', 'lucide:plus'),
        prop('p-ibtn-size', 'size', 'select', 'md', [
          { label: 'SM', value: 'sm' },
          { label: 'MD', value: 'md' },
          { label: 'LG', value: 'lg' },
        ]),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex items-center justify-center w-[40px] h-[40px] rounded-[8px] bg-[var(--theme-primary)] cursor-pointer' },
        children: [
          {
            type: 'Icon',
            props: { icon: '{{context.component.props.icon}}', size: 20, color: 'var(--theme-primary-foreground)' },
          },
        ],
      },
    },
  },

  // ── Navigation ─────────────────────────────────────────────────────────────

  {
    id: 'tpl-divider',
    name: 'Divider',
    category: 'Navigation',
    icon: '—',
    description: 'Horizontal separator line.',
    definition: {
      name: 'Divider',
      description: 'Horizontal divider / separator.',
      properties: [],
      content: {
        type: 'Box',
        props: { className: 'w-full h-px bg-gray-200 my-2' },
        children: [],
      },
    },
  },

  {
    id: 'tpl-breadcrumb',
    name: 'Breadcrumb',
    category: 'Navigation',
    icon: '›',
    description: 'Two-level breadcrumb trail.',
    definition: {
      name: 'Breadcrumb',
      description: 'Navigation breadcrumb.',
      properties: [
        prop('p-bc-parent', 'parent', 'text', 'Home'),
        prop('p-bc-current', 'current', 'text', 'Page'),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-1' },
        children: [
          {
            type: 'Text',
            text: '{{context.component.props.parent}}',
            props: { className: 'text-sm text-blue-600 cursor-pointer hover:underline' },
          },
          {
            type: 'Text',
            text: '›',
            props: { className: 'text-sm text-gray-400' },
          },
          {
            type: 'Text',
            text: '{{context.component.props.current}}',
            props: { className: 'text-sm text-gray-500' },
          },
        ],
      },
    },
  },

  // ── Feedback ───────────────────────────────────────────────────────────────

  {
    id: 'tpl-badge',
    name: 'Badge',
    category: 'Feedback',
    icon: '●',
    description: 'Pill badge with configurable text.',
    definition: {
      name: 'Badge',
      description: 'Status or count badge.',
      properties: [
        prop('p-badge-text', 'text', 'text', 'Badge'),
        prop('p-badge-color', 'color', 'select', 'blue', [
          { label: 'Blue', value: 'blue' },
          { label: 'Green', value: 'green' },
          { label: 'Red', value: 'red' },
          { label: 'Yellow', value: 'yellow' },
          { label: 'Gray', value: 'gray' },
        ]),
      ],
      content: {
        type: 'Box',
        props: { className: 'inline-flex items-center px-[10px] py-[2px] rounded-[9999px] bg-[color-mix(in_srgb,var(--theme-primary)_10%,transparent)] w-fit' },
        children: [
          {
            type: 'Text',
            text: '{{context.component.props.text}}',
            props: { className: 'text-xs font-semibold text-blue-700' },
          },
        ],
      },
    },
  },

  {
    id: 'tpl-alert',
    name: 'Alert',
    category: 'Feedback',
    icon: '⚠',
    description: 'Inline alert / banner message.',
    definition: {
      name: 'Alert',
      description: 'Alert or informational banner.',
      properties: [
        prop('p-alert-title', 'title', 'text', 'Heads up!'),
        prop('p-alert-message', 'message', 'text', 'Something important happened.'),
        prop('p-alert-type', 'type', 'select', 'info', [
          { label: 'Info', value: 'info' },
          { label: 'Success', value: 'success' },
          { label: 'Warning', value: 'warning' },
          { label: 'Error', value: 'error' },
        ]),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-start gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200 w-full' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-col gap-1 flex-1' },
            children: [
              {
                type: 'Text',
                text: '{{context.component.props.title}}',
                props: { className: 'text-sm font-semibold text-blue-800' },
              },
              {
                type: 'Text',
                text: '{{context.component.props.message}}',
                props: { className: 'text-sm text-blue-700' },
              },
            ],
          },
        ],
      },
    },
  },

  // ── Composite ──────────────────────────────────────────────────────────────

  {
    id: 'tpl-list-item',
    name: 'List Item',
    category: 'Composite',
    icon: '≡',
    description: 'Row with icon, title, and subtitle.',
    definition: {
      name: 'List Item',
      description: 'List row with leading icon.',
      properties: [
        prop('p-li-icon', 'icon', 'icon', 'lucide:user'),
        prop('p-li-title', 'title', 'text', 'Item Title'),
        prop('p-li-subtitle', 'subtitle', 'text', 'Secondary text'),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-3 px-4 py-3 w-full border-b border-gray-100' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 flex-shrink-0' },
            children: [
              {
                type: 'Icon',
                props: { name: '{{context.component.props.icon}}', className: 'w-4 h-4 text-gray-600' },
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-col gap-0.5 flex-1 min-w-0' },
            children: [
              {
                type: 'Text',
                text: '{{context.component.props.title}}',
                props: { className: 'text-sm font-medium text-gray-900 truncate' },
              },
              {
                type: 'Text',
                text: '{{context.component.props.subtitle}}',
                props: { className: 'text-xs text-gray-500 truncate' },
              },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-stat-card',
    name: 'Stat Card',
    category: 'Composite',
    icon: '📊',
    description: 'Metric display with label and value.',
    definition: {
      name: 'Stat Card',
      description: 'Key metric or KPI card.',
      properties: [
        prop('p-stat-label', 'label', 'text', 'Total Users'),
        prop('p-stat-value', 'value', 'text', '12,345'),
        prop('p-stat-change', 'change', 'text', '+12%'),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-1 p-5 rounded-xl border border-gray-200 bg-white shadow-sm' },
        children: [
          {
            type: 'Text',
            text: '{{context.component.props.label}}',
            props: { className: 'text-xs font-semibold text-gray-500 uppercase tracking-wider' },
          },
          {
            type: 'Text',
            text: '{{context.component.props.value}}',
            props: { className: 'text-3xl font-bold text-gray-900' },
          },
          {
            type: 'Text',
            text: '{{context.component.props.change}}',
            props: { className: 'text-sm font-medium text-green-600' },
          },
        ],
      },
    },
  },

  // ── Overlays ───────────────────────────────────────────────────────────────

  {
    id: 'tpl-tooltip',
    name: 'Tooltip',
    category: 'Overlays',
    icon: '💬',
    description: 'Hover trigger with floating tooltip bubble.',
    definition: {
      name: 'Tooltip',
      description: 'Hover trigger with floating tooltip bubble.',
      properties: [
        prop('p-tooltip-trigger', 'triggerLabel', 'text', 'Hover me'),
        prop('p-tooltip-text', 'text', 'text', 'Tooltip text'),
      ],
      content: {
        type: 'Box',
        popover: { trigger: 'hover', placement: 'top', offset: 6, openVariable: 'tip-open' },
        props: { className: 'inline-flex' },
        variables: {
          'tip-open': { label: 'Visible', type: 'boolean', initialValue: false },
        },
        children: [
          {
            type: 'Box',
            props: { className: 'inline-flex items-center justify-center px-[12px] h-[34px] rounded-[6px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-default select-none' },
            children: [{ type: 'Text', text: '{{context.component.props.triggerLabel}}', props: { className: 'text-[13px] text-[var(--theme-foreground)]' } }],
          },
          {
            type: 'Box',
            _popoverContent: true,
            props: { className: 'inline-flex items-center px-[10px] py-[5px] rounded-[6px] bg-[var(--theme-foreground)] shadow-lg' },
            children: [{ type: 'Text', text: '{{context.component.props.text}}', props: { className: 'text-[12px] text-[var(--theme-background)] whitespace-nowrap' } }],
          },
        ],
      },
    },
  },

  // ── Form inputs (continued) ────────────────────────────────────────────────

  {
    id: 'tpl-input-field',
    name: 'Input Field',
    category: 'Form inputs',
    icon: '▭',
    description: 'Labeled input field with border styling.',
    definition: {
      name: 'Input Field',
      description: 'Text input with label.',
      properties: [
        prop('p-if-label', 'label', 'text', 'Email'),
        prop('p-if-placeholder', 'placeholder', 'text', 'Enter your email'),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[6px] w-full' },
        children: [
          {
            type: 'Text',
            text: '{{context.component.props.label}}',
            props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' },
          },
          {
            type: 'Input',
            props: {
              placeholder: '{{context.component.props.placeholder}}',
              className: 'w-full h-[40px] px-[12px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] text-[14px] text-[var(--theme-foreground)]',
            },
          },
        ],
      },
    },
  },

  {
    id: 'tpl-textarea-field',
    name: 'Textarea Field',
    category: 'Form inputs',
    icon: '≡',
    description: 'Labeled multi-line textarea.',
    definition: {
      name: 'Textarea Field',
      description: 'Multi-line textarea with label.',
      properties: [
        prop('p-ta-label', 'label', 'text', 'Message'),
        prop('p-ta-placeholder', 'placeholder', 'text', 'Write your message…'),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[6px] w-full' },
        children: [
          {
            type: 'Text',
            text: '{{context.component.props.label}}',
            props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' },
          },
          {
            type: 'Textarea',
            props: {
              placeholder: '{{context.component.props.placeholder}}',
              className: 'w-full min-h-[100px] px-[12px] py-[10px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] text-[14px] text-[var(--theme-foreground)] resize-none',
            },
          },
        ],
      },
    },
  },

  {
    id: 'tpl-checkbox',
    name: 'Checkbox',
    category: 'Form inputs',
    icon: '☑',
    description: 'Checkbox with label. Variable tracks checked state.',
    valueVariable: 'cb-checked',
    definition: {
      name: 'Checkbox',
      description: 'Checkbox with label.',
      properties: [
        prop('p-cb-label', 'label', 'text', 'Accept terms'),
      ],
      variables: {
        'cb-checked': { label: 'Checked', type: 'boolean', initialValue: false },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-[10px] cursor-pointer' },
        actions: [
          {
            trigger: 'click',
            steps: [{ id: 'cb-toggle', type: 'changeVariableValue', config: { variableName: 'cb-checked', value: { formula: "!(context?.component?.variables?.['cb-checked'] ?? false)" } } }],
          },
        ],
        children: [
          {
            type: 'Box',
            props: {
              className: 'w-[18px] h-[18px] rounded-[4px] border-2 flex items-center justify-center flex-shrink-0',
              style: {
                borderColor: { formula: "context?.component?.variables?.['cb-checked'] ? 'var(--theme-primary)' : 'var(--theme-border)'" },
                backgroundColor: { formula: "context?.component?.variables?.['cb-checked'] ? 'var(--theme-primary)' : 'var(--theme-card)'" },
              },
            },
            children: [
              {
                type: 'Icon',
                props: { icon: 'lucide:check', size: 12, color: { formula: "context?.component?.variables?.['cb-checked'] ? 'var(--theme-primary-foreground)' : 'transparent'" } },
              },
            ],
          },
          {
            type: 'Text',
            text: '{{context.component.props.label}}',
            props: { className: 'text-[14px] text-[var(--theme-foreground)]' },
          },
        ],
      },
    },
  },

  {
    id: 'tpl-switch',
    name: 'Switch',
    category: 'Form inputs',
    icon: '⏸',
    valueVariable: 'sw-on',
    description: 'Toggle switch with label. Variable tracks on/off state.',
    definition: {
      name: 'Switch',
      description: 'Toggle switch.',
      properties: [
        prop('p-sw-label', 'label', 'text', 'Enable notifications'),
      ],
      variables: {
        'sw-on': { label: 'On', type: 'boolean', initialValue: false },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-[10px]' },
        children: [
          {
            type: 'Text',
            text: '{{context.component.props.label}}',
            props: { className: 'text-[14px] text-[var(--theme-foreground)]' },
          },
          {
            type: 'Box',
            props: {
              className: 'relative w-[48px] h-[26px] rounded-[13px] cursor-pointer flex-shrink-0',
              style: { backgroundColor: { formula: "context?.component?.variables?.['sw-on'] ? 'var(--theme-primary)' : 'var(--theme-muted)'" } },
            },
            actions: [
              {
                trigger: 'click',
                steps: [{ id: 'sw-toggle', type: 'changeVariableValue', config: { variableName: 'sw-on', value: { formula: "!(context?.component?.variables?.['sw-on'] ?? false)" } } }],
              },
            ],
            children: [
              {
                type: 'Box',
                props: {
                  className: 'absolute left-[2px] top-[2px] w-[22px] h-[22px] rounded-[11px] bg-white shadow-sm transition-transform duration-150',
                  style: { transform: { formula: "context?.component?.variables?.['sw-on'] ? 'translateX(22px)' : 'translateX(0px)'" } },
                },
              },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-radio-group',
    name: 'Radio Group',
    category: 'Form inputs',
    icon: '◉',
    valueVariable: 'rg-value',
    description: 'Radio button group with 3 options. Variable tracks selected value.',
    definition: {
      name: 'Radio Group',
      description: 'Radio button selection.',
      properties: [
        prop('p-rg-a', 'optionA', 'text', 'Option A'),
        prop('p-rg-b', 'optionB', 'text', 'Option B'),
        prop('p-rg-c', 'optionC', 'text', 'Option C'),
      ],
      variables: {
        'rg-value': { label: 'Selected value', type: 'string', initialValue: 'option-a' },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[10px] w-full' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center gap-[10px] cursor-pointer' },
            actions: [{ trigger: 'click', steps: [{ id: 'sel-a', type: 'changeVariableValue', config: { variableName: 'rg-value', value: 'option-a' } }] }],
            children: [
              {
                type: 'Box',
                props: {
                  className: 'w-[18px] h-[18px] rounded-[9px] border-2 flex items-center justify-center flex-shrink-0',
                  style: { borderColor: { formula: "context?.component?.variables?.['rg-value'] === 'option-a' ? 'var(--theme-primary)' : 'var(--theme-border)'" } },
                },
                children: [
                  { type: 'Box', condition: "context?.component?.variables?.['rg-value'] === 'option-a'", props: { className: 'w-[8px] h-[8px] rounded-full bg-[var(--theme-primary)]' } },
                ],
              },
              { type: 'Text', text: '{{context.component.props.optionA}}', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center gap-[10px] cursor-pointer' },
            actions: [{ trigger: 'click', steps: [{ id: 'sel-b', type: 'changeVariableValue', config: { variableName: 'rg-value', value: 'option-b' } }] }],
            children: [
              {
                type: 'Box',
                props: {
                  className: 'w-[18px] h-[18px] rounded-[9px] border-2 flex items-center justify-center flex-shrink-0',
                  style: { borderColor: { formula: "context?.component?.variables?.['rg-value'] === 'option-b' ? 'var(--theme-primary)' : 'var(--theme-border)'" } },
                },
                children: [
                  { type: 'Box', condition: "context?.component?.variables?.['rg-value'] === 'option-b'", props: { className: 'w-[8px] h-[8px] rounded-full bg-[var(--theme-primary)]' } },
                ],
              },
              { type: 'Text', text: '{{context.component.props.optionB}}', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center gap-[10px] cursor-pointer' },
            actions: [{ trigger: 'click', steps: [{ id: 'sel-c', type: 'changeVariableValue', config: { variableName: 'rg-value', value: 'option-c' } }] }],
            children: [
              {
                type: 'Box',
                props: {
                  className: 'w-[18px] h-[18px] rounded-[9px] border-2 flex items-center justify-center flex-shrink-0',
                  style: { borderColor: { formula: "context?.component?.variables?.['rg-value'] === 'option-c' ? 'var(--theme-primary)' : 'var(--theme-border)'" } },
                },
                children: [
                  { type: 'Box', condition: "context?.component?.variables?.['rg-value'] === 'option-c'", props: { className: 'w-[8px] h-[8px] rounded-full bg-[var(--theme-primary)]' } },
                ],
              },
              { type: 'Text', text: '{{context.component.props.optionC}}', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-select',
    name: 'Select',
    category: 'Form inputs',
    icon: '▽',
    valueVariable: 'sel-value',
    description: 'Dropdown select with popover option list.',
    definition: {
      name: 'Select',
      description: 'Dropdown select with popover option list.',
      properties: [
        prop('p-sel-label', 'label', 'text', 'Country'),
        prop('p-sel-placeholder', 'placeholder', 'text', 'Select an option'),
        prop('p-sel-options', 'options', 'text', 'Option 1,Option 2,Option 3'),
      ],
      variables: {
        'sel-open': { label: 'Open', type: 'boolean', initialValue: false },
        'sel-value': { label: 'Selected value', type: 'string', initialValue: '' },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[6px] w-full' },
        children: [
          { type: 'Text', text: '{{context.component.props.label}}', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' } },
          {
            type: 'Box',
            popover: { trigger: 'click', placement: 'bottom-start', offset: 4, openVariable: 'sel-open', matchTriggerWidth: true },
            props: { className: 'flex flex-row items-center justify-between w-full h-[40px] px-[12px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer' },
            children: [
              { type: 'Text', text: { formula: "context?.component?.variables?.['sel-value'] || context?.component?.props?.placeholder || 'Select an option'" }, props: { className: { formula: "context?.component?.variables?.['sel-value'] ? 'text-[14px] text-[var(--theme-foreground)]' : 'text-[14px] text-[var(--theme-muted-foreground)]'" } } },
              { type: 'Icon', props: { icon: 'lucide:chevron-down', size: 16, color: 'var(--theme-muted-foreground)' } },
              {
                type: 'Box',
                _popoverContent: true,
                props: { className: 'w-full min-w-0 bg-[var(--theme-card)] rounded-[8px] border border-[var(--theme-border)] py-[4px] shadow-lg overflow-hidden' },
                children: [
                  {
                    type: 'Box',
                    map: { formula: "(context?.component?.props?.options || 'Option 1,Option 2,Option 3').split(',').map((o,i)=>({label:o.trim(),idx:i}))" },
                    key: 'context.item.data.idx',
                    props: { className: 'contents' },
                    children: [
                      {
                        type: 'Box',
                        props: { className: { formula: "context?.component?.variables?.['sel-value'] === context?.item?.data?.label ? 'flex flex-row items-center gap-[8px] px-[12px] h-[36px] cursor-pointer bg-[color-mix(in_srgb,var(--theme-primary)_10%,transparent)]' : 'flex flex-row items-center gap-[8px] px-[12px] h-[36px] cursor-pointer hover:bg-[var(--theme-muted)]'" } },
                        actions: [{ trigger: 'click', steps: [
                          { id: 'sv', type: 'changeVariableValue', config: { variableName: 'sel-value', value: { formula: "context?.item?.data?.label" } } },
                          { id: 'cl', type: 'changeVariableValue', config: { variableName: 'sel-open', value: false } },
                        ] }],
                        children: [
                          { type: 'Text', text: '{{context.item.data.label}}', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-datepicker',
    name: 'Date Picker',
    category: 'Form inputs',
    icon: '📅',
    valueVariable: 'dp-v-selected',
    description: 'Calendar popover date picker with month navigation and typed input.',
    definition: {
      name: 'Date Picker',
      description: 'Calendar popover date picker with month navigation.',
      properties: [
        prop('p-dp-label',  'label',  'text', 'Date'),
        prop('p-dp-format', 'format', 'text', '####-##-##'),
      ],
      variables: {
        'dp-v-year':     { label: 'year',         type: 'number',  initialValue: 2026 },
        'dp-v-month':    { label: 'month (0-11)', type: 'number',  initialValue: 3 },
        'dp-v-selected': { label: 'selectedDate', type: 'string',  initialValue: '' },
        'dp-v-open':     { label: 'isOpen',       type: 'boolean', initialValue: false },
      },
      triggers: [
        { id: 'dp-t-on-date-selected', name: 'On date selected', payload: { formula: "{ date: context?.component?.variables?.['dp-v-selected'] ?? '' }" } },
      ],
      workflows: {
        'dp-wf-prev-month': {
          id: 'dp-wf-prev-month', name: 'Previous Month', trigger: 'click', params: [],
          steps: [
            { id: 'py', type: 'changeVariableValue', config: { variableName: 'dp-v-year',  value: { formula: "(context?.component?.variables?.['dp-v-month'] ?? 0) === 0 ? (context?.component?.variables?.['dp-v-year'] ?? 2026) - 1 : (context?.component?.variables?.['dp-v-year'] ?? 2026)" } } },
            { id: 'pm', type: 'changeVariableValue', config: { variableName: 'dp-v-month', value: { formula: "(context?.component?.variables?.['dp-v-month'] ?? 0) === 0 ? 11 : (context?.component?.variables?.['dp-v-month'] ?? 0) - 1" } } },
          ],
        },
        'dp-wf-next-month': {
          id: 'dp-wf-next-month', name: 'Next Month', trigger: 'click', params: [],
          steps: [
            { id: 'ny', type: 'changeVariableValue', config: { variableName: 'dp-v-year',  value: { formula: "(context?.component?.variables?.['dp-v-month'] ?? 0) === 11 ? (context?.component?.variables?.['dp-v-year'] ?? 2026) + 1 : (context?.component?.variables?.['dp-v-year'] ?? 2026)" } } },
            { id: 'nm', type: 'changeVariableValue', config: { variableName: 'dp-v-month', value: { formula: "(context?.component?.variables?.['dp-v-month'] ?? 0) === 11 ? 0 : (context?.component?.variables?.['dp-v-month'] ?? 0) + 1" } } },
          ],
        },
        'dp-wf-select-day': {
          id: 'dp-wf-select-day', name: 'Select Day', trigger: 'click', params: [],
          steps: [
            { id: 'sd',   type: 'changeVariableValue',  config: { variableName: 'dp-v-selected', value: { formula: "context?.item?.data?.dateStr" } } },
            { id: 'cl',   type: 'changeVariableValue',  config: { variableName: 'dp-v-open',     value: false } },
            { id: 'emit', type: 'emitComponentTrigger', config: { triggerId: 'dp-t-on-date-selected' } },
          ],
        },
        'dp-wf-today': {
          id: 'dp-wf-today', name: 'Go To Today', trigger: 'click', params: [],
          steps: [
            { id: 'ty', type: 'changeVariableValue', config: { variableName: 'dp-v-year',     value: { formula: "new Date().getFullYear()" } } },
            { id: 'tm', type: 'changeVariableValue', config: { variableName: 'dp-v-month',    value: { formula: "new Date().getMonth()" } } },
            { id: 'ts', type: 'changeVariableValue', config: { variableName: 'dp-v-selected', value: { formula: "new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0')" } } },
          ],
        },
        'dp-wf-clear': {
          id: 'dp-wf-clear', name: 'Clear Selection', trigger: 'click', params: [],
          steps: [
            { id: 'cs', type: 'changeVariableValue', config: { variableName: 'dp-v-selected', value: '' } },
          ],
        },
        'dp-wf-set-typed': {
          id: 'dp-wf-set-typed', name: 'Set typed date', trigger: 'change', params: [],
          steps: [
            { id: 's1', type: 'changeVariableValue', config: { variableName: 'dp-v-selected', value: { formula: "event?.value ?? event?.text ?? (typeof event === 'string' ? event : '')" } } },
          ],
        },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[6px] w-full' },
        children: [
          { type: 'Text', text: '{{context.component.props.label}}', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' } },
          {
            type: 'Box',
            popover: { trigger: 'click', placement: 'bottom-start', offset: 6, openVariable: 'dp-v-open' },
            props: { className: 'inline-flex flex-row items-center gap-[8px] px-[12px] h-[40px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer w-full' },
            children: [
              { type: 'Icon', props: { icon: 'lucide:calendar', size: 16, color: 'var(--theme-muted-foreground)' } },
              {
                type: 'Input',
                props: {
                  value: { formula: "context?.component?.variables?.['dp-v-selected'] ?? ''" },
                  format: '{{context.component.props.format}}',
                  placeholder: '{{context.component.props.format}}',
                  className: 'flex-1 border-0 bg-transparent outline-none shadow-none text-[14px] h-auto p-0 min-h-0',
                },
                actions: [{ trigger: 'change', action: 'dp-wf-set-typed' }],
              },
              {
                type: 'Box',
                _popoverContent: true,
                props: { className: 'w-[280px] bg-[var(--theme-card)] rounded-[12px] border border-[var(--theme-border)] p-[12px] shadow-lg' },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'flex flex-row items-center justify-between px-[4px] pb-[8px]' },
                    children: [
                      { type: 'Box', props: { className: 'w-[28px] h-[28px] flex items-center justify-center rounded-full cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ action: 'dp-wf-prev-month' }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 14, color: 'var(--theme-muted-foreground)' } }] },
                      { type: 'Text', text: { formula: "['January','February','March','April','May','June','July','August','September','October','November','December'][context?.component?.variables?.['dp-v-month'] ?? 0] + ' ' + (context?.component?.variables?.['dp-v-year'] ?? 2026)" }, props: { className: 'text-[13px] font-semibold text-[var(--theme-foreground)]' } },
                      { type: 'Box', props: { className: 'w-[28px] h-[28px] flex items-center justify-center rounded-full cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ action: 'dp-wf-next-month' }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 14, color: 'var(--theme-muted-foreground)' } }] },
                    ],
                  },
                  {
                    type: 'Box',
                    props: { className: 'grid grid-cols-7 mb-[4px]' },
                    children: ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => ({ type: 'Text', props: { className: 'text-[10px] font-semibold text-[var(--theme-muted-foreground)] text-center py-[4px]' }, text: d })),
                  },
                  {
                    type: 'Box',
                    props: { className: 'grid grid-cols-7' },
                    children: [{
                      type: 'Box',
                      map: { formula: "Array.from({length:42},(_,i)=>{const yr=context?.component?.variables?.['dp-v-year']??2026;const mo=context?.component?.variables?.['dp-v-month']??0;const fd=new Date(yr,mo,1).getDay();const dim=new Date(yr,mo+1,0).getDate();const dn=i-fd+1;const inM=dn>=1&&dn<=dim;const d=dn<1?new Date(yr,mo,0).getDate()+dn:(dn>dim?dn-dim:dn);const ds=inM?yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'):'';const today=new Date();const tStr=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');const sel=context?.component?.variables?.['dp-v-selected']||'';return{day:d,inMonth:inM,dateStr:ds,isToday:ds===tStr,isSelected:ds===sel&&ds.length>0,idx:i}})" },
                      key: 'context.item.data.idx',
                      props: { className: 'contents' },
                      children: [
                        { type: 'Box', condition: "context?.item?.data?.inMonth && context?.item?.data?.isSelected",                                     props: { className: 'flex items-center justify-center w-[36px] h-[36px] cursor-pointer rounded-full bg-[var(--theme-primary)]' },                                  actions: [{ action: 'dp-wf-select-day' }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-primary-foreground)] font-semibold' } }] },
                        { type: 'Box', condition: "context?.item?.data?.inMonth && !context?.item?.data?.isSelected && context?.item?.data?.isToday",     props: { className: 'flex items-center justify-center w-[36px] h-[36px] cursor-pointer rounded-full border-2 border-[var(--theme-primary)]' },      actions: [{ action: 'dp-wf-select-day' }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] font-semibold text-[var(--theme-foreground)]' } }] },
                        { type: 'Box', condition: "context?.item?.data?.inMonth && !context?.item?.data?.isSelected && !context?.item?.data?.isToday",    props: { className: 'flex items-center justify-center w-[36px] h-[36px] cursor-pointer rounded-full hover:bg-[var(--theme-muted)]' },             actions: [{ action: 'dp-wf-select-day' }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-foreground)]' } }] },
                        { type: 'Box', condition: "!context?.item?.data?.inMonth",                                                                        props: { className: 'flex items-center justify-center w-[36px] h-[36px]' },                                                                           children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-muted-foreground)] opacity-30' } }] },
                      ],
                    }],
                  },
                  {
                    type: 'Box',
                    props: { className: 'flex flex-row gap-[6px] pt-[10px] mt-[4px] border-t border-[var(--theme-border)]' },
                    children: [
                      { type: 'Box', props: { className: 'flex items-center justify-center px-[10px] py-[5px] rounded-[6px] cursor-pointer border border-[var(--theme-border)] hover:bg-[var(--theme-muted)]' }, actions: [{ action: 'dp-wf-today' }], children: [{ type: 'Text', props: { className: 'text-[11px] font-semibold text-[var(--theme-foreground)]' }, text: 'Today' }] },
                      { type: 'Box', props: { className: 'flex items-center justify-center px-[10px] py-[5px] rounded-[6px] cursor-pointer border border-[var(--theme-border)] hover:bg-[var(--theme-muted)]' }, actions: [{ action: 'dp-wf-clear' }],  children: [{ type: 'Text', props: { className: 'text-[11px] font-semibold text-[var(--theme-foreground)]' }, text: 'Clear' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-timepicker',
    name: 'Time Picker',
    category: 'Form inputs',
    icon: '🕐',
    valueVariable: 'tm-v-time',
    description: 'Time picker with hour/minute spinner controls.',
    definition: {
      name: 'Time Picker',
      description: 'Time picker with hour/minute spinner controls.',
      properties: [
        prop('p-tm-label', 'label', 'text', 'Time'),
      ],
      variables: {
        'tm-v-hour': { label: 'hour', type: 'number', initialValue: 12 },
        'tm-v-minute': { label: 'minute', type: 'number', initialValue: 0 },
        'tm-v-time': { label: 'selectedTime', type: 'string', initialValue: '12:00' },
        'tm-v-open': { label: 'isOpen', type: 'boolean', initialValue: false },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[6px] w-full' },
        children: [
          { type: 'Text', text: '{{context.component.props.label}}', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' } },
          {
            type: 'Box',
            popover: { trigger: 'click', placement: 'bottom-start', offset: 6, openVariable: 'tm-v-open' },
            props: { className: 'inline-flex flex-row items-center gap-[8px] px-[12px] h-[40px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer w-full' },
            children: [
              { type: 'Icon', props: { icon: 'lucide:clock', size: 16, color: 'var(--theme-muted-foreground)' } },
              { type: 'Text', text: { formula: "context?.component?.variables?.['tm-v-time'] || 'Pick a time'" }, props: { className: 'text-[14px] flex-1 text-[var(--theme-muted-foreground)]' } },
              {
                type: 'Box',
                _popoverContent: true,
                props: { className: 'w-[220px] bg-[var(--theme-card)] rounded-[12px] border border-[var(--theme-border)] p-[16px] shadow-lg flex flex-col gap-[12px]' },
                children: [
                  { type: 'Text', text: 'Select Time', props: { className: 'text-[13px] font-semibold text-[var(--theme-foreground)] text-center' } },
                  {
                    type: 'Box',
                    props: { className: 'flex flex-row items-center justify-center gap-[8px]' },
                    children: [
                      {
                        type: 'Box',
                        props: { className: 'flex flex-col items-center gap-[4px]' },
                        children: [
                          { type: 'Box', props: { className: 'flex items-center justify-center w-[36px] h-[28px] rounded-[6px] border border-[var(--theme-border)] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'hu', type: 'changeVariableValue', config: { variableName: 'tm-v-hour', value: { formula: "((context?.component?.variables?.['tm-v-hour']??12)+1)%24" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-up', size: 14, color: 'var(--theme-foreground)' } }] },
                          { type: 'Text', text: { formula: "String(context?.component?.variables?.['tm-v-hour']??12).padStart(2,'0')" }, props: { className: 'text-[20px] font-bold text-[var(--theme-foreground)] w-[40px] text-center' } },
                          { type: 'Box', props: { className: 'flex items-center justify-center w-[36px] h-[28px] rounded-[6px] border border-[var(--theme-border)] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'hd', type: 'changeVariableValue', config: { variableName: 'tm-v-hour', value: { formula: "((context?.component?.variables?.['tm-v-hour']??12)-1+24)%24" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-down', size: 14, color: 'var(--theme-foreground)' } }] },
                          { type: 'Text', text: 'HR', props: { className: 'text-[10px] text-[var(--theme-muted-foreground)]' } },
                        ],
                      },
                      { type: 'Text', text: ':', props: { className: 'text-[24px] font-bold text-[var(--theme-foreground)] mb-[14px]' } },
                      {
                        type: 'Box',
                        props: { className: 'flex flex-col items-center gap-[4px]' },
                        children: [
                          { type: 'Box', props: { className: 'flex items-center justify-center w-[36px] h-[28px] rounded-[6px] border border-[var(--theme-border)] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'mu', type: 'changeVariableValue', config: { variableName: 'tm-v-minute', value: { formula: "((context?.component?.variables?.['tm-v-minute']??0)+5)%60" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-up', size: 14, color: 'var(--theme-foreground)' } }] },
                          { type: 'Text', text: { formula: "String(context?.component?.variables?.['tm-v-minute']??0).padStart(2,'0')" }, props: { className: 'text-[20px] font-bold text-[var(--theme-foreground)] w-[40px] text-center' } },
                          { type: 'Box', props: { className: 'flex items-center justify-center w-[36px] h-[28px] rounded-[6px] border border-[var(--theme-border)] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'md', type: 'changeVariableValue', config: { variableName: 'tm-v-minute', value: { formula: "((context?.component?.variables?.['tm-v-minute']??0)-5+60)%60" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-down', size: 14, color: 'var(--theme-foreground)' } }] },
                          { type: 'Text', text: 'MIN', props: { className: 'text-[10px] text-[var(--theme-muted-foreground)]' } },
                        ],
                      },
                    ],
                  },
                  { type: 'Box', props: { className: 'flex items-center justify-center h-[36px] rounded-[8px] bg-[var(--theme-primary)] cursor-pointer' }, actions: [{ trigger: 'click', steps: [{ id: 'ok', type: 'changeVariableValue', config: { variableName: 'tm-v-time', value: { formula: "String(context?.component?.variables?.['tm-v-hour']??12).padStart(2,'0')+':'+String(context?.component?.variables?.['tm-v-minute']??0).padStart(2,'0')" } } }, { id: 'cl', type: 'changeVariableValue', config: { variableName: 'tm-v-open', value: false } }] }], children: [{ type: 'Text', text: 'OK', props: { className: 'text-[13px] font-semibold text-[var(--theme-primary-foreground)]' } }] },
                ],
              },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-datetimepicker',
    name: 'Date Time Picker',
    category: 'Form inputs',
    icon: '📅',
    valueVariable: 'dtp-v-selected',
    description: 'Combined calendar + time spinner in one popover.',
    definition: {
      name: 'Date Time Picker',
      description: 'Combined date and time picker.',
      properties: [
        prop('p-dtp-label', 'label', 'text', 'Date & Time'),
      ],
      variables: {
        'dtp-v-year': { label: 'year', type: 'number', initialValue: 2026 },
        'dtp-v-month': { label: 'month', type: 'number', initialValue: 3 },
        'dtp-v-date': { label: 'selectedDate', type: 'string', initialValue: '' },
        'dtp-v-hour': { label: 'hour', type: 'number', initialValue: 12 },
        'dtp-v-minute': { label: 'minute', type: 'number', initialValue: 0 },
        'dtp-v-selected': { label: 'selectedDateTime', type: 'string', initialValue: '' },
        'dtp-v-open': { label: 'isOpen', type: 'boolean', initialValue: false },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[6px] w-full' },
        children: [
          { type: 'Text', text: '{{context.component.props.label}}', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' } },
          {
            type: 'Box',
            popover: { trigger: 'click', placement: 'bottom-start', offset: 6, openVariable: 'dtp-v-open' },
            props: { className: 'inline-flex flex-row items-center gap-[8px] px-[12px] h-[40px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer w-full' },
            children: [
              { type: 'Icon', props: { icon: 'lucide:calendar-clock', size: 16, color: 'var(--theme-muted-foreground)' } },
              { type: 'Text', text: { formula: "context?.component?.variables?.['dtp-v-selected'] || 'Pick date & time'" }, props: { className: 'text-[14px] flex-1 text-[var(--theme-muted-foreground)]' } },
              {
                type: 'Box',
                _popoverContent: true,
                props: { className: 'w-[280px] bg-[var(--theme-card)] rounded-[12px] border border-[var(--theme-border)] p-[12px] shadow-lg flex flex-col gap-[8px]' },
                children: [
                  // Month navigation header
                  {
                    type: 'Box',
                    props: { className: 'flex flex-row items-center justify-between mb-[4px]' },
                    children: [
                      { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'pm', type: 'changeVariableValue', config: { variableName: 'dtp-v-month', value: { formula: "(context?.component?.variables?.['dtp-v-month']??3)-1<0?11:(context?.component?.variables?.['dtp-v-month']??3)-1" } } }, { id: 'py', type: 'changeVariableValue', config: { variableName: 'dtp-v-year', value: { formula: "(context?.component?.variables?.['dtp-v-month']??3)-1<0?(context?.component?.variables?.['dtp-v-year']??2026)-1:(context?.component?.variables?.['dtp-v-year']??2026)" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 16, color: 'var(--theme-foreground)' } }] },
                      { type: 'Text', text: { formula: "['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][context?.component?.variables?.['dtp-v-month']??3]+' '+(context?.component?.variables?.['dtp-v-year']??2026)" }, props: { className: 'text-[13px] font-semibold text-[var(--theme-foreground)]' } },
                      { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'nm', type: 'changeVariableValue', config: { variableName: 'dtp-v-month', value: { formula: "(context?.component?.variables?.['dtp-v-month']??3)+1>11?0:(context?.component?.variables?.['dtp-v-month']??3)+1" } } }, { id: 'ny', type: 'changeVariableValue', config: { variableName: 'dtp-v-year', value: { formula: "(context?.component?.variables?.['dtp-v-month']??3)+1>11?(context?.component?.variables?.['dtp-v-year']??2026)+1:(context?.component?.variables?.['dtp-v-year']??2026)" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 16, color: 'var(--theme-foreground)' } }] },
                    ],
                  },
                  // Week header
                  {
                    type: 'Box',
                    props: { className: 'grid grid-cols-7 mb-[2px]' },
                    children: ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => ({ type: 'Text', props: { className: 'text-[10px] font-semibold text-[var(--theme-muted-foreground)] text-center py-[2px]' }, text: d })),
                  },
                  // Day grid
                  {
                    type: 'Box',
                    props: { className: 'grid grid-cols-7' },
                    children: [{
                      type: 'Box',
                      map: { formula: "Array.from({length:42},(_,i)=>{const yr=context?.component?.variables?.['dtp-v-year']??2026;const mo=context?.component?.variables?.['dtp-v-month']??3;const fd=new Date(yr,mo,1).getDay();const dim=new Date(yr,mo+1,0).getDate();const dn=i-fd+1;const inM=dn>=1&&dn<=dim;const d=dn<1?new Date(yr,mo,0).getDate()+dn:(dn>dim?dn-dim:dn);const ds=inM?yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'):'';const sel=context?.component?.variables?.['dtp-v-date']||'';return{day:d,inMonth:inM,dateStr:ds,isSelected:ds===sel&&ds.length>0,idx:i}})" },
                      key: 'context.item.data.idx',
                      props: { className: 'contents' },
                      children: [
                        { type: 'Box', condition: "context?.item?.data?.inMonth && context?.item?.data?.isSelected", props: { className: 'flex items-center justify-center w-[34px] h-[34px] cursor-pointer rounded-full bg-[var(--theme-primary)]' }, actions: [{ trigger: 'click', steps: [{ id: 'sd', type: 'changeVariableValue', config: { variableName: 'dtp-v-date', value: { formula: "context?.item?.data?.dateStr" } } }] }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-primary-foreground)] font-semibold' } }] },
                        { type: 'Box', condition: "context?.item?.data?.inMonth && !context?.item?.data?.isSelected", props: { className: 'flex items-center justify-center w-[34px] h-[34px] cursor-pointer rounded-full hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'sd', type: 'changeVariableValue', config: { variableName: 'dtp-v-date', value: { formula: "context?.item?.data?.dateStr" } } }] }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-foreground)]' } }] },
                        { type: 'Box', condition: "!context?.item?.data?.inMonth", props: { className: 'flex items-center justify-center w-[34px] h-[34px]' }, children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-muted-foreground)] opacity-30' } }] },
                      ],
                    }],
                  },
                  // Time row
                  { type: 'Box', props: { className: 'h-[1px] bg-[var(--theme-border)]' } },
                  {
                    type: 'Box',
                    props: { className: 'flex flex-row items-center justify-center gap-[6px]' },
                    children: [
                      { type: 'Icon', props: { icon: 'lucide:clock', size: 14, color: 'var(--theme-muted-foreground)' } },
                      { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] border border-[var(--theme-border)] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'hd', type: 'changeVariableValue', config: { variableName: 'dtp-v-hour', value: { formula: "((context?.component?.variables?.['dtp-v-hour']??12)-1+24)%24" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 12, color: 'var(--theme-foreground)' } }] },
                      { type: 'Text', text: { formula: "String(context?.component?.variables?.['dtp-v-hour']??12).padStart(2,'0')" }, props: { className: 'text-[14px] font-bold text-[var(--theme-foreground)] w-[22px] text-center' } },
                      { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] border border-[var(--theme-border)] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'hu', type: 'changeVariableValue', config: { variableName: 'dtp-v-hour', value: { formula: "((context?.component?.variables?.['dtp-v-hour']??12)+1)%24" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 12, color: 'var(--theme-foreground)' } }] },
                      { type: 'Text', text: ':', props: { className: 'text-[16px] font-bold text-[var(--theme-foreground)]' } },
                      { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] border border-[var(--theme-border)] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'md', type: 'changeVariableValue', config: { variableName: 'dtp-v-minute', value: { formula: "((context?.component?.variables?.['dtp-v-minute']??0)-5+60)%60" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 12, color: 'var(--theme-foreground)' } }] },
                      { type: 'Text', text: { formula: "String(context?.component?.variables?.['dtp-v-minute']??0).padStart(2,'0')" }, props: { className: 'text-[14px] font-bold text-[var(--theme-foreground)] w-[22px] text-center' } },
                      { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] border border-[var(--theme-border)] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'mu', type: 'changeVariableValue', config: { variableName: 'dtp-v-minute', value: { formula: "((context?.component?.variables?.['dtp-v-minute']??0)+5)%60" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 12, color: 'var(--theme-foreground)' } }] },
                    ],
                  },
                  // Confirm button
                  { type: 'Box', props: { className: 'flex items-center justify-center h-[34px] rounded-[8px] bg-[var(--theme-primary)] cursor-pointer' }, actions: [{ trigger: 'click', steps: [{ id: 'ok', type: 'changeVariableValue', config: { variableName: 'dtp-v-selected', value: { formula: "(context?.component?.variables?.['dtp-v-date']||'?')+' '+String(context?.component?.variables?.['dtp-v-hour']??12).padStart(2,'0')+':'+String(context?.component?.variables?.['dtp-v-minute']??0).padStart(2,'0')" } } }, { id: 'cl', type: 'changeVariableValue', config: { variableName: 'dtp-v-open', value: false } }] }], children: [{ type: 'Text', text: 'Confirm', props: { className: 'text-[13px] font-semibold text-[var(--theme-primary-foreground)]' } }] },
                ],
              },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-daterangepicker',
    name: 'Date Range Picker',
    category: 'Form inputs',
    icon: '📆',
    description: 'Start and end date range selector.',
    definition: {
      name: 'Date Range Picker',
      description: 'Date range picker with start/end date selection.',
      properties: [
        prop('p-dr-label', 'label', 'text', 'Date Range'),
      ],
      variables: {
        'dr-v-year': { label: 'year', type: 'number', initialValue: 2026 },
        'dr-v-month': { label: 'month', type: 'number', initialValue: 3 },
        'dr-v-start': { label: 'startDate', type: 'string', initialValue: '' },
        'dr-v-end': { label: 'endDate', type: 'string', initialValue: '' },
        'dr-v-open': { label: 'isOpen', type: 'boolean', initialValue: false },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[6px] w-full' },
        children: [
          { type: 'Text', text: '{{context.component.props.label}}', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' } },
          {
            type: 'Box',
            popover: { trigger: 'click', placement: 'bottom-start', offset: 6, openVariable: 'dr-v-open' },
            props: { className: 'inline-flex flex-row items-center gap-[6px] px-[12px] h-[40px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer w-full' },
            children: [
              { type: 'Icon', props: { icon: 'lucide:calendar-range', size: 16, color: 'var(--theme-muted-foreground)' } },
              { type: 'Text', text: { formula: "context?.component?.variables?.['dr-v-start']||'Start'" }, props: { className: 'text-[13px] text-[var(--theme-muted-foreground)]' } },
              { type: 'Text', text: '→', props: { className: 'text-[12px] text-[var(--theme-muted-foreground)]' } },
              { type: 'Text', text: { formula: "context?.component?.variables?.['dr-v-end']||'End'" }, props: { className: 'text-[13px] text-[var(--theme-muted-foreground)]' } },
              {
                type: 'Box',
                _popoverContent: true,
                props: { className: 'w-[300px] bg-[var(--theme-card)] rounded-[12px] border border-[var(--theme-border)] p-[12px] shadow-lg flex flex-col gap-[8px]' },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'flex flex-col gap-[4px]' },
                    children: [
                      { type: 'Text', text: { formula: "context?.component?.variables?.['dr-v-start']?'Start: '+context.component.variables['dr-v-start']:'Click a date to set start'" }, props: { className: 'text-[11px] text-[var(--theme-muted-foreground)]' } },
                      { type: 'Text', text: { formula: "context?.component?.variables?.['dr-v-end']?'End: '+context.component.variables['dr-v-end']:'Click again to set end'" }, props: { className: 'text-[11px] text-[var(--theme-muted-foreground)]' } },
                    ],
                  },
                  {
                    type: 'Box',
                    props: { className: 'flex flex-row items-center justify-between' },
                    children: [
                      { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'pm', type: 'changeVariableValue', config: { variableName: 'dr-v-month', value: { formula: "(context?.component?.variables?.['dr-v-month']??3)-1<0?11:(context?.component?.variables?.['dr-v-month']??3)-1" } } }, { id: 'py', type: 'changeVariableValue', config: { variableName: 'dr-v-year', value: { formula: "(context?.component?.variables?.['dr-v-month']??3)-1<0?(context?.component?.variables?.['dr-v-year']??2026)-1:(context?.component?.variables?.['dr-v-year']??2026)" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 16, color: 'var(--theme-foreground)' } }] },
                      { type: 'Text', text: { formula: "['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][context?.component?.variables?.['dr-v-month']??3]+' '+(context?.component?.variables?.['dr-v-year']??2026)" }, props: { className: 'text-[13px] font-semibold text-[var(--theme-foreground)]' } },
                      { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'nm', type: 'changeVariableValue', config: { variableName: 'dr-v-month', value: { formula: "(context?.component?.variables?.['dr-v-month']??3)+1>11?0:(context?.component?.variables?.['dr-v-month']??3)+1" } } }, { id: 'ny', type: 'changeVariableValue', config: { variableName: 'dr-v-year', value: { formula: "(context?.component?.variables?.['dr-v-month']??3)+1>11?(context?.component?.variables?.['dr-v-year']??2026)+1:(context?.component?.variables?.['dr-v-year']??2026)" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 16, color: 'var(--theme-foreground)' } }] },
                    ],
                  },
                  {
                    type: 'Box',
                    props: { className: 'grid grid-cols-7' },
                    children: ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => ({ type: 'Text', props: { className: 'text-[10px] font-semibold text-[var(--theme-muted-foreground)] text-center py-[2px]' }, text: d })),
                  },
                  {
                    type: 'Box',
                    props: { className: 'grid grid-cols-7' },
                    children: [{
                      type: 'Box',
                      map: { formula: "Array.from({length:42},(_,i)=>{const yr=context?.component?.variables?.['dr-v-year']??2026;const mo=context?.component?.variables?.['dr-v-month']??3;const fd=new Date(yr,mo,1).getDay();const dim=new Date(yr,mo+1,0).getDate();const dn=i-fd+1;const inM=dn>=1&&dn<=dim;const d=dn<1?new Date(yr,mo,0).getDate()+dn:(dn>dim?dn-dim:dn);const ds=inM?yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'):'';const st=context?.component?.variables?.['dr-v-start']||'';const en=context?.component?.variables?.['dr-v-end']||'';const isSt=ds===st&&ds.length>0;const isEn=ds===en&&ds.length>0;const inR=ds>=st&&ds<=en&&st.length>0&&en.length>0&&!isSt&&!isEn;return{day:d,inMonth:inM,dateStr:ds,isStart:isSt,isEnd:isEn,inRange:inR,idx:i}})" },
                      key: 'context.item.data.idx',
                      props: { className: 'contents' },
                      children: [
                        { type: 'Box', condition: "context?.item?.data?.inMonth && (context?.item?.data?.isStart || context?.item?.data?.isEnd)", props: { className: 'flex items-center justify-center w-[36px] h-[34px] cursor-pointer rounded-full bg-[var(--theme-primary)]' }, actions: [{ trigger: 'click', steps: [{ id: 'sel', type: 'changeVariableValue', config: { variableName: 'dr-v-start', value: { formula: "!context?.component?.variables?.['dr-v-start']||context?.component?.variables?.['dr-v-end']?context?.item?.data?.dateStr:context?.component?.variables?.['dr-v-start']" } } }, { id: 'selen', type: 'changeVariableValue', config: { variableName: 'dr-v-end', value: { formula: "context?.component?.variables?.['dr-v-start']&&!context?.component?.variables?.['dr-v-end']?context?.item?.data?.dateStr:''" } } }] }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-primary-foreground)] font-semibold' } }] },
                        { type: 'Box', condition: "context?.item?.data?.inMonth && context?.item?.data?.inRange", props: { className: 'flex items-center justify-center w-[36px] h-[34px] cursor-pointer bg-[var(--theme-primary)]/20' }, actions: [{ trigger: 'click', steps: [{ id: 'sel', type: 'changeVariableValue', config: { variableName: 'dr-v-end', value: { formula: "context?.item?.data?.dateStr" } } }] }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-foreground)]' } }] },
                        { type: 'Box', condition: "context?.item?.data?.inMonth && !context?.item?.data?.isStart && !context?.item?.data?.isEnd && !context?.item?.data?.inRange", props: { className: 'flex items-center justify-center w-[36px] h-[34px] cursor-pointer rounded-full hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'sel', type: 'changeVariableValue', config: { variableName: 'dr-v-start', value: { formula: "!context?.component?.variables?.['dr-v-start']||(context?.component?.variables?.['dr-v-start']&&context?.component?.variables?.['dr-v-end'])?context?.item?.data?.dateStr:context?.component?.variables?.['dr-v-start']" } } }, { id: 'selen', type: 'changeVariableValue', config: { variableName: 'dr-v-end', value: { formula: "context?.component?.variables?.['dr-v-start']&&!context?.component?.variables?.['dr-v-end']&&context?.item?.data?.dateStr>=context?.component?.variables?.['dr-v-start']?context?.item?.data?.dateStr:!context?.component?.variables?.['dr-v-start']||(context?.component?.variables?.['dr-v-start']&&context?.component?.variables?.['dr-v-end'])?'':context?.component?.variables?.['dr-v-end']" } } }] }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-foreground)]' } }] },
                        { type: 'Box', condition: "!context?.item?.data?.inMonth", props: { className: 'flex items-center justify-center w-[36px] h-[34px]' }, children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-muted-foreground)] opacity-30' } }] },
                      ],
                    }],
                  },
                  { type: 'Box', props: { className: 'flex flex-row justify-between pt-[6px] border-t border-[var(--theme-border)]' }, children: [
                    { type: 'Box', props: { className: 'flex items-center justify-center px-[10px] py-[4px] rounded-[6px] border border-[var(--theme-border)] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'clr', type: 'changeVariableValue', config: { variableName: 'dr-v-start', value: '' } }, { id: 'cle', type: 'changeVariableValue', config: { variableName: 'dr-v-end', value: '' } }] }], children: [{ type: 'Text', text: 'Clear', props: { className: 'text-[12px] font-medium text-[var(--theme-foreground)]' } }] },
                    { type: 'Box', props: { className: 'flex items-center justify-center px-[10px] py-[4px] rounded-[6px] bg-[var(--theme-primary)] cursor-pointer' }, actions: [{ trigger: 'click', steps: [{ id: 'cl', type: 'changeVariableValue', config: { variableName: 'dr-v-open', value: false } }] }], children: [{ type: 'Text', text: 'Done', props: { className: 'text-[12px] font-semibold text-[var(--theme-primary-foreground)]' } }] },
                  ] },
                ],
              },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-datepicker-inline',
    name: 'Date Picker (Inline)',
    category: 'Form inputs',
    icon: '🗓',
    valueVariable: 'dpi-v-selected',
    description: 'Always-visible calendar — no popover trigger.',
    definition: {
      name: 'Date Picker (Inline)',
      description: 'Always-visible inline calendar.',
      properties: [],
      variables: {
        'dpi-v-year': { label: 'year', type: 'number', initialValue: 2026 },
        'dpi-v-month': { label: 'month', type: 'number', initialValue: 3 },
        'dpi-v-selected': { label: 'selectedDate', type: 'string', initialValue: '' },
      },
      content: {
        type: 'Box',
        props: { className: 'w-[280px] bg-[var(--theme-card)] rounded-[12px] border border-[var(--theme-border)] p-[12px] flex flex-col gap-[6px]' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between mb-[4px]' },
            children: [
              { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'pm', type: 'changeVariableValue', config: { variableName: 'dpi-v-month', value: { formula: "(context?.component?.variables?.['dpi-v-month']??3)-1<0?11:(context?.component?.variables?.['dpi-v-month']??3)-1" } } }, { id: 'py', type: 'changeVariableValue', config: { variableName: 'dpi-v-year', value: { formula: "(context?.component?.variables?.['dpi-v-month']??3)-1<0?(context?.component?.variables?.['dpi-v-year']??2026)-1:(context?.component?.variables?.['dpi-v-year']??2026)" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 16, color: 'var(--theme-foreground)' } }] },
              { type: 'Text', text: { formula: "['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][context?.component?.variables?.['dpi-v-month']??3]+' '+(context?.component?.variables?.['dpi-v-year']??2026)" }, props: { className: 'text-[13px] font-semibold text-[var(--theme-foreground)]' } },
              { type: 'Box', props: { className: 'flex items-center justify-center w-[28px] h-[28px] rounded-[6px] cursor-pointer hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'nm', type: 'changeVariableValue', config: { variableName: 'dpi-v-month', value: { formula: "(context?.component?.variables?.['dpi-v-month']??3)+1>11?0:(context?.component?.variables?.['dpi-v-month']??3)+1" } } }, { id: 'ny', type: 'changeVariableValue', config: { variableName: 'dpi-v-year', value: { formula: "(context?.component?.variables?.['dpi-v-month']??3)+1>11?(context?.component?.variables?.['dpi-v-year']??2026)+1:(context?.component?.variables?.['dpi-v-year']??2026)" } } }] }], children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 16, color: 'var(--theme-foreground)' } }] },
            ],
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-7 mb-[4px]' },
            children: ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => ({ type: 'Text', props: { className: 'text-[10px] font-semibold text-[var(--theme-muted-foreground)] text-center py-[4px]' }, text: d })),
          },
          {
            type: 'Box',
            props: { className: 'grid grid-cols-7' },
            children: [{
              type: 'Box',
              map: { formula: "Array.from({length:42},(_,i)=>{const yr=context?.component?.variables?.['dpi-v-year']??2026;const mo=context?.component?.variables?.['dpi-v-month']??3;const fd=new Date(yr,mo,1).getDay();const dim=new Date(yr,mo+1,0).getDate();const dn=i-fd+1;const inM=dn>=1&&dn<=dim;const d=dn<1?new Date(yr,mo,0).getDate()+dn:(dn>dim?dn-dim:dn);const ds=inM?yr+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'):'';const today=new Date();const tStr=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');const sel=context?.component?.variables?.['dpi-v-selected']||'';return{day:d,inMonth:inM,dateStr:ds,isToday:ds===tStr,isSelected:ds===sel&&ds.length>0,idx:i}})" },
              key: 'context.item.data.idx',
              props: { className: 'contents' },
              children: [
                { type: 'Box', condition: "context?.item?.data?.inMonth && context?.item?.data?.isSelected", props: { className: 'flex items-center justify-center w-[36px] h-[36px] cursor-pointer rounded-full bg-[var(--theme-primary)]' }, actions: [{ trigger: 'click', steps: [{ id: 'sd', type: 'changeVariableValue', config: { variableName: 'dpi-v-selected', value: { formula: "context?.item?.data?.dateStr" } } }] }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-primary-foreground)] font-semibold' } }] },
                { type: 'Box', condition: "context?.item?.data?.inMonth && !context?.item?.data?.isSelected && context?.item?.data?.isToday", props: { className: 'flex items-center justify-center w-[36px] h-[36px] cursor-pointer rounded-full border-2 border-[var(--theme-primary)]' }, actions: [{ trigger: 'click', steps: [{ id: 'sd', type: 'changeVariableValue', config: { variableName: 'dpi-v-selected', value: { formula: "context?.item?.data?.dateStr" } } }] }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] font-semibold text-[var(--theme-foreground)]' } }] },
                { type: 'Box', condition: "context?.item?.data?.inMonth && !context?.item?.data?.isSelected && !context?.item?.data?.isToday", props: { className: 'flex items-center justify-center w-[36px] h-[36px] cursor-pointer rounded-full hover:bg-[var(--theme-muted)]' }, actions: [{ trigger: 'click', steps: [{ id: 'sd', type: 'changeVariableValue', config: { variableName: 'dpi-v-selected', value: { formula: "context?.item?.data?.dateStr" } } }] }], children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-foreground)]' } }] },
                { type: 'Box', condition: "!context?.item?.data?.inMonth", props: { className: 'flex items-center justify-center w-[36px] h-[36px]' }, children: [{ type: 'Text', text: '{{context.item.data.day}}', props: { className: 'text-[12px] text-[var(--theme-muted-foreground)] opacity-30' } }] },
              ],
            }],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-file-upload',
    name: 'File Upload',
    category: 'Form inputs',
    icon: '⬆',
    description: 'Dashed-border file drop zone.',
    definition: {
      name: 'File Upload',
      description: 'File upload drop zone.',
      properties: [
        prop('p-fu-hint', 'hint', 'text', 'Drag & drop or click to upload'),
        prop('p-fu-accept', 'accept', 'text', 'PNG, JPG, PDF up to 10 MB'),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-col items-center justify-center gap-[8px] w-full py-[32px] px-[16px] rounded-[10px] border-2 border-dashed border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer' },
        children: [
          {
            type: 'Icon',
            props: { icon: 'lucide:upload-cloud', size: 32, color: 'var(--theme-muted-foreground)' },
          },
          {
            type: 'Text',
            text: '{{context.component.props.hint}}',
            props: { className: 'text-[14px] font-medium text-[var(--theme-foreground)] text-center' },
          },
          {
            type: 'Text',
            text: '{{context.component.props.accept}}',
            props: { className: 'text-[12px] text-[var(--theme-muted-foreground)] text-center' },
          },
        ],
      },
    },
  },

  {
    id: 'tpl-slider',
    name: 'Slider',
    category: 'Form inputs',
    icon: '⧖',
    valueVariable: 'sl-value',
    description: 'Drag-based slider built from Box primitives with min/max/step.',
    definition: {
      name: 'Slider',
      description: 'Custom drag slider built from Box primitives.',
      properties: [
        prop('p-sl-label', 'label', 'text', 'Volume'),
        { id: 'p-sl-min',  name: 'min',  type: 'number', defaultValue: 0 },
        { id: 'p-sl-max',  name: 'max',  type: 'number', defaultValue: 100 },
        { id: 'p-sl-step', name: 'step', type: 'number', defaultValue: 1 },
      ],
      variables: {
        'sl-value': { label: 'Value', type: 'number', initialValue: 60 },
      },
      workflows: {
        'sl-wf-update': {
          id: 'sl-wf-update', name: 'Update value', trigger: 'dragUpdate', params: [],
          steps: [{
            id: 's1', type: 'changeVariableValue', config: {
              variableName: 'sl-value',
              value: { js: "const mn=context?.component?.props?.min??0; const mx=context?.component?.props?.max??100; const st=context?.component?.props?.step??1; const raw=mn+(event?.percentX??0)*(mx-mn); return Math.max(mn,Math.min(mx,st>0?Math.round(raw/st)*st:raw));" },
            },
          }],
        },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[10px] w-full select-none' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between' },
            children: [
              { type: 'Text', text: '{{context.component.props.label}}', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' } },
              { type: 'Text', text: { formula: "String(context?.component?.variables?.['sl-value'] ?? 0)" }, props: { className: 'text-[13px] font-medium text-[var(--theme-primary)]' } },
            ],
          },
          {
            type: 'Box',
            props: { className: 'relative w-full h-[20px] flex items-center cursor-pointer touch-none' },
            animation: { drag: { enabled: true, axis: 'x', noVisualMove: true } },
            actions: [
              { action: 'sl-wf-update', trigger: 'dragStart' },
              { action: 'sl-wf-update', trigger: 'dragUpdate' },
              { action: 'sl-wf-update', trigger: 'dragEnd' },
            ],
            children: [
              { type: 'Box', props: { className: 'absolute inset-x-0 top-1/2 -translate-y-1/2 h-[4px] rounded-full bg-[var(--theme-muted)] pointer-events-none' } },
              {
                type: 'Box',
                props: {
                  className: 'absolute left-0 top-1/2 -translate-y-1/2 h-[4px] rounded-full bg-[var(--theme-primary)] pointer-events-none',
                  style: { width: { formula: "Math.max(0, Math.min(100, ((context?.component?.variables?.['sl-value'] ?? context?.component?.props?.min ?? 0) - (context?.component?.props?.min ?? 0)) / ((context?.component?.props?.max ?? 100) - (context?.component?.props?.min ?? 0) || 1) * 100)) + '%'" } },
                },
              },
              {
                type: 'Box',
                props: {
                  className: 'absolute top-1/2 w-[18px] h-[18px] rounded-full bg-[var(--theme-primary)] border-2 border-white shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none',
                  style: { left: { formula: "Math.max(0, Math.min(100, ((context?.component?.variables?.['sl-value'] ?? context?.component?.props?.min ?? 0) - (context?.component?.props?.min ?? 0)) / ((context?.component?.props?.max ?? 100) - (context?.component?.props?.min ?? 0) || 1) * 100)) + '%'" } },
                },
              },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-progress-bar',
    name: 'Progress Bar',
    category: 'Form inputs',
    icon: '▬',
    description: 'Horizontal progress indicator.',
    definition: {
      name: 'Progress Bar',
      description: 'Progress bar.',
      properties: [
        prop('p-pb-label', 'label', 'text', 'Loading…'),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[6px] w-full' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between' },
            children: [
              { type: 'Text', text: '{{context.component.props.label}}', props: { className: 'text-[13px] text-[var(--theme-muted-foreground)]' } },
              { type: 'Text', text: '75%', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' } },
            ],
          },
          {
            type: 'Box',
            props: { className: 'w-full h-[8px] rounded-[4px] bg-[var(--theme-muted)]' },
            children: [
              { type: 'Box', props: { className: 'h-full w-[75%] rounded-[4px] bg-[var(--theme-primary)]' } },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-form',
    name: 'Form',
    category: 'Form inputs',
    icon: '📋',
    description: 'Form container with two fields and a submit button.',
    definition: {
      name: 'Form',
      description: 'Basic form with fields.',
      properties: [
        prop('p-form-title', 'title', 'text', 'Contact Us'),
        prop('p-form-submit', 'submitLabel', 'text', 'Send'),
      ],
      content: {
        type: 'FormContainer',
        props: { className: 'flex flex-col gap-[16px] w-full p-[24px] rounded-[12px] border border-[var(--theme-border)] bg-[var(--theme-card)]' },
        children: [
          { type: 'Text', text: '{{context.component.props.title}}', props: { className: 'text-[18px] font-bold text-[var(--theme-foreground)]' } },
          {
            type: 'Box',
            props: { className: 'flex flex-col gap-[6px] w-full' },
            children: [
              { type: 'Text', text: 'Name', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' } },
              { type: 'Input', props: { placeholder: 'Your name', className: 'w-full h-[40px] px-[12px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-background)] text-[14px]' } },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-col gap-[6px] w-full' },
            children: [
              { type: 'Text', text: 'Email', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' } },
              { type: 'Input', props: { placeholder: 'your@email.com', className: 'w-full h-[40px] px-[12px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-background)] text-[14px]' } },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex items-center justify-center h-[42px] rounded-[8px] bg-[var(--theme-primary)] cursor-pointer' },
            children: [
              { type: 'Text', text: '{{context.component.props.submitLabel}}', props: { className: 'text-[14px] font-semibold text-[var(--theme-primary-foreground)]' } },
            ],
          },
        ],
      },
    },
  },

  // ── Navigation (continued) ─────────────────────────────────────────────────

  {
    id: 'tpl-tabs',
    name: 'Tabs',
    category: 'Navigation',
    icon: '⊞',
    description: 'Horizontal tab bar with 3 tabs. Variable tracks active tab.',
    definition: {
      name: 'Tabs',
      description: 'Tab navigation.',
      properties: [
        prop('p-tabs-1', 'tab1', 'text', 'Overview'),
        prop('p-tabs-2', 'tab2', 'text', 'Details'),
        prop('p-tabs-3', 'tab3', 'text', 'Reviews'),
      ],
      variables: {
        'tabs-active': { label: 'Active tab', type: 'string', initialValue: 'tab1' },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-row border-b border-[var(--theme-border)] w-full' },
        children: [
          {
            type: 'Box',
            props: { className: { formula: "context?.component?.variables?.['tabs-active'] === 'tab1' ? 'flex flex-row items-center px-[16px] py-[10px] border-b-2 border-[var(--theme-primary)] cursor-pointer' : 'flex flex-row items-center px-[16px] py-[10px] border-b-2 border-transparent cursor-pointer'" } },
            actions: [{ trigger: 'click', steps: [{ id: 't1', type: 'changeVariableValue', config: { variableName: 'tabs-active', value: 'tab1' } }] }],
            children: [
              { type: 'Text', text: '{{context.component.props.tab1}}', props: { className: { formula: "context?.component?.variables?.['tabs-active'] === 'tab1' ? 'text-[14px] font-semibold text-[var(--theme-primary)]' : 'text-[14px] text-[var(--theme-muted-foreground)]'" } } },
            ],
          },
          {
            type: 'Box',
            props: { className: { formula: "context?.component?.variables?.['tabs-active'] === 'tab2' ? 'flex flex-row items-center px-[16px] py-[10px] border-b-2 border-[var(--theme-primary)] cursor-pointer' : 'flex flex-row items-center px-[16px] py-[10px] border-b-2 border-transparent cursor-pointer'" } },
            actions: [{ trigger: 'click', steps: [{ id: 't2', type: 'changeVariableValue', config: { variableName: 'tabs-active', value: 'tab2' } }] }],
            children: [
              { type: 'Text', text: '{{context.component.props.tab2}}', props: { className: { formula: "context?.component?.variables?.['tabs-active'] === 'tab2' ? 'text-[14px] font-semibold text-[var(--theme-primary)]' : 'text-[14px] text-[var(--theme-muted-foreground)]'" } } },
            ],
          },
          {
            type: 'Box',
            props: { className: { formula: "context?.component?.variables?.['tabs-active'] === 'tab3' ? 'flex flex-row items-center px-[16px] py-[10px] border-b-2 border-[var(--theme-primary)] cursor-pointer' : 'flex flex-row items-center px-[16px] py-[10px] border-b-2 border-transparent cursor-pointer'" } },
            actions: [{ trigger: 'click', steps: [{ id: 't3', type: 'changeVariableValue', config: { variableName: 'tabs-active', value: 'tab3' } }] }],
            children: [
              { type: 'Text', text: '{{context.component.props.tab3}}', props: { className: { formula: "context?.component?.variables?.['tabs-active'] === 'tab3' ? 'text-[14px] font-semibold text-[var(--theme-primary)]' : 'text-[14px] text-[var(--theme-muted-foreground)]'" } } },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-chip',
    name: 'Chip',
    category: 'Navigation',
    icon: '◯',
    description: 'Pill-shaped tag with optional remove button.',
    definition: {
      name: 'Chip',
      description: 'Tag / chip.',
      properties: [
        prop('p-chip-label', 'label', 'text', 'Design'),
      ],
      content: {
        type: 'Box',
        props: { className: 'inline-flex flex-row items-center gap-[6px] px-[10px] py-[4px] rounded-[9999px] border border-[var(--theme-border)] bg-[var(--theme-card)] w-fit' },
        children: [
          { type: 'Text', text: '{{context.component.props.label}}', props: { className: 'text-[12px] font-medium text-[var(--theme-foreground)]' } },
          { type: 'Icon', props: { icon: 'lucide:x', size: 12, color: 'var(--theme-muted-foreground)' } },
        ],
      },
    },
  },

  {
    id: 'tpl-stepper',
    name: 'Stepper',
    category: 'Navigation',
    icon: '⏭',
    description: 'Clickable multi-step progress indicator with dashed connectors.',
    definition: {
      name: 'Stepper',
      description: 'Clickable step progress indicator with dashed connectors.',
      properties: [
        prop('p-stp-1', 'step1', 'text', 'Account'),
        prop('p-stp-2', 'step2', 'text', 'Details'),
        prop('p-stp-3', 'step3', 'text', 'Confirm'),
      ],
      variables: {
        'stp-active': { label: 'Active step (1-3)', type: 'number', initialValue: 1 },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-start w-full' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-col items-center gap-[8px]' },
            actions: [{ trigger: 'click', steps: [{ id: 's1', type: 'changeVariableValue', config: { variableName: 'stp-active', value: 1 } }] }],
            children: [
              {
                type: 'Box',
                props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) >= 1 ? 'flex items-center justify-center w-[32px] h-[32px] rounded-full bg-[var(--theme-primary)] cursor-pointer' : 'flex items-center justify-center w-[32px] h-[32px] rounded-full border-2 border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer'" } },
                children: [
                  { type: 'Icon', condition: "(context?.component?.variables?.['stp-active'] ?? 1) > 1", props: { icon: 'lucide:check', size: 14, color: 'var(--theme-primary-foreground)' } },
                  { type: 'Text', condition: "(context?.component?.variables?.['stp-active'] ?? 1) <= 1", text: '1', props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) === 1 ? 'text-[13px] font-bold text-[var(--theme-primary-foreground)]' : 'text-[13px] text-[var(--theme-muted-foreground)]'" } } },
                ],
              },
              { type: 'Text', text: '{{context.component.props.step1}}', props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) >= 1 ? 'text-[12px] font-semibold text-[var(--theme-primary)]' : 'text-[12px] text-[var(--theme-muted-foreground)]'" } } },
            ],
          },
          { type: 'Box', props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) > 1 ? 'flex-1 border-t-2 border-dashed border-[var(--theme-primary)] mt-[15px]' : 'flex-1 border-t-2 border-dashed border-[var(--theme-border)] mt-[15px]'" } } },
          {
            type: 'Box',
            props: { className: 'flex flex-col items-center gap-[8px]' },
            actions: [{ trigger: 'click', steps: [{ id: 's2', type: 'changeVariableValue', config: { variableName: 'stp-active', value: 2 } }] }],
            children: [
              {
                type: 'Box',
                props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) >= 2 ? 'flex items-center justify-center w-[32px] h-[32px] rounded-full bg-[var(--theme-primary)] cursor-pointer' : 'flex items-center justify-center w-[32px] h-[32px] rounded-full border-2 border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer'" } },
                children: [
                  { type: 'Icon', condition: "(context?.component?.variables?.['stp-active'] ?? 1) > 2", props: { icon: 'lucide:check', size: 14, color: 'var(--theme-primary-foreground)' } },
                  { type: 'Text', condition: "(context?.component?.variables?.['stp-active'] ?? 1) <= 2", text: '2', props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) === 2 ? 'text-[13px] font-bold text-[var(--theme-primary-foreground)]' : 'text-[13px] text-[var(--theme-muted-foreground)]'" } } },
                ],
              },
              { type: 'Text', text: '{{context.component.props.step2}}', props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) >= 2 ? 'text-[12px] font-semibold text-[var(--theme-primary)]' : 'text-[12px] text-[var(--theme-muted-foreground)]'" } } },
            ],
          },
          { type: 'Box', props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) > 2 ? 'flex-1 border-t-2 border-dashed border-[var(--theme-primary)] mt-[15px]' : 'flex-1 border-t-2 border-dashed border-[var(--theme-border)] mt-[15px]'" } } },
          {
            type: 'Box',
            props: { className: 'flex flex-col items-center gap-[8px]' },
            actions: [{ trigger: 'click', steps: [{ id: 's3', type: 'changeVariableValue', config: { variableName: 'stp-active', value: 3 } }] }],
            children: [
              {
                type: 'Box',
                props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) >= 3 ? 'flex items-center justify-center w-[32px] h-[32px] rounded-full bg-[var(--theme-primary)] cursor-pointer' : 'flex items-center justify-center w-[32px] h-[32px] rounded-full border-2 border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer'" } },
                children: [
                  { type: 'Icon', condition: "(context?.component?.variables?.['stp-active'] ?? 1) >= 3", props: { icon: 'lucide:check', size: 14, color: 'var(--theme-primary-foreground)' } },
                  { type: 'Text', condition: "(context?.component?.variables?.['stp-active'] ?? 1) < 3", text: '3', props: { className: 'text-[13px] text-[var(--theme-muted-foreground)]' } },
                ],
              },
              { type: 'Text', text: '{{context.component.props.step3}}', props: { className: { formula: "(context?.component?.variables?.['stp-active'] ?? 1) >= 3 ? 'text-[12px] font-semibold text-[var(--theme-primary)]' : 'text-[12px] text-[var(--theme-muted-foreground)]'" } } },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-pagination',
    name: 'Pagination',
    category: 'Navigation',
    icon: '⋯',
    description: 'Prev / page numbers / Next controls — click to navigate.',
    definition: {
      name: 'Pagination',
      description: 'Clickable pagination controls.',
      properties: [
        prop('p-pg-total', 'total', 'text', '5'),
      ],
      variables: {
        'pg-current': { label: 'Current page', type: 'number', initialValue: 1 },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-[4px]' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex items-center justify-center w-[36px] h-[36px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer hover:bg-[var(--theme-muted)]' },
            actions: [{ trigger: 'click', steps: [{ id: 'prev', type: 'changeVariableValue', config: { variableName: 'pg-current', value: { formula: "Math.max(1, (context?.component?.variables?.['pg-current'] ?? 1) - 1)" } } }] }],
            children: [{ type: 'Icon', props: { icon: 'lucide:chevron-left', size: 16, color: 'var(--theme-foreground)' } }],
          },
          {
            type: 'Box',
            map: { formula: "Array.from({ length: Number(context?.component?.props?.total ?? 5) }, (_, i) => ({ n: i + 1 }))" },
            key: 'context.item.data.n',
            props: { className: 'contents' },
            children: [
              {
                type: 'Box',
                props: { className: { formula: "context?.item?.data?.n === (context?.component?.variables?.['pg-current'] ?? 1) ? 'flex items-center justify-center w-[36px] h-[36px] rounded-[8px] bg-[var(--theme-primary)] cursor-pointer' : 'flex items-center justify-center w-[36px] h-[36px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer hover:bg-[var(--theme-muted)]'" } },
                actions: [{ trigger: 'click', steps: [{ id: 'pg', type: 'changeVariableValue', config: { variableName: 'pg-current', value: { formula: "context?.item?.data?.n" } } }] }],
                children: [{ type: 'Text', text: '{{context.item.data.n}}', props: { className: { formula: "context?.item?.data?.n === (context?.component?.variables?.['pg-current'] ?? 1) ? 'text-[14px] font-semibold text-[var(--theme-primary-foreground)]' : 'text-[14px] text-[var(--theme-muted-foreground)]'" } } }],
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex items-center justify-center w-[36px] h-[36px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer hover:bg-[var(--theme-muted)]' },
            actions: [{ trigger: 'click', steps: [{ id: 'next', type: 'changeVariableValue', config: { variableName: 'pg-current', value: { formula: "Math.min(Number(context?.component?.props?.total ?? 5), (context?.component?.variables?.['pg-current'] ?? 1) + 1)" } } }] }],
            children: [{ type: 'Icon', props: { icon: 'lucide:chevron-right', size: 16, color: 'var(--theme-foreground)' } }],
          },
        ],
      },
    },
  },

  // ── Feedback (continued) ───────────────────────────────────────────────────

  {
    id: 'tpl-spinner',
    name: 'Spinner',
    category: 'Feedback',
    icon: '↻',
    description: 'Animated loading spinner.',
    definition: {
      name: 'Spinner',
      description: 'Loading spinner.',
      properties: [
        prop('p-sp-size', 'size', 'number', 24),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex items-center justify-center w-fit' },
        children: [
          {
            type: 'Icon',
            props: { icon: 'lucide:loader-2', size: 24, color: 'var(--theme-primary)', className: 'animate-spin' },
          },
        ],
      },
    },
  },

  {
    id: 'tpl-skeleton',
    name: 'Skeleton',
    category: 'Feedback',
    icon: '▒',
    description: 'Animated loading skeleton — 3 pulse lines.',
    definition: {
      name: 'Skeleton',
      description: 'Loading skeleton.',
      properties: [],
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[10px] w-full' },
        children: [
          { type: 'Box', props: { className: 'w-full h-[16px] rounded-[6px] bg-[var(--theme-muted)] animate-pulse' } },
          { type: 'Box', props: { className: 'w-[80%] h-[16px] rounded-[6px] bg-[var(--theme-muted)] animate-pulse' } },
          { type: 'Box', props: { className: 'w-[60%] h-[16px] rounded-[6px] bg-[var(--theme-muted)] animate-pulse' } },
        ],
      },
    },
  },

  {
    id: 'tpl-star-rating',
    name: 'Star Rating',
    category: 'Feedback',
    icon: '★',
    valueVariable: 'sr-rating',
    description: 'Interactive 5-star rating.',
    definition: {
      name: 'Star Rating',
      description: 'Interactive 5-star rating component.',
      properties: [
        prop('p-sr-count', 'count', 'text', '128 reviews'),
      ],
      variables: {
        'sr-rating': { label: 'Rating', type: 'number', initialValue: 4 },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-[8px]' },
        children: [
          {
            type: 'Box',
            map: { formula: '[1,2,3,4,5].map(n => ({ n }))' },
            key: 'context.item.data.n',
            props: { className: 'flex flex-row items-center gap-[2px]' },
            children: [
              {
                type: 'Icon',
                props: {
                  icon: 'mdi:star',
                  size: 22,
                  color: { formula: "context?.item?.data?.n <= (context?.component?.variables?.['sr-rating'] ?? 0) ? '#f59e0b' : '#d1d5db'" },
                  className: 'cursor-pointer',
                },
                actions: [{ trigger: 'click', steps: [
                  { id: 'sr', type: 'changeVariableValue', config: { variableName: 'sr-rating', value: { formula: "context?.item?.data?.n" } } },
                ] }],
              },
            ],
          },
          { type: 'Text', text: { formula: "(context?.component?.variables?.['sr-rating'] ?? 0) + ' / 5 — ' + (context?.component?.props?.count || '')" }, props: { className: 'text-[13px] text-[var(--theme-muted-foreground)]' } },
        ],
      },
    },
  },

  // ── Composite (continued) ──────────────────────────────────────────────────

  {
    id: 'tpl-avatar',
    name: 'Avatar',
    category: 'Composite',
    icon: '👤',
    description: 'Circular avatar with image or initials fallback.',
    definition: {
      name: 'Avatar',
      description: 'User avatar.',
      properties: [
        prop('p-av-src', 'src', 'text', ''),
        prop('p-av-initials', 'initials', 'text', 'JD'),
        prop('p-av-size', 'size', 'select', 'md', [
          { label: 'SM (32)', value: 'sm' },
          { label: 'MD (40)', value: 'md' },
          { label: 'LG (56)', value: 'lg' },
        ]),
      ],
      content: {
        type: 'Box',
        props: { className: 'flex items-center justify-center w-[40px] h-[40px] rounded-[20px] overflow-hidden bg-[var(--theme-primary)] flex-shrink-0' },
        children: [
          {
            type: 'Text',
            text: '{{context.component.props.initials}}',
            props: { className: 'text-[15px] font-semibold text-[var(--theme-primary-foreground)]' },
          },
        ],
      },
    },
  },

  {
    id: 'tpl-avatar-group',
    name: 'Avatar Group',
    category: 'Composite',
    icon: '👥',
    description: 'Row of overlapping avatars.',
    definition: {
      name: 'Avatar Group',
      description: 'Multiple overlapping avatars.',
      properties: [],
      content: {
        type: 'Box',
        props: { className: 'flex flex-row items-center' },
        children: [
          { type: 'Box', props: { className: 'flex items-center justify-center w-[36px] h-[36px] rounded-[18px] bg-[#6366f1] border-2 border-white z-[3]' },
            children: [{ type: 'Text', text: 'JD', props: { className: 'text-[12px] font-semibold text-white' } }] },
          { type: 'Box', props: { className: 'flex items-center justify-center w-[36px] h-[36px] rounded-[18px] bg-[#ec4899] border-2 border-white -ml-[10px] z-[2]' },
            children: [{ type: 'Text', text: 'AB', props: { className: 'text-[12px] font-semibold text-white' } }] },
          { type: 'Box', props: { className: 'flex items-center justify-center w-[36px] h-[36px] rounded-[18px] bg-[#14b8a6] border-2 border-white -ml-[10px] z-[1]' },
            children: [{ type: 'Text', text: 'TK', props: { className: 'text-[12px] font-semibold text-white' } }] },
          { type: 'Box', props: { className: 'flex items-center justify-center w-[36px] h-[36px] rounded-[18px] bg-[var(--theme-muted)] border-2 border-white -ml-[10px] z-0' },
            children: [{ type: 'Text', text: '+5', props: { className: 'text-[11px] font-semibold text-[var(--theme-muted-foreground)]' } }] },
        ],
      },
    },
  },

  {
    id: 'tpl-table',
    name: 'Table',
    category: 'Composite',
    icon: '⊞',
    description: 'Data table with header and 3 rows.',
    definition: {
      name: 'Table',
      description: 'Data table.',
      properties: [],
      content: {
        type: 'Box',
        props: { className: 'w-full rounded-[10px] border border-[var(--theme-border)] overflow-hidden' },
        children: [
          // Header
          {
            type: 'Box',
            props: { className: 'flex flex-row bg-[var(--theme-muted)]' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[10px] border-r border-[var(--theme-border)]' },
                children: [{ type: 'Text', text: 'Name', props: { className: 'text-[12px] font-semibold text-[var(--theme-muted-foreground)] uppercase tracking-wide' } }] },
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[10px] border-r border-[var(--theme-border)]' },
                children: [{ type: 'Text', text: 'Status', props: { className: 'text-[12px] font-semibold text-[var(--theme-muted-foreground)] uppercase tracking-wide' } }] },
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[10px]' },
                children: [{ type: 'Text', text: 'Amount', props: { className: 'text-[12px] font-semibold text-[var(--theme-muted-foreground)] uppercase tracking-wide' } }] },
            ],
          },
          // Row 1
          {
            type: 'Box',
            props: { className: 'flex flex-row border-t border-[var(--theme-border)]' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[12px] border-r border-[var(--theme-border)]' },
                children: [{ type: 'Text', text: 'Alice Chen', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } }] },
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[12px] border-r border-[var(--theme-border)]' },
                children: [{ type: 'Text', text: 'Active', props: { className: 'text-[13px] font-medium text-green-600' } }] },
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[12px]' },
                children: [{ type: 'Text', text: '$240.00', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } }] },
            ],
          },
          // Row 2
          {
            type: 'Box',
            props: { className: 'flex flex-row border-t border-[var(--theme-border)]' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[12px] border-r border-[var(--theme-border)]' },
                children: [{ type: 'Text', text: 'Bob Smith', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } }] },
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[12px] border-r border-[var(--theme-border)]' },
                children: [{ type: 'Text', text: 'Pending', props: { className: 'text-[13px] font-medium text-amber-600' } }] },
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[12px]' },
                children: [{ type: 'Text', text: '$85.00', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } }] },
            ],
          },
          // Row 3
          {
            type: 'Box',
            props: { className: 'flex flex-row border-t border-[var(--theme-border)]' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[12px] border-r border-[var(--theme-border)]' },
                children: [{ type: 'Text', text: 'Carol Lee', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } }] },
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[12px] border-r border-[var(--theme-border)]' },
                children: [{ type: 'Text', text: 'Inactive', props: { className: 'text-[13px] font-medium text-[var(--theme-muted-foreground)]' } }] },
              { type: 'Box', props: { className: 'flex-1 px-[14px] py-[12px]' },
                children: [{ type: 'Text', text: '$0.00', props: { className: 'text-[14px] text-[var(--theme-foreground)]' } }] },
            ],
          },
        ],
      },
    },
  },

  {
    id: 'tpl-accordion-item',
    name: 'Accordion Item',
    category: 'Composite',
    icon: '⊕',
    description: 'Expand/collapse panel. Variable tracks open state.',
    definition: {
      name: 'Accordion Item',
      description: 'Collapsible accordion item.',
      properties: [
        prop('p-acc-title', 'title', 'text', 'Can I get a refund?'),
        prop('p-acc-body', 'body', 'text', 'Yes, we offer full refunds within 30 days of purchase.'),
      ],
      variables: {
        'acc-open': { label: 'Open', type: 'boolean', initialValue: true },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-col w-full border border-[var(--theme-border)] rounded-[10px] overflow-hidden' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between px-[16px] py-[14px] cursor-pointer bg-[var(--theme-card)]' },
            actions: [
              { trigger: 'click', steps: [{ id: 'acc-toggle', type: 'changeVariableValue', config: { variableName: 'acc-open', value: { formula: "!(context?.component?.variables?.['acc-open'] ?? false)" } } }] },
            ],
            children: [
              { type: 'Text', text: '{{context.component.props.title}}', props: { className: 'text-[14px] font-semibold text-[var(--theme-foreground)] flex-1' } },
              { type: 'Icon', props: { icon: 'lucide:chevron-down', size: 18, color: 'var(--theme-muted-foreground)', className: { formula: "context?.component?.variables?.['acc-open'] ? 'rotate-180 transition-transform' : 'transition-transform'" } } },
            ],
          },
          {
            type: 'Box',
            props: { className: { formula: "context?.component?.variables?.['acc-open'] ? 'px-[16px] py-[14px] border-t border-[var(--theme-border)] bg-[var(--theme-background)]' : 'hidden'" } },
            children: [
              { type: 'Text', text: '{{context.component.props.body}}', props: { className: 'text-[14px] text-[var(--theme-muted-foreground)] leading-relaxed' } },
            ],
          },
        ],
      },
    },
  },

  // ── Overlays (continued) ───────────────────────────────────────────────────

  {
    id: 'tpl-popover',
    name: 'Popover',
    category: 'Overlays',
    icon: '💬',
    description: 'Trigger button with a click-to-open floating content panel.',
    definition: {
      name: 'Popover',
      description: 'Trigger button with a click-to-open floating content panel.',
      properties: [
        prop('p-pop-trigger', 'triggerLabel', 'text', 'Open'),
        prop('p-pop-content', 'content', 'text', 'Popover content goes here.'),
      ],
      variables: {
        'pop-open': { label: 'Open', type: 'boolean', initialValue: false },
      },
      content: {
        type: 'Box',
        popover: { trigger: 'click', placement: 'bottom-start', offset: 6, openVariable: 'pop-open' },
        props: { className: 'inline-flex' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex items-center justify-center px-[14px] h-[36px] rounded-[8px] border border-[var(--theme-border)] bg-[var(--theme-card)] cursor-pointer' },
            children: [
              { type: 'Text', text: '{{context.component.props.triggerLabel}}', props: { className: 'text-[14px] font-medium text-[var(--theme-foreground)]' } },
            ],
          },
          {
            type: 'Box',
            _popoverContent: true,
            props: { className: 'min-w-[200px] p-[14px] rounded-[10px] border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-lg' },
            children: [
              { type: 'Text', text: '{{context.component.props.content}}', props: { className: 'text-[13px] text-[var(--theme-foreground)]' } },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'tpl-carousel',
    name: 'Carousel',
    category: 'Composite',
    icon: '🎠',
    description: '3-slide swipeable carousel with Reanimated animation, dot indicators, and prev/next buttons.',
    definition: {
      name: 'Carousel',
      description: 'Swipeable 3-slide carousel with prev/next navigation.',
      properties: [],
      variables: {
        'cr-slide': { label: 'Current slide', type: 'number', initialValue: 0 },
      },
      workflows: {
        'cr-wf-prev': {
          id: 'cr-wf-prev',
          name: 'Previous slide',
          trigger: 'click',
          params: [],
          steps: [{
            id: 's1',
            type: 'changeVariableValue',
            config: {
              variableName: 'cr-slide',
              value: { formula: "Math.max(0, (context?.component?.variables?.['cr-slide'] ?? 0) - 1)" },
            },
          }],
        },
        'cr-wf-next': {
          id: 'cr-wf-next',
          name: 'Next slide',
          trigger: 'click',
          params: [],
          steps: [{
            id: 's1',
            type: 'changeVariableValue',
            config: {
              variableName: 'cr-slide',
              value: { formula: "Math.min(2, (context?.component?.variables?.['cr-slide'] ?? 0) + 1)" },
            },
          }],
        },
      },
      content: {
        type: 'Box',
        props: { className: 'flex flex-col gap-[12px] w-full select-none' },
        children: [
          {
            type: 'Box',
            props: { className: 'relative overflow-hidden rounded-[12px] w-full' },
            children: [
              {
                type: 'Box',
                props: {
                  className: 'flex flex-row',
                  animation: {
                    gesture: {
                      enabled: true,
                      swipe: true,
                      dragFeedback: true,
                      onSwipeLeftAction: 'cr-wf-next',
                      onSwipeRightAction: 'cr-wf-prev',
                    },
                    states: {
                      watchVar: "String(context?.component?.variables?.['cr-slide'] ?? 0)",
                      defaultState: '0',
                      duration: 400,
                      easing: 'easeInOut',
                      states: {
                        '0': { transform: 'translateX(0%)' },
                        '1': { transform: 'translateX(-100%)' },
                        '2': { transform: 'translateX(-200%)' },
                      },
                    },
                    outerClassName: 'w-full',
                  },
                },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'min-w-full h-[200px] bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center rounded-[12px]' },
                    children: [{ type: 'Text', props: { className: 'text-white text-[24px] font-bold' }, text: 'Slide 1' }],
                  },
                  {
                    type: 'Box',
                    props: { className: 'min-w-full h-[200px] bg-gradient-to-br from-green-400 to-teal-500 flex items-center justify-center rounded-[12px]' },
                    children: [{ type: 'Text', props: { className: 'text-white text-[24px] font-bold' }, text: 'Slide 2' }],
                  },
                  {
                    type: 'Box',
                    props: { className: 'min-w-full h-[200px] bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center rounded-[12px]' },
                    children: [{ type: 'Text', props: { className: 'text-white text-[24px] font-bold' }, text: 'Slide 3' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row items-center justify-between' },
            children: [
              {
                type: 'Box',
                props: { className: 'px-[14px] py-[7px] rounded-[8px] bg-[var(--theme-muted)] cursor-pointer' },
                actions: [{ action: 'cr-wf-prev', trigger: 'click' }],
                children: [{ type: 'Text', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' }, text: 'Prev' }],
              },
              {
                type: 'Box',
                props: { className: 'flex flex-row gap-[8px] items-center' },
                children: [
                  {
                    type: 'Box',
                    props: { className: 'w-[8px] h-[8px] rounded-full cursor-pointer', style: { backgroundColor: { formula: "(context?.component?.variables?.['cr-slide'] ?? 0) === 0 ? 'var(--theme-primary)' : 'var(--theme-muted)'" } } },
                    actions: [{ action: 'cr-wf-prev', trigger: 'click' }],
                  },
                  {
                    type: 'Box',
                    props: { className: 'w-[8px] h-[8px] rounded-full cursor-pointer', style: { backgroundColor: { formula: "(context?.component?.variables?.['cr-slide'] ?? 0) === 1 ? 'var(--theme-primary)' : 'var(--theme-muted)'" } } },
                  },
                  {
                    type: 'Box',
                    props: { className: 'w-[8px] h-[8px] rounded-full cursor-pointer', style: { backgroundColor: { formula: "(context?.component?.variables?.['cr-slide'] ?? 0) === 2 ? 'var(--theme-primary)' : 'var(--theme-muted)'" } } },
                    actions: [{ action: 'cr-wf-next', trigger: 'click' }],
                  },
                ],
              },
              {
                type: 'Box',
                props: { className: 'px-[14px] py-[7px] rounded-[8px] bg-[var(--theme-muted)] cursor-pointer' },
                actions: [{ action: 'cr-wf-next', trigger: 'click' }],
                children: [{ type: 'Text', props: { className: 'text-[13px] font-medium text-[var(--theme-foreground)]' }, text: 'Next' }],
              },
            ],
          },
        ],
      },
    },
  },
];

// ─── Category order for the UI ─────────────────────────────────────────────────

export const TEMPLATE_CATEGORY_ORDER: TemplateCategory[] = [
  'Layout',
  'Typography',
  'Form inputs',
  'Navigation',
  'Feedback',
  'Composite',
  'Overlays',
];
