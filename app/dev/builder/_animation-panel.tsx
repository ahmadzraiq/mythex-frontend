'use client';

/**
 * _animation-panel.tsx
 *
 * AnimationInDesign — the "Animation" section in the builder's right design panel.
 *
 * Architecture:
 *  - 5 collapsible CategoryGroups (BASIC, INTERACTION, SCROLL, STATES & FX, ADVANCED)
 *  - SubSection bodies are minimal: just a chip grid (for chip-based sections)
 *    or an enable toggle (for toggle-based sections)
 *  - Clicking a chip or the ⚙ configure button opens an AnimConfigPopover floating
 *    to the LEFT of the right panel with all detailed config fields
 *  - FieldWithBinding wrappers in the popover for formula binding on numeric fields
 *  - ADVANCED sections (Timeline, Gradient, etc.) retain inline config
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  SECTION_STYLE, SectionHeader,
  NumberInput, SelectInput, ColorInput,
  SliderField, ChipSelect, ToggleRow, AnimPreview,
} from './_panel-primitives';
import { FieldWithBinding, type FormulaValue } from './_formula-panel';
import { XYOffsetControl } from './_spatial-controls';
import type {
  AnimationConfig, ImperativeTriggerConfig, FilterConfig, TiltConfig,
  MouseParallaxConfig, FocusConfig, MorphShapeConfig, ScrollProgressConfig,
  SvgStrokeConfig, TimelineStep, GradientAnimationConfig, ClipPathConfig,
  MaskConfig, PseudoElementConfig, GestureConfig,
  FlipConfig, SplitTextConfig, ParticlesConfig,
} from '@/lib/sdui/components/animated-node';

// ─── Token lists ──────────────────────────────────────────────────────────────

const ENTER_TYPES = [
  'none',
  'fadeIn',
  'slideInUp', 'slideInDown', 'slideInLeft', 'slideInLeftSubtle', 'slideInRight',
  'riseFade', 'dropIn',
  'zoomIn', 'expandIn',
  'bounceIn',
  'flipInX', 'flipInY', 'flipIn3D', 'tiltIn',
  'skewIn', 'skewInY',
  'blurIn', 'glowIn',
  'rollIn',
  'revealUp', 'charFall', 'charBounce',
] as const;

const EXIT_TYPES = [
  'none',
  'fadeOut',
  'slideOutUp', 'slideOutDown', 'slideOutLeft', 'slideOutRight',
  'zoomOut', 'shrinkOut',
  'blurOut', 'skewOut',
] as const;

const LOOP_TYPES = [
  'none',
  'pulse', 'breathe', 'float',
  'shake', 'wiggle', 'wobble', 'swing',
  'spin', 'ticker',
  'bounce',
  'heartbeat',
  'flash', 'ripple',
  'glowPulse', 'gradientDrift',
] as const;

const EASING_OPTS = ['easeInOut', 'easeIn', 'easeOut', 'linear', 'circIn', 'circOut', 'circInOut', 'backIn', 'backOut', 'backInOut'] as const;
const AXIS_OPTS   = ['both', 'x', 'y'] as const;
const LAYOUT_TYPES = ['spring', 'linear', 'sequenced', 'fading'] as const;
const COLOR_PROPS  = ['backgroundColor', 'borderColor', 'color', 'outlineColor', 'fill', 'stroke', 'custom'] as const;
const COLOR_TRIGS  = ['enter', 'loop'] as const;
const LOOP_DIRS    = ['normal', 'alternate'] as const;

const POPOVER_TITLES: Record<string, string> = {
  enter: 'Enter Animation',
  exit: 'Exit Animation',
  loop: 'Loop Animation',
  press: 'Press Interaction',
  hover: 'Hover Interaction',
  tilt: '3D Tilt',
  mouseParallax: 'Mouse Parallax',
  focus: 'Focus Ring',
  flip: 'Flip Card',
  scroll: 'Scroll Trigger',
  parallax: 'Parallax',
  scrollProgress: 'Scroll Progress',
  colorTransition: 'Color Transition',
  layout: 'Layout Animation',
  filter: 'Filter / FX',
  morph: 'Morph Shape',
  imperativeTrigger: 'Imperative Trigger',
  drag: 'Drag',
  splitText: 'Split Text',
  statesMachine: 'States Machine',
  particles: 'Particles',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function postPreview(nodeId: string, category?: string) {
  if (typeof window === 'undefined') return;
  const msg = { type: 'sdui-preview-animation', nodeId, category };
  // Builder renders SDUI directly (no iframe), so post to window itself first.
  window.postMessage(msg, '*');
  // Also forward to any iframes that might exist (e.g. embedded previews).
  document.querySelectorAll('iframe').forEach(f =>
    f.contentWindow?.postMessage(msg, '*')
  );
}

function animNum(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === 'object' && v !== null) return fallback;
  return typeof v === 'number' ? v : fallback;
}

function animBinding(v: unknown, fallback: number): FormulaValue {
  return (v !== undefined && v !== null ? v : fallback) as FormulaValue;
}

// ─── CategoryGroup ────────────────────────────────────────────────────────────

function CategoryGroup({
  label, hasActive, activeCount, children,
}: {
  label: string;
  hasActive: boolean;
  activeCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(hasActive);
  return (
    <div style={{ marginBottom: 4 }}>
      {/* Clean flat divider-style header — no filled background */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          width: '100%', background: 'none', border: 'none',
          borderTop: '1px solid #1e293b',
          cursor: 'pointer', padding: '8px 0 6px',
        }}
      >
        <svg
          width="7" height="7" viewBox="0 0 8 8" fill="none"
          style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
        >
          <path d="M2 1.5L5.5 4 2 6.5" stroke={open ? '#6366f1' : '#374151'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.07em',
          color: open ? '#94a3b8' : '#475569', textTransform: 'uppercase',
        }}>
          {label}
        </span>
        {activeCount > 0 && (
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 99,
            background: 'rgba(99,102,241,0.2)', color: '#818cf8', fontWeight: 600,
            border: '1px solid rgba(99,102,241,0.3)',
          }}>
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div style={{ paddingBottom: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── SubSection ───────────────────────────────────────────────────────────────

function SubSection({
  label, children, defaultOpen = false,
  previewEl, isActive = false, onConfigure,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  previewEl?: React.ReactNode;
  isActive?: boolean;
  onConfigure?: (e: React.MouseEvent) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: open ? '#0f172a' : '#0a1120',
          borderRadius: 6, padding: '5px 8px',
          border: `1px solid ${open ? '#1e3a5f' : '#1e293b'}`,
          marginBottom: open ? 8 : 0,
          cursor: 'pointer',
        }}
        onClick={() => setOpen(o => !o)}
      >
        {isActive && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#6366f1', flexShrink: 0 }} />
        )}
        <svg
          width="7" height="7" viewBox="0 0 8 8" fill="none"
          style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
        >
          <path d="M2 1.5L5.5 4 2 6.5" stroke={open ? '#e2e8f0' : '#4b5563'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 500, color: open ? '#e2e8f0' : '#6b7280' }}>
          {label}
        </span>
        {previewEl && <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>{previewEl}</div>}
        {/* Configure — shown when section is active or header is hovered */}
        {onConfigure && (isActive || hovered) && (
          <button
            onClick={e => { e.stopPropagation(); onConfigure(e); }}
            title="Configure settings"
            style={{
              padding: '3px 5px', background: 'transparent',
              border: '1px solid #374151', borderRadius: 3,
              cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center',
            }}
          >
            {/* Settings: 3 horizontal sliders icon */}
            <svg width="11" height="9" viewBox="0 0 12 10" fill="none">
              <line x1="1" y1="2" x2="11" y2="2" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="8.5" cy="2" r="1.5" fill="#0d1526" stroke="#6b7280" strokeWidth="1.2" />
              <line x1="1" y1="5" x2="11" y2="5" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="3.5" cy="5" r="1.5" fill="#0d1526" stroke="#6b7280" strokeWidth="1.2" />
              <line x1="1" y1="8" x2="11" y2="8" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="7" cy="8" r="1.5" fill="#0d1526" stroke="#6b7280" strokeWidth="1.2" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <div style={{ paddingLeft: 6, paddingRight: 2, paddingBottom: 4, paddingTop: 2, borderLeft: '2px solid #1e3a5f' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8 }}>{children}</div>;
}

// PRow — Row with no extra margin; used in inline advanced sections that aren't in the popover flex-gap context
function PRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>{children}</div>;
}

// ─── FromOverride / ToOverride field row ─────────────────────────────────────
// Compact row: label + number input + optional "px" unit + clear button.
// When value is undefined the input shows as empty/placeholder.

interface OverrideRowProps {
  label: string;
  value: number | undefined;
  placeholder?: string;
  unit?: string;
  step?: number;
  onChange: (v: number | undefined) => void;
}

function OverrideRow({ label, value, placeholder = '—', unit, step = 1, onChange }: OverrideRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: '#9ca3af', minWidth: 72, flexShrink: 0 }}>{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={e => {
          const raw = e.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
        style={{
          flex: 1, fontSize: 10, padding: '3px 5px', borderRadius: 3,
          border: `1px solid ${value !== undefined ? '#4f6b8f' : '#374151'}`,
          background: '#111827', color: '#f9fafb',
          fontFamily: 'monospace', boxSizing: 'border-box' as const,
        }}
      />
      {unit && <span style={{ fontSize: 9, color: '#6b7280', flexShrink: 0 }}>{unit}</span>}
      {value !== undefined && (
        <button
          onClick={() => onChange(undefined)}
          title="Clear override"
          style={{ fontSize: 11, lineHeight: 1, padding: '1px 4px', border: '1px solid #374151', borderRadius: 3, background: 'transparent', color: '#6b7280', cursor: 'pointer', flexShrink: 0 }}
        >×</button>
      )}
    </div>
  );
}

function FromOverrideSection({
  label, from, patch,
}: {
  label: string;
  from: Record<string, number | undefined> | undefined;
  patch: (p: Record<string, number | undefined>) => void;
}) {
  return (
    <div style={{ borderTop: '1px solid #1e293b', paddingTop: 10, marginTop: 2 }}>
      <span style={{ fontSize: 9, color: '#6366f1', fontWeight: 600, display: 'block', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
        {label}
      </span>
      <span style={{ fontSize: 9, color: '#4b5563', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
        Override preset starting values. Leave blank to use type defaults.
      </span>
      <OverrideRow label="Opacity"     value={from?.opacity}     placeholder="auto" step={0.05}  onChange={v => patch({ opacity: v })} />
      <OverrideRow label="Translate X" value={from?.translateX}  placeholder="auto" step={1} unit="px" onChange={v => patch({ translateX: v })} />
      <OverrideRow label="Translate Y" value={from?.translateY}  placeholder="auto" step={1} unit="px" onChange={v => patch({ translateY: v })} />
      <OverrideRow label="Scale"       value={from?.scale}       placeholder="auto" step={0.05}  onChange={v => patch({ scale: v })} />
      <OverrideRow label="Rotate"      value={from?.rotate}      placeholder="auto" step={5} unit="°" onChange={v => patch({ rotate: v })} />
      <OverrideRow label="Blur"        value={from?.blur}        placeholder="auto" step={1} unit="px" onChange={v => patch({ blur: v })} />
      <OverrideRow label="Skew X"      value={from?.skewX}       placeholder="auto" step={5} unit="°" onChange={v => patch({ skewX: v })} />
      <OverrideRow label="Skew Y"      value={from?.skewY}       placeholder="auto" step={5} unit="°" onChange={v => patch({ skewY: v })} />
    </div>
  );
}

// ─── AnimConfigPopover ────────────────────────────────────────────────────────
// Fixed-position floating panel to the LEFT of the right panel (right: 268px).
// Closes on outside click (ignores clicks inside the right panel) or Escape.

function AnimConfigPopover({
  y, title, onClose, children,
}: {
  y: number;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking outside the popover AND outside the right panel
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-anim-popover]')) return;
      if (target.closest('[data-testid="panel-right"]')) return;
      // Don't close when the formula editor is open (opened from within the popover)
      if (target.closest('[data-testid="formula-editor"]')) return;
      onClose();
    };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const viewH = typeof window !== 'undefined' ? window.innerHeight : 800;
  // Position so the popover stays within the viewport; no maxHeight clamp — let it grow naturally
  const top = Math.min(Math.max(40, y - 80), viewH - 60);

  return (
    <div
      ref={ref}
      data-anim-popover
      style={{
        position: 'fixed', right: 268, top,
        width: 264, zIndex: 10001,
        background: '#0d1526',
        border: '1px solid #1e3a5f',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Arrow pointing right toward the panel */}
      <div style={{
        position: 'absolute', right: -7, top: 20,
        width: 0, height: 0,
        borderTop: '7px solid transparent', borderBottom: '7px solid transparent',
        borderLeft: '7px solid #1e3a5f',
      }} />
      <div style={{
        position: 'absolute', right: -5, top: 22,
        width: 0, height: 0,
        borderTop: '5px solid transparent', borderBottom: '5px solid transparent',
        borderLeft: '5px solid #0d1526',
      }} />
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px 9px',
        borderBottom: '1px solid #1e293b',
        borderRadius: '10px 10px 0 0',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', letterSpacing: '0.01em' }}>{title}</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
        >×</button>
      </div>
      {/* Body — no fixed height, grows with content; scrolls only when near viewport edge */}
      <div style={{
        padding: '14px 14px 16px',
        overflowY: 'auto',
        maxHeight: `calc(${viewH}px - ${top}px - 60px)`,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {children}
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AnimationInDesignProps {
  nodeId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any;
  commitHistory: () => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AnimationInDesign({ nodeId, node, store, commitHistory }: AnimationInDesignProps) {
  // Animation may live at node.props.animation (canonical, written by the panel)
  // or node.animation (top-level alias used by the renderer and raw JSON configs).
  const cfg: AnimationConfig =
    (node?.props as { animation?: AnimationConfig })?.animation ??
    (node as { animation?: AnimationConfig })?.animation ??
    {};


  const patch = useCallback((partial: Partial<AnimationConfig>) => {
    const next = { ...cfg, ...partial };
    store.patchProp(nodeId, 'props.animation', next);
    commitHistory();
  }, [cfg, nodeId, store, commitHistory]);

  const patchEnter    = (p: object) => patch({ enter:             { ...cfg.enter,            ...p } });
  const patchExit     = (p: object) => patch({ exit:              { ...cfg.exit,             ...p } });
  const patchLoop     = (p: object) => patch({ loop:              { ...cfg.loop,             ...p } });

  // Helpers for from/to overrides
  const patchEnterFrom = (p: Record<string, number | undefined>) => {
    const merged = { ...(cfg.enter?.from ?? {}), ...p };
    // Drop keys explicitly set to undefined
    const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
    patchEnter({ from: Object.keys(clean).length ? clean : undefined });
  };
  const patchExitTo = (p: Record<string, number | undefined>) => {
    const merged = { ...(cfg.exit?.to ?? {}), ...p };
    const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
    patchExit({ to: Object.keys(clean).length ? clean : undefined });
  };
  const patchScrollFrom = (p: Record<string, number | undefined>) => {
    const merged = { ...(cfg.scroll?.from ?? {}), ...p };
    const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
    patchScroll({ from: Object.keys(clean).length ? clean : undefined });
  };
  const patchPress    = (p: object) => patch({ press:             { ...cfg.press,            ...p } });
  const patchHover    = (p: object) => patch({ hover:             { ...cfg.hover,            ...p } });
  const patchScroll   = (p: object) => patch({ scroll:            { ...cfg.scroll,           ...p } });
  const patchPar      = (p: object) => patch({ parallax:          { ...cfg.parallax,         ...p } });
  const patchDrag     = (p: object) => patch({ drag:              { ...cfg.drag,             ...p } });
  const patchColor    = (p: object) => patch({ color:             { ...cfg.color,            ...p } });
  const patchLayout   = (p: object) => patch({ layout:            { ...cfg.layout,           ...p } });
  const patchImpTrig  = (p: object) => patch({ imperativeTrigger: { ...cfg.imperativeTrigger,...p } });
  const patchFilter   = (p: object) => patch({ filter:            { ...cfg.filter,           ...p } });
  const patchTilt     = (p: object) => patch({ tilt:              { ...cfg.tilt,             ...p } });
  const patchMousePar = (p: object) => patch({ mouseParallax:     { ...cfg.mouseParallax,    ...p } });
  const patchFocus    = (p: object) => patch({ focus:             { ...cfg.focus,            ...p } });
  const patchMorph    = (p: object) => patch({ morphShape:        { ...cfg.morphShape,       ...p } });
  const patchScrollProg = (p: object) => patch({ scrollProgress:  { ...cfg.scrollProgress,  ...p } });
  const patchSvgStroke  = (p: object) => patch({ svgStroke:       { ...cfg.svgStroke,        ...p } });
  const patchBezier     = (vals: [number, number, number, number]) => patch({ customBezier: vals });

  const bindOrPatchAnim = useCallback((
    patchFn: (p: object) => void,
    key: string,
    v: FormulaValue,
  ) => {
    patchFn({ [key]: v });
    commitHistory();
  }, [commitHistory]);

  const enter    = cfg.enter            ?? {};
  const exit     = cfg.exit             ?? {};
  const loop     = cfg.loop             ?? {};
  const press    = cfg.press            ?? {};
  const hover    = cfg.hover            ?? {};
  const scroll   = cfg.scroll           ?? {};
  const par      = cfg.parallax         ?? {};
  const drag     = cfg.drag             ?? {};
  const color    = cfg.color            ?? {};
  const layout   = cfg.layout           ?? {};
  const impTrig: Partial<ImperativeTriggerConfig> = cfg.imperativeTrigger ?? {};
  const filt:    Partial<FilterConfig>            = cfg.filter            ?? {};
  const tiltCfg: Partial<TiltConfig>              = cfg.tilt              ?? {};
  const mousePar:Partial<MouseParallaxConfig>     = cfg.mouseParallax     ?? {};
  const focusCfg:Partial<FocusConfig>             = cfg.focus             ?? {};
  const morphCfg:   Partial<MorphShapeConfig>        = cfg.morphShape     ?? {};
  const scrollProg: Partial<ScrollProgressConfig>   = cfg.scrollProgress  ?? {};
  const svgStr:     Partial<SvgStrokeConfig>        = cfg.svgStroke       ?? {};
  const bezier = cfg.customBezier ?? [0.4, 0, 0.2, 1] as [number, number, number, number];
  const tl: TimelineStep[] = cfg.timeline ?? [];
  const gradAnim:    Partial<GradientAnimationConfig> = cfg.gradientAnimation ?? {};
  const clipPathCfg: Partial<ClipPathConfig>          = cfg.clipPath          ?? {};
  const maskCfg2:    Partial<MaskConfig>              = cfg.mask              ?? {};
  const pseudoCfg:   Partial<PseudoElementConfig>     = cfg.pseudoElement     ?? {};
  const gestureCfg:  Partial<GestureConfig>           = cfg.gesture           ?? {};
  const flipCfg:     Partial<FlipConfig>              = cfg.flip              ?? {};
  const splitTextCfg:Partial<SplitTextConfig>         = cfg.splitText         ?? {};
  const particlesCfg:Partial<ParticlesConfig>         = cfg.particles         ?? {};
  const shimmerCfg = cfg.shimmer ?? {};
  const statesCfg  = cfg.states  ?? { states: {} } as NonNullable<AnimationConfig['states']>;

  const patchGrad       = (p: Partial<GradientAnimationConfig>) => patch({ gradientAnimation: { ...gradAnim,    ...p } });
  const patchClip       = (p: Partial<ClipPathConfig>)          => patch({ clipPath:          { ...clipPathCfg, ...p } });
  const patchMask2      = (p: Partial<MaskConfig>)              => patch({ mask:              { ...maskCfg2,    ...p } });
  const patchPseudo     = (p: Partial<PseudoElementConfig>)     => patch({ pseudoElement:     { ...pseudoCfg,   ...p } });
  const patchGesture    = (p: Partial<GestureConfig>)           => patch({ gesture:           { ...gestureCfg,  ...p } });
  const patchFlip       = (p: Partial<FlipConfig>)              => patch({ flip:              { ...flipCfg,     ...p } });
  const patchSplitText  = (p: Partial<SplitTextConfig>)         => patch({ splitText:         { ...splitTextCfg,...p } });
  const patchParticles  = (p: Partial<ParticlesConfig>)         => patch({ particles:         { ...particlesCfg,...p } });
  const patchShimmer    = (p: Partial<typeof shimmerCfg>)       => patch({ shimmer:           { ...shimmerCfg,  ...p } });
  const patchStates     = (p: Partial<NonNullable<AnimationConfig['states']>>) => patch({ states: { ...statesCfg, ...p } });

  const gradColors = gradAnim.colors ?? ['#6366f1', '#ec4899', '#6366f1'];
  const hasMap = !!(node?.map);

  // ── Active-count badges ──────────────────────────────────────────────────
  const basicActive = [
    enter.type && enter.type !== 'none',
    exit.type && exit.type !== 'none',
    loop.type && loop.type !== 'none',
  ].filter(Boolean).length;

  const interactionActive = [
    press.scale != null,
    hover.scale != null,
    tiltCfg.enabled,
    mousePar.enabled,
    focusCfg.enabled,
    flipCfg.trigger != null,
  ].filter(Boolean).length;

  const scrollActive = [
    scroll.enabled,
    par.enabled,
    scrollProg.enabled,
  ].filter(Boolean).length;

  const statesActive = [
    color.enabled,
    layout.enabled,
    filt.enabled,
    morphCfg.enabled,
    impTrig.type && impTrig.type !== 'none',
    drag.enabled,
    shimmerCfg.duration != null,
    splitTextCfg.type != null,
    particlesCfg.count != null,
    statesCfg.states && Object.keys(statesCfg.states).length > 0,
  ].filter(Boolean).length;

  const advancedActive = [
    cfg.customBezier,
    tl.length > 0,
    svgStr.enabled,
    gradAnim.enabled,
    clipPathCfg.enabled,
    maskCfg2.enabled,
    pseudoCfg.enabled,
    gestureCfg.enabled,
  ].filter(Boolean).length;

  // ── Popover state ────────────────────────────────────────────────────────
  const [popover, setPopover] = useState<{ category: string; y: number } | null>(null);

  const openPopover = (category: string, y: number) => setPopover({ category, y });
  const togglePopover = (category: string, e: React.MouseEvent) =>
    setPopover(p => p?.category === category ? null : { category, y: e.clientY });

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={SECTION_STYLE}>
      <SectionHeader title="Animation">
        <button
          onClick={() => postPreview(nodeId)}
          title="Preview all animations on canvas"
          style={{
            padding: '2px 8px', fontSize: 10, background: '#1e3a5f',
            border: '1px solid #1d4ed8', borderRadius: 4, color: '#93c5fd',
            cursor: 'pointer',
          }}
        >
          ▶ Preview
        </button>
      </SectionHeader>

      {/* ── BASIC ─────────────────────────────────────────────────────────── */}
      <CategoryGroup label="Basic" hasActive={basicActive > 0} activeCount={basicActive}>

        {/* Enter */}
        <SubSection
          label="Enter"
          defaultOpen={!!(enter.type && enter.type !== 'none')}
          isActive={!!(enter.type && enter.type !== 'none')}
          previewEl={enter.type && enter.type !== 'none'
            ? <AnimPreview type={enter.type} category="enter" />
            : undefined}
          onConfigure={enter.type && enter.type !== 'none'
            ? e => togglePopover('enter', e) : undefined}
        >
          <ChipSelect
            value={enter.type ?? 'none'}
            options={ENTER_TYPES as unknown as string[]}
            onChange={(v, e) => {
              patchEnter({ type: v });
              if (v !== 'none') {
                openPopover('enter', e.clientY);
                // Auto-preview after a tick so the patch propagates to the canvas first
                setTimeout(() => postPreview(nodeId), 80);
              } else setPopover(null);
            }}
          />
        </SubSection>

        {/* Exit */}
        <SubSection
          label="Exit"
          defaultOpen={!!(exit.type && exit.type !== 'none')}
          isActive={!!(exit.type && exit.type !== 'none')}
          previewEl={exit.type && exit.type !== 'none'
            ? <AnimPreview type={exit.type} category="exit" />
            : undefined}
          onConfigure={exit.type && exit.type !== 'none'
            ? e => togglePopover('exit', e) : undefined}
        >
          <ChipSelect
            value={exit.type ?? 'none'}
            options={EXIT_TYPES as unknown as string[]}
            onChange={(v, e) => {
              patchExit({ type: v });
              if (v !== 'none') openPopover('exit', e.clientY);
              else setPopover(null);
            }}
          />
        </SubSection>

        {/* Loop */}
        <SubSection
          label="Loop"
          defaultOpen={!!(loop.type && loop.type !== 'none')}
          isActive={!!(loop.type && loop.type !== 'none')}
          previewEl={loop.type && loop.type !== 'none'
            ? <AnimPreview type={loop.type} category="loop" />
            : undefined}
          onConfigure={loop.type && loop.type !== 'none'
            ? e => togglePopover('loop', e) : undefined}
        >
          <ChipSelect
            value={loop.type ?? 'none'}
            options={LOOP_TYPES as unknown as string[]}
            onChange={(v, e) => {
              patchLoop({ type: v });
              if (v !== 'none') openPopover('loop', e.clientY);
              else setPopover(null);
            }}
          />
        </SubSection>

      </CategoryGroup>

      {/* ── INTERACTION ───────────────────────────────────────────────────── */}
      <CategoryGroup label="Interaction" hasActive={interactionActive > 0} activeCount={interactionActive}>

        {/* Press */}
        <SubSection
          label="Press"
          defaultOpen={press.scale != null}
          isActive={press.scale != null}
          previewEl={press.scale != null ? (
            <div style={{ width: 14, height: 14, background: '#1e3a5f', border: '1px solid #3b5c8a', borderRadius: 3, transform: 'scale(0.82)', flexShrink: 0 }} />
          ) : undefined}
          onConfigure={e => togglePopover('press', e)}
        >
          <ToggleRow
            label="Enable press"
            active={press.scale != null}
            onChange={() => {
              if (press.scale == null) patchPress({ scale: 0.95, duration: 120, easing: 'easeOut' });
              else patch({ press: undefined });
            }}
          />
        </SubSection>

        {/* Hover */}
        <SubSection
          label="Hover"
          defaultOpen={hover.scale != null}
          isActive={hover.scale != null}
          previewEl={hover.scale != null ? (
            <div style={{ width: 14, height: 14, background: '#1e3a5f', border: '1px solid #3b5c8a', borderRadius: 3, transform: 'translateY(-2px)', flexShrink: 0 }} />
          ) : undefined}
          onConfigure={e => togglePopover('hover', e)}
        >
          <ToggleRow
            label="Enable hover"
            active={hover.scale != null}
            onChange={() => {
              if (hover.scale == null) patchHover({ scale: 1.05, duration: 200, easing: 'easeOut' });
              else patch({ hover: undefined });
            }}
          />
        </SubSection>

        {/* 3D Tilt */}
        <SubSection
          label="3D Tilt (Mouse)"
          defaultOpen={!!tiltCfg.enabled}
          isActive={!!tiltCfg.enabled}
          onConfigure={e => togglePopover('tilt', e)}
        >
          <ToggleRow label="Enable tilt" active={tiltCfg.enabled} onChange={() => patchTilt({ enabled: !tiltCfg.enabled })} />
        </SubSection>

        {/* Mouse Parallax */}
        <SubSection
          label="Mouse Parallax"
          defaultOpen={!!mousePar.enabled}
          isActive={!!mousePar.enabled}
          onConfigure={e => togglePopover('mouseParallax', e)}
        >
          <ToggleRow label="Enable mouse parallax" active={mousePar.enabled} onChange={() => patchMousePar({ enabled: !mousePar.enabled })} />
        </SubSection>

        {/* Focus Ring */}
        <SubSection
          label="Focus Ring"
          defaultOpen={!!focusCfg.enabled}
          isActive={!!focusCfg.enabled}
          onConfigure={e => togglePopover('focus', e)}
        >
          <ToggleRow label="Enable focus ring" active={focusCfg.enabled} onChange={() => patchFocus({ enabled: !focusCfg.enabled })} />
        </SubSection>

        {/* Flip Card */}
        <SubSection
          label="Flip Card"
          defaultOpen={flipCfg.trigger != null}
          isActive={flipCfg.trigger != null}
          onConfigure={flipCfg.trigger != null ? e => togglePopover('flip', e) : undefined}
        >
          <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
            Flips the element on hover or click to reveal the back face.
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['hover', 'click', 'none'] as const).map(t => (
              <button
                key={t}
                onClick={() => patchFlip({ trigger: t === 'none' ? undefined : t })}
                style={{
                  flex: 1, fontSize: 10, padding: '3px 6px', borderRadius: 3, cursor: 'pointer',
                  background: (flipCfg.trigger ?? 'none') === t ? '#3b82f6' : '#1f2937',
                  color: (flipCfg.trigger ?? 'none') === t ? '#fff' : '#9ca3af',
                  border: '1px solid #374151',
                }}
              >{t}</button>
            ))}
          </div>
          {flipCfg.trigger && (
            <div style={{ marginTop: 6 }}>
              <SliderField label="Duration (ms)" value={flipCfg.duration ?? 400} min={100} max={1500} step={50} unit="ms" onChange={v => patchFlip({ duration: v })} />
            </div>
          )}
        </SubSection>

      </CategoryGroup>

      {/* ── SCROLL ────────────────────────────────────────────────────────── */}
      <CategoryGroup label="Scroll" hasActive={scrollActive > 0} activeCount={scrollActive}>

        {/* Scroll Trigger */}
        <SubSection
          label="Scroll Trigger"
          defaultOpen={!!scroll.enabled}
          isActive={!!scroll.enabled}
          onConfigure={!!scroll.enabled ? e => togglePopover('scroll', e) : undefined}
        >
          <ToggleRow label="Enable scroll trigger" active={scroll.enabled} onChange={() => patchScroll({ enabled: !scroll.enabled })} />
          {scroll.enabled && (
            <>
              <div style={{ height: 6 }} />
              <ChipSelect
                value={scroll.type ?? 'fadeIn'}
                options={ENTER_TYPES as unknown as string[]}
                onChange={v => patchScroll({ type: v })}
              />
            </>
          )}
        </SubSection>

        {/* Parallax */}
        <SubSection
          label="Parallax"
          defaultOpen={!!par.enabled}
          isActive={!!par.enabled}
          onConfigure={e => togglePopover('parallax', e)}
        >
          <ToggleRow label="Enable parallax" active={par.enabled} onChange={() => patchPar({ enabled: !par.enabled })} />
        </SubSection>

        {/* Scroll Progress */}
        <SubSection
          label="Scroll Progress"
          defaultOpen={!!scrollProg.enabled}
          isActive={!!scrollProg.enabled}
          onConfigure={e => togglePopover('scrollProgress', e)}
        >
          <ToggleRow label="Enable scroll progress" active={scrollProg.enabled} onChange={() => patchScrollProg({ enabled: !scrollProg.enabled })} />
        </SubSection>

      </CategoryGroup>

      {/* ── STATES & FX ───────────────────────────────────────────────────── */}
      <CategoryGroup label="States & FX" hasActive={statesActive > 0} activeCount={statesActive}>

        {/* Color Transition */}
        <SubSection
          label="Color Transition"
          defaultOpen={!!color.enabled}
          isActive={!!color.enabled}
          onConfigure={e => togglePopover('colorTransition', e)}
        >
          <ToggleRow label="Enable color transition" active={color.enabled} onChange={() => patchColor({ enabled: !color.enabled })} />
        </SubSection>

        {/* Layout Animation */}
        <SubSection
          label="Layout Animation"
          defaultOpen={!!layout.enabled}
          isActive={!!layout.enabled}
          onConfigure={e => togglePopover('layout', e)}
        >
          <ToggleRow label="Enable layout animation" active={layout.enabled} onChange={() => patchLayout({ enabled: !layout.enabled })} />
        </SubSection>

        {/* Filter / Visual Effects */}
        <SubSection
          label="Filter / Visual Effects"
          defaultOpen={!!filt.enabled}
          isActive={!!filt.enabled}
          onConfigure={e => togglePopover('filter', e)}
        >
          <ToggleRow label="Enable filter" active={filt.enabled} onChange={() => patchFilter({ enabled: !filt.enabled })} />
        </SubSection>

        {/* Morph Shape */}
        <SubSection
          label="Morph Shape"
          defaultOpen={!!morphCfg.enabled}
          isActive={!!morphCfg.enabled}
          onConfigure={e => togglePopover('morph', e)}
        >
          <ToggleRow label="Enable morph" active={morphCfg.enabled} onChange={() => patchMorph({ enabled: !morphCfg.enabled })} />
        </SubSection>

        {/* Imperative Trigger */}
        <SubSection
          label="Imperative Trigger"
          defaultOpen={!!(impTrig.type && impTrig.type !== 'none')}
          isActive={!!(impTrig.type && impTrig.type !== 'none')}
          onConfigure={impTrig.type && impTrig.type !== 'none'
            ? e => togglePopover('imperativeTrigger', e) : undefined}
        >
          <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
            Plays a one-shot animation whenever a variable changes.
          </span>
          <ChipSelect
            value={impTrig.type ?? 'none'}
            options={LOOP_TYPES as unknown as string[]}
            onChange={(v, e) => {
              patchImpTrig({ type: v });
              if (v !== 'none') openPopover('imperativeTrigger', e.clientY);
              else setPopover(null);
            }}
          />
        </SubSection>

        {/* Drag */}
        <SubSection
          label="Drag"
          defaultOpen={!!drag.enabled}
          isActive={!!drag.enabled}
          onConfigure={e => togglePopover('drag', e)}
        >
          <ToggleRow label="Enable drag" active={drag.enabled} onChange={() => patchDrag({ enabled: !drag.enabled })} />
        </SubSection>

        {/* Shimmer */}
        <SubSection
          label="Shimmer"
          defaultOpen={shimmerCfg.duration != null}
          isActive={shimmerCfg.duration != null}
        >
          <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
            Sweeping shimmer highlight overlay (skeleton-loader style).
          </span>
          <ToggleRow
            label="Enable shimmer"
            active={shimmerCfg.duration != null}
            onChange={() => {
              if (shimmerCfg.duration != null) patchShimmer({ duration: undefined });
              else patchShimmer({ duration: 1200, baseColor: '#e5e7eb', highlightColor: '#f9fafb' });
            }}
          />
          {shimmerCfg.duration != null && (
            <div style={{ marginTop: 6 }}>
              <SliderField label="Duration (ms)" value={shimmerCfg.duration ?? 1200} min={400} max={3000} step={100} unit="ms" onChange={v => patchShimmer({ duration: v })} />
              <div style={{ height: 4 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <ColorInput label="Base" value={shimmerCfg.baseColor ?? '#e5e7eb'} onChange={v => patchShimmer({ baseColor: v })} />
                <ColorInput label="Highlight" value={shimmerCfg.highlightColor ?? '#f9fafb'} onChange={v => patchShimmer({ highlightColor: v })} />
              </div>
            </div>
          )}
        </SubSection>

        {/* Split Text */}
        <SubSection
          label="Split Text"
          defaultOpen={splitTextCfg.type != null}
          isActive={splitTextCfg.type != null}
          onConfigure={splitTextCfg.type != null ? e => togglePopover('splitText', e) : undefined}
        >
          <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
            Animate text character by character or word by word.
          </span>
          <ToggleRow
            label="Enable split text"
            active={splitTextCfg.type != null}
            onChange={() => {
              if (splitTextCfg.type != null) patchSplitText({ type: undefined });
              else patchSplitText({ type: 'fadeIn', split: 'char', stagger: 30, duration: 400 });
            }}
          />
          {splitTextCfg.type != null && (
            <div style={{ marginTop: 6 }}>
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: '#9ca3af', display: 'block', marginBottom: 2 }}>Split by</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['char', 'word', 'line'] as const).map(s => (
                    <button key={s} onClick={() => patchSplitText({ split: s })}
                      style={{ flex: 1, fontSize: 10, padding: '3px 4px', borderRadius: 3, cursor: 'pointer',
                        background: (splitTextCfg.split ?? 'char') === s ? '#3b82f6' : '#1f2937',
                        color: (splitTextCfg.split ?? 'char') === s ? '#fff' : '#9ca3af',
                        border: '1px solid #374151' }}>{s}</button>
                  ))}
                </div>
              </div>
              <ChipSelect
                value={splitTextCfg.type ?? 'fadeIn'}
                options={ENTER_TYPES as unknown as string[]}
                onChange={v => patchSplitText({ type: v })}
              />
              <div style={{ height: 6 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                <SliderField label="Duration" value={splitTextCfg.duration ?? 400} min={100} max={2000} step={50} unit="ms" onChange={v => patchSplitText({ duration: v })} />
                <SliderField label="Stagger" value={splitTextCfg.stagger ?? 30} min={0} max={200} step={5} unit="ms" onChange={v => patchSplitText({ stagger: v })} />
                <SliderField label="Delay" value={splitTextCfg.delay ?? 0} min={0} max={2000} step={50} unit="ms" onChange={v => patchSplitText({ delay: v })} />
              </div>
            </div>
          )}
        </SubSection>

        {/* States Machine */}
        <SubSection
          label="States Machine"
          defaultOpen={statesCfg.states && Object.keys(statesCfg.states).length > 0}
          isActive={statesCfg.states && Object.keys(statesCfg.states).length > 0}
          onConfigure={e => togglePopover('statesMachine', e)}
        >
          <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
            Switch between visual states (e.g. default/hover/active) driven by a variable.
          </span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: '#9ca3af' }}>
              {Object.keys(statesCfg.states ?? {}).length} state(s) configured
            </span>
            <button
              onClick={e => togglePopover('statesMachine', e)}
              style={{ fontSize: 10, padding: '3px 8px', border: '1px solid #374151', borderRadius: 3, background: '#1f2937', color: '#d1d5db', cursor: 'pointer' }}
            >Configure</button>
          </div>
        </SubSection>

        {/* Particles */}
        <SubSection
          label="Particles"
          defaultOpen={particlesCfg.count != null}
          isActive={particlesCfg.count != null}
          onConfigure={particlesCfg.count != null ? e => togglePopover('particles', e) : undefined}
        >
          <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
            Animated particle canvas overlay (network / star field).
          </span>
          <ToggleRow
            label="Enable particles"
            active={particlesCfg.count != null}
            onChange={() => {
              if (particlesCfg.count != null) patchParticles({ count: undefined });
              else patchParticles({ count: 50, color: '#ffffff', speed: 1, maxRadius: 3, connectDistance: 80 });
            }}
          />
          {particlesCfg.count != null && (
            <div style={{ marginTop: 6 }}>
              <SliderField label="Count" value={particlesCfg.count ?? 50} min={5} max={300} step={5} unit="" onChange={v => patchParticles({ count: v })} />
              <div style={{ height: 4 }} />
              <SliderField label="Speed" value={particlesCfg.speed ?? 1} min={0.1} max={5} step={0.1} unit="" onChange={v => patchParticles({ speed: v })} />
              <div style={{ height: 4 }} />
              <SliderField label="Connect dist" value={particlesCfg.connectDistance ?? 80} min={20} max={250} step={10} unit="px" onChange={v => patchParticles({ connectDistance: v })} />
              <div style={{ height: 4 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <ColorInput label="Particles" value={particlesCfg.color ?? '#ffffff'} onChange={v => patchParticles({ color: v })} />
                <ColorInput label="Background" value={particlesCfg.background ?? 'transparent'} onChange={v => patchParticles({ background: v })} />
              </div>
            </div>
          )}
        </SubSection>

      </CategoryGroup>

      {/* ── ADVANCED ──────────────────────────────────────────────────────── */}
      <CategoryGroup label="Advanced" hasActive={advancedActive > 0} activeCount={advancedActive}>

        {/* Custom Bezier */}
        <SubSection label="Custom Bezier Easing" defaultOpen={!!cfg.customBezier} isActive={!!cfg.customBezier}>
          <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6 }}>
            Override per-animation easing with a custom cubic-bezier(x1, y1, x2, y2).
          </span>
          <PRow>
            <NumberInput label="x1" value={bezier[0]} min={0} max={1} step={0.01} onChange={v => patchBezier([v, bezier[1], bezier[2], bezier[3]])} />
            <NumberInput label="y1" value={bezier[1]} min={-2} max={2} step={0.01} onChange={v => patchBezier([bezier[0], v, bezier[2], bezier[3]])} />
            <NumberInput label="x2" value={bezier[2]} min={0} max={1} step={0.01} onChange={v => patchBezier([bezier[0], bezier[1], v, bezier[3]])} />
            <NumberInput label="y2" value={bezier[3]} min={-2} max={2} step={0.01} onChange={v => patchBezier([bezier[0], bezier[1], bezier[2], v])} />
          </PRow>
          <PRow>
            <span style={{ fontSize: 9, color: '#9ca3af' }}>cubic-bezier({bezier.join(', ')})</span>
            <button
              onClick={() => patch({ customBezier: undefined })}
              style={{ fontSize: 9, padding: '2px 6px', border: '1px solid #374151', borderRadius: 3, background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}
            >
              Clear
            </button>
          </PRow>
        </SubSection>

        {/* Declarative Timeline */}
        <SubSection label="Declarative Timeline" defaultOpen={tl.length > 0} isActive={tl.length > 0}>
          <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6 }}>
            Each step animates a CSS property from → to over a time window (ms).
          </span>
          {tl.map((step, i) => (
            <div key={i} style={{ border: '1px solid #374151', borderRadius: 4, padding: 8, marginBottom: 8 }}>
              <PRow>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>CSS property</span>
                  <input
                    type="text"
                    value={step.property}
                    onChange={e => { const next = [...tl]; next[i] = { ...next[i], property: e.target.value }; patch({ timeline: next }); }}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', boxSizing: 'border-box' }}
                  />
                </div>
                <button
                  onClick={() => { const next = tl.filter((_, j) => j !== i); patch({ timeline: next }); }}
                  style={{ alignSelf: 'flex-end', padding: '3px 6px', fontSize: 10, border: '1px solid #374151', borderRadius: 3, background: '#1f2937', color: '#ef4444', cursor: 'pointer' }}
                >✕</button>
              </PRow>
              <PRow>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>From</span>
                  <input type="text" value={String(step.from)} onChange={e => { const n = [...tl]; n[i] = { ...n[i], from: e.target.value }; patch({ timeline: n }); }}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>To</span>
                  <input type="text" value={String(step.to)} onChange={e => { const n = [...tl]; n[i] = { ...n[i], to: e.target.value }; patch({ timeline: n }); }}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', boxSizing: 'border-box' }} />
                </div>
              </PRow>
              <PRow>
                <NumberInput label="Start ms" value={step.startMs ?? 0}    min={0} max={10000} step={50} onChange={v => { const n = [...tl]; n[i] = { ...n[i], startMs: v }; patch({ timeline: n }); }} />
                <NumberInput label="End ms"   value={step.endMs   ?? 1000} min={0} max={10000} step={50} onChange={v => { const n = [...tl]; n[i] = { ...n[i], endMs: v };   patch({ timeline: n }); }} />
              </PRow>
            </div>
          ))}
          <button
            onClick={() => patch({ timeline: [...tl, { property: 'opacity', from: '0', to: '1', startMs: 0, endMs: 800 }] })}
            style={{ width: '100%', padding: '5px 0', fontSize: 10, background: '#1e3a5f', border: '1px solid #1d4ed8', borderRadius: 4, color: '#93c5fd', cursor: 'pointer' }}
          >
            + Add step
          </button>
        </SubSection>

        {/* SVG Stroke Draw */}
        <SubSection label="SVG Stroke Draw" defaultOpen={!!svgStr.enabled} isActive={!!svgStr.enabled}>
          <ToggleRow label="Enable stroke draw" active={!!svgStr.enabled} onChange={() => patchSvgStroke({ enabled: !svgStr.enabled })} />
          {svgStr.enabled && (
            <>
              <div style={{ height: 8 }} />
              <PRow>
                <SliderField label="Duration (ms)" value={svgStr.duration ?? 1500} min={100} max={5000} step={100} unit="ms" onChange={v => patchSvgStroke({ duration: v })} />
                <SliderField label="Delay (ms)"    value={svgStr.delay    ?? 0}    min={0}   max={3000} step={50}  unit="ms" onChange={v => patchSvgStroke({ delay: v })} />
              </PRow>
              <PRow>
                <SelectInput label="Easing" value={svgStr.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchSvgStroke({ easing: v })} />
                <NumberInput label="Stroke length (0=auto)" value={svgStr.length ?? 0} min={0} max={10000} step={10} onChange={v => patchSvgStroke({ length: v })} />
              </PRow>
            </>
          )}
        </SubSection>

        {/* Gradient Animation */}
        <SubSection
          label="Gradient Animation"
          defaultOpen={!!gradAnim.enabled}
          isActive={!!gradAnim.enabled}
          previewEl={gradAnim.enabled ? <AnimPreview type="gradientDrift" category="loop" /> : undefined}
        >
          <ToggleRow label="Enable gradient animation" active={!!gradAnim.enabled} onChange={() => patchGrad({ enabled: !gradAnim.enabled })} />
          {gradAnim.enabled && (
            <>
              <div style={{ height: 8 }} />
              <PRow>
                <SelectInput label="Type" value={gradAnim.type ?? 'linear'} options={['linear', 'radial', 'conic']} onChange={v => patchGrad({ type: v as GradientAnimationConfig['type'] })} />
                <NumberInput label="Angle (deg)" value={gradAnim.angle ?? 135} min={0} max={360} step={5} onChange={v => patchGrad({ angle: v })} />
              </PRow>
              <PRow>
                <SliderField label="Duration (ms)" value={gradAnim.duration ?? 4000} min={500} max={20000} step={500} unit="ms" onChange={v => patchGrad({ duration: v })} />
              </PRow>
              <ToggleRow label="Cycle colors"  active={!!gradAnim.animateColors} onChange={() => patchGrad({ animateColors: !gradAnim.animateColors })} />
              <ToggleRow label="Rotate angle"  active={!!gradAnim.animateAngle}  onChange={() => patchGrad({ animateAngle: !gradAnim.animateAngle })} />
              <ToggleRow label="Loop"           active={gradAnim.loop !== false}  onChange={() => patchGrad({ loop: !gradAnim.loop })} />
              <div style={{ fontSize: 10, color: '#888', padding: '6px 0 3px' }}>Colors (one per line):</div>
              <textarea
                rows={4}
                value={gradColors.join('\n')}
                onChange={e => patchGrad({ colors: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                style={{ width: '100%', fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: 4 }}
              />
            </>
          )}
        </SubSection>

        {/* Clip-Path Animation */}
        <SubSection label="Clip-Path Animation" defaultOpen={!!clipPathCfg.enabled} isActive={!!clipPathCfg.enabled}>
          <ToggleRow label="Enable clip-path animation" active={!!clipPathCfg.enabled} onChange={() => patchClip({ enabled: !clipPathCfg.enabled })} />
          {clipPathCfg.enabled && (
            <>
              <div style={{ height: 8 }} />
              <PRow>
                <SelectInput label="Trigger" value={clipPathCfg.trigger ?? 'enter'} options={['enter', 'hover', 'always']} onChange={v => patchClip({ trigger: v as ClipPathConfig['trigger'] })} />
                <SliderField label="Duration (ms)" value={clipPathCfg.duration ?? 600} min={100} max={3000} step={50} unit="ms" onChange={v => patchClip({ duration: v })} />
              </PRow>
              <PRow>
                <SelectInput label="Easing" value={clipPathCfg.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchClip({ easing: v })} />
              </PRow>
              <div style={{ fontSize: 10, color: '#888', padding: '2px 0' }}>From (clip-path):</div>
              <input value={clipPathCfg.from ?? ''} onChange={e => patchClip({ from: e.target.value })} placeholder="inset(0 100% 0 0)" style={{ width: '100%', fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '3px 6px', marginBottom: 6 }} />
              <div style={{ fontSize: 10, color: '#888', padding: '2px 0' }}>To (clip-path):</div>
              <input value={clipPathCfg.to ?? ''} onChange={e => patchClip({ to: e.target.value })} placeholder="inset(0 0% 0 0)" style={{ width: '100%', fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '3px 6px' }} />
            </>
          )}
        </SubSection>

        {/* Mask Animation */}
        <SubSection label="Mask Animation" defaultOpen={!!maskCfg2.enabled} isActive={!!maskCfg2.enabled}>
          <ToggleRow label="Enable mask animation" active={!!maskCfg2.enabled} onChange={() => patchMask2({ enabled: !maskCfg2.enabled })} />
          {maskCfg2.enabled && (
            <>
              <div style={{ fontSize: 10, color: '#888', padding: '6px 0 2px' }}>mask-image CSS value:</div>
              <input value={maskCfg2.image ?? ''} onChange={e => patchMask2({ image: e.target.value })} placeholder="linear-gradient(to right, black, transparent)" style={{ width: '100%', fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '3px 6px', marginBottom: 8 }} />
              <ToggleRow label="Animate wipe" active={!!maskCfg2.animateSize} onChange={() => patchMask2({ animateSize: !maskCfg2.animateSize })} />
              <div style={{ height: 6 }} />
              <PRow>
                <SliderField label="Duration (ms)" value={maskCfg2.duration ?? 800} min={100} max={5000} step={100} unit="ms" onChange={v => patchMask2({ duration: v })} />
                <SelectInput label="Easing" value={maskCfg2.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchMask2({ easing: v })} />
              </PRow>
            </>
          )}
        </SubSection>

        {/* Pseudo-Element Effects */}
        <SubSection label="Pseudo-Element Effects" defaultOpen={!!pseudoCfg.enabled} isActive={!!pseudoCfg.enabled}>
          <ToggleRow label="Enable pseudo-element" active={!!pseudoCfg.enabled} onChange={() => patchPseudo({ enabled: !pseudoCfg.enabled })} />
          {pseudoCfg.enabled && (
            <>
              <div style={{ height: 8 }} />
              <PRow>
                <SelectInput label="Target" value={pseudoCfg.target ?? '::before'} options={['::before', '::after']} onChange={v => patchPseudo({ target: v as PseudoElementConfig['target'] })} />
                <SelectInput label="Trigger" value={pseudoCfg.trigger ?? 'hover'} options={['hover', 'always', 'enter']} onChange={v => patchPseudo({ trigger: v as PseudoElementConfig['trigger'] })} />
              </PRow>
              <PRow>
                <ColorInput label="Background" value={pseudoCfg.background ?? '#6366f1'} onChange={v => patchPseudo({ background: v })} />
                <ColorInput label="Hover bg" value={pseudoCfg.hoverBackground ?? '#ec4899'} onChange={v => patchPseudo({ hoverBackground: v })} />
              </PRow>
              <PRow>
                <NumberInput label="Width (px/%)" value={parseInt(pseudoCfg.width ?? '100', 10)} min={0} max={100} step={1} onChange={v => patchPseudo({ width: v + '%' })} />
                <NumberInput label="Height (px)" value={parseInt(pseudoCfg.height ?? '2', 10)} min={1} max={100} step={1} onChange={v => patchPseudo({ height: v + 'px' })} />
                <NumberInput label="Hover opacity" value={(pseudoCfg.hoverOpacity ?? 1) * 100} min={0} max={100} step={5} onChange={v => patchPseudo({ hoverOpacity: v / 100 })} />
              </PRow>
              <PRow>
                <NumberInput label="Hover width %" value={parseInt(pseudoCfg.hoverWidth ?? '100', 10)} min={0} max={200} step={5} onChange={v => patchPseudo({ hoverWidth: v + '%' })} />
              </PRow>
            </>
          )}
        </SubSection>

        {/* Gesture / Swipe */}
        <SubSection label="Gesture / Swipe" defaultOpen={!!gestureCfg.enabled} isActive={!!gestureCfg.enabled}>
          <ToggleRow label="Enable gesture" active={!!gestureCfg.enabled} onChange={() => patchGesture({ enabled: !gestureCfg.enabled })} />
          {gestureCfg.enabled && (
            <>
              <ToggleRow label="Swipe detection" active={!!gestureCfg.swipe} onChange={() => patchGesture({ swipe: !gestureCfg.swipe })} />
              <div style={{ height: 8 }} />
              <PRow>
                <SliderField label="Min distance (px)"   value={gestureCfg.swipeThreshold   ?? 50}  min={10}  max={300}  step={5}  unit="px" onChange={v => patchGesture({ swipeThreshold: v })} />
                <SliderField label="Anim duration (ms)"  value={gestureCfg.animationDuration ?? 400} min={100} max={2000} step={50} unit="ms" onChange={v => patchGesture({ animationDuration: v })} />
              </PRow>
              <div style={{ fontSize: 10, color: '#888', padding: '4px 0 4px' }}>Workflow action to run on swipe:</div>
              <PRow>
                <span style={{ fontSize: 10, color: '#aaa', minWidth: 40 }}>← Left</span>
                <input value={gestureCfg.onSwipeLeftAction  ?? ''} onChange={e => patchGesture({ onSwipeLeftAction:  e.target.value })} placeholder="myActionName" style={{ flex: 1, fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '2px 5px' }} />
                <span style={{ fontSize: 10, color: '#aaa', minWidth: 40 }}>→ Right</span>
                <input value={gestureCfg.onSwipeRightAction ?? ''} onChange={e => patchGesture({ onSwipeRightAction: e.target.value })} placeholder="myActionName" style={{ flex: 1, fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '2px 5px' }} />
              </PRow>
              <PRow>
                <span style={{ fontSize: 10, color: '#aaa', minWidth: 40 }}>↑ Up</span>
                <input value={gestureCfg.onSwipeUpAction    ?? ''} onChange={e => patchGesture({ onSwipeUpAction:    e.target.value })} placeholder="myActionName" style={{ flex: 1, fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '2px 5px' }} />
                <span style={{ fontSize: 10, color: '#aaa', minWidth: 40 }}>↓ Down</span>
                <input value={gestureCfg.onSwipeDownAction  ?? ''} onChange={e => patchGesture({ onSwipeDownAction:  e.target.value })} placeholder="myActionName" style={{ flex: 1, fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '2px 5px' }} />
              </PRow>
            </>
          )}
        </SubSection>

      </CategoryGroup>

      {/* ── Config Popover ────────────────────────────────────────────────── */}
      {popover && (
        <AnimConfigPopover
          y={popover.y}
          title={POPOVER_TITLES[popover.category] ?? popover.category}
          onClose={() => setPopover(null)}
        >
          {/* ── Enter ── */}
          {popover.category === 'enter' && (
            <>
              <FieldWithBinding label="enter-duration" displayLabel="Duration" hint="e.g. 400 (ms) or variables['UUID']" value={animBinding(enter.duration, 400)} onChange={v => bindOrPatchAnim(patchEnter, 'duration', v)}>
                <SliderField label="Duration" value={animNum(enter.duration, 400)} min={50} max={5000} step={50} unit="ms" onChange={v => patchEnter({ duration: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="enter-delay" displayLabel="Delay" hint="e.g. 0 (ms)" value={animBinding(enter.delay, 0)} onChange={v => bindOrPatchAnim(patchEnter, 'delay', v)}>
                <SliderField label="Delay" value={animNum(enter.delay, 0)} min={0} max={3000} step={50} unit="ms" onChange={v => patchEnter({ delay: v })} />
              </FieldWithBinding>
              <SelectInput label="Easing" value={enter.easing ?? 'easeOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchEnter({ easing: v })} />
              {hasMap && (
                <FieldWithBinding label="enter-stagger" displayLabel="Stagger" hint="e.g. 50 ms — adds index*stagger to each item delay" value={animBinding(enter.stagger, 0)} onChange={v => bindOrPatchAnim(patchEnter, 'stagger', v)}>
                  <SliderField label="Stagger" value={animNum(enter.stagger, 0)} min={0} max={500} step={10} unit="ms" onChange={v => patchEnter({ stagger: v })} />
                </FieldWithBinding>
              )}
              <ToggleRow label="Spring physics" active={enter.spring} onChange={() => patchEnter({ spring: !enter.spring })} />
              {enter.spring && (
                <Row>
                  <NumberInput label="Stiffness" value={enter.stiffness ?? 200} min={10} max={1000} onChange={v => patchEnter({ stiffness: v })} />
                  <NumberInput label="Damping"   value={enter.damping   ?? 20}  min={1}  max={100}  onChange={v => patchEnter({ damping: v })} />
                  <NumberInput label="Mass"      value={enter.mass      ?? 1}   min={0.1} max={10} step={0.1} onChange={v => patchEnter({ mass: v })} />
                </Row>
              )}
              <FromOverrideSection
                label="Start values"
                from={enter.from as Record<string, number | undefined> | undefined}
                patch={patchEnterFrom}
              />
            </>
          )}

          {/* ── Exit ── */}
          {popover.category === 'exit' && (
            <>
              <FieldWithBinding label="exit-duration" displayLabel="Duration" hint="e.g. 300 (ms)" value={animBinding(exit.duration, 300)} onChange={v => bindOrPatchAnim(patchExit, 'duration', v)}>
                <SliderField label="Duration" value={animNum(exit.duration, 300)} min={50} max={3000} step={50} unit="ms" onChange={v => patchExit({ duration: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="exit-delay" displayLabel="Delay" hint="e.g. 0 (ms)" value={animBinding(exit.delay, 0)} onChange={v => bindOrPatchAnim(patchExit, 'delay', v)}>
                <SliderField label="Delay" value={animNum(exit.delay, 0)} min={0} max={2000} step={50} unit="ms" onChange={v => patchExit({ delay: v })} />
              </FieldWithBinding>
              <SelectInput label="Easing" value={exit.easing ?? 'easeIn'} options={EASING_OPTS as unknown as string[]} onChange={v => patchExit({ easing: v })} />
              <FromOverrideSection
                label="End values"
                from={exit.to as Record<string, number | undefined> | undefined}
                patch={patchExitTo}
              />
            </>
          )}

          {/* ── Loop ── */}
          {popover.category === 'loop' && (
            <>
              <FieldWithBinding label="loop-duration" displayLabel="Duration" hint="e.g. 1000 (ms)" value={animBinding(loop.duration, 1000)} onChange={v => bindOrPatchAnim(patchLoop, 'duration', v)}>
                <SliderField label="Duration" value={animNum(loop.duration, 1000)} min={100} max={10000} step={100} unit="ms" onChange={v => patchLoop({ duration: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="loop-delay" displayLabel="Delay" hint="Delay before first iteration (ms)" value={animBinding(loop.delay, 0)} onChange={v => bindOrPatchAnim(patchLoop, 'delay', v)}>
                <SliderField label="Delay" value={animNum(loop.delay, 0)} min={0} max={3000} step={50} unit="ms" onChange={v => patchLoop({ delay: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="loop-repeat" displayLabel="Repeat" hint="-1 = infinite" value={animBinding(loop.repeatCount, -1)} onChange={v => bindOrPatchAnim(patchLoop, 'repeatCount', v)}>
                <SliderField label="Repeat (-1 = ∞)" value={animNum(loop.repeatCount, -1)} min={-1} max={20} step={1} onChange={v => patchLoop({ repeatCount: v })} />
              </FieldWithBinding>
              <ChipSelect value={loop.direction ?? 'normal'} options={LOOP_DIRS as unknown as string[]} onChange={v => patchLoop({ direction: v })} />
              {(loop.type === 'glowPulse' || loop.type === 'ripple') && (
                <ColorInput label="Glow color" value={(loop as { color?: string }).color ?? '#6366f1'} onChange={v => patchLoop({ color: v })} />
              )}
            </>
          )}

          {/* ── Press ── */}
          {popover.category === 'press' && (
            <>
              <FieldWithBinding label="press-scale" displayLabel="Scale" hint="e.g. 0.95" value={animBinding(press.scale, 0.95)} onChange={v => bindOrPatchAnim(patchPress, 'scale', v)}>
                <SliderField label="Scale" value={animNum(press.scale, 0.95)} min={0.5} max={1.5} step={0.01} onChange={v => patchPress({ scale: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="press-opacity" displayLabel="Opacity" hint="e.g. 1 (0–1)" value={animBinding(press.opacity, 1)} onChange={v => bindOrPatchAnim(patchPress, 'opacity', v)}>
                <SliderField label="Opacity" value={animNum(press.opacity, 1)} min={0} max={1} step={0.05} onChange={v => patchPress({ opacity: v })} />
              </FieldWithBinding>
              <XYOffsetControl
                x={press.x ?? 0} y={press.y ?? 0}
                onChangeX={v => patchPress({ x: v })}
                onChangeY={v => patchPress({ y: v })}
              />
              <FieldWithBinding label="press-duration" displayLabel="Duration" hint="e.g. 120 (ms)" value={animBinding(press.duration, 120)} onChange={v => bindOrPatchAnim(patchPress, 'duration', v)}>
                <SliderField label="Duration" value={animNum(press.duration, 120)} min={50} max={800} step={10} unit="ms" onChange={v => patchPress({ duration: v })} />
              </FieldWithBinding>
              <SelectInput label="Easing" value={press.easing ?? 'easeOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchPress({ easing: v })} />
              {/* Style targets */}
              <div style={{ marginTop: 6 }}>
                <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600 }}>Style targets</span>
                {Object.entries(press.styles ?? {}).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
                    <input type="text" value={k} readOnly style={{ flex: 1, fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#d1d5db', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    <input type="text" value={String(v)} onChange={e => { const s = { ...(press.styles ?? {}), [k]: e.target.value }; patchPress({ styles: s }); }}
                      style={{ flex: 1, fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    <button onClick={() => { const s = { ...(press.styles ?? {}) }; delete s[k]; patchPress({ styles: Object.keys(s).length ? s : undefined }); }}
                      style={{ fontSize: 10, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>✕</button>
                  </div>
                ))}
                <button onClick={() => {
                  const name = prompt('CSS property name (e.g. backgroundColor, borderRadius, boxShadow)');
                  if (!name) return;
                  patchPress({ styles: { ...(press.styles ?? {}), [name]: '' } });
                }} style={{ fontSize: 10, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', marginTop: 3, padding: 0 }}>+ Add style target</button>
              </div>
            </>
          )}

          {/* ── Hover ── */}
          {popover.category === 'hover' && (
            <>
              <FieldWithBinding label="hover-scale" displayLabel="Scale" hint="e.g. 1.05" value={animBinding(hover.scale, 1.05)} onChange={v => bindOrPatchAnim(patchHover, 'scale', v)}>
                <SliderField label="Scale" value={animNum(hover.scale, 1.05)} min={0.8} max={1.5} step={0.01} onChange={v => patchHover({ scale: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="hover-opacity" displayLabel="Opacity" hint="e.g. 1 (0–1)" value={animBinding(hover.opacity, 1)} onChange={v => bindOrPatchAnim(patchHover, 'opacity', v)}>
                <SliderField label="Opacity" value={animNum(hover.opacity, 1)} min={0} max={1} step={0.05} onChange={v => patchHover({ opacity: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="hover-y" displayLabel="Y Lift" hint="e.g. -4 (px, negative = up)" value={animBinding(hover.y, -4)} onChange={v => bindOrPatchAnim(patchHover, 'y', v)}>
                <SliderField label="Y lift (px)" value={animNum(hover.y, -4)} min={-40} max={40} step={1} unit="px" onChange={v => patchHover({ y: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="hover-duration" displayLabel="Duration" hint="e.g. 200 (ms)" value={animBinding(hover.duration, 200)} onChange={v => bindOrPatchAnim(patchHover, 'duration', v)}>
                <SliderField label="Duration" value={animNum(hover.duration, 200)} min={50} max={800} step={10} unit="ms" onChange={v => patchHover({ duration: v })} />
              </FieldWithBinding>
              <SelectInput label="Easing" value={hover.easing ?? 'easeOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchHover({ easing: v })} />
              {/* Style targets */}
              <div style={{ marginTop: 6 }}>
                <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600 }}>Style targets</span>
                {Object.entries(hover.styles ?? {}).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
                    <input type="text" value={k} readOnly style={{ flex: 1, fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#d1d5db', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    <input type="text" value={String(v)} onChange={e => { const s = { ...(hover.styles ?? {}), [k]: e.target.value }; patchHover({ styles: s }); }}
                      style={{ flex: 1, fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    <button onClick={() => { const s = { ...(hover.styles ?? {}) }; delete s[k]; patchHover({ styles: Object.keys(s).length ? s : undefined }); }}
                      style={{ fontSize: 10, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>✕</button>
                  </div>
                ))}
                <button onClick={() => {
                  const name = prompt('CSS property name (e.g. backgroundColor, borderRadius, boxShadow)');
                  if (!name) return;
                  patchHover({ styles: { ...(hover.styles ?? {}), [name]: '' } });
                }} style={{ fontSize: 10, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', marginTop: 3, padding: 0 }}>+ Add style target</button>
              </div>
            </>
          )}

          {/* ── 3D Tilt ── */}
          {popover.category === 'tilt' && (
            <>
              <ToggleRow label="Reset on mouse leave" active={tiltCfg.reset !== false} onChange={() => patchTilt({ reset: tiltCfg.reset === false })} />
              <FieldWithBinding label="tilt-maxX" displayLabel="Max X" hint="e.g. 15 (degrees)" value={animBinding(tiltCfg.maxX, 15)} onChange={v => bindOrPatchAnim(patchTilt, 'maxX', v)}>
                <SliderField label="Max X (°)" value={animNum(tiltCfg.maxX, 15)} min={1} max={45} step={1} unit="°" onChange={v => patchTilt({ maxX: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="tilt-maxY" displayLabel="Max Y" hint="e.g. 15 (degrees)" value={animBinding(tiltCfg.maxY, 15)} onChange={v => bindOrPatchAnim(patchTilt, 'maxY', v)}>
                <SliderField label="Max Y (°)" value={animNum(tiltCfg.maxY, 15)} min={1} max={45} step={1} unit="°" onChange={v => patchTilt({ maxY: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="tilt-perspective" displayLabel="Perspective" hint="e.g. 800 (px)" value={animBinding(tiltCfg.perspective, 800)} onChange={v => bindOrPatchAnim(patchTilt, 'perspective', v)}>
                <SliderField label="Perspective (px)" value={animNum(tiltCfg.perspective, 800)} min={100} max={3000} step={50} unit="px" onChange={v => patchTilt({ perspective: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="tilt-scale" displayLabel="Scale on hover" hint="e.g. 1.03" value={animBinding(tiltCfg.scale, 1.03)} onChange={v => bindOrPatchAnim(patchTilt, 'scale', v)}>
                <SliderField label="Scale on hover" value={animNum(tiltCfg.scale, 1.03)} min={1} max={1.3} step={0.01} onChange={v => patchTilt({ scale: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="tilt-duration" displayLabel="Duration" hint="e.g. 200 (ms)" value={animBinding(tiltCfg.duration, 200)} onChange={v => bindOrPatchAnim(patchTilt, 'duration', v)}>
                <SliderField label="Duration (ms)" value={animNum(tiltCfg.duration, 200)} min={50} max={800} step={10} unit="ms" onChange={v => patchTilt({ duration: v })} />
              </FieldWithBinding>
            </>
          )}

          {/* ── Mouse Parallax ── */}
          {popover.category === 'mouseParallax' && (
            <>
              <FieldWithBinding label="mousePar-strength" displayLabel="Strength" hint="e.g. 0.05 (0.01–0.5)" value={animBinding(mousePar.strength, 0.05)} onChange={v => bindOrPatchAnim(patchMousePar, 'strength', v)}>
                <SliderField label="Strength (0.01–0.5)" value={animNum(mousePar.strength, 0.05)} min={0.01} max={0.5} step={0.01} onChange={v => patchMousePar({ strength: v })} />
              </FieldWithBinding>
              <SelectInput label="Axis" value={mousePar.axis ?? 'both'} options={AXIS_OPTS as unknown as string[]} onChange={v => patchMousePar({ axis: v })} />
            </>
          )}

          {/* ── Focus Ring ── */}
          {popover.category === 'focus' && (
            <>
              <ColorInput label="Glow color" value={focusCfg.color ?? '#3b82f6'} onChange={v => patchFocus({ color: v })} />
              <Row>
                <SliderField label="Blur (px)"   value={focusCfg.blur   ?? 8} min={0} max={40} step={1} unit="px" onChange={v => patchFocus({ blur: v })} />
                <SliderField label="Spread (px)" value={focusCfg.spread ?? 3} min={0} max={20} step={1} unit="px" onChange={v => patchFocus({ spread: v })} />
              </Row>
              <SliderField label="Duration (ms)" value={focusCfg.duration ?? 200} min={50} max={1000} step={10} unit="ms" onChange={v => patchFocus({ duration: v })} />
            </>
          )}

          {/* ── Scroll Trigger ── */}
          {popover.category === 'scroll' && (
            <>
              <ToggleRow label="Play once" active={scroll.once !== false} onChange={() => patchScroll({ once: !scroll.once })} />
              <FieldWithBinding label="scroll-threshold" displayLabel="Threshold" hint="0–1, fraction of element visible" value={animBinding(scroll.threshold, 0.2)} onChange={v => bindOrPatchAnim(patchScroll, 'threshold', v)}>
                <SliderField label="Threshold (0–1)" value={animNum(scroll.threshold, 0.2)} min={0} max={1} step={0.05} onChange={v => patchScroll({ threshold: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="scroll-duration" displayLabel="Duration" hint="e.g. 500 (ms)" value={animBinding(scroll.duration, 500)} onChange={v => bindOrPatchAnim(patchScroll, 'duration', v)}>
                <SliderField label="Duration" value={animNum(scroll.duration, 500)} min={50} max={3000} step={50} unit="ms" onChange={v => patchScroll({ duration: v })} />
              </FieldWithBinding>
              <FieldWithBinding label="scroll-delay" displayLabel="Delay" hint="e.g. 0 (ms)" value={animBinding(scroll.delay, 0)} onChange={v => bindOrPatchAnim(patchScroll, 'delay', v)}>
                <SliderField label="Delay" value={animNum(scroll.delay, 0)} min={0} max={2000} step={50} unit="ms" onChange={v => patchScroll({ delay: v })} />
              </FieldWithBinding>
              <SelectInput label="Easing" value={scroll.easing ?? 'easeOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchScroll({ easing: v })} />
              <FromOverrideSection
                label="Start values"
                from={scroll.from as Record<string, number | undefined> | undefined}
                patch={patchScrollFrom}
              />
            </>
          )}

          {/* ── Parallax ── */}
          {popover.category === 'parallax' && (
            <>
              <FieldWithBinding label="par-speed" displayLabel="Speed" hint="e.g. 0.4 (−2 to 2)" value={animBinding(par.speed, 0.4)} onChange={v => bindOrPatchAnim(patchPar, 'speed', v)}>
                <SliderField label="Speed (−2 to 2)" value={animNum(par.speed, 0.4)} min={-2} max={2} step={0.05} onChange={v => patchPar({ speed: v })} />
              </FieldWithBinding>
              <SelectInput label="Direction" value={par.direction ?? 'vertical'} options={['vertical', 'horizontal']} onChange={v => patchPar({ direction: v })} />
              <FieldWithBinding label="par-clamp" displayLabel="Clamp" hint="Max pixel offset (px)" value={animBinding(par.clamp, 120)} onChange={v => bindOrPatchAnim(patchPar, 'clamp', v)}>
                <SliderField label="Clamp (px)" value={animNum(par.clamp, 120)} min={0} max={500} step={5} unit="px" onChange={v => patchPar({ clamp: v })} />
              </FieldWithBinding>
            </>
          )}

          {/* ── Scroll Progress ── */}
          {popover.category === 'scrollProgress' && (() => {
            const SCROLL_PROG_PROPS = ['opacity', 'scale', 'translateY', 'translateX', 'rotate', 'blur', 'backgroundOpacity', 'backgroundColor', 'color', 'borderColor', 'borderRadius', 'fontSize', 'borderWidth', 'custom'];
            const currentProp = scrollProg.property ?? 'opacity';
            const isCustomProp = currentProp === 'custom' || !SCROLL_PROG_PROPS.includes(currentProp);
            const COLOR_SCROLL_PROPS = new Set(['backgroundColor', 'color', 'borderColor']);
            const isColorProp = COLOR_SCROLL_PROPS.has(currentProp) ||
              (typeof scrollProg.from === 'string' && (String(scrollProg.from).startsWith('#') || String(scrollProg.from).startsWith('rgb')));
            return <>
              <ToggleRow label="Pin (sticky)" active={scrollProg.pin} onChange={() => patchScrollProg({ pin: !scrollProg.pin })} />
              <ToggleRow label="Use window scroll" active={scrollProg.useWindowScroll ?? false} onChange={() => patchScrollProg({ useWindowScroll: !scrollProg.useWindowScroll })} />
              <SelectInput label="Property" value={isCustomProp ? 'custom' : currentProp}
                options={SCROLL_PROG_PROPS}
                onChange={v => patchScrollProg({ property: v === 'custom' ? '' : v })} />
              {isCustomProp && (
                <div>
                  <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 3 }}>CSS property name</span>
                  <input type="text" value={currentProp === 'custom' ? '' : currentProp} placeholder="e.g. letterSpacing"
                    onChange={e => patchScrollProg({ property: e.target.value || 'custom' })}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                </div>
              )}
              {(currentProp === 'backgroundOpacity') && (
                <div>
                  <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 3 }}>RGB base (e.g. 255,255,255)</span>
                  <input type="text" value={(scrollProg as Record<string, unknown>).rgb as string ?? '255,255,255'} placeholder="255,255,255"
                    onChange={e => patchScrollProg({ rgb: e.target.value || undefined } as Record<string, unknown>)}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                </div>
              )}
              {isColorProp ? (
                <Row>
                  <ColorInput label="From" value={String(scrollProg.from ?? '#000000')} onChange={v => patchScrollProg({ from: v })} />
                  <ColorInput label="To"   value={String(scrollProg.to   ?? '#ffffff')} onChange={v => patchScrollProg({ to: v })} />
                </Row>
              ) : (
                <Row>
                  <NumberInput label="From" value={typeof scrollProg.from === 'number' ? scrollProg.from : Number(scrollProg.from) || 0}   min={-1000} max={1000} step={0.01} onChange={v => patchScrollProg({ from: v })} />
                  <NumberInput label="To"   value={typeof scrollProg.to   === 'number' ? scrollProg.to   : Number(scrollProg.to)   || 1}   min={-1000} max={1000} step={0.01} onChange={v => patchScrollProg({ to: v })} />
                </Row>
              )}
              {!isColorProp && (
                <div>
                  <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 3 }}>Unit (px/deg/%, auto)</span>
                  <input type="text" value={scrollProg.unit ?? ''} placeholder="px"
                    onChange={e => patchScrollProg({ unit: e.target.value || undefined })}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                </div>
              )}
              <Row>
                <NumberInput label="Viewport start (0–1)" value={scrollProg.start ?? 0} min={0} max={1} step={0.05} onChange={v => patchScrollProg({ start: v })} />
                <NumberInput label="Viewport end (0–1)"   value={scrollProg.end   ?? 1} min={0} max={1} step={0.05} onChange={v => patchScrollProg({ end: v })} />
              </Row>
            </>;
          })()}

          {/* ── Color Transition ── */}
          {popover.category === 'colorTransition' && (
            <>
              <ToggleRow label="Loop" active={color.loop} onChange={() => patchColor({ loop: !color.loop })} />
              {(() => {
                const cp = color.property ?? 'backgroundColor';
                const isCustom = cp === 'custom' || !(COLOR_PROPS as readonly string[]).includes(cp);
                return <>
                  <SelectInput label="Property" value={isCustom ? 'custom' : cp} options={COLOR_PROPS as unknown as string[]} onChange={v => patchColor({ property: v === 'custom' ? '' : v })} />
                  {isCustom && (
                    <div>
                      <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 3 }}>CSS property name</span>
                      <input type="text" value={cp === 'custom' ? '' : cp} placeholder="e.g. caretColor"
                        onChange={e => patchColor({ property: e.target.value || 'custom' })}
                        style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    </div>
                  )}
                </>;
              })()}
              <ColorInput label="From" value={color.from ?? '#3b82f6'} onChange={v => patchColor({ from: v })} />
              <ColorInput label="To"   value={color.to   ?? '#ef4444'} onChange={v => patchColor({ to: v })} />
              <Row>
                <SelectInput label="Trigger" value={color.trigger ?? 'enter'} options={COLOR_TRIGS as unknown as string[]} onChange={v => patchColor({ trigger: v })} />
                <NumberInput label="Duration (ms)" value={color.duration ?? 800} min={100} max={5000} step={50} onChange={v => patchColor({ duration: v })} />
              </Row>
              <SelectInput label="Easing" value={color.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchColor({ easing: v })} />
            </>
          )}

          {/* ── Layout Animation ── */}
          {popover.category === 'layout' && (
            <>
              <SelectInput label="Type" value={layout.type ?? 'spring'} options={LAYOUT_TYPES as unknown as string[]} onChange={v => patchLayout({ type: v })} />
              {(layout.type === 'linear' || layout.type === 'fading' || !layout.type) && (
                <SliderField label="Duration (ms)" value={layout.duration ?? 350} min={50} max={3000} step={50} unit="ms" onChange={v => patchLayout({ duration: v })} />
              )}
            </>
          )}

          {/* ── Filter / FX ── */}
          {popover.category === 'filter' && (
            <>
              <ToggleRow label="Loop" active={filt.loop} onChange={() => patchFilter({ loop: !filt.loop })} />
              <Row>
                <SliderField label="Blur (px)"  value={filt.blur       ?? 0} min={0}    max={40}  step={1}    unit="px" onChange={v => patchFilter({ blur: v })} />
                <SliderField label="Brightness" value={filt.brightness ?? 1} min={0}    max={5}   step={0.1}            onChange={v => patchFilter({ brightness: v })} />
              </Row>
              <Row>
                <SliderField label="Contrast"   value={filt.contrast   ?? 1} min={0}    max={5}   step={0.1}            onChange={v => patchFilter({ contrast: v })} />
                <SliderField label="Saturate"   value={filt.saturate   ?? 1} min={0}    max={5}   step={0.1}            onChange={v => patchFilter({ saturate: v })} />
              </Row>
              <Row>
                <SliderField label="Grayscale"  value={filt.grayscale  ?? 0} min={0}    max={1}   step={0.05}           onChange={v => patchFilter({ grayscale: v })} />
                <SliderField label="Hue (°)"    value={filt.hueRotate  ?? 0} min={-360} max={360} step={10}   unit="°"  onChange={v => patchFilter({ hueRotate: v })} />
              </Row>
              <Row>
                <SliderField label="Duration (ms)" value={filt.duration ?? 600} min={50} max={5000} step={50} unit="ms" onChange={v => patchFilter({ duration: v })} />
                <SelectInput label="Easing" value={filt.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchFilter({ easing: v })} />
              </Row>
              <Row>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Drop shadow (CSS)</span>
                  <input type="text" value={filt.dropShadow ?? ''} placeholder="0 0 12px #3b82f6"
                    onChange={e => patchFilter({ dropShadow: e.target.value })}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                </div>
              </Row>
            </>
          )}

          {/* ── Morph Shape ── */}
          {popover.category === 'morph' && (
            <>
              <ToggleRow label="Loop" active={morphCfg.loop} onChange={() => patchMorph({ loop: !morphCfg.loop })} />
              <div>
                <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 3 }}>From (border-radius)</span>
                <input type="text" value={morphCfg.from ?? '50% 50% 50% 50%'} placeholder="50% 50% 50% 50%"
                  onChange={e => patchMorph({ from: e.target.value })}
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
              <div>
                <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 3 }}>To (border-radius)</span>
                <input type="text" value={morphCfg.to ?? '60% 40% 70% 30% / 50% 60% 40% 50%'} placeholder="60% 40% 70% 30% / 50% 60% 40% 50%"
                  onChange={e => patchMorph({ to: e.target.value })}
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
              <Row>
                <SliderField label="Duration (ms)" value={morphCfg.duration ?? 3000} min={200} max={10000} step={100} unit="ms" onChange={v => patchMorph({ duration: v })} />
                <SelectInput label="Easing" value={morphCfg.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchMorph({ easing: v })} />
              </Row>
            </>
          )}

          {/* ── Imperative Trigger ── */}
          {popover.category === 'imperativeTrigger' && (
            <>
              <FieldWithBinding label="impTrig-duration" displayLabel="Duration" hint="e.g. 400 (ms)" value={animBinding(impTrig.duration, 400)} onChange={v => bindOrPatchAnim(patchImpTrig, 'duration', v)}>
                <SliderField label="Duration" value={animNum(impTrig.duration, 400)} min={50} max={3000} step={50} unit="ms" onChange={v => patchImpTrig({ duration: v })} />
              </FieldWithBinding>
              <SelectInput label="Easing" value={impTrig.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchImpTrig({ easing: v })} />
              <FieldWithBinding
                label="impTrig-watchVar"
                displayLabel="Watch Variable"
                hint="Formula expression, e.g. variables['UUID'] or Date.now()"
                value={(typeof impTrig.watchVar === 'string' ? impTrig.watchVar : '') as FormulaValue}
                onChange={v => patchImpTrig({ watchVar: v as string })}
                topAlign
              >
                <div>
                  <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Watch Variable (formula)</span>
                  <input
                    type="text"
                    value={typeof impTrig.watchVar === 'string' ? impTrig.watchVar : ''}
                    placeholder="variables['UUID']"
                    onChange={e => patchImpTrig({ watchVar: e.target.value })}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }}
                  />
                </div>
              </FieldWithBinding>
            </>
          )}

          {/* ── Drag ── */}
          {popover.category === 'drag' && (
            <>
              <ToggleRow label="Snap back"   active={drag.snapBack}   onChange={() => patchDrag({ snapBack:   !drag.snapBack })} />
              <ToggleRow label="Spring back" active={drag.springBack} onChange={() => patchDrag({ springBack: !drag.springBack })} />
              <SelectInput label="Axis" value={drag.axis ?? 'both'} options={AXIS_OPTS as unknown as string[]} onChange={v => patchDrag({ axis: v })} />
              <span style={{ fontSize: 10, color: '#6b7280', display: 'block' }}>Bounds (optional)</span>
              <Row>
                <NumberInput label="Top"    value={drag.bounds?.top    ?? 0} min={-1000} max={0}    onChange={v => patchDrag({ bounds: { ...drag.bounds, top: v } })} />
                <NumberInput label="Bottom" value={drag.bounds?.bottom ?? 0} min={0}     max={1000} onChange={v => patchDrag({ bounds: { ...drag.bounds, bottom: v } })} />
              </Row>
              <Row>
                <NumberInput label="Left"  value={drag.bounds?.left  ?? 0} min={-1000} max={0}    onChange={v => patchDrag({ bounds: { ...drag.bounds, left: v } })} />
                <NumberInput label="Right" value={drag.bounds?.right ?? 0} min={0}     max={1000} onChange={v => patchDrag({ bounds: { ...drag.bounds, right: v } })} />
              </Row>
              <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginTop: 6 }}>Slot size (for list reorder snap-back)</span>
              <Row>
                <NumberInput label="Slot H (px)" value={drag.slotHeight ?? 0} min={0} max={500} onChange={v => patchDrag({ slotHeight: v || undefined })} />
                <NumberInput label="Slot W (px)"  value={drag.slotWidth  ?? 0} min={0} max={500} onChange={v => patchDrag({ slotWidth:  v || undefined })} />
              </Row>
              <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginTop: 6 }}>Attach drag workflows via the Workflows tab (On drag start / update / end).</span>
            </>
          )}

          {/* ── Flip Card ── */}
          {popover.category === 'flip' && (
            <>
              <SliderField label="Duration (ms)" value={flipCfg.duration ?? 400} min={100} max={1500} step={50} unit="ms" onChange={v => patchFlip({ duration: v })} />
              <SliderField label="Perspective (px)" value={flipCfg.perspective ?? 800} min={200} max={3000} step={50} unit="px" onChange={v => patchFlip({ perspective: v })} />
            </>
          )}

          {/* ── Split Text ── */}
          {popover.category === 'splitText' && (
            <>
              <div style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 9, color: '#9ca3af', display: 'block', marginBottom: 2 }}>Split by</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['char', 'word', 'line'] as const).map(s => (
                    <button key={s} onClick={() => patchSplitText({ split: s })}
                      style={{ flex: 1, fontSize: 10, padding: '3px 4px', borderRadius: 3, cursor: 'pointer',
                        background: (splitTextCfg.split ?? 'char') === s ? '#3b82f6' : '#1f2937',
                        color: (splitTextCfg.split ?? 'char') === s ? '#fff' : '#9ca3af',
                        border: '1px solid #374151' }}>{s}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 9, color: '#9ca3af', display: 'block', marginBottom: 2 }}>Animation type</span>
                <ChipSelect
                  value={splitTextCfg.type ?? 'fadeIn'}
                  options={ENTER_TYPES as unknown as string[]}
                  onChange={v => patchSplitText({ type: v })}
                />
              </div>
              <SliderField label="Duration (ms)" value={splitTextCfg.duration ?? 400} min={50} max={2000} step={50} unit="ms" onChange={v => patchSplitText({ duration: v })} />
              <SliderField label="Stagger (ms)" value={splitTextCfg.stagger ?? 30} min={0} max={200} step={5} unit="ms" onChange={v => patchSplitText({ stagger: v })} />
              <SliderField label="Delay (ms)" value={splitTextCfg.delay ?? 0} min={0} max={2000} step={50} unit="ms" onChange={v => patchSplitText({ delay: v })} />
              <SelectInput label="Easing" value={splitTextCfg.easing ?? 'easeOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchSplitText({ easing: v })} />
            </>
          )}

          {/* ── States Machine ── */}
          {popover.category === 'statesMachine' && (
            <>
              <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 8, lineHeight: 1.4 }}>
                watchVar is a formula expression that returns the current state name (e.g. <code style={{ color: '#a5b4fc' }}>variables{`['`}UUID{`']`}</code>).
                Each state is a set of style overrides applied when watchVar equals that state name.
              </span>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 9, color: '#9ca3af', display: 'block', marginBottom: 2 }}>Watch variable (formula)</span>
                <input
                  value={typeof statesCfg.watchVar === 'string' ? statesCfg.watchVar : ''}
                  onChange={e => patchStates({ watchVar: e.target.value })}
                  placeholder="variables['UUID']"
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: 8 }}>
                <input
                  value={statesCfg.defaultState ?? ''}
                  onChange={e => patchStates({ defaultState: e.target.value })}
                  placeholder="default state name"
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', boxSizing: 'border-box' }}
                />
                <span style={{ fontSize: 9, color: '#6b7280' }}>Default state (applies when watchVar is undefined)</span>
              </div>
              <SliderField label="Transition (ms)" value={statesCfg.duration ?? 300} min={50} max={2000} step={50} unit="ms" onChange={v => patchStates({ duration: v })} />
              <SelectInput label="Easing" value={statesCfg.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchStates({ easing: v })} />
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: '#9ca3af' }}>States</span>
                  <button
                    onClick={() => {
                      const name = prompt('State name (e.g. "active", "hover"):');
                      if (!name) return;
                      patchStates({ states: { ...(statesCfg.states ?? {}), [name]: {} } });
                    }}
                    style={{ fontSize: 9, padding: '2px 6px', border: '1px solid #374151', borderRadius: 3, background: '#1f2937', color: '#9ca3af', cursor: 'pointer' }}
                  >+ Add state</button>
                </div>
                {Object.entries(statesCfg.states ?? {}).map(([stateName, props]) => (
                  <div key={stateName} style={{ border: '1px solid #374151', borderRadius: 4, padding: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: '#d1d5db', fontWeight: 600 }}>{stateName}</span>
                      <button
                        onClick={() => {
                          const next = { ...(statesCfg.states ?? {}) };
                          delete next[stateName];
                          patchStates({ states: next });
                        }}
                        style={{ fontSize: 9, padding: '1px 4px', border: '1px solid #374151', borderRadius: 3, background: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                      >✕</button>
                    </div>
                    {Object.entries(props as Record<string, string>).map(([prop, val]) => (
                      <div key={prop} style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                        <input value={prop} readOnly style={{ flex: 1, fontSize: 9, padding: '2px 4px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#9ca3af' }} />
                        <input
                          value={val}
                          onChange={e => {
                            const newProps = { ...(props as Record<string, string>), [prop]: e.target.value };
                            patchStates({ states: { ...(statesCfg.states ?? {}), [stateName]: newProps } });
                          }}
                          style={{ flex: 2, fontSize: 9, padding: '2px 4px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb' }}
                        />
                        <button
                          onClick={() => {
                            const newProps = { ...(props as Record<string, string>) };
                            delete newProps[prop];
                            patchStates({ states: { ...(statesCfg.states ?? {}), [stateName]: newProps } });
                          }}
                          style={{ fontSize: 9, padding: '1px 4px', border: '1px solid #374151', borderRadius: 3, background: 'transparent', color: '#6b7280', cursor: 'pointer' }}
                        >✕</button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const propName = prompt('CSS property (e.g. "backgroundColor", "opacity"):');
                        if (!propName) return;
                        const newProps = { ...(props as Record<string, string>), [propName]: '' };
                        patchStates({ states: { ...(statesCfg.states ?? {}), [stateName]: newProps } });
                      }}
                      style={{ fontSize: 9, padding: '2px 6px', border: '1px solid #374151', borderRadius: 3, background: '#111827', color: '#6b7280', cursor: 'pointer', width: '100%' }}
                    >+ Add property</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Particles ── */}
          {popover.category === 'particles' && (
            <>
              <SliderField label="Count" value={particlesCfg.count ?? 50} min={5} max={300} step={5} unit="" onChange={v => patchParticles({ count: v })} />
              <SliderField label="Speed" value={particlesCfg.speed ?? 1} min={0.1} max={5} step={0.1} unit="" onChange={v => patchParticles({ speed: v })} />
              <SliderField label="Max radius (px)" value={particlesCfg.maxRadius ?? 3} min={1} max={20} step={0.5} unit="px" onChange={v => patchParticles({ maxRadius: v })} />
              <SliderField label="Connect distance" value={particlesCfg.connectDistance ?? 80} min={0} max={300} step={10} unit="px" onChange={v => patchParticles({ connectDistance: v })} />
              <div style={{ display: 'flex', gap: 8 }}>
                <ColorInput label="Particles" value={particlesCfg.color ?? '#ffffff'} onChange={v => patchParticles({ color: v })} />
                <ColorInput label="Background" value={particlesCfg.background ?? 'transparent'} onChange={v => patchParticles({ background: v })} />
              </div>
              <div style={{ marginTop: 6 }}>
                <ToggleRow label="Interactive (mouse repel)" active={!!particlesCfg.interactive} onChange={() => patchParticles({ interactive: !particlesCfg.interactive })} />
              </div>
            </>
          )}

        </AnimConfigPopover>
      )}
    </div>
  );
}
