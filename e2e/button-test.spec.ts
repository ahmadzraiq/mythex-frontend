import { test, expect, type Page } from '@playwright/test';

test.setTimeout(30_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/button-test`;

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

test.describe('Button System Component', () => {
  test('BT-01: Renders enabled and disabled instances with their labels', async ({ page }) => {
    await gotoPage(page);
    const enabled = page.getByTestId('button-enabled');
    const disabled = page.getByTestId('button-disabled');
    await expect(enabled).toBeVisible({ timeout: 10_000 });
    await expect(enabled).toContainText('Click me');
    await expect(disabled).toBeVisible();
    await expect(disabled).toContainText('Disabled');
  });

  test('BT-02: Click on enabled button fires On click and increments count', async ({ page }) => {
    await gotoPage(page);
    const btn = page.getByTestId('button-enabled');
    await btn.click();
    await page.waitForTimeout(150);
    await btn.click();
    await page.waitForTimeout(150);
    expect(await readVar(page, 'btn-test-count')).toBe(2);
    expect(await readVar(page, 'btn-test-label')).toBe('Click me');
  });

  test('BT-03: Click on disabled button is a no-op (count stays at 0)', async ({ page }) => {
    await gotoPage(page);
    const btn = page.getByTestId('button-disabled');
    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(150);
    expect(await readVar(page, 'btn-test-count')).toBe(0);
  });
});
