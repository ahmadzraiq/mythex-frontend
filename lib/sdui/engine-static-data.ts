/**
 * Engine static data
 *
 * Module-level constants derived from config files (routes.json, theme.json).
 * Extracted from sdui-engine.tsx so that file stays focused on runtime behaviour.
 * THEME_OBJ.colors starts from the static config but is kept live via patchThemeColors().
 */

import routesConfig from '@/config/routes.json';
import themeConfig from '@/config/theme.json';

/** Static pages map built from config/routes.json — keyed by route config name (or UUID if present) */
export const PAGES_MAP: Record<string, {
  id: string; name: string; path: string; dynamic: boolean; auth: boolean;
}> = {};
{
  type RouteEntry = { path: string; config: string; id?: string; auth?: boolean; dynamic?: boolean };
  const routes = (routesConfig as { routes?: RouteEntry[] }).routes ?? [];
  for (const r of routes) {
    const key = r.id ?? r.config;
    PAGES_MAP[key] = {
      id: r.id ?? r.config,
      name: r.config,
      path: r.path,
      dynamic: r.dynamic ?? false,
      auth: r.auth ?? false,
    };
  }
}

/** Adds hyphenated aliases for every camelCase key in a color map (mutates in place). */
function _addHyphenatedAliases(map: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(map)) {
    const hyphenated = k.replace(/([A-Z])/g, (_, c: string) => `-${c.toLowerCase()}`);
    if (hyphenated !== k) map[hyphenated] = v;
  }
}

/** Static theme object built from config/theme.json */
const _rawColors = (themeConfig as Record<string, unknown>).colors as Record<string, unknown> ?? {};
const _colorsWithAliases: Record<string, unknown> = { ..._rawColors };
_addHyphenatedAliases(_colorsWithAliases);

const _rawColorsDark = (themeConfig as Record<string, unknown>).colorsDark as Record<string, unknown> ?? {};
const _colorsDarkWithAliases: Record<string, unknown> = { ..._rawColorsDark };
_addHyphenatedAliases(_colorsDarkWithAliases);

export const THEME_OBJ: Record<string, unknown> = {
  colors: _colorsWithAliases,
  colorsDark: _colorsDarkWithAliases,
  sections: (themeConfig as Record<string, unknown>).sections ?? {},
  sectionsDark: (themeConfig as Record<string, unknown>).sectionsDark ?? {},
  fonts: (themeConfig as Record<string, unknown>).fonts ?? {},
  cssVariables: (themeConfig as Record<string, unknown>).cssVariables ?? {},
  /** Border-radius token → Tailwind class, e.g. theme?.['radius']?.['sm'] → 'rounded-sm' */
  radius: {
    none: 'rounded-none', sm: 'rounded-sm', base: 'rounded',
    md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl',
    '2xl': 'rounded-2xl', '3xl': 'rounded-3xl', full: 'rounded-full',
  },
};

/**
 * Merges dynamic theme overrides (light or dark) into THEME_OBJ.colors / colorsDark so that
 * formula expressions like theme?.['colors']?.['primary-foreground'] reflect the live theme.
 *
 * Keys must be the hyphenated CSS-variable name without '--' (e.g. 'primary-foreground').
 * Values must be hex strings (e.g. '#ffffff').
 *
 * Call from _applyLightOverrides() and applyBuilderTheme() whenever overrides are applied.
 */
export function patchThemeColors(
  overrides: Record<string, string>,
  mode: 'light' | 'dark' = 'light',
): void {
  const existing = (mode === 'dark' ? THEME_OBJ.colorsDark : THEME_OBJ.colors) as Record<string, unknown>;
  const updated: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v !== 'string') continue;
    // Store under the supplied key (hyphenated) and also under camelCase alias.
    updated[k] = v;
    const camel = k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel !== k) updated[camel] = v;
  }
  // Replace with a new object reference so React subscribers detect the change.
  if (mode === 'dark') {
    THEME_OBJ.colorsDark = updated;
  } else {
    THEME_OBJ.colors = updated;
  }
  // Notify the engine to re-inject the updated theme into merged state.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sdui:theme-colors-patched'));
  }
}
