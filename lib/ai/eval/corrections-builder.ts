/**
 * Builds correction context from lib/ai/eval/corrections.json for injection into prompts.
 * When the model makes mistakes, add entries here; they are shown as "FIXES (avoid these mistakes)".
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

type CorrectionEntry = {
  id: string;
  prompt: string;
  wrongOutput?: string;
  correctedOutput?: unknown;
  reason: string;
  varyValues?: boolean;
};

type CorrectionsFile = Record<string, CorrectionEntry[]>;

const CORRECTIONS_PATH = join(process.cwd(), 'lib', 'ai', 'eval', 'corrections.json');

function loadCorrections(): CorrectionsFile {
  if (!existsSync(CORRECTIONS_PATH)) return {};
  try {
    const raw = readFileSync(CORRECTIONS_PATH, 'utf8');
    return JSON.parse(raw) as CorrectionsFile;
  } catch {
    return {};
  }
}

/**
 * Build a "FIXES" section for the given generator's prompt.
 * Returns empty string if no corrections exist.
 */
export function buildCorrectionsContext(generator: string): string {
  const corrections = loadCorrections();
  const entries = corrections[generator];
  if (!entries?.length) return '';

  const lines = entries.map((e) => {
    const parts = [`- "${e.prompt}" → ${e.reason}`];
    if (e.wrongOutput) parts.push(`  Wrong: ${e.wrongOutput}`);
    if (e.correctedOutput) parts.push(`  Correct: ${JSON.stringify(e.correctedOutput)}`);
    if (e.varyValues) parts.push(`  Vary label and color; examples above are samples only.`);
    return parts.join('\n');
  });

  return `\nFIXES (avoid these mistakes):\n${lines.join('\n')}\n`;
}
