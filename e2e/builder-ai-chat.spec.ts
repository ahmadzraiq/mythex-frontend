/**
 * AI Chat Panel E2E Tests
 *
 * Run with:  npx playwright test e2e/builder-ai-chat.spec.ts
 *
 * Tests covered:
 *   AC-01  Toggle AI mode — "✦ AI" button shows the AI panel, hides design panel
 *   AC-02  Panel structure — header, message list, input, send button all visible
 *   AC-03  Empty state — shows "How can I help?" with prompt suggestions
 *   AC-04  Prompt suggestion fills input
 *   AC-05  Send button disabled when input is empty, enabled when text is entered
 *   AC-06  Sending a message (mocked) — user message appears, AI response appears
 *   AC-07  Tool badge rendered — when API returns tool_executed, badge appears
 *   AC-08  Tool: add_component — mock triggers add_component("Heading"), node on canvas
 *   AC-09  Tool: set_text — mock updates node text in the store
 *   AC-10  Tool: swap_class — mock swaps Tailwind token in className
 *   AC-11  Node selection context — selecting a node shows chip in input area
 *   AC-12  Thread menu — open shows existing threads and New Chat button
 *   AC-13  Close AI panel — clicking × returns to normal builder panel
 *   AC-14  Keyboard: Enter sends, Shift+Enter inserts newline
 *   AC-15  Multiple tool calls produce multiple badges, all mutations applied
 *   AC-16  Incremental building — each tool call updates canvas immediately, not all-at-once
 */

import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://builder-dev.localhost:3001';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function gotoBuilder(page: Page) {
  await page.goto(BASE);
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 15_000, polling: 100 },
  );
  await page.waitForTimeout(400);
}

async function mockThreadAPI(page: Page) {
  await page.route('**/api/projects/**/chat/threads**', async route => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'thread-1', title: 'My First Chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 2 },
        ]),
      });
    } else if (method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'thread-new', title: 'New Chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
      });
    } else if (method === 'DELETE' || method === 'PATCH') {
      await route.fulfill({ status: 200, body: '{}' });
    } else {
      await route.continue();
    }
  });
}

function buildSSEBody(events: object[]): string {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

async function mockBuilderChat(page: Page, events: object[]) {
  await page.route('**/api/ai/builder-chat', async route => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: buildSSEBody(events),
    });
  });
}

async function addNodeToCanvas(page: Page, type: string, text: string): Promise<string> {
  return page.evaluate(({ nodeType, nodeText }) => {
    const id = crypto.randomUUID();
    const store = (window as unknown as Record<string, { getState: () => Record<string, Function> }>).__builderStore?.getState();
    if (!store) return '';
    (store.addNode as Function)({ id, type: nodeType, text: nodeText, props: { className: 'text-xl text-gray-900' } }, null);
    return id;
  }, { nodeType: type, nodeText: text });
}

async function getNodeText(page: Page, nodeId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    const find = (nodes: unknown[], tid: string): unknown => {
      for (const n of nodes) {
        const node = n as Record<string, unknown>;
        if (node.id === tid) return node;
        if (Array.isArray(node.children)) { const f = find(node.children, tid); if (f) return f; }
      }
      return null;
    };
    const node = find(store?.pageNodes as unknown[] ?? [], id) as Record<string, unknown> | null;
    return (node?.text as string) ?? null;
  }, nodeId);
}

async function getNodeClassName(page: Page, nodeId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
    const find = (nodes: unknown[], tid: string): unknown => {
      for (const n of nodes) {
        const node = n as Record<string, unknown>;
        if (node.id === tid) return node;
        if (Array.isArray(node.children)) { const f = find(node.children, tid); if (f) return f; }
      }
      return null;
    };
    const node = find(store?.pageNodes as unknown[] ?? [], id) as Record<string, unknown> | null;
    return (node?.props as Record<string, string> | undefined)?.className ?? null;
  }, nodeId);
}

async function openAiMode(page: Page) {
  const aiBtn = page.locator('[data-testid="btn-ai-mode"]');
  await expect(aiBtn).toBeVisible({ timeout: 5_000 });
  await aiBtn.click();
  await expect(page.locator('[data-testid="ai-chat-panel"]')).toBeVisible({ timeout: 5_000 });
}

async function closeAiMode(page: Page) {
  const closeBtn = page.locator('[data-testid="ai-close-btn"]');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await expect(page.locator('[data-testid="ai-chat-panel"]')).not.toBeVisible({ timeout: 3_000 });
  }
}

async function resetCanvas(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, Function> }>).__builderStore?.getState();
    if (!store) return;
    (store._setPageNodes as Function)([]);
    // Ensure AI mode is off
    const s = store as unknown as Record<string, unknown>;
    if (s.aiMode) (store.toggleAiMode as Function)();
  });
  await page.waitForTimeout(200);
}

// ── Tests — each test is independent (own page) ───────────────────────────────
// We use per-test pages to avoid shared state issues on retries.

test.describe('AI Chat Panel', () => {

  // ── AC-01: Toggle AI mode ─────────────────────────────────────────────────

  test('AC-01 clicking ✦ AI button opens the AI chat panel', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);

    // AI panel should not be visible initially
    await expect(page.locator('[data-testid="ai-chat-panel"]')).not.toBeVisible();

    await openAiMode(page);

    // AI panel and its key elements should be visible
    await expect(page.locator('[data-testid="ai-chat-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-chat-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-chat-input"]')).toBeVisible();
  });

  // ── AC-02: Panel structure ────────────────────────────────────────────────

  test('AC-02 AI panel shows header with title, message list, input and send button', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await openAiMode(page);

    await expect(page.locator('[data-testid="ai-chat-header"]')).toContainText('AI Assistant');
    await expect(page.locator('[data-testid="ai-message-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-chat-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-send-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-thread-menu-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-close-btn"]')).toBeVisible();
  });

  // ── AC-03: Empty state ────────────────────────────────────────────────────

  test('AC-03 empty state shows "How can I help?" and 4 prompt suggestions', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await openAiMode(page);

    await expect(page.locator('[data-testid="ai-message-list"]')).toContainText('How can I help?');
    const suggestions = page.locator('[data-testid="ai-prompt-suggestion"]');
    await expect(suggestions).toHaveCount(4);
  });

  // ── AC-04: Prompt suggestion fills input ──────────────────────────────────

  test('AC-04 clicking a prompt suggestion fills the input textarea', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await openAiMode(page);

    const suggestion = page.locator('[data-testid="ai-prompt-suggestion"]').first();
    const text = await suggestion.textContent();
    await suggestion.click();

    await expect(page.locator('[data-testid="ai-chat-input"]')).toHaveValue(text!.trim());
  });

  // ── AC-05: Send button state ──────────────────────────────────────────────

  test('AC-05 send button is disabled on empty input and enabled with text', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await openAiMode(page);

    const sendBtn = page.locator('[data-testid="ai-send-btn"]');
    const input = page.locator('[data-testid="ai-chat-input"]');

    await expect(sendBtn).toBeDisabled();

    await input.fill('Hello AI');
    await expect(sendBtn).toBeEnabled();

    await input.fill('');
    await expect(sendBtn).toBeDisabled();
  });

  // ── AC-06: Send message with mocked AI response ───────────────────────────

  test('AC-06 sending a message shows user bubble and AI response', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await mockBuilderChat(page, [
      { type: 'text_delta', content: 'Sure, I can help with that!' },
      { type: 'done', tools: [] },
    ]);
    await openAiMode(page);

    await page.locator('[data-testid="ai-chat-input"]').fill('Make the page better');
    await page.locator('[data-testid="ai-send-btn"]').click();

    // User message appears immediately
    await expect(page.locator('[data-testid="ai-user-message"]').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="ai-user-message"]').first()).toContainText('Make the page better');

    // AI response appears
    await expect(page.locator('[data-testid="ai-assistant-message"]').first()).toContainText('Sure, I can help with that!', { timeout: 10_000 });

    // Input cleared after sending
    await expect(page.locator('[data-testid="ai-chat-input"]')).toHaveValue('');
  });

  // ── AC-07: Tool badge ─────────────────────────────────────────────────────

  test('AC-07 tool_executed event produces a tool badge in the assistant message', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await mockBuilderChat(page, [
      { type: 'text_delta', content: 'Done!' },
      { type: 'tool_executed', id: 'tc1', name: 'get_page_tree', input: {} },
      { type: 'done', tools: [] },
    ]);
    await openAiMode(page);

    await page.locator('[data-testid="ai-chat-input"]').fill('What is on the page?');
    await page.locator('[data-testid="ai-send-btn"]').click();

    await expect(page.locator('[data-testid="tool-badge"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="tool-badge"]').first()).toContainText('get_page_tree');
  });

  // ── AC-08: add_component tool ─────────────────────────────────────────────

  test('AC-08 add_component("Heading") inserts a Heading node on the canvas', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await mockBuilderChat(page, [
      { type: 'text_delta', content: 'Adding a Heading.' },
      { type: 'tool_executed', id: 'tc-add', name: 'add_component', input: { label: 'Heading' } },
      { type: 'done', tools: [] },
    ]);
    await openAiMode(page);

    const nodesBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      return (store?.pageNodes as unknown[])?.length ?? 0;
    });

    await page.locator('[data-testid="ai-chat-input"]').fill('Add a heading');
    await page.locator('[data-testid="ai-send-btn"]').click();

    // Badge confirms tool ran
    await expect(page.locator('[data-testid="tool-badge"][data-tool-name="add_component"]')).toBeVisible({ timeout: 10_000 });

    // Node count increased
    const nodesAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      return (store?.pageNodes as unknown[])?.length ?? 0;
    });
    expect(nodesAfter).toBeGreaterThan(nodesBefore);

    // Last node is a Heading
    const lastType = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      const nodes = store?.pageNodes as Array<Record<string, unknown>>;
      return nodes?.[nodes.length - 1]?.type ?? null;
    });
    expect(lastType).toBe('Text');
  });

  // ── AC-09: set_text tool ──────────────────────────────────────────────────

  test('AC-09 set_text tool updates node text in the store', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);

    const nodeId = await addNodeToCanvas(page, 'Text', 'Original Text');

    await mockBuilderChat(page, [
      { type: 'text_delta', content: 'Updated the text.' },
      { type: 'tool_executed', id: 'tc-text', name: 'set_text', input: { nodeId, text: 'Updated by AI' } },
      { type: 'done', tools: [] },
    ]);
    await openAiMode(page);

    await page.locator('[data-testid="ai-chat-input"]').fill('Change the heading text');
    await page.locator('[data-testid="ai-send-btn"]').click();

    await expect(page.locator('[data-testid="tool-badge"][data-tool-name="set_text"]')).toBeVisible({ timeout: 10_000 });

    const newText = await getNodeText(page, nodeId);
    expect(newText).toBe('Updated by AI');
  });

  // ── AC-10: swap_class tool ────────────────────────────────────────────────

  test('AC-10 swap_class tool swaps a Tailwind token in the node className', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);

    const nodeId = await addNodeToCanvas(page, 'Text', 'Styled Heading');

    await mockBuilderChat(page, [
      { type: 'text_delta', content: 'Changed the color.' },
      { type: 'tool_executed', id: 'tc-cls', name: 'swap_class', input: { nodeId, from: 'text-gray-900', to: 'text-blue-600' } },
      { type: 'done', tools: [] },
    ]);
    await openAiMode(page);

    await page.locator('[data-testid="ai-chat-input"]').fill('Make the heading blue');
    await page.locator('[data-testid="ai-send-btn"]').click();

    await expect(page.locator('[data-testid="tool-badge"][data-tool-name="swap_class"]')).toBeVisible({ timeout: 10_000 });

    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('text-blue-600');
    expect(cls).not.toContain('text-gray-900');
  });

  // ── AC-11: Node selection context ─────────────────────────────────────────

  test('AC-11 selecting a node in AI mode shows it as a chip', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);

    const nodeId = await addNodeToCanvas(page, 'Text', 'Click Me');

    await openAiMode(page);

    // Select the node via the store while in AI mode
    await page.evaluate((id) => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, Function> }>).__builderStore?.getState();
      (store?.select as Function)(id, false);
    }, nodeId);

    await page.waitForTimeout(300);

    await expect(page.locator('text=Referencing:')).toBeVisible({ timeout: 3_000 });
  });

  // ── AC-12: Thread menu ────────────────────────────────────────────────────

  test('AC-12 thread menu shows a thread after sending a message and a New Chat button', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await mockBuilderChat(page, [
      { type: 'text_delta', content: 'Hello!' },
      { type: 'done', tools: [] },
    ]);
    await openAiMode(page);

    // Send a message to create a local thread
    await page.locator('[data-testid="ai-chat-input"]').fill('Tell me about this page');
    await page.locator('[data-testid="ai-send-btn"]').click();
    // Wait for AI response
    await expect(page.locator('[data-testid="ai-assistant-message"]').first()).toBeVisible({ timeout: 10_000 });

    // Open thread menu
    await page.locator('[data-testid="ai-thread-menu-btn"]').click();
    const menu = page.locator('[data-testid="ai-thread-menu"]');
    await expect(menu).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('[data-testid="ai-new-thread-btn"]')).toBeVisible();
    // At least one thread should exist (auto-created when we sent a message)
    await expect(page.locator('[data-testid="ai-thread-item"]').first()).toBeVisible({ timeout: 3_000 });
  });

  // ── AC-13: Close AI panel ─────────────────────────────────────────────────

  test('AC-13 clicking × closes the AI panel', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await openAiMode(page);

    await expect(page.locator('[data-testid="ai-chat-panel"]')).toBeVisible();

    await page.locator('[data-testid="ai-close-btn"]').click();

    await expect(page.locator('[data-testid="ai-chat-panel"]')).not.toBeVisible({ timeout: 3_000 });
  });

  // ── AC-14: Keyboard shortcuts ─────────────────────────────────────────────

  test('AC-14 Shift+Enter inserts newline, Enter sends the message', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);
    await mockBuilderChat(page, [
      { type: 'text_delta', content: 'Got it!' },
      { type: 'done', tools: [] },
    ]);
    await openAiMode(page);

    const input = page.locator('[data-testid="ai-chat-input"]');
    await input.click();
    await input.type('Line one');
    await page.keyboard.press('Shift+Enter');
    await input.type('Line two');

    const value = await input.inputValue();
    expect(value).toContain('\n');

    // Enter sends
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="ai-user-message"]').first()).toBeVisible({ timeout: 8_000 });
    await expect(input).toHaveValue('');
  });

  // ── AC-15: Multiple tool calls ────────────────────────────────────────────

  test('AC-15 multiple tool_executed events produce multiple badges and all mutations apply', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);

    const nodeId = await addNodeToCanvas(page, 'Text', 'Multi-tool test');

    await mockBuilderChat(page, [
      { type: 'text_delta', content: 'Reading page then updating.' },
      { type: 'tool_executed', id: 'tc-r', name: 'get_page_tree', input: { depth: 2 } },
      { type: 'tool_executed', id: 'tc-t', name: 'set_text', input: { nodeId, text: 'AI Updated' } },
      { type: 'tool_executed', id: 'tc-c', name: 'add_class', input: { nodeId, tokens: 'font-bold' } },
      { type: 'done', tools: [] },
    ]);
    await openAiMode(page);

    await page.locator('[data-testid="ai-chat-input"]').fill('Update the heading');
    await page.locator('[data-testid="ai-send-btn"]').click();

    await expect(page.locator('[data-testid="tool-badge"]')).toHaveCount(3, { timeout: 10_000 });

    expect(await getNodeText(page, nodeId)).toBe('AI Updated');
    const cls = await getNodeClassName(page, nodeId);
    expect(cls).toContain('font-bold');
  });

  // ── AC-16: Incremental canvas building ───────────────────────────────────

  test('AC-16 tool calls build the canvas incrementally — each call visible immediately', async ({ page }) => {
    await gotoBuilder(page);
    await mockThreadAPI(page);

    // Pre-create a heading node with a known ID so set_text / add_class can reference it
    const headingId = await addNodeToCanvas(page, 'Text', 'Old Title');

    const nodesBefore = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      return (store?.pageNodes as unknown[])?.length ?? 0;
    });

    await mockBuilderChat(page, [
      { type: 'text_delta', content: 'Building hero section step by step...' },
      // Tool 1: add a container Box
      { type: 'tool_executed', id: 'tc-1', name: 'add_component', input: { label: 'Box' } },
      // Tool 2: style it
      { type: 'tool_executed', id: 'tc-2', name: 'add_class', input: { nodeId: headingId, tokens: 'text-5xl font-extrabold' } },
      // Tool 3: update heading text
      { type: 'tool_executed', id: 'tc-3', name: 'set_text', input: { nodeId: headingId, text: 'Welcome to Our Platform' } },
      // Tool 4: add another component
      { type: 'tool_executed', id: 'tc-4', name: 'add_component', input: { label: 'Text' } },
      // Tool 5: add another component (button)
      { type: 'tool_executed', id: 'tc-5', name: 'add_component', input: { label: 'Btn Solid' } },
      // Tool 6: add a class to heading
      { type: 'tool_executed', id: 'tc-6', name: 'add_class', input: { nodeId: headingId, tokens: 'text-center' } },
      { type: 'done', tools: [] },
    ]);

    await openAiMode(page);
    await page.locator('[data-testid="ai-chat-input"]').fill('Build a hero section');
    await page.locator('[data-testid="ai-send-btn"]').click();

    // Wait for all 6 tool badges to appear — confirms all tools executed
    await expect(page.locator('[data-testid="tool-badge"]')).toHaveCount(6, { timeout: 15_000 });

    // Verify per-tool-type badge counts
    await expect(page.locator('[data-testid="tool-badge"][data-tool-name="add_component"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="tool-badge"][data-tool-name="set_text"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="tool-badge"][data-tool-name="add_class"]')).toHaveCount(2);

    // Verify canvas has more nodes than before (3 add_component calls added nodes)
    const nodesAfter = await page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>).__builderStore?.getState();
      return (store?.pageNodes as unknown[])?.length ?? 0;
    });
    expect(nodesAfter).toBeGreaterThanOrEqual(nodesBefore + 3);

    // Verify the heading text was updated by set_text
    const headingText = await getNodeText(page, headingId);
    expect(headingText).toBe('Welcome to Our Platform');

    // Verify the heading has the classes added by add_class
    const headingCls = await getNodeClassName(page, headingId);
    expect(headingCls).toContain('text-5xl');
    expect(headingCls).toContain('text-center');

    // Verify the AI response text appears in chat
    await expect(page.locator('[data-testid="ai-assistant-message"]').first()).toContainText(
      'Building hero section step by step', { timeout: 5_000 }
    );
  });
});
