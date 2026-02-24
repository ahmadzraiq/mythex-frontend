/**
 * Section Library Manifest
 *
 * Compact catalog that the AI (StructureAgent) reads to:
 *   1. Pick which variant to use per section
 *   2. Know which slots to fill
 *
 * The manifest is intentionally compact — no full JSON trees here.
 * Full trees live in variants/*.ts and are instantiated at assembly time.
 */

import type { ManifestEntry } from './types';

export const SECTION_MANIFEST: ManifestEntry[] = [
  // ─── Navbar ───────────────────────────────────────────────────────────────
  { variantId: 'navbar.standard', label: 'Logo left · nav links · cart + auth right', bestFor: ['modern', 'minimalist', 'default'], requiredSlots: [], optionalSlots: ['BRAND_NAME', 'LOGO_PATH'] },
  { variantId: 'navbar.with-search', label: 'Logo · search bar center · cart + auth', bestFor: ['marketplace', 'modern', 'large-catalog'], requiredSlots: [], optionalSlots: ['BRAND_NAME'] },
  { variantId: 'navbar.centered-logo', label: 'Links left · centered logo · cart + auth right', bestFor: ['luxury', 'editorial', 'fashion', 'beauty'], requiredSlots: [], optionalSlots: ['BRAND_NAME'] },
  { variantId: 'navbar.transparent', label: 'Transparent over hero, white text', bestFor: ['luxury', 'editorial', 'bold', 'outdoor'], requiredSlots: [], optionalSlots: ['BRAND_NAME'] },
  { variantId: 'navbar.minimal', label: 'Ultra-compact: brand + cart only', bestFor: ['minimalist', 'landing', 'campaign'], requiredSlots: [], optionalSlots: ['BRAND_NAME', 'SHOP_PATH'] },

  // ─── Footer ───────────────────────────────────────────────────────────────
  { variantId: 'footer.standard', label: 'Multi-column: brand · categories · links · newsletter', bestFor: ['modern', 'fashion', 'default'], requiredSlots: [], optionalSlots: ['BRAND_NAME', 'TAGLINE', 'COPYRIGHT_YEAR'] },
  { variantId: 'footer.minimal', label: 'Single row: brand left · links · copyright', bestFor: ['minimalist', 'landing', 'campaign'], requiredSlots: [], optionalSlots: ['BRAND_NAME', 'COPYRIGHT_YEAR'] },
  { variantId: 'footer.dark', label: 'Dark background with brand statement + social', bestFor: ['luxury', 'editorial', 'bold', 'streetwear'], requiredSlots: [], optionalSlots: ['BRAND_NAME', 'TAGLINE', 'COPYRIGHT_YEAR'] },
  { variantId: 'footer.centered', label: 'Centered: logo · tagline · links in a row', bestFor: ['warm', 'artisan', 'boutique', 'beauty'], requiredSlots: [], optionalSlots: ['BRAND_NAME', 'TAGLINE', 'COPYRIGHT_YEAR'] },

  // ─── Hero / Above the Fold ────────────────────────────────────────────────

  {
    variantId: 'hero.overlay-centered',
    label: 'Full-bleed image, gradient overlay, centered text',
    bestFor: ['luxury', 'bold', 'editorial', 'modern'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'hero.split-left',
    label: 'Text left, image right, full height',
    bestFor: ['modern', 'minimalist', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'hero.split-right',
    label: 'Image left, bold text right',
    bestFor: ['editorial', 'luxury', 'vintage'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'hero.text-only',
    label: 'Typographic, no image, brand gradient',
    bestFor: ['minimalist', 'bold', 'modern'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH', 'CTA_PATH_2'],
  },
  {
    variantId: 'hero.asymmetric',
    label: 'Text card floats bottom-left over full-bleed image',
    bestFor: ['editorial', 'luxury', 'bold'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'hero-video.fullscreen',
    label: 'Full-screen video background hero',
    bestFor: ['editorial', 'luxury', 'bold'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'hero-carousel.dots',
    label: 'Multi-slide hero carousel with dot indicators',
    bestFor: ['modern', 'bold', 'editorial'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'announcement-bar.default',
    label: 'Top promo strip with dismiss button',
    bestFor: ['modern', 'bold', 'playful', 'warm', 'luxury', 'minimalist', 'editorial', 'vintage'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'countdown-banner.dark',
    label: 'Full-width dark countdown banner for a sale event',
    bestFor: ['bold', 'modern', 'playful'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'countdown-banner.accent',
    label: 'Accent-colored countdown banner',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },

  // ─── Product Discovery ────────────────────────────────────────────────────

  {
    variantId: 'featured-categories.overlay-4col',
    label: '4-column grid with image overlay and category name',
    bestFor: ['modern', 'bold', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'featured-categories.asymmetric',
    label: '1 large hero category + 2 smaller, editorial asymmetric layout',
    bestFor: ['editorial', 'luxury', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'featured-categories.strip',
    label: 'Minimal horizontal strip with circular thumbnails',
    bestFor: ['luxury', 'minimalist', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'product-grid.4col',
    label: 'Uniform 4-column product grid',
    bestFor: ['modern', 'minimalist', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'product-grid.featured-3col',
    label: 'One featured large card + 2 smaller cards',
    bestFor: ['editorial', 'luxury', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'product-grid.horizontal',
    label: 'Horizontal card list — catalog / editorial style',
    bestFor: ['editorial', 'luxury', 'minimalist'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'product-grid.masonry',
    label: 'Pinterest-style masonry grid',
    bestFor: ['bold', 'playful', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'product-carousel.standard',
    label: 'Horizontal scroll strip with standard product cards',
    bestFor: ['modern', 'warm', 'playful', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'product-carousel.large-card',
    label: 'Large card scroll strip with taller images',
    bestFor: ['editorial', 'luxury', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'product-carousel.compact',
    label: 'Compact horizontal strip with small cards',
    bestFor: ['minimalist', 'modern', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'flash-sale.dark',
    label: 'Dark dramatic flash sale with countdown timer',
    bestFor: ['bold', 'modern', 'playful'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'flash-sale.light',
    label: 'Light background flash sale with accent timer',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'shop-the-look.hover-tags',
    label: 'Editorial image with tagged products on hover',
    bestFor: ['editorial', 'luxury', 'fashion'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'shop-the-look.side-panel',
    label: 'Image with products listed in a side panel',
    bestFor: ['modern', 'minimalist', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'gift-guide.grid',
    label: 'Themed gift collection cards in a grid',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'bundle-builder.default',
    label: 'Build a bundle / kit with add items interface',
    bestFor: ['modern', 'warm', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },

  // ─── Brand & Story ────────────────────────────────────────────────────────

  {
    variantId: 'brand-story.split-image',
    label: 'Image left, text right — editorial split layout',
    bestFor: ['warm', 'editorial', 'luxury', 'vintage'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'brand-story.text-left',
    label: 'Text left, image right — reversed split',
    bestFor: ['modern', 'bold', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'brand-story.full-width',
    label: 'Full-bleed image with quote card overlay — cinematic',
    bestFor: ['luxury', 'editorial', 'bold'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'video-feature.full-width',
    label: 'Full-width video embed with text overlay',
    bestFor: ['editorial', 'luxury', 'bold', 'modern'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'video-feature.contained',
    label: 'Contained card with text + video thumbnail side by side',
    bestFor: ['modern', 'warm', 'minimalist'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'lookbook.masonry',
    label: '3-column image masonry grid with headline',
    bestFor: ['editorial', 'fashion', 'luxury', 'beauty'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'lookbook.magazine',
    label: 'Magazine-style editorial with 1 hero image + smaller grid',
    bestFor: ['editorial', 'luxury', 'bold'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'founder-story.photo-left',
    label: 'Founder photo left, personal narrative right',
    bestFor: ['warm', 'vintage', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
  {
    variantId: 'founder-story.minimal',
    label: 'Text-only founder quote, centered, minimal',
    bestFor: ['minimalist', 'luxury', 'editorial'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'sustainability.icon-grid',
    label: 'Centered icon + headline + body with leaf motif',
    bestFor: ['warm', 'modern', 'minimalist'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'sustainability.story-split',
    label: 'Dark band with split — values left, image right',
    bestFor: ['editorial', 'bold', 'luxury', 'warm'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'how-it-works.horizontal',
    label: 'Numbered steps in a horizontal row',
    bestFor: ['modern', 'warm', 'playful', 'minimalist'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'how-it-works.vertical',
    label: 'Vertical timeline with connecting line',
    bestFor: ['editorial', 'luxury', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'awards-certifications.default',
    label: 'Horizontal certification / award logo strip',
    bestFor: ['luxury', 'editorial', 'warm', 'modern'],
    requiredSlots: [],
    optionalSlots: ['HEADLINE'],
  },

  // ─── Social Proof & Trust ────────────────────────────────────────────────

  {
    variantId: 'testimonials.cards-dark',
    label: 'Dark background, 3-column card grid',
    bestFor: ['luxury', 'bold', 'modern', 'editorial'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'testimonials.large-featured',
    label: 'Single oversized quote, editorial style',
    bestFor: ['luxury', 'minimalist', 'editorial'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'testimonials.grid',
    label: 'Light background grid with star ratings',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'press-mentions.logo-only',
    label: 'Logo strip — outlet names as styled text',
    bestFor: ['luxury', 'editorial', 'modern', 'bold'],
    requiredSlots: [],
    optionalSlots: ['HEADLINE'],
  },
  {
    variantId: 'press-mentions.quote-logo',
    label: 'Featured quote + logo strip below',
    bestFor: ['luxury', 'editorial', 'bold'],
    requiredSlots: [],
    optionalSlots: ['HEADLINE'],
  },
  {
    variantId: 'features-grid.icon-row',
    label: '3-column icon grid with centered text',
    bestFor: ['modern', 'minimalist', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'features-grid.numbered',
    label: 'Numbered list — bold numbers as visual anchor',
    bestFor: ['bold', 'editorial', 'luxury'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'features-grid.alternating',
    label: 'Alternating rows — icon left, text right, full-width',
    bestFor: ['warm', 'modern', 'vintage'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'social-proof.masonry-grid',
    label: 'User-generated content masonry photo grid',
    bestFor: ['playful', 'bold', 'warm', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'social-proof.story-row',
    label: 'Instagram-story style circle thumbnails in a row',
    bestFor: ['playful', 'bold', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'community-section.default',
    label: 'Community highlight with join CTA',
    bestFor: ['playful', 'bold', 'warm'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'ambassador-section.grid',
    label: 'Brand ambassadors in a card grid',
    bestFor: ['playful', 'bold', 'warm', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },

  // ─── Engagement & Conversion ──────────────────────────────────────────────

  {
    variantId: 'newsletter.dark-band',
    label: 'Dark full-width band, centered text and email input',
    bestFor: ['luxury', 'bold', 'modern', 'editorial'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'newsletter.two-col',
    label: 'Text left, input right — two column split layout',
    bestFor: ['modern', 'minimalist', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'newsletter.minimal',
    label: 'Minimal inline — text and input in one row',
    bestFor: ['minimalist', 'modern', 'luxury'],
    requiredSlots: [],
    optionalSlots: [],
  },
  {
    variantId: 'quiz-finder.step-cards',
    label: 'Interactive product finder with step cards',
    bestFor: ['modern', 'warm', 'playful'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE'],
  },
  {
    variantId: 'loyalty-program.benefit-grid',
    label: 'Rewards program benefits in icon grid',
    bestFor: ['modern', 'playful', 'bold'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'loyalty-program.tier-display',
    label: 'Membership tier cards with benefits',
    bestFor: ['luxury', 'editorial', 'modern'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'blog-articles.card-grid',
    label: '3-column article card grid',
    bestFor: ['warm', 'editorial', 'modern', 'luxury'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'CTA_PATH'],
  },
  {
    variantId: 'waitlist.default',
    label: 'Coming soon email capture with urgency',
    bestFor: ['modern', 'bold', 'luxury'],
    requiredSlots: [],
    optionalSlots: ['SECTION_TITLE', 'SUBTITLE'],
  },
  {
    variantId: 'gift-card-promo.default',
    label: 'Gift card highlight with CTA',
    bestFor: ['warm', 'playful', 'modern'],
    requiredSlots: [],
    optionalSlots: ['CTA_PATH'],
  },
];

/** Compact manifest string for injection into the StructureAgent system prompt */
export function buildManifestContext(): string {
  const grouped: Record<string, ManifestEntry[]> = {};
  for (const entry of SECTION_MANIFEST) {
    const type = entry.variantId.split('.')[0];
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(entry);
  }

  const lines: string[] = ['SECTION LIBRARY — available variants (pick one variantId per section):'];
  for (const [type, variants] of Object.entries(grouped)) {
    lines.push(`\n[${type}]`);
    for (const v of variants) {
      const slots = [...v.requiredSlots.map(s => `*${s}`), ...v.optionalSlots].join(', ');
      lines.push(`  ${v.variantId}  — ${v.label}  bestFor:[${v.bestFor.join(', ')}]${slots ? `  slots:[${slots}]` : ''}`);
    }
  }
  lines.push('\n* = required slot  (no * = optional, has a sensible default)');
  return lines.join('\n');
}

/** Get all variants for a given section type */
export function getVariantsForType(sectionType: string): ManifestEntry[] {
  return SECTION_MANIFEST.filter(e => e.variantId.startsWith(sectionType + '.'));
}
