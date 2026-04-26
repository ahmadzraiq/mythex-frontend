import { test, expect, type Page } from '@playwright/test';

test.setTimeout(30_000);

const BASE = 'http://preview-dev.localhost:3001';
const URL  = `${BASE}/file-upload-test`;

async function gotoPage(page: Page) {
  await page.goto(URL);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

test.describe('FileUpload System Component', () => {
  test('FU-01: Dropzone renders with default label "Click to upload"', async ({ page }) => {
    await gotoPage(page);

    const dropzone = page.getByTestId('file-upload-dropzone');
    await expect(dropzone).toBeVisible({ timeout: 10_000 });
    await expect(dropzone).toContainText('Click to upload');
    await expect(dropzone).toContainText('Any file type');
  });

  test('FU-02: Click dropzone opens file picker; setting a file updates the display text', async ({ page }) => {
    await gotoPage(page);

    const dropzone = page.getByTestId('file-upload-dropzone');
    await expect(dropzone).toBeVisible();

    const fileChooserPromise = page.waitForEvent('filechooser');
    await dropzone.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hi'),
    });

    await page.waitForTimeout(500);

    await expect(page.getByTestId('out-picked-filename')).toHaveText('File: hello.txt');
    await expect(dropzone).toContainText('hello.txt');
  });

  test('FU-03: Picked file array has the expected shape in the variable store', async ({ page }) => {
    await gotoPage(page);

    const dropzone = page.getByTestId('file-upload-dropzone');
    await expect(dropzone).toBeVisible();

    const fileChooserPromise = page.waitForEvent('filechooser');
    await dropzone.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 stub'),
    });

    await page.waitForTimeout(500);

    const files = await page.evaluate(() => {
      const store = (window as unknown as {
        __globalVariableStore?: { getState: () => { data?: Record<string, unknown> } };
      }).__globalVariableStore;
      const value = store?.getState?.().data?.['fu-test-files'];
      if (!Array.isArray(value)) return null;
      return value.map((entry) => {
        const f = entry as { name?: unknown; size?: unknown; type?: unknown; lastModified?: unknown };
        return {
          name: typeof f.name === 'string' ? f.name : null,
          size: typeof f.size === 'number' ? f.size : null,
          type: typeof f.type === 'string' ? f.type : null,
          hasLastModified: typeof f.lastModified === 'number',
        };
      });
    });

    expect(Array.isArray(files)).toBe(true);
    expect(files!.length).toBe(1);
    expect(files![0].name).toBe('report.pdf');
    expect(files![0].type).toBe('application/pdf');
    expect(typeof files![0].size).toBe('number');
    expect(files![0].hasLastModified).toBe(true);
  });
});
