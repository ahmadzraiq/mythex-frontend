/**
 * Schema-to-screen mapper - converts AI-generated layout schema to SDUI screen config.
 * Uses section blueprints and variant registry for $ref resolution.
 * layoutParts (navbar.overrides, etc.) are passed through to config-resolver; see sdui-layout-part-overrides.mdc.
 */

import type {
  LayoutSchema,
  LayoutSection,
} from '@/config/schema/layout-schema';
import { getSectionBlueprint } from '@/config/section-blueprints';
import { layouts } from '@/config/layouts';
import { fragments } from '@/config/fragments';
import { resolveScreenConfig, type ConfigRegistry } from '@/lib/sdui/config-resolver';

const CONTENT_SECTION_TYPES = ['hero', 'product-grid', 'product-carousel', 'feature-grid'] as const;

export type ScreenConfig = {
  meta: { title: string };
  state: object;
  layout: string;
  content: object;
  initActions: Array<{ action: string }>;
};

const registry: ConfigRegistry = {
  layouts: layouts as ConfigRegistry['layouts'],
  fragments: fragments as ConfigRegistry['fragments'],
};

function sectionToRef(section: LayoutSection | string): { $ref: string } | null {
  const type = typeof section === 'string' ? section : section.type;
  const variant =
    typeof section === 'object'
      ? (section.variant ?? section.style)
      : undefined;
  const sectionProps =
    typeof section === 'object'
      ? { columns: section.columns, items: section.items }
      : undefined;
  const blueprint = getSectionBlueprint(type, variant, sectionProps);
  if (!blueprint) return null;
  return { $ref: blueprint.$ref };
}

/**
 * Maps a layout schema (or explicit sections) to a full screen config, then resolves $ref and $slot.
 * When explicitSections is provided (string[]), uses default variants per type.
 * When schema.sections is used, respects variant/style per section.
 */
export function schemaToScreen(
  schema: LayoutSchema,
  explicitSections?: string[]
): Record<string, unknown> {
  const sections: Array<LayoutSection | string> = explicitSections
    ? explicitSections.filter((t) =>
        CONTENT_SECTION_TYPES.includes(t as (typeof CONTENT_SECTION_TYPES)[number])
      )
    : schema.sections.filter((s) =>
        CONTENT_SECTION_TYPES.includes(s.type as (typeof CONTENT_SECTION_TYPES)[number])
      );

  const contentChildren = sections
    .map((s) => sectionToRef(s))
    .filter((x): x is { $ref: string } => x !== null);

  const content = {
    type: 'Box',
    props: { className: 'w-full min-h-screen' },
    children: contentChildren,
  };

  const screenConfig: ScreenConfig & { layoutParts?: LayoutSchema['layoutParts'] } = {
    meta: { title: 'AI Generated Homepage' },
    state: {},
    layout: 'store',
    content,
    initActions: [
      { action: 'fetchNavCollections' },
      { action: 'fetchFeaturedProducts' },
    ],
    layoutParts: schema.layoutParts,
  };

  return resolveScreenConfig(
    screenConfig as Parameters<typeof resolveScreenConfig>[0],
    registry
  ) as Record<string, unknown>;
}
