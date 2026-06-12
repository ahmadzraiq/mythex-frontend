'use client';

/**
 * StorePath Picker — searchable dropdown for selecting store variable paths.
 *
 * Shows all known paths from:
 *   - route.* (path, slug, id, named params)
 *   - _workflow.lastAction / lastError / loading
 *   - $item.* / $index (when inMapContext = true)
 *   - auth.* / local.data.form.*
 *
 * Used by: ExprBuilder (var field), ActionBuilder (path fields), LogicPanel sections.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import routesConfig from '@/config/routes.json';

// ─── Path generation ──────────────────────────────────────────────────────────

export interface PathEntry {
  path: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | 'unknown';
  group: 'store' | 'screens' | 'route' | '_workflow' | '$item' | 'custom';
}

function inferType(v: unknown): PathEntry['type'] {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'string':  return 'string';
    case 'number':  return 'number';
    case 'boolean': return 'boolean';
    case 'object':  return 'object';
    default:        return 'unknown';
  }
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix: string,
  group: PathEntry['group'],
  out: PathEntry[],
  depth = 0,
) {
  if (depth > 4) return;
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const type = inferType(val);
    out.push({ path, label: path, type, group });
    if (type === 'object' && val !== null && depth < 3) {
      flattenObject(val as Record<string, unknown>, path, group, out, depth + 1);
    }
  }
}

function buildPaths(inMapContext = false): PathEntry[] {
  const paths: PathEntry[] = [];

  // globalContext.browser.*
  paths.push({ path: 'globalContext.browser.path', label: 'globalContext.browser.path', type: 'string', group: 'route' });
  paths.push({ path: 'globalContext.browser.url', label: 'globalContext.browser.url', type: 'string', group: 'route' });
  paths.push({ path: 'globalContext.browser.domain', label: 'globalContext.browser.domain', type: 'string', group: 'route' });
  paths.push({ path: 'globalContext.browser.query', label: 'globalContext.browser.query', type: 'object', group: 'route' });

  // auth.*
  paths.push({ path: 'auth.user', label: 'auth.user', type: 'object', group: 'store' });
  paths.push({ path: 'auth.token', label: 'auth.token', type: 'string', group: 'store' });

  // local form state
  paths.push({ path: 'local.data.form.formData', label: 'local.data.form.formData', type: 'object', group: 'store' });
  paths.push({ path: 'local.data.form.isSubmitted', label: 'local.data.form.isSubmitted', type: 'boolean', group: 'store' });
  paths.push({ path: 'local.data.form.isSubmitting', label: 'local.data.form.isSubmitting', type: 'boolean', group: 'store' });

  // _workflow
  paths.push({ path: '_workflow.lastAction', label: '_workflow.lastAction', type: 'string', group: '_workflow' });
  paths.push({ path: '_workflow.lastError',  label: '_workflow.lastError',  type: 'string', group: '_workflow' });
  paths.push({ path: '_workflow.loading',    label: '_workflow.loading',    type: 'boolean', group: '_workflow' });

  // $item context (inside map)
  if (inMapContext) {
    paths.push({ path: '$item', label: '$item (current item)', type: 'object', group: '$item' });
    paths.push({ path: '$item.id', label: '$item.id', type: 'string', group: '$item' });
    paths.push({ path: '$item.name', label: '$item.name', type: 'string', group: '$item' });
    paths.push({ path: '$item.title', label: '$item.title', type: 'string', group: '$item' });
    paths.push({ path: '$item.slug', label: '$item.slug', type: 'string', group: '$item' });
    paths.push({ path: '$item.price', label: '$item.price', type: 'number', group: '$item' });
    paths.push({ path: '$item.image', label: '$item.image', type: 'string', group: '$item' });
    paths.push({ path: '$index', label: '$index (loop index)', type: 'number', group: '$item' });
  }

  return paths;
}

// ─── Type badge ───────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<PathEntry['type'], string> = {
  string:  '#86efac',
  number:  '#93c5fd',
  boolean: '#fcd34d',
  array:   '#c4b5fd',
  object:  '#fb923c',
  null:    '#9ca3af',
  unknown: '#6b7280',
};

function TypeBadge({ type }: { type: PathEntry['type'] }) {
  return (
    <span style={{
      fontSize: 9,
      color: TYPE_COLOR[type],
      background: 'rgba(255,255,255,0.06)',
      padding: '1px 4px',
      borderRadius: 3,
      flexShrink: 0,
    }}>
      {type}
    </span>
  );
}

// ─── Group label ──────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<PathEntry['group'], string> = {
  '$item':    '$item — loop context',
  'store':    'Store',
  'screens':  'Screens',
  'route':    'Route',
  '_workflow':'Workflow',
  'custom':   'Custom',
};

// ─── Fuzzy match ──────────────────────────────────────────────────────────────

function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const found = h.indexOf(n[ni], hi);
    if (found === -1) return false;
    hi = found + 1;
  }
  return true;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PathPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  inMapContext?: boolean;
  /** If true, renders as an inline input with dropdown; if false, renders as a button */
  inline?: boolean;
  disabled?: boolean;
}

export function PathPicker({
  value,
  onChange,
  placeholder = 'store.path…',
  inMapContext = false,
  inline = true,
  disabled = false,
}: PathPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const allPaths = useMemo(() => buildPaths(inMapContext), [inMapContext]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return allPaths;
    return allPaths.filter(p => fuzzyMatch(p.path, q));
  }, [allPaths, query]);

  // Group filtered paths
  const grouped = useMemo(() => {
    const groups: Record<string, PathEntry[]> = {};
    for (const p of filtered) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    }
    return groups;
  }, [filtered]);

  const flatFiltered = filtered;

  const openDropdown = useCallback(() => {
    if (disabled) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) });
    }
    setOpen(true);
    setQuery(value);
    setActiveIdx(0);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [disabled, value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node) && !(e.target as Element)?.closest('[data-path-picker-dropdown]')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = (path: string) => {
    onChange(path);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, flatFiltered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && flatFiltered[activeIdx]) { select(flatFiltered[activeIdx].path); return; }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1 }}>
      <div
        onClick={openDropdown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: '#1f2937',
          border: '1px solid #374151',
          borderRadius: 4,
          padding: '3px 6px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          minHeight: 26,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ fontSize: 11, color: value ? '#93c5fd' : '#6b7280', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
          {value || placeholder}
        </span>
        <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)' }}>▼</span>
      </div>

      {open && dropdownPos && (
        <div
          data-path-picker-dropdown="1"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            maxHeight: 320,
            background: '#111827',
            border: '1px solid #374151',
            borderRadius: 6,
            zIndex: 100000,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Search input */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Filter paths…"
              style={{
                width: '100%',
                background: '#1f2937',
                border: '1px solid #374151',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 11,
                color: 'var(--bld-text-2)',
                fontFamily: 'monospace',
                outline: 'none',
              }}
              autoFocus
            />
          </div>

          {/* Grouped results */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {Object.keys(grouped).length === 0 && (
              <div style={{ padding: '8px 12px', color: 'var(--bld-text-disabled)', fontSize: 11 }}>No matches</div>
            )}
            {Object.entries(grouped).map(([group, entries]) => (
              <div key={group}>
                <div style={{ padding: '4px 10px 2px', fontSize: 9, color: 'var(--bld-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#0d1117' }}>
                  {GROUP_LABELS[group as PathEntry['group']] ?? group}
                </div>
                {entries.map((entry, i) => {
                  const globalIdx = flatFiltered.indexOf(entry);
                  const isActive = globalIdx === activeIdx;
                  return (
                    <div
                      key={entry.path}
                      onMouseEnter={() => setActiveIdx(globalIdx)}
                      onClick={() => select(entry.path)}
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
                      <span style={{ fontSize: 11, color: 'var(--bld-text-2)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.path}
                      </span>
                      <TypeBadge type={entry.type} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Free-type custom path */}
          {query && !flatFiltered.find(p => p.path === query) && (
            <div
              onClick={() => select(query)}
              style={{ padding: '6px 10px', borderTop: '1px solid #1f2937', cursor: 'pointer', fontSize: 11, color: 'var(--bld-text-3)', flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1f2937')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              Use custom path: <span style={{ color: '#93c5fd', fontFamily: 'monospace' }}>{query}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { buildPaths };
