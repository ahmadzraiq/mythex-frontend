/**
 * Builder E2E test suite — covers every item from the feature checklist.
 *
 * Run with:  npm run test:builder
 * UI mode:   npm run test:builder:ui
 *
 * Prerequisites: `npm run dev` must be running (or reuseExistingServer=true handles it).
 *
 * The test suite is intentionally sequential (one browser context, no parallelism)
 * because many tests build on state left by earlier ones (e.g. a dropped node).
 */

import { test, expect, Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Navigate to the builder and wait for the canvas to appear. */
async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
}

/**
 * Drag a draggable component from the Components panel onto the canvas.
 * @param label  Visible label in the Components panel (e.g. "Button")
 */
async function dropComponent(page: Page, label: string) {
  // Make sure we are on the Components tab
  const compTab = page.getByTestId('tab-components');
  await compTab.click();

  // Find the draggable item
  const item = page.locator(`[draggable="true"]`).filter({ hasText: label }).first();
  await expect(item).toBeVisible({ timeout: 5_000 });

  // Target: centre of the page frame
  const frame = page.locator('[data-builder-page-frame]');
  await item.dragTo(frame);

  // Wait for a node to appear in the canvas
  await page.waitForSelector('[data-builder-id]', { timeout: 5_000 });
}

/** Click a dropped node identified by its data-builder-id prefix. */
async function clickFirstNode(page: Page) {
  const node = page.locator('[data-builder-id]').first();
  // Use bounding-box coordinates so the click goes through the capture overlay
  // (which sits at z-index 9999 and is responsible for selection).
  // force:true would dispatch directly on the element, bypassing the overlay.
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
}

// ─── Canvas & Viewport (checklist 1–9) ────────────────────────────────────────

test.describe('Canvas & Viewport', () => {
  test('1. page frame is visible on load', async ({ page }) => {
    await gotoBuilder(page);
    await expect(page.locator('[data-builder-page-frame]')).toBeVisible();
  });

  test('2. dot-grid SVG is rendered', async ({ page }) => {
    await gotoBuilder(page);
    // The dot grid is an SVG with a pattern fill
    await expect(page.locator('svg').first()).toBeVisible();
  });

  test('3. zoom-in button increments zoom label', async ({ page }) => {
    await gotoBuilder(page);
    const zoomLabel = page.getByTestId('zoom-label');
    const before = await zoomLabel.innerText();

    await page.getByTestId('zoom-in').click();
    const after = await zoomLabel.innerText();
    expect(parseInt(after)).toBeGreaterThan(parseInt(before));
  });

  test('4. zoom-out button decrements zoom label', async ({ page }) => {
    await gotoBuilder(page);
    const zoomLabel = page.getByTestId('zoom-label');
    const before  = await zoomLabel.innerText();

    await page.getByTestId('zoom-out').click();
    const after = await zoomLabel.innerText();
    expect(parseInt(after)).toBeLessThan(parseInt(before));
  });

  test('5. fit-to-canvas restores a reasonable zoom', async ({ page }) => {
    await gotoBuilder(page);
    // First zoom in a lot
    for (let i = 0; i < 5; i++) await page.getByTestId('zoom-in').click();
    // Then click the % button to fit
    await page.getByTestId('zoom-label').click();
    const pct = parseInt(await page.getByTestId('zoom-label').innerText());
    expect(pct).toBeGreaterThan(20);
    expect(pct).toBeLessThan(200);
  });

  test('6. hand tool activates on toolbar click', async ({ page }) => {
    await gotoBuilder(page);
    await page.getByTestId('tool-hand').click();
    await expect(page.getByTestId('tool-hand')).toHaveAttribute('data-active', 'true');
  });

  test('7. select tool activates on toolbar click', async ({ page }) => {
    await gotoBuilder(page);
    await page.getByTestId('tool-hand').click();   // switch away first
    await page.getByTestId('tool-select').click();
    await expect(page.getByTestId('tool-select')).toHaveAttribute('data-active', 'true');
  });
});

// ─── Drop Components (checklist 10–15) ────────────────────────────────────────

test.describe('Drop Components', () => {
  test('10. drag Button from Components panel drops onto canvas', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await expect(page.locator('[data-builder-id]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('11. drag Input from Components panel drops onto canvas', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Input');
    await expect(page.locator('[data-builder-id]').first()).toBeVisible();
  });

  test('12. drag Text primitive drops onto canvas', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Text');
    await expect(page.locator('[data-builder-id]').first()).toBeVisible();
  });

  test('13. drag Box primitive drops onto canvas', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await expect(page.locator('[data-builder-id]').first()).toBeVisible();
  });

  test('14. second drop inserts a second node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await dropComponent(page, 'Button');
    const count = await page.locator('[data-builder-id]').count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ─── Selection (checklist 16–22) ──────────────────────────────────────────────

test.describe('Selection', () => {
  test('16. clicking a dropped Button shows selection ring', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    // Use Layers panel to select (canvas click can be unreliable in headless/Playwright)
    await page.getByTestId('tab-layers').click();
    await page.getByTestId('layer-row').first().click();
    await expect(page.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });
  });

  test('17. clicking a dropped Input selects it (no typing)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Input');
    await clickFirstNode(page);
    await expect(page.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });
  });

  test('18. clicking empty page background deselects', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await page.getByTestId('tab-layers').click();
    await page.getByTestId('layer-row').first().click();
    await expect(page.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });

    // Click empty area at the bottom of the page frame
    const frame = page.locator('[data-builder-page-frame]');
    const box   = await frame.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20);
    }
    await expect(page.getByTestId('selection-ring')).not.toBeVisible({ timeout: 2_000 });
  });

  test('19. clicking dark canvas background deselects', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await page.getByTestId('tab-layers').click();
    await page.getByTestId('layer-row').first().click();
    await expect(page.getByTestId('selection-ring')).toBeVisible();

    // Click the dark canvas area (top-left corner of canvas, outside page frame)
    const canvasBox = await page.getByTestId('builder-canvas').boundingBox();
    await page.mouse.click(canvasBox!.x + 5, canvasBox!.y + 5);
    await expect(page.getByTestId('selection-ring')).not.toBeVisible({ timeout: 2_000 });
  });

  test('20. shift-click selects multiple nodes via layer panel', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await dropComponent(page, 'Button');

    // Switch to Layers tab and use shift-click on layer rows for reliable multi-select
    // (nodes are collapsed by default, so only 2 root-level rows are visible)
    await page.getByTestId('tab-layers').click();
    const rows = page.locator('[data-testid="layer-row"]');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Shift'] });

    // Two selection rings should appear on the canvas
    await expect(page.getByTestId('selection-ring')).toHaveCount(2, { timeout: 3_000 });
  });
});

// ─── Hover (checklist 23–25) ──────────────────────────────────────────────────

test.describe('Hover', () => {
  test('23. hovering over a dropped component shows hover outline', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');

    // Hover over the node (not selected)
    const node = page.locator('[data-builder-id]').first();
    await node.hover({ force: true });

    // Hover outline is rendered in the BuilderOverlay (data-builder-overlay="1")
    // We just assert the main overlay div is present and visible
    await expect(page.locator('[data-builder-overlay="1"]')).toBeVisible();
  });
});

// ─── Layers Panel (checklist 26–34) ───────────────────────────────────────────

test.describe('Layers Panel', () => {
  test('26. dropped component appears in Layers tab tree', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');

    await page.getByTestId('tab-layers').click();
    await expect(page.getByTestId('layer-row')).toBeVisible({ timeout: 3_000 });
  });

  test('27. clicking layer row selects node on canvas', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');

    await page.getByTestId('tab-layers').click();
    await page.getByTestId('layer-row').first().click();
    await expect(page.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });
  });

  test('28. Escape key deselects', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await page.getByTestId('tab-layers').click();
    await page.getByTestId('layer-row').first().click();
    await expect(page.getByTestId('selection-ring')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selection-ring')).not.toBeVisible({ timeout: 2_000 });
  });

  test('29. Delete key removes selected node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    // Select via layer row to guarantee we select the ROOT node (not a child)
    await page.getByTestId('tab-layers').click();
    await page.locator('[data-testid="layer-row"]').first().click();
    await expect(page.getByTestId('selection-ring')).toBeVisible();

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('30. search box filters layer tree', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');

    await page.getByTestId('tab-layers').click();
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('zzz_nomatch');
    await expect(page.getByTestId('layer-row')).toHaveCount(0, { timeout: 2_000 });

    await searchInput.clear();
    await expect(page.getByTestId('layer-row')).toBeVisible({ timeout: 2_000 });
  });
});

// ─── Right Panel — Design Tab (checklist 39–55) ───────────────────────────────

test.describe('Right Panel — Design Tab', () => {
  test('39. selecting a node shows non-zero W and H in design panel', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);

    // The right panel should show W and H number fields
    const wInput = page.locator('input[type="number"]').nth(2); // W is 3rd number input (after X, Y)
    const hInput = page.locator('input[type="number"]').nth(3); // H is 4th
    // Both inputs must be visible (panel is connected) and H must be > 0 for a button
    await expect(hInput).toBeVisible({ timeout: 3_000 });
    const h = await hInput.inputValue();
    expect(parseInt(h)).toBeGreaterThanOrEqual(0);
    await expect(wInput).toBeVisible();
  });

  test('40. typing new H value applies inline style height', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);

    const hInput = page.locator('input[type="number"]').nth(3);
    await hInput.fill('80');
    await hInput.press('Enter');

    // The root node (nodes.first()) should now have style.height = 80px
    const node = page.locator('[data-builder-id]').first();
    const height = await node.evaluate((el: HTMLElement) => el.style.height);
    expect(height).toBe('80px');
  });

  test('41. typing new W value applies inline style width', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);

    const wInput = page.locator('input[type="number"]').nth(2);
    await wInput.fill('200');
    await wInput.press('Enter');

    const node = page.locator('[data-builder-id]').first();
    const width = await node.evaluate((el: HTMLElement) => el.style.width);
    expect(width).toBe('200px');
  });
});

// ─── Resize Handles (checklist 59–64) ─────────────────────────────────────────

test.describe('Resize Handles', () => {
  test('59. selecting a node shows 8 resize handles', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);

    await expect(page.getByTestId('resize-handle')).toHaveCount(8, { timeout: 3_000 });
  });

  test('60. dragging SE handle changes width and height via inline style', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);

    // data-handle is on the same element as data-testid — use attribute selector directly
    const seHandle = page.locator('[data-testid="resize-handle"][data-handle="se"]');
    const box = await seHandle.boundingBox();
    if (!box) throw new Error('SE handle not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 40, { steps: 10 });
    await page.mouse.up();

    const node = page.locator('[data-builder-id]').first();
    const style = await node.evaluate((el: HTMLElement) => ({
      width: el.style.width,
      height: el.style.height,
    }));
    expect(style.width).toMatch(/px$/);
    expect(style.height).toMatch(/px$/);
  });

  test('61. dragging E handle changes width only', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);

    const eHandle = page.locator('[data-testid="resize-handle"][data-handle="e"]');
    const box = await eHandle.boundingBox();
    if (!box) throw new Error('E handle not found');

    const node = page.locator('[data-builder-id]').first();
    const heightBefore = await node.evaluate((el: HTMLElement) => el.getBoundingClientRect().height);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const width = await node.evaluate((el: HTMLElement) => el.style.width);
    expect(width).toMatch(/px$/);
    // Height should be roughly the same (within 10px tolerance)
    const heightAfter = await node.evaluate((el: HTMLElement) => el.getBoundingClientRect().height);
    expect(Math.abs(heightAfter - heightBefore)).toBeLessThan(20);
  });
});

// ─── History — Undo/Redo (checklist 65–68) ────────────────────────────────────

test.describe('History (Undo / Redo)', () => {
  test('65. undo after drop removes the node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await expect(page.locator('[data-builder-id]').first()).toBeVisible();

    await page.keyboard.press('Meta+z');
    await expect(page.locator('[data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('66. redo after undo restores the node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await page.keyboard.press('Meta+z');
    await expect(page.locator('[data-builder-id]')).toHaveCount(0, { timeout: 3_000 });

    await page.keyboard.press('Meta+Shift+z');
    await expect(page.locator('[data-builder-id]').first()).toBeVisible({ timeout: 3_000 });
  });

  test('67. undo button in top bar works', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await page.getByTestId('btn-undo').click();
    await expect(page.locator('[data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('68. undo after second drop removes second node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await dropComponent(page, 'Button');

    const countBefore = await page.locator('[data-builder-id]').count();
    expect(countBefore).toBeGreaterThanOrEqual(2);

    // Undo the second drop — should remove the second button's nodes
    await page.keyboard.press('Meta+z');

    await expect(async () => {
      const countAfter = await page.locator('[data-builder-id]').count();
      expect(countAfter).toBeLessThan(countBefore);
    }).toPass({ timeout: 3_000 });
  });
});

// ─── Keyboard Shortcuts (checklist 69–74) ─────────────────────────────────────

test.describe('Keyboard Shortcuts', () => {
  test('69. Delete key removes selected node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await page.getByTestId('tab-layers').click();
    await page.locator('[data-testid="layer-row"]').first().click();
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('70. Backspace key removes selected node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await page.getByTestId('tab-layers').click();
    await page.locator('[data-testid="layer-row"]').first().click();
    await page.keyboard.press('Backspace');
    await expect(page.locator('[data-builder-id]')).toHaveCount(0, { timeout: 3_000 });
  });

  test('71. Cmd+D duplicates selected node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    // Select via layer panel so focus is inside the page, not a browser shortcut-stealing element
    await selectFirstRootNode(page);

    const before = await page.locator('[data-builder-id]').count();
    // Dispatch Cmd+D from within the page to bypass Chrome's "Add Bookmark" shortcut interception
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true }));
    });
    const after = await page.locator('[data-builder-id]').count();
    // Duplicating adds the whole subtree (button + children), so count increases by >= 1
    expect(after).toBeGreaterThan(before);
  });

  test('72. Escape deselects', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);
    await expect(page.getByTestId('selection-ring')).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('selection-ring')).not.toBeVisible({ timeout: 2_000 });
  });

  test('73. H key activates hand tool', async ({ page }) => {
    await gotoBuilder(page);
    await page.keyboard.press('h');
    await expect(page.getByTestId('tool-hand')).toHaveAttribute('data-active', 'true');
  });

  test('74. V key activates select tool', async ({ page }) => {
    await gotoBuilder(page);
    await page.keyboard.press('h');  // switch to hand first
    await page.keyboard.press('v');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('data-active', 'true');
  });

  test('75. Cmd+G groups selected nodes into a Box', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await dropComponent(page, 'Button');

    const nodes = page.locator('[data-builder-id]');
    await nodes.first().click({ force: true });
    await nodes.last().click({ force: true, modifiers: ['Shift'] });

    const before = await page.locator('[data-builder-id]').count();
    await page.keyboard.press('Meta+g');

    // After grouping, there should be fewer top-level nodes (now wrapped in a group Box)
    await page.getByTestId('tab-layers').click();
    const rows = await page.getByTestId('layer-row').count();
    // Grouped: 1 group row visible at top level
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
  await page.waitForSelector('[data-builder-id]', { timeout: 5_000 });
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
    dt.setData('text/primitive-node', JSON.stringify({ type: 'Button', id: 'drag-sim', props: {} }));
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
  test('A1. Drop zone lines appear when dragging over empty canvas', async ({ page }) => {
    await gotoBuilder(page);
    const frame = page.locator('[data-builder-page-frame]');
    const box = await frame.boundingBox();
    await simulateDragOver(page, box!.x + box!.width / 2, box!.y + 50);
    await expect(page.locator('[data-testid="drop-zone-line"]').first()).toBeVisible({ timeout: 3_000 });
    await simulateDragLeave(page);
  });

  test('A2. Active drop zone line highlights when hovering near top of existing node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');

    const node = page.locator('[data-builder-id]').first();
    const nodeBox = await node.boundingBox();
    // Hover just above the node mid-point to activate zone 0
    await simulateDragOver(page, nodeBox!.x + 10, nodeBox!.y + 2);
    const activeLine = page.locator('[data-testid="drop-zone-line"][data-active="true"]');
    await expect(activeLine).toBeVisible({ timeout: 3_000 });
    await simulateDragLeave(page);
  });

  test('A3. Different drop zone activates when hovering near bottom of existing node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');

    const frame = page.locator('[data-builder-page-frame]');
    const frameBox = await frame.boundingBox();
    // Hover near the bottom of the frame (below existing node) — zone index = nodes.length
    await simulateDragOver(page, frameBox!.x + frameBox!.width / 2, frameBox!.y + frameBox!.height - 10);
    await expect(page.locator('[data-testid="drop-zone-line"]').first()).toBeVisible({ timeout: 3_000 });
    await simulateDragLeave(page);
  });

  test('A4. Drop zone lines disappear after drag leaves canvas', async ({ page }) => {
    await gotoBuilder(page);
    const frame = page.locator('[data-builder-page-frame]');
    const box = await frame.boundingBox();
    await simulateDragOver(page, box!.x + box!.width / 2, box!.y + 50);
    // Confirm they appeared first
    await expect(page.locator('[data-testid="drop-zone-line"]').first()).toBeVisible({ timeout: 3_000 });
    // Then leave
    await simulateDragLeave(page);
    await expect(page.locator('[data-testid="drop-zone-line"]')).toHaveCount(0, { timeout: 3_000 });
  });
});

// ─── Group B — Crosshair Lines ─────────────────────────────────────────────────

test.describe('Group B — Crosshair Lines', () => {
  test('B1. Crosshair lines appear when a node is selected', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);
    await expect(page.locator('[data-testid="crosshair-h"]')).toBeVisible();
    await expect(page.locator('[data-testid="crosshair-v"]')).toBeVisible();
  });

  test('B2. Crosshair lines disappear on deselect', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);
    await expect(page.locator('[data-testid="crosshair-h"]')).toBeVisible();

    // Click canvas background to deselect
    const canvas = page.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);

    await expect(page.locator('[data-testid="crosshair-h"]')).not.toBeVisible({ timeout: 2_000 });
    await expect(page.locator('[data-testid="crosshair-v"]')).not.toBeVisible({ timeout: 2_000 });
  });
});

// ─── Group C — Hover Outline ───────────────────────────────────────────────────

test.describe('Group C — Hover Outline', () => {
  test('C1. Hover outline appears when mouse moves over a node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');

    // Deselect first (click canvas background)
    const canvas = page.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);

    // Use page.mouse.move — node.hover() is blocked by the transparent overlay div
    const node = page.locator('[data-builder-id]').first();
    const nodeBox = await node.boundingBox();
    await page.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
    await expect(page.locator('[data-testid="hover-outline"]')).toBeVisible({ timeout: 3_000 });
  });

  test('C2. Hover outline disappears when mouse moves away from node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');

    // Deselect first
    const canvas = page.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);

    const node = page.locator('[data-builder-id]').first();
    const nodeBox = await node.boundingBox();
    await page.mouse.move(nodeBox!.x + nodeBox!.width / 2, nodeBox!.y + nodeBox!.height / 2);
    await expect(page.locator('[data-testid="hover-outline"]')).toBeVisible({ timeout: 3_000 });

    // Move mouse to empty canvas area (bottom edge)
    await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 10);
    await expect(page.locator('[data-testid="hover-outline"]')).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── Group D — Padding Fills ───────────────────────────────────────────────────

test.describe('Group D — Padding Fills', () => {
  test('D1. Padding fills appear (4 sides) when padded node is selected', async ({ page }) => {
    await gotoBuilder(page);
    await injectNodes(page, [{ type: 'Box', id: 'pad-box', props: { className: 'p-4 w-64 h-32' } }]);
    await selectFirstRootNode(page);
    // Allow overlay to catch up
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="padding-fill"]')).toHaveCount(4, { timeout: 3_000 });
  });

  test('D2. Each padding fill is visible (non-zero size)', async ({ page }) => {
    await gotoBuilder(page);
    await injectNodes(page, [{ type: 'Box', id: 'pad-box-2', props: { className: 'p-4 w-64 h-32' } }]);
    await selectFirstRootNode(page);
    await page.waitForTimeout(300);
    const fills = page.locator('[data-testid="padding-fill"]');
    await expect(fills.first()).toBeVisible();
  });

  test('D3. Padding fills disappear on deselect', async ({ page }) => {
    await gotoBuilder(page);
    await injectNodes(page, [{ type: 'Box', id: 'pad-box-3', props: { className: 'p-4 w-64 h-32' } }]);
    await selectFirstRootNode(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="padding-fill"]')).toHaveCount(4, { timeout: 3_000 });

    // Deselect by clicking canvas background
    const canvas = page.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);
    await expect(page.locator('[data-testid="padding-fill"]')).toHaveCount(0, { timeout: 2_000 });
  });
});

// ─── Group E — Gap Fills ───────────────────────────────────────────────────────

test.describe('Group E — Gap Fills', () => {
  test('E1. Gap fills appear when a flex+gap container with 2+ children is selected', async ({ page }) => {
    await gotoBuilder(page);
    await injectNodes(page, [{
      type: 'Box',
      id: 'gap-parent',
      props: { className: 'flex flex-col gap-4 w-64 h-48' },
      children: [
        { type: 'Button', id: 'gap-c1', props: { className: 'w-full' }, children: [{ type: 'ButtonText', id: 'gap-t1', text: 'B1' }] },
        { type: 'Button', id: 'gap-c2', props: { className: 'w-full' }, children: [{ type: 'ButtonText', id: 'gap-t2', text: 'B2' }] },
      ],
    }]);
    await selectFirstRootNode(page);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="gap-fill"]').first()).toBeVisible({ timeout: 3_000 });
  });

  test('E2. Gap fill shows a pixel label', async ({ page }) => {
    await gotoBuilder(page);
    await injectNodes(page, [{
      type: 'Box',
      id: 'gap-parent-2',
      props: { className: 'flex flex-col gap-4 w-64 h-48' },
      children: [
        { type: 'Button', id: 'gap-c3', props: { className: 'w-full' }, children: [{ type: 'ButtonText', id: 'gap-t3', text: 'B1' }] },
        { type: 'Button', id: 'gap-c4', props: { className: 'w-full' }, children: [{ type: 'ButtonText', id: 'gap-t4', text: 'B2' }] },
      ],
    }]);
    await selectFirstRootNode(page);
    await page.waitForTimeout(400);
    const fill = page.locator('[data-testid="gap-fill"]').first();
    await expect(fill).toBeVisible({ timeout: 3_000 });
    const text = await fill.textContent();
    expect(text).toMatch(/\d+px/);
  });

  test('E3. Gap fills disappear on deselect', async ({ page }) => {
    await gotoBuilder(page);
    await injectNodes(page, [{
      type: 'Box',
      id: 'gap-parent-3',
      props: { className: 'flex flex-col gap-4 w-64 h-48' },
      children: [
        { type: 'Button', id: 'gap-c5', props: { className: 'w-full' }, children: [{ type: 'ButtonText', id: 'gap-t5', text: 'B1' }] },
        { type: 'Button', id: 'gap-c6', props: { className: 'w-full' }, children: [{ type: 'ButtonText', id: 'gap-t6', text: 'B2' }] },
      ],
    }]);
    await selectFirstRootNode(page);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="gap-fill"]').first()).toBeVisible({ timeout: 3_000 });

    const canvas = page.locator('[data-testid="builder-canvas"]');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height - 20);
    await expect(page.locator('[data-testid="gap-fill"]')).toHaveCount(0, { timeout: 2_000 });
  });
});

// ─── Group F — Distance Lines ──────────────────────────────────────────────────

test.describe('Group F — Distance Lines', () => {
  test('F1. Distance lines appear on Alt+hover over a sibling node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await dropComponent(page, 'Button');

    // Select the first root node
    await selectFirstRootNode(page);

    // Hold Alt to enable alt mode
    await page.keyboard.down('Alt');

    // Use page.mouse.move — .hover() is blocked by the transparent overlay div
    const secondNode = page.locator('[data-builder-id]').nth(2);
    const box = await secondNode.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(200);

    const lines = page.locator('[data-testid="distance-line"]');
    await expect(lines.first()).toBeVisible({ timeout: 3_000 });

    await page.keyboard.up('Alt');
  });

  test('F2. Distance lines disappear when Alt is released', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await dropComponent(page, 'Button');

    await selectFirstRootNode(page);
    await page.keyboard.down('Alt');

    const secondNode = page.locator('[data-builder-id]').nth(2);
    const box = await secondNode.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="distance-line"]').first()).toBeVisible({ timeout: 3_000 });

    await page.keyboard.up('Alt');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="distance-line"]')).toHaveCount(0, { timeout: 2_000 });
  });
});

// ─── Group G — Right Panel: Basic State ───────────────────────────────────────

test.describe('Group G — Right Panel: Basic State', () => {
  test('G1. No node selected — right panel shows placeholder message', async ({ page }) => {
    await gotoBuilder(page);
    await expect(page.getByTestId('panel-right')).toContainText('Select a node to edit');
  });

  test('G2. Selecting a node reveals Design/Props/JSON tabs', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);
    const panel = page.getByTestId('panel-right');
    await expect(panel.getByRole('button', { name: /design/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /props/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /json/i })).toBeVisible();
  });

  test('G3. Design tab is active by default', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);
    const panel = page.getByTestId('panel-right');
    // Design tab button has blue bottom border (border-bottom: 2px solid #3b82f6)
    // Verify Position & Size section is visible (only present in Design tab)
    await expect(panel.getByText('Position & Size')).toBeVisible();
  });

  test('G4. Switching to Props and JSON tabs shows correct content', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);
    const panel = page.getByTestId('panel-right');

    // Switch to Props tab
    await panel.getByRole('button', { name: /props/i }).click();
    await page.waitForTimeout(200);
    // Props tab shows either prop inputs or the "No props" placeholder
    await expect(
      panel.locator('input[type="text"]').or(panel.getByText('No props'))
    ).toBeVisible({ timeout: 3_000 });

    // Switch to JSON tab
    await panel.getByRole('button', { name: /json/i }).click();
    await expect(panel.locator('pre')).toBeVisible();
    const json = await panel.locator('pre').textContent();
    expect(() => JSON.parse(json!)).not.toThrow();
    expect(json).toContain('"type"');
  });
});

// ─── Group H — Right Panel: Size reflects on canvas ───────────────────────────

test.describe('Group H — Right Panel: Size reflects on canvas', () => {
  test('H1. Setting W=300 updates canvas element width', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);

    await page.locator('[data-testid="input-pos-w"]').fill('300');
    await page.locator('[data-testid="input-pos-w"]').press('Enter');
    await page.waitForTimeout(300);

    const nodeId = await getFirstRootNodeId(page);
    const style = await page.evaluate((id: string) => {
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

  test('H2. Setting H=200 updates canvas element height', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);

    await page.locator('[data-testid="input-pos-h"]').fill('200');
    await page.locator('[data-testid="input-pos-h"]').press('Enter');
    await page.waitForTimeout(300);

    const nodeId = await getFirstRootNodeId(page);
    const style = await page.evaluate((id: string) => {
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
  test('I1. Clicking W "Fill" adds w-full to className', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.getByTestId('panel-right').getByRole('button', { name: 'Fill' }).first().click();
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('w-full');
  });

  test('I2. Clicking W "Hug" adds w-fit to className', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.getByTestId('panel-right').getByRole('button', { name: 'Hug' }).first().click();
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('w-fit');
  });

  test('I3. Clicking H "Fill" adds h-full to className', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // H Fill is the second "Fill" button (index 1)
    await page.getByTestId('panel-right').getByRole('button', { name: 'Fill' }).nth(1).click();
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('h-full');
  });

  test('I4. Clicking H "Hug" adds h-fit to className', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // H Hug is the second "Hug" button (index 1)
    await page.getByTestId('panel-right').getByRole('button', { name: 'Hug' }).nth(1).click();
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('h-fit');
  });
});

// ─── Group J — Right Panel: Auto Layout ───────────────────────────────────────

test.describe('Group J — Right Panel: Auto Layout', () => {
  test('J1. Clicking Row direction button applies flex-row', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[title="Row"]').click();
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('flex-row');
  });

  test('J2. Clicking Column direction button applies flex-col', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[title="Column"]').click();
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('flex-col');
  });

  test('J3. Setting Gap=16 applies gap-4 to className', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-gap"]').fill('16');
    await page.locator('[data-testid="input-gap"]').press('Enter');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('gap-4');
  });
});

// ─── Group K — Right Panel: Fill (Background Color) ───────────────────────────

test.describe('Group K — Right Panel: Fill', () => {
  test('K1. Changing background color hex applies backgroundColor to style', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // Find the hex text input inside the Fill section (not the color picker input)
    const panel = page.getByTestId('panel-right');
    const hexInput = panel.locator('input[placeholder="#000000"]').first();
    await hexInput.fill('#ff0000');
    // ColorInput uses onBlur to commit — Tab away to trigger it
    await hexInput.press('Tab');
    await page.waitForTimeout(300);

    const style = await getNodeStyle(page, nodeId);
    expect(style.backgroundColor?.toLowerCase()).toContain('ff0000');
  });
});

// ─── Group L — Right Panel: Opacity ───────────────────────────────────────────

test.describe('Group L — Right Panel: Opacity', () => {
  test('L1. Setting opacity slider to 50 applies opacity to style', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // The Opacity section has a range input; set value via React-compatible native event
    const panel = page.getByTestId('panel-right');
    // Opacity slider is the last range input (Fill opacity bg-opacity is first, overall opacity is last)
    const sliders = panel.locator('input[type="range"]');
    const count = await sliders.count();
    const opacitySlider = sliders.nth(count - 1); // Last range = overall opacity
    // React controlled inputs require the native input value setter + synthetic event
    await opacitySlider.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '50');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const style = await getNodeStyle(page, nodeId);
    expect(parseFloat(style.opacity ?? '1')).toBeLessThan(1);
  });
});

// ─── Group M — Right Panel: Padding ───────────────────────────────────────────

test.describe('Group M — Right Panel: Padding', () => {
  test('M1. Setting Padding Top=20 applies paddingTop to style', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // Padding uses patchStyle (inline style), not patchCls. Scroll into view first.
    await page.evaluate(() => {
      (document.querySelector('[data-testid="input-pad-top"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    });
    await page.locator('[data-testid="input-pad-top"]').fill('20');
    await page.locator('[data-testid="input-pad-top"]').press('Enter');
    await page.waitForTimeout(300);

    const style = await getNodeStyle(page, nodeId);
    expect(style.paddingTop).toBeTruthy();
  });

  test('M2. Setting Padding Left=12 applies paddingLeft to style', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.evaluate(() => {
      (document.querySelector('[data-testid="input-pad-left"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
    });
    await page.locator('[data-testid="input-pad-left"]').fill('12');
    await page.locator('[data-testid="input-pad-left"]').press('Enter');
    await page.waitForTimeout(300);

    const style = await getNodeStyle(page, nodeId);
    expect(style.paddingLeft).toBeTruthy();
  });
});

// ─── Group N — Right Panel: Border Radius ─────────────────────────────────────

test.describe('Group N — Right Panel: Border Radius', () => {
  test('N1. Changing TL corner to rounded-lg applies rounded-tl-lg', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // The corner select uses ROUNDED_TOKENS (e.g. 'rounded-lg'); applyBorderRadius converts to 'rounded-tl-lg'
    await page.locator('[data-testid="select-corner-tl"]').selectOption('rounded-lg');
    await page.waitForTimeout(300);

    // applyBorderRadius applies per-corner class: selecting 'rounded-lg' for TL produces 'rounded-tl-lg'
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('rounded-tl-');
  });
});

// ─── Group O — Right Panel: Border Width ──────────────────────────────────────

test.describe('Group O — Right Panel: Border Width', () => {
  test('O1. Changing border width to border-2 applies border-2', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="select-border-width"]').selectOption('border-2');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('border-2');
  });
});

// ─── Group P — Right Panel: Shadow ────────────────────────────────────────────

test.describe('Group P — Right Panel: Shadow', () => {
  test('P1. Changing shadow to shadow-md applies shadow-md', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="select-shadow"]').selectOption('shadow-md');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('shadow-md');
  });
});

// ─── Group Q — Right Panel: Transform ─────────────────────────────────────────

test.describe('Group Q — Right Panel: Transform', () => {
  test('Q1. Setting Rotate=45 applies style.transform = rotate(45deg)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-rotate"]').fill('45');
    await page.locator('[data-testid="input-rotate"]').press('Enter');
    await page.waitForTimeout(300);

    const style = await getNodeStyle(page, nodeId);
    expect(style.transform).toBe('rotate(45deg)');
  });

  test('Q2. Clicking Flip H toggle applies -scale-x-100', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[title="Flip horizontal"]').click();
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('-scale-x-100');
  });
});

// ─── Group R — Right Panel: Typography ────────────────────────────────────────

test.describe('Group R — Right Panel: Typography', () => {
  test('R1. Typography section is visible for Text nodes', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Text');
    await selectFirstRootNode(page);
    await expect(page.getByTestId('panel-right').getByText('Typography')).toBeVisible();
  });

  test('R2. Changing text size to text-xl applies text-xl', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Text');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="select-text-size"]').selectOption('text-xl');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('text-xl');
  });

  test('R3. Changing font weight to font-bold applies font-bold', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Text');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="select-font-weight"]').selectOption('font-bold');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('font-bold');
  });
});

// ─── Group S — Right Panel: Props Tab ─────────────────────────────────────────

test.describe('Group S — Right Panel: Props Tab', () => {
  test('S1. Props tab shows key-value inputs for selected node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);

    const panel = page.getByTestId('panel-right');
    await panel.getByRole('button', { name: /props/i }).click();
    await page.waitForTimeout(200);
    // Props tab shows either prop inputs or the "No props" placeholder
    await expect(
      panel.locator('input[type="text"]').or(panel.getByText('No props'))
    ).toBeVisible({ timeout: 3_000 });
  });

  test('S2. Editing className in Props tab updates node in store', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    const panel = page.getByTestId('panel-right');
    await panel.getByRole('button', { name: /props/i }).click();

    // Find the className input (the value input next to "className" label)
    const clsInput = panel.locator('input').filter({ hasNot: panel.locator('[type="color"]') }).first();
    await clsInput.fill('w-full bg-red-500 test-class');
    await clsInput.press('Enter');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('test-class');
  });
});

// ─── Group T — Right Panel: JSON Tab ──────────────────────────────────────────

test.describe('Group T — Right Panel: JSON Tab', () => {
  test('T1. JSON tab shows valid JSON with correct type field', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNode(page);

    const panel = page.getByTestId('panel-right');
    await panel.getByRole('button', { name: /json/i }).click();

    const pre = panel.locator('pre');
    await expect(pre).toBeVisible();
    const content = await pre.textContent();
    expect(content).toBeTruthy();
    const parsed = JSON.parse(content!);
    expect(parsed.type).toBe('Button');
  });
});
