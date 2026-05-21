#!/usr/bin/env npx tsx
/**
 * scripts/export-and-run.ts
 *
 * Export the current project as a standalone Next.js app and start its dev server.
 *
 * Usage:
 *   npm run export:run
 *   npm run export:run -- --out ~/Desktop/my-export --port 3050
 *   npm run export:run -- --project-id <id> --out ~/Desktop/my-export
 *
 * Options:
 *   --out <dir>          Output directory  (default: /tmp/sdui-export)
 *   --port <n>           Dev server port   (default: 3050)
 *   --no-install         Skip npm install  (reuse existing node_modules)
 *   --no-serve           Export only, skip starting the dev server
 *   --project-id <id>    Fetch live state from the backend instead of static config/
 *                        (requires BACKEND_URL in .env and the dev server to be running)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { configToBuilderState } from '../lib/builder/codegen/__tests__/config-to-state';
import { codegenProject } from '../lib/builder/codegen';
import { loadSharedComponents } from '../lib/builder/shared-component-data';
import type { BuilderStore } from '../app/dev/builder/_store-types';

// ── Parse args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const outDir     = args[args.indexOf('--out')  + 1] ?? '/tmp/sdui-export';
const port       = args[args.indexOf('--port') + 1] ?? '3050';
const noServe    = args.includes('--no-serve');
const noInstall  = args.includes('--no-install');
const projectIdIdx = args.indexOf('--project-id');
const projectId  = projectIdIdx !== -1 ? args[projectIdIdx + 1] : null;

const START = Date.now();
function log(msg: string) {
  console.log(`[${Math.round((Date.now() - START) / 1000)}s] ${msg}`);
}

// ── Load live state from backend ──────────────────────────────────────────────
async function loadLiveState(id: string): Promise<Partial<BuilderStore>> {
  // Read BACKEND_URL from .env file (dotenv not loaded in tsx by default)
  const envPath = path.join(process.cwd(), '.env');
  let backendUrl = 'http://localhost:4000';
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^BACKEND_URL=(.+)$/m);
    if (match) backendUrl = match[1].trim();
  }

  log(`  Fetching live state from ${backendUrl}/projects/${id}/config/meta ...`);
  const metaRes = await fetch(`${backendUrl}/projects/${id}/config/meta`);
  if (!metaRes.ok) throw new Error(`Backend returned ${metaRes.status} for config/meta`);
  const metaJson = await metaRes.json() as { config?: Record<string, unknown> };
  const saved = metaJson.config ?? {};

  // Fetch each page's nodes in parallel
  const pageStubs = (saved.pages ?? []) as Array<{ id: string; name: string; route?: string }>;
  log(`  Fetching ${pageStubs.length} page(s)...`);

  const fetchPage = async (stub: { id: string }) => {
    const res = await fetch(`${backendUrl}/projects/${id}/pages/${stub.id}`);
    if (!res.ok) return [];
    const data = await res.json() as { page?: { nodes?: unknown[] } };
    return data.page?.nodes ?? [];
  };

  const allPageNodes = await Promise.all(pageStubs.map(fetchPage));

  const pages = pageStubs.map((stub, i) => ({
    id: stub.id,
    name: stub.name,
    route: stub.route,
    nodes: allPageNodes[i],
    wx: 0,
    wy: 0,
  }));

  // Merge with the static config as a base (provides datasources, formulas, routes, shared components)
  const staticState = configToBuilderState();

  return {
    ...staticState,
    // Override pages with live nodes from backend
    pages: pages.length > 0 ? pages as BuilderStore['pages'] : staticState.pages,
    // Override workflows and vars from backend if present
    ...(saved.pageWorkflows ? { pageWorkflows: saved.pageWorkflows as BuilderStore['pageWorkflows'] } : {}),
    ...(saved.pageWorkflowMeta ? { pageWorkflowMeta: saved.pageWorkflowMeta as BuilderStore['pageWorkflowMeta'] } : {}),
    ...(saved.globalWorkflows ? { globalWorkflows: saved.globalWorkflows as BuilderStore['globalWorkflows'] } : {}),
    ...(saved.globalWorkflowMeta ? { globalWorkflowMeta: saved.globalWorkflowMeta as BuilderStore['globalWorkflowMeta'] } : {}),
    ...(saved.customVars ? { customVars: saved.customVars as BuilderStore['customVars'] } : {}),
    ...(saved.customColors ? { customColors: saved.customColors as BuilderStore['customColors'] } : {}),
    ...(saved.themeOverrides ? { themeOverrides: saved.themeOverrides as BuilderStore['themeOverrides'] } : {}),
    ...(saved.themeDarkOverrides ? { themeDarkOverrides: saved.themeDarkOverrides as BuilderStore['themeDarkOverrides'] } : {}),
  };

  // Load shared components into the module-level store so resolvePageNodes can resolve SC instances
  if (saved.sharedComponents) {
    loadSharedComponents(saved.sharedComponents as Record<string, unknown>);
  }
}

async function main() {
  // ── Step 1: Generate files ──────────────────────────────────────────────────
  let state: Partial<BuilderStore>;

  if (projectId) {
    log(`Loading live state from backend (project: ${projectId})...`);
    state = await loadLiveState(projectId);
  } else {
    log('Loading config/ → builder state...');
    state = configToBuilderState();
  }

  log(`  Pages: ${state.pages?.length ?? 0}, Vars: ${state.customVars?.length ?? 0}`);

  log('Running codegen...');
  const files = codegenProject(state as Parameters<typeof codegenProject>[0], { appName: path.basename(outDir) });
  log(`  Generated ${files.length} files`);

  // ── Step 2: Write to output dir ────────────────────────────────────────────
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

  // ── Step 3: npm install ────────────────────────────────────────────────────
  if (!noInstall) {
    log('Running npm install...');
    execSync('npm install --prefer-offline --no-audit --loglevel=error', {
      cwd: outDir,
      stdio: 'inherit',
      timeout: 120_000,
    });
  }

  // ── Step 4: Start dev server (skipped when --no-serve) ────────────────────
  if (noServe) {
    log('Export complete (--no-serve: skipping dev server).');
    process.exit(0);
  }

  log(`Starting dev server on http://localhost:${port} ...`);
  log('Press Ctrl+C to stop.\n');

  const next = spawn(
    './node_modules/.bin/next',
    ['dev', '--port', port],
    { cwd: outDir, stdio: 'inherit' },
  );

  next.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => { next.kill('SIGINT'); process.exit(0); });
}

main().catch(err => { console.error(err); process.exit(1); });
