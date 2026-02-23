/**
 * AI page generator - takes a free-form page spec (e.g. "Modern Fashion Homepage")
 * and generates a complete SDUI screen config with all sections inline.
 *
 * Unlike layout-generator (which uses a schema intermediary), this outputs a
 * ready-to-render SDUI screen config directly. The section-examples guide the AI
 * on correct component patterns so it doesn't improvise.
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  buildSduiReference,
  buildThemeContext,
} from '@/lib/ai/sdui-config-context';
import { buildDesignPrinciplesContext } from '@/lib/ai/design-principles';
import { buildTechPatternsContext } from '@/lib/ai/tech-patterns';
import { buildCorrectionsContext } from '@/lib/ai/eval/corrections-builder';
import { buildSectionExamplesContext } from '@/lib/ai/section-examples';
import { logAiResponse } from '@/lib/ai/response-logger';
import { generateNavbarStructure } from '@/lib/ai/generate-navbar-structure';
import { colorSetToNavbarThemeVars } from '@/lib/ai/navbar-theme-picker';
import type { Palette } from '@/lib/ai/palette-schema';
import type { FontPairing } from '@/lib/ai/font-pairing-schema';

// ─── Output schema ──────────────────────────────────────────────────────────

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
});

export type PageGeneratorOutput = z.infer<typeof pageGeneratorOutputSchema>;

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(palette?: Palette | null, fontPairing?: FontPairing | null): string {
  const paletteHint = palette
    ? `\nUSE THIS PALETTE:\nLight: ${JSON.stringify(palette.light)}\nDark: ${JSON.stringify(palette.dark)}\nReflect these in themeHint.palette and use matching theme vars in classNames.`
    : '';
  const fontHint = fontPairing
    ? `\nUSE THESE FONTS: heading="${fontPairing.heading}", body="${fontPairing.body}" — reflect in themeHint.fonts.`
    : '';

  return `You are a senior SDUI page builder. Given a free-form page description (e.g. "Modern Fashion Homepage with hero, product grid, flash sale, newsletter"), generate a complete, production-ready SDUI screen config.

OUTPUT SHAPE:
{
  "meta": { "title": "Page Title", "description": "..." },
  "state": {
    "form": { "email": "" },
    "hero": { "heading": "...", "subheading": "...", "imageUrl": "/images/hero.jpg" },
    "flashSale": { "endsAt": "2026-04-01T00:00:00Z" }
  },
  "layout": "store",
  "content": {
    "type": "Box",
    "props": { "className": "w-full flex flex-col" },
    "children": [ /* all sections as direct children — NO footer, NO navbar */ ]
  },
  "initActions": [
    { "action": "fetchNavCollections" },
    { "action": "fetchCart" }
    /* add section-specific actions: fetchFeaturedProducts, fetchNewArrivals, fetchBestSellers, etc. */
  ],
  "themeHint": {
    "designMood": "luxury",
    "palette": {
      "light": {
        "primary": "#1e293b",
        "secondary": "#334155",
        "accent": "#f59e0b",
        "background": "#f8fafc",
        "textPrimary": "#0f172a",
        "textSecondary": "#64748b"
      },
      "dark": {
        "primary": "#f8fafc",
        "secondary": "#e2e8f0",
        "accent": "#f59e0b",
        "background": "#0f172a",
        "textPrimary": "#f8fafc",
        "textSecondary": "#94a3b8"
      }
    },
    "fonts": { "heading": "geist", "body": "geist" }
  }
}
${paletteHint}
${fontHint}

THEME HINT — CRITICAL:
themeHint.palette MUST have ALL 6 keys in both light and dark: primary, secondary, accent, background, textPrimary, textSecondary.
Choose colors that match the page's design mood — NOT the same defaults every time:
- "luxury" → dark navy/gold accents, near-white background
- "playful" → vibrant primaries (coral, teal, yellow), light background
- "modern" → slate/zinc grays, white background, bold accent
- "professional" → deep blue/charcoal, light gray background
- "warm" → earth tones (terracotta, warm beige, olive), cream background
All colors must be valid hex strings (#rrggbb). The palette drives every CSS variable on the page.

STATE CONVENTIONS:
- Inline content (hero headings, brand story copy) lives in screen state, referenced via {{path}} in text nodes
- Form fields: state.form.email, etc. — always use full path screens.{pageName}.form.{field} in setState actions
- CountdownTimer: pass target="{{flashSale.endsAt}}" as a prop (the renderer interpolates it from screen state)
- Product data: loaded by initActions (fetchFeaturedProducts etc.) into Zustand store, mapped via "map": "storePath"

INIT ACTIONS — add for each section that needs data:
- fetchNavCollections + fetchCart: always include first
- fetchFeaturedProducts → maps to featured.products
- fetchNewArrivals → maps to newArrivals.products  
- fetchBestSellers → maps to bestSellers.products
- fetchFeaturedCategories → maps to featured.categories
- fetchFlashSale → maps to flashSale.products + flashSale.endsAt
- fetchTestimonials → maps to testimonials.items
- subscribeNewsletter → for newsletter submit

${buildSectionExamplesContext()}

${buildDesignPrinciplesContext()}

${buildTechPatternsContext()}

THEME VARS AVAILABLE:
- --theme-announcement-bg / --theme-announcement-text
- --theme-header-bg / --theme-header-text / --theme-header-border
- --theme-hero-bg / --theme-hero-text
- --theme-content-bg / --theme-content-text / --theme-content-textMuted
- --theme-shop-button / --theme-shop-buttonHover / --theme-shop-buttonText
- --theme-footer-bg / --theme-footer-text / --theme-footer-textMuted

${buildThemeContext()}

SDUI REFERENCE:
${buildSduiReference()}

${buildCorrectionsContext('page')}

RULES:
- Output valid JSON only — no markdown, no comments
- All sections are direct children of the root content Box (w-full flex flex-col)
- Use section examples above as exact patterns — never invent new component types
- Always include announcement-bar if user mentions one (first child)
- Do NOT include a footer in content — the "store" layout shell already provides navbar + footer. Adding one duplicates it.
- Do NOT add a navbar section in content — the layout shell already includes it
- For any section type not in the examples, build it using Box/Heading/Text/Button/NextImage/Carousel/NavIcon only
- CountdownTimer: always use target="{{flashSale.endsAt}}" prop — never targetPath
- themeHint.palette must have all 6 keys per mode — this is required for any colors to appear on the page
- themeHint.designMood should match the overall vibe (e.g. "luxury", "playful", "modern", "warm")`;
}

// ─── Generator ──────────────────────────────────────────────────────────────

export interface PageGeneratorOptions {
  palette?: Palette | null;
  fontPairing?: FontPairing | null;
  pageName?: string;
}

/**
 * Generate a complete SDUI screen from a free-form page description.
 * Also generates a custom navbar structure matching the page's palette and mood.
 */
export async function generatePage(
  prompt: string,
  options: PageGeneratorOptions = {}
): Promise<PageGeneratorOutput> {
  const { palette, fontPairing, pageName = 'home' } = options;

  const systemPrompt = buildSystemPrompt(palette, fontPairing);
  const userPrompt = prompt.trim() || 'Generate a modern e-commerce homepage with hero, categories, product grid, and newsletter.';

  const { output } = await generateText({
    model: openai('gpt-4o'),
    system: systemPrompt,
    prompt: userPrompt,
    output: Output.json(),
  });

  const parsed = pageGeneratorOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error(`Invalid page schema: ${parsed.error.message}`);
  }

  const result = parsed.data;

  // Generate a custom navbar that matches the page's palette and mood
  try {
    const hint = result.themeHint;
    const effectivePalette = palette ?? (hint?.palette?.light ? { light: hint.palette.light, dark: hint.palette.dark } : null);
    const themeVars = effectivePalette?.light
      ? colorSetToNavbarThemeVars(
          effectivePalette.light as Parameters<typeof colorSetToNavbarThemeVars>[0],
          effectivePalette.dark as Parameters<typeof colorSetToNavbarThemeVars>[1]
        )
      : undefined;

    const navbarPrompt = [
      hint?.designMood ? `${hint.designMood} style` : 'modern e-commerce',
      fontPairing?.heading ? `heading font: ${fontPairing.heading}` : hint?.fonts?.heading ? `heading font: ${hint.fonts.heading}` : '',
    ].filter(Boolean).join(', ');

    const navbarResult = await generateNavbarStructure(
      `Create a navbar for an e-commerce store with ${navbarPrompt} aesthetic`,
      { skipLog: true, predefinedTheme: themeVars ? { themeVars } : undefined }
    );

    (result as Record<string, unknown>).layoutParts = { navbar: { structure: navbarResult.structure } };
  } catch (e) {
    console.error('[page-generator] Failed to generate navbar, using default:', e);
  }

  // Log after navbar is added so the log entry contains the complete output
  logAiResponse('page', { prompt: userPrompt, pageName }, result as unknown, { source: 'api', page: pageName });

  return result;
}
