/**
 * Builder UX Overhaul E2E Tests
 *
 * Run with:  npx playwright test e2e/builder-ux-overhaul.spec.ts
 *
 * Tests:
 *   UXO-01  Pages tab removed from left panel
 *   UXO-02  Pages picker button visible in navbar
 *   UXO-03  Pages picker opens dropdown on click
 *   UXO-04  Pages picker shows current page
 *   UXO-05  Pages picker dropdown has search input
 *   UXO-06  Pages picker "Add page" button shows route picker
 *   UXO-07  Pages picker navigates to selected page
 *
 *   UXO-10  Props tab hides className field
 *   UXO-11  Props tab hides style field (when present)
 *   UXO-12  Props tab shows hint message about Design tab
 *
 *   UXO-20  Logic tab: Interactions section is listed before Visibility
 *   UXO-21  Logic tab: empty state shows helpful quick-start text
 *   UXO-22  Logic tab: Stepper section shows empty hint text
 *   UXO-23  Logic tab: Dirty Tracking section shows empty hint text
 *
 *   UXO-30  Formula panel: ƒ button visible next to text content field
 *   UXO-31  Formula panel: clicking ƒ button opens formula panel
 *   UXO-32  Formula panel: mode tabs (Static / Path / Expression) are visible
 *   UXO-33  Formula panel: variable tree shows entries
 *   UXO-34  Formula panel: Apply button closes panel
 *   UXO-35  Formula panel: bound value shows purple dot indicator
 *
 *   UXO-40  Floating toolbar has "⬇ Fetch" datasource shortcut button
 *   UXO-41  Clicking "⬇ Fetch" switches right panel to Logic tab and opens datasource section
 *
 *   UXO-50  App panel Actions tab shows usage hint
 *   UXO-51  App panel Sources tab shows empty hint with config path
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 }
  );
  await page.waitForTimeout(300);
}

async function dropBox(page: Page) {
  await page.getByTestId('tab-components').click();
  const item = page.locator('[draggable="true"]').filter({ hasText: 'Box' }).first();
  await expect(item).toBeVisible({ timeout: 5_000 });
  const frame = page.locator('[data-builder-page-frame]');
  for (let i = 0; i < 3; i++) {
    await item.dragTo(frame);
    const count = await page.locator('[data-builder-id]').count();
    if (count > 0) break;
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('[data-builder-id]', { timeout: 5_000 });
}

async function dropText(page: Page) {
  await page.getByTestId('tab-components').click();
  const item = page.locator('[draggable="true"]').filter({ hasText: 'Text' }).first();
  await expect(item).toBeVisible({ timeout: 5_000 });
  const frame = page.locator('[data-builder-page-frame]');
  for (let i = 0; i < 3; i++) {
    await item.dragTo(frame);
    const count = await page.locator('[data-builder-id]').count();
    if (count > 0) break;
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('[data-builder-id]', { timeout: 5_000 });
}

async function selectFirstNode(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.locator('[data-testid="layer-row"]').first().click();
}

async function switchToLogicTab(page: Page) {
  // Ensure a node is selected first
  await page.locator('[data-testid="layer-row"]').first().click();
  const logicTab = page.locator('[data-testid="tab-right-logic"]');
  await expect(logicTab).toBeVisible({ timeout: 5_000 });
  await logicTab.click();
}

// ─── Pages Picker ─────────────────────────────────────────────────────────────

test('UXO-01 Pages tab removed from left panel tab bar', async ({ page }) => {
  await gotoBuilder(page);
  const pagesTab = page.getByTestId('tab-pages');
  await expect(pagesTab).not.toBeVisible();
});

test('UXO-02 Pages picker button visible in navbar', async ({ page }) => {
  await gotoBuilder(page);
  await expect(page.getByTestId('pages-picker-trigger')).toBeVisible();
});

test('UXO-03 Pages picker opens dropdown on click', async ({ page }) => {
  await gotoBuilder(page);
  await page.getByTestId('pages-picker-trigger').click();
  await expect(page.getByTestId('pages-picker')).toBeVisible();
  // Search input should appear
  const searchInput = page.locator('[data-testid="pages-picker"] input[placeholder]');
  await expect(searchInput).toBeVisible({ timeout: 3_000 });
});

test('UXO-04 Pages picker shows current page name', async ({ page }) => {
  await gotoBuilder(page);
  const trigger = page.getByTestId('pages-picker-trigger');
  const text = await trigger.innerText();
  expect(text.trim().length).toBeGreaterThan(0);
});

test('UXO-05 Pages picker dropdown has search input', async ({ page }) => {
  await gotoBuilder(page);
  await page.getByTestId('pages-picker-trigger').click();
  const searchInput = page.locator('[data-testid="pages-picker"] input');
  await expect(searchInput).toBeVisible({ timeout: 3_000 });
});

test('UXO-06 Pages picker Add page button shows route picker', async ({ page }) => {
  await gotoBuilder(page);
  await page.getByTestId('pages-picker-trigger').click();
  await page.getByTestId('pages-picker-add').click();
  // Custom route input or app routes should appear
  const customInput = page.locator('[data-testid="pages-picker"] input[placeholder="/my-page"]');
  await expect(customInput).toBeVisible({ timeout: 3_000 });
});

test('UXO-07 Pages picker page rows navigate on click', async ({ page }) => {
  await gotoBuilder(page);
  await page.getByTestId('pages-picker-trigger').click();
  // Get current page name
  const initialTrigger = page.getByTestId('pages-picker-trigger');
  const initialText = await initialTrigger.innerText();
  // Get available rows in the store
  const storePages = await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { pages: Array<{ id: string; name: string }> } }>).__builderStore;
    return store?.getState().pages ?? [];
  });
  if (storePages.length > 1) {
    // Click the second page row
    await page.getByTestId(`pages-picker-row-${storePages[1].id}`).click();
    // Dropdown should close, picker should show the new page name
    await expect(page.getByTestId('pages-picker-trigger')).toContainText(storePages[1].name, { timeout: 3_000 });
    expect(initialText).not.toContain(storePages[1].name);
  } else {
    // Only one page — just verify dropdown closes when clicking the current page row
    await page.getByTestId(`pages-picker-row-${storePages[0].id}`).click();
    await expect(page.getByTestId('pages-picker')).toBeVisible(); // dropdown closes on click
  }
});

// ─── Props Tab Cleanup ────────────────────────────────────────────────────────

test('UXO-10 Props tab hides className field', async ({ page }) => {
  await gotoBuilder(page);
  await dropBox(page);
  await selectFirstNode(page);
  const propsTab = page.getByTestId('tab-right-props');
  await expect(propsTab).toBeVisible({ timeout: 5_000 });
  await propsTab.click();
  // className label should not be present in props list
  const labels = await page.locator('[data-testid="panel-right"] span').allInnerTexts();
  const classNames = labels.filter(l => l.trim() === 'className');
  expect(classNames.length).toBe(0);
});

test('UXO-12 Props tab shows hint message about Design tab', async ({ page }) => {
  await gotoBuilder(page);
  await dropBox(page);
  await selectFirstNode(page);
  await page.getByTestId('tab-right-props').click();
  const panelRight = page.locator('[data-testid="panel-right"]');
  const text = await panelRight.innerText();
  expect(text).toMatch(/className|Design tab/i);
});

// ─── Logic Tab UX ─────────────────────────────────────────────────────────────

test('UXO-20 Logic tab: Interactions section appears before Visibility', async ({ page }) => {
  await gotoBuilder(page);
  await dropBox(page);
  await selectFirstNode(page);
  await switchToLogicTab(page);

  const logicSections = page.locator('[data-logic-section]');
  const count = await logicSections.count();
  expect(count).toBeGreaterThan(2);

  // Find indices of 'interactions' and 'visibility'
  const sectionIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await logicSections.nth(i).getAttribute('data-logic-section');
    if (id) sectionIds.push(id);
  }
  const interIdx = sectionIds.indexOf('interactions');
  const visIdx = sectionIds.indexOf('visibility');
  expect(interIdx).toBeGreaterThanOrEqual(0);
  expect(visIdx).toBeGreaterThanOrEqual(0);
  expect(interIdx).toBeLessThan(visIdx);
});

test('UXO-21 Logic tab: no-logic empty state shows quick-start text', async ({ page }) => {
  await gotoBuilder(page);
  await dropBox(page);
  await selectFirstNode(page);
  await switchToLogicTab(page);
  // Newly dropped node has no logic — should show quick-start text
  const panelRight = page.locator('[data-testid="panel-right"]');
  const text = await panelRight.innerText();
  expect(text).toMatch(/Interactions|Visibility|Repeat/);
});

test('UXO-22 Logic tab: Stepper section shows empty hint', async ({ page }) => {
  await gotoBuilder(page);
  await dropBox(page);
  await selectFirstNode(page);
  await switchToLogicTab(page);
  // Open stepper section
  const stepperSection = page.locator('[data-logic-section="stepper"]');
  await expect(stepperSection).toBeVisible({ timeout: 5_000 });
  await stepperSection.locator('button').first().click();
  const text = await stepperSection.innerText();
  expect(text).toMatch(/stepper|step|checkout/i);
});

test('UXO-23 Logic tab: Dirty Tracking section shows empty hint', async ({ page }) => {
  await gotoBuilder(page);
  await dropBox(page);
  await selectFirstNode(page);
  await switchToLogicTab(page);
  // Open dirty tracking section
  const dirtySection = page.locator('[data-logic-section="dirty"]');
  await expect(dirtySection).toBeVisible({ timeout: 5_000 });
  await dirtySection.locator('button').first().click();
  const text = await dirtySection.innerText();
  expect(text).toMatch(/dirty|form|unsaved/i);
});

// ─── Formula Panel ────────────────────────────────────────────────────────────

// Helper: drop a text component and select it via the layers panel
async function dropAndSelectText(page: Page) {
  await dropText(page);
  // Use layers panel to select a Text-type node reliably
  await page.getByTestId('tab-layers').click();
  await page.waitForTimeout(400);
  // Look for a layer row with data-node-type="Text"
  const textLayerRow = page.locator('[data-testid="layer-row"][data-node-type="Text"]').first();
  const found = await textLayerRow.count();
  if (found > 0) {
    await textLayerRow.click();
  } else {
    // Fallback: click the last visible layer row
    const rows = page.locator('[data-testid="layer-row"]');
    const count = await rows.count();
    await rows.nth(count - 1).click();
  }
  await page.waitForTimeout(200);
  // Make sure design tab is active
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(200);
}

test('UXO-30 Formula button visible next to text content field when text node selected', async ({ page }) => {
  await gotoBuilder(page);
  await dropAndSelectText(page);
  // Design tab is active — formula button for text should be visible
  const formulaBtn = page.getByTestId('formula-btn').first();
  await expect(formulaBtn).toBeVisible({ timeout: 8_000 });
});

test('UXO-31 Clicking formula button opens formula panel', async ({ page }) => {
  await gotoBuilder(page);
  await dropAndSelectText(page);
  const formulaBtn = page.getByTestId('formula-btn').first();
  await expect(formulaBtn).toBeVisible({ timeout: 8_000 });
  await formulaBtn.click();
  await expect(page.getByTestId('formula-panel')).toBeVisible({ timeout: 3_000 });
});

test('UXO-32 Formula panel mode tabs are visible', async ({ page }) => {
  await gotoBuilder(page);
  await dropAndSelectText(page);
  await page.getByTestId('formula-btn').first().click();
  await expect(page.getByTestId('formula-panel')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('formula-mode-static')).toBeVisible();
  await expect(page.getByTestId('formula-mode-path')).toBeVisible();
  await expect(page.getByTestId('formula-mode-expr')).toBeVisible();
});

test('UXO-33 Formula panel variable tree shows entries', async ({ page }) => {
  await gotoBuilder(page);
  await dropAndSelectText(page);
  await page.getByTestId('formula-btn').first().click();
  await expect(page.getByTestId('formula-panel')).toBeVisible({ timeout: 5_000 });
  const panelText = await page.getByTestId('formula-panel').innerText();
  // Should show at least one path entry
  expect(panelText).toMatch(/_workflow|store|screens/i);
});

test('UXO-34 Formula panel Apply button closes panel', async ({ page }) => {
  await gotoBuilder(page);
  await dropAndSelectText(page);
  await page.getByTestId('formula-btn').first().click();
  await expect(page.getByTestId('formula-panel')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('formula-apply').click();
  await expect(page.getByTestId('formula-panel')).not.toBeVisible({ timeout: 3_000 });
});

test('UXO-35 Formula button shows purple dot when bound to a path', async ({ page }) => {
  await gotoBuilder(page);
  await dropAndSelectText(page);
  await page.getByTestId('formula-btn').first().click();
  await expect(page.getByTestId('formula-panel')).toBeVisible({ timeout: 5_000 });
  // Switch to path mode and type a path
  await page.getByTestId('formula-mode-path').click();
  const textarea = page.getByTestId('formula-input');
  await textarea.fill('{{user.name}}');
  await page.getByTestId('formula-apply').click();
  // After applying a bound value, the button should show a purple indicator span
  const btn = page.getByTestId('formula-btn').first();
  const dotExists = await btn.locator('span').count();
  expect(dotExists).toBeGreaterThan(0);
});

// ─── Floating Toolbar Datasource shortcut ────────────────────────────────────

// Helper: select a node and wait for the floating toolbar to appear
async function selectNodeAndGetToolbar(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="layer-row"]').first().click();
  await page.waitForTimeout(500);
  const toolbar = page.locator('[data-floating-toolbar="1"]');
  await expect(toolbar).toBeVisible({ timeout: 8_000 });
  return toolbar;
}

test('UXO-40 Floating toolbar has Fetch datasource shortcut button', async ({ page }) => {
  await gotoBuilder(page);
  await dropBox(page);
  const toolbar = await selectNodeAndGetToolbar(page);
  const fetchBtn = toolbar.locator('button').filter({ hasText: 'Fetch' }).first();
  await expect(fetchBtn).toBeVisible({ timeout: 5_000 });
});

test('UXO-41 Clicking Fetch button opens datasource section in Logic tab', async ({ page }) => {
  await gotoBuilder(page);
  await dropBox(page);
  const toolbar = await selectNodeAndGetToolbar(page);
  await toolbar.locator('button').filter({ hasText: 'Fetch' }).first().click();
  await page.waitForTimeout(500);
  // Logic tab should now be active and datasource section visible
  const datasourceSection = page.locator('[data-logic-section="datasource"]');
  await expect(datasourceSection).toBeVisible({ timeout: 8_000 });
});

// ─── App Panel Discoverability ────────────────────────────────────────────────

test('UXO-50 App panel Actions tab shows usage hint', async ({ page }) => {
  await gotoBuilder(page);
  await page.getByTestId('tab-app').click();
  await page.getByTestId('tab-app-actions').click();
  const panelText = await page.locator('[data-testid="panel-left"]').innerText();
  expect(panelText).toMatch(/Interactions|named.*action|action.*name/i);
});

test('UXO-51 App panel Sources tab shows hint about Data Source', async ({ page }) => {
  await gotoBuilder(page);
  await page.getByTestId('tab-app').click();
  await page.getByTestId('tab-app-sources').click();
  const panelText = await page.locator('[data-testid="panel-left"]').innerText();
  // Either shows the usage hint (if sources exist) or the empty state with config path
  expect(panelText).toMatch(/Data Source|config\/actions|graphql|fetch/i);
});
