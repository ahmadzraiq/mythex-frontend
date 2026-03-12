/**
 * Workflow Showcase — E2E Tests (WF series)
 *
 * Tests the /workflow-test page which exercises the workflow engine features:
 *
 * Card 1 — setVar + variable binding
 *   WF-01  Page loads and shows initial state in all outputs
 *   WF-02  Clicking "Hello" sets demo.message → "Hello, World!"
 *   WF-03  Clicking "Goodbye" changes demo.message → "Goodbye, World!"
 *   WF-04  Clicking "Testing" changes demo.message → "Testing 123!"
 *
 * Card 2 — branch (if/else)
 *   WF-05  "Set number = 3" then "Evaluate Branch" → FALSE branch fires
 *   WF-06  "Set number = 15" then "Evaluate Branch" → TRUE branch fires
 *   WF-07  demo.number display reflects the set value correctly
 *
 * Card 3 — runMultiple
 *   WF-08  "Run All 3 Steps" updates step1, step2, step3 outputs simultaneously
 *
 * Card 4 — increment / decrement
 *   WF-09  Counter starts at 0 (initial state)
 *   WF-10  "+ 1" increments counter to 1
 *   WF-11  "+ 1" again increments counter to 2
 *   WF-12  "- 1" decrements counter from 2 to 1
 *   WF-13  "Reset" sets counter back to 0
 *   WF-14  "- 1" when counter = 0 stays at 0 (min clamp)
 *
 * Card 5 — The Complete Pipeline (all structural types)
 *   WF-15  Initial state for Card 5 outputs
 *   WF-16  score=20 → pipeline → grade=FAIL, forEach=3, whileLoop=3, status=complete
 *   WF-17  score=45 → pipeline → grade=POOR (30–59)
 *   WF-18  score=75 → pipeline → grade=GOOD (60–89)
 *   WF-19  score=95 → pipeline → grade=EXCELLENT (≥90)
 *   WF-20  timeDelay: "(running pipeline…)" appears briefly before completion
 *   WF-21  Re-running pipeline resets counters and re-evaluates from scratch
 *
 * Run: npx playwright test e2e/workflow-showcase.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// Generous per-test timeout: page load on a cold dev server can take 10-15 s
test.setTimeout(60_000);

// ─── Shared page ──────────────────────────────────────────────────────────────
// Load once in beforeAll; each test calls resetPage() for a clean initial state.

let sharedPage: Page;

test.beforeAll(async ({ browser }) => {
  sharedPage = await browser.newPage();
  await sharedPage.goto('/workflow-test');
  // Wait until the SDUI engine has rendered the initial state
  await sharedPage.waitForSelector('[data-testid="out-message"]', { timeout: 30_000 });
  await sharedPage.waitForTimeout(500);
});

test.afterAll(async () => {
  await sharedPage.close();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Reload the shared page so every test starts from the screen's initial state */
async function resetPage(page: Page) {
  await page.reload();
  await page.waitForSelector('[data-testid="out-message"]', { timeout: 30_000 });
  await page.waitForTimeout(300);
}

/** Click a Button by its exact visible text using ARIA role (works with Gluestack Pressable) */
async function clickBtn(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  // Give the workflow engine and React time to process and re-render
  await page.waitForTimeout(400);
}

// ─── WF-01 — Page loads with initial state ────────────────────────────────────

test('WF-01: page loads and shows initial state in all outputs', async () => {
  const page = sharedPage;
  await resetPage(page);

  await expect(page.locator('[data-testid="out-message"]')).toHaveText('(click a button)');
  await expect(page.locator('[data-testid="out-number"]')).toHaveText('5');
  await expect(page.locator('[data-testid="out-branch"]')).toHaveText('(set a number, then evaluate)');
  await expect(page.locator('[data-testid="out-step1"]')).toHaveText('(not run yet)');
  await expect(page.locator('[data-testid="out-step2"]')).toHaveText('(not run yet)');
  await expect(page.locator('[data-testid="out-step3"]')).toHaveText('(not run yet)');
  await expect(page.locator('[data-testid="out-count"]')).toHaveText('0');
});

// ─── WF-02 — setVar: Hello ────────────────────────────────────────────────────

test('WF-02: clicking Hello sets demo.message to "Hello, World!"', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, 'Hello');

  await expect(page.locator('[data-testid="out-message"]')).toHaveText('Hello, World!', { timeout: 8_000 });
});

// ─── WF-03 — setVar: Goodbye ──────────────────────────────────────────────────

test('WF-03: clicking Goodbye changes demo.message to "Goodbye, World!"', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, 'Goodbye');

  await expect(page.locator('[data-testid="out-message"]')).toHaveText('Goodbye, World!', { timeout: 8_000 });
});

// ─── WF-04 — setVar: Testing ──────────────────────────────────────────────────

test('WF-04: clicking Testing changes demo.message to "Testing 123!"', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, 'Testing');

  await expect(page.locator('[data-testid="out-message"]')).toHaveText('Testing 123!', { timeout: 8_000 });
});

// ─── WF-05 — branch: FALSE path ───────────────────────────────────────────────

test('WF-05: number = 3 then Evaluate Branch → FALSE branch fires', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, 'Set number = 3');
  await expect(page.locator('[data-testid="out-number"]')).toHaveText('3', { timeout: 5_000 });

  await clickBtn(page, 'Evaluate Branch');

  await expect(page.locator('[data-testid="out-branch"]')).toHaveText(
    'FALSE branch: number is less than 10',
    { timeout: 8_000 }
  );
});

// ─── WF-06 — branch: TRUE path ────────────────────────────────────────────────

test('WF-06: number = 15 then Evaluate Branch → TRUE branch fires', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, 'Set number = 15');
  await expect(page.locator('[data-testid="out-number"]')).toHaveText('15', { timeout: 5_000 });

  await clickBtn(page, 'Evaluate Branch');

  await expect(page.locator('[data-testid="out-branch"]')).toHaveText(
    'TRUE branch: number is 10 or more',
    { timeout: 8_000 }
  );
});

// ─── WF-07 — branch: number display ──────────────────────────────────────────

test('WF-07: demo.number display updates when number is set', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, 'Set number = 3');
  await expect(page.locator('[data-testid="out-number"]')).toHaveText('3', { timeout: 5_000 });

  await clickBtn(page, 'Set number = 15');
  await expect(page.locator('[data-testid="out-number"]')).toHaveText('15', { timeout: 5_000 });
});

// ─── WF-08 — runMultiple ──────────────────────────────────────────────────────

test('WF-08: "Run All 3 Steps" updates all three step outputs simultaneously', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, 'Run All 3 Steps');

  await expect(page.locator('[data-testid="out-step1"]')).toHaveText('Step 1 complete', { timeout: 8_000 });
  await expect(page.locator('[data-testid="out-step2"]')).toHaveText('Step 2 complete', { timeout: 5_000 });
  await expect(page.locator('[data-testid="out-step3"]')).toHaveText('Step 3 complete', { timeout: 5_000 });
});

// ─── WF-09 — counter initial state ────────────────────────────────────────────

test('WF-09: counter starts at 0', async () => {
  const page = sharedPage;
  await resetPage(page);

  await expect(page.locator('[data-testid="out-count"]')).toHaveText('0');
});

// ─── WF-10 — increment once ───────────────────────────────────────────────────

test('WF-10: "+ 1" increments counter from 0 to 1', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, '+ 1');

  await expect(page.locator('[data-testid="out-count"]')).toHaveText('1', { timeout: 8_000 });
});

// ─── WF-11 — increment twice ─────────────────────────────────────────────────

test('WF-11: "+ 1" twice increments counter to 2', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, '+ 1');
  await expect(page.locator('[data-testid="out-count"]')).toHaveText('1', { timeout: 5_000 });

  await clickBtn(page, '+ 1');
  await expect(page.locator('[data-testid="out-count"]')).toHaveText('2', { timeout: 5_000 });
});

// ─── WF-12 — decrement ───────────────────────────────────────────────────────

test('WF-12: "- 1" decrements counter from 2 to 1', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, '+ 1');
  await clickBtn(page, '+ 1');
  await expect(page.locator('[data-testid="out-count"]')).toHaveText('2', { timeout: 5_000 });

  await clickBtn(page, '- 1');
  await expect(page.locator('[data-testid="out-count"]')).toHaveText('1', { timeout: 5_000 });
});

// ─── WF-13 — reset ───────────────────────────────────────────────────────────

test('WF-13: "Reset" sets counter back to 0', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, '+ 1');
  await clickBtn(page, '+ 1');
  await clickBtn(page, '+ 1');
  await expect(page.locator('[data-testid="out-count"]')).toHaveText('3', { timeout: 5_000 });

  await clickBtn(page, 'Reset');
  await expect(page.locator('[data-testid="out-count"]')).toHaveText('0', { timeout: 5_000 });
});

// ─── WF-14 — decrement min clamp ─────────────────────────────────────────────

test('WF-14: "- 1" when counter = 0 stays at 0 (min clamp)', async () => {
  const page = sharedPage;
  await resetPage(page);

  await clickBtn(page, '- 1');

  await expect(page.locator('[data-testid="out-count"]')).toHaveText('0', { timeout: 5_000 });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Card 5 — The Complete Pipeline (all structural types in one workflow)
//   branch (nested) · forEach · whileLoop · timeDelay · changeVariableValue
// ═══════════════════════════════════════════════════════════════════════════════

/** Score button labels for Card 5 */
const SCORE_LABELS: Record<string, string> = {
  'btn-score-20': 'Score = 20',
  'btn-score-45': 'Score = 45',
  'btn-score-75': 'Score = 75',
  'btn-score-95': 'Score = 95',
};

/** Set the score and run the full pipeline, then wait for completion */
async function runPipeline(page: Page, scoreTestId: string) {
  await clickBtn(page, SCORE_LABELS[scoreTestId]);
  // Wait for the score display to reflect the new number before triggering pipeline
  await page.waitForTimeout(300);
  await clickBtn(page, 'Run Full Pipeline');
  // Pipeline has a 300ms timeDelay + processing; give it 3s to complete
  await expect(page.locator('[data-testid="out-complex-done"]')).toHaveText(
    '✓ Pipeline complete!',
    { timeout: 5_000 }
  );
}

// ─── WF-15 — Card 5 initial state ────────────────────────────────────────────

test('WF-15: Card 5 shows initial state on page load', async () => {
  const page = sharedPage;
  await resetPage(page);

  await expect(page.locator('[data-testid="out-grade"]')).toHaveText('(not graded)');
  await expect(page.locator('[data-testid="out-loop-count"]')).toHaveText('0');
  await expect(page.locator('[data-testid="out-retry-count"]')).toHaveText('0');
  await expect(page.locator('[data-testid="out-complex-done"]')).toHaveText('(not run yet)');
});

// ─── WF-16 — score=20: full pipeline, FAIL branch ────────────────────────────

test('WF-16: score=20 → FAIL grade, forEach=3, whileLoop=3, pipeline complete', async () => {
  const page = sharedPage;
  await resetPage(page);

  await runPipeline(page, 'btn-score-20');

  await expect(page.locator('[data-testid="out-pipeline-number"]')).toHaveText('20', { timeout: 3_000 });
  await expect(page.locator('[data-testid="out-grade"]')).toHaveText('FAIL (< 30)', { timeout: 3_000 });
  await expect(page.locator('[data-testid="out-loop-count"]')).toHaveText('3', { timeout: 3_000 });
  await expect(page.locator('[data-testid="out-retry-count"]')).toHaveText('3', { timeout: 3_000 });
});

// ─── WF-17 — score=45: POOR branch ───────────────────────────────────────────

test('WF-17: score=45 → grade = "POOR (30 – 59)"', async () => {
  const page = sharedPage;
  await resetPage(page);

  await runPipeline(page, 'btn-score-45');

  await expect(page.locator('[data-testid="out-grade"]')).toHaveText('POOR (30 – 59)', { timeout: 3_000 });
});

// ─── WF-18 — score=75: GOOD branch ───────────────────────────────────────────

test('WF-18: score=75 → grade = "GOOD (60 – 89)"', async () => {
  const page = sharedPage;
  await resetPage(page);

  await runPipeline(page, 'btn-score-75');

  await expect(page.locator('[data-testid="out-grade"]')).toHaveText('GOOD (60 – 89)', { timeout: 3_000 });
});

// ─── WF-19 — score=95: EXCELLENT branch ──────────────────────────────────────

test('WF-19: score=95 → grade = "EXCELLENT (≥ 90)"', async () => {
  const page = sharedPage;
  await resetPage(page);

  await runPipeline(page, 'btn-score-95');

  await expect(page.locator('[data-testid="out-grade"]')).toHaveText('EXCELLENT (≥ 90)', { timeout: 3_000 });
});

// ─── WF-20 — timeDelay: final completion after intermediate state ─────────────

test('WF-20: pipeline transitions through "(running pipeline…)" and then completes', async () => {
  const page = sharedPage;
  await resetPage(page);

  // Set score and kick off run; use low-level clicks to minimize extra waits
  await page.getByRole('button', { name: 'Score = 75', exact: true }).click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Run Full Pipeline', exact: true }).click();

  // The pipeline sets "(running pipeline…)" synchronously (before the 300ms timeDelay),
  // so it should appear quickly after the click; React rAF batching may introduce ~16ms.
  await expect(page.locator('[data-testid="out-complex-done"]')).toHaveText(
    '(running pipeline…)',
    { timeout: 2_000 }
  );

  // After the 300ms delay the status transitions to complete
  await expect(page.locator('[data-testid="out-complex-done"]')).toHaveText(
    '✓ Pipeline complete!',
    { timeout: 5_000 }
  );
});

// ─── WF-21 — re-run resets and re-evaluates ──────────────────────────────────

test('WF-21: re-running with a different score resets counters and re-evaluates', async () => {
  const page = sharedPage;
  await resetPage(page);

  // First run: score=95 → EXCELLENT
  await runPipeline(page, 'btn-score-95');
  await expect(page.locator('[data-testid="out-grade"]')).toHaveText('EXCELLENT (≥ 90)', { timeout: 3_000 });
  await expect(page.locator('[data-testid="out-loop-count"]')).toHaveText('3', { timeout: 3_000 });
  await expect(page.locator('[data-testid="out-retry-count"]')).toHaveText('3', { timeout: 3_000 });

  // Second run: score=20 → FAIL (counters must reset to 0 then re-count to 3)
  await runPipeline(page, 'btn-score-20');
  await expect(page.locator('[data-testid="out-grade"]')).toHaveText('FAIL (< 30)', { timeout: 3_000 });
  await expect(page.locator('[data-testid="out-loop-count"]')).toHaveText('3', { timeout: 3_000 });
  await expect(page.locator('[data-testid="out-retry-count"]')).toHaveText('3', { timeout: 3_000 });
});
