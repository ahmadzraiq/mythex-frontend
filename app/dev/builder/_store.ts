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
import { showcaseNodes } from './_showcase';
import root from '@/config/root';
import { resolveScreenConfig, type ConfigRegistry } from '@/lib/sdui/config-resolver';
import { updatePopup, getPopups } from '@/lib/builder/popup-data';
import { updateSharedComponent, getSharedComponents } from '@/lib/builder/shared-component-data';
import { getBuilderConfig } from '@/lib/builder/config-data';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';

// ─── Node-tree helpers (extracted to _store-node-helpers.ts) ────────────────
// Single import for internal use; explicit re-exports for external consumers.
import {
  REQUIRED_PARENT, ALLOWED_CHILDREN,
  findNode, findParentNode, patchNodeById, insertNode,
  hasFormContainerAncestor,
  clone, removeNodesByIds,
  _applyLightOverrides, _applyDarkOverrides, hexToRgbTriplet, _getManagedStyle,
  GLUESTACK_PRIMARY_BRIDGE, injectFontsFromOverrides,
} from './_store-node-helpers';

export {
  REQUIRED_PARENT, ALLOWED_CHILDREN,
  findNode, findParentNode, patchNodeById, insertNode,
  hasFormContainerAncestor,
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

function _flushHistoryIfPending(set: SetFn): void {
  if (_historyTimer) {
    cancelAnimationFrame(_historyTimer);
    _historyTimer = 0;
    _flushHistory(set);
  }
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
  return { pages: pagesSnap, canvasNodes: [...canvasNodes] };
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
  Folder, CustomVar, DataSourceConfig,
  PageMeta, BuilderPage, HistorySnapshot, CanvasNode,
  WorkflowMeta, WorkflowCanvasTarget,
  BuilderStore,
  AiChatMessage, AiChatRole, AiToolCall,
} from './_store-types';
export { VIEWPORT_WIDTHS } from './_store-types';

// Local alias used by the implementation below (avoids re-importing each name)
import type {
  GridOverlayConfig, ViewportSize, DataSourceConfig, CustomVar,
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

// Component Showcase — builder-internal canvas only, not an app route.
const SHOWCASE_PAGE: BuilderPage = {
  id: 'page-showcase',
  name: '✦ Component Showcase',
  nodes: showcaseNodes,
  wx: 0,
  wy: 0,
};

// Fragment-only registry: resolves $ref nodes from fragments without injecting
// the full layout shell (navbar/footer). Pages in the builder show only the
// page content area — shared layout chrome is not part of the editable tree.
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
  .routes.map((r, i) => ({
    id: `page-${r.config}`,
    name: r.config,
    route: r.path,
    nodes: _extractPageNodes(r.config),
    wx: (i + 1) * (1280 + 80),  // +1 because SHOWCASE_PAGE is at 0
    wy: 0,
  }));

const INITIAL_PAGES: BuilderPage[] = [SHOWCASE_PAGE, ...ROUTE_PAGES];

/**
 * Strips popup root nodes from pageNodes, persists each popup's live content to
 * the in-memory popup store (stripping builder-injected styles), and returns
 * the cleaned node array plus the list of popup model IDs that were flushed.
 * Used by focusPage when exiting popup edit mode so page content is never polluted with
 * popup nodes after an in-progress popup edit.
 */
function _flushEditingPopups(s: ReturnType<typeof useBuilderStore.getState>) {
  const BUILDER_KEYS = new Set(['position', 'top', 'left', 'right', 'zIndex']);
  let cleanNodes = s.pageNodes as SDUINode[];
  const popupIdsToClose: string[] = [];

  for (const popupId of s.editingPopupIds) {
    const content = s.editingPopupContentsMap[popupId];
    // Always use the live model so renames made while the popup was open are kept.
    const model   = getPopups()[popupId] ?? s.editingPopupModelsMap[popupId];
    if (!content || !model) { popupIdsToClose.push(popupId); continue; }

    const rootId = (content as unknown as { id?: string }).id;
    const liveNode = rootId
      ? (cleanNodes as SDUINode[]).find(n => (n as unknown as { id?: string }).id === rootId)
      : undefined;

    if (liveNode) {
      const rawStyle = ((liveNode.props as Record<string, unknown>)?.style ?? {}) as Record<string, unknown>;
      const cleanStyle = Object.fromEntries(Object.entries(rawStyle).filter(([k]) => !BUILDER_KEYS.has(k)));
      const originalStyle = (content.props as Record<string, unknown> | undefined)?.style as Record<string, unknown> | undefined;
      if (!originalStyle?.['height']) delete cleanStyle['height'];
      const savedNode = {
        ...liveNode,
        props: { ...(liveNode.props ?? {}), style: Object.keys(cleanStyle).length > 0 ? cleanStyle : undefined },
      };
      updatePopup({ id: popupId, ...(model as { id: string }), content: savedNode as Record<string, unknown> });
      cleanNodes = cleanNodes.filter(n => (n as unknown as { id?: string }).id !== rootId) as SDUINode[];
    }
    popupIdsToClose.push(popupId);
  }

  return { cleanNodes, popupIdsToClose };
}

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
  editingPopupIds: [],
  editingPopupId: null,
  editingPopupContentsMap: {},
  editingPopupModelsMap: {},
  editingPopupContent: null,
  editingPopupModel: null,
  _savedPageNodes: null,
  editingSharedComponentIds: [],
  editingSharedComponentId: null,
  editingSharedComponentContentsMap: {},
  editingSharedComponentModelsMap: {},
  editingSharedComponentContent: null,
  editingSharedComponentModel: null,
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
  customVars: [],
  pageDataSources: [],
  dsActionsMap: {} as Record<string, string>,
  engineConventions: {},
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
    set(s => {
      const pageNodes = insertNode(s.pageNodes, node, parentId ?? null, atIdx);
      const insertedId = node.id;
      return {
        pageNodes,
        selectedIds: insertedId ? [insertedId] : s.selectedIds,
      };
    });
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
    set(s => {
      const node = findNode(s.pageNodes, nodeId);
      if (!node) return s;

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
    get()._pushHistory();
  },

  moveNodes: (nodeIds, newParentId, atIdx) => {
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
    get()._pushHistory();
  },

  moveNodeFromPage: (nodeId, fromPageId, parentId, atIdx) => {
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
    get()._pushHistory();
  },

  deleteNodes: (ids) => {
    // Protect ALL popup root nodes from being deleted while any popup is being edited.
    const { editingPopupContentsMap } = get();
    const popupRootIds = new Set(
      Object.values(editingPopupContentsMap).map(c => (c as unknown as { id?: string }).id).filter(Boolean)
    );
    const idSet = new Set(ids.filter(id => !popupRootIds.has(id)));
    if (idSet.size === 0) return;
    set(s => ({
      pageNodes: removeNodesByIds(s.pageNodes, idSet),
      canvasNodes: (s.canvasNodes as CanvasNode[]).filter(n => !idSet.has(n.id)),
      selectedIds: s.selectedIds.filter(id => !idSet.has(id)),
      aiSelectedNodeIds: s.aiSelectedNodeIds.filter(id => !idSet.has(id)),
    }));
    get()._pushHistory();
  },

  duplicateNodes: (ids) => {
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
    get()._pushHistory();
  },

  patchProp: (id, propPath, value) => {
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
  },

  patchClassName: (id, oldToken, newToken) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => {
      const cls: string = (node.props as { className?: string })?.className ?? '';
      const newCls = oldToken
        ? cls.replace(new RegExp(`\\b${oldToken.replace('*', '[^\\s]+')}\\b`, 'g'), newToken).trim()
        : `${cls} ${newToken}`.trim();
      return { ...node, props: { ...(node.props as object), className: newCls } };
    }));
  },

  renameNode: (id, newId) => {
    set(s => ({
      ...patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => ({ ...node, id: newId })),
      selectedIds: s.selectedIds.map(sid => (sid === id ? newId : sid)),
    }));
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

    // Auto-exit popup edit mode if active (save + flush)
    if (s.editingPopupIds.length > 0) {
      const { cleanNodes } = _flushEditingPopups(s);
      const pages = (s.pages as BuilderPage[]).map(p =>
        p.id === s.focusedPageId ? { ...p, nodes: cleanNodes as SDUINode[] } : p
      );
      set({
        pages: pages as BuilderPage[],
        focusedPageId: pageId,
        selectedIds: [],
        hoveredId: null,
        editingPopupIds: [],
        editingPopupId: null,
        editingPopupContentsMap: {},
        editingPopupModelsMap: {},
        editingPopupContent: null,
        editingPopupModel: null,
        _savedPageNodes: null,
      });
      return;
    }

    // Auto-exit shared component edit if active
    if (s.editingSharedComponentId) {
      get().exitSharedComponentEdit();
    }

    // Lightweight focus change — middleware auto-derives pageNodes
    set({ focusedPageId: pageId, selectedIds: [], hoveredId: null });
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

  enterPopupEdit: (modelId, content, model) =>
    set(s => {
      // Inject builder-specific absolute positioning and explicit height DIRECTLY
      // onto the popup root (backdrop) node. Using inline `style` means React's
      // specificity rules make it win over the Tailwind `h-full` class, so the
      // backdrop is definitively 900px (= VIEWPORT_H) in the builder canvas.
      // The page nodes remain in pageNodes so the page stays visible behind the popup,
      // and ALL builder ops (add/delete/move/resize) work because everything is in the
      // same pageNodes tree.
      // Multiple popups can be open simultaneously — each is just appended to pageNodes.
      const contentNode = clone(content as unknown as SDUINode);
      const existingStyle = ((contentNode.props as Record<string, unknown>)?.style ?? {}) as Record<string, unknown>;
      const builderContent: SDUINode = {
        ...contentNode,
        props: {
          ...(contentNode.props ?? {}),
          style: {
            ...existingStyle,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 900,
            zIndex: 50 + s.editingPopupIds.length, // stack above existing open popups
          },
        },
      };

      const nextNodes = [...clone(s.pageNodes), builderContent] as SDUINode[];

      // Save the original page nodes only on the FIRST popup being opened for editing.
      // Subsequent calls must NOT overwrite this snapshot — otherwise closing the
      // second popup would restore to "page + popup1's content" instead of the real page.
      const savedPageNodes = s._savedPageNodes ?? clone(s.pageNodes);

      return {
        _savedPageNodes: savedPageNodes,
        pageNodes: nextNodes,
        editingPopupIds: [...s.editingPopupIds, modelId],
        editingPopupId: modelId,                          // most-recently-opened
        editingPopupContentsMap: { ...s.editingPopupContentsMap, [modelId]: content },
        editingPopupModelsMap: { ...s.editingPopupModelsMap, [modelId]: model },
        editingPopupContent: content,
        editingPopupModel: model,
        selectedIds: [],
        history: [makeSnapshot(s.pages as BuilderPage[], s.focusedPageId, nextNodes, s.canvasNodes)],
        historyIdx: 0,
      };
    }),

  saveEditingPopup: (modelId) => {
    const { editingPopupContentsMap, editingPopupModelsMap, pageNodes } = get();
    const targetContent = editingPopupContentsMap[modelId];
    // Prefer the live in-memory model (may have been renamed/updated since edit started)
    const targetModel   = getPopups()[modelId] ?? editingPopupModelsMap[modelId];
    if (!targetContent || !targetModel) return;

    const popupRootId = (targetContent as unknown as { id?: string }).id;
    const liveNode = popupRootId
      ? (pageNodes as SDUINode[]).find(n => (n as unknown as { id?: string }).id === popupRootId)
      : undefined;
    if (!liveNode) return;

    // Strip builder-injected positioning/height before saving.
    const rawStyle = ((liveNode.props as Record<string, unknown>)?.style ?? {}) as Record<string, unknown>;
    const BUILDER_KEYS = new Set(['position', 'top', 'left', 'right', 'zIndex']);
    const cleanStyle = Object.fromEntries(Object.entries(rawStyle).filter(([k]) => !BUILDER_KEYS.has(k)));
    const originalStyle = (targetContent.props as Record<string, unknown> | undefined)?.style as Record<string, unknown> | undefined;
    if (!originalStyle?.['height']) delete cleanStyle['height'];

    const savedNode = {
      ...liveNode,
      props: {
        ...(liveNode.props ?? {}),
        style: Object.keys(cleanStyle).length > 0 ? cleanStyle : undefined,
      },
    };

    updatePopup({ ...(targetModel as { id: string }), content: savedNode as Record<string, unknown> });
  },

  exitPopupEdit: (modelId?) => {
    const {
      editingPopupId: lastId,
      editingPopupIds,
      editingPopupContentsMap,
      editingPopupModelsMap,
      pageNodes,
      _savedPageNodes,
    } = get();

    // Resolve which popup to close — default to the most-recently-opened one.
    const targetId = modelId ?? lastId;
    if (!targetId) return;

    const targetContent = editingPopupContentsMap[targetId];
    // Always use the freshest model from the in-memory store so that renames
    // (or any other metadata changes made while the popup was open) are preserved.
    const targetModel   = getPopups()[targetId] ?? editingPopupModelsMap[targetId];

    if (targetContent) {
      // Find the live (possibly edited) popup node by the original root ID.
      const popupRootId = (targetContent as unknown as { id?: string }).id;
      const liveNode = popupRootId
        ? (pageNodes as SDUINode[]).find(n => (n as unknown as { id?: string }).id === popupRootId)
        : undefined;

      if (liveNode) {
        // Strip the builder-injected positioning/height keys before saving.
        // We only added these so the backdrop has a definite 900px in the canvas;
        // the popup should use its own h-full / PopupRenderer positioning in production.
        const rawStyle = ((liveNode.props as Record<string, unknown>)?.style ?? {}) as Record<string, unknown>;
        const BUILDER_KEYS = new Set(['position', 'top', 'left', 'right', 'zIndex']);
        const cleanStyle = Object.fromEntries(Object.entries(rawStyle).filter(([k]) => !BUILDER_KEYS.has(k)));

        // Also remove `height` unless the original content already had an explicit height.
        const originalStyle = (targetContent.props as Record<string, unknown> | undefined)?.style as Record<string, unknown> | undefined;
        if (!originalStyle?.['height']) delete cleanStyle['height'];

        const savedNode = {
          ...liveNode,
          props: {
            ...(liveNode.props ?? {}),
            style: Object.keys(cleanStyle).length > 0 ? cleanStyle : undefined,
          },
        };

        const updatedModel = { ...(targetModel ?? {}), content: savedNode };
        updatePopup({ id: targetId, ...(updatedModel as Record<string, unknown>), content: savedNode as Record<string, unknown> });

        // Remove just this popup's root node from pageNodes — leave the rest intact.
        const newPageNodes = (pageNodes as SDUINode[]).filter(
          n => (n as unknown as { id?: string }).id !== popupRootId
        ) as SDUINode[];

        const newEditingIds  = editingPopupIds.filter(id => id !== targetId);
        const newContentsMap = Object.fromEntries(Object.entries(editingPopupContentsMap).filter(([k]) => k !== targetId));
        const newModelsMap   = Object.fromEntries(Object.entries(editingPopupModelsMap).filter(([k]) => k !== targetId));
        const newLastId      = newEditingIds[newEditingIds.length - 1] ?? null;
        const allClosed      = newEditingIds.length === 0;

        const s2 = get();
        set({
          pageNodes: newPageNodes,
          _savedPageNodes: allClosed ? null : _savedPageNodes,
          editingPopupIds: newEditingIds,
          editingPopupId: newLastId,
          editingPopupContentsMap: newContentsMap,
          editingPopupModelsMap: newModelsMap,
          editingPopupContent: newLastId ? newContentsMap[newLastId] ?? null : null,
          editingPopupModel: newLastId ? newModelsMap[newLastId] ?? null : null,
          selectedIds: [],
          history: [makeSnapshot(s2.pages as BuilderPage[], s2.focusedPageId, newPageNodes, s2.canvasNodes)],
          historyIdx: 0,
        });
        return;
      }
    }

    // Fallback: popup root not in current pageNodes (user switched pages while editing).
    // Clean up tracking state only — do NOT touch pageNodes so the current page is preserved.
    const newEditingIds  = editingPopupIds.filter(id => id !== targetId);
    const newContentsMap = Object.fromEntries(Object.entries(editingPopupContentsMap).filter(([k]) => k !== targetId));
    const newModelsMap   = Object.fromEntries(Object.entries(editingPopupModelsMap).filter(([k]) => k !== targetId));
    const newLastId      = newEditingIds[newEditingIds.length - 1] ?? null;
    const s3 = get();

    set({
      pageNodes: pageNodes as SDUINode[],   // keep current page untouched
      _savedPageNodes: newEditingIds.length === 0 ? null : _savedPageNodes,
      editingPopupIds: newEditingIds,
      editingPopupId: newLastId,
      editingPopupContentsMap: newContentsMap,
      editingPopupModelsMap: newModelsMap,
      editingPopupContent: newLastId ? newContentsMap[newLastId] ?? null : null,
      editingPopupModel: newLastId ? newModelsMap[newLastId] ?? null : null,
      selectedIds: [],
      history: [makeSnapshot(s3.pages as BuilderPage[], s3.focusedPageId, pageNodes as SDUINode[], s3.canvasNodes)],
      historyIdx: 0,
    });
  },

  // ── Shared Component edit mode ───────────────────────────────────────────────

  enterSharedComponentEdit: (modelId, content, model) => set(s => {
    const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    if (s.editingSharedComponentIds.includes(modelId)) return s;

    const contentNode = clone(content) as SDUINode;

    // Apply positioning so the component is visible in the canvas
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
          zIndex: 50 + s.editingSharedComponentIds.length,
        },
      },
    } as SDUINode;

    const nextNodes = [...clone(s.pageNodes), builderContent] as SDUINode[];
    const savedPageNodes = s._savedPageNodes ?? clone(s.pageNodes);

    return {
      _savedPageNodes: savedPageNodes,
      pageNodes: nextNodes,
      editingSharedComponentIds: [...s.editingSharedComponentIds, modelId],
      editingSharedComponentId: modelId,
      editingSharedComponentContentsMap: { ...s.editingSharedComponentContentsMap, [modelId]: content },
      editingSharedComponentModelsMap: { ...s.editingSharedComponentModelsMap, [modelId]: model as Record<string, unknown> },
      editingSharedComponentContent: content,
      editingSharedComponentModel: model as Record<string, unknown>,
      selectedIds: [],
      history: [makeSnapshot(s.pages as BuilderPage[], s.focusedPageId, nextNodes, s.canvasNodes)],
      historyIdx: 0,
    };
  }),

  saveEditingSharedComponent: (modelId) => {
    const { editingSharedComponentContentsMap, editingSharedComponentModelsMap, pageNodes } = get();
    const targetContent = editingSharedComponentContentsMap[modelId];
    const targetModel   = getSharedComponents()[modelId] ?? editingSharedComponentModelsMap[modelId];
    if (!targetContent || !targetModel) return;

    const contentRootId = (targetContent as unknown as { id?: string }).id;
    const liveNode = contentRootId
      ? (pageNodes as SDUINode[]).find(n => (n as unknown as { id?: string }).id === contentRootId)
      : undefined;

    if (liveNode) {
      const BUILDER_KEYS = new Set(['position', 'top', 'left', 'right', 'zIndex']);
      const rawStyle = ((liveNode.props as Record<string, unknown>)?.style ?? {}) as Record<string, unknown>;
      const cleanStyle = Object.fromEntries(Object.entries(rawStyle).filter(([k]) => !BUILDER_KEYS.has(k)));
      const originalStyle = (targetContent.props as Record<string, unknown> | undefined)?.style as Record<string, unknown> | undefined;
      if (!originalStyle?.['height']) delete cleanStyle['height'];

      const savedNode = {
        ...liveNode,
        props: { ...(liveNode.props ?? {}), style: Object.keys(cleanStyle).length > 0 ? cleanStyle : undefined },
      };
      updateSharedComponent({ ...(targetModel as { id: string }), content: savedNode as Record<string, unknown> });
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
    } = get();

    const targetId = modelId ?? lastId;
    if (!targetId) return;

    const targetContent = editingSharedComponentContentsMap[targetId];
    const targetModel   = getSharedComponents()[targetId] ?? editingSharedComponentModelsMap[targetId];

    if (targetContent) {
      const contentRootId = (targetContent as unknown as { id?: string }).id;
      const liveNode = contentRootId
        ? (pageNodes as SDUINode[]).find(n => (n as unknown as { id?: string }).id === contentRootId)
        : undefined;

      if (liveNode) {
        const BUILDER_KEYS = new Set(['position', 'top', 'left', 'right', 'zIndex']);
        const rawStyle = ((liveNode.props as Record<string, unknown>)?.style ?? {}) as Record<string, unknown>;
        const cleanStyle = Object.fromEntries(Object.entries(rawStyle).filter(([k]) => !BUILDER_KEYS.has(k)));
        const originalStyle = (targetContent.props as Record<string, unknown> | undefined)?.style as Record<string, unknown> | undefined;
        if (!originalStyle?.['height']) delete cleanStyle['height'];

        const savedNode = {
          ...liveNode,
          props: { ...(liveNode.props ?? {}), style: Object.keys(cleanStyle).length > 0 ? cleanStyle : undefined },
        };
        updateSharedComponent({ id: targetId, ...(targetModel as Record<string, unknown>), content: savedNode as Record<string, unknown> });

        const newPageNodes = (pageNodes as SDUINode[]).filter(
          n => (n as unknown as { id?: string }).id !== contentRootId
        ) as SDUINode[];
        const newEditingIds  = editingSharedComponentIds.filter(id => id !== targetId);
        const newContentsMap = Object.fromEntries(Object.entries(editingSharedComponentContentsMap).filter(([k]) => k !== targetId));
        const newModelsMap   = Object.fromEntries(Object.entries(editingSharedComponentModelsMap).filter(([k]) => k !== targetId));
        const newLastId      = newEditingIds[newEditingIds.length - 1] ?? null;
        const allClosed      = newEditingIds.length === 0;

        const sc2 = get();
        set({
          pageNodes: newPageNodes,
          _savedPageNodes: allClosed ? null : _savedPageNodes,
          editingSharedComponentIds: newEditingIds,
          editingSharedComponentId: newLastId,
          editingSharedComponentContentsMap: newContentsMap,
          editingSharedComponentModelsMap: newModelsMap,
          editingSharedComponentContent: newLastId ? newContentsMap[newLastId] ?? null : null,
          editingSharedComponentModel: newLastId ? newModelsMap[newLastId] ?? null : null,
          selectedIds: [],
          history: [makeSnapshot(sc2.pages as BuilderPage[], sc2.focusedPageId, newPageNodes, sc2.canvasNodes)],
          historyIdx: 0,
        });
        return;
      }
    }

    // Fallback: content root not in current pageNodes
    const newEditingIds  = editingSharedComponentIds.filter(id => id !== targetId);
    const newContentsMap = Object.fromEntries(Object.entries(editingSharedComponentContentsMap).filter(([k]) => k !== targetId));
    const newModelsMap   = Object.fromEntries(Object.entries(editingSharedComponentModelsMap).filter(([k]) => k !== targetId));
    const newLastId      = newEditingIds[newEditingIds.length - 1] ?? null;
    const sc3 = get();

    set({
      pageNodes: pageNodes as SDUINode[],
      _savedPageNodes: newEditingIds.length === 0 ? null : _savedPageNodes,
      editingSharedComponentIds: newEditingIds,
      editingSharedComponentId: newLastId,
      editingSharedComponentContentsMap: newContentsMap,
      editingSharedComponentModelsMap: newModelsMap,
      editingSharedComponentContent: newLastId ? newContentsMap[newLastId] ?? null : null,
      editingSharedComponentModel: newLastId ? newModelsMap[newLastId] ?? null : null,
      selectedIds: [],
      history: [makeSnapshot(sc3.pages as BuilderPage[], sc3.focusedPageId, pageNodes as SDUINode[], sc3.canvasNodes)],
      historyIdx: 0,
    });
  },

  // ── Theme overrides ──────────────────────────────────────────────────────────

  initTheme: () => {
    // Install bridge style tags immediately so Gluestack components respect
    // the active --primary even before the user picks a preset.
    const { themeOverrides, themeDarkOverrides } = get();
    _applyLightOverrides(themeOverrides);
    _applyDarkOverrides(themeDarkOverrides);
  },

  patchTheme: (cssVar, value, mode = 'light') => {
    if (mode === 'light') {
      // Read current state first, then apply DOM change, then commit to store
      const next = { ...get().themeOverrides, [cssVar]: value };
      _applyLightOverrides(next);
      set({ themeOverrides: next });
    } else {
      const next = { ...get().themeDarkOverrides, [cssVar]: value };
      _applyDarkOverrides(next);
      set({ themeDarkOverrides: next });
    }
  },

  resetTheme: () => {
    _applyLightOverrides({});
    _applyDarkOverrides({});
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
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => ({ ...node, [field]: value }) as SDUINode));
    get()._pushHistory();
  },

  patchNodeFieldLive: (id, field, value) => {
    set(s => patchAnyNode(s as { pageNodes: SDUINode[]; canvasNodes: CanvasNode[] }, id, node => ({ ...node, [field]: value }) as SDUINode));
    // Intentionally no _pushHistory — caller must call _pushHistory() once on commit.
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
  setGlobalFormula: (name, expr) =>
    set(s => ({ globalFormulas: { ...s.globalFormulas, [name]: expr } })),
  removeGlobalFormula: (name) =>
    set(s => { const { [name]: _, ...rest } = s.globalFormulas; return { globalFormulas: rest }; }),

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

  addCustomVar: (v) => {
    const id = v.id ?? crypto.randomUUID();
    const varWithId: CustomVar = { ...v, id };
    // Always seed/refresh the runtime value in the global variable store so
    // formula evaluation (variables['uuid']) reflects the current initialValue.
    // Without this, rebuilding with the same UUID but a new data schema would
    // leave the old array in the store and all bound formulas would return undefined.
    const vs = getGlobalVariableStore().getState();
    vs.setState((prev: Record<string, unknown>) => ({ ...prev, [id]: varWithId.initialValue ?? null }));
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
      }
    }
    set(s => ({ customVars: s.customVars.map(v => v.name === name ? { ...v, ...patch } : v) }));
  },
  removeCustomVar: (name) =>
    set(s => ({ customVars: s.customVars.filter(v => v.name !== name) })),

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
    // backend project. We always clear popups and load exclusively from the
    // backend — never fall through to static config.
    if (projectId && projectId !== 'admin') {
      // Clear the popup store immediately so non-admin projects start blank.
      const { clearPopups } = await import('@/lib/builder/popup-data');
      clearPopups();

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
            if (saved?.themeOverrides) next.themeOverrides = saved.themeOverrides as typeof s.themeOverrides;
            if (saved?.themeDarkOverrides) next.themeDarkOverrides = saved.themeDarkOverrides as typeof s.themeDarkOverrides;
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
          if (saved?.themeOverrides && typeof saved.themeOverrides === 'object') {
            const lightOv = saved.themeOverrides as Record<string, string>;
            _applyLightOverrides(lightOv);
            injectFontsFromOverrides(lightOv);
          }
          if (saved?.themeDarkOverrides && typeof saved.themeDarkOverrides === 'object') {
            _applyDarkOverrides(saved.themeDarkOverrides as Record<string, string>);
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
    // Load the static showcase pages and reset popups to config/popups.json.
    {
      const { resetToConfigPopups } = await import('@/lib/builder/popup-data');
      resetToConfigPopups();
      set(() => ({
        pages: INITIAL_PAGES,
        focusedPageId: SHOWCASE_PAGE.id,
        currentPageId: SHOWCASE_PAGE.id,  // keep deprecated alias in sync
        canvasNodes: [],
        pageNodes: clone(showcaseNodes),
        history: [makeSnapshot(INITIAL_PAGES, SHOWCASE_PAGE.id, clone(showcaseNodes), [])],
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

          const configWorkflows = Object.fromEntries(json.workflows.map(w => [w.id, w.steps]));
          // Detect UUID-shaped strings (fall-through when no name is set)
          const isUuidStr = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
          const configMeta = Object.fromEntries(json.workflows.map(w => [w.id, {
            id: w.id,
            name: w.name && !isUuidStr(w.name) ? toHumanName(w.name) : 'Unnamed Workflow',
            trigger: w.trigger,
            isSystem: isSystemWorkflow(w),
          } as WorkflowMeta]));
          next.pageWorkflows = { ...configWorkflows, ...userWorkflows };
          next.pageWorkflowMeta = { ...configMeta, ...userMeta };
        }

        // ── Direct actions from config/actions/*.json ─────────────────────────
        if (json.directActions && typeof json.directActions === 'object') {
          next.directActionsMap = json.directActions as Record<string, Record<string, unknown>>;
        }

        return next;
      });
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
    _applyLightOverrides(fullLight);
    _applyDarkOverrides(dark);
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
