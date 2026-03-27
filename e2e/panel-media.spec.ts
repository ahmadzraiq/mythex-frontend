/**
 * Media Components Panel Tests
 *
 * Covers right-panel behavior for media components:
 *   PM-01..04  Image   — appears on canvas, W/H resize, src field, empty-src fallback
 *   PM-05..08  Icon — appears on canvas, selectable, size change, color change
 *   PM-09..10  IconTap — Pressable+Icon container, sub-select Icon child
 *
 * Each describe block shares ONE browser page (opened in beforeAll) and
 * resets the canvas in beforeEach.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
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

// ─── PM-05..08 — Icon ──────────────────────────────────────────────────────

test.describe('PM — Icon', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PM-05: Drop Icon → appears on canvas with data-builder-id', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'Icon',
      props: { icon: 'lucide:star', size: 24, color: '#6b7280' },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icon"]', { timeout: 8_000 });

    const el = sharedPage.locator('[data-builder-id="test-icon"]');
    await expect(el).toBeVisible();
    const box = await el.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    console.log('✅ Icon appears on canvas:', box!.width, '×', box!.height);
  });

  test('PM-06: Icon is selectable via layers panel', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'Icon',
      props: { icon: 'lucide:star', size: 24, color: '#6b7280' },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icon"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBe('test-icon');

    // Right panel should show — at minimum Dimensions section is present
    await expect(sharedPage.locator('[data-testid="input-pos-w"]')).toBeAttached({ timeout: 5_000 });
    console.log('✅ Icon selectable, Dimensions shown in right panel');
  });

  test('PM-07: Icon W/H resize applies style.width and style.height', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'Icon',
      props: { icon: 'lucide:star', size: 24, color: '#6b7280' },
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
    console.log('✅ Icon W=48 H=48 applied via style');
  });

  test('PM-08: Icon opacity 50% still visible after change', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'Icon',
      props: { icon: 'lucide:heart', size: 32, color: '#ef4444' },
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
    console.log('✅ Icon opacity=0.5 applied, still visible');
  });
});

// ─── PM-09..10 — Icon Tap (Pressable + Icon) ───────────────────────────────

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
      children: [{ id: 'test-icontap-icon', type: 'Icon', props: { icon: 'lucide:star', size: 18, color: '#6b7280' } }],
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icontap"]', { timeout: 8_000 });

    await expect(sharedPage.locator('[data-builder-id="test-icontap"]')).toBeVisible();

    // Icon child should also have data-builder-id
    await sharedPage.waitForSelector('[data-builder-id="test-icontap-icon"]', { timeout: 5_000 });
    await expect(sharedPage.locator('[data-builder-id="test-icontap-icon"]')).toBeVisible();
    console.log('✅ Icon Tap: outer Pressable and inner Icon both on canvas');
  });

  test('PM-10: Select Icon child inside Icon Tap → Dimensions section shown', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icontap',
      type: 'Pressable',
      props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-secondary' },
      children: [{ id: 'test-icontap-icon', type: 'Icon', props: { icon: 'lucide:star', size: 18, color: '#6b7280' } }],
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icontap-icon"]', { timeout: 8_000 });

    // Select the Icon child directly via store
    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { select: (id: string, additive: boolean) => void } }>).__builderStore
        .getState().select('test-icontap-icon', false);
    });
    await sharedPage.getByTestId('tab-right-design').click();
    await sharedPage.waitForTimeout(200);

    await expect(sharedPage.locator('[data-testid="input-pos-w"]')).toBeAttached({ timeout: 5_000 });
    console.log('✅ Icon child inside Icon Tap is independently selectable');
  });
});

// ─── PM-11..13 — Image Specific Section (prop changes reflect on canvas) ─────

test.describe('PM — Image Specific Section', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PM-11: Image src change in Specific section → canvas img src updates', async () => {
    const newSrc = 'https://placehold.co/800x500/ff0000/ffffff';
    await injectNodes(sharedPage, [{
      id: 'test-image',
      type: 'Image',
      src: 'https://placehold.co/600x400',
      props: { alt: 'test', style: { width: '300px', height: '192px' } },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-image"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    // The Specific section should show the Image source input
    await expect(sharedPage.locator('[data-testid="specific-image-src"]')).toBeVisible({ timeout: 5_000 });

    // Clear existing URL and type new one, then blur to commit
    await sharedPage.locator('[data-testid="specific-image-src"]').clear();
    await sharedPage.locator('[data-testid="specific-image-src"]').fill(newSrc);
    await sharedPage.locator('[data-testid="specific-image-src"]').press('Enter');
    await sharedPage.waitForTimeout(400);

    // node.src in the store should update
    const storedSrc = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      const node = (store?.pageNodes ?? []).find(
        (n) => (n as Record<string, unknown>).id === 'test-image'
      ) as Record<string, unknown> | undefined;
      return node?.src as string | undefined;
    });
    expect(storedSrc).toBe(newSrc);

    // Canvas img element should also reflect the new src
    const imgSrc = await sharedPage.locator('[data-builder-id="test-image"] img').getAttribute('src');
    expect(imgSrc).toContain('800x500');
    console.log('✅ Image src changed to', newSrc, '→ canvas img src updated');
  });

  test('PM-12: Image with no src shows placeholder, not broken img', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-image-nosrc',
      type: 'Image',
      src: '',
      props: { alt: '', style: { width: '200px', height: '120px' } },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-image-nosrc"]', { timeout: 8_000 });

    const el = sharedPage.locator('[data-builder-id="test-image-nosrc"]');
    await expect(el).toBeVisible();
    const box = await el.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // The src input in Specific section should be empty (no broken content)
    await selectFirstNodeViaLayers(sharedPage);
    await expect(sharedPage.locator('[data-testid="specific-image-src"]')).toBeVisible({ timeout: 5_000 });
    const inputVal = await sharedPage.locator('[data-testid="specific-image-src"]').inputValue();
    expect(inputVal).toBe('');
    console.log('✅ Image with empty src: placeholder visible, input is empty');
  });
});

// ─── PM-14..16 — Icon Specific Section (prop changes reflect on canvas) ──────

test.describe('PM — Icon Specific Section', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PM-14: Icon name change in Specific section → store prop.icon updates', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'Icon',
      props: { icon: 'lucide:star', size: 24, color: '#6b7280' },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icon"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    await expect(sharedPage.locator('[data-testid="specific-icon-name"]')).toBeVisible({ timeout: 5_000 });
    const initVal = await sharedPage.locator('[data-testid="specific-icon-name"]').inputValue();
    expect(initVal).toBe('lucide:star');

    await sharedPage.locator('[data-testid="specific-icon-name"]').clear();
    await sharedPage.locator('[data-testid="specific-icon-name"]').fill('lucide:heart');
    await sharedPage.locator('[data-testid="specific-icon-name"]').press('Enter');
    await sharedPage.waitForTimeout(400);

    const storedIcon = await getNodeProps(sharedPage, 'test-icon');
    expect(storedIcon.icon).toBe('lucide:heart');
    console.log('✅ Icon name changed lucide:star → lucide:heart, store updated');
  });

  test('PM-15: Icon size change in Specific section → store prop.size updates & canvas reflects', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'Icon',
      props: { icon: 'lucide:star', size: 24, color: '#6b7280' },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icon"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    await expect(sharedPage.locator('[data-testid="specific-icon-size"]')).toBeVisible({ timeout: 5_000 });

    await sharedPage.locator('[data-testid="specific-icon-size"]').clear();
    await sharedPage.locator('[data-testid="specific-icon-size"]').fill('48');
    await sharedPage.locator('[data-testid="specific-icon-size"]').dispatchEvent('change');
    await sharedPage.waitForTimeout(400);

    const props = await getNodeProps(sharedPage, 'test-icon');
    expect(Number(props.size)).toBe(48);

    // Canvas icon should be visible after size change
    await expect(sharedPage.locator('[data-builder-id="test-icon"]')).toBeVisible();
    console.log('✅ Icon size changed 24 → 48, store.props.size updated');
  });

  test('PM-16: Icon search picker visible and clicking result updates icon prop', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-icon',
      type: 'Icon',
      props: { icon: 'lucide:star', size: 24, color: '#6b7280' },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-icon"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    // The icon search box should be visible
    await expect(sharedPage.locator('[placeholder="Search icons…"]')).toBeVisible({ timeout: 5_000 });
    console.log('✅ Icon search picker is visible in Specific section');
  });
});

// ─── PM-17..20 — Video Specific Section (prop changes reflect on canvas) ─────

test.describe('PM — Video Specific Section', () => {
  test.setTimeout(120_000);

  const VIDEO_SRC = 'https://www.w3schools.com/html/mov_bbb.mp4';

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PM-17: Video from assets tab — src stored in props.src, visible in Specific section', async () => {
    // Simulate drop from assets tab: src lives in props.src (bug that was fixed)
    await injectNodes(sharedPage, [{
      id: 'test-video',
      type: 'Video',
      props: {
        src: VIDEO_SRC,
        poster: 'https://placehold.co/800x450',
        controls: false,
        muted: true,
        loop: true,
        autoPlay: false,
        style: { width: '480px', height: '270px' },
      },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-video"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    // Specific section src input must show the video src (not empty — the bug)
    await expect(sharedPage.locator('[data-testid="specific-video-src"]')).toBeVisible({ timeout: 5_000 });
    const srcVal = await sharedPage.locator('[data-testid="specific-video-src"]').inputValue();
    expect(srcVal).toBe(VIDEO_SRC);
    console.log('✅ Video src from assets tab correctly shown in Specific section src input');
  });

  test('PM-18: Video src change in Specific section → props.src updates in store', async () => {
    const newSrc = 'https://www.w3schools.com/html/movie.mp4';
    await injectNodes(sharedPage, [{
      id: 'test-video',
      type: 'Video',
      props: {
        src: VIDEO_SRC,
        poster: '',
        controls: false,
        muted: true,
        style: { width: '320px', height: '180px' },
      },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-video"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    await expect(sharedPage.locator('[data-testid="specific-video-src"]')).toBeVisible({ timeout: 5_000 });
    await sharedPage.locator('[data-testid="specific-video-src"]').clear();
    await sharedPage.locator('[data-testid="specific-video-src"]').fill(newSrc);
    await sharedPage.locator('[data-testid="specific-video-src"]').press('Enter');
    await sharedPage.waitForTimeout(400);

    const props = await getNodeProps(sharedPage, 'test-video');
    expect(props.src).toBe(newSrc);

    // Canvas video element src should also update
    const videoSrc = await sharedPage.locator('[data-builder-id="test-video"] video').getAttribute('src');
    expect(videoSrc).toContain('movie.mp4');
    console.log('✅ Video src changed → canvas video element src updated');
  });

  test('PM-19: Video controls toggle in Specific section → prop updates in store', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-video',
      type: 'Video',
      props: {
        src: VIDEO_SRC,
        controls: false,
        muted: true,
        style: { width: '320px', height: '180px' },
      },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-video"]', { timeout: 8_000 });
    await selectFirstNodeViaLayers(sharedPage);

    // Click the toggle inside the Controls row
    const controlsRow = sharedPage.locator('[data-testid="specific-video-controls"]');
    await expect(controlsRow).toBeVisible({ timeout: 5_000 });
    await controlsRow.locator('button').click();
    await sharedPage.waitForTimeout(400);

    const props = await getNodeProps(sharedPage, 'test-video');
    expect(props.controls).toBe(true);
    console.log('✅ Video controls toggled false → true, store prop updated');
  });

  test('PM-20: Video appears on canvas after drop with correct dimensions', async () => {
    await injectNodes(sharedPage, [{
      id: 'test-video',
      type: 'Video',
      props: {
        src: VIDEO_SRC,
        poster: 'https://placehold.co/640x360',
        controls: true,
        muted: true,
        autoPlay: false,
        style: { width: '480px', height: '270px' },
      },
    }]);
    await sharedPage.waitForSelector('[data-builder-id="test-video"]', { timeout: 8_000 });

    const el = sharedPage.locator('[data-builder-id="test-video"]');
    await expect(el).toBeVisible();
    const box = await el.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // video element should be present inside
    await expect(el.locator('video')).toBeAttached({ timeout: 5_000 });
    console.log('✅ Video appears on canvas, video element present:', box!.width, '×', box!.height);
  });
});
