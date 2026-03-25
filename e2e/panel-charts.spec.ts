/**
 * Charts & Data Visualization Panel Tests (Tier 4)
 *
 * Covers right-panel behavior for library-dependent components:
 *   PC-01  Chart        — isLeafWidget, renders in canvas
 *   PC-02  QRCodeWidget — isLeafWidget, renders QR when value set
 *   PC-03  MarkdownViewer — isLeafWidget, renders placeholder content
 *   PC-04  GoogleMap    — isLeafWidget, shows placeholder when no apiKey
 *   PC-05  GoogleMapPlaces — isLeafWidget
 *
 * Each describe block shares ONE browser page and resets canvas in beforeEach.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="tab-components"]', { timeout: 15_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 100 },
  );
}

async function clearCanvas(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>)
      .__builderStore.getState()._setPageNodes([]);
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-builder-id]').length === 0,
    { timeout: 5_000 },
  );
}

async function injectNodes(page: Page, nodes: unknown[]) {
  await page.evaluate((ns) => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore
      .getState()._setPageNodes(ns);
  }, nodes);
  const firstId = (nodes[0] as { id?: string })?.id;
  if (firstId) {
    await page.waitForSelector(`[data-builder-id="${firstId}"]`, { timeout: 15_000 });
  } else {
    await page.locator('[data-builder-id]').first().waitFor({ state: 'visible', timeout: 15_000 });
  }
}

async function selectFirstNodeViaLayers(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="layer-row"]').first().click();
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(200);
}

// ─── Chart test nodes ─────────────────────────────────────────────────────────

const CHART_NODES: Record<string, unknown> = {
  Chart: {
    id: 'test-chart',
    type: 'Chart',
    props: { chartType: 'bar', style: { width: '340px', height: '260px' } },
  },
  ChartLine: {
    id: 'test-chart-line',
    type: 'Chart',
    props: { chartType: 'line', style: { width: '340px', height: '260px' } },
  },
  ChartPie: {
    id: 'test-chart-pie',
    type: 'Chart',
    props: { chartType: 'pie', style: { width: '340px', height: '260px' } },
  },
  QRCodeWidget: {
    id: 'test-qr',
    type: 'QRCodeWidget',
    props: { value: 'https://example.com', size: 160 },
  },
  QRCodeWidgetEmpty: {
    id: 'test-qr-empty',
    type: 'QRCodeWidget',
    props: { size: 160 },
  },
  MarkdownViewer: {
    id: 'test-markdown',
    type: 'MarkdownViewer',
    props: { style: { width: '360px' } },
  },
  MarkdownViewerContent: {
    id: 'test-markdown-content',
    type: 'MarkdownViewer',
    props: { content: '## Hello\n\nThis is **bold** text.', style: { width: '360px' } },
  },
  GoogleMap: {
    id: 'test-google-map',
    type: 'GoogleMap',
    props: { lat: 37.7749, lng: -122.4194, zoom: 13, style: { width: '400px', height: '280px' } },
  },
  GoogleMapPlaces: {
    id: 'test-google-map-places',
    type: 'GoogleMapPlaces',
    props: { placeholder: 'Search for a place…', style: { width: '320px' } },
  },
};

// ─── PC-01..05 — Tier 4 Chart & Data Components ───────────────────────────────

test.describe('PC — Charts & Data', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PC-01: Chart (bar) → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectNodes(sharedPage, [CHART_NODES['Chart'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Chart is leaf widget — no Auto Layout');
  });

  test('PC-02: Chart renders in canvas (bar type)', async () => {
    await injectNodes(sharedPage, [CHART_NODES['Chart'] as unknown as object]);
    const el = sharedPage.locator('[data-builder-id="test-chart"]');
    await expect(el).toBeVisible({ timeout: 8_000 });
    console.log('✅ Chart renders in canvas');
  });

  test('PC-03: Chart (line) renders in canvas', async () => {
    await injectNodes(sharedPage, [CHART_NODES['ChartLine'] as unknown as object]);
    const el = sharedPage.locator('[data-builder-id="test-chart-line"]');
    await expect(el).toBeVisible({ timeout: 8_000 });
    console.log('✅ Line chart renders in canvas');
  });

  test('PC-04: Chart (pie) renders in canvas', async () => {
    await injectNodes(sharedPage, [CHART_NODES['ChartPie'] as unknown as object]);
    const el = sharedPage.locator('[data-builder-id="test-chart-pie"]');
    await expect(el).toBeVisible({ timeout: 8_000 });
    console.log('✅ Pie chart renders in canvas');
  });

  test('PC-05: QRCodeWidget → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectNodes(sharedPage, [CHART_NODES['QRCodeWidget'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ QRCodeWidget is leaf widget — no Auto Layout');
  });

  test('PC-06: QRCodeWidget with value renders SVG QR code', async () => {
    await injectNodes(sharedPage, [CHART_NODES['QRCodeWidget'] as unknown as object]);
    const el = sharedPage.locator('[data-builder-id="test-qr"]');
    await expect(el).toBeVisible({ timeout: 8_000 });
    const svg = el.locator('svg').first();
    await expect(svg).toBeVisible({ timeout: 5_000 });
    console.log('✅ QRCodeWidget renders SVG when value is set');
  });

  test('PC-07: QRCodeWidget without value shows placeholder', async () => {
    await injectNodes(sharedPage, [CHART_NODES['QRCodeWidgetEmpty'] as unknown as object]);
    const el = sharedPage.locator('[data-builder-id="test-qr-empty"]');
    await expect(el).toBeVisible({ timeout: 5_000 });
    const text = await el.textContent();
    expect(text).toContain('No value set');
    console.log('✅ QRCodeWidget shows placeholder when no value');
  });

  test('PC-08: MarkdownViewer → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectNodes(sharedPage, [CHART_NODES['MarkdownViewer'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ MarkdownViewer is leaf widget — no Auto Layout');
  });

  test('PC-09: MarkdownViewer renders placeholder markdown when no content', async () => {
    await injectNodes(sharedPage, [CHART_NODES['MarkdownViewer'] as unknown as object]);
    const el = sharedPage.locator('[data-builder-id="test-markdown"]');
    await expect(el).toBeVisible({ timeout: 8_000 });
    const heading = el.locator('h2').first();
    await expect(heading).toBeVisible({ timeout: 5_000 });
    console.log('✅ MarkdownViewer renders default placeholder markdown');
  });

  test('PC-10: MarkdownViewer renders custom content prop', async () => {
    await injectNodes(sharedPage, [CHART_NODES['MarkdownViewerContent'] as unknown as object]);
    const el = sharedPage.locator('[data-builder-id="test-markdown-content"]');
    await expect(el).toBeVisible({ timeout: 8_000 });
    const heading = el.locator('h2').first();
    await expect(heading).toHaveText('Hello', { timeout: 5_000 });
    console.log('✅ MarkdownViewer renders custom content correctly');
  });

  test('PC-11: GoogleMap → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectNodes(sharedPage, [CHART_NODES['GoogleMap'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ GoogleMap is leaf widget — no Auto Layout');
  });

  test('PC-12: GoogleMap renders placeholder when no apiKey', async () => {
    await injectNodes(sharedPage, [CHART_NODES['GoogleMap'] as unknown as object]);
    const el = sharedPage.locator('[data-builder-id="test-google-map"]');
    await expect(el).toBeVisible({ timeout: 5_000 });
    const text = await el.textContent();
    expect(text).toContain('Google Map');
    console.log('✅ GoogleMap placeholder rendered without apiKey');
  });

  test('PC-13: GoogleMapPlaces → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectNodes(sharedPage, [CHART_NODES['GoogleMapPlaces'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ GoogleMapPlaces is leaf widget — no Auto Layout');
  });

  test('PC-14: GoogleMapPlaces shows search input placeholder when no apiKey', async () => {
    await injectNodes(sharedPage, [CHART_NODES['GoogleMapPlaces'] as unknown as object]);
    const el = sharedPage.locator('[data-builder-id="test-google-map-places"]');
    await expect(el).toBeVisible({ timeout: 5_000 });
    const text = await el.textContent();
    expect(text).toContain('Search for a place');
    console.log('✅ GoogleMapPlaces shows placeholder without apiKey');
  });
});
