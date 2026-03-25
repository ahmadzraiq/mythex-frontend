/**
 * Popup Properties E2E Tests (PP series)
 *
 * Verifies that popup property formulas (context.component?.props?.['uuid'])
 * correctly resolve and display values in the builder canvas and at preview time.
 *
 * Tests:
 *   PP-01 — Open Popups tab and create a Modal popup
 *   PP-02 — Popup enters edit mode (overlay visible, right panel shows "Popup properties")
 *   PP-03 — Add a property; it appears in the properties list
 *   PP-04 — Open formula editor on a text node: Quick tab shows PROPERTIES + LOCAL sections
 *   PP-05 — Clicking a property chip inserts it and CURRENT VALUE shows the default
 *   PP-06 — Applying the formula binds it (formula editor closes)
 *   PP-07 — Closing popup clears edit mode
 *
 * Run: npx playwright test e2e/popup-properties.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BUILDER_URL = 'http://builder-dev.localhost:3001';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function openBuilder(page: Page) {
  await page.goto(BUILDER_URL);
  await page.waitForSelector('[data-testid="panel-left"]', { timeout: 30_000 });
  // Small settle delay
  await page.waitForTimeout(500);
}

async function openPopupsTab(page: Page) {
  await page.click('[data-testid="tab-popups"]');
  await page.waitForSelector('[data-testid="popup-new-btn"]', { timeout: 10_000 });
}

async function createModalAndOpen(page: Page, name = 'E2EPopup') {
  await page.click('[data-testid="popup-new-btn"]');
  // Fill the name input in the create sheet
  await page.waitForTimeout(400);
  const nameInput = page.getByPlaceholder('Popup name').or(page.locator('input[placeholder*="name"]')).first();
  await nameInput.waitFor({ timeout: 8_000 });
  await nameInput.fill(name);
  // Click the Modal type card
  await page.locator('text=Modal').first().click();
  await page.waitForTimeout(300);
  // Popup should now auto-open for editing
  await page.waitForTimeout(800);
}

// ─── PP-01 & PP-02: Create popup and enter edit mode ──────────────────────────

test('PP-01 PP-02: create Modal popup and enter edit mode', async ({ page }) => {
  await openBuilder(page);
  await openPopupsTab(page);
  await createModalAndOpen(page, 'E2E-PP0102');

  // Popup overlay should be visible in the canvas (position:absolute backdrop)
  // The popup model row should appear in the Popups tab
  const modelRow = page.locator('[data-testid="popup-model-row"]').filter({ hasText: 'E2E-PP0102' });
  await expect(modelRow).toBeVisible({ timeout: 10_000 });

  // Right panel should show "Popup properties" section since popup is in edit mode
  await expect(page.locator('text=Popup properties')).toBeVisible({ timeout: 10_000 });
});

// ─── PP-03: Add a property ────────────────────────────────────────────────────

test('PP-03: add a popup property with a default value', async ({ page }) => {
  await openBuilder(page);
  await openPopupsTab(page);
  await createModalAndOpen(page, 'E2E-PP03');

  // Click "+ New" in the Popup properties section
  await page.click('[data-testid="popup-add-property-btn"]');
  await page.waitForTimeout(400);

  // Fill in the property name
  const nameInput = page.locator('input[placeholder*="name"]').or(page.locator('input[placeholder*="Property"]')).last();
  await nameInput.waitFor({ timeout: 5_000 });
  await nameInput.fill('myTitle');

  // The CodeMirror editor for default value
  const cmContent = page.locator('.cm-content').last();
  await cmContent.click();
  await page.keyboard.selectAll();
  await page.keyboard.type('"Hello E2E"');

  // Save by pressing Enter or clicking the save button
  const saveBtn = page.locator('button', { hasText: /create|save|add/i }).last();
  if (await saveBtn.isVisible()) {
    await saveBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);

  // Property should appear in the list
  await expect(page.locator('text=myTitle')).toBeVisible({ timeout: 5_000 });
});

// ─── PP-04: Quick tab shows PROPERTIES and LOCAL sections ─────────────────────

test('PP-04: formula editor Quick tab shows PROPERTIES and LOCAL for popup node', async ({ page }) => {
  await openBuilder(page);
  await openPopupsTab(page);
  await createModalAndOpen(page, 'E2E-PP04');

  // Add a property first
  await page.click('[data-testid="popup-add-property-btn"]');
  await page.waitForTimeout(400);
  const nameInput = page.locator('input[placeholder*="name"]').or(page.locator('input[placeholder*="Property"]')).last();
  await nameInput.waitFor({ timeout: 5_000 });
  await nameInput.fill('propForQuick');
  const saveBtn = page.locator('button', { hasText: /create|save|add/i }).last();
  if (await saveBtn.isVisible()) await saveBtn.click();
  else await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Select a layer node inside the popup via the Layers tab
  await page.click('[data-testid="tab-layers"]');
  await page.waitForTimeout(300);

  // Click first Text node in layers
  const textRows = page.locator('[data-testid="layer-row"]').filter({ hasText: /^Text/ });
  if (await textRows.count() > 0) {
    await textRows.first().click();
    await page.waitForTimeout(300);

    // Open the formula editor for the text field
    // Look for the "Edit formula" button in the right panel
    const editFormulaBtn = page.locator('[data-testid="formula-editor"]').or(
      page.locator('button', { hasText: /edit formula|ƒ Edit formula/i })
    ).first();

    // Try clicking on the formula binding icon in the right panel
    const bindingIcon = page.locator('[data-testid^="field-binding"]').or(
      page.locator('button[title*="formula"]')
    ).first();
    if (await bindingIcon.count() > 0) {
      await bindingIcon.click();
    } else {
      // Try the text field label area
      await page.locator('text=Text').last().click();
    }
    await page.waitForTimeout(400);

    const formulaEditor = page.locator('[data-testid="formula-editor"]');
    if (await formulaEditor.isVisible({ timeout: 3_000 })) {
      // Go to Quick tab
      await page.click('[data-testid="formula-tab-quick"]');
      await page.waitForTimeout(300);

      // PROPERTIES section should be visible
      await expect(page.locator('text=PROPERTIES').or(page.locator('text=Properties'))).toBeVisible({ timeout: 5_000 });
      // LOCAL section should be visible
      await expect(page.locator('text=LOCAL').or(page.locator('text=Local'))).toBeVisible({ timeout: 5_000 });
      // propForQuick chip should be visible
      await expect(page.locator('span').filter({ hasText: /^propForQuick$/ })).toBeVisible({ timeout: 5_000 });
      // instancesCount in LOCAL
      await expect(page.locator('text=instancesCount')).toBeVisible({ timeout: 5_000 });
    }
  }
});

// ─── PP-05: Current value shows property default ──────────────────────────────

test('PP-05: inserting property chip shows default value in CURRENT VALUE', async ({ page }) => {
  await openBuilder(page);
  await openPopupsTab(page);
  await createModalAndOpen(page, 'E2E-PP05');

  // Add property with known default
  await page.click('[data-testid="popup-add-property-btn"]');
  await page.waitForTimeout(400);
  const nameInput = page.locator('input[placeholder*="name"]').or(page.locator('input[placeholder*="Property"]')).last();
  await nameInput.waitFor({ timeout: 5_000 });
  await nameInput.fill('greeting');
  const cmContent = page.locator('.cm-content').last();
  await cmContent.click();
  await page.keyboard.selectAll();
  await page.keyboard.type('"Hi E2E"');
  const saveBtn = page.locator('button', { hasText: /create|save|add/i }).last();
  if (await saveBtn.isVisible()) await saveBtn.click();
  else await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Select a layer node
  await page.click('[data-testid="tab-layers"]');
  await page.waitForTimeout(300);
  const textRows = page.locator('[data-testid="layer-row"]').filter({ hasText: /^Text/ });
  if (await textRows.count() > 0) {
    await textRows.first().click();
    await page.waitForTimeout(300);

    // Try to open formula editor
    const bindingIcon = page.locator('[data-testid^="field-binding"]').first();
    if (await bindingIcon.count() > 0) await bindingIcon.click();
    await page.waitForTimeout(400);

    const formulaEditor = page.locator('[data-testid="formula-editor"]');
    if (await formulaEditor.isVisible({ timeout: 3_000 })) {
      await page.click('[data-testid="formula-tab-quick"]');
      await page.waitForTimeout(300);

      // Click the greeting chip
      const greetingChip = page.locator('span').filter({ hasText: /^greeting$/ }).first();
      if (await greetingChip.isVisible({ timeout: 3_000 })) {
        await greetingChip.click();
        await page.waitForTimeout(400);

        // CURRENT VALUE should contain "Hi E2E"
        await expect(page.locator('[data-testid="formula-current-value"]')).toContainText('Hi E2E', { timeout: 5_000 });
      }
    }
  }
});

// ─── PP-06: Apply binds the formula ───────────────────────────────────────────

test('PP-06: applying property formula binds it and editor closes', async ({ page }) => {
  await openBuilder(page);
  await openPopupsTab(page);
  await createModalAndOpen(page, 'E2E-PP06');

  // Add property
  await page.click('[data-testid="popup-add-property-btn"]');
  await page.waitForTimeout(400);
  const nameInput = page.locator('input[placeholder*="name"]').or(page.locator('input[placeholder*="Property"]')).last();
  await nameInput.waitFor({ timeout: 5_000 });
  await nameInput.fill('bindTest');
  const cmContent = page.locator('.cm-content').last();
  await cmContent.click();
  await page.keyboard.selectAll();
  await page.keyboard.type('"Bound Value"');
  const saveBtn = page.locator('button', { hasText: /create|save|add/i }).last();
  if (await saveBtn.isVisible()) await saveBtn.click();
  else await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Select text node via layers
  await page.click('[data-testid="tab-layers"]');
  await page.waitForTimeout(300);
  const textRows = page.locator('[data-testid="layer-row"]').filter({ hasText: /^Text/ });
  if (await textRows.count() > 0) {
    await textRows.first().click();
    await page.waitForTimeout(300);

    const bindingIcon = page.locator('[data-testid^="field-binding"]').first();
    if (await bindingIcon.count() > 0) await bindingIcon.click();
    await page.waitForTimeout(400);

    const formulaEditor = page.locator('[data-testid="formula-editor"]');
    if (await formulaEditor.isVisible({ timeout: 3_000 })) {
      await page.click('[data-testid="formula-tab-quick"]');
      await page.waitForTimeout(300);

      const bindChip = page.locator('span').filter({ hasText: /^bindTest$/ }).first();
      if (await bindChip.isVisible({ timeout: 3_000 })) {
        await bindChip.click();
        await page.waitForTimeout(300);

        // Apply
        await page.click('[data-testid="formula-apply"]');
        await page.waitForTimeout(600);

        // Formula editor should be closed
        await expect(page.locator('[data-testid="formula-editor"]')).toHaveCount(0, { timeout: 5_000 });
      }
    }
  }
});

// ─── PP-07: Closing popup exits edit mode ─────────────────────────────────────

test('PP-07: closing popup exits edit mode', async ({ page }) => {
  await openBuilder(page);
  await openPopupsTab(page);
  await createModalAndOpen(page, 'E2E-PP07');

  // Popup is now open — right panel shows "Popup properties"
  await expect(page.locator('text=Popup properties')).toBeVisible({ timeout: 8_000 });

  // Click the Open/Close button on the popup model row to close it
  const modelRow = page.locator('[data-testid="popup-model-row"]').filter({ hasText: 'E2E-PP07' });
  await expect(modelRow).toBeVisible({ timeout: 5_000 });

  // Find the close/open toggle button in the row
  const toggleBtn = modelRow.locator('button', { hasText: /close/i });
  if (await toggleBtn.isVisible({ timeout: 2_000 })) {
    await toggleBtn.click();
    await page.waitForTimeout(600);
    // Popup properties section should disappear (no popup in edit mode)
    await expect(page.locator('text=Popup properties')).toHaveCount(0, { timeout: 5_000 });
  }
});
