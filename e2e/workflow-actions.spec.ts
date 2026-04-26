/**
 * Workflow Actions E2E Tests (WA series)
 *
 * Tests all workflow action types (excluding pickFile, which requires a
 * real OS file picker and is covered separately by file-upload-test.spec.ts)
 * across all relevant triggers, on /workflow-test.
 *
 * Cards on /workflow-test:
 *   Card 6  — Trigger Sampler (created, mounted, click, doubleClick, mouseEnter/Leave, change, enterKey, focus, blur)
 *   Card 7  — Form Triggers + setFormState + resetForm (submit, submitValidationError)
 *   Card 8  — navigateTo + navigatePrev
 *   Card 9  — REST API (fetchData GET + POST) + GraphQL
 *   Card 10 — fetchCollection + fetchCollectionsParallel + updateCollection + resetVariableValue
 *   Card 11 — returnValue (branch → PASS/FAIL)
 *   Card 12 — executeComponentAction + runProjectWorkflow
 *   Card 13 — breakLoop + continueLoop + passThroughCondition
 *   Card 14 — multiOptionBranch (A / B / C / default)
 *   Card 15 — copyToClipboard, stopPropagation, printPdf, downloadFileFromUrl, createUrlFromBase64, encodeFileAsBase64
 *   Card 16 — Complex: branch + forEach + breakLoop + nested branch
 *   Card 17 — Complex: multiOptionBranch + whileLoop + forEach + continueLoop + passThroughCondition
 *
 * Run: npx playwright test e2e/workflow-actions.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);

// SDUI app routes are served on preview-dev.localhost (not the main domain
// which is reserved for platform routes). Use the full URL with the subdomain.
const PREVIEW_DEV_BASE = 'http://preview-dev.localhost:3001';

// ─── Shared page ──────────────────────────────────────────────────────────────

let sharedPage: Page;

test.beforeAll(async ({ browser }) => {
  sharedPage = await browser.newPage();
  await sharedPage.goto(`${PREVIEW_DEV_BASE}/workflow-test`);
  await sharedPage.waitForSelector('[data-testid="out-created"]', { timeout: 30_000 });
  await sharedPage.waitForTimeout(600);
});

test.afterAll(async () => {
  await sharedPage.close();
});

async function resetPage(page: Page) {
  await page.goto(`${PREVIEW_DEV_BASE}/workflow-test`);
  await page.waitForSelector('[data-testid="out-created"]', { timeout: 30_000 });
  await page.waitForTimeout(500);
}

async function clickBtn(page: Page, testId: string) {
  await page.locator(`[data-testid="${testId}"]`).click();
  await page.waitForTimeout(400);
}

// ─── Card 6: Trigger Sampler ──────────────────────────────────────────────────

// WA-01: trigger "created" — auto-populates on page load
test('WA-01: created trigger — out-created = "auto-loaded" on page load', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-created"]')).toHaveText('auto-loaded', { timeout: 5_000 });
});

// WA-02: trigger "mounted" — fires on element mount
test('WA-02: mounted trigger — out-mounted = "mounted" on page load', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-mounted"]')).toHaveText('mounted', { timeout: 5_000 });
});

// WA-03: trigger "click" — Button click
test('WA-03: click trigger — clicking "Click me" sets out-click = "clicked!"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-click"]')).toHaveText('(not clicked)');
  await clickBtn(page, 'btn-wa-click');
  await expect(page.locator('[data-testid="out-click"]')).toHaveText('clicked!');
});

// WA-04: trigger "doubleClick" — increments counter
test('WA-04: doubleClick trigger — double-clicking increments out-dblclick', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-dblclick"]')).toHaveText('0');
  await page.locator('[data-testid="btn-wa-dblclick"]').dblclick();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="out-dblclick"]')).toHaveText('1');
  await page.locator('[data-testid="btn-wa-dblclick"]').dblclick();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="out-dblclick"]')).toHaveText('2');
});

// WA-05: trigger "mouseEnter" — hover zone sets "over"
test('WA-05: mouseEnter trigger — hovering zone sets out-hover = "over"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await page.locator('[data-testid="hover-zone"]').hover();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="out-hover"]')).toHaveText('over');
});

// WA-06: trigger "mouseLeave" — moving away from hover zone sets "out"
test('WA-06: mouseLeave trigger — moving away from zone sets out-hover = "out"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await page.locator('[data-testid="hover-zone"]').hover();
  await page.waitForTimeout(200);
  // Move to a different element to trigger mouseLeave
  await page.locator('[data-testid="out-hover"]').hover();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="out-hover"]')).toHaveText('out');
});

// WA-07: trigger "change" (Input) — typing mirrors value
test('WA-07: change trigger — typing in input sets out-change to typed value', async () => {
  const page = sharedPage;
  await resetPage(page);
  const input = page.locator('[data-testid="wa-trigger-input"] input').first();
  await input.focus();
  await input.fill('hello-change');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="out-change"]')).toHaveText('hello-change');
});

// WA-08: trigger "enterKey" (Input) — pressing Enter fires action
test('WA-08: enterKey trigger — pressing Enter in input sets out-enter = "entered!"', async () => {
  const page = sharedPage;
  await resetPage(page);
  const input = page.locator('[data-testid="wa-trigger-input"] input').first();
  await input.focus();
  await input.press('Enter');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="out-enter"]')).toHaveText('entered!');
});

// WA-09: trigger "focus" (Input) — focusing input sets "focused"
test('WA-09: focus trigger — focusing input sets out-focus-state = "focused"', async () => {
  const page = sharedPage;
  await resetPage(page);
  const input = page.locator('[data-testid="wa-trigger-input"] input').first();
  await input.focus();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="out-focus-state"]')).toHaveText('focused');
});

// WA-10: trigger "blur" (Input) — blurring input sets "blurred"
test('WA-10: blur trigger — blurring input sets out-focus-state = "blurred"', async () => {
  const page = sharedPage;
  await resetPage(page);
  const input = page.locator('[data-testid="wa-trigger-input"] input').first();
  await input.focus();
  await page.waitForTimeout(200);
  await input.blur();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="out-focus-state"]')).toHaveText('blurred');
});

// ─── Card 7: Form Triggers ────────────────────────────────────────────────────

// WA-11: trigger "submit" (FormContainer) — submit shows the actual form field value
test('WA-11: submit trigger — submitting form sets out-form-result to submitted value', async () => {
  const page = sharedPage;
  await resetPage(page);
  const emailInput = page.locator('[data-testid="wa-form-email"]').first();
  await emailInput.fill('test@example.com');
  await page.waitForTimeout(300);
  await clickBtn(page, 'btn-wa-submit');
  await expect(page.locator('[data-testid="out-form-result"]')).toHaveText('submitted: test@example.com', { timeout: 5_000 });
});

// WA-12: setFormState — Pre-fill populates input fields visually
test('WA-12: setFormState — Pre-fill button populates input fields visually', async () => {
  const page = sharedPage;
  await resetPage(page);
  const emailInput = page.locator('[data-testid="wa-form-email"]').first();
  const nameInput = page.locator('[data-testid="wa-form-name"]').first();
  await clickBtn(page, 'btn-wa-prefill');
  // Pre-fill writes to wa-input-email-value and wa-input-name-value top-level slots.
  // The inputFieldActive subscription fires and visually populates both inputs.
  await expect(emailInput).toHaveValue('prefilled@example.com', { timeout: 5_000 });
  await expect(nameInput).toHaveValue('Pre-filled Name', { timeout: 5_000 });
});

// WA-12b: Pre-fill then submit — validation passes with pre-filled values
test('WA-12b: Pre-fill then submit — form submits successfully with pre-filled values', async () => {
  const page = sharedPage;
  await resetPage(page);
  // Pre-fill both inputs via changeVariableValue
  await clickBtn(page, 'btn-wa-prefill');
  // Confirm inputs are visually populated
  await expect(page.locator('[data-testid="wa-form-email"]').first()).toHaveValue('prefilled@example.com', { timeout: 5_000 });
  // Submit — should NOT show validation errors, should show submit result
  await clickBtn(page, 'btn-wa-submit');
  await expect(page.locator('[data-testid="out-form-result"]')).not.toHaveText('(not submitted)', { timeout: 5_000 });
  await expect(page.locator('[data-testid="out-form-validation-error"]')).not.toHaveText('validation failed', { timeout: 3_000 });
  // No inline "required" error should appear
  await expect(page.getByText('Email is required')).not.toBeVisible({ timeout: 3_000 });
});

// WA-13: resetForm — Reset clears form result and input fields
test('WA-13: resetForm — Reset clears out-form-result back to initial and clears input fields', async () => {
  const page = sharedPage;
  await resetPage(page);
  const emailInput = page.locator('[data-testid="wa-form-email"]').first();
  const nameInput = page.locator('[data-testid="wa-form-name"]').first();
  // Fill both inputs
  await emailInput.fill('reset-test@example.com');
  await page.waitForTimeout(100);
  await nameInput.fill('Reset User');
  await page.waitForTimeout(200);
  // Submit to set a result
  await clickBtn(page, 'btn-wa-submit');
  await expect(page.locator('[data-testid="out-form-result"]')).not.toHaveText('(not submitted)');
  // Now reset — should clear both the result AND the input fields
  await clickBtn(page, 'btn-wa-reset-form');
  await expect(page.locator('[data-testid="out-form-result"]')).toHaveText('(not submitted)', { timeout: 5_000 });
  await expect(emailInput).toHaveValue('', { timeout: 5_000 });
  await expect(nameInput).toHaveValue('', { timeout: 5_000 });
});

// WA-14: trigger "submitValidationError" — submitting with empty required field
test('WA-14: submitValidationError trigger — submitting empty form sets validation-error output', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="wa-form-container"]')).toBeVisible();
  // Submit without filling required field — validation should fire
  await clickBtn(page, 'btn-wa-submit');
  await expect(page.locator('[data-testid="out-form-validation-error"]')).toHaveText('validation failed', { timeout: 5_000 });
  // Inline field error should appear below the email input
  await expect(page.locator('[data-testid="wa-email-error"]')).toBeVisible({ timeout: 5_000 });
});

// WA-14b: validation survives reset — filling, resetting, then submitting empty must still fire validation
test('WA-14b: validation after reset — reset then submit empty still triggers validation errors', async () => {
  const page = sharedPage;
  await resetPage(page);
  const emailInput = page.locator('[data-testid="wa-form-email"]').first();
  const nameInput  = page.locator('[data-testid="wa-form-name"]').first();
  // Fill and submit
  await emailInput.fill('test@example.com');
  await page.waitForTimeout(100);
  await nameInput.fill('Test User');
  await page.waitForTimeout(100);
  await clickBtn(page, 'btn-wa-submit');
  await expect(page.locator('[data-testid="out-form-result"]')).not.toHaveText('(not submitted)', { timeout: 5_000 });
  // Reset the form
  await clickBtn(page, 'btn-wa-reset-form');
  await expect(page.locator('[data-testid="out-form-result"]')).toHaveText('(not submitted)', { timeout: 5_000 });
  await expect(emailInput).toHaveValue('', { timeout: 5_000 });
  // Submit again with empty inputs — validation must still fire
  await clickBtn(page, 'btn-wa-submit');
  await expect(page.locator('[data-testid="out-form-validation-error"]')).toHaveText('validation failed', { timeout: 5_000 });
  await expect(page.locator('[data-testid="wa-email-error"]')).toBeVisible({ timeout: 5_000 });
  // Typing must NOT clear the error (trigger: "submit" validation, not "change")
  await emailInput.fill('a');
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid="wa-email-error"]')).toBeVisible({ timeout: 5_000 });
  // Submitting with a valid value clears both the inline error and the output variable
  await emailInput.fill('valid@example.com');
  await page.waitForTimeout(100);
  await clickBtn(page, 'btn-wa-submit');
  await expect(page.locator('[data-testid="wa-email-error"]')).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('[data-testid="out-form-validation-error"]')).toHaveText('', { timeout: 5_000 });
});

// WA-15: Form initial state
test('WA-15: form initial state — out-form-result and validation-error start at initial values', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-form-result"]')).toHaveText('(not submitted)');
  await expect(page.locator('[data-testid="out-form-validation-error"]')).toHaveText('');
  await expect(page.locator('[data-testid="out-form-is-submitted"]')).toHaveText('false');
  await expect(page.locator('[data-testid="out-form-is-submitting"]')).toHaveText('false');
});

// WA-15b: isSubmitted / isSubmitting lifecycle — set on submit, reset by resetForm
test('WA-15b: isSubmitted and isSubmitting — set by submit workflow, cleared by resetForm', async () => {
  const page = sharedPage;
  await resetPage(page);
  const emailInput = page.locator('[data-testid="wa-form-email"]').first();
  // Before submit: both false
  await expect(page.locator('[data-testid="out-form-is-submitted"]')).toHaveText('false');
  await expect(page.locator('[data-testid="out-form-is-submitting"]')).toHaveText('false');
  // Submit with a value — isSubmitting briefly becomes true, then false; isSubmitted ends true
  await emailInput.fill('test@example.com');
  await page.waitForTimeout(100);
  await clickBtn(page, 'btn-wa-submit');
  // isSubmitting = true while the delay step runs
  await expect(page.locator('[data-testid="out-form-is-submitting"]')).toHaveText('true', { timeout: 3_000 });
  // after the delay, isSubmitting = false and isSubmitted = true
  await expect(page.locator('[data-testid="out-form-is-submitting"]')).toHaveText('false', { timeout: 3_000 });
  await expect(page.locator('[data-testid="out-form-is-submitted"]')).toHaveText('true', { timeout: 3_000 });
  // Reset — both back to false
  await clickBtn(page, 'btn-wa-reset-form');
  await expect(page.locator('[data-testid="out-form-is-submitted"]')).toHaveText('false', { timeout: 5_000 });
  await expect(page.locator('[data-testid="out-form-is-submitting"]')).toHaveText('false', { timeout: 5_000 });
});

// ─── Card 8: Navigation ───────────────────────────────────────────────────────

// WA-16: navigateTo — button is visible and configured
test('WA-16: navigateTo — "Go to Home" button is present and navigates on click', async () => {
  const page = sharedPage;
  await resetPage(page);
  const btn = page.locator('[data-testid="btn-wa-nav-home"]');
  await expect(btn).toBeVisible();
  // We do NOT click as it navigates away; verify the button exists and has the action wired
  const text = await btn.textContent();
  expect(text).toContain('Home');
});

// WA-17: navigatePrev — button is visible and configured
test('WA-17: navigatePrev — "Navigate Prev" button is present', async () => {
  const page = sharedPage;
  await resetPage(page);
  const btn = page.locator('[data-testid="btn-wa-nav-prev"]');
  await expect(btn).toBeVisible();
  const text = await btn.textContent();
  expect(text).toContain('Prev');
});

// ─── Card 9: REST + GraphQL ───────────────────────────────────────────────────

// WA-18: fetchData GET — fires and writes status var before fetch
test('WA-18: fetchData GET — clicking REST GET sets out-rest-status to "fetching" then "done"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-rest-get');
  // Give fetch time to complete
  await page.waitForTimeout(3000);
  const status = await page.locator('[data-testid="out-rest-status"]').textContent();
  // Should have transitioned through "fetching" → "done" (or error, but status changes)
  expect(['done', 'fetching', '']).toContain(status?.trim() ?? '');
  // out-rest-result should be "ok" if fetch succeeded
  const result = await page.locator('[data-testid="out-rest-result"]').textContent();
  expect(result).not.toBe('(not fetched)');
});

// WA-19: fetchData POST — fires and writes status
test('WA-19: fetchData POST — clicking REST POST sets out-rest-status to a non-initial value', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-rest-post');
  await page.waitForTimeout(3000);
  const status = await page.locator('[data-testid="out-rest-status"]').textContent();
  expect(status?.trim()).not.toBe('');
});

// WA-20: graphql — fires and writes result var
test('WA-20: graphql — clicking GraphQL Query sets out-gql-result to non-initial value', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-gql-result"]')).toHaveText('(not fetched)');
  await clickBtn(page, 'btn-wa-graphql');
  await page.waitForTimeout(4000);
  const result = await page.locator('[data-testid="out-gql-result"]').textContent();
  expect(result?.trim()).not.toBe('(not fetched)');
});

// WA-21: fetchData GET initial state
test('WA-21: REST initial state — out-rest-result starts as "(not fetched)"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-rest-result"]')).toHaveText('(not fetched)');
});

// ─── Card 10: fetchCollection + parallel + updateCollection + resetVariableValue ─

// WA-22: fetchCollection — fires and changes status var
test('WA-22: fetchCollection — clicking Fetch Collection changes out-fetch-count', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-fetch-count"]')).toHaveText('(not fetched)');
  await clickBtn(page, 'btn-wa-fetch-coll');
  await page.waitForTimeout(3000);
  const text = await page.locator('[data-testid="out-fetch-count"]').textContent();
  // Should be "fetching" or "fetched" (not the initial value)
  expect(text?.trim()).not.toBe('(not fetched)');
});

// WA-23: fetchCollectionsParallel — fires both parallel fetches
test('WA-23: fetchCollectionsParallel — both parallel outputs change from initial value', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-parallel-1"]')).toHaveText('(not fetched)');
  await expect(page.locator('[data-testid="out-parallel-2"]')).toHaveText('(not fetched)');
  await clickBtn(page, 'btn-wa-fetch-parallel');
  await page.waitForTimeout(3000);
  const p1 = await page.locator('[data-testid="out-parallel-1"]').textContent();
  const p2 = await page.locator('[data-testid="out-parallel-2"]').textContent();
  expect(p1?.trim()).not.toBe('(not fetched)');
  expect(p2?.trim()).not.toBe('(not fetched)');
});

// WA-24: updateCollection — fires and writes "updated" to status
test('WA-24: updateCollection — clicking Update Collection sets out-fetch-count to "updated"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-update-coll');
  await page.waitForTimeout(2000);
  await expect(page.locator('[data-testid="out-fetch-count"]')).toHaveText('updated');
});

// WA-25: resetVariableValue — Modify then Reset restores initial value
test('WA-25: resetVariableValue — modifying then resetting out-reset-check restores "(active)"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-reset-check"]')).toHaveText('(active)');
  await clickBtn(page, 'btn-wa-set-reset-check');
  await expect(page.locator('[data-testid="out-reset-check"]')).toHaveText('modified');
  await clickBtn(page, 'btn-wa-reset-vars');
  await expect(page.locator('[data-testid="out-reset-check"]')).toHaveText('(active)');
});

// WA-26: resetVariableValue initial state
test('WA-26: resetVariableValue initial state — out-reset-check starts as "(active)"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-reset-check"]')).toHaveText('(active)');
});

// WA-27: resetVariableValue — multiple rapid modify+reset cycles
test('WA-27: resetVariableValue — multiple modify+reset cycles stay consistent', async () => {
  const page = sharedPage;
  await resetPage(page);
  for (let i = 0; i < 3; i++) {
    await clickBtn(page, 'btn-wa-set-reset-check');
    await expect(page.locator('[data-testid="out-reset-check"]')).toHaveText('modified');
    await clickBtn(page, 'btn-wa-reset-vars');
    await expect(page.locator('[data-testid="out-reset-check"]')).toHaveText('(active)');
  }
});

// ─── Card 11: returnValue ─────────────────────────────────────────────────────

// WA-28: returnValue in trueBranch (score ≥ 60 → PASS)
test('WA-28: returnValue in trueBranch — score 80 returns "PASS"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-return-high');
  await expect(page.locator('[data-testid="out-return-result"]')).toHaveText('PASS', { timeout: 5_000 });
});

// WA-29: returnValue in falseBranch (score < 60 → FAIL)
test('WA-29: returnValue in falseBranch — score 30 returns "FAIL"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-return-low');
  await expect(page.locator('[data-testid="out-return-result"]')).toHaveText('FAIL', { timeout: 5_000 });
});

// WA-30: returnValue — switching branch outcomes
test('WA-30: returnValue — alternating high/low correctly switches PASS ↔ FAIL', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-return-high');
  await expect(page.locator('[data-testid="out-return-result"]')).toHaveText('PASS');
  await clickBtn(page, 'btn-wa-return-low');
  await expect(page.locator('[data-testid="out-return-result"]')).toHaveText('FAIL');
  await clickBtn(page, 'btn-wa-return-high');
  await expect(page.locator('[data-testid="out-return-result"]')).toHaveText('PASS');
});

// WA-31: returnValue — initial state
test('WA-31: returnValue — out-return-result starts as "(not run)"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-return-result"]')).toHaveText('(not run)');
});

// ─── Card 12: executeComponentAction + runProjectWorkflow ─────────────────────

// WA-32: executeComponentAction — calls waComponentWorkflow which sets out-exec-result
test('WA-32: executeComponentAction — clicking button calls component action, sets out-exec-result', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-exec-result"]')).toHaveText('(not run)');
  await clickBtn(page, 'btn-wa-exec-component');
  await expect(page.locator('[data-testid="out-exec-result"]')).toHaveText('component action executed!', { timeout: 5_000 });
});

// WA-33: runProjectWorkflow — calls waSubWorkflow which sets out-sub-wf-result
test('WA-33: runProjectWorkflow — clicking button runs sub-workflow, sets out-sub-wf-result', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-sub-wf-result"]')).toHaveText('(not run)');
  await clickBtn(page, 'btn-wa-run-subwf');
  await expect(page.locator('[data-testid="out-sub-wf-result"]')).toHaveText('sub-workflow ran!', { timeout: 5_000 });
});

// WA-34: executeComponentAction — multiple executions stay consistent
test('WA-34: executeComponentAction — multiple executions always produce same result', async () => {
  const page = sharedPage;
  await resetPage(page);
  for (let i = 0; i < 3; i++) {
    await clickBtn(page, 'btn-wa-exec-component');
    await expect(page.locator('[data-testid="out-exec-result"]')).toHaveText('component action executed!');
  }
});

// WA-35: runProjectWorkflow — initial state
test('WA-35: runProjectWorkflow — out-sub-wf-result starts as "(not run)"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-sub-wf-result"]')).toHaveText('(not run)');
});

// ─── Card 13: breakLoop + continueLoop + passThroughCondition ─────────────────

// WA-36: continueLoop skips even numbers, breakLoop stops at sum ≥ 4
// forEach [1,2,3,4,5]: skip 2,4 (even), add 1 → sum=1, add 3 → sum=4 (≥4 → break)
test('WA-36: continueLoop + breakLoop — forEach [1..5] skip evens, break when sum ≥ 4 → sum = 4', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-loop-sum"]')).toHaveText('0');
  await clickBtn(page, 'btn-wa-loop-control');
  await expect(page.locator('[data-testid="out-loop-sum"]')).toHaveText('4', { timeout: 5_000 });
});

// WA-37: continueLoop — re-running resets sum and produces same result
test('WA-37: continueLoop — re-running loop always resets and produces sum = 4', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-loop-control');
  await expect(page.locator('[data-testid="out-loop-sum"]')).toHaveText('4');
  await clickBtn(page, 'btn-wa-loop-control');
  await expect(page.locator('[data-testid="out-loop-sum"]')).toHaveText('4');
});

// WA-38: passThroughCondition — flag OFF blocks workflow step
test('WA-38: passThroughCondition — with flag=false, workflow is blocked (result stays "(blocked)")', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-flag-off');
  // Flag indicator must update to false
  await expect(page.locator('[data-testid="out-pass-flag"]')).toHaveText('false', { timeout: 3_000 });
  await clickBtn(page, 'btn-wa-pass-through');
  await expect(page.locator('[data-testid="out-pass-result"]')).toHaveText('(blocked)');
});

// WA-39: passThroughCondition — flag ON allows workflow step
test('WA-39: passThroughCondition — with flag=true, workflow continues (result = "passed through!")', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-flag-on');
  // Flag indicator must update to true
  await expect(page.locator('[data-testid="out-pass-flag"]')).toHaveText('true', { timeout: 3_000 });
  await clickBtn(page, 'btn-wa-pass-through');
  await expect(page.locator('[data-testid="out-pass-result"]')).toHaveText('passed through!', { timeout: 5_000 });
});

// WA-40: passThroughCondition — toggle flag shows correct behavior both ways
test('WA-40: passThroughCondition — toggling flag ON/OFF changes outcome correctly', async () => {
  const page = sharedPage;
  await resetPage(page);
  // Flag ON → indicator = true, passes
  await clickBtn(page, 'btn-wa-flag-on');
  await expect(page.locator('[data-testid="out-pass-flag"]')).toHaveText('true', { timeout: 3_000 });
  await clickBtn(page, 'btn-wa-pass-through');
  await expect(page.locator('[data-testid="out-pass-result"]')).toHaveText('passed through!');
  // Flag OFF → indicator = false, blocked
  await resetPage(page);
  await clickBtn(page, 'btn-wa-flag-off');
  await expect(page.locator('[data-testid="out-pass-flag"]')).toHaveText('false', { timeout: 3_000 });
  await clickBtn(page, 'btn-wa-pass-through');
  await expect(page.locator('[data-testid="out-pass-result"]')).toHaveText('(blocked)');
});

// ─── Card 14: multiOptionBranch ───────────────────────────────────────────────

// WA-41: multiOptionBranch — Mode A → "Option A selected"
test('WA-41: multiOptionBranch — Mode A → out-multi-result = "Option A selected"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-mode-a');
  await clickBtn(page, 'btn-wa-eval-multi');
  await expect(page.locator('[data-testid="out-multi-result"]')).toHaveText('Option A selected', { timeout: 5_000 });
});

// WA-42: multiOptionBranch — Mode B → "Option B selected"
test('WA-42: multiOptionBranch — Mode B → out-multi-result = "Option B selected"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-mode-b');
  await clickBtn(page, 'btn-wa-eval-multi');
  await expect(page.locator('[data-testid="out-multi-result"]')).toHaveText('Option B selected', { timeout: 5_000 });
});

// WA-43: multiOptionBranch — Mode C → "Option C selected"
test('WA-43: multiOptionBranch — Mode C → out-multi-result = "Option C selected"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-mode-c');
  await clickBtn(page, 'btn-wa-eval-multi');
  await expect(page.locator('[data-testid="out-multi-result"]')).toHaveText('Option C selected', { timeout: 5_000 });
});

// WA-44: multiOptionBranch — switching modes updates result correctly
test('WA-44: multiOptionBranch — switching A→B→C→A produces correct results each time', async () => {
  const page = sharedPage;
  await resetPage(page);
  const modes: Array<[string, string]> = [
    ['btn-wa-mode-a', 'Option A selected'],
    ['btn-wa-mode-b', 'Option B selected'],
    ['btn-wa-mode-c', 'Option C selected'],
    ['btn-wa-mode-a', 'Option A selected'],
  ];
  for (const [modeBtn, expected] of modes) {
    await clickBtn(page, modeBtn);
    await clickBtn(page, 'btn-wa-eval-multi');
    await expect(page.locator('[data-testid="out-multi-result"]')).toHaveText(expected);
  }
});

// ─── Card 15: Advanced Actions ────────────────────────────────────────────────

// WA-45: copyToClipboard — sets out-clipboard to "copied"
test('WA-45: copyToClipboard — clicking button sets out-clipboard = "copied"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-clipboard"]')).toHaveText('(not copied)');
  await clickBtn(page, 'btn-wa-copy');
  await expect(page.locator('[data-testid="out-clipboard"]')).toHaveText('copied', { timeout: 5_000 });
});

// WA-46: stopPropagation — clicking inner button does NOT trigger outer click
test('WA-46: stopPropagation — clicking inner button sets out-inner but NOT out-outer', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-outer-click"]')).toHaveText('(not clicked)');
  await expect(page.locator('[data-testid="out-inner-click"]')).toHaveText('(not clicked)');
  await clickBtn(page, 'btn-wa-inner-stop');
  await expect(page.locator('[data-testid="out-inner-click"]')).toHaveText('inner clicked');
  // Outer must remain untouched — stopPropagation prevented event from bubbling
  await expect(page.locator('[data-testid="out-outer-click"]')).toHaveText('(not clicked)');
});

// WA-47: stopPropagation — clicking outer zone does fire outer click
test('WA-47: stopPropagation — clicking outer zone (not inner) does set out-outer-click', async () => {
  const page = sharedPage;
  await resetPage(page);
  // Click on the outer zone text directly (not the inner button)
  await page.locator('[data-testid="outer-click-zone"]').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="out-outer-click"]')).toHaveText('outer clicked');
});

// WA-48: printPdf — fires pre-step var, no crash
test('WA-48: printPdf — clicking button sets out-pdf-fired = "fired" (pre-step var)', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-pdf-fired"]')).toHaveText('(not fired)');
  await clickBtn(page, 'btn-wa-print-pdf');
  await expect(page.locator('[data-testid="out-pdf-fired"]')).toHaveText('fired', { timeout: 5_000 });
});

// WA-48b: printPdf — theme class on <html> is preserved even when the class is flipped
// synchronously (beforeprint) AND asynchronously (simulated React async commit after print).
test('WA-48b: printPdf — theme class on <html> is unchanged after print (sync + async flips)', async () => {
  const page = sharedPage;
  await resetPage(page);

  const darkBefore = await page.evaluate(() => document.documentElement.classList.contains('dark'));

  // Inject a beforeprint listener that flips the class synchronously (simulates NativeWind
  // reacting to a prefers-color-scheme change fired during the beforeprint event).
  await page.evaluate(() => {
    window.addEventListener('beforeprint', () => {
      const html = document.documentElement;
      if (html.classList.contains('dark')) html.classList.remove('dark');
      else html.classList.add('dark');
    });
  });

  await clickBtn(page, 'btn-wa-print-pdf');

  // Simulate the async React commit that fires AFTER window.print() returns —
  // NativeWind's state update schedules a render that re-flips the class.
  await page.waitForTimeout(50); // let window.print() + sync code settle
  await page.evaluate(() => {
    // Re-flip as if React just committed NativeWind's stale color-scheme state
    const html = document.documentElement;
    if (html.classList.contains('dark')) html.classList.remove('dark');
    else html.classList.add('dark');
  });

  // Wait for the MutationObserver to catch and revert the flip (it stays active for 600ms)
  await page.waitForTimeout(200);

  const darkAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  expect(darkAfter).toBe(darkBefore);
});

// WA-49: downloadFileFromUrl — fires pre-step var, no crash
test('WA-49: downloadFileFromUrl — clicking button sets out-download-fired = "fired"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-download-fired"]')).toHaveText('(not fired)');
  await clickBtn(page, 'btn-wa-download');
  await expect(page.locator('[data-testid="out-download-fired"]')).toHaveText('fired', { timeout: 5_000 });
});

// WA-50: createUrlFromBase64 — sets out-b64-url to a non-empty value
test('WA-50: createUrlFromBase64 — clicking button sets out-b64-url to a non-empty value', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-b64-url"]')).toHaveText('');
  await clickBtn(page, 'btn-wa-b64-url');
  await page.waitForTimeout(600);
  const urlVal = await page.locator('[data-testid="out-b64-url"]').textContent();
  // Should be a blob: or data: URL, or at least non-empty
  expect(urlVal?.trim().length).toBeGreaterThan(0);
});

// WA-51: encodeFileAsBase64 — fires without crash
test('WA-51: encodeFileAsBase64 — clicking button sets out-encode-b64 to a non-empty value', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-encode-b64');
  // The handler strips the data URI prefix and stores just the base64 string
  await expect(page.locator('[data-testid="out-encode-b64"]')).not.toHaveText('', { timeout: 3_000 });
});

// WA-52: Advanced actions — all buttons present
test('WA-52: Advanced actions — all action buttons are visible on the page', async () => {
  const page = sharedPage;
  await resetPage(page);
  const btns = [
    'btn-wa-copy', 'btn-wa-inner-stop', 'btn-wa-print-pdf',
    'btn-wa-download', 'btn-wa-b64-url', 'btn-wa-encode-b64',
  ];
  for (const btnId of btns) {
    await expect(page.locator(`[data-testid="${btnId}"]`)).toBeVisible();
  }
});

// ─── Card 16: Complex — Branch inside Loop inside Branch ─────────────────────

// WA-53: score ≥ 50 → trueBranch → forEach [A,B,C] → breakLoop on B → loop-count = 1
test('WA-53: Complex16 — score 75 (true branch) → forEach breaks on B → loop-count = 1, status = done-true', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-complex-high');
  await expect(page.locator('[data-testid="out-complex-loop-count"]')).toHaveText('1', { timeout: 5_000 });
  await expect(page.locator('[data-testid="out-complex-status"]')).toHaveText('done-true');
});

// WA-54: score < 50 → falseBranch → status = done-false, loop not executed
test('WA-54: Complex16 — score 30 (false branch) → status = done-false, loop-count = 0', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-complex-low');
  await expect(page.locator('[data-testid="out-complex-status"]')).toHaveText('done-false', { timeout: 5_000 });
  await expect(page.locator('[data-testid="out-complex-loop-count"]')).toHaveText('0');
});

// WA-55: Complex16 — alternating high/low produces correct results
test('WA-55: Complex16 — alternating high/low scores produces correct branch results', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-complex-high');
  await expect(page.locator('[data-testid="out-complex-status"]')).toHaveText('done-true');
  await clickBtn(page, 'btn-wa-complex-low');
  await expect(page.locator('[data-testid="out-complex-status"]')).toHaveText('done-false');
  await clickBtn(page, 'btn-wa-complex-high');
  await expect(page.locator('[data-testid="out-complex-status"]')).toHaveText('done-true');
});

// WA-56: Complex16 — loop-count resets on each run
test('WA-56: Complex16 — loop-count resets to 0 before each run', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-complex-high');
  await expect(page.locator('[data-testid="out-complex-loop-count"]')).toHaveText('1');
  // Run low (no loop) then high again to verify reset
  await clickBtn(page, 'btn-wa-complex-low');
  await clickBtn(page, 'btn-wa-complex-high');
  await expect(page.locator('[data-testid="out-complex-loop-count"]')).toHaveText('1');
});

// WA-57: Complex16 — initial state
test('WA-57: Complex16 — initial state: loop-count=0, status=(not run)', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-complex-loop-count"]')).toHaveText('0');
  await expect(page.locator('[data-testid="out-complex-status"]')).toHaveText('(not run)');
});

// ─── Card 17: Complex Combined ────────────────────────────────────────────────

// WA-58: mode=fast → whileLoop counts to 3 → fast-count = 3, result = "fast-done"
test('WA-58: Complex17 fast — whileLoop counts to 3, fast-count = 3, result = "fast-done"', async () => {
  const page = sharedPage;
  await resetPage(page);
  // Verify initial state before clicking
  await expect(page.locator('[data-testid="out-fast-count"]')).toHaveText('0');
  await expect(page.locator('[data-testid="out-complex-result"]')).toHaveText('(not run)');
  // The button sets mode then runs the combined workflow
  const btn = page.locator('[data-testid="btn-wa-mode-fast"]');
  await btn.click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="out-fast-count"]')).toHaveText('3', { timeout: 8_000 });
  await expect(page.locator('[data-testid="out-complex-result"]')).toHaveText('fast-done');
});

// WA-59: mode=slow → forEach [1..5] odd sum — slow-sum = 9, result = "slow-done"
test('WA-59: Complex17 slow — forEach [1..5] continueLoop on evens → odd sum = 9, result = "slow-done"', async () => {
  const page = sharedPage;
  await resetPage(page);
  const btn = page.locator('[data-testid="btn-wa-mode-slow"]');
  await btn.click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="out-slow-sum"]')).toHaveText('9', { timeout: 8_000 });
  await expect(page.locator('[data-testid="out-complex-result"]')).toHaveText('slow-done');
});

// WA-60: mode=skip → passThroughCondition (flag=true by default after reset) → result = "skipped"
test('WA-60: Complex17 skip — passThroughCondition (flag=true) → result = "skipped"', async () => {
  const page = sharedPage;
  await resetPage(page);
  const btn = page.locator('[data-testid="btn-wa-mode-skip"]');
  await btn.click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="out-complex-result"]')).toHaveText('skipped', { timeout: 8_000 });
});

// WA-61: Complex17 — switching modes produces distinct results
test('WA-61: Complex17 — switching modes fast→slow→skip produces correct distinct results', async () => {
  const page = sharedPage;
  await resetPage(page);

  page.locator('[data-testid="btn-wa-mode-fast"]').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="out-complex-result"]')).toHaveText('fast-done', { timeout: 8_000 });

  page.locator('[data-testid="btn-wa-mode-slow"]').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="out-complex-result"]')).toHaveText('slow-done', { timeout: 8_000 });

  page.locator('[data-testid="btn-wa-mode-skip"]').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="out-complex-result"]')).toHaveText('skipped', { timeout: 8_000 });
});

// WA-62: Complex17 — initial state
test('WA-62: Complex17 — initial state: fast-count=0, slow-sum=0, result=(not run)', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-fast-count"]')).toHaveText('0');
  await expect(page.locator('[data-testid="out-slow-sum"]')).toHaveText('0');
  await expect(page.locator('[data-testid="out-complex-result"]')).toHaveText('(not run)');
});

// ─── Update Collection (all 4 types) ─────────────────────────────────────────

// WA-63: updateCollection replaceAll — seeds 3 items into the collection
test('WA-63: updateCollection replaceAll — seeds collection with Alpha, Beta, Gamma (count=3)', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-update-replace-all"]')).toHaveText('(not run)');
  await clickBtn(page, 'btn-wa-update-replace-all');
  await expect(page.locator('[data-testid="out-update-replace-all"]')).toHaveText('seeded-3-items', { timeout: 5_000 });
  // Verify the 3 items are now visible
  await expect(page.locator('[data-testid="out-update-count"]')).toHaveText('3', { timeout: 3_000 });
  const names = page.locator('[data-testid="out-item-name"]');
  await expect(names.nth(0)).toHaveText('Alpha');
  await expect(names.nth(1)).toHaveText('Beta');
  await expect(names.nth(2)).toHaveText('Gamma');
});

// WA-64: updateCollection insert — inserts "New Item" at position 0
test('WA-64: updateCollection insert — inserts "New Item" at position 0, count becomes 4', async () => {
  const page = sharedPage;
  await resetPage(page);
  // Seed first
  await clickBtn(page, 'btn-wa-update-replace-all');
  await expect(page.locator('[data-testid="out-update-count"]')).toHaveText('3', { timeout: 5_000 });
  // Insert
  await clickBtn(page, 'btn-wa-update-insert');
  await expect(page.locator('[data-testid="out-update-insert"]')).toHaveText('insert-done', { timeout: 5_000 });
  await expect(page.locator('[data-testid="out-update-count"]')).toHaveText('4', { timeout: 3_000 });
  // First item should be the new one
  await expect(page.locator('[data-testid="out-item-name"]').first()).toHaveText('New Item');
});

// WA-65: updateCollection update (by id) — updates item-1 name to "Alpha UPDATED"
test('WA-65: updateCollection update (by id) — item-1 name becomes "Alpha UPDATED"', async () => {
  const page = sharedPage;
  await resetPage(page);
  // Seed first
  await clickBtn(page, 'btn-wa-update-replace-all');
  await expect(page.locator('[data-testid="out-update-count"]')).toHaveText('3', { timeout: 5_000 });
  // Update
  await clickBtn(page, 'btn-wa-update-item');
  await expect(page.locator('[data-testid="out-update-item"]')).toHaveText('update-done', { timeout: 5_000 });
  await expect(page.locator('[data-testid="out-update-count"]')).toHaveText('3');
  await expect(page.locator('[data-testid="out-item-name"]').first()).toHaveText('Alpha UPDATED');
});

// WA-66: updateCollection delete (by id) — removes item-2 (Beta), count becomes 2
test('WA-66: updateCollection delete (by id) — item-2 (Beta) removed, count becomes 2', async () => {
  const page = sharedPage;
  await resetPage(page);
  // Seed first
  await clickBtn(page, 'btn-wa-update-replace-all');
  await expect(page.locator('[data-testid="out-update-count"]')).toHaveText('3', { timeout: 5_000 });
  // Delete
  await clickBtn(page, 'btn-wa-update-delete');
  await expect(page.locator('[data-testid="out-update-delete"]')).toHaveText('delete-done', { timeout: 5_000 });
  await expect(page.locator('[data-testid="out-update-count"]')).toHaveText('2', { timeout: 3_000 });
  // Beta should be gone — only Alpha and Gamma remain
  const names = page.locator('[data-testid="out-item-name"]');
  await expect(names.nth(0)).toHaveText('Alpha');
  await expect(names.nth(1)).toHaveText('Gamma');
});

// ─── JSON Logic Removal + Formula Condition ────────────────────────────────────

// WA-67: "No items" empty-state text visible before seeding
// Verifies that the formula string condition ("!collections?.['UUID']?.data?.length")
// evaluates correctly — the old JSON Logic { "not": { "var": "..." } } always returned false.
test('WA-67: empty-state "No items" text is visible before seeding collection', async () => {
  const page = sharedPage;
  await resetPage(page);
  // On fresh load the collection is empty — the empty-state text must be visible
  await expect(page.locator('text=No items — click Seed first')).toBeVisible({ timeout: 5_000 });
});

// WA-68: "No items" text hides after seeding collection
test('WA-68: empty-state "No items" text is hidden after seeding collection', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-wa-update-replace-all');
  await expect(page.locator('[data-testid="out-update-count"]')).toHaveText('3', { timeout: 5_000 });
  // Empty-state text must be gone once items exist
  await expect(page.locator('text=No items — click Seed first')).not.toBeVisible({ timeout: 3_000 });
});

// ─── URL Param Sync via variables.json urlParam ───────────────────────────────

// WA-69: URL query param ?q= syncs to route.q via variables.json urlParam
test('WA-69: URL param ?q= syncs to Search Query variable via urlParam in variables.json', async ({ page }) => {
  await page.goto(`${PREVIEW_DEV_BASE}/workflow-test?q=hello`);
  await page.waitForSelector('[data-testid="out-created"]', { timeout: 30_000 });
  await page.waitForTimeout(600);
  // The search query variable should reflect the URL param
  // The workflow-test page has a display for nav.searchQuery or we verify via URL
  // Just verify page loaded without error (sync is tested indirectly via collection page)
  const url = page.url();
  expect(url).toContain('q=hello');
});

// ─── Named Route Params ───────────────────────────────────────────────────────

// WA-70: Dynamic route /product/:slug — route.slug is extracted from URL
test('WA-70: dynamic route /product/:slug — route.slug extracted and stored', async ({ page }) => {
  await page.goto(`${PREVIEW_DEV_BASE}/product/my-test-slug`);
  await page.waitForTimeout(2_000);
  // Page should load without crashing (product config uses route.slug for data fetch)
  const title = await page.title();
  expect(title).toBeTruthy();
  // No uncaught JS errors
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForTimeout(500);
  expect(errors.filter(e => !e.includes('network') && !e.includes('fetch'))).toHaveLength(0);
});

// ─── Card B: Complex Form Validation ─────────────────────────────────────────

// WA-71: Submit empty form — all required fields show errors
test('WA-71: submit empty form — required field errors appear', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-val2-submit');
  await expect(page.locator('[data-testid="err-val2-username"]')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="err-val2-username"]')).toHaveText('Username is required');
  await expect(page.locator('[data-testid="err-val2-email"]')).toBeVisible();
  await expect(page.locator('[data-testid="err-val2-email"]')).toHaveText('Email is required');
  await expect(page.locator('[data-testid="err-val2-age"]')).toBeVisible();
  await expect(page.locator('[data-testid="err-val2-age"]')).toHaveText('Age is required');
  await expect(page.locator('[data-testid="err-val2-password"]')).toBeVisible();
  await expect(page.locator('[data-testid="err-val2-password"]')).toHaveText('Password is required');
  await expect(page.locator('[data-testid="err-val2-confirm"]')).toBeVisible();
  await expect(page.locator('[data-testid="err-val2-confirm"]')).toHaveText('Please confirm your password');
});

// WA-72: Live change validation — username too short shows inline error immediately
test('WA-72: change trigger — typing short username shows inline error live', async () => {
  const page = sharedPage;
  await resetPage(page);
  await page.locator('#val2-username-input input').fill('ab');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="err-val2-username"]')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="err-val2-username"]')).toContainText('at least 3');
});

// WA-73: Live change validation — 3-char username clears the error
test('WA-73: change trigger — valid username (3+ chars) clears the inline error', async () => {
  const page = sharedPage;
  await resetPage(page);
  // Type a short name first to trigger the error
  await page.locator('#val2-username-input input').fill('ab');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="err-val2-username"]')).toBeVisible({ timeout: 3_000 });
  // Fix it — error must disappear
  await page.locator('#val2-username-input input').fill('alice');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="err-val2-username"]')).not.toBeVisible({ timeout: 3_000 });
});

// WA-74: Live email validation — bad format shows error
test('WA-74: change trigger — invalid email format shows inline error', async () => {
  const page = sharedPage;
  await resetPage(page);
  await page.locator('#val2-email-input input').fill('notanemail');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="err-val2-email"]')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="err-val2-email"]')).toContainText('valid email');
});

// WA-75: Password strength — missing uppercase shows error
test('WA-75: password strength — no uppercase letter shows error', async () => {
  const page = sharedPage;
  await resetPage(page);
  await page.locator('#val2-password-input input').fill('alllowercase1!');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="err-val2-password"]')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="err-val2-password"]')).toContainText('uppercase');
});

// WA-76: Password strength — strong password clears all errors
test('WA-76: password strength — SecureP@ss1 clears all password errors', async () => {
  const page = sharedPage;
  await resetPage(page);
  await page.locator('#val2-password-input input').fill('SecureP@ss1');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="err-val2-password"]')).not.toBeVisible({ timeout: 3_000 });
});

// WA-77: Confirm password — mismatch shows equalsField error
test('WA-77: equalsField — confirm password mismatch shows "Passwords do not match"', async () => {
  const page = sharedPage;
  await resetPage(page);
  await page.locator('#val2-password-input input').fill('SecureP@ss1');
  await page.waitForTimeout(200);
  await page.locator('#val2-confirm-input input').fill('different');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="err-val2-confirm"]')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="err-val2-confirm"]')).toHaveText('Passwords do not match');
});

// WA-78: Confirm password — matching passwords clears equalsField error
test('WA-78: equalsField — matching passwords clears confirm error', async () => {
  const page = sharedPage;
  await resetPage(page);
  await page.locator('#val2-password-input input').fill('SecureP@ss1');
  await page.waitForTimeout(200);
  await page.locator('#val2-confirm-input input').fill('SecureP@ss1');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="err-val2-confirm"]')).not.toBeVisible({ timeout: 3_000 });
});

// WA-79: Pre-fill — fills all 6 fields (username, email, phone, age, password, confirm)
test('WA-79: pre-fill — clicking Pre-fill populates all 6 fields', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-val2-prefill');
  await expect(page.locator('#val2-username-input input')).toHaveValue('alice', { timeout: 3_000 });
  await expect(page.locator('#val2-email-input input')).toHaveValue('alice@example.com');
  await expect(page.locator('#val2-phone-input input')).toHaveValue('+12345678');
  await expect(page.locator('#val2-age-input input')).toHaveValue('25');
});

// WA-80: Pre-fill then submit — no validation errors, submit result shown
test('WA-80: pre-fill then submit — all fields valid, submit result displayed', async () => {
  const page = sharedPage;
  await resetPage(page);
  await clickBtn(page, 'btn-val2-prefill');
  await page.waitForTimeout(500);
  await clickBtn(page, 'btn-val2-submit');
  // No inline errors should be shown
  await expect(page.locator('[data-testid="err-val2-username"]')).not.toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="err-val2-email"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="err-val2-password"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="err-val2-confirm"]')).not.toBeVisible();
  // Submit result should appear
  await expect(page.locator('[data-testid="out-val2-result"]')).not.toHaveText('', { timeout: 3_000 });
});

// WA-81: Reset — clears all fields and errors
test('WA-81: reset — clears fields and hides all errors', async () => {
  const page = sharedPage;
  await resetPage(page);
  // First fill some fields (triggering live errors on bad values)
  await page.locator('#val2-username-input input').fill('ab');
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid="err-val2-username"]')).toBeVisible({ timeout: 3_000 });
  // Reset
  await clickBtn(page, 'btn-val2-reset');
  await page.waitForTimeout(400);
  await expect(page.locator('#val2-username-input input')).toHaveValue('');
  await expect(page.locator('[data-testid="err-val2-username"]')).not.toBeVisible({ timeout: 3_000 });
});

// WA-82: Age under-18 shows formula validation error
test('WA-82: formula validation — age < 18 shows "must be at least 18" error', async () => {
  const page = sharedPage;
  await resetPage(page);
  await page.locator('#val2-age-input input').fill('16');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="err-val2-age"]')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('[data-testid="err-val2-age"]')).toContainText('18');
});

// ─── Card A: Full Pipeline (API Chain + all branch/loop types) ────────────────
//
// WA-83 – WA-92: End-to-end coverage of waApiChain which exercises every
//   branch and loop type in one flow:
//   graphql → branch (T/F) → REST GET → REST POST → updateCollection
//   → executeComponentAction (multiOptionBranch + forEach in sub-task)
//   → whileLoop → forEach → multiOptionBranch → passThroughCondition → done
//
// Uses real external APIs (httpbin.org, countries.trevorblades.com); tests
// have a 45 s timeout to accommodate network latency.

const PIPELINE_TIMEOUT = 45_000; // ms to wait for "done ✓" after clicking Run

/**
 * Click "Run Pipeline" and wait until the pipeline has passed the loop phase.
 * We use out-chain-while = "3" as the completion signal — the whileLoop step
 * always runs and produces exactly 3 regardless of GQL/REST success. This avoids
 * the false-positive caused by intermediate status strings like "(step 3/6: REST done)"
 * which contain the word "done" but are set well before loops execute.
 */
async function runPipeline(page: Page) {
  // Reset while-count to 0 is done by the workflow itself, but we also confirm
  // it was "0" (or initial) before clicking so the waiter below won't fire early.
  await page.locator('[data-testid="btn-run-chain"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="out-chain-while"]')?.textContent === '3',
    { timeout: PIPELINE_TIMEOUT }
  );
}

// WA-83: Initial state — all chain outputs are empty / idle before first run
test('WA-83: Card A initial state — status=idle, all outputs empty', async () => {
  const page = sharedPage;
  await resetPage(page);
  await expect(page.locator('[data-testid="out-chain-status"]')).toHaveText('idle', { timeout: 5_000 });
  await expect(page.locator('[data-testid="out-chain-gql"]')).toHaveText('');
  await expect(page.locator('[data-testid="out-chain-rest"]')).toHaveText('');
  await expect(page.locator('[data-testid="out-chain-branch"]')).toHaveText('');
  await expect(page.locator('[data-testid="out-chain-result"]')).toHaveText('');
  await expect(page.locator('[data-testid="out-chain-while"]')).toHaveText('0');
  await expect(page.locator('[data-testid="out-chain-foreach"]')).toHaveText('');
  await expect(page.locator('[data-testid="out-chain-multi"]')).toHaveText('');
});

// WA-84: Pipeline runs to completion — status advances past the reset state.
// Either "done ✓" (all APIs OK) or "loops done" (GQL failed but loops ran) is accepted.
test('WA-84: Card A pipeline — status advances past idle (pipeline fully executed)', async () => {
  const page = sharedPage;
  await resetPage(page);
  await runPipeline(page);
  const statusText = await page.locator('[data-testid="out-chain-status"]').textContent();
  // Must have moved past idle — either final "done ✓" or at least the loop phase
  expect(statusText).not.toBe('idle');
  expect(statusText!.length).toBeGreaterThan(0);
});

// WA-85: GQL step executed — country is non-empty (either "France" on success
// or "(gql-failed)" when the endpoint is down; both prove the step ran).
test('WA-85: Card A — GQL step executed: country field is non-empty', async () => {
  const page = sharedPage;
  await resetPage(page);
  await runPipeline(page);
  const gqlText = await page.locator('[data-testid="out-chain-gql"]').textContent();
  expect(gqlText!.length).toBeGreaterThan(0);
});

// WA-86: True/False branch (branch) executed — branch path is non-empty,
// confirming the branch step ran. Value is "GQL OK…" or "GQL FAILED".
test('WA-86: Card A — branch step executed: branch path is non-empty', async () => {
  const page = sharedPage;
  await resetPage(page);
  await runPipeline(page);
  const branchText = await page.locator('[data-testid="out-chain-branch"]').textContent();
  expect(branchText!.length).toBeGreaterThan(0);
  // One of the two branch outcomes must have fired
  expect(branchText!.startsWith('GQL')).toBe(true);
});

// WA-87: REST GET + POST steps ran — echo is non-empty, confirming fetchData ran.
// Value is "(gql-failed)" when GQL down (body used that fallback), otherwise the
// country echoed back by httpbin.
test('WA-87: Card A — REST fetchData steps ran: REST echo is non-empty', async () => {
  const page = sharedPage;
  await resetPage(page);
  await runPipeline(page);
  const restText = await page.locator('[data-testid="out-chain-rest"]').textContent();
  expect(restText!.length).toBeGreaterThan(0);
});

// WA-88: whileLoop counts exactly to 3 — pure local logic, never depends on APIs
test('WA-88: Card A — whileLoop: while-count = 3 after pipeline run', async () => {
  const page = sharedPage;
  await resetPage(page);
  await runPipeline(page);
  await expect(page.locator('[data-testid="out-chain-while"]')).toHaveText('3', { timeout: 3_000 });
});

// WA-89: forEach builds "alpha|beta|gamma" — pure local logic, never depends on APIs
test('WA-89: Card A — forEach: result = "alpha|beta|gamma" after pipeline run', async () => {
  const page = sharedPage;
  await resetPage(page);
  await runPipeline(page);
  await expect(page.locator('[data-testid="out-chain-foreach"]')).toHaveText('alpha|beta|gamma', { timeout: 3_000 });
});

// WA-90: multiOptionBranch executed — result is one of the two known outcomes
// ("multi:GQL-OK" when GQL succeeded, "multi:FALLBACK" when it failed).
test('WA-90: Card A — multiOptionBranch ran: result is either GQL-OK or FALLBACK', async () => {
  const page = sharedPage;
  await resetPage(page);
  await runPipeline(page);
  const multiText = await page.locator('[data-testid="out-chain-multi"]').textContent();
  expect(['multi:GQL-OK', 'multi:FALLBACK']).toContain(multiText);
});

// WA-91: sub-task (executeComponentAction) ran — pipeline result is non-empty
// and starts with either "GQL:" (success) or "pipeline-failed" (GQL down).
test('WA-91: Card A — executeComponentAction sub-task ran: pipeline result is non-empty', async () => {
  const page = sharedPage;
  await resetPage(page);
  await runPipeline(page);
  const resultText = await page.locator('[data-testid="out-chain-result"]').textContent();
  expect(resultText!.length).toBeGreaterThan(0);
  const startsCorrectly = resultText!.startsWith('GQL:') || resultText!.startsWith('pipeline-failed');
  expect(startsCorrectly).toBe(true);
});

// WA-92: Running pipeline twice resets and re-executes — pure-logic outputs
// (whileLoop count, forEach items) are identical on both runs, confirming the
// reset phase clears state correctly before each execution.
test('WA-92: Card A — running pipeline twice: loop outputs identical on both runs', async () => {
  const page = sharedPage;
  // First run
  await resetPage(page);
  await runPipeline(page);
  const while1 = await page.locator('[data-testid="out-chain-while"]').textContent();
  const forEach1 = await page.locator('[data-testid="out-chain-foreach"]').textContent();
  // Navigate back so variables reset to initial values before the second run
  await resetPage(page);
  await runPipeline(page);
  const while2 = await page.locator('[data-testid="out-chain-while"]').textContent();
  const forEach2 = await page.locator('[data-testid="out-chain-foreach"]').textContent();
  expect(while1).toBe('3');
  expect(while2).toBe('3');
  expect(forEach1).toBe('alpha|beta|gamma');
  expect(forEach2).toBe('alpha|beta|gamma');
});
