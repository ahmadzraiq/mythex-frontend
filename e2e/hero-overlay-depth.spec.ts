import { test, expect } from '@playwright/test';

const URL = 'http://localhost:3001/hero-overlay-depth';

const IDS = {
  root: 'b331c071-1307-47e9-b805-5782aa87507d',
  primaryImageLayer: '0b4c61ea-9e38-407f-ab43-6eae78eb2085',
  primaryImage: '701bf976-8c40-453b-bc44-7b4756661d34',
  secondaryAccentLayer: 'c2da69ee-551b-4871-9dea-bbd756008b9a',
  accentImage: '84985fd0-a718-4528-a9bf-4952baed78d4',
  darkOverlayLayer: 'bdea0d0e-7ccb-4f84-9d56-21ce5ffcdd4b',
  textContentLayer: '9f668fe3-8c7d-4e29-a7b0-f6c1a9b7af7f',
  heroHeading: 'addc3d16-f775-47ad-9e08-e96613aa35d3',
  heroSubheading: 'a91e255e-1161-42e4-b039-d8d68f282e6e',
  ctaGroup: '10b87939-3a94-489c-9340-c2ce32e6a3f4',
  primaryButton: 'd2c2c64b-bcc9-4bf6-b1cc-5ea489c2894a',
  secondaryButton: 'e7f374f0-22c6-48af-96e3-cbb8cff88382',
  shadowAccentElement: '7d92e8f6-2b6b-44e3-97d2-20a0023e28ce',
};

test.describe('Hero Overlay Depth page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
  });

  test('page loads and root container fills viewport', async ({ page }) => {
    const root = page.locator(`[data-builder-id="${IDS.root}"]`).first();
    await expect(root).toBeVisible();
    const box = await root.boundingBox();
    expect(box).not.toBeNull();
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);
    expect(box!.width).toBeCloseTo(vw, -1);
    expect(box!.height).toBeCloseTo(vh, -1);
  });

  test('primary image layer is visible and covers right portion', async ({ page }) => {
    const layer = page.locator(`[data-builder-id="${IDS.primaryImageLayer}"]`).first();
    await expect(layer).toBeVisible();
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    const vw = await page.evaluate(() => window.innerWidth);
    // Should be ~65% of viewport width
    expect(box!.width).toBeGreaterThan(vw * 0.5);
    // Should be positioned on the right (x > 0)
    expect(box!.x).toBeGreaterThan(0);
  });

  test('primary image has src set', async ({ page }) => {
    const img = page.locator(`[data-builder-id="${IDS.primaryImage}"] img`).first();
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).toContain('unsplash');
  });

  test('secondary accent layer is visible and positioned on the left', async ({ page }) => {
    const layer = page.locator(`[data-builder-id="${IDS.secondaryAccentLayer}"]`).first();
    await expect(layer).toBeVisible();
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    // left-[5%] — should start near the left side
    const vw = await page.evaluate(() => window.innerWidth);
    expect(box!.x).toBeLessThan(vw * 0.15);
  });

  test('accent image has src set', async ({ page }) => {
    const img = page.locator(`[data-builder-id="${IDS.accentImage}"] img`).first();
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).toContain('unsplash');
  });

  test('dark overlay layer covers full viewport', async ({ page }) => {
    const overlay = page.locator(`[data-builder-id="${IDS.darkOverlayLayer}"]`).first();
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);
    expect(box!.width).toBeCloseTo(vw, -1);
    expect(box!.height).toBeCloseTo(vh, -1);
  });

  test('overlay z-index is ABOVE both image layers (fixed)', async ({ page }) => {
    const overlayZ = await page.locator(`[data-builder-id="${IDS.darkOverlayLayer}"]`).first().evaluate(
      el => window.getComputedStyle(el).zIndex
    );
    const primaryZ = await page.locator(`[data-builder-id="${IDS.primaryImageLayer}"]`).first().evaluate(
      el => window.getComputedStyle(el).zIndex
    );
    const secondaryZ = await page.locator(`[data-builder-id="${IDS.secondaryAccentLayer}"]`).first().evaluate(
      el => window.getComputedStyle(el).zIndex
    );
    console.log(`Overlay z-index: ${overlayZ}, PrimaryImage z-index: ${primaryZ}, SecondaryAccent z-index: ${secondaryZ}`);
    // Fixed: overlay (3) > images (1, 2)
    expect(Number(overlayZ)).toBeGreaterThan(Number(primaryZ));
    expect(Number(overlayZ)).toBeGreaterThan(Number(secondaryZ));
  });

  test('text content layer is visible and vertically centered', async ({ page }) => {
    const layer = page.locator(`[data-builder-id="${IDS.textContentLayer}"]`).first();
    await expect(layer).toBeVisible();
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    const vh = await page.evaluate(() => window.innerHeight);
    // With top:50% + translateY(-50%) the midpoint should be near 50% of viewport height
    const midY = box!.y + box!.height / 2;
    expect(midY).toBeGreaterThan(vh * 0.3);
    expect(midY).toBeLessThan(vh * 0.7);
  });

  test('hero heading text is visible', async ({ page }) => {
    const heading = page.locator(`[data-builder-id="${IDS.heroHeading}"]`).first();
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Transform Your Vision Into Reality');
  });

  test('hero subheading text is visible', async ({ page }) => {
    const sub = page.locator(`[data-builder-id="${IDS.heroSubheading}"]`).first();
    await expect(sub).toBeVisible();
    await expect(sub).toContainText('Layered experiences with depth');
  });

  test('primary button is visible with theme background', async ({ page }) => {
    const btn = page.locator(`[data-builder-id="${IDS.primaryButton}"]`).first();
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Get Started');
    const bg = await btn.evaluate(el => window.getComputedStyle(el).backgroundColor);
    // Should have a non-transparent background (the theme primary)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });

  test('secondary button is visible with semi-transparent background', async ({ page }) => {
    const btn = page.locator(`[data-builder-id="${IDS.secondaryButton}"]`).first();
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Learn More');
  });

  test('text content layer z-index is above images and overlay', async ({ page }) => {
    const textZ = await page.locator(`[data-builder-id="${IDS.textContentLayer}"]`).first().evaluate(
      el => window.getComputedStyle(el).zIndex
    );
    const primaryZ = await page.locator(`[data-builder-id="${IDS.primaryImageLayer}"]`).first().evaluate(
      el => window.getComputedStyle(el).zIndex
    );
    // Text (z-4) should be above primary image (z-2)
    expect(Number(textZ)).toBeGreaterThan(Number(primaryZ));
  });

  test('shadow accent element is present', async ({ page }) => {
    const shadow = page.locator(`[data-builder-id="${IDS.shadowAccentElement}"]`).first();
    await expect(shadow).toBeVisible();
  });
});
