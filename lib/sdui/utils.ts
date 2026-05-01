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

/** Resolve text: string (interpolate), { var } (path lookup), { formula, suffix?, prefix?, template? } (inline formula),
 *  or any other object treated as a bare JSON Logic expression (e.g. { "formatCurrency": [...] }) */
export function resolveText(
  text: string | { formula?: string | object; var?: string | [string, unknown]; suffix?: string; prefix?: string; template?: string } | undefined,
  context: SDUIContext,
  scope?: Record<string, unknown>
): string {
  if (text == null) return '';
  if (typeof text === 'string') return interpolate(text, context, scope);
  if (typeof text === 'object' && text !== null) {
    if ('formula' in text) {
      const { formula: f, suffix = '', prefix = '', template } = text as { formula: string | object; suffix?: string; prefix?: string; template?: string };
      const evalResult = evaluateFormula(
        (typeof f === 'string' ? f : f) as string | object,
        context.state ?? {}
      );
      const str = String(evalResult.value ?? '');
      if (template != null) return template.replace('{0}', str);
      if (suffix || prefix) return prefix + str + suffix;
      return str;
    }
    if ('js' in text) {
      // JavaScript binding — evaluate via evaluateFormula which auto-routes
      // { js } objects to the JS evaluator.
      const { suffix = '', prefix = '', template } = text as { suffix?: string; prefix?: string; template?: string };
      const evalResult = evaluateFormula(text as object, context.state ?? {});
      const str = String(evalResult.value ?? '');
      if (template != null) return template.replace('{0}', str);
      if (suffix || prefix) return prefix + str + suffix;
      return str;
    }
    if ('var' in text) {
      const v = text.var;
      const path = Array.isArray(v) ? String(v[0]) : String(v);
      const fallback = Array.isArray(v) ? v[1] : undefined;
      const val = context.get(path, scope);
      const result = val !== undefined && val !== null ? val : fallback;
      return String(result ?? '');
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

/** Evaluate condition (formula string) against context state */
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

/** CSS dimension property keys that get an automatic "px" suffix when a formula
 *  returns a number (e.g. { formula: "200" } on a width prop becomes "200px"). */
const DIMENSION_KEYS = new Set([
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'top', 'right', 'bottom', 'left',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'rowGap', 'columnGap',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing', 'outlineWidth',
]);

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
    } else if (Array.isArray(value)) {
      // Recursively resolve arrays so nested formula objects (e.g. inside style.transform) are evaluated.
      resolved[key] = value.map((item) =>
        item != null && typeof item === 'object' && !Array.isArray(item)
          ? resolveProps(item as Record<string, unknown>, context, runAction, scope)
          : item
      );
    } else if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if ('var' in obj) {
        const v = obj.var;
        const path = Array.isArray(v) ? v[0] : v;
        const fallback = Array.isArray(v) ? v[1] : undefined;
        const val = context.get(String(path), scope);
        const finalVal = val !== undefined && val !== null ? val : fallback;
        resolved[key] = coerceValue(finalVal);
      } else if ('formula' in obj || 'js' in obj) {
        try {
          // evaluateFormula auto-detects { js } vs { formula }; pass the wrapper
          // object directly so JavaScript bindings get routed to the JS evaluator.
          const evalResult = evaluateFormula(
            obj as unknown as string | object,
            context.state ?? {}
          );
          if (evalResult.value != null && typeof evalResult.value !== 'object') {
            const v = evalResult.value;
            resolved[key] = (typeof v === 'number' && DIMENSION_KEYS.has(key)) ? `${v}px` : String(v);
          } else {
            resolved[key] = evalResult.value;
          }
        } catch {
          // CSS expressions like calc(100% - 24px) are not valid JS but are valid CSS.
          // Return the formula string as-is so the browser CSS engine can handle it.
          resolved[key] = (value as { formula?: string; js?: string }).formula
            ?? (value as { formula?: string; js?: string }).js
            ?? value;
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
