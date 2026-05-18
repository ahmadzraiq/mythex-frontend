import { chromium } from 'playwright';

const BASE = 'http://localhost:4331';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().substring(0, 100));
  });
  
  await page.goto(`${BASE}/sc-component-showcase`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  
  // Check 1: Pagination numbers showing
  const paginationNumbers = await page.locator('text=1').count();
  const hasPage2 = await page.locator('text=2').count() > 0;
  const hasPage3 = await page.locator('text=3').count() > 0;
  console.log('Has pagination numbers:', paginationNumbers > 0 && hasPage2 && hasPage3);
  
  // Check 2: Tabs show text
  const tabsText = await page.locator('text=Overview').first().textContent().catch(() => null);
  console.log('Tabs show Overview:', tabsText);
  
  // Check 3: Stepper shows
  const stepperText = await page.locator('text=Account').first().textContent().catch(() => null);
  console.log('Stepper shows Account:', stepperText);
  
  // Check 4: Click tabs and check if state updates
  const tabsSection = page.locator('text=Details').first();
  if (await tabsSection.count() > 0) {
    await tabsSection.click();
    await page.waitForTimeout(500);
    console.log('Tabs click succeeded (no crash)');
  }
  
  // Check 5: Pagination click
  const page2Btn = page.locator('text=2').first();
  if (await page2Btn.count() > 0) {
    await page2Btn.click();
    await page.waitForTimeout(500);
    console.log('Pagination click succeeded (no crash)');
  }
  
  // Check 6: Select dropdown - should be closed by default
  const openPopovers = await page.evaluate(() => {
    // Check if any popover content is visible (expanded)
    const contents = document.querySelectorAll('[data-radix-popper-content-wrapper]');
    return contents.length;
  });
  console.log('Open popovers (should be 0 initially):', openPopovers);
  
  // Check 7: No undefined text
  const undefinedText = await page.locator('text=/^undefined$/').count();
  console.log('Undefined text nodes:', undefinedText);
  
  console.log('\n=== Errors ===');
  console.log('Page errors:', errors.length === 0 ? 'NONE' : errors.slice(0, 3));
  console.log('Console errors:', consoleErrors.length === 0 ? 'NONE' : consoleErrors.slice(0, 3));
  
  await browser.close();
})();
