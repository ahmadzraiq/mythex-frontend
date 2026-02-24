/**
 * Capability Expansion Agent — agentic CLI loop.
 *
 * Reads recent JSONL failure logs, identifies capability gaps, applies fixes
 * directly to the codebase (validators, prompts, corrections, registry), and
 * verifies that each fix resolves the identified issue.
 *
 * How it works:
 *   1. Read last N JSONL log entries, extract failures and validator errors
 *   2. Use gpt-4o with tools (readFile, writeFile, searchCode) in an agentic loop
 *   3. Agent identifies gaps and writes targeted fixes
 *   4. Verifies fixes by running static validators on the previously-failed output
 *   5. Writes learned patterns to corrections.json
 *   6. Writes capability-gaps.json with a full report
 *
 * Review: run `git diff` after the script to inspect every change.
 * Nothing is committed until you approve.
 *
 * Usage:
 *   npm run capability-scan
 *   npm run capability-scan:dry-run
 *   npx tsx scripts/run-capability-scan.ts --limit 20
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
  return i !== -1 ? parseInt(process.argv[i + 1] ?? '30', 10) : 30;
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

interface CapabilityGap {
  type: 'missing-component' | 'missing-validator-rule' | 'repeated-prompt-mistake' | 'prompt-gap' | 'other';
  description: string;
  evidence: string;
  fixApplied: boolean;
  fixSummary?: string;
  filesChanged?: string[];
  verificationResult?: 'pass' | 'fail' | 'skipped';
}

interface ScanReport {
  generatedAt: string;
  dryRun: boolean;
  entriesAnalyzed: number;
  gapsFound: number;
  gapsFixed: number;
  correctionsAdded: number;
  gaps: CapabilityGap[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readRecentLogEntries(limit: number): AiLogEntry[] {
  if (!existsSync(EVAL_DIR)) return [];
  const jsonlFiles = readdirSync(EVAL_DIR)
    .filter(f => f.startsWith('ai-responses-') && f.endsWith('.jsonl'))
    .sort()
    .reverse()
    .slice(0, 3);

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

function extractFailureSignals(entries: AiLogEntry[]): string[] {
  const signals: string[] = [];
  for (const entry of entries) {
    if (entry.error) {
      signals.push(`[${entry.generator}] Error: ${entry.error}`);
    }
    if (entry.evalResult === 'FAIL') {
      signals.push(`[${entry.generator}] Eval FAIL — prompt: ${JSON.stringify(entry.input).slice(0, 200)}`);
    }
  }
  return signals;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

const agentTools = {
  readFile: tool({
    description: 'Read the full contents of a project file. Use relative paths from the project root.',
    inputSchema: z.object({
      path: z.string().describe('Relative path from project root, e.g. lib/ai/agents/structure-agent.ts'),
    }),
    execute: async ({ path }) => {
      const absPath = resolve(ROOT, path);
      if (!existsSync(absPath)) return `FILE NOT FOUND: ${path}`;
      try {
        return readFileSync(absPath, 'utf8');
      } catch (e) {
        return `Error reading ${path}: ${e}`;
      }
    },
  }),

  writeFile: tool({
    description: 'Write content to a project file. Creates parent directories as needed.',
    inputSchema: z.object({
      path: z.string().describe('Relative path from project root'),
      content: z.string().describe('Full file content to write'),
      reason: z.string().describe('Why this change is needed'),
    }),
    execute: async ({ path, content, reason }) => {
      if (DRY_RUN) return `[DRY RUN] Would write ${path} — reason: ${reason}`;
      const absPath = resolve(ROOT, path);
      const dir = dirname(absPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(absPath, content, 'utf8');
      return `Written: ${path} — ${reason}`;
    },
  }),

  listDirectory: tool({
    description: 'List files in a directory.',
    inputSchema: z.object({
      path: z.string().describe('Relative path from project root'),
    }),
    execute: async ({ path }) => {
      const absPath = resolve(ROOT, path);
      if (!existsSync(absPath)) return `Directory not found: ${path}`;
      try {
        return readdirSync(absPath).join('\n');
      } catch (e) {
        return `Error: ${e}`;
      }
    },
  }),

  searchCode: tool({
    description: 'Search for a pattern in project files using ripgrep.',
    inputSchema: z.object({
      pattern: z.string().describe('Regex or literal pattern to search for'),
      directory: z.string().optional().describe('Subdirectory to search in (default: whole project)'),
      fileGlob: z.string().optional().describe('File glob e.g. "*.ts"'),
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
    description: 'Run static SDUI validators on a JSON node tree string. Returns PASS or FAIL with error list.',
    inputSchema: z.object({
      nodeJson: z.string().describe('JSON string of the UiNode tree to validate'),
    }),
    execute: async ({ nodeJson }) => {
      try {
        const { validateTypes, validateActions, validateStatePaths, validateDesign } =
          await import('../lib/ai/validators/index.js');
        const node = JSON.parse(nodeJson);
        const results = [validateTypes(node), validateActions(node), validateStatePaths(node), validateDesign(node)];
        const errors = results.flatMap(r => r.errors ?? []);
        return errors.length === 0
          ? 'PASS — no validator errors'
          : `FAIL — ${errors.length} error(s):\n${errors.map(e => `  - ${e}`).join('\n')}`;
      } catch (e) {
        return `Validator error: ${e}`;
      }
    },
  }),

  runPipelineTest: tool({
    description: 'Run a full page generation via the live dev server and return the result with validator output. Use this to verify that a fix actually works end-to-end. Requires the dev server to be running (npm run dev).',
    inputSchema: z.object({
      prompt: z.string().describe('Short page description to test with, e.g. "A modern candle shop homepage"'),
      reason: z.string().describe('Why you are running this test — what fix are you verifying?'),
    }),
    execute: async ({ prompt, reason }) => {
      try {
        console.log(`\n  🧪 Testing pipeline: "${prompt.slice(0, 60)}"...`);
        const res = await fetch('http://localhost:300a/api/generate-page', {
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

  reportGap: tool({
    description: 'Report a capability gap that was found and optionally fixed.',
    inputSchema: z.object({
      type: z.enum(['missing-component', 'missing-validator-rule', 'repeated-prompt-mistake', 'prompt-gap', 'other']),
      description: z.string(),
      evidence: z.string(),
      fixApplied: z.boolean(),
      fixSummary: z.string().optional(),
      filesChanged: z.array(z.string()).optional(),
      verificationResult: z.enum(['pass', 'fail', 'skipped']).optional(),
    }),
    execute: async (gap) => {
      return `Gap recorded: ${gap.type} — ${gap.description}`;
    },
  }),
};

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Capability Expansion Agent for a JSON-driven SDUI system.

Your job: scan recent AI generation failures, identify root causes, and apply targeted fixes directly to the codebase.

WHAT YOU CAN FIX:
1. Missing SDUI components — if the AI uses a component type not registered in lib/sdui/component-registry.tsx
2. Missing validator rules — if the AI makes the same mistake repeatedly and no validator catches it
3. Repeated prompt mistakes — add corrections to lib/ai/eval/corrections.json
4. Prompt gaps — strengthen a rule in lib/ai/agents/structure-agent.ts or content-agent.ts

CODEBASE CONTEXT:
- SDUI component registry: lib/sdui/component-registry.tsx
- Static validators: lib/ai/validators/ (design-validator.ts, type-validator.ts, action-validator.ts, state-path-validator.ts)
- Structure agent prompt: lib/ai/agents/structure-agent.ts — buildSystemPrompt()
- Content agent: lib/ai/agents/content-agent.ts
- Corrections (injected into every agent call): lib/ai/eval/corrections.json
  Format: { "page": [{ id, category, prompt, wrongOutput, correctedOutput, reason }] }

RULES:
- Read relevant files before writing any fix
- Make surgical changes — change only what is needed
- After writing a prompt/correction fix, call runPipelineTest to verify end-to-end (dev server must be running on port 3000)
- After writing a validator/code fix, call runValidators on a relevant output to verify
- Report each gap with reportGap
- For corrections.json: NEVER duplicate an existing id. Check existing entries first.
- JSON files: no trailing commas, no comments
- TypeScript files: maintain existing code style

WORKFLOW:
1. Read corrections.json to understand what's already known
2. Read structure-agent.ts to understand current prompt rules
3. Read component-registry.tsx to see what components exist
4. Analyze the failure signals provided
5. For each gap: read → fix → verify → report
6. Summarize what was done`;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Capability Expansion Agent\n');
  if (DRY_RUN) console.log('  (DRY RUN — no files will be written)\n');

  console.log(`📂 Reading last ${LIMIT} log entries...`);
  const entries = readRecentLogEntries(LIMIT);
  console.log(`  → Found ${entries.length} entries`);

  const signals = extractFailureSignals(entries);
  console.log(`  → ${signals.length} failure signals identified`);

  const recentOutputsSample = entries
    .filter(e => e.generator === 'page')
    .slice(0, 5)
    .map(e => ({
      timestamp: e.timestamp,
      evalResult: e.evalResult,
      error: e.error,
      outputPreview: JSON.stringify(e.output ?? '').slice(0, 300),
    }));

  const userPrompt = `Analyze the following failure signals and recent outputs from our SDUI page generator pipeline.
Identify capability gaps and apply targeted fixes.

FAILURE SIGNALS (${signals.length} total):
${signals.length > 0 ? signals.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(No explicit failure signals — analyze recent outputs for quality issues)'}

RECENT PAGE OUTPUTS SAMPLE (${recentOutputsSample.length} entries):
${JSON.stringify(recentOutputsSample, null, 2)}

LOG STATISTICS:
- Total entries: ${entries.length}
- Generators: ${[...new Set(entries.map(e => e.generator))].join(', ')}
- Pass/Fail: ${entries.filter(e => e.evalResult === 'PASS').length} PASS, ${entries.filter(e => e.evalResult === 'FAIL').length} FAIL

START by reading corrections.json and structure-agent.ts to understand the current state.
Identify the top 3 capability gaps, apply fixes, and report each one.`;

  console.log('\n🤖 Running Capability Expansion Agent (gpt-4o)...\n');

  const gaps: CapabilityGap[] = [];
  const filesChanged = new Set<string>();
  let correctionsAdded = 0;

  try {
    const { text, steps } = await generateText({
      model: openai('gpt-4o'),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      tools: agentTools,
      stopWhen: stepCountIs(25),
      onStepFinish: ({ toolCalls, toolResults }) => {
        for (const call of toolCalls) {
          if ('toolName' in call) {
            if (call.toolName === 'writeFile') {
              const inp = call.input as { path: string; reason: string };
              console.log(`  ✏️  Writing: ${inp.path}`);
              filesChanged.add(inp.path);
              if (inp.path.includes('corrections.json')) correctionsAdded++;
            } else if (call.toolName === 'reportGap') {
              const gap = call.input as CapabilityGap;
              gaps.push(gap);
              const icon = gap.fixApplied ? '✅' : '⚠️ ';
              console.log(`  ${icon} Gap [${gap.type}]: ${gap.description}`);
            } else if (!['readFile', 'searchCode', 'listDirectory', 'runValidators'].includes(call.toolName as string)) {
              console.log(`  → ${call.toolName}(${JSON.stringify(call.input).slice(0, 80)})`);
            }
          }
        }
        for (const result of toolResults) {
          if ('output' in result && typeof result.output === 'string' && result.output.startsWith('Error')) {
            console.warn(`  ⚠️  Tool error: ${result.output.slice(0, 100)}`);
          }
        }
      },
    });

    console.log('\n📋 Agent summary:');
    console.log(text.slice(0, 800));
    if (text.length > 800) console.log(`  ... (${text.length - 800} more chars)`);

    const report: ScanReport = {
      generatedAt: new Date().toISOString(),
      dryRun: DRY_RUN,
      entriesAnalyzed: entries.length,
      gapsFound: gaps.length,
      gapsFixed: gaps.filter(g => g.fixApplied).length,
      correctionsAdded,
      gaps,
    };

    if (!DRY_RUN) {
      if (!existsSync(EVAL_DIR)) mkdirSync(EVAL_DIR, { recursive: true });
      writeFileSync(join(EVAL_DIR, 'capability-gaps.json'), JSON.stringify(report, null, 2), 'utf8');
    }

    console.log(`\n✅ Capability scan complete.`);
    console.log(`   Entries analyzed:  ${entries.length}`);
    console.log(`   Gaps found:        ${gaps.length}`);
    console.log(`   Gaps fixed:        ${gaps.filter(g => g.fixApplied).length}`);
    console.log(`   Files changed:     ${filesChanged.size}`);
    if (filesChanged.size > 0) console.log(`     → ${[...filesChanged].join(', ')}`);
    console.log(`   Corrections added: ${correctionsAdded}`);
    console.log(`   Steps used:        ${steps.length}`);
    if (!DRY_RUN && filesChanged.size > 0) {
      console.log(`\n   Report:           lib/ai/eval/capability-gaps.json`);
      console.log(`   Review changes:   git diff`);
    }

  } catch (e) {
    console.error('\n❌ Capability scan failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
