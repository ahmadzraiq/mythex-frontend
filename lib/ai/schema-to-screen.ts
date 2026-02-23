/**
 * Schema-to-screen mapper - converts AI-generated layout schema to SDUI screen config.
 * Uses section blueprints and variant registry for $ref resolution.
 * layoutParts (navbar.overrides, etc.) are passed through to config-resolver; see sdui-layout-part-overrides.mdc.
 * When a section has inline `content` (heading, subheading, ctaText, ctaUrl, features),
 * it is rendered as inline SDUI nodes instead of a $ref fragment.
 */

import type {
  LayoutSchema,
  LayoutSection,
  SectionInlineContent,
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

/** Build an inline hero node from AI-generated content data */
function buildHeroInlineNode(content: SectionInlineContent): Record<string, unknown> {
  const children: Record<string, unknown>[] = [];

  if (content.heading) {
    children.push({
      type: 'Heading',
      props: { size: '4xl', className: 'font-bold text-center text-[var(--theme-hero-text,var(--theme-content-text))] drop-shadow-sm' },
      text: content.heading,
    });
  }

  if (content.subheading) {
    children.push({
      type: 'Text',
      props: { className: 'text-lg text-center text-[var(--theme-hero-text,var(--theme-content-text))] opacity-80 mt-3' },
      text: content.subheading,
    });
  }

  if (content.ctaText) {
    children.push({
      type: 'Button',
      props: {
        className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] hover:!bg-[var(--theme-shop-buttonHover)] mt-6 px-8',
      },
      actions: {
        click: {
          action: 'navigate',
          payload: { path: content.ctaUrl ?? '/collection' },
        },
      },
      children: [
        { type: 'ButtonText', text: content.ctaText },
      ],
    });
  }

  return {
    type: 'Box',
    props: {
      className: 'w-full min-h-[420px] flex flex-col items-center justify-center px-6 py-20 bg-[var(--theme-hero-bg,var(--theme-content-bg))]',
    },
    children,
  };
}

/** Build an inline feature-grid node from AI-generated content data */
function buildFeatureGridInlineNode(content: SectionInlineContent): Record<string, unknown> {
  const features = content.features ?? [];
  const featureNodes = features.map((f) => ({
    type: 'Box',
    props: { className: 'flex flex-col items-center gap-3 p-6 rounded-xl border border-gray-100 dark:border-gray-800' },
    children: [
      ...(f.title ? [{ type: 'Heading', props: { size: 'lg', className: 'font-semibold text-center' }, text: f.title }] : []),
      ...(f.description ? [{ type: 'Text', props: { className: 'text-sm text-center text-gray-500 dark:text-gray-400' }, text: f.description }] : []),
    ],
  }));

  return {
    type: 'Box',
    props: { className: 'w-full py-16 px-6' },
    children: [
      {
        type: 'Box',
        props: {
          className: `w-full max-w-6xl mx-auto grid grid-cols-1 gap-6 ${
            features.length === 2 ? 'md:grid-cols-2' : features.length >= 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'
          }`,
        },
        children: featureNodes,
      },
    ],
  };
}

/** Returns an inline SDUI node when content is present, otherwise falls back to $ref */
function sectionToNode(section: LayoutSection | string): Record<string, unknown> | { $ref: string } | null {
  const type = typeof section === 'string' ? section : section.type;
  const sectionObj = typeof section === 'object' ? section : null;
  const content = sectionObj?.content;

  if (content && type === 'hero') {
    return buildHeroInlineNode(content);
  }

  if (content && type === 'feature-grid') {
    return buildFeatureGridInlineNode(content);
  }

  const variant = sectionObj ? (sectionObj.variant ?? sectionObj.style) : undefined;
  const sectionProps = sectionObj ? { columns: sectionObj.columns, items: sectionObj.items } : undefined;
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
    .map((s) => sectionToNode(s))
    .filter((x): x is NonNullable<ReturnType<typeof sectionToNode>> => x !== null);

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
