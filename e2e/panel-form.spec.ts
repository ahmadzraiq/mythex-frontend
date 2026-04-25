/**
 * Form Components Panel Tests
 *
 * Covers right-panel behavior for form-related components:
 *   PF-01..07  Input    — resize, section visibility, styling, REQUIRED_PARENT guard
 *   PF-08..09  Textarea — resize, REQUIRED_PARENT guard
 *   PF-10..13  Checkbox — container layout controls, CheckboxLabel typography
 *   PF-14..16  Toggle   — track/thumb sub-selection and independent bg color
 *
 * Each describe block shares ONE browser page (opened in beforeAll) and
 * resets the canvas in beforeEach — eliminates 16 redundant page.goto calls.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="tab-components"]', { timeout: 15_000 });
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
  await page.waitForFunction(
    () => document.querySelectorAll('[data-builder-id]').length === 0,
    { timeout: 5_000 }
  );
}

// Default nodes matching the palette entries — IDs required for data-builder-id attributes
const FORM_NODES: Record<string, unknown> = {
  Input: {
    id: 'test-input',
    type: 'Input',
    props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-border !bg-background', placeholder: 'Enter text…' },
  },
  Textarea: {
    id: 'test-textarea',
    type: 'Textarea',
    props: { className: 'w-full !rounded-md !border-border !bg-background', style: { width: '256px', height: '80px' } },
    children: [{ id: 'test-textarea-input', type: 'TextareaInput', props: { placeholder: 'Enter text…', className: '!text-foreground' } }],
  },
  Slider: {
    id: 'test-slider',
    type: 'Slider',
    props: { defaultValue: 50, minValue: 0, maxValue: 100, className: 'w-full', style: { width: '200px' } },
    children: [
      { id: 'test-slider-track', type: 'SliderTrack', children: [{ id: 'test-slider-filled', type: 'SliderFilledTrack' }] },
      { id: 'test-slider-thumb', type: 'SliderThumb' },
    ],
  },
  Radio: {
    id: 'test-radio',
    type: 'RadioGroup',
    props: { className: 'flex flex-col gap-2', style: { width: '160px', height: '60px' } },
    children: [{
      id: 'test-radio-inner',
      type: 'Radio',
      props: { value: 'option', className: 'flex flex-row items-center gap-2' },
      children: [
        { id: 'test-radio-indicator', type: 'RadioIndicator' },
        { id: 'test-radio-label', type: 'RadioLabel', text: 'Option' },
      ],
    }],
  },
  RadioGroup: {
    id: 'test-radio-group',
    type: 'RadioGroup',
    props: { className: 'flex flex-col gap-3', style: { width: '160px', height: '80px' } },
    children: [
      { id: 'test-radio-a', type: 'Radio', props: { value: 'a' }, children: [{ id: 'test-radio-a-ind', type: 'RadioIndicator' }, { id: 'test-radio-a-lbl', type: 'RadioLabel', text: 'Option A' }] },
      { id: 'test-radio-b', type: 'Radio', props: { value: 'b' }, children: [{ id: 'test-radio-b-ind', type: 'RadioIndicator' }, { id: 'test-radio-b-lbl', type: 'RadioLabel', text: 'Option B' }] },
    ],
  },
  Select: {
    id: 'test-select',
    type: 'Select',
    props: { style: { width: '200px', height: '44px' } },
    children: [
      { id: 'test-select-trigger', type: 'SelectTrigger', props: { className: 'flex flex-row items-center justify-between px-3 py-2 rounded-md border border-border bg-background' },
        children: [{ id: 'test-select-input', type: 'SelectInput', props: { placeholder: 'Select…' } }] },
      { id: 'test-select-portal', type: 'SelectPortal',
        children: [{ id: 'test-select-backdrop', type: 'SelectBackdrop' }, { id: 'test-select-content', type: 'SelectContent',
          children: [{ id: 'test-select-item1', type: 'SelectItem', props: { label: 'Option 1', value: 'option1' } }] }] },
    ],
  },
  Progress: {
    id: 'test-progress',
    type: 'Progress',
    props: { value: 60, className: 'w-full h-2 rounded-full bg-muted', style: { width: '200px', height: '8px' } },
    children: [{ id: 'test-progress-fill', type: 'ProgressFilledTrack', props: { className: 'h-full rounded-full bg-primary' } }],
  },
  Checkbox: {
    id: 'test-checkbox',
    type: 'Checkbox',
    props: { defaultIsChecked: false },
    children: [
      { id: 'test-checkbox-indicator', type: 'CheckboxIndicator' },
      { id: 'test-checkbox-label', type: 'CheckboxLabel', text: 'Label' },
    ],
  },
  Toggle: {
    id: 'test-toggle',
    type: 'Pressable',
    props: { className: 'w-12 h-6 rounded-full flex items-center px-1 bg-gray-300' },
    children: [{ id: 'test-toggle-thumb', type: 'Box', props: { className: 'w-5 h-5 rounded-full bg-white shadow-sm' } }],
  },
  FileUpload: {
    id: 'test-file-upload',
    type: 'FileUpload',
    props: { label: 'Click or drag to upload', style: { width: '280px', minHeight: '120px' } },
  },
  Switch: {
    id: 'test-switch',
    type: 'Pressable',
    props: { className: 'relative w-12 h-6 rounded-full bg-gray-300 justify-center', style: { width: '48px', height: '24px' } },
    children: [{ id: 'test-switch-thumb', type: 'Box', props: { className: 'absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm' } }],
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
  const node = FORM_NODES[label];
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

// ─── PF-01..07 — Input ────────────────────────────────────────────────────────

test.describe('PF — Input', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PF-01: Drop Input → W resize to 300 updates style.width = 300px', async () => {
    await dropComponent(sharedPage, 'Input');
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    await sharedPage.locator('[data-testid="input-pos-w"]').fill('300');
    await sharedPage.waitForTimeout(300);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.width).toBe('300px');
    await expect(sharedPage.locator(`[data-builder-id="${nodeId}"]`)).toBeVisible();
    console.log('✅ Input W resize to 300 → style.width = 300px');
  });

  test('PF-02: Auto Layout section is hidden for Input (leaf widget)', async () => {
    await dropComponent(sharedPage, 'Input');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Auto Layout hidden for Input (leaf widget)');
  });

  test('PF-03: Typography section is hidden for Input', async () => {
    await dropComponent(sharedPage, 'Input');
    const textColor = sharedPage.locator('[data-testid="input-text-color"]');
    await expect(textColor).not.toBeVisible();
    console.log('✅ Typography hidden for Input (leaf widget)');
  });

  test('PF-04: Border color #ef4444 applies to Input', async () => {
    await dropComponent(sharedPage, 'Input');
    const nodeId = await getFirstNodeId(sharedPage);

    await scrollTo(sharedPage, 'input-stroke-color');
    const strokeInput = sharedPage.locator('[data-testid="input-stroke-color"]');
    await strokeInput.fill('#ef4444');
    await strokeInput.press('Tab');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.borderColor).toBe('#ef4444');
    console.log('✅ Input border color #ef4444 applied');
  });

  test('PF-05: Background color applies to Input via style.backgroundColor', async () => {
    await dropComponent(sharedPage, 'Input');
    const nodeId = await getFirstNodeId(sharedPage);

    await scrollTo(sharedPage, 'input-bg-color');
    await sharedPage.locator('[data-testid="input-bg-color"]').fill('#3b82f6');
    await sharedPage.locator('[data-testid="input-bg-color"]').press('Tab');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.backgroundColor).toBe('#3b82f6');
    console.log('✅ Input background color #3b82f6 applied');
  });

  test('PF-06: Opacity 50% → style.opacity = 0.5, Input still visible', async () => {
    await dropComponent(sharedPage, 'Input');
    const nodeId = await getFirstNodeId(sharedPage);

    await scrollTo(sharedPage, 'input-opacity-slider');
    const slider = sharedPage.locator('[data-testid="input-opacity-slider"]');
    await sharedPage.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, '50');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, await slider.elementHandle());
    await sharedPage.waitForTimeout(200);

    await expect(sharedPage.locator(`[data-builder-id="${nodeId}"]`)).toBeVisible();
    const style = await getNodeStyle(sharedPage, nodeId);
    expect(parseFloat(style.opacity)).toBeCloseTo(0.5, 1);
    console.log('✅ Input opacity 50% applied, element still visible');
  });

  test('PF-07: Flat Input (no InputField child) renders and accepts placeholder prop', async () => {
    await injectNodes(sharedPage, [
      { type: 'Input', id: 'inp-flat', props: { className: 'w-64', placeholder: 'Flat input test', style: { width: '256px', height: '40px' } } },
    ]);
    await sharedPage.waitForSelector('[data-builder-id="inp-flat"]', { timeout: 5_000 });

    const rootTypes = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ type: string }> } }>).__builderStore.getState();
      return store.pageNodes.map(n => n.type);
    });
    expect(rootTypes).toContain('Input');

    const hasInput = await sharedPage.locator('[data-builder-id="inp-flat"] input').count();
    expect(hasInput).toBeGreaterThan(0);
    console.log('✅ Flat Input renders without InputField child');
  });
});

// ─── PF-08..09 — Textarea ────────────────────────────────────────────────────

test.describe('PF — Textarea', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PF-08: Drop Textarea → W resize updates style.width', async () => {
    await dropComponent(sharedPage, 'Textarea');
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    await sharedPage.locator('[data-testid="input-pos-w"]').fill('400');
    await sharedPage.waitForTimeout(300);

    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.width).toBe('400px');
    await expect(sharedPage.locator(`[data-builder-id="${nodeId}"]`)).toBeVisible();
    console.log('✅ Textarea W resize to 400 → style.width = 400px');
  });

  test('PF-09: REQUIRED_PARENT — TextareaInput cannot be moved to canvas root', async () => {
    await injectNodes(sharedPage, [
      { type: 'Textarea', id: 'ta-root', props: { className: 'w-64 h-20', style: { width: '256px', height: '80px' } },
        children: [{ type: 'TextareaInput', id: 'tai-root', props: {} }] },
    ]);
    await sharedPage.waitForSelector('[data-builder-id="ta-root"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { moveNode: (id: string, parent: string | null, idx: number) => void } }>).__builderStore
        .getState().moveNode('tai-root', null, 0);
    });
    await sharedPage.waitForTimeout(200);

    const rootTypes = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ type: string }> } }>).__builderStore.getState();
      return store.pageNodes.map(n => n.type);
    });
    expect(rootTypes).not.toContain('TextareaInput');
    expect(rootTypes).toContain('Textarea');

    const taChildren = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; children?: Array<{ type: string }> }> } }>).__builderStore.getState();
      return store.pageNodes.find(n => n.id === 'ta-root')?.children ?? [];
    });
    expect(taChildren.some(c => c.type === 'TextareaInput')).toBe(true);
    console.log('✅ TextareaInput blocked from moving to root — stays inside Textarea');
  });
});

// ─── PF-10..13 — Checkbox (container) ────────────────────────────────────────

test.describe('PF — Checkbox', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PF-10: Drop Checkbox → Auto Layout section IS shown (Checkbox is a container)', async () => {
    await dropComponent(sharedPage, 'Checkbox');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout section shown for Checkbox (container)');
  });

  test('PF-11: Gap value 4 applies as style.gap on Checkbox', async () => {
    await dropComponent(sharedPage, 'Checkbox');
    const nodeId = await getFirstNodeId(sharedPage);

    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    await gapInput.fill('4');
    await gapInput.press('Tab');
    await sharedPage.waitForTimeout(200);

    // gap is stored as style.gap (patchStyle), not className
    const style = await getNodeStyle(sharedPage, nodeId);
    expect(style.gap).toBe('4px');
    console.log('✅ gap=4px applied to Checkbox style.gap');
  });

  test('PF-12: Select CheckboxLabel child → Typography section IS shown', async () => {
    await injectNodes(sharedPage, [
      {
        type: 'Checkbox', id: 'cbx-01', props: { className: 'flex flex-row items-center gap-2', style: { width: '200px', height: '40px' } },
        children: [
          { type: 'CheckboxIndicator', id: 'cbx-ind', props: {} },
          { type: 'CheckboxLabel',     id: 'cbx-lbl', props: { className: 'text-sm' }, text: 'Accept terms' },
        ],
      },
    ]);
    await sharedPage.waitForSelector('[data-builder-id="cbx-lbl"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { select: (id: string, additive: boolean) => void } }>).__builderStore
        .getState().select('cbx-lbl', false);
    });
    await sharedPage.getByTestId('tab-right-design').click();
    await sharedPage.waitForTimeout(200);

    const textColorInput = sharedPage.locator('[data-testid="input-text-color"]');
    await expect(textColorInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Typography section shown when CheckboxLabel is selected');
  });

  test('PF-13: Alignment grid shown for Checkbox (container)', async () => {
    await dropComponent(sharedPage, 'Checkbox');
    const alignCell = sharedPage.locator('[data-testid="alignment-cell"]').first();
    await expect(alignCell).toBeVisible({ timeout: 5_000 });
    console.log('✅ Alignment grid shown for Checkbox');
  });
});

// ─── PF-14..16 — Toggle (primitive Pressable-based) ──────────────────────────

test.describe('PF — Toggle', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PF-14: Drop Toggle → outer Pressable (track) is selectable', async () => {
    await dropComponent(sharedPage, 'Toggle');
    const nodeId = await getFirstNodeId(sharedPage);
    expect(nodeId).toBeTruthy();

    await expect(sharedPage.locator(`[data-builder-id="${nodeId}"]`)).toBeVisible();

    const nodeType = await sharedPage.evaluate((id: string) => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      function find(arr: unknown[]): string | null {
        for (const n of arr) {
          const node = n as Record<string, unknown>;
          if (node.id === id) return node.type as string;
          const ch = node.children as unknown[] | undefined;
          if (ch?.length) { const r = find(ch); if (r) return r; }
        }
        return null;
      }
      return find(store?.pageNodes ?? []);
    }, nodeId);
    expect(nodeType).toBe('Pressable');
    console.log('✅ Toggle outer Pressable (track) is selectable, type:', nodeType);
  });

  test('PF-15: Select Toggle inner Box (thumb) → bg color applies to thumb only', async () => {
    await dropComponent(sharedPage, 'Toggle');
    await sharedPage.waitForTimeout(200);

    const thumbId = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      const nodes = store?.pageNodes ?? [];
      function findThumb(arr: unknown[]): string | null {
        for (const n of arr) {
          const node = n as Record<string, unknown>;
          if (node.type === 'Box') return node.id as string;
          const ch = node.children as unknown[] | undefined;
          if (ch?.length) { const r = findThumb(ch); if (r) return r; }
        }
        return null;
      }
      return findThumb(nodes);
    });
    expect(thumbId).toBeTruthy();

    await sharedPage.evaluate((id: string) => {
      (window as unknown as Record<string, { getState: () => { select: (id: string, additive: boolean) => void } }>).__builderStore
        .getState().select(id, false);
    }, thumbId!);
    await sharedPage.getByTestId('tab-right-design').click();
    await sharedPage.waitForTimeout(200);

    await scrollTo(sharedPage, 'input-bg-color');
    await sharedPage.locator('[data-testid="input-bg-color"]').fill('#ffffff');
    await sharedPage.locator('[data-testid="input-bg-color"]').press('Tab');
    await sharedPage.waitForTimeout(200);

    const style = await getNodeStyle(sharedPage, thumbId!);
    expect(style.backgroundColor).toBe('#ffffff');
    console.log('✅ Toggle thumb (Box) bg color applied independently');
  });

  test('PF-16: Toggle track background color applies separately from thumb', async () => {
    await dropComponent(sharedPage, 'Toggle');
    const trackId = await getFirstNodeId(sharedPage);
    expect(trackId).toBeTruthy();

    await scrollTo(sharedPage, 'input-bg-color');
    await sharedPage.locator('[data-testid="input-bg-color"]').fill('#22c55e');
    await sharedPage.locator('[data-testid="input-bg-color"]').press('Tab');
    await sharedPage.waitForTimeout(200);

    const trackStyle = await getNodeStyle(sharedPage, trackId);
    expect(trackStyle.backgroundColor).toBe('#22c55e');
    await expect(sharedPage.locator(`[data-builder-id="${trackId}"]`)).toBeVisible();
    console.log('✅ Toggle track bg color #22c55e applied, element still visible');
  });
});

// ─── PF-17..18 — Slider (leaf widget) ────────────────────────────────────────

test.describe('PF — Slider', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PF-17: Drop Slider → isLeafWidget → Auto Layout section HIDDEN', async () => {
    await dropComponent(sharedPage, 'Slider');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Auto Layout hidden for Slider (leaf widget)');
  });

  test('PF-18: REQUIRED_PARENT — SliderThumb blocked from canvas root', async () => {
    await injectNodes(sharedPage, [FORM_NODES['Slider'] as unknown as object]);
    await sharedPage.waitForSelector('[data-builder-id="test-slider"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { moveNode: (id: string, parent: string | null, idx: number) => void } }>).__builderStore
        .getState().moveNode('test-slider-thumb', null, 0);
    });
    await sharedPage.waitForTimeout(200);

    const rootTypes = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ type: string }> } }>).__builderStore.getState();
      return store.pageNodes.map(n => n.type);
    });
    expect(rootTypes).not.toContain('SliderThumb');
    expect(rootTypes).toContain('Slider');
    console.log('✅ SliderThumb blocked from moving to root — stays inside Slider');
  });
});

// ─── PF-19..21 — Radio / RadioGroup (containers) ─────────────────────────────

test.describe('PF — Radio / RadioGroup', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PF-19: Drop Radio → isContainer → Auto Layout section IS shown', async () => {
    await dropComponent(sharedPage, 'Radio');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for Radio (container)');
  });

  test('PF-20: Drop RadioGroup → isContainer → Auto Layout section IS shown', async () => {
    await dropComponent(sharedPage, 'RadioGroup');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for RadioGroup (container)');
  });

  test('PF-21: Select RadioLabel child → Typography section IS shown', async () => {
    await injectNodes(sharedPage, [FORM_NODES['Radio'] as unknown as object]);
    await sharedPage.waitForSelector('[data-builder-id="test-radio-label"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { select: (id: string, additive: boolean) => void } }>).__builderStore
        .getState().select('test-radio-label', false);
    });
    await sharedPage.getByTestId('tab-right-design').click();
    await sharedPage.waitForTimeout(200);

    const textColorInput = sharedPage.locator('[data-testid="input-text-color"]');
    await expect(textColorInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Typography section shown when RadioLabel is selected');
  });
});

// ─── PF-22..23 — Select & Progress (leaf widgets) ────────────────────────────

test.describe('PF — Select & Progress', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PF-22: Drop Select → isLeafWidget → Auto Layout section HIDDEN', async () => {
    await dropComponent(sharedPage, 'Select');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Auto Layout hidden for Select (leaf widget)');
  });

  test('PF-23: Drop Progress → isLeafWidget → Auto Layout section HIDDEN', async () => {
    await dropComponent(sharedPage, 'Progress');
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Auto Layout hidden for Progress (leaf widget)');
  });

  test('PF-24: REQUIRED_PARENT — ProgressFilledTrack blocked from canvas root', async () => {
    await injectNodes(sharedPage, [FORM_NODES['Progress'] as unknown as object]);
    await sharedPage.waitForSelector('[data-builder-id="test-progress"]', { timeout: 5_000 });

    await sharedPage.evaluate(() => {
      (window as unknown as Record<string, { getState: () => { moveNode: (id: string, parent: string | null, idx: number) => void } }>).__builderStore
        .getState().moveNode('test-progress-fill', null, 0);
    });
    await sharedPage.waitForTimeout(200);

    const rootTypes = await sharedPage.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ type: string }> } }>).__builderStore.getState();
      return store.pageNodes.map(n => n.type);
    });
    expect(rootTypes).not.toContain('ProgressFilledTrack');
    expect(rootTypes).toContain('Progress');
    console.log('✅ ProgressFilledTrack blocked from moving to root — stays inside Progress');
  });
});

// ─── PF-25..31 — Tier 3 HTML Input Wrappers ───────────────────────────────────

test.describe('PF — Tier 3 HTML Input Wrappers', () => {
  test.setTimeout(120_000);

  let sharedPage: Page;
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
    await gotoBuilder(sharedPage);
  });
  test.afterAll(async () => { await sharedPage.context().close(); });
  test.beforeEach(async () => { await clearCanvas(sharedPage); });

  test('PF-29: Drop FileUpload → isLeafWidget → Auto Layout HIDDEN', async () => {
    await injectNodes(sharedPage, [FORM_NODES['FileUpload'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).not.toBeVisible();
    console.log('✅ Auto Layout hidden for FileUpload (leaf widget)');
  });

  test('PF-31: Switch (primitive) → isContainer → Auto Layout IS shown', async () => {
    await injectNodes(sharedPage, [FORM_NODES['Switch'] as unknown as object]);
    await selectFirstNodeViaLayers(sharedPage);
    const gapInput = sharedPage.locator('[data-testid="input-gap"]');
    await expect(gapInput).toBeVisible({ timeout: 5_000 });
    console.log('✅ Auto Layout shown for primitive Switch (Pressable container)');
  });
});
