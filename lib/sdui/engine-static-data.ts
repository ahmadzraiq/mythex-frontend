/**
 * Engine static data
 *
 * Module-level constants derived from config files (routes.json, theme.json).
 * Extracted from sdui-engine.tsx so that file stays focused on runtime behaviour.
 * These objects are built once at module-init time and never mutated.
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

/** Static theme object built from config/theme.json */
export const THEME_OBJ: Record<string, unknown> = {
  colors: (themeConfig as Record<string, unknown>).colors ?? {},
  colorsDark: (themeConfig as Record<string, unknown>).colorsDark ?? {},
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
