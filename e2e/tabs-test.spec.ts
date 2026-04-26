import { test, expect, type Page } from '@playwright/test';

test.setTimeout(30_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/tabs-test`;

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

test.describe('Tabs System Component', () => {
  test('TB-01: Renders all three tabs', async ({ page }) => {
    await gotoPage(page);
    await expect(page.getByTestId('tabs-strip')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tab-tab1')).toBeVisible();
    await expect(page.getByTestId('tab-tab2')).toBeVisible();
    await expect(page.getByTestId('tab-tab3')).toBeVisible();
  });

  test('TB-02: Click on a tab fires On change with the tab value', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('tab-tab2').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'tabs-test-value')).toBe('tab2');
  });

  test('TB-03: Switching to a third tab updates the listener variable', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('tab-tab3').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'tabs-test-value')).toBe('tab3');
    await expect(page.getByTestId('out-tabs-value')).toHaveText('Active: tab3');
  });
});
