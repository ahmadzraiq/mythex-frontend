'use client';

/**
 * When a generated layout has a theme, injects CSS variables on :root and .dark.
 * Supports: (1) full palette (light/dark) with mode
 *           (2) legacy generatedTheme (colors, fonts, fontSizes)
 *           (3) preset by name (generatedStyle) from config/theme.json
 * Fonts are also applied directly to document.documentElement via useEffect so they
 * take effect even with persist rehydration timing or style cascade issues.
 */

import { useEffect } from 'react';
import { useLayoutGeneratorStore } from '@/store/layout-generator-store';
import themeConfig from '@/config/theme';

type PresetSections = Record<string, Record<string, string>>;
type Preset = { sections?: PresetSections };
type ThemeWithPresets = typeof themeConfig & { presets?: Record<string, Preset> };

type ColorSet = {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  textPrimary?: string;
  textSecondary?: string;
  buttonText?: string;
};

const PALETTE_TO_THEME: Array<{ paletteKey: keyof ColorSet; themeVars: string[] }> = [
  { paletteKey: 'primary', themeVars: ['--theme-shop-button', '--primary'] },
  { paletteKey: 'secondary', themeVars: ['--theme-shop-buttonHover', '--secondary'] },
  { paletteKey: 'background', themeVars: ['--theme-hero-bg', '--theme-content-bg', '--theme-header-bg', '--theme-footer-bg', '--background'] },
  { paletteKey: 'textPrimary', themeVars: ['--theme-header-text', '--theme-content-text', '--foreground'] },
  { paletteKey: 'textSecondary', themeVars: ['--theme-content-textMuted', '--theme-footer-textMuted', '--muted-foreground'] },
  { paletteKey: 'accent', themeVars: ['--accent'] },
  { paletteKey: 'buttonText', themeVars: ['--theme-shop-buttonText', '--primary-foreground'] },
];

const VARS_NEED_RGB: Set<string> = new Set(['--background', '--foreground', '--primary', '--secondary', '--muted-foreground', '--primary-foreground', '--border', '--accent']);

const COLOR_TO_THEME_VAR: Record<string, string> = {
  heroBg: '--theme-hero-bg',
  headerBg: '--theme-header-bg',
  headerText: '--theme-header-text',
  headerBorder: '--theme-header-border',
  button: '--theme-shop-button',
  buttonHover: '--theme-shop-buttonHover',
  buttonText: '--theme-shop-buttonText',
  footerBg: '--theme-footer-bg',
  footerText: '--theme-footer-text',
  footerTextMuted: '--theme-footer-textMuted',
};

const FONT_VAR_MAP: Record<string, string> = {
  geist: 'var(--font-geist-sans)',
  inter: 'var(--font-inter)',
  jakarta: 'var(--font-plus-jakarta-sans)',
  roboto: 'var(--font-roboto)',
  'space-grotesk': 'var(--font-space-grotesk)',
  rajdhani: 'var(--font-rajdhani)',
  oxanium: 'var(--font-oxanium)',
  rubik: 'var(--font-rubik)',
  'exo-2': 'var(--font-exo-2)',
  'roboto-mono': 'var(--font-roboto-mono)',
  'ibm-plex-sans': 'var(--font-ibm-plex-sans)',
  'noto-sans': 'var(--font-noto-sans)',
  lato: 'var(--font-lato)',
  poppins: 'var(--font-poppins)',
  montserrat: 'var(--font-montserrat)',
  'playfair-display': 'var(--font-playfair-display)',
  'dm-sans': 'var(--font-dm-sans)',
  nunito: 'var(--font-nunito)',
};

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function isHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

const FONT_SIZE_VARS: Record<string, Record<string, string>> = {
  small: { '--text-hero': '2rem', '--text-body': '0.875rem' },
  medium: {},
  large: { '--text-hero': '4rem', '--text-body': '1.125rem' },
};

function buildVarsFromColorSet(colorSet: ColorSet): string[] {
  const vars: string[] = [];
  for (const { paletteKey, themeVars } of PALETTE_TO_THEME) {
    const value = colorSet[paletteKey];
    if (value) {
      const rgbValue = isHex(value) ? hexToRgb(value) : value;
      for (const v of themeVars) {
        const cssValue = VARS_NEED_RGB.has(v) ? rgbValue : (isHex(value) ? value : rgbValue);
        vars.push(`  ${v}: ${cssValue}`);
      }
    }
  }
  return vars;
}

function buildCssFromGeneratedTheme(theme: Record<string, unknown>, mode?: string): string {
  const blocks: string[] = [];

  const themeVars = theme.themeVars as Record<string, string> | undefined;
  if (themeVars && Object.keys(themeVars).length > 0) {
    const vars = Object.entries(themeVars)
      .map(([name, value]) => `  ${name}: ${value}`)
      .join(';\n');
    blocks.push(`:root {\n${vars}\n}`);
  }

  const colors = theme.colors as Record<string, unknown> | undefined;
  const lightPalette = colors?.light as ColorSet | undefined;
  const darkPalette = colors?.dark as ColorSet | undefined;

  if (lightPalette || darkPalette) {
    const effectiveMode = mode || 'both';
    if (effectiveMode === 'light' && lightPalette) {
      const vars = buildVarsFromColorSet(lightPalette);
      if (vars.length > 0) blocks.push(`:root {\n${vars.join(';\n')}\n}`);
    } else if (effectiveMode === 'dark' && darkPalette) {
      const vars = buildVarsFromColorSet(darkPalette);
      if (vars.length > 0) blocks.push(`:root {\n${vars.join(';\n')}\n}`);
    } else if ((effectiveMode === 'both' || !effectiveMode) && (lightPalette || darkPalette)) {
      if (lightPalette) {
        const vars = buildVarsFromColorSet(lightPalette);
        if (vars.length > 0) blocks.push(`:root {\n${vars.join(';\n')}\n}`);
      }
      if (darkPalette) {
        const vars = buildVarsFromColorSet(darkPalette);
        if (vars.length > 0) blocks.push(`.dark {\n${vars.join(';\n')}\n}`);
      }
    }
  } else if (colors) {
    const vars: string[] = [];
    for (const [key, value] of Object.entries(colors)) {
      if (typeof value !== 'string') continue;
      const cssVar = COLOR_TO_THEME_VAR[key];
      if (cssVar) vars.push(`  ${cssVar}: ${value}`);
    }
    if (vars.length > 0) blocks.push(`:root {\n${vars.join(';\n')}\n}`);
  }

  const fonts = theme.fonts as { heading?: string; body?: string } | undefined;
  if (fonts) {
    const fontVars: string[] = [];
    if (fonts.heading && FONT_VAR_MAP[fonts.heading]) {
      fontVars.push(`  --font-heading: ${FONT_VAR_MAP[fonts.heading]}`);
    }
    if (fonts.body && FONT_VAR_MAP[fonts.body]) {
      fontVars.push(`  --font-body: ${FONT_VAR_MAP[fonts.body]}`);
    }
    if (fontVars.length > 0) blocks.push(`body {\n${fontVars.join(';\n')}\n}`);
  }

  const fontSizes = theme.fontSizes as string | undefined;
  if (fontSizes && FONT_SIZE_VARS[fontSizes]) {
    const vars: string[] = [];
    for (const [k, v] of Object.entries(FONT_SIZE_VARS[fontSizes])) {
      vars.push(`  ${k}: ${v}`);
    }
    if (vars.length > 0) blocks.push(`:root {\n${vars.join(';\n')}\n}`);
  }

  return blocks.join('\n\n');
}

export function ThemePresetOverlay() {
  const generatedTheme = useLayoutGeneratorStore((s) => s.generatedTheme);
  const generatedStyle = useLayoutGeneratorStore((s) => s.generatedStyle);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const fonts = generatedTheme?.fonts as { heading?: string; body?: string } | undefined;
    const target = document.body ?? document.documentElement;
    if (fonts?.heading && FONT_VAR_MAP[fonts.heading]) {
      target.style.setProperty('--font-heading', FONT_VAR_MAP[fonts.heading]);
    } else {
      target.style.removeProperty('--font-heading');
    }
    if (fonts?.body && FONT_VAR_MAP[fonts.body]) {
      target.style.setProperty('--font-body', FONT_VAR_MAP[fonts.body]);
    } else {
      target.style.removeProperty('--font-body');
    }
  }, [generatedTheme]);

  const theme = themeConfig as ThemeWithPresets;
  const presets = theme.presets;

  if (generatedTheme && typeof generatedTheme === 'object') {
    const mode = generatedTheme.mode as string | undefined;
    const colors = generatedTheme.colors as Record<string, unknown> | undefined;
    const themeVars = generatedTheme.themeVars as Record<string, string> | undefined;
    const hasColors =
      (colors && (colors.light || colors.dark || Object.keys(colors).length > 0)) ||
      (themeVars && Object.keys(themeVars).length > 0);
    const css = buildCssFromGeneratedTheme(generatedTheme, mode);
    if (hasColors && css) return <style dangerouslySetInnerHTML={{ __html: css }} />;
    if (css && !generatedStyle) return <style dangerouslySetInnerHTML={{ __html: css }} />;
    if (css && generatedStyle && presets) {
      const key = generatedStyle.toLowerCase();
      const preset = presets[key];
      const presetCss =
        preset?.sections
          ? `:root {\n${Object.entries(preset.sections)
              .flatMap(([section, values]) =>
                Object.entries(values).map(([k, v]) => `  --theme-${section}-${k}: ${v}`)
              )
              .join(';\n')}\n}`
          : '';
      return <style dangerouslySetInnerHTML={{ __html: [presetCss, css].filter(Boolean).join('\n\n') }} />;
    }
  }

  if (!presets || !generatedStyle) return null;

  const key = generatedStyle.toLowerCase();
  const preset = presets[key];
  if (!preset?.sections) return null;

  const themeVars: string[] = [];
  for (const [section, values] of Object.entries(preset.sections)) {
    for (const [k, value] of Object.entries(values)) {
      themeVars.push(`  --theme-${section}-${k}: ${value}`);
    }
  }
  if (themeVars.length === 0) return null;

  const css = `:root {\n${themeVars.join(';\n')}\n}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
