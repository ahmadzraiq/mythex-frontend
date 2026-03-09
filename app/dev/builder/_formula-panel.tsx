'use client';

/**
 * Formula Panel — lightweight wrappers used across the Design panel.
 *
 * Exports:
 *   FormulaValue        — value type for bound/unbound fields
 *   isBoundValue(v)     — true if value is a bound expression
 *   BindingIcon         — small ≈ button placed next to a field label
 *   FieldWithBinding    — wraps a field: shows input when unbound, ƒ Edit formula when bound
 *   FormulaButton       — @deprecated, kept for backward compat
 *
 * The actual editor UI lives in _formula-editor.tsx (WeWeb-style).
 */

import React, { useState, useEffect } from 'react';
import { FormulaEditor } from './_formula-editor';
import { isBoundValue, type FormulaValue } from '@/lib/sdui/formula-evaluator';
export type { FormulaValue } from '@/lib/sdui/formula-evaluator';
export { isBoundValue } from '@/lib/sdui/formula-evaluator';

// ─── Singleton: only one FormulaEditor open at a time ─────────────────────────

/** Close callbacks — cleared and called when a new editor opens */
const openEditorSubscribers = new Set<() => void>();

export function closeAllEditors() {
  const cbs = Array.from(openEditorSubscribers);
  openEditorSubscribers.clear();
  cbs.forEach(fn => fn());
}

export function registerEditorClose(closeSelf: () => void): () => void {
  openEditorSubscribers.add(closeSelf);
  return () => { openEditorSubscribers.delete(closeSelf); };
}

// ─── BindingIcon ──────────────────────────────────────────────────────────────

interface BindingIconProps {
  isBound: boolean;
  onClick: () => void;
  'data-testid'?: string;
}

export function BindingIcon({ isBound, onClick, 'data-testid': testId }: BindingIconProps) {
  return (
    <button
      type="button"
      data-testid={testId ?? 'binding-icon'}
      onClick={onClick}
      title={isBound ? 'Edit formula binding' : 'Bind to variable or expression'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        flexShrink: 0,
        cursor: 'pointer',
        border: 'none',
        borderRadius: 6,
        background: isBound ? '#3730a3' : '#1f2937',
        color: isBound ? '#a5b4fc' : '#6b7280',
        transition: 'background 0.15s, color 0.15s',
        padding: 0,
      }}
      onMouseEnter={e => {
        if (!isBound) {
          (e.currentTarget as HTMLElement).style.background = '#2d3748';
          (e.currentTarget as HTMLElement).style.color = '#a5b4fc';
        }
      }}
      onMouseLeave={e => {
        if (!isBound) {
          (e.currentTarget as HTMLElement).style.background = '#1f2937';
          (e.currentTarget as HTMLElement).style.color = '#6b7280';
        }
      }}
    >
      {/* Chain-link / bind icon */}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l2-2a3.5 3.5 0 0 0-4.95-4.95l-1.1 1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0l-2 2a3.5 3.5 0 0 0 4.95 4.95l1.1-1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

// ─── FieldWithBinding ─────────────────────────────────────────────────────────

interface FieldWithBindingProps {
  label: string;
  /** Short human-readable label shown above "ƒ Edit formula" when bound (e.g. "W", "H", "Gap"). */
  displayLabel?: string;
  /** Hint text shown in FormulaEditor describing expected value format (e.g. "e.g. 200px, 50%, auto"). */
  hint?: string;
  value: FormulaValue;
  onChange: (v: FormulaValue) => void;
  children: React.ReactNode;
  expectedType?: 'string' | 'number' | 'boolean' | 'any';
  /**
   * stackLayout: puts the label + ≈ icon on one row (top), and children / "ƒ Edit formula" below.
   * Use when children are wide (e.g. toggle button groups) to prevent horizontal overflow.
   */
  stackLayout?: boolean;
  /**
   * headerTitle: renders a section-header row "TITLE  [bind icon]" at the top,
   * with children / formula below. Use for sections like Self Alignment where
   * the bind icon should sit beside the section title, not beside the controls.
   */
  headerTitle?: string;
  /**
   * topAlign: aligns bind icon to the top of the control instead of the bottom.
   * Use for tall controls like textarea where the icon should appear at the start.
   */
  topAlign?: boolean;
}

export function FieldWithBinding({
  label, displayLabel, hint, value, onChange, children, expectedType = 'any', stackLayout = false, headerTitle, topAlign = false,
}: FieldWithBindingProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const bound = isBoundValue(value);

  // Register close callback when panel is open — ensures only one editor is open at a time
  useEffect(() => {
    if (!panelOpen) return;
    const closeSelf = () => setPanelOpen(false);
    openEditorSubscribers.add(closeSelf);
    return () => { openEditorSubscribers.delete(closeSelf); };
  }, [panelOpen]);

  const openEditor = () => {
    closeAllEditors();
    setPanelOpen(true);
  };

  const editor = panelOpen ? (
    <FormulaEditor
      label={label}
      value={value}
      expectedType={expectedType}
      hint={hint}
      anchor="right"
      onChange={v => { onChange(v); setPanelOpen(false); }}
      onClose={() => setPanelOpen(false)}
    />
  ) : null;

  // ── Stack layout: label on top, content + bind icon on bottom row ────────────
  if (stackLayout) {
    return (
      <div data-field={label} style={{ position: 'relative', flex: 1 }}>
        {displayLabel && (
          <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>{displayLabel}</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {bound ? (
            <button
              data-testid="edit-formula-btn"
              onClick={openEditor}
              style={{
                flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              ƒ Edit formula
            </button>
          ) : (
            <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
          )}
          <BindingIcon isBound={bound} onClick={openEditor} />
        </div>
        {editor}
      </div>
    );
  }

  // ── Header-title layout: "TITLE  [bind]" on top, children/formula below ──────
  if (headerTitle) {
    return (
      <div data-field={label} style={{ position: 'relative' }}>
        {/* Title row — bind icon flush right */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {headerTitle}
          </span>
          <BindingIcon isBound={bound} onClick={openEditor} />
        </div>
        {/* Content row */}
        {bound ? (
          <button
            data-testid="edit-formula-btn"
            onClick={openEditor}
            style={{
              width: '100%', padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
              borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              textAlign: 'left',
            }}
          >
            ƒ Edit formula
          </button>
        ) : children}
        {editor}
      </div>
    );
  }

  // ── Default layout: children + icon side-by-side ─────────────────────────────
  return (
    <div data-field={label} style={{ position: 'relative', flex: 1 }}>
      {bound ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {displayLabel && (
            <span style={{ fontSize: 9, color: '#6b7280' }}>{displayLabel}</span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              data-testid="edit-formula-btn"
              onClick={openEditor}
              style={{
                flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              ƒ Edit formula
            </button>
            <BindingIcon isBound={true} onClick={openEditor} />
          </div>
        </div>
      ) : (
        /* alignItems: flex-end — bind icon aligns with the bottom (control row), not the label row above it */
        <div style={{ display: 'flex', alignItems: topAlign ? 'flex-start' : 'flex-end', gap: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
          <BindingIcon isBound={false} onClick={openEditor} />
        </div>
      )}
      {editor}
    </div>
  );
}

// ─── Legacy FormulaButton (kept for backward compatibility) ───────────────────

/** @deprecated Use FieldWithBinding instead */
export function FormulaButton({ value, onChange, label }: { value: FormulaValue; onChange: (v: FormulaValue) => void; label: string }) {
  return (
    <FieldWithBinding label={label} value={value} onChange={onChange}>
      <span style={{ fontSize: 10, color: '#6b7280' }}>{String(value)}</span>
    </FieldWithBinding>
  );
}
