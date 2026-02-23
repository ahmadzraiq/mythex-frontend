/**
 * Zod schema for AI-generated font pairings.
 * Used by generate-font-pairings API.
 */

import { z } from 'zod';

export const FONT_IDS = [
  'geist',
  'inter',
  'space-grotesk',
  'rajdhani',
  'oxanium',
  'rubik',
  'exo-2',
  'roboto-mono',
  'ibm-plex-sans',
  'noto-sans',
] as const;

export const fontPairingSchema = z.object({
  heading: z.string(),
  body: z.string(),
  headingName: z.string(),
  bodyName: z.string(),
});

export const fontPairingsResponseSchema = z.object({
  pairings: z.array(fontPairingSchema).length(6),
});

export type FontPairing = z.infer<typeof fontPairingSchema>;
export type FontPairingsResponse = z.infer<typeof fontPairingsResponseSchema>;
