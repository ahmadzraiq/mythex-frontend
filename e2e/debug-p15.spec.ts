import { test } from '@playwright/test';
test.setTimeout(60_000);
test('debug p15', async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('http://localhost:3001/animation-test');
  await page.waitForSelector('[data-testid="anim-ready"]', { timeout: 30_000 });
  await page.waitForTimeout(2000);
  const el = page.locator('[data-testid="p15-underline"]').first();
  await el.scrollIntoViewIfNeeded();
  const debug = await el.evaluate((n) => {
    const parent = (n as HTMLElement).parentElement;
    const gp = parent?.parentElement;
    const ggp = gp?.parentElement;
    return {
      parentTag: parent?.tagName,
      parentAttrs: Array.from(parent?.attributes ?? []).map((a: Attr) => a.name + '=' + a.value),
      gpTag: gp?.tagName,
      gpAttrs: Array.from(gp?.attributes ?? []).map((a: Attr) => a.name + '=' + a.value),
      ggpTag: ggp?.tagName,
      ggpAttrs: Array.from(ggp?.attributes ?? []).map((a: Attr) => a.name + '=' + a.value),
    };
  });
  console.log('DEBUG P15:', JSON.stringify(debug, null, 2));
  await page.close();
});
