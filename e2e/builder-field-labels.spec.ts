/**
 * Builder — Field Label Persistence & Hint Tests (FL series)
 *
 * Covers:
 *   FL-01…FL-04  — displayLabel persists when a field is bound (shows above "ƒ Edit formula")
 *   FL-05…FL-08  — hint text appears in the FormulaEditor's "Expected format" section
 *   FL-09…FL-12  — Each major field category: width/height, padding, shadow, opacity
 *
 * Run: npx playwright test e2e/builder-field-labe ls.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
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
  await page.waitForTimeout(600);
  await page.click('[data-testid="tab-right-design"]');
  await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function addAndSelectText(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Text', id: nodeId, text: 'Hello', props: { className: '', style: {} } },
      null
    );
    (store.select as (id: string) => void)(nodeId);
  }, id);
  await page.waitForFunction((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(nodeId as string);
  }, id, { timeout: 5_000 });
  await page.waitForTimeout(600);
  await page.click('[data-testid="tab-right-design"]');
  await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function openFieldBinding(page: Page, fieldName: string) {
  const fieldWrapper = page.locator(`[data-field="${fieldName}"]`);
  await fieldWrapper.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const icon = fieldWrapper.locator('[data-testid="binding-icon"]');
  await expect(icon).toBeVisible({ timeout: 5_000 });
  await icon.click();
  await page.waitForTimeout(200);
  await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });
  await page.waitForTimeout(200);
}

async function applyFormula(page: Page, formula: string) {
  const input = page.locator('[data-testid="formula-input"]');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(formula);
  await page.waitForTimeout(300);
  const applyBtn = page.locator('[data-testid="formula-apply"]');
  if (await applyBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await applyBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(700);
}

async function unbindField(page: Page) {
  const unbindBtn = page.locator('[data-testid="formula-unbind"]');
  if (await unbindBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await unbindBtn.click();
    await page.waitForTimeout(400);
  }
}

// ─── Group FL: Field Label Persistence ───────────────────────────────────────

test.describe('FL — Field Label Persistence When Bound', () => {
  // Serial mode: shared `page` must not run in parallel with other workers
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // FL-01: Width (W) label persists when bound
  test('FL-01: width field shows "W" label above ƒ Edit formula when bound', async () => {
    await addAndSelectBox(page, 'fl-01-box');
    await openFieldBinding(page, 'width');
    await applyFormula(page, '"200px"');

    // After binding, the "W" displayLabel should be visible inside the field wrapper
    const fieldWrapper = page.locator('[data-field="width"]');
    await expect(fieldWrapper).toBeVisible();
    // displayLabel span should show "W"
    const labelSpan = fieldWrapper.locator('span').filter({ hasText: /^W$/ }).first();
    await expect(labelSpan).toBeVisible();
    // "ƒ Edit formula" button should also be visible
    const editBtn = fieldWrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });

  // FL-02: Height (H) label persists when bound
  test('FL-02: height field shows "H" label above ƒ Edit formula when bound', async () => {
    await addAndSelectBox(page, 'fl-02-box');
    await openFieldBinding(page, 'height');
    await applyFormula(page, '"150px"');

    const fieldWrapper = page.locator('[data-field="height"]');
    const labelSpan = fieldWrapper.locator('span').filter({ hasText: /^H$/ }).first();
    await expect(labelSpan).toBeVisible();
    const editBtn = fieldWrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });

  // FL-03: Gap field shows "Gap" label when bound
  test('FL-03: gap field shows "Gap" label above ƒ Edit formula when bound', async () => {
    await addAndSelectBox(page, 'fl-03-box');
    await openFieldBinding(page, 'gap');
    await applyFormula(page, '"8px"');

    const fieldWrapper = page.locator('[data-field="gap"]');
    const labelSpan = fieldWrapper.locator('span').filter({ hasText: /^Gap$/ }).first();
    await expect(labelSpan).toBeVisible();
    const editBtn = fieldWrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });

  // FL-04: Opacity field shows "Opacity" label when bound
  test('FL-04: opacity field shows "Opacity" label above ƒ Edit formula when bound', async () => {
    await addAndSelectBox(page, 'fl-04-box');
    const fieldWrapper = page.locator('[data-field="opacity"]');
    await fieldWrapper.scrollIntoViewIfNeeded();
    await openFieldBinding(page, 'opacity');
    await applyFormula(page, '"0.5"');

    const labelSpan = fieldWrapper.locator('span').filter({ hasText: /^Opacity$/ }).first();
    await expect(labelSpan).toBeVisible();
    const editBtn = fieldWrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });
});

// ─── Group FH: Hint Text in Formula Editor ────────────────────────────────────

test.describe('FH — Hint Text Shown in Formula Editor', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // FH-01: Width shows hint "e.g. 200px, 50%, auto"
  test('FH-01: width field shows hint "e.g. 200px, 50%, auto" in formula editor', async () => {
    await addAndSelectBox(page, 'fh-01-box');
    await openFieldBinding(page, 'width');

    // Hint text should appear in the editor's preview bar
    const hint = page.locator('text=e.g. 200px, 50%, auto');
    await expect(hint).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  // FH-02: Height shows hint "e.g. 100px, 50vh, auto"
  test('FH-02: height field shows hint "e.g. 100px, 50vh, auto" in formula editor', async () => {
    await addAndSelectBox(page, 'fh-02-box');
    await openFieldBinding(page, 'height');

    const hint = page.locator('text=e.g. 100px, 50vh, auto');
    await expect(hint).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  // FH-03: shadow field shows hint "e.g. shadow, shadow-md, shadow-lg, shadow-none"
  test('FH-03: shadow field shows hint in formula editor', async () => {
    await addAndSelectBox(page, 'fh-03-box');
    await openFieldBinding(page, 'shadow');

    // Scope to formula-editor to avoid matching the shadow <select> outside the editor
    const hint = page.locator('[data-testid="formula-editor"] span').filter({ hasText: /shadow.*shadow-md/ }).first();
    await expect(hint).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  // FH-04: opacity hint mentions "no quotes" (updated hint for clarity)
  test('FH-04: opacity field shows hint about no quotes in formula editor', async () => {
    await addAndSelectBox(page, 'fh-04-box');
    const opacityWrapper = page.locator('[data-field="opacity"]');
    await opacityWrapper.scrollIntoViewIfNeeded();
    await openFieldBinding(page, 'opacity');

    const hint = page.locator('[data-testid="formula-editor"]').locator('text=/no quotes/i').or(
      page.locator('[data-testid="formula-editor"]').locator('text=/0[–-]1|0 to 1/i')
    ).first();
    await expect(hint).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });
});

// ─── Group FM: Per-field bind + label test for major field categories ──────────

test.describe('FM — Major Field Categories Bind + Label', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // FM-01: borderRadius persists "Radius" label when bound
  test('FM-01: borderRadius shows "Radius" label when bound', async () => {
    await addAndSelectBox(page, 'fm-01-box');
    const wrapper = page.locator('[data-field="borderRadius"]');
    await wrapper.scrollIntoViewIfNeeded();
    await openFieldBinding(page, 'borderRadius');
    await applyFormula(page, '"8px"');

    const labelSpan = wrapper.locator('span').filter({ hasText: /^Radius$/ }).first();
    await expect(labelSpan).toBeVisible();
  });

  // FM-02: minWidth persists "Min W" label when bound
  test('FM-02: minWidth shows "Min W" label when bound', async () => {
    await addAndSelectBox(page, 'fm-02-box');

    const wrapper = page.locator('[data-field="minWidth"]');
    await wrapper.scrollIntoViewIfNeeded();
    await openFieldBinding(page, 'minWidth');
    await applyFormula(page, '"100px"');

    const labelSpan = wrapper.locator('span').filter({ hasText: /^Min W$/ }).first();
    await expect(labelSpan).toBeVisible();
    const editBtn = wrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });

  // FM-03: backgroundColor label "Background" persists when bound (doubles as external label check)
  test('FM-03: backgroundColor external label "Background" visible when bound', async () => {
    await addAndSelectBox(page, 'fm-03-box');
    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, '"blue"');

    // External label span (outside FieldWithBinding)
    const externalLabel = page.locator('span').filter({ hasText: /^Background$/ }).first();
    await expect(externalLabel).toBeVisible();
    // displayLabel inside FieldWithBinding also shows "Background"
    const wrapper = page.locator('[data-field="backgroundColor"]');
    const editBtn = wrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });

  // FM-04: maxHeight displayLabel "Max H" persists when bound
  test('FM-04: maxHeight shows "Max H" label when bound', async () => {
    await addAndSelectBox(page, 'fm-04-box');
    const wrapper = page.locator('[data-field="maxHeight"]');
    await wrapper.scrollIntoViewIfNeeded();
    await openFieldBinding(page, 'maxHeight');
    await applyFormula(page, '"400px"');

    const labelSpan = wrapper.locator('span').filter({ hasText: /^Max H$/ }).first();
    await expect(labelSpan).toBeVisible();
    const editBtn = wrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });

  // FM-05: Unbinding restores the original input (not ƒ Edit formula)
  test('FM-05: unbinding width restores NumberInput (no ƒ Edit formula button)', async () => {
    await addAndSelectBox(page, 'fm-05-box');
    await openFieldBinding(page, 'width');
    await applyFormula(page, '"300px"');

    // Now bound — edit button visible
    const wrapper = page.locator('[data-field="width"]');
    await expect(wrapper.locator('[data-testid="edit-formula-btn"]')).toBeVisible();

    // Unbind
    await wrapper.locator('[data-testid="binding-icon"]').click();
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });
    await unbindField(page);

    // After unbind — edit formula button gone, normal NumberInput shown
    await expect(wrapper.locator('[data-testid="edit-formula-btn"]')).not.toBeVisible({ timeout: 3_000 });
    const wInput = page.locator('[data-testid="input-pos-w"]');
    await expect(wInput).toBeVisible();
  });

  // FM-06: Text node — text color (style-based) binding shows "Color" label when bound
  test('FM-06: text color shows "Color" label when bound (Text node)', async () => {
    await addAndSelectText(page, 'fm-06-text');
    const wrapper = page.locator('[data-field="color"]');
    await wrapper.scrollIntoViewIfNeeded();
    await openFieldBinding(page, 'color');
    await applyFormula(page, '"#ff0000"');

    const labelSpan = wrapper.locator('span').filter({ hasText: /^Color$/ }).first();
    await expect(labelSpan).toBeVisible();
    const editBtn = wrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });
});
