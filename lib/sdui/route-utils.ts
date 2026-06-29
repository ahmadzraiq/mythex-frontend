/**
 * Route matching and sorting utilities
 */

export type RouteConfig = {
  path: string;
  config?: string;
  redirect?: string;
  auth?: boolean;
  dynamic?: boolean;
  paramChangeAction?: string;
  keyBy?: string[];
};

export type RouteMatch = {
  route: RouteConfig;
  /** Extracted path params, e.g. { id: '42', xyz: 'foo' } for pattern /product/:id/something/:xyz */
  params: Record<string, string>;
};

/**
 * Sort routes so most-specific patterns win.
 * Primary: segment count descending (more segments = more specific).
 * Secondary: literal-segment count descending (fewer wildcards = more specific).
 * Tertiary: pattern string length descending (tie-break).
 */
export function sortRoutes<T extends { path: string }>(routes: T[]): T[] {
  return [...routes].sort((a, b) => {
    const segsA = a.path.split('/').filter(Boolean);
    const segsB = b.path.split('/').filter(Boolean);
    if (segsB.length !== segsA.length) return segsB.length - segsA.length;
    const literalsA = segsA.filter(s => !s.startsWith(':')).length;
    const literalsB = segsB.filter(s => !s.startsWith(':')).length;
    if (literalsB !== literalsA) return literalsB - literalsA;
    return b.path.length - a.path.length;
  });
}

/**
 * Try to match a single route pattern against an actual path.
 * Returns extracted params on success, or null on mismatch.
 *
 * Supports:
 *   - Exact literals:  /account/orders
 *   - Named segments:  /product/:id/something/:xyz
 *   - Legacy dynamic prefix (dynamic: true):  /product matches /product/foo
 */
function tryMatch(pattern: string, path: string, dynamic?: boolean): Record<string, string> | null {
  const patSegs = pattern.split('/').filter(Boolean);
  const pathSegs = path.split('/').filter(Boolean);

  // Legacy dynamic prefix — pattern is a prefix, no segment extraction
  if (dynamic && !pattern.includes(':')) {
    if (path === pattern || path.startsWith(pattern + '/')) {
      return {};
    }
    return null;
  }

  // Segment counts must match for parameterised patterns
  if (patSegs.length !== pathSegs.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patSegs.length; i++) {
    const pat = patSegs[i];
    const val = pathSegs[i];
    if (pat.startsWith(':')) {
      params[pat.slice(1)] = decodeURIComponent(val);
    } else if (pat !== val) {
      return null;
    }
  }
  return params;
}

/**
 * Match a path against the sorted route list.
 * Returns the first match with its extracted path params.
 */
export function matchRoute(path: string, routes: RouteConfig[]): RouteMatch | undefined {
  for (const route of routes) {
    const params = tryMatch(route.path, path, route.dynamic);
    if (params !== null) return { route, params };
  }
  return undefined;
}
