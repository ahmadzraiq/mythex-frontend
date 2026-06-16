/**
 * Virtual File System for the Builder
 *
 * Projects the Zustand store as a navigable virtual file tree following
 * developer-familiar folder conventions:
 *
 *   config/
 *     routes.json
 *     design/        theme + colors
 *     store/         global variables (app state) — folder-grouped
 *     utils/         global formulas (pure functions) — folder-grouped
 *     workflows/     global reusable workflows — folder-grouped
 *     triggers/      app-level lifecycle triggers
 *     data/          datasources — folder-grouped
 *     components/    shared components, each with optional sub-folders:
 *                      store/ utils/ workflows/ triggers/
 *     pages/         one folder per page:
 *                      page.json, groups/, workflows/, triggers/
 *
 * The same pattern (store/ utils/ workflows/ triggers/) repeats inside
 * components and pages — developers always know what each folder means.
 *
 * Public API:
 *   buildFileTree(store)                  → VirtualFolder root
 *   readVirtualFile(store, path)          → pretty JSON string
 *   applyVirtualFile(store, path, json)   → { ok, error? }
 *   pageToScreenJson(page)                → { meta, ui }
 */

import type {
  BuilderStore,
  BuilderPage,
  DataSourceConfig,
  CustomVar,
  GlobalFormulaDef,
  WorkflowMeta,
  Folder,
} from './_store-types';
import type { SDUINode } from '@/lib/sdui/types/node';
import {
  getSharedComponents,
  updateSharedComponent,
  deleteSharedComponent,
} from '@/lib/builder/shared-component-data';
import type { SharedComponentModel } from '@/lib/builder/shared-component-data';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface VirtualFile {
  kind: 'file';
  name: string;
  /** Logical address used as key for read/apply, e.g. "pages/home/groups/Hero" */
  path: string;
  icon: 'page' | 'routes' | 'data' | 'theme' | 'variable' | 'formula' | 'workflow' | 'trigger' | 'component' | 'group' | 'color';
}

export interface VirtualFolder {
  kind: 'folder';
  name: string;
  path: string;
  children: VirtualEntry[];
}

export type VirtualEntry = VirtualFolder | VirtualFile;

export interface ApplyResult {
  ok: boolean;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function vfile(name: string, path: string, icon: VirtualFile['icon']): VirtualFile {
  return { kind: 'file', name, path, icon };
}

function vfolder(name: string, path: string, children: VirtualEntry[]): VirtualFolder {
  return { kind: 'folder', name, path, children };
}

/**
 * Group an array of items into a folder subtree by a string folder name.
 * Items with no folder go at the top level of `basePath`.
 * Items with a folder go under `basePath/<folderName>/`.
 */
function groupByFolder<T>(
  items: T[],
  getFolder: (item: T) => string | undefined,
  getName: (item: T) => string,
  getPath: (item: T, folderPrefix: string) => string,
  getIcon: (item: T) => VirtualFile['icon'],
  basePath: string,
): VirtualEntry[] {
  const grouped = new Map<string | null, VirtualFile[]>();
  for (const item of items) {
    const folder = getFolder(item) ?? null;
    if (!grouped.has(folder)) grouped.set(folder, []);
    const prefix = folder ? `${basePath}/${folder}` : basePath;
    grouped.get(folder)!.push(vfile(`${getName(item)}.json`, getPath(item, prefix), getIcon(item)));
  }

  const result: VirtualEntry[] = [];
  // Ungrouped items first
  for (const f of grouped.get(null) ?? []) result.push(f);
  // Then each folder, sorted alphabetically
  for (const [folderName, files] of [...grouped.entries()].filter(([k]) => k !== null).sort(([a], [b]) => (a! < b! ? -1 : 1))) {
    result.push(vfolder(folderName!, `${basePath}/${folderName}`, files));
  }
  return result;
}

/**
 * Build folder subtree for items grouped by a Folder[] store + folderId on items.
 */
function groupByFolderStore<T>(
  items: T[],
  folders: Folder[],
  getFolderId: (item: T) => string | undefined,
  getName: (item: T) => string,
  getPath: (item: T, folderPrefix: string) => string,
  getIcon: (item: T) => VirtualFile['icon'],
  basePath: string,
): VirtualEntry[] {
  const folderMap = new Map<string, string>(folders.map(f => [f.id, f.name]));
  return groupByFolder(
    items,
    item => {
      const fid = getFolderId(item);
      return fid ? (folderMap.get(fid) ?? undefined) : undefined;
    },
    getName,
    getPath,
    getIcon,
    basePath,
  );
}

// ─── buildFileTree ────────────────────────────────────────────────────────────

export function buildFileTree(store: BuilderStore): VirtualFolder {
  const children: VirtualEntry[] = [
    // routes.json
    vfile('routes.json', 'routes', 'routes'),

    // design/
    vfolder('design', 'design', [
      vfile('theme.json', 'design/theme', 'theme'),
      vfile('colors.json', 'design/colors', 'color'),
    ]),

    // store/ (global variables, grouped by varFolder)
    buildStoreFolder(store),

    // utils/ (global formulas, grouped by .folder string)
    buildUtilsFolder(store),

    // workflows/ (global reusable workflows, grouped by .folder string)
    buildWorkflowsFolder(store),

    // triggers/ (app-level triggers: isAppTrigger === true)
    buildTriggersFolder(store),

    // data/ (datasources, grouped by dsFolders)
    buildDataFolder(store),

    // components/ (shared components, per-model sub-trees)
    buildComponentsFolder(),

    // pages/ (one sub-folder per page)
    buildPagesFolder(store),
  ].filter(Boolean) as VirtualEntry[];

  return { kind: 'folder', name: 'config', path: '', children };
}

// ── store/ ────────────────────────────────────────────────────────────────────

function buildStoreFolder(store: BuilderStore): VirtualFolder {
  const vars = store.customVars as CustomVar[];
  const folders = store.varFolders as Folder[];
  const children = groupByFolderStore(
    vars,
    folders,
    v => v.folderId,
    v => v.label ?? v.name,
    (v, prefix) => `${prefix}/${v.name}`,
    () => 'variable',
    'store',
  );
  return vfolder('store', 'store', children);
}

// ── utils/ ────────────────────────────────────────────────────────────────────

function buildUtilsFolder(store: BuilderStore): VirtualFolder {
  const formulas = Object.entries(store.globalFormulas as Record<string, GlobalFormulaDef>);
  const children = groupByFolder(
    formulas,
    ([, def]) => def.folder,
    ([name]) => name,
    ([name, def], prefix) => `${prefix}/${def.folder ? name : name}`,
    () => 'formula',
    'utils',
  );
  return vfolder('utils', 'utils', children);
}

// ── workflows/ ────────────────────────────────────────────────────────────────

/**
 * Domain name → page name alias for cases where the config/actions/ file name
 * doesn't exactly match the page name (e.g., "products" domain → "product" page).
 */
const DOMAIN_ALIASES: Record<string, string> = {
  products: 'product',
  datasource_actions: '_internal',
  'datasource-actions': '_internal',
};

/** Return the page name that "claims" a domain, or null if unmatched. */
function domainPageName(domain: string, pages: BuilderPage[]): string | null {
  const target = DOMAIN_ALIASES[domain] ?? domain;
  return pages.find(p => p.name === target)?.name ?? null;
}

function buildWorkflowsFolder(store: BuilderStore): VirtualFolder {
  // Global reusable workflows (globalWorkflowMeta)
  const meta = store.globalWorkflowMeta as Record<string, WorkflowMeta>;
  const reusable = Object.entries(meta).filter(([, m]) => !m.isAppTrigger && !m.isTrigger && !m.isSystem);
  const children: VirtualEntry[] = groupByFolder(
    reusable,
    ([, m]) => m.folder,
    ([, m]) => m.name,
    ([id, m], prefix) => `${prefix}/${m.name || id}`,
    () => 'workflow',
    'workflows',
  );

  // Unmatched domain subfolders — pageWorkflowGroups entries whose domain
  // name doesn't correspond to any existing page go here as domain subfolders.
  const groups = store.pageWorkflowGroups ?? {};
  const claimedDomains = new Set(
    Object.keys(groups).filter(d => domainPageName(d, store.pages) !== null),
  );
  const pageMeta = store.pageWorkflowMeta as Record<string, WorkflowMeta>;

  for (const domain of Object.keys(groups).sort()) {
    if (claimedDomains.has(domain)) continue;
    const ids = groups[domain] ?? [];
    const files: VirtualFile[] = ids.map(id =>
      vfile(`${pageMeta[id]?.name ?? id}.json`, `workflows/${domain}/${id}`, 'workflow'),
    );
    if (files.length > 0) {
      children.push(vfolder(domain, `workflows/${domain}`, files));
    }
  }

  return vfolder('workflows', 'workflows', children);
}

// ── triggers/ ─────────────────────────────────────────────────────────────────

function buildTriggersFolder(store: BuilderStore): VirtualFolder {
  // App-level triggers are stored in pageWorkflowMeta with isAppTrigger: true
  // (NOT globalWorkflowMeta which is for reusable callable workflows).
  const meta = store.pageWorkflowMeta as Record<string, WorkflowMeta>;
  const appTriggers = Object.entries(meta).filter(([, m]) => m.isAppTrigger === true);
  const children: VirtualFile[] = appTriggers.map(([id, m]) =>
    vfile(`${m.trigger ?? m.name ?? id}.json`, `triggers/${m.trigger ?? m.name ?? id}`, 'trigger'),
  );
  return vfolder('triggers', 'triggers', children);
}

// ── data/ ─────────────────────────────────────────────────────────────────────

function buildDataFolder(store: BuilderStore): VirtualFolder {
  const sources = store.pageDataSources as DataSourceConfig[];
  const folders = store.dsFolders as Folder[];
  const children = groupByFolderStore(
    sources,
    folders,
    s => s.folderId,
    s => s._label ?? s.name ?? s.id,
    (s, prefix) => `${prefix}/${s.id}`,
    () => 'data',
    'data',
  );
  return vfolder('data', 'data', children);
}

// ── components/ ───────────────────────────────────────────────────────────────

function buildComponentsFolder(): VirtualFolder {
  const allSCs = getSharedComponents();
  const byFolder = new Map<string | null, SharedComponentModel[]>();

  for (const sc of Object.values(allSCs)) {
    const key = sc.folder ?? null;
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key)!.push(sc);
  }

  const children: VirtualEntry[] = [];

  // Ungrouped components
  for (const sc of byFolder.get(null) ?? []) {
    children.push(buildSCSubTree(sc, 'components'));
  }

  // Folder-grouped components
  for (const [folderName, scs] of [...byFolder.entries()]
    .filter(([k]) => k !== null)
    .sort(([a], [b]) => (a! < b! ? -1 : 1))) {
    const folderPath = `components/${folderName}`;
    const folderChildren: VirtualEntry[] = scs.map(sc => buildSCSubTree(sc, folderPath));
    children.push(vfolder(folderName!, folderPath, folderChildren));
  }

  return vfolder('components', 'components', children);
}

function buildSCSubTree(sc: SharedComponentModel, parentPath: string): VirtualFolder {
  const base = `${parentPath}/${sc.id}`;
  const sub: VirtualEntry[] = [
    vfile('component.json', `${base}/component`, 'component'),
  ];

  // store/ (SC-internal variables)
  if (sc.variables && Object.keys(sc.variables).length > 0) {
    const varEntries = Object.entries(sc.variables);
    const varChildren = groupByFolder(
      varEntries,
      ([, v]) => v.folder,
      ([, v]) => v.label,
      ([id, v], prefix) => `${prefix}/${id}`,
      () => 'variable',
      `${base}/store`,
    );
    sub.push(vfolder('store', `${base}/store`, varChildren));
  }

  // utils/ (SC-internal formulas)
  if (sc.formulas && Object.keys(sc.formulas).length > 0) {
    const fEntries = Object.entries(sc.formulas);
    const fChildren = groupByFolder(
      fEntries,
      ([, f]) => f.folder,
      ([, f]) => f.name,
      ([id], prefix) => `${prefix}/${id}`,
      () => 'formula',
      `${base}/utils`,
    );
    sub.push(vfolder('utils', `${base}/utils`, fChildren));
  }

  // workflows/ (SC-internal workflows)
  if (sc.workflows && Object.keys(sc.workflows).length > 0) {
    const wEntries = Object.entries(sc.workflows);
    const wChildren = groupByFolder(
      wEntries,
      ([, w]) => w.folder,
      ([, w]) => w.name,
      ([id], prefix) => `${prefix}/${id}`,
      () => 'workflow',
      `${base}/workflows`,
    );
    sub.push(vfolder('workflows', `${base}/workflows`, wChildren));
  }

  // triggers/ (SC custom component events)
  if (sc.triggers && sc.triggers.length > 0) {
    const tChildren: VirtualFile[] = sc.triggers.map(t =>
      vfile(`${t.name}.json`, `${base}/triggers/${t.id}`, 'trigger'),
    );
    sub.push(vfolder('triggers', `${base}/triggers`, tChildren));
  }

  return vfolder(sc.name, base, sub);
}

// ── pages/ ────────────────────────────────────────────────────────────────────

function buildPagesFolder(store: BuilderStore): VirtualFolder {
  const pageChildren: VirtualEntry[] = store.pages.map(page =>
    buildPageSubTree(store, page),
  );
  return vfolder('pages', 'pages', pageChildren);
}

function buildPageSubTree(store: BuilderStore, page: BuilderPage): VirtualFolder {
  const base = `pages/${page.name}`;
  const sub: VirtualEntry[] = [
    vfile('page.json', `${base}/page`, 'page'),
  ];

  // groups/ — nodes with _group flag
  const groupNames = collectGroupNames(page.nodes);
  if (groupNames.length > 0) {
    const groupFiles: VirtualFile[] = groupNames.map(name =>
      vfile(`${name}.json`, `${base}/groups/${name}`, 'group'),
    );
    sub.push(vfolder('groups', `${base}/groups`, groupFiles));
  }

  // workflows/ — page-scoped (!isTrigger) from pageScope OR from the matching
  // config/actions/<domain>.json file (via pageWorkflowGroups).
  const pageWfMeta = store.pageWorkflowMeta as Record<string, WorkflowMeta>;
  const groups = store.pageWorkflowGroups ?? {};
  const domainKey = Object.keys(groups).find(
    d => domainPageName(d, store.pages) === page.name,
  );
  const domainIds = new Set<string>(domainKey ? (groups[domainKey] ?? []) : []);

  const pageWfs = Object.entries(pageWfMeta).filter(
    ([id, m]) =>
      !m.isTrigger && !m.isSystem &&
      ((m.pageScope === page.name || m.pageScope === page.route) || domainIds.has(id)),
  );
  if (pageWfs.length > 0) {
    const wfChildren = groupByFolder(
      pageWfs,
      ([, m]) => m.folder,
      ([, m]) => m.name,
      ([id, m], prefix) => `${prefix}/${m.name || id}`,
      () => 'workflow',
      `${base}/workflows`,
    );
    sub.push(vfolder('workflows', `${base}/workflows`, wfChildren));
  }

  // triggers/ — page lifecycle triggers (isTrigger === true, scoped to this page)
  const pageTriggers = Object.entries(pageWfMeta).filter(
    ([, m]) => m.isTrigger === true && (m.pageScope === page.name || m.pageScope === page.route),
  );
  if (pageTriggers.length > 0) {
    const tChildren: VirtualFile[] = pageTriggers.map(([id, m]) =>
      vfile(`${m.trigger ?? m.name ?? id}.json`, `${base}/triggers/${m.trigger ?? id}`, 'trigger'),
    );
    sub.push(vfolder('triggers', `${base}/triggers`, tChildren));
  }

  return vfolder(page.name, base, sub);
}

/** Walk a node tree and collect all unique _group values. */
function collectGroupNames(nodes: SDUINode[]): string[] {
  const seen = new Set<string>();
  function walk(n: SDUINode) {
    const g = (n as unknown as Record<string, unknown>)._group;
    if (typeof g === 'string' && g) seen.add(g);
    if (Array.isArray(n.children)) n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return [...seen];
}

// ─── readVirtualFile ──────────────────────────────────────────────────────────

export function readVirtualFile(store: BuilderStore, path: string): string {
  try {
    return JSON.stringify(resolveStoreSlice(store, path), null, 2);
  } catch (e) {
    return JSON.stringify({ error: String(e) }, null, 2);
  }
}

function resolveStoreSlice(store: BuilderStore, path: string): unknown {
  const parts = path.split('/');

  // routes
  if (path === 'routes') {
    return {
      routes: store.pages.map(p => ({ path: p.route ?? `/${p.name}`, config: p.name, name: p.name })),
    };
  }

  // design/theme
  if (path === 'design/theme') {
    return { overrides: store.themeOverrides, darkOverrides: store.themeDarkOverrides };
  }

  // design/colors
  if (path === 'design/colors') {
    return store.customColors;
  }

  // store/<folder?>/<varName>  OR  store/<varName>
  if (parts[0] === 'store') {
    const varName = parts[parts.length - 1];
    const v = (store.customVars as CustomVar[]).find(cv => cv.name === varName);
    if (!v) throw new Error(`Variable "${varName}" not found`);
    return v;
  }

  // utils/<folder?>/<formulaName>
  if (parts[0] === 'utils') {
    const name = parts[parts.length - 1];
    const f = (store.globalFormulas as Record<string, GlobalFormulaDef>)[name];
    if (!f) throw new Error(`Formula "${name}" not found`);
    return f;
  }

  // workflows/<folder?>/<workflowName>  OR  workflows/<domain>/<id> (domain subfolders)
  if (parts[0] === 'workflows') {
    const lastName = parts[parts.length - 1];
    // 3-part path: workflows/<domain>/<id> — look in pageWorkflowMeta/pageWorkflows
    if (parts.length === 3) {
      const id = lastName;
      const m = (store.pageWorkflowMeta as Record<string, WorkflowMeta>)[id];
      const steps = (store.pageWorkflows as Record<string, object[]>)[id];
      if (m || steps) return { id, meta: m ?? {}, steps: steps ?? [] };
    }
    // Default: global workflow by name
    const meta = Object.entries(store.globalWorkflowMeta as Record<string, WorkflowMeta>)
      .find(([, m]) => m.name === lastName);
    if (!meta) throw new Error(`Workflow "${lastName}" not found`);
    const [id, m] = meta;
    return { id, meta: m, steps: (store.globalWorkflows as Record<string, object[]>)[id] ?? [] };
  }

  // triggers/<name>  — app-level triggers live in pageWorkflowMeta, not globalWorkflowMeta
  if (parts[0] === 'triggers') {
    const name = parts[1];
    const entry = Object.entries(store.pageWorkflowMeta as Record<string, WorkflowMeta>)
      .find(([, m]) => m.isAppTrigger && (m.trigger === name || m.name === name));
    if (!entry) throw new Error(`App trigger "${name}" not found`);
    const [id, m] = entry;
    return { id, meta: m, steps: (store.pageWorkflows as Record<string, object[]>)[id] ?? [] };
  }

  // data/<folder?>/<dsId>
  if (parts[0] === 'data') {
    const id = parts[parts.length - 1];
    const ds = (store.pageDataSources as DataSourceConfig[]).find(d => d.id === id);
    if (!ds) throw new Error(`Datasource "${id}" not found`);
    return ds;
  }

  // components/<folder?>/<id>/component
  // components/<folder?>/<id>/store/<varId>
  // components/<folder?>/<id>/utils/<formulaId>
  // components/<folder?>/<id>/workflows/<wfId>
  // components/<folder?>/<id>/triggers/<triggerId>
  if (parts[0] === 'components') {
    return resolveComponentSlice(parts);
  }

  // pages/<name>/page
  if (parts[0] === 'pages' && parts[2] === 'page') {
    const page = store.pages.find(p => p.name.toLowerCase() === parts[1].toLowerCase());
    if (!page) throw new Error(`Page "${parts[1]}" not found`);
    return pageToScreenJson(page);
  }

  // pages/<name>/groups/<groupName>
  if (parts[0] === 'pages' && parts[2] === 'groups') {
    const page = store.pages.find(p => p.name.toLowerCase() === parts[1].toLowerCase());
    if (!page) throw new Error(`Page "${parts[1]}" not found`);
    const groupName = parts[3];
    const nodes = collectGroupNodes(page.nodes, groupName);
    if (!nodes.length) throw new Error(`Group "${groupName}" not found in page "${parts[1]}"`);
    return nodes.length === 1 ? nodes[0] : nodes;
  }

  // pages/<name>/workflows/<folder?>/<wfName>
  if (parts[0] === 'pages' && parts[2] === 'workflows') {
    const wfName = parts[parts.length - 1];
    const entry = Object.entries(store.pageWorkflowMeta as Record<string, WorkflowMeta>)
      .find(([, m]) => m.name === wfName);
    if (!entry) throw new Error(`Page workflow "${wfName}" not found`);
    const [id, m] = entry;
    return { id, meta: m, steps: (store.pageWorkflows as Record<string, object[]>)[id] ?? [] };
  }

  // pages/<name>/triggers/<triggerType>
  if (parts[0] === 'pages' && parts[2] === 'triggers') {
    const trigger = parts[3];
    const entry = Object.entries(store.pageWorkflowMeta as Record<string, WorkflowMeta>)
      .find(([, m]) => m.isTrigger && (m.trigger === trigger || m.name === trigger));
    if (!entry) throw new Error(`Page trigger "${trigger}" not found`);
    const [id, m] = entry;
    return { id, meta: m, steps: (store.pageWorkflows as Record<string, object[]>)[id] ?? [] };
  }

  throw new Error(`Unknown path: ${path}`);
}

function resolveComponentSlice(parts: string[]): unknown {
  // find the SC id: it's the part just before the sub-section key
  // e.g. components/Forms/sc-input/component → sc-input is parts[2]
  //      components/sc-input/component → sc-input is parts[1]
  const subSection = parts[parts.length - 1];
  // The component id is the segment just before the sub-section
  // For single-depth: components/<id>/component → id at parts[1]
  // For folder-depth: components/<folder>/<id>/component → id at parts[2]
  const knownSubs = ['component', 'store', 'utils', 'workflows', 'triggers'];
  let scId: string | undefined;
  let subPath: string[] = [];

  for (let i = parts.length - 1; i >= 1; i--) {
    if (knownSubs.includes(parts[i])) {
      scId = parts[i - 1];
      subPath = parts.slice(i);
      break;
    }
  }

  // Fallback: treat last-non-json segment as id
  if (!scId) scId = parts[parts.length - 2];

  const allSCs = getSharedComponents();
  const sc = allSCs[scId ?? ''];
  if (!sc) throw new Error(`Component "${scId}" not found`);

  if (subPath[0] === 'component' || subSection === 'component') {
    return sc;
  }

  if (subPath[0] === 'store' && subPath.length > 1) {
    const varId = subPath[subPath.length - 1];
    return sc.variables?.[varId] ?? null;
  }

  if (subPath[0] === 'utils' && subPath.length > 1) {
    const fId = subPath[subPath.length - 1];
    return sc.formulas?.[fId] ?? null;
  }

  if (subPath[0] === 'workflows' && subPath.length > 1) {
    const wId = subPath[subPath.length - 1];
    return sc.workflows?.[wId] ?? null;
  }

  if (subPath[0] === 'triggers' && subPath.length > 1) {
    const tId = subPath[subPath.length - 1];
    return sc.triggers?.find(t => t.id === tId) ?? null;
  }

  return sc;
}

// ─── applyVirtualFile ─────────────────────────────────────────────────────────

export function applyVirtualFile(
  store: BuilderStore,
  path: string,
  jsonText: string,
): ApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` };
  }
  try {
    applyParsedSlice(store, path, parsed);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}


function applyParsedSlice(store: BuilderStore, path: string, value: unknown): void {
  const parts = path.split('/');

  // routes
  if (path === 'routes') {
    const data = value as { routes: Array<{ path: string; config: string; name?: string }> };
    if (!Array.isArray(data?.routes)) throw new Error('"routes" must be an object with a routes array');
    for (const r of data.routes) {
      if (!r.path || !r.config) continue;
      if (!store.pages.find(p => p.name === r.config)) {
        store.addPage(r.path, r.config);
      }
    }
    return;
  }

  // design/theme
  if (path === 'design/theme') {
    const data = value as { overrides?: Record<string, string>; darkOverrides?: Record<string, string> };
    for (const [k, v] of Object.entries(data?.overrides ?? {})) store.patchTheme(k, v, 'light');
    for (const [k, v] of Object.entries(data?.darkOverrides ?? {})) store.patchTheme(k, v, 'dark');
    return;
  }

  // design/colors — array of CustomColor
  if (path === 'design/colors') {
    const colors = value as Array<{ id: string; name: string; light: string; dark: string }>;
    if (!Array.isArray(colors)) throw new Error('colors must be an array');
    for (const c of colors) {
      const existing = store.customColors.find(cc => cc.id === c.id);
      if (existing) store.updateCustomColor(c.id, c);
      else store.addCustomColor(c);
    }
    return;
  }

  // store/<varName>  (the varName is the last segment)
  if (parts[0] === 'store') {
    const varName = parts[parts.length - 1];
    const data = value as CustomVar;
    if (data.initialValue === undefined) throw new Error(`store/${varName}: "initialValue" is required (not "value")`);
    if (!data.id || !data.name) throw new Error(`store/${varName}: JSON must include "id" and "name" fields`);
    const existing = (store.customVars as CustomVar[]).find(cv => cv.id === data.id);
    if (existing) store.updateCustomVar(existing.name, data);
    else store.addCustomVar(data);
    return;
  }

  // utils/<formulaName>
  if (parts[0] === 'utils') {
    const name = parts[parts.length - 1];
    store.setGlobalFormulaFull(name, value as GlobalFormulaDef);
    return;
  }

  // workflows/<name>  OR  workflows/<domain>/<id> (domain subfolders in pageWorkflows)
  if (parts[0] === 'workflows') {
    const data = value as { id?: string; meta?: WorkflowMeta; steps?: object[] };
    if (!data.id) throw new Error(`workflows/${parts.slice(1).join('/')}: JSON must include an "id" field`);
    const id = data.id;
    if (!data.meta) throw new Error(`workflows/${parts.slice(1).join('/')}: "meta" object is required — include { id, name, trigger }`);
    if (parts.length === 3) {
      store.setPageWorkflowMeta(id, data.meta);
      if (data.steps) store.setPageWorkflow(id, data.steps);
    } else {
      store.setGlobalWorkflowMeta(id, data.meta);
      if (data.steps) store.setGlobalWorkflow(id, data.steps);
    }
    return;
  }

  // triggers/<name>  — app-level triggers live in pageWorkflowMeta, not globalWorkflowMeta
  if (parts[0] === 'triggers') {
    const data = value as { id?: string; meta?: WorkflowMeta; steps?: object[] };
    if (!data.id) throw new Error(`triggers/${parts[1]}: JSON must include an "id" field`);
    const id = data.id;
    if (!data.meta) throw new Error(`triggers/${parts[1]}: "meta" object is required — include { id, name, trigger }`);
    store.setPageWorkflowMeta(id, data.meta);
    if (data.steps) store.setPageWorkflow(id, data.steps);
    return;
  }

  // data/<dsId>
  if (parts[0] === 'data') {
    const data = value as DataSourceConfig;
    if (!data.id) throw new Error(`data/${parts[parts.length - 1]}: JSON must include an "id" field`);
    const existing = (store.pageDataSources as DataSourceConfig[]).find(d => d.id === data.id);
    if (existing) store.updatePageDataSource(data.id, data);
    else store.addPageDataSource(data);
    return;
  }

  // components/<folder?>/<id>/component
  if (parts[0] === 'components' && path.endsWith('/component')) {
    const data = value as SharedComponentModel;
    if (!data.id) throw new Error('Component JSON must have an "id" field');
    updateSharedComponent(data);
    return;
  }

  // pages/<name>/page — replace full page nodes
  if (parts[0] === 'pages' && parts[2] === 'page') {
    const pageName = parts[1];
    const page = store.pages.find(p => p.name === pageName);
    const data = value as { meta?: Record<string, unknown>; ui?: unknown };
    const rawUi = data.ui;
    if (!rawUi) throw new Error(`pages/${pageName}/page: "ui" field is required — write { "ui": [rootNode] }`);
    if (!Array.isArray(rawUi)) throw new Error(`pages/${pageName}/page: "ui" must be an array — write { "ui": [rootNode] }`);
    const rawNodes = rawUi as SDUINode[];
    if (page) {
      store.replacePageNodes(page.id, rawNodes);
      if (data.meta) store.setCurrentPageMeta(data.meta as Parameters<typeof store.setCurrentPageMeta>[0]);
      // Switch canvas to show this page so the user sees the update immediately
      store.focusPage(page.id);
    } else {
      // Pre-generate the ID so we can call replacePageNodes without re-reading
      // the store snapshot (store.pages is stale after addPage runs its set()).
      const newPageId = `page-${Date.now()}`;
      store.addPage(`/${pageName}`, pageName, newPageId);
      store.replacePageNodes(newPageId, rawNodes);
      store.focusPage(newPageId);
    }
    return;
  }

  // pages/<name>/groups/<groupName> — replace the _group node's subtree
  if (parts[0] === 'pages' && parts[2] === 'groups') {
    const pageName = parts[1];
    const groupName = parts[3];
    const page = store.pages.find(p => p.name === pageName);
    if (!page) throw new Error(`Page "${pageName}" not found`);
    const incoming = Array.isArray(value) ? (value as SDUINode[]) : [value as SDUINode];
    let newNodes = replaceGroupNodes(page.nodes as SDUINode[], groupName, incoming);
    // If no existing _group stub was found, append the incoming node as a new top-level node
    if (newNodes.length === (page.nodes as SDUINode[]).length &&
        !collectGroupNodes(newNodes, groupName).length) {
      newNodes = [...newNodes, { ...incoming[0], _group: groupName } as SDUINode];
    }
    store.replacePageNodes(page.id, newNodes);
    return;
  }

  // pages/<name>/workflows/<name>
  if (parts[0] === 'pages' && parts[2] === 'workflows') {
    const data = value as { id?: string; meta?: WorkflowMeta; steps?: object[] };
    if (!data.id) throw new Error(`pages/${parts[1]}/workflows/${parts[3]}: JSON must include an "id" field`);
    const id = data.id;
    if (!data.meta) throw new Error(`pages/${parts[1]}/workflows/${parts[3]}: "meta" object is required — include { id, name, trigger, pageScope }`);
    store.setPageWorkflowMeta(id, data.meta);
    if (data.steps) store.setPageWorkflow(id, data.steps);
    return;
  }

  // pages/<name>/triggers/<triggerType>
  if (parts[0] === 'pages' && parts[2] === 'triggers') {
    const data = value as { id?: string; meta?: WorkflowMeta; steps?: object[] };
    if (!data.id) throw new Error(`pages/${parts[1]}/triggers/${parts[3]}: JSON must include an "id" field`);
    const id = data.id;
    if (!data.meta) throw new Error(`pages/${parts[1]}/triggers/${parts[3]}: "meta" object is required — include { id, name, trigger }`);
    store.setPageWorkflowMeta(id, data.meta);
    if (data.steps) store.setPageWorkflow(id, data.steps);
    return;
  }

  throw new Error(`Unknown path: ${path}`);
}

// ─── Group node helpers ───────────────────────────────────────────────────────

/** Collect all nodes where _group === groupName from a page node tree. */
function collectGroupNodes(nodes: SDUINode[], groupName: string): SDUINode[] {
  const result: SDUINode[] = [];
  function walk(n: SDUINode) {
    const g = (n as unknown as Record<string, unknown>)._group;
    if (g === groupName) { result.push(n); return; }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/**
 * Replace every node with _group === groupName with the incoming nodes.
 * Keeps relative order of replacement (first match gets first incoming node).
 */
function replaceGroupNodes(nodes: SDUINode[], groupName: string, incoming: SDUINode[]): SDUINode[] {
  let replacementIdx = 0;
  function walk(n: SDUINode): SDUINode | null {
    const g = (n as unknown as Record<string, unknown>)._group;
    if (g === groupName) {
      if (replacementIdx < incoming.length) {
        return { ...incoming[replacementIdx++], _group: groupName } as SDUINode;
      }
      return null; // remove extra nodes beyond what was supplied
    }
    if (Array.isArray(n.children)) {
      const newChildren = n.children.flatMap(c => {
        const r = walk(c);
        return r ? [r] : [];
      });
      return { ...n, children: newChildren };
    }
    return n;
  }
  return nodes.flatMap(n => { const r = walk(n); return r ? [r] : []; });
}

// ─── pageToScreenJson ─────────────────────────────────────────────────────────

/**
 * Replace `_group` section nodes and `_shared` component instance nodes with
 * lightweight reference stubs so that `page.json` is a concise structural
 * outline. Full content lives in `groups/<name>.json` and
 * `components/<id>/component.json` respectively.
 */
function stubGroupNodes(nodes: SDUINode[]): unknown[] {
  return nodes.map(n => {
    const rec = n as unknown as Record<string, unknown>;

    // Stub _group sections → groups/<name>
    const group = rec._group;
    if (typeof group === 'string' && group) {
      return { $ref: `groups/${group}`, _group: group, type: rec.type, id: rec.id };
    }

    // Stub _shared component instances → components/<id>
    const shared = rec._shared as { id?: string; name?: string } | undefined;
    if (shared?.id) {
      return { $ref: `components/${shared.id}`, _shared: shared, type: rec.type, id: rec.id };
    }

    // Plain nodes — recurse into children
    if (Array.isArray(n.children)) {
      return { ...rec, children: stubGroupNodes(n.children) };
    }
    return n;
  });
}

export function pageToScreenJson(page: BuilderPage): Record<string, unknown> {
  const stubbed = stubGroupNodes(page.nodes);
  return {
    meta: page.meta ?? {},
    ui: stubbed.length === 1 ? stubbed[0] : stubbed,
  };
}


// ─── serializeVirtualFiles ────────────────────────────────────────────────────

export interface SerializedVirtualFiles {
  tree: VirtualFolder;
  /** path → pretty-printed JSON content */
  files: Record<string, string>;
}

/**
 * Walk the virtual file tree and read every leaf file into a flat map.
 * Used by the file-based AI agent to receive the full project snapshot each turn.
 */
export function serializeVirtualFiles(store: BuilderStore): SerializedVirtualFiles {
  const tree = buildFileTree(store);
  const files: Record<string, string> = {};

  function walkEntry(entry: VirtualEntry): void {
    if (entry.kind === 'file') {
      try {
        const content = readVirtualFile(store, entry.path);
        files[entry.path] = content;
      } catch {
        // skip unreadable files (shouldn't happen, but guard anyway)
      }
    } else {
      for (const child of entry.children) walkEntry(child);
    }
  }

  for (const child of tree.children) walkEntry(child);
  return { tree, files };
}

// ─── deleteVirtualFile ────────────────────────────────────────────────────────

export interface DeleteResult {
  ok: boolean;
  error?: string;
}

/**
 * Delete a virtual file from the builder store.
 * Mirrors the path routing in applyParsedSlice but removes rather than upserts.
 */
export function deleteVirtualFile(store: BuilderStore, path: string): DeleteResult {
  try {
    deleteParsedSlice(store, path);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function deleteParsedSlice(store: BuilderStore, path: string): void {
  const parts = path.split('/');

  // store/<varName>
  if (parts[0] === 'store') {
    const varName = parts[parts.length - 1];
    store.removeCustomVar(varName);
    return;
  }

  // utils/<formulaName>
  if (parts[0] === 'utils') {
    const name = parts[parts.length - 1];
    store.removeGlobalFormula(name);
    return;
  }

  // workflows/<domain>/<id>  (3-part) — page/domain workflow
  // workflows/<name>         (2-part) — global reusable workflow
  if (parts[0] === 'workflows') {
    if (parts.length === 3) {
      store.removePageWorkflow(parts[2]);
    } else {
      const name = parts[parts.length - 1];
      const entry = Object.entries(store.globalWorkflowMeta as Record<string, WorkflowMeta>)
        .find(([k, m]) => k === name || m.id === name || m.name === name);
      if (entry) store.removeGlobalWorkflow(entry[0]);
    }
    return;
  }

  // triggers/<name>
  if (parts[0] === 'triggers') {
    const name = parts[1];
    const entry = Object.entries(store.pageWorkflowMeta as Record<string, WorkflowMeta>)
      .find(([, m]) => m.isAppTrigger && (m.trigger === name || m.name === name));
    if (entry) store.removePageWorkflow(entry[0]);
    return;
  }

  // data/<dsId>
  if (parts[0] === 'data') {
    const id = parts[parts.length - 1];
    store.removePageDataSource(id);
    return;
  }

  // components/<folder?>/<id>/component  → delete the whole shared component
  if (parts[0] === 'components') {
    const knownSubs = ['component', 'store', 'utils', 'workflows', 'triggers'];
    let scId: string | undefined;
    for (let i = parts.length - 1; i >= 1; i--) {
      if (knownSubs.includes(parts[i])) { scId = parts[i - 1]; break; }
    }
    if (!scId) scId = parts[parts.length - 2];
    deleteSharedComponent(scId ?? '');
    return;
  }

  // pages/<name>/page  → delete the whole page
  if (parts[0] === 'pages' && parts[2] === 'page') {
    const page = store.pages.find(p => p.name === parts[1]);
    if (page) store.removePage(page.id);
    return;
  }

  // pages/<name>/workflows/<name>
  if (parts[0] === 'pages' && parts[2] === 'workflows') {
    const wfName = parts[parts.length - 1];
    const entry = Object.entries(store.pageWorkflowMeta as Record<string, WorkflowMeta>)
      .find(([k, m]) => k === wfName || m.id === wfName || m.name === wfName);
    if (entry) store.removePageWorkflow(entry[0]);
    return;
  }

  // pages/<name>/triggers/<trigger>
  if (parts[0] === 'pages' && parts[2] === 'triggers') {
    const trigger = parts[3];
    const entry = Object.entries(store.pageWorkflowMeta as Record<string, WorkflowMeta>)
      .find(([, m]) => m.isTrigger && (m.trigger === trigger || m.name === trigger));
    if (entry) store.removePageWorkflow(entry[0]);
    return;
  }

  throw new Error(`Cannot delete path: ${path}`);
}
