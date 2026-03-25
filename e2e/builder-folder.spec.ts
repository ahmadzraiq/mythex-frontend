/**
 * Builder — Folder System E2E Tests (FOLD series)
 *
 * FOLD-01  FolderPicker opens when clicking the Folder field in variable form
 * FOLD-02  "No folder" option is selected by default
 * FOLD-03  Create a top-level folder via "+ Create new folder"
 * FOLD-04  Created folder appears in the picker list
 * FOLD-05  Assign a folder to a variable — folder appears in list panel
 * FOLD-06  Variables without a folder appear above folder groups in the list
 * FOLD-07  Folder group is collapsible in the variable list
 * FOLD-08  Create a sub-folder under an existing folder
 * FOLD-09  Sub-folder appears nested under parent in the picker
 * FOLD-10  Assign folder to a DataSource — folder appears in DS list
 * FOLD-11  Confirm with Enter key creates folder inline
 * FOLD-12  Escape key cancels inline folder creation
 *
 * Run: npx playwright test e2e/builder-folder.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001', { timeout: 60_000 });
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 100 }
  );
  await page.waitForTimeout(1500);
}

async function openDataTab(page: Page) {
  const btn = page.locator('[data-testid="tab-data"], button').filter({ hasText: 'Data' }).first();
  await btn.click();
  await page.waitForSelector('[data-testid="data-tab-split"]', { timeout: 8_000 });
  await page.waitForTimeout(400);
}

async function openAddVariable(page: Page) {
  await page.click('[data-testid="add-variable-btn"]');
  await page.waitForSelector('[data-testid="var-name"]', { timeout: 5_000 });
}

async function saveVariable(page: Page, name: string) {
  await page.fill('[data-testid="var-name"]', name);
  await page.click('[data-testid="var-save"]');
  await page.waitForTimeout(400);
}

/** Open the folder picker inside the currently open slide panel */
async function openFolderPicker(page: Page) {
  // The FolderPicker trigger button contains "No folder" or a folder name
  const trigger = page.locator('button').filter({ hasText: /No folder|^[A-Z]/ }).first();
  await expect(trigger).toBeVisible({ timeout: 5_000 });
  await trigger.click();
  await page.waitForTimeout(300);
}

/** Click "+ Create new folder" in the picker and type a name */
async function createTopLevelFolder(page: Page, name: string) {
  await page.click('button:has-text("+ Create new folder")');
  await page.waitForTimeout(200);
  const input = page.locator('input[placeholder="New folder"]').last();
  await expect(input).toBeVisible({ timeout: 3_000 });
  await input.fill(name);
  // Confirm with ✓ button
  await page.locator('button').filter({ hasText: '✓' }).last().click();
  await page.waitForTimeout(300);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('FOLD — Folder System', () => {
  test.setTimeout(75_000);

  test('FOLD-01 FolderPicker opens on click in variable form', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await openFolderPicker(page);
    // Dropdown should show "NO FOLDER" header (exact match to avoid strict-mode multi-match)
    await expect(page.locator('text=NO FOLDER').first()).toBeVisible({ timeout: 3_000 });
  });

  test('FOLD-02 No folder is selected by default', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    // Trigger shows "No folder"
    const trigger = page.locator('button').filter({ hasText: 'No folder' }).first();
    await expect(trigger).toBeVisible({ timeout: 5_000 });
  });

  test('FOLD-03 Create a top-level folder via + Create new folder', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await openFolderPicker(page);
    await createTopLevelFolder(page, 'MyFolder');
    // Folder name should now appear in the dropdown
    await expect(page.locator('text=MyFolder').first()).toBeVisible({ timeout: 3_000 });
  });

  test('FOLD-04 Created folder appears selectable in picker', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await openFolderPicker(page);
    await createTopLevelFolder(page, 'PickerFolder');
    // Click the folder name to select it
    await page.locator('text=PickerFolder').first().click();
    await page.waitForTimeout(200);
    // Trigger button should now show the folder name
    const trigger = page.locator('button').filter({ hasText: 'PickerFolder' }).first();
    await expect(trigger).toBeVisible({ timeout: 3_000 });
  });

  test('FOLD-05 Variable assigned to folder appears under folder group in list', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    // Create folder and select it
    await openFolderPicker(page);
    await createTopLevelFolder(page, 'GroupedFolder');
    await page.locator('text=GroupedFolder').first().click();
    await page.waitForTimeout(200);
    // Save variable
    await saveVariable(page, 'groupedVar');
    // The folder label should appear in the variables list
    await expect(page.locator('[data-testid="variables-column"]').locator('text=GroupedFolder')).toBeVisible({ timeout: 5_000 });
    // The variable row should exist
    await expect(page.locator('[data-testid="var-row-groupedVar"]')).toBeVisible({ timeout: 3_000 });
  });

  test('FOLD-06 Variables without folder appear above folder groups', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    // Add an unfoldered variable first
    await openAddVariable(page);
    await saveVariable(page, 'unfolderedVar');

    // Add a foldered variable
    await openAddVariable(page);
    await openFolderPicker(page);
    await createTopLevelFolder(page, 'AboveFolder');
    await page.locator('text=AboveFolder').first().click();
    await page.waitForTimeout(200);
    await saveVariable(page, 'folderedVar');

    const varCol = page.locator('[data-testid="variables-column"]');
    const unfolderedBox = varCol.locator('[data-testid="var-row-unfolderedVar"]');
    const folderLabel = varCol.locator('text=AboveFolder');

    // Check unfolderedVar comes before the folder label in DOM order
    const unfolderedY = await unfolderedBox.boundingBox().then(b => b?.y ?? 0);
    const folderY = await folderLabel.boundingBox().then(b => b?.y ?? 0);
    expect(unfolderedY).toBeLessThan(folderY);
  });

  test('FOLD-07 Folder group is collapsible in variable list', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await openFolderPicker(page);
    await createTopLevelFolder(page, 'CollapseMe');
    await page.locator('text=CollapseMe').first().click();
    await page.waitForTimeout(200);
    await saveVariable(page, 'collapsedVar');

    const varCol = page.locator('[data-testid="variables-column"]');
    // Variable is visible initially (folder expanded by default)
    await expect(varCol.locator('[data-testid="var-row-collapsedVar"]')).toBeVisible();

    // Click the folder header to collapse
    await varCol.locator('text=CollapseMe').first().click();
    await page.waitForTimeout(200);

    // Variable row should now be hidden
    await expect(varCol.locator('[data-testid="var-row-collapsedVar"]')).not.toBeVisible();

    // Click again to expand
    await varCol.locator('text=CollapseMe').first().click();
    await page.waitForTimeout(200);
    await expect(varCol.locator('[data-testid="var-row-collapsedVar"]')).toBeVisible();
  });

  test('FOLD-08 Create a sub-folder under an existing folder', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await openFolderPicker(page);
    // Create parent folder
    await createTopLevelFolder(page, 'ParentFolder');
    // Expand the parent using its chevron
    await page.locator('button').filter({ hasText: '▶' }).first().click();
    await page.waitForTimeout(200);
    // Click + next to parent to add sub-folder
    await page.locator('text=ParentFolder').locator('..').locator('button[title="Add sub-folder"]').click();
    await page.waitForTimeout(200);
    const subInput = page.locator('input[placeholder="New folder"]').last();
    await expect(subInput).toBeVisible({ timeout: 3_000 });
    await subInput.fill('ChildFolder');
    await page.locator('button').filter({ hasText: '✓' }).last().click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=ChildFolder')).toBeVisible({ timeout: 3_000 });
  });

  test('FOLD-09 Sub-folder appears nested under parent in picker', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await openFolderPicker(page);
    await createTopLevelFolder(page, 'NestParent');
    // Expand it
    await page.locator('button').filter({ hasText: '▶' }).first().click();
    await page.waitForTimeout(200);
    // Add sub
    await page.locator('text=NestParent').locator('..').locator('button[title="Add sub-folder"]').click();
    await page.waitForTimeout(200);
    const subInput = page.locator('input[placeholder="New folder"]').last();
    await subInput.fill('NestChild');
    await page.locator('button').filter({ hasText: '✓' }).last().click();
    await page.waitForTimeout(300);
    // NestChild must be visible in the dropdown
    await expect(page.locator('text=NestChild').first()).toBeVisible({ timeout: 3_000 });
    // NestChild row should appear in the DOM after the NestParent row (sibling order)
    // Check via evaluate that NestParent precedes NestChild in document order
    const order = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('span, div'));
      const pi = all.findIndex(el => el.textContent?.trim() === 'NestParent');
      const ci = all.findIndex(el => el.textContent?.trim() === 'NestChild');
      return { pi, ci };
    });
    expect(order.ci).toBeGreaterThan(order.pi);
  });

  test('FOLD-10 Assign folder to a DataSource — folder appears in DS list', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    // Ensure data-sources section is expanded and scroll btn into view
    const addDsBtn = page.locator('[data-testid="add-datasource-btn"]');
    await expect(addDsBtn).toBeVisible({ timeout: 5_000 });
    await addDsBtn.scrollIntoViewIfNeeded();
    await addDsBtn.click();
    // Type picker appears first — select REST
    await page.waitForSelector('[data-testid="ds-pick-rest"]', { timeout: 8_000 });
    await page.click('[data-testid="ds-pick-rest"]');
    await page.waitForSelector('[data-testid="ds-name"]', { timeout: 8_000 });
    await page.fill('[data-testid="ds-name"]', 'myDsWithFolder');
    await page.fill('[data-testid="ds-url"]', 'https://jsonplaceholder.typicode.com/todos/1');
    // Open folder picker and create a folder
    const folderTrigger = page.locator('button').filter({ hasText: 'No folder' }).first();
    await folderTrigger.click();
    await page.waitForTimeout(300);
    await createTopLevelFolder(page, 'DsFolder');
    await page.locator('text=DsFolder').first().click();
    await page.waitForTimeout(200);
    // Save
    await page.locator('button').filter({ hasText: 'Save' }).first().click();
    await page.waitForTimeout(400);
    // DsFolder label should now appear in data sources column
    await expect(
      page.locator('[data-testid="data-sources-column"]').locator('text=DsFolder')
    ).toBeVisible({ timeout: 5_000 });
  });

  test('FOLD-11 Enter key confirms inline folder creation', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await openFolderPicker(page);
    await page.click('button:has-text("+ Create new folder")');
    const input = page.locator('input[placeholder="New folder"]').last();
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill('EnterFolder');
    await input.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator('text=EnterFolder')).toBeVisible({ timeout: 3_000 });
  });

  test('FOLD-12 Escape key cancels inline folder creation', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await openFolderPicker(page);
    await page.click('button:has-text("+ Create new folder")');
    const input = page.locator('input[placeholder="New folder"]').last();
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill('EscapeFolder');
    await input.press('Escape');
    await page.waitForTimeout(300);
    // Input should be gone and folder should NOT be created
    await expect(page.locator('text=EscapeFolder')).not.toBeVisible();
  });
});
