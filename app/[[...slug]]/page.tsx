'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setData } from '@/store/slices/configSlice';
import { ReduxSDUIEngine, type ActionsConfig } from '@/lib/sdui/redux-engine';
import type { SDUIConfig } from '@/lib/sdui/types';

import appConfig from '@/config/app';

type AppConfig = {
  defaultRedirect: string;
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
  const dispatch = useAppDispatch();
  const isAuthenticated = !!useAppSelector((state) =>
    (state as { config?: { data?: Record<string, unknown> } })?.config?.data?.['auth.user']
  );

  const routes = app.routes;
  const defaultRedirect = app.defaultRedirect || '/';

  // Resolve path from slug (slug is undefined for /, or ['login'] for /login)
  const path = pathname || '/';

  // Match route: exact path or dynamic route (path starts with route.path + '/')
  const route = routes.find((r) => {
    const routeConfig = r as { dynamic?: boolean };
    if (routeConfig.dynamic && path.startsWith(r.path + '/')) {
      return true;
    }
    return r.path === path;
  });

  useEffect(() => {
    dispatch(setData({ path: 'route.path', value: pathname || '/' }));
    // Extract slug for dynamic routes from config (e.g. /product/linen-blend-blazer -> linen-blend-blazer)
    const dynamicRoute = routes.find(
      (r) => (r as { dynamic?: boolean }).dynamic && path.startsWith(r.path + '/')
    );
    if (dynamicRoute) {
      const slug = path.slice(dynamicRoute.path.length + 1).split('/')[0] || '';
      dispatch(setData({ path: 'route.slug', value: slug }));
    }
  }, [pathname, path, dispatch, routes]);

  useEffect(() => {
    if (!route) {
      router.replace(defaultRedirect);
      return;
    }
    if (route.redirect) {
      router.replace(route.redirect);
      return;
    }
    if (route.auth && !isAuthenticated) {
      router.replace(defaultRedirect);
    }
  }, [route, isAuthenticated, router, defaultRedirect]);

  if (!route || route.redirect) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-typography-600">Redirecting...</p>
      </div>
    );
  }

  if (route.auth && !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-typography-600">Redirecting...</p>
      </div>
    );
  }

  const configName = route.config;
  const config = configName ? app.screens[configName] : null;

  if (!config) {
    router.replace(defaultRedirect);
    return null;
  }

  const layoutClass =
    route.layout === 'centered'
      ? 'w-full min-h-screen flex items-center justify-center'
      : 'w-full';

  return (
    <main className={layoutClass}>
      <ReduxSDUIEngine
        config={config as SDUIConfig}
        actionsConfig={app.actions as ActionsConfig}
        routes={app.routes}
      />
    </main>
  );
}
