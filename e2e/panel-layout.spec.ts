/**
 * Layout & Misc Components Panel Tests
 *
 * Covers right-panel behavior for new layout and misc components:
 *   PL-01..03  Card        — container layout controls, W resize
 *   PL-04..05  Center      — container layout controls
 *   PL-06..07  Grid        — container layout controls
 *   PL-08      Divider     — renders as horizontal rule
 *   PL-09..10  Btn Destr.  — selectable, Btn Destructive bg color
 *   PL-11..13  Link        — Box+Text container, typography, no REQUIRED_PARENT
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

const LAYOUT_NODES: Record<string, unknown> = {
  Card: {
    id: 'test-card',
    type: 'Box',
    props: { className: 'rounded-lg border border-border bg-card p-4 w-full flex flex-col gap-2', style: { width: '280px', height: '120px' } },
    children: [
      { id: 'test-card-heading', type: 'Text', text: 'Card Title', props: { className: 'text-lg font-semibold text-foreground' } },
      { id: 'test-card-text', type: 'Text', text: 'Card content.', props: { className: 'text-sm text-muted-foreground' } },
    ],
  },
  Center: {
    id: 'test-center',
    type: 'Box',
    props: { className: 'flex items-center justify-center p-4 w-full', style: { width: '200px', height: '100px' } },
    children: [{ id: 'test-center-text', type: 'Text', text: 'Centered', props: { className: 'text-sm text-foreground' } }],
  },
  Grid: {
    id: 'test-grid',
    type: 'Box',
    props: { className: 'grid grid-cols-2 gap-4 w-full', style: { width: '300px', height: '120px' } },
    children: [
      { id: 'test-grid-item-1', type: 'Box', props: { className: 'bg-muted rounded p-4 min-h-[60px]' } },
      { id: 'test-grid-item-2', type: 'Box', props: { className: 'bg-muted rounded p-4 min-h-[60px]' } },
    ],
  },
  Divider: {
    id: 'test-divider',
    type: 'Box',
    props: { className: 'w-full h-px bg-border', style: { width: '200px', height: '1px' } },
  },
  'Btn Destructive': {
    id: 'test-btn-dest',
    type: 'Box',
    props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-destructive', style: { width: '120px', height: '40px' } },
    children: [{ id: 'test-btn-dest-text', type: 'Text', props: { className: 'text-sm font-medium text-destructive-foreground' }, text: 'Delete' }],
  },
  Link: {
    id: 'test-link',
    type: 'Box',
    props: { className: 'cursor-pointer', style: { width: '100px', height: '24px' } },
    children: [{ id: 'test-link-text', type: 'Text', text: 'Link text', props: { className: 'text-sm text-primary underline' } }],
  },
};

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

async function dropComponent(page: Page, label: string) {
  const node = LAYOUT_NODES[label];
  if (!node) throw new Error(`No default node defined for label: ${label}`);
  await injectNodes(page, [node]);
  await selectFirstNodeViaLayers(page);
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
  return page.evaluate((id: string) => {
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

async function scrollTo(page: Page, testId: string) {
  await page.evaluate((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, testId);
  await page.waitForTimeout(50);
}

// ─── PL-01..03 — Card (container) ────────────────────────────────────────────

test.describe('PL — Card', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PL-01: Drop Card → isContainer → Auto Layout section IS shown', async () => {
    await dropComponent(sharedPage, 'Card');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for Card (container)');
  });

  test('PL-02: Card W resize updates style.width', async () => {
    await dropComponent(sharedPage, 'Card');
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    await sharedPage.locator('[data-testid="input-pos-w"]').fill('320');
    await sharedPage.waitForTimeout(300);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.width).toBe('320px');
    console.log('✅ Card W resize to 320 → style.width = 320px');
  });

  test('PL-03: Card background color applies via style.backgroundColor', async () => {
    await dropComponent(sharedPage, 'Card');
    const nodeId = await getFirstNodeId(sharedPage);

    await scrollTo(sharedPage, 'input-bg-color');
    const bgInput = sharedPage.locator('[data-testid="input-bg-color"]');
    await bgInput.fill('#f8fafc');
    await bgInput.press('Tab');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.backgroundColor).toBe('#f8fafc');
    console.log('✅ Card background color #f8fafc applied');
  });
});

// ─── PL-04..05 — Center (container) ──────────────────────────────────────────

test.describe('PL — Center', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PL-04: Drop Center → isContainer → Auto Layout section IS shown', async () => {
    await dropComponent(sharedPage, 'Center');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for Center (container)');
  });

  test('PL-05: Center W/H resize applies inline style', async () => {
    await dropComponent(sharedPage, 'Center');
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    await sharedPage.locator('[data-testid="input-pos-w"]').fill('240');
    await sharedPage.waitForTimeout(200);
    await sharedPage.locator('[data-testid="input-pos-h"]').fill('120');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.width).toBe('240px');
    expect(style.height).toBe('120px');
    console.log('✅ Center W=240 H=120 applied via inline style');
  });
});

// ─── PL-06..07 — Grid (container) ────────────────────────────────────────────

test.describe('PL — Grid', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PL-06: Drop Grid → isContainer → Auto Layout section IS shown', async () => {
    await dropComponent(sharedPage, 'Grid');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for Grid (container)');
  });

  test('PL-07: Grid has two GridItem children in the layer tree', async () => {
    await injectNodes(sharedPage, [LAYOUT_NODES['Grid'] as unknown as object]);
    await sharedPage.getByTestId('tab-layers').click();
    await sharedPage.waitForTimeout(200);

    const layerRows = sharedPage.locator('[data-testid="layer-row"]');
    const count = await layerRows.count();
    expect(count).toBeGreaterThanOrEqual(3); // Grid + 2 GridItems
    console.log(`✅ Grid has ${count} layer rows (Grid + GridItems)`);
  });
});

// ─── PL-08 — Divider ─────────────────────────────────────────────────────────

test.describe('PL — Divider', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PL-08: Drop Divider (Box h-px) → selectable and has correct height', async () => {
    await dropComponent(sharedPage, 'Divider');
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    await expect(sharedPage.locator(`[data-builder-id="${nodeId}"]`)).toBeVisible();

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.height).toBe('1px');
    console.log('✅ Divider (Box h-px) selectable, style.height = 1px');
  });
});

// ─── PL-09..10 — Btn Destructive ─────────────────────────────────────────────

test.describe('PL — Btn Destructive', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PL-09: Drop Btn Destructive → selectable, isContainer → Auto Layout shown', async () => {
    await dropComponent(sharedPage, 'Btn Destructive');
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Btn Destructive selectable, Auto Layout shown (Box = container)');
  });

  test('PL-10: Btn Destructive background color #dc2626 applies via style', async () => {
    await dropComponent(sharedPage, 'Btn Destructive');
    const nodeId = await getFirstNodeId(sharedPage);

    await scrollTo(sharedPage, 'input-bg-color');
    const bgInput = sharedPage.locator('[data-testid="input-bg-color"]');
    await bgInput.fill('#dc2626');
    await bgInput.press('Tab');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.backgroundColor).toBe('#dc2626');
    console.log('✅ Btn Destructive background color #dc2626 applied');
  });
});

// ─── PL-11..13 — Link (Box + Text, cursor-pointer) ──────────────────────────

test.describe('PL — Link', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PL-11: Drop Link (Box) → isContainer → Auto Layout section IS shown', async () => {
    await dropComponent(sharedPage, 'Link');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for Link Box (container)');
  });

  test('PL-12: Select Text child of Link → Typography section IS shown', async () => {
    await injectNodes(sharedPage, [LAYOUT_NODES['Link'] as unknown as object]);
    await sharedPage.waitForSelector('[data-builder-id="test-link-text"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { select: (id: string, additive: boolean) => void } }>).__builderStore
        .getState().select('test-link-text', false);
    });
    await sharedPage.getByTestId('tab-right-design').click();
    await sharedPage.waitForTimeout(200);

    const textColorInput = sharedPage.locator('[data-testid="input-text-color"]');
    await expect(textColorInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Typography section shown when Text child of Link is selected');
  });

  test('PL-13: Text child of Link can be moved to root (no REQUIRED_PARENT restriction)', async () => {
    await injectNodes(sharedPage, [LAYOUT_NODES['Link'] as unknown as object]);
    await sharedPage.waitForSelector('[data-builder-id="test-link"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { moveNode: (id: string, parent: string | null, idx: number) => void } }>).__builderStore
        .getState().moveNode('test-link-text', null, 0);
    });
    await sharedPage.waitForTimeout(200);

    const rootTypes = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ type: string }> } }>).__builderStore.getState();
      return store.pageNodes.map(n => n.type);
    });
    expect(rootTypes).toContain('Text');
    console.log('✅ Text child of Link moved to root freely (Box has no REQUIRED_PARENT restriction)');
  });
});

// ─── PL-14..19 — Tier 3 Layout/Media Widgets ─────────────────────────────────

test.describe('PL — Tier 3 Layout & Media', () => {
  test.setTimeout(120_000);

  const TIER3_NODES: Record<string, unknown> = {
    ScrollView: {
      id: 'test-scrollview',
      type: 'Box',
      props: { className: 'flex flex-col gap-4 overflow-auto w-full', style: { maxHeight: '200px', width: '300px', height: '200px' } },
      children: [{ id: 'test-sv-text', type: 'Text', text: 'Scroll content', props: { className: 'text-sm text-foreground' } }],
    },
    Table: {
      id: 'test-table',
      type: 'Box',
      props: { className: 'w-full overflow-hidden rounded-md border border-border', style: { width: '360px', height: '100px' } },
      children: [
        {
          id: 'test-table-header',
          type: 'Box',
          props: { className: 'flex flex-row bg-muted' },
          children: [
            { id: 'test-table-col-1', type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ id: 'test-table-h1', type: 'Text', props: { className: 'text-xs font-semibold' }, text: 'Name' }] },
            { id: 'test-table-col-2', type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ id: 'test-table-h2', type: 'Text', props: { className: 'text-xs font-semibold' }, text: 'Status' }] },
          ],
        },
      ],
    },
    Iframe: {
      id: 'test-iframe',
      type: 'Iframe',
      props: { title: 'Embedded', style: { width: '400px', height: '240px' } },
    },
    Chart: {
      id: 'test-chart',
      type: 'Chart',
      props: { chartType: 'bar', style: { width: '340px', height: '260px' } },
    },
    MarkdownViewer: {
      id: 'test-markdown',
      type: 'MarkdownViewer',
      props: { style: { width: '360px' } },
    },
    QRCodeWidget: {
      id: 'test-qr',
      type: 'QRCodeWidget',
      props: { value: 'https://example.com', size: 160 },
    },
    GoogleMap: {
      id: 'test-google-map',
      type: 'GoogleMap',
      props: { lat: 37.7749, lng: -122.4194, zoom: 13, style: { width: '400px', height: '280px' } },
    },
  };

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  async function injectT3(page: Page, key: string) {
    const node = TIER3_NODES[key] as { id?: string };
    if (!node) throw new Error(`Unknown tier3 node: ${key}`);
    await page.evaluate((ns) => {
      (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore
        .getState()._setPageNodes(ns);
    }, [node]);
    const nodeId = node.id;
    if (nodeId) {
      await page.waitForSelector(`[data-builder-id="${nodeId}"]`, { timeout: 10_000 });
    } else {
      await page.locator('[data-builder-id]').first().waitFor({ state: 'visible', timeout: 10_000 });
    }
    await page.getByTestId('tab-layers').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="layer-row"]').first().click();
    await page.getByTestId('tab-right-design').click();
    await page.waitForTimeout(200);
  }

  test('PL-14: ScrollView (Box) → isContainer → Auto Layout shown', async () => {
    await injectT3(sharedPage, 'ScrollView');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ ScrollView (Box) is container');
  });

  test('PL-15: Table (Box) → isContainer → Auto Layout shown', async () => {
    await injectT3(sharedPage, 'Table');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Table (Box) is container');
  });

  test('PL-16: Iframe → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectT3(sharedPage, 'Iframe');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Iframe is leaf widget — no Auto Layout');
  });

  test('PL-18: Chart → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectT3(sharedPage, 'Chart');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Chart is leaf widget — no Auto Layout');
  });

  test('PL-19: MarkdownViewer → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectT3(sharedPage, 'MarkdownViewer');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ MarkdownViewer is leaf widget — no Auto Layout');
  });

  test('PL-20: QRCodeWidget → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectT3(sharedPage, 'QRCodeWidget');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ QRCodeWidget is leaf widget — no Auto Layout');
  });

  test('PL-21: GoogleMap → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectT3(sharedPage, 'GoogleMap');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ GoogleMap is leaf widget — no Auto Layout');
  });

  test('PL-22: Iframe renders gray placeholder when no src set', async () => {
    await injectT3(sharedPage, 'Iframe');
    const el = sharedPage.locator('[data-builder-id="test-iframe"]');
    await expect(el).toBeVisible({ timeout: 5_000 });
    const text = await el.textContent();
    expect(text).toContain('No URL set');
    console.log('✅ Iframe shows placeholder text when src is empty');
  });

  test('PL-23: GoogleMap renders placeholder when no apiKey set', async () => {
    await injectT3(sharedPage, 'GoogleMap');
    const el = sharedPage.locator('[data-builder-id="test-google-map"]');
    await expect(el).toBeVisible({ timeout: 5_000 });
    const text = await el.textContent();
    expect(text).toContain('Google Map');
    console.log('✅ GoogleMap shows placeholder text when apiKey is missing');
  });
});
