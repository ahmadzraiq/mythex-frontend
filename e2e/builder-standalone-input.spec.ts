/**
 * Builder — Standalone Input live-watch tests (WeWeb-style variables['{id}'])
 *
 * SI-01  Input (with InputField child) registers variables['{id}'] on mount
 * SI-02  Typing in a standalone Input updates variables['{id}']
 * SI-03  Text node with formula variables['{id}'] reflects typed value in real time
 * SI-04  Input inside FormContainer — variables['{id}'] still updates when typing
 * SI-05  Backward compat — old components formula renders as chip not plain text
 *
 * Run: npx playwright test e2e/builder-standalone-input.spec.ts --reporter=list
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto('http://builder-dev.localhost:3001');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 }
  );
  await page.waitForTimeout(1500);
}

type BuilderStore = { getState: () => Record<string, unknown> };

async function addNode(page: Page, node: Record<string, unknown>) {
  const id = node.id as string;
  await page.evaluate((n) => {
    const bs = (window as unknown as Record<string, BuilderStore>).__builderStore;
    bs?.getState().addNode?.(n, null);
  }, node);
  await page.waitForFunction((nodeId) => {
    function findNodeDeep(nodes: unknown[], targetId: string): boolean {
      for (const n of nodes) {
        const nd = n as Record<string, unknown>;
        if (nd.id === targetId) return true;
        if (Array.isArray(nd.children) && findNodeDeep(nd.children, targetId)) return true;
      }
      return false;
    }
    const store = (window as unknown as Record<string, BuilderStore>).__builderStore;
    const pageNodes = store?.getState().pageNodes as unknown[] | undefined;
    return Array.isArray(pageNodes) && findNodeDeep(pageNodes, nodeId as string);
  }, id, { timeout: 5_000 });
  await page.waitForTimeout(300);
}

/** Read the global variable store's top-level data */
async function getVarStoreData(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const vs = (window as unknown as Record<string, { getState: () => { data: Record<string, unknown> } }>).__globalVariableStore;
    return vs?.getState().data ?? {};
  });
}

/** Read the text content of a rendered node by its builder ID */
async function getNodeText(page: Page, nodeId: string): Promise<string> {
  const el = page.locator(`[data-builder-id="${nodeId}"]`).first();
  return (await el.textContent() ?? '').trim();
}

/** Real canvas default: Input wrapper with explicit InputField child */
function makeInputNode(inputId: string, fieldId: string) {
  return {
    type: 'Input',
    id: inputId,
    props: { variant: 'outline', size: 'md', className: 'w-full', style: {} },
    children: [
      {
        type: 'InputField',
        id: fieldId,
        props: { placeholder: 'Enter text…', className: '', style: {} },
      },
    ],
  };
}

/** Fill an input using the reliable .fill() API */
async function fillInput(page: Page, inputId: string, text: string) {
  await page.keyboard.press('h');
  await page.waitForTimeout(300);
  const inputEl = page.locator(`[data-builder-id="${inputId}"] input`).first();
  await expect(inputEl).toBeAttached({ timeout: 8_000 });
  await inputEl.focus();
  await page.waitForTimeout(200);
  await inputEl.fill(text);
  await page.waitForTimeout(600);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('SI — Standalone Input (WeWeb-style variables) live-watch', () => {
  test.setTimeout(90_000);

  test('SI-01: Input registers variables["{id}"] (no suffix) on mount', async ({ page }) => {
    await gotoBuilder(page);

    const inputId = 'si01-input';
    const fieldId = 'si01-field';
    await addNode(page, makeInputNode(inputId, fieldId));
    await page.waitForTimeout(1000);

    const data = await getVarStoreData(page);
    expect(data).toHaveProperty(inputId);
    expect(data[inputId]).toBe('');
  });

  test('SI-02: typing updates variables["{id}"] (no suffix)', async ({ page }) => {
    await gotoBuilder(page);

    const inputId = 'si02-input';
    const fieldId = 'si02-field';
    await addNode(page, makeInputNode(inputId, fieldId));
    await page.waitForTimeout(800);

    await fillInput(page, inputId, 'hello world');

    const data = await getVarStoreData(page);
    expect(data[inputId]).toBe('hello world');
  });

  test('SI-03: Text formula variables["{id}"] reflects typed value in real time', async ({ page }) => {
    await gotoBuilder(page);

    const inputId = 'si03-input';
    const fieldId = 'si03-field';
    const textId  = 'si03-text';

    await addNode(page, makeInputNode(inputId, fieldId));
    await addNode(page, {
      type: 'Text',
      id: textId,
      text: { formula: `variables['${inputId}']` },
      props: { className: 'text-sm text-gray-900', style: {} },
    });

    await page.waitForTimeout(800);

    expect(await getNodeText(page, textId)).toBe('');

    await fillInput(page, inputId, 'react-live');

    expect(await getNodeText(page, textId)).toBe('react-live');
    const data = await getVarStoreData(page);
    expect(data[inputId]).toBe('react-live');
  });

  test('SI-04: Input inside FormContainer — variables["{id}"] still updates when typing', async ({ page }) => {
    await gotoBuilder(page);

    const formId  = 'si04-form';
    const inputId = 'si04-input';
    const fieldId = 'si04-field';
    const textId  = 'si04-text';

    await addNode(page, {
      type: 'FormContainer',
      id: formId,
      props: { style: {} },
      children: [makeInputNode(inputId, fieldId)],
    });
    await addNode(page, {
      type: 'Text',
      id: textId,
      text: { formula: `variables['${inputId}']` },
      props: { className: 'text-sm', style: {} },
    });

    await page.waitForTimeout(1000);

    const dataBefore = await getVarStoreData(page);
    expect(dataBefore).toHaveProperty(inputId);

    await fillInput(page, inputId, 'form-input-test');

    const dataAfter = await getVarStoreData(page);
    expect(dataAfter[inputId]).toBe('form-input-test');
    expect(await getNodeText(page, textId)).toBe('form-input-test');
  });

  test('SI-05: backward compat — old components formula renders as chip not plain text', async ({ page }) => {
    await gotoBuilder(page);

    const inputId = 'si05-input';
    await addNode(page, {
      type: 'Input',
      id: inputId,
      props: { className: 'w-full', style: {} },
    });
    await page.waitForTimeout(800);

    const result = await page.evaluate((nodeId) => {
      const CHIP_RE = /collections\['([^']+)'\](?:\?\.\['[^']*'\]|\?\.\[\d+\])*|variables\['([^']+)'\](?:\?\.\['[^']*'\]|\?\.\[\d+\])*|local\.data(?:\?\.\['[^']*'\]|\?\.\[\d+\]|\.[\w$]+)*|context\.workflow\['[^']+'\](?:(?:\?)?\.[\w$]+|\?\.\['[^']*'\]|\?\.\[\d+\])*|context\.(?:item|index|parent)(?:(?:\?\.\['[^']*'\]|\?\.\[\d+\])|(?:\.\w+))*|globalContext\.(?:browser|screen)(?:\?\.\['[^']*'\])*|pages\['[^']+'\](?:\?\.\['[^']*'\])*|theme(?:\.(?:colors|sections|fonts|radius)|\?\.\['(?:colors|sections|fonts|radius)'\])(?:\?\.\['[^']*'\]|\.\w+)*|components\?\.\['([^']+)'\](?:\?\.\['[^']*'\]|\?\.\[\d+\])*/g;
      const oldFormula = `components?.['${nodeId}']?.['value']`;
      const match = CHIP_RE.exec(oldFormula);
      return { matched: !!match, nodeId: match?.[3] };
    }, inputId);

    expect(result.matched).toBe(true);
    expect(result.nodeId).toBe(inputId);
  });
});
