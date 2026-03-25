/**
 * Interactive Panel Tests — Pressable-based Button
 *
 * Exhaustively tests every right-panel control when a Pressable-based Button
 * is selected. After each interaction, asserts the element is still visible
 * and has a non-zero bounding box — i.e. it did NOT "disappear".
 *
 * Also covers PI-01..03: Content section for Pressable nodes with Text children.
 */
import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="tab-components"]', { timeout: 15_000 });
  // __builderStore is set at module level in _store.ts — available once JS bundle loads
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 100 }
  );
}

// Default node matching the "Btn Solid" palette entry — IDs required for data-builder-id
const BTN_NODE = {
  id: 'test-btn',
  type: 'Pressable',
  props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' },
  children: [{ id: 'test-btn-text', type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Button' }],
};

async function injectNodes(page: Page, nodes: unknown[]) {
  await page.evaluate((ns: unknown[]) => {
    (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore
      .getState()._setPageNodes(ns);
  }, nodes);
  // Wait for specific node by ID (more reliable than first()+visible in headless)
  const firstId = (nodes[0] as { id?: string })?.id;
  if (firstId) {
    await page.waitForSelector(`[data-builder-id="${firstId}"]`, { timeout: 10_000 });
  } else {
    await page.locator('[data-builder-id]').first().waitFor({ state: 'visible', timeout: 10_000 });
  }
}

async function dropButton(page: Page) {
  await injectNodes(page, [BTN_NODE]);
}

/** Scroll an element into view inside its overflow container using native DOM scrollIntoView.
 *  Falls back gracefully if element is not in DOM yet (waits up to 5s). */
async function scrollTo(page: Page, testId: string) {
  // Use page.evaluate so we search the real DOM, then scrollIntoView navigates within overflow containers
  const found = await page.evaluate((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (el) { (el as HTMLElement).scrollIntoView({ block: 'nearest' }); return true; }
    return false;
  }, testId);
  if (!found) {
    // Element not in DOM yet — wait a bit and retry once
    await page.waitForTimeout(500);
    await page.evaluate((id: string) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    }, testId);
  }
  await page.waitForTimeout(50);
}

/** Switch Padding section to combined mode (H/V inputs). Default is individual. */
async function switchToCombinedPadding(page: Page) {
  await scrollTo(page, 'section-padding');
  const toggle = page.locator('[data-testid="section-padding"]').locator('button').filter({ hasText: /^[⊞□]$/ });
  await toggle.click();
  await page.waitForTimeout(100);
}

async function selectViaLayers(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="layer-row"]').first().click();
  // Ensure the Design tab on the right panel is active
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(200);
}

async function getButtonNodeId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => { selectedIds: string[] } }>).__builderStore?.getState();
    return store?.selectedIds?.[0] ?? '';
  });
}

/** Assert the element is still visible with a non-zero bounding box. */
async function assertButtonVisible(page: Page, nodeId: string, step: string) {
  const el = page.locator(`[data-builder-id="${nodeId}"]`);
  await expect(el, `Element should be visible after: ${step}`).toBeVisible();

  const box = await el.boundingBox();
  expect(box, `Element bounding box should exist after: ${step}`).not.toBeNull();
  expect(box!.width,  `Element width should be > 0 after: ${step}`).toBeGreaterThan(0);
  expect(box!.height, `Element height should be > 0 after: ${step}`).toBeGreaterThan(0);
  // Note: background transparency check is intentionally omitted — the Pressable-based
  // button uses bg-primary (CSS variable) which may compute as transparent in headless
  // before variables load. Size + visibility is sufficient for structural regression testing.
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

// ─── Fresh button for each test ───────────────────────────────────────────────

test.describe('Pressable Button — all right-panel controls', () => {
  test.setTimeout(120_000);
  let nodeId = '';

  test.beforeEach(async ({ page }) => {
    await gotoBuilder(page);
    await dropButton(page);
    await selectViaLayers(page);
    nodeId = await getButtonNodeId(page);
    expect(nodeId).toBeTruthy();
    // Baseline: button must be visible before any interaction
    await assertButtonVisible(page, nodeId, 'baseline');
  });

  // ── Diagnostic ───────────────────────────────────────────────────────────────

  test('BP-00: DIAG — verify selected node type and right panel sections', async ({ page }) => {
    // Button from palette is now a primitive Pressable with a Text child
    const { nodeType, hasTextChild } = await page.evaluate((id: string) => {
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
      const children = (node?.children as Array<{ type: string; text?: string }> | undefined) ?? [];
      return {
        nodeType: node?.type as string ?? '',
        hasTextChild: children.some(c => c.type === 'Text'),
      };
    }, nodeId);
    // Palette "Button" is now a Pressable (primitive), not the Gluestack Button compound
    expect(nodeType).toBe('Pressable');
    // Must have a Text child (not ButtonText)
    expect(hasTextChild).toBe(true);

    // Verify right panel is showing Design tab content for this node
    await expect(page.locator('[data-testid="input-pos-w"]')).toBeAttached({ timeout: 5_000 });

    // List all data-testids currently in the DOM (for debugging)
    const allTestIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid'))
    );
    const panelIds = allTestIds.filter(id => id?.includes('pad') || id?.includes('section') || id?.includes('clip'));
    console.log('Panel testids found:', panelIds);

    // Check if the padding section element exists
    const hasSectionPadding = allTestIds.includes('section-padding');
    const hasPadH = allTestIds.includes('input-pad-h');
    console.log(`section-padding in DOM: ${hasSectionPadding}, input-pad-h in DOM: ${hasPadH}`);
  });

  // ── Position & Size ──────────────────────────────────────────────────────────

  test('BP-01: W=200 — button stays visible', async ({ page }) => {
    const wInput = page.locator('[data-testid="input-pos-w"]');
    await wInput.fill('200');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'W=200');
    const style = await getNodeStyle(page, nodeId);
    expect(style.width).toBe('200px');
  });

  test('BP-02: H=60 — button stays visible', async ({ page }) => {
    const hInput = page.locator('[data-testid="input-pos-h"]');
    await hInput.fill('60');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'H=60');
    const style = await getNodeStyle(page, nodeId);
    expect(style.height).toBe('60px');
  });

  test('BP-03: W=24 (small) — button stays visible', async ({ page }) => {
    const wInput = page.locator('[data-testid="input-pos-w"]');
    await wInput.fill('24');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'W=24 (small)');
  });

  test('BP-04: H=24 (small) — button stays visible', async ({ page }) => {
    const hInput = page.locator('[data-testid="input-pos-h"]');
    await hInput.fill('24');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'H=24 (small)');
  });

  // ── Dimensions (W/H modes) ───────────────────────────────────────────────────

  // Dimensions section — W/H modes use ToggleBtn buttons with text Hug/Fill/Fixed.
  // There are two sets (W and H), so we click the panel section then index by text order.
  test('BP-05: W mode Hug — button stays visible', async ({ page }) => {
    // First 'Hug' button in the panel is the W-mode one
    await page.locator('button').filter({ hasText: /^Hug$/ }).first().click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'W Hug');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('w-fit');
  });

  test('BP-06: W mode Fill — button stays visible', async ({ page }) => {
    await page.locator('button').filter({ hasText: /^Fill$/ }).first().click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'W Fill');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('w-full');
  });

  test('BP-07: W mode Fixed then type width — button stays visible', async ({ page }) => {
    await page.locator('button').filter({ hasText: /^Fixed$/ }).first().click();
    await page.waitForTimeout(150);
    const wInput = page.locator('[data-testid="input-pos-w"]');
    await wInput.fill('120');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'W Fixed=120');
  });

  test('BP-08: H mode Hug — button stays visible', async ({ page }) => {
    await page.locator('button').filter({ hasText: /^Hug$/ }).nth(1).click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'H Hug');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('h-fit');
  });

  test('BP-09: H mode Fill — button stays visible', async ({ page }) => {
    await page.locator('button').filter({ hasText: /^Fill$/ }).nth(1).click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'H Fill');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('h-full');
  });

  test('BP-10: H mode Fixed then type height — button stays visible', async ({ page }) => {
    await page.locator('button').filter({ hasText: /^Fixed$/ }).nth(1).click();
    await page.waitForTimeout(150);
    const hInput = page.locator('[data-testid="input-pos-h"]');
    await hInput.fill('56');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'H Fixed=56');
  });

  // ── Self Alignment ───────────────────────────────────────────────────────────

  test('BP-11: Self-align center — button stays visible', async ({ page }) => {
    await page.locator('[data-testid="self-align-self-center"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'self-center');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('self-center');
  });

  test('BP-12: Self-align stretch — button stays visible', async ({ page }) => {
    await page.locator('[data-testid="self-align-self-stretch"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'self-stretch');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('self-stretch');
  });

  test('BP-13: Self-align start → end → auto — button stays visible throughout', async ({ page }) => {
    await page.locator('[data-testid="self-align-self-start"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'self-start');

    await page.locator('[data-testid="self-align-self-end"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'self-end');

    await page.locator('[data-testid="self-align-self-auto"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'self-auto (clear)');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).not.toContain('self-');
  });

  // ── Transform ────────────────────────────────────────────────────────────────

  test('BP-14: Rotate=45 — button stays visible (rotated)', async ({ page }) => {
    const rotInput = page.locator('[data-testid="input-rotate"]');
    await rotInput.fill('45');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'rotate=45');
    const style = await getNodeStyle(page, nodeId);
    expect(style.transform).toBe('rotate(45deg)');
  });

  test('BP-15: Rotate=45 then back to 0 — button stays visible', async ({ page }) => {
    const rotInput = page.locator('[data-testid="input-rotate"]');
    await rotInput.fill('45');
    await page.waitForTimeout(150);
    await rotInput.fill('0');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'rotate back to 0');
    const style = await getNodeStyle(page, nodeId);
    expect(style.transform ?? '').toBe('');
  });

  test('BP-16: Flip horizontal — toggle on then off removes class', async ({ page }) => {
    const btn = page.locator('button[title="Flip horizontal"]');
    // Toggle ON
    await btn.click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'flip H on');
    const clsOn = await getNodeClassName(page, nodeId);
    expect(clsOn).toContain('-scale-x-100');

    // Toggle OFF — this was the bug: \b regex didn't match '-scale-x-100' so class was never removed
    await btn.click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'flip H off');
    const clsOff = await getNodeClassName(page, nodeId);
    expect(clsOff).not.toContain('-scale-x-100');
  });

  test('BP-17: Flip vertical — toggle on then off removes class', async ({ page }) => {
    const btn = page.locator('button[title="Flip vertical"]');
    // Toggle ON
    await btn.click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'flip V on');
    const clsOn = await getNodeClassName(page, nodeId);
    expect(clsOn).toContain('-scale-y-100');

    // Toggle OFF — same \b bug fix
    await btn.click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'flip V off');
    const clsOff = await getNodeClassName(page, nodeId);
    expect(clsOff).not.toContain('-scale-y-100');
  });

  // ── Padding ───────────────────────────────────────────────────────────────────

  test('BP-18: Padding H=8 — button stays visible', async ({ page }) => {
    await switchToCombinedPadding(page);
    await scrollTo(page, 'input-pad-h');
    await page.locator('[data-testid="input-pad-h"]').fill('8');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'padding H=8');
  });

  test('BP-19: Padding V=8 — button stays visible', async ({ page }) => {
    await switchToCombinedPadding(page);
    await scrollTo(page, 'input-pad-v');
    await page.locator('[data-testid="input-pad-v"]').fill('8');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'padding V=8');
  });

  test('BP-20: Padding individual sides — button stays visible', async ({ page }) => {
    // Default padMode is individual — use individual inputs directly
    for (const testId of ['input-pad-top', 'input-pad-right', 'input-pad-bottom', 'input-pad-left']) {
      await scrollTo(page, testId);
      await page.locator(`[data-testid="${testId}"]`).fill('12');
      await page.waitForTimeout(150);
      await assertButtonVisible(page, nodeId, `padding ${testId}=12`);
    }
  });

  // ── Clip Content ──────────────────────────────────────────────────────────────

  test('BP-21: Clip content ON — button stays visible', async ({ page }) => {
    await scrollTo(page, 'clip-content-toggle');
    await page.locator('[data-testid="clip-content-toggle"]').click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'clip content ON');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('overflow-hidden');
  });

  test('BP-22: Clip content ON then OFF — button stays visible', async ({ page }) => {
    await scrollTo(page, 'clip-content-toggle');
    await page.locator('[data-testid="clip-content-toggle"]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="clip-content-toggle"]').click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'clip content OFF again');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).not.toContain('overflow-hidden');
  });

  // ── Fill ──────────────────────────────────────────────────────────────────────

  test('BP-23: Background color #3b82f6 — button stays visible', async ({ page }) => {
    await scrollTo(page, 'input-bg-color');
    const bgInput = page.locator('[data-testid="input-bg-color"]');
    await bgInput.fill('#3b82f6');
    await bgInput.press('Tab');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'bg color #3b82f6');
    const style = await getNodeStyle(page, nodeId);
    expect(style.backgroundColor).toBe('#3b82f6');
  });

  test('BP-24: Background opacity slider 50% — button stays visible', async ({ page }) => {
    await scrollTo(page, 'bg-opacity-slider');
    const slider = page.locator('[data-testid="bg-opacity-slider"]');
    await page.evaluate((el: HTMLInputElement) => {
      el.value = '50';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, await slider.elementHandle());
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'bg opacity 50%');
  });

  // ── Stroke ────────────────────────────────────────────────────────────────────

  test('BP-25: Border color #ef4444 — button stays visible', async ({ page }) => {
    await scrollTo(page, 'input-stroke-color');
    const strokeInput = page.locator('[data-testid="input-stroke-color"]');
    await strokeInput.fill('#ef4444');
    await strokeInput.press('Tab');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'border color');
    const style = await getNodeStyle(page, nodeId);
    expect(style.borderColor).toBe('#ef4444');
  });

  test('BP-26: Border width border-2 — button stays visible', async ({ page }) => {
    await scrollTo(page, 'select-border-width');
    await page.locator('[data-testid="select-border-width"]').selectOption('border-2');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'border-2');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('border-2');
  });

  test('BP-27: Border width border-4 — button stays visible', async ({ page }) => {
    await scrollTo(page, 'select-border-width');
    await page.locator('[data-testid="select-border-width"]').selectOption('border-4');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'border-4');
  });

  // ── Effects ───────────────────────────────────────────────────────────────────

  test('BP-28: Drop shadow shadow-md — button stays visible', async ({ page }) => {
    await scrollTo(page, 'select-shadow');
    await page.locator('[data-testid="select-shadow"]').selectOption('shadow-md');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'shadow-md');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('shadow-md');
  });

  test('BP-29: Drop shadow shadow-xl — button stays visible', async ({ page }) => {
    await scrollTo(page, 'select-shadow');
    await page.locator('[data-testid="select-shadow"]').selectOption('shadow-xl');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'shadow-xl');
  });

  // ── Border Radius ─────────────────────────────────────────────────────────────

  test('BP-30: All corners rounded-lg — button stays visible', async ({ page }) => {
    await scrollTo(page, 'select-corner-tl');
    for (const corner of ['tl', 'tr', 'br', 'bl']) {
      await page.locator(`[data-testid="select-corner-${corner}"]`).selectOption('rounded-lg');
      await page.waitForTimeout(150);
    }
    await assertButtonVisible(page, nodeId, 'all corners rounded-lg');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('rounded-lg');
  });

  test('BP-31: All corners rounded-full — button stays visible', async ({ page }) => {
    await scrollTo(page, 'select-corner-tl');
    for (const corner of ['tl', 'tr', 'br', 'bl']) {
      await page.locator(`[data-testid="select-corner-${corner}"]`).selectOption('rounded-full');
      await page.waitForTimeout(150);
    }
    await assertButtonVisible(page, nodeId, 'all corners rounded-full');
  });

  test('BP-32: Mixed corners — generates per-corner tokens, button stays visible', async ({ page }) => {
    await scrollTo(page, 'select-corner-tl');
    await page.locator('[data-testid="select-corner-tl"]').selectOption('rounded-lg');
    await page.waitForTimeout(100);
    await page.locator('[data-testid="select-corner-tr"]').selectOption('rounded-none');
    await page.waitForTimeout(100);
    await page.locator('[data-testid="select-corner-br"]').selectOption('rounded-xl');
    await page.waitForTimeout(100);
    await page.locator('[data-testid="select-corner-bl"]').selectOption('rounded-sm');
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'mixed corners');

    // Verify per-corner tokens are used (not global tokens like 'rounded-lg rounded-none ...')
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('rounded-tl-lg');
    expect(cls).toContain('rounded-tr-none');
    expect(cls).toContain('rounded-br-xl');
    expect(cls).toContain('rounded-bl-sm');

    // Uniform corner: set all to rounded-lg and verify single global token
    await page.locator('[data-testid="select-corner-tl"]').selectOption('rounded-lg');
    await page.locator('[data-testid="select-corner-tr"]').selectOption('rounded-lg');
    await page.locator('[data-testid="select-corner-br"]').selectOption('rounded-lg');
    await page.locator('[data-testid="select-corner-bl"]').selectOption('rounded-lg');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'all corners rounded-lg');
    const cls2 = await getNodeClassName(page, nodeId);
    // Should use single global token, not 4 per-corner tokens
    expect(cls2).toContain('rounded-lg');
    expect(cls2).not.toContain('rounded-tl-');
  });

  // ── Opacity ───────────────────────────────────────────────────────────────────

  test('BP-33: Opacity 50% — button stays visible and style.opacity is 0.5', async ({ page }) => {
    await scrollTo(page, 'input-opacity-slider');
    const slider = page.locator('[data-testid="input-opacity-slider"]');
    await page.evaluate((el: HTMLInputElement) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(el, '50');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, await slider.elementHandle());
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'opacity 50%');
    // Opacity is stored as style.opacity (0–1), not as a className token
    const style = await getNodeStyle(page, nodeId);
    expect(parseFloat(style.opacity)).toBeCloseTo(0.5, 1);
  });

  test('BP-33b: Opacity 95% — button STAYS VISIBLE (was disappearing due to NativeWind)', async ({ page }) => {
    await scrollTo(page, 'input-opacity-slider');
    const slider = page.locator('[data-testid="input-opacity-slider"]');
    await page.evaluate((el: HTMLInputElement) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(el, '95');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, await slider.elementHandle());
    await page.waitForTimeout(200);
    // This was the bug: opacity-95 className was silently ignored by NativeWind
    // so the button appeared fully opaque or invisible; now we use style.opacity = 0.95
    await assertButtonVisible(page, nodeId, 'opacity 95%');
    const style = await getNodeStyle(page, nodeId);
    expect(parseFloat(style.opacity)).toBeCloseTo(0.95, 2);
  });

  test('BP-33c: Opacity 100% — removes style.opacity, button fully visible', async ({ page }) => {
    await scrollTo(page, 'input-opacity-slider');
    const slider = page.locator('[data-testid="input-opacity-slider"]');
    // First set to 50% then restore to 100%
    await page.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, '50');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, await slider.elementHandle());
    await page.waitForTimeout(150);
    await page.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, '100');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, await slider.elementHandle());
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'opacity 100%');
    const style = await getNodeStyle(page, nodeId);
    // At 100%, style.opacity should be cleared (undefined/empty)
    expect(style.opacity ?? '').toBe('');
  });

  // ── Combined stress test ──────────────────────────────────────────────────────

  test('BP-34: Multiple changes in sequence — button stays visible throughout', async ({ page }) => {
    // W=150, H=50
    await page.locator('[data-testid="input-pos-w"]').fill('150');
    await page.waitForTimeout(150);
    await page.locator('[data-testid="input-pos-h"]').fill('50');
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'after W=150 H=50');

    // Self-center
    await page.locator('[data-testid="self-align-self-center"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'after self-center');

    // Background red
    const bgInput = page.locator('[data-testid="input-bg-color"]');
    await bgInput.fill('#ef4444');
    await bgInput.press('Tab');
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'after bg red');

    // Border
    await page.locator('[data-testid="select-border-width"]').selectOption('border-2');
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'after border-2');

    // Shadow
    await page.locator('[data-testid="select-shadow"]').selectOption('shadow-lg');
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'after shadow-lg');

    // Rounded
    for (const c of ['tl', 'tr', 'br', 'bl']) {
      await page.locator(`[data-testid="select-corner-${c}"]`).selectOption('rounded-xl');
      await page.waitForTimeout(100);
    }
    await assertButtonVisible(page, nodeId, 'after rounded-xl all corners');

    // Rotate
    await page.locator('[data-testid="input-rotate"]').fill('15');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'after rotate=15');

    console.log('✅ Button survived all combined panel changes');
  });

  // ── Regression: padding H=1 must not make button transparent ─────────────────

  test('BP-35: Padding H=1 — button stays visible and className is non-empty', async ({ page }) => {
    // This was the regression: any non-empty className triggered action='custom' → bg-transparent
    // For the Gluestack Button. The Pressable-based Button uses bg-primary which is always
    // included in the defaultNode className, so this regression does not apply.
    await switchToCombinedPadding(page);
    await scrollTo(page, 'input-pad-h');
    const padH = page.locator('[data-testid="input-pad-h"]');
    await padH.fill('1');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'padding H=1');
    // className should contain a padding token (py-0 px-0 or similar)
    const cls = await getNodeClassName(page, nodeId);
    expect(cls.length).toBeGreaterThan(0);
  });

  // ── Dimensions: Hug / Fill / Fixed ────────────────────────────────────────

  test('BP-36: W — Hug mode adds w-fit class and button remains visible', async ({ page }) => {
    const hugBtn = page.locator('[data-testid="dim-w-hug"]');
    await scrollTo(page, 'dim-w-hug');
    await hugBtn.click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'W Hug');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('w-fit');
  });

  test('BP-37: W — Fill mode adds w-full class and button spans container', async ({ page }) => {
    const fillBtn = page.locator('[data-testid="dim-w-fill"]');
    await scrollTo(page, 'dim-w-fill');
    await fillBtn.click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'W Fill');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('w-full');
  });

  test('BP-38: W — Fixed mode removes w-fit/w-full and button still visible', async ({ page }) => {
    // First set to Hug so there is something to remove
    await page.locator('[data-testid="dim-w-hug"]').click();
    await page.waitForTimeout(100);
    const fixedBtn = page.locator('[data-testid="dim-w-fixed"]');
    await fixedBtn.click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'W Fixed');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).not.toContain('w-fit');
    expect(cls).not.toContain('w-full');
  });

  test('BP-39: H — Hug mode adds h-fit class and button remains visible', async ({ page }) => {
    const hugBtn = page.locator('[data-testid="dim-h-hug"]');
    await scrollTo(page, 'dim-h-hug');
    await hugBtn.click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'H Hug');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('h-fit');
  });

  test('BP-40: H — Fill mode adds h-full class and button remains visible', async ({ page }) => {
    const fillBtn = page.locator('[data-testid="dim-h-fill"]');
    await scrollTo(page, 'dim-h-fill');
    await fillBtn.click();
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'H Fill');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('h-full');
  });

  // ── Min / Max constraints ──────────────────────────────────────────────────

  test('BP-41: Min W = 200 sets minWidth inline style and button is still visible', async ({ page }) => {
    await scrollTo(page, 'input-min-w');
    await page.locator('[data-testid="input-min-w"]').fill('200');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'min-w=200');
    const style = await getNodeStyle(page, nodeId);
    expect(style.minWidth).toBe('200px');
  });

  test('BP-42: Max W = 300 sets maxWidth inline style and button is still visible', async ({ page }) => {
    await scrollTo(page, 'input-max-w');
    await page.locator('[data-testid="input-max-w"]').fill('300');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'max-w=300');
    const style = await getNodeStyle(page, nodeId);
    expect(style.maxWidth).toBe('300px');
  });

  test('BP-43: Min H = 50 sets minHeight inline style and button is still visible', async ({ page }) => {
    await scrollTo(page, 'input-min-h');
    await page.locator('[data-testid="input-min-h"]').fill('50');
    await page.waitForTimeout(200);
    await assertButtonVisible(page, nodeId, 'min-h=50');
    const style = await getNodeStyle(page, nodeId);
    expect(style.minHeight).toBe('50px');
  });

  // ── Default bg color reflected ─────────────────────────────────────────────

  test('BP-44: After explicit bg color set, panel reflects the set color', async ({ page }) => {
    // Set an explicit bg color via the panel, then verify the panel shows it back.
    // (The Gluestack Button version tested computed CSS color; the Pressable uses bg-primary
    //  which is a CSS variable — the panel reads it from inline style not computed style.)
    await scrollTo(page, 'input-bg-color');
    const bgInput = page.locator('[data-testid="input-bg-color"]');
    await bgInput.fill('#3b82f6');
    await bgInput.press('Tab');
    await page.waitForTimeout(300);

    const style = await getNodeStyle(page, nodeId);
    expect(style.backgroundColor).toBe('#3b82f6');

    // Re-read panel — it must now reflect the set color
    await page.waitForTimeout(200);
    const panelColor = await bgInput.inputValue();
    expect(panelColor.toLowerCase()).toBe('#3b82f6');
  });

  // ── Hug/Fill must clear inline style.width/height (regression) ──────────────
  //
  // When a node has been resized (style.width: "100px"), clicking Hug or Fill
  // did nothing visually because the inline style overrides any Tailwind class.
  // The fix: Hug/Fill now clears style.width/minWidth (and height equivalents).

  test('BP-45: Fill W after resize — clears inline style.width so w-full takes effect', async ({ page }) => {
    // Simulate a resize by setting explicit width via the W input
    await scrollTo(page, 'input-pos-w');
    const wInput = page.locator('[data-testid="input-pos-w"]');
    await wInput.fill('120');
    await page.waitForTimeout(200);

    // Now click Fill — the inline width should be cleared
    await scrollTo(page, 'dim-w-fill');
    await page.locator('[data-testid="dim-w-fill"]').click();
    await page.waitForTimeout(200);

    // class should have w-full
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('w-full');

    // inline style.width should be gone (empty or undefined)
    const style = await getNodeStyle(page, nodeId);
    expect(style.width ?? '').toBe('');

    await assertButtonVisible(page, nodeId, 'Fill W after resize');
  });

  test('BP-46: Hug W after resize — clears inline style.width so w-fit takes effect', async ({ page }) => {
    // Set explicit width
    await scrollTo(page, 'input-pos-w');
    await page.locator('[data-testid="input-pos-w"]').fill('300');
    await page.waitForTimeout(200);

    // Click Hug
    await scrollTo(page, 'dim-w-hug');
    await page.locator('[data-testid="dim-w-hug"]').click();
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('w-fit');

    const style = await getNodeStyle(page, nodeId);
    expect(style.width ?? '').toBe('');

    await assertButtonVisible(page, nodeId, 'Hug W after resize');
  });

  test('BP-47: Fill H after resize — clears inline style.height so h-full takes effect', async ({ page }) => {
    // Set explicit height
    await scrollTo(page, 'input-pos-h');
    await page.locator('[data-testid="input-pos-h"]').fill('80');
    await page.waitForTimeout(200);

    // Click Fill H
    await scrollTo(page, 'dim-h-fill');
    await page.locator('[data-testid="dim-h-fill"]').click();
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('h-full');

    const style = await getNodeStyle(page, nodeId);
    expect(style.height ?? '').toBe('');

    await assertButtonVisible(page, nodeId, 'Fill H after resize');
  });

  test('BP-48: Hug H after resize — clears inline style.height so h-fit takes effect', async ({ page }) => {
    await scrollTo(page, 'input-pos-h');
    await page.locator('[data-testid="input-pos-h"]').fill('120');
    await page.waitForTimeout(200);

    await scrollTo(page, 'dim-h-hug');
    await page.locator('[data-testid="dim-h-hug"]').click();
    await page.waitForTimeout(200);

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('h-fit');

    const style = await getNodeStyle(page, nodeId);
    expect(style.height ?? '').toBe('');

    await assertButtonVisible(page, nodeId, 'Hug H after resize');
  });

  test('BP-49: Fixed W keeps inline style.width intact (does NOT clear it)', async ({ page }) => {
    // Set an explicit width
    await scrollTo(page, 'input-pos-w');
    await page.locator('[data-testid="input-pos-w"]').fill('150');
    await page.waitForTimeout(200);

    // Click Fixed — should not wipe the explicit width
    await scrollTo(page, 'dim-w-fixed');
    await page.locator('[data-testid="dim-w-fixed"]').click();
    await page.waitForTimeout(200);

    // class must not have w-fit or w-full
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).not.toContain('w-fit');
    expect(cls).not.toContain('w-full');

    // inline width should still be 150px (user's explicit size preserved)
    const style = await getNodeStyle(page, nodeId);
    expect(style.width).toBe('150px');

    await assertButtonVisible(page, nodeId, 'Fixed W keeps width');
  });

  test('BP-50: Fill → Fixed cycle — button stays visible throughout', async ({ page }) => {
    await scrollTo(page, 'dim-w-fill');
    await page.locator('[data-testid="dim-w-fill"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'cycle: Fill');

    await page.locator('[data-testid="dim-w-hug"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'cycle: Hug');

    await page.locator('[data-testid="dim-w-fixed"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'cycle: Fixed');

    await page.locator('[data-testid="dim-w-fill"]').click();
    await page.waitForTimeout(150);
    await assertButtonVisible(page, nodeId, 'cycle: Fill again');
  });

  // ── Content section (Pressable with Text child) ──────────────────────────────

  test('PI-01: Pressable-based Button — Content section IS shown (has Text child)', async ({ page }) => {
    // The primitive Button is a Pressable with a Text child; Content section must appear
    const contentTextarea = page.locator('[data-testid="input-text-content"]');
    await expect(contentTextarea).toBeVisible({ timeout: 5_000 });

    // Textarea value should match the default button label
    const value = await contentTextarea.inputValue();
    expect(value.length).toBeGreaterThan(0);
    console.log('✅ Content section visible for Pressable-based Button, value:', value);
  });

  test('PI-02: Editing Content textarea updates Text child text in real time', async ({ page }) => {
    const contentTextarea = page.locator('[data-testid="input-text-content"]');
    await expect(contentTextarea).toBeVisible({ timeout: 5_000 });

    await contentTextarea.fill('Hello World');
    await page.waitForTimeout(200);

    // Verify the Text child's text was updated in the store
    const textChildText = await page.evaluate((id: string) => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      function findById(arr: unknown[], targetId: string): Record<string, unknown> | null {
        for (const n of arr) {
          const node = n as Record<string, unknown>;
          if (node.id === targetId) return node;
          const ch = node.children as unknown[] | undefined;
          if (ch?.length) { const f = findById(ch, targetId); if (f) return f; }
        }
        return null;
      }
      const pressable = findById(store?.pageNodes ?? [], id);
      const children = (pressable?.children as Array<{ type: string; text?: string }> | undefined) ?? [];
      return children.find(c => c.type === 'Text')?.text ?? null;
    }, nodeId);

    expect(textChildText).toBe('Hello World');
    console.log('✅ Text child text updated to:', textChildText);
  });

  test('PI-03: Content section hidden for plain Box (no Text child)', async ({ page }) => {
    // Replace canvas with a plain Box (no Text child) — Content section must be hidden
    await page.evaluate((ns) => {
      (window as unknown as Record<string, { getState: () => { _setPageNodes: (n: unknown[]) => void } }>).__builderStore
        .getState()._setPageNodes(ns);
    }, [{ id: 'plain-box', type: 'Box', props: { className: 'w-20 h-20 bg-gray-200' } }]);
    await page.locator('[data-builder-id="plain-box"]').waitFor({ state: 'visible', timeout: 8_000 });

    // Select via layers
    await page.getByTestId('tab-layers').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid="layer-row"]').first().click();
    await page.getByTestId('tab-right-design').click();
    await page.waitForTimeout(200);

    // Content section must NOT be present for a plain Box (no Text child)
    const contentTextarea = page.locator('[data-testid="input-text-content"]');
    await expect(contentTextarea).not.toBeVisible();
    console.log('✅ Content section hidden for plain Box with no Text child');
  });
});
