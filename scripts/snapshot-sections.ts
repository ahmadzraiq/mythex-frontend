/**
 * Visual snapshot script — screenshots every section variant in the library.
 *
 * Usage:
 *   npm run snapshot:sections              # all variants, desktop + mobile
 *   npm run snapshot:sections -- --type=hero       # only hero variants
 *   npm run snapshot:sections -- --id=hero.overlay-centered   # single variant
 *   npm run snapshot:sections -- --mobile-only    # mobile only
 *   npm run snapshot:sections -- --no-mobile      # desktop only
 *
 * Output:
 *   lib/ai/eval/screenshots/variants/{variantId}/desktop.png
 *   lib/ai/eval/screenshots/variants/{variantId}/mobile.png
 *
 * Requires the dev server to be running (npm run dev).
 * Requires playwright: npm install -D @playwright/test
 */

import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3001';
const MANIFEST_URL = `${BASE_URL}/api/dev/section-preview/manifest`;
const LAYOUT_PARTS_MANIFEST_URL = `${BASE_URL}/api/dev/layout-part-preview/manifest`;
const RENDER_URL = `${BASE_URL}/dev/sections/render`;
const OUT_DIR = join(process.cwd(), 'lib/ai/eval/screenshots/variants');

const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const PAGE_LOAD_TIMEOUT = 15000;
const RENDER_SETTLE_MS = 800; // wait for layout to settle after inject

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const filterType = args.find(a => a.startsWith('--type='))?.split('=')[1];
const filterId = args.find(a => a.startsWith('--id='))?.split('=')[1];
const mobileOnly = args.includes('--mobile-only');
const noMobile = args.includes('--no-mobile');
const darkMode = args.includes('--dark');
const layoutPartsOnly = args.includes('--layout-parts');
const includeLayoutParts = args.includes('--with-layout-parts') || layoutPartsOnly;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ManifestEntry {
  variantId: string;
  label: string;
  bestFor: string[];
}

interface LayoutPartEntry {
  id: string;
  label: string;
  description: string;
}

type SnapshotTarget =
  | { kind: 'variant'; variantId: string; label: string }
  | { kind: 'layoutPart'; partId: string; label: string };

interface SnapshotResult {
  variantId: string;
  status: 'ok' | 'error';
  desktopPath?: string;
  mobilePath?: string;
  error?: string;
  durationMs: number;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function fetchManifest(): Promise<ManifestEntry[]> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`);
  const data = await res.json() as { manifest: ManifestEntry[] };
  return data.manifest;
}

async function fetchLayoutParts(): Promise<LayoutPartEntry[]> {
  const res = await fetch(LAYOUT_PARTS_MANIFEST_URL);
  if (!res.ok) throw new Error(`Failed to fetch layout parts: ${res.status} ${res.statusText}`);
  const data = await res.json() as { parts: LayoutPartEntry[] };
  return data.parts;
}

async function waitForContent(page: Page): Promise<void> {
  // Wait for the SDUI tree to mount (first Box renders)
  await page.waitForFunction(
    () => document.querySelector('[class*="flex"]') !== null,
    undefined,
    { timeout: PAGE_LOAD_TIMEOUT }
  );
  // Extra settle time for images and fonts
  await page.waitForTimeout(RENDER_SETTLE_MS);
}

async function snapshotTarget(
  browser: Browser,
  target: SnapshotTarget,
  outDir: string
): Promise<SnapshotResult> {
  const start = Date.now();
  const dirSegment = target.kind === 'variant'
    ? target.variantId.replace(/\./g, '/')
    : `layout-parts/${target.partId}`;
  const variantDir = join(outDir, dirSegment);
  mkdirSync(variantDir, { recursive: true });

  const context = await browser.newContext();
  const page = await context.newPage();

  const id = target.kind === 'variant' ? target.variantId : target.partId;

  try {
    const paramKey = target.kind === 'variant' ? 'variantId' : 'layoutPart';
    const renderUrl = `${RENDER_URL}?${paramKey}=${encodeURIComponent(id)}&dark=${darkMode}`;

    const result: SnapshotResult = {
      variantId: id,
      status: 'ok',
      durationMs: 0,
    };

    // ── Desktop snapshot ──
    if (!mobileOnly) {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto(renderUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
      await waitForContent(page);

      const desktopPath = join(variantDir, 'desktop.png');
      await page.screenshot({ path: desktopPath, fullPage: true });
      result.desktopPath = desktopPath;
    }

    // ── Mobile snapshot ──
    if (!noMobile) {
      await page.setViewportSize(MOBILE_VIEWPORT);
      if (mobileOnly) {
        await page.goto(renderUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
        await waitForContent(page);
      } else {
        // Already on the page — just resize and re-settle
        await page.waitForTimeout(400);
      }

      const mobilePath = join(variantDir, 'mobile.png');
      await page.screenshot({ path: mobilePath, fullPage: true });
      result.mobilePath = mobilePath;
    }

    result.durationMs = Date.now() - start;
    return result;

  } catch (err) {
    return {
      variantId: id,
      status: 'error',
      error: String(err),
      durationMs: Date.now() - start,
    };
  } finally {
    await context.close();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📸 Section Snapshot Tool`);
  console.log(`   Base URL : ${BASE_URL}`);
  console.log(`   Output   : ${OUT_DIR}`);
  console.log(`   Viewports: ${[!mobileOnly && 'desktop', !noMobile && 'mobile'].filter(Boolean).join(', ')}`);
  console.log(`   Theme    : ${darkMode ? 'dark' : 'light'}\n`);

  // Fetch manifests
  let manifest: ManifestEntry[] = [];
  let layoutParts: LayoutPartEntry[] = [];
  try {
    [manifest, layoutParts] = await Promise.all([
      fetchManifest(),
      fetchLayoutParts(),
    ]);
  } catch (err) {
    console.error(`❌ Cannot reach dev server at ${BASE_URL}`);
    console.error(`   Make sure "npm run dev" is running first.\n`);
    process.exit(1);
  }

  // Build target list
  let targets: SnapshotTarget[] = [];

  if (!layoutPartsOnly) {
    let variantTargets: SnapshotTarget[] = manifest.map(v => ({ kind: 'variant', variantId: v.variantId, label: v.label }));
    if (filterId) {
      variantTargets = variantTargets.filter(v => v.kind === 'variant' && v.variantId === filterId);
      if (!variantTargets.length) { console.error(`❌ No variant found with id: ${filterId}`); process.exit(1); }
    } else if (filterType) {
      variantTargets = variantTargets.filter(v => v.kind === 'variant' && v.variantId.startsWith(filterType + '.'));
      if (!variantTargets.length) { console.error(`❌ No variants found for type: ${filterType}`); process.exit(1); }
    }
    targets.push(...variantTargets);
  }

  if (includeLayoutParts) {
    targets.push(...layoutParts.map(p => ({ kind: 'layoutPart' as const, partId: p.id, label: p.label })));
  }

  console.log(`🎯 Snapshotting ${targets.length} item${targets.length !== 1 ? 's' : ''}…\n`);
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const results: SnapshotResult[] = [];

  let pass = 0, fail = 0;

  for (const target of targets) {
    const displayId = target.kind === 'variant' ? target.variantId : `[layout] ${target.partId}`;
    process.stdout.write(`  ${displayId.padEnd(45)} `);
    const result = await snapshotTarget(browser, target, OUT_DIR);
    results.push(result);

    if (result.status === 'ok') {
      pass++;
      const viewports = [result.desktopPath && 'desktop', result.mobilePath && 'mobile'].filter(Boolean).join('+');
      console.log(`✓  ${viewports}  (${result.durationMs}ms)`);
    } else {
      fail++;
      console.log(`✗  ERROR: ${result.error}`);
    }
  }

  await browser.close();

  // ── Summary ──
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ ${pass} passed   ❌ ${fail} failed   of ${targets.length} total`);
  console.log(`📁 Screenshots saved to: ${OUT_DIR}`);

  // Write summary JSON
  const summaryPath = join(process.cwd(), 'lib/ai/eval/screenshots', 'snapshot-summary.json');
  writeFileSync(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: targets.length,
    passed: pass,
    failed: fail,
    darkMode,
    results,
  }, null, 2));
  console.log(`📋 Summary: lib/ai/eval/screenshots/snapshot-summary.json\n`);

  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
