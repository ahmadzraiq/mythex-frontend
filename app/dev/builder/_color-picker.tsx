'use client';

/**
 * FigmaColorPicker — Figma-style color picker popover.
 *
 * Shows:
 *  1. Named theme color swatches (from config/theme.json + live store overrides)
 *  2. A native <input type="color"> + editable hex field for custom colors
 *
 * The popover is rendered into document.body via a React portal and uses
 * position:fixed so it is NEVER clipped by parent overflow:hidden containers.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import themeConfig from '@/config/theme.json';
import { useBuilderStore } from './_store';

// ─── Theme color definitions ──────────────────────────────────────────────────

interface ThemeSwatch {
  label: string;
  cssVar: string;
  defaultHex: string;
}

const LIGHT_DEFAULTS = themeConfig.cssVariables.root as Record<string, string>;

const GLOBAL_SWATCHES: ThemeSwatch[] = [
  { label: 'Background',    cssVar: 'background',            defaultHex: LIGHT_DEFAULTS['--background']            ?? '#ffffff' },
  { label: 'Foreground',    cssVar: 'foreground',            defaultHex: LIGHT_DEFAULTS['--foreground']            ?? '#171923' },
  { label: 'Primary',       cssVar: 'primary',               defaultHex: LIGHT_DEFAULTS['--primary']               ?? '#1e293b' },
  { label: 'Pri. Text',     cssVar: 'primary-foreground',    defaultHex: LIGHT_DEFAULTS['--primary-foreground']    ?? '#f8fafc' },
  { label: 'Secondary',     cssVar: 'secondary',             defaultHex: LIGHT_DEFAULTS['--secondary']             ?? '#f1f5f9' },
  { label: 'Sec. Text',     cssVar: 'secondary-foreground',  defaultHex: LIGHT_DEFAULTS['--secondary-foreground']  ?? '#1e293b' },
  { label: 'Muted',         cssVar: 'muted',                 defaultHex: LIGHT_DEFAULTS['--muted']                 ?? '#f1f5f9' },
  { label: 'Muted Text',    cssVar: 'muted-foreground',      defaultHex: LIGHT_DEFAULTS['--muted-foreground']      ?? '#64748b' },
  { label: 'Accent',        cssVar: 'accent',                defaultHex: LIGHT_DEFAULTS['--accent']                ?? '#f1f5f9' },
  { label: 'Acc. Text',     cssVar: 'accent-foreground',     defaultHex: LIGHT_DEFAULTS['--accent-foreground']     ?? '#1e293b' },
  { label: 'Destructive',   cssVar: 'destructive',           defaultHex: LIGHT_DEFAULTS['--destructive']           ?? '#ef4444' },
  { label: 'Dest. Text',    cssVar: 'destructive-foreground',defaultHex: LIGHT_DEFAULTS['--destructive-foreground']?? '#ffffff' },
  { label: 'Card',          cssVar: 'card',                  defaultHex: LIGHT_DEFAULTS['--card']                  ?? '#ffffff' },
  { label: 'Card Text',     cssVar: 'card-foreground',       defaultHex: LIGHT_DEFAULTS['--card-foreground']       ?? '#171923' },
  { label: 'Border',        cssVar: 'border',                defaultHex: LIGHT_DEFAULTS['--border']                ?? '#e2e8f0' },
  { label: 'Input',         cssVar: 'input',                 defaultHex: LIGHT_DEFAULTS['--input']                 ?? '#e2e8f0' },
  { label: 'Ring',          cssVar: 'ring',                  defaultHex: LIGHT_DEFAULTS['--ring']                  ?? '#94a3b8' },
];


// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveCssVar(cssVar: string): string | null {
  if (typeof document === 'undefined') return null;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${cssVar}`)
    .trim();
  if (!raw) return null;
  if (raw.startsWith('#')) return raw;
  // Handle `rgb(R, G, B)` or `rgb(R G B)` format
  const rgbMatch = raw.match(/rgb\(?\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgbMatch) {
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `#${h(+rgbMatch[1])}${h(+rgbMatch[2])}${h(+rgbMatch[3])}`;
  }
  // Handle bare `R G B` triplet (ThemeStyles format)
  const tripletMatch = raw.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (tripletMatch) {
    const h = (n: number) => Number(n).toString(16).padStart(2, '0');
    return `#${h(+tripletMatch[1])}${h(+tripletMatch[2])}${h(+tripletMatch[3])}`;
  }
  return null;
}

function isValidHex(s: string) {
  return /^#[0-9a-fA-F]{3,8}$/.test(s);
}

// ─── Swatch ───────────────────────────────────────────────────────────────────

function Swatch({
  label, cssVar, defaultHex, currentValue, onSelect, overrides,
}: {
  label: string; cssVar: string; defaultHex: string;
  currentValue: string; onSelect: (hex: string) => void;
  overrides: Record<string, string>;
}) {
  const resolved = overrides[cssVar] ?? resolveCssVar(cssVar) ?? defaultHex;
  const isActive = currentValue.toLowerCase() === resolved.toLowerCase();
  return (
    <div
      title={`${label}\n${resolved}`}
      onClick={() => onSelect(resolved)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        cursor: 'pointer', padding: '4px 2px', borderRadius: 4,
        background: isActive ? 'rgba(59,130,246,0.18)' : 'transparent',
      }}
    >
      <div style={{
        width: 24, height: 24, borderRadius: 5,
        background: resolved,
        border: isActive ? '2px solid #3b82f6' : '1.5px solid rgba(255,255,255,0.18)',
        boxSizing: 'border-box', flexShrink: 0,
      }} />
      <span style={{
        fontSize: 8, color: '#9ca3af', whiteSpace: 'nowrap',
        maxWidth: 36, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center',
      }}>
        {label}
      </span>
    </div>
  );
}

// ─── Popover portal ───────────────────────────────────────────────────────────

interface PopoverProps {
  anchorRect: DOMRect;
  onClose: () => void;
  value: string;
  onSelect: (hex: string) => void;
  hexInput: string;
  setHexInput: (v: string) => void;
  handleHexCommit: (v: string) => void;
  themeOverrides: Record<string, string>;
}

function ColorPopover({
  anchorRect, onClose, value, onSelect,
  hexInput, setHexInput, handleHexCommit, themeOverrides,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const displayColor = value.startsWith('#') ? value : '#000000';

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Small delay so native color picker dialog clicks don't immediately close
        setTimeout(() => onClose(), 0);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Position: below the anchor, flip up if not enough space
  const POPOVER_HEIGHT = 380;
  const POPOVER_WIDTH  = 248;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow >= POPOVER_HEIGHT
    ? anchorRect.bottom + 6
    : anchorRect.top - POPOVER_HEIGHT - 6;
  const left = Math.min(anchorRect.left, window.innerWidth - POPOVER_WIDTH - 8);

  return ReactDOM.createPortal(
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', top, left,
        zIndex: 99999,
        width: POPOVER_WIDTH,
        background: '#111827',
        border: '1px solid #374151',
        borderRadius: 10,
        padding: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
      }}
    >
      {/* ── Theme Colors ── */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
          Theme Colors
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1 }}>
          {GLOBAL_SWATCHES.map(s => (
            <Swatch key={s.cssVar} {...s} currentValue={value} onSelect={onSelect} overrides={themeOverrides} />
          ))}
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: '1px solid #1f2937', margin: '8px 0' }} />

      {/* ── Custom ── */}
      <div>
        <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Custom
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="color"
            value={displayColor}
            onChange={e => { setHexInput(e.target.value); onSelect(e.target.value); }}
            style={{ width: 38, height: 38, padding: 0, border: '1px solid #374151', borderRadius: 6, background: 'none', cursor: 'pointer', flexShrink: 0 }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 3 }}>Hex</div>
            <input
              value={hexInput}
              onChange={e => setHexInput(e.target.value)}
              onBlur={() => handleHexCommit(hexInput)}
              onKeyDown={e => { if (e.key === 'Enter') { handleHexCommit(hexInput); onClose(); } }}
              placeholder="#000000"
              style={{
                background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
                color: '#f3f4f6', fontSize: 11, padding: '4px 8px', width: '100%', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
        {/* Current preview */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, borderRadius: 3, background: displayColor, border: '1px solid #4b5563', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>{value}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── FigmaColorPicker ─────────────────────────────────────────────────────────

export interface FigmaColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  testId?: string;
}

export function FigmaColorPicker({ value, onChange, label, testId }: FigmaColorPickerProps) {
  const [open, setOpen]           = useState(false);
  const [hexInput, setHexInput]   = useState(value);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const themeOverrides = useBuilderStore(s => s.themeOverrides);

  useEffect(() => { setHexInput(value); }, [value]);

  const handleSwatchSelect = useCallback((hex: string) => {
    setHexInput(hex);
    onChange(hex);
  }, [onChange]);

  const handleHexCommit = useCallback((raw: string) => {
    const val = raw.startsWith('#') ? raw : `#${raw}`;
    if (isValidHex(val)) onChange(val);
  }, [onChange]);

  const handleTriggerClick = () => {
    if (triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen(o => !o);
  };

  const displayColor = value.startsWith('#') ? value : '#000000';

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {/* Trigger swatch */}
      <div
        ref={triggerRef}
        onClick={handleTriggerClick}
        title={`${label ?? 'Color'}: ${value}`}
        style={{
          width: 26, height: 26, borderRadius: 4,
          background: displayColor,
          border: open ? '2px solid #3b82f6' : '1.5px solid #4b5563',
          cursor: 'pointer', flexShrink: 0, boxSizing: 'border-box',
        }}
      />

      {/* Hex text input */}
      <div style={{ flex: 1 }}>
        {label && <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>{label}</span>}
        <input
          data-testid={testId}
          value={hexInput}
          onChange={e => setHexInput(e.target.value)}
          onBlur={() => handleHexCommit(hexInput)}
          onKeyDown={e => { if (e.key === 'Enter') handleHexCommit(hexInput); }}
          placeholder="#000000"
          style={{
            background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
            color: '#f3f4f6', fontSize: 11, padding: '3px 6px', width: '100%', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Portal popover */}
      {open && anchorRect && (
        <ColorPopover
          anchorRect={anchorRect}
          onClose={() => setOpen(false)}
          value={value}
          onSelect={handleSwatchSelect}
          hexInput={hexInput}
          setHexInput={setHexInput}
          handleHexCommit={handleHexCommit}
          themeOverrides={themeOverrides}
        />
      )}
    </div>
  );
}
