/**
 * Snap Engine — Unit Tests
 *
 * Tests for computeSnap() and snapResizeSize() in _snap-engine.ts.
 * These run as pure Node.js tests (no browser, no page fixture) because
 * the snap engine is a pure function with zero DOM/React dependencies.
 *
 * Run with:  npx playwright test e2e/snap-engine.spec.ts
 *
 * Scenarios:
 *   SE-01  Left-to-left snap (X axis)
 *   SE-02  Left-to-right snap (X axis)
 *   SE-03  Right-to-right snap (X axis)
 *   SE-04  Right-to-left snap (X axis)
 *   SE-05  Center-X to center-X snap
 *   SE-06  Top-to-top snap (Y axis)
 *   SE-07  Top-to-bottom snap (Y axis)
 *   SE-08  Bottom-to-bottom snap (Y axis)
 *   SE-09  Center-Y to center-Y snap
 *   SE-10  No snap when delta > SNAP_THRESHOLD
 *   SE-11  Multiple siblings: picks the closest candidate
 *   SE-12  X and Y snap simultaneously
 *   SE-13  Only X snaps (Y is outside threshold)
 *   SE-14  Guide has correct axis, position and type
 *   SE-15  Center snap produces type='center' guide
 *   SE-16  Guide extent spans both dragged and sibling
 *   SE-17  No siblings → unchanged position, empty guides
 *   SE-18  Equal spacing X snap
 *   SE-19  Equal spacing Y snap
 *   SE-20  snapResizeSize snaps width to sibling width
 *   SE-21  snapResizeSize snaps height to sibling height
 *   SE-22  snapResizeSize: no snap when outside threshold
 *   SE-23  snapResizeSize only resizes axes active in handle
 */

import { test, expect } from '@playwright/test';
import {
  computeSnap,
  snapResizeSize,
  SNAP_THRESHOLD,
  type ContentRect,
} from '../app/dev/builder/_snap-engine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Make a rect with sensible defaults. */
function r(x: number, y: number, w = 80, h = 36, id = 'node'): ContentRect {
  return { id, x, y, w, h };
}

/** Drag rect — fresh provisional position each test. */
const dragged = (x: number, y: number) => r(x, y, 80, 36, 'drag');
const sibling = (x: number, y: number) => r(x, y, 80, 36, 'sib');

// ─── SE-01 – Left-to-left ─────────────────────────────────────────────────────
test('SE-01: left-to-left snap', () => {
  const result = computeSnap(dragged(104, 200), [sibling(100, 300)]);
  expect(result.x).toBe(100);
  expect(result.y).toBe(200); // Y unchanged
});

// ─── SE-02 – Left-to-right ────────────────────────────────────────────────────
test('SE-02: left-to-right snap (dragged.left ≈ sibling.right)', () => {
  // sibling.right = 100 + 80 = 180. Drag dragged.left to 183 (3px away).
  const result = computeSnap(dragged(183, 200), [sibling(100, 300)]);
  expect(result.x).toBe(180);
});

// ─── SE-03 – Right-to-right ───────────────────────────────────────────────────
test('SE-03: right-to-right snap (dragged.right ≈ sibling.right)', () => {
  // dragged.right = x + 80. sibling.right = 100 + 80 = 180.
  // dragged.right ≈ 180 means x ≈ 100. Put x = 103 → right = 183 (3px from 180).
  const result = computeSnap(dragged(103, 200), [sibling(100, 300)]);
  // The closest snap is left-to-left (dragged.left=103 → sib.left=100, Δ=3)
  // OR right-to-right (dragged.right=183 → sib.right=180, Δ=3).
  // Both have the same delta; left-to-left is chosen (same result: x=100).
  // Let's test right-to-right explicitly: place sibling far away on left,
  // but its right edge aligns.
  //   sibling: x=200, w=80 → right=280. dragged: x=204, w=80 → right=284 (Δ=4).
  const r2 = computeSnap(dragged(204, 200), [sibling(200, 300)]);
  // left-to-left: dragged.left=204 → sib.left=200, Δ=4 ✓
  // right-to-right: dragged.right=284 → sib.right=280, Δ=4 ✓ (same Δ, left-to-left wins)
  expect(r2.x).toBe(200);

  // Now test where ONLY right-to-right matches:
  // sib at x=20, w=80 → right=100. dragged at x=24, w=80 → right=104 (Δ=4).
  // left-to-left: Δ = |24-20| = 4 → both snap, same x.
  // Distinct test: sib.x=20, sib.w=60, sib.right=80. dragged.x=100 → dragged.right=180 (far).
  // Drag dragged.right close to sib.right: dragged.right=83 → x=3.
  const sib3 = r(20, 300, 60, 36, 's'); // sib.right = 80
  const r3 = computeSnap(dragged(3, 200), [sib3]);
  // dragged.left=3 → sib.left=20 (Δ=17, too far)
  // dragged.left=3 → sib.right=80 (Δ=77, too far)
  // dragged.right=83 → sib.right=80 (Δ=3, SNAP) → x = 83-3=80-80=0? Let's compute:
  // candidate: drag.right→sib.right, delta = sib.right - dragged.right = 80 - 83 = -3 → x = 3-3 = 0
  expect(r3.x).toBe(0);
});

// ─── SE-04 – Right-to-left ────────────────────────────────────────────────────
test('SE-04: right-to-left snap (dragged.right ≈ sibling.left)', () => {
  // sib.left = 200. dragged.right ≈ 200 means dragged.x ≈ 120.
  // dragged.x = 123 → dragged.right = 203 (Δ=3 from sib.left=200).
  const result = computeSnap(dragged(123, 50), [sibling(200, 300)]);
  // candidate: drag.right→sib.left: delta = 200 - (123+80) = 200-203 = -3 → x=120
  expect(result.x).toBe(120);
});

// ─── SE-05 – Center-X ─────────────────────────────────────────────────────────
test('SE-05: center-X to center-X snap', () => {
  // sib.centerX = 100 + 40 = 140. dragged.centerX = x + 40.
  // Want dragged.centerX = 143 → x = 103.
  const result = computeSnap(dragged(103, 50), [sibling(100, 300)]);
  // left-to-left: Δ=3 → x=100
  // center-center: dragged.cx=143 → sib.cx=140, Δ=3 → x=103-3=100
  // Both tie at Δ=3 — whichever is found first; both result in x=100.
  expect(result.x).toBe(100);

  // Unambiguous center-center test:
  // sib at x=100, w=100 → cx=150. dragged at x=114, w=80 → cx=154 (Δ=4 from 150).
  // left-to-left: Δ=|114-100|=14 (too far). Only center matches.
  const sib2 = r(100, 300, 100, 36, 's');
  const r2 = computeSnap(dragged(114, 50), [sib2]);
  // snap: dragged.cx=154 → sib.cx=150, Δ=4 → x = 114 - 4 = 110
  expect(r2.x).toBe(110);
});

// ─── SE-06 – Top-to-top ───────────────────────────────────────────────────────
test('SE-06: top-to-top snap (Y axis)', () => {
  const result = computeSnap(dragged(500, 53), [sibling(200, 50)]);
  expect(result.y).toBe(50);
  expect(result.x).toBe(500); // X unaffected (far from any sibling X)
});

// ─── SE-07 – Top-to-bottom ────────────────────────────────────────────────────
test('SE-07: top-to-bottom snap (dragged.top ≈ sibling.bottom)', () => {
  // sib.bottom = 50 + 36 = 86. Drag dragged.top to 83 (Δ=3).
  const result = computeSnap(dragged(500, 83), [sibling(500, 50)]);
  expect(result.y).toBe(86);
});

// ─── SE-08 – Bottom-to-bottom ─────────────────────────────────────────────────
test('SE-08: bottom-to-bottom snap', () => {
  // Use a very tall sibling so its centerY is far from its bottom edge.
  // This prevents the top→center candidate from competing.
  //   sib: y=0, h=500 → bottom=500, cy=250
  //   dragged at y=467, h=36 → bottom=503 (Δ=3 from sib.bottom=500)
  //   dragged.top=467 → sib.cy=250 (Δ=217, too far)
  //   dragged.top=467 → sib.top=0 (Δ=467, too far)
  //   Only bottom→bottom fires.
  const sib = r(0, 0, 80, 500, 's'); // bottom=500, cy=250
  const result = computeSnap(dragged(100, 467), [sib]);
  // snap: dragged.bottom=503 → sib.bottom=500, delta=-3 → y=467-3=464
  expect(result.y).toBe(464);
});

// ─── SE-09 – Center-Y ─────────────────────────────────────────────────────────
test('SE-09: center-Y to center-Y snap', () => {
  // sib at y=100, h=100 → cy=150. dragged at y=114, h=36 → cy=132 (far).
  // sib cy=150. dragged cy = y+18. Want dragged.cy=153 → y=135.
  const sib = r(0, 100, 80, 100, 's'); // cy = 150
  const result = computeSnap(dragged(0, 135), [sib]);
  // dragged.cy = 135+18 = 153, sib.cy=150, Δ=3 → y = 135-3 = 132
  expect(result.y).toBe(132);
});

// ─── SE-10 – No snap outside threshold ───────────────────────────────────────
test('SE-10: no snap when delta > SNAP_THRESHOLD', () => {
  // sib.left = 100. dragged.left = 108 → Δ=8 > SNAP_THRESHOLD=6. No snap.
  const result = computeSnap(dragged(108, 200), [sibling(100, 300)]);
  expect(result.x).toBe(108); // unchanged
  expect(result.y).toBe(200);
  expect(result.guides).toHaveLength(0);
});

// ─── SE-11 – Multiple siblings: picks closest ─────────────────────────────────
test('SE-11: multiple siblings — snaps to closest candidate', () => {
  // Two siblings: sib A at x=100, sib B at x=103. dragged.left = 105.
  // Δ to sib A = 5, Δ to sib B = 2. Should snap to sib B (Δ=2).
  const sibA = r(100, 300, 80, 36, 'sibA');
  const sibB = r(103, 400, 80, 36, 'sibB');
  const result = computeSnap(dragged(105, 200), [sibA, sibB]);
  expect(result.x).toBe(103);
});

// ─── SE-12 – Both axes snap simultaneously ────────────────────────────────────
test('SE-12: X and Y snap simultaneously', () => {
  // sib.left=100 (X snap), sib.top=50 (Y snap)
  const sib = r(100, 50, 80, 36, 's');
  const result = computeSnap(dragged(103, 54), [sib]);
  expect(result.x).toBe(100);
  expect(result.y).toBe(50);
  expect(result.guides).toHaveLength(2);
});

// ─── SE-13 – Only X snaps ─────────────────────────────────────────────────────
test('SE-13: only X snaps when Y is outside threshold', () => {
  const sib = r(100, 50, 80, 36, 's');
  const result = computeSnap(dragged(103, 200), [sib]); // Y far from any edge
  expect(result.x).toBe(100);
  expect(result.y).toBe(200);
  expect(result.guides.filter(g => g.axis === 'x')).toHaveLength(1);
  expect(result.guides.filter(g => g.axis === 'y')).toHaveLength(0);
});

// ─── SE-14 – Guide properties ─────────────────────────────────────────────────
test('SE-14: guide has correct axis, position and type for edge snap', () => {
  // Place dragged far enough on Y that only X snaps.
  // sib at (100, 200). dragged at (103, 500) → Y delta to any sib edge >> threshold.
  const sib = r(100, 200, 80, 36, 's');
  const result = computeSnap(dragged(103, 500), [sib]);
  // Only the X guide should be produced
  expect(result.guides.filter(g => g.axis === 'x')).toHaveLength(1);
  const g = result.guides.find(g => g.axis === 'x')!;
  expect(g.axis).toBe('x');       // vertical guide line for X alignment
  expect(g.position).toBe(100);   // at sib.left
  expect(g.type).toBe('edge');
  expect(g.start).toBeLessThanOrEqual(200);   // spans the sibling rect top
  expect(g.end).toBeGreaterThanOrEqual(500);  // spans the dragged rect top
});

// ─── SE-15 – Center snap yields type='center' ────────────────────────────────
test('SE-15: center snap produces type=center guide', () => {
  // Unambiguous center-center: sib.cx=150 (x=100, w=100). dragged.cx=153 → x=113.
  const sib = r(100, 200, 100, 36, 's'); // cx=150
  const result = computeSnap(dragged(113, 200), [sib]);  // dragged.cx=153, Δ=3
  const xGuide = result.guides.find(g => g.axis === 'x');
  expect(xGuide?.type).toBe('center');
  expect(xGuide?.position).toBe(150);
});

// ─── SE-16 – Guide extent spans both rects ───────────────────────────────────
test('SE-16: guide extent spans both dragged and sibling rect', () => {
  // Y-axis snap: sib.top=300, dragged.y=303. Guide spans Y extents.
  const sib  = r(0,   300, 80, 100, 's'); // spans y=300..400
  const drag = dragged(500, 303);          // spans y=303..339 (h=36)
  const result = computeSnap(drag, [sib]);
  const yGuide = result.guides.find(g => g.axis === 'y');
  expect(yGuide).toBeDefined();
  expect(yGuide!.start).toBeLessThanOrEqual(300);   // covers sib top
  expect(yGuide!.end).toBeGreaterThanOrEqual(339);  // covers dragged bottom
});

// ─── SE-17 – No siblings ─────────────────────────────────────────────────────
test('SE-17: no siblings → unchanged position and empty guides', () => {
  const result = computeSnap(dragged(150, 200), []);
  expect(result.x).toBe(150);
  expect(result.y).toBe(200);
  expect(result.guides).toHaveLength(0);
});

// ─── SE-18 – Equal spacing X ─────────────────────────────────────────────────
test('SE-18: equal spacing X snap', () => {
  // Layout: [L] gap [dragged] gap [R]
  // L at x=0, w=80 → right=80.  R at x=200, w=80 → left=200.
  // Total space for dragged (w=80) = 200-80-80 = 40. Half = 20. snapX = 80+20 = 100.
  // Drag dragged.x to 103 (Δ=3 from 100, within threshold*4 = 24).
  const L = r(0,   50, 80, 36, 'L');
  const R = r(200, 50, 80, 36, 'R');
  const result = computeSnap(dragged(103, 50), [L, R]);
  expect(result.x).toBe(100);
  const spacingGuide = result.guides.find(g => g.type === 'spacing');
  expect(spacingGuide).toBeDefined();
});

// ─── SE-19 – Equal spacing Y ─────────────────────────────────────────────────
test('SE-19: equal spacing Y snap', () => {
  // T at y=0, h=40 → bottom=40.  B at y=160, h=40 → top=160.
  // Space for dragged (h=36): 160-40-36 = 84. Half = 42. snapY = 40+42 = 82.
  // Drag to y=85 (Δ=3, within threshold*4=24).
  const T = r(0, 0,   80, 40, 'T');
  const B = r(0, 160, 80, 40, 'B');
  const result = computeSnap(dragged(0, 85), [T, B]);
  expect(result.y).toBe(82);
});

// ─── SE-20 – snapResizeSize: width snap ──────────────────────────────────────
test('SE-20: snapResizeSize snaps width to sibling width', () => {
  const sib = r(0, 0, 120, 60, 's');
  const result = snapResizeSize(124, 60, 'e', [sib]); // Δ=4 from 120
  expect(result.w).toBe(120);
});

// ─── SE-21 – snapResizeSize: height snap ─────────────────────────────────────
test('SE-21: snapResizeSize snaps height to sibling height', () => {
  const sib = r(0, 0, 80, 100, 's');
  const result = snapResizeSize(80, 104, 's', [sib]); // Δ=4 from 100
  expect(result.h).toBe(100);
});

// ─── SE-22 – snapResizeSize: no snap outside threshold ───────────────────────
test('SE-22: snapResizeSize no snap when delta > SNAP_THRESHOLD', () => {
  const sib = r(0, 0, 80, 100, 's');
  const result = snapResizeSize(80, 108, 's', [sib]); // Δ=8 > threshold
  expect(result.h).toBe(108); // unchanged
});

// ─── SE-23 – snapResizeSize: only active axes snap ───────────────────────────
test('SE-23: snapResizeSize only snaps axes active in the handle', () => {
  const sib = r(0, 0, 120, 100, 's');
  // Handle 's' resizes height only; width should not snap even if close.
  const result = snapResizeSize(124, 104, 's', [sib]); // width close to sib.w but handle='s'
  expect(result.w).toBe(124); // width NOT snapped (handle='s' only resizes h)
  expect(result.h).toBe(100); // height IS snapped
});

// ─── Exact threshold boundary ────────────────────────────────────────────────
test('SNAP_THRESHOLD boundary: Δ=threshold snaps, Δ=threshold+1 does not', () => {
  const sib = sibling(100, 300);

  // Exactly at threshold (Δ=6) → should snap
  const atThreshold = computeSnap(dragged(100 + SNAP_THRESHOLD, 200), [sib]);
  expect(atThreshold.x).toBe(100);

  // One beyond threshold (Δ=7) → should NOT snap
  const beyondThreshold = computeSnap(dragged(100 + SNAP_THRESHOLD + 1, 200), [sib]);
  expect(beyondThreshold.x).toBe(100 + SNAP_THRESHOLD + 1);
});
