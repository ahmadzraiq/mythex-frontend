/**
 * e2e/exported-fonts.spec.ts
 *
 * Verifies that the exported Next.js app loads the correct project font
 * (Space Grotesk, from theme.json) and applies it consistently.
 *
 * Run against the exported app at http://localhost:3004:
 *   EXPORTED_PORT=3004 npx playwright test e2e/exported-fonts.spec.ts --headed
 */

import { test, expect } from '@playwright/test';

const BASE = `http://localhost:${process.env.EXPORTED_PORT ?? '3004'}`;

test.describe('Exported app — font loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/sc-component-showcase`, {
      waitUntil: 'networkidle',
      timeout: 90_000,
    });
  });

  test('<body> has a next/font CSS-variable class injected', async ({ page }) => {
    // next/font applies a hashed class like __variable_xxxxxx on <body>
    // this is how the font CSS variable (--font-space-grotesk) is scoped
    const bodyClass = await page.evaluate(() => document.body.className);
    expect(bodyClass).toMatch(/__variable_[a-f0-9]+/);
  });

  test('--font-body CSS variable is defined on body and non-empty', async ({ page }) => {
    // --font-body is declared on `body` (not :root) so next/font's --font-space-grotesk
    // is in scope when the var() reference is resolved.
    const fontBodyVar = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue('--font-body').trim()
    );
    expect(fontBodyVar.length).toBeGreaterThan(0);
  });

  test('--font-space-grotesk CSS variable is defined on body (set by next/font)', async ({ page }) => {
    const fontVar = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue('--font-space-grotesk').trim()
    );
    // next/font sets this to the actual font-family string
    expect(fontVar.length).toBeGreaterThan(0);
  });

  test('computed font-family on body contains Space Grotesk', async ({ page }) => {
    const fontFamily = await page.evaluate(() =>
      getComputedStyle(document.body).fontFamily
    );
    // The resolved font-family should include the Space Grotesk font name
    expect(fontFamily.toLowerCase()).toContain('space grotesk');
  });

  test('computed font-family on a text element matches body (inherits correctly)', async ({ page }) => {
    // Check that a rendered span/p inherits the correct font, not browser default
    const [bodyFont, elemFont] = await page.evaluate(() => {
      const body = getComputedStyle(document.body).fontFamily;
      // Pick any visible text element
      const el = document.querySelector('span, p, h1, h2, h3');
      const elem = el ? getComputedStyle(el).fontFamily : '';
      return [body, elem];
    });

    expect(bodyFont.toLowerCase()).toContain('space grotesk');
    // The element should inherit the same font (not fall back to Times New Roman etc.)
    if (elemFont) {
      expect(elemFont.toLowerCase()).toContain('space grotesk');
    }
  });

  test('--font-body is set via the correct CSS variable chain', async ({ page }) => {
    // Verify the full chain: next/font sets --font-space-grotesk on body via its class,
    // globals.css declares --font-body: var(--font-space-grotesk) on body so the reference
    // resolves correctly, and font-family on body computes to Space Grotesk.
    const [fontSpaceGrotesk, fontBodyRaw, bodyFamily] = await page.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      return [
        bodyStyle.getPropertyValue('--font-space-grotesk').trim(),
        bodyStyle.getPropertyValue('--font-body').trim(),
        bodyStyle.fontFamily,
      ];
    });

    // next/font sets --font-space-grotesk on body via __variable_* class
    expect(fontSpaceGrotesk.length).toBeGreaterThan(0);
    // globals.css declares --font-body on body (so it's non-empty)
    expect(fontBodyRaw.length).toBeGreaterThan(0);
    // The resolved font-family must be Space Grotesk (not system-ui fallback)
    expect(bodyFamily.toLowerCase()).toContain('space grotesk');
  });
});
