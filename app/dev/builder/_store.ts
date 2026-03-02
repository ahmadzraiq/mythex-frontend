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
import routesConfig from '@/config/routes.json';
import { showcaseNodes } from './_showcase';
import root from '@/config/root';
import { resolveScreenConfig, type ConfigRegistry } from '@/lib/sdui/config-resolver';

const MAX_HISTORY = 50;

/**
 * Convert a hex color string to a space-separated RGB triplet,
 * which is the format ThemeStyles uses for CSS custom properties
 * so that Tailwind's `rgb(var(--X) / alpha)` syntax works.
 * Non-hex values (font strings, 'inherit', etc.) are passed through unchanged.
 */
function hexToRgbTriplet(value: string): string {
  if (!value.startsWith('#')) return value;
  const clean = value.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/**
 * Managed <style> tag helpers.
 *
 * WHY style tags instead of inline styles:
 *   Inline styles on document.documentElement have the highest specificity and
 *   override EVERY CSS rule — including `.dark {}` rules. This breaks dark mode
 *   because the light-mode inline values win even when the `dark` class is active.
 *
 *   Using :root {} and .dark {} style tags instead keeps everything at the same
 *   specificity (0,1,0). The builder's style tags are appended AFTER ThemeStyles
 *   in the <head>, so they win by DOM order. And our dark override tag comes after
 *   our light override tag, so .dark {} correctly wins in dark mode. ✓
 */
function _getManagedStyle(id: string): HTMLStyleElement {
  if (typeof document === 'undefined') return {} as HTMLStyleElement;
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  return el;
}

/**
 * Injects light-mode overrides.
 *
 * Colors (hex/RGB values) go into `html:not(.dark) {}` so they are
 * invisible to dark-mode CSS — dark overrides in `.dark {}` take over
 * without any specificity fight.
 *
 * Non-color values (fonts, radius) go into `:root {}` so they apply in
 * both light AND dark mode.
 */
/**
 * Gluestack's Checkbox, Radio, Switch etc. use internal `--color-primary-*`
 * tokens set as inline styles via NativeWind vars(). We bridge them to our
 * `--primary` variable using `!important`, which (per the CSS spec) is the
 * only way to override inline-style custom properties from a stylesheet rule.
 */
const GLUESTACK_PRIMARY_BRIDGE = [
  '  --color-primary-400: var(--primary) !important;',
  '  --color-primary-500: var(--primary) !important;',
  '  --color-primary-600: var(--primary) !important;',
  '  --color-primary-700: var(--primary) !important;',
  '  --color-primary-800: var(--primary) !important;',
].join('\n');

function _applyLightOverrides(overrides: Record<string, string>) {
  const el = _getManagedStyle('builder-light-overrides');

  const colorLines: string[] = [];
  const baseLines: string[]  = [];

  for (const [k, v] of Object.entries(overrides)) {
    if (v.startsWith('#')) {
      // hex color → convert to RGB triplet, scope to light mode only
      colorLines.push(`  --${k}: ${hexToRgbTriplet(v)};`);
    } else {
      // font family string, rem value, etc. → applies in both modes
      baseLines.push(`  --${k}: ${v};`);
    }
  }

  const parts: string[] = [];
  if (baseLines.length) parts.push(`:root {\n${baseLines.join('\n')}\n}`);
  // Always include the bridge so Gluestack components follow the active --primary
  parts.push(`html:not(.dark) {\n${colorLines.join('\n')}${colorLines.length ? '\n' : ''}${GLUESTACK_PRIMARY_BRIDGE}\n}`);
  el.textContent = parts.join('\n\n');
}

/**
 * Injects dark-mode overrides as `html.dark { }` (specificity 0,1,1) so they
 * beat ThemeStyles's `.dark { }` (specificity 0,1,0) without relying on DOM order.
 * Also bridges Gluestack's internal primary tokens to `--primary` with !important.
 */
function _applyDarkOverrides(overrides: Record<string, string>) {
  const el = _getManagedStyle('builder-dark-overrides');
  const vars = Object.entries(overrides)
    .map(([k, v]) => `  --${k}: ${hexToRgbTriplet(v)};`)
    .join('\n');
  el.textContent = `html.dark {\n${vars ? vars + '\n' : ''}${GLUESTACK_PRIMARY_BRIDGE}\n}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return structuredClone(v);
}

export function findNode(nodes: SDUINode[], targetId: string): SDUINode | null {
  for (const node of nodes) {
    if (node.id === targetId) return node;
    if (node.children?.length) {
      const found = findNode(node.children as SDUINode[], targetId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Returns the parent node of `targetId`, or null if it is a root node.
 * Returns undefined if `targetId` is not found anywhere.
 */
export function findParentNode(
  nodes: SDUINode[],
  targetId: string,
  _parent: SDUINode | null = null
): SDUINode | null | undefined {
  for (const node of nodes) {
    if (node.id === targetId) return _parent;
    if (node.children?.length) {
      const result = findParentNode(node.children as SDUINode[], targetId, node);
      if (result !== undefined) return result;
    }
  }
  return undefined;
}

function patchNodeById(
  nodes: SDUINode[],
  targetId: string,
  patcher: (n: SDUINode) => SDUINode
): SDUINode[] {
  return nodes.map(node => {
    if (node.id === targetId) return patcher(node);
    if (node.children?.length) {
      return { ...node, children: patchNodeById(node.children as SDUINode[], targetId, patcher) };
    }
    return node;
  });
}

function removeNodesByIds(nodes: SDUINode[], ids: Set<string>): SDUINode[] {
  return nodes
    .filter(n => !ids.has(n.id ?? ''))
    .map(n => ({
      ...n,
      children: n.children?.length
        ? removeNodesByIds(n.children as SDUINode[], ids)
        : n.children,
    }));
}

/** Insert `newNode` as a child of `parentId`, or at root level if parentId is null */
function insertNode(
  nodes: SDUINode[],
  newNode: SDUINode,
  parentId: string | null,
  atIdx?: number
): SDUINode[] {
  if (!parentId) {
    const copy = clone(nodes);
    const idx = atIdx !== undefined ? atIdx : copy.length;
    copy.splice(idx, 0, newNode);
    return copy;
  }
  return patchNodeById(nodes, parentId, parent => {
    const children = clone((parent.children ?? []) as SDUINode[]);
    const idx = atIdx !== undefined ? atIdx : children.length;
    children.splice(idx, 0, newNode);
    return { ...parent, children };
  });
}

// ─── Store shape ──────────────────────────────────────────────────────────────

export interface GridOverlayConfig {
  enabled: boolean;
  type: 'columns' | 'rows' | 'grid';
  count: number;
  color: string;
}

export type ViewportSize = 'mobile' | 'tablet' | 'laptop' | 'desktop';

export const VIEWPORT_WIDTHS: Record<ViewportSize, number> = {
  mobile:  390,
  tablet:  768,
  laptop:  1024,
  desktop: 1280,
};

// ─── Data Source Config ───────────────────────────────────────────────────────

export interface DataSourceHeader { key: string; value: string; enabled?: boolean; }

export interface DataSourceParam { key: string; value: string; enabled: boolean; }

export interface DataSourceAuth {
  type: 'none' | 'bearer' | 'basic' | 'apikey';
  token?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  apiKeyHeader?: string;
}

export interface CustomVar {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  initialValue: unknown;
}

export interface DataSourceConfig {
  id: string;
  name: string;
  type: 'rest' | 'graphql';
  // REST
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: DataSourceHeader[];
  body?: string;
  queryParams?: DataSourceParam[];
  auth?: DataSourceAuth;
  // GraphQL
  endpoint?: string;
  query?: string;
  variables?: string;
  // Common
  responsePath?: string;
  storeIn?: string;
  trigger?: 'mount' | 'action';
  triggerActionName?: string;
  /** Origin actions/*.json file name (without .json) — used for write-back */
  _sourceFile?: string;
}

export interface PageMeta {
  title?: string;
  description?: string;
  ogImage?: string;
}

export interface BuilderPage {
  id: string;
  name: string;
  /** App route path — omitted for builder-internal canvases (e.g. Component Showcase). */
  route?: string;
  nodes: SDUINode[];
  /** Flat key-value dummy data for the "Data" preview state.
   *  Keys match Zustand data paths (e.g. "cart.totalQuantity", "cart.lines"). */
  previewData?: Record<string, unknown>;
  /** Page-level SEO / meta fields */
  meta?: PageMeta;
  /** Page-level interactions keyed by event name (e.g. "mount") */
  pageInteractions?: Record<string, { workflow?: string }>;
}

export interface BuilderStore {
  // ── Multi-page state ────────────────────────────────────────────────────────
  pages: BuilderPage[];
  currentPageId: string;

  // ── Page state (active page working copy) ───────────────────────────────────
  pageNodes: SDUINode[];

  // ── Selection ───────────────────────────────────────────────────────────────
  selectedIds: string[];
  hoveredId: string | null;
  altHoveredId: string | null;
  altMode: boolean;

  // ── Layer state ─────────────────────────────────────────────────────────────
  lockedIds: Set<string>;
  hiddenIds: Set<string>;
  expandedIds: Set<string>;

  // ── Tool ────────────────────────────────────────────────────────────────────
  tool: 'select' | 'hand';

  // ── Viewport (zoom / pan) ───────────────────────────────────────────────────
  zoom: number;
  panX: number;
  panY: number;

  // ── Responsive viewport ──────────────────────────────────────────────────────
  viewport: ViewportSize;

  // ── Grid overlay ─────────────────────────────────────────────────────────────
  gridOverlay: GridOverlayConfig;

  // ── Clipboard ───────────────────────────────────────────────────────────────
  clipboard: SDUINode[];

  // ── History ─────────────────────────────────────────────────────────────────
  history: SDUINode[][];
  historyIdx: number;

  // ── Actions ─────────────────────────────────────────────────────────────────

  // Page mutations
  addSection: (variantId: string, node: SDUINode, atIdx?: number) => void;
  addNode: (node: SDUINode, parentId?: string | null, atIdx?: number) => void;
  moveNode: (nodeId: string, newParentId: string | null, atIdx: number) => void;
  moveNodes: (nodeIds: string[], newParentId: string | null, atIdx: number) => void;
  deleteNodes: (ids: string[]) => void;
  duplicateNodes: (ids: string[]) => void;
  groupNodes: (ids: string[]) => void;
  moveSection: (fromIdx: number, toIdx: number) => void;
  moveNodeUp: (id: string) => void;
  moveNodeDown: (id: string) => void;
  patchProp: (id: string, propPath: string, value: unknown) => void;
  patchClassName: (id: string, oldToken: string, newToken: string) => void;
  renameNode: (id: string, newId: string) => void;

  // Selection
  select: (id: string | null, multi?: boolean) => void;
  selectAll: () => void;
  selectParent: (id: string) => void;
  selectFirstChild: (id: string) => void;
  hover: (id: string | null) => void;
  setAltMode: (on: boolean) => void;
  setAltHovered: (id: string | null) => void;

  // Layer toggles
  toggleVisibility: (id: string) => void;
  toggleLock: (id: string) => void;
  toggleExpanded: (id: string) => void;
  setExpandedIds: (ids: Set<string>) => void;

  // Tool
  setTool: (t: 'select' | 'hand') => void;

  // Viewport
  setZoom: (z: number) => void;
  setPan:  (x: number, y: number) => void;
  setViewport: (v: ViewportSize) => void;

  // Grid overlay
  setGridOverlay: (cfg: Partial<GridOverlayConfig>) => void;

  // Clipboard
  copyToClipboard: () => void;
  pasteFromClipboard: () => void;
  pasteInPlace: () => void;

  // Align / Distribute (reads live DOM rects, sets inline style.position/left/top)
  alignNodes: (ids: string[], edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  distributeNodes: (ids: string[], axis: 'h' | 'v') => void;

  // History
  undo: () => void;
  redo: () => void;

  // Cross-page move — removes node from a source page and inserts into the current page
  moveNodeFromPage: (nodeId: string, fromPageId: string, parentId: string | null, atIdx: number) => void;

  // Pages
  addPage: (route: string, name?: string) => void;
  switchPage: (pageId: string) => void;
  /** Switch to a page AND signal the canvas to pan/zoom to it. */
  navigatePage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  removePage: (pageId: string) => void;

  // Canvas navigation trigger (set by navigatePage, consumed by _canvas.tsx)
  pendingFitToPage: boolean;
  clearPendingFit: () => void;

  // ── Logic / Behavior layer ───────────────────────────────────────────────────
  /** Which component states are being previewed on the canvas (builder-only mock). Multi-select supported. */
  activePreviewStates: string[];
  /** Show interaction lines on the canvas overlay */
  showInteractionLines: boolean;
  /** Signal to the Logic panel to scroll to / open a specific section */
  activeLogicSection: string | null;

  patchCondition: (id: string, condition: object | null) => void;
  patchActions: (id: string, actions: Record<string, unknown> | null) => void;
  patchMap: (id: string, mapPath: string | null, keyField?: string) => void;
  patchDataSource: (id: string, ds: Record<string, unknown> | null) => void;
  patchVariant: (id: string, variants: unknown[] | null) => void;
  /** Generic: patch any top-level or nested field on a node */
  patchNodeField: (id: string, field: string, value: unknown) => void;
  setPreviewState: (state: string) => void;
  togglePreviewState: (state: string) => void;
  setShowInteractionLines: (on: boolean) => void;
  openLogicSection: (section: string | null) => void;
  /** Set the dummy preview data for the current page (used by "Data" preview state) */
  setCurrentPagePreviewData: (data: Record<string, unknown>) => void;
  /** Set meta fields for the current page */
  setCurrentPageMeta: (meta: PageMeta) => void;
  /** Set page-level interactions for the current page */
  setCurrentPageInteractions: (interactions: Record<string, { workflow?: string }>) => void;
  /** Engine conventions loaded from store.json (graphqlEndpoint, graphqlHeaders, etc.) */
  engineConventions: {
    graphqlEndpoint?: string;
    graphqlHeaders?: Record<string, string>;
    graphqlCredentials?: string;
  };

  /** App-level global preview data shared across all pages (overridden per-page) */
  appPreviewData: Record<string, unknown>;
  /** Set global app-level preview data */
  setAppPreviewData: (data: Record<string, unknown>) => void;

  // ── Workflows & Formulas ─────────────────────────────────────────────────────
  /** Named workflows (per-page action sequences, keyed by workflow name) */
  pageWorkflows: Record<string, object[]>;
  /** App-level workflows shared across all pages */
  globalWorkflows: Record<string, object[]>;
  /** Named JSON Logic expressions usable as {{formula.name}} anywhere */
  globalFormulas: Record<string, object>;
  setPageWorkflow: (name: string, actions: object[]) => void;
  removePageWorkflow: (name: string) => void;
  setGlobalWorkflow: (name: string, actions: object[]) => void;
  removeGlobalWorkflow: (name: string) => void;
  setGlobalFormula: (name: string, expr: object) => void;
  removeGlobalFormula: (name: string) => void;

  // ── Custom Variables ─────────────────────────────────────────────────────────
  /** User-defined variables with an initial value and type */
  customVars: CustomVar[];
  addCustomVar: (v: CustomVar) => void;
  updateCustomVar: (name: string, patch: Partial<CustomVar>) => void;
  removeCustomVar: (name: string) => void;

  // ── Data Sources ─────────────────────────────────────────────────────────────
  /** Page-level API data sources (REST or GraphQL) */
  pageDataSources: DataSourceConfig[];
  addPageDataSource: (cfg: DataSourceConfig) => void;
  updatePageDataSource: (id: string, patch: Partial<DataSourceConfig>) => void;
  removePageDataSource: (id: string) => void;

  // ── Theme overrides ──────────────────────────────────────────────────────────
  /** Light-mode CSS variable overrides (key = var name without --) */
  themeOverrides: Record<string, string>;
  /** Dark-mode CSS variable overrides (key = var name without --) */
  themeDarkOverrides: Record<string, string>;
  /**
   * Apply a CSS variable override for the given mode.
   * Light-mode vars are set inline on :root; dark-mode vars are injected into
   * a managed <style id="builder-dark-overrides"> rule so they only apply when
   * document.documentElement has the `dark` class.
   * Values are stored as hex in state; CSS vars are set as RGB triplets so
   * `rgb(var(--X))` syntax in the showcase works correctly.
   */
  /** Install the Gluestack primary token bridge on page mount (no-op if already installed). */
  initTheme: () => void;
  patchTheme: (cssVar: string, value: string, mode?: 'light' | 'dark') => void;
  resetTheme: () => void;
  /** Apply a complete theme preset atomically — light colors, dark colors, and fonts. */
  applyThemePreset: (
    light: Record<string, string>,
    dark: Record<string, string>,
    fonts?: { heading?: string; body?: string },
  ) => void;

  /** Load Data Sources, Workflows, Variables, Formulas from the app config files via the API.
   *  Only runs if panels are empty (user hasn't manually edited), unless forceReload=true. */
  loadFromConfig: (forceReload?: boolean) => Promise<void>;

  // Internal (debounce wrapper)
  _pushHistory: () => void;
  _setPageNodes: (nodes: SDUINode[]) => void;
  /** E2E only — resets undo/redo history to a single empty snapshot so tests start clean. */
  _clearHistory: () => void;
  // Overlay update callback — set by _canvas.tsx, called by _panel-right.tsx for imperative ring updates
  _requestOverlayUpdate: () => void;
  _setOverlayUpdateCallback: (fn: (() => void) | null) => void;
  // Lightweight ring-only update — skips fills/getComputedStyle; called from patchStyle RAF
  // with already-computed BCR so the overlay doesn't need to re-read the DOM.
  _requestRingUpdate: (elRect: DOMRect, frameRect: DOMRect) => void;
  _setRingUpdateCallback: (fn: ((elRect: DOMRect, frameRect: DOMRect) => void) | null) => void;
}

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

/**
 * Recursively ensure every node in the tree has a unique `id`.
 * SDUI screen configs are render-only trees — they have no `id` fields.
 * The builder requires `id` on every node so:
 *   • the renderer stamps `data-builder-id` on the DOM element
 *   • the overlay can hit-test and select nodes
 *   • findNode / moveNode / patchProp can locate nodes in the tree
 *
 * IDs are generated as `<prefix>-<type>-<counter>` so they are
 * readable in the Layers panel and stable within a single page load.
 */
function _assignIds(nodes: SDUINode[], prefix: string, ctr: { n: number }): SDUINode[] {
  return nodes.map(node => {
    ctr.n += 1;
    const id = (node.id as string | undefined) ?? `${prefix}-${String(node.type ?? 'node').toLowerCase()}-${ctr.n}`;
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
  pageWorkflows: _loadJson<Record<string, object[]>>('builder:workflows', {}),
  globalWorkflows: {},
  globalFormulas: _loadJson<Record<string, object>>('builder:formulas', {}),
  customVars: _loadJson<CustomVar[]>('builder:customVars', []),
  pageDataSources: _loadJson<DataSourceConfig[]>('builder:dataSources', []),
  engineConventions: _loadJson<{ graphqlEndpoint?: string; graphqlHeaders?: Record<string, string>; graphqlCredentials?: string }>('builder:engineConventions', {}),
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
    set(s => ({
      pageNodes: insertNode(s.pageNodes, node, parentId ?? null, atIdx),
      selectedIds: node.id ? [node.id] : s.selectedIds,
    }));
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
      const REQUIRED_PARENT: Record<string, string> = {
        ButtonText:         'Button',
        ButtonIcon:         'Button',
        InputField:         'Input',
        InputSlot:          'Input',
        InputIcon:          'Input',
        CheckboxIndicator:  'Checkbox',
        CheckboxIcon:       'Checkbox',
        CheckboxLabel:      'Checkbox',
        RadioIndicator:     'Radio',
        RadioLabel:         'Radio',
        RadioIcon:          'Radio',
        SelectInput:        'Select',
        SelectIcon:         'Select',
        SelectTrigger:      'Select',
        SelectItem:         'Select',
        SelectContent:      'Select',
        SelectPortal:       'Select',
        SelectBackdrop:     'Select',
        AccordionItem:      'Accordion',
        AccordionTrigger:   'Accordion',
        AccordionContent:   'Accordion',
        AccordionHeader:    'Accordion',
        SliderThumb:        'Slider',
        SliderTrack:        'Slider',
        SliderFilledTrack:  'Slider',
        BadgeText:          'Badge',
        BadgeIcon:          'Badge',
        FabLabel:           'Fab',
        AvatarImage:        'Avatar',
        AvatarFallbackText: 'Avatar',
        ProgressFilledTrack: 'Progress',
        TextareaInput:      'Textarea',
        SkeletonText:       'Skeleton',
        AlertText:          'Alert',
        LinkText:           'Link',
        Radio:              'RadioGroup',
        ModalBackdrop:      'Modal',
        ModalContent:       'Modal',
        ModalHeader:        'ModalContent',
        ModalBody:          'ModalContent',
        ModalFooter:        'ModalContent',
        ModalCloseButton:   'ModalContent',
        TooltipContent:     'Tooltip',
        TooltipText:        'TooltipContent',
        AlertDialogBackdrop:  'AlertDialog',
        AlertDialogContent:   'AlertDialog',
        AlertDialogHeader:    'AlertDialogContent',
        AlertDialogBody:      'AlertDialogContent',
        AlertDialogFooter:    'AlertDialogContent',
        AlertDialogCloseButton: 'AlertDialogContent',
      };
      if (node.type && REQUIRED_PARENT[node.type]) {
        const requiredType = REQUIRED_PARENT[node.type];
        const newParent = newParentId ? findNode(s.pageNodes, newParentId) : null;
        if (!newParent || newParent.type !== requiredType) return s;
      }
      // Also guard the destination: only allowed child types may enter certain parents.
      if (newParentId) {
        const ALLOWED: Record<string, Set<string>> = {
          Button:   new Set(['ButtonText', 'ButtonIcon', 'NavIcon']),
          Input:    new Set(['InputField', 'InputSlot', 'InputIcon']),
          Checkbox: new Set(['CheckboxIndicator', 'CheckboxIcon', 'CheckboxLabel']),
          Radio:    new Set(['RadioIndicator', 'RadioLabel', 'RadioIcon']),
          Select:   new Set(['SelectTrigger', 'SelectInput', 'SelectIcon', 'SelectPortal', 'SelectBackdrop', 'SelectContent', 'SelectItem']),
          Accordion: new Set(['AccordionItem', 'AccordionTrigger', 'AccordionContent', 'AccordionHeader']),
          Slider:   new Set(['SliderTrack', 'SliderThumb', 'SliderFilledTrack']),
          Badge:         new Set(['BadgeText', 'BadgeIcon']),
          Fab:           new Set(['FabLabel', 'FabIcon', 'NavIcon', 'Text']),
          Avatar:        new Set(['AvatarImage', 'AvatarFallbackText']),
          Progress:      new Set(['ProgressFilledTrack']),
          Textarea:      new Set(['TextareaInput']),
          Skeleton:      new Set(['SkeletonText']),
          Alert:         new Set(['AlertIcon', 'AlertText', 'NavIcon']),
          Link:          new Set(['LinkText']),
        RadioGroup:    new Set(['Radio']),
        CheckboxGroup: new Set(['Checkbox']),
        Modal:         new Set(['ModalBackdrop', 'ModalContent']),
        ModalContent:  new Set(['ModalHeader', 'ModalBody', 'ModalFooter', 'ModalCloseButton']),
        Tooltip:       new Set(['TooltipContent', 'Pressable', 'Box', 'Text']),
        TooltipContent: new Set(['TooltipText']),
        AlertDialog:   new Set(['AlertDialogBackdrop', 'AlertDialogContent']),
        AlertDialogContent: new Set(['AlertDialogHeader', 'AlertDialogBody', 'AlertDialogFooter', 'AlertDialogCloseButton']),
        };
        const newParent = findNode(s.pageNodes, newParentId);
        if (newParent && ALLOWED[newParent.type] && !ALLOWED[newParent.type].has(node.type)) return s;
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
    set(s => { const { [name]: _, ...rest } = s.pageWorkflows; return { pageWorkflows: rest }; }),
  setGlobalWorkflow: (name, actions) =>
    set(s => ({ globalWorkflows: { ...s.globalWorkflows, [name]: actions } })),
  removeGlobalWorkflow: (name) =>
    set(s => { const { [name]: _, ...rest } = s.globalWorkflows; return { globalWorkflows: rest }; }),
  setGlobalFormula: (name, expr) =>
    set(s => ({ globalFormulas: { ...s.globalFormulas, [name]: expr } })),
  removeGlobalFormula: (name) =>
    set(s => { const { [name]: _, ...rest } = s.globalFormulas; return { globalFormulas: rest }; }),

  addCustomVar: (v) =>
    set(s => ({ customVars: [...s.customVars.filter(x => x.name !== v.name), v] })),
  updateCustomVar: (name, patch) =>
    set(s => ({ customVars: s.customVars.map(v => v.name === name ? { ...v, ...patch } : v) })),
  removeCustomVar: (name) =>
    set(s => ({ customVars: s.customVars.filter(v => v.name !== name) })),

  addPageDataSource: (cfg) =>
    set(s => ({ pageDataSources: [...s.pageDataSources, cfg] })),
  updatePageDataSource: (id, patch) =>
    set(s => ({ pageDataSources: s.pageDataSources.map(d => d.id === id ? { ...d, ...patch } : d) })),
  removePageDataSource: (id) =>
    set(s => ({ pageDataSources: s.pageDataSources.filter(d => d.id !== id) })),

  loadFromConfig: async (forceReload = false) => {
    try {
      const res = await fetch('/api/builder/config');
      if (!res.ok) return;
      const data = await res.json() as {
        dataSources?: DataSourceConfig[];
        workflows?: Record<string, object[]>;
        variables?: CustomVar[];
        formulas?: Record<string, object>;
        engineConventions?: {
          graphqlEndpoint?: string;
          graphqlHeaders?: Record<string, string>;
          graphqlCredentials?: string;
        };
      };
      const conventions = data.engineConventions ?? {};
      // Always persist and apply engineConventions so the Run button can resolve the endpoint
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('builder:engineConventions', JSON.stringify(conventions)); } catch { /* ignore */ }
      }

      const s = get();
      const hasLocalData =
        s.pageDataSources.length > 0 ||
        s.customVars.length > 0 ||
        Object.keys(s.pageWorkflows).length > 0 ||
        Object.keys(s.globalFormulas).length > 0;

      if (forceReload || !hasLocalData) {
        // Seed panels from config only on first load or when forced
        set({
          pageDataSources: data.dataSources ?? [],
          pageWorkflows: data.workflows ?? {},
          customVars: data.variables ?? [],
          globalFormulas: data.formulas ?? {},
          engineConventions: conventions,
        });
      } else {
        // Still always update engineConventions so execute can use the real endpoint
        set({ engineConventions: conventions });
      }
    } catch {
      // Network error or dev server not running — silently skip
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

// Persist selected fields to localStorage whenever they change
if (typeof window !== 'undefined') {
  useBuilderStore.subscribe(s => {
    _saveJson('builder:dataSources', s.pageDataSources);
    _saveJson('builder:customVars', s.customVars);
    _saveJson('builder:workflows', s.pageWorkflows);
    _saveJson('builder:formulas', s.globalFormulas);
  });
}

// ─── Debounced write-back to config files ─────────────────────────────────────
// Whenever the user edits Data Sources, Variables, Workflows, or Formulas in
// the builder, flush the changes back to config/actions/*.json and
// config/store.json via the Next.js API route (500 ms debounce).

if (typeof window !== 'undefined') {
  let _saveTimer: ReturnType<typeof setTimeout> | null = null;
  let _prevSaveKey = '';

  useBuilderStore.subscribe(s => {
    // Build a cheap change-detection key to avoid unnecessary PUT calls
    const key = JSON.stringify({
      ds: s.pageDataSources.length,
      cv: s.customVars.length,
      wf: Object.keys(s.pageWorkflows).length,
      gf: Object.keys(s.globalFormulas).length,
    });

    if (key === _prevSaveKey) return;
    _prevSaveKey = key;

    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      const { pageDataSources, customVars, pageWorkflows, globalFormulas } = useBuilderStore.getState();
      // Never write back when the builder is in an empty/reset state — this would
      // destructively overwrite the config files with empty data.
      const hasData =
        pageDataSources.length > 0 ||
        customVars.length > 0 ||
        Object.keys(pageWorkflows).length > 0 ||
        Object.keys(globalFormulas).length > 0;
      if (!hasData) return;

      try {
        await fetch('/api/builder/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataSources: pageDataSources,
            workflows: pageWorkflows,
            variables: customVars,
            formulas: globalFormulas,
          }),
        });
      } catch {
        // Silent — dev-server may not be available, network error, etc.
      }
    }, 500);
  });
}

// Expose store for E2E tests as early as possible (module-level, not useEffect)
// so it's available as soon as the JS bundle loads — before React hydration.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>).__builderStore = useBuilderStore;
}
