/**
 * Builder — Checkbox & Switch live-watch tests (WeWeb-style variables['{id}'])
 *
 * CS-01  Checkbox registers variables['{id}'] = false on mount
 * CS-02  Clicking a Checkbox updates variables['{id}'] to true/false
 * CS-03  Text node with formula variables['{id}'] reflects Checkbox state in real time
 * CS-04  Switch registers variables['{id}'] = false on mount
 * CS-05  Toggling a Switch updates variables['{id}'] to true/false
 * CS-06  Text node with formula variables['{id}'] reflects Switch state in real time
 * CS-07  Checkbox inside FormContainer — variables['{id}'] still updates when toggled
 *
 * Run: npx playwright test e2e/builder-checkbox-switch.spec.ts --reporter=list
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

async function getVarStoreData(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const vs = (window as unknown as Record<string, { getState: () => { data: Record<string, unknown> } }>).__globalVariableStore;
    return vs?.getState().data ?? {};
  });
}

async function getNodeText(page: Page, nodeId: string): Promise<string> {
  const el = page.locator(`[data-builder-id="${nodeId}"]`).first();
  return (await el.textContent() ?? '').trim();
}

/**
 * Toggle a Checkbox or Switch via the React component's onChange/onValueChange prop.
 *
 * DOM interaction with Gluestack's compound Checkbox (React Aria-backed hidden input)
 * is unreliable from Playwright. Instead we walk the React fiber tree to find the node's
 * rendered component, pull out its onChange prop, and call it directly — this is the
 * same code path that fires when a real user interacts with the component.
 */
async function toggleControl(page: Page, nodeId: string) {
  await page.waitForSelector(`[data-builder-id="${nodeId}"]`, { timeout: 8_000 });

  const result = await page.evaluate((id: string): string => {
    const wrapper = document.querySelector(`[data-builder-id="${id}"]`);
    if (!wrapper) return `wrapper not found for ${id}`;

    // Walk UP the React fiber tree from the data-builder-id DOM node.
    // The SDUI renderer passes our wrapped `onChange`/`onValueChange` as a prop to the
    // Gluestack component. The DOM node carrying data-builder-id is Gluestack's inner
    // styled wrapper — we need to go up past host-component fibers (div/label/span) to
    // find the composite component fiber that holds our prop.
    const key = Object.keys(wrapper).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (!key) return 'no React fiber found';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fiber: any = (wrapper as any)[key];

    // Collect all onChange/onValueChange functions found while walking up
    // Skip the ones that appear to be native DOM event handlers (attached to host elements
    // like div/label/input — their props will have many HTML-specific attributes)
    while (fiber) {
      const p = fiber.memoizedProps as Record<string, unknown> | null;
      if (p) {
        const oc  = p['onChange']      as ((v: boolean) => void) | undefined;
        const ovc = p['onValueChange'] as ((v: boolean) => void) | undefined;

        // Skip if it's a host fiber (DOM element) — those have className, style, id, etc.
        // Our component-level props come from composite component fibers.
        const isHostFiber = typeof fiber.type === 'string';

        if (!isHostFiber) {
          if (typeof oc === 'function') {
            const cbInput = wrapper.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            const currentChecked = cbInput?.checked ?? false;
            oc(!currentChecked);
            return `checkbox onChange(${!currentChecked}) called via composite fiber`;
          }
          if (typeof ovc === 'function') {
            const currentOn = !!(p['value'] === true || p['isChecked'] === true);
            ovc(!currentOn);
            return `switch onValueChange(${!currentOn}) called via composite fiber`;
          }
        }
      }
      fiber = fiber.return;
    }

    return `no onChange/onValueChange found in fiber chain for ${id}`;
  }, nodeId);

  // eslint-disable-next-line no-console
  console.log(`[toggleControl] nodeId=${nodeId}: ${result}`);
  await page.waitForTimeout(600);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('CS — Checkbox & Switch (WeWeb-style variables) live-watch', () => {
  test.setTimeout(90_000);

  // ── Checkbox ────────────────────────────────────────────────────────────────

  test('CS-01: Checkbox registers variables["{id}"] = false on mount', async ({ page }) => {
    await gotoBuilder(page);

    const cbId = 'cs01-checkbox';
    await addNode(page, {
      type: 'Checkbox',
      id: cbId,
      props: { value: cbId, style: {} },
      children: [
        { type: 'CheckboxIndicator' },
        { type: 'CheckboxLabel', text: 'Accept terms' },
      ],
    });
    await page.waitForTimeout(1000);

    const data = await getVarStoreData(page);
    expect(data).toHaveProperty(cbId);
    expect(data[cbId]).toBe(false);
  });

  test('CS-02: clicking Checkbox updates variables["{id}"]', async ({ page }) => {
    await gotoBuilder(page);

    const cbId = 'cs02-checkbox';
    await addNode(page, {
      type: 'Checkbox',
      id: cbId,
      props: { value: cbId, style: {} },
      children: [
        { type: 'CheckboxIndicator' },
        { type: 'CheckboxLabel', text: 'Accept terms' },
      ],
    });
    await page.waitForTimeout(800);

    const before = await getVarStoreData(page);
    expect(before[cbId]).toBe(false);

    await toggleControl(page, cbId);

    const after = await getVarStoreData(page);
    expect(after[cbId]).toBe(true);
  });

  test('CS-03: Text formula variables["{id}"] reflects Checkbox state in real time', async ({ page }) => {
    await gotoBuilder(page);

    const cbId   = 'cs03-checkbox';
    const textId = 'cs03-text';

    await addNode(page, {
      type: 'Checkbox',
      id: cbId,
      props: { value: cbId, style: {} },
      children: [
        { type: 'CheckboxIndicator' },
        { type: 'CheckboxLabel', text: 'Subscribe' },
      ],
    });
    await addNode(page, {
      type: 'Text',
      id: textId,
      text: { formula: `variables['${cbId}']` },
      props: { className: 'text-sm', style: {} },
    });

    await page.waitForTimeout(800);

    // Initial: false → Text shows "false"
    expect(await getNodeText(page, textId)).toBe('false');

    await toggleControl(page, cbId);

    // After check: true → Text shows "true"
    expect(await getNodeText(page, textId)).toBe('true');

    const data = await getVarStoreData(page);
    expect(data[cbId]).toBe(true);
  });

  // ── Switch ──────────────────────────────────────────────────────────────────

  test('CS-04: Switch registers variables["{id}"] = false on mount', async ({ page }) => {
    await gotoBuilder(page);

    const swId = 'cs04-switch';
    await addNode(page, {
      type: 'Switch',
      id: swId,
      props: { style: {} },
    });
    await page.waitForTimeout(1000);

    const data = await getVarStoreData(page);
    expect(data).toHaveProperty(swId);
    expect(data[swId]).toBe(false);
  });

  test('CS-05: toggling Switch updates variables["{id}"]', async ({ page }) => {
    await gotoBuilder(page);

    const swId = 'cs05-switch';
    await addNode(page, {
      type: 'Switch',
      id: swId,
      props: { style: {} },
    });
    await page.waitForTimeout(800);

    const before = await getVarStoreData(page);
    expect(before[swId]).toBe(false);

    await toggleControl(page, swId);

    const after = await getVarStoreData(page);
    expect(after[swId]).toBe(true);
  });

  test('CS-06: Text formula variables["{id}"] reflects Switch state in real time', async ({ page }) => {
    await gotoBuilder(page);

    const swId   = 'cs06-switch';
    const textId = 'cs06-text';

    await addNode(page, {
      type: 'Switch',
      id: swId,
      props: { style: {} },
    });
    await addNode(page, {
      type: 'Text',
      id: textId,
      text: { formula: `variables['${swId}']` },
      props: { className: 'text-sm', style: {} },
    });

    await page.waitForTimeout(800);

    expect(await getNodeText(page, textId)).toBe('false');

    await toggleControl(page, swId);

    expect(await getNodeText(page, textId)).toBe('true');

    const data = await getVarStoreData(page);
    expect(data[swId]).toBe(true);
  });

  test('CS-07: Checkbox inside FormContainer — variables["{id}"] still updates when toggled', async ({ page }) => {
    await gotoBuilder(page);

    const formId = 'cs07-form';
    const cbId   = 'cs07-checkbox';
    const textId = 'cs07-text';

    await addNode(page, {
      type: 'FormContainer',
      id: formId,
      props: { style: {} },
      children: [{
        type: 'Checkbox',
        id: cbId,
        props: { value: cbId, name: 'acceptTerms', style: {} },
        children: [
          { type: 'CheckboxIndicator' },
          { type: 'CheckboxLabel', text: 'Accept' },
        ],
      }],
    });
    await addNode(page, {
      type: 'Text',
      id: textId,
      text: { formula: `variables['${cbId}']` },
      props: { className: 'text-sm', style: {} },
    });

    await page.waitForTimeout(1000);

    const before = await getVarStoreData(page);
    expect(before).toHaveProperty(cbId);
    expect(before[cbId]).toBe(false);
    expect(await getNodeText(page, textId)).toBe('false');

    await toggleControl(page, cbId);

    const after = await getVarStoreData(page);
    expect(after[cbId]).toBe(true);
    expect(await getNodeText(page, textId)).toBe('true');
  });
});
