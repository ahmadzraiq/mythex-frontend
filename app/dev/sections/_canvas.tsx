'use client';

/**
 * CanvasPreview — Figma-style zoom + pan canvas for section previews.
 *
 * The iframe is a fixed-size "browser window" — content scrolls inside it
 * exactly like a real page. The whole frame can be zoomed and panned on
 * the dark canvas.
 *
 * Controls:
 *   Scroll (two-finger)       → scroll the page inside the frame
 *   Ctrl/Cmd + Scroll / Pinch → zoom canvas in/out towards cursor
 *   Drag (left / three-finger)→ pan the canvas frame
 *   Middle mouse drag         → pan the canvas frame
 *   Ctrl/Cmd + 0              → fit to canvas
 *   Ctrl/Cmd + 1              → 100%
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  src: string | null;
  /** Logical viewport width (1280 / 768 / 375) */
  frameWidth: number;
  /** Logical viewport height matching the device */
  frameHeight: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;
const DRAG_THRESHOLD = 4;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export default function CanvasPreview({ src, frameWidth, frameHeight }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [zoom, setZoom] = useState(0.7);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const dragState = useRef<{
    active: boolean;
    committed: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>({ active: false, committed: false, startX: 0, startY: 0, lastX: 0, lastY: 0 });

  const [isDragging, setIsDragging] = useState(false);

  // ─── Fit frame into visible canvas area ────────────────────────────
  const fitToCanvas = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    const fitZoomW = (cw - 48) / frameWidth;
    const fitZoomH = (ch - 48) / frameHeight;
    const fitZoom = clamp(Math.min(fitZoomW, fitZoomH), MIN_ZOOM, 1);
    setPan({
      x: (cw - frameWidth * fitZoom) / 2,
      y: (ch - frameHeight * fitZoom) / 2,
    });
    setZoom(fitZoom);
  }, [frameWidth, frameHeight]);

  useEffect(() => { fitToCanvas(); }, [frameWidth, frameHeight, fitToCanvas]);

  // ─── Zoom towards cursor ────────────────────────────────────────────
  const zoomAtPoint = useCallback((delta: number, cx: number, cy: number) => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = cx - rect.left;
    const py = cy - rect.top;
    setZoom(prevZoom => {
      const newZoom = clamp(prevZoom * (1 + delta), MIN_ZOOM, MAX_ZOOM);
      const scale = newZoom / prevZoom;
      setPan(prev => ({
        x: px - scale * (px - prev.x),
        y: py - scale * (py - prev.y),
      }));
      return newZoom;
    });
  }, []);

  // ─── Wheel handler ──────────────────────────────────────────────────
  // Ctrl/Cmd + scroll → zoom canvas
  // Plain scroll      → proxy into iframe (real page scroll)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAtPoint(-e.deltaY * 0.006, e.clientX, e.clientY);
      } else {
        // Forward to iframe so the page scrolls naturally
        iframeRef.current?.contentWindow?.scrollBy({
          left: e.deltaX,
          top: e.deltaY,
          behavior: 'instant' as ScrollBehavior,
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAtPoint]);

  // ─── Drag → pan canvas ──────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = {
      active: true, committed: false,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds.active) return;
    const dx = e.clientX - ds.lastX;
    const dy = e.clientY - ds.lastY;
    ds.lastX = e.clientX;
    ds.lastY = e.clientY;
    if (!ds.committed) {
      if (Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY) > DRAG_THRESHOLD) {
        ds.committed = true;
        setIsDragging(true);
      } else return;
    }
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current.active = false;
    dragState.current.committed = false;
    setIsDragging(false);
  }, []);

  // ─── Keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); fitToCanvas(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '1') { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitToCanvas]);

  const zoomPct = Math.round(zoom * 100);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0a0f1a' }}>

      {/* ── Zoom toolbar ── */}
      <div style={{
        height: 36, display: 'flex', alignItems: 'center', gap: 6,
        paddingInline: 12, borderBottom: '1px solid #1e293b',
        flexShrink: 0, background: '#111827',
      }}>
        <button onClick={() => zoomAtPoint(-ZOOM_STEP, 0, 0)} style={btnStyle}>−</button>
        <div
          style={{ width: 52, textAlign: 'center', fontSize: 11, color: '#94a3b8', fontVariantNumeric: 'tabular-nums', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => fitToCanvas()}
          title="Click to fit (Ctrl+0)"
        >
          {zoomPct}%
        </div>
        <button onClick={() => zoomAtPoint(ZOOM_STEP, 0, 0)} style={btnStyle}>+</button>

        <div style={{ width: 1, height: 16, background: '#334155', margin: '0 4px' }} />
        <button onClick={() => fitToCanvas()} style={{ ...btnStyle, fontSize: 9, padding: '3px 7px' }} title="Fit (Ctrl+0)">Fit</button>
        <button onClick={() => setZoom(1)} style={{ ...btnStyle, fontSize: 9, padding: '3px 7px' }} title="100% (Ctrl+1)">1:1</button>

        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 10, color: '#334155' }}>
          Scroll to scroll page · Ctrl+Scroll to zoom · Drag to pan
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={canvasRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Dot-grid background */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundPosition: `${pan.x % 24}px ${pan.y % 24}px`,
        }} />

        {src ? (
          <div style={{
            position: 'absolute', top: 0, left: 0,
            transformOrigin: '0 0',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            willChange: 'transform',
          }}>
            {/* Browser-chrome label */}
            <div style={{
              width: frameWidth,
              height: 32,
              background: '#1e293b',
              borderRadius: '8px 8px 0 0',
              display: 'flex',
              alignItems: 'center',
              paddingInline: 12,
              gap: 6,
            }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', opacity: 0.7 }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', opacity: 0.7 }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', opacity: 0.7 }} />
              <div style={{ flex: 1, height: 18, background: '#0f172a', borderRadius: 4, marginInline: 8 }} />
              <div style={{ fontSize: 10, color: '#475569' }}>{frameWidth} × {frameHeight}</div>
            </div>

            {/* Frame */}
            <div style={{
              width: frameWidth,
              height: frameHeight,
              boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
              borderRadius: '0 0 8px 8px',
              overflow: 'hidden',
              background: '#fff',
            }}>
              <iframe
                ref={iframeRef}
                key={src}
                src={src}
                width={frameWidth}
                height={frameHeight}
                style={{ display: 'block', border: 'none', pointerEvents: 'none' }}
                title="Section preview"
              />
            </div>
          </div>
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div style={{ fontSize: 28, opacity: 0.15 }}>⬡</div>
            <div style={{ fontSize: 12, color: '#334155' }}>Select a variant to preview</div>
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: 26, height: 26,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: '1px solid #334155', borderRadius: 5,
  color: '#94a3b8', fontSize: 14, cursor: 'pointer', padding: 0, lineHeight: 1,
};
