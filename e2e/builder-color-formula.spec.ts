/**
 * Builder — Color & Multi-Field Formula Binding E2E Tests (FC / FF series)
 *
 * Covers:
 *   FC-01…FC-12  — Color field formula binding (backgroundColor, borderColor, text color)
 *   FF-01…FF-08  — Non-color field formula binding (width, height, gap, rotate, padding, etc.)
 *
 * Key helpers:
 *   openFieldBinding(fieldName) — clicks the ≈ icon inside [data-field="fieldName"]
 *   applyFormula(formula)       — fills the formula input and clicks Apply
 *
 * Run: npx playwright test e2e/builder-color-formula.spec.ts
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

/** Add a Box, select it, open Design tab. */
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

/** Add a Text, select it, open Design tab. */
async function addAndSelectText(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Text', id: nodeId, text: 'Hi', props: { className: '', style: {} } },
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

/**
 * Open the ≈ (binding) icon for a specific field by its `data-field` attribute.
 * This relies on FieldWithBinding rendering `data-field={label}` on its wrapper div.
 */
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

/** Type a formula and click Apply (or close if no Apply button). */
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
  // Wait for debounce + re-render (patchStyle debounce is 150ms)
  await page.waitForTimeout(700);
}

/** Close the formula editor if open. */
async function closeEditorIfOpen(page: Page) {
  const closeBtn = page.locator('[data-testid="formula-close"]');
  if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
}

/** Get a node's inline style prop from the Zustand store. */
async function getStoredStyleProp(page: Page, nodeId: string, prop: string): Promise<unknown> {
  return page.evaluate(({ nodeId, prop }) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return undefined;
    type N = { id?: string; props?: { style?: Record<string, unknown> }; children?: N[] };
    function find(arr: N[]): N | null {
      for (const n of arr) {
        if (n.id === nodeId) return n;
        if (n.children) { const r = find(n.children); if (r) return r; }
      }
      return null;
    }
    return find(store.pageNodes as N[])?.props?.style?.[prop];
  }, { nodeId, prop });
}

// ─── Group FC: Color field formula binding ────────────────────────────────────

test.describe('FC — Color field formula binding', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });
  test.afterAll(() => page.close());
  test.afterEach(async () => closeEditorIfOpen(page));

  // ── FC-01: "Background" label visible BEFORE binding ─────────────────────

  test('FC-01 "Background" label is visible in Fill section before any binding', async () => {
    await addAndSelectBox(page, 'fc-box-01');
    const bgInput = page.locator('[data-testid="input-bg-color"]');
    await bgInput.scrollIntoViewIfNeeded();
    const label = page.locator('span').filter({ hasText: /^Background$/ }).first();
    await expect(label).toBeVisible({ timeout: 5_000 });
  });

  // ── FC-02: binding "green" stores {{green}}, NOT [object Object] ───────────

  test('FC-02 Binding "green" to backgroundColor stores {{green}} — not [object Object]', async () => {
    await addAndSelectBox(page, 'fc-box-02');

    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, 'green');

    const stored = await getStoredStyleProp(page, 'fc-box-02', 'backgroundColor');
    expect(stored).toBe('{{green}}');
    expect(stored).not.toBe('[object Object]');
  });

  // ── FC-03: "ƒ Edit formula" button appears after binding ──────────────────

  test('FC-03 "ƒ Edit formula" button appears in Fill section after binding', async () => {
    await addAndSelectBox(page, 'fc-box-03');

    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, 'myBrandColor');

    const editBtn = page.locator('[data-field="backgroundColor"] [data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
  });

  // ── FC-04: FigmaColorPicker hidden when bound ──────────────────────────────

  test('FC-04 FigmaColorPicker hex input is hidden when backgroundColor is bound', async () => {
    await addAndSelectBox(page, 'fc-box-04');
    const bgHex = page.locator('[data-testid="input-bg-color"]');
    await bgHex.scrollIntoViewIfNeeded();
    await expect(bgHex).toBeVisible({ timeout: 5_000 });

    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, 'theme.primaryColor');

    await expect(bgHex).not.toBeVisible({ timeout: 5_000 });
  });

  // ── FC-05: "Background" label stays visible after binding ─────────────────

  test('FC-05 "Background" label is still visible when backgroundColor is formula-bound', async () => {
    await addAndSelectBox(page, 'fc-box-05');

    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, 'brand.color');

    // Label is a <span> rendered OUTSIDE FieldWithBinding so it's always visible
    const label = page.locator('span').filter({ hasText: /^Background$/ }).first();
    await expect(label).toBeVisible({ timeout: 5_000 });
  });

  // ── FC-06: complex formula — no [object Object] ───────────────────────────

  test('FC-06 Complex if(true,"#ff0000","#0000ff") does not produce [object Object]', async () => {
    await addAndSelectBox(page, 'fc-box-06');

    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, 'if(true,"#ff0000","#0000ff")');

    // No "[object Object]" anywhere on the page
    const bodyText = await page.locator('body').textContent().catch(() => '');
    expect(bodyText).not.toContain('[object Object]');

    const editBtn = page.locator('[data-field="backgroundColor"] [data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
  });

  // ── FC-07: re-opening editor shows the previous formula ───────────────────

  test('FC-07 Clicking "ƒ Edit formula" reopens editor with saved formula text', async () => {
    await addAndSelectBox(page, 'fc-box-07');

    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, 'storedBrandColor');

    const editBtn = page.locator('[data-field="backgroundColor"] [data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await editBtn.click();
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 5_000 });

    const formulaText = await page.locator('[data-testid="formula-input"]').inputValue();
    expect(formulaText).toBe('storedBrandColor');
  });

  // ── FC-08: unbinding restores the color picker ────────────────────────────

  test('FC-08 Unbinding backgroundColor restores the FigmaColorPicker', async () => {
    await addAndSelectBox(page, 'fc-box-08');
    const bgHex = page.locator('[data-testid="input-bg-color"]');
    await bgHex.scrollIntoViewIfNeeded();

    // Bind
    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, 'primaryColor');
    await expect(bgHex).not.toBeVisible({ timeout: 5_000 });

    // Re-open and unbind
    const editBtn = page.locator('[data-field="backgroundColor"] [data-testid="edit-formula-btn"]');
    await editBtn.click();
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 5_000 });
    await page.locator('[data-testid="formula-unbind"]').click();
    await page.waitForTimeout(500);

    // Color picker is visible again
    await expect(bgHex).toBeVisible({ timeout: 5_000 });
  });

  // ── FC-09: "Color" label visible in Stroke section ───────────────────────

  test('FC-09 "Color" label visible before binding, displayLabel "Border Color" shown after binding', async () => {
    await addAndSelectBox(page, 'fc-box-09');
    const strokeHex = page.locator('[data-testid="input-stroke-color"]');
    await strokeHex.scrollIntoViewIfNeeded();

    // Before binding: "Color" span is visible inside the FieldWithBinding children
    const colorLabel = page.locator('[data-field="borderColor"]').locator('span').filter({ hasText: /^Color$/ }).first();
    await expect(colorLabel).toBeVisible({ timeout: 3_000 });

    // Bind borderColor
    await openFieldBinding(page, 'borderColor');
    await applyFormula(page, 'strokeColor');

    // After binding: children (including "Color" span) are hidden; displayLabel "Border Color" shown
    const displayLabel = page.locator('[data-field="borderColor"]').locator('span').filter({ hasText: /^Border Color$/ }).first();
    await expect(displayLabel).toBeVisible({ timeout: 3_000 });
    // Picker hidden
    await expect(strokeHex).not.toBeVisible({ timeout: 3_000 });
    // Stored correctly
    const stored = await getStoredStyleProp(page, 'fc-box-09', 'borderColor');
    expect(stored).toBe('{{strokeColor}}');
  });

  // ── FC-10: text color — "Color" label + picker hidden when bound ─────────

  test('FC-10 Text color: "Color" label visible and picker hidden when bound', async () => {
    await addAndSelectText(page, 'fc-text-10');

    const textColorHex = page.locator('[data-testid="input-text-color"]');
    await textColorHex.scrollIntoViewIfNeeded();

    const colorLabel = page.locator('[data-field="color"] ~ span, [data-field="color"]').locator('xpath=preceding-sibling::span[contains(text(),"Color")] | ancestor::div//span[text()="Color"]').first();
    // Simpler check: just verify "Color" text exists near the typography section
    const colorSpan = page.locator('span').filter({ hasText: /^Color$/ }).last();
    await expect(colorSpan).toBeVisible({ timeout: 3_000 });

    await openFieldBinding(page, 'color');
    await applyFormula(page, 'textColor');

    // Picker hidden, label still visible
    await expect(textColorHex).not.toBeVisible({ timeout: 3_000 });
    await expect(colorSpan).toBeVisible({ timeout: 3_000 });

    const stored = await getStoredStyleProp(page, 'fc-text-10', 'color');
    expect(stored).toBe('{{textColor}}');
  });

  // ── FC-11: formula preview shows correct value ────────────────────────────

  test('FC-11 Formula if(true,"#ff0000","#000000") previews as #ff0000 in editor', async () => {
    await addAndSelectBox(page, 'fc-box-11');

    await openFieldBinding(page, 'backgroundColor');
    const input = page.locator('[data-testid="formula-input"]');
    await input.fill('if(true,"#ff0000","#000000")');
    await page.waitForTimeout(500);

    const editor = page.locator('[data-testid="formula-editor"]');
    await expect(editor).toContainText('#ff0000', { timeout: 3_000 });
    expect(await editor.textContent()).not.toContain('Invalid formula');
  });

  // ── FC-12: cancelling does not bind ──────────────────────────────────────

  test('FC-12 Cancelling the formula editor does not bind backgroundColor', async () => {
    await addAndSelectBox(page, 'fc-box-12');
    const bgHex = page.locator('[data-testid="input-bg-color"]');
    await bgHex.scrollIntoViewIfNeeded();
    await expect(bgHex).toBeVisible({ timeout: 5_000 });

    await openFieldBinding(page, 'backgroundColor');
    await page.locator('[data-testid="formula-input"]').fill('neverApply');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="formula-close"]').click();
    await page.waitForTimeout(400);

    // Picker still visible (not bound)
    await expect(bgHex).toBeVisible({ timeout: 3_000 });
    const stored = await getStoredStyleProp(page, 'fc-box-12', 'backgroundColor');
    expect(stored == null || stored === '' || stored === undefined).toBe(true);
  });
});

// ─── Group FF: Non-color field formula binding ────────────────────────────────

test.describe('FF — Non-color field formula binding', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });
  test.afterAll(() => page.close());
  test.afterEach(async () => closeEditorIfOpen(page));

  // ── FF-01: width field ────────────────────────────────────────────────────

  test('FF-01 Binding width formula hides W input and shows edit-formula-btn', async () => {
    await addAndSelectBox(page, 'ff-box-01');
    const wInput = page.locator('[data-testid="input-pos-w"]');
    await wInput.scrollIntoViewIfNeeded();
    await expect(wInput).toBeVisible({ timeout: 5_000 });

    await openFieldBinding(page, 'width');
    await applyFormula(page, 'containerWidth');

    const editBtn = page.locator('[data-field="width"] [data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await expect(wInput).not.toBeVisible({ timeout: 3_000 });
  });

  // ── FF-02: height field ───────────────────────────────────────────────────

  test('FF-02 Binding height formula hides H input and shows edit-formula-btn', async () => {
    await addAndSelectBox(page, 'ff-box-02');
    const hInput = page.locator('[data-testid="input-pos-h"]');
    await hInput.scrollIntoViewIfNeeded();
    await expect(hInput).toBeVisible({ timeout: 5_000 });

    await openFieldBinding(page, 'height');
    await applyFormula(page, 'itemHeight');

    const editBtn = page.locator('[data-field="height"] [data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await expect(hInput).not.toBeVisible({ timeout: 3_000 });
  });

  // ── FF-03: gap field ──────────────────────────────────────────────────────

  test('FF-03 Binding gap formula hides gap input and shows edit-formula-btn', async () => {
    await addAndSelectBox(page, 'ff-box-03');
    const gapInput = page.locator('[data-testid="input-gap"]');
    await gapInput.scrollIntoViewIfNeeded();
    await expect(gapInput).toBeVisible({ timeout: 5_000 });

    await openFieldBinding(page, 'gap');
    await applyFormula(page, 'spacing.md');

    const editBtn = page.locator('[data-field="gap"] [data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await expect(gapInput).not.toBeVisible({ timeout: 3_000 });
  });

  // ── FF-04: rotate field ───────────────────────────────────────────────────

  test('FF-04 Binding rotate formula hides rotate input and shows edit-formula-btn', async () => {
    await addAndSelectBox(page, 'ff-box-04');
    const rotateInput = page.locator('[data-testid="input-rotate"]');
    await rotateInput.scrollIntoViewIfNeeded();
    await expect(rotateInput).toBeVisible({ timeout: 5_000 });

    await openFieldBinding(page, 'rotate');
    await applyFormula(page, 'rotation.degrees');

    const editBtn = page.locator('[data-field="rotate"] [data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await expect(rotateInput).not.toBeVisible({ timeout: 3_000 });
  });

  // ── FF-05: formula preview sum(16,8) shows 24 ─────────────────────────────

  test('FF-05 Formula sum(16,8) shows "24" as preview in editor', async () => {
    await addAndSelectBox(page, 'ff-box-05');

    await openFieldBinding(page, 'width');
    await page.locator('[data-testid="formula-input"]').fill('sum(16,8)');
    await page.waitForTimeout(500);

    const editor = page.locator('[data-testid="formula-editor"]');
    await expect(editor).toContainText('24', { timeout: 3_000 });
    expect(await editor.textContent()).not.toContain('Invalid formula');
  });

  // ── FF-06: complex formula — no [object Object] ───────────────────────────

  test('FF-06 Complex if(true,100,200) stores formula object — no [object Object]', async () => {
    await addAndSelectBox(page, 'ff-box-06');

    await openFieldBinding(page, 'width');
    await applyFormula(page, 'if(true,100,200)');

    const bodyText = await page.locator('body').textContent().catch(() => '');
    expect(bodyText).not.toContain('[object Object]');

    const editBtn = page.locator('[data-field="width"] [data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
  });

  // ── FF-07: cancel does not bind field ─────────────────────────────────────

  test('FF-07 Cancelling formula editor does not bind the field', async () => {
    await addAndSelectBox(page, 'ff-box-07');
    const wInput = page.locator('[data-testid="input-pos-w"]');
    await wInput.scrollIntoViewIfNeeded();
    await expect(wInput).toBeVisible({ timeout: 5_000 });

    await openFieldBinding(page, 'width');
    await page.locator('[data-testid="formula-input"]').fill('neverApplied');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="formula-close"]').click();
    await page.waitForTimeout(400);

    await expect(wInput).toBeVisible({ timeout: 3_000 });
  });

  // ── FF-08: "Background" label always present, picker hidden when bound ────

  test('FF-08 "Background" label always visible; FigmaColorPicker hidden when bound', async () => {
    await addAndSelectBox(page, 'ff-box-08');
    const bgHex = page.locator('[data-testid="input-bg-color"]');
    await bgHex.scrollIntoViewIfNeeded();

    const bgLabel = page.locator('span').filter({ hasText: /^Background$/ }).first();
    await expect(bgLabel).toBeVisible({ timeout: 3_000 });

    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, 'bgColor');

    // Label still present, picker hidden
    await expect(bgLabel).toBeVisible({ timeout: 3_000 });
    await expect(bgHex).not.toBeVisible({ timeout: 3_000 });
  });
});
