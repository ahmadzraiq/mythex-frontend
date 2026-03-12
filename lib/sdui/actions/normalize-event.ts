/**
 * Normalizes raw trigger events into consistent plain objects for formula evaluation.
 *
 * Raw events vary wildly by trigger type: change fires with a string, click fires with
 * a MouseEvent, touch fires with a TouchEvent, etc. This helper converts them all into
 * plain Record<string, unknown> objects whose shape matches EVENT_SHAPES in the builder
 * formula editor, so formulas like `event?.['value']` or `event?.['x']` work consistently.
 */

/** Triggers whose raw event IS the new value (string/boolean/number) — wrap as { value } */
const VALUE_TRIGGERS = new Set([
  'change', 'initValueChange', 'valueChange', 'enterKey', 'focus', 'blur',
]);

export function normalizeEvent(rawEvent: unknown, trigger: string): Record<string, unknown> {
  if (rawEvent === undefined || rawEvent === null) return {};

  // Value-type triggers: action-binding already extracts the scalar; wrap as { value }
  if (
    VALUE_TRIGGERS.has(trigger) &&
    (typeof rawEvent === 'string' || typeof rawEvent === 'boolean' || typeof rawEvent === 'number')
  ) {
    return { value: rawEvent };
  }

  // enterKey with keyboard event
  if (trigger === 'enterKey' && rawEvent && typeof rawEvent === 'object' && 'key' in rawEvent) {
    const e = rawEvent as { key?: string; target?: { value?: unknown } };
    return { value: e.target?.value ?? '', key: e.key ?? 'Enter' };
  }

  // Mouse events (clientX / clientY present)
  if (rawEvent && typeof rawEvent === 'object' && 'clientX' in rawEvent) {
    const e = rawEvent as { clientX: number; clientY: number; button?: number };
    return { x: e.clientX, y: e.clientY, button: e.button ?? 0 };
  }

  // Touch events (touches collection present)
  if (rawEvent && typeof rawEvent === 'object' && 'touches' in rawEvent) {
    const e = rawEvent as { touches: ArrayLike<{ clientX: number; clientY: number }>; changedTouches: ArrayLike<{ clientX: number; clientY: number }> };
    const mapTouch = (t: { clientX: number; clientY: number }) => ({ x: t.clientX, y: t.clientY });
    return {
      touches: Array.from(e.touches).map(mapTouch),
      changedTouches: Array.from(e.changedTouches ?? []).map(mapTouch),
    };
  }

  // Scroll events
  if (trigger === 'scroll' && rawEvent && typeof rawEvent === 'object' && 'target' in rawEvent) {
    const t = (rawEvent as { target?: { scrollTop?: number; scrollLeft?: number } }).target;
    return { scrollTop: t?.scrollTop ?? 0, scrollLeft: t?.scrollLeft ?? 0 };
  }

  // Already a plain object — return as-is
  if (typeof rawEvent === 'object' && !Array.isArray(rawEvent)) {
    return rawEvent as Record<string, unknown>;
  }

  // Scalar fallback
  return { value: rawEvent };
}
