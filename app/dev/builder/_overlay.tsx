'use client';

/**
 * Builder Overlay — drawn on top of the page frame.
 *
 * All coordinates are in CANVAS space (screen pixels relative to the canvas
 * container). getBoundingClientRect() already accounts for CSS scale() so no
 * zoom division is needed for position; widths/heights are in screen-pixel
 * space (already scaled).
 */

import React, { useMemo, useRef, useEffect, useState } from 'react';
import type { SDUINode } from '@/lib/sdui/types/node';
import type { GridOverlayConfig } from './_store';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface CanvasRect { x: number; y: number; w: number; h: number; }

export interface OverlayProps {
  zoom: number;
  panX: number;
  panY: number;
  canvasRef: React.RefObject<HTMLDivElement>;
  selectedIds: string[];
  hoveredId: string | null;
  altHoveredId: string | null;
  altMode: boolean;
  isDroppingVariant: boolean;
  /** Canvas-div-relative Y (px) of the active insert line. Works for root and in-container. */
  dropLineY: number | null;
  /** ID of the container node that will receive the drop (shown with blue border) */
  dropContainerId?: string | null;
  pageNodes: SDUINode[];
  gridOverlay: GridOverlayConfig;
  onResizeStart: (nodeId: string, handle: ResizeHandle, e: React.PointerEvent) => void;
  /** When true, hides selection rings and resize handles so they don't float over the drag ghost. */
  isDragging?: boolean;
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function getCanvasRect(id: string, canvasEl: HTMLElement): CanvasRect | null {
  const el = canvasEl.querySelector(`[data-builder-id="${id}"]`);
  if (!el) return null;
  const r  = el.getBoundingClientRect();
  const cr = canvasEl.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
}

function getComputedPadding(id: string, canvasEl: HTMLElement) {
  const el = canvasEl.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null;
  if (!el) return null;
  const cs = window.getComputedStyle(el);
  return {
    top:    parseFloat(cs.paddingTop)    || 0,
    right:  parseFloat(cs.paddingRight)  || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left:   parseFloat(cs.paddingLeft)   || 0,
  };
}

/** Returns true if a node is absolutely / fixed positioned (out of normal flow). */
function isAbsoluteNode(id: string, pageNodes: SDUINode[]): boolean {
  const find = (nodes: SDUINode[]): SDUINode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children?.length) {
        const found = find(n.children as SDUINode[]);
        if (found) return found;
      }
    }
    return null;
  };
  const node = find(pageNodes);
  const cls = (node?.props as { className?: string })?.className ?? '';
  return /\b(absolute|fixed)\b/.test(cls);
}

function getComputedFlex(id: string, canvasEl: HTMLElement) {
  const el = canvasEl.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null;
  if (!el) return null;
  const cs = window.getComputedStyle(el);
  return {
    display:       cs.display,
    flexDirection: cs.flexDirection,
    gap:           parseFloat(cs.gap)    || 0,
  };
}

// ─── Selection box + resize handles ──────────────────────────────────────────

function SelectionBox({ rect, nodeId, onResizeStart }: {
  rect: CanvasRect;
  nodeId: string;
  onResizeStart: OverlayProps['onResizeStart'];
}) {
  const handles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const pos: Record<ResizeHandle, { top: string; left: string; cursor: string }> = {
    nw: { top: '-5px',                 left: '-5px',                 cursor: 'nw-resize' },
    n:  { top: '-5px',                 left: `${rect.w / 2 - 5}px`, cursor: 'n-resize'  },
    ne: { top: '-5px',                 left: `${rect.w - 5}px`,     cursor: 'ne-resize' },
    e:  { top: `${rect.h / 2 - 5}px`, left: `${rect.w - 5}px`,     cursor: 'e-resize'  },
    se: { top: `${rect.h - 5}px`,     left: `${rect.w - 5}px`,     cursor: 'se-resize' },
    s:  { top: `${rect.h - 5}px`,     left: `${rect.w / 2 - 5}px`, cursor: 's-resize'  },
    sw: { top: `${rect.h - 5}px`,     left: '-5px',                 cursor: 'sw-resize' },
    w:  { top: `${rect.h / 2 - 5}px`, left: '-5px',                 cursor: 'w-resize'  },
  };

  return (
    <div data-testid="selection-ring" style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, border: '2px solid #3b82f6', pointerEvents: 'none', boxSizing: 'border-box' }}>
      {handles.map(h => (
        <div
          key={h}
          data-testid="resize-handle"
          data-handle={h}
          style={{ position: 'absolute', top: pos[h].top, left: pos[h].left, width: 10, height: 10, background: '#fff', border: '2px solid #3b82f6', borderRadius: 2, cursor: pos[h].cursor, pointerEvents: 'all', zIndex: 10 }}
          onPointerDown={e => { e.stopPropagation(); onResizeStart(nodeId, h, e); }}
        />
      ))}
    </div>
  );
}

// ─── Dimension tooltip ────────────────────────────────────────────────────────

function DimensionTooltip({ rect, zoom }: { rect: CanvasRect; zoom: number }) {
  const w = Math.round(rect.w / zoom);
  const h = Math.round(rect.h / zoom);
  return (
    <div style={{
      position: 'absolute',
      left: rect.x + rect.w / 2,
      top: rect.y + rect.h + 8,
      transform: 'translateX(-50%)',
      background: '#3b82f6',
      color: '#fff',
      fontSize: 10,
      fontFamily: 'system-ui',
      padding: '2px 7px',
      borderRadius: 3,
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 20,
    }}>
      {w} × {h}
    </div>
  );
}

// ─── Crosshair center lines ───────────────────────────────────────────────────

function CrosshairLines({ rect }: { rect: CanvasRect }) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return (
    <>
      <div data-testid="crosshair-h" style={{ position: 'absolute', left: 0, top: cy, width: '100%', height: 0, borderTop: '1px dashed rgba(59,130,246,0.5)', pointerEvents: 'none' }} />
      <div data-testid="crosshair-v" style={{ position: 'absolute', left: cx, top: 0, width: 0, height: '100%', borderLeft: '1px dashed rgba(59,130,246,0.5)', pointerEvents: 'none' }} />
    </>
  );
}

// ─── Hover outline + label ────────────────────────────────────────────────────

function HoverOutline({ rect, label }: { rect: CanvasRect; label: string }) {
  return (
    <>
      <div data-testid="hover-outline" style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, border: '1px dashed rgba(59,130,246,0.7)', pointerEvents: 'none', boxSizing: 'border-box' }} />
      <div style={{ position: 'absolute', left: rect.x, top: Math.max(0, rect.y - 22), background: '#3b82f6', color: '#fff', fontSize: 10, fontFamily: 'system-ui', padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 20 }}>
        {label}
      </div>
    </>
  );
}

// ─── Padding fills (teal) ────────────────────────────────────────────────────

function PaddingFills({ rect, padding, zoom }: {
  rect: CanvasRect;
  padding: { top: number; right: number; bottom: number; left: number };
  zoom: number;
}) {
  const { top, right, bottom, left } = padding;
  if (!top && !right && !bottom && !left) return null;
  const color  = 'rgba(0,200,180,0.25)';
  const border = '1px dashed rgba(0,200,180,0.6)';
  return (
    <>
      {top    > 0 && <div data-testid="padding-fill" style={{ position: 'absolute', left: rect.x, top: rect.y,                           width: rect.w,                            height: top   * zoom, background: color, pointerEvents: 'none', borderBottom: border }} />}
      {bottom > 0 && <div data-testid="padding-fill" style={{ position: 'absolute', left: rect.x, top: rect.y + rect.h - bottom * zoom, width: rect.w,                            height: bottom* zoom, background: color, pointerEvents: 'none', borderTop:    border }} />}
      {left   > 0 && <div data-testid="padding-fill" style={{ position: 'absolute', left: rect.x, top: rect.y + top * zoom,             width: left  * zoom, height: rect.h - (top + bottom) * zoom, background: color, pointerEvents: 'none', borderRight:  border }} />}
      {right  > 0 && <div data-testid="padding-fill" style={{ position: 'absolute', left: rect.x + rect.w - right * zoom, top: rect.y + top * zoom, width: right * zoom, height: rect.h - (top + bottom) * zoom, background: color, pointerEvents: 'none', borderLeft: border }} />}
    </>
  );
}

// ─── Gap fills (pink) ────────────────────────────────────────────────────────

function GapFills({ nodeId, canvasEl, canvasRect }: {
  nodeId: string;
  canvasEl: HTMLElement;
  zoom: number;
  canvasRect: { left: number; top: number };
}) {
  const flex = getComputedFlex(nodeId, canvasEl);
  if (!flex || !flex.gap || flex.display !== 'flex') return null;
  const isRow = flex.flexDirection === 'row' || flex.flexDirection === 'row-reverse';
  const color = 'rgba(255,100,100,0.25)';

  const parent = canvasEl.querySelector(`[data-builder-id="${nodeId}"]`);
  if (!parent) return null;
  // Only include in-flow children — absolute/fixed nodes are out of the flow
  // and their positions are unrelated to the flex gap.
  const directChildren = Array.from(parent.children).filter(c => {
    const el = c as HTMLElement;
    if (!el.dataset?.builderId) return false;
    const pos = window.getComputedStyle(el).position;
    return pos !== 'absolute' && pos !== 'fixed';
  }) as HTMLElement[];
  if (directChildren.length < 2) return null;

  const fills: React.ReactNode[] = [];
  for (let i = 0; i < directChildren.length - 1; i++) {
    const a = directChildren[i].getBoundingClientRect();
    const b = directChildren[i + 1].getBoundingClientRect();
    if (isRow) {
      const x1 = a.right - canvasRect.left, x2 = b.left - canvasRect.left;
      const y  = Math.min(a.top, b.top) - canvasRect.top;
      const h  = Math.max(a.height, b.height);
      fills.push(<div key={i} data-testid="gap-fill" style={{ position: 'absolute', left: x1, top: y, width: Math.max(0, x2 - x1), height: h, background: color, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 9, color: '#f87171', fontFamily: 'system-ui' }}>{Math.round(flex.gap)}px</span></div>);
    } else {
      const y1 = a.bottom - canvasRect.top, y2 = b.top - canvasRect.top;
      const x  = Math.min(a.left, b.left) - canvasRect.left;
      const w  = Math.max(a.width, b.width);
      fills.push(<div key={i} data-testid="gap-fill" style={{ position: 'absolute', left: x, top: y1, width: w, height: Math.max(0, y2 - y1), background: color, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 9, color: '#f87171', fontFamily: 'system-ui' }}>{Math.round(flex.gap)}px</span></div>);
    }
  }
  return <>{fills}</>;
}

// ─── Distance lines (Alt+hover) ───────────────────────────────────────────────

function RedLine({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label: string }) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return null;
  const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
  const midX  = (x1 + x2) / 2;
  const midY  = (y1 + y2) / 2;
  return (
    <>
      <div data-testid="distance-line" style={{ position: 'absolute', left: x1, top: y1, width: len, height: 1, background: '#ef4444', transformOrigin: '0 50%', transform: `rotate(${angle}deg)`, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: midX - 16, top: midY - 10, background: '#ef4444', color: '#fff', fontSize: 9, fontFamily: 'system-ui', padding: '1px 4px', borderRadius: 2, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 30 }}>{label}</div>
    </>
  );
}

function DistanceLines({ selRect, tgtRect }: { selRect: CanvasRect; tgtRect: CanvasRect }) {
  const smy = selRect.y + selRect.h / 2;
  const smx = selRect.x + selRect.w / 2;
  const rightGap  = tgtRect.x - (selRect.x + selRect.w);
  const leftGap   = selRect.x - (tgtRect.x + tgtRect.w);
  const bottomGap = tgtRect.y - (selRect.y + selRect.h);
  const topGap    = selRect.y - (tgtRect.y + tgtRect.h);
  return (
    <>
      {rightGap  > 0 && <RedLine x1={selRect.x + selRect.w} y1={smy} x2={tgtRect.x} y2={smy} label={`${Math.round(rightGap)}px`} />}
      {leftGap   > 0 && <RedLine x1={tgtRect.x + tgtRect.w} y1={smy} x2={selRect.x} y2={smy} label={`${Math.round(leftGap)}px`} />}
      {bottomGap > 0 && <RedLine x1={smx} y1={selRect.y + selRect.h} x2={smx} y2={tgtRect.y} label={`${Math.round(bottomGap)}px`} />}
      {topGap    > 0 && <RedLine x1={smx} y1={tgtRect.y + tgtRect.h} x2={smx} y2={selRect.y} label={`${Math.round(topGap)}px`} />}
    </>
  );
}

// ─── Drop zone line ───────────────────────────────────────────────────────────

function DropZoneLine({ y, width, active }: { y: number; width: number; active: boolean }) {
  return (
    <div data-testid="drop-zone-line" data-active={String(active)} style={{ position: 'absolute', left: 0, top: y - 1, width, height: active ? 3 : 1, background: active ? '#3b82f6' : 'rgba(59,130,246,0.4)', pointerEvents: 'none' }}>
      {active && <div style={{ position: 'absolute', left: -5, top: -4, width: 10, height: 10, borderRadius: '50%', background: '#3b82f6' }} />}
    </div>
  );
}

// ─── Grid overlay ─────────────────────────────────────────────────────────────

function GridOverlay({ panX, panY, zoom, config }: {
  panX: number; panY: number; zoom: number; config: GridOverlayConfig;
}) {
  if (!config.enabled) return null;

  const VIEWPORT_W = 1280;
  const VIEWPORT_H = 900;
  const frameW = VIEWPORT_W * zoom;
  const frameH = VIEWPORT_H * zoom;
  const lines: React.ReactNode[] = [];

  if (config.type === 'columns' || config.type === 'grid') {
    const colW = frameW / config.count;
    for (let i = 1; i < config.count; i++) {
      lines.push(
        <div key={`col-${i}`} style={{ position: 'absolute', left: panX + colW * i, top: panY, width: 1, height: frameH, background: config.color, pointerEvents: 'none' }} />
      );
    }
    // Column fill bands
    for (let i = 0; i < config.count; i++) {
      if (i % 2 === 0) continue;
      lines.push(
        <div key={`col-fill-${i}`} style={{ position: 'absolute', left: panX + colW * i, top: panY, width: colW, height: frameH, background: config.color, pointerEvents: 'none', opacity: 0.5 }} />
      );
    }
  }

  if (config.type === 'rows' || config.type === 'grid') {
    const rowH = frameH / config.count;
    for (let i = 1; i < config.count; i++) {
      lines.push(
        <div key={`row-${i}`} style={{ position: 'absolute', left: panX, top: panY + rowH * i, width: frameW, height: 1, background: config.color, pointerEvents: 'none' }} />
      );
    }
  }

  return <>{lines}</>;
}

// ─── Main Overlay ─────────────────────────────────────────────────────────────

export default function BuilderOverlay({
  zoom,
  panX,
  panY,
  canvasRef,
  selectedIds,
  hoveredId,
  altHoveredId,
  altMode,
  isDroppingVariant,
  dropLineY,
  dropContainerId,
  pageNodes,
  gridOverlay,
  onResizeStart,
  isDragging = false,
}: OverlayProps) {
  // RAF loop keeps overlay in sync with scroll/animation
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (selectedIds.length === 0 && !hoveredId && !dropContainerId) return;
    const loop = () => { setTick(t => t + 1); rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [selectedIds.length, hoveredId]);

  // All hooks must run unconditionally
  const canvasEl = canvasRef.current;
  const canvasDomRect = canvasEl?.getBoundingClientRect() ?? { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };

  const hoverRect = useMemo(() => {
    if (!canvasEl || !hoveredId || selectedIds.includes(hoveredId) || altMode) return null;
    return getCanvasRect(hoveredId, canvasEl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasEl, hoveredId, selectedIds, altMode, tick]);

  const selectedRects = useMemo(() => {
    if (!canvasEl) return [] as { id: string; rect: CanvasRect }[];
    return selectedIds
      .map(id => ({ id, rect: getCanvasRect(id, canvasEl) }))
      .filter(r => r.rect !== null) as { id: string; rect: CanvasRect }[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasEl, selectedIds, tick]);

  const firstSel = selectedRects[0];

  const multiBBox = useMemo((): CanvasRect | null => {
    if (selectedRects.length <= 1) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { rect } of selectedRects) {
      minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
    }
    return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [selectedRects]);

  const altRect = useMemo(() => {
    if (!canvasEl || !altMode || !altHoveredId) return null;
    return getCanvasRect(altHoveredId, canvasEl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasEl, altMode, altHoveredId, tick]);

  // dropLineY is computed in onDragOver and passed in directly — no local memo needed.

  if (!canvasEl) return null;

  return (
    <div data-builder-overlay="1" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>

      {/* Grid overlay */}
      <GridOverlay panX={panX} panY={panY} zoom={zoom} config={gridOverlay} />

      {/* Hover outline — hidden while dragging to avoid floating labels */}
      {!isDragging && hoverRect && (() => {
        const el = canvasEl.querySelector(`[data-builder-id="${hoveredId}"]`) as HTMLElement | null;
        const type = el?.dataset.builderType ?? 'node';
        const label = `${type}  ${Math.round(hoverRect.w / zoom)} × ${Math.round(hoverRect.h / zoom)}`;
        return <HoverOutline rect={hoverRect} label={label} />;
      })()}

      {/* Single selection — hidden while dragging so resize handles don't float over the ghost */}
      {!isDragging && selectedRects.length === 1 && firstSel && (() => {
        const isAbs = isAbsoluteNode(firstSel.id, pageNodes);
        const padding = isAbs ? null : getComputedPadding(firstSel.id, canvasEl);
        return (
          <>
            {/* Crosshair alignment lines and gap fills are flow-layout concepts —
                skip them for absolutely positioned nodes */}
            {!isAbs && <CrosshairLines rect={firstSel.rect} />}
            <SelectionBox rect={firstSel.rect} nodeId={firstSel.id} onResizeStart={onResizeStart} />
            <DimensionTooltip rect={firstSel.rect} zoom={zoom} />
            {padding && <PaddingFills rect={firstSel.rect} padding={padding} zoom={zoom} />}
            {!isAbs && <GapFills nodeId={firstSel.id} canvasEl={canvasEl} zoom={zoom} canvasRect={canvasDomRect} />}
          </>
        );
      })()}

      {/* Multi-select: highlights + bounding box */}
      {!isDragging && selectedRects.length > 1 && (
        <>
          {selectedRects.map(({ id, rect }) => (
            <div key={id} data-testid="selection-ring" style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, border: '1px solid #3b82f6', background: 'rgba(59,130,246,0.05)', pointerEvents: 'none' }} />
          ))}
          {multiBBox && (
            <>
              <div style={{ position: 'absolute', left: multiBBox.x, top: multiBBox.y, width: multiBBox.w, height: multiBBox.h, border: '1px dashed #3b82f6', pointerEvents: 'none' }} />
              <DimensionTooltip rect={multiBBox} zoom={zoom} />
            </>
          )}
        </>
      )}

      {/* Alt+hover distance lines */}
      {altMode && altRect && firstSel && (
        <DistanceLines selRect={firstSel.rect} tgtRect={altRect} />
      )}

      {/* Insert indicator line — shown for any drop position (root or in-container) */}
      {isDroppingVariant && dropLineY !== null && (
        <DropZoneLine y={dropLineY} width={canvasEl.clientWidth} active={true} />
      )}

      {/* Container drop highlight — blue border when dragging INTO a container */}
      {dropContainerId && (() => {
        const r = getCanvasRect(dropContainerId, canvasEl);
        if (!r) return null;
        return (
          <div
            data-testid="drop-container-highlight"
            style={{
              position: 'absolute',
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              border: '2px dashed #3b82f6',
              background: 'rgba(59,130,246,0.08)',
              borderRadius: 4,
              pointerEvents: 'none',
              boxSizing: 'border-box',
            }}
          />
        );
      })()}

      {/* Hidden-node dim overlay */}
      {pageNodes.filter(n => n.id).map(n => {
        const el = canvasEl.querySelector(`[data-builder-id="${n.id}"][data-builder-hidden="true"]`) as HTMLElement | null;
        if (!el) return null;
        const r  = el.getBoundingClientRect();
        const cr = canvasDomRect;
        return (
          <div key={n.id} style={{ position: 'absolute', left: r.left - cr.left, top: r.top - cr.top, width: r.width, height: r.height, background: 'rgba(0,0,0,0.35)', pointerEvents: 'none', border: '1px dashed rgba(255,200,0,0.5)' }} />
        );
      })}
    </div>
  );
}
