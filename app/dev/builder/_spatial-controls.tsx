'use client';

/**
 * _spatial-controls.tsx
 *
 * Figma-style spatial input diagrams — controls are physically positioned
 * to match the property they affect.
 *
 * Exports:
 *  - SpacingDiagram      — padding / margin: 4 inputs around a center box + link-all toggle
 *  - CornerRadiusDiagram — border radius: 2×2 grid with corner icons + link-all toggle
 *  - InsetDiagram        — position insets: compass cross layout
 *  - XYOffsetControl     — side-by-side x/y inputs for animation offsets
 */

import React, { useState, useEffect, useRef } from 'react';
import { isBoundValue, type FormulaValue } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';

// Suppress browser number spinner arrows via a globally-injected style block.
if (typeof document !== 'undefined' && !document.getElementById('spatial-no-spin')) {
  const s = document.createElement('style');
  s.id = 'spatial-no-spin';
  s.textContent = `
    .spatial-input::-webkit-inner-spin-button,
    .spatial-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .spatial-input { -moz-appearance: textfield; }
  `;
  document.head.appendChild(s);
}

// ─── Shared icons ─────────────────────────────────────────────────────────────

const ArrowUp = () => (
  <svg width={7} height={7} viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, display: 'block' }}>
    <path d="M4 7V1M1.5 3.5L4 1l2.5 2.5" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ArrowDown = () => (
  <svg width={7} height={7} viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, display: 'block' }}>
    <path d="M4 1v6M1.5 4.5L4 7l2.5-2.5" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ArrowLeft = () => (
  <svg width={7} height={7} viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, display: 'block' }}>
    <path d="M7 4H1M3.5 1.5L1 4l2.5 2.5" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ArrowRight = () => (
  <svg width={7} height={7} viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, display: 'block' }}>
    <path d="M1 4h6M4.5 1.5L7 4l-2.5 2.5" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function LinkIcon({ linked }: { linked: boolean }) {
  const c = linked ? '#818cf8' : '#4b5563';
  return (
    <svg width={11} height={11} viewBox="0 0 12 12" fill="none">
      <path d="M4.5 6h3" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3 4.5A2 2 0 003 7.5" stroke={c} strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M9 4.5A2 2 0 019 7.5" stroke={c} strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// Small chain icon for bind buttons
function ChainIcon({ bound }: { bound: boolean }) {
  const c = bound ? '#818cf8' : '#6b7280';
  return (
    <svg width={9} height={9} viewBox="0 0 10 10" fill="none">
      <path d="M3.5 5h3" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M2 3.5A2 2 0 002 6.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M8 3.5A2 2 0 018 6.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ─── PanelInput ───────────────────────────────────────────────────────────────

export function PanelInput({
  value, onChange, testId, min = -9999, max = 9999, step = 1, width = 44, bound = false,
}: {
  value: number; onChange: (v: number) => void;
  testId?: string; min?: number; max?: number; step?: number; width?: number;
  bound?: boolean;
}) {
  const [local, setLocal] = useState(String(value));
  const liveRef = useRef(Number(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itvRef  = useRef<ReturnType<typeof setInterval>  | null>(null);

  useEffect(() => { liveRef.current = Number(value); setLocal(String(value)); }, [value]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { clear(); }, []);

  const clear = () => {
    if (delayRef.current) { clearTimeout(delayRef.current);  delayRef.current = null; }
    if (itvRef.current)   { clearInterval(itvRef.current);   itvRef.current   = null; }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (e.repeat) return;
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    const el = inputRef.current;
    const fire = () => {
      const n = Math.min(max, Math.max(min, liveRef.current + dir * step));
      liveRef.current = n; setLocal(String(n));
      if (el) el.value = String(n);
      onChange(n);
    };
    fire(); clear();
    delayRef.current = setTimeout(() => { itvRef.current = setInterval(fire, 50); }, 250);
  };

  return (
    <input
      ref={inputRef}
      className="spatial-input"
      data-testid={testId}
      type="number"
      min={min} max={max} step={step}
      value={local}
      onChange={e => {
        setLocal(e.target.value);
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) { liveRef.current = n; onChange(n); }
      }}
      onKeyDown={onKeyDown}
      onKeyUp={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') clear(); }}
      onBlur={e => {
        clear();
        const dom = Number(e.currentTarget.value);
        const live = Number.isNaN(dom) ? liveRef.current : dom;
        liveRef.current = live;
        if (live !== Number(value)) onChange(live);
        setLocal(String(live));
      }}
      style={{
        width,
        background: '#1f2937',
        border: `1px solid ${bound ? '#6366f1' : '#374151'}`,
        borderRadius: 4,
        color: bound ? '#a5b4fc' : '#f3f4f6',
        fontSize: 11,
        padding: '3px 4px',
        textAlign: 'center',
        boxSizing: 'border-box',
      } as React.CSSProperties}
    />
  );
}

// ─── SpacingCell ──────────────────────────────────────────────────────────────
// A single directional cell: arrow icon + input + optional bind button.

type SpacingSide = 'top' | 'right' | 'bottom' | 'left';

function SpacingCell({
  side, value, icon, isHoriz, onChange,
  formulaValue, onFormulaChange, fieldLabel, testId,
}: {
  side: SpacingSide;
  value: number;
  icon: React.ReactNode;
  isHoriz: boolean;
  onChange: (v: number) => void;
  formulaValue?: FormulaValue;
  onFormulaChange?: (v: FormulaValue) => void;
  fieldLabel: string;
  testId?: string;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const showBind = !!onFormulaChange;
  const bound = showBind && formulaValue !== undefined && isBoundValue(formulaValue);

  return (
    <div style={{
      display: 'flex',
      flexDirection: isHoriz ? 'row' : 'column',
      alignItems: 'center',
      gap: isHoriz ? 2 : 2,
    }}>
      {icon}
      <div style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
        <PanelInput
          value={value}
          onChange={onChange}
          testId={testId}
          width={40}
          bound={bound}
        />
        {showBind && (
          <button
            type="button"
            title={bound ? 'Edit formula binding' : 'Bind to formula'}
            onClick={() => setEditorOpen(o => !o)}
            style={{
              width: 14, height: 14, padding: 0, flexShrink: 0,
              background: bound ? 'rgba(99,102,241,0.15)' : 'transparent',
              border: `1px solid ${bound ? '#6366f1' : '#374151'}`,
              borderRadius: 3,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ChainIcon bound={bound} />
          </button>
        )}
        {editorOpen && (
          <FormulaEditor
            label={`${fieldLabel}-${side}`}
            value={bound ? formulaValue! : value}
            onChange={v => {
              if (onFormulaChange) onFormulaChange(v);
              setEditorOpen(false);
            }}
            onClose={() => setEditorOpen(false)}
            anchor="right"
          />
        )}
      </div>
    </div>
  );
}

// ─── SpacingDiagram ───────────────────────────────────────────────────────────

export interface SpacingValues { top: number; right: number; bottom: number; left: number; }

export function SpacingDiagram({
  values, onChange, onChangeAll, formulaValues, onFormulaChange, label = 'padding', testIdPrefix,
}: {
  values: SpacingValues;
  onChange: (side: SpacingSide, v: number) => void;
  onChangeAll?: (v: number) => void;
  formulaValues?: Partial<Record<SpacingSide, FormulaValue>>;
  onFormulaChange?: (side: SpacingSide, v: FormulaValue) => void;
  label?: string;
  testIdPrefix?: string;
}) {
  const [linked, setLinked] = useState(
    values.top === values.right && values.right === values.bottom && values.bottom === values.left
  );

  const handleChange = (side: SpacingSide, v: number) => {
    if (linked) {
      if (onChangeAll) { onChangeAll(v); return; }
      (['top', 'right', 'bottom', 'left'] as SpacingSide[]).forEach(s => onChange(s, v));
    } else {
      onChange(side, v);
    }
  };

  const sides: SpacingSide[] = ['top', 'right', 'bottom', 'left'];
  const icons: Record<SpacingSide, React.ReactNode> = {
    top: <ArrowUp />, right: <ArrowRight />, bottom: <ArrowDown />, left: <ArrowLeft />,
  };

  const cell = (side: SpacingSide, isHoriz: boolean) => (
    <SpacingCell
      key={side}
      side={side}
      value={values[side]}
      icon={icons[side]}
      isHoriz={isHoriz}
      onChange={v => handleChange(side, v)}
      formulaValue={formulaValues?.[side]}
      onFormulaChange={onFormulaChange ? (v) => {
        if (linked) sides.forEach(s => onFormulaChange(s, v));
        else onFormulaChange(side, v);
      } : undefined}
      fieldLabel={label}
      testId={testIdPrefix ? `input-${testIdPrefix}-${side}` : undefined}
    />
  );

  return (
    <div>
      <span style={{ fontSize: 9, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 6 }}>
        {label}
      </span>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gridTemplateRows: 'auto auto auto',
        gap: 4,
        alignItems: 'center',
        justifyItems: 'center',
      }}>
        {/* Row 1 — top */}
        <div />
        {cell('top', false)}
        <div />
        {/* Row 2 — left / center / right */}
        {cell('left', true)}
        <div style={{
          width: '100%', minHeight: 28,
          background: '#1a2234', border: '1px dashed #2d3748', borderRadius: 3,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 8, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', userSelect: 'none' }}>
            {label === 'padding' ? 'content' : 'element'}
          </span>
        </div>
        {cell('right', true)}
        {/* Row 3 — bottom */}
        <div />
        {cell('bottom', false)}
        <div />
      </div>

      {/* Link-all toggle */}
      <button
        type="button"
        onClick={() => setLinked(l => !l)}
        title={linked ? 'Unlink sides' : 'Link all sides'}
        style={{
          marginTop: 5, width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          background: linked ? 'rgba(99,102,241,0.1)' : '#111827',
          border: `1px solid ${linked ? '#6366f1' : '#1f2937'}`,
          borderRadius: 4, cursor: 'pointer', padding: '3px 8px',
          color: linked ? '#a5b4fc' : '#4b5563', fontSize: 10, fontWeight: 500,
        }}
      >
        <LinkIcon linked={linked} />
        {linked ? 'All sides linked' : 'Link sides'}
      </button>
    </div>
  );
}

// ─── CornerRadiusDiagram ──────────────────────────────────────────────────────

export interface CornerValues { tl: number; tr: number; br: number; bl: number; }
type CornerKey = keyof CornerValues;

const CORNER_SVG_D: Record<CornerKey, string> = {
  tl: 'M10 2 Q2 2 2 10',
  tr: 'M2 2 Q10 2 10 10',
  br: 'M2 10 Q10 10 10 2',
  bl: 'M10 10 Q2 10 2 2',
};
const CORNER_ORDER: CornerKey[] = ['tl', 'tr', 'bl', 'br'];

export function CornerRadiusDiagram({
  values, onChange, onChangeAll,
}: {
  values: CornerValues;
  onChange: (corner: CornerKey, v: number) => void;
  onChangeAll?: (v: number) => void;
}) {
  const [linked, setLinked] = useState(
    values.tl === values.tr && values.tr === values.br && values.br === values.bl
  );

  const handleChange = (corner: CornerKey, v: number) => {
    if (linked && onChangeAll) { onChangeAll(v); return; }
    if (linked) { (['tl', 'tr', 'br', 'bl'] as CornerKey[]).forEach(c => onChange(c, v)); return; }
    onChange(corner, v);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
        {CORNER_ORDER.map(corner => (
          <div key={corner} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: '#1f2937', border: '1px solid #374151', borderRadius: 4, padding: '4px 7px',
          }}>
            <svg width={10} height={10} viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
              <path d={CORNER_SVG_D[corner]} stroke="#4b5563" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            </svg>
            <input
              className="spatial-input"
              data-testid={`input-corner-${corner}`}
              type="number" min={0} max={999} step={1}
              defaultValue={values[corner]}
              key={`${corner}-${values[corner]}`}
              onChange={e => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n)) handleChange(corner, n);
              }}
              onBlur={e => {
                const n = Number(e.currentTarget.value);
                if (!Number.isNaN(n)) handleChange(corner, n);
              }}
              style={{
                flex: 1, minWidth: 0,
                background: 'transparent', border: 'none', outline: 'none',
                color: '#f3f4f6', fontSize: 11, padding: 0, textAlign: 'left',
              } as React.CSSProperties}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setLinked(l => !l)}
        title={linked ? 'Unlink corners' : 'Link all corners'}
        style={{
          marginTop: 5, width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          background: linked ? 'rgba(99,102,241,0.1)' : '#111827',
          border: `1px solid ${linked ? '#6366f1' : '#1f2937'}`,
          borderRadius: 4, cursor: 'pointer', padding: '3px 8px',
          color: linked ? '#a5b4fc' : '#4b5563', fontSize: 10, fontWeight: 500,
        }}
      >
        <LinkIcon linked={linked} />
        {linked ? 'All corners linked' : 'Link corners'}
      </button>
    </div>
  );
}

// ─── InsetDiagram ─────────────────────────────────────────────────────────────

export function InsetDiagram({
  values, onChange, testIdPrefix = 'input-inset',
}: {
  values: SpacingValues;
  onChange: (side: SpacingSide, v: number) => void;
  testIdPrefix?: string;
}) {
  const cell = (side: SpacingSide, icon: React.ReactNode, isHoriz: boolean) => (
    <div style={{ display: 'flex', flexDirection: isHoriz ? 'row' : 'column', alignItems: 'center', gap: 2 }}>
      {icon}
      <PanelInput value={values[side]} onChange={v => onChange(side, v)} testId={`${testIdPrefix}-${side}`} width={40} />
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto', gap: 4, alignItems: 'center', justifyItems: 'center' }}>
      <div />
      {cell('top', <ArrowUp />, false)}
      <div />
      {cell('left', <ArrowLeft />, true)}
      <div style={{ width: 24, height: 24, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="1.5" fill="#4b5563" />
          <line x1="5" y1="1" x2="5" y2="3.5" stroke="#4b5563" strokeWidth="1" strokeLinecap="round" />
          <line x1="5" y1="6.5" x2="5" y2="9" stroke="#4b5563" strokeWidth="1" strokeLinecap="round" />
          <line x1="1" y1="5" x2="3.5" y2="5" stroke="#4b5563" strokeWidth="1" strokeLinecap="round" />
          <line x1="6.5" y1="5" x2="9" y2="5" stroke="#4b5563" strokeWidth="1" strokeLinecap="round" />
        </svg>
      </div>
      {cell('right', <ArrowRight />, true)}
      <div />
      {cell('bottom', <ArrowDown />, false)}
      <div />
    </div>
  );
}

// ─── XYOffsetControl ──────────────────────────────────────────────────────────

export function XYOffsetControl({
  x, y, onChangeX, onChangeY, min = -200, max = 200,
}: {
  x: number; y: number;
  onChangeX: (v: number) => void; onChangeY: (v: number) => void;
  min?: number; max?: number;
}) {
  const axis = (axisLabel: string, icon: React.ReactNode, val: number, onChg: (v: number) => void) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {icon}
        <span style={{ fontSize: 9, color: '#6b7280' }}>{axisLabel}</span>
      </div>
      <PanelInput value={val} onChange={onChg} width={50} min={min} max={max} />
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {axis('X', (
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
          <path d="M1 5h8M6 2l3 3-3 3M4 2L1 5l3 3" stroke="#6b7280" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ), x, onChangeX)}
      {axis('Y', (
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
          <path d="M5 1v8M2 6l3 3 3-3M2 4L5 1l3 3" stroke="#6b7280" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ), y, onChangeY)}
    </div>
  );
}
