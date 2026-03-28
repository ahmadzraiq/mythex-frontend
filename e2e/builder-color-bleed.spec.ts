/**
 * Color Bleed — CB series
 *
 * Reproduces the exact user scenario:
 *   1. Drop Box A and make it blue (full-screen)
 *   2. Drop Box B at the TOP of the canvas (BEFORE Box A in the layout)
 *   3. Box B visually appears blue — diagnose why
 *
 * CB-01  Verifies Box B JSON is clean (no bg class/style) — always expected to pass.
 * CB-03  Diagnostic: MutationObserver catches every inline-style write on Box B,
 *        and logs Box B's parent chain so we know if it landed inside Box A or at root.
 *
 * Run:  npx playwright test e2e/builder-color-bleed.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 100 }
  );
  await page.evaluate(() => {
    (window as unknown as { __builderStore: { getState: () => { _setPageNodes: (n: unknown[]) => void } } })
      .__builderStore.getState()._setPageNodes([]);
  });
  await page.waitForTimeout(300);
}

type StoreNode = {
  id?: string; type?: string;
  props?: { className?: string; style?: Record<string, string> };
  children?: StoreNode[];
};

async function getPageNodes(page: Page): Promise<StoreNode[]> {
  return page.evaluate(() =>
    (window as unknown as { __builderStore: { getState: () => { pageNodes: StoreNode[] } } })
      .__builderStore.getState().pageNodes
  );
}

/**
 * Drop a Box from the components panel.
 * @param dropAt 'center' = middle of frame (default).
 *               'top'    = very top edge of frame (inserts BEFORE existing nodes).
 *               'bottom' = bottom edge of frame (inserts AFTER existing nodes).
 */
async function dropBoxFromPanel(page: Page, dropAt: 'center' | 'top' | 'bottom' = 'center'): Promise<string> {
  await page.getByTestId('tab-components').click();
  await page.waitForTimeout(150);
  const item = page.locator('[draggable="true"]').filter({ hasText: 'Box' }).first();
  await expect(item).toBeVisible({ timeout: 8_000 });
  const frame = page.locator('[data-builder-page-frame]');

  // Snapshot of existing IDs before drop (to identify the new node afterwards)
  const idsBefore: string[] = await page.evaluate(() =>
    (window as unknown as { __builderStore: { getState: () => { pageNodes: StoreNode[] } } })
      .__builderStore.getState().pageNodes.map((n: StoreNode) => n.id ?? '')
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    const frameBox = await frame.boundingBox();
    if (!frameBox) { await item.dragTo(frame); }
    else {
      let targetY: number;
      if (dropAt === 'top')         targetY = frameBox.y + 6;
      else if (dropAt === 'bottom') targetY = frameBox.y + frameBox.height - 6;
      else                          targetY = frameBox.y + frameBox.height / 2;
      const targetX = frameBox.x + frameBox.width / 2;

      await item.hover();
      await page.mouse.down();
      await page.waitForTimeout(80);
      await page.mouse.move(targetX, targetY, { steps: 15 });
      await page.waitForTimeout(200);
      await page.mouse.up();
    }

    await page.waitForTimeout(400);
    // Find a node that wasn't in idsBefore — that's the new Box
    const newId: string = await page.evaluate((before) => {
      function allIds(nodes: StoreNode[]): string[] {
        const ids: string[] = [];
        for (const n of nodes) { if (n.id) ids.push(n.id); if (n.children) ids.push(...allIds(n.children)); }
        return ids;
      }
      const current = allIds(
        (window as unknown as { __builderStore: { getState: () => { pageNodes: StoreNode[] } } })
          .__builderStore.getState().pageNodes
      );
      return current.find(id => !before.includes(id)) ?? '';
    }, idsBefore);

    if (newId) return newId;
  }
  return '';
}

/** Select a node via the Layers panel (avoids canvas-click flakiness). */
async function selectNodeByIndex(page: Page, idx: number) {
  await page.getByTestId('tab-layers').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="layer-row"]').nth(idx).click();
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(200);
}

/** Returns the parent node of `nodeId` if it exists in the tree, otherwise null. */
async function getParentNode(page: Page, nodeId: string): Promise<StoreNode | null> {
  return page.evaluate((id) => {
    const store = (window as unknown as { __builderStore: { getState: () => { pageNodes: StoreNode[] } } })
      .__builderStore.getState();
    function findParent(arr: StoreNode[], target: string, parent: StoreNode | null): StoreNode | null {
      for (const n of arr) {
        if (n.id === target) return parent;
        if (n.children) { const f = findParent(n.children, target, n); if (f !== undefined) return f; }
      }
      return undefined as unknown as StoreNode | null;
    }
    return findParent(store.pageNodes, id, null) ?? null;
  }, nodeId);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

/**
 * CB-01  Drop Box A (blue) → drop Box B at TOP of canvas (before Box A) →
 *        Box B JSON must have no bg class/style regardless of where it landed.
 */
test('CB-01: Box B dropped before Box A has no inherited bg color in JSON', async ({ page }) => {
  await gotoBuilder(page);

  // Drop Box A and colour it blue
  const boxAId = await dropBoxFromPanel(page, 'center');
  await selectNodeByIndex(page, 0);

  const bgSwatch = page.locator('[data-testid="input-bg-color-swatch"]');
  await expect(bgSwatch).toBeVisible({ timeout: 8_000 });
  await bgSwatch.click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="input-bg-color"]').fill('1d4ed8');
  await page.locator('[data-testid="input-bg-color"]').press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');

  const boxAClass = await page.evaluate((id) => {
    const s = (window as unknown as { __builderStore: { getState: () => { pageNodes: StoreNode[] } } })
      .__builderStore.getState();
    function find(arr: StoreNode[]): StoreNode | null {
      for (const n of arr) { if (n.id === id) return n; if (n.children) { const f = find(n.children); if (f) return f; } }
      return null;
    }
    return find(s.pageNodes)?.props?.className ?? '';
  }, boxAId);
  expect(boxAClass, 'Box A should have a bg class').toMatch(/bg-/);

  // Deselect and wait 3 s — exact user scenario
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3_000);

  // Drop Box B at the TOP of the canvas (before Box A)
  const boxBId = await dropBoxFromPanel(page, 'top');
  expect(boxBId).not.toBe(boxAId);
  await page.waitForTimeout(500);

  // Assertion A: no bg class in JSON
  const boxBClass = await page.evaluate((id) => {
    const s = (window as unknown as { __builderStore: { getState: () => { pageNodes: StoreNode[] } } })
      .__builderStore.getState();
    function find(arr: StoreNode[]): StoreNode | null {
      for (const n of arr) { if (n.id === id) return n; if (n.children) { const f = find(n.children); if (f) return f; } }
      return null;
    }
    return find(s.pageNodes)?.props?.className ?? '';
  }, boxBId);
  expect(boxBClass, 'Box B className must NOT contain bg-[').not.toMatch(/bg-\[/);

  // Assertion B: no inline backgroundColor in JSON
  const boxBStyleBg = await page.evaluate((id) => {
    const s = (window as unknown as { __builderStore: { getState: () => { pageNodes: StoreNode[] } } })
      .__builderStore.getState();
    function find(arr: StoreNode[]): StoreNode | null {
      for (const n of arr) { if (n.id === id) return n; if (n.children) { const f = find(n.children); if (f) return f; } }
      return null;
    }
    return find(s.pageNodes)?.props?.style?.backgroundColor ?? '';
  }, boxBId);
  expect(boxBStyleBg, 'Box B props.style.backgroundColor must be empty').toBe('');

  // Assertion C: no inline background-color on DOM element
  const boxBInlineStyle = await page.evaluate((id) => {
    const el = document.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null;
    return el?.getAttribute('style') ?? '';
  }, boxBId);
  // Before the fix, React reused Box A's DOM element for Box B (inserted at index 0),
  // inheriting Box A's imperatively-set background-color.
  // After the fix (node.id as React key), DOM elements are never reused across different nodes.
  expect(boxBInlineStyle, 'Box B DOM style must not contain background-color (DOM reuse bug)')
    .not.toMatch(/background-color/);
});

/**
 * CB-03  Diagnostic: captures MutationObserver writes + parent chain + computed bg.
 *        Drops Box B at the TOP (before Box A) to match the exact user scenario.
 *        Always passes — output reveals root cause.
 */
test('CB-03: diagnostic — Box B dropped at TOP of canvas', async ({ page }) => {
  await gotoBuilder(page);

  // Box A with blue
  const boxAId = await dropBoxFromPanel(page, 'center');
  await selectNodeByIndex(page, 0);

  const bgSwatch = page.locator('[data-testid="input-bg-color-swatch"]');
  if (await bgSwatch.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await bgSwatch.click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="input-bg-color"]').fill('1d4ed8');
    await page.locator('[data-testid="input-bg-color"]').press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
  }

  await page.keyboard.press('Escape');  // deselect
  await page.waitForTimeout(3_000);

  // MutationObserver installed BEFORE Box B is created
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__styleLog = [];
    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'style') {
          const el = m.target as HTMLElement;
          (window as unknown as { __styleLog: Array<Record<string, string>> }).__styleLog.push({
            builderId: el.getAttribute('data-builder-id') ?? '(no id)',
            style:     el.getAttribute('style') ?? '',
          });
        }
      }
    });
    obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });
    (window as unknown as Record<string, unknown>).__obs = obs;
  });

  // Drop Box B at the TOP (before Box A in the layout)
  const boxBId = await dropBoxFromPanel(page, 'top');
  await page.waitForTimeout(600);

  // Collect all diagnostic data in one evaluate call
  const diag = await page.evaluate(({ bBId, bAId }) => {
    const obs = (window as unknown as { __obs?: MutationObserver }).__obs;
    if (obs) obs.disconnect();
    const log = (window as unknown as { __styleLog?: Array<Record<string, string>> }).__styleLog ?? [];

    const store = (window as unknown as { __builderStore: { getState: () => { pageNodes: StoreNode[] } } })
      .__builderStore.getState();

    // Find a node by ID anywhere in the tree
    function find(arr: StoreNode[], id: string): StoreNode | null {
      for (const n of arr) { if (n.id === id) return n; if (n.children) { const f = find(n.children, id); if (f) return f; } }
      return null;
    }
    // Find parent of a node
    function findParent(arr: StoreNode[], id: string, par: StoreNode | null): StoreNode | null | undefined {
      for (const n of arr) {
        if (n.id === id) return par;
        if (n.children) { const r = findParent(n.children, id, n); if (r !== undefined) return r; }
      }
      return undefined;
    }
    // Build ancestor chain as string
    function ancestry(arr: StoreNode[], id: string): string {
      const parts: string[] = [];
      let current: string | undefined = id;
      while (current) {
        const par = findParent(arr, current, null);
        if (par === undefined || par === null) break;
        parts.push(`${par.type}(${par.id?.slice(0, 8)})`);
        current = par.id;
      }
      return parts.length ? parts.join(' → ') : 'root';
    }

    const bBNode = find(store.pageNodes, bBId);
    const bBEl   = document.querySelector(`[data-builder-id="${bBId}"]`) as HTMLElement | null;
    const bBParentNode = findParent(store.pageNodes, bBId, null);
    const rootIds = store.pageNodes.map(n => `${n.type}(${n.id?.slice(0, 8)})`);

    return {
      log,
      boxBClass:    bBNode?.props?.className ?? '',
      boxBStyleObj: bBNode?.props?.style ?? {},
      boxBDomBg:    bBEl ? window.getComputedStyle(bBEl).backgroundColor : 'NOT_FOUND',
      boxBInline:   bBEl?.getAttribute('style') ?? '',
      boxBParentId: (bBParentNode as StoreNode | null)?.id ?? null,
      boxBParentType: (bBParentNode as StoreNode | null)?.type ?? 'root',
      boxBAncestry: ancestry(store.pageNodes, bBId),
      rootOrder:    rootIds,
      isChildOfBoxA: (bBParentNode as StoreNode | null)?.id === bAId,
    };
  }, { bBId: boxBId, bAId: boxAId });

  const boxBWrites = diag.log.filter((e: Record<string, string>) => e.builderId === boxBId);

  console.log('\n=== CB-03 Diagnostic (Box B dropped at TOP) ===');
  console.log('Box A ID:', boxAId);
  console.log('Box B ID:', boxBId);
  console.log('Root node order:', diag.rootOrder.join(', '));
  console.log('Box B ancestry (parent → grandparent…):', diag.boxBAncestry);
  console.log('Box B is child of Box A:', diag.isChildOfBoxA);
  console.log('');
  console.log('Total style mutations observed:', diag.log.length);
  console.log('Style writes on Box B DOM element:', JSON.stringify(boxBWrites, null, 2));
  console.log('');
  console.log('Box B computed background-color:', diag.boxBDomBg);
  console.log('Box B DOM inline style attr:', diag.boxBInline);
  console.log('Box B JSON className:', diag.boxBClass);
  console.log('Box B JSON style:', JSON.stringify(diag.boxBStyleObj));

  if (diag.isChildOfBoxA) {
    console.log('\n>>> ROOT CAUSE: Box B landed INSIDE Box A (child), not at root.');
    console.log('    The blue parent bg shows through Box B\'s transparent background.');
    console.log('    Fix: improve drop target so user can insert at root level.');
  } else if (boxBWrites.length > 0) {
    console.log('\n>>> ROOT CAUSE: Direct inline style writes on Box B:');
    boxBWrites.forEach((w: Record<string, string>, i: number) => console.log(`  [${i}] "${w.style}"`));
  } else {
    console.log('\n>>> Box B is at root level AND has no style writes.');
    console.log('    Visual blue must be from DOM overlap / z-index of Box A.');
  }

  // Diagnostic always passes
  expect(boxBId).not.toBe(boxAId);
});

/**
 * CB-04  Verifies the parent relationship explicitly:
 *        Box B dropped at the TOP should be at ROOT level (no parent),
 *        not a child of Box A.
 */
test('CB-04: Box B dropped at top of canvas is at root level, not inside Box A', async ({ page }) => {
  await gotoBuilder(page);

  const boxAId = await dropBoxFromPanel(page, 'center');
  await selectNodeByIndex(page, 0);

  const bgSwatch = page.locator('[data-testid="input-bg-color-swatch"]');
  if (await bgSwatch.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await bgSwatch.click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="input-bg-color"]').fill('1d4ed8');
    await page.locator('[data-testid="input-bg-color"]').press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(3_000);

  const boxBId = await dropBoxFromPanel(page, 'top');
  await page.waitForTimeout(500);

  const parent = await getParentNode(page, boxBId);

  console.log('CB-04: Box B parent:', parent ? `${parent.type}(${parent.id?.slice(0, 8)})` : 'null (root)');

  expect(
    parent,
    'Box B should be at ROOT level (null parent) when dropped at top of canvas. ' +
    `Actual parent: ${parent ? `${parent.type}(${parent.id})` : 'null'}`
  ).toBeNull();
});
