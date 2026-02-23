/**
 * Section blueprint registry - maps layout schema section types to fragments.
 * Single variant per section (no variant selection).
 */

export type SectionBlueprint = {
  $ref: string;
  defaultProps?: Record<string, unknown>;
};

/** Get fragment $ref for a layout part (navbar, footer). */
export function getLayoutPartRef(part: 'navbar' | 'footer'): string | null {
  return SECTION_BLUEPRINTS[part]?.$ref ?? null;
}

const SECTION_BLUEPRINTS: Record<string, SectionBlueprint> = {
  navbar: { $ref: 'fragments/layout/navbar' },
  footer: { $ref: 'fragments/layout/footer' },
  'product-carousel': {
    $ref: 'fragments/sections/product-carousel',
    defaultProps: {},
  },
  hero: { $ref: 'fragments/sections/hero' },
  'product-grid': { $ref: 'fragments/sections/product-grid', defaultProps: { columns: 4 } },
  'feature-grid': { $ref: 'fragments/sections/feature-grid', defaultProps: { items: 3 } },
};

export function getSectionBlueprint(
  type: string,
  _variant?: string | null,
  sectionProps?: Record<string, unknown>
): SectionBlueprint | null {
  const blueprint = SECTION_BLUEPRINTS[type];
  if (!blueprint) return null;
  const defaultProps: Record<string, unknown> = { ...blueprint.defaultProps };
  if (type === 'product-grid' && sectionProps?.columns) {
    defaultProps.columns = sectionProps.columns;
  }
  if (type === 'feature-grid' && sectionProps?.items) {
    defaultProps.items = sectionProps.items;
  }
  return {
    $ref: blueprint.$ref,
    defaultProps: Object.keys(defaultProps).length ? defaultProps : undefined,
  };
}
