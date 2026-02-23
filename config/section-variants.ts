/**
 * Section variant registry - maps $ref base path to layout part key.
 * Variants removed: hero, product-grid, feature-grid use single fragments.
 */

/** Maps $ref base path to layout part key. Config-resolver uses this for variant + overrides (no hardcoding). */
export const LAYOUT_PART_REF_MAP: Record<string, string> = {
  'fragments/layout/navbar': 'navbar',
  'fragments/layout/footer': 'footer',
};

export type SectionVariantDef = {
  id: string;
  label: string;
  $ref: string;
};

export const SECTION_VARIANTS: Record<string, SectionVariantDef[]> = {} as const;

export function getVariantRef(
  sectionType: string,
  variantId?: string | null
): string | null {
  const variants = SECTION_VARIANTS[sectionType];
  if (!variants) return null;
  const v = variantId
    ? variants.find((x) => x.id === variantId)
    : variants[0];
  return v?.$ref ?? null;
}
