/**
 * CLI helper to add a correction to corrections.json.
 * Usage: npx ts-node scripts/add-correction.ts --generator=navbar --category=design --id=new-id
 *
 * Prompts for: prompt, wrongOutput (JSON), correctedOutput (JSON), reason
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

const EVAL_DIR = join(process.cwd(), 'lib', 'ai', 'eval');
const CORRECTIONS_PATH = join(EVAL_DIR, 'corrections.json');

type CorrectionCategory = 'schema' | 'design' | 'logic' | 'state' | 'syntax';

type CorrectionEntry = {
  id: string;
  category?: CorrectionCategory;
  prompt: string;
  wrongOutput?: unknown;
  correctedOutput?: unknown;
  reason: string;
  varyValues?: boolean;
};

function parseArgs(): { generator: string; category: CorrectionCategory; id: string } {
  const args = process.argv.slice(2);
  const generator = args.find((a) => a.startsWith('--generator='))?.split('=')[1] ?? 'navbar';
  const category = (args.find((a) => a.startsWith('--category='))?.split('=')[1] ?? 'schema') as CorrectionCategory;
  const id = args.find((a) => a.startsWith('--id='))?.split('=')[1] ?? `correction-${Date.now()}`;
  return { generator, category, id };
}

function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(q, (ans) => resolve(ans?.trim() ?? ''));
  });
}

function loadCorrections(): Record<string, CorrectionEntry[]> {
  if (!existsSync(CORRECTIONS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCorrections(data: Record<string, CorrectionEntry[]>) {
  writeFileSync(CORRECTIONS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  const { generator, category, id } = parseArgs();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`Adding correction to ${generator} (category: ${category}, id: ${id})\n`);

  const promptStr = await prompt(rl, 'prompt: ');
  if (!promptStr) {
    console.error('prompt is required');
    process.exit(1);
  }

  const wrongStr = await prompt(rl, 'wrongOutput (JSON, optional): ');
  let wrongOutput: unknown;
  try {
    wrongOutput = wrongStr ? JSON.parse(wrongStr) : undefined;
  } catch {
    console.error('Invalid JSON for wrongOutput');
    process.exit(1);
  }

  const correctStr = await prompt(rl, 'correctedOutput (JSON, optional): ');
  let correctedOutput: unknown;
  try {
    correctedOutput = correctStr ? JSON.parse(correctStr) : undefined;
  } catch {
    console.error('Invalid JSON for correctedOutput');
    process.exit(1);
  }

  const reason = await prompt(rl, 'reason: ');
  if (!reason) {
    console.error('reason is required');
    process.exit(1);
  }

  rl.close();

  const entry: CorrectionEntry = {
    id,
    category,
    prompt: promptStr,
    wrongOutput,
    correctedOutput,
    reason,
  };

  const corrections = loadCorrections();
  const list = corrections[generator] ?? [];
  const existing = list.findIndex((e) => e.id === id);
  if (existing >= 0) {
    list[existing] = entry;
  } else {
    list.push(entry);
  }
  corrections[generator] = list;
  saveCorrections(corrections);

  console.log(`\nSaved to ${CORRECTIONS_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
