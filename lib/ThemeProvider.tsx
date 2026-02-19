'use client';

import { useEffect } from 'react';

/**
 * Applies theme from config/theme.json to document root.
 * Theme colors can be used via CSS variables: --theme-bg, --theme-text, etc.
 */
export function ThemeProvider({ children, theme }: { children: React.ReactNode; theme?: Record<string, unknown> }) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme?.colors) {
      const colors = theme.colors as Record<string, string>;
      for (const [key, value] of Object.entries(colors)) {
        const varName = `--theme-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
        root.style.setProperty(varName, value);
      }
    }
    if (theme?.sections) {
      const sections = theme.sections as Record<string, Record<string, string>>;
      for (const [sectionName, sectionColors] of Object.entries(sections)) {
        for (const [key, value] of Object.entries(sectionColors)) {
          const varName = `--theme-${sectionName}-${key}`;
          root.style.setProperty(varName, value);
        }
      }
    }
  }, [theme]);

  return <>{children}</>;
}
