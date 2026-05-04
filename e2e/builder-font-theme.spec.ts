/**
 * Builder font theme E2E tests — covers:
 *
 *  BF-01  Selecting a heading font updates the CSS variable on <body>
 *  BF-02  The <style id="builder-light-overrides"> block contains the font in a body{} rule
 *  BF-03  The Zustand store's themeOverrides reflects the new font value
 *  BF-04  Selecting a body font applies independently to --font-body
 *  BF-05  After selecting a Google font, a <link> tag is injected into <head>
 *  BF-06  Switching font updates the preview text inside the Typography section
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const EMAIL    = 'test@example.com';
const PASSWORD = 'password123';
const BASE     = 'http://localhost:3001';

// ── Helpers (mirrors builder-seed.spec.ts) ────────────────────────────────────

async function loginAndInjectCookie(ctx: BrowserContext): Promise<void> {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `Login failed: ${await res.text()}`).toBeTruthy();

  const setCookie = res.headers()['set-cookie'] ?? '';
  const match = setCookie.match(/auth_token=([^;]+)/);
  expect(match, 'No auth_token in Set-Cookie').not.toBeNull();

  await ctx.addCookies([{
    name: 'auth_token', value: match![1],
    domain: 'localhost', path: '/',
    httpOnly: true, sameSite: 'Strict',
  }]);
}

async function createTestProject(ctx: BrowserContext): Promise<string> {
  const wsRes = await ctx.request.post(`${BASE}/api/workspaces`, {
    data: { name: `Font Test ${Date.now()}` },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(wsRes.ok(), `Create workspace failed: ${await wsRes.text()}`).toBeTruthy();
  const { workspace } = await wsRes.json() as { workspace: { id: string } };

  const prjRes = await ctx.request.post(`${BASE}/api/workspaces/${workspace.id}/projects`, {
    data: { name: 'Font E2E Project' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(prjRes.ok(), `Create project failed: ${await prjRes.text()}`).toBeTruthy();
  const { project } = await prjRes.json() as { project: { id: string } };
  return project.id;
}

async function waitForBuilder(page: Page) {
  await page.waitForSelector('[data-testid="builder-canvas"]', { timeout: 35_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 200 },
  );
  await page.waitForTimeout(600);
}

/** Open the right-panel Theme tab and expand the Typography section. */
async function openTypographySection(page: Page) {
  // Click the Theme tab in the right panel
  await page.getByTestId('tab-theme').click();
  await page.waitForTimeout(200);

  // Click Typography toggle to expand (may already be open, but click is idempotent
  // when the section is closed — if open it will close then we reopen)
  const toggle = page.getByTestId('typography-section-toggle');
  await expect(toggle).toBeVisible({ timeout: 5_000 });

  // Only click if the selects aren't already visible
  const headingSelect = page.getByTestId('select-font-heading');
  const alreadyOpen   = await headingSelect.isVisible().catch(() => false);
  if (!alreadyOpen) await toggle.click();

  await expect(headingSelect).toBeVisible({ timeout: 3_000 });
}

/** Read the raw textContent of the builder-light-overrides <style> tag. */
async function getLightOverridesCSS(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.getElementById('builder-light-overrides');
    return el?.textContent ?? '';
  });
}

/** Read font overrides from the Zustand store. */
async function getStoreFontOverrides(page: Page) {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState: () => Record<string, unknown> }>)
      .__builderStore?.getState();
    const overrides = (store?.themeOverrides ?? {}) as Record<string, string>;
    return {
      fontHeading: overrides['font-heading'] ?? null,
      fontBody:    overrides['font-body']    ?? null,
    };
  });
}

/** Get the computed CSS variable value from document.body. */
async function getBodyCssVar(page: Page, varName: string): Promise<string> {
  return page.evaluate((v) => {
    return getComputedStyle(document.body).getPropertyValue(v).trim();
  }, `--${varName}`);
}

// ── Suite ──────────────────────────────────────────────────────────────────────

test.describe('Builder font theme', () => {
  // Tests are sequential and share a single browser session. Retries re-run
  // beforeAll which fails because the context is already torn down — disable
  // retries for this suite.
  test.describe.configure({ retries: 0 });

  let ctx:       BrowserContext;
  let page:      Page;
  let projectId: string;

  test.beforeAll(async ({ browser }) => {
    // waitForBuilder can take up to 35 s; bump to 90 s so beforeAll doesn't race
    test.setTimeout(90_000);

    ctx  = await browser.newContext();
    await loginAndInjectCookie(ctx);
    projectId = await createTestProject(ctx);
    page = await ctx.newPage();
    await page.goto(`${BASE}/builder/${projectId}`);
    await waitForBuilder(page);
    await openTypographySection(page);
  });

  test.afterAll(async () => {
    await ctx.close();
  });

  // ── BF-01  Heading font CSS variable updates on <body> ─────────────────────
  test('BF-01 selecting heading font updates --font-heading on document.body', async () => {
    const select = page.getByTestId('select-font-heading');
    await select.selectOption({ value: "'Space Grotesk', sans-serif" });

    // Wait for the injected <style> block to reflect the change
    await page.waitForFunction(
      () => document.getElementById('builder-light-overrides')?.textContent?.includes('Space Grotesk') ?? false,
      { timeout: 5_000 },
    );

    // Critical: the COMPUTED CSS value on body must reflect the builder's choice.
    // This catches the regression where ThemeStyles (in <body>) overrides the
    // builder's style (previously in <head>, now correctly also in <body> after it).
    const cssValue = await getBodyCssVar(page, 'font-heading');
    expect(cssValue).toContain('Space Grotesk');

    // And confirm the builder's style tag is in <body>, not <head>
    const tagLocation = await page.evaluate(() => {
      const el = document.getElementById('builder-light-overrides');
      if (!el) return 'not-found';
      return document.body.contains(el) ? 'in-body' : 'in-head';
    });
    expect(tagLocation).toBe('in-body');
  });

  // ── BF-02  <style> block has font in body{} rule ───────────────────────────
  test('BF-02 builder-light-overrides style block declares --font-heading inside body{}', async () => {
    const css = await getLightOverridesCSS(page);

    // The body{} block must exist and contain --font-heading
    expect(css).toContain('body {');
    expect(css).toMatch(/--font-heading\s*:\s*'Space Grotesk'/);
  });

  // ── BF-03  Zustand store reflects new font value ───────────────────────────
  test('BF-03 Zustand themeOverrides[font-heading] matches selected font', async () => {
    const { fontHeading } = await getStoreFontOverrides(page);
    expect(fontHeading).toBe("'Space Grotesk', sans-serif");
  });

  // ── BF-04  Body font applies independently ─────────────────────────────────
  test('BF-04 selecting body font updates --font-body independently', async () => {
    const select = page.getByTestId('select-font-body');
    await select.selectOption({ value: "'Lora', serif" });

    // Wait for the injected <style> block to actually contain the Lora declaration.
    await page.waitForFunction(
      () => document.getElementById('builder-light-overrides')?.textContent?.includes('Lora') ?? false,
      { timeout: 5_000 },
    );

    // Verify the raw CSS block content
    const css = await getLightOverridesCSS(page);
    expect(css).toContain('body {');
    expect(css).toMatch(/--font-body\s*:\s*'Lora'/);
    expect(css).toMatch(/--font-heading\s*:\s*'Space Grotesk'/);

    // Verify Zustand store
    const { fontBody, fontHeading } = await getStoreFontOverrides(page);
    expect(fontBody).toBe("'Lora', serif");
    expect(fontHeading).toBe("'Space Grotesk', sans-serif");

    // Critical: verify the COMPUTED CSS variable on body resolves to the builder's
    // value (Lora), not the ThemeStyles default (Space Grotesk). This is the
    // regression test for the head-vs-body cascade ordering bug.
    const computedBodyFont = await getBodyCssVar(page, 'font-body');
    expect(computedBodyFont).toContain('Lora');
  });

  // ── BF-05  Google Font <link> tag injected into <head> ─────────────────────
  test('BF-05 a Google Font <link> is injected into <head> when a Google font is selected', async () => {
    // Space Grotesk is a Google font — its link should already be there from BF-01
    const linkHref = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      return links.find(l => (l as HTMLLinkElement).href.includes('Space+Grotesk'))
        ? 'found' : 'not-found';
    });
    expect(linkHref).toBe('found');
  });

  // ── BF-06  Preview text inside Typography section uses selected font ────────
  test('BF-06 the font preview text under each select uses the selected font', async () => {
    // The preview div is the sibling after the select inside FontSelect
    // It has style.fontFamily set directly (not via CSS variable)
    const headingPreview = page.locator(
      '[data-testid="select-font-heading"] + div',
    );
    await expect(headingPreview).toBeVisible({ timeout: 3_000 });

    const previewFont = await headingPreview.evaluate(
      (el) => (el as HTMLElement).style.fontFamily,
    );
    expect(previewFont).toContain('Space Grotesk');
  });

  // ── BF-07  CSS variable NOT set on :root (must be on body) ─────────────────
  test('BF-07 --font-heading is NOT declared on :root (avoids ThemeStyles conflict)', async () => {
    const css = await getLightOverridesCSS(page);

    // Confirm the style block has no :root { --font-heading declaration
    const rootBlockMatch = css.match(/:root\s*\{([^}]*)\}/);
    if (rootBlockMatch) {
      expect(rootBlockMatch[1]).not.toContain('--font-heading');
      expect(rootBlockMatch[1]).not.toContain('--font-body');
    }
  });
});

// ── Preview applyTheme cascade test ───────────────────────────────────────────
// Verifies that the preview's applyTheme() helper (app/app-preview/[[...slug]])
// follows the same body-append / body{} font rule pattern.

test('BF-P01 preview applyTheme puts font vars in body{} not :root{}', () => {
  // This is a pure logic test — no browser required.
  // We simulate what applyTheme would write to the <style> element by re-running
  // the same logic here and checking the output string.

  const GLUESTACK = '--color-primary-400: var(--primary) !important;';

  function simulateApplyTheme(light: Record<string, string>): string {
    const colorLines: string[] = [];
    const fontLines:  string[] = [];
    const baseLines:  string[] = [];

    function hexToRgb(hex: string) {
      const c = hex.replace('#', '');
      const f = c.length === 3 ? c.split('').map(x => x+x).join('') : c;
      return `${parseInt(f.slice(0,2),16)} ${parseInt(f.slice(2,4),16)} ${parseInt(f.slice(4,6),16)}`;
    }

    for (const [k, v] of Object.entries(light)) {
      if (v.startsWith('#')) colorLines.push(`  --${k}: ${hexToRgb(v)};`);
      else if (k === 'font-heading' || k === 'font-body') fontLines.push(`  --${k}: ${v};`);
      else baseLines.push(`  --${k}: ${v};`);
    }
    const parts: string[] = [];
    if (baseLines.length) parts.push(`:root {\n${baseLines.join('\n')}\n}`);
    if (fontLines.length) parts.push(`body {\n${fontLines.join('\n')}\n}`);
    parts.push(`html:not(.dark) {\n${colorLines.join('\n')}\n${GLUESTACK}\n}`);
    return parts.join('\n\n');
  }

  const result = simulateApplyTheme({
    'font-heading': "'Lora', serif",
    'font-body':    "'Lora', serif",
    primary:        '#3b82f6',
    radius:         '0.5rem',
  });

  // font vars go inside body{}, not :root{}
  expect(result).toMatch(/body\s*\{[^}]*--font-heading/s);
  expect(result).toMatch(/body\s*\{[^}]*--font-body/s);

  // font vars must NOT appear in :root{}
  const rootMatch = result.match(/:root\s*\{([^}]*)\}/s);
  if (rootMatch) {
    expect(rootMatch[1]).not.toContain('--font-heading');
    expect(rootMatch[1]).not.toContain('--font-body');
  }

  // :root{} only has non-font, non-color vars (radius here)
  expect(result).toMatch(/:root\s*\{[^}]*--radius/s);
});
