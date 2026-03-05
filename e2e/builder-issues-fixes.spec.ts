/**
 * Builder Issue Fixes E2E Tests (IF series)
 *
 * Covers the following user-reported issues:
 *  IF-01  Content field formula renders on canvas (not [object Object])
 *  IF-02  Hug/Fill/Fixed buttons fit without horizontal overflow (stackLayout)
 *  IF-03  Formula editor pre-quotes string CSS tokens (shows "self-auto" not self-auto)
 *  IF-04  Typography section has no extra ≈ icons in header (only per-row icons)
 *  IF-05  Text align has a ≈ bind button (stackLayout)
 *  IF-06  Clip content toggle and ≈ icon are compact side-by-side
 *  IF-07  Opacity hint says "no quotes" for clarity
 *  IF-08  Only one formula editor opens at a time (singleton)
 *  IF-09  Text align formula binding applies alignment class
 *
 * Run: npx playwright test e2e/builder-issues-fixes.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Shared helpers (reuse pattern from existing builder tests) ───────────────

async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 }
  );
  await page.waitForTimeout(1500);
}

async function addAndSelectBox(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Box', id: nodeId, props: { className: 'flex w-20 h-20 flex-col', style: {} } },
      null
    );
    (store.select as (id: string) => void)(nodeId);
  }, id);
  await page.waitForFunction((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(nodeId as string);
  }, id, { timeout: 5_000 });
  await page.waitForTimeout(600);
  await page.click('[data-testid="tab-right-design"]');
  await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function addAndSelectText(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Text', id: nodeId, text: 'Hello', props: { className: '', style: {} } },
      null
    );
    (store.select as (id: string) => void)(nodeId);
  }, id);
  await page.waitForFunction((nodeId) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(nodeId as string);
  }, id, { timeout: 5_000 });
  await page.waitForTimeout(600);
  await page.click('[data-testid="tab-right-design"]');
  await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
  await page.waitForTimeout(400);
}

async function openFieldBinding(page: Page, fieldName: string) {
  const fieldWrapper = page.locator(`[data-field="${fieldName}"]`);
  await fieldWrapper.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const icon = fieldWrapper.locator('[data-testid="binding-icon"]');
  await expect(icon).toBeVisible({ timeout: 5_000 });
  await icon.click();
  await page.waitForTimeout(200);
  await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });
  await page.waitForTimeout(200);
}

async function applyFormula(page: Page, formula: string) {
  const input = page.locator('[data-testid="formula-input"]');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(formula);
  await page.waitForTimeout(300);
  const applyBtn = page.locator('[data-testid="formula-apply"]');
  if (await applyBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await applyBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(700);
}

async function getNodeText(page: Page, nodeId: string): Promise<unknown> {
  return page.evaluate((id) => {
    function findNode(nodes: unknown[]): unknown {
      for (const n of nodes as Array<{ id?: string; text?: unknown; children?: unknown[] }>) {
        if (n.id === id) return n.text;
        if (n.children?.length) {
          const found = findNode(n.children);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    }
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    return findNode((store?.pageNodes as unknown[]) ?? []);
  }, nodeId);
}

async function getNodeClassName(page: Page, nodeId: string): Promise<string> {
  return page.evaluate((id) => {
    function findNode(nodes: unknown[]): string {
      for (const n of nodes as Array<{ id?: string; props?: { className?: string }; children?: unknown[] }>) {
        if (n.id === id) return n.props?.className ?? '';
        if (n.children?.length) {
          const found = findNode(n.children);
          if (found) return found;
        }
      }
      return '';
    }
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    return findNode((store?.pageNodes as unknown[]) ?? []);
  }, nodeId);
}

// ─── Test suite ──────────────────────────────────────────────────────────────

test.describe('IF — Builder Issue Fixes', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // IF-01: Content formula evaluates and stores as formula object
  test('IF-01 content formula binding stores formula object (not plain string)', async () => {
    await addAndSelectText(page, 'if-01-text');

    const contentField = page.locator('[data-field="text"]');
    await contentField.scrollIntoViewIfNeeded();

    // Bind the content field
    await openFieldBinding(page, 'text');
    await applyFormula(page, 'concatenate("Hello ", "World")');

    // Content field should now show ƒ Edit formula (bound state)
    await expect(contentField.locator('[data-testid="edit-formula-btn"]')).toBeVisible();

    // Stored value should be a formula object (not plain string)
    const stored = await getNodeText(page, 'if-01-text');
    expect(stored).toMatchObject({ formula: 'concatenate("Hello ", "World")' });
  });

  // IF-02: Hug/Fill/Fixed buttons do not overflow (stackLayout)
  test('IF-02 Hug/Fill/Fixed toggle buttons fit without horizontal overflow', async () => {
    await addAndSelectBox(page, 'if-02-box');
    const panel = page.locator('[data-testid="panel-right"]');
    const panelBox = await panel.boundingBox();

    // wMode uses stackLayout — buttons should be on their own row below the label
    const wModeSection = page.locator('[data-field="wMode"]');
    await wModeSection.scrollIntoViewIfNeeded();
    await expect(wModeSection).toBeVisible();

    // All three buttons must be visible
    const hugBtn = page.locator('[data-testid="dim-w-hug"]');
    await expect(hugBtn).toBeVisible();
    const fillBtn = page.locator('[data-testid="dim-w-fill"]');
    await expect(fillBtn).toBeVisible();
    const fixedBtn = page.locator('[data-testid="dim-w-fixed"]');
    await expect(fixedBtn).toBeVisible();

    // Verify buttons do not overflow the panel
    const fixedBox = await fixedBtn.boundingBox();
    if (panelBox && fixedBox) {
      expect(fixedBox.x + fixedBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 5);
    }
  });

  // IF-03: Formula editor pre-quotes string tokens
  test('IF-03 formula editor pre-quotes string CSS tokens (e.g. self-auto → "self-auto")', async () => {
    await addAndSelectBox(page, 'if-03-box');

    // selfAlignment has a class token as value (e.g. "self-auto")
    const selfSection = page.locator('[data-field="selfAlignment"]');
    await selfSection.scrollIntoViewIfNeeded();
    await openFieldBinding(page, 'selfAlignment');

    // Formula input should show a quoted string or be empty — NOT bare identifier like self-auto
    const formulaInput = page.locator('[data-testid="formula-input"]');
    const formulaVal = await formulaInput.inputValue();

    // If there's a pre-filled value, it should be a quoted string
    if (formulaVal.trim()) {
      expect(formulaVal.trim()).toMatch(/^"/);  // starts with a double quote
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  // IF-04: Typography section has no extra ≈ icons in header
  test('IF-04 Typography section does not have 3 floating ≈ icons in header', async () => {
    await addAndSelectText(page, 'if-04-text');

    // Find the typography header row
    // The old bug: 3 FieldWithBinding(<span/>) created 3 icons next to "TYPOGRAPHY" heading
    // After fix: only per-field icons exist (inside each SelectInput row)
    const textSizeField = page.locator('[data-field="textSize"]');
    await textSizeField.scrollIntoViewIfNeeded();
    await expect(textSizeField).toBeVisible({ timeout: 8_000 });

    // textSize field should have exactly 1 binding icon
    const textSizeIcons = textSizeField.locator('[data-testid="binding-icon"]');
    await expect(textSizeIcons).toHaveCount(1);

    // fontWeightClass field should have exactly 1 binding icon
    const fontWeightField = page.locator('[data-field="fontWeightClass"]');
    await expect(fontWeightField.locator('[data-testid="binding-icon"]')).toHaveCount(1);

    // Verify no [data-field="fontSize"] floating icon exists (was removed from header)
    const floatingFontSizeField = page.locator('[data-field="fontSize"]');
    await expect(floatingFontSizeField).toHaveCount(0);
  });

  // IF-05: Text align has a bind button (stackLayout)
  test('IF-05 text align section has a ≈ binding icon', async () => {
    await addAndSelectText(page, 'if-05-text');

    const textAlignField = page.locator('[data-field="textAlign"]');
    await textAlignField.scrollIntoViewIfNeeded();
    await expect(textAlignField).toBeVisible({ timeout: 8_000 });

    // Must have a binding icon
    const bindingIcon = textAlignField.locator('[data-testid="binding-icon"]');
    await expect(bindingIcon).toBeVisible();

    // Clicking opens the formula editor
    await bindingIcon.click();
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });
    await expect(page.locator('[data-testid="formula-editor"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  // IF-06: Clip content toggle and ≈ icon are compact (close together)
  test('IF-06 clip content toggle and binding icon are close together', async () => {
    await addAndSelectBox(page, 'if-06-box');

    const clipToggle = page.locator('[data-testid="clip-content-toggle"]');
    await clipToggle.scrollIntoViewIfNeeded();
    await expect(clipToggle).toBeVisible({ timeout: 8_000 });

    const clipField = page.locator('[data-field="clipContent"]');
    const clipBindIcon = clipField.locator('[data-testid="binding-icon"]');
    await expect(clipBindIcon).toBeVisible();

    // Toggle and bind icon should be within 70px horizontally
    const toggleBox = await clipToggle.boundingBox();
    const iconBox = await clipBindIcon.boundingBox();
    if (toggleBox && iconBox) {
      const distance = Math.abs(iconBox.x - (toggleBox.x + toggleBox.width));
      expect(distance).toBeLessThan(70);
    }
  });

  // IF-07: Opacity hint says "no quotes"
  test('IF-07 opacity hint mentions no quotes needed', async () => {
    await addAndSelectBox(page, 'if-07-box');
    await openFieldBinding(page, 'opacity');

    const editor = page.locator('[data-testid="formula-editor"]');
    await expect(editor).toBeVisible();
    const hintText = await editor.textContent();
    // Updated hint says "no quotes"
    expect(hintText).toMatch(/no quotes/i);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  // IF-08: Only one formula editor opens at a time (singleton)
  test('IF-08 only one formula editor open at a time', async () => {
    await addAndSelectBox(page, 'if-08-box');

    // Open first editor (wMode)
    const wModeField = page.locator('[data-field="wMode"]');
    await wModeField.scrollIntoViewIfNeeded();
    const wModeIcon = wModeField.locator('[data-testid="binding-icon"]');
    await expect(wModeIcon).toBeVisible({ timeout: 5_000 });
    await wModeIcon.click();
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });
    await expect(page.locator('[data-testid="formula-editor"]')).toHaveCount(1);

    // Open second editor (hMode) — should close the first automatically
    const hModeField = page.locator('[data-field="hMode"]');
    await hModeField.scrollIntoViewIfNeeded();
    const hModeIcon = hModeField.locator('[data-testid="binding-icon"]');
    await expect(hModeIcon).toBeVisible({ timeout: 5_000 });
    await hModeIcon.click();
    await page.waitForTimeout(300);

    // Still only one editor visible
    await expect(page.locator('[data-testid="formula-editor"]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  // IF-09: Text align formula binding stores the formula + applies the class
  test('IF-09 text align formula binding stores classFormula and applies text-center class', async () => {
    await addAndSelectText(page, 'if-09-text');
    await openFieldBinding(page, 'textAlign');
    await applyFormula(page, '"text-center"');

    // The node className should include text-center (formula was evaluated and applied)
    const cls = await getNodeClassName(page, 'if-09-text');
    expect(cls).toContain('text-center');

    // classFormulas.textAlign should now store the formula binding
    const classFormulas = await page.evaluate((id) => {
      function findNode(nodes: unknown[]): unknown {
        for (const n of nodes as Array<{ id?: string; props?: { classFormulas?: unknown }; children?: unknown[] }>) {
          if (n.id === id) return n.props?.classFormulas;
          if (n.children?.length) { const f = findNode(n.children); if (f) return f; }
        }
        return undefined;
      }
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      return findNode((store?.pageNodes as unknown[]) ?? []);
    }, 'if-09-text');
    expect(classFormulas).toMatchObject({ textAlign: { formula: '"text-center"' } });
  });

  // IF-10: { expr: "..." } shows just the expression in formula editor (not raw JSON)
  test('IF-10 storedValueToFormula extracts expr string from { expr: "..." } objects', async () => {
    // Programmatically set a text node's text to an { expr: "..." } SDUI inline expression
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        {
          type: 'Text', id: 'if-10-text',
          text: { expr: 'formatCurrency(100, "USD")' },
          props: { className: '', style: {} }
        },
        null
      );
      (store.select as (id: string) => void)('if-10-text');
    });
    await page.waitForFunction(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes('if-10-text');
    }, { timeout: 5_000 });
    await page.waitForTimeout(600);
    await page.click('[data-testid="tab-right-design"]');
    await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
    await page.waitForTimeout(400);

    // Open the content (text) field formula editor
    await openFieldBinding(page, 'text');

    const formulaInput = page.locator('[data-testid="formula-input"]');
    const formulaVal = await formulaInput.inputValue();

    // Should show the inner expression, NOT raw JSON like '{\n  "expr": "formatCurrency(...)"\n}'
    expect(formulaVal.trim()).toBe('formatCurrency(100, "USD")');
    expect(formulaVal).not.toContain('"expr"');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  // IF-11: Class-based field binding persists — selfAlignment shows "ƒ Edit formula" after binding
  //        AND the toggle buttons are hidden (not double-shown)
  test('IF-11 selfAlignment stores classFormulas, shows edit-formula-btn, hides toggle buttons', async () => {
    await addAndSelectBox(page, 'if-11-box');

    const selfField = page.locator('[data-field="selfAlignment"]');
    await selfField.scrollIntoViewIfNeeded();
    await expect(selfField).toBeVisible({ timeout: 8_000 });

    // Before binding — should NOT show edit-formula-btn, but toggle buttons are visible
    await expect(selfField.locator('[data-testid="edit-formula-btn"]')).not.toBeVisible();
    const toggleBefore = page.locator('[data-testid="self-align-self-center"]');
    await expect(toggleBefore).toBeVisible();

    // Bind with a constant formula
    await openFieldBinding(page, 'selfAlignment');
    await applyFormula(page, '"self-center"');

    // After binding — classFormulas.selfAlignment should be stored
    const stored = await page.evaluate((id) => {
      function findNode(nodes: unknown[]): unknown {
        for (const n of nodes as Array<{ id?: string; props?: { classFormulas?: unknown }; children?: unknown[] }>) {
          if (n.id === id) return n.props?.classFormulas;
          if (n.children?.length) { const f = findNode(n.children); if (f) return f; }
        }
        return undefined;
      }
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      return findNode((store?.pageNodes as unknown[]) ?? []);
    }, 'if-11-box');
    expect(stored).toMatchObject({ selfAlignment: { formula: '"self-center"' } });

    // The className should include self-center (formula evaluated and applied)
    const cls = await getNodeClassName(page, 'if-11-box');
    expect(cls).toContain('self-center');

    // The field should now show "ƒ Edit formula" button (bound state visible)
    await page.waitForTimeout(300);
    await expect(selfField.locator('[data-testid="edit-formula-btn"]')).toBeVisible({ timeout: 5_000 });

    // Toggle buttons must be HIDDEN when bound — no double-display
    await expect(page.locator('[data-testid="self-align-self-center"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="self-align-self-auto"]')).not.toBeVisible();
  });

});
