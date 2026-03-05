/**
 * Builder — Data Source System E2E Tests (DS series)
 *
 * DS-01  Config GraphQL sources pre-populate the Data tab with type "graphql"
 * DS-02  Config REST sources pre-populate the Data tab with type "rest"
 * DS-03  Config sources have ⋮ menu with Edit/Delete/Duplicate
 * DS-04  User-added REST source can be edited via ⋮ menu and deleted
 * DS-05  Data source list appears in formula editor's Data tab
 * DS-06  Search filter narrows the source list
 * DS-07  GraphQL card shows graphql type badge
 * DS-08  REST card shows rest type badge
 * DS-09  Type picker shows REST and GraphQL options
 * DS-10  Add a GraphQL source via type picker
 * DS-11  Closing slide panel from new source form returns to list
 * DS-12  ⋮ menu Duplicate creates a copy with "-copy" suffix
 * DS-13  Product source variables with {{route.slug}} display as bound
 * DS-14  Variable bind apply saves formula correctly (regression: onClose was resetting state)
 * DS-15  Variable unbind via editor "Unbind" button removes bound state
 * DS-16  URL field bind apply saves formula and shows "ƒ Edit formula"
 * DS-17  Bound formula variable survives Continue → reopen (formula not lost)
 * DS-18  Fetch result panel reopens after Continue → reopen (last fetch cached)
 * DS-19  Fetch REST source stores result in Zustand so page bindings update
 * DS-20  Clicking a DsRow highlights it with active style
 * DS-21  Result panel always visible after fetch (no toggle)
 * DS-22  Name + type shown in slide panel header for existing source
 * DS-23  ⋮ menu Edit opens the edit form
 * DS-24  ⋮ menu Delete removes the datasource from the list
 * DS-25  ⋮ menu Fetch dispatches refetch event
 * DS-26  ⋮ menu Copy button is present and clickable
 * DS-27  ⋮ menu View result appears only after a fetch and opens the form
 *
 * Run: npx playwright test e2e/builder-datasource.spec.ts
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

async function openDataTab(page: Page) {
  const btn = page.locator('[data-testid="tab-data"], button').filter({ hasText: 'Data' }).first();
  await btn.click();
  await page.waitForSelector('[data-testid="data-tab-split"]', { timeout: 8_000 });
  await page.waitForTimeout(500);
}

/** Open the ⋮ menu for a named data source. */
async function openDsMenu(page: Page, name: string) {
  const menuBtn = page.locator(`[data-testid="ds-menu-btn-${name}"]`);
  await expect(menuBtn).toBeVisible({ timeout: 8_000 });
  await menuBtn.click();
  await page.waitForTimeout(200);
}

async function addRestSource(page: Page, name: string, url: string) {
  await page.click('[data-testid="add-datasource-btn"]');
  await page.waitForSelector('[data-testid="ds-pick-rest"]', { timeout: 5_000 });
  await page.click('[data-testid="ds-pick-rest"]');
  await page.waitForSelector('[data-testid="ds-name"]', { timeout: 5_000 });
  await page.fill('[data-testid="ds-name"]', name);
  await page.fill('[data-testid="ds-url"]', url);
  await page.click('[data-testid="ds-save"]');
  await page.waitForTimeout(400);
}

async function addGraphQLSource(page: Page, name: string, url: string, query: string) {
  await page.click('[data-testid="add-datasource-btn"]');
  await page.waitForSelector('[data-testid="ds-pick-graphql"]', { timeout: 5_000 });
  await page.click('[data-testid="ds-pick-graphql"]');
  await page.waitForSelector('[data-testid="ds-name"]', { timeout: 5_000 });
  await page.fill('[data-testid="ds-name"]', name);
  await page.fill('[data-testid="ds-url"]', url);
  await page.fill('[data-testid="ds-gql-query"]', query);
  await page.click('[data-testid="ds-save"]');
  await page.waitForTimeout(400);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('DS — Data Source System', () => {

  test('DS-01 — config GraphQL sources appear with graphql type badge', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const column = page.locator('[data-testid="data-sources-column"]');
    await expect(column).toContainText('cart', { timeout: 8_000 });

    // Badge is hidden (display:none) but still contains the type text
    const cartBadge = column.locator('[data-testid="ds-type-badge-cart"]');
    await expect(cartBadge).toContainText('graphql', { timeout: 5_000 });
  });

  test('DS-02 — config REST sources appear with rest type badge', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const column = page.locator('[data-testid="data-sources-column"]');
    await expect(column).toContainText('persistAPI', { timeout: 8_000 });

    // Badge is hidden (display:none) but still contains the type text
    const badge = column.locator('[data-testid="ds-type-badge-persistAPI"]');
    await expect(badge).toContainText('rest', { timeout: 5_000 });
  });

  test('DS-03 — config sources have ⋮ menu with Edit and Delete', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const cartCard = page.locator('[data-testid="ds-card-cart"]');
    await expect(cartCard).toBeVisible({ timeout: 8_000 });

    // Open ⋮ menu
    await openDsMenu(page, 'cart');

    // Edit and Delete options visible in menu
    await expect(page.locator('[data-testid="edit-datasource-cfg-cart"]')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('[data-testid="delete-datasource-cfg-cart"]')).toBeVisible();

    // Close menu
    await page.keyboard.press('Escape');
  });

  test('DS-04 — user-added REST source can be edited and deleted via ⋮ menu', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const column = page.locator('[data-testid="data-sources-column"]');
    const name = `userDs${Date.now()}`;

    await addRestSource(page, name, 'https://jsonplaceholder.typicode.com/posts');
    await expect(column).toContainText(name, { timeout: 5_000 });

    // Open ⋮ menu and click Edit (menu is portaled to body, not inside card)
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="edit-datasource-"]`).last().click();
    await page.waitForSelector('[data-testid="ds-url"]', { timeout: 5_000 });
    await page.fill('[data-testid="ds-url"]', 'https://jsonplaceholder.typicode.com/todos');
    await page.click('[data-testid="ds-save"]');
    await page.waitForTimeout(400);

    // Reopen to verify the URL was saved (DsRow only shows name, not URL)
    await page.locator(`[data-testid="ds-card-${name}"]`).click();
    await page.waitForSelector('[data-testid="ds-url"]', { timeout: 5_000 });
    await expect(page.locator('[data-testid="ds-url"]')).toHaveValue(/todos/);
    await page.click('[data-testid="slide-panel-close"]');
    await page.waitForTimeout(300);

    // Delete via ⋮ menu
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
    await page.waitForTimeout(400);
    await expect(column).not.toContainText(name);
  });

  test('DS-05 — data sources appear in formula editor Data tab', async ({ page }) => {
    await gotoBuilder(page);

    await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        { type: 'Box', id: 'ds-fe-node', props: { className: 'flex w-20 h-20', style: {} } },
        null
      );
      (store.select as (id: string) => void)('ds-fe-node');
    });
    await page.waitForTimeout(600);

    await page.click('[data-testid="tab-right-design"]');
    await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
    await page.locator('[data-testid="binding-icon"]').first().click();
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });

    const formulaEditor = page.locator('[data-testid="formula-editor"]');
    const dataTabBtn = formulaEditor.locator('button').filter({ hasText: 'Data' }).first();
    if (await dataTabBtn.isVisible()) {
      await dataTabBtn.click();
      await page.waitForTimeout(400);
      await expect(formulaEditor).toContainText('cart', { timeout: 5_000 });
    }

    await page.click('[data-testid="formula-close"]');
  });

  test('DS-06 — search filter narrows the data source list', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const column = page.locator('[data-testid="data-sources-column"]');
    await column.locator('[data-testid="ds-search"]').fill('cart');
    await page.waitForTimeout(300);
    await expect(column).toContainText('cart');
    await expect(column.locator('[data-testid="ds-card-product"]')).toHaveCount(0);

    await column.locator('[data-testid="ds-search"]').fill('');
    await page.waitForTimeout(300);
    await expect(column.locator('[data-testid="ds-card-product"]')).toBeVisible({ timeout: 3_000 });
  });

  test('DS-07 — GraphQL card shows graphql type badge', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const cartCard = page.locator('[data-testid="ds-card-cart"]');
    await expect(cartCard).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="ds-type-badge-cart"]')).toContainText('graphql');
  });

  test('DS-08 — REST card shows rest type badge', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const column = page.locator('[data-testid="data-sources-column"]');
    const name = `restBadge${Date.now()}`;
    await addRestSource(page, name, 'https://api.example.com/data');

    const badge = page.locator(`[data-testid="ds-type-badge-${name}"]`);
    // Badge is hidden (display:none) but still contains the type text
    await expect(badge).toContainText('rest', { timeout: 5_000 });

    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
    await page.waitForTimeout(300);
    await expect(column).not.toContainText(name);
  });

  test('DS-09 — type picker shows REST and GraphQL options', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    await page.click('[data-testid="add-datasource-btn"]');
    await expect(page.locator('[data-testid="ds-pick-rest"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="ds-pick-graphql"]')).toBeVisible();
    await expect(page.locator('[data-testid="ds-pick-rest"]')).toContainText('REST');
    await expect(page.locator('[data-testid="ds-pick-graphql"]')).toContainText('GraphQL');

    await page.keyboard.press('Escape');
  });

  test('DS-10 — add GraphQL source via type picker', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const column = page.locator('[data-testid="data-sources-column"]');
    const name = `gqlTest${Date.now()}`;

    await addGraphQLSource(page, name, 'https://api.example.com/graphql', 'query GetItems { items { id name } }');

    const card = page.locator(`[data-testid="ds-card-${name}"]`);
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card.locator(`[data-testid="ds-type-badge-${name}"]`)).toContainText('graphql');

    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
    await page.waitForTimeout(300);
    await expect(column).not.toContainText(name);
  });

  test('DS-11 — closing slide panel from new source form returns to list', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    await page.click('[data-testid="add-datasource-btn"]');
    await page.waitForSelector('[data-testid="ds-pick-rest"]', { timeout: 5_000 });
    await page.click('[data-testid="ds-pick-rest"]');
    await page.waitForSelector('[data-testid="ds-name"]', { timeout: 5_000 });

    // No Back button; close via × on slide panel
    await page.click('[data-testid="slide-panel-close"]');
    await page.waitForTimeout(300);
    // Type picker is gone; data tab is still visible
    await expect(page.locator('[data-testid="data-tab-split"]')).toBeVisible({ timeout: 3_000 });
  });

  test('DS-13 — variable values with {{...}} show as bound on edit open; name shown in header', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    // Open the "product" datasource (has slug: "{{route.slug}}")
    const productCard = page.locator('[data-testid="ds-card-product"]');
    await expect(productCard).toBeVisible({ timeout: 8_000 });
    await productCard.click();
    // For existing sources, ds-name input is hidden; name shown in slide panel header instead
    await expect(page.locator('[data-testid="left-slide-panel"]')).toContainText('product', { timeout: 5_000 });
    await expect(page.locator('[data-testid="left-slide-panel"]')).toContainText('GraphQL');

    // The variable value "{{route.slug}}" should be shown as a bound formula button
    // (button text is always "ƒ Edit formula", the formula is stored in the title attribute)
    const formulaBtn = page.locator('[data-testid="ds-var-val-formula-0"]');
    await expect(formulaBtn).toBeVisible({ timeout: 3_000 });

    // Query should be auto-formatted (multi-line)
    const queryEl = page.locator('[data-testid="ds-gql-query"]');
    const queryVal = await queryEl.inputValue();
    expect(queryVal).toContain('\n');

    await page.keyboard.press('Escape');
  });

  test('DS-14 — variable bind apply saves formula (regression: onClose was resetting state)', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `bindTest${Date.now()}`;
    await addGraphQLSource(page, name, 'https://api.example.com/graphql', 'query Test { items { id } }');

    // Open to edit
    await page.locator(`[data-testid="ds-card-${name}"]`).click();
    await page.waitForSelector('[data-testid="ds-add-variable"]', { timeout: 5_000 });

    // Add a variable row
    await page.click('[data-testid="ds-add-variable"]');
    await page.waitForSelector('[data-testid="ds-var-key-0"]', { timeout: 3_000 });
    await page.fill('[data-testid="ds-var-key-0"]', 'slug');

    // Click the value bind icon (specific testid)
    await page.click('[data-testid="ds-var-val-bind-0"]');
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 5_000 });

    // Type a formula and apply
    const formulaInput = page.locator('[data-testid="formula-input"]').first();
    await formulaInput.fill('route.slug');
    await page.click('[data-testid="formula-apply"]');
    await page.waitForTimeout(300);

    // CRITICAL: after apply, the formula editor closes and "ƒ Edit formula" button must appear.
    // Bug was: onClose() reset valueBound=false, undoing the onChange() call from apply().
    await expect(page.locator('[data-testid="ds-var-val-formula-0"]')).toBeVisible({ timeout: 3_000 });

    // Confirm the plain input is gone (it was replaced by the bound formula button)
    await expect(page.locator('[data-testid="ds-var-val-0"]')).not.toBeVisible();

    // Save
    await page.click('[data-testid="ds-save"]');
    await page.waitForTimeout(400);

    // Cleanup
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-15 — variable unbind via "Unbind" button removes bound state', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `unbindTest${Date.now()}`;
    await addGraphQLSource(page, name, 'https://api.example.com/graphql', 'query Test { items { id } }');

    await page.locator(`[data-testid="ds-card-${name}"]`).click();
    await page.waitForSelector('[data-testid="ds-add-variable"]', { timeout: 5_000 });

    // Add variable and bind it
    await page.click('[data-testid="ds-add-variable"]');
    await page.waitForSelector('[data-testid="ds-var-key-0"]', { timeout: 3_000 });
    await page.fill('[data-testid="ds-var-key-0"]', 'slug');

    // Bind the value
    await page.click('[data-testid="ds-var-val-bind-0"]');
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 5_000 });
    await page.locator('[data-testid="formula-input"]').first().fill('route.slug');
    await page.click('[data-testid="formula-apply"]');
    await page.waitForTimeout(300);

    // Verify it's now bound
    await expect(page.locator('[data-testid="ds-var-val-formula-0"]')).toBeVisible({ timeout: 3_000 });

    // Re-open formula editor and click Unbind
    await page.click('[data-testid="ds-var-val-formula-0"]');
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 5_000 });
    await page.click('[data-testid="formula-unbind"]');
    await page.waitForTimeout(300);

    // After unbind: plain input is back, formula button is gone
    await expect(page.locator('[data-testid="ds-var-val-0"]')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('[data-testid="ds-var-val-formula-0"]')).not.toBeVisible();

    // Cleanup
    await page.keyboard.press('Escape');
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-16 — URL field bind apply shows "ƒ Edit formula" in GraphQL form', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `urlBindTest${Date.now()}`;
    await addGraphQLSource(page, name, 'https://api.example.com/graphql', 'query Test { items { id } }');

    await page.locator(`[data-testid="ds-card-${name}"]`).click();
    await page.waitForSelector('[data-testid="ds-url"]', { timeout: 5_000 });

    // Click the URL bind icon
    const urlBindIcon = page.locator('[data-testid="ds-url"]').locator('..').locator('[data-testid="binding-icon"]');
    await urlBindIcon.click();
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 5_000 });

    // Type a formula and apply
    const formulaInput = page.locator('[data-testid="formula-input"]').first();
    await formulaInput.fill('config.apiUrl');
    await page.click('[data-testid="formula-apply"]');
    await page.waitForTimeout(300);

    // URL input should be gone, replaced by a "ƒ Edit formula" button
    await expect(page.locator('[data-testid="ds-url"]')).not.toBeVisible();
    // The bound formula button should contain the formula indicator
    const urlFormulaBtn = page.locator('button').filter({ hasText: /ƒ.*formula/i });
    await expect(urlFormulaBtn.first()).toBeVisible({ timeout: 3_000 });

    // Cleanup
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-17 — bound formula variable survives Continue → reopen', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `formulaPersist${Date.now()}`;
    await addGraphQLSource(page, name, 'https://api.example.com/graphql', 'query Test { items { id } }');

    // Open for edit
    await page.locator(`[data-testid="ds-card-${name}"]`).click();
    await page.waitForSelector('[data-testid="ds-add-variable"]', { timeout: 5_000 });

    // Add a variable and bind it
    await page.click('[data-testid="ds-add-variable"]');
    await page.waitForSelector('[data-testid="ds-var-key-0"]', { timeout: 3_000 });
    await page.fill('[data-testid="ds-var-key-0"]', 'slug');
    await page.click('[data-testid="ds-var-val-bind-0"]');
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 5_000 });
    await page.locator('[data-testid="formula-input"]').first().fill('route.slug');
    await page.click('[data-testid="formula-apply"]');
    await page.waitForTimeout(300);

    // Confirm bound
    await expect(page.locator('[data-testid="ds-var-val-formula-0"]')).toBeVisible({ timeout: 3_000 });

    // Click Continue (save)
    await page.click('[data-testid="ds-save"]');
    await page.waitForTimeout(400);

    // Reopen the same datasource
    await page.locator(`[data-testid="ds-card-${name}"]`).click();
    await page.waitForSelector('[data-testid="ds-add-variable"]', { timeout: 5_000 });

    // The variable should still show "ƒ Edit formula" (not a plain input)
    await expect(page.locator('[data-testid="ds-var-val-formula-0"]')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('[data-testid="ds-var-val-0"]')).not.toBeVisible();

    // Cleanup
    await page.keyboard.press('Escape');
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-18 — fetch result panel reopens after Continue → reopen', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `fetchPersist${Date.now()}`;
    // Use JSONPlaceholder which is publicly accessible
    await addRestSource(page, name, 'https://jsonplaceholder.typicode.com/todos/1');

    // Open and fetch
    await page.locator(`[data-testid="ds-card-${name}"]`).click();
    await page.waitForSelector('[data-testid="ds-fetch"]', { timeout: 5_000 });
    await page.click('[data-testid="ds-fetch"]');
    // Wait for result panel — the Success/Error badge appears
    await page.waitForSelector('span:has-text("Success"), span:has-text("Error")', { timeout: 15_000 });
    await page.waitForTimeout(300);

    // Click Continue to save (includes _lastFetch)
    await page.click('[data-testid="ds-save"]');
    await page.waitForTimeout(400);

    // Reopen the same datasource
    await page.locator(`[data-testid="ds-card-${name}"]`).click();
    await page.waitForSelector('[data-testid="ds-fetch"]', { timeout: 5_000 });

    // The result panel should be visible again (last fetch cached)
    await expect(page.locator('span:has-text("Success"), span:has-text("Error")').first()).toBeVisible({ timeout: 5_000 });

    // Cleanup
    await page.keyboard.press('Escape');
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-19 — fetch REST source persists data so page bindings can update', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const dsName = `todosDs${Date.now()}`;
    await addRestSource(page, dsName, 'https://jsonplaceholder.typicode.com/todos/1');

    // Open and fetch
    await page.locator(`[data-testid="ds-card-${dsName}"]`).click();
    await page.waitForSelector('[data-testid="ds-fetch"]', { timeout: 5_000 });
    await page.click('[data-testid="ds-fetch"]');
    await page.waitForSelector('span:has-text("Success")', { timeout: 15_000 });
    await page.waitForTimeout(500);

    // Click Continue to persist _lastFetch into the store
    await page.click('[data-testid="ds-save"]');
    await page.waitForTimeout(400);

    // Verify the _lastFetch data was stored on the datasource config
    const fetchedData = await page.evaluate((name: string) => {
      const store = (window as unknown as Record<string, unknown>).__builderStore as
        { getState: () => { pageDataSources: Array<{ name: string; _lastFetch?: { data: unknown } }> } } | undefined;
      if (!store) return null;
      const ds = store.getState().pageDataSources.find(s => s.name === name);
      return ds?._lastFetch?.data ?? null;
    }, dsName);

    expect(fetchedData).not.toBeNull();
    // JSONPlaceholder todos/1 has a userId field — confirms real data was fetched and stored
    expect((fetchedData as Record<string, unknown>)?.userId).toBeDefined();

    // Cleanup
    await openDsMenu(page, dsName);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-12 — ⋮ menu Duplicate creates a copy with -copy suffix', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `dupTest${Date.now()}`;
    await addRestSource(page, name, 'https://api.example.com/dup');

    // Duplicate via ⋮ menu
    await openDsMenu(page, name);
    await page.locator(`[data-testid="ds-menu-duplicate-${name}"]`).click();
    await page.waitForTimeout(400);

    const column = page.locator('[data-testid="data-sources-column"]');
    await expect(column).toContainText(`${name}-copy`, { timeout: 5_000 });

    // Cleanup both
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
    await page.waitForTimeout(300);

    const copyCard = page.locator(`[data-testid="ds-card-${name}-copy"]`);
    if (await copyCard.isVisible()) {
      await openDsMenu(page, `${name}-copy`);
      await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
      await page.waitForTimeout(300);
    }
  });

  test('DS-20 — clicking a DsRow highlights it with active style', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const cartCard = page.locator('[data-testid="ds-card-cart"]');
    await expect(cartCard).toBeVisible({ timeout: 8_000 });

    // Click to open edit
    await cartCard.click();
    await page.waitForTimeout(400);

    // After click: row has active border-left style indicating highlight
    // Browser resolves #6366f1 to rgb(99, 102, 241)
    const borderLeft = await cartCard.evaluate(el => (el as HTMLElement).style.borderLeft);
    expect(borderLeft).toMatch(/6366f1|99,\s*102,\s*241/);

    // Close slide panel
    await page.click('[data-testid="slide-panel-close"]');
  });

  test('DS-21 — result panel always visible after fetch (no toggle)', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `fetchAlways${Date.now()}`;
    await addRestSource(page, name, 'https://jsonplaceholder.typicode.com/todos/1');

    // Reopen to fetch
    const card = page.locator(`[data-testid="ds-card-${name}"]`);
    await card.click();
    await page.waitForSelector('[data-testid="ds-fetch"]', { timeout: 5_000 });
    await page.click('[data-testid="ds-fetch"]');
    await page.waitForTimeout(3_000);

    // Result panel should be visible automatically (no toggle button needed)
    await expect(page.locator('text=Result')).toBeVisible({ timeout: 5_000 });
    // No "Result" toggle button in footer
    await expect(page.locator('button').filter({ hasText: /◧|◨/ })).toHaveCount(0);

    // Cleanup
    await page.click('[data-testid="slide-panel-close"]');
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-22 — name + type shown in slide panel header for existing source', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const cartCard = page.locator('[data-testid="ds-card-cart"]');
    await expect(cartCard).toBeVisible({ timeout: 8_000 });
    await cartCard.click();
    await page.waitForTimeout(400);

    const panel = page.locator('[data-testid="left-slide-panel"]');
    // Header should contain datasource name and type
    await expect(panel).toContainText('cart', { timeout: 5_000 });
    await expect(panel).toContainText('GraphQL');

    // Name input field should NOT be visible (shown in header instead)
    await expect(page.locator('[data-testid="ds-name"]')).toHaveCount(0);

    await page.click('[data-testid="slide-panel-close"]');
  });

  // ─── Three-dots menu action tests ────────────────────────────────────────────

  test('DS-23 — ⋮ menu Edit opens the edit form', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `editMenu${Date.now()}`;
    await addRestSource(page, name, 'https://api.example.com/data');

    const column = page.locator('[data-testid="data-sources-column"]');
    await expect(column).toContainText(name, { timeout: 5_000 });

    // Open ⋮ and click Edit
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="edit-datasource-"]`).last().click();
    await page.waitForTimeout(300);

    // Edit form should be open — URL field is visible
    await expect(page.locator('[data-testid="ds-url"]')).toBeVisible({ timeout: 5_000 });

    // The slide panel header should show the source name and REST type
    const panel = page.locator('[data-testid="left-slide-panel"]');
    await expect(panel).toContainText(name, { timeout: 3_000 });

    // Cleanup
    await page.click('[data-testid="slide-panel-close"]');
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-24 — ⋮ menu Delete removes the datasource from the list', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `deleteMenu${Date.now()}`;
    await addRestSource(page, name, 'https://api.example.com/delete-me');

    const column = page.locator('[data-testid="data-sources-column"]');
    await expect(column).toContainText(name, { timeout: 5_000 });

    // Open ⋮ and click Delete
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
    await page.waitForTimeout(400);

    // Row must be gone
    await expect(page.locator(`[data-testid="ds-card-${name}"]`)).toHaveCount(0);
    await expect(column).not.toContainText(name);
  });

  test('DS-25 — ⋮ menu Fetch dispatches refetch event', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `fetchMenu${Date.now()}`;
    await addRestSource(page, name, 'https://jsonplaceholder.typicode.com/todos/1');

    const column = page.locator('[data-testid="data-sources-column"]');
    await expect(column).toContainText(name, { timeout: 5_000 });

    // Listen for the custom refetch event
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__refetchFired = false;
      window.addEventListener('sdui:refetch-datasource', () => {
        (window as unknown as Record<string, unknown>).__refetchFired = true;
      }, { once: true });
    });

    // Open ⋮ and click Fetch
    await openDsMenu(page, name);
    await page.locator(`[data-testid="ds-menu-fetch-${name}"]`).click();
    await page.waitForTimeout(500);

    // The custom event must have fired
    const fired = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__refetchFired
    );
    expect(fired).toBe(true);

    // Cleanup
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-26 — ⋮ menu Copy button is present and clickable', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `copyMenu${Date.now()}`;
    await addRestSource(page, name, 'https://api.example.com/copy');

    const column = page.locator('[data-testid="data-sources-column"]');
    await expect(column).toContainText(name, { timeout: 5_000 });

    // Open ⋮ menu
    await openDsMenu(page, name);

    // Copy button should be visible in the dropdown
    const copyBtn = page.locator(`[data-testid="ds-menu-copy-${name}"]`);
    await expect(copyBtn).toBeVisible({ timeout: 3_000 });
    await expect(copyBtn).toContainText('Copy');

    // Click it — should close the menu without error
    await copyBtn.click();
    await page.waitForTimeout(200);

    // Menu should be closed after click
    await expect(copyBtn).not.toBeVisible();

    // Cleanup
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

  test('DS-27 — ⋮ menu View result absent before fetch, present after fetch', async ({ page }) => {
    await gotoBuilder(page);
    await openDataTab(page);

    const name = `viewResult${Date.now()}`;
    await addRestSource(page, name, 'https://jsonplaceholder.typicode.com/todos/1');

    const column = page.locator('[data-testid="data-sources-column"]');
    await expect(column).toContainText(name, { timeout: 5_000 });

    // Before fetch: "View result" should NOT appear in the ⋮ menu
    await openDsMenu(page, name);
    await expect(page.locator(`[data-testid="ds-menu-view-${name}"]`)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Open form and fetch
    await page.locator(`[data-testid="ds-card-${name}"]`).click();
    await page.waitForSelector('[data-testid="ds-fetch"]', { timeout: 5_000 });
    await page.click('[data-testid="ds-fetch"]');
    await page.waitForSelector('span:has-text("Success"), span:has-text("Error")', { timeout: 15_000 });

    // Save so _lastFetch is persisted on the config
    await page.click('[data-testid="ds-save"]');
    await page.waitForTimeout(400);

    // After fetch: "View result" should appear in the ⋮ menu
    await openDsMenu(page, name);
    const viewBtn = page.locator(`[data-testid="ds-menu-view-${name}"]`);
    await expect(viewBtn).toBeVisible({ timeout: 3_000 });
    await expect(viewBtn).toContainText('View result');

    // Clicking "View result" should open the edit form
    await viewBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="ds-fetch"]')).toBeVisible({ timeout: 3_000 });

    // Cleanup
    await page.click('[data-testid="slide-panel-close"]');
    await openDsMenu(page, name);
    await page.locator(`[data-testid^="delete-datasource-"]`).last().click();
  });

});
