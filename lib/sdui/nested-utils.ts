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

/**
 * Set value at path using structural sharing - only clones the path branch,
 * not the entire object. O(depth) instead of O(entire tree).
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
  merge = false
): Record<string, unknown> {
  if (path == null || typeof path !== 'string') return obj;
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return obj;

  function setAtPath(
    current: Record<string, unknown>,
    partIndex: number
  ): Record<string, unknown> {
    const part = parts[partIndex];
    const isLast = partIndex === parts.length - 1;

    if (isLast) {
      const existing = current[part];
      const finalValue =
        merge && typeof value === 'object' && value !== null && !Array.isArray(value)
          ? {
              ...(existing != null && typeof existing === 'object' && !Array.isArray(existing)
                ? (existing as Record<string, unknown>)
                : {}),
              ...(value as Record<string, unknown>),
            }
          : value;
      return { ...current, [part]: finalValue };
    }

    const next = current[part];
    const nextObj =
      next != null && typeof next === 'object' && !Array.isArray(next)
        ? (next as Record<string, unknown>)
        : {};
    const updatedNext = setAtPath(nextObj, partIndex + 1);
    return { ...current, [part]: updatedNext };
  }

  const base =
    obj != null && typeof obj === 'object' && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : {};
  return setAtPath(base, 0);
}
