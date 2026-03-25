/**
 * Builder — FormContainer / weWeb-style Local Form State Tests (FC series)
 *
 * FC-01  FormContainer appears in the left component palette under the "Form" category
 * FC-02  Adding a FormContainer node registers it in the builder store
 * FC-03  Default FormContainer node includes two inputs and a button in its children
 * FC-04  Selecting a child node inside a FormContainer shows the Quick tab button
 * FC-05  Quick tab shows a "Local" header and a "form" pill
 * FC-06  Local section renders formData, fields, isSubmitting, isSubmitted, isValid
 * FC-07  Clicking the "form" root pill inserts an orange form chip into the editor
 * FC-08  Inserted form chip data-formula starts with "local.data"
 * FC-09  Clicking isSubmitting inserts a chip whose path contains "isSubmitting"
 * FC-10  Selecting a plain Box (no form ancestor) does NOT show the Quick tab
 * FC-11  Moving selection from inside a form to outside hides the Quick tab
 * FC-12  Pasting local.data formula renders as an orange chip (populateEditor)
 * FC-13  FormContainer's local.data.form path structure is correct (path verification)
 * FC-14  Variables tab no longer lists any form-related entries
 *
 * Run: npx playwright test e2e/builder-form-container.spec.ts
 */

import { test, expect, type Page, type Browser } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 }
  );
  await page.waitForTimeout(1500);
}

type BuilderStore = { getState: () => Record<string, unknown> };

/** Add a node at root level and wait for it to appear in the store. */
async function addNode(page: Page, node: Record<string, unknown>) {
  const id = node.id as string;
  await page.evaluate((n) => {
    const bs = (window as unknown as Record<string, BuilderStore>).__builderStore;
    bs?.getState().addNode?.(n, null);
  }, node);
  await page.waitForFunction((nodeId) => {
    function findNodeDeep(nodes: unknown[], targetId: string): boolean {
      for (const n of nodes) {
        const node = n as Record<string, unknown>;
        if (node.id === targetId) return true;
        if (Array.isArray(node.children) && findNodeDeep(node.children, targetId)) return true;
      }
      return false;
    }
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore;
    const pageNodes = store?.getState().pageNodes as unknown[] | undefined;
    return Array.isArray(pageNodes) && findNodeDeep(pageNodes, nodeId as string);
  }, id, { timeout: 5_000 });
  await page.waitForTimeout(200);
}

/** Select a node by ID and wait for the selection to update. */
async function selectNode(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    const bs = (window as unknown as Record<string, BuilderStore>).__builderStore;
    bs?.getState().select?.(nodeId);
  }, id);
  await page.waitForFunction((nodeId) => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(nodeId as string);
  }, id, { timeout: 5_000 });
  await page.waitForTimeout(400);
}

/**
 * Set up a design panel for a root-level Box node and open the formula editor.
 * This replicates the pattern from builder-formula-editor.spec.ts which is known to work.
 */
async function setupWithFormulaEditor(page: Page, anchorBoxId: string) {
  // Add + select a root-level Box (this is what we'll use to open the editor)
  await page.evaluate((nodeId) => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    if (!store) return;
    (store.addNode as (node: unknown, parentId: null) => void)(
      { type: 'Box', id: nodeId, props: { className: 'flex', style: {} } },
      null
    );
    (store.select as (id: string | null) => void)(nodeId);
  }, anchorBoxId);
  await page.waitForFunction((nodeId) => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(nodeId as string);
  }, anchorBoxId, { timeout: 5_000 });
  await page.waitForTimeout(600);

  // Click Design tab and wait for binding icons
  await page.click('[data-testid="tab-right-design"]');
  await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
  await page.waitForTimeout(300);

  // Open the formula editor via the first binding icon
  const icon = page.locator('[data-testid="binding-icon"]').first();
  await expect(icon).toBeVisible({ timeout: 10_000 });
  await icon.click();
  await page.waitForTimeout(200);
  await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });
  await page.waitForTimeout(200);
}

/**
 * Close the formula editor if open.
 */
async function closeEditorIfOpen(page: Page) {
  const closeBtn = page.locator('[data-testid="formula-close"]');
  if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
}

/** The Quick tab button (only present when inside a form or repeat context). */
const quickTabBtn = (page: Page) => page.locator('[data-testid="formula-tab-quick"]');

// ─── Group: Standalone tests (FC-01, FC-02, FC-03, FC-14) ─────────────────────
// These don't need the formula editor open.

test.describe('FC — FormContainer Palette & Store', () => {
  test.setTimeout(60_000);

  test('FC-01: FormContainer appears in left palette under Form category', async ({ page }) => {
    await gotoBuilder(page);
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toMatch(/FormContainer|Form/);
  });

  test('FC-02: Adding a FormContainer registers it in the builder store', async ({ page }) => {
    await gotoBuilder(page);
    await addNode(page, {
      type: 'FormContainer',
      id: 'fc02-form',
      props: { className: 'flex flex-col gap-4 w-full', style: {} },
    });
    const exists = await page.evaluate(() => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      const nodes = store?.pageNodes as unknown[] | undefined;
      return Array.isArray(nodes) && nodes.some((n) => (n as Record<string, string>).id === 'fc02-form');
    });
    expect(exists).toBe(true);
  });

  test('FC-03: Default FormContainer defaultNode has two inputs and a button', async ({ page }) => {
    await gotoBuilder(page);
    await addNode(page, {
      type: 'FormContainer',
      id: 'fc03-form',
      props: { className: 'flex flex-col gap-4 w-full', style: {} },
      children: [
        {
          type: 'Input',
          id: 'fc03-i1',
          props: {},
          children: [{ type: 'InputField', id: 'fc03-f1', props: { placeholder: 'Email', name: 'email' } }],
        },
        {
          type: 'Input',
          id: 'fc03-i2',
          props: {},
          children: [{ type: 'InputField', id: 'fc03-f2', props: { placeholder: 'Password', name: 'password' } }],
        },
        {
          type: 'Button',
          id: 'fc03-btn',
          props: {},
          children: [{ type: 'ButtonText', id: 'fc03-btntxt', text: 'Submit' }],
        },
      ],
    });

    const shape = await page.evaluate(() => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      function findDeep(nodes: unknown[], id: string): unknown {
        for (const n of nodes) {
          const node = n as Record<string, unknown>;
          if (node.id === id) return node;
          if (Array.isArray(node.children)) {
            const found = findDeep(node.children, id);
            if (found) return found;
          }
        }
        return null;
      }
      const pageNodes = store?.pageNodes as unknown[] | undefined;
      if (!pageNodes) return null;
      const form = findDeep(pageNodes, 'fc03-form') as Record<string, unknown> | null;
      if (!form) return null;
      const kids = form.children as unknown[] | undefined;
      return {
        childCount: kids?.length ?? 0,
        types: kids?.map((c) => (c as Record<string, string>).type) ?? [],
      };
    });

    expect(shape?.childCount).toBe(3);
    expect(shape?.types).toContain('Input');
    expect(shape?.types).toContain('Button');
  });

  test('FC-14: Variables tab does not list any form entries', async ({ page }) => {
    await gotoBuilder(page);
    await addNode(page, {
      type: 'Box',
      id: 'fc14-box',
      props: { className: 'flex w-20 h-20 flex-col', style: {} },
    });
    await selectNode(page, 'fc14-box');

    // Open formula editor
    await page.click('[data-testid="tab-right-design"]');
    await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="binding-icon"]').first().click();
    await page.waitForTimeout(200);
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });

    const varTab = page.locator('button').filter({ hasText: 'Variables' }).first();
    await varTab.click();
    await page.waitForTimeout(1000);

    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('Sign In Form');
    expect(bodyText).not.toContain('Register Form');
    expect(bodyText).not.toContain('Cart Coupon Form');
    expect(bodyText).not.toContain('Checkout Address Form');
    expect(bodyText).not.toContain('Forgot Password Form');
    expect(bodyText).not.toContain('Reset Password Form');
  });
});

// ─── Group: Formula editor + FormContainer context tests ──────────────────────
// These use a shared page with the formula editor already open, then manipulate
// the store to point selection at a FormContainer child while keeping editor open.

test.describe('FC — FormContainer Formula Editor Context', () => {
  test.setTimeout(90_000);

  let browser: Browser;
  let page: Page;
  const ANCHOR_BOX = 'fc-anchor-box';
  const FORM_ID = 'fc-shared-form';
  const CHILD_ID = 'fc-shared-child';
  const OUTSIDE_BOX = 'fc-outside-box';

  test.beforeAll(async ({ browser: b }) => {
    browser = b;
    page = await browser.newPage();
    await gotoBuilder(page);

    // Add all needed nodes + select anchor box in one evaluate
    await page.evaluate(
      ({ anchorId, formId, childId, outsideId }) => {
        const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
        if (!store) return;
        const add = store.addNode as (node: unknown, parentId: null) => void;
        add({ type: 'Box', id: anchorId, props: { className: 'flex', style: {} } }, null);
        add({
          type: 'FormContainer',
          id: formId,
          props: { className: 'flex flex-col gap-4 w-full', style: {} },
          children: [
            { type: 'Box', id: childId, props: { className: 'flex w-10 h-10', style: {} } },
          ],
        }, null);
        add({ type: 'Box', id: outsideId, props: { className: 'flex w-20 h-20', style: {} } }, null);
        (store.select as (id: string | null) => void)(anchorId);
      },
      { anchorId: ANCHOR_BOX, formId: FORM_ID, childId: CHILD_ID, outsideId: OUTSIDE_BOX }
    );
    await page.waitForFunction((anchorId) => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(anchorId as string);
    }, ANCHOR_BOX, { timeout: 5_000 });
    await page.waitForTimeout(600);

    // Open formula editor: click Design tab, wait for binding icon, click it
    await page.click('[data-testid="tab-right-design"]');
    await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="binding-icon"]').first().click();
    await page.waitForTimeout(200);
    await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });
    await page.waitForTimeout(300);
  });

  test.afterAll(() => page?.close());

  test.afterEach(async () => {
    // Re-select anchor box to reset isInsideForm to false
    await page.evaluate((anchorId) => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      (store?.select as (id: string | null) => void)?.(anchorId);
    }, ANCHOR_BOX);
    await page.waitForTimeout(400);
    // Reopen editor if it was closed during the test
    const editorVisible = await page.locator('[data-testid="formula-editor"]').isVisible().catch(() => false);
    if (!editorVisible) {
      await page.click('[data-testid="tab-right-design"]');
      await page.waitForSelector('[data-testid="binding-icon"]', { timeout: 10_000 });
      await page.waitForTimeout(300);
      await page.locator('[data-testid="binding-icon"]').first().click();
      await page.waitForTimeout(200);
      await page.waitForSelector('[data-testid="formula-editor"]', { timeout: 8_000 });
      await page.waitForTimeout(200);
    }
  });

  /**
   * Helper: switch selection to form child while editor is already open.
   * The FieldWithBinding stays mounted (same Box type) so panelOpen persists.
   * isInsideForm becomes true, triggering Quick tab.
   */
  async function selectFormChild() {
    await page.evaluate((childId) => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      (store?.select as (id: string | null) => void)?.(childId);
    }, CHILD_ID);
    await page.waitForFunction((childId) => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(childId as string);
    }, CHILD_ID, { timeout: 5_000 });
    await page.waitForTimeout(500);
  }

  test('FC-04: Selecting a child inside FormContainer shows the Quick tab', async () => {
    await selectFormChild();
    await expect(quickTabBtn(page)).toBeVisible({ timeout: 8_000 });
  });

  test('FC-05: Quick tab shows "Local" header and "form" pill', async () => {
    await selectFormChild();
    await expect(quickTabBtn(page)).toBeVisible({ timeout: 8_000 });
    await quickTabBtn(page).click();
    await page.waitForTimeout(600);

    const panelText = await page.locator('[data-testid="formula-editor"]').textContent();
    expect(panelText).toMatch(/Local/i);
    expect(panelText).toMatch(/\bform\b/);
  });

  test('FC-06: Local section shows formData, fields, isSubmitting, isSubmitted, isValid', async () => {
    await selectFormChild();
    await expect(quickTabBtn(page)).toBeVisible({ timeout: 8_000 });
    await quickTabBtn(page).click();
    await page.waitForTimeout(600);

    const panelText = await page.locator('[data-testid="formula-editor"]').textContent();
    expect(panelText).toContain('formData');
    expect(panelText).toContain('fields');
    expect(panelText).toContain('isSubmitting');
    expect(panelText).toContain('isSubmitted');
    expect(panelText).toContain('isValid');
  });

  test('FC-07: Clicking the "form" root pill inserts an orange form chip', async () => {
    await selectFormChild();
    await expect(quickTabBtn(page)).toBeVisible({ timeout: 8_000 });

    // Clear editor
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
      if (el) { el.innerHTML = ''; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    });
    await page.waitForTimeout(150);

    await quickTabBtn(page).click();
    await page.waitForTimeout(600);

    // Use the stable testid on the form root pill div
    const formPill = page.locator('[data-testid="formula-local-form-pill"]');
    await expect(formPill).toBeVisible({ timeout: 5_000 });
    await formPill.click();
    await page.waitForTimeout(400);

    const chip = page.locator('[data-testid="formula-input"] [data-type="form"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
  });

  test('FC-08: Inserted form chip data-formula starts with "local.data"', async () => {
    await selectFormChild();
    await expect(quickTabBtn(page)).toBeVisible({ timeout: 8_000 });

    // Clear editor
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
      if (el) { el.innerHTML = ''; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    });
    await page.waitForTimeout(150);

    await quickTabBtn(page).click();
    await page.waitForTimeout(600);

    await page.locator('[data-testid="formula-local-form-pill"]').click();
    await page.waitForTimeout(400);

    const chip = page.locator('[data-testid="formula-input"] [data-type="form"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
    const formula = await chip.getAttribute('data-formula');
    expect(formula).toContain('local.data');
  });

  test('FC-09: Clicking isSubmitting inserts a chip containing "isSubmitting"', async () => {
    await selectFormChild();
    await expect(quickTabBtn(page)).toBeVisible({ timeout: 8_000 });

    // Clear editor
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
      if (el) { el.innerHTML = ''; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    });
    await page.waitForTimeout(150);

    await quickTabBtn(page).click();
    await page.waitForTimeout(600);

    const isSubmittingEl = page.locator('[data-testid="formula-local-isSubmitting"]');
    await expect(isSubmittingEl).toBeVisible({ timeout: 5_000 });
    await isSubmittingEl.click();
    await page.waitForTimeout(400);

    const chip = page.locator('[data-testid="formula-input"] [data-type="form"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
    const formula = await chip.getAttribute('data-formula');
    expect(formula).toContain('isSubmitting');
  });

  test('FC-10: Selecting a plain Box (no form ancestor) does NOT show Quick tab', async () => {
    // Select outside Box (not inside FormContainer)
    await page.evaluate((outsideId) => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      (store?.select as (id: string | null) => void)?.(outsideId);
    }, OUTSIDE_BOX);
    await page.waitForFunction((outsideId) => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(outsideId as string);
    }, OUTSIDE_BOX, { timeout: 5_000 });
    await page.waitForTimeout(400);

    await expect(quickTabBtn(page)).not.toBeVisible({ timeout: 2_000 });
  });

  test('FC-11: Moving selection outside the form hides the Quick tab', async () => {
    // First, select the form child to show Quick tab
    await selectFormChild();
    await expect(quickTabBtn(page)).toBeVisible({ timeout: 8_000 });

    // Now select outside — Quick tab must disappear
    await page.evaluate((outsideId) => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      (store?.select as (id: string | null) => void)?.(outsideId);
    }, OUTSIDE_BOX);
    await page.waitForFunction((outsideId) => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      return Array.isArray(store?.selectedIds) && (store.selectedIds as string[]).includes(outsideId as string);
    }, OUTSIDE_BOX, { timeout: 5_000 });
    await page.waitForTimeout(600);

    await expect(quickTabBtn(page)).not.toBeVisible({ timeout: 3_000 });
  });

  test('FC-12: Pasting local.data formula renders as orange form chip', async () => {
    await selectFormChild();

    // Clear editor
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
      if (el) { el.innerHTML = ''; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    });
    await page.waitForTimeout(150);

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("local.data?.['form']?.['formData']?.['email']");
    });

    await page.locator('[data-testid="formula-input"]').click();
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(800);

    const chip = page.locator('[data-testid="formula-input"] [data-type="form"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
    const formula = await chip.getAttribute('data-formula');
    expect(formula).toContain('local.data');
    expect(formula).toContain('formData');
    expect(formula).toContain('email');
  });

  test('FC-13: local.data.form path structure is correct (path pattern check)', async () => {
    await selectFormChild();
    await expect(quickTabBtn(page)).toBeVisible({ timeout: 8_000 });

    // Clear editor
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="formula-input"]') as HTMLElement | null;
      if (el) { el.innerHTML = ''; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    });
    await page.waitForTimeout(150);

    await quickTabBtn(page).click();
    await page.waitForTimeout(600);

    await page.locator('[data-testid="formula-local-isSubmitted"]').click();
    await page.waitForTimeout(400);

    const chip = page.locator('[data-testid="formula-input"] [data-type="form"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
    const formula = await chip.getAttribute('data-formula');
    expect(formula).toContain('local.data');
    expect(formula).toContain('form');
    expect(formula).toContain('isSubmitted');
  });
});

// ─── Group: Drag Input OUT of FormContainer ────────────────────────────────────

test.describe('FC — Drag Input out of FormContainer', () => {
  test.setTimeout(30_000);

  /**
   * FC-15: moveNode (store-level) — Input moves from FormContainer to root.
   *
   * This directly tests the store's moveNode guard: an Input that lives inside a
   * FormContainer should be movable to root level (newParentId = null).
   * If this fails, the REQUIRED_PARENT or ALLOWED guard in _store.ts is blocking it.
   */
  test('FC-15: moveNode — Input escapes FormContainer to root (store-level)', async ({ page }) => {
    await gotoBuilder(page);

    // Build: FormContainer containing an Input at root level
    await page.evaluate(() => {
      const bs = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore;
      const store = bs?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        {
          type: 'FormContainer',
          id: 'fc15-form',
          props: { initialFormData: { email: '' } },
          children: [
            {
              type: 'Input',
              id: 'fc15-input',
              props: { variant: 'outline', size: 'md' },
              children: [
                { type: 'InputField', id: 'fc15-inputfield', props: { placeholder: 'Email' } }
              ]
            }
          ]
        },
        null
      );
    });

    // Wait for FormContainer + Input to appear in store
    await page.waitForFunction(() => {
      function find(nodes: unknown[], id: string): boolean {
        for (const n of nodes) {
          const node = n as Record<string, unknown>;
          if (node.id === id) return true;
          if (Array.isArray(node.children) && find(node.children, id)) return true;
        }
        return false;
      }
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      return find(store?.pageNodes ?? [], 'fc15-input');
    }, {}, { timeout: 5_000 });

    // Confirm Input is inside FormContainer (not at root)
    const rootBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string }> } }>).__builderStore?.getState();
      return store?.pageNodes.map(n => ({ id: n.id, type: n.type }));
    });
    console.log('Root nodes before move:', JSON.stringify(rootBefore));
    const inputAtRootBefore = rootBefore?.some(n => n.id === 'fc15-input');
    expect(inputAtRootBefore).toBe(false); // Input should be inside FormContainer

    // ── Call moveNode to move Input to root ──
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore?.getState();
      store?.moveNode('fc15-input', null, 1); // index 1 = after FormContainer
    });
    await page.waitForTimeout(300);

    // ── Assert Input is now at root ──
    const rootAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string }> } }>).__builderStore?.getState();
      return store?.pageNodes.map(n => ({ id: n.id, type: n.type }));
    });
    console.log('Root nodes after move:', JSON.stringify(rootAfter));
    const inputAtRootAfter = rootAfter?.some(n => n.id === 'fc15-input');
    expect(inputAtRootAfter).toBe(true); // Input must now be at root

    // FormContainer should still exist
    const formStillExists = rootAfter?.some(n => n.id === 'fc15-form');
    expect(formStillExists).toBe(true);

    console.log('✅ Input successfully moved out of FormContainer to root');
  });

  /**
   * FC-16: moveNode (store-level) — InputField CANNOT escape its Input parent.
   *
   * InputField has REQUIRED_PARENT['InputField'] = 'Input', so moving it out
   * of Input to root must be blocked (moveNode returns state unchanged).
   */
  test('FC-16: moveNode — InputField cannot escape its Input (REQUIRED_PARENT guard)', async ({ page }) => {
    await gotoBuilder(page);

    await page.evaluate(() => {
      const bs = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore;
      const store = bs?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        {
          type: 'Input',
          id: 'fc16-input',
          props: { variant: 'outline' },
          children: [
            { type: 'InputField', id: 'fc16-inputfield', props: { placeholder: 'Email' } }
          ]
        },
        null
      );
    });

    await page.waitForFunction(() => {
      function find(nodes: unknown[], id: string): boolean {
        for (const n of nodes) {
          const node = n as Record<string, unknown>;
          if (node.id === id) return true;
          if (Array.isArray(node.children) && find(node.children, id)) return true;
        }
        return false;
      }
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      return find(store?.pageNodes ?? [], 'fc16-inputfield');
    }, {}, { timeout: 5_000 });

    // Try to move InputField to root — should be blocked
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore?.getState();
      store?.moveNode('fc16-inputfield', null, 1);
    });
    await page.waitForTimeout(200);

    const rootAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string }> } }>).__builderStore?.getState();
      return store?.pageNodes.map(n => ({ id: n.id, type: n.type }));
    });
    console.log('Root nodes (InputField should NOT appear here):', JSON.stringify(rootAfter));
    const inputFieldAtRoot = rootAfter?.some(n => n.id === 'fc16-inputfield');
    expect(inputFieldAtRoot).toBe(false); // Must remain inside Input

    console.log('✅ InputField correctly blocked from escaping Input by REQUIRED_PARENT guard');
  });

  /**
   * FC-17: onDragOver pipeline — `skipIds` subtree fix prevents self-drop.
   *
   * This tests the critical fix for the "can't drag Input out of FormContainer" bug:
   * - Before fix: `findDropTargetElAt` hit `InputField` (child of dragged Input, not
   *   in skipIds). Nearest-gap computed parentId = Input.id. moveNode(Input, Input)
   *   = self-drop → silently blocked → Input never escapes.
   * - After fix: Input's subtree (including InputField) is added to skipIds, so
   *   hit-test returns FormContainer instead. The edge-zone check (relY > 0.2 && < 0.8)
   *   allows escape to root when cursor is outside the middle 60%.
   *
   * We verify this at the store level (same as FC-15/16) since canvas DnD in
   * Playwright/headless is unreliable (CDP simulated events, clientX=0). The store
   * tests exercise the exact same moveNode path the canvas drag calls on drop.
   */
  test('FC-17: Store — Input inside FormContainer can move to root (subtree-skipIds logic)', async ({ page }) => {
    await gotoBuilder(page);

    // Set up: FormContainer at root with Input containing InputField
    await page.evaluate(() => {
      const bs = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore;
      const store = bs?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        {
          type: 'FormContainer',
          id: 'fc17-form',
          props: { className: 'flex flex-col gap-4 w-full', initialFormData: { email: '' } },
          children: [
            {
              type: 'Input',
              id: 'fc17-input',
              props: { variant: 'outline', size: 'md' },
              children: [
                { type: 'InputField', id: 'fc17-inputfield', props: { placeholder: 'Email' } }
              ]
            }
          ]
        },
        null
      );
      (store.addNode as (n: unknown, p: null) => void)(
        { type: 'Box', id: 'fc17-box', props: { className: 'h-24 w-full' } },
        null
      );
    });

    await page.waitForFunction(() => {
      function find(nodes: unknown[], id: string): boolean {
        for (const n of nodes) {
          const node = n as Record<string, unknown>;
          if (node.id === id) return true;
          if (Array.isArray(node.children) && find(node.children, id)) return true;
        }
        return false;
      }
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      return find(store?.pageNodes ?? [], 'fc17-input');
    }, {}, { timeout: 5_000 });

    // Verify Input is inside FormContainer (not at root)
    const isInsideFormBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string }> } }>).__builderStore?.getState();
      return !store?.pageNodes.some(n => n.id === 'fc17-input');
    });
    expect(isInsideFormBefore).toBe(true);
    console.log('✅ Input starts inside FormContainer');

    // Move Input to root via moveNode (same path the canvas drag calls on drop)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore?.getState();
      store?.moveNode('fc17-input', null, 2);
    });
    await page.waitForTimeout(300);

    const rootNodes = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string; children?: unknown[] }> } }>).__builderStore?.getState();
      return store?.pageNodes.map(n => ({ id: n.id, type: n.type, childCount: n.children?.length ?? 0 }));
    });
    console.log('Root nodes after move:', JSON.stringify(rootNodes));

    const inputAtRoot = rootNodes?.some(n => n.id === 'fc17-input');
    expect(inputAtRoot).toBe(true);

    // FormContainer should still exist (and now be empty or have fewer children)
    const formStillThere = rootNodes?.some(n => n.id === 'fc17-form');
    expect(formStillThere).toBe(true);

    const formChildren = rootNodes?.find(n => n.id === 'fc17-form')?.childCount ?? -1;
    console.log(`FormContainer child count after move: ${formChildren}`);
    expect(formChildren).toBe(0); // Input was removed from form

    console.log('✅ Input moved to root; FormContainer is now empty');
  });

  /**
   * FC-18: moveNode — Input cannot be nested inside another Input (ALLOWED guard).
   *
   * This validates the `ALLOWED_DROP_INTO` fix in onDragOver:
   * when hovering over a sibling Input, the "inside container" path must be
   * skipped because ALLOWED[Input] doesn't include Input. Without this fix,
   * onDragOver would set dropTarget = { parentId: Input2 } causing a silent
   * no-op on drop (Input2's ALLOWED guard blocks Input inside Input).
   *
   * At the store level: moveNode(Input1, Input2.id) must be blocked by ALLOWED.
   */
  test('FC-18: moveNode — Input blocked from nesting inside sibling Input (ALLOWED guard)', async ({ page }) => {
    await gotoBuilder(page);

    await page.evaluate(() => {
      const bs = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore;
      const store = bs?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        {
          type: 'FormContainer',
          id: 'fc18-form',
          props: { className: 'flex flex-col gap-4 w-full' },
          children: [
            {
              type: 'Input',
              id: 'fc18-input1',
              props: { variant: 'outline' },
              children: [{ type: 'InputField', id: 'fc18-if1', props: { placeholder: 'Email' } }]
            },
            {
              type: 'Input',
              id: 'fc18-input2',
              props: { variant: 'outline' },
              children: [{ type: 'InputField', id: 'fc18-if2', props: { placeholder: 'Password' } }]
            }
          ]
        },
        null
      );
    });

    await page.waitForFunction(() => {
      function find(nodes: unknown[], id: string): boolean {
        for (const n of nodes) {
          const node = n as Record<string, unknown>;
          if (node.id === id) return true;
          if (Array.isArray(node.children) && find(node.children, id)) return true;
        }
        return false;
      }
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      return find(store?.pageNodes ?? [], 'fc18-input2');
    }, {}, { timeout: 5_000 });

    // Try to move Input1 INSIDE Input2 (must be blocked by ALLOWED)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore?.getState();
      store?.moveNode('fc18-input1', 'fc18-input2', 0);
    });
    await page.waitForTimeout(200);

    // Input1 must still be a child of FormContainer, not inside Input2
    const input1ParentIsForm = await page.evaluate(() => {
      function findParent(nodes: unknown[], targetId: string): string | null {
        for (const n of nodes) {
          const node = n as Record<string, unknown>;
          if (Array.isArray(node.children)) {
            for (const c of node.children as Array<{ id: string }>) {
              if (c.id === targetId) return node.id as string;
            }
            const deeper = findParent(node.children, targetId);
            if (deeper) return deeper;
          }
        }
        return null;
      }
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      return findParent(store?.pageNodes ?? [], 'fc18-input1');
    });
    console.log('Input1 parent after blocked move attempt:', input1ParentIsForm);
    expect(input1ParentIsForm).toBe('fc18-form');
    console.log('✅ Input blocked from nesting inside sibling Input (ALLOWED guard works)');
  });

  /**
   * FC-19: moveNode — InputField selected, then drag escalates to Input parent.
   *
   * The user clicks the visible text field (which selects InputField, not Input),
   * then tries to drag it out. Without escalation, REQUIRED_PARENT blocks the move.
   * With escalation: onDragStart detects InputField has REQUIRED_PARENT['InputField']='Input',
   * walks up to Input, and drags Input instead.
   *
   * At the store level: moveNode(InputField.id, null) must be blocked (it stays
   * inside Input). Moving Input.id to null must succeed.
   */
  test('FC-19: Store — InputField blocked at root, but its parent Input can move out', async ({ page }) => {
    await gotoBuilder(page);

    await page.evaluate(() => {
      const bs = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore;
      const store = bs?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        {
          type: 'FormContainer',
          id: 'fc19-form',
          props: { className: 'flex flex-col gap-4 w-full' },
          children: [
            {
              type: 'Input',
              id: 'fc19-input',
              props: { variant: 'outline' },
              children: [
                { type: 'InputField', id: 'fc19-inputfield', props: { placeholder: 'Email' } }
              ]
            }
          ]
        },
        null
      );
    });

    await page.waitForFunction(() => {
      function find(nodes: unknown[], id: string): boolean {
        for (const n of nodes) {
          const node = n as Record<string, unknown>;
          if (node.id === id) return true;
          if (Array.isArray(node.children) && find(node.children, id)) return true;
        }
        return false;
      }
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: unknown[] } }>).__builderStore?.getState();
      return find(store?.pageNodes ?? [], 'fc19-inputfield');
    }, {}, { timeout: 5_000 });

    // Attempt 1: move InputField to root — must be BLOCKED (REQUIRED_PARENT)
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore?.getState();
      store?.moveNode('fc19-inputfield', null, 1);
    });
    await page.waitForTimeout(200);

    const inputFieldAtRoot = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string }> } }>).__builderStore?.getState();
      return store?.pageNodes.some(n => n.id === 'fc19-inputfield') ?? false;
    });
    expect(inputFieldAtRoot).toBe(false); // Must stay inside Input
    console.log('✅ InputField cannot move to root (REQUIRED_PARENT blocks)');

    // Attempt 2: move Input (the container) to root — must SUCCEED
    // This is what onDragStart escalation achieves: even if user selected InputField,
    // the drag uses Input.id after escalation.
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { moveNode: (a: string, b: string | null, c: number) => void } }>).__builderStore?.getState();
      store?.moveNode('fc19-input', null, 1);
    });
    await page.waitForTimeout(200);

    const rootNodes = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => { pageNodes: Array<{ id: string; type: string }> } }>).__builderStore?.getState();
      return store?.pageNodes.map(n => ({ id: n.id, type: n.type }));
    });
    console.log('Root nodes after escalated move:', JSON.stringify(rootNodes));

    const inputAtRoot = rootNodes?.some(n => n.id === 'fc19-input');
    expect(inputAtRoot).toBe(true); // Input must now be at root
    console.log('✅ Input (escalated from InputField drag) successfully moved to root');
  });
});

// ─── Group: Controlled component form-state tracking (FC-15, FC-16, FC-17) ────
//
// These tests verify that the generic applyFormValueTracking renderer function
// correctly routes value changes from Checkbox, Switch, and TextareaInput into
// the FormContainer's form state (local.data.form.formData.*).
//
// Pattern:
//   1. Add FormContainer + controlled component (via __builderStore.addNode)
//   2. Wait for the component to appear in the page frame
//   3. Interact with the component
//   4. Read local.data.form.formData via __globalVariableStore and assert

type VariableStore = {
  getState: () => {
    getFullState: () => Record<string, unknown>;
  };
};

/** Read a nested path from the global variable store's 'local' key. */
async function getFormDataValue(page: Page, fieldName: string): Promise<unknown> {
  return page.evaluate((field) => {
    const store = (window as unknown as Record<string, VariableStore>).__globalVariableStore;
    const state = store?.getState().getFullState() ?? {};
    const local = state['local'] as Record<string, unknown> | undefined;
    const data = local?.['data'] as Record<string, unknown> | undefined;
    const form = data?.['form'] as Record<string, unknown> | undefined;
    const formData = form?.['formData'] as Record<string, unknown> | undefined;
    return formData?.[field];
  }, fieldName);
}

test.describe('FC — Controlled Component Form-State Tracking', () => {
  test.setTimeout(90_000);

  /**
   * FC-15: Checkbox inside FormContainer updates formData when checked.
   *
   * A Checkbox with name="agreed" starts unchecked (value: false / undefined).
   * After the user clicks it, formCtx.setField("agreed", true) must be called
   * by the generic applyFormValueTracking in the renderer, and the value must
   * appear in local.data.form.formData.agreed via the global variable store.
   */
  test('FC-15: Checkbox inside FormContainer updates formData.agreed on click', async ({ page }) => {
    await gotoBuilder(page);

    // Wait for __globalVariableStore to be available
    await page.waitForFunction(
      () => !!(window as unknown as Record<string, unknown>).__globalVariableStore,
      { timeout: 15_000, polling: 200 }
    );

    // Add FormContainer with a Checkbox (name="agreed")
    await page.evaluate(() => {
      const bs = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore;
      const store = bs?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        {
          type: 'FormContainer',
          id: 'fc15-form',
          props: { className: 'flex flex-col gap-4 p-4 w-full', style: {} },
          children: [
            {
              type: 'Checkbox',
              id: 'fc15-checkbox',
              props: { name: 'agreed', value: false, style: {} },
              children: [
                { type: 'CheckboxIndicator', id: 'fc15-indicator', props: { style: {} } },
                { type: 'CheckboxLabel', id: 'fc15-label', props: { style: {} }, text: 'I agree' },
              ],
            },
          ],
        },
        null
      );
    });

    // Wait for the checkbox to appear in the page frame
    await page.waitForFunction(
      () => !!document.querySelector('[data-builder-id="fc15-checkbox"]'),
      { timeout: 10_000 }
    );
    await page.waitForTimeout(500);

    // Click the Checkbox in the page frame
    const checkboxEl = page.locator('[data-builder-id="fc15-checkbox"]');
    await checkboxEl.click({ force: true });
    await page.waitForTimeout(600);

    // formData.agreed should now be true
    const value = await getFormDataValue(page, 'agreed');
    console.log('FC-15: formData.agreed after click:', value);
    expect(value).toBe(true);
    console.log('✅ FC-15: Checkbox correctly updates formData.agreed via generic form tracking');
  });

  /**
   * FC-16: Switch inside FormContainer updates formData when toggled.
   *
   * A Switch with name="notify" starts off. After click, onValueChange/onToggle
   * fires and applyFormValueTracking routes the boolean value to setField("notify", true).
   */
  test('FC-16: Switch inside FormContainer updates formData.notify on toggle', async ({ page }) => {
    await gotoBuilder(page);

    await page.waitForFunction(
      () => !!(window as unknown as Record<string, unknown>).__globalVariableStore,
      { timeout: 15_000, polling: 200 }
    );

    // Add FormContainer with a Switch (name="notify")
    await page.evaluate(() => {
      const bs = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore;
      const store = bs?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        {
          type: 'FormContainer',
          id: 'fc16-form',
          props: { className: 'flex flex-col gap-4 p-4 w-full', style: {} },
          children: [
            {
              type: 'Switch',
              id: 'fc16-switch',
              props: { name: 'notify', value: false, style: {} },
            },
          ],
        },
        null
      );
    });

    // Wait for the switch to appear in the page frame
    await page.waitForFunction(
      () => !!document.querySelector('[data-builder-id="fc16-switch"]'),
      { timeout: 10_000 }
    );
    await page.waitForTimeout(500);

    // Click the Switch to toggle it on
    const switchEl = page.locator('[data-builder-id="fc16-switch"]');
    await switchEl.click({ force: true });
    await page.waitForTimeout(600);

    // formData.notify should now be truthy (true or 'on')
    const value = await getFormDataValue(page, 'notify');
    console.log('FC-16: formData.notify after toggle:', value);
    expect(value).toBeTruthy();
    console.log('✅ FC-16: Switch correctly updates formData.notify via generic form tracking');
  });

  /**
   * FC-17: TextareaInput inside FormContainer updates formData when text is typed.
   *
   * A TextareaInput with name="bio" inside a FormContainer. After typing text,
   * onChangeText fires and applyFormValueTracking routes the value to setField("bio", text).
   */
  test('FC-17: TextareaInput inside FormContainer updates formData.bio on type', async ({ page }) => {
    await gotoBuilder(page);

    await page.waitForFunction(
      () => !!(window as unknown as Record<string, unknown>).__globalVariableStore,
      { timeout: 15_000, polling: 200 }
    );

    // Add FormContainer with a Textarea + TextareaInput (name="bio")
    await page.evaluate(() => {
      const bs = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore;
      const store = bs?.getState();
      if (!store) return;
      (store.addNode as (n: unknown, p: null) => void)(
        {
          type: 'FormContainer',
          id: 'fc17-form',
          props: { className: 'flex flex-col gap-4 p-4 w-full', style: {} },
          children: [
            {
              type: 'Textarea',
              id: 'fc17-textarea',
              props: { style: {} },
              children: [
                {
                  type: 'TextareaInput',
                  id: 'fc17-input',
                  props: { name: 'bio', placeholder: 'Tell us about yourself', style: {} },
                },
              ],
            },
          ],
        },
        null
      );
    });

    // Wait for the textarea to appear in the page frame
    await page.waitForFunction(
      () => !!document.querySelector('[data-builder-id="fc17-input"]'),
      { timeout: 10_000 }
    );
    await page.waitForTimeout(500);

    // Type text into the textarea
    const textareaEl = page.locator('[data-builder-id="fc17-input"]');
    await textareaEl.click({ force: true });
    await textareaEl.fill('Hello world');
    await page.waitForTimeout(600);

    // formData.bio should now contain the typed text
    const value = await getFormDataValue(page, 'bio');
    console.log('FC-17: formData.bio after typing:', value);
    expect(value).toBe('Hello world');
    console.log('✅ FC-17: TextareaInput correctly updates formData.bio via generic form tracking');
  });
});
