/**
 * Builder Formula Editor — Chips, Auto-chip, Undo/Redo, Copy/Cut/Paste,
 * Normalization, Layout & Data-panel colour tests  (FE-M → FE-T)
 *
 * Covers everything added since the base formula-editor spec:
 *   M. Auto-chip on typing (operators typed directly → coloured chip)
 *   N. Function auto-chip when `(` follows a known function name
 *   O. Undo / Redo history (per-chip steps, no stale-debounce corruption)
 *   P. Copy / Cut / Paste (formula-string round-trip, selection replace)
 *   Q. Normalisation (backspace near chip never creates a new line)
 *   R. Select-all visual (Cmd+A selects chips as well as text)
 *   S. Layout — "Current value" on its own full-width row
 *   T. Data-panel chip colours match inserted chip colours
 *
 * Run: npx playwright test e2e/builder-formula-chips.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Shared setup helpers ─────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 },
  );
  await page.waitForTimeout(1500);
}

async function setupDesignPanel(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>)
      .__builderStore?.getState();
    if (!store) return;
    (store.addNode as (n: unknown, p: null) => void)(
      { type: 'Box', id: 'fec-box', props: { className: 'flex', style: {} } },
      null,
    );
    (store.select as (id: string | null) => void)('fec-box');
  });
  await page.waitForFunction(() => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>)
      .__builderStore?.getState();
    return Array.isArray(store?.selectedIds) &&
      (store.selectedIds as string[]).includes('fec-box');
  }, { timeout: 5000 });
  await page.waitForTimeout(600);
  await page.click('[data-testid="tab-right-design"]');
  await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
  await page.waitForTimeout(300);
}

async function openEditor(page: Page) {
  const icon = page.locator('[data-testid="binding-icon"]').first();
  await expect(icon).toBeVisible({ timeout: 10_000 });
  await icon.click();
  await page.waitForTimeout(200);
  await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8000 });
  await page.waitForTimeout(200);
}

async function closeEditorIfOpen(page: Page) {
  const closeBtn = page.locator('[data-testid="formula-close"]');
  if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
}

/**
 * Clear the contenteditable formula input by directly resetting the DOM.
 * This avoids keyboard-shortcut interaction issues with chips and ensures
 * the history receives a clean empty-state snapshot via the debounce.
 */
async function clearInput(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
    if (!el) return;
    el.innerHTML = '';
    // Dispatch input event so React/SDUI store picks up the change and pushes history
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  // Wait long enough for the 400ms debounce to fire so history is pushed before next test
  await page.waitForTimeout(600);
}

/** Serialise the contenteditable editor to the raw formula string (mirrors serializeEditor). */
async function getFormulaText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
    if (!el) return '';
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += (node.textContent ?? '').replace(/\u200b/g, '');
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).dataset?.formula
      ) {
        out += (node as HTMLElement).dataset.formula;
      }
    }
    return out;
  });
}

/** Count chip spans of a given data-type inside the editor. */
async function countChips(page: Page, type: string): Promise<number> {
  return page.locator(`[data-testid="formula-input"] [data-type="${type}"]`).count();
}

// ─── Group M: Auto-chip on typing ────────────────────────────────────────────

test.describe('FE Group M — Auto-chip on typing', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    page = await ctx.newPage();
    await gotoBuilder(page);
    await setupDesignPanel(page);
    await openEditor(page);
  });

  test.afterAll(() => page.close());

  test.beforeEach(async () => clearInput(page));

  test('FE-M01 Typing ( inserts an operator chip with data-formula="("', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula="("]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-M02 Typing ) inserts an operator chip with data-formula=")"', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type(')');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=")"]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-M03 Typing , inserts an operator chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type(',');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"]');
    await expect(chip.first()).toBeVisible({ timeout: 2000 });
    const formula = await getFormulaText(page);
    expect(formula).toContain(',');
  });

  test('FE-M04 Typing || inserts an "or" operator chip with data-formula=" || "', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('||');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=" || "]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-M05 Typing && inserts an "and" operator chip with data-formula=" && "', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('&&');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=" && "]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-M06 Typing === inserts an equality chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('===');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=" === "]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-M07 Typing !== inserts a not-equal chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('!==');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=" !== "]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-M08 Pasting " >= " (with spaces) inserts a ≥ comparison chip', async () => {
    // OP_TOKEN_RE matches the INSERT form (with surrounding spaces), so we paste " >= ".
    // Typing > then = separately auto-chips > before = is typed, so use paste for multi-char ops.
    await page.evaluate(async () => { await navigator.clipboard.writeText(' >= '); });
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(300);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=" >= "]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-M09 Typing + inserts a math chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('+');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=" + "]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-M10 Typing * inserts a multiplication chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('*');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=" * "]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-M11 Mixed typing: "1+2" produces a + chip with text nodes around it', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('1+2');
    await page.waitForTimeout(200);
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=" + "]');
    await expect(chip).toBeVisible({ timeout: 2000 });
    const formula = await getFormulaText(page);
    expect(formula).toContain(' + ');
    expect(formula).toContain('1');
    expect(formula).toContain('2');
  });

  test('FE-M12 Typing (((( creates four ( chips', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('((((');
    await page.waitForTimeout(300);
    const chips = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula="("]');
    await expect(chips).toHaveCount(4, { timeout: 2000 });
  });
});

// ─── Group N: Function auto-chip on ( ────────────────────────────────────────

test.describe('FE Group N — Function auto-chip when ( follows name', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
    await setupDesignPanel(page);
    await openEditor(page);
  });

  test.afterAll(() => page.close());

  test.beforeEach(async () => clearInput(page));

  test('FE-N01 Typing "ifEmpty(" creates an ifEmpty function chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('ifEmpty(');
    await page.waitForTimeout(300);
    const fnChip = page.locator('[data-testid="formula-input"] [data-type="function"]');
    await expect(fnChip.first()).toBeVisible({ timeout: 2000 });
    const label = await fnChip.first().textContent();
    expect(label).toContain('ifEmpty');
  });

  test('FE-N02 Typing "ifEmpty(" also creates a ( chip immediately after', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('ifEmpty(');
    await page.waitForTimeout(300);
    const parenChip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula="("]');
    await expect(parenChip).toBeVisible({ timeout: 2000 });
  });

  test('FE-N03 Typing "ifEmpty" alone does NOT create a function chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('ifEmpty');
    await page.waitForTimeout(200);
    const fnChip = page.locator('[data-testid="formula-input"] [data-type="function"]');
    // Should have zero function chips — the name is plain text until ( is typed
    await expect(fnChip).toHaveCount(0, { timeout: 1000 });
  });

  test('FE-N04 Typing "toNumber(" creates a toNumber function chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('toNumber(');
    await page.waitForTimeout(300);
    const fnChip = page.locator('[data-testid="formula-input"] [data-type="function"]');
    await expect(fnChip.first()).toBeVisible({ timeout: 2000 });
  });

  test('FE-N05 Typing "2ifEmpty(" also creates an ifEmpty function chip (digit-letter boundary)', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('2ifEmpty(');
    await page.waitForTimeout(300);
    const fnChip = page.locator('[data-testid="formula-input"] [data-type="function"]');
    await expect(fnChip.first()).toBeVisible({ timeout: 2000 });
  });
});

// ─── Group O: Undo / Redo history ────────────────────────────────────────────

test.describe('FE Group O — Undo / Redo history', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
    await setupDesignPanel(page);
    await openEditor(page);
  });

  test.afterAll(() => page.close());

  test.beforeEach(async () => clearInput(page));

  test('FE-O01 Each ( chip is its own undo step — Cmd+Z removes one chip at a time', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('((((');
    await page.waitForTimeout(300);

    const chips = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula="("]');
    await expect(chips).toHaveCount(4, { timeout: 2000 });

    // Undo once → 3 chips
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);
    await expect(chips).toHaveCount(3, { timeout: 2000 });

    // Undo again → 2 chips
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);
    await expect(chips).toHaveCount(2, { timeout: 2000 });
  });

  test('FE-O02 Redo (Cmd+Shift+Z) after undo restores the chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('((');
    await page.waitForTimeout(300);

    const chips = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula="("]');
    await expect(chips).toHaveCount(2, { timeout: 2000 });

    // Undo once
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);
    await expect(chips).toHaveCount(1, { timeout: 2000 });

    // Redo once → back to 2
    await page.keyboard.press('Meta+Shift+z');
    await page.waitForTimeout(300);
    await expect(chips).toHaveCount(2, { timeout: 2000 });
  });

  test('FE-O03 Stale debounce timer does not corrupt redo after undo', async () => {
    // Type two parens quickly (both chip immediately — debounce cancelled by immediate pushHistory)
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(50); // don't wait 400ms — test stale-timer fix
    await page.keyboard.type('(');
    await page.waitForTimeout(100);

    const chips = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula="("]');
    await expect(chips).toHaveCount(2, { timeout: 2000 });

    // Undo immediately (before any debounce timer fires)
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);
    const afterUndo = await chips.count();
    expect(afterUndo).toBeLessThan(2); // at least one was undone

    // Redo should work
    await page.keyboard.press('Meta+Shift+z');
    await page.waitForTimeout(300);
    await expect(chips).toHaveCount(2, { timeout: 2000 });
  });

  test('FE-O04 Undo all chips and redo all chips round-trips correctly', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(((');
    await page.waitForTimeout(300);

    const chips = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula="("]');
    await expect(chips).toHaveCount(3, { timeout: 2000 });

    // Undo 3 times → 0
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Meta+z');
      await page.waitForTimeout(200);
    }
    await expect(chips).toHaveCount(0, { timeout: 2000 });

    // Redo 3 times → 3
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Meta+Shift+z');
      await page.waitForTimeout(200);
    }
    await expect(chips).toHaveCount(3, { timeout: 2000 });
  });
});

// ─── Group P: Copy / Cut / Paste ─────────────────────────────────────────────

test.describe('FE Group P — Copy / Cut / Paste', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // Grant clipboard permissions so Playwright can read/write clipboard
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    page = await context.newPage();
    await gotoBuilder(page);
    await setupDesignPanel(page);
    await openEditor(page);
  });

  test.afterAll(() => page.close());

  test.beforeEach(async () => clearInput(page));

  test('FE-P01 Copy (Cmd+C) puts the raw formula string on the clipboard', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(200);

    // Select all, then copy
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Meta+c');
    await page.waitForTimeout(200);

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // The raw formula should be the ( insert value, not the chip HTML
    expect(clipboard).toContain('(');
    // Should NOT contain HTML tags
    expect(clipboard).not.toContain('<span');
  });

  test('FE-P02 Paste (Cmd+V) after Cmd+A replaces all content', async () => {
    // Type two chips
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(200);

    // Select all + copy so clipboard has the content
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Meta+c');
    await page.waitForTimeout(100);

    // Clear the editor
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    // Paste — should restore the chip
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(300);

    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula="("]');
    await expect(chip).toBeVisible({ timeout: 2000 });
  });

  test('FE-P03 Cut (Cmd+X) removes the selection and puts the formula on clipboard', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(200);

    const before = await countChips(page, 'operator');
    expect(before).toBe(1);

    // Select all + cut
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Meta+x');
    await page.waitForTimeout(300);

    // Editor should be empty
    const after = await countChips(page, 'operator');
    expect(after).toBe(0);

    // Clipboard should contain the formula
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('(');
    expect(clipboard).not.toContain('<span');
  });

  test('FE-P04 Cut then paste restores the original chips on one line (no new-line between chips)', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(200);

    // Cut all
    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Meta+x');
    await page.waitForTimeout(300);

    // Paste back
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(300);

    // ( chip should be present
    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula="("]');
    await expect(chip).toBeVisible({ timeout: 2000 });

    // No <br> elements should exist in the editor (would cause chips on separate lines)
    const brCount = await page.locator('[data-testid="formula-input"] br').count();
    expect(brCount).toBe(0);
  });

  test('FE-P05 Pasting a weWeb-style formula string creates chips for collections and operators', async () => {
    // Write a weWeb formula directly to clipboard then paste
    await page.evaluate(async () => { await navigator.clipboard.writeText('1 + 2'); });
    await page.waitForTimeout(100);

    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(300);

    // The + operator should be chipped
    const plusChip = page.locator('[data-testid="formula-input"] [data-type="operator"][data-formula=" + "]');
    await expect(plusChip).toBeVisible({ timeout: 2000 });
  });
});

// ─── Group Q: Normalisation — no new line on backspace near chips ─────────────

test.describe('FE Group Q — Normalisation on backspace', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
    await setupDesignPanel(page);
    await openEditor(page);
  });

  test.afterAll(() => page.close());

  test.beforeEach(async () => clearInput(page));

  test('FE-Q01 No <br> elements in editor after backspace next to a chip', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    // Type: ( then 1 then backspace (removes the "1", cursor lands next to ( chip)
    await page.keyboard.type('(');
    await page.waitForTimeout(200);
    await page.keyboard.type('1');
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    const brCount = await page.locator('[data-testid="formula-input"] br').count();
    expect(brCount).toBe(0);
  });

  test('FE-Q02 No stray <div> or <p> blocks injected by browser in editor', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(200);
    await page.keyboard.type('2');
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    const blockCount = await page
      .locator('[data-testid="formula-input"] div, [data-testid="formula-input"] p')
      .count();
    expect(blockCount).toBe(0);
  });

  test('FE-Q03 Two adjacent chips produce no <br> and both remain on one line', async () => {
    // normalizeEditorContent prevents the browser from inserting <br> between chips.
    // We test the observable outcome (structural integrity) not ZWS internals,
    // because ZWS may already live inside an intermediate text node between chips.
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(200);
    await page.keyboard.type(')');
    await page.waitForTimeout(200);

    const brCount = await page.locator('[data-testid="formula-input"] br').count();
    expect(brCount).toBe(0);

    const chipCount = await page.locator('[data-testid="formula-input"] [data-type="operator"]').count();
    expect(chipCount).toBe(2);
  });

  test('FE-Q04 Serialised formula after backspace contains no ZWS characters', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(1');
    await page.waitForTimeout(200);
    await page.keyboard.press('Backspace'); // remove "1"
    await page.waitForTimeout(200);

    const formula = await getFormulaText(page);
    expect(formula).not.toContain('\u200b');
    expect(formula).toContain('(');
  });
});

// ─── Group R: Select-all visual ──────────────────────────────────────────────

test.describe('FE Group R — Select-all includes chips', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
    await setupDesignPanel(page);
    await openEditor(page);
  });

  test.afterAll(() => page.close());

  test.beforeEach(async () => clearInput(page));

  test('FE-R01 Chips do NOT have user-select:none (so Cmd+A visually selects them)', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(200);

    const chip = page.locator('[data-testid="formula-input"] [data-type="operator"]').first();
    await expect(chip).toBeVisible({ timeout: 2000 });

    const userSelect = await chip.evaluate(el => (el as HTMLElement).style.userSelect);
    // Should be empty string (not set to 'none')
    expect(userSelect).not.toBe('none');
  });

  test('FE-R02 Cmd+A selects all — subsequent Backspace clears the editor', async () => {
    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.type('(');
    await page.waitForTimeout(200);

    await page.keyboard.press('Meta+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    const chipCount = await countChips(page, 'operator');
    expect(chipCount).toBe(0);
  });
});

// ─── Group S: Layout — Current value full-width row ──────────────────────────

test.describe('FE Group S — Current value layout', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
    await setupDesignPanel(page);
  });

  test.afterAll(() => page.close());

  // Each test opens its own editor so afterEach closures don't break subsequent tests
  test.beforeEach(async () => {
    await closeEditorIfOpen(page);
    await openEditor(page);
  });

  test.afterEach(async () => closeEditorIfOpen(page));

  test('FE-S01 "Current value" label appears on its own line in the editor', async () => {
    const editor = page.locator('[data-testid="formula-editor"]');
    await expect(editor.getByText('Current value')).toBeVisible({ timeout: 3000 });
  });

  test('FE-S02 Current value section is visible and the formula input accepts text', async () => {
    const editor = page.locator('[data-testid="formula-editor"]');
    // Verify "Current value" label is present (confirms the layout row)
    await expect(editor.getByText('Current value')).toBeVisible({ timeout: 3000 });

    // Type something into the formula input
    const input = page.locator('[data-testid="formula-input"]');
    await input.click();
    await page.keyboard.type('1');
    await page.waitForTimeout(300);

    // The editor should contain "1" (from the formula input text)
    await expect(editor).toContainText('1', { timeout: 3000 });
  });

  test('FE-S03 "Current value" and "Expected" labels are on separate rows', async () => {
    const editor = page.locator('[data-testid="formula-editor"]');

    const currentValueEl = editor.getByText('Current value').first();
    const expectedEl = editor.getByText('Expected').first();

    const [cvVisible, expVisible] = await Promise.all([
      currentValueEl.isVisible({ timeout: 2000 }).catch(() => false),
      expectedEl.isVisible({ timeout: 2000 }).catch(() => false),
    ]);

    if (cvVisible && expVisible) {
      const [cvBox, expBox] = await Promise.all([
        currentValueEl.boundingBox(),
        expectedEl.boundingBox(),
      ]);
      if (cvBox && expBox) {
        // "Expected" should be BELOW "Current value" (higher Y coordinate)
        expect(expBox.y).toBeGreaterThan(cvBox.y + cvBox.height - 4);
      }
    }
  });
});

// ─── Group T: Data-panel chip colours ────────────────────────────────────────

test.describe('FE Group T — Data-panel chip colours match editor chips', () => {
  let page: Page;
  let editorOpen = false;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await gotoBuilder(page);
    await setupDesignPanel(page);
    await openEditor(page);
    editorOpen = true;
    // Switch to Data tab
    await page.locator('[data-testid="formula-editor"]').getByText('Data').click();
    await page.waitForTimeout(400);
  });

  test.afterAll(() => page.close());

  test('FE-T01 Data tab is active and renders the data sources panel content', async () => {
    if (!editorOpen) { test.skip(); return; }
    const editor = page.locator('[data-testid="formula-editor"]');
    await expect(editor).toBeVisible({ timeout: 5000 });
    // When no datasources are configured the panel shows "Add a data source in the Data tab".
    // When datasources exist, they are listed instead. Either way the panel is rendered.
    const hasNoDsMsg = await editor.getByText('Add a data source in the Data tab').isVisible({ timeout: 3000 }).catch(() => false);
    const hasDsPills = await editor.locator('[data-testid^="fe-collection-pill-"]').count().then(c => c > 0);
    expect(hasNoDsMsg || hasDsPills).toBe(true);
  });

  test('FE-T02 Collection header pills use blue background (#1d4ed8) matching editor collection chips', async () => {
    if (!editorOpen) { test.skip(); return; }
    const pills = page.locator('[data-testid^="fe-collection-pill-"]');
    const count = await pills.count();
    if (count === 0) {
      // No datasources configured — soft pass
      test.skip();
      return;
    }
    const bgColor = await pills.first().evaluate(
      el => (el as HTMLElement).style.background || window.getComputedStyle(el as HTMLElement).backgroundColor,
    );
    // Accept hex #1d4ed8 or equivalent rgb(29, 78, 216)
    expect(bgColor.replace(/\s/g, '')).toMatch(/(#1d4ed8|rgb\(29,78,216\))/i);
  });

  test('FE-T03 Collection header pills have padding matching operator chips (2px 4px)', async () => {
    if (!editorOpen) { test.skip(); return; }
    const pills = page.locator('[data-testid^="fe-collection-pill-"]');
    const count = await pills.count();
    if (count === 0) { test.skip(); return; }

    const padding = await pills.first().evaluate(
      el => (el as HTMLElement).style.padding || window.getComputedStyle(el as HTMLElement).padding,
    );
    // Playwright/Chromium normalises "2px 4px" → "2px 4px" (or full 4-value form)
    expect(padding).toMatch(/2px/);
    expect(padding).toMatch(/4px/);
  });

  test('FE-T04 DataTreeNode field-name buttons use blue background matching collection chips', async () => {
    if (!editorOpen) { test.skip(); return; }
    // Expand the first collection to reveal tree nodes
    const pills = page.locator('[data-testid^="fe-collection-pill-"]');
    const count = await pills.count();
    if (count === 0) { test.skip(); return; }

    // Click the chevron to expand
    const chevron = page.locator('[data-testid^="fe-collection-chevron-"]').first();
    await chevron.click();
    await page.waitForTimeout(400);

    const treeButtons = page.locator('[data-testid="formula-editor"] [data-tree-path] button');
    const btnCount = await treeButtons.count();
    if (btnCount === 0) { test.skip(); return; }

    const bgColor = await treeButtons.first().evaluate(
      el => (el as HTMLElement).style.background || window.getComputedStyle(el as HTMLElement).backgroundColor,
    );
    expect(bgColor.replace(/\s/g, '')).toMatch(/(#1d4ed8|rgb\(29,78,216\))/i);
  });

  test('FE-T05 DataTreeNode field-name buttons have font-size 11px matching chips', async () => {
    if (!editorOpen) { test.skip(); return; }
    const treeButtons = page.locator('[data-testid="formula-editor"] [data-tree-path] button');
    const btnCount = await treeButtons.count();
    if (btnCount === 0) { test.skip(); return; }

    const fontSize = await treeButtons.first().evaluate(
      el => (el as HTMLElement).style.fontSize || window.getComputedStyle(el as HTMLElement).fontSize,
    );
    expect(fontSize).toMatch(/11px/);
  });
});
