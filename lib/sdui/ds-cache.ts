/**
 * Shared LRU cache for named data source fetches.
 * Used by sdui-engine.tsx (auto-fetch on mount) and refetch-datasource-handler.ts (on-demand clear).
 */

const DS_CACHE_MAX = 128;
interface DsCacheEntry { value: unknown; expiresAt: number }
const _dsCache = new Map<string, DsCacheEntry>();

export function dsCacheGet(key: string): unknown | undefined {
  const entry = _dsCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { _dsCache.delete(key); return undefined; }
  return entry.value;
}

export function dsCacheSet(key: string, value: unknown, ttlSec: number) {
  if (_dsCache.size >= DS_CACHE_MAX) {
    const firstKey = _dsCache.keys().next().value;
    if (firstKey) _dsCache.delete(firstKey);
  }
  _dsCache.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

/** Clears all cache entries for a given data source name (all cache key variants). */
export function dsCacheClear(name: string) {
  for (const key of Array.from(_dsCache.keys())) {
    if (key.startsWith(`ds:${name}:`)) _dsCache.delete(key);
  }
}
