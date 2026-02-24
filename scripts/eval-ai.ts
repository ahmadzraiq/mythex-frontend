/**
 * AI evaluation script - runs test cases against all generators.
 * Requires OPENAI_API_KEY. Logs to lib/ai/eval/ai-responses.jsonl.
 * Writes failures to lib/ai/eval/failures.json.
 * Loads .env from project root if present.
 *
 * Flags (to avoid re-testing passed cases and save API cost):
 *   --only-failures   Re-run only cases from failures.json (uses cached AI output, no API calls)
 *   --generator=NAME  Run only this generator (layout, palettes, font-pairings, variant-suggestions, screen, page)
 *   --case=ID         Run only this case ID
 *
 * Examples:
 *   npm run eval:ai
 *   npm run eval:ai -- --only-failures
 *   npm run eval:ai -- --generator=layout
 *   npm run eval:ai -- --case=minimal-homepage
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

import { generateLayout } from '../lib/ai/layout-generator';
import { generatePalettes } from '../lib/ai/generate-palettes';
import { generateFontPairings } from '../lib/ai/generate-font-pairings';
import { generateVariantSuggestions } from '../lib/ai/generate-variant-suggestions';
import { generateScreen } from '../lib/ai/screen-generator';
import { screenGeneratorOutputSchema } from '../lib/ai/screen-generator';
import { generatePage, pageGeneratorOutputSchema } from '../lib/ai/page-generator';
import { logAiResponse } from '../lib/ai/response-logger';
import { fullGenerationSchema } from '../config/schema/layout-schema';
import { palettesResponseSchema } from '../lib/ai/palette-schema';
import { fontPairingsResponseSchema } from '../lib/ai/font-pairing-schema';
import { runVisualScreenTest, type ScreenVisualAssert } from '../lib/ai/visual-screen-runner';
import { schemaToScreen } from '../lib/ai/schema-to-screen';
import { resolveScreenConfig } from '../lib/sdui/config-resolver';
import root from '../config/root';
import {
  validateActions,
  validateStatePaths,
  validateTypes,
  validateDesign,
} from '../lib/ai/validators';
import { COMPONENT_NAMES } from '../config/component-names';

// ─── Page eval helpers ────────────────────────────────────────────────────────

type CheckResult = { pass: boolean; label: string; detail?: string };

/**
 * Keyword map: section name → patterns to look for in the content tree.
 * We search JSON-stringified content for these markers.
 */
const SECTION_MARKERS: Record<string, string[]> = {
  announcement: ['announcement', 'free shipping', 'announcement-bg'],
  hero: ['hero-section', 'hero-heading', 'hero-bg', 'hero split', 'min-h-\\[90vh\\]', 'min-h-\\[60vh\\]', 'min-h-\\[80vh\\]', '"id":"hero'],
  categories: ['categories', 'featured.categories', 'Shop by Category'],
  'flash-sale': ['flash', 'CountdownTimer', 'flashSale'],
  'new-arrivals': ['newArrivals', 'New Arrivals'],
  'best-sellers': ['bestSellers', 'Best Sellers'],
  'brand-story': ['brandStory', 'brand-story', 'Our Story', 'brand story', 'brand-story-section', 'crafting', 'craftsmanship', 'our mission', 'about us', 'who we are'],
  newsletter: ['newsletter', 'subscribeNewsletter', 'InputField'],
};

/**
 * Check that all expected sections appear in the generated content tree.
 */
function sectionCoverageCheck(
  prompt: string,
  content: unknown,
  expectedSections: string[]
): CheckResult {
  const contentStr = JSON.stringify(content);
  const missing: string[] = [];

  for (const section of expectedSections) {
    const markers = SECTION_MARKERS[section] ?? [section];
    const found = markers.some((m) => {
      try {
        return new RegExp(m, 'i').test(contentStr);
      } catch {
        return contentStr.toLowerCase().includes(m.toLowerCase());
      }
    });
    if (!found) missing.push(section);
  }

  if (missing.length === 0) return { pass: true, label: 'Section coverage' };
  return {
    pass: false,
    label: 'Section coverage',
    detail: `Missing sections: ${missing.join(', ')}`,
  };
}

/**
 * Walk the UI tree and collect all "map" paths.
 */
function collectMapPaths(node: unknown, paths: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== 'object') return paths;
  if (Array.isArray(node)) {
    for (const child of node) collectMapPaths(child, paths);
    return paths;
  }
  const n = node as Record<string, unknown>;
  if (typeof n.map === 'string') {
    const topLevel = n.map.split('.')[0];
    if (topLevel) paths.add(topLevel);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) collectMapPaths(child, paths);
  }
  return paths;
}

/**
 * Check that every map path top-level key has a corresponding initAction.
 * e.g. map:"testimonials.items" needs fetchTestimonials in initActions.
 */
function dataConsistencyCheck(
  content: unknown,
  initActions: Array<{ action?: string } | Record<string, unknown>>
): CheckResult {
  const mapPaths = collectMapPaths(content);
  const actionNames = initActions
    .map((a) => (typeof (a as Record<string, unknown>).action === 'string' ? (a as Record<string, unknown>).action as string : ''))
    .filter(Boolean)
    .join(' ');

  const unmapped: string[] = [];
  // These top-level keys are managed by global store or layout — no per-page initAction needed
  const globalKeys = new Set(['nav', 'auth', 'cart', 'layout', 'route', 'screens']);
  // State key → action keyword aliases (when the action name doesn't contain the state key)
  const ALIASES: Record<string, string> = {
    flashSaleProducts: 'flashSale', // fetchFlashSale loads flashSaleProducts state
  };

  for (const path of mapPaths) {
    if (globalKeys.has(path)) continue;
    const searchKey = ALIASES[path] ?? path;
    // Check if any initAction name contains the path namespace (case-insensitive)
    const hasLoader = new RegExp(searchKey, 'i').test(actionNames);
    if (!hasLoader) unmapped.push(path);
  }

  if (unmapped.length === 0) return { pass: true, label: 'Data consistency' };
  return {
    pass: false,
    label: 'Data consistency',
    detail: `map paths without initAction: ${unmapped.join(', ')}`,
  };
}

/**
 * Convert a hex color string to HSL.
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Check that the palette matches the declared design mood.
 */
function paletteMoodCheck(themeHint: Record<string, unknown> | undefined): CheckResult {
  if (!themeHint) return { pass: true, label: 'Palette mood match', detail: 'No themeHint' };

  const mood = typeof themeHint.designMood === 'string' ? themeHint.designMood.toLowerCase() : null;
  const palette = themeHint.palette as Record<string, unknown> | undefined;
  const light = palette?.light as Record<string, string> | undefined;

  if (!mood || !light) return { pass: true, label: 'Palette mood match', detail: 'No mood or palette' };

  const primaryHsl = light.primary ? hexToHsl(light.primary) : null;
  const accentHsl = light.accent ? hexToHsl(light.accent) : null;
  const bgHsl = light.background ? hexToHsl(light.background) : null;

  const issues: string[] = [];

  if (mood === 'luxury') {
    if (primaryHsl && primaryHsl.l > 35) {
      issues.push(`luxury primary too light (L=${primaryHsl.l}%, expected <35%)`);
    }
    if (accentHsl && !(accentHsl.h >= 30 && accentHsl.h <= 60 && accentHsl.s > 40)) {
      issues.push(`luxury accent should be gold/amber (hue 30-60°, sat >40%); got h=${accentHsl.h} s=${accentHsl.s}`);
    }
  } else if (mood === 'playful') {
    if (accentHsl && accentHsl.s < 50) {
      issues.push(`playful accent not saturated enough (S=${accentHsl.s}%, expected >50%)`);
    }
  } else if (mood === 'warm') {
    if (primaryHsl && !(primaryHsl.h >= 5 && primaryHsl.h <= 50)) {
      issues.push(`warm primary not in earth-tone range (hue 5-50°); got h=${primaryHsl.h}`);
    }
  } else if (mood === 'modern') {
    // Modern: background should be light
    if (bgHsl && bgHsl.l < 85) {
      issues.push(`modern background too dark (L=${bgHsl.l}%, expected >85%)`);
    }
    // Modern should NOT look like a warm brand (earth tones) or a pure playful brand.
    // Allow cool blues/teals/slates as they're common in modern design.
    // Only flag warm hues (orange/red/yellow range 20-60°) that are highly saturated.
    if (primaryHsl && primaryHsl.s > 70 && primaryHsl.h >= 20 && primaryHsl.h <= 60) {
      issues.push(`modern primary looks too warm/earthy (S=${primaryHsl.s}%, H=${primaryHsl.h}) — modern uses cool or neutral tones`);
    }
  }

  if (issues.length === 0) return { pass: true, label: 'Palette mood match' };
  return { pass: false, label: 'Palette mood match', detail: issues.join('; ') };
}

/**
 * Print a formatted summary table row.
 */
function fmtRow(label: string, pass: boolean, detail?: string): string {
  const status = pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  const detail_ = detail ? `  ${detail}` : '';
  return `  ${label.padEnd(28)} ${status}${detail_}`;
}

const EVAL_DIR = join(process.cwd(), 'lib', 'ai', 'eval');
const FAILURES_FILE = join(EVAL_DIR, 'failures.json');
const PENDING_CORRECTIONS_FILE = join(EVAL_DIR, 'pending-corrections.json');

function createVersionedResponsesFile(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `ai-responses-${ts}.jsonl`;
  const filepath = join(EVAL_DIR, filename);
  process.env.AI_RESPONSES_FILE = filepath;
  return filepath;
}

const ARGS = process.argv.slice(2);
const ONLY_FAILURES = ARGS.includes('--only-failures');
const STOP_ON_FIRST_PASS = ARGS.includes('--stop-on-first-pass');
const GENERATOR_FILTER = ARGS.find((a) => a.startsWith('--generator='))?.split('=')[1] ?? 'layout';
const CASE_FILTER = ARGS.find((a) => a.startsWith('--case='))?.split('=')[1];

type Failure = {
  id: string;
  generator: string;
  prompt: string;
  input?: Record<string, unknown>;
  expected?: unknown;
  actual?: unknown;
  error: string;
};

function loadCases(filename: string): { cases: Array<Record<string, unknown>> } {
  const path = join(EVAL_DIR, filename);
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as { cases: Array<Record<string, unknown>> };
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj as object)
    .sort()
    .reduce((acc, k) => {
      acc[k] = sortKeys((obj as Record<string, unknown>)[k]);
      return acc;
    }, {} as Record<string, unknown>);
}

function jsonNormalize(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

async function runLayoutCase(
  c: Record<string, unknown>,
  cachedOutput?: Record<string, unknown>
): Promise<{ pass: boolean; actual?: unknown; error?: string }> {
  const prompt = String(c.prompt ?? 'Generate an e-commerce homepage.');

  try {
    let output: Record<string, unknown>;
    if (cachedOutput) {
      output = { ...cachedOutput };
    } else {
      const result = await generateLayout(prompt);
      output = { layout: result.layout, theme: result.theme };
    }

    const parsed = fullGenerationSchema.safeParse(output);
    if (!parsed.success) {
      logAiResponse('layout', { prompt }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: parsed.error.message,
      });
      return { pass: false, actual: output, error: parsed.error.message };
    }
    logAiResponse('layout', { prompt }, output, { source: 'eval', evalResult: 'PASS', page: 'home' });

    // Optional visual test (only when RUN_VISUAL=1 and case has visualAssert)
    const visualAssert = c.visualAssert as ScreenVisualAssert | undefined;
    if (process.env.RUN_VISUAL === '1' && visualAssert) {
      const screen = schemaToScreen(parsed.data.layout) as Record<string, unknown>;
      const screenshotsDir = join(EVAL_DIR, 'screenshots');
      const visualResult = await runVisualScreenTest({
        screen,
        style: parsed.data.theme.style ?? null,
        theme: parsed.data.theme as Record<string, unknown>,
        visualAssert,
        screenshotsDir,
        label: String(c.id ?? 'screen'),
      });
      if (!visualResult.pass) {
        return { pass: false, error: `Visual: ${visualResult.error}` };
      }
    }

    return { pass: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logAiResponse('layout', { prompt }, null, {
      source: 'eval',
      evalResult: 'FAIL',
      error: err,
      page: 'home',
    });
    return { pass: false, error: err };
  }
}

async function runPalettesCase(
  c: Record<string, unknown>,
  cachedOutput?: Record<string, unknown>
): Promise<{ pass: boolean; actual?: unknown; error?: string }> {
  const designMood = String(c.designMood ?? 'modern');
  const mode = (c.mode as 'light' | 'dark' | 'both') ?? 'both';

  try {
    const output = cachedOutput
      ? { ...cachedOutput }
      : { palettes: await generatePalettes(designMood, designMood, mode) };

    const parsed = palettesResponseSchema.safeParse(output);
    if (!parsed.success) {
      logAiResponse('palettes', { designMood, mode }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: parsed.error.message,
      });
      return { pass: false, actual: output, error: parsed.error.message };
    }
    logAiResponse('palettes', { designMood, mode }, output, { source: 'eval', evalResult: 'PASS' });
    return { pass: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logAiResponse('palettes', { designMood, mode }, null, {
      source: 'eval',
      evalResult: 'FAIL',
      error: err,
    });
    return { pass: false, error: err };
  }
}

async function runFontPairingsCase(
  c: Record<string, unknown>,
  cachedOutput?: Record<string, unknown>
): Promise<{ pass: boolean; actual?: unknown; error?: string }> {
  const designMood = String(c.designMood ?? 'modern');

  try {
    const output = cachedOutput
      ? { ...cachedOutput }
      : { pairings: await generateFontPairings(designMood) };

    const parsed = fontPairingsResponseSchema.safeParse(output);
    if (!parsed.success) {
      logAiResponse('font-pairings', { designMood }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: parsed.error.message,
      });
      return { pass: false, actual: output, error: parsed.error.message };
    }
    logAiResponse('font-pairings', { designMood }, output, { source: 'eval', evalResult: 'PASS' });
    return { pass: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logAiResponse('font-pairings', { designMood }, null, {
      source: 'eval',
      evalResult: 'FAIL',
      error: err,
    });
    return { pass: false, error: err };
  }
}

async function runScreenCase(
  c: Record<string, unknown>,
  cachedOutput?: Record<string, unknown>
): Promise<{ pass: boolean; actual?: unknown; error?: string }> {
  const prompt = String(c.prompt ?? 'Generate a product listing page.');

  try {
    let output: Record<string, unknown>;
    if (cachedOutput) {
      output = { ...cachedOutput };
    } else {
      output = await generateScreen(prompt);
    }

    const parsed = screenGeneratorOutputSchema.safeParse(output);
    if (!parsed.success) {
      logAiResponse('screen', { prompt }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: parsed.error.message,
      });
      return { pass: false, actual: output, error: parsed.error.message };
    }
    logAiResponse('screen', { prompt }, output, { source: 'eval', evalResult: 'PASS' });
    return { pass: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logAiResponse('screen', { prompt }, null, {
      source: 'eval',
      evalResult: 'FAIL',
      error: err,
    });
    return { pass: false, error: err };
  }
}

async function runPageCase(
  c: Record<string, unknown>,
  cachedOutput?: Record<string, unknown>
): Promise<{ pass: boolean; actual?: unknown; error?: string }> {
  const prompt = String(c.prompt ?? 'Generate a modern e-commerce homepage.');
  const checks: CheckResult[] = [];

  try {
    let output: Record<string, unknown>;
    if (cachedOutput) {
      output = { ...cachedOutput };
    } else {
      output = await generatePage(prompt) as Record<string, unknown>;
    }

    // ── 1. Schema validation ─────────────────────────────────────────────────
    const parsed = pageGeneratorOutputSchema.safeParse(output);
    if (!parsed.success) {
      checks.push({ pass: false, label: 'Schema validation', detail: parsed.error.message });
      printChecks(checks);
      logAiResponse('page', { prompt }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: parsed.error.message,
        page: 'home',
      });
      return { pass: false, actual: output, error: parsed.error.message };
    }
    checks.push({ pass: true, label: 'Schema validation' });

    const screen = parsed.data;
    const expect_ = c.expect as Record<string, unknown> | undefined;

    // ── 2. hasInitActions ────────────────────────────────────────────────────
    if (expect_?.hasInitActions) {
      const ok = Array.isArray(screen.initActions) && screen.initActions.length > 0;
      checks.push({ pass: ok, label: 'Has initActions', detail: ok ? undefined : 'initActions is empty' });
    }

    // ── 3. layoutIs ──────────────────────────────────────────────────────────
    if (expect_?.layoutIs) {
      const ok = screen.layout === expect_.layoutIs;
      checks.push({
        pass: ok,
        label: 'Layout name',
        detail: ok ? undefined : `Expected "${expect_.layoutIs}", got "${screen.layout}"`,
      });
    }

    // ── 4. Section coverage ──────────────────────────────────────────────────
    if (expect_?.sectionsPresent && Array.isArray(expect_.sectionsPresent)) {
      const r = sectionCoverageCheck(prompt, screen.content, expect_.sectionsPresent as string[]);
      checks.push(r);
    }

    // ── 5. Data consistency (map paths → initActions) ────────────────────────
    if (expect_?.noMapWithoutInitAction) {
      const r = dataConsistencyCheck(screen.content, screen.initActions ?? []);
      checks.push(r);
    }

    // ── 6. Palette mood match ────────────────────────────────────────────────
    if (expect_?.paletteMoodMatch) {
      const r = paletteMoodCheck(screen.themeHint as Record<string, unknown> | undefined);
      checks.push(r);
    }

    // ── 7. Type validator ────────────────────────────────────────────────────
    const typeResult = validateTypes(screen.content as Parameters<typeof validateTypes>[0]);
    checks.push({
      pass: typeResult.pass,
      label: 'Component types',
      detail: typeResult.errors?.join('; '),
    });

    // ── 8. Design validator ──────────────────────────────────────────────────
    const designResult = validateDesign(screen.content as Parameters<typeof validateDesign>[0]);
    checks.push({
      pass: designResult.pass,
      label: 'Design rules',
      detail: designResult.errors?.join('; '),
    });

    // ── Print semantic check summary ─────────────────────────────────────────
    printChecks(checks);

    const semanticFailed = checks.filter((r) => !r.pass);
    if (semanticFailed.length > 0) {
      const errorMsg = semanticFailed.map((r) => `${r.label}: ${r.detail ?? 'failed'}`).join(' | ');
      logAiResponse('page', { prompt }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: errorMsg,
        page: 'home',
      });
      return { pass: false, actual: output, error: errorMsg };
    }

    // ── 9. Visual design check ───────────────────────────────────────────────
    const visualAssert = c.visualAssert as ScreenVisualAssert | undefined;
    if (process.env.RUN_VISUAL === '1' && visualAssert) {
      const screenshotsDir = join(EVAL_DIR, 'screenshots');
      const pageName = String(c.id ?? 'page');

      // Resolve $ref and layout slots — same as AiResponsePreviewOverlay does for 'page' generator
      const registry = { layouts: root.layouts, fragments: root.fragments } as Parameters<typeof resolveScreenConfig>[1];
      const resolvedScreen = resolveScreenConfig(
        output as Parameters<typeof resolveScreenConfig>[0],
        registry
      ) as Record<string, unknown>;

      // Build theme in the format the renderer expects: { designMood, colors: palette, fonts }
      const themeHint = screen.themeHint as { designMood?: string; palette?: Record<string, unknown>; fonts?: { heading?: string; body?: string } } | undefined;
      const style = themeHint?.designMood ?? null;
      const theme = themeHint
        ? { designMood: themeHint.designMood, colors: themeHint.palette, fonts: themeHint.fonts }
        : undefined;

      const visualResult = await runVisualScreenTest({
        screen: resolvedScreen,
        style,
        theme: theme as Record<string, unknown> | undefined,
        visualAssert,
        label: pageName,
        screenshotsDir,
        prompt,
      });

      const visualChecks: CheckResult[] = [
        { pass: visualResult.pass, label: 'Visual checks', detail: visualResult.error },
      ];
      if (visualResult.screenshotPath) {
        console.log(`  Screenshot: ${visualResult.screenshotPath}`);
      }
      printChecks(visualChecks);

      if (!visualResult.pass) {
        logAiResponse('page', { prompt }, output, {
          source: 'eval',
          evalResult: 'FAIL',
          error: `Visual: ${visualResult.error}`,
          page: 'home',
        });
        return { pass: false, actual: output, error: `Visual: ${visualResult.error}` };
      }
    }

    logAiResponse('page', { prompt }, output, { source: 'eval', evalResult: 'PASS', page: 'home' });
    return { pass: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logAiResponse('page', { prompt }, null, {
      source: 'eval',
      evalResult: 'FAIL',
      error: err,
      page: 'home',
    });
    return { pass: false, error: err };
  }
}

function printChecks(checks: CheckResult[]): void {
  for (const r of checks) {
    console.log(fmtRow(r.label, r.pass, r.detail));
  }
}

async function runVariantSuggestionsCase(
  c: Record<string, unknown>,
  cachedOutput?: Record<string, unknown>
): Promise<{ pass: boolean; actual?: unknown; error?: string }> {
  const designMood = String(c.designMood ?? 'modern');

  try {
    const output = cachedOutput
      ? { ...cachedOutput }
      : { suggestions: await generateVariantSuggestions(designMood) };

    const suggestions = (output as { suggestions?: unknown }).suggestions;
    if (typeof suggestions !== 'object' || suggestions === null) {
      logAiResponse('variant-suggestions', { designMood }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: 'Suggestions must be an object',
      });
      return { pass: false, actual: output, error: 'Suggestions must be an object' };
    }
    logAiResponse('variant-suggestions', { designMood }, output, { source: 'eval', evalResult: 'PASS' });
    return { pass: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logAiResponse('variant-suggestions', { designMood }, null, {
      source: 'eval',
      evalResult: 'FAIL',
      error: err,
    });
    return { pass: false, error: err };
  }
}

const GENERATOR_CONFIG: Array<{
  generator: string;
  filename: string;
  runner: (
    c: Record<string, unknown>,
    cachedOutput?: Record<string, unknown>,
    generatorName?: string
  ) => Promise<{ pass: boolean; actual?: unknown; error?: string }>;
}> = [
  { generator: 'layout', filename: 'layout.json', runner: runLayoutCase },
  { generator: 'palettes', filename: 'palettes.json', runner: runPalettesCase },
  { generator: 'font-pairings', filename: 'font-pairings.json', runner: runFontPairingsCase },
  { generator: 'variant-suggestions', filename: 'variant-suggestions.json', runner: runVariantSuggestionsCase },
  { generator: 'screen', filename: 'screen.json', runner: runScreenCase },
  { generator: 'page', filename: 'page.json', runner: runPageCase },
];

function shouldRunCase(generator: string, caseId: string): boolean {
  if (GENERATOR_FILTER && generator !== GENERATOR_FILTER) return false;
  if (CASE_FILTER && caseId !== CASE_FILTER) return false;
  return true;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is required. Set it and run again.');
    process.exit(1);
  }

  const failures: Failure[] = [];
  let total = 0;
  let passed = 0;

  if (!existsSync(EVAL_DIR)) {
    mkdirSync(EVAL_DIR, { recursive: true });
  }

  const AI_RESPONSES_FILE = createVersionedResponsesFile();
  writeFileSync(AI_RESPONSES_FILE, '', 'utf8');

  let casesToRun: Array<{
    generator: string;
    filename: string;
    runner: (
      c: Record<string, unknown>,
      cachedOutput?: Record<string, unknown>,
      generatorName?: string
    ) => Promise<{ pass: boolean; actual?: unknown; error?: string }>;
    caseData: Record<string, unknown>;
    cachedOutput?: Record<string, unknown>;
  }> = [];

  if (ONLY_FAILURES) {
    if (!existsSync(FAILURES_FILE)) {
      console.error('No failures.json found. Run full eval first.');
      process.exit(1);
    }
    const prevFailures = JSON.parse(readFileSync(FAILURES_FILE, 'utf8')) as Failure[];
    if (prevFailures.length === 0) {
      console.log('No failures to re-run.');
      process.exit(0);
    }
    for (const f of prevFailures) {
      const config = GENERATOR_CONFIG.find((g) => g.generator === f.generator);
      if (!config) continue;
      const { cases } = loadCases(config.filename);
      const caseData = cases.find((c) => String(c.id) === f.id);
      if (caseData)
        casesToRun.push({
          ...config,
          caseData,
          cachedOutput: f.actual as Record<string, unknown> | undefined,
        });
    }
    console.log(`Re-running ${casesToRun.length} failed case(s). Use --only-failures to avoid re-testing passed cases.\n`);
  } else {
    for (const config of GENERATOR_CONFIG) {
      const { cases } = loadCases(config.filename);
      for (const c of cases) {
        const id = String(c.id ?? 'unknown');
        if (shouldRunCase(config.generator, id)) {
          casesToRun.push({ ...config, caseData: c, cachedOutput: undefined });
        }
      }
    }
  }

  const run = async (
    generator: string,
    runner: (
      c: Record<string, unknown>,
      cachedOutput?: Record<string, unknown>,
      generatorName?: string
    ) => Promise<{ pass: boolean; actual?: unknown; error?: string }>,
    c: Record<string, unknown>,
    cachedOutput?: Record<string, unknown>
  ) => {
    const id = String(c.id ?? 'unknown');
    process.stdout.write(`  ${id}... `);
    const result = await runner(c, cachedOutput, generator);
    if (result.pass) {
      passed++;
      console.log('PASS');
      if (STOP_ON_FIRST_PASS) {
        console.log('\n--- Stopped on first pass (--stop-on-first-pass) ---');
        writeFileSync(FAILURES_FILE, JSON.stringify(failures, null, 2), 'utf8');
        console.log(`Responses logged to ${AI_RESPONSES_FILE}`);
        process.exit(0);
      }
    } else {
      console.log('FAIL');
      failures.push({
        id,
        generator,
        prompt: String(c.prompt ?? c.designMood ?? ''),
        input: c.prompt ? { prompt: c.prompt } : { designMood: c.designMood, mode: c.mode },
        expected: c.expected,
        actual: result.actual,
        error: result.error ?? 'Unknown error',
      });
    }
  };

  let lastGenerator = '';
  for (const { generator, runner, caseData, cachedOutput } of casesToRun) {
    total++;
    if (generator !== lastGenerator) {
      console.log(`\n--- ${generator} ---`);
      lastGenerator = generator;
    }
    await run(generator, runner, caseData, cachedOutput);
  }

  // ── Final summary table ────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('  EVAL SUMMARY');
  console.log('─'.repeat(60));

  for (const { generator, runner: _r, caseData, cachedOutput: _c } of casesToRun) {
    const id = String(caseData.id ?? 'unknown');
    const failed = failures.find((f) => f.id === id && f.generator === generator);
    const status = failed ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32mPASS\x1b[0m';
    const detail = failed ? `  ${failed.error.slice(0, 80)}` : '';
    console.log(`  ${generator}/${id.padEnd(30)} ${status}${detail}`);
  }

  console.log('─'.repeat(60));
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  console.log(`  ${passed}/${total} passed (${passRate}%)`);
  console.log('─'.repeat(60) + '\n');

  if (ONLY_FAILURES && failures.length === 0) {
    console.log('All previously failed cases now pass.');
  }

  writeFileSync(FAILURES_FILE, JSON.stringify(failures, null, 2), 'utf8');
  console.log(`Failures written to ${FAILURES_FILE}`);

  // ── Auto-correction: write pending-corrections.json ────────────────────────
  if (failures.length > 0) {
    const pending = failures
      .filter((f) => f.actual != null)
      .map((f) => ({
        id: `auto-${f.generator}-${f.id}-${Date.now()}`,
        generator: f.generator,
        caseId: f.id,
        category: 'logic' as const,
        prompt: f.prompt,
        wrongOutput: f.actual,
        failedCheck: f.error,
        reason: f.error,
        suggestedFix: `Review the "${f.id}" case output and add a corrected version to corrections.json["${f.generator}"]`,
        needsManualCorrection: true,
        createdAt: new Date().toISOString(),
      }));

    if (pending.length > 0) {
      let existing: typeof pending = [];
      if (existsSync(PENDING_CORRECTIONS_FILE)) {
        try {
          existing = JSON.parse(readFileSync(PENDING_CORRECTIONS_FILE, 'utf8'));
        } catch {
          /* ignore */
        }
      }
      writeFileSync(
        PENDING_CORRECTIONS_FILE,
        JSON.stringify([...existing, ...pending], null, 2),
        'utf8'
      );
      console.log(`Pending corrections appended to ${PENDING_CORRECTIONS_FILE}`);
      console.log('  Review failing cases, add correctedOutput, then move to corrections.json.');
    }
  }

  // ── Eval history (track pass rates over time) ──────────────────────────────
  const EVAL_HISTORY_FILE = join(EVAL_DIR, 'eval-history.json');
  let history: Array<Record<string, unknown>> = [];
  if (existsSync(EVAL_HISTORY_FILE)) {
    try {
      history = JSON.parse(readFileSync(EVAL_HISTORY_FILE, 'utf8'));
    } catch {
      /* ignore */
    }
  }
  history.push({
    timestamp: new Date().toISOString(),
    total,
    passed,
    failed: failures.length,
    passRate,
    failedCases: failures.map((f) => ({ id: f.id, generator: f.generator, error: f.error })),
  });
  // Keep last 50 runs
  if (history.length > 50) history = history.slice(-50);
  writeFileSync(EVAL_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');

  console.log(`Responses logged to ${AI_RESPONSES_FILE}`);

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
