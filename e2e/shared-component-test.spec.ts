/**
 * Shared Component System E2E Tests (SC series)
 *
 * Tests verify that SharedComponent nodes render correctly at runtime:
 *   - Props are passed from the instance to the component definition
 *   - Default prop values are used when no override is provided
 *   - Multiple instances of the same component render independently
 *   - Unknown componentId shows an error boundary in dev mode
 *
 * Run: npx playwright test e2e/shared-component-test.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

const PREVIEW_BASE = 'http://preview-dev.localhost:3001';
const TEST_URL = `${PREVIEW_BASE}/shared-component-test`;

async function gotoPage(page: Page) {
  await page.goto(TEST_URL);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  // Wait for the page heading (role-scoped to avoid strict mode violation)
  await page.waitForSelector('h2', { timeout: 20_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// SC-01 — Page loads, heading visible
// ─────────────────────────────────────────────────────────────────────────────

test('SC-01: /shared-component-test page loads with correct heading', async ({ page }) => {
  await gotoPage(page);
  await expect(page.getByRole('heading', { name: 'Shared Component System' })).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-02 — Status Badge: three instances all render
// ─────────────────────────────────────────────────────────────────────────────

test('SC-02: Status Badge instances all render in the badge row', async ({ page }) => {
  await gotoPage(page);
  const badgeRow = page.locator('[data-testid="badge-row"]');
  await expect(badgeRow).toBeVisible();

  // All three labels should appear
  await expect(page.locator('text=Published')).toBeVisible();
  await expect(page.locator('text=Draft')).toBeVisible();
  await expect(page.locator('text=Archived')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-03 — Status Badge: each instance shows its own prop value
// ─────────────────────────────────────────────────────────────────────────────

test('SC-03: Each Status Badge instance shows its own label prop', async ({ page }) => {
  await gotoPage(page);

  // "Published" must appear exactly once in the badge section
  const publishedBadges = page.locator('[data-testid="badge-row"]').locator('text=Published');
  await expect(publishedBadges).toHaveCount(1);

  // "Draft" must appear exactly once
  const draftBadges = page.locator('[data-testid="badge-row"]').locator('text=Draft');
  await expect(draftBadges).toHaveCount(1);

  // "Archived" must appear exactly once
  const archivedBadges = page.locator('[data-testid="badge-row"]').locator('text=Archived');
  await expect(archivedBadges).toHaveCount(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-04 — Info Card: three instances render with correct titles
// ─────────────────────────────────────────────────────────────────────────────

test('SC-04: Info Card instances render with their title and description props', async ({ page }) => {
  await gotoPage(page);

  const cardSection = page.locator('[data-testid="card-section"]');
  await expect(cardSection).toBeVisible();

  // Titles
  await expect(cardSection.locator('[data-testid="card-title"]').nth(0)).toHaveText('Getting Started');
  await expect(cardSection.locator('[data-testid="card-title"]').nth(1)).toHaveText('Prop Passing');
  await expect(cardSection.locator('[data-testid="card-title"]').nth(2)).toHaveText('No Duplication');
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-05 — Info Card: descriptions are unique per instance
// ─────────────────────────────────────────────────────────────────────────────

test('SC-05: Info Card descriptions are unique per instance (prop isolation)', async ({ page }) => {
  await gotoPage(page);

  const cardSection = page.locator('[data-testid="card-section"]');

  const desc0 = await cardSection.locator('[data-testid="card-description"]').nth(0).textContent();
  const desc1 = await cardSection.locator('[data-testid="card-description"]').nth(1).textContent();
  const desc2 = await cardSection.locator('[data-testid="card-description"]').nth(2).textContent();

  // Each description must be distinct
  expect(desc0).not.toEqual(desc1);
  expect(desc1).not.toEqual(desc2);
  expect(desc0).not.toEqual(desc2);

  // Content checks
  expect(desc0).toContain('basics');
  expect(desc1).toContain('override');
  expect(desc2).toContain('once');
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-06 — CTA Button: custom prop overrides default
// ─────────────────────────────────────────────────────────────────────────────

test('SC-06: CTA Button instance with custom buttonText shows the override, not default', async ({ page }) => {
  await gotoPage(page);

  const ctaRow = page.locator('[data-testid="cta-row"]');
  await expect(ctaRow).toBeVisible();

  // The custom instance must show the override
  const customBtn = ctaRow.locator('[data-testid="cta-text"]').filter({ hasText: 'Sign Up Free' });
  await expect(customBtn).toBeVisible();

  // Must NOT show "Get Started" in the same button
  await expect(customBtn).not.toHaveText('Get Started');
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-07 — CTA Button: instance with no props falls back to defaultValue
// ─────────────────────────────────────────────────────────────────────────────

test('SC-07: CTA Button instance with no props shows component defaultValue', async ({ page }) => {
  await gotoPage(page);

  const ctaRow = page.locator('[data-testid="cta-row"]');
  // The default instance shows "Get Started" (the property defaultValue)
  const defaultBtn = ctaRow.locator('[data-testid="cta-text"]').filter({ hasText: 'Get Started' });
  await expect(defaultBtn).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-08 — Unknown componentId shows error boundary
// ─────────────────────────────────────────────────────────────────────────────

test('SC-08: Unknown componentId shows a visible error indicator in dev mode', async ({ page }) => {
  await gotoPage(page);

  // The renderer returns a red error div when the component is not found (dev mode).
  // The error div is not wrapped with the instance's data-testid (it replaces the node),
  // so we find the innermost div that contains exactly the error text.
  const errorEl = page.getByText(/SharedComponent: unknown id.*sc-does-not-exist/).first();
  await expect(errorEl).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-09 — Section headings are present (page structure)
// ─────────────────────────────────────────────────────────────────────────────

test('SC-09: Section headings for all three component demos are visible', async ({ page }) => {
  await gotoPage(page);

  await expect(page.locator('text=Status Badge Component — Three Instances')).toBeVisible();
  await expect(page.locator('text=Info Card Component — Three Instances')).toBeVisible();
  await expect(page.locator('text=CTA Button Component — Default Props Fallback')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-10 — Builder: Shared Components tab is present in left panel
// ─────────────────────────────────────────────────────────────────────────────

test('SC-10: Builder left panel has a Shared Components tab', async ({ page }) => {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-testid="tab-layers"]', { timeout: 30_000 });

  const sharedTab = page.locator('[data-testid="tab-shared"]');
  await expect(sharedTab).toBeVisible({ timeout: 10_000 });
  await sharedTab.click();
  // After clicking, the tab should still be visible (not navigated away)
  await expect(sharedTab).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-11 — Builder: Shared Components tab lists definitions from config
// ─────────────────────────────────────────────────────────────────────────────

test('SC-11: Shared Components tab lists the three definitions from config/shared-components.json', async ({ page }) => {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-testid="tab-layers"]', { timeout: 30_000 });

  await page.locator('[data-testid="tab-shared"]').click();

  // Wait for the tab content to appear
  await page.waitForSelector('[data-testid="sc-models-list"]', { timeout: 10_000 });

  // All three shared components defined in config should appear in the list
  // Scope to the models list to avoid strict mode violations from other places
  const list = page.locator('[data-testid="sc-models-list"]');
  await expect(list.getByText('Status Badge')).toBeVisible({ timeout: 10_000 });
  await expect(list.getByText('Info Card')).toBeVisible();
  await expect(list.getByText('CTA Button')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-12 — Builder: Can create a new shared component
// ─────────────────────────────────────────────────────────────────────────────

test('SC-12: Builder Shared Components tab allows creating a new component', async ({ page }) => {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-testid="tab-layers"]', { timeout: 30_000 });

  await page.locator('[data-testid="tab-shared"]').click();
  await page.waitForTimeout(500);

  // Click the New button
  const newBtn = page.locator('[data-testid="sc-new-btn"]');
  await expect(newBtn).toBeVisible({ timeout: 10_000 });
  await newBtn.click();

  // A name input or form should appear
  const nameInput = page.locator('[data-testid="sc-name-input"]');
  await expect(nameInput).toBeVisible({ timeout: 5_000 });

  // Type a name and submit
  await nameInput.fill('E2E Test Component');
  await page.locator('[data-testid="sc-create-submit"]').click();

  // The new component should appear in the models list (scoped to avoid strict violations)
  const list = page.locator('[data-testid="sc-models-list"]');
  await expect(list.getByText('E2E Test Component')).toBeVisible({ timeout: 5_000 });
});
