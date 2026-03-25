/**
 * Seed-from-template E2E test.
 *
 * Covers:
 * 1. Login → create workspace → create project → open builder
 * 2. Builder loads without empty-canvas flash
 * 3. Seed from template populates pages with nodes
 * 4. Nodes on the active page are selectable (via layers panel)
 * 5. Navigating to a second page lazy-loads its nodes correctly
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const EMAIL    = 'test@example.com';
const PASSWORD = 'password123';
const BASE     = 'http://localhost:3001';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Login via the API, extract the Set-Cookie value, and inject it into the
 * Playwright browser context so page navigations carry the auth cookie.
 * Returns the token string or throws.
 */
async function loginAndInjectCookie(ctx: BrowserContext): Promise<string> {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `Login failed: ${await res.text()}`).toBeTruthy();

  // Extract auth_token from the Set-Cookie response header
  const setCookie = res.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/auth_token=([^;]+)/);
  expect(match, 'No auth_token in Set-Cookie').not.toBeNull();
  const token = match![1];

  // Inject into browser context (pages use this cookie jar, not ctx.request's)
  await ctx.addCookies([{
    name: 'auth_token', value: token,
    domain: 'localhost', path: '/',
    httpOnly: true, sameSite: 'Strict',
  }]);
  return token;
}

/** Create a workspace, then a project inside it. Returns the project id. */
async function createTestProject(ctx: BrowserContext): Promise<string> {
  // Create workspace
  const wsRes = await ctx.request.post(`${BASE}/api/workspaces`, {
    data: { name: `Seed Test ${Date.now()}` },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(wsRes.ok(), `Create workspace failed: ${await wsRes.text()}`).toBeTruthy();
  const { workspace } = await wsRes.json() as { workspace: { id: string } };

  // Create project
  const prjRes = await ctx.request.post(`${BASE}/api/workspaces/${workspace.id}/projects`, {
    data: { name: 'Seed E2E Project' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(prjRes.ok(), `Create project failed: ${await prjRes.text()}`).toBeTruthy();
  const { project } = await prjRes.json() as { project: { id: string } };
  return project.id;
}

/** Serialisable snapshot of builder store state. */
async function getStore(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>)
      .__builderStore?.getState();
    if (!s) return null;
    return {
      pages:        s.pages        as Array<{ id: string; name: string; route?: string }>,
      currentPageId: s.currentPageId as string | null,
      pageNodes:    s.pageNodes    as unknown[],
      selectedIds:  s.selectedIds  as string[],
      loadedPageIds: [...(s.loadedPageIds as Set<string>)],
    };
  });
}

async function waitForBuilder(page: Page) {
  // Wait until the loading spinner is gone AND the canvas + store are ready
  await page.waitForSelector('[data-testid="builder-canvas"]', { timeout: 35_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 200 },
  );
  // Wait for configLoading to clear (spinner disappears)
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="builder-canvas"] ~ *')
      || !document.body.innerText.includes('Loading project'),
    { timeout: 15_000 },
  );
  // Small extra settle time
  await page.waitForTimeout(500);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Builder seed from template', () => {
  let ctx:       BrowserContext;
  let page:      Page;
  let projectId: string;

  test.beforeAll(async ({ browser }) => {
    ctx  = await browser.newContext();
    await loginAndInjectCookie(ctx);
    projectId = await createTestProject(ctx);
    page = await ctx.newPage();
  });

  test.afterAll(async () => {
    await ctx.close();
  });

  // ── 1. Builder loads without flash ────────────────────────────────────────
  test('builder loads the new project without empty-canvas flash', async () => {
    await page.goto(`${BASE}/builder/${projectId}`);
    await waitForBuilder(page);

    // No loading spinner should be visible any more
    await expect(page.locator('text=Loading project…')).not.toBeVisible({ timeout: 5_000 });

    // Canvas should be present
    await expect(page.locator('[data-testid="builder-canvas"]')).toBeVisible();

    const state = await getStore(page);
    expect(state).not.toBeNull();
    // Brand-new project gets a default Home page
    expect(state!.pages.length).toBeGreaterThanOrEqual(1);
    expect(state!.pages[0].name).toBe('Home');
  });

  // ── 2. Seed populates pages ────────────────────────────────────────────────
  test('seed from template fills the project with pages and nodes', async () => {
    // Open ⋮ project menu
    const menuBtn = page.locator('button[title="Project options"]');
    await expect(menuBtn).toBeVisible({ timeout: 5_000 });
    await menuBtn.click();

    // Seed from template item
    const seedItem = page.locator('button', { hasText: /seed from template/i });
    await expect(seedItem).toBeVisible({ timeout: 3_000 });

    // Accept the confirm() dialog
    page.once('dialog', d => d.accept());
    await seedItem.click();

    // Wait for seeding + reload to finish (network goes idle, then store settles)
    await page.waitForLoadState('networkidle', { timeout: 40_000 });
    await page.waitForTimeout(2_000);

    const state = await getStore(page);
    expect(state).not.toBeNull();

    // Should have more than 1 page now (seeded from config/root screens)
    expect(state!.pages.length).toBeGreaterThan(1);

    // Active page must have nodes
    expect(state!.pageNodes.length).toBeGreaterThan(0);
  });

  // ── 3. Nodes are selectable ────────────────────────────────────────────────
  test('nodes on the seeded page are selectable via layers panel', async () => {
    const state = await getStore(page);
    if (!state || state.pageNodes.length === 0) {
      test.skip(); // seeding failed in a prior test — nothing to select
    }

    // Switch to layers tab and wait for rows to render
    await page.locator('[data-testid="tab-layers"]').click();
    const firstLayer = page.locator('[data-testid="layer-row"]').first();
    await expect(firstLayer).toBeVisible({ timeout: 10_000 });
    await firstLayer.click();
    await page.waitForTimeout(400);

    const stateAfter = await getStore(page);
    expect(stateAfter!.selectedIds.length).toBeGreaterThan(0);
  });

  // ── 4. Second page lazy-loads its nodes ───────────────────────────────────
  test('navigating to a second page lazy-loads its nodes', async () => {
    // Re-read fresh state (previous tests may have changed it)
    const state = await getStore(page);
    if (!state || state.pages.length < 2) {
      test.skip();
      return;
    }

    const secondPage = state.pages.find(p => p.id !== state.currentPageId)!;

    // Open pages picker and navigate
    const pickerBtn = page.locator('[data-testid="pages-picker-trigger"]');
    await pickerBtn.click();
    const row = page.locator(`[data-testid="pages-picker-row-${secondPage.id}"]`);
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    // Allow the lazy fetch to complete
    await page.waitForTimeout(2_500);

    const stateAfterNav = await getStore(page);
    expect(stateAfterNav!.currentPageId).toBe(secondPage.id);
    // Page should now be marked as loaded
    expect(stateAfterNav!.loadedPageIds).toContain(secondPage.id);
    // And it should have nodes (seeded from template)
    expect(stateAfterNav!.pageNodes.length).toBeGreaterThan(0);
  });
});
