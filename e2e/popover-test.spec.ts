/**
 * Popover Test Page — E2E Tests
 *
 * Tests the /popover-test page:
 *   Section 1 — Click popover (dropdown menu)
 *   Section 2 — Hover popovers (tooltip-style)
 *   Section 3 — Match trigger width dropdown
 *   Section 4 — Programmatic control via variable
 *   Section 5 — Interactive popover content (counter)
 *   Section 6 — Context menu style
 *
 * Run: npx playwright test e2e/popover-test.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/popover-test`;

async function gotoPage(page: Page) {
  await page.goto(URL);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForSelector('h2', { timeout: 20_000 });
}

function btn(page: Page, label: string) {
  return page.locator(`text="${label}"`).first();
}

// ─── PT-01: Page loads ──────────────────────────────────────────────────────

test('PT-01: page loads with correct heading and all sections', async ({ page }) => {
  await gotoPage(page);
  await expect(page.getByRole('heading', { name: 'Popover & Tooltip Showcase' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Click Popover/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Hover Popovers/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Match Trigger Width/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Programmatic Control/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Interactive Popover Content/ })).toBeVisible();
});

// ─── PT-02: Click popover dropdown ──────────────────────────────────────────

test('PT-02: clicking Menu button opens dropdown and selecting an item updates text', async ({ page }) => {
  await gotoPage(page);

  // Dropdown content should not be visible initially
  await expect(page.locator('[data-popover-host="popover"]')).not.toBeVisible();

  // Click the Menu button
  await btn(page, 'Menu').click();

  // Dropdown should appear with menu items
  const popover = page.locator('[data-popover-host="popover"]').first();
  await expect(popover).toBeVisible({ timeout: 3_000 });
  await expect(popover.getByText('Dashboard')).toBeVisible();
  await expect(popover.getByText('Analytics')).toBeVisible();
  await expect(popover.getByText('Settings')).toBeVisible();

  // Click "Analytics" item
  await popover.getByText('Analytics').click();

  // The selected text should update
  await expect(page.getByText('Selected: Analytics')).toBeVisible({ timeout: 3_000 });
});

// ─── PT-03: Click popover closes on outside click ───────────────────────────

test('PT-03: click popover closes when clicking outside', async ({ page }) => {
  await gotoPage(page);

  await btn(page, 'Menu').click();
  const popover = page.locator('[data-popover-host="popover"]').first();
  await expect(popover).toBeVisible({ timeout: 3_000 });

  // Click far away from the popover
  await page.mouse.click(10, 10);

  await expect(popover).not.toBeVisible({ timeout: 3_000 });
});

// ─── PT-04: Hover popover appears ───────────────────────────────────────────

test('PT-04: hovering over badge shows hover-triggered popover', async ({ page }) => {
  await gotoPage(page);

  // No popover visible initially
  await expect(page.locator('[data-popover-host="popover"]')).not.toBeVisible();

  // Hover over the "Top" badge
  const topBadge = page.locator('text="Top"').first();
  await topBadge.hover();

  // Popover should appear with tooltip content
  const popover = page.locator('[data-popover-host="popover"]').first();
  await expect(popover).toBeVisible({ timeout: 3_000 });
  await expect(popover.getByText('Tooltip on top')).toBeVisible();

  // Move mouse away
  await page.mouse.move(0, 0);
  await expect(popover).not.toBeVisible({ timeout: 3_000 });
});

// ─── PT-05: Match trigger width dropdown ────────────────────────────────────

test('PT-05: match-trigger-width dropdown opens on click', async ({ page }) => {
  await gotoPage(page);

  // Click the select-like trigger
  const trigger = page.locator('#fullwidth-dropdown');
  await expect(trigger).toBeVisible({ timeout: 5_000 });
  await trigger.click();

  // Popover with mapped dropdown items should appear
  const popover = page.locator('[data-popover-host="popover"][data-popover-node-id="fullwidth-dropdown"]');
  await expect(popover).toBeVisible({ timeout: 5_000 });
});

// ─── PT-06: Programmatic control ────────────────────────────────────────────

test('PT-06: Open/Close/Toggle buttons control the programmatic popover', async ({ page }) => {
  await gotoPage(page);

  const popoverContent = page.getByText('Programmatic Popover');

  // Initially hidden
  await expect(popoverContent).not.toBeVisible();

  // Click Open
  await btn(page, 'Open').click();
  await expect(popoverContent).toBeVisible({ timeout: 3_000 });

  // Click Dismiss button inside the popover
  const popover = page.locator('[data-popover-host="popover"]').filter({ hasText: 'Programmatic Popover' });
  await popover.getByText('Dismiss', { exact: true }).click();
  await expect(popoverContent).not.toBeVisible({ timeout: 3_000 });

  // Click Toggle to open
  await btn(page, 'Toggle').click();
  await expect(popoverContent).toBeVisible({ timeout: 3_000 });

  // Click Toggle again to close
  await btn(page, 'Toggle').click();
  await expect(popoverContent).not.toBeVisible({ timeout: 3_000 });
});

// ─── PT-07: Interactive popover counter ─────────────────────────────────────

test('PT-07: interactive popover counter increments and resets', async ({ page }) => {
  await gotoPage(page);

  // Open the interactive popover
  await btn(page, 'Interactive Popover').click();

  const popover = page.locator('[data-popover-host="popover"]').filter({ hasText: 'Interactive Counter' });
  await expect(popover).toBeVisible({ timeout: 3_000 });

  // Counter starts at 0
  await expect(popover.getByText('0')).toBeVisible();

  // Increment 3 times
  await popover.getByText('Increment').click();
  await popover.getByText('Increment').click();
  await popover.getByText('Increment').click();
  await expect(popover.getByText('3')).toBeVisible({ timeout: 2_000 });

  // External label also shows 3
  await expect(page.getByText('Counter: 3')).toBeVisible();

  // Reset
  await popover.getByText('Reset').click();
  await expect(popover.getByText('0')).toBeVisible({ timeout: 2_000 });
  await expect(page.getByText('Counter: 0')).toBeVisible();
});

// ─── PT-08: Context menu style ──────────────────────────────────────────────

test('PT-08: more-options button opens context menu with all items', async ({ page }) => {
  await gotoPage(page);

  const fileCard = page.getByText('Project Report.pdf');
  await expect(fileCard).toBeVisible();

  // Click the more-options dots button (identified by its id)
  await page.locator('#context-menu-trigger').click();

  // Context menu items should appear
  const popover = page.locator('[data-popover-host="popover"]').filter({ hasText: 'Download' });
  await expect(popover).toBeVisible({ timeout: 3_000 });
  await expect(popover.getByText('Share')).toBeVisible();
  await expect(popover.getByText('Rename')).toBeVisible();
  await expect(popover.getByText('Delete')).toBeVisible();
});

// ─── PT-09: No page errors ──────────────────────────────────────────────────

test('PT-09: page has no console errors during interactions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await gotoPage(page);

  // Perform various interactions
  await btn(page, 'Menu').click();
  await page.waitForTimeout(500);
  await page.mouse.click(10, 10);
  await page.waitForTimeout(300);

  await btn(page, 'Open').click();
  await page.waitForTimeout(500);
  await btn(page, 'Toggle').click();
  await page.waitForTimeout(300);

  await btn(page, 'Interactive Popover').click();
  await page.waitForTimeout(500);

  expect(errors).toHaveLength(0);
});
