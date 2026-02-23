/**
 * AI font pairing generator - design mood to 6 font pairings.
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  fontPairingsResponseSchema,
  FONT_IDS,
  type FontPairing,
} from '@/lib/ai/font-pairing-schema';
import { logAiResponse } from '@/lib/ai/response-logger';

const SYSTEM_PROMPT = `You are a typography designer. Given a design mood, output exactly 6 font pairings as JSON.

Output format:
{
  "pairings": [
    {
      "heading": "font-id",
      "body": "font-id",
      "headingName": "Display Name",
      "bodyName": "Display Name"
    }
  ]
}

Available font IDs (use exactly these): ${FONT_IDS.join(', ')}.

Rules:
- heading and body must be different font IDs from the list.
- Each pairing must be unique.
- Match pairings to the design mood.
- headingName and bodyName are human-readable (e.g. "Space Grotesk", "Inter").
- Output valid JSON only, no markdown.`;

export async function generateFontPairings(designMood: string): Promise<FontPairing[]> {
  const prompt = `Design mood: ${designMood}. Generate 6 font pairings.`;

  const { output } = await generateText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    prompt,
    output: Output.json(),
  });

  logAiResponse('font-pairings', { designMood }, output, { source: 'api' });

  const parsed = fontPairingsResponseSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error(`Invalid font pairings schema: ${parsed.error.message}`);
  }
  return parsed.data.pairings;
}
