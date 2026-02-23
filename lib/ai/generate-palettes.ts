/**
 * AI palette generator - design mood + mode to 4 color palettes.
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { palettesResponseSchema, type Palette } from '@/lib/ai/palette-schema';
import { logAiResponse } from '@/lib/ai/response-logger';

const SYSTEM_PROMPT = `You are a color designer. Given a design mood and mode (light/dark/both), output exactly 4 unique color palettes as JSON.

Output format:
{
  "palettes": [
    {
      "name": "Palette Name",
      "description": "Brief description of the palette mood and use case.",
      "light": {
        "primary": "#hex",
        "secondary": "#hex",
        "accent": "#hex",
        "background": "#hex",
        "textPrimary": "#hex",
        "textSecondary": "#hex"
      },
      "dark": {
        "primary": "#hex",
        "secondary": "#hex",
        "accent": "#hex",
        "background": "#hex",
        "textPrimary": "#hex",
        "textSecondary": "#hex"
      }
    }
  ]
}

Rules:
- All colors must be valid hex (e.g. #1e293b).
- Each palette MUST include BOTH "light" AND "dark" objects with ALL 6 fields each: primary, secondary, accent, background, textPrimary, textSecondary.
- light.background should be light (e.g. #f8fafc); dark.background should be dark (e.g. #0f172a).
- Each palette must be distinct and match the design mood.
- Output valid JSON only, no markdown.`;

export async function generatePalettes(
  designMood: string,
  mode: 'light' | 'dark' | 'both'
): Promise<Palette[]> {
  const prompt = `Design mood: ${designMood}. Mode: ${mode}. Generate 4 color palettes.`;

  const { output } = await generateText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    prompt,
    output: Output.json(),
  });

  logAiResponse('palettes', { designMood, mode }, output, { source: 'api' });

  const parsed = palettesResponseSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error(`Invalid palettes schema: ${parsed.error.message}`);
  }
  return parsed.data.palettes;
}
