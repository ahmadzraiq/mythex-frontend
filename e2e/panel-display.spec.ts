/**
 * Display Components Panel Tests
 *
 * Covers right-panel behavior for display-related components:
 *   PD-01..05  Heading  — typography section visibility, font controls
 *   PD-06..08  Badge    — container layout controls, BadgeText typography
 *   PD-09..11  Avatar   — resize, border-radius
 *
 * Each describe block shares ONE browser page (opened in beforeAll) and
 * resets the canvas in beforeEach — eliminates 11 redundant page.goto calls.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="tab-components"]', { timeout: 15_000 });
  // __builderStore is set at module level in _store.ts — available once JS bundle loads
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 100 }
  );
}

async function clearCanvas(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>)
      .__builderStore.getState()._setPageNodes([]);
  });
  // Wait until no data-builder-id elements remain
  await page.waitForFunction(
    () => document.querySelectorAll('[data-builder-id]').length === 0,
    { timeout: 5_000 }
  );
}

// Default nodes matching the palette entries — IDs required for data-builder-id attributes
const DISPLAY_NODES: Record<string, unknown> = {
  Heading: {
    id: 'test-heading',
    type: 'Heading',
    text: 'Heading',
    props: { className: 'text-2xl font-bold text-foreground' },
  },
  Badge: {
    id: 'test-badge',
    type: 'Badge',
    props: { className: 'flex flex-row items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary' },
    children: [{ id: 'test-badge-text', type: 'BadgeText', props: { className: 'text-xs font-medium text-primary-foreground' }, text: 'Badge' }],
  },
  Avatar: {
    id: 'test-avatar',
    type: 'Avatar',
    props: { className: 'w-12 h-12 rounded-full' },
    children: [{ id: 'test-avatar-fallback', type: 'AvatarFallbackText', text: 'AB', props: { className: 'text-sm font-medium text-primary-foreground' } }],
  },
  Spinner: {
    id: 'test-spinner',
    type: 'Spinner',
    props: { size: 'small', color: '#6b7280', style: { width: '24px', height: '24px' } },
  },
  Skeleton: {
    id: 'test-skeleton',
    type: 'Skeleton',
    props: { className: 'rounded-md w-full', style: { width: '200px', height: '80px' } },
    children: [{ id: 'test-skeleton-text', type: 'SkeletonText', props: { _lines: 3, className: 'w-full' } }],
  },
  Alert: {
    id: 'test-alert',
    type: 'Alert',
    props: { className: 'flex flex-row items-start gap-3 p-4 rounded-md bg-amber-50 border border-amber-200', style: { width: '300px' } },
    children: [
      { id: 'test-alert-icon', type: 'NavIcon', props: { icon: 'AlertCircle', size: 18, color: '#d97706' } },
      { id: 'test-alert-text', type: 'AlertText', text: 'This is an alert message.', props: { className: 'text-sm text-amber-800' } },
    ],
  },
  Chip: {
    id: 'test-chip',
    type: 'Pressable',
    props: { className: 'flex flex-row items-center gap-1 px-3 py-1 rounded-full bg-secondary', style: { width: '80px', height: '30px' } },
    children: [
      { id: 'test-chip-label', type: 'Text', props: { className: 'text-sm font-medium text-secondary-foreground' }, text: 'Label' },
      { id: 'test-chip-icon', type: 'NavIcon', props: { icon: 'X', size: 12, color: '#6b7280' } },
    ],
  },
  StarRating: {
    id: 'test-star-rating',
    type: 'Box',
    props: { className: 'flex flex-row gap-1 items-center', style: { width: '120px', height: '28px' } },
    children: [
      { id: 'test-star-1', type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
      { id: 'test-star-2', type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
      { id: 'test-star-3', type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
    ],
  },
  Breadcrumbs: {
    id: 'test-breadcrumbs',
    type: 'Box',
    props: { className: 'flex flex-row items-center gap-1', style: { width: '240px', height: '24px' } },
    children: [
      { id: 'test-bc-home', type: 'Text', props: { className: 'text-sm text-primary' }, text: 'Home' },
      { id: 'test-bc-sep', type: 'NavIcon', props: { icon: 'ChevronRight', size: 14, color: '#9ca3af' } },
      { id: 'test-bc-page', type: 'Text', props: { className: 'text-sm text-foreground font-medium' }, text: 'Page' },
    ],
  },
  Tabs: {
    id: 'test-tabs',
    type: 'Box',
    props: { className: 'flex flex-col w-full gap-0', style: { width: '300px', height: '120px' } },
    children: [
      {
        id: 'test-tabs-bar',
        type: 'Box',
        props: { className: 'flex flex-row border-b border-border' },
        children: [
          { id: 'test-tab-1', type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-primary' }, children: [{ id: 'test-tab-1-text', type: 'Text', props: { className: 'text-sm font-medium text-primary' }, text: 'Tab 1' }] },
          { id: 'test-tab-2', type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ id: 'test-tab-2-text', type: 'Text', props: { className: 'text-sm font-medium text-muted-foreground' }, text: 'Tab 2' }] },
        ],
      },
      { id: 'test-tabs-content', type: 'Box', props: { className: 'p-4 w-full' }, children: [{ id: 'test-tabs-body', type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Tab content' }] },
    ],
  },
  Stepper: {
    id: 'test-stepper',
    type: 'Box',
    props: { className: 'flex flex-row items-center w-full', style: { width: '280px', height: '48px' } },
    children: [
      { id: 'test-step-1', type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ id: 'test-step-1-circle', type: 'Box', props: { className: 'w-8 h-8 rounded-full bg-primary flex items-center justify-center' }, children: [{ id: 'test-step-1-num', type: 'Text', props: { className: 'text-sm font-bold text-primary-foreground' }, text: '1' }] }] },
      { id: 'test-step-conn', type: 'Box', props: { className: 'flex-1 h-px bg-primary mx-2' } },
      { id: 'test-step-2', type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ id: 'test-step-2-circle', type: 'Box', props: { className: 'w-8 h-8 rounded-full border-2 border-border flex items-center justify-center' }, children: [{ id: 'test-step-2-num', type: 'Text', props: { className: 'text-sm font-bold text-muted-foreground' }, text: '2' }] }] },
    ],
  },
  Pagination: {
    id: 'test-pagination',
    type: 'Box',
    props: { className: 'flex flex-row gap-1 items-center', style: { width: '240px', height: '36px' } },
    children: [
      { id: 'test-pg-prev', type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ id: 'test-pg-prev-icon', type: 'NavIcon', props: { icon: 'ChevronLeft', size: 14, color: '#6b7280' } }] },
      { id: 'test-pg-1', type: 'Pressable', props: { className: 'w-8 h-8 rounded-md bg-primary flex items-center justify-center' }, children: [{ id: 'test-pg-1-text', type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: '1' }] },
      { id: 'test-pg-next', type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ id: 'test-pg-next-icon', type: 'NavIcon', props: { icon: 'ChevronRight', size: 14, color: '#6b7280' } }] },
    ],
  },
  Accordion: {
    id: 'test-accordion',
    type: 'Box',
    props: { className: 'w-full border border-border rounded-md overflow-hidden', style: { width: '300px', height: '120px' } },
    children: [
      {
        id: 'test-accordion-header',
        type: 'Pressable',
        props: { className: 'flex flex-row items-center justify-between p-4 bg-background' },
        children: [
          { id: 'test-accordion-title', type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: 'Section Title' },
          { id: 'test-accordion-icon', type: 'NavIcon', props: { icon: 'ChevronDown', size: 16, color: '#6b7280' } },
        ],
      },
      { id: 'test-accordion-body', type: 'Box', props: { className: 'p-4 bg-muted border-t border-border' }, children: [{ id: 'test-accordion-text', type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Content' }] },
    ],
  },
  JsonViewer: {
    id: 'test-json-viewer',
    type: 'JsonViewer',
    props: { data: { name: 'Alice', age: 30 }, style: { width: '320px', minHeight: '80px' } },
  },
};

async function injectNodes(page: Page, nodes: unknown[]) {
  await page.evaluate((ns) => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore
      .getState()._setPageNodes(ns);
  }, nodes);
  const firstId = (nodes[0] as { id?: string })?.id;
  if (firstId) {
    await page.waitForSelector(`[data-builder-id="${firstId}"]`, { timeout: 10_000 });
  } else {
    await page.locator('[data-builder-id]').first().waitFor({ state: 'visible', timeout: 10_000 });
  }
}

async function dropComponent(page: Page, label: string) {
  const node = DISPLAY_NODES[label];
  if (!node) throw new Error(`No default node defined for label: ${label}`);
  await injectNodes(page, [node]);
  await selectFirstNodeViaLayers(page);
}

async function selectFirstNodeViaLayers(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="layer-row"]').first().click();
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(200);
}

async function getFirstNodeId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { selectedIds: string[] } }>).__builderStore?.getState();
    return store?.selectedIds?.[0] ?? '';
  });
}

async function getNodeStyle(page: Page, nodeId: string): Promise<Record<string, string>> {
  return page.evaluate((id: string) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
    function find(arr: unknown[]): Record<string, unknown> | null {
      for (const n of arr) {
        const node = n as Record<string, unknown>;
        if (node.id === id) return node;
        const ch = node.children as unknown[] | undefined;
        if (ch?.length) { const f = find(ch); if (f) return f; }
      }
      return null;
    }
    const node = find(store?.pageNodes ?? []);
    return (node?.props as Record<string, Record<string, string>> | undefined)?.style ?? {};
  }, nodeId);
}

async function getNodeClassName(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id: string) => {
    const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
    function find(arr: unknown[]): Record<string, unknown> | null {
      for (const n of arr) {
        const node = n as Record<string, unknown>;
        if (node.id === id) return node;
        const ch = node.children as unknown[] | undefined;
        if (ch?.length) { const f = find(ch); if (f) return f; }
      }
      return null;
    }
    const node = find(store?.pageNodes ?? []);
    return (node?.props as Record<string, string> | undefined)?.className ?? '';
  }, nodeId);
}

async function scrollTo(page: Page, testId: string) {
  await page.evaluate((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, testId);
  await page.waitForTimeout(50);
}

// ─── PD-01..05 — Heading ─────────────────────────────────────────────────────

test.describe('PD — Heading', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PD-01: Drop Heading → Typography section IS shown', async () => {
    await dropComponent(sharedPage, 'Heading');
    await selectFirstNodeViaLayers(sharedPage);

    const textColorInput = sharedPage.locator('[data-testid="input-text-color"]');
    await expect(textColorInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Typography section shown for Heading');
  });

  test('PD-02: Heading font-size token text-3xl applies in className', async () => {
    await dropComponent(sharedPage, 'Heading');
    await selectFirstNodeViaLayers(sharedPage);
    const nodeId = await getFirstNodeId(sharedPage);

    const fontSizeSelect = sharedPage.locator('[data-testid="select-text-size"]');
    await expect(fontSizeSelect).toBeVisible({ timeout: 5_000 });
    await fontSizeSelect.selectOption('text-3xl');
    await sharedPage.waitForTimeout(200);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('text-3xl');
    console.log('✅ Heading font-size text-3xl applied to className');
  });

  test('PD-03: Heading font-weight font-bold applies in className', async () => {
    await dropComponent(sharedPage, 'Heading');
    await selectFirstNodeViaLayers(sharedPage);
    const nodeId = await getFirstNodeId(sharedPage);

    const fontWeightSelect = sharedPage.locator('[data-testid="select-font-weight"]');
    await expect(fontWeightSelect).toBeVisible({ timeout: 5_000 });
    await fontWeightSelect.selectOption('font-bold');
    await sharedPage.waitForTimeout(200);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('font-bold');
    console.log('✅ Heading font-weight font-bold applied to className');
  });

  test('PD-04: Heading text color #3b82f6 applies via style.color', async () => {
    await dropComponent(sharedPage, 'Heading');
    await selectFirstNodeViaLayers(sharedPage);
    const nodeId = await getFirstNodeId(sharedPage);

    await scrollTo(sharedPage, 'input-text-color');
    const textColorInput = sharedPage.locator('[data-testid="input-text-color"]');
    await textColorInput.fill('#3b82f6');
    await textColorInput.press('Tab');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.color).toBe('#3b82f6');
    console.log('✅ Heading text color #3b82f6 applied');
  });

  test('PD-05: Auto Layout section hidden for Heading (text node, not container)', async () => {
    await dropComponent(sharedPage, 'Heading');
    await selectFirstNodeViaLayers(sharedPage);

    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Auto Layout hidden for Heading (text node)');
  });
});

// ─── PD-06..08 — Badge (container) ───────────────────────────────────────────

test.describe('PD — Badge', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PD-06: Drop Badge → Auto Layout IS shown (Badge is a container)', async () => {
    await dropComponent(sharedPage, 'Badge');
    await selectFirstNodeViaLayers(sharedPage);

    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for Badge (container)');
  });

  test('PD-07: Select BadgeText child → Typography section IS shown', async () => {
    await injectNodes(sharedPage, [
      {
        type: 'Badge', id: 'bdg-01',
        props: { className: 'flex flex-row items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500', style: { width: '80px', height: '28px' } },
        children: [
          { type: 'BadgeText', id: 'bdg-txt', props: { className: 'text-xs text-white' }, text: 'New' },
        ],
      },
    ]);
    await sharedPage.waitForSelector('[data-builder-id="bdg-txt"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { select: (id: string, additive: boolean) => void } }>).__builderStore
        .getState().select('bdg-txt', false);
    });
    await sharedPage.getByTestId('tab-right-design').click();
    await sharedPage.waitForTimeout(200);

    const textColorInput = sharedPage.locator('[data-testid="input-text-color"]');
    await expect(textColorInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Typography section shown when BadgeText is selected');
  });

  test('PD-08: Background color applies to Badge root', async () => {
    await dropComponent(sharedPage, 'Badge');
    await selectFirstNodeViaLayers(sharedPage);
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    await scrollTo(sharedPage, 'input-bg-color');
    const bgInput = sharedPage.locator('[data-testid="input-bg-color"]');
    await bgInput.fill('#8b5cf6');
    await bgInput.press('Tab');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.backgroundColor).toBe('#8b5cf6');
    await expect(sharedPage.locator(`[data-builder-id="${nodeId}"]`)).toBeVisible();
    console.log('✅ Badge background color #8b5cf6 applied');
  });
});

// ─── PD-09..11 — Avatar ───────────────────────────────────────────────────────

test.describe('PD — Avatar', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PD-09: Drop Avatar → selectable, shows Dimensions section', async () => {
    await dropComponent(sharedPage, 'Avatar');
    await selectFirstNodeViaLayers(sharedPage);
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    await expect(sharedPage.locator('[data-testid="input-pos-w"]')).toBeAttached({ timeout: 5_000 });
    await expect(sharedPage.locator(`[data-builder-id="${nodeId}"]`)).toBeVisible();
    console.log('✅ Avatar selectable, Dimensions section visible');
  });

  test('PD-10: Avatar W/H resize applies style.width and style.height', async () => {
    await dropComponent(sharedPage, 'Avatar');
    await selectFirstNodeViaLayers(sharedPage);
    const nodeId = await getFirstNodeId(sharedPage);

    await sharedPage.locator('[data-testid="input-pos-w"]').fill('80');
    await sharedPage.waitForTimeout(200);
    await sharedPage.locator('[data-testid="input-pos-h"]').fill('80');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.width).toBe('80px');
    expect(style.height).toBe('80px');
    await expect(sharedPage.locator(`[data-builder-id="${nodeId}"]`)).toBeVisible();
    console.log('✅ Avatar W=80 H=80 applied via inline style');
  });

  test('PD-11: Avatar all corners rounded-full applies in className', async () => {
    await dropComponent(sharedPage, 'Avatar');
    await selectFirstNodeViaLayers(sharedPage);
    const nodeId = await getFirstNodeId(sharedPage);

    await scrollTo(sharedPage, 'select-corner-tl');
    for (const corner of ['tl', 'tr', 'br', 'bl']) {
      await sharedPage.locator(`[data-testid="select-corner-${corner}"]`).selectOption('rounded-full');
      await sharedPage.waitForTimeout(100);
    }
    await sharedPage.waitForTimeout(200);

    const cls = await getNodeClassName(sharedPage, nodeId);
    expect(cls).toContain('rounded-full');
    await expect(sharedPage.locator(`[data-builder-id="${nodeId}"]`)).toBeVisible();
    console.log('✅ Avatar rounded-full applied to className');
  });
});

// ─── PD-12..13 — Spinner (leaf widget) ───────────────────────────────────────

test.describe('PD — Spinner', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PD-12: Drop Spinner → isLeafWidget → Auto Layout section HIDDEN', async () => {
    await dropComponent(sharedPage, 'Spinner');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Auto Layout hidden for Spinner (leaf widget)');
  });

  test('PD-13: Drop Spinner → selectable and W resize updates style.width', async () => {
    await dropComponent(sharedPage, 'Spinner');
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    await sharedPage.locator('[data-testid="input-pos-w"]').fill('48');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.width).toBe('48px');
    console.log('✅ Spinner W resize to 48 → style.width = 48px');
  });
});

// ─── PD-14..16 — Skeleton (container) ────────────────────────────────────────

test.describe('PD — Skeleton', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PD-14: Drop Skeleton → isContainer → Auto Layout section IS shown', async () => {
    await dropComponent(sharedPage, 'Skeleton');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for Skeleton (container)');
  });

  test('PD-15: Select SkeletonText child → Typography section IS shown', async () => {
    // Inject SkeletonText at root so it renders in DOM (Skeleton with isLoaded=false
    // swallows children and renders only a shimmer div, so we can't wait for the child).
    await injectNodes(sharedPage, [{ id: 'test-skeleton-text', type: 'SkeletonText', props: { _lines: 3, className: 'w-full' } }]);
    await sharedPage.waitForSelector('[data-builder-id="test-skeleton-text"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { select: (id: string, additive: boolean) => void } }>).__builderStore
        .getState().select('test-skeleton-text', false);
    });
    await sharedPage.getByTestId('tab-right-design').click();
    await sharedPage.waitForTimeout(200);

    const textColorInput = sharedPage.locator('[data-testid="input-text-color"]');
    await expect(textColorInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Typography section shown when SkeletonText is selected');
  });

  test('PD-16: REQUIRED_PARENT — SkeletonText blocked from canvas root', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['Skeleton'] as unknown as object]);
    await sharedPage.waitForSelector('[data-builder-id="test-skeleton"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { moveNode: (id: string, parent: string | null, idx: number) => void } }>).__builderStore
        .getState().moveNode('test-skeleton-text', null, 0);
    });
    await sharedPage.waitForTimeout(200);

    const rootTypes = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ type: string }> } }>).__builderStore.getState();
      return store.pageNodes.map(n => n.type);
    });
    expect(rootTypes).not.toContain('SkeletonText');
    expect(rootTypes).toContain('Skeleton');
    console.log('✅ SkeletonText blocked from moving to root — stays inside Skeleton');
  });
});

// ─── PD-17..19 — Alert (container) ───────────────────────────────────────────

test.describe('PD — Alert', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PD-17: Drop Alert → isContainer → Auto Layout section IS shown', async () => {
    await dropComponent(sharedPage, 'Alert');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for Alert (container)');
  });

  test('PD-18: Select AlertText child → Typography section IS shown', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['Alert'] as unknown as object]);
    await sharedPage.waitForSelector('[data-builder-id="test-alert-text"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { select: (id: string, additive: boolean) => void } }>).__builderStore
        .getState().select('test-alert-text', false);
    });
    await sharedPage.getByTestId('tab-right-design').click();
    await sharedPage.waitForTimeout(200);

    const textColorInput = sharedPage.locator('[data-testid="input-text-color"]');
    await expect(textColorInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Typography section shown when AlertText is selected');
  });

  test('PD-19: REQUIRED_PARENT — AlertText blocked from canvas root', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['Alert'] as unknown as object]);
    await sharedPage.waitForSelector('[data-builder-id="test-alert"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { moveNode: (id: string, parent: string | null, idx: number) => void } }>).__builderStore
        .getState().moveNode('test-alert-text', null, 0);
    });
    await sharedPage.waitForTimeout(200);

    const rootTypes = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ type: string }> } }>).__builderStore.getState();
      return store.pageNodes.map(n => n.type);
    });
    expect(rootTypes).not.toContain('AlertText');
    expect(rootTypes).toContain('Alert');
    console.log('✅ AlertText blocked from moving to root — stays inside Alert');
  });
});

// ─── PD-19..26 — Tier 1 Composite Components ─────────────────────────────────

test.describe('PD — Composite Components', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PD-19: Chip → isContainer → Auto Layout shown', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['Chip'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Chip (Pressable) is container');
  });

  test('PD-20: StarRating renders 3 NavIcon children', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['StarRating'] as unknown as object]);
    await sharedPage.waitForSelector('[data-builder-id="test-star-rating"]', { timeout: 5_000 });
    const stars = sharedPage.locator('[data-builder-id^="test-star-"]');
    expect(await stars.count()).toBeGreaterThanOrEqual(3);
    console.log('✅ StarRating renders multiple NavIcon stars');
  });

  test('PD-21: Breadcrumbs → isContainer → Auto Layout shown', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['Breadcrumbs'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Breadcrumbs (Box) is container');
  });

  test('PD-22: Tabs → isContainer → Auto Layout shown', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['Tabs'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Tabs (Box) is container');
  });

  test('PD-23: Stepper → isContainer → Auto Layout shown', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['Stepper'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Stepper (Box) is container');
  });

  test('PD-24: Pagination → isContainer → Auto Layout shown', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['Pagination'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Pagination (Box) is container');
  });

  test('PD-25: Accordion → isContainer → Auto Layout shown', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['Accordion'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Accordion (Box) is container');
  });

  test('PD-26: JsonViewer → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectNodes(sharedPage, [DISPLAY_NODES['JsonViewer'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ JsonViewer is leaf widget — no Auto Layout');
  });
});
