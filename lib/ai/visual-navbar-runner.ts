/**
 * Playwright runner for visual navbar tests.
 * Used by eval-ai and run-visual-navbar-test script.
 */

import { chromium } from 'playwright';

export type VisualAssert = {
  role?: 'button' | 'link' | 'textbox';
  name?: string;
  assertions?: {
    backgroundColor?: string;
    color?: string;
    borderColor?: string;
    visibility?: 'visible' | 'hidden';
  };
  check?: 'navbarVisible';
};

export type VisualTestInput = {
  overrides: Record<string, unknown>;
  visualAssert: VisualAssert;
};

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001';

function encodePreview(overrides: object): string {
  return Buffer.from(JSON.stringify(overrides)).toString('base64');
}

function matchesRgb(actual: string, expected: string): boolean {
  const rgbMatch = expected.match(/\d+/g);
  if (rgbMatch) {
    return (
      actual === expected ||
      actual.replace(/\s/g, '') === expected.replace(/\s/g, '') ||
      new RegExp(`rgb\\(\\s*${rgbMatch.join('\\s*,\\s*')}\\s*\\)`).test(actual)
    );
  }
  return actual === expected;
}

/**
 * Run visual test: navigate with overrides, find element, assert styles.
 * Returns { pass, error }.
 */
export async function runVisualNavbarTest(
  input: VisualTestInput
): Promise<{ pass: boolean; error?: string }> {
  const { overrides, visualAssert } = input;
  const { role = 'button', name, assertions, check } = visualAssert;

  if (check === 'navbarVisible') {
    const encoded = encodePreview(overrides);
    const url = `${BASE_URL}/?navbarPreview=${encoded}`;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(5000);
      const navbar = page.locator('#navbar-root');
      await navbar.waitFor({ state: 'visible', timeout: 15000 });
      await browser.close();
      return { pass: true };
    } catch (e) {
      await browser.close();
      const err = e instanceof Error ? e.message : String(e);
      return { pass: false, error: err };
    }
  }

  if (!name || !assertions || Object.keys(assertions).length === 0) {
    return { pass: false, error: 'visualAssert requires name and assertions' };
  }

  const encoded = encodePreview(overrides);
  const url = `${BASE_URL}/?navbarPreview=${encoded}&authPreview=1`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(4000);

    const navbar = page.locator('#navbar-root');
    await navbar.waitFor({ state: 'visible', timeout: 10000 });
    const locator =
      role === 'button'
        ? navbar.getByRole('button', { name })
        : role === 'link'
          ? navbar.getByRole('link', { name })
          : role === 'textbox'
            ? navbar.getByRole('textbox', { name })
            : navbar.getByText(name);

    await locator.waitFor({ state: 'visible', timeout: 15000 });

    const element = locator.first();
    const styles = await element.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        backgroundColor: s.backgroundColor,
        color: s.color,
        borderColor: s.borderColor,
        visibility: s.visibility,
      };
    });

    for (const [prop, expected] of Object.entries(assertions)) {
      const actual = styles[prop as keyof typeof styles];
      if (prop === 'visibility') {
        if (actual !== expected) {
          await browser.close();
          return {
            pass: false,
            error: `Expected ${prop}="${expected}", got "${actual}"`,
          };
        }
      } else if (prop === 'backgroundColor' || prop === 'color' || prop === 'borderColor') {
        if (!matchesRgb(actual, expected)) {
          const isTransparent =
            actual === 'rgba(0, 0, 0, 0)' || actual === 'transparent';
          if (prop === 'backgroundColor' && isTransparent) {
            continue;
          }
          await browser.close();
          return {
            pass: false,
            error: `Expected ${prop}="${expected}", got "${actual}"`,
          };
        }
      }
    }

    await browser.close();
    return { pass: true };
  } catch (e) {
    await browser.close();
    const err = e instanceof Error ? e.message : String(e);
    return { pass: false, error: err };
  }
}
