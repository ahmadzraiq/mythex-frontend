/**
 * Training Loop — continuous improvement automation.
 *
 * Analyzes failures.json + pending-corrections.json and:
 *   1. Groups failures by category and pattern
 *   2. Auto-promotes patterns appearing 2+ times to corrections.json
 *   3. Flags patterns appearing 5+ times for promotion to lib/ai/section-library/ variants / design-principles.ts
 *   4. Outputs a training report
 *
 * Usage:
 *   npm run train
 *   npm run train -- --dry-run   (preview promotions without writing)
 *
 * Workflow lifecycle:
 *   Run eval → failures.json (raw failures)
 *     ↓ (pending-corrections.json — auto-populated by eval-ai.ts)
 *   Add correctedOutput manually → move to corrections.json
 *     ↓ (injected into all agent prompts via buildCorrectionsContext())
 *   Run eval again → measure improvement
 *     ↓ (if pattern appears ≥5 times and always passes after correction)
 *   training-loop.ts promotes to lib/ai/section-library/ variants / design-principles.ts
 *     ↓ (now part of agent training data permanently)
 *   Correction entry can be removed (reduces token cost)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const EVAL_DIR = join(ROOT, 'lib/ai/eval');
const FAILURES_FILE = join(EVAL_DIR, 'failures.json');
const PENDING_FILE = join(EVAL_DIR, 'pending-corrections.json');
const CORRECTIONS_FILE = join(EVAL_DIR, 'corrections.json');
const HISTORY_FILE = join(EVAL_DIR, 'eval-history.json');
const TRAINING_REPORT_FILE = join(EVAL_DIR, 'training-report.json');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Failure {
  id: string;
  generator: string;
  prompt?: string;
  error?: string;
  actual?: unknown;
  failedCheck?: string;
  category?: string;
}

interface PendingCorrection {
  id: string;
  generator: string;
  caseId: string;
  category: string;
  prompt?: string;
  wrongOutput?: unknown;
  correctedOutput?: unknown;
  failedCheck?: string;
  reason?: string;
  needsManualCorrection?: boolean;
  createdAt: string;
}

interface Correction {
  id: string;
  category: string;
  prompt: string;
  wrongOutput: unknown;
  correctedOutput: unknown;
  reason: string;
}

interface CorrectionsFile {
  page?: Correction[];
  navbar?: Correction[];
  layout?: Correction[];
  [key: string]: Correction[] | undefined;
}

interface PatternGroup {
  key: string;
  generator: string;
  category: string;
  count: number;
  examples: Array<{ caseId: string; error: string; prompt?: string; wrongOutput?: unknown }>;
  hasManualCorrections: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function extractPatternKey(error: string): string {
  // Normalize error message to a stable pattern key
  return error
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(the|a|an|is|are|was|were|has|have|had|for|in|on|at|to|of|and|or)\b/g, '')
    .trim()
    .slice(0, 80);
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

function analyzeFailures(): Map<string, PatternGroup> {
  const failures = readJson<Failure[]>(FAILURES_FILE, []);
  const pending = readJson<PendingCorrection[]>(PENDING_FILE, []);

  const groups = new Map<string, PatternGroup>();

  // Process failures
  for (const f of failures) {
    const errorText = f.error ?? f.failedCheck ?? 'unknown';
    const key = `${f.generator}::${extractPatternKey(errorText)}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        generator: f.generator,
        category: f.category ?? 'logic',
        count: 0,
        examples: [],
        hasManualCorrections: false,
      });
    }

    const group = groups.get(key)!;
    group.count++;
    if (group.examples.length < 3) {
      group.examples.push({
        caseId: f.id,
        error: errorText,
        prompt: f.prompt,
        wrongOutput: f.actual,
      });
    }
  }

  // Mark which patterns have pending corrections with manual correctedOutput
  for (const p of pending) {
    if (p.correctedOutput) {
      const key = `${p.generator}::${extractPatternKey(p.failedCheck ?? p.reason ?? '')}`;
      const group = groups.get(key);
      if (group) {
        group.hasManualCorrections = true;
      }
    }
  }

  return groups;
}

// ─── Promotions ───────────────────────────────────────────────────────────────

interface PromotionDecision {
  patternKey: string;
  generator: string;
  action: 'promote-to-corrections' | 'flag-for-examples' | 'monitor';
  count: number;
  reason: string;
}

function decidePromotions(groups: Map<string, PatternGroup>): PromotionDecision[] {
  const decisions: PromotionDecision[] = [];

  for (const [key, group] of groups) {
    if (group.count >= 5) {
      decisions.push({
        patternKey: key,
        generator: group.generator,
        action: 'flag-for-examples',
        count: group.count,
        reason: `Pattern appeared ${group.count} times — candidate for lib/ai/section-library/ variants or design-principles.ts promotion (manual review required)`,
      });
    } else if (group.count >= 2 && group.hasManualCorrections) {
      decisions.push({
        patternKey: key,
        generator: group.generator,
        action: 'promote-to-corrections',
        count: group.count,
        reason: `Pattern appeared ${group.count} times with manual correction available — promoting to corrections.json`,
      });
    } else {
      decisions.push({
        patternKey: key,
        generator: group.generator,
        action: 'monitor',
        count: group.count,
        reason: `Pattern appeared ${group.count} time(s) — monitoring (needs ${Math.max(0, 2 - group.count)} more occurrence${group.count < 2 ? 's' : ''} to promote)`,
      });
    }
  }

  return decisions.sort((a, b) => b.count - a.count);
}

// ─── Auto-promote to corrections.json ─────────────────────────────────────────

function promoteToCorrections(groups: Map<string, PatternGroup>): number {
  const pending = readJson<PendingCorrection[]>(PENDING_FILE, []);
  const corrections = readJson<CorrectionsFile>(CORRECTIONS_FILE, {});

  let promoted = 0;

  for (const [key, group] of groups) {
    if (group.count < 2 || !group.hasManualCorrections) continue;

    // Find pending corrections with manual correctedOutput for this pattern
    const matches = pending.filter(p => {
      const pKey = `${p.generator}::${extractPatternKey(p.failedCheck ?? p.reason ?? '')}`;
      return pKey === key && p.correctedOutput;
    });

    for (const match of matches) {
      const gen = match.generator as keyof CorrectionsFile;
      if (!corrections[gen]) corrections[gen] = [];

      const existing = corrections[gen]!;
      const alreadyExists = existing.some(c => c.id === match.id || c.id === `auto-promoted-${match.caseId}`);
      if (alreadyExists) continue;

      existing.push({
        id: `auto-promoted-${match.caseId}-${Date.now()}`,
        category: match.category,
        prompt: match.prompt ?? match.caseId,
        wrongOutput: match.wrongOutput ?? {},
        correctedOutput: match.correctedOutput!,
        reason: match.reason ?? match.failedCheck ?? 'Auto-promoted pattern',
      });

      promoted++;
      console.log(`  ✓ Promoted: ${match.caseId} → corrections.json["${gen}"]`);
    }
  }

  if (promoted > 0 && !DRY_RUN) {
    writeFileSync(CORRECTIONS_FILE, JSON.stringify(corrections, null, 2), 'utf8');
  }

  return promoted;
}

// ─── Pass rate trend ──────────────────────────────────────────────────────────

interface HistoryEntry {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

function analyzePassRateTrend(): { trend: 'improving' | 'declining' | 'stable'; recent: number; previous: number } | null {
  const history = readJson<HistoryEntry[]>(HISTORY_FILE, []);
  if (history.length < 2) return null;

  const recent = history.slice(-3).reduce((sum, h) => sum + h.passRate, 0) / Math.min(3, history.length);
  const previous = history.slice(-6, -3).reduce((sum, h) => sum + h.passRate, 0) / Math.min(3, history.slice(-6, -3).length);

  if (!previous) return null;

  const delta = recent - previous;
  return {
    trend: delta > 2 ? 'improving' : delta < -2 ? 'declining' : 'stable',
    recent: Math.round(recent * 10) / 10,
    previous: Math.round(previous * 10) / 10,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('🔁 Training Loop Analysis\n');
  if (DRY_RUN) console.log('  (DRY RUN — no files will be written)\n');

  // 1. Analyze failures
  const groups = analyzeFailures();
  console.log(`📊 Failure patterns found: ${groups.size}`);

  // 2. Decide promotions
  const decisions = decidePromotions(groups);

  const toPromote = decisions.filter(d => d.action === 'promote-to-corrections');
  const toFlag = decisions.filter(d => d.action === 'flag-for-examples');
  const toMonitor = decisions.filter(d => d.action === 'monitor');

  console.log(`  → ${toPromote.length} ready to promote to corrections.json`);
  console.log(`  → ${toFlag.length} flagged for section-library variants/design-principles (manual review)`);
  console.log(`  → ${toMonitor.length} monitoring (insufficient occurrences)\n`);

  // 3. Execute promotions
  let promoted = 0;
  if (toPromote.length > 0) {
    console.log('📥 Promoting to corrections.json:');
    promoted = DRY_RUN ? toPromote.length : promoteToCorrections(groups);
    if (DRY_RUN) {
      for (const d of toPromote) {
        console.log(`  (dry-run) Would promote: ${d.patternKey} (${d.count} occurrences)`);
      }
    }
  }

  // 4. Flag high-frequency patterns
  if (toFlag.length > 0) {
    console.log('\n⚠️  High-frequency patterns (manual review recommended):');
    for (const d of toFlag) {
      console.log(`  [${d.count}x] ${d.generator}: ${d.patternKey}`);
      console.log(`       → ${d.reason}`);
    }
  }

  // 5. Pass rate trend
  const trend = analyzePassRateTrend();
  if (trend) {
    const icon = trend.trend === 'improving' ? '📈' : trend.trend === 'declining' ? '📉' : '➡️';
    console.log(`\n${icon} Pass rate trend: ${trend.trend} (${trend.previous}% → ${trend.recent}%)`);
  }

  // 6. Write training report
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    patternsFound: groups.size,
    promotedToCorrections: promoted,
    flaggedForExamples: toFlag.map(d => ({ key: d.patternKey, count: d.count, reason: d.reason })),
    monitored: toMonitor.map(d => ({ key: d.patternKey, count: d.count })),
    passTrend: trend,
    nextSteps: [
      toFlag.length > 0 ? `Review ${toFlag.length} high-frequency patterns for lib/ai/section-library/ variants promotion` : null,
      toMonitor.length > 0 ? `${toMonitor.length} patterns need manual correctedOutput in pending-corrections.json` : null,
      'Run npm run eval:ai to measure improvement after corrections',
    ].filter(Boolean),
  };

  if (!DRY_RUN) {
    writeFileSync(TRAINING_REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n📄 Training report written to ${TRAINING_REPORT_FILE}`);
  }

  console.log('\n✅ Training loop complete.');
  if (toFlag.length > 0) {
    console.log('\nNext steps:');
    console.log('  1. Review flagged patterns above');
    console.log('  2. Add correctedOutput to pending-corrections.json entries');
    console.log('  3. Run npm run train again to promote them to corrections.json');
    console.log('  4. Run npm run eval:ai to measure improvement');
  }
}

main();
