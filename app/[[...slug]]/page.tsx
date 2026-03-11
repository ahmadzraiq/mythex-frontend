'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSduiStore } from '@/store/sdui-store';
import { SDUIEngine, paramChangeRunActionRef, type ActionsConfig, type NamedDataSourceDef } from '@/lib/sdui/sdui-engine';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import { syncSearchParams, type SearchParamSyncDef } from '@/lib/sdui/search-param-sync';
import { sortRoutes, matchRoute } from '@/lib/sdui/route-utils';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { AppConfig, PageUI } from '@/config/types';

import appConfig from '@/config/app';
import storeConfig from '@/config/store-config';

const PATHS = (storeConfig as { paths?: { authUser?: string; routePath?: string; routeSlug?: string } }).paths ?? {};
const AUTH_USER_PATH = PATHS.authUser ?? 'auth.user';
const ROUTE_PATH = PATHS.routePath ?? 'route.path';
const ROUTE_SLUG = PATHS.routeSlug ?? 'route.slug';
const syncDefs = (storeConfig as { searchParamSync?: SearchParamSyncDef[] }).searchParamSync ?? [];

const app = appConfig as AppConfig;

export default function DynamicRoutePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setData = useSduiStore((s) => s.setData);
  const isAuthenticated = !!useSduiStore((s) => s.data[AUTH_USER_PATH]);

  const routes = app.routes;
  const defaultRedirect = app.defaultRedirect || '/';
  const sortedRoutes = useMemo(() => sortRoutes(routes), [routes]);

  const path = pathname || '/';
  const route = matchRoute(path, sortedRoutes);

  const paramSyncMountedRef = useRef(false);

  useLayoutEffect(() => {
    const newPath = pathname || '/';
    const currentPath = useSduiStore.getState().data[ROUTE_PATH];
    if (currentPath !== newPath) {
      setData(ROUTE_PATH, newPath);
    }
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
    syncSearchParams({
      searchParams,
      syncDefs,
      pathname: newPath,
      setData,
      getVariableStoreSet: () => getGlobalVariableStore().getState().setState,
      getStoreValue: (p) => useSduiStore.getState().data[p],
      paramChangeAction: (route as { paramChangeAction?: string })?.paramChangeAction,
      runParamChangeAction: (action) => paramChangeRunActionRef.current?.(action),
      paramSyncMountedRef,
    });
  }, [pathname, path, searchParams, setData, sortedRoutes, route]);

  useEffect(() => {
    if (route?.redirect) {
      router.replace(route.redirect);
      return;
    }
    if (route?.auth && !isAuthenticated) {
      router.replace(defaultRedirect);
    }
  }, [route, isAuthenticated, router, defaultRedirect]);

  const ui = (app.ui ?? {}) as PageUI;
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
  const config = (app.screens[configName] ?? app.screens.notFound) as Record<string, unknown> | undefined;

  if (!config) {
    return (
      <div className={pageNotFound.wrapperClassName}>
        <p className={pageNotFound.textClassName}>{pageNotFound.text}</p>
      </div>
    );
  }

  const layoutClass = layoutClasses[route?.layout ?? 'full'] ?? layoutClasses.full;

  const keyByParams = (route as { keyBy?: string[] })?.keyBy ?? [];
  const engineKey = keyByParams.length > 0
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
        config={config as unknown as SDUIConfig}
        configName={configName}
        actionsConfig={app.actions as ActionsConfig}
        routes={app.routes}
        paramChangeAction={(route as { paramChangeAction?: string })?.paramChangeAction}
        dataSources={(app as { dataSources?: Record<string, NamedDataSourceDef> }).dataSources}
      />
    </main>
  );
}
