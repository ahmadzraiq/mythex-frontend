'use client';

/**
 * _animation-panel.tsx
 *
 * AnimationInDesign — the "Animation" section in the builder's right design panel.
 * Rendered as a collapsible section with 10 sub-sections:
 *   Enter, Exit, Loop, Press, Hover, Scroll Trigger, Parallax, Drag, Color Transition, Layout Animation
 *
 * All changes are stored in node.props.animation via store.patchProp().
 */

import React, { useState, useCallback } from 'react';
import { SECTION_STYLE, SectionHeader, NumberInput, SelectInput, ColorInput, ToggleBtn } from './_panel-primitives';
import type { AnimationConfig, ImperativeTriggerConfig, FilterConfig, TiltConfig, MouseParallaxConfig, FocusConfig, MorphShapeConfig, ScrollProgressConfig, SvgStrokeConfig, TimelineStep, GradientAnimationConfig, ClipPathConfig, MaskConfig, PseudoElementConfig, GestureConfig } from '@/lib/sdui/components/animated-node';

// ─── Token lists ──────────────────────────────────────────────────────────────

const ENTER_TYPES  = [
  'none',
  // Fade
  'fadeIn',
  // Slide
  'slideInUp','slideInDown','slideInLeft','slideInLeftSubtle','slideInRight',
  // Rise / Drop
  'riseFade','dropIn',
  // Zoom / Expand
  'zoomIn','expandIn',
  // Bounce
  'bounceIn',
  // Flip
  'flipInX','flipInY','flipIn3D','tiltIn',
  // Skew
  'skewIn','skewInY',
  // Blur / Glow
  'blurIn','glowIn',
  // Roll
  'rollIn',
] as const;
const EXIT_TYPES   = [
  'none',
  'fadeOut',
  'slideOutUp','slideOutDown','slideOutLeft','slideOutRight',
  'zoomOut','shrinkOut',
  'bounceOut',
  'flipOutX','flipOutY','flipOut3D',
  'blurOut','skewOut',
  'rollOut',
] as const;
const LOOP_TYPES   = [
  'none',
  'pulse','breathe','float',
  'shake','wiggle','wobble','swing',
  'spin','ticker',
  'bounce',
  'heartbeat',
  'flash','ripple',
  'glowPulse','gradientDrift',
] as const;
const EASING_OPTS  = ['easeInOut','easeIn','easeOut','linear','circIn','circOut','circInOut','backIn','backOut','backInOut'] as const;
const AXIS_OPTS    = ['both','x','y'] as const;
const LAYOUT_TYPES = ['spring','linear','sequenced','fading'] as const;
const COLOR_PROPS  = ['backgroundColor','borderColor'] as const;
const COLOR_TRIGS  = ['enter','loop'] as const;
const LOOP_DIRS    = ['normal','alternate'] as const;

// ─── Chevron icon ─────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <span style={{ fontSize: 10, color: '#6b7280', transition: 'transform 0.15s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
  );
}

// ─── Sub-section wrapper ──────────────────────────────────────────────────────

function SubSection({ label, children, defaultOpen = false }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', color: '#9ca3af', fontSize: 11, fontWeight: 500 }}
      >
        <Chevron open={open} />
        {label}
      </button>
      {open && <div style={{ paddingTop: 6 }}>{children}</div>}
    </div>
  );
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>{children}</div>;
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
  const cfg: AnimationConfig = (node?.props as { animation?: AnimationConfig })?.animation ?? {};

  const patch = useCallback((partial: Partial<AnimationConfig>) => {
    const next = { ...cfg, ...partial };
    store.patchProp(nodeId, 'props.animation', next);
    commitHistory();
  }, [cfg, nodeId, store, commitHistory]);

  const patchEnter   = (p: object) => patch({ enter:            { ...cfg.enter,            ...p } });
  const patchExit    = (p: object) => patch({ exit:             { ...cfg.exit,             ...p } });
  const patchLoop    = (p: object) => patch({ loop:             { ...cfg.loop,             ...p } });
  const patchPress   = (p: object) => patch({ press:            { ...cfg.press,            ...p } });
  const patchHover   = (p: object) => patch({ hover:            { ...cfg.hover,            ...p } });
  const patchScroll  = (p: object) => patch({ scroll:           { ...cfg.scroll,           ...p } });
  const patchPar     = (p: object) => patch({ parallax:         { ...cfg.parallax,         ...p } });
  const patchDrag    = (p: object) => patch({ drag:             { ...cfg.drag,             ...p } });
  const patchColor   = (p: object) => patch({ color:            { ...cfg.color,            ...p } });
  const patchLayout  = (p: object) => patch({ layout:           { ...cfg.layout,           ...p } });
  const patchImpTrig   = (p: object) => patch({ imperativeTrigger: { ...cfg.imperativeTrigger, ...p } });
  const patchFilter    = (p: object) => patch({ filter:     { ...cfg.filter,     ...p } });
  const patchTilt      = (p: object) => patch({ tilt:       { ...cfg.tilt,       ...p } });
  const patchMousePar  = (p: object) => patch({ mouseParallax: { ...cfg.mouseParallax, ...p } });
  const patchFocus     = (p: object) => patch({ focus:      { ...cfg.focus,      ...p } });
  const patchMorph     = (p: object) => patch({ morphShape:     { ...cfg.morphShape,     ...p } });
  const patchScrollProg= (p: object) => patch({ scrollProgress: { ...cfg.scrollProgress, ...p } });
  const patchSvgStroke = (p: object) => patch({ svgStroke: { ...cfg.svgStroke, ...p } });
  const patchBezier    = (vals: [number,number,number,number]) => patch({ customBezier: vals });

  const enter   = cfg.enter            ?? {};
  const exit    = cfg.exit             ?? {};
  const loop    = cfg.loop             ?? {};
  const press   = cfg.press            ?? {};
  const hover   = cfg.hover            ?? {};
  const scroll  = cfg.scroll           ?? {};
  const par     = cfg.parallax         ?? {};
  const drag    = cfg.drag             ?? {};
  const color   = cfg.color            ?? {};
  const layout  = cfg.layout           ?? {};
  const impTrig:  Partial<ImperativeTriggerConfig> = cfg.imperativeTrigger ?? {};
  const filt:     Partial<FilterConfig>            = cfg.filter            ?? {};
  const tiltCfg:  Partial<TiltConfig>              = cfg.tilt              ?? {};
  const mousePar: Partial<MouseParallaxConfig>     = cfg.mouseParallax     ?? {};
  const focusCfg: Partial<FocusConfig>             = cfg.focus             ?? {};
  const morphCfg:    Partial<MorphShapeConfig>        = cfg.morphShape        ?? {};
  const scrollProg:  Partial<ScrollProgressConfig>   = cfg.scrollProgress    ?? {};
  const svgStr:      Partial<SvgStrokeConfig>        = cfg.svgStroke         ?? {};
  const bezier = cfg.customBezier ?? [0.4, 0, 0.2, 1] as [number,number,number,number];
  const tl: TimelineStep[] = cfg.timeline ?? [];
  const gradAnim: Partial<GradientAnimationConfig>   = cfg.gradientAnimation  ?? {};
  const clipPathCfg: Partial<ClipPathConfig>         = cfg.clipPath           ?? {};
  const maskCfg2: Partial<MaskConfig>               = cfg.mask               ?? {};
  const pseudoCfg: Partial<PseudoElementConfig>      = cfg.pseudoElement      ?? {};
  const gestureCfg: Partial<GestureConfig>           = cfg.gesture            ?? {};

  const patchGrad     = (p: Partial<GradientAnimationConfig>) => patch({ gradientAnimation:  { ...gradAnim,    ...p } });
  const patchClip     = (p: Partial<ClipPathConfig>)          => patch({ clipPath:           { ...clipPathCfg, ...p } });
  const patchMask2    = (p: Partial<MaskConfig>)              => patch({ mask:               { ...maskCfg2,    ...p } });
  const patchPseudo   = (p: Partial<PseudoElementConfig>)     => patch({ pseudoElement:      { ...pseudoCfg,   ...p } });
  const patchGesture  = (p: Partial<GestureConfig>)           => patch({ gesture:            { ...gestureCfg,  ...p } });

  const gradColors = gradAnim.colors ?? ['#6366f1', '#ec4899', '#6366f1'];

  const hasMap = !!(node?.map);

  return (
    <div style={SECTION_STYLE}>
      <SectionHeader title="Animation" />

      {/* ── Enter ─────────────────────────────────────────────────────────── */}
      <SubSection label="Enter" defaultOpen={!!(enter.type && enter.type !== 'none')}>
        <Row>
          <SelectInput label="Type" value={enter.type ?? 'none'} options={ENTER_TYPES as unknown as string[]} onChange={v => patchEnter({ type: v })} />
        </Row>
        {enter.type && enter.type !== 'none' && (
          <>
            <Row>
              <NumberInput label="Duration (ms)" value={enter.duration ?? 400} min={50} max={5000} step={50} onChange={v => patchEnter({ duration: v })} />
              <NumberInput label="Delay (ms)" value={enter.delay ?? 0} min={0} max={5000} step={50} onChange={v => patchEnter({ delay: v })} />
            </Row>
            <Row>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                <ToggleBtn active={enter.spring} onClick={() => patchEnter({ spring: !enter.spring })}>Spring</ToggleBtn>
              </div>
            </Row>
            {enter.spring ? (
              <Row>
                <NumberInput label="Stiffness" value={enter.stiffness ?? 200} min={10} max={1000} onChange={v => patchEnter({ stiffness: v })} />
                <NumberInput label="Damping"   value={enter.damping   ?? 20}  min={1}  max={100}  onChange={v => patchEnter({ damping: v })} />
                <NumberInput label="Mass"      value={enter.mass      ?? 1}   min={0.1} max={10} step={0.1} onChange={v => patchEnter({ mass: v })} />
              </Row>
            ) : (
              <Row>
                <SelectInput label="Easing" value={enter.easing ?? 'easeOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchEnter({ easing: v })} />
              </Row>
            )}
            {hasMap && (
              <Row>
                <NumberInput label="Stagger (ms)" value={enter.stagger ?? 0} min={0} max={500} step={10} onChange={v => patchEnter({ stagger: v })} />
              </Row>
            )}
          </>
        )}
      </SubSection>

      {/* ── Exit ──────────────────────────────────────────────────────────── */}
      <SubSection label="Exit" defaultOpen={!!(exit.type && exit.type !== 'none')}>
        <Row>
          <SelectInput label="Type" value={exit.type ?? 'none'} options={EXIT_TYPES as unknown as string[]} onChange={v => patchExit({ type: v })} />
        </Row>
        {exit.type && exit.type !== 'none' && (
          <>
            <Row>
              <NumberInput label="Duration (ms)" value={exit.duration ?? 300} min={50} max={3000} step={50} onChange={v => patchExit({ duration: v })} />
              <NumberInput label="Delay (ms)"    value={exit.delay ?? 0}    min={0}  max={3000} step={50} onChange={v => patchExit({ delay: v })} />
            </Row>
            <Row>
              <SelectInput label="Easing" value={exit.easing ?? 'easeIn'} options={EASING_OPTS as unknown as string[]} onChange={v => patchExit({ easing: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Loop ──────────────────────────────────────────────────────────── */}
      <SubSection label="Loop" defaultOpen={!!(loop.type && loop.type !== 'none')}>
        <Row>
          <SelectInput label="Type" value={loop.type ?? 'none'} options={LOOP_TYPES as unknown as string[]} onChange={v => patchLoop({ type: v })} />
        </Row>
        {loop.type && loop.type !== 'none' && (
          <>
            <Row>
              <NumberInput label="Duration (ms)" value={loop.duration ?? 1000} min={100} max={10000} step={100} onChange={v => patchLoop({ duration: v })} />
              <NumberInput label="Delay (ms)"    value={loop.delay ?? 0}       min={0}   max={5000}  step={50}  onChange={v => patchLoop({ delay: v })} />
            </Row>
            <Row>
              <NumberInput label="Repeat (-1=∞)" value={loop.repeatCount ?? -1} min={-1} max={100} onChange={v => patchLoop({ repeatCount: v })} />
              <SelectInput label="Direction" value={loop.direction ?? 'normal'} options={LOOP_DIRS as unknown as string[]} onChange={v => patchLoop({ direction: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Press ─────────────────────────────────────────────────────────── */}
      <SubSection label="Press" defaultOpen={press.scale != null}>
        <Row>
          <NumberInput label="Scale"   value={press.scale   ?? 0.95} min={0} max={2}   step={0.01} onChange={v => patchPress({ scale: v })} />
          <NumberInput label="Opacity" value={press.opacity ?? 1}    min={0} max={1}   step={0.05} onChange={v => patchPress({ opacity: v })} />
        </Row>
        <Row>
          <NumberInput label="X offset" value={press.x ?? 0} min={-100} max={100} onChange={v => patchPress({ x: v })} />
          <NumberInput label="Y offset" value={press.y ?? 0} min={-100} max={100} onChange={v => patchPress({ y: v })} />
        </Row>
        <Row>
          <NumberInput label="Duration (ms)" value={press.duration ?? 120} min={50} max={1000} step={10} onChange={v => patchPress({ duration: v })} />
          <SelectInput label="Easing" value={press.easing ?? 'easeOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchPress({ easing: v })} />
        </Row>
      </SubSection>

      {/* ── Hover ─────────────────────────────────────────────────────────── */}
      <SubSection label="Hover" defaultOpen={hover.scale != null}>
        <Row>
          <NumberInput label="Scale"   value={hover.scale   ?? 1.05} min={0}    max={3}   step={0.01} onChange={v => patchHover({ scale: v })} />
          <NumberInput label="Opacity" value={hover.opacity ?? 1}    min={0}    max={1}   step={0.05} onChange={v => patchHover({ opacity: v })} />
        </Row>
        <Row>
          <NumberInput label="Y lift (px)" value={hover.y ?? -4} min={-100} max={100} onChange={v => patchHover({ y: v })} />
          <NumberInput label="Duration (ms)" value={hover.duration ?? 200} min={50} max={1000} step={10} onChange={v => patchHover({ duration: v })} />
        </Row>
        <Row>
          <SelectInput label="Easing" value={hover.easing ?? 'easeOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchHover({ easing: v })} />
        </Row>
      </SubSection>

      {/* ── Scroll Trigger ────────────────────────────────────────────────── */}
      <SubSection label="Scroll Trigger" defaultOpen={!!scroll.enabled}>
        <Row>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ToggleBtn active={scroll.enabled} onClick={() => patchScroll({ enabled: !scroll.enabled })}>Enable</ToggleBtn>
            <ToggleBtn active={scroll.once !== false} onClick={() => patchScroll({ once: !scroll.once })}>Once</ToggleBtn>
          </div>
        </Row>
        {scroll.enabled && (
          <>
            <Row>
              <SelectInput label="Animation" value={scroll.type ?? 'fadeIn'} options={ENTER_TYPES as unknown as string[]} onChange={v => patchScroll({ type: v })} />
            </Row>
            <Row>
              <NumberInput label="Threshold (0-1)" value={scroll.threshold ?? 0.2} min={0} max={1} step={0.05} onChange={v => patchScroll({ threshold: v })} />
            </Row>
            <Row>
              <NumberInput label="Duration (ms)" value={scroll.duration ?? 500} min={50} max={3000} step={50} onChange={v => patchScroll({ duration: v })} />
              <NumberInput label="Delay (ms)"    value={scroll.delay ?? 0}      min={0}  max={3000} step={50} onChange={v => patchScroll({ delay: v })} />
            </Row>
            <Row>
              <SelectInput label="Easing" value={scroll.easing ?? 'easeOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchScroll({ easing: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Parallax ──────────────────────────────────────────────────────── */}
      <SubSection label="Parallax" defaultOpen={!!par.enabled}>
        <Row>
          <ToggleBtn active={par.enabled} onClick={() => patchPar({ enabled: !par.enabled })}>Enable</ToggleBtn>
        </Row>
        {par.enabled && (
          <>
            <Row>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Speed (−2 to 2)</span>
                <input
                  type="range" min={-2} max={2} step={0.05} value={par.speed ?? 0.4}
                  onChange={e => patchPar({ speed: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: '#3b82f6' }}
                />
                <span style={{ fontSize: 9, color: '#9ca3af', display: 'block', textAlign: 'center' }}>{(par.speed ?? 0.4).toFixed(2)}</span>
              </div>
            </Row>
            <Row>
              <SelectInput label="Direction" value={par.direction ?? 'vertical'} options={['vertical','horizontal']} onChange={v => patchPar({ direction: v })} />
              <NumberInput label="Clamp (px)" value={par.clamp ?? 120} min={0} max={500} onChange={v => patchPar({ clamp: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Drag ──────────────────────────────────────────────────────────── */}
      <SubSection label="Drag" defaultOpen={!!drag.enabled}>
        <Row>
          <ToggleBtn active={drag.enabled} onClick={() => patchDrag({ enabled: !drag.enabled })}>Enable</ToggleBtn>
          {drag.enabled && (
            <>
              <ToggleBtn active={drag.snapBack} onClick={() => patchDrag({ snapBack: !drag.snapBack })}>Snap back</ToggleBtn>
              <ToggleBtn active={drag.springBack} onClick={() => patchDrag({ springBack: !drag.springBack })}>Spring</ToggleBtn>
            </>
          )}
        </Row>
        {drag.enabled && (
          <>
            <Row>
              <SelectInput label="Axis" value={drag.axis ?? 'both'} options={AXIS_OPTS as unknown as string[]} onChange={v => patchDrag({ axis: v })} />
            </Row>
            <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 4 }}>Bounds (optional)</span>
            <Row>
              <NumberInput label="Top"    value={drag.bounds?.top    ?? 0} min={-1000} max={0}    onChange={v => patchDrag({ bounds: { ...drag.bounds, top: v } })} />
              <NumberInput label="Bottom" value={drag.bounds?.bottom ?? 0} min={0}     max={1000} onChange={v => patchDrag({ bounds: { ...drag.bounds, bottom: v } })} />
            </Row>
            <Row>
              <NumberInput label="Left"  value={drag.bounds?.left  ?? 0} min={-1000} max={0}    onChange={v => patchDrag({ bounds: { ...drag.bounds, left: v } })} />
              <NumberInput label="Right" value={drag.bounds?.right ?? 0} min={0}     max={1000} onChange={v => patchDrag({ bounds: { ...drag.bounds, right: v } })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Color Transition ──────────────────────────────────────────────── */}
      <SubSection label="Color Transition" defaultOpen={!!color.enabled}>
        <Row>
          <ToggleBtn active={color.enabled} onClick={() => patchColor({ enabled: !color.enabled })}>Enable</ToggleBtn>
          {color.enabled && (
            <ToggleBtn active={color.loop} onClick={() => patchColor({ loop: !color.loop })}>Loop</ToggleBtn>
          )}
        </Row>
        {color.enabled && (
          <>
            <Row>
              <SelectInput label="Property" value={color.property ?? 'backgroundColor'} options={COLOR_PROPS as unknown as string[]} onChange={v => patchColor({ property: v })} />
            </Row>
            <Row>
              <ColorInput label="From" value={color.from ?? '#3b82f6'} onChange={v => patchColor({ from: v })} />
            </Row>
            <Row>
              <ColorInput label="To"   value={color.to   ?? '#ef4444'} onChange={v => patchColor({ to: v })} />
            </Row>
            <Row>
              <SelectInput label="Trigger" value={color.trigger ?? 'enter'} options={COLOR_TRIGS as unknown as string[]} onChange={v => patchColor({ trigger: v })} />
              <NumberInput label="Duration (ms)" value={color.duration ?? 800} min={100} max={5000} step={50} onChange={v => patchColor({ duration: v })} />
            </Row>
            <Row>
              <SelectInput label="Easing" value={color.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchColor({ easing: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Layout Animation ──────────────────────────────────────────────── */}
      <SubSection label="Layout Animation" defaultOpen={!!layout.enabled}>
        <Row>
          <ToggleBtn active={layout.enabled} onClick={() => patchLayout({ enabled: !layout.enabled })}>Enable</ToggleBtn>
        </Row>
        {layout.enabled && (
          <>
            <Row>
              <SelectInput label="Type" value={layout.type ?? 'spring'} options={LAYOUT_TYPES as unknown as string[]} onChange={v => patchLayout({ type: v })} />
            </Row>
            {(layout.type === 'linear' || layout.type === 'fading' || !layout.type) && (
              <Row>
                <NumberInput label="Duration (ms)" value={layout.duration ?? 350} min={50} max={3000} step={50} onChange={v => patchLayout({ duration: v })} />
              </Row>
            )}
          </>
        )}
      </SubSection>

      {/* ── Filter ───────────────────────────────────────────────────────── */}
      <SubSection label="Filter / Visual Effects" defaultOpen={!!filt.enabled}>
        <Row>
          <ToggleBtn active={filt.enabled} onClick={() => patchFilter({ enabled: !filt.enabled })}>Enable</ToggleBtn>
          {filt.enabled && (
            <ToggleBtn active={filt.loop} onClick={() => patchFilter({ loop: !filt.loop })}>Loop</ToggleBtn>
          )}
        </Row>
        {filt.enabled && (
          <>
            <Row>
              <NumberInput label="Blur (px)"    value={filt.blur       ?? 0}    min={0}   max={40}  step={1}   onChange={v => patchFilter({ blur: v })} />
              <NumberInput label="Brightness"   value={filt.brightness ?? 1}    min={0}   max={5}   step={0.1} onChange={v => patchFilter({ brightness: v })} />
            </Row>
            <Row>
              <NumberInput label="Contrast"     value={filt.contrast   ?? 1}    min={0}   max={5}   step={0.1} onChange={v => patchFilter({ contrast: v })} />
              <NumberInput label="Saturate"     value={filt.saturate   ?? 1}    min={0}   max={5}   step={0.1} onChange={v => patchFilter({ saturate: v })} />
            </Row>
            <Row>
              <NumberInput label="Grayscale (0–1)" value={filt.grayscale ?? 0}  min={0}   max={1}   step={0.05} onChange={v => patchFilter({ grayscale: v })} />
              <NumberInput label="Hue rotate (°)"  value={filt.hueRotate ?? 0}  min={-360} max={360} step={10} onChange={v => patchFilter({ hueRotate: v })} />
            </Row>
            <Row>
              <NumberInput label="Duration (ms)" value={filt.duration ?? 600} min={50} max={5000} step={50} onChange={v => patchFilter({ duration: v })} />
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
      </SubSection>

      {/* ── Tilt / 3D hover ──────────────────────────────────────────────── */}
      <SubSection label="3D Tilt (Mouse)" defaultOpen={!!tiltCfg.enabled}>
        <Row>
          <ToggleBtn active={tiltCfg.enabled} onClick={() => patchTilt({ enabled: !tiltCfg.enabled })}>Enable</ToggleBtn>
          {tiltCfg.enabled && (
            <ToggleBtn active={tiltCfg.reset !== false} onClick={() => patchTilt({ reset: tiltCfg.reset === false })}>Reset on leave</ToggleBtn>
          )}
        </Row>
        {tiltCfg.enabled && (
          <>
            <Row>
              <NumberInput label="Max X (°)" value={tiltCfg.maxX ?? 15} min={1} max={45} onChange={v => patchTilt({ maxX: v })} />
              <NumberInput label="Max Y (°)" value={tiltCfg.maxY ?? 15} min={1} max={45} onChange={v => patchTilt({ maxY: v })} />
            </Row>
            <Row>
              <NumberInput label="Perspective (px)" value={tiltCfg.perspective ?? 800} min={100} max={5000} step={50} onChange={v => patchTilt({ perspective: v })} />
              <NumberInput label="Scale on hover"   value={tiltCfg.scale ?? 1.03} min={1} max={1.5} step={0.01} onChange={v => patchTilt({ scale: v })} />
            </Row>
            <Row>
              <NumberInput label="Duration (ms)" value={tiltCfg.duration ?? 200} min={50} max={1000} step={10} onChange={v => patchTilt({ duration: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Mouse Parallax ────────────────────────────────────────────────── */}
      <SubSection label="Mouse Parallax" defaultOpen={!!mousePar.enabled}>
        <Row>
          <ToggleBtn active={mousePar.enabled} onClick={() => patchMousePar({ enabled: !mousePar.enabled })}>Enable</ToggleBtn>
        </Row>
        {mousePar.enabled && (
          <>
            <Row>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Strength (0.01–0.5)</span>
                <input type="range" min={0.01} max={0.5} step={0.01} value={mousePar.strength ?? 0.05}
                  onChange={e => patchMousePar({ strength: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: '#3b82f6' }} />
                <span style={{ fontSize: 9, color: '#9ca3af', display: 'block', textAlign: 'center' }}>{(mousePar.strength ?? 0.05).toFixed(2)}</span>
              </div>
            </Row>
            <Row>
              <SelectInput label="Axis" value={mousePar.axis ?? 'both'} options={AXIS_OPTS as unknown as string[]} onChange={v => patchMousePar({ axis: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Focus Ring ────────────────────────────────────────────────────── */}
      <SubSection label="Focus Ring" defaultOpen={!!focusCfg.enabled}>
        <Row>
          <ToggleBtn active={focusCfg.enabled} onClick={() => patchFocus({ enabled: !focusCfg.enabled })}>Enable</ToggleBtn>
        </Row>
        {focusCfg.enabled && (
          <>
            <Row>
              <ColorInput label="Glow color" value={focusCfg.color ?? '#3b82f6'} onChange={v => patchFocus({ color: v })} />
            </Row>
            <Row>
              <NumberInput label="Blur (px)"   value={focusCfg.blur   ?? 8}  min={0} max={40} onChange={v => patchFocus({ blur: v })} />
              <NumberInput label="Spread (px)" value={focusCfg.spread ?? 3}  min={0} max={20} onChange={v => patchFocus({ spread: v })} />
            </Row>
            <Row>
              <NumberInput label="Duration (ms)" value={focusCfg.duration ?? 200} min={50} max={1000} step={10} onChange={v => patchFocus({ duration: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Morph Shape (border-radius) ───────────────────────────────────── */}
      <SubSection label="Morph Shape" defaultOpen={!!morphCfg.enabled}>
        <Row>
          <ToggleBtn active={morphCfg.enabled} onClick={() => patchMorph({ enabled: !morphCfg.enabled })}>Enable</ToggleBtn>
          {morphCfg.enabled && (
            <ToggleBtn active={morphCfg.loop} onClick={() => patchMorph({ loop: !morphCfg.loop })}>Loop</ToggleBtn>
          )}
        </Row>
        {morphCfg.enabled && (
          <>
            <Row>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>From (border-radius)</span>
                <input type="text" value={morphCfg.from ?? '50% 50% 50% 50%'} placeholder="50% 50% 50% 50%"
                  onChange={e => patchMorph({ from: e.target.value })}
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
            </Row>
            <Row>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>To (border-radius)</span>
                <input type="text" value={morphCfg.to ?? '60% 40% 70% 30% / 50% 60% 40% 50%'} placeholder="60% 40% 70% 30% / 50% 60% 40% 50%"
                  onChange={e => patchMorph({ to: e.target.value })}
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
            </Row>
            <Row>
              <NumberInput label="Duration (ms)" value={morphCfg.duration ?? 3000} min={200} max={10000} step={100} onChange={v => patchMorph({ duration: v })} />
              <SelectInput label="Easing" value={morphCfg.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchMorph({ easing: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Scroll Progress ──────────────────────────────────────────────── */}
      <SubSection label="Scroll Progress" defaultOpen={!!scrollProg.enabled}>
        <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
          Interpolates a CSS property from start to end value as the element scrolls through the viewport.
        </span>
        <Row>
          <ToggleBtn active={scrollProg.enabled} onClick={() => patchScrollProg({ enabled: !scrollProg.enabled })}>Enable</ToggleBtn>
          {scrollProg.enabled && (
            <ToggleBtn active={scrollProg.pin} onClick={() => patchScrollProg({ pin: !scrollProg.pin })}>Pin (sticky)</ToggleBtn>
          )}
        </Row>
        {scrollProg.enabled && (
          <>
            <Row>
              <SelectInput label="Property" value={scrollProg.property ?? 'opacity'}
                options={['opacity','scale','translateY','translateX','rotate','blur']}
                onChange={v => patchScrollProg({ property: v })} />
            </Row>
            <Row>
              <NumberInput label="From" value={scrollProg.from ?? 0} min={-1000} max={1000} step={0.01} onChange={v => patchScrollProg({ from: v })} />
              <NumberInput label="To"   value={scrollProg.to   ?? 1} min={-1000} max={1000} step={0.01} onChange={v => patchScrollProg({ to: v })} />
            </Row>
            <Row>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Unit (px/deg/%, default auto)</span>
                <input type="text" value={scrollProg.unit ?? ''} placeholder="px"
                  onChange={e => patchScrollProg({ unit: e.target.value || undefined })}
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
            </Row>
            <Row>
              <NumberInput label="Viewport start (0–1)" value={scrollProg.start ?? 0} min={0} max={1} step={0.05} onChange={v => patchScrollProg({ start: v })} />
              <NumberInput label="Viewport end (0–1)"   value={scrollProg.end   ?? 1} min={0} max={1} step={0.05} onChange={v => patchScrollProg({ end: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Imperative Trigger ───────────────────────────────────────────── */}
      <SubSection label="Imperative Trigger" defaultOpen={!!(impTrig.type && impTrig.type !== 'none')}>
        <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 6, lineHeight: 1.4 }}>
          Plays a one-shot animation whenever a variable changes. Set Watch Variable to the formula
          path of the variable to watch (e.g. <code>variables[&apos;UUID&apos;]</code>).
        </span>
        <Row>
          <SelectInput label="Animation" value={impTrig.type ?? 'none'} options={LOOP_TYPES as unknown as string[]} onChange={v => patchImpTrig({ type: v })} />
        </Row>
        {impTrig.type && impTrig.type !== 'none' && (
          <>
            <Row>
              <NumberInput label="Duration (ms)" value={impTrig.duration ?? 400} min={50} max={3000} step={50} onChange={v => patchImpTrig({ duration: v })} />
              <SelectInput label="Easing" value={impTrig.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchImpTrig({ easing: v })} />
            </Row>
            <Row>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>Watch Variable (formula)</span>
                <input
                  type="text"
                  value={typeof impTrig.watchVar === 'string' ? impTrig.watchVar : ''}
                  placeholder="variables['UUID']"
                  onChange={e => patchImpTrig({ watchVar: e.target.value })}
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
              </div>
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Custom Bezier ────────────────────────────────────────────────── */}
      <SubSection label="Custom Bezier Easing" defaultOpen={!!cfg.customBezier}>
        <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 4 }}>
          Override per-animation easing with a custom cubic-bezier(x1, y1, x2, y2).
        </span>
        <Row>
          <NumberInput label="x1" value={bezier[0]} min={0} max={1} step={0.01} onChange={v => patchBezier([v, bezier[1], bezier[2], bezier[3]])} />
          <NumberInput label="y1" value={bezier[1]} min={-2} max={2} step={0.01} onChange={v => patchBezier([bezier[0], v, bezier[2], bezier[3]])} />
          <NumberInput label="x2" value={bezier[2]} min={0} max={1} step={0.01} onChange={v => patchBezier([bezier[0], bezier[1], v, bezier[3]])} />
          <NumberInput label="y2" value={bezier[3]} min={-2} max={2} step={0.01} onChange={v => patchBezier([bezier[0], bezier[1], bezier[2], v])} />
        </Row>
        <Row>
          <span style={{ fontSize: 9, color: '#9ca3af' }}>
            Preview: cubic-bezier({bezier.join(', ')})
          </span>
          <button
            onClick={() => patch({ customBezier: undefined })}
            style={{ fontSize: 9, padding: '2px 6px', border: '1px solid #374151', borderRadius: 3, background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}
          >
            Clear
          </button>
        </Row>
      </SubSection>

      {/* ── Declarative Timeline ─────────────────────────────────────────── */}
      <SubSection label="Declarative Timeline" defaultOpen={tl.length > 0}>
        <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 4 }}>
          Each step animates a CSS property from → to over a time window (ms).
        </span>
        {tl.map((step, i) => (
          <div key={i} style={{ border: '1px solid #374151', borderRadius: 4, padding: 6, marginBottom: 6 }}>
            <Row>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>CSS property</span>
                <input
                  type="text"
                  value={step.property}
                  onChange={e => {
                    const next = [...tl]; next[i] = { ...next[i], property: e.target.value }; patch({ timeline: next });
                  }}
                  style={{ width: '100%', fontSize: 10, padding: '3px 5px', borderRadius: 3, border: '1px solid #374151', background: '#111827', color: '#f9fafb', boxSizing: 'border-box' }}
                />
              </div>
              <button
                onClick={() => { const next = tl.filter((_, j) => j !== i); patch({ timeline: next }); }}
                style={{ alignSelf: 'flex-end', padding: '3px 6px', fontSize: 10, border: '1px solid #374151', borderRadius: 3, background: '#1f2937', color: '#ef4444', cursor: 'pointer' }}
              >✕</button>
            </Row>
            <Row>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>From</span>
                <input type="text" value={String(step.from)} onChange={e => { const n=[...tl]; n[i]={...n[i],from:e.target.value}; patch({timeline:n}); }}
                  style={{ width:'100%', fontSize:10, padding:'3px 5px', borderRadius:3, border:'1px solid #374151', background:'#111827', color:'#f9fafb', boxSizing:'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 9, color: '#6b7280', display: 'block', marginBottom: 2 }}>To</span>
                <input type="text" value={String(step.to)} onChange={e => { const n=[...tl]; n[i]={...n[i],to:e.target.value}; patch({timeline:n}); }}
                  style={{ width:'100%', fontSize:10, padding:'3px 5px', borderRadius:3, border:'1px solid #374151', background:'#111827', color:'#f9fafb', boxSizing:'border-box' }} />
              </div>
            </Row>
            <Row>
              <NumberInput label="Start ms" value={step.startMs ?? 0}    min={0} max={10000} step={50} onChange={v => { const n=[...tl]; n[i]={...n[i],startMs:v}; patch({timeline:n}); }} />
              <NumberInput label="End ms"   value={step.endMs   ?? 1000} min={0} max={10000} step={50} onChange={v => { const n=[...tl]; n[i]={...n[i],endMs:v};   patch({timeline:n}); }} />
            </Row>
          </div>
        ))}
        <button
          onClick={() => patch({ timeline: [...tl, { property: 'opacity', from: '0', to: '1', startMs: 0, endMs: 800 }] })}
          style={{ width: '100%', padding: '4px 0', fontSize: 10, background: '#1e3a5f', border: '1px solid #1d4ed8', borderRadius: 3, color: '#93c5fd', cursor: 'pointer' }}
        >
          + Add step
        </button>
      </SubSection>

      {/* ── SVG Stroke Draw ──────────────────────────────────────────────── */}
      <SubSection label="SVG Stroke Draw" defaultOpen={!!svgStr.enabled}>
        <Row>
          <ToggleBtn active={!!svgStr.enabled} onClick={() => patchSvgStroke({ enabled: !svgStr.enabled })}>Enable</ToggleBtn>
        </Row>
        {svgStr.enabled && (
          <>
            <Row>
              <NumberInput label="Duration (ms)" value={svgStr.duration ?? 1500} min={100} max={5000} step={100} onChange={v => patchSvgStroke({ duration: v })} />
              <NumberInput label="Delay (ms)"    value={svgStr.delay    ?? 0}    min={0}   max={3000} step={50}  onChange={v => patchSvgStroke({ delay: v })} />
            </Row>
            <Row>
              <SelectInput label="Easing" value={svgStr.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchSvgStroke({ easing: v })} />
              <NumberInput label="Stroke length (0=auto)" value={svgStr.length ?? 0} min={0} max={10000} step={10} onChange={v => patchSvgStroke({ length: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Gradient Animation ─────────────────────────────────────────────── */}
      <SubSection label="Gradient Animation" defaultOpen={!!gradAnim.enabled}>
        <Row>
          <ToggleBtn active={!!gradAnim.enabled} onClick={() => patchGrad({ enabled: !gradAnim.enabled })}>Enable</ToggleBtn>
        </Row>
        {gradAnim.enabled && (
          <>
            <Row>
              <SelectInput label="Type" value={gradAnim.type ?? 'linear'} options={['linear','radial','conic']} onChange={v => patchGrad({ type: v as GradientAnimationConfig['type'] })} />
              <NumberInput label="Angle (deg)" value={gradAnim.angle ?? 135} min={0} max={360} step={5} onChange={v => patchGrad({ angle: v })} />
            </Row>
            <Row>
              <NumberInput label="Duration (ms)" value={gradAnim.duration ?? 4000} min={500} max={20000} step={500} onChange={v => patchGrad({ duration: v })} />
            </Row>
            <Row>
              <ToggleBtn active={!!gradAnim.animateColors} onClick={() => patchGrad({ animateColors: !gradAnim.animateColors })}>Cycle colors</ToggleBtn>
              <ToggleBtn active={!!gradAnim.animateAngle} onClick={() => patchGrad({ animateAngle: !gradAnim.animateAngle })}>Rotate angle</ToggleBtn>
              <ToggleBtn active={gradAnim.loop !== false} onClick={() => patchGrad({ loop: !gradAnim.loop })}>Loop</ToggleBtn>
            </Row>
            <div style={{ fontSize: 10, color: '#888', padding: '2px 0' }}>Colors (one per line):</div>
            <textarea
              rows={4}
              value={gradColors.join('\n')}
              onChange={e => patchGrad({ colors: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
              style={{ width: '100%', fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: 4 }}
            />
          </>
        )}
      </SubSection>

      {/* ── Clip-Path Animation ─────────────────────────────────────────────── */}
      <SubSection label="Clip-Path Animation" defaultOpen={!!clipPathCfg.enabled}>
        <Row>
          <ToggleBtn active={!!clipPathCfg.enabled} onClick={() => patchClip({ enabled: !clipPathCfg.enabled })}>Enable</ToggleBtn>
        </Row>
        {clipPathCfg.enabled && (
          <>
            <Row>
              <SelectInput label="Trigger" value={clipPathCfg.trigger ?? 'enter'} options={['enter','hover','always']} onChange={v => patchClip({ trigger: v as ClipPathConfig['trigger'] })} />
              <NumberInput label="Duration (ms)" value={clipPathCfg.duration ?? 600} min={100} max={3000} step={50} onChange={v => patchClip({ duration: v })} />
            </Row>
            <Row>
              <SelectInput label="Easing" value={clipPathCfg.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchClip({ easing: v })} />
            </Row>
            <div style={{ fontSize: 10, color: '#888', padding: '2px 0' }}>From (clip-path):</div>
            <input value={clipPathCfg.from ?? ''} onChange={e => patchClip({ from: e.target.value })} placeholder="inset(0 100% 0 0)" style={{ width: '100%', fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '3px 6px' }} />
            <div style={{ fontSize: 10, color: '#888', padding: '2px 0' }}>To (clip-path):</div>
            <input value={clipPathCfg.to ?? ''} onChange={e => patchClip({ to: e.target.value })} placeholder="inset(0 0% 0 0)" style={{ width: '100%', fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '3px 6px' }} />
          </>
        )}
      </SubSection>

      {/* ── Mask Animation ─────────────────────────────────────────────────── */}
      <SubSection label="Mask Animation" defaultOpen={!!maskCfg2.enabled}>
        <Row>
          <ToggleBtn active={!!maskCfg2.enabled} onClick={() => patchMask2({ enabled: !maskCfg2.enabled })}>Enable</ToggleBtn>
        </Row>
        {maskCfg2.enabled && (
          <>
            <div style={{ fontSize: 10, color: '#888', padding: '2px 0' }}>mask-image CSS value:</div>
            <input value={maskCfg2.image ?? ''} onChange={e => patchMask2({ image: e.target.value })} placeholder="linear-gradient(to right, black, transparent)" style={{ width: '100%', fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '3px 6px' }} />
            <Row>
              <ToggleBtn active={!!maskCfg2.animateSize} onClick={() => patchMask2({ animateSize: !maskCfg2.animateSize })}>Animate wipe</ToggleBtn>
              <NumberInput label="Duration (ms)" value={maskCfg2.duration ?? 800} min={100} max={5000} step={100} onChange={v => patchMask2({ duration: v })} />
            </Row>
            <Row>
              <SelectInput label="Easing" value={maskCfg2.easing ?? 'easeInOut'} options={EASING_OPTS as unknown as string[]} onChange={v => patchMask2({ easing: v })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Pseudo-Element Effects ─────────────────────────────────────────── */}
      <SubSection label="Pseudo-Element Effects" defaultOpen={!!pseudoCfg.enabled}>
        <Row>
          <ToggleBtn active={!!pseudoCfg.enabled} onClick={() => patchPseudo({ enabled: !pseudoCfg.enabled })}>Enable</ToggleBtn>
        </Row>
        {pseudoCfg.enabled && (
          <>
            <Row>
              <SelectInput label="Target" value={pseudoCfg.target ?? '::before'} options={['::before','::after']} onChange={v => patchPseudo({ target: v as PseudoElementConfig['target'] })} />
              <SelectInput label="Trigger" value={pseudoCfg.trigger ?? 'hover'} options={['hover','always','enter']} onChange={v => patchPseudo({ trigger: v as PseudoElementConfig['trigger'] })} />
            </Row>
            <Row>
              <ColorInput label="Background" value={pseudoCfg.background ?? '#6366f1'} onChange={v => patchPseudo({ background: v })} />
              <ColorInput label="Hover bg" value={pseudoCfg.hoverBackground ?? '#ec4899'} onChange={v => patchPseudo({ hoverBackground: v })} />
            </Row>
            <Row>
              <NumberInput label="Width (px/%)" value={parseInt(pseudoCfg.width ?? '100', 10)} min={0} max={100} step={1} onChange={v => patchPseudo({ width: v + '%' })} />
              <NumberInput label="Height (px)" value={parseInt(pseudoCfg.height ?? '2', 10)} min={1} max={100} step={1} onChange={v => patchPseudo({ height: v + 'px' })} />
              <NumberInput label="Hover opacity" value={(pseudoCfg.hoverOpacity ?? 1) * 100} min={0} max={100} step={5} onChange={v => patchPseudo({ hoverOpacity: v / 100 })} />
            </Row>
            <Row>
              <NumberInput label="Hover width %" value={parseInt(pseudoCfg.hoverWidth ?? '100', 10)} min={0} max={200} step={5} onChange={v => patchPseudo({ hoverWidth: v + '%' })} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Gesture / Swipe ───────────────────────────────────────────────── */}
      <SubSection label="Gesture / Swipe" defaultOpen={!!gestureCfg.enabled}>
        <Row>
          <ToggleBtn active={!!gestureCfg.enabled} onClick={() => patchGesture({ enabled: !gestureCfg.enabled })}>Enable</ToggleBtn>
          <ToggleBtn active={!!gestureCfg.swipe} onClick={() => patchGesture({ swipe: !gestureCfg.swipe })}>Swipe detect</ToggleBtn>
        </Row>
        {gestureCfg.enabled && (
          <>
            <Row>
              <NumberInput label="Min distance (px)" value={gestureCfg.swipeThreshold ?? 50} min={10} max={300} step={5} onChange={v => patchGesture({ swipeThreshold: v })} />
              <NumberInput label="Anim duration (ms)" value={gestureCfg.animationDuration ?? 400} min={100} max={2000} step={50} onChange={v => patchGesture({ animationDuration: v })} />
            </Row>
            <div style={{ fontSize: 10, color: '#888', padding: '4px 0 2px' }}>Animation type on swipe:</div>
            <Row>
              <span style={{ fontSize: 10, color: '#aaa', minWidth: 40 }}>← Left</span>
              <input value={gestureCfg.onSwipeLeft ?? ''} onChange={e => patchGesture({ onSwipeLeft: e.target.value })} placeholder="slideInRight" style={{ flex: 1, fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '2px 5px' }} />
              <span style={{ fontSize: 10, color: '#aaa', minWidth: 40 }}>→ Right</span>
              <input value={gestureCfg.onSwipeRight ?? ''} onChange={e => patchGesture({ onSwipeRight: e.target.value })} placeholder="slideInLeft" style={{ flex: 1, fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '2px 5px' }} />
            </Row>
            <Row>
              <span style={{ fontSize: 10, color: '#aaa', minWidth: 40 }}>↑ Up</span>
              <input value={gestureCfg.onSwipeUp ?? ''} onChange={e => patchGesture({ onSwipeUp: e.target.value })} placeholder="slideInDown" style={{ flex: 1, fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '2px 5px' }} />
              <span style={{ fontSize: 10, color: '#aaa', minWidth: 40 }}>↓ Down</span>
              <input value={gestureCfg.onSwipeDown ?? ''} onChange={e => patchGesture({ onSwipeDown: e.target.value })} placeholder="slideInUp" style={{ flex: 1, fontSize: 11, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 3, padding: '2px 5px' }} />
            </Row>
          </>
        )}
      </SubSection>

      {/* ── Preview button ────────────────────────────────────────────────── */}
      <div style={{ paddingTop: 8 }}>
        <button
          onClick={() => {
            if (typeof window !== 'undefined') {
              const frames = document.querySelectorAll('iframe');
              frames.forEach(f => f.contentWindow?.postMessage({ type: 'sdui-preview-animation', nodeId }, '*'));
            }
          }}
          style={{ width: '100%', padding: '5px 0', fontSize: 11, background: '#1d4ed8', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer' }}
        >
          ▶ Preview animation
        </button>
      </div>
    </div>
  );
}
