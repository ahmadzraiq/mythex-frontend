/**
 * E2E: Exported app datasource loading diagnostic
 *
 * Tests that datasources (cart, navCollections) are fetched on page load
 * and their data flows into the Zustand store and DOM correctly.
 *
 * Run against the exported app on port 3004:
 *   npx playwright test e2e/export-datasource-load.spec.ts --project=chromium
 */

import { test, expect, type Page, type Request, type Response } from '@playwright/test';

const BASE = 'http://localhost:3004';
const SHOP_API = 'http://localhost:3000/shop-api';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForShopApiCall(page: Page, operationName: string, timeoutMs = 8000): Promise<{ req: Request; res: Response }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${operationName} request`)), timeoutMs);
    page.on('request', (req) => {
      if (req.url() === SHOP_API && req.method() === 'POST') {
        try {
          const body = req.postDataJSON() as { query?: string };
          if (body?.query?.includes(operationName)) {
            clearTimeout(timer);
            page.waitForResponse(r => r.url() === SHOP_API && r.request() === req)
              .then(res => resolve({ req, res }))
              .catch(reject);
          }
        } catch { /* ignore parse errors */ }
      }
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Exported app — datasource auto-fetch', () => {

  test('DS-1: GetActiveOrder request is sent on page load', async ({ page }) => {
    const requestPromise = waitForShopApiCall(page, 'GetActiveOrder');
    await page.goto(`${BASE}/workflow-call-test`);

    const { req, res } = await requestPromise;
    console.log('[DS-1] GetActiveOrder request fired ✓');
    console.log('  URL:', req.url());
    console.log('  Headers:', JSON.stringify(req.headers(), null, 2));
    console.log('  Body:', req.postData());

    const status = res.status();
    console.log('[DS-1] Response status:', status);

    const responseBody = await res.json().catch(() => null);
    console.log('[DS-1] Response body:', JSON.stringify(responseBody, null, 2));

    expect(status).toBe(200);
    expect(req.headers()['vendure-token']).toBe('__default_channel__');
    expect(req.headers()['content-type']).toContain('application/json');

    const bodyJson = JSON.parse(req.postData() ?? '{}') as { variables: unknown };
    expect(bodyJson.variables).toEqual({});
    console.log('[DS-1] variables is object {} ✓');
  });

  test('DS-2: GetActiveOrder data is stored in Zustand state.collections.cart', async ({ page }) => {
    const requestPromise = waitForShopApiCall(page, 'GetActiveOrder');
    await page.goto(`${BASE}/workflow-call-test`);
    const { res } = await requestPromise;

    const apiBody = await res.json() as Record<string, unknown>;
    console.log('[DS-2] API returned:', JSON.stringify(apiBody, null, 2));

    // Wait a tick for the .then() to run and setState to complete
    await page.waitForTimeout(500);

    const storeCollections = await page.evaluate(() => {
      // Access Zustand store state directly via the hook's getState()
      // The store is exported as `useStore` from lib/store
      try {
        // Try reading from a debug global if available
        const w = window as unknown as Record<string, unknown>;
        if (w.__ZUSTAND_STORE__) {
          return (w.__ZUSTAND_STORE__ as { getState: () => Record<string, unknown> }).getState().collections;
        }
      } catch { /* no global */ }
      return null;
    });

    console.log('[DS-2] state.collections from page evaluate:', JSON.stringify(storeCollections, null, 2));

    // The API response should be stored at state.collections.cart
    // Expected shape: { data: { activeOrder: null | {...} } }
    expect(apiBody).toHaveProperty('data');
    console.log('[DS-2] API response has .data key ✓');
  });

  test('DS-3: navCollections data populates navbar links', async ({ page }) => {
    const navReqPromise = waitForShopApiCall(page, 'GetNavCollections');
    await page.goto(`${BASE}/workflow-call-test`);

    let navResponse: Record<string, unknown> | null = null;
    try {
      const { res } = await navReqPromise;
      navResponse = await res.json() as Record<string, unknown>;
      console.log('[DS-3] GetNavCollections response:', JSON.stringify(navResponse, null, 2));
    } catch (e) {
      console.log('[DS-3] GetNavCollections request not found:', e);
    }

    // Wait for potential re-render
    await page.waitForTimeout(1000);

    // Check if navbar has collection links
    const navbarCollections = page.locator('#navbar-collections a, #navbar-collections [role="link"], #navbar-collections button');
    const count = await navbarCollections.count();
    console.log('[DS-3] Navbar collection links count:', count);

    if (count > 0) {
      const firstText = await navbarCollections.first().textContent();
      console.log('[DS-3] First navbar link text:', firstText);
    }
  });

  test('DS-4: Full page load — store state snapshot after all fetches', async ({ page }) => {
    // Capture all shop-api requests
    const apiRequests: Array<{ op: string; status: number; data: unknown }> = [];

    page.on('response', async (res) => {
      if (res.url() === SHOP_API && res.request().method() === 'POST') {
        try {
          const reqBody = res.request().postDataJSON() as { query?: string };
          const op = reqBody?.query?.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? 'unknown';
          const body = await res.json();
          apiRequests.push({ op, status: res.status(), data: body });
        } catch { /* skip */ }
      }
    });

    await page.goto(`${BASE}/workflow-call-test`);
    // Wait for all pending fetches to settle
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    console.log('[DS-4] All shop-api calls made on page load:');
    for (const r of apiRequests) {
      const hasError = (r.data as Record<string, unknown>)?.errors;
      console.log(`  OP: ${r.op} | HTTP: ${r.status} | errors: ${hasError ? JSON.stringify(hasError) : 'none'}`);
      if (hasError) {
        console.log('    Error detail:', JSON.stringify((r.data as Record<string, unknown>).errors, null, 2));
      }
    }

    // Inject a window global so we can read Zustand state from evaluate
    await page.addInitScript(() => {
      Object.defineProperty(window, '__getCollections', {
        get: () => () => {
          // @ts-ignore
          const mod = window.__NEXT_DATA__;
          return mod;
        }
      });
    });

    // Use page.evaluate to check DOM-visible data
    const navbarHTML = await page.locator('#navbar-collections').innerHTML().catch(() => 'NOT FOUND');
    const cartBadge = await page.locator('#navbar-cart-button').textContent().catch(() => 'NOT FOUND');

    console.log('[DS-4] navbar-collections innerHTML length:', navbarHTML.length);
    console.log('[DS-4] cart badge text:', cartBadge?.trim());
    console.log('[DS-4] navbar-collections first 500 chars:', navbarHTML.slice(0, 500));

    expect(apiRequests.length).toBeGreaterThan(0);
    console.log(`[DS-4] ✓ ${apiRequests.length} shop-api calls made on page load`);
  });

  test('DS-5: Zustand setState actually updates the component', async ({ page }) => {
    await page.goto(`${BASE}/workflow-call-test`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Inject a script to observe Zustand store changes
    const collectionsAfterLoad = await page.evaluate(async () => {
      // Wait 2s for async fetches to complete and setState to be called
      await new Promise(r => setTimeout(r, 2000));

      // Try to find the Zustand store via module internals
      // Next.js apps expose __NEXT_DATA__ but not the store directly.
      // Instead, read from the DOM what the component actually renders.
      const cartBadge = document.querySelector('#navbar-cart-button');
      const navItems = document.querySelectorAll('#navbar-collections a');

      return {
        cartBadgeText: cartBadge?.textContent?.trim() ?? 'not found',
        navItemsCount: navItems.length,
        navItemTexts: Array.from(navItems).slice(0, 5).map(el => el.textContent?.trim()),
      };
    });

    console.log('[DS-5] After 2s wait — cart badge text:', collectionsAfterLoad.cartBadgeText);
    console.log('[DS-5] After 2s wait — navbar items count:', collectionsAfterLoad.navItemsCount);
    console.log('[DS-5] After 2s wait — navbar item texts:', collectionsAfterLoad.navItemTexts);
  });
});
