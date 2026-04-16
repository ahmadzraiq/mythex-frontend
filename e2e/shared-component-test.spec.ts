/**
 * Shared Component Test Page — E2E Tests
 *
 * Tests the /shared-component-test page:
 *   Section A — Visibility-based overlays (variable toggle)
 *   Section B — Dynamic addSharedComponent overlays
 *   Section C — Static inline examples (render only)
 *
 * Run: npx playwright test e2e/shared-component-test.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/shared-component-test`;

async function gotoPage(page: Page) {
  await page.goto(URL);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForSelector('h2', { timeout: 20_000 });
}

/** Click a Box/Text "button" by its visible label */
function btn(page: Page, label: string) {
  return page.locator(`text="${label}"`).first();
}

// ─── SC-01: Page loads ────────────────────────────────────────────────────────

test('SC-01: page loads with correct heading and all three sections', async ({ page }) => {
  await gotoPage(page);
  await expect(page.getByRole('heading', { name: 'Shared Component Test Page' })).toBeVisible();
  await expect(page.getByText('Section A')).toBeVisible();
  await expect(page.getByText('Section B')).toBeVisible();
  await expect(page.getByText('Section C')).toBeVisible();
});

// ─── SC-02: Modal (Section A) ─────────────────────────────────────────────────

test('SC-02: Show Modal box toggles the visibility modal', async ({ page }) => {
  await gotoPage(page);

  // Modal is hidden initially
  await expect(page.getByRole('heading', { name: 'Visibility Modal' })).not.toBeVisible();

  // Click the "Show Modal" Box
  await btn(page, 'Show Modal').click();

  // Modal should appear
  await expect(page.getByRole('heading', { name: 'Visibility Modal' })).toBeVisible({ timeout: 5_000 });

  // Close the modal via Close box
  await btn(page, 'Close').click();

  // Modal should disappear
  await expect(page.getByRole('heading', { name: 'Visibility Modal' })).not.toBeVisible({ timeout: 3_000 });
});

// ─── SC-03: Bottom Sheet (Section A) ─────────────────────────────────────────

test('SC-03: Show Bottom Sheet box toggles the visibility bottom sheet', async ({ page }) => {
  await gotoPage(page);

  await expect(page.getByRole('heading', { name: 'Visibility Bottom Sheet' })).not.toBeVisible();

  await btn(page, 'Show Bottom Sheet').click();

  await expect(page.getByRole('heading', { name: 'Visibility Bottom Sheet' })).toBeVisible({ timeout: 5_000 });

  await btn(page, 'Dismiss').click();

  await expect(page.getByRole('heading', { name: 'Visibility Bottom Sheet' })).not.toBeVisible({ timeout: 3_000 });
});

// ─── SC-04: Drawer (Section A) ───────────────────────────────────────────────

test('SC-04: Show Drawer box toggles the visibility drawer', async ({ page }) => {
  await gotoPage(page);

  await expect(page.getByRole('heading', { name: 'Visibility Drawer' })).not.toBeVisible();

  await btn(page, 'Show Drawer').click();

  await expect(page.getByRole('heading', { name: 'Visibility Drawer' })).toBeVisible({ timeout: 5_000 });

  // Close via the backdrop (right side, outside the 320px drawer)
  await page.mouse.click(700, 300);

  await expect(page.getByRole('heading', { name: 'Visibility Drawer' })).not.toBeVisible({ timeout: 3_000 });
});

// ─── SC-05: Toast (Section A) ────────────────────────────────────────────────

test('SC-05: Show Toast box toggles the visibility toast', async ({ page }) => {
  await gotoPage(page);

  await expect(page.getByText('Visibility Toast').first()).not.toBeVisible();

  await btn(page, 'Show Toast').click();

  await expect(page.getByText('Visibility Toast').first()).toBeVisible({ timeout: 5_000 });

  // Toggle off by clicking Show Toast again (it's a toggle)
  await btn(page, 'Show Toast').click();

  await expect(page.getByText('Visibility Toast').first()).not.toBeVisible({ timeout: 3_000 });
});

// ─── SC-06: Variable updated on click ────────────────────────────────────────

test('SC-06: variable store updates to true after clicking Show Modal', async ({ page }) => {
  await gotoPage(page);

  await btn(page, 'Show Modal').click();
  await page.waitForTimeout(200); // wait for rAF

  const val = await page.evaluate(() => {
    const store = (window as any).__globalVariableStore;
    return store?.getState().getFullState()['sct-modal-0000-0000-0000-000000000001'];
  });

  expect(val).toBe(true);
});

// ─── SC-07: Modal backdrop closes modal ──────────────────────────────────────

test('SC-07: clicking backdrop closes the modal', async ({ page }) => {
  await gotoPage(page);

  await btn(page, 'Show Modal').click();
  await expect(page.getByRole('heading', { name: 'Visibility Modal' })).toBeVisible({ timeout: 5_000 });

  // Click top-left corner of page (outside the centered modal = on backdrop)
  await page.mouse.click(30, 30);

  await expect(page.getByRole('heading', { name: 'Visibility Modal' })).not.toBeVisible({ timeout: 3_000 });
});

// ─── SC-08: Dynamic Modal (Section B) ────────────────────────────────────────

test('SC-08: Add Dynamic Modal button click does not crash the page', async ({ page }) => {
  await gotoPage(page);

  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await btn(page, 'Add Dynamic Modal').click();
  await page.waitForTimeout(800);

  // Page must still be functional after the click
  await expect(page.getByText('Section A')).toBeVisible();
  await expect(page.getByText('Section B')).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ─── SC-09: Dynamic toast (Section B) ─────────────────────────────────────────

test('SC-09: Add Dynamic Toast button click does not crash the page', async ({ page }) => {
  await gotoPage(page);

  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await btn(page, 'Add Dynamic Toast (auto-dismiss)').click();
  await page.waitForTimeout(800);

  await expect(page.getByText('Section A')).toBeVisible();
  await expect(page.getByText('Section B')).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ─── SC-10: Section C static examples render ─────────────────────────────────

test('SC-10: Section C static examples are visible', async ({ page }) => {
  await gotoPage(page);

  await expect(page.getByText('Default Accent Card')).toBeVisible();
  await expect(page.getByText('Green Accent Card')).toBeVisible();
  await expect(page.getByText('Active')).toBeVisible();
  await expect(page.getByText('Paused')).toBeVisible();
});

// ─── SC-11: Multiple overlays are independent ─────────────────────────────────

test('SC-11: modal and toast can open/close independently', async ({ page }) => {
  await gotoPage(page);

  // Open modal
  await btn(page, 'Show Modal').click();
  await expect(page.getByRole('heading', { name: 'Visibility Modal' })).toBeVisible({ timeout: 5_000 });

  // Close modal — toast must still be hidden
  await btn(page, 'Close').click();
  await expect(page.getByRole('heading', { name: 'Visibility Modal' })).not.toBeVisible({ timeout: 3_000 });
  await expect(page.getByText('Visibility Toast').first()).not.toBeVisible();

  // Open toast — modal must still be hidden
  await btn(page, 'Show Toast').click();
  await expect(page.getByText('Visibility Toast').first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('heading', { name: 'Visibility Modal' })).not.toBeVisible();
});
