'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSduiStore } from '@/store/sdui-store';
import { SDUIEngine, paramChangeRunActionRef, type ActionsConfig, type NamedDataSourceDef } from '@/lib/sdui/sdui-engine';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import { syncSearchParams } from '@/lib/sdui/search-param-sync';
import { sortRoutes, matchRoute } from '@/lib/sdui/route-utils';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { AppConfig, PageUI } from '@/config/types';
import type { SDUINode } from '@/lib/sdui/types/node';

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

// ── Builder live-preview bridge ───────────────────────────────────────────────
// When running on preview-dev.localhost, the builder sends the current page's
// nodes + workflows via postMessage instead of writing to localStorage (which
// is not shared across different subdomains).

interface BuilderLiveConfig {
  nodes?: SDUINode[];
  pageWorkflows?: Record<string, unknown[]>;
  pageWorkflowMeta?: Record<string, Record<string, unknown>>;
  globalWorkflows?: Record<string, unknown[]>;
  globalWorkflowMeta?: Record<string, Record<string, unknown>>;
  themeOverrides?: Record<string, string>;
  themeDarkOverrides?: Record<string, string>;
}

function hexToRgbTriplet(hex: string): string {
  if (!hex.startsWith('#')) return hex;
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return `${parseInt(full.slice(0, 2), 16)} ${parseInt(full.slice(2, 4), 16)} ${parseInt(full.slice(4, 6), 16)}`;
}

function applyBuilderTheme(light: Record<string, string>, dark: Record<string, string>) {
  const getOrCreate = (id: string) => {
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    return el;
  };
  const lightLines: string[] = [];
  const colorLines: string[] = [];
  for (const [k, v] of Object.entries(light)) {
    if (v.startsWith('#')) colorLines.push(`  --${k}: ${hexToRgbTriplet(v)};`);
    else lightLines.push(`  --${k}: ${v};`);
  }
  const parts: string[] = [];
  if (lightLines.length) parts.push(`:root {\n${lightLines.join('\n')}\n}`);
  if (colorLines.length) parts.push(`html:not(.dark) {\n${colorLines.join('\n')}\n}`);
  getOrCreate('builder-live-light').textContent = parts.join('\n\n');
  const darkVars = Object.entries(dark).map(([k, v]) => `  --${k}: ${hexToRgbTriplet(v)};`).join('\n');
  getOrCreate('builder-live-dark').textContent = darkVars ? `html.dark {\n${darkVars}\n}` : '';
}

function buildLiveActionsConfig(cfg: BuilderLiveConfig): ActionsConfig {
  const result: Record<string, unknown> = {};
  const add = (wfs?: Record<string, unknown[]>, meta?: Record<string, Record<string, unknown>>) => {
    if (!wfs) return;
    for (const [uuid, steps] of Object.entries(wfs)) {
      result[uuid] = { type: 'workflowSteps', trigger: meta?.[uuid]?.trigger ?? 'click', steps };
    }
  };
  add(cfg.pageWorkflows, cfg.pageWorkflowMeta);
  add(cfg.globalWorkflows, cfg.globalWorkflowMeta);
  return result as ActionsConfig;
}
// ─────────────────────────────────────────────────────────────────────────────

export default function DynamicRoutePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setData = useSduiStore((s) => s.setData);
  const isAuthenticated = !!useSduiStore((s) => s.data[AUTH_USER_PATH]);

  // Receives live config from the builder via postMessage (preview-dev only)
  const [builderLive, setBuilderLive] = useState<BuilderLiveConfig | null>(null);

  // Set up postMessage bridge — only active on preview-dev subdomain
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.hostname.startsWith('preview-dev.')) return;

    // Tell the builder we're ready to receive config
    window.opener?.postMessage({ type: 'PREVIEW_READY' }, '*');

    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'BUILDER_LIVE_CONFIG') return;
      const cfg = e.data.config as BuilderLiveConfig;
      setBuilderLive(cfg);
      if (cfg.themeOverrides || cfg.themeDarkOverrides) {
        applyBuilderTheme(cfg.themeOverrides ?? {}, cfg.themeDarkOverrides ?? {});
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

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

  // When the builder sends a live config (preview-dev mode), override the
  // static screen config with the builder's current nodes + workflows.
  const effectiveConfig: SDUIConfig = builderLive
    ? {
        state: {},
        ui: {
          type: 'Box',
          props: { className: 'flex flex-col w-full min-h-screen' },
          children: (builderLive.nodes ?? []) as SDUINode[],
        } as SDUIConfig['ui'],
      }
    : config as unknown as SDUIConfig;

  const effectiveActions: ActionsConfig = builderLive
    ? { ...(app.actions as ActionsConfig), ...buildLiveActionsConfig(builderLive) }
    : app.actions as ActionsConfig;

  return (
    <main className={layoutClass}>
      <SDUIEngine
        key={engineKey}
        config={effectiveConfig}
        configName={configName}
        actionsConfig={effectiveActions}
        routes={app.routes}
        paramChangeAction={(route as { paramChangeAction?: string })?.paramChangeAction}
        dataSources={(app as { dataSources?: Record<string, NamedDataSourceDef> }).dataSources}
      />
    </main>
  );
}
