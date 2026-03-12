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

// ─── Node-tree helpers (extracted to _store-node-helpers.ts) ────────────────
// Single import for internal use; explicit re-exports for external consumers.
import {
  REQUIRED_PARENT, ALLOWED_CHILDREN,
  findNode, findParentNode, patchNodeById, insertNode,
  hasFormContainerAncestor,
  clone, removeNodesByIds,
  _applyLightOverrides, _applyDarkOverrides, hexToRgbTriplet, _getManagedStyle,
  GLUESTACK_PRIMARY_BRIDGE,
} from './_store-node-helpers';

export {
  REQUIRED_PARENT, ALLOWED_CHILDREN,
  findNode, findParentNode, patchNodeById, insertNode,
  hasFormContainerAncestor,
};

const MAX_HISTORY = 50;


// ─── Store shape — types extracted to _store-types.ts ─────────────────────────
// Re-exported here for backward compat; import from _store-types.ts directly
// when you only need the type shapes (avoids loading the full Zustand store).

export type {
  GridOverlayConfig, ViewportSize,
  DataSourceHeader, DataSourceParam, DataSourceAuth,
  Folder, CustomVar, DataSourceConfig,
  PageMeta, BuilderPage,
  WorkflowMeta, WorkflowCanvasTarget,
  BuilderStore,
} from './_store-types';
export { VIEWPORT_WIDTHS } from './_store-types';

// Local alias used by the implementation below (avoids re-importing each name)
import type {
  GridOverlayConfig, ViewportSize, DataSourceConfig, CustomVar,
  Folder, WorkflowMeta, WorkflowCanvasTarget, BuilderStore,
  BuilderPage, PageMeta,
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
  .routes.map(r => ({
    id: `page-${r.config}`,
    name: r.config,
    route: r.path,
    nodes: _extractPageNodes(r.config),
  }));

const INITIAL_PAGES: BuilderPage[] = [SHOWCASE_PAGE, ...ROUTE_PAGES];

export const useBuilderStore = create<BuilderStore>((set, get) => ({
  pages: INITIAL_PAGES,
  currentPageId: SHOWCASE_PAGE.id,
  pageNodes: showcaseNodes,
  selectedIds: [],
  hoveredId: null,
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
  gridOverlay: { enabled: false, type: 'columns', count: 12, color: 'rgba(99,102,241,0.15)' },
  clipboard: [],
  history: [clone(showcaseNodes)],
  historyIdx: 0,
  pendingFitToPage: false,
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
      const nodes = clone(s.pageNodes);
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

  moveNode: (nodeId, newParentId, atIdx) => {
    set(s => {
      const node = findNode(s.pageNodes, nodeId);
      if (!node) return s;

      // Prevent dropping a node into itself or its own descendant
      if (newParentId === nodeId) return s;
      if (newParentId && findNode((findNode(s.pageNodes, nodeId)?.children ?? []) as SDUINode[], newParentId)) return s;

      // Context-dependent nodes must stay inside their required parent type.
      // Moving them out crashes the renderer (useStyleContext returns undefined → destructure error).
      if (node.type && REQUIRED_PARENT[node.type]) {
        const requiredType = REQUIRED_PARENT[node.type];
        const newParent = newParentId ? findNode(s.pageNodes, newParentId) : null;
        if (!newParent || newParent.type !== requiredType) return s;
      }
      // Also guard the destination: only allowed child types may enter certain parents.
      if (newParentId) {
        const newParent = findNode(s.pageNodes, newParentId);
        if (newParent && ALLOWED_CHILDREN[newParent.type] && !ALLOWED_CHILDREN[newParent.type].has(node.type)) return s;
      }

      // Find current parent to correctly adjust the target index
      const currentParent = findParentNode(s.pageNodes, nodeId);
      const currentParentId = currentParent?.id ?? null;
      const currentSiblings = currentParent
        ? (currentParent.children as SDUINode[])
        : s.pageNodes;
      const currentIdx = currentSiblings.findIndex(n => n.id === nodeId);

      // When moving within the same parent to a later slot, subtract 1 because
      // removing the node shifts every subsequent index down by 1.
      let adjustedIdx = atIdx;
      if (newParentId === currentParentId && atIdx > currentIdx) {
        adjustedIdx = atIdx - 1;
      }

      const withoutNode = removeNodesByIds(clone(s.pageNodes), new Set([nodeId]));
      const newNodes = insertNode(withoutNode, clone(node), newParentId, adjustedIdx);
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
        nodesToMove.push(clone(found));
      }
      if (nodesToMove.length === 0) return s;

      // Count how many of the moving nodes are already in the target parent
      // at indices BEFORE atIdx — these will be removed, shifting the target left.
      const targetChildren = newParentId
        ? ((findNode(s.pageNodes, newParentId)?.children ?? []) as SDUINode[])
        : s.pageNodes;
      const movingIds = new Set(nodesToMove.map(n => n.id!));
      let removedBeforeTarget = 0;
      for (let i = 0; i < atIdx && i < targetChildren.length; i++) {
        if (movingIds.has(targetChildren[i].id ?? '')) removedBeforeTarget++;
      }
      const adjustedIdx = Math.max(0, atIdx - removedBeforeTarget);

      // Remove all nodes in one pass, then insert consecutively at the target
      let result = removeNodesByIds(clone(s.pageNodes), movingIds);
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

      // Remove from source page
      const updatedSrcNodes = removeNodesByIds(clone(srcPage.nodes as SDUINode[]), new Set([nodeId]));
      const updatedPages = s.pages.map(p =>
        p.id === fromPageId ? { ...p, nodes: updatedSrcNodes } : p
      );

      // Insert into current page
      const newPageNodes = insertNode(clone(s.pageNodes), node, parentId, atIdx);

      return {
        pages: updatedPages,
        pageNodes: newPageNodes,
        selectedIds: node.id ? [node.id] : s.selectedIds,
      };
    });
    get()._pushHistory();
  },

  deleteNodes: (ids) => {
    const idSet = new Set(ids);
    set(s => ({
      pageNodes: removeNodesByIds(s.pageNodes, idSet),
      selectedIds: s.selectedIds.filter(id => !idSet.has(id)),
    }));
    get()._pushHistory();
  },

  duplicateNodes: (ids) => {
    set(s => {
      const nodes = clone(s.pageNodes);
      const newNodes: SDUINode[] = [];
      for (const id of ids) {
        const found = findNode(nodes, id);
        if (found) {
          const dup = clone(found);
          if (dup.id) dup.id = dup.id + '-copy';
          newNodes.push(dup);
        }
      }
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
      const nodes = clone(s.pageNodes);
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

      const newNodes = clone(s.pageNodes);
      const move = (arr: SDUINode[], from: number, to: number) => {
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
      };
      if (!parent) {
        move(newNodes, idx, targetIdx);
        return { pageNodes: newNodes };
      }
      return {
        pageNodes: patchNodeById(newNodes, parent.id!, p => {
          const ch = clone((p.children ?? []) as SDUINode[]);
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

      // Absolute "Move Down" = send backward = earlier DOM index (lower z-index).
      // Flow    "Move Down" = later DOM index, skipping any abs siblings below.
      let targetIdx: number;
      if (currentIsAbs) {
        if (idx <= 0) return s; // already at bottom of stacking
        targetIdx = idx - 1;
      } else {
        if (idx >= siblings.length - 1) return s;
        targetIdx = idx + 1;
        while (targetIdx < siblings.length && isAbsCls(siblings[targetIdx])) targetIdx++;
        if (targetIdx >= siblings.length) return s;
      }

      const newNodes = clone(s.pageNodes);
      const move = (arr: SDUINode[], from: number, to: number) => {
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
      };
      if (!parent) {
        move(newNodes, idx, targetIdx);
        return { pageNodes: newNodes };
      }
      return {
        pageNodes: patchNodeById(newNodes, parent.id!, p => {
          const ch = clone((p.children ?? []) as SDUINode[]);
          move(ch, idx, targetIdx);
          return { ...p, children: ch };
        }),
      };
    });
    get()._pushHistory();
  },

  patchProp: (id, propPath, value) => {
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node => {
        const parts = propPath.split('.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const patched: any = clone(node);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let obj: any = patched;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in obj)) obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
        return patched;
      }),
    }));
  },

  patchClassName: (id, oldToken, newToken) => {
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node => {
        const cls: string = (node.props as { className?: string })?.className ?? '';
        const newCls = oldToken
          ? cls.replace(new RegExp(`\\b${oldToken.replace('*', '[^\\s]+')}\\b`, 'g'), newToken).trim()
          : `${cls} ${newToken}`.trim();
        return { ...node, props: { ...(node.props as object), className: newCls } };
      }),
    }));
  },

  renameNode: (id, newId) => {
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node => ({ ...node, id: newId })),
      selectedIds: s.selectedIds.map(sid => (sid === id ? newId : sid)),
    }));
    get()._pushHistory();
  },

  // ── Selection ───────────────────────────────────────────────────────────────

  select: (id, multi = false) => {
    if (id === null) { set({ selectedIds: [] }); return; }
    if (get().lockedIds.has(id)) return;
    set(s => {
      if (multi) {
        const already = s.selectedIds.includes(id);
        return { selectedIds: already ? s.selectedIds.filter(sid => sid !== id) : [...s.selectedIds, id] };
      }
      return { selectedIds: [id] };
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

  hover: (id) => set({ hoveredId: id }),
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
  setViewport: (v) => set({ viewport: v }),

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
    const pasted = clipboard.map(n => {
      const c = clone(n);
      if (c.id) c.id = `${c.id}-paste-${Date.now()}`;
      return c;
    });
    const lastIdx = selectedIds.length
      ? pageNodes.findIndex(n => selectedIds.includes(n.id ?? ''))
      : -1;
    const insertAt = lastIdx >= 0 ? lastIdx + 1 : pageNodes.length;
    set(s => {
      const nodes = clone(s.pageNodes);
      nodes.splice(insertAt, 0, ...pasted);
      return {
        pageNodes: nodes,
        selectedIds: pasted.map(n => n.id ?? '').filter(Boolean),
      };
    });
    get()._pushHistory();
  },

  pasteInPlace: () => {
    // Same as pasteFromClipboard but preserves the original style.left/top so
    // the node lands at the exact same position (useful for "Paste in place").
    const { clipboard, pageNodes } = get();
    if (!clipboard.length) return;
    const pasted = clipboard.map(n => {
      const c = clone(n);
      if (c.id) c.id = `${c.id}-pip-${Date.now()}`;
      return c;
    });
    set(s => {
      const nodes = clone(s.pageNodes);
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
      let nodes = clone(s.pageNodes);
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
        let nodes = clone(s.pageNodes);
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
        let nodes = clone(s.pageNodes);
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
      history: [[]],
      historyIdx: 0,
      selectedIds: [],
      pages: s.pages.map(p => p.id === s.currentPageId ? { ...p } : p),
    }));
  },
  _requestOverlayUpdate: () => {},
  _setOverlayUpdateCallback: (fn) => set({ _requestOverlayUpdate: fn ?? (() => {}) }),
  _requestRingUpdate: () => {},
  _setRingUpdateCallback: (fn) => set({ _requestRingUpdate: fn ?? (() => {}) }),

  _pushHistory: () => {
    set(s => {
      const snap = clone(s.pageNodes);
      const prev = s.history.slice(0, s.historyIdx + 1);
      const next = [...prev, snap].slice(-MAX_HISTORY);
      // Sync current pageNodes back to the pages array so switching pages preserves work
      const pages = s.pages.map(p =>
        p.id === s.currentPageId ? { ...p, nodes: clone(s.pageNodes) } : p
      );
      return { history: next, historyIdx: next.length - 1, pages };
    });
  },

  undo: () => {
    set(s => {
      if (s.historyIdx <= 0) return s;
      const idx = s.historyIdx - 1;
      const nodes = clone(s.history[idx]);
      const pages = s.pages.map(p =>
        p.id === s.currentPageId ? { ...p, nodes } : p
      );
      return { pageNodes: nodes, historyIdx: idx, selectedIds: [], pages };
    });
  },

  redo: () => {
    set(s => {
      if (s.historyIdx >= s.history.length - 1) return s;
      const idx = s.historyIdx + 1;
      const nodes = clone(s.history[idx]);
      const pages = s.pages.map(p =>
        p.id === s.currentPageId ? { ...p, nodes } : p
      );
      return { pageNodes: nodes, historyIdx: idx, selectedIds: [], pages };
    });
  },

  // ── Page management ──────────────────────────────────────────────────────────

  addPage: (route, name) => {
    set(s => {
      // Guard: don't add a page for a route that already exists
      const existing = s.pages.find(p => p.route === route);
      if (existing) return s; // duplicate — caller should use navigatePage instead

      // Persist current page nodes before switching
      const savedPages = s.pages.map(p =>
        p.id === s.currentPageId ? { ...p, nodes: clone(s.pageNodes) } : p
      );
      const newPage: BuilderPage = {
        id: `page-${Date.now()}`,
        name: name ?? route,
        route,
        nodes: [],
      };
      return {
        pages: [...savedPages, newPage],
        currentPageId: newPage.id,
        pageNodes: [],
        selectedIds: [],
        hoveredId: null,
        history: [[]],
        historyIdx: 0,
        pendingFitToPage: true,
      };
    });
  },

  switchPage: (pageId) => {
    set(s => {
      const target = s.pages.find(p => p.id === pageId);
      if (!target || target.id === s.currentPageId) return s;
      // Persist current page nodes
      const savedPages = s.pages.map(p =>
        p.id === s.currentPageId ? { ...p, nodes: clone(s.pageNodes) } : p
      );
      const newNodes = clone(target.nodes);
      return {
        pages: savedPages,
        currentPageId: pageId,
        pageNodes: newNodes,
        selectedIds: [],
        hoveredId: null,
        history: [clone(newNodes)],
        historyIdx: 0,
      };
    });
  },

  navigatePage: (pageId) => {
    // Switch to the page (same logic as switchPage) and trigger canvas fit
    set(s => {
      const target = s.pages.find(p => p.id === pageId);
      if (!target) return s;
      if (target.id === s.currentPageId) {
        // Already on this page — just trigger a re-fit to scroll it into view
        return { pendingFitToPage: true };
      }
      const savedPages = s.pages.map(p =>
        p.id === s.currentPageId ? { ...p, nodes: clone(s.pageNodes) } : p
      );
      const newNodes = clone(target.nodes);
      return {
        pages: savedPages,
        currentPageId: pageId,
        pageNodes: newNodes,
        selectedIds: [],
        hoveredId: null,
        history: [clone(newNodes)],
        historyIdx: 0,
        pendingFitToPage: true,
      };
    });
  },

  clearPendingFit: () => set({ pendingFitToPage: false }),

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
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node =>
        condition === null
          ? (({ condition: _c, ...rest }) => rest)(node as SDUINode & { condition?: unknown }) as SDUINode
          : { ...node, condition } as SDUINode
      ),
    }));
    get()._pushHistory();
  },

  patchActions: (id, actions) => {
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node =>
        actions === null
          ? (({ actions: _a, ...rest }) => rest)(node as SDUINode & { actions?: unknown }) as SDUINode
          : { ...node, actions } as SDUINode
      ),
    }));
    get()._pushHistory();
  },

  patchMap: (id, mapPath, keyField) => {
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node => {
        if (mapPath === null) {
          const { map: _m, key: _k, ...rest } = node as SDUINode & { map?: unknown; key?: unknown };
          return rest as SDUINode;
        }
        return { ...node, map: mapPath, ...(keyField !== undefined ? { key: keyField } : {}) } as SDUINode;
      }),
    }));
    get()._pushHistory();
  },

  patchDataSource: (id, ds) => {
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node =>
        ds === null
          ? (({ dataSource: _d, ...rest }) => rest)(node as SDUINode & { dataSource?: unknown }) as SDUINode
          : { ...node, dataSource: ds } as unknown as SDUINode
      ),
    }));
    get()._pushHistory();
  },

  patchVariant: (id, variants) => {
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node =>
        variants === null
          ? (({ _variants: _v, ...rest }) => rest)(node as SDUINode & { _variants?: unknown }) as SDUINode
          : { ...node, _variants: variants } as SDUINode
      ),
    }));
    get()._pushHistory();
  },

  patchNodeField: (id, field, value) => {
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node => ({ ...node, [field]: value }) as SDUINode),
    }));
    get()._pushHistory();
  },

  patchNodeFieldLive: (id, field, value) => {
    set(s => ({
      pageNodes: patchNodeById(s.pageNodes, id, node => ({ ...node, [field]: value }) as SDUINode),
    }));
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
      pages: s.pages.map((p) => p.id === s.currentPageId ? { ...p, previewData: data } : p),
    })),

  setCurrentPageMeta: (meta) =>
    set((s) => ({
      pages: s.pages.map((p) => p.id === s.currentPageId ? { ...p, meta: { ...p.meta, ...meta } } : p),
    })),

  setCurrentPageInteractions: (interactions) =>
    set((s) => ({
      pages: s.pages.map((p) => p.id === s.currentPageId ? { ...p, pageInteractions: interactions } : p),
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
  setWorkflowStepTestResult: (stepId, result, error, stepIndex, actionName = 'Action') => {
    const entry: import('./_store-types').WorkflowTestEntry = { result, error, actionName, stepIndex, ranAt: Date.now() };
    persistWorkflowStepTestResult(stepId, entry);
    set(s => ({ workflowTestResults: { ...s.workflowTestResults, [stepId]: entry } }));
  },
  openWorkflowCanvas: (target) => set({ workflowCanvasTarget: target }),
  closeWorkflowCanvas: () => set({ workflowCanvasTarget: null }),
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

  addCustomVar: (v) =>
    set(s => ({ customVars: [...s.customVars.filter(x => x.name !== v.name), v] })),
  updateCustomVar: (name, patch) =>
    set(s => ({ customVars: s.customVars.map(v => v.name === name ? { ...v, ...patch } : v) })),
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

  loadFromConfig: async () => {
    try {
      const res = await fetch('/api/builder/config');
      if (!res.ok) return;
      const json = (await res.json()) as {
        dataSources?: DataSourceConfig[];
        dsFolders?: Folder[];
        variables?: Array<{ id: string; label?: string; type?: string; initialValue?: unknown; folder?: string; fields?: CustomVar['fields'] }>;
        varFolders?: Array<{ id: string; label: string }>;
        workflows?: Array<{ id: string; name: string; trigger: string; steps: object[]; onErrorSteps?: object[] }>;
        directActions?: Record<string, Record<string, unknown>>;
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
          const SYSTEM_STEP_TYPES = new Set(['changeVariableValue', 'setState', 'set']);
          const isSystemWorkflow = (w: { trigger?: string; steps?: unknown[] }) =>
            w.trigger === 'change' &&
            Array.isArray(w.steps) && w.steps.length === 1 &&
            SYSTEM_STEP_TYPES.has((w.steps[0] as Record<string, unknown>)?.type as string);

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
    set({ themeOverrides: fullLight, themeDarkOverrides: dark });
  },

  renamePage: (pageId, name) => {
    set(s => ({
      pages: s.pages.map(p => p.id === pageId ? { ...p, name } : p),
    }));
  },

  removePage: (pageId) => {
    set(s => {
      if (s.pages.length <= 1) return s; // must keep at least one page
      const remaining = s.pages.filter(p => p.id !== pageId);
      if (s.currentPageId !== pageId) {
        return { pages: remaining };
      }
      // Switching to the previous page (or first remaining)
      const removedIdx = s.pages.findIndex(p => p.id === pageId);
      const fallback = remaining[Math.max(0, removedIdx - 1)];
      return {
        pages: remaining,
        currentPageId: fallback.id,
        pageNodes: clone(fallback.nodes),
        selectedIds: [],
        hoveredId: null,
        history: [clone(fallback.nodes)],
        historyIdx: 0,
      };
    });
  },
}));

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
