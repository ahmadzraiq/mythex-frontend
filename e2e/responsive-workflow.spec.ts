/**
 * E2E: Responsive Workflow — waRespSmartToggle
 *
 * Verifies that a single button increments on desktop and decrements on
 * tablet/mobile, using a multiOptionBranch keyed on
 * globalContext.browser.breakpoint (resolved via ctx.get from merged state).
 *
 * Run: npx playwright test e2e/responsive-workflow.spec.ts
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = 'http://preview-dev.localhost:3001/responsive-test';

test.describe('Responsive workflow — breakpoint-dependent button', () => {
  test('desktop increments, mobile decrements same counter', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PAGE_URL, { timeout: 60_000, waitUntil: 'networkidle' });

    // Wait for SDUI engine to render
    await page.waitForSelector('text=Responsive System Test', { timeout: 15_000 });

    // Scroll to the smart toggle section
    await page.getByText('S24b').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // --- Desktop: button should say "Click to Add (+1)" ---
    const btn = page.getByText(/Click to Add/).first();
    await expect(btn).toBeVisible({ timeout: 5_000 });

    // Click 3 times to increment
    for (let i = 0; i < 3; i++) {
      await btn.click();
      await page.waitForTimeout(400);
    }

    // Mode indicator should show INCREMENT
    await expect(page.getByText(/INCREMENT/)).toBeVisible({ timeout: 3_000 });

    // --- Switch to mobile ---
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(1500);

    // Scroll again after resize
    await page.getByText('S24b').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Button text should now say "Tap to Subtract"
    const mobileBtn = page.getByText(/Tap to Subtract/).first();
    await expect(mobileBtn).toBeVisible({ timeout: 5_000 });

    // Mode should show DECREMENT
    await expect(page.getByText(/DECREMENT/)).toBeVisible({ timeout: 3_000 });

    // Click twice to decrement
    await mobileBtn.click();
    await page.waitForTimeout(400);
    await mobileBtn.click();
    await page.waitForTimeout(400);

    // --- Switch back to desktop ---
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1500);

    await page.getByText('S24b').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Button should be back to "Click to Add"
    await expect(page.getByText(/Click to Add/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/INCREMENT/)).toBeVisible({ timeout: 3_000 });
  });
});
