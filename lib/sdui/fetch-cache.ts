/**
 * Config-driven fetch cache: tag + vars key, TTL in seconds, invalidate on mutation.
 * Used by fetch and graphql action handlers to avoid redundant API calls.
 * LRU eviction when at max size (100 entries) to prevent unbounded memory growth.
 */

const MAX_ENTRIES = 100;
const fetchCache = new Map<string, { data: unknown; expiresAt: number }>();

function cacheKey(tag: string, vars: Record<string, unknown> | undefined): string {
  const v = vars ? JSON.stringify(vars) : '';
  return `${tag}:${v}`;
}

function evictIfNeeded(): void {
  const now = Date.now();
  for (const [k, e] of fetchCache.entries()) {
    if (e.expiresAt <= now) fetchCache.delete(k);
  }
  while (fetchCache.size >= MAX_ENTRIES) {
    const firstKey = fetchCache.keys().next().value;
    if (firstKey) fetchCache.delete(firstKey);
    else break;
  }
}

export function cacheGet(tag: string, vars: Record<string, unknown> | undefined): unknown | null {
  const key = cacheKey(tag, vars);
  const e = fetchCache.get(key);
  if (!e || Date.now() > e.expiresAt) {
    if (e) fetchCache.delete(key);
    return null;
  }
  return e.data;
}

export function cacheSet(
  tag: string,
  vars: Record<string, unknown> | undefined,
  data: unknown,
  ttlSec: number
): void {
  evictIfNeeded();
  fetchCache.set(cacheKey(tag, vars), { data, expiresAt: Date.now() + ttlSec * 1000 });
}

export function cacheInvalidate(tag: string): void {
  for (const k of fetchCache.keys()) if (k.startsWith(tag + ':')) fetchCache.delete(k);
}
