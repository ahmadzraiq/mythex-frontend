/**
 * AI page generator — entry point for the multi-agent pipeline.
 *
 * Orchestrates: DesignDirector → Brief → (Content + Theme) → Structure →
 *               Validate+retry → QA Review
 *
 * TWO MODES:
 *   1. Classic (default): StructureAgent generates full SDUI JSON in one call.
 *   2. Library mode (useLibrary: true): StructureAgent picks variant IDs from
 *      the section library manifest; SectionLibrary.instantiate() assembles
 *      the final JSON. Faster, fewer errors, more combinatorial variety.
 *
 * For backward compatibility the schema types and `pageGeneratorOutputSchema`
 * are re-exported here.
 */

import { z } from 'zod';
import { runPipeline } from '@/lib/ai/agents/manager-agent';
import type { Palette } from '@/lib/ai/palette-schema';
import type { FontPairing } from '@/lib/ai/font-pairing-schema';
import { sectionLibrary } from '@/lib/ai/section-library';
import type { SectionSelection } from '@/lib/ai/section-library/types';

// ─── Output schema (re-exported for use by agents and eval scripts) ──────────

// Normalise children: accept array (correct) or a single-object mistake from the AI
const normaliseChildren = (val: unknown): unknown[] | undefined => {
  if (val == null) return undefined;
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return [val]; // single node mistake
  return undefined;
};

const uiNodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    id: z.string().optional(),
    map: z.string().optional(),
    key: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    text: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    actions: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
    condition: z.unknown().optional(),
    children: z.preprocess(normaliseChildren, z.array(uiNodeSchema)).optional(),
    $ref: z.string().optional(),
    $slot: z.string().optional(),
  }).passthrough()
);

const paletteColorSetSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  accent: z.string(),
  background: z.string(),
  textPrimary: z.string(),
  textSecondary: z.string(),
});

export const pageGeneratorOutputSchema = z.object({
  meta: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
  state: z.record(z.string(), z.unknown()).optional(),
  layout: z.string().default('store'),
  content: uiNodeSchema,
  initActions: z
    .array(z.union([z.object({ action: z.string() }).passthrough(), z.record(z.string(), z.unknown())]))
    .optional(),
  themeHint: z
    .object({
      designMood: z.string().optional(),
      palette: z
        .object({
          light: paletteColorSetSchema.optional(),
          dark: paletteColorSetSchema.optional(),
        })
        .optional(),
      fonts: z
        .object({ heading: z.string().optional(), body: z.string().optional() })
        .optional(),
    })
    .optional(),
  layoutParts: z
    .object({
      navbar: z.object({ structure: uiNodeSchema }).optional(),
      footer: z.object({ structure: uiNodeSchema }).optional(),
    })
    .optional(),
});

export type PageGeneratorOutput = z.infer<typeof pageGeneratorOutputSchema>;

// ─── Generator (delegates to multi-agent pipeline) ──────────────────────────

export interface PageGeneratorOptions {
  palette?: Palette | null;
  fontPairing?: FontPairing | null;
  pageName?: string;
  /** Set true to skip the visual QA review step (faster, no screenshot needed) */
  skipQA?: boolean;
  /** Set true to skip the Playwright screenshot step (QA falls back to text-only) */
  skipScreenshot?: boolean;
  /**
   * Use the new section library assembly mode.
   * AI picks variant IDs; SectionLibrary assembles the JSON.
   * Faster, fewer errors, more variety.
   * Default: false (backward compat)
   */
  useLibrary?: boolean;
}

// ─── Library assembly utility ────────────────────────────────────────────────

/**
 * Assemble a page's content children from a list of section selections.
 * Used by the library mode pipeline.
 *
 * Any section with an unknown variantId is skipped with a warning.
 */
export function assembleSectionsFromLibrary(
  sections: SectionSelection[]
): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];

  for (const selection of sections) {
    try {
      const node = sectionLibrary.instantiate(selection.variantId, selection.params ?? {});
      nodes.push(node);
    } catch (err) {
      console.warn(`assembleSectionsFromLibrary: Skipping "${selection.variantId}" — ${(err as Error).message}`);
    }
  }

  return nodes;
}

/**
 * Collect all initActions needed for a list of section selections.
 * Always includes fetchNavCollections and fetchCart as base actions.
 */
export function collectInitActionsForSections(selections: SectionSelection[]): Array<{ action: string }> {
  const variantIds = selections.map(s => s.variantId);
  const sectionActions = sectionLibrary.collectInitActions(variantIds);

  const BASE_ACTIONS = ['fetchNavCollections', 'fetchCart'];
  const all = [...BASE_ACTIONS, ...sectionActions];
  const unique = [...new Set(all)];

  return unique.map(action => ({ action }));
}

/**
 * Generate a complete SDUI screen from a free-form page description.
 * Delegates to the multi-agent pipeline (Manager Agent).
 *
 * Pipeline: DesignDirector → Brief → (Content + Theme) → Structure →
 *           Validate+retry → Screenshot (Playwright) → QA Review (GPT-4V)
 */
export async function generatePage(
  prompt: string,
  options: PageGeneratorOptions = {}
): Promise<PageGeneratorOutput> {
  const { palette, fontPairing, pageName = 'home', skipQA = false, skipScreenshot = false } = options;

  const userPrompt = prompt.trim() || 'Generate a modern e-commerce homepage with hero, categories, product grid, and newsletter.';

  const result = await runPipeline(userPrompt, {
    palette,
    fontPairing: fontPairing ?? undefined,
    pageName,
    skipQA,
    skipScreenshot,
  });

  return result.screen;
}
