/**
 * Builder Assets Panel E2E Tests
 *
 * Run with:  npx playwright test e2e/builder-assets.spec.ts
 *
 * Tests covered:
 *   BA-01  Assets tab exists in the left panel
 *   BA-02  Stock sub-tab shows by default with Unsplash/Pexels provider buttons
 *   BA-03  Unsplash loads images on mount (no empty state immediately)
 *   BA-04  Search field is visible and interactive
 *   BA-05  Typing a search query triggers a new fetch (intercepted via route mock)
 *   BA-06  Image grid renders thumbnails
 *   BA-07  Switching to Pexels provider shows Pexels results
 *   BA-08  Pexels shows Photos/Videos toggle
 *   BA-09  Icons tab shows category list with category rows
 *   BA-10  Icon search returns results with a count badge
 *   BA-11  API is NOT called infinitely (no more than 2 calls on mount)
 *   BA-12  Clicking an image inserts a NextImage node onto the canvas
 *   BA-13  Dragging an image onto the canvas inserts a NextImage node
 */

import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://builder-dev.localhost:3001';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto(BASE);
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 },
  );
  await page.waitForTimeout(400);
}

/** Mock both asset API routes to return controlled fixture data. */
async function mockAssetAPIs(page: Page) {
  // Unsplash mock
  await page.route('**/api/builder/assets/unsplash**', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: Array.from({ length: 6 }, (_, i) => ({
          id: `unsplash-${i}`,
          type: 'photo',
          thumbnail: `https://picsum.photos/seed/${i}/200/150`,
          src: `https://picsum.photos/seed/${i}/800/600`,
          full: `https://picsum.photos/seed/${i}/1600/1200`,
          alt: `Test photo ${i}`,
          width: 800,
          height: 600,
          author: `Author ${i}`,
          authorUrl: 'https://unsplash.com',
        })),
        total: 6,
        page: 1,
      }),
    });
  });

  // Pexels mock
  await page.route('**/api/builder/assets/pexels**', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: Array.from({ length: 4 }, (_, i) => ({
          id: `pexels-${i}`,
          type: 'photo',
          thumbnail: `https://picsum.photos/seed/p${i}/200/150`,
          src: `https://picsum.photos/seed/p${i}/800/600`,
          full: `https://picsum.photos/seed/p${i}/1600/1200`,
          alt: `Pexels photo ${i}`,
          width: 800,
          height: 600,
          author: `Pexels Author ${i}`,
          authorUrl: 'https://pexels.com',
        })),
        total: 4,
        page: 1,
      }),
    });
  });

  // Iconify collections mock
  await page.route('https://api.iconify.design/collections**', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        lucide: { name: 'Lucide', total: 1300 },
        mdi: { name: 'Material Design Icons', total: 7500 },
        tabler: { name: 'Tabler Icons', total: 4200 },
        'ph': { name: 'Phosphor', total: 6900 },
        fa: { name: 'Font Awesome', total: 2000 },
      }),
    });
  });

  // Iconify search mock
  await page.route('https://api.iconify.design/search**', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        icons: ['lucide:arrow-right', 'lucide:arrow-left', 'mdi:account', 'tabler:home'],
        total: 9302,
        collections: {
          lucide: { name: 'Lucide' },
          mdi: { name: 'Material Design Icons' },
          tabler: { name: 'Tabler Icons' },
        },
      }),
    });
  });

  // Iconify collection detail mock
  await page.route('https://api.iconify.design/collection**', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        icons: Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [`icon-${i}`, {}]),
        ),
      }),
    });
  });
}

async function openAssetsTab(page: Page) {
  const assetsTab = page.getByTestId('tab-assets');
  await expect(assetsTab).toBeVisible({ timeout: 5_000 });
  await assetsTab.click();
  await page.waitForTimeout(200);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

let sharedPage: Page;

test.describe('BA – Builder Assets Panel', () => {
  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    await mockAssetAPIs(sharedPage);
    await gotoBuilder(sharedPage);
  });

  test.afterAll(async () => {
    await sharedPage.close();
  });

  // ── Tab existence ────────────────────────────────────────────────────────────

  test('BA-01 Assets tab exists in the left panel', async () => {
    const tab = sharedPage.getByTestId('tab-assets');
    await expect(tab).toBeVisible();
    await expect(tab).toHaveText(/assets/i);
  });

  test('BA-02 Stock sub-tab shows with Unsplash and Pexels provider buttons', async () => {
    await openAssetsTab(sharedPage);
    await expect(sharedPage.locator('button', { hasText: /unsplash/i })).toBeVisible();
    await expect(sharedPage.locator('button', { hasText: /pexels/i })).toBeVisible();
  });

  // ── Stock panel ──────────────────────────────────────────────────────────────

  test('BA-03 Unsplash loads images on mount (grid is not empty)', async () => {
    await openAssetsTab(sharedPage);
    // Wait for at least one thumbnail to appear
    await expect(sharedPage.locator('[data-testid="tab-assets"]')).toBeVisible();
    await sharedPage.waitForFunction(
      () => document.querySelectorAll('img[src*="picsum"]').length > 0,
      { timeout: 8_000 },
    );
    const imgs = sharedPage.locator('img[src*="picsum"]');
    await expect(imgs.first()).toBeVisible();
  });

  test('BA-04 Search input is visible and accepts text', async () => {
    await openAssetsTab(sharedPage);
    const searchInput = sharedPage.locator('input[placeholder*="unsplash" i]').or(
      sharedPage.locator('input[placeholder*="Search" i]').first()
    );
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill('coffee');
    await expect(searchInput).toHaveValue('coffee');
  });

  test('BA-05 Typing triggers a new API call (request count increases)', async () => {
    // Fresh page for this test to count requests cleanly
    const p = await sharedPage.context().newPage();
    await mockAssetAPIs(p);

    let callCount = 0;
    await p.route('**/api/builder/assets/unsplash**', route => {
      callCount++;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], total: 0, page: 1 }),
      });
    });

    await gotoBuilder(p);
    const tab = p.getByTestId('tab-assets');
    await tab.click();
    await p.waitForTimeout(800); // allow initial mount fetch to settle

    const beforeSearch = callCount;

    const searchInput = p.locator('input[placeholder*="Search" i]').first();
    await searchInput.fill('coffee shop');
    await p.waitForTimeout(600); // debounce 400ms + buffer

    expect(callCount).toBeGreaterThan(beforeSearch);
    await p.close();
  });

  test('BA-06 Image thumbnails render in the grid', async () => {
    await openAssetsTab(sharedPage);
    await sharedPage.waitForFunction(
      () => document.querySelectorAll('img[src*="picsum"]').length > 0,
      { timeout: 8_000 },
    );
    const imgs = sharedPage.locator('img[src*="picsum"]');
    const count = await imgs.count();
    expect(count).toBeGreaterThan(0);
  });

  test('BA-07 Switching to Pexels shows Pexels results', async () => {
    await openAssetsTab(sharedPage);
    const pexelsBtn = sharedPage.locator('button', { hasText: /pexels/i });
    await pexelsBtn.click();
    await sharedPage.waitForFunction(
      () => document.querySelectorAll('img[src*="picsum"]').length > 0,
      { timeout: 8_000 },
    );
    // Pexels mock returns 4 items; verify grid is non-empty
    const imgs = sharedPage.locator('img[src*="picsum"]');
    await expect(imgs.first()).toBeVisible();
  });

  test('BA-08 Pexels shows Photos / Videos toggle', async () => {
    await openAssetsTab(sharedPage);
    const pexelsBtn = sharedPage.locator('button', { hasText: /pexels/i });
    await pexelsBtn.click();
    await expect(sharedPage.locator('button', { hasText: /photos/i })).toBeVisible();
    await expect(sharedPage.locator('button', { hasText: /videos/i })).toBeVisible();
  });

  // ── Icons panel ──────────────────────────────────────────────────────────────

  test('BA-09 Icons tab shows category list', async () => {
    await openAssetsTab(sharedPage);
    // Click the Icons sub-tab
    const iconsSubTab = sharedPage.locator('button', { hasText: /^icons$/i });
    await iconsSubTab.click();
    await sharedPage.waitForTimeout(600); // collections fetch

    // At least one category row should appear
    await expect(sharedPage.locator('button', { hasText: /lucide/i }).first()).toBeVisible({ timeout: 6_000 });
  });

  test('BA-10 Icon search shows count badge', async () => {
    await openAssetsTab(sharedPage);
    const iconsSubTab = sharedPage.locator('button', { hasText: /^icons$/i });
    await iconsSubTab.click();

    const iconSearch = sharedPage.locator('input[placeholder*="Search icons" i]');
    await expect(iconSearch).toBeVisible({ timeout: 5_000 });
    await iconSearch.fill('arrow');
    // Wait for the debounced search + mock response
    await sharedPage.waitForTimeout(600);

    // Count badge "Icons found: N"
    await expect(sharedPage.locator('text=/Icons found/i')).toBeVisible({ timeout: 5_000 });
  });

  // ── Infinite loop guard ──────────────────────────────────────────────────────

  test('BA-11 API is NOT called infinitely on mount (≤ 2 calls in 3 seconds)', async () => {
    const p = await sharedPage.context().newPage();
    let callCount = 0;

    // Count all asset API calls
    await p.route('**/api/builder/assets/**', route => {
      callCount++;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [], total: 0, page: 1 }),
      });
    });
    await mockAssetAPIs(p); // mock Iconify too

    await gotoBuilder(p);
    const tab = p.getByTestId('tab-assets');
    await tab.click();

    // Wait 3s and count API calls — should be at most 2 (initial mount fetch only)
    await p.waitForTimeout(3_000);

    expect(callCount).toBeLessThanOrEqual(2);
    await p.close();
  });

  // ── Canvas insertion ─────────────────────────────────────────────────────────

  test('BA-12 Clicking an image inserts a NextImage node onto the canvas', async () => {
    const p = await sharedPage.context().newPage();
    await mockAssetAPIs(p);
    await gotoBuilder(p);

    // Ensure there's at least one page/node slot
    await p.getByTestId('tab-assets').click();
    await p.waitForFunction(
      () => document.querySelectorAll('img[src*="picsum"]').length > 0,
      { timeout: 8_000 },
    );

    const nodesBefore = await p.evaluate(
      () => document.querySelectorAll('[data-builder-id]').length,
    );

    // Click the first image thumbnail
    await p.locator('img[src*="picsum"]').first().click();
    await p.waitForTimeout(500);

    const nodesAfter = await p.evaluate(
      () => document.querySelectorAll('[data-builder-id]').length,
    );

    expect(nodesAfter).toBeGreaterThan(nodesBefore);
    await p.close();
  });

  test('BA-13 Dragging an image onto the canvas inserts a NextImage node', async () => {
    const p = await sharedPage.context().newPage();
    await mockAssetAPIs(p);
    await gotoBuilder(p);

    await p.getByTestId('tab-assets').click();
    await p.waitForFunction(
      () => document.querySelectorAll('img[src*="picsum"]').length > 0,
      { timeout: 8_000 },
    );

    const nodesBefore = await p.evaluate(
      () => document.querySelectorAll('[data-builder-id]').length,
    );

    // Drag first thumbnail onto the canvas frame
    const thumb = p.locator('img[src*="picsum"]').first();
    const frame = p.locator('[data-builder-page-frame]');
    await thumb.dragTo(frame);
    await p.waitForTimeout(600);

    const nodesAfter = await p.evaluate(
      () => document.querySelectorAll('[data-builder-id]').length,
    );

    expect(nodesAfter).toBeGreaterThan(nodesBefore);
    await p.close();
  });
});
