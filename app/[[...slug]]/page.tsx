'use client';

import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSduiStore } from '@/store/sdui-store';
import { SDUIEngine, type ActionsConfig } from '@/lib/sdui/sdui-engine';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import { setNestedValue } from '@/lib/sdui/nested-utils';
import type { SDUIConfig } from '@/lib/sdui/types';

import appConfig from '@/config/app';
import storeConfig from '@/config/store.json';

type SearchParamSyncDef = { param: string; path: string; default?: string; type?: 'array'; transform?: string; pageSize?: number };
const PATHS = (storeConfig as { paths?: { authUser?: string; routePath?: string; routeSlug?: string } }).paths ?? {};
const AUTH_USER_PATH = PATHS.authUser ?? 'auth.user';
const ROUTE_PATH = PATHS.routePath ?? 'route.path';
const ROUTE_SLUG = PATHS.routeSlug ?? 'route.slug';
const syncDefs = (storeConfig as { searchParamSync?: SearchParamSyncDef[] }).searchParamSync ?? [];

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

type PageUI = {
  redirecting?: { text?: string; wrapperClassName?: string; textClassName?: string };
  pageNotFound?: { text?: string; wrapperClassName?: string; textClassName?: string };
  layoutClasses?: Record<string, string>;
};

type AppConfig = {
  defaultRedirect: string;
  ui?: PageUI;
  routes: Array<{
    path: string;
    config?: string;
    redirect?: string;
    auth?: boolean;
    layout?: string;
  }>;
  screens: Record<string, { meta?: object; state?: object; ui: object; initActions?: object[]; dataSources?: object[] }>;
  actions: Record<string, object>;
};

const app = appConfig as AppConfig;

export default function DynamicRoutePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setData = useSduiStore((s) => s.setData);
  const isAuthenticated = !!useSduiStore((s) => s.data['auth.user']);

  const routes = app.routes;
  const defaultRedirect = app.defaultRedirect || '/';

  // Sort routes by path length descending so /account/orders matches before /account
  const sortedRoutes = useMemo(
    () => [...routes].sort((a, b) => b.path.length - a.path.length),
    [routes]
  );

  // Resolve path from slug (slug is undefined for /, or ['login'] for /login)
  const path = pathname || '/';

  // Match route: exact path or dynamic route (path starts with route.path + '/')
  const route = sortedRoutes.find((r) => {
    const routeConfig = r as { dynamic?: boolean };
    if (routeConfig.dynamic && path.startsWith(r.path + '/')) {
      return true;
    }
    return r.path === path;
  });

  useLayoutEffect(() => {
    const newPath = pathname || '/';
    const currentPath = useSduiStore.getState().data[ROUTE_PATH];
    if (currentPath !== newPath) {
      setData(ROUTE_PATH, newPath);
    }
    // Extract slug for dynamic routes from config (e.g. /product/linen-blend-blazer -> linen-blend-blazer)
    const dynamicRoute = sortedRoutes.find(
      (r) => (r as { dynamic?: boolean }).dynamic && path.startsWith(r.path + '/')
    );
    if (dynamicRoute) {
      const slug = path.slice(dynamicRoute.path.length + 1).split('/')[0] || '';
      const currentSlug = useSduiStore.getState().data[ROUTE_SLUG];
      if (currentSlug !== slug) {
        setData(ROUTE_SLUG, slug);
      }
    }
    for (const def of syncDefs) {
      let value: unknown =
        def.type === 'array'
          ? searchParams?.getAll(def.param) ?? []
          : searchParams?.get(def.param) ?? (def.default ?? '');
      if (def.transform === 'pageToSkip') {
        const page = Math.max(1, parseInt(String(value || def.default || '1'), 10) || 1);
        value = (page - 1) * (def.pageSize ?? 12);
      }
      const current = useSduiStore.getState().data[def.path];
      if (!valuesEqual(current, value)) {
        setData(def.path, value);
        if (def.path === 'collectionSkip') {
          getGlobalVariableStore().getState().setState((prev) => setNestedValue(prev, def.path, value));
        }
      }
    }
  }, [pathname, path, searchParams, setData, sortedRoutes]);

  useEffect(() => {
    if (route?.redirect) {
      router.replace(route.redirect);
      return;
    }
    if (route?.auth && !isAuthenticated) {
      router.replace(defaultRedirect);
    }
  }, [route, isAuthenticated, router, defaultRedirect]);

  const ui = app.ui ?? {};
  const redirecting = ui.redirecting ?? { text: 'Redirecting...', wrapperClassName: 'flex items-center justify-center min-h-screen', textClassName: 'text-[var(--theme-content-textMuted)]' };
  const pageNotFound = ui.pageNotFound ?? { text: 'Page not found', wrapperClassName: 'flex items-center justify-center min-h-screen', textClassName: 'text-[var(--theme-content-textMuted)]' };
  const layoutClasses = ui.layoutClasses ?? { centered: 'w-full min-h-screen flex items-center justify-center', full: 'w-full' };

  if (route?.redirect) {
    return (
      <div className={redirecting.wrapperClassName}>
        <p className={redirecting.textClassName}>{redirecting.text}</p>
      </div>
    );
  }

  if (route?.auth && !isAuthenticated) {
    return (
      <div className={redirecting.wrapperClassName}>
        <p className={redirecting.textClassName}>{redirecting.text}</p>
      </div>
    );
  }

  const configName = route?.config ?? 'notFound';
  const config = app.screens[configName] ?? app.screens.notFound;

  if (!config) {
    return (
      <div className={pageNotFound.wrapperClassName}>
        <p className={pageNotFound.textClassName}>{pageNotFound.text}</p>
      </div>
    );
  }

  const layoutClass = layoutClasses[route?.layout ?? 'full'] ?? layoutClasses.full;

  const keyByParams = (route as { keyBy?: string[] }).keyBy ?? [];
  const engineKey =
    keyByParams.length > 0
      ? `${path}-${keyByParams
          .map((p) => {
            const def = syncDefs.find((d) => d.param === p);
            const v =
              def?.type === 'array'
                ? (searchParams?.getAll(p) ?? []).sort().join(',')
                : searchParams?.get(p) ?? def?.default ?? '';
            return v;
          })
          .join('-')}`
      : path;

  return (
    <main className={layoutClass}>
      <SDUIEngine
        key={engineKey}
        config={config as SDUIConfig}
        configName={configName}
        actionsConfig={app.actions as ActionsConfig}
        routes={app.routes}
      />
    </main>
  );
}
