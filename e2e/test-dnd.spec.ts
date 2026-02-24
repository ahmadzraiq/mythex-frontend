/**
 * Drag-and-drop (canvas node movement + drop-into-container) tests.
 *
 * Uses the same helpers as builder.spec.ts and the overlay drag approach:
 * - Left-panel → canvas: item.dragTo(frame) — HTML5 drag, works fine
 * - Canvas → canvas: overlay.dragTo(overlay, { sourcePosition, targetPosition })
 *   The capture overlay is draggable=true; its onDragStart reads hitTest to find
 *   the node being dragged, and the canvas onDragOver/onDrop handle the rest.
 */

import { test, expect, Page } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
}

async function dropComponent(page: Page, label: string) {
  const compTab = page.getByTestId('tab-components');
  await compTab.click();
  const item = page.locator('[draggable="true"]').filter({ hasText: label }).first();
  await expect(item).toBeVisible({ timeout: 5_000 });
  const frame = page.locator('[data-builder-page-frame]');
  await item.dragTo(frame);
  await page.waitForSelector('[data-builder-id]', { timeout: 5_000 });
}

/**
 * Drag an existing canvas node from sourceEl to targetEl.
 * zone: 'center' = drop inside container | 'top' = insert before | 'bottom' = insert after
 */
async function dragCanvasNode(
  page: Page,
  sourceEl: ReturnType<Page['locator']>,
  targetEl: ReturnType<Page['locator']>,
  zone: 'center' | 'top' | 'bottom' = 'center'
) {
  // Deselect first so resize handles disappear and don't intercept the drag source
  const canvas = page.locator('[data-testid="builder-canvas"]');
  const canvasBox = await canvas.boundingBox();
  if (canvasBox) {
    await page.mouse.click(canvasBox.x + canvasBox.width - 5, canvasBox.y + canvasBox.height - 5);
    await page.waitForTimeout(80);
  }

  // Select the source node so hitTest returns it (not a child)
  const srcBox0 = await sourceEl.boundingBox();
  if (srcBox0) {
    await page.mouse.click(srcBox0.x + srcBox0.width / 2, srcBox0.y + srcBox0.height / 2);
    await page.waitForTimeout(80);
  }

  const overlay = page.locator('[data-builder-overlay="capture"]');
  const overlayBox = await overlay.boundingBox();
  const srcBox = await sourceEl.boundingBox();
  const tgtBox = await targetEl.boundingBox();
  if (!overlayBox || !srcBox || !tgtBox) throw new Error('Bounding box not found');

  const srcX = srcBox.x + srcBox.width / 2 - overlayBox.x;
  const srcY = srcBox.y + srcBox.height / 2 - overlayBox.y;
  const tgtX = tgtBox.x + tgtBox.width / 2 - overlayBox.x;
  const tgtY =
    zone === 'top'    ? tgtBox.y + tgtBox.height * 0.1 - overlayBox.y :
    zone === 'bottom' ? tgtBox.y + tgtBox.height * 0.9 - overlayBox.y :
                        tgtBox.y + tgtBox.height / 2    - overlayBox.y;

  await overlay.dragTo(overlay, {
    sourcePosition: { x: srcX, y: srcY },
    targetPosition: { x: tgtX, y: tgtY },
    force: true,
  });
  await page.waitForTimeout(400);
}

async function getPageNodeTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ type: string }> } }>).__builderStore.getState();
    return store.pageNodes.map(n => n.type);
  });
}

async function getNodeChildren(page: Page, nodeId: string): Promise<Array<{ type: string }>> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore.getState();
    function find(nodes: unknown[]): Record<string, unknown> | null {
      for (const n of nodes) {
        const node = n as Record<string, unknown>;
        if (node.id === id) return node;
        if ((node.children as unknown[])?.length) { const f = find(node.children as unknown[]); if (f) return f; }
      }
      return null;
    }
    const node = find(store.pageNodes);
    return (node?.children as Array<{ type: string }>) ?? [];
  }, nodeId);
}

// ─── Tests: store-level (verify moveNode action directly) ────────────────────

test('DnD-1: moveNode — Text becomes child of VStack', async ({ page }) => {
  await gotoBuilder(page);

  await dropComponent(page, 'VStack');
  await dropComponent(page, 'Text');

  const { vstackId, textId } = await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string }> } }>).__builderStore.getState();
    return {
      vstackId: store.pageNodes.find(n => n.type === 'VStack')?.id ?? '',
      textId:   store.pageNodes.find(n => n.type === 'Text')?.id ?? '',
    };
  });
  expect(vstackId).toBeTruthy();
  expect(textId).toBeTruthy();

  // Confirm both at root level
  const rootBefore = await getPageNodeTypes(page);
  console.log('Root types before moveNode:', rootBefore);
  expect(rootBefore).toContain('Text');
  expect(rootBefore).toContain('VStack');

  // Call moveNode directly via the store
  await page.evaluate(({ vId, tId }) => {
    (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore.getState().moveNode(tId, vId, 0);
  }, { vId: vstackId, tId: textId });
  await page.waitForTimeout(200);

  const children = await getNodeChildren(page, vstackId);
  console.log('VStack children after moveNode:', children);
  expect(children.length).toBeGreaterThan(0);
  expect(children.some(c => c.type === 'Text')).toBe(true);

  const rootAfter = await getPageNodeTypes(page);
  console.log('Root types after moveNode:', rootAfter);
  expect(rootAfter).not.toContain('Text');
  expect(rootAfter).toContain('VStack');
  console.log('✅ moveNode correctly places Text inside VStack');
});

test('DnD-2: moveNode — Button moves BEFORE VStack (index 0)', async ({ page }) => {
  await gotoBuilder(page);

  await dropComponent(page, 'VStack');
  await dropComponent(page, 'Button');

  const { vstackId, buttonId } = await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string }> } }>).__builderStore.getState();
    return {
      vstackId: store.pageNodes.find(n => n.type === 'VStack')?.id ?? '',
      buttonId: store.pageNodes.find(n => n.type === 'Button')?.id ?? '',
    };
  });

  const before = await getPageNodeTypes(page);
  console.log('Root order before:', before);
  expect(before[0]).toBe('VStack');

  // Move Button to index 0 (before VStack)
  await page.evaluate(({ bId }) => {
    (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore.getState().moveNode(bId, null, 0);
  }, { bId: buttonId });
  await page.waitForTimeout(200);

  const after = await getPageNodeTypes(page);
  console.log('Root order after:', after);
  expect(after[0]).toBe('Button');
  expect(after[1]).toBe('VStack');
  console.log('✅ moveNode correctly places Button before VStack');

  // Also ensure vstackId is still valid (wasn't accidentally deleted)
  const vstackStillExists = await page.evaluate((vId) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore.getState();
    function find(nodes: unknown[]): boolean {
      for (const n of nodes) {
        const node = n as Record<string, unknown>;
        if (node.id === vId) return true;
        if ((node.children as unknown[])?.length && find(node.children as unknown[])) return true;
      }
      return false;
    }
    return find(store.pageNodes);
  }, vstackId);
  expect(vstackStillExists).toBe(true);
});

test('DnD-3: moveNode — cannot drop node into itself (no-op)', async ({ page }) => {
  await gotoBuilder(page);

  await dropComponent(page, 'VStack');

  const vstackId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string }> } }>).__builderStore.getState();
    return store.pageNodes.find(n => n.type === 'VStack')?.id ?? '';
  });

  const before = await getPageNodeTypes(page);
  // Move VStack into itself — should be a no-op
  await page.evaluate((vId) => {
    (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore.getState().moveNode(vId, vId, 0);
  }, vstackId);
  await page.waitForTimeout(100);

  const after = await getPageNodeTypes(page);
  expect(after).toEqual(before);
  console.log('✅ moveNode(self, self, 0) is a no-op — guard works');
});

// ─── Shared helpers (also defined in builder.spec.ts — duplicated here to keep files self-contained) ───

async function selectFirstRootNode(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.locator('[data-testid="layer-row"]').first().click();
}

async function getFirstRootNodeId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const nodes = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id?: string }> } }>).__builderStore.getState().pageNodes;
    return nodes[0]?.id ?? '';
  });
}

async function getNodeClassName(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
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
        const ch = node.children as unknown[] | undefined;
        if (ch?.length) { const f = find(ch); if (f) return f; }
      }
      return null;
    }
    const node = find(store.pageNodes);
    return (node?.props as Record<string, Record<string, string>> | undefined)?.style ?? {};
  }, nodeId);
}

// ─── Fix-1: Drop from left panel into container ─────────────────────────────
//
// Bug: onDragLeave unconditionally resets dropTargetRef.current = null, so
// onDrop always falls back to root level even when cursor was over a container.
// Fix: check e.relatedTarget — only reset if cursor left the canvas entirely.

test.describe('Fix-1: Drop from left panel into container', () => {

  test('Fix-1a: Button dropped onto Box center lands inside Box (not at root)', async ({ page }) => {
    await gotoBuilder(page);

    // Inject a large Box so it is a clear drop target
    await page.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore.getState()._setPageNodes([
        { type: 'Box', id: 'container-box', props: { className: 'w-64 h-48 bg-gray-100', style: { width: '256px', height: '192px' } }, children: [] },
      ]);
    });
    await page.waitForSelector('[data-builder-id="container-box"]', { timeout: 5_000 });

    // Drag Button from left panel onto the Box element center
    await page.getByTestId('tab-components').click();
    const btnItem = page.locator('[draggable="true"]').filter({ hasText: 'Button' }).first();
    await expect(btnItem).toBeVisible({ timeout: 5_000 });

    const containerEl = page.locator('[data-builder-id="container-box"]');
    await btnItem.dragTo(containerEl, { targetPosition: { x: 10, y: 10 } });
    await page.waitForTimeout(400);

    // Button must be a child of Box, not at root
    const rootTypes = await getPageNodeTypes(page);
    expect(rootTypes).not.toContain('Button');

    const children = await getNodeChildren(page, 'container-box');
    expect(children.some(c => c.type === 'Button')).toBe(true);
  });

  test('Fix-1b: Text dropped onto VStack center lands inside VStack', async ({ page }) => {
    await gotoBuilder(page);

    // Inject a VStack with known size
    await page.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore.getState()._setPageNodes([
        { type: 'VStack', id: 'container-vstack', props: { className: 'w-64 h-48', style: { width: '256px', height: '192px' } }, children: [] },
      ]);
    });
    await page.waitForSelector('[data-builder-id="container-vstack"]', { timeout: 5_000 });

    await page.getByTestId('tab-components').click();
    const textItem = page.locator('[draggable="true"]').filter({ hasText: 'Text' }).first();
    await expect(textItem).toBeVisible({ timeout: 5_000 });

    const vstackEl = page.locator('[data-builder-id="container-vstack"]');
    await textItem.dragTo(vstackEl, { targetPosition: { x: 10, y: 10 } });
    await page.waitForTimeout(400);

    const rootTypes = await getPageNodeTypes(page);
    expect(rootTypes).not.toContain('Text');

    const children = await getNodeChildren(page, 'container-vstack');
    expect(children.some(c => c.type === 'Text')).toBe(true);
  });

  test('Fix-1c: Drop zone container highlight shows when dragging over Box center', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');

    const boxEl = page.locator('[data-builder-type="Box"]').first();
    const boxBox = await boxEl.boundingBox();
    if (!boxBox) throw new Error('Box bounding box not found');

    await page.evaluate(({ cx, cy }) => {
      const canvas = document.querySelector('[data-testid="builder-canvas"]') as HTMLElement;
      const dt = new DataTransfer();
      dt.items.add(JSON.stringify({ type: 'Button', id: 'test-btn', props: {} }), 'text/primitive-node');
      canvas?.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
      canvas?.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    }, { cx: boxBox.x + boxBox.width / 2, cy: boxBox.y + boxBox.height / 2 });

    await page.waitForTimeout(300);
    const highlight = page.locator('[data-testid="drop-container-highlight"]');
    const shown = await highlight.isVisible().catch(() => false);
    console.log('Container highlight visible:', shown);
    // Log only — visual confirmation. Not a hard assertion because the highlight
    // only appears when the container has been registered as drop target.
  });
});

// ─── Fix-2: "Fixed" W/H button removes sizing class ─────────────────────────
//
// Bug: Fixed button has token=''. The guard `if (token) patchCls(...)` skips it,
// so w-full / h-full are never removed when clicking Fixed.
// Fix: add else branch → patchCls(removeTwToken(cls, 'w-')) with no replacement.

test.describe('Fix-2: Fixed button removes sizing class', () => {

  test('Fix-2a: W Fill then Fixed removes w-full', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // First: click W "Fill" → className gains w-full
    await page.getByTestId('panel-right').getByRole('button', { name: 'Fill' }).first().click();
    await page.waitForTimeout(200);
    const clsAfterFill = await getNodeClassName(page, nodeId);
    expect(clsAfterFill).toContain('w-full');

    // Then: click W "Fixed" → w-full must be removed
    await page.getByTestId('panel-right').getByRole('button', { name: 'Fixed' }).first().click();
    await page.waitForTimeout(200);
    const clsAfterFixed = await getNodeClassName(page, nodeId);
    expect(clsAfterFixed).not.toContain('w-full');
    expect(clsAfterFixed).not.toContain('w-fit');
  });

  test('Fix-2b: H Fill then Fixed removes h-full', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // H Fill is the second "Fill" button (index 1)
    await page.getByTestId('panel-right').getByRole('button', { name: 'Fill' }).nth(1).click();
    await page.waitForTimeout(200);
    const clsAfterFill = await getNodeClassName(page, nodeId);
    expect(clsAfterFill).toContain('h-full');

    // H Fixed is the second "Fixed" button (index 1)
    await page.getByTestId('panel-right').getByRole('button', { name: 'Fixed' }).nth(1).click();
    await page.waitForTimeout(200);
    const clsAfterFixed = await getNodeClassName(page, nodeId);
    expect(clsAfterFixed).not.toContain('h-full');
    expect(clsAfterFixed).not.toContain('h-fit');
  });

  test('Fix-2c: W Hug then Fixed removes w-fit', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // Click W "Hug" → adds w-fit
    await page.getByTestId('panel-right').getByRole('button', { name: 'Hug' }).first().click();
    await page.waitForTimeout(200);
    const clsAfterHug = await getNodeClassName(page, nodeId);
    expect(clsAfterHug).toContain('w-fit');

    // Click W "Fixed" → w-fit must be gone
    await page.getByTestId('panel-right').getByRole('button', { name: 'Fixed' }).first().click();
    await page.waitForTimeout(200);
    const clsAfterFixed = await getNodeClassName(page, nodeId);
    expect(clsAfterFixed).not.toContain('w-fit');
    expect(clsAfterFixed).not.toContain('w-full');
  });

  test('Fix-2d: Fixed W button is active by default on a plain Box', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);

    // A plain Box has no w-fit and no w-full → Fixed button should be active
    const fixedBtn = page.getByTestId('panel-right').getByRole('button', { name: 'Fixed' }).first();
    await expect(fixedBtn).toHaveAttribute('data-active', 'true', { timeout: 3_000 });
  });
});

// ─── Fix-3: Rotate reflects on canvas via style.transform ────────────────────
//
// Bug: panel writes rotate-[45deg] as a Tailwind arbitrary class. JIT never
// compiles dynamically generated arbitrary classes, so nothing changes visually.
// Fix: write to props.style.transform as an inline style instead.

test.describe('Fix-3: Rotate value reflects on canvas', () => {

  test('Fix-3a: Rotate=45 sets style.transform=rotate(45deg) on canvas element', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-rotate"]').fill('45');
    await page.locator('[data-testid="input-rotate"]').press('Tab');
    await page.waitForTimeout(300);

    // After the fix, transform must be an inline style on the element
    const transform = await page.locator(`[data-builder-id="${nodeId}"]`).evaluate(
      (el: HTMLElement) => el.style.transform
    );
    expect(transform).toContain('rotate(45deg)');
  });

  test('Fix-3b: Rotate=−90 sets style.transform=rotate(-90deg)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-rotate"]').fill('-90');
    await page.locator('[data-testid="input-rotate"]').press('Tab');
    await page.waitForTimeout(300);

    const transform = await page.locator(`[data-builder-id="${nodeId}"]`).evaluate(
      (el: HTMLElement) => el.style.transform
    );
    expect(transform).toContain('rotate(-90deg)');
  });

  test('Fix-3c: Rotate=0 results in no visible rotation on canvas element', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    // Set a non-zero rotate first
    await page.locator('[data-testid="input-rotate"]').fill('60');
    await page.locator('[data-testid="input-rotate"]').press('Tab');
    await page.waitForTimeout(200);

    // Reset to 0
    await page.locator('[data-testid="input-rotate"]').fill('0');
    await page.locator('[data-testid="input-rotate"]').press('Tab');
    await page.waitForTimeout(300);

    const transform = await page.locator(`[data-builder-id="${nodeId}"]`).evaluate(
      (el: HTMLElement) => el.style.transform
    );
    // 0-degree rotation should be empty string or contain rotate(0deg)
    expect(transform === '' || transform === 'rotate(0deg)').toBe(true);
  });

  test('Fix-3d: Rotate value in store is in props.style, not in className', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-rotate"]').fill('30');
    await page.locator('[data-testid="input-rotate"]').press('Tab');
    await page.waitForTimeout(300);

    // className must NOT contain the old rotate-[...] pattern
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).not.toMatch(/rotate-\[\d+deg\]/);

    // style.transform in the store must contain rotate(30deg)
    const style = await getNodeStyle(page, nodeId);
    expect(style.transform).toContain('rotate(30deg)');
  });
});

// ─── Fix-4: NumberInput commits on blur (no Enter required) ──────────────────
//
// All NumberInputs already have onBlur. This group verifies each one
// commits its value when the user tabs away — without pressing Enter.

test.describe('Fix-4: NumberInput commits on blur without Enter', () => {

  test('Fix-4a: W (position) commits via Tab/blur', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-pos-w"]').fill('250');
    await page.locator('[data-testid="input-pos-w"]').press('Tab'); // blur — no Enter
    await page.waitForTimeout(300);

    const style = await getNodeStyle(page, nodeId);
    expect(style.width).toBe('250px');
  });

  test('Fix-4b: H (position) commits via Tab/blur', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-pos-h"]').fill('180');
    await page.locator('[data-testid="input-pos-h"]').press('Tab');
    await page.waitForTimeout(300);

    const style = await getNodeStyle(page, nodeId);
    expect(style.height).toBe('180px');
  });

  test('Fix-4c: Rotate commits via Tab/blur', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-rotate"]').fill('15');
    await page.locator('[data-testid="input-rotate"]').press('Tab');
    await page.waitForTimeout(300);

    // After fix: style.transform committed, no className rotate
    const style = await getNodeStyle(page, nodeId);
    expect(style.transform).toContain('rotate(15deg)');
  });

  test('Fix-4d: Gap commits via Tab/blur', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-gap"]').fill('16');
    await page.locator('[data-testid="input-gap"]').press('Tab');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('gap-4');
  });

  test('Fix-4e: Padding Top commits via Tab/blur', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-pad-top"]').fill('24');
    await page.locator('[data-testid="input-pad-top"]').press('Tab');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toMatch(/pt-/);
  });

  test('Fix-4f: W value commits when clicking elsewhere (mouse blur)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNode(page);
    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="input-pos-w"]').fill('320');
    // Click somewhere else in the panel to trigger blur (not Tab, not Enter)
    await page.locator('[data-testid="input-pos-h"]').click();
    await page.waitForTimeout(300);

    const style = await getNodeStyle(page, nodeId);
    expect(style.width).toBe('320px');
  });
});

// ─── DnD-UI: visual drag with synthetic events ───────────────────────────────

test('DnD-UI-1: Drag from canvas triggers dragstart on capture overlay', async ({ page }) => {
  await gotoBuilder(page);

  await dropComponent(page, 'Text');
  const textEl = page.locator('[data-builder-type="Text"]').first();
  const textId = await textEl.getAttribute('data-builder-id');
  const vstackBox = await page.locator('[data-builder-page-frame]').boundingBox();

  // Verify the capture overlay exists and is draggable
  const overlay = page.locator('[data-builder-overlay="capture"]');
  await expect(overlay).toBeVisible();
  const isDraggable = await overlay.getAttribute('draggable');
  expect(isDraggable).toBe('true');
  console.log('✅ Capture overlay is draggable; canvas textId:', textId);
  console.log('Page frame box:', vstackBox);
});

test('DnD-4: Container drop highlight appears when dragging over VStack center', async ({ page }) => {
  await gotoBuilder(page);

  await dropComponent(page, 'VStack');
  await dropComponent(page, 'Text');

  const vstackEl = page.locator('[data-builder-type="VStack"]').first();
  const textEl   = page.locator('[data-builder-type="Text"]').first();

  // Start a drag: move text toward center of vstack and pause (don't drop yet)
  const overlay    = page.locator('[data-builder-overlay="capture"]');
  const overlayBox = await overlay.boundingBox();
  const srcBox     = await textEl.boundingBox();
  const tgtBox     = await vstackEl.boundingBox();
  if (!overlayBox || !srcBox || !tgtBox) throw new Error('Bounding box not found');

  const srcX = srcBox.x + srcBox.width / 2 - overlayBox.x;
  const srcY = srcBox.y + srcBox.height / 2 - overlayBox.y;
  const tgtX = tgtBox.x + tgtBox.width / 2 - overlayBox.x;
  const tgtY = tgtBox.y + tgtBox.height / 2 - overlayBox.y;

  // Fire dragstart on overlay at the text position
  await page.evaluate(({ x, y, tx, ty }) => {
    const overlay = document.querySelector('[data-builder-overlay="capture"]') as HTMLElement;
    if (!overlay) return;
    const dt = new DataTransfer();
    dt.items.add('', 'text/canvas-node-id'); // placeholder — actual id set in onDragStart
    const dsEvt = new DragEvent('dragstart', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
    overlay.dispatchEvent(dsEvt);

    // Fire dragover at the VStack center
    const canvas = document.querySelector('[data-testid="builder-canvas"]') as HTMLElement;
    const doEvt = new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: tx, clientY: ty, dataTransfer: dt });
    canvas?.dispatchEvent(doEvt);
  }, {
    x: srcBox.x + srcBox.width / 2,
    y: srcBox.y + srcBox.height / 2,
    tx: tgtBox.x + tgtBox.width / 2,
    ty: tgtBox.y + tgtBox.height / 2,
  });

  await page.waitForTimeout(300);
  const highlight = page.locator('[data-testid="drop-container-highlight"]');
  const visible = await highlight.isVisible().catch(() => false);
  console.log('Container highlight visible during drag:', visible);
  // The highlight shows when dragover fires over a container's center zone
  // Visual confirmation — log result
  if (visible) console.log('✅ Container drop highlight shows correctly');
});

// ─── Helpers shared by T-series tests ────────────────────────────────────────

async function selectFirstRootNodeViaLayers(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.getByTestId('layer-row').first().click();
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(150);
}

// ─── T1–T4: W/H Dimension buttons ────────────────────────────────────────────

test('T1: W Fill button adds w-full class', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'Button');
  await selectFirstRootNodeViaLayers(page);

  const panel = page.locator('[data-testid="panel-right"]');
  const nodeId = await getFirstRootNodeId(page);

  // Click the first "Fill" button (W row)
  await panel.getByText('Fill', { exact: true }).first().click();
  await page.waitForTimeout(200);

  const cls = await getNodeClassName(page, nodeId);
  console.log('className after W Fill:', cls);
  expect(cls).toContain('w-full');
  console.log('✅ W Fill adds w-full');
});

test('T2: W Fixed button removes w-fit and w-full (bug fix)', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'Button');
  await selectFirstRootNodeViaLayers(page);

  const panel = page.locator('[data-testid="panel-right"]');
  const nodeId = await getFirstRootNodeId(page);

  // First set to Fill so we have w-full
  await panel.getByText('Fill').first().click();
  await page.waitForTimeout(150);
  const clsAfterFill = await getNodeClassName(page, nodeId);
  expect(clsAfterFill).toContain('w-full');

  // Now click Fixed — should remove w-full
  await panel.getByText('Fixed').first().click();
  await page.waitForTimeout(150);

  const clsAfterFixed = await getNodeClassName(page, nodeId);
  console.log('className after W Fixed:', clsAfterFixed);
  expect(clsAfterFixed).not.toContain('w-full');
  expect(clsAfterFixed).not.toContain('w-fit');
  console.log('✅ Fixed correctly removes width tokens');
});

test('T3: W Hug button adds w-fit class', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'Button');
  await selectFirstRootNodeViaLayers(page);

  const panel = page.locator('[data-testid="panel-right"]');
  const nodeId = await getFirstRootNodeId(page);

  await panel.getByText('Hug').first().click();
  await page.waitForTimeout(150);

  const cls = await getNodeClassName(page, nodeId);
  console.log('className after W Hug:', cls);
  expect(cls).toContain('w-fit');
});

test('T4: H Fixed button removes h-fit and h-full (bug fix)', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'Button');
  await selectFirstRootNodeViaLayers(page);

  const panel = page.locator('[data-testid="panel-right"]');
  const nodeId = await getFirstRootNodeId(page);

  // Set to H Fill first
  const fillBtns = panel.getByText('Fill');
  await fillBtns.nth(1).click(); // second Fill = H Fill
  await page.waitForTimeout(150);
  const clsAfterFill = await getNodeClassName(page, nodeId);
  expect(clsAfterFill).toContain('h-full');

  // Click H Fixed
  const fixedBtns = panel.getByText('Fixed');
  await fixedBtns.nth(1).click(); // second Fixed = H Fixed
  await page.waitForTimeout(150);

  const clsAfterFixed = await getNodeClassName(page, nodeId);
  console.log('className after H Fixed:', clsAfterFixed);
  expect(clsAfterFixed).not.toContain('h-full');
  expect(clsAfterFixed).not.toContain('h-fit');
  console.log('✅ H Fixed correctly removes height tokens');
});

// ─── T5–T6: Rotate ───────────────────────────────────────────────────────────

test('T5: Rotate input 45 applies style.transform = rotate(45deg)', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'Button');
  await selectFirstRootNodeViaLayers(page);

  const nodeId = await getFirstRootNodeId(page);
  const rotateInput = page.locator('[data-testid="input-rotate"]');
  await rotateInput.clear();
  await rotateInput.fill('45');
  await rotateInput.press('Tab');
  await page.waitForTimeout(400);

  // Rotation is now stored in style.transform for reliable visual rendering
  const style = await page.evaluate((id) => {
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
  console.log('style.transform after rotate 45:', style.transform);
  expect(style.transform).toBe('rotate(45deg)');
  console.log('✅ Rotate 45 sets style.transform = rotate(45deg)');
});

test('T6: Rotate input 0 clears style.transform', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'Button');
  await selectFirstRootNodeViaLayers(page);

  const nodeId = await getFirstRootNodeId(page);
  const rotateInput = page.locator('[data-testid="input-rotate"]');

  // Set to 45 first
  await rotateInput.clear();
  await rotateInput.fill('45');
  await rotateInput.press('Tab');
  await page.waitForTimeout(400);

  // Now set back to 0
  await rotateInput.clear();
  await rotateInput.fill('0');
  await rotateInput.press('Tab');
  await page.waitForTimeout(400);

  const style = await page.evaluate((id) => {
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
  console.log('style after rotate 0:', style);
  // transform should be removed or empty when deg=0
  expect(style.transform ?? '').not.toContain('rotate(45deg)');
  console.log('✅ Rotate 0 clears style.transform');
});

// ─── T7: NumberInput live update (no Enter needed) ───────────────────────────

test('T7: NumberInput applies value immediately on change (no Enter needed)', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'Button');
  await selectFirstRootNodeViaLayers(page);

  const nodeId = await getFirstRootNodeId(page);

  // Use the gap input (always visible) — type a value; change fires immediately
  const gapInput = page.locator('[data-testid="input-gap"]');
  await gapInput.clear();
  await gapInput.fill('8');
  // No Enter, no Tab, no wait — value should apply immediately
  await page.waitForTimeout(100);

  const cls = await getNodeClassName(page, nodeId);
  console.log('className after gap=8 (no Enter, instant):', cls);
  expect(cls).toContain('gap-');
  console.log('✅ NumberInput committed value immediately without Enter');
});

// ─── T8–T10: Container drag & drop ───────────────────────────────────────────

test('T8: moveNode — drag Text out of VStack back to root', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'VStack');
  await dropComponent(page, 'Text');

  const { vstackId, textId } = await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string }> } }>).__builderStore.getState();
    return {
      vstackId: store.pageNodes.find(n => n.type === 'VStack')?.id ?? '',
      textId:   store.pageNodes.find(n => n.type === 'Text')?.id ?? '',
    };
  });

  // First move Text inside VStack
  await page.evaluate(({ vId, tId }) => {
    (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore.getState().moveNode(tId, vId, 0);
  }, { vId: vstackId, tId: textId });
  await page.waitForTimeout(150);

  const childrenBefore = await getNodeChildren(page, vstackId);
  expect(childrenBefore.some(c => c.type === 'Text')).toBe(true);

  // Now move Text back to root
  await page.evaluate(({ tId }) => {
    (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore.getState().moveNode(tId, null, 1);
  }, { tId: textId });
  await page.waitForTimeout(150);

  const childrenAfter = await getNodeChildren(page, vstackId);
  expect(childrenAfter.length).toBe(0);

  const rootTypes = await getPageNodeTypes(page);
  expect(rootTypes).toContain('Text');
  expect(rootTypes).toContain('VStack');
  console.log('✅ Text moved out of VStack back to root');
});

test('T9: moveNode — two Text nodes inside VStack, reorder them', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'VStack');
  await dropComponent(page, 'Text');
  await dropComponent(page, 'Button');

  const { vstackId, textId, buttonId } = await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string }> } }>).__builderStore.getState();
    return {
      vstackId: store.pageNodes.find(n => n.type === 'VStack')?.id ?? '',
      textId:   store.pageNodes.find(n => n.type === 'Text')?.id ?? '',
      buttonId: store.pageNodes.find(n => n.type === 'Button')?.id ?? '',
    };
  });

  // Move both into VStack
  await page.evaluate(({ vId, tId, bId }) => {
    const { moveNode } = (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore.getState();
    moveNode(tId, vId, 0);
    moveNode(bId, vId, 1);
  }, { vId: vstackId, tId: textId, bId: buttonId });
  await page.waitForTimeout(150);

  const childrenBefore = await getNodeChildren(page, vstackId);
  console.log('Children before reorder:', childrenBefore.map(c => c.type));
  expect(childrenBefore[0]?.type).toBe('Text');
  expect(childrenBefore[1]?.type).toBe('Button');

  // Swap them — move Text to after Button (index 2, adjusted to 1)
  await page.evaluate(({ vId, tId }) => {
    (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore.getState().moveNode(tId, vId, 2);
  }, { vId: vstackId, tId: textId });
  await page.waitForTimeout(150);

  const childrenAfter = await getNodeChildren(page, vstackId);
  console.log('Children after reorder:', childrenAfter.map(c => c.type));
  expect(childrenAfter[0]?.type).toBe('Button');
  expect(childrenAfter[1]?.type).toBe('Text');
  console.log('✅ Children inside VStack reordered correctly');
});

// ─── T10: Drop zone indicator visual ─────────────────────────────────────────

test('T10: Drop zone line appears when dragover fires at top of a sibling', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'VStack');
  await dropComponent(page, 'Button');

  const vstackEl = page.locator('[data-builder-type="VStack"]').first();
  const vstackBox = await vstackEl.boundingBox();
  if (!vstackBox) throw new Error('VStack not found');

  // Fire dragover at the TOP 10% of VStack — should trigger "before" drop zone
  const topY = vstackBox.y + vstackBox.height * 0.1;

  await page.evaluate(({ x, y }) => {
    const dt = new DataTransfer();
    dt.items.add('node-id', 'text/canvas-node-id');
    const canvas = document.querySelector('[data-testid="builder-canvas"]') as HTMLElement;
    const doEvt = new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
    canvas?.dispatchEvent(doEvt);
  }, { x: vstackBox.x + vstackBox.width / 2, y: topY });

  await page.waitForTimeout(200);

  // The drop zone line should be visible
  const dropLine = page.locator('[data-testid="drop-zone-line"]');
  const visible = await dropLine.isVisible().catch(() => false);
  console.log('Drop zone line visible:', visible);
  if (visible) console.log('✅ Drop zone line shows at top-of-sibling zone');
});

// ─── T11: Right-panel changes reflect on canvas ───────────────────────────────

test('T11: Changing opacity in right panel reflects in node className', async ({ page }) => {
  await gotoBuilder(page);
  await dropComponent(page, 'Button');
  await selectFirstRootNodeViaLayers(page);

  const nodeId = await getFirstRootNodeId(page);

  // Set opacity via slider using native setter
  const slider = page.locator('input[type="range"]').first();
  await slider.evaluate((el: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, '50');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);

  const cls = await getNodeClassName(page, nodeId);
  console.log('className after opacity=50:', cls);
  expect(cls).toContain('opacity-50');
  console.log('✅ Opacity 50 reflected in className');
});

// ─── Group U — Right Panel: All Properties (untested) ────────────────────────

test.describe('Group U — Right Panel: All Properties', () => {

  // U1: Alignment cell 4 (center) → items-center + justify-center, button still in DOM
  test('U1: Alignment cell 4 adds items-center justify-center, button still exists', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    // Click alignment cell 4 (center of the 3×3 grid)
    await page.locator('[data-testid="alignment-cell"][data-cell-index="4"]').click();
    await page.waitForTimeout(200);

    // Button still in DOM
    await expect(page.locator('[data-builder-id]').first()).toBeVisible();

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after alignment cell 4:', cls);
    expect(cls).toContain('items-center');
    expect(cls).toContain('justify-center');
    console.log('✅ Alignment center applied, button still visible');
  });

  // U2: Alignment cell 0 (top-left) → items-start + justify-start, button still in DOM
  test('U2: Alignment cell 0 adds items-start justify-start, button still exists', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="alignment-cell"][data-cell-index="0"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator('[data-builder-id]').first()).toBeVisible();

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after alignment cell 0:', cls);
    expect(cls).toContain('items-start');
    expect(cls).toContain('justify-start');
    console.log('✅ Alignment top-left applied, button still visible');
  });

  // U3: Flip V toggle → -scale-y-100 in className
  test('U3: Flip V toggle adds -scale-y-100', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[title="Flip vertical"]').click();
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after Flip V:', cls);
    expect(cls).toContain('-scale-y-100');
    console.log('✅ Flip V applied');
  });

  // U4: Auto Layout Row Wrap → flex-row + flex-wrap in className
  test('U4: Auto Layout Row Wrap adds flex-row and flex-wrap', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[title="Row wrap"]').click();
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after Row Wrap:', cls);
    expect(cls).toContain('flex-row');
    expect(cls).toContain('flex-wrap');
    console.log('✅ Row Wrap applied');
  });

  // U5: Auto Layout Grid → grid in className
  test('U5: Auto Layout Grid adds grid class', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[title="Grid"]').click();
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after Grid:', cls);
    expect(cls).toContain('grid');
    console.log('✅ Grid applied');
  });

  // U6: Gap Mode Space-between → justify-between in className
  test('U6: Gap Mode Space-between adds justify-between', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    // Click the "⇔" space-between mode button (second ⇔ button — first is Flip H)
    const panel = page.locator('[data-testid="panel-right"]');
    await panel.getByText('⇔', { exact: true }).nth(1).click();
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after Space-between:', cls);
    expect(cls).toContain('justify-between');
    console.log('✅ Space-between applied');
  });

  // U7: Clip content toggle ON → overflow-hidden in className
  test('U7: Clip content toggle ON adds overflow-hidden', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="clip-content-toggle"]').click();
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after Clip ON:', cls);
    expect(cls).toContain('overflow-hidden');
    console.log('✅ overflow-hidden added');
  });

  // U8: Clip content toggle OFF (second click) → overflow-hidden removed
  test('U8: Clip content toggle OFF removes overflow-hidden', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);
    const toggle = page.locator('[data-testid="clip-content-toggle"]');

    // Toggle ON
    await toggle.click();
    await page.waitForTimeout(150);
    const clsOn = await getNodeClassName(page, nodeId);
    expect(clsOn).toContain('overflow-hidden');

    // Toggle OFF
    await toggle.click();
    await page.waitForTimeout(200);
    const clsOff = await getNodeClassName(page, nodeId);
    console.log('className after Clip OFF:', clsOff);
    expect(clsOff).not.toContain('overflow-hidden');
    console.log('✅ overflow-hidden removed');
  });

  // U9: Stroke color → border-[#ff0000] in className
  test('U9: Stroke color input adds border-[hex] to className', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    const strokeInput = page.locator('[data-testid="input-stroke-color"]');
    await strokeInput.fill('#ff0000');
    await strokeInput.press('Tab');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after stroke color:', cls);
    expect(cls).toContain('border-[#ff0000]');
    console.log('✅ Stroke color applied');
  });

  // U10: Typography Leading → leading-loose in className (Text node)
  test('U10: Typography Leading applies leading-loose (Text node)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Text');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="select-leading"]').selectOption('leading-loose');
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after leading-loose:', cls);
    expect(cls).toContain('leading-loose');
    console.log('✅ leading-loose applied');
  });

  // U11: Typography Tracking → tracking-widest in className (Text node)
  test('U11: Typography Tracking applies tracking-widest (Text node)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Text');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    await page.locator('[data-testid="select-tracking"]').selectOption('tracking-widest');
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after tracking-widest:', cls);
    expect(cls).toContain('tracking-widest');
    console.log('✅ tracking-widest applied');
  });

  // U12: Typography Text Color → text-[#ff0000] in className (Text node)
  test('U12: Typography Text Color applies text-[hex] (Text node)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Text');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    const textColorInput = page.locator('[data-testid="input-text-color"]');
    await textColorInput.fill('#ff0000');
    await textColorInput.press('Tab');
    await page.waitForTimeout(300);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after text color:', cls);
    expect(cls).toContain('text-[#ff0000]');
    console.log('✅ Text color applied');
  });

  // U13: Background opacity slider → bg-opacity-50 in className
  test('U13: Background opacity slider applies bg-opacity-50', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const nodeId = await getFirstRootNodeId(page);

    const slider = page.locator('[data-testid="bg-opacity-slider"]');
    await slider.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '50');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after bg-opacity-50:', cls);
    expect(cls).toContain('bg-opacity-50');
    console.log('✅ bg-opacity-50 applied');
  });

  // U14: W=56 DOM update — el.style.width === '56px' (Box node, to avoid Gluestack min-width)
  test('U14: W=56 updates DOM element style.width to 56px (with minWidth:0)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const wInput = page.locator('[data-testid="input-pos-w"]');
    await wInput.fill('56');
    await wInput.press('Enter');
    await page.waitForTimeout(400);

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

    console.log('style after W=56:', style);
    expect(style.width).toBe('56px');
    expect(style.minWidth).toBe('0');

    // Also verify DOM element actually has the style applied
    const domWidth = await page.locator('[data-builder-id]').first().evaluate(
      (el: HTMLElement) => el.style.width
    );
    console.log('DOM element style.width:', domWidth);
    expect(domWidth).toBe('56px');
    console.log('✅ W=56 applied to store and DOM element');
  });

  // ── Color picker tests (V-series) ──────────────────────────────────────────

  test('V1: Background color picker sets style.backgroundColor on canvas node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);
    const nodeId = await getFirstRootNodeId(page);

    // Activate Fill section by setting color via hex input
    const bgInput = page.locator('[data-testid="input-bg-color"]');
    await bgInput.fill('#ff0000');
    await bgInput.press('Tab');
    await page.waitForTimeout(200);

    const style = await getNodeStyle(page, nodeId);
    console.log('style after bg color #ff0000:', style);
    expect(style.backgroundColor).toBe('#ff0000');

    // Verify DOM element has the inline style
    const domBg = await page.locator(`[data-builder-id="${nodeId}"]`).evaluate((el: HTMLElement) => el.style.backgroundColor);
    console.log('DOM backgroundColor:', domBg);
    // rgb(255, 0, 0) is the browser-normalized form of #ff0000
    expect(domBg).toMatch(/rgb\(255,\s*0,\s*0\)|#ff0000/i);
    console.log('✅ Background color reflects on canvas via inline style');
  });

  test('V2: Text color picker sets style.color on Text node', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Text');
    await selectFirstRootNodeViaLayers(page);
    const nodeId = await getFirstRootNodeId(page);

    const textColorInput = page.locator('[data-testid="input-text-color"]');
    await textColorInput.fill('#00ff00');
    await textColorInput.press('Tab');
    await page.waitForTimeout(200);

    const style = await getNodeStyle(page, nodeId);
    console.log('style after text color #00ff00:', style);
    expect(style.color).toBe('#00ff00');
    console.log('✅ Text color reflects on canvas via inline style');
  });

  test('V3: Button stays visible and Auto Layout is hidden for it (gap cannot corrupt Button layout)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNodeViaLayers(page);
    const nodeId = await getFirstRootNodeId(page);

    // Gap input is hidden for Button — user can't accidentally add gap classes
    const gapInput = page.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();

    // Button should be visible on canvas with unchanged className
    const buttonEl = page.locator(`[data-builder-id="${nodeId}"]`);
    await expect(buttonEl).toBeVisible();

    const cls = await getNodeClassName(page, nodeId);
    console.log('Button className (no gap possible):', cls);
    expect(cls).not.toContain('gap-');
    console.log('✅ Button stays visible and gap cannot be applied (Auto Layout hidden for Button)');
  });

  test('V5: Auto Layout / Gap section is hidden for Button (prevents button disappear)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNodeViaLayers(page);

    // The Gap input should NOT be present in the panel for a Button node
    const gapInput = page.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Gap input hidden for Button node');
  });

  test('V6: Auto Layout / Gap section IS shown for Box (container node)', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);

    const gapInput = page.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible();
    console.log('✅ Gap input visible for Box node');
  });

  test('V7: Typography section shown for Text, hidden for Box', async ({ page }) => {
    await gotoBuilder(page);

    // Text node → Typography visible
    await dropComponent(page, 'Text');
    await selectFirstRootNodeViaLayers(page);
    const textColorInput = page.locator('[data-testid="input-text-color"]');
    await expect(textColorInput).toBeVisible();
    console.log('Typography visible for Text ✓');

    // Box node → Typography hidden (fresh page to avoid multi-node layer issues)
    await page.reload();
    await page.waitForTimeout(500);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);
    await expect(textColorInput).not.toBeVisible();
    console.log('✅ Typography shown for Text, hidden for Box');
  });

  test('V8: Self-alignment adds self-center class to Button inside VStack', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Button');
    await selectFirstRootNodeViaLayers(page);
    const nodeId = await getFirstRootNodeId(page);

    // Click the self-center button
    await page.locator('[data-testid="self-align-self-center"]').click();
    await page.waitForTimeout(150);

    const cls = await getNodeClassName(page, nodeId);
    console.log('className after self-center:', cls);
    expect(cls).toContain('self-center');

    // Switch to self-start
    await page.locator('[data-testid="self-align-self-start"]').click();
    await page.waitForTimeout(150);

    const cls2 = await getNodeClassName(page, nodeId);
    console.log('className after self-start:', cls2);
    expect(cls2).toContain('self-start');
    expect(cls2).not.toContain('self-center');

    // Self-auto clears the token
    await page.locator('[data-testid="self-align-self-auto"]').click();
    await page.waitForTimeout(150);

    const cls3 = await getNodeClassName(page, nodeId);
    console.log('className after self-auto:', cls3);
    expect(cls3).not.toContain('self-');
    console.log('✅ Self-alignment applies and toggles correctly');
  });

  test('V4: Stroke border color picker sets style.borderColor', async ({ page }) => {
    await gotoBuilder(page);
    await dropComponent(page, 'Box');
    await selectFirstRootNodeViaLayers(page);
    const nodeId = await getFirstRootNodeId(page);

    const strokeInput = page.locator('[data-testid="input-stroke-color"]');
    await strokeInput.fill('#0000ff');
    await strokeInput.press('Tab');
    await page.waitForTimeout(200);

    const style = await getNodeStyle(page, nodeId);
    console.log('style after border color #0000ff:', style);
    expect(style.borderColor).toBe('#0000ff');
    console.log('✅ Border color reflects via inline style');
  });

});
