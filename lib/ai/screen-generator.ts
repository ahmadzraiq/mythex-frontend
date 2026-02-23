/**
 * AI screen generator - generates complete screen config from prompt.
 * Uses full schema context + design + tech personas.
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  buildSduiReference,
  buildScreenContext,
  buildLayoutContext,
} from '@/lib/ai/sdui-config-context';
import { buildDesignPrinciplesContext } from '@/lib/ai/design-principles';
import { buildTechPatternsContext } from '@/lib/ai/tech-patterns';
import { buildCorrectionsContext } from '@/lib/ai/eval/corrections-builder';
import { logAiResponse } from '@/lib/ai/response-logger';
import root from '@/config/root';

const layouts = root.layouts as Record<string, unknown>;
const LAYOUT_NAMES = Object.keys(layouts).join(', ');

const uiNodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    id: z.string().optional(),
    map: z.string().optional(),
    key: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    text: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    actions: z.record(z.string(), z.unknown()).optional(),
    condition: z.unknown().optional(),
    children: z.array(uiNodeSchema).optional(),
    $ref: z.string().optional(),
    $slot: z.string().optional(),
  }).passthrough()
);

export const screenGeneratorOutputSchema = z.object({
  meta: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
  state: z.record(z.string(), z.unknown()).optional(),
  layout: z.enum(['store', 'account', 'checkoutMinimal']),
  content: uiNodeSchema,
  initActions: z
    .array(
      z.object({
        action: z.string(),
      })
    )
    .optional(),
});

export type ScreenGeneratorOutput = z.infer<typeof screenGeneratorOutputSchema>;

const SYSTEM_PROMPT = `You are a senior SDUI screen builder. Generate a complete screen config from the user's description.

Output shape:
{
  "meta": { "title": "...", "description": "..." },
  "state": { "form": {}, "errors": {} } (for forms),
  "layout": "store" | "account" | "checkoutMinimal",
  "content": <root UI node>,
  "initActions": [{ "action": "fetchNavCollections" }, { "action": "fetchX" }]
}

Layout options: ${LAYOUT_NAMES}. Use "store" for most pages (navbar + content + footer).

initActions: Always include fetchNavCollections and fetchCart first (globalInitActions). Add screen-specific fetches (fetchCollection, fetchSearchResults, etc.).

${buildScreenContext()}

${buildLayoutContext()}

${buildDesignPrinciplesContext()}

${buildTechPatternsContext()}

FULL SDUI REFERENCE:
${buildSduiReference()}

${buildCorrectionsContext('screen')}

Output valid JSON only, no markdown.`;

/**
 * Generate a complete screen config from a prompt.
 */
export async function generateScreen(prompt: string): Promise<ScreenGeneratorOutput> {
  const { output } = await generateText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    prompt: prompt.trim() || 'Generate a product listing page with filters and grid.',
    output: Output.json(),
  });

  logAiResponse('screen', { prompt }, output, { source: 'api' });

  const parsed = screenGeneratorOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error(`Invalid screen schema: ${parsed.error.message}`);
  }
  return parsed.data;
}
