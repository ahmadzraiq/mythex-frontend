/**
 * Shared pieces for Layout, Colors, and Typography+Animation agents
 * (container vs template, dynamic theme/project block).
 */

import { SHARED_FORMULA_SYNTAX } from './formula-scope';

export type StylingSubAgentContext = {
  pages: Array<{ id: string; name: string; route: string }>;
  currentPageName: string;
  currentPageRoute?: string;
  paletteSnapshot?: string;
  mood?: string;
  animationLevel?: number;
  appName?: string;
  description?: string;
  category?: string;
};

export function buildStylingCore(containerVsTemplate: string): string {
  return `${SHARED_FORMULA_SYNTAX}

## Repeat Scope Rule

context?.item?.data formulas ONLY on repeated nodes and their descendants. Never on the Grid/container parent.

${containerVsTemplate}

## Nested Repeat Scope

Inside a nested repeat, outer fields require \`.parent\`:
- context?.item?.data?.field — INNER repeat item
- context?.item?.parent?.data?.field — OUTER template item`;
}

export const LAYOUT_CVT = `## Container vs Template

Node with \`_needsRepeat\` = TEMPLATE (per item). Its PARENT = CONTAINER (once).
Container gets: grid layout, gap, section width.
Template gets: padding, position offset.
NEVER: set_layout(gridCols) on template, context?.item on container.`;

export const COLORS_CVT = `## Container vs Template

Node with \`_needsRepeat\` = TEMPLATE (per item). Its PARENT = CONTAINER (once).
Container gets: static backgrounds.
Template gets: per-item bg ternary, per-item border/shadow.
NEVER: context?.item on container, ternary bg on container.`;

export const TYPO_CVT = `## Container vs Template

Node with \`_needsRepeat\` = TEMPLATE (per item). Its PARENT = CONTAINER (once).
Container gets: enter/scroll animations.
Template gets: hover/press animations.
NEVER: enter animation with item-level ternary on container.`;

export function buildStylingDynamicPart(context: StylingSubAgentContext): string {
  const ANIM = ['none', 'subtle', 'moderate', 'rich'];
  const projectLines = [
    context.category ? `Category: ${context.category}` : null,
    context.animationLevel != null ? `Animation: ${ANIM[context.animationLevel] ?? context.animationLevel}` : null,
  ].filter(Boolean).join('\n');

  const themeBlock = context.paletteSnapshot
    ? `## Theme\n\nStatic: set_background(id, {bg:"primary"}). Formula ternaries: 'theme:tokenName' — resolves to hex at runtime.\n\n${context.paletteSnapshot}`
    : `## Theme\n\nStatic: set_background(id, {bg:"primary"}). Formula ternaries: 'theme:tokenName' — resolves to hex at runtime.\n\nTokens: background, foreground, card, card-foreground, muted, muted-foreground, border, primary, primary-foreground, secondary, accent, destructive.`;

  return [
    projectLines ? `## Project\n${projectLines}` : null,
    `## Builder\n- Page: "${context.currentPageName}"${context.currentPageRoute ? ` (${context.currentPageRoute})` : ''}\n- Pages: ${context.pages.map(p => `${p.name} ${p.route} (${p.id})`).join(', ')}`,
    themeBlock,
  ].filter(Boolean).join('\n\n');
}
