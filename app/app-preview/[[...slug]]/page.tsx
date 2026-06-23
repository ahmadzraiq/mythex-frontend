'use client';

/**
 * /app-preview/[[...slug]]
 *
 * Renders the SDUI app for the preview subdomain (preview.localhost:3000).
 * Accessed via: http://preview.localhost:3000/?projectId=xxx
 *
 * The middleware rewrites preview.localhost:3000/path → /app-preview/path and
 * sets the preview_project_id cookie so projectId persists across navigation.
 *
 * On mount the page:
 *   1. Reads projectId from cookie or sessionStorage
 *   2. Fetches the builder-saved config from /api/projects/:id/config
 *   3. Applies theme overrides
 *   4. Renders the page matching the current path using SDUIEngine
 *
 * Navigation within the preview works normally — the middleware keeps
 * rewriting preview.localhost paths to /app-preview paths, and the cookie
 * carries the projectId forward.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { SDUINode } from '@/lib/sdui/types/node';
import appConfig from '@/config/app';
import { getGlobalVariableStore, registerVariableInitialValue } from '@/lib/sdui/global-variable-store';
import { registerGlobalFormulas } from '@/lib/sdui/formula-evaluator';
import { useSduiStore } from '@/store/sdui-store';
import { evaluateFormula } from '@/lib/sdui/formula-evaluator';
import { patchThemeColors } from '@/lib/sdui/engine-static-data';
import { loadSharedComponents } from '@/lib/builder/shared-component-data';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = appConfig as any;

const PREVIEW_COOKIE = 'preview_project_id';
const PREVIEW_TOKEN_COOKIE = 'preview_token';
const PREVIEW_SESSION_KEY = 'builder:previewProjectId';
const CONFIG_CACHE_KEY_PREFIX = 'builder:previewConfig:';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BuilderPage {
  id: string;
  name: string;
  route?: string;
  nodes: SDUINode[];
  protectionCondition?: string;
  protectionRedirect?: string;
}

interface ProjectDataSource {
  id: string;
  type: 'rest' | 'graphql';
  url?: string;
  method?: string;
  headers?: Array<{ key: string; value: string; enabled?: boolean }>;
  queryParams?: Array<{ key: string; value: string; enabled?: boolean }>;
  body?: string;
  endpoint?: string;
  query?: string;
  variables?: unknown;
  responsePath?: string;
  proxy?: boolean;
  sendCredentials?: boolean;
}

interface ProjectConfig {
  pages?: BuilderPage[];
  /** Unified workflows dict (keyed by UUID) */
  workflows?: Record<string, { trigger?: string; steps?: unknown[]; id?: string }>;
  themeOverrides?: Record<string, string>;
  themeDarkOverrides?: Record<string, string>;
  customVars?: Array<{ id?: string; type?: string; initialValue?: unknown }>;
  customColors?: Array<{ name: string; light?: string; dark?: string }>;
  sharedComponents?: Record<string, unknown>;
  pageDataSources?: ProjectDataSource[];
  formulas?: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function getProjectIdFromCookie(): string | null {
  return getCookieValue(PREVIEW_COOKIE);
}

function getPreviewToken(): string | null {
  return getCookieValue(PREVIEW_TOKEN_COOKIE);
}

function hexToRgbTriplet(value: string): string {
  if (!value.startsWith('#')) return value;
  const clean = value.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

const GLUESTACK_PRIMARY_BRIDGE = [
  '  --color-primary-400: var(--primary) !important;',
  '  --color-primary-500: var(--primary) !important;',
  '  --color-primary-600: var(--primary) !important;',
  '  --color-primary-700: var(--primary) !important;',
  '  --color-primary-800: var(--primary) !important;',
].join('\n');

/** Append-to-body so we come after ThemeStyles (which also targets body). */
function getOrCreateStyle(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    // body — not head — so this style comes after ThemeStyles in document order,
    // meaning our declarations win the CSS cascade when specificity is equal.
    (document.body ?? document.head).appendChild(el);
  }
  return el;
}

/** Inject a Google Fonts <link> tag the first time a font URL is needed. */
const PREVIEW_FONT_URLS: Record<string, string> = {
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

function injectGoogleFontIfNeeded(fontValue: string): void {
  const url = PREVIEW_FONT_URLS[fontValue.trim()];
  if (!url) return;
  const linkId = `gf-${btoa(url).replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id   = linkId;
  link.rel  = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

function applyTheme(
  light: Record<string, string>,
  dark: Record<string, string>,
  customColors: Array<{ name: string; light?: string; dark?: string }> = [],
) {
  // Merge customColors first — explicit theme overrides take precedence so a
  // theme-tab override of a custom-named color still wins.
  const mergedLight: Record<string, string> = {};
  const mergedDark:  Record<string, string> = {};
  for (const c of customColors) {
    if (!c?.name) continue;
    if (typeof c.light === 'string' && c.light) mergedLight[c.name] = c.light;
    if (typeof c.dark  === 'string' && c.dark)  mergedDark[c.name]  = c.dark;
  }
  for (const [k, v] of Object.entries(light)) mergedLight[k] = v;
  for (const [k, v] of Object.entries(dark))  mergedDark[k]  = v;

  const lightEl = getOrCreateStyle('preview-light-overrides');
  const colorLines: string[] = [];
  const fontLines:  string[] = [];
  const baseLines:  string[] = [];

  for (const [k, v] of Object.entries(mergedLight)) {
    if (v.startsWith('#')) {
      colorLines.push(`  --${k}: ${hexToRgbTriplet(v)};`);
      // Keep --theme-${k} (hex) in sync so var(--theme-background) etc. resolve correctly
      colorLines.push(`  --theme-${k}: ${v};`);
    } else if (k === 'font-heading' || k === 'font-body') {
      // Fonts MUST go on body{} — ThemeStyles also targets body and comes earlier
      // in the DOM (React renders it at the top of <body>). We're appended to the
      // end of <body>, so our later declaration wins the cascade.
      fontLines.push(`  --${k}: ${v};`);
      injectGoogleFontIfNeeded(v);
    } else {
      baseLines.push(`  --${k}: ${v};`);
    }
  }

  const parts: string[] = [];
  if (baseLines.length) parts.push(`:root {\n${baseLines.join('\n')}\n}`);
  if (fontLines.length) parts.push(`body {\n${fontLines.join('\n')}\n}`);
  parts.push(`html:not(.dark) {\n${colorLines.join('\n')}${colorLines.length ? '\n' : ''}${GLUESTACK_PRIMARY_BRIDGE}\n}`);
  lightEl.textContent = parts.join('\n\n');

  const darkEl = getOrCreateStyle('preview-dark-overrides');
  const darkVars = Object.entries(mergedDark).map(([k, v]) => {
    const isHex = v.startsWith('#');
    const rgbLine = `  --${k}: ${isHex ? hexToRgbTriplet(v) : v};`;
    // Keep --theme-${k} (hex) in sync for dark mode too
    const themeLine = isHex ? `\n  --theme-${k}: ${v};` : '';
    return rgbLine + themeLine;
  }).join('\n');
  darkEl.textContent = `html.dark {\n${darkVars ? darkVars + '\n' : ''}${GLUESTACK_PRIMARY_BRIDGE}\n}`;

  // Keep THEME_OBJ.colors in sync so formulas like theme?.['colors']?.['brand']
  // resolve to live custom-color hex values (the SDUIEngine listens for the
  // `sdui:theme-colors-patched` event dispatched by patchThemeColors and
  // re-injects merged.theme on every render).
  patchThemeColors(mergedLight, 'light');
  patchThemeColors(mergedDark, 'dark');
}

/** Seed UI-created custom variables and global formulas into runtime so they resolve in the preview. */
function seedCustomVars(cfg: ProjectConfig) {
  const vars = cfg.customVars;
  if (Array.isArray(vars) && vars.length > 0) {
    const vs = getGlobalVariableStore().getState();
    const fullState = vs.getFullState() as Record<string, unknown>;
    const patches: Record<string, unknown> = {};
    for (const v of vars) {
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
}


import type { NamedDataSourceDef, RestNamedDataSourceDef } from '@/lib/sdui/engine-types';

function buildDataSources(
  pageDataSources: ProjectDataSource[] | undefined,
): Record<string, NamedDataSourceDef> {
  if (!pageDataSources?.length) return {};
  const result: Record<string, NamedDataSourceDef> = {};
  for (const ds of pageDataSources) {
    if (ds.type === 'rest' && ds.url) {
      result[ds.id] = {
        type: 'rest',
        url: ds.url,
        method: ds.method as RestNamedDataSourceDef['method'],
        headers: ds.headers,
        queryParams: ds.queryParams,
        body: ds.body,
        responsePath: ds.responsePath,
        proxy: ds.proxy,
        sendCredentials: ds.sendCredentials,
      };
    } else if (ds.type === 'graphql' && ds.query && ds.endpoint) {
      result[ds.id] = {
        type: 'graphql',
        endpoint: ds.endpoint,
        query: ds.query,
        variables: ds.variables as Record<string, unknown> | undefined,
        responsePath: ds.responsePath,
        proxy: ds.proxy,
        sendCredentials: ds.sendCredentials,
      };
    }
  }
  return result;
}

function buildActionsConfig(config: ProjectConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [uuid, wf] of Object.entries(config.workflows ?? {})) {
    result[uuid] = { trigger: wf.trigger ?? 'click', steps: wf.steps ?? [] };
  }
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AppPreviewPage() {
  const pathname = usePathname();
  const router = useRouter();
  // Strip /app-preview prefix that the middleware adds internally
  const appPath = pathname?.replace(/^\/app-preview/, '') || '/';

  const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async (projectId: string, bustCache = false) => {
    try {
      const cacheKey = `${CONFIG_CACHE_KEY_PREFIX}${projectId}`;

      // Use the sessionStorage cache only for in-tab navigation (not reloads).
      // This avoids a backend round-trip when the user clicks a link inside the
      // preview, while still showing fresh data when they press F5 or explicitly
      // navigate back to the preview after saving changes in the builder.
      if (!bustCache) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { config: ProjectConfig; envVars?: Record<string, string> };
          const cfg = parsed.config ?? (parsed as unknown as ProjectConfig);
          if (cfg.themeOverrides || cfg.themeDarkOverrides || cfg.customColors) {
            applyTheme(cfg.themeOverrides ?? {}, cfg.themeDarkOverrides ?? {}, cfg.customColors ?? []);
          }
          if (cfg.sharedComponents && typeof cfg.sharedComponents === 'object') {
            loadSharedComponents(cfg.sharedComponents);
          }
          seedCustomVars(cfg);
          if (parsed.envVars) useSduiStore.getState().setData('env', parsed.envVars);
          setProjectConfig(cfg);
          setLoading(false);
          return;
        }
      }

      // Always evict the stale cache entry before fetching fresh data.
      sessionStorage.removeItem(cacheKey);

      // Authenticated preview (builder "Preview" button) sends a preview_token cookie.
      // Public deploy subdomain has no preview_token — use the public-config endpoint.
      const token = getPreviewToken();

      let res: Response;
      if (token) {
        res = await fetch(`/api/projects/${projectId}/preview-config`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } else {
        res = await fetch(`/api/projects/${projectId}/public-config`);
      }

      if (!res.ok) {
        setError(`Could not load project (HTTP ${res.status}). Make sure the project is deployed.`);
        setLoading(false);
        return;
      }
      const data = await res.json() as { config?: ProjectConfig; envVars?: Record<string, string> };
      const cfg = data.config ?? {};

      // Inject env vars into the SDUI store so formulas can access env['KEY']
      if (data.envVars && typeof data.envVars === 'object') {
        useSduiStore.getState().setData('env', data.envVars);
      }

      // Cache in sessionStorage — valid for this tab's lifetime (1 hour token)
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ config: cfg, envVars: data.envVars ?? {} })); } catch { /* quota */ }

      // Apply theme overrides + custom colors (custom colors are user-defined
      // theme tokens; they need both the CSS vars and THEME_OBJ patched so
      // formulas like theme?.['colors']?.['brand'] resolve in preview).
      if (cfg.themeOverrides || cfg.themeDarkOverrides || cfg.customColors) {
        applyTheme(cfg.themeOverrides ?? {}, cfg.themeDarkOverrides ?? {}, cfg.customColors ?? []);
      }

      // Restore any shared component models saved by the builder (including
      // template-imported SCs that don't exist in the static JSON file).
      if (cfg.sharedComponents && typeof cfg.sharedComponents === 'object') {
        loadSharedComponents(cfg.sharedComponents);
      }
      // Seed UI-created custom variables into the global store
      seedCustomVars(cfg);

      setProjectConfig(cfg);
    } catch (err) {
      setError(`Failed to load project: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('preview-mode');
    return () => document.documentElement.classList.remove('preview-mode');
  }, []);

  useEffect(() => {
    // Resolve projectId: URL query (on first load) → cookie → sessionStorage
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('projectId');

    let projectId = fromUrl
      ?? getProjectIdFromCookie()
      ?? sessionStorage.getItem(PREVIEW_SESSION_KEY);

    if (fromUrl) {
      // Persist in sessionStorage so it survives navigation
      sessionStorage.setItem(PREVIEW_SESSION_KEY, fromUrl);
      projectId = fromUrl;
    }

    if (!projectId) {
      setError('No project ID found. Open the preview from the builder by clicking the Preview button.');
      setLoading(false);
      return;
    }

    // Bust the sessionStorage cache when:
    //  - the user explicitly reloads (F5 / Cmd+R), OR
    //  - the preview was opened from the builder (carries ?_t= cache-bust param)
    const isReload =
      typeof performance !== 'undefined' &&
      (
        (performance.getEntriesByType?.('navigation') as PerformanceNavigationTiming[] | undefined)
          ?.[0]?.type === 'reload' ||
        (performance.navigation as { type?: number } | undefined)?.type === 1
      );
    const hasBuilderBust = params.has('_t');

    void fetchConfig(projectId, isReload || hasBuilderBust);
  }, [fetchConfig]);

  // Find the page matching the current app path
  const currentPage = useMemo<BuilderPage | null>(() => {
    if (!projectConfig?.pages?.length) return null;
    const pages = projectConfig.pages;

    // Exact match first
    const exact = pages.find(p => (p.route ?? '/') === appPath);
    if (exact) return exact;

    // Dynamic route match (prefix)
    const dynamic = pages.find(p => p.route && appPath.startsWith(p.route + '/'));
    if (dynamic) return dynamic;

    // Home fallback
    return pages.find(p => p.route === '/' || !p.route) ?? pages[0];
  }, [projectConfig, appPath]);

  // Protection guard is evaluated synchronously in the render path below.

  const sdui = useMemo<SDUIConfig>(() => ({
    state: {},
    ui: {
      type: 'Box',
      props: { className: 'flex flex-col w-full min-h-screen relative' },
      children: (currentPage?.nodes ?? []) as SDUINode[],
    } as SDUIConfig['ui'],
  }), [currentPage]);

  const actionsConfig = useMemo(() => {
    if (!projectConfig) return {};
    return {
      ...(app.actions ?? {}),
      ...buildActionsConfig(projectConfig),
    };
  }, [projectConfig]);

  const dataSources = useMemo(() => ({
    ...(app.dataSources ?? {}),
    ...buildDataSources(projectConfig?.pageDataSources),
  }), [projectConfig?.pageDataSources]);

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#0f172a', color: '#94a3b8',
        fontFamily: 'system-ui, sans-serif', gap: 12,
      }}>
        <div style={{
          width: 28, height: 28,
          border: '2px solid #3b82f6', borderTopColor: 'transparent',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span style={{ fontSize: 13 }}>Loading preview…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#0f172a', color: '#f87171',
        fontFamily: 'system-ui, sans-serif', gap: 8, padding: '0 24px',
        textAlign: 'center',
      }}>
        <span style={{ fontSize: 24 }}>⚠</span>
        <p style={{ fontSize: 14, maxWidth: 360, lineHeight: 1.5, color: '#94a3b8' }}>{error}</p>
      </div>
    );
  }

  if (!currentPage) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#0f172a', color: '#94a3b8',
        fontFamily: 'system-ui, sans-serif', fontSize: 14,
      }}>
        No pages found in this project. Add a page in the builder first.
      </div>
    );
  }

  // Protection guard — synchronous check before SDUIEngine mounts so no
  // datasource fetches fire on a page the user isn't allowed to see.
  if (currentPage.protectionCondition) {
    const mergedState = {
      ...useSduiStore.getState().data,
      ...getGlobalVariableStore().getState().getFullState(),
    };
    const allowed = evaluateFormula(currentPage.protectionCondition, mergedState).value;
    if (!allowed) {
      router.replace(currentPage.protectionRedirect ?? '/');
      return null;
    }
  }

  return (
    <SDUIEngine
      config={sdui}
      configName={appPath.replace(/[^a-zA-Z0-9]/g, '_') || 'preview'}
      actionsConfig={actionsConfig}
      routes={app.routes ?? []}
      dataSources={dataSources}
    />
  );
}
