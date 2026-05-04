#!/usr/bin/env npx tsx
/**
 * scripts/export-config-test.ts
 *
 * Headless export test:
 *   1. Load config/ → builderState via configToBuilderState()
 *   2. Run codegenProject(state) → EmittedFile[]
 *   3. Write files to a tmp directory
 *   4. Run `npm install --prefer-offline` in tmp dir
 *   5. Run `npm run build` (next build) — catches type errors & missing imports
 *
 * Exit code: 0 = success, 1 = failure
 *
 * Usage: npm run test:export:config
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { configToBuilderState } from '../lib/builder/codegen/__tests__/config-to-state';
import { codegenProject } from '../lib/builder/codegen';

const START = Date.now();
function log(msg: string) {
  console.log(`[${Math.round((Date.now() - START) / 1000)}s] ${msg}`);
}

async function main() {
  // ── Step 1: configToBuilderState ──────────────────────────────────────────
  log('Loading config/ → builder state...');
  const state = configToBuilderState();
  log(`  Pages: ${state.pages.length}, Vars: ${state.customVars.length}, DS: ${state.pageDataSources.length}`);

  // ── Step 2: codegenProject ────────────────────────────────────────────────
  log('Running codegen pipeline...');
  let files;
  try {
    files = codegenProject(state as Parameters<typeof codegenProject>[0], { appName: 'config-export-test' });
  } catch (err) {
    console.error('❌ codegenProject() threw:', (err as Error).message);
    process.exit(1);
  }
  log(`  Generated ${files.length} files`);

  // ── Step 3: Write to tmp dir ──────────────────────────────────────────────
  const tmpDir = path.join(os.tmpdir(), `sdui-export-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  log(`Writing files to ${tmpDir}...`);

  const appDir = path.join(tmpDir, 'config-export-test');
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

  log(`  Wrote to ${appDir}`);

  // ── Step 4: npm install ────────────────────────────────────────────────────
  log('Running npm install --prefer-offline --no-audit...');
  try {
    execSync('npm install --prefer-offline --no-audit --loglevel=error', {
      cwd: appDir,
      stdio: 'inherit',
      timeout: 120_000,
    });
  } catch (err) {
    console.error('❌ npm install failed:', (err as Error).message);
    cleanup(tmpDir);
    process.exit(1);
  }

  // ── Step 5: npm run build ─────────────────────────────────────────────────
  log('Running npm run build (next build)...');
  try {
    execSync('npm run build', {
      cwd: appDir,
      stdio: 'inherit',
      timeout: 180_000,
    });
  } catch (err) {
    console.error('❌ next build failed — see output above');
    cleanup(tmpDir);
    process.exit(1);
  }

  log('✅ Export test passed! Build succeeded.');

  cleanup(tmpDir);
  process.exit(0);
}

function cleanup(tmpDir: string) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

main().catch(err => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
