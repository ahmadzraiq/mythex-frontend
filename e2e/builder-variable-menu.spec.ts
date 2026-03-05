/**
 * Builder — Variable ⋮ Menu E2E Tests (VAR series)
 *
 * VAR-01  Add a string variable — appears in Variables list
 * VAR-02  Add an object variable with valid JSON — saves successfully
 * VAR-03  Add an object variable with invalid JSON — Save is blocked, hint shown
 * VAR-04  ⋮ menu appears on a variable row
 * VAR-05  ⋮ menu Delete removes the variable
 * VAR-06  ⋮ menu Duplicate creates a copy with "_copy" suffix
 * VAR-07  ⋮ menu Duplicate twice creates "_copy" then "_copy2"
 * VAR-08  ⋮ menu Copy is present and clickable
 * VAR-09  Name validation — empty name shows warning and blocks save
 * VAR-10  Clicking a variable row opens the edit slide panel
 *
 * Run: npx playwright test e2e/builder-variable-menu.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder', { timeout: 60_000 });
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
  await page.waitForTimeout(500);
}

async function openAddVariable(page: Page) {
  const addBtn = page.locator('[data-testid="add-variable-btn"]');
  await expect(addBtn).toBeVisible({ timeout: 5_000 });
  await addBtn.click();
  await page.waitForSelector('[data-testid="var-name"]', { timeout: 5_000 });
}

async function addStringVariable(page: Page, name: string, value = 'hello') {
  await openAddVariable(page);
  await page.fill('[data-testid="var-name"]', name);
  // type is already string by default
  await page.fill('[data-testid="var-value"]', value);
  await page.click('[data-testid="var-save"]');
  await page.waitForTimeout(400);
}

async function openVarMenu(page: Page, name: string) {
  const menuBtn = page.locator(`[data-testid="var-menu-btn-${name}"]`);
  await expect(menuBtn).toBeVisible({ timeout: 5_000 });
  await menuBtn.click();
  await page.waitForTimeout(200);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('VAR — Variable ⋮ Menu', () => {
  test.setTimeout(75_000);

  test('VAR-01 add a string variable — appears in list', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await addStringVariable(page, 'myStrVar');
    await expect(page.locator('[data-testid="var-row-myStrVar"]')).toBeVisible({ timeout: 5_000 });
  });

  test('VAR-02 add object variable with valid JSON default — saves successfully', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await page.fill('[data-testid="var-name"]', 'myObjVar');

    // Select Object type — default value is {} which is valid JSON
    await page.selectOption('[data-testid="var-type"]', 'object');
    await page.waitForTimeout(800); // wait for CodeMirror to mount and validate

    // Default {} is valid — hint box must NOT appear
    await expect(page.locator('text=JSON and JavaScript')).not.toBeVisible({ timeout: 3_000 });

    // Save must be enabled
    const saveBtn = page.locator('[data-testid="var-save"]');
    await expect(saveBtn).not.toBeDisabled();
    await saveBtn.click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid="var-row-myObjVar"]')).toBeVisible({ timeout: 5_000 });
  });

  test('VAR-03 add object variable with invalid JSON — Save blocked, hint shown', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);
    await page.fill('[data-testid="var-name"]', 'badObjVar');
    await page.selectOption('[data-testid="var-type"]', 'object');
    await page.waitForTimeout(600);

    // Type invalid JSON
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('{invalid json here');

    // Hint box must appear
    await expect(page.locator('text=JSON and JavaScript')).toBeVisible({ timeout: 3_000 });

    // Save must be disabled
    const saveBtn = page.locator('[data-testid="var-save"]');
    await expect(saveBtn).toBeDisabled();
  });

  test('VAR-04 ⋮ menu appears on a variable row', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await addStringVariable(page, 'menuTestVar');
    const menuBtn = page.locator('[data-testid="var-menu-btn-menuTestVar"]');
    await expect(menuBtn).toBeVisible({ timeout: 5_000 });
  });

  test('VAR-05 ⋮ menu Delete removes the variable', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await addStringVariable(page, 'deleteMe');
    await expect(page.locator('[data-testid="var-row-deleteMe"]')).toBeVisible();

    await openVarMenu(page, 'deleteMe');
    await page.click('[data-testid="var-menu-delete-deleteMe"]');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid="var-row-deleteMe"]')).not.toBeVisible();
  });

  test('VAR-06 ⋮ menu Duplicate creates a _copy', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await addStringVariable(page, 'dupVar');

    await openVarMenu(page, 'dupVar');
    await page.click('[data-testid="var-menu-duplicate-dupVar"]');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid="var-row-dupVar_copy"]')).toBeVisible({ timeout: 5_000 });
  });

  test('VAR-07 ⋮ menu Duplicate twice creates _copy then _copy2', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await addStringVariable(page, 'dupVar2');

    // First duplicate
    await openVarMenu(page, 'dupVar2');
    await page.click('[data-testid="var-menu-duplicate-dupVar2"]');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="var-row-dupVar2_copy"]')).toBeVisible();

    // Second duplicate
    await openVarMenu(page, 'dupVar2');
    await page.click('[data-testid="var-menu-duplicate-dupVar2"]');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="var-row-dupVar2_copy2"]')).toBeVisible();
  });

  test('VAR-08 ⋮ menu Copy is present and clickable', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await addStringVariable(page, 'copyTestVar');
    await openVarMenu(page, 'copyTestVar');
    const copyBtn = page.locator('[data-testid="var-menu-copy-copyTestVar"]');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click(); // should not throw
  });

  test('VAR-09 empty name shows warning and blocks save', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await openAddVariable(page);

    // Touch the name field then clear it
    await page.click('[data-testid="var-name"]');
    await page.keyboard.press('Tab'); // trigger blur → nameTouched

    await expect(page.locator('text=A name is required.')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('[data-testid="var-save"]')).toBeDisabled();
  });

  test('VAR-10 clicking a variable row opens edit slide panel', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);
    await addStringVariable(page, 'editableVar', 'world');

    await page.click('[data-testid="var-row-editableVar"]');
    // Slide panel should open with the var name pre-filled and disabled
    const nameInput = page.locator('[data-testid="var-name"]');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await expect(nameInput).toHaveValue('editableVar');
    await expect(nameInput).toBeDisabled();
  });

});
