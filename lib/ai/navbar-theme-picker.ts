/**
 * Picks random theme preset and font pairing for navbar generation.
 * Used when generating navbar so the result has a coherent theme + font without generating footer/hero.
 */

import themeConfig from '@/config/theme.json';
import { FONT_IDS } from '@/lib/ai/font-pairing-schema';

const THEME_PRESETS = ['modern', 'minimal', 'luxury'] as const;
type ThemePreset = (typeof THEME_PRESETS)[number];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export type NavbarThemePick = {
  style: ThemePreset;
  fonts: { heading: string; body: string };
};

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
  if (!presets) return ['modern', 'minimal', 'luxury'];
  return THEME_PRESETS.filter((p) => p in presets);
}
