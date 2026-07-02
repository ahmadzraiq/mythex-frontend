#!/usr/bin/env npx tsx
/**
 * scripts/seed-all.ts
 *
 * Full reset + seed in one command:
 *   1. Login
 *   2. Delete ALL existing projects in the workspace
 *   3. Create a fresh project
 *   4. Seed the frontend UI config (pages, workflows, theme, etc.) from SOURCE_DIR
 *   5. Seed the backend Vendure data model (tables, workflows, sample data)
 *
 * Usage:
 *   cd /Users/ahmadzraiq/Desktop/mythex-frontend
 *   npx tsx scripts/seed-all.ts
 *
 * Env overrides:
 *   SEED_EMAIL          (default: ahmadzraiqq@gmail.com)
 *   SEED_PASSWORD       (default: asdASDasd582617!)
 *   SEED_PROJECT_NAME   (default: Vendure Store)
 *   SOURCE_DIR          (default: /Users/ahmadzraiq/Desktop/config)
 *   BACKEND_URL         (default: http://localhost:4000)
 *   BACKEND_REPO        (default: /Users/ahmadzraiq/Desktop/mythex-backend)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const BASE         = process.env.BACKEND_URL      ?? 'http://localhost:4000';
const V1           = `${BASE}/v1`;
const SEED_EMAIL   = process.env.SEED_EMAIL       ?? 'ahmadzraiqq@gmail.com';
const SEED_PASS    = process.env.SEED_PASSWORD    ?? 'asdASDasd582617!';
const PROJECT_NAME = process.env.SEED_PROJECT_NAME ?? 'Vendure Store';
const SOURCE_DIR   = process.env.SOURCE_DIR        ?? '/Users/ahmadzraiq/Desktop/config';
const BACKEND_REPO = process.env.BACKEND_REPO      ?? '/Users/ahmadzraiq/Desktop/mythex-backend';

// ── HTTP helper ───────────────────────────────────────────────────────────────

let authCookie = '';

async function api<T = unknown>(
  urlPath: string,
  options: RequestInit & { query?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const url = urlPath.startsWith('http') ? urlPath : `${V1}${urlPath}`;
  const { query, ...init } = options;
  const fullUrl = query ? `${url}?${new URLSearchParams(query)}` : url;
  const headers: Record<string, string> = {
    ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(authCookie ? { Cookie: authCookie } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  const res = await fetch(fullUrl, { ...init, headers });
  const text = await res.text();
  let body: T;
  try { body = JSON.parse(text) as T; } catch { body = text as unknown as T; }
  const raw = res.headers.get('set-cookie') ?? '';
  const match = raw.match(/auth_token=([^;]+)/);
  if (match) authCookie = `auth_token=${match[1]}`;
  return { status: res.status, body };
}

function ok(label: string, status: number, expected = 200) {
  const pass = status === expected || (expected === 200 && status === 201);
  console.log(`  ${pass ? '✓' : '✗'} ${label} (${status})`);
  if (!pass) throw new Error(`Expected ${expected}, got ${status} — ${label}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assignNodeIds(nodes: unknown[]): unknown[] {
  return nodes.map(n => {
    const node = n as Record<string, unknown>;
    const existing = node.id as string | undefined;
    const id = existing && UUID_RE.test(existing) ? existing : crypto.randomUUID();
    const children = Array.isArray(node.children) ? assignNodeIds(node.children) : node.children;
    return { ...node, id, children };
  });
}

function toLabel(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^\w/, c => c.toUpperCase());
}

function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

// ── Step 1: Auth ──────────────────────────────────────────────────────────────

async function authenticate(): Promise<void> {
  console.log('\n── Step 1: Auth ─────────────────────────────────────────────');
  const login = await api<{ user?: unknown; error?: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASS }),
  });
  ok('Login', login.status, 200);
  console.log(`  Logged in as: ${SEED_EMAIL}`);
}

// ── Step 2: Delete all projects ───────────────────────────────────────────────

async function deleteAllProjects(): Promise<string> {
  console.log('\n── Step 2: Clearing existing projects ───────────────────────');
  const wsRes = await api<{ workspaces: Array<{ id: string; name: string }> }>('/workspaces');
  ok('List workspaces', wsRes.status, 200);

  let workspaceId: string;
  if (!wsRes.body.workspaces?.length) {
    const ws = await api<{ workspace: { id: string } }>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Workspace' }),
    });
    ok('Create workspace', ws.status, 201);
    workspaceId = ws.body.workspace.id;
    console.log(`  Created workspace: ${workspaceId}`);
    return workspaceId;
  }

  workspaceId = wsRes.body.workspaces[0].id;
  console.log(`  Workspace: ${wsRes.body.workspaces[0].name} (${workspaceId})`);

  const projRes = await api<{ projects: Array<{ id: string; name: string }> }>(
    `/workspaces/${workspaceId}/projects`,
  );
  ok('List projects', projRes.status, 200);
  const projects = projRes.body.projects ?? [];

  if (!projects.length) {
    console.log('  No existing projects to delete.');
    return workspaceId;
  }

  for (const p of projects) {
    const del = await api(`/projects/${p.id}`, { method: 'DELETE' });
    console.log(`  ${del.status === 200 || del.status === 204 ? '✓' : '✗'} Deleted "${p.name}" (${p.id}) → ${del.status}`);
  }

  return workspaceId;
}

// ── Step 3: Create project ────────────────────────────────────────────────────

async function createProject(workspaceId: string): Promise<string> {
  console.log('\n── Step 3: Create project ───────────────────────────────────');
  const proj = await api<{ project: { id: string } }>(`/workspaces/${workspaceId}/projects`, {
    method: 'POST',
    body: JSON.stringify({ name: PROJECT_NAME }),
  });
  ok('Create project', proj.status, 201);
  const projectId = proj.body.project.id;
  console.log(`  Project ID: ${projectId}`);
  return projectId;
}

// ── Step 4: Build + save frontend config ─────────────────────────────────────

function buildConfigBlob(): Record<string, unknown> {
  console.log('\n── Step 4: Building frontend config ─────────────────────────');

  const routesJson = readJson<{ routes: Array<{ path: string; config?: string }> }>(
    path.join(SOURCE_DIR, 'routes.json'),
  );
  const routeMap = new Map<string, string>(
    routesJson.routes.filter(r => r.config).map(r => [r.config!, r.path]),
  );
  const routeOrderMap = new Map<string, number>();
  routesJson.routes.forEach((r, i) => { if (r.config) routeOrderMap.set(r.config, i); });

  const screensDir = path.join(SOURCE_DIR, 'screens');
  const screenFiles = fs.readdirSync(screensDir).filter(f => f.endsWith('.json')).sort((a, b) => {
    const nameA = path.basename(a, '.json');
    const nameB = path.basename(b, '.json');
    const camelA = nameA.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const camelB = nameB.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const orderA = routeOrderMap.get(camelA) ?? routeOrderMap.get(nameA) ?? 9999;
    const orderB = routeOrderMap.get(camelB) ?? routeOrderMap.get(nameB) ?? 9999;
    if (orderA !== orderB) return orderA - orderB;
    return nameA.localeCompare(nameB);
  });

  const CANVAS_PAGE_WIDTH = 1280;
  const CANVAS_PAGE_GAP = 80;

  const pages = screenFiles.map((file, idx) => {
    const name = path.basename(file, '.json');
    const screen = readJson<Record<string, unknown>>(path.join(screensDir, file));
    const camelName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const route = routeMap.get(camelName) ?? routeMap.get(name)
      ?? `/${name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')}`;
    const raw = screen.content ?? screen.ui ?? null;
    const rawNodes: unknown[] = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    const nodes = assignNodeIds(rawNodes);
    const meta = screen.meta as Record<string, unknown> | undefined;
    return {
      id: `page-${name}`,
      name: toLabel(camelName),
      route,
      nodes,
      wx: idx * (CANVAS_PAGE_WIDTH + CANVAS_PAGE_GAP),
      wy: 0,
      ...(meta ? { meta } : {}),
    };
  });
  console.log(`  Pages: ${pages.length}`);

  const actionsDir = path.join(SOURCE_DIR, 'actions');
  const actionFiles = fs.readdirSync(actionsDir).filter(f => f.endsWith('.json')).sort();
  const workflows: Record<string, unknown> = {};
  for (const file of actionFiles) {
    const actions = readJson<Record<string, Record<string, unknown>>>(path.join(actionsDir, file));
    for (const [id, def] of Object.entries(actions)) {
      if (!workflows[id]) workflows[id] = def;
    }
  }

  const sharedComponents = readJson<Record<string, {
    name?: string;
    workflows?: Record<string, { trigger: string; steps: unknown[]; name?: string }>;
  }>>(path.join(SOURCE_DIR, 'shared-components.json'));

  for (const [, scModel] of Object.entries(sharedComponents)) {
    for (const [wfId, wf] of Object.entries(scModel.workflows ?? {})) {
      if (!workflows[wfId]) {
        workflows[wfId] = {
          id: wfId,
          name: scModel.name ? `${scModel.name} — ${wf.name ?? wfId}` : (wf.name ?? wfId),
          trigger: wf.trigger ?? 'execution',
          steps: wf.steps ?? [],
        };
      }
    }
  }
  console.log(`  Workflows: ${Object.keys(workflows).length}`);

  type VarDef = { label?: string; type?: string; initialValue?: unknown; folder?: string; saveInLocalStorage?: boolean; fields?: unknown };
  const varsJson = readJson<{ variables: Record<string, VarDef>; varFolders: Array<{ id: string; label: string }> }>(
    path.join(SOURCE_DIR, 'variables.json'),
  );
  const customVars = Object.entries(varsJson.variables ?? {}).map(([uuid, def]) => ({
    id: uuid, name: uuid, label: def.label ?? uuid, type: def.type ?? 'string',
    initialValue: def.initialValue,
    ...(def.folder ? { folderId: def.folder } : {}),
    ...(def.saveInLocalStorage ? { saveInLocalStorage: true } : {}),
    ...(def.fields ? { fields: def.fields } : {}),
  }));
  const varFolders = (varsJson.varFolders ?? []).map(f => ({ id: f.id, name: f.label }));
  console.log(`  Variables: ${customVars.length}`);

  type DsDef = {
    folder?: string; label?: string; type: 'rest' | 'graphql'; url?: string; endpoint?: string;
    method?: string; headers?: Record<string, unknown> | Array<{ key: string; value: string; enabled: boolean }>;
    queryParams?: unknown[]; proxy?: boolean; sendCredentials?: boolean; query?: string;
    variables?: unknown; skipStoreWhenNull?: boolean; cacheTag?: string; cacheTTL?: number; cacheKeyVars?: string[];
  };
  const dsJson = readJson<Record<string, DsDef>>(path.join(SOURCE_DIR, 'datasources.json'));
  const folderNameToId = new Map<string, string>();
  for (const def of Object.values(dsJson)) {
    if (def.folder && !folderNameToId.has(def.folder)) {
      folderNameToId.set(def.folder, `cfg-folder-${def.folder.toLowerCase().replace(/\s+/g, '-')}`);
    }
  }
  const normalizeHeaders = (h: DsDef['headers']): Array<{ key: string; value: string; enabled: boolean }> => {
    if (!h) return [];
    if (Array.isArray(h)) return h;
    return Object.entries(h).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value), enabled: true }));
  };

  // Rewrite hardcoded /v1/run/<old-project-id>/path → relative /path
  // so datasources work regardless of which project ID the seed creates.
  // The SDUI engine resolves relative URLs to {backendUrl}/v1/run/{currentProjectId}/path.
  // Non-string values (formula objects, undefined) are passed through unchanged.
  const normalizeUrl = (url: unknown): unknown => {
    if (typeof url !== 'string') return url ?? '';
    const m = url.match(/\/v1\/run\/[a-z0-9]+(\/.+)$/);
    if (m) return m[1]; // e.g. "/cart", "/shop/products"
    return url;
  };

  const pageDataSources = Object.entries(dsJson).map(([uuid, def]) => {
    const folderId = def.folder ? folderNameToId.get(def.folder) : undefined;
    const base = {
      id: uuid, storeIn: uuid,
      ...(folderId ? { folderId } : {}),
      ...(def.label ? { _label: def.label } : {}),
      ...(def.skipStoreWhenNull ? { skipStoreWhenNull: true } : {}),
      ...(def.cacheTag ? { cacheTag: def.cacheTag } : {}),
      ...(def.cacheTTL != null ? { cacheTTL: def.cacheTTL } : {}),
      ...(def.cacheKeyVars ? { cacheKeyVars: def.cacheKeyVars } : {}),
    };
    if (def.type === 'graphql') {
      const opMatch = def.query?.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/i);
      return { ...base, type: 'graphql' as const, url: def.endpoint ?? '', method: 'POST' as const, headers: normalizeHeaders(def.headers), responsePath: '', proxy: false, sendCredentials: false, query: def.query ?? '', ...(def.variables ? { variables: JSON.stringify(def.variables, null, 2) } : {}), _operationName: opMatch?.[1] ?? uuid };
    }
    return { ...base, type: 'rest' as const, url: normalizeUrl(def.url), method: def.method ?? 'GET', headers: normalizeHeaders(def.headers), queryParams: def.queryParams ?? [], responsePath: '', proxy: def.proxy ?? false, sendCredentials: def.sendCredentials ?? false };
  });
  const dsFolders = Array.from(folderNameToId.entries()).map(([name, id]) => ({ id, name, parentId: null }));
  console.log(`  DataSources: ${pageDataSources.length}`);

  const colorsJson = readJson<{ customColors?: unknown[]; colorFolders?: unknown[] }>(path.join(SOURCE_DIR, 'custom-colors.json'));
  const customColors = colorsJson.customColors ?? [];
  const colorFolders = colorsJson.colorFolders ?? [];

  const themeJson = readJson<{ cssVariables?: { root?: Record<string, string>; dark?: Record<string, string> }; fonts?: { heading?: string; body?: string } }>(path.join(SOURCE_DIR, 'theme.json'));
  const stripDashes = (obj: Record<string, string> = {}) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.replace(/^--/, ''), v]));
  const themeOverrides: Record<string, string> = { ...stripDashes(themeJson.cssVariables?.root ?? {}) };
  const themeDarkOverrides: Record<string, string> = { ...stripDashes(themeJson.cssVariables?.dark ?? {}) };
  if (themeJson.fonts?.heading) themeOverrides['font-heading'] = themeJson.fonts.heading;
  if (themeJson.fonts?.body) themeOverrides['font-body'] = themeJson.fonts.body;
  console.log(`  Theme: ${Object.keys(themeOverrides).length} vars, dark: ${Object.keys(themeDarkOverrides).length} vars`);

  const formulas = readJson<Record<string, unknown>>(path.join(SOURCE_DIR, 'formulas.json'));
  console.log(`  Formulas: ${Object.keys(formulas).length}, SharedComponents: ${Object.keys(sharedComponents).length}`);

  return { pages, workflows, customVars, varFolders, pageDataSources, dsFolders, customColors, colorFolders, themeOverrides, themeDarkOverrides, formulas, sharedComponents };
}

async function saveConfig(projectId: string, blob: Record<string, unknown>): Promise<void> {
  const res = await api<{ ok?: boolean; error?: string }>(`/projects/${projectId}/config`, {
    method: 'PATCH',
    body: JSON.stringify(blob),
  });
  ok('PATCH /config', res.status, 200);
  console.log('  Config saved.');
}

// ── Step 5: Seed backend Vendure data ─────────────────────────────────────────

function seedBackend(projectId: string): void {
  console.log('\n── Step 5: Seeding backend (Vendure data model) ─────────────');
  const scriptPath = path.join(BACKEND_REPO, 'src/scripts/seed-vendure-store.ts');
  if (!fs.existsSync(scriptPath)) {
    console.warn(`  ⚠ Backend seed script not found at ${scriptPath} — skipping.`);
    return;
  }
  execSync(`npx tsx "${scriptPath}" --projectId ${projectId}`, {
    cwd: BACKEND_REPO,
    stdio: 'inherit',
  });
}

// ── Step 6: Import models from tables ─────────────────────────────────────────

async function importModels(projectId: string): Promise<void> {
  console.log('\n── Step 6: Importing models from tables ─────────────────────');
  const res = await api<{ imported: string[]; skipped: string[]; warnings: string[] }>(
    `/projects/${projectId}/models/import-from-tables`,
    { method: 'POST' },
  );
  if (res.status !== 200) {
    console.warn(`  ⚠ import-from-tables returned ${res.status} — models may be incomplete`);
    return;
  }
  const { imported, skipped, warnings } = res.body;
  console.log(`  ✓ Imported: ${imported.length} models`);
  if (skipped.length)   console.log(`  ~ Skipped:  ${skipped.length} (already exist or invalid)`);
  if (warnings.length)  warnings.forEach(w => console.log(`  ⚠ ${w}`));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Full Seed (Frontend + Backend)             ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Backend:    ${BASE}`);
  console.log(`  Account:    ${SEED_EMAIL}`);
  console.log(`  Project:    ${PROJECT_NAME}`);
  console.log(`  Config:     ${SOURCE_DIR}`);
  console.log(`  Backend repo: ${BACKEND_REPO}`);

  await authenticate();
  const workspaceId = await deleteAllProjects();
  const projectId   = await createProject(workspaceId);
  const blob        = buildConfigBlob();
  await saveConfig(projectId, blob);
  seedBackend(projectId);
  await importModels(projectId);

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   All done!                                  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`
  Project:  ${PROJECT_NAME}
  ID:       ${projectId}

  Builder URL:  http://localhost:3000/builder/${projectId}
`);
}

main().catch(err => {
  console.error('\n✗ Seed failed:', err.message ?? err);
  process.exit(1);
});
