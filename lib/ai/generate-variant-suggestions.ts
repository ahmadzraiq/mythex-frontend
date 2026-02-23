/**
 * AI variant suggestions - suggests section variants based on design mood.
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { SECTION_VARIANTS } from '@/config/section-variants';
import { logAiResponse } from '@/lib/ai/response-logger';

const suggestionSchema = z.object({
  suggestions: z.record(z.string(), z.string()),
});

const SECTION_IDS = Object.keys(SECTION_VARIANTS) as string[];

const VARIANT_IDS = SECTION_IDS.reduce(
  (acc, type) => {
    acc[type] = SECTION_VARIANTS[type].map((v) => v.id);
    return acc;
  },
  {} as Record<string, string[]>
);

const SYSTEM_PROMPT = `You suggest section layout variants for an e-commerce homepage based on design mood.

For each section type, pick ONE variant id from the allowed list. Output JSON:
{ "suggestions": { "navbar": "default", "hero": "centered", "product-grid": "standard", "feature-grid": "icons-3" } }

Allowed variants per section:
- navbar: ${VARIANT_IDS.navbar?.join(', ') ?? 'default'}
- hero: ${VARIANT_IDS.hero?.join(', ') ?? 'centered'}
- product-grid: ${VARIANT_IDS['product-grid']?.join(', ') ?? 'standard'}
- feature-grid: ${VARIANT_IDS['feature-grid']?.join(', ') ?? 'icons-3'}

Match the design mood: minimal→minimal/compact variants, bold→gradient/full-width, luxury→centered/cards-4, etc.
Output valid JSON only, no markdown.`;

export async function generateVariantSuggestions(
  designMood: string
): Promise<Record<string, string>> {
  const { output } = await generateText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    prompt: `Design mood: ${designMood}. Suggest variants for hero, product-grid, feature-grid.`,
    output: Output.json(),
  });

  logAiResponse('variant-suggestions', { designMood }, output, { source: 'api' });

  const parsed = suggestionSchema.safeParse(output);
  if (!parsed.success) {
    return {
      navbar: 'default',
      hero: 'centered',
      'product-grid': 'standard',
      'feature-grid': 'icons-3',
    };
  }

  const result: Record<string, string> = {};
  for (const [type, variantId] of Object.entries(parsed.data.suggestions)) {
    const allowed = VARIANT_IDS[type];
    if (allowed?.includes(variantId)) {
      result[type] = variantId;
    }
  }
  return result;
}
