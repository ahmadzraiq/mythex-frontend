'use client';

/**
 * Builder Overlay — drawn on top of the page frame.
 *
 * All coordinates are in CANVAS space (screen pixels relative to the canvas
 * container). getBoundingClientRect() already accounts for CSS scale() so no
 * zoom division is needed for position; widths/heights are in screen-pixel
 * space (already scaled).
 */

import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import type { SDUINode } from '@/lib/sdui/types/node';
import type { GridOverlayConfig } from './_store';
import { useBuilderStore } from './_store';

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
  /** Canvas-div-relative Y (px) of the active insert line. Used for column containers. */
  dropLineY: number | null;
  /** Canvas-div-relative X (px) of the active insert line. Used for row containers (HStack, flex-row). */
  dropLineX?: number | null;
  /** ID of the container node that will receive the drop (shown with blue border) */
  dropContainerId?: string | null;
  pageNodes: SDUINode[];
  gridOverlay: GridOverlayConfig;
  onResizeStart: (nodeId: string, handle: ResizeHandle, e: React.PointerEvent) => void;
  /** When true, hides selection rings and resize handles so they don't float over the drag ghost. */
  isDragging?: boolean;
  /**
   * Ref that canvas populates with a `notify()` function.
   * Canvas calls `notifyRef.current()` whenever it moves (scroll, pan-drag, edit) to
   * trigger a burst of overlay measurement ticks. The overlay stops its RAF loop
   * automatically after it detects the canvas has been idle for ~200 ms.
   */
  notifyRef?: React.MutableRefObject<(() => void) | null>;
  /**
   * Ref that canvas populates with an instant synchronous update function.
   * Called directly inside `applyWorldTransform` (same frame as the CSS transform change)
   * so the selection ring tracks pan/zoom with zero lag — no React re-render needed.
   */
  overlayInstantUpdateRef?: React.MutableRefObject<(() => void) | null>;
  /**
   * Live zoom ref from canvas — always holds the current zoom value during a gesture,
   * even before Zustand is updated (debounced). Used to compute padding fill sizes
   * correctly during zoom without waiting for a React re-render.
   */
  liveZoomRef?: React.MutableRefObject<number>;
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

// ─── Interaction Lines ────────────────────────────────────────────────────────

const ACTION_LINE_COLOR: Record<string, string> = {
  navigate:   '#3b82f6',
  setState:   '#f97316',
  set:        '#f97316',
  setVar:     '#f97316',
  fetch:      '#22c55e',
  graphql:    '#22c55e',
  toggle:     '#a78bfa',
  increment:  '#a78bfa',
  decrement:  '#a78bfa',
  animate:    '#fb923c',
  default:    '#6b7280',
};

function getActionColor(actionType: string): string {
  return ACTION_LINE_COLOR[actionType] ?? ACTION_LINE_COLOR.default;
}

function flattenNodes(nodes: SDUINode[]): SDUINode[] {
  const result: SDUINode[] = [];
  const visit = (ns: SDUINode[]) => {
    for (const n of ns) {
      result.push(n);
      if (n.children?.length) visit(n.children as SDUINode[]);
    }
  };
  visit(nodes);
  return result;
}

interface InteractionLine {
  id: string;
  fromId: string;
  event: string;
  actionType: string;
  label: string;
  color: string;
}

function InteractionLines({ pageNodes, canvasEl, canvasDomRect }: {
  pageNodes: SDUINode[];
  canvasEl: HTMLElement;
  canvasDomRect: DOMRect;
}) {
  const allNodes = useMemo(() => flattenNodes(pageNodes), [pageNodes]);
  const [hoveredLine, setHoveredLine] = useState<string | null>(null);

  const lines = useMemo((): InteractionLine[] => {
    const result: InteractionLine[] = [];
    for (const node of allNodes) {
      if (!node.id || !node.actions) continue;
      for (const [event, actionDef] of Object.entries(node.actions)) {
        const defs = Array.isArray(actionDef) ? actionDef : [actionDef];
        for (const def of defs) {
          const d = def as unknown as Record<string, unknown>;
          const actionType = String(d.type ?? d.action ?? 'default');
          result.push({
            id: `${node.id}-${event}-${actionType}`,
            fromId: node.id,
            event,
            actionType,
            label: `${event} → ${actionType}`,
            color: getActionColor(actionType),
          });
        }
      }
    }
    return result;
  }, [allNodes]);

  if (!lines.length) return null;
  const cr = canvasDomRect;

  return (
    <svg
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      width={canvasEl.clientWidth}
      height={canvasEl.clientHeight}
    >
      {lines.map(line => {
        const fromEl = canvasEl.querySelector(`[data-builder-id="${line.fromId}"]`);
        if (!fromEl) return null;
        const fromR = fromEl.getBoundingClientRect();
        const fx = fromR.left - cr.left + fromR.width / 2;
        const fy = fromR.top  - cr.top  + fromR.height;

        const isHovered = hoveredLine === line.id;
        const opacity = isHovered ? 1 : 0.5;

        return (
          <g key={line.id}>
            {/* Small dot at source */}
            <circle cx={fx} cy={fy} r={4} fill={line.color} opacity={opacity} />
            {/* Label badge */}
            <g
              transform={`translate(${fx - 30}, ${fy + 4})`}
              style={{ pointerEvents: 'all', cursor: 'default' }}
              onMouseEnter={() => setHoveredLine(line.id)}
              onMouseLeave={() => setHoveredLine(null)}
            >
              <rect x={0} y={0} width={60} height={14} rx={3} fill={line.color} opacity={opacity * 0.9} />
              <text x={30} y={10} textAnchor="middle" fontSize={8} fill="#fff" fontFamily="system-ui">
                {line.event}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
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

function getComputedMargin(id: string, canvasEl: HTMLElement) {
  const el = canvasEl.querySelector(`[data-builder-id="${id}"]`) as HTMLElement | null;
  if (!el) return null;
  const cs = window.getComputedStyle(el);
  const top    = parseFloat(cs.marginTop)    || 0;
  const right  = parseFloat(cs.marginRight)  || 0;
  const bottom = parseFloat(cs.marginBottom) || 0;
  const left   = parseFloat(cs.marginLeft)   || 0;
  // Only return when at least one side is non-zero to avoid rendering empty fills.
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return null;
  return { top, right, bottom, left };
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

/**
 * Handle positions use CSS anchors (top/right/bottom/left + transform) instead of
 * calculated pixel offsets from rect.w/h. This means handles auto-reposition when
 * the ring div's size is updated imperatively (without a React re-render).
 */
const HANDLE_STYLE: Record<ResizeHandle, React.CSSProperties> = {
  nw: { top: -5, left: -5,                                              cursor: 'nw-resize' },
  n:  { top: -5, left: '50%', transform: 'translateX(-50%)',            cursor: 'n-resize'  },
  ne: { top: -5, right: -5,                                             cursor: 'ne-resize' },
  e:  { top: '50%', right: -5, transform: 'translateY(-50%)',           cursor: 'e-resize'  },
  se: { bottom: -5, right: -5,                                          cursor: 'se-resize' },
  s:  { bottom: -5, left: '50%', transform: 'translateX(-50%)',         cursor: 's-resize'  },
  sw: { bottom: -5, left: -5,                                           cursor: 'sw-resize' },
  w:  { top: '50%', left: -5, transform: 'translateY(-50%)',            cursor: 'w-resize'  },
};

function SelectionBox({ rect, nodeId, onResizeStart, zoom, ringRef }: {
  rect: CanvasRect;
  nodeId: string;
  onResizeStart: OverlayProps['onResizeStart'];
  zoom: number;
  ringRef?: React.Ref<HTMLDivElement>;
}) {
  const handles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const w = Math.round(rect.w / zoom);
  const h = Math.round(rect.h / zoom);

  return (
    <div
      ref={ringRef}
      data-testid="selection-ring"
      style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, border: '2px solid #3b82f6', pointerEvents: 'none', boxSizing: 'border-box' }}
    >
      {handles.map(handle => (
        <div
          key={handle}
          data-testid="resize-handle"
          data-handle={handle}
          style={{ position: 'absolute', width: 10, height: 10, background: '#fff', border: '2px solid #3b82f6', borderRadius: 2, pointerEvents: 'all', zIndex: 10, boxSizing: 'border-box', ...HANDLE_STYLE[handle] }}
          onPointerDown={e => { e.stopPropagation(); onResizeStart(nodeId, handle, e); }}
        />
      ))}
      {/* Tooltip lives inside the ring so it auto-follows imperative position updates.
          data-dim-tooltip lets overlayInstantUpdateRef update the text imperatively
          using liveZoomRef so the numbers are always accurate during zoom gestures. */}
      <div
        data-dim-tooltip
        style={{
          position: 'absolute',
          bottom: -26,
          left: '50%',
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
        }}
      >
        {w} × {h}
      </div>
    </div>
  );
}

// ─── Hover outline + label ────────────────────────────────────────────────────

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
      {top    > 0 && <div data-testid="padding-fill" data-padding-side="top"    style={{ position: 'absolute', left: rect.x, top: rect.y,                           width: rect.w,                            height: top   * zoom, background: color, pointerEvents: 'none', borderBottom: border }} />}
      {bottom > 0 && <div data-testid="padding-fill" data-padding-side="bottom" style={{ position: 'absolute', left: rect.x, top: rect.y + rect.h - bottom * zoom, width: rect.w,                            height: bottom* zoom, background: color, pointerEvents: 'none', borderTop:    border }} />}
      {left   > 0 && <div data-testid="padding-fill" data-padding-side="left"   style={{ position: 'absolute', left: rect.x, top: rect.y + top * zoom,             width: left  * zoom, height: rect.h - (top + bottom) * zoom, background: color, pointerEvents: 'none', borderRight:  border }} />}
      {right  > 0 && <div data-testid="padding-fill" data-padding-side="right"  style={{ position: 'absolute', left: rect.x + rect.w - right * zoom, top: rect.y + top * zoom, width: right * zoom, height: rect.h - (top + bottom) * zoom, background: color, pointerEvents: 'none', borderLeft: border }} />}
    </>
  );
}

// ─── Margin fills (orange) ───────────────────────────────────────────────────

function MarginFills({ rect, margin, zoom }: {
  rect: CanvasRect;
  margin: { top: number; right: number; bottom: number; left: number };
  zoom: number;
}) {
  const { top, right, bottom, left } = margin;
  const color  = 'rgba(255,165,0,0.25)';
  const border = '1px dashed rgba(255,165,0,0.6)';
  return (
    <>
      {top    > 0 && <div data-testid="margin-fill" data-margin-side="top"    style={{ position: 'absolute', left: rect.x,              top:  rect.y - top * zoom,        width: rect.w,              height: top    * zoom, background: color, pointerEvents: 'none', borderBottom: border }} />}
      {bottom > 0 && <div data-testid="margin-fill" data-margin-side="bottom" style={{ position: 'absolute', left: rect.x,              top:  rect.y + rect.h,            width: rect.w,              height: bottom * zoom, background: color, pointerEvents: 'none', borderTop:    border }} />}
      {left   > 0 && <div data-testid="margin-fill" data-margin-side="left"   style={{ position: 'absolute', left: rect.x - left * zoom, top:  rect.y - top * zoom,        width: left    * zoom, height: rect.h + (top + bottom) * zoom, background: color, pointerEvents: 'none', borderRight:  border }} />}
      {right  > 0 && <div data-testid="margin-fill" data-margin-side="right"  style={{ position: 'absolute', left: rect.x + rect.w,     top:  rect.y - top * zoom,        width: right   * zoom, height: rect.h + (top + bottom) * zoom, background: color, pointerEvents: 'none', borderLeft:   border }} />}
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
      fills.push(<div key={i} data-testid="gap-fill" data-gap-fill-index={i} data-gap-fill-dir="row" style={{ position: 'absolute', left: x1, top: y, width: Math.max(0, x2 - x1), height: h, background: color, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 9, color: '#f87171', fontFamily: 'system-ui' }}>{Math.round(flex.gap)}px</span></div>);
    } else {
      const y1 = a.bottom - canvasRect.top, y2 = b.top - canvasRect.top;
      const x  = Math.min(a.left, b.left) - canvasRect.left;
      const w  = Math.max(a.width, b.width);
      fills.push(<div key={i} data-testid="gap-fill" data-gap-fill-index={i} data-gap-fill-dir="col" style={{ position: 'absolute', left: x, top: y1, width: w, height: Math.max(0, y2 - y1), background: color, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 9, color: '#f87171', fontFamily: 'system-ui' }}>{Math.round(flex.gap)}px</span></div>);
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

function DropZoneLine({
  y, x, width, height, active,
}: {
  y?: number | null;
  x?: number | null;
  width: number;
  height: number;
  active: boolean;
}) {
  if (x != null) {
    // Vertical line — for row / horizontal containers
    return (
      <div
        data-testid="drop-zone-line"
        data-active={String(active)}
        style={{ position: 'absolute', left: x - 1, top: 0, width: active ? 3 : 1, height, background: active ? '#3b82f6' : 'rgba(59,130,246,0.4)', pointerEvents: 'none' }}
      >
        {active && <div style={{ position: 'absolute', left: -4, top: -5, width: 10, height: 10, borderRadius: '50%', background: '#3b82f6' }} />}
      </div>
    );
  }
  if (y != null) {
    // Horizontal line — for column / vertical containers (original behaviour)
    return (
      <div
        data-testid="drop-zone-line"
        data-active={String(active)}
        style={{ position: 'absolute', left: 0, top: y - 1, width, height: active ? 3 : 1, background: active ? '#3b82f6' : 'rgba(59,130,246,0.4)', pointerEvents: 'none' }}
      >
        {active && <div style={{ position: 'absolute', left: -5, top: -4, width: 10, height: 10, borderRadius: '50%', background: '#3b82f6' }} />}
      </div>
    );
  }
  return null;
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
  dropLineX,
  dropContainerId,
  pageNodes,
  gridOverlay,
  onResizeStart,
  isDragging = false,
  notifyRef,
  overlayInstantUpdateRef,
  liveZoomRef,
}: OverlayProps) {
  const showInteractionLines = useBuilderStore(s => s.showInteractionLines);

  // ── Event-driven RAF loop ────────────────────────────────────────────────
  //
  // The loop only runs during active interaction (scroll, pan, hover, edit).
  // Canvas calls notifyRef.current() to trigger a burst of ticks. After
  // ~200 ms of inactivity the loop stops automatically — zero idle CPU.
  const [tick, setTick] = useState(0);
  const rafRef        = useRef<number | undefined>(undefined);
  const idleTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRunningRef  = useRef(false);

  const startRAF = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    const loop = () => {
      setTick(t => t + 1);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopRAF = useCallback(() => {
    isRunningRef.current = false;
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
  }, []);

  /** Called by canvas on every scroll/pan/edit event. */
  const notify = useCallback(() => {
    startRAF();
    // Reset idle timer — stop the loop 200 ms after the last notify
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(stopRAF, 200);
  }, [startRAF, stopRAF]);

  // Register notify with the canvas via notifyRef
  useEffect(() => {
    if (notifyRef) notifyRef.current = notify;
    return () => { if (notifyRef) notifyRef.current = null; };
  }, [notifyRef, notify]);

  // Also run during hover/selection changes (same short burst pattern)
  useEffect(() => {
    if (selectedIds.length === 0 && !hoveredId && !dropContainerId) { stopRAF(); return; }
    notify();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.length, hoveredId, dropContainerId]);

  // Cleanup on unmount
  useEffect(() => () => {
    stopRAF();
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
  }, [stopRAF]);

  // All hooks must run unconditionally
  const canvasEl = canvasRef.current;

  // Cache the canvas bounding rect — only update on resize, never on every RAF tick.
  // getBoundingClientRect() forces layout; calling it at 60fps causes significant jank.
  const canvasDomRectRef = useRef<DOMRect | null>(null);
  useEffect(() => {
    if (!canvasEl) return;
    canvasDomRectRef.current = canvasEl.getBoundingClientRect();
    const ro = new ResizeObserver(() => {
      canvasDomRectRef.current = canvasEl.getBoundingClientRect();
    });
    ro.observe(canvasEl);
    return () => ro.disconnect();
  }, [canvasEl]);
  const canvasDomRect = canvasDomRectRef.current ?? ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 } as DOMRect);

  // ── Hover outline (imperative) ────────────────────────────────────────────
  //
  // Position the hover outline elements whenever the hovered element changes.
  // During pan/zoom, overlayInstantUpdateRef also updates them for zero-lag tracking.
  useEffect(() => {
    const hId   = hoveredId;
    const show  = !!(hId && !selectedIds.includes(hId) && !altMode && canvasEl && !isDragging);
    if (!show) {
      if (imperativeHoverBorderRef.current) imperativeHoverBorderRef.current.style.display = 'none';
      if (imperativeHoverLabelRef.current)  imperativeHoverLabelRef.current.style.display  = 'none';
      return;
    }
    const hEl = canvasEl!.querySelector(`[data-builder-id="${hId}"]`) as HTMLElement | null;
    const cr  = canvasDomRectRef.current;
    if (!hEl || !cr) return;
    const hR   = hEl.getBoundingClientRect();
    const hx   = hR.left - cr.left;
    const hy   = hR.top  - cr.top;
    const hType = hEl.dataset.builderType ?? 'node';
    const logW  = hEl.offsetWidth;
    const logH  = hEl.offsetHeight;
    if (imperativeHoverBorderRef.current) {
      const b = imperativeHoverBorderRef.current;
      b.style.left    = `${hx}px`;
      b.style.top     = `${hy}px`;
      b.style.width   = `${hR.width}px`;
      b.style.height  = `${hR.height}px`;
      b.style.display = '';
    }
    if (imperativeHoverLabelRef.current) {
      const l = imperativeHoverLabelRef.current;
      l.style.left      = `${hx}px`;
      l.style.top       = `${Math.max(0, hy - 22)}px`;
      l.style.display   = '';
      l.textContent     = `${hType}  ${logW} × ${logH}`;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredId, selectedIds, altMode, isDragging, canvasEl]);

  // ── Instant synchronous update (zero-lag pan tracking) ──────────────────
  //
  // Canvas calls overlayInstantUpdateRef.current() directly inside
  // applyWorldTransform — same JS task as the CSS transform change.
  // getBoundingClientRect() forces a layout reflow that already accounts for
  // the new transform, giving us the true current position with no React lag.
  //
  // Two elements are updated:
  //  1. selectionRingRef — ring div position / size set individually.
  //  2. singleSelLayerRef — a wrapper for padding fills, gap fills, crosshair
  //     lines. Its CSS translate is set to (currentPos - lastReactRenderedPos)
  //     so all children shift by the same delta as the ring.
  //
  // After each React re-render (tick), useLayoutEffect resets the layer
  // translate to '' (positions are fresh from BCR) and records the new
  // ring position as the next "last rendered" baseline.
  const selectionRingRef      = useRef<HTMLDivElement>(null);
  const paddingFillsLayerRef  = useRef<HTMLDivElement>(null);   // padding fills (full recompute)
  const gapFillsLayerRef      = useRef<HTMLDivElement>(null);   // gap fills (full recompute from children BCR)
  const marginFillsLayerRef   = useRef<HTMLDivElement>(null);   // margin fills (full recompute)
  // Crosshairs — fully imperative (like hover outline) so they track during pan/zoom with zero lag.
  const imperativeCrosshairHRef = useRef<HTMLDivElement | null>(null);
  const imperativeCrosshairVRef = useRef<HTMLDivElement | null>(null);

  // Hover outline — imperative refs so position updates in sync with pan/zoom
  // without waiting for a React re-render (eliminates the 1-frame "dancing" lag).
  const hoveredIdRef             = useRef(hoveredId);
  const altModeRef               = useRef(altMode);
  const imperativeHoverBorderRef = useRef<HTMLDivElement | null>(null);
  const imperativeHoverLabelRef  = useRef<HTMLDivElement | null>(null);
  useEffect(() => { hoveredIdRef.current = hoveredId; }, [hoveredId]);
  useEffect(() => { altModeRef.current   = altMode;   }, [altMode]);

  // After every React tick re-render, correct everything before paint.
  //
  // The problem with zoom: React re-renders with the stale Zustand `zoom` prop
  // (debounced 80 ms), so indicator fills paint wrong sizes. useLayoutEffect runs
  // *before* the browser paints, so we re-run the instant update here to apply
  // the correct live zoom — eliminating the single-frame flash entirely.
  //
  // Also runs when pageNodes changes (panel edits like rotation, opacity, etc.) so the
  // selection ring repositions immediately after the React commit — without waiting for
  // the RAF tick loop, which may be stopped when the user is only using the panel.
  useLayoutEffect(() => {
    // Re-run instant update immediately — before paint — so ring, crosshairs, and fills
    // use liveZoomRef (not the stale Zustand zoom prop).
    overlayInstantUpdateRef?.current?.();
  }, [tick, pageNodes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!overlayInstantUpdateRef) return;
    overlayInstantUpdateRef.current = () => {
      if (!canvasEl) return;
      const cr = canvasDomRectRef.current;
      if (!cr) return;

      // ── Selection ring (single selection only) ──────────────────────────
      if (selectedIds.length !== 1) {
        // Multi-select or nothing selected — hide crosshairs, skip ring, update hover below.
        if (imperativeCrosshairHRef.current) imperativeCrosshairHRef.current.style.display = 'none';
        if (imperativeCrosshairVRef.current) imperativeCrosshairVRef.current.style.display = 'none';
      } else {
      const el = canvasEl.querySelector(`[data-builder-id="${selectedIds[0]}"]`);
      if (el) {
      const r  = el.getBoundingClientRect();
      const currX = r.left  - cr.left;
      const currY = r.top   - cr.top;
      const currW = r.width;
      const currH = r.height;
      const z     = liveZoomRef?.current ?? zoom;

      // 1. Update ring (position + size)
      if (selectionRingRef.current) {
        selectionRingRef.current.style.left   = `${currX}px`;
        selectionRingRef.current.style.top    = `${currY}px`;
        selectionRingRef.current.style.width  = `${currW}px`;
        selectionRingRef.current.style.height = `${currH}px`;
        // Also update the dimension tooltip text using live zoom so it never
        // shows stale values during a zoom gesture (Zustand zoom lags ~80 ms).
        const tooltipEl = selectionRingRef.current.querySelector<HTMLElement>('[data-dim-tooltip]');
        if (tooltipEl) {
          tooltipEl.textContent = `${Math.round(currW / z)} × ${Math.round(currH / z)}`;
        }
      }

      // 2. Crosshairs — fully imperative (position updated directly, zero lag during pan/zoom)
      const isAbs = Array.isArray(pageNodes) && pageNodes.length > 0
        ? isAbsoluteNode(selectedIds[0], pageNodes)
        : false;
      if (!isAbs) {
        const cx = currX + currW / 2;
        const cy = currY + currH / 2;
        if (imperativeCrosshairHRef.current) {
          imperativeCrosshairHRef.current.style.top = `${cy}px`;
          imperativeCrosshairHRef.current.style.display = '';
        }
        if (imperativeCrosshairVRef.current) {
          imperativeCrosshairVRef.current.style.left = `${cx}px`;
          imperativeCrosshairVRef.current.style.display = '';
        }
      } else {
        if (imperativeCrosshairHRef.current) imperativeCrosshairHRef.current.style.display = 'none';
        if (imperativeCrosshairVRef.current) imperativeCrosshairVRef.current.style.display = 'none';
      }

      // 3. Padding fills — read fresh from DOM every call (no cache).
      //    Stale cache was the root cause of padding not updating after right-panel edits.
      const padding = getComputedPadding(selectedIds[0], canvasEl);
      if (paddingFillsLayerRef.current && padding) {
        const fills = paddingFillsLayerRef.current.querySelectorAll<HTMLElement>('[data-padding-side]');
        fills.forEach(fill => {
          const side = fill.dataset.paddingSide;
          if (side === 'top') {
            fill.style.left   = `${currX}px`;
            fill.style.top    = `${currY}px`;
            fill.style.width  = `${currW}px`;
            fill.style.height = `${padding.top * z}px`;
          } else if (side === 'bottom') {
            fill.style.left   = `${currX}px`;
            fill.style.top    = `${currY + currH - padding.bottom * z}px`;
            fill.style.width  = `${currW}px`;
            fill.style.height = `${padding.bottom * z}px`;
          } else if (side === 'left') {
            fill.style.left   = `${currX}px`;
            fill.style.top    = `${currY + padding.top * z}px`;
            fill.style.width  = `${padding.left * z}px`;
            fill.style.height = `${currH - (padding.top + padding.bottom) * z}px`;
          } else if (side === 'right') {
            fill.style.left   = `${currX + currW - padding.right * z}px`;
            fill.style.top    = `${currY + padding.top * z}px`;
            fill.style.width  = `${padding.right * z}px`;
            fill.style.height = `${currH - (padding.top + padding.bottom) * z}px`;
          }
        });
      }

      // 4. Gap fills — full recompute from each child's BCR (fresh, no cache).
      const flex = getComputedFlex(selectedIds[0], canvasEl);
      const flexInfo = (flex && flex.gap && flex.display === 'flex')
        ? { isRow: flex.flexDirection === 'row' || flex.flexDirection === 'row-reverse' }
        : null;
      if (gapFillsLayerRef.current && flexInfo) {
        const parent = canvasEl.querySelector(`[data-builder-id="${selectedIds[0]}"]`);
        if (parent) {
          const directChildren = Array.from(parent.children).filter(c => {
            const childEl = c as HTMLElement;
            if (!childEl.dataset?.builderId) return false;
            const pos = window.getComputedStyle(childEl).position;
            return pos !== 'absolute' && pos !== 'fixed';
          }) as HTMLElement[];
          const gapFills = gapFillsLayerRef.current.querySelectorAll<HTMLElement>('[data-gap-fill-index]');
          gapFills.forEach(fill => {
            const idx = parseInt(fill.dataset.gapFillIndex ?? '0', 10);
            const a = directChildren[idx]?.getBoundingClientRect();
            const b = directChildren[idx + 1]?.getBoundingClientRect();
            if (!a || !b) return;
            if (flexInfo.isRow) {
              const x1 = a.right - cr.left, x2 = b.left - cr.left;
              const y  = Math.min(a.top, b.top) - cr.top;
              const h  = Math.max(a.height, b.height);
              fill.style.left   = `${x1}px`;
              fill.style.top    = `${y}px`;
              fill.style.width  = `${Math.max(0, x2 - x1)}px`;
              fill.style.height = `${h}px`;
            } else {
              const y1 = a.bottom - cr.top, y2 = b.top - cr.top;
              const x  = Math.min(a.left, b.left) - cr.left;
              const w  = Math.max(a.width, b.width);
              fill.style.left   = `${x}px`;
              fill.style.top    = `${y1}px`;
              fill.style.width  = `${w}px`;
              fill.style.height = `${Math.max(0, y2 - y1)}px`;
            }
          });
        }
      }

      // 5. Margin fills — read fresh from DOM every call (same rationale as padding).
      const margin = getComputedMargin(selectedIds[0], canvasEl);
      if (marginFillsLayerRef.current && margin) {
        const fills = marginFillsLayerRef.current.querySelectorAll<HTMLElement>('[data-margin-side]');
        fills.forEach(fill => {
          const side = fill.dataset.marginSide;
          if (side === 'top') {
            fill.style.left   = `${currX}px`;
            fill.style.top    = `${currY - margin.top * z}px`;
            fill.style.width  = `${currW}px`;
            fill.style.height = `${margin.top * z}px`;
          } else if (side === 'bottom') {
            fill.style.left   = `${currX}px`;
            fill.style.top    = `${currY + currH}px`;
            fill.style.width  = `${currW}px`;
            fill.style.height = `${margin.bottom * z}px`;
          } else if (side === 'left') {
            fill.style.left   = `${currX - margin.left * z}px`;
            fill.style.top    = `${currY - margin.top * z}px`;
            fill.style.width  = `${margin.left * z}px`;
            fill.style.height = `${currH + (margin.top + margin.bottom) * z}px`;
          } else if (side === 'right') {
            fill.style.left   = `${currX + currW}px`;
            fill.style.top    = `${currY - margin.top * z}px`;
            fill.style.width  = `${margin.right * z}px`;
            fill.style.height = `${currH + (margin.top + margin.bottom) * z}px`;
          }
        });
      }
      } // end if (el) — selection ring section
      } // end else — selectedIds.length === 1

      // ── Hover outline (imperative, all selection states) ────────────────
      // Updated in sync with applyWorldTransform so the outline never lags
      // behind the canvas content during zoom/pan (eliminates dancing).
      const hId  = hoveredIdRef.current;
      const hAlt = altModeRef.current;
      if (hId && !selectedIds.includes(hId) && !hAlt) {
        const hEl = canvasEl.querySelector(`[data-builder-id="${hId}"]`) as HTMLElement | null;
        if (hEl) {
          const hR = hEl.getBoundingClientRect();
          if (imperativeHoverBorderRef.current) {
            imperativeHoverBorderRef.current.style.left   = `${hR.left - cr.left}px`;
            imperativeHoverBorderRef.current.style.top    = `${hR.top  - cr.top }px`;
            imperativeHoverBorderRef.current.style.width  = `${hR.width}px`;
            imperativeHoverBorderRef.current.style.height = `${hR.height}px`;
          }
          if (imperativeHoverLabelRef.current) {
            imperativeHoverLabelRef.current.style.left = `${hR.left - cr.left}px`;
            imperativeHoverLabelRef.current.style.top  = `${Math.max(0, hR.top - cr.top - 22)}px`;
          }
        }
      }
    };
    // Trigger immediate update so crosshairs/ring show on mount when something is selected
    overlayInstantUpdateRef?.current?.();

    // ── Lightweight ring-only update (called from patchStyle RAF) ────────────
    // Accepts pre-computed BCR to avoid a second getBoundingClientRect() call and
    // skips all fill calculations (padding/gap/margin) — they don't change during
    // style edits like rotation/opacity. This eliminates 3x getComputedStyle() calls
    // per RAF, dropping layout flushes from ~5 to 2 per frame during rapid edits.
    const ringOnlyUpdate = (elRect: DOMRect, frameRect: DOMRect) => {
      if (!canvasEl) return;
      const cr = canvasDomRectRef.current ?? frameRect;
      const z  = liveZoomRef?.current ?? zoom;

      if (selectedIds.length !== 1) return;

      const currX = elRect.left - cr.left;
      const currY = elRect.top  - cr.top;
      const currW = elRect.width;
      const currH = elRect.height;

      if (selectionRingRef.current) {
        selectionRingRef.current.style.left   = `${currX}px`;
        selectionRingRef.current.style.top    = `${currY}px`;
        selectionRingRef.current.style.width  = `${currW}px`;
        selectionRingRef.current.style.height = `${currH}px`;
        const tooltipEl = selectionRingRef.current.querySelector<HTMLElement>('[data-dim-tooltip]');
        if (tooltipEl) tooltipEl.textContent = `${Math.round(currW / z)} × ${Math.round(currH / z)}`;
      }

      const isAbs = Array.isArray(pageNodes) && pageNodes.length > 0
        ? isAbsoluteNode(selectedIds[0], pageNodes) : false;
      if (!isAbs) {
        const cx = currX + currW / 2;
        const cy = currY + currH / 2;
        if (imperativeCrosshairHRef.current) {
          imperativeCrosshairHRef.current.style.top     = `${cy}px`;
          imperativeCrosshairHRef.current.style.display = '';
        }
        if (imperativeCrosshairVRef.current) {
          imperativeCrosshairVRef.current.style.left    = `${cx}px`;
          imperativeCrosshairVRef.current.style.display = '';
        }
      }
    };
    useBuilderStore.getState()._setRingUpdateCallback(ringOnlyUpdate);

    return () => {
      if (overlayInstantUpdateRef) overlayInstantUpdateRef.current = null;
      useBuilderStore.getState()._setRingUpdateCallback(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasEl, selectedIds, overlayInstantUpdateRef, zoom, pageNodes]);

  // hoverRect is no longer used for rendering — hover outline is now fully imperative.
  // The RAF tick still drives padding/margin/gap fill updates for the selection ring.

  const selectedRects = useMemo(() => {
    if (!canvasEl) return [] as { id: string; rect: CanvasRect }[];
    return selectedIds
      .map(id => ({ id, rect: getCanvasRect(id, canvasEl) }))
      .filter(r => r.rect !== null) as { id: string; rect: CanvasRect }[];
    // pageNodes included so the rect recomputes on any panel edit (rotation, size, etc.)
    // without waiting for the RAF tick loop to be active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasEl, selectedIds, tick, pageNodes]);

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
  }, [canvasEl, altMode, altHoveredId, tick, pageNodes]);

  // dropLineY is computed in onDragOver and passed in directly — no local memo needed.

  if (!canvasEl) return null;

  return (
    <div data-builder-overlay="1" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>

      {/* Grid overlay */}
      <GridOverlay panX={panX} panY={panY} zoom={zoom} config={gridOverlay} />

      {/* Hover outline — fully imperative (updated via overlayInstantUpdateRef + hoveredId useEffect).
          Always mounted; shown/hidden via style.display so refs are always valid. */}
      <div
        ref={imperativeHoverBorderRef}
        data-testid="hover-outline"
        style={{
          position: 'absolute', display: 'none',
          border: '1px dashed rgba(59,130,246,0.7)',
          pointerEvents: 'none', boxSizing: 'border-box',
        }}
      />
      <div
        ref={imperativeHoverLabelRef}
        style={{
          position: 'absolute', display: 'none',
          background: '#3b82f6', color: '#fff', fontSize: 10, fontFamily: 'system-ui',
          padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
          pointerEvents: 'none', zIndex: 20,
        }}
      />

      {/* Crosshairs — fully imperative (position updated in overlayInstantUpdateRef) */}
      <div
        ref={imperativeCrosshairHRef}
        data-testid="crosshair-h"
        style={{
          position: 'absolute', left: 0, width: '100%', height: 0,
          borderTop: '1px dashed rgba(59,130,246,0.5)', pointerEvents: 'none',
          display: 'none',
        }}
      />
      <div
        ref={imperativeCrosshairVRef}
        data-testid="crosshair-v"
        style={{
          position: 'absolute', top: 0, width: 0, height: '100%',
          borderLeft: '1px dashed rgba(59,130,246,0.5)', pointerEvents: 'none',
          display: 'none',
        }}
      />

      {/* Single selection — hidden while dragging so resize handles don't float over the ghost */}
      {!isDragging && selectedRects.length === 1 && firstSel && (() => {
        const isAbs = Array.isArray(pageNodes) && pageNodes.length > 0
          ? isAbsoluteNode(firstSel.id, pageNodes)
          : false;
        const padding = isAbs ? null : getComputedPadding(firstSel.id, canvasEl);
        const margin  = isAbs ? null : getComputedMargin(firstSel.id, canvasEl);
        return (
          <>
            {/* ringRef enables zero-lag imperative position sync during pan/zoom */}
            <SelectionBox rect={firstSel.rect} nodeId={firstSel.id} onResizeStart={onResizeStart} zoom={zoom} ringRef={selectionRingRef} />

            {/* Gap fills — separate layer, fully recomputed each frame from each child's BCR.
                Children move by different amounts during zoom, so translate alone is wrong. */}
            {!isAbs && (
              <div ref={gapFillsLayerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <GapFills nodeId={firstSel.id} canvasEl={canvasEl} zoom={zoom} canvasRect={canvasDomRect} />
              </div>
            )}

            {/* Padding fills — separate layer, fully recomputed each frame via instant update.
                Both position AND size depend on live zoom, so translate alone is insufficient. */}
            {padding && (
              <div ref={paddingFillsLayerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <PaddingFills rect={firstSel.rect} padding={padding} zoom={zoom} />
              </div>
            )}

            {/* Margin fills (orange) — outside the selection ring, also fully recomputed. */}
            {margin && (
              <div ref={marginFillsLayerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <MarginFills rect={firstSel.rect} margin={margin} zoom={zoom} />
              </div>
            )}
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
              <div style={{ position: 'absolute', left: multiBBox.x + multiBBox.w / 2, top: multiBBox.y + multiBBox.h + 8, transform: 'translateX(-50%)', background: '#3b82f6', color: '#fff', fontSize: 10, fontFamily: 'system-ui', padding: '2px 7px', borderRadius: 3, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 20 }}>
                {Math.round(multiBBox.w / zoom)} × {Math.round(multiBBox.h / zoom)}
              </div>
            </>
          )}
        </>
      )}

      {/* Alt+hover distance lines */}
      {altMode && altRect && firstSel && (
        <DistanceLines selRect={firstSel.rect} tgtRect={altRect} />
      )}

      {/* Insert indicator line — horizontal for columns, vertical for rows */}
      {isDroppingVariant && (dropLineY !== null || dropLineX !== null) && (
        <DropZoneLine
          y={dropLineY}
          x={dropLineX}
          width={canvasEl.clientWidth}
          height={canvasEl.clientHeight}
          active={true}
        />
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

      {/* ── Interaction Lines ── */}
      {showInteractionLines && (
        <InteractionLines pageNodes={pageNodes} canvasEl={canvasEl} canvasDomRect={canvasDomRect} />
      )}
    </div>
  );
}
