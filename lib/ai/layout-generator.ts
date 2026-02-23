/**
 * AI layout generator - prompt + context to structured layout schema and theme.
 * When full context (palette, font pairing, sections) is provided, builds directly without LLM.
 *
 * Navbar overrides: layoutParts.navbar.overrides uses the layout-part-override pattern.
 * See .cursor/rules/sdui-layout-part-overrides.mdc for override types, node ids, and how to extend.
 * Schema: config/schema/layout-schema.ts (navbarOverrideSchema).
 *
 * Theme options: style, mood, mode, designMood, colors (flat or light/dark palette), fonts, fontSizes.
 * Fonts must be from SUPPORTED_FONTS (FONT_IDS + ThemePresetOverlay extras).
 * Colors: flat keys (heroBg, headerBg, etc.) or palette (light/dark with primary, secondary, etc.).
 */

import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  fullGenerationSchema,
  type LayoutSchema,
  type FullGenerationResult,
} from '@/config/schema/layout-schema';
import type { Palette } from '@/lib/ai/palette-schema';
import type { FontPairing } from '@/lib/ai/font-pairing-schema';
import { FONT_IDS } from '@/lib/ai/font-pairing-schema';
import {
  buildActionContextCompact,
  buildLayoutPartOverridesContext,
  buildSectionContext,
} from '@/lib/ai/sdui-config-context';
import { logAiResponse } from '@/lib/ai/response-logger';

/** Fonts supported by ThemePresetOverlay (FONT_IDS + extras) */
const SUPPORTED_FONTS = [
  ...FONT_IDS,
  'jakarta',
  'roboto',
  'lato',
  'poppins',
  'montserrat',
  'playfair-display',
  'dm-sans',
  'nunito',
] as const;

export type ConversationContext = {
  layout?: string;
  style?: string;
  mood?: string;
  designMood?: string;
  mode?: 'light' | 'dark' | 'both';
  colors?: Record<string, string>;
  fonts?: { heading?: string; body?: string };
  fontSizes?: string;
};

export type FullBuildContext = {
  selectedSections: string[];
  sectionVariants?: Record<string, string>;
  designMood?: string;
  mode?: 'light' | 'dark' | 'both';
  selectedPalette?: Palette | null;
  selectedFontPairing?: FontPairing | null;
};

function buildFromFullContext(ctx: FullBuildContext): FullGenerationResult {
  const variants = ctx.sectionVariants ?? {};
  const sections = ctx.selectedSections.map((type) => {
    const base = { type } as { type: string; variant?: string; columns?: number; items?: number; source?: 'featured' };
    const v = variants[type];
    if (v) base.variant = v;
    if (type === 'product-grid') return { ...base, columns: 4, source: 'featured' as const };
    if (type === 'product-carousel') return { ...base, source: 'featured' as const };
    if (type === 'feature-grid') return { ...base, items: 3 };
    return base;
  });

  const layout: LayoutSchema = {
    pageType: 'homepage',
    style: ctx.designMood ?? 'modern',
    sections,
    layoutParts: undefined,
  };

  const theme: FullGenerationResult['theme'] = {
    designMood: ctx.designMood,
    mode: ctx.mode ?? 'both',
    fontSizes: 'medium',
  };

  if (ctx.selectedPalette) {
    theme.colors = {
      light: ctx.selectedPalette.light,
      dark: ctx.selectedPalette.dark,
    };
  }

  if (ctx.selectedFontPairing) {
    theme.fonts = {
      heading: ctx.selectedFontPairing.heading,
      body: ctx.selectedFontPairing.body,
    };
  }

  return { layout, theme };
}

const BASE_SYSTEM_PROMPT = `You are a layout designer for an e-commerce homepage. Output a JSON object with this exact structure:

{
  "layout": {
    "pageType": "homepage",
    "style": "modern",
    "sections": [
      { "type": "navbar" },
      { "type": "hero", "style": "centered" },
      { "type": "product-grid", "columns": 4, "source": "featured" },
      { "type": "feature-grid", "items": 3 },
      { "type": "footer" }
    ]
  },
  "theme": {
    "style": "modern",
    "mood": "light",
    "mode": "both",
    "colors": {
      "heroBg": "#f1f5f9",
      "headerBg": "#ffffff",
      "headerText": "#171923",
      "headerBorder": "#e2e8f0",
      "button": "#1e293b",
      "buttonHover": "#334155",
      "buttonText": "#f8fafc",
      "footerBg": "#ffffff",
      "footerText": "#171923",
      "footerTextMuted": "#64748b"
    },
    "fonts": { "heading": "geist", "body": "geist" },
    "fontSizes": "medium"
  }
}

${buildSectionContext()}
Order: navbar, hero, product-grid OR product-carousel (pick one), feature-grid, footer.
layoutParts: omit (navbar uses default). For custom navbar, use navbar-structure generator separately.

Theme options (all optional):
- style: "modern" | "minimal" | "luxury" | "custom"
- mood: "light" | "dark" | "both" | "warm" | "cool" (warm/cool = color temperature)
- mode: "light" | "dark" | "both" (which palette to apply)
- designMood: string (e.g. "professional", "playful")
- colors: either (A) flat hex keys: heroBg, headerBg, headerText, headerBorder, button, buttonHover, buttonText, footerBg, footerText, footerTextMuted; or (B) light/dark palettes: { light: { primary, secondary, accent, background, textPrimary, textSecondary }, dark: same }. All values hex (e.g. "#1e293b").
- fonts: { heading, body } — use exactly: ${SUPPORTED_FONTS.join(', ')}
- fontSizes: "small" | "medium" | "large" (small=compact, large=expanded typography)
Output valid JSON only, no markdown.`;

function buildContextPrompt(context: ConversationContext): string {
  const parts: string[] = [];
  if (context.layout) {
    parts.push(`Layout preference: ${context.layout}`);
  }
  if (context.style) {
    parts.push(`Style: ${context.style}`);
  }
  if (context.mood) {
    parts.push(`Mood: ${context.mood}`);
  }
  if (context.colors && Object.keys(context.colors).length > 0) {
    parts.push(`Colors: ${JSON.stringify(context.colors)}`);
  }
  if (context.fonts) {
    const f = context.fonts;
    if (f.heading || f.body) {
      parts.push(`Fonts: heading=${f.heading ?? 'geist'}, body=${f.body ?? 'geist'}`);
    }
  }
  if (context.fontSizes) {
    parts.push(`Font size scale: ${context.fontSizes}`);
  }
  return parts.length > 0 ? `\n\nUser preferences:\n${parts.join('\n')}` : '';
}

/**
 * Generates layout schema and theme config.
 * When fullBuildContext is provided (sections + palette + font pairing), builds directly without LLM.
 * Otherwise uses OpenAI with prompt and context.
 */
export async function generateLayout(
  prompt: string,
  context?: ConversationContext,
  fullBuildContext?: FullBuildContext
): Promise<FullGenerationResult> {
  if (
    fullBuildContext &&
    fullBuildContext.selectedSections?.length > 0 &&
    fullBuildContext.selectedPalette &&
    fullBuildContext.selectedFontPairing
  ) {
    return buildFromFullContext(fullBuildContext);
  }

  const contextPrompt = context ? buildContextPrompt(context) : '';
  const fullPrompt = prompt.trim()
    ? `${prompt}${contextPrompt}`
    : `Generate an e-commerce homepage.${contextPrompt}`;

  const { output } = await generateText({
    model: openai('gpt-4o-mini'),
    system: BASE_SYSTEM_PROMPT,
    prompt: fullPrompt,
    output: Output.json(),
  });

  logAiResponse('layout', { prompt: fullPrompt, context }, output, { source: 'api' });

  const parsed = fullGenerationSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error(`Invalid generation schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Legacy: returns layout only for backward compatibility */
export async function generateLayoutOnly(prompt: string): Promise<LayoutSchema> {
  const result = await generateLayout(prompt);
  return result.layout;
}
