/**
 * Builder — Custom Theme Colors E2E (TCC series)
 *
 * Verifies the user-defined theme colors feature: custom colors live alongside
 * the built-in System palette, drive `--<name>` and `--theme-<name>` CSS
 * variables on `document.documentElement`, surface as picker swatches, are
 * reachable through the `theme.colors[<name>]` formula path, and survive edit
 * + delete flows.
 *
 *  TCC-01  Theme tab exposes the "+ Add custom color" button under the Colors group
 *  TCC-02  Clicking + opens a right-side SlidePanel with the custom-color form
 *  TCC-03  Submitting a valid form pushes a CustomColor into the store and emits CSS vars
 *  TCC-04  The new color renders as a row under the Ungrouped group
 *  TCC-05  The new color appears as a swatch inside any FigmaColorPicker popover
 *  TCC-06  Editing a custom color's hex via the store re-applies the live CSS variables
 *  TCC-07  Reserved system color names disable the Save button
 *  TCC-08  Deleting a custom color removes its CSS variables and row
 *
 * Run: npx playwright test e2e/builder-custom-colors.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 },
  );
  await page.waitForTimeout(1500);
}

/** Switch to the right-panel Theme tab and expand the Colors section. */
async function openThemeColorsSection(page: Page) {
  await page.getByTestId('tab-theme').click();
  await page.waitForTimeout(200);

  if (!(await page.getByTestId('add-custom-color').isVisible().catch(() => false))) {
    // Colors header is the second collapsible section in the Theme panel.
    // The "+ Add" button is rendered as a sibling of the toggle, so once it's
    // visible we know the section is open.
    await page.getByRole('button', { name: /^Colors/ }).first().click();
  }
  await expect(page.getByTestId('add-custom-color')).toBeVisible({ timeout: 5_000 });
}

async function openAddColorSlide(page: Page) {
  await page.getByTestId('add-custom-color').click();
  await page.waitForSelector('[data-testid="color-name"]', { timeout: 5_000 });
}

async function closeRightSlide(page: Page) {
  // Scope the close button to the right slide so a left-side slide doesn't
  // confuse the locator.
  await page.getByTestId('right-slide-panel').getByTestId('slide-panel-close').click();
  await page.waitForSelector('[data-testid="color-name"]', { state: 'detached', timeout: 3_000 });
}

async function getRootCssVar(page: Page, varName: string): Promise<string> {
  return page.evaluate((v) => {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }, `--${varName}`);
}

interface StoredColor { id: string; name: string; light: string; dark: string }

async function findStoredColor(page: Page, name: string): Promise<StoredColor | null> {
  return page.evaluate((n) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>)
      .__builderStore?.getState();
    return ((store?.customColors ?? []) as StoredColor[]).find(c => c.name === n) ?? null;
  }, name);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('TCC — Custom theme colors', () => {
  // Tests share a single page and run sequentially; later tests assume earlier
  // ones already created the "brand" custom color. Disable retries so a
  // re-run never tries to re-add a color that's still in the store.
  test.describe.configure({ retries: 0, mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    await gotoBuilder(page);
    await openThemeColorsSection(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  // ── TCC-01 ───────────────────────────────────────────────────────────────────
  test('TCC-01 Theme tab exposes the + Add custom color button', async () => {
    await expect(page.getByTestId('add-custom-color')).toBeVisible();
  });

  // ── TCC-02 ───────────────────────────────────────────────────────────────────
  test('TCC-02 + button opens the custom-color slide form on the right', async () => {
    await openAddColorSlide(page);

    await expect(page.getByTestId('color-name')).toBeVisible();
    await expect(page.getByTestId('color-save')).toBeVisible();
    await expect(page.getByTestId('color-light')).toBeVisible();
    await expect(page.getByTestId('color-dark')).toBeVisible();

    // Slide panel docks on the right side
    const slidePanel = page.getByTestId('right-slide-panel');
    await expect(slidePanel).toBeVisible();
    expect(await slidePanel.getAttribute('data-slide-side')).toBe('right');

    await closeRightSlide(page);
  });

  // ── TCC-03 ───────────────────────────────────────────────────────────────────
  test('TCC-03 Saving a valid color seeds the store and CSS variables', async () => {
    await openAddColorSlide(page);

    await page.getByTestId('color-name').fill('brand');
    await page.waitForTimeout(100);
    await page.getByTestId('color-save').click();
    await page.waitForSelector('[data-testid="color-name"]', { state: 'detached', timeout: 5_000 });

    // The form's defaults are #7c3aed (light) and #a78bfa (dark); we patch the
    // hexes via the store mutator to keep this test independent of the
    // FigmaColorPicker's spectrum/HSV interaction.
    const stored = await findStoredColor(page, 'brand');
    expect(stored).not.toBeNull();
    expect(stored!.light).toBe('#7c3aed');
    expect(stored!.dark).toBe('#a78bfa');

    // CSS variables are written to documentElement: --brand (rgb triplet),
    // --theme-brand (raw hex). _applyLightOverrides also calls patchThemeColors
    // so theme.colors.brand resolves in formulas.
    expect(await getRootCssVar(page, 'brand')).toBe('124 58 237');
    expect(await getRootCssVar(page, 'theme-brand')).toBe('#7c3aed');
  });

  // ── TCC-04 ───────────────────────────────────────────────────────────────────
  test('TCC-04 New color renders as a row under the Ungrouped group', async () => {
    const ungroupedHeader = page.getByTestId('color-group-ungrouped');
    await expect(ungroupedHeader).toBeVisible({ timeout: 5_000 });

    // The row container exists immediately, but the inline edit/delete buttons
    // only render while the row is hovered. Hover first, then assert.
    const row = page.getByTestId('custom-color-row-brand');
    await expect(row).toBeVisible();
    await row.hover();
    await expect(page.getByTestId('custom-color-edit-brand')).toBeVisible();
    await expect(page.getByTestId('custom-color-delete-brand')).toBeVisible();
  });

  // ── TCC-05 ───────────────────────────────────────────────────────────────────
  test('TCC-05 Custom color appears as a swatch inside FigmaColorPicker popovers', async () => {
    // Re-open the add-color slide so we have a known FigmaColorPicker with a
    // stable test id (the slide form's "Light value" picker).
    await openAddColorSlide(page);

    // Click the picker swatch trigger to open its popover
    await page.getByTestId('color-light-swatch').click();
    await page.waitForTimeout(300);

    // The popover renders a "Custom Colors" group containing each user color
    // as `swatch-<name>`. Brand should appear there.
    const brandSwatch = page.getByTestId('swatch-brand');
    await expect(brandSwatch).toBeVisible({ timeout: 5_000 });

    // Close popover (click outside) and the slide
    await page.mouse.click(20, 20);
    await page.waitForTimeout(150);
    await closeRightSlide(page);
  });

  // ── TCC-06 ───────────────────────────────────────────────────────────────────
  test('TCC-06 Editing a custom color updates the live CSS variables', async () => {
    await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>)
        .__builderStore?.getState();
      const list = (store?.customColors ?? []) as Array<{ id: string; name: string }>;
      const brand = list.find(c => c.name === 'brand');
      const update = store?.updateCustomColor as (id: string, p: Record<string, string>) => void;
      if (brand) update(brand.id, { light: '#ff0000' });
    });
    await page.waitForTimeout(200);

    expect(await getRootCssVar(page, 'theme-brand')).toBe('#ff0000');
    expect(await getRootCssVar(page, 'brand')).toBe('255 0 0');
  });

  // ── TCC-07 ───────────────────────────────────────────────────────────────────
  test('TCC-07 Reserved system color names disable the Save button', async () => {
    await openAddColorSlide(page);

    await page.getByTestId('color-name').fill('primary');
    await page.getByTestId('color-name').blur();
    await page.waitForTimeout(150);

    await expect(page.getByTestId('color-save')).toBeDisabled();
    await closeRightSlide(page);
  });

  // ── TCC-08 ───────────────────────────────────────────────────────────────────
  test('TCC-08 Deleting a custom color removes its CSS variables and row', async () => {
    // The delete button uses window.confirm — auto-accept it.
    page.on('dialog', d => { void d.accept(); });

    // Hover the row first so the inline edit/delete buttons render visible.
    await page.getByTestId('custom-color-row-brand').hover();
    await page.waitForTimeout(150);
    await page.getByTestId('custom-color-delete-brand').click();
    await page.waitForTimeout(300);

    const stillExists = await findStoredColor(page, 'brand');
    expect(stillExists).toBeNull();

    expect(await getRootCssVar(page, 'theme-brand')).toBe('');
    expect(await getRootCssVar(page, 'brand')).toBe('');

    await expect(page.getByTestId('custom-color-edit-brand')).toHaveCount(0);
  });
});
