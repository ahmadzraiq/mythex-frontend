/**
 * Schema-driven system prompt for navbar structure generation (full AI control).
 * AI creates the entire navbar from scratch; uses real navbar.json as canonical reference.
 */

import { ALLOWED_SDUI_TYPES } from '@/config/schema/layout-schema';
import {
  buildNavbarThemeVarsContext,
  buildSduiReference,
} from './sdui-config-context';
import { buildCorrectionsContext } from './eval/corrections-builder';
import { buildDesignPrinciplesContext } from './design-principles';
import { buildTechPatternsContext } from './tech-patterns';
import { fragments } from '@/config/fragments';

const navbarFragment = fragments['fragments/layout/navbar'] as Record<string, unknown>;
const CANONICAL_REFERENCE = JSON.stringify(navbarFragment, null, 2);

export type BuildNavbarPromptOptions = {
  predefinedTheme?: { themeVars: Record<string, string> };
};

export function buildNavbarStructureSystemPrompt(
  options?: BuildNavbarPromptOptions
): string {
  const allowedTypesList = [...ALLOWED_SDUI_TYPES].join(', ');
  const themeContext = buildNavbarThemeVarsContext(options?.predefinedTheme);

  return `You are a navbar builder. The user describes what they want for an e-commerce navbar. Create the ENTIRE navbar from scratch. Output ONLY valid JSON—no markdown, no explanation.

Output shape: { "structure": <root node> }. The root node MUST have id: "navbar-root" and props.className including "fixed top-0 left-0 right-0 z-50" (or equivalent) so it behaves as a fixed navbar.

CANONICAL REFERENCE (match this format: theme vars, action names, node IDs, responsive classes):
${CANONICAL_REFERENCE}

VALID node.type: ${allowedTypesList}. NEVER invent types like cartIcon—use NavIcon with icon "ShoppingBag".

STRUCTURE RULES:
- Use var(--theme-*) for ALL colors in className. Never hardcode hex (e.g. #fff) in navbar.
- Use layout action names exactly: toggleThemeMenu, closeThemeMenu, setThemeLight, setThemeDark, setThemeSystem, goToCart, logout.
- Use the listed node IDs for key elements (navbar-root, navbar-inner, navbar-row, navbar-left, navbar-right, navbar-actions, navbar-collections, navbar-theme, navbar-cart, navbar-auth).
- Responsive: hidden md:flex for desktop-only (e.g. collections), hidden sm:flex for hide-on-mobile (e.g. user name).
- Theme dropdown: backdrop condition { "var": "nav.themeMenuOpen" }, closeThemeMenu on backdrop click, toggleThemeMenu on button, setThemeLight/setThemeDark/setThemeSystem on menu items.

COMPUTED / EXPR:
- Cart badge: condition { ">": [{ "var": ["cart.totalQuantity", 0] }, 0] }. Text: { "expr": { "var": "cart.totalQuantity" } }. Badge: pointer-events-none. Position: absolute -top-0.5 -right-0.5 (NOT top-0 right-0—that overlaps the icon). Size: h-3.5 w-3.5. Cart button Pressable: relative inline-flex items-center justify-center h-8 w-8 rounded.
- Auth: { "==": [{ "var": "auth.user" }, null] } for Sign in, { "!=": [{ "var": "auth.user" }, null] } for logged-in UI (Profile, Sign out).
- Logged-in greeting: {{auth.user.firstName}} in Text interpolation.

LOGO RULES:
- NEVER use NextImage with a brand-specific path like /brand-logo.svg or /velour-logo.svg — these files do not exist on the server and will show a broken image.
- Safe options: (1) A Text or Heading node with the brand name as text — ALWAYS works. (2) NextImage with src="/logo.svg" or src="/vendure.svg" ONLY if you are adapting the canonical reference above and the brand name matches.
- Default to the text approach: { "type": "Heading", "props": { "size": "lg", "className": "font-bold text-[var(--theme-header-text)]" }, "text": "<BrandName>" }
- If the user prompt implies a logo image exists (e.g. "use the uploaded logo"), you may use NextImage, otherwise always use text.

OTHER RULES:
- Button with text: use ButtonText child. Include !bg-* and !text-* in className for visibility.
- props.style values: strings only. No JSON Logic in styles.
- No $ref in output—everything inline.
- Pressable/Box cannot have raw text; wrap in Text child.

${themeContext}

${buildDesignPrinciplesContext()}

${buildTechPatternsContext()}

FULL SDUI SCHEMA REFERENCE (screens, layouts, fragments, state, actions, routes, computed, validation):
${buildSduiReference()}

${buildCorrectionsContext('navbar')}
Output valid JSON only.`;
}
