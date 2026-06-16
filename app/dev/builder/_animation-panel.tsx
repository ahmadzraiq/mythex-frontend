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

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  SECTION_STYLE, SectionHeader,
  NumberInput, SelectInput, ColorInput,
  SliderField, ChipSelect, ToggleRow, AnimPreview,
  ResponsiveDot,
} from './_panel-primitives';
import { FieldWithBinding, type FormulaValue } from './_formula-panel';
import { getCascadedAnimation, deepMergeAnimation } from '@/lib/sdui/responsive-resolver';
import { BREAKPOINT_CASCADE, type BreakpointKey } from '@/lib/sdui/types/node';
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
          borderTop: '1px solid var(--bld-bg-elevated)',
          cursor: 'pointer', padding: '8px 0 6px',
        }}
      >
        <svg
          width="7" height="7" viewBox="0 0 8 8" fill="none"
          style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
        >
          <path d="M2 1.5L5.5 4 2 6.5" stroke={open ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: open ? 'var(--bld-text-3)' : 'var(--bld-text-disabled)', textTransform: 'none',
        }}>
          {label}
        </span>
        {activeCount > 0 && (
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 99,
            background: 'rgba(99,102,241,0.2)', color: 'var(--bld-accent)', fontWeight: 600,
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
          background: open ? 'var(--bld-bg-base)' : 'var(--bld-bg-base)',
          borderRadius: 6, padding: '5px 8px',
          border: `1px solid ${open ? 'var(--bld-bg-elevated)' : 'var(--bld-bg-elevated)'}`,
          marginBottom: open ? 8 : 0,
          cursor: 'pointer',
        }}
        onClick={() => setOpen(o => !o)}
      >
        {isActive && (
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--bld-accent)', flexShrink: 0 }} />
        )}
        <svg
          width="7" height="7" viewBox="0 0 8 8" fill="none"
          style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
        >
          <path d="M2 1.5L5.5 4 2 6.5" stroke={open ? 'var(--bld-text-2)' : 'var(--bld-border-subtle)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 500, color: open ? 'var(--bld-text-2)' : 'var(--bld-text-disabled)' }}>
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
              border: '1px solid var(--bld-border-subtle)', borderRadius: 3,
              cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center',
            }}
          >
            {/* Settings: 3 horizontal sliders icon */}
            <svg width="11" height="9" viewBox="0 0 12 10" fill="none">
              <line x1="1" y1="2" x2="11" y2="2" stroke="var(--bld-text-disabled)" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="8.5" cy="2" r="1.5" fill="var(--bld-bg-base)" stroke="var(--bld-text-disabled)" strokeWidth="1.2" />
              <line x1="1" y1="5" x2="11" y2="5" stroke="var(--bld-text-disabled)" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="3.5" cy="5" r="1.5" fill="var(--bld-bg-base)" stroke="var(--bld-text-disabled)" strokeWidth="1.2" />
              <line x1="1" y1="8" x2="11" y2="8" stroke="var(--bld-text-disabled)" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="7" cy="8" r="1.5" fill="var(--bld-bg-base)" stroke="var(--bld-text-disabled)" strokeWidth="1.2" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <div style={{ paddingLeft: 6, paddingRight: 2, paddingBottom: 4, paddingTop: 2, borderLeft: '2px solid var(--bld-bg-elevated)' }}>
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
      <span style={{ fontSize: 10, color: 'var(--bld-text-3)', minWidth: 72, flexShrink: 0 }}>{label}</span>
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
          border: `1px solid ${value !== undefined ? 'var(--bld-border-subtle)' : 'var(--bld-border-subtle)'}`,
          background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)',
          fontFamily: 'monospace', boxSizing: 'border-box' as const,
        }}
      />
      {unit && <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', flexShrink: 0 }}>{unit}</span>}
      {value !== undefined && (
        <button
          onClick={() => onChange(undefined)}
          title="Clear override"
          style={{ fontSize: 11, lineHeight: 1, padding: '1px 4px', border: '1px solid var(--bld-border-subtle)', borderRadius: 3, background: 'transparent', color: 'var(--bld-text-disabled)', cursor: 'pointer', flexShrink: 0 }}
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
    <div style={{ borderTop: '1px solid var(--bld-bg-elevated)', paddingTop: 10, marginTop: 2 }}>
      <span style={{ fontSize: 9, color: 'var(--bld-accent)', fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'none' as const }}>
        {label}
      </span>
      <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
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
        background: 'var(--bld-bg-base)',
        border: '1px solid var(--bld-bg-elevated)',
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
        borderLeft: '7px solid var(--bld-bg-elevated)',
      }} />
      <div style={{
        position: 'absolute', right: -5, top: 22,
        width: 0, height: 0,
        borderTop: '5px solid transparent', borderBottom: '5px solid transparent',
        borderLeft: '5px solid var(--bld-bg-base)',
      }} />
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px 9px',
        borderBottom: '1px solid var(--bld-bg-elevated)',
        borderRadius: '10px 10px 0 0',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-2)' }}>{title}</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
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
  const abp: string = store.activeBreakpoint ?? 'desktop';

  // Animation may live at node.props.animation (canonical, written by the panel)
  // or node.animation (top-level alias used by the renderer and raw JSON configs).
  const baseCfg: AnimationConfig =
    (node?.props as { animation?: AnimationConfig })?.animation ??
    (node as { animation?: AnimationConfig })?.animation ??
    {};

  // Derived effective config: base merged with cascaded responsive overrides.
  const effectiveCfg: AnimationConfig = useMemo(() => {
    if (abp === 'desktop' || !node.responsive) return baseCfg;
    const cascaded = getCascadedAnimation(node.responsive, abp as BreakpointKey);
    if (!Object.keys(cascaded).length) return baseCfg;
    return deepMergeAnimation(baseCfg as unknown as Record<string, unknown>, cascaded) as unknown as AnimationConfig;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abp, node.responsive, baseCfg]);

  const cfg = effectiveCfg;

  // Which top-level animation keys are overridden at any non-desktop breakpoint?
  const animOverrideBps = useMemo(() => {
    if (!node.responsive) return {} as Record<string, string[]>;
    const result: Record<string, string[]> = {};
    for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) {
      const anim = (node.responsive as Record<string, unknown>)[bp] as { animation?: Record<string, unknown> } | undefined;
      if (!anim?.animation) continue;
      for (const key of Object.keys(anim.animation)) {
        if (!result[key]) result[key] = [];
        result[key].push(bp);
      }
    }
    return result;
  }, [node.responsive]);

  /** Write animation partial: deep-merge into responsive[bp].animation at non-desktop, base at desktop. */
  const writeAnim = useCallback((partial: Partial<AnimationConfig>) => {
    if (abp !== 'desktop') {
      const rbp = abp as 'laptop' | 'tablet' | 'mobile';
      // Write each top-level key of partial into responsive[bp].animation.<key>
      for (const [key, val] of Object.entries(partial)) {
        if (val === undefined) {
          store.removeResponsiveOverride(nodeId, rbp, `animation.${key}`);
        } else {
          store.patchResponsive(nodeId, rbp, `animation.${key}`, val);
        }
      }
    } else {
      const next = { ...baseCfg, ...partial };
      store.patchProp(nodeId, 'props.animation', next);
    }
    commitHistory();
  }, [abp, baseCfg, nodeId, store, commitHistory]);

  const patch = writeAnim;

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

  const gradColors = gradAnim.colors ?? ['var(--bld-accent)', 'var(--bld-badge-boolean)', 'var(--bld-accent)'];
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

  // Breakpoints that have any animation override (for section-level chip)
  const allAnimOverrideBps = useMemo(() => {
    const set = new Set<string>();
    for (const bps of Object.values(animOverrideBps)) {
      for (const bp of bps) set.add(bp);
    }
    return Array.from(set);
  }, [animOverrideBps]);


// ─── Flat animation tab-bar ──────────────────────────────────────────────────

type AnimTab = 'basic' | 'interactive' | 'scroll' | 'fx';

function AnimTabBar({ active, onChange }: { active: AnimTab; onChange: (t: AnimTab) => void }) {
  const tabs: { id: AnimTab; label: string; count?: number }[] = [
    { id: 'basic', label: 'Basic' },
    { id: 'interactive', label: 'Interact' },
    { id: 'scroll', label: 'Scroll' },
    { id: 'fx', label: 'FX' },
  ];
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--bld-bg-elevated)' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            flex: 1, padding: '7px 2px', background: 'none', border: 'none',
            borderBottom: active === t.id ? '2px solid var(--bld-accent)' : '2px solid transparent',
            color: active === t.id ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)',
            fontSize: 11, fontWeight: active === t.id ? 600 : 400, cursor: 'pointer',
            marginBottom: -1, transition: 'color 0.12s',
          }}
        >{t.label}</button>
      ))}
    </div>
  );
}

// ─── Shared toggle knob ───────────────────────────────────────────────────────

function ToggleSwitch({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      style={{
        width: 30, height: 17, borderRadius: 9, border: 'none', cursor: 'pointer', flexShrink: 0,
        background: active ? 'var(--bld-accent)' : 'var(--bld-bg-elevated)',
        position: 'relative', transition: 'background 0.15s', padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: active ? 15 : 2, width: 11, height: 11,
        borderRadius: '50%', background: 'white', transition: 'left 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
      }} />
    </button>
  );
}

// ─── AnimToggleRow — flat row with enable toggle + settings button ────────────

function AnimToggleRow({
  label, description, isActive, onToggle, onConfigure, children,
}: {
  label: string;
  description?: string;
  isActive: boolean;
  onToggle: () => void;
  onConfigure?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ marginBottom: 0 }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 0', borderBottom: isActive && children ? 'none' : '1px solid var(--bld-bg-elevated)',
      }}>
        <div style={{
          width: 5, height: 5, borderRadius: '50%', flexShrink: 0, transition: 'background 0.15s',
          background: isActive ? 'var(--bld-accent)' : 'transparent',
          border: isActive ? 'none' : '1px solid var(--bld-border-subtle)',
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: isActive ? 'var(--bld-text-2)' : 'var(--bld-text-3)', fontWeight: isActive ? 500 : 400 }}>
            {label}
          </span>
          {description && (
            <span style={{ display: 'block', fontSize: 9, color: 'var(--bld-text-disabled)', marginTop: 1, lineHeight: 1.3 }}>
              {description}
            </span>
          )}
        </div>
        {onConfigure && (isActive || hovered) && (
          <button
            onClick={onConfigure}
            title="Configure"
            style={{
              width: 22, height: 22, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <svg width="10" height="8" viewBox="0 0 12 10" fill="none" stroke="var(--bld-text-3)" strokeWidth="1.2" strokeLinecap="round">
              <line x1="1" y1="2" x2="11" y2="2"/><circle cx="8.5" cy="2" r="1.5" fill="var(--bld-bg-base)"/>
              <line x1="1" y1="7" x2="11" y2="7"/><circle cx="3.5" cy="7" r="1.5" fill="var(--bld-bg-base)"/>
            </svg>
          </button>
        )}
        <ToggleSwitch active={isActive} onChange={onToggle} />
      </div>
      {isActive && children && (
        <div style={{ padding: '8px 12px 10px', background: 'var(--bld-bg-elevated)', borderRadius: '0 0 6px 6px', marginBottom: 4, borderBottom: '1px solid var(--bld-bg-elevated)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── AnimTypeSection — select-based type picker for Enter / Exit / Loop ───────

function AnimTypeSection({
  label, value, options, isActive, onConfigure, badge, onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  isActive: boolean;
  onConfigure?: (e: React.MouseEvent) => void;
  badge?: React.ReactNode;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ padding: '8px 0 10px', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
          background: isActive ? 'var(--bld-accent)' : 'transparent',
          border: isActive ? 'none' : '1px solid var(--bld-border-subtle)',
        }} />
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: isActive ? 'var(--bld-text-1)' : 'var(--bld-text-3)' }}>
          {label}
        </span>
        {badge && isActive && <div style={{ flexShrink: 0 }}>{badge}</div>}
        {onConfigure && isActive && (
          <button
            onClick={onConfigure}
            style={{
              padding: '2px 8px', fontSize: 10, background: 'var(--bld-bg-elevated)',
              border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-3)', cursor: 'pointer',
            }}
          >⚙ Timing</button>
        )}
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', fontSize: 11, padding: '6px 8px',
          borderRadius: 6, border: `1px solid ${isActive ? 'var(--bld-border-subtle)' : 'var(--bld-bg-elevated)'}`,
          background: isActive ? 'var(--bld-bg-input)' : 'var(--bld-bg-elevated)',
          color: isActive ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)',
          cursor: 'pointer', outline: 'none', boxSizing: 'border-box' as const,
        }}
      >
        {(options as string[]).map(o => <option key={o} value={o}>{o === 'none' ? '— none —' : o}</option>)}
      </select>
    </div>
  );
}


  const [animTab, setAnimTab] = useState<AnimTab>('basic');

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ ...SECTION_STYLE, paddingBottom: 0 }}>
      {/* Responsive override chip — no title text */}
      {allAnimOverrideBps.length > 0 && (
        <SectionHeader
          title=""
          overriddenBreakpoints={allAnimOverrideBps}
          onRemoveBreakpoint={bp => {
            store.removeResponsiveOverride(nodeId, bp as BreakpointKey, undefined as unknown as string);
            commitHistory();
          }}
          onResetAll={() => {
            for (const bp of BREAKPOINT_CASCADE as BreakpointKey[]) {
              store.removeResponsiveOverride(nodeId, bp, undefined as unknown as string);
            }
            commitHistory();
          }}
        />
      )}

      {/* Flat tab bar */}
      <AnimTabBar active={animTab} onChange={setAnimTab} />

      {/* ── Basic: Enter / Exit / Loop ── */}
      {animTab === 'basic' && (
        <div style={{ paddingBottom: 8 }}>
          <AnimTypeSection
            label="Enter"
            value={enter.type ?? 'none'}
            options={ENTER_TYPES}
            isActive={!!(enter.type && enter.type !== 'none')}
            badge={enter.type && enter.type !== 'none' ? <AnimPreview type={enter.type} category="enter" /> : undefined}
            onConfigure={enter.type && enter.type !== 'none' ? e => togglePopover('enter', e) : undefined}
            onChange={v => {
              patchEnter({ type: v });
              if (v !== 'none') setTimeout(() => postPreview(nodeId), 80);
              else setPopover(null);
            }}
          />
          <AnimTypeSection
            label="Exit"
            value={exit.type ?? 'none'}
            options={EXIT_TYPES}
            isActive={!!(exit.type && exit.type !== 'none')}
            badge={exit.type && exit.type !== 'none' ? <AnimPreview type={exit.type} category="exit" /> : undefined}
            onConfigure={exit.type && exit.type !== 'none' ? e => togglePopover('exit', e) : undefined}
            onChange={v => {
              patchExit({ type: v });
              if (v === 'none') setPopover(null);
            }}
          />
          <AnimTypeSection
            label="Loop"
            value={loop.type ?? 'none'}
            options={LOOP_TYPES}
            isActive={!!(loop.type && loop.type !== 'none')}
            badge={loop.type && loop.type !== 'none' ? <AnimPreview type={loop.type} category="loop" /> : undefined}
            onConfigure={loop.type && loop.type !== 'none' ? e => togglePopover('loop', e) : undefined}
            onChange={v => {
              patchLoop({ type: v });
              if (v === 'none') setPopover(null);
            }}
          />
        </div>
      )}

      {/* ── Interactive ── */}
      {animTab === 'interactive' && (
        <div style={{ paddingBottom: 8 }}>
          <AnimToggleRow
            label="Hover"
            description="Scale or move on hover"
            isActive={hover.scale != null}
            onToggle={() => hover.scale == null ? patchHover({ scale: 1.05, duration: 200, easing: 'easeOut' }) : patch({ hover: undefined })}
            onConfigure={e => togglePopover('hover', e)}
          />
          <AnimToggleRow
            label="Press"
            description="Scale on click / tap"
            isActive={press.scale != null}
            onToggle={() => press.scale == null ? patchPress({ scale: 0.95, duration: 120, easing: 'easeOut' }) : patch({ press: undefined })}
            onConfigure={e => togglePopover('press', e)}
          />
          <AnimToggleRow
            label="3D Tilt"
            description="Perspective tilt on mouse"
            isActive={!!tiltCfg.enabled}
            onToggle={() => patchTilt({ enabled: !tiltCfg.enabled })}
            onConfigure={e => togglePopover('tilt', e)}
          />
          <AnimToggleRow
            label="Mouse Parallax"
            description="Depth effect on mouse move"
            isActive={!!mousePar.enabled}
            onToggle={() => patchMousePar({ enabled: !mousePar.enabled })}
            onConfigure={e => togglePopover('mouseParallax', e)}
          />
          <AnimToggleRow
            label="Focus Ring"
            description="Animated ring on focus"
            isActive={!!focusCfg.enabled}
            onToggle={() => patchFocus({ enabled: !focusCfg.enabled })}
            onConfigure={e => togglePopover('focus', e)}
          />
          <AnimToggleRow
            label="Drag & Drop"
            description="Draggable with snap / spring"
            isActive={!!drag.enabled}
            onToggle={() => patchDrag({ enabled: !drag.enabled })}
            onConfigure={e => togglePopover('drag', e)}
          />
          {/* Flip Card — trigger selector */}
          <div style={{ padding: '8px 0', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: flipCfg.trigger ? 8 : 0 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: flipCfg.trigger ? 'var(--bld-accent)' : 'transparent', border: flipCfg.trigger ? 'none' : '1px solid var(--bld-border-subtle)' }} />
              <span style={{ flex: 1, fontSize: 11, fontWeight: flipCfg.trigger ? 500 : 400, color: flipCfg.trigger ? 'var(--bld-text-2)' : 'var(--bld-text-3)' }}>Flip Card</span>
              {flipCfg.trigger && (
                <button onClick={e => togglePopover('flip', e)} style={{ padding: '2px 6px', fontSize: 10, background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-3)', cursor: 'pointer' }}>⚙ Timing</button>
              )}
            </div>
            {flipCfg.trigger && (
              <div style={{ display: 'flex', gap: 4 }}>
                {(['hover', 'click', 'none'] as const).map(t => (
                  <button key={t} onClick={() => patchFlip({ trigger: t === 'none' ? undefined : t })}
                    style={{ flex: 1, fontSize: 10, padding: '4px 6px', borderRadius: 5, cursor: 'pointer', background: (flipCfg.trigger ?? 'none') === t ? 'var(--bld-accent)' : 'var(--bld-bg-elevated)', color: (flipCfg.trigger ?? 'none') === t ? 'var(--bld-accent-fg)' : 'var(--bld-text-3)', border: '1px solid var(--bld-border-subtle)' }}
                  >{t}</button>
                ))}
              </div>
            )}
            {!flipCfg.trigger && (
              <div style={{ display: 'flex', gap: 4 }}>
                {(['hover', 'click'] as const).map(t => (
                  <button key={t} onClick={() => patchFlip({ trigger: t })}
                    style={{ flex: 1, fontSize: 10, padding: '4px 6px', borderRadius: 5, cursor: 'pointer', background: 'var(--bld-bg-elevated)', color: 'var(--bld-text-3)', border: '1px solid var(--bld-border-subtle)' }}
                  >{t}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Scroll ── */}
      {animTab === 'scroll' && (
        <div style={{ paddingBottom: 8 }}>
          {/* Scroll Trigger — enable toggle + type select */}
          <div style={{ padding: '8px 0', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: scroll.enabled ? 8 : 0 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: scroll.enabled ? 'var(--bld-accent)' : 'transparent', border: scroll.enabled ? 'none' : '1px solid var(--bld-border-subtle)' }} />
              <span style={{ flex: 1, fontSize: 11, fontWeight: scroll.enabled ? 600 : 400, color: scroll.enabled ? 'var(--bld-text-1)' : 'var(--bld-text-3)' }}>Scroll Trigger</span>
              {scroll.enabled && (
                <button onClick={e => togglePopover('scroll', e)} style={{ padding: '2px 6px', fontSize: 10, background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-3)', cursor: 'pointer' }}>⚙ Timing</button>
              )}
              <ToggleSwitch active={!!scroll.enabled} onChange={() => patchScroll({ enabled: !scroll.enabled })} />
            </div>
            {scroll.enabled && (
              <select value={scroll.type ?? 'fadeIn'} onChange={e => patchScroll({ type: e.target.value })}
                style={{ width: '100%', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-input)', color: 'var(--bld-text-1)', cursor: 'pointer', outline: 'none' }}>
                {(ENTER_TYPES as unknown as string[]).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
          <AnimToggleRow label="Parallax" description="Vertical depth while scrolling" isActive={!!par.enabled} onToggle={() => patchPar({ enabled: !par.enabled })} onConfigure={e => togglePopover('parallax', e)} />
          <AnimToggleRow label="Scroll Progress" description="Animate property on scroll position" isActive={!!scrollProg.enabled} onToggle={() => patchScrollProg({ enabled: !scrollProg.enabled })} onConfigure={e => togglePopover('scrollProgress', e)} />
        </div>
      )}

      {/* ── FX ── */}
      {animTab === 'fx' && (
        <div style={{ paddingBottom: 8 }}>
          <AnimToggleRow label="Color Transition" description="Animated color change" isActive={!!color.enabled} onToggle={() => patchColor({ enabled: !color.enabled })} onConfigure={e => togglePopover('colorTransition', e)} />
          <AnimToggleRow label="Layout Animation" description="Smooth position / size changes" isActive={!!layout.enabled} onToggle={() => patchLayout({ enabled: !layout.enabled })} onConfigure={e => togglePopover('layout', e)} />
          <AnimToggleRow label="Filter / Visual FX" description="Blur, brightness, contrast" isActive={!!filt.enabled} onToggle={() => patchFilter({ enabled: !filt.enabled })} onConfigure={e => togglePopover('filter', e)} />
          <AnimToggleRow label="Morph Shape" description="Animate border-radius morphing" isActive={!!morphCfg.enabled} onToggle={() => patchMorph({ enabled: !morphCfg.enabled })} onConfigure={e => togglePopover('morph', e)} />
          <AnimToggleRow
            label="Shimmer"
            description="Skeleton loader shimmer overlay"
            isActive={shimmerCfg.duration != null}
            onToggle={() => shimmerCfg.duration != null ? patchShimmer({ duration: undefined }) : patchShimmer({ duration: 1200, baseColor: 'var(--bld-text-2)', highlightColor: 'var(--bld-text-1)' })}
          >
            {shimmerCfg.duration != null && (
              <div>
                <SliderField label="Duration (ms)" value={shimmerCfg.duration ?? 1200} min={400} max={3000} step={100} unit="ms" onChange={v => patchShimmer({ duration: v })} />
                <div style={{ height: 4 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <ColorInput label="Base" value={shimmerCfg.baseColor ?? 'var(--bld-text-2)'} onChange={v => patchShimmer({ baseColor: v })} />
                  <ColorInput label="Highlight" value={shimmerCfg.highlightColor ?? 'var(--bld-text-1)'} onChange={v => patchShimmer({ highlightColor: v })} />
                </div>
              </div>
            )}
          </AnimToggleRow>
          <AnimToggleRow label="Split Text" description="Per-char / word animation" isActive={splitTextCfg.type != null} onToggle={() => splitTextCfg.type != null ? patchSplitText({ type: undefined }) : patchSplitText({ type: 'fadeIn', split: 'char', duration: 400, stagger: 30, delay: 0, easing: 'easeOut' })} onConfigure={splitTextCfg.type != null ? e => togglePopover('splitText', e) : undefined} />
          <AnimToggleRow label="States Machine" description="CSS state transitions via variable" isActive={!!(statesCfg.watchVar || Object.keys(statesCfg.states ?? {}).length)} onToggle={() => { const a = !!(statesCfg.watchVar || Object.keys(statesCfg.states ?? {}).length); if (a) patchStates({ watchVar: undefined, states: {} }); else patchStates({ watchVar: '', states: {}, duration: 300, easing: 'easeInOut' }); }} onConfigure={e => togglePopover('statesMachine', e)} />
          <AnimToggleRow label="Particles" description="Interactive particle canvas" isActive={!!particlesCfg.count} onToggle={() => particlesCfg.count ? patchParticles({ count: 0 }) : patchParticles({ count: 50, speed: 1, maxRadius: 3, connectDistance: 80, color: '#ffffff', background: 'transparent' })} onConfigure={e => togglePopover('particles', e)} />
          {/* Imperative Trigger */}
          <div style={{ padding: '8px 0', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: (impTrig.type && impTrig.type !== 'none') ? 'var(--bld-accent)' : 'transparent', border: (impTrig.type && impTrig.type !== 'none') ? 'none' : '1px solid var(--bld-border-subtle)' }} />
              <span style={{ flex: 1, fontSize: 11, fontWeight: (impTrig.type && impTrig.type !== 'none') ? 600 : 400, color: (impTrig.type && impTrig.type !== 'none') ? 'var(--bld-text-1)' : 'var(--bld-text-3)' }}>Imperative Trigger</span>
              {(impTrig.type && impTrig.type !== 'none') && (
                <button onClick={e => togglePopover('imperativeTrigger', e)} style={{ padding: '2px 6px', fontSize: 10, background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-3)', cursor: 'pointer' }}>⚙ Settings</button>
              )}
            </div>
            <select value={impTrig.type ?? 'none'} onChange={e => { const v = e.target.value; patchImpTrig({ type: v }); if (v === 'none') setPopover(null); }}
              style={{ width: '100%', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: `1px solid ${(impTrig.type && impTrig.type !== 'none') ? 'var(--bld-border-subtle)' : 'var(--bld-bg-elevated)'}`, background: (impTrig.type && impTrig.type !== 'none') ? 'var(--bld-bg-input)' : 'var(--bld-bg-elevated)', color: (impTrig.type && impTrig.type !== 'none') ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)', cursor: 'pointer', outline: 'none' }}>
              {(LOOP_TYPES as unknown as string[]).map(o => <option key={o} value={o}>{o === 'none' ? '— none —' : o}</option>)}
            </select>
          </div>
        </div>
      )}

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
                <ColorInput label="Glow color" value={(loop as { color?: string }).color ?? 'var(--bld-accent)'} onChange={v => patchLoop({ color: v })} />
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
                <span style={{ fontSize: 10, color: 'var(--bld-text-3)', fontWeight: 600 }}>Style targets</span>
                {Object.entries(press.styles ?? {}).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
                    <input type="text" value={k} readOnly style={{ flex: 1, fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-2)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    <input type="text" value={String(v)} onChange={e => { const s = { ...(press.styles ?? {}), [k]: e.target.value }; patchPress({ styles: s }); }}
                      style={{ flex: 1, fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    <button onClick={() => { const s = { ...(press.styles ?? {}) }; delete s[k]; patchPress({ styles: Object.keys(s).length ? s : undefined }); }}
                      style={{ fontSize: 10, color: 'var(--bld-error)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>✕</button>
                  </div>
                ))}
                <button onClick={() => {
                  const name = prompt('CSS property name (e.g. backgroundColor, borderRadius, boxShadow)');
                  if (!name) return;
                  patchPress({ styles: { ...(press.styles ?? {}), [name]: '' } });
                }} style={{ fontSize: 10, color: 'var(--bld-info)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 3, padding: 0 }}>+ Add style target</button>
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
                <span style={{ fontSize: 10, color: 'var(--bld-text-3)', fontWeight: 600 }}>Style targets</span>
                {Object.entries(hover.styles ?? {}).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
                    <input type="text" value={k} readOnly style={{ flex: 1, fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-2)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    <input type="text" value={String(v)} onChange={e => { const s = { ...(hover.styles ?? {}), [k]: e.target.value }; patchHover({ styles: s }); }}
                      style={{ flex: 1, fontSize: 10, padding: '2px 4px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    <button onClick={() => { const s = { ...(hover.styles ?? {}) }; delete s[k]; patchHover({ styles: Object.keys(s).length ? s : undefined }); }}
                      style={{ fontSize: 10, color: 'var(--bld-error)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>✕</button>
                  </div>
                ))}
                <button onClick={() => {
                  const name = prompt('CSS property name (e.g. backgroundColor, borderRadius, boxShadow)');
                  if (!name) return;
                  patchHover({ styles: { ...(hover.styles ?? {}), [name]: '' } });
                }} style={{ fontSize: 10, color: 'var(--bld-info)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 3, padding: 0 }}>+ Add style target</button>
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
              <ColorInput label="Glow color" value={focusCfg.color ?? 'var(--bld-accent)'} onChange={v => patchFocus({ color: v })} />
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
                  <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 3 }}>CSS property name</span>
                  <input type="text" value={currentProp === 'custom' ? '' : currentProp} placeholder="e.g. letterSpacing"
                    onChange={e => patchScrollProg({ property: e.target.value || 'custom' })}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                </div>
              )}
              {(currentProp === 'backgroundOpacity') && (
                <div>
                  <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 3 }}>RGB base (e.g. 255,255,255)</span>
                  <input type="text" value={(scrollProg as Record<string, unknown>).rgb as string ?? '255,255,255'} placeholder="255,255,255"
                    onChange={e => patchScrollProg({ rgb: e.target.value || undefined } as Record<string, unknown>)}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
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
                  <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 3 }}>Unit (px/deg/%, auto)</span>
                  <input type="text" value={scrollProg.unit ?? ''} placeholder="px"
                    onChange={e => patchScrollProg({ unit: e.target.value || undefined })}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
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
                      <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 3 }}>CSS property name</span>
                      <input type="text" value={cp === 'custom' ? '' : cp} placeholder="e.g. caretColor"
                        onChange={e => patchColor({ property: e.target.value || 'custom' })}
                        style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                    </div>
                  )}
                </>;
              })()}
              <ColorInput label="From" value={color.from ?? 'var(--bld-accent)'} onChange={v => patchColor({ from: v })} />
              <ColorInput label="To"   value={color.to   ?? 'var(--bld-error)'} onChange={v => patchColor({ to: v })} />
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
                  <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 2 }}>Drop shadow (CSS)</span>
                  <input type="text" value={filt.dropShadow ?? ''} placeholder="0 0 12px var(--bld-accent)"
                    onChange={e => patchFilter({ dropShadow: e.target.value })}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                </div>
              </Row>
            </>
          )}

          {/* ── Morph Shape ── */}
          {popover.category === 'morph' && (
            <>
              <ToggleRow label="Loop" active={morphCfg.loop} onChange={() => patchMorph({ loop: !morphCfg.loop })} />
              <div>
                <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 3 }}>From (border-radius)</span>
                <input type="text" value={morphCfg.from ?? '50% 50% 50% 50%'} placeholder="50% 50% 50% 50%"
                  onChange={e => patchMorph({ from: e.target.value })}
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 3 }}>To (border-radius)</span>
                <input type="text" value={morphCfg.to ?? '60% 40% 70% 30% / 50% 60% 40% 50%'} placeholder="60% 40% 70% 30% / 50% 60% 40% 50%"
                  onChange={e => patchMorph({ to: e.target.value })}
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }} />
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
                  <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 2 }}>Watch Variable (formula)</span>
                  <input
                    type="text"
                    value={typeof impTrig.watchVar === 'string' ? impTrig.watchVar : ''}
                    placeholder="variables['UUID']"
                    onChange={e => patchImpTrig({ watchVar: e.target.value })}
                    style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', fontFamily: 'monospace', boxSizing: 'border-box' }}
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
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block' }}>Bounds (optional)</span>
              <Row>
                <NumberInput label="Top"    value={drag.bounds?.top    ?? 0} min={-1000} max={0}    onChange={v => patchDrag({ bounds: { ...drag.bounds, top: v } })} />
                <NumberInput label="Bottom" value={drag.bounds?.bottom ?? 0} min={0}     max={1000} onChange={v => patchDrag({ bounds: { ...drag.bounds, bottom: v } })} />
              </Row>
              <Row>
                <NumberInput label="Left"  value={drag.bounds?.left  ?? 0} min={-1000} max={0}    onChange={v => patchDrag({ bounds: { ...drag.bounds, left: v } })} />
                <NumberInput label="Right" value={drag.bounds?.right ?? 0} min={0}     max={1000} onChange={v => patchDrag({ bounds: { ...drag.bounds, right: v } })} />
              </Row>
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginTop: 6 }}>Slot size (for list reorder snap-back)</span>
              <Row>
                <NumberInput label="Slot H (px)" value={drag.slotHeight ?? 0} min={0} max={500} onChange={v => patchDrag({ slotHeight: v || undefined })} />
                <NumberInput label="Slot W (px)"  value={drag.slotWidth  ?? 0} min={0} max={500} onChange={v => patchDrag({ slotWidth:  v || undefined })} />
              </Row>
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginTop: 6 }}>Attach drag workflows via the Workflows tab (On drag start / update / end).</span>
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
                <span style={{ fontSize: 9, color: 'var(--bld-text-3)', display: 'block', marginBottom: 2 }}>Split by</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['char', 'word', 'line'] as const).map(s => (
                    <button key={s} onClick={() => patchSplitText({ split: s })}
                      style={{ flex: 1, fontSize: 10, padding: '3px 4px', borderRadius: 3, cursor: 'pointer',
                        background: (splitTextCfg.split ?? 'char') === s ? 'var(--bld-accent)' : 'var(--bld-bg-input)',
                        color: (splitTextCfg.split ?? 'char') === s ? 'var(--bld-accent-fg)' : 'var(--bld-text-3)',
                        border: '1px solid var(--bld-border-subtle)' }}>{s}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 9, color: 'var(--bld-text-3)', display: 'block', marginBottom: 2 }}>Animation type</span>
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
              <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 8, lineHeight: 1.4 }}>
                watchVar is a formula expression that returns the current state name (e.g. <code style={{ color: 'var(--bld-accent)' }}>variables{`['`}UUID{`']`}</code>).
                Each state is a set of style overrides applied when watchVar equals that state name.
              </span>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 9, color: 'var(--bld-text-3)', display: 'block', marginBottom: 2 }}>Watch variable (formula)</span>
                <input
                  value={typeof statesCfg.watchVar === 'string' ? statesCfg.watchVar : ''}
                  onChange={e => patchStates({ watchVar: e.target.value })}
                  placeholder="variables['UUID']"
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: 8 }}>
                <input
                  value={statesCfg.defaultState ?? ''}
                  onChange={e => patchStates({ defaultState: e.target.value })}
                  placeholder="default state name"
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)', boxSizing: 'border-box' }}
                />
                <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)' }}>Default state (applies when watchVar is undefined)</span>
              </div>
              <SliderField label="Transition (ms)" value={statesCfg.duration ?? 300} min={50} max={2000} step={50} unit="ms" onChange={v => patchStates({ duration: v })} />
              <SelectInput label="Easing" value={statesCfg.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchStates({ easing: v })} />
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: 'var(--bld-text-3)' }}>States</span>
                  <button
                    onClick={() => {
                      const name = prompt('State name (e.g. "active", "hover"):');
                      if (!name) return;
                      patchStates({ states: { ...(statesCfg.states ?? {}), [name]: {} } });
                    }}
                    style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--bld-border-subtle)', borderRadius: 3, background: 'var(--bld-bg-input)', color: 'var(--bld-text-3)', cursor: 'pointer' }}
                  >+ Add state</button>
                </div>
                {Object.entries(statesCfg.states ?? {}).map(([stateName, props]) => (
                  <div key={stateName} style={{ border: '1px solid var(--bld-border-subtle)', borderRadius: 4, padding: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: 'var(--bld-text-2)', fontWeight: 600 }}>{stateName}</span>
                      <button
                        onClick={() => {
                          const next = { ...(statesCfg.states ?? {}) };
                          delete next[stateName];
                          patchStates({ states: next });
                        }}
                        style={{ fontSize: 9, padding: '1px 4px', border: '1px solid var(--bld-border-subtle)', borderRadius: 3, background: 'transparent', color: 'var(--bld-error)', cursor: 'pointer' }}
                      >✕</button>
                    </div>
                    {Object.entries(props as Record<string, string>).map(([prop, val]) => (
                      <div key={prop} style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                        <input value={prop} readOnly style={{ flex: 1, fontSize: 9, padding: '2px 4px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-3)' }} />
                        <input
                          value={val}
                          onChange={e => {
                            const newProps = { ...(props as Record<string, string>), [prop]: e.target.value };
                            patchStates({ states: { ...(statesCfg.states ?? {}), [stateName]: newProps } });
                          }}
                          style={{ flex: 2, fontSize: 9, padding: '2px 4px', borderRadius: 3, border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-panel)', color: 'var(--bld-text-1)' }}
                        />
                        <button
                          onClick={() => {
                            const newProps = { ...(props as Record<string, string>) };
                            delete newProps[prop];
                            patchStates({ states: { ...(statesCfg.states ?? {}), [stateName]: newProps } });
                          }}
                          style={{ fontSize: 9, padding: '1px 4px', border: '1px solid var(--bld-border-subtle)', borderRadius: 3, background: 'transparent', color: 'var(--bld-text-disabled)', cursor: 'pointer' }}
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
                      style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--bld-border-subtle)', borderRadius: 3, background: 'var(--bld-bg-panel)', color: 'var(--bld-text-disabled)', cursor: 'pointer', width: '100%' }}
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
