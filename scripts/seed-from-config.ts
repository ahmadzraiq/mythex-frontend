#!/usr/bin/env npx tsx
/**
 * scripts/seed-from-config.ts
 *
 * Seeds a builder project from the legacy config folder (~/Desktop/config):
 *   1. Login to an existing account
 *   2. Get or create a workspace
 *   3. Create a new project
 *   4. Build the builder config blob from SOURCE_DIR
 *   5. PATCH /v1/projects/:id/config with the full blob
 *
 * Usage:
 *   cd /Users/ahmadzraiq/Desktop/mythex-frontend
 *   npx tsx scripts/seed-from-config.ts
 *
 * Env overrides:
 *   SEED_EMAIL          (default: ahmadzraiqq@gmail.com)
 *   SEED_PASSWORD       (default: asdASDasd582617!)
 *   SEED_PROJECT_NAME   (default: Vendure Store)
 *   SOURCE_DIR          (default: /Users/ahmadzraiq/Desktop/config)
 *   BACKEND_URL         (default: http://localhost:4000)
 */

import * as fs from 'fs';
import * as path from 'path';

const BASE         = process.env.BACKEND_URL      ?? 'http://localhost:4000';
const V1           = `${BASE}/v1`;
const SEED_EMAIL   = process.env.SEED_EMAIL       ?? 'ahmadzraiqq@gmail.com';
const SEED_PASS    = process.env.SEED_PASSWORD    ?? 'asdASDasd582617!';
const PROJECT_NAME = process.env.SEED_PROJECT_NAME ?? 'Vendure Store';
const SOURCE_DIR   = process.env.SOURCE_DIR        ?? '/Users/ahmadzraiq/Desktop/config';

// ── HTTP helper ───────────────────────────────────────────────────────────────

let authCookie = '';

async function api<T = unknown>(
  path: string,
  options: RequestInit & { query?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const url  = path.startsWith('http') ? path : `${V1}${path}`;
  const { query, ...init } = options;
  const fullUrl = query ? `${url}?${new URLSearchParams(query)}` : url;

  const headers: Record<string, string> = {
    ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(authCookie ? { Cookie: authCookie } : {}),
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };

  const res  = await fetch(fullUrl, { ...init, headers });
  const text = await res.text();
  let body: T;
  try { body = JSON.parse(text) as T; } catch { body = text as unknown as T; }

  const raw   = res.headers.get('set-cookie') ?? '';
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
    const children = Array.isArray(node.children)
      ? assignNodeIds(node.children)
      : node.children;
    return { ...node, id, children };
  });
}

function toLabel(s: string): string {
  return s
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

// ── Step 2: Workspace + Project ───────────────────────────────────────────────

async function createProject(): Promise<{ workspaceId: string; projectId: string }> {
  console.log('\n── Step 2: Workspace + Project ──────────────────────────────');

  const wsListRes = await api<{ workspaces: Array<{ id: string; name: string }> }>('/workspaces');
  ok('List workspaces', wsListRes.status, 200);

  let workspaceId: string;
  if (wsListRes.body.workspaces && wsListRes.body.workspaces.length > 0) {
    workspaceId = wsListRes.body.workspaces[0].id;
    console.log(`  Using existing workspace: ${wsListRes.body.workspaces[0].name} (${workspaceId})`);
  } else {
    const ws = await api<{ workspace: { id: string } }>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Workspace' }),
    });
    ok('Create workspace', ws.status, 201);
    workspaceId = ws.body.workspace.id;
    console.log(`  Created workspace: ${workspaceId}`);
  }

  const proj = await api<{ project: { id: string } }>(`/workspaces/${workspaceId}/projects`, {
    method: 'POST',
    body: JSON.stringify({ name: PROJECT_NAME }),
  });
  ok('Create project', proj.status, 201);
  const projectId = proj.body.project.id;
  console.log(`  Project ID: ${projectId}`);

  return { workspaceId, projectId };
}

// ── Step 3: Build config blob ─────────────────────────────────────────────────

function buildConfigBlob(): Record<string, unknown> {
  console.log('\n── Step 3: Building config blob ─────────────────────────────');

  // ── routes ──────────────────────────────────────────────────────────────────
  const routesJson = readJson<{ routes: Array<{ path: string; config?: string }> }>(
    path.join(SOURCE_DIR, 'routes.json'),
  );
  const routeMap = new Map<string, string>(
    routesJson.routes.filter(r => r.config).map(r => [r.config!, r.path]),
  );

  // ── pages from screens/*.json ────────────────────────────────────────────────
  const screensDir = path.join(SOURCE_DIR, 'screens');
  const allScreenFiles = fs.readdirSync(screensDir).filter(f => f.endsWith('.json'));

  // Build a route-order map: config name → position in routes.json
  const routeOrderMap = new Map<string, number>();
  routesJson.routes.forEach((r, i) => { if (r.config) routeOrderMap.set(r.config, i); });

  // Sort screen files by routes.json order first, then alphabetically for unlisted
  const screenFiles = allScreenFiles.sort((a, b) => {
    const nameA = path.basename(a, '.json');
    const nameB = path.basename(b, '.json');
    const camelA = nameA.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const camelB = nameB.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const orderA = routeOrderMap.get(camelA) ?? routeOrderMap.get(nameA) ?? 9999;
    const orderB = routeOrderMap.get(camelB) ?? routeOrderMap.get(nameB) ?? 9999;
    if (orderA !== orderB) return orderA - orderB;
    return nameA.localeCompare(nameB);
  });

  // Desktop viewport = 1280px, PAGE_GAP = 80px (matches builder _canvas-hooks.ts)
  const CANVAS_PAGE_WIDTH = 1280;
  const CANVAS_PAGE_GAP   = 80;

  const pages = screenFiles.map((file, idx) => {
    const name   = path.basename(file, '.json');
    const screen = readJson<Record<string, unknown>>(path.join(screensDir, file));

    // route: prefer routes.json match on camelCase name or kebab-name, fallback
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
  console.log(`  Pages: ${pages.length} (from screens/)`);

  // ── workflows from all actions/*.json ────────────────────────────────────────
  const actionsDir = path.join(SOURCE_DIR, 'actions');
  const actionFiles = fs.readdirSync(actionsDir).filter(f => f.endsWith('.json')).sort();

  const workflows: Record<string, unknown> = {};
  for (const file of actionFiles) {
    const actions = readJson<Record<string, Record<string, unknown>>>(
      path.join(actionsDir, file),
    );
    for (const [id, def] of Object.entries(actions)) {
      if (!workflows[id]) {
        workflows[id] = def;
      }
    }
  }

  // Add shared-component workflows if not already present
  const sharedComponents = readJson<Record<string, {
    name?: string;
    workflows?: Record<string, { trigger: string; steps: unknown[]; name?: string }>;
  }>>(path.join(SOURCE_DIR, 'shared-components.json'));

  for (const [, scModel] of Object.entries(sharedComponents)) {
    const scName = scModel.name ?? '';
    for (const [wfId, wf] of Object.entries(scModel.workflows ?? {})) {
      if (!workflows[wfId]) {
        workflows[wfId] = {
          id: wfId,
          name: scName ? `${scName} — ${wf.name ?? wfId}` : (wf.name ?? wfId),
          trigger: wf.trigger ?? 'execution',
          steps: wf.steps ?? [],
        };
      }
    }
  }
  console.log(`  Workflows: ${Object.keys(workflows).length} (from ${actionFiles.length} action files + SC workflows)`);

  // ── customVars / varFolders ──────────────────────────────────────────────────
  type VarDef = {
    label?: string;
    type?: string;
    initialValue?: unknown;
    folder?: string;
    saveInLocalStorage?: boolean;
    fields?: unknown;
  };
  const varsJson = readJson<{
    variables: Record<string, VarDef>;
    varFolders: Array<{ id: string; label: string }>;
  }>(path.join(SOURCE_DIR, 'variables.json'));

  const customVars = Object.entries(varsJson.variables ?? {}).map(([uuid, def]) => ({
    id: uuid,
    name: uuid,
    label: def.label ?? uuid,
    type: def.type ?? 'string',
    initialValue: def.initialValue,
    ...(def.folder ? { folderId: def.folder } : {}),
    ...(def.saveInLocalStorage ? { saveInLocalStorage: true } : {}),
    ...(def.fields ? { fields: def.fields } : {}),
  }));

  const varFolders = (varsJson.varFolders ?? []).map(f => ({
    id: f.id,
    name: f.label,
  }));
  console.log(`  Variables: ${customVars.length}, folders: ${varFolders.length}`);

  // ── pageDataSources / dsFolders ──────────────────────────────────────────────
  type DsDef = {
    folder?: string;
    label?: string;
    type: 'rest' | 'graphql';
    url?: string;
    endpoint?: string;
    method?: string;
    headers?: Record<string, unknown> | Array<{ key: string; value: string; enabled: boolean }>;
    queryParams?: unknown[];
    proxy?: boolean;
    sendCredentials?: boolean;
    query?: string;
    variables?: unknown;
    skipStoreWhenNull?: boolean;
    cacheTag?: string;
    cacheTTL?: number;
    cacheKeyVars?: string[];
  };

  const dsJson = readJson<Record<string, DsDef>>(path.join(SOURCE_DIR, 'datasources.json'));

  const folderNameToId = new Map<string, string>();
  for (const def of Object.values(dsJson)) {
    if (def.folder && !folderNameToId.has(def.folder)) {
      folderNameToId.set(def.folder, `cfg-folder-${def.folder.toLowerCase().replace(/\s+/g, '-')}`);
    }
  }

  const pageDataSources = Object.entries(dsJson).map(([uuid, def]) => {
    const folderId = def.folder ? folderNameToId.get(def.folder) : undefined;

    const normalizeHeaders = (h: DsDef['headers']): Array<{ key: string; value: string; enabled: boolean }> => {
      if (!h) return [];
      if (Array.isArray(h)) return h;
      return Object.entries(h).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
        enabled: true,
      }));
    };

    const base = {
      id: uuid,
      storeIn: uuid,
      ...(folderId ? { folderId } : {}),
      ...(def.label ? { _label: def.label } : {}),
      ...(def.skipStoreWhenNull ? { skipStoreWhenNull: true } : {}),
      ...(def.cacheTag ? { cacheTag: def.cacheTag } : {}),
      ...(def.cacheTTL != null ? { cacheTTL: def.cacheTTL } : {}),
      ...(def.cacheKeyVars ? { cacheKeyVars: def.cacheKeyVars } : {}),
    };

    if (def.type === 'graphql') {
      const opMatch = def.query?.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/i);
      return {
        ...base,
        type: 'graphql' as const,
        url: def.endpoint ?? '',
        method: 'POST' as const,
        headers: normalizeHeaders(def.headers),
        responsePath: '',
        proxy: false,
        sendCredentials: false,
        query: def.query ?? '',
        ...(def.variables ? { variables: JSON.stringify(def.variables, null, 2) } : {}),
        _operationName: opMatch?.[1] ?? uuid,
      };
    }

    return {
      ...base,
      type: 'rest' as const,
      url: def.url ?? '',
      method: def.method ?? 'GET',
      headers: normalizeHeaders(def.headers),
      queryParams: def.queryParams ?? [],
      responsePath: '',
      proxy: def.proxy ?? false,
      sendCredentials: def.sendCredentials ?? false,
    };
  });

  const dsFolders = Array.from(folderNameToId.entries()).map(([name, id]) => ({
    id,
    name,
    parentId: null,
  }));
  console.log(`  DataSources: ${pageDataSources.length}, ds folders: ${dsFolders.length}`);

  // ── customColors / colorFolders ──────────────────────────────────────────────
  const colorsJson = readJson<{ customColors?: unknown[]; colorFolders?: unknown[] }>(
    path.join(SOURCE_DIR, 'custom-colors.json'),
  );
  const customColors  = colorsJson.customColors  ?? [];
  const colorFolders  = colorsJson.colorFolders  ?? [];
  console.log(`  CustomColors: ${(customColors as unknown[]).length}, color folders: ${(colorFolders as unknown[]).length}`);

  // ── themeOverrides / themeDarkOverrides ──────────────────────────────────────
  // theme.json stores cssVariables with "--" prefixed keys.
  // The builder store expects BARE keys (e.g. "primary", not "--primary").
  // _applyLightOverrides re-adds "--" when injecting CSS.
  const themeJson = readJson<{
    cssVariables?: { root?: Record<string, string>; dark?: Record<string, string> };
    fonts?: { heading?: string; body?: string };
  }>(path.join(SOURCE_DIR, 'theme.json'));

  const stripDashes = (obj: Record<string, string> = {}) =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k.replace(/^--/, ''), v]),
    );

  const themeOverrides: Record<string, string> = {
    ...stripDashes(themeJson.cssVariables?.root ?? {}),
  };
  const themeDarkOverrides: Record<string, string> = {
    ...stripDashes(themeJson.cssVariables?.dark ?? {}),
  };

  // Inject font selections so the Theme tab font dropdowns show correctly
  if (themeJson.fonts?.heading) themeOverrides['font-heading'] = themeJson.fonts.heading;
  if (themeJson.fonts?.body)    themeOverrides['font-body']    = themeJson.fonts.body;

  console.log(`  ThemeOverrides: ${Object.keys(themeOverrides).length} vars, dark: ${Object.keys(themeDarkOverrides).length} vars`);

  // ── formulas ─────────────────────────────────────────────────────────────────
  const formulas = readJson<Record<string, unknown>>(path.join(SOURCE_DIR, 'formulas.json'));
  console.log(`  Formulas: ${Object.keys(formulas).length}`);

  // ── sharedComponents ─────────────────────────────────────────────────────────
  console.log(`  SharedComponents: ${Object.keys(sharedComponents).length}`);

  return {
    pages,
    workflows,
    customVars,
    varFolders,
    pageDataSources,
    dsFolders,
    customColors,
    colorFolders,
    themeOverrides,
    themeDarkOverrides,
    formulas,
    sharedComponents,
  };
}

// ── Step 4: PATCH config ──────────────────────────────────────────────────────

async function saveConfig(projectId: string, blob: Record<string, unknown>): Promise<void> {
  console.log('\n── Step 4: Saving config ────────────────────────────────────');
  const res = await api<{ ok?: boolean; error?: string }>(`/projects/${projectId}/config`, {
    method: 'PATCH',
    body: JSON.stringify(blob),
  });
  ok('PATCH /config', res.status, 200);
  console.log('  Config saved successfully.');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   Seed from Config Script                    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Backend:    ${BASE}`);
  console.log(`  Account:    ${SEED_EMAIL}`);
  console.log(`  Project:    ${PROJECT_NAME}`);
  console.log(`  Source:     ${SOURCE_DIR}`);

  await authenticate();
  const { projectId } = await createProject();
  const blob = buildConfigBlob();
  await saveConfig(projectId, blob);

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Done!                                      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`
  Project:  ${PROJECT_NAME}
  ID:       ${projectId}

  Builder URL:  http://localhost:3001/builder/${projectId}
  Config URL:   ${BASE}/v1/projects/${projectId}/config

  Counts:
    Pages:           ${(blob.pages as unknown[]).length}
    Workflows:       ${Object.keys(blob.workflows as object).length}
    Variables:       ${(blob.customVars as unknown[]).length}
    DataSources:     ${(blob.pageDataSources as unknown[]).length}
    SharedComponents:${Object.keys(blob.sharedComponents as object).length}
    CustomColors:    ${(blob.customColors as unknown[]).length}
    ThemeOverrides:  ${Object.keys(blob.themeOverrides as object).length}
`);
}

main().catch(err => {
  console.error('\n✗ Seed failed:', err.message ?? err);
  process.exit(1);
});
