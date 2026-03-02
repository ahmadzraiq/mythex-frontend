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

import React, { useState } from 'react';
import { FormulaEditor } from './_formula-editor';
import { isBoundValue, type FormulaValue } from '@/lib/sdui/formula-evaluator';
export type { FormulaValue } from '@/lib/sdui/formula-evaluator';
export { isBoundValue } from '@/lib/sdui/formula-evaluator';

// ─── BindingIcon ──────────────────────────────────────────────────────────────

interface BindingIconProps {
  isBound: boolean;
  onClick: () => void;
}

export function BindingIcon({ isBound, onClick }: BindingIconProps) {
  return (
    <button
      data-testid="binding-icon"
      onClick={onClick}
      title={isBound ? 'Edit formula binding' : 'Bind to variable or expression'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: isBound ? '#818cf8' : '#4b5563',
        fontSize: 12,
        lineHeight: 1,
        padding: '1px 3px',
        flexShrink: 0,
        borderRadius: 3,
        transition: 'color 0.15s',
      }}
      onMouseEnter={e => { if (!isBound) (e.currentTarget as HTMLElement).style.color = '#818cf8'; }}
      onMouseLeave={e => { if (!isBound) (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
    >
      ≈
    </button>
  );
}

// ─── FieldWithBinding ─────────────────────────────────────────────────────────

interface FieldWithBindingProps {
  label: string;
  value: FormulaValue;
  onChange: (v: FormulaValue) => void;
  children: React.ReactNode;
  expectedType?: 'string' | 'number' | 'boolean' | 'any';
}

export function FieldWithBinding({ label, value, onChange, children, expectedType = 'any' }: FieldWithBindingProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const bound = isBoundValue(value);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
      {/* Regular input (hidden when bound) */}
      {!bound && <div style={{ flex: 1, minWidth: 0 }}>{children}</div>}

      {/* "ƒ Edit formula" button shown when bound */}
      {bound && (
        <button
          data-testid="edit-formula-btn"
          onClick={() => setPanelOpen(true)}
          style={{
            flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
            borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
            textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          ƒ Edit formula
        </button>
      )}

      {/* Binding icon — always visible */}
      <BindingIcon isBound={bound} onClick={() => setPanelOpen(true)} />

      {/* WeWeb-style FormulaEditor */}
      {panelOpen && (
        <FormulaEditor
          label={label}
          value={value}
          expectedType={expectedType}
          onChange={v => { onChange(v); setPanelOpen(false); }}
          onClose={() => setPanelOpen(false)}
        />
      )}
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
