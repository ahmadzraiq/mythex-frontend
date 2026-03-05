/**
 * Builder — Bare number formula for dimension fields
 *
 * Verifies that typing a bare number (e.g. 1500) in the formula editor for a
 * dimension CSS field (width, height, padding, etc.) automatically appends "px"
 * and applies the value to the canvas element — without needing quotes.
 *
 * Run: npx playwright test e2e/builder-number-formula.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers (same pattern as other builder specs) ────────────────────────────

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
      { type: 'Box', id: nodeId, props: { className: 'flex flex-col', style: {} } },
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

/** Read the inline style of the canvas element for the given node id */
async function getCanvasNodeStyle(page: Page, nodeId: string, prop: string): Promise<string> {
  return page.evaluate(([id, p]) => {
    const el = document.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null;
    if (!el) return '';
    return (el.style as unknown as Record<string, string>)[p as string] ?? '';
  }, [nodeId, prop]);
}

/** Read a style value stored in the Zustand pageNodes tree */
async function getNodeStoredStyle(page: Page, nodeId: string, cssKey: string): Promise<unknown> {
  return page.evaluate(([id, key]) => {
    function findNode(nodes: unknown[]): unknown {
      for (const n of nodes as Array<{ id?: string; props?: { style?: Record<string, unknown> }; children?: unknown[] }>) {
        if (n.id === id) return n.props?.style?.[key as string];
        if (n.children?.length) {
          const f = findNode(n.children);
          if (f !== undefined) return f;
        }
      }
      return undefined;
    }
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    return findNode((store?.pageNodes as unknown[]) ?? []);
  }, [nodeId, cssKey]);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('NF — Bare number formulas for dimension fields', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // NF-01: bare integer 1500 → canvas style.width becomes "1500px"
  test('NF-01 bare integer 1500 applies 1500px to canvas width', async () => {
    await addAndSelectBox(page, 'nf-01-box');
    await openFieldBinding(page, 'width');
    await applyFormula(page, '1500');

    // Canvas element should have width 1500px
    const styleVal = await getCanvasNodeStyle(page, 'nf-01-box', 'width');
    expect(styleVal).toBe('1500px');

    // Stored value should be formula object { formula: "1500" }
    const stored = await getNodeStoredStyle(page, 'nf-01-box', 'width');
    expect(stored).toMatchObject({ formula: '1500' });
  });

  // NF-02: bare integer 80 → canvas style.height becomes "80px"
  test('NF-02 bare integer 80 applies 80px to canvas height', async () => {
    await addAndSelectBox(page, 'nf-02-box');
    await openFieldBinding(page, 'height');
    await applyFormula(page, '80');

    const styleVal = await getCanvasNodeStyle(page, 'nf-02-box', 'height');
    expect(styleVal).toBe('80px');
  });

  // NF-03: bare float 0.5 on opacity → no px suffix (opacity is not a dimension key)
  test('NF-03 bare float 0.5 for opacity applies "0.5" (no px suffix)', async () => {
    await addAndSelectBox(page, 'nf-03-box');
    await openFieldBinding(page, 'opacity');
    await applyFormula(page, '0.5');

    const styleVal = await getCanvasNodeStyle(page, 'nf-03-box', 'opacity');
    // opacity should be 0.5, not 0.5px
    expect(styleVal).toBe('0.5');
  });

  // NF-04: "1500px" still works (existing behaviour not broken)
  test('NF-04 quoted "1500px" still works as before', async () => {
    await addAndSelectBox(page, 'nf-04-box');
    await openFieldBinding(page, 'width');
    await applyFormula(page, '"1500px"');

    const styleVal = await getCanvasNodeStyle(page, 'nf-04-box', 'width');
    expect(styleVal).toBe('1500px');
  });

  // NF-05: bare integer 16 for padding → canvas style.paddingTop becomes "16px"
  test('NF-05 bare integer 16 applies 16px to padding', async () => {
    await addAndSelectBox(page, 'nf-05-box');
    await openFieldBinding(page, 'paddingTop');
    await applyFormula(page, '16');

    const styleVal = await getCanvasNodeStyle(page, 'nf-05-box', 'paddingTop');
    expect(styleVal).toBe('16px');
  });
});
