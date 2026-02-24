/**
 * Supervisor/Architect Agent — agentic CLI loop.
 *
 * Operates at the systemic level: reads all agent source files + recent failure
 * logs, identifies recurring architectural issues, applies targeted fixes, and
 * verifies that each fix improves the system's output quality.
 *
 * Difference from run-capability-scan.ts:
 *   - Capability scan focuses on individual gaps (missing component, one rule)
 *   - Supervisor looks across ALL agents and ALL recent runs to find patterns
 *     like "hero missing in 8/10 runs" or "price format broken every generation"
 *   - Supervisor reads agent SOURCE FILES and reasons about the whole pipeline
 *
 * How it works:
 *   1. Read all agent source files and recent JSONL logs
 *   2. Use gpt-4o with tools to identify systemic issues
 *   3. Apply fixes (prompt improvements, validator rules, correction entries)
 *   4. Verify each fix with static validators
 *   5. Write architect-report.md: what was auto-fixed + what needs human review
 *
 * Review: git diff + lib/ai/eval/architect-report.md
 * Nothing is committed until you approve.
 *
 * Usage:
 *   npm run supervisor
 *   npm run supervisor:dry-run
 *   npx tsx scripts/run-supervisor.ts --limit 50
 */

import { generateText, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const EVAL_DIR = join(ROOT, 'lib/ai/eval');
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 ? parseInt(process.argv[i + 1] ?? '50', 10) : 50;
})();

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiLogEntry {
  timestamp: string;
  generator: string;
  input: Record<string, unknown>;
  output: unknown;
  evalResult?: 'PASS' | 'FAIL' | null;
  error?: string;
}

interface SystemicIssue {
  pattern: string;
  frequency: number;
  affectedAgents: string[];
  fixType: 'prompt-rule' | 'validator-rule' | 'correction-entry' | 'code-change' | 'manual-review-needed';
  fixApplied: boolean;
  fixSummary?: string;
  filesChanged?: string[];
  verificationResult?: 'pass' | 'fail' | 'skipped';
  humanReviewReason?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeRead(path: string): string {
  const abs = resolve(ROOT, path);
  if (!existsSync(abs)) return '';
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

function safeReadJson<T>(path: string, fallback: T): T {
  const content = safeRead(path);
  if (!content) return fallback;
  try {
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

function readRecentLogEntries(limit: number): AiLogEntry[] {
  if (!existsSync(EVAL_DIR)) return [];
  const jsonlFiles = readdirSync(EVAL_DIR)
    .filter(f => f.startsWith('ai-responses-') && f.endsWith('.jsonl'))
    .sort()
    .reverse()
    .slice(0, 5);

  const entries: AiLogEntry[] = [];
  for (const file of jsonlFiles) {
    const raw = readFileSync(join(EVAL_DIR, file), 'utf8');
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        entries.push(JSON.parse(line) as AiLogEntry);
      } catch { /* skip */ }
    }
    if (entries.length >= limit) break;
  }
  return entries.slice(0, limit);
}

function analyzeErrorPatterns(entries: AiLogEntry[]): Map<string, number> {
  const patterns = new Map<string, number>();
  for (const e of entries) {
    if (e.error) {
      const key = e.error.slice(0, 80).toLowerCase().replace(/\s+/g, ' ');
      patterns.set(key, (patterns.get(key) ?? 0) + 1);
    }
    if (e.evalResult === 'FAIL') {
      const key = `eval-fail::${e.generator}`;
      patterns.set(key, (patterns.get(key) ?? 0) + 1);
    }
  }
  return patterns;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

const supervisorTools = {
  readFile: tool({
    description: 'Read the full contents of a project file.',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const abs = resolve(ROOT, path);
      if (!existsSync(abs)) return `FILE NOT FOUND: ${path}`;
      try {
        return readFileSync(abs, 'utf8');
      } catch (e) {
        return `Error: ${e}`;
      }
    },
  }),

  writeFile: tool({
    description: 'Write content to a project file. Pass the full new file content.',
    inputSchema: z.object({
      path: z.string(),
      content: z.string().describe('Full file content (complete new file — not a diff)'),
      reason: z.string().describe('Systemic issue this addresses and why this change fixes it'),
    }),
    execute: async ({ path, content, reason }) => {
      if (DRY_RUN) return `[DRY RUN] Would write ${path} — ${reason}`;
      const abs = resolve(ROOT, path);
      const dir = dirname(abs);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(abs, content, 'utf8');
      return `Written: ${path} — ${reason}`;
    },
  }),

  listDirectory: tool({
    description: 'List files in a directory.',
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => {
      const abs = resolve(ROOT, path);
      if (!existsSync(abs)) return `Not found: ${path}`;
      return readdirSync(abs).join('\n');
    },
  }),

  searchCode: tool({
    description: 'Search for a pattern across project files using ripgrep.',
    inputSchema: z.object({
      pattern: z.string(),
      directory: z.string().optional(),
      fileGlob: z.string().optional(),
    }),
    execute: async ({ pattern, directory, fileGlob }) => {
      try {
        const dir = directory ? resolve(ROOT, directory) : ROOT;
        const glob = fileGlob ? `--glob "${fileGlob}"` : '';
        const cmd = `rg --max-count 5 --line-number ${glob} "${pattern.replace(/"/g, '\\"')}" "${dir}" 2>&1 | head -30`;
        return execSync(cmd, { encoding: 'utf8' });
      } catch {
        return 'No matches found';
      }
    },
  }),

  runValidators: tool({
    description: 'Run static SDUI validators on a JSON node string.',
    inputSchema: z.object({ nodeJson: z.string() }),
    execute: async ({ nodeJson }) => {
      try {
        const { validateTypes, validateActions, validateStatePaths, validateDesign } =
          await import('../lib/ai/validators/index.js');
        const node = JSON.parse(nodeJson);
        const results = [validateTypes(node), validateActions(node), validateStatePaths(node), validateDesign(node)];
        const errors = results.flatMap(r => r.errors ?? []);
        return errors.length === 0 ? 'PASS' : `FAIL — ${errors.length} errors:\n${errors.map(e => `  - ${e}`).join('\n')}`;
      } catch (e) {
        return `Validator error: ${e}`;
      }
    },
  }),

  runPipelineTest: tool({
    description: 'Run a full page generation via the live dev server and return the result with validator output. Use this to verify that a fix actually works end-to-end before reporting it fixed. Requires the dev server to be running (npm run dev).',
    inputSchema: z.object({
      prompt: z.string().describe('Short page description to test with, e.g. "A modern candle shop homepage"'),
      reason: z.string().describe('Why you are running this test — what fix are you verifying?'),
    }),
    execute: async ({ prompt, reason }) => {
      try {
        console.log(`\n  🧪 Testing pipeline: "${prompt.slice(0, 60)}"...`);
        const res = await fetch('http://localhost:3001/api/generate-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, pageName: 'home' }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          const text = await res.text();
          return `Pipeline error ${res.status}: ${text.slice(0, 300)}`;
        }
        const data = await res.json() as { screen?: { content?: unknown; layoutParts?: unknown }; error?: string };
        if (data.error) return `Pipeline error: ${data.error}`;

        const { validateTypes, validateActions, validateStatePaths, validateDesign } =
          await import('../lib/ai/validators/index.js');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type AnyNode = any;
        const results: string[] = [];
        const content = data.screen?.content as AnyNode;
        const layoutParts = data.screen?.layoutParts as Record<string, AnyNode> | undefined;

        if (content) {
          const errs = [validateTypes(content), validateActions(content), validateStatePaths(content), validateDesign(content)]
            .flatMap(r => r.errors ?? []);
          results.push(`content: ${errs.length === 0 ? 'PASS' : `FAIL (${errs.length} errors): ${errs.slice(0, 3).join('; ')}`}`);
        }
        if (layoutParts?.navbar) {
          const errs = [validateTypes(layoutParts.navbar), validateDesign(layoutParts.navbar)]
            .flatMap(r => r.errors ?? []);
          results.push(`navbar: ${errs.length === 0 ? 'PASS' : `FAIL: ${errs.slice(0, 2).join('; ')}`}`);
        } else {
          results.push('navbar: MISSING');
        }
        if (layoutParts?.footer) {
          const errs = [validateTypes(layoutParts.footer), validateDesign(layoutParts.footer)]
            .flatMap(r => r.errors ?? []);
          results.push(`footer: ${errs.length === 0 ? 'PASS' : `FAIL: ${errs.slice(0, 2).join('; ')}`}`);
        } else {
          results.push('footer: MISSING');
        }

        return `Pipeline test result (reason: ${reason}):\n${results.join('\n')}\nContent preview: ${JSON.stringify(content).slice(0, 400)}`;
      } catch (e) {
        return `Pipeline test failed: ${e instanceof Error ? e.message : e}`;
      }
    },
  }),

  reportIssue: tool({
    description: 'Report a systemic issue that was identified — whether fixed or not.',
    inputSchema: z.object({
      pattern: z.string().describe('Short description of the recurring pattern'),
      frequency: z.number().describe('How many times this appeared (estimate if needed)'),
      affectedAgents: z.array(z.string()),
      fixType: z.enum(['prompt-rule', 'validator-rule', 'correction-entry', 'code-change', 'manual-review-needed']),
      fixApplied: z.boolean(),
      fixSummary: z.string().optional(),
      filesChanged: z.array(z.string()).optional(),
      verificationResult: z.enum(['pass', 'fail', 'skipped']).optional(),
      humanReviewReason: z.string().optional(),
    }),
    execute: async (issue) => {
      return `Issue recorded: ${issue.pattern}`;
    },
  }),
};

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Supervisor/Architect Agent for a JSON-driven SDUI multi-agent AI system.

You think at the SYSTEMIC level. Your job is to find recurring patterns across all recent AI generations and fix the root causes — not one-off bugs, but architectural issues.

THE PIPELINE (understand it fully):
1. DesignDirectorAgent (gpt-4o) → creative DesignSpec
2. BriefAgent (gpt-4o-mini) → structured DesignBrief
3. ContentAgent (gpt-4o) → brand copy + industry-appropriate product/category names
4. StructureAgent (gpt-4o) → full SDUI page (content + navbar + footer in layoutParts)
   → up to 2 validator retries on content tree
5. Screenshot via Playwright
6. QAReviewerAgent (gpt-4o + vision) → score/10, 1 redesign if fails

WHAT YOU CAN FIX (in priority order):
1. CORRECTION ENTRIES (fastest impact): Add to lib/ai/eval/corrections.json — injected into every StructureAgent call
2. PROMPT RULES: Strengthen rules in lib/ai/agents/structure-agent.ts or content-agent.ts
3. VALIDATOR RULES: Add to lib/ai/validators/design-validator.ts, type-validator.ts, etc.
4. CODE CHANGES: Fix lib/sdui/ utilities (computed-runner.ts, utils.ts, renderer.tsx)
5. MANUAL REVIEW NEEDED: Document issues requiring human judgment

BEFORE MAKING ANY FIX:
- Read the current state of the file you plan to change
- Read corrections.json to avoid duplicating existing entries
- Make the MINIMAL change that addresses the root cause

VERIFICATION (in priority order):
1. After PROMPT or CORRECTION fixes: call runPipelineTest to verify end-to-end (the dev server must be running on port 3000)
2. After VALIDATOR or CODE fixes: call runValidators with a representative output from the logs
3. If verification fails, note it in the report but do NOT revert — the human will review
4. runPipelineTest calls the live /api/generate-page endpoint and checks content + navbar + footer validation

WHAT TO LOOK FOR:
- Same validator error appearing in multiple runs
- AI generating the same wrong pattern repeatedly
- Quality issues that validators don't catch
- Missing initActions for mapped data
- Wrong product/category field names
- Layout issues (hero placement, responsive classes)

At the end, write lib/ai/eval/architect-report.md with:
- ## Summary (3-5 key findings)
- ## Fixed Issues (what was auto-fixed, with file paths)
- ## Manual Review Required (what needs human judgment, with analysis)
- ## Recommendations (what the team should prioritize next)`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏗️  Supervisor/Architect Agent\n');
  if (DRY_RUN) console.log('  (DRY RUN — no files will be written)\n');

  console.log(`📂 Loading context (last ${LIMIT} log entries + agent source files)...`);
  const entries = readRecentLogEntries(LIMIT);
  const errorPatterns = analyzeErrorPatterns(entries);

  const corrections = safeReadJson(join(EVAL_DIR, 'corrections.json'), {});
  const pending = safeReadJson<unknown[]>(join(EVAL_DIR, 'pending-corrections.json'), []);
  const evalHistory = safeReadJson<unknown[]>(join(EVAL_DIR, 'eval-history.json'), []);

  console.log(`  → ${entries.length} log entries, ${errorPatterns.size} error patterns`);

  const stats = {
    totalEntries: entries.length,
    byGenerator: {} as Record<string, { total: number; fails: number; passes: number }>,
    topErrors: [...errorPatterns.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count })),
    evalHistory: evalHistory.slice(-5),
  };

  for (const e of entries) {
    if (!stats.byGenerator[e.generator]) {
      stats.byGenerator[e.generator] = { total: 0, fails: 0, passes: 0 };
    }
    stats.byGenerator[e.generator].total++;
    if (e.evalResult === 'FAIL') stats.byGenerator[e.generator].fails++;
    if (e.evalResult === 'PASS') stats.byGenerator[e.generator].passes++;
  }

  const recentPageOutputs = entries
    .filter(e => e.generator === 'page')
    .slice(0, 3)
    .map(e => ({
      timestamp: e.timestamp,
      evalResult: e.evalResult,
      error: e.error,
      outputPreview: JSON.stringify(e.output ?? '').slice(0, 800),
    }));

  const userPrompt = `Perform a systemic architectural analysis of our SDUI page generator pipeline.

PIPELINE STATISTICS:
${JSON.stringify(stats, null, 2)}

TOP ERROR PATTERNS (by frequency):
${stats.topErrors.map(p => `  [${p.count}x] ${p.pattern}`).join('\n') || '  (no errors recorded)'}

RECENT PAGE OUTPUTS (${recentPageOutputs.length} samples):
${JSON.stringify(recentPageOutputs, null, 2)}

PENDING CORRECTIONS COUNT: ${Array.isArray(pending) ? pending.length : 0}

EXISTING CORRECTIONS SUMMARY:
${Object.entries(corrections).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.length : 0} entries`).join('\n') || '  (none)'}

INSTRUCTIONS:
1. Read the agent source files to understand current state:
   - lib/ai/agents/structure-agent.ts (the most critical prompt)
   - lib/ai/agents/content-agent.ts
   - lib/ai/eval/corrections.json
   - lib/ai/validators/design-validator.ts

2. Identify the top 3-5 SYSTEMIC issues (recurring across multiple runs)

3. For each issue: apply a fix AND call reportIssue

4. Write lib/ai/eval/architect-report.md with your full analysis

Focus on issues with HIGHEST FREQUENCY and MOST IMPACT on output quality.`;

  console.log('\n🤖 Running Supervisor Agent (gpt-4o)...\n');

  const issues: SystemicIssue[] = [];
  const filesChanged = new Set<string>();

  try {
    const { text, steps } = await generateText({
      model: openai('gpt-4o'),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      tools: supervisorTools,
      stopWhen: stepCountIs(30),
      onStepFinish: ({ toolCalls, toolResults }) => {
        for (const call of toolCalls) {
          if ('toolName' in call) {
            if (call.toolName === 'writeFile') {
              const inp = call.input as { path: string; reason: string };
              console.log(`  ✏️  Writing: ${inp.path}`);
              filesChanged.add(inp.path);
            } else if (call.toolName === 'reportIssue') {
              const issue = call.input as SystemicIssue;
              issues.push(issue);
              const icon = issue.fixApplied ? '✅' : issue.fixType === 'manual-review-needed' ? '⚠️ ' : '🔍';
              console.log(`  ${icon} [${issue.frequency}x] ${issue.pattern}`);
              if (issue.fixSummary) console.log(`      → ${issue.fixSummary.slice(0, 100)}`);
            } else if (!['readFile', 'listDirectory'].includes(call.toolName as string)) {
              console.log(`  → ${call.toolName}(${JSON.stringify(call.input).slice(0, 80)})`);
            }
          }
        }
        for (const result of toolResults) {
          if ('output' in result && typeof result.output === 'string' && result.output.startsWith('Error')) {
            console.warn(`  ⚠️  ${result.output.slice(0, 100)}`);
          }
        }
      },
    });

    // If the agent didn't write the report file itself, write the final text as the report
    const reportPath = join(EVAL_DIR, 'architect-report.md');
    if (!existsSync(reportPath) && !DRY_RUN) {
      const report = `# Architect Report — ${new Date().toISOString().slice(0, 10)}\n\n${text}`;
      writeFileSync(reportPath, report, 'utf8');
    }
    if (existsSync(reportPath)) {
      console.log('\n📋 Architect report written to lib/ai/eval/architect-report.md');
    }

    const fixed = issues.filter(i => i.fixApplied);
    const needsHuman = issues.filter(i => i.fixType === 'manual-review-needed');

    console.log(`\n✅ Supervisor analysis complete.`);
    console.log(`   Entries analyzed:      ${entries.length}`);
    console.log(`   Systemic issues found: ${issues.length}`);
    console.log(`   Auto-fixed:            ${fixed.length}`);
    console.log(`   Manual review needed:  ${needsHuman.length}`);
    console.log(`   Files changed:         ${filesChanged.size}`);
    if (filesChanged.size > 0) {
      console.log(`     → ${[...filesChanged].join('\n     → ')}`);
    }
    console.log(`   Steps used:            ${steps.length}`);

    if (!DRY_RUN && filesChanged.size > 0) {
      console.log(`\n   Review all changes: git diff`);
      console.log(`   Full analysis:      lib/ai/eval/architect-report.md`);
    }

    if (needsHuman.length > 0) {
      console.log('\n⚠️  Issues requiring your review:');
      for (const issue of needsHuman) {
        console.log(`   - ${issue.pattern}`);
        if (issue.humanReviewReason) console.log(`     Reason: ${issue.humanReviewReason}`);
      }
    }

  } catch (e) {
    console.error('\n❌ Supervisor agent failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
