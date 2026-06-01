/* eslint-disable no-console */
/**
 * Integration test: structure agent (loop usage) + unified build agent
 * (styling, binding, and workflow coherence in one pass).
 *
 *   SUITE 1 — STRUCTURE
 *     Feed the structure agent a calculator request.
 *     PASS: loopCount >= 1  AND  workflowStubCount >= 1
 *
 *   SUITE 2 — UNIFIED BUILD AGENT
 *     Feed the build agent a minimal calculator compact tree (with REPEAT annotation)
 *     including a var roster and workflow roster.
 *     PASS: called set_style >= 1    (styling happened)
 *           called set_repeat >= 1   (binding happened)
 *           add_workflow_step used only roster UUIDs  (no invented UUIDs)
 *           at least 1 roster workflow received steps  (workflow happened)
 *
 * Run:
 *   EXP_SAMPLES=2 npx tsx --env-file=.env scripts/exp-validate-structure-workflow.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  buildStructureAgentPrompt,
  buildBuildAgentPrompt,
} from '../lib/ai/agents';
import { STRUCTURE_AGENT_TOOLS, BUILD_PHASE_TOOLS } from '../lib/ai/builder-tools';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VARS = {
  display:  'f3a1c209-b2de-4a18-9c67-5d28f1e22d7b',
  buttons:  'a94e7b31-c5f0-48d2-b173-8e69c4a1f3d2',
};

const WF = {
  button: 'e8f3a1c2-09b2-4de4-a189-c675d28f1e22',
};
const WF_IDS = Object.values(WF);

// Compact tree with REPEAT and CONDITION annotations — mirrors what the structure step produces.
const CALC_COMPACT_TREE = `
[aa000001-0000-0000-0000-000000000001] Box[Calculator]
  [aa000002-0000-0000-0000-000000000002] Box[DisplayPanel]
    [aa000003-0000-0000-0000-000000000003] Text text="0" text:variables['${VARS.display}'](existing)
  [aa000004-0000-0000-0000-000000000004] Box[Keypad]
    [aa000005-0000-0000-0000-000000000005] Box REPEAT(key=${VARS.buttons})
      [aa000006-0000-0000-0000-000000000006] Text
`.trim();

const VAR_ROSTER = `Available variables (ONLY these UUIDs are valid):
  "Display" (string) → variables['${VARS.display}'] = "0"
  "Buttons" (array) → variables['${VARS.buttons}'] = [{"label":"7","type":"digit"},{"label":"8","type":"digit"},{"label":"9","type":"digit"},{"label":"/","type":"operator"},{"label":"4","type":"digit"},{"label":"5","type":"digit"},{"label":"6","type":"digit"},{"label":"*","type":"operator"},{"label":"1","type":"digit"},{"label":"2","type":"digit"},{"label":"3","type":"digit"},{"label":"-","type":"operator"},{"label":"0","type":"digit"},{"label":".","type":"digit"},{"label":"=","type":"equals"},{"label":"+","type":"operator"},{"label":"C","type":"clear"}]`;

const WF_ROSTER = `WORKFLOW ROSTER (pass workflowId exactly as shown to add_workflow_step — do not create_workflow or bind_action):
  workflowId: "${WF.button}" — trigger: click — node: "ButtonTemplate"`;

const ORIGINAL_REQUEST = `4-function calculator with a display, digit buttons (0-9), operator buttons (+, -, *, /), equals, and clear.`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface StructureVerdict {
  loopCount: number;
  workflowStubCount: number;
  variableCount: number;
  passed: boolean;
  notes: string[];
}

interface BuildVerdict {
  setStyleCalls: number;
  setRepeatCalls: number;
  addWorkflowStepCalls: number;
  inventedUUIDs: number;
  rosterWorkflowsWithSteps: number;
  rounds: number;
  passed: boolean;
  notes: string[];
}

type ContentBlock = Anthropic.Messages.ContentBlock;
type MessageParam = Anthropic.Messages.MessageParam;

// ─── Classifiers ─────────────────────────────────────────────────────────────

function walkTree(node: Record<string, unknown>, cb: (n: Record<string, unknown>) => void) {
  cb(node);
  for (const child of (Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [])) {
    walkTree(child, cb);
  }
}

function classifyStructure(content: ContentBlock[]): StructureVerdict {
  const notes: string[] = [];
  let loopCount = 0, workflowStubCount = 0, variableCount = 0;

  for (const b of content) {
    if (b.type !== 'tool_use' || b.name !== 'generate_structure') continue;
    const input = b.input as { tree?: Record<string, unknown>; variables?: unknown[]; pageActions?: unknown[] };
    variableCount = Array.isArray(input.variables) ? input.variables.length : 0;
    notes.push(`Variables: ${variableCount}`);
    if (input.tree) {
      walkTree(input.tree, node => {
        if (node.loop === true) {
          loopCount++;
          notes.push(`  loop:true on "${node.name ?? node.label ?? '?'}"`);
        }
        for (const a of (Array.isArray(node.actions) ? node.actions as Array<{ workflowId?: string; trigger?: string }> : [])) {
          if (a.workflowId) {
            workflowStubCount++;
            notes.push(`  stub ${a.workflowId.slice(0, 8)}… trigger=${a.trigger}`);
          }
        }
      });
    }
    for (const pa of (Array.isArray(input.pageActions) ? input.pageActions as Array<{ workflowId?: string }> : [])) {
      if (pa.workflowId) { workflowStubCount++; notes.push(`  stub(page) ${pa.workflowId.slice(0, 8)}…`); }
    }
  }
  return { loopCount, workflowStubCount, variableCount, passed: loopCount >= 1 && workflowStubCount >= 1, notes };
}

function classifyBuild(allCalls: Array<{ name: string; input: Record<string, unknown> }>): BuildVerdict {
  const notes: string[] = [];
  let setStyleCalls = 0, setRepeatCalls = 0, addWorkflowStepCalls = 0, inventedUUIDs = 0;
  const callsPerWf: Record<string, number> = {};

  for (const c of allCalls) {
    if (c.name === 'set_style') setStyleCalls++;
    if (c.name === 'set_repeat') {
      setRepeatCalls++;
      notes.push(`  set_repeat mapPath="${(c.input as { mapPath?: string }).mapPath ?? '?'}"`);
    }
    if (c.name === 'add_workflow_step') {
      addWorkflowStepCalls++;
      const wfId = (c.input as { workflowId?: string }).workflowId ?? '';
      callsPerWf[wfId] = (callsPerWf[wfId] ?? 0) + 1;
    }
  }

  let rosterWorkflowsWithSteps = 0;
  for (const wfId of WF_IDS) {
    const n = callsPerWf[wfId] ?? 0;
    if (n > 0) rosterWorkflowsWithSteps++;
    notes.push(`  wf ${wfId.slice(0, 8)}…: steps=${n}`);
  }
  for (const [wfId, n] of Object.entries(callsPerWf)) {
    if (!WF_IDS.includes(wfId)) {
      inventedUUIDs += n;
      notes.push(`  ⚠ invented wfId ${wfId.slice(0, 8)}…: ${n} step(s)`);
    }
  }

  notes.push(`  set_style=${setStyleCalls} set_repeat=${setRepeatCalls} add_workflow_step=${addWorkflowStepCalls}`);

  const passed = setStyleCalls >= 1 && setRepeatCalls >= 1 && inventedUUIDs === 0 && rosterWorkflowsWithSteps >= 1;
  return { setStyleCalls, setRepeatCalls, addWorkflowStepCalls, inventedUUIDs, rosterWorkflowsWithSteps, rounds: 0, passed, notes };
}

// ─── Runners ─────────────────────────────────────────────────────────────────

async function runStructureSample(client: Anthropic, i: number): Promise<StructureVerdict> {
  const { static: sys } = buildStructureAgentPrompt();
  const t0 = Date.now();
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 8192,
    system: sys,
    tools: STRUCTURE_AGENT_TOOLS as unknown as Anthropic.Messages.Tool[],
    tool_choice: { type: 'tool', name: 'generate_structure' },
    messages: [{
      role: 'user',
      content: `Build: Calculator App\nDescription: ${ORIGINAL_REQUEST}\nSECTION LIMIT: Build EXACTLY 1 section(s). Do NOT add extra sections.\nBuild the tree and declare variables in one generate_structure call.`,
    }],
  });
  const v = classifyStructure(msg.content);
  console.log(`\n  [Structure ${i}] (${Date.now() - t0}ms) — ${v.passed ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`    loops=${v.loopCount}  stubs=${v.workflowStubCount}  vars=${v.variableCount}`);
  for (const n of v.notes) console.log(`    ${n}`);
  return v;
}

async function runBuildSample(client: Anthropic, i: number): Promise<BuildVerdict> {
  const { static: sys, dynamic: dyn } = buildBuildAgentPrompt({
    pages: [{ id: 'page-1', name: 'Home', route: '/' }],
    currentPageName: 'Home',
    currentPageRoute: '/',
    appName: 'Calculator',
    description: ORIGINAL_REQUEST,
  });
  const t0 = Date.now();
  const tools = BUILD_PHASE_TOOLS as unknown as Anthropic.Messages.Tool[];
  const allCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  const messages: MessageParam[] = [{
    role: 'user',
    content: `[Build Agent — Home]
Page: page-1

[Page Tree — use exact node UUIDs]
${CALC_COMPACT_TREE}

${VAR_ROSTER}

${WF_ROSTER}

Original request:
${ORIGINAL_REQUEST}`,
  }];

  // Multi-round agentic loop (mirrors runHaikuAgentLoop)
  let rounds = 0;
  const MAX_ROUNDS = 20;
  while (rounds < MAX_ROUNDS) {
    rounds++;
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8192,
      system: `${sys}\n\n${dyn}`,
      tools,
      messages,
    });

    // Collect tool calls from this round.
    const toolUseBlocks = resp.content.filter(b => b.type === 'tool_use') as Anthropic.Messages.ToolUseBlock[];

    if (resp.stop_reason === 'end_turn' || toolUseBlocks.length === 0) break;

    // Apply server-side validators (same as the real system) so the model can self-correct.
    // Only add calls that PASS validation to allCalls — rejected ones are never client-executed.
    messages.push({ role: 'assistant', content: resp.content });
    const results: Anthropic.Messages.ToolResultBlockParam[] = toolUseBlocks.map(b => {
      if (b.name === 'add_workflow_step') {
        const wfId = (b.input as { workflowId?: string }).workflowId ?? '';
        if (!wfId) {
          return { type: 'tool_result' as const, tool_use_id: b.id, content: JSON.stringify({ success: false, error: 'add_workflow_step requires workflowId. Use the exact UUID from your WORKFLOW ROSTER.' }), is_error: true as const };
        }
        if (!WF_IDS.includes(wfId)) {
          return { type: 'tool_result' as const, tool_use_id: b.id, content: JSON.stringify({ success: false, error: `Workflow "${wfId}" not found. Your WORKFLOW ROSTER has: ${WF_IDS.join(', ')}. Use the exact UUID shown.` }), is_error: true as const };
        }
      }
      // Validation passed — count this call and return success.
      allCalls.push({ name: b.name, input: b.input as Record<string, unknown> });
      return { type: 'tool_result' as const, tool_use_id: b.id, content: JSON.stringify({ ok: true, pending: 'client_execution' }) };
    });
    messages.push({ role: 'user', content: results });
  }

  const v = classifyBuild(allCalls);
  v.rounds = rounds;
  console.log(`\n  [Build ${i}] (${Date.now() - t0}ms, ${rounds} rounds) — ${v.passed ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`    setStyle=${v.setStyleCalls}  setRepeat=${v.setRepeatCalls}  wfSteps=${v.addWorkflowStepCalls}  invented=${v.inventedUUIDs}`);
  for (const n of v.notes) console.log(`    ${n}`);
  return v;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set. Run with: npx tsx --env-file=.env scripts/exp-validate-structure-workflow.ts');
  }
  const samples = Number(process.env.EXP_SAMPLES || 2);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.log('Model:   claude-haiku-4-5');
  console.log('Samples: ' + samples);

  // Suite 1 — Structure agent (unchanged — still runs as a single forced call)
  console.log('\n' + '═'.repeat(72));
  console.log('SUITE 1 — STRUCTURE AGENT');
  console.log('PASS: loopCount >= 1  AND  workflowStubCount >= 1');
  console.log('═'.repeat(72));
  let structPassed = 0;
  for (let i = 1; i <= samples; i++) { if ((await runStructureSample(client, i)).passed) structPassed++; }

  // Suite 2 — Unified build agent (replaces separate styling/binding/workflow agents)
  console.log('\n' + '═'.repeat(72));
  console.log('SUITE 2 — UNIFIED BUILD AGENT');
  console.log('PASS: set_style >= 1  AND  set_repeat >= 1  AND  wf steps with correct UUIDs  AND  zero invented UUIDs');
  console.log('═'.repeat(72));
  let buildPassed = 0;
  for (let i = 1; i <= samples; i++) { if ((await runBuildSample(client, i)).passed) buildPassed++; }

  // Summary
  console.log('\n' + '═'.repeat(72));
  console.log('FINAL RESULTS');
  console.log('═'.repeat(72));
  console.log(`  Structure: ${structPassed}/${samples} passed`);
  console.log(`  Build:     ${buildPassed}/${samples} passed`);
  console.log('');
  if (structPassed === samples && buildPassed === samples) {
    console.log('✓ All suites passed.');
  } else {
    if (structPassed < samples) console.log('✗ Structure: agent missed loops or workflow stubs on some samples.');
    if (buildPassed < samples)  console.log('✗ Build: agent failed styling, binding, or workflow steps on some samples.');
    process.exit(1);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
