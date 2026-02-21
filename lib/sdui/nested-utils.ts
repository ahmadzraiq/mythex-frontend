/**
 * Nested object utilities - path-based get/set for dot-notation paths
 * Shared across SDUI engine, renderer, and variable store
 */

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (path == null || typeof path !== 'string') return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
  merge = false
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(obj));
  const parts = path.split('.');
  let current = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = current[part];
    // Replace null/undefined/non-object so we can traverse (typeof null === 'object' in JS)
    if (next == null || typeof next !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (merge && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    current[last] = { ...(current[last] as object), ...(value as object) };
  } else {
    current[last] = value;
  }
  return result;
}
