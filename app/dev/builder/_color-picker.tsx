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
  label, cssVar, defaultHex, currentValue, onSelect, overrides, selectedCssVar, editingCssVar, editingDefaultHex, singleMatchCssVar,
}: {
  label: string; cssVar: string; defaultHex: string;
  currentValue: string; onSelect: (hex: string, cssVar: string) => void;
  overrides: Record<string, string>; selectedCssVar: string | null;
  /** When set (e.g. Theme panel), only this swatch is active when selectedCssVar is null — avoids multiple highlights when vars share the same hex */
  editingCssVar?: string | null;
  /** When editing this var, use this as the default to show/apply — so user can click to reset to theme default */
  editingDefaultHex?: string | null;
  /** When exactly one swatch matches value (right panel), its cssVar — highlight it; if multiple match, null */
  singleMatchCssVar?: string | null;
}) {
  const resolved = overrides[cssVar] ?? resolveCssVar(cssVar) ?? defaultHex;
  // When editing this var, show default so user can click to reset to default; else show current resolved value.
  const isEditingThis = editingCssVar != null && editingCssVar === cssVar;
  const defaultForReset = (editingDefaultHex ?? defaultHex) || defaultHex;
  const displayColor = isEditingThis ? defaultForReset : resolved;
  const valueOnClick = isEditingThis ? defaultForReset : resolved;
  // Use explicit cssVar match when a swatch was selected; when editing a specific var (Theme panel), only that swatch is active; when no editing context (right panel), highlight only if exactly one swatch matches.
  const isActive = selectedCssVar !== null
    ? selectedCssVar === cssVar
    : editingCssVar != null
      ? editingCssVar === cssVar
      : singleMatchCssVar != null && singleMatchCssVar === cssVar;
  return (
    <div
      data-testid={`swatch-${cssVar}`}
      title={`${label}\n${isEditingThis ? `${displayColor} (default)` : displayColor}`}
      onClick={() => onSelect(valueOnClick, cssVar)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        cursor: 'pointer', padding: '4px 2px', borderRadius: 4,
        background: isActive ? 'rgba(59,130,246,0.18)' : 'transparent',
      }}
    >
      <div style={{
        width: 24, height: 24, borderRadius: 5,
        background: displayColor,
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
  onSelect: (hex: string, cssVar: string) => void;
  hexInput: string;
  setHexInput: (v: string) => void;
  handleHexCommit: (v: string) => void;
  themeOverrides: Record<string, string>;
  selectedCssVar: string | null;
  editingCssVar?: string | null;
  editingDefaultHex?: string | null;
}

function ColorPopover({
  anchorRect, onClose, value, onSelect,
  hexInput, setHexInput, handleHexCommit, themeOverrides, selectedCssVar, editingCssVar, editingDefaultHex,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const colorRafRef = useRef<number | null>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);
  const displayColor = value.startsWith('#') ? value : '#000000';

  // Sync native color input when value changes externally (e.g. swatch click) without
  // making the input controlled — a controlled <input type="color"> re-renders the
  // popover on every hue-wheel mousemove even with rAF throttling.
  useEffect(() => {
    if (nativeInputRef.current && nativeInputRef.current !== document.activeElement) {
      nativeInputRef.current.value = displayColor;
    }
  }, [displayColor]);

  // When no editingCssVar (right panel), highlight first matching swatch — when multiple match (e.g. #ffffff = Background, Card, Destructive Text), prefer first in list
  const singleMatchCssVar = (() => {
    if (editingCssVar != null) return null;
    const val = value.toLowerCase();
    const match = GLOBAL_SWATCHES.find(s => {
      const r = themeOverrides[s.cssVar] ?? resolveCssVar(s.cssVar) ?? s.defaultHex;
      return val === r.toLowerCase();
    });
    return match?.cssVar ?? null;
  })();

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
            <Swatch key={s.cssVar} {...s} currentValue={value} onSelect={onSelect} overrides={themeOverrides} selectedCssVar={selectedCssVar} editingCssVar={editingCssVar} editingDefaultHex={editingDefaultHex} singleMatchCssVar={singleMatchCssVar} />
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
            ref={nativeInputRef}
            type="color"
            defaultValue={displayColor}
            onChange={e => {
              const hex = e.target.value;
              // rAF-throttle: batch both the hex display update and the store write
              // into one frame so rapid hue-wheel drags don't cause per-event re-renders.
              if (colorRafRef.current !== null) cancelAnimationFrame(colorRafRef.current);
              colorRafRef.current = requestAnimationFrame(() => {
                setHexInput(hex);
                onSelect(hex, '');
                colorRafRef.current = null;
              });
            }}
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
  /** Called with the resolved hex and, when a theme swatch was clicked, its cssVar so the caller can store `var(--cssVar)` instead of a hardcoded hex */
  onChange: (hex: string, cssVar?: string) => void;
  /** Called once when the popover closes — use to push a history snapshot after a color drag gesture. */
  onCommit?: () => void;
  label?: string;
  testId?: string;
  /** When set (e.g. Theme panel editing a specific var), only that swatch is highlighted initially — avoids multiple highlights when vars share the same hex */
  editingCssVar?: string | null;
  /** When editing a var (editingCssVar set), this is the theme default for that var — swatch shows it so user can click to reset */
  editingDefaultHex?: string | null;
  /** When set, picker uses controlled open state — parent must close others when opening this one to avoid multiple popovers and wrong variable being patched */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function FigmaColorPicker({ value, onChange, onCommit, label, testId, editingCssVar, editingDefaultHex, open: controlledOpen, onOpenChange }: FigmaColorPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [hexInput, setHexInput]       = useState(value);
  const [anchorRect, setAnchorRect]   = useState<DOMRect | null>(null);
  const [selectedCssVar, setSelectedCssVar] = useState<string | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const themeOverrides = useBuilderStore(s => s.themeOverrides);
  // Track whether the value change was triggered internally (swatch/hex input click)
  // so we do NOT reset selectedCssVar on the echo-back from the parent.
  const isInternalChangeRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);

  const isControlled = controlledOpen !== undefined && onOpenChange !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    if (isControlled) onOpenChange!(next);
    else setInternalOpen(next);
    // Fire onCommit when the picker closes so the caller can push a history snapshot.
    if (!next) onCommitRef.current?.();
  }, [isControlled, onOpenChange, open]);

  useEffect(() => {
    if (isInternalChangeRef.current) {
      // Internal change echoing back from the store — picker is driving the value,
      // skip the hex re-sync to avoid an extra setState per rAF frame.
      isInternalChangeRef.current = false;
      return;
    }
    // External change (e.g. different node selected, or picker is closed):
    // reset hex input and clear any swatch highlight.
    setHexInput(value);
    setSelectedCssVar(null);
  }, [value]);

  const handleSwatchSelect = useCallback((hex: string, cssVar: string) => {
    isInternalChangeRef.current = true;
    setHexInput(hex);
    setSelectedCssVar(cssVar);
    // Pass cssVar so callers can store var(--cssVar) — making the element react to theme changes
    onChange(hex, cssVar || undefined);
  }, [onChange]);

  const handleHexCommit = useCallback((raw: string) => {
    const val = raw.startsWith('#') ? raw : `#${raw}`;
    if (isValidHex(val)) {
      isInternalChangeRef.current = true;
      setSelectedCssVar(null); // custom hex → no swatch active
      onChange(val);
    }
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
        data-testid={testId ? `${testId}-swatch` : undefined}
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
          selectedCssVar={selectedCssVar}
          editingCssVar={editingCssVar}
          editingDefaultHex={editingDefaultHex}
        />
      )}
    </div>
  );
}
