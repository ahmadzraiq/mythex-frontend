'use client';

/**
 * _panel-primitives.tsx
 *
 * Shared UI atoms and style constants for the builder right panel.
 * Extracted from _panel-right.tsx — used by DesignTab, SettingsTab, and GridOverlayPanel.
 *
 * Exports:
 *  - PANEL_STYLE, SECTION_STYLE, LABEL_STYLE
 *  - SectionHeader
 *  - NumberInput, SelectInput, ColorInput, ToggleBtn
 */

import React, { useState, useEffect, useRef } from 'react';

// ─── Shared styles ────────────────────────────────────────────────────────────

export const PANEL_STYLE: React.CSSProperties = {
  width: 260,
  display: 'flex',
  flexDirection: 'column',
  background: '#111827',
  borderLeft: '1px solid #1f2937',
  overflow: 'hidden',
};

export const SECTION_STYLE: React.CSSProperties = {
  borderBottom: '1px solid #1f2937',
  padding: '10px 12px',
};

export const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: '#9ca3af',
  marginBottom: 6,
  display: 'block',
};

// ─── SectionHeader ────────────────────────────────────────────────────────────

export function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={LABEL_STYLE}>{title}</span>
      {children}
    </div>
  );
}

// ─── NumberInput ──────────────────────────────────────────────────────────────

export function NumberInput({
  label, value, onChange, min = 0, max = 9999, step = 1, testId, onFocus,
}: { label: string; value: number | string; onChange: (v: number) => void; min?: number; max?: number; step?: number; testId?: string; onFocus?: () => void }) {
  const [local, setLocal] = useState(String(value));
  const liveRef    = useRef(Number(value));
  const inputRef   = useRef<HTMLInputElement | null>(null);
  const delayRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    liveRef.current = Number(value);
    setLocal(String(value));
  }, [value]);

  // Clean up repeat timers on unmount
  useEffect(() => () => { clearRepeat(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearRepeat = () => {
    if (delayRef.current)    { clearTimeout(delayRef.current);    delayRef.current    = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  const handleChange = (raw: string) => {
    setLocal(raw);
    const n = Number(raw);
    if (!Number.isNaN(n)) { liveRef.current = n; onChange(n); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (e.repeat) return;

    const direction = e.key === 'ArrowUp' ? 1 : -1;
    const inp = inputRef.current;

    const fire = () => {
      const newVal = Math.min(max, Math.max(min, liveRef.current + direction * step));
      liveRef.current = newVal;
      setLocal(String(newVal));
      if (inp) inp.value = String(newVal);
      onChange(newVal);
    };

    fire();
    clearRepeat();
    delayRef.current = setTimeout(() => {
      intervalRef.current = setInterval(fire, 50);
    }, 250);
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') clearRepeat();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
      <span style={{ fontSize: 9, color: '#6b7280' }}>{label}</span>
      <input
        ref={inputRef}
        data-testid={testId}
        type="number" min={min} max={max} step={step} value={local}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={onFocus}
        onBlur={e => {
          clearRepeat();
          const domVal = Number(e.currentTarget.value);
          const live   = Number.isNaN(domVal) ? liveRef.current : domVal;
          liveRef.current = live;
          if (live !== Number(value)) onChange(live);
          setLocal(String(live));
        }}
        style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', width: '100%', boxSizing: 'border-box' }}
      />
    </div>
  );
}

// ─── SelectInput ──────────────────────────────────────────────────────────────

export function SelectInput({
  label, value, options, onChange, testId,
}: { label: string; value: string; options: readonly string[] | string[]; onChange: (v: string) => void; testId?: string }) {
  return (
    <div style={{ flex: 1 }}>
      {label && <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>{label}</span>}
      <select
        data-testid={testId}
        value={value} onChange={e => onChange(e.target.value)}
        style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 5px', width: '100%' }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ─── ColorInput ───────────────────────────────────────────────────────────────

export function ColorInput({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId?: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="color" value={local.startsWith('#') ? local : '#000000'}
        onChange={e => { setLocal(e.target.value); onChange(e.target.value); }}
        style={{ width: 26, height: 26, padding: 0, border: '1px solid #374151', borderRadius: 4, background: 'none', cursor: 'pointer' }}
      />
      <div style={{ flex: 1 }}>
        {label && <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>{label}</span>}
        <input
          data-testid={testId}
          value={local} onChange={e => setLocal(e.target.value)} onBlur={() => onChange(local)}
          placeholder="#000000"
          style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', width: '100%', boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
}

// ─── ToggleBtn ────────────────────────────────────────────────────────────────

export function ToggleBtn({ active, onClick, title, children, 'data-testid': testId }: { active?: boolean; onClick: () => void; title?: string; children: React.ReactNode; 'data-testid'?: string }) {
  return (
    <button
      onClick={onClick} title={title} data-testid={testId} data-active={String(!!active)}
      style={{ padding: '3px 7px', fontSize: 11, background: active ? '#3b82f6' : '#1f2937', border: `1px solid ${active ? '#3b82f6' : '#374151'}`, color: active ? '#fff' : '#9ca3af', borderRadius: 4, cursor: 'pointer', lineHeight: 1 }}
    >
      {children}
    </button>
  );
}
