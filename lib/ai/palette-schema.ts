/**
 * Zod schema for AI-generated color palettes.
 * Used by generate-palettes API.
 * Predefined palettes mirror font-pairing-schema FONT_IDS - AI selects from this list.
 */

import { z } from 'zod';

const colorSetSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  accent: z.string(),
  background: z.string(),
  textPrimary: z.string(),
  textSecondary: z.string(),
});

function deriveDarkFromLight(light: z.infer<typeof colorSetSchema>) {
  return {
    primary: light.primary,
    secondary: light.secondary,
    accent: light.accent,
    background: '#0f172a',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
  };
}

export const paletteSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    light: colorSetSchema,
    dark: colorSetSchema.partial().optional(),
  })
  .transform((p) => {
    const dark = p.dark;
    const light = p.light;
    const fullDark =
      dark &&
      dark.primary &&
      dark.secondary &&
      dark.accent &&
      dark.background &&
      dark.textPrimary &&
      dark.textSecondary
        ? {
            primary: dark.primary,
            secondary: dark.secondary,
            accent: dark.accent,
            background: dark.background,
            textPrimary: dark.textPrimary,
            textSecondary: dark.textSecondary,
          }
        : deriveDarkFromLight(light);
    return {
      name: p.name,
      description: p.description,
      light,
      dark: fullDark,
    };
  });

export const palettesResponseSchema = z.object({
  palettes: z.array(paletteSchema).length(4),
});

export type ColorSet = z.infer<typeof colorSetSchema>;
export type Palette = z.infer<typeof paletteSchema>;
export type PalettesResponse = z.infer<typeof palettesResponseSchema>;

/** Raw palette input (before schema transform) */
type PaletteInput = {
  name: string;
  description: string;
  light: ColorSet;
  dark?: ColorSet;
};

/** Predefined palettes - AI selects from this list (like FONT_IDS in font-pairing-schema) */
export const PREDEFINED_PALETTES: PaletteInput[] = [
  {
    name: 'Slate',
    description: 'Professional, neutral, modern. Suits corporate and tech.',
    light: { primary: '#1e293b', secondary: '#334155', accent: '#64748b', background: '#f8fafc', textPrimary: '#0f172a', textSecondary: '#64748b' },
    dark: { primary: '#f8fafc', secondary: '#e2e8f0', accent: '#94a3b8', background: '#0f172a', textPrimary: '#f8fafc', textSecondary: '#94a3b8' },
  },
  {
    name: 'Ocean',
    description: 'Calm, trustworthy, clean. Suits finance and healthcare.',
    light: { primary: '#0ea5e9', secondary: '#38bdf8', accent: '#7dd3fc', background: '#f0f9ff', textPrimary: '#0c4a6e', textSecondary: '#0369a1' },
    dark: { primary: '#38bdf8', secondary: '#7dd3fc', accent: '#bae6fd', background: '#0c4a6e', textPrimary: '#f0f9ff', textSecondary: '#7dd3fc' },
  },
  {
    name: 'Forest',
    description: 'Natural, sustainable, organic. Suits eco and wellness brands.',
    light: { primary: '#059669', secondary: '#10b981', accent: '#34d399', background: '#f0fdf4', textPrimary: '#064e3b', textSecondary: '#047857' },
    dark: { primary: '#34d399', secondary: '#6ee7b7', accent: '#a7f3d0', background: '#064e3b', textPrimary: '#ecfdf5', textSecondary: '#6ee7b7' },
  },
  {
    name: 'Luxury',
    description: 'Premium, elegant, high-end. Suits fashion and luxury goods.',
    light: { primary: '#1e293b', secondary: '#334155', accent: '#c9a227', background: '#fafafa', textPrimary: '#0f172a', textSecondary: '#64748b' },
    dark: { primary: '#c9a227', secondary: '#d4af37', accent: '#f8fafc', background: '#0f172a', textPrimary: '#f8fafc', textSecondary: '#94a3b8' },
  },
  {
    name: 'Minimal',
    description: 'Clean, simple, uncluttered. Suits minimalist and modern brands.',
    light: { primary: '#171923', secondary: '#2d3748', accent: '#4a5568', background: '#ffffff', textPrimary: '#171923', textSecondary: '#718096' },
    dark: { primary: '#f7fafc', secondary: '#e2e8f0', accent: '#a0aec0', background: '#171923', textPrimary: '#f7fafc', textSecondary: '#a0aec0' },
  },
  {
    name: 'Warm',
    description: 'Friendly, inviting, cozy. Suits food, hospitality, lifestyle.',
    light: { primary: '#c2410c', secondary: '#ea580c', accent: '#fb923c', background: '#fff7ed', textPrimary: '#431407', textSecondary: '#9a3412' },
    dark: { primary: '#fb923c', secondary: '#fdba74', accent: '#fed7aa', background: '#431407', textPrimary: '#fff7ed', textSecondary: '#fdba74' },
  },
  {
    name: 'Berry',
    description: 'Bold, creative, playful. Suits creative and youth brands.',
    light: { primary: '#7c3aed', secondary: '#8b5cf6', accent: '#a78bfa', background: '#faf5ff', textPrimary: '#4c1d95', textSecondary: '#6d28d9' },
    dark: { primary: '#a78bfa', secondary: '#c4b5fd', accent: '#ddd6fe', background: '#4c1d95', textPrimary: '#f5f3ff', textSecondary: '#c4b5fd' },
  },
  {
    name: 'Rose',
    description: 'Soft, elegant, feminine. Suits beauty and lifestyle.',
    light: { primary: '#be123c', secondary: '#e11d48', accent: '#fb7185', background: '#fff1f2', textPrimary: '#881337', textSecondary: '#9f1239' },
    dark: { primary: '#fb7185', secondary: '#fda4af', accent: '#fecdd3', background: '#4c0519', textPrimary: '#fff1f2', textSecondary: '#fda4af' },
  },
  {
    name: 'Midnight',
    description: 'Sophisticated, dark, premium. Suits tech and nightlife.',
    light: { primary: '#0f172a', secondary: '#1e293b', accent: '#475569', background: '#f8fafc', textPrimary: '#0f172a', textSecondary: '#64748b' },
    dark: { primary: '#f8fafc', secondary: '#e2e8f0', accent: '#94a3b8', background: '#020617', textPrimary: '#f8fafc', textSecondary: '#94a3b8' },
  },
  {
    name: 'Mint',
    description: 'Fresh, crisp, modern. Suits fintech and productivity.',
    light: { primary: '#0d9488', secondary: '#14b8a6', accent: '#2dd4bf', background: '#f0fdfa', textPrimary: '#134e4a', textSecondary: '#0f766e' },
    dark: { primary: '#2dd4bf', secondary: '#5eead4', accent: '#99f6e4', background: '#134e4a', textPrimary: '#ccfbf1', textSecondary: '#5eead4' },
  },
];

export const PALETTE_IDS = PREDEFINED_PALETTES.map((p) => p.name) as readonly string[];
