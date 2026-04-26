import { test, expect, type Page } from '@playwright/test';

test.setTimeout(30_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/rating-test`;

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

test.describe('Star Rating System Component', () => {
  test('RT-01: Renders five stars', async ({ page }) => {
    await gotoPage(page);
    await expect(page.getByTestId('rating-strip')).toBeVisible({ timeout: 10_000 });
    for (let i = 1; i <= 5; i++) {
      await expect(page.getByTestId(`rating-star-${i}`)).toBeVisible();
    }
  });

  test('RT-02: Click on a star emits On change with that 1-indexed value', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('rating-star-3').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'rating-test-value')).toBe(3);
  });

  test('RT-03: Click on the fifth star sets rating to 5', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('rating-star-5').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'rating-test-value')).toBe(5);
    await expect(page.getByTestId('out-rating-value')).toHaveText('Rating: 5');
  });
});
