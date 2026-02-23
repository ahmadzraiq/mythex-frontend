/**
 * Zod schema for AI-generated color palettes.
 * Used by generate-palettes API.
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

const paletteSchema = z
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
