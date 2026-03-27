/**
 * Builds the system + user prompts for the section node generator.
 * Token-efficient: only includes schemas for the components actually used in the section.
 */

import { COMPONENT_SCHEMA } from './sdui-component-schema';
import type { AiSectionWithHints } from '@/app/api/ai/generate-sections/route';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectionPromptInput {
  section: AiSectionWithHints;
  animationLevel: number;         // 0 = none, 1 = subtle, 2 = medium, 3 = rich
  mood: string;
  appName: string;
  businessDescription: string;
  category: string;
  pageRoutes: Array<{ name: string; route: string }>;
}

export interface BuiltPrompts {
  system: string;
  user: string;
}

// ---------------------------------------------------------------------------
// Theme variable reference — injected into every prompt
// ---------------------------------------------------------------------------

const THEME_VARS = `
THEME CSS VARIABLES — ALWAYS use these for colors (never hardcoded hex):
NAVIGATION:  bg-[var(--theme-header-bg)] text-[var(--theme-header-text)] border-[var(--theme-header-border)]
HERO/PAGE:   bg-[var(--theme-hero-bg)]  bg-[var(--theme-content-bg)]
CONTENT:     text-[var(--theme-foreground)]  text-[var(--theme-muted-foreground)]
FOOTER:      bg-[var(--theme-footer-bg)] text-[var(--theme-footer-text)] text-[var(--theme-footer-textMuted)]
CTA BUTTON:  bg-[var(--theme-shop-button)] hover:bg-[var(--theme-shop-buttonHover)] text-[var(--theme-shop-buttonText)]
OUTLINE BTN: border-[var(--theme-shop-button)] text-[var(--theme-shop-button)] bg-transparent
CARDS:       bg-[var(--theme-card)] text-[var(--theme-card-foreground)]
PRIMARY:     bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)]
BORDERS:     border-[var(--theme-border)]
MUTED BG:    bg-[var(--theme-muted)]
ACCENT:      text-[var(--theme-shop-button)] (use for highlights, prices, accents)
FONTS applied globally — do NOT add fontFamily props. Headings auto-use heading font, body auto-uses body font.`.trim();

// ---------------------------------------------------------------------------
// Icon guidance — use Icon component with api.iconify.design
// ---------------------------------------------------------------------------

const ICON_GUIDE = `
ICONS — use type "Icon". Format: {"type":"Icon","props":{"icon":"SET:NAME","size":24,"color":"currentColor","className":"..."}}
Popular sets and icons (use semantically correct ones):
  heroicons: star, heart, shopping-cart, user, check-circle, arrow-right, arrow-left, map-pin, phone, envelope, globe-alt, sparkles, fire, bolt, shield-check, clock, calendar, truck, tag, gift, coffee, users, chat-bubble-left, magnifying-glass, bars-3, x-mark, chevron-down, chevron-right, plus, minus, trash, pencil, document-text, photo, play, pause, wifi
  mdi: leaf, recycle, earth, flower, water-drop, solar-power, bicycle, cat, dog, chef-hat, wine, beer, pizza, music-note, guitar, palette, brush, camera, diamond, crown, rocket, lightning-bolt, account-group, handshake, heart-pulse, dumbbell, run, swim
  tabler: coffee, tea, salad, meat, fish, bread, apple, lemon, plant, tree, sun, moon, star, flame, snowflake, umbrella, car, bus, plane, ship, bike, motorcycle, building, home, store, school, hospital, church, park, beach, mountain
  carbon: checkmark, warning, information, error, add, subtract, close, search, filter, settings, favorite, bookmark, share, download, upload, send, mail, phone, location, calendar, time, chart-bar, chart-line, growth
Use color="currentColor" to inherit CSS text color, or a var like "var(--theme-shop-button)" for accent icons.`.trim();

// ---------------------------------------------------------------------------
// Hero / image-overlay rules — critical for text legibility
// ---------------------------------------------------------------------------

const HERO_RULES = `
HERO & IMAGE SECTIONS — follow these rules for text over images:
1. ALWAYS wrap the hero in a relative Box: {"type":"Box","props":{"className":"relative w-full overflow-hidden","style":{"minHeight":"520px"}}}
2. Place the Image as the FIRST child with absolute positioning + object-cover:
   {"type":"Image","src":"...","props":{"fill":true,"className":"absolute inset-0 w-full h-full object-cover","style":{"objectFit":"cover"},"alt":"hero"}}
3. ALWAYS add a gradient overlay div after the image:
   {"type":"Box","props":{"className":"absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70"}}
4. Place text content LAST in a relative Box with z-10:
   {"type":"Box","props":{"className":"relative z-10 flex flex-col items-center justify-center text-center px-6 py-24"}}
5. All text ON the image must be text-white or text-white/90. Add drop-shadow-lg to headings.
6. Buttons on dark heroes: use the CTA button theme vars. Outline buttons: border-white/70 text-white.
NEVER place text directly on an image without the gradient overlay.`.trim();

// ---------------------------------------------------------------------------
// Animation patterns per level
// ---------------------------------------------------------------------------

function buildAnimationSection(level: number): string {
  if (level === 0) return '';

  const base = `\nANIMATIONS — add "animation" inside "props" on key nodes:`;

  if (level === 1) {
    return base + `
Level 1 (subtle): fadeIn enter on section wrappers only
  "props":{"animation":{"enter":{"type":"fadeIn","duration":500}}}`;
  }

  if (level === 2) {
    return base + `
Level 2 (medium): heroes/headings get slideInUp+spring, cards get fadeIn, buttons get press+hover
  Hero heading: "props":{"animation":{"enter":{"type":"slideInUp","spring":true,"stiffness":400,"damping":12}}}
  Cards:        "props":{"animation":{"enter":{"type":"fadeIn","duration":300},"hover":{"scale":1.02,"duration":150}}}
  CTA buttons:  "props":{"animation":{"press":{"scale":0.96,"duration":80},"hover":{"scale":1.03,"duration":120}}}
  Section wrap: "props":{"animation":{"enter":{"type":"fadeIn","duration":400}}}`;
  }

  return base + `
Level 3 (rich): full animations including loops on accent elements
  Hero heading: "props":{"animation":{"enter":{"type":"slideInUp","spring":true,"stiffness":400,"damping":12}}}
  Feature icons:"props":{"animation":{"enter":{"type":"fadeIn","duration":300},"hover":{"scale":1.1,"y":-4,"duration":200}}}
  CTA buttons:  "props":{"animation":{"press":{"scale":0.96,"duration":80},"hover":{"scale":1.05,"duration":150}}}
  Section wrap: "props":{"animation":{"enter":{"type":"fadeIn","duration":500}}}`;
}

// ---------------------------------------------------------------------------
// Design taste rules — injected into every prompt
// ---------------------------------------------------------------------------

const DESIGN_RULES = `
DESIGN QUALITY RULES (must follow):
1. Spacing: use py-16 md:py-24 on section wrappers, gap-6 md:gap-8 between grid items
2. Max-width: wrap content in max-w-7xl mx-auto px-6 or px-8 inside sections
3. Typography: headings use text-3xl md:text-5xl font-bold tracking-tight; body text use text-lg text-[var(--theme-muted-foreground)]
4. Cards: add rounded-2xl shadow-sm border border-[var(--theme-border)] overflow-hidden to cards; use bg-[var(--theme-card)]
5. Buttons (solid): inline-flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-sm
6. Buttons (outline): inline-flex items-center gap-2 px-6 py-3 rounded-full border-2 font-semibold text-sm
7. Section backgrounds: alternate between bg-[var(--theme-content-bg)] and bg-[var(--theme-muted)] for visual rhythm
8. Grid layouts: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8
9. Icon containers: wrap icons in a p-3 rounded-xl bg-[var(--theme-muted)] for card icons
10. Images: always use realistic Unsplash URLs: https://images.unsplash.com/photo-[ID]?w=800&q=80
    Use appropriate images for the business type. Add rounded-xl to image containers.`.trim();

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildSectionPrompt(input: SectionPromptInput): BuiltPrompts {
  const { section, animationLevel, mood, appName, businessDescription, category, pageRoutes } = input;
  const components = section.designHints?.components ?? [];
  const sectionName = section.name.toLowerCase();

  // Detect if this is a hero/image-heavy section
  const isHeroSection = sectionName.includes('hero') || sectionName.includes('banner') || sectionName.includes('welcome') || sectionName.includes('header');
  const isNavSection = sectionName.includes('navigation') || sectionName.includes('navbar') || sectionName.includes('nav');
  const isFooterSection = sectionName.includes('footer');

  // Compact component type hint — list valid type names, no JSON blobs
  const allTypes = [...new Set(['Box', 'Text', 'Heading', ...components])];
  const componentBlock = `\nUSE THESE COMPONENT TYPES: ${allTypes.join(', ')} (plus any other layout primitives as needed)`;

  // Validate component labels exist in the schema (for add_component tool calls)
  void COMPONENT_SCHEMA;

  const animationBlock = buildAnimationSection(animationLevel);

  const routeBlock = pageRoutes.length > 0
    ? `\nPAGE ROUTES (use for Link href/navigation):\n${pageRoutes.map(r => `  ${r.name}: "${r.route}"`).join('\n')}`
    : '';

  const heroBlock = isHeroSection ? `\n${HERO_RULES}` : '';

  // Nav-specific reminder for sticky positioning
  const navExtra = isNavSection ? `\nNAV EXTRA: Make navbar sticky/fixed (sticky top-0 z-50). Logo left, links center/right, CTA button far right. Use bg-[var(--theme-header-bg)]/95 backdrop-blur for glass effect.` : '';

  // Footer extra
  const footerExtra = isFooterSection ? `\nFOOTER EXTRA: Full-width footer with bg-[var(--theme-footer-bg)]. Use a 4-column grid: brand/tagline col + 2-3 link group cols + contact col. Divider line then copyright row.` : '';

  // ---------------------------------------------------------------------------
  // System prompt
  // ---------------------------------------------------------------------------
  const system = `You are an expert UI developer generating SDUI (Server-Driven UI) JSON node trees.

OUTPUT RULES:
- Output ONLY a raw JSON array: [...nodes] — no markdown, no code fences, no wrapper object
- The FIRST (outermost) node MUST include a "name" field matching the section name exactly: "name":"${section.name}"
- Every node must have "type" and "props" with "className"
- Use Tailwind CSS classes for all styling
- Text nodes use "text" field (string) — NOT children for text content
- Images: type "Image" with "src" (Unsplash URL), "props.alt", "props.className", and style: {width, height, objectFit} in "props.style"
- Icons: type "Icon" with "props.icon" (e.g. "heroicons:star"), "props.size", "props.color"
- Generate REAL, brand-relevant copy — never generic placeholder text
- All sections: full-width (w-full) outer wrapper, then max-w-7xl mx-auto px-6 inner content
${THEME_VARS}
${DESIGN_RULES}
${ICON_GUIDE}
${heroBlock}
${navExtra}
${footerExtra}
${componentBlock}
${animationBlock}
${routeBlock}`.trim();

  // ---------------------------------------------------------------------------
  // User prompt
  // ---------------------------------------------------------------------------
  const user = `Generate the SDUI JSON node tree for this section of "${appName}":

Business: ${businessDescription}
Category: ${category} | Mood: ${mood}

Section: "${section.name}"
Description: ${section.description ?? 'No description provided'}
Layout: ${section.designHints?.layout ?? 'flexible'}
Tone: ${section.designHints?.tone ?? mood}
Components to use: ${components.join(', ')}

Output a JSON array of top-level SDUI nodes. Use realistic copy for a ${category} business. Use var(--theme-*) for all colors. Use Icon for all icons.`;

  return { system, user };
}
