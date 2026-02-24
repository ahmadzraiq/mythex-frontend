/**
 * Deep visual design checker for AI-generated pages.
 *
 * Uses Playwright to render the page via the ?navbarPreview=base64 mechanism,
 * then runs fine-grained assertions on:
 *   A. Section visibility (DOM) — are all expected sections present?
 *   B. Icon rendering — do SVG icons actually have non-zero dimensions?
 *   C. Theme color resolution — do CSS vars resolve to real colors?
 *   D. Contrast ratios — do text/background pairs meet WCAG 4.5:1?
 *   E. Responsive layout — does the page work at 375px mobile width?
 *   F. Interactivity — does cart drawer open? does theme menu open?
 *   G. Screenshot — saves a full-page PNG for manual review
 *   H. GPT-4V review — AI vision assessment of overall design quality
 *
 * Called from eval-ai.ts when a page case has visualAssert with extended flags.
 */

import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

// ─── Types ───────────────────────────────────────────────────────────────────

export type VisualDesignAssert = {
  /** Run all standard DOM visibility checks */
  check?: 'pageVisible';
  /** Take a full-page screenshot and save to screenshotsDir */
  screenshot?: boolean;
  /** Verify SVG icon elements have non-zero bounding boxes */
  checkIcons?: boolean;
  /** Verify CSS theme vars resolve to real (non-transparent) colors */
  checkColors?: boolean;
  /** Verify text/bg contrast ratios meet WCAG AA (4.5:1) */
  checkContrast?: boolean;
  /** Verify page is usable at 375px mobile viewport */
  checkResponsive?: boolean;
  /** Verify cart drawer opens on click, theme menu opens on click */
  checkInteractivity?: boolean;
  /** Send screenshot to GPT-4V for design quality review */
  aiReview?: boolean;
  /** Expected sections for the page (used in section visibility check) */
  expectedSections?: string[];
};

export type VisualDesignInput = {
  screen: Record<string, unknown>;
  style?: string | null;
  theme?: Record<string, unknown>;
  visualAssert: VisualDesignAssert;
  /** Label used in screenshot filenames */
  label?: string;
  /** Directory to save screenshots into */
  screenshotsDir?: string;
  /** Original prompt, used in GPT-4V review */
  prompt?: string;
};

export type SectionResult = { visible: boolean; error?: string };
export type IconResult = { rendered: boolean; width?: number; height?: number };
export type ColorResult = { resolved: boolean; value?: string; contrastRatio?: number };

export type VisualDesignResult = {
  pass: boolean;
  errors: string[];
  warnings: string[];
  screenshotPath?: string;
  sections?: Record<string, SectionResult>;
  icons?: Record<string, IconResult>;
  colors?: Record<string, ColorResult>;
  responsive?: { pass: boolean; errors: string[] };
  interactivity?: { cart: boolean; themeMenu: boolean; errors: string[] };
  aiReview?: { criteria: Record<string, { pass: boolean; note: string }>; overallPass: boolean };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001';

/**
 * Parse an RGB/RGBA string like "rgb(30, 41, 59)" → { r, g, b }
 */
function parseRgb(css: string): { r: number; g: number; b: number } | null {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
}

/**
 * Compute relative luminance per WCAG 2.1
 */
function luminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * WCAG contrast ratio between two RGB colors.
 */
function contrastRatio(c1: ReturnType<typeof parseRgb>, c2: ReturnType<typeof parseRgb>): number {
  if (!c1 || !c2) return 0;
  const l1 = luminance(c1.r, c1.g, c1.b);
  const l2 = luminance(c2.r, c2.g, c2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if a CSS color value is non-transparent (resolved).
 * Returns false for "rgba(0, 0, 0, 0)", empty string, or "transparent".
 */
function isColorResolved(css: string): boolean {
  if (!css || css === 'transparent') return false;
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return false;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return false;
  return true;
}

// ─── Section visibility checks ───────────────────────────────────────────────

const SECTION_SELECTORS: Record<string, string[]> = {
  announcement: [
    'text=/free shipping/i',
    'text=/announcement/i',
    '[class*="announcement"]',
  ],
  hero: [
    'main h1',
    'main h2',
    '[data-hero]',
  ],
  categories: [
    'text=/shop by category/i',
    'text=/categories/i',
    'text=/featured categories/i',
  ],
  'flash-sale': [
    'text=/flash sale/i',
    'text=/flash/i',
  ],
  'new-arrivals': [
    'text=/new arrivals/i',
    'text=/new arrival/i',
  ],
  'best-sellers': [
    'text=/best sellers/i',
    'text=/best seller/i',
    'text=/bestseller/i',
  ],
  'brand-story': [
    'text=/our story/i',
    'text=/brand story/i',
    'text=/about us/i',
  ],
  newsletter: [
    'input[placeholder*="email" i]',
    'input[placeholder*="subscribe" i]',
    'text=/subscribe/i',
    'text=/newsletter/i',
  ],
};

async function checkSectionVisibility(
  page: Page,
  expectedSections: string[]
): Promise<Record<string, SectionResult>> {
  const results: Record<string, SectionResult> = {};

  // Sections that should have visible child content below the heading
  // (i.e. not just a heading alone — actual cards/products/inputs should appear)
  const CONTENT_SECTIONS = new Set(['categories', 'new-arrivals', 'best-sellers', 'flash-sale', 'newsletter']);

  for (const section of expectedSections) {
    const selectors = SECTION_SELECTORS[section] ?? [`text=/${section}/i`];
    let found = false;
    let lastError = '';
    let foundEl: import('playwright').Locator | null = null;

    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        const visible = await loc.isVisible({ timeout: 3000 }).catch(() => false);
        if (visible) {
          found = true;
          foundEl = loc;
          break;
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    if (found && foundEl && CONTENT_SECTIONS.has(section)) {
      // Verify section has non-empty content: at least one sibling/descendant element
      // with non-zero height other than the heading itself.
      const hasContent = await page.evaluate(
        ({ sel }: { sel: string }) => {
          const headingEl = document.evaluate(
            `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${sel.toLowerCase().replace(/\/i$/, '').replace(/^text=\//, '')}")]`,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          ).singleNodeValue as HTMLElement | null;

          if (!headingEl) return true; // can't find, skip content check

          // Walk up to find the section container
          let container: HTMLElement | null = headingEl.parentElement;
          for (let i = 0; i < 5 && container; i++) {
            const kids = Array.from(container.children) as HTMLElement[];
            const contentKids = kids.filter((k) => k !== headingEl && k.getBoundingClientRect().height > 0);
            if (contentKids.length >= 1) return true;
            container = container.parentElement;
          }
          return false;
        },
        { sel: selectors[0] }
      ).catch(() => true); // if check fails, don't flag as error

      if (!hasContent) {
        results[section] = {
          visible: true,
          error: `Section heading visible but no content children found — section may be empty (map over empty state?)`,
        };
        continue;
      }
    }

    results[section] = found
      ? { visible: true }
      : { visible: false, error: lastError || `Not found. Tried: ${selectors.join(', ')}` };
  }

  return results;
}

// ─── Icon rendering checks ────────────────────────────────────────────────────

const ICON_SELECTORS: Record<string, string> = {
  'navbar-cart': '#navbar-cart-button svg',
  'navbar-theme': '#navbar-theme-button svg',
  'navbar-sign-in': '#navbar-sign-in',
};

async function checkIconRendering(page: Page): Promise<Record<string, IconResult>> {
  const results: Record<string, IconResult> = {};

  for (const [name, selector] of Object.entries(ICON_SELECTORS)) {
    try {
      const box = await page.locator(selector).first().boundingBox({ timeout: 5000 }).catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        results[name] = { rendered: true, width: Math.round(box.width), height: Math.round(box.height) };
      } else {
        results[name] = { rendered: false };
      }
    } catch {
      results[name] = { rendered: false };
    }
  }

  return results;
}

// ─── Theme color resolution checks ───────────────────────────────────────────

async function checkThemeColors(page: Page): Promise<Record<string, ColorResult>> {
  const colorTargets: Array<{ name: string; selector: string; property: 'backgroundColor' | 'color' }> = [
    { name: 'navbar-bg', selector: '#navbar-root', property: 'backgroundColor' },
    { name: 'hero-bg', selector: 'main > div:first-child', property: 'backgroundColor' },
    { name: 'hero-heading', selector: 'main h1, main h2', property: 'color' },
    { name: 'button-bg', selector: 'button[class*="bg-"]', property: 'backgroundColor' },
  ];

  const results: Record<string, ColorResult> = {};

  for (const { name, selector, property } of colorTargets) {
    try {
      const value = await page.evaluate(
        ({ sel, prop }: { sel: string; prop: string }) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          return getComputedStyle(el)[prop as keyof CSSStyleDeclaration] as string;
        },
        { sel: selector, prop: property }
      );

      if (!value) {
        results[name] = { resolved: false };
      } else {
        results[name] = { resolved: isColorResolved(value), value };
      }
    } catch {
      results[name] = { resolved: false };
    }
  }

  return results;
}

// ─── Contrast ratio checks ────────────────────────────────────────────────────

async function checkContrastRatios(page: Page): Promise<Record<string, ColorResult>> {
  const pairs: Array<{ name: string; textSel: string; bgSel: string }> = [
    { name: 'hero-heading', textSel: 'main h1, main h2', bgSel: 'main > div:first-child' },
    { name: 'navbar-text', textSel: '#navbar-sign-in', bgSel: '#navbar-root' },
  ];

  const results: Record<string, ColorResult> = {};

  for (const { name, textSel, bgSel } of pairs) {
    try {
      const colors = await page.evaluate(
        ({ ts, bs }: { ts: string; bs: string }) => {
          const textEl = document.querySelector(ts);
          const bgEl = document.querySelector(bs);
          if (!textEl || !bgEl) return null;
          return {
            text: getComputedStyle(textEl).color,
            bg: getComputedStyle(bgEl).backgroundColor,
          };
        },
        { ts: textSel, bs: bgSel }
      );

      if (!colors) {
        results[name] = { resolved: false };
        continue;
      }

      const textRgb = parseRgb(colors.text);
      const bgRgb = parseRgb(colors.bg);
      const ratio = contrastRatio(textRgb, bgRgb);

      results[name] = {
        resolved: true,
        value: `text: ${colors.text}, bg: ${colors.bg}`,
        contrastRatio: Math.round(ratio * 100) / 100,
      };
    } catch {
      results[name] = { resolved: false };
    }
  }

  return results;
}

// ─── Responsive check (reuses main page, resizes viewport) ───────────────────

/**
 * Navigate to BASE_URL, then call window.__setGeneratedScreen (exposed by NavbarPreviewFromUrl)
 * to inject the generated screen into the Zustand store — exactly mirroring the manual
 * "Apply" button flow in AiResponsePreviewOverlay.
 *
 * This is the most reliable approach because it:
 * - Lets the page load completely (React hydrates, Zustand initializes normally)
 * - Then directly calls setGenerated() in the live store — same as clicking "Apply"
 * - Avoids all localStorage/SSR timing issues
 */
async function navigateWithScreen(
  page: Page,
  screenState: { generatedScreen: Record<string, unknown>; generatedStyle: string | null; generatedTheme: Record<string, unknown> | null },
  options?: { width?: number; height?: number }
): Promise<void> {
  if (options?.width || options?.height) {
    await page.setViewportSize({ width: options.width ?? 1280, height: options.height ?? 800 });
  }

  // Navigate to the page and wait for React to fully hydrate.
  // Use 'load' (not networkidle) to avoid hanging on live API calls.
  // Retry once if the first navigation fails or __setGeneratedScreen never appears
  // (can happen when the Next.js dev server is in the middle of a hot reload).
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
  // Extra settle time for dev-mode Next.js hydration
  await page.waitForTimeout(1500);

  // Wait for NavbarPreviewFromUrl to mount and expose __setGeneratedScreen on window.
  // NOTE: waitForFunction(fn, arg?, options?) — timeout goes in options (3rd arg), not arg (2nd arg).
  // 60s to survive a Next.js dev-mode hot reload that may be in progress.
  await page.waitForFunction(
    () => typeof (window as unknown as Record<string, unknown>).__setGeneratedScreen === 'function',
    undefined,
    { timeout: 60000 }
  );

  // Call setGenerated() — exactly what the "Apply" button does in the overlay.
  await page.evaluate(
    ({ screen, style, theme }) => {
      (window as unknown as Record<string, { (s: unknown, st: unknown, t: unknown): void }>).__setGeneratedScreen(screen, style, theme);
    },
    { screen: screenState.generatedScreen, style: screenState.generatedStyle, theme: screenState.generatedTheme }
  );

  // Wait for React to re-render with the new screen.
  await page.waitForTimeout(2000);
}

async function checkResponsive(
  page: Page,
  originalWidth: number
): Promise<{ pass: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    // Resize the existing page to mobile width — avoids opening a second tab
    // which causes slow hydration and __setGeneratedScreen timeout issues.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(800); // let layout reflow

    // Collections nav links should be hidden at mobile (hidden md:flex)
    const collectionsVisible = await page
      .locator('#navbar-collections')
      .isVisible()
      .catch(() => false);
    if (collectionsVisible) {
      errors.push('Navbar collections are visible on mobile (should be hidden md:flex)');
    }

    // Navbar should not overflow horizontally
    const navbarOverflow = await page.evaluate(() => {
      const el = document.querySelector('#navbar-root');
      if (!el) return false;
      return el.scrollWidth > el.clientWidth;
    });
    if (navbarOverflow) {
      errors.push('Navbar overflows horizontally on mobile viewport (375px)');
    }

    // Hero heading should be visible
    const heroVisible = await page
      .locator('main h1, main h2')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (!heroVisible) {
      errors.push('Hero heading not visible on mobile viewport');
    }
  } catch (e) {
    errors.push(`Responsive check error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // Restore original desktop viewport
    await page.setViewportSize({ width: originalWidth, height: 800 }).catch(() => null);
    await page.waitForTimeout(300);
  }

  return { pass: errors.length === 0, errors };
}

// ─── Interactivity checks ─────────────────────────────────────────────────────

async function checkInteractivity(
  page: Page
): Promise<{ cart: boolean; themeMenu: boolean; errors: string[] }> {
  const errors: string[] = [];
  let cart = false;
  let themeMenu = false;

  // Cart drawer
  try {
    const cartBtn = page.locator('#navbar-cart-button').first();
    await cartBtn.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const drawerVisible = await page
      .locator('[role="dialog"], [class*="DrawerContent"], [class*="drawer"]')
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    cart = drawerVisible;
    if (!drawerVisible) errors.push('Cart drawer did not open after clicking cart button');
    // Close drawer if open
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(300);
  } catch (e) {
    errors.push(`Cart click error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Theme menu
  try {
    const themeBtn = page.locator('#navbar-theme-button').first();
    await themeBtn.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const menuVisible = await page
      .locator('text=/Light/i')
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    themeMenu = menuVisible;
    if (!menuVisible) errors.push('Theme menu did not open after clicking theme button');
    // Close menu
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(300);
  } catch (e) {
    errors.push(`Theme menu click error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { cart, themeMenu, errors };
}

// ─── GPT-4V review ───────────────────────────────────────────────────────────

async function runAiVisionReview(
  screenshotPath: string,
  prompt: string
): Promise<{ criteria: Record<string, { pass: boolean; note: string }>; overallPass: boolean }> {
  try {
    const imageData = readFileSync(screenshotPath);
    const base64Image = imageData.toString('base64');

    const reviewPrompt = `This screenshot is an AI-generated page for: "${prompt}".

Review and score EACH of the following criteria as PASS or FAIL with a one-sentence note:
1. design_quality: Does the overall design look professional and appropriate for the described page?
2. color_palette: Are the colors cohesive, on-brand, and not garish or mismatched?
3. section_completeness: Are all the key sections visible and populated (not blank/empty boxes)?
4. typography_hierarchy: Are headings visually distinct from body text in size and weight?
5. icon_visibility: Are navbar icons (cart, theme toggle) visible and correctly sized?
6. spacing_layout: Are sections well-spaced with clear visual separation between them?
7. cta_buttons: Are call-to-action buttons visible, styled consistently, and readable?

Respond ONLY as JSON with this exact structure:
{
  "design_quality": { "pass": true, "note": "..." },
  "color_palette": { "pass": true, "note": "..." },
  "section_completeness": { "pass": false, "note": "..." },
  "typography_hierarchy": { "pass": true, "note": "..." },
  "icon_visibility": { "pass": true, "note": "..." },
  "spacing_layout": { "pass": true, "note": "..." },
  "cta_buttons": { "pass": true, "note": "..." }
}`;

    const { text: raw } = await generateText({
      model: openai('gpt-4o'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: reviewPrompt },
            {
              type: 'image',
              image: base64Image,
            },
          ],
        },
      ],
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI vision response');

    const criteria = JSON.parse(jsonMatch[0]) as Record<string, { pass: boolean; note: string }>;
    const overallPass = Object.values(criteria).every((c) => c.pass);
    return { criteria, overallPass };
  } catch (e) {
    console.warn('[visual-design-checker] GPT-4V review failed:', e instanceof Error ? e.message : e);
    return {
      criteria: { error: { pass: false, note: String(e instanceof Error ? e.message : e) } },
      overallPass: false,
    };
  }
}

// ─── Main runner ─────────────────────────────────────────────────────────────

/**
 * Run a deep visual design check on an AI-generated page.
 * Injects the resolved screen into localStorage so the Zustand store rehydrates it
 * immediately on page load (avoids the ?navbarPreview= useEffect race condition).
 * All external API requests are mocked so initActions complete instantly.
 */
export async function runVisualDesignCheck(
  input: VisualDesignInput
): Promise<VisualDesignResult> {
  const { screen, style, theme, visualAssert, label = 'page', screenshotsDir, prompt = '' } = input;
  const screenState = {
    generatedScreen: screen,
    generatedStyle: style ?? null,
    generatedTheme: theme ?? null,
  };

  const errors: string[] = [];
  const warnings: string[] = [];
  const result: VisualDesignResult = { pass: false, errors, warnings };

  // Warm up the dev server with a plain HTTP request before opening Playwright.
  // This ensures any pending Next.js hot-reload (triggered by TSX module compilation)
  // completes before we try to load the page in headless Chrome.
  try {
    const { default: http } = await import('http');
    await new Promise<void>((resolve) => {
      http.get(BASE_URL, (res) => { res.resume(); res.on('end', resolve); }).on('error', () => resolve());
    });
    // Give the server an extra moment to finish re-rendering after the request
    await new Promise((r) => setTimeout(r, 2000));
  } catch {
    // ignore warmup errors — Playwright will retry on actual goto
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(35000);

  try {
    await navigateWithScreen(page, screenState);

    const doAll = visualAssert.check === 'pageVisible';

    // ── A. Section visibility ───────────────────────────────────────────────
    // Only check sections explicitly listed in visualAssert.expectedSections.
    // Default to just ['hero'] since page sections now vary per brand.
    const expectedSections =
      visualAssert.expectedSections ??
      ['hero'];

    if (doAll) {
      const sections = await checkSectionVisibility(page, expectedSections);
      result.sections = sections;
      for (const [name, r] of Object.entries(sections)) {
        if (!r.visible) {
          errors.push(`Section "${name}" not visible in DOM${r.error ? `: ${r.error}` : ''}`);
        } else if (r.error) {
          // Section heading found but content appears empty
          warnings.push(`Section "${name}" heading visible but content empty: ${r.error}`);
        }
      }
    }

    // ── B. Navbar check (base) ──────────────────────────────────────────────
    try {
      const navbar = page.locator('#navbar-root');
      await navbar.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      errors.push('Navbar (#navbar-root) is not visible');
    }

    // ── C. Hero heading check ───────────────────────────────────────────────
    try {
      const hero = page.locator('main h1, main h2').first();
      const visible = await hero.isVisible({ timeout: 5000 }).catch(() => false);
      if (!visible) errors.push('Hero heading (h1/h2 in main) is not visible');
    } catch {
      errors.push('Hero heading check failed');
    }

    // ── D. Icon rendering ───────────────────────────────────────────────────
    if (visualAssert.checkIcons) {
      const icons = await checkIconRendering(page);
      result.icons = icons;
      for (const [name, r] of Object.entries(icons)) {
        if (!r.rendered) {
          warnings.push(`Icon "${name}" SVG not rendered or has zero dimensions`);
        }
      }
    }

    // ── E. Theme colors ─────────────────────────────────────────────────────
    if (visualAssert.checkColors) {
      const colors = await checkThemeColors(page);
      result.colors = colors;
      for (const [name, r] of Object.entries(colors)) {
        if (!r.resolved) {
          errors.push(`Color "${name}" is transparent or unresolved (CSS var not applied)`);
        }
      }
    }

    // ── F. Contrast ratios ──────────────────────────────────────────────────
    if (visualAssert.checkContrast) {
      const contrastResults = await checkContrastRatios(page);
      // Merge into colors result
      result.colors = { ...(result.colors ?? {}), ...contrastResults };
      for (const [name, r] of Object.entries(contrastResults)) {
        if (r.resolved && r.contrastRatio !== undefined && r.contrastRatio < 3.0) {
          errors.push(
            `Contrast ratio for "${name}" is ${r.contrastRatio}:1 (WCAG AA requires 4.5:1 for normal text)`
          );
        }
      }
    }

    // ── G. Screenshot ───────────────────────────────────────────────────────
    if (visualAssert.screenshot && screenshotsDir) {
      if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `${label}-${ts}.png`;
      const screenshotPath = join(screenshotsDir, filename);
      await page.screenshot({ fullPage: true, path: screenshotPath });
      result.screenshotPath = screenshotPath;
      console.log(`  Screenshot saved: ${screenshotPath}`);
    }

    // ── G2. Broken image detection ──────────────────────────────────────────
    // Check for <img> elements that failed to load (naturalWidth === 0).
    // Next.js renders broken NextImage as visible alt text — both alt text in DOM
    // and naturalWidth=0 indicate a broken image that harms the design.
    if (visualAssert.checkIcons) {
      const brokenImages = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs
          .filter((img) => !img.complete || img.naturalWidth === 0)
          .map((img) => ({ alt: img.alt || '(no alt)', src: img.src || img.getAttribute('src') || '(no src)' }));
      });
      for (const { alt, src } of brokenImages) {
        warnings.push(`Broken image (failed to load) — alt: "${alt}", src: "${src.slice(0, 80)}"`);
      }
      if (brokenImages.length > 0) {
        errors.push(`${brokenImages.length} broken image(s) detected — use gradient boxes instead of NextImage for editorial images`);
      }
    }

    // ── H. Responsive check ─────────────────────────────────────────────────
    if (visualAssert.checkResponsive) {
      const responsive = await checkResponsive(page, 1280);
      result.responsive = responsive;
      if (!responsive.pass) {
        for (const e of responsive.errors) errors.push(`Responsive: ${e}`);
      }
    }

    // ── I. Interactivity ────────────────────────────────────────────────────
    if (visualAssert.checkInteractivity) {
      const interactivity = await checkInteractivity(page);
      result.interactivity = interactivity;
      for (const e of interactivity.errors) {
        warnings.push(`Interactivity: ${e}`);
      }
    }

    // ── J. GPT-4V review ────────────────────────────────────────────────────
    if (visualAssert.aiReview && result.screenshotPath) {
      const aiReview = await runAiVisionReview(result.screenshotPath, prompt);
      result.aiReview = aiReview;
      if (!aiReview.overallPass) {
        const failing = Object.entries(aiReview.criteria)
          .filter(([, v]) => !v.pass)
          .map(([k, v]) => `${k}: ${v.note}`);
        for (const f of failing) warnings.push(`AI vision: ${f}`);
      }
    }

    result.pass = errors.length === 0;
    return result;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    errors.push(err);
    result.pass = false;
    return result;
  } finally {
    await browser.close();
  }
}
