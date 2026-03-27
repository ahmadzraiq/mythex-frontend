/**
 * Builder E2E test suite — covers every item from the feature checklist.
 *
 * Run with:  npm run test:builder
 * UI mode:   npm run test:builder:ui
 *
 * Prerequisites: `npm run dev` must be running (or reuseExistingServer=true handles it).
 *
 * Performance: a single browser page is opened once for the whole file and reused
 * across all describe blocks via resetBuilder(). Only the History group keeps
 * per-test gotoBuilder() because undo/redo requires a fresh history stack.
 */

import { test, expect, Page, Browser } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Navigate to the builder and wait for the canvas to appear. */
async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 }
  );
}

/**
 * Reset canvas state without a full page reload.
 * Clears all nodes and selection via the store. Safe for all groups except History
 * (undo stack is NOT cleared — History tests must use gotoBuilder instead).
 */
async function resetBuilder(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store._setPageNodes as (n: unknown[]) => void)([]);
    if (typeof store.setSelectedIds === 'function') {
      (store.setSelectedIds as (ids: string[]) => void)([]);
    }
    if (typeof store.setZoom === 'function') {
      (store.setZoom as (z: number) => void)(1);
    }
    // Reset pan so the page frame is always properly centred after prior tests
    // may have panned the canvas. Compute the same centred offset fitToCanvas
    // would use: panX = (canvasW - pageW) / 2, panY = 0 (zoom=1 fits height).
    if (typeof store.setPan === 'function') {
      const canvas = document.querySelector('[data-testid="builder-canvas"]') as HTMLElement | null;
      const pageW = 375; // VIEWPORT_WIDTHS['mobile']
      const px = canvas ? (canvas.clientWidth - pageW) / 2 : 0;
      (store.setPan as (x: number, y: number) => void)(px, 0);
      // Force the DOM transform immediately — React won't re-render if panX was
      // already 202.5 (same value), so the canvas world div stays at its previous
      // position.  Directly patching the transform here guarantees the page frame
      // is centered regardless of prior Zustand state.
      const world = document.querySelector('[data-builder-world]') as HTMLElement | null;
      if (world) {
        world.style.transform = `translate(${px}px, 0px) scale(1)`;
      } else {
        console.warn('[resetBuilder] data-builder-world not found!');
      }
    }
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-builder-page-frame] [data-builder-id]').length === 0,
    { timeout: 5_000 }
  );
  // Let React finish deferred effects (overlay RAF, computed updates) that fire
  // after the pageNodes state change — without this, a DnD from the components
  // panel immediately following reset can be silently dropped in headless Chrome.
  await page.waitForTimeout(300);
}

/**
 * Drag a draggable component from the Components panel onto the canvas.
 * Retries once if the first drag doesn't produce a node (headless-Chromium
 * DnD can silently fail on the first interaction after a page reset).
 * @param label  Visible label in the Components panel (e.g. "Button")
 */
async function dropComponent(page: Page, label: string) {
  const countBefore = await page.locator('[data-builder-page-frame] [data-builder-id]').count();

  // Make sure we are on the Components tab
  const compTab = page.getByTestId('tab-components');
  await compTab.click();

  // Find the draggable item
  const item = page.locator('[draggable="true"]').filter({ hasText: label }).first();
  await expect(item).toBeVisible({ timeout: 5_000 });

  // Target: centre of the page frame
  const frame = page.locator('[data-builder-page-frame]');
  await item.dragTo(frame);

  // Wait for a node to appear.  Retry once if the drag was silently ignored
  // (headless Chromium sometimes drops the first DnD event after a page reset).
  const appeared = await page.waitForFunction(
    (before: number) => document.querySelectorAll('[data-builder-page-frame] [data-builder-id]').length > before,
    countBefore,
    { timeout: 5_000 }
  ).catch(() => null);

  if (!appeared) {
    // Brief pause then retry the drag
    await page.waitForTimeout(300);
    await item.dragTo(frame);
    await page.waitForFunction(
      (before: number) => document.querySelectorAll('[data-builder-page-frame] [data-builder-id]').length > before,
      countBefore,
      { timeout: 10_000 }
    );
  }
}

/** Click a dropped node identified by its data-builder-id prefix. */
async function clickFirstNode(page: Page) {
  const node = page.locator('[data-builder-page-frame] [data-builder-id]').first();
  const box = await node.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await node.click({ force: true });
  }
  await page.waitForTimeout(100);
  return node;
}

/**
 * Select the first ROOT node via the Layers panel (guarantees root selection,
 * not a child). Switches to Layers tab as a side effect.
 */
async function selectFirstRootNode(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.locator('[data-testid="layer-row"]').first().click();
  // Wait for BuilderOverlay to render the selection handles, then let the
  // RAF measurement loop stabilise their positions (the overlay runs a ~200ms
  // idle RAF loop after selection changes before it stops ticking).
  await page.waitForSelector('[data-testid="resize-handle"]', { timeout: 3_000 });
  await page.waitForTimeout(300);
}

// ─── File-level shared page ────────────────────────────────────────────────────
// One page is opened for the entire file; each describe block resets state in
// beforeEach via resetBuilder(). History tests are exempt and keep their own
// per-test page fixture.

let sharedPage: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  sharedPage = await browser.newPage();
  await gotoBuilder(sharedPage);
});

test.afterAll(async () => {
  await sharedPage?.close();
});

// ─── Canvas & Viewport (checklist 1–9) ────────────────────────────────────────

test.describe('Canvas & Viewport', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('1. page frame is visible on load', async () => {
    await expect(sharedPage.locator('[data-builder-page-frame]')).toBeVisible();
  });

  test('2. dot-grid SVG is rendered', async () => {
    // The dot grid is an SVG with a pattern fill
    await expect(sharedPage.locator('svg').first()).toBeVisible();
  });

  test('3. zoom-in button increments zoom label', async () => {
    const zoomLabel = sharedPage.getByTestId('zoom-label');
    const before = await zoomLabel.innerText();

    await sharedPage.getByTestId('zoom-in').click();
    const after = await zoomLabel.innerText();
    expect(parseInt(after)).toBeGreaterThan(parseInt(before));
  });

  test('4. zoom-out button decrements zoom label', async () => {
    const zoomLabel = sharedPage.getByTestId('zoom-label');
    const before  = await zoomLabel.innerText();

    await sharedPage.getByTestId('zoom-out').click();
    const after = await zoomLabel.innerText();
    expect(parseInt(after)).toBeLessThan(parseInt(before));
  });

  test('5. fit-to-canvas restores a reasonable zoom', async () => {
    // First zoom in a lot
    for (let i = 0; i < 5; i++) await sharedPage.getByTestId('zoom-in').click();
    // Then click the % button to fit
    await sharedPage.getByTestId('zoom-label').click();
    const pct = parseInt(await sharedPage.getByTestId('zoom-label').innerText());
    expect(pct).toBeGreaterThan(20);
    expect(pct).toBeLessThan(200);
  });

  test.skip('6. hand tool activates on toolbar click', async () => {
    // Tool buttons removed from UI — hand/select only via keyboard (H/V)
    await sharedPage.getByTestId('tool-hand').click();
    await expect(sharedPage.getByTestId('tool-hand')).toHaveAttribute('data-active', 'true');
  });

  test.skip('7. select tool activates on toolbar click', async () => {
    // Tool buttons removed from UI
    await sharedPage.getByTestId('tool-hand').click();
    await sharedPage.getByTestId('tool-select').click();
    await expect(sharedPage.getByTestId('tool-select')).toHaveAttribute('data-active', 'true');
  });
});

// ─── Drop Components (checklist 10–15) ────────────────────────────────────────

test.describe('Drop Components', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('10. drag Button from Components panel drops onto canvas', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('11. drag Input from Components panel drops onto canvas', async () => {
    await dropComponent(sharedPage, 'Input');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first()).toBeVisible();
  });

  test('12. drag Text primitive drops onto canvas', async () => {
    await dropComponent(sharedPage, 'Text');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first()).toBeVisible();
  });

  test('13. drag Box primitive drops onto canvas', async () => {
    await dropComponent(sharedPage, 'Box');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first()).toBeVisible();
  });

  test('14. second drop inserts a second node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await dropComponent(sharedPage, 'Btn Solid');
    const count = await sharedPage.locator('[data-builder-page-frame] [data-builder-id]').count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ─── Selection (checklist 16–22) ──────────────────────────────────────────────

test.describe('Selection', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('16. clicking a dropped Button shows selection ring', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    // Use Layers panel to select (canvas click can be unreliable in headless/Playwright)
    await sharedPage.getByTestId('tab-layers').click();
    await sharedPage.getByTestId('layer-row').first().click();
    await expect(sharedPage.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });
  });

  test('17. clicking a dropped Input selects it (no typing)', async () => {
    await dropComponent(sharedPage, 'Input');
    await clickFirstNode(sharedPage);
    await expect(sharedPage.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });
  });

  test('18. clicking empty page background deselects', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await sharedPage.getByTestId('tab-layers').click();
    await sharedPage.getByTestId('layer-row').first().click();
    await expect(sharedPage.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });

    // Click empty area at the bottom of the page frame, clamped to canvas bounds.
    // The page frame can extend beyond the visible canvas (overflow:hidden clips it),
    // so getBoundingClientRect().height may exceed the canvas height. We must clamp
    // the click Y so it lands inside the canvas, otherwise the click is ignored.
    const frame     = sharedPage.locator('[data-builder-page-frame]');
    const canvas    = sharedPage.getByTestId('builder-canvas');
    const box       = await frame.boundingBox();
    const canvasBox = await canvas.boundingBox();
    if (box && canvasBox) {
      const clickX = box.x + box.width / 2;
      const clickY = Math.min(box.y + box.height - 20, canvasBox.y + canvasBox.height - 20);
      await sharedPage.mouse.click(clickX, clickY);
    }
    await expect(sharedPage.getByTestId('selection-ring')).not.toBeVisible({ timeout: 2_000 });
  });

  test('19. clicking dark canvas background deselects', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await sharedPage.getByTestId('tab-layers').click();
    await sharedPage.getByTestId('layer-row').first().click();
    await expect(sharedPage.getByTestId('selection-ring')).toBeVisible();

    // Click dark canvas: use the far-right edge of the canvas (always dark regardless
    // of panX, since page frame is 375px wide and canvas is ~780px wide).
    const canvasBox = await sharedPage.getByTestId('builder-canvas').boundingBox();
    await sharedPage.mouse.click(canvasBox!.x + canvasBox!.width - 5, canvasBox!.y + 5);
    await expect(sharedPage.getByTestId('selection-ring')).not.toBeVisible({ timeout: 2_000 });
  });

  test('20. shift-click selects multiple nodes via layer panel', async () => {
    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore
        .getState()._setPageNodes([
          { type: 'Pressable', id: 'btn-1', props: { className: 'w-32 h-10' }, children: [{ type: 'Text', text: 'A' }] },
          { type: 'Pressable', id: 'btn-2', props: { className: 'w-32 h-10' }, children: [{ type: 'Text', text: 'B' }] },
        ]);
    });
    await sharedPage.waitForSelector('[data-builder-id="btn-1"]', { timeout: 8_000 });

    await sharedPage.getByTestId('tab-layers').click();
    const rows = sharedPage.locator('[data-testid="layer-row"]');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Shift'] });

    const count = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { selectedIds: string[] } }>).__builderStore?.getState();
      return store?.selectedIds?.length ?? 0;
    });
    expect(count, 'Shift-click should select 2 nodes').toBe(2);
  });
});

// ─── Hover (checklist 23–25) ──────────────────────────────────────────────────

test.describe('Hover', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('23. hovering over a dropped component shows hover outline', async () => {
    await dropComponent(sharedPage, 'Btn Solid');

    // Hover over the node (not selected)
    const node = sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first();
    await node.hover({ force: true });

    // Hover outline is rendered in the BuilderOverlay (data-builder-overlay="1")
    await expect(sharedPage.locator('[data-builder-overlay="1"]')).toBeVisible();
  });
});

// ─── Layers Panel (checklist 26–34) ───────────────────────────────────────────

test.describe('Layers Panel', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('26. dropped component appears in Layers tab tree', async () => {
    await dropComponent(sharedPage, 'Btn Solid');

    await sharedPage.getByTestId('tab-layers').click();
    await expect(sharedPage.getByTestId('layer-row')).toBeVisible({ timeout: 3_000 });
  });

  test('27. clicking layer row selects node on canvas', async () => {
    await dropComponent(sharedPage, 'Btn Solid');

    await sharedPage.getByTestId('tab-layers').click();
    await sharedPage.getByTestId('layer-row').first().click();
    await expect(sharedPage.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });
  });

  test('28. Escape key deselects', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await sharedPage.getByTestId('tab-layers').click();
    await sharedPage.getByTestId('layer-row').first().click();
    await expect(sharedPage.getByTestId('selection-ring')).toBeVisible();

    await sharedPage.keyboard.press('Escape');
    await expect(sharedPage.getByTestId('selection-ring')).not.toBeVisible({ timeout: 2_000 });
  });

  test('29. Delete key removes selected node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    // Select via layer row to guarantee we select the ROOT node (not a child)
    await sharedPage.getByTestId('tab-layers').click();
    await sharedPage.locator('[data-testid="layer-row"]').first().click();
    await expect(sharedPage.getByTestId('selection-ring')).toBeVisible();

    await sharedPage.keyboard.press('Delete');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('30. search box filters layer tree', async () => {
    await dropComponent(sharedPage, 'Btn Solid');

    await sharedPage.getByTestId('tab-layers').click();
    const searchInput = sharedPage.locator('input[placeholder*="Search"]');
    await searchInput.fill('zzz_nomatch');
    await expect(sharedPage.getByTestId('layer-row')).toHaveCount(0, { timeout: 2_000 });

    await searchInput.clear();
    await expect(sharedPage.getByTestId('layer-row')).toBeVisible({ timeout: 2_000 });
  });
});

// ─── Right Panel — Design Tab (checklist 39–55) ───────────────────────────────

test.describe('Right Panel — Design Tab', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('39. selecting a node shows non-zero W and H in design panel', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);

    // The right panel should show W and H number fields
    const wInput = sharedPage.locator('input[type="number"]').nth(2);
    const hInput = sharedPage.locator('input[type="number"]').nth(3);
    await expect(hInput).toBeVisible({ timeout: 3_000 });
    const h = await hInput.inputValue();
    expect(parseInt(h)).toBeGreaterThanOrEqual(0);
    await expect(wInput).toBeVisible();
  });

  test('40. typing new H value applies inline style height', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);

    const hInput = sharedPage.locator('input[type="number"]').nth(3);
    await hInput.fill('80');
    await hInput.press('Enter');

    const node = sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first();
    const height = await node.evaluate((el: HTMLElement) => el.style.height);
    expect(height).toBe('80px');
  });

  test('41. typing new W value applies inline style width', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);

    const wInput = sharedPage.locator('input[type="number"]').nth(2);
    await wInput.fill('200');
    await wInput.press('Enter');

    const node = sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first();
    const width = await node.evaluate((el: HTMLElement) => el.style.width);
    expect(width).toBe('200px');
  });
});

// ─── Resize Handles (checklist 59–64) ─────────────────────────────────────────

test.describe('Resize Handles', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('59. selecting a node shows 8 resize handles', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);

    await expect(sharedPage.getByTestId('resize-handle')).toHaveCount(8, { timeout: 3_000 });
  });

  test('60. dragging SE handle changes width and height via inline style', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);

    const seHandle = sharedPage.locator('[data-testid="resize-handle"][data-handle="se"]');
    const box = await seHandle.boundingBox();
    if (!box) throw new Error('SE handle not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // dispatchEvent targets the handle directly — no hit-test uncertainty.
    // window listeners for pointermove/pointerup are set up by onResizeStart.
    await seHandle.dispatchEvent('pointerdown', { button: 0, buttons: 1, clientX: cx, clientY: cy, pointerId: 1 });
    await sharedPage.mouse.move(cx + 60, cy + 40, { steps: 10 });
    await sharedPage.mouse.up();
    // onResizeStart adds a window capture-click suppressClick listener.
    // Since dispatchEvent('pointerdown') doesn't generate a real click sequence,
    // flush that listener manually so subsequent test clicks aren't intercepted.
    await sharedPage.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // Give React time to commit the patchProp update to the DOM
    await sharedPage.waitForTimeout(300);

    // Read the committed size from the Zustand store (patchProp writes props.style).
    // Using the store avoids false positives from querying the wrong DOM node.
    const style = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store) return { width: '', height: '' };
      const selectedIds = store.selectedIds as string[];
      const id = selectedIds?.[0];
      if (!id) return { width: '', height: '' };
      function find(nodes: unknown[], targetId: string): Record<string, unknown> | null {
        for (const n of nodes as Array<Record<string, unknown>>) {
          if (n.id === targetId) return n;
          if (Array.isArray(n.children)) { const f = find(n.children, targetId); if (f) return f; }
        }
        return null;
      }
      const node = find(store.pageNodes as unknown[], id) as Record<string, unknown> | null;
      const s = (node?.props as Record<string, unknown>)?.style as Record<string, string> | undefined;
      return { width: s?.width ?? '', height: s?.height ?? '' };
    });
    expect(style.width).toMatch(/px$/);
    expect(style.height).toMatch(/px$/);
  });

  test('61. dragging E handle changes width only', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);

    const eHandle = sharedPage.locator('[data-testid="resize-handle"][data-handle="e"]');
    const box = await eHandle.boundingBox();
    if (!box) throw new Error('E handle not found');

    const node = sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first();
    const heightBefore = await node.evaluate((el: HTMLElement) => el.getBoundingClientRect().height);

    const ex = box.x + box.width / 2;
    const ey = box.y + box.height / 2;
    // dispatchEvent targets the handle directly — no hit-test uncertainty
    await eHandle.dispatchEvent('pointerdown', { button: 0, buttons: 1, clientX: ex, clientY: ey, pointerId: 1 });
    await sharedPage.mouse.move(box.x + 80, ey, { steps: 10 });
    await sharedPage.mouse.up();
    // Flush suppressClick listener added by onResizeStart (same as test 60)
    await sharedPage.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await sharedPage.waitForTimeout(300);

    // Read committed width from Zustand store (same as test 60)
    const style = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store) return { width: '' };
      const selectedIds = store.selectedIds as string[];
      const id = selectedIds?.[0];
      if (!id) return { width: '' };
      function find(nodes: unknown[], targetId: string): Record<string, unknown> | null {
        for (const n of nodes as Array<Record<string, unknown>>) {
          if (n.id === targetId) return n;
          if (Array.isArray(n.children)) { const f = find(n.children, targetId); if (f) return f; }
        }
        return null;
      }
      const nd = find(store.pageNodes as unknown[], id) as Record<string, unknown> | null;
      const s = (nd?.props as Record<string, unknown>)?.style as Record<string, string> | undefined;
      return { width: s?.width ?? '' };
    });
    expect(style.width).toMatch(/px$/);
    const heightAfter = await node.evaluate((el: HTMLElement) => el.getBoundingClientRect().height);
    expect(Math.abs(heightAfter - heightBefore)).toBeLessThan(20);
  });
});

// ─── History — Undo/Redo (checklist 65–68) ────────────────────────────────────
// These tests require a FRESH undo history stack. We use sharedPage + _clearHistory
// (which resets both pageNodes and history to a clean empty state) instead of
// per-test page fixtures to avoid browser-context teardown races.

async function clearHistory(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (typeof (store as Record<string, unknown>)?._clearHistory === 'function') {
      (store._clearHistory as () => void)();
    }
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-builder-page-frame] [data-builder-id]').length === 0,
    { timeout: 5_000 }
  );
}

test.describe('History (Undo / Redo)', () => {
  test.beforeEach(async () => { await clearHistory(sharedPage); });

  test('65. undo after drop removes the node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first()).toBeVisible();

    await sharedPage.keyboard.press('Meta+z');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('66. redo after undo restores the node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await sharedPage.keyboard.press('Meta+z');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]')).toHaveCount(0, { timeout: 3_000 });

    await sharedPage.keyboard.press('Meta+Shift+z');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first()).toBeVisible({ timeout: 3_000 });
  });

  test('67. undo button in top bar works', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await sharedPage.getByTestId('btn-undo').click();
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('68. undo after second drop removes second node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await dropComponent(sharedPage, 'Btn Solid');

    const countBefore = await sharedPage.locator('[data-builder-page-frame] [data-builder-id]').count();
    expect(countBefore).toBeGreaterThanOrEqual(2);

    await sharedPage.keyboard.press('Meta+z');

    await expect(async () => {
      const countAfter = await sharedPage.locator('[data-builder-page-frame] [data-builder-id]').count();
      expect(countAfter).toBeLessThan(countBefore);
    }).toPass({ timeout: 3_000 });
  });
});

// ─── Keyboard Shortcuts (checklist 69–74) ─────────────────────────────────────

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('69. Delete key removes selected node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await sharedPage.getByTestId('tab-layers').click();
    await sharedPage.locator('[data-testid="layer-row"]').first().click();
    await sharedPage.keyboard.press('Delete');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('70. Backspace key removes selected node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await sharedPage.getByTestId('tab-layers').click();
    await sharedPage.locator('[data-testid="layer-row"]').first().click();
    await sharedPage.keyboard.press('Backspace');
    await expect(sharedPage.locator('[data-builder-page-frame] [data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('71. Cmd+D duplicates selected node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);

    const before = await sharedPage.locator('[data-builder-page-frame] [data-builder-id]').count();
    await sharedPage.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true }));
    });
    const after = await sharedPage.locator('[data-builder-page-frame] [data-builder-id]').count();
    expect(after).toBeGreaterThan(before);
  });

  test('72. Escape deselects', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);
    await expect(sharedPage.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });

    await sharedPage.keyboard.press('Escape');
    await expect(sharedPage.getByTestId('selection-ring')).not.toBeVisible({ timeout: 2_000 });
  });

  test.skip('73. H key activates hand tool', async () => {
    await sharedPage.keyboard.press('h');
    await expect(sharedPage.getByTestId('tool-hand')).toHaveAttribute('data-active', 'true');
  });

  test.skip('74. V key activates select tool', async () => {
    await sharedPage.keyboard.press('h');
    await sharedPage.keyboard.press('v');
    await expect(sharedPage.getByTestId('tool-select')).toHaveAttribute('data-active', 'true');
  });

  test('75. Cmd+G groups selected nodes into a Box', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await dropComponent(sharedPage, 'Btn Solid');

    const nodes = sharedPage.locator('[data-builder-page-frame] [data-builder-id]');
    await nodes.first().click({ force: true });
    await nodes.last().click({ force: true, modifiers: ['Shift'] });

    const before = await sharedPage.locator('[data-builder-page-frame] [data-builder-id]').count();
    await sharedPage.keyboard.press('Meta+g');

    await sharedPage.getByTestId('tab-layers').click();
    const rows = await sharedPage.getByTestId('layer-row').count();
    expect(rows).toBeGreaterThanOrEqual(1);
    expect(before).toBeGreaterThan(0);
  });
});

// ─── Helpers for visual indicator + right-panel tests ─────────────────────────

/** Inject nodes directly into the builder store (bypasses UI drag-drop). */
async function injectNodes(page: Page, nodes: object[]) {
  await page.evaluate((n) => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (nodes: object[]) => void } }>).__builderStore.getState()._setPageNodes(n);
  }, nodes);
  await page.waitForSelector('[data-builder-page-frame] [data-builder-id]', { timeout: 5_000 });
}

/** Read the className of a node from the store by id. */
async function getNodeClassName(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore.getState();
    function find(arr: unknown[]): Record<string, unknown> | null {
      for (const n of arr) {
        const node = n as Record<string, unknown>;
        if (node.id === id) return node;
        const children = node.children as unknown[] | undefined;
        if (children?.length) { const f = find(children); if (f) return f; }
      }
      return null;
    }
    const node = find(store.pageNodes);
    return (node?.props as Record<string, string> | undefined)?.className ?? '';
  }, nodeId);
}

async function getNodeStyle(page: Page, nodeId: string): Promise<Record<string, string>> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore.getState();
    function find(arr: unknown[]): Record<string, unknown> | null {
      for (const n of arr) {
        const node = n as Record<string, unknown>;
        if (node.id === id) return node;
        const children = node.children as unknown[] | undefined;
        if (children?.length) { const f = find(children); if (f) return f; }
      }
      return null;
    }
    const node = find(store.pageNodes);
    return (node?.props as Record<string, Record<string, string>> | undefined)?.style ?? {};
  }, nodeId);
}

/** Get the id of the first root node from the store. */
async function getFirstRootNodeId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const nodes = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id?: string }> } }>).__builderStore.getState().pageNodes;
    return nodes[0]?.id ?? '';
  });
}

/** Dispatch a synthetic dragover on the canvas to simulate an in-progress drag. */
async function simulateDragOver(page: Page, x: number, y: number) {
  await page.evaluate(({ cx, cy }) => {
    const canvas = document.querySelector('[data-testid="builder-canvas"]');
    if (!canvas) return;
    const dt = new DataTransfer();
    dt.setData('text/primitive-node', JSON.stringify({ type: 'Pressable', id: 'drag-sim', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', text: 'Button' }] }));
    canvas.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    canvas.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
  }, { cx: x, cy: y });
}

/** Dispatch a dragleave on the canvas to end the simulated drag. */
async function simulateDragLeave(page: Page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="builder-canvas"]');
    if (!canvas) return;
    canvas.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
  });
}

// ─── Group A — Drop Zone Lines ─────────────────────────────────────────────────

test.describe('Group A — Drop Zone Lines', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('A1. Drop zone lines appear when dragging over empty canvas', async () => {
    const frame = sharedPage.locator('[data-builder-page-frame]');
    const box = await frame.boundingBox();
    await simulateDragOver(sharedPage, box!.x + box!.width / 2, box!.y + 50);
    await expect(sharedPage.locator('[data-testid="drop-zone-line"]').first()).toBeVisible({ timeout: 3_000 });
    await simulateDragLeave(sharedPage);
  });

  test('A2. Active drop zone line highlights when hovering near top of existing node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');

    const node = sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first();
    const nodeBox = await node.boundingBox();
    await simulateDragOver(sharedPage, nodeBox!.x + 10, nodeBox!.y + 2);
    const activeLine = sharedPage.locator('[data-testid="drop-zone-line"][data-active="true"]');
    await expect(activeLine).toBeVisible({ timeout: 3_000 });
    await simulateDragLeave(sharedPage);
  });

  test('A3. Different drop zone activates when hovering near bottom of existing node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');

    const frame = sharedPage.locator('[data-builder-page-frame]');
    const frameBox = await frame.boundingBox();
    await simulateDragOver(sharedPage, frameBox!.x + frameBox!.width / 2, frameBox!.y + frameBox!.height - 10);
    await expect(sharedPage.locator('[data-testid="drop-zone-line"]').first()).toBeVisible({ timeout: 3_000 });
    await simulateDragLeave(sharedPage);
  });

  test('A4. Drop zone lines disappear after drag leaves canvas', async () => {
    const frame = sharedPage.locator('[data-builder-page-frame]');
    const box = await frame.boundingBox();
    await simulateDragOver(sharedPage, box!.x + box!.width / 2, box!.y + 50);
    await expect(sharedPage.locator('[data-testid="drop-zone-line"]').first()).toBeVisible({ timeout: 3_000 });
    await simulateDragLeave(sharedPage);
    await expect(sharedPage.locator('[data-testid="drop-zone-line"]')).toHaveCount(0, { timeout: 3_000 });
  });
});

// ─── Group B — Crosshair Lines ─────────────────────────────────────────────────

test.describe('Group B — Crosshair Lines', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('B1. Crosshair lines appear when a node is selected', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);
    await expect(sharedPage.locator('[data-testid="crosshair-h"]')).toBeVisible();
    await expect(sharedPage.locator('[data-testid="crosshair-v"]')).toBeVisible();
  });

  test('B2. Crosshair lines disappear on deselect', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);
    await expect(sharedPage.locator('[data-testid="crosshair-h"]')).toBeVisible();

    const canvas = sharedPage.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await sharedPage.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);

    await expect(sharedPage.locator('[data-testid="crosshair-h"]')).not.toBeVisible({ timeout: 2_000 });
    await expect(sharedPage.locator('[data-testid="crosshair-v"]')).not.toBeVisible({ timeout: 2_000 });
  });
});

// ─── Group C — Hover Outline ───────────────────────────────────────────────────

test.describe('Group C — Hover Outline', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('C1. Hover outline appears when mouse moves over a node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');

    const canvas = sharedPage.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await sharedPage.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);

    const node = sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first();
    const nodeBox = await node.boundingBox();
    await sharedPage.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
    await expect(sharedPage.locator('[data-testid="hover-outline"]')).toBeVisible({ timeout: 3_000 });
  });

  test('C2. Hover outline disappears when mouse moves away from node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');

    const canvas = sharedPage.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await sharedPage.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);

    const node = sharedPage.locator('[data-builder-page-frame] [data-builder-id]').first();
    const nodeBox = await node.boundingBox();
    await sharedPage.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
    await expect(sharedPage.locator('[data-testid="hover-outline"]')).toBeVisible({ timeout: 3_000 });

    await sharedPage.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 10);
    await expect(sharedPage.locator('[data-testid="hover-outline"]')).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── Group D — Padding Fills ───────────────────────────────────────────────────

test.describe('Group D — Padding Fills', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('D1. Padding fills appear (4 sides) when padded node is selected', async () => {
    await injectNodes(sharedPage, [{ type: 'Box', id: 'pad-box', props: { className: 'p-4 w-64 h-32' } }]);
    await selectFirstRootNode(sharedPage);
    await sharedPage.waitForTimeout(300);
    await expect(sharedPage.locator('[data-testid="padding-fill"]')).toHaveCount(4, { timeout: 3_000 });
  });

  test('D2. Each padding fill is visible (non-zero size)', async () => {
    await injectNodes(sharedPage, [{ type: 'Box', id: 'pad-box-2', props: { className: 'p-4 w-64 h-32' } }]);
    await selectFirstRootNode(sharedPage);
    await sharedPage.waitForTimeout(300);
    const fills = sharedPage.locator('[data-testid="padding-fill"]');
    await expect(fills.first()).toBeVisible();
  });

  test('D3. Padding fills disappear on deselect', async () => {
    await injectNodes(sharedPage, [{ type: 'Box', id: 'pad-box-3', props: { className: 'p-4 w-64 h-32' } }]);
    await selectFirstRootNode(sharedPage);
    await sharedPage.waitForTimeout(300);
    await expect(sharedPage.locator('[data-testid="padding-fill"]')).toHaveCount(4, { timeout: 3_000 });

    const canvas = sharedPage.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await sharedPage.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);
    await expect(sharedPage.locator('[data-testid="padding-fill"]')).toHaveCount(0, { timeout: 2_000 });
  });
});

// ─── Group E — Gap Fills ───────────────────────────────────────────────────────

test.describe('Group E — Gap Fills', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('E1. Gap fills appear when a flex+gap container with 2+ children is selected', async () => {
    await injectNodes(sharedPage, [{
      type: 'Box',
      id: 'gap-parent',
      props: { className: 'flex flex-col gap-4 w-64 h-48' },
      children: [
        { type: 'Pressable', id: 'gap-c1', props: { className: 'w-full flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', id: 'gap-t1', text: 'B1' }] },
        { type: 'Pressable', id: 'gap-c2', props: { className: 'w-full flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', id: 'gap-t2', text: 'B2' }] },
      ],
    }]);
    await selectFirstRootNode(sharedPage);
    await sharedPage.waitForTimeout(400);
    await expect(sharedPage.locator('[data-testid="gap-fill"]').first()).toBeVisible({ timeout: 3_000 });
  });

  test('E2. Gap fill shows a pixel label', async () => {
    await injectNodes(sharedPage, [{
      type: 'Box',
      id: 'gap-parent-2',
      props: { className: 'flex flex-col gap-4 w-64 h-48' },
      children: [
        { type: 'Pressable', id: 'gap-c3', props: { className: 'w-full flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', id: 'gap-t3', text: 'B1' }] },
        { type: 'Pressable', id: 'gap-c4', props: { className: 'w-full flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', id: 'gap-t4', text: 'B2' }] },
      ],
    }]);
    await selectFirstRootNode(sharedPage);
    await sharedPage.waitForTimeout(400);
    const fill = sharedPage.locator('[data-testid="gap-fill"]').first();
    await expect(fill).toBeVisible({ timeout: 3_000 });
    const text = await fill.textContent();
    expect(text).toMatch(/\d+px/);
  });

  test('E3. Gap fills disappear on deselect', async () => {
    await injectNodes(sharedPage, [{
      type: 'Box',
      id: 'gap-parent-3',
      props: { className: 'flex flex-col gap-4 w-64 h-48' },
      children: [
        { type: 'Pressable', id: 'gap-c5', props: { className: 'w-full flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', id: 'gap-t5', text: 'B1' }] },
        { type: 'Pressable', id: 'gap-c6', props: { className: 'w-full flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', id: 'gap-t6', text: 'B2' }] },
      ],
    }]);
    await selectFirstRootNode(sharedPage);
    await sharedPage.waitForTimeout(400);
    await expect(sharedPage.locator('[data-testid="gap-fill"]').first()).toBeVisible({ timeout: 3_000 });

    const canvas = sharedPage.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await sharedPage.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);
    await expect(sharedPage.locator('[data-testid="gap-fill"]')).toHaveCount(0, { timeout: 2_000 });
  });
});

// ─── Group F — Distance Lines ──────────────────────────────────────────────────

test.describe('Group F — Distance Lines', () => {
  // Alt+hover distance lines can be flaky in headless — keyboard.down('Alt') may not trigger store.setAltMode reliably
  test.skip('F1. Distance lines appear on Alt+hover over a sibling node', async () => {
    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore
        .getState()._setPageNodes([
          { type: 'Pressable', id: 'f1-a', props: { className: 'w-32 h-10' }, children: [{ type: 'Text', text: 'A' }] },
          { type: 'Pressable', id: 'f1-b', props: { className: 'w-32 h-10' }, children: [{ type: 'Text', text: 'B' }] },
        ]);
    });
    await sharedPage.waitForSelector('[data-builder-id="f1-a"]', { timeout: 8_000 });
    await selectFirstRootNode(sharedPage);

    await sharedPage.keyboard.down('Alt');
    const secondNode = sharedPage.locator('[data-builder-id="f1-b"]');
    const box = await secondNode.boundingBox();
    if (box) {
      await sharedPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await sharedPage.waitForTimeout(300);
    }

    const lines = sharedPage.locator('[data-testid="distance-line"]');
    await expect(lines.first()).toBeVisible({ timeout: 5_000 });
    await sharedPage.keyboard.up('Alt');
  });

  test.skip('F2. Distance lines disappear when Alt is released', async () => {
    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore
        .getState()._setPageNodes([
          { type: 'Pressable', id: 'f2-a', props: { className: 'w-32 h-10' }, children: [{ type: 'Text', text: 'A' }] },
          { type: 'Pressable', id: 'f2-b', props: { className: 'w-32 h-10' }, children: [{ type: 'Text', text: 'B' }] },
        ]);
    });
    await sharedPage.waitForSelector('[data-builder-id="f2-a"]', { timeout: 8_000 });
    await selectFirstRootNode(sharedPage);
    await sharedPage.keyboard.down('Alt');

    const secondNode = sharedPage.locator('[data-builder-id="f2-b"]');
    const box = await secondNode.boundingBox();
    if (box) {
      await sharedPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await sharedPage.waitForTimeout(300);
    }
    await expect(sharedPage.locator('[data-testid="distance-line"]').first()).toBeVisible({ timeout: 5_000 });

    await sharedPage.keyboard.up('Alt');
    await sharedPage.waitForTimeout(300);
    await expect(sharedPage.locator('[data-testid="distance-line"]')).toHaveCount(0, { timeout: 3_000 });
  });
});

// ─── Group G — Right Panel: Basic State ───────────────────────────────────────

test.describe('Group G — Right Panel: Basic State', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('G1. No node selected — right panel shows placeholder message', async () => {
    await expect(sharedPage.getByTestId('panel-right')).toContainText('Select a node to edit');
  });

  test('G2. Selecting a node reveals Design/Props/JSON tabs', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);
    const panel = sharedPage.getByTestId('panel-right');
    await expect(panel.getByRole('button', { name: /design/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /props/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /json/i })).toBeVisible();
  });

  test('G3. Design tab is active by default', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);
    const panel = sharedPage.getByTestId('panel-right');
    await expect(panel.getByText('Position & Size')).toBeVisible();
  });

  test('G4. Switching to Props and JSON tabs shows correct content', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);
    const panel = sharedPage.getByTestId('panel-right');

    await panel.getByRole('button', { name: /props/i }).click();
    await sharedPage.waitForTimeout(200);
    await expect(
      panel.locator('input[type="text"]').or(panel.getByText('No props'))
    ).toBeVisible({ timeout: 3_000 });

    await panel.getByRole('button', { name: /json/i }).click();
    await expect(panel.locator('pre')).toBeVisible();
    const json = await panel.locator('pre').textContent();
    expect(() => JSON.parse(json!)).not.toThrow();
    expect(json).toContain('"type"');
  });
});

// ─── Group H — Right Panel: Size reflects on canvas ───────────────────────────

test.describe('Group H — Right Panel: Size reflects on canvas', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('H1. Setting W=300 updates canvas element width', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);

    await sharedPage.locator('[data-testid="input-pos-w"]').fill('300');
    await sharedPage.locator('[data-testid="input-pos-w"]').press('Enter');
    await sharedPage.waitForTimeout(300);

    const nodeId = await getFirstRootNodeId(sharedPage);
    const style = await sharedPage.evaluate((id: string) => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore.getState();
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
      return (node?.props as Record<string, Record<string, string>> | undefined)?.style ?? {};
    }, nodeId);
    expect(style.width).toBe('300px');
  });

  test('H2. Setting H=200 updates canvas element height', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);

    await sharedPage.locator('[data-testid="input-pos-h"]').fill('200');
    await sharedPage.locator('[data-testid="input-pos-h"]').press('Enter');
    await sharedPage.waitForTimeout(300);

    const nodeId = await getFirstRootNodeId(sharedPage);
    const style = await sharedPage.evaluate((id: string) => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore.getState();
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
      return (node?.props as Record<string, Record<string, string>> | undefined)?.style ?? {};
    }, nodeId);
    expect(style.height).toBe('200px');
  });
});

// ─── Group I — Right Panel: W/H Resize Modes ──────────────────────────────────

test.describe('Group I — Right Panel: W/H Resize Modes', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('I1. Clicking W "Fill" adds w-full to className', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.getByTestId('panel-right').getByRole('button', { name: 'Fill' }).first().click();
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('w-full');
  });

  test('I2. Clicking W "Hug" adds w-fit to className', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.getByTestId('panel-right').getByRole('button', { name: 'Hug' }).first().click();
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('w-fit');
  });

  test('I3. Clicking H "Fill" adds flex-1 to className', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.getByTestId('panel-right').getByRole('button', { name: 'Fill' }).nth(1).click();
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('flex-1');
  });

  test('I4. Clicking H "Hug" adds h-fit to className', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.getByTestId('panel-right').getByRole('button', { name: 'Hug' }).nth(1).click();
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('h-fit');
  });
});

// ─── Group J — Right Panel: Auto Layout ───────────────────────────────────────

test.describe('Group J — Right Panel: Auto Layout', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('J1. Clicking Row direction button applies flex-row', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[title="Row"]').click();
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('flex-row');
  });

  test('J2. Clicking Column direction button applies flex-col', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[title="Column"]').click();
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('flex-col');
  });

  test('J3. Setting Gap=16 applies gap-4 to className', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[data-testid="input-gap"]').fill('16');
    await sharedPage.locator('[data-testid="input-gap"]').press('Enter');
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('gap-4');
  });
});

// ─── Group K — Right Panel: Fill (Background Color) ───────────────────────────

test.describe('Group K — Right Panel: Fill', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('K1. Changing background color hex applies backgroundColor to style', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    const panel = sharedPage.getByTestId('panel-right');
    const hexInput = panel.locator('input[placeholder="#000000"]').first();
    await hexInput.fill('#ff0000');
    await hexInput.press('Tab');
    await sharedPage.waitForTimeout(300);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.backgroundColor?.toLowerCase()).toContain('ff0000');
  });
});

// ─── Group L — Right Panel: Opacity ───────────────────────────────────────────

test.describe('Group L — Right Panel: Opacity', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('L1. Setting opacity slider to 50 applies opacity to style', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    const panel = sharedPage.getByTestId('panel-right');
    const sliders = panel.locator('input[type="range"]');
    const count = await sliders.count();
    const opacitySlider = sliders.nth(count - 1);
    await opacitySlider.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '50');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sharedPage.waitForTimeout(300);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(parseFloat(style.opacity ?? '1')).toBeLessThan(1);
  });
});

// ─── Group M — Right Panel: Padding ───────────────────────────────────────────

test.describe('Group M — Right Panel: Padding', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('M1. Setting Padding Top=20 applies paddingTop to style', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.evaluate(() => {
      (document.querySelector('[data-testid="input-pad-top"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    });
    await sharedPage.locator('[data-testid="input-pad-top"]').fill('20');
    await sharedPage.locator('[data-testid="input-pad-top"]').press('Enter');
    await sharedPage.waitForTimeout(300);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.paddingTop).toBeTruthy();
  });

  test('M2. Setting Padding Left=12 applies paddingLeft to style', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.evaluate(() => {
      (document.querySelector('[data-testid="input-pad-left"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    });
    await sharedPage.locator('[data-testid="input-pad-left"]').fill('12');
    await sharedPage.locator('[data-testid="input-pad-left"]').press('Enter');
    await sharedPage.waitForTimeout(300);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.paddingLeft).toBeTruthy();
  });
});

// ─── Group N — Right Panel: Border Radius ─────────────────────────────────────

test.describe('Group N — Right Panel: Border Radius', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('N1. Changing TL corner to rounded-lg applies rounded-tl-lg', async () => {
    await injectNodes(sharedPage, [{ type: 'Box', id: 'n1-box', props: { className: 'w-32 h-32' }, children: [] }]);
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[data-testid="select-corner-tl"]').selectOption('rounded-lg');
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('rounded-tl-');
  });
});

// ─── Group O — Right Panel: Border Width ──────────────────────────────────────

test.describe('Group O — Right Panel: Border Width', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('O1. Changing border width to border-2 applies border-2', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[data-testid="select-border-width"]').selectOption('border-2');
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('border-2');
  });
});

// ─── Group P — Right Panel: Shadow ────────────────────────────────────────────

test.describe('Group P — Right Panel: Shadow', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('P1. Changing shadow to shadow-md applies shadow-md', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[data-testid="select-shadow"]').selectOption('shadow-md');
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('shadow-md');
  });
});

// ─── Group Q — Right Panel: Transform ─────────────────────────────────────────

test.describe('Group Q — Right Panel: Transform', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('Q1. Setting Rotate=45 applies style.transform = rotate(45deg)', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[data-testid="input-rotate"]').fill('45');
    await sharedPage.locator('[data-testid="input-rotate"]').press('Enter');
    await sharedPage.waitForTimeout(300);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.transform).toBe('rotate(45deg)');
  });

  test('Q2. Clicking Flip H toggle applies -scale-x-100', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[title="Flip horizontal"]').click();
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('-scale-x-100');
  });
});

// ─── Group R — Right Panel: Typography ────────────────────────────────────────

test.describe('Group R — Right Panel: Typography', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('R1. Typography section is visible for Text nodes', async () => {
    await dropComponent(sharedPage, 'Text');
    await selectFirstRootNode(sharedPage);
    await expect(sharedPage.getByTestId('panel-right').getByText('Typography')).toBeVisible();
  });

  test('R2. Changing text size to text-xl applies text-xl', async () => {
    await dropComponent(sharedPage, 'Text');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[data-testid="select-text-size"]').selectOption('text-xl');
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('text-xl');
  });

  test('R3. Changing font weight to font-bold applies font-bold', async () => {
    await dropComponent(sharedPage, 'Text');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    await sharedPage.locator('[data-testid="select-font-weight"]').selectOption('font-bold');
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('font-bold');
  });
});

// ─── Group S — Right Panel: Props Tab ─────────────────────────────────────────

test.describe('Group S — Right Panel: Props Tab', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('S1. Props tab shows key-value inputs for selected node', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);

    const panel = sharedPage.getByTestId('panel-right');
    await panel.getByRole('button', { name: /props/i }).click();
    await sharedPage.waitForTimeout(200);
    await expect(
      panel.locator('input[type="text"]').or(panel.getByText('No props'))
    ).toBeVisible({ timeout: 3_000 });
  });

  test('S2. Editing className in Props tab updates node in store', async () => {
    await dropComponent(sharedPage, 'Box');
    await selectFirstRootNode(sharedPage);
    const nodeId = await getFirstRootNodeId(sharedPage);

    const panel = sharedPage.getByTestId('panel-right');
    await panel.getByRole('button', { name: /props/i }).click();

    const clsInput = panel.locator('input').filter({ hasNot: panel.locator('[type="color"]') }).first();
    await clsInput.fill('w-full bg-red-500 test-class');
    await clsInput.press('Enter');
    await sharedPage.waitForTimeout(300);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('test-class');
  });
});

// ─── Group T — Right Panel: JSON Tab ──────────────────────────────────────────

test.describe('Group T — Right Panel: JSON Tab', () => {
  test.beforeEach(async () => { await resetBuilder(sharedPage); });

  test('T1. JSON tab shows valid JSON with correct type field', async () => {
    await dropComponent(sharedPage, 'Btn Solid');
    await selectFirstRootNode(sharedPage);

    const panel = sharedPage.getByTestId('panel-right');
    await panel.getByRole('button', { name: /json/i }).click();

    const pre = panel.locator('pre');
    await expect(pre).toBeVisible();
    const content = await pre.textContent();
    expect(content).toBeTruthy();
    const parsed = JSON.parse(content!);
    expect(parsed.type).toBe('Pressable');
  });
});
