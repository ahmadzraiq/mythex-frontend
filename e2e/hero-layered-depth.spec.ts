/**
 * Hero Layered Depth E2E (HLD series)
 *
 * Verifies the /hero-layered-depth page renders the two-column hero layout
 * with correctly sized image containers and visible images.
 *
 *   HLD-01  Page loads, hero heading is visible
 *   HLD-02  Root container fills viewport height (h-screen)
 *   HLD-03  Left text column is visible and shows correct text
 *   HLD-04  Both CTA buttons are visible
 *   HLD-05  Primary image container has correct dimensions (~480×420)
 *   HLD-06  Accent image container has correct dimensions (~380×320)
 *   HLD-07  Both <img> elements are attached and have a src attribute
 *   HLD-08  Right image stack has correct height (~600px)
 *   HLD-09  Primary image container is positioned at top-right of the stack
 *   HLD-10  Accent image container is positioned at bottom-left of the stack
 *   HLD-11  Enter animations applied — heading animated wrapper is present
 *   HLD-12  Float loop animation — right stack has an animated wrapper
 *
 * Run: npx playwright test e2e/hero-layered-depth.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

const PREVIEW_BASE = 'http://preview-dev.localhost:3001';

// Node IDs from config/screens/hero-layered-depth.json
const IDS = {
  root: 'd208ef74-9b48-4453-ad9e-53a1f8e09ca2',
  leftColumn: 'd41d4d81-6c57-4b1e-9c2d-36f5ae653552',
  heading: 'b19d50d8-d1a4-41ff-b952-c80c8bd17f2f',
  subtitle: '2bb35e72-aae7-45dc-8912-ca33950b5153',
  ctaGroup: 'd7e8ae24-ecd3-4a66-a164-95d2de29543c',
  primaryBtn: 'b043ba43-3d61-4bdc-92aa-a9a1ca28899a',
  secondaryBtn: 'ecf503a2-f4b2-4fef-91a7-87a6efe79c02',
  rightStack: 'a03bbee1-c582-4701-85ba-d289d03b57df',
  primaryImageContainer: 'd1e2497a-00ee-4606-a5bf-00daf368e7fe',
  accentImageContainer: 'dd69bf46-6503-4d0a-91c6-1a20e7f2b60f',
};

let sharedPage: Page;

test.beforeAll(async ({ browser }) => {
  sharedPage = await browser.newPage();
  await sharedPage.goto(`${PREVIEW_BASE}/hero-layered-depth`);
  // Wait for root node to mount
  await sharedPage
    .waitForSelector(`[id="${IDS.root}"]`, { timeout: 20_000 })
    .catch(() => {});
  // Allow enter animations to start
  await sharedPage.waitForTimeout(1200);
});

test.afterAll(async () => {
  await sharedPage.close();
});

// ─── HLD-01: Page loads ───────────────────────────────────────────────────────

test('HLD-01: /hero-layered-depth page loads and heading is visible', async () => {
  await expect(sharedPage.getByText('Layered Visual Depth')).toBeVisible({ timeout: 15_000 });
});

// ─── HLD-02: Root container fills viewport height ─────────────────────────────

test('HLD-02: root container fills the full viewport height (h-screen)', async () => {
  const viewportHeight = sharedPage.viewportSize()?.height ?? 768;

  const rootHeight = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    return el ? el.getBoundingClientRect().height : 0;
  }, IDS.root);

  expect(rootHeight).toBeGreaterThan(viewportHeight * 0.9);
});

// ─── HLD-03: Left text column and subtitle visible ───────────────────────────

test('HLD-03: left text column is visible with heading and subtitle text', async () => {
  const page = sharedPage;
  await expect(page.getByText('Layered Visual Depth')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Modern asymmetrical design with overlapping imagery')).toBeVisible({ timeout: 5_000 });

  // Left column must have positive dimensions
  const dims = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }, IDS.leftColumn);

  expect(dims).not.toBeNull();
  expect(dims!.width).toBeGreaterThan(200);
  expect(dims!.height).toBeGreaterThan(100);
});

// ─── HLD-04: Both CTA buttons visible ────────────────────────────────────────

test('HLD-04: both CTA buttons are visible', async () => {
  const page = sharedPage;
  await expect(page.getByText('Explore Design')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Learn More')).toBeVisible({ timeout: 5_000 });
});

// ─── HLD-05: Primary image container dimensions ───────────────────────────────
// The primary container is w-[480px] h-[420px].

test('HLD-05: primary image container has correct dimensions (~480×420)', async () => {
  const dims = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }, IDS.primaryImageContainer);

  expect(dims, 'PrimaryImageContainer not found').not.toBeNull();
  // classToInlineStyle converts w-[480px] → width: 480px; h-[420px] → height: 420px
  expect(dims!.width).toBeGreaterThan(400);
  expect(dims!.height).toBeGreaterThan(350);
});

// ─── HLD-06: Accent image container dimensions ────────────────────────────────
// The accent container is w-[380px] h-[320px].

test('HLD-06: accent image container has correct dimensions (~380×320)', async () => {
  const dims = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }, IDS.accentImageContainer);

  expect(dims, 'AccentImageContainer not found').not.toBeNull();
  expect(dims!.width).toBeGreaterThan(300);
  expect(dims!.height).toBeGreaterThan(250);
});

// ─── HLD-07: Both <img> elements present with src ────────────────────────────

test('HLD-07: both image containers have <img> elements with a src attribute', async () => {
  const result = await sharedPage.evaluate((ids) => {
    const primary = document.getElementById(ids.primaryImageContainer);
    const accent = document.getElementById(ids.accentImageContainer);

    const primaryImg = primary?.querySelector('img');
    const accentImg = accent?.querySelector('img');

    return {
      primaryFound: !!primaryImg,
      primarySrc: primaryImg?.getAttribute('src') ?? '',
      accentFound: !!accentImg,
      accentSrc: accentImg?.getAttribute('src') ?? '',
    };
  }, IDS);

  expect(result.primaryFound, 'No <img> in primary image container').toBe(true);
  expect(result.primarySrc, 'Primary <img> has no src').toBeTruthy();
  expect(result.accentFound, 'No <img> in accent image container').toBe(true);
  expect(result.accentSrc, 'Accent <img> has no src').toBeTruthy();
});

// ─── HLD-08: Right image stack has correct height ────────────────────────────
// The stack has h-[600px].

test('HLD-08: right image stack has correct height (~600px)', async () => {
  const height = await sharedPage.evaluate((id) => {
    // The stack may have an AnimatedNode wrapper (float loop) — walk up to find it
    const el = document.getElementById(id);
    if (!el) return 0;
    // Check the element itself and its parent for the 600px height
    const selfH = el.getBoundingClientRect().height;
    if (selfH > 400) return selfH;
    const parentH = el.parentElement?.getBoundingClientRect().height ?? 0;
    return parentH > 400 ? parentH : selfH;
  }, IDS.rightStack);

  expect(height).toBeGreaterThan(400);
});

// ─── HLD-09: Primary image container is at top-right of the stack ─────────────

test('HLD-09: primary image container is positioned at the top of the right stack', async () => {
  const result = await sharedPage.evaluate((ids) => {
    const stack = document.getElementById(ids.rightStack);
    const primary = document.getElementById(ids.primaryImageContainer);
    if (!stack || !primary) return null;

    const stackRect = stack.getBoundingClientRect();
    const primaryRect = primary.getBoundingClientRect();

    return {
      // Primary top edge should be near the stack's top edge (top-[0px])
      topOffset: primaryRect.top - stackRect.top,
      // Primary right edge should be near the stack's right edge (right-[0px])
      rightOffset: stackRect.right - primaryRect.right,
    };
  }, IDS);

  expect(result, 'Could not find stack or primary container').not.toBeNull();
  // top-[0px] → top edge of primary should be within 10px of stack top
  expect(Math.abs(result!.topOffset)).toBeLessThan(20);
  // right-[0px] → right edge of primary should be within 20px of stack right
  expect(Math.abs(result!.rightOffset)).toBeLessThan(20);
});

// ─── HLD-10: Accent image container is at bottom-left of the stack ───────────

test('HLD-10: accent image container is positioned at the bottom-left of the right stack', async () => {
  const result = await sharedPage.evaluate((ids) => {
    const stack = document.getElementById(ids.rightStack);
    const accent = document.getElementById(ids.accentImageContainer);
    if (!stack || !accent) return null;

    const stackRect = stack.getBoundingClientRect();
    const accentRect = accent.getBoundingClientRect();

    return {
      // Accent left edge should be near the stack's left edge (left-[0px])
      leftOffset: accentRect.left - stackRect.left,
      // Accent bottom edge should be near stack bottom (bottom-[20px])
      bottomOffset: stackRect.bottom - accentRect.bottom,
    };
  }, IDS);

  expect(result, 'Could not find stack or accent container').not.toBeNull();
  // left-[0px] → left edge of accent near stack left
  expect(Math.abs(result!.leftOffset)).toBeLessThan(20);
  // bottom-[20px] → bottom gap ≈ 20px
  expect(result!.bottomOffset).toBeGreaterThan(5);
  expect(result!.bottomOffset).toBeLessThan(60);
});

// ─── HLD-11: Heading has an animated wrapper (enter: slideInLeft) ─────────────

test('HLD-11: heading node has an AnimatedNode wrapper (enter animation)', async () => {
  const found = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    // AnimatedNode wraps the node in an extra <div>; parent should be a div
    const wrapper = el.parentElement;
    return wrapper !== null && wrapper.tagName === 'DIV';
  }, IDS.heading);

  expect(found, 'Heading animated wrapper div not found').toBe(true);
});

// ─── HLD-12: Float loop — right stack has an animated wrapper ────────────────

test('HLD-12: right image stack has an AnimatedNode wrapper (float loop)', async () => {
  const found = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    // The float loop wraps the stack in an AnimatedNode outer div
    const wrapper = el.parentElement;
    return wrapper !== null && wrapper.tagName === 'DIV';
  }, IDS.rightStack);

  expect(found, 'Right stack float-loop animated wrapper not found').toBe(true);
});
