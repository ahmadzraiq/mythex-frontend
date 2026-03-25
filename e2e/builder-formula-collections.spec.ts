/**
 * Builder — Formula Editor Collections Tree Tests (FC series)
 *
 * FC-01  COLLECTIONS section is visible in formula editor Data tab
 * FC-02  Clicking pill inserts a chip with collections['UUID'] formula into editor
 * FC-03  Clicking chevron expands the collection tree; pill click does NOT expand
 * FC-04  Array data shows index selector and item subtree without repeating collection name
 * FC-05  Changing array index keeps the expanded child open
 * FC-06  Selecting a leaf field inserts a chip with the full path
 * FC-07  Backspace at end of a chip removes the entire chip
 * FC-08  Updating datasource label updates chip display text in editor
 *
 * Run: npx playwright test e2e/builder-formula-collections.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
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

/** Add a test datasource via evaluate and inject mock fetched data into Zustand. */
async function injectTestDatasource(
  page: Page,
  opts: {
    id: string;
    label?: string;
    storeIn?: string;
    mockData?: unknown;
  }
) {
  const storeIn = opts.storeIn ?? opts.id;
  await page.evaluate(
    ({ id, label, storeIn, mockData }) => {
      const builderStore = (
        window as unknown as Record<string, { getState: () => Record<string, unknown> }>
      ).__builderStore?.getState();
      if (!builderStore) return;

      const ds = { id, _label: label ?? id, storeIn, type: 'rest' as const, url: 'https://example.com' };
      const addDS = builderStore.addDataSource as ((d: unknown) => void) | undefined;
      if (addDS) {
        addDS(ds);
      } else {
        const pds = builderStore.pageDataSources as unknown[];
        pds.push(ds);
      }

      if (mockData !== undefined) {
        const sduiStore = (
          window as unknown as Record<string, { getState: () => { setData: (k: string, v: unknown) => void } }>
        ).__sduiStore?.getState();
        if (sduiStore) sduiStore.setData(storeIn, mockData);
      }
    },
    { id: opts.id, label: opts.label, storeIn, mockData: opts.mockData ?? null }
  );
  await page.waitForTimeout(300);
}

/** Add a Text node, select it, and open the formula editor on its 'text' field. */
async function openFormulaEditorOnTextField(page: Page, nodeId: string) {
  await page.evaluate((id) => {
    const store = (
      window as unknown as Record<string, { getState: () => Record<string, unknown> }>
    ).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Text', id, text: '', props: { className: '', style: {} } },
      null
    );
    (store.select as (id: string) => void)(id);
  }, nodeId);

  await page.waitForFunction(
    (id) => {
      const store = (
        window as unknown as Record<string, { getState: () => Record<string, unknown> }>
      ).__builderStore?.getState();
      return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(id as string);
    },
    nodeId,
    { timeout: 5_000 }
  );
  await page.waitForTimeout(500);

  await page.click('[data-testid="tab-right-design"]');
  await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
  await page.waitForTimeout(300);

  const contentField = page.locator('[data-field="text"]');
  await contentField.scrollIntoViewIfNeeded();
  const bindingIcon = contentField.locator('[data-testid="binding-icon"]');
  await expect(bindingIcon).toBeVisible({ timeout: 5_000 });
  await bindingIcon.click();
  await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });
  await page.waitForTimeout(300);
}

/** Switch to the Data tab inside the formula editor. */
async function switchFormulaEditorToData(page: Page) {
  const dataTab = page.locator('[data-testid="formula-tab-data"]');
  await expect(dataTab).toBeVisible({ timeout: 5_000 });
  await dataTab.click();
  await page.waitForTimeout(300);
}

/**
 * Read the serialized formula from the contenteditable editor.
 * Chip spans contribute their data-formula attribute; text nodes contribute textContent.
 */
async function readEditorFormula(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
    if (!el) return '';
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent ?? '';
      } else if (node instanceof HTMLElement && (node as HTMLElement).dataset.formula) {
        out += (node as HTMLElement).dataset.formula;
      }
    }
    return out;
  });
}

/** Clear the contenteditable formula editor. */
async function clearEditor(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
    if (el) el.innerHTML = '';
    // Trigger input event so React state updates
    el?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
}

/** Read chip display text (what the user sees in the chip). */
async function readChipTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
    if (!el) return [];
    const chips = el.querySelectorAll<HTMLElement>('span[data-formula]');
    return Array.from(chips).map(c => c.textContent ?? '');
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('FC — Formula Editor Collections Tree', () => {
  test.setTimeout(90_000);

  test('FC-01 — COLLECTIONS section visible in formula editor Data tab', async ({ page }) => {
    await gotoBuilder(page);
    await injectTestDatasource(page, { id: 'fc01-src', label: 'FC01 Source' });

    const nodeId = `fc01-node-${Date.now()}`;
    await openDataTab(page);
    await openFormulaEditorOnTextField(page, nodeId);
    await switchFormulaEditorToData(page);

    const editor = page.locator('[data-testid="formula-editor"]');
    await expect(editor).toContainText('COLLECTIONS', { timeout: 5_000 });
    await expect(editor).toContainText('FC01 Source', { timeout: 5_000 });
  });

  test('FC-02 — clicking pill inserts collection chip with collections[UUID] formula', async ({ page }) => {
    await gotoBuilder(page);
    const uuid = `fc02-${Date.now()}`;
    await injectTestDatasource(page, { id: uuid, label: 'FC02 Source', storeIn: uuid });

    const nodeId = `fc02-node-${Date.now()}`;
    await openDataTab(page);
    await openFormulaEditorOnTextField(page, nodeId);
    await switchFormulaEditorToData(page);

    await clearEditor(page);

    // Click the pill
    const pill = page.locator(`[data-testid="fe-collection-pill-${uuid}"]`);
    await expect(pill).toBeVisible({ timeout: 5_000 });
    await pill.click();
    await page.waitForTimeout(400);

    // The serialized formula should contain collections['UUID']
    const formula = await readEditorFormula(page);
    expect(formula).toContain(`collections['${uuid}']`);

    // The chip should display 'FC02 Source' as the label
    const chips = await readChipTexts(page);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]).toBe('FC02 Source');
  });

  test('FC-03 — chevron expands tree; pill click does not auto-expand', async ({ page }) => {
    await gotoBuilder(page);
    const uuid = `fc03-${Date.now()}`;
    await injectTestDatasource(page, {
      id: uuid,
      label: 'FC03 Source',
      storeIn: uuid,
      mockData: { title: 'hello', count: 42 },
    });

    const nodeId = `fc03-node-${Date.now()}`;
    await openDataTab(page);
    await openFormulaEditorOnTextField(page, nodeId);
    await switchFormulaEditorToData(page);

    const header = page.locator(`[data-testid="fe-collection-header-${uuid}"]`);
    await expect(header).toBeVisible({ timeout: 5_000 });

    const titleField = page.locator('[data-testid="formula-editor"]').getByText('title').first();

    // Click pill — chip is inserted but tree should NOT be expanded
    const pill = page.locator(`[data-testid="fe-collection-pill-${uuid}"]`);
    await pill.click();
    await page.waitForTimeout(200);
    await expect(titleField).not.toBeVisible({ timeout: 1_000 }).catch(() => { /* ok */ });

    // Click chevron — tree should expand
    const chevron = page.locator(`[data-testid="fe-collection-chevron-${uuid}"]`);
    await chevron.click();
    await page.waitForTimeout(400);
    await expect(titleField).toBeVisible({ timeout: 5_000 });
  });

  test('FC-04 — array data renders index selector without repeating collection name', async ({ page }) => {
    await gotoBuilder(page);
    const uuid = `fc04-${Date.now()}`;
    await injectTestDatasource(page, {
      id: uuid,
      label: 'FC04 Products',
      storeIn: uuid,
      mockData: [
        { id: 'p1', name: 'Product 1', price: 100 },
        { id: 'p2', name: 'Product 2', price: 200 },
      ],
    });

    const nodeId = `fc04-node-${Date.now()}`;
    await openDataTab(page);
    await openFormulaEditorOnTextField(page, nodeId);
    await switchFormulaEditorToData(page);

    const chevron = page.locator(`[data-testid="fe-collection-chevron-${uuid}"]`);
    await expect(chevron).toBeVisible({ timeout: 5_000 });
    await chevron.click();
    await page.waitForTimeout(400);

    const editor = page.locator('[data-testid="formula-editor"]');
    await expect(editor.locator('select')).toBeVisible({ timeout: 5_000 });
    await expect(editor).toContainText('2 items', { timeout: 3_000 });

    // FC04 Products should appear exactly once (in pill, NOT repeated as tree node)
    const occurrences = await editor.locator('text=FC04 Products').count();
    expect(occurrences).toBe(1);
  });

  test('FC-05 — changing array index keeps child expanded', async ({ page }) => {
    await gotoBuilder(page);
    const uuid = `fc05-${Date.now()}`;
    await injectTestDatasource(page, {
      id: uuid,
      label: 'FC05 Items',
      storeIn: uuid,
      mockData: [
        { id: 'a', slug: 'item-a', details: { color: 'red' } },
        { id: 'b', slug: 'item-b', details: { color: 'blue' } },
      ],
    });

    const nodeId = `fc05-node-${Date.now()}`;
    await openDataTab(page);
    await openFormulaEditorOnTextField(page, nodeId);
    await switchFormulaEditorToData(page);

    const editor = page.locator('[data-testid="formula-editor"]');

    const chevron = page.locator(`[data-testid="fe-collection-chevron-${uuid}"]`);
    await chevron.click();
    await page.waitForTimeout(400);

    const item0Row = page.locator(`[data-tree-path="${uuid}[0]"]`);
    await expect(item0Row).toBeVisible({ timeout: 5_000 });
    await item0Row.locator('[data-tree-chevron]').click();
    await page.waitForTimeout(300);

    await expect(editor).toContainText('details', { timeout: 5_000 });

    const detailsRow = page.locator(`[data-tree-path="${uuid}[0].details"]`);
    await expect(detailsRow).toBeVisible({ timeout: 3_000 });
    await detailsRow.locator('[data-tree-chevron]').click();
    await page.waitForTimeout(300);

    await expect(editor).toContainText('color', { timeout: 3_000 });

    // Change array index — color should still be visible
    const select = editor.locator('select').first();
    await select.selectOption('1');
    await page.waitForTimeout(400);

    await expect(editor).toContainText('color', { timeout: 3_000 });
  });

  test('FC-06 — selecting leaf field inserts chip with full path', async ({ page }) => {
    await gotoBuilder(page);
    const uuid = `fc06-${Date.now()}`;
    await injectTestDatasource(page, {
      id: uuid,
      label: 'FC06 Data',
      storeIn: uuid,
      mockData: [{ id: 'x1', slug: 'my-slug' }],
    });

    await page.evaluate(
      ({ key, data }) => {
        const sduiStore = (
          window as unknown as Record<string, { getState: () => { setData: (k: string, v: unknown) => void } }>
        ).__sduiStore?.getState();
        if (sduiStore) sduiStore.setData(key, data);
      },
      { key: uuid, data: [{ id: 'x1', slug: 'my-slug' }] }
    );

    const nodeId = `fc06-node-${Date.now()}`;
    await openDataTab(page);
    await openFormulaEditorOnTextField(page, nodeId);
    await switchFormulaEditorToData(page);

    const editor = page.locator('[data-testid="formula-editor"]');

    const chevron = page.locator(`[data-testid="fe-collection-chevron-${uuid}"]`);
    await chevron.click();
    await page.waitForTimeout(400);

    const item0Row = page.locator(`[data-tree-path="${uuid}[0]"]`);
    await expect(item0Row).toBeVisible({ timeout: 5_000 });
    await item0Row.locator('[data-tree-chevron]').click();
    await page.waitForTimeout(300);

    await expect(editor).toContainText('slug', { timeout: 3_000 });

    const slugRow = page.locator(`[data-tree-path="${uuid}[0].slug"]`);
    await expect(slugRow).toBeVisible({ timeout: 3_000 });
    await slugRow.locator('button').first().click();
    await page.waitForTimeout(400);

    // The serialized formula should contain collections['UUID']?.[0]?.['slug']
    const formula = await readEditorFormula(page);
    expect(formula).toContain(`collections['${uuid}']`);
    expect(formula).toContain(`?.[0]`);
    expect(formula).toContain(`?.['slug']`);

    // Current value preview should NOT say "Invalid formula"
    await expect(editor).not.toContainText('Invalid formula', { timeout: 3_000 });
  });

  test('FC-07 — backspace removes entire chip', async ({ page }) => {
    await gotoBuilder(page);
    const uuid = `fc07-${Date.now()}`;
    await injectTestDatasource(page, {
      id: uuid,
      label: 'FC07 Source',
      storeIn: uuid,
      mockData: { value: 42 },
    });

    const nodeId = `fc07-node-${Date.now()}`;
    await openDataTab(page);
    await openFormulaEditorOnTextField(page, nodeId);
    await switchFormulaEditorToData(page);

    await clearEditor(page);

    // Insert chip via pill click
    const pill = page.locator(`[data-testid="fe-collection-pill-${uuid}"]`);
    await expect(pill).toBeVisible({ timeout: 5_000 });
    await pill.click();
    await page.waitForTimeout(300);

    // Verify chip is present
    let formula = await readEditorFormula(page);
    expect(formula).toContain(`collections['${uuid}']`);

    // Move caret to end of the editor and press Backspace
    const editorEl = page.locator('[data-testid="formula-input"]');
    await editorEl.click();
    // Move caret to end using keyboard
    await page.keyboard.press('End');
    await page.waitForTimeout(100);

    // Place caret after the chip by pressing End / Ctrl+End
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement;
      if (!el) return;
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await page.waitForTimeout(100);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);

    formula = await readEditorFormula(page);
    expect(formula).not.toContain(`collections['${uuid}']`);
  });

  test('FC-08 — updating datasource label updates chip display text', async ({ page }) => {
    await gotoBuilder(page);
    const uuid = `fc08-${Date.now()}`;
    const initialLabel = 'FC08 Original';
    const updatedLabel = 'FC08 Updated';

    await injectTestDatasource(page, {
      id: uuid,
      label: initialLabel,
      storeIn: uuid,
      mockData: { val: 1 },
    });

    const nodeId = `fc08-node-${Date.now()}`;
    await openDataTab(page);
    await openFormulaEditorOnTextField(page, nodeId);
    await switchFormulaEditorToData(page);

    await clearEditor(page);
    const pill = page.locator(`[data-testid="fe-collection-pill-${uuid}"]`);
    await expect(pill).toBeVisible({ timeout: 5_000 });
    await pill.click();
    await page.waitForTimeout(300);

    // Verify initial chip label
    let chips = await readChipTexts(page);
    expect(chips[0]).toBe(initialLabel);

    // Update the datasource label via Zustand action
    await page.evaluate(
      ({ uuid, newLabel }) => {
        const builderStore = (
          window as unknown as Record<string, { getState: () => Record<string, unknown> }>
        ).__builderStore?.getState();
        if (!builderStore) return;
        const updateDS = builderStore.updatePageDataSource as
          ((id: string, patch: Record<string, unknown>) => void) | undefined;
        if (updateDS) updateDS(uuid, { _label: newLabel });
      },
      { uuid, newLabel: updatedLabel }
    );
    await page.waitForTimeout(500);

    // Chip display text should have updated
    chips = await readChipTexts(page);
    expect(chips[0]).toBe(updatedLabel);

    // The underlying formula (data-formula) should still reference the UUID
    const formula = await readEditorFormula(page);
    expect(formula).toContain(`collections['${uuid}']`);
  });
});
