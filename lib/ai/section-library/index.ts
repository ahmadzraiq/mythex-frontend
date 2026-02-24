/**
 * Section Library — Core Class
 *
 * Usage:
 *   const lib = new SectionLibrary();
 *   const node = lib.instantiate('hero.overlay-centered', { CTA_PATH: '/shop' });
 */

import type { SectionVariant, SectionParams, ManifestEntry } from './types';
import { SECTION_MANIFEST } from './manifest';

// ─── Import all variant files ─────────────────────────────────────────────────

import { navbarVariants } from './variants/navbar';
import { footerVariants } from './variants/footer';
import { heroVariants } from './variants/hero';
import { productGridVariants } from './variants/product-grid';
import { featuredCategoriesVariants } from './variants/featured-categories';
import { newsletterVariants } from './variants/newsletter';
import { testimonialsVariants } from './variants/testimonials';
import { featuresGridVariants } from './variants/features-grid';
import { announcementBarVariants } from './variants/announcement-bar';
import { brandStoryVariants } from './variants/brand-story';
import { flashSaleVariants } from './variants/flash-sale';
import { productCarouselVariants } from './variants/product-carousel';
import { lookbookVariants } from './variants/lookbook';
import { pressMentionsVariants } from './variants/press-mentions';
import { sustainabilityVariants } from './variants/sustainability';
import { videoFeatureVariants } from './variants/video-feature';
import { newSectionVariants } from './variants/new-sections';

// ─── Registry ────────────────────────────────────────────────────────────────

const ALL_VARIANTS: SectionVariant[] = [
  ...navbarVariants,
  ...footerVariants,
  ...heroVariants,
  ...productGridVariants,
  ...featuredCategoriesVariants,
  ...newsletterVariants,
  ...testimonialsVariants,
  ...featuresGridVariants,
  ...announcementBarVariants,
  ...brandStoryVariants,
  ...flashSaleVariants,
  ...productCarouselVariants,
  ...lookbookVariants,
  ...pressMentionsVariants,
  ...sustainabilityVariants,
  ...videoFeatureVariants,
  ...newSectionVariants,
];

const VARIANT_MAP = new Map<string, SectionVariant>(
  ALL_VARIANTS.map(v => [v._meta.variantId, v])
);

// ─── Section Library ──────────────────────────────────────────────────────────

export class SectionLibrary {
  /** Full manifest — used by AI to select variants */
  getManifest(): ManifestEntry[] {
    return SECTION_MANIFEST;
  }

  /** All variants for a given section type */
  getVariants(sectionType: string): SectionVariant[] {
    return ALL_VARIANTS.filter(v => v._meta.variantId.startsWith(sectionType + '.'));
  }

  /** Get a specific variant by ID */
  getVariant(variantId: string): SectionVariant | undefined {
    return VARIANT_MAP.get(variantId);
  }

  /**
   * Instantiate a section variant by filling [[SLOT_NAME]] markers with params.
   *
   * Slot syntax: [[SLOT_NAME]] in any string value in the JSON tree.
   * SDUI runtime interpolation {{state.path}} is NOT touched.
   *
   * @throws Error if variantId not found or required slot is missing
   */
  instantiate(variantId: string, params: SectionParams = {}): Record<string, unknown> {
    const variant = VARIANT_MAP.get(variantId);
    if (!variant) {
      throw new Error(`SectionLibrary: Unknown variantId "${variantId}". Check manifest.ts for valid IDs.`);
    }

    // Check required slots
    for (const slot of variant._meta.requiredSlots) {
      if (!(slot in params) && !(variant._meta.slotDefaults?.[slot])) {
        throw new Error(`SectionLibrary: Required slot "${slot}" missing for variant "${variantId}"`);
      }
    }

    // Merge defaults for optional slots not provided
    const mergedParams: SectionParams = {
      ...(variant._meta.slotDefaults ?? {}),
      ...params,
    };

    // Stringify → replace [[SLOT]] markers → parse back
    const jsonStr = JSON.stringify(variant.node);
    const filled = this.replaceSlots(jsonStr, mergedParams);

    return JSON.parse(filled) as Record<string, unknown>;
  }

  /** Replace all [[SLOT_NAME]] markers in a JSON string */
  private replaceSlots(jsonStr: string, params: SectionParams): string {
    return jsonStr.replace(/\[\[([A-Z_]+)\]\]/g, (match, slotName) => {
      const value = params[slotName];
      if (value === undefined) {
        // Leave unreplaced slots as-is (they may be optional with no default)
        return match;
      }
      return value;
    });
  }

  /**
   * Get the initActions needed for a given variantId.
   * Used to build the screen's initActions array.
   */
  getInitActions(variantId: string): string[] {
    return VARIANT_MAP.get(variantId)?._meta.initActions ?? [];
  }

  /**
   * Get the state paths read by a variant.
   * Used to ensure prebuiltState includes the right keys.
   */
  getStatePaths(variantId: string): string[] {
    return VARIANT_MAP.get(variantId)?._meta.statePaths ?? [];
  }

  /** Get all unique initActions needed for a list of variants */
  collectInitActions(variantIds: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of variantIds) {
      for (const action of this.getInitActions(id)) {
        if (!seen.has(action)) {
          seen.add(action);
          result.push(action);
        }
      }
    }
    return result;
  }

  /** Total number of registered variants */
  get size(): number {
    return VARIANT_MAP.size;
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const sectionLibrary = new SectionLibrary();

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { SectionVariant, SectionParams, ManifestEntry } from './types';
export { SECTION_MANIFEST, buildManifestContext, getVariantsForType } from './manifest';
