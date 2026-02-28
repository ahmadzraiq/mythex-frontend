/**
 * Injects all design tokens from config/theme.json as CSS variables.
 *
 * Outputs three blocks:
 *  1. :root { --primary: R G B; --radius: ...; ... }  — standard design-system vars
 *  2. .dark { --primary: R G B; ... }                 — dark-mode overrides
 *  3. :root { --theme-section-key: #hex; ... }        — section-level theme vars
 *
 * Colors in cssVariables are stored as hex in JSON and converted to RGB triplets
 * here so that tailwind.config.js can use them as `rgb(var(--primary)/<alpha-value>)`.
 */
import themeConfig from '@/config/theme';

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function isHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function buildVarBlock(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => {
      const cssValue = isHex(value) ? hexToRgb(value) : value;
      return `  ${name}: ${cssValue}`;
    })
    .join(';\n');
}

export function ThemeStyles() {
  const cssBlocks: string[] = [];

  const theme = themeConfig as {
    cssVariables?: {
      root?: Record<string, string>;
      dark?: Record<string, string>;
    };
    colors?: Record<string, string>;
    colorsDark?: Record<string, string>;
    sections?: Record<string, Record<string, string>>;
    sectionsDark?: Record<string, Record<string, string>>;
    fonts?: { heading?: string; body?: string };
  };

  if (theme.cssVariables?.root) {
    cssBlocks.push(`:root {\n${buildVarBlock(theme.cssVariables.root)}\n}`);
  }

  if (theme.cssVariables?.dark) {
    cssBlocks.push(`.dark {\n${buildVarBlock(theme.cssVariables.dark)}\n}`);
  }

  // ── Light mode: colors + sections ──────────────────────────────────────────
  const themeVarsLight: string[] = [];

  if (theme.colors) {
    for (const [key, value] of Object.entries(theme.colors)) {
      const cssName = `--theme-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
      themeVarsLight.push(`  ${cssName}: ${value}`);
    }
  }

  if (theme.sections) {
    for (const [section, values] of Object.entries(theme.sections)) {
      for (const [key, value] of Object.entries(values)) {
        themeVarsLight.push(`  --theme-${section}-${key}: ${value}`);
      }
    }
  }

  if (themeVarsLight.length > 0) {
    cssBlocks.push(`:root {\n${themeVarsLight.join(';\n')}\n}`);
  }

  // ── Dark mode: colorsDark + sectionsDark ───────────────────────────────────
  const themeVarsDark: string[] = [];

  if (theme.colorsDark) {
    for (const [key, value] of Object.entries(theme.colorsDark)) {
      const cssName = `--theme-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
      themeVarsDark.push(`  ${cssName}: ${value}`);
    }
  }

  if (theme.sectionsDark) {
    for (const [section, values] of Object.entries(theme.sectionsDark)) {
      for (const [key, value] of Object.entries(values)) {
        themeVarsDark.push(`  --theme-${section}-${key}: ${value}`);
      }
    }
  }

  if (themeVarsDark.length > 0) {
    cssBlocks.push(`.dark {\n${themeVarsDark.join(';\n')}\n}`);
  }

  // ── Fonts: inject --font-heading / --font-body on body ─────────────────────
  if (theme.fonts) {
    const fontVars: string[] = [];
    if (theme.fonts.heading) fontVars.push(`  --font-heading: ${theme.fonts.heading}`);
    if (theme.fonts.body)    fontVars.push(`  --font-body: ${theme.fonts.body}`);
    if (fontVars.length > 0) cssBlocks.push(`body {\n${fontVars.join(';\n')}\n}`);
  }

  return <style dangerouslySetInnerHTML={{ __html: cssBlocks.join('\n\n') }} />;
}
