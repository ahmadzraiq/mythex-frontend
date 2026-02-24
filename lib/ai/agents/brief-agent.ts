/**
 * Brief Agent — gpt-4o-mini
 *
 * Takes a DesignSpec and parses it into a tightly-structured
 * DesignBrief. Short prompt, JSON output only.
 * Cheap to run — used to provide structured inputs to downstream agents.
 */

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { DesignSpec } from './design-director-agent';

// ─── Types ────────────────────────────────────────────────────────────────────

// All 35 valid section type identifiers (matches section library variantId prefixes)
const VALID_SECTION_KEYS = [
  // Category 1 — Hero / Above the Fold
  'hero',
  'hero-carousel',
  'hero-video',
  'announcement-bar',
  'countdown-banner',
  // Category 2 — Product Discovery
  'featured-categories',
  'product-grid',
  'product-carousel',
  'flash-sale',
  'shop-the-look',
  'gift-guide',
  'bundle-builder',
  'product-comparison',
  'recently-viewed',
  // Category 3 — Brand & Story
  'brand-story',
  'video-feature',
  'lookbook',
  'founder-story',
  'sustainability',
  'how-it-works',
  'awards-certifications',
  // Category 4 — Social Proof & Trust
  'testimonials',
  'press-mentions',
  'features-grid',
  'social-proof',
  'community-section',
  'ambassador-section',
  // Category 5 — Engagement & Conversion
  'newsletter',
  'quiz-finder',
  'loyalty-program',
  'blog-articles',
  'waitlist',
  'gift-card-promo',
  'referral-program',
  'tiktok-feed',
] as const;

export type SectionKey = typeof VALID_SECTION_KEYS[number];

export const designBriefSchema = z.object({
  brandName: z.string().describe('The brand name to use throughout the page.'),
  industryType: z.enum(['fashion', 'electronics', 'food', 'beauty', 'home', 'sports', 'jewelry', 'general']),
  brandTone: z.enum(['luxury', 'playful', 'modern', 'warm', 'minimalist', 'bold', 'editorial', 'vintage']),
  sections: z.array(z.string()).describe(
    'Ordered list of section identifiers to include on the page (5-8 sections). ' +
    'Valid values: ' + VALID_SECTION_KEYS.join(', ')
  ),
  productTypes: z.array(z.string()).describe('Types of products sold. E.g. ["clothing", "accessories", "shoes"]'),
  primaryAudience: z.string().describe('Primary target audience. E.g. "Women 25-40, fashion-conscious, mid-to-high income"'),
  keyMessage: z.string().describe('Main value proposition in one sentence. E.g. "Timeless luxury fashion crafted with sustainable materials."'),
  heroHeadline: z.string().describe('Primary hero headline — bold, brand-appropriate. E.g. "Wear the Future."'),
  heroSubheadline: z.string().describe('Supporting hero subheadline — descriptive. E.g. "Discover SS26 — sustainable luxury fashion for the modern wardrobe."'),
  heroCta: z.string().describe('CTA button label. E.g. "Shop Now" or "Explore Collection"'),
});

export type DesignBrief = z.infer<typeof designBriefSchema>;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You parse a DesignSpec into a structured DesignBrief. Output JSON only.

SECTION KEYS (use exact strings in sections array):
CATEGORY 1 — Hero / Above the Fold (always start with one):
- hero (always include — the primary hero)
- hero-carousel (multiple rotating slides — use for multi-product brands)
- hero-video (video background — use for cinematic, bold brands)
- announcement-bar (promo strip — include BEFORE hero when there's a sale/promo)
- countdown-banner (standalone countdown — use for flash events/launches)

CATEGORY 2 — Product Discovery:
- featured-categories (visual category tiles)
- product-grid (primary product showcase — new arrivals / featured)
- product-carousel (horizontal scroll — best sellers / trending)
- flash-sale (urgency grid with countdown — for active promotions)
- shop-the-look (editorial image with tagged products — fashion/lifestyle)
- gift-guide (curated collections — seasonal/gifting brands)
- bundle-builder (kit/set builder — supplement, skincare, food brands)

CATEGORY 3 — Brand & Story:
- brand-story (narrative + image — strong founder/origin brands)
- video-feature (brand campaign video — cinematic brands)
- lookbook (editorial photography grid — fashion, beauty, home)
- founder-story (personal narrative — DTC founder-led brands)
- sustainability (eco values — ethical/sustainable brands)
- how-it-works (numbered process — subscription/service brands)
- awards-certifications (certification badges — regulated/premium brands)

CATEGORY 4 — Social Proof & Trust:
- testimonials (customer reviews — most brands benefit)
- press-mentions ("As seen in" logos — brands with press coverage)
- features-grid (USP bar: shipping, returns, quality signals)
- social-proof (UGC/Instagram grid — social-heavy brands)
- community-section (community highlight — lifestyle brands)
- ambassador-section (ambassadors grid — influencer-driven brands)

CATEGORY 5 — Engagement & Conversion:
- newsletter (email capture — most brands benefit)
- quiz-finder (product recommender — complex/varied products)
- loyalty-program (rewards teaser — retention-focused brands)
- blog-articles (recent posts — content-rich brands)
- waitlist (pre-order capture — launch phase brands)
- gift-card-promo (gift cards — gifting-occasion brands)

SELECTION RULES:
- Always include hero (or hero-carousel / hero-video) as first section
- Include announcement-bar BEFORE hero when there is an active sale
- Keep total to 5-8 sections — fewer is better
- Always include at least ONE product discovery section
- Vary combinations by brand archetype:
  * Luxury/editorial: hero → lookbook → press-mentions → brand-story → newsletter
  * Youth/streetwear: hero → announcement-bar → flash-sale → product-grid → social-proof → features-grid
  * Founder-led DTC: hero → founder-story → how-it-works → testimonials → newsletter
  * Eco/ethical: hero → sustainability → features-grid → testimonials → newsletter
  * Fitness/sport: hero → features-grid → product-grid → quiz-finder → loyalty-program
  * Luxury jewelry: hero → featured-categories → lookbook → testimonials → press-mentions

Extract brand name from the spec (use suggestedBrandName if available).

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Parse a DesignSpec into a structured DesignBrief.
 */
export async function runBriefAgent(spec: DesignSpec): Promise<DesignBrief> {
  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    prompt: `Parse this DesignSpec into a DesignBrief:\n${JSON.stringify(spec, null, 2)}`,
    schema: designBriefSchema,
  });

  return object;
}
