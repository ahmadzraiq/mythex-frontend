/**
 * Builds correction context from lib/ai/eval/corrections.json for injection into prompts.
 * When the model makes mistakes, add entries here; they are shown as "FIXES (avoid these mistakes)".
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export type CorrectionCategory = 'schema' | 'design' | 'logic' | 'state' | 'syntax';

type CorrectionEntry = {
  id: string;
  category?: CorrectionCategory;
  prompt: string;
  wrongOutput?: unknown;
  correctedOutput?: unknown;
  reason: string;
  varyValues?: boolean;
};

type CorrectionsFile = Record<string, CorrectionEntry[]>;

const CORRECTIONS_PATH = join(process.cwd(), 'lib', 'ai', 'eval', 'corrections.json');

const CATEGORY_ORDER: CorrectionCategory[] = ['schema', 'design', 'logic', 'state', 'syntax'];
const CATEGORY_LABELS: Record<CorrectionCategory, string> = {
  schema: 'SCHEMA FIXES',
  design: 'DESIGN FIXES',
  logic: 'LOGIC FIXES',
  state: 'STATE FIXES',
  syntax: 'SYNTAX FIXES',
};

function loadCorrections(): CorrectionsFile {
  if (!existsSync(CORRECTIONS_PATH)) return {};
  try {
    const raw = readFileSync(CORRECTIONS_PATH, 'utf8');
    return JSON.parse(raw) as CorrectionsFile;
  } catch {
    return {};
  }
}

function formatCorrection(e: CorrectionEntry): string {
  const parts = [`- "${e.prompt}" → ${e.reason}`];
  if (e.wrongOutput) parts.push(`  Wrong: ${JSON.stringify(e.wrongOutput)}`);
  if (e.correctedOutput) parts.push(`  Correct: ${JSON.stringify(e.correctedOutput)}`);
  if (e.varyValues) parts.push(`  Vary label and color; examples above are samples only.`);
  return parts.join('\n');
}

/**
 * Build a "FIXES" section for the given generator's prompt.
 * Groups corrections by category (SCHEMA, DESIGN, LOGIC, STATE, SYNTAX) in priority order.
 * Returns empty string if no corrections exist.
 */
export function buildCorrectionsContext(generator: string): string {
  const corrections = loadCorrections();
  const entries = corrections[generator];
  if (!entries?.length) return '';

  const byCategory = new Map<CorrectionCategory, CorrectionEntry[]>();
  const uncategorized: CorrectionEntry[] = [];

  for (const e of entries) {
    const cat = e.category;
    if (cat && CATEGORY_ORDER.includes(cat)) {
      const list = byCategory.get(cat) ?? [];
      list.push(e);
      byCategory.set(cat, list);
    } else {
      uncategorized.push(e);
    }
  }

  const sections: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    const list = byCategory.get(cat);
    if (list?.length) {
      const label = CATEGORY_LABELS[cat];
      const lines = list.map(formatCorrection).join('\n');
      sections.push(`${label}:\n${lines}`);
    }
  }
  if (uncategorized.length) {
    sections.push(`OTHER FIXES:\n${uncategorized.map(formatCorrection).join('\n')}`);
  }

  return `\nFIXES (avoid these mistakes):\n${sections.join('\n\n')}\n`;
}
