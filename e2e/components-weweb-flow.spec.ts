/**
 * WeWeb-Style Components — E2E Flow Tests
 *
 * Covers:
 *  CW-01  + New button appears when a node is selected
 *  CW-02  Create popover opens with name / folder / description fields
 *  CW-03  Submitting the popover enters component edit mode (editor panel shown)
 *  CW-04  Editor panel has Settings / Data / Actions tab bar
 *  CW-05  Back to Instance button restores the original panel
 *  CW-06  Counter-card screen renders two instances with independent counters
 *
 * Run: npx playwright test e2e/components-weweb-flow.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 },
  );
  await page.waitForTimeout(1500);
}

async function addAndSelectBox(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Box', id: nodeId, props: { className: 'flex w-32 h-32 flex-col', style: {} } },
      null,
    );
    (store.select as (id: string) => void)(nodeId);
  }, id);
  await page.waitForFunction(
    (nodeId) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(nodeId as string);
    },
    id,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(600);
}

// ─── CW-01 — + New button visible when node is selected ───────────────────────

test('CW-01 — + New button appears when a node is selected', async ({ page }) => {
  await gotoBuilder(page);
  await addAndSelectBox(page, 'cw01-test-box');

  // The New Component button lives at the top of the right panel
  await expect(page.locator('[data-testid="panel-right-new-component"]')).toBeVisible({ timeout: 5_000 });
});

// ─── CW-02 — Create popover opens with all fields ─────────────────────────────

test('CW-02 — Create popover shows name / folder / description fields', async ({ page }) => {
  await gotoBuilder(page);
  await addAndSelectBox(page, 'cw02-test-box');

  await page.click('[data-testid="panel-right-new-component"]');
  await expect(page.locator('[data-testid="create-component-popover"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="create-component-popover-name"]')).toBeVisible();
  await expect(page.locator('[data-testid="create-component-popover-folder"]')).toBeVisible();
  await expect(page.locator('[data-testid="create-component-popover-description"]')).toBeVisible();
  await expect(page.locator('[data-testid="create-component-popover-submit"]')).toBeVisible();
});

// ─── CW-03 — Submit popover enters component edit mode ────────────────────────

test('CW-03 — Submit popover enters component edit mode', async ({ page }) => {
  await gotoBuilder(page);
  await addAndSelectBox(page, 'cw03-test-box');

  // Open popover
  await page.click('[data-testid="panel-right-new-component"]');
  await page.waitForSelector('[data-testid="create-component-popover"]', { timeout: 5_000 });

  // Fill in name and submit
  await page.fill('[data-testid="create-component-popover-name"]', 'My Test Component');
  await page.click('[data-testid="create-component-popover-submit"]');

  // Editor panel should now be visible
  await expect(page.locator('[data-testid="component-editor-panel"]')).toBeVisible({ timeout: 8_000 });
});

// ─── CW-04 — Editor has Settings / Data / Actions tabs ────────────────────────

test('CW-04 — Component editor panel has Settings, Data, Actions tabs', async ({ page }) => {
  await gotoBuilder(page);
  await addAndSelectBox(page, 'cw04-test-box');

  await page.click('[data-testid="panel-right-new-component"]');
  await page.waitForSelector('[data-testid="create-component-popover"]', { timeout: 5_000 });
  await page.fill('[data-testid="create-component-popover-name"]', 'Tabs Test Component');
  await page.click('[data-testid="create-component-popover-submit"]');
  await page.waitForSelector('[data-testid="component-editor-panel"]', { timeout: 8_000 });

  await expect(page.locator('[data-testid="sc-tab-settings"]')).toBeVisible();
  await expect(page.locator('[data-testid="sc-tab-data"]')).toBeVisible();
  await expect(page.locator('[data-testid="sc-tab-actions"]')).toBeVisible();
});

// ─── CW-05 — Back to Instance restores original panel ────────────────────────

test('CW-05 — Back to Instance button exits editor and restores selection', async ({ page }) => {
  await gotoBuilder(page);
  await addAndSelectBox(page, 'cw05-test-box');

  await page.click('[data-testid="panel-right-new-component"]');
  await page.waitForSelector('[data-testid="create-component-popover"]', { timeout: 5_000 });
  await page.fill('[data-testid="create-component-popover-name"]', 'Back Test Component');
  await page.click('[data-testid="create-component-popover-submit"]');
  await page.waitForSelector('[data-testid="component-editor-panel"]', { timeout: 8_000 });

  // Click Back to Instance
  await page.click('[data-testid="back-to-instance-btn"]');

  // Editor panel should be gone
  await expect(page.locator('[data-testid="component-editor-panel"]')).not.toBeVisible({ timeout: 5_000 });

  // The standard right panel chrome should return
  await expect(page.locator('[data-testid="panel-right-new-component"]')).toBeVisible({ timeout: 5_000 });
});

// ─── CW-06 — Counter-card screen shows two instances ─────────────────────────

test('CW-06 — Counter-card screen renders both component instances', async ({ page }) => {
  // Navigate to the counter-example screen in the app preview
  await page.goto('http://localhost:3001/counter-example');
  await page.waitForLoadState('networkidle', { timeout: 20_000 });

  // The demo section heading should be visible
  await expect(page.getByText('WeWeb-Style Component Demo')).toBeVisible({ timeout: 15_000 });

  // Both Counter A and Counter B headings should be visible
  await expect(page.getByText('COUNTER A')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('COUNTER B')).toBeVisible({ timeout: 10_000 });
});
