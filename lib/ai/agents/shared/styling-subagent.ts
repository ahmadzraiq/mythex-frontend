/**
 * Shared pieces for Layout, Colors, and Typography+Animation agents
 * (dynamic theme/project block, batch rule).
 */

export type StylingSubAgentContext = {
  pages: Array<{ id: string; name: string; route: string }>;
  currentPageName: string;
  currentPageRoute?: string;
  paletteSnapshot?: string;
  mood?: string;
  appName?: string;
  description?: string;
  category?: string;
};

/** Shared batch+retry footer — use in all styling agents */
export const BATCH_RETRY_RULE = `Batch all independent calls. On errors, retry with corrected params.`;

export function buildStylingDynamicPart(context: StylingSubAgentContext): string {
  const projectLines = [
    context.category ? `Category: ${context.category}` : null,
  ].filter(Boolean).join('\n');

  const themeBlock = context.paletteSnapshot
    ? `## Theme\n\nAvailable tokens (use 'theme:tokenName' in formula ternaries, or pass the token name as a bg/color value for static use):\n\n${context.paletteSnapshot}`
    : `## Theme\n\nAvailable tokens (use 'theme:tokenName' in formula ternaries, or pass the token name as a bg/color value for static use): background, foreground, card, card-foreground, muted, muted-foreground, border, primary, primary-foreground, secondary, accent, destructive.`;

  return [
    projectLines ? `## Project\n${projectLines}` : null,
    `## Builder\n- Page: "${context.currentPageName}"${context.currentPageRoute ? ` (${context.currentPageRoute})` : ''}\n- Pages: ${context.pages.map(p => `${p.name} ${p.route} (${p.id})`).join(', ')}`,
    themeBlock,
  ].filter(Boolean).join('\n\n');
}
