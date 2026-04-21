/**
 * Section blueprint registry - maps section types to shared component IDs.
 */

export type SectionBlueprint = {
  sharedComponentId: string;
  defaultProps?: Record<string, unknown>;
};

const SECTION_BLUEPRINTS: Record<string, SectionBlueprint> = {
  navbar:            { sharedComponentId: 'sc-navbar' },
  footer:            { sharedComponentId: 'sc-footer' },
  'product-carousel':{ sharedComponentId: 'sc-product-carousel' },
  hero:              { sharedComponentId: 'sc-hero' },
  'product-grid':    { sharedComponentId: 'sc-product-grid', defaultProps: { columns: 4 } },
  'feature-grid':    { sharedComponentId: 'sc-feature-grid', defaultProps: { items: 3 } },
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
    sharedComponentId: blueprint.sharedComponentId,
    defaultProps: Object.keys(defaultProps).length ? defaultProps : undefined,
  };
}
