/**
 * Content Agent — gpt-4o
 *
 * Given a DesignBrief, generates brand-appropriate copy and
 * assembles realistic content by pulling images deterministically
 * from the mock content library.
 *
 * IMAGE STRATEGY: URLs come from the mock library — never invented.
 * This prevents broken images in the generated page.
 *
 * INDUSTRY MATCHING: Category names and product names are AI-generated
 * to match the brief's industryType. Images come from the mock library
 * but names are always industry-appropriate.
 *
 * CONDITIONAL CONTENT: Only generates content blocks for sections that
 * are actually present in the brief's sections array. This ensures
 * each page has a genuinely different structure.
 */

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { DesignBrief } from './brief-agent';
import {
  getProducts,
  getCategories,
  getHeroImage,
  getBrandStoryImage,
  getTestimonials,
  type MockProduct,
  type MockCategory,
  type MockTestimonial,
} from '@/lib/ai/mock-content-library';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeneratedContent {
  hero: {
    heading: string;
    subheading: string;
    ctaLabel: string;
    imageUrl: string;
  };
  announcement?: {
    text: string;
    ctaLabel?: string;
  };
  /** Always present — needed by navbar and footer even when featured-categories section is absent */
  categories: MockCategory[];
  products?: {
    newArrivals?: MockProduct[];
    bestSellers?: MockProduct[];
    flashSaleItems?: MockProduct[];
  };
  brandStory?: {
    headline: string;
    body: string;
    imageUrl: string;
  };
  testimonials?: MockTestimonial[];
  newsletter?: {
    heading: string;
    subheading: string;
  };
  flashSale?: {
    endsAt: string;
    badge: string;
  };
  features?: Array<{
    icon: string;
    title: string;
    description: string;
  }>;
  lookbook?: {
    headline: string;
    images: string[];
  };
  pressMentions?: {
    headline: string;
    outlets: string[];
  };
  sustainability?: {
    headline: string;
    body: string;
  };
}

// ─── Copy schema (only the text parts — images come from library) ─────────────

function buildCopySchema(flags: {
  hasAnnouncement: boolean;
  hasBrandStory: boolean;
  hasNewsletter: boolean;
  hasFeatures: boolean;
  hasFlashSale: boolean;
  hasCategories: boolean;
  hasProducts: boolean;
  hasTestimonials: boolean;
  hasLookbook: boolean;
  hasPressMentions: boolean;
  hasSustainability: boolean;
}) {
  return z.object({
    hero: z.object({
      heading: z.string(),
      subheading: z.string(),
      ctaLabel: z.string(),
    }),
    ...(flags.hasAnnouncement ? {
      announcement: z.object({
        text: z.string(),
        ctaLabel: z.string().nullable().describe('CTA label or null if no CTA'),
      }),
    } : {}),
    ...(flags.hasBrandStory ? {
      brandStory: z.object({
        headline: z.string(),
        body: z.string(),
      }),
    } : {}),
    ...(flags.hasNewsletter ? {
      newsletter: z.object({
        heading: z.string(),
        subheading: z.string(),
      }),
    } : {}),
    ...(flags.hasFlashSale ? {
      flashSale: z.object({
        badge: z.string().describe('Short badge text e.g. "Up to 50% Off" or "Flash Sale". Empty string if not applicable.'),
      }),
    } : {}),
    ...(flags.hasFeatures ? {
      features: z.array(z.object({
        icon: z.string().describe('Lucide icon name e.g. Truck, RotateCcw, ShieldCheck, Leaf, Star, Zap'),
        title: z.string(),
        description: z.string(),
      })).length(3),
    } : {}),
    // Always generate categories — needed by navbar and footer even when featured-categories section is absent
    categories: z.array(z.object({
      name: z.string(),
      slug: z.string().describe('URL-friendly slug matching the name'),
    })).length(4).describe('4 category names that match the industryType — NEVER use fashion names for non-fashion brands'),
    ...(flags.hasProducts ? {
      products: z.array(z.object({
        name: z.string().describe('Product name that matches the industryType'),
      })).length(12).describe('12 product names matching the industry (used for newArrivals x4, bestSellers x4, flashSaleItems x4)'),
    } : {}),
    ...(flags.hasLookbook ? {
      lookbook: z.object({
        headline: z.string().describe('Short editorial headline for the lookbook section e.g. "The Summer Edit" or "Campaign 26"'),
      }),
    } : {}),
    ...(flags.hasPressMentions ? {
      pressMentions: z.object({
        headline: z.string().describe('Short headline e.g. "As Seen In" or "In the Press"'),
        outlets: z.array(z.string()).length(5).describe('5 relevant press/media outlet names e.g. ["Vogue", "The Times", "Wired", "Forbes", "GQ"]'),
      }),
    } : {}),
    ...(flags.hasSustainability ? {
      sustainability: z.object({
        headline: z.string().describe('Bold sustainability headline e.g. "Crafted Responsibly" or "Fashion With Purpose"'),
        body: z.string().describe('2-3 sentences on the brand\'s sustainability commitments'),
      }),
    } : {}),
  });
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You write brand copy for e-commerce pages. Given a brand brief, generate engaging, on-brand copy.
Output JSON matching the schema exactly. No markdown.

COPY GUIDELINES:
- Hero headline: 3-8 words, bold/impactful, no punctuation at end
- Hero subheading: 1-2 sentences, descriptive, mentions the collection/season/brand benefit
- Brand story: 2-3 sentence body. Authentic, not generic. Mentions craftsmanship, materials, or values.
- Newsletter: emphasise the offer (e.g. "10% off first order"), keep it warm and inviting
- Features: always 3 items — typically shipping, returns, and one brand differentiator (sustainability, quality, etc.)
- Flash sale badge: short and urgent e.g. "Up to 50% Off" or "Flash Sale — 24 Hours Only"
- Announcement bar: brief and action-oriented e.g. "Free shipping on orders over $75 — Shop Now"
- Lookbook headline: editorial and evocative e.g. "The Summer Edit", "Campaign 26", "After Hours"
- Sustainability body: specific and credible — mention materials, certifications, or practices

Match tone to the brand: luxury brands use understated elegance; playful brands use energy and fun.

INDUSTRY CONTENT MATCHING (critical — always match the industryType):
- Categories and product names MUST match the industryType exactly:
  - fashion → categories: "Women", "Men", "Accessories", "Shoes" | products: "Classic Tee", "Silk Dress", "Leather Belt"...
  - bakery → categories: "Breads", "Pastries", "Cakes", "Drinks" | products: "Sourdough Loaf", "Butter Croissant", "Almond Tart"...
  - technology → categories: "Laptops", "Phones", "Accessories", "Software" | products: "Pro Laptop", "Smart Watch", "Wireless Earbuds"...
  - restaurant → categories: "Starters", "Mains", "Desserts", "Drinks" | products: "Caesar Salad", "Grilled Steak", "Chocolate Fondant"...
  - fitness → categories: "Equipment", "Apparel", "Nutrition", "Programs" | products: "Yoga Mat", "Resistance Bands", "Protein Powder"...
  - beauty → categories: "Skincare", "Makeup", "Hair", "Fragrance" | products: "Vitamin C Serum", "Foundation", "Hair Oil"...
  - jewellery / jewelry → categories: "Rings", "Necklaces", "Earrings", "Bracelets" | products: "Diamond Ring", "Gold Pendant", "Pearl Earrings"...
  - home / furniture → categories: "Living", "Bedroom", "Kitchen", "Outdoor" | products: "Linen Sofa", "Oak Dining Table", "Ceramic Vase"...
- NEVER use fashion-specific names (Women/Men/Classic Tee/Linen Shirt) for non-fashion brands
- Generate 4 category names and 12 product names that a customer would expect to find on this specific brand's website`;

// ─── Agent ────────────────────────────────────────────────────────────────────

/** Flash sale end date — 3 days from now */
function getFlashSaleEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString();
}

/** Random integer between 0 (inclusive) and max (exclusive) */
function randInt(max: number): number {
  return Math.floor(Math.random() * max);
}

/**
 * Run the Content Agent.
 * Generates brand copy and assembles content from the mock library.
 * Only generates content for sections that are actually in the brief.
 */
export async function runContentAgent(brief: DesignBrief): Promise<GeneratedContent> {
  const s = brief.sections;
  const hasFlashSale      = s.includes('flash-sale');
  const hasBrandStory     = s.includes('brand-story');
  const hasAnnouncement   = s.includes('announcement-bar');
  const hasTestimonials   = s.includes('testimonials');
  const hasNewsletter     = s.includes('newsletter');
  const hasFeatures       = s.includes('features-grid');
  const hasCategories     = s.includes('featured-categories');
  const hasNewArrivals    = s.includes('product-grid');
  const hasBestSellers    = s.includes('product-carousel');
  const hasLookbook       = s.includes('lookbook');
  const hasPressMentions  = s.includes('press-mentions');
  const hasSustainability = s.includes('sustainability');
  const hasProducts       = hasNewArrivals || hasBestSellers || hasFlashSale;

  const flags = {
    hasAnnouncement, hasBrandStory, hasNewsletter, hasFeatures,
    hasFlashSale,
    hasCategories: true, // always generate — navbar + footer always need categories
    hasProducts, hasTestimonials,
    hasLookbook, hasPressMentions, hasSustainability,
  };

  const promptParts = [
    `Generate brand copy for:`,
    `Brand: ${brief.brandName}`,
    `Industry: ${brief.industryType}`,
    `Tone: ${brief.brandTone}`,
    `Audience: ${brief.primaryAudience}`,
    `Key message: ${brief.keyMessage}`,
    `Hero headline (use this as a starting point, refine it): "${brief.heroHeadline}"`,
    `Hero subheadline (use this): "${brief.heroSubheadline}"`,
    `CTA: "${brief.heroCta}"`,
    hasFlashSale      ? 'Include flash sale badge.' : '',
    hasBrandStory     ? 'Include brand story copy.' : '',
    hasAnnouncement   ? 'Include announcement bar copy.' : '',
    hasTestimonials   ? 'Include testimonials section.' : '',
    hasLookbook       ? 'Include an editorial lookbook headline.' : '',
    hasPressMentions  ? 'Include press mentions section with outlet names.' : '',
    hasSustainability ? 'Include sustainability section copy.' : '',
  ].filter(Boolean).join('\n');

  const copySchema = buildCopySchema(flags);

  const { object: copy } = await generateObject({
    model: openai('gpt-4o'),
    system: SYSTEM_PROMPT,
    prompt: promptParts,
    schema: copySchema,
  });

  const industry = brief.industryType;

  // Randomize image indices so every run looks different
  const heroImgIdx        = randInt(3);
  const brandStoryImgIdx  = randInt(3);
  // Randomize product offset so we don't always get the same first 12
  const productOffset     = randInt(4) * 3; // 0, 3, 6, or 9

  // Categories — always generated (navbar + footer always need them)
  const baseCats = getCategories(4, industry);
  const catCopy = (copy as Record<string, unknown>).categories as Array<{ name: string; slug: string }> | undefined;
  const categories: MockCategory[] = baseCats.map((c, i) => ({
    ...c,
    name: catCopy?.[i]?.name ?? c.name,
    slug: catCopy?.[i]?.slug ?? c.slug,
  }));

  // Products
  let products: GeneratedContent['products'];
  if (hasProducts) {
    const productCopy = (copy as Record<string, unknown>).products as Array<{ name: string }> | undefined;
    products = {
      ...(hasNewArrivals ? {
        newArrivals: getProducts(4, productOffset, industry).map((p, i) => ({
          ...p,
          productName: productCopy?.[i]?.name ?? p.productName,
        })),
      } : {}),
      ...(hasBestSellers ? {
        bestSellers: getProducts(4, productOffset + 4, industry).map((p, i) => ({
          ...p,
          productName: productCopy?.[4 + i]?.name ?? p.productName,
        })),
      } : {}),
      ...(hasFlashSale ? {
        flashSaleItems: getProducts(4, productOffset + 8, industry).map((p, i) => ({
          ...p,
          productName: productCopy?.[8 + i]?.name ?? p.productName,
        })),
      } : {}),
    };
  }

  // Brand story
  const brandStoryCopy = (copy as Record<string, unknown>).brandStory as { headline: string; body: string } | undefined;
  const brandStory: GeneratedContent['brandStory'] = hasBrandStory && brandStoryCopy
    ? { headline: brandStoryCopy.headline, body: brandStoryCopy.body, imageUrl: getBrandStoryImage(brandStoryImgIdx, industry) }
    : undefined;

  // Newsletter
  const newsletterCopy = (copy as Record<string, unknown>).newsletter as { heading: string; subheading: string } | undefined;
  const newsletter: GeneratedContent['newsletter'] = hasNewsletter && newsletterCopy
    ? { heading: newsletterCopy.heading, subheading: newsletterCopy.subheading }
    : undefined;

  // Flash sale
  const flashSaleCopy = (copy as Record<string, unknown>).flashSale as { badge: string } | undefined;
  const flashSale: GeneratedContent['flashSale'] = hasFlashSale && flashSaleCopy?.badge
    ? { endsAt: getFlashSaleEndDate(), badge: flashSaleCopy.badge }
    : undefined;

  // Features
  const featuresCopy = (copy as Record<string, unknown>).features as GeneratedContent['features'];
  const features: GeneratedContent['features'] = hasFeatures && featuresCopy ? featuresCopy : undefined;

  // Testimonials
  const testimonials: GeneratedContent['testimonials'] = hasTestimonials
    ? getTestimonials(3, industry)
    : undefined;

  // Announcement
  const announcementCopy = (copy as Record<string, unknown>).announcement as { text: string; ctaLabel: string | null } | undefined;
  const announcement: GeneratedContent['announcement'] = hasAnnouncement && announcementCopy?.text
    ? { text: announcementCopy.text, ctaLabel: announcementCopy.ctaLabel ?? undefined }
    : undefined;

  // Lookbook
  const lookbookCopy = (copy as Record<string, unknown>).lookbook as { headline: string } | undefined;
  const lookbook: GeneratedContent['lookbook'] = hasLookbook && lookbookCopy
    ? {
        headline: lookbookCopy.headline,
        // Pull 6 product images as lifestyle shots
        images: getProducts(6, randInt(6), industry).map(p => p.productAsset.preview),
      }
    : undefined;

  // Press mentions
  const pressCopy = (copy as Record<string, unknown>).pressMentions as { headline: string; outlets: string[] } | undefined;
  const pressMentions: GeneratedContent['pressMentions'] = hasPressMentions && pressCopy
    ? { headline: pressCopy.headline, outlets: pressCopy.outlets }
    : undefined;

  // Sustainability
  const sustainCopy = (copy as Record<string, unknown>).sustainability as { headline: string; body: string } | undefined;
  const sustainability: GeneratedContent['sustainability'] = hasSustainability && sustainCopy
    ? { headline: sustainCopy.headline, body: sustainCopy.body }
    : undefined;

  return {
    hero: {
      heading: copy.hero.heading,
      subheading: copy.hero.subheading,
      ctaLabel: copy.hero.ctaLabel,
      imageUrl: getHeroImage(heroImgIdx, industry),
    },
    announcement,
    categories,
    products,
    brandStory,
    testimonials,
    newsletter,
    flashSale,
    features,
    lookbook,
    pressMentions,
    sustainability,
  };
}
