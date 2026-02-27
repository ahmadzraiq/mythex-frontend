/**
 * Media Components Panel Tests
 *
 * Covers right-panel behavior for media components:
 *   PM-01..04  Image   — appears on canvas, W/H resize, src field, empty-src fallback
 *   PM-05..08  NavIcon — appears on canvas, selectable, size change, color change
 *   PM-09..10  IconTap — Pressable+NavIcon container, sub-select NavIcon child
 *
 * Each describe block shares ONE browser page (opened in beforeAll) and
 * resets the canvas in beforeEach.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="tab-components"]', { timeout: 15_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 100 }
  );
}

async function clearCanvas(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>)
      .__builderStore.getState()._setPageNodes([]);
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-builder-id]').length === 0,
    { timeout: 5_000 }
  );
}

async function injectNodes(page: Page, nodes: unknown[]) {
  await page.evaluate((ns) => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore
      .getState()._setPageNodes(ns);
  }, nodes);
  const firstId = (nodes[0] as { id?: string })?.id;
  if (firstId) {
    await page.waitForSelector(`[data-builder-id="${firstId}"]`, { timeout: 10_000 });
  } else {
    await page.locator('[data-builder-id]').first().waitFor({ state: 'visible', timeout: 10_000 });
  }
}

async function selectFirstNodeViaLayers(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="layer-row"]').first().click();
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(200);
}

async function getFirstNodeId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { selectedIds: string[] } }>).__builderStore?.getState();
    return store?.selectedIds?.[0] ?? '';
  });
}

async function getNodeStyle(page: Page, nodeId: string): Promise<Record<string, string>> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
    function find(arr: unknown[]): Record<string, unknown> | null {
      for (const n of arr) {
        const node = n as Record<string, unknown>;
        if (node.id === id) return node;
        const ch = node.children as unknown[] | undefined;
        if (ch?.length) { const f = find(ch); if (f) return f; }
      }
      return null;
    }
    const node = find(store?.pageNodes ?? []);
    return (node?.props as Record<string, Record<string, string>> | undefined)?.style ?? {};
  }, nodeId);
}

async function getNodeProps(page: Page, nodeId: string): Promise<Record<string, unknown>> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
    function find(arr: unknown[]): Record<string, unknown> | null {
      for (const n of arr) {
        const node = n as Record<string, unknown>;
        if (node.id === id) return node;
        const ch = node.children as unknown[] | undefined;
        if (ch?.length) { const f = find(ch); if (f) return f; }
      }
      return null;
    }
    const node = find(store?.pageNodes ?? []);
    return (node?.props as Record<string, unknown> | undefined) ?? {};
  }, nodeId);
}

async function scrollTo(page: Page, testId: string) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, testId);
  await page.waitForTimeout(50);
}

// ─── PM-01..04 — Image ────────────────────────────────────────────────────────

test.describe('PM — Image', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PM-01: Drop Image → appears on canvas with data-builder-id', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-image',
      type: 'NextImage',
      src: 'https://placehold.co/600x400',
      props: { className: 'rounded-md', style: { width: '300px', height: '192px' } },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-image"]', { timeout: 8_000 });

    const el = sharedPage.locator('[data-builder-id="test-image"]');
    await expect(el).toBeVisible();
    const box = await el.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    console.log('✅ Image appears on canvas:', box!.width, '×', box!.height);
  });

  test('PM-02: Image W/H resize applies style.width and style.height', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-image',
      type: 'NextImage',
      src: 'https://placehold.co/600x400',
      props: { className: 'rounded-md', style: { width: '300px', height: '192px' } },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-image"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    await sharedPage.locator('[data-testid="input-pos-w"]').fill('400');
    await sharedPage.waitForTimeout(200);
    await sharedPage.locator('[data-testid="input-pos-h"]').fill('250');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, 'test-image');
    expect(style.width).toBe('400px');
    expect(style.height).toBe('250px');
    console.log('✅ Image W=400 H=250 applied via style');
  });

  test('PM-03: Image with empty src shows gray placeholder, not broken', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-image-empty',
      type: 'NextImage',
      src: '',
      props: { className: 'rounded-md', style: { width: '200px', height: '100px' } },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-image-empty"]', { timeout: 8_000 });

    // Element must be visible — NextImage renders a gray placeholder div when src is empty
    const el = sharedPage.locator('[data-builder-id="test-image-empty"]');
    await expect(el).toBeVisible();
    const box = await el.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    console.log('✅ Image with empty src renders gray placeholder');
  });

  test('PM-04: Image border-radius applies via className (rounded-full)', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-image',
      type: 'NextImage',
      src: 'https://placehold.co/600x400',
      props: { className: 'object-cover', style: { width: '200px', height: '200px' } },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-image"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    await scrollTo(sharedPage, 'select-corner-tl');
    for (const corner of ['tl', 'tr', 'br', 'bl']) {
      await sharedPage.locator(`[data-testid="select-corner-${corner}"]`).selectOption('rounded-full');
      await sharedPage.waitForTimeout(100);
    }

    const props = await getNodeProps(sharedPage, 'test-image');
    expect((props.className as string)).toContain('rounded-full');
    console.log('✅ Image rounded-full applied to className');
  });
});

// ─── PM-05..08 — NavIcon ──────────────────────────────────────────────────────

test.describe('PM — NavIcon', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PM-05: Drop NavIcon → appears on canvas with data-builder-id', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'NavIcon',
      props: { icon: 'Star', size: 24, color: '#6b7280' },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icon"]', { timeout: 8_000 });

    const el = sharedPage.locator('[data-builder-id="test-icon"]');
    await expect(el).toBeVisible();
    const box = await el.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    console.log('✅ NavIcon appears on canvas:', box!.width, '×', box!.height);
  });

  test('PM-06: NavIcon is selectable via layers panel', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'NavIcon',
      props: { icon: 'Star', size: 24, color: '#6b7280' },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icon"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBe('test-icon');

    // Right panel should show — at minimum Dimensions section is present
    await expect(sharedPage.locator('[data-testid="input-pos-w"]')).toBeAttached({ timeout: 5_000 });
    console.log('✅ NavIcon selectable, Dimensions shown in right panel');
  });

  test('PM-07: NavIcon W/H resize applies style.width and style.height', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'NavIcon',
      props: { icon: 'Star', size: 24, color: '#6b7280' },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icon"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    await sharedPage.locator('[data-testid="input-pos-w"]').fill('48');
    await sharedPage.waitForTimeout(200);
    await sharedPage.locator('[data-testid="input-pos-h"]').fill('48');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, 'test-icon');
    expect(style.width).toBe('48px');
    expect(style.height).toBe('48px');

    await expect(sharedPage.locator('[data-builder-id="test-icon"]')).toBeVisible();
    console.log('✅ NavIcon W=48 H=48 applied via style');
  });

  test('PM-08: NavIcon opacity 50% still visible after change', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'NavIcon',
      props: { icon: 'Heart', size: 32, color: '#ef4444' },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icon"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    await scrollTo(sharedPage, 'input-opacity-slider');
    const slider = sharedPage.locator('[data-testid="input-opacity-slider"]');
    await sharedPage.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, '50');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, await slider.elementHandle());
    await sharedPage.waitForTimeout(200);

    await expect(sharedPage.locator('[data-builder-id="test-icon"]')).toBeVisible();
    const style = await getNodeStyle(sharedPage, 'test-icon');
    expect(parseFloat(style.opacity)).toBeCloseTo(0.5, 1);
    console.log('✅ NavIcon opacity=0.5 applied, still visible');
  });
});

// ─── PM-09..10 — Icon Tap (Pressable + NavIcon) ───────────────────────────────

test.describe('PM — Icon Tap', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PM-09: Drop Icon Tap → outer Pressable appears on canvas', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icontap',
      type: 'Pressable',
      props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-secondary' },
      children: [{ id: 'test-icontap-icon', type: 'NavIcon', props: { icon: 'Star', size: 18, color: '#6b7280' } }],
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icontap"]', { timeout: 8_000 });

    await expect(sharedPage.locator('[data-builder-id="test-icontap"]')).toBeVisible();

    // NavIcon child should also have data-builder-id
    await sharedPage.waitForSelector('[data-builder-id="test-icontap-icon"]', { timeout: 5_000 });
    await expect(sharedPage.locator('[data-builder-id="test-icontap-icon"]')).toBeVisible();
    console.log('✅ Icon Tap: outer Pressable and inner NavIcon both on canvas');
  });

  test('PM-10: Select NavIcon child inside Icon Tap → Dimensions section shown', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icontap',
      type: 'Pressable',
      props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-secondary' },
      children: [{ id: 'test-icontap-icon', type: 'NavIcon', props: { icon: 'Star', size: 18, color: '#6b7280' } }],
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icontap-icon"]', { timeout: 8_000 });

    // Select the NavIcon child directly via store
    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { select: (id: string, additive: boolean) => void } }>).__builderStore
        .getState().select('test-icontap-icon', false);
    });
    await sharedPage.getByTestId('tab-right-design').click();
    await sharedPage.waitForTimeout(200);

    await expect(sharedPage.locator('[data-testid="input-pos-w"]')).toBeAttached({ timeout: 5_000 });
    console.log('✅ NavIcon child inside Icon Tap is independently selectable');
  });
});
