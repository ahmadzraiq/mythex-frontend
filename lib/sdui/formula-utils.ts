/**
 * Low-level variable resolution helpers for the formula evaluator.
 * Extracted to avoid circular dependencies between formula-evaluator.ts and formula-functions.ts.
 */

/** Traverse a nested object by a dotted path, supporting bracket notation and optional chaining. */
export function getNestedVal(obj: Record<string, unknown>, path: string): unknown {
  // Strip optional chaining (?.) before splitting
  const cleaned = path.replace(/\?\./g, '.');
  const parts = cleaned
    .split(/\.|\[(\d+)\]|\['([^']+)'\]|\["([^"]+)"\]/)
    .filter(p => p !== undefined && p !== '');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Resolve a variable path against a formula context object.
 *  Checks flat keys first (Zustand flat-key store), then nested traversal. */
export function resolveVar(path: string, context: Record<string, unknown>): unknown {
  // Try flat key first (Zustand stores flat keys like "product.variants")
  if (path in context) return context[path];
  // Try flat-key prefix matching: find the longest context key that is a prefix of path
  // e.g. "featured.products[0].slug" with flat key "featured.products" → resolve "[0].slug" inside it
  for (const key of Object.keys(context).sort((a, b) => b.length - a.length)) {
    if (path.startsWith(key) && (path[key.length] === '.' || path[key.length] === '[')) {
      const rest = path.slice(key.length);
      return getNestedVal({ _: context[key] } as Record<string, unknown>, '_' + rest);
    }
  }
  // Try nested traversal as last resort
  return getNestedVal(context, path);
}
