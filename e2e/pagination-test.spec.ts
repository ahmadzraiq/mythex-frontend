import { test, expect, type Page } from '@playwright/test';

test.setTimeout(30_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/pagination-test`;

async function gotoPage(page: Page) {
  await page.goto(URL);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function readVar(page: Page, name: string): Promise<unknown> {
  return page.evaluate((key) => {
    const store = (window as unknown as { __globalVariableStore?: { getState: () => { data?: Record<string, unknown> } } }).__globalVariableStore;
    return store?.getState?.().data?.[key] ?? null;
  }, name);
}

test.describe('Pagination System Component', () => {
  test('PG-01: Renders the pagination strip with prev/next buttons', async ({ page }) => {
    await gotoPage(page);
    await expect(page.getByTestId('pagination-strip')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('pagination-prev')).toBeVisible();
    await expect(page.getByTestId('pagination-next')).toBeVisible();
  });

  test('PG-02: Click on Next emits On page change with the next page', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('pagination-next').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'pg-test-page')).toBe(2);
  });

  test('PG-03: After Next, clicking Prev brings page back to 1', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('pagination-next').click();
    await page.waitForTimeout(200);
    await page.getByTestId('pagination-prev').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'pg-test-page')).toBe(1);
  });
});
