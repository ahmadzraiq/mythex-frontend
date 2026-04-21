'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSduiStore } from '@/store/sdui-store';
import { SDUIEngine, paramChangeRunActionRef, startupRunActionRef, type ActionsConfig, type NamedDataSourceDef } from '@/lib/sdui/sdui-engine';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import { syncSearchParams } from '@/lib/sdui/search-param-sync';
import { sortRoutes, matchRoute } from '@/lib/sdui/route-utils';
import { evaluateFormula } from '@/lib/sdui/formula-evaluator';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { AppConfig, PageUI } from '@/config/types';
import type { SDUINode } from '@/lib/sdui/types/node';

import appConfig from '@/config/app';
import variablesJson from '@/config/variables.json';
import { patchThemeColors } from '@/lib/sdui/engine-static-data';
import { buildSyncDefsFromVariables } from '@/lib/sdui/search-param-sync';

const AUTH_USER_PATH = 'auth.user';
const ROUTE_PATH = 'route.path';
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
  customVars?: Array<{ id?: string; type?: string; initialValue?: unknown }>;
}

function hexToRgbTriplet(hex: string): string {
  if (!hex.startsWith('#')) return hex;
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return `${parseInt(full.slice(0, 2), 16)} ${parseInt(full.slice(2, 4), 16)} ${parseInt(full.slice(4, 6), 16)}`;
}

const LIVE_FONT_URLS: Record<string, string> = {
  "'Inter', sans-serif":              'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  "'DM Sans', sans-serif":            'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
  "'Space Grotesk', sans-serif":      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap',
  "'Nunito', sans-serif":             'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap',
  "'Poppins', sans-serif":            'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
  "'Montserrat', sans-serif":         'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap',
  "'Raleway', sans-serif":            'https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700&display=swap',
  "'Josefin Sans', sans-serif":       'https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;500;600;700&display=swap',
  "'Jost', sans-serif":               'https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&display=swap',
  "'Open Sans', sans-serif":          'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap',
  "'Roboto', sans-serif":             'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  "'Comfortaa', cursive":             'https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;600;700&display=swap',
  "'Playfair Display', serif":        'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap',
  "'Lora', serif":                    'https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&display=swap',
  "'Merriweather', serif":            'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap',
  "'Fraunces', serif":                'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&display=swap',
  "'Cormorant Garamond', serif":      'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&display=swap',
  "'Crimson Text', serif":            'https://fonts.googleapis.com/css2?family=Crimson+Text:wght@400;600;700&display=swap',
  "'Source Sans 3', sans-serif":      'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap',
  "'Roboto Mono', monospace":         'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&display=swap',
};

function injectLiveFontIfNeeded(fontValue: string): void {
  const url = LIVE_FONT_URLS[fontValue.trim()];
  if (!url) return;
  const linkId = `gf-${btoa(url).replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id   = linkId;
  link.rel  = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

function applyBuilderTheme(light: Record<string, string>, dark: Record<string, string>) {
  const getOrCreate = (id: string) => {
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      // Append to body so we come after ThemeStyles in document order (same fix
      // as _store-node-helpers.ts — ThemeStyles renders at the start of <body>).
      (document.body ?? document.head).appendChild(el);
    }
    return el;
  };

  const colorLines: string[] = [];
  const fontLines:  string[] = [];
  const baseLines:  string[] = [];

  for (const [k, v] of Object.entries(light)) {
    if (v.startsWith('#')) {
      colorLines.push(`  --${k}: ${hexToRgbTriplet(v)};`);
    } else if (k === 'font-heading' || k === 'font-body') {
      fontLines.push(`  --${k}: ${v};`);
      injectLiveFontIfNeeded(v);
    } else {
      baseLines.push(`  --${k}: ${v};`);
    }
  }

  const parts: string[] = [];
  if (baseLines.length) parts.push(`:root {\n${baseLines.join('\n')}\n}`);
  if (fontLines.length) parts.push(`body {\n${fontLines.join('\n')}\n}`);
  if (colorLines.length) parts.push(`html:not(.dark) {\n${colorLines.join('\n')}\n}`);
  getOrCreate('builder-live-light').textContent = parts.join('\n\n');

  const darkVars = Object.entries(dark).map(([k, v]) => `  --${k}: ${hexToRgbTriplet(v)};`).join('\n');
  getOrCreate('builder-live-dark').textContent = darkVars ? `html.dark {\n${darkVars}\n}` : '';

  // Keep THEME_OBJ.colors in sync so formula expressions like
  // theme?.['colors']?.['primary-foreground'] resolve to the server-loaded hex value.
  patchThemeColors(light, 'light');
  patchThemeColors(dark, 'dark');
}

function buildLiveActionsConfig(cfg: BuilderLiveConfig): ActionsConfig {
  const result: Record<string, unknown> = {};
  const add = (wfs?: Record<string, unknown[]>, meta?: Record<string, Record<string, unknown>>) => {
    if (!wfs) return;
    for (const [uuid, steps] of Object.entries(wfs)) {
      result[uuid] = { trigger: meta?.[uuid]?.trigger ?? 'click', steps };
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
  const sessionRestored = useSduiStore((s) => s.sessionRestored);
  // Track whether the startup action has been fired once per mount
  const startupFiredRef = useRef(false);

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
      // Seed UI-created custom variables into the global store so
      // formulas like variables['uuid'] resolve in the preview.
      if (Array.isArray(cfg.customVars) && cfg.customVars.length > 0) {
        const vs = getGlobalVariableStore().getState();
        const fullState = vs.getFullState() as Record<string, unknown>;
        const patches: Record<string, unknown> = {};
        for (const v of cfg.customVars) {
          if (v.id && !(v.id in fullState)) {
            patches[v.id] = v.initialValue ?? null;
          }
        }
        if (Object.keys(patches).length > 0) {
          vs.setState((prev: Record<string, unknown>) => ({ ...prev, ...patches }));
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const routes = app.routes;
  const authConfig = (app as AppConfig).authConfig;
  const defaultRedirect = authConfig?.unauthenticatedRedirect ?? app.defaultRedirect ?? '/sign-in';
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

  // Fire the startup action (restoreSession) exactly once per page mount.
  // Must run BEFORE the auth guard effect so sessionRestored is set first.
  useEffect(() => {
    if (startupFiredRef.current) return;
    startupFiredRef.current = true;
    const startupAction = (app as AppConfig).startupAction;
    if (startupAction) {
      setTimeout(() => {
        if (startupRunActionRef.current) {
          startupRunActionRef.current(startupAction);
        } else {
          useSduiStore.getState().setSessionRestored(true);
        }
      }, 0);
    } else {
      useSduiStore.getState().setSessionRestored(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auth route guard — runs after session restore completes.
  useEffect(() => {
    if (!sessionRestored) return;

    if (route?.redirect) {
      router.replace(route.redirect);
      return;
    }

    const routeTyped = route as (typeof routes)[0] | null;

    // guestOnly: redirect authenticated users away (e.g. /sign-in when already logged in)
    if (routeTyped?.guestOnly && isAuthenticated) {
      router.replace(authConfig?.authenticatedRedirect ?? '/');
      return;
    }

    // auth: redirect unauthenticated users to login, storing the intended path
    if (routeTyped?.auth && !isAuthenticated) {
      const REDIRECT_AFTER_LOGIN_UUID = 'c1d2e3f4-a5b6-7890-cdef-123456789012';
      getGlobalVariableStore().getState().setState((prev: Record<string, unknown>) => ({
        ...prev,
        [REDIRECT_AFTER_LOGIN_UUID]: pathname,
      }));
      router.replace(defaultRedirect);
      return;
    }

    // accessCondition: redirect authenticated users who fail the formula condition
    if (routeTyped?.auth && isAuthenticated && routeTyped?.accessCondition) {
      const mergedState = {
        ...useSduiStore.getState().data,
        ...getGlobalVariableStore().getState().getFullState(),
      };
      const allowed = evaluateFormula(routeTyped.accessCondition, mergedState).value;
      if (!allowed) {
        router.replace(authConfig?.unauthorizedRedirect ?? '/');
      }
    }
  }, [route, isAuthenticated, sessionRestored, router, defaultRedirect, pathname, authConfig]);

  const ui = (app.ui ?? {}) as PageUI;
  const redirecting = ui.redirecting ?? { text: 'Redirecting...', wrapperClassName: 'flex items-center justify-center min-h-screen', textClassName: 'text-[var(--theme-muted-foreground)]' };
  const pageNotFound = ui.pageNotFound ?? { text: 'Page not found', wrapperClassName: 'flex items-center justify-center min-h-screen', textClassName: 'text-[var(--theme-muted-foreground)]' };
  const layoutClasses = ui.layoutClasses ?? { centered: 'w-full min-h-screen flex items-center justify-center', full: 'w-full' };

  if (route?.redirect) {
    return (
      <div className={redirecting.wrapperClassName}>
        <p className={redirecting.textClassName}>{redirecting.text}</p>
      </div>
    );
  }

  const routeTyped = route as (typeof routes)[0] | null;

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
          props: { className: 'flex flex-col w-full min-h-screen items-start relative' },
          children: (builderLive.nodes ?? []) as SDUINode[],
        } as SDUIConfig['ui'],
      }
    : config as unknown as SDUIConfig;

  const effectiveActions: ActionsConfig = builderLive
    ? { ...(app.actions as ActionsConfig), ...buildLiveActionsConfig(builderLive) }
    : app.actions as ActionsConfig;

  // Determine whether we should cover the page while session is being restored
  // or while a redirect is pending (auth/guestOnly). We render the engine always
  // so it can mount, register paramChangeRunActionRef, and run startupAction —
  // otherwise restoreSession never fires and the spinner loops forever.
  const needsCover = !sessionRestored
    || (routeTyped?.auth && !isAuthenticated)
    || (routeTyped?.guestOnly && isAuthenticated);

  return (
    <main className={layoutClass} style={{ position: 'relative' }}>
      <SDUIEngine
        key={engineKey}
        config={effectiveConfig}
        configName={configName}
        actionsConfig={effectiveActions}
        routes={app.routes}
        paramChangeAction={(route as { paramChangeAction?: string })?.paramChangeAction}
        authConfig={authConfig}
        dataSources={(app as { dataSources?: Record<string, NamedDataSourceDef> }).dataSources}
      />
      {needsCover && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--theme-background, #fff)',
          }}
        >
          <p className={redirecting.textClassName}>{redirecting.text}</p>
        </div>
      )}
    </main>
  );
}
