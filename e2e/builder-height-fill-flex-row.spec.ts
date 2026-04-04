/**
 * Builder Height Fill — Flex-Row Parent (HF series)
 *
 * Loads /height-fill-test in the visual builder, selects the "ButtonChild"
 * node (which lives inside a flex-row parent), and verifies that clicking
 * "Fill" for height writes `self-stretch` instead of `flex-1`.
 *
 *   HF-01  Fill height in flex-row parent → self-stretch, NOT flex-1
 *   HF-02  Pixel width (w-[254px]) is preserved after Fill height
 *   HF-03  Fill height in flex-col parent → flex-1 (existing behaviour)
 *   HF-04  Switching to Fixed mode removes self-stretch
 *   HF-05  Fill button shows as active when className already has self-stretch
 *
 * Run: npx playwright test e2e/builder-height-fill-flex-row.spec.ts
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

const BUILDER_BASE = 'http://builder-dev.localhost:3001';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page, screenPath = '/height-fill-test') {
  await page.goto(`${BUILDER_BASE}?page=${screenPath}`);
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 200 }
  );
  // Wait for the page nodes to load from the screen config
  await page.waitForFunction(
    () => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      return (store?.pageNodes?.length ?? 0) > 0;
    },
    { timeout: 15_000, polling: 300 }
  );
}

/** Inject an arbitrary node tree, replacing whatever is on canvas. */
async function injectNodes(page: Page, nodes: unknown[]) {
  await page.evaluate((ns) => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>)
      .__builderStore.getState()._setPageNodes(ns);
  }, nodes);
  const firstId = (nodes[0] as { id?: string })?.id;
  if (firstId) {
    await page.waitForSelector(`[data-builder-id="${firstId}"]`, { timeout: 10_000 });
  }
}

/** Select a node by ID using the store directly, then switch to Design tab. */
async function selectNode(page: Page, nodeId: string) {
  await page.evaluate((id: string) => {
    (window as unknown as Record<string, { getState: () => { setSelectedIds: (ids: string[]) => void } }>)
      .__builderStore.getState().setSelectedIds([id]);
  }, nodeId);
  await page.waitForTimeout(150);
  // Make sure the Design tab is active
  const designTab = page.getByTestId('tab-right-design');
  if (await designTab.count() > 0) {
    await designTab.click();
    await page.waitForTimeout(200);
  }
}

/** Read a node's className from the store. */
async function getNodeClassName(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id: string) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>)
      .__builderStore.getState();
    function find(arr: unknown[]): Record<string, unknown> | null {
      for (const n of arr) {
        const node = n as Record<string, unknown>;
        if (node.id === id) return node;
        const ch = node.children as unknown[] | undefined;
        if (ch?.length) { const f = find(ch); if (f) return f; }
      }
      return null;
    }
    const node = find(store.pageNodes);
    return (node?.props as Record<string, string> | undefined)?.className ?? '';
  }, nodeId);
}

/** Scroll a testid element into view. */
async function scrollTo(page: Page, testId: string) {
  await page.evaluate((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, testId);
  await page.waitForTimeout(60);
}

// ─── Node fixtures for inject-only tests ─────────────────────────────────────

const FLEX_ROW_TREE = {
  id: 'hf-parent',
  type: 'Box',
  props: { style: {}, className: 'min-w-0 w-[817px] h-[529px] flex flex-row' },
  children: [
    {
      id: 'hf-child',
      type: 'Box',
      props: {
        style: {},
        className:
          'flex flex-row items-center justify-center px-[20px] py-[10px] rounded-[6px] bg-[var(--theme-primary)] w-[254px]',
      },
      children: [
        {
          id: 'hf-child-text',
          type: 'Text',
          props: { className: 'text-[14px] font-medium' },
          text: 'Button',
        },
      ],
    },
  ],
};

const FLEX_COL_TREE = {
  id: 'hf-col-parent',
  type: 'Box',
  props: { style: {}, className: 'w-[400px] h-[400px] flex flex-col' },
  children: [
    {
      id: 'hf-col-child',
      type: 'Box',
      props: { style: {}, className: 'w-[200px] h-[80px] bg-[var(--theme-primary)]' },
      children: [],
    },
  ],
};

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('HF — Height Fill in Flex-Row Parent', () => {
  test.setTimeout(90_000);

  let P: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    P = await ctx.newPage();
    await gotoBuilder(P);
  });
  test.afterAll(async () => { await P.context().close(); });

  // Reset canvas to a known state before each test
  test.beforeEach(async () => {
    await injectNodes(P, [FLEX_ROW_TREE]);
  });

  // ── HF-01: Fill height in flex-row parent writes self-stretch ─────────────

  test('HF-01: Fill height in flex-row parent → self-stretch (NOT flex-1)', async () => {
    await selectNode(P, 'hf-child');

    await scrollTo(P, 'dim-h-fill');
    await P.getByTestId('dim-h-fill').click();
    await P.waitForTimeout(250);

    const cls = await getNodeClassName(P, 'hf-child');

    expect(cls, `Expected self-stretch, got: "${cls}"`).toContain('self-stretch');
    expect(cls, `flex-1 must NOT be present in flex-row parent, got: "${cls}"`).not.toContain('flex-1');
  });

  // ── HF-02: Pixel width is preserved after Fill height ────────────────────

  test('HF-02: w-[254px] is preserved after Fill height in flex-row parent', async () => {
    await selectNode(P, 'hf-child');

    await scrollTo(P, 'dim-h-fill');
    await P.getByTestId('dim-h-fill').click();
    await P.waitForTimeout(250);

    const cls = await getNodeClassName(P, 'hf-child');

    expect(cls, `w-[254px] should be preserved, got: "${cls}"`).toContain('w-[254px]');
    expect(cls, `Expected self-stretch, got: "${cls}"`).toContain('self-stretch');
    expect(cls, `flex-1 must NOT be present, got: "${cls}"`).not.toContain('flex-1');
  });

  // ── HF-03: Fill height in flex-col parent still writes flex-1 ────────────

  test('HF-03: Fill height in flex-col parent still writes flex-1 (regression guard)', async () => {
    await injectNodes(P, [FLEX_COL_TREE]);
    await selectNode(P, 'hf-col-child');

    await scrollTo(P, 'dim-h-fill');
    await P.getByTestId('dim-h-fill').click();
    await P.waitForTimeout(250);

    const cls = await getNodeClassName(P, 'hf-col-child');

    expect(cls, `Expected flex-1 in flex-col parent, got: "${cls}"`).toContain('flex-1');
    expect(cls, `self-stretch should NOT appear in flex-col parent, got: "${cls}"`).not.toContain('self-stretch');
  });

  // ── HF-04: Fixed mode removes self-stretch ────────────────────────────────

  test('HF-04: switching to Fixed mode removes self-stretch', async () => {
    // Start with self-stretch already in className
    await injectNodes(P, [{
      ...FLEX_ROW_TREE,
      children: [{
        ...FLEX_ROW_TREE.children[0],
        props: {
          ...FLEX_ROW_TREE.children[0].props,
          className: FLEX_ROW_TREE.children[0].props.className + ' self-stretch',
        },
      }],
    }]);
    await selectNode(P, 'hf-child');

    await scrollTo(P, 'dim-h-fixed');
    await P.getByTestId('dim-h-fixed').click();
    await P.waitForTimeout(250);

    const cls = await getNodeClassName(P, 'hf-child');
    expect(cls, `self-stretch should be removed after Fixed, got: "${cls}"`).not.toContain('self-stretch');
    expect(cls, `flex-1 should not appear, got: "${cls}"`).not.toContain('flex-1');
  });

  // ── HF-05: Fill is active when self-stretch is already set ────────────────

  test('HF-05: Fill button active, click again is idempotent (self-stretch stays)', async () => {
    await injectNodes(P, [{
      ...FLEX_ROW_TREE,
      children: [{
        ...FLEX_ROW_TREE.children[0],
        props: {
          ...FLEX_ROW_TREE.children[0].props,
          className: FLEX_ROW_TREE.children[0].props.className + ' self-stretch',
        },
      }],
    }]);
    await selectNode(P, 'hf-child');

    await scrollTo(P, 'dim-h-fill');

    // Clicking Fill again when self-stretch is already set should be idempotent
    await P.getByTestId('dim-h-fill').click();
    await P.waitForTimeout(250);

    const cls = await getNodeClassName(P, 'hf-child');
    expect(cls, `self-stretch should remain after re-clicking Fill, got: "${cls}"`).toContain('self-stretch');
    expect(cls, `flex-1 must NOT appear, got: "${cls}"`).not.toContain('flex-1');
  });
});
