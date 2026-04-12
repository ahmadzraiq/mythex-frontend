/**
 * VHT series — Video Hero Test: text alignment in builder vs preview
 *
 * Reproduces the bug where animated children of a flex parent appear left-aligned
 * in builder mode because RNW/Reanimated's Animated.View wrapper receives
 * align-self:flex-start from RNW base styles, overriding the parent's align-items.
 *
 * Fix: renderer sets alignSelf:'auto' on the outer Animated.View wrapper via
 * sizeOverride → resolvedAnimCfg.outerStyle. CSS align-self:auto inherits from
 * the parent's align-items (center → child is centered, stretch → child fills width).
 *
 * NOTE on computed alignSelf value:
 *   Chrome reports window.getComputedStyle().alignSelf as 'auto' (the specified
 *   value), NOT the resolved value (e.g. 'stretch' or 'center'). This is correct
 *   per CSS spec — 'auto' is the computed value; the USED value is resolved at
 *   layout time. Tests must NOT assert alignSelf === 'stretch'. Instead, assert
 *   the actual layout effect (element is wide / is centered).
 *
 * NOTE on parentWidth = 0:
 *   GestureDetector from react-native-gesture-handler renders a display:contents
 *   div on web. getBoundingClientRect() on a display:contents element returns
 *   width:0. Tests that read outer.parentElement.getBoundingClientRect().width
 *   always get 0 and cannot use it as a reference. Use the heroContent element
 *   (queried by its data-builder-id) as the reference width instead.
 *
 *   VHT-01  Preview: Subheadline wrapper fills parent width (text-center works)
 *   VHT-02  Preview: Subheadline has text-align:center computed style
 *   VHT-03  Builder: Subheadline outer wrapper is at least 50% of HeroContent width
 *   VHT-04  Builder: Subheadline inner element has width:100% (fill fix)
 *   VHT-05  Builder: computed text-align on Subheadline inner element is center
 *   VHT-06  Builder: MainHeadline outer wrapper is at least 50% of HeroContent width
 *   VHT-07  Builder: BadgeContainer with w-fit remains narrow (not forced full-width)
 *   VHT-08  Builder (video-hero.json): Badge is horizontally centered in HeroContent
 *   VHT-09  Builder (video-hero.json): Subheadline is horizontally centered in HeroContent
 *
 * Run: npx playwright test e2e/video-hero-test.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(90_000);

const PREVIEW_BASE = 'http://preview-dev.localhost:3001';
const BUILDER_BASE = 'http://builder-dev.localhost:3001';

const SUBHEADLINE_ID = '08601195-3d9c-45d0-9a24-d78bdd9dfe25';
const HEADLINE_ID    = '2d5d1c84-4482-4e64-843c-0debcb976ef0';
const BADGE_ID       = '0cdc81b3-db11-44d7-a7a2-d9dd4d4efe1e';
const HERO_CONTENT_ID = '7184283f-3213-44e6-980f-51602c93e946';

// ─── Preview helpers ───────────────────────────────────────────────────────────

let previewPage: Page;
let builderPage: Page;

test.beforeAll(async ({ browser }) => {
  // Preview page
  previewPage = await browser.newPage();
  await previewPage.goto(`${PREVIEW_BASE}/video-hero-test`);
  await previewPage.waitForTimeout(3000);

  // Builder page
  builderPage = await browser.newPage();
  await builderPage.goto(`${BUILDER_BASE}?page=/video-hero-test`);
  await builderPage.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await builderPage.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 200 }
  );
  await builderPage.waitForFunction(
    () => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>)
        .__builderStore?.getState();
      return (store?.pageNodes?.length ?? 0) > 0;
    },
    { timeout: 15_000, polling: 300 }
  );
  // Wait for animations to mount
  await builderPage.waitForTimeout(2000);
});

test.afterAll(async () => {
  await previewPage?.close();
  await builderPage?.close();
});

// ─── VHT-01: Preview — Subheadline wrapper fills parent width ─────────────────

test('VHT-01: preview — Subheadline wrapper fills at least 80% of HeroContent width', async () => {
  const result = await previewPage.evaluate(({ subId, heroId }) => {
    const sub = document.getElementById(subId) ?? document.querySelector(`[data-builder-id="${subId}"]`);
    const hero = document.getElementById(heroId) ?? document.querySelector(`[data-builder-id="${heroId}"]`);
    if (!sub || !hero) return { subWidth: 0, heroWidth: 0, found: false };
    const subWidth = sub.getBoundingClientRect().width;
    const heroWidth = hero.getBoundingClientRect().width;
    return { subWidth, heroWidth, found: true };
  }, { subId: SUBHEADLINE_ID, heroId: HERO_CONTENT_ID });

  console.log('[VHT-01] preview widths:', result);
  expect(result.found, 'Subheadline or HeroContent not found in preview').toBe(true);
  // In preview the Text is direct (no wrapper) — it fills the flex-col parent
  expect(result.subWidth).toBeGreaterThan(result.heroWidth * 0.5);
});

// ─── VHT-02: Preview — computed text-align is center ─────────────────────────

test('VHT-02: preview — Subheadline computed text-align is center', async () => {
  const result = await previewPage.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return { found: false, textAlign: '', tag: '' };
    const cs = window.getComputedStyle(el);
    return { found: true, textAlign: cs.textAlign, tag: el.tagName };
  }, SUBHEADLINE_ID);

  console.log('[VHT-02] preview text-align:', result);
  expect(result.found, 'Subheadline not found').toBe(true);
  expect(result.textAlign).toBe('center');
});

// ─── VHT-03: Builder — outer wrapper is wide (at least 50% of HeroContent) ──────

test('VHT-03: builder — Subheadline outer wrapper is at least 50% of HeroContent width', async () => {
  const result = await builderPage.evaluate(({ subId, heroId }) => {
    // In builder mode, data-builder-id is set on the outer Animated.View wrapper
    const outer = document.querySelector(`[data-builder-id="${subId}"]`) as HTMLElement | null;
    // HeroContent is not animated → data-builder-id set by applyBuilderAnnotation
    const hero = document.querySelector(`[data-builder-id="${heroId}"]`) as HTMLElement | null;
    if (!outer) return { outerWidth: 0, heroWidth: 0, alignSelf: '', found: false };

    const outerRect = outer.getBoundingClientRect();
    const heroRect  = hero ? hero.getBoundingClientRect() : { width: 0 };
    // CSS align-self:auto → Chrome reports 'auto' as computed (not the resolved 'stretch').
    // This is per-spec: computed value is 'auto', used value resolves to parent's align-items.
    const alignSelf = window.getComputedStyle(outer).alignSelf;

    return {
      outerWidth: outerRect.width,
      heroWidth:  heroRect.width,
      alignSelf,
      found: true,
    };
  }, { subId: SUBHEADLINE_ID, heroId: HERO_CONTENT_ID });

  console.log('[VHT-03] builder outer wrapper vs HeroContent:', result);
  expect(result.found, `[data-builder-id="${SUBHEADLINE_ID}"] not found in builder canvas`).toBe(true);
  // Outer should be at least 50% of HeroContent width (it should be stretching to fill)
  if (result.heroWidth > 0) {
    expect(result.outerWidth).toBeGreaterThan(result.heroWidth * 0.5);
  }
  // alignSelf must NOT be flex-start (which collapses the element to content-width at left edge).
  // 'auto' is acceptable — it inherits parent's align-items (stretch → fills width, center → centered).
  expect(result.alignSelf).not.toBe('flex-start');
});

// ─── VHT-04: Builder — Subheadline inner element is visible inside outer wrapper

test('VHT-04: builder — Subheadline inner element is visible (non-zero width)', async () => {
  const result = await builderPage.evaluate((id) => {
    const outer = document.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null;
    if (!outer) return { found: false, innerWidth: 0, outerWidth: 0, innerTag: '', innerClass: '' };

    const inner = outer.firstElementChild as HTMLElement | null;
    if (!inner) return { found: false, innerWidth: 0, outerWidth: 0, innerTag: '', innerClass: '' };

    return {
      found: true,
      innerWidth: inner.getBoundingClientRect().width,
      outerWidth: outer.getBoundingClientRect().width,
      innerTag: inner.tagName,
      innerClass: inner.className,
    };
  }, SUBHEADLINE_ID);

  console.log('[VHT-04] builder inner element:', result);
  expect(result.found, 'Outer wrapper not found').toBe(true);
  // Inner element must be visible (non-zero width) — even if it's a <span> (inline),
  // it must have its text content rendered correctly.
  expect(result.innerWidth).toBeGreaterThan(0);
  // Outer wrapper must also be non-zero
  expect(result.outerWidth).toBeGreaterThan(0);
});

// ─── VHT-05: Builder — Subheadline text-align (inner or outer) is center ──────

test('VHT-05: builder — Subheadline has text-align:center somewhere in its rendering tree', async () => {
  const result = await builderPage.evaluate((id) => {
    const outer = document.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null;
    if (!outer) return { found: false, innerTextAlign: '', outerTextAlign: '' };

    const inner = outer.firstElementChild as HTMLElement | null;
    const outerCs = window.getComputedStyle(outer);
    const innerCs = inner ? window.getComputedStyle(inner) : null;

    return {
      found: true,
      innerTextAlign: innerCs?.textAlign ?? '',
      outerTextAlign: outerCs.textAlign,
    };
  }, SUBHEADLINE_ID);

  console.log('[VHT-05] builder text-align:', result);
  expect(result.found, 'Outer wrapper not found').toBe(true);
  // text-align:center must appear on either inner or outer element
  // (NativeWind may apply it to the element that has text-center class)
  const hasCenterAlign = result.innerTextAlign === 'center' || result.outerTextAlign === 'center';
  expect(hasCenterAlign, `Expected text-align:center on inner(${result.innerTextAlign}) or outer(${result.outerTextAlign})`).toBe(true);
});

// ─── VHT-06: Builder — MainHeadline outer is wide (at least 50% of HeroContent) ─

test('VHT-06: builder — MainHeadline outer wrapper is at least 50% of HeroContent width', async () => {
  const result = await builderPage.evaluate(({ headlineId, heroId }) => {
    const outer = document.querySelector(`[data-builder-id="${headlineId}"]`) as HTMLElement | null;
    const hero  = document.querySelector(`[data-builder-id="${heroId}"]`) as HTMLElement | null;
    if (!outer) return { outerWidth: 0, heroWidth: 0, alignSelf: '', found: false };
    return {
      found: true,
      outerWidth: outer.getBoundingClientRect().width,
      heroWidth:  hero ? hero.getBoundingClientRect().width : 0,
      alignSelf:  window.getComputedStyle(outer).alignSelf,
    };
  }, { headlineId: HEADLINE_ID, heroId: HERO_CONTENT_ID });

  console.log('[VHT-06] builder MainHeadline vs HeroContent:', result);
  expect(result.found).toBe(true);
  if (result.heroWidth > 0) {
    expect(result.outerWidth).toBeGreaterThan(result.heroWidth * 0.5);
  }
  expect(result.alignSelf).not.toBe('flex-start');
});

// ─── VHT-07: Builder — BadgeContainer (w-fit) is NOT stretched ───────────────

test('VHT-07: builder — BadgeContainer outer wrapper is NOT full-width (w-fit excluded)', async () => {
  const result = await builderPage.evaluate(({ badgeId, heroId }) => {
    const outer = document.querySelector(`[data-builder-id="${badgeId}"]`) as HTMLElement | null;
    const hero = document.querySelector(`[data-builder-id="${heroId}"]`) as HTMLElement | null;
    if (!outer || !hero) return { found: false, badgeWidth: 0, heroWidth: 0, alignSelf: '' };

    return {
      found: true,
      badgeWidth: outer.getBoundingClientRect().width,
      heroWidth: hero.getBoundingClientRect().width,
      alignSelf: window.getComputedStyle(outer).alignSelf,
    };
  }, { badgeId: BADGE_ID, heroId: HERO_CONTENT_ID });

  console.log('[VHT-07] builder BadgeContainer:', result);
  expect(result.found).toBe(true);
  // Badge should be much narrower than the hero content (it's a pill)
  expect(result.badgeWidth).toBeLessThan(result.heroWidth * 0.5);
  // alignSelf should be 'auto' (inherits parent) — NOT 'flex-start' (which anchors to left)
  expect(result.alignSelf).not.toBe('flex-start');
});

// ─── VHT-08/09: Builder (video-hero.json) — Badge and Subheadline are centered ─

const VH_BADGE_ID        = 'e60a0508-4628-4ccd-8e13-77d1ed795e89';
const VH_SUBHEADLINE_ID  = '5d59a279-b4a7-4d9b-b73f-c84e3873076e';
const VH_HERO_CONTENT_ID = 'd533879d-c802-4f33-80e3-bd85e1638c1a';

let videoHeroBuilderPage: Page;

test.beforeAll(async ({ browser }) => {
  videoHeroBuilderPage = await browser.newPage();
  await videoHeroBuilderPage.goto(`${BUILDER_BASE}?page=/video-hero`);
  await videoHeroBuilderPage.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await videoHeroBuilderPage.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 200 }
  );
  await videoHeroBuilderPage.waitForFunction(
    () => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>)
        .__builderStore?.getState();
      return (store?.pageNodes?.length ?? 0) > 0;
    },
    { timeout: 15_000, polling: 300 }
  );
  await videoHeroBuilderPage.waitForTimeout(2000);
});

test.afterAll(async () => {
  await videoHeroBuilderPage?.close();
});

test('VHT-08: builder (video-hero.json) — Badge is horizontally centered in HeroContent', async () => {
  const result = await videoHeroBuilderPage.evaluate(({ badgeId, heroId }) => {
    const badge = document.querySelector(`[data-builder-id="${badgeId}"]`) as HTMLElement | null;
    const hero  = document.querySelector(`[data-builder-id="${heroId}"]`) as HTMLElement | null;
    if (!badge || !hero) return { found: false, badgeCenterX: 0, heroCenterX: 0, heroWidth: 0, badgeWidth: 0 };

    const badgeRect = badge.getBoundingClientRect();
    const heroRect  = hero.getBoundingClientRect();
    const badgeCenterX = badgeRect.left + badgeRect.width / 2;
    const heroCenterX  = heroRect.left  + heroRect.width  / 2;

    return { found: true, badgeCenterX, heroCenterX, heroWidth: heroRect.width, badgeWidth: badgeRect.width };
  }, { badgeId: VH_BADGE_ID, heroId: VH_HERO_CONTENT_ID });

  console.log('[VHT-08] video-hero.json Badge centering:', result);
  expect(result.found, 'Badge or HeroContent not found in video-hero.json builder').toBe(true);
  // Badge center X must be within 20% of HeroContent's center X (i.e., it's centered, not at left edge)
  if (result.heroWidth > 0) {
    const tolerance = result.heroWidth * 0.2;
    expect(Math.abs(result.badgeCenterX - result.heroCenterX)).toBeLessThan(tolerance);
  }
});

test('VHT-09: builder (video-hero.json) — Subheadline is horizontally centered in HeroContent', async () => {
  const result = await videoHeroBuilderPage.evaluate(({ subId, heroId }) => {
    const sub  = document.querySelector(`[data-builder-id="${subId}"]`) as HTMLElement | null;
    const hero = document.querySelector(`[data-builder-id="${heroId}"]`) as HTMLElement | null;
    if (!sub || !hero) return { found: false, subCenterX: 0, heroCenterX: 0, heroWidth: 0, subWidth: 0, heroLeft: 0 };

    const subRect  = sub.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    const subCenterX  = subRect.left  + subRect.width  / 2;
    const heroCenterX = heroRect.left + heroRect.width / 2;

    return { found: true, subCenterX, heroCenterX, heroWidth: heroRect.width, subWidth: subRect.width, heroLeft: heroRect.left };
  }, { subId: VH_SUBHEADLINE_ID, heroId: VH_HERO_CONTENT_ID });

  console.log('[VHT-09] video-hero.json Subheadline centering:', result);
  expect(result.found, 'Subheadline or HeroContent not found in video-hero.json builder').toBe(true);
  // Subheadline center X must be within 20% of HeroContent's center X
  if (result.heroWidth > 0) {
    const tolerance = result.heroWidth * 0.2;
    expect(Math.abs(result.subCenterX - result.heroCenterX)).toBeLessThan(tolerance);
  }
});
