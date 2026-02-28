/**
 * Color Picker Panel Tests — CP series
 *
 * Tests the FigmaColorPicker behavior in the right panel (Fill, Stroke, Typography).
 *
 * Covers:
 *   CP-01  Hex bg input → style.backgroundColor stored in Zustand
 *   CP-02  Hex bg → DOM element computed color reflects
 *   CP-03  Hex text color → style.color stored
 *   CP-04  Hex stroke → style.borderColor stored
 *   CP-05  Theme swatch (bg) → className gets bg-[var(--X)], inline style cleared
 *   CP-06  Theme swatch (text) → className gets text-[var(--X)]
 *   CP-07  Theme swatch (border) → className gets border-[var(--X)]
 *   CP-08  Element with CSS var class updates when theme changes
 *   CP-09  Hex bg → then theme swatch → inline cleared, class wins
 *   CP-10  Theme swatch → then hex input → class removed, inline hex set
 */

import { test, expect, type Page, type Browser } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 100 }
  );
}

type StoreNode = {
  id?: string; type?: string;
  props?: { className?: string; style?: Record<string, string> };
  children?: StoreNode[];
  text?: string;
};
type BuilderStore = {
  pageNodes: StoreNode[];
  _setPageNodes: (n: StoreNode[]) => void;
  patchTheme: (cssVar: string, value: string, mode?: string) => void;
};

function storeEval<T>(page: Page, fn: (store: BuilderStore) => T): Promise<T> {
  return page.evaluate((fnStr) => {
    const store = (window as unknown as { __builderStore: { getState: () => BuilderStore } }).__builderStore.getState();
    // eslint-disable-next-line no-new-func
    return new Function('store', `return (${fnStr})(store)`)(store) as T;
  }, fn.toString());
}

async function resetCanvas(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __builderStore: { getState: () => BuilderStore } }).__builderStore
      .getState()._setPageNodes([]);
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-builder-id]').length === 0,
    { timeout: 8_000 }
  );
}

async function injectBox(page: Page, id: string, className = 'w-32 h-32', style: Record<string, string> = {}) {
  await page.evaluate(({ id, cls, sty }) => {
    (window as unknown as { __builderStore: { getState: () => BuilderStore } }).__builderStore
      .getState()._setPageNodes([{ type: 'Box', id, props: { className: cls, style: sty }, children: [] }]);
  }, { id, cls: className, sty: style });
  await page.waitForSelector(`[data-builder-id="${id}"]`, { timeout: 15_000, state: 'attached' });
}

async function injectText(page: Page, id: string) {
  await page.evaluate((id) => {
    (window as unknown as { __builderStore: { getState: () => BuilderStore } }).__builderStore
      .getState()._setPageNodes([{ type: 'Text', id, props: { className: 'text-base' }, text: 'Hello' }]);
  }, id);
  await page.waitForSelector(`[data-builder-id="${id}"]`, { timeout: 15_000, state: 'attached' });
}

async function selectViaLayers(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="layer-row"]').first().click();
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(300);
}

async function getNodeStyle(page: Page, nodeId: string): Promise<Record<string, string>> {
  return page.evaluate((id) => {
    const store = (window as unknown as { __builderStore: { getState: () => BuilderStore } }).__builderStore.getState();
    function find(arr: StoreNode[]): StoreNode | null {
      for (const n of arr) {
        if (n.id === id) return n;
        if (n.children?.length) { const f = find(n.children); if (f) return f; }
      }
      return null;
    }
    return find(store.pageNodes)?.props?.style ?? {};
  }, nodeId);
}

async function getNodeClassName(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const store = (window as unknown as { __builderStore: { getState: () => BuilderStore } }).__builderStore.getState();
    function find(arr: StoreNode[]): StoreNode | null {
      for (const n of arr) {
        if (n.id === id) return n;
        if (n.children?.length) { const f = find(n.children); if (f) return f; }
      }
      return null;
    }
    return find(store.pageNodes)?.props?.className ?? '';
  }, nodeId);
}

// ─── Shared page setup ────────────────────────────────────────────────────────

let sharedPage: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  sharedPage = await browser.newPage();
  await gotoBuilder(sharedPage);
});

test.afterAll(async () => {
  await sharedPage?.close();
});

test.beforeEach(async () => {
  await resetCanvas(sharedPage);
});

// ─── CP-01: Hex bg input → style.backgroundColor ─────────────────────────────

test('CP-01: Hex bg input sets style.backgroundColor in store', async () => {
  const page = sharedPage;
  await injectBox(page, 'cp01-box');
  await selectViaLayers(page);

  const bgInput = page.locator('[data-testid="input-bg-color"]');
  await expect(bgInput).toBeVisible({ timeout: 8_000 });
  await bgInput.fill('#c0ffee');
  await bgInput.press('Tab');
  await page.waitForTimeout(400);

  const style = await getNodeStyle(page, 'cp01-box');
  console.log('CP-01 style:', style);
  expect(style.backgroundColor).toBe('#c0ffee');
  console.log('✅ CP-01: hex bg stored in style.backgroundColor');
});

// ─── CP-02: Hex bg → DOM element reflects color ──────────────────────────────

test('CP-02: Hex bg reflects on DOM element immediately', async () => {
  const page = sharedPage;
  await injectBox(page, 'cp02-box');
  await selectViaLayers(page);

  const bgInput = page.locator('[data-testid="input-bg-color"]');
  await expect(bgInput).toBeVisible({ timeout: 8_000 });
  await bgInput.fill('#ff0000');
  await bgInput.press('Tab');
  await page.waitForTimeout(300);

  const domBg = await page.locator('[data-builder-id="cp02-box"]').evaluate(
    (el: HTMLElement) => window.getComputedStyle(el).backgroundColor
  );
  console.log('CP-02 DOM computed bg:', domBg);
  expect(domBg).toMatch(/rgb\(255,\s*0,\s*0\)/);
  console.log('✅ CP-02: hex bg visible on canvas element');
});

// ─── CP-03: Hex text color ────────────────────────────────────────────────────

test('CP-03: Hex text color sets style.color in store', async () => {
  const page = sharedPage;
  await injectText(page, 'cp03-text');
  await selectViaLayers(page);

  const textInput = page.locator('[data-testid="input-text-color"]');
  await expect(textInput).toBeVisible({ timeout: 8_000 });
  await textInput.fill('#00ff00');
  await textInput.press('Tab');
  await page.waitForTimeout(300);

  const style = await getNodeStyle(page, 'cp03-text');
  console.log('CP-03 style:', style);
  expect(style.color).toBe('#00ff00');
  console.log('✅ CP-03: hex text color stored in style.color');
});

// ─── CP-04: Hex stroke color ──────────────────────────────────────────────────

test('CP-04: Hex stroke color sets style.borderColor in store', async () => {
  const page = sharedPage;
  await injectBox(page, 'cp04-box');
  await selectViaLayers(page);

  const strokeInput = page.locator('[data-testid="input-stroke-color"]');
  await expect(strokeInput).toBeVisible({ timeout: 8_000 });
  await strokeInput.fill('#0000ff');
  await strokeInput.press('Tab');
  await page.waitForTimeout(300);

  const style = await getNodeStyle(page, 'cp04-box');
  console.log('CP-04 style:', style);
  expect(style.borderColor).toBe('#0000ff');
  console.log('✅ CP-04: hex stroke stored in style.borderColor');
});

// ─── CP-05: Theme swatch bg → className token, inline style cleared ───────────

test('CP-05: Theme swatch bg click → className gets bg-[var(--X)], inline style cleared', async () => {
  const page = sharedPage;
  await injectBox(page, 'cp05-box');
  await selectViaLayers(page);

  // Open the bg color picker via the trigger swatch
  const trigger = page.locator('[data-testid="input-bg-color-swatch"]');
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  await page.waitForTimeout(300);

  // Click the Destructive theme swatch (has data-testid="swatch-destructive")
  const destructiveSwatch = page.locator('[data-testid="swatch-destructive"]').first();
  await expect(destructiveSwatch).toBeVisible({ timeout: 5_000 });
  await destructiveSwatch.click();
  await page.waitForTimeout(400);

  const cls = await getNodeClassName(page, 'cp05-box');
  const style = await getNodeStyle(page, 'cp05-box');
  console.log('CP-05 className:', cls, 'style:', style);

  expect(cls).toContain('bg-[rgb(var(--destructive))]');
  // Inline style must be cleared — class should win for theme reactivity
  expect(style.backgroundColor ?? '').toBe('');
  console.log('✅ CP-05: theme swatch bg → className token set, inline style cleared');
});

// ─── CP-06: Theme swatch text color → className token ─────────────────────────

test('CP-06: Theme swatch text color → className gets text-[var(--X)]', async () => {
  const page = sharedPage;
  await injectText(page, 'cp06-text');
  await selectViaLayers(page);

  const trigger = page.locator('[data-testid="input-text-color-swatch"]');
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  await page.waitForTimeout(300);

  const primarySwatch = page.locator('[data-testid="swatch-primary"]').first();
  await expect(primarySwatch).toBeVisible({ timeout: 5_000 });
  await primarySwatch.click();
  await page.waitForTimeout(400);

  const cls = await getNodeClassName(page, 'cp06-text');
  const style = await getNodeStyle(page, 'cp06-text');
  console.log('CP-06 className:', cls, 'style:', style);

  expect(cls).toContain('text-[rgb(var(--primary))]');
  expect(style.color ?? '').toBe('');
  console.log('✅ CP-06: theme swatch text color → className token, inline cleared');
});

// ─── CP-07: Theme swatch border color → className token ───────────────────────

test('CP-07: Theme swatch border color → className gets border-[var(--X)]', async () => {
  const page = sharedPage;
  await injectBox(page, 'cp07-box');
  await selectViaLayers(page);

  const trigger = page.locator('[data-testid="input-stroke-color-swatch"]');
  await expect(trigger).toBeVisible({ timeout: 8_000 });
  await trigger.click();
  await page.waitForTimeout(300);

  const destructiveSwatch = page.locator('[data-testid="swatch-destructive"]').first();
  await expect(destructiveSwatch).toBeVisible({ timeout: 5_000 });
  await destructiveSwatch.click();
  await page.waitForTimeout(400);

  const cls = await getNodeClassName(page, 'cp07-box');
  const style = await getNodeStyle(page, 'cp07-box');
  console.log('CP-07 className:', cls, 'style:', style);

  expect(cls).toContain('border-[rgb(var(--destructive))]');
  expect(style.borderColor ?? '').toBe('');
  console.log('✅ CP-07: theme swatch border → className token, inline cleared');
});

// ─── CP-08: Element with CSS var class → updates when theme changes ───────────

test('CP-08: Element bg-[var(--destructive)] updates when Destructive theme color changes', async () => {
  const page = sharedPage;
  // Inject box with CSS var class pre-applied (rgb() wraps the R G B triplet variable)
  await injectBox(page, 'cp08-box', 'w-32 h-32 bg-[rgb(var(--destructive))]');
  await page.waitForTimeout(200);

  const bgBefore = await page.locator('[data-builder-id="cp08-box"]').evaluate(
    (el: HTMLElement) => window.getComputedStyle(el).backgroundColor
  );
  console.log('CP-08 bg before theme change:', bgBefore);
  // Should be some non-transparent color
  expect(bgBefore).not.toBe('rgba(0, 0, 0, 0)');

  // Change the destructive theme color to a bright green via store.patchTheme
  await page.evaluate(() => {
    (window as unknown as { __builderStore: { getState: () => BuilderStore } }).__builderStore
      .getState().patchTheme('destructive', '#00cc44', 'light');
  });
  await page.waitForTimeout(300);

  const bgAfter = await page.locator('[data-builder-id="cp08-box"]').evaluate(
    (el: HTMLElement) => window.getComputedStyle(el).backgroundColor
  );
  console.log('CP-08 bg after theme change to #00cc44:', bgAfter);

  // Color must have changed
  expect(bgAfter).not.toBe(bgBefore);
  // Should be green
  expect(bgAfter).toMatch(/rgb\(0,\s*204,\s*68\)|rgb\(0,\s*\d+,\s*\d+\)/);

  // Restore original
  await page.evaluate(() => {
    (window as unknown as { __builderStore: { getState: () => BuilderStore } }).__builderStore
      .getState().patchTheme('destructive', '#ef4444', 'light');
  });
  console.log('✅ CP-08: element color reacts to theme variable change');
});

// ─── CP-09: Hex bg → then theme swatch → old hex removed ─────────────────────

test('CP-09: Hex bg then theme swatch → class wins, inline style cleared', async () => {
  const page = sharedPage;
  await injectBox(page, 'cp09-box');
  await selectViaLayers(page);

  // First set a hex color
  const bgInput = page.locator('[data-testid="input-bg-color"]');
  await expect(bgInput).toBeVisible({ timeout: 8_000 });
  await bgInput.fill('#aabbcc');
  await bgInput.press('Tab');
  await page.waitForTimeout(400);

  const styleAfterHex = await getNodeStyle(page, 'cp09-box');
  console.log('CP-09 style after hex:', styleAfterHex);
  expect(styleAfterHex.backgroundColor).toBe('#aabbcc');

  // Now click a theme swatch
  const trigger = page.locator('[data-testid="input-bg-color-swatch"]');
  await trigger.click();
  await page.waitForTimeout(300);

  const destructiveSwatch = page.locator('[data-testid="swatch-destructive"]').first();
  await expect(destructiveSwatch).toBeVisible({ timeout: 5_000 });
  await destructiveSwatch.click();
  await page.waitForTimeout(400);

  const cls = await getNodeClassName(page, 'cp09-box');
  const style = await getNodeStyle(page, 'cp09-box');
  console.log('CP-09 className after swatch:', cls, 'style:', style);

  expect(cls).toContain('bg-[rgb(var(--destructive))]');
  // Old hex class should be gone from className
  expect(cls).not.toContain('#aabbcc');
  // Inline style must be cleared
  expect(style.backgroundColor ?? '').toBe('');
  console.log('✅ CP-09: theme swatch after hex → hex cleared, class token set');
});

// ─── CP-10: Theme swatch → then hex → class removed, inline hex set ──────────

test('CP-10: Theme swatch then hex input → CSS var class removed, inline hex set', async () => {
  const page = sharedPage;
  // Start with CSS var class already applied
  await injectBox(page, 'cp10-box', 'w-32 h-32 bg-[rgb(var(--destructive))]');
  await selectViaLayers(page);

  // Now type a custom hex color
  const bgInput = page.locator('[data-testid="input-bg-color"]');
  await expect(bgInput).toBeVisible({ timeout: 8_000 });
  await bgInput.fill('#1234ab');
  await bgInput.press('Tab');
  await page.waitForTimeout(400);

  const cls = await getNodeClassName(page, 'cp10-box');
  const style = await getNodeStyle(page, 'cp10-box');
  console.log('CP-10 className after hex:', cls, 'style:', style);

  // CSS var class should be removed (styleToClassName removes all bg-[...] tokens)
  expect(cls).not.toContain('bg-[rgb(var(--destructive))]');
  // New hex stored in inline style
  expect(style.backgroundColor).toBe('#1234ab');
  console.log('✅ CP-10: custom hex after theme swatch removes CSS var class, sets inline style');
});
