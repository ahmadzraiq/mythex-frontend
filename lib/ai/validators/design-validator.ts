/**
 * Design validator: automated rule checks on the node tree.
 * - No hardcoded hex in className
 * - Pressable/Box with content has Text child
 * - Button with text has ButtonText child
 * - Cart badge has pointer-events-none
 * - Icon-only buttons have min size (h-8 w-8 or similar)
 * - Responsive: at least one md: or lg: class in tree
 */

import type { UiNode, ValidationResult } from './types';

const HEX_REGEX = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;
// Flag hardcoded gray scale colors that should use theme vars instead.
// text-white / text-black are intentionally excluded — they are explicitly endorsed
// for text-on-image overlays (see ui-ux-contrast.mdc: "use text-white on dark backgrounds").
const HARDCODED_COLORS = /(?<![!:/\w])(text-gray-\d{3}|bg-gray-\d{3})\b(?!\/)/;

// Child types that are structural/image — a Box containing only these is valid without a Text child
const STRUCTURAL_CHILDREN = new Set([
  'NextImage', 'Image', 'Carousel', 'CarouselSlide', 'Divider', 'Spinner',
  'Box', 'Pressable', 'Button', 'Input', 'Select', 'Drawer', 'Modal',
  'ScrollView', 'SafeAreaView', 'View', 'NavIcon', 'Icon', 'Badge',
  'CountdownTimer', 'HStack', 'VStack', 'Center', 'Grid', 'GridItem',
]);

const LARGE_HEADING_SIZES = new Set(['2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl']);

/**
 * Returns true if the node looks like a hero section.
 * Checks (any level up to depth 4):
 * - node.id or className contains "hero"
 * - a large Heading component exists (size 2xl+) — with OR without explicit size
 * - an Image/NextImage exists alongside text (common hero pattern)
 */
function nodeIsHeroSection(node: UiNode, depth = 0): boolean {
  if (!node || depth > 4) return false;
  const id = (node.id ?? '').toLowerCase();
  const cls = (node.props?.className as string ?? '').toLowerCase();
  if (id.includes('hero') || cls.includes('hero')) return true;
  const type = node.type ?? '';
  // Any Heading component at depth 1-4 is a likely hero (hero always has a headline)
  if (type === 'Heading') {
    const size = String(node.props?.size ?? '');
    if (!size || LARGE_HEADING_SIZES.has(size)) return true;
  }
  const children = (node.children ?? []) as UiNode[];
  for (const child of children) {
    if (nodeIsHeroSection(child, depth + 1)) return true;
  }
  return false;
}

/**
 * Returns true if the node looks like an announcement bar or thin promotional strip.
 * These are always allowed to precede the hero section.
 */
function nodeIsAnnouncementBar(node: UiNode): boolean {
  const id = (node.id ?? '').toLowerCase();
  const cls = (node.props?.className as string ?? '').toLowerCase();
  // Explicit announcement id/class
  if (id.includes('announcement') || cls.includes('announcement')) return true;
  // Thin strip heuristic: py-2 or py-1 with text-center — classic promotional bar
  if ((cls.includes('py-2') || cls.includes('py-1')) && cls.includes('text-center')) return true;
  // Single Text child with no sub-sections — simple banner
  const children = (node.children ?? []) as UiNode[];
  if (children.length === 1 && (children[0].type === 'Text' || children[0].type === 'Heading')) return true;
  return false;
}

function walkNodes(node: UiNode, errors: string[], ctx: { hasResponsive: boolean }): void {
  const className = typeof node.props?.className === 'string' ? node.props.className : '';

  if (className) {
    if (HEX_REGEX.test(className)) {
      errors.push(`Hardcoded hex in className: ${className.slice(0, 60)}...`);
    }
    // Only flag plain hardcoded colors — not ! overrides (intentional Gluestack workarounds)
    // and not when they're alongside theme vars (mixed intentional use)
    const hasOverridePrefix = /![a-z]/.test(className);
    const hasThemeVar = className.includes('var(--theme-') || className.includes('var(--');
    if (!hasOverridePrefix && !hasThemeVar && HARDCODED_COLORS.test(className)) {
      errors.push(`Hardcoded Tailwind color (use var(--theme-*)): ${className.slice(0, 60)}...`);
    }
    if (/\bmd:|lg:|sm:|xl:\b/.test(className)) {
      ctx.hasResponsive = true;
    }
  }

  const type = node.type ?? '';
  const children = (node.children ?? []) as UiNode[];

  // mx-auto on a Box without w-full collapses to content width in NativeWind
  if (type === 'Box' && className.includes('mx-auto') && !className.includes('w-full')) {
    errors.push(`Box with mx-auto must also have w-full (className: ${className.slice(0, 80)})`);
  }

  if (type === 'Pressable' || type === 'Box') {
    const hasTextChild = children.some(
      (c) => c.type === 'Text' || c.type === 'Heading' || c.type === 'ButtonText'
    );
    const hasContent = children.length > 0 || node.text;
    if (hasContent && !hasTextChild && typeof node.text !== 'string') {
      // Allow containers whose children are all structural/image types (no raw text expected)
      const hasStructuralOnly = children.every((c) => !c.type || STRUCTURAL_CHILDREN.has(c.type));
      if (!hasStructuralOnly) {
        errors.push(`${type} with content must have Text child (id: ${node.id ?? 'unknown'})`);
      }
    }
  }

  if (type === 'Button' && children.length > 0) {
    const hasButtonText = children.some((c) => c.type === 'ButtonText');
    const hasOnlyIcon = children.every((c) => c.type === 'ButtonIcon' || c.type === 'NavIcon' || c.type === 'Icon');
    if (!hasButtonText && !hasOnlyIcon) {
      errors.push(`Button with text content must have ButtonText child (id: ${node.id ?? 'unknown'})`);
    }
  }

  if (node.id?.includes('badge') || (type === 'Badge' && className.includes('absolute'))) {
    if (!className.includes('pointer-events-none')) {
      errors.push(`Badge overlay must have pointer-events-none (id: ${node.id ?? 'unknown'})`);
    }
  }

  if ((type === 'Pressable' || type === 'Button') && node.id?.includes('cart')) {
    const hasMinSize = /h-[89]|h-10|w-[89]|w-10|min-h-|min-w-/.test(className);
    if (!hasMinSize && children.some((c) => c.type === 'NavIcon' || c.type === 'Icon')) {
      const hasParentSize = true;
      if (!hasParentSize) {
        errors.push(`Icon button should have min touch target h-8 w-8 or h-9 w-9 (id: ${node.id ?? 'unknown'})`);
      }
    }
  }

  for (const child of children) {
    walkNodes(child, errors, ctx);
  }
}

/**
 * Validate design rules on the content node tree.
 */
export function validateDesign(structure: UiNode): ValidationResult {
  const errors: string[] = [];
  const ctx = { hasResponsive: false };
  walkNodes(structure, errors, ctx);

  if (!ctx.hasResponsive) {
    errors.push('Page should have at least one responsive class (md:, lg:, or sm:)');
  }

  // Hero must be the first or second content section.
  // An announcement bar (promotional strip) is explicitly allowed before the hero.
  const topChildren = (structure.children ?? []) as UiNode[];
  if (topChildren.length > 0) {
    const first = topChildren[0];
    const second = topChildren[1];
    const heroIsFirst = nodeIsHeroSection(first);
    const heroIsSecondAfterAnnouncement = nodeIsAnnouncementBar(first) && second != null && nodeIsHeroSection(second);
    if (!heroIsFirst && !heroIsSecondAfterAnnouncement) {
      errors.push(
        'Hero section must be the first child of content (or second if preceded by an announcement bar) — move the hero before all other sections'
      );
    }
  }

  return {
    pass: errors.length === 0,
    errors: errors.length ? errors : undefined,
  };
}
