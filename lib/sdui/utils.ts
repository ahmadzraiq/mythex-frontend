/**
 * SDUI Utilities - Variable resolution, interpolation, condition evaluation
 */

import { evaluateFormula } from './formula-evaluator';
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
    if (value == null) return '';
    if (typeof value === 'object') return '';
    return String(value);
  });
}

/** Resolve text: string (interpolate), { var } (path lookup), { expr, suffix?, prefix?, template? } (inline JSON Logic),
 *  or any other object treated as a bare JSON Logic expression (e.g. { "formatCurrency": [...] }) */
export function resolveText(
  text: string | { expr?: object; var?: string | [string, unknown]; suffix?: string; prefix?: string; template?: string } | undefined,
  context: SDUIContext,
  scope?: Record<string, unknown>
): string {
  if (text == null) return '';
  if (typeof text === 'string') return interpolate(text, context, scope);
  if (typeof text === 'object' && text !== null) {
    if ('var' in text) {
      const v = text.var;
      const path = Array.isArray(v) ? String(v[0]) : String(v);
      const fallback = Array.isArray(v) ? v[1] : undefined;
      const val = context.get(path, scope);
      const result = val !== undefined && val !== null ? val : fallback;
      return String(result ?? '');
    }
    if ('expr' in text) {
      const { expr, suffix = '', prefix = '', template } = text;
      const evalResult = evaluateFormula(
        (typeof expr === 'string' ? expr : expr) as string | object,
        context.state ?? {}
      );
      const str = String(evalResult.value ?? '');
      if (template != null) return template.replace('{0}', str);
      return prefix + str + suffix;
    }
    // Fallback: treat the entire object as a bare formula expression.
    // This handles AI-generated patterns like { "formatCurrency": { "var": "..." } }
    // where the "expr" wrapper was omitted. Prevents raw JSON from appearing on screen.
    try {
      const evalResult = evaluateFormula(text as object, context.state ?? {});
      if (evalResult.value !== undefined && evalResult.value !== null && typeof evalResult.value !== 'object') {
        return String(evalResult.value);
      }
    } catch {
      // Not a valid expression — fall through to empty string
    }
    return '';
  }
  return String(text);
}

/** Evaluate condition (formula string or legacy json-logic object) against context state */
export function evaluateCondition(
  condition: unknown,
  context: SDUIContext
): boolean {
  if (condition == null) return true;
  try {
    const result = evaluateFormula(condition as string | object, context.state ?? {});
    return Boolean(result.value);
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
      } else if ('expr' in obj) {
        try {
          const evalResult = evaluateFormula(
            (typeof obj.expr === 'string' ? obj.expr : obj.expr) as string | object,
            context.state ?? {}
          );
          resolved[key] = evalResult.value != null ? String(evalResult.value) : evalResult.value;
        } catch {
          resolved[key] = value;
        }
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
