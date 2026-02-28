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

import React, { useRef, useEffect, useCallback, useMemo, useState, memo } from 'react';
import { useBuilderStore, findNode, findParentNode, VIEWPORT_WIDTHS } from './_store';
import BuilderOverlay, { type ResizeHandle } from './_overlay';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import appConfig from '@/config/app';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { SDUINode } from '@/lib/sdui/types/node';
import { computeSnap, snapResizeSize, SNAP_THRESHOLD, type SnapGuide, type ContentRect } from './_snap-engine';
import { removeTwToken } from './_tw-utils';

/** Node types that act as containers and accept dropped children. */
// Keep in sync with isContainer in _panel-right.tsx
const CONTAINER_TYPES = new Set([
  'Box', 'VStack', 'HStack', 'Center', 'Grid', 'GridItem',
  'ScrollView', 'View', 'Card', 'SafeAreaView', 'Pressable',
  'Checkbox', 'CheckboxGroup', 'Radio', 'RadioGroup',
  'Badge', 'Avatar', 'Fab', 'Skeleton', 'Alert', 'Link',
  'Modal', 'ModalContent', 'ModalHeader', 'ModalBody', 'ModalFooter',
  'Tooltip', 'AlertDialog', 'AlertDialogContent',
  'AlertDialogHeader', 'AlertDialogBody', 'AlertDialogFooter',
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = appConfig as any;

const VIEWPORT_H   = 900;

// ─── Canvas context menu ──────────────────────────────────────────────────────

interface CanvasCtxMenuProps {
  x: number; y: number;
  nodeId: string | null;
  onClose: () => void;
}

function CanvasContextMenu({ x, y, nodeId, onClose }: CanvasCtxMenuProps) {
  const store = useBuilderStore();

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-canvas-ctx-menu]')) onClose(); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);

  const nodeItems = nodeId ? [
    { label: 'Copy',         action: () => { store.select(nodeId); store.copyToClipboard(); } },
    { label: 'Duplicate',    action: () => store.duplicateNodes([nodeId]) },
    { label: 'Move Up',      action: () => store.moveNodeUp(nodeId) },
    { label: 'Move Down',    action: () => store.moveNodeDown(nodeId) },
    { label: 'Select Parent',action: () => store.selectParent(nodeId) },
    null,
    { label: 'Delete', action: () => store.deleteNodes([nodeId]), danger: true },
  ] : [
    { label: 'Select All',    action: () => store.selectAll() },
    { label: 'Paste',         action: () => store.pasteFromClipboard() },
    { label: 'Paste in Place',action: () => store.pasteInPlace() },
  ];

  return (
    <div
      data-canvas-ctx-menu="1"
      data-testid={nodeId ? 'canvas-node-ctx-menu' : 'canvas-empty-ctx-menu'}
      style={{ position: 'fixed', left: x, top: y, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, zIndex: 99999, minWidth: 160, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
    >
      {nodeItems.map((item, i) =>
        item === null ? (
          <div key={i} style={{ height: 1, background: '#374151', margin: '2px 0' }} />
        ) : (
          <button
            key={item.label}
            style={{ display: 'block', width: '100%', padding: '7px 14px', background: 'none', border: 'none', color: (item as { danger?: boolean }).danger ? '#f87171' : '#d1d5db', fontSize: 12, fontFamily: 'system-ui', textAlign: 'left', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#374151')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={() => { item.action(); onClose(); }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
const MIN_ZOOM     = 0.01;
const MAX_ZOOM     = 4;
const DRAG_THRESHOLD = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _nodeCounter = 0;
function nextId(prefix: string) { return `${prefix}-${++_nodeCounter}`; }

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
  'Text', 'Heading', 'ButtonText',
  'CheckboxLabel', 'RadioLabel',
  'TabTitle', 'AccordionTitle',
  'SelectItem', 'SelectInput',
  'AlertTitle', 'AlertDescription',
  'ToastTitle', 'ToastDescription',
]);

/**
 * Certain container types only accept specific child types.
 * Dropping anything else into them will crash the renderer.
 * Key = parent type, Value = allowed child types (empty Set = allow all).
 */
const ALLOWED_CHILDREN: Record<string, Set<string>> = {
  Button: new Set(['ButtonText', 'NavIcon']),
};

/**
 * Memoized wrapper around SDUIEngine for the active page.
 * Prevents the entire SDUI tree from re-rendering when the canvas pan/zoom/hover
 * state changes — those updates only affect the canvas transforms and overlays,
 * not the page content.
 */
const PageEngine = memo(function PageEngine({ pageConfig }: { pageConfig: SDUIConfig }) {
  if (!pageConfig.ui) return <EmptyCanvas />;
  return (
    <SDUIEngine
      key="builder-engine"
      config={pageConfig}
      configName="builder"
      actionsConfig={app.actions}
      routes={app.routes}
      builderMode
    />
  );
});

/**
 * Memoized wrapper around SDUIEngine for inactive (background) pages.
 * Receives a stable `nodes` reference — only re-renders when that page's
 * node tree actually changes, not on every pan/zoom/hover update.
 */
const InactivePageEngine = memo(function InactivePageEngine({
  pageId,
  configName,
  nodes,
}: {
  pageId: string;
  configName: string;
  nodes: SDUINode[];
}) {
  if (!nodes.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: VIEWPORT_H, gap: 8, color: '#9ca3af', fontFamily: 'system-ui', userSelect: 'none' }}>
        <div style={{ fontSize: 24, opacity: 0.3 }}>+</div>
        <div style={{ fontSize: 12 }}>Empty page</div>
      </div>
    );
  }
  const cfg: SDUIConfig = {
    state: {},
    ui: {
      type: 'Box',
      props: { className: 'flex flex-col w-full min-h-screen items-start relative' },
      children: nodes,
    } as SDUIConfig['ui'],
  };
  return (
    <SDUIEngine
      key={`pg-${pageId}`}
      config={cfg}
      configName={configName}
      actionsConfig={app.actions ?? {}}
      routes={app.routes ?? []}
      builderMode
    />
  );
});

export default function BuilderCanvas() {
  const canvasRef          = useRef<HTMLDivElement>(null);
  const pageFrameRef       = useRef<HTMLDivElement>(null);
  const captureOverlayRef  = useRef<HTMLDivElement>(null);
  // Track the last hovered id so we skip Zustand updates when it hasn't changed.
  const lastHoveredIdRef   = useRef<string | null>(null);
  // World container and dot-grid pattern — updated imperatively during pan/zoom
  // so React never re-renders just because the viewport moved.
  const worldRef           = useRef<HTMLDivElement>(null);
  const gridPatternRef     = useRef<SVGPatternElement>(null);
  // Debounce timer for syncing pan/zoom state back to Zustand after gesture ends.
  const syncTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref populated by BuilderOverlay — call to trigger a burst of measurement ticks.
  const overlayNotifyRef          = useRef<(() => void) | null>(null);
  // Ref populated by BuilderOverlay — synchronous BCR update, zero lag during pan.
  const overlayInstantUpdateRef   = useRef<(() => void) | null>(null);
  // Tracks the page a canvas-node drag originated from, so cross-page drops work correctly.
  const dragSourcePageIdRef       = useRef<string | null>(null);

  const {
    pageNodes,
    selectedIds,
    hoveredId,
    altHoveredId,
    altMode,
    tool,
    zoom, panX, panY,
    viewport,
    setZoom, setPan,
    gridOverlay,
    select,
    hover,
    setAltMode,
    setAltHovered,
    addSection,
    addNode,
    moveNode,
    moveNodes,
    moveNodeFromPage,
    patchProp,
    _pushHistory,
    pages,
    currentPageId,
    switchPage,
    pendingFitToPage,
    clearPendingFit,
  } = useBuilderStore();

  // ── World transform helpers ───────────────────────────────────────────────
  //
  // Applies pan/zoom directly to the DOM world container and the dot grid
  // pattern WITHOUT going through React state → zero re-renders during scroll.

  /** Apply pan/zoom directly to the world container and dot-grid pattern. */
  const applyWorldTransform = useCallback((px: number, py: number, z: number) => {
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
    }
    if (gridPatternRef.current) {
      const size = 20 * z;
      gridPatternRef.current.setAttribute('x', String(px % size));
      gridPatternRef.current.setAttribute('y', String(py % size));
      gridPatternRef.current.setAttribute('width', String(size));
      gridPatternRef.current.setAttribute('height', String(size));
    }
    // Synchronously reposition the selection ring — getBoundingClientRect() called
    // here forces a layout reflow that already accounts for the new transform, so
    // the ring updates in the same frame with zero React re-render lag.
    overlayInstantUpdateRef.current?.();
    // Also kick the async RAF for hover rings, padding fills, etc.
    overlayNotifyRef.current?.();
  }, []);

  /**
   * Debounced Zustand sync — called after a scroll/pan gesture settles.
   * Triggers exactly one React re-render per gesture instead of one per frame.
   */
  const scheduleStoreSync = useCallback((px: number, py: number, z: number) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      setZoom(z);
      setPan(px, py);
      syncTimerRef.current = null;
    }, 80);
  }, [setZoom, setPan]);

  // ── Dynamic viewport width ────────────────────────────────────────────────
  const vpWidth = VIEWPORT_WIDTHS[viewport];

  // When the viewport breakpoint changes, the page frame width changes and all DOM
  // elements re-layout at new dimensions. We use a ResizeObserver on the page frame
  // so the overlay re-measures AFTER the browser finishes layout (ResizeObserver
  // callbacks fire post-layout, giving correct getBoundingClientRect() values).
  // A rAF is used so the overlay reads positions in the same frame as the paint,
  // avoiding a stale-layout read if ResizeObserver fires mid-commit.
  useEffect(() => {
    const frame = pageFrameRef.current;
    if (!frame) return;
    let rafId: number | undefined;
    const ro = new ResizeObserver(() => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = undefined;
        overlayInstantUpdateRef.current?.();
        overlayNotifyRef.current?.();
      });
    });
    ro.observe(frame);
    return () => {
      ro.disconnect();
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  // pageFrameRef is stable; only re-run if the ref object itself changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Horizontal gap (content-px) between page frames on the canvas. */
  const PAGE_GAP = 80;

  /** Index of the active page frame. */
  const activePageIdx = pages.findIndex(p => p.id === currentPageId);

  /** Canvas-space left offset of the ACTIVE page frame. */
  const activePanX = panX + activePageIdx * (vpWidth + PAGE_GAP) * zoom;

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
    x: number; y: number;             // content-space px (relative to parent)
    clientX: number; clientY: number; // screen px for tooltip placement
  } | null>(null);
  const absDragPosRef = useRef<typeof absDragPos>(null);

  // ── Snap guides ───────────────────────────────────────────────────────────
  // Guide lines shown during absolute-node drag and resize.
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  // ── Marquee selection ─────────────────────────────────────────────────────
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeStartRef = useRef<{ clientX: number; clientY: number } | null>(null);

  // ── Canvas right-click context menu ───────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);

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
      patchProp(editingId, 'props.style', {
        ...existingStyle,
        ...(origStyle.width  ? { width:  `${Math.round(r.width)}px`  } : {}),
        ...(origStyle.height ? { height: `${Math.round(r.height)}px` } : {}),
      });
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

  // Track the last page frame hovered during a panel drag (prevents redundant switchPage calls)
  const lastDragHoverPageRef = useRef<string | null>(null);

  // Keep refs in sync for wheel/drag handlers (avoids stale closure).
  // Also update the world container and dot grid when store values change
  // externally (e.g. fitToPage, toolbar zoom buttons).
  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  useEffect(() => {
    zoomRef.current = zoom;
    panXRef.current = panX;
    panYRef.current = panY;
    applyWorldTransform(panX, panY, zoom);
  }, [zoom, panX, panY, applyWorldTransform]);

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
   * Computed target for the next drop: where in the tree to insert.
   * Kept in a ref so onDrop can read the latest value without re-creating handlers.
   */
  const dropTargetRef = useRef<{ parentId: string | null; index: number } | null>(null);

  // ── Pan drag ──────────────────────────────────────────────────────────────

  const dragRef = useRef({ active: false, startX: 0, startY: 0, startPX: 0, startPY: 0, moved: false });

  // ── Fit to canvas (run once on mount) ────────────────────────────────────

  const fitToCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w        = VIEWPORT_WIDTHS[useBuilderStore.getState().viewport];
    const gap      = PAGE_GAP;
    const pgs      = useBuilderStore.getState().pages;
    const activeId = useBuilderStore.getState().currentPageId;
    const activeIdx = Math.max(0, pgs.findIndex(p => p.id === activeId));
    // Fit zoom so the active page fills ~85% of the canvas
    const z        = Math.min(c.clientWidth / w, c.clientHeight / VIEWPORT_H) * 0.85;
    // Center the active page frame horizontally
    const pageOffsetX = activeIdx * (w + gap); // content-space left edge of active page
    const px = (c.clientWidth - w * z) / 2 - pageOffsetX * z;
    const py = (c.clientHeight - VIEWPORT_H * z) / 2;
    setZoom(z); setPan(px, py);
  }, [setZoom, setPan]);

  useEffect(() => { fitToCanvas(); }, [fitToCanvas]);

  // When page content changes (prop edits, position changes, etc.) the selected
  // node may have moved. Re-measure immediately so the ring and handles don't
  // linger at the old position (e.g. after switching a node from static → absolute).
  useEffect(() => {
    overlayInstantUpdateRef.current?.();
    overlayNotifyRef.current?.();
  }, [pageNodes]);

  // Respond to explicit "navigate to page" requests from the pages panel.
  // When pendingFitToPage is set, the active page has already been switched
  // (currentPageId is up-to-date), so fitToCanvas will center on it correctly.
  useEffect(() => {
    if (!pendingFitToPage) return;
    fitToCanvas();
    clearPendingFit();
  }, [pendingFitToPage, fitToCanvas, clearPendingFit]);

  // ── Build SDUI config ────────────────────────────────────────────────────

  const pageConfig = useMemo<SDUIConfig>(() => ({
    state: {},
    ui: {
      type: 'Box',
      props: { className: 'flex flex-col w-full min-h-screen items-start relative' },
      children: pageNodes,
    } as SDUIConfig['ui'],
  }), [pageNodes]);

  // ── Wheel: Ctrl/Meta = zoom, else pan ─────────────────────────────────────
  //
  // Pan/zoom are applied DIRECTLY to the world container DOM element — no
  // React state update, no re-render.  Zustand is synced once after the
  // gesture settles via scheduleStoreSync (debounced ~80 ms).

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let newPX = panXRef.current;
      let newPY = panYRef.current;
      let newZoom = zoomRef.current;

      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.002;
        newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom * (1 + delta * 3)));
        const rect  = canvas.getBoundingClientRect();
        const cx    = e.clientX - rect.left;
        const cy    = e.clientY - rect.top;
        const ratio = newZoom / zoomRef.current;
        newPX = cx - ratio * (cx - panXRef.current);
        newPY = cy - ratio * (cy - panYRef.current);
      } else {
        newPX = panXRef.current - e.deltaX;
        newPY = panYRef.current - e.deltaY;
      }

      panXRef.current = newPX;
      panYRef.current = newPY;
      zoomRef.current = newZoom;

      // Instant visual update — zero React re-renders
      applyWorldTransform(newPX, newPY, newZoom);
      // Sync Zustand once the gesture settles
      scheduleStoreSync(newPX, newPY, newZoom);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [applyWorldTransform, scheduleStoreSync]);

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

        const builderEl = el.hasAttribute('data-builder-id')
          ? el
          : (el.closest('[data-builder-id]') as HTMLElement | null);

        if (builderEl?.dataset.builderId) {
          return builderEl.dataset.builderId;
        }
      }
      return null;
    };

    const found = checkElements(all);
    if (found) return { kind: 'node' as const, id: found };

    // At very low zoom, elements may be sub-pixel — expand the hit radius to
    // cover ~3 logical pixels in screen space so clicks still register.
    const liveZ = zoomRef.current;
    if (liveZ < 0.12) {
      const r = Math.ceil(3 / liveZ);
      const offsets: [number, number][] = [[-r,0],[r,0],[0,-r],[0,r],[-r,-r],[r,-r],[-r,r],[r,r]];
      for (const [dx, dy] of offsets) {
        const nearby = document.elementsFromPoint(clientX + dx, clientY + dy) as HTMLElement[];
        const nearbyFound = checkElements(nearby);
        if (nearbyFound) return { kind: 'node' as const, id: nearbyFound };
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
      if (insideAnyPage) {
        const hit = hitTest(e.clientX, e.clientY);
        if (hit.kind === 'node') {
          // If this node lives on a different page, auto-switch to it first
          const nodeEl = document.querySelector(`[data-builder-id="${hit.id}"]`);
          const pageEl = nodeEl?.closest('[data-builder-page-id]') as HTMLElement | null;
          const nodePageId = pageEl?.dataset.builderPageId;
          if (nodePageId && nodePageId !== useBuilderStore.getState().currentPageId) {
            switchPage(nodePageId);
          }
          select(hit.id, e.shiftKey || e.metaKey);
        } else {
          // Clicked empty space inside any page → just switch focus if needed
          const clickedPageEl = (e.target as Element).closest('[data-builder-page-id]') as HTMLElement | null;
          const pageId = clickedPageEl?.dataset.builderPageId;
          if (pageId && pageId !== useBuilderStore.getState().currentPageId) {
            switchPage(pageId);
          }
          select(null);
        }
      } else {
        // Clicked on the dark canvas background → deselect
        select(null);
      }
    }
    dragRef.current.active = false;
  }, [hitTest, select, marquee, switchPage]);

  // ── Capture overlay hover ─────────────────────────────────────────────────

  const handleOverlayMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    const id = hit.kind === 'node' ? hit.id : null;
    // Skip the Zustand update when the hovered node hasn't changed — avoids a
    // full BuilderCanvas re-render on every pixel of mouse movement.
    if (id !== lastHoveredIdRef.current) {
      lastHoveredIdRef.current = id;
      hover(id);
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
  ): HTMLElement | null => {
    const capOverlay = captureOverlayRef.current;
    const all = document.elementsFromPoint(clientX, clientY) as HTMLElement[];
    const activePgId = useBuilderStore.getState().currentPageId;
    for (const el of all) {
      if (el === capOverlay || capOverlay?.contains(el)) continue;
      if (el.hasAttribute('data-builder-overlay') || el.closest('[data-builder-overlay]')) continue;
      // Resolve to nearest ancestor with data-builder-id
      const builderEl = el.hasAttribute('data-builder-id')
        ? el
        : (el.closest('[data-builder-id]') as HTMLElement | null);
      if (!builderEl) continue;
      // Skip nodes being dragged so the parent container is found instead
      if (skipIds.has(builderEl.dataset.builderId ?? '')) continue;
      // Only target nodes inside the active page
      const pageFrame = builderEl.closest('[data-builder-page-id]') as HTMLElement | null;
      if (pageFrame && pageFrame.dataset.builderPageId !== activePgId) continue;
      return builderEl;
    }
    return null;
  }, []);

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
  function getAllSiblingRects(excludeId: string, parentEl: HTMLElement, z: number): ContentRect[] {
    const pr = parentEl.getBoundingClientRect();
    const els = parentEl.querySelectorAll<HTMLElement>('[data-builder-id]');
    const rects: ContentRect[] = [];
    for (const el of els) {
      const id = el.dataset.builderId!;
      if (id === excludeId) continue;
      // Only direct children in the same positioning context
      if ((el.parentElement?.closest('[data-builder-id]') as HTMLElement | null)?.dataset.builderId === excludeId) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rects.push({
        id,
        x: (r.left - pr.left) / z,
        y: (r.top  - pr.top)  / z,
        w: r.width  / z,
        h: r.height / z,
      });
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

    // ── Panel drops: auto-switch active page as cursor moves between frames ───
    // Canvas-node moves stay within their source page (cross-page moves aren't
    // supported because moveNode only operates on the current pageNodes tree).
    if (!isCanvasMove) {
      const els = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[];
      for (const el of els) {
        const pgEl = el.closest('[data-builder-page-id]') as HTMLElement | null;
        if (pgEl?.dataset.builderPageId) {
          const hovPageId = pgEl.dataset.builderPageId;
          if (hovPageId !== lastDragHoverPageRef.current) {
            lastDragHoverPageRef.current = hovPageId;
            if (hovPageId !== useBuilderStore.getState().currentPageId) {
              useBuilderStore.getState().switchPage(hovPageId);
            }
          }
          break;
        }
      }
    }

    // ── Absolute node: free-form positioning, skip drop-zone logic ────────────
    // Exception 1: multi-drag — when multiple nodes are selected and dragged
    // together, ALL must move as a flow group (absolute path only moves one node).
    // Exception 2: reparenting — if cursor is over a DIFFERENT container, fall
    // through to normal flow-drop so the node can be reparented.
    const draggingId = draggingNodeIdRef.current;
    // Compute multiDrag set early so the absolute-path check can use it.
    const earlyAllDraggingIds = multiDragIdsRef.current.length > 0
      ? multiDragIdsRef.current
      : (draggingId ? [draggingId] : []);
    if (draggingId) {
      const draggedNode = findNode(useBuilderStore.getState().pageNodes, draggingId);
      const cls = (draggedNode?.props as { className?: string })?.className ?? '';
      const isAbsPos = /\babsolute\b/.test(cls) || /\bfixed\b/.test(cls);
      // Only use the absolute-positioning path for single-node drags.
      // For multi-drags the flow-drop path handles all nodes together.
      if (isAbsPos && earlyAllDraggingIds.length <= 1) {
        // Absolute nodes always follow the cursor absolutely — no drop-line mode.
        // The "effective parent" (container the node will land in) is resolved
        // dynamically from whatever is under the cursor right now:
        //   • cursor over a named container  → use that container as parent
        //   • cursor over a leaf node        → use that leaf's parent
        //   • cursor over empty space        → use root (null)
        // Position is always computed relative to the effective parent, so the
        // node previews exactly where it will land.  On drop, onDrop reparents
        // first (if the parent changed) then sets left/top.
        const absCanvas = canvasRef.current;
        const absRect   = absCanvas?.getBoundingClientRect();
        if (absCanvas && absRect) {
          const currentParentNode = findParentNode(useBuilderStore.getState().pageNodes, draggingId);
          const currentParentId   = currentParentNode?.id ?? null;

          // Find the deepest element under cursor (excluding the dragged node).
          const hoveredEl  = findDropTargetElAt(e.clientX, e.clientY, new Set([draggingId]));
          let effectiveParentId: string | null = null;
          let effectiveParentEl: HTMLElement | null = null;

          if (hoveredEl) {
            const hovId   = hoveredEl.dataset.builderId!;
            const hovType = hoveredEl.dataset.builderType ?? '';
            const hovNode = findNode(useBuilderStore.getState().pageNodes, hovId);
            const hovIsContainer = CONTAINER_TYPES.has(hovType) ||
              ((hovNode?.children?.length ?? 0) > 0);
            // If the hovered node is itself absolute/fixed it is a sibling, not a
            // parent container — dropping "into" it makes no sense for an abs drag.
            const hovCls = (hovNode?.props as { className?: string })?.className ?? '';
            const hovIsAbs = /\b(absolute|fixed)\b/.test(hovCls);

            if (hovIsContainer && !hovIsAbs) {
              // Cursor is directly over a flow container → use it as parent.
              effectiveParentId = hovId;
              effectiveParentEl = hoveredEl;
            } else {
              // Cursor over a leaf node OR an absolute node → use that node's parent.
              // Also walk up past any absolute/fixed ancestors (e.g. cursor is on
              // ButtonText whose parent is an abs Button — still a sibling, not a
              // container we want to drop into).
              const pNodes = useBuilderStore.getState().pageNodes;
              let resolvedParent = findParentNode(pNodes, hovId);
              while (resolvedParent?.id) {
                const pCls = (resolvedParent.props as { className?: string })?.className ?? '';
                if (/\b(absolute|fixed)\b/.test(pCls)) {
                  resolvedParent = findParentNode(pNodes, resolvedParent.id);
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
          // effectiveParentId === null means root level (cursor over empty space).

          // Reset sticky snap state when the effective parent changes so stale
          // snap offsets from the old container don't pollute the new one.
          if (effectiveParentId !== currentParentId) {
            stickySnapRef.current = { x: null, y: null };
          }

          // Record which container we'd reparent into on drop.
          dropTargetRef.current = { parentId: effectiveParentId, index: 0 };

          // Resolve the DOM element to measure position against.
          if (!effectiveParentEl) {
            effectiveParentEl = effectiveParentId
              ? (document.querySelector(`[data-builder-id="${effectiveParentId}"]`) as HTMLElement | null)
              : (document.querySelector('[data-builder-page-frame]') as HTMLElement | null);
          }

          if (effectiveParentEl) {
            const pr   = effectiveParentEl.getBoundingClientRect();
            const z    = zoomRef.current;
            const grab = grabOffsetRef.current;
            const rawX = Math.round((e.clientX - pr.left - grab.x) / z);
            const rawY = Math.round((e.clientY - pr.top  - grab.y) / z);

            // ── Snap to siblings within the effective parent ──────────────────
            const nodeEl = document.querySelector(`[data-builder-id="${draggingId}"]`) as HTMLElement | null;
            const nodeW  = nodeEl ? nodeEl.getBoundingClientRect().width  / z : 0;
            const nodeH  = nodeEl ? nodeEl.getBoundingClientRect().height / z : 0;
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

            setSnapGuides(guides);

            if (nodeEl) {
              // x/y are in the effective parent's coordinate space — correct for
              // the eventual drop.  But for the live DOM preview the node is still
              // inside its ACTUAL parent, so we must offset by the difference
              // between the two parents' viewport origins.
              let liveLeft = x;
              let liveTop  = y;
              if (effectiveParentId !== currentParentId) {
                const actualParentEl = currentParentId
                  ? (document.querySelector(`[data-builder-id="${currentParentId}"]`) as HTMLElement | null)
                  : (document.querySelector('[data-builder-page-frame]') as HTMLElement | null);
                if (actualParentEl) {
                  const ar = actualParentEl.getBoundingClientRect();
                  liveLeft = x + (pr.left - ar.left) / z;
                  liveTop  = y + (pr.top  - ar.top)  / z;
                }
              }
              nodeEl.style.left = `${liveLeft}px`;
              nodeEl.style.top  = `${liveTop}px`;
            }

            const pos = { x, y, clientX: e.clientX, clientY: e.clientY };
            absDragPosRef.current = pos;
            setAbsDragPos(pos);
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
        // absCanvas unavailable — clear any stale indicators
        setDropLineY(null);
        setDropLineX(null);
        setDropContainerId(null);
        return;
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
    const draggingIdSet = new Set(allDraggingIds);

    // Find the SDUI node under cursor. Dragged nodes (opacity 0.3, still in DOM)
    // are skipped so we always resolve to their parent container instead of
    // treating the cursor position as empty/root-level.
    const hovEl = findDropTargetElAt(e.clientX, e.clientY, draggingIdSet);

    if (hovEl) {
      const nodeId   = hovEl.dataset.builderId!;
      const nodeType = hovEl.dataset.builderType ?? '';
      const nodeRect = hovEl.getBoundingClientRect();
      const relY     = (e.clientY - nodeRect.top) / nodeRect.height;

      // Check if the node is a container (by type or by having children)
      const nodeInTree = findNode(useBuilderStore.getState().pageNodes, nodeId);
      const isContainer = CONTAINER_TYPES.has(nodeType) || (nodeInTree?.children?.length ?? 0) > 0;

      // Prevent cycle drops: the hover container (nodeId) must NOT be inside the
      // subtree of any dragged node (which would create a parent → descendant cycle).
      // NOTE: the OLD check was inverted — it searched for dragged-id inside hovEl's
      // children, which is NORMAL for re-ordering within a container and must be allowed.
      const isDroppingIntoSelf = isContainer &&
        allDraggingIds.some(id => {
          const draggedNode = findNode(useBuilderStore.getState().pageNodes, id);
          if (!draggedNode?.children?.length) return false;
          // True only if the hover container lives inside the dragged node's subtree
          return !!findNode((draggedNode.children as SDUINode[]), nodeId);
        });

      // When hovering over the dragged node's own parent container, the edge
      // zones (relY < 0.2 or > 0.8) would normally send the node to the parent's
      // parent — but the user is trying to reorder within the same container.
      // Skip the edge-zone check in that case so the node always stays inside.
      const isHomeCont = isContainer && allDraggingIds.some(id => {
        const p = findParentNode(useBuilderStore.getState().pageNodes, id);
        return p?.id === nodeId;
      });
      const inDropZone = isHomeCont ? true : (relY > 0.2 && relY < 0.8);

      if (isContainer && !isDroppingIntoSelf && inDropZone) {
        // ── Drop INSIDE the container ──
        // Find the nearest gap within the container's children so we insert at
        // the correct position and show the line exactly there.
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
        const parent   = findParentNode(useBuilderStore.getState().pageNodes, nodeId);
        const parentId = parent?.id ?? null;
        const siblings: SDUINode[] = parent
          ? (parent.children as SDUINode[])
          : useBuilderStore.getState().pageNodes;
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
    // Restore all faded source elements immediately on drop (onDragEnd fires
    // after drop but draggingNodeIdRef is already null by then).
    for (const el of draggedElRef.current) el.style.opacity = '';
    draggedElRef.current = [];
    setIsDragging(false);

    const target   = dropTargetRef.current ?? { parentId: null, index: useBuilderStore.getState().pageNodes.length };
    // getData may return '' in CDP-simulated drags; fall back to the ref set in onDragStart
    const canvasNodeId = e.dataTransfer.getData('text/canvas-node-id') || draggingNodeIdRef.current || '';
    const variantId    = e.dataTransfer.getData('text/variant-id');
    const win = window as unknown as Record<string, unknown>;
    const primitive    = e.dataTransfer.getData('text/primitive-node') ||
                         // CDP fallback: panel sets __primitiveDrag on dragstart
                         (win.__primitiveDrag as string | undefined) || '';
    // Clear the CDP fallback regardless of whether it was used
    win.__primitiveDrag = undefined;

    if (canvasNodeId) {
      // ── Absolute node: apply style.left / style.top, don't reorder ──────────
      // Read from the ref (always current) rather than state (async, may be stale
      // when drop fires synchronously right after dragover).
      const pos = absDragPosRef.current;
      const draggedNode = findNode(useBuilderStore.getState().pageNodes, canvasNodeId);
      const cls = (draggedNode?.props as { className?: string })?.className ?? '';
      const isAbsNode = /\babsolute\b/.test(cls) || /\bfixed\b/.test(cls);
      // For multi-drags: skip the absolute path and use the flow path for all nodes.
      const isMultiDrag = multiDragIdsRef.current.length > 1;
      if (isAbsNode && !isMultiDrag) {
        const currentParent  = findParentNode(useBuilderStore.getState().pageNodes, canvasNodeId);
        const targetParentId = target.parentId;   // set by onDragOver abs path
        const isSameParent   = targetParentId === (currentParent?.id ?? null);

        // Reparent first (if the container changed), keeping the 'absolute' class.
        // The node stays absolutely positioned relative to its new parent.
        if (!isSameParent) {
          moveNode(canvasNodeId, targetParentId, target.index);
        }

        // Apply the exact pixel position the user dragged to.
        if (pos) {
          const existingStyle = (draggedNode?.props as { style?: Record<string, string> })?.style ?? {};
          patchProp(canvasNodeId, 'props.style', {
            ...existingStyle,
            left: `${pos.x}px`,
            top:  `${pos.y}px`,
          });
        }

        if (!isSameParent || pos) _pushHistory();
        absDragPosRef.current = null;
        setAbsDragPos(null);
        setSnapGuides([]);
        stickySnapRef.current = { x: null, y: null };
        dragStartStyleRef.current = null;
        draggingNodeIdRef.current = null;
        setDropLineY(null);
        setDropLineX(null);
        return;
      }
      // Moving an existing canvas node (or a group of selected nodes) to a new position
      const allIds = multiDragIdsRef.current;
      const srcPage = dragSourcePageIdRef.current;
      const curPage = useBuilderStore.getState().currentPageId;
      dragSourcePageIdRef.current = null;

      if (srcPage && srcPage !== curPage) {
        // Cross-page drag: node lives in a different page's nodes — use cross-page move
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
        // Guard: some containers only accept specific child types (e.g. Button → ButtonText).
        if (target.parentId) {
          const parentNode = findNode(useBuilderStore.getState().pageNodes, target.parentId);
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
    } else if (variantId) {
      const { sectionLibrary } = await import('@/lib/ai/section-library');
      try {
        const node = ensureIds(sectionLibrary.instantiate(variantId, {}) as unknown as SDUINode);
        addSection(variantId, node, target.index);
      } catch (err) { console.warn('Section drop failed:', err); }
    }

    setDropLineY(null);
    setDropLineX(null);
    draggingNodeIdRef.current = null;
    dragSourcePageIdRef.current = null;
    lastDragHoverPageRef.current = null;
  }, [addNode, addSection, moveNode, moveNodes, moveNodeFromPage, patchProp, _pushHistory]);

  // ── Resize: pointer-capture drag on handle ───────────────────────────────
  //
  // The handle sits inside the overlay (different DOM subtree from the canvas),
  // so we attach pointermove/pointerup listeners to `window` rather than
  // capturing on the canvas. This means the drag works even when the cursor
  // moves faster than React's synthetic event can follow.

  const onResizeStart = useCallback((id: string, handle: ResizeHandle, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const el    = document.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null;
    const frame = document.querySelector('[data-builder-page-frame]');
    if (!el || !frame) return;

    const r         = el.getBoundingClientRect();
    const fr        = frame.getBoundingClientRect();
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
      return find(useBuilderStore.getState().pageNodes, id);
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
      el.style.width  = `${newW}px`;
      el.style.height = `${newH}px`;

      // Synchronous ring update so handles track the new size in the same frame
      overlayInstantUpdateRef.current?.();
      overlayNotifyRef.current?.();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      setSnapGuides([]);

      // Commit final size to Zustand so the JSON config stays in sync
      useBuilderStore.getState().patchProp(id, 'props.style', {
        ...existingStyle,
        width:  `${lastW}px`,
        height: `${lastH}px`,
      });

      // When the user drags a resize handle they are explicitly setting a fixed pixel size.
      // Remove any Hug (w-fit / h-fit) or Fill (w-full / h-full) classes for the
      // affected dimensions so the Dimensions panel reflects Fixed mode correctly.
      const existingCls = (node?.props as { className?: string })?.className ?? '';
      let newCls = existingCls;
      if (handle.includes('e') || handle.includes('w')) {
        newCls = removeTwToken(removeTwToken(newCls, 'w-fit'), 'w-full');
      }
      if (handle.includes('n') || handle.includes('s')) {
        newCls = removeTwToken(removeTwToken(newCls, 'h-fit'), 'h-full');
      }
      if (newCls !== existingCls) {
        useBuilderStore.getState().patchProp(id, 'props.className', newCls);
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

    void fr; // used via closure above, silence lint
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

      {/* ── World container — all page frames live here.
           transform (translate + scale) is applied imperatively via worldRef
           during scroll/pan so React never re-renders just for viewport movement. ── */}
      <div
        ref={worldRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          // Initial transform — kept in sync by the useEffect([zoom,panX,panY]) above
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
        }}
      >
        {/* ── All inactive page frames (behind the active one) ── */}
        {pages.filter(p => p.id !== currentPageId).map(page => {
          const absIdx = pages.findIndex(pg => pg.id === page.id);
          const worldLeft = absIdx * (vpWidth + PAGE_GAP);
          return (
            <React.Fragment key={page.id}>
              {/* Page name label */}
              <div style={{ position: 'absolute', left: worldLeft, top: -26, fontSize: 11, color: '#9ca3af', pointerEvents: 'none', userSelect: 'none', fontFamily: 'system-ui', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 500 }}>{page.name}</span>
                {page.route && <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#4b5563' }}>{page.route}</span>}
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#374151' }}>{vpWidth}px</span>
              </div>
              {/* Frame */}
              <div
                data-builder-page-id={page.id}
                style={{
                  position: 'absolute',
                  left: worldLeft,
                  top: 0,
                  width: vpWidth,
                  minHeight: VIEWPORT_H,
                  background: '#ffffff',
                  overflow: 'visible',
                  boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                }}
              >
                <InactivePageEngine
                  pageId={page.id}
                  configName={(page.route ?? '').replace(/[^a-zA-Z0-9]/g, '_') || 'page'}
                  nodes={page.nodes as SDUINode[]}
                />
                {/* Fold line */}
                <div data-builder-overlay="fold-line" style={{ position: 'absolute', left: 0, right: 0, top: VIEWPORT_H, height: 0, borderTop: '1.5px dashed rgba(99,130,246,0.3)', pointerEvents: 'none', zIndex: 9990 }} />
              </div>
            </React.Fragment>
          );
        })}

        {/* ── Active page — label ── */}
        {(() => {
          const pg = pages.find(p => p.id === currentPageId);
          return (
            <div style={{ position: 'absolute', left: activePageIdx * (vpWidth + PAGE_GAP), top: -26, fontSize: 11, color: '#d1d5db', pointerEvents: 'none', userSelect: 'none', fontFamily: 'system-ui', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ fontWeight: 600, color: '#f3f4f6' }}>{pg?.name ?? 'Page'}</span>
              {pg?.route && <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#6b7280' }}>{pg.route}</span>}
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#4b5563' }}>{vpWidth}px</span>
            </div>
          );
        })()}

        {/* ── Active page frame: direct SDUI render (capture overlay lives here) ── */}
        <div
          ref={pageFrameRef}
          data-builder-page-frame="1"
          data-builder-page-id={currentPageId}
          style={{
            position: 'absolute',
            left: activePageIdx * (vpWidth + PAGE_GAP),
            top: 0,
            width: vpWidth,
            minHeight: VIEWPORT_H,
            background: '#ffffff',
            overflow: 'visible',
            boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          }}
        >
        <PageEngine pageConfig={pageConfig} />

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
                  select(hit.id, false);
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
                  hit = { kind: 'node' as const, id: selectedIds[0] };
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

              draggingNodeIdRef.current = dragId;
              dragSourcePageIdRef.current = useBuilderStore.getState().currentPageId;
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
                const storedStyle = (draggedNodeData?.props as { style?: Record<string, string> })?.style ?? {};
                dragStartStyleRef.current = {
                  left: storedStyle.left ?? '',
                  top:  storedStyle.top  ?? '',
                };
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

                  // Ghost lives in body (no canvas transform) so divide screen px by
                  // zoom to get the correct logical CSS size.
                  const ghostW = (maxX - minX) / zoom;
                  const ghostH = (maxY - minY) / zoom;

                  const ghostEl = document.createElement('div');
                  ghostEl.style.cssText = `position:fixed;left:-9999px;top:-9999px;pointer-events:none;width:${ghostW}px;height:${ghostH}px;`;
                  document.body.appendChild(ghostEl);

                  for (const { el, rect } of rects) {
                    const clone = el.cloneNode(true) as HTMLElement;
                    clone.style.position = 'absolute';
                    clone.style.left     = `${(rect.left - minX) / zoom}px`;
                    clone.style.top      = `${(rect.top  - minY) / zoom}px`;
                    clone.style.width    = `${rect.width  / zoom}px`;
                    clone.style.height   = `${rect.height / zoom}px`;
                    clone.style.margin   = '0';
                    clone.style.transform = '';
                    clone.style.opacity  = '1';
                    ghostEl.appendChild(clone);
                  }

                  // Cursor hotspot relative to the ghost's top-left corner
                  const ghostOx = (e.clientX - minX) / zoom;
                  const ghostOy = (e.clientY - minY) / zoom;
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
      </div>
      {/* ── End active page frame ── */}
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
      {snapGuides.map((g, i) =>
        g.axis === 'x' ? (
          // Vertical guide line (marks an X-axis alignment: edges / centers)
          <div
            key={`sg-${i}`}
            data-testid="snap-guide"
            data-snap-type={g.type}
            data-snap-axis="x"
            style={{
              position: 'absolute',
              left:   activePanX + g.position * zoom,
              top:    panY + g.start    * zoom,
              width:  1,
              height: Math.max(1, (g.end - g.start) * zoom),
              background: g.type === 'center' ? '#a78bfa' : g.type === 'spacing' ? '#34d399' : '#f43f5e',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        ) : (
          // Horizontal guide line (marks a Y-axis alignment: edges / centers)
          <div
            key={`sg-${i}`}
            data-testid="snap-guide"
            data-snap-type={g.type}
            data-snap-axis="y"
            style={{
              position: 'absolute',
              left:   activePanX + g.start    * zoom,
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
      {absDragPos && (
        <>
          {/* Vertical line */}
          <div style={{
            position: 'absolute',
            left: activePanX + absDragPos.x * zoom,
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
            left: activePanX,
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
            {absDragPos.x} × {absDragPos.y}
          </div>
        </>
      )}

      {/* ── Zoom controls ── */}
      <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', gap: 4, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: '4px 6px', pointerEvents: 'all' }}>
        <ZoomBtn label="−" testId="zoom-out" onClick={() => setZoom(Math.max(MIN_ZOOM, zoom / 1.25))} />
        <button data-testid="zoom-label" style={{ fontSize: 11, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer', minWidth: 40, textAlign: 'center' }} onClick={fitToCanvas}>
          {Math.round(zoom * 100)}%
        </button>
        <ZoomBtn label="+" testId="zoom-in" onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 1.25))} />
      </div>
    </div>
  );
}


function ZoomBtn({ label, testId, onClick }: { label: string; testId?: string; onClick: () => void }) {
  return (
    <button data-testid={testId} style={{ fontSize: 14, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }} onClick={onClick}>
      {label}
    </button>
  );
}

function EmptyCanvas() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#9ca3af', fontFamily: 'system-ui', userSelect: 'none' }}>
      <div style={{ fontSize: 32, opacity: 0.4 }}>+</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>Drop a component or section to get started</div>
      <div style={{ fontSize: 11, opacity: 0.6 }}>Drag from the Components panel on the left</div>
    </div>
  );
}
