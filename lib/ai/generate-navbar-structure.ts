/**
 * Generates navbar structure JSON from natural language.
 * AI creates the entire navbar from scratch (no base fragment).
 * Prompt is built from navbar-structure-spec.ts.
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { buildNavbarStructureSystemPrompt } from './navbar-structure-spec';
import {
  navbarGeneratorOutputSchema,
  type NavbarStructure,
} from '@/config/schema/layout-schema';
import { logAiResponse } from './response-logger';

export type GenerateNavbarStructureResult = {
  structure: NavbarStructure;
};

export async function generateNavbarStructure(
  prompt: string,
  options?: { skipLog?: boolean }
): Promise<GenerateNavbarStructureResult> {
  const systemPrompt = buildNavbarStructureSystemPrompt();

  const result = await generateText({
    model: openai('gpt-4o-mini'),
    system: systemPrompt,
    prompt: prompt.trim() || 'Create a minimal e-commerce navbar',
    output: Output.json(),
    temperature: 0.95,
  });

  let raw: unknown = result.output;
  if (raw === undefined && typeof result.text === 'string') {
    try {
      raw = JSON.parse(result.text);
    } catch {
      raw = {};
    }
  }
  if (raw === undefined || raw === null) {
    throw new Error('AI returned no output');
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI output must be an object');
  }

  const obj = raw as Record<string, unknown>;

  if (!options?.skipLog) {
    logAiResponse(
      'navbar',
      { prompt: prompt.trim() || 'Create a minimal e-commerce navbar' },
      raw,
      { source: 'api' }
    );
  }

  const parsed = navbarGeneratorOutputSchema.safeParse(obj);
  if (!parsed.success) {
    throw new Error(`Invalid navbar structure: ${parsed.error.message}`);
  }

  return { structure: parsed.data.structure };
}
