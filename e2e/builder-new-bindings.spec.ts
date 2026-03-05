/**
 * Builder — New Field Bindings Tests (NB series)
 *
 * Tests for fields that previously lacked formula binding:
 *   NB-01  — Content textarea shows FieldWithBinding (≈ icon visible)
 *   NB-02  — Content text formula stores formula object
 *   NB-03  — Shadow SelectInput is inside FieldWithBinding (≈ icon next to it)
 *   NB-04  — Shadow formula applies class to canvas
 *   NB-05  — Combined padding H shows "H (px/py)" label when bound
 *   NB-06  — Combined padding V shows "V (pt/pb)" label when bound
 *   NB-07  — Combined margin H shows "H (mx)" label when bound
 *   NB-08  — Combined margin V shows "V (my)" label when bound
 *   NB-09  — Corner TL border radius has ≈ binding icon
 *   NB-10  — Corner BL border radius formula applies class
 *
 * Run: npx playwright test e2e/builder-new-bindings.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function getNodeClassName(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return '';
    type N = { id?: string; props?: { className?: string }; children?: N[] };
    function find(arr: N[]): N | null {
      for (const n of arr) {
        if (n.id === id) return n;
        if (n.children) { const r = find(n.children); if (r) return r; }
      }
      return null;
    }
    return find(store.pageNodes as N[])?.props?.className ?? '';
  }, nodeId);
}

async function getNodeText(page: Page, nodeId: string): Promise<unknown> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return undefined;
    type N = { id?: string; text?: unknown; children?: N[] };
    function find(arr: N[]): N | null {
      for (const n of arr) {
        if (n.id === id) return n;
        if (n.children) { const r = find(n.children); if (r) return r; }
      }
      return null;
    }
    return find(store.pageNodes as N[])?.text;
  }, nodeId);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('NB — New Field Bindings', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // NB-01: Content textarea has ≈ binding icon (FieldWithBinding wraps it)
  test('NB-01: Content section has ≈ binding icon for text field', async () => {
    await addAndSelectText(page, 'nb-01-text');
    const textFieldWrapper = page.locator('[data-field="text"]');
    await textFieldWrapper.scrollIntoViewIfNeeded();
    const icon = textFieldWrapper.locator('[data-testid="binding-icon"]');
    await expect(icon).toBeVisible({ timeout: 5_000 });
    // The textarea should be visible (not bound yet)
    const textarea = page.locator('[data-testid="input-text-content"]');
    await expect(textarea).toBeVisible();
  });

  // NB-02: Content text formula binding stores formula object
  test('NB-02: Content text formula stores formula object in node', async () => {
    await addAndSelectText(page, 'nb-02-text');
    await openFieldBinding(page, 'text');
    await applyFormula(page, '"Hello World"');

    // After binding, textarea should be hidden, "ƒ Edit formula" shown
    const textFieldWrapper = page.locator('[data-field="text"]');
    await expect(textFieldWrapper.locator('[data-testid="edit-formula-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-text-content"]')).not.toBeVisible({ timeout: 3_000 });

    // Stored value should be a formula object
    const stored = await getNodeText(page, 'nb-02-text');
    expect(stored).toMatchObject({ formula: '"Hello World"' });
  });

  // NB-03: Shadow SelectInput is inside FieldWithBinding (≈ icon visible next to it)
  test('NB-03: Shadow SelectInput has ≈ binding icon', async () => {
    await addAndSelectBox(page, 'nb-03-box');
    const shadowWrapper = page.locator('[data-field="shadow"]');
    await shadowWrapper.scrollIntoViewIfNeeded();
    const icon = shadowWrapper.locator('[data-testid="binding-icon"]');
    await expect(icon).toBeVisible({ timeout: 5_000 });
    // The SelectInput should be visible (not bound yet)
    const select = page.locator('[data-testid="select-shadow"]');
    await expect(select).toBeVisible();
  });

  // NB-04: Shadow formula applies class token to canvas node
  test('NB-04: Shadow formula applies shadow-lg class to node', async () => {
    await addAndSelectBox(page, 'nb-04-box');
    await openFieldBinding(page, 'shadow');
    await applyFormula(page, '"shadow-lg"');

    const cls = await getNodeClassName(page, 'nb-04-box');
    expect(cls).toContain('shadow-lg');
  });

  // Helper to ensure padding section is in combined mode
  async function ensurePaddingCombined() {
    await page.waitForSelector('[data-testid="section-padding"]', { timeout: 10_000 });
    const toggleBtn = page.locator('[data-testid="padding-mode-toggle"]');
    const mode = await toggleBtn.getAttribute('data-pad-mode').catch(() => 'individual');
    if (mode !== 'combined') {
      await toggleBtn.click();
      await page.waitForTimeout(300);
    }
  }

  // NB-05: Combined padding H has ≈ binding icon (padMode defaults to 'individual', must switch first)
  test('NB-05: Combined padding H has ≈ binding icon after switching to combined mode', async () => {
    await addAndSelectBox(page, 'nb-05-box');
    await ensurePaddingCombined();

    const wrapper = page.locator('[data-field="paddingInline"]');
    await expect(wrapper).toBeVisible({ timeout: 5_000 });
    const icon = wrapper.locator('[data-testid="binding-icon"]');
    await expect(icon).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="input-pad-h"]')).toBeVisible();
  });

  // NB-06: Combined padding V has ≈ binding icon
  test('NB-06: Combined padding V has ≈ binding icon after switching to combined mode', async () => {
    await addAndSelectBox(page, 'nb-06-box');
    await ensurePaddingCombined();

    const wrapper = page.locator('[data-field="paddingBlock"]');
    await expect(wrapper).toBeVisible({ timeout: 5_000 });
    const icon = wrapper.locator('[data-testid="binding-icon"]');
    await expect(icon).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="input-pad-v"]')).toBeVisible();
  });

  // NB-07: Combined margin H shows "H (mx)" label when bound
  test('NB-07: Combined margin H shows "H (mx)" label when bound', async () => {
    await addAndSelectBox(page, 'nb-07-box');
    const wrapper = page.locator('[data-field="marginInline"]');
    await wrapper.scrollIntoViewIfNeeded();
    await openFieldBinding(page, 'marginInline');
    await applyFormula(page, '"12px"');

    const labelSpan = wrapper.locator('span').filter({ hasText: /^H \(mx\)$/ }).first();
    await expect(labelSpan).toBeVisible();
    const editBtn = wrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });

  // NB-08: Combined margin V shows "V (my)" label when bound
  test('NB-08: Combined margin V shows "V (my)" label when bound', async () => {
    await addAndSelectBox(page, 'nb-08-box');
    const wrapper = page.locator('[data-field="marginBlock"]');
    await wrapper.scrollIntoViewIfNeeded();
    await openFieldBinding(page, 'marginBlock');
    await applyFormula(page, '"4px"');

    const labelSpan = wrapper.locator('span').filter({ hasText: /^V \(my\)$/ }).first();
    await expect(labelSpan).toBeVisible();
    const editBtn = wrapper.locator('[data-testid="edit-formula-btn"]');
    await expect(editBtn).toBeVisible();
  });

  // NB-09: Corner TL border radius has ≈ binding icon
  test('NB-09: Corner TL has ≈ binding icon', async () => {
    await addAndSelectBox(page, 'nb-09-box');
    const cornerWrapper = page.locator('[data-field="corner-tl"]');
    await cornerWrapper.scrollIntoViewIfNeeded();
    const icon = cornerWrapper.locator('[data-testid="binding-icon"]');
    await expect(icon).toBeVisible({ timeout: 5_000 });
    // SelectInput should be visible (unbound)
    const select = page.locator('[data-testid="select-corner-tl"]');
    await expect(select).toBeVisible();
  });

  // NB-10: Corner BL formula applies per-corner rounded class token
  test('NB-10: Corner BL formula applies rounded-bl-full class', async () => {
    await addAndSelectBox(page, 'nb-10-box');
    await openFieldBinding(page, 'corner-bl');
    // applyBorderRadius produces per-corner classes like rounded-bl-full
    await applyFormula(page, '"rounded-full"');

    const cls = await getNodeClassName(page, 'nb-10-box');
    // The corner BL formula result is applied via applyBorderRadius which produces rounded-bl-*
    expect(cls).toContain('rounded-bl-full');
  });
});
