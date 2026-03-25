/**
 * Builder — Class-Based Field Formula Binding & Canvas Preview Tests (FCls / FPrev series)
 *
 * NEW tests only — covers areas not tested by builder-color-formula.spec.ts:
 *
 *   FCls-01…FCls-08  — Class-based fields: borderWidthClass, shadow, textSize,
 *                       fontWeightClass, leading, tracking, zIndex, cursor
 *   FPrev-01…FPrev-04 — Canvas DOM preview: color/bgcolor formulas actually apply to DOM
 *
 * Key design:
 *   - Tailwind token like "border-2" (with hyphen) is invalid JS but valid as a class name.
 *     evalToStr() falls back to the raw formula string on evaluation error → token applied.
 *   - Canvas preview: after applying a color formula that evaluates to a CSS value,
 *     the builder DOM element's inline style should reflect it.
 *
 * Run: npx playwright test e2e/builder-formula-class-fields.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 }
  );
  await page.waitForTimeout(1500);
}

async function addBox(page: Page, id: string, extraClass = 'flex flex-col') {
  await page.evaluate(({ nodeId, cls }) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Box', id: nodeId, props: { className: cls, style: {} } },
      null
    );
    (store.select as (id: string) => void)(nodeId);
  }, { nodeId: id, cls: extraClass });
  await page.waitForFunction((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(nodeId as string);
  }, id, { timeout: 5_000 });
  await page.waitForTimeout(600);
  await page.click('[data-testid="tab-right-design"]');
  await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function addText(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Text', id: nodeId, text: 'Test', props: { className: 'text-base font-normal leading-normal tracking-normal', style: {} } },
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
  const wrapper = page.locator(`[data-field="${fieldName}"]`);
  await wrapper.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const icon = wrapper.locator('[data-testid="binding-icon"]');
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
  if (await applyBtn.isVisible({ timeout: 800 }).catch(() => false)) {
    await applyBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(700);
}

async function closeEditorIfOpen(page: Page) {
  const closeBtn = page.locator('[data-testid="formula-close"]');
  if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
}

async function getNodeClassName(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return '';
    type N = { id?: string; props?: { className?: string }; children?: N[] };
    function find(arr: N[]): N | null {
      for (const n of arr) {
        if (n.id === nodeId) return n;
        if (n.children) { const r = find(n.children); if (r) return r; }
      }
      return null;
    }
    return find(store.pageNodes as N[])?.props?.className ?? '';
  }, nodeId) as Promise<string>;
}

async function getCanvasInlineStyle(page: Page, nodeId: string, cssProp: string): Promise<string> {
  return page.evaluate(({ nodeId, cssProp }) => {
    const el = document.querySelector(`[data-builder-id="${nodeId}"]`) as HTMLElement | null;
    if (!el) return '';
    return (el.style as unknown as Record<string, string>)[cssProp] ?? '';
  }, { nodeId, cssProp }) as Promise<string>;
}

// ─── Group FCls: Class-based field formula binding ────────────────────────────

test.describe('FCls — Class-based field formula binding', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });
  test.afterAll(() => page.close());
  test.afterEach(async () => closeEditorIfOpen(page));

  // ── FCls-01: borderWidthClass — raw token "border-2" (hyphen, no quotes) ──

  test('FCls-01 Applying "border-2" (no quotes) to borderWidthClass applies the class', async () => {
    await addBox(page, 'fcls-border-01', 'flex border-0');

    await openFieldBinding(page, 'borderWidthClass');
    // Type "border-2" without quotes — hyphen makes it invalid JS but evalToStr falls back to raw string
    await applyFormula(page, 'border-2');

    const cls = await getNodeClassName(page, 'fcls-border-01');
    expect(cls).toContain('border-2');
    // Old border-0 should be replaced
    expect(cls).not.toContain('border-0');
  });

  // ── FCls-02: borderWidthClass — quoted string literal ─────────────────────

  test('FCls-02 Applying "border-4" (with quotes) to borderWidthClass applies the class', async () => {
    await addBox(page, 'fcls-border-02', 'flex border-0');

    await openFieldBinding(page, 'borderWidthClass');
    await applyFormula(page, '"border-4"');

    const cls = await getNodeClassName(page, 'fcls-border-02');
    expect(cls).toContain('border-4');
  });

  // ── FCls-03: shadow field ─────────────────────────────────────────────────

  test('FCls-03 Applying "shadow-md" to shadow field adds shadow-md class', async () => {
    await addBox(page, 'fcls-shadow-03', 'flex shadow-none');

    await openFieldBinding(page, 'shadow');
    await applyFormula(page, 'shadow-md');

    const cls = await getNodeClassName(page, 'fcls-shadow-03');
    expect(cls).toContain('shadow-md');
  });

  // ── FCls-04: textSize field ───────────────────────────────────────────────

  test('FCls-04 Applying "text-xl" to textSize changes the text size class', async () => {
    await addText(page, 'fcls-textsize-04');

    await openFieldBinding(page, 'textSize');
    await applyFormula(page, 'text-xl');

    const cls = await getNodeClassName(page, 'fcls-textsize-04');
    expect(cls).toContain('text-xl');
  });

  // ── FCls-05: fontWeightClass field ────────────────────────────────────────

  test('FCls-05 Applying "font-bold" to fontWeightClass changes the font weight class', async () => {
    await addText(page, 'fcls-fontweight-05');

    await openFieldBinding(page, 'fontWeightClass');
    await applyFormula(page, 'font-bold');

    const cls = await getNodeClassName(page, 'fcls-fontweight-05');
    expect(cls).toContain('font-bold');
  });

  // ── FCls-06: leading (line-height) field ──────────────────────────────────

  test('FCls-06 Applying "leading-loose" to leading field applies the class', async () => {
    await addText(page, 'fcls-leading-06');

    await openFieldBinding(page, 'leading');
    await applyFormula(page, 'leading-loose');

    const cls = await getNodeClassName(page, 'fcls-leading-06');
    expect(cls).toContain('leading-loose');
  });

  // ── FCls-07: tracking (letter-spacing) field ─────────────────────────────

  test('FCls-07 Applying "tracking-wide" to tracking field applies the class', async () => {
    await addText(page, 'fcls-tracking-07');

    await openFieldBinding(page, 'tracking');
    await applyFormula(page, 'tracking-wide');

    const cls = await getNodeClassName(page, 'fcls-tracking-07');
    expect(cls).toContain('tracking-wide');
  });

  // ── FCls-08: class-based token with evaluated formula ─────────────────────

  test('FCls-08 Evaluated formula if(true,"shadow-lg","shadow-none") applies shadow-lg', async () => {
    await addBox(page, 'fcls-shadow-eval-08', 'flex shadow-none');

    await openFieldBinding(page, 'shadow');
    await applyFormula(page, 'if(true,"shadow-lg","shadow-none")');

    const cls = await getNodeClassName(page, 'fcls-shadow-eval-08');
    expect(cls).toContain('shadow-lg');
  });
});

// ─── Group FPrev: Canvas DOM preview after formula apply ─────────────────────
//
// These tests verify that the canvas DOM element's inline style reflects the
// formula result immediately after Apply (no page reload needed).

test.describe('FPrev — Canvas preview after formula apply', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });
  test.afterAll(() => page.close());
  test.afterEach(async () => closeEditorIfOpen(page));

  // ── FPrev-01: color formula "red" → canvas style.color = "red" ───────────

  test('FPrev-01 Applying "red" formula to text color updates canvas DOM style.color', async () => {
    await addText(page, 'fprev-color-01');

    await openFieldBinding(page, 'color');
    // "red" as a quoted string literal — evaluates to "red" (valid CSS color)
    await applyFormula(page, '"red"');

    const domColor = await getCanvasInlineStyle(page, 'fprev-color-01', 'color');
    expect(domColor).toBe('red');
  });

  // ── FPrev-02: backgroundColor formula "#ff0000" → canvas DOM updated ─────

  test('FPrev-02 Applying "#ff0000" formula to backgroundColor updates canvas DOM', async () => {
    await addBox(page, 'fprev-bg-02');

    await openFieldBinding(page, 'backgroundColor');
    await applyFormula(page, '"#ff0000"');

    const domBg = await getCanvasInlineStyle(page, 'fprev-bg-02', 'backgroundColor');
    // Browser normalizes #ff0000 to rgb(255, 0, 0)
    expect(domBg).toMatch(/rgb\(255,\s*0,\s*0\)|#ff0000/i);
  });

  // ── FPrev-03: conditional color formula → correct branch applied ──────────

  test('FPrev-03 if(true,"blue","green") formula updates canvas color to blue', async () => {
    await addText(page, 'fprev-cond-03');

    await openFieldBinding(page, 'color');
    await applyFormula(page, 'if(true,"blue","green")');

    const domColor = await getCanvasInlineStyle(page, 'fprev-cond-03', 'color');
    expect(domColor).toBe('blue');
  });

  // ── FPrev-04: width formula sum(100,50)+"px" → canvas style.width updated ─

  test('FPrev-04 sum(100,50)+"px" formula updates canvas DOM style.width to 150px', async () => {
    await addBox(page, 'fprev-width-04');

    await openFieldBinding(page, 'width');
    await applyFormula(page, 'sum(100,50)+"px"');

    const domWidth = await getCanvasInlineStyle(page, 'fprev-width-04', 'width');
    expect(domWidth).toBe('150px');
  });
});
