/**
 * animations.ts — Map engine animation config → Framer Motion props.
 *
 * Every animation type in docs/SCHEMA.md §12 is handled.
 * Named loop animations also emit @keyframes in globals.css (see NAMED_KEYFRAMES).
 */

/** @keyframes for named loop animations, injected into globals.css */
export const NAMED_KEYFRAMES: Record<string, string> = {
  glowPulse: `@keyframes glowPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--primary), 0.4); }
  50% { box-shadow: 0 0 0 12px rgba(var(--primary), 0); }
}`,
  ripple: `@keyframes ripple {
  0% { transform: scale(0); opacity: 1; }
  100% { transform: scale(4); opacity: 0; }
}`,
  gradientDrift: `@keyframes gradientDrift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}`,
  spin: `@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}`,
  ping: `@keyframes ping {
  75%, 100% { transform: scale(2); opacity: 0; }
}`,
  bounce: `@keyframes bounce {
  0%, 100% { transform: translateY(0); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
  50% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }
}`,
  pulse: `@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}`,
  fadeIn: `@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}`,
  fadeOut: `@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}`,
  slideUp: `@keyframes slideUp {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}`,
  slideDown: `@keyframes slideDown {
  from { transform: translateY(-16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}`,
  slideLeft: `@keyframes slideLeft {
  from { transform: translateX(16px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}`,
  slideRight: `@keyframes slideRight {
  from { transform: translateX(-16px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}`,
  zoomIn: `@keyframes zoomIn {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}`,
  zoomOut: `@keyframes zoomOut {
  from { transform: scale(1.1); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}`,
  shake: `@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-8px); }
  75% { transform: translateX(8px); }
}`,
  float: `@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}`,
};

export type AnimationConfig = Record<string, unknown>;

/**
 * Convert an engine AnimationConfig to Framer Motion JSX prop strings.
 *
 * Returns an object of propName → JSX expression strings.
 * Also returns a Set of named CSS animation keys used (for globals.css injection).
 */
export function animationToMotionProps(
  animation: AnimationConfig,
  usedAnimations: Set<string>,
): Record<string, string> {
  if (!animation) return {};

  const props: Record<string, string> = {};

  // Enter animation
  if (animation.enter) {
    const enter = animation.enter as Record<string, unknown>;
    props.initial = buildVariant(enter, 'from');
    props.animate = buildVariant(enter, 'to');
    if (enter.duration || enter.delay || enter.ease) {
      props.transition = buildTransition(enter);
    }
  }

  // Exit animation
  if (animation.exit) {
    const exit = animation.exit as Record<string, unknown>;
    props.exit = buildVariant(exit, 'to');
  }

  // Loop animation
  if (animation.loop) {
    const loop = animation.loop as Record<string, unknown>;
    const loopName = loop.name as string;
    if (loopName && NAMED_KEYFRAMES[loopName]) {
      usedAnimations.add(loopName);
      // Named loops use CSS animation class — not Framer Motion
      // Return a cssAnimation hint instead
      props['data-css-animation'] = JSON.stringify(loopName);
    } else {
      // Generic loop via Framer Motion
      props.animate = buildLoopVariant(loop);
      props.transition = buildLoopTransition(loop);
    }
  }

  // Hover animation
  if (animation.hover) {
    props.whileHover = buildVariant(animation.hover as Record<string, unknown>, 'to');
  }

  // Press/tap animation
  if (animation.press || animation.tap) {
    props.whileTap = buildVariant((animation.press ?? animation.tap) as Record<string, unknown>, 'to');
  }

  return props;
}

function buildVariant(config: Record<string, unknown>, dir: 'from' | 'to'): string {
  const v: Record<string, unknown> = {};

  if (config.opacity !== undefined) {
    const op = config.opacity as { from?: number; to?: number } | number;
    if (typeof op === 'object') v.opacity = dir === 'from' ? (op.from ?? 0) : (op.to ?? 1);
    else v.opacity = op;
  }
  if (config.y !== undefined) {
    const y = config.y as { from?: number; to?: number } | number;
    if (typeof y === 'object') v.y = dir === 'from' ? (y.from ?? 0) : (y.to ?? 0);
    else v.y = y;
  }
  if (config.x !== undefined) {
    const x = config.x as { from?: number; to?: number } | number;
    if (typeof x === 'object') v.x = dir === 'from' ? (x.from ?? 0) : (x.to ?? 0);
    else v.x = x;
  }
  if (config.scale !== undefined) {
    const sc = config.scale as { from?: number; to?: number } | number;
    if (typeof sc === 'object') v.scale = dir === 'from' ? (sc.from ?? 1) : (sc.to ?? 1);
    else v.scale = sc;
  }
  if (config.rotate !== undefined) {
    const rot = config.rotate as { from?: number; to?: number } | number;
    if (typeof rot === 'object') v.rotate = dir === 'from' ? (rot.from ?? 0) : (rot.to ?? 0);
    else v.rotate = rot;
  }

  // Defaults
  if (Object.keys(v).length === 0) {
    if (dir === 'from') return `{ opacity: 0 }`;
    return `{ opacity: 1 }`;
  }

  return JSON.stringify(v);
}

function buildLoopVariant(loop: Record<string, unknown>): string {
  const v: Record<string, unknown> = {};
  if (loop.opacity !== undefined) v.opacity = [0, 1, 0];
  if (loop.y !== undefined) v.y = [0, -8, 0];
  if (loop.x !== undefined) v.x = [0, -8, 0];
  if (loop.scale !== undefined) v.scale = [1, 1.05, 1];
  if (loop.rotate !== undefined) v.rotate = [0, 360];
  return JSON.stringify(Object.keys(v).length ? v : { opacity: [1, 0.5, 1] });
}

function buildTransition(config: Record<string, unknown>): string {
  const t: Record<string, unknown> = {};
  if (config.duration) t.duration = Number(config.duration) / 1000; // ms → s
  if (config.delay) t.delay = Number(config.delay) / 1000;
  if (config.ease) t.ease = config.ease;
  return JSON.stringify(t);
}

function buildLoopTransition(loop: Record<string, unknown>): string {
  // Note: JSON.stringify(Infinity) → null; must use a JS literal instead
  const duration = loop.duration ? Number(loop.duration) / 1000 : 2;
  const ease = JSON.stringify(loop.ease ?? 'easeInOut');
  const repeatType = loop.direction === 'alternate' ? ', repeatType: "reverse"' : '';
  return `{ repeat: Infinity, duration: ${duration}, ease: ${ease}${repeatType} }`;
}

/**
 * Returns the motion tag name for a given HTML tag.
 * e.g. "div" → "motion.div", "span" → "motion.span"
 */
export function motionTag(htmlTag: string): string {
  return `motion.${htmlTag}`;
}
