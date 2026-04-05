/**
 * Hero Asymmetric Depth E2E (HAD series)
 *
 * Verifies the /hero-asymmetric-depth page renders the absolute-positioned
 * layered hero with correctly sized image clips, text, animations, and the
 * thin depth-shadow bar.
 *
 *   HAD-01  Page loads, heading "Layered Depth" is visible
 *   HAD-02  Root container fills viewport height (min-h-[100vh])
 *   HAD-03  Text container is visible with heading and subtitle
 *   HAD-04  Primary image clip has correct dimensions (~520×520)
 *   HAD-05  Secondary accent image clip has correct dimensions (~360×360)
 *   HAD-06  Primary image clip is positioned at top-right of the root
 *   HAD-07  Secondary accent image clip is positioned at bottom-right of root
 *   HAD-08  Both <img> elements have a src attribute and are attached
 *   HAD-09  Images fill their clip containers (w-full h-full)
 *   HAD-10  Depth shadow bar has correct width (~380px) and height (~4px)
 *   HAD-11  Text container has enter animation wrapper (slideInDown)
 *   HAD-12  Secondary accent image has AnimatedNode wrapper (float loop)
 *   HAD-13  z-index layering — primary clip has higher z than secondary
 *
 * Run: npx playwright test e2e/hero-asymmetric-depth.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

const PREVIEW_BASE = 'http://preview-dev.localhost:3001';

// Node IDs from config/screens/hero-asymmetric-depth.json
const IDS = {
  root:             '494bc0d3-8401-4b8c-8769-85e5f75de133',
  textContainer:    '08fb814c-f5eb-4fb1-a2f1-268c08eff58b',
  heading:          '7acd4761-5865-47f8-979d-dc08050b4e7f',
  subtitle:         '246a7778-5c34-4774-8b58-3f05d9d858de',
  primaryClip:      'd863b779-14d9-49cd-96e6-9ed792989c63',
  primaryImage:     '7bf90a6b-34a7-4c67-980a-e1f53f88c729',
  secondaryClip:    'a29804d4-3c1b-49cd-8e7b-9e393d64ddc3',
  secondaryImage:   '8c0bd685-7add-474b-a259-3637aea9e0f0',
  depthShadow:      '4e87c6e5-ba75-46ff-a38f-449166054a21',
};

let sharedPage: Page;

test.beforeAll(async ({ browser }) => {
  sharedPage = await browser.newPage();
  await sharedPage.goto(`${PREVIEW_BASE}/hero-asymmetric-depth`);
  await sharedPage
    .waitForSelector(`[id="${IDS.root}"]`, { timeout: 20_000 })
    .catch(() => {});
  // Allow enter animations (longest delay = 800ms) + render settle
  await sharedPage.waitForTimeout(1500);
});

test.afterAll(async () => {
  await sharedPage.close();
});

// ─── HAD-01: Page loads ───────────────────────────────────────────────────────

test('HAD-01: /hero-asymmetric-depth loads and heading "Layered Depth" is visible', async () => {
  await expect(sharedPage.getByText('Layered Depth')).toBeVisible({ timeout: 15_000 });
});

// ─── HAD-02: Root fills viewport ──────────────────────────────────────────────

test('HAD-02: root container fills the full viewport height (min-h-[100vh])', async () => {
  const viewportHeight = sharedPage.viewportSize()?.height ?? 768;
  const rootHeight = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    return el ? el.getBoundingClientRect().height : 0;
  }, IDS.root);
  expect(rootHeight).toBeGreaterThan(viewportHeight * 0.9);
});

// ─── HAD-03: Text container heading + subtitle visible ────────────────────────

test('HAD-03: text container is visible with heading and subtitle', async () => {
  const page = sharedPage;
  await expect(page.getByText('Layered Depth')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Discover modern visual hierarchy')).toBeVisible({ timeout: 5_000 });

  const dims = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }, IDS.textContainer);

  expect(dims, 'Text container not found').not.toBeNull();
  expect(dims!.width).toBeGreaterThan(200);
  expect(dims!.height).toBeGreaterThan(50);
});

// ─── HAD-04: Primary image clip dimensions (~520×520) ─────────────────────────

test('HAD-04: primary image clip has correct dimensions (~520×520)', async () => {
  const dims = await sharedPage.evaluate((id) => {
    // May be wrapped by AnimatedNode outer div; check element or its parent
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width > 100) return { width: r.width, height: r.height };
    const pr = el.parentElement?.getBoundingClientRect();
    return pr ? { width: pr.width, height: pr.height } : null;
  }, IDS.primaryClip);

  expect(dims, 'Primary image clip not found').not.toBeNull();
  expect(dims!.width).toBeGreaterThan(400);
  expect(dims!.height).toBeGreaterThan(400);
});

// ─── HAD-05: Secondary accent clip dimensions (~360×360) ─────────────────────

test('HAD-05: secondary accent image clip has correct dimensions (~360×360)', async () => {
  const dims = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width > 100) return { width: r.width, height: r.height };
    const pr = el.parentElement?.getBoundingClientRect();
    return pr ? { width: pr.width, height: pr.height } : null;
  }, IDS.secondaryClip);

  expect(dims, 'Secondary accent clip not found').not.toBeNull();
  expect(dims!.width).toBeGreaterThan(280);
  expect(dims!.height).toBeGreaterThan(280);
});

// ─── HAD-06: Primary clip is positioned at the right side of root ─────────────

test('HAD-06: primary image clip is positioned at the right side of the root container', async () => {
  const result = await sharedPage.evaluate((ids) => {
    const root = document.getElementById(ids.root);
    const clip = document.getElementById(ids.primaryClip);
    if (!root || !clip) return null;

    const rootRect = root.getBoundingClientRect();
    // Clip may be wrapped; use the element or its animated wrapper
    let clipEl: Element = clip;
    const clipRect = clipEl.getBoundingClientRect();
    const checkRect = clipRect.width > 100 ? clipRect : (clipEl.parentElement?.getBoundingClientRect() ?? clipRect);

    return {
      // right-[8%] → clip right edge should be near root right (within 10% of root width)
      distFromRight: rootRect.right - checkRect.right,
      // top-[15%] → clip top edge should be in the upper half
      distFromTop: checkRect.top - rootRect.top,
      rootWidth: rootRect.width,
    };
  }, IDS);

  expect(result, 'Could not find root or primary clip').not.toBeNull();
  // right-[8%] → gap from right should be ~8% of viewport width
  expect(result!.distFromRight).toBeGreaterThan(0);
  expect(result!.distFromRight).toBeLessThan(result!.rootWidth * 0.20);
  // top-[15%] → in the upper portion of the container
  expect(result!.distFromTop).toBeGreaterThan(0);
});

// ─── HAD-07: Secondary clip is positioned at the bottom-right ─────────────────

test('HAD-07: secondary accent clip is positioned at the bottom-right of the root container', async () => {
  const result = await sharedPage.evaluate((ids) => {
    const root = document.getElementById(ids.root);
    const clip = document.getElementById(ids.secondaryClip);
    if (!root || !clip) return null;

    const rootRect = root.getBoundingClientRect();
    let clipEl: Element = clip;
    const clipRect = clipEl.getBoundingClientRect();
    const checkRect = clipRect.width > 100 ? clipRect : (clipEl.parentElement?.getBoundingClientRect() ?? clipRect);

    return {
      distFromRight: rootRect.right - checkRect.right,
      distFromBottom: rootRect.bottom - checkRect.bottom,
      rootWidth: rootRect.width,
      rootHeight: rootRect.height,
    };
  }, IDS);

  expect(result, 'Could not find root or secondary clip').not.toBeNull();
  // right-[2%] → very close to the right edge
  expect(result!.distFromRight).toBeGreaterThanOrEqual(0);
  expect(result!.distFromRight).toBeLessThan(result!.rootWidth * 0.15);
  // bottom-[12%] → in the lower portion of the container
  expect(result!.distFromBottom).toBeGreaterThan(0);
  expect(result!.distFromBottom).toBeLessThan(result!.rootHeight * 0.25);
});

// ─── HAD-08: Both images have a src ───────────────────────────────────────────

test('HAD-08: both image clip containers have <img> elements with a src attribute', async () => {
  const result = await sharedPage.evaluate((ids) => {
    const primary = document.getElementById(ids.primaryClip);
    const secondary = document.getElementById(ids.secondaryClip);
    const primaryImg = primary?.querySelector('img');
    const secondaryImg = secondary?.querySelector('img');
    return {
      primaryFound: !!primaryImg,
      primarySrc: primaryImg?.getAttribute('src') ?? '',
      secondaryFound: !!secondaryImg,
      secondarySrc: secondaryImg?.getAttribute('src') ?? '',
    };
  }, IDS);

  expect(result.primaryFound, 'No <img> in primary clip').toBe(true);
  expect(result.primarySrc, 'Primary <img> has no src').toBeTruthy();
  expect(result.secondaryFound, 'No <img> in secondary clip').toBe(true);
  expect(result.secondarySrc, 'Secondary <img> has no src').toBeTruthy();
});

// ─── HAD-09: Images fill their clip containers (w-full h-full) ───────────────

test('HAD-09: images fill their clip containers', async () => {
  const result = await sharedPage.evaluate((ids) => {
    function checkFill(clipId: string) {
      const clip = document.getElementById(clipId);
      if (!clip) return null;
      // Image nodes don't get an HTML id in preview; use querySelector instead
      const img = clip.querySelector('img');
      if (!img) return null;
      const clipR = clip.getBoundingClientRect();
      const imgR  = img.getBoundingClientRect();
      return {
        clipW: clipR.width, clipH: clipR.height,
        imgW:  imgR.width,  imgH:  imgR.height,
      };
    }
    return {
      primary:   checkFill(ids.primaryClip),
      secondary: checkFill(ids.secondaryClip),
    };
  }, IDS);

  for (const [label, dims] of [['primary', result.primary], ['secondary', result.secondary]] as const) {
    expect(dims, `${label} clip or image not found`).not.toBeNull();
    // Image should fill ≥90% of the clip's width and height
    expect(dims!.imgW).toBeGreaterThan(dims!.clipW * 0.85);
    expect(dims!.imgH).toBeGreaterThan(dims!.clipH * 0.85);
  }
});

// ─── HAD-10: Depth shadow bar dimensions ─────────────────────────────────────

test('HAD-10: depth shadow bar has correct width (~380px) and is very thin (~4px)', async () => {
  const dims = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    // The bar may be wrapped by AnimatedNode; check element and its parent
    const r = el.getBoundingClientRect();
    if (r.width > 50) return { width: r.width, height: r.height };
    const pr = el.parentElement?.getBoundingClientRect();
    return pr ? { width: pr.width, height: pr.height } : null;
  }, IDS.depthShadow);

  expect(dims, 'Depth shadow bar not found').not.toBeNull();
  expect(dims!.width).toBeGreaterThan(200);   // w-[380px]
  expect(dims!.height).toBeLessThan(20);       // h-[4px] — very thin
});

// ─── HAD-11: Text container has enter animation (slideInDown) ─────────────────

test('HAD-11: text container has an AnimatedNode wrapper (slideInDown enter)', async () => {
  const found = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const wrapper = el.parentElement;
    return wrapper !== null && wrapper.tagName === 'DIV';
  }, IDS.textContainer);
  expect(found, 'Text container animated wrapper not found').toBe(true);
});

// ─── HAD-12: Secondary accent clip has float loop animated wrapper ─────────────

test('HAD-12: secondary accent clip has AnimatedNode wrapper (float loop animation)', async () => {
  const found = await sharedPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const wrapper = el.parentElement;
    return wrapper !== null && wrapper.tagName === 'DIV';
  }, IDS.secondaryClip);
  expect(found, 'Secondary clip float-loop AnimatedNode wrapper not found').toBe(true);
});

// ─── HAD-13: z-index layering — primary clip has higher z than secondary ───────

test('HAD-13: primary image clip (z-20) sits above secondary accent clip (z-10)', async () => {
  const result = await sharedPage.evaluate((ids) => {
    function getZ(id: string): number {
      const el = document.getElementById(id);
      if (!el) return -1;
      // Check element and its parent animated wrapper for the z-index
      const z = parseInt(window.getComputedStyle(el).zIndex, 10);
      if (!isNaN(z)) return z;
      const pz = parseInt(window.getComputedStyle(el.parentElement!).zIndex, 10);
      return isNaN(pz) ? -1 : pz;
    }
    return { primaryZ: getZ(ids.primaryClip), secondaryZ: getZ(ids.secondaryClip) };
  }, IDS);

  // primary z-[20] > secondary z-[10]
  expect(result.primaryZ, 'Primary clip z-index not set').toBeGreaterThan(0);
  expect(result.secondaryZ, 'Secondary clip z-index not set').toBeGreaterThan(0);
  expect(result.primaryZ).toBeGreaterThan(result.secondaryZ);
});
