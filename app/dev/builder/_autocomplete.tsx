'use client';

/**
 * Smart Autocomplete — context-aware inline autocomplete for any text/expression input.
 *
 * Triggers:
 *   {{  → template variable picker (store paths)
 *   {   → JSON Logic operator list
 *   @   → named action picker (from config/actions/)
 *
 * Usage:
 *   <AutocompleteInput
 *     value={val}
 *     onChange={setVal}
 *     context="condition"   // biases results
 *     inMapContext={false}  // adds $item.* paths
 *   />
 *
 *  OR wrap any existing textarea:
 *   const { inputProps, dropdown } = useAutocomplete({ value, onChange, context })
 *   <textarea {...inputProps} />
 *   {dropdown}
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { buildPaths, type PathEntry } from './_path-picker';

// ─── Named actions registry ───────────────────────────────────────────────────
// We import all action JSON files to enumerate named actions for the @ trigger.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ACTION_FILES: Record<string, Record<string, unknown>> = {
  auth:     require('@/config/actions/auth.json'),
  cart:     require('@/config/actions/cart.json'),
  checkout: require('@/config/actions/checkout.json'),
  layout:   require('@/config/actions/layout.json'),
  products: require('@/config/actions/products.json'),
  account:  require('@/config/actions/account.json'),
};

const ALL_ACTION_NAMES: string[] = Object.values(ACTION_FILES).flatMap(f => Object.keys(f));

// ─── JSON Logic operator catalogue ───────────────────────────────────────────

interface OpEntry {
  op: string;
  label: string;
  description: string;
  snippet: string;
  group: 'comparison' | 'logic' | 'array' | 'string' | 'variable' | 'snippet';
}

const JSON_LOGIC_OPS: OpEntry[] = [
  // Comparison
  { op: '==',  label: '==',  description: 'Equal',              snippet: '{"==": [{"var": ""}, ""]}',  group: 'comparison' },
  { op: '!=',  label: '!=',  description: 'Not equal',          snippet: '{"!=": [{"var": ""}, ""]}',  group: 'comparison' },
  { op: '>',   label: '>',   description: 'Greater than',       snippet: '{">": [{"var": ""}, 0]}',    group: 'comparison' },
  { op: '>=',  label: '>=',  description: 'Greater than or equal', snippet: '{">=": [{"var": ""}, 0]}', group: 'comparison' },
  { op: '<',   label: '<',   description: 'Less than',          snippet: '{"<": [{"var": ""}, 0]}',    group: 'comparison' },
  { op: '<=',  label: '<=',  description: 'Less than or equal', snippet: '{"<=": [{"var": ""}, 0]}',   group: 'comparison' },
  // Logic
  { op: 'and', label: 'and', description: 'All conditions true', snippet: '{"and": []}',               group: 'logic' },
  { op: 'or',  label: 'or',  description: 'Any condition true',  snippet: '{"or": []}',                group: 'logic' },
  { op: '!',   label: '!',   description: 'Negate',              snippet: '{"!": {"var": ""}}',         group: 'logic' },
  { op: 'if',  label: 'if',  description: 'IF → THEN → ELSE',   snippet: '{"if": [{"var": ""}, "", ""]}', group: 'logic' },
  // Array
  { op: 'in',     label: 'in',     description: 'Value in array',  snippet: '{"in": [{"var": ""}, []]}', group: 'array' },
  { op: 'some',   label: 'some',   description: 'Any item matches', snippet: '{"some": [{"var": ""}, {}]}', group: 'array' },
  { op: 'all',    label: 'all',    description: 'All items match',  snippet: '{"all": [{"var": ""}, {}]}', group: 'array' },
  { op: 'filter', label: 'filter', description: 'Filter array',     snippet: '{"filter": [{"var": ""}, {}]}', group: 'array' },
  { op: 'reduce', label: 'reduce', description: 'Reduce array',     snippet: '{"reduce": [{"var": ""}, {}, 0]}', group: 'array' },
  // String
  { op: 'cat',    label: 'cat',    description: 'Concatenate strings', snippet: '{"cat": ["", ""]}',     group: 'string' },
  { op: 'substr', label: 'substr', description: 'Substring',          snippet: '{"substr": [{"var": ""}, 0]}', group: 'string' },
  // Variable
  { op: 'var',     label: 'var',     description: 'Read a path value', snippet: '{"var": ""}',           group: 'variable' },
  { op: 'missing', label: 'missing', description: 'Check if path missing', snippet: '{"missing": [""]}', group: 'variable' },
];

const SNIPPET_COMPLETIONS: OpEntry[] = [
  { op: 'isLoggedIn', label: 'isLoggedIn', description: 'User is logged in', snippet: '{"var": "auth.user"}', group: 'snippet' },
  { op: 'isEmpty',    label: 'isEmpty',    description: 'Array is empty',    snippet: '{"!": [{"var": ""}]}', group: 'snippet' },
  { op: 'isLoading',  label: 'isLoading',  description: 'Loading state',     snippet: '{"var": "_workflow.loading"}', group: 'snippet' },
  { op: 'hasError',   label: 'hasError',   description: 'Has error',         snippet: '{"!": [{"==": [{"var": "_workflow.lastError"}, null]}]}', group: 'snippet' },
  { op: 'inMap',      label: 'inMap',      description: 'Current map item',  snippet: '{"var": "$item."}', group: 'snippet' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type AutocompleteContext =
  | 'condition'   // node.condition → bias boolean ops
  | 'value'       // action value field → bias {{vars}}
  | 'text'        // text prop → bias template {{
  | 'variables'   // action variables → ops + paths
  | 'path'        // path field only
  | 'general';

type TriggerMode = 'template' | 'jsonlogic' | 'action' | null;

interface DropdownItem {
  key: string;
  label: string;
  description: string;
  insert: string;
  group: string;
  cursorOffset?: number; // chars from end to place cursor
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

interface UseAutocompleteOptions {
  value: string;
  onChange: (v: string) => void;
  context?: AutocompleteContext;
  inMapContext?: boolean;
}

export function useAutocomplete({
  value,
  onChange,
  context = 'general',
  inMapContext = false,
}: UseAutocompleteOptions) {
  const [open, setOpen] = useState(false);
  const [triggerMode, setTriggerMode] = useState<TriggerMode>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [anchorPos, setAnchorPos] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const triggerStartRef = useRef(0); // cursor position where trigger started

  const allPaths = useMemo(() => buildPaths(inMapContext), [inMapContext]);

  // Detect trigger as user types
  const detectTrigger = useCallback((text: string, cursorPos: number) => {
    const before = text.slice(0, cursorPos);

    // Check for {{ (template)
    const dblBrace = before.lastIndexOf('{{');
    if (dblBrace !== -1 && !before.slice(dblBrace).includes('}}')) {
      const q = before.slice(dblBrace + 2);
      return { mode: 'template' as TriggerMode, query: q, start: dblBrace };
    }

    // Check for text context — single { acts as template trigger
    if (context === 'text') {
      const singleBrace = before.lastIndexOf('{');
      if (singleBrace !== -1 && !before.slice(singleBrace).includes('}')) {
        const q = before.slice(singleBrace + 1);
        if (!q.includes(' ')) {
          return { mode: 'template' as TriggerMode, query: q, start: singleBrace };
        }
      }
    }

    // Check for { (jsonlogic)
    const brace = before.lastIndexOf('{');
    if (brace !== -1 && !before.slice(brace).includes('}')) {
      const q = before.slice(brace + 1).trim();
      if (!q.includes('{')) {
        return { mode: 'jsonlogic' as TriggerMode, query: q, start: brace };
      }
    }

    // Check for @ (action)
    const at = before.lastIndexOf('@');
    if (at !== -1 && !before.slice(at).includes(' ')) {
      const q = before.slice(at + 1);
      return { mode: 'action' as TriggerMode, query: q, start: at };
    }

    return null;
  }, [context]);

  const buildItems = useCallback((mode: TriggerMode, q: string): DropdownItem[] => {
    const lq = q.toLowerCase();

    if (mode === 'template') {
      // Bias $item to top if inMapContext
      let paths = allPaths;
      if (inMapContext) {
        const itemPaths = paths.filter(p => p.group === '$item');
        const rest = paths.filter(p => p.group !== '$item');
        paths = [...itemPaths, ...rest];
      }
      // Bias by context
      if (context === 'condition' || context === 'path') {
        paths = paths.filter(p => p.type === 'boolean' || p.group === '_workflow');
      }
      return paths
        .filter(p => !lq || p.path.toLowerCase().includes(lq))
        .slice(0, 40)
        .map(p => ({
          key: p.path,
          label: p.path,
          description: p.type,
          insert: `{{${p.path}}}`,
          group: p.group,
        }));
    }

    if (mode === 'jsonlogic') {
      const snippets = SNIPPET_COMPLETIONS.filter(s => !lq || s.op.toLowerCase().startsWith(lq));
      const ops = JSON_LOGIC_OPS.filter(o => !lq || o.op.toLowerCase().startsWith(lq) || o.description.toLowerCase().includes(lq));

      // Bias by context
      let biased = ops;
      if (context === 'condition') {
        const preferred = ['and', 'or', '==', '!=', 'var', '!', 'if'];
        biased = [
          ...ops.filter(o => preferred.includes(o.op)),
          ...ops.filter(o => !preferred.includes(o.op)),
        ];
      }

      return [
        ...snippets.map(s => ({
          key: `snip-${s.op}`,
          label: s.label,
          description: s.description,
          insert: s.snippet,
          group: 'Snippets',
          cursorOffset: undefined,
        })),
        ...biased.map(o => ({
          key: `op-${o.op}`,
          label: o.label,
          description: o.description,
          insert: o.snippet,
          group: o.group.charAt(0).toUpperCase() + o.group.slice(1),
        })),
      ];
    }

    if (mode === 'action') {
      return ALL_ACTION_NAMES
        .filter(n => !lq || n.toLowerCase().includes(lq))
        .slice(0, 20)
        .map(n => ({
          key: `act-${n}`,
          label: n,
          description: 'named action',
          insert: `{"action": "${n}"}`,
          group: 'Actions',
        }));
    }

    return [];
  }, [allPaths, context, inMapContext]);

  const items = useMemo(
    () => (open && triggerMode ? buildItems(triggerMode, query) : []),
    [open, triggerMode, query, buildItems]
  );

  const close = useCallback(() => {
    setOpen(false);
    setTriggerMode(null);
    setQuery('');
  }, []);

  const confirmItem = useCallback((item: DropdownItem) => {
    const el = inputRef.current;
    if (!el) return;

    const cursor = el.selectionEnd ?? value.length;
    const before = value.slice(0, triggerStartRef.current);
    const after = value.slice(cursor);
    const newVal = before + item.insert + after;
    onChange(newVal);
    close();

    // Position cursor inside snippet (e.g. inside quotes)
    const targetCursor = before.length + item.insert.length - (item.cursorOffset ?? 0);
    requestAnimationFrame(() => {
      el.setSelectionRange(targetCursor, targetCursor);
      el.focus();
    });
  }, [value, onChange, close]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, items.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
    if ((e.key === 'Tab' || e.key === 'Enter') && items[activeIdx]) {
      e.preventDefault();
      confirmItem(items[activeIdx]);
      return;
    }
  }, [open, items, activeIdx, confirmItem, close]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    const cursor = e.target.selectionEnd ?? newVal.length;
    onChange(newVal);

    const detected = detectTrigger(newVal, cursor);
    if (detected) {
      setTriggerMode(detected.mode);
      setQuery(detected.query);
      setActiveIdx(0);
      triggerStartRef.current = detected.start;
      if (!open) {
        const rect = e.target.getBoundingClientRect();
        setAnchorPos({ top: rect.bottom + 4, left: rect.left });
        setOpen(true);
      }
    } else {
      if (open) close();
    }
  }, [onChange, detectTrigger, open, close]);

  const inputProps = {
    ref: inputRef as React.Ref<HTMLInputElement>,
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
  };

  const dropdown = open && items.length > 0 && anchorPos ? (
    <AutocompleteDropdown
      items={items}
      activeIdx={activeIdx}
      onSelect={confirmItem}
      onClose={close}
      anchorPos={anchorPos}
      triggerMode={triggerMode}
    />
  ) : null;

  return { inputProps, dropdown, open, close };
}

// ─── Dropdown Component ───────────────────────────────────────────────────────

interface DropdownProps {
  items: DropdownItem[];
  activeIdx: number;
  onSelect: (item: DropdownItem) => void;
  onClose: () => void;
  anchorPos: { top: number; left: number };
  triggerMode: TriggerMode;
}

const MODE_LABEL: Record<NonNullable<TriggerMode>, string> = {
  template:  '{{ Variables',
  jsonlogic: '{ JSON Logic',
  action:    '@ Actions',
};

function AutocompleteDropdown({ items, activeIdx, onSelect, onClose, anchorPos, triggerMode }: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Auto-scroll active item into view
  useEffect(() => {
    const el = ref.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // Group items
  const grouped = useMemo(() => {
    const groups: Record<string, DropdownItem[]> = {};
    for (const item of items) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    }
    return groups;
  }, [items]);

  return createPortal(
    <div
      ref={ref}
      data-testid="autocomplete-dropdown"
      style={{
        position: 'fixed',
        top: Math.min(anchorPos.top, window.innerHeight - 320),
        left: Math.min(anchorPos.left, window.innerWidth - 300),
        width: 300,
        maxHeight: 300,
        background: '#111827',
        border: '1px solid #3b82f6',
        borderRadius: 6,
        zIndex: 100001,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ padding: '4px 10px', borderBottom: '1px solid #1f2937', fontSize: 9, color: '#6b7280', background: '#0d1117', flexShrink: 0 }}>
        {triggerMode ? MODE_LABEL[triggerMode] : 'Autocomplete'} — ↑↓ navigate, Tab/Enter confirm
      </div>

      {/* Items */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {Object.entries(grouped).map(([group, groupItems]) => (
          <div key={group}>
            {Object.keys(grouped).length > 1 && (
              <div style={{ padding: '3px 10px 1px', fontSize: 9, color: '#4b5563', background: '#0d1117', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {group}
              </div>
            )}
            {groupItems.map(item => {
              const isActive = items.indexOf(item) === activeIdx;
              return (
                <div
                  key={item.key}
                  data-active={isActive ? 'true' : undefined}
                  onClick={() => onSelect(item)}
                  onMouseEnter={() => {}}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 10px',
                    background: isActive ? '#1d4ed8' : 'transparent',
                    cursor: 'pointer',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12, color: '#e5e7eb', fontFamily: 'monospace', fontWeight: isActive ? 600 : 400 }}>
                    {item.label}
                  </span>
                  <span style={{ fontSize: 10, color: isActive ? '#93c5fd' : '#9ca3af', flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.description}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─── Standalone AutocompleteInput component ──────────────────────────────────

interface AutocompleteInputProps {
  value: string;
  onChange: (v: string) => void;
  context?: AutocompleteContext;
  inMapContext?: boolean;
  placeholder?: string;
  multiline?: boolean;
  style?: React.CSSProperties;
}

export function AutocompleteInput({
  value,
  onChange,
  context = 'general',
  inMapContext = false,
  placeholder,
  multiline = false,
  style,
}: AutocompleteInputProps) {
  const { inputProps, dropdown } = useAutocomplete({ value, onChange, context, inMapContext });

  const baseStyle: React.CSSProperties = {
    width: '100%',
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 11,
    color: '#f3f4f6',
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'none',
    ...style,
  };

  if (multiline) {
    return (
      <>
        <textarea
          {...(inputProps as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          placeholder={placeholder}
          style={{ ...baseStyle, minHeight: 72 }}
        />
        {dropdown}
      </>
    );
  }

  return (
    <>
      <input
        {...inputProps}
        placeholder={placeholder}
        style={baseStyle}
      />
      {dropdown}
    </>
  );
}
