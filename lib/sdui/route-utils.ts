/**
 * Route matching and sorting utilities
 */

export type RouteConfig = {
  path: string;
  config?: string;
  redirect?: string;
  auth?: boolean;
  layout?: string;
  dynamic?: boolean;
  paramChangeAction?: string;
  keyBy?: string[];
};

/** Sort routes by path length descending so /account/orders matches before /account */
export function sortRoutes<T extends { path: string }>(routes: T[]): T[] {
  return [...routes].sort((a, b) => b.path.length - a.path.length);
}

/**
 * Match route for given path.
 * Exact match or dynamic route (path starts with route.path + '/').
 */
export function matchRoute(path: string, routes: RouteConfig[]): RouteConfig | undefined {
  return routes.find((r) => {
    if (r.dynamic && path.startsWith(r.path + '/')) {
      return true;
    }
    return r.path === path;
  });
}
