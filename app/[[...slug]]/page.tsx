'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSduiStore } from '@/store/sdui-store';
import { SDUIEngine, paramChangeRunActionRef, type ActionsConfig, type NamedDataSourceDef } from '@/lib/sdui/sdui-engine';
import { getGlobalVariableStore, registerVariableInitialValue } from '@/lib/sdui/global-variable-store';
import { syncSearchParams } from '@/lib/sdui/search-param-sync';
import { sortRoutes, matchRoute } from '@/lib/sdui/route-utils';
import { evaluateFormula, registerGlobalFormulas } from '@/lib/sdui/formula-evaluator';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { AppConfig, PageUI } from '@/config/types';
import type { SDUINode } from '@/lib/sdui/types/node';

import appConfig from '@/config/app';
import variablesJson from '@/config/variables.json';
import { patchThemeColors } from '@/lib/sdui/engine-static-data';
import { buildSyncDefsFromVariables } from '@/lib/sdui/search-param-sync';

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
  workflows?: Record<string, { id: string; name?: string; trigger?: string; isTrigger?: boolean; isAppTrigger?: boolean; pageScope?: string; steps: unknown[]; params?: unknown[] }>;
  themeOverrides?: Record<string, string>;
  themeDarkOverrides?: Record<string, string>;
  customVars?: Array<{ id?: string; type?: string; initialValue?: unknown }>;
  customColors?: Array<{ name: string; light?: string; dark?: string }>;
  sharedComponents?: Record<string, unknown>;
  formulas?: Record<string, unknown>;
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

function applyBuilderTheme(
  light: Record<string, string>,
  dark: Record<string, string>,
  customColors: Array<{ name: string; light?: string; dark?: string }> = [],
) {
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

  // Merge customColors first; explicit theme overrides take precedence so the
  // user can still shadow a custom color with a theme-tab override.
  const mergedLight: Record<string, string> = {};
  const mergedDark:  Record<string, string> = {};
  for (const c of customColors) {
    if (!c?.name) continue;
    if (typeof c.light === 'string' && c.light) mergedLight[c.name] = c.light;
    if (typeof c.dark  === 'string' && c.dark)  mergedDark[c.name]  = c.dark;
  }
  for (const [k, v] of Object.entries(light)) mergedLight[k] = v;
  for (const [k, v] of Object.entries(dark))  mergedDark[k]  = v;

  const colorLines: string[] = [];
  const fontLines:  string[] = [];
  const baseLines:  string[] = [];

  for (const [k, v] of Object.entries(mergedLight)) {
    if (v.startsWith('#')) {
      colorLines.push(`  --${k}: ${hexToRgbTriplet(v)};`);
      // Keep --theme-${k} (hex) in sync so var(--theme-X) lookups resolve.
      colorLines.push(`  --theme-${k}: ${v};`);
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

  const darkVars = Object.entries(mergedDark).map(([k, v]) => {
    const isHex = v.startsWith('#');
    const triplet = `  --${k}: ${isHex ? hexToRgbTriplet(v) : v};`;
    return isHex ? `${triplet}\n  --theme-${k}: ${v};` : triplet;
  }).join('\n');
  getOrCreate('builder-live-dark').textContent = darkVars ? `html.dark {\n${darkVars}\n}` : '';

  // Keep THEME_OBJ.colors in sync so formula expressions like
  // theme?.['colors']?.['primary-foreground'] resolve to the server-loaded hex value.
  patchThemeColors(mergedLight, 'light');
  patchThemeColors(mergedDark, 'dark');
}

function buildLiveActionsConfig(cfg: BuilderLiveConfig): ActionsConfig {
  const result: Record<string, unknown> = {};

  // New format: unified workflows dict — WorkflowDef entries keyed by id.
  // Preserve ALL WorkflowDef fields (isTrigger, pageScope, isAppTrigger, name) so
  // the engine's trigger detection (appLoad, pageLoad, collectionFetchError, etc.)
  // continues to work when this config overrides the base app.actions entries.
  if (cfg.workflows) {
    for (const [id, wf] of Object.entries(cfg.workflows)) {
      result[id] = {
        trigger: wf.trigger ?? 'click',
        steps: wf.steps,
        params: wf.params,
        ...(wf.name !== undefined ? { name: wf.name } : {}),
        ...(wf.isTrigger !== undefined ? { isTrigger: wf.isTrigger } : {}),
        ...(wf.isAppTrigger !== undefined ? { isAppTrigger: wf.isAppTrigger } : {}),
        ...(wf.pageScope !== undefined ? { pageScope: wf.pageScope } : {}),
      };
    }
  }

  return result as ActionsConfig;
}
// ─────────────────────────────────────────────────────────────────────────────

export default function DynamicRoutePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setData = useSduiStore((s) => s.setData);

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
      if (cfg.themeOverrides || cfg.themeDarkOverrides || cfg.customColors) {
        applyBuilderTheme(cfg.themeOverrides ?? {}, cfg.themeDarkOverrides ?? {}, cfg.customColors ?? []);
      }
      // Load any template-imported shared components sent by the builder so
      // component-scoped variables resolve correctly in the preview.
      if (cfg.sharedComponents && typeof cfg.sharedComponents === 'object') {
        try {
          const { loadSharedComponents } = require('@/lib/builder/shared-component-data') as typeof import('@/lib/builder/shared-component-data');
          loadSharedComponents(cfg.sharedComponents);
        } catch { /* non-fatal */ }
      }
      // Seed UI-created custom variables into the global store so
      // formulas like variables['uuid'] resolve in the preview.
      if (Array.isArray(cfg.customVars) && cfg.customVars.length > 0) {
        const vs = getGlobalVariableStore().getState();
        const fullState = vs.getFullState() as Record<string, unknown>;
        const patches: Record<string, unknown> = {};
        for (const v of cfg.customVars) {
          if (v.id) {
            registerVariableInitialValue(v.id, v.initialValue);
            if (!(v.id in fullState)) {
              patches[v.id] = v.initialValue ?? null;
            }
          }
        }
        if (Object.keys(patches).length > 0) {
          vs.setState((prev: Record<string, unknown>) => ({ ...prev, ...patches }));
        }
      }
      // Register global formulas so __userFns__['name'](...) resolves in JS bindings.
      if (cfg.formulas && typeof cfg.formulas === 'object') {
        registerGlobalFormulas(cfg.formulas);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const routes = app.routes;
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

  // Route redirect (static)
  useEffect(() => {
    if (route?.redirect) router.replace(route.redirect);
  }, [route?.redirect, router]);

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

  // Protection guard — evaluated synchronously during render so the page never
  // mounts (and never fires any datasource fetches) when access is denied.
  if (routeTyped?.protectionCondition) {
    const mergedState = {
      ...useSduiStore.getState().data,
      ...getGlobalVariableStore().getState().getFullState(),
    };
    const allowed = evaluateFormula(routeTyped.protectionCondition, mergedState).value;
    if (!allowed) {
      router.replace(routeTyped.protectionRedirect ?? '/');
      return (
        <div className={redirecting.wrapperClassName}>
          <p className={redirecting.textClassName}>{redirecting.text}</p>
        </div>
      );
    }
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
          props: { className: 'flex flex-col w-full min-h-screen relative' },
          children: (builderLive.nodes ?? []) as SDUINode[],
        } as SDUIConfig['ui'],
      }
    : config as unknown as SDUIConfig;

  const effectiveActions: ActionsConfig = builderLive
    ? { ...(app.actions as ActionsConfig), ...buildLiveActionsConfig(builderLive) }
    : app.actions as ActionsConfig;

  return (
    <main className={layoutClass} style={{ position: 'relative' }}>
      <SDUIEngine
        key={engineKey}
        config={effectiveConfig}
        configName={configName}
        actionsConfig={effectiveActions}
        routes={app.routes}
        paramChangeAction={(route as { paramChangeAction?: string })?.paramChangeAction}
        dataSources={(app as { dataSources?: Record<string, NamedDataSourceDef> }).dataSources}
      />
      {false && (
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
