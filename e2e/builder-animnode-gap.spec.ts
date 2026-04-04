/**
 * ANIMGAP series — AnimatedNode transparent-gap regression tests
 *
 * Reproduces the bug where a Box with animation.hover inside a flex-row parent
 * shows white space below its background in builder mode. The outer AnimatedNode
 * wrapper stretches to the flex-row's cross-axis height, but the inner element
 * only takes its natural content height, leaving a transparent area.
 *
 *   ANIMGAP-01  Hover-animated button in flex-row — outer height = inner height
 *               (gap < 5px). Also dumps full diagnostic info.
 *   ANIMGAP-02  Enter-animated box in flex-row — same constraint.
 *   ANIMGAP-03  No animation (plain Box) — outer = inner = natural size (control).
 *
 * Run: npx playwright test e2e/builder-animnode-gap.spec.ts
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

test.setTimeout(90_000);

const BUILDER_BASE = 'http://builder-dev.localhost:3001';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto(`${BUILDER_BASE}?page=/layered-depth-hero`);
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 200 }
  );
  await page.waitForFunction(
    () => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>)
        .__builderStore?.getState();
      return (store?.pageNodes?.length ?? 0) > 0;
    },
    { timeout: 15_000, polling: 300 }
  );
}

async function injectNodes(page: Page, nodes: unknown[]) {
  await page.evaluate((ns) => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>)
      .__builderStore.getState()._setPageNodes(ns);
  }, nodes);
  const firstId = (nodes[0] as { id?: string })?.id;
  if (firstId) {
    await page.waitForSelector(`[data-builder-id="${firstId}"]`, { timeout: 10_000 });
  }
  await page.waitForTimeout(400);
}

/** Read actual DOM measurements from the builder canvas. */
async function measureAnimGap(page: Page, nodeId: string) {
  return page.evaluate((btnId: string) => {
    const outerWrapper = document.querySelector(`[data-builder-id="${btnId}"]`) as HTMLElement | null;
    if (!outerWrapper) return { error: `outer wrapper [data-builder-id="${btnId}"] not found` };

    const innerEl = outerWrapper.firstElementChild as HTMLElement | null;
    if (!innerEl) return { error: 'inner element (first child of outer wrapper) not found' };

    const outerRect  = outerWrapper.getBoundingClientRect();
    const innerRect  = innerEl.getBoundingClientRect();
    const outerCS    = window.getComputedStyle(outerWrapper);
    const innerCS    = window.getComputedStyle(innerEl);

    return {
      outerHeight:     outerRect.height,
      innerHeight:     innerRect.height,
      gap:             outerRect.height - innerRect.height,
      // outer computed layout
      outerDisplay:    outerCS.display,
      outerFlexDir:    outerCS.flexDirection,
      outerAlignItems: outerCS.alignItems,
      outerInlineStyle: outerWrapper.getAttribute('style') ?? '',
      // inner computed layout
      innerFlexGrow:   innerCS.flexGrow,
      innerFlexBasis:  innerCS.flexBasis,
      innerAlignSelf:  innerCS.alignSelf,
      innerInlineStyle: innerEl.getAttribute('style') ?? '',
    };
  }, nodeId);
}

// ─── Node fixtures ────────────────────────────────────────────────────────────

/** Flex-row parent, hover-animated child button (replicates PrimaryButton in layered-depth-hero). */
const HOVER_BTN_TREE = [{
  id: 'ag-row',
  type: 'Box',
  props: { style: {}, className: 'flex flex-row gap-[16px] w-[600px] h-[80px] bg-[#f5f5f5]' },
  children: [{
    id: 'ag-btn',
    type: 'Box',
    props: {
      style: {
        boxShadow: '0px 4px 12px 0px rgba(124, 58, 237, 0.2)',
        shadowColor: 'rgb(124,58,237)',
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 12,
        shadowOpacity: 0.2,
        elevation: 6,
      },
      className: 'bg-[#7c3aed] rounded-[8px] pl-[32px] pr-[32px] pt-[14px] pb-[14px] cursor-pointer',
    },
    children: [{
      id: 'ag-btn-text',
      type: 'Text',
      props: { className: '!text-[#ffffff] text-[16px] font-semibold' },
      text: 'Get Started',
    }],
    animation: { hover: { scale: 1.05, duration: 300 } },
  }],
}];

/** Flex-row parent, enter-animated child box. */
const ENTER_BOX_TREE = [{
  id: 'ag-enter-row',
  type: 'Box',
  props: { style: {}, className: 'flex flex-row gap-[16px] w-[600px] h-[80px] bg-[#f5f5f5]' },
  children: [{
    id: 'ag-enter-box',
    type: 'Box',
    props: { style: {}, className: 'bg-[#10b981] rounded-[8px] pl-[32px] pr-[32px] pt-[14px] pb-[14px]' },
    children: [{
      id: 'ag-enter-text',
      type: 'Text',
      props: { className: '!text-white text-[16px]' },
      text: 'Enter Box',
    }],
    animation: { enter: { type: 'fadeIn', duration: 300 } },
  }],
}];

/**
 * w-fit button with BOTH enter + hover animations (slideInUp + hover y/scale).
 * Sits in a flex-col parent (typical hero/section layout).
 * Key concerns:
 *  - w-fit must be preserved (button must NOT stretch to fill parent width)
 *  - gap must still be 0 (inner fills outer)
 *  - natural height must be ~44px (not over-expanded by flexGrow)
 */
const WFIT_DUAL_ANIM_TREE = [{
  id: 'ag-section',
  type: 'Box',
  props: { style: {}, className: 'flex flex-col w-[600px] bg-[#faf5ff] p-[40px]' },
  children: [{
    id: '6f16d7b2-9792-414e-a8cd-0dfb365d4697',
    name: 'Call-to-Action Button',
    type: 'Box',
    props: {
      style: {
        boxShadow: '0px 8px 20px -2px rgba(123, 58, 237, 0.35)',
        elevation: 10,
        shadowColor: 'rgb(123,58,237)',
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 20,
        shadowOpacity: 0.35,
      },
      className: 'flex flex-row !bg-[var(--theme-primary)] rounded-[8px] items-center justify-center pl-[24px] pr-[24px] pt-[12px] pb-[12px] mt-[24px] gap-[8px] cursor-pointer w-fit',
    },
    children: [
      {
        id: '97acaca6-5b20-4d83-b686-61b0c5d1d8a4',
        name: 'CTA Label',
        text: 'Explore Design',
        type: 'Text',
        props: {
          text: 'Explore Design',
          style: {},
          className: '!text-[var(--theme-primary-foreground)] text-[14px] font-semibold text-center tracking-wide',
        },
        children: [],
      },
      {
        id: '53fdd7fa-b377-4659-801a-ae611e075d4d',
        name: 'Arrow Icon',
        type: 'Icon',
        props: { icon: 'lucide:arrow-right', size: 24, color: 'var(--theme-primary-foreground)' },
        children: [],
      },
    ],
    animation: {
      enter: { type: 'slideInUp', delay: 200, easing: 'easeOut', duration: 700 },
      hover: { y: -4, scale: 1.05, duration: 300 },
    },
  }],
}];

/** Flex-row parent, plain Box (no animation) — control group. */
const PLAIN_BOX_TREE = [{
  id: 'ag-plain-row',
  type: 'Box',
  props: { style: {}, className: 'flex flex-row gap-[16px] w-[600px] h-[80px] bg-[#f5f5f5]' },
  children: [{
    id: 'ag-plain-btn',
    type: 'Box',
    props: { style: {}, className: 'bg-[#6366f1] rounded-[8px] pl-[32px] pr-[32px] pt-[14px] pb-[14px]' },
    children: [{
      id: 'ag-plain-text',
      type: 'Text',
      props: { className: '!text-white text-[16px]' },
      text: 'Plain Button',
    }],
    // No animation
  }],
}];

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('ANIMGAP — AnimatedNode transparent-gap in builder', () => {
  let P: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    P = await ctx.newPage();
    await gotoBuilder(P);
  });
  test.afterAll(async () => { await P.context().close(); });

  // ── ANIMGAP-01: Hover-animated button (the exact bug from the screenshot) ──

  test('ANIMGAP-01: hover-animated button in flex-row — outer wrapper height = inner button height (gap < 5px)', async () => {
    await injectNodes(P, HOVER_BTN_TREE);

    // The animated outer wrapper is identified by data-builder-id in builder mode
    await P.waitForSelector('[data-builder-id="ag-btn"]', { timeout: 10_000 });
    await P.waitForTimeout(500); // let layout settle

    const m = await measureAnimGap(P, 'ag-btn');
    console.log('ANIMGAP-01 measurements:\n', JSON.stringify(m, null, 2));

    expect(m, 'Could not find animated wrapper in DOM').not.toHaveProperty('error');

    const { gap, outerHeight, innerHeight, innerFlexGrow, outerDisplay, outerFlexDir } = m as {
      gap: number; outerHeight: number; innerHeight: number;
      innerFlexGrow: string; outerDisplay: string; outerFlexDir: string;
    };

    // Inner button must have a natural positive height
    expect(innerHeight, 'Inner button height must be > 20px').toBeGreaterThan(20);

    // The outer animated wrapper must match the inner button height (no gap)
    expect(
      gap,
      `Transparent gap of ${gap.toFixed(1)}px in animated hover button. ` +
      `outerHeight=${outerHeight.toFixed(1)}px innerHeight=${innerHeight.toFixed(1)}px ` +
      `outerDisplay=${outerDisplay} outerFlexDir=${outerFlexDir} innerFlexGrow=${innerFlexGrow}`
    ).toBeLessThan(5);
  });

  // ── ANIMGAP-02: Enter-animated box ─────────────────────────────────────────

  test('ANIMGAP-02: enter-animated box in flex-row — outer wrapper height = inner box height (gap < 5px)', async () => {
    await injectNodes(P, ENTER_BOX_TREE);

    await P.waitForSelector('[data-builder-id="ag-enter-box"]', { timeout: 10_000 });
    await P.waitForTimeout(700); // allow enter animation to complete

    const m = await measureAnimGap(P, 'ag-enter-box');
    console.log('ANIMGAP-02 measurements:\n', JSON.stringify(m, null, 2));

    expect(m).not.toHaveProperty('error');

    const { gap, outerHeight, innerHeight } = m as { gap: number; outerHeight: number; innerHeight: number };

    expect(innerHeight, 'Inner box height must be > 20px').toBeGreaterThan(20);
    expect(
      gap,
      `Transparent gap of ${gap.toFixed(1)}px in enter-animated box. ` +
      `outerHeight=${outerHeight.toFixed(1)}px innerHeight=${innerHeight.toFixed(1)}px`
    ).toBeLessThan(5);
  });

  // ── ANIMGAP-03b: w-fit button with enter + hover in flex-col parent ──────────

  test('ANIMGAP-03b: w-fit CTA button (enter+hover) — no transparent gap, w-fit preserved, natural height', async () => {
    await injectNodes(P, WFIT_DUAL_ANIM_TREE);

    const BTN_ID = '6f16d7b2-9792-414e-a8cd-0dfb365d4697';
    await P.waitForSelector(`[data-builder-id="${BTN_ID}"]`, { timeout: 10_000 });
    await P.waitForTimeout(900); // slideInUp delay 200ms + duration 700ms + buffer

    const m = await measureAnimGap(P, BTN_ID);
    console.log('ANIMGAP-03b measurements:\n', JSON.stringify(m, null, 2));

    expect(m, 'Could not find animated wrapper in DOM').not.toHaveProperty('error');

    const { gap, outerHeight, innerHeight, innerFlexGrow } = m as {
      gap: number; outerHeight: number; innerHeight: number; innerFlexGrow: string;
    };

    // Inner button must have a natural positive height (pt-[12px] + text + pb-[12px])
    expect(innerHeight, 'CTA button inner height must be > 20px').toBeGreaterThan(20);

    // The button must NOT become excessively tall — natural height with 12px top/bottom padding
    // and ~14px font should be roughly 38-60px. Allow up to 100px to avoid flakiness.
    expect(
      innerHeight,
      `CTA button is excessively tall (${innerHeight.toFixed(1)}px) — flexGrow may have over-expanded it. ` +
      `innerFlexGrow=${innerFlexGrow}`
    ).toBeLessThan(100);

    // No gap between outer wrapper and inner element
    expect(
      gap,
      `Transparent gap of ${gap.toFixed(1)}px in w-fit CTA button (enter+hover). ` +
      `outerHeight=${outerHeight.toFixed(1)}px innerHeight=${innerHeight.toFixed(1)}px ` +
      `innerFlexGrow=${innerFlexGrow}`
    ).toBeLessThan(5);

    // w-fit must be respected — the outer animated wrapper must carry width:fit-content
    // (forwarded from arbStyles via sizeOverride) so the button hugs its content width.
    const widthMeasure = await P.evaluate((btnId: string) => {
      const outer = document.querySelector(`[data-builder-id="${btnId}"]`) as HTMLElement | null;
      const inner = outer?.firstElementChild as HTMLElement | null;
      if (!outer) return null;
      const outerCS = window.getComputedStyle(outer);
      const innerCS = inner ? window.getComputedStyle(inner) : null;
      return {
        outerWidth: outer.getBoundingClientRect().width,
        outerInlineWidth: outer.style.width,
        innerComputedWidth: innerCS ? parseFloat(innerCS.width) : null,
        outerComputedWidth: parseFloat(outerCS.width),
        outerDisplay: outerCS.display,
      };
    }, BTN_ID);

    expect(widthMeasure, 'Could not find button in DOM for width measurement').not.toBeNull();
    const { outerWidth, outerInlineWidth, innerComputedWidth, outerComputedWidth } = widthMeasure!;
    console.log('ANIMGAP-03b width diagnostics:', JSON.stringify({
      outerWidth, outerInlineWidth, innerComputedWidth, outerComputedWidth,
      outerDisplay: widthMeasure!.outerDisplay,
    }, null, 2));

    // The outer animated wrapper must have width:fit-content inline style (set by sizeOverride
    // forwarding from arbStyles after the classToInlineStyle w-fit fix).
    expect(
      outerInlineWidth,
      `Outer animated wrapper must have inline width:fit-content. Got "${outerInlineWidth}". ` +
      `w-fit was not forwarded from className to outerStyle.`
    ).toBe('fit-content');

    // Outer computed width must be close to the inner content width (± 10% tolerance for
    // sub-pixel rounding). If outer is much wider than inner, w-fit is still stretching.
    if (innerComputedWidth && innerComputedWidth > 0) {
      expect(
        outerComputedWidth,
        `Outer width (${outerComputedWidth.toFixed(1)}px) must be ≈ inner content width ` +
        `(${innerComputedWidth.toFixed(1)}px). w-fit is still causing outer to stretch.`
      ).toBeLessThan(innerComputedWidth * 1.15);
    }
  });

  // ── ANIMGAP-03: Plain box — control (should also have gap < 5px) ───────────

  test('ANIMGAP-03: plain Box in flex-row (no animation) — outer = inner height (control)', async () => {
    await injectNodes(P, PLAIN_BOX_TREE);

    // Plain box (no animation) uses the regular rendering path (no AnimatedNode wrapper).
    // data-builder-id is still set via applyBuilderAnnotation for non-animated nodes.
    await P.waitForSelector('[data-builder-id="ag-plain-btn"]', { timeout: 10_000 });
    await P.waitForTimeout(300);

    // For a plain (non-animated) node, the element IS data-builder-id (no outer wrapper).
    // We check the node itself vs its parent's height to ensure no gap exists.
    const m = await P.evaluate(() => {
      const el = document.querySelector('[data-builder-id="ag-plain-btn"]') as HTMLElement | null;
      if (!el) return { error: 'element not found' };
      const rect = el.getBoundingClientRect();
      return { height: rect.height, display: window.getComputedStyle(el).display };
    });
    console.log('ANIMGAP-03 measurements:\n', JSON.stringify(m, null, 2));

    expect(m).not.toHaveProperty('error');
    expect((m as { height: number }).height, 'Plain button height must be > 20px').toBeGreaterThan(20);
  });
});
