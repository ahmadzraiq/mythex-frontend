'use client';

/**
 * Expression Builder — thin wrapper around FormulaEditor.
 *
 * All previous modes (visual, ifthen, template, raw, Preview JSON) have been
 * replaced by the unified WeWeb-style FormulaEditor.
 *
 * The public interface (ExprBuilder, SimpleCondition, ExprMode, VisualRow,
 * IfBranch) is preserved for call-site compatibility.
 */

import React, { useState } from 'react';
import { FormulaEditor, storedValueToFormula, formulaToStoredValue } from './_formula-editor';

// ─── Types (kept for import compatibility) ────────────────────────────────────

export type ExprMode = 'visual' | 'ifthen' | 'template' | 'raw';

export interface VisualRow {
  id: string;
  field: string;
  operator: string;
  value: string;
  connector: 'and' | 'or';
}

export interface IfBranch {
  id: string;
  field: string;
  operator: string;
  operand: string;
  result: string;
  isElse?: boolean;
}

// ─── ExprBuilder ──────────────────────────────────────────────────────────────

interface ExprBuilderProps {
  value: object | string | null;
  onChange: (v: object | string | null) => void;
  context?: 'condition' | 'value' | 'text' | 'general';
  inMapContext?: boolean;
  defaultMode?: ExprMode;
  compact?: boolean;
  label?: string;
}

export function ExprBuilder({
  value,
  onChange,
  label = 'Expression',
}: ExprBuilderProps) {
  const [open, setOpen] = useState(false);

  const displayText = value === null || value === undefined
    ? ''
    : typeof value === 'string'
      ? storedValueToFormula(value)
      : JSON.stringify(value);

  const isBound = value !== null && value !== undefined && value !== '';

  return (
    <div style={{ position: 'relative' }}>
      {/* Inline preview / open button */}
      <button
        data-testid="expr-builder-open"
        onClick={() => setOpen(true)}
        style={{
          width: '100%', padding: '4px 8px', textAlign: 'left',
          background: isBound ? '#2e1065' : '#1f2937',
          border: `1px solid ${isBound ? '#7c3aed' : '#374151'}`,
          borderRadius: 5, color: isBound ? '#a78bfa' : '#6b7280',
          fontSize: 11, cursor: 'pointer', fontFamily: 'monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {isBound ? `ƒ ${displayText}` : '+ Add expression…'}
      </button>

      {open && (
        <FormulaEditor
          label={label}
          value={value as import('./_formula-editor').FormulaValue}
          expectedType="boolean"
          onChange={v => {
            onChange(v as object | string | null);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ─── SimpleCondition ──────────────────────────────────────────────────────────

interface SimpleConditionProps {
  value: object | null;
  onChange: (v: object | null) => void;
  inMapContext?: boolean;
  placeholder?: string;
}

export function SimpleCondition({ value, onChange }: SimpleConditionProps) {
  const [open, setOpen] = useState(false);
  const isBound = value !== null && value !== undefined;
  const displayText = isBound ? JSON.stringify(value) : '';

  return (
    <div style={{ position: 'relative' }}>
      <button
        data-testid="simple-condition-open"
        onClick={() => setOpen(true)}
        style={{
          width: '100%', padding: '3px 8px', textAlign: 'left',
          background: isBound ? '#2e1065' : '#1f2937',
          border: `1px solid ${isBound ? '#7c3aed' : '#374151'}`,
          borderRadius: 4, color: isBound ? '#a78bfa' : '#6b7280',
          fontSize: 10, cursor: 'pointer', fontFamily: 'monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {isBound ? `ƒ ${displayText.slice(0, 40)}…` : '+ Condition'}
      </button>

      {open && (
        <FormulaEditor
          label="Condition"
          value={value as import('./_formula-editor').FormulaValue}
          expectedType="boolean"
          onChange={v => {
            onChange(formulaToStoredValue(
              typeof v === 'string' ? v : JSON.stringify(v)
            ) as object | null);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
