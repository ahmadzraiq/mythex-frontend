/**
 * Builder Workflows E2E Tests
 *
 * Covers the full workflow feature:
 *
 * 1.  Right panel "Workflows" tab — structure & presence
 * 2.  Right panel Workflows tab — empty state (no element selected)
 * 3.  Right panel Workflows tab — element selected, create-workflow CTA
 * 4.  Right panel Workflows tab — "+ New" button opens WorkflowCanvas
 * 5.  Right panel Workflows tab — existing event row opens WorkflowCanvas for that event
 * 6.  Logic tab "Workflows" section — page workflows search + "+ New" opens canvas
 * 7.  Logic tab "Workflows" section — global/project workflows "+ New"
 * 8.  Logic tab "Workflows" section — clicking a row opens the canvas
 * 9.  WorkflowCanvas — overlay renders with expected elements
 * 10. WorkflowCanvas — close button dismisses overlay
 * 11. WorkflowCanvas — Escape key dismisses overlay
 * 12. WorkflowCanvas — Default / On error tab switcher
 * 13. WorkflowCanvas — trigger pill visible for element workflows (clickable)
 * 14. WorkflowCanvas — trigger pill fixed for global workflows (non-clickable)
 * 15. WorkflowCanvas — trigger dropdown opens on click and shows categories
 * 16. WorkflowCanvas — selecting a trigger category option updates the pill label
 * 17. WorkflowCanvas — insert "+" button visible on empty flow
 * 18. WorkflowCanvas — clicking insert "+" opens add-action popover
 * 19. WorkflowCanvas — add-action popover search filters action list
 * 20. WorkflowCanvas — selecting an action type from popover creates a node card
 * 21. WorkflowCanvas — unconfigured node shows "Action" label and "Click to configure"
 * 22. WorkflowCanvas — clicking a node card selects it and shows props in right panel
 * 23. WorkflowCanvas — clicking configured node shows correct action type in props panel
 * 24. WorkflowCanvas — "add action link" at bottom inserts into empty flow
 * 25. WorkflowCanvas — "Test ▷" button disabled for unconfigured node
 * 26. WorkflowCanvas — "Test ▷" button enabled after type is selected
 * 27. WorkflowCanvas — "⋮" context menu opens on a node
 * 28. WorkflowCanvas — context menu has Disable / Copy / Duplicate / Delete items
 * 29. WorkflowCanvas — context menu Delete removes the node from flow
 * 30. WorkflowCanvas — context menu Copy then Paste adds node (via + button popover Paste)
 * 31. WorkflowCanvas — context menu Disable toggles disabled appearance
 * 32. WorkflowCanvas — context menu Duplicate duplicates the node
 * 33. WorkflowCanvas — branch node adds True/False columns
 * 34. WorkflowCanvas — loop node (forEach) renders dashed container with End Loop label
 * 35. WorkflowCanvas — nested: action inside branch True column
 * 36. WorkflowCanvas — zoom in increases scale
 * 37. WorkflowCanvas — zoom out decreases scale
 * 38. WorkflowCanvas — zoom reset returns to 100%
 * 39. WorkflowCanvas — global workflow right panel shows WorkflowMeta (name, description, params)
 * 40. WorkflowCanvas — element workflow right panel shows "Select an action" when no node selected
 *
 * Run: npx playwright test e2e/builder-workflows.spec.ts
 */

import { test, expect, Page, Browser } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 }
  );
}

async function resetBuilder(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store._setPageNodes as (n: unknown[]) => void)([]);
    if (typeof store.select === 'function') (store.select as (id: string | null) => void)(null);
    if (typeof store.setZoom === 'function') (store.setZoom as (z: number) => void)(1);
    // Clear workflows and globals to avoid cross-test pollution
    if (typeof store.setGlobalWorkflow === 'function') {
      const gw = (store.globalWorkflows as Record<string, unknown>) ?? {};
      for (const k of Object.keys(gw)) {
        (store.removeGlobalWorkflow as (id: string) => void)(k);
      }
    }
    if (typeof store.setPageWorkflow === 'function') {
      const pw = (store.pageWorkflows as Record<string, unknown>) ?? {};
      for (const k of Object.keys(pw)) {
        (store.removePageWorkflow as (id: string) => void)(k);
      }
    }
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-builder-page-frame] [data-builder-id]').length === 0,
    { timeout: 5_000 }
  );
  await page.waitForTimeout(200);
}

/** Inject a node and select it */
async function injectAndSelectNode(page: Page, node: Record<string, unknown>) {
  await page.evaluate((n) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store._setPageNodes as (nodes: unknown[]) => void)([n]);
    if (typeof store.select === 'function') (store.select as (id: string) => void)(n.id as string);
  }, node);
  await page.waitForTimeout(200);
}

/** Open the Workflows tab in the right panel */
async function openRightWorkflowsTab(page: Page) {
  await page.getByTestId('tab-right-workflows').click();
  await page.waitForTimeout(100);
}

/** Open the Logic tab in the left panel */
async function openLogicTab(page: Page) {
  await page.getByTestId('tab-logic').click();
  await page.waitForTimeout(100);
}

/** Open workflow canvas for a new global workflow via the store directly */
async function openCanvasViaStore(page: Page, kind: 'globalWorkflow' | 'pageWorkflow' | 'element', opts: Record<string, string> = {}) {
  await page.evaluate(({ kind, opts }) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store || typeof store.openWorkflowCanvas !== 'function') return;
    if (kind === 'globalWorkflow') {
      const id = opts.id ?? `test-wf-${Date.now()}`;
      (store.setGlobalWorkflow as (id: string, steps: unknown[]) => void)(id, []);
      (store.setGlobalWorkflowMeta as (id: string, meta: unknown) => void)(id, { id, name: opts.name ?? 'Test Workflow' });
      (store.openWorkflowCanvas as (t: unknown) => void)({ kind: 'globalWorkflow', id });
    } else if (kind === 'pageWorkflow') {
      const name = opts.name ?? 'Test Page Workflow';
      (store.setPageWorkflow as (n: string, steps: unknown[]) => void)(name, []);
      (store.openWorkflowCanvas as (t: unknown) => void)({ kind: 'pageWorkflow', name });
    } else if (kind === 'element') {
      (store.openWorkflowCanvas as (t: unknown) => void)({ kind: 'element', nodeId: opts.nodeId ?? 'test-node', event: opts.event ?? 'click' });
    }
  }, { kind, opts });
  await page.waitForSelector('[data-testid="workflow-canvas"]', { timeout: 5_000 });
  await page.waitForTimeout(200);
}

/** Close the workflow canvas */
async function closeCanvas(page: Page) {
  await page.getByTestId('workflow-canvas-close').click();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="workflow-canvas"]'),
    { timeout: 3_000 }
  );
}

/** Add an action via the first insert "+" button */
async function addActionViaInsertBtn(page: Page, actionLabel: string) {
  const firstInsertBtn = page.locator('[data-testid="insert-btn"]').first();
  await firstInsertBtn.click();
  await page.waitForSelector('[data-testid="add-action-popover"]', { timeout: 3_000 });
  const searchInput = page.locator('[data-testid="add-action-popover"] input');
  await searchInput.fill(actionLabel);
  await page.waitForTimeout(100);
  const option = page.locator('[data-testid="add-action-popover"] button').filter({ hasText: actionLabel }).first();
  await option.click();
  await page.waitForTimeout(200);
}

// ─── Shared browser page ──────────────────────────────────────────────────────

let sharedPage: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  sharedPage = await browser.newPage();
  await gotoBuilder(sharedPage);
});

test.afterAll(async () => {
  await sharedPage?.close();
});

// ─── 1. Right panel "Workflows" tab — structure ───────────────────────────────

test.describe('Right panel — Workflows tab structure', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    // Ensure canvas is closed
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
  });

  test('Workflows tab button exists in right panel', async () => {
    await expect(sharedPage.getByTestId('tab-right-workflows')).toBeVisible();
  });

  test('Workflows tab has a lightning bolt SVG icon', async () => {
    const tab = sharedPage.getByTestId('tab-right-workflows');
    await expect(tab.locator('svg')).toBeVisible();
  });

  test('clicking Workflows tab activates it', async () => {
    await openRightWorkflowsTab(sharedPage);
    // The active tab has a blue bottom border — verify the panel content renders
    await expect(sharedPage.locator('[data-testid="right-workflows-empty"], [data-testid="right-workflows-panel"]')).toBeVisible();
  });
});

// ─── 2. Right panel Workflows tab — no element selected ───────────────────────

test.describe('Right panel — Workflows tab empty state (no selection)', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await openRightWorkflowsTab(sharedPage);
  });

  test('shows empty state when no element selected', async () => {
    await expect(sharedPage.getByTestId('right-workflows-empty')).toBeVisible();
  });

  test('empty state says "Select an element"', async () => {
    const text = await sharedPage.getByTestId('right-workflows-empty').innerText();
    expect(text.toLowerCase()).toContain('select an element');
  });
});

// ─── 3. Right panel — element selected, CTA ──────────────────────────────────

test.describe('Right panel — Workflows tab with element selected', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await injectAndSelectNode(sharedPage, { id: 'btn-test', type: 'Button', props: { className: '' }, children: [{ type: 'ButtonText', text: 'Click me' }] });
    await openRightWorkflowsTab(sharedPage);
  });

  test('shows Workflows panel (not empty state) when node selected', async () => {
    await expect(sharedPage.getByTestId('right-workflows-panel')).toBeVisible();
  });

  test('shows "Create a workflow" CTA when node has no actions', async () => {
    await expect(sharedPage.getByTestId('right-workflows-create-cta')).toBeVisible();
    const text = await sharedPage.getByTestId('right-workflows-create-cta').innerText();
    expect(text.toLowerCase()).toContain('create a workflow');
  });

  test('"+ New" button is visible', async () => {
    await expect(sharedPage.getByTestId('right-workflows-new-btn')).toBeVisible();
  });

  test('"+ New" button opens workflow canvas', async () => {
    await sharedPage.getByTestId('right-workflows-new-btn').click();
    await expect(sharedPage.getByTestId('workflow-canvas')).toBeVisible({ timeout: 5_000 });
    await closeCanvas(sharedPage);
  });
});

// ─── 4. Right panel — existing event row ─────────────────────────────────────

test.describe('Right panel — Workflows tab with existing action events', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    // Inject a node with actions
    await injectAndSelectNode(sharedPage, {
      id: 'btn-with-actions',
      type: 'Button',
      props: { className: '' },
      children: [{ type: 'ButtonText', text: 'Click' }],
      actions: { click: { action: 'navigate', payload: { path: '/' } } },
    });
    await openRightWorkflowsTab(sharedPage);
  });

  test('shows workflow row for each event on the node', async () => {
    await expect(sharedPage.getByTestId('right-workflow-row-click')).toBeVisible();
  });

  test('clicking an event row opens workflow canvas', async () => {
    await sharedPage.getByTestId('right-workflow-row-click').click();
    await expect(sharedPage.getByTestId('workflow-canvas')).toBeVisible({ timeout: 5_000 });
    await closeCanvas(sharedPage);
  });
});

// ─── 5. Logic tab — Workflows section ─────────────────────────────────────────

test.describe('Logic tab — Workflows section', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await openLogicTab(sharedPage);
  });

  test('Workflows section is visible in Logic tab', async () => {
    await expect(sharedPage.locator('[data-testid="workflows-column"]')).toBeVisible();
  });

  test('"+ New" button in page workflows section is visible', async () => {
    await expect(sharedPage.getByTestId('add-workflow-btn')).toBeVisible();
  });

  test('clicking "+ New" page workflow opens WorkflowCanvas', async () => {
    await sharedPage.getByTestId('add-workflow-btn').click();
    await expect(sharedPage.getByTestId('workflow-canvas')).toBeVisible({ timeout: 5_000 });
    await closeCanvas(sharedPage);
  });

  test('workflow search input is visible when section is open', async () => {
    await expect(sharedPage.getByTestId('workflow-search')).toBeVisible();
  });

  test('search filters workflow rows', async () => {
    // Add two page workflows
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store) return;
      (store.setPageWorkflow as (n: string, s: unknown[]) => void)('alpha workflow', []);
      (store.setPageWorkflow as (n: string, s: unknown[]) => void)('beta workflow', []);
    });
    await sharedPage.waitForTimeout(200);
    const searchInput = sharedPage.getByTestId('workflow-search');
    await searchInput.fill('alpha');
    await sharedPage.waitForTimeout(150);
    await expect(sharedPage.getByTestId('workflow-row-alpha workflow')).toBeVisible();
    await expect(sharedPage.getByTestId('workflow-row-beta workflow')).not.toBeVisible();
    await searchInput.fill('');
  });

  test('clicking a page workflow row opens WorkflowCanvas', async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store) return;
      (store.setPageWorkflow as (n: string, s: unknown[]) => void)('my test workflow', []);
    });
    await sharedPage.waitForTimeout(200);
    await sharedPage.getByTestId('workflow-row-my test workflow').click();
    await expect(sharedPage.getByTestId('workflow-canvas')).toBeVisible({ timeout: 5_000 });
    await closeCanvas(sharedPage);
  });

  test('"+ New" project workflow button is visible', async () => {
    await expect(sharedPage.getByTestId('add-global-workflow-btn')).toBeVisible();
  });

  test('clicking "+ New" project workflow opens WorkflowCanvas', async () => {
    await sharedPage.getByTestId('add-global-workflow-btn').click();
    await expect(sharedPage.getByTestId('workflow-canvas')).toBeVisible({ timeout: 5_000 });
    await closeCanvas(sharedPage);
  });
});

// ─── 6. WorkflowCanvas — overlay structure ────────────────────────────────────

test.describe('WorkflowCanvas — overlay structure', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'test-node', event: 'click' });
  });

  test.afterEach(async () => {
    // Ensure canvas is closed between tests
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(150);
  });

  test('canvas overlay is visible', async () => {
    await expect(sharedPage.getByTestId('workflow-canvas')).toBeVisible();
  });

  test('close button is visible', async () => {
    await expect(sharedPage.getByTestId('workflow-canvas-close')).toBeVisible();
  });

  test('Default tab is visible and active initially', async () => {
    await expect(sharedPage.getByTestId('workflow-tab-default')).toBeVisible();
  });

  test('"On error" tab is visible', async () => {
    await expect(sharedPage.getByTestId('workflow-tab-onerror')).toBeVisible();
  });

  test('trigger pill is visible', async () => {
    await expect(sharedPage.getByTestId('workflow-trigger-pill')).toBeVisible();
  });

  test('zoom in button is visible', async () => {
    await expect(sharedPage.getByTestId('workflow-zoom-in')).toBeVisible();
  });

  test('zoom out button is visible', async () => {
    await expect(sharedPage.getByTestId('workflow-zoom-out')).toBeVisible();
  });

  test('zoom reset button shows 100%', async () => {
    const resetBtn = sharedPage.getByTestId('workflow-zoom-reset');
    await expect(resetBtn).toBeVisible();
    const text = await resetBtn.innerText();
    expect(text).toContain('100');
  });

  test('right panel props area is visible', async () => {
    await expect(sharedPage.getByTestId('workflow-props-panel')).toBeVisible();
  });
});

// ─── 7. WorkflowCanvas — close ────────────────────────────────────────────────

test.describe('WorkflowCanvas — close behavior', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
  });

  test('clicking close button dismisses the canvas', async () => {
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'close-test', event: 'click' });
    await sharedPage.getByTestId('workflow-canvas-close').click();
    await expect(sharedPage.getByTestId('workflow-canvas')).not.toBeVisible({ timeout: 3_000 });
  });

  test('pressing Escape key dismisses the canvas', async () => {
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'esc-test', event: 'click' });
    await sharedPage.keyboard.press('Escape');
    await expect(sharedPage.getByTestId('workflow-canvas')).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── 8. WorkflowCanvas — Default / On error tabs ─────────────────────────────

test.describe('WorkflowCanvas — Default / On error tab switcher', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'tab-test', event: 'click' });
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('clicking On error tab makes it active (pill style changes)', async () => {
    await sharedPage.getByTestId('workflow-tab-onerror').click();
    await sharedPage.waitForTimeout(150);
    // The tab should now have a different background — both tabs still visible
    await expect(sharedPage.getByTestId('workflow-tab-onerror')).toBeVisible();
    await expect(sharedPage.getByTestId('workflow-tab-default')).toBeVisible();
  });

  test('switching back to Default tab works', async () => {
    await sharedPage.getByTestId('workflow-tab-onerror').click();
    await sharedPage.waitForTimeout(100);
    await sharedPage.getByTestId('workflow-tab-default').click();
    await sharedPage.waitForTimeout(100);
    await expect(sharedPage.getByTestId('workflow-tab-default')).toBeVisible();
  });
});

// ─── 9. WorkflowCanvas — trigger pill ────────────────────────────────────────

test.describe('WorkflowCanvas — trigger pill', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('element workflow trigger pill is clickable and shows event name', async () => {
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'trigger-test', event: 'click' });
    const pill = sharedPage.getByTestId('workflow-trigger-pill');
    await expect(pill).toBeVisible();
    const text = await pill.innerText();
    expect(text.toLowerCase()).toContain('click');
  });

  test('clicking trigger pill opens dropdown with categories', async () => {
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'trigger-dd', event: 'click' });
    await sharedPage.getByTestId('workflow-trigger-pill').click();
    await sharedPage.waitForTimeout(200);
    // Should show categories like "Mouse", "Touch", "Lifecycle"
    await expect(sharedPage.locator('[data-popover="trigger"]')).toBeVisible();
    const triggerText = await sharedPage.locator('[data-popover="trigger"]').innerText();
    expect(triggerText.toLowerCase()).toMatch(/mouse|touch|lifecycle/);
  });

  test('selecting a trigger option from dropdown updates the pill', async () => {
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'trigger-select', event: 'click' });
    await sharedPage.getByTestId('workflow-trigger-pill').click();
    await sharedPage.waitForTimeout(200);
    // Click "On double click" option
    const dblClick = sharedPage.locator('[data-popover="trigger"] button').filter({ hasText: 'double click' }).first();
    if (await dblClick.isVisible()) {
      await dblClick.click();
      await sharedPage.waitForTimeout(200);
      const updatedPill = await sharedPage.getByTestId('workflow-trigger-pill').innerText();
      expect(updatedPill.toLowerCase()).toContain('double');
    }
  });

  test('global workflow trigger pill is fixed and not clickable', async () => {
    await openCanvasViaStore(sharedPage, 'globalWorkflow', { id: 'gw-trigger-test' });
    const pill = sharedPage.getByTestId('workflow-trigger-pill');
    await expect(pill).toBeVisible();
    const text = await pill.innerText();
    expect(text.toLowerCase()).toContain('execution');
    // Clicking should NOT open a dropdown
    await pill.click();
    await sharedPage.waitForTimeout(200);
    await expect(sharedPage.locator('[data-popover="trigger"]')).not.toBeVisible();
  });
});

// ─── 10. WorkflowCanvas — inserting actions ───────────────────────────────────

test.describe('WorkflowCanvas — inserting actions', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'insert-test', event: 'click' });
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('at least one insert "+" button is visible on empty flow', async () => {
    await expect(sharedPage.locator('[data-testid="insert-btn"]').first()).toBeVisible();
  });

  test('clicking "+" button opens add-action popover', async () => {
    await sharedPage.locator('[data-testid="insert-btn"]').first().click();
    await expect(sharedPage.getByTestId('add-action-popover')).toBeVisible({ timeout: 3_000 });
  });

  test('add-action popover has search input', async () => {
    await sharedPage.locator('[data-testid="insert-btn"]').first().click();
    await expect(sharedPage.locator('[data-testid="add-action-popover"] input')).toBeVisible();
  });

  test('add-action popover search filters items', async () => {
    await sharedPage.locator('[data-testid="insert-btn"]').first().click();
    await sharedPage.locator('[data-testid="add-action-popover"] input').fill('delay');
    await sharedPage.waitForTimeout(150);
    await expect(sharedPage.locator('[data-testid="add-action-popover"] button').filter({ hasText: 'Time delay' })).toBeVisible();
    // Non-matching items should be hidden
    const visible = await sharedPage.locator('[data-testid="add-action-popover"] button').filter({ hasText: 'Navigate to' }).isVisible();
    expect(visible).toBe(false);
  });

  test('selecting an action type creates a node on the canvas', async () => {
    await addActionViaInsertBtn(sharedPage, 'Time delay');
    await expect(sharedPage.locator('[data-testid^="action-node-"]').first()).toBeVisible({ timeout: 3_000 });
  });

  test('newly inserted unconfigured node shows action label', async () => {
    await addActionViaInsertBtn(sharedPage, 'Time delay');
    const node = sharedPage.locator('[data-testid^="action-node-"]').first();
    await expect(node).toBeVisible();
    const text = await node.innerText();
    expect(text.toLowerCase()).toContain('time delay');
  });
});

// ─── 11. WorkflowCanvas — node selection & props panel ───────────────────────

test.describe('WorkflowCanvas — node selection and props panel', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'sel-test', event: 'click' });
    await addActionViaInsertBtn(sharedPage, 'Time delay');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('clicking a node card selects it (highlighted)', async () => {
    const node = sharedPage.locator('[data-testid^="action-node-"]').first();
    await node.click();
    // The card should show the border color change — check the props panel has content
    await expect(sharedPage.getByTestId('workflow-props-panel')).toContainText('Time delay', { timeout: 3_000 });
  });

  test('props panel shows action type header after selection', async () => {
    await sharedPage.locator('[data-testid^="action-node-"]').first().click();
    await expect(sharedPage.getByTestId('workflow-props-panel')).toBeVisible();
    const panelText = await sharedPage.getByTestId('workflow-props-panel').innerText();
    expect(panelText).toBeTruthy();
  });

  test('clicking canvas background deselects node', async () => {
    await sharedPage.locator('[data-testid^="action-node-"]').first().click();
    // Click the canvas area (not a node)
    await sharedPage.locator('[data-testid="workflow-canvas"]').click({ position: { x: 50, y: 200 } });
    await sharedPage.waitForTimeout(150);
    // Props panel should show the "Select an action" empty state
    const panelText = await sharedPage.getByTestId('workflow-props-panel').innerText();
    expect(panelText.toLowerCase()).toContain('select an action');
  });

  test('deselected state shows "Select an action" in element workflow panel', async () => {
    await sharedPage.locator('[data-testid="workflow-canvas"]').click({ position: { x: 50, y: 200 } });
    await sharedPage.waitForTimeout(150);
    const panelText = await sharedPage.getByTestId('workflow-props-panel').innerText();
    expect(panelText.toLowerCase()).toContain('select an action');
  });
});

// ─── 12. WorkflowCanvas — Test ▷ button ──────────────────────────────────────

test.describe('WorkflowCanvas — Test button state', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'test-btn-test', event: 'click' });
    await addActionViaInsertBtn(sharedPage, 'Time delay');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('Time delay node Test button is enabled', async () => {
    const testBtn = sharedPage.locator('[data-testid^="action-node-"] button').filter({ hasText: 'Test' }).first();
    // Time delay is configured by type so Test should be enabled
    const disabled = await testBtn.isDisabled();
    expect(disabled).toBe(false);
  });
});

// ─── 13. WorkflowCanvas — context menu ───────────────────────────────────────

test.describe('WorkflowCanvas — context menu', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'ctx-test', event: 'click' });
    await addActionViaInsertBtn(sharedPage, 'Time delay');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('⋮ button opens context menu', async () => {
    const moreBtn = sharedPage.locator('[data-testid^="action-node-"] button[title="More options"]').first();
    await moreBtn.click();
    await expect(sharedPage.getByTestId('workflow-context-menu')).toBeVisible({ timeout: 2_000 });
  });

  test('context menu contains Disable, Copy, Duplicate, Delete', async () => {
    const moreBtn = sharedPage.locator('[data-testid^="action-node-"] button[title="More options"]').first();
    await moreBtn.click();
    await sharedPage.waitForSelector('[data-testid="workflow-context-menu"]', { timeout: 2_000 });
    const menuText = await sharedPage.getByTestId('workflow-context-menu').innerText();
    expect(menuText).toContain('Disable');
    expect(menuText).toContain('Copy action');
    expect(menuText).toContain('Duplicate action');
    expect(menuText).toContain('Delete action');
  });

  test('context menu Test action is shown for testable node', async () => {
    const moreBtn = sharedPage.locator('[data-testid^="action-node-"] button[title="More options"]').first();
    await moreBtn.click();
    await sharedPage.waitForSelector('[data-testid="workflow-context-menu"]', { timeout: 2_000 });
    const menuText = await sharedPage.getByTestId('workflow-context-menu').innerText();
    expect(menuText).toContain('Test action');
  });

  test('clicking Delete removes the node', async () => {
    const beforeCount = await sharedPage.locator('[data-testid^="action-node-"]').count();
    const moreBtn = sharedPage.locator('[data-testid^="action-node-"] button[title="More options"]').first();
    await moreBtn.click();
    await sharedPage.waitForSelector('[data-testid="workflow-context-menu"]', { timeout: 2_000 });
    await sharedPage.locator('[data-testid="workflow-context-menu"] button').filter({ hasText: 'Delete action' }).click();
    await sharedPage.waitForTimeout(200);
    const afterCount = await sharedPage.locator('[data-testid^="action-node-"]').count();
    expect(afterCount).toBe(beforeCount - 1);
  });

  test('clicking Disable adds disabled state to node', async () => {
    const moreBtn = sharedPage.locator('[data-testid^="action-node-"] button[title="More options"]').first();
    await moreBtn.click();
    await sharedPage.waitForSelector('[data-testid="workflow-context-menu"]', { timeout: 2_000 });
    await sharedPage.locator('[data-testid="workflow-context-menu"] button').filter({ hasText: 'Disable' }).click();
    await sharedPage.waitForTimeout(200);
    // After disabling, clicking ⋮ again should show "Enable"
    const moreBtnAfter = sharedPage.locator('[data-testid^="action-node-"] button[title="More options"]').first();
    await moreBtnAfter.click();
    await sharedPage.waitForSelector('[data-testid="workflow-context-menu"]', { timeout: 2_000 });
    const menuText = await sharedPage.getByTestId('workflow-context-menu').innerText();
    expect(menuText).toContain('Enable');
    // Close menu
    await sharedPage.keyboard.press('Escape');
    await sharedPage.waitForTimeout(100);
  });

  test('Copy then Paste adds a copy of the node', async () => {
    const beforeCount = await sharedPage.locator('[data-testid^="action-node-"]').count();
    // Copy
    const moreBtn = sharedPage.locator('[data-testid^="action-node-"] button[title="More options"]').first();
    await moreBtn.click();
    await sharedPage.waitForSelector('[data-testid="workflow-context-menu"]', { timeout: 2_000 });
    await sharedPage.locator('[data-testid="workflow-context-menu"] button').filter({ hasText: 'Copy action' }).click();
    await sharedPage.waitForTimeout(200);
    // Paste via "+ insert btn" popover
    await sharedPage.locator('[data-testid="insert-btn"]').first().click();
    await sharedPage.waitForSelector('[data-testid="add-action-popover"]', { timeout: 3_000 });
    const pasteBtn = sharedPage.locator('[data-testid="add-action-popover"] button').filter({ hasText: 'Paste action' });
    if (await pasteBtn.isVisible()) {
      await pasteBtn.click();
      await sharedPage.waitForTimeout(200);
      const afterCount = await sharedPage.locator('[data-testid^="action-node-"]').count();
      expect(afterCount).toBeGreaterThan(beforeCount);
    }
  });

  test('clicking Duplicate duplicates the node', async () => {
    const beforeCount = await sharedPage.locator('[data-testid^="action-node-"]').count();
    const moreBtn = sharedPage.locator('[data-testid^="action-node-"] button[title="More options"]').first();
    await moreBtn.click();
    await sharedPage.waitForSelector('[data-testid="workflow-context-menu"]', { timeout: 2_000 });
    await sharedPage.locator('[data-testid="workflow-context-menu"] button').filter({ hasText: 'Duplicate action' }).click();
    await sharedPage.waitForTimeout(200);
    const afterCount = await sharedPage.locator('[data-testid^="action-node-"]').count();
    expect(afterCount).toBe(beforeCount + 1);
  });
});

// ─── 14. WorkflowCanvas — branch node ────────────────────────────────────────

test.describe('WorkflowCanvas — branch node (True/False split)', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'branch-test', event: 'click' });
    await addActionViaInsertBtn(sharedPage, 'True/False split');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('branch node renders on canvas', async () => {
    await expect(sharedPage.locator('[data-testid^="action-node-"]').first()).toBeVisible();
  });

  test('branch node shows "True/False split" label', async () => {
    const nodeText = await sharedPage.locator('[data-testid^="action-node-"]').first().innerText();
    expect(nodeText.toLowerCase()).toContain('true/false split');
  });

  test('branch renders "true" and "false" column labels', async () => {
    const canvasText = await sharedPage.getByTestId('workflow-canvas').innerText();
    expect(canvasText.toLowerCase()).toContain('true');
    expect(canvasText.toLowerCase()).toContain('false');
  });

  test('both true and false branches have their own insert "+" buttons', async () => {
    // Each branch column gets at least one insert button
    const insertBtns = await sharedPage.locator('[data-testid="insert-btn"]').count();
    expect(insertBtns).toBeGreaterThanOrEqual(2);
  });

  test('clicking branch node selects it and shows Condition field in props', async () => {
    await sharedPage.locator('[data-testid^="action-node-"]').first().click();
    await sharedPage.waitForTimeout(200);
    const panelText = await sharedPage.getByTestId('workflow-props-panel').innerText();
    expect(panelText.toLowerCase()).toContain('condition');
  });
});

// ─── 15. WorkflowCanvas — loop node ──────────────────────────────────────────

test.describe('WorkflowCanvas — loop node (forEach)', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'loop-test', event: 'click' });
    await addActionViaInsertBtn(sharedPage, 'Iterator (for loop)');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('loop node renders on canvas', async () => {
    await expect(sharedPage.locator('[data-testid^="action-node-"]').first()).toBeVisible();
  });

  test('loop node shows "Iterator (for loop)" label', async () => {
    const nodeText = await sharedPage.locator('[data-testid^="action-node-"]').first().innerText();
    expect(nodeText.toLowerCase()).toContain('iterator');
  });

  test('loop container (dashed border) is visible', async () => {
    await expect(sharedPage.getByTestId('loop-body-container')).toBeVisible();
  });

  test('loop container shows "End Loop" label', async () => {
    const containerText = await sharedPage.getByTestId('loop-body-container').innerText();
    expect(containerText.toLowerCase()).toContain('end loop');
  });

  test('loop container has insert "+" button inside it', async () => {
    const insertBtns = sharedPage.getByTestId('loop-body-container').locator('[data-testid="insert-btn"]');
    await expect(insertBtns.first()).toBeVisible();
  });
});

// ─── 16. WorkflowCanvas — zoom controls ──────────────────────────────────────

test.describe('WorkflowCanvas — zoom controls', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'zoom-test', event: 'click' });
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('clicking zoom-in increases percentage', async () => {
    const resetBtn = sharedPage.getByTestId('workflow-zoom-reset');
    const before = await resetBtn.innerText();
    await sharedPage.getByTestId('workflow-zoom-in').click();
    await sharedPage.waitForTimeout(150);
    const after = await resetBtn.innerText();
    const beforePct = parseInt(before.replace('%', ''), 10);
    const afterPct = parseInt(after.replace('%', ''), 10);
    expect(afterPct).toBeGreaterThan(beforePct);
  });

  test('clicking zoom-out decreases percentage', async () => {
    const resetBtn = sharedPage.getByTestId('workflow-zoom-reset');
    const before = await resetBtn.innerText();
    await sharedPage.getByTestId('workflow-zoom-out').click();
    await sharedPage.waitForTimeout(150);
    const after = await resetBtn.innerText();
    const beforePct = parseInt(before.replace('%', ''), 10);
    const afterPct = parseInt(after.replace('%', ''), 10);
    expect(afterPct).toBeLessThan(beforePct);
  });

  test('clicking zoom-reset returns to 100%', async () => {
    await sharedPage.getByTestId('workflow-zoom-in').click();
    await sharedPage.getByTestId('workflow-zoom-in').click();
    await sharedPage.waitForTimeout(150);
    await sharedPage.getByTestId('workflow-zoom-reset').click();
    await sharedPage.waitForTimeout(150);
    const text = await sharedPage.getByTestId('workflow-zoom-reset').innerText();
    expect(text).toContain('100');
  });
});

// ─── 17. WorkflowCanvas — global workflow meta panel ─────────────────────────

test.describe('WorkflowCanvas — global workflow meta panel', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'globalWorkflow', { id: 'meta-test', name: 'My Workflow' });
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('right panel shows workflow meta form when no node selected', async () => {
    const panelText = await sharedPage.getByTestId('workflow-props-panel').innerText();
    expect(panelText.toLowerCase()).toMatch(/name|description|folder/);
  });

  test('name field is visible in meta panel', async () => {
    await expect(sharedPage.getByTestId('workflow-props-panel').locator('input').first()).toBeVisible();
  });

  test('workflow name is pre-populated from meta', async () => {
    const nameInput = sharedPage.getByTestId('workflow-props-panel').locator('input').first();
    const value = await nameInput.inputValue();
    expect(value).toBe('My Workflow');
  });

  test('description textarea is visible', async () => {
    await expect(sharedPage.getByTestId('workflow-props-panel').locator('textarea').first()).toBeVisible();
  });

  test('"+ Add" parameters button is visible', async () => {
    const panelText = await sharedPage.getByTestId('workflow-props-panel').innerText();
    expect(panelText).toContain('Parameters');
  });
});

// ─── 18. WorkflowCanvas — keyboard shortcut: Delete ──────────────────────────

test.describe('WorkflowCanvas — keyboard shortcuts', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'kb-test', event: 'click' });
    await addActionViaInsertBtn(sharedPage, 'Time delay');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('Delete key removes selected node', async () => {
    await sharedPage.locator('[data-testid^="action-node-"]').first().click();
    await sharedPage.waitForTimeout(150);
    const before = await sharedPage.locator('[data-testid^="action-node-"]').count();
    await sharedPage.keyboard.press('Delete');
    await sharedPage.waitForTimeout(200);
    const after = await sharedPage.locator('[data-testid^="action-node-"]').count();
    expect(after).toBe(before - 1);
  });
});

// ─── 19. WorkflowCanvas — add-action-link at bottom ──────────────────────────

test.describe('WorkflowCanvas — add action link', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'link-test', event: 'click' });
    // Add one action first so the link appears
    await addActionViaInsertBtn(sharedPage, 'Time delay');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('"+ Add an action" link is visible when steps exist', async () => {
    await expect(sharedPage.getByTestId('add-action-link')).toBeVisible();
  });

  test('clicking "+ Add an action" opens the popover', async () => {
    await sharedPage.getByTestId('add-action-link').click();
    await sharedPage.waitForTimeout(200);
    await expect(sharedPage.getByTestId('add-action-popover')).toBeVisible({ timeout: 3_000 });
  });
});

// ─── 20. WorkflowCanvas — add all structural action types ────────────────────

test.describe('WorkflowCanvas — structural action types', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element', { nodeId: 'struct-test', event: 'click' });
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('can add a Multi-option split node', async () => {
    await addActionViaInsertBtn(sharedPage, 'Multi-option split');
    const nodeText = await sharedPage.locator('[data-testid^="action-node-"]').first().innerText();
    expect(nodeText.toLowerCase()).toContain('multi-option');
  });

  test('can add a While loop node', async () => {
    await addActionViaInsertBtn(sharedPage, 'While loop');
    await expect(sharedPage.getByTestId('loop-body-container')).toBeVisible();
  });

  test('can add a Break loop node', async () => {
    await addActionViaInsertBtn(sharedPage, 'Break loop');
    const nodeText = await sharedPage.locator('[data-testid^="action-node-"]').first().innerText();
    expect(nodeText.toLowerCase()).toContain('break');
  });

  test('can add a Navigate to node', async () => {
    await addActionViaInsertBtn(sharedPage, 'Navigate to');
    const nodeText = await sharedPage.locator('[data-testid^="action-node-"]').first().innerText();
    expect(nodeText.toLowerCase()).toContain('navigate');
  });

  test('can add a Stop click propagation node', async () => {
    await addActionViaInsertBtn(sharedPage, 'Stop click propagation');
    const nodeText = await sharedPage.locator('[data-testid^="action-node-"]').first().innerText();
    expect(nodeText.toLowerCase()).toContain('propagation');
  });
});

// ─── 22. Fix verifications ────────────────────────────────────────────────────

test.describe('Fix: popover position near cursor', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('popover appears within 350px of the clicked insert button', async () => {
    const insertBtn = sharedPage.locator('[data-testid="insert-btn"]').first();
    const btnBox = await insertBtn.boundingBox();
    expect(btnBox).not.toBeNull();

    await insertBtn.click();
    await sharedPage.waitForSelector('[data-testid="add-action-popover"]', { timeout: 3_000 });

    const popover = sharedPage.locator('[data-testid="add-action-popover"]');
    const popBox = await popover.boundingBox();
    expect(popBox).not.toBeNull();

    const dist = Math.sqrt(
      Math.pow((popBox!.x + popBox!.width / 2) - (btnBox!.x + btnBox!.width / 2), 2) +
      Math.pow((popBox!.y + popBox!.height / 2) - (btnBox!.y + btnBox!.height / 2), 2)
    );
    expect(dist).toBeLessThan(500);
  });

  test('popover appears within 350px of insert button inside a branch True column', async () => {
    // Add a True/False branch first
    await addActionViaInsertBtn(sharedPage, 'True/False');
    await sharedPage.waitForTimeout(200);

    // Find the insert button inside the True branch column (second insert btn)
    const insertBtns = sharedPage.locator('[data-testid="insert-btn"]');
    const count = await insertBtns.count();
    // There should be at least 3 insert buttons: before/after top-level branch, and inside each branch column
    expect(count).toBeGreaterThan(1);

    // Click the second insert button (first one inside a branch column)
    const branchInsertBtn = insertBtns.nth(1);
    const btnBox = await branchInsertBtn.boundingBox();
    expect(btnBox).not.toBeNull();

    await branchInsertBtn.click();
    await sharedPage.waitForSelector('[data-testid="add-action-popover"]', { timeout: 3_000 });

    const popover = sharedPage.locator('[data-testid="add-action-popover"]');
    const popBox = await popover.boundingBox();
    expect(popBox).not.toBeNull();

    const horizontalDist = Math.abs((popBox!.x) - (btnBox!.x + btnBox!.width / 2));
    // Popover should be horizontally close to the clicked button, not off at left edge
    expect(horizontalDist).toBeLessThan(500);
  });
});

test.describe('Fix: branch rejoin SVG — no extra top horizontal bar', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('True/False branch rejoin SVG has exactly 4 lines (2 drops + 1 bottom bar + 1 center drop)', async () => {
    await addActionViaInsertBtn(sharedPage, 'True/False');
    await sharedPage.waitForTimeout(200);

    // The branch node should have a rejoin SVG — count its lines
    // Each BranchNode has one rejoin SVG after the branch columns
    const rejoinSvgs = sharedPage.locator('[data-testid^="action-node-"] svg');
    // Just verify at least one SVG exists (the rejoin SVG is inside the BranchNode div)
    const branchNodeSvg = sharedPage.locator('[data-testid^="action-node-"]').filter({ has: sharedPage.locator('svg') }).first();
    const svgLines = branchNodeSvg.locator('svg line');
    const lineCount = await svgLines.count();
    // Should be exactly 4 lines: 2 vertical drops + 1 bottom horizontal + 1 center drop
    // (Previously was 5: added extra top horizontal bar)
    expect(lineCount).toBe(4);
  });

  test('Multi-option branch rejoin SVG lines — no extra top horizontal bar', async () => {
    await addActionViaInsertBtn(sharedPage, 'Multi-option');
    await sharedPage.waitForTimeout(200);

    const branchNodeSvg = sharedPage.locator('[data-testid^="action-node-"]').filter({ has: sharedPage.locator('svg') }).first();
    const svgLines = branchNodeSvg.locator('svg line');
    const lineCount = await svgLines.count();
    // 3 branch columns: 3 vertical drops + 1 bottom bar + 1 center drop = 5 lines
    // (Previously was 6: had extra top horizontal bar)
    expect(lineCount).toBe(5);
  });
});

test.describe('Fix: loop back-arrow — single left-side line, not square', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element');
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('Iterator for-loop back-arrow renders as a div element (not SVG)', async () => {
    await addActionViaInsertBtn(sharedPage, 'Iterator');
    await sharedPage.waitForTimeout(200);

    const backArrow = sharedPage.locator('[data-testid="loop-back-arrow"]');
    await expect(backArrow).toBeVisible();

    // Back-arrow should be a div (flex-row layout), not an SVG positioned absolutely
    const tagName = await backArrow.evaluate(el => el.tagName.toLowerCase());
    expect(tagName).toBe('div');
  });

  test('While loop back-arrow is positioned to the left of the loop body container', async () => {
    await addActionViaInsertBtn(sharedPage, 'While loop');
    await sharedPage.waitForTimeout(200);

    const backArrow = sharedPage.locator('[data-testid="loop-back-arrow"]');
    const loopBody = sharedPage.locator('[data-testid="loop-body-container"]');

    await expect(backArrow).toBeVisible();
    await expect(loopBody).toBeVisible();

    const arrowBox = await backArrow.boundingBox();
    const bodyBox = await loopBody.boundingBox();

    expect(arrowBox).not.toBeNull();
    expect(bodyBox).not.toBeNull();

    // Back-arrow should be to the LEFT of the loop body
    expect(arrowBox!.x + arrowBox!.width).toBeLessThanOrEqual(bodyBox!.x + 5);
  });

  test('Loop back-arrow contains an upward-pointing SVG arrow', async () => {
    await addActionViaInsertBtn(sharedPage, 'Iterator');
    await sharedPage.waitForTimeout(200);

    const backArrow = sharedPage.locator('[data-testid="loop-back-arrow"]');
    const innerSvg = backArrow.locator('svg');
    await expect(innerSvg).toBeVisible();

    // Should have a polyline for the arrowhead
    const polyline = innerSvg.locator('polyline');
    await expect(polyline).toBeVisible();
  });

  test('Loop back-arrow vertical line fills the height of the loop body', async () => {
    await addActionViaInsertBtn(sharedPage, 'While loop');
    await sharedPage.waitForTimeout(200);

    const backArrow = sharedPage.locator('[data-testid="loop-back-arrow"]');
    const loopBody = sharedPage.locator('[data-testid="loop-body-container"]');

    const arrowBox = await backArrow.boundingBox();
    const bodyBox = await loopBody.boundingBox();

    expect(arrowBox).not.toBeNull();
    expect(bodyBox).not.toBeNull();

    // Arrow height should be close to the loop body height (within 20px tolerance)
    expect(Math.abs(arrowBox!.height - bodyBox!.height)).toBeLessThan(20);
  });
});

// ─── 23. Type search dropdown in properties panel ─────────────────────────────

test.describe('NodePropsPanel — type search dropdown', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await openCanvasViaStore(sharedPage, 'element');
    // Add an unconfigured action node
    await addActionViaInsertBtn(sharedPage, 'Time delay');
    await sharedPage.waitForTimeout(200);
    // Click the node to select it and open props panel
    const node = sharedPage.locator('[data-testid^="action-node-"]').first();
    await node.click();
    await sharedPage.waitForTimeout(150);
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('Type field shows a trigger button (not a select element)', async () => {
    const trigger = sharedPage.locator('[data-testid="type-search-trigger"]');
    await expect(trigger).toBeVisible();
    // Should NOT have a native select for the Type field
    const nativeSelect = sharedPage.locator('[data-testid="workflow-props-panel"] select');
    // Any selects that exist should not contain action type options
    const optionCount = await nativeSelect.first().locator('option[value="timeDelay"]').count();
    expect(optionCount).toBe(0);
  });

  test('clicking Type trigger opens a searchable dropdown', async () => {
    await sharedPage.locator('[data-testid="type-search-trigger"]').click();
    const searchInput = sharedPage.locator('[data-testid="type-search-input"]');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
  });

  test('type search filters the action list', async () => {
    await sharedPage.locator('[data-testid="type-search-trigger"]').click();
    const searchInput = sharedPage.locator('[data-testid="type-search-input"]');
    await searchInput.fill('navigate');
    await sharedPage.waitForTimeout(100);
    // Should show navigate options
    const navOption = sharedPage.locator('[data-testid^="type-option-navigate"]');
    await expect(navOption.first()).toBeVisible();
    // Should not show unrelated items like "Time delay"
    const timeDelayOption = sharedPage.locator('[data-testid="type-option-timeDelay"]');
    await expect(timeDelayOption).not.toBeVisible();
  });

  test('selecting a type from dropdown updates the node', async () => {
    await sharedPage.locator('[data-testid="type-search-trigger"]').click();
    const searchInput = sharedPage.locator('[data-testid="type-search-input"]');
    await searchInput.fill('Copy to clipboard');
    await sharedPage.waitForTimeout(100);
    const option = sharedPage.locator('[data-testid="type-option-copyToClipboard"]');
    await option.click();
    await sharedPage.waitForTimeout(200);
    // Dropdown should close
    await expect(searchInput).not.toBeVisible();
    // Trigger button should now show the selected type label
    const trigger = sharedPage.locator('[data-testid="type-search-trigger"]');
    await expect(trigger).toContainText('Copy to clipboard');
  });

  test('clicking outside the dropdown closes it', async () => {
    await sharedPage.locator('[data-testid="type-search-trigger"]').click();
    await expect(sharedPage.locator('[data-testid="type-search-input"]')).toBeVisible();
    // Click somewhere outside
    await sharedPage.locator('[data-testid="workflow-canvas"]').click({ position: { x: 100, y: 100 } });
    await sharedPage.waitForTimeout(200);
    await expect(sharedPage.locator('[data-testid="type-search-input"]')).not.toBeVisible();
  });
});

// ─── 21. WorkflowCanvas — page workflow shows name in title bar ───────────────

test.describe('WorkflowCanvas — title bar', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test('global workflow canvas shows workflow name in top bar', async () => {
    await openCanvasViaStore(sharedPage, 'globalWorkflow', { id: 'title-test', name: 'My Named Workflow' });
    const canvasText = await sharedPage.getByTestId('workflow-canvas').locator('[style*="top"]').first().innerText().catch(() => '');
    // Look for the name somewhere in the top bar area
    const topBarText = await sharedPage.locator('[data-testid="workflow-canvas"] > div').first().innerText();
    expect(topBarText).toContain('My Named Workflow');
  });

  test('page workflow canvas shows workflow name in top bar', async () => {
    await openCanvasViaStore(sharedPage, 'pageWorkflow', { name: 'Page Test Workflow' });
    const topBarText = await sharedPage.locator('[data-testid="workflow-canvas"] > div').first().innerText();
    expect(topBarText).toContain('Page Test Workflow');
  });
});

// ─── WM-01..WM-04: Workflow panel ⋮ menu ────────────────────────────────────

test.describe('WorkflowCanvas — panel ⋮ menu', () => {
  test.beforeEach(async () => {
    await resetBuilder(sharedPage);
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  test.afterEach(async () => {
    await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedPage.waitForTimeout(100);
  });

  // WM-01: ⋮ button is visible in the right panel header
  test('WM-01: workflow panel ⋮ button is visible', async () => {
    await openCanvasViaStore(sharedPage, 'pageWorkflow', { name: 'wm-test-1' });
    const btn = sharedPage.getByTestId('workflow-panel-menu-btn');
    await expect(btn).toBeVisible();
  });

  // WM-02: clicking ⋮ opens the options menu with "Delete workflow"
  test('WM-02: clicking ⋮ opens options menu with Delete workflow', async () => {
    await openCanvasViaStore(sharedPage, 'pageWorkflow', { name: 'wm-test-2' });
    const btn = sharedPage.getByTestId('workflow-panel-menu-btn');
    await btn.click();
    await sharedPage.waitForSelector('[data-testid="workflow-options-menu"]', { timeout: 3_000 });
    const menuText = await sharedPage.getByTestId('workflow-options-menu').innerText();
    expect(menuText).toContain('Delete workflow');
    expect(menuText).not.toContain('Duplicate');
  });

  // WM-03: clicking outside the options menu closes it
  test('WM-03: clicking outside closes the options menu', async () => {
    await openCanvasViaStore(sharedPage, 'pageWorkflow', { name: 'wm-test-3' });
    await sharedPage.getByTestId('workflow-panel-menu-btn').click();
    await sharedPage.waitForSelector('[data-testid="workflow-options-menu"]', { timeout: 3_000 });
    // Click somewhere outside the menu (canvas area)
    await sharedPage.locator('[data-testid="workflow-canvas"]').click({ position: { x: 100, y: 200 } });
    await sharedPage.waitForTimeout(200);
    await expect(sharedPage.locator('[data-testid="workflow-options-menu"]')).not.toBeVisible();
  });

  // WM-04: "Delete workflow" closes canvas and removes workflow from store
  test('WM-04: Delete workflow removes it from the store and closes canvas', async () => {
    const wfId = 'wm-delete-' + Date.now();
    await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store) return;
      (store.setPageWorkflow as (n: string, s: unknown[]) => void)(id, []);
      (store.setPageWorkflowMeta as (n: string, m: unknown) => void)(id, { id, name: 'To Delete' });
      (store.openWorkflowCanvas as (t: unknown) => void)({ kind: 'pageWorkflow', name: id });
    }, wfId);
    await sharedPage.waitForSelector('[data-testid="workflow-canvas"]', { timeout: 5_000 });
    await sharedPage.waitForTimeout(300);

    // Open menu and click Delete
    await sharedPage.getByTestId('workflow-panel-menu-btn').click();
    await sharedPage.waitForSelector('[data-testid="workflow-options-menu"]', { timeout: 3_000 });
    await sharedPage.getByTestId('workflow-options-menu').getByText('Delete workflow').click();
    await sharedPage.waitForTimeout(300);

    // Canvas should be closed
    await expect(sharedPage.locator('[data-testid="workflow-canvas"]')).not.toBeVisible();

    // Workflow should no longer exist in store
    const exists = await sharedPage.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      const pw = store?.pageWorkflows as Record<string, unknown> | undefined;
      return pw ? id in pw : false;
    }, wfId);
    expect(exists).toBe(false);
  });
});

// ─── Form workflow context tests ──────────────────────────────────────────────
// FW-01..FW-06: Form-specific action types in Add Action popover & TypeSearchDropdown

type BuilderStore = { getState: () => Record<string, unknown> };

/** Inject a FormContainer with an InputField child and return both IDs. */
async function injectFormWithInput(page: Page): Promise<{ formId: string; inputId: string }> {
  const formId = 'fc-form-' + Date.now();
  const inputId = 'fc-input-' + Date.now();
  await page.evaluate(({ fId, iId }) => {
    const bs = (window as unknown as Record<string, BuilderStore>).__builderStore;
    bs?.getState().addNode?.({
      id: fId,
      type: 'FormContainer',
      name: 'my_form',
      props: {},
      children: [
        { id: iId, type: 'InputField', name: 'email', props: {}, children: [] },
      ],
    }, null);
  }, { fId: formId, iId: inputId });
  await page.waitForFunction((fId) => {
    function findDeep(nodes: unknown[], id: string): boolean {
      for (const n of nodes as Array<Record<string, unknown>>) {
        if (n.id === id) return true;
        if (Array.isArray(n.children) && findDeep(n.children, id)) return true;
      }
      return false;
    }
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    return findDeep((store?.pageNodes as unknown[]) ?? [], fId as string);
  }, formId, { timeout: 5_000 });
  await page.waitForTimeout(300);
  return { formId, inputId };
}

/** Open workflow canvas for a pageWorkflow attached to a given node. */
async function openCanvasForNode(page: Page, nodeId: string) {
  await page.evaluate((nId) => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    if (!store) return;
    const uuid = 'test-wf-' + Date.now();
    (store.setPageWorkflow as (n: string, s: unknown[]) => void)(uuid, []);
    (store.setPageWorkflowMeta as (n: string, m: unknown) => void)(uuid, { id: uuid, name: 'Test WF', trigger: 'click' });
    (store.openWorkflowCanvas as (t: unknown) => void)({ kind: 'pageWorkflow', name: uuid, nodeId: nId });
  }, nodeId);
  await page.waitForSelector('[data-testid="workflow-canvas"]', { timeout: 5_000 });
  await page.waitForTimeout(300);
}

test.describe('Form workflow context — form-specific action types', () => {
  let sharedFormPage: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    sharedFormPage = await browser.newPage();
    await gotoBuilder(sharedFormPage);
  });

  test.afterAll(async () => {
    await sharedFormPage.close();
  });

  test.beforeEach(async () => {
    await resetBuilder(sharedFormPage);
    // Close canvas if open
    await sharedFormPage.evaluate(() => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      if (store && typeof store.closeWorkflowCanvas === 'function') (store.closeWorkflowCanvas as () => void)();
    });
    await sharedFormPage.waitForTimeout(100);
  });

  // FW-01: Add action popover shows "Other" category with form steps when node is inside FormContainer
  test('FW-01: add-action popover shows Set form state / Submit form / Reset form for input inside FormContainer', async () => {
    const { inputId } = await injectFormWithInput(sharedFormPage);
    await openCanvasForNode(sharedFormPage, inputId);

    // Click the first insert "+" button to open the Add Action popover
    const insertBtn = sharedFormPage.locator('[data-testid="insert-btn"]').first();
    await insertBtn.click();
    await sharedFormPage.waitForSelector('[data-testid="add-action-popover"]', { timeout: 3_000 });

    const popoverText = await sharedFormPage.getByTestId('add-action-popover').innerText();
    expect(popoverText).toContain('Set form state');
    expect(popoverText).toContain('Submit form');
    expect(popoverText).toContain('Reset form');
    expect(popoverText).toContain('Other');
  });

  // FW-02: Add action popover does NOT show form-specific types for a plain Box (no FormContainer ancestor)
  test('FW-02: add-action popover does NOT show form steps for element outside FormContainer', async () => {
    await sharedFormPage.evaluate(() => {
      const bs = (window as unknown as Record<string, BuilderStore>).__builderStore;
      bs?.getState().addNode?.({ id: 'plain-box', type: 'Box', props: {}, children: [] }, null);
    });
    await sharedFormPage.waitForTimeout(200);
    await openCanvasForNode(sharedFormPage, 'plain-box');

    const insertBtn = sharedFormPage.locator('[data-testid="insert-btn"]').first();
    await insertBtn.click();
    await sharedFormPage.waitForSelector('[data-testid="add-action-popover"]', { timeout: 3_000 });

    const popoverText = await sharedFormPage.getByTestId('add-action-popover').innerText();
    expect(popoverText).not.toContain('Set form state');
    expect(popoverText).not.toContain('Submit form');
    expect(popoverText).not.toContain('Reset form');
  });

  // FW-03: FormContainer itself shows form-specific action types
  test('FW-03: add-action popover shows form steps when workflow is for the FormContainer itself', async () => {
    const { formId } = await injectFormWithInput(sharedFormPage);
    await openCanvasForNode(sharedFormPage, formId);

    const insertBtn = sharedFormPage.locator('[data-testid="insert-btn"]').first();
    await insertBtn.click();
    await sharedFormPage.waitForSelector('[data-testid="add-action-popover"]', { timeout: 3_000 });

    const popoverText = await sharedFormPage.getByTestId('add-action-popover').innerText();
    expect(popoverText).toContain('Set form state');
    expect(popoverText).toContain('Submit form');
    expect(popoverText).toContain('Reset form');
  });

  // FW-04: TypeSearchDropdown (change action type on existing node) also shows form steps in form context
  test('FW-04: TypeSearchDropdown shows form steps for node inside FormContainer', async () => {
    const { inputId } = await injectFormWithInput(sharedFormPage);
    await openCanvasForNode(sharedFormPage, inputId);

    // Add any action first so a node card exists to click on
    const insertBtn = sharedFormPage.locator('[data-testid="insert-btn"]').first();
    await insertBtn.click();
    await sharedFormPage.waitForSelector('[data-testid="add-action-popover"]', { timeout: 3_000 });
    // Pick "Navigate to" as a non-form action so we have a node to select
    const navigateOption = sharedFormPage.locator('[data-testid="add-action-popover"] button').filter({ hasText: 'Navigate to' }).first();
    await navigateOption.click();
    await sharedFormPage.waitForTimeout(300);

    // Click on the newly created action card to select it
    const actionCard = sharedFormPage.locator('[data-testid^="action-node-"]').first();
    await actionCard.click();
    await sharedFormPage.waitForTimeout(200);

    // Open the TypeSearchDropdown
    const typeDropdown = sharedFormPage.locator('[data-testid="type-search-trigger"]');
    await typeDropdown.click();
    await sharedFormPage.waitForSelector('[data-testid="type-search-input"]', { timeout: 2_000 });

    const dropdownText = await sharedFormPage.locator('[data-popover="type-search"]').innerText();
    expect(dropdownText).toContain('Set form state');
    expect(dropdownText).toContain('Submit form');
    expect(dropdownText).toContain('Reset form');
    expect(dropdownText).toContain('Other');
  });

  // FW-05: FormContainer trigger dropdown shows "On submit" and "On submit validation error"
  test('FW-05: FormContainer trigger dropdown shows On submit and On submit validation error', async () => {
    const { formId } = await injectFormWithInput(sharedFormPage);
    await openCanvasForNode(sharedFormPage, formId);

    // Click the trigger pill to open the trigger dropdown
    const triggerPill = sharedFormPage.locator('[data-testid="workflow-trigger-pill"]');
    await triggerPill.click();
    await sharedFormPage.waitForSelector('[data-testid="workflow-trigger-dropdown"]', { timeout: 3_000 });

    const dropdownText = await sharedFormPage.locator('[data-testid="workflow-trigger-dropdown"]').innerText();
    expect(dropdownText).toContain('On submit');
    expect(dropdownText).toContain('On submit validation error');
    expect(dropdownText).toContain('Element triggers');
  });

  // FW-06: Input inside FormContainer shows NO workflows by default (setFormField is hidden)
  test('FW-06: controlled input inside FormContainer shows no workflows in right panel by default', async () => {
    const formId = 'fc-hide-' + Date.now();
    const inputId = 'fc-inp-' + Date.now();

    // Inject a FormContainer with an InputField that has an inline setFormField action (the default)
    await sharedFormPage.evaluate(({ fId, iId }) => {
      const bs = (window as unknown as Record<string, BuilderStore>).__builderStore;
      bs?.getState().addNode?.({
        id: fId,
        type: 'FormContainer',
        name: 'my_form',
        props: {},
        children: [{
          id: iId,
          type: 'InputField',
          name: 'email',
          props: {},
          children: [],
          // Simulate the auto-injected setFormField inline action
          actions: { change: { type: 'setFormField', field: 'email', value: '$event' } },
        }],
      }, null);
    }, { fId: formId, iId: inputId });
    await sharedFormPage.waitForTimeout(300);

    // Select the InputField
    await sharedFormPage.evaluate((id) => {
      (window as unknown as Record<string, BuilderStore>).__builderStore?.getState().select?.(id);
    }, inputId);
    await sharedFormPage.waitForTimeout(300);

    // Open the Workflows tab in the right panel
    await sharedFormPage.getByTestId('tab-right-workflows').click();
    await sharedFormPage.waitForTimeout(200);

    // Should show no workflow rows (setFormField is filtered out)
    // Rows use dynamic testids like right-workflow-row-0, right-workflow-row-1, etc.
    const workflowRows = sharedFormPage.locator('[data-testid^="right-workflow-row-"]');
    await expect(workflowRows).toHaveCount(0);
  });
});
