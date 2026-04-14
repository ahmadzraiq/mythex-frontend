'use client';

/**
 * Builder Canvas — the central editing area.
 *
 * Renders the SDUI page tree DIRECTLY (no iframe). Everything lives in the
 * same React tree so selection/hover use event delegation on [data-builder-id]
 * and getBoundingClientRect() works without cross-origin tricks.
 *
 * zoom/panX/panY live in the Zustand store so _panel-right can read them for
 * correct canvas-relative X/Y coordinates.
 */

import React, { useRef, useEffect, useCallback, useMemo, useState, memo, useDeferredValue } from 'react';
import {
  VIEWPORT_H,
  CanvasContextMenu, type CanvasCtxMenuProps,
  ZoomBtn, EmptyCanvas,
  AllPagesGrid,
  CanvasNodeEngine,
  sanitizeGhostClone,
} from './_canvas-helpers';
import { useBuilderStore, findNode, findParentNode, VIEWPORT_WIDTHS, REQUIRED_PARENT, ALLOWED_CHILDREN } from './_store';
import { useCanvasPanZoom, MIN_ZOOM, MAX_ZOOM, PAGE_GAP } from './_canvas-hooks';
import BuilderOverlay, { type ResizeHandle } from './_overlay';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import appConfig from '@/config/app';
// SDUIConfig moved to AllPagesGrid
import type { SDUINode } from '@/lib/sdui/types/node';
import { computeSnap, snapResizeSize, SNAP_THRESHOLD, type SnapGuide, type ContentRect } from './_snap-engine';
import { removeTwToken, styleToClassName, STYLE_TO_CLASS_KEYS, parseTwArbitraryWithUnit } from './_tw-utils';
import { cancelPendingDimensionFlush } from './_panel-right';
import type { CanvasNode } from './_store-types';
import { StateBar } from './_state-bar';
// applyStateTagOverrides moved to AllPagesGrid (unified rendering)

/** Stable 'normal' preview-state array passed to inactive pages — never changes reference. */

/** Node types that act as containers and accept dropped children. */
// Keep in sync with isContainer in _panel-right.tsx
const CONTAINER_TYPES = new Set([
  'Box', 'VStack', 'HStack', 'Center', 'Grid', 'GridItem',
  'ScrollView', 'SafeAreaView',
  'Checkbox', 'CheckboxGroup', 'Radio', 'RadioGroup',
  'Skeleton', 'Tooltip',
  'FormContainer',
]);


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = appConfig as any;


// MIN_ZOOM / MAX_ZOOM / PAGE_GAP are re-exported from _canvas-hooks.ts
const DRAG_THRESHOLD = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nextId(_prefix: string) { return crypto.randomUUID(); }

/** Recursively ensure every node in the tree has a stable `id`. */
function ensureIds(node: SDUINode): SDUINode {
  const result = { ...node };
  if (!result.id) result.id = nextId(result.type.toLowerCase());
  if (result.children?.length) {
    result.children = (result.children as SDUINode[]).map(ensureIds);
  }
  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Node types whose `text` property is directly editable via double-click.
 * Any node type listed here must store its display text on the `text` prop.
 */
const TEXT_NODE_TYPES = new Set([
  'Text', 'Heading',
  'CheckboxLabel', 'RadioLabel',
  'TabTitle', 'AccordionTitle',
  'SelectItem', 'SelectInput',
  'AlertTitle', 'AlertDescription',
  'ToastTitle', 'ToastDescription',
]);


/**
 * Memoized wrapper around SDUIEngine for the active page.
 * Prevents the entire SDUI tree from re-rendering when the canvas pan/zoom/hover
 * state changes — those updates only affect the canvas transforms and overlays,
 * not the page content.
 */
export default function BuilderCanvas() {
  const canvasRef          = useRef<HTMLDivElement>(null);
  const pageFrameRef       = useRef<HTMLDivElement>(null);
  const captureOverlayRef  = useRef<HTMLDivElement>(null);
  // Track the last hovered id so we skip Zustand updates when it hasn't changed.
  const lastHoveredIdRef   = useRef<string | null>(null);
  // Ref populated by BuilderOverlay — call to trigger a burst of measurement ticks.
  const overlayNotifyRef          = useRef<(() => void) | null>(null);
  // Ref populated by BuilderOverlay — synchronous BCR update, zero lag during pan.
  const overlayInstantUpdateRef   = useRef<(() => void) | null>(null);

  // ── Granular store selectors — only re-render when the specific slice changes ──
  const pageNodes = useBuilderStore(s => s.pageNodes);
  const selectedIds = useBuilderStore(s => s.selectedIds);
  const hoveredId = useBuilderStore(s => s.hoveredId);
  const altHoveredId = useBuilderStore(s => s.altHoveredId);
  const altMode = useBuilderStore(s => s.altMode);
  const tool = useBuilderStore(s => s.tool);
  const zoom = useBuilderStore(s => s.zoom);
  const panX = useBuilderStore(s => s.panX);
  const panY = useBuilderStore(s => s.panY);
  const viewport = useBuilderStore(s => s.viewport);
  const gridOverlay = useBuilderStore(s => s.gridOverlay);
  const pages = useBuilderStore(s => s.pages);
  const currentPageId = useBuilderStore(s => s.currentPageId);
  const _focusedPageId = useBuilderStore(s => s.focusedPageId);
  const pendingFitToPage = useBuilderStore(s => s.pendingFitToPage);
  const showInteractionLines = useBuilderStore(s => s.showInteractionLines);
  const activePreviewStates = useBuilderStore(s => s.activePreviewStates);
  const canvasNodes = useBuilderStore(s => s.canvasNodes);
  // Actions (stable references — never trigger re-renders)
  const setZoom = useBuilderStore(s => s.setZoom);
  const setPan = useBuilderStore(s => s.setPan);
  const select = useBuilderStore(s => s.select);
  const hover = useBuilderStore(s => s.hover);
  const setAltMode = useBuilderStore(s => s.setAltMode);
  const setAltHovered = useBuilderStore(s => s.setAltHovered);
  const addSection = useBuilderStore(s => s.addSection);
  const addNode = useBuilderStore(s => s.addNode);
  const moveNode = useBuilderStore(s => s.moveNode);
  const moveNodes = useBuilderStore(s => s.moveNodes);
  const moveNodeFromPage = useBuilderStore(s => s.moveNodeFromPage);
  const patchProp = useBuilderStore(s => s.patchProp);
  const _pushHistory = useBuilderStore(s => s._pushHistory);
  const focusPage = useBuilderStore(s => s.focusPage);
  const movePagePosition = useBuilderStore(s => s.movePagePosition);
  const clearPendingFit = useBuilderStore(s => s.clearPendingFit);
  const setShowInteractionLines = useBuilderStore(s => s.setShowInteractionLines);
  const duplicateNodes = useBuilderStore(s => s.duplicateNodes);
  const deleteNodes = useBuilderStore(s => s.deleteNodes);
  const selectParent = useBuilderStore(s => s.selectParent);
  const selectFirstChild = useBuilderStore(s => s.selectFirstChild);
  const copyToClipboard = useBuilderStore(s => s.copyToClipboard);
  const pasteFromClipboard = useBuilderStore(s => s.pasteFromClipboard);
  const setPreviewState = useBuilderStore(s => s.setPreviewState);
  const openLogicSection = useBuilderStore(s => s.openLogicSection);

  // Use focusedPageId with fallback to currentPageId for backward compat
  const focusedPageId = _focusedPageId || currentPageId;

  // ── Pan / Zoom hook ───────────────────────────────────────────────────────
  const {
    worldRef, gridPatternRef,
    zoomRef, panXRef, panYRef,
    dragRef,
    applyWorldTransform, scheduleStoreSync, fitToCanvas,
  } = useCanvasPanZoom(
    { canvasRef, pageFrameRef, overlayInstantUpdateRef, overlayNotifyRef },
    { zoom, panX, panY, setZoom, setPan, pendingFitToPage, clearPendingFit, pageNodes },
  );

  // Adjust zoom & pan when viewport breakpoint changes — keeps the same
  // visual center instead of jumping to the active/selected page.
  const prevViewportRef = useRef(viewport);
  useEffect(() => {
    if (viewport === prevViewportRef.current) return;
    const oldVp = prevViewportRef.current;
    prevViewportRef.current = viewport;

    const c = canvasRef.current;
    if (!c) return;

    const oldW = VIEWPORT_WIDTHS[oldVp];
    const newW = VIEWPORT_WIDTHS[viewport];
    const oldZ = zoomRef.current;
    const curPX = panXRef.current;
    const curPY = panYRef.current;
    const cW = c.clientWidth;
    const cH = c.clientHeight;

    const newZ = Math.min(cW / newW, cH / VIEWPORT_H) * 0.85;

    // World-space center the user is currently looking at
    const worldCX = (cW / 2 - curPX) / oldZ;
    const worldCY = (cH / 2 - curPY) / oldZ;

    // Pages are laid out horizontally; scale X proportionally for the width change
    const slotRatio = (newW + PAGE_GAP) / (oldW + PAGE_GAP);
    const newWorldCX = worldCX * slotRatio;

    const newPX = cW / 2 - newWorldCX * newZ;
    const newPY = cH / 2 - worldCY * newZ;

    requestAnimationFrame(() => {
      setPan(newPX, newPY);
      setZoom(newZ);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  // Tracks the page a canvas-node drag originated from, so cross-page drops work correctly.
  const dragSourcePageIdRef       = useRef<string | null>(null);

  // ── Selected node rect (for floating toolbar) ─────────────────────────────

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't fire shortcuts when focus is in an input/textarea
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const id = selectedIds[0];

      // Panel tab switching
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'l' || e.key === 'L') {
          window.dispatchEvent(new CustomEvent('builder:open-logic-tab', {}));
          return;
        }
        if (e.key === 'j' || e.key === 'J') {
          window.dispatchEvent(new CustomEvent('builder:open-json-tab', {}));
          return;
        }
        if (e.key === 'd' || e.key === 'D') {
          if (e.shiftKey) return; // Ctrl+D = duplicate
          window.dispatchEvent(new CustomEvent('builder:open-design-tab', {}));
          return;
        }
        // Logic shortcuts
        if (e.key === 'i' || e.key === 'I') { openLogicSection('interactions'); window.dispatchEvent(new CustomEvent('builder:open-logic-tab', { detail: { section: 'interactions' } })); return; }
        if (e.key === 'b' || e.key === 'B') { openLogicSection('binding'); window.dispatchEvent(new CustomEvent('builder:open-logic-tab', { detail: { section: 'binding' } })); return; }
        if (e.key === 'v' || e.key === 'V') { setShowInteractionLines(!showInteractionLines); return; }
        if (e.key === 's' || e.key === 'S') {
          if (e.shiftKey) { window.dispatchEvent(new CustomEvent('builder:open-state-picker', {})); return; }
          const states = ['normal', 'hover', 'loading', 'error', 'empty', 'disabled'];
          const store = useBuilderStore.getState();
          const current = store.activePreviewStates[0] ?? 'normal';
          const idx = states.indexOf(current);
          setPreviewState(states[(idx + 1) % states.length]);
          return;
        }
        // Navigation
        if (e.key === 'Escape' && id) { selectParent(id); return; }
        if (e.key === 'Enter' && id) { selectFirstChild(id); return; }
        // Z-order
        if (e.key === '[') { id && useBuilderStore.getState().moveNodeDown(id); return; }
        if (e.key === ']') { id && useBuilderStore.getState().moveNodeUp(id); return; }
      }

      // With Ctrl/Cmd
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          if (id) duplicateNodes([id]);
          return;
        }
        if (e.key === 'c') { copyToClipboard(); return; }
        if (e.key === 'v') { pasteFromClipboard(); return; }
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0 && !e.ctrlKey && !e.metaKey) {
        deleteNodes(selectedIds);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, showInteractionLines, setShowInteractionLines, duplicateNodes, deleteNodes, selectParent, selectFirstChild, copyToClipboard, pasteFromClipboard, setPreviewState, openLogicSection]);

  // ── World transform helpers ───────────────────────────────────────────────
  //
  // ── Dynamic viewport width ────────────────────────────────────────────────
  const vpWidth = VIEWPORT_WIDTHS[viewport];

  /** Index of the focused page frame (kept for backward-compat with any helpers that need it). */
  const activePageIdx = pages.findIndex(p => p.id === focusedPageId);

  /** Canvas-space left offset of the ACTIVE page frame (world units, used by overlay). */
  const focusedPage = pages.find(p => p.id === focusedPageId);
  const activePanX = panX + (focusedPage?.wx ?? activePageIdx * (vpWidth + PAGE_GAP)) * zoom;

  // ── Absolute-position drag state ─────────────────────────────────────────
  // When dragging a node that has `position: absolute` (or fixed), bypass the
  // normal drop-zone reorder and instead track cursor coords so we can write
  // style.left / style.top on drop.
  //
  // absDragPos state drives the crosshair UI indicator.
  // absDragPosRef is the always-current mirror used by onDrop — React state
  // updates are async so onDrop would read stale null if it used the state
  // value directly (dragover → setAbsDragPos → drop fires before re-render).
  const [absDragPos, setAbsDragPos] = useState<{
    x: number; y: number;             // content-space px (relative to parent or world)
    clientX: number; clientY: number; // screen px for tooltip placement
    isWorldSpace?: boolean;           // true for canvas nodes (use panX, not activePanX)
  } | null>(null);
  const absDragPosRef = useRef<typeof absDragPos>(null);

  // ── Snap guides ───────────────────────────────────────────────────────────
  // Guide lines shown during absolute-node drag and resize.
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  // Page-level snap guides (world coords, rendered without activePanX offset).
  const [pageSnapGuides, setPageSnapGuides] = useState<SnapGuide[]>([]);
  const handlePageDragSnap = useCallback((guides: SnapGuide[], _dragging: boolean) => {
    setPageSnapGuides(guides);
  }, []);

  // ── Marquee selection ─────────────────────────────────────────────────────
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeStartRef = useRef<{ clientX: number; clientY: number } | null>(null);

  // ── Canvas right-click context menu ───────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);

  // ── Transient toast message (auto-dismisses) ─────────────────────────────
  const [canvasToast, setCanvasToast] = useState<string | null>(null);
  const canvasToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showCanvasToast = useCallback((msg: string) => {
    if (canvasToastTimerRef.current) clearTimeout(canvasToastTimerRef.current);
    setCanvasToast(msg);
    canvasToastTimerRef.current = setTimeout(() => setCanvasToast(null), 3000);
  }, []);

  // ── Inline text editing (contentEditable) ────────────────────────────────
  //
  // We edit directly on the rendered DOM element — no floating textarea,
  // no overlap. The element gets contentEditable="true" and a blue outline;
  // blur / Enter commits, Escape restores the original text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingElRef        = useRef<HTMLElement | null>(null);
  const editingOrigText     = useRef<string>('');
  // Saves the element's fixed inline width/height before we release them during editing.
  // Allows the element to grow naturally while the user types, and lets commitInlineEdit
  // persist the new natural size back to props.style.
  const editingOrigStyleRef = useRef<{ width: string; height: string }>({ width: '', height: '' });

  /** Commit: read innerText from the contenteditable element, save, clean up. */
  const commitInlineEdit = useCallback(() => {
    const el = editingElRef.current;
    if (!el || !editingId) return;
    const newText = el.innerText.replace(/\n$/, ''); // strip trailing newline browsers add

    // If the node previously had a fixed width/height (from a resize), read the
    // element's natural size NOW (while style.width is still 'auto') and persist it
    // so the element doesn't snap back to the old smaller dimensions after commit.
    const origStyle = editingOrigStyleRef.current;
    if (origStyle.width || origStyle.height) {
      const r = el.getBoundingClientRect();
      const currentNode = findNode(useBuilderStore.getState().pageNodes, editingId);
      const existingStyle = (currentNode?.props as { style?: Record<string, string> })?.style ?? {};
      const existingCls = (currentNode?.props as { className?: string })?.className ?? '';
      let teCls = existingCls;
      const { width: _w, height: _h, ...teStyle } = existingStyle as Record<string, string>;
      if (origStyle.width) {
        teCls = `${removeTwToken(teCls, 'w-')} w-[${Math.round(r.width)}px]`.trim();
      }
      if (origStyle.height) {
        teCls = `${removeTwToken(removeTwToken(removeTwToken(teCls, 'h-'), 'min-h-'), 'flex-1')} h-[${Math.round(r.height)}px]`.trim();
      }
      patchProp(editingId, 'props.className', teCls);
      patchProp(editingId, 'props.style', teStyle);
    }

    el.contentEditable = 'false';
    el.style.outline   = '';
    el.style.cursor    = '';
    el.style.minWidth  = '';
    el.removeAttribute('data-builder-editing');
    editingElRef.current = null;
    patchProp(editingId, 'text', newText);
    _pushHistory();
    setEditingId(null);
    overlayNotifyRef.current?.();
  }, [editingId, patchProp, _pushHistory]);

  /** Cancel: restore original text and dimensions, clean up without saving. */
  const cancelInlineEdit = useCallback(() => {
    const el = editingElRef.current;
    if (!el) return;
    el.innerText       = editingOrigText.current;
    // Restore the original fixed dimensions that were released on edit start.
    el.style.width     = editingOrigStyleRef.current.width;
    el.style.height    = editingOrigStyleRef.current.height;
    el.style.minWidth  = '';
    el.contentEditable = 'false';
    el.style.outline   = '';
    el.style.cursor    = '';
    el.removeAttribute('data-builder-editing');
    editingElRef.current = null;
    setEditingId(null);
  }, []);

  // Activate contentEditable when editingId is set
  useEffect(() => {
    if (!editingId) return;
    const el = document.querySelector(`[data-builder-id="${editingId}"]`) as HTMLElement | null;
    if (!el) return;

    editingOrigText.current  = el.innerText;
    editingElRef.current     = el;

    // Release any fixed inline width/height so the element can expand as the user
    // types long text. minWidth keeps it from shrinking below its original size.
    editingOrigStyleRef.current = { width: el.style.width, height: el.style.height };
    el.style.width  = 'auto';
    el.style.height = 'auto';
    if (editingOrigStyleRef.current.width) el.style.minWidth = editingOrigStyleRef.current.width;

    el.contentEditable       = 'true';
    el.style.outline         = '2px solid #3b82f6';
    el.style.outlineOffset   = '2px';
    el.style.borderRadius    = '2px';
    el.style.cursor          = 'text';
    el.setAttribute('data-builder-editing', 'true');

    // Focus and select all
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // Prevent paste from inserting HTML — plain text only
    const onPaste = (ev: ClipboardEvent) => {
      ev.preventDefault();
      const text = ev.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text);
    };

    // Enter commits, Escape cancels, prevent Shift+Enter newlines for single-line nodes
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commitInlineEdit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancelInlineEdit(); }
    };

    // Fix 6: commit when clicking outside the editing element.
    // Using document mousedown (not the capture overlay, which has pointerEvents:none
    // during editing) so we catch every click outside, including on the canvas bg.
    const onDocMouseDown = (ev: MouseEvent) => {
      if (el && !el.contains(ev.target as Node)) {
        commitInlineEdit();
      }
    };

    // Fix 7: update selection ring on every keystroke so it expands with the text.
    const onInput = () => {
      overlayInstantUpdateRef.current?.();
    };

    el.addEventListener('paste',   onPaste);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('input',   onInput);
    document.addEventListener('mousedown', onDocMouseDown);
    return () => {
      el.removeEventListener('paste',   onPaste);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('input',   onInput);
      document.removeEventListener('mousedown', onDocMouseDown);
      // Safety restore in case editing ends via an unexpected path (e.g. node deletion)
      el.style.width    = editingOrigStyleRef.current.width;
      el.style.height   = editingOrigStyleRef.current.height;
      el.style.minWidth = '';
    };
  }, [editingId, commitInlineEdit, cancelInlineEdit]);

  // Fix 8: expose overlayInstantUpdateRef to _panel-right.tsx via store callback.
  // This lets the right panel trigger an immediate ring update after a style DOM
  // patch without going through Zustand state (zero re-renders during rapid input).
  useEffect(() => {
    useBuilderStore.getState()._setOverlayUpdateCallback(() => overlayInstantUpdateRef.current?.());
    return () => useBuilderStore.getState()._setOverlayUpdateCallback(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the last page frame hovered during a panel drag (prevents redundant focusPage calls)
  const lastDragHoverPageRef = useRef<string | null>(null);

  // zoomRef, panXRef, panYRef and their sync effect are now owned by useCanvasPanZoom.

  // ── Drop state ────────────────────────────────────────────────────────────

  const [isDroppingVariant, setIsDroppingVariant] = React.useState(false);
  /**
   * Canvas-div-relative Y (px) of the active insert-line indicator.
   * Used for column/vertical containers. null = hidden.
   */
  const [dropLineY, setDropLineY] = React.useState<number | null>(null);
  /**
   * Canvas-div-relative X (px) of the active insert-line indicator.
   * Used for row/horizontal containers (HStack, Box with flex-row). null = hidden.
   */
  const [dropLineX, setDropLineX] = React.useState<number | null>(null);
  /** ID of the container node being targeted for "drop inside" (shows blue border) */
  const [dropContainerId, setDropContainerId]       = React.useState<string | null>(null);

  /** ID of the canvas node currently being dragged (null = dragging from panel) */
  const draggingNodeIdRef = useRef<string | null>(null);

  /** True when the node being dragged is a freeform canvas node (not inside a page). */
  const draggingCanvasNodeRef = useRef(false);

  /** Tracks whether a canvas node is currently being dragged (drives overlay hide). */
  const [isDragging, setIsDragging] = React.useState(false);

  /**
   * The DOM elements faded out at drag-start (one per selected node for multi-drag).
   * Stored separately from draggingNodeIdRef so opacity can always be restored
   * even when draggingNodeIdRef is cleared early (e.g. onDrop clears it before
   * onDragEnd fires on a successful drop).
   */
  const draggedElRef = useRef<HTMLElement[]>([]);

  /**
   * All node IDs being dragged (equals selectedIds when all are selected and one
   * is grabbed; equals [dragId] for single-node drags).
   */
  const multiDragIdsRef = useRef<string[]>([]);

  /**
   * When dragging an absolute-positioned node, record WHERE inside the element
   * the user grabbed (screen-px offset from the element's top-left).  Subtracting
   * this from the drop clientX/clientY keeps the element under the cursor instead
   * of jumping its top-left to the cursor position.
   */
  const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /**
   * Snap stickiness — Figma-style hysteresis.
   *
   * When a snap fires on an axis the snapped position is stored here.
   * On subsequent drag-over events the element stays "glued" to that position
   * until the cursor travels more than SNAP_STICKY_RELEASE content-px away from
   * the snap target.  This lets the user linger on the alignment without the
   * node jumping away the instant they overshoot by a single pixel.
   */
  const stickySnapRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });

  /**
   * Original inline style recorded at drag-start for absolute nodes.
   * Used to revert the element's position when the drag is cancelled (no drop).
   */
  const dragStartStyleRef = useRef<{ left: string; top: string } | null>(null);

  /**
   * Ancestors whose overflow was temporarily set to 'visible' during absolute-node
   * drag so the node is not clipped when it crosses container boundaries.
   * Each entry stores the element and its original overflow value for restoration.
   */
  const overflowPatchedRef = useRef<{ el: HTMLElement; orig: string }[]>([]);

  /**
   * Floating ghost clone shown when an absolute node is dragged outside the page.
   * The real element stays clipped inside the page frame; this clone follows the
   * cursor in world space so the user has visual feedback.
   */
  const absGhostRef = useRef<{ clone: HTMLElement; w: number; h: number } | null>(null);

  /**
   * The in-page element hidden (opacity:0) while the floating ghost is visible
   * outside the page. Stored so we can restore opacity on cleanup.
   */
  const absHiddenElRef = useRef<HTMLElement | null>(null);

  /**
   * Computed target for the next drop: where in the tree to insert.
   * Kept in a ref so onDrop can read the latest value without re-creating handlers.
   */
  const dropTargetRef = useRef<{ parentId: string | null; index: number } | null>(null);

  // ── Pan drag ──────────────────────────────────────────────────────────────
  // dragRef is owned by useCanvasPanZoom; accessed via destructured return above.

  // pageNodes change / pendingFitToPage effects are now handled by useCanvasPanZoom.

  // ── Build SDUI config ────────────────────────────────────────────────────

  // Apply state-tag-based show/hide overrides when loading/empty/disabled is active.
  // This produces a display-only clone of the node tree — pageNodes is never mutated.
  // displayNodes, pageConfig and previewActionsConfig removed — SDUI rendering for ALL pages
  // (including the focused page) is now handled by AllPagesGrid in _canvas-helpers.tsx.

  // Wheel handler (zoom + pan) is registered by useCanvasPanZoom.

  // ── Hit-test (must be defined before pointer handlers) ───────────────────

  /**
   * Returns all elements at (clientX, clientY), filters out our own overlay
   * UI, then finds the nearest SDUI node with [data-builder-id].
   *
   * Uses document.elementsFromPoint (plural) — pointer-events:none does NOT
   * affect elementFromPoint/elementsFromPoint so we filter manually instead.
   */
  const hitTest = useCallback((clientX: number, clientY: number) => {
    const capOverlay = captureOverlayRef.current;
    const all = document.elementsFromPoint(clientX, clientY) as HTMLElement[];

    const checkElements = (elements: HTMLElement[]) => {
      for (const el of elements) {
        if (el === capOverlay || capOverlay?.contains(el)) continue;
        if (el.hasAttribute('data-builder-overlay') || el.closest('[data-builder-overlay]')) continue;
        // Skip the inactive-frame click catchers
        if (el.hasAttribute('data-builder-inactive-frame') || el.closest('[data-builder-inactive-frame]')) continue;
        if (el.hasAttribute('data-builder-canvas-overlay') || el.closest('[data-builder-canvas-overlay]')) continue;

        const builderEl = el.hasAttribute('data-builder-id')
          ? el
          : (el.closest('[data-builder-id]') as HTMLElement | null);

        if (builderEl?.dataset.builderId) {
          const bid = builderEl.dataset.builderId;
          // Use DOM-order index among all elements sharing this builder-id.
          // data-builder-map-index only carries the innermost repeat index,
          // which isn't unique with nested repeats. DOM order is always unique.
          const allWithId = document.querySelectorAll(`[data-builder-id="${bid}"]`);
          let mapIndex = 0;
          for (let i = 0; i < allWithId.length; i++) {
            if (allWithId[i] === builderEl) { mapIndex = i; break; }
          }
          return { id: bid, mapIndex };
        }
      }
      return null;
    };

    const found = checkElements(all);
    if (found) return { kind: 'node' as const, id: found.id, mapIndex: found.mapIndex };

    // At very low zoom, elements may be sub-pixel — expand the hit radius to
    // cover ~3 logical pixels in screen space so clicks still register.
    const liveZ = zoomRef.current;
    if (liveZ < 0.12) {
      const r = Math.ceil(3 / liveZ);
      const offsets: [number, number][] = [[-r,0],[r,0],[0,-r],[0,r],[-r,-r],[r,-r],[-r,r],[r,r]];
      for (const [dx, dy] of offsets) {
        const nearby = document.elementsFromPoint(clientX + dx, clientY + dy) as HTMLElement[];
        const nearbyFound = checkElements(nearby);
        if (nearbyFound) return { kind: 'node' as const, id: nearbyFound.id, mapIndex: nearbyFound.mapIndex };
      }
    }

    return { kind: 'empty' as const };
  }, []);

  // ── Pointer: pan drag + click-to-select ──────────────────────────────────
  //
  // IMPORTANT: setPointerCapture is only called when the user is actually
  // panning. Calling it on every left-click intercepts the subsequent `click`
  // event (routing it to the canvas div instead of the capture overlay) and
  // breaks the capture overlay's onClick handler entirely.
  //
  // Selection is handled entirely in onPointerUp so it works regardless of
  // pointer capture state.

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Don't start canvas drag when clicking the floating toolbar or overflow menu —
    // those bubbled pointer events would otherwise deselect the node.
    if ((e.target as Element).closest('[data-floating-toolbar]') ||
        (e.target as Element).closest('[data-more-menu]')) {
      return;
    }
    // Don't start canvas drag/marquee when dragging a page title label.
    // mousedown stopPropagation cannot cancel pointer events (they are a separate
    // event type), so we guard explicitly here.
    if ((e.target as Element).closest('[data-builder-page-label]')) return;
    const isPan = e.button === 1 || tool === 'hand';
    if (!isPan && e.button !== 0) return;
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, startPX: panXRef.current, startPY: panYRef.current, moved: false };
    if (isPan) {
      // Only capture for panning — capturing on normal left-click swallows the
      // subsequent click event before the capture overlay's onClick can fire.
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (e.button === 0 && tool === 'select') {
      // Check if pointer is on empty canvas area → start marquee selection.
      // hitTest skips the overlay and finds underlying SDUI nodes, so 'empty'
      // genuinely means no node at this position.
      const hit = hitTest(e.clientX, e.clientY);
      if (hit.kind === 'empty') {
        // Don't start marquee when the cursor is inside the selection bounding box —
        // clicking there means the user intends to drag the selected nodes.
        // Use the UNION bounding rect of all selected nodes, not individual rects,
        // because the selection box drawn by the overlay covers the whole union area
        // (including gaps between nodes and the border itself).
        const selIds = useBuilderStore.getState().selectedIds;
        let inSelectionBox = false;
        if (selIds.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const id of selIds) {
            const el = document.querySelector(`[data-builder-id="${id}"]`);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (r.left   < minX) minX = r.left;
            if (r.top    < minY) minY = r.top;
            if (r.right  > maxX) maxX = r.right;
            if (r.bottom > maxY) maxY = r.bottom;
          }
          inSelectionBox = e.clientX >= minX && e.clientX <= maxX &&
                           e.clientY >= minY && e.clientY <= maxY;
        }
        if (!inSelectionBox) {
          marqueeStartRef.current = { clientX: e.clientX, clientY: e.clientY };
        }
      }
    }
  }, [tool, hitTest]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;

    // Marquee drag — update dimensions
    if (marqueeStartRef.current) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cr = canvas.getBoundingClientRect();
      const sx = marqueeStartRef.current.clientX - cr.left;
      const sy = marqueeStartRef.current.clientY - cr.top;
      const cx = e.clientX - cr.left;
      const cy = e.clientY - cr.top;
      setMarquee({ x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) });
      return;
    }

    if (tool === 'hand' || e.buttons === 4) {
      // Start capturing now that we confirmed it's a pan drag
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      const newPX = d.startPX + dx;
      const newPY = d.startPY + dy;
      panXRef.current = newPX;
      panYRef.current = newPY;
      applyWorldTransform(newPX, newPY, zoomRef.current);
      scheduleStoreSync(newPX, newPY, zoomRef.current);
    }
  }, [tool, setPan]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;

    // ── Marquee: finish selection ────────────────────────────────────────────
    if (marqueeStartRef.current) {
      const canvas = canvasRef.current;
      if (canvas && marquee) {
        const cr = canvas.getBoundingClientRect();
        // Normalise marquee to absolute client rect
        const mx1 = cr.left + Math.min(marquee.x, marquee.x + marquee.w);
        const mx2 = cr.left + Math.max(marquee.x, marquee.x + marquee.w);
        const my1 = cr.top  + Math.min(marquee.y, marquee.y + marquee.h);
        const my2 = cr.top  + Math.max(marquee.y, marquee.y + marquee.h);

        const matched: string[] = [];
        document.querySelectorAll('[data-builder-id]').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.left < mx2 && r.right > mx1 && r.top < my2 && r.bottom > my1) {
            const id = (el as HTMLElement).dataset.builderId;
            if (id) matched.push(id);
          }
        });
        if (matched.length) {
          matched.forEach((id, i) => select(id, i > 0));
        } else {
          select(null);
        }
      } else {
        // Click on empty canvas with no drag movement → deselect
        select(null);
      }
      marqueeStartRef.current = null;
      setMarquee(null);
      dragRef.current.active = false;
      return;
    }

    if (d.active && !d.moved) {
      const insideAnyPage = (e.target as Element).closest('[data-builder-page-id]');
      const insideToolbar = (e.target as Element).closest('[data-floating-toolbar]') ||
                            (e.target as Element).closest('[data-more-menu]');
      if (insideAnyPage) {
        const hit = hitTest(e.clientX, e.clientY);
        if (hit.kind === 'node') {
          // If this node lives on a different page, auto-switch to it first
          const nodeEl = document.querySelector(`[data-builder-id="${hit.id}"]`);
          const pageEl = nodeEl?.closest('[data-builder-page-id]') as HTMLElement | null;
          const nodePageId = pageEl?.dataset.builderPageId;
          if (nodePageId && nodePageId !== (useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId)) {
            focusPage(nodePageId);
          }
          select(hit.id, e.shiftKey || e.metaKey, hit.mapIndex);
        } else {
          // Clicked empty space inside any page → just switch focus if needed
          const clickedPageEl = (e.target as Element).closest('[data-builder-page-id]') as HTMLElement | null;
          const pageId = clickedPageEl?.dataset.builderPageId;
          if (pageId && pageId !== (useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId)) {
            focusPage(pageId);
          }
          select(null);
        }
      } else if (!insideToolbar) {
        const insideCanvasNode = (e.target as Element).closest('[data-builder-canvas-node]');
        if (!insideCanvasNode) {
        select(null);
        }
      }
    }
    dragRef.current.active = false;
  }, [hitTest, select, marquee, focusPage]);

  // ── Capture overlay hover ─────────────────────────────────────────────────

  const handleOverlayMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    const id = hit.kind === 'node' ? hit.id : null;
    // Skip the Zustand update when the hovered node hasn't changed — avoids a
    // full BuilderCanvas re-render on every pixel of mouse movement.
    const mapIndex = hit.kind === 'node' ? hit.mapIndex : undefined;
    if (id !== lastHoveredIdRef.current) {
      lastHoveredIdRef.current = id;
      hover(id, mapIndex);
      if (altMode) setAltHovered(id);
      overlayNotifyRef.current?.();
    }
  }, [hitTest, hover, altMode, setAltHovered]);

  const handleOverlayMouseLeave = useCallback(() => {
    lastHoveredIdRef.current = null;
    hover(null);
    setAltHovered(null);
  }, [hover, setAltHovered]);

  // ── Alt key ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltMode(true); };
    const up   = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltMode(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup',   up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [setAltMode]);

  // ── Drag-over: drop zone ─────────────────────────────────────────────────

  /**
   * Finds the deepest [data-builder-id] element at (clientX, clientY),
   * filtering out the capture overlay and any overlay decorations.
   */
  const findBuilderElAt = useCallback((clientX: number, clientY: number): HTMLElement | null => {
    const capOverlay = captureOverlayRef.current;
    const all = document.elementsFromPoint(clientX, clientY) as HTMLElement[];
    for (const el of all) {
      if (el === capOverlay || capOverlay?.contains(el)) continue;
      if (el.hasAttribute('data-builder-overlay') || el.closest('[data-builder-overlay]')) continue;
      if (el.hasAttribute('data-builder-inactive-frame') || el.closest('[data-builder-inactive-frame]')) continue;
      if (el.hasAttribute('data-builder-canvas-overlay') || el.closest('[data-builder-canvas-overlay]')) continue;
      const candidate = el.hasAttribute('data-builder-id')
        ? el
        : (el.closest('[data-builder-id]') as HTMLElement | null);
      if (candidate) return candidate;
    }
    return null;
  }, []);

  /**
   * Like findBuilderElAt but skips any node whose ID is in `skipIds`.
   * Used during drag-over so the dragged node (opacity 0.3, still in DOM)
   * doesn't block hit-testing of the container it lives in.
   */
  const findDropTargetElAt = useCallback((
    clientX: number,
    clientY: number,
    skipIds: Set<string>,
    anyPage = false,
  ): HTMLElement | null => {
    const capOverlay = captureOverlayRef.current;
    const all = document.elementsFromPoint(clientX, clientY) as HTMLElement[];
    const activePgId = useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId;
    for (const el of all) {
      if (el === capOverlay || capOverlay?.contains(el)) continue;
      if (el.hasAttribute('data-builder-overlay') || el.closest('[data-builder-overlay]')) continue;
      // Skip inactive page overlays so we can hit-test nodes underneath during cross-page drag
      if (el.hasAttribute('data-builder-inactive-overlay') || el.closest('[data-builder-inactive-overlay]')) continue;
      // Skip canvas node capture overlays
      if (el.hasAttribute('data-builder-canvas-overlay') || el.closest('[data-builder-canvas-overlay]')) continue;
      const builderEl = el.hasAttribute('data-builder-id')
        ? el
        : (el.closest('[data-builder-id]') as HTMLElement | null);
      if (!builderEl) continue;
      if (skipIds.has(builderEl.dataset.builderId ?? '')) continue;
      const pageFrame = builderEl.closest('[data-builder-page-id]') as HTMLElement | null;
      if (!anyPage && pageFrame && pageFrame.dataset.builderPageId !== activePgId) continue;
      return builderEl;
    }
    return null;
  }, []);

  /** Find a node across ALL pages' node trees (not just the focused page's pageNodes). */
  function findNodeAcrossPages(nodeId: string): SDUINode | null {
    const s = useBuilderStore.getState();
    const inFocused = findNode(s.pageNodes as SDUINode[], nodeId);
    if (inFocused) return inFocused;
    for (const pg of s.pages) {
      if (pg.id === s.focusedPageId) continue;
      const found = findNode(pg.nodes as SDUINode[], nodeId);
      if (found) return found;
    }
    return null;
  }

  /** Like findParentNode but searches across ALL pages. */
  function findParentAcrossPages(nodeId: string): SDUINode | null {
    const s = useBuilderStore.getState();
    const inFocused = findParentNode(s.pageNodes as SDUINode[], nodeId);
    if (inFocused) return inFocused;
    for (const pg of s.pages) {
      if (pg.id === s.focusedPageId) continue;
      const found = findParentNode(pg.nodes as SDUINode[], nodeId);
      if (found) return found;
    }
    return null;
  }

  /** Get the root-level siblings list for a node, searching all pages. */
  function getRootSiblingsForNode(nodeId: string): SDUINode[] {
    const s = useBuilderStore.getState();
    const parent = findParentAcrossPages(nodeId);
    if (parent) return (parent.children ?? []) as SDUINode[];
    for (const pg of s.pages) {
      if ((pg.nodes as SDUINode[]).some(n => n.id === nodeId)) return pg.nodes as SDUINode[];
    }
    return s.pageNodes as SDUINode[];
  }

  /**
   * Nearest-gap algorithm: given a list of siblings (at any nesting level) and
   * the current cursor Y (screen px), find the closest insert position and
   * return both the index and the canvas-div-relative Y for the drop line.
   *
   * Boundary rules (so first/last positions are always reachable):
   *  - Gap 0 (before first): gapMid = first node's top
   *  - Gap N (after last):   gapMid = last node's bottom
   *  - Inner gaps:           gapMid = (prevEl.bottom + nextEl.top) / 2
   */
  function nearestGap(
    siblings: SDUINode[],
    cursorY: number,
    canvasEl: HTMLElement,
    canvasRect: DOMRect,
  ): { insertIdx: number; lineY: number } {
    let insertIdx = siblings.length;
    let lineY     = panYRef.current;
    let minDist   = Infinity;

    for (let gi = 0; gi <= siblings.length; gi++) {
      const prevEl = gi > 0
        ? canvasEl.querySelector(`[data-builder-id="${siblings[gi - 1].id}"]`)
        : null;
      const nextEl = gi < siblings.length
        ? canvasEl.querySelector(`[data-builder-id="${siblings[gi].id}"]`)
        : null;
      const rawPrevBottom = prevEl?.getBoundingClientRect().bottom;
      const rawNextTop    = nextEl?.getBoundingClientRect().top;
      // Symmetric fallback keeps boundaries reachable
      const prevBottom = rawPrevBottom ?? rawNextTop ?? (canvasRect.top + panYRef.current);
      const nextTop    = rawNextTop    ?? rawPrevBottom ?? (canvasRect.top + panYRef.current);
      const gapMid = (prevBottom + nextTop) / 2;
      const dist   = Math.abs(cursorY - gapMid);
      if (dist < minDist) {
        minDist   = dist;
        insertIdx = gi;
        // Line sits at the actual boundary between the two elements
        lineY = (rawPrevBottom ?? rawNextTop ?? (canvasRect.top + panYRef.current)) - canvasRect.top;
      }
    }
    return { insertIdx, lineY };
  }

  /**
   * Returns true when a node lays out its children horizontally (flex-row).
   * Checks the component type (HStack) and the className for `flex-row`.
   */
  function isRowContainer(node: SDUINode | null | undefined): boolean {
    if (!node) return false;
    if (node.type === 'HStack') return true;
    const cls = (node.props as Record<string, unknown> | undefined)?.className as string | undefined;
    return !!(cls && cls.includes('flex-row'));
  }

  /**
   * Nearest-gap algorithm for HORIZONTAL containers (HStack / Box flex-row).
   * Uses cursor X and sibling left/right bounds instead of Y / top/bottom.
   */
  function nearestGapH(
    siblings: SDUINode[],
    cursorX: number,
    canvasEl: HTMLElement,
    canvasRect: DOMRect,
  ): { insertIdx: number; lineX: number } {
    let insertIdx = siblings.length;
    let lineX     = panXRef.current ?? 0;
    let minDist   = Infinity;

    for (let gi = 0; gi <= siblings.length; gi++) {
      const prevEl = gi > 0
        ? canvasEl.querySelector(`[data-builder-id="${siblings[gi - 1].id}"]`)
        : null;
      const nextEl = gi < siblings.length
        ? canvasEl.querySelector(`[data-builder-id="${siblings[gi].id}"]`)
        : null;
      const rawPrevRight = prevEl?.getBoundingClientRect().right;
      const rawNextLeft  = nextEl?.getBoundingClientRect().left;
      const prevRight = rawPrevRight ?? rawNextLeft ?? (canvasRect.left + (panXRef.current ?? 0));
      const nextLeft  = rawNextLeft  ?? rawPrevRight ?? (canvasRect.left + (panXRef.current ?? 0));
      const gapMid = (prevRight + nextLeft) / 2;
      const dist   = Math.abs(cursorX - gapMid);
      if (dist < minDist) {
        minDist   = dist;
        insertIdx = gi;
        lineX = (rawPrevRight ?? rawNextLeft ?? (canvasRect.left + (panXRef.current ?? 0))) - canvasRect.left;
      }
    }
    return { insertIdx, lineX };
  }

  /**
   * Collect all sibling rects inside `parentEl` (excluding `excludeId`),
   * converted to content space (divided by zoom).
   */
  /** Restore all overflow values patched during absolute-node drag. */
  function restoreOverflowPatches() {
    for (const { el, orig } of overflowPatchedRef.current) {
      el.style.overflow = orig;
    }
    overflowPatchedRef.current = [];
  }

  /** Remove the floating ghost clone and restore the hidden in-page element. */
  function removeAbsGhost() {
    if (absGhostRef.current) {
      absGhostRef.current.clone.remove();
      absGhostRef.current = null;
    }
    if (absHiddenElRef.current) {
      absHiddenElRef.current.style.opacity = '';
      absHiddenElRef.current = null;
    }
  }

  /**
   * Set overflow:visible on all positioned ancestors between the node and the page
   * frame so the absolute node is never clipped during drag. Records originals for
   * restoration via restoreOverflowPatches().
   */
  function patchAncestorOverflow(nodeEl: HTMLElement) {
    restoreOverflowPatches();
    let el: HTMLElement | null = nodeEl.parentElement;
    while (el) {
      // Stop BEFORE page frames — the page frame's overflow:hidden must stay
      // so the dragged element doesn't visually escape onto the side panels.
      if (el.hasAttribute('data-builder-page-frame')) break;
      const cs = getComputedStyle(el);
      if (cs.overflow !== 'visible') {
        overflowPatchedRef.current.push({ el, orig: el.style.overflow });
        el.style.overflow = 'visible';
      }
      el = el.parentElement;
    }
  }

  const HAS_POSITION_RE = /\b(relative|absolute|fixed|sticky)\b/;

  /**
   * Ensure a parent container has `position: relative` so that CSS left/top
   * on an absolute child resolve against it.  Skips if the parent already has
   * any CSS position keyword, or if parentId is null (page frame root).
   */
  function ensureParentRelative(parentId: string | null) {
    if (!parentId) return;
    const parentNode = findNode(useBuilderStore.getState().pageNodes as SDUINode[], parentId);
    if (!parentNode) return;
    const parentCls = (parentNode.props as { className?: string })?.className ?? '';
    if (!HAS_POSITION_RE.test(parentCls)) {
      patchProp(parentId, 'props.className', `relative ${parentCls}`.trim());
    }
  }

  function getAllSiblingRects(excludeId: string, parentEl: HTMLElement, z: number): ContentRect[] {
    const pr = parentEl.getBoundingClientRect();
    const pcs = getComputedStyle(parentEl);
    // Absolute elements position against the padding box (inner border edge).
    // Only subtract border width, never padding.
    const pBdrL = parseFloat(pcs.borderLeftWidth) || 0;
    const pBdrT = parseFloat(pcs.borderTopWidth)  || 0;
    const rects: ContentRect[] = [];

    const parentBuilderId = parentEl.dataset?.builderId ?? null;
    let siblingIds: string[] = [];
    if (parentBuilderId) {
      const parentNode = findNodeAcrossPages(parentBuilderId);
      if (parentNode?.children) {
        siblingIds = (parentNode.children as SDUINode[])
          .map(c => c.id).filter((id): id is string => !!id && id !== excludeId);
      }
    } else {
      const s = useBuilderStore.getState();
      const pageId = parentEl.dataset?.builderPageId;
      let nodes: SDUINode[] = s.pageNodes as SDUINode[];
      if (pageId && pageId !== s.focusedPageId) {
        const pg = s.pages.find(p => p.id === pageId);
        if (pg) nodes = pg.nodes as SDUINode[];
      }
      siblingIds = nodes
        .map(c => c.id).filter((id): id is string => !!id && id !== excludeId);
    }

    for (const id of siblingIds) {
      const el = parentEl.querySelector<HTMLElement>(`[data-builder-id="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rects.push({
        id,
        x: (r.left - pr.left) / z - pBdrL,
        y: (r.top  - pr.top)  / z - pBdrT,
        w: r.width  / z,
        h: r.height / z,
      });
    }

    // Parent's padding-box as a snap target (the full area absolute children
    // can position within).
    const pBdrR = parseFloat(pcs.borderRightWidth)  || 0;
    const pBdrB = parseFloat(pcs.borderBottomWidth) || 0;
    const parentW = pr.width  / z - pBdrL - pBdrR;
    const parentH = pr.height / z - pBdrT - pBdrB;
    if (parentW > 0 && parentH > 0) {
      rects.push({ id: '__parent__', x: 0, y: 0, w: parentW, h: parentH });
    }

    return rects;
  }

  const onDragOver = useCallback((e: React.DragEvent) => {
    const hasData = e.dataTransfer.types.includes('text/variant-id') ||
                    e.dataTransfer.types.includes('text/primitive-node') ||
                    e.dataTransfer.types.includes('text/canvas-node-id') ||
                    // In CDP-simulated drags (e.g. Playwright) dataTransfer.types is
                    // empty; treat as a canvas-node move when a node is already active,
                    // or as a primitive drop when the panel set the global fallback.
                    !!draggingNodeIdRef.current ||
                    !!(window as unknown as Record<string, unknown>).__primitiveDrag;
    if (!hasData) return;
    e.preventDefault();
    const isCanvasMove = e.dataTransfer.types.includes('text/canvas-node-id') || !!draggingNodeIdRef.current;
    e.dataTransfer.dropEffect = isCanvasMove ? 'move' : 'copy';
    setIsDroppingVariant(true);

    // ── Track hovered page during drag — only update blue outline imperatively ──
    // Do NOT call focusPage here — it would re-render at 60fps
    // on every dragover (60+ fps) which causes severe lag during cross-page drags.
    // The actual focusPage is deferred to onDrop where it fires exactly once.
    {
      const els = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[];
      for (const el of els) {
        const pgEl = el.closest('[data-builder-page-id]') as HTMLElement | null;
        if (pgEl?.dataset.builderPageId) {
          const hovPageId = pgEl.dataset.builderPageId;
          if (hovPageId !== lastDragHoverPageRef.current) {
            // Remove blue border from the previous page
            if (lastDragHoverPageRef.current) {
              const prevFrame = document.querySelector(`[data-builder-page-id="${lastDragHoverPageRef.current}"]`) as HTMLElement | null;
              if (prevFrame) prevFrame.style.outline = '';
            }
            lastDragHoverPageRef.current = hovPageId;
            // Add blue border to the new hovered page (cheap DOM write, no re-render)
            const hovFrame = document.querySelector(`[data-builder-page-id="${hovPageId}"]`) as HTMLElement | null;
            if (hovFrame) hovFrame.style.outline = '2px solid rgba(59,130,246,0.7)';
          }
          break;
        }
      }
    }

    // ── Absolute node / canvas node: free-form positioning, skip drop-zone logic ──
    // Exception 1: multi-drag — when multiple nodes are selected and dragged
    // together, ALL must move as a flow group (absolute path only moves one node).
    // Exception 2: reparenting — if cursor is over a DIFFERENT container, fall
    // through to normal flow-drop so the node can be reparented.
    const draggingId = draggingNodeIdRef.current;
    const isCanvasNodeDrag = draggingCanvasNodeRef.current;
    // Compute multiDrag set early so the absolute-path check can use it.
    const earlyAllDraggingIds = multiDragIdsRef.current.length > 0
      ? multiDragIdsRef.current
      : (draggingId ? [draggingId] : []);
    if (draggingId) {
      let draggedNode = findNode(useBuilderStore.getState().pageNodes, draggingId);
      if (!draggedNode) {
        const allPages = useBuilderStore.getState().pages as { nodes: SDUINode[] }[];
        for (const pg of allPages) {
          draggedNode = findNode(pg.nodes, draggingId);
          if (draggedNode) break;
        }
      }
      const cls = (draggedNode?.props as { className?: string })?.className ?? '';
      const isAbsPos = isCanvasNodeDrag || /\babsolute\b/.test(cls) || /\bfixed\b/.test(cls);
      // Only use the absolute-positioning path for single-node drags.
      // For multi-drags the flow-drop path handles all nodes together.
      if (isAbsPos && earlyAllDraggingIds.length <= 1) {
        const absCanvas = canvasRef.current;
        const absRect   = absCanvas?.getBoundingClientRect();
        if (absCanvas && absRect) {
          // ── Canvas node: position relative to world container ──────────────
          if (isCanvasNodeDrag) {
            const cnWrapper = document.querySelector(`[data-builder-canvas-node="${draggingId}"]`) as HTMLElement | null;
            // Keep wrapper non-interactive during entire drag so hit-testing goes through to page elements
            if (cnWrapper) cnWrapper.style.pointerEvents = 'none';

            const topEl = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
            const overPage = !!topEl?.closest('[data-builder-page-id]');

            // Always move the wrapper to follow the cursor (acts as visual ghost)
            const wEl = worldRef.current;
            if (wEl && cnWrapper) {
              const wr = wEl.getBoundingClientRect();
              const z = zoomRef.current;
              const grab = grabOffsetRef.current;
              const followX = Math.round((e.clientX - wr.left - grab.x) / z);
              const followY = Math.round((e.clientY - wr.top  - grab.y) / z);
              cnWrapper.style.left = `${followX}px`;
              cnWrapper.style.top  = `${followY}px`;
              cnWrapper.style.opacity = overPage ? '0.45' : '';
            }

            if (overPage) {
              absDragPosRef.current = null;
              setAbsDragPos(null);
              setSnapGuides([]);
              stickySnapRef.current = { x: null, y: null };
              // Don't return — fall through to flow-based drop logic below
            } else {
            if (!wEl) return;
            const wr = wEl.getBoundingClientRect();
            const z = zoomRef.current;
            const grab = grabOffsetRef.current;
            const rawX = Math.round((e.clientX - wr.left - grab.x) / z);
            const rawY = Math.round((e.clientY - wr.top  - grab.y) / z);

            // Build snap siblings from other canvas nodes + page frame edges.
            const canvasNs = useBuilderStore.getState().canvasNodes as { id: string; _cx: number; _cy: number }[];
            const siblings: ContentRect[] = [];
            for (const cn of canvasNs) {
              if (cn.id === draggingId) continue;
              const wrapper = document.querySelector(`[data-builder-canvas-node="${cn.id}"]`) as HTMLElement | null;
              if (!wrapper) continue;
              const r = wrapper.getBoundingClientRect();
              siblings.push({
                id: cn.id,
                x: cn._cx,
                y: cn._cy,
                w: r.width / z,
                h: r.height / z,
              });
            }
            // Page frames as snap targets
            const pageFrames = wEl.querySelectorAll<HTMLElement>('[data-builder-page-id]');
            for (const pf of pageFrames) {
              const r = pf.getBoundingClientRect();
              siblings.push({
                id: pf.dataset.builderPageId ?? 'page',
                x: (r.left - wr.left) / z,
                y: (r.top  - wr.top)  / z,
                w: r.width  / z,
                h: r.height / z,
              });
            }

            const nodeW = cnWrapper ? cnWrapper.getBoundingClientRect().width  / z : 0;
            const nodeH = cnWrapper ? cnWrapper.getBoundingClientRect().height / z : 0;

            const SNAP_STICKY_RELEASE = SNAP_THRESHOLD * 2;
            const sticky = stickySnapRef.current;
            let effectiveX = rawX;
            let effectiveY = rawY;
            if (sticky.x !== null) {
              if (Math.abs(rawX - sticky.x) <= SNAP_STICKY_RELEASE) effectiveX = sticky.x;
              else sticky.x = null;
            }
            if (sticky.y !== null) {
              if (Math.abs(rawY - sticky.y) <= SNAP_STICKY_RELEASE) effectiveY = sticky.y;
              else sticky.y = null;
            }

            const dragged: ContentRect = { id: draggingId, x: effectiveX, y: effectiveY, w: nodeW, h: nodeH };
            const { x, y, guides } = computeSnap(dragged, siblings);

            if (x !== effectiveX) sticky.x = x;
            if (y !== effectiveY) sticky.y = y;

            setSnapGuides(guides);

            if (cnWrapper) {
              cnWrapper.style.left = `${x}px`;
              cnWrapper.style.top  = `${y}px`;
            }

            const pos = { x, y, clientX: e.clientX, clientY: e.clientY, isWorldSpace: true };
            absDragPosRef.current = pos;
            setAbsDragPos(pos);

            setDropLineY(null);
            setDropLineX(null);
            setDropContainerId(null);
            return;
            }
          }

          // ── In-page absolute node positioning ─────────────────────────────
          if (!isCanvasNodeDrag) {

          // ── Ghost clone is identity-free (sanitized at creation) ──────────
          // No display toggling needed — the ghost has no data-builder-* attrs,
          // so elementFromPoint / findDropTargetElAt / querySelector never match it.
          const agClone = absGhostRef.current;

          // Temporarily hide the real in-page element from hit-testing so
          // elementFromPoint finds the page frame underneath, not the node itself.
          const nodeEl = document.querySelector(`[data-builder-id="${draggingId}"]`) as HTMLElement | null;
          if (nodeEl) nodeEl.style.pointerEvents = 'none';
          const elUnder = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
          if (nodeEl) nodeEl.style.pointerEvents = '';
          const overPageEl = elUnder?.closest('[data-builder-page-id]') as HTMLElement | null;
          const overAnyPage = !!overPageEl;
          const overPageId = overPageEl?.dataset.builderPageId ?? null;
          const srcPageId = dragSourcePageIdRef.current
            ?? useBuilderStore.getState().focusedPageId
            ?? useBuilderStore.getState().currentPageId;
          const isCrossPageDrag = overAnyPage && overPageId !== srcPageId;

          if (!overAnyPage) {
            // Outside all pages — position the ghost at cursor, hide in-page element.
            if (nodeEl && absHiddenElRef.current !== nodeEl) {
              nodeEl.style.opacity = '0';
              absHiddenElRef.current = nodeEl;
            }
            if (agClone) {
              const wEl = worldRef.current;
              if (wEl) {
                const wr = wEl.getBoundingClientRect();
                const z = zoomRef.current;
                const grab = grabOffsetRef.current;
                agClone.clone.style.left = `${Math.round((e.clientX - wr.left - grab.x) / z)}px`;
                agClone.clone.style.top  = `${Math.round((e.clientY - wr.top  - grab.y) / z)}px`;
              }
            }
            absDragPosRef.current = null;
            setAbsDragPos(null);
            setSnapGuides([]);
            stickySnapRef.current = { x: null, y: null };
            setDropLineY(null);
            setDropLineX(null);
            setDropContainerId(null);
            return;
          }

          // Show/hide in-page element based on cross-page status
          if (isCrossPageDrag) {
            if (nodeEl && absHiddenElRef.current !== nodeEl) {
              nodeEl.style.opacity = '0';
              absHiddenElRef.current = nodeEl;
            }
          } else {
            if (absHiddenElRef.current) {
              absHiddenElRef.current.style.opacity = '';
              absHiddenElRef.current = null;
            }
          }

          const currentParentNode = findParentNode(useBuilderStore.getState().pageNodes, draggingId);
          const currentParentId   = currentParentNode?.id ?? null;

          // Find the deepest element under cursor (excluding the dragged node).
          const hoveredEl  = findDropTargetElAt(e.clientX, e.clientY, new Set([draggingId]), true);

          // Position ghost: at cursor for cross-page/off-page, off-screen for same-page.
          if (agClone) {
            if (isCrossPageDrag) {
              const wEl = worldRef.current;
              if (wEl) {
                const wr = wEl.getBoundingClientRect();
                const z = zoomRef.current;
                const grab = grabOffsetRef.current;
                agClone.clone.style.left = `${Math.round((e.clientX - wr.left - grab.x) / z)}px`;
                agClone.clone.style.top  = `${Math.round((e.clientY - wr.top  - grab.y) / z)}px`;
              }
            } else {
              agClone.clone.style.left = '-9999px';
              agClone.clone.style.top = '-9999px';
            }
          }
          let effectiveParentId: string | null = null;
          let effectiveParentEl: HTMLElement | null = null;

          if (hoveredEl) {
            const hovId   = hoveredEl.dataset.builderId!;
            const hovType = hoveredEl.dataset.builderType ?? '';
            const hovNode = findNodeAcrossPages(hovId);
            const hovIsContainer = CONTAINER_TYPES.has(hovType) ||
              ((hovNode?.children?.length ?? 0) > 0);
            const hovCls = (hovNode?.props as { className?: string })?.className ?? '';
            const hovIsAbs = /\b(absolute|fixed)\b/.test(hovCls);

            if (hovIsContainer && !hovIsAbs) {
              effectiveParentId = hovId;
              effectiveParentEl = hoveredEl;
            } else {
              // Walk up the tree to find a non-absolute parent container.
              // Use findNodeAcrossPages so this works when hovering over a non-focused page.
              function findParentAcrossPages(nodeId: string): SDUINode | null | undefined {
                const s = useBuilderStore.getState();
                const inFocused = findParentNode(s.pageNodes as SDUINode[], nodeId);
                if (inFocused !== undefined) return inFocused;
                for (const pg of s.pages) {
                  if (pg.id === s.focusedPageId) continue;
                  const found = findParentNode(pg.nodes as SDUINode[], nodeId);
                  if (found !== undefined) return found;
                }
                return null;
              }
              let resolvedParent = findParentAcrossPages(hovId);
              while (resolvedParent?.id) {
                const pCls = (resolvedParent.props as { className?: string })?.className ?? '';
                if (/\b(absolute|fixed)\b/.test(pCls)) {
                  resolvedParent = findParentAcrossPages(resolvedParent.id);
                } else {
                  break;
                }
              }
              effectiveParentId = resolvedParent?.id ?? null;
              effectiveParentEl = resolvedParent?.id
                ? (document.querySelector(`[data-builder-id="${resolvedParent.id}"]`) as HTMLElement | null)
                : null;
            }
          }

          // Reset sticky snap state when the effective parent changes so stale
          // snap offsets from the old container don't pollute the new one.
          if (effectiveParentId !== currentParentId) {
            stickySnapRef.current = { x: null, y: null };
          }

          dropTargetRef.current = { parentId: effectiveParentId, index: 0 };

          if (!effectiveParentEl) {
            if (effectiveParentId) {
              effectiveParentEl = document.querySelector(`[data-builder-id="${effectiveParentId}"]`) as HTMLElement | null;
            } else {
              // Use the page the cursor is actually hovering over, not the focused page
              const hovPageId = lastDragHoverPageRef.current
                ?? useBuilderStore.getState().focusedPageId
                ?? useBuilderStore.getState().currentPageId;
              effectiveParentEl = document.querySelector(`[data-builder-page-id="${hovPageId}"][data-builder-page-frame="0"]`) as HTMLElement | null;
            }
          }

          if (effectiveParentEl) {
            const z    = zoomRef.current;
            const grab = grabOffsetRef.current;

            // ── Use effectiveParentEl as the coordinate origin ────────────────
            // The builder writes `left-[Xpx] top-[Ypx]` Tailwind classes on the
            // element AND ensures the parent gets `position: relative` on drop
            // (see the drop handler below).  This means CSS left/top will always
            // resolve against effectiveParentEl's padding box — so all coordinate
            // math should use it directly.  Do NOT use findContainingBlock: the
            // real DOM tree has AnimatedNode wrappers, NativeWind cssInterop divs,
            // etc. that may have `position: relative` with zero padding, giving a
            // wrong coordinate origin.
            const pr   = effectiveParentEl.getBoundingClientRect();
            const cs   = getComputedStyle(effectiveParentEl);
            // CSS left/top on absolute elements resolve against the containing
            // block's **padding box** (inner edge of border), NOT the content box.
            // Only subtract border width, never padding.
            const bdrL = parseFloat(cs.borderLeftWidth) || 0;
            const bdrT = parseFloat(cs.borderTopWidth)  || 0;

            const rawX = Math.round((e.clientX - pr.left - grab.x) / z - bdrL);
            const rawY = Math.round((e.clientY - pr.top  - grab.y) / z - bdrT);

            // ── Diagnostic: log once per drag to trace coordinate math ──
            const nodeEl = document.querySelector(`[data-builder-id="${draggingId}"]`) as HTMLElement | null;
            let nodeW  = nodeEl ? nodeEl.getBoundingClientRect().width  / z : 0;
            let nodeH  = nodeEl ? nodeEl.getBoundingClientRect().height / z : 0;
            if (isCrossPageDrag && absGhostRef.current && (nodeW === 0 || nodeH === 0)) {
              nodeW = absGhostRef.current.w;
              nodeH = absGhostRef.current.h;
            }

            const siblings = getAllSiblingRects(draggingId, effectiveParentEl, z);

            const SNAP_STICKY_RELEASE = SNAP_THRESHOLD * 2;
            const sticky = stickySnapRef.current;

            let effectiveX = rawX;
            let effectiveY = rawY;
            if (sticky.x !== null) {
              if (Math.abs(rawX - sticky.x) <= SNAP_STICKY_RELEASE) {
                effectiveX = sticky.x;
              } else {
                sticky.x = null;
              }
            }
            if (sticky.y !== null) {
              if (Math.abs(rawY - sticky.y) <= SNAP_STICKY_RELEASE) {
                effectiveY = sticky.y;
              } else {
                sticky.y = null;
              }
            }

            const dragged: ContentRect = { id: draggingId, x: effectiveX, y: effectiveY, w: nodeW, h: nodeH };
            const { x, y, guides } = computeSnap(dragged, siblings);

            if (x !== effectiveX) sticky.x = x;
            if (y !== effectiveY) sticky.y = y;

            // ── Offset guides to page-space / world-space for rendering ──────
            // Guides from computeSnap are in effectiveParent-content-space.
            // Convert to world-space first, then optionally to page-space.
            const wEl = worldRef.current;
            const wr = wEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
            const epToWorldX = (pr.left - wr.left + bdrL * z) / z;
            const epToWorldY = (pr.top  - wr.top  + bdrT * z) / z;

            const focusedPg = (useBuilderStore.getState().pages as { id: string; wx: number; wy: number }[])
              .find(p => p.id === useBuilderStore.getState().focusedPageId);
            const pageWX = focusedPg?.wx ?? 0;
            const pageWY = focusedPg?.wy ?? 0;
            const epToPageX = epToWorldX - pageWX;
            const epToPageY = epToWorldY - pageWY;

            if (isCrossPageDrag) {
              setSnapGuides(guides.map(g => g.axis === 'x'
                ? { ...g, position: g.position + epToWorldX, start: g.start + epToWorldY, end: g.end + epToWorldY }
                : { ...g, position: g.position + epToWorldY, start: g.start + epToWorldX, end: g.end + epToWorldX }
              ));
            } else {
              setSnapGuides(guides.map(g => g.axis === 'x'
                ? { ...g, position: g.position + epToPageX, start: g.start + epToPageY, end: g.end + epToPageY }
                : { ...g, position: g.position + epToPageY, start: g.start + epToPageX, end: g.end + epToPageX }
              ));
            }

            // Live-position the element: x/y are in effectiveParent-content-space.
            // When the effective parent differs from the node's current parent
            // (cursor hovering over a new container), convert to the current
            // parent's space so the in-DOM element tracks the cursor correctly
            // until it is actually reparented on drop.
            if (!isCrossPageDrag && nodeEl) {
              let liveLeft = x;
              let liveTop  = y;
              if (effectiveParentId !== currentParentId) {
                const actualParentEl = currentParentId
                  ? (document.querySelector(`[data-builder-id="${currentParentId}"]`) as HTMLElement | null)
                  : (() => { const fp = useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId; return document.querySelector(`[data-builder-page-id="${fp}"][data-builder-page-frame="0"]`) as HTMLElement | null; })();
                if (actualParentEl) {
                  const ar = actualParentEl.getBoundingClientRect();
                  const acs = getComputedStyle(actualParentEl);
                  const aBdrL = parseFloat(acs.borderLeftWidth) || 0;
                  const aBdrT = parseFloat(acs.borderTopWidth) || 0;
                  liveLeft = x + (pr.left - ar.left) / z + bdrL - aBdrL;
                  liveTop  = y + (pr.top  - ar.top)  / z + bdrT - aBdrT;
                }
              }
              nodeEl.style.left = `${liveLeft}px`;
              nodeEl.style.top  = `${liveTop}px`;
            }

            // absDragPosRef stores parent-content-relative coords for the drop handler.
            const pos = { x, y, clientX: e.clientX, clientY: e.clientY };
            absDragPosRef.current = pos;

            if (isCrossPageDrag) {
              setAbsDragPos({ x: epToWorldX + x, y: epToWorldY + y, clientX: e.clientX, clientY: e.clientY, isWorldSpace: true });
            } else {
              setAbsDragPos({ x: epToPageX + x, y: epToPageY + y, clientX: e.clientX, clientY: e.clientY });
            }
          }

          // No drop line, but highlight the target container (blue dashed border)
          // whenever the node would be reparented into a different container.
          setDropLineY(null);
          setDropLineX(null);
          setDropContainerId(
            effectiveParentId !== null && effectiveParentId !== currentParentId
              ? effectiveParentId
              : null,
          );
          return;
        }
        } else {
        // absCanvas unavailable — clear any stale indicators
        setDropLineY(null);
        setDropLineX(null);
        setDropContainerId(null);
        return;
      }
      }
    }
    // Clear any stale absolute state when dragging a normal node
    absDragPosRef.current = null;
    setAbsDragPos(null);
    setSnapGuides([]);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // Build the set of all node IDs currently being dragged (primary + multi).
    // We treat these nodes as transparent for drop-target purposes so the line
    // never appears "on themselves" and the nearest-gap algorithm is used instead.
    const activeDragId = draggingNodeIdRef.current;
    const allDraggingIds = multiDragIdsRef.current.length > 0
      ? multiDragIdsRef.current
      : (activeDragId ? [activeDragId] : []);

    // Expand draggingIdSet to include the full subtrees of all dragged nodes.
    // Without this, children of the dragged node (e.g. InputField inside Input)
    // are still hit by findDropTargetElAt. That makes the nearest-gap compute
    // parentId = dragged-node-id, which triggers the self-drop guard and the
    // move is silently rejected — making it impossible to drag a compound node
    // (Input, Checkbox, Button…) out of its container.
    const draggingIdSet = new Set(allDraggingIds);
    const pn = useBuilderStore.getState().pageNodes;
    function collectSubtreeIds(nodes: SDUINode[], out: Set<string>) {
      for (const n of nodes) {
        if (n.id) out.add(n.id);
        if (n.children?.length) collectSubtreeIds(n.children as SDUINode[], out);
      }
    }
    for (const id of allDraggingIds) {
      const dragNode = findNode(pn, id);
      if (dragNode?.children?.length) collectSubtreeIds(dragNode.children as SDUINode[], draggingIdSet);
    }

    // Find the SDUI node under cursor. Dragged nodes (opacity 0.3, still in DOM)
    // are skipped so we always resolve to their parent container instead of
    // treating the cursor position as empty/root-level.
    // anyPage=true allows finding nodes on non-focused pages for cross-page drops.
    // Canvas wrapper already has pointer-events:none during drag (set in isCanvasNodeDrag block).
    const hovEl = findDropTargetElAt(e.clientX, e.clientY, draggingIdSet, true);

    if (hovEl) {
      const nodeId   = hovEl.dataset.builderId!;
      const nodeType = hovEl.dataset.builderType ?? '';
      const nodeRect = hovEl.getBoundingClientRect();

      // Use cross-page lookups so drop indicators work on any page
      const nodeInTree = findNodeAcrossPages(nodeId);
      const isContainer = CONTAINER_TYPES.has(nodeType) || (nodeInTree?.children?.length ?? 0) > 0;

      const isDroppingIntoSelf = isContainer &&
        allDraggingIds.some(id => {
          const draggedNode = findNodeAcrossPages(id);
          if (!draggedNode?.children?.length) return false;
          return !!findNode((draggedNode.children as SDUINode[]), nodeId);
        });

      const EDGE_ZONE_MAX_PX = 12;
      const isRowForEdge = isRowContainer(nodeInTree);
      const inDropZone = isRowForEdge
        ? (() => {
            const edgePxH = Math.min(EDGE_ZONE_MAX_PX, nodeRect.width * 0.2);
            const relXPx = e.clientX - nodeRect.left;
            return relXPx > edgePxH && relXPx < nodeRect.width - edgePxH;
          })()
        : (() => {
            const edgePxV = Math.min(EDGE_ZONE_MAX_PX, nodeRect.height * 0.2);
            const relYPx = e.clientY - nodeRect.top;
            return relYPx > edgePxV && relYPx < nodeRect.height - edgePxV;
          })();

      const allowedSet = ALLOWED_CHILDREN[nodeType];
      const allDraggedAllowed = !allowedSet || allDraggingIds.every(id => {
        const dn = findNodeAcrossPages(id);
        return dn?.type && allowedSet.has(dn.type);
      });

      if (isContainer && !isDroppingIntoSelf && inDropZone && allDraggedAllowed) {
        const children = (nodeInTree?.children ?? []) as SDUINode[];
        if (isRowContainer(nodeInTree)) {
          const { insertIdx, lineX } = nearestGapH(children, e.clientX, canvas, rect);
          setDropContainerId(nodeId);
          setDropLineX(lineX);
          setDropLineY(null);
          dropTargetRef.current = { parentId: nodeId, index: insertIdx };
        } else {
          const { insertIdx, lineY } = nearestGap(children, e.clientY, canvas, rect);
          setDropContainerId(nodeId);
          setDropLineY(lineY);
          setDropLineX(null);
          dropTargetRef.current = { parentId: nodeId, index: insertIdx };
        }
      } else {
        // ── Drop BEFORE / AFTER this node in its parent ──
        const parent   = findParentAcrossPages(nodeId);
        const parentId = parent?.id ?? null;
        const siblings: SDUINode[] = parent
          ? (parent.children as SDUINode[])
          : getRootSiblingsForNode(nodeId);
        if (isRowContainer(parent)) {
          const { insertIdx, lineX } = nearestGapH(siblings, e.clientX, canvas, rect);
          setDropContainerId(null);
          setDropLineX(lineX);
          setDropLineY(null);
          dropTargetRef.current = { parentId, index: insertIdx };
        } else {
          const { insertIdx, lineY } = nearestGap(siblings, e.clientY, canvas, rect);
          setDropContainerId(null);
          setDropLineY(lineY);
          setDropLineX(null);
          dropTargetRef.current = { parentId, index: insertIdx };
        }
      }
    } else {
      // ── No node under cursor (or cursor is over a dragged node): use
      //    nearest-gap on root-level nodes (always column at root level).
      const nodes = useBuilderStore.getState().pageNodes;
      const { insertIdx, lineY } = nearestGap(nodes, e.clientY, canvas, rect);
      setDropContainerId(null);
      setDropLineY(lineY);
      setDropLineX(null);
      dropTargetRef.current = { parentId: null, index: insertIdx };
    }
  }, [findBuilderElAt]);

  const onDragLeave = useCallback(() => {
    // Remove blue border from current hovered page
    if (lastDragHoverPageRef.current) {
      const prevFrame = document.querySelector(`[data-builder-page-id="${lastDragHoverPageRef.current}"]`) as HTMLElement | null;
      if (prevFrame) prevFrame.style.outline = '';
    }
    lastDragHoverPageRef.current = null;
    setIsDroppingVariant(false);
    setDropLineY(null);
    setDropLineX(null);
    setDropContainerId(null);
    absDragPosRef.current = null;
    setAbsDragPos(null);
    setSnapGuides([]);
    stickySnapRef.current = { x: null, y: null };
    dropTargetRef.current = null;
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDroppingVariant(false);
    setDropContainerId(null);
    const dropTargetPageId = lastDragHoverPageRef.current;
    if (lastDragHoverPageRef.current) {
      const prevFrame = document.querySelector(`[data-builder-page-id="${lastDragHoverPageRef.current}"]`) as HTMLElement | null;
      if (prevFrame) prevFrame.style.outline = '';
      lastDragHoverPageRef.current = null;
    }
    for (const el of draggedElRef.current) el.style.opacity = '';
    draggedElRef.current = [];
    setIsDragging(false);

    const target   = dropTargetRef.current ?? { parentId: null, index: useBuilderStore.getState().pageNodes.length };
    const canvasNodeId = e.dataTransfer.getData('text/canvas-node-id') || draggingNodeIdRef.current || '';
    const variantId    = e.dataTransfer.getData('text/variant-id');
    const win = window as unknown as Record<string, unknown>;
    const primitive    = e.dataTransfer.getData('text/primitive-node') ||
                         (win.__primitiveDrag as string | undefined) || '';
    win.__primitiveDrag = undefined;

    if (canvasNodeId) {
      // ── Canvas node drag: commit position via absDragPosRef ───────────────
      if (draggingCanvasNodeRef.current) {
        const pos = absDragPosRef.current;
        const cnWrap = document.querySelector(`[data-builder-canvas-node="${canvasNodeId}"]`) as HTMLElement | null;
        if (cnWrap) cnWrap.style.pointerEvents = 'none';
        const droppedOnPage = !!dropTargetPageId
          || !!(document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-builder-page-id]');
        if (cnWrap) cnWrap.style.pointerEvents = '';
        if (droppedOnPage) {
          const curPage = useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId;
          const effectiveTargetPage = dropTargetPageId ?? curPage;
          const cnData = (useBuilderStore.getState().canvasNodes as CanvasNode[]).find(n => n.id === canvasNodeId);

          // Measure the parent element for abs positioning BEFORE focusPage
          // changes the DOM (non-focused pages stay rendered by AllPagesGrid,
          // but pageNodes swaps so patchProp only reaches the focused page).
          const cnCls = ((cnData?.props as { className?: string })?.className) ?? '';
          const isAbsOnCanvas = /\b(absolute|fixed)\b/.test(cnCls);
          let absLeft: number | null = null;
          let absTop: number | null = null;
          if (isAbsOnCanvas) {
            // Use the drop target parent directly — ensureParentRelative
            // (called after insertion below) guarantees it gets position:relative
            // so CSS left/top resolve against it.
            const dropParentEl = target.parentId
              ? document.querySelector(`[data-builder-id="${target.parentId}"]`) as HTMLElement | null
              : document.querySelector(`[data-builder-page-id="${effectiveTargetPage}"][data-builder-page-frame="0"]`) as HTMLElement | null;
            if (dropParentEl) {
              const pr = dropParentEl.getBoundingClientRect();
              const pcs = getComputedStyle(dropParentEl);
              const pBdrL = parseFloat(pcs.borderLeftWidth) || 0;
              const pBdrT = parseFloat(pcs.borderTopWidth) || 0;
              const z = useBuilderStore.getState().zoom;
              const grab = grabOffsetRef.current;
              absLeft = Math.round((e.clientX - pr.left - grab.x) / z - pBdrL);
              absTop  = Math.round((e.clientY - pr.top  - grab.y) / z - pBdrT);
            }
          }

          // Focus the target page so the node ends up in pageNodes (patchProp
          // only reaches the focused page via patchAnyNode).
          if (effectiveTargetPage !== curPage) {
            focusPage(effectiveTargetPage);
          }
          useBuilderStore.getState().moveCanvasNodeToPage(canvasNodeId, effectiveTargetPage, target.parentId, target.index);

          if (isAbsOnCanvas && absLeft != null && absTop != null) {
            const insertedNode = findNode(useBuilderStore.getState().pageNodes as SDUINode[], canvasNodeId);
            const curCls = ((insertedNode?.props as { className?: string })?.className) ?? '';
            const finalCls = `${removeTwToken(removeTwToken(curCls, 'left-'), 'top-')} left-[${absLeft}px] top-[${absTop}px]`.trim();
            patchProp(canvasNodeId, 'props.className', finalCls);
            ensureParentRelative(target.parentId);
          }
        } else if (pos) {
          useBuilderStore.getState().moveCanvasNodePosition(canvasNodeId, pos.x, pos.y);
        }
        draggingCanvasNodeRef.current = false;
        draggingNodeIdRef.current = null;
        multiDragIdsRef.current = [];
        absDragPosRef.current = null;
        setAbsDragPos(null);
        setSnapGuides([]);
        stickySnapRef.current = { x: null, y: null };
        setDropLineY(null);
        setDropLineX(null);
        setIsDragging(false);
        return;
      }

      // ── Check if dropped outside any page frame → freeform canvas node ──────
      // Must run BEFORE the absolute-node handler: an absolute node dragged off
      // the page should become a freeform canvas node, not stay in the page.
      const droppedOnPage = !!dropTargetPageId
        || !!(document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-builder-page-id]');

      // ── Absolute node dropped ON a page: apply style.left / style.top ──────
      const pos = absDragPosRef.current;
      const draggedNode = findNodeAcrossPages(canvasNodeId);
      const cls = (draggedNode?.props as { className?: string })?.className ?? '';
      const isAbsNode = /\babsolute\b/.test(cls) || /\bfixed\b/.test(cls);
      const isMultiDrag = multiDragIdsRef.current.length > 1;
      if (isAbsNode && !isMultiDrag && droppedOnPage) {
        restoreOverflowPatches();
        removeAbsGhost();

        const srcPage = dragSourcePageIdRef.current
          ?? useBuilderStore.getState().focusedPageId
          ?? useBuilderStore.getState().currentPageId;
        const effectiveTargetPage = dropTargetPageId
          ?? useBuilderStore.getState().focusedPageId
          ?? useBuilderStore.getState().currentPageId;
        const isCrossPage = srcPage !== effectiveTargetPage;

        const targetParentId = target.parentId;

        if (isCrossPage) {
          focusPage(effectiveTargetPage);
          moveNodeFromPage(canvasNodeId, srcPage, targetParentId, target.index);
        } else {
          const currentParent  = findParentNode(useBuilderStore.getState().pageNodes, canvasNodeId);
          const isSameParent   = targetParentId === (currentParent?.id ?? null);
          if (!isSameParent) {
            moveNode(canvasNodeId, targetParentId, target.index);
          }
        }

        // Apply the exact pixel position the user dragged to.
        if (pos) {
          const freshNode = findNode(useBuilderStore.getState().pageNodes as SDUINode[], canvasNodeId);
          const existingStyle = (freshNode?.props as { style?: Record<string, string> })?.style ?? {};
          const absDragCls = (freshNode?.props as { className?: string })?.className ?? '';
          const absFinalCls = `${removeTwToken(removeTwToken(absDragCls, 'left-'), 'top-')} left-[${pos.x}px] top-[${pos.y}px]`.trim();
          patchProp(canvasNodeId, 'props.className', absFinalCls);
          const { left: _l, top: _t, ...styleWithoutPos } = existingStyle as Record<string, string>;
          patchProp(canvasNodeId, 'props.style', styleWithoutPos);

          // Ensure the parent container has `position: relative` so CSS
          // left/top on the absolute child resolve against it, not some
          // ancestor further up the DOM.
          ensureParentRelative(targetParentId);
        }

        _pushHistory();
        absDragPosRef.current = null;
        setAbsDragPos(null);
        setSnapGuides([]);
        stickySnapRef.current = { x: null, y: null };
        dragStartStyleRef.current = null;
        draggingNodeIdRef.current = null;
        dragSourcePageIdRef.current = null;
        setDropLineY(null);
        setDropLineX(null);
        return;
      }
      if (!droppedOnPage) {
        const z = useBuilderStore.getState().zoom;

        // Measure the element BEFORE restoring overflow — after restore the
        // ancestor overflow:hidden clips the node back to 0×0 because its
        // inline left/top are still at the last drag position.
        const store = useBuilderStore.getState();
        const isAlreadyCanvas = (store.canvasNodes as { id: string }[]).some(n => n.id === canvasNodeId);
        let cw: number | undefined;
        let ch: number | undefined;
        if (!isAlreadyCanvas) {
          const _resizeMI = store.selectedMapIndex;
          const _resizeEls = document.querySelectorAll(`[data-builder-id="${canvasNodeId}"]`);
          const measureEl = (_resizeMI != null ? _resizeEls[_resizeMI] : _resizeEls[0]) as HTMLElement | null
            ?? (_resizeEls[0] as HTMLElement | null);
          if (measureEl) {
            const r = measureEl.getBoundingClientRect();
            cw = r.width / z;
            ch = r.height / z;
          }
        }

        // Now clean up drag visual state
        restoreOverflowPatches();
        removeAbsGhost();
        dragStartStyleRef.current = null;

        const worldEl = worldRef.current;
        const worldRect = worldEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
        const grab = grabOffsetRef.current;
        const cx = (e.clientX - worldRect.left - grab.x) / z;
        const cy = (e.clientY - worldRect.top  - grab.y) / z;
        if (isAlreadyCanvas) {
          store.moveCanvasNodePosition(canvasNodeId, cx, cy);
        } else {
          store.moveNodeToCanvas(canvasNodeId, cx, cy, cw, ch);
        }
        multiDragIdsRef.current = [];
        draggingNodeIdRef.current = null;
        dragSourcePageIdRef.current = null;
        absDragPosRef.current = null;
        setAbsDragPos(null);
        setSnapGuides([]);
        stickySnapRef.current = { x: null, y: null };
        setDropLineY(null);
        setDropLineX(null);
        return;
      }

      // Moving an existing canvas node (or a group of selected nodes) to a new position
      const allIds = multiDragIdsRef.current;
      const srcPage = dragSourcePageIdRef.current;
      const curPage = useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId;
      dragSourcePageIdRef.current = null;

      // Cross-page drop: if the user dragged to a different page, switch to that page
      // first (deferred from onDragOver to avoid 60fps re-renders during drag).
      // moveNodeFromPage inserts into s.pageNodes (the focused page), so the
      // focused page must be the target page before calling it.
      const effectiveTargetPage = dropTargetPageId ?? curPage;
      if (srcPage && effectiveTargetPage && effectiveTargetPage !== curPage) {
        focusPage(effectiveTargetPage);
      }

      const isFromCanvas = (useBuilderStore.getState().canvasNodes as { id: string }[]).some(n => n.id === canvasNodeId);
      if (isFromCanvas) {
        useBuilderStore.getState().moveCanvasNodeToPage(canvasNodeId, effectiveTargetPage, target.parentId, target.index);
      } else if (srcPage && srcPage !== effectiveTargetPage) {
        moveNodeFromPage(canvasNodeId, srcPage, target.parentId, target.index);
      } else if (allIds.length > 1) {
        moveNodes(allIds, target.parentId, target.index);
      } else {
        moveNode(canvasNodeId, target.parentId, target.index);
      }
      multiDragIdsRef.current = [];
    } else if (primitive) {
      try {
        const node = ensureIds(JSON.parse(primitive) as SDUINode);
        const primTargetPage = lastDragHoverPageRef.current;
        const primCurPage = useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId;
        if (primTargetPage && primTargetPage !== primCurPage) {
          focusPage(primTargetPage);
        }
        if (target.parentId) {
          const parentNode = findNodeAcrossPages(target.parentId);
          const allowed = parentNode ? ALLOWED_CHILDREN[parentNode.type] : undefined;
          if (allowed && !allowed.has(node.type)) {
            console.warn(`Cannot drop "${node.type}" into "${parentNode?.type}" — incompatible child type.`);
            setDropLineY(null);
            setDropLineX(null);
            draggingNodeIdRef.current = null;
            return;
          }
        }
        addNode(node, target.parentId, target.index);
      } catch (err) { console.warn('Primitive drop failed:', err); }
    }

    restoreOverflowPatches();
    removeAbsGhost();
    setDropLineY(null);
    setDropLineX(null);
    draggingNodeIdRef.current = null;
    draggingCanvasNodeRef.current = false;
    dragSourcePageIdRef.current = null;
    lastDragHoverPageRef.current = null;
  }, [addNode, addSection, moveNode, moveNodes, moveNodeFromPage, focusPage, patchProp, _pushHistory]);

  // ── Resize: pointer-capture drag on handle ───────────────────────────────
  //
  // The handle sits inside the overlay (different DOM subtree from the canvas),
  // so we attach pointermove/pointerup listeners to `window` rather than
  // capturing on the canvas. This means the drag works even when the cursor
  // moves faster than React's synthetic event can follow.

  const onResizeStart = useCallback((id: string, handle: ResizeHandle, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Flush any pending patchStyle dimension update before capturing existingCls.
    // Without this, a debounce timer (e.g. from a unit-toggle) would fire after onUp
    // and overwrite the committed resize result.
    cancelPendingDimensionFlush();

    // Use selectedMapIndex to find the correct repeat instance.
    // querySelector always returns the first DOM element; for repeated nodes all
    // instances share the same data-builder-id, so we must pick the nth one.
    const _resizeMI  = useBuilderStore.getState().selectedMapIndex;
    const _resizeEls = document.querySelectorAll(`[data-builder-id="${id}"]`);
    const el    = (_resizeMI !== null ? _resizeEls[_resizeMI] : _resizeEls[0]) as HTMLElement | null
               ?? _resizeEls[0] as HTMLElement | null;
    const frame = el.closest('[data-builder-canvas-node]') as HTMLElement
      ?? (() => { const fp = useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId; return document.querySelector(`[data-builder-page-id="${fp}"][data-builder-page-frame="0"]`) as HTMLElement ?? document.querySelector('[data-builder-page-frame]') as HTMLElement; })();
    if (!el || !frame) return;

    const r         = el.getBoundingClientRect();
    const z         = useBuilderStore.getState().zoom;
    const startX    = e.clientX;
    const startY    = e.clientY;
    const startW    = r.width  / z;   // unscaled px
    const startH    = r.height / z;

    // Read existing style once — we apply size imperatively during the drag
    // and only commit to Zustand on pointerup (same pattern as pan/zoom world container).
    const node = (() => {
      function find(nodes: SDUINode[], targetId: string): SDUINode | null {
        for (const n of nodes) {
          if (n.id === targetId) return n;
          if (n.children?.length) { const f = find(n.children as SDUINode[], targetId); if (f) return f; }
        }
        return null;
      }
      return find(useBuilderStore.getState().pageNodes, id)
        ?? find(useBuilderStore.getState().canvasNodes as SDUINode[], id);
    })();
    const existingStyle = (node?.props as { style?: Record<string, string> })?.style ?? {};

    // Track final committed size for the onUp handler
    let lastW = startW;
    let lastH = startH;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / z;
      const dy = (ev.clientY - startY) / z;

      let newW = startW;
      let newH = startH;
      if (handle.includes('e')) newW = Math.max(20, Math.round(startW + dx));
      if (handle.includes('s')) newH = Math.max(20, Math.round(startH + dy));
      if (handle.includes('w')) newW = Math.max(20, Math.round(startW - dx));
      if (handle.includes('n')) newH = Math.max(20, Math.round(startH - dy));

      // Snap to sibling sizes
      const siblings = getAllSiblingRects(id, frame as HTMLElement, z);
      const snapped = snapResizeSize(newW, newH, handle, siblings);
      newW = snapped.w;
      newH = snapped.h;
      setSnapGuides(snapped.guides);
      lastW = newW;
      lastH = newH;

      // Apply size directly to DOM — zero React re-renders during the drag gesture.
      // Zustand is committed once on pointerup (same strategy as pan/zoom world container).
      // Also update all repeat-sibling instances so they resize in sync (weWeb-style).
      const allResizeEls = document.querySelectorAll(`[data-builder-id="${id}"]`);
      allResizeEls.forEach(sibEl => {
        (sibEl as HTMLElement).style.width  = `${newW}px`;
        (sibEl as HTMLElement).style.height = `${newH}px`;
      });

      // Synchronous ring update so handles track the new size in the same frame
      overlayInstantUpdateRef.current?.();
      overlayNotifyRef.current?.();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      setSnapGuides([]);

      // Guard: if the node has a formula expression binding on width/height, bail out.
      // Expressions (calc(), variables, etc.) cannot be represented as pixel Tailwind classes.
      const styleProps = (node?.props as { style?: Record<string, unknown> })?.style ?? {};
      const isFormulaDim = (v: unknown): boolean => v !== null && v !== undefined && typeof v === 'object';
      if ((handle.includes('e') || handle.includes('w')) && isFormulaDim(styleProps.width)) {
        showCanvasToast('Width uses an expression — edit it via the ƒ button in the panel.');
        return;
      }
      if ((handle.includes('n') || handle.includes('s')) && isFormulaDim(styleProps.height)) {
        showCanvasToast('Height uses an expression — edit it via the ƒ button in the panel.');
        return;
      }

      // Commit final size to Zustand as Tailwind arbitrary-value classes (class-only, no inline style).
      // Preserve the existing unit (vw/vh/%/px) so a vw element stays in vw after drag.
      // Strip w-fit/w-full/w-screen/h-fit/h-screen/flex-1 so Dimensions panel shows Fixed mode.
      const existingCls = (node?.props as { className?: string })?.className ?? '';
      let newCls = existingCls;

      // Convert a logical px value to the target CSS unit string.
      // vw/vh are relative to the DESIGNED viewport (vpWidth × VIEWPORT_H), not the
      // frame's actual rendered height (which grows with content).
      // Read --builder-vw/vh from the frame's computed style so this calculation
      // always matches classToInlineStyle's calc(N * var(--builder-vw/vh)) output.
      const computedFrame = getComputedStyle(frame as HTMLElement);
      const vwProp = parseFloat(computedFrame.getPropertyValue('--builder-vw').trim()) || 0;
      const vhProp = parseFloat(computedFrame.getPropertyValue('--builder-vh').trim()) || 0;
      const frameRect = frame.getBoundingClientRect();
      // vwProp is "1% of designed viewport width" (e.g. 14.4 for a 1440px frame).
      // Multiply by 100 to get the full logical viewport dimension.
      const frameW = vwProp > 0 ? vwProp * 100 : frameRect.width  / z;
      const frameH = vhProp > 0 ? vhProp * 100 : frameRect.height / z;
      const pxToUnit = (pxVal: number, unit: string, axis: 'w' | 'h'): string => {
        if (unit === 'vw') {
          return `${Math.round(pxVal / frameW * 100 * 10) / 10}vw`;
        }
        if (unit === 'vh') {
          return `${Math.round(pxVal / frameH * 100 * 10) / 10}vh`;
        }
        if (unit === '%') {
          const parentEl   = el.parentElement;
          const parentRect = parentEl?.getBoundingClientRect();
          const parentSize = parentRect
            ? (axis === 'w' ? parentRect.width : parentRect.height) / z
            : (axis === 'w' ? frameW : frameH);
          return `${Math.round(pxVal / parentSize * 100 * 10) / 10}%`;
        }
        return `${Math.round(pxVal)}px`;
      };

      if (handle.includes('e') || handle.includes('w')) {
        const curUnit = parseTwArbitraryWithUnit(existingCls, 'w-')?.unit ?? 'px';
        newCls = removeTwToken(removeTwToken(removeTwToken(removeTwToken(newCls, 'w-fit'), 'w-full'), 'w-screen'), 'w-');
        newCls = `${newCls} w-[${pxToUnit(lastW, curUnit, 'w')}]`.trim();
      }
      if (handle.includes('n') || handle.includes('s')) {
        const curUnit = parseTwArbitraryWithUnit(existingCls, 'h-')?.unit ?? 'px';
        newCls = removeTwToken(removeTwToken(removeTwToken(removeTwToken(removeTwToken(newCls, 'h-fit'), 'h-screen'), 'flex-1'), 'h-'), 'min-h-');
        newCls = `${newCls} h-[${pxToUnit(lastH, curUnit, 'h')}]`.trim();
      }
      useBuilderStore.getState().patchProp(id, 'props.className', newCls);

      // Strip width/height from inline style — classes are now the source of truth
      const { width: _w, height: _h, ...styleWithoutDims } = existingStyle as Record<string, string>;
      useBuilderStore.getState().patchProp(id, 'props.style', styleWithoutDims);

      // Update canvas node wrapper dimensions if the resized node is a top-level canvas node
      const cnArr = useBuilderStore.getState().canvasNodes as import('./_store-types').CanvasNode[];
      const cnIdx = cnArr.findIndex(n => n.id === id);
      if (cnIdx >= 0) {
        const updated = [...cnArr];
        updated[cnIdx] = { ...updated[cnIdx], _cw: lastW, _ch: lastH };
        useBuilderStore.setState({ canvasNodes: updated });
      }

      useBuilderStore.getState()._pushHistory();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);

    // Suppress the click that would fire after pointerup (deselects the node)
    const suppressClick = (ev: MouseEvent) => {
      ev.stopPropagation();
      window.removeEventListener('click', suppressClick, true);
    };
    window.addEventListener('click', suppressClick, true);

    // Suppress canvas pan drag from kicking in
    dragRef.current.active = false;

  }, []);

  const cursorStyle = tool === 'hand' ? 'grab' : 'default';

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const hit = hitTest(e.clientX, e.clientY);
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: hit.kind === 'node' ? hit.id : null });
  }, [hitTest]);

  return (
    <div
      ref={canvasRef}
      data-testid="builder-canvas"
      style={{ flex: 1, overflow: 'hidden', background: '#1a1a2e', position: 'relative', cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={handleContextMenu}
    >
      {/* Figma-style dot grid — pattern offsets updated imperatively via gridPatternRef */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.25 }}>
        <defs>
          <pattern ref={gridPatternRef} id="builder-grid" x={panX % (20 * zoom)} y={panY % (20 * zoom)} width={20 * zoom} height={20 * zoom} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={0.8} fill="#6b7280" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#builder-grid)" />
      </svg>

      {/* ── Empty state: outside the world transform so it's never zoomed/panned ── */}
      {pages.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', pointerEvents: 'none', userSelect: 'none',
          zIndex: 10,
        }}>
          <div style={{ textAlign: 'center', fontFamily: 'system-ui', maxWidth: 320 }}>
            <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.2 }}>⬜</div>
            <div style={{ fontSize: 15, color: '#e2e8f0', fontWeight: 600, marginBottom: 20 }}>
              Your canvas is empty
            </div>
            {/* Step 1 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14, textAlign: 'left' }}>
              <div style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                background: '#1d4ed8', color: '#fff',
                fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>1</div>
              <div>
                <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600, lineHeight: 1.3 }}>
                  Add a page
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, lineHeight: 1.5 }}>
                  Open <span style={{ color: '#93c5fd', fontWeight: 500 }}>Select page</span> in the top bar and click <span style={{ color: '#93c5fd', fontWeight: 500 }}>+ Add page</span>
                </div>
              </div>
            </div>
            {/* Step 2 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, textAlign: 'left' }}>
              <div style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                background: '#1d4ed8', color: '#fff',
                fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>2</div>
              <div>
                <div style={{ fontSize: 12, color: '#d1d5db', fontWeight: 600, lineHeight: 1.3 }}>
                  Drag a component
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, lineHeight: 1.5 }}>
                  Open the <span style={{ color: '#93c5fd', fontWeight: 500 }}>Components</span> tab in the left panel and drag any component onto the canvas
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── World container — all page frames live here.
           transform (translate + scale) is applied imperatively via worldRef
           during scroll/pan so React never re-renders just for viewport movement. ── */}
      <div
        ref={worldRef}
        data-builder-world="1"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          // Initial transform — kept in sync by the useEffect([zoom,panX,panY]) above
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
        }}
      >

        {/* ── All inactive page frames — isolated component; interactive, draggable ── */}
        {pages.length > 0 && (
          <AllPagesGrid
            vpWidth={vpWidth}
            overlayNotifyRef={overlayNotifyRef}
            dragNodeIdSetter={(id) => { draggingNodeIdRef.current = id; }}
            dragSourcePageSetter={(pgId) => { dragSourcePageIdRef.current = pgId; }}
            grabOffsetSetter={(ox, oy) => { grabOffsetRef.current = { x: ox, y: oy }; multiDragIdsRef.current = []; }}
            onPageDragSnap={handlePageDragSnap}
          />
        )}

        {/* ── Focused page — label (draggable to reposition the page) ── */}
        {pages.length > 0 && (() => {
          const pg = focusedPage;
          const pgLeft = pg?.wx ?? activePageIdx * (vpWidth + PAGE_GAP);
          const pgTop  = pg?.wy ?? 0;
          return (
            <div
              data-builder-page-label={pg?.id}
              onMouseDown={pg ? (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const startWx = pg.wx ?? 0;
                const startWy = pg.wy ?? 0;
                const startMx = e.clientX;
                const startMy = e.clientY;
                const getZoom = () => {
                  const worldEl = document.querySelector('[data-builder-world]') as HTMLElement | null;
                  const mat = worldEl ? new DOMMatrix(getComputedStyle(worldEl).transform) : null;
                  return mat ? mat.a : 1;
                };
                const buildSiblings = (): ContentRect[] =>
                  pages.filter(p => p.id !== pg.id).map(p => ({
                    id: p.id, x: (p as { wx?: number }).wx ?? 0,
                    y: (p as { wy?: number }).wy ?? 0, w: vpWidth, h: VIEWPORT_H,
                  }));
                const onMove = (mv: MouseEvent) => {
                  const z = getZoom();
                  const rawX = startWx + (mv.clientX - startMx) / z;
                  const rawY = startWy + (mv.clientY - startMy) / z;
                  const dragged: ContentRect = { id: pg.id, x: rawX, y: rawY, w: vpWidth, h: VIEWPORT_H };
                  const snap = computeSnap(dragged, buildSiblings());
                  const dx = snap.x - startWx;
                  const dy = snap.y - startWy;
                  const frame = document.querySelector(`[data-builder-page-id="${pg.id}"]`) as HTMLElement | null;
                  const label = document.querySelector(`[data-builder-page-label="${pg.id}"]`) as HTMLElement | null;
                  if (frame) frame.style.transform = `translateZ(0) translate(${dx}px, ${dy}px)`;
                  if (label) label.style.transform = `translate(${dx}px, ${dy}px)`;
                  handlePageDragSnap(snap.guides, true);
                };
                const onUp = (up: MouseEvent) => {
                  const z = getZoom();
                  const rawX = startWx + (up.clientX - startMx) / z;
                  const rawY = startWy + (up.clientY - startMy) / z;
                  const dragged: ContentRect = { id: pg.id, x: rawX, y: rawY, w: vpWidth, h: VIEWPORT_H };
                  const snap = computeSnap(dragged, buildSiblings());
                  const frame = document.querySelector(`[data-builder-page-id="${pg.id}"]`) as HTMLElement | null;
                  const label = document.querySelector(`[data-builder-page-label="${pg.id}"]`) as HTMLElement | null;
                  if (frame) frame.style.transform = 'translateZ(0)';
                  if (label) label.style.transform = '';
                  movePagePosition(pg.id, snap.x, snap.y);
                  handlePageDragSnap([], false);
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              } : undefined}
              style={{ position: 'absolute', left: pgLeft, top: pgTop - 26, fontSize: 11, color: '#d1d5db', userSelect: 'none', fontFamily: 'system-ui', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'baseline', cursor: 'grab' }}>
              <span style={{ fontWeight: 600, color: '#f3f4f6' }}>{pg?.name ?? 'Page'}</span>
              {pg?.route && <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#6b7280' }}>{pg.route}</span>}
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#4b5563' }}>{vpWidth}px</span>
            </div>
          );
        })()}

        {/* ── Focused page overlay frame: capture overlay only (SDUI content is
              rendered by AllPagesGrid for ALL pages, including the focused one, so
              focus changes never unmount/remount the engine — no animation replays). ── */}
        {pages.length > 0 && <div
          ref={pageFrameRef}
          data-builder-page-frame="1"
          data-builder-page-id={focusedPageId}
          style={{
            position: 'absolute',
            left: focusedPage?.wx ?? activePageIdx * (vpWidth + PAGE_GAP),
            top: focusedPage?.wy ?? 0,
            width: vpWidth,
            minHeight: VIEWPORT_H,
            background: 'transparent',
            overflow: 'hidden',
            transform: 'translateZ(0)',
          }}
        >

        {/* Viewport fold line — dashed line marking where the viewport ends.
            Content below this line exists on the page but is not visible
            without scrolling in the real browser. */}
        <div
          data-builder-overlay="fold-line"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: VIEWPORT_H,
            height: 0,
            borderTop: '1.5px dashed rgba(99, 130, 246, 0.45)',
            pointerEvents: 'none',
            zIndex: 9990,
          }}
        >
          <span style={{
            position: 'absolute',
            right: 10,
            top: 4,
            fontSize: 9,
            color: 'rgba(99, 130, 246, 0.65)',
            userSelect: 'none',
            fontFamily: 'monospace',
            letterSpacing: '0.02em',
          }}>
            {VIEWPORT_H}px — viewport
          </span>
        </div>

        {/* Transparent capture overlay — sits above all SDUI content.
            Intercepts ALL pointer events so buttons/inputs/links never fire.
            Also acts as the HTML5 drag source for moving existing canvas nodes. */}
        {tool !== 'hand' && (
          <div
            ref={captureOverlayRef}
            draggable
            data-builder-overlay="capture"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 9999,
              cursor: 'default',
              // Let pointer events through to the contenteditable element while editing
              pointerEvents: editingId ? 'none' : undefined,
            }}
            onMouseMove={handleOverlayMouseMove}
            onMouseLeave={handleOverlayMouseLeave}
            onDoubleClick={e => {
              const hit = hitTest(e.clientX, e.clientY);
              if (hit.kind !== 'node') return;

              // 1. Walk UP the DOM from the hit element to find a text-editable node
              let editId: string | null = null;
              let el: HTMLElement | null = document.querySelector(`[data-builder-id="${hit.id}"]`);
              while (el) {
                const nid = el.dataset.builderId;
                if (nid) {
                  const n = findNode(useBuilderStore.getState().pageNodes, nid);
                  if (n && TEXT_NODE_TYPES.has(n.type)) { editId = nid; break; }
                }
                el = el.parentElement?.closest('[data-builder-id]') as HTMLElement | null;
              }

              // 2. Fallback: if hit node is a container, find first text-type direct child
              if (!editId) {
                const hitNode = findNode(useBuilderStore.getState().pageNodes, hit.id);
                if (hitNode) {
                  const findTextChild = (node: typeof hitNode): string | null => {
                    for (const child of (node.children ?? [])) {
                      if (TEXT_NODE_TYPES.has(child.type) && 'text' in child) return child.id as string;
                      const deep = findTextChild(child);
                      if (deep) return deep;
                    }
                    return null;
                  };
                  editId = findTextChild(hitNode);
                }
              }

              if (!editId) return;
              setEditingId(editId);
            }}
            onPointerDown={e => {
              // If we're in text-edit mode and the user clicks outside the editing element, commit
              if (editingId) {
                const editingEl = editingElRef.current;
                if (editingEl && !editingEl.contains(e.target as Node)) {
                  commitInlineEdit();
                }
                return;
              }
              if (e.button !== 0) return;
              const hit = hitTest(e.clientX, e.clientY);
              if (hit.kind === 'node') {
                const { selectedIds: curIds } = useBuilderStore.getState();
                // Immediately pre-select so visual feedback is instant AND so that
                // onDragStart fires with the correct selectedIds already set.
                // Rules:
                //  • shift-click / cmd-click: skip here — onPointerUp adds/removes ONCE
                //    (calling select(id, true) twice toggles back to original → net no-op)
                //  • already selected: skip — preserve multi-selection for potential drag
                //    (onPointerUp will reduce to single-select if no drag actually happens)
                //  • new node, no modifier: select immediately for instant feedback
                if (!e.shiftKey && !e.metaKey && !curIds.includes(hit.id)) {
                  select(hit.id, false, hit.mapIndex);
                }
              }
            }}
            onDragStart={e => {
              // If marqueeStartRef is set it means onPointerDown decided this is a
              // marquee gesture (cursor on empty space, outside the selection box).
              // Cancel the HTML5 drag so the pointer events continue and the marquee
              // can update in onPointerMove → onPointerUp.
              if (marqueeStartRef.current) {
                e.preventDefault();
                return;
              }

              // Find the canvas node under the cursor when drag starts.
              // Fallback to the selected node when hitTest misses — this handles
              // CDP-simulated drag events (e.g. Playwright) where clientX/clientY
              // may be 0, and also lets users drag from any part of the overlay.
              let hit = hitTest(e.clientX, e.clientY);
              if (hit.kind !== 'node') {
                const { selectedIds } = useBuilderStore.getState();
                if (selectedIds.length > 0) {
                  hit = { kind: 'node' as const, id: selectedIds[0], mapIndex: useBuilderStore.getState().selectedMapIndex ?? 0 };
                }
              }
              if (hit.kind !== 'node') {
                e.preventDefault();
                return;
              }

              // Prefer a selected ancestor — handles ButtonText → Button.
              // If nothing is selected, walk up to find the root-most ancestor
              // (the top-level node with no further data-builder-id parent).
              let dragId = hit.id;
              const { selectedIds } = useBuilderStore.getState();
              if (!selectedIds.includes(dragId)) {
                let el = document.querySelector(`[data-builder-id="${dragId}"]`) as HTMLElement | null;
                let found = false;
                while (el) {
                  el = el.parentElement?.closest('[data-builder-id]') as HTMLElement | null;
                  if (!el?.dataset.builderId) break;
                  if (selectedIds.includes(el.dataset.builderId)) {
                    dragId = el.dataset.builderId;
                    found = true;
                    break;
                  }
                  // Keep walking up to find the root ancestor
                  dragId = el.dataset.builderId;
                }
                // If we walked up without finding a selected ancestor, dragId is now
                // the topmost ancestor — that is the intended drag target.
                void found;
              }

              // Auto-escalate context-bound nodes to their required parent.
              // e.g. dragging InputField → drag Input instead; ButtonText → Button.
              // Without this, the user clicks on the text field (selecting InputField),
              // tries to drag, and REQUIRED_PARENT in moveNode silently blocks the move.
              const dragNodeForEscalation = findNode(useBuilderStore.getState().pageNodes, dragId);
              if (dragNodeForEscalation?.type && REQUIRED_PARENT[dragNodeForEscalation.type]) {
                const requiredParentType = REQUIRED_PARENT[dragNodeForEscalation.type];
                let el2 = document.querySelector(`[data-builder-id="${dragId}"]`) as HTMLElement | null;
                while (el2) {
                  el2 = el2.parentElement?.closest('[data-builder-id]') as HTMLElement | null;
                  if (!el2?.dataset.builderId) break;
                  const parentNode = findNode(useBuilderStore.getState().pageNodes, el2.dataset.builderId);
                  if (parentNode?.type === requiredParentType) {
                    dragId = el2.dataset.builderId;
                    // Also update the selection so the right thing is highlighted
                    select(dragId, false);
                    break;
                  }
                }
              }

              draggingNodeIdRef.current = dragId;
              dragSourcePageIdRef.current = useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId;
              e.dataTransfer.setData('text/canvas-node-id', dragId);
              e.dataTransfer.effectAllowed = 'move';

              // Collect all IDs being dragged: if the grabbed node is part of the
              // current selection, drag ALL selected nodes together; otherwise drag only it.
              const allDragIds = selectedIds.includes(dragId) && selectedIds.length > 1
                ? [...selectedIds]
                : [dragId];
              multiDragIdsRef.current = allDragIds;

              const nodeEl = document.querySelector(`[data-builder-id="${dragId}"]`) as HTMLElement | null;
              const nr = nodeEl?.getBoundingClientRect();
              const ox = nr ? e.clientX - nr.left : 0;
              const oy = nr ? e.clientY - nr.top  : 0;
              grabOffsetRef.current = { x: ox, y: oy };

              // For absolute/fixed nodes dragged SOLO: suppress the browser ghost
              // so the real element serves as the live CSS preview (tracks the cursor
              // via onDragOver).  Record the original style for cancel-rollback.
              // For MULTI-drags: always use the composite ghost path regardless of
              // whether the primary node is absolute — all nodes must move together
              // and the invisible-ghost path never fades/tracks the other nodes.
              const draggedNodeData = findNode(useBuilderStore.getState().pageNodes, dragId);
              const nodeClasses = (draggedNodeData?.props as { className?: string })?.className ?? '';
              const isAbsPos = /\babsolute\b/.test(nodeClasses) || /\bfixed\b/.test(nodeClasses);
              if (isAbsPos && allDragIds.length <= 1) {
                // Force parent to have position:relative so CSS left/top
                // resolve against it from the very first onDragOver frame.
                const parentOfDragged = findParentNode(useBuilderStore.getState().pageNodes, dragId);
                ensureParentRelative(parentOfDragged?.id ?? null);

                const storedStyle = (draggedNodeData?.props as { style?: Record<string, string> })?.style ?? {};
                dragStartStyleRef.current = {
                  left: storedStyle.left ?? '',
                  top:  storedStyle.top  ?? '',
                };
                // Set overflow:visible on internal ancestors (up to the page frame)
                // so the node isn't clipped when dragged across container boundaries.
                if (nodeEl) {
                  patchAncestorOverflow(nodeEl);
                }

                // Pre-create a floating clone for when the element leaves the page.
                // The real element is clipped by the page frame's overflow:hidden, so
                // this clone follows the cursor in world space as visual feedback.
                // Dimensions are in world-space px — the world container's
                // transform:scale(zoom) brings them to screen size automatically.
                if (nodeEl && nr) {
                  const liveZoom = zoomRef.current;
                  const clone = nodeEl.cloneNode(true) as HTMLElement;
                  sanitizeGhostClone(clone);
                  clone.style.position = 'absolute';
                  clone.style.left = '-9999px';
                  clone.style.top = '-9999px';
                  clone.style.width = `${nr.width / liveZoom}px`;
                  clone.style.height = `${nr.height / liveZoom}px`;
                  clone.style.overflow = 'hidden';
                  clone.style.opacity = '0.65';
                  clone.style.pointerEvents = 'none';
                  clone.style.zIndex = '10';
                  worldRef.current?.appendChild(clone);
                  absGhostRef.current = { clone, w: nr.width / liveZoom, h: nr.height / liveZoom };
                }

                // Invisible 1×1 offscreen element as ghost → browser shows nothing,
                // the real element stays in place and we move it ourselves.
                const ghost = document.createElement('div');
                ghost.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 0, 0);
                requestAnimationFrame(() => {
                  document.body.removeChild(ghost);
                  // Hide selection overlays (padding fills, crosshairs, resize
                  // handles) while the abs node is being dragged live.
                  setIsDragging(true);
                });
              } else {
                dragStartStyleRef.current = null;

                // Build a composite ghost image from all dragged elements.
                // We place it OUTSIDE the canvas container so it is not affected
                // by the canvas CSS scale(zoom), keeping the ghost at the correct
                // logical size. For multiple selected nodes the ghost shows all of
                // them at their relative positions — just like Figma.
                const rects = allDragIds
                  .map(id => ({
                    id,
                    el:   document.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null,
                    rect: (document.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null)
                            ?.getBoundingClientRect() ?? null,
                  }))
                  .filter((r): r is typeof r & { el: HTMLElement; rect: DOMRect } => !!r.el && !!r.rect);

                if (rects.length > 0) {
                  const minX = Math.min(...rects.map(r => r.rect.left));
                  const minY = Math.min(...rects.map(r => r.rect.top));
                  const maxX = Math.max(...rects.map(r => r.rect.right));
                  const maxY = Math.max(...rects.map(r => r.rect.bottom));

                  // The elements on canvas are rendered inside transform:scale(zoom).
                  // getBoundingClientRect() returns screen-space sizes (already zoomed).
                  // The ghost lives in <body> (no canvas transform), so we size the
                  // wrapper at screen-pixel dimensions and apply transform:scale(zoom)
                  // on each clone so its internal children layout identically to how
                  // they did inside the canvas. Without this, nested content expands
                  // to its natural (unzoomed) size and the ghost appears too large.
                  const liveZoom = zoomRef.current;
                  const ghostW = maxX - minX;
                  const ghostH = maxY - minY;

                  const ghostEl = document.createElement('div');
                  ghostEl.style.cssText = `position:fixed;left:-9999px;top:-9999px;pointer-events:none;width:${ghostW}px;height:${ghostH}px;overflow:hidden;`;
                  document.body.appendChild(ghostEl);

                  for (const { el, rect } of rects) {
                    const clone = el.cloneNode(true) as HTMLElement;
                    sanitizeGhostClone(clone);
                    clone.style.position = 'absolute';
                    clone.style.left     = `${rect.left - minX}px`;
                    clone.style.top      = `${rect.top  - minY}px`;
                    // Set dimensions to the LOGICAL (unzoomed) size and apply
                    // scale(zoom) so the clone's internal layout matches the canvas.
                    clone.style.width    = `${rect.width / liveZoom}px`;
                    clone.style.height   = `${rect.height / liveZoom}px`;
                    clone.style.margin   = '0';
                    clone.style.transform = `scale(${liveZoom})`;
                    clone.style.transformOrigin = 'top left';
                    clone.style.opacity  = '1';
                    ghostEl.appendChild(clone);
                  }

                  const ghostOx = e.clientX - minX;
                  const ghostOy = e.clientY - minY;
                  e.dataTransfer.setDragImage(ghostEl, ghostOx, ghostOy);

                  requestAnimationFrame(() => {
                    document.body.removeChild(ghostEl);
                    // Fade originals after the ghost snapshot is captured
                    const faded: HTMLElement[] = [];
                    for (const { el: fadeEl } of rects) {
                      fadeEl.style.opacity = '0.3';
                      faded.push(fadeEl);
                    }
                    draggedElRef.current = faded;
                    setIsDragging(true);
                  });
                }
              }
            }}
            onDragEnd={() => {
              // Restore all faded source elements (multi-drag may have faded several).
              for (const el of draggedElRef.current) el.style.opacity = '';
              draggedElRef.current = [];
              multiDragIdsRef.current = [];
              setIsDragging(false);
              // Restore overflow:visible patches and floating ghost
              restoreOverflowPatches();
              removeAbsGhost();

              // If we were dragging an absolute node and there was no drop (drag
              // cancelled / pressed Esc), restore the element to its original
              // position so it doesn't appear stuck at the last dragover position.
              const prevDragId = draggingNodeIdRef.current;
              if (prevDragId && dragStartStyleRef.current) {
                const el = document.querySelector(`[data-builder-id="${prevDragId}"]`) as HTMLElement | null;
                if (el) {
                  el.style.left = dragStartStyleRef.current.left;
                  el.style.top  = dragStartStyleRef.current.top;
                }
              }
              dragStartStyleRef.current = null;

              draggingNodeIdRef.current = null;
              dragSourcePageIdRef.current = null;
              absDragPosRef.current = null;
              grabOffsetRef.current = { x: 0, y: 0 };
              stickySnapRef.current = { x: null, y: null };
              // Safety-net: clear any stale marquee left by onPointerDown not
              // being matched by onPointerUp (browser eats pointer events during drag)
              marqueeStartRef.current = null;
              setMarquee(null);
              setIsDroppingVariant(false);
              setDropContainerId(null);
              setDropLineY(null);
              setDropLineX(null);
              setAbsDragPos(null);
              setSnapGuides([]);
            }}
          />
        )}
      </div>}
      {/* ── End active page frame ── */}

      {/* ── Inter-page measurement annotations (only during page drag) ── */}

      {/* ── Freeform canvas nodes (Figma-style, outside page frames) ── */}
      {canvasNodes.map((cn: CanvasNode) => (
        <div
          key={cn.id}
          data-builder-canvas-node={cn.id}
          style={{
            position: 'absolute',
            left: cn._cx,
            top: cn._cy,
            ...(cn._cw != null && cn._ch != null ? { width: cn._cw, height: cn._ch } : {}),
            overflow: 'visible',
            minWidth: cn._cw ?? 'max-content',
            minHeight: cn._ch ?? 'max-content',
          }}
        >
          <CanvasNodeEngine node={cn} />
          {/* Capture overlay — blocks native interactions (text editing, button clicks)
              and enables hit-testing for selection, hover, and drag */}
          <div
            draggable
            data-builder-canvas-overlay={cn.id}
            style={{ position: 'absolute', inset: 0, zIndex: 9999, cursor: 'default' }}
            onMouseMove={e => {
              const overlay = e.currentTarget;
              overlay.style.pointerEvents = 'none';
              const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
              overlay.style.pointerEvents = '';
              const builderEl = el?.closest('[data-builder-id]') as HTMLElement | null;
              const hid = builderEl?.dataset.builderId ?? cn.id;
              hover(hid);
              overlayNotifyRef.current?.();
            }}
            onMouseLeave={() => { hover(null); overlayNotifyRef.current?.(); }}
            onClick={e => {
              e.stopPropagation();
              const overlay = e.currentTarget;
              overlay.style.pointerEvents = 'none';
              const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
              overlay.style.pointerEvents = '';
              const builderEl = el?.closest('[data-builder-id]') as HTMLElement | null;
              const nodeId = builderEl?.dataset.builderId ?? cn.id;
              select(nodeId, e.shiftKey || e.metaKey);
            }}
            onDragStart={e => {
              const wrapperEl = e.currentTarget.parentElement!;
              e.dataTransfer.setData('text/canvas-node-id', cn.id);
              e.dataTransfer.effectAllowed = 'move';
              draggingNodeIdRef.current = cn.id;
              draggingCanvasNodeRef.current = true;
              const nr = wrapperEl.getBoundingClientRect();
              grabOffsetRef.current = { x: e.clientX - nr.left, y: e.clientY - nr.top };
              const ghost = document.createElement('div');
              ghost.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
              document.body.appendChild(ghost);
              e.dataTransfer.setDragImage(ghost, 0, 0);
              requestAnimationFrame(() => {
                document.body.removeChild(ghost);
                setIsDragging(true);
              });
            }}
            onDragEnd={() => {
              const prevId = draggingNodeIdRef.current;
              draggingNodeIdRef.current = null;
              if (draggingCanvasNodeRef.current && prevId) {
                const cn2 = (useBuilderStore.getState().canvasNodes as { id: string; _cx: number; _cy: number }[]).find(n => n.id === prevId);
                const wrapper = document.querySelector(`[data-builder-canvas-node="${prevId}"]`) as HTMLElement | null;
                if (cn2 && wrapper) {
                  wrapper.style.left = `${cn2._cx}px`;
                  wrapper.style.top = `${cn2._cy}px`;
                }
                if (wrapper) {
                  wrapper.style.opacity = '';
                  wrapper.style.pointerEvents = '';
                }
              }
              draggingCanvasNodeRef.current = false;
              setIsDragging(false);
              setAbsDragPos(null);
              absDragPosRef.current = null;
              setSnapGuides([]);
              stickySnapRef.current = { x: null, y: null };
            }}
          />
        </div>
      ))}

      </div>
      {/* ── End world container ── */}

      {/* ── Marquee selection rectangle ── */}
      {marquee && (
        <div
          data-testid="marquee-rect"
          style={{
            position: 'absolute',
            left:   marquee.x,
            top:    marquee.y,
            width:  marquee.w,
            height: marquee.h,
            border: '1px solid #3b82f6',
            background: 'rgba(59,130,246,0.1)',
            pointerEvents: 'none',
            zIndex: 99990,
          }}
        />
      )}

      {/* ── Overlay ── */}
      <BuilderOverlay
        zoom={zoom}
        panX={activePanX}
        panY={panY}
        canvasRef={canvasRef}
        selectedIds={selectedIds}
        hoveredId={hoveredId}
        altHoveredId={altHoveredId}
        altMode={altMode}
        isDroppingVariant={isDroppingVariant}
        dropLineY={dropLineY}
        dropLineX={dropLineX}
        dropContainerId={dropContainerId}
        pageNodes={pageNodes}
        gridOverlay={gridOverlay}
        onResizeStart={onResizeStart}
        isDragging={isDragging}
        notifyRef={overlayNotifyRef}
        overlayInstantUpdateRef={overlayInstantUpdateRef}
        liveZoomRef={zoomRef}
      />

      {/* ── Context menu ── */}
      {ctxMenu && (
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          nodeId={ctxMenu.nodeId}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* ── Snap guide lines ── */}
      {(() => {
        const snapPanX = absDragPos?.isWorldSpace ? panX : activePanX;
        return snapGuides.map((g, i) =>
        g.axis === 'x' ? (
          <div
            key={`sg-${i}`}
            data-testid="snap-guide"
            data-snap-type={g.type}
            data-snap-axis="x"
            style={{
              position: 'absolute',
                left:   snapPanX + g.position * zoom,
              top:    panY + g.start    * zoom,
              width:  1,
              height: Math.max(1, (g.end - g.start) * zoom),
              background: g.type === 'center' ? '#a78bfa' : g.type === 'spacing' ? '#34d399' : '#f43f5e',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        ) : (
          <div
            key={`sg-${i}`}
            data-testid="snap-guide"
            data-snap-type={g.type}
            data-snap-axis="y"
            style={{
              position: 'absolute',
                left:   snapPanX + g.start    * zoom,
                top:    panY + g.position * zoom,
                width:  Math.max(1, (g.end - g.start) * zoom),
                height: 1,
                background: g.type === 'center' ? '#a78bfa' : g.type === 'spacing' ? '#34d399' : '#f43f5e',
                pointerEvents: 'none',
                zIndex: 9999,
              }}
            />
          )
        );
      })()}

      {/* ── Page-level snap guide lines (world coords) ── */}
      {pageSnapGuides.map((g, i) =>
        g.axis === 'x' ? (
          <div
            key={`psg-${i}`}
            data-testid="page-snap-guide"
            style={{
              position: 'absolute',
              left:   panX + g.position * zoom,
              top:    panY + g.start    * zoom,
              width:  1,
              height: Math.max(1, (g.end - g.start) * zoom),
              background: g.type === 'center' ? '#a78bfa' : g.type === 'spacing' ? '#34d399' : '#f43f5e',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        ) : (
          <div
            key={`psg-${i}`}
            data-testid="page-snap-guide"
            style={{
              position: 'absolute',
              left:   panX + g.start    * zoom,
              top:    panY + g.position * zoom,
              width:  Math.max(1, (g.end - g.start) * zoom),
              height: 1,
              background: g.type === 'center' ? '#a78bfa' : g.type === 'spacing' ? '#34d399' : '#f43f5e',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        )
      )}

      {/* ── Absolute-drag crosshair + position tooltip ── */}
      {absDragPos && (() => {
        const crosshairPanX = absDragPos.isWorldSpace ? panX : activePanX;
        return (
        <>
          {/* Vertical line */}
          <div style={{
            position: 'absolute',
              left: crosshairPanX + absDragPos.x * zoom,
            top: panY,
            bottom: 0,
            width: 1,
            background: 'rgba(99,179,237,0.55)',
            pointerEvents: 'none',
            zIndex: 9998,
          }} />
          {/* Horizontal line */}
          <div style={{
            position: 'absolute',
              left: crosshairPanX,
            right: 0,
            top: panY + absDragPos.y * zoom,
            height: 1,
            background: 'rgba(99,179,237,0.55)',
            pointerEvents: 'none',
            zIndex: 9998,
          }} />
          {/* Coordinates tooltip near the cursor */}
          <div style={{
            position: 'fixed',
            left: absDragPos.clientX + 14,
            top:  absDragPos.clientY - 28,
            background: '#1e293b',
            color: '#93c5fd',
            padding: '2px 7px',
            borderRadius: 4,
            fontSize: 10,
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 99999,
            border: '1px solid #334155',
            whiteSpace: 'nowrap',
          }}>
              {Math.round(absDragPos.x)} × {Math.round(absDragPos.y)}
          </div>
        </>
        );
      })()}

      {/* ── Zoom controls ── */}
      <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', gap: 4, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '4px 6px', pointerEvents: 'all' }}>
        <ZoomBtn label="−" testId="zoom-out" onClick={() => setZoom(Math.max(MIN_ZOOM, zoom / 1.25))} />
        <button data-testid="zoom-label" style={{ fontSize: 11, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer', minWidth: 40, textAlign: 'center' }} onClick={fitToCanvas}>
          {Math.round(zoom * 100)}%
        </button>
        <ZoomBtn label="+" testId="zoom-in" onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 1.25))} />
      </div>

      {/* ── Show Interactions toggle ── */}
      {/* Positioned above the state bar (bottom: ~40px) so it's not covered */}
      <div style={{ position: 'absolute', bottom: 52, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4, pointerEvents: 'all', zIndex: 9991 }}>
        <button
          data-testid="toggle-interaction-lines"
          onClick={() => setShowInteractionLines(!showInteractionLines)}
          style={{
            background: showInteractionLines ? '#1d4ed8' : '#1f2937',
            border: `1px solid ${showInteractionLines ? '#3b82f6' : '#374151'}`,
            borderRadius: 6,
            color: showInteractionLines ? '#bfdbfe' : '#9ca3af',
            fontSize: 10,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          ⚡ {showInteractionLines ? 'Hide' : 'Show'} interactions (V)
        </button>
      </div>

      {/* ── State Bar ── */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 9990, pointerEvents: 'all' }}>
        <StateBar />
      </div>

      {/* ── Canvas toast (resize guard messages, etc.) ── */}
      {canvasToast && (
        <div
          data-testid="canvas-toast"
          style={{
            position: 'absolute', bottom: 52, left: '50%', transform: 'translateX(-50%)',
            background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
            padding: '8px 14px', zIndex: 9995, pointerEvents: 'none',
            fontSize: 12, color: '#fbbf24', whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {canvasToast}
        </div>
      )}
    </div>
  );
}


