'use client';

/**
 * Builder Store — Zustand state for the visual page builder.
 *
 * Owns:
 *  - pageNodes: the SDUI node tree being edited
 *  - selection, hover, alt-hover
 *  - clipboard, locked/hidden sets
 *  - history (full snapshots, max 50, debounced for continuous edits)
 *
 * No iframe / DomNode / postMessage state — the builder renders directly in
 * the same React tree and queries the DOM via getBoundingClientRect() on demand.
 */

import { create } from 'zustand';
import type { SDUINode } from '@/lib/sdui/types/node';
export type { SDUINode };
import routesConfig from '@/config/routes.json';
import root from '@/config/root';
import { resolveScreenConfig, type ConfigRegistry } from '@/lib/sdui/config-resolver';
import { updateSharedComponent, getSharedComponents, loadSharedComponents } from '@/lib/builder/shared-component-data';
import { getBuilderConfig } from '@/lib/builder/config-data';
import { getGlobalVariableStore, registerStorageVar, unregisterStorageVar } from '@/lib/sdui/global-variable-store';
import { registerGlobalFormulas } from '@/lib/sdui/formula-evaluator';
import { registerVariableNames, registerCollectionNames } from '@/lib/sdui/variable-name-registry';

// ─── Node-tree helpers (extracted to _store-node-helpers.ts) ────────────────
// Single import for internal use; explicit re-exports for external consumers.
import {
  REQUIRED_PARENT, ALLOWED_CHILDREN, isNonDraggable,
  findNode, findParentNode, patchNodeById, insertNode,
  hasFormContainerAncestor, getNodeSubtrees,
  clone, removeNodesByIds,
  _applyLightOverrides, _applyDarkOverrides, hexToRgbTriplet, _getManagedStyle,
  GLUESTACK_PRIMARY_BRIDGE, injectFontsFromOverrides,
  findLinkedRoot, cloneWithFreshIdsKeepSharedKey, stampSharedKeys,
} from './_store-node-helpers';
import {
  diffCssProps, addOverrides, removeOverrides, getOverrides, overlayOverrides, readPropValue,
  copyCssProp, diffAllOverrideableProps,
} from './_shared-overrides';

/**
 * Walk every descendant of `root` in parallel with the corresponding descendant
 * of `modelContent` (matched by child-index path). The root itself is NOT
 * visited — callers handle it separately. When `modelContent` has no node at a
 * given path (e.g. instance has extra children), `modelDesc` is `null`.
 */
function _walkDescendantsParallel(
  root: SDUINode,
  modelContent: Record<string, unknown> | null | undefined,
  onEach: (instDesc: SDUINode, modelDesc: Record<string, unknown> | null, path: number[]) => void,
): void {
  function walk(inst: SDUINode, model: Record<string, unknown> | null, path: number[]): void {
    const iCh = (inst.children ?? []) as SDUINode[];
    const mCh = ((model?.children ?? []) as SDUINode[]);
    for (let i = 0; i < iCh.length; i++) {
      const p = [...path, i];
      const iC = iCh[i];
      const mC = (mCh[i] ?? null) as unknown as Record<string, unknown> | null;
      onEach(iC, mC, p);
      walk(iC, mC, p);
    }
  }
  walk(root, (modelContent ?? null) as Record<string, unknown> | null, []);
}

/** Resolve a descendant by child-index path. Returns null if the path no longer exists. */
function _resolveDescendantByPath(root: SDUINode, path: number[]): SDUINode | null {
  let cur: SDUINode = root;
  for (const idx of path) {
    const ch = (cur.children ?? []) as SDUINode[];
    if (idx < 0 || idx >= ch.length) return null;
    cur = ch[idx];
  }
  return cur;
}

/**
 * Resolve a descendant by its stable `_sharedKey`. Searches the whole subtree
 * rooted at `root` (the root itself is included). Returns null when no node in
 * the subtree carries that sharedKey.
 */
function _resolveDescendantBySharedKey(
  root: Record<string, unknown>,
  sharedKey: string,
): Record<string, unknown> | null {
  if (root._sharedKey === sharedKey) return root;
  const children = (root.children ?? []) as Record<string, unknown>[];
  for (const c of children) {
    const found = _resolveDescendantBySharedKey(c, sharedKey);
    if (found) return found;
  }
  return null;
}

/**
 * Walk every descendant of `instRoot` that has a `_sharedKey` and pair it with
 * the model descendant carrying the same `_sharedKey`. Index-path pairing
 * silently misaligns when the instance has structural divergences (local
 * insertions, removed keys); sharedKey pairing stays correct under those
 * conditions.
 *
 * Descendants without a `_sharedKey` are skipped — they are instance-local
 * insertions that have no model counterpart to diff against.
 */
function _walkDescendantsBySharedKey(
  instRoot: SDUINode,
  modelContent: Record<string, unknown> | null | undefined,
  onEach: (instDesc: SDUINode, modelDesc: Record<string, unknown> | null, sharedKey: string) => void,
): void {
  if (!modelContent) return;
  (function walk(inst: SDUINode) {
    const children = (inst.children ?? []) as SDUINode[];
    for (const c of children) {
      const rec = c as unknown as Record<string, unknown>;
      const key = typeof rec._sharedKey === 'string' ? rec._sharedKey as string : null;
      if (key) {
        const modelDesc = _resolveDescendantBySharedKey(modelContent, key);
        if (modelDesc) onEach(c, modelDesc, key);
      }
      walk(c);
    }
  })(instRoot);
}

export {
  REQUIRED_PARENT, ALLOWED_CHILDREN, isNonDraggable,
  findNode, findParentNode, patchNodeById, insertNode,
  hasFormContainerAncestor, getNodeSubtrees,
};

const MAX_HISTORY = 50;
let _historyTimer = 0;

type SetFn = (partial: ((s: BuilderStore) => Partial<BuilderStore>) | Partial<BuilderStore>, replace?: boolean) => void;

function _flushHistory(set: SetFn) {
  set(s => {
    const prevSnap = s.historyIdx >= 0 ? s.history[s.historyIdx] : undefined;
    const snap = makeSnapshot(s.pages, s.focusedPageId, s.pageNodes as SDUINode[], s.canvasNodes, prevSnap);
    const prev = s.history.slice(0, s.historyIdx + 1);
    const next = [...prev, snap].slice(-MAX_HISTORY);
    return { history: next, historyIdx: next.length - 1 };
  });
}

/** Broadcast a message so all animated nodes on the target page replay their enter animation. */
function _broadcastPageEnterReplay(pageId: string) {
  if (typeof window === 'undefined') return;
  requestAnimationFrame(() => {
    window.postMessage({ type: 'sdui-replay-page-enter', pageId }, '*');
  });
}

function _flushHistoryIfPending(set: SetFn): void {
  if (_historyTimer) {
    cancelAnimationFrame(_historyTimer);
    _historyTimer = 0;
    _flushHistory(set);
  }
}

/**
 * Snapshot the linked-component ROOT that contains a given node id (deep clone).
 * Used to diff pre- vs. post-edit state for per-instance override tracking.
 * Returns null when `id` is not inside any linked-component subtree.
 */
function _snapshotSharedRoot(s: { pageNodes: SDUINode[] }, id: string): SDUINode | null {
  const root = findLinkedRoot(s.pageNodes as SDUINode[], id, 'shared');
  if (!root) return null;
  return JSON.parse(JSON.stringify(root)) as SDUINode;
}

/**
 * Collect every distinct shared-component ROOT id (with a deep-clone snapshot)
 * that is an ANCESTOR of any of the given node ids. Used by structural
 * mutations (moveNode, moveNodes, moveNodeFromPage, deleteNodes, etc.) to
 * record PRE-op SC roots so we can call `_syncSharedInstances` correctly
 * even when the node has been removed from its SC after the mutation.
 *
 * Without this, `findSharedRoot(postNodes, movedChildId)` returns `null`
 * when the moved child is no longer under any SC, and `_syncSharedInstances`
 * silently skips the model update — the source SC keeps the child in the
 * model even though the user dragged it out. See plan Gap 1.
 */
function _collectSharedRoots(
  nodes: SDUINode[],
  ids: Array<string | null | undefined>,
): Map<string, SDUINode> {
  const out = new Map<string, SDUINode>();
  for (const id of ids) {
    if (!id) continue;
    const root = findLinkedRoot(nodes, id, 'any');
    if (!root?.id || out.has(root.id)) continue;
    out.set(root.id, JSON.parse(JSON.stringify(root)) as SDUINode);
  }
  return out;
}

/** Recursively assign fresh UUIDs to every node in the subtree. */
function _reassignIds(node: SDUINode): SDUINode {
  const result = { ...node, id: crypto.randomUUID() };
  if (Array.isArray(result.children) && result.children.length) {
    result.children = (result.children as SDUINode[]).map(_reassignIds);
  }
  return result as SDUINode;
}

/**
 * Patch a node in either pageNodes or canvasNodes.
 * Tries pageNodes first; if unchanged, falls back to canvasNodes.
 */
function patchAnyNode(
  s: { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] },
  id: string,
  patcher: (n: SDUINode) => SDUINode,
): Partial<{ pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }> {
  const newPageNodes = patchNodeById(s.pageNodes, id, patcher);
  if (newPageNodes !== s.pageNodes) return { pageNodes: newPageNodes };
  // Search canvas nodes — both top-level and nested children
  for (let i = 0; i < s.canvasNodes.length; i++) {
    const cn = s.canvasNodes[i];
    const cnAsArr = [cn] as SDUINode[];
    const patched = patchNodeById(cnAsArr, id, patcher);
    if (patched[0] !== cn) {
      const newCN = [...s.canvasNodes];
      newCN[i] = { ...(patched[0] as CanvasNode), _cx: cn._cx, _cy: cn._cy, _cw: cn._cw, _ch: cn._ch };
      return { canvasNodes: newCN };
    }
  }
  return {};
}

/** Empty history snapshot — used as the initial/cleared state. */
const EMPTY_SNAPSHOT: HistorySnapshot = { pages: {}, canvasNodes: [] };

/**
 * Build a full history snapshot from current store state.
 * Captures all page nodes, page positions, and canvas nodes.
 */
function makeSnapshot(
  pages: BuilderPage[],
  focusedPageId: string,
  _pageNodes: SDUINode[],
  canvasNodes: CanvasNode[],
  prevSnap?: HistorySnapshot,
): HistorySnapshot {
  const pagesSnap: HistorySnapshot['pages'] = {};
  for (const p of pages) {
    const prevPage = prevSnap?.pages[p.id];
    if (prevPage && prevPage.nodes === p.nodes) {
      pagesSnap[p.id] = prevPage;
    } else {
      pagesSnap[p.id] = { nodes: p.nodes as SDUINode[], wx: p.wx ?? 0, wy: p.wy ?? 0 };
    }
  }
  return {
    pages: pagesSnap,
    canvasNodes: [...canvasNodes],
    sharedComponents: JSON.parse(JSON.stringify(getSharedComponents())),
  };
}

/**
 * Auto-assign world positions to pages that have wx=0 and wy=0 (migration from old grid layout).
 * Only assigns positions to pages whose wx/wy have never been set (i.e. are both exactly 0
 * AND their index in the array is > 0, meaning they're not the origin page).
 */
function assignDefaultPagePositions(pages: BuilderPage[], vpWidth: number): BuilderPage[] {
  const GAP = 80;
  return pages.map((p, i) => {
    if (p.wx === 0 && p.wy === 0 && i > 0) {
      return { ...p, wx: i * (vpWidth + GAP), wy: 0 };
    }
    return p;
  });
}


// ─── Store shape — types extracted to _store-types.ts ─────────────────────────
// Re-exported here for backward compat; import from _store-types.ts directly
// when you only need the type shapes (avoids loading the full Zustand store).

export type {
  GridOverlayConfig, ViewportSize,
  DataSourceHeader, DataSourceParam, DataSourceAuth,
  Folder, CustomVar, CustomColor, DataSourceConfig,
  PageMeta, BuilderPage, HistorySnapshot, CanvasNode,
  WorkflowMeta, WorkflowParam, WorkflowCanvasTarget,
  BuilderStore,
  AiChatMessage, AiChatRole, AiToolCall,
} from './_store-types';
export { VIEWPORT_WIDTHS } from './_store-types';

// Local alias used by the implementation below (avoids re-importing each name)
import type {
  GridOverlayConfig, ViewportSize, DataSourceConfig, CustomVar, CustomColor,
  Folder, WorkflowMeta, WorkflowCanvasTarget, BuilderStore,
  BuilderPage, PageMeta, HistorySnapshot, CanvasNode,
} from './_store-types';
import { VIEWPORT_WIDTHS } from './_store-types';

// ─── localStorage persistence helpers ────────────────────────────────────────

function _loadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function _saveJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota exceeded etc. */ }
}

/** localStorage key for builder preview data (Run / Use as preview). Survives refresh. */
export const BUILDER_PREVIEW_DATA_KEY = 'builder:previewData';

/** Persist a top-level preview key so it survives page refresh. Call from Run and Use as preview. */
export function persistPreviewData(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  const current = _loadJson<Record<string, unknown>>(BUILDER_PREVIEW_DATA_KEY, {});
  _saveJson(BUILDER_PREVIEW_DATA_KEY, { ...current, [key]: value });
}

/** Restore persisted preview data for hydration on page load. */
export function restorePreviewData(): Record<string, unknown> {
  return _loadJson<Record<string, unknown>>(BUILDER_PREVIEW_DATA_KEY, {});
}

/** localStorage key for data source last-fetch results. Keyed by datasource ID. */
const BUILDER_DS_FETCH_KEY = 'builder:dsFetch';

/** Persist the last-fetch result for a datasource so it survives page refresh. */
export function persistDsLastFetch(id: string, fetch: DataSourceConfig['_lastFetch']) {
  if (typeof window === 'undefined') return;
  const current = _loadJson<Record<string, unknown>>(BUILDER_DS_FETCH_KEY, {});
  if (fetch) {
    _saveJson(BUILDER_DS_FETCH_KEY, { ...current, [id]: fetch });
  } else {
    const next = { ...current };
    delete next[id];
    _saveJson(BUILDER_DS_FETCH_KEY, next);
  }
}

/** Restore all persisted last-fetch results (keyed by datasource ID). */
export function restoreDsLastFetches(): Record<string, DataSourceConfig['_lastFetch']> {
  return _loadJson(BUILDER_DS_FETCH_KEY, {});
}

/** localStorage key for workflow step test results. Keyed by step ID. */
const BUILDER_WORKFLOW_TEST_KEY = 'builder:workflowTest';

/** Persist a single workflow step test result. Pass `undefined` to clear. */
export function persistWorkflowStepTestResult(stepId: string, entry: import('./_store-types').WorkflowTestEntry | undefined) {
  if (typeof window === 'undefined') return;
  const current = _loadJson<Record<string, unknown>>(BUILDER_WORKFLOW_TEST_KEY, {});
  if (entry) {
    _saveJson(BUILDER_WORKFLOW_TEST_KEY, { ...current, [stepId]: entry });
  } else {
    const next = { ...current };
    delete next[stepId];
    _saveJson(BUILDER_WORKFLOW_TEST_KEY, next);
  }
}

/** Restore all persisted workflow step test results on store init. */
export function restoreWorkflowTestResults(): Record<string, import('./_store-types').WorkflowTestEntry> {
  return _loadJson(BUILDER_WORKFLOW_TEST_KEY, {});
}

// ─── Store ────────────────────────────────────────────────────────────────────

// Registry for resolveScreenConfig — layouts used for $slot injection.
// fragments is empty: all reusable content is now in shared-components.json.
const _fragmentRegistry: ConfigRegistry = {
  layouts: root.layouts as ConfigRegistry['layouts'],
  fragments: root.fragments as ConfigRegistry['fragments'],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** localStorage key: maps legacy positional IDs → stable UUIDs */
const NODE_ID_MAP_KEY = 'builder:nodeIdMap';

/**
 * For a given legacy positional key (e.g. "signIn-formcontainer-54"), return
 * a stable UUID. Creates and persists a new UUID on first call; returns the
 * same UUID on every subsequent call — even across page reloads.
 */
function _stableUUID(legacyKey: string): string {
  if (typeof window === 'undefined') return legacyKey;
  const map = _loadJson<Record<string, string>>(NODE_ID_MAP_KEY, {});
  if (map[legacyKey]) return map[legacyKey];
  const uuid = crypto.randomUUID();
  map[legacyKey] = uuid;
  _saveJson(NODE_ID_MAP_KEY, map);
  return uuid;
}

/**
 * Recursively ensure every node in the tree has a unique `id`.
 * SDUI screen configs are render-only trees — they have no `id` fields.
 * The builder requires `id` on every node so:
 *   • the renderer stamps `data-builder-id` on the DOM element
 *   • the overlay can hit-test and select nodes
 *   • findNode / moveNode / patchProp can locate nodes in the tree
 *
 * If a node already has a UUID-shaped id, it is kept as-is (drag-dropped
 * nodes already have `crypto.randomUUID()` IDs). Otherwise a stable UUID
 * is derived from the positional key via _stableUUID so the same node
 * always gets the same UUID across page reloads.
 */
function _assignIds(nodes: SDUINode[], prefix: string, ctr: { n: number }): SDUINode[] {
  return nodes.map(node => {
    ctr.n += 1;
    const existing = node.id as string | undefined;
    let id: string;
    if (existing && UUID_RE.test(existing)) {
      id = existing;
    } else {
      const legacyKey = existing ?? `${prefix}-${String(node.type ?? 'node').toLowerCase()}-${ctr.n}`;
      id = _stableUUID(legacyKey);
    }
    const children = Array.isArray(node.children)
      ? _assignIds(node.children as SDUINode[], prefix, ctr)
      : node.children;
    return { ...node, id, children } as SDUINode;
  });
}

function _extractPageNodes(configName: string): SDUINode[] {
  const screen = root.screens[configName as keyof typeof root.screens];
  if (!screen) return [];
  try {
    const resolved = resolveScreenConfig(
      screen as Parameters<typeof resolveScreenConfig>[0],
      _fragmentRegistry,
    );
    const ui = (resolved as { ui?: unknown }).ui as SDUINode | SDUINode[] | undefined;
    if (!ui) return [];
    const raw = Array.isArray(ui) ? ui : [ui];
    return _assignIds(raw, configName, { n: 0 });
  } catch {
    return [];
  }
}

// Initialise one page per route pre-populated with the screen's content nodes.
const ROUTE_PAGES: BuilderPage[] = (routesConfig as { routes: Array<{ path: string; config: string }> })
  .routes.map((r, i) => {
    const screen = root.screens[r.config as keyof typeof root.screens] as
      | { queryParams?: Array<{ name: string; value: string }> }
      | undefined;
    return {
      id: `page-${r.config}`,
      name: r.config,
      route: r.path,
      nodes: _extractPageNodes(r.config),
      ...(screen?.queryParams ? { queryParams: screen.queryParams } : {}),
      wx: i * (1280 + 80),
      wy: 0,
    };
  });

const INITIAL_PAGES: BuilderPage[] = ROUTE_PAGES;

// ─── Auto-sync middleware: keeps pageNodes ↔ pages[focusedIdx].nodes in sync ──
// Three cases:
//   1. pageNodes changed → copy ref into pages[focusedIdx].nodes
//   2. pages changed without pageNodes → derive pageNodes from pages[focusedIdx].nodes
//   3. focusedPageId changed → derive pageNodes from the new page
function _syncPageNodesMiddleware(
  state: BuilderStore,
  updates: Partial<BuilderStore>,
): Partial<BuilderStore> {
  const hasPageNodes = 'pageNodes' in updates;
  const hasPages = 'pages' in updates;
  const hasFocusChange = 'focusedPageId' in updates && updates.focusedPageId !== state.focusedPageId;

  if (!hasPageNodes && !hasPages && !hasFocusChange) return updates;

  const result = { ...updates };

  // Keep deprecated currentPageId alias in sync
  if (hasFocusChange) {
    (result as Record<string, unknown>).currentPageId = result.focusedPageId;
  }
  const focusId = (result.focusedPageId ?? state.focusedPageId) as string;
  const effectivePages = (result.pages ?? state.pages) as BuilderPage[];

  if (hasPageNodes && !hasPages) {
    // Case 1: mutation changed pageNodes → sync into pages array
    const idx = effectivePages.findIndex(p => p.id === focusId);
    if (idx >= 0 && effectivePages[idx].nodes !== result.pageNodes) {
      const newPages = [...effectivePages];
      newPages[idx] = { ...newPages[idx], nodes: result.pageNodes as SDUINode[] };
      result.pages = newPages as BuilderPage[];
    }
  } else if (hasPageNodes && hasPages) {
    // Both changed — ensure consistency
    const idx = (result.pages as BuilderPage[]).findIndex(p => p.id === focusId);
    if (idx >= 0 && (result.pages as BuilderPage[])[idx].nodes !== result.pageNodes) {
      const newPages = [...(result.pages as BuilderPage[])];
      newPages[idx] = { ...newPages[idx], nodes: result.pageNodes as SDUINode[] };
      result.pages = newPages as BuilderPage[];
    }
  } else if (hasPages && !hasPageNodes) {
    // Case 2: pages changed (undo/redo) → derive pageNodes
    const target = (result.pages as BuilderPage[]).find(p => p.id === focusId);
    if (target) result.pageNodes = target.nodes as SDUINode[];
  } else if (hasFocusChange && !hasPageNodes) {
    // Case 3: focus changed → derive pageNodes from new page
    const target = effectivePages.find(p => p.id === focusId);
    if (target) result.pageNodes = target.nodes as SDUINode[];
  }

  return result;
}

export const useBuilderStore = create<BuilderStore>((_rawSet, get) => {
  // Wrap set to auto-sync pageNodes ↔ pages
  const set: typeof _rawSet = (partial, replace) => {
    if (typeof partial === 'function') {
      _rawSet((state) => {
        const updates = partial(state);
        if (!updates || typeof updates !== 'object') return updates;
        return _syncPageNodesMiddleware(state, updates as Partial<BuilderStore>) as Partial<BuilderStore>;
      }, replace);
    } else {
      _rawSet((state) => {
        if (!partial || typeof partial !== 'object') return partial;
        return _syncPageNodesMiddleware(state, partial as Partial<BuilderStore>) as Partial<BuilderStore>;
      }, replace);
    }
  };

  return ({
  // Start blank — loadFromConfig populates pages for admin mode or loads from backend
  pages: [],
  focusedPageId: '',
  currentPageId: '',   // deprecated alias — kept for backward compat, always mirrors focusedPageId
  canvasNodes: [],
  loadedPageIds: new Set<string>(),
  pageNodes: [],
  selectedIds: [],
  selectedMapIndex: null,
  hoveredId: null,
  hoveredMapIndex: null,
  altHoveredId: null,
  altMode: false,
  lockedIds: new Set(),
  hiddenIds: new Set(),
  expandedIds: new Set(),
  shownPopovers: new Set(),
  tool: 'select',
  zoom: 0.75,
  panX: 0,
  panY: 0,
  viewport: 'desktop',
  activeBreakpoint: 'desktop',
  gridOverlay: { enabled: false, type: 'columns', count: 12, color: 'rgba(99,102,241,0.15)' },
  clipboard: [],
  history: [EMPTY_SNAPSHOT],
  historyIdx: 0,
  pendingFitToPage: false,
  _savedPageNodes: null,
  _editEntrySelection: null,
  editingSharedComponentIds: [],
  editingSharedComponentId: null,
  editingSharedComponentContentsMap: {},
  editingSharedComponentModelsMap: {},
  editingSharedComponentContent: null,
  editingSharedComponentModel: null,
  editingKind: 'shared',
  editingKindMap: {},
  _preEditInstanceSnapshot: {},
  activePreviewStates: ['normal'],
  showInteractionLines: false,
  activeLogicSection: null,
  pageWorkflows: {},
  pageWorkflowMeta: {},
  directActionsMap: {},
  globalWorkflows: {},
  globalWorkflowMeta: {},
  globalFormulas: {},
  workflowTestResults: restoreWorkflowTestResults(),
  workflowCanvasTarget: null,
  varFolders: [],
  dsFolders: [],
  colorFolders: [],
  customVars: [],
  customColors: [],
  pageDataSources: [],
  dsActionsMap: {} as Record<string, string>,
  engineConventions: {},
  authConfig: undefined,
  appPreviewData: (() => {
    const defaults: Record<string, unknown> = {
    // ── Auth ──────────────────────────────────────────────────────────────────
    'auth.user': { id: 'u1', firstName: 'Jane', lastName: 'Doe', emailAddress: 'jane@example.com' },

    // ── Nav ───────────────────────────────────────────────────────────────────
    'nav.collections': [
      { name: 'Women', slug: 'women' },
      { name: 'Men', slug: 'men' },
      { name: 'Accessories', slug: 'accessories' },
      { name: 'Sale', slug: 'sale' },
    ],

    // ── Cart (priceWithTax values are in cents × 100) ─────────────────────────
    'cart.currencyCode': 'USD',
    'cart.totalQuantity': 2,
    'cart.subTotalWithTax': 14998,
    'cart.totalWithTax': 16498,
    'cart.shippingWithTax': 1500,
    'cart.couponCodes': [],
    'cart.discounts': [],
    'cart.lines': [
      {
        id: 'l1', quantity: 1, linePriceWithTax: 8999, unitPriceWithTax: 8999,
        productVariant: {
          name: 'Classic Tee — M', sku: 'CT-M-001',
          product: {
            name: 'Classic Tee', slug: 'classic-tee',
            featuredAsset: { preview: 'https://placehold.co/80x80/e2e8f0/475569?text=Tee' },
          },
        },
      },
      {
        id: 'l2', quantity: 1, linePriceWithTax: 5999, unitPriceWithTax: 5999,
        productVariant: {
          name: 'Canvas Tote — Natural', sku: 'TO-NAT-001',
          product: {
            name: 'Canvas Tote', slug: 'canvas-tote',
            featuredAsset: { preview: 'https://placehold.co/80x80/e2e8f0/475569?text=Tote' },
          },
        },
      },
    ],

    // ── Home — featured products (product-card fragment shape) ────────────────
    'featured.products': [
      { slug: 'classic-tee', productName: 'Classic Tee', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Tee' }, priceWithTax: { __typename: 'SinglePrice', value: 8999 } },
      { slug: 'canvas-tote', productName: 'Canvas Tote', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Tote' }, priceWithTax: { __typename: 'SinglePrice', value: 5999 } },
      { slug: 'knit-sweater', productName: 'Knit Sweater', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Sweater' }, priceWithTax: { __typename: 'SinglePrice', value: 12999 } },
      { slug: 'leather-belt', productName: 'Leather Belt', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Belt' }, priceWithTax: { __typename: 'SinglePrice', value: 4500 } },
    ],

    // ── Collection page ───────────────────────────────────────────────────────
    'collection.search.totalItems': 24,
    'collection.search.items': [
      { slug: 'classic-tee', productName: 'Classic Tee', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Tee' }, priceWithTax: { __typename: 'SinglePrice', value: 8999 } },
      { slug: 'canvas-tote', productName: 'Canvas Tote', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Tote' }, priceWithTax: { __typename: 'SinglePrice', value: 5999 } },
      { slug: 'knit-sweater', productName: 'Knit Sweater', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Sweater' }, priceWithTax: { __typename: 'SinglePrice', value: 12999 } },
      { slug: 'leather-belt', productName: 'Leather Belt', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Belt' }, priceWithTax: { __typename: 'SinglePrice', value: 4500 } },
      { slug: 'linen-shirt', productName: 'Linen Shirt', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Shirt' }, priceWithTax: { __typename: 'SinglePrice', value: 7500 } },
      { slug: 'wool-scarf', productName: 'Wool Scarf', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Scarf' }, priceWithTax: { __typename: 'SinglePrice', value: 3500 } },
    ],
    'collection.facetGroups': [
      { id: 'cat', key: 'category', items: [{ facetValue: { id: 'women', name: 'Women' }, count: 12 }, { facetValue: { id: 'men', name: 'Men' }, count: 8 }] },
      { id: 'col', key: 'color', items: [{ facetValue: { id: 'black', name: 'Black' }, count: 6 }, { facetValue: { id: 'white', name: 'White' }, count: 5 }] },
    ],
    'collection.resultsHeaderText': 'Women',

    // ── Search page ───────────────────────────────────────────────────────────
    'search.totalItems': 8,
    'search.resultsHeaderText': '8 results for "tee"',
    'search.resultsHeadingText': 'Search Results',
    'search.items': [
      { slug: 'classic-tee', productName: 'Classic Tee', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Tee' }, priceWithTax: { __typename: 'SinglePrice', value: 8999 } },
      { slug: 'linen-shirt', productName: 'Linen Shirt', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Shirt' }, priceWithTax: { __typename: 'SinglePrice', value: 7500 } },
      { slug: 'knit-sweater', productName: 'Knit Sweater', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Sweater' }, priceWithTax: { __typename: 'SinglePrice', value: 12999 } },
    ],
    'search.facetGroups': [
      { id: 'cat', key: 'category', items: [{ facetValue: { id: 'women', name: 'Women' }, count: 5 }, { facetValue: { id: 'men', name: 'Men' }, count: 3 }] },
    ],

    // ── Product detail page ───────────────────────────────────────────────────
    'product.name': 'Classic Tee',
    'product.description': '<p>A comfortable everyday essential made from 100% organic cotton. Soft, breathable, and versatile.</p>',
    'product.assets': [
      { preview: 'https://placehold.co/600x600/f1f5f9/475569?text=Front', source: 'https://placehold.co/800x800/f1f5f9/475569?text=Front' },
      { preview: 'https://placehold.co/600x600/e2e8f0/475569?text=Back', source: 'https://placehold.co/800x800/e2e8f0/475569?text=Back' },
    ],
    'product.currentImage': { source: 'https://placehold.co/800x800/f1f5f9/475569?text=Front' },
    'product.imageIndex': 0,
    'product.optionGroups': [
      { id: 'size', name: 'Size', options: [{ id: 'xs', name: 'XS' }, { id: 'sm', name: 'S' }, { id: 'md', name: 'M' }, { id: 'lg', name: 'L' }] },
      { id: 'color', name: 'Color', options: [{ id: 'white', name: 'White' }, { id: 'black', name: 'Black' }, { id: 'navy', name: 'Navy' }] },
    ],
    'product.selectedOptions': { size: 'md', color: 'white' },
    'product.selectedVariant': { priceWithTax: 8999, stockLevel: 'IN_STOCK', sku: 'CT-M-WHT-001' },

    // ── Related products (product page carousel) ──────────────────────────────
    'related.products': [
      { slug: 'canvas-tote', productName: 'Canvas Tote', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Tote' }, priceWithTax: { __typename: 'SinglePrice', value: 5999 } },
      { slug: 'knit-sweater', productName: 'Knit Sweater', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Sweater' }, priceWithTax: { __typename: 'SinglePrice', value: 12999 } },
      { slug: 'leather-belt', productName: 'Leather Belt', currencyCode: 'USD', productAsset: { preview: 'https://placehold.co/400x400/f1f5f9/475569?text=Belt' }, priceWithTax: { __typename: 'SinglePrice', value: 4500 } },
    ],
  };
    const persisted = restorePreviewData();
    const merged = { ...defaults };
    for (const [k, v] of Object.entries(persisted)) {
      if (!k.includes('.')) {
        for (const dk of Object.keys(merged)) {
          if (dk.startsWith(k + '.')) delete merged[dk];
        }
      }
      merged[k] = v;
    }
    return merged;
  })(),
  themeOverrides: {},
  themeDarkOverrides: {},

  // ── Page mutations ──────────────────────────────────────────────────────────

  addSection: (variantId, node, atIdx) => {
    set(s => {
      const nodes = [...s.pageNodes];
      const idx = atIdx !== undefined ? atIdx : nodes.length;
      nodes.splice(idx, 0, node);
      return { pageNodes: nodes };
    });
    get()._pushHistory();
  },

  addNode: (node, parentId = null, atIdx) => {
    const preNodes = get().pageNodes as SDUINode[];
    const preRoots = _collectSharedRoots(preNodes, [parentId]);
    set(s => {
      const pageNodes = insertNode(s.pageNodes, node, parentId ?? null, atIdx);
      const insertedId = node.id;
      return {
        pageNodes,
        selectedIds: insertedId ? [insertedId] : s.selectedIds,
      };
    });
    // Sync every SC root whose subtree was affected by this insertion.
    // (Typically 0 or 1 — either parent is inside an SC or it isn't.)
    for (const [rootId, snap] of preRoots) {
      get()._syncSharedInstances(rootId, { prevEditedNode: snap });
    }
    get()._pushHistory();
  },

  // Insert a node (with freshly-assigned IDs) into a specific page by ID.
  // Does NOT switch the active page — safe for parallel background generation.
  insertNodeIntoPage: (pageId, node) => {
    set(s => {
      const assignedNode = _assignIds([node], pageId, { n: Date.now() })[0];
      const pages = (s.pages as BuilderPage[]).map(p =>
        p.id === pageId
          ? { ...p, nodes: [...(p.nodes as SDUINode[]), assignedNode] }
          : p
      );
      if (s.focusedPageId === pageId) {
        return { pages, pageNodes: pages.find(p => p.id === pageId)!.nodes as SDUINode[] };
      }
      return { pages };
    });
  },

  // Prepend a node (Nav) at the beginning of a specific page.
  prependNodeIntoPage: (pageId, node) => {
    set(s => {
      const assignedNode = _assignIds([node], `${pageId}-prepend`, { n: Date.now() })[0];
      const pages = (s.pages as BuilderPage[]).map(p =>
        p.id === pageId
          ? { ...p, nodes: [assignedNode, ...(p.nodes as SDUINode[])] }
          : p
      );
      if (s.focusedPageId === pageId) {
        return { pages, pageNodes: pages.find(p => p.id === pageId)!.nodes as SDUINode[] };
      }
      return { pages };
    });
  },

  // Append a node (Footer) at the end of a specific page.
  appendNodeIntoPage: (pageId, node) => {
    set(s => {
      const assignedNode = _assignIds([node], `${pageId}-append`, { n: Date.now() })[0];
      const pages = (s.pages as BuilderPage[]).map(p =>
        p.id === pageId
          ? { ...p, nodes: [...(p.nodes as SDUINode[]), assignedNode] }
          : p
      );
      if (s.focusedPageId === pageId) {
        return { pages, pageNodes: pages.find(p => p.id === pageId)!.nodes as SDUINode[] };
      }
      return { pages };
    });
  },

  // Append a child node into an existing node by ID — used for progressive AI streaming.
  // Finds the target node anywhere in the page tree and appends the child to its children array.
  appendChildToNode: (pageId, nodeId, child) => {
    set(s => {
      const assignedChild = _assignIds([child], `${pageId}-child`, { n: Date.now() })[0];

      const appendToNode = (nodes: SDUINode[]): SDUINode[] =>
        nodes.map(n => {
          if (n.id === nodeId) {
            return { ...n, children: [...((n.children as SDUINode[]) ?? []), assignedChild] };
          }
          if (Array.isArray(n.children)) {
            return { ...n, children: appendToNode(n.children as SDUINode[]) };
          }
          return n;
        });

      const pages = (s.pages as BuilderPage[]).map(p => {
        if (p.id !== pageId) return p;
        const updatedNodes = appendToNode(p.nodes as SDUINode[]);
        return { ...p, nodes: updatedNodes };
      });

      if (s.focusedPageId === pageId) {
        return { pages, pageNodes: pages.find(p => p.id === pageId)!.nodes as SDUINode[] };
      }
      return { pages };
    });
  },

  moveNode: (nodeId, newParentId, atIdx) => {
    // Capture SC roots BEFORE the move:
    //  • ancestor of the node being moved (source SC — may lose the child)
    //  • ancestor of the destination parent (target SC — may gain the child)
    // Both need to be synced post-op, because the source SC only exists as
    // the child's ancestor before the move, and the target SC only contains
    // the child after the move.
    const preNodes = get().pageNodes as SDUINode[];
    const preRoots = _collectSharedRoots(preNodes, [nodeId, newParentId]);

    set(s => {
      const node = findNode(s.pageNodes, nodeId);
      if (!node) return s;
      if (isNonDraggable(node)) return s;

      if (newParentId === nodeId) return s;
      if (newParentId && findNode((findNode(s.pageNodes, nodeId)?.children ?? []) as SDUINode[], newParentId)) return s;

      if (node.type && REQUIRED_PARENT[node.type]) {
        const requiredType = REQUIRED_PARENT[node.type];
        const newParent = newParentId ? findNode(s.pageNodes, newParentId) : null;
        if (!newParent || newParent.type !== requiredType) return s;
      }
      if (newParentId) {
        const newParent = findNode(s.pageNodes, newParentId);
        if (newParent && ALLOWED_CHILDREN[newParent.type] && !ALLOWED_CHILDREN[newParent.type].has(node.type)) return s;
      }

      const currentParent = findParentNode(s.pageNodes, nodeId);
      const currentParentId = currentParent?.id ?? null;
      const currentSiblings = currentParent
        ? (currentParent.children as SDUINode[])
        : s.pageNodes;
      const currentIdx = currentSiblings.findIndex(n => n.id === nodeId);

      let adjustedIdx = atIdx;
      if (newParentId === currentParentId && atIdx > currentIdx) {
        adjustedIdx = atIdx - 1;
      }

      const withoutNode = removeNodesByIds(s.pageNodes, new Set([nodeId]));
      const newNodes = insertNode(withoutNode, node, newParentId, adjustedIdx);
      return { pageNodes: newNodes, selectedIds: [nodeId] };
    });

    // Also look at POST-op ancestry (in case the moved node landed in an SC
    // that wasn't on our pre-op radar — e.g. new parent is at root and we
    // already captured its absence-of-SC, or it's been rearranged). Harmless
    // duplicate detection via the Map keyed on rootId.
    const postNodes = get().pageNodes as SDUINode[];
    const postRoot = findLinkedRoot(postNodes, nodeId, 'any');
    if (postRoot?.id && !preRoots.has(postRoot.id)) {
      preRoots.set(postRoot.id, JSON.parse(JSON.stringify(postRoot)) as SDUINode);
    }
    for (const [rootId, snap] of preRoots) {
      get()._syncSharedInstances(rootId, { prevEditedNode: snap });
    }
    get()._pushHistory();
  },

  moveNodes: (nodeIds, newParentId, atIdx) => {
    // Capture SC roots BEFORE the mutation for every moving node + destination
    // parent. Multiple nodes may live under different SC ancestors; all of
    // them need to be synced post-op (the source SCs to drop the children,
    // the destination SC to pick them up).
    const preNodes = get().pageNodes as SDUINode[];
    const preRoots = _collectSharedRoots(preNodes, [...nodeIds, newParentId]);

    set(s => {
      // Guard: refuse to drop the selection into one of the nodes being moved.
      // The UI's onDragOver should prevent this, but defend here too.
      const nodeIdSet0 = new Set(nodeIds);
      if (newParentId && nodeIdSet0.has(newParentId)) return s;

      // Keep only the "topmost" IDs — if a node's ancestor is also in the list,
      // skip it: it will be carried along as part of its ancestor's subtree.
      // This prevents ButtonText (child of Button) from being inserted as an
      // independent node when both Button and ButtonText happen to be selected.
      const nodeIdSet = new Set(nodeIds);
      const topMostIds = nodeIds.filter(id => {
        let parent = findParentNode(s.pageNodes, id);
        while (parent !== null && parent !== undefined) {
          if (nodeIdSet.has(parent.id ?? '')) return false;
          parent = findParentNode(s.pageNodes, parent.id ?? '');
        }
        return true;
      });

      // Collect valid nodes to move (filter out invalid/cyclic cases)
      const nodesToMove: SDUINode[] = [];
      for (const id of topMostIds) {
        const found = findNode(s.pageNodes, id);
        if (!found?.id) continue;
        if (newParentId === found.id) continue;
        if (newParentId && findNode((found.children ?? []) as SDUINode[], newParentId)) continue;
        nodesToMove.push(found);
      }
      if (nodesToMove.length === 0) return s;

      const targetChildren = newParentId
        ? ((findNode(s.pageNodes, newParentId)?.children ?? []) as SDUINode[])
        : s.pageNodes;
      const movingIds = new Set(nodesToMove.map(n => n.id!));
      let removedBeforeTarget = 0;
      for (let i = 0; i < atIdx && i < targetChildren.length; i++) {
        if (movingIds.has(targetChildren[i].id ?? '')) removedBeforeTarget++;
      }
      const adjustedIdx = Math.max(0, atIdx - removedBeforeTarget);

      // removeNodesByIds/insertNode create new arrays — no clone needed
      let result = removeNodesByIds(s.pageNodes, movingIds);
      for (let i = 0; i < nodesToMove.length; i++) {
        result = insertNode(result, nodesToMove[i], newParentId, adjustedIdx + i);
      }
      return { pageNodes: result, selectedIds: [...movingIds] };
    });

    // Also catch post-op roots for any moving node that landed inside an SC
    // not on our pre-op radar.
    const postNodes = get().pageNodes as SDUINode[];
    for (const id of nodeIds) {
      const postRoot = findLinkedRoot(postNodes, id, 'any');
      if (postRoot?.id && !preRoots.has(postRoot.id)) {
        preRoots.set(postRoot.id, JSON.parse(JSON.stringify(postRoot)) as SDUINode);
      }
    }
    for (const [rootId, snap] of preRoots) {
      get()._syncSharedInstances(rootId, { prevEditedNode: snap });
    }
    get()._pushHistory();
  },

  moveNodeFromPage: (nodeId, fromPageId, parentId, atIdx) => {
    // Capture SC roots BEFORE the cross-page move:
    //  • any SC on the SOURCE page that contains the moved node
    //  • any SC on the DESTINATION (focused) page that contains the parent
    // Both may need to receive a model update afterwards.
    const srcPageNodes = (get().pages as BuilderPage[]).find(p => p.id === fromPageId)?.nodes as SDUINode[] | undefined;
    const srcPreRoots = srcPageNodes ? _collectSharedRoots(srcPageNodes, [nodeId]) : new Map<string, SDUINode>();
    const dstPreRoots = _collectSharedRoots(get().pageNodes as SDUINode[], [parentId]);

    set(s => {
      // Find the source page
      const srcPage = s.pages.find(p => p.id === fromPageId);
      if (!srcPage) return s;

      // Find the node in the source page
      const node = findNode(srcPage.nodes as SDUINode[], nodeId);
      if (!node) return s;

      // removeNodesByIds/insertNode create new arrays — no clone needed
      const updatedSrcNodes = removeNodesByIds(srcPage.nodes as SDUINode[], new Set([nodeId]));
      const updatedPages = s.pages.map(p =>
        p.id === fromPageId ? { ...p, nodes: updatedSrcNodes } : p
      );

      const newPageNodes = insertNode(s.pageNodes, node, parentId, atIdx);

      return {
        pages: updatedPages,
        pageNodes: newPageNodes,
        selectedIds: node.id ? [node.id] : s.selectedIds,
      };
    });

    // Destination is the focused page, so `_syncSharedInstances` (which only
    // walks the focused page for editedNodeId lookup) handles SC roots there.
    // Source-page SC roots are trickier: the SC root still lives on the
    // source page (not the focused one), so `findSharedRoot(pageNodes, ...)`
    // in `_syncSharedInstances` would return null. We therefore propagate
    // source-page model updates directly using the pre-op snapshot.
    for (const [rootId, snap] of srcPreRoots) {
      // If the source page is NOT the focused page, we can't rely on
      // `_syncSharedInstances` to find the root in `pageNodes`. But we can
      // build an equivalent model-update by finding the root in the source
      // page's post-op state and rerunning the sync against a fake context.
      // Simplest approach: temporarily treat as if focused, by directly
      // updating the shared model from the new source-page content.
      const postSrcPage = (get().pages as BuilderPage[]).find(p => p.id === fromPageId);
      const postRoot = postSrcPage ? findNode(postSrcPage.nodes as SDUINode[], rootId) : null;
      if (!postRoot) continue;
      // If the removed node's SC root is on the focused page (rare: tabs?),
      // let the normal call path handle it.
      if (fromPageId === get().focusedPageId) {
        get()._syncSharedInstances(rootId, { prevEditedNode: snap });
        continue;
      }
      // Non-focused source page: manually call sync by temporarily switching
      // pageNodes view. Safer: emulate by invoking sync with a wrapper that
      // pretends the node is on the focused tree. Because _syncSharedInstances
      // only propagates BETWEEN instances on multiple pages (it already
      // iterates `s.pages`), the cleanest fix is to ensure an SC root with
      // that id exists on the focused page. If it doesn't (pure cross-page
      // move OUT of the SC on another page), we update the model directly.
      const rec = postRoot as unknown as Record<string, unknown>;
      const sharedMeta = rec._shared as { id?: string } | undefined;
      const meta = sharedMeta;
      if (!meta?.id) continue;
      const prevModel = getSharedComponents()[meta.id];
      if (!prevModel) continue;
      const content = JSON.parse(JSON.stringify(postRoot)) as Record<string, unknown>;
      delete content._shared;
      delete content._overrides;
      updateSharedComponent({ ...(prevModel as Parameters<typeof updateSharedComponent>[0]), content });
      // Propagate to other pages/instances via a normal sync on one
      // representative instance id if any exist anywhere.
      let repInstanceId: string | null = null;
      for (const page of get().pages as BuilderPage[]) {
        (function walk(nodes: SDUINode[]) {
          if (repInstanceId) return;
          for (const n of nodes) {
            const sm = (n as unknown as Record<string, unknown>)._shared as { id: string } | undefined;
            if (sm?.id === meta.id && n.id) { repInstanceId = n.id; return; }
            if (n.children?.length) walk(n.children as SDUINode[]);
          }
        })(page.nodes as SDUINode[]);
        if (repInstanceId) break;
      }
      if (repInstanceId) get()._syncSharedInstances(repInstanceId, { prevEditedNode: snap });
    }
    // Destination-page roots: standard path.
    for (const [rootId, snap] of dstPreRoots) {
      if (srcPreRoots.has(rootId)) continue;
      get()._syncSharedInstances(rootId, { prevEditedNode: snap });
    }
    const postRoot = findLinkedRoot(get().pageNodes as SDUINode[], nodeId, 'any');
    if (postRoot?.id && !dstPreRoots.has(postRoot.id) && !srcPreRoots.has(postRoot.id)) {
      get()._syncSharedInstances(postRoot.id, { prevEditedNode: JSON.parse(JSON.stringify(postRoot)) as SDUINode });
    }
    get()._pushHistory();
  },

  deleteNodes: (ids) => {
    const { editingSharedComponentContentsMap, pageNodes: preNodes } = get();
    const protectedRootIds = new Set(
      Object.values(editingSharedComponentContentsMap).map(c => (c as unknown as { id?: string }).id).filter(Boolean)
    );
    const idSet = new Set(ids.filter(id => !protectedRootIds.has(id)));
    if (idSet.size === 0) return;
    // Capture PRE-op SC root snapshots for every deleted node that lives
    // inside an SC subtree. Skip entries where the deleted node IS the SC
    // root itself (there's nothing left to sync in that case).
    const affectedSharedRoots = new Map<string, SDUINode>();
    for (const id of idSet) {
      const root = findLinkedRoot(preNodes as SDUINode[], id, 'any');
      if (!root?.id || idSet.has(root.id) || affectedSharedRoots.has(root.id)) continue;
      affectedSharedRoots.set(root.id, JSON.parse(JSON.stringify(root)) as SDUINode);
    }
    set(s => ({
      pageNodes: removeNodesByIds(s.pageNodes, idSet),
      canvasNodes: (s.canvasNodes as CanvasNode[]).filter(n => !idSet.has(n.id)),
      selectedIds: s.selectedIds.filter(id => !idSet.has(id)),
      aiSelectedNodeIds: s.aiSelectedNodeIds.filter(id => !idSet.has(id)),
    }));
    for (const [rootId, snap] of affectedSharedRoots) {
      get()._syncSharedInstances(rootId, { prevEditedNode: snap });
    }
    get()._pushHistory();
  },

  duplicateNodes: (ids) => {
    // Capture SC roots for every duplicated id BEFORE the duplication so we
    // can sync each one post-op. Duplicating a node inside an SC subtree
    // effectively inserts a copy into that SC.
    const preNodes = get().pageNodes as SDUINode[];
    const preRoots = _collectSharedRoots(preNodes, ids);

    set(s => {
      const newNodes: SDUINode[] = [];
      for (const id of ids) {
        const found = findNode(s.pageNodes, id);
        if (found) newNodes.push(_reassignIds(clone(found)));
      }
      const nodes = [...s.pageNodes];
      const lastIdx = nodes.findIndex(n => ids.includes(n.id ?? ''));
      const insertAt = lastIdx >= 0 ? lastIdx + 1 : nodes.length;
      nodes.splice(insertAt, 0, ...newNodes);
      return {
        pageNodes: nodes,
        selectedIds: newNodes.map(n => n.id ?? '').filter(Boolean),
      };
    });
    for (const [rootId, snap] of preRoots) {
      get()._syncSharedInstances(rootId, { prevEditedNode: snap });
    }
    get()._pushHistory();
  },

  groupNodes: (ids) => {
    set(s => {
      const idSet = new Set(ids);
      const toGroup = s.pageNodes.filter(n => idSet.has(n.id ?? ''));
      if (!toGroup.length) return s;

      const groupNode: SDUINode = {
        type: 'Box',
        id: `group-${Date.now()}`,
        props: { className: 'flex flex-col' },
        children: clone(toGroup),
      } as SDUINode;

      let inserted = false;
      const newNodes = s.pageNodes
        .map(n => {
          if (idSet.has(n.id ?? '') && !inserted) { inserted = true; return groupNode; }
          if (idSet.has(n.id ?? '')) return null;
          return n;
        })
        .filter(Boolean) as SDUINode[];

      return { pageNodes: newNodes, selectedIds: [groupNode.id!] };
    });
    get()._pushHistory();
  },

  moveSection: (fromIdx, toIdx) => {
    set(s => {
      const nodes = [...s.pageNodes];
      const [moved] = nodes.splice(fromIdx, 1);
      nodes.splice(toIdx, 0, moved);
      return { pageNodes: nodes };
    });
    get()._pushHistory();
  },

  moveNodeUp: (id) => {
    set(s => {
      const parent = findParentNode(s.pageNodes, id);
      const siblings: SDUINode[] = parent
        ? (parent.children as SDUINode[])
        : s.pageNodes;
      const idx = siblings.findIndex(n => n.id === id);
      if (idx < 0) return s;

      const isAbsCls = (n: SDUINode) =>
        /\b(absolute|fixed)\b/.test((n.props as { className?: string })?.className ?? '');
      const currentIsAbs = isAbsCls(siblings[idx]);

      // Absolute "Move Up" = bring forward = higher stacking = later DOM index.
      // Flow    "Move Up" = earlier DOM index, skipping any abs siblings above.
      let targetIdx: number;
      if (currentIsAbs) {
        if (idx >= siblings.length - 1) return s; // already on top
        targetIdx = idx + 1;
      } else {
        if (idx <= 0) return s;
        targetIdx = idx - 1;
        while (targetIdx >= 0 && isAbsCls(siblings[targetIdx])) targetIdx--;
        if (targetIdx < 0) return s;
      }

      const move = (arr: SDUINode[], from: number, to: number) => {
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
      };
      if (!parent) {
        const newNodes = [...s.pageNodes];
        move(newNodes, idx, targetIdx);
        return { pageNodes: newNodes };
      }
      return {
        pageNodes: patchNodeById(s.pageNodes, parent.id!, p => {
          const ch = [...((p.children ?? []) as SDUINode[])];
          move(ch, idx, targetIdx);
          return { ...p, children: ch };
        }),
      };
    });
    get()._syncSharedInstances(id);
    get()._pushHistory();
  },

  moveNodeDown: (id) => {
    set(s => {
      const parent = findParentNode(s.pageNodes, id);
      const siblings: SDUINode[] = parent
        ? (parent.children as SDUINode[])
        : s.pageNodes;
      const idx = siblings.findIndex(n => n.id === id);
      if (idx < 0) return s;

      const isAbsCls = (n: SDUINode) =>
        /\b(absolute|fixed)\b/.test((n.props as { className?: string })?.className ?? '');
      const currentIsAbs = isAbsCls(siblings[idx]);

      let targetIdx: number;
      if (currentIsAbs) {
        if (idx <= 0) return s;
        targetIdx = idx - 1;
      } else {
        if (idx >= siblings.length - 1) return s;
        targetIdx = idx + 1;
        while (targetIdx < siblings.length && isAbsCls(siblings[targetIdx])) targetIdx++;
        if (targetIdx >= siblings.length) return s;
      }

      const move = (arr: SDUINode[], from: number, to: number) => {
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
      };
      if (!parent) {
        const newNodes = [...s.pageNodes];
        move(newNodes, idx, targetIdx);
        return { pageNodes: newNodes };
      }
      return {
        pageNodes: patchNodeById(s.pageNodes, parent.id!, p => {
          const ch = [...((p.children ?? []) as SDUINode[])];
          move(ch, idx, targetIdx);
          return { ...p, children: ch };
        }),
      };
    });
    get()._syncSharedInstances(id);
    get()._pushHistory();
  },

  patchProp: (id, propPath, value) => {
    const prevRootSnap = _snapshotSharedRoot(get(), id);
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => {
      const parts = propPath.split('.');
      if (parts.length === 1) {
        return { ...node, [parts[0]]: value };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const root: any = { ...node };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj: any = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const next = obj[parts[i]] != null ? { ...obj[parts[i]] } : {};
        obj[parts[i]] = next;
        obj = next;
      }
      obj[parts[parts.length - 1]] = value;
      return root;
    }));
    get()._syncSharedInstances(id, prevRootSnap ? { prevEditedNode: prevRootSnap } : undefined);
  },

  patchClassName: (id, oldToken, newToken) => {
    const prevRootSnap = _snapshotSharedRoot(get(), id);
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => {
      const cls: string = (node.props as { className?: string })?.className ?? '';
      const newCls = oldToken
        ? cls.replace(new RegExp(`\\b${oldToken.replace('*', '[^\\s]+')}\\b`, 'g'), newToken).trim()
        : `${cls} ${newToken}`.trim();
      return { ...node, props: { ...(node.props as object), className: newCls } };
    }));
    get()._syncSharedInstances(id, prevRootSnap ? { prevEditedNode: prevRootSnap } : undefined);
  },

  renameNode: (id, newId) => {
    const prevRootSnap = _snapshotSharedRoot(get(), id);
    set(s => ({
      ...patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => ({ ...node, id: newId })),
      selectedIds: s.selectedIds.map(sid => (sid === id ? newId : sid)),
    }));
    get()._syncSharedInstances(newId, prevRootSnap ? { prevEditedNode: prevRootSnap } : undefined);
    get()._pushHistory();
  },

  // ── Selection ───────────────────────────────────────────────────────────────

  select: (id, multi = false, mapIndex) => {
    if (id === null) { set({ selectedIds: [], selectedMapIndex: null, aiSelectedNodeIds: [] }); return; }
    if (get().lockedIds.has(id)) return;
    set(s => {
      if (multi) {
        const already = s.selectedIds.includes(id);
        const newSelectedIds = already
          ? s.selectedIds.filter(sid => sid !== id)
          : [...s.selectedIds, id];
        // In AI mode, keep aiSelectedNodeIds in sync with multi-select
        const newAiIds = s.aiMode
          ? (already ? s.aiSelectedNodeIds.filter(aid => aid !== id) : [...s.aiSelectedNodeIds, id])
          : s.aiSelectedNodeIds;
        // Multi-select clears map index (can't track per-instance for multiple selections)
        return { selectedIds: newSelectedIds, selectedMapIndex: null, aiSelectedNodeIds: newAiIds };
      }
      // Single select: in AI mode, replace aiSelectedNodeIds; otherwise keep
      return {
        selectedIds: [id],
        selectedMapIndex: mapIndex ?? null,
        aiSelectedNodeIds: s.aiMode ? [id] : s.aiSelectedNodeIds,
      };
    });
  },

  selectAll: () => {
    const ids = get().pageNodes.map(n => n.id ?? '').filter(Boolean);
    set({ selectedIds: ids });
  },

  selectParent: (id) => {
    const parent = findParentNode(get().pageNodes, id);
    if (parent === undefined) return; // node not found
    if (parent === null) { set({ selectedIds: [] }); return; } // root → deselect
    if (parent.id) get().select(parent.id);
  },

  selectFirstChild: (id) => {
    const node = findNode(get().pageNodes, id);
    const first = (node?.children as SDUINode[] | undefined)?.[0];
    if (first?.id) get().select(first.id);
  },

  hover: (id, mapIndex) => set({ hoveredId: id, hoveredMapIndex: mapIndex ?? null }),
  setAltMode: (on) => set({ altMode: on }),
  setAltHovered: (id) => set({ altHoveredId: id }),

  // ── Layer toggles ────────────────────────────────────────────────────────────

  toggleVisibility: (id) => {
    set(s => {
      const next = new Set(s.hiddenIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { hiddenIds: next };
    });
  },

  toggleLock: (id) => {
    set(s => {
      const next = new Set(s.lockedIds);
      next.has(id) ? next.delete(id) : next.add(id);
      const selectedIds = next.has(id) ? s.selectedIds.filter(sid => sid !== id) : s.selectedIds;
      return { lockedIds: next, selectedIds };
    });
  },

  toggleExpanded: (id) => {
    set(s => {
      const next = new Set(s.expandedIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { expandedIds: next };
    });
  },

  setExpandedIds: (ids) => set({ expandedIds: ids }),

  // ── Popover builder preview ──────────────────────────────────────────────

  togglePopoverShown: (nodeId) => {
    set(s => {
      const key = `popover:${nodeId}`;
      const next = new Set(s.shownPopovers);
      next.has(key) ? next.delete(key) : next.add(key);
      return { shownPopovers: next };
    });
  },

  setPopoverConfig: (nodeId, config) => {
    set(s => {
      const patcher = (n: SDUINode) => {
        if (config === null) {
          const copy = { ...n } as Record<string, unknown>;
          delete copy['popover'];
          return copy as unknown as SDUINode;
        }
        return { ...n, popover: config } as unknown as SDUINode;
      };
      return patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, nodeId, patcher);
    });
    get()._pushHistory();
  },

  setTool: (t) => set({ tool: t }),

  setZoom: (z) => set({ zoom: z }),
  setPan:  (x, y) => set({ panX: x, panY: y }),
  setViewport: (v) => set({ viewport: v, activeBreakpoint: v }),

  setActiveBreakpoint: (bp) => set({ activeBreakpoint: bp }),

  patchResponsive: (id, breakpoint, field, value) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => {
      const patched = clone(node);
      if (!patched.responsive) patched.responsive = {};
      if (!patched.responsive[breakpoint]) patched.responsive[breakpoint] = {};
      const parts = field.split('.');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj: any = patched.responsive[breakpoint];
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in obj)) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      return patched;
    }));
  },

  removeResponsiveOverride: (id, breakpoint, field) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => {
        if (!node.responsive?.[breakpoint]) return node;
        const patched = clone(node);
        if (field) {
          const parts = field.split('.');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let obj: any = patched.responsive![breakpoint];
          for (let i = 0; i < parts.length - 1; i++) {
            if (!obj || !(parts[i] in obj)) return node;
            obj = obj[parts[i]];
          }
          delete obj[parts[parts.length - 1]];
          if (Object.keys(patched.responsive![breakpoint]!).length === 0) {
            delete patched.responsive![breakpoint];
          }
        } else {
          delete patched.responsive![breakpoint];
        }
        if (patched.responsive && Object.keys(patched.responsive).length === 0) {
          delete patched.responsive;
        }
        return patched;
      }));
  },

  setGridOverlay: (cfg) => set(s => ({ gridOverlay: { ...s.gridOverlay, ...cfg } })),

  // ── Clipboard ────────────────────────────────────────────────────────────────

  copyToClipboard: () => {
    const { selectedIds, pageNodes } = get();
    const nodes = selectedIds.map(id => findNode(pageNodes, id)).filter(Boolean) as SDUINode[];
    set({ clipboard: clone(nodes) });
  },

  pasteFromClipboard: () => {
    const { clipboard, selectedIds, pageNodes } = get();
    if (!clipboard.length) return;
    const pasted = clipboard.map(n => _reassignIds(clone(n)));
    const lastIdx = selectedIds.length
      ? pageNodes.findIndex(n => selectedIds.includes(n.id ?? ''))
      : -1;
    const insertAt = lastIdx >= 0 ? lastIdx + 1 : pageNodes.length;
    set(s => {
      const nodes = [...s.pageNodes];
      nodes.splice(insertAt, 0, ...pasted);
      return {
        pageNodes: nodes,
        selectedIds: pasted.map(n => n.id ?? '').filter(Boolean),
      };
    });
    get()._pushHistory();
  },

  pasteInPlace: () => {
    const { clipboard, pageNodes } = get();
    if (!clipboard.length) return;
    const pasted = clipboard.map(n => _reassignIds(clone(n)));
    set(s => {
      const nodes = [...s.pageNodes];
      nodes.splice(pageNodes.length, 0, ...pasted);
      return {
        pageNodes: nodes,
        selectedIds: pasted.map(n => n.id ?? '').filter(Boolean),
      };
    });
    get()._pushHistory();
  },

  alignNodes: (ids, edge) => {
    if (ids.length < 2) return;
    // Read live bounding rects for all selected nodes
    const rects = ids.map(id => {
      const el = document.querySelector(`[data-builder-id="${id}"]`);
      return el ? el.getBoundingClientRect() : null;
    });
    if (rects.some(r => !r)) return;
    const validRects = rects as DOMRect[];

    let targetValue: number;
    switch (edge) {
      case 'left':   targetValue = Math.min(...validRects.map(r => r.left)); break;
      case 'right':  targetValue = Math.max(...validRects.map(r => r.right)); break;
      case 'center': targetValue = validRects.reduce((s, r) => s + r.left + r.width / 2, 0) / validRects.length; break;
      case 'top':    targetValue = Math.min(...validRects.map(r => r.top)); break;
      case 'bottom': targetValue = Math.max(...validRects.map(r => r.bottom)); break;
      case 'middle': targetValue = validRects.reduce((s, r) => s + r.top + r.height / 2, 0) / validRects.length; break;
    }

    set(s => {
      let nodes = s.pageNodes;
      ids.forEach((id, i) => {
        const r = validRects[i];
        const node = findNode(nodes, id);
        if (!node) return;
        const existingStyle = (node.props as { style?: Record<string, string> })?.style ?? {};
        let newStyle: Record<string, string>;

        if (edge === 'left')   newStyle = { ...existingStyle, position: 'absolute', left: `${targetValue - r.left + parseFloat(existingStyle.left ?? '0')}px` };
        else if (edge === 'right')  newStyle = { ...existingStyle, position: 'absolute', left: `${targetValue - r.right + parseFloat(existingStyle.left ?? '0')}px` };
        else if (edge === 'center') newStyle = { ...existingStyle, position: 'absolute', left: `${targetValue - r.left - r.width / 2 + parseFloat(existingStyle.left ?? '0')}px` };
        else if (edge === 'top')    newStyle = { ...existingStyle, position: 'absolute', top: `${targetValue - r.top + parseFloat(existingStyle.top ?? '0')}px` };
        else if (edge === 'bottom') newStyle = { ...existingStyle, position: 'absolute', top: `${targetValue - r.bottom + parseFloat(existingStyle.top ?? '0')}px` };
        else                        newStyle = { ...existingStyle, position: 'absolute', top: `${targetValue - r.top - r.height / 2 + parseFloat(existingStyle.top ?? '0')}px` };

        // patchNodeById creates new arrays — no pre-clone needed
        nodes = patchNodeById(nodes, id, n => ({
          ...n,
          props: { ...(n.props as object), style: newStyle },
        }));
      });
      return { pageNodes: nodes };
    });
    get()._pushHistory();
  },

  distributeNodes: (ids, axis) => {
    if (ids.length < 3) return;
    const rects = ids.map(id => {
      const el = document.querySelector(`[data-builder-id="${id}"]`);
      return el ? { id, rect: el.getBoundingClientRect() } : null;
    }).filter(Boolean) as { id: string; rect: DOMRect }[];

    if (rects.length < 3) return;

    if (axis === 'h') {
      const sorted = [...rects].sort((a, b) => a.rect.left - b.rect.left);
      const totalSpace = sorted[sorted.length - 1].rect.right - sorted[0].rect.left;
      const totalWidth = sorted.reduce((s, { rect }) => s + rect.width, 0);
      const gap = (totalSpace - totalWidth) / (sorted.length - 1);
      let cursor = sorted[0].rect.left;
      set(s => {
        let nodes = s.pageNodes;
        sorted.forEach(({ id, rect }) => {
          const node = findNode(nodes, id);
          if (!node) return;
          const existingStyle = (node.props as { style?: Record<string, string> })?.style ?? {};
          const currentLeft = parseFloat(existingStyle.left ?? '0');
          const deltaLeft = cursor - rect.left;
          nodes = patchNodeById(nodes, id, n => ({
            ...n,
            props: { ...(n.props as object), style: { ...existingStyle, position: 'absolute', left: `${currentLeft + deltaLeft}px` } },
          }));
          cursor += rect.width + gap;
        });
        return { pageNodes: nodes };
      });
    } else {
      const sorted = [...rects].sort((a, b) => a.rect.top - b.rect.top);
      const totalSpace = sorted[sorted.length - 1].rect.bottom - sorted[0].rect.top;
      const totalHeight = sorted.reduce((s, { rect }) => s + rect.height, 0);
      const gap = (totalSpace - totalHeight) / (sorted.length - 1);
      let cursor = sorted[0].rect.top;
      set(s => {
        let nodes = s.pageNodes;
        sorted.forEach(({ id, rect }) => {
          const node = findNode(nodes, id);
          if (!node) return;
          const existingStyle = (node.props as { style?: Record<string, string> })?.style ?? {};
          const currentTop = parseFloat(existingStyle.top ?? '0');
          const deltaTop = cursor - rect.top;
          nodes = patchNodeById(nodes, id, n => ({
            ...n,
            props: { ...(n.props as object), style: { ...existingStyle, position: 'absolute', top: `${currentTop + deltaTop}px` } },
          }));
          cursor += rect.height + gap;
        });
        return { pageNodes: nodes };
      });
    }
    get()._pushHistory();
  },

  // ── History ──────────────────────────────────────────────────────────────────

  _setPageNodes: (nodes) => {
    // Collect IDs of all nodes that have children so the layers panel shows them expanded.
    function collectContainerIds(ns: SDUINode[]): string[] {
      const ids: string[] = [];
      for (const n of ns) {
        if ((n.children as SDUINode[] | undefined)?.length && n.id) ids.push(n.id);
        if ((n.children as SDUINode[] | undefined)?.length) ids.push(...collectContainerIds(n.children as SDUINode[]));
      }
      return ids;
    }
    const containerIds = collectContainerIds(nodes);
    set(s => ({
      pageNodes: nodes,
      expandedIds: containerIds.length ? new Set([...s.expandedIds, ...containerIds]) : s.expandedIds,
    }));
  },
  _clearHistory: () => {
    set(s => ({
      pageNodes: [],
      history: [EMPTY_SNAPSHOT],
      historyIdx: 0,
      selectedIds: [],
      canvasNodes: [],
    }));
  },

  // ── Page position ─────────────────────────────────────────────────────────────

  movePagePosition: (pageId, wx, wy) => {
    set(s => ({
      pages: (s.pages as BuilderPage[]).map(p =>
        p.id === pageId ? { ...p, wx, wy } : p
      ),
    }));
  },

  rescalePagePositions: (oldVp, newVp) => {
    const oldW = VIEWPORT_WIDTHS[oldVp];
    const newW = VIEWPORT_WIDTHS[newVp];
    if (oldW === newW) return;
    set(s => {
      // Sort pages left-to-right by their current wx.
      const sorted = [...(s.pages as BuilderPage[])].sort(
        (a, b) => (a.wx ?? 0) - (b.wx ?? 0),
      );

      // Walk left-to-right: the leftmost page keeps its wx anchor; each
      // subsequent page is placed so the *absolute pixel gap* between the
      // right edge of its predecessor and its own left edge is preserved
      // exactly as the user set it. Page widths grow/shrink around the gap.
      // If pages were already overlapping at the old viewport, we clamp the
      // gap to 0 (touching edges) rather than carrying the overlap forward.
      const newWx: number[] = [sorted[0].wx ?? 0];
      for (let i = 1; i < sorted.length; i++) {
        const prevOldWx = sorted[i - 1].wx ?? 0;
        const curOldWx  = sorted[i].wx ?? 0;
        const gap = curOldWx - (prevOldWx + oldW); // negative if overlapping
        newWx.push(newWx[i - 1] + newW + Math.max(0, gap));
      }

      const wxById = new Map(sorted.map((p, i) => [p.id, newWx[i]]));

      return {
        pages: (s.pages as BuilderPage[]).map(p => ({
          ...p,
          wx: wxById.get(p.id) ?? (p.wx ?? 0),
          // wy intentionally unchanged — vertical arrangement is unaffected
        })),
      };
    });
  },

  // ── Page focus ────────────────────────────────────────────────────────────────

  focusPageForNode: (nodeId) => {
    const s = get();
    // Already on the right page?
    if (findNode(s.pageNodes as SDUINode[], nodeId)) return;
    // Search all other pages
    for (const page of s.pages as BuilderPage[]) {
      if (page.id === s.focusedPageId) continue;
      if (findNode(page.nodes as SDUINode[], nodeId)) {
        get().focusPage(page.id);
        return;
      }
    }
    // Also check canvas nodes
    const inCanvas = (s.canvasNodes as CanvasNode[]).find(n => n.id === nodeId);
    if (inCanvas) {
      // Canvas node selected — no page focus change needed
    }
  },

  // ── Freeform canvas nodes ──────────────────────────────────────────────────

  moveNodeToCanvas: (nodeId, cx, cy, cw, ch) => {
    set(s => {
      const idSet = new Set([nodeId]);
      const canvasNodeData: CanvasNode = (() => {
        // Search focused page first
        const inFocused = findNode(s.pageNodes as SDUINode[], nodeId);
        if (inFocused) return { ...(clone(inFocused) as SDUINode), _cx: cx, _cy: cy, ...(cw != null && ch != null ? { _cw: cw, _ch: ch } : {}) } as CanvasNode;
        // Search other pages
        for (const pg of s.pages as BuilderPage[]) {
          if (pg.id === s.focusedPageId) continue;
          const found = findNode(pg.nodes as SDUINode[], nodeId);
          if (found) return { ...(clone(found) as SDUINode), _cx: cx, _cy: cy, ...(cw != null && ch != null ? { _cw: cw, _ch: ch } : {}) } as CanvasNode;
        }
        return null as unknown as CanvasNode;
      })();
      if (!canvasNodeData) return s;

      // Strip absolute/fixed positioning from className — the canvas wrapper
      // handles positioning via _cx/_cy. Keeping these classes would cause the
      // inner node to escape the wrapper (position: absolute within the wrapper).
      // Save originals so they can be restored when the node returns to a page.
      const rawCls = ((canvasNodeData.props as Record<string, unknown>)?.className as string) ?? '';
      if (/\b(absolute|fixed)\b/.test(rawCls)) {
        canvasNodeData._originalCls = rawCls;
        const rawStyle = (canvasNodeData.props as Record<string, unknown>)?.style as Record<string, unknown> | undefined;
        if (rawStyle) canvasNodeData._originalStyle = { ...rawStyle };

        // Keep the absolute/fixed keyword so the right panel shows the correct
        // position mode. Only strip position VALUES (left/top/right/bottom/inset/z)
        // that would conflict with the canvas wrapper's positioning.
        const stripped = rawCls
          .replace(/\b(left|top|right|bottom)-\[[^\]]*\]/g, '')
          .replace(/\b(inset|inset-x|inset-y)-\[[^\]]*\]/g, '')
          .replace(/\bz-\[[^\]]*\]/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        (canvasNodeData.props as Record<string, unknown>).className = stripped;
        const st = rawStyle;
        if (st) {
          const { left: _l, top: _t, right: _r, bottom: _b, zIndex: _z, ...rest } = st;
          (canvasNodeData.props as Record<string, unknown>).style = Object.keys(rest).length ? rest : undefined;
        }
      }

      // Remove from focused page
      const newPageNodes = removeNodesByIds(clone(s.pageNodes as SDUINode[]), idSet);
      // Remove from all other pages too
      const newPages = (s.pages as BuilderPage[]).map(p => {
        if (p.id === s.focusedPageId) return p;
        const cleaned = removeNodesByIds(clone(p.nodes as SDUINode[]), idSet);
        return cleaned !== p.nodes ? { ...p, nodes: cleaned } : p;
      });

      return {
        pageNodes: newPageNodes,
        pages: newPages,
        canvasNodes: [...(s.canvasNodes as CanvasNode[]), canvasNodeData],
        selectedIds: canvasNodeData.id ? [canvasNodeData.id] : s.selectedIds,
      };
    });
    get()._pushHistory();
  },

  moveCanvasNodeToPage: (nodeId, pageId, parentId, atIdx) => {
    set(s => {
      const canvasNode = (s.canvasNodes as CanvasNode[]).find(n => n.id === nodeId);
      if (!canvasNode) return s;
      // Strip canvas-only props. The current className already has absolute/fixed
      // (kept by moveNodeToCanvas). Only restore the z-index token from
      // _originalCls if it's missing from the current className.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _cx, _cy, _cw, _ch, _originalCls, _originalStyle, ...node } = canvasNode;
      if (_originalCls) {
        const currentCls = ((node.props as Record<string, unknown>)?.className as string) ?? '';
        const zToken = _originalCls.match(/\bz-\[[^\]]*\]/)?.[0] ?? '';
        const needsZ = zToken && !currentCls.includes(zToken);
        if (needsZ) {
          (node.props as Record<string, unknown>).className = `${zToken} ${currentCls}`.trim();
        }
      }
      if (_originalStyle) {
        const currentStyle = ((node.props as Record<string, unknown>)?.style ?? {}) as Record<string, unknown>;
        const restoreKeys: Record<string, unknown> = {};
        if ('zIndex' in _originalStyle && !('zIndex' in currentStyle)) restoreKeys.zIndex = _originalStyle.zIndex;
        if (Object.keys(restoreKeys).length > 0) {
          (node.props as Record<string, unknown>).style = { ...currentStyle, ...restoreKeys };
        }
      }
      const newCanvasNodes = (s.canvasNodes as CanvasNode[]).filter(n => n.id !== nodeId);

      if (pageId === s.focusedPageId) {
        // Insert into active page
        const newPageNodes = insertNode(clone(s.pageNodes as SDUINode[]), node as SDUINode, parentId, atIdx);
        return { pageNodes: newPageNodes, canvasNodes: newCanvasNodes, selectedIds: nodeId ? [nodeId] : s.selectedIds };
      } else {
        // Insert into a different page
        const pages = (s.pages as BuilderPage[]).map(p => {
          if (p.id !== pageId) return p;
          const newNodes = insertNode(clone(p.nodes as SDUINode[]), node as SDUINode, parentId, atIdx);
          return { ...p, nodes: newNodes };
        });
        return { pages, canvasNodes: newCanvasNodes, selectedIds: nodeId ? [nodeId] : s.selectedIds };
      }
    });
    get()._pushHistory();
  },

  moveCanvasNodePosition: (nodeId, cx, cy) => {
    set(s => ({
      canvasNodes: (s.canvasNodes as CanvasNode[]).map(n =>
        n.id === nodeId ? { ...n, _cx: cx, _cy: cy } : n
      ),
    }));
    // Position-only move — push history on drag end, not during live drag
  },
  _requestOverlayUpdate: () => {},
  _setOverlayUpdateCallback: (fn) => set({ _requestOverlayUpdate: fn ?? (() => {}) }),
  _requestRingUpdate: () => {},
  _setRingUpdateCallback: (fn) => set({ _requestRingUpdate: fn ?? (() => {}) }),

  // ── AI Chat ────────────────────────────────────────────────────────────────
  aiMode: false,
  aiChatHistory: [],
  aiSelectedNodeIds: [],
  aiGenerating: false,
  aiCurrentThreadId: null,
  aiCurrentTool: null,
  aiSelectedModel: 'claude-haiku-4-5' as import('./_store-types').BuilderModelId,
  aiPendingMessage: null,

  projectMood: '',
  projectAnimationLevel: 2,
  projectLayoutStructure: 2,
  projectDescription: '',
  projectAppName: '',
  projectCategory: 'general',

  setProjectContext: (ctx) => set(s => ({
    projectMood:            ctx.mood            ?? s.projectMood,
    projectAnimationLevel:  ctx.animationLevel  ?? s.projectAnimationLevel,
    projectLayoutStructure: ctx.layoutStructure ?? s.projectLayoutStructure,
    projectDescription:     ctx.description     ?? s.projectDescription,
    projectAppName:         ctx.appName         ?? s.projectAppName,
    projectCategory:        ctx.category        ?? s.projectCategory,
  })),

  toggleAiMode: () => set(s => ({ aiMode: !s.aiMode })),
  setAiPendingMessage: (msg) => set({ aiPendingMessage: msg }),
  addAiChatMessage: (msg) => set(s => ({ aiChatHistory: [...s.aiChatHistory, msg] })),
  updateLastAiMessage: (patch) => set(s => {
    const history = [...s.aiChatHistory];
    if (history.length === 0) return {};
    history[history.length - 1] = { ...history[history.length - 1], ...patch };
    return { aiChatHistory: history };
  }),
  clearAiChat: () => set({ aiChatHistory: [], aiCurrentThreadId: null }),
  setAiSelectedNodeIds: (ids) => set({ aiSelectedNodeIds: ids }),
  setAiGenerating: (v) => set({ aiGenerating: v }),
  setAiCurrentThreadId: (id) => set({ aiCurrentThreadId: id }),
  setAiCurrentTool: (name) => set({ aiCurrentTool: name }),
  setAiSelectedModel: (id) => set({ aiSelectedModel: id }),
  cancelEditMessage: () => {}, // no-op — edit state is now local to the panel component
  prependAiChatMessages: (msgs) => set(s => {
    const existingIds = new Set(s.aiChatHistory.map(m => m.id));
    const fresh = msgs.filter(m => !existingIds.has(m.id));
    if (fresh.length === 0) return {};
    return { aiChatHistory: [...fresh, ...s.aiChatHistory] };
  }),
  truncateAiChatAt: (messageId) => set(s => {
    const idx = s.aiChatHistory.findIndex(m => m.id === messageId);
    if (idx < 0) return {};
    // Keep the edited message itself; drop everything after it.
    return { aiChatHistory: s.aiChatHistory.slice(0, idx + 1) };
  }),

  _pushHistory: () => {
    if (_historyTimer) cancelAnimationFrame(_historyTimer);
    _historyTimer = requestAnimationFrame(() => {
      _historyTimer = 0;
      _flushHistory(set);
    });
  },

  _syncSharedInstances: (editedNodeId: string, opts?: { prevEditedNode?: SDUINode | null }) => {
    const { pageNodes, focusedPageId, editingSharedComponentIds } = get();
    const sharedRoot = findLinkedRoot(pageNodes as SDUINode[], editedNodeId, 'shared');
    if (!sharedRoot) return;

    const rootRec = sharedRoot as unknown as Record<string, unknown>;
    const sharedMeta = rootRec._shared as { id: string; name: string } | undefined;
    const meta = sharedMeta;
    if (!meta?.id) return;
    const metaKey: '_shared' = '_shared';
    const getModel = (id: string) => getSharedComponents()[id];
    const writeModel = (payload: { id: string } & Record<string, unknown>) => {
      updateSharedComponent(payload as Parameters<typeof updateSharedComponent>[0]);
    };

    const isEditingModel = editingSharedComponentIds.includes(meta.id);

    // ── Instance-side edit (not in Edit Component mode) ───────────────────────
    // Do NOT propagate to model. Record per-instance overrides when the edit is
    // on the shared ROOT itself. Nested edits inside an instance are allowed but
    // untracked — they will be wiped on the next model-edit sync by design.
    //
    // Invariant: `_overrides` only contains cssProps whose current instance
    // value ACTUALLY differs from the model baseline. A "reset to shared
    // default" edit (which sets the value back to the baseline) therefore
    // REMOVES the cssProp from `_overrides` rather than re-adding it.
    if (!isEditingModel) {
      const prev = opts?.prevEditedNode;
      if (!prev) return; // no snapshot → can't diff; skip tracking rather than guess
      const modelContent = (getModel(meta.id)?.content ?? null) as Record<string, unknown> | null;

      // ── Structural divergence detection (Figma-style sticky overrides) ──
      // Compare the current instance root against the MODEL content by
      // `_sharedKey`. Any model descendant missing from the instance is a
      // "remove" override. Any instance descendant whose `_sharedKey` is NOT
      // in the model is a "local insertion" override (or legacy unkeyed).
      if (modelContent) {
        const modelKeys = new Set<string>();
        (function idx(n: Record<string, unknown>) {
          const k = n._sharedKey;
          if (typeof k === 'string' && k) modelKeys.add(k);
          const children = (n.children ?? []) as Record<string, unknown>[];
          for (const c of children) idx(c);
        })(modelContent);

        // Collect instance's current keys + track local insertions relative
        // to the first parent whose `_sharedKey` IS in the model. While
        // walking, stamp fresh `local-*` keys on any unkeyed nodes so they
        // can be tracked across future model edits.
        const instanceKeys = new Set<string>();
        const detectedInsertions: Array<{ parentSharedKey: string; atIdx: number; subtreeSharedKey: string }> = [];
        const nodesToStampKey: Array<{ id: string; key: string }> = [];
        (function walk(n: SDUINode, parentKey: string | null, atIdx: number) {
          const rec = n as unknown as Record<string, unknown>;
          let k = rec._sharedKey as string | undefined;
          // Unkeyed node inside an SC subtree → it's a local insertion. Mint
          // a `local-*` key so future syncs can track it.
          if ((typeof k !== 'string' || !k) && n.id) {
            k = `local-${crypto.randomUUID()}`;
            nodesToStampKey.push({ id: n.id, key: k });
          }
          if (typeof k === 'string' && k) {
            instanceKeys.add(k);
            if (!modelKeys.has(k) && parentKey && modelKeys.has(parentKey)) {
              detectedInsertions.push({ parentSharedKey: parentKey, atIdx, subtreeSharedKey: k });
            }
          }
          const children = (n.children ?? []) as SDUINode[];
          for (let i = 0; i < children.length; i++) walk(children[i], (typeof k === 'string' ? k : parentKey), i);
        })(sharedRoot, null, 0);

        // Stamp any newly-minted local keys onto the tree (one batch write)
        if (nodesToStampKey.length > 0) {
          set(s => {
            let nodes = s.pageNodes as SDUINode[];
            for (const stamp of nodesToStampKey) {
              nodes = patchNodeById(nodes, stamp.id, n => ({
                ...(n as object),
                _sharedKey: stamp.key,
              } as unknown as SDUINode));
            }
            return { pageNodes: nodes };
          });
        }

        // "Removed keys" = model keys missing from the instance EXCEPT the
        // root key itself (SC root always exists in instance).
        const rootKey = (sharedRoot as unknown as Record<string, unknown>)._sharedKey as string | undefined;
        const detectedRemovals = new Set<string>();
        for (const mk of modelKeys) {
          if (mk === rootKey) continue;
          if (!instanceKeys.has(mk)) detectedRemovals.add(mk);
        }
        // BUT: if this descendant is already listed in _localInsertions chain
        // (its parent chain contains a locally-inserted key), skip. Heuristic
        // covered by the "parentKey must be in modelKeys" guard above.

        // Merge with existing stored overrides
        const existingRemoved = Array.isArray((sharedRoot as unknown as Record<string, unknown>)._removedKeys)
          ? (sharedRoot as unknown as Record<string, unknown>)._removedKeys as string[]
          : [];
        const existingInsertions = Array.isArray((sharedRoot as unknown as Record<string, unknown>)._localInsertions)
          ? (sharedRoot as unknown as Record<string, unknown>)._localInsertions as Array<{ parentSharedKey: string; atIdx: number; subtreeSharedKey: string }>
          : [];

        const nextRemoved = Array.from(detectedRemovals);
        // Previously removed keys that have "come back" (e.g. user re-inserted
        // a matching model node — rare but possible) are naturally dropped
        // because we rebuild from detectedRemovals each time.
        void existingRemoved;

        // Deduplicate insertions by subtreeSharedKey (re-detection should
        // yield the same position; if not, latest wins).
        const insertionMap = new Map<string, { parentSharedKey: string; atIdx: number; subtreeSharedKey: string }>();
        for (const e of existingInsertions) insertionMap.set(e.subtreeSharedKey, e);
        for (const e of detectedInsertions) insertionMap.set(e.subtreeSharedKey, e);
        // Purge any insertion whose subtreeSharedKey is no longer in the
        // instance (user deleted the locally-inserted node).
        for (const key of Array.from(insertionMap.keys())) {
          if (!instanceKeys.has(key)) insertionMap.delete(key);
        }
        const nextInsertions = Array.from(insertionMap.values());

        // Write the structural metadata back onto the SC root if it changed.
        const curRemovedStr = JSON.stringify(existingRemoved.slice().sort());
        const nextRemovedStr = JSON.stringify(nextRemoved.slice().sort());
        const curInsertionsStr = JSON.stringify(existingInsertions);
        const nextInsertionsStr = JSON.stringify(nextInsertions);
        const structChanged = curRemovedStr !== nextRemovedStr || curInsertionsStr !== nextInsertionsStr;
        if (structChanged) {
          set(s => ({
            pageNodes: patchNodeById(s.pageNodes as SDUINode[], sharedRoot.id!, n => {
              const rec = { ...(n as object) } as Record<string, unknown>;
              if (nextRemoved.length > 0) rec._removedKeys = nextRemoved;
              else delete rec._removedKeys;
              if (nextInsertions.length > 0) rec._localInsertions = nextInsertions;
              else delete rec._localInsertions;
              return rec as unknown as SDUINode;
            }),
          }));
        }
      }

      // ── Edit on the SC ROOT itself — update root-level _overrides ───────
      if (sharedRoot.id === editedNodeId) {
        const changedProps = diffCssProps(prev, sharedRoot);
        if (changedProps.length === 0) return;

        const toAdd: string[] = [];
        const toRemove: string[] = [];
        for (const p of changedProps) {
          const baselineVal = modelContent ? readPropValue(modelContent, p) : '';
          const curVal = readPropValue(sharedRoot, p);
          if (curVal === baselineVal) toRemove.push(p);
          else toAdd.push(p);
        }
        if (toAdd.length === 0 && toRemove.length === 0) return;

        set(s => ({
          pageNodes: patchNodeById(s.pageNodes as SDUINode[], sharedRoot.id!, n => {
            let next = n as SDUINode;
            if (toAdd.length > 0) next = addOverrides(next, toAdd);
            if (toRemove.length > 0) next = removeOverrides(next, toRemove);
            return next;
          }),
        }));
        return;
      }

      // ── Edit on a DESCENDANT of the SC — update _descendantOverrides ──
      // Resolve the current edited descendant by id (post-op).
      const editedDesc = findNode(pageNodes as SDUINode[], editedNodeId);
      if (!editedDesc) return;
      const sharedKey = (editedDesc as unknown as Record<string, unknown>)._sharedKey as string | undefined;
      if (!sharedKey) return; // legacy descendant without a key — cannot track
      // Resolve the model descendant by sharedKey.
      let modelDesc: Record<string, unknown> | null = null;
      if (modelContent) {
        (function find(n: Record<string, unknown>) {
          if (modelDesc) return;
          if (n._sharedKey === sharedKey) { modelDesc = n; return; }
          const children = (n.children ?? []) as Record<string, unknown>[];
          for (const c of children) find(c);
        })(modelContent);
      }
      if (!modelDesc) return; // descendant is instance-local (_localInsertions territory)

      // Diff current descendant vs. PREVIOUS descendant (the pre-op snapshot
      // covers the entire SC root; resolve the same sharedKey in prev).
      const prevDesc = (function find(n: Record<string, unknown>): Record<string, unknown> | null {
        if (n._sharedKey === sharedKey) return n;
        const children = (n.children ?? []) as Record<string, unknown>[];
        for (const c of children) {
          const r = find(c);
          if (r) return r;
        }
        return null;
      })(prev as unknown as Record<string, unknown>);

      const allKeys = diffAllOverrideableProps(prevDesc, editedDesc);
      if (allKeys.length === 0) return;

      // For each changed key, compare against the MODEL baseline. If equal →
      // remove from _descendantOverrides[sharedKey]; else → add.
      const curDescOverrides = ((sharedRoot as unknown as Record<string, unknown>)._descendantOverrides ?? {}) as Record<string, string[]>;
      const existing = new Set(curDescOverrides[sharedKey] ?? []);
      for (const k of allKeys) {
        // Read model baseline for this key
        let modelVal: string;
        let curVal: string;
        if (k === 'text' || k === 'actions' || k === 'animation' || k === 'condition' || k === 'map') {
          // non-CSS
          // readNonCssValue is exported from _shared-overrides (same file family)
          modelVal = JSON.stringify((modelDesc as Record<string, unknown>)[k] ?? null);
          curVal = JSON.stringify((editedDesc as unknown as Record<string, unknown>)[k] ?? null);
        } else {
          modelVal = readPropValue(modelDesc, k);
          curVal = readPropValue(editedDesc, k);
        }
        if (curVal === modelVal) existing.delete(k);
        else existing.add(k);
      }
      const nextList = Array.from(existing);

      set(s => ({
        pageNodes: patchNodeById(s.pageNodes as SDUINode[], sharedRoot.id!, n => {
          const rec = { ...(n as object) } as Record<string, unknown>;
          const cur = (rec._descendantOverrides ?? {}) as Record<string, string[]>;
          const nextMap = { ...cur };
          if (nextList.length === 0) delete nextMap[sharedKey];
          else nextMap[sharedKey] = nextList;
          if (Object.keys(nextMap).length === 0) delete rec._descendantOverrides;
          else rec._descendantOverrides = nextMap;
          return rec as unknown as SDUINode;
        }),
      }));
      return;
    }

    // ── Model-edit mode ───────────────────────────────────────────────────────
    const content = JSON.parse(JSON.stringify(sharedRoot)) as Record<string, unknown>;
    delete content._shared;
    delete content._overrides;
    delete content._descendantOverrides;
    delete content._removedKeys;
    delete content._localInsertions;
    // Strip instance-only metadata from every nested node. Nested SCs keep
    // their own `_shared` + `_sharedKey` (so the outer model's structure
    // still references the inner model) but lose any override metadata that
    // belongs only to the outer instance's state.
    (function stripNested(n: Record<string, unknown>) {
      const children = (n.children ?? []) as Record<string, unknown>[];
      for (const c of children) {
        delete c._overrides;
        delete c._descendantOverrides;
        delete c._removedKeys;
        delete c._localInsertions;
        stripNested(c);
      }
    })(content);
    // Ensure every node in the new model content has a _sharedKey (migrates
    // legacy content on first edit).
    stampSharedKeys(content);
    const prevModel = getModel(meta.id);
    const prevModelContent = prevModel?.content ?? null;
    // Declared property names — these are per-instance overrides that must be preserved
    const declaredPropNames = new Set((prevModel?.properties ?? []).map(p => p.name));

    // Strip per-instance property overrides from model content before saving
    if (declaredPropNames.size > 0 && content.props) {
      const modelProps = { ...(content.props as Record<string, unknown>) };
      for (const propName of declaredPropNames) delete modelProps[propName];
      content.props = modelProps;
    }

    // ── Prevent the entered-from instance's pre-existing per-cssProp overrides
    //    from leaking into the shared model ────────────────────────────────
    // Simple edit mode edits the original instance directly, so `sharedRoot`
    // can have A's local override values baked into its className / style /
    // animation. If we saved that as the new model content verbatim, those
    // override values would become the MODEL's baseline — and any OTHER
    // instance that did NOT have its own override for that cssProp would
    // silently inherit A's override value. That is the bug this block fixes.
    //
    // Strategy: for every cssProp listed in sharedRoot._overrides, restore the
    // OLD model's value on `content` UNLESS the user actually changed that
    // cssProp in this patch (detected via diff against the pre-edit snapshot).
    // The exception exists so the user can intentionally "promote" an override
    // to the model by editing it while in Edit Component mode.
    const prevSharedOverrides = getOverrides(sharedRoot);
    const prevSnap = opts?.prevEditedNode;
    const editedOnRoot = prevSnap && prevSnap.id === sharedRoot.id;
    const changedProps = editedOnRoot ? diffCssProps(prevSnap, sharedRoot) : [];
    const changedSet = new Set(changedProps);
    const preservedOverrides = prevSharedOverrides.filter(p => !changedSet.has(p));
    if (preservedOverrides.length > 0 && prevModelContent) {
      for (const p of preservedOverrides) {
        copyCssProp(prevModelContent as Record<string, unknown>, content as Parameters<typeof copyCssProp>[1], p);
      }
    }

    if (prevModel) writeModel({ ...(prevModel as unknown as Record<string, unknown>), id: (prevModel as { id: string }).id, content });

    // Update sharedRoot's own `_overrides`: drop any cssProp the user just
    // changed while in edit mode (those values are now the MODEL baseline, no
    // longer per-instance overrides). Also purge entries that happen to match
    // the new model baseline even though we didn't touch them (defensive).
    const nextSharedOverrides = prevSharedOverrides.filter(p => !changedSet.has(p));
    if (nextSharedOverrides.length !== prevSharedOverrides.length) {
      set(s => ({
        pageNodes: patchNodeById(s.pageNodes as SDUINode[], sharedRoot.id!, n => {
          return { ...(n as object), _overrides: nextSharedOverrides } as unknown as SDUINode;
        }),
      }));
    }

    // ── Build a replacement node from the new model content ─────────────────
    // Preserve for each instance:
    //   1. Declared-property overrides (per-instance values for declared props)
    //   2. Root-level CSS overrides (from instance._overrides)
    //   3. Descendant-level overrides (from instance._descendantOverrides)
    //   4. Structural instance-mode divergences (_removedKeys, _localInsertions)
    //
    // Matching is done by stable `_sharedKey`. Legacy instances without keys
    // fall back to positional matching against the OLD model content (same
    // behaviour as before).
    const buildReplacement = (targetNode: SDUINode): SDUINode => {
      // 1) Fresh clone of model content — fresh node ids, preserve _sharedKey
      const fresh = cloneWithFreshIdsKeepSharedKey(
        JSON.parse(JSON.stringify(content)) as Record<string, unknown>,
      ) as Record<string, unknown>;
      const freshProps = (fresh.props ?? {}) as Record<string, unknown>;
      const targetProps = ((targetNode as unknown as Record<string, unknown>).props ?? {}) as Record<string, unknown>;
      // Restore declared properties from target (per-instance override)
      for (const propName of declaredPropNames) {
        if (propName in targetProps) {
          freshProps[propName] = targetProps[propName];
        }
      }
      fresh.props = freshProps;

      // 2) Index the instance and its _overrides metadata
      const targetRec = targetNode as unknown as Record<string, unknown>;
      const instDescOverrides = (targetRec._descendantOverrides
        ?? {}) as Record<string, string[]>;
      const removedKeys = new Set<string>(
        Array.isArray(targetRec._removedKeys) ? targetRec._removedKeys as string[] : []
      );
      const localInsertions = Array.isArray(targetRec._localInsertions)
        ? targetRec._localInsertions as Array<{ parentSharedKey: string; atIdx: number; subtreeSharedKey: string }>
        : [];

      // Walk the instance tree and index descendants by _sharedKey for
      // O(1) lookup during the parallel walk below.
      const instBySharedKey = new Map<string, SDUINode>();
      (function idx(n: SDUINode) {
        const k = (n as unknown as Record<string, unknown>)._sharedKey;
        if (typeof k === 'string' && k) instBySharedKey.set(k, n);
        if (n.children?.length) for (const c of n.children as SDUINode[]) idx(c);
      })(targetNode);

      // Self-heal: if the instance lacks `_descendantOverrides`, infer it by
      // diffing each instance descendant against the OLD model content
      // (positional match). This runs once per instance per edit cycle.
      // The inferred list is written back to the instance via the returned
      // metadata on the replacement node.
      const inferredDescOverrides: Record<string, string[]> = {};
      const hasDescOverridesField = targetRec._descendantOverrides !== undefined;
      if (!hasDescOverridesField && prevModelContent) {
        _walkDescendantsParallel(targetNode, prevModelContent as Record<string, unknown>, (instDesc, modelDesc) => {
          if (!modelDesc) return;
          const diffs = diffAllOverrideableProps(modelDesc, instDesc);
          if (diffs.length === 0) return;
          const sk = (instDesc as unknown as Record<string, unknown>)._sharedKey as string | undefined;
          if (!sk) return;
          inferredDescOverrides[sk] = diffs;
        });
      }
      const effectiveDescOverrides = hasDescOverridesField ? instDescOverrides : inferredDescOverrides;

      // 3) Prune fresh descendants whose _sharedKey is in _removedKeys
      const pruneRemoved = (node: Record<string, unknown>): void => {
        const children = (node.children ?? []) as Record<string, unknown>[];
        const kept: Record<string, unknown>[] = [];
        for (const c of children) {
          const k = c._sharedKey;
          if (typeof k === 'string' && removedKeys.has(k)) continue;
          pruneRemoved(c);
          kept.push(c);
        }
        if (kept.length !== children.length) node.children = kept;
      };
      pruneRemoved(fresh);

      // 4) Walk fresh in parallel-by-sharedKey, overlaying descendant overrides
      const overlayDescendant = (freshNode: Record<string, unknown>): void => {
        const k = freshNode._sharedKey;
        if (typeof k === 'string' && k) {
          const inst = instBySharedKey.get(k);
          const keys = effectiveDescOverrides[k];
          if (inst && keys && keys.length > 0) {
            overlayOverrides(inst, freshNode as unknown as Parameters<typeof overlayOverrides>[1], keys);
          }
        }
        const children = (freshNode.children ?? []) as Record<string, unknown>[];
        for (const c of children) overlayDescendant(c);
      };
      overlayDescendant(fresh);

      // 5) Graft local insertions back onto fresh by parentSharedKey + atIdx
      if (localInsertions.length > 0) {
        // Build a map: subtreeSharedKey → the actual subtree node in the instance
        const insertedSubtrees = new Map<string, SDUINode>();
        for (const entry of localInsertions) {
          const sub = instBySharedKey.get(entry.subtreeSharedKey);
          if (sub) insertedSubtrees.set(entry.subtreeSharedKey, sub);
        }
        // Find each parent in fresh by its _sharedKey and splice the subtree in
        const freshBySharedKey = new Map<string, Record<string, unknown>>();
        (function idxFresh(n: Record<string, unknown>) {
          const k = n._sharedKey;
          if (typeof k === 'string' && k) freshBySharedKey.set(k, n);
          const children = (n.children ?? []) as Record<string, unknown>[];
          for (const c of children) idxFresh(c);
        })(fresh);
        for (const entry of localInsertions) {
          const freshParent = freshBySharedKey.get(entry.parentSharedKey);
          const sub = insertedSubtrees.get(entry.subtreeSharedKey);
          if (!freshParent || !sub) continue;
          const cloned = cloneWithFreshIdsKeepSharedKey(JSON.parse(JSON.stringify(sub)) as Record<string, unknown>);
          const children = ((freshParent.children ?? []) as Record<string, unknown>[]).slice();
          const idx = Math.max(0, Math.min(entry.atIdx, children.length));
          children.splice(idx, 0, cloned);
          freshParent.children = children;
        }
      }

      // 6) Root-level CSS overrides
      let overrides = getOverrides(targetNode);
      const hasOverridesField = Array.isArray((targetNode as unknown as Record<string, unknown>)._overrides);
      if (!hasOverridesField && prevModelContent) {
        overrides = diffCssProps(prevModelContent as Record<string, unknown>, targetNode);
      }
      if (overrides.length > 0) {
        overlayOverrides(targetNode, fresh as unknown as Parameters<typeof overlayOverrides>[1], overrides);
      }

      // 7) Persist _descendantOverrides on the root so next sync doesn't
      // re-infer. Drop any keys whose descendant no longer exists in the
      // new model (removed upstream). Keep only keys for descendants that
      // both exist in the new model AND still have the listed props.
      const freshKeys = new Set<string>();
      (function idxKeys(n: Record<string, unknown>) {
        const k = n._sharedKey;
        if (typeof k === 'string' && k) freshKeys.add(k);
        const children = (n.children ?? []) as Record<string, unknown>[];
        for (const c of children) idxKeys(c);
      })(fresh);
      const nextDescOverrides: Record<string, string[]> = {};
      for (const [k, ps] of Object.entries(effectiveDescOverrides)) {
        if (!freshKeys.has(k)) continue;
        if (!Array.isArray(ps) || ps.length === 0) continue;
        nextDescOverrides[k] = [...ps];
      }
      // Drop _removedKeys entries for descendants no longer in the model
      // (model already dropped them; our structural override is now redundant).
      const nextRemovedKeys: string[] = [];
      for (const k of removedKeys) {
        // We don't have the old model for comparison here cheaply; keep as-is
        // but strip keys that coincidentally show up in fresh (shouldn't happen
        // after pruneRemoved ran). Model may have re-added a key with the same
        // value — treat as "still removed" in that case (user intent wins).
        if (!freshKeys.has(k)) nextRemovedKeys.push(k);
        else nextRemovedKeys.push(k);
      }
      const nextLocalInsertions = localInsertions
        .filter(e => freshKeys.has(e.parentSharedKey));

      const replacement: Record<string, unknown> = {
        ...(fresh as object),
        id: targetNode.id,
        [metaKey]: meta,
        _overrides: overrides,
      };
      if (Object.keys(nextDescOverrides).length > 0) replacement._descendantOverrides = nextDescOverrides;
      if (nextRemovedKeys.length > 0) replacement._removedKeys = nextRemovedKeys;
      if (nextLocalInsertions.length > 0) replacement._localInsertions = nextLocalInsertions;

      return replacement as unknown as SDUINode;
    };

    // Sync other instances on the FOCUSED page
    const otherRoots: SDUINode[] = [];
    (function walk(nodes: SDUINode[]) {
      for (const n of nodes) {
        const s = (n as unknown as Record<string, unknown>)[metaKey] as { id: string } | undefined;
        if (s?.id === meta.id && n.id !== sharedRoot.id) otherRoots.push(n);
        if (n.children?.length) walk(n.children as SDUINode[]);
      }
    })(pageNodes as SDUINode[]);

    if (otherRoots.length > 0) {
      set(s => {
        let nodes = s.pageNodes as SDUINode[];
        for (const other of otherRoots) {
          const otherRef = other;
          nodes = patchNodeById(nodes, other.id!, () => buildReplacement(otherRef));
        }
        return { pageNodes: nodes };
      });
    }

    // Sync instances on OTHER pages (non-focused)
    set(s => {
      let pagesChanged = false;
      const newPages = (s.pages as BuilderPage[]).map(page => {
        if (page.id === focusedPageId) return page;
        const roots: SDUINode[] = [];
        (function walk(nodes: SDUINode[]) {
          for (const n of nodes) {
            const sm = (n as unknown as Record<string, unknown>)[metaKey] as { id: string } | undefined;
            if (sm?.id === meta.id) roots.push(n);
            if (n.children?.length) walk(n.children as SDUINode[]);
          }
        })(page.nodes as SDUINode[]);
        if (roots.length === 0) return page;
        pagesChanged = true;
        let nodes = page.nodes as SDUINode[];
        for (const other of roots) {
          const otherRef = other;
          nodes = patchNodeById(nodes, other.id!, () => buildReplacement(otherRef));
        }
        return { ...page, nodes };
      });
      return pagesChanged ? { pages: newPages } : {};
    });
  },

  undo: () => {
    _flushHistoryIfPending(set);
    set(s => {
      if (s.historyIdx <= 0) return s;
      const idx = s.historyIdx - 1;
      const snap = s.history[idx];
      // Snapshot data is immutable (created once, never modified) — reference directly.
      // Subsequent edits clone pageNodes before mutating, so snapshot refs stay safe.
      const pages = (s.pages as BuilderPage[]).map(p => {
        const pg = snap.pages[p.id];
        if (!pg) return p;
        return { ...p, nodes: pg.nodes, wx: pg.wx, wy: pg.wy };
      });
      if (snap.sharedComponents) loadSharedComponents(snap.sharedComponents);
      return { historyIdx: idx, selectedIds: [], pages, canvasNodes: snap.canvasNodes as CanvasNode[] };
    });
  },

  redo: () => {
    _flushHistoryIfPending(set);
    set(s => {
      if (s.historyIdx >= s.history.length - 1) return s;
      const idx = s.historyIdx + 1;
      const snap = s.history[idx];
      const pages = (s.pages as BuilderPage[]).map(p => {
        const pg = snap.pages[p.id];
        if (!pg) return p;
        return { ...p, nodes: pg.nodes, wx: pg.wx, wy: pg.wy };
      });
      if (snap.sharedComponents) loadSharedComponents(snap.sharedComponents);
      return { historyIdx: idx, selectedIds: [], pages, canvasNodes: snap.canvasNodes as CanvasNode[] };
    });
  },

  // ── Page management ──────────────────────────────────────────────────────────

  addPage: (route, name, id?) => {
    set(s => {
      const existing = s.pages.find(p => p.route === route);
      if (existing) return s;

      // pages[focusedIdx].nodes is already in sync via middleware — no clone needed
      const vpWidth = VIEWPORT_WIDTHS[s.viewport as import('./_store-types').ViewportSize] ?? 1280;
      const GAP = 80;
      const rightmostWx = (s.pages as BuilderPage[]).reduce((max, p) => Math.max(max, (p.wx ?? 0) + vpWidth), 0);
      const newWx = s.pages.length > 0 ? rightmostWx + GAP : 0;

      const newPage: BuilderPage = {
        id: id ?? `page-${Date.now()}`,
        name: name ?? route,
        route,
        nodes: [],
        wx: newWx,
        wy: 0,
      };
      return {
        pages: [...(s.pages as BuilderPage[]), newPage],
        focusedPageId: newPage.id,
        pageNodes: [],
        selectedIds: [],
        hoveredId: null,
        pendingFitToPage: true,
      };
    });
    get()._pushHistory();
  },

  addPageAt: (name, wx, wy, initialNode) => {
    set(s => {
      const newPage: BuilderPage = {
        id: `page-${Date.now()}`,
        name,
        route: '',
        nodes: initialNode ? [initialNode] : [],
        wx,
        wy,
      };
      return {
        pages: [...(s.pages as BuilderPage[]), newPage],
        focusedPageId: newPage.id,
        pageNodes: initialNode ? [initialNode] : [],
        selectedIds: initialNode?.id ? [initialNode.id] : [],
        hoveredId: null,
      };
    });
    get()._pushHistory();
  },

  focusPage: (pageId) => {
    const s = get();
    if (pageId === s.focusedPageId) return;
    if (!s.pages.find(p => p.id === pageId)) return;

    // Auto-exit shared component edit if active
    if (s.editingSharedComponentId) {
      get().exitSharedComponentEdit();
    }

    // Lightweight focus change — middleware auto-derives pageNodes
    set({ focusedPageId: pageId, selectedIds: [], hoveredId: null });
    _broadcastPageEnterReplay(pageId);
  },

  navigatePage: (pageId) => {
    const s = get();
    const target = s.pages.find(p => p.id === pageId);
    if (!target) return;
    if (target.id === s.focusedPageId) {
      set({ pendingFitToPage: true });
      return;
    }

    // Lazy-load if page nodes haven't been fetched from backend yet
    const isLoaded = s.loadedPageIds.has(pageId);
    const hasNodes = target.nodes.length > 0;

    if (!isLoaded && !hasNodes) {
      const projectId = typeof window !== 'undefined'
        ? (new URLSearchParams(window.location.search).get('projectId') ??
           (window.location.pathname.startsWith('/builder/')
             ? window.location.pathname.split('/')[2] ?? null
             : null))
        : null;

      if (projectId && projectId !== 'admin') {
        fetch(`/api/projects/${projectId}/pages/${pageId}`, { credentials: 'include' })
          .then(res => res.ok ? res.json() as Promise<{ page?: { nodes?: SDUINode[] } }> : null)
          .then(data => {
            const fetchedNodes = (data?.page?.nodes ?? []) as SDUINode[];
            set(st => ({
              pages: st.pages.map(p => p.id === pageId ? { ...p, nodes: fetchedNodes } : p),
              loadedPageIds: new Set([...st.loadedPageIds, pageId]),
            }));
            get().focusPage(pageId);
            set({ pendingFitToPage: true });
          })
          .catch(() => {
            get().focusPage(pageId);
            set({ pendingFitToPage: true });
          });
        return;
      }
    }

    get().focusPage(pageId);
    set({ pendingFitToPage: true });
  },

  clearPendingFit: () => set({ pendingFitToPage: false }),

  // ── Shared Component edit mode ───────────────────────────────────────────────

  enterSharedComponentEdit: (modelId, content, model, entryNodeId?, simple?, kind: 'shared' = 'shared') => {
    set(s => {
      const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
      if (s.editingSharedComponentIds.includes(modelId)) return s;

      // Store entry selection (first edit only — nested edits don't overwrite it)
      const entrySelection = s._editEntrySelection ?? (entryNodeId
        ? { nodeId: entryNodeId, pageId: s.focusedPageId }
        : null);

      // ── Simple mode: open panel without backdrop ────────────────────────
      // The live instance A stays on the canvas. We need to temporarily hide
      // A's per-instance overrides so both canvas + panel show the pure MODEL
      // view. Overrides are snapshotted and restored on exit for any prop the
      // user did not explicitly change while editing the model.
      if (simple) {
        let nextPageNodes = s.pageNodes;
        const nextSnapshots = { ...(s._preEditInstanceSnapshot ?? {}) };

        try {
          if (entryNodeId) {
            const instanceA = findNode(s.pageNodes as SDUINode[], entryNodeId);
            if (instanceA) {
              const instanceOverrides = getOverrides(instanceA);
              const aProps = (instanceA as unknown as { props?: Record<string, unknown> }).props ?? {};
              const aAnim = (instanceA as unknown as { animation?: Record<string, unknown> }).animation;

              // Plain JSON round-trip avoids any issues with structuredClone on
              // non-cloneable refs that may live on style/animation objects.
              const safeClone = <T>(v: T): T | undefined => {
                if (v === undefined || v === null) return v as T | undefined;
                try { return JSON.parse(JSON.stringify(v)) as T; } catch { return undefined; }
              };

              // Compute descendant-level overrides by diffing each descendant of A
              // against the corresponding descendant in the model content. Nested
              // nodes (e.g. a Button inside a Container SC) don't track
              // `_overrides` explicitly, so any cssProp that differs is an
              // effective per-instance override we must preserve.
              const descendantOverrides: Array<{
                sharedKey: string;
                cssProps: string[];
                propsSnapshot: {
                  className?: string;
                  style?: Record<string, unknown>;
                  animation?: Record<string, unknown>;
                };
              }> = [];
              try {
                // Pair descendants by `_sharedKey`. Index-path pairing silently
                // misaligns under structural divergences (e.g. instance moved
                // a descendant OUT of the SC — the remaining descendants shift
                // into positions occupied by unrelated model descendants, and
                // the diff becomes nonsense). sharedKey pairing is robust.
                _walkDescendantsBySharedKey(
                  instanceA,
                  content as unknown as Record<string, unknown>,
                  (instDesc, modelDesc, sharedKey) => {
                    if (!modelDesc) return;
                    const props = (instDesc as unknown as { props?: Record<string, unknown> }).props ?? {};
                    const anim = (instDesc as unknown as { animation?: Record<string, unknown> }).animation;
                    const diff = diffCssProps(modelDesc as Record<string, unknown>, instDesc);
                    if (diff.length === 0) return;
                    descendantOverrides.push({
                      sharedKey,
                      cssProps: diff,
                      propsSnapshot: {
                        className: (props as { className?: string }).className,
                        style: safeClone((props as { style?: Record<string, unknown> }).style),
                        animation: safeClone(anim),
                      },
                    });
                  },
                );
              } catch (err) {
                console.error('[enterSharedComponentEdit] descendant-diff failed', err);
              }

              const instanceRec = instanceA as unknown as Record<string, unknown>;
              const explicitDescOverrides = instanceRec._descendantOverrides
                ? safeClone(instanceRec._descendantOverrides as Record<string, string[]>)
                : undefined;
              const removedKeysSnap = Array.isArray(instanceRec._removedKeys)
                ? [...(instanceRec._removedKeys as string[])]
                : undefined;
              const localInsertionsSnap = Array.isArray(instanceRec._localInsertions)
                ? safeClone(instanceRec._localInsertions as Array<{ parentSharedKey: string; atIdx: number; subtreeSharedKey: string }>)
                : undefined;

              // ── Capture the actual subtree payloads for each local insertion ──
              // We're about to strip them from the live canvas so the user sees a
              // pure model view. At exit we need to re-graft these exact subtrees
              // (with their instance-side edits intact).
              const findBySharedKey = (root: Record<string, unknown>, key: string): Record<string, unknown> | null => {
                if (root._sharedKey === key) return root;
                const children = (root.children ?? []) as Record<string, unknown>[];
                for (const c of children) {
                  const found = findBySharedKey(c, key);
                  if (found) return found;
                }
                return null;
              };
              const insertedSubtrees: Record<string, Record<string, unknown>> = {};
              if (localInsertionsSnap) {
                for (const entry of localInsertionsSnap) {
                  const subtree = findBySharedKey(instanceRec, entry.subtreeSharedKey);
                  if (subtree) {
                    const cloned = safeClone(subtree);
                    if (cloned) insertedSubtrees[entry.subtreeSharedKey] = cloned;
                  }
                }
              }

              nextSnapshots[modelId] = {
                instanceNodeId: entryNodeId,
                instanceOverrides: [...instanceOverrides],
                instancePropsSnapshot: {
                  className: (aProps as { className?: string }).className,
                  style: safeClone((aProps as { style?: Record<string, unknown> }).style),
                  animation: safeClone(aAnim),
                },
                descendantOverrides,
                modelContentSnapshot: safeClone(content as unknown as Record<string, unknown>) ?? {},
                explicitDescendantOverrides: explicitDescOverrides,
                removedKeys: removedKeysSnap,
                localInsertions: localInsertionsSnap,
                insertedSubtrees: Object.keys(insertedSubtrees).length > 0 ? insertedSubtrees : undefined,
              };

              // Reset A and its descendants to the MODEL baseline so the canvas
              // shows a pure model view during edit. We clear root-level
              // overrides AND copy each descendant's overridden cssProps back
              // from the model. We also hide instance-only STRUCTURAL
              // divergences (_localInsertions — remove those children;
              // _removedKeys — graft the missing model descendants back in).
              // Snapshots above let us restore on exit.
              const hasCssReset = instanceOverrides.length > 0 || descendantOverrides.length > 0;
              const hasLocalInsertions = (localInsertionsSnap?.length ?? 0) > 0;
              const hasRemovedKeys = (removedKeysSnap?.length ?? 0) > 0;
              const hasAnyReset = hasCssReset || hasLocalInsertions || hasRemovedKeys;
              if (hasAnyReset) {
                nextPageNodes = patchNodeById(s.pageNodes as SDUINode[], entryNodeId, n => {
                  const fresh = JSON.parse(JSON.stringify(n)) as Record<string, unknown>;

                  // Reset root-level cssProps
                  for (const p of instanceOverrides) {
                    try {
                      copyCssProp(content as unknown as Record<string, unknown>, fresh, p);
                    } catch (err) {
                      console.error('[enterSharedComponentEdit] copyCssProp failed for root prop', p, err);
                    }
                  }
                  fresh._overrides = [];

                  // Reset descendant-level cssProps by matching `_sharedKey`
                  // between fresh and model content. This is robust to any
                  // structural divergence between instance and model.
                  for (const entry of descendantOverrides) {
                    const liveDesc = _resolveDescendantBySharedKey(fresh, entry.sharedKey);
                    const modelDesc = _resolveDescendantBySharedKey(
                      content as unknown as Record<string, unknown>,
                      entry.sharedKey,
                    );
                    if (!liveDesc || !modelDesc) continue;
                    for (const p of entry.cssProps) {
                      try {
                        copyCssProp(modelDesc, liveDesc, p);
                      } catch (err) {
                        console.error('[enterSharedComponentEdit] copyCssProp failed for descendant prop', p, err);
                      }
                    }
                  }

                  // Hide instance-only local insertions from the model view.
                  if (hasLocalInsertions) {
                    const insertedKeys = new Set((localInsertionsSnap ?? []).map(e => e.subtreeSharedKey));
                    const pruneInsertions = (node: Record<string, unknown>) => {
                      const children = (node.children ?? []) as Record<string, unknown>[];
                      const kept: Record<string, unknown>[] = [];
                      for (const c of children) {
                        const k = c._sharedKey;
                        if (typeof k === 'string' && insertedKeys.has(k)) continue;
                        pruneInsertions(c);
                        kept.push(c);
                      }
                      if (kept.length !== children.length) node.children = kept;
                    };
                    pruneInsertions(fresh);
                  }

                  // Graft removed model descendants back in (pure model view).
                  // Two guards prevent INTERNAL duplicates inside the SC
                  // (e.g. a Button with two identical Text children):
                  //   1. DEDUP BY ANCESTOR: if a key's ancestor in the model
                  //      is ALSO in `_removedKeys`, skip it — grafting the
                  //      ancestor brings the descendant along for free, and
                  //      grafting the descendant again would duplicate it
                  //      INSIDE the grafted ancestor.
                  //   2. SKIP IF ALREADY PRESENT IN FRESH: defensive guard
                  //      against any other source of a pre-existing key
                  //      (e.g. a prior partial graft pass).
                  //
                  // NOTE: We intentionally do NOT skip when the key lives
                  // elsewhere on the page (move-out case). The user
                  // explicitly wants to see the "model view" inside the SC
                  // while editing — even if a real copy of that node is
                  // also visible at some other position outside the SC. The
                  // outside copy stays at its location; the graft appears
                  // inside the SC; on exit, the graft is pruned and the SC
                  // returns to its "moved out" state.
                  if (hasRemovedKeys) {
                    const contentRec = content as unknown as Record<string, unknown>;
                    const findInModel = (
                      root: Record<string, unknown>,
                      key: string,
                    ): { node: Record<string, unknown>; parentKey: string | null; atIdx: number; depth: number } | null => {
                      const walk = (n: Record<string, unknown>, depth: number): { node: Record<string, unknown>; parentKey: string | null; atIdx: number; depth: number } | null => {
                        const children = (n.children ?? []) as Record<string, unknown>[];
                        for (let i = 0; i < children.length; i++) {
                          const c = children[i];
                          if (c._sharedKey === key) {
                            return { node: c, parentKey: (n._sharedKey as string) ?? null, atIdx: i, depth: depth + 1 };
                          }
                          const sub = walk(c, depth + 1);
                          if (sub) return sub;
                        }
                        return null;
                      };
                      return walk(root, 0);
                    };
                    // Helper: collect every sharedKey inside a subtree.
                    const keysInSubtree = (node: Record<string, unknown>): Set<string> => {
                      const out = new Set<string>();
                      (function collect(n: Record<string, unknown>) {
                        const k = n._sharedKey;
                        if (typeof k === 'string' && k) out.add(k);
                        const children = (n.children ?? []) as Record<string, unknown>[];
                        for (const c of children) collect(c);
                      })(node);
                      return out;
                    };

                    const removedSet = new Set(removedKeysSnap ?? []);
                    // Order removed keys by actual depth in the model,
                    // ancestors (smaller depth) FIRST. This is essential: a
                    // stable-sort that doesn't differentiate depth would let
                    // a descendant be processed before its ancestor,
                    // defeating the ancestor-dedup guard.
                    const orderedKeys = [...(removedKeysSnap ?? [])]
                      .map(k => ({ key: k, depth: findInModel(contentRec, k)?.depth ?? Number.MAX_SAFE_INTEGER }))
                      .sort((a, b) => a.depth - b.depth)
                      .map(e => e.key);
                    const graftedKeys = new Set<string>();

                    for (const key of orderedKeys) {
                      const match = findInModel(contentRec, key);
                      if (!match || !match.parentKey) continue;

                      // Guard 1: if an ancestor of this key in the model is also
                      // in _removedKeys AND we've already grafted it, this key
                      // came along inside the ancestor subtree — skip.
                      let ancestorAlreadyGrafted = false;
                      {
                        let cursorKey: string | null = match.parentKey;
                        while (cursorKey) {
                          if (graftedKeys.has(cursorKey)) { ancestorAlreadyGrafted = true; break; }
                          if (!removedSet.has(cursorKey)) break;
                          const up = findInModel(contentRec, cursorKey);
                          cursorKey = up?.parentKey ?? null;
                        }
                      }
                      if (ancestorAlreadyGrafted) continue;

                      // Guard 2: already present in fresh (defensive)?
                      if (findBySharedKey(fresh, key)) continue;

                      const freshParent = findBySharedKey(fresh, match.parentKey);
                      if (!freshParent) continue;
                      const grafted = cloneWithFreshIdsKeepSharedKey(
                        JSON.parse(JSON.stringify(match.node)) as Record<string, unknown>,
                      );
                      const pChildren = ((freshParent.children ?? []) as Record<string, unknown>[]).slice();
                      const idx = Math.max(0, Math.min(match.atIdx, pChildren.length));
                      pChildren.splice(idx, 0, grafted);
                      freshParent.children = pChildren;

                      // Mark every sharedKey inside the grafted subtree as
                      // "covered" so subsequent iterations don't re-graft.
                      for (const k of keysInSubtree(grafted)) graftedKeys.add(k);
                    }
                  }

                  // Hide instance-only structural metadata during edit so the
                  // canvas truly shows a pure model view. It's restored on exit.
                  delete fresh._localInsertions;
                  delete fresh._removedKeys;

                  return fresh as unknown as SDUINode;
                }) as SDUINode[];
              }
            }
          }
        } catch (err) {
          console.error('[enterSharedComponentEdit] snapshot/apply-baseline failed; entering edit mode without snapshotting', err);
          nextPageNodes = s.pageNodes;
        }

        return {
          pageNodes: nextPageNodes,
          _editEntrySelection: entrySelection,
          _preEditInstanceSnapshot: nextSnapshots,
          editingSharedComponentIds: [...s.editingSharedComponentIds, modelId],
          editingSharedComponentId: modelId,
          editingSharedComponentContentsMap: { ...s.editingSharedComponentContentsMap, [modelId]: content },
          editingSharedComponentModelsMap: { ...s.editingSharedComponentModelsMap, [modelId]: model as Record<string, unknown> },
          editingSharedComponentContent: content,
          editingSharedComponentModel: model as Record<string, unknown>,
          editingKind: kind,
          editingKindMap: { ...s.editingKindMap, [modelId]: kind },
        };
      }

      // Full mode: insert backdrop + repositioned content into the canvas.
      // Use cloneWithFreshIdsKeepSharedKey so every inner node gets a unique id —
      // this is required for findNode to locate them and for the right panel
      // (Workflows, Design tabs) to reflect the correct node when selected in the layer tree.
      const contentNode = cloneWithFreshIdsKeepSharedKey(
        JSON.parse(JSON.stringify(content)) as Record<string, unknown>
      ) as unknown as SDUINode;
      const baseZ = 50 + s.editingSharedComponentIds.length;

      const dimBackdrop: SDUINode = {
        type: 'Box',
        id: `__sc-edit-backdrop-${modelId}`,
        props: {
          style: {
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            minHeight: '100%',
            zIndex: baseZ,
            background: '#ffffff',
          },
        },
      } as SDUINode;

      const builderContent: SDUINode = {
        ...contentNode,
        props: {
          ...(contentNode.props ?? {}),
          style: {
            ...((contentNode.props as Record<string, unknown> | undefined)?.style as Record<string, unknown> | undefined ?? {}),
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: baseZ + 1,
          },
        },
      } as SDUINode;

      const nextNodes = [...clone(s.pageNodes), dimBackdrop, builderContent] as SDUINode[];
      const savedPageNodes = s._savedPageNodes ?? clone(s.pageNodes);

      return {
        _savedPageNodes: savedPageNodes,
        pageNodes: nextNodes,
        _editEntrySelection: entrySelection,
        editingSharedComponentIds: [...s.editingSharedComponentIds, modelId],
        editingSharedComponentId: modelId,
        editingSharedComponentContentsMap: { ...s.editingSharedComponentContentsMap, [modelId]: content },
        editingSharedComponentModelsMap: { ...s.editingSharedComponentModelsMap, [modelId]: model as Record<string, unknown> },
        editingSharedComponentContent: content,
        editingSharedComponentModel: model as Record<string, unknown>,
        editingKind: kind,
        editingKindMap: { ...s.editingKindMap, [modelId]: kind },
        selectedIds: [],
      };
    });
    get()._pushHistory();
  },

  saveEditingSharedComponent: (modelId) => {
    const { editingSharedComponentContentsMap, editingSharedComponentModelsMap, pageNodes } = get();
    const targetContent = editingSharedComponentContentsMap[modelId];
    const targetModel = getSharedComponents()[modelId] ?? editingSharedComponentModelsMap[modelId];
    if (!targetContent || !targetModel) return;

    const contentRootId = (targetContent as unknown as { id?: string }).id;
    const liveNode = contentRootId
      ? (pageNodes as SDUINode[]).find(n => (n as unknown as { id?: string }).id === contentRootId)
      : undefined;

    if (liveNode) {
      // ── No-op in SIMPLE edit mode ──────────────────────────────────────────
      // Simple mode edits the original instance directly (liveNode carries
      // `_shared`). In that mode `_syncSharedInstances` already propagates
      // every intentional patch to the model incrementally AND strips A's
      // per-instance `_overrides` so they don't leak in. If we also ran this
      // "save live node verbatim" path (e.g. from the 800ms auto-save timer),
      // it would copy A's full current state — including A's override values —
      // straight onto the model, leaking instance edits to the SC. Skip it.
      //
      // Full mode uses a synthetic `builderContent` node with NO `_shared`,
      // so this guard lets it through unchanged.
      const liveShared = (liveNode as unknown as Record<string, unknown>)._shared;
      if (liveShared) return;

      const BUILDER_KEYS = new Set(['position', 'top', 'left', 'right', 'zIndex']);
      const rawStyle = ((liveNode.props as Record<string, unknown>)?.style ?? {}) as Record<string, unknown>;
      const cleanStyle = Object.fromEntries(Object.entries(rawStyle).filter(([k]) => !BUILDER_KEYS.has(k)));
      const originalStyle = (targetContent.props as Record<string, unknown> | undefined)?.style as Record<string, unknown> | undefined;
      if (!originalStyle?.['height']) delete cleanStyle['height'];

      const savedNode = {
        ...liveNode,
        props: { ...(liveNode.props ?? {}), style: Object.keys(cleanStyle).length > 0 ? cleanStyle : undefined },
      } as Record<string, unknown>;
      // Strip instance-only metadata from the root AND every descendant.
      delete savedNode._overrides;
      delete savedNode._descendantOverrides;
      delete savedNode._removedKeys;
      delete savedNode._localInsertions;
      (function stripNested(n: Record<string, unknown>) {
        const children = (n.children ?? []) as Record<string, unknown>[];
        for (const c of children) {
          delete c._overrides;
          delete c._descendantOverrides;
          delete c._removedKeys;
          delete c._localInsertions;
          stripNested(c);
        }
      })(savedNode);
      updateSharedComponent({ ...(targetModel as { id: string }), content: savedNode });
    }
  },

  exitSharedComponentEdit: (modelId?) => {
    const {
      editingSharedComponentId: lastId,
      editingSharedComponentIds,
      editingSharedComponentContentsMap,
      editingSharedComponentModelsMap,
      pageNodes,
      _savedPageNodes,
      _preEditInstanceSnapshot,
    } = get();

    const targetId = modelId ?? lastId;
    if (!targetId) return;

    const targetContent = editingSharedComponentContentsMap[targetId];
    const targetModel   = getSharedComponents()[targetId] ?? editingSharedComponentModelsMap[targetId];

    // ── SIMPLE edit mode detection ─────────────────────────────────────────
    // Presence of a pre-edit snapshot means we entered via simple mode and the
    // live instance node lives somewhere in `pageNodes` (possibly nested). We
    // use the snapshot's `instanceNodeId` — NOT the model's content root id —
    // because duplicate/nested instances have their own ids that don't match
    // the model's content id.
    const snap = (_preEditInstanceSnapshot ?? {})[targetId];
    if (snap) {
      let nextPageNodes = pageNodes as SDUINode[];

      try {
        const hasRootOverrides = snap.instanceOverrides.length > 0;
        const hasDescOverrides = (snap.descendantOverrides ?? []).length > 0;
        const hasRemovedKeys = (snap.removedKeys?.length ?? 0) > 0;
        const hasLocalInsertions = (snap.localInsertions?.length ?? 0) > 0;
        if (hasRootOverrides || hasDescOverrides || hasRemovedKeys || hasLocalInsertions) {
          // ALWAYS restore snapshotted overrides on exit. The instance's
          // override is "sticky" — it wins over the model for any cssProp in
          // `_overrides` (root) or the descendant override snapshot (children),
          // even if the user edited that same prop in the model while inside
          // Edit Component mode. To promote a model value to an instance, the
          // user must first RESET the override on the instance (outside edit
          // mode), which removes the cssProp from `_overrides` and lets the
          // model value flow through.
          const rootMockSource: Record<string, unknown> = {
            props: {
              className: snap.instancePropsSnapshot.className,
              style: snap.instancePropsSnapshot.style,
            },
            animation: snap.instancePropsSnapshot.animation,
          };

          nextPageNodes = patchNodeById(nextPageNodes, snap.instanceNodeId, n => {
            const fresh = JSON.parse(JSON.stringify(n)) as Record<string, unknown>;

            // Restore root-level overrides
            if (hasRootOverrides) {
              for (const p of snap.instanceOverrides) {
                copyCssProp(rootMockSource, fresh, p);
              }
            }
            fresh._overrides = [...snap.instanceOverrides];

            // Restore descendant-level overrides by matching `_sharedKey`.
            // The tree may have changed during edit (adds/removes of siblings
            // from the model, local insertions, etc.); sharedKey matching is
            // robust to those shifts. Entries whose key no longer resolves
            // are silently skipped.
            for (const entry of snap.descendantOverrides ?? []) {
              const liveDesc = _resolveDescendantBySharedKey(fresh, entry.sharedKey);
              if (!liveDesc) continue;
              const descMockSource: Record<string, unknown> = {
                props: {
                  className: entry.propsSnapshot.className,
                  style: entry.propsSnapshot.style,
                },
                animation: entry.propsSnapshot.animation,
              };
              for (const p of entry.cssProps) {
                copyCssProp(descMockSource, liveDesc, p);
              }
            }

            // Restore the explicit Phase-3/5 metadata. These were preserved
            // unchanged during edit (instance-only state), but edit-mode
            // patches to the instance root may have accidentally stripped them.
            if (snap.explicitDescendantOverrides !== undefined) {
              if (Object.keys(snap.explicitDescendantOverrides).length > 0) {
                fresh._descendantOverrides = JSON.parse(JSON.stringify(snap.explicitDescendantOverrides));
              } else {
                delete fresh._descendantOverrides;
              }
            }
            if (snap.removedKeys !== undefined) {
              if (snap.removedKeys.length > 0) fresh._removedKeys = [...snap.removedKeys];
              else delete fresh._removedKeys;
            }
            if (snap.localInsertions !== undefined) {
              if (snap.localInsertions.length > 0) fresh._localInsertions = JSON.parse(JSON.stringify(snap.localInsertions));
              else delete fresh._localInsertions;
            }

            // ── Restore structural divergences hidden at enter ────────────
            // Shared helper to locate a node by its `_sharedKey`.
            const findBySharedKey = (root: Record<string, unknown>, key: string): Record<string, unknown> | null => {
              if (root._sharedKey === key) return root;
              const children = (root.children ?? []) as Record<string, unknown>[];
              for (const c of children) {
                const found = findBySharedKey(c, key);
                if (found) return found;
              }
              return null;
            };

            // 1. Re-remove the model descendants that this instance had in
            //    `_removedKeys` pre-edit. At enter we grafted them back to
            //    show the pure model view; now we prune them again so the
            //    instance keeps its local deletion. Matches work by
            //    `_sharedKey`, so if the model itself deleted the key
            //    during edit mode, the graft is already gone and this is a
            //    safe no-op.
            if (hasRemovedKeys) {
              const removedSet = new Set(snap.removedKeys ?? []);
              const pruneRemoved = (node: Record<string, unknown>) => {
                const children = (node.children ?? []) as Record<string, unknown>[];
                const kept: Record<string, unknown>[] = [];
                for (const c of children) {
                  const k = c._sharedKey;
                  if (typeof k === 'string' && removedSet.has(k)) continue;
                  pruneRemoved(c);
                  kept.push(c);
                }
                if (kept.length !== children.length) node.children = kept;
              };
              pruneRemoved(fresh);
            }

            // 2. Re-insert the instance-only local insertions we stripped
            //    at enter. We replay them from the saved subtree payloads
            //    using fresh ids (but preserving `_sharedKey`) so the DOM
            //    ids don't collide with anything already on the canvas.
            if (hasLocalInsertions && snap.insertedSubtrees) {
              for (const entry of snap.localInsertions ?? []) {
                const savedSubtree = snap.insertedSubtrees[entry.subtreeSharedKey];
                if (!savedSubtree) continue;
                const freshParent = findBySharedKey(fresh, entry.parentSharedKey);
                if (!freshParent) continue;
                const cloned = cloneWithFreshIdsKeepSharedKey(
                  JSON.parse(JSON.stringify(savedSubtree)) as Record<string, unknown>,
                );
                const pChildren = ((freshParent.children ?? []) as Record<string, unknown>[]).slice();
                const idx = Math.max(0, Math.min(entry.atIdx, pChildren.length));
                pChildren.splice(idx, 0, cloned);
                freshParent.children = pChildren;
              }
            }

            return fresh as unknown as SDUINode;
          }) as SDUINode[];
        }
      } catch (err) {
        console.error('[exitSharedComponentEdit] snapshot restore failed; exiting without restoring overrides', err);
      }

      const newEditingIds  = editingSharedComponentIds.filter(id => id !== targetId);
      const newContentsMap = Object.fromEntries(Object.entries(editingSharedComponentContentsMap).filter(([k]) => k !== targetId));
      const newModelsMap   = Object.fromEntries(Object.entries(editingSharedComponentModelsMap).filter(([k]) => k !== targetId));
      const newLastId      = newEditingIds[newEditingIds.length - 1] ?? null;
      const allClosed      = newEditingIds.length === 0;
      const nextSnapshots  = Object.fromEntries(Object.entries(_preEditInstanceSnapshot ?? {}).filter(([k]) => k !== targetId));

      set({
        pageNodes: nextPageNodes,
        _savedPageNodes: allClosed ? null : _savedPageNodes,
        _editEntrySelection: allClosed ? null : get()._editEntrySelection,
        _preEditInstanceSnapshot: nextSnapshots,
        editingSharedComponentIds: newEditingIds,
        editingSharedComponentId: newLastId,
        editingSharedComponentContentsMap: newContentsMap,
        editingSharedComponentModelsMap: newModelsMap,
        editingSharedComponentContent: newLastId ? newContentsMap[newLastId] ?? null : null,
        editingSharedComponentModel: newLastId ? newModelsMap[newLastId] ?? null : null,
        selectedIds: [],
      });
      get()._pushHistory();
      return;
    }

    if (targetContent) {
      const contentRootId = (targetContent as unknown as { id?: string }).id;
      const liveNode = contentRootId
        ? (pageNodes as SDUINode[]).find(n => (n as unknown as { id?: string }).id === contentRootId)
        : undefined;

      if (liveNode) {
        // `_shared` is never added to the full-mode `builderContent` wrapper, so
        // reaching this branch via simple-mode entry shouldn't happen (simple
        // mode always records a snapshot and returns above). Guard for safety.
        const liveShared = (liveNode as unknown as Record<string, unknown>)._shared;
        if (liveShared) return;

        // ── FULL edit mode ──────────────────────────────────────────────────
        // Live node is a synthetic `builderContent` with no `_shared`; save it
        // as the model and remove it (+ backdrop) from pageNodes.
        const BUILDER_KEYS = new Set(['position', 'top', 'left', 'right', 'zIndex']);
        const rawStyle = ((liveNode.props as Record<string, unknown>)?.style ?? {}) as Record<string, unknown>;
        const cleanStyle = Object.fromEntries(Object.entries(rawStyle).filter(([k]) => !BUILDER_KEYS.has(k)));
        const originalStyle = (targetContent.props as Record<string, unknown> | undefined)?.style as Record<string, unknown> | undefined;
        if (!originalStyle?.['height']) delete cleanStyle['height'];

        const savedNode = {
          ...liveNode,
          props: { ...(liveNode.props ?? {}), style: Object.keys(cleanStyle).length > 0 ? cleanStyle : undefined },
        } as Record<string, unknown>;
        delete savedNode._overrides;
        delete savedNode._descendantOverrides;
        delete savedNode._removedKeys;
        delete savedNode._localInsertions;
        (function stripNested(n: Record<string, unknown>) {
          const children = (n.children ?? []) as Record<string, unknown>[];
          for (const c of children) {
            delete c._overrides;
            delete c._descendantOverrides;
            delete c._removedKeys;
            delete c._localInsertions;
            stripNested(c);
          }
        })(savedNode);
        updateSharedComponent({ id: targetId, ...(targetModel as Record<string, unknown>), content: savedNode });

        const backdropId = `__sc-edit-backdrop-${targetId}`;
        const newPageNodes = (pageNodes as SDUINode[]).filter(
          n => {
            const nid = (n as unknown as { id?: string }).id;
            return nid !== contentRootId && nid !== backdropId;
          }
        ) as SDUINode[];
        const newEditingIds  = editingSharedComponentIds.filter(id => id !== targetId);
        const newContentsMap = Object.fromEntries(Object.entries(editingSharedComponentContentsMap).filter(([k]) => k !== targetId));
        const newModelsMap   = Object.fromEntries(Object.entries(editingSharedComponentModelsMap).filter(([k]) => k !== targetId));
        const newLastId      = newEditingIds[newEditingIds.length - 1] ?? null;
        const allClosed      = newEditingIds.length === 0;

        set({
          pageNodes: newPageNodes,
          _savedPageNodes: allClosed ? null : _savedPageNodes,
          _editEntrySelection: allClosed ? null : get()._editEntrySelection,
          editingSharedComponentIds: newEditingIds,
          editingSharedComponentId: newLastId,
          editingSharedComponentContentsMap: newContentsMap,
          editingSharedComponentModelsMap: newModelsMap,
          editingSharedComponentContent: newLastId ? newContentsMap[newLastId] ?? null : null,
          editingSharedComponentModel: newLastId ? newModelsMap[newLastId] ?? null : null,
          selectedIds: [],
        });
        get()._pushHistory();
        return;
      }
    }

    // Fallback: content root not in current pageNodes
    const newEditingIds  = editingSharedComponentIds.filter(id => id !== targetId);
    const newContentsMap = Object.fromEntries(Object.entries(editingSharedComponentContentsMap).filter(([k]) => k !== targetId));
    const newModelsMap   = Object.fromEntries(Object.entries(editingSharedComponentModelsMap).filter(([k]) => k !== targetId));
    const newLastId      = newEditingIds[newEditingIds.length - 1] ?? null;

    set({
      pageNodes: pageNodes as SDUINode[],
      _savedPageNodes: newEditingIds.length === 0 ? null : _savedPageNodes,
      _editEntrySelection: newEditingIds.length === 0 ? null : get()._editEntrySelection,
      editingSharedComponentIds: newEditingIds,
      editingSharedComponentId: newLastId,
      editingSharedComponentContentsMap: newContentsMap,
      editingSharedComponentModelsMap: newModelsMap,
      editingSharedComponentContent: newLastId ? newContentsMap[newLastId] ?? null : null,
      editingSharedComponentModel: newLastId ? newModelsMap[newLastId] ?? null : null,
      selectedIds: [],
    });
    get()._pushHistory();
  },

  // ── Theme overrides ──────────────────────────────────────────────────────────

  initTheme: () => {
    // Install bridge style tags immediately so Gluestack components respect
    // the active --primary even before the user picks a preset.
    const { themeOverrides, themeDarkOverrides, customColors } = get();
    _applyLightOverrides(themeOverrides, customColors);
    _applyDarkOverrides(themeDarkOverrides, customColors);
  },

  patchTheme: (cssVar, value, mode = 'light') => {
    const { customColors } = get();
    if (mode === 'light') {
      // Read current state first, then apply DOM change, then commit to store
      const next = { ...get().themeOverrides, [cssVar]: value };
      _applyLightOverrides(next, customColors);
      set({ themeOverrides: next });
    } else {
      const next = { ...get().themeDarkOverrides, [cssVar]: value };
      _applyDarkOverrides(next, customColors);
      set({ themeDarkOverrides: next });
    }
  },

  resetTheme: () => {
    const { customColors } = get();
    _applyLightOverrides({}, customColors);
    _applyDarkOverrides({}, customColors);
    set({ themeOverrides: {}, themeDarkOverrides: {} });
  },

  // ── Logic / Behavior helpers ─────────────────────────────────────────────────

  patchCondition: (id, condition) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node =>
      condition === null
        ? (({ condition: _c, ...rest }) => rest)(node as SDUINode & { condition?: unknown }) as SDUINode
        : { ...node, condition } as SDUINode
    ));
    get()._pushHistory();
  },

  patchActions: (id, actions) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node =>
      actions === null
        ? (({ actions: _a, ...rest }) => rest)(node as SDUINode & { actions?: unknown }) as SDUINode
        : { ...node, actions } as SDUINode
    ));
    get()._pushHistory();
  },

  patchMap: (id, mapPath, keyField) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => {
      if (mapPath === null) {
        const { map: _m, key: _k, ...rest } = node as SDUINode & { map?: unknown; key?: unknown };
        return rest as SDUINode;
      }
      return { ...node, map: mapPath, ...(keyField !== undefined ? { key: keyField } : {}) } as SDUINode;
    }));
    get()._pushHistory();
  },

  patchDataSource: (id, ds) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node =>
      ds === null
        ? (({ dataSource: _d, ...rest }) => rest)(node as SDUINode & { dataSource?: unknown }) as SDUINode
        : { ...node, dataSource: ds } as unknown as SDUINode
    ));
    get()._pushHistory();
  },

  patchVariant: (id, variants) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node =>
      variants === null
        ? (({ _variants: _v, ...rest }) => rest)(node as SDUINode & { _variants?: unknown }) as SDUINode
        : { ...node, _variants: variants } as SDUINode
    ));
    get()._pushHistory();
  },

  patchNodeField: (id, field, value) => {
    const prevRootSnap = _snapshotSharedRoot(get(), id);
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => ({ ...node, [field]: value }) as SDUINode));
    get()._syncSharedInstances(id, prevRootSnap ? { prevEditedNode: prevRootSnap } : undefined);
    get()._pushHistory();
  },

  patchNodeFieldLive: (id, field, value) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => ({ ...node, [field]: value }) as SDUINode));
    // Intentionally no _pushHistory — caller must call _pushHistory() once on commit.
  },

  detachInstance: (id) => {
    const STRIP_KEYS = new Set([
      '_shared',
      '_overrides',
      '_descendantOverrides',
      '_removedKeys',
      '_localInsertions',
      '_sharedKey',
    ]);
    const strip = (n: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n)) {
        if (STRIP_KEYS.has(k)) continue;
        if (k === 'children' && Array.isArray(v)) {
          out.children = (v as Record<string, unknown>[]).map(strip);
        } else {
          out[k] = v;
        }
      }
      return out;
    };
    set(s => patchAnyNode(
      s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] },
      id,
      node => strip(node as unknown as Record<string, unknown>) as unknown as SDUINode,
    ));
    get()._pushHistory();
  },

  setPreviewState: (state) => set({ activePreviewStates: [state] }),
  togglePreviewState: (state) =>
    set((s) => {
      if (state === 'normal') return { activePreviewStates: ['normal'] };
      const current = s.activePreviewStates.filter(x => x !== 'normal');
      const has = current.includes(state);
      const next = has ? current.filter(x => x !== state) : [...current, state];
      return { activePreviewStates: next.length === 0 ? ['normal'] : next };
    }),
  setCurrentPagePreviewData: (data) =>
    set((s) => ({
      pages: s.pages.map((p) => p.id === s.focusedPageId ? { ...p, previewData: data } : p),
    })),

  setCurrentPageMeta: (meta) =>
    set((s) => ({
      pages: s.pages.map((p) => p.id === s.focusedPageId ? { ...p, meta: { ...p.meta, ...meta } } : p),
    })),

  setCurrentPageInteractions: (interactions) =>
    set((s) => ({
      pages: s.pages.map((p) => p.id === s.focusedPageId ? { ...p, pageInteractions: interactions } : p),
    })),

  setCurrentPageQueryParams: (params) =>
    set((s) => ({
      pages: s.pages.map((p) => p.id === s.focusedPageId ? { ...p, queryParams: params } : p),
    })),

  setCurrentPageAccess: (access, guestOnly, accessCondition) =>
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === s.focusedPageId
          ? { ...p, access, guestOnly, accessCondition: accessCondition ?? p.accessCondition }
          : p
      ),
    })),

  setAuthConfig: (config) => set({ authConfig: config }),

  setAppPreviewData: (data) => set({ appPreviewData: data }),

  setPageWorkflow: (name, actions) =>
    set(s => ({ pageWorkflows: { ...s.pageWorkflows, [name]: actions } })),
  removePageWorkflow: (name) =>
    set(s => {
      const { [name]: _pw, ...restWorkflows } = s.pageWorkflows;
      const { [name]: _pm, ...restMeta } = s.pageWorkflowMeta;
      return { pageWorkflows: restWorkflows, pageWorkflowMeta: restMeta };
    }),
  setPageWorkflowMeta: (name, meta) =>
    set(s => ({ pageWorkflowMeta: { ...s.pageWorkflowMeta, [name]: { ...s.pageWorkflowMeta[name], ...meta, id: name } } })),
  setGlobalWorkflow: (name, actions) =>
    set(s => ({ globalWorkflows: { ...s.globalWorkflows, [name]: actions } })),
  removeGlobalWorkflow: (name) =>
    set(s => { const { [name]: _, ...rest } = s.globalWorkflows; return { globalWorkflows: rest }; }),
  setGlobalWorkflowMeta: (id, meta) =>
    set(s => ({ globalWorkflowMeta: { ...s.globalWorkflowMeta, [id]: { ...s.globalWorkflowMeta[id], ...meta, id } } })),
  setWorkflowStepTestResult: (stepId, result, error, stepIndex, actionName = 'Action', workflowId = '') => {
    const entry: import('./_store-types').WorkflowTestEntry = { result, error, actionName, stepIndex, ranAt: Date.now(), workflowId };
    persistWorkflowStepTestResult(stepId, entry);
    set(s => ({ workflowTestResults: { ...s.workflowTestResults, [stepId]: entry } }));
  },
  openWorkflowCanvas: (target) => set({ workflowCanvasTarget: target }),
  closeWorkflowCanvas: () => set({ workflowCanvasTarget: null, liveCanvasSteps: null }),
  liveCanvasSteps: null,
  setLiveCanvasSteps: (steps) => set({ liveCanvasSteps: steps }),
  setGlobalFormula: (id, def) => {
    set(s => {
      if (def == null) {
        const { [id]: _, ...rest } = s.globalFormulas;
        return { globalFormulas: rest };
      }
      return { globalFormulas: { ...s.globalFormulas, [id]: def as import('./_store-types').GlobalFormulaDef } };
    });
    // Sync evaluator registry + editor tokenizer after state settles
    setTimeout(() => {
      const formulas = useBuilderStore.getState().globalFormulas;
      registerGlobalFormulas(formulas as Record<string, unknown>);
      import('./_formula-editor-dom').then(({ setUserFormulaNames }) => {
        setUserFormulaNames(Object.values(formulas).map((d: unknown) => (d as { name?: string })?.name ?? '').filter(Boolean));
      });
    }, 0);
  },
  setGlobalFormulaFull: (id, def) => {
    set(s => {
      if (def == null) {
        const { [id]: _, ...rest } = s.globalFormulas;
        return { globalFormulas: rest };
      }
      return { globalFormulas: { ...s.globalFormulas, [id]: def } };
    });
    setTimeout(() => {
      const formulas = useBuilderStore.getState().globalFormulas;
      registerGlobalFormulas(formulas as Record<string, unknown>);
      import('./_formula-editor-dom').then(({ setUserFormulaNames }) => {
        setUserFormulaNames(Object.values(formulas).map((d: unknown) => (d as { name?: string })?.name ?? '').filter(Boolean));
      });
    }, 0);
  },
  removeGlobalFormula: (name) => {
    set(s => { const { [name]: _, ...rest } = s.globalFormulas; return { globalFormulas: rest }; });
    setTimeout(() => {
      const formulas = useBuilderStore.getState().globalFormulas;
      registerGlobalFormulas(formulas as Record<string, unknown>);
      import('./_formula-editor-dom').then(({ setUserFormulaNames }) => {
        setUserFormulaNames(Object.values(formulas).map((d: unknown) => (d as { name?: string })?.name ?? '').filter(Boolean));
      });
    }, 0);
  },

  addVarFolder: (f) => set(s => ({ varFolders: [...s.varFolders.filter(x => x.id !== f.id), f] })),
  updateVarFolder: (id, name) => set(s => ({ varFolders: s.varFolders.map(f => f.id === id ? { ...f, name } : f) })),
  removeVarFolder: (id) => set(s => {
    const toRemove = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of s.varFolders) {
        if (f.parentId && toRemove.has(f.parentId) && !toRemove.has(f.id)) { toRemove.add(f.id); changed = true; }
      }
    }
    return {
      varFolders: s.varFolders.filter(f => !toRemove.has(f.id)),
      customVars: s.customVars.map(v => v.folderId && toRemove.has(v.folderId) ? { ...v, folderId: undefined } : v),
    };
  }),

  addDsFolder: (f) => set(s => ({ dsFolders: [...s.dsFolders.filter(x => x.id !== f.id), f] })),
  updateDsFolder: (id, name) => set(s => ({ dsFolders: s.dsFolders.map(f => f.id === id ? { ...f, name } : f) })),
  removeDsFolder: (id) => set(s => {
    const toRemove = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of s.dsFolders) {
        if (f.parentId && toRemove.has(f.parentId) && !toRemove.has(f.id)) { toRemove.add(f.id); changed = true; }
      }
    }
    return {
      dsFolders: s.dsFolders.filter(f => !toRemove.has(f.id)),
      pageDataSources: s.pageDataSources.map(d => d.folderId && toRemove.has(d.folderId) ? { ...d, folderId: undefined } : d),
    };
  }),

  addColorFolder: (f) => set(s => ({ colorFolders: [...s.colorFolders.filter(x => x.id !== f.id), f] })),
  updateColorFolder: (id, name) => set(s => ({ colorFolders: s.colorFolders.map(f => f.id === id ? { ...f, name } : f) })),
  removeColorFolder: (id) => set(s => {
    const toRemove = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of s.colorFolders) {
        if (f.parentId && toRemove.has(f.parentId) && !toRemove.has(f.id)) { toRemove.add(f.id); changed = true; }
      }
    }
    const nextColors = s.customColors.map(c => c.folderId && toRemove.has(c.folderId) ? { ...c, folderId: undefined } : c);
    // Re-apply theme so any orphaned custom colors stay valid (no var-name change here, just folder cleanup).
    _applyLightOverrides(s.themeOverrides, nextColors);
    _applyDarkOverrides(s.themeDarkOverrides, nextColors);
    return {
      colorFolders: s.colorFolders.filter(f => !toRemove.has(f.id)),
      customColors: nextColors,
    };
  }),

  addCustomColor: (c) => {
    set(s => {
      const id = c.id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `cc-${Date.now()}`);
      const next = [...s.customColors.filter(x => x.id !== id && x.name !== c.name), { ...c, id }];
      _applyLightOverrides(s.themeOverrides, next);
      _applyDarkOverrides(s.themeDarkOverrides, next);
      return { customColors: next };
    });
  },
  updateCustomColor: (id, patch) => {
    set(s => {
      const next = s.customColors.map(c => c.id === id ? { ...c, ...patch, id: c.id } : c);
      _applyLightOverrides(s.themeOverrides, next);
      _applyDarkOverrides(s.themeDarkOverrides, next);
      return { customColors: next };
    });
  },
  removeCustomColor: (id) => {
    set(s => {
      const next = s.customColors.filter(c => c.id !== id);
      _applyLightOverrides(s.themeOverrides, next);
      _applyDarkOverrides(s.themeDarkOverrides, next);
      return { customColors: next };
    });
  },

  addCustomVar: (v) => {
    const id = v.id ?? crypto.randomUUID();
    const varWithId: CustomVar = { ...v, id };
    // Always seed/refresh the runtime value in the global variable store so
    // formula evaluation (variables['uuid']) reflects the current initialValue.
    // Without this, rebuilding with the same UUID but a new data schema would
    // leave the old array in the store and all bound formulas would return undefined.
    const vs = getGlobalVariableStore().getState();
    vs.setState((prev: Record<string, unknown>) => ({ ...prev, [id]: varWithId.initialValue ?? null }));
    // Register for localStorage persistence — registerStorageVar will also read any
    // previously stored value from localStorage and override the initialValue above.
    if (varWithId.saveInLocalStorage) {
      registerStorageVar(id, varWithId.initialValue);
    }
    set(s => ({
      customVars: [
        ...s.customVars.filter(x => x.name !== v.name),
        varWithId,
      ],
    }));
  },
  updateCustomVar: (name, patch) => {
    // Sync initialValue changes to the global variable store so preview stays live
    if ('initialValue' in patch) {
      const current = useBuilderStore.getState().customVars.find(v => v.name === name);
      if (current?.id) {
        getGlobalVariableStore().getState().setState((prev: Record<string, unknown>) => ({
          ...prev, [current.id!]: patch.initialValue ?? null,
        }));
        // Re-register to update the comparison default so the subscription can
        // correctly decide whether to write or remove the localStorage entry.
        if (current.saveInLocalStorage) {
          registerStorageVar(current.id, patch.initialValue);
        }
      }
    }
    // Handle saveInLocalStorage toggle
    if ('saveInLocalStorage' in patch) {
      const current = useBuilderStore.getState().customVars.find(v => v.name === name);
      if (current?.id) {
        if (patch.saveInLocalStorage) {
          registerStorageVar(current.id, current.initialValue);
        } else {
          unregisterStorageVar(current.id, true);
        }
      }
    }
    set(s => ({ customVars: s.customVars.map(v => v.name === name ? { ...v, ...patch } : v) }));
  },
  removeCustomVar: (name) => {
    const toRemove = useBuilderStore.getState().customVars.find(v => v.name === name);
    if (toRemove?.id) unregisterStorageVar(toRemove.id, true);
    set(s => ({ customVars: s.customVars.filter(v => v.name !== name) }));
  },

  addPageDataSource: (cfg) =>
    set(s => ({ pageDataSources: [...s.pageDataSources, cfg] })),
  updatePageDataSource: (id, patch) => {
    // Auto-persist _lastFetch changes to localStorage so they survive refresh
    if ('_lastFetch' in patch) persistDsLastFetch(id, patch._lastFetch);
    set(s => ({ pageDataSources: s.pageDataSources.map(d => d.id === id ? { ...d, ...patch } : d) }));
  },
  removePageDataSource: (id) => {
    // Remove persisted fetch result when datasource is deleted
    persistDsLastFetch(id, undefined);
    set(s => ({ pageDataSources: s.pageDataSources.filter(d => d.id !== id) }));
  },

  loadFromConfig: async (projectId?: string, opts?: { eagerAll?: boolean /* unused — always true for real projects now */ }) => {
    // ── Real backend project ──────────────────────────────────────────────────
    // Any projectId that is not the dev-only "admin" magic ID means a real
    // backend project. We load exclusively from the
    // backend — never fall through to static config.
    if (projectId && projectId !== 'admin') {
      try {
        // ── Step 1: Load metadata (page list without nodes) + all non-page data
        const metaRes = await fetch(`/api/projects/${projectId}/config/meta`, { credentials: 'include' });
        const saved = metaRes.ok
          ? ((await metaRes.json() as { config?: Record<string, unknown> }).config ?? null)
          : null;

        // Extract page stubs from whatever the backend returned (may be empty array for new project)
        const pageStubs = (saved?.pages ?? []) as Array<{ id: string; name: string; route?: string }>;

        if (pageStubs.length > 0) {
          // ── Existing project — load pages ────────────────────────────────────
          // Always fetch ALL pages in parallel — every page in the canvas shows
          // its content immediately after load (no "Empty page" stubs).
          const fetchPageNodes = async (pageId: string): Promise<SDUINode[]> => {
            try {
              const pageRes = await fetch(`/api/projects/${projectId}/pages/${pageId}`, { credentials: 'include' });
              if (pageRes.ok) {
                const pageData = await pageRes.json() as { page?: { nodes?: SDUINode[] } };
                const rawNodes = (pageData.page?.nodes ?? []) as SDUINode[];
                // Ensure every node has a UUID id so the builder can stamp
                // data-builder-id and selection/hover works. Nodes seeded from
                // the static config (home.json etc.) have no ids.
                return _assignIds(rawNodes, pageId, { n: 0 });
              }
            } catch { /* ignore fetch errors — page stays empty */ }
            return [];
          };

          const fetchedNodesList = await Promise.all(pageStubs.map(s => fetchPageNodes(s.id)));

          const nodesByPageId = new Map<string, SDUINode[]>();
          pageStubs.forEach((stub, i) => nodesByPageId.set(stub.id, fetchedNodesList[i]));

          const firstPageId = pageStubs[0].id;
          const firstPageNodes = nodesByPageId.get(firstPageId) ?? [];

          // Restore positions from saved config if available
          const savedPositions = (saved?.pagePositions ?? {}) as Record<string, { wx: number; wy: number }>;
          const vpWidth = VIEWPORT_WIDTHS['desktop'];
          const GAP = 80;
          const rawPages: BuilderPage[] = pageStubs.map((stub, i) => ({
            id: stub.id,
            name: stub.name,
            route: stub.route,
            nodes: nodesByPageId.get(stub.id) ?? [],
            wx: savedPositions[stub.id]?.wx ?? (i * (vpWidth + GAP)),
            wy: savedPositions[stub.id]?.wy ?? 0,
          }));
          const pages = assignDefaultPagePositions(rawPages, vpWidth);

          set(s => {
            const next: Partial<typeof s> = {};
            next.pages = pages;
            next.loadedPageIds = new Set(pageStubs.map(s => s.id)); // all loaded
            next.focusedPageId = pages[0].id;
            next.currentPageId = pages[0].id;  // keep deprecated alias in sync
            next.pageNodes = clone(firstPageNodes);
            next.history = [makeSnapshot(pages, pages[0].id, firstPageNodes, [])];
            next.historyIdx = 0;
            if (saved?.pageWorkflows) next.pageWorkflows = saved.pageWorkflows as typeof s.pageWorkflows;
            if (saved?.pageWorkflowMeta) next.pageWorkflowMeta = saved.pageWorkflowMeta as typeof s.pageWorkflowMeta;
            if (saved?.globalWorkflows) next.globalWorkflows = saved.globalWorkflows as typeof s.globalWorkflows;
            if (saved?.globalWorkflowMeta) next.globalWorkflowMeta = saved.globalWorkflowMeta as typeof s.globalWorkflowMeta;
            if (Array.isArray(saved?.customVars)) next.customVars = saved!.customVars as typeof s.customVars;
            if (Array.isArray(saved?.varFolders)) next.varFolders = saved!.varFolders as typeof s.varFolders;
            if (Array.isArray(saved?.pageDataSources)) next.pageDataSources = saved!.pageDataSources as typeof s.pageDataSources;
            if (Array.isArray(saved?.dsFolders)) next.dsFolders = saved!.dsFolders as typeof s.dsFolders;
            if (Array.isArray(saved?.customColors)) next.customColors = saved!.customColors as typeof s.customColors;
            if (Array.isArray(saved?.colorFolders)) next.colorFolders = saved!.colorFolders as typeof s.colorFolders;
            if (saved?.themeOverrides) next.themeOverrides = saved.themeOverrides as typeof s.themeOverrides;
            if (saved?.themeDarkOverrides) next.themeDarkOverrides = saved.themeDarkOverrides as typeof s.themeDarkOverrides;
            if (saved?.authConfig && typeof saved.authConfig === 'object') next.authConfig = saved.authConfig as typeof s.authConfig;
            if (saved?.projectMeta && typeof saved.projectMeta === 'object') {
              const pm = saved.projectMeta as { mood?: string; animationLevel?: number; layoutStructure?: number; description?: string; appName?: string; category?: string };
              if (pm.mood)                           next.projectMood            = pm.mood;
              if (pm.animationLevel != null)         next.projectAnimationLevel  = pm.animationLevel;
              if (pm.layoutStructure != null)        next.projectLayoutStructure = pm.layoutStructure;
              if (pm.description)                    next.projectDescription     = pm.description;
              if (pm.appName)                        next.projectAppName         = pm.appName;
              if (pm.category)                       next.projectCategory        = pm.category;
            }
            return next;
          });

          // Apply saved theme overrides to the DOM — initTheme() ran at mount time before
          // loadFromConfig completed, so the CSS vars need a second pass here.
          // Also include any saved customColors so their --<name> CSS vars are written.
          const savedCustomColors = Array.isArray(saved?.customColors)
            ? (saved!.customColors as CustomColor[])
            : [];
          if (saved?.themeOverrides && typeof saved.themeOverrides === 'object') {
            const lightOv = saved.themeOverrides as Record<string, string>;
            _applyLightOverrides(lightOv, savedCustomColors);
            injectFontsFromOverrides(lightOv);
          } else if (savedCustomColors.length > 0) {
            // No theme overrides, but custom colors must still be injected.
            _applyLightOverrides({}, savedCustomColors);
          }
          if (saved?.themeDarkOverrides && typeof saved.themeDarkOverrides === 'object') {
            _applyDarkOverrides(saved.themeDarkOverrides as Record<string, string>, savedCustomColors);
          } else if (savedCustomColors.length > 0) {
            _applyDarkOverrides({}, savedCustomColors);
          }

          // Seed loaded custom variables into the global variable store so
          // formula evaluation (variables['uuid']) resolves immediately.
          // The global store is only initialized from config/variables.json at
          // module load time — project-saved variables must be seeded explicitly.
          if (Array.isArray(saved?.customVars) && (saved!.customVars as CustomVar[]).length > 0) {
            const vs = getGlobalVariableStore().getState();
            const fullState = vs.getFullState() as Record<string, unknown>;
            const patches: Record<string, unknown> = {};
            for (const cv of saved!.customVars as CustomVar[]) {
              if (cv.id && !(cv.id in fullState)) {
                patches[cv.id] = cv.initialValue ?? null;
              }
            }
            if (Object.keys(patches).length > 0) {
              vs.setState((prev: Record<string, unknown>) => ({ ...prev, ...patches }));
            }
            // Register vars with saveInLocalStorage — registerStorageVar will immediately
            // read any stored value from localStorage and patch the store, restoring the
            // last persisted value after a page refresh.
            for (const cv of saved!.customVars as CustomVar[]) {
              if (cv.id && cv.saveInLocalStorage) {
                registerStorageVar(cv.id, cv.initialValue);
              }
            }
          }
        } else {
          // ── Brand new project (no pages) — seed a default Home page ──────────
          const homeId = crypto.randomUUID();
          const homePage: BuilderPage = { id: homeId, name: 'Home', route: '/', nodes: [], wx: 0, wy: 0 };

          set(() => ({
            pages: [homePage],
            focusedPageId: homeId,
            currentPageId: homeId,  // keep deprecated alias in sync
            pageNodes: [],
            history: [EMPTY_SNAPSHOT],
            historyIdx: 0,
            loadedPageIds: new Set<string>([homeId]),
            pageWorkflows: {},
            pageWorkflowMeta: {},
            globalWorkflows: {},
            globalWorkflowMeta: {},
            customVars: [],
            varFolders: [],
            pageDataSources: [],
            dsFolders: [],
            customColors: [],
            colorFolders: [],
            themeOverrides: {},
            themeDarkOverrides: {},
          }));

          // Persist the default page immediately so the autosave baseline and
          // the backend are in sync from the very first load.
          try {
            const { serializeBuilderState } = await import('@/lib/builder/autosave');
            const config = serializeBuilderState(useBuilderStore.getState());
            await fetch(`/api/projects/${projectId}/config`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(config),
              credentials: 'include',
            });
          } catch { /* non-fatal — autosave will retry on next change */ }
        }
        // Do NOT fall through to the static config loader.
        return;
      } catch (err) {
        console.warn('[builder] Failed to load project config from backend:', err);
        // Still clear & return — don't show static config for a real project.
        set(() => ({
          pages: [],
          focusedPageId: '',
          currentPageId: '',  // keep deprecated alias in sync
          canvasNodes: [],
          pageNodes: [],
          history: [EMPTY_SNAPSHOT],
          historyIdx: 0,
          loadedPageIds: new Set<string>(),
        }));
        return;
      }
    }

    // ── Admin / dev mode (no projectId or projectId === 'admin') ──────────────
    {
      const showcaseRoutePage = INITIAL_PAGES.find(p => p.route === '/sc-component-showcase');
      const defaultPageId = showcaseRoutePage?.id ?? INITIAL_PAGES[0]?.id ?? 'page-home';
      const defaultNodes = INITIAL_PAGES.find(p => p.id === defaultPageId)?.nodes ?? [];
      set(() => ({
        pages: INITIAL_PAGES,
        focusedPageId: defaultPageId,
        currentPageId: defaultPageId,
        canvasNodes: [],
        pageNodes: clone(defaultNodes),
        history: [makeSnapshot(INITIAL_PAGES, defaultPageId, clone(defaultNodes), [])],
        historyIdx: 0,
      }));
    }

    try {
      const json = getBuilderConfig() as unknown as {
        dataSources?: DataSourceConfig[];
        dsFolders?: Folder[];
        variables?: Array<{ id: string; label?: string; type?: string; initialValue?: unknown; folder?: string; fields?: CustomVar['fields'] }>;
        varFolders?: Array<{ id: string; label: string }>;
        workflows?: Array<{ id: string; name: string; trigger: string; steps: object[]; onErrorSteps?: object[] }>;
        directActions?: Record<string, Record<string, unknown>>;
        dsActionsMap?: Record<string, string>;
        formulas?: Record<string, import('./_store-types').GlobalFormulaDef>;
        sharedComponents?: Record<string, unknown>;
        customColors?: CustomColor[];
        colorFolders?: Folder[];
      };

      set(s => {
        const next: Partial<typeof s> = {};

        // ── Data sources ──────────────────────────────────────────────────────
        if (Array.isArray(json.dataSources) && json.dataSources.length > 0) {
          const savedFetches = restoreDsLastFetches();
          const withFetches = json.dataSources.map(d =>
            savedFetches[d.id] ? { ...d, _lastFetch: savedFetches[d.id] } : d
          );
          const configIds = new Set(withFetches.map(d => d.id));
          const userAdded = s.pageDataSources.filter(d => !configIds.has(d.id) && !(d as { _fromConfig?: boolean })._fromConfig);
          const userAddedWithFetches = userAdded.map(d =>
            savedFetches[d.id] ? { ...d, _lastFetch: savedFetches[d.id] } : d
          );
          const configFolderIds = new Set((json.dsFolders ?? []).map(f => f.id));
          const userDsFolders = s.dsFolders.filter(f => !configFolderIds.has(f.id));
          next.pageDataSources = [...withFetches, ...userAddedWithFetches];
          next.dsFolders = [...(json.dsFolders ?? []), ...userDsFolders];
        }

        // ── Datasource-actions reverse map (actionUUID → datasourceUUID, for backward compat display) ──
        if (json.dsActionsMap && typeof json.dsActionsMap === 'object') {
          next.dsActionsMap = json.dsActionsMap as Record<string, string>;
        }

        // ── Variables from config/variables.json ──────────────────────────────
        if (Array.isArray(json.variables) && json.variables.length > 0) {
          const configVarIds = new Set(json.variables.map(v => v.id));
          // Keep user-added vars that are NOT from config
          const userVars = s.customVars.filter(v => !v.id || !configVarIds.has(v.id));
          const configVars: CustomVar[] = json.variables.map(v => ({
            id: v.id,
            name: v.id,                  // UUID as the name (for backward compat)
            label: v.label ?? v.id,
            type: (v.type ?? 'string') as CustomVar['type'],
            initialValue: v.initialValue,
            folderId: v.folder,
            fields: v.fields,
          }));
          next.customVars = [...configVars, ...userVars];
        }

        // ── Variable folders ──────────────────────────────────────────────────
        if (Array.isArray(json.varFolders) && json.varFolders.length > 0) {
          const configFolderIds = new Set(json.varFolders.map(f => f.id));
          const userVarFolders = s.varFolders.filter(f => !configFolderIds.has(f.id));
          next.varFolders = [
            ...json.varFolders.map(f => ({ id: f.id, name: f.label, parentId: undefined })),
            ...userVarFolders,
          ];
        }

        // ── Named workflows from config/actions/*.json ────────────────────────
        if (Array.isArray(json.workflows) && json.workflows.length > 0) {
          const configWorkflowIds = new Set(json.workflows.map(w => w.id));
          // Keep user-added workflows that aren't from config
          const userWorkflows = Object.fromEntries(
            Object.entries(s.pageWorkflows).filter(([id]) => !configWorkflowIds.has(id))
          );
          const userMeta = Object.fromEntries(
            Object.entries(s.pageWorkflowMeta).filter(([id]) => !configWorkflowIds.has(id))
          );
          // A workflow is "system" if it's a single-step onChange setter (e.g. changeVariableValue)
          // BUT only when it has no explicit name (name equals id = auto-generated).
          const SYSTEM_STEP_TYPES = new Set(['changeVariableValue', 'setState', 'set']);
          const isSystemWorkflow = (w: { id?: string; name?: string; trigger?: string; steps?: unknown[] }) =>
            w.trigger === 'change' &&
            Array.isArray(w.steps) && w.steps.length === 1 &&
            SYSTEM_STEP_TYPES.has((w.steps[0] as Record<string, unknown>)?.type as string) &&
            (!w.name || w.name === w.id);

          // Key by UUID id, display name comes from the "name" field in the definition.
          // Convert raw camelCase/kebab names to human-readable text for the builder UI.
          const toHumanName = (n: string) =>
            n.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').replace(/\s+/g, ' ')
             .replace(/^./, s => s.toUpperCase()).trim();

          // Detect UUID-shaped strings (fall-through when no name is set)
          const isUuidStr = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

          // Workflows with `params` are global workflows (Logic tab); others are page workflows
          type RawWorkflow = { id: string; name?: string; trigger?: string; steps: unknown[]; onErrorSteps?: unknown[]; isTrigger?: boolean; pageScope?: string; params?: import('./_store-types').WorkflowParam[] };
          const globalConfigWorkflows = (json.workflows as RawWorkflow[]).filter(w => Array.isArray(w.params) && w.params.length > 0);
          const pageConfigWorkflows = (json.workflows as RawWorkflow[]).filter(w => !Array.isArray(w.params) || w.params.length === 0);

          // Page workflows
          const configPageWorkflows = Object.fromEntries(pageConfigWorkflows.map(w => [w.id, w.steps]));
          const configPageMeta = Object.fromEntries(pageConfigWorkflows.map(w => [w.id, {
            id: w.id,
            name: w.name && !isUuidStr(w.name) ? toHumanName(w.name) : 'Unnamed Workflow',
            trigger: w.trigger,
            isSystem: isSystemWorkflow(w),
            ...(w.isTrigger ? { isTrigger: true } : {}),
            ...(w.pageScope ? { pageScope: w.pageScope } : {}),
          } as WorkflowMeta]));
          next.pageWorkflows = { ...configPageWorkflows, ...userWorkflows } as typeof s.pageWorkflows;
          next.pageWorkflowMeta = { ...configPageMeta, ...userMeta };

          // Global workflows — seeded from config (params-bearing workflows)
          if (globalConfigWorkflows.length > 0) {
            const globalConfigIds = new Set(globalConfigWorkflows.map(w => w.id));
            // Keep user-created global workflows that aren't from config
            const userGlobalWorkflows = Object.fromEntries(
              Object.entries(s.globalWorkflows).filter(([id]) => !globalConfigIds.has(id))
            );
            const userGlobalMeta = Object.fromEntries(
              Object.entries(s.globalWorkflowMeta).filter(([id]) => !globalConfigIds.has(id))
            );
            const configGlobalWorkflows = Object.fromEntries(globalConfigWorkflows.map(w => [w.id, w.steps]));
            const configGlobalMeta = Object.fromEntries(globalConfigWorkflows.map(w => [w.id, {
              id: w.id,
              name: w.name && !isUuidStr(w.name) ? toHumanName(w.name) : 'Unnamed Workflow',
              trigger: w.trigger ?? 'execution',
              params: w.params,
            } as WorkflowMeta]));
            next.globalWorkflows = { ...configGlobalWorkflows, ...userGlobalWorkflows } as typeof s.globalWorkflows;
            next.globalWorkflowMeta = { ...configGlobalMeta, ...userGlobalMeta };
          }
        }

        // ── Direct actions from config/actions/*.json ─────────────────────────
        if (json.directActions && typeof json.directActions === 'object') {
          next.directActionsMap = json.directActions as Record<string, Record<string, unknown>>;
        }

        // ── Global formulas from config/formulas.json ─────────────────────────
        if (json.formulas && typeof json.formulas === 'object') {
          const configIds = new Set(Object.keys(json.formulas));
          const userFormulas = Object.fromEntries(
            Object.entries(s.globalFormulas).filter(([id]) => !configIds.has(id))
          );
          next.globalFormulas = { ...json.formulas, ...userFormulas };
        }

        // ── Shared components persisted with the project ──────────────────────
        if (json.sharedComponents && typeof json.sharedComponents === 'object') {
          loadSharedComponents(json.sharedComponents as Record<string, unknown>);
        }

        return next;
      });

      // ── Custom colors from config/custom-colors.json ──────────────────────────
      // Seed the store with config-defined colors. User-added colors (in-memory
      // only in admin mode) take precedence so they're never overwritten.
      if (Array.isArray(json.customColors) && json.customColors.length > 0) {
        const configColorIds = new Set(json.customColors.map(c => c.id));
        const configColorNames = new Set(json.customColors.map(c => c.name));
        set(s => {
          const userColors = s.customColors.filter(c => !configColorIds.has(c.id) && !configColorNames.has(c.name));
          const merged = [...json.customColors!, ...userColors];
          const { themeOverrides, themeDarkOverrides } = s;
          _applyLightOverrides(themeOverrides, merged);
          _applyDarkOverrides(themeDarkOverrides, merged);
          const userFolders = Array.isArray(json.colorFolders)
            ? s.colorFolders.filter(f => !json.colorFolders!.some(cf => cf.id === f.id))
            : s.colorFolders;
          return {
            customColors: merged,
            colorFolders: [...(json.colorFolders ?? []), ...userFolders],
          };
        });
      }

      // Seed the formula evaluator registry + editor tokenizer with config formulas
      try {
        const formulas = useBuilderStore.getState().globalFormulas;
        registerGlobalFormulas(formulas as Record<string, unknown>);
        // Sync user formula names to chip tokenizer (best-effort, editor DOM only)
        import('./_formula-editor-dom').then(({ setUserFormulaNames }) => {
          setUserFormulaNames(Object.values(formulas).map((d: unknown) => (d as { name?: string })?.name ?? '').filter(Boolean));
        }).catch(() => { /* non-fatal */ });
      } catch { /* non-fatal */ }
    } catch {
      // Silently ignore — builder still works without pre-populated sources.
    }
  },

  setShowInteractionLines: (on) => set({ showInteractionLines: on }),

  openLogicSection: (section) => set({ activeLogicSection: section }),

  applyThemePreset: (light, dark, fonts) => {
    const fullLight = {
      ...light,
      ...(fonts?.heading ? { 'font-heading': fonts.heading } : {}),
      ...(fonts?.body    ? { 'font-body':    fonts.body    } : {}),
    };
    const { customColors } = get();
    _applyLightOverrides(fullLight, customColors);
    _applyDarkOverrides(dark, customColors);
    injectFontsFromOverrides(fullLight);
    set({ themeOverrides: fullLight, themeDarkOverrides: dark });
  },

  renamePage: (pageId, name) => {
    set(s => ({
      pages: s.pages.map(p => p.id === pageId ? { ...p, name } : p),
    }));
  },

  removePage: (pageId) => {
    set(s => {
      const remaining = (s.pages as BuilderPage[]).filter(p => p.id !== pageId);
      if (remaining.length === 0) {
        return {
          pages: [],
          focusedPageId: '',
          canvasNodes: [],
          pageNodes: [],
          selectedIds: [],
          hoveredId: null,
          history: [EMPTY_SNAPSHOT],
          historyIdx: 0,
        };
      }
      if (s.focusedPageId !== pageId) {
        return { pages: remaining };
      }
      // Removed the focused page — focus the previous (or first remaining)
      const removedIdx = (s.pages as BuilderPage[]).findIndex(p => p.id === pageId);
      const fallback = remaining[Math.max(0, removedIdx - 1)];
      // Middleware auto-derives pageNodes from new focusedPageId
      return {
        pages: remaining,
        focusedPageId: fallback.id,
        selectedIds: [],
        hoveredId: null,
      };
    });
    get()._pushHistory();
  },
});
});

// Keep the JS evaluator's name → UUID registries in sync with the builder store
// so JavaScript bindings can address `variables.cartCount` / `collections.products`
// by name. Subscribes at module load and refreshes whenever customVars or
// pageDataSources change.
{
  const syncNameRegistries = (s: { customVars: CustomVar[]; pageDataSources: DataSourceConfig[] }) => {
    const varMap: Record<string, string> = {};
    for (const v of s.customVars) {
      const id = v.id ?? v.name;
      if (!id) continue;
      // Register both label and name when distinct so JS code can reference
      // either `variables.cartCount` (raw name) or `variables['Cart Count']` (label).
      const label = (v.label ?? v.name ?? id) as string;
      const rawName = (v.name ?? id) as string;
      if (label) varMap[label] = id;
      if (rawName && rawName !== label) varMap[rawName] = id;
    }
    registerVariableNames(varMap);
    const colMap: Record<string, string> = {};
    for (const d of s.pageDataSources) {
      if (d.id && d.name) colMap[d.name] = d.id;
    }
    registerCollectionNames(colMap);
  };
  // Initial seed (covers static-config builds where loadFromConfig is not called)
  syncNameRegistries(useBuilderStore.getState());
  let prevVars = useBuilderStore.getState().customVars;
  let prevDs = useBuilderStore.getState().pageDataSources;
  useBuilderStore.subscribe(() => {
    const s = useBuilderStore.getState();
    if (s.customVars !== prevVars || s.pageDataSources !== prevDs) {
      prevVars = s.customVars;
      prevDs = s.pageDataSources;
      syncNameRegistries(s);
    }
  });
}

// Expose store for E2E tests as early as possible (module-level, not useEffect)
// so it's available as soon as the JS bundle loads — before React hydration.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>).__builderStore = useBuilderStore;
  // Also expose the SDUI data store for E2E tests that verify page binding updates
  import('@/store/sdui-store').then(m => {
    (window as unknown as Record<string, unknown>).__sduiStore = m.useSduiStore;
  });
  // Expose the global variable store for E2E tests that verify form state updates
  // (e.g. FormContainer + controlled components like Checkbox, Switch, TextareaInput)
  import('@/lib/sdui/global-variable-store').then(m => {
    (window as unknown as Record<string, unknown>).__globalVariableStore = m.getGlobalVariableStore();
  });
}
