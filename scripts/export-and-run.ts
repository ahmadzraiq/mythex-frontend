#!/usr/bin/env npx tsx
/**
 * scripts/export-and-run.ts
 *
 * Export the current config/ as a standalone Next.js app and start its dev server.
 *
 * Usage:
 *   npm run export:run
 *   npm run export:run -- --out ~/Desktop/my-export --port 3050
 *
 * Options:
 *   --out <dir>    Output directory  (default: /tmp/sdui-export)
 *   --port <n>     Dev server port   (default: 3050)
 *   --no-install   Skip npm install  (reuse existing node_modules)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { configToBuilderState } from '../lib/builder/codegen/__tests__/config-to-state';
import { codegenProject } from '../lib/builder/codegen';

// ── Parse args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const outDir  = args[args.indexOf('--out')  + 1] ?? '/tmp/sdui-export';
const port    = args[args.indexOf('--port') + 1] ?? '3050';
const noInstall = args.includes('--no-install');

const START = Date.now();
function log(msg: string) {
  console.log(`[${Math.round((Date.now() - START) / 1000)}s] ${msg}`);
}

// ── Step 1: Generate files ────────────────────────────────────────────────────
log('Loading config/ → builder state...');
const state = configToBuilderState();
log(`  Pages: ${state.pages.length}, Vars: ${state.customVars.length}`);

log('Running codegen...');
const files = codegenProject(state as Parameters<typeof codegenProject>[0], { appName: path.basename(outDir) });
log(`  Generated ${files.length} files`);

// ── Step 2: Write to output dir ───────────────────────────────────────────────
log(`Writing to ${outDir}...`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const file of files) {
  const filePath = path.join(outDir, file.path);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (file.binary) fs.writeFileSync(filePath, file.binary);
  else fs.writeFileSync(filePath, file.content, 'utf-8');
}
log(`  Done — ${files.length} files written`);

// ── Step 3: npm install ───────────────────────────────────────────────────────
if (!noInstall) {
  log('Running npm install...');
  execSync('npm install --prefer-offline --no-audit --loglevel=error', {
    cwd: outDir,
    stdio: 'inherit',
    timeout: 120_000,
  });
}

// ── Step 4: Start dev server ──────────────────────────────────────────────────
log(`Starting dev server on http://localhost:${port} ...`);
log('Press Ctrl+C to stop.\n');

const next = spawn(
  './node_modules/.bin/next',
  ['dev', '--port', port],
  { cwd: outDir, stdio: 'inherit' },
);

next.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => { next.kill('SIGINT'); process.exit(0); });
