/**
 * e2e/export-from-config.spec.ts
 *
 * Full E2E export test: runs the codegen pipeline against the static config/,
 * writes the output to a tmp dir, builds it with Next.js, starts the server,
 * and verifies each page loads without console errors.
 *
 * Run with: npx playwright test e2e/export-from-config.spec.ts
 * Or:       npm run test:e2e:export
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

// These are imported at test time (not at module level) to avoid loading
// Next.js internals in the Playwright worker process
async function loadCodegen() {
  const { configToBuilderState } = await import('../lib/builder/codegen/__tests__/config-to-state');
  const { codegenProject } = await import('../lib/builder/codegen');
  return { configToBuilderState, codegenProject };
}

let tmpDir = '';
let serverProcess: ChildProcess | null = null;
let serverPort = 0;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const { configToBuilderState, codegenProject } = await loadCodegen();

  // 1. Build state from config/
  const state = configToBuilderState();

  // 2. Run codegen
  const files = codegenProject(state as Parameters<typeof codegenProject>[0], {
    appName: 'e2e-export-test',
  });

  // 3. Write to tmp dir
  tmpDir = path.join(os.tmpdir(), `sdui-export-e2e-${Date.now()}`);
  const appDir = path.join(tmpDir, 'e2e-export-test');
  fs.mkdirSync(appDir, { recursive: true });

  for (const file of files) {
    const filePath = path.join(appDir, file.path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (file.binary) {
      fs.writeFileSync(filePath, file.binary);
    } else {
      fs.writeFileSync(filePath, file.content, 'utf-8');
    }
  }

  // 4. npm install
  execSync('npm install --prefer-offline --no-audit --loglevel=error', {
    cwd: appDir,
    timeout: 120_000,
    stdio: 'pipe',
  });

  // 5. next build
  execSync('npm run build', {
    cwd: appDir,
    timeout: 180_000,
    stdio: 'pipe',
  });

  // 6. next start on a free port
  serverPort = 3100 + Math.floor(Math.random() * 900);
  serverProcess = spawn('npx', ['next', 'start', '-p', String(serverPort)], {
    cwd: appDir,
    detached: false,
    stdio: 'pipe',
  });

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 30_000);
    serverProcess!.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('ready') || data.toString().includes('started')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProcess!.on('error', reject);
  });
});

test.afterAll(async () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

const ROUTES_TO_TEST = [
  '/',
  '/cart',
  '/checkout',
  '/sign-in',
];

for (const route of ROUTES_TO_TEST) {
  test(`page ${route} renders without console errors`, async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const url = `http://localhost:${serverPort}${route}`;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    // Page should not 500
    expect(response?.status()).not.toBe(500);
    expect(response?.status()).not.toBe(404);

    // Should have some DOM content
    const body = await page.locator('body').innerHTML();
    expect(body.length).toBeGreaterThan(50);

    // No console errors (network errors from missing .env are OK)
    const criticalErrors = consoleErrors.filter(
      e => !e.includes('fetch') && !e.includes('network') && !e.includes('NEXT_PUBLIC')
    );
    expect(criticalErrors).toHaveLength(0);
  });
}

test('export button is visible in the builder', async ({ page }) => {
  await page.goto('/dev/builder', { waitUntil: 'networkidle', timeout: 30_000 });
  const exportBtn = page.locator('[data-testid="btn-export"]');
  await expect(exportBtn).toBeVisible({ timeout: 10_000 });
});
