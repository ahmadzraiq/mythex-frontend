/**
 * AI evaluation script - runs test cases against all generators.
 * Requires OPENAI_API_KEY. Logs to lib/ai/eval/ai-responses.jsonl.
 * Writes failures to lib/ai/eval/failures.json.
 * Loads .env from project root if present.
 *
 * Flags (to avoid re-testing passed cases and save API cost):
 *   --only-failures   Re-run only cases from failures.json (uses cached AI output, no API calls)
 *   --generator=NAME  Run only this generator (navbar, layout, palettes, font-pairings, variant-suggestions)
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

import { generateNavbarStructure } from '../lib/ai/generate-navbar-structure';
import { generateLayout } from '../lib/ai/layout-generator';
import { generatePalettes } from '../lib/ai/generate-palettes';
import { generateFontPairings } from '../lib/ai/generate-font-pairings';
import { generateVariantSuggestions } from '../lib/ai/generate-variant-suggestions';
import { logAiResponse } from '../lib/ai/response-logger';
import { navbarGeneratorOutputSchema } from '../config/schema/layout-schema';
import { fullGenerationSchema } from '../config/schema/layout-schema';
import { palettesResponseSchema } from '../lib/ai/palette-schema';
import { fontPairingsResponseSchema } from '../lib/ai/font-pairing-schema';
import { ALLOWED_SDUI_TYPES } from '../config/schema/layout-schema';
import { runVisualNavbarTest, type VisualAssert } from '../lib/ai/visual-navbar-runner';

const EVAL_DIR = join(process.cwd(), 'lib', 'ai', 'eval');
const FAILURES_FILE = join(EVAL_DIR, 'failures.json');

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
const GENERATOR_FILTER = ARGS.find((a) => a.startsWith('--generator='))?.split('=')[1] ?? 'navbar';
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

function validateNavbarStructure(
  output: Record<string, unknown>
): { ok: boolean; error?: string } {
  const parsed = navbarGeneratorOutputSchema.safeParse(output);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true };
}

async function runNavbarCase(
  c: Record<string, unknown>,
  cachedOutput?: Record<string, unknown>,
  generatorName?: string
): Promise<{ pass: boolean; actual?: unknown; error?: string }> {
  const gen = generatorName ?? 'navbar';
  const prompt = String(c.prompt ?? '');
  const expected = c.expected as Record<string, unknown> | undefined;
  const match = c.match as string;
  const assert = c.assert as Record<string, unknown> | undefined;

  try {
    let output: Record<string, unknown>;
    if (cachedOutput) {
      output = { ...cachedOutput };
    } else {
      const result = await generateNavbarStructure(prompt);
      output = { structure: result.structure };
    }

    const validateResult = validateNavbarStructure(output);
    if (!validateResult.ok) {
      logAiResponse(gen, { prompt }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: validateResult.error,
      });
      return { pass: false, actual: output, error: validateResult.error };
    }

    if (match === 'exact' && expected) {
      const ok = jsonNormalize(output) === jsonNormalize(expected);
      if (!ok) {
        logAiResponse(gen, { prompt }, output, {
          source: 'eval',
          evalResult: 'FAIL',
          error: 'Output did not match expected',
        });
        return { pass: false, actual: output, error: 'Output did not match expected' };
      }
    }

    if (assert?.noInvalidTypes && output.structure) {
      function checkTypes(node: unknown): string | null {
        if (!node || typeof node !== 'object') return null;
        const n = node as Record<string, unknown>;
        const type = n.type;
        if (type && typeof type === 'string' && !ALLOWED_SDUI_TYPES.includes(type as (typeof ALLOWED_SDUI_TYPES)[number])) {
          return type;
        }
        const children = n.children;
        if (Array.isArray(children)) {
          for (const ch of children) {
            const invalid = checkTypes(ch);
            if (invalid) return invalid;
          }
        }
        return null;
      }
      const invalid = checkTypes(output.structure);
      if (invalid) {
        logAiResponse(gen, { prompt }, output, {
          source: 'eval',
          evalResult: 'FAIL',
          error: `Invalid type: ${invalid}`,
        });
        return { pass: false, actual: output, error: `Invalid type: ${invalid}` };
      }
    }

    const visualAssert = c.visualAssert as VisualAssert | undefined;
    const visualTest = c.visualTest as { fallback?: string } | undefined;
    const assertToUse = visualAssert ?? (visualTest?.fallback === 'navbarVisible' ? { check: 'navbarVisible' as const } : { check: 'navbarVisible' as const });

    const caseId = String(c.id ?? 'unknown');
    console.log(`    [visual] Running visual test for ${caseId}...`);
    const visualResult = await runVisualNavbarTest({
      overrides: output,
      visualAssert: assertToUse,
    });
    if (!visualResult.pass) {
      logAiResponse(gen, { prompt }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: visualResult.error,
      });
      return { pass: false, actual: output, error: visualResult.error };
    }

    logAiResponse(gen, { prompt }, output, {
      source: 'eval',
      evalResult: 'PASS',
    });
    return { pass: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logAiResponse(gen, { prompt }, null, {
      source: 'eval',
      evalResult: 'FAIL',
      error: err,
    });
    return { pass: false, error: err };
  }
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

    const parsed = fullGenerationSchema.safeParse({ layout: result.layout, theme: result.theme });
    if (!parsed.success) {
      logAiResponse('layout', { prompt }, output, {
        source: 'eval',
        evalResult: 'FAIL',
        error: parsed.error.message,
      });
      return { pass: false, actual: output, error: parsed.error.message };
    }
    logAiResponse('layout', { prompt }, output, { source: 'eval', evalResult: 'PASS' });
    return { pass: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    logAiResponse('layout', { prompt }, null, {
      source: 'eval',
      evalResult: 'FAIL',
      error: err,
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
      : { palettes: await generatePalettes(designMood, mode) };

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

async function runVariantSuggestionsCase(
  c: Record<string, unknown>,
  cachedOutput?: Record<string, unknown>
): Promise<{ pass: boolean; actual?: unknown; error?: string }> {
  const designMood = String(c.designMood ?? 'modern');

  try {
    const output = cachedOutput
      ? { ...cachedOutput }
      : { suggestions: await generateVariantSuggestions(designMood) };

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
  { generator: 'navbar', filename: 'navbar.json', runner: runNavbarCase },
  { generator: 'layout', filename: 'layout.json', runner: runLayoutCase },
  { generator: 'palettes', filename: 'palettes.json', runner: runPalettesCase },
  { generator: 'font-pairings', filename: 'font-pairings.json', runner: runFontPairingsCase },
  { generator: 'variant-suggestions', filename: 'variant-suggestions.json', runner: runVariantSuggestionsCase },
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

  console.log('\n--- Summary ---');
  console.log(`${passed}/${total} passed`);

  if (ONLY_FAILURES && failures.length === 0) {
    console.log('All previously failed cases now pass.');
  }

  writeFileSync(FAILURES_FILE, JSON.stringify(failures, null, 2), 'utf8');
  console.log(`Failures written to ${FAILURES_FILE}`);
  console.log(`Responses logged to ${AI_RESPONSES_FILE}`);

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
