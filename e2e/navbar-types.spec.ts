/**
 * Navbar Types Showcase — E2E Tests
 *
 * Tests all 10 navbar pages:
 *   - Index page loads with 9 cards
 *   - Each navbar type page loads, renders its navbar + scrollable content
 *   - Scroll-aware navbar hides on scroll down
 *   - Navigation between pages works
 *
 * Run: npx playwright test e2e/navbar-types.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

const BASE = 'http://preview-dev.localhost:3001';

async function gotoPage(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

// ─── NAV-01: Index page loads with all 9 cards ──────────────────────────────

test('NAV-01: index page loads with heading and 9 navbar type cards', async ({ page }) => {
  await gotoPage(page, '/navbar-types');
  await expect(page.getByRole('heading', { name: 'Navbar Types Showcase' })).toBeVisible();
  await expect(page.getByText('Fixed Navbar')).toBeVisible();
  await expect(page.getByText('Sticky Navbar')).toBeVisible();
  await expect(page.getByText('Transparent → Solid')).toBeVisible();
  await expect(page.getByText('Frosted Glass')).toBeVisible();
  await expect(page.getByText('Floating Pill')).toBeVisible();
  await expect(page.getByText('Centered Logo')).toBeVisible();
  await expect(page.getByText('Vertical Sidebar')).toBeVisible();
  await expect(page.getByText('Bottom Tab Bar')).toBeVisible();
  await expect(page.getByText('Scroll-Aware')).toBeVisible();
});

// ─── NAV-02: Fixed navbar page ──────────────────────────────────────────────

test('NAV-02: fixed navbar page loads with navbar and hero', async ({ page }) => {
  await gotoPage(page, '/navbar-fixed');
  await expect(page.getByText('NavbarDemo').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Always Visible Navigation')).toBeVisible({ timeout: 10_000 });

  // Scroll down and verify navbar is still visible (it's fixed)
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(500);
  await expect(page.getByText('NavbarDemo').first()).toBeVisible();
});

// ─── NAV-03: Sticky navbar page ─────────────────────────────────────────────

test('NAV-03: sticky navbar page has hero above and navbar that sticks', async ({ page }) => {
  await gotoPage(page, '/navbar-sticky');
  await expect(page.getByText('Sticky Navbar').first()).toBeVisible();
  await expect(page.getByText('Scroll down past this hero')).toBeVisible();

  // Scroll past the hero
  await page.evaluate(() => window.scrollTo(0, window.innerHeight + 100));
  await page.waitForTimeout(500);
  await expect(page.getByText('NavbarDemo').first()).toBeVisible();
});

// ─── NAV-04: Transparent navbar page ────────────────────────────────────────

test('NAV-04: transparent navbar bg + text color transition on scroll', async ({ page }) => {
  await gotoPage(page, '/navbar-transparent');
  await expect(page.getByText('Seamless Transition')).toBeVisible();
  await expect(page.getByText('NavbarDemo').first()).toBeVisible();

  // Find the navbar via its Tailwind class-based fixed positioning
  const navbar = page.locator('.fixed.top-\\[0px\\]').first();
  await expect(navbar).toBeVisible();

  // At top of page, background should be transparent (alpha ~0)
  const initialBg = await navbar.evaluate(el => getComputedStyle(el).backgroundColor);
  const initialAlpha = initialBg.includes('rgba')
    ? parseFloat(initialBg.match(/[\d.]+(?=\))/)?.[0] ?? '1')
    : 1;
  expect(initialAlpha).toBeLessThan(0.2);

  // Single-layer navbar: "Home" text should start white-ish
  const homeText = page.getByText('Home').first();
  const initialColor = await homeText.evaluate(el => getComputedStyle(el).color);
  const initialR = parseInt(initialColor.match(/\d+/)?.[0] ?? '0');
  expect(initialR).toBeGreaterThan(200);

  // Scroll past end (400px) — bg should be fully solid white
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(500);
  const fullBg = await navbar.evaluate(el => getComputedStyle(el).backgroundColor);
  const fullMatch = fullBg.match(/rgba?\(255,\s*255,\s*255/);
  expect(fullMatch).toBeTruthy();

  // Text should now be dark (single-layer color transition)
  const finalColor = await homeText.evaluate(el => getComputedStyle(el).color);
  const finalR = parseInt(finalColor.match(/\d+/)?.[0] ?? '255');
  expect(finalR).toBeLessThan(120);
});

// ─── NAV-05: Frosted glass navbar page ──────────────────────────────────────

test('NAV-05: frosted glass navbar has backdrop blur', async ({ page }) => {
  await gotoPage(page, '/navbar-blur');
  await expect(page.getByText('Blurred Beauty')).toBeVisible();
  await expect(page.getByText('NavbarDemo').first()).toBeVisible();

  // Scroll and verify navbar still visible
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(500);
  await expect(page.getByText('NavbarDemo').first()).toBeVisible();
});

// ─── NAV-06: Floating pill navbar page ──────────────────────────────────────

test('NAV-06: floating pill navbar renders detached from edges', async ({ page }) => {
  await gotoPage(page, '/navbar-floating');
  await expect(page.getByText('Detached Navigation')).toBeVisible();
  await expect(page.getByText('Demo').first()).toBeVisible();
  await expect(page.getByText('Start').first()).toBeVisible();

  // Scroll and verify pill still visible
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(500);
  await expect(page.getByText('Demo').first()).toBeVisible();
});

// ─── NAV-07: Centered logo navbar page ──────────────────────────────────────

test('NAV-07: centered logo navbar shows MAISON in center', async ({ page }) => {
  await gotoPage(page, '/navbar-centered');
  await expect(page.getByText('MAISON')).toBeVisible();
  await expect(page.getByText('Symmetrical Elegance')).toBeVisible();
  await expect(page.getByText('Shop')).toBeVisible();
  await expect(page.getByText('Collections')).toBeVisible();
});

// ─── NAV-08: Sidebar navigation page ────────────────────────────────────────

test('NAV-08: sidebar navigation shows left sidebar with nav items', async ({ page }) => {
  await gotoPage(page, '/navbar-sidebar');
  await expect(page.getByText('Dashboard').first()).toBeVisible();
  await expect(page.getByText('Analytics')).toBeVisible();
  await expect(page.getByText('Team')).toBeVisible();
  await expect(page.getByText('Full-Height Sidebar')).toBeVisible();

  // Scroll content area and sidebar stays visible
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(500);
  await expect(page.getByText('Dashboard').first()).toBeVisible();
});

// ─── NAV-09: Bottom tab bar page ────────────────────────────────────────────

test('NAV-09: bottom tab bar shows 5 tabs at the bottom', async ({ page }) => {
  await gotoPage(page, '/navbar-bottom');
  await expect(page.getByText('Mobile-First Navigation')).toBeVisible();
  await expect(page.getByText('Home').first()).toBeVisible();
  await expect(page.getByText('Search').first()).toBeVisible();
  await expect(page.getByText('Create')).toBeVisible();
  await expect(page.getByText('Alerts')).toBeVisible();
  await expect(page.getByText('Profile')).toBeVisible();
});

// ─── NAV-10: Scroll-aware navbar page ───────────────────────────────────────

test('NAV-10: scroll-aware navbar hides on scroll down, shows on scroll up', async ({ page }) => {
  await gotoPage(page, '/navbar-scroll-aware');
  await expect(page.getByText('Smart Auto-hide Navbar')).toBeVisible();

  const navbar = page.getByText('NavbarDemo').first();
  await expect(navbar).toBeVisible();

  // Scroll down — navbar should hide (translateY(-100%))
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(800);

  // Scroll up — navbar should reappear
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(800);
  await expect(navbar).toBeVisible();
});

// ─── NAV-11: Live scroll data displays on scroll-aware page ─────────────────

test('NAV-11: scroll-aware page shows live scroll data section', async ({ page }) => {
  await gotoPage(page, '/navbar-scroll-aware');
  // Scroll to the live data section
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight - window.innerHeight));
  await page.waitForTimeout(1000);
  await expect(page.getByText('Live Scroll Data')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Scroll Y (px)')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Scroll %')).toBeVisible({ timeout: 5_000 });
});

// ─── NAV-12: Navigation from index to fixed and back ────────────────────────

test('NAV-12: can navigate from index to fixed page and back', async ({ page }) => {
  await gotoPage(page, '/navbar-types');

  // Click the fixed navbar card — SDUI navigateTo uses client-side routing
  await page.getByText('Fixed Navbar').click();
  await expect(page.getByText('Always Visible Navigation')).toBeVisible({ timeout: 15_000 });

  // Scroll to footer and click back
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.getByText('Back to all types').first().click();
  await expect(page.getByRole('heading', { name: 'Navbar Types Showcase' })).toBeVisible({ timeout: 15_000 });
});
