/* eslint-disable no-console */
/**
 * Check whether the styling agent generates a per-item `self` formula on a
 * REPEAT-template MessageBubble so chat messages align left/right by sender.
 *
 * Run: EXP_SAMPLES=3 npx tsx --env-file=.env scripts/exp-chat-alignment.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import { STYLING_AGENT_TOOLS } from '../lib/ai/builder-tools';
import { buildStylingAgentPrompt } from '../lib/ai/agents';

// ── Node IDs (fake but stable) ────────────────────────────────────────────────
const NODE = {
  chatPage:         'da8f92c5-8016-453d-9c96-6666a1765872',
  chatHeader:       '19a26421-4d85-4413-b808-679d0d648ac3',
  headerTitle:      'b4867ad1-fe54-4738-b073-c04a9c6ca6ee',
  messagesContainer:'b8e566a1-b8ea-4be7-815f-2b0c9ef7184f',
  messageBubble:    '4cf93132-f7f5-4a89-a81a-9cede210697d', // REPEAT template
  senderText:       '498be8fe-16f1-4b48-a67d-dc35878176bf',
  contentText:      '046b9af1-cb37-401c-8ab1-de3823a85df7',
  timeText:         '9c599e85-f570-4e81-a30f-bc7fedbd7ab0',
  inputArea:        '77458134-1264-416d-9dc3-9a411d0fe598',
  messageInput:     'a828a9c0-f845-48b5-8a0c-cc1d99eb3590',
  sendButton:       'ac4d82e4-ee25-4a31-98a0-82bb8cbdbb5b',
  sendLabel:        '938071ea-4bc6-47d1-88de-673c9b971e07',
};

const VAR_ID = 'f8d4a2b1-c3e5-4f7a-b9c1-d2e3f4a5b6c7';

const ORIGINAL_REQUEST = `i new to create a chat that have some messages`;

const CHUNK_TREE = `=== Build chat page structure with message list and input area ===
[${NODE.chatPage}] Box[section] "ChatPage"
  [${NODE.chatHeader}] Box[button] "ChatHeader"
    [${NODE.headerTitle}] Text[button-label] text="Chat"
  [${NODE.messagesContainer}] Box[group] "MessagesContainer"
    [${NODE.messageBubble}] Box[button] "MessageBubble" — REPEAT(key=id)
      [${NODE.senderText}] Text[button-label] "MessageSender"
      [${NODE.contentText}] Text[button-label] "MessageContent"
      [${NODE.timeText}] Text[button-label] "MessageTime"
  [${NODE.inputArea}] Box[group] "InputArea"
    [${NODE.messageInput}] Input "MessageInput"
    [${NODE.sendButton}] Box[button] "SendButton"
      [${NODE.sendLabel}] Text[button-label] text="Send"`;

const VAR_ROSTER = `Available variables (ONLY these UUIDs are valid):
  "Messages" (array) → variables['${VAR_ID}'] = [{"id":"msg-001","sender":"Alice","content":"Hey! How are you doing today?","timestamp":"10:30 AM"},{"id":"msg-002","sender":"You","content":"I'm doing great, thanks for asking! How about you?","timestamp":"10:32 AM"},{"id":"msg-003","sender":"Alice","content":"Pretty good! Just finished a project at work.","timestamp":"10:33 AM"},{"id":"msg-004","sender":"You","content":"That's awesome! Congratulations!","timestamp":"10:35 AM"},{"id":"msg-005","sender":"Alice","content":"Thanks! We should catch up soon.","timestamp":"10:36 AM"}] — List of chat messages displayed in the conversation`;

// ── Classify a single run ─────────────────────────────────────────────────────
function isFormulaString(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return v.includes('?.') || v.includes('===') || v.includes('!==') || v.startsWith('context');
}

interface SetStyleInput { nodeId?: string; self?: unknown; bg?: unknown; [k: string]: unknown }

interface Verdict {
  selfFormula: boolean;
  selfValue: unknown;
  bgFormula: boolean;
  rawBubbleCall: Record<string, unknown> | null;
  passed: boolean;
}

function classify(content: Anthropic.Messages.ContentBlock[]): Verdict {
  const calls: Record<string, SetStyleInput> = {};
  for (const b of content) {
    if (b.type === 'tool_use' && b.name === 'set_style') {
      const inp = b.input as SetStyleInput;
      if (inp.nodeId) calls[inp.nodeId] = inp;
    }
  }

  const bubble = calls[NODE.messageBubble] ?? null;
  // Accept both 'self' (tool alias) and 'alignSelf' (CSS name) — the executor's
  // CSS_ALIAS_MAP normalizes alignSelf → self at runtime, so both work in production.
  const selfValue = bubble?.self ?? (bubble as Record<string, unknown> | null)?.['alignSelf'];
  const selfFormula = isFormulaString(selfValue);
  const bgFormula = isFormulaString(bubble?.bg);

  return {
    selfFormula,
    selfValue,
    bgFormula,
    rawBubbleCall: bubble as Record<string, unknown> | null,
    passed: selfFormula,
  };
}

// ── One sample ────────────────────────────────────────────────────────────────
async function runSample(client: Anthropic, system: string, user: string, idx: number): Promise<Verdict> {
  const t0 = Date.now();
  const stream = client.messages.stream({
    model: 'claude-haiku-4-5',
    max_tokens: 16384,
    temperature: 1,
    system,
    tools: STYLING_AGENT_TOOLS as unknown as Anthropic.Messages.Tool[],
    messages: [{ role: 'user', content: user }],
  });
  const msg = await stream.finalMessage();
  const verdict = classify(msg.content);
  const ms = Date.now() - t0;

  const status = verdict.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`\nSample ${idx} (${ms}ms) — ${status}`);
  console.log(`  self formula: ${verdict.selfFormula}  value: ${JSON.stringify(verdict.selfValue)}`);
  console.log(`  bg formula:   ${verdict.bgFormula}`);
  if (verdict.rawBubbleCall) {
    const { nodeId: _n, _pageId: _p, ...rest } = verdict.rawBubbleCall as Record<string, unknown>;
    console.log(`  bubble set_style: ${JSON.stringify(rest)}`);
  } else {
    console.log(`  bubble set_style: (no call found)`);
  }

  return verdict;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set. Run with: npx tsx --env-file=.env scripts/exp-chat-alignment.ts');
  }

  const samples = Number(process.env.EXP_SAMPLES ?? 3);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const promptCtx = {
    pages: [{ id: 'page-1', name: 'Chat', route: '/chat' }],
    currentPageName: 'Chat',
    currentPageRoute: '/chat',
    paletteSnapshot: '',
    mood: '',
    appName: '',
    description: '',
    category: 'general',
  };
  const { static: staticPart, dynamic: dynamicPart } = buildStylingAgentPrompt(promptCtx);
  const system = `${staticPart}\n\n${dynamicPart}`;

  const userMessage = `[Context]
Nothing selected
Current page is empty — no nodes yet.

[Styling Agent — Build chat page structure with message list and input area]

[Page Tree Chunk — use exact node UUIDs]
${CHUNK_TREE}

${VAR_ROSTER}

Original request:
${ORIGINAL_REQUEST}

NOTE: switch_page(page-46fec3b5) has already been called. Do NOT call switch_page again.

RULES: DO NOT call get_page_tree. DO NOT call generate_structure again.`;

  console.log('Model:        claude-haiku-4-5');
  console.log('System chars: ' + system.length);
  console.log('User chars:   ' + userMessage.length);
  console.log('Samples:      ' + samples);
  console.log('\nPASS = MessageBubble (REPEAT template) gets self: <formula> based on context?.item?.data?.sender');
  console.log('       so "You" messages align right and others align left.\n');

  let passed = 0;
  for (let i = 1; i <= samples; i++) {
    const v = await runSample(client, system, userMessage, i);
    if (v.passed) passed++;
  }

  console.log('\n' + '='.repeat(72));
  console.log(`RESULT: ${passed}/${samples} samples passed.`);
  console.log('='.repeat(72));
}

run().catch(err => { console.error(err); process.exit(1); });
