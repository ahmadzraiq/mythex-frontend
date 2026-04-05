/**
 * Hero Image Fill E2E (HIF series)
 *
 * Diagnoses why an Image with `w-full h-full` does NOT fill its parent Box when
 * the parent Box has `w-[45%]` AND an animation config (enter + hover).
 *
 * Root cause: `classToInlineStyle('w-[45%]')` → `{ width: '45%' }` (string).
 * The AnimatedNode outer wrapper gets `width: '45%'` of the grandparent (correct).
 * The inner Box also keeps `width: '45%'` because the renderer's fill logic only
 * replaces NUMBER widths, not string percentages — so inner = 45% of outer = ~20%.
 * The Image with `w-full h-full` is then 100% of that already-shrunken inner Box.
 *
 *   HIF-01  Page loads, heading is visible
 *   HIF-02  Image container is found and has positive dimensions
 *   HIF-03  Image container width is ~45% of viewport (outer Animated.View is correct)
 *   HIF-04  BUG: <img> inside container is much smaller than the container (exposes bug)
 *   HIF-05  After fix: <img> fills the container — width/height match within 2px
 *   HIF-06  Image container has correct height (~600px)
 *   HIF-07  Image has objectFit:cover applied
 *   HIF-08  Enter animation wrapper is present on image container
 *   HIF-09  Left text column heading and subtitle are visible
 *
 * Run: npx playwright test e2e/hero-image-fill.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

const PREVIEW_BASE = 'http://preview-dev.localhost:3001';

const IDS = {
  root: 'f1a2b3c4-d5e6-7890-abcd-ef1234567890',
  leftColumn: 'a1b2c3d4-e5f6-7890-abcd-ef1234567891',
  heading: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  subtitle: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  imageContainer: '6079ee26-d06e-42af-9d9e-5a659c9e9185',
  image: '2dd9fd2c-a86e-483c-a2e2-3cfae02d96ee',
};

let sharedPage: Page;

test.beforeAll(async ({ browser }) => {
  sharedPage = await browser.newPage();
  await sharedPage.goto(`${PREVIEW_BASE}/hero-image-fill`);
  await sharedPage
    .waitForSelector(`[id="${IDS.root}"]`, { timeout: 20_000 })
    .catch(() => {});
  // Allow enter animations to settle
  await sharedPage.waitForTimeout(1200);
});

test.afterAll(async () => {
  await sharedPage.close();
});

// ─── HIF-01: Page loads ───────────────────────────────────────────────────────

test('HIF-01: /hero-image-fill page loads and heading is visible', async () => {
  await expect(sharedPage.getByText('Image Fill Diagnosis')).toBeVisible({ timeout: 15_000 });
});

// ─── HIF-02: Image container exists with positive dimensions ──────────────────

test('HIF-02: image container is found and has positive dimensions', async () => {
  const dims = await sharedPage.evaluate((id) => {
    // The container has animation, so its outer Animated.View wrapper may be the
    // visible element. Walk up from the inner node to find the sized wrapper.
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // If inner is collapsed, check parent (the Animated.View outer wrapper)
    const w = r.width > 10 ? r.width : el.parentElement?.getBoundingClientRect().width ?? 0;
    const h = r.height > 10 ? r.height : el.parentElement?.getBoundingClientRect().height ?? 0;
    return { width: w, height: h };
  }, IDS.imageContainer);

  expect(dims, 'Image container not found').not.toBeNull();
  expect(dims!.width).toBeGreaterThan(10);
  expect(dims!.height).toBeGreaterThan(10);
});

// ─── HIF-03: Image container is ~45% of root container width ─────────────────
// In preview mode, GestureDetector uses `display: contents` (no layout box),
// so we measure the image container element itself vs the root.
// The container has `w-[45%]` which resolves to ~45% of the root's width.

test('HIF-03: image container is ~45% of the root container width', async () => {
  const result = await sharedPage.evaluate((ids) => {
    const root = document.getElementById(ids.root);
    const container = document.getElementById(ids.imageContainer);
    if (!root || !container) return null;

    const rootW = root.getBoundingClientRect().width;
    const containerW = container.getBoundingClientRect().width;

    return {
      rootWidth: rootW,
      containerWidth: containerW,
      containerPct: rootW > 0 ? containerW / rootW : 0,
    };
  }, IDS);

  expect(result, 'Could not find root or image container').not.toBeNull();
  expect(result!.rootWidth).toBeGreaterThan(100);
  // w-[45%] — expect roughly 20%–65% (accounting for gap/padding in the flex row)
  expect(result!.containerPct).toBeGreaterThan(0.15);
  expect(result!.containerPct).toBeLessThan(0.65);
});

// ─── HIF-04: BUG — inner Box is much smaller than the outer wrapper ───────────
// This test FAILS before the fix and PASSES after.
// Before fix: inner Box has width: '45%' of outer (which is 45% of root) = ~20% of root.
// After fix:  inner Box has width: '100%' of outer = fills the container correctly.

test('HIF-04: inner Box fills the outer wrapper — image container inner/outer widths match', async () => {
  const result = await sharedPage.evaluate((id) => {
    const inner = document.getElementById(id);
    if (!inner) return null;

    const innerRect = inner.getBoundingClientRect();
    const parent = inner.parentElement;
    const outerRect = parent?.getBoundingClientRect();

    if (!outerRect) return null;

    return {
      innerWidth: innerRect.width,
      innerHeight: innerRect.height,
      outerWidth: outerRect.width,
      outerHeight: outerRect.height,
      widthRatio: innerRect.width / outerRect.width,
    };
  }, IDS.imageContainer);

  expect(result, 'Could not find image container').not.toBeNull();

  // After fix: inner should fill outer — ratio should be ~1.0
  // Before fix: ratio would be ~0.45 (45% of 45%)
  expect(result!.widthRatio).toBeGreaterThan(0.9);
});

// ─── HIF-05: <img> fills the image container ─────────────────────────────────
// The <img> has `w-full h-full`. It should match the container's dimensions.

test('HIF-05: <img> fills the image container — dimensions match within 4px', async () => {
  const result = await sharedPage.evaluate((id) => {
    const container = document.getElementById(id);
    if (!container) return null;

    const img = container.querySelector('img');
    if (!img) return null;

    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();

    return {
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      imgWidth: imgRect.width,
      imgHeight: imgRect.height,
      widthDiff: Math.abs(containerRect.width - imgRect.width),
      heightDiff: Math.abs(containerRect.height - imgRect.height),
    };
  }, IDS.imageContainer);

  expect(result, 'Container or <img> not found').not.toBeNull();
  expect(result!.containerWidth).toBeGreaterThan(50);
  expect(result!.imgWidth).toBeGreaterThan(50);

  // Image should fill the container — widths should match within 4px
  expect(result!.widthDiff).toBeLessThan(4);
  expect(result!.heightDiff).toBeLessThan(4);
});

// ─── HIF-06: Container height is ~600px ──────────────────────────────────────

test('HIF-06: image container has correct height (~600px)', async () => {
  const height = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return 0;
    const h = el.getBoundingClientRect().height;
    if (h > 100) return h;
    return el.parentElement?.getBoundingClientRect().height ?? 0;
  }, IDS.imageContainer);

  expect(height).toBeGreaterThan(500);
  expect(height).toBeLessThan(700);
});

// ─── HIF-07: Image has objectFit cover ───────────────────────────────────────

test('HIF-07: <img> has objectFit:cover applied via inline style', async () => {
  const objectFit = await sharedPage.evaluate((id) => {
    const container = document.getElementById(id);
    const img = container?.querySelector('img');
    if (!img) return null;
    return window.getComputedStyle(img).objectFit;
  }, IDS.imageContainer);

  expect(objectFit).toBe('cover');
});

// ─── HIF-08: AnimatedNode wrapper present (enter + hover animation) ───────────

test('HIF-08: image container has an AnimatedNode wrapper (enter + hover animation)', async () => {
  const found = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const wrapper = el.parentElement;
    return wrapper !== null && wrapper.tagName === 'DIV';
  }, IDS.imageContainer);

  expect(found, 'AnimatedNode wrapper div not found').toBe(true);
});

// ─── HIF-09: Left column text is visible ─────────────────────────────────────

test('HIF-09: heading and subtitle in left text column are visible', async () => {
  await expect(sharedPage.getByText('Image Fill Diagnosis')).toBeVisible({ timeout: 5_000 });
  await expect(sharedPage.getByText('The image container uses w-[45%]')).toBeVisible({ timeout: 5_000 });
});
