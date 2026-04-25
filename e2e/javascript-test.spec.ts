/**
 * JavaScript Mode Showcase — E2E Tests
 *
 * Tests /javascript-test — verifies that:
 *   - { js } bindings on text / style / nested context.item work end-to-end.
 *   - runJavaScript workflow steps execute, expose wwLib, and store their result
 *     at context.workflow[stepId].result for downstream steps.
 *
 * JS-01  Page renders heading
 * JS-02  Text bound via { js } reduces variables.productItems into a total string
 * JS-03  Style bound via { js } toggles backgroundColor based on variables.cartCount
 * JS-04  Email validation hint flips text/color via two { js } bindings
 * JS-05  Repeater ({ js } using context.item) renders one row per product
 * JS-06  runJavaScript "math" step + downstream changeVariableValue using context.workflow
 * JS-07  runJavaScript with await fetch + branch on JS condition writes the result
 * JS-08  runJavaScript side-effect via wwLib.variables.set('lastSyncAt', …)
 * JS-09  forEach with itemsExpression { js } + nested runJavaScript counts active users
 *
 * Run: npx playwright test e2e/javascript-test.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(90_000);

const PREVIEW_DEV_BASE = 'http://preview-dev.localhost:3001';
const PAGE_URL = `${PREVIEW_DEV_BASE}/javascript-test`;

const VAR = {
  cartCount: 'js-demo-0000-0000-0000-000000000001',
  userEmail: 'js-demo-0000-0000-0000-000000000002',
  users: 'js-demo-0000-0000-0000-000000000003',
  lastSyncAt: 'js-demo-0000-0000-0000-000000000004',
  processedCount: 'js-demo-0000-0000-0000-000000000005',
  jsMathResult: 'js-demo-0000-0000-0000-000000000006',
  jsApiResult: 'js-demo-0000-0000-0000-000000000007',
  jsSyncStatus: 'js-demo-0000-0000-0000-000000000008',
  jsForEachResult: 'js-demo-0000-0000-0000-000000000009',
  productItems: 'js-demo-0000-0000-0000-000000000010',
} as const;

async function gotoPage(page: Page) {
  await page.goto(PAGE_URL);
  await page.waitForSelector('text=JavaScript Mode Showcase', { timeout: 30_000 });
  await page.waitForTimeout(500);
}

async function readVar(page: Page, uuid: string): Promise<unknown> {
  return await page.evaluate((id) => {
    const store = (window as unknown as {
      __globalVariableStore?: { getState: () => { data: Record<string, unknown> } };
    }).__globalVariableStore;
    if (!store) return undefined;
    return store.getState().data?.[id];
  }, uuid);
}

async function setVar(page: Page, uuid: string, value: unknown): Promise<void> {
  await page.evaluate(
    ([id, v]: [string, unknown]) => {
      const store = (window as unknown as {
        __globalVariableStore?: { getState: () => { set: (path: string, value: unknown) => void } };
      }).__globalVariableStore;
      store?.getState().set(id, v);
    },
    [uuid, value] as [string, unknown],
  );
}

test.describe('JavaScript Mode Showcase', () => {
  test('JS-01: Page renders heading', async ({ page }) => {
    await gotoPage(page);
    await expect(page.getByText('JavaScript Mode Showcase').first()).toBeVisible();
    await expect(page.getByText('Card 1 — { js } bindings (read-only)')).toBeVisible();
    await expect(page.getByText('Card 2 — runJavaScript workflow steps')).toBeVisible();
  });

  test('JS-02: { js } binding reduces productItems to a total string', async ({ page }) => {
    await gotoPage(page);
    const total = page.getByTestId('js-binding-total');
    await total.scrollIntoViewIfNeeded();
    // sum of [24.5, 64, 18.25, 5.5] = 112.25 across 4 items
    await expect(total).toHaveText(/Total:\s*\$112\.25 across 4 item\(s\)/);
  });

  test('JS-03: { js } style binding toggles bg color via variables.cartCount', async ({ page }) => {
    await gotoPage(page);

    // Initial: cartCount = 2 → green (#10b981 = rgb(16, 185, 129))
    const pill = page.getByTestId('js-binding-style-pill');
    await pill.scrollIntoViewIfNeeded();
    await expect(pill).toHaveCSS('background-color', 'rgb(16, 185, 129)');

    // Reset cart → grey (#6b7280 = rgb(107, 114, 128))
    await setVar(page, VAR.cartCount, 0);
    await page.waitForTimeout(150);
    await expect(pill).toHaveCSS('background-color', 'rgb(107, 114, 128)');

    // Bump back → green again, via the +1 button (also tests runJavaScript side-effect)
    await page.getByTestId('js-btn-incr-cart').click();
    await page.waitForTimeout(200);
    await expect(pill).toHaveCSS('background-color', 'rgb(16, 185, 129)');
    expect(await readVar(page, VAR.cartCount)).toBe(1);
  });

  test('JS-04: Email validation hint flips text + color via { js }', async ({ page }) => {
    await gotoPage(page);
    const hint = page.getByTestId('js-email-hint');
    await hint.scrollIntoViewIfNeeded();

    // Empty email → "Enter your email…" in red
    await expect(hint).toHaveText(/Enter your email/);

    // Drive the variable directly (Input → variable wiring is exercised by other tests).
    // This isolates the { js } binding's reactivity.
    await setVar(page, VAR.userEmail, 'not-an-email');
    await expect(hint).toHaveText(/Invalid email format/, { timeout: 3_000 });

    await setVar(page, VAR.userEmail, 'a@b.co');
    await expect(hint).toHaveText(/Looks good/, { timeout: 3_000 });
    await expect(hint).toHaveCSS('color', 'rgb(16, 185, 129)');
  });

  test('JS-05: Repeater renders one { js }-bound row per product', async ({ page }) => {
    await gotoPage(page);
    // Each row contains "Name ($price)" — assert each product appears
    await expect(page.getByText(/Tee \(\$24\.50\)/)).toBeVisible();
    await expect(page.getByText(/Hoodie \(\$64\.00\)/)).toBeVisible();
    await expect(page.getByText(/Cap \(\$18\.25\)/)).toBeVisible();
    await expect(page.getByText(/Sticker Pack \(\$5\.50\)/)).toBeVisible();
  });

  test('JS-06: runJavaScript math step + downstream context.workflow.calc.result', async ({ page }) => {
    await gotoPage(page);
    // Set cartCount to known value first
    await setVar(page, VAR.cartCount, 4);
    await page.waitForTimeout(100);

    await page.getByTestId('js-btn-math').click();
    await page.waitForTimeout(400);

    const out = page.getByTestId('js-out-math');
    await expect(out).toHaveText(/cartCount=4, withTax=4\.20/);
    expect(await readVar(page, VAR.jsMathResult)).toMatch(/cartCount=4, withTax=4\.20/);
  });

  test('JS-07: async fetch + branch on { js } condition writes result', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('js-btn-fetch').scrollIntoViewIfNeeded();

    // Stub the fetch call so the test is deterministic offline
    await page.route('https://api.github.com/repos/facebook/react', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ stargazers_count: 12345, full_name: 'facebook/react' }),
      });
    });

    await page.getByTestId('js-btn-fetch').click();
    await page.waitForTimeout(800);

    const out = page.getByTestId('js-out-fetch');
    // toLocaleString in jsdom uses commas → "12,345"
    await expect(out).toHaveText(/facebook\/react\s+—\s+12,345 stars/);
    expect(await readVar(page, VAR.jsApiResult)).toMatch(/facebook\/react/);
  });

  test('JS-08: runJavaScript side effect — wwLib.variables.set("lastSyncAt", ...)', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('js-btn-side-effect').scrollIntoViewIfNeeded();

    expect(await readVar(page, VAR.lastSyncAt)).toBe('(never)');

    await page.getByTestId('js-btn-side-effect').click();
    await page.waitForTimeout(400);

    const stamp = await readVar(page, VAR.lastSyncAt);
    expect(typeof stamp).toBe('string');
    // ISO 8601 timestamp shape
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const status = await readVar(page, VAR.jsSyncStatus);
    expect(status).toMatch(/^synced @ /);
  });

  test('JS-09: forEach with { js } itemsExpression + nested runJavaScript', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('js-btn-foreach').scrollIntoViewIfNeeded();

    await setVar(page, VAR.processedCount, 0);
    await page.waitForTimeout(100);

    await page.getByTestId('js-btn-foreach').click();
    await page.waitForTimeout(600);

    // 3 of the 4 seed users have active=true
    expect(await readVar(page, VAR.processedCount)).toBe(3);

    const out = page.getByTestId('js-out-foreach');
    await expect(out).toHaveText(/Processed 3 active user\(s\) out of 4\./);
  });
});
