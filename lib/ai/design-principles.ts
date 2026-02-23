/**
 * Senior designer persona context for AI generators.
 * Encodes visual hierarchy, spacing, typography, color, responsive, and accessibility rules.
 * Inject into navbar-structure-spec, screen-generator, layout-generator prompts.
 */

export function buildDesignPrinciplesContext(): string {
  return `DESIGN PRINCIPLES (senior designer rules):

VISUAL HIERARCHY:
- Headings > body text. Use text-2xl, text-3xl, text-4xl for headings; text-sm, text-base for body.
- Primary action > secondary. Primary CTA: !bg-[var(--theme-shop-button)]. Secondary: outline or muted.
- One focal point per section. Avoid competing elements of equal visual weight.

SPACING SYSTEM:
- Use gap-2, gap-4, gap-6, gap-8 for consistent spacing. Never arbitrary margin soup (m-3, mt-5, mb-2).
- Padding scale: p-2, p-4, p-6, p-8. Match gap scale for rhythm.
- Navbar: px-4 or px-6 for horizontal padding, py-3 or py-4 for vertical.

TYPOGRAPHY:
- Heading sizes: text-xl (section), text-2xl (card title), text-3xl (hero), text-4xl (page title).
- Body: text-sm (secondary), text-base (primary). Never smaller than text-sm for readable content.
- Use theme vars: text-[var(--theme-header-text)], text-[var(--theme-content-textMuted)].

COLOR USAGE:
- Primary CTA: !bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)]
- Muted text: text-[var(--theme-content-textMuted)]
- Never dark-on-dark. On dark bg use text-white, text-white/90. On light bg use dark text.
- Navbar: always use var(--theme-*). Never hardcode hex or Tailwind colors like bg-white, text-gray-900.

RESPONSIVE FIRST:
- Mobile layout first. Desktop enhancements with md:, lg: breakpoints.
- Desktop-only: hidden md:flex. Mobile-only: md:hidden.
- Navbar: collections hidden on mobile (hidden md:flex), hamburger or simplified nav on mobile.

ACCESSIBLE INTERACTIVE ELEMENTS:
- Min touch target: h-9 w-9 (36px) for icon buttons. h-8 w-8 acceptable for dense navbars.
- Focus rings: focus:ring-2 focus:ring-offset-2 for keyboard users.
- Cart badge: pointer-events-none so it does not block clicks.

COMPONENT DENSITY:
- Navbar max 3 main sections: left, center, right. Do not overcrowd.
- Max 5 nav links without a mega-menu. More than 5: use dropdown or mega-menu.
- Icon row: gap-1 or gap-2 between icons. Not gap-4 (too sparse).

IMAGE + TEXT:
- Text overlaying images: bg-gradient-to-t from-black/80 via-black/30 to-transparent.
- Add drop-shadow-sm to text on images for readability.
- Use text-white or text-white/90 for secondary text on dark overlays.

NO DUPLICATE SECTIONS:
- Newsletter, promo banner, etc.: place in one location only (e.g. footer). Not both hero and footer.`;
}
