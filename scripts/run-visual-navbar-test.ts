/**
 * CLI for visual navbar tests.
 * Run with: npm run test:visual-navbar
 * Run with case: npm run test:visual-navbar -- --case=add-node-valid-type
 * Run with custom props: npm run test:visual-navbar -- --props='{"overrides":{...},"visualAssert":{...}}'
 *
 * When using --case or default: calls AI with case prompt, then runs visual test on AI result.
 * Requires: dev server on localhost:3001, OPENAI_API_KEY for AI-based runs
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
import { runVisualNavbarTest } from '../lib/ai/visual-navbar-runner';
import type { VisualAssert } from '../lib/ai/visual-navbar-runner';
import { generateNavbarStructure } from '../lib/ai/generate-navbar-structure';
import { pickRandomNavbarTheme } from '../lib/ai/navbar-theme-picker';
import { schemaToScreen } from '../lib/ai/schema-to-screen';
import type { LayoutSchema } from '../config/schema/layout-schema';

type VisualTestProps = { overrides: Record<string, unknown>; visualAssert: VisualAssert };

function loadCases(): Array<Record<string, unknown>> {
  const path = join(process.cwd(), 'lib', 'ai', 'eval', 'navbar.json');
  const { cases } = JSON.parse(readFileSync(path, 'utf8')) as { cases: Array<Record<string, unknown>> };
  return cases;
}

function getPropsSync(): { caseData?: Record<string, unknown>; props?: VisualTestProps } {
  const propsArg = process.argv.find((a) => a.startsWith('--props='));
  if (propsArg) {
    try {
      const json = propsArg.slice('--props='.length);
      return { props: JSON.parse(json) as VisualTestProps };
    } catch {
      console.error('Invalid --props JSON');
      process.exit(1);
    }
  }

  const caseArg = process.argv.find((a) => a.startsWith('--case='));
  const caseId = caseArg?.slice('--case='.length);
  const cases = loadCases();
  const c = caseId ? cases.find((x) => x.id === caseId) : cases[0];
  if (!c) {
    console.error(caseId ? `Case "${caseId}" not found` : 'No cases in navbar.json');
    process.exit(1);
  }
  return { caseData: c };
}

async function main() {
  const { caseData, props } = getPropsSync();

  let overrides: Record<string, unknown>;
  let visualAssert: VisualAssert;

  if (props) {
    overrides = props.overrides;
    visualAssert = props.visualAssert;
  } else if (caseData) {
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY required for AI-based visual test. Set it in .env or use --props.');
      process.exit(1);
    }
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    process.env.AI_RESPONSES_FILE = join(process.cwd(), 'lib', 'ai', 'eval', `ai-responses-${ts}.jsonl`);
    const prompt = String(caseData.prompt ?? '');
    console.log(`Calling AI with prompt: "${prompt}"...`);
    const { structure } = await generateNavbarStructure(prompt);
    const themePick = pickRandomNavbarTheme();
    const layout: LayoutSchema = {
      pageType: 'homepage',
      style: themePick.style,
      sections: [
        { type: 'navbar' },
        { type: 'hero' },
        { type: 'product-grid', columns: 4, source: 'featured' },
        { type: 'feature-grid', items: 3 },
        { type: 'footer' },
      ],
      layoutParts: { navbar: { structure } },
    };
    const screen = schemaToScreen(layout);
    overrides = { screen, style: themePick.style, theme: { fonts: themePick.fonts } };
    visualAssert = (caseData.visualAssert as VisualAssert) ?? { check: 'navbarVisible' };
  } else {
    process.exit(1);
  }

  const result = await runVisualNavbarTest({ overrides, visualAssert });

  if (result.pass) {
    console.log('PASS: Visual assertions passed');
    process.exit(0);
  } else {
    console.error('FAIL:', result.error);
    process.exit(1);
  }
}

main();
