/**
 * AI palette generator - design mood + color mood + mode to 4 color palettes.
 * Follows font-pairing-schema pattern: AI selects from PREDEFINED_PALETTES.
 *
 * Accepts both a mood keyword (e.g. "luxury") and a richer colorMood description
 * (e.g. "Deep midnight navy + champagne gold accent") for more varied palette selection.
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  PREDEFINED_PALETTES,
  paletteSchema,
  type Palette,
} from '@/lib/ai/palette-schema';
import { logAiResponse } from '@/lib/ai/response-logger';

const PALETTE_LIST = PREDEFINED_PALETTES.map(
  (p) => `${p.name}: ${p.description}`
).join('\n');

const SYSTEM_PROMPT = `You are a color designer. Given a design mood, color direction, and mode (light/dark/both), select exactly 4 palettes from the predefined list that best match. Output them as JSON.

Available palettes (name + description):
${PALETTE_LIST}

Output format:
{
  "paletteNames": ["Name1", "Name2", "Name3", "Name4"]
}

Rules:
- paletteNames must be exactly 4 palette names from the list above. Use exact names.
- Select palettes that match the color direction and design mood. For mode "light" prefer light-friendly palettes; for "dark" prefer dark-friendly; for "both" pick a balanced mix.
- Each name must be unique.
- Output valid JSON only, no markdown.`;

/**
 * Generate palette options based on design mood and color mood description.
 * @param designMood - Single keyword (e.g. "luxury", "playful")
 * @param colorMood - Richer color direction (e.g. "Deep midnight navy + champagne gold")
 * @param mode - Whether to favor light, dark, or both
 */
export async function generatePalettes(
  designMood: string,
  colorMood: string,
  mode: 'light' | 'dark' | 'both'
): Promise<Palette[]> {
  const prompt = `Design mood: ${designMood}. Color direction: ${colorMood}. Mode: ${mode}. Select 4 palettes.`;

  const { output } = await generateText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    prompt,
    output: Output.json(),
    temperature: 1.0,
  });

  logAiResponse('palettes', { designMood, colorMood, mode }, output, { source: 'api' });

  const raw = output as { paletteNames?: string[] } | undefined;
  const names = raw?.paletteNames ?? [];

  const paletteMap = new Map(PREDEFINED_PALETTES.map((p) => [p.name, p]));
  const selected: Palette[] = [];
  for (const name of names.slice(0, 4)) {
    const p = paletteMap.get(name);
    if (p) {
      const parsed = paletteSchema.safeParse(p);
      if (parsed.success) selected.push(parsed.data);
    }
  }

  if (selected.length < 4) {
    const fallback = PREDEFINED_PALETTES.slice(0, 4);
    return fallback.map((p) => {
      const parsed = paletteSchema.safeParse(p);
      return parsed.success ? parsed.data : (p as unknown as Palette);
    });
  }

  return selected;
}
