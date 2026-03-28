/**
 * Builder — Settings Tab Tests (ST series)
 *
 * ST-01  Settings tab button is visible in the right panel
 * ST-02  Selecting any node and opening Settings tab shows the Name field
 * ST-03  Typing in the Name field updates node.name in the store
 * ST-04  Selecting a Button node in Settings tab shows a Submit toggle
 * ST-05  Submit toggle On → actions.click.type === 'submitForm'
 * ST-06  Submit toggle Off → click action removed
 * ST-07  Selecting an Input inside FormContainer shows Form container label + Field name
 * ST-08  Changing Field name updates node.props.name
 * ST-09  Input type dropdown exists and changing to 'email' sets props.type = 'email'
 * ST-10  Custom validation Off hides formula button; On reveals it
 * ST-11  Input type: Short answer → props.type = 'text'
 * ST-12  Input type: Long answer → props.type = 'textarea'
 * ST-13  Input type: Search → props.type = 'search'
 * ST-14  Input type: Password → props.type = 'password'
 * ST-15  Input type: Number → props.type = 'number'
 * ST-16  Input type: Decimal → props.type = 'number', props.step = '0.01'
 * ST-17  Input type: Date → props.type = 'date'
 * ST-18  Input type: Time → props.type = 'time'
 * ST-19  Input type: Phone → props.type = 'tel'
 * ST-20  Input type: Color → props.type = 'color'
 * ST-21  Input type: Currency → props.type = 'number', props.step = '0.01'
 * ST-22  Validation trigger dropdown defaults to 'On form submit'
 * ST-23  Validation trigger dropdown changes to 'On input change'
 * ST-24  Interactions section is absent from the Design tab
 * ST-25   Field name persists after selecting another element and coming back (stale-closure fix)
 * ST-25b  Typing in field A + switching to B does not copy B's name into A (wrong-value fix)
 * ST-26   Node name persists after selecting another element and coming back (stale-closure fix)
 *
 * Run: npx playwright test e2e/builder-settings-tab.spec.ts --reporter=list
 */

import { test, expect, type Page } from '@playwright/test';

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

async function addNode(page: Page, node: Record<string, unknown>) {
  const id = node.id as string;
  await page.evaluate((n) => {
    const bs = (window as unknown as Record<string, BuilderStore>).__builderStore;
    bs?.getState().addNode?.(n, null);
  }, node);
  await page.waitForFunction((nodeId) => {
    function findNodeDeep(nodes: unknown[], targetId: string): boolean {
      for (const n of nodes) {
        const nd = n as Record<string, unknown>;
        if (nd.id === targetId) return true;
        if (Array.isArray(nd.children) && findNodeDeep(nd.children, targetId)) return true;
      }
      return false;
    }
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore;
    const pageNodes = store?.getState().pageNodes as unknown[] | undefined;
    return Array.isArray(pageNodes) && findNodeDeep(pageNodes, nodeId as string);
  }, id, { timeout: 5_000 });
  await page.waitForTimeout(200);
}

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

async function openSettingsTab(page: Page) {
  await page.click('[data-testid="tab-right-settings"]');
  await page.waitForTimeout(300);
}

function getNodeFromStore(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    function findNode(nodes: unknown[], targetId: string): unknown {
      for (const n of nodes) {
        const nd = n as Record<string, unknown>;
        if (nd.id === targetId) return nd;
        if (Array.isArray(nd.children)) {
          const found = findNode(nd.children, targetId);
          if (found) return found;
        }
      }
      return null;
    }
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    return findNode((store?.pageNodes as unknown[]) ?? [], id);
  }, nodeId);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('ST-01: Settings tab button is visible in the right panel', async ({ page }) => {
  await gotoBuilder(page);
  const settingsTab = page.locator('[data-testid="tab-right-settings"]');
  await expect(settingsTab).toBeVisible({ timeout: 10_000 });
});

test('ST-02: Selecting a node and opening Settings tab shows the Name field', async ({ page }) => {
  await gotoBuilder(page);

  await addNode(page, { type: 'Box', id: 'st02-box', props: { className: 'w-full' } });
  await selectNode(page, 'st02-box');
  await openSettingsTab(page);

  const nameInput = page.locator('[data-testid="settings-name-input"]');
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  await expect(nameInput).toHaveAttribute('placeholder', 'e.g. Box');
});

test('ST-03: Typing in the Name field updates node.name in the store', async ({ page }) => {
  await gotoBuilder(page);

  await addNode(page, { type: 'Box', id: 'st03-box', props: { className: 'w-full' } });
  await selectNode(page, 'st03-box');
  await openSettingsTab(page);

  const nameInput = page.locator('[data-testid="settings-name-input"]');
  await nameInput.fill('My Box');
  await nameInput.press('Enter');
  await page.waitForTimeout(300);

  const node = await getNodeFromStore(page, 'st03-box') as Record<string, unknown> | null;
  expect(node?.name).toBe('My Box');
});

test('ST-04: Selecting a Button node in Settings tab shows a Submit toggle', async ({ page }) => {
  await gotoBuilder(page);

  await addNode(page, {
    type: 'Button',
    id: 'st04-btn',
    props: { action: 'primary', className: 'w-full' },
    children: [{ type: 'ButtonText', text: 'Click me' }],
  });
  await selectNode(page, 'st04-btn');
  await openSettingsTab(page);

  // Should show "Submit" label row
  await expect(page.locator('text=Submit').first()).toBeVisible({ timeout: 5_000 });
  // Should show On/Off buttons
  await expect(page.locator('button:has-text("On")').first()).toBeVisible();
  await expect(page.locator('button:has-text("Off")').first()).toBeVisible();
});

test('ST-05: Submit toggle On → actions.click.type === submitForm', async ({ page }) => {
  await gotoBuilder(page);

  await addNode(page, {
    type: 'Button',
    id: 'st05-btn',
    props: { action: 'primary', className: 'w-full' },
    children: [{ type: 'ButtonText', text: 'Submit' }],
  });
  await selectNode(page, 'st05-btn');
  await openSettingsTab(page);

  // Click the "On" button in the Submit toggle
  const onBtn = page.locator('[data-testid="submit-toggle-on"]');
  await expect(onBtn).toBeVisible({ timeout: 5_000 });
  await onBtn.click();
  await page.waitForTimeout(400);

  const node = await getNodeFromStore(page, 'st05-btn') as Record<string, unknown> | null;
  const actions = node?.actions as Record<string, unknown> | undefined;
  const clickAction = actions?.click as Record<string, unknown> | undefined;
  expect(clickAction?.type).toBe('submitForm');
});

test('ST-06: Submit toggle Off → click action removed', async ({ page }) => {
  await gotoBuilder(page);

  // Start with submitForm already on the button
  await addNode(page, {
    type: 'Button',
    id: 'st06-btn',
    props: { action: 'primary', className: 'w-full' },
    children: [{ type: 'ButtonText', text: 'Submit' }],
    actions: { click: { type: 'submitForm' } },
  });
  await selectNode(page, 'st06-btn');
  await openSettingsTab(page);

  // The "Off" submit toggle should remove the click action
  const offBtn = page.locator('[data-testid="submit-toggle-off"]');
  await expect(offBtn).toBeVisible({ timeout: 5_000 });
  await offBtn.click();
  await page.waitForTimeout(400);

  const node = await getNodeFromStore(page, 'st06-btn') as Record<string, unknown> | null;
  const actions = node?.actions as Record<string, unknown> | undefined;
  // click action should be gone
  expect(actions?.click).toBeUndefined();
});

test('ST-07: Input inside FormContainer shows Form container label and Field name', async ({ page }) => {
  await gotoBuilder(page);

  // Add a FormContainer with a flat Input child
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    (store?.addNode as (node: unknown, parentId: null) => void)({
      type: 'FormContainer',
      id: 'st07-form',
      props: { initialFormData: { email: '' }, className: 'flex flex-col gap-4 w-full' },
      children: [
        {
          type: 'Input',
          id: 'st07-field',
          props: { variant: 'outline', size: 'md', placeholder: 'Email', name: 'email' },
        },
      ],
    }, null);
  });
  await page.waitForTimeout(500);
  await selectNode(page, 'st07-field');
  await openSettingsTab(page);

  // Should show Form container label (green)
  await expect(page.locator('text=FORM CONTAINER')).toBeVisible({ timeout: 5_000 });
  // Should show the field name input pre-filled with 'email'
  const fieldNameInput = page.locator('[data-testid="settings-field-name-input"]');
  await expect(fieldNameInput).toBeVisible({ timeout: 5_000 });
  await expect(fieldNameInput).toHaveValue('email');
});

test('ST-08: Changing Field name updates node.props.name', async ({ page }) => {
  await gotoBuilder(page);

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    (store?.addNode as (node: unknown, parentId: null) => void)({
      type: 'FormContainer',
      id: 'st08-form',
      props: { initialFormData: { username: '' }, className: 'w-full' },
      children: [
        {
          type: 'Input',
          id: 'st08-field',
          props: { variant: 'outline', size: 'md', placeholder: 'Username', name: 'username' },
        },
      ],
    }, null);
  });
  await page.waitForTimeout(500);
  await selectNode(page, 'st08-field');
  await openSettingsTab(page);

  const fieldNameInput = page.locator('[data-testid="settings-field-name-input"]');
  await fieldNameInput.fill('emailAddress');
  await fieldNameInput.press('Enter');
  await page.waitForTimeout(300);

  const node = await getNodeFromStore(page, 'st08-field') as Record<string, unknown> | null;
  const props = node?.props as Record<string, unknown> | undefined;
  expect(props?.name).toBe('emailAddress');
});

test('ST-09: Input type dropdown changes props.type for Input', async ({ page }) => {
  await gotoBuilder(page);

  await addNode(page, {
    type: 'Input',
    id: 'st09-field',
    props: { variant: 'outline', size: 'md', type: 'text', placeholder: 'Enter text' },
  });
  await page.waitForTimeout(300);
  await selectNode(page, 'st09-field');
  await openSettingsTab(page);

  const typeSelect = page.locator('[data-testid="settings-input-type-select"]');
  await expect(typeSelect).toBeVisible({ timeout: 5_000 });

  // Change to email
  await typeSelect.selectOption('email');
  await page.waitForTimeout(300);

  const node = await getNodeFromStore(page, 'st09-field') as Record<string, unknown> | null;
  const props = node?.props as Record<string, unknown> | undefined;
  expect(props?.type).toBe('email');
});

test('ST-10: Custom validation Off hides formula button; On shows it', async ({ page }) => {
  await gotoBuilder(page);

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    (store?.addNode as (node: unknown, parentId: null) => void)({
      type: 'FormContainer',
      id: 'st10-form',
      props: { className: 'w-full' },
      children: [
        {
          type: 'Input',
          id: 'st10-field',
          props: { variant: 'outline', size: 'md', placeholder: 'Value', name: 'value' },
        },
      ],
    }, null);
  });
  await page.waitForTimeout(500);
  await selectNode(page, 'st10-field');
  await openSettingsTab(page);

  // Custom validation Off by default — formula button should NOT be visible
  const formulaBtn = page.locator('button:has-text("ƒ Edit formula")');
  await expect(formulaBtn).not.toBeVisible({ timeout: 3_000 });

  // Click the Custom validation "On" button
  // The row label is "Custom validation" and its On/Off buttons follow
  const customValRow = page.locator('text=Custom validation').locator('..');
  const onBtn = customValRow.locator('button:has-text("On")');
  await onBtn.click();
  await page.waitForTimeout(300);

  // Now the "ƒ Edit formula" button should appear
  await expect(formulaBtn).toBeVisible({ timeout: 5_000 });
});

// ─── Helper: add a standalone Input and select it ───────────────────────

async function addInputAndSelect(page: Page, idSuffix: string, initialType = 'text') {
  const fieldId = `st-field-${idSuffix}`;
  await page.evaluate(
    ({ id, type }) => {
      const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
      (store?.addNode as (node: unknown, parentId: null) => void)({
        type: 'Input',
        id: `st-field-${id}`,
        props: { variant: 'outline', size: 'md', type, placeholder: 'Enter value' },
      }, null);
    },
    { id: idSuffix, type: initialType }
  );
  await page.waitForTimeout(300);
  await selectNode(page, fieldId);
  await openSettingsTab(page);
  return fieldId;
}

// ─── ST-11 through ST-23: All input types + trigger dropdown ─────────────────

const INPUT_TYPE_CASES: Array<{ label: string; selectValue: string; expectedType: string; expectedStep?: string }> = [
  { label: 'ST-11: Short answer', selectValue: 'text',     expectedType: 'text' },
  { label: 'ST-12: Long answer',  selectValue: 'textarea', expectedType: 'textarea' },
  { label: 'ST-13: Search',       selectValue: 'search',   expectedType: 'search' },
  { label: 'ST-14: Password',     selectValue: 'password', expectedType: 'password' },
  { label: 'ST-15: Number',       selectValue: 'number',   expectedType: 'number' },
  { label: 'ST-16: Decimal',      selectValue: 'decimal',  expectedType: 'number', expectedStep: '0.01' },
  { label: 'ST-17: Date',         selectValue: 'date',     expectedType: 'date' },
  { label: 'ST-18: Time',         selectValue: 'time',     expectedType: 'time' },
  { label: 'ST-19: Phone',        selectValue: 'tel',      expectedType: 'tel' },
  { label: 'ST-20: Color',        selectValue: 'color',    expectedType: 'color' },
  { label: 'ST-21: Currency',     selectValue: 'currency', expectedType: 'number', expectedStep: '0.01' },
];

let stSuffix = 11;
for (const { label, selectValue, expectedType, expectedStep } of INPUT_TYPE_CASES) {
  const suffix = String(stSuffix++);
  test(`${label} → props.type = '${expectedType}'${expectedStep ? `, step = '${expectedStep}'` : ''}`, async ({ page }) => {
    await gotoBuilder(page);
    const fieldId = await addInputAndSelect(page, suffix);

    const typeSelect = page.locator('[data-testid="settings-input-type-select"]');
    await expect(typeSelect).toBeVisible({ timeout: 5_000 });

    await typeSelect.selectOption(selectValue);
    await page.waitForTimeout(300);

    const node = await getNodeFromStore(page, fieldId) as Record<string, unknown> | null;
    const props = node?.props as Record<string, unknown> | undefined;
    expect(props?.type).toBe(expectedType);
    if (expectedStep) {
      expect(props?.step).toBe(expectedStep);
    }
  });
}

test('ST-22: Validation trigger dropdown defaults to On form submit', async ({ page }) => {
  await gotoBuilder(page);
  const fieldId = await addInputAndSelect(page, 'trig-default');

  // Put the field inside a form so the Form Container section is visible
  // (Validation section only shows for form fields)
  // If the node is standalone (not in FormContainer), Form Container section won't appear.
  // Use the formula to check the store directly instead:
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    (store?.addNode as (node: unknown, parentId: null) => void)({
      type: 'FormContainer',
      id: 'st22-form',
      props: { className: 'w-full' },
      children: [
        {
          type: 'Input',
          id: 'st22-field',
          props: { variant: 'outline', placeholder: 'Value', name: 'value' },
        },
      ],
    }, null);
  });
  await page.waitForTimeout(400);
  await selectNode(page, 'st22-field');
  await openSettingsTab(page);

  const triggerSelect = page.locator('[data-testid="settings-validation-trigger"]');
  await expect(triggerSelect).toBeVisible({ timeout: 5_000 });
  await expect(triggerSelect).toHaveValue('submit');
});

test('ST-23: Validation trigger dropdown changes to On input change', async ({ page }) => {
  await gotoBuilder(page);
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    (store?.addNode as (node: unknown, parentId: null) => void)({
      type: 'FormContainer',
      id: 'st23-form',
      props: { className: 'w-full' },
      children: [
        {
          type: 'Input',
          id: 'st23-field',
          props: { variant: 'outline', placeholder: 'Value', name: 'value' },
        },
      ],
    }, null);
  });
  await page.waitForTimeout(400);
  await selectNode(page, 'st23-field');
  await openSettingsTab(page);

  const triggerSelect = page.locator('[data-testid="settings-validation-trigger"]');
  await expect(triggerSelect).toBeVisible({ timeout: 5_000 });

  await triggerSelect.selectOption('change');
  await page.waitForTimeout(300);

  const node = await getNodeFromStore(page, 'st23-field') as Record<string, unknown> | null;
  const validation = node?._validation as Record<string, unknown> | undefined;
  expect(validation?.trigger).toBe('change');
});

// ─── ST-24: Interactions section is absent from Design tab ─────────────────────

test('ST-24: Interactions section is absent from the Design tab', async ({ page }) => {
  await gotoBuilder(page);
  await addNode(page, { type: 'Box', id: 'st24-box', props: {} });
  await page.waitForTimeout(300);
  await selectNode(page, 'st24-box');

  // Open the Design tab
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(200);

  // The Interactions section must not exist anywhere in the DOM
  await expect(page.getByTestId('interactions-section')).toHaveCount(0);
});

// ─── ST-25: Field name persists after selecting another element and returning ──

test('ST-25: Field name persists after selecting another element and coming back', async ({ page }) => {
  await gotoBuilder(page);

  // Add a FormContainer with two Inputs
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    (store?.addNode as (node: unknown, parentId: null) => void)({
      type: 'FormContainer',
      id: 'st25-form',
      props: { className: 'w-full' },
      children: [
        {
          type: 'Input',
          id: 'st25-field-a',
          props: { variant: 'outline', size: 'md', name: 'originalName', placeholder: 'Field A' },
        },
        {
          type: 'Box',
          id: 'st25-sibling',
          props: { className: 'w-full h-8 bg-gray-100' },
        },
      ],
    }, null);
  });
  await page.waitForTimeout(500);

  // 1. Select the Input and open Settings tab
  await selectNode(page, 'st25-field-a');
  await openSettingsTab(page);

  const fieldNameInput = page.locator('[data-testid="settings-field-name-input"]');
  await expect(fieldNameInput).toHaveValue('originalName', { timeout: 5_000 });

  // 2. Focus the field name input and type a new name
  await fieldNameInput.click();
  await fieldNameInput.fill('renamedField');

  // 3. Blur by selecting the sibling Box node (simulates clicking another element)
  //    selectNode uses store.select() which triggers the same sync re-render as clicking canvas
  await selectNode(page, 'st25-sibling');
  await page.waitForTimeout(300);

  // 4. Come back to the Input
  await selectNode(page, 'st25-field-a');
  await page.waitForTimeout(300);

  // 5. The field name input should show 'renamedField', NOT 'originalName'
  const fieldNameInputAfter = page.locator('[data-testid="settings-field-name-input"]');
  await expect(fieldNameInputAfter).toHaveValue('renamedField', { timeout: 5_000 });

  // Also verify the store was updated
  const node = await getNodeFromStore(page, 'st25-field-a') as Record<string, unknown> | null;
  const props = node?.props as Record<string, unknown> | undefined;
  expect(props?.name).toBe('renamedField');
});

// ─── ST-25b: Field name doesn't get overwritten with sibling's name ───────────

test('ST-25b: Typing in field A then switching to field B does not copy B name into A', async ({ page }) => {
  await gotoBuilder(page);

  // Two Inputs in the same FormContainer
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore?.getState();
    (store?.addNode as (node: unknown, parentId: null) => void)({
      type: 'FormContainer',
      id: 'st25b-form',
      props: { className: 'w-full flex flex-col gap-4' },
      children: [
        {
          type: 'Input', id: 'st25b-field-a', props: { variant: 'outline', size: 'md', name: 'firstField', placeholder: 'A' },
        },
        {
          type: 'Input', id: 'st25b-field-b', props: { variant: 'outline', size: 'md', name: 'secondField', placeholder: 'B' },
        },
      ],
    }, null);
  });
  await page.waitForTimeout(500);

  // 1. Select Field A, open settings, type new name
  await selectNode(page, 'st25b-field-a');
  await openSettingsTab(page);
  const inputA = page.locator('[data-testid="settings-field-name-input"]');
  await inputA.click();
  await inputA.fill('renamedFieldA');

  // 2. Immediately select Field B (triggers sync re-render + controlled input value update before blur)
  await selectNode(page, 'st25b-field-b');
  await page.waitForTimeout(400);

  // 3. Verify Field A got 'renamedFieldA', NOT 'secondField' (which would be the bug)
  const nodeA = await getNodeFromStore(page, 'st25b-field-a') as Record<string, unknown> | null;
  expect((nodeA?.props as Record<string, unknown>)?.name).toBe('renamedFieldA');

  // 4. Field B must be unchanged
  const nodeB = await getNodeFromStore(page, 'st25b-field-b') as Record<string, unknown> | null;
  expect((nodeB?.props as Record<string, unknown>)?.name).toBe('secondField');
});

// ─── ST-26: Node name persists after selecting another element and returning ──

test('ST-26: Node name persists after selecting another element and coming back', async ({ page }) => {
  await gotoBuilder(page);

  // Two boxes side by side
  await addNode(page, { type: 'Box', id: 'st26-box-a', props: { className: 'w-full h-8' } });
  await addNode(page, { type: 'Box', id: 'st26-box-b', props: { className: 'w-full h-8' } });
  await page.waitForTimeout(300);

  // 1. Select Box A, open Settings, type a name
  await selectNode(page, 'st26-box-a');
  await openSettingsTab(page);

  const nameInput = page.locator('[data-testid="settings-name-input"]');
  await nameInput.click();
  await nameInput.fill('BoxRenamed');

  // 2. Blur by selecting Box B
  await selectNode(page, 'st26-box-b');
  await page.waitForTimeout(300);

  // 3. Come back to Box A
  await selectNode(page, 'st26-box-a');
  await page.waitForTimeout(300);

  // 4. Name should be preserved
  const nameInputAfter = page.locator('[data-testid="settings-name-input"]');
  await expect(nameInputAfter).toHaveValue('BoxRenamed', { timeout: 5_000 });

  const node = await getNodeFromStore(page, 'st26-box-a') as Record<string, unknown> | null;
  expect(node?.name).toBe('BoxRenamed');
});
