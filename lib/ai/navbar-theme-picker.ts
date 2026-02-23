/**
 * Picks random theme preset and font pairing for navbar generation.
 * Uses PREDEFINED_PALETTES from palette-schema (no hardcoded colors).
 */

import themeConfig from '@/config/theme';
import { FONT_IDS } from '@/lib/ai/font-pairing-schema';
import { PREDEFINED_PALETTES } from '@/lib/ai/palette-schema';
import type { ColorSet } from '@/lib/ai/palette-schema';

const THEME_PRESETS = ['modern', 'minimal', 'luxury'] as const;
type ThemePreset = (typeof THEME_PRESETS)[number];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isDark(hex: string): boolean {
  let clean = hex.replace('#', '');
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

export function colorSetToNavbarThemeVars(
  c: ColorSet,
  otherMode?: ColorSet
): Record<string, string> {
  const lightTextSet = isDark(c.background) ? c : otherMode;
  const darkTextSet = isDark(c.background) ? otherMode : c;
  const buttonText = isDark(c.primary)
    ? (lightTextSet?.textPrimary ?? c.textPrimary)
    : (darkTextSet?.textPrimary ?? c.textPrimary);
  return {
    '--theme-header-bg': c.background,
    '--theme-header-text': c.textPrimary,
    '--theme-header-border': c.secondary,
    '--theme-content-bg': c.background,
    '--theme-content-text': c.textPrimary,
    '--theme-content-textMuted': c.textSecondary,
    '--theme-shop-button': c.primary,
    '--theme-shop-buttonHover': c.secondary,
    '--theme-shop-buttonText': buttonText,
    '--border': c.secondary,
  };
}

export type NavbarThemePick = {
  style: ThemePreset;
  fonts: { heading: string; body: string };
};

export type RandomNavbarTheme = {
  themeVars: Record<string, string>;
  fonts: { heading: string; body: string };
  style: ThemePreset;
};

/**
 * Generate random theme vars and fonts for navbar AI prompt.
 * Uses PREDEFINED_PALETTES - no hardcoded colors.
 */
export function generateRandomNavbarTheme(): RandomNavbarTheme {
  const palette = pickRandom(PREDEFINED_PALETTES);
  const font = pickRandom(FONT_IDS);
  const style = pickRandom(THEME_PRESETS);
  const useLight = Math.random() < 0.5;
  const colorSet = useLight ? palette.light : (palette.dark ?? palette.light);
  const otherMode = useLight ? palette.dark : palette.light;

  return {
    themeVars: colorSetToNavbarThemeVars(colorSet, otherMode),
    fonts: { heading: font, body: font },
    style,
  };
}

/**
 * Pick a random theme preset and font pairing from current config.
 * Theme comes from theme.json presets; fonts from FONT_IDS.
 */
export function pickRandomNavbarTheme(): NavbarThemePick {
  const style = pickRandom(THEME_PRESETS);
  const font = pickRandom(FONT_IDS);
  return {
    style,
    fonts: { heading: font, body: font },
  };
}

/**
 * Validate that a preset exists in theme.json.
 */
export function getThemePresets(): ThemePreset[] {
  const presets = (themeConfig as { presets?: Record<string, unknown> }).presets;
  if (!presets) return ['modern', 'luxury'];
  return THEME_PRESETS.filter((p) => p in presets);
}
