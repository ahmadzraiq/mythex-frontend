/**
 * Design Director Agent — gpt-4o
 *
 * Acts as a senior creative director. Given a raw user prompt like
 * "luxury watch brand" or "playful kids fashion store", it produces
 * a rich DesignSpec that becomes the creative brief for every
 * downstream agent. This spec is also used by QAReviewerAgent to
 * judge the final output.
 */

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

// ─── Types ────────────────────────────────────────────────────────────────────

export const designSpecSchema = z.object({
  visualDirection: z.string().describe('Overall visual style in 2-3 sentences. Be specific and opinionated. E.g. "Dark, editorial. Think Rolex meets Apple. Lots of white space and precise typography."'),
  layoutStyle: z.string().describe('Concrete layout approach — MUST specify the hero variant and 2-3 section layout decisions. E.g. "Split hero: bold serif heading fills left 50%, full-bleed editorial image right. Categories in an asymmetric masonry grid. Brand story as text-only manifesto in large type with no image."'),
  heroVariant: z.enum(['overlay', 'split-left', 'split-right', 'text-only', 'asymmetric']).describe(
    'Hero section layout to use. overlay=full-bleed image behind text. split-left=text left + image right. split-right=image left + text right. text-only=bold typography on gradient background (no image). asymmetric=text in floating card, image fills background at offset.'
  ),
  productGridLayout: z.enum(['uniform-4col', 'featured-3col', 'horizontal-cards']).describe(
    'Layout for product-grid and product-carousel sections. uniform-4col=4 equal cards in a row. featured-3col=large featured card (spans 2 cols) + 2 smaller cards beside it. horizontal-cards=each card is image-left + text-right in a stacked list.'
  ),
  categoryLayout: z.enum(['overlay-4col', 'asymmetric-hero', 'minimal-strip']).describe(
    'Layout for featured-categories section. overlay-4col=4 equal image cards with text overlay. asymmetric-hero=1 large card on the left + 2-3 stacked cards on the right. minimal-strip=circular images with category name below, no overlay.'
  ),
  newsletterLayout: z.enum(['dark-band-centered', 'two-column-split', 'minimal-inline']).describe(
    'Layout for the newsletter/email capture section. dark-band-centered=full-width dark background, centered heading + form. two-column-split=text left half, form right half on accent bg. minimal-inline=single slim bar with short text + input + button on one line.'
  ),
  testimonialsLayout: z.enum(['cards-dark-bg', 'large-featured']).describe(
    'Layout for testimonials section. cards-dark-bg=3 quote cards on a dark or accent-colored background. large-featured=single oversized quote centered with decorative quotation mark.'
  ),
  featuresLayout: z.enum(['icon-row', 'numbered-list']).describe(
    'Layout for features-grid (trust signals) section. icon-row=3 icons with title + description centered below each. numbered-list=large "01 02 03" numbers in brand color with heading + description beside each.'
  ),
  typographyStyle: z.string().describe('Font personality. E.g. "Serif headline (Playfair Display or similar), clean sans-serif body. Large, confident type sizing."'),
  colorMood: z.string().describe('Color palette direction in plain language. E.g. "Deep midnight navy + champagne gold accent. Never bright or saturated. Background near-white with subtle warmth."'),
  designMood: z.enum(['luxury', 'playful', 'modern', 'warm', 'minimalist', 'bold', 'editorial', 'vintage']).describe('Primary design mood keyword.'),
  sectionsOrder: z.array(z.string()).describe('Ordered list of page sections with brief reasoning. Valid section keys: hero, announcement-bar, features-grid, featured-categories, product-grid, product-carousel, flash-sale, brand-story, testimonials, newsletter, social-proof, lookbook, video-feature, press-mentions, sustainability. E.g. ["hero (establish brand immediately)", "lookbook (editorial lifestyle)", "press-mentions (credibility)", "brand-story (brand narrative)", "newsletter (capture intent)"]'),
  competitorRefs: z.array(z.string()).describe('3-5 brand/site references that match this design direction. E.g. ["Net-a-Porter", "Mr Porter", "Ssense", "COS"]'),
  brandPersonality: z.string().describe('Brand personality in one sentence. E.g. "Aspirational, timeless, quietly confident luxury — not flashy, never cheap."'),
  suggestedBrandName: z.string().describe('A fitting brand name if the user did not specify one. E.g. "Maison Veyle" for a luxury fashion brand.'),
  industryType: z.enum(['fashion', 'electronics', 'food', 'beauty', 'home', 'sports', 'jewelry', 'general']).describe('Industry vertical.'),
});

export type DesignSpec = z.infer<typeof designSpecSchema>;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a world-class creative director and brand strategist with 20 years of experience at luxury and modern e-commerce brands. You have worked with clients like Net-a-Porter, COS, AESOP, Apple, and Glossier.

Given a brief prompt about a store or page concept, produce a comprehensive DesignSpec that will guide every visual and structural decision made by downstream agents. Be specific, opinionated, and BOLD — generic or safe answers are a failure.

STRICT VARIETY RULES (violating these is unacceptable):
1. NEVER produce a standard centered white-background e-commerce layout — that's the default, it's boring.
2. heroVariant MUST rotate — if in doubt, pick 'split-left', 'split-right', or 'text-only'. Overlay is OVERUSED.
3. Sections MUST vary — include at least one unexpected section (features-grid, social-proof, flash-sale, testimonials with dark bg). Never just hero + categories + products + newsletter.
4. colorMood MUST be distinctive — not "#1e293b + #f59e0b". Pick something unusual: dusty rose + deep burgundy, electric cobalt + cream, forest green + warm gold, jet black + hot coral.
5. layoutStyle MUST be concrete — describe actual layout decisions (masonry grid, full-bleed asymmetric columns, horizontal scroll, 3-column with large featured card).

HERO VARIANTS:
- overlay: full-bleed image fills entire hero, dark gradient overlay, text centered on top
- split-left: text on LEFT half, editorial image on RIGHT half
- split-right: editorial image on LEFT half, bold text on RIGHT half
- text-only: NO image — oversized bold typography fills the hero, gradient or solid brand color background
- asymmetric: text in a floating white/brand-color card, positioned bottom-left or center-left, full-bleed background image

DESIGN MOODS GUIDE:
- luxury: dark or near-white, gold/champagne, serif headlines, extreme white space, editorial photography
- playful: vivid saturated colors (coral, teal, electric yellow), rounded shapes, energetic layout, quirky type
- modern: cool slate/zinc, clean geometric layout, micro-animations implied, subtle shadows
- warm: terracotta/burnt sienna/olive/sage, organic shapes, hand-crafted feel, warm cream background
- minimalist: single accent color on white, extreme negative space, every element earns its place
- bold: jet black + one vivid accent (red/orange/electric blue), oversized typography, high contrast
- editorial: magazine grid, big/small type mix, dramatic whitespace, black-and-white photography feel
- vintage: muted sepia/ochre/dusty rose, slab-serif type, aged texture implied through gradients

SECTIONS AVAILABLE (choose 6-8, vary the selection):
- hero (required)
- announcement-bar — promo strip above hero with dismiss button
- features-grid — trust signals (free shipping, returns, quality guarantee)
- featured-categories — shop-by-category
- product-grid — new arrivals / featured products
- product-carousel — best sellers
- flash-sale — countdown + sale products
- brand-story — editorial brand narrative (can be split layout, text manifesto, or quote overlay)
- testimonials — customer reviews (use dark or accent background for contrast)
- newsletter — email capture
- social-proof — UGC / instagram-style grid
- lookbook — editorial lifestyle image grid ("The Summer Edit", "Campaign 26") — great for fashion, beauty, home
- video-feature — brand campaign video or reel embed — use for cinematic or high-fashion brands
- press-mentions — "As seen in" media logos strip — use for brands with press coverage
- sustainability — brand values, eco certifications, materials sourcing — use for ethical/sustainable brands

VARIETY RULES FOR SECTION SELECTION:
- NEVER default to: hero + categories + products + brand-story + testimonials + newsletter. This is the boring safe choice.
- Instead, pick at least ONE from: lookbook, video-feature, press-mentions, sustainability when the brand warrants it.
- Example combos to inspire variety:
  - Luxury editorial brand: hero → lookbook → press-mentions → brand-story → newsletter
  - Bold youth brand: hero → announcement-bar → flash-sale → product-grid → social-proof → features-grid
  - Sustainable brand: hero → sustainability → brand-story → featured-categories → product-grid → newsletter
  - Minimalist jewelry: hero → features-grid → product-carousel → lookbook → press-mentions → newsletter

LAYOUT VARIANTS GUIDE — pick each deliberately, not at random:

productGridLayout:
- uniform-4col: safe, works for any brand. Use when you want clean product browsing.
- featured-3col: editorial. Use for luxury/editorial/minimalist brands. First product gets a hero-sized card.
- horizontal-cards: magazine-style. Use for premium brands with descriptive product names. Feels like a catalog.

categoryLayout:
- overlay-4col: standard e-commerce. Safe choice. Use only if the brand is very product-focused.
- asymmetric-hero: dramatic. Use for brands with one standout category. Left card is 2x bigger than the others.
- minimal-strip: refined. Use for luxury/minimalist brands. Clean circles with names below, no overlay clutter.

newsletterLayout:
- dark-band-centered: high-impact. Use for bold/luxury/editorial brands. Full-width dark section breaks the page rhythm.
- two-column-split: balanced. Use for modern/warm brands. Text proposition on left, form on right.
- minimal-inline: subtle. Use for minimalist brands. Just one quiet line at the bottom, no heavy section.

testimonialsLayout:
- cards-dark-bg: dramatic contrast. Use for bold/luxury/editorial brands. Dark background makes quotes pop.
- large-featured: editorial. Use for minimalist/luxury brands. One oversized quote, maximum white space.

featuresLayout:
- icon-row: friendly. Use for warm/playful/modern brands. Clear icons make trust signals approachable.
- numbered-list: structured. Use for premium/editorial brands. "01 — Free Shipping" feels considered and confident.

OUTPUT: Respond with a JSON object matching the DesignSpec schema exactly. No markdown, no extra fields.`;

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Run the Design Director Agent.
 * @param prompt - Free-form user prompt e.g. "luxury watch brand homepage"
 * @returns DesignSpec with full creative direction
 */
export async function runDesignDirectorAgent(prompt: string): Promise<DesignSpec> {
  const { object } = await generateObject({
    model: openai('gpt-4o'),
    system: SYSTEM_PROMPT,
    prompt: `Create a comprehensive DesignSpec for: "${prompt.trim()}"

Be bold and unexpected. Choose a heroVariant other than 'overlay' unless the brief specifically calls for it. Make the colorMood distinctive and unusual for this industry.`,
    schema: designSpecSchema,
    temperature: 1.1,
  });

  return object;
}
