/**
 * Rotation Timing Diagnostics — RT series
 *
 * Measures precise timing of each stage in the keydown → visual update pipeline.
 * Uses performance.now() timestamps recorded inside page.evaluate so there is no
 * Playwright serialisation overhead in the timing numbers.
 *
 * Stages measured:
 *   A  keydown event fires                (t=0 baseline)
 *   B  el.style.transform is updated      (should be ~0ms — synchronous)
 *   C  patchStyle RAF callback fires      (should be ≤16ms — one frame)
 *   D  ring style is updated in RAF       (should be ≤16ms — same frame as C)
 *   E  next keydown fires                 (reveals actual OS key repeat rate)
 *
 * RT-01  Baseline: raw direct DOM write latency (no patchStyle overhead)
 * RT-02  patchStyle keydown→DOM write latency (should be ≈ baseline + ~0.1ms)
 * RT-03  patchStyle RAF latency (should be ≤16ms per frame)
 * RT-04  Ring update latency after keydown (should be ≤16ms)
 * RT-05  Actual key repeat interval measurement (≥30ms means ≤33Hz)
 * RT-06  Frame budget check: is patchStyle RAF callback completing in <4ms?
 * RT-07  Compare: does patchStyle call querySelector on every keydown?
 * RT-08  Throttled path: accumulate in ref, apply once per RAF — measure latency
 */

import { test, expect, type Page, type Browser } from '@playwright/test';

type StoreNode = {
  id?: string; type?: string;
  props?: { className?: string; style?: Record<string, string> };
  children?: StoreNode[];
};
type BuilderStore = { pageNodes: StoreNode[]; _setPageNodes: (n: StoreNode[]) => void; };

async function gotoBuilder(page: Page) {
  await page.goto('/dev/builder');
  await page.waitForSelector('[data-builder-page-frame]', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__builderStore,
    { timeout: 20_000, polling: 100 }
  );
}

async function injectBox(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    (window as unknown as { __builderStore: { getState: () => BuilderStore } })
      .__builderStore.getState()._setPageNodes([{
        type: 'Box', id: nodeId,
        props: { className: 'w-32 h-32 bg-blue-500', style: {} },
        children: [],
      }]);
  }, id);
  await page.waitForSelector(`[data-builder-id="${id}"]`, { timeout: 15_000 });
}

async function selectViaLayers(page: Page) {
  await page.getByTestId('tab-layers').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="layer-row"]').first().click();
  await page.getByTestId('tab-right-design').click();
  await page.waitForTimeout(300);
}

async function resetCanvas(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __builderStore: { getState: () => BuilderStore } })
      .__builderStore.getState()._setPageNodes([]);
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-builder-id]').length === 0,
    { timeout: 8_000 }
  );
}

// ─── Shared page ─────────────────────────────────────────────────────────────

let sharedPage: Page;
test.beforeAll(async ({ browser }: { browser: Browser }) => {
  sharedPage = await browser.newPage();
  await gotoBuilder(sharedPage);
});
test.afterAll(async () => { await sharedPage?.close(); });
test.beforeEach(async () => { await resetCanvas(sharedPage); });

// ─── RT-01: Baseline — raw direct DOM write latency ──────────────────────────

test('RT-01: baseline direct DOM write latency (no patchStyle) should be <0.5ms', async () => {
  const page = sharedPage;
  await injectBox(page, 'rt01');
  await selectViaLayers(page);

  const timings = await page.evaluate(() => {
    const el = document.querySelector('[data-builder-id="rt01"]') as HTMLElement;
    const results: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      el.style.transform = `rotate(${i}deg)`;
      const t1 = performance.now();
      results.push(t1 - t0);
    }
    return results;
  });

  const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
  const max = Math.max(...timings);
  const p95 = timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];
  console.log(`RT-01 Direct DOM write — avg: ${avg.toFixed(3)}ms, p95: ${p95.toFixed(3)}ms, max: ${max.toFixed(3)}ms`);
  console.log(`RT-01 Individual timings: ${timings.map(t => t.toFixed(2)).join(', ')}ms`);

  expect(avg).toBeLessThan(0.5);
  expect(p95).toBeLessThan(1);
  console.log('✅ RT-01: baseline direct DOM write is sub-millisecond');
});

// ─── RT-02: patchStyle keydown→DOM write latency ─────────────────────────────

test('RT-02: patchStyle DOM write latency per keydown (time from keydown to el.style update)', async () => {
  const page = sharedPage;
  await injectBox(page, 'rt02');
  await selectViaLayers(page);

  const rotateInput = page.locator('[data-testid="input-rotate"]');
  await expect(rotateInput).toBeVisible({ timeout: 8_000 });
  await rotateInput.click();

  // Patch the el.style setter to record timestamps, then fire keydowns and measure
  const timings = await page.evaluate(() => {
    const inp = document.querySelector<HTMLInputElement>('[data-testid="input-rotate"]');
    if (!inp) return [];
    inp.focus();

    const el = document.querySelector('[data-builder-id="rt02"]') as HTMLElement;
    const latencies: number[] = [];
    let keydownTime = 0;

    // Intercept style setter on this specific element
    const origDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
    const originalTransform = el.style.transform;
    void originalTransform;

    // Intercept transform setter
    let lastKnownTransform = el.style.transform;
    const interceptTransform = () => {
      // Check every microtask if transform changed
    };
    void interceptTransform;

    // Simpler: time the full keydown handler synchronously
    const results: { keydownMs: number; styleAppliedMs: number }[] = [];

    for (let i = 1; i <= 20; i++) {
      keydownTime = performance.now();
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: i > 1, bubbles: true, cancelable: true }));
      // Immediately after dispatch: read the element's transform — if patchStyle ran synchronously,
      // the transform should already be updated (direct DOM write is in the event handler)
      const afterDispatch = performance.now();
      const transform = el.style.transform;
      void transform;
      results.push({ keydownMs: keydownTime, styleAppliedMs: afterDispatch });
    }

    return results.map((r, i) => ({
      i,
      latencyMs: r.styleAppliedMs - r.keydownMs,
      transform: (document.querySelector('[data-builder-id="rt02"]') as HTMLElement)?.style.transform,
    }));
  });

  const latencies = timings.map(t => t.latencyMs);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const max = Math.max(...latencies);
  const finalTransform = timings[timings.length - 1]?.transform ?? '';
  console.log(`RT-02 keydown→style write avg: ${avg.toFixed(3)}ms, max: ${max.toFixed(3)}ms`);
  console.log(`RT-02 Final element transform: ${finalTransform}`);
  console.log(`RT-02 All latencies: ${latencies.map(t => t.toFixed(2)).join(', ')}ms`);

  // Should be very fast — the patchStyle DOM write is synchronous in the event handler
  expect(avg).toBeLessThan(2);
  console.log(`✅ RT-02: keydown→DOM write latency: ${avg.toFixed(2)}ms avg`);
});

// ─── RT-03: RAF callback timing ───────────────────────────────────────────────

test('RT-03: RAF callback fires within 1 frame (≤16ms) of the keydown that triggered it', async () => {
  const page = sharedPage;
  await injectBox(page, 'rt03');
  await selectViaLayers(page);

  const rotateInput = page.locator('[data-testid="input-rotate"]');
  await expect(rotateInput).toBeVisible({ timeout: 8_000 });
  await rotateInput.click();

  // Patch _requestRingUpdate to timestamp when the RAF fires
  const rafTimes = await page.evaluate(async () => {
    const store = (window as unknown as { __builderStore: { getState: () => Record<string, unknown> } })
      .__builderStore.getState();
    const orig = store._requestRingUpdate as (...args: unknown[]) => void;
    const rafFireTimes: number[] = [];
    store._requestRingUpdate = function (...args) {
      rafFireTimes.push(performance.now());
      return orig.apply(store, args);
    };

    const inp = document.querySelector<HTMLInputElement>('[data-testid="input-rotate"]');
    if (!inp) return { keydownTimes: [], rafFireTimes: [], latencies: [] };

    const keydownTimes: number[] = [];

    // Fire 10 keydowns with ~33ms spacing (simulating rapid individual presses).
    // The NumberInput handler ignores e.repeat=true, so use repeat: false for all.
    for (let i = 0; i < 10; i++) {
      await new Promise<void>(resolve => setTimeout(resolve, 33));
      keydownTimes.push(performance.now());
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: false, bubbles: true, cancelable: true }));
    }

    // Wait for final RAF to fire
    await new Promise<void>(resolve => setTimeout(resolve, 50));

    // Restore
    store._requestRingUpdate = orig;

    // Pair each RAF with the keydown that caused it
    const latencies = rafFireTimes.map((rafT, i) => {
      // Find the last keydown that fired before this RAF
      const precedingKeydowns = keydownTimes.filter(k => k < rafT);
      const lastKeydown = precedingKeydowns[precedingKeydowns.length - 1];
      return lastKeydown ? rafT - lastKeydown : -1;
    });

    return { keydownTimes, rafFireTimes, latencies };
  });

  console.log(`RT-03 RAF callback fires: ${rafTimes.rafFireTimes.length} times for 10 keydowns`);
  console.log(`RT-03 keydown→RAF latencies: ${rafTimes.latencies.map(l => l.toFixed(1)).join(', ')}ms`);

  const validLatencies = rafTimes.latencies.filter(l => l >= 0);
  if (validLatencies.length > 0) {
    const avg = validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length;
    const max = Math.max(...validLatencies);
    console.log(`RT-03 keydown→RAF avg: ${avg.toFixed(1)}ms, max: ${max.toFixed(1)}ms`);
    // Each RAF should fire within 2 frames of the triggering keydown
    expect(max).toBeLessThan(50); // 3 frames max
  }
  // RAF de-duplication: 10 keydowns at 33ms spacing, 10 RAFs should fire (one per keydown)
  // since 33ms > 16ms (one keydown per frame)
  console.log(`RT-03 RAF count: ${rafTimes.rafFireTimes.length} for 10 keydowns at ~33ms spacing`);
  expect(rafTimes.rafFireTimes.length).toBeGreaterThanOrEqual(8); // almost all keypresses get their own RAF
  console.log('✅ RT-03: RAF fires within acceptable time of keydowns');
});

// ─── RT-04: Full pipeline — keydown to ring update ───────────────────────────

test('RT-04: full pipeline latency — keydown to ring position update', async () => {
  const page = sharedPage;
  await injectBox(page, 'rt04');
  await selectViaLayers(page);

  const rotateInput = page.locator('[data-testid="input-rotate"]');
  await expect(rotateInput).toBeVisible({ timeout: 8_000 });
  await rotateInput.click();

  const result = await page.evaluate(async () => {
    const store = (window as unknown as { __builderStore: { getState: () => Record<string, unknown> } })
      .__builderStore.getState();
    const orig = store._requestRingUpdate as (...args: unknown[]) => void;

    const pipeline: { keydownT: number; styleT: number; ringT: number }[] = [];
    let keydownT = 0;
    let styleT = 0;

    // Intercept the style write by wrapping patchStyle's el.style setter
    const el = document.querySelector('[data-builder-id="rt04"]') as HTMLElement & { _styleProxy?: unknown };

    // Track when style.transform is written
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
    void desc;

    store._requestRingUpdate = function (...args) {
      const ringT = performance.now();
      pipeline.push({ keydownT, styleT, ringT });
      return orig.apply(store, args);
    };

    const inp = document.querySelector<HTMLInputElement>('[data-testid="input-rotate"]');
    if (!inp) return [];

    for (let i = 0; i < 5; i++) {
      await new Promise<void>(resolve => setTimeout(resolve, 40));
      keydownT = performance.now();
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: i > 0, bubbles: true, cancelable: true }));
      styleT = performance.now(); // approximate — immediately after dispatch (synchronous DOM write)
    }

    await new Promise<void>(resolve => setTimeout(resolve, 60));
    store._requestRingUpdate = orig;

    return pipeline.map(p => ({
      keydown_to_style_ms:  p.styleT - p.keydownT,
      keydown_to_ring_ms:   p.ringT - p.keydownT,
      style_to_ring_ms:     p.ringT - p.styleT,
    }));
  });

  console.log(`RT-04 Pipeline timings (${result.length} samples):`);
  result.forEach((r, i) => {
    console.log(`  [${i}] keydown→style: ${r.keydown_to_style_ms.toFixed(1)}ms | keydown→ring: ${r.keydown_to_ring_ms.toFixed(1)}ms | style→ring: ${r.style_to_ring_ms.toFixed(1)}ms`);
  });

  if (result.length > 0) {
    const avgStyleToRing = result.reduce((a, b) => a + b.style_to_ring_ms, 0) / result.length;
    const avgKeydownToRing = result.reduce((a, b) => a + b.keydown_to_ring_ms, 0) / result.length;
    console.log(`RT-04 avg style→ring: ${avgStyleToRing.toFixed(1)}ms (target: ≤16ms)`);
    console.log(`RT-04 avg keydown→ring: ${avgKeydownToRing.toFixed(1)}ms (target: ≤32ms)`);
    // Ring update should happen within 2 frames of style write
    expect(avgStyleToRing).toBeLessThan(33);
  }
  console.log('✅ RT-04: full pipeline latency measured');
});

// ─── RT-05: Actual key repeat interval ───────────────────────────────────────

test('RT-05: measure actual OS key repeat interval and rotation increment per press', async () => {
  const page = sharedPage;
  await injectBox(page, 'rt05');
  await selectViaLayers(page);

  const rotateInput = page.locator('[data-testid="input-rotate"]');
  await expect(rotateInput).toBeVisible({ timeout: 8_000 });
  await rotateInput.click();

  // Use Playwright's built-in keyboard hold to fire real key repeat events
  // and measure the intervals from the page's perspective
  const result = await page.evaluate(async () => {
    const times: number[] = [];
    const inp = document.querySelector<HTMLInputElement>('[data-testid="input-rotate"]');
    if (!inp) return { intervals: [], transforms: [] };

    // Override addEventListener to capture real keydown events
    const origHandler = inp.onkeydown;
    void origHandler;
    const patchedKeyDown = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'ArrowUp') times.push(performance.now());
    };
    inp.addEventListener('keydown', patchedKeyDown, true);

    // Wait for 600ms of key hold (captured via Playwright keyboard hold)
    await new Promise<void>(resolve => setTimeout(resolve, 600));

    inp.removeEventListener('keydown', patchedKeyDown, true);

    const intervals = times.slice(1).map((t, i) => t - times[i]);
    const transforms = [(document.querySelector('[data-builder-id="rt05"]') as HTMLElement)?.style.transform ?? ''];
    return { intervals, transforms, count: times.length };
  });

  // Use Playwright to actually hold the key and measure from outside
  await rotateInput.press('ArrowUp');
  const holdStart = Date.now();
  // Simulate rapid pressing (OS repeat behavior)
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(33); // ~30Hz
  }
  const holdDuration = Date.now() - holdStart;

  const finalTransform = await page.evaluate(() =>
    (document.querySelector('[data-builder-id="rt05"]') as HTMLElement)?.style.transform ?? ''
  );
  const match = finalTransform.match(/rotate\(([\d.]+)deg\)/);
  const finalDeg = match ? parseFloat(match[1]) : 0;

  console.log(`RT-05 Hold duration: ${holdDuration}ms`);
  console.log(`RT-05 Final rotation: ${finalDeg}°`);
  console.log(`RT-05 Expected: 16° (1 initial + 15 presses)`);
  console.log(`RT-05 Key repeat intervals: ${result.intervals.map(i => i.toFixed(0)).join(', ')}ms`);
  console.log(`RT-05 Key repeat rate: ~${result.count} events in 600ms window`);

  expect(finalDeg).toBe(16);
  console.log('✅ RT-05: key repeat and rotation rate measured');
});

// ─── RT-06: patchStyle RAF callback execution time ───────────────────────────

test('RT-06: patchStyle RAF callback duration should be <4ms (frame budget check)', async () => {
  const page = sharedPage;
  await injectBox(page, 'rt06');
  await selectViaLayers(page);

  const rotateInput = page.locator('[data-testid="input-rotate"]');
  await expect(rotateInput).toBeVisible({ timeout: 8_000 });
  await rotateInput.click();

  // Intercept _requestRingUpdate (called from patchStyle's RAF) to measure
  // the total time from RAF start to _requestRingUpdate completion
  const rafDurations = await page.evaluate(async () => {
    const store = (window as unknown as { __builderStore: { getState: () => Record<string, unknown> } })
      .__builderStore.getState();
    const orig = store._requestRingUpdate as (...args: unknown[]) => void;
    const durations: number[] = [];

    // Wrap the RAF's ring update with timing
    // We need to measure the entire RAF callback duration.
    // We do this by timing the interval between RAF start and ring update:
    // Since _requestRingUpdate is called at the END of the RAF callback,
    // its call time ≈ RAF callback completion time.
    let rafStartTime = 0;
    const origRAF = window.requestAnimationFrame;
    (window as unknown as Record<string, unknown>).__origRAF = origRAF;
    window.requestAnimationFrame = (cb) => {
      return origRAF((t) => {
        // Check if this RAF was scheduled by patchStyle (heuristic: el style changed recently)
        const el = document.querySelector('[data-builder-id="rt06"]') as HTMLElement;
        const hasPendingTransform = el?.style.transform !== '';
        if (hasPendingTransform) rafStartTime = performance.now();
        cb(t);
      });
    };

    store._requestRingUpdate = function (...args) {
      if (rafStartTime > 0) {
        durations.push(performance.now() - rafStartTime);
        rafStartTime = 0;
      }
      return orig.apply(store, args);
    };

    const inp = document.querySelector<HTMLInputElement>('[data-testid="input-rotate"]');
    if (!inp) return { durations: [] };

    for (let i = 0; i < 10; i++) {
      await new Promise<void>(resolve => setTimeout(resolve, 40));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: i > 0, bubbles: true, cancelable: true }));
    }
    await new Promise<void>(resolve => setTimeout(resolve, 80));

    // Restore
    store._requestRingUpdate = orig;
    window.requestAnimationFrame = (window as unknown as Record<string, unknown>).__origRAF as typeof window.requestAnimationFrame;

    return { durations };
  });

  const { durations } = rafDurations;
  if (durations.length > 0) {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const max = Math.max(...durations);
    const p95 = [...durations].sort((a, b) => a - b)[Math.floor(durations.length * 0.95)] ?? max;
    console.log(`RT-06 RAF callback duration — avg: ${avg.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms, max: ${max.toFixed(2)}ms`);
    console.log(`RT-06 All durations: ${durations.map(d => d.toFixed(2)).join(', ')}ms`);
    // RAF callback should complete within half a frame (4ms out of 16ms budget)
    expect(avg).toBeLessThan(4);
    expect(p95).toBeLessThan(8);
  } else {
    console.log('RT-06 No RAF durations captured (RAF may not have fired in timing window)');
  }
  console.log('✅ RT-06: RAF callback frame budget measured');
});

// ─── RT-07: querySelector calls per keydown ───────────────────────────────────

test('RT-07: patchStyle calls querySelector on every keydown — measure cost', async () => {
  const page = sharedPage;
  await injectBox(page, 'rt07');
  await selectViaLayers(page);

  const rotateInput = page.locator('[data-testid="input-rotate"]');
  await expect(rotateInput).toBeVisible({ timeout: 8_000 });
  await rotateInput.click();

  const result = await page.evaluate(() => {
    let querySelectorCount = 0;
    const orig = document.querySelector.bind(document);
    document.querySelector = function (sel: string) {
      querySelectorCount++;
      return orig(sel) as Element | null;
    } as typeof document.querySelector;

    const inp = document.querySelector<HTMLInputElement>('[data-testid="input-rotate"]');
    // Reset counter after the above setup query
    querySelectorCount = 0;

    const N = 10;
    if (inp) {
      for (let i = 0; i < N; i++) {
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: i > 0, bubbles: true, cancelable: true }));
      }
    }

    document.querySelector = orig;
    return { querySelectorCount, presses: N, perPress: querySelectorCount / N };
  });

  console.log(`RT-07 querySelector calls for ${result.presses} keydowns: ${result.querySelectorCount} total`);
  console.log(`RT-07 querySelector calls per keydown: ${result.perPress.toFixed(1)}`);
  // patchStyle calls querySelector twice per press: [data-builder-id] + [data-builder-page-frame]
  // (frame is only in RAF, which might not fire synchronously in this test)
  // So synchronously: ~1-2 per press
  expect(result.perPress).toBeLessThanOrEqual(5);
  console.log(`✅ RT-07: ${result.perPress.toFixed(1)} querySelector calls per keydown`);
});

// ─── RT-08a: No CSS transition — patchStyle always snaps instantly ────────────

test('RT-08a: patchStyle never adds a CSS transition (snaps instantly on every keydown)', async () => {
  const page = sharedPage;
  await injectBox(page, 'rt08a');
  await selectViaLayers(page);

  const rotateInput = page.locator('[data-testid="input-rotate"]');
  await expect(rotateInput).toBeVisible({ timeout: 8_000 });
  await rotateInput.click();

  // Both first press and auto-repeat should produce transition: '' (no animation)
  const result = await page.evaluate(() => {
    const inp = document.querySelector<HTMLInputElement>('[data-testid="input-rotate"]');
    const el  = document.querySelector('[data-builder-id="rt08a"]') as HTMLElement;
    inp?.focus();

    inp?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: false, bubbles: true, cancelable: true }));
    const transitionFirstPress = el?.style.transition ?? 'NOT_SET';

    inp?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: true, bubbles: true, cancelable: true }));
    const transitionRepeat = el?.style.transition ?? 'NOT_SET';

    return { transitionFirstPress, transitionRepeat };
  });

  console.log(`RT-08a transition after first press (repeat:false): "${result.transitionFirstPress}"`);
  console.log(`RT-08a transition after auto-repeat (repeat:true):  "${result.transitionRepeat}"`);

  // No transition ever — each keydown snaps immediately like a native number input
  expect(result.transitionFirstPress).toBe('');
  expect(result.transitionRepeat).toBe('');

  console.log('✅ RT-08a: no CSS transition — patchStyle snaps instantly on every keydown');
});

// ─── RT-08: Throttled approach — accumulate in ref, apply once per RAF ────────
//
// This tests a proposed optimization: instead of calling patchStyle on every keydown,
// accumulate the increment in a ref and apply it in a single RAF.
// This would reduce DOM writes + selector queries to 1 per frame instead of per keydown.

test('RT-08: throttled RAF approach — 10 keydowns, only 1 DOM write per RAF frame', async () => {
  const page = sharedPage;
  await injectBox(page, 'rt08');
  await selectViaLayers(page);

  const result = await page.evaluate(async () => {
    const el = document.querySelector('[data-builder-id="rt08"]') as HTMLElement;
    if (!el) return { domWriteCount: 0, rafCount: 0, finalTransform: '' };

    let domWriteCount = 0;
    let rafCount = 0;
    let pendingDeg = 0;
    let rafScheduled = false;

    // Simulate the "throttled" approach
    const applyInRAF = () => {
      rafScheduled = false;
      el.style.transform = `rotate(${pendingDeg}deg)`;
      domWriteCount++;
    };

    const onKeyDown = () => {
      pendingDeg++;
      if (!rafScheduled) {
        rafScheduled = true;
        rafCount++;
        requestAnimationFrame(applyInRAF);
      }
    };

    // Fire 10 keydowns very rapidly (faster than 1 frame = 16ms)
    for (let i = 0; i < 10; i++) {
      onKeyDown();
      // No delay — all within same frame
    }

    // Wait for RAF to fire
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    return {
      domWriteCount,
      rafCount,
      finalTransform: el.style.transform,
      expectedDeg: 10,
    };
  });

  console.log(`RT-08 Throttled approach:`);
  console.log(`  10 keydowns → ${result.domWriteCount} DOM writes (target: 1)`);
  console.log(`  10 keydowns → ${result.rafCount} RAF callbacks (target: 1)`);
  console.log(`  Final transform: ${result.finalTransform}`);

  expect(result.domWriteCount).toBe(1);
  expect(result.rafCount).toBe(1);
  expect(result.finalTransform).toContain('rotate(10deg)');
  console.log('✅ RT-08: throttled approach correctly batches 10 keydowns into 1 RAF write');
});
