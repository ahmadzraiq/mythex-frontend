/**
 * Section variant registry. Variants removed: sections use single shared components.
 */

export type SectionVariantDef = {
  id: string;
  label: string;
  sharedComponentId: string;
};

export const SECTION_VARIANTS: Record<string, SectionVariantDef[]> = {} as const;
