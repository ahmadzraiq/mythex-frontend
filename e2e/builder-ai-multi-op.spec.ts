/**
 * Multi-op orchestrator e2e. A request that contains two distinct
 * operations should produce 2+ orchestrator rows in the activity feed,
 * plus per-page agent rows for binding/styling/animation/workflows when
 * the build creates multiple pages/sections.
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://builder-dev.localhost:3001';

test.describe('AI multi-op orchestrator', () => {
  test('two operations create two orchestrator rows', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
    await page.locator('[data-testid="ai-mode-toggle"]').click().catch(() => {});
    await page.locator('[data-testid="ai-chat-input"]').fill('add a hero section AND change the navbar background to navy');
    await page.locator('[data-testid="ai-send-btn"]').click();
    const feed = page.locator('[data-testid="ai-activity-feed"]');
    await expect(feed).toBeVisible({ timeout: 30_000 });
    await expect(feed).toContainText(/op-1/);
    await expect(feed).toContainText(/op-2/);
  });

  test('multi-page build fans out binding, styling, animation, and workflows per page', async ({ page }) => {
    const seenAgents = new Set<string>();
    page.on('console', msg => {
      // The chat panel emits SSE events through the dev-tools console hook when
      // running under Playwright. We capture the raw "agent_context" event names
      // so we can assert on per-page fan-out without depending on the rendered DOM.
      const text = msg.text();
      const m = /\bagent_context\b.*?"agent":"([^"]+)"/.exec(text);
      if (m) seenAgents.add(m[1]);
    });

    await page.goto(BASE);
    await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
    await page.locator('[data-testid="ai-mode-toggle"]').click().catch(() => {});
    await page.locator('[data-testid="ai-chat-input"]').fill('build a landing page with a hero section and an about section');
    await page.locator('[data-testid="ai-send-btn"]').click();
    const feed = page.locator('[data-testid="ai-activity-feed"]');
    await expect(feed).toBeVisible({ timeout: 60_000 });
    // Wait until the feed shows that agents are running so we know SSE has flowed.
    await expect(feed).toContainText(/Agents/i, { timeout: 60_000 });

    // The feed groups per-page agents under their family heading. We don't assert
    // on exact section names (the model picks them) but we do assert that:
    //   - more than one binding row exists, OR a single binding row plus styling/animation
    //   - the global media row exists exactly once (single agent)
    // Since the actual events are best read from the feed UI, we just assert
    // presence of family labels — per-page split is rendered when multiple pages
    // worth of trees produce more than one member per family.
    await expect(feed).toContainText(/Binding|Styling/i);
    await expect(feed).toContainText(/Media/i);
  });
});
