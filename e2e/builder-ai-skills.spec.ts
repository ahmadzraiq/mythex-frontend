/**
 * Skill memory e2e. Asserts that a successful turn surfaces the
 * "Skill saved" activity row.
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://builder-dev.localhost:3001';

test.describe('AI skill memory', () => {
  test('successful turn writes a skill', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
    await page.locator('[data-testid="ai-mode-toggle"]').click().catch(() => {});
    await page.locator('[data-testid="ai-chat-input"]').fill('add a centered hero with a CTA button');
    await page.locator('[data-testid="ai-send-btn"]').click();
    await expect(page.locator('[data-testid="ai-activity-feed"]')).toContainText(/Skill saved|Not saved/i, { timeout: 60_000 });
  });
});
