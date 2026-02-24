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
  {
    name: 'Terracotta',
    description: 'Earthy, artisan, hand-crafted. Suits pottery, candles, home goods, organic beauty.',
    light: { primary: '#9c4221', secondary: '#c05a2e', accent: '#6b7c4b', background: '#fdf6f0', textPrimary: '#3d1a0a', textSecondary: '#7c4a2e' },
    dark: { primary: '#e8825a', secondary: '#f0a070', accent: '#a3b870', background: '#1e0f08', textPrimary: '#fdf0e8', textSecondary: '#c08060' },
  },
  {
    name: 'Cobalt',
    description: 'Electric, editorial, bold. Suits streetwear, sneakers, tech accessories.',
    light: { primary: '#1a3bcc', secondary: '#2952e3', accent: '#6b8ef5', background: '#f5f7ff', textPrimary: '#0a1550', textSecondary: '#3a5080' },
    dark: { primary: '#6b8ef5', secondary: '#8ba8ff', accent: '#b4c6ff', background: '#04082e', textPrimary: '#eef0ff', textSecondary: '#8a9ec8' },
  },
  {
    name: 'Coral',
    description: 'High-contrast, vibrant, bold. Suits activewear, sports, youth brands.',
    light: { primary: '#1a1a2e', secondary: '#2d2d44', accent: '#ff4757', background: '#ffffff', textPrimary: '#0d0d1a', textSecondary: '#555570' },
    dark: { primary: '#ff4757', secondary: '#ff6b78', accent: '#ff9da5', background: '#0d0d1a', textPrimary: '#ffffff', textSecondary: '#a0a0b8' },
  },
  {
    name: 'Sage',
    description: 'Calm, natural, grounded. Suits wellness, yoga, sustainable fashion, skincare.',
    light: { primary: '#4a6741', secondary: '#5e8054', accent: '#c8a96e', background: '#f8f5ee', textPrimary: '#1e2d1a', textSecondary: '#6a7d5e' },
    dark: { primary: '#90b888', secondary: '#b0d0a8', accent: '#e0c898', background: '#131a10', textPrimary: '#eef4ec', textSecondary: '#7a9870' },
  },
  {
    name: 'Burgundy',
    description: 'Romantic, refined, editorial. Suits wine, perfume, luxury lingerie, fine dining.',
    light: { primary: '#6b1e3a', secondary: '#8b2a50', accent: '#c4788a', background: '#fdf5f7', textPrimary: '#2d0a16', textSecondary: '#8a4a5e' },
    dark: { primary: '#d4809a', secondary: '#e8a0b4', accent: '#f0c0cc', background: '#1a0810', textPrimary: '#fdf0f4', textSecondary: '#b07080' },
  },
  {
    name: 'Nordic',
    description: 'Clean, Scandinavian, architectural. Suits furniture, interiors, homeware, minimalist fashion.',
    light: { primary: '#2c3e50', secondary: '#4a6580', accent: '#7aafc8', background: '#f7f9fb', textPrimary: '#1a252f', textSecondary: '#5a7080' },
    dark: { primary: '#a8c8e0', secondary: '#c0daf0', accent: '#d8ecf8', background: '#0c1520', textPrimary: '#eef4f8', textSecondary: '#7a9ab0' },
  },
  {
    name: 'Amber',
    description: 'Rich, warm, premium. Suits whiskey, coffee, leather goods, artisan crafts.',
    light: { primary: '#92400e', secondary: '#b45309', accent: '#d97706', background: '#fffbf0', textPrimary: '#3d1a00', textSecondary: '#855030' },
    dark: { primary: '#fbbf24', secondary: '#fcd34d', accent: '#fde68a', background: '#1c1000', textPrimary: '#fff8e0', textSecondary: '#c8922a' },
  },
  {
    name: 'Graphite',
    description: 'Technical, edgy, modern dark. Suits electronics, gaming, fintech, SaaS.',
    light: { primary: '#1c1c1e', secondary: '#3a3a3c', accent: '#00d4aa', background: '#f5f5f7', textPrimary: '#1c1c1e', textSecondary: '#636366' },
    dark: { primary: '#e8e8ea', secondary: '#aeaeb2', accent: '#00d4aa', background: '#1c1c1e', textPrimary: '#f5f5f7', textSecondary: '#8e8e93' },
  },
];

export const PALETTE_IDS = PREDEFINED_PALETTES.map((p) => p.name) as readonly string[];
