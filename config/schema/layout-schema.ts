/**
 * Layout schema for AI-generated homepage layouts.
 * Used by generateObject (Vercel AI SDK) to produce typed structured output.
 */

import { z } from 'zod';
import { COMPONENT_NAMES } from '../component-names';

export const sectionTypeEnum = z.enum([
  'navbar',
  'hero',
  'product-grid',
  'product-carousel',
  'feature-grid',
  'footer',
]);

export const layoutSectionSchema = z.object({
  type: sectionTypeEnum,
  style: z.string().optional(),
  variant: z.string().optional(),
  columns: z.number().min(1).max(6).optional(),
  items: z.number().min(1).max(6).optional(),
  source: z.preprocess(
    (val) => (typeof val === 'string' && val.toLowerCase().trim() === 'featured' ? 'featured' : undefined),
    z.enum(['featured']).optional()
  ),
});

export const ALLOWED_SDUI_TYPES = COMPONENT_NAMES;

/** Regex for valid store paths (e.g. nav.collections, cart.lines) */
const MAP_PATH_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

const sduiNodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    type: z.enum(ALLOWED_SDUI_TYPES),
    id: z.string().optional(),
    map: z.string().optional(),
    key: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    text: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    actions: z.record(z.string(), z.unknown()).optional(),
    condition: z.unknown().optional(),
    children: z.array(sduiNodeSchema).optional(),
  })
);

export const addNodeSchema = z.object({
  parentId: z.string(),
  position: z.union([z.number().min(0), z.literal('last')]),
  node: sduiNodeSchema,
});

/** Generic layout part structure schema - reusable for navbar, hero, footer */
function layoutPartStructureSchema(requiredRootId?: string) {
  const nodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
    z
      .object({
        type: z.enum(ALLOWED_SDUI_TYPES),
        id: z.string().optional(),
        map: z.string().optional(),
        key: z.string().optional(),
        props: z
          .record(
            z.string(),
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.record(z.string(), z.unknown()),
            ])
          )
          .optional(),
        text: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
        actions: z.record(z.string(), z.unknown()).optional(),
        condition: z.unknown().optional(),
        children: z.array(nodeSchema).optional(),
      })
      .refine(
        (n) => {
          if (n.map && typeof n.map === 'string') {
            return MAP_PATH_REGEX.test(n.map);
          }
          return true;
        },
        { message: 'map must be a valid store path (e.g. nav.collections, cart.lines)' }
      )
      .refine(
        (n) => {
          const style = n.props?.style as Record<string, unknown> | undefined;
          if (style && typeof style === 'object') {
            return Object.values(style).every((v) => typeof v === 'string' || typeof v === 'number');
          }
          return true;
        },
        { message: 'style values must be strings or numbers only' }
      )
  );

  const rootSchema = requiredRootId
    ? nodeSchema.refine(
        (n) => n.id === requiredRootId,
        { message: `Root node must have id: "${requiredRootId}"` }
      )
    : nodeSchema;

  return rootSchema;
}

export const navbarStructureSchema = layoutPartStructureSchema('navbar-root');

export const navbarGeneratorOutputSchema = z.object({
  structure: navbarStructureSchema,
});

export const navbarOverrideSchema = z.object({
  navOrder: z
    .array(z.enum(['logo', 'collections', 'search', 'theme', 'cart', 'auth']))
    .optional(),
  conditionOverrides: z
    .record(z.string(), z.union([z.boolean(), z.record(z.string(), z.unknown())]))
    .optional(),
  mapSourceOverrides: z
    .record(
      z.string(),
      z.union([
        z.string(),
        z.object({ expr: z.record(z.string(), z.unknown()) }),
      ])
    )
    .optional(),
  propsOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  addNodes: z.array(addNodeSchema).optional(),
  childOrder: z.record(z.string(), z.array(z.string())).optional(),
  classNameOverrides: z.record(z.string(), z.string()).optional(),
  styleOverrides: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  textOverrides: z
    .record(z.string(), z.union([z.string(), z.record(z.string(), z.unknown())]))
    .optional(),
  actionsOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  removeNodes: z.array(z.string()).optional(),
});

export const layoutSchema = z.object({
  pageType: z.literal('homepage'),
  style: z.string().optional(),
  sections: z.array(layoutSectionSchema),
  layoutParts: z
    .object({
      navbar: z
        .object({
          structure: navbarStructureSchema.optional(),
        })
        .optional(),
      footer: z.object({ variant: z.string().optional() }).optional(),
    })
    .optional(),
});

const colorSetSchema = z.object({
  primary: z.string().optional(),
  secondary: z.string().optional(),
  accent: z.string().optional(),
  background: z.string().optional(),
  textPrimary: z.string().optional(),
  textSecondary: z.string().optional(),
});

export const themeSchema = z.object({
  designMood: z.string().optional(),
  mode: z.enum(['light', 'dark', 'both']).optional(),
  style: z.enum(['modern', 'minimal', 'luxury', 'custom']).optional(),
  mood: z
    .preprocess(
      (val) => {
        const s = typeof val === 'string' ? val.toLowerCase().trim() : val;
        if (s && ['light', 'dark', 'both', 'warm', 'cool'].includes(String(s))) return s;
        return undefined;
      },
      z.enum(['light', 'dark', 'both', 'warm', 'cool']).optional()
    ),
  colors: z
    .object({
      primary: z.string().optional(),
      heroBg: z.string().optional(),
      headerBg: z.string().optional(),
      headerText: z.string().optional(),
      headerBorder: z.string().optional(),
      button: z.string().optional(),
      buttonHover: z.string().optional(),
      buttonText: z.string().optional(),
      footerBg: z.string().optional(),
      footerText: z.string().optional(),
      footerTextMuted: z.string().optional(),
      light: colorSetSchema.optional(),
      dark: colorSetSchema.optional(),
    })
    .optional(),
  fonts: z
    .object({
      heading: z.string().optional(),
      body: z.string().optional(),
    })
    .optional(),
  fontSizes: z.enum(['small', 'medium', 'large']).optional(),
});

export const fullGenerationSchema = z.object({
  layout: layoutSchema,
  theme: themeSchema,
});

export type NavbarOverrides = z.infer<typeof navbarOverrideSchema>;
export type NavbarStructure = z.infer<typeof navbarStructureSchema>;
export type LayoutSection = z.infer<typeof layoutSectionSchema>;
export type LayoutSchema = z.infer<typeof layoutSchema>;
export type ThemeConfig = z.infer<typeof themeSchema>;
export type FullGenerationResult = z.infer<typeof fullGenerationSchema>;
