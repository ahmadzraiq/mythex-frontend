import { test, expect, type Page } from '@playwright/test';

test.setTimeout(30_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/chip-test`;

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

test.describe('Chip System Component', () => {
  test('CP-01: Renders chip body and remove icon', async ({ page }) => {
    await gotoPage(page);
    await expect(page.getByTestId('chip-body')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('chip-body')).toContainText('Hello Chip');
    await expect(page.getByTestId('chip-remove')).toBeVisible();
  });

  test('CP-02: Click on chip body emits On click', async ({ page }) => {
    await gotoPage(page);
    const body = page.getByTestId('chip-body');
    await body.click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'chip-test-clicks')).toBe(1);
    expect(await readVar(page, 'chip-test-removes')).toBe(0);
  });

  test('CP-03: Click on remove emits On remove and stops propagation', async ({ page }) => {
    await gotoPage(page);
    await page.getByTestId('chip-remove').click();
    await page.waitForTimeout(200);
    expect(await readVar(page, 'chip-test-removes')).toBe(1);
    expect(await readVar(page, 'chip-test-clicks')).toBe(0);
  });
});
