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

import React, { useState, useEffect, useRef, useId } from 'react';

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
      {label && <span style={{ fontSize: 9, color: '#6b7280' }}>{label}</span>}
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

export function ToggleBtn({ active, onClick, title, children, 'data-testid': testId, style: extraStyle }: { active?: boolean; onClick: () => void; title?: string; children: React.ReactNode; 'data-testid'?: string; style?: React.CSSProperties }) {
  return (
    <button
      onClick={onClick} title={title} data-testid={testId} data-active={String(!!active)}
      style={{ padding: '3px 7px', fontSize: 11, background: active ? '#3b82f6' : '#1f2937', border: `1px solid ${active ? '#3b82f6' : '#374151'}`, color: active ? '#fff' : '#9ca3af', borderRadius: 4, cursor: 'pointer', lineHeight: 1, ...extraStyle }}
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
        border: '1px solid #374151',
        background: '#1f2937',
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
  label, value, min, max, step = 1, unit = '', onChange, testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  testId?: string;
}) {
  const displayVal = step < 0.1 ? value.toFixed(2) : step < 1 ? value.toFixed(1) : String(value);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#6b7280' }}>{label}</span>
        <span style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'monospace', minWidth: 32, textAlign: 'right' }}>
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
              border: value === opt ? '1px solid #6366f1' : '1px solid #1e293b',
              background: value === opt ? '#6366f1' : '#1e293b',
              color: value === opt ? '#fff' : '#6b7280',
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
      <span style={{ fontSize: 10, color: active ? '#e2e8f0' : '#6b7280' }}>{label}</span>
      {/* Pill toggle */}
      <div
        data-testid={testId}
        style={{
          width: 28, height: 16, borderRadius: 999,
          background: active ? '#6366f1' : '#374151',
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
          background: '#1e3a5f',
          border: '1px solid #3b5c8a',
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
    ? 'linear-gradient(135deg,#334155,#475569,#334155)'
    : '#1e3a5f';
  const bgSize = type === 'gradientDrift' ? '300% 300%' : undefined;

  return (
    <div style={{ flexShrink: 0 }} key={`${type}-${tick}`}>
      <style>{`@keyframes ${kfName}{${animCSS.keyframes}}`}</style>
      <div style={{
        width: size, height: size,
        background: bgGradient,
        backgroundSize: bgSize,
        border: '1px solid #3b5c8a',
        borderRadius: 4,
        animation: `${kfName} ${animCSS.animation}`,
      }} />
    </div>
  );
}
