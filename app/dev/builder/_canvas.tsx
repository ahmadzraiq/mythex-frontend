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
import { useBuilderStore, findNode, findParentNode } from './_store';
import BuilderOverlay, { type ResizeHandle } from './_overlay';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import appConfig from '@/config/app';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { SDUINode } from '@/lib/sdui/types/node';

/** Node types that act as containers and accept dropped children. */
const CONTAINER_TYPES = new Set(['Box', 'VStack', 'HStack', 'ScrollView', 'View', 'Card', 'SafeAreaView', 'Pressable']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = appConfig as any;

const VIEWPORT_W   = 1280;
const VIEWPORT_H   = 900;
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
    const z  = Math.min(c.clientWidth / VIEWPORT_W, c.clientHeight / VIEWPORT_H) * 0.9;
    const px = (c.clientWidth  - VIEWPORT_W * z) / 2;
    const py = (c.clientHeight - VIEWPORT_H * z) / 2;
    setZoom(z); setPan(px, py);
  }, [setZoom, setPan]);

  useEffect(() => { fitToCanvas(); }, [fitToCanvas]);

  // ── Build SDUI config ────────────────────────────────────────────────────

  const pageConfig = useMemo<SDUIConfig>(() => ({
    state: {},
    ui: {
      type: 'Box',
      props: { className: 'flex flex-col w-full min-h-screen' },
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
    }
  }, [tool]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
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
  }, [hitTest, select]);

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

  const onDragOver = useCallback((e: React.DragEvent) => {
    const hasData = e.dataTransfer.types.includes('text/variant-id') ||
                    e.dataTransfer.types.includes('text/primitive-node') ||
                    e.dataTransfer.types.includes('text/canvas-node-id');
    if (!hasData) return;
    e.preventDefault();
    // 'move' for canvas-node reordering; 'copy' for panel items (effectAllowed='copy')
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('text/canvas-node-id') ? 'move' : 'copy';
    setIsDroppingVariant(true);

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
      // Moving an existing canvas node to a new position
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
  }, [addNode, addSection, moveNode]);

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
      <div style={{ position: 'absolute', left: panX - 6, top: panY - 6, width: VIEWPORT_W * zoom + 12, height: VIEWPORT_H * zoom + 12, borderRadius: 4, boxShadow: '0 8px 40px rgba(0,0,0,0.6)', background: 'rgba(0,0,0,0.3)', pointerEvents: 'none' }} />

      {/* ── Page frame: direct SDUI render ── */}
      <div
        ref={pageFrameRef}
        data-builder-page-frame="1"
        style={{
          position: 'absolute',
          left: panX,
          top: panY,
          width: VIEWPORT_W,
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
              // Find the canvas node under the cursor when drag starts
              const hit = hitTest(e.clientX, e.clientY);
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
              // Use the node's DOM element as the drag ghost image
              const nodeEl = document.querySelector(`[data-builder-id="${dragId}"]`) as HTMLElement | null;
              if (nodeEl) {
                const nr = nodeEl.getBoundingClientRect();
                e.dataTransfer.setDragImage(nodeEl, e.clientX - nr.left, e.clientY - nr.top);
              }
            }}
            onDragEnd={() => {
              draggingNodeIdRef.current = null;
              setIsDroppingVariant(false);
              setDropContainerId(null);
              setDropZoneIdx(null);
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
