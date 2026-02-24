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

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useBuilderStore, findNode, findParentNode, VIEWPORT_WIDTHS } from './_store';
import BuilderOverlay, { type ResizeHandle } from './_overlay';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import appConfig from '@/config/app';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { SDUINode } from '@/lib/sdui/types/node';
import { computeSnap, snapResizeSize, type SnapGuide, type ContentRect } from './_snap-engine';

/** Node types that act as containers and accept dropped children. */
const CONTAINER_TYPES = new Set(['Box', 'VStack', 'HStack', 'ScrollView', 'View', 'Card', 'SafeAreaView', 'Pressable']);

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
const MIN_ZOOM     = 0.1;
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

/** Node types whose `text` property is directly editable via double-click. */
const TEXT_NODE_TYPES = new Set(['Text', 'Heading', 'ButtonText']);

export default function BuilderCanvas() {
  const canvasRef          = useRef<HTMLDivElement>(null);
  const pageFrameRef       = useRef<HTMLDivElement>(null);
  const captureOverlayRef  = useRef<HTMLDivElement>(null);

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
    patchProp,
    _pushHistory,
  } = useBuilderStore();

  // ── Dynamic viewport width ────────────────────────────────────────────────
  const vpWidth = VIEWPORT_WIDTHS[viewport];

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

  // ── Inline text editing ───────────────────────────────────────────────────
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingRect, setEditingRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement>(null);

  const commitInlineEdit = useCallback(() => {
    if (!editingId) return;
    patchProp(editingId, 'text', editingText);
    _pushHistory();
    setEditingId(null);
    setEditingRect(null);
  }, [editingId, editingText, patchProp, _pushHistory]);

  // Auto-focus the textarea when it appears
  useEffect(() => {
    if (editingId) editingTextareaRef.current?.focus();
  }, [editingId]);

  // Escape cancels, Enter (without Shift) commits
  useEffect(() => {
    if (!editingId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEditingId(null); setEditingRect(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingId]);

  // Keep refs in sync for wheel handler (avoids stale closure)
  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);

  // ── Drop state ────────────────────────────────────────────────────────────

  const [isDroppingVariant, setIsDroppingVariant] = React.useState(false);
  const [dropZoneIdx, setDropZoneIdx]               = React.useState<number | null>(null);
  /** ID of the container node being targeted for "drop inside" */
  const [dropContainerId, setDropContainerId]       = React.useState<string | null>(null);

  /** ID of the canvas node currently being dragged (null = dragging from panel) */
  const draggingNodeIdRef = useRef<string | null>(null);

  /**
   * When dragging an absolute-positioned node, record WHERE inside the element
   * the user grabbed (screen-px offset from the element's top-left).  Subtracting
   * this from the drop clientX/clientY keeps the element under the cursor instead
   * of jumping its top-left to the cursor position.
   */
  const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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
    const w  = VIEWPORT_WIDTHS[useBuilderStore.getState().viewport];
    const z  = Math.min(c.clientWidth / w, c.clientHeight / VIEWPORT_H) * 0.9;
    const px = (c.clientWidth  - w * z) / 2;
    const py = (c.clientHeight - VIEWPORT_H * z) / 2;
    setZoom(z); setPan(px, py);
  }, [setZoom, setPan]);

  useEffect(() => { fitToCanvas(); }, [fitToCanvas]);

  // ── Build SDUI config ────────────────────────────────────────────────────

  const pageConfig = useMemo<SDUIConfig>(() => ({
    state: {},
    ui: {
      type: 'Box',
      props: { className: 'flex flex-col w-full min-h-screen items-start relative' },
      children: pageNodes,
    } as SDUIConfig['ui'],
  }), [pageNodes]);

  // ── Wheel: Ctrl/Meta = zoom, else scroll page ─────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta   = -e.deltaY * 0.001;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * (1 + delta * 3)));
        const rect    = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const ratio = newZoom / zoomRef.current;
        const newPX = cx - ratio * (cx - panXRef.current);
        const newPY = cy - ratio * (cy - panYRef.current);
        setZoom(newZoom);
        setPan(newPX, newPY);
      } else {
        const pf = pageFrameRef.current;
        if (pf) { pf.scrollTop += e.deltaY; pf.scrollLeft += e.deltaX; }
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [setZoom, setPan]);

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

    for (const el of all) {
      if (el === capOverlay || capOverlay?.contains(el)) continue;
      if (el.hasAttribute('data-builder-overlay') || el.closest('[data-builder-overlay]')) continue;

      const builderEl = el.hasAttribute('data-builder-id')
        ? el
        : (el.closest('[data-builder-id]') as HTMLElement | null);

      if (builderEl?.dataset.builderId) {
        return { kind: 'node' as const, id: builderEl.dataset.builderId };
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
      // Check if pointer is on empty canvas area → start marquee
      const hit = hitTest(e.clientX, e.clientY);
      if (hit.kind === 'empty') {
        marqueeStartRef.current = { clientX: e.clientX, clientY: e.clientY };
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
      setPan(d.startPX + dx, d.startPY + dy);
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
      // Simple click (no drag) — handle selection here so it works regardless
      // of whether the capture overlay's onClick fired or not.
      const insidePage = (e.target as Element).closest('[data-builder-page-frame]');
      if (insidePage) {
        const hit = hitTest(e.clientX, e.clientY);
        if (hit.kind === 'node')       select(hit.id, e.shiftKey || e.metaKey);
        else if (hit.kind === 'empty') select(null);
      } else {
        // Clicked on the dark canvas background → deselect
        select(null);
      }
    }
    dragRef.current.active = false;
  }, [hitTest, select, marquee]);

  // ── Capture overlay hover ─────────────────────────────────────────────────

  const handleOverlayMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const hit = hitTest(e.clientX, e.clientY);
    const id = hit.kind === 'node' ? hit.id : null;
    hover(id);
    if (altMode) setAltHovered(id);
  }, [hitTest, hover, altMode, setAltHovered]);

  const handleOverlayMouseLeave = useCallback(() => {
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
      if (el.hasAttribute('data-builder-id')) return el;
      const closest = el.closest('[data-builder-id]') as HTMLElement | null;
      if (closest) return closest;
    }
    return null;
  }, []);

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
                    // empty; treat as a canvas-node move when a node is already active.
                    !!draggingNodeIdRef.current;
    if (!hasData) return;
    e.preventDefault();
    const isCanvasMove = e.dataTransfer.types.includes('text/canvas-node-id') || !!draggingNodeIdRef.current;
    e.dataTransfer.dropEffect = isCanvasMove ? 'move' : 'copy';
    setIsDroppingVariant(true);

    // ── Absolute node: free-form positioning, skip drop-zone logic ────────────
    const draggingId = draggingNodeIdRef.current;
    if (draggingId) {
      const draggedNode = findNode(useBuilderStore.getState().pageNodes, draggingId);
      const cls = (draggedNode?.props as { className?: string })?.className ?? '';
      const isAbsPos = /\babsolute\b/.test(cls) || /\bfixed\b/.test(cls);
      if (isAbsPos) {
        // Position relative to the nearest positioned parent, or the page frame
        const parentNode = findParentNode(useBuilderStore.getState().pageNodes, draggingId);
        const parentEl = parentNode?.id
          ? (document.querySelector(`[data-builder-id="${parentNode.id}"]`) as HTMLElement | null)
          : (document.querySelector('[data-builder-page-frame]') as HTMLElement | null);
        if (parentEl) {
          const pr   = parentEl.getBoundingClientRect();
          const z    = zoomRef.current;
          const grab = grabOffsetRef.current;
          // Subtract the grab offset so the element stays under the cursor
          // rather than snapping its top-left to the cursor position.
          const rawX = Math.round((e.clientX - pr.left - grab.x) / z);
          const rawY = Math.round((e.clientY - pr.top  - grab.y) / z);

          // ── Snap to siblings ──────────────────────────────────────────────
          const nodeEl = document.querySelector(`[data-builder-id="${draggingId}"]`) as HTMLElement | null;
          const nodeW  = nodeEl ? nodeEl.getBoundingClientRect().width  / z : 0;
          const nodeH  = nodeEl ? nodeEl.getBoundingClientRect().height / z : 0;
          const siblings = getAllSiblingRects(draggingId, parentEl, z);
          const dragged: ContentRect = { id: draggingId, x: rawX, y: rawY, w: nodeW, h: nodeH };
          const { x, y, guides } = computeSnap(dragged, siblings);
          setSnapGuides(guides);

          const pos = { x, y, clientX: e.clientX, clientY: e.clientY };
          absDragPosRef.current = pos;
          setAbsDragPos(pos);
        }
        // Don't show any flow drop indicators
        setDropZoneIdx(null);
        setDropContainerId(null);
        dropTargetRef.current = null;
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

    // Find the SDUI node under cursor
    const hovEl = findBuilderElAt(e.clientX, e.clientY);

    if (hovEl) {
      const nodeId   = hovEl.dataset.builderId!;
      const nodeType = hovEl.dataset.builderType ?? '';
      const nodeRect = hovEl.getBoundingClientRect();
      const relY     = (e.clientY - nodeRect.top) / nodeRect.height;

      // Check if the node is a container (by type or by having children)
      const nodeInTree = findNode(useBuilderStore.getState().pageNodes, nodeId);
      const isContainer = CONTAINER_TYPES.has(nodeType) || (nodeInTree?.children?.length ?? 0) > 0;

      // Prevent a node from being dropped into itself
      const draggingId = draggingNodeIdRef.current;
      const isDroppingSelf = draggingId === nodeId;
      const isDroppingIntoSelf = draggingId && isContainer &&
        !!findNode((nodeInTree?.children ?? []) as SDUINode[], draggingId);

      if (isContainer && !isDroppingSelf && !isDroppingIntoSelf && relY > 0.2 && relY < 0.8) {
        // ── Drop INSIDE the container ──
        const children = (nodeInTree?.children ?? []) as SDUINode[];
        setDropContainerId(nodeId);
        setDropZoneIdx(null);
        dropTargetRef.current = { parentId: nodeId, index: children.length };
      } else {
        // ── Drop BEFORE / AFTER this node in its parent ──
        const parent = findParentNode(useBuilderStore.getState().pageNodes, nodeId);
        const parentId = parent?.id ?? null;
        const siblings = parent ? (parent.children as SDUINode[]) : useBuilderStore.getState().pageNodes;
        const idxInParent = siblings.findIndex(n => n.id === nodeId);
        const insertIdx = relY < 0.5 ? idxInParent : idxInParent + 1;

        setDropContainerId(null);
        dropTargetRef.current = { parentId, index: insertIdx };

        if (!parentId) {
          setDropZoneIdx(insertIdx);
        } else {
          setDropZoneIdx(null);
        }
      }
    } else {
      // ── No node under cursor: drop at root level ──
      const y = (e.clientY - rect.top - panYRef.current) / zoomRef.current;
      const nodes = useBuilderStore.getState().pageNodes;
      let zoneIdx = nodes.length;
      for (let i = 0; i < nodes.length; i++) {
        const el = canvas.querySelector(`[data-builder-id="${nodes[i].id}"]`);
        if (!el) continue;
        const nr   = el.getBoundingClientRect();
        const midY = (nr.top - rect.top + nr.height / 2) / zoomRef.current;
        if (y < midY) { zoneIdx = i; break; }
      }
      setDropContainerId(null);
      setDropZoneIdx(zoneIdx);
      dropTargetRef.current = { parentId: null, index: zoneIdx };
    }
  }, [findBuilderElAt]);

  const onDragLeave = useCallback(() => {
    setIsDroppingVariant(false);
    setDropZoneIdx(null);
    setDropContainerId(null);
    absDragPosRef.current = null;
    setAbsDragPos(null);
    setSnapGuides([]);
    dropTargetRef.current = null;
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDroppingVariant(false);
    setDropContainerId(null);

    const target   = dropTargetRef.current ?? { parentId: null, index: useBuilderStore.getState().pageNodes.length };
    // getData may return '' in CDP-simulated drags; fall back to the ref set in onDragStart
    const canvasNodeId = e.dataTransfer.getData('text/canvas-node-id') || draggingNodeIdRef.current || '';
    const variantId    = e.dataTransfer.getData('text/variant-id');
    const primitive    = e.dataTransfer.getData('text/primitive-node');

    if (canvasNodeId) {
      // ── Absolute node: apply style.left / style.top, don't reorder ──────────
      // Read from the ref (always current) rather than state (async, may be stale
      // when drop fires synchronously right after dragover).
      const pos = absDragPosRef.current;
      const draggedNode = findNode(useBuilderStore.getState().pageNodes, canvasNodeId);
      const cls = (draggedNode?.props as { className?: string })?.className ?? '';
      if (pos && (/\babsolute\b/.test(cls) || /\bfixed\b/.test(cls))) {
        const existingStyle = (draggedNode?.props as { style?: Record<string, string> })?.style ?? {};
        patchProp(canvasNodeId, 'props.style', {
          ...existingStyle,
          left: `${pos.x}px`,
          top:  `${pos.y}px`,
        });
        _pushHistory();
        absDragPosRef.current = null;
        setAbsDragPos(null);
        setSnapGuides([]);
        draggingNodeIdRef.current = null;
        setDropZoneIdx(null);
        return;
      }
      // Moving an existing canvas node to a new position (flow)
      moveNode(canvasNodeId, target.parentId, target.index);
    } else if (primitive) {
      try {
        const node = ensureIds(JSON.parse(primitive) as SDUINode);
        addNode(node, target.parentId, target.index);
      } catch (err) { console.warn('Primitive drop failed:', err); }
    } else if (variantId) {
      const { sectionLibrary } = await import('@/lib/ai/section-library');
      try {
        const node = ensureIds(sectionLibrary.instantiate(variantId, {}) as unknown as SDUINode);
        addSection(variantId, node, target.index);
      } catch (err) { console.warn('Section drop failed:', err); }
    }

    setDropZoneIdx(null);
    draggingNodeIdRef.current = null;
  }, [addNode, addSection, moveNode, patchProp, _pushHistory]);

  // ── Resize: pointer-capture drag on handle ───────────────────────────────
  //
  // The handle sits inside the overlay (different DOM subtree from the canvas),
  // so we attach pointermove/pointerup listeners to `window` rather than
  // capturing on the canvas. This means the drag works even when the cursor
  // moves faster than React's synthetic event can follow.

  const onResizeStart = useCallback((id: string, handle: ResizeHandle, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const el    = document.querySelector(`[data-builder-id="${id}"]`);
    const frame = document.querySelector('[data-builder-page-frame]');
    if (!el || !frame) return;

    const r         = el.getBoundingClientRect();
    const fr        = frame.getBoundingClientRect();
    const z         = useBuilderStore.getState().zoom;
    const startX    = e.clientX;
    const startY    = e.clientY;
    const startW    = r.width  / z;   // unscaled px
    const startH    = r.height / z;

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

      // Use inline style instead of Tailwind classes — avoids JIT compilation
      // requirement and always takes effect immediately at highest specificity.
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
      if (!node) return;

      const existingStyle = (node.props as { style?: Record<string, string> })?.style ?? {};
      useBuilderStore.getState().patchProp(id, 'props.style', {
        ...existingStyle,
        width:  `${newW}px`,
        height: `${newH}px`,
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      setSnapGuides([]);
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
      {/* Figma-style dot grid */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.25 }}>
        <defs>
          <pattern id="builder-grid" x={panX % (20 * zoom)} y={panY % (20 * zoom)} width={20 * zoom} height={20 * zoom} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={0.8} fill="#6b7280" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#builder-grid)" />
      </svg>

      {/* Page frame drop shadow */}
      <div style={{ position: 'absolute', left: panX - 6, top: panY - 6, width: vpWidth * zoom + 12, height: VIEWPORT_H * zoom + 12, borderRadius: 4, boxShadow: '0 8px 40px rgba(0,0,0,0.6)', background: 'rgba(0,0,0,0.3)', pointerEvents: 'none' }} />

      {/* Viewport width label */}
      <div style={{ position: 'absolute', left: panX, top: panY - 20, fontSize: 10, color: '#6b7280', pointerEvents: 'none', userSelect: 'none', fontFamily: 'monospace' }}>
        {vpWidth}px
      </div>

      {/* ── Page frame: direct SDUI render ── */}
      <div
        ref={pageFrameRef}
        data-builder-page-frame="1"
        style={{
          position: 'absolute',
          left: panX,
          top: panY,
          width: vpWidth,
          height: VIEWPORT_H,
          transformOrigin: '0 0',
          transform: `scale(${zoom})`,
          background: '#ffffff',
          overflow: 'hidden',
        }}
      >
        {pageNodes.length === 0 ? (
          <EmptyCanvas />
        ) : (
          <SDUIEngine
            key="builder-engine"
            config={pageConfig}
            configName="builder"
            actionsConfig={app.actions ?? {}}
            routes={app.routes ?? []}
            builderMode
          />
        )}

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
            }}
            onMouseMove={handleOverlayMouseMove}
            onMouseLeave={handleOverlayMouseLeave}
            onDoubleClick={e => {
              const hit = hitTest(e.clientX, e.clientY);
              if (hit.kind !== 'node') return;

              // Walk up to find a text-editable node (Text, Heading, ButtonText)
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
              if (!editId) return;

              const targetEl = document.querySelector(`[data-builder-id="${editId}"]`);
              const canvasEl = canvasRef.current;
              if (!targetEl || !canvasEl) return;

              const tr = targetEl.getBoundingClientRect();
              const cr = canvasEl.getBoundingClientRect();

              setEditingId(editId);
              const node = findNode(useBuilderStore.getState().pageNodes, editId);
              setEditingText((node as { text?: string })?.text ?? '');
              setEditingRect({
                left:   tr.left - cr.left,
                top:    tr.top  - cr.top,
                width:  Math.max(tr.width,  40),
                height: Math.max(tr.height, 28),
              });
            }}
            onPointerDown={e => {
              // If we're in text-edit mode and the user clicks outside the textarea, commit
              if (editingId) { commitInlineEdit(); return; }
              // Select the node immediately on pointer-down so selectedIds is
              // populated by the time onDragStart fires (which runs after mousemove).
              if (e.button !== 0) return;
              const hit = hitTest(e.clientX, e.clientY);
              if (hit.kind === 'node') select(hit.id, e.shiftKey);
            }}
            onDragStart={e => {
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
              e.dataTransfer.setData('text/canvas-node-id', dragId);
              e.dataTransfer.effectAllowed = 'move';
              // Use the node's DOM element as the drag ghost image and record
              // the grab offset (where inside the element the drag started).
              const nodeEl = document.querySelector(`[data-builder-id="${dragId}"]`) as HTMLElement | null;
              if (nodeEl) {
                const nr = nodeEl.getBoundingClientRect();
                const ox = e.clientX - nr.left;
                const oy = e.clientY - nr.top;
                e.dataTransfer.setDragImage(nodeEl, ox, oy);
                grabOffsetRef.current = { x: ox, y: oy };
              } else {
                grabOffsetRef.current = { x: 0, y: 0 };
              }
            }}
            onDragEnd={() => {
              draggingNodeIdRef.current = null;
              absDragPosRef.current = null;
              grabOffsetRef.current = { x: 0, y: 0 };
              setIsDroppingVariant(false);
              setDropContainerId(null);
              setDropZoneIdx(null);
              setAbsDragPos(null);
              setSnapGuides([]);
            }}
          />
        )}
      </div>

      {/* ── Inline text editor (floats over the canvas at the node's position) ── */}
      {editingId && editingRect && (
        <textarea
          ref={editingTextareaRef}
          data-testid="inline-text-editor"
          value={editingText}
          onChange={e => setEditingText(e.target.value)}
          onBlur={commitInlineEdit}
          style={{
            position: 'absolute',
            left:   editingRect.left,
            top:    editingRect.top,
            width:  editingRect.width,
            height: editingRect.height,
            zIndex: 99999,
            fontSize: Math.round(14 * zoom),
            fontFamily: 'inherit',
            padding: 2,
            background: 'rgba(30, 41, 59, 0.92)',
            color: '#fff',
            border: '2px solid #3b82f6',
            borderRadius: 3,
            resize: 'both',
            outline: 'none',
            overflow: 'hidden',
            lineHeight: 1.4,
            boxSizing: 'border-box',
          }}
        />
      )}

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
        panX={panX}
        panY={panY}
        canvasRef={canvasRef}
        selectedIds={selectedIds}
        hoveredId={hoveredId}
        altHoveredId={altHoveredId}
        altMode={altMode}
        isDroppingVariant={isDroppingVariant}
        dropZoneIdx={dropZoneIdx}
        dropContainerId={dropContainerId}
        pageNodes={pageNodes}
        gridOverlay={gridOverlay}
        onResizeStart={onResizeStart}
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
          // Horizontal guide line (marks a Y-axis alignment: edges / centers)
          <div
            key={`sg-${i}`}
            data-testid="snap-guide"
            data-snap-type={g.type}
            data-snap-axis="y"
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
      {absDragPos && (
        <>
          {/* Vertical line */}
          <div style={{
            position: 'absolute',
            left: panX + absDragPos.x * zoom,
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
            left: panX,
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
