/**
 * Snap Engine — pure utility, no React / no DOM reads.
 *
 * All coordinates are in *content space* (unscaled pixels).
 * Callers convert DOM rects to content space before calling these functions
 * and convert results back to screen space for rendering.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export const SNAP_THRESHOLD = 1; // content-space px

export interface ContentRect {
  id: string;
  x: number; // left edge
  y: number; // top edge
  w: number;
  h: number;
}

/**
 * A single snap guide line to display on the canvas while dragging.
 *
 * axis     = 'x' → vertical line  (guides left/right/centerX alignment)
 * axis     = 'y' → horizontal line (guides top/bottom/centerY alignment)
 * position = where the line is drawn (content px on the guide's axis)
 * start/end = extent of the line along the opposite axis (content px)
 */
export interface SnapGuide {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
  type: 'edge' | 'center' | 'spacing';
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function centerX(r: ContentRect) { return r.x + r.w / 2; }
function centerY(r: ContentRect) { return r.y + r.h / 2; }

/** Extend a guide line so it spans both the dragged rect and the target rect. */
function extentY(a: ContentRect, b: ContentRect): [number, number] {
  return [Math.min(a.y, b.y), Math.max(a.y + a.h, b.y + b.h)];
}
function extentX(a: ContentRect, b: ContentRect): [number, number] {
  return [Math.min(a.x, b.x), Math.max(a.x + a.w, b.x + b.w)];
}

interface AxisCandidate {
  /** Position the dragged edge/center would snap to */
  snapTo: number;
  /** How much to shift the dragged rect's x (or y) origin */
  delta: number;
  type: 'edge' | 'center' | 'spacing';
  /** For rendering the guide line: extent along the perpendicular axis */
  extentA: number;
  extentB: number;
}

// ─── Core snap computation ────────────────────────────────────────────────────

/**
 * Compute X-axis snap candidates for the dragged rect against one sibling.
 * Returns up to 6 candidates (3 dragged edges × 3 sibling edges).
 */
function xCandidates(dragged: ContentRect, other: ContentRect): AxisCandidate[] {
  const [extA, extB] = extentY(dragged, other);
  const candidates: AxisCandidate[] = [];

  const dragEdges = [
    { val: dragged.x,              label: 'left'   as const },
    { val: dragged.x + dragged.w,  label: 'right'  as const },
    { val: centerX(dragged),       label: 'center' as const },
  ];
  const otherEdges = [
    { val: other.x,           type: 'edge'   as const },
    { val: other.x + other.w, type: 'edge'   as const },
    { val: centerX(other),    type: 'center' as const },
  ];

  for (const drag of dragEdges) {
    for (const tgt of otherEdges) {
      const delta =
        drag.label === 'left'   ? tgt.val - dragged.x :
        drag.label === 'right'  ? tgt.val - (dragged.x + dragged.w) :
        /* center */               tgt.val - centerX(dragged);
      candidates.push({
        snapTo: tgt.val,
        delta,
        type: drag.label === 'center' || tgt.type === 'center' ? 'center' : 'edge',
        extentA: extA,
        extentB: extB,
      });
    }
  }
  return candidates;
}

/**
 * Compute Y-axis snap candidates for the dragged rect against one sibling.
 */
function yCandidates(dragged: ContentRect, other: ContentRect): AxisCandidate[] {
  const [extA, extB] = extentX(dragged, other);
  const candidates: AxisCandidate[] = [];

  const dragEdges = [
    { val: dragged.y,              label: 'top'    as const },
    { val: dragged.y + dragged.h,  label: 'bottom' as const },
    { val: centerY(dragged),       label: 'center' as const },
  ];
  const otherEdges = [
    { val: other.y,           type: 'edge'   as const },
    { val: other.y + other.h, type: 'edge'   as const },
    { val: centerY(other),    type: 'center' as const },
  ];

  for (const drag of dragEdges) {
    for (const tgt of otherEdges) {
      const delta =
        drag.label === 'top'    ? tgt.val - dragged.y :
        drag.label === 'bottom' ? tgt.val - (dragged.y + dragged.h) :
        /* center */               tgt.val - centerY(dragged);
      candidates.push({
        snapTo: tgt.val,
        delta,
        type: drag.label === 'center' || tgt.type === 'center' ? 'center' : 'edge',
        extentA: extA,
        extentB: extB,
      });
    }
  }
  return candidates;
}

/**
 * Equal-spacing X candidates: if `left` and `right` are siblings on opposite
 * sides of the dragged rect, snap dragged so the gap on each side is equal.
 *
 *   [left] gap [dragged] gap [right]
 *   snapX = left.right + (right.left - left.right - dragged.w) / 2
 */
function equalSpacingX(
  dragged: ContentRect,
  siblings: ContentRect[],
  threshold: number
): AxisCandidate[] {
  const results: AxisCandidate[] = [];
  const lefts  = siblings.filter(s => s.x + s.w <= dragged.x + threshold * 2);
  const rights = siblings.filter(s => s.x       >= dragged.x + dragged.w - threshold * 2);

  for (const L of lefts) {
    for (const R of rights) {
      const totalGap = R.x - (L.x + L.w) - dragged.w;
      if (totalGap < 0) continue;
      const gap = totalGap / 2;
      const snapX = L.x + L.w + gap;
      const delta = snapX - dragged.x;
      if (Math.abs(delta) > threshold * 4) continue;
      const extA = Math.min(L.y, dragged.y, R.y);
      const extB = Math.max(L.y + L.h, dragged.y + dragged.h, R.y + R.h);
      results.push({ snapTo: snapX, delta, type: 'spacing', extentA: extA, extentB: extB });
    }
  }
  return results;
}

function equalSpacingY(
  dragged: ContentRect,
  siblings: ContentRect[],
  threshold: number
): AxisCandidate[] {
  const results: AxisCandidate[] = [];
  const tops    = siblings.filter(s => s.y + s.h <= dragged.y + threshold * 2);
  const bottoms = siblings.filter(s => s.y       >= dragged.y + dragged.h - threshold * 2);

  for (const T of tops) {
    for (const B of bottoms) {
      const totalGap = B.y - (T.y + T.h) - dragged.h;
      if (totalGap < 0) continue;
      const gap = totalGap / 2;
      const snapY = T.y + T.h + gap;
      const delta = snapY - dragged.y;
      if (Math.abs(delta) > threshold * 4) continue;
      const extA = Math.min(T.x, dragged.x, B.x);
      const extB = Math.max(T.x + T.w, dragged.x + dragged.w, B.x + B.w);
      results.push({ snapTo: snapY, delta, type: 'spacing', extentA: extA, extentB: extB });
    }
  }
  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Given the dragged node's provisional position and all sibling rects in the
 * same container (content space), return:
 *   - the snapped (x, y) position
 *   - guide lines to render
 */
export function computeSnap(
  dragged: ContentRect,
  siblings: ContentRect[],
  threshold = SNAP_THRESHOLD,
): SnapResult {
  // ── Collect all axis candidates ──────────────────────────────────────────
  const xCands: AxisCandidate[] = [];
  const yCands: AxisCandidate[] = [];

  for (const s of siblings) {
    xCands.push(...xCandidates(dragged, s));
    yCands.push(...yCandidates(dragged, s));
  }
  xCands.push(...equalSpacingX(dragged, siblings, threshold));
  yCands.push(...equalSpacingY(dragged, siblings, threshold));

  // ── Pick the best candidate on each axis (closest delta within threshold) ─
  type Best = AxisCandidate & { absDelta: number };
  function bestIn(cands: AxisCandidate[]): Best | null {
    let best: Best | null = null;
    for (const c of cands) {
      const ad = Math.abs(c.delta);
      if (ad <= threshold && (best === null || ad < best.absDelta)) {
        best = { ...c, absDelta: ad };
      }
    }
    return best;
  }

  const bestX = bestIn(xCands);
  const bestY = bestIn(yCands);

  const snappedX = dragged.x + (bestX?.delta ?? 0);
  const snappedY = dragged.y + (bestY?.delta ?? 0);
  const guides: SnapGuide[] = [];

  // Use the snapped dragged rect for guide extents
  const snappedDragged: ContentRect = { ...dragged, x: snappedX, y: snappedY };

  if (bestX) {
    const [extA, extB] = extentY(snappedDragged, { id: '', x: bestX.snapTo, y: bestX.extentA, w: 0, h: bestX.extentB - bestX.extentA });
    guides.push({ axis: 'x', position: bestX.snapTo, start: extA, end: extB, type: bestX.type });
  }
  if (bestY) {
    const [extA, extB] = extentX(snappedDragged, { id: '', x: bestY.extentA, y: bestY.snapTo, w: bestY.extentB - bestY.extentA, h: 0 });
    guides.push({ axis: 'y', position: bestY.snapTo, start: extA, end: extB, type: bestY.type });
  }

  return { x: snappedX, y: snappedY, guides };
}

/**
 * Snap resize dimensions to match a sibling's width / height.
 * Returns adjusted newW / newH (or unchanged if no snap within threshold).
 * Also returns guides to show during resize.
 */
export function snapResizeSize(
  newW: number,
  newH: number,
  handle: string,
  siblings: ContentRect[],
  threshold = SNAP_THRESHOLD,
): { w: number; h: number; guides: SnapGuide[] } {
  const guides: SnapGuide[] = [];
  let snappedW = newW;
  let snappedH = newH;

  const resizesW = handle.includes('e') || handle.includes('w');
  const resizesH = handle.includes('s') || handle.includes('n');

  if (resizesW) {
    let bestDelta = Infinity;
    let bestW = newW;
    for (const s of siblings) {
      const d = Math.abs(s.w - newW);
      if (d < bestDelta && d <= threshold) {
        bestDelta = d;
        bestW = s.w;
      }
    }
    if (bestW !== newW) {
      snappedW = bestW;
      guides.push({ axis: 'x', position: 0, start: 0, end: 0, type: 'edge' });
    }
  }

  if (resizesH) {
    let bestDelta = Infinity;
    let bestH = newH;
    for (const s of siblings) {
      const d = Math.abs(s.h - newH);
      if (d < bestDelta && d <= threshold) {
        bestDelta = d;
        bestH = s.h;
      }
    }
    if (bestH !== newH) {
      snappedH = bestH;
      guides.push({ axis: 'y', position: 0, start: 0, end: 0, type: 'edge' });
    }
  }

  return { w: snappedW, h: snappedH, guides };
}
