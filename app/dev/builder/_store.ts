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

export interface BuilderPage {
  id: string;
  name: string;
  /** App route path — omitted for builder-internal canvases (e.g. Component Showcase). */
  route?: string;
  nodes: SDUINode[];
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

  // Internal (debounce wrapper)
  _pushHistory: () => void;
  _setPageNodes: (nodes: SDUINode[]) => void;
  // Overlay update callback — set by _canvas.tsx, called by _panel-right.tsx for imperative ring updates
  _requestOverlayUpdate: () => void;
  _setOverlayUpdateCallback: (fn: (() => void) | null) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

// Component Showcase — builder-internal canvas only, not an app route.
const SHOWCASE_PAGE: BuilderPage = {
  id: 'page-showcase',
  name: '✦ Component Showcase',
  nodes: showcaseNodes,
};

// Initialise one page per route so all app pages are visible on the canvas by default.
const ROUTE_PAGES: BuilderPage[] = (routesConfig as { routes: Array<{ path: string; config: string }> })
  .routes.map(r => ({
    id: `page-${r.config}`,
    name: r.config,
    route: r.path,
    nodes: [],
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

  _setPageNodes: (nodes) => set({ pageNodes: nodes }),
  _requestOverlayUpdate: () => {},
  _setOverlayUpdateCallback: (fn) => set({ _requestOverlayUpdate: fn ?? (() => {}) }),

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
}
