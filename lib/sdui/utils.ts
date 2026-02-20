/**
 * SDUI Utilities - Variable resolution, interpolation, condition evaluation
 */

import jsonLogic from 'json-logic-js';
import type { SDUIContext } from './types';

/** Resolve dot-notation path from context state */
export function getValue(context: SDUIContext, path: string): unknown {
  return context.get(path);
}

/** Interpolate {{variable}} in strings */
export function interpolate(
  template: string,
  context: SDUIContext,
  scope?: Record<string, unknown>
): string {
  if (!template || typeof template !== 'string') return String(template ?? '');
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const value = context.get(path.trim(), scope);
    return value != null ? String(value) : '';
  });
}

/** Resolve text: string (interpolate) or { expr, suffix?, prefix?, template? } (inline JSON Logic) */
export function resolveText(
  text: string | { expr: object; suffix?: string; prefix?: string; template?: string } | undefined,
  context: SDUIContext,
  scope?: Record<string, unknown>
): string {
  if (text == null) return '';
  if (typeof text === 'string') return interpolate(text, context, scope);
  if (typeof text === 'object' && text !== null && 'expr' in text) {
    const { expr, suffix = '', prefix = '', template } = text;
    const result = jsonLogic.apply(expr as object, context.state ?? {});
    const str = String(result ?? '');
    if (template != null) return template.replace('{0}', str);
    return prefix + str + suffix;
  }
  return String(text);
}

/** Evaluate JSON Logic condition against context state */
export function evaluateCondition(
  condition: unknown,
  context: SDUIContext
): boolean {
  if (condition == null) return true;
  try {
    const result = jsonLogic.apply(condition as object, context.state);
    return Boolean(result);
  } catch {
    return false;
  }
}

/** Coerce string "true"/"false" to boolean (e.g. from {{var}} interpolation) */
function coerceValue(val: unknown): unknown {
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return val;
}

/** Resolve props - interpolate strings, resolve {var} refs, keep primitives */
export function resolveProps(
  props: Record<string, unknown> | undefined,
  context: SDUIContext,
  runAction?: (action: unknown, event?: unknown) => void,
  scope?: Record<string, unknown>
): Record<string, unknown> {
  if (!props) return {};
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string') {
      const val = interpolate(value, context, scope);
      resolved[key] = coerceValue(val);
    } else if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ('var' in obj) {
        const v = obj.var;
        const path = Array.isArray(v) ? v[0] : v;
        const fallback = Array.isArray(v) ? v[1] : undefined;
        const val = context.get(String(path), scope);
        const finalVal = val !== undefined && val !== null ? val : fallback;
        resolved[key] = coerceValue(finalVal);
      } else if ('action' in obj && runAction) {
        resolved[key] = () => runAction(obj);
      } else {
        resolved[key] = resolveProps(obj, context, runAction, scope);
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
