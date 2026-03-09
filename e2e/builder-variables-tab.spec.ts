/**
 * Builder — Variables Tab Tests (VT series)
 *
 * Tests for the config-driven Variables tab in the formula editor:
 *   VT-01  — Variables tab opens without error
 *   VT-02  — Config variables from variables.json appear in the tab
 *   VT-03  — Variables are grouped by folder
 *   VT-04  — Form variable expands to show value/errors sub-fields
 *   VT-05  — Clicking a variable inserts a chip with the variable label
 *   VT-06  — Variable chip serializes to variables['UUID'] formula path
 *   VT-07  — CONTEXT section always visible (browser.url, screen.width etc.)
 *   VT-08  — Clicking a context var inserts a context chip
 *   VT-09  — PAGES section shows routes from routes.json
 *   VT-10  — THEME section shows colors with swatches
 *   VT-11  — Search filters variables by label
 *   VT-12  — Search filters context vars
 *
 * Run: npx playwright test e2e/builder-variables-tab.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 }
  );
  await page.waitForTimeout(1500);
}

async function addAndSelectBox(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Box', id: nodeId, props: { className: 'flex w-20 h-20 flex-col', style: {} } },
      null
    );
    (store.select as (id: string) => void)(nodeId);
  }, id);
  await page.waitForFunction((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(nodeId as string);
  }, id, { timeout: 5_000 });
  await page.waitForTimeout(500);
}

/** Open the formula editor for a binding row (e.g., text content) */
async function openFormulaEditor(page: Page) {
  await page.click('[data-testid="tab-right-design"]');
  await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
  // Click the first binding icon to open the formula editor
  await page.click('[data-testid="binding-icon"]');
  await page.waitForSelector('[data-testid="formula-apply"]', { timeout: 10_000 });
  await page.waitForTimeout(400);
}

/** Switch to the Variables tab in the formula editor */
async function switchToVariablesTab(page: Page) {
  const tabButton = page.locator('button').filter({ hasText: 'Variables' }).first();
  await tabButton.click();
  await page.waitForTimeout(400);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('VT — Variables Tab', () => {
  test('VT-01: Variables tab opens without error', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt01-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    // Should not show an error state
    await expect(page.locator('[data-testid="formula-apply"]')).toBeVisible();
  });

  test('VT-02: Config variables from variables.json appear in the Variables tab', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt02-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    // Wait for variables to load (the builder loads config from API)
    await page.waitForTimeout(1000);
    // "Nav Drawer Open" is a known variable from variables.json
    // It should appear in the tab (may be inside a folder that needs expanding)
    const content = await page.locator('body').textContent();
    expect(content).toContain('Nav Drawer Open');
  });

  test('VT-03: Variables are grouped by folder', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt03-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(1000);
    // Should show folder names like "Layout", "Navigation", "Auth"
    const content = await page.locator('body').textContent();
    expect(content).toMatch(/Layout|Navigation|Auth/);
  });

  test('VT-04: Variables tab does not contain removed form variables', async ({ page }) => {
    // Form variables (Sign In Form, Register Form, etc.) were migrated to weWeb-style
    // local.data.form.* and removed from config/variables.json. This test ensures they
    // no longer appear in the Variables tab.
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt04-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(1000);
    const content = await page.locator('body').textContent();
    expect(content).not.toContain('Sign In Form');
    expect(content).not.toContain('Register Form');
    expect(content).not.toContain('Cart Coupon Form');
  });

  test('VT-05: Clicking a simple variable inserts a chip', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt05-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(1000);
    // Click on "Search Query" (a string variable) — it should insert a chip
    const varBtn = page.locator('button').filter({ hasText: 'Search Query' }).first();
    await expect(varBtn).toBeVisible({ timeout: 5_000 });
    await varBtn.click();
    await page.waitForTimeout(300);
    // A variable chip should now exist in the editor
    const chip = page.locator('[data-type="variable"][data-formula*="variables[\'f5a6b7c8-d9e0-1234-fabc-345678901234\']"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
  });

  test('VT-06: Variable chip serializes to variables[UUID] formula', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt06-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(1000);
    // Insert "Search Query" variable
    const varBtn = page.locator('button').filter({ hasText: 'Search Query' }).first();
    await expect(varBtn).toBeVisible({ timeout: 5_000 });
    await varBtn.click();
    await page.waitForTimeout(300);
    // The chip should appear in the editor with the formula path
    const chip = page.locator('[data-type="variable"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
    // The chip's data-formula should contain the UUID
    const formulaAttr = await chip.getAttribute('data-formula');
    expect(formulaAttr).toContain('f5a6b7c8-d9e0-1234-fabc-345678901234');
  });

  test('VT-07: CONTEXT section is always visible with browser/screen vars', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt07-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(500);
    const content = await page.locator('body').textContent();
    // "Context" section header
    expect(content).toContain('Context');
    // browser.url and screen.width should always be present
    expect(content).toMatch(/browser\.url|browser\.path/);
    expect(content).toMatch(/screen\.width|screen\.height/);
  });

  test('VT-08: Clicking a context variable inserts a context chip', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt08-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(500);
    // Click "browser.url"
    const ctxBtn = page.locator('button').filter({ hasText: 'browser.url' }).first();
    await expect(ctxBtn).toBeVisible({ timeout: 5_000 });
    await ctxBtn.click();
    await page.waitForTimeout(300);
    // A context chip should be inserted
    const chip = page.locator('[data-type="context"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
  });

  test('VT-09: PAGES section shows routes from routes.json', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt09-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(500);
    const content = await page.locator('body').textContent();
    // "Pages" section and known route names
    expect(content).toContain('Pages');
    expect(content).toMatch(/home|signIn|product/);
  });

  test('VT-10: THEME section shows color entries with hex values', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt10-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(500);
    const content = await page.locator('body').textContent();
    // "Theme" section should be present
    expect(content).toContain('Theme');
    // Colors should be shown (expand colors folder first)
    const colorsBtn = page.locator('button').filter({ hasText: 'colors' }).first();
    if (await colorsBtn.isVisible()) {
      await colorsBtn.click();
      await page.waitForTimeout(300);
      // Hex color values should be visible
      const colorContent = await page.locator('body').textContent();
      expect(colorContent).toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });

  test('VT-11: Search filters variables by label', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt11-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(500);
    // Locate the formula editor container (ancestor of the apply button)
    const formulaContainer = page.locator('[data-testid="formula-apply"]').locator('../../../..');
    // Type in the search box (scoped to formula editor area)
    const searchInput = page.locator('input[placeholder*="variables"]').first();
    await searchInput.fill('Search Query');
    await page.waitForTimeout(500);
    // "Search Query" variable row should be visible inside the formula panel
    const searchQueryBtn = formulaContainer.locator('button').filter({ hasText: 'Search Query' }).first();
    await expect(searchQueryBtn).toBeVisible({ timeout: 5_000 });
    // "Nav Drawer Open" row should be gone from the formula panel (count = 0)
    const navDrawerBtns = formulaContainer.locator('button').filter({ hasText: 'Nav Drawer Open' });
    await expect(navDrawerBtns).toHaveCount(0, { timeout: 3_000 });
  });

  test('VT-12: Search filters context variables by label', async ({ page }) => {
    await gotoBuilder(page);
    await addAndSelectBox(page, 'vt12-box');
    await openFormulaEditor(page);
    await switchToVariablesTab(page);
    await page.waitForTimeout(500);
    const formulaContainer = page.locator('[data-testid="formula-apply"]').locator('../../../..');
    const searchInput = page.locator('input[placeholder*="variables"]').first();
    await searchInput.fill('browser.url');
    await page.waitForTimeout(500);
    // browser.url button should be visible inside the formula panel
    const urlBtn = formulaContainer.locator('button').filter({ hasText: 'browser.url' }).first();
    await expect(urlBtn).toBeVisible({ timeout: 5_000 });
    // screen.width button should be gone (count = 0)
    const screenWidthBtns = formulaContainer.locator('button').filter({ hasText: 'screen.width' });
    await expect(screenWidthBtns).toHaveCount(0, { timeout: 3_000 });
  });
});
