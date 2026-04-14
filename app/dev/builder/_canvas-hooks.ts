'use client';

/**
 * _canvas-hooks.ts
 *
 * Custom hooks for the builder canvas.
 * Extracted from _canvas.tsx for clarity and reuse.
 *
 * Current exports:
 *  - useCanvasPanZoom  — pan/zoom state, world transform, wheel handler, fit-to-canvas
 *
 * Planned (TODO — still inline in _canvas.tsx due to shared-ref coupling):
 *  - useCanvasDrag    — node drag-move logic (draggingNodeIdRef, draggedElRef, etc.)
 *  - useCanvasResize  — resize with snap logic (resizeRef)
 *  - useCanvasSelection — click-to-select, multi-select, keyboard shortcuts
 *
 * Extract strategy: pass a `CanvasCoreRefs` bundle to each hook; return
 * handlers/state to wire to the canvas div. See docs/BUILDER-ARCHITECTURE.md.
 */

import { useRef, useEffect, useCallback } from 'react';
import { useBuilderStore, VIEWPORT_WIDTHS } from './_store';
import { VIEWPORT_H } from './_canvas-helpers';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 4;
export const PAGE_GAP = 80;

// ─── Shared refs interface ─────────────────────────────────────────────────────

/**
 * References that are OWNED by useCanvasPanZoom and shared outward.
 * The canvas component destructures these from the hook return value.
 */
export interface PanZoomRefs {
  worldRef: React.RefObject<HTMLDivElement | null>;
  gridPatternRef: React.RefObject<SVGPatternElement | null>;
  syncTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  zoomRef: React.MutableRefObject<number>;
  panXRef: React.MutableRefObject<number>;
  panYRef: React.MutableRefObject<number>;
  /** Space-bar / middle-mouse pan drag state. */
  dragRef: React.MutableRefObject<{ active: boolean; startX: number; startY: number; startPX: number; startPY: number; moved: boolean }>;
}

/**
 * External refs that must exist in the canvas and be passed IN to useCanvasPanZoom.
 */
export interface PanZoomInputRefs {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  pageFrameRef: React.RefObject<HTMLDivElement | null>;
  overlayInstantUpdateRef: React.MutableRefObject<(() => void) | null>;
  overlayNotifyRef: React.MutableRefObject<(() => void) | null>;
}

// ─── useCanvasPanZoom ─────────────────────────────────────────────────────────

/**
 * Manages pan/zoom for the builder canvas.
 *
 * Owns: worldRef, gridPatternRef, syncTimerRef, zoomRef, panXRef, panYRef, dragRef.
 * Reads: canvasRef, pageFrameRef, overlayInstantUpdateRef, overlayNotifyRef (passed in).
 *
 * Returns: { ...ownedRefs, applyWorldTransform, scheduleStoreSync, fitToCanvas }
 *
 * Usage in BuilderCanvas:
 * ```ts
 * const panZoom = useCanvasPanZoom({ canvasRef, pageFrameRef, overlayInstantUpdateRef, overlayNotifyRef });
 * const { worldRef, gridPatternRef, fitToCanvas, applyWorldTransform } = panZoom;
 * ```
 */
export function useCanvasPanZoom(
  inputRefs: PanZoomInputRefs,
  storeSlice: { zoom: number; panX: number; panY: number; setZoom: (z: number) => void; setPan: (x: number, y: number) => void; pendingFitToPage: boolean; clearPendingFit: () => void; pageNodes: unknown[] },
) {
  const { canvasRef, pageFrameRef, overlayInstantUpdateRef, overlayNotifyRef } = inputRefs;
  const { zoom, panX, panY, setZoom, setPan, pendingFitToPage, clearPendingFit } = storeSlice;

  // Owned refs
  const worldRef       = useRef<HTMLDivElement>(null);
  const gridPatternRef = useRef<SVGPatternElement>(null);
  const syncTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRef        = useRef(zoom);
  const panXRef        = useRef(panX);
  const panYRef        = useRef(panY);
  const dragRef        = useRef({ active: false, startX: 0, startY: 0, startPX: 0, startPY: 0, moved: false });

  // ── applyWorldTransform ──────────────────────────────────────────────────

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
    overlayInstantUpdateRef.current?.();
    overlayNotifyRef.current?.();
  }, [overlayInstantUpdateRef, overlayNotifyRef]);

  // ── scheduleStoreSync ────────────────────────────────────────────────────

  const scheduleStoreSync = useCallback((px: number, py: number, z: number) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      setZoom(z);
      setPan(px, py);
      syncTimerRef.current = null;
    }, 80);
  }, [setZoom, setPan]);

  // ── fitToCanvas ──────────────────────────────────────────────────────────

  const fitToCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w          = VIEWPORT_WIDTHS[useBuilderStore.getState().viewport];
    const pgs        = useBuilderStore.getState().pages;
    const activeId   = useBuilderStore.getState().focusedPageId || useBuilderStore.getState().currentPageId;
    const activePage = pgs.find(p => p.id === activeId);
    const z          = Math.min(c.clientWidth / w, c.clientHeight / VIEWPORT_H) * 0.85;
    // Use stored wx/wy if available, otherwise fall back to index-based layout
    const pageOffsetX = activePage?.wx ?? (Math.max(0, pgs.findIndex(p => p.id === activeId)) * (w + PAGE_GAP));
    const pageOffsetY = activePage?.wy ?? 0;
    const px = (c.clientWidth - w * z) / 2 - pageOffsetX * z;
    const py = (c.clientHeight - VIEWPORT_H * z) / 2 - pageOffsetY * z;
    setZoom(z); setPan(px, py);
  }, [canvasRef, setZoom, setPan]);

  // ── Sync store → refs & world transform ─────────────────────────────────

  useEffect(() => {
    zoomRef.current = zoom;
    panXRef.current = panX;
    panYRef.current = panY;
    applyWorldTransform(panX, panY, zoom);
  }, [zoom, panX, panY, applyWorldTransform]);

  // ── Fit on mount ─────────────────────────────────────────────────────────

  useEffect(() => { fitToCanvas(); }, [fitToCanvas]);

  // ── Respond to pendingFitToPage ─────────────────────────────────────────

  useEffect(() => {
    if (!pendingFitToPage) return;
    fitToCanvas();
    clearPendingFit();
  }, [pendingFitToPage, fitToCanvas, clearPendingFit]);

  // ── Re-measure overlay when page content changes ─────────────────────────

  useEffect(() => {
    overlayInstantUpdateRef.current?.();
    overlayNotifyRef.current?.();
  // storeSlice.pageNodes changes when the tree changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSlice.pageNodes]);

  // ── Viewport resize → re-measure overlay ─────────────────────────────────

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wheel handler ────────────────────────────────────────────────────────

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

      applyWorldTransform(newPX, newPY, newZoom);
      scheduleStoreSync(newPX, newPY, newZoom);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [canvasRef, applyWorldTransform, scheduleStoreSync]);

  return {
    worldRef,
    gridPatternRef,
    syncTimerRef,
    zoomRef,
    panXRef,
    panYRef,
    dragRef,
    applyWorldTransform,
    scheduleStoreSync,
    fitToCanvas,
  };
}
