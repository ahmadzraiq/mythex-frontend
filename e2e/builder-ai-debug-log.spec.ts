/**
 * Copy Debug envelope e2e. Checks that the Copy log button copies a
 * JSON payload with the new `debug` field.
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://builder-dev.localhost:3001';

test.describe('AI debug envelope', () => {
  test('Copy log includes a debug envelope', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'clipboard read flaky in WebKit');
    await page.goto(BASE);
    await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('[data-testid="ai-mode-toggle"]').click().catch(() => {});
    await page.locator('[data-testid="ai-chat-input"]').fill('add a basic call to action');
    await page.locator('[data-testid="ai-send-btn"]').click();
    await expect(page.getByText(/⎘ Copy log/)).toBeVisible({ timeout: 60_000 });
    await page.getByText(/⎘ Copy log/).first().click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const parsed = JSON.parse(copied) as { debug?: unknown };
    expect(parsed.debug).toBeTruthy();
  });
});
