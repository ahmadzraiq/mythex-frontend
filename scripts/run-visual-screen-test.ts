/**
 * CLI for full-page visual screen tests.
 * Run with: npm run test:visual-screen
 * Run with case: npm run test:visual-screen -- --case=luxury-homepage
 *
 * Calls generateLayout with the case prompt, converts to screen, and runs Playwright visual test.
 * Requires: dev server on localhost:3001, OPENAI_API_KEY
 */

import { readFileSync, existsSync } from 'fs';
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
import { schemaToScreen } from '../lib/ai/schema-to-screen';
import { runVisualScreenTest } from '../lib/ai/visual-screen-runner';
import type { ScreenVisualAssert } from '../lib/ai/visual-screen-runner';

function loadCases(): Array<Record<string, unknown>> {
  const path = join(process.cwd(), 'lib', 'ai', 'eval', 'layout.json');
  const { cases } = JSON.parse(readFileSync(path, 'utf8')) as { cases: Array<Record<string, unknown>> };
  return cases;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY required. Set it in .env or environment.');
    process.exit(1);
  }

  const caseArg = process.argv.find((a) => a.startsWith('--case='));
  const caseId = caseArg?.slice('--case='.length);
  const cases = loadCases().filter((c) => c.visualAssert);

  const c = caseId ? cases.find((x) => x.id === caseId) : cases[0];
  if (!c) {
    console.error(caseId ? `Case "${caseId}" not found or has no visualAssert` : 'No visual cases in layout.json');
    process.exit(1);
  }

  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  process.env.AI_RESPONSES_FILE = join(process.cwd(), 'lib', 'ai', 'eval', `ai-responses-${ts}.jsonl`);

  const prompt = String(c.prompt ?? '');
  console.log(`Generating layout for: "${prompt}"...`);

  const result = await generateLayout(prompt);
  const screen = schemaToScreen(result.layout) as Record<string, unknown>;
  const style = result.theme.style ?? null;
  const theme = result.theme as Record<string, unknown>;

  const visualAssert = (c.visualAssert as ScreenVisualAssert) ?? { check: 'pageVisible' };

  console.log('Running visual test...');
  const testResult = await runVisualScreenTest({ screen, style, theme, visualAssert });

  if (testResult.pass) {
    console.log('PASS: Visual assertions passed');
    process.exit(0);
  } else {
    console.error('FAIL:', testResult.error);
    process.exit(1);
  }
}

main();
