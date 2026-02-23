/**
 * Playwright runner for full-page layout visual tests.
 * Uses the same ?navbarPreview=base64 mechanism as visual-navbar-runner,
 * since NavbarPreviewFromUrl already handles { screen, style, theme } objects.
 *
 * Checks that the full homepage renders with hero, navbar, and sections visible.
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export type ScreenVisualAssert = {
  /** Check that navbar root is visible */
  navbarVisible?: boolean;
  /** Check that a hero heading or hero section is visible */
  heroVisible?: boolean;
  /** Check that a product grid / carousel section is visible */
  productSectionVisible?: boolean;
  /** Convenience: run all standard page checks */
  check?: 'pageVisible';
  /** Save a full-page screenshot to screenshotsDir */
  screenshot?: boolean;
  /** Verify SVG icon elements have non-zero bounding boxes */
  checkIcons?: boolean;
  /** Verify CSS theme vars resolve to real (non-transparent) colors */
  checkColors?: boolean;
  /** Verify text/bg contrast ratios (WCAG AA) */
  checkContrast?: boolean;
  /** Verify page is usable at 375px mobile viewport */
  checkResponsive?: boolean;
  /** Verify cart drawer and theme menu open on click */
  checkInteractivity?: boolean;
  /** Send screenshot to GPT-4V for AI design quality review */
  aiReview?: boolean;
};

export type ScreenVisualTestInput = {
  screen: Record<string, unknown>;
  style?: string | null;
  theme?: Record<string, unknown>;
  visualAssert: ScreenVisualAssert;
  label?: string;
  /** Directory to save screenshots (required when visualAssert.screenshot=true) */
  screenshotsDir?: string;
  /** Original prompt, passed to GPT-4V review */
  prompt?: string;
};

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001';

function encodePreview(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Run a visual test for a full AI-generated page.
 * Navigates to /?navbarPreview=<base64> which sets the generated screen in the store.
 *
 * For basic checks (navbarVisible, heroVisible, productSectionVisible, check:'pageVisible'),
 * runs them inline. For extended checks (checkIcons, checkColors, checkContrast,
 * checkResponsive, checkInteractivity, aiReview), delegates to visual-design-checker.ts.
 * Always takes a screenshot when visualAssert.screenshot=true and screenshotsDir is provided.
 *
 * Returns { pass, error, screenshotPath? }.
 */
export async function runVisualScreenTest(
  input: ScreenVisualTestInput
): Promise<{ pass: boolean; error?: string; screenshotPath?: string }> {
  const { screen, style, theme, visualAssert, label = 'screen', screenshotsDir, prompt } = input;

  // If any extended checks are requested, delegate to the full design checker
  const hasExtendedChecks =
    visualAssert.checkIcons ||
    visualAssert.checkColors ||
    visualAssert.checkContrast ||
    visualAssert.checkResponsive ||
    visualAssert.checkInteractivity ||
    visualAssert.aiReview;

  if (hasExtendedChecks || visualAssert.screenshot) {
    const { runVisualDesignCheck } = await import('./visual-design-checker');
    const result = await runVisualDesignCheck({
      screen,
      style,
      theme,
      visualAssert,
      label,
      screenshotsDir,
      prompt,
    });

    if (!result.pass) {
      const allErrors = [...result.errors];
      return { pass: false, error: allErrors.join('; '), screenshotPath: result.screenshotPath };
    }
    return { pass: true, screenshotPath: result.screenshotPath };
  }

  // Basic checks only (original behavior)
  const payload = { screen, style, theme };
  const encoded = encodePreview(payload);
  const url = `${BASE_URL}/?navbarPreview=${encoded}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  let screenshotPath: string | undefined;

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    // Give React time to hydrate and render the generated screen
    await page.waitForTimeout(3000);

    const doAll = visualAssert.check === 'pageVisible';

    // Navbar check
    if (doAll || visualAssert.navbarVisible) {
      const navbar = page.locator('#navbar-root');
      await navbar.waitFor({ state: 'visible', timeout: 10000 });
    }

    // Hero check — look for any heading in the main content area
    if (doAll || visualAssert.heroVisible) {
      const hero = page.locator('main h1, main h2, [data-hero], .hero-heading').first();
      await hero.waitFor({ state: 'visible', timeout: 10000 });
    }

    // Product section check — look for a product card or empty state
    if (doAll || visualAssert.productSectionVisible) {
      const productSection = page
        .locator('[data-testid="product-card"], .product-card, [class*="grid"] > *')
        .first();
      // Non-fatal: products may not be available without a backend
      const visible = await productSection.isVisible().catch(() => false);
      if (!visible) {
        console.warn('[visual-screen-runner] Product section not visible (no backend products — expected)');
      }
    }

    // Screenshot (basic — no extended checks)
    if (visualAssert.screenshot && screenshotsDir) {
      if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `${label}-${ts}.png`;
      screenshotPath = join(screenshotsDir, filename);
      await page.screenshot({ fullPage: true, path: screenshotPath });
      console.log(`  Screenshot saved: ${screenshotPath}`);
    }

    await browser.close();
    return { pass: true, screenshotPath };
  } catch (e) {
    await browser.close();
    const err = e instanceof Error ? e.message : String(e);
    return { pass: false, error: err, screenshotPath };
  }
}
