import { test, expect, type Page } from '@playwright/test';

test.setTimeout(30_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/breadcrumbs-test`;

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

test.describe('Breadcrumbs System Component', () => {
  test('BC-01: Renders all breadcrumb labels', async ({ page }) => {
    await gotoPage(page);
    await expect(page.getByTestId('breadcrumbs-strip')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('breadcrumb-0')).toContainText('Home');
    await expect(page.getByTestId('breadcrumb-1')).toContainText('Category');
    await expect(page.getByTestId('breadcrumb-2')).toContainText('Page');
  });

  test('BC-02: Clicking a non-last breadcrumb emits On item click with its label', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('breadcrumb-0').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'breadcrumbs-test-label')).toBe('Home');
  });

  test('BC-03: Clicking a different breadcrumb updates the listener variable', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('breadcrumb-1').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'breadcrumbs-test-label')).toBe('Category');
    await expect(page.getByTestId('out-breadcrumbs-label')).toHaveText('Last: Category');
  });
});
