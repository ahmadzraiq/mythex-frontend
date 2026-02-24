/**
 * Manager Agent — pure orchestration logic, no AI call itself.
 *
 * Coordinates the full multi-agent pipeline:
 *   1. DesignDirectorAgent (gpt-4o) — creative direction
 *   2. BriefAgent (gpt-4o-mini) — structured brief
 *   3. ContentAgent + ThemeAgent in parallel (both gpt-4o-mini)
 *   4. StructureAgent (gpt-4o) — SDUI tree (content + navbar + footer), up to 2 validator retries
 *   4.5. Screenshot (Playwright) — render page, capture screenshot for QA
 *   5. QA Review loop (gpt-4o + vision) — up to 2 retries:
 *        QA review → if fail → StructureAgent fix → re-screenshot → re-run QA → repeat
 *
 * The StructureAgent generates layoutParts.navbar.structure and
 * layoutParts.footer.structure directly — no separate navbar step needed.
 */

import { tmpdir } from 'os';
import { runDesignDirectorAgent, type DesignSpec } from './design-director-agent';
import { runBriefAgent, type DesignBrief } from './brief-agent';
import { runContentAgent, type GeneratedContent } from './content-agent';
import { runStructureAgent } from './structure-agent';
import { runQAReviewerAgent, type QAReport } from './qa-reviewer-agent';
import { generatePalettes } from '@/lib/ai/generate-palettes';
import { generateFontPairings } from '@/lib/ai/generate-font-pairings';
import { logAiResponse } from '@/lib/ai/response-logger';
import {
  validateActions,
  validateStatePaths,
  validateTypes,
  validateDesign,
} from '@/lib/ai/validators';
import type { PageGeneratorOutput } from '@/lib/ai/page-generator';
import type { UiNode } from '@/lib/ai/validators/types';
import type { Palette } from '@/lib/ai/palette-schema';
import type { FontPairing } from '@/lib/ai/font-pairing-schema';

// ─── Pipeline options ─────────────────────────────────────────────────────────

export interface PipelineOptions {
  palette?: Palette | null;
  fontPairing?: FontPairing | null;
  pageName?: string;
  /** Screenshot path to run QA vision review. If omitted, pipeline auto-captures one. */
  screenshotPath?: string;
  /** Pass threshold for QA review (default 7/10) */
  qaPassThreshold?: number;
  /** Skip QA review entirely */
  skipQA?: boolean;
  /** Skip the Playwright screenshot step (faster, QA falls back to text-only) */
  skipScreenshot?: boolean;
}

export interface PipelineResult {
  screen: PageGeneratorOutput;
  spec: DesignSpec;
  brief: DesignBrief;
  content: GeneratedContent;
  qaReport?: QAReport;
  validatorRetries: number;
  qaRetried: boolean;
}

// ─── Validators ────────────────────────────────────────────────────────────────

function runValidators(screen: PageGeneratorOutput): { pass: boolean; errors: string[] } {
  const content = screen.content as UiNode;
  const results = [
    validateTypes(content),
    validateActions(content),
    validateStatePaths(content),
    validateDesign(content),
  ];

  const errors = results.flatMap(r => r.errors ?? []);
  return { pass: errors.length === 0, errors };
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Run the full multi-agent pipeline for a page prompt.
 */
export async function runPipeline(
  prompt: string,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const {
    palette: externalPalette,
    fontPairing: externalFontPairing,
    pageName = 'home',
    screenshotPath: externalScreenshotPath,
    qaPassThreshold = 7,
    skipQA = false,
    skipScreenshot = false,
  } = options;

  // ── Step 1: Design Director (gpt-4o) ──────────────────────────────────────
  console.log('[pipeline] Step 1: Design Director...');
  const spec = await runDesignDirectorAgent(prompt);

  // ── Step 2: Brief (gpt-4o-mini) ───────────────────────────────────────────
  console.log('[pipeline] Step 2: Brief Agent...');
  const brief = await runBriefAgent(spec);

  // ── Step 3: Content + Theme + Fonts in parallel (all gpt-4o-mini) ──────────
  console.log('[pipeline] Step 3: Content + Theme (parallel)...');
  const [content, palettes, fontPairings] = await Promise.all([
    runContentAgent(brief),
    externalPalette
      ? Promise.resolve([externalPalette])
      : generatePalettes(spec.designMood, spec.colorMood, 'both').catch(() => null as null),
    externalFontPairing
      ? Promise.resolve([externalFontPairing])
      : generateFontPairings(spec.designMood).catch(() => null as null),
  ]);

  // Random selection — different visual identity each run
  const paletteIndex = Array.isArray(palettes) && palettes.length > 0
    ? Math.floor(Math.random() * palettes.length)
    : 0;
  const palette = externalPalette ?? (Array.isArray(palettes) && palettes.length > 0 ? palettes[paletteIndex] : null);

  const fontIndex = Array.isArray(fontPairings) && fontPairings.length > 0
    ? Math.floor(Math.random() * fontPairings.length)
    : 0;
  const fontPairing = externalFontPairing ?? (Array.isArray(fontPairings) && fontPairings.length > 0 ? fontPairings[fontIndex] : null);

  // ── Step 4: Structure build (gpt-4o) — generates content + navbar + footer ─
  // Up to 2 validator retries on the content tree.
  console.log('[pipeline] Step 4: Structure Agent (content + navbar + footer)...');
  let screen = await runStructureAgent(brief, content, palette, fontPairing, spec);
  let validatorRetries = 0;

  for (let i = 0; i < 2; i++) {
    const v = runValidators(screen);
    if (v.pass) break;
    console.log(`[pipeline] Validator retry ${i + 1}/2 — ${v.errors.length} errors:`, v.errors.slice(0, 3));
    screen = await runStructureAgent(brief, content, palette, fontPairing, spec, {
      validatorErrors: v.errors,
    });
    validatorRetries++;
  }

  // ── Step 4.5: Screenshot (Playwright) — render page for visual QA ─────────
  // Auto-capture a screenshot so the QA reviewer gets real visual feedback
  // instead of text-only JSON analysis. Falls back gracefully if Playwright
  // or the dev server is unavailable.
  let autoScreenshotPath: string | undefined = externalScreenshotPath;

  if (!skipQA && !skipScreenshot && !externalScreenshotPath) {
    console.log('[pipeline] Step 4.5: Screenshot (Playwright)...');
    try {
      const { runVisualScreenTest } = await import('@/lib/ai/visual-screen-runner');

      // Build style/theme objects that mirror what the API route returns,
      // so NavbarPreviewFromUrl applies the generated theme correctly.
      const themeObj = screen.themeHint
        ? {
            designMood: screen.themeHint.designMood,
            colors: screen.themeHint.palette
              ? { light: screen.themeHint.palette.light, dark: screen.themeHint.palette.dark }
              : undefined,
            fonts: screen.themeHint.fonts,
          }
        : undefined;

      const result = await runVisualScreenTest({
        screen: screen as unknown as Record<string, unknown>,
        style: screen.themeHint?.designMood ?? null,
        theme: themeObj,
        visualAssert: { screenshot: true },
        screenshotsDir: tmpdir(),
        label: `qa-${pageName}-${Date.now()}`,
        prompt,
      });

      if (result.screenshotPath) {
        autoScreenshotPath = result.screenshotPath;
        console.log(`[pipeline] Screenshot captured: ${autoScreenshotPath}`);
      } else {
        console.warn('[pipeline] Screenshot step ran but no path returned, QA runs text-only');
      }
    } catch (e) {
      console.warn('[pipeline] Screenshot failed, QA runs text-only:', e instanceof Error ? e.message : e);
    }
  }

  // ── Step 5: QA Review loop (gpt-4o + vision) — up to 2 retries ───────────
  // Each retry: StructureAgent fixes issues → re-screenshot → re-run QA.
  // This creates a real visual feedback loop instead of a single blind retry.
  let qaReport: QAReport | undefined;
  let qaRetried = false;

  if (!skipQA) {
    const maxQaRetries = 2;

    for (let qaAttempt = 0; qaAttempt <= maxQaRetries; qaAttempt++) {
      const isRetry = qaAttempt > 0;

      // Re-capture screenshot after each StructureAgent fix so QA sees the actual new render
      if (isRetry && !skipScreenshot) {
        console.log(`[pipeline] Step 5.${qaAttempt} Re-screenshot after fix...`);
        try {
          const { runVisualScreenTest } = await import('@/lib/ai/visual-screen-runner');
          const themeObj = screen.themeHint
            ? {
                designMood: screen.themeHint.designMood,
                colors: screen.themeHint.palette
                  ? { light: screen.themeHint.palette.light, dark: screen.themeHint.palette.dark }
                  : undefined,
                fonts: screen.themeHint.fonts,
              }
            : undefined;
          const result = await runVisualScreenTest({
            screen: screen as unknown as Record<string, unknown>,
            style: screen.themeHint?.designMood ?? null,
            theme: themeObj,
            visualAssert: { screenshot: true },
            screenshotsDir: tmpdir(),
            label: `qa-retry${qaAttempt}-${pageName}-${Date.now()}`,
            prompt,
          });
          if (result.screenshotPath) {
            autoScreenshotPath = result.screenshotPath;
            console.log(`[pipeline] Re-screenshot: ${autoScreenshotPath}`);
          }
        } catch (e) {
          console.warn('[pipeline] Re-screenshot failed, QA runs with previous screenshot:', e instanceof Error ? e.message : e);
        }
      }

      console.log(`[pipeline] Step 5 QA Review (attempt ${qaAttempt + 1}/${maxQaRetries + 1})${autoScreenshotPath ? ' with screenshot' : ' text-only'}...`);
      try {
        qaReport = await runQAReviewerAgent(spec, brief, {
          screenshotPath: autoScreenshotPath,
          screenConfig: screen as unknown as Record<string, unknown>,
          passThreshold: qaPassThreshold,
        });

        console.log(`[pipeline] QA score: ${qaReport.score}/10 — ${qaReport.passed ? 'PASSED ✓' : 'FAILED'}`);

        if (qaReport.passed || qaAttempt === maxQaRetries) {
          // Passed or exhausted retries — stop
          if (!qaReport.passed) {
            console.log(`[pipeline] QA still failing after ${maxQaRetries} retries — shipping best available`);
          }
          break;
        }

        // QA failed and retries remain — fix and loop
        const issuesSummary = qaReport.issues.map(i => `[${i.severity ?? 'minor'}] ${i.section}: ${i.description}`).join('; ');
        console.log(`[pipeline] QA retry ${qaAttempt + 1} — ${qaReport.issues.length} issues: ${issuesSummary.slice(0, 200)}`);

        screen = await runStructureAgent(brief, content, palette, fontPairing, spec, {
          qaIssues: qaReport.issues.map(i => ({ ...i, severity: i.severity ?? 'minor' as const })),
        });
        qaRetried = true;
      } catch (e) {
        console.error('[pipeline] QA review failed, skipping:', e);
        break;
      }
    }
  }

  // ── Log final output ───────────────────────────────────────────────────────
  logAiResponse('page', { prompt, pageName }, screen as unknown, {
    source: 'api',
    page: pageName,
  });

  return { screen, spec, brief, content, qaReport, validatorRetries, qaRetried };
}
