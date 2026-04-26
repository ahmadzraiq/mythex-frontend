import { test, expect, type Page } from '@playwright/test';

test.setTimeout(30_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/stepper-test`;

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

test.describe('Stepper System Component', () => {
  test('ST-01: Renders three steps', async ({ page }) => {
    await gotoPage(page);
    await expect(page.getByTestId('stepper-strip')).toBeVisible({ timeout: 10_000 });
    for (let i = 1; i <= 3; i++) {
      await expect(page.getByTestId(`stepper-step-${i}`)).toBeVisible();
    }
  });

  test('ST-02: Click on a step emits On step click with its 1-indexed position', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('stepper-step-2').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'stepper-test-index')).toBe(2);
  });

  test('ST-03: Clicking the last step updates the listener variable to 3', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('stepper-step-3').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'stepper-test-index')).toBe(3);
    await expect(page.getByTestId('out-stepper-index')).toHaveText('Step: 3');
  });
});
