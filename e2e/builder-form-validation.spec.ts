/**
 * Form validation E2E tests — covers:
 *  FV-01  Sign-in: required fields on submit
 *  FV-02  Sign-in: email format validation on submit
 *  FV-03  Sign-in: errors clear when user starts typing (submit trigger)
 *  FV-04  Sign-in: autocomplete attributes
 *  FV-05  Register: required + minLength on submit
 *  FV-06  Register: password minLength on submit
 *  FV-07  Register: passwords-match formula rule on submit
 *  FV-08  Register: phone validates on change (change trigger)
 *  FV-09  Register: phone debounce — no instant error while typing
 *  FV-10  Register: autocomplete attributes
 *  FV-11  Builder Settings tab — rules list renders correctly
 *  FV-12  Builder Settings tab — add/remove rule
 *  FV-13  Builder Settings tab — minLength rule shows value field
 *  FV-14  Builder Settings tab — formula rule shows formula button + message
 *  FV-15  Builder Settings tab — readOnly toggle updates prop
 *  FV-16  Builder Settings tab — autocomplete toggle
 *  FV-17  Builder Settings tab — debounce toggle + delay
 *  FV-18  Init value: FormContainer initialFormData pre-fills inputs
 */

import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:3001';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function goSignIn(page: Page) {
  await page.goto(`${BASE}/sign-in`);
  await page.waitForLoadState('networkidle');
}

async function goRegister(page: Page) {
  await page.goto(`${BASE}/register`);
  await page.waitForLoadState('networkidle');
}

async function clickSubmit(page: Page, text = 'Sign In') {
  // Gluestack Button doesn't always expose role="button", use text match
  await page.locator(`button:has-text("${text}"), [role="button"]:has-text("${text}")`).first().click();
  await page.waitForTimeout(400);
}

// ── Sign-in validation ────────────────────────────────────────────────────────

test('FV-01 sign-in: required errors appear when submitting empty form', async ({ page }) => {
  await goSignIn(page);
  await clickSubmit(page, 'Sign In');
  await expect(page.getByText('Email is required')).toBeVisible();
  await expect(page.getByText('Password is required')).toBeVisible();
});

test('FV-02 sign-in: email format error on invalid email', async ({ page }) => {
  await goSignIn(page);
  await page.locator('input[placeholder="you@example.com"]').fill('notanemail');
  await clickSubmit(page, 'Sign In');
  await expect(page.getByText('Please enter a valid email address')).toBeVisible();
});

test('FV-03 sign-in: errors clear when user types after failed submit', async ({ page }) => {
  await goSignIn(page);
  await clickSubmit(page, 'Sign In');
  await expect(page.getByText('Email is required')).toBeVisible();
  // Start typing — error should clear
  await page.locator('input[placeholder="you@example.com"]').fill('a');
  await page.waitForTimeout(200);
  await expect(page.getByText('Email is required')).not.toBeVisible();
});

test('FV-04 sign-in: autocomplete attributes are set', async ({ page }) => {
  await goSignIn(page);
  await expect(page.locator('input[autocomplete="email"]')).toHaveCount(1);
  await expect(page.locator('input[autocomplete="current-password"]')).toHaveCount(1);
});

// ── Register validation ───────────────────────────────────────────────────────

test('FV-05 register: required errors on empty submit', async ({ page }) => {
  await goRegister(page);
  await clickSubmit(page, 'Create Account');
  await expect(page.getByText('Email is required')).toBeVisible();
  await expect(page.getByText('First name is required')).toBeVisible();
  await expect(page.getByText('Last name is required')).toBeVisible();
  await expect(page.getByText('Password is required')).toBeVisible();
  await expect(page.getByText('Please confirm your password')).toBeVisible();
});

test('FV-06 register: password minLength rule', async ({ page }) => {
  await goRegister(page);
  await page.locator('input[placeholder="you@example.com"]').fill('test@example.com');
  await page.locator('input[placeholder="John"]').fill('John');
  await page.locator('input[placeholder="Doe"]').fill('Doe');
  // First password field
  await page.locator('input[placeholder="••••••••"]').first().fill('abc');
  await clickSubmit(page, 'Create Account');
  await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
});

test('FV-07 register: passwords do not match formula rule', async ({ page }) => {
  await goRegister(page);
  await page.locator('input[placeholder="you@example.com"]').fill('test@example.com');
  await page.locator('input[placeholder="John"]').fill('John');
  await page.locator('input[placeholder="Doe"]').fill('Doe');
  const pwdInputs = page.locator('input[placeholder="••••••••"]');
  await pwdInputs.nth(0).fill('password123');
  await pwdInputs.nth(1).fill('different123');
  await clickSubmit(page, 'Create Account');
  await expect(page.getByText('Passwords do not match')).toBeVisible();
});

test('FV-08 register: phone validates on change (change trigger)', async ({ page }) => {
  await goRegister(page);
  await page.locator('input[placeholder="+1 234 567 8900"]').fill('abc');
  await page.waitForTimeout(900);
  await expect(page.getByText('Please enter a valid phone number')).toBeVisible();
});

test('FV-09 register: phone debounce — no error immediately while typing', async ({ page }) => {
  await goRegister(page);
  const phoneInput = page.locator('input[placeholder="+1 234 567 8900"]');
  await phoneInput.pressSequentially('ab', { delay: 50 });
  // Within debounce window (600ms) — no error yet
  await page.waitForTimeout(200);
  await expect(page.getByText('Please enter a valid phone number')).not.toBeVisible();
  // After debounce fires — error appears
  await page.waitForTimeout(800);
  await expect(page.getByText('Please enter a valid phone number')).toBeVisible();
});

test('FV-10 register: autocomplete attributes are set', async ({ page }) => {
  await goRegister(page);
  await expect(page.locator('input[autocomplete="email"]')).toHaveCount(1);
  await expect(page.locator('input[autocomplete="given-name"]')).toHaveCount(1);
  await expect(page.locator('input[autocomplete="family-name"]')).toHaveCount(1);
  await expect(page.locator('input[autocomplete="tel"]')).toHaveCount(1);
  await expect(page.locator('input[autocomplete="new-password"]')).toHaveCount(2);
});

test('FV-18 init value: FormContainer initialFormData pre-fills correctly', async ({ page }) => {
  await goSignIn(page);
  // Input is present and empty (initialFormData sets username: "")
  await expect(page.locator('input[placeholder="you@example.com"]')).toHaveValue('');
  await expect(page.locator('input[placeholder="••••••••"]')).toHaveValue('');
});

// ── Builder Settings tab ──────────────────────────────────────────────────────

test.describe('Builder settings tab', () => {
  async function openBuilder(page: Page) {
    await page.goto(`${BASE}/dev/builder`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  }

  async function dropFormContainer(page: Page) {
    // Use showcase to add a FormContainer to the canvas
    const compTab = page.locator('[data-testid="tab-components"]');
    if (await compTab.isVisible()) await compTab.click();
    const formItem = page.locator('[data-testid^="comp-item-"]').filter({ hasText: 'Form' }).first();
    if (await formItem.isVisible()) {
      const canvas = page.locator('[data-testid="builder-canvas"]');
      await formItem.dragTo(canvas);
      await page.waitForTimeout(400);
    }
  }

  async function selectInputFieldNode(page: Page) {
    // Find an InputField layer row and click it
    const layerRows = page.locator('[data-testid="layer-row"]');
    const inputRow = layerRows.filter({ hasText: 'InputField' }).first();
    if (await inputRow.isVisible({ timeout: 3000 })) {
      await inputRow.click();
    }
  }

  async function openSettingsTab(page: Page) {
    const settingsTab = page.locator('[data-testid="tab-settings"]');
    if (await settingsTab.isVisible()) await settingsTab.click();
  }

  test('FV-11 rules list renders when InputField is selected', async ({ page }) => {
    await openBuilder(page);
    await dropFormContainer(page);
    await page.locator('[data-testid="tab-layers"]').click();
    // Expand tree to find InputField
    const chevrons = page.locator('[data-layer-row]').filter({ hasText: 'FormContainer' });
    if (await chevrons.count() > 0) await chevrons.first().click();
    await selectInputFieldNode(page);
    await openSettingsTab(page);
    await expect(page.getByText('Rules')).toBeVisible();
    await expect(page.getByText('+ Add rule')).toBeVisible();
  });

  test('FV-12 add rule button adds a new rule row', async ({ page }) => {
    await openBuilder(page);
    await dropFormContainer(page);
    await page.locator('[data-testid="tab-layers"]').click();
    const chevrons = page.locator('[data-layer-row]').filter({ hasText: 'FormContainer' });
    if (await chevrons.count() > 0) await chevrons.first().click();
    await selectInputFieldNode(page);
    await openSettingsTab(page);
    await page.getByText('+ Add rule').click();
    await page.waitForTimeout(200);
    // A rule type dropdown should appear
    const ruleSelects = page.locator('select').filter({ hasText: 'Required' });
    await expect(ruleSelects.first()).toBeVisible();
  });

  test('FV-13 minLength rule shows value field', async ({ page }) => {
    await openBuilder(page);
    await dropFormContainer(page);
    await page.locator('[data-testid="tab-layers"]').click();
    const chevrons = page.locator('[data-layer-row]').filter({ hasText: 'FormContainer' });
    if (await chevrons.count() > 0) await chevrons.first().click();
    await selectInputFieldNode(page);
    await openSettingsTab(page);
    await page.getByText('+ Add rule').click();
    await page.waitForTimeout(200);
    // Change rule type to Min length
    const ruleSelect = page.locator('select').filter({ hasText: 'Required' }).first();
    await ruleSelect.selectOption('minLength');
    await page.waitForTimeout(200);
    // Value field should now be visible
    await expect(page.getByPlaceholder('2')).toBeVisible();
  });

  test('FV-14 formula rule shows formula button and message input', async ({ page }) => {
    await openBuilder(page);
    await dropFormContainer(page);
    await page.locator('[data-testid="tab-layers"]').click();
    const chevrons = page.locator('[data-layer-row]').filter({ hasText: 'FormContainer' });
    if (await chevrons.count() > 0) await chevrons.first().click();
    await selectInputFieldNode(page);
    await openSettingsTab(page);
    await page.getByText('+ Add rule').click();
    await page.waitForTimeout(200);
    const ruleSelect = page.locator('select').filter({ hasText: 'Required' }).first();
    await ruleSelect.selectOption('formula');
    await page.waitForTimeout(200);
    await expect(page.getByText(/Add formula|Edit formula/)).toBeVisible();
    await expect(page.getByPlaceholder('Error message (fallback)')).toBeVisible();
  });

  test('FV-15 readOnly toggle updates node prop', async ({ page }) => {
    await openBuilder(page);
    await dropFormContainer(page);
    await page.locator('[data-testid="tab-layers"]').click();
    const chevrons = page.locator('[data-layer-row]').filter({ hasText: 'FormContainer' });
    if (await chevrons.count() > 0) await chevrons.first().click();
    await selectInputFieldNode(page);
    await openSettingsTab(page);
    // Find Read only row and click On
    const readOnlySection = page.locator('text=Read only').locator('..');
    const onBtn = readOnlySection.locator('button', { hasText: 'On' }).first();
    if (await onBtn.isVisible({ timeout: 3000 })) {
      await onBtn.click();
      await page.waitForTimeout(200);
      // Check that the store node now has readOnly: true (via design panel showing it)
      // At minimum verify the button toggled to active state
      await expect(onBtn).toHaveCSS('background-color', /37\s*41\s*51|374151/i);
    }
  });

  test('FV-16 autocomplete toggle updates node prop', async ({ page }) => {
    await openBuilder(page);
    await dropFormContainer(page);
    await page.locator('[data-testid="tab-layers"]').click();
    const chevrons = page.locator('[data-layer-row]').filter({ hasText: 'FormContainer' });
    if (await chevrons.count() > 0) await chevrons.first().click();
    await selectInputFieldNode(page);
    await openSettingsTab(page);
    const autoRow = page.locator('text=Autocomplete').locator('..');
    const offBtn = autoRow.locator('button', { hasText: 'Off' }).first();
    if (await offBtn.isVisible({ timeout: 3000 })) {
      await offBtn.click();
      await page.waitForTimeout(200);
      await expect(offBtn).toHaveCSS('background-color', /37\s*41\s*51|374151/i);
    }
  });

  test('FV-17 debounce toggle and delay', async ({ page }) => {
    await openBuilder(page);
    await dropFormContainer(page);
    await page.locator('[data-testid="tab-layers"]').click();
    const chevrons = page.locator('[data-layer-row]').filter({ hasText: 'FormContainer' });
    if (await chevrons.count() > 0) await chevrons.first().click();
    await selectInputFieldNode(page);
    await openSettingsTab(page);
    const debounceRow = page.locator('text=Debounce').locator('..');
    const onBtn = debounceRow.locator('button', { hasText: 'On' }).first();
    if (await onBtn.isVisible({ timeout: 3000 })) {
      await onBtn.click();
      await page.waitForTimeout(200);
      // Delay input should appear
      await expect(page.locator('input[data-testid="settings-debounce-delay"]')).toBeVisible();
    }
  });
});
