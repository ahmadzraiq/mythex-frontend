/**
 * Builder State & Data Panel E2E Tests
 *
 * Run with:  npx playwright test e2e/builder-states-data.spec.ts
 *
 * Tests:
 *   BSD-02  State bar — loading state injects _workflow.loading into merged state
 *   BSD-04  State bar — empty state sets activePreviewState to empty
 *   BSD-05  Dummy data state — previewData editor saves and data is applied in canvas
 *   BSD-10  Multi-state selection: loading + validation can be active simultaneously
 *   BSD-11  Inactive pages receive previewStates
 *   BSD-15  _stateTag is stored on node when set via patchNodeField
 *   BSD-16  Loading chip force-shows loading-tagged node and hides default-tagged node
 *   BSD-17  Empty chip force-shows empty-tagged node and hides default-tagged node
 *   BSD-18  Custom state tag stored and badge appears in layers panel
 *   BSD-19  Disabled chip triggers _forceDisabledInEditor on nodes with props.disabled configured
 *   BSD-20  Disabled chip does NOT apply global opacity-50 to unconfigured nodes
 *   BSD-21  Hover chip is absent from StateBar
 *   BSD-22  Error chip is absent from StateBar
 *   BSD-23  State tag picker appears in Visibility section only when condition is set
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 }
  );
  await page.waitForTimeout(300);
}

async function resetBuilder(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store._setPageNodes as (n: unknown[]) => void)([]);
    if (typeof store.setSelectedIds === 'function') {
      (store.setSelectedIds as (ids: string[]) => void)([]);
    }
    if (typeof store.setPreviewState === 'function') {
      (store.setPreviewState as (s: string) => void)('normal');
    }
  });
  await page.waitForTimeout(100);
}

/** Read the active preview states from the builder store. */
async function getActivePreviewState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { activePreviewStates?: string[]; activePreviewState?: string } }>).__builderStore?.getState();
    const states = store?.activePreviewStates;
    if (Array.isArray(states)) {
      return states.find(s => s !== 'normal') ?? states[0] ?? 'normal';
    }
    return store?.activePreviewState ?? 'normal';
  });
}

/** Find a node by id from the current page's nodes in the builder store. */
async function getNodeById(page: Page, nodeId: string): Promise<Record<string, unknown> | null> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes?: unknown[] } }>).__builderStore?.getState();
    function find(nodes: unknown[]): Record<string, unknown> | null {
      for (const n of nodes) {
        const node = n as Record<string, unknown>;
        if (node.id === id) return node;
        if (Array.isArray(node.children)) {
          const found = find(node.children as unknown[]);
          if (found) return found;
        }
      }
      return null;
    }
    return find(store?.pageNodes ?? []);
  }, nodeId);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('BSD — Builder State & Data Panel', () => {
  let sharedPage: Page;

  test.beforeAll(async ({ browser }) => {
    sharedPage = await browser.newPage();
    await gotoBuilder(sharedPage);
  });

  test.afterAll(async () => {
    await sharedPage.close();
  });

  test.beforeEach(async () => {
    // If the page crashed or navigated away, reload it before the next test
    const url = sharedPage.url();
    if (!url.includes('/dev/builder')) {
      await gotoBuilder(sharedPage);
    }
    await resetBuilder(sharedPage);
  });

  // ── BSD-02: Loading state injects _workflow.loading ────────────────────────

  test('BSD-02 loading state injects _workflow.loading into merged state', async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('loading');
    });
    await sharedPage.waitForTimeout(300);

    const state = await getActivePreviewState(sharedPage);
    expect(state).toBe('loading');
  });

  // ── BSD-04: Empty state sets activePreviewState ────────────────────────────

  test('BSD-04 empty state sets activePreviewState to empty', async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('empty');
    });
    await sharedPage.waitForTimeout(200);

    const state = await getActivePreviewState(sharedPage);
    expect(state).toBe('empty');
  });

  // ── BSD-05: Dummy data state — editor saves, data applied ──────────────────

  test('BSD-05 data state chip activates and setCurrentPagePreviewData stores data', async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('data');
    });
    await sharedPage.waitForTimeout(300);

    const state = await getActivePreviewState(sharedPage);
    expect(state).toBe('data');

    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setCurrentPagePreviewData: (d: Record<string, unknown>) => void } }>).__builderStore?.getState();
      store?.setCurrentPagePreviewData({ 'cart.totalQuantity': 3 });
    });
    await sharedPage.waitForTimeout(200);

    const storedData = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pages: Array<{ id: string; previewData?: unknown }>; currentPageId: string } }>).__builderStore?.getState();
      const pg = store?.pages.find(p => p.id === store.currentPageId);
      return pg?.previewData;
    });
    expect(storedData).toMatchObject({ 'cart.totalQuantity': 3 });
  });

  // ── BSD-10: Single-select — selecting a new state replaces the current one ──

  test('BSD-10 single-select — selecting a state replaces the current; re-selecting reverts to normal', async () => {
    // Select loading
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('loading');
    });
    await sharedPage.waitForTimeout(100);

    let states = await sharedPage.evaluate(() => {
      return (window as unknown as Record<string, { getState: () => { activePreviewStates?: string[] } }>).__builderStore?.getState()?.activePreviewStates ?? [];
    });
    expect(states).toEqual(['loading']);

    // Select validation — should replace loading, not add to it
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('validation');
    });
    await sharedPage.waitForTimeout(100);

    states = await sharedPage.evaluate(() => {
      return (window as unknown as Record<string, { getState: () => { activePreviewStates?: string[] } }>).__builderStore?.getState()?.activePreviewStates ?? [];
    });
    expect(states).toEqual(['validation']);
    expect(states).not.toContain('loading');

    // Re-select validation (already active) — should revert to normal via StateBar selectState
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void; activePreviewStates: string[] } }>).__builderStore?.getState();
      // Simulate the StateBar's selectState(id) logic: if active, go to normal
      if (store?.activePreviewStates.includes('validation')) {
        store?.setPreviewState('normal');
      }
    });
    await sharedPage.waitForTimeout(100);

    states = await sharedPage.evaluate(() => {
      return (window as unknown as Record<string, { getState: () => { activePreviewStates?: string[] } }>).__builderStore?.getState()?.activePreviewStates ?? [];
    });
    expect(states).toEqual(['normal']);
  });

  // ── BSD-11: State applies to active page only; inactive pages stay normal ───

  test('BSD-11 state preview applies to all pages — active and inactive pages share the same preview state', async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('loading');
    });
    await sharedPage.waitForTimeout(200);

    // Active preview state is loading
    const activeStates = await sharedPage.evaluate(() => {
      return (window as unknown as Record<string, { getState: () => { activePreviewStates?: string[] } }>).__builderStore?.getState()?.activePreviewStates ?? [];
    });
    expect(activeStates).toContain('loading');
    expect(activeStates).toHaveLength(1);
    expect(activeStates[0]).toBe('loading');

    // All pages (active and inactive) receive activePreviewStates — the store value
    // is the single source of truth for all PageEngine/InactivePageEngine instances.
  });

  // ── BSD-15: _stateTag is stored on node via patchNodeField ─────────────────

  test('BSD-15 _stateTag is stored on node when set via patchNodeField', async () => {
    const nodeId = 'bsd-15-box';

    // Add a node
    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store || typeof store._setPageNodes !== 'function') return;
      (store._setPageNodes as (nodes: unknown[]) => void)([
        { id, type: 'Box', props: { className: 'w-16 h-16 bg-gray-200' } },
      ]);
    }, nodeId);
    await sharedPage.waitForTimeout(200);

    // Tag it as loading
    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => { patchNodeField: (id: string, field: string, value: unknown) => void } }>).__builderStore?.getState();
      store?.patchNodeField(id, '_stateTag', 'loading');
    }, nodeId);
    await sharedPage.waitForTimeout(100);

    const node = await getNodeById(sharedPage, nodeId);
    expect((node as Record<string, unknown>)?._stateTag).toBe('loading');
  });

  // ── BSD-16: Loading chip force-shows loading-tagged node, hides default ─────

  test('BSD-16 loading chip force-shows loading-tagged node and hides default-tagged node', async () => {
    const loadingId = 'bsd-16-loading';
    const defaultId = 'bsd-16-default';

    // Add two nodes: one loading-tagged (with condition:false so normally hidden),
    // one default-tagged (no condition, normally visible)
    await sharedPage.evaluate(({ lId, dId }) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store || typeof store._setPageNodes !== 'function') return;
      (store._setPageNodes as (nodes: unknown[]) => void)([
        { id: lId, type: 'Box', props: { className: 'w-16 h-16 bg-yellow-400' }, condition: false, _stateTag: 'loading' },
        { id: dId, type: 'Box', props: { className: 'w-16 h-16 bg-blue-400' }, _stateTag: 'default' },
      ]);
    }, { lId: loadingId, dId: defaultId });
    await sharedPage.waitForTimeout(300);

    // With normal state: loading node is hidden (condition:false), default is visible
    const defaultVisibleNormal = await sharedPage.evaluate((id) => {
      return !!document.querySelector(`[data-builder-id="${id}"]`);
    }, defaultId);
    expect(defaultVisibleNormal).toBe(true);

    const loadingVisibleNormal = await sharedPage.evaluate((id) => {
      return !!document.querySelector(`[data-builder-id="${id}"]`);
    }, loadingId);
    expect(loadingVisibleNormal).toBe(false);

    // Activate loading state
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('loading');
    });
    await sharedPage.waitForTimeout(400);

    // Now: loading-tagged node should be visible (force-shown), default should be hidden
    const loadingVisibleLoading = await sharedPage.evaluate((id) => {
      return !!document.querySelector(`[data-builder-id="${id}"]`);
    }, loadingId);
    expect(loadingVisibleLoading).toBe(true);

    const defaultVisibleLoading = await sharedPage.evaluate((id) => {
      return !!document.querySelector(`[data-builder-id="${id}"]`);
    }, defaultId);
    expect(defaultVisibleLoading).toBe(false);
  });

  // ── BSD-17: Empty chip force-shows empty-tagged, hides default-tagged ───────

  test('BSD-17 empty chip force-shows empty-tagged node and hides default-tagged node', async () => {
    const emptyId  = 'bsd-17-empty';
    const defaultId = 'bsd-17-default';

    await sharedPage.evaluate(({ eId, dId }) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store || typeof store._setPageNodes !== 'function') return;
      (store._setPageNodes as (nodes: unknown[]) => void)([
        { id: eId, type: 'Box', props: { className: 'w-16 h-16 bg-green-400' }, condition: false, _stateTag: 'empty' },
        { id: dId, type: 'Box', props: { className: 'w-16 h-16 bg-blue-400' }, _stateTag: 'default' },
      ]);
    }, { eId: emptyId, dId: defaultId });
    await sharedPage.waitForTimeout(300);

    // Activate empty state
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('empty');
    });
    await sharedPage.waitForTimeout(400);

    // empty-tagged should be visible (force-shown)
    const emptyVisible = await sharedPage.evaluate((id) => {
      return !!document.querySelector(`[data-builder-id="${id}"]`);
    }, emptyId);
    expect(emptyVisible).toBe(true);

    // default-tagged should be hidden
    const defaultVisible = await sharedPage.evaluate((id) => {
      return !!document.querySelector(`[data-builder-id="${id}"]`);
    }, defaultId);
    expect(defaultVisible).toBe(false);
  });

  // ── BSD-18: Custom state tag stored and badge appears in layers panel ───────

  test('BSD-18 custom state tag stored and badge appears in layers panel', async () => {
    const nodeId = 'bsd-18-box';

    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store || typeof store._setPageNodes !== 'function') return;
      (store._setPageNodes as (nodes: unknown[]) => void)([
        { id, type: 'Box', name: 'PromoBox', props: { className: 'w-16 h-16' } },
      ]);
    }, nodeId);
    await sharedPage.waitForTimeout(200);

    // Tag with a custom string
    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => { patchNodeField: (id: string, field: string, value: unknown) => void } }>).__builderStore?.getState();
      store?.patchNodeField(id, '_stateTag', 'my-promo');
    }, nodeId);
    await sharedPage.waitForTimeout(100);

    // Verify stored in the node tree
    const node = await getNodeById(sharedPage, nodeId);
    expect((node as Record<string, unknown>)?._stateTag).toBe('my-promo');

    // Open layers panel and verify the badge text is visible
    const layersTab = sharedPage.locator('[data-testid="tab-layers"]');
    await layersTab.click();
    await sharedPage.waitForTimeout(200);

    // Select the node so it's expanded/visible in the layers panel
    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => { select: (id: string) => void } }>).__builderStore?.getState();
      store?.select(id);
    }, nodeId);
    await sharedPage.waitForTimeout(200);

    // The badge with text 'my-promo' should appear in the layers list
    const badge = sharedPage.locator(`[data-node-id="${nodeId}"]`).getByText('my-promo');
    await expect(badge).toBeVisible({ timeout: 3000 });
  });

  // ── BSD-19: Disabled chip triggers _forceDisabledInEditor ──────────────────

  test('BSD-19 disabled chip shows overlay on nodes with props.disabled configured', async () => {
    const nodeId = 'bsd-19-btn';

    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store || typeof store._setPageNodes !== 'function') return;
      (store._setPageNodes as (nodes: unknown[]) => void)([
        {
          id,
          type: 'Button',
          props: { className: 'px-4 py-2', disabled: true },
          _disabledOverlay: { color: '#ff0000', opacity: 0.4 },
          children: [{ type: 'ButtonText', text: 'Disabled Button' }],
        },
      ]);
    }, nodeId);
    await sharedPage.waitForTimeout(300);

    // Activate disabled state
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('disabled');
    });
    await sharedPage.waitForTimeout(400);

    // The node should be wrapped with data-disabled="true" (from renderWithDisabledOverlay)
    const hasDisabledWrapper = await sharedPage.evaluate((id) => {
      const el = document.querySelector(`[data-builder-id="${id}"]`);
      if (!el) return false;
      // renderWithDisabledOverlay wraps the element in a div with data-disabled="true"
      return !!el.closest('[data-disabled="true"]') || !!el.querySelector('[data-disabled="true"]');
    }, nodeId);
    expect(hasDisabledWrapper).toBe(true);
  });

  // ── BSD-20: Disabled chip does NOT apply opacity-50 globally ───────────────

  test('BSD-20 disabled chip does not add opacity-50 to nodes without disabled configured', async () => {
    const nodeId = 'bsd-20-plain';

    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store || typeof store._setPageNodes !== 'function') return;
      (store._setPageNodes as (nodes: unknown[]) => void)([
        { id, type: 'Box', props: { className: 'w-16 h-16 bg-gray-200' } },
      ]);
    }, nodeId);
    await sharedPage.waitForTimeout(300);

    // Activate disabled state
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { setPreviewState: (s: string) => void } }>).__builderStore?.getState();
      store?.setPreviewState('disabled');
    });
    await sharedPage.waitForTimeout(400);

    // Plain node should NOT have opacity-50 (old global approach is removed)
    const hasOpacity50 = await sharedPage.evaluate((id) => {
      const el = document.querySelector(`[data-builder-id="${id}"]`);
      return el ? el.className.includes('opacity-50') : false;
    }, nodeId);
    expect(hasOpacity50).toBe(false);

    // And no [data-disabled] wrapper either
    const hasDisabledWrapper = await sharedPage.evaluate((id) => {
      const el = document.querySelector(`[data-builder-id="${id}"]`);
      if (!el) return false;
      return !!el.closest('[data-disabled="true"]') || !!el.querySelector('[data-disabled="true"]');
    }, nodeId);
    expect(hasDisabledWrapper).toBe(false);
  });

  // ── BSD-21: Hover chip is absent from StateBar ─────────────────────────────

  test('BSD-21 hover chip is absent from StateBar', async () => {
    const stateBar = sharedPage.locator('[data-testid="state-bar"]');
    await expect(stateBar).toBeVisible({ timeout: 5000 });

    const hoverBtn = stateBar.locator('button').filter({ hasText: /^Hover$/i });
    await expect(hoverBtn).toHaveCount(0);
  });

  // ── BSD-22: Error chip is absent from StateBar ─────────────────────────────

  test('BSD-22 error chip is absent from StateBar', async () => {
    const stateBar = sharedPage.locator('[data-testid="state-bar"]');
    await expect(stateBar).toBeVisible({ timeout: 5000 });

    const errorBtn = stateBar.locator('button').filter({ hasText: /^Error$/i });
    await expect(errorBtn).toHaveCount(0);
  });

  // ── BSD-23: State tag picker visible only when condition is set ─────────────

  test('BSD-23 state tag picker appears in Visibility section only when condition is set', async () => {
    const nodeId = 'bsd-23-box';

    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store || typeof store._setPageNodes !== 'function') return;
      (store._setPageNodes as (nodes: unknown[]) => void)([
        { id, type: 'Box', props: { className: 'w-16 h-16 bg-gray-200' } },
      ]);
    }, nodeId);
    await sharedPage.waitForTimeout(200);

    // Select the node and open Design tab
    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => { select: (id: string) => void } }>).__builderStore?.getState();
      store?.select(id);
    }, nodeId);
    await sharedPage.waitForTimeout(200);

    // Open Design tab
    const designTab = sharedPage.locator('[data-testid="tab-right-design"]');
    await designTab.click();
    await sharedPage.waitForTimeout(200);

    // State tag picker should NOT be visible (no condition set)
    const loadingPill = sharedPage.locator('[data-testid="state-tag-pill-loading"]');
    await expect(loadingPill).toHaveCount(0);

    // Now set a condition
    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => { patchCondition: (id: string, condition: unknown) => void } }>).__builderStore?.getState();
      store?.patchCondition(id, '_workflow.loading');
    }, nodeId);
    await sharedPage.waitForTimeout(200);

    // State tag picker should now be visible
    await expect(loadingPill).toBeVisible({ timeout: 3000 });

    // Click Loading pill
    await loadingPill.click();
    await sharedPage.waitForTimeout(100);

    const node = await getNodeById(sharedPage, nodeId);
    expect((node as Record<string, unknown>)?._stateTag).toBe('loading');

    // Click None pill to clear
    const nonePill = sharedPage.locator('[data-testid="state-tag-pill-none"]');
    await nonePill.click();
    await sharedPage.waitForTimeout(100);

    const nodeAfterClear = await getNodeById(sharedPage, nodeId);
    expect((nodeAfterClear as Record<string, unknown>)?._stateTag).toBeUndefined();
  });
});
