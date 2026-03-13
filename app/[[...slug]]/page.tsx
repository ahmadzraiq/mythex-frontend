'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSduiStore } from '@/store/sdui-store';
import { SDUIEngine, paramChangeRunActionRef, type ActionsConfig, type NamedDataSourceDef } from '@/lib/sdui/sdui-engine';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import { syncSearchParams } from '@/lib/sdui/search-param-sync';
import { sortRoutes, matchRoute } from '@/lib/sdui/route-utils';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { AppConfig, PageUI } from '@/config/types';

import appConfig from '@/config/app';
import variablesJson from '@/config/variables.json';
import { buildSyncDefsFromVariables } from '@/lib/sdui/search-param-sync';

const AUTH_USER_PATH = 'auth.user';
const ROUTE_PATH = 'route.path';
const ROUTE_SLUG = 'route.slug';
const syncDefs = buildSyncDefsFromVariables(
  (variablesJson as { variables?: Record<string, unknown> }).variables ?? {}
);

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
      const segments = path.slice(dynamicRoute.path.length + 1).split('/');
      const namedParams = (dynamicRoute as { params?: string[] }).params;
      if (namedParams && namedParams.length > 0) {
        // Extract named params (e.g. params: ["slug"] or params: ["id", "name"])
        for (const [i, paramName] of namedParams.entries()) {
          const paramValue = segments[i] ?? '';
          const paramStorePath = `route.${paramName}`;
          const currentVal = useSduiStore.getState().data[paramStorePath];
          if (currentVal !== paramValue) {
            setData(paramStorePath, paramValue);
          }
        }
      } else {
        // Legacy fallback: first segment becomes route.slug
        const slug = segments[0] || '';
        const currentSlug = useSduiStore.getState().data[ROUTE_SLUG];
        if (currentSlug !== slug) {
          setData(ROUTE_SLUG, slug);
        }
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
