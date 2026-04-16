import { test, expect } from '@playwright/test';

test.setTimeout(60_000);

test('diag: check variable store after click', async ({ page }) => {
  const consoleLogs: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    consoleLogs.push(msg.text());
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  
  await page.goto('http://preview-dev.localhost:3001/shared-component-test');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForSelector('h2', { timeout: 20_000 });
  
  // Check variable store BEFORE click
  const before = await page.evaluate(() => {
    const store = (window as any).__globalVariableStore;
    if (!store) return 'NO STORE';
    const state = store.getState().getFullState();
    return JSON.stringify({
      modal: state['sct-modal-0000-0000-0000-000000000001'],
      keys: Object.keys(state).filter(k => k.startsWith('sct-'))
    });
  });
  console.log('BEFORE CLICK:', before);
  
  // Intercept action calls by patching window
  await page.evaluate(() => {
    const orig = (window as any).__globalVariableStore?.getState().setState;
    if (orig) {
      (window as any).__globalVariableStore.getState().setState = function(updater: any) {
        console.log('[TEST] setState called', typeof updater);
        return orig.call(this, updater);
      };
    }
  });

  // Click the button
  await page.getByRole('button', { name: 'Show Modal' }).click();
  
  // Wait a bit for RAF
  await page.waitForTimeout(100);
  
  // Check variable store AFTER click
  const after = await page.evaluate(() => {
    const store = (window as any).__globalVariableStore;
    if (!store) return 'NO STORE';
    const state = store.getState().getFullState();
    return JSON.stringify({
      modal: state['sct-modal-0000-0000-0000-000000000001'],
      keys: Object.keys(state).filter(k => k.startsWith('sct-'))
    });
  });
  console.log('AFTER CLICK:', after);
  
  // Check if DOM changed
  const hasModal = await page.isVisible('text=Visibility Modal');
  console.log('MODAL VISIBLE:', hasModal);
  
  console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors.slice(0, 5)));
  console.log('ALL CONSOLE LOGS (last 10):', JSON.stringify(consoleLogs.slice(-10)));
  expect(after).toContain('"modal":true');
});
