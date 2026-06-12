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
 *  - SliderField    — compact label+value badge+range slider
 *  - ChipSelect     — wrapping pill grid for finite option lists; onChange(v, e) passes the MouseEvent
 *  - ToggleRow      — full-width label + pill toggle switch
 *  - MiniPreview     — small visual chip shown in section headers
 *  - AnimPreview     — pure-CSS animated preview box for animation sub-sections
 */

import React, { useState, useEffect, useRef, useId, useCallback, useContext, useMemo } from 'react';
import { FigmaColorPicker } from './_color-picker';
import { useBuilderStore } from './_store';
import { BREAKPOINT_CASCADE } from '@/lib/sdui/types/node';
import type { BreakpointKey, ResponsiveOverride } from '@/lib/sdui/types/node';

// ─── Changed-field context ────────────────────────────────────────────────────

/**
 * Provided by DesignTab around all its sections.
 * Primitives consume it via `cssProp` to highlight labels and offer reset.
 *
 * Three-state label logic:
 *  - gray   — value matches the native default; no shared-component baseline.
 *  - green  — instance value is inherited from the shared-component model
 *             baseline (`isInheritedFromShared` returns true).
 *  - orange — instance value is a per-instance override, or a non-SC node's
 *             value differs from the native default.
 *
 * The "Reset" popup is offered for:
 *  - orange labels (always) → restores to SC baseline (if in SC) or native default.
 *  - green labels (only in Edit Component mode) → strips the value from the
 *    model and propagates to all non-overriding instances.
 */
export const ChangedFieldContext = React.createContext<{
  isChanged: (cssProp: string) => boolean;
  resetField: (cssProp: string) => void;
  isInheritedFromShared?: (cssProp: string) => boolean;
  /** True when the selected node lives under a shared-component tree. */
  inSharedTree?: boolean;
  /** True when the selected node's shared component is in Edit Component mode. */
  isEditingSharedComponent?: boolean;
} | null>(null);

/**
 * Renders a field label that adapts its color based on override state:
 * - green: value is inherited from the shared-component baseline.
 * - orange: value is a per-instance override (or non-SC changed-from-default).
 * - gray: value matches the native default.
 *
 * Reset popup visibility:
 * - orange: always shown.
 * - green: shown only when in Edit Component mode (reset removes from model).
 * - gray: never shown.
 */
export function ChangedLabel({
  text, cssProp, style: extraStyle,
}: { text: string; cssProp?: string; style?: React.CSSProperties }) {
  const ctx = useContext(ChangedFieldContext);
  const inherited = !!(cssProp && ctx?.isInheritedFromShared?.(cssProp));
  const changed = !inherited && !!(cssProp && ctx && ctx.isChanged(cssProp));
  const greenInEditMode = !!(inherited && ctx?.isEditingSharedComponent);
  const resettable = changed || greenInEditMode;
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spanRef = useRef<HTMLSpanElement | null>(null);

  const showPopup = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (spanRef.current) {
      const r = spanRef.current.getBoundingClientRect();
      const popW = 160;
      const left = Math.min(r.left, window.innerWidth - popW - 8);
      setPopupPos({ top: r.bottom + 4, left: Math.max(8, left) });
    }
  };
  const scheduleHide = () => {
    hideTimer.current = setTimeout(() => setPopupPos(null), 120);
  };

  const color = inherited ? 'var(--bld-success)' : (changed ? 'var(--bld-warning)' : 'var(--bld-text-disabled)');
  const baseStyle: React.CSSProperties = {
    fontSize: 9,
    color,
    cursor: resettable && ctx ? 'pointer' : undefined,
    ...extraStyle,
  };

  // Gray (default) has no reset popup. Green only has a popup in edit mode.
  if (!resettable || !ctx) {
    return <span style={baseStyle}>{text}</span>;
  }

  // Label varies by context:
  // - orange in SC tree → "Reset to shared default" (restore from model baseline)
  // - green in edit mode → "Reset to default" (strip from model)
  // - orange outside SC → "Reset to default" (strip to native default)
  const resetLabel = greenInEditMode
    ? 'Reset to default'
    : (ctx.inSharedTree ? 'Reset to shared default' : 'Reset to default');

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span
        ref={spanRef}
        style={baseStyle}
        onMouseEnter={showPopup}
        onMouseLeave={scheduleHide}
      >{text}</span>
      {popupPos && (
        <div
          onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current); }}
          onMouseLeave={scheduleHide}
          style={{
            position: 'fixed', top: popupPos.top, left: popupPos.left,
            zIndex: 99999, pointerEvents: 'auto',
            background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6,
            padding: '5px 9px', whiteSpace: 'nowrap',
            boxShadow: 'var(--bld-shadow-md)',
            textTransform: 'none', letterSpacing: 'normal',
            fontWeight: 'normal', fontFamily: 'system-ui, sans-serif',
          }}
        >
          <button
            onMouseDown={(e) => { e.preventDefault(); ctx.resetField(cssProp!); setPopupPos(null); }}
            style={{
              background: 'none', border: 'none', color: 'var(--bld-text-2)',
              fontSize: 11, cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span>↺</span><span>{resetLabel}</span>
          </button>
        </div>
      )}
    </span>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

export const PANEL_STYLE: React.CSSProperties = {
  width: 260,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bld-bg-panel)',
  borderLeft: '1px solid var(--bld-border)',
  overflow: 'hidden',
};

export const SECTION_STYLE: React.CSSProperties = {
  borderBottom: '1px solid var(--bld-border)',
  padding: '10px 12px',
};

export const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--bld-text-3)',
  marginBottom: 6,
  display: 'block',
};

// ─── SectionHeader ────────────────────────────────────────────────────────────

export interface SectionHeaderProps {
  title: string;
  children?: React.ReactNode;
  /** Breakpoints that have overrides for this section's properties */
  overriddenBreakpoints?: string[];
  /** Called when user clicks X on a breakpoint chip in the responsive popover */
  onRemoveBreakpoint?: (breakpoint: string) => void;
  /** Called when user clicks "Reset Style" in the responsive popover */
  onResetAll?: () => void;
}

export const SectionHeader = React.memo(function SectionHeader({ title, children, overriddenBreakpoints, onRemoveBreakpoint, onResetAll }: SectionHeaderProps) {
  const sectionKey = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <span
        style={{ ...LABEL_STYLE, display: 'flex', alignItems: 'center', gap: 3 }}
      >
        {title}
        {overriddenBreakpoints && overriddenBreakpoints.length > 0 && onRemoveBreakpoint && (
          <ResponsiveDot
            cssProp={`section-${sectionKey}`}
            testId={`responsive-dot-${sectionKey}`}
            overriddenBreakpoints={overriddenBreakpoints}
            onRemove={(bp) => onRemoveBreakpoint(bp)}
            onResetAll={onResetAll ? () => onResetAll() : undefined}
          />
        )}
      </span>
      {children}
    </div>
  );
});

// ─── Responsive Dot & Popover ─────────────────────────────────────────────────

const BP_LABELS: Record<string, string> = { laptop: 'Laptop', tablet: 'Tablet', mobile: 'Mobile' };
const BP_ORDER = ['laptop', 'tablet', 'mobile'] as const;

const BP_ICONS: Record<string, React.ReactNode> = {
  laptop: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
  tablet: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
  mobile: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
};

export interface ResponsiveDotProps {
  cssProp: string;
  /** Breakpoints that have an override for this property, e.g. ['tablet','mobile'] */
  overriddenBreakpoints: string[];
  onRemove: (breakpoint: string, cssProp: string) => void;
  onResetAll?: (cssProp: string) => void;
  testId?: string;
}

export function ResponsiveDot({ cssProp, overriddenBreakpoints, onRemove, onResetAll, testId }: ResponsiveDotProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [flipLeft, setFlipLeft] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || !popRef.current) return;
    const rect = popRef.current.getBoundingClientRect();
    const panel = popRef.current.closest('[data-testid="panel-right"]') as HTMLElement | null;
    const rightEdge = panel ? panel.getBoundingClientRect().right : window.innerWidth;
    if (rect.right > rightEdge - 4) setFlipLeft(true);
    else setFlipLeft(false);
  }, [open]);

  if (overriddenBreakpoints.length === 0) return null;

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span
        data-testid={testId ?? `responsive-dot-${cssProp}`}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{
          width: 6, height: 6, borderRadius: '50%',
          backgroundColor: '#22c55e', flexShrink: 0,
          cursor: 'pointer', marginLeft: 3,
          boxShadow: '0 0 4px rgba(34,197,94,0.5)',
        }}
      />
      {open && (
        <div
          ref={popRef}
          data-testid={`responsive-popover-${cssProp}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 14,
            ...(flipLeft ? { right: -8 } : { left: -8 }),
            zIndex: 100,
            background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 8,
            padding: '10px 12px', minWidth: 160,
            boxShadow: 'var(--bld-shadow-lg)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-2)', marginBottom: 8 }}>Responsive</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {overriddenBreakpoints.map(bp => (
              <div key={bp} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--bld-success)', display: 'flex', alignItems: 'center' }}>{BP_ICONS[bp]}</span>
                <span style={{ fontSize: 10, color: 'var(--bld-text-3)', flex: 1 }}>{BP_LABELS[bp] ?? bp}</span>
                <button
                  data-testid={`responsive-remove-${cssProp}-${bp}`}
                  onClick={(e) => { e.stopPropagation(); onRemove(bp, cssProp); }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--bld-error)', fontSize: 13, lineHeight: 1, padding: '0 2px',
                  }}
                  title={`Remove ${BP_LABELS[bp] ?? bp} override`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {onResetAll && (
            <>
              <div style={{ borderTop: '1px solid var(--bld-border)', margin: '8px 0' }} />
              <button
                data-testid={`responsive-reset-${cssProp}`}
                onClick={(e) => { e.stopPropagation(); onResetAll(cssProp); setOpen(false); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--bld-text-3)', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4,
                  padding: 0,
                }}
              >
                <span style={{ fontSize: 13 }}>↵</span> Reset Style
              </button>
            </>
          )}
        </div>
      )}
    </span>
  );
}

// ─── DirectChangedLabel ───────────────────────────────────────────────────────
/** Like ChangedLabel but takes `changed` + `onReset` directly — no context needed. */
export function DirectChangedLabel({ text, changed, onReset }: { text: string; changed: boolean; onReset: () => void }) {
  const [popupPos, setPopupPos] = React.useState<{ top: number; left: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spanRef   = useRef<HTMLSpanElement | null>(null);

  const showPopup = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (spanRef.current) {
      const r = spanRef.current.getBoundingClientRect();
      const popW = 140;
      const left = Math.min(r.left, window.innerWidth - popW - 8);
      setPopupPos({ top: r.bottom + 4, left: Math.max(8, left) });
    }
  };
  const scheduleHide = () => { hideTimer.current = setTimeout(() => setPopupPos(null), 120); };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span
        ref={spanRef}
        style={{ fontSize: 9, color: changed ? 'var(--bld-warning)' : 'var(--bld-text-disabled)', cursor: changed ? 'pointer' : undefined }}
        onMouseEnter={changed ? showPopup : undefined}
        onMouseLeave={changed ? scheduleHide : undefined}
      >{text}</span>
      {popupPos && (
        <div
          onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current); }}
          onMouseLeave={scheduleHide}
          style={{ position: 'fixed', top: popupPos.top, left: popupPos.left, zIndex: 99999, pointerEvents: 'auto', background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6, padding: '5px 9px', whiteSpace: 'nowrap', boxShadow: 'var(--bld-shadow-md)', textTransform: 'none', letterSpacing: 'normal', fontWeight: 'normal', fontFamily: 'system-ui, sans-serif' }}
        >
          <button
            onMouseDown={e => { e.preventDefault(); onReset(); setPopupPos(null); }}
            style={{ background: 'none', border: 'none', color: 'var(--bld-text-2)', fontSize: 11, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <span>↺</span><span>Reset to default</span>
          </button>
        </div>
      )}
    </span>
  );
}

// ─── NumberInput ──────────────────────────────────────────────────────────────

export function NumberInput({
  label, value, onChange, min = 0, max = 9999, step = 1, testId, onFocus, afterLabel, cssProp,
  changedOverride, onResetOverride,
}: { label: string; value: number | string; onChange: (v: number) => void; min?: number; max?: number; step?: number; testId?: string; onFocus?: () => void; afterLabel?: React.ReactNode; cssProp?: string; changedOverride?: boolean; onResetOverride?: () => void }) {
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
      {label && (
        <span style={{ display: 'flex', alignItems: 'center' }}>
          {changedOverride !== undefined
            ? <DirectChangedLabel text={label} changed={changedOverride} onReset={onResetOverride ?? (() => {})} />
            : <ChangedLabel text={label} cssProp={cssProp} />}
          {afterLabel}
        </span>
      )}
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
        style={{ background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '3px 6px', width: '100%', boxSizing: 'border-box' }}
      />
    </div>
  );
}

// ─── SelectInput ──────────────────────────────────────────────────────────────

export function SelectInput({
  label, value, options, onChange, testId, afterLabel, cssProp,
}: { label: string; value: string; options: readonly string[] | string[]; onChange: (v: string) => void; testId?: string; afterLabel?: React.ReactNode; cssProp?: string }) {
  return (
    <div style={{ flex: 1 }}>
      {label && (
        <span style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
          <ChangedLabel text={label} cssProp={cssProp} />
          {afterLabel}
        </span>
      )}
      <select
        data-testid={testId}
        value={value} onChange={e => onChange(e.target.value)}
        style={{ background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '3px 5px', width: '100%' }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ─── ColorInput ───────────────────────────────────────────────────────────────
// Thin wrapper: clicking anywhere (swatch or text) opens FigmaColorPicker.

export function ColorInput({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId?: string }) {
  const handleChange = useCallback((color: string) => onChange(color), [onChange]);
  return (
    <FigmaColorPicker
      value={value || '#000000'}
      onChange={handleChange}
      label={label}
      testId={testId}
    />
  );
}

// ─── ToggleBtn ────────────────────────────────────────────────────────────────

export function ToggleBtn({ active, onClick, title, children, 'data-testid': testId, style: extraStyle }: { active?: boolean; onClick: () => void; title?: string; children: React.ReactNode; 'data-testid'?: string; style?: React.CSSProperties }) {
  return (
    <button
      onClick={onClick} title={title} data-testid={testId} data-active={String(!!active)}
      style={{ padding: '3px 7px', fontSize: 11, background: active ? 'var(--bld-accent)' : 'var(--bld-bg-input)', border: `1px solid ${active ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`, color: active ? 'var(--bld-accent-fg)' : 'var(--bld-text-3)', borderRadius: 4, cursor: 'pointer', lineHeight: 1, ...extraStyle }}
    >
      {children}
    </button>
  );
}

// ─── MiniPreview ──────────────────────────────────────────────────────────────
// Small visual chip rendered in section headers to give live feedback.
// Place inside SectionHeader's children prop.

export function MiniPreview({ style, children, title }: { style?: React.CSSProperties; children?: React.ReactNode; title?: string }) {
  return (
    <div
      title={title}
      style={{
        width: 28, height: 18,
        borderRadius: 4,
        border: '1px solid var(--bld-border-subtle)',
        background: 'var(--bld-bg-input)',
        flexShrink: 0,
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── AnimPreview ──────────────────────────────────────────────────────────────
// Pure-CSS animated preview box used in animation sub-sections.
// Renders a 44×26 box with the animation running continuously (loop types) or
// replaying on a 2s interval (enter/exit types).
// For hover/press types the box responds to real pointer events.

type AnimCategory = 'enter' | 'exit' | 'loop' | 'hover' | 'press';

// Maps an animation type to a CSS keyframe body + animation shorthand.
// Returns null when the type is unknown/unsupported for a preview.
function getAnimCSS(type: string, category: AnimCategory): { keyframes: string; animation: string } | null {
  const dur = category === 'loop' ? '1.2s infinite alternate ease-in-out' : '0.6s ease-out forwards';
  switch (type) {
    // ── Enter ──────────────────────────────────────────────────────
    case 'fadeIn':
      return { keyframes: 'from{opacity:0}to{opacity:1}', animation: dur };
    case 'slideInUp':
      return { keyframes: 'from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}', animation: dur };
    case 'slideInDown':
      return { keyframes: 'from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}', animation: dur };
    case 'slideInLeft':
    case 'slideInLeftSubtle':
      return { keyframes: 'from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:translateX(0)}', animation: dur };
    case 'slideInRight':
      return { keyframes: 'from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:translateX(0)}', animation: dur };
    case 'zoomIn':
    case 'expandIn':
      return { keyframes: 'from{opacity:0;transform:scale(0.6)}to{opacity:1;transform:scale(1)}', animation: dur };
    case 'riseFade':
      return { keyframes: 'from{opacity:0;transform:translateY(8px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}', animation: dur };
    case 'dropIn':
      return { keyframes: 'from{opacity:0;transform:translateY(-8px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}', animation: dur };
    case 'bounceIn':
      return { keyframes: '0%{opacity:0;transform:scale(0.5)}70%{transform:scale(1.1)}100%{opacity:1;transform:scale(1)}', animation: '0.7s ease-out forwards' };
    case 'flipInX':
      return { keyframes: 'from{opacity:0;transform:rotateX(70deg)}to{opacity:1;transform:rotateX(0)}', animation: dur };
    case 'flipInY':
      return { keyframes: 'from{opacity:0;transform:rotateY(70deg)}to{opacity:1;transform:rotateY(0)}', animation: dur };
    case 'blurIn':
    case 'glowIn':
      return { keyframes: 'from{opacity:0;filter:blur(6px)}to{opacity:1;filter:blur(0)}', animation: dur };
    case 'skewIn':
      return { keyframes: 'from{opacity:0;transform:skewX(20deg)}to{opacity:1;transform:skewX(0)}', animation: dur };
    case 'skewInY':
      return { keyframes: 'from{opacity:0;transform:skewY(15deg)}to{opacity:1;transform:skewY(0)}', animation: dur };
    case 'rollIn':
      return { keyframes: 'from{opacity:0;transform:rotate(-180deg) scale(0.4)}to{opacity:1;transform:rotate(0) scale(1)}', animation: '0.7s ease-out forwards' };
    case 'tiltIn':
      return { keyframes: 'from{opacity:0;transform:rotate3d(1,1,0,50deg)}to{opacity:1;transform:rotate3d(0,0,0,0)}', animation: dur };
    case 'flipIn3D':
      return { keyframes: 'from{opacity:0;transform:perspective(200px) rotateY(90deg)}to{opacity:1;transform:perspective(200px) rotateY(0)}', animation: dur };
    // ── Exit ───────────────────────────────────────────────────────
    case 'fadeOut':
      return { keyframes: 'from{opacity:1}to{opacity:0}', animation: dur };
    case 'slideOutUp':
      return { keyframes: 'from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-10px)}', animation: dur };
    case 'slideOutDown':
      return { keyframes: 'from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(10px)}', animation: dur };
    case 'slideOutLeft':
      return { keyframes: 'from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(-14px)}', animation: dur };
    case 'slideOutRight':
      return { keyframes: 'from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(14px)}', animation: dur };
    case 'zoomOut':
    case 'shrinkOut':
      return { keyframes: 'from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(0.6)}', animation: dur };
    case 'blurOut':
      return { keyframes: 'from{opacity:1;filter:blur(0)}to{opacity:0;filter:blur(6px)}', animation: dur };
    case 'skewOut':
      return { keyframes: 'from{opacity:1;transform:skewX(0)}to{opacity:0;transform:skewX(20deg)}', animation: dur };
    // ── Loop ───────────────────────────────────────────────────────
    case 'pulse':
    case 'breathe':
      return { keyframes: 'from{transform:scale(1)}to{transform:scale(1.15)}', animation: '1s infinite alternate ease-in-out' };
    case 'float':
      return { keyframes: 'from{transform:translateY(0)}to{transform:translateY(-6px)}', animation: '1.4s infinite alternate ease-in-out' };
    case 'shake':
    case 'wiggle':
      return { keyframes: '0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}', animation: '0.5s infinite linear' };
    case 'wobble':
      return { keyframes: '0%,100%{transform:rotate(0)}30%{transform:rotate(-8deg)}70%{transform:rotate(8deg)}', animation: '0.7s infinite ease-in-out' };
    case 'swing':
      return { keyframes: 'from{transform:rotate(-10deg)}to{transform:rotate(10deg)}', animation: '0.7s infinite alternate ease-in-out' };
    case 'spin':
      return { keyframes: 'from{transform:rotate(0)}to{transform:rotate(360deg)}', animation: '1s infinite linear' };
    case 'bounce':
      return { keyframes: '0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}', animation: '0.8s infinite ease-in-out' };
    case 'heartbeat':
      return { keyframes: '0%,100%{transform:scale(1)}14%{transform:scale(1.2)}28%{transform:scale(1)}42%{transform:scale(1.15)}70%{transform:scale(1)}', animation: '1.3s infinite ease-in-out' };
    case 'flash':
      return { keyframes: '0%,100%{opacity:1}50%{opacity:0.1}', animation: '1s infinite ease-in-out' };
    case 'ripple':
    case 'glowPulse':
      return { keyframes: '0%{box-shadow:0 0 0 0 rgba(99,102,241,0.7)}100%{box-shadow:0 0 0 8px rgba(99,102,241,0)}', animation: '1.2s infinite ease-out' };
    case 'gradientDrift':
      return { keyframes: 'from{background-position:0% 50%}to{background-position:100% 50%}', animation: '2s infinite alternate linear' };
    case 'ticker':
      return { keyframes: 'from{transform:translateX(14px)}to{transform:translateX(-14px)}', animation: '1.2s infinite alternate linear' };
    default:
      return null;
  }
}

// ─── SliderField ──────────────────────────────────────────────────────────────
// Compact label + value badge + range slider in one block.
// Use standalone or wrap in FieldWithBinding for formula binding support.

export function SliderField({
  label, value, min, max, step = 1, unit = '', onChange, testId, cssProp,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  testId?: string;
  cssProp?: string;
}) {
  const displayVal = step < 0.1 ? value.toFixed(2) : step < 1 ? value.toFixed(1) : String(value);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <ChangedLabel text={label} cssProp={cssProp} style={{ fontSize: 10 }} />
        <span style={{ fontSize: 10, color: 'var(--bld-text-2)', fontFamily: 'monospace', minWidth: 32, textAlign: 'right' }}>
          {displayVal}{unit}
        </span>
      </div>
      <input
        data-testid={testId}
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer', margin: 0, height: 5 }}
      />
    </div>
  );
}

// ─── ChipSelect ───────────────────────────────────────────────────────────────
// Wrapping pill grid for selecting a value from a finite list.
// Optional preview node shown above chips (e.g. AnimPreview).

export function ChipSelect({
  value, options, onChange, preview, testId,
}: {
  value: string;
  options: readonly string[] | string[];
  onChange: (v: string, e: React.MouseEvent) => void;
  preview?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {preview && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 2 }}>{preview}</div>
      )}
      <div data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {options.map(opt => (
          <button
            key={opt}
            onClick={e => onChange(opt, e)}
            style={{
              padding: '3px 8px',
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: '0.02em',
              borderRadius: 999,
              border: value === opt ? '1px solid var(--bld-accent)' : '1px solid var(--bld-bg-elevated)',
              background: value === opt ? 'var(--bld-accent)' : 'var(--bld-bg-elevated)',
              color: value === opt ? 'var(--bld-accent-fg)' : 'var(--bld-text-disabled)',
              cursor: 'pointer',
              lineHeight: 1.6,
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── ToggleRow ────────────────────────────────────────────────────────────────
// Full-width row: label on left, pill toggle switch on right.
// Click anywhere on the row to toggle.

export function ToggleRow({
  label, active, onChange, testId,
}: {
  label: string;
  active: boolean | undefined;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <div
      onClick={() => onChange(!active)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        cursor: 'pointer', padding: '3px 0', userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 10, color: active ? 'var(--bld-text-2)' : 'var(--bld-text-disabled)' }}>{label}</span>
      {/* Pill toggle */}
      <div
        data-testid={testId}
        style={{
          width: 28, height: 16, borderRadius: 999,
          background: active ? 'var(--bld-accent)' : 'var(--bld-border-subtle)',
          position: 'relative', transition: 'background 0.15s', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: active ? 14 : 2,
          width: 12, height: 12, borderRadius: '50%',
          background: '#fff', transition: 'left 0.15s',
        }} />
      </div>
    </div>
  );
}

export function AnimPreview({
  type,
  category,
  hoverConfig,
  pressConfig,
  size = 18,
}: {
  type?: string;
  category: AnimCategory;
  hoverConfig?: { scale?: number; opacity?: number; y?: number; duration?: number };
  pressConfig?: { scale?: number; opacity?: number; duration?: number };
  /** Box size in px (default 18). */
  size?: number;
}) {
  const uid = useId().replace(/:/g, '');
  const kfName = `anim_${uid}`;
  // For enter/exit we replay every 2s using a key-reset trick
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLoop = category === 'loop';
  const isInteraction = category === 'hover' || category === 'press';

  useEffect(() => {
    if (!type || type === 'none' || isLoop || isInteraction) return;
    timerRef.current = setInterval(() => setTick(t => t + 1), 2200);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [type, isLoop, isInteraction]);

  // Hover / Press: use CSS transitions + pointer events
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  if (!type || type === 'none') return null;

  if (isInteraction) {
    const hScale = category === 'hover' ? (hoverConfig?.scale ?? 1.08) : 1;
    const hY     = category === 'hover' ? (hoverConfig?.y ?? -3) : 0;
    const pScale = category === 'press' ? (pressConfig?.scale ?? 0.92) : 1;
    const activeScale = isPressed ? pScale : (isHovered ? hScale : 1);
    const activeY     = isHovered ? hY : 0;
    const activeOpacity = isPressed ? (pressConfig?.opacity ?? 0.85) : (isHovered ? (hoverConfig?.opacity ?? 1) : 1);
    const dur = category === 'hover' ? (hoverConfig?.duration ?? 200) : (pressConfig?.duration ?? 120);
    return (
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => { setIsHovered(false); setIsPressed(false); }}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        style={{
          width: size, height: size,
          background: 'var(--bld-bg-elevated)',
          border: '1px solid var(--bld-border-subtle)',
          borderRadius: 4,
          transform: `scale(${activeScale}) translateY(${activeY}px)`,
          opacity: activeOpacity,
          transition: `transform ${dur}ms ease-out, opacity ${dur}ms ease-out`,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      />
    );
  }

  const animCSS = type ? getAnimCSS(type, category) : null;
  if (!animCSS) return null;

  const bgGradient = category === 'loop' && type === 'gradientDrift'
    ? 'linear-gradient(135deg, var(--bld-bg-elevated), var(--bld-border-subtle), var(--bld-bg-elevated))'
    : 'var(--bld-bg-elevated)';
  const bgSize = type === 'gradientDrift' ? '300% 300%' : undefined;

  return (
    <div style={{ flexShrink: 0 }} key={`${type}-${tick}`}>
      <style>{`@keyframes ${kfName}{${animCSS.keyframes}}`}</style>
      <div style={{
        width: size, height: size,
        background: bgGradient,
        backgroundSize: bgSize,
        border: '1px solid var(--bld-border-subtle)',
        borderRadius: 4,
        animation: `${kfName} ${animCSS.animation}`,
      }} />
    </div>
  );
}

// ─── Responsive field hook + wrapper ─────────────────────────────────────────

type ResponsiveChannel = keyof ResponsiveOverride;

/**
 * Generic hook for wiring any field in `node.responsive[bp].<channel>.<path>` to
 * builder state. Returns helpers needed by fields that want green-dot + orange-reset.
 *
 * @param nodeId     - The node being edited.
 * @param channel    - Top-level key in ResponsiveOverride (e.g. 'styles', 'props', 'text', 'map').
 * @param path       - Dotted path within the channel, or undefined for the channel root.
 * @param baseGet    - Returns the base (desktop) value — used to detect overrides and reset.
 * @param baseSet    - Writes the base (desktop) value.
 * @param eq         - Optional equality check (defaults to ===).
 */
export function useResponsiveField<T>({
  nodeId,
  channel,
  path,
  baseGet,
  baseSet,
  eq,
}: {
  nodeId: string;
  channel: ResponsiveChannel;
  path?: string;
  baseGet: () => T;
  baseSet: (v: T) => void;
  eq?: (a: T, b: T) => boolean;
}) {
  const store = useBuilderStore();
  const abp = useBuilderStore(s => s.activeBreakpoint) as 'desktop' | BreakpointKey;

  const isDesktop = abp === 'desktop';
  const fullPath = path ? `${channel}.${path}` : channel;

  /** Breakpoints where this path has an explicit override */
  const overriddenBreakpoints = useMemo(() => {
    const node = store.selectedIds.length === 1
      ? (store.pageNodes as Array<{ id?: string; responsive?: unknown }>).find(n => n.id === nodeId)
      : undefined;
    if (!node?.responsive) return [] as string[];
    return BREAKPOINT_CASCADE.filter(bp => {
      const resp = (node.responsive as Partial<Record<BreakpointKey, ResponsiveOverride>>)[bp];
      if (!resp) return false;
      if (!path) return channel in resp;
      const parts = [channel as string, ...path.split('.')];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj: any = resp;
      for (const part of parts) {
        if (obj == null || !(part in obj)) return false;
        obj = obj[part];
      }
      return obj !== undefined;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, channel, path, store.pageNodes]);

  /** The effective value at the current breakpoint (cascaded) */
  const effective = useMemo<T>(() => {
    if (isDesktop) return baseGet();
    const node = store.selectedIds.length === 1
      ? (store.pageNodes as Array<{ id?: string; responsive?: unknown }>).find(n => n.id === nodeId)
      : undefined;
    if (!node?.responsive) return baseGet();
    const bpIdx = BREAKPOINT_CASCADE.indexOf(abp as BreakpointKey);
    for (let i = bpIdx; i >= 0; i--) {
      const bp = BREAKPOINT_CASCADE[i];
      const resp = (node.responsive as Partial<Record<BreakpointKey, ResponsiveOverride>>)[bp];
      if (!resp) continue;
      const parts = [channel as string, ...(path ? path.split('.') : [])];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj: any = resp;
      for (const part of parts) {
        if (obj == null || !(part in obj)) { obj = undefined; break; }
        obj = obj[part];
      }
      if (obj !== undefined) return obj as T;
    }
    return baseGet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, nodeId, channel, path, abp, store.pageNodes]);

  const write = useCallback((v: T) => {
    if (isDesktop) {
      baseSet(v);
    } else {
      store.patchResponsive(nodeId, abp as BreakpointKey, fullPath, v as unknown);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, nodeId, abp, fullPath]);

  const resetAtActive = useCallback(() => {
    if (!isDesktop) {
      store.removeResponsiveOverride(nodeId, abp as BreakpointKey, fullPath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, nodeId, abp, fullPath]);

  const resetAll = useCallback(() => {
    for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) {
      store.removeResponsiveOverride(nodeId, bp, fullPath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, fullPath]);

  const isOverridden = useMemo(() => {
    const base = baseGet();
    const isEq = eq ?? ((a: T, b: T) => a === b);
    return !isEq(effective, base);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective]);

  return { effective, overriddenBreakpoints, write, resetAtActive, resetAll, isOverridden, isDesktop };
}

/**
 * Lightweight wrapper that renders a label row with an inline ResponsiveDot chip and optional
 * DirectChangedLabel (orange reset) when the field has been overridden.
 */
export function ResponsiveFieldRow({
  label,
  overriddenBreakpoints,
  onRemoveBreakpoint,
  onResetAll,
  changed,
  onReset,
  children,
  testId,
}: {
  label: string;
  overriddenBreakpoints: string[];
  onRemoveBreakpoint: (bp: string) => void;
  onResetAll: () => void;
  /** When true, renders orange "reset to default" label. */
  changed?: boolean;
  onReset?: () => void;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {changed && onReset ? (
          <DirectChangedLabel text={label} changed onReset={onReset} />
        ) : (
          <span style={{ fontSize: 10, color: 'var(--bld-text-3)' }}>{label}</span>
        )}
        {overriddenBreakpoints.length > 0 && (
          <ResponsiveDot
            cssProp={`resp-field-${label}`}
            overriddenBreakpoints={overriddenBreakpoints}
            onRemove={bp => onRemoveBreakpoint(bp)}
            onResetAll={onResetAll}
          />
        )}
      </div>
      {children}
    </div>
  );
}


// ─── SearchInput ───────────────────────────────────────────────────────────────

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  style,
  inputRef,
  onKeyDown,
  autoFocus,
  'data-testid': testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoFocus?: boolean;
  'data-testid'?: string;
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...style }}>
      <svg
        style={{ position: 'absolute', left: 8, color: 'var(--bld-text-disabled)', pointerEvents: 'none', flexShrink: 0 }}
        width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        data-testid={testId}
        onFocus={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--bld-accent)'; }}
        onBlur={e => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--bld-border-subtle)'; }}
        style={{
          width: '100%',
          background: 'var(--bld-bg-input)',
          border: '1px solid var(--bld-border-subtle)',
          borderRadius: 6,
          color: 'var(--bld-text-2)',
          fontSize: 11,
          padding: value ? '4px 24px 4px 24px' : '4px 8px 4px 24px',
          boxSizing: 'border-box' as const,
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{ position: 'absolute', right: 5, background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2, borderRadius: 3 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      )}
    </div>
  );
}
