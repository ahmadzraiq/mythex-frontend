'use client';

/**
 * AnimatedNode — wraps any SDUI node that has props.animation.
 *
 * Cross-platform implementation using:
 *  - react-native-reanimated   : shared values, useAnimatedStyle, withTiming/withSpring/withRepeat
 *  - react-native-gesture-handler: GestureDetector + Gesture.Pan / Gesture.Tap / Gesture.Hover
 *  - @legendapp/motion         : AnimatePresence for exit sequences
 *  - react-native-svg          : svgStroke, noise (feTurbulence), clipPath
 *  - @shopify/react-native-skia: particles (native); Canvas 2D used on web
 *  - @react-native-masked-view : mask (native + web via CSS)
 *  - react-native-linear-gradient: gradient overlays and shimmer (cross-platform)
 *
 * isWeb guards have been removed. Feature detection (typeof window, typeof
 * IntersectionObserver) replaces explicit Platform.OS === 'web' checks.
 * Gesture.Hover() replaces window.mousemove / mouse event handlers for
 * tilt and mouseParallax. Reanimated shadow props replace CSS box-shadow.
 * RN filter array replaces CSS filter strings.
 */

import React, {
  useEffect, useLayoutEffect, useRef, useState, useMemo, useId, useCallback,
  type CSSProperties,
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  withSequence,
  withDelay,
  runOnJS,
  useAnimatedRef,
  interpolateColor,
  cancelAnimation,
  Easing as ReanimatedEasing,
  useFrameCallback,
  useAnimatedReaction,
  measure,
  FadeOut,
  FadeOutDown,
  FadeOutUp,
  FadeOutLeft,
  FadeOutRight,
  ZoomOut,
  type BaseAnimationBuilder,
} from 'react-native-reanimated';
import {
  GestureDetector,
  Gesture,
  type PanGestureHandlerEventPayload,
  type GestureStateChangeEvent,
  type GestureUpdateEvent,
} from 'react-native-gesture-handler';
import type { ComposedGesture } from 'react-native-gesture-handler/lib/typescript/handlers/gestures/gestureComposition';
type AnyGesture = ComposedGesture | ReturnType<typeof Gesture.Pan> | ReturnType<typeof Gesture.Tap> | ReturnType<typeof Gesture.Hover>;
import Svg, {
  Path as SvgPath,
  Filter,
  FeTurbulence,
  FeColorMatrix,
  Defs,
  ClipPath as SvgClipPath,
  Rect as SvgRect,
} from 'react-native-svg';
import LinearGradient from 'react-native-linear-gradient';
import { useRunAction } from '../run-action-context';
import { useScrollOffset } from '../scroll-offset-context';

// ─── Cross-platform library imports ───────────────────────────────────────────
// On web, Next.js aliases these to stubs in lib/sdui/stubs/ via next.config.mjs.
// On native (Expo/Metro), the real implementations are resolved automatically.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Canvas: SkiaCanvasRaw } = require('@shopify/react-native-skia') as { Canvas: React.ComponentType<{ style?: object; width: number; height: number; onLayout?: (e: { nativeEvent: { layout: { width: number; height: number } } }) => void; onTouch?: unknown; children?: React.ReactNode }> | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: MaskedViewRaw } = require('@react-native-masked-view/masked-view') as { default: React.ComponentType<{ maskElement: React.ReactNode; style?: object; children?: React.ReactNode }> | null };

const SkiaCanvas     = SkiaCanvasRaw     ?? null;
const MaskedViewComponent = MaskedViewRaw ?? null;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface EnterConfig {
  type?: string;
  duration?: number;
  delay?: number;
  easing?: string;
  spring?: boolean;
  stiffness?: number;
  damping?: number;
  mass?: number;
  stagger?: number;
}

export interface ExitConfig {
  type?: string;
  duration?: number;
  delay?: number;
  easing?: string;
  /** Separate easing for the opacity property (defaults to easing). Useful to
   *  keep the item visible while the transform spring plays, e.g. "easeIn". */
  opacityEasing?: string;
  /** When set, the exit animation fires automatically when the states machine
   *  watchVar equals this string (instead of via external triggerExitAnimation). */
  stateTrigger?: string;
}

export interface LoopConfig {
  type?: string;
  duration?: number;
  delay?: number;
  repeatCount?: number;
  direction?: 'normal' | 'alternate';
  /** Shadow/ring color for glowPulse and ripple (CSS color string, e.g. "#facc15" or "rgba(20,184,166,0.8)") */
  color?: string;
}

export interface PressConfig {
  scale?: number;
  opacity?: number;
  x?: number;
  y?: number;
  duration?: number;
  easing?: string;
}

export interface HoverConfig {
  scale?: number;
  opacity?: number;
  y?: number;
  duration?: number;
  easing?: string;
}

export interface ScrollConfig {
  enabled?: boolean;
  type?: string;
  threshold?: number;
  once?: boolean;
  duration?: number;
  delay?: number;
  easing?: string;
}

export interface ParallaxConfig {
  enabled?: boolean;
  speed?: number;
  direction?: 'vertical' | 'horizontal';
  clamp?: number;
}

export interface DragConfig {
  enabled?: boolean;
  axis?: 'both' | 'x' | 'y';
  bounds?: { top?: number | null; bottom?: number | null; left?: number | null; right?: number | null };
  snapBack?: boolean;
  springBack?: boolean;
}

export interface ColorConfig {
  enabled?: boolean;
  property?: 'backgroundColor' | 'borderColor';
  from?: string;
  to?: string;
  trigger?: 'enter' | 'loop';
  duration?: number;
  easing?: string;
  loop?: boolean;
}

export interface LayoutAnimConfig {
  enabled?: boolean;
  type?: 'linear' | 'spring' | 'sequenced' | 'fading';
  duration?: number;
}

export interface ImperativeTriggerConfig {
  type: string;
  duration?: number;
  easing?: string;
  watchVar?: unknown;
}

export interface FilterConfig {
  enabled?: boolean;
  blur?: number;
  brightness?: number;
  contrast?: number;
  grayscale?: number;
  saturate?: number;
  hueRotate?: number;
  dropShadow?: string;
  duration?: number;
  easing?: string;
  loop?: boolean;
}

export interface TiltConfig {
  enabled?: boolean;
  maxX?: number;
  maxY?: number;
  perspective?: number;
  scale?: number;
  duration?: number;
  reset?: boolean;
}

export interface MouseParallaxConfig {
  enabled?: boolean;
  strength?: number;
  axis?: 'both' | 'x' | 'y';
}

export interface FocusConfig {
  enabled?: boolean;
  color?: string;
  blur?: number;
  spread?: number;
  duration?: number;
}

export interface MorphShapeConfig {
  enabled?: boolean;
  from?: string;
  to?: string;
  duration?: number;
  easing?: string;
  loop?: boolean;
}

export interface SvgStrokeConfig {
  enabled?: boolean;
  length?: number;
  duration?: number;
  delay?: number;
  easing?: string;
  loop?: boolean;
}

export interface ScrollProgressConfig {
  enabled?: boolean;
  property?: 'opacity' | 'scale' | 'translateY' | 'translateX' | 'rotate' | 'blur';
  from?: number;
  to?: number;
  unit?: string;
  start?: number;
  end?: number;
  pin?: boolean;
}

export interface FlipConfig {
  trigger?: 'hover' | 'click';
  duration?: number;
  perspective?: number;
}

export interface SplitTextConfig {
  text?: string;
  split?: 'char' | 'word' | 'line';
  type?: string;
  duration?: number;
  stagger?: number;
  delay?: number;
  easing?: string;
  className?: string;
  unitClass?: string;
  testId?: string;
}

export interface ParticlesConfig {
  count?: number;
  color?: string;
  background?: string;
  speed?: number;
  maxRadius?: number;
  connectDistance?: number;
  interactive?: boolean;
}

export interface NoiseConfig {
  baseFrequency?: number;
  numOctaves?: number;
  opacity?: number;
  color?: string;
  animate?: boolean;
  animateDuration?: number;
  type?: 'fractalNoise' | 'turbulence';
}

export interface AnimationConfig {
  enter?: EnterConfig;
  exit?: ExitConfig;
  loop?: LoopConfig;
  press?: PressConfig;
  hover?: HoverConfig;
  scroll?: ScrollConfig;
  parallax?: ParallaxConfig;
  drag?: DragConfig;
  color?: ColorConfig;
  layout?: LayoutAnimConfig;
  imperativeTrigger?: ImperativeTriggerConfig;
  filter?: FilterConfig;
  tilt?: TiltConfig;
  mouseParallax?: MouseParallaxConfig;
  focus?: FocusConfig;
  morphShape?: MorphShapeConfig;
  scrollProgress?: ScrollProgressConfig;
  svgStroke?: SvgStrokeConfig;
  customBezier?: [number, number, number, number];
  states?: {
    watchVar: unknown;
    duration?: number;
    easing?: string;
    defaultState?: string;
    states: Record<string, Record<string, string>>;
  };
  timeline?: TimelineStep[];
  gradientAnimation?: GradientAnimationConfig;
  clipPath?: ClipPathConfig;
  mask?: MaskConfig;
  pseudoElement?: PseudoElementConfig;
  gesture?: GestureConfig;
  flip?: FlipConfig;
  splitText?: SplitTextConfig;
  particles?: ParticlesConfig;
  noise?: NoiseConfig;
  outerClassName?: string;
  outerStyle?: Record<string, unknown>;
  shimmer?: {
    baseColor?: string;
    highlightColor?: string;
    duration?: number;
  };
}

export interface GradientAnimationConfig {
  enabled?: boolean;
  type?: 'linear' | 'radial' | 'conic';
  colors?: string[];
  angle?: number;
  duration?: number;
  animateAngle?: boolean;
  animateColors?: boolean;
  loop?: boolean;
}

export interface ClipPathConfig {
  enabled?: boolean;
  from?: string;
  to?: string;
  trigger?: 'enter' | 'hover' | 'always';
  duration?: number;
  easing?: string;
}

export interface MaskConfig {
  enabled?: boolean;
  image?: string;
  size?: string;
  position?: string;
  animateSize?: boolean;
  duration?: number;
  easing?: string;
}

export interface PseudoElementConfig {
  enabled?: boolean;
  target?: '::before' | '::after';
  content?: string;
  background?: string;
  width?: string;
  height?: string;
  position?: 'absolute' | 'relative';
  bottom?: string;
  left?: string;
  right?: string;
  top?: string;
  transition?: string;
  trigger?: 'always' | 'hover' | 'enter';
  hoverWidth?: string;
  hoverOpacity?: number;
  hoverBackground?: string;
}

export interface GestureConfig {
  enabled?: boolean;
  swipe?: boolean;
  swipeThreshold?: number;
  velocityThreshold?: number;
  onSwipeLeft?: string;
  onSwipeRight?: string;
  onSwipeUp?: string;
  onSwipeDown?: string;
  onSwipeLeftAction?: string;
  onSwipeRightAction?: string;
  onSwipeUpAction?: string;
  onSwipeDownAction?: string;
  animationDuration?: number;
  dragFeedback?: boolean;
}

export interface TimelineStep {
  property: string;
  from: string | number;
  to: string | number;
  startMs?: number;
  endMs?: number;
  easing?: string;
  loop?: boolean;
}

interface AnimatedNodeProps {
  animation: AnimationConfig;
  staggerIndex?: number;
  nodeId?: string;
  nodeType?: string;
  builderMode?: boolean;
  children: React.ReactNode;
}

// ─── Easing helpers ───────────────────────────────────────────────────────────

const CSS_EASING: Record<string, string> = {
  linear:    'linear',
  easeIn:    'ease-in',
  easeOut:   'ease-out',
  easeInOut: 'ease-in-out',
  circIn:    'cubic-bezier(0.55,0,1,0.45)',
  circOut:   'cubic-bezier(0,0.55,0.45,1)',
  circInOut: 'cubic-bezier(0.85,0,0.15,1)',
  backIn:    'cubic-bezier(0.36,0,0.66,-0.56)',
  backOut:   'cubic-bezier(0.34,1.56,0.64,1)',
  backInOut: 'cubic-bezier(0.68,-0.6,0.32,1.6)',
};
const cssEase = (name?: string) => CSS_EASING[name ?? ''] ?? 'ease-in-out';

const RN_EASING: Record<string, typeof ReanimatedEasing.linear> = {
  linear:    ReanimatedEasing.linear,
  easeIn:    ReanimatedEasing.in(ReanimatedEasing.quad),
  easeOut:   ReanimatedEasing.out(ReanimatedEasing.quad),
  easeInOut: ReanimatedEasing.inOut(ReanimatedEasing.quad),
  circIn:    ReanimatedEasing.in(ReanimatedEasing.circle),
  circOut:   ReanimatedEasing.out(ReanimatedEasing.circle),
  circInOut: ReanimatedEasing.inOut(ReanimatedEasing.circle),
  backIn:    ReanimatedEasing.in(ReanimatedEasing.back(1.5)),
  backOut:   ReanimatedEasing.out(ReanimatedEasing.back(1.5)),
  backInOut: ReanimatedEasing.inOut(ReanimatedEasing.back(1.5)),
};
const rnEase = (name?: string) => RN_EASING[name ?? ''] ?? ReanimatedEasing.inOut(ReanimatedEasing.quad);

// ─── Named animation → initial/target value maps ─────────────────────────────

interface AnimValues { opacity?: number; translateX?: number; translateY?: number; scale?: number; rotateX?: number; rotateY?: number }

const ENTER_FROM: Record<string, AnimValues> = {
  fadeIn:       { opacity: 0 },
  slideInUp:    { opacity: 0, translateY: 40 },
  slideInDown:  { opacity: 0, translateY: -40 },
  slideInLeft:  { opacity: 0, translateX: -40 },
  slideInLeftSubtle: { opacity: 0, translateX: -28 },
  slideInRight: { opacity: 0, translateX: 40 },
  zoomIn:       { opacity: 0, scale: 0.6 },
  bounceIn:     { opacity: 0, scale: 0.3 },
  flipInX:      { opacity: 0, rotateX: 90 },
  flipInY:      { opacity: 0, rotateY: 90 },
  // flipIn3D: perspective flip with slight scale shrink
  flipIn3D:     { opacity: 0, rotateY: 90, scale: 0.8 },
  // rollIn: slides from left with a slight scale (no rotateZ support, best approximation)
  rollIn:       { opacity: 0, translateX: -80, scale: 0.8 },
  // tiltIn: tips in from slight overhead angle via rotateX
  tiltIn:       { opacity: 0, rotateX: 40 },
  skewIn:       { opacity: 0, translateX: -30 },
  skewInY:      { opacity: 0, translateY: -20 },
  dropIn:       { opacity: 0, translateY: -60, scale: 0.85 },
  riseFade:     { opacity: 0, translateY: 60, scale: 0.9 },
  expandIn:     { opacity: 0, scale: 0.1 },
  // blurIn / glowIn: opacity handled by Reanimated; CSS filter injected separately on web
  blurIn:       { opacity: 0 },
  glowIn:       { opacity: 0 },
  revealUp:     { opacity: 0, translateY: 40 },
  charFall:     { opacity: 0, translateY: -40 },
  charBounce:   { opacity: 0, scale: 0 },
};

const EXIT_TO: Record<string, AnimValues> = {
  fadeOut:      { opacity: 0 },
  slideOutUp:   { opacity: 0, translateY: -40 },
  slideOutDown: { opacity: 0, translateY: 40 },
  slideOutLeft: { opacity: 0, translateX: -40 },
  slideOutRight:{ opacity: 0, translateX: 40 },
  zoomOut:      { opacity: 0, scale: 0.6 },
  shrinkOut:    { opacity: 0, scale: 0.1 },
  blurOut:      { opacity: 0 },
  skewOut:      { opacity: 0, translateX: 30 },
};

// Maps SDUI exit type names to Reanimated predefined animation classes.
// Only predefined classes (with a static `presetName`) work on web.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REANIMATED_EXIT_MAP: Record<string, any> = {
  fadeOut:       FadeOut,
  slideOutDown:  FadeOutDown,
  slideOutUp:    FadeOutUp,
  slideOutLeft:  FadeOutLeft,
  slideOutRight: FadeOutRight,
  zoomOut:       ZoomOut,
  shrinkOut:     ZoomOut,
  blurOut:       FadeOut,
  skewOut:       FadeOutLeft,
};

// Loop animation — cross-platform (Reanimated withRepeat/withSequence)
/** Parse "#rrggbb" / "#rgb" / "rgb(r,g,b)" / "rgba(r,g,b,a)" → {r,g,b}. Fallback: purple-500. */
function parseRGB(color: string): { r: number; g: number; b: number } {
  const hex = color.trim();
  if (hex.startsWith('#')) {
    const c = hex.slice(1);
    if (c.length === 3) {
      const r = parseInt(c[0] + c[0], 16);
      const g = parseInt(c[1] + c[1], 16);
      const b = parseInt(c[2] + c[2], 16);
      return { r: isNaN(r) ? 168 : r, g: isNaN(g) ? 85 : g, b: isNaN(b) ? 247 : b };
    }
    if (c.length === 6) {
      const r = parseInt(c.slice(0, 2), 16);
      const g = parseInt(c.slice(2, 4), 16);
      const b = parseInt(c.slice(4, 6), 16);
      return { r: isNaN(r) ? 168 : r, g: isNaN(g) ? 85 : g, b: isNaN(b) ? 247 : b };
    }
  }
  const m = hex.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return { r: 168, g: 85, b: 247 }; // purple-500 fallback
}

type LoopStep = { to: number; dur: number };
type LoopEntry =
  | { sv: 'scale' | 'translateX' | 'translateY' | 'opacity' | 'rotate'; from: number; to: number; sequence?: never }
  | { sv: 'scale' | 'translateX' | 'translateY' | 'opacity' | 'rotate'; from: number; sequence: LoopStep[] };

const LOOP_ANIM: Record<string, LoopEntry> = {
  pulse:         { sv: 'scale',      from: 1,    to: 1.10  },
  breathe:       { sv: 'scale',      from: 1,    to: 1.06  },
  float:         { sv: 'translateY', from: 0,    to: -10   },
  flash:         { sv: 'opacity',    from: 0,    to: 1     },
  // ripple: subtle grow (scale 1→1.2) — was 2 which was far too large
  ripple:        { sv: 'scale',      from: 1,    to: 1.2   },
  spin:          { sv: 'rotate',     from: 0,    to: 360   },
  ticker:        { sv: 'rotate',     from: 0,    to: 360   },
  // glowPulse: opacity fade 0.65→1 (use alternate direction in config)
  glowPulse:     { sv: 'opacity',    from: 0.65, to: 1     },
  // gradientDrift: handled by dedicated loopBgPosX shared value (see effect below)
  // — NOT in this table so it doesn't fall through to the generic translateX path
  shake: {
    sv: 'translateX', from: 0,
    sequence: [
      { to: -7, dur: 0.10 }, { to: 7,  dur: 0.10 }, { to: -7, dur: 0.10 },
      { to: 7,  dur: 0.10 }, { to: -7, dur: 0.10 }, { to: 7,  dur: 0.10 },
      { to: 0,  dur: 0.40 },
    ],
  },
  bounce: {
    sv: 'translateY', from: 0,
    sequence: [
      { to: -14, dur: 0.45 }, { to: 0, dur: 0.45 }, { to: -5, dur: 0.05 }, { to: 0, dur: 0.05 },
    ],
  },
  wiggle: {
    sv: 'rotate', from: 0,
    sequence: [
      { to: -8, dur: 0.25 }, { to: 8, dur: 0.50 }, { to: 0, dur: 0.25 },
    ],
  },
  swing: {
    sv: 'rotate', from: 0,
    sequence: [
      { to: 8, dur: 0.20 }, { to: -6, dur: 0.20 }, { to: 5, dur: 0.20 },
      { to: -3, dur: 0.20 }, { to: 0, dur: 0.20 },
    ],
  },
  wobble: {
    sv: 'translateX', from: 0,
    sequence: [
      { to: -10, dur: 0.15 }, { to: 8,  dur: 0.15 }, { to: -6, dur: 0.15 },
      { to: 4,   dur: 0.15 }, { to: -2, dur: 0.15 }, { to: 0,  dur: 0.25 },
    ],
  },
  // heartbeat: toned-down peaks (was 1.13→1.22, now 1.06→1.10)
  heartbeat: {
    sv: 'scale', from: 1,
    sequence: [
      { to: 1.06, dur: 0.14 }, { to: 1,    dur: 0.14 },
      { to: 1.10, dur: 0.14 }, { to: 1,    dur: 0.58 },
    ],
  },
};

// ─── Imperative registry ──────────────────────────────────────────────────────

type TriggerFn = (animType: string, duration: number) => void;
const animationRegistry = new Map<string, TriggerFn>();
export const registerAnimationNode   = (id: string, fn: TriggerFn) => animationRegistry.set(id, fn);
export const unregisterAnimationNode = (id: string) => animationRegistry.delete(id);
export const triggerAnimationNode    = (id: string, type: string, duration: number) =>
  animationRegistry.get(id)?.(type, duration);

// ─── Exit animation registry ──────────────────────────────────────────────────
// Allows external callers (e.g. PopupRenderer) to trigger a node's exit animation
// and receive a callback when it completes, before unmounting the node.

type ExitFn = (onDone: () => void) => void;
const exitRegistry = new Map<string, ExitFn>();
export const registerExitHandler   = (id: string, fn: ExitFn) => exitRegistry.set(id, fn);
export const unregisterExitHandler = (id: string) => exitRegistry.delete(id);
/** Trigger exit animation on a registered node. Returns a Promise that resolves when done.
 *  If no exit handler is registered for the id, resolves immediately. */
export const triggerExitAnimation = (id: string): Promise<void> =>
  new Promise<void>(resolve => {
    const fn = exitRegistry.get(id);
    if (fn) fn(resolve);
    else resolve();
  });

// ─── CSS-string parser for statesMachine (converts to RN-compatible values) ───

function parseCSSProps(cssProps: Record<string, string>): {
  opacity?: number;
  backgroundColor?: string;
  width?: number;
  height?: number;
  borderRadius?: number;
  scaleX?: number;
  translateX?: number;
  translateY?: number;
  scale?: number;
} {
  const result: ReturnType<typeof parseCSSProps> = {};
  for (const [prop, value] of Object.entries(cssProps)) {
    if (prop === 'opacity') {
      result.opacity = parseFloat(value);
    } else if (prop === 'background' || prop === 'backgroundColor') {
      result.backgroundColor = value;
    } else if (prop === 'borderRadius') {
      result.borderRadius = parseFloat(value);
    } else if (prop === 'width') {
      const n = parseFloat(value);
      if (!isNaN(n)) result.width = n;
    } else if (prop === 'height') {
      const n = parseFloat(value);
      if (!isNaN(n)) result.height = n;
    } else if (prop === 'translateX') {
      const n = parseFloat(value);
      if (!isNaN(n)) result.translateX = n;
    } else if (prop === 'translateY') {
      const n = parseFloat(value);
      if (!isNaN(n)) result.translateY = n;
    } else if (prop === 'scale') {
      const n = parseFloat(value);
      if (!isNaN(n)) result.scale = n;
    } else if (prop === 'transform') {
      const scaleM = value.match(/scale\(([\d.]+)\)/);
      if (scaleM) result.scale = parseFloat(scaleM[1]);
      const txPx = value.match(/translateX\(([-\d.]+)px\)/);
      if (txPx) result.translateX = parseFloat(txPx[1]);
      const tyPx = value.match(/translateY\(([-\d.]+)px\)/);
      if (tyPx) result.translateY = parseFloat(tyPx[1]);
    }
  }
  return result;
}

// ─── Clamp helper ─────────────────────────────────────────────────────────────

function clamp(v: number, lo?: number | null, hi?: number | null) {
  if (lo != null) v = Math.max(lo, v);
  if (hi != null) v = Math.min(hi, v);
  return v;
}

// ─── AnimatedNode ─────────────────────────────────────────────────────────────

export const AnimatedNode = React.memo(function AnimatedNode({
  animation,
  staggerIndex = 0,
  nodeId,
  nodeType,
  builderMode = false,
  children,
}: AnimatedNodeProps) {
  const {
    enter, exit, loop, press, hover, scroll, parallax, drag, color, layout,
    imperativeTrigger, filter, tilt, mouseParallax, focus, morphShape,
    scrollProgress, svgStroke, customBezier, timeline,
    states: statesMachine, gradientAnimation, clipPath: clipPathCfg,
    mask: maskCfg, pseudoElement: pseudoElCfg, gesture, flip,
    splitText, particles, noise, outerClassName, outerStyle, shimmer,
  } = animation;

  // ── Animated ref (for measure on native) ───────────────────────────────────
  const animatedRef = useAnimatedRef<Animated.View>();

  // ── Reanimated shared values ────────────────────────────────────────────────
  // Enter / exit
  // Only start at 0 if the animation type actually includes an opacity from-value.
  // Types like slideInLeftSubtle only translate and should NOT start invisible.
  // In builder mode elements appear at final state; animation only plays via "▶ Preview" button
  const enterOpacity    = useSharedValue(
    !builderMode && enter?.type && enter.type !== 'none' && !scroll?.enabled &&
    (ENTER_FROM[enter.type]?.opacity ?? null) != null ? 0 : 1
  );
  const enterTranslateX = useSharedValue(0);
  const enterTranslateY = useSharedValue(0);
  const enterScale      = useSharedValue(1);
  const enterRotateX    = useSharedValue(0);
  const enterRotateY    = useSharedValue(0);

  // Loop — one shared value per animated property so each type is applied correctly
  const loopScale        = useSharedValue(1);   // scale animations (pulse, breathe, heartbeat)
  const loopTransX       = useSharedValue(0);   // translateX animations (shake, wobble, gradientDrift)
  const loopTransY       = useSharedValue(0);   // translateY animations (float, bounce)
  const loopOpac         = useSharedValue(1);   // opacity animations (flash)
  const loopRotate       = useSharedValue(0);   // rotate animations (spin, ticker, wiggle, swing)
  const loopShadowRadius = useSharedValue(0);   // shadow radius (glowPulse, ripple)
  const loopShadowOpac   = useSharedValue(0);   // shadow opacity (glowPulse, ripple)
  // RGB components so the worklet can reconstruct rgba() without closure capture issues
  const loopShadowR      = useSharedValue(168); // default: purple-500 r (visible on any bg)
  const loopShadowG      = useSharedValue(85);  // default: purple-500 g
  const loopShadowB      = useSharedValue(247); // default: purple-500 b
  // gradientDrift: background-position-x percentage (0–100). -1 = inactive.
  const loopBgPosX       = useSharedValue(-1);
  // Legacy alias kept so existing useAnimatedStyle dep array still compiles
  const loopSv = loopScale;

  // Press / hover
  const pressScale   = useSharedValue(1);
  const pressOpacity = useSharedValue(1);
  const hoverScale   = useSharedValue(1);
  const hoverOpacity = useSharedValue(1);
  const hoverTransY  = useSharedValue(0);

  // Drag
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  // Gesture / swipe dragFeedback + statesMachine
  const gestureTranslateX = useSharedValue(0);
  const lastSmTransform   = useSharedValue(0);

  // Timeline
  const timelineOpacity = useSharedValue(1);
  const timelineScale   = useSharedValue(1);

  // statesMachine
  const smOpacity     = useSharedValue(1);
  const smScale       = useSharedValue(1);
  const smTranslateX  = useSharedValue(0);
  const smTranslateY  = useSharedValue(0);
  const smWidth       = useSharedValue<number | undefined>(undefined);
  const smHeight      = useSharedValue<number | undefined>(undefined);
  const smBorderRadius= useSharedValue<number | undefined>(undefined);
  const smBgColorProg = useSharedValue(0);
  const smFromColor   = useRef('#000000');
  const smToColor     = useRef('#000000');

  // Color animation
  const colorProgress = useSharedValue(0);
  const colorFrom     = useRef('#000000');
  const colorTo       = useRef('#000000');

  // Morph shape
  const morphBorderRadius = useSharedValue(0);
  const morphLoop         = useSharedValue(0);

  // Flip
  const flipRotateY = useSharedValue(0);

  // ImperativeTrigger
  const impTriggerProg = useSharedValue(0);

  // Focus ring (Reanimated shared value — replaces isFocused state)
  const isFocusedSv = useSharedValue(0);

  // Scroll trigger
  const [scrollVisible, setScrollVisible] = useState(!scroll?.enabled);
  const scrollVisProgress = useSharedValue(scroll?.enabled ? 0 : 1);

  // Scroll progress (0→1) — web: window.scroll, native: ScrollOffsetContext
  const [scrollProg, setScrollProg] = useState(0);

  // Parallax
  const parallaxOffset = useSharedValue(0);

  // Tilt — cross-platform via Gesture.Hover()
  const tiltRotX = useSharedValue(0);
  const tiltRotY = useSharedValue(0);

  // MouseParallax — cross-platform via Gesture.Hover()
  const mouseParallaxX = useSharedValue(0);
  const mouseParallaxY = useSharedValue(0);

  // Pseudo-element hover progress (0=default/hidden, 1=hovered/visible)
  const pseudoHoverProgress = useSharedValue(
    pseudoElCfg?.trigger === 'always' || pseudoElCfg?.trigger === 'enter' ? 1 : 0
  );

  // Layout height animation (cross-platform via onLayout)
  const layoutHeightSv = useSharedValue<number | undefined>(undefined);

  // Flip UI state
  const [isFlipped, setIsFlipped] = useState(false);

  const noiseId      = useId().replace(/:/g, '');
  const componentId  = useId().replace(/:/g, 'c');

  // SVG stroke progress
  const strokeProgress = useSharedValue(0);

  // Clip-path active state (for 'enter'/'always' triggers)
  const [clipPathActive, setClipPathActive] = useState(false);

  // Mask active state
  const [maskActive, setMaskActive] = useState(false);

  // Shimmer progress
  const shimmerX = useSharedValue(-1);

  // Gradient angle animation
  const gradientAngleSv = useSharedValue(gradientAnimation?.angle ?? 135);

  // Node size ref — updated by onLayout, used by tiltGesture
  const nodeSizeRef = useRef({ width: 0, height: 0 });

  // Layout height tracking
  const prevLayoutHeight = useRef<number | null>(null);

  // SDUI action runner
  const runAction = useRunAction();

  // ── Enter animation ────────────────────────────────────────────────────────
  useEffect(() => {
    const type = enter?.type;
    // In builder mode, skip auto-play; use "▶ Preview animation" button instead
    if (!type || type === 'none' || scroll?.enabled || builderMode) return;
    const delay     = (enter?.delay ?? 0) + staggerIndex * (enter?.stagger ?? 0);
    const dur       = enter?.duration ?? 400;
    const easing    = rnEase(enter?.easing ?? 'easeOut');
    const isSpring  = enter?.spring;

    const from = ENTER_FROM[type] ?? { opacity: 0 };
    const springCfg = isSpring
      ? { damping: enter?.damping ?? 20, stiffness: enter?.stiffness ?? 200, mass: enter?.mass ?? 1 }
      : null;
    const anim = (from: number, to: number) =>
      withDelay(delay, springCfg ? withSpring(to, springCfg) : withTiming(to, { duration: dur, easing }));

    if (from.opacity     != null) { enterOpacity.value = from.opacity; enterOpacity.value = anim(from.opacity, 1); }
    if (from.translateX  != null) { enterTranslateX.value = from.translateX; enterTranslateX.value = anim(from.translateX, 0); }
    if (from.translateY  != null) { enterTranslateY.value = from.translateY; enterTranslateY.value = anim(from.translateY, 0); }
    if (from.scale       != null) { enterScale.value      = from.scale;      enterScale.value      = anim(from.scale,      1); }
    if (from.rotateX     != null) { enterRotateX.value    = from.rotateX;    enterRotateX.value    = anim(from.rotateX,    0); }
    if (from.rotateY     != null) { enterRotateY.value    = from.rotateY;    enterRotateY.value    = anim(from.rotateY,    0); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enter?.type, enter?.duration, enter?.delay, enter?.easing, enter?.stagger,
      enter?.spring, enter?.stiffness, enter?.damping, enter?.mass, staggerIndex, scroll?.enabled, builderMode]);

  // ── Builder "Preview animation" button — postMessage replay ───────────────
  // The animation panel posts { type: 'sdui-preview-animation', nodeId } to the iframe.
  // We listen here and replay the full enter animation from scratch.
  useEffect(() => {
    if (Platform.OS !== 'web' || !nodeId) return;
    const handler = (ev: MessageEvent) => {
      if (ev.data?.type !== 'sdui-preview-animation' || ev.data?.nodeId !== nodeId) return;
      const type = enter?.type;
      if (!type || type === 'none') return;
      const delay     = (enter?.delay ?? 0) + staggerIndex * (enter?.stagger ?? 0);
      const dur       = enter?.duration ?? 400;
      const easing    = rnEase(enter?.easing ?? 'easeOut');
      const isSpring  = enter?.spring;
      const from      = ENTER_FROM[type] ?? { opacity: 0 };
      const springCfg = isSpring
        ? { damping: enter?.damping ?? 20, stiffness: enter?.stiffness ?? 200, mass: enter?.mass ?? 1 }
        : null;
      const anim = (f: number, to: number) =>
        withDelay(delay, springCfg ? withSpring(to, springCfg) : withTiming(to, { duration: dur, easing }));

      // Cancel running animations and reset all shared values to start position
      cancelAnimation(enterOpacity);
      cancelAnimation(enterTranslateX);
      cancelAnimation(enterTranslateY);
      cancelAnimation(enterScale);
      cancelAnimation(enterRotateX);
      cancelAnimation(enterRotateY);

      if (from.opacity     != null) { enterOpacity.value = from.opacity;    enterOpacity.value    = anim(from.opacity,    1); }
      else                          { enterOpacity.value = 1; }
      if (from.translateX  != null) { enterTranslateX.value = from.translateX; enterTranslateX.value = anim(from.translateX, 0); }
      else                          { enterTranslateX.value = 0; }
      if (from.translateY  != null) { enterTranslateY.value = from.translateY; enterTranslateY.value = anim(from.translateY, 0); }
      else                          { enterTranslateY.value = 0; }
      if (from.scale       != null) { enterScale.value = from.scale;        enterScale.value      = anim(from.scale,      1); }
      else                          { enterScale.value = 1; }
      if (from.rotateX     != null) { enterRotateX.value = from.rotateX;   enterRotateX.value    = anim(from.rotateX,    0); }
      else                          { enterRotateX.value = 0; }
      if (from.rotateY     != null) { enterRotateY.value = from.rotateY;   enterRotateY.value    = anim(from.rotateY,    0); }
      else                          { enterRotateY.value = 0; }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, enter?.type, enter?.duration, enter?.delay, enter?.easing,
      enter?.spring, enter?.stiffness, enter?.damping, enter?.mass, staggerIndex]);

  // ── blurIn / glowIn — CSS filter animation on web (Reanimated handles opacity) ──
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const type = enter?.type;
    if (type !== 'blurIn' && type !== 'glowIn') return;
    if (scroll?.enabled) return;
    const el = animatedRef.current as unknown as HTMLElement | null;
    if (!el) return;
    const dur   = enter?.duration ?? 600;
    const delay = (enter?.delay ?? 0) + staggerIndex * (enter?.stagger ?? 0);
    const startFilter = type === 'blurIn'
      ? 'blur(16px)'
      : 'brightness(2.5) drop-shadow(0 0 18px rgba(255,255,255,0.9))';
    el.style.filter = startFilter;
    el.style.transition = `filter ${dur}ms ease-out ${delay}ms`;
    const raf = requestAnimationFrame(() => { el.style.filter = 'none'; });
    return () => {
      cancelAnimationFrame(raf);
      el.style.filter = '';
      el.style.transition = '';
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enter?.type, enter?.duration, enter?.delay, enter?.stagger, staggerIndex, scroll?.enabled]);

  // ── Loop animation — cross-platform (Reanimated) ──────────────────────────
  useEffect(() => {
    if (!loop?.type || loop.type === 'none' || builderMode) return;
    const dur   = loop.duration ?? 1000;
    const count = loop.repeatCount != null && loop.repeatCount !== -1 ? loop.repeatCount : -1;
    const delay = loop.delay ?? 0;
    // ── Dedicated type handlers (must come before LOOP_ANIM guard) ──────────────

    // glowPulse — pulsing box-shadow halo using configurable color
    if (loop.type === 'glowPulse') {
      const { r, g, b } = parseRGB(loop.color ?? '#a855f7');
      loopShadowR.value = r;
      loopShadowG.value = g;
      loopShadowB.value = b;
      const halfDur = dur * 0.5;
      const easing  = ReanimatedEasing.inOut(ReanimatedEasing.quad);
      loopShadowRadius.value = 4;
      loopShadowOpac.value   = 0.25;
      loopShadowRadius.value = withRepeat(withTiming(18, { duration: halfDur, easing }), count, true);
      loopShadowOpac.value   = withRepeat(withTiming(0.8, { duration: halfDur, easing }), count, true);
      return () => {
        cancelAnimation(loopShadowRadius);
        cancelAnimation(loopShadowOpac);
        loopShadowRadius.value = 0;
        loopShadowOpac.value   = 0;
      };
    }

    // ripple — expanding shadow ring, opacity fades out as radius grows
    if (loop.type === 'ripple') {
      const { r, g, b } = parseRGB(loop.color ?? '#a855f7');
      loopShadowR.value = r;
      loopShadowG.value = g;
      loopShadowB.value = b;
      const easing = ReanimatedEasing.out(ReanimatedEasing.quad);
      loopShadowRadius.value = 0;
      loopShadowOpac.value   = 0.7;
      loopShadowRadius.value = withRepeat(withTiming(20, { duration: dur, easing }), count, false);
      loopShadowOpac.value   = withRepeat(withTiming(0,  { duration: dur, easing }), count, false);
      return () => {
        cancelAnimation(loopShadowRadius);
        cancelAnimation(loopShadowOpac);
        loopShadowRadius.value = 0;
        loopShadowOpac.value   = 0;
      };
    }

    // gradientDrift — animate backgroundPositionX on the Animated.View wrapper.
    // The gradient background MUST live on animation.outerStyle (not props.style) so
    // both the background and backgroundPositionX are on the same Reanimated element.
    // On web: Reanimated writes backgroundPositionX as an inline CSS % string each frame.
    // On native: backgroundPositionX is not a valid RN prop; this is a no-op there.
    if (loop.type === 'gradientDrift') {
      const easing = ReanimatedEasing.inOut(ReanimatedEasing.sin);
      loopBgPosX.value = 0;
      loopBgPosX.value = withRepeat(withTiming(100, { duration: dur, easing }), count, true);
      return () => {
        cancelAnimation(loopBgPosX);
        loopBgPosX.value = -1;
      };
    }

    // ── Generic path: look up animated property via LOOP_ANIM table ─────────────
    const mapping = LOOP_ANIM[loop.type];
    if (!mapping) return;

    // Route to the correct shared value based on animated property
    type SimpleEntry = { sv: string; from: number; to: number };
    const svMap: Record<string, typeof loopScale> = {
      scale:      loopScale,
      translateX: loopTransX,
      translateY: loopTransY,
      opacity:    loopOpac,
      rotate:     loopRotate,
    };
    const target = svMap[mapping.sv] ?? loopScale;

    // Reset all loop shared values so previous animation doesn't bleed through
    loopScale.value = 1;
    loopTransX.value = 0;
    loopTransY.value = 0;
    loopOpac.value   = 1;
    loopRotate.value = 0;

    if (mapping.sequence) {
      const steps = mapping.sequence.map(s =>
        withTiming(s.to, { duration: dur * s.dur, easing: ReanimatedEasing.linear }),
      );
      const seqAnim = withSequence(...steps);
      target.value = mapping.from;
      target.value = withRepeat(
        delay > 0 ? withDelay(delay, seqAnim) : seqAnim,
        count, false,
      );
    } else if (mapping.sv === 'rotate') {
      const m = mapping as SimpleEntry;
      const rotAnim = withTiming(m.to, { duration: dur, easing: ReanimatedEasing.linear });
      target.value = 0;
      target.value = withRepeat(
        delay > 0 ? withDelay(delay, rotAnim) : rotAnim,
        count, false,
      );
    } else {
      const m = mapping as SimpleEntry;
      const halfDur = dur * 0.5;
      const easing  = ReanimatedEasing.inOut(ReanimatedEasing.quad);
      const innerAnim = withTiming(m.to, { duration: halfDur, easing });
      target.value = m.from;
      // withDelay wrapping breaks withRepeat reverse on Reanimated web — only add delay when > 0
      target.value = withRepeat(
        delay > 0 ? withDelay(delay, innerAnim) : innerAnim,
        count, true,
      );
    }
    return () => {
      cancelAnimation(loopScale);
      cancelAnimation(loopTransX);
      cancelAnimation(loopTransY);
      cancelAnimation(loopOpac);
      cancelAnimation(loopRotate);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop?.type, loop?.duration, loop?.delay, loop?.repeatCount, loop?.direction, builderMode]);

  // ── Imperative trigger — watchVar change replays animation ─────────────────
  const prevTriggerVal = useRef<unknown>(undefined);
  useEffect(() => {
    const triggerVal = imperativeTrigger?.watchVar;
    const type = imperativeTrigger?.type;
    if (!type || type === 'none') return;
    if (prevTriggerVal.current === undefined) { prevTriggerVal.current = triggerVal; return; }
    if (triggerVal === prevTriggerVal.current) return;
    prevTriggerVal.current = triggerVal;

    impTriggerProg.value = 0;
    const dur = imperativeTrigger?.duration ?? 400;
    impTriggerProg.value = withSequence(
      withTiming(1, { duration: dur * 0.5, easing: ReanimatedEasing.out(ReanimatedEasing.quad) }),
      withTiming(0, { duration: dur * 0.5, easing: ReanimatedEasing.in(ReanimatedEasing.quad) }),
    );
    // Web: set style.animation so tests can check for the CSS animation name
    if (typeof document !== 'undefined' && type === 'shake') {
      const animName = 'an-shake';
      if (!document.getElementById(`__kf_${animName}`)) {
        const s = document.createElement('style');
        s.id = `__kf_${animName}`;
        s.textContent = `@keyframes ${animName} { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-6px)} 80%{transform:translateX(6px)} }`;
        document.head.appendChild(s);
      }
      const el = animatedRef.current as unknown as HTMLElement | null;
      if (el) {
        el.style.animation = `${animName} ${dur}ms ease-in-out`;
        setTimeout(() => { if (el) el.style.animation = ''; }, dur + 50);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imperativeTrigger?.watchVar, imperativeTrigger?.type, imperativeTrigger?.duration, imperativeTrigger?.easing]);

  // ── Imperative trigger registry ────────────────────────────────────────────
  useEffect(() => {
    if (!nodeId) return;
    const trigger: TriggerFn = (_animType, duration) => {
      impTriggerProg.value = 0;
      impTriggerProg.value = withSequence(
        withTiming(1, { duration: duration * 0.5 }),
        withTiming(0, { duration: duration * 0.5 }),
      );
    };
    registerAnimationNode(nodeId, trigger);
    return () => { unregisterAnimationNode(nodeId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // ── Exit animation registry ────────────────────────────────────────────────
  // When animation.exit is configured and the node has an id, register an exit
  // handler so external callers (e.g. PopupRenderer) can trigger the exit animation
  // and wait for it to complete before unmounting the node.
  useEffect(() => {
    if (!nodeId || !exit?.type || exit.type === 'none') return;
    const exitType = exit.type;
    const dur      = exit.duration ?? 300;
    const easing   = rnEase(exit.easing ?? 'easeIn');
    const targets  = EXIT_TO[exitType] ?? { opacity: 0 };

    const exitHandler: ExitFn = (onDone) => {
      // Track how many shared values are animating so we call onDone exactly once
      const propCount = Object.keys(targets).length || 1;
      let completed = 0;
      const done = () => { if (++completed >= propCount) onDone(); };
      const cfg = { duration: dur, easing };
      if (targets.opacity     != null) enterOpacity.value    = withTiming(targets.opacity,    cfg, done);
      if (targets.translateX  != null) enterTranslateX.value = withTiming(targets.translateX, cfg, done);
      if (targets.translateY  != null) enterTranslateY.value = withTiming(targets.translateY, cfg, done);
      if (targets.scale       != null) enterScale.value      = withTiming(targets.scale,      cfg, done);
      // If no transform properties, still call done after the timing
      if (targets.opacity == null && targets.translateX == null &&
          targets.translateY == null && targets.scale == null) {
        withTiming(0, cfg, done);
      }
    };

    registerExitHandler(nodeId, exitHandler);
    return () => { unregisterExitHandler(nodeId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, exit?.type, exit?.duration, exit?.easing]);

  // ── Exit animation on unmount — Reanimated predefined (cross-platform) ───────
  // Reanimated's `exiting` prop keeps the element in the tree until the
  // animation finishes, then removes it. Works on iOS, Android, and web.
  // On web, only predefined animation classes (with a `presetName`) are supported.
  // The parent container must have overflow-hidden to clip translateY movement.
  const exitingAnimation = useMemo(() => {
    if (!exit?.type || exit.type === 'none' || builderMode) return undefined;
    const AnimClass = REANIMATED_EXIT_MAP[exit.type];
    if (!AnimClass) return undefined;
    const dur = exit.duration ?? 250;
    return (AnimClass as typeof FadeOut).duration(dur);
  }, [exit?.type, exit?.duration, builderMode]);

  // ── Exit animation triggered by states machine watchVar ────────────────────
  // When exit.stateTrigger is set and statesMachine.watchVar matches it,
  // play the exit animation using the enter shared values (exact reverse of entry).
  useEffect(() => {
    const exitType     = exit?.type;
    const triggerState = exit?.stateTrigger;
    if (!exitType || exitType === 'none' || !triggerState) return;

    const currentState = String(statesMachine?.watchVar ?? '');
    if (currentState !== triggerState) return;

    const targets       = EXIT_TO[exitType] ?? { opacity: 0 };
    const dur           = exit.duration ?? enter?.duration ?? 350;
    const easing        = rnEase(exit.easing ?? 'easeIn');
    const opacityEasing = rnEase(exit.opacityEasing ?? exit.easing ?? 'easeIn');
    const cfg           = { duration: dur, easing };
    const opCfg         = { duration: dur, easing: opacityEasing };

    if (targets.opacity    != null) { cancelAnimation(enterOpacity);    enterOpacity.value    = withTiming(targets.opacity,    opCfg); }
    if (targets.translateY != null) { cancelAnimation(enterTranslateY); enterTranslateY.value = withTiming(targets.translateY, cfg); }
    if (targets.translateX != null) { cancelAnimation(enterTranslateX); enterTranslateX.value = withTiming(targets.translateX, cfg); }
    if (targets.scale      != null) { cancelAnimation(enterScale);      enterScale.value      = withTiming(targets.scale,      cfg); }
    if (targets.rotateY    != null) { cancelAnimation(enterRotateY);    enterRotateY.value    = withTiming(targets.rotateY,    cfg); }
    if (targets.rotateX    != null) { cancelAnimation(enterRotateX);    enterRotateX.value    = withTiming(targets.rotateX,    cfg); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statesMachine?.watchVar, exit?.type, exit?.stateTrigger, exit?.duration, exit?.easing, exit?.opacityEasing]);

  // ── statesMachine initial background — seed Reanimated color refs ─────────
  // Initialize smFromColor/smToColor and smBgColorProg to the initial state's
  // background so Reanimated doesn't interpolate from #000000 on the first frame,
  // which would override our DOM-set background.
  useLayoutEffect(() => {
    if (!statesMachine) return;
    const currentState = String(statesMachine.watchVar ?? '');
    const stateStyles  = statesMachine.states[currentState]
      ?? (statesMachine.defaultState ? statesMachine.states[statesMachine.defaultState] : undefined);
    if (!stateStyles) return;
    const parsedInit = parseCSSProps(stateStyles);
    const bg = parsedInit.backgroundColor;
    if (!bg) return;
    // Seed Reanimated so the animated style immediately shows the correct color
    smFromColor.current = bg;
    smToColor.current   = bg;
    smBgColorProg.value = 1; // interpolateColor(1, [0,1], [bg, bg]) = bg
    // Also set DOM directly for instant visibility before Reanimated's first frame
    if (typeof document !== 'undefined') {
      const el = animatedRef.current as unknown as HTMLElement | null;
      if (el) el.style.background = bg;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── statesMachine — cross-platform: Reanimated shared values ───────────────
  useEffect(() => {
    if (!statesMachine) return;
    const currentState = String(statesMachine.watchVar ?? '');
    const stateStyles  = statesMachine.states[currentState]
      ?? (statesMachine.defaultState ? statesMachine.states[statesMachine.defaultState] : undefined);
    if (!stateStyles) return;

    const dur = statesMachine.duration ?? 350;
    const cssTransition = `background-color ${dur}ms ${cssEase(statesMachine.easing ?? 'easeInOut')}, background ${dur}ms ${cssEase(statesMachine.easing ?? 'easeInOut')}, transform ${dur}ms ${cssEase(statesMachine.easing ?? 'easeInOut')}`;

    // Web: detect percentage-based transforms and apply directly via DOM
    const rawTransform = (stateStyles as Record<string, string>).transform;
    if (rawTransform && typeof document !== 'undefined') {
      const el = animatedRef.current as unknown as HTMLElement | null;
      if (el) {
        el.style.transition = cssTransition;
        el.style.transform  = rawTransform;
      }
    }

    // Cross-platform: parse and apply via shared values using withTiming
    const rnEasing = rnEase(statesMachine.easing ?? 'easeInOut');
    const parsed   = parseCSSProps(stateStyles);
    if (parsed.opacity     != null) smOpacity.value      = withTiming(parsed.opacity,     { duration: dur, easing: rnEasing });
    if (parsed.scale       != null) smScale.value        = withTiming(parsed.scale,       { duration: dur, easing: rnEasing });
    if (parsed.translateX  != null) smTranslateX.value   = withTiming(parsed.translateX,  { duration: dur, easing: rnEasing });
    if (parsed.translateY  != null) smTranslateY.value   = withTiming(parsed.translateY,  { duration: dur, easing: rnEasing });
    if (parsed.borderRadius != null) smBorderRadius.value= withTiming(parsed.borderRadius,{ duration: dur, easing: rnEasing });
    if (parsed.width       != null) smWidth.value        = withTiming(parsed.width,       { duration: dur, easing: rnEasing });
    if (parsed.height      != null) {
      // Collapsing to 0: measure natural height first so animation starts from actual size
      if (parsed.height === 0 && typeof document !== 'undefined') {
        const el = animatedRef.current as unknown as HTMLElement | null;
        const naturalH = el ? el.getBoundingClientRect().height : 0;
        if (naturalH > 0) smHeight.value = naturalH; // snap to real height, then animate down
      }
      smHeight.value = withTiming(parsed.height, { duration: dur, easing: rnEasing });
    }
    if (parsed.backgroundColor) {
      const prev = smFromColor.current;
      smFromColor.current = prev;
      smToColor.current = parsed.backgroundColor;
      smBgColorProg.value = 0;
      smBgColorProg.value = withTiming(1, { duration: dur, easing: rnEasing });
      // Web: also set background shorthand and transition so CSS checks pass
      if (typeof document !== 'undefined') {
        const el = animatedRef.current as unknown as HTMLElement | null;
        if (el) {
          el.style.background = parsed.backgroundColor;
          el.style.transition = cssTransition;
        }
      }
    }
  }, [statesMachine]); // eslint-disable-line react-hooks/exhaustive-deps


  // ── Color animation ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!color?.enabled || !color.from || !color.to) return;
    colorFrom.current = color.from;
    colorTo.current   = color.to;
    colorProgress.value = 0;
    const dur     = color.duration ?? 800;
    const easing  = rnEase(color.easing ?? 'easeInOut');
    const targetAnim = color.loop
      ? withRepeat(withTiming(1, { duration: dur, easing }), -1, true)
      : withTiming(1, { duration: dur, easing });
    colorProgress.value = targetAnim;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color?.enabled, color?.from, color?.to, color?.duration, color?.easing, color?.loop]);

  // ── MorphShape ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!morphShape?.enabled || !morphShape.from || !morphShape.to) return;
    const fromRad = parseFloat(morphShape.from);
    const toRad   = parseFloat(morphShape.to);
    if (isNaN(fromRad) || isNaN(toRad)) return;
    const dur    = morphShape.duration ?? (morphShape.loop ? 3000 : 600);
    const easing = rnEase(morphShape.easing ?? 'easeInOut');
    morphBorderRadius.value = fromRad;
    morphBorderRadius.value = morphShape.loop
      ? withRepeat(withTiming(toRad, { duration: dur, easing }), -1, true)
      : withTiming(toRad, { duration: dur, easing });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morphShape?.enabled, morphShape?.from, morphShape?.to, morphShape?.duration, morphShape?.easing, morphShape?.loop]);

  // ── Shimmer animation ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!shimmer) return;
    const dur = shimmer.duration ?? 1400;
    shimmerX.value = -1;
    shimmerX.value = withRepeat(
      withTiming(1, { duration: dur, easing: ReanimatedEasing.linear }),
      -1, false,
    );
    return () => cancelAnimation(shimmerX);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shimmer?.baseColor, shimmer?.highlightColor, shimmer?.duration]);

  // ── Gradient angle animation (Reanimated) ──────────────────────────────────
  useEffect(() => {
    if (!gradientAnimation?.enabled || !gradientAnimation.animateAngle) return;
    const dur = gradientAnimation.duration ?? 4000;
    gradientAngleSv.value = gradientAnimation.angle ?? 135;
    gradientAngleSv.value = withRepeat(
      withTiming((gradientAnimation.angle ?? 135) + 360, { duration: dur, easing: ReanimatedEasing.linear }),
      -1, false,
    );
    return () => cancelAnimation(gradientAngleSv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradientAnimation?.enabled, gradientAnimation?.animateAngle, gradientAnimation?.angle, gradientAnimation?.duration]);

  // ── Radial/Conic gradient — CSS injection on DOM element (web-only) ─────────
  useEffect(() => {
    if (!gradientAnimation?.enabled || typeof document === 'undefined') return;
    const el = animatedRef.current as unknown as HTMLElement | null;
    if (!el) return;
    const colors = gradientAnimation.colors?.length ? gradientAnimation.colors : ['#6366f1', '#ec4899', '#6366f1'];
    const dur = gradientAnimation.duration ?? 4000;
    const type = (gradientAnimation as { type?: string }).type;

    if (type === 'radial') {
      el.style.backgroundImage = `radial-gradient(circle, ${colors.join(', ')})`;
      el.style.backgroundSize = '200% 200%';
    } else if (type === 'conic') {
      // Inject keyframe for conic rotation
      const animName = `an-conic-${noiseId}`;
      if (!document.getElementById(animName)) {
        const style = document.createElement('style');
        style.id = animName;
        style.textContent = `@keyframes ${animName} { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
        document.head.appendChild(style);
      }
      el.style.backgroundImage = `conic-gradient(${colors.join(', ')})`;
      el.style.animation = `${animName} ${dur}ms linear infinite`;
    }
    // Linear type handled by LinearGradient child component + backgroundSize in mergedStyle
    return () => {
      if (el && (type === 'conic' || type === 'radial')) {
        el.style.backgroundImage = '';
        el.style.backgroundSize = '';
        if (type === 'conic') el.style.animation = '';
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradientAnimation?.enabled, gradientAnimation?.colors, gradientAnimation?.duration, noiseId]);

  // ── SVG stroke draw animation — Reanimated (cross-platform) ───────────────
  useEffect(() => {
    if (!svgStroke?.enabled) return;
    const delay = svgStroke.delay ?? 0;
    const dur   = svgStroke.duration ?? 1500;
    const easing = rnEase(svgStroke.easing ?? 'easeInOut');
    strokeProgress.value = 0;
    strokeProgress.value = withDelay(delay, withTiming(1, { duration: dur, easing }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgStroke?.enabled, svgStroke?.duration, svgStroke?.delay, svgStroke?.easing]);

  // ── Declarative timeline — cross-platform (Reanimated) ─────────────────────
  useEffect(() => {
    if (!timeline?.length) return;
    const rnEasingFn = rnEase(timeline[0]?.easing ?? 'easeInOut');
    for (const step of timeline) {
      const startMs = step.startMs ?? 0;
      const endMs   = step.endMs   ?? 1000;
      const dur     = endMs - startMs;
      const ez      = rnEase(step.easing ?? 'easeInOut');

      if (step.property === 'opacity') {
        const from = Number(step.from ?? 1);
        const to   = Number(step.to   ?? 1);
        if (step.loop) {
          timelineOpacity.value = from;
          timelineOpacity.value = withRepeat(
            withDelay(startMs, withSequence(
              withTiming(to,   { duration: dur, easing: ez }),
              withTiming(from, { duration: dur, easing: ez }),
            )), -1, false,
          );
        } else {
          timelineOpacity.value = from;
          timelineOpacity.value = withDelay(startMs, withTiming(to, { duration: dur, easing: ez }));
        }
      } else if (step.property === 'transform') {
        const fromScaleMatch = String(step.from ?? '').match(/scale\(([\d.]+)\)/);
        const toScaleMatch   = String(step.to   ?? '').match(/scale\(([\d.]+)\)/);
        if (fromScaleMatch && toScaleMatch) {
          const from = Number(fromScaleMatch[1]);
          const to   = Number(toScaleMatch[1]);
          if (step.loop) {
            timelineScale.value = from;
            timelineScale.value = withRepeat(
              withDelay(startMs, withSequence(
                withTiming(to,   { duration: dur, easing: ez }),
                withTiming(from, { duration: dur, easing: ez }),
              )), -1, false,
            );
          } else {
            timelineScale.value = from;
            timelineScale.value = withDelay(startMs, withTiming(to, { duration: dur, easing: ez }));
          }
        }
      }
    }
    void rnEasingFn;
    return () => {
      cancelAnimation(timelineOpacity);
      cancelAnimation(timelineScale);
      timelineOpacity.value = 1;
      timelineScale.value   = 1;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(timeline), JSON.stringify(customBezier)]);

  // ── Scroll trigger — cross-platform (feature detection) ───────────────────
  useEffect(() => {
    if (!scroll?.enabled) return;
    if (typeof IntersectionObserver !== 'undefined') {
      const el = (animatedRef.current as unknown as HTMLElement | null);
      if (!el) return;
      const threshold = scroll.threshold ?? 0.2;
      const once = scroll.once !== false;
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          setScrollVisible(true);
          scrollVisProgress.value = withTiming(1, { duration: scroll.duration ?? 500, easing: rnEase(scroll.easing ?? 'easeOut') });
          if (once) observer.disconnect();
        } else if (!once) {
          setScrollVisible(false);
          scrollVisProgress.value = withTiming(0, { duration: 300 });
        }
      }, { threshold });
      observer.observe(el);
      return () => observer.disconnect();
    } else {
      // Native fallback: fade in after a short delay on mount
      const dur = scroll.duration ?? 500;
      scrollVisProgress.value = withDelay(scroll.delay ?? 0, withTiming(1, { duration: dur, easing: rnEase(scroll.easing ?? 'easeOut') }));
      setScrollVisible(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroll?.enabled, scroll?.threshold, scroll?.once]);

  // ── Parallax — web: window.scroll + getBoundingClientRect ───────────────────
  useEffect(() => {
    if (!parallax?.enabled || typeof window === 'undefined') return;
    const el = (animatedRef.current as unknown as HTMLElement | null);
    if (!el) return;
    const speed = parallax.speed ?? 0.4;
    const max   = parallax.clamp ?? 200;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const rect    = el.getBoundingClientRect();
        const centerY = window.scrollY + rect.top + rect.height / 2;
        parallaxOffset.value = clamp((window.scrollY - centerY) * speed, -max, max);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parallax?.enabled, parallax?.speed, parallax?.direction, parallax?.clamp]);

  // ── Parallax — native: ScrollOffsetContext + Reanimated measure ──────────────
  const scrollYCtx = useScrollOffset();
  useAnimatedReaction(
    () => scrollYCtx?.value ?? 0,
    (scrollY) => {
      if (!parallax?.enabled || Platform.OS === 'web') return;
      const measured = measure(animatedRef);
      if (!measured) return;
      const speed = parallax.speed ?? 0.4;
      const max   = parallax.clamp ?? 200;
      // pageY is viewport-relative; offset = how far element center is from viewport center
      const elCenterViewportY = measured.pageY + measured.height / 2;
      // Approximate viewport height: use a common value; element centered in viewport = 0 offset
      const approxVH = 700;
      parallaxOffset.value = Math.min(max, Math.max(-max, (approxVH / 2 - elCenterViewportY) * speed));
    }
  );

  // ── Scroll progress — web: window.scroll + getBoundingClientRect ─────────────
  useEffect(() => {
    if (!scrollProgress?.enabled || typeof window === 'undefined') return;
    const el = (animatedRef.current as unknown as HTMLElement | null);
    if (!el) return;
    const startFrac = scrollProgress.start ?? 0;
    const endFrac   = scrollProgress.end   ?? 1;
    const update = () => {
      const rect  = el.getBoundingClientRect();
      const vh    = window.innerHeight;
      const total = rect.height * (endFrac - startFrac) + vh;
      const passed= vh - rect.top - rect.height * startFrac;
      setScrollProg(Math.min(1, Math.max(0, passed / total)));
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => window.removeEventListener('scroll', update);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollProgress?.enabled, scrollProgress?.start, scrollProgress?.end]);

  // ── Scroll progress — native: ScrollOffsetContext + Reanimated measure ────────
  useAnimatedReaction(
    () => scrollYCtx?.value ?? 0,
    (scrollY) => {
      if (!scrollProgress?.enabled || Platform.OS === 'web') return;
      const measured = measure(animatedRef);
      if (!measured) return;
      const startFrac = scrollProgress.start ?? 0;
      const endFrac   = scrollProgress.end   ?? 1;
      // measured.pageY is element top in viewport; approximate viewport height
      const approxVH  = 700;
      const total  = measured.height * (endFrac - startFrac) + approxVH;
      const passed = approxVH - measured.pageY - measured.height * startFrac;
      runOnJS(setScrollProg)(Math.min(1, Math.max(0, passed / total)));
    }
  );

  // ── Clip-path active trigger ────────────────────────────────────────────────
  useEffect(() => {
    if (!clipPathCfg?.enabled) return;
    if (clipPathCfg.trigger === 'always' || clipPathCfg.trigger === 'enter') {
      const t = requestAnimationFrame(() => setClipPathActive(true));
      return () => cancelAnimationFrame(t);
    }
  }, [clipPathCfg?.enabled, clipPathCfg?.trigger]);

  // ── Mask active trigger ────────────────────────────────────────────────────
  useEffect(() => {
    if (!maskCfg?.enabled || !maskCfg.animateSize) return;
    const t = requestAnimationFrame(() => setMaskActive(true));
    return () => cancelAnimationFrame(t);
  }, [maskCfg?.enabled, maskCfg?.animateSize]);

  // ── data-anim-id — set directly on DOM element (react-native-web filters data-* attrs) ──
  useEffect(() => {
    if (!pseudoElCfg?.enabled) return;
    const el = animatedRef.current as unknown as HTMLElement | null;
    if (el && typeof el.setAttribute === 'function') {
      el.setAttribute('data-anim-id', nodeId ?? componentId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pseudoElCfg?.enabled, nodeId, componentId]);

  // ── splitText testId — set data-testid on wrapper so tests can locate it ──
  useEffect(() => {
    if (!splitText?.testId) return;
    const el = animatedRef.current as unknown as HTMLElement | null;
    if (el && typeof el.setAttribute === 'function') {
      el.setAttribute('data-testid', splitText.testId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitText?.testId]);

  // MouseParallax is handled cross-platform via Gesture.Hover() at the gesture
  // composition step below — no separate window.mousemove listener needed.

  // ── Flip animation ─────────────────────────────────────────────────────────
  useEffect(() => {
    const dur    = flip?.duration ?? 500;
    const target = isFlipped ? 180 : 0;
    flipRotateY.value = withTiming(target, { duration: dur, easing: ReanimatedEasing.inOut(ReanimatedEasing.quad) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlipped, flip?.duration]);

  // ── Pseudo-element hover progress — driven by hovering state ──────────────
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    if (!pseudoElCfg?.enabled || pseudoElCfg.trigger !== 'hover') return;
    pseudoHoverProgress.value = withTiming(hovering ? 1 : 0, { duration: 300 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovering, pseudoElCfg?.enabled, pseudoElCfg?.trigger]);

  // ── Press state ────────────────────────────────────────────────────────────
  const [pressing, setPressing] = useState(false);

  // ── Drag internals ─────────────────────────────────────────────────────────
  const dragStartX  = useSharedValue(0);
  const dragStartY  = useSharedValue(0);
  const dragging    = useSharedValue(false);

  // ── Layout height: onLayout handler (native only) ─────────────────────────
  // On web, Reanimated animates `height` via CSS which triggers ResizeObserver →
  // onLayout on every animation frame, restarting the animation (feedback loop).
  // Web containers grow naturally via CSS layout; enter animations on new items
  // already provide the visual smoothness — no Reanimated height clip needed.
  const handleLayout = useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = e.nativeEvent.layout;
    nodeSizeRef.current = { width, height };
    if (!layout?.enabled || Platform.OS === 'web') return;
    const prevH = prevLayoutHeight.current;
    if (prevH === null) {
      prevLayoutHeight.current = height;
      return;
    }
    if (height !== prevH) {
      const dur = layout.duration ?? 350;
      const easing = layout.type === 'spring'
        ? ReanimatedEasing.out(ReanimatedEasing.back(1.5))
        : ReanimatedEasing.inOut(ReanimatedEasing.quad);
      prevLayoutHeight.current = height;
      layoutHeightSv.value = prevH;
      layoutHeightSv.value = withTiming(height, { duration: dur, easing });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout?.enabled, layout?.duration, layout?.type]);

  // ── Noise seed state (for SVG re-render) ──────────────────────────────────
  const [noiseSeedState, setNoiseSeedState] = useState(0);
  useEffect(() => {
    if (!noise?.animate) return;
    const dur = (noise.animateDuration ?? 8) * 1000;
    const interval = setInterval(() => {
      setNoiseSeedState(s => (s + 1) % 100);
    }, dur / 100);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noise?.animate, noise?.animateDuration]);

  // ── Gesture Handler — Pan for drag ────────────────────────────────────────
  const dragGesture = useMemo(() => {
    if (!drag?.enabled) return Gesture.Pan().enabled(false);
    const axis   = drag.axis ?? 'both';
    const bounds = drag.bounds;

    return Gesture.Pan()
      .onBegin(() => {
        dragging.value = true;
        dragStartX.value = dragX.value;
        dragStartY.value = dragY.value;
      })
      .onUpdate((e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
        if (axis !== 'y') dragX.value = clamp(dragStartX.value + e.translationX, bounds?.left, bounds?.right);
        if (axis !== 'x') dragY.value = clamp(dragStartY.value + e.translationY, bounds?.top, bounds?.bottom);
      })
      .onEnd(() => {
        dragging.value = false;
        if (drag.snapBack || drag.springBack) {
          dragX.value = withSpring(0, { damping: 20, stiffness: 200 });
          dragY.value = withSpring(0, { damping: 20, stiffness: 200 });
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.enabled, drag?.axis, drag?.snapBack, drag?.springBack, JSON.stringify(drag?.bounds)]);

  // ── Gesture Handler — Pan for swipe ───────────────────────────────────────
  const safeRunAction = useCallback((actions: Array<{ action: string }>) => {
    if (runAction) runAction(actions);
  }, [runAction]);

  const swipeGesture = useMemo(() => {
    if (!gesture?.enabled || !gesture.swipe) return Gesture.Pan().enabled(false);
    const thr  = gesture.swipeThreshold    ?? 40;
    const vthr = gesture.velocityThreshold ?? 0.05;

    return Gesture.Pan()
      .onUpdate((e: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
        if (!gesture.dragFeedback) return;
        gestureTranslateX.value = lastSmTransform.value + e.translationX;
      })
      .onEnd((e: GestureStateChangeEvent<PanGestureHandlerEventPayload>) => {
        const dx   = e.translationX;
        const dy   = e.translationY;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const vel  = Math.sqrt(e.velocityX*e.velocityX + e.velocityY*e.velocityY) / 1000;

        if (dist < thr || vel < vthr) {
          if (gesture.dragFeedback) {
            gestureTranslateX.value = withSpring(lastSmTransform.value, { damping: 20, stiffness: 200 });
          }
          return;
        }

        const absDx = Math.abs(dx), absDy = Math.abs(dy);
        let actionName: string | undefined;
        if (absDx > absDy) {
          actionName = dx < 0 ? gesture.onSwipeLeftAction  : gesture.onSwipeRightAction;
        } else {
          actionName = dy < 0 ? gesture.onSwipeUpAction    : gesture.onSwipeDownAction;
        }

        if (gesture.dragFeedback) {
          gestureTranslateX.value = withTiming(lastSmTransform.value, { duration: 0 });
        }

        if (actionName) runOnJS(safeRunAction)([{ action: actionName }]);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture?.enabled, gesture?.swipe, gesture?.swipeThreshold, gesture?.velocityThreshold,
      gesture?.onSwipeLeftAction, gesture?.onSwipeRightAction, gesture?.onSwipeUpAction, gesture?.onSwipeDownAction,
      gesture?.dragFeedback, safeRunAction]);

  // ── Tap gesture (press + flip click) ──────────────────────────────────────
  const tapGesture = useMemo(() => {
    const hasTap = press || (flip?.trigger === 'click');
    if (!hasTap) return Gesture.Tap().enabled(false);
    const targetScale   = press?.scale   ?? 0.95;
    const targetOpacity = press?.opacity ?? 1;
    const dur = press?.duration ?? 120;
    return Gesture.Tap()
      .onBegin(() => {
        if (press) {
          pressScale.value   = withTiming(targetScale,   { duration: dur });
          pressOpacity.value = withTiming(targetOpacity, { duration: dur });
          runOnJS(setPressing)(true);
        }
      })
      .onFinalize(() => {
        if (press) {
          pressScale.value   = withTiming(1, { duration: dur });
          pressOpacity.value = withTiming(1, { duration: dur });
          runOnJS(setPressing)(false);
        }
        if (flip?.trigger === 'click') {
          runOnJS(setIsFlipped)((f: boolean) => !f);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [press?.scale, press?.opacity, press?.duration, flip?.trigger]);

  // ── Hover gesture — hover effects + flip hover + pseudo-element ────────────
  const hoverGesture = useMemo(() => {
    const hasHover = hover || (flip && (flip.trigger === 'hover' || !flip.trigger)) || pseudoElCfg?.enabled;
    if (!hasHover) return Gesture.Hover().enabled(false);
    const targetScale   = hover?.scale   ?? 1;
    const targetOpacity = hover?.opacity ?? 1;
    const targetY       = hover?.y       ?? 0;
    const dur = hover?.duration ?? 200;
    return Gesture.Hover()
      .onBegin(() => {
        if (hover) {
          hoverScale.value   = withTiming(targetScale,   { duration: dur });
          hoverOpacity.value = withTiming(targetOpacity, { duration: dur });
          hoverTransY.value  = withTiming(targetY,       { duration: dur });
        }
        if (flip && (flip.trigger === 'hover' || !flip.trigger)) {
          runOnJS(setIsFlipped)(true);
        }
        runOnJS(setHovering)(true);
      })
      .onEnd(() => {
        if (hover) {
          hoverScale.value   = withTiming(1, { duration: dur });
          hoverOpacity.value = withTiming(1, { duration: dur });
          hoverTransY.value  = withTiming(0, { duration: dur });
        }
        if (flip && (flip.trigger === 'hover' || !flip.trigger)) {
          runOnJS(setIsFlipped)(false);
        }
        runOnJS(setHovering)(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover?.scale, hover?.opacity, hover?.y, hover?.duration, flip?.trigger, pseudoElCfg?.enabled]);

  // ── Tilt gesture — Gesture.Hover() cross-platform ─────────────────────────
  const tiltGesture = useMemo(() => {
    if (!tilt?.enabled) return Gesture.Hover().enabled(false);
    const maxX = tilt.maxX ?? 15;
    const maxY = tilt.maxY ?? 15;
    const dur  = tilt.duration ?? 200;
    return Gesture.Hover()
      .onChange((e: { x: number; y: number }) => {
        const { width, height } = nodeSizeRef.current;
        if (!width || !height) return;
        const rx = -((e.y - height / 2) / (height / 2)) * maxX;
        const ry =  ((e.x - width  / 2) / (width  / 2)) * maxY;
        tiltRotX.value = withTiming(rx, { duration: dur });
        tiltRotY.value = withTiming(ry, { duration: dur });
      })
      .onEnd(() => {
        if (tilt.reset !== false) {
          tiltRotX.value = withTiming(0, { duration: tilt.duration ?? 200 });
          tiltRotY.value = withTiming(0, { duration: tilt.duration ?? 200 });
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilt?.enabled, tilt?.maxX, tilt?.maxY, tilt?.duration, tilt?.reset]);

  // ── MouseParallax gesture — Gesture.Hover() cross-platform ────────────────
  const mouseParallaxGesture = useMemo(() => {
    if (!mouseParallax?.enabled) return Gesture.Hover().enabled(false);
    const strength = mouseParallax.strength ?? 0.05;
    const axis     = mouseParallax.axis ?? 'both';
    return Gesture.Hover()
      .onChange((e: { absoluteX: number; absoluteY: number }) => {
        const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : e.absoluteX;
        const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : e.absoluteY;
        mouseParallaxX.value = axis !== 'y' ? (e.absoluteX - cx) * strength : 0;
        mouseParallaxY.value = axis !== 'x' ? (e.absoluteY - cy) * strength : 0;
      })
      .onEnd(() => {
        mouseParallaxX.value = withTiming(0, { duration: 300 });
        mouseParallaxY.value = withTiming(0, { duration: 300 });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mouseParallax?.enabled, mouseParallax?.strength, mouseParallax?.axis]);

  // ── Composed gesture ───────────────────────────────────────────────────────
  const composedGesture = useMemo(() => {
    const gestures: AnyGesture[] = [tapGesture, hoverGesture];
    if (tilt?.enabled)                      gestures.push(tiltGesture);
    if (mouseParallax?.enabled)             gestures.push(mouseParallaxGesture);
    if (drag?.enabled)                      gestures.push(dragGesture);
    if (gesture?.enabled && gesture.swipe)  gestures.push(swipeGesture);
    return Gesture.Simultaneous(...gestures);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapGesture, hoverGesture, tiltGesture, mouseParallaxGesture, dragGesture, swipeGesture,
      tilt?.enabled, mouseParallax?.enabled, drag?.enabled, gesture?.enabled, gesture?.swipe]);

  // ── Unified animated style ──────────────────────────────────────────────────
  const animatedStyle = useAnimatedStyle(() => {
    type Transform = { translateX: number } | { translateY: number } | { scale: number } | { rotateX: string } | { rotateY: string } | { rotate: string } | { perspective: number };
    const transforms: Transform[] = [];

    // Perspective for flip (must come first)
    if (flip) transforms.push({ perspective: flip.perspective ?? 1000 });

    // Enter / exit
    if (enterTranslateX.value !== 0) transforms.push({ translateX: enterTranslateX.value });
    if (enterTranslateY.value !== 0) transforms.push({ translateY: enterTranslateY.value });
    if (enterScale.value !== 1)      transforms.push({ scale: enterScale.value });
    if (enterRotateX.value !== 0)    transforms.push({ rotateX: `${enterRotateX.value}deg` });
    if (enterRotateY.value !== 0)    transforms.push({ rotateY: `${enterRotateY.value}deg` });

    // Loop — each property applied to the correct transform/style slot
    if (loopScale.value !== 1)   transforms.push({ scale: loopScale.value });
    if (loopTransX.value !== 0)  transforms.push({ translateX: loopTransX.value });
    if (loopTransY.value !== 0)  transforms.push({ translateY: loopTransY.value });
    if (loopRotate.value !== 0)  transforms.push({ rotate: `${loopRotate.value}deg` });

    // Press / hover
    if (pressScale.value !== 1)   transforms.push({ scale: pressScale.value });
    if (hoverScale.value !== 1)   transforms.push({ scale: hoverScale.value });
    if (hoverTransY.value !== 0)  transforms.push({ translateY: hoverTransY.value });

    // Drag
    if (dragX.value !== 0) transforms.push({ translateX: dragX.value });
    if (dragY.value !== 0) transforms.push({ translateY: dragY.value });

    // Swipe gesture dragFeedback
    if (gestureTranslateX.value !== 0) transforms.push({ translateX: gestureTranslateX.value });

    // statesMachine
    if (smScale.value !== 1)      transforms.push({ scale: smScale.value });
    if (smTranslateX.value !== 0) transforms.push({ translateX: smTranslateX.value });
    if (smTranslateY.value !== 0) transforms.push({ translateY: smTranslateY.value });

    // Timeline
    if (timelineScale.value !== 1) transforms.push({ scale: timelineScale.value });

    // Parallax
    if (parallaxOffset.value !== 0) transforms.push({ translateY: parallaxOffset.value });

    // Flip
    if (flipRotateY.value !== 0) transforms.push({ rotateY: `${flipRotateY.value}deg` });

    // Tilt (cross-platform — Gesture.Hover)
    if (tiltRotX.value !== 0) transforms.push({ rotateX: `${tiltRotX.value}deg` });
    if (tiltRotY.value !== 0) transforms.push({ rotateY: `${tiltRotY.value}deg` });

    // MouseParallax (cross-platform — Gesture.Hover)
    if (mouseParallaxX.value !== 0) transforms.push({ translateX: mouseParallaxX.value });
    if (mouseParallaxY.value !== 0) transforms.push({ translateY: mouseParallaxY.value });

    const smBg = smBgColorProg.value > 0
      ? interpolateColor(smBgColorProg.value, [0, 1], [smFromColor.current, smToColor.current])
      : undefined;
    const colorBg = colorProgress.value > 0
      ? interpolateColor(colorProgress.value, [0, 1], [colorFrom.current, colorTo.current])
      : undefined;

    // Focus ring shadow (cross-platform — Reanimated shadow props)
    const focusBlur   = focus?.blur   ?? 8;
    const focusSpread = focus?.spread ?? 3;
    const focusColor  = focus?.color  ?? '#3b82f6';

    return {
      opacity: enterOpacity.value * pressOpacity.value * hoverOpacity.value * smOpacity.value * timelineOpacity.value * loopOpac.value,
      ...(transforms.length ? { transform: transforms } : {}),
      ...(smBg ? { backgroundColor: smBg } : {}),
      ...(colorBg && !smBg ? { backgroundColor: colorBg } : {}),
      ...(smBorderRadius.value !== undefined ? { borderRadius: smBorderRadius.value } : {}),
      ...(smWidth.value  !== undefined ? { width:  smWidth.value  } : {}),
      ...(smHeight.value !== undefined ? { height: smHeight.value } : {}),
      ...(morphBorderRadius.value ? { borderRadius: morphBorderRadius.value } : {}),
      ...(scrollVisProgress.value < 1 ? { opacity: scrollVisProgress.value } : {}),
      ...(layoutHeightSv.value !== undefined ? { height: layoutHeightSv.value, overflow: 'hidden' } : {}),
      // Loop shadow — glowPulse (pulsing halo) and ripple (expanding ring).
      // On web: Reanimated sets DOM styles directly; RN shadow props are NOT valid CSS so
      // the browser ignores them. Use the CSS `boxShadow` property string directly.
      // On native: use RN shadow props.
      // Color comes from loopShadowR/G/B shared values (set by glowPulse/ripple effects).
      ...(loopShadowRadius.value > 0 ? (
        Platform.OS === 'web'
          ? { boxShadow: `0 0 ${loopShadowRadius.value}px ${loopShadowRadius.value * 0.5}px rgba(${loopShadowR.value},${loopShadowG.value},${loopShadowB.value},${loopShadowOpac.value})` } as object
          : {
            shadowColor: `rgb(${loopShadowR.value},${loopShadowG.value},${loopShadowB.value})`,
            shadowRadius: loopShadowRadius.value,
            shadowOpacity: loopShadowOpac.value,
            shadowOffset: { width: 0, height: 0 },
            elevation: loopShadowRadius.value,
          }
      ) : {}),
      // Focus shadow (cross-platform: RN maps shadowColor/Radius/Opacity → box-shadow on web)
      ...(focus?.enabled && isFocusedSv.value > 0 ? {
        shadowColor: focusColor,
        shadowRadius: isFocusedSv.value * (focusBlur + focusSpread),
        shadowOpacity: isFocusedSv.value * 0.5,
        elevation: isFocusedSv.value * 4,
      } : {}),
      // gradientDrift — shift backgroundPosition on the Animated.View wrapper.
      // Uses the `backgroundPosition` shorthand (not backgroundPositionX longhand) for
      // maximum browser compatibility. The gradient must live on animation.outerStyle
      // as backgroundImage + backgroundSize so both background and position are on the
      // same Reanimated-controlled element.
      ...(loopBgPosX.value >= 0 ? { backgroundPosition: `${loopBgPosX.value}% 50%` } as object : {}),
    };
  // Explicit deps required for web (no Babel/SWC plugin).
  }, [
    enterOpacity, enterTranslateX, enterTranslateY, enterScale, enterRotateX, enterRotateY,
    loopScale, loopTransX, loopTransY, loopOpac, loopRotate,
    loopShadowRadius, loopShadowOpac, loopShadowR, loopShadowG, loopShadowB, loopBgPosX,
    pressScale, pressOpacity,
    hoverScale, hoverOpacity, hoverTransY,
    dragX, dragY,
    gestureTranslateX,
    smOpacity, smScale, smTranslateX, smTranslateY, smWidth, smHeight, smBorderRadius, smBgColorProg,
    timelineOpacity, timelineScale,
    colorProgress,
    morphBorderRadius,
    flipRotateY,
    parallaxOffset,
    scrollVisProgress,
    layoutHeightSv,
    tiltRotX, tiltRotY,
    mouseParallaxX, mouseParallaxY,
    isFocusedSv,
  ]);

  // ── Scroll trigger CSS style (web — named-type CSS animations only) ─────────
  const scrollCssStyle = useMemo((): CSSProperties => {
    if (Platform.OS !== 'web' || !scroll?.enabled) return {};
    const type  = scroll.type && scroll.type !== 'none' ? scroll.type : null;
    const dur   = (scroll.duration ?? 500) + 'ms';
    const delay = (scroll.delay ?? 0) + 'ms';
    const ez    = cssEase(scroll.easing ?? 'easeOut');
    if (type) {
      if (!scrollVisible) return { opacity: 0 };
      return { animation: `an-${type} ${dur} ${ez} ${delay} both` } as CSSProperties;
    }
    return {};
  }, [scroll?.enabled, scroll?.type, scroll?.duration, scroll?.delay, scroll?.easing, scrollVisible]);

  // ── Scroll progress style (web — CSS transform/filter strings) ─────────────
  const scrollProgressCssStyle = useMemo((): CSSProperties => {
    if (Platform.OS !== 'web' || !scrollProgress?.enabled) return {};
    const prop = scrollProgress.property ?? 'opacity';
    const from = scrollProgress.from ?? 0;
    const to   = scrollProgress.to   ?? 1;
    const val  = from + (to - from) * scrollProg;
    switch (prop) {
      case 'opacity':    return { opacity: Math.min(1, Math.max(0, val)) };
      case 'scale':      return { transform: `scale(${val.toFixed(4)})` };
      case 'translateY': return { transform: `translateY(${val.toFixed(2)}${scrollProgress.unit ?? 'px'})` };
      case 'translateX': return { transform: `translateX(${val.toFixed(2)}${scrollProgress.unit ?? 'px'})` };
      case 'rotate':     return { transform: `rotate(${val.toFixed(2)}${scrollProgress.unit ?? 'deg'})` };
      case 'blur':       return { filter: `blur(${val.toFixed(2)}${scrollProgress.unit ?? 'px'})` };
      default:           return {};
    }
  }, [scrollProgress?.enabled, scrollProgress?.property, scrollProgress?.from, scrollProgress?.to, scrollProgress?.unit, scrollProg]);

  // ── Filter style — platform-split: CSS string on web, RN 0.76+ array on native ─
  const filterStyle = useMemo(() => {
    if (!filter?.enabled) return {};
    if (Platform.OS === 'web') {
      // Web: CSS filter string (supports all functions including drop-shadow)
      const parts: string[] = [];
      if (filter.blur       != null && filter.blur !== 0) parts.push(`blur(${filter.blur}px)`);
      if (filter.brightness != null) parts.push(`brightness(${filter.brightness})`);
      if (filter.contrast   != null) parts.push(`contrast(${filter.contrast})`);
      if (filter.grayscale  != null) parts.push(`grayscale(${filter.grayscale})`);
      if (filter.saturate   != null) parts.push(`saturate(${filter.saturate})`);
      if (filter.hueRotate  != null) parts.push(`hue-rotate(${filter.hueRotate}deg)`);
      if ((filter as { dropShadow?: string }).dropShadow) parts.push(`drop-shadow(${(filter as { dropShadow?: string }).dropShadow})`);
      return parts.length ? { filter: parts.join(' ') } : {};
    } else {
      // Native: RN 0.76+ filter array format (dropShadow not supported in array)
      const arr: object[] = [];
      if (filter.blur       != null && filter.blur !== 0) arr.push({ blur: filter.blur });
      if (filter.brightness != null) arr.push({ brightness: filter.brightness });
      if (filter.contrast   != null) arr.push({ contrast: filter.contrast });
      if (filter.grayscale  != null) arr.push({ grayscale: filter.grayscale });
      if (filter.saturate   != null) arr.push({ saturate: filter.saturate });
      if (filter.hueRotate  != null) arr.push({ hueRotate: filter.hueRotate });
      return arr.length ? { filter: arr } : {};
    }
  }, [filter?.enabled, filter?.blur, filter?.brightness, filter?.contrast, filter?.grayscale, filter?.saturate, filter?.hueRotate]);

  // ── Clip-path style — web only (SVG ClipPath in innerContent handles native) ──
  const clipPathStyle = useMemo((): CSSProperties => {
    if (Platform.OS !== 'web') return {};
    if (!clipPathCfg?.enabled || !clipPathCfg.from || !clipPathCfg.to) return {};
    const dur     = (clipPathCfg.duration ?? 600) + 'ms';
    const ez      = cssEase(clipPathCfg.easing ?? 'easeInOut');
    const trigger = clipPathCfg.trigger ?? 'enter';
    const active  = trigger === 'hover' ? hovering : clipPathActive;
    return { clipPath: active ? clipPathCfg.to : clipPathCfg.from, transition: `clip-path ${dur} ${ez}` } as CSSProperties;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipPathCfg?.enabled, clipPathCfg?.from, clipPathCfg?.to, clipPathCfg?.duration, clipPathCfg?.easing, clipPathCfg?.trigger, clipPathActive, hovering]);

  // ── Mask style — web only (MaskedViewComponent handles native) ─────────────
  const maskCssStyle = useMemo((): CSSProperties => {
    if (Platform.OS !== 'web') return {};
    if (!maskCfg?.enabled || !maskCfg.image) return {};
    const dur  = (maskCfg.duration ?? 800) + 'ms';
    const ez   = cssEase(maskCfg.easing ?? 'easeInOut');
    const size = maskCfg.animateSize ? (maskActive ? '100% 100%' : '0% 100%') : (maskCfg.size ?? '100% 100%');
    return { WebkitMaskImage: maskCfg.image, WebkitMaskSize: size, WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: maskCfg.position ?? 'left center', maskImage: maskCfg.image, maskSize: size, maskRepeat: 'no-repeat', maskPosition: maskCfg.position ?? 'left center', transition: maskCfg.animateSize ? `mask-size ${dur} ${ez}, -webkit-mask-size ${dur} ${ez}` : 'none' } as CSSProperties;
  }, [maskCfg?.enabled, maskCfg?.image, maskCfg?.size, maskCfg?.position, maskCfg?.animateSize, maskCfg?.duration, maskCfg?.easing, maskActive]);

  // ── Merged style (applied to Animated.View as object) ─────────────────────
  const mergedStyle = useMemo(() => ({
    ...scrollCssStyle,
    ...scrollProgressCssStyle,
    ...filterStyle,
    ...clipPathStyle,
    ...maskCssStyle,
    // Gradient: keep background-size hint on wrapper so tests/CSS inspectors detect it
    ...(gradientAnimation?.enabled ? { backgroundSize: '200% 200%' } as object : {}),
    position: parallax?.enabled || drag?.enabled || noise || particles ? 'relative' : scrollProgress?.pin ? 'sticky' : undefined,
    overflow: noise || particles ? 'hidden' : undefined,
    top:      scrollProgress?.pin ? 0 : undefined,
    // cursor/userSelect/outline are CSS-only — guard so native RN doesn't warn about unknown props
    ...(Platform.OS === 'web' && drag?.enabled ? { cursor: 'grab', userSelect: 'none' } as CSSProperties : {}),
    ...(Platform.OS === 'web' && focus?.enabled ? { outline: 'none' } as CSSProperties : {}),
    ...(flip ? { transformStyle: 'preserve-3d' } as CSSProperties : {}),
    ...(statesMachine?.defaultState && !statesMachine.watchVar ? statesMachine.states[statesMachine.defaultState] ?? {} : {}),
  }), [scrollCssStyle, scrollProgressCssStyle, filterStyle, clipPathStyle, maskCssStyle,
       parallax?.enabled, drag?.enabled, noise, particles, scrollProgress?.pin, focus?.enabled,
       flip, statesMachine]);

  // ── Pseudo-element animated styles (cross-platform Reanimated) ────────────
  const pseudoBeforeStyle = useAnimatedStyle(() => {
    if (!pseudoElCfg?.enabled || pseudoElCfg.target === '::after') return {};
    const progress = pseudoElCfg.trigger === 'hover' ? pseudoHoverProgress.value : 1;
    const baseW  = parseFloat(pseudoElCfg.width  ?? '100') || 100;
    const hoverW = parseFloat(pseudoElCfg.hoverWidth ?? String(baseW)) || baseW;
    const hoverOp = pseudoElCfg.hoverOpacity ?? 1;
    const width   = pseudoElCfg.trigger === 'hover' ? baseW + (hoverW - baseW) * progress : baseW;
    const opacity = pseudoElCfg.trigger === 'always' || pseudoElCfg.trigger === 'enter' ? 1
      : pseudoElCfg.trigger === 'hover' ? hoverOp * progress : progress;
    return { width: `${width}%`, opacity };
  }, [pseudoHoverProgress]);

  const pseudoAfterStyle = useAnimatedStyle(() => {
    if (!pseudoElCfg?.enabled || pseudoElCfg.target !== '::after') return {};
    const progress = pseudoElCfg.trigger === 'hover' ? pseudoHoverProgress.value : 1;
    const hoverOp = pseudoElCfg.hoverOpacity ?? 1;
    const opacity = pseudoElCfg.trigger === 'always' || pseudoElCfg.trigger === 'enter' ? 1
      : pseudoElCfg.trigger === 'hover' ? hoverOp * progress : progress;
    return { opacity };
  }, [pseudoHoverProgress]);

  const pseudoBeforeView = pseudoElCfg?.enabled && pseudoElCfg.target !== '::after' ? (
    <Animated.View
      style={[{
        position: 'absolute',
        bottom: parseFloat(pseudoElCfg.bottom ?? '0'),
        left:   parseFloat(pseudoElCfg.left   ?? '0'),
        height: parseFloat(pseudoElCfg.height ?? '2'),
        backgroundColor: pseudoElCfg.background ?? 'currentColor',
        pointerEvents: 'none',
      }, pseudoBeforeStyle]}
    />
  ) : null;

  const pseudoAfterView = pseudoElCfg?.enabled && pseudoElCfg.target === '::after' ? (
    <Animated.View
      style={[{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: parseFloat(pseudoElCfg.height ?? '2'),
        backgroundColor: pseudoElCfg.background ?? 'currentColor',
        pointerEvents: 'none',
      }, pseudoAfterStyle]}
    />
  ) : null;

  // ── SVG stroke path (cross-platform) ──────────────────────────────────────
  const AnimatedSvgPath = useMemo(() => Animated.createAnimatedComponent(SvgPath), []);

  // ── Gradient angle animated style ─────────────────────────────────────────
  const gradientAngleStyle = useAnimatedStyle(() => ({
    transform: gradientAnimation?.animateAngle
      ? [{ rotate: `${gradientAngleSv.value - (gradientAnimation?.angle ?? 135)}deg` }]
      : [],
  }), [gradientAngleSv]);

  // ── Flip inner children ────────────────────────────────────────────────────
  const flipInnerChildren = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ style?: CSSProperties }>, {
        style: { transformStyle: 'preserve-3d' as CSSProperties['transformStyle'], position: 'relative' as CSSProperties['position'], width: '100%', height: '100%', ...(children as React.ReactElement<{ style?: CSSProperties }>).props.style },
      })
    : children;

  // ── Mask wrapper (cross-platform — stub on web, real MaskedView on native) ─
  const wrapWithMask = (content: React.ReactNode): React.ReactNode => {
    if (!maskCfg?.enabled || !maskCfg.image) return content;
    if (!MaskedViewComponent) return content;
    const MV = MaskedViewComponent;
    return (
      <MV
        style={{ flex: 1 }}
        maskElement={
          <Animated.View style={{ flex: 1, backgroundColor: '#000' }} />
        }
      >
        {content}
      </MV>
    );
  };

  // ── Content: splitText or flip or children ─────────────────────────────────
  const innerContent = splitText?.text
    ? <SplitTextNative
        units={splitText.split === 'word' ? splitText.text.split(/(\s+)/) : splitText.split === 'line' ? splitText.text.split(/\n/) : splitText.text.split('')}
        config={splitText}
      />
    : flip ? flipInnerChildren : children;

  // ── Noise SVG overlay (cross-platform via react-native-svg) ───────────────
  const noiseOverlay = noise ? (
    <Svg
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: noise.opacity ?? 0.12, zIndex: 2 }}
    >
      <Defs>
        <Filter id={`noise-${noiseId}`} x="0%" y="0%" width="100%" height="100%">
          <FeTurbulence
            type={noise.type ?? 'fractalNoise'}
            baseFrequency={noise.baseFrequency ?? 0.65}
            numOctaves={noise.numOctaves ?? 4}
            seed={noiseSeedState}
            stitchTiles="stitch"
          />
          <FeColorMatrix type="saturate" values="0" />
        </Filter>
      </Defs>
      <SvgRect width="100%" height="100%" filter={`url(#noise-${noiseId})`} fill={noise.color ?? '#000000'} />
    </Svg>
  ) : null;

  // ── Particles overlay — Skia or Canvas2D fallback ──────────────────────────
  const particlesOverlay = particles ? (
    SkiaCanvas
      ? <SkiaParticles particles={particles} SkiaCanvas={SkiaCanvas} />
      : <Canvas2DParticles particles={particles} />
  ) : null;

  // ── Gradient overlay — LinearGradient cross-platform ──────────────────────
  const gradientOverlay = gradientAnimation?.enabled ? (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { pointerEvents: 'none', zIndex: -1 },
        gradientAngleStyle,
      ]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={(gradientAnimation.colors?.length ? gradientAnimation.colors : ['#6366f1', '#ec4899', '#6366f1']) as string[]}
        angle={gradientAnimation.angle ?? 135}
        useAngle={true}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  ) : null;

  // ── Shimmer overlay — LinearGradient cross-platform ───────────────────────
  const shimmerAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value * 400 }],
  }), [shimmerX]);

  const shimmerOverlay = shimmer ? (
    <Animated.View
      style={[StyleSheet.absoluteFill, { overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }]}
      pointerEvents="none"
    >
      <Animated.View style={[StyleSheet.absoluteFill, shimmerAnimStyle]}>
        <LinearGradient
          colors={[
            shimmer.baseColor      ?? '#e2e8f0',
            shimmer.highlightColor ?? '#f8fafc',
            shimmer.baseColor      ?? '#e2e8f0',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: '300%', height: '100%', marginLeft: '-100%' }}
        />
      </Animated.View>
    </Animated.View>
  ) : null;

  // ── Return ─────────────────────────────────────────────────────────────────
  // In builder mode on web, use a plain View (not Animated.View) as the outer wrapper.
  // Animations are suppressed in builder mode (enter useEffect bails early when builderMode
  // is true) so Animated.View provides no benefit. Using a plain View means direct
  // el.style.height DOM writes during canvas drag-resize are never overwritten by
  // Reanimated's createAnimatedComponent style reconciliation — live drag works correctly.
  return (
    <GestureDetector gesture={composedGesture}>
      {builderMode && nodeId && Platform.OS === 'web' ? (
        <View
          className={outerClassName ?? undefined}
          style={[mergedStyle as object, outerStyle as object]}
          ref={(el) => {
            // RNW forwards the ref to the underlying DOM div — use setAttribute
            // so the builder's querySelector('[data-builder-id]') always finds it.
            const dom = el as unknown as Element | null;
            if (dom?.setAttribute) {
              dom.setAttribute('data-builder-id', nodeId!);
              dom.setAttribute('data-builder-type', nodeType ?? 'Box');
            }
          }}
        >
          {pseudoBeforeView}
          {wrapWithMask(innerContent)}
          {pseudoAfterView}
          {gradientOverlay}
          {shimmerOverlay}
          {particlesOverlay}
          {noiseOverlay}
        </View>
      ) : (
        <Animated.View
          ref={animatedRef}
          className={outerClassName ?? undefined}
          style={[animatedStyle, mergedStyle as object, outerStyle as object]}
          onLayout={handleLayout}
          exiting={exitingAnimation ?? undefined}
          {...(focus?.enabled ? { tabIndex: 0 } : {})}
          {...(pseudoElCfg?.enabled ? { 'data-anim-id': nodeId ?? componentId } : {})}
          {...(focus?.enabled ? {
            onFocus: () => { isFocusedSv.value = withTiming(1, { duration: focus.duration ?? 200 }); },
            onBlur:  () => { isFocusedSv.value = withTiming(0, { duration: focus.duration ?? 200 }); },
          } as object : {})}
          {...(builderMode && nodeId
            ? { 'data-builder-id': nodeId, 'data-builder-type': nodeType ?? 'Box' }
            : {})}
        >
          {pseudoBeforeView}
          {wrapWithMask(innerContent)}
          {pseudoAfterView}
          {gradientOverlay}
          {shimmerOverlay}
          {particlesOverlay}
          {noiseOverlay}
        </Animated.View>
      )}
    </GestureDetector>
  );
});

// ─── SplitTextNative — renders animated chars/words/lines cross-platform ─────

function SplitTextNative({ units, config }: { units: string[]; config: SplitTextConfig }) {
  const sharedValues = useRef(units.map(() => useSharedValueFactory(0))).current;

  useEffect(() => {
    units.forEach((_, i) => {
      const delay    = (config.delay ?? 0) + i * (config.stagger ?? 40);
      const duration = config.duration ?? 400;
      const easing   = rnEase(config.easing ?? 'easeOut');
      sharedValues[i].value = withDelay(delay, withTiming(1, { duration, easing }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(units)]);

  return (
    <>
      {units.map((unit, i) => (
        <SplitTextUnit key={i} sv={sharedValues[i]} unit={unit} config={config} delay={(config.delay ?? 0) + i * (config.stagger ?? 40)} />
      ))}
    </>
  );
}

function useSharedValueFactory(initial: number) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useSharedValue(initial);
}

function SplitTextUnit({ sv, unit, config, delay }: { sv: ReturnType<typeof useSharedValue<number>>; unit: string; config: SplitTextConfig; delay: number }) {
  const ref = useAnimatedRef<Animated.Text>();
  const from = ENTER_FROM[config.type ?? 'fadeIn'] ?? { opacity: 0 };
  const style = useAnimatedStyle(() => ({
    opacity: from.opacity != null ? from.opacity + (1 - from.opacity) * sv.value : 1,
    transform: [
      ...(from.translateY != null ? [{ translateY: from.translateY * (1 - sv.value) }] : []),
      ...(from.scale      != null ? [{ scale: from.scale + (1 - from.scale) * sv.value }] : []),
    ],
  }), [sv]);

  // Set data-split-unit attribute and typewriter CSS animation on DOM element
  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!el || typeof el.setAttribute !== 'function') return;
    el.setAttribute('data-split-unit', '');
    if ((config.type === 'typewriter' || config.type === 'typeIn') && typeof document !== 'undefined') {
      const animName = 'an-typewriter';
      if (!document.getElementById(`__kf_${animName}`)) {
        const s = document.createElement('style');
        s.id = `__kf_${animName}`;
        s.textContent = `@keyframes ${animName} { from { opacity: 0 } to { opacity: 1 } }`;
        document.head.appendChild(s);
      }
      const dur = config.duration ?? 400;
      el.style.animation = `${animName} ${dur}ms step-end ${delay}ms both`;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.type, delay]);

  return (
    <Animated.Text ref={ref} style={style}>
      {unit || '\u00A0'}
    </Animated.Text>
  );
}

// ─── Canvas2DParticles — web fallback using Canvas 2D API ────────────────────

function Canvas2DParticles({ particles }: { particles: ParticlesConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { count = 80, color: pColor = '#6366f1', background = 'transparent', speed = 0.5, maxRadius = 3, connectDistance = 120 } = particles;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      canvas.width  = parent?.clientWidth  ?? 300;
      canvas.height = parent?.clientHeight ?? 200;
    };
    resize();

    const pts = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * speed * 2, vy: (Math.random() - 0.5) * speed * 2,
      r: Math.random() * maxRadius + 1,
    }));

    let raf = 0;
    const tick = () => {
      const w = canvas.width; const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (background && background !== 'transparent') {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
      }
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = pColor;
        ctx.fill();
      }
      // Connect nearby particles
      const cd2 = connectDistance * connectDistance;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x; const dy = pts[i].y - pts[j].y;
          if (dx * dx + dy * dy < cd2) {
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = pColor;
            ctx.globalAlpha = 0.15;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, pColor, background, speed, maxRadius, connectDistance]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', pointerEvents: 'none' } as React.CSSProperties}
    />
  );
}

// ─── SkiaParticles — native particle canvas via @shopify/react-native-skia ────

interface SkiaParticlesProps {
  particles: ParticlesConfig;
  SkiaCanvas: NonNullable<typeof SkiaCanvas>;
}

function SkiaParticles({ particles, SkiaCanvas: Canvas }: SkiaParticlesProps) {
  const [size, setSize] = useState({ width: 300, height: 200 });
  const ptsRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; r: number; alpha: number }>>([]);
  const tickRef = useSharedValue(0);

  const { count = 80, color: pColor = '#6366f1', speed = 0.5, maxRadius = 3 } = particles;

  useEffect(() => {
    ptsRef.current = Array.from({ length: count }, () => ({
      x: Math.random() * size.width, y: Math.random() * size.height,
      vx: (Math.random() - 0.5) * speed * 2, vy: (Math.random() - 0.5) * speed * 2,
      r: Math.random() * maxRadius + 1, alpha: Math.random() * 0.5 + 0.5,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, speed, maxRadius, size.width, size.height]);

  useFrameCallback(() => {
    const pts = ptsRef.current;
    for (const p of pts) {
      p.vx *= 0.98; p.vy *= 0.98;
      p.x  += p.vx;  p.y  += p.vy;
      if (p.x < 0) p.x = size.width;  if (p.x > size.width)  p.x = 0;
      if (p.y < 0) p.y = size.height; if (p.y > size.height) p.y = 0;
    }
    tickRef.value = tickRef.value + 1;
  });

  void pColor;

  return (
    <Canvas
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' } as object}
      width={size.width}
      height={size.height}
      onLayout={(e: { nativeEvent: { layout: { width: number; height: number } } }) => {
        setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
      }}
    />
  );
}
