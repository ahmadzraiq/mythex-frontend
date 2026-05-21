/**
 * Text size diagnostic: compare computed font-size between builder preview and exported app.
 */
import { test } from '@playwright/test';

test('Compare text-sm computed size: builder vs exported', async ({ page }) => {
  // ── 1. Builder preview ──────────────────────────────────────────────────────
  await page.goto('http://localhost:3001/dev/builder');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const builderMetrics = await page.evaluate(() => {
    const el = document.querySelector('.font-mono');
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      className: (el as HTMLElement).className,
      tagName: el.tagName,
      htmlFontSize: window.getComputedStyle(document.documentElement).fontSize,
      bodyFontSize: window.getComputedStyle(document.body).fontSize,
    };
  });
  console.log('[BUILDER] font-mono element:', JSON.stringify(builderMetrics, null, 2));

  // ── 2. Exported app ─────────────────────────────────────────────────────────
  await page.goto('http://localhost:3004/workflow-call-test');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const exportedMetrics = await page.evaluate(() => {
    const el = document.querySelector('.font-mono');
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      className: (el as HTMLElement).className,
      tagName: el.tagName,
      htmlFontSize: window.getComputedStyle(document.documentElement).fontSize,
      bodyFontSize: window.getComputedStyle(document.body).fontSize,
    };
  });
  console.log('[EXPORTED] font-mono element:', JSON.stringify(exportedMetrics, null, 2));

  // ── 3. Diff summary ─────────────────────────────────────────────────────────
  console.log('\n── DIFF ──');
  if (builderMetrics && exportedMetrics) {
    console.log('fontSize:      builder=%s  exported=%s  MATCH=%s',
      builderMetrics.fontSize, exportedMetrics.fontSize,
      builderMetrics.fontSize === exportedMetrics.fontSize ? '✓' : '✗');
    console.log('lineHeight:    builder=%s  exported=%s  MATCH=%s',
      builderMetrics.lineHeight, exportedMetrics.lineHeight,
      builderMetrics.lineHeight === exportedMetrics.lineHeight ? '✓' : '✗');
    console.log('htmlFontSize:  builder=%s  exported=%s  MATCH=%s',
      builderMetrics.htmlFontSize, exportedMetrics.htmlFontSize,
      builderMetrics.htmlFontSize === exportedMetrics.htmlFontSize ? '✓' : '✗');
    console.log('bodyFontSize:  builder=%s  exported=%s  MATCH=%s',
      builderMetrics.bodyFontSize, exportedMetrics.bodyFontSize,
      builderMetrics.bodyFontSize === exportedMetrics.bodyFontSize ? '✓' : '✗');
    console.log('letterSpacing: builder=%s  exported=%s  MATCH=%s',
      builderMetrics.letterSpacing, exportedMetrics.letterSpacing,
      builderMetrics.letterSpacing === exportedMetrics.letterSpacing ? '✓' : '✗');
  }
});
