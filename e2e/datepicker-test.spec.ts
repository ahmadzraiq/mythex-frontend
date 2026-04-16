import { test, expect, type Page } from '@playwright/test';

test.setTimeout(90_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/popover-test`;

async function gotoPage(page: Page) {
  await page.goto(URL);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(4000);
}

test.describe('DatePicker Showcase', () => {
  test('DP-01: Basic DatePicker grid renders 42 day cells', async ({ page }) => {
    await gotoPage(page);

    const section = page.getByText('1. Basic DatePicker');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible({ timeout: 10_000 });

    // Click trigger to open the popover
    const trigger = page.getByText('Pick a date').first();
    await trigger.click();
    await page.waitForTimeout(2000);

    // Verify month header
    await expect(page.getByText('April 2026').first()).toBeVisible();

    // Verify day numbers exist — check representative days
    const day15 = page.getByText('15', { exact: true }).first();
    await expect(day15).toBeVisible();

    const day28 = page.getByText('28', { exact: true }).first();
    await expect(day28).toBeVisible();

    // Verify grid variable has 42 items
    const gridLen = await page.evaluate(() => {
      const store = (window as any).__globalVariableStore;
      if (!store) return -1;
      const grid = store.getState().data?.['dp-test-0000-0000-0000-000000000004'];
      return Array.isArray(grid) ? grid.length : -2;
    });
    expect(gridLen).toBe(42);
  });

  test('DP-02: Month navigation works', async ({ page }) => {
    await gotoPage(page);

    const trigger = page.getByText('Pick a date').first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('April 2026').first()).toBeVisible();

    // Click next month icon
    const nextIcon = page.locator('img[alt="chevron-right"]').first();
    await nextIcon.click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('May 2026').first()).toBeVisible({ timeout: 5_000 });
  });

  test('DP-03: Day selection updates display', async ({ page }) => {
    await gotoPage(page);

    const trigger = page.getByText('Pick a date').first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    await page.waitForTimeout(2000);

    // Click day 15
    const day15 = page.getByText('15', { exact: true }).first();
    await day15.click();
    await page.waitForTimeout(1000);

    // Check the selected date variable
    const selectedDate = await page.evaluate(() => {
      const store = (window as any).__globalVariableStore;
      return store?.getState()?.data?.['dp-test-0000-0000-0000-000000000003'] ?? 'not found';
    });
    console.log('Selected date:', selectedDate);
    expect(selectedDate).toContain('2026-04-15');
  });

  test('DP-04: Static DatePicker renders without clicking', async ({ page }) => {
    await gotoPage(page);

    const section = page.getByText('6. Static (Inline) DatePicker');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);

    // The static picker should show day-of-week headers
    const suHeaders = page.getByText('Su', { exact: true });
    const count = await suHeaders.count();
    console.log('Su header count:', count);
    expect(count).toBeGreaterThanOrEqual(1);

    // Should show day cells without clicking — look for day 10 near the section
    const day10 = page.getByText('10', { exact: true });
    const d10Count = await day10.count();
    console.log('Day 10 occurrences:', d10Count);
    expect(d10Count).toBeGreaterThanOrEqual(1);
  });

  test('DP-05: TimePicker shows initial time', async ({ page }) => {
    await gotoPage(page);

    const section = page.getByText('3. TimePicker');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible({ timeout: 10_000 });

    // The trigger should show the initial time (10:30)
    await expect(page.getByText('10:30').first()).toBeVisible();
    await expect(page.getByText('Selected: 10:30')).toBeVisible();
  });
});
