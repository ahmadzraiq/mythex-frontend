import { test } from '@playwright/test';

test('debug binding icons', async ({ page }) => {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000 }
  );
  await page.waitForTimeout(2000);
  
  // Add node
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    if (!store) { console.log('NO STORE'); return; }
    const addNode = store.addNode as (node: unknown, parentId: null) => void;
    addNode({ type: 'Box', id: 'fe-box', props: { className: 'flex', style: {} } }, null);
    (store.select as (id: string | null) => void)('fe-box');
    console.log('selectedIds after:', JSON.stringify(store.selectedIds));
  });
  await page.waitForTimeout(1000);
  
  // Check what design tab shows
  const tabRightDesign = await page.locator('[data-testid="tab-right-design"]').isVisible();
  console.log('tab-right-design visible:', tabRightDesign);
  
  await page.click('[data-testid="tab-right-design"]');
  await page.waitForTimeout(500);
  
  const panelRight = page.locator('[data-testid="panel-right"]');
  const innerHTML = await panelRight.innerHTML();
  
  const bindingIconCount = await page.locator('[data-testid="binding-icon"]').count();
  console.log('binding icons count:', bindingIconCount);
  console.log('panel-right has "Select a node":', innerHTML.includes('Select a node'));
  console.log('panel-right has "binding-icon":', innerHTML.includes('binding-icon'));
  
  await page.screenshot({ path: '/tmp/debug-screenshot.png' });
});
