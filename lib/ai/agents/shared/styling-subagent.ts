/**
 * Shared pieces for Layout, Colors, and Typography+Animation agents
 * (dynamic theme/project block, animation level, batch rule).
 */

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

/** Shared batch+retry footer — use in all styling agents */
export const BATCH_RETRY_RULE = `Batch all independent calls. On errors, retry with corrected params.`;

/** Shared animation level guidance block — injected when animationLevel > 0 */
export function buildAnimLevelBlock(animationLevel: number | undefined): string | null {
  if (animationLevel == null || animationLevel <= 0) return null;
  const ANIM = ['none', 'subtle', 'moderate', 'rich'];
  const label = ANIM[animationLevel] ?? animationLevel;
  return `## Animation Level: ${label}

subtle → enter on 1-2 key nodes. No loops.
moderate → enter on major sections. One loop on a key element.
rich → enter on all sections + loops: float, breathe, glowPulse (always add loopColor), gradientColors.

Easing: enterSpring + stiffness/damping for bouncy entrances. scrollThreshold 0.1-0.3 for scroll reveals.`;
}

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
