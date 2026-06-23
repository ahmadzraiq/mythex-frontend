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
 *                      page.json, workflows/, triggers/
 *
 * The same pattern (store/ utils/ workflows/ triggers/) repeats inside
 * components and pages — developers always know what each folder means.
 *
 * Every foldered entity exposes a uniform `folder: "Name"` string at the
 * VFS boundary. Internally, variables/datasources/colors use a Folder[]
 * registry (folderId), but this is translated transparently on read and
 * write so the agent always sees the same `folder` field regardless of
 * entity type.
 *
 * Public API:
 *   buildFileTree(store)                  → VirtualFolder root
 *   readVirtualFile(store, path)          → pretty JSON string
 *   applyVirtualFile(store, path, json)   → { ok, error? }
 *   pageToScreenJson(page)                → { meta, ui }
 */

import { useBuilderStore } from './_store';
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
  createSharedComponent,
  updateSharedComponent,
  deleteSharedComponent,
} from '@/lib/builder/shared-component-data';
import type { SharedComponentModel } from '@/lib/builder/shared-component-data';
import { deResolveNodeTree } from '@/lib/sdui/deresolve-sx';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface VirtualFile {
  kind: 'file';
  name: string;
  path: string;
  icon: 'page' | 'routes' | 'data' | 'theme' | 'variable' | 'formula' | 'workflow' | 'trigger' | 'component' | 'color';
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

// ─── Folder registry translation helpers ─────────────────────────────────────

/**
 * READ: resolve a Folder[] registry entry to its plain name string.
 * Returns undefined when no folderId is set or the folder is not found.
 */
function folderNameFor(folders: Folder[], folderId?: string): string | undefined {
  if (!folderId) return undefined;
  return folders.find(f => f.id === folderId)?.name;
}

/**
 * WRITE: find an existing folder by name in the registry, or create a new one.
 * Returns the folder id so it can be stored as `folderId` on the entity.
 * `scope` determines which store mutator is called for creation.
 */
function folderIdFor(
  store: BuilderStore,
  scope: 'var' | 'ds' | 'color',
  name?: string,
): string | undefined {
  if (!name) return undefined;
  const folders: Folder[] =
    scope === 'var' ? (store.varFolders as Folder[])
    : scope === 'ds' ? (store.dsFolders as Folder[])
    : (store.colorFolders as Folder[]);
  const existing = folders.find(f => f.name === name);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const newFolder: Folder = { id, name, parentId: null };
  if (scope === 'var') store.addVarFolder(newFolder);
  else if (scope === 'ds') store.addDsFolder(newFolder);
  else store.addColorFolder(newFolder);
  return id;
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
  const workflows = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
  const reusable = Object.entries(workflows).filter(
    ([, w]) => !w.isAppTrigger && !w.isTrigger && !(w as unknown as Record<string, unknown>).isSystem,
  );
  const children: VirtualEntry[] = groupByFolder(
    reusable,
    ([, w]) => w.folder,
    ([, w]) => w.name,
    ([id, w], prefix) => `${prefix}/${w.name || id}`,
    () => 'workflow',
    'workflows',
  );
  return vfolder('workflows', 'workflows', children);
}

// ── triggers/ ─────────────────────────────────────────────────────────────────

function buildTriggersFolder(store: BuilderStore): VirtualFolder {
  const workflows = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
  const appTriggers = Object.entries(workflows).filter(([, w]) => w.isAppTrigger === true);
  const children: VirtualFile[] = appTriggers.map(([id, w]) =>
    vfile(`${w.trigger ?? w.name ?? id}.json`, `triggers/${w.trigger ?? w.name ?? id}`, 'trigger'),
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

  // workflows/ — page-scoped (!isTrigger) scoped to this page
  const allWfs = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
  const pageWfs = Object.entries(allWfs).filter(
    ([, w]) =>
      !w.isTrigger && !(w as unknown as Record<string, unknown>).isSystem &&
      (w.pageScope === page.name || w.pageScope === page.route),
  );
  if (pageWfs.length > 0) {
    const wfChildren = groupByFolder(
      pageWfs,
      ([, w]) => w.folder,
      ([, w]) => w.name,
      ([id, w], prefix) => `${prefix}/${w.name || id}`,
      () => 'workflow',
      `${base}/workflows`,
    );
    sub.push(vfolder('workflows', `${base}/workflows`, wfChildren));
  }

  // triggers/ — page lifecycle triggers (isTrigger === true, scoped to this page)
  const pageTriggers = Object.entries(allWfs).filter(
    ([, w]) => w.isTrigger === true && (w.pageScope === page.name || w.pageScope === page.route),
  );
  if (pageTriggers.length > 0) {
    const tChildren: VirtualFile[] = pageTriggers.map(([id, w]) =>
      vfile(`${w.trigger ?? w.name ?? id}.json`, `${base}/triggers/${w.trigger ?? id}`, 'trigger'),
    );
    sub.push(vfolder('triggers', `${base}/triggers`, tChildren));
  }

  return vfolder(page.name, base, sub);
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
    return (store.customColors as Array<Record<string, unknown>>).map(c => {
      const { folderId, ...rest } = c;
      const folderName = folderNameFor(store.colorFolders as Folder[], folderId as string | undefined);
      return folderName ? { ...rest, folder: folderName } : rest;
    });
  }

  // store/<folder?>/<varName>  OR  store/<varName>
  if (parts[0] === 'store') {
    const varName = parts[parts.length - 1];
    const v = (store.customVars as CustomVar[]).find(cv => cv.name === varName);
    if (!v) throw new Error(`Variable "${varName}" not found`);
    const { folderId, ...rest } = v as CustomVar & { folderId?: string };
    const folderName = folderNameFor(store.varFolders as Folder[], folderId);
    return folderName ? { ...rest, folder: folderName } : rest;
  }

  // utils/<folder?>/<formulaName>
  if (parts[0] === 'utils') {
    const name = parts[parts.length - 1];
    const f = (store.globalFormulas as Record<string, GlobalFormulaDef>)[name];
    if (!f) throw new Error(`Formula "${name}" not found`);
    return f;
  }

  // workflows/<folder?>/<workflowName>  OR  workflows/<domain>/<id>
  if (parts[0] === 'workflows') {
    const lastName = parts[parts.length - 1];
    const wfs = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
    // Try by UUID or by name
    const wf = wfs[lastName] ?? Object.values(wfs).find(w => w.name === lastName);
    if (!wf) throw new Error(`Workflow "${lastName}" not found`);
    return { id: wf.id, meta: { id: wf.id, name: wf.name, trigger: wf.trigger, folder: wf.folder, isTrigger: wf.isTrigger, pageScope: wf.pageScope, params: wf.params }, steps: wf.steps ?? [] };
  }

  // triggers/<name>
  if (parts[0] === 'triggers') {
    const name = parts[1];
    const wfs = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
    const entry = Object.entries(wfs).find(([, w]) => w.isAppTrigger && (w.trigger === name || w.name === name));
    if (!entry) throw new Error(`App trigger "${name}" not found`);
    const [, w] = entry;
    return { id: w.id, meta: { id: w.id, name: w.name, trigger: w.trigger, isAppTrigger: true, params: w.params }, steps: w.steps ?? [] };
  }

  // data/<folder?>/<dsId>
  if (parts[0] === 'data') {
    const id = parts[parts.length - 1];
    const ds = (store.pageDataSources as DataSourceConfig[]).find(d => d.id === id);
    if (!ds) throw new Error(`Datasource "${id}" not found`);
    const { folderId, ...rest } = ds as DataSourceConfig & { folderId?: string };
    const folderName = folderNameFor(store.dsFolders as Folder[], folderId);
    return folderName ? { ...rest, folder: folderName } : rest;
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
    const json = pageToScreenJson(page) as { meta: unknown; ui: unknown[] };
    if (Array.isArray(json.ui)) json.ui = deResolveNodeTree(json.ui);
    return json;
  }

  // pages/<name>/workflows/<folder?>/<wfName>
  if (parts[0] === 'pages' && parts[2] === 'workflows') {
    const wfName = parts[parts.length - 1];
    const wfs = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
    const wf = wfs[wfName] ?? Object.values(wfs).find(w => w.name === wfName);
    if (!wf) throw new Error(`Page workflow "${wfName}" not found`);
    return { id: wf.id, meta: { id: wf.id, name: wf.name, trigger: wf.trigger, pageScope: wf.pageScope, folder: wf.folder, params: wf.params }, steps: wf.steps ?? [] };
  }

  // pages/<name>/triggers/<triggerType>
  if (parts[0] === 'pages' && parts[2] === 'triggers') {
    const trigger = parts[3];
    const wfs = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
    const entry = Object.entries(wfs).find(([, w]) => w.isTrigger && (w.trigger === trigger || w.name === trigger));
    if (!entry) throw new Error(`Page trigger "${trigger}" not found`);
    const [, w] = entry;
    return { id: w.id, meta: { id: w.id, name: w.name, trigger: w.trigger, isTrigger: true, pageScope: w.pageScope, params: w.params }, steps: w.steps ?? [] };
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
    // De-resolve className → SxProps for AI context
    const out = { ...sc } as Record<string, unknown>;
    if (Array.isArray(out.content)) {
      out.content = deResolveNodeTree(out.content as unknown[]);
    } else if (out.content && typeof out.content === 'object') {
      out.content = deResolveNodeTree([out.content as unknown])[0];
    }
    return out;
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


/**
 * Recursively walks a node tree and expands any "reference-only" _shared nodes
 * (nodes that have _shared metadata but no children) by copying the component
 * model's content inline. This matches the builder-native pattern where a
 * shared component instance is stored as the full content tree tagged with
 * _shared metadata — not as a blank placeholder.
 *
 * The AI naturally writes reference-only nodes (compact, no duplication), so
 * this expansion runs transparently at write-time so the renderer always sees
 * the full inline content it expects.
 */
function expandSharedRefs(nodes: SDUINode[]): SDUINode[] {
  const allSCs = getSharedComponents();
  function expand(node: SDUINode): SDUINode {
    const n = node as unknown as Record<string, unknown>;
    const shared = n._shared as { id: string; name: string } | undefined;
    if (shared && (!Array.isArray(n.children) || (n.children as unknown[]).length === 0)) {
      const model = allSCs[shared.id];
      if (model?.content) {
        const content = model.content as Record<string, unknown>;
        const expanded: Record<string, unknown> = {
          ...content,
          _shared: shared,
          _overrides: (n._overrides as unknown[]) ?? [],
          id: n.id,
        };
        if (Array.isArray(expanded.children)) {
          expanded.children = (expanded.children as SDUINode[]).map(expand);
        }
        return expanded as unknown as SDUINode;
      }
    }
    if (Array.isArray(n.children)) {
      return { ...n, children: (n.children as SDUINode[]).map(expand) } as unknown as SDUINode;
    }
    return node;
  }
  return nodes.map(expand);
}

function applyParsedSlice(store: BuilderStore, path: string, value: unknown): void {
  const parts = path.split('/');

  // routes
  if (path === 'routes') {
    const data = value as { routes: Array<{ path: string; config: string; name?: string }> };
    if (!Array.isArray(data?.routes)) throw new Error('"routes" must be an object with a routes array');
    for (const r of data.routes) {
      if (!r.path || !r.config || r.config === '/' || r.config === '') continue;
      // Re-read live pages — previous events (page_written) may have already added this page.
      const livePages = useBuilderStore.getState().pages as BuilderPage[];
      const alreadyExists = livePages.find(
        p => p.name === r.config || p.route === r.path || p.route === r.path.toLowerCase(),
      );
      if (!alreadyExists) {
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
    const colors = value as Array<{ id: string; name: string; light: string; dark: string; folder?: string }>;
    if (!Array.isArray(colors)) throw new Error('colors must be an array');
    for (const c of colors) {
      const { folder, ...colorData } = c;
      const folderId = folderIdFor(store, 'color', folder);
      const resolved = folderId ? { ...colorData, folderId } : colorData;
      const existing = store.customColors.find(cc => cc.id === c.id);
      if (existing) store.updateCustomColor(c.id, resolved as typeof existing);
      else store.addCustomColor(resolved as typeof existing);
    }
    return;
  }

  // store/<varName>  (the varName is the last segment)
  if (parts[0] === 'store') {
    const varName = parts[parts.length - 1];
    const { folder, ...rest } = value as CustomVar & { folder?: string };
    const data = rest as CustomVar;
    if (data.initialValue === undefined) throw new Error(`store/${varName}: "initialValue" is required (not "value")`);
    if (!data.id || !data.name) throw new Error(`store/${varName}: JSON must include "id" and "name" fields`);
    const folderId = folderIdFor(store, 'var', folder);
    const resolved: CustomVar = folderId ? { ...data, folderId } : data;
    const existing = (store.customVars as CustomVar[]).find(cv => cv.id === resolved.id);
    if (existing) store.updateCustomVar(existing.name, resolved);
    else store.addCustomVar(resolved);
    return;
  }

  // utils/<formulaName>
  if (parts[0] === 'utils') {
    const name = parts[parts.length - 1];
    store.setGlobalFormulaFull(name, value as GlobalFormulaDef);
    return;
  }

  // workflows/<name>  OR  workflows/<domain>/<id>
  if (parts[0] === 'workflows') {
    const data = value as { id?: string; meta?: WorkflowMeta; steps?: object[] };
    if (!data.id) throw new Error(`workflows/${parts.slice(1).join('/')}: JSON must include an "id" field`);
    const id = data.id;
    if (!data.meta) throw new Error(`workflows/${parts.slice(1).join('/')}: "meta" object is required — include { id, name, trigger }`);
    store.setWorkflow(id, {
      id,
      name: data.meta.name ?? id,
      trigger: data.meta.trigger,
      folder: data.meta.folder,
      isTrigger: data.meta.isTrigger,
      isAppTrigger: data.meta.isAppTrigger,
      pageScope: data.meta.pageScope,
      params: data.meta.params,
      steps: data.steps ?? [],
    });
    return;
  }

  // triggers/<name>
  if (parts[0] === 'triggers') {
    const data = value as { id?: string; meta?: WorkflowMeta; steps?: object[] };
    if (!data.id) throw new Error(`triggers/${parts[1]}: JSON must include an "id" field`);
    const id = data.id;
    if (!data.meta) throw new Error(`triggers/${parts[1]}: "meta" object is required — include { id, name, trigger }`);
    store.setWorkflow(id, {
      id,
      name: data.meta.name ?? id,
      trigger: data.meta.trigger,
      isAppTrigger: data.meta.isAppTrigger ?? true,
      isTrigger: data.meta.isTrigger,
      pageScope: data.meta.pageScope,
      params: data.meta.params,
      steps: data.steps ?? [],
    });
    return;
  }

  // data/<dsId>
  if (parts[0] === 'data') {
    const { folder, ...rest } = value as DataSourceConfig & { folder?: string };
    const data = rest as DataSourceConfig;
    if (!data.id) throw new Error(`data/${parts[parts.length - 1]}: JSON must include an "id" field`);
    const folderId = folderIdFor(store, 'ds', folder);
    const resolved: DataSourceConfig = folderId ? { ...data, folderId } : data;
    const existing = (store.pageDataSources as DataSourceConfig[]).find(d => d.id === resolved.id);
    if (existing) store.updatePageDataSource(resolved.id, resolved);
    else store.addPageDataSource(resolved);
    return;
  }

  // components/<folder?>/<id>/component
  if (parts[0] === 'components' && path.endsWith('/component')) {
    const data = value as SharedComponentModel;
    if (!data.id) throw new Error('Component JSON must have an "id" field');
    const existing = getSharedComponents()[data.id];
    if (existing) {
      updateSharedComponent(data);
    } else {
      createSharedComponent(data);
    }
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
    const rawNodes = expandSharedRefs(rawUi as SDUINode[]);
    if (page) {
      store.replacePageNodes(page.id, rawNodes);
      if (data.meta) store.setCurrentPageMeta(data.meta as Parameters<typeof store.setCurrentPageMeta>[0]);
      // Switch canvas to show this page so the user sees the update immediately
      store.focusPage(page.id);
    } else {
      // Pre-generate the ID so we can call replacePageNodes without re-reading
      // the store snapshot (store.pages is stale after addPage runs its set()).
      // Use lowercase route so it matches the routes_written event (avoids duplicate page).
      const newPageId = `page-${crypto.randomUUID()}`;
      store.addPage(`/${pageName.toLowerCase()}`, pageName, newPageId);
      store.replacePageNodes(newPageId, rawNodes);
      store.focusPage(newPageId);
    }
    return;
  }

  // pages/<name>/workflows/<name>
  if (parts[0] === 'pages' && parts[2] === 'workflows') {
    const data = value as { id?: string; meta?: WorkflowMeta; steps?: object[] };
    if (!data.id) throw new Error(`pages/${parts[1]}/workflows/${parts[3]}: JSON must include an "id" field`);
    const id = data.id;
    if (!data.meta) throw new Error(`pages/${parts[1]}/workflows/${parts[3]}: "meta" object is required — include { id, name, trigger, pageScope }`);
    store.setWorkflow(id, {
      id,
      name: data.meta.name ?? id,
      trigger: data.meta.trigger,
      folder: data.meta.folder,
      isTrigger: data.meta.isTrigger,
      isAppTrigger: data.meta.isAppTrigger,
      pageScope: data.meta.pageScope ?? parts[1],
      params: data.meta.params,
      steps: data.steps ?? [],
    });
    return;
  }

  // pages/<name>/triggers/<triggerType>
  if (parts[0] === 'pages' && parts[2] === 'triggers') {
    const data = value as { id?: string; meta?: WorkflowMeta; steps?: object[] };
    if (!data.id) throw new Error(`pages/${parts[1]}/triggers/${parts[3]}: JSON must include an "id" field`);
    const id = data.id;
    if (!data.meta) throw new Error(`pages/${parts[1]}/triggers/${parts[3]}: "meta" object is required — include { id, name, trigger }`);
    store.setWorkflow(id, {
      id,
      name: data.meta.name ?? id,
      trigger: data.meta.trigger,
      isTrigger: data.meta.isTrigger ?? true,
      pageScope: data.meta.pageScope ?? parts[1],
      params: data.meta.params,
      steps: data.steps ?? [],
    });
    return;
  }

  throw new Error(`Unknown path: ${path}`);
}

// ─── pageToScreenJson ─────────────────────────────────────────────────────────

/**
 * Replace `_shared` component instance nodes with lightweight reference stubs
 * so that `page.json` is a concise structural outline.
 */
function stubPageNodes(nodes: SDUINode[]): unknown[] {
  return nodes.map(n => {
    const rec = n as unknown as Record<string, unknown>;

    // Stub _shared component instances → components/<id>
    const shared = rec._shared as { id?: string; name?: string } | undefined;
    if (shared?.id) {
      return { $ref: `components/${shared.id}`, _shared: shared, type: rec.type, id: rec.id };
    }

    // Plain nodes — recurse into children
    if (Array.isArray(n.children)) {
      return { ...rec, children: stubPageNodes(n.children) };
    }
    return n;
  });
}

export function pageToScreenJson(page: BuilderPage): Record<string, unknown> {
  const stubbed = stubPageNodes(page.nodes);
  return {
    meta: page.meta ?? {},
    // Always an array — applyParsedSlice and the PostToolUse resolver both require Array.isArray(ui).
    ui: stubbed,
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

  // workflows/<domain>/<id>  OR  workflows/<name>
  if (parts[0] === 'workflows') {
    const lastName = parts[parts.length - 1];
    const wfs = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
    const entry = Object.entries(wfs).find(([k, w]) => k === lastName || w.name === lastName);
    if (entry) store.removeWorkflow(entry[0]);
    return;
  }

  // triggers/<name>
  if (parts[0] === 'triggers') {
    const name = parts[1];
    const wfs = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
    const entry = Object.entries(wfs).find(([, w]) => w.isAppTrigger && (w.trigger === name || w.name === name));
    if (entry) store.removeWorkflow(entry[0]);
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
    const wfs = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
    const entry = Object.entries(wfs).find(([k, w]) => k === wfName || w.name === wfName);
    if (entry) store.removeWorkflow(entry[0]);
    return;
  }

  // pages/<name>/triggers/<trigger>
  if (parts[0] === 'pages' && parts[2] === 'triggers') {
    const trigger = parts[3];
    const wfs = store.workflows as Record<string, import('@/config/types').WorkflowDef>;
    const entry = Object.entries(wfs).find(([, w]) => w.isTrigger && (w.trigger === trigger || w.name === trigger));
    if (entry) store.removeWorkflow(entry[0]);
    return;
  }

  throw new Error(`Cannot delete path: ${path}`);
}
