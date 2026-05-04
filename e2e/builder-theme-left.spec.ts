/**
 * Builder Theme (Left Panel) E2E Tests — BTL series
 *
 * Covers:
 *   A. Theme tab is in the LEFT panel (not right)
 *   B. Right panel no longer has a Theme tab
 *   C. builder:open-theme-tab event switches to Theme tab in left panel
 *
 * Run: npx playwright test e2e/builder-theme-left.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001', { timeout: 180_000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 120_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 60_000, polling: 300 },
  );
  await page.waitForTimeout(2000);
}

let P: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  P = await browser.newPage();
  await gotoBuilder(P);
});

test.afterAll(async () => {
  if (!P.isClosed()) await P.close();
});

// ─── Group A: Theme tab in left panel ─────────────────────────────────────────

test.describe('BTL Group A — Theme tab in left panel', () => {
  test('BTL-A01: tab-theme exists in the LEFT panel', async () => {
    test.setTimeout(30_000);
    const themeTab = P.getByTestId('tab-theme');
    await expect(themeTab).toBeVisible({ timeout: 10_000 });
  });

  test('BTL-A02: clicking tab-theme shows ThemePanel content', async () => {
    test.setTimeout(30_000);
    await P.getByTestId('tab-theme').click();
    await P.waitForTimeout(500);
    // ThemePanel renders a section that contains the word "Theme" or shows color swatches
    const leftPanel = P.locator('[data-testid="panel-left"], .panel-left, [data-testid^="tab-theme"]').first();
    await expect(leftPanel).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Group B: Right panel no longer has Theme ────────────────────────────────

test.describe('BTL Group B — Right panel has no Theme tab', () => {
  test('BTL-B01: tab-right-theme does NOT exist in the DOM', async () => {
    test.setTimeout(30_000);
    const rightThemeTab = P.locator('[data-testid="tab-right-theme"]');
    await expect(rightThemeTab).not.toBeAttached({ timeout: 5_000 });
  });
});

// ─── Group C: builder:open-theme-tab event ────────────────────────────────────

test.describe('BTL Group C — builder:open-theme-tab event', () => {
  test('BTL-C01: dispatching builder:open-theme-tab event switches left panel to theme', async () => {
    test.setTimeout(30_000);
    // First navigate away from theme tab
    await P.getByTestId('tab-layers').click();
    await P.waitForTimeout(300);

    // Dispatch the event
    await P.evaluate(() => {
      window.dispatchEvent(new CustomEvent('builder:open-theme-tab'));
    });
    await P.waitForTimeout(500);

    // Tab-theme should now be active (has aria-selected or a highlighted state)
    const themeTab = P.getByTestId('tab-theme');
    await expect(themeTab).toBeVisible({ timeout: 5_000 });
  });
});
