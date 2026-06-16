'use client';

/**
 * _canvas-helpers.tsx
 *
 * Self-contained helper components for the builder canvas.
 * Extracted from _canvas.tsx — no circular dependencies.
 *
 * Exports:
 *  - VIEWPORT_H
 *  - CanvasContextMenu, CanvasCtxMenuProps
 *  - ZoomBtn, EmptyCanvas
 *  - PageEngine, InactivePageEngine, AllPagesGrid (formerly InactivePagesGrid)
 */

import React, { useEffect, useRef, memo, useMemo, useCallback, useDeferredValue } from 'react';
import { useBuilderStore } from './_store';
import { SDUIEngine } from '@/lib/sdui/sdui-engine';
import appConfig from '@/config/app';
import type { SDUIConfig } from '@/lib/sdui/types';
import type { SDUINode } from '@/lib/sdui/types/node';
import { applyStateTagOverrides } from '@/lib/sdui/builder-preview';
import { computeSnap, type SnapGuide, type ContentRect } from './_snap-engine';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = appConfig as any;

export const VIEWPORT_H = 900;

const BUILDER_ATTRS = [
  'data-builder-id', 'data-builder-type',
  'data-builder-page-id', 'data-builder-page-frame',
  'data-builder-canvas-node', 'data-builder-canvas-overlay',
  'data-builder-inactive-overlay', 'data-builder-overlay',
];

/**
 * Strip all builder-identity attributes from a ghost clone and every descendant.
 * After this the clone is purely visual — invisible to findDropTargetElAt,
 * querySelector('[data-builder-id]'), elementsFromPoint, etc.
 * Runs once at clone creation, not per-frame.
 */
export function sanitizeGhostClone(el: HTMLElement) {
  for (const attr of BUILDER_ATTRS) el.removeAttribute(attr);
  const tagged = el.querySelectorAll(BUILDER_ATTRS.map(a => `[${a}]`).join(','));
  for (const child of tagged) {
    for (const attr of BUILDER_ATTRS) child.removeAttribute(attr);
  }
}

const STABLE_EMPTY_STATE: Record<string, unknown> = {};

// ─── ZoomBtn ─────────────────────────────────────────────────────────────────

export function ZoomBtn({ label, testId, onClick }: { label: string; testId?: string; onClick: () => void }) {
  return (
    <button data-testid={testId} style={{ fontSize: 14, color: 'var(--bld-text-2)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }} onClick={onClick}>
      {label}
    </button>
  );
}

// ─── EmptyCanvas ──────────────────────────────────────────────────────────────

export function EmptyCanvas() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--bld-text-3)', fontFamily: 'system-ui', userSelect: 'none' }}>
      <div style={{ fontSize: 32, opacity: 0.4 }}>+</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>Drop a component or section to get started</div>
      <div style={{ fontSize: 11, opacity: 0.6 }}>Drag from the Components panel on the left</div>
    </div>
  );
}

// ─── Canvas Context Menu ──────────────────────────────────────────────────────

export interface CanvasCtxMenuProps {
  x: number; y: number;
  nodeId: string | null;
  onClose: () => void;
}

export function CanvasContextMenu({ x, y, nodeId, onClose }: CanvasCtxMenuProps) {
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-canvas-ctx-menu]')) onClose(); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);

  const nodeItems = nodeId ? [
    { label: 'Copy',         action: () => { const s = useBuilderStore.getState(); s.select(nodeId); s.copyToClipboard(); } },
    { label: 'Duplicate',    action: () => useBuilderStore.getState().duplicateNodes([nodeId]) },
    { label: 'Move Up',      action: () => useBuilderStore.getState().moveNodeUp(nodeId) },
    { label: 'Move Down',    action: () => useBuilderStore.getState().moveNodeDown(nodeId) },
    { label: 'Select Parent',action: () => useBuilderStore.getState().selectParent(nodeId) },
    null,
    { label: 'Delete', action: () => { const s = useBuilderStore.getState(); s.deleteNodes(s.selectedIds.includes(nodeId) ? s.selectedIds : [nodeId]); }, danger: true },
  ] : [
    { label: 'Select All',    action: () => useBuilderStore.getState().selectAll() },
    { label: 'Paste',         action: () => useBuilderStore.getState().pasteFromClipboard() },
    { label: 'Paste in Place',action: () => useBuilderStore.getState().pasteInPlace() },
  ];

  return (
    <div
      data-canvas-ctx-menu="1"
      data-testid={nodeId ? 'canvas-node-ctx-menu' : 'canvas-empty-ctx-menu'}
      style={{ position: 'fixed', left: x, top: y, background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6, zIndex: 99999, minWidth: 160, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.6)' }}
    >
      {nodeItems.map((item, i) =>
        item === null ? (
          <div key={i} style={{ height: 1, background: 'var(--bld-bg-elevated)', margin: '2px 0' }} />
        ) : (
          <button
            key={item.label}
            style={{ display: 'block', width: '100%', padding: '7px 14px', background: 'none', border: 'none', color: (item as { danger?: boolean }).danger ? 'var(--bld-error)' : '#d1d5db', fontSize: 12, fontFamily: 'system-ui', textAlign: 'left', cursor: 'pointer' }}
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

// ─── AllPagesGrid ─────────────────────────────────────────────────────────────
/**
 * Renders all pages EXCEPT the focused page as background frames.
 * Each page gets a smart capture overlay that enables:
 *   1. Hover highlights (pointer-events trick hit-test)
 *   2. Auto-focus on pointer interaction (click/drag start)
 *   3. Page frame drag handle (drag the page title to reposition it)
 *
 * Isolated here so it does NOT re-render when hover/selection state changes.
 */
export const AllPagesGrid = memo(function AllPagesGrid({
  vpWidth,
  overlayNotifyRef,
  dragNodeIdSetter,
  dragSourcePageSetter,
  grabOffsetSetter,
  onPageDragSnap,
}: {
  vpWidth: number;
  overlayNotifyRef: React.MutableRefObject<(() => void) | null>;
  /** Called by the overlay's onDragStart to register the dragging node ID. */
  dragNodeIdSetter: (id: string | null) => void;
  /** Called by the overlay's onDragStart to record the source page ID for cross-page moves. */
  dragSourcePageSetter: (pageId: string | null) => void;
  /** Called by the overlay's onDragStart to pass the grab offset (screen px). */
  grabOffsetSetter: (ox: number, oy: number) => void;
  /** Called during page drag with snap guides (empty array on drag end). */
  onPageDragSnap: (guides: SnapGuide[], isDragging: boolean) => void;
}) {
  const pages = useBuilderStore(s => s.pages);
  const focusedPageId = useBuilderStore(s => s.focusedPageId || s.currentPageId);
  const activePreviewStates = useBuilderStore(s => s.activePreviewStates);
  const focusPage = useBuilderStore(s => s.focusPage);
  const hover = useBuilderStore(s => s.hover);
  const movePagePosition = useBuilderStore(s => s.movePagePosition);
  const shownPopovers = useBuilderStore(s => s.shownPopovers);

  // Track page dragging state (move page frame, not node)
  const pageDragRef = React.useRef<{ pageId: string; startWx: number; startWy: number; startMx: number; startMy: number } | null>(null);

  // Build sibling rects for page snap (all pages except the one being dragged)
  const buildPageSiblings = React.useCallback((excludeId: string): ContentRect[] => {
    const allPages = useBuilderStore.getState().pages;
    return allPages
      .filter(p => p.id !== excludeId)
      .map(p => ({ id: p.id, x: (p as { wx?: number }).wx ?? 0, y: (p as { wy?: number }).wy ?? 0, w: vpWidth, h: VIEWPORT_H }));
  }, [vpWidth]);

  // Handle page frame repositioning via title bar drag
  const handlePageTitleMouseDown = React.useCallback((e: React.MouseEvent, page: { id: string; wx: number; wy: number }) => {
    e.preventDefault();
    e.stopPropagation();
    pageDragRef.current = { pageId: page.id, startWx: page.wx ?? 0, startWy: page.wy ?? 0, startMx: e.clientX, startMy: e.clientY };

    const onMove = (mv: MouseEvent) => {
      const d = pageDragRef.current;
      if (!d) return;
      const screenDx = mv.clientX - d.startMx;
      const screenDy = mv.clientY - d.startMy;
      const worldEl = document.querySelector('[data-builder-world]') as HTMLElement | null;
      const mat = worldEl ? new DOMMatrix(getComputedStyle(worldEl).transform) : null;
      const z = mat ? mat.a : 1;

      const rawX = d.startWx + screenDx / z;
      const rawY = d.startWy + screenDy / z;
      const dragged: ContentRect = { id: d.pageId, x: rawX, y: rawY, w: vpWidth, h: VIEWPORT_H };
      const siblings = buildPageSiblings(d.pageId);
      const snap = computeSnap(dragged, siblings);

      const dx = snap.x - d.startWx;
      const dy = snap.y - d.startWy;
      const frame = document.querySelector(`[data-builder-page-id="${d.pageId}"]`) as HTMLElement | null;
      const label = document.querySelector(`[data-builder-page-label="${d.pageId}"]`) as HTMLElement | null;
      if (frame) frame.style.transform = `translateZ(0) translate(${dx}px, ${dy}px)`;
      if (label) label.style.transform = `translate(${dx}px, ${dy}px)`;
      onPageDragSnap(snap.guides, true);
    };

    const onUp = (up: MouseEvent) => {
      const d = pageDragRef.current;
      if (!d) return;
      const screenDx = up.clientX - d.startMx;
      const screenDy = up.clientY - d.startMy;
      const worldEl = document.querySelector('[data-builder-world]') as HTMLElement | null;
      const mat = worldEl ? new DOMMatrix(getComputedStyle(worldEl).transform) : null;
      const z = mat ? mat.a : 1;

      const rawX = d.startWx + screenDx / z;
      const rawY = d.startWy + screenDy / z;
      const dragged: ContentRect = { id: d.pageId, x: rawX, y: rawY, w: vpWidth, h: VIEWPORT_H };
      const siblings = buildPageSiblings(d.pageId);
      const snap = computeSnap(dragged, siblings);

      const frame = document.querySelector(`[data-builder-page-id="${d.pageId}"]`) as HTMLElement | null;
      const label = document.querySelector(`[data-builder-page-label="${d.pageId}"]`) as HTMLElement | null;
      if (frame) frame.style.transform = 'translateZ(0)';
      if (label) label.style.transform = '';
      movePagePosition(d.pageId, snap.x, snap.y);
      onPageDragSnap([], false);
      pageDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [movePagePosition, vpWidth, buildPageSiblings, onPageDragSnap]);

  return (
    <>
      {pages.map(page => {
        const isFocused = page.id === focusedPageId;
        const wx = (page as { wx?: number }).wx ?? 0;
        const wy = (page as { wy?: number }).wy ?? 0;

        return (
          <React.Fragment key={page.id}>
            {/* Label and overlay are rendered by _canvas.tsx for the focused page */}
            {!isFocused && (
              <div
                data-builder-page-label={page.id}
                onMouseDown={e => handlePageTitleMouseDown(e, { id: page.id, wx, wy })}
                onClick={() => focusPage(page.id)}
                style={{
                  position: 'absolute', left: wx, top: wy - 26, fontSize: 11,
                  color: 'var(--bld-text-3)', userSelect: 'none', fontFamily: 'system-ui',
                  whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'baseline',
                  cursor: 'grab', zIndex: 1,
                }}
              onMouseEnter={e => (e.currentTarget.style.color = '#d1d5db')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-3)')}
            >
              <span style={{ fontWeight: 500 }}>{page.name}</span>
              {page.route && <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--bld-text-disabled)' }}>{page.route}</span>}
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--bld-text-disabled)' }}>{vpWidth}px</span>
            </div>
            )}

            {/* Page frame — renders SDUI content for ALL pages (including focused).
                Keeping the focused page here prevents unmount/remount on focus change,
                eliminating animation replays. */}
            <div
              data-builder-page-id={page.id}
              data-builder-page-frame="0"
              style={{
                position: 'absolute',
                left: wx,
                top: wy,
                width: vpWidth,
                minHeight: VIEWPORT_H,
                background: 'rgb(var(--background, 255 255 255))',
                overflow: 'hidden',
                boxShadow: 'none',
                transform: 'translateZ(0)',
                // Let the browser skip layout/paint for offscreen frames entirely.
                // containIntrinsicSize reserves the correct box so scroll/pan geometry
                // stays stable without rendering the subtree.
                contentVisibility: 'auto' as const,
                containIntrinsicSize: `${vpWidth}px ${VIEWPORT_H}px`,
              }}
            >
              <style>{`
                [data-builder-page-frame="0"] .h-screen    { height: ${VIEWPORT_H}px !important; }
                [data-builder-page-frame="0"] .min-h-screen { min-height: ${VIEWPORT_H}px !important; }
                [data-builder-page-frame="0"] .w-screen    { width: ${vpWidth}px !important; }
                [data-builder-page-frame="0"] .max-h-screen { max-height: ${VIEWPORT_H}px !important; }
                [data-builder-page-frame="0"] {
                  --builder-vw: ${vpWidth / 100}px;
                  --builder-vh: ${VIEWPORT_H / 100}px;
                }
              `}</style>

              <InactivePageWrapper
                pageId={page.id}
                pageName={page.name || 'page'}
                nodes={page.nodes as SDUINode[]}
                previewStates={activePreviewStates}
                shownPopovers={shownPopovers}
                queryParams={page.queryParams}
                isFocused={isFocused}
              />

              {/* Inactive capture overlay — only for non-focused pages */}
              {!isFocused && (
                <div
                  draggable
                  data-builder-inactive-overlay={page.id}
                  style={{
                    position: 'absolute', inset: 0, zIndex: 9998,
                    cursor: 'default', background: 'transparent',
                  }}
                  onMouseMove={e => {
                    const overlay = e.currentTarget;
                    overlay.style.pointerEvents = 'none';
                    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
                    overlay.style.pointerEvents = '';
                    const builderEl = el?.closest('[data-builder-id]') as HTMLElement | null;
                    const newHoverId = builderEl?.dataset.builderId ?? null;
                    hover(newHoverId ?? null);
                    overlayNotifyRef.current?.();
                  }}
                  onMouseLeave={() => {
                    hover(null);
                    overlayNotifyRef.current?.();
                  }}
                  onClick={() => {
                    if (page.id !== focusedPageId) focusPage(page.id);
                  }}
                  onDragStart={e => {
                    // Do NOT call focusPage here — removing the overlay (drag source)
                    // from the DOM would cancel the drag in some browsers.
                    // Focus is deferred to onDrop in _canvas.tsx.
                    const overlay = e.currentTarget;
                    overlay.style.pointerEvents = 'none';
                    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
                    overlay.style.pointerEvents = '';
                    const builderEl = el?.closest('[data-builder-id]') as HTMLElement | null;
                    const nodeId = builderEl?.dataset.builderId;
                    if (nodeId && builderEl) {
                      e.dataTransfer.setData('text/canvas-node-id', nodeId);
                      e.dataTransfer.effectAllowed = 'move';
                      dragNodeIdSetter(nodeId);
                      dragSourcePageSetter(page.id);
                      const nr = builderEl.getBoundingClientRect();
                      grabOffsetSetter(e.clientX - nr.left, e.clientY - nr.top);
                      const z = useBuilderStore.getState().zoom;
                      const ghostEl = document.createElement('div');
                      ghostEl.style.cssText = `position:fixed;left:-9999px;top:-9999px;pointer-events:none;width:${nr.width}px;height:${nr.height}px;overflow:hidden;`;
                      document.body.appendChild(ghostEl);
                      const clone = builderEl.cloneNode(true) as HTMLElement;
                      sanitizeGhostClone(clone);
                      clone.style.position = 'absolute';
                      clone.style.left = '0px';
                      clone.style.top = '0px';
                      clone.style.width = `${nr.width / z}px`;
                      clone.style.height = `${nr.height / z}px`;
                      clone.style.margin = '0';
                      clone.style.transform = `scale(${z})`;
                      clone.style.transformOrigin = 'top left';
                      ghostEl.appendChild(clone);
                      e.dataTransfer.setDragImage(ghostEl, e.clientX - nr.left, e.clientY - nr.top);
                      requestAnimationFrame(() => document.body.removeChild(ghostEl));
                    } else {
                      e.preventDefault();
                    }
                  }}
                  onDragEnd={() => {
                    dragNodeIdSetter(null);
                    dragSourcePageSetter(null);
                  }}
                />
              )}

              {/* Fold line */}
              <div
                data-builder-overlay="fold-line"
                style={{ position: 'absolute', left: 0, right: 0, top: VIEWPORT_H, height: 0, borderTop: `1.5px dashed rgba(99,130,246,${isFocused ? '0.45' : '0.3'})`, pointerEvents: 'none', zIndex: 9990 }}
              />
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
});

// ─── InactivePageWrapper ───────────────────────────────────────────────────────
/**
 * Per-page memo wrapper that memoizes the `applyStateTagOverrides` result.
 * When `movePagePosition` updates a page's wx/wy, unchanged pages keep the same
 * `page.nodes` reference so this memo skips, preventing animation re-triggers.
 */
const InactivePageWrapper = memo(function InactivePageWrapper({
  pageId,
  pageName,
  nodes,
  previewStates,
  shownPopovers,
  queryParams,
  isFocused,
}: {
  pageId: string;
  pageName: string;
  nodes: SDUINode[];
  previewStates?: string[];
  shownPopovers?: Set<string>;
  queryParams?: Array<{ name: string; value: string }>;
  /** True when this page is the focused one in the builder. Focused page sees
   * the live viewport (instant breakpoint switch); non-focused pages see a
   * deferred value so React can schedule their SDUI reconciliation at lower
   * priority instead of blocking the click-handler tick. */
  isFocused: boolean;
}) {
  const displayNodes = useMemo(
    () => applyStateTagOverrides(nodes, previewStates ?? ['normal']),
    [nodes, previewStates],
  );
  // Builder viewport preset — forwarded so the engine resolves responsive
  // overrides (responsive-resolver.ts) for the breakpoint the user is editing.
  // Without this, SDUIEngine falls back to 'desktop' and tablet/mobile overrides
  // never take effect in the builder canvas, even though the right panel shows
  // the correct override values (it reads activeBreakpoint from the store).
  //
  // Why useDeferredValue for non-focused pages:
  // - zustand uses useSyncExternalStore, so setViewport forces a synchronous
  //   re-render of every subscribed wrapper. We can't stop that — but we CAN
  //   feed non-focused wrappers a stale value during the urgent render.
  // - useDeferredValue returns the previous value in the urgent pass, then
  //   schedules a low-priority render with the new value. That low-priority
  //   render is interruptible: React yields to pointer/keyboard input.
  // - InactivePageEngine is memoized; when viewport prop is stale, the memo
  //   bails and no SDUI reconciliation happens in the click-handler tick.
  //   Only the focused page reconciles synchronously; the other 59 ripple
  //   through over the next frames without blocking the UI.
  const liveViewport = useBuilderStore(s => s.viewport);
  const deferredViewport = useDeferredValue(liveViewport);
  const viewport = isFocused ? liveViewport : deferredViewport;

  return (
    <InactivePageEngine
      pageId={pageId}
      configName={pageName || 'page'}
      nodes={displayNodes}
      previewStates={previewStates}
      shownPopovers={shownPopovers}
      queryParams={queryParams}
      viewport={viewport}
    />
  );
});

// ─── Page Engines ──────────────────────────────────────────────────────────────

export const PageEngine = memo(function PageEngine({
  pageConfig,
  configName,
  previewStates,
  previewData,
  actionsConfig: actionsConfigProp,
  viewport,
  shownPopovers,
  queryParams,
}: {
  pageConfig: SDUIConfig;
  configName: string;
  previewStates?: string[];
  previewData?: Record<string, unknown>;
  actionsConfig?: Record<string, unknown>;
  /** Current builder viewport preset — forwarded to the engine for responsive resolution. */
  viewport?: 'mobile' | 'tablet' | 'laptop' | 'desktop';
  shownPopovers?: Set<string>;
  queryParams?: Array<{ name: string; value: string }>;
}) {
  if (!pageConfig.ui) return <EmptyCanvas />;
  return (
    <SDUIEngine
      key="builder-engine"
      config={pageConfig}
      configName={configName}
      actionsConfig={actionsConfigProp ?? app.actions}
      routes={app.routes}
      builderMode
      builderViewportHeight={VIEWPORT_H}
      builderViewport={viewport}
      previewStates={previewStates}
      previewData={previewData}
      shownPopovers={shownPopovers}
      builderQueryParams={queryParams}
    />
  );
});

/**
 * Memoized wrapper around SDUIEngine for inactive (background) pages.
 * Receives a stable `nodes` reference — only re-renders when that page's
 * node tree actually changes, not on every pan/zoom/hover update.
 */
export const InactivePageEngine = memo(function InactivePageEngine({
  pageId,
  configName,
  nodes,
  previewStates,
  shownPopovers,
  queryParams,
  viewport,
}: {
  pageId: string;
  configName: string;
  nodes: SDUINode[];
  previewStates?: string[];
  shownPopovers?: Set<string>;
  queryParams?: Array<{ name: string; value: string }>;
  /** Current builder viewport preset — forwarded as `builderViewport` so the
   * engine resolves responsive overrides for the edited breakpoint. */
  viewport?: 'mobile' | 'tablet' | 'laptop' | 'desktop';
}) {
  // Apply state-tag overrides inside the memo so this only recomputes when
  // nodes or previewStates change — not on every canvas pan/zoom render.
  const displayNodes = useMemo(
    () => applyStateTagOverrides(nodes, previewStates ?? ['normal']),
    [nodes, previewStates],
  );

  const screenState = useMemo(
    () => (app.screens?.[configName] as { state?: Record<string, unknown> } | undefined)?.state ?? STABLE_EMPTY_STATE,
    [configName],
  );

  const cfg = useMemo<SDUIConfig>(() => ({
      state: screenState,
      ui: {
        type: 'Box',
        props: { className: 'flex flex-col w-full min-h-screen relative' },
        children: displayNodes,
      } as SDUIConfig['ui'],
  }), [screenState, displayNodes]);

  if (!nodes.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: VIEWPORT_H, gap: 8, color: 'var(--bld-text-3)', fontFamily: 'system-ui', userSelect: 'none' }}>
        <div style={{ fontSize: 24, opacity: 0.3 }}>+</div>
        <div style={{ fontSize: 12 }}>Empty page</div>
      </div>
    );
  }
  return (
    <SDUIEngine
      key={`pg-${pageId}`}
      config={cfg}
      configName={configName}
      actionsConfig={app.actions ?? {}}
      routes={app.routes ?? []}
      builderMode
      builderViewport={viewport}
      previewStates={previewStates}
      shownPopovers={shownPopovers}
      builderQueryParams={queryParams}
    />
  );
});

// ─── CanvasNodeEngine ─────────────────────────────────────────────────────────
/**
 * Renders a freeform canvas node (dropped outside any page frame) through the
 * SDUI engine so it looks identical to how it appeared inside a page.
 */
export const CanvasNodeEngine = memo(function CanvasNodeEngine({
  node,
}: {
  node: SDUINode;
}) {
  const cfg = useMemo<SDUIConfig>(() => ({
    state: STABLE_EMPTY_STATE,
    ui: node,
  }), [node]);

  return (
    <SDUIEngine
      key={`canvas-${node.id}`}
      config={cfg}
      configName="canvasNode"
      actionsConfig={app.actions ?? {}}
      routes={app.routes ?? []}
      builderMode
    />
  );
});
