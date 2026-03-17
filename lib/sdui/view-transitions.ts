/**
 * view-transitions.ts
 *
 * CSS View Transitions API helper for SDUI page navigation.
 *
 * Usage — call `startViewTransition(callback)` instead of triggering
 * a plain React router push. The callback performs the state/route change;
 * the browser animates the old page out and the new page in.
 *
 * If the browser does not support View Transitions, the callback is called
 * directly with no animation (graceful degradation).
 *
 * Global transition types (control via `data-transition` on <html>):
 *   "slide-left"  — new page slides in from the right
 *   "slide-right" — new page slides in from the left
 *   "fade"        — simple cross-fade (default)
 *   "scale"       — old page scales down, new page scales up
 *
 * Configure default transition in store.json → engineConventions:
 *   "pageTransition": "fade" | "slide-left" | "slide-right" | "scale" | "none"
 */

export type PageTransitionType = 'fade' | 'slide-left' | 'slide-right' | 'scale' | 'none';

const KEYFRAMES = `
@keyframes vt-fade-in        { from { opacity: 0 }            to { opacity: 1 } }
@keyframes vt-fade-out       { from { opacity: 1 }            to { opacity: 0 } }
@keyframes vt-slide-in-right { from { transform: translateX(100%) } to { transform: translateX(0) } }
@keyframes vt-slide-out-left { from { transform: translateX(0) }    to { transform: translateX(-100%) } }
@keyframes vt-slide-in-left  { from { transform: translateX(-100%) } to { transform: translateX(0) } }
@keyframes vt-slide-out-right{ from { transform: translateX(0) }    to { transform: translateX(100%) } }
@keyframes vt-scale-in       { from { transform: scale(0.92); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes vt-scale-out      { from { transform: scale(1);    opacity: 1 } to { transform: scale(0.92); opacity: 0 } }
`;

const TRANSITION_CSS: Record<PageTransitionType, string> = {
  fade: `
    ::view-transition-old(root) { animation: vt-fade-out 200ms ease both; }
    ::view-transition-new(root) { animation: vt-fade-in  200ms ease both; }
  `,
  'slide-left': `
    ::view-transition-old(root) { animation: vt-slide-out-left  300ms cubic-bezier(0.4,0,0.2,1) both; }
    ::view-transition-new(root) { animation: vt-slide-in-right  300ms cubic-bezier(0.4,0,0.2,1) both; }
  `,
  'slide-right': `
    ::view-transition-old(root) { animation: vt-slide-out-right 300ms cubic-bezier(0.4,0,0.2,1) both; }
    ::view-transition-new(root) { animation: vt-slide-in-left   300ms cubic-bezier(0.4,0,0.2,1) both; }
  `,
  scale: `
    ::view-transition-old(root) { animation: vt-scale-out 280ms ease both; }
    ::view-transition-new(root) { animation: vt-scale-in  280ms ease both; }
  `,
  none: `
    ::view-transition-old(root),
    ::view-transition-new(root) { animation: none; }
  `,
};

let styleEl: HTMLStyleElement | null = null;

function ensureStylesheet() {
  if (typeof document === 'undefined') return;
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.id = 'sdui-view-transitions';
  document.head.appendChild(styleEl);
}

/**
 * Inject (or update) the view-transition CSS rules for the given type.
 * Call this once on app init or whenever the transition type changes.
 */
export function setPageTransitionType(type: PageTransitionType = 'fade') {
  ensureStylesheet();
  if (!styleEl) return;
  styleEl.textContent = KEYFRAMES + (TRANSITION_CSS[type] ?? TRANSITION_CSS.fade);
}

/**
 * Wraps a navigation callback in `document.startViewTransition` when supported.
 * Falls back to a plain synchronous call when the API is unavailable.
 */
export function startViewTransition(
  callback: () => void | Promise<void>,
  type?: PageTransitionType,
) {
  if (type) setPageTransitionType(type);

  const doc = typeof document !== 'undefined' ? document : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (doc && typeof (doc as any).startViewTransition === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doc as any).startViewTransition(callback);
  } else {
    void Promise.resolve(callback());
  }
}

/**
 * Returns true when the browser supports the View Transitions API.
 */
export function supportsViewTransitions(): boolean {
  return (
    typeof document !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (document as any).startViewTransition === 'function'
  );
}
