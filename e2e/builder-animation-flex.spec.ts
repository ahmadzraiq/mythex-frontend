/**
 * FLEX series — AnimatedNode flex-shrink regression tests
 *
 * Reproduces the bug where two w-full siblings in a flex-row collapse when one
 * is wrapped by AnimatedNode (Animated.View defaults to flex-shrink:0 in RNW,
 * so it never yields space to its sibling).
 *
 * FLEX-01  Two w-full columns in flex-row — animated left, plain right.
 *          Both must be roughly equal width (within 20%).
 *
 * FLEX-02  Real-world hero layout (exact replica from AI builder output).
 *          Left column has NO animation but animated children.
 *          Right column has enter animation ON the container itself.
 *          Both must be roughly equal width (within 20%).
 *
 * Run:  npx playwright test e2e/builder-animation-flex.spec.ts
 */

import { test, expect } from '@playwright/test';

test.setTimeout(60_000);

test('FLEX-01: animated w-full column is not wider than non-animated sibling in flex-row', async ({ page }) => {
  await page.goto('http://preview-dev.localhost:3001/animation-test');

  // Wait for the page-ready marker (always rendered near the top of the screen)
  await page.waitForSelector('[data-testid="anim-ready"]', { timeout: 30_000 });

  // Wait for the Phase 18 card to be in the DOM
  await page.waitForSelector('[data-testid="card-p18"]', { timeout: 15_000 });

  // Scroll card-p18 into view so animations trigger (enter animations fire on mount/visibility)
  await page.locator('[data-testid="card-p18"]').scrollIntoViewIfNeeded();

  // Allow the enter animation to start (it runs on mount, not scroll, but give a tick)
  await page.waitForTimeout(600);

  // Measure both columns
  const leftBox  = await page.locator('[data-testid="p18-col-left"]').boundingBox();
  const rightBox = await page.locator('[data-testid="p18-col-right"]').boundingBox();

  expect(leftBox,  'Left animated column must be visible').not.toBeNull();
  expect(rightBox, 'Right plain column must be visible').not.toBeNull();

  const leftWidth  = leftBox!.width;
  const rightWidth = rightBox!.width;

  console.log(`FLEX-01 column widths — left (animated): ${leftWidth.toFixed(1)}px, right (plain): ${rightWidth.toFixed(1)}px`);

  // Neither column should be collapsed (< 80px means something went badly wrong)
  expect(leftWidth,  `Left animated column collapsed (${leftWidth.toFixed(1)}px)`).toBeGreaterThan(80);
  expect(rightWidth, `Right plain column collapsed (${rightWidth.toFixed(1)}px)`).toBeGreaterThan(80);

  // Both columns must be within 20% of each other.
  // Before fix: animated column ≈ full parent width, right ≈ 0 → ratio >> 0.2 → FAIL
  // After fix:  both ≈ 50% of parent → ratio << 0.2 → PASS
  const maxW = Math.max(leftWidth, rightWidth);
  const ratio = Math.abs(leftWidth - rightWidth) / maxW;
  expect(
    ratio,
    `Column widths differ by more than 20% (left=${leftWidth.toFixed(1)}, right=${rightWidth.toFixed(1)}, ratio=${(ratio * 100).toFixed(1)}%). ` +
    `The animated column (AnimatedNode/Animated.View) is likely collapsing its sibling due to flex-shrink:0.`
  ).toBeLessThan(0.2);
});

test('FLEX-02: real-world hero — animated image column does not collapse text column', async ({ page }) => {
  await page.goto('http://preview-dev.localhost:3001/animation-test');

  await page.waitForSelector('[data-testid="anim-ready"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="card-p19"]', { timeout: 15_000 });

  // Scroll into view so the zoomIn animation fires
  await page.locator('[data-testid="card-p19"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);

  const contentBox = await page.locator('[data-testid="p19-col-content"]').boundingBox();
  const imageBox   = await page.locator('[data-testid="p19-col-image"]').boundingBox();

  expect(contentBox, 'Content column (no direct animation) must be visible').not.toBeNull();
  expect(imageBox,   'Image column (animated with zoomIn) must be visible').not.toBeNull();

  const contentWidth = contentBox!.width;
  const imageWidth   = imageBox!.width;

  console.log(`FLEX-02 hero widths — content (no anim): ${contentWidth.toFixed(1)}px, image (zoomIn): ${imageWidth.toFixed(1)}px`);

  // Neither column should be collapsed
  expect(contentWidth, `Content column collapsed (${contentWidth.toFixed(1)}px)`).toBeGreaterThan(80);
  expect(imageWidth,   `Image column collapsed (${imageWidth.toFixed(1)}px)`).toBeGreaterThan(80);

  // Both columns must be within 20% of each other
  const maxW = Math.max(contentWidth, imageWidth);
  const ratio = Math.abs(contentWidth - imageWidth) / maxW;
  expect(
    ratio,
    `Hero columns differ by more than 20% (content=${contentWidth.toFixed(1)}, image=${imageWidth.toFixed(1)}, ratio=${(ratio * 100).toFixed(1)}%). ` +
    `The animated image column (zoomIn → AnimatedNode) is collapsing the text column. flexShrink:1 fix missing on Animated.View wrapper.`
  ).toBeLessThan(0.2);
});
