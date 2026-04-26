import { test, expect, type Page } from '@playwright/test';

test.setTimeout(30_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/select-test`;

async function gotoPage(page: Page) {
  await page.goto(URL);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

test.describe('Select System Component', () => {
  test('SE-01: Trigger renders, click opens popover with all option labels', async ({ page }) => {
    await gotoPage(page);

    const trigger = page.getByTestId('select-trigger');
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await expect(trigger).toContainText('Select...');

    await trigger.click();
    await page.waitForTimeout(300);

    const popover = page.getByTestId('select-popover');
    await expect(popover).toBeVisible();
    await expect(popover.getByText('Apple', { exact: true })).toBeVisible();
    await expect(popover.getByText('Banana', { exact: true })).toBeVisible();
    await expect(popover.getByText('Cherry', { exact: true })).toBeVisible();
  });

  test('SE-02: Click option closes popover and writes value into variable store', async ({ page }) => {
    await gotoPage(page);

    const trigger = page.getByTestId('select-trigger');
    await trigger.click();
    await page.waitForTimeout(300);

    const popover = page.getByTestId('select-popover');
    await popover.getByText('Apple', { exact: true }).click();
    await page.waitForTimeout(300);

    await expect(popover).toBeHidden();

    const stored = await page.evaluate(() => {
      const store = (window as unknown as { __globalVariableStore?: { getState: () => { data?: Record<string, unknown> } } }).__globalVariableStore;
      return store?.getState?.().data?.['sel-test-value'] ?? null;
    });
    expect(stored).toBe('apple');
  });

  test('SE-03: Display text reflects the selected option', async ({ page }) => {
    await gotoPage(page);

    const trigger = page.getByTestId('select-trigger');
    await trigger.click();
    await page.waitForTimeout(300);

    const popover = page.getByTestId('select-popover');
    await popover.getByText('Banana', { exact: true }).click();
    await page.waitForTimeout(300);

    const out = page.getByTestId('out-selected-value');
    await expect(out).toHaveText('Selected: banana');
    await expect(trigger).toContainText('Banana');
  });
});
