/* eslint-disable no-console */
/**
 * Validate that appending "Original request:" to the styling agent's user
 * message lets Haiku produce a layered-collage layout (absolute + leading
 * anchors + rotation/shadow), as opposed to the flat 3-column grid it produced
 * without the intent block.
 *
 * Setup matches app/api/ai/builder-chat/route.ts exactly:
 *   - model: claude-haiku-4-5
 *   - system: buildStylingAgentPrompt(ctx).static + dynamic (with Tailwind framing)
 *   - tools: STYLING_AGENT_TOOLS
 *   - user message: stripped chunk tree (=== chunk ===, no labels) + Original request
 *
 * Run: EXP_SAMPLES=2 npx tsx --env-file=.env scripts/exp-validate-styling-intent.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import { STYLING_AGENT_TOOLS } from '../lib/ai/builder-tools';
import { buildStylingAgentPrompt } from '../lib/ai/agents';

const NODE = {
  root:        '10f0f433-d136-4847-84f2-c8d49b9292dd',
  split:       '0168aa54-b078-45d1-bfdc-b74e833325ba',
  leftCol:     'd96ca69c-3309-4675-a8cb-1a0a6e127463',
  headline:    'fe1bb99b-6d83-4897-bade-7f268c56aa6d',
  body:        'b5b5517e-ea90-4728-9be2-95876c93f20c',
  ctaButton:   'd889d310-bc84-4bde-9661-7a36cfe61bcd',
  buttonLabel: '5d96a634-d711-4e5d-9241-ab8e5aafd3bd',
  rightCol:    'fba08fd0-6c68-4acf-8090-965d885fc4b2',
  image1:      'f06b1b62-7f18-4027-b594-316d6ab86ca7',
  image2:      '5d41b597-aca3-4cff-96e8-ada7ce2feca8',
  image3:      '48209ac8-8f96-439d-a8e8-1f8196d23035',
};

const imageIds = [NODE.image1, NODE.image2, NODE.image3];

const ORIGINAL_REQUEST = `Create a layered collage page with a split layout: left column contains headline, body text, and CTA button; right column features 3 images positioned absolutely at different depths with slight rotations and drop shadows, each showing a visually distinct subject.`;

// Production chunk tree, stripped exactly like route.ts does (=== chunk ===, no labels).
const STRIPPED_CHUNK_TREE = `=== chunk ===
[${NODE.root}] Box[section]
  [${NODE.split}] Box[group]
    [${NODE.leftCol}] Box[group]
      [${NODE.headline}] Text text="Discover the Art of Visual Storytelling"
      [${NODE.body}] Text text="Explore curated collections of stunning imagery that capture moments, emotions, and creativity. Each layer tells a unique story, blending design and artistry into a seamless visual experience."
      [${NODE.ctaButton}] Box[button]
        [${NODE.buttonLabel}] Text[button-label] text="Explore Now"
    [${NODE.rightCol}] Box
      [${NODE.image1}] Image
      [${NODE.image2}] Image
      [${NODE.image3}] Image`;

interface SetStyleInput {
  nodeId?: string;
  position?: string;
  top?: unknown; right?: unknown; bottom?: unknown; left?: unknown;
  rotate?: unknown;
  shadow?: unknown;
  breakpoints?: Record<string, {
    position?: string;
    top?: unknown; right?: unknown; bottom?: unknown; left?: unknown;
    rotate?: unknown; shadow?: unknown;
  }>;
}

interface ParentWidthShape {
  // per breakpoint: 'fluid' | 'fixed' | 'unset'
  base: 'fluid' | 'fixed' | 'unset';
  desktop: 'fluid' | 'fixed' | 'unset';
  laptop: 'fluid' | 'fixed' | 'unset';
  tablet: 'fluid' | 'fixed' | 'unset';
  mobile: 'fluid' | 'fixed' | 'unset';
}

interface Verdict {
  absoluteCount: number;
  leadingAnchorCount: number;
  trailingAnchorCount: number;
  rotateCount: number;
  shadowCount: number;
  callsOnImages: number;
  driftFlagCount: number; // child trailing anchor in a breakpoint where parent is fluid
  parentWidth: ParentWidthShape;
  passed: boolean;
  notes: string[];
}

// A width is "fixed" only if it's an explicit px/rem number (e.g. 800, "800px").
// w-full, flex-1, percentages, "auto", or unset are all fluid.
function classifyWidth(width: unknown): 'fluid' | 'fixed' | 'unset' {
  if (width === undefined || width === null || width === '') return 'unset';
  if (typeof width === 'number' && Number.isFinite(width)) return 'fixed';
  if (typeof width === 'string') {
    const w = width.trim().toLowerCase();
    if (w === 'auto' || w === '100%' || w.endsWith('%') || w === 'full' || w === 'fit' || w === 'min' || w === 'max') return 'fluid';
    if (/^\d+(\.\d+)?(px|rem)?$/.test(w)) return 'fixed';
  }
  return 'fluid';
}

function classify(content: Anthropic.Messages.ContentBlock[]): Verdict {
  const styles: Record<string, SetStyleInput & { width?: unknown }> = {};
  for (const b of content) {
    if (b.type === 'tool_use' && b.name === 'set_style') {
      const input = b.input as SetStyleInput & { width?: unknown };
      if (input.nodeId) styles[input.nodeId] = input;
    }
  }

  // Parent (rightCol) boundedness per breakpoint.
  // A parent bounds its absolute children if it has an explicit pixel width OR
  // an explicit pixel maxWidth — maxWidth + mx:auto is a valid stabilizing strategy,
  // so a trailing anchor inside a maxWidth-capped parent does NOT drift.
  type WidthBox = { width?: unknown; maxWidth?: unknown };
  const parentStyle = styles[NODE.rightCol] as (SetStyleInput & WidthBox & { breakpoints?: Record<string, WidthBox> }) | undefined;
  const boundedAt = (bp?: WidthBox): 'fluid' | 'fixed' | 'unset' => {
    const w = classifyWidth(bp?.width ?? parentStyle?.width);
    const mw = classifyWidth(bp?.maxWidth ?? parentStyle?.maxWidth);
    if (w === 'fixed' || mw === 'fixed') return 'fixed';
    if (w === 'unset' && mw === 'unset') return 'unset';
    return 'fluid';
  };
  const parentWidth: ParentWidthShape = {
    base:    boundedAt(),
    desktop: boundedAt(parentStyle?.breakpoints?.desktop),
    laptop:  boundedAt(parentStyle?.breakpoints?.laptop),
    tablet:  boundedAt(parentStyle?.breakpoints?.tablet),
    mobile:  boundedAt(parentStyle?.breakpoints?.mobile),
  };

  let absoluteCount = 0;
  let leadingAnchorCount = 0;
  let trailingAnchorCount = 0;
  let rotateCount = 0;
  let shadowCount = 0;
  let callsOnImages = 0;
  let driftFlagCount = 0;
  const notes: string[] = [];

  for (const id of imageIds) {
    const s = styles[id];
    if (!s) { notes.push(`${id.slice(0, 8)}: no set_style call`); continue; }
    callsOnImages++;
    const breakpoints = [
      ['base', s as { position?: string; top?: unknown; right?: unknown; bottom?: unknown; left?: unknown; rotate?: unknown; shadow?: unknown }],
      ...Object.entries(s.breakpoints ?? {}),
    ] as Array<[string, { position?: string; top?: unknown; right?: unknown; bottom?: unknown; left?: unknown; rotate?: unknown; shadow?: unknown }]>;
    for (const [bp, src] of breakpoints) {
      if (src.position === 'absolute') absoluteCount++;
      if (src.top !== undefined || src.left !== undefined) leadingAnchorCount++;
      const hasTrailing = src.right !== undefined || src.bottom !== undefined;
      if (src.right !== undefined) trailingAnchorCount++;
      if (src.bottom !== undefined) trailingAnchorCount++;
      if (src.rotate !== undefined) rotateCount++;
      if (src.shadow !== undefined) shadowCount++;

      // Drift flag: trailing anchor in a breakpoint where parent is fluid (or unset)
      const bpKey = (bp === 'base' || bp === 'desktop' ? 'desktop' : bp) as keyof ParentWidthShape;
      const parentShape = parentWidth[bpKey] ?? parentWidth.base;
      const parentIsFluid = parentShape === 'fluid' || parentShape === 'unset';
      const drifts = hasTrailing && parentIsFluid;
      if (drifts) driftFlagCount++;

      const anchors = [
        src.top !== undefined ? `top:${src.top}` : null,
        src.left !== undefined ? `left:${src.left}` : null,
        src.right !== undefined ? `right:${src.right}` : null,
        src.bottom !== undefined ? `bottom:${src.bottom}` : null,
      ].filter(Boolean).join(' ');
      const extras = [
        src.position ? `pos:${src.position}` : null,
        src.rotate !== undefined ? `rotate:${src.rotate}` : null,
        src.shadow !== undefined ? `shadow:${src.shadow}` : null,
      ].filter(Boolean).join(' ');
      const driftTag = drifts ? '  ⚠ DRIFT' : '';
      const line = `${id.slice(0, 8)} ${bp.padEnd(7)}: ${anchors || '(no anchors)'}${extras ? '  | ' + extras : ''}${driftTag}`;
      notes.push(line);
    }
  }

  // PASS = images use absolute positioning AND have rotation AND zero drift flags.
  // (Trailing anchors are fine if the parent is a fixed pixel width — they only drift in fluid parents.)
  const passed = absoluteCount > 0 && rotateCount > 0 && driftFlagCount === 0;
  return { absoluteCount, leadingAnchorCount, trailingAnchorCount, rotateCount, shadowCount, callsOnImages, driftFlagCount, parentWidth, passed, notes };
}

async function runSample(client: Anthropic, system: string, user: string, sampleIdx: number): Promise<Verdict> {
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
  console.log(`\nSample ${sampleIdx} (${ms}ms) — ${verdict.passed ? 'PASS' : 'FAIL'}`);
  console.log(`  absolute=${verdict.absoluteCount}  leading=${verdict.leadingAnchorCount}  trailing=${verdict.trailingAnchorCount}  rotate=${verdict.rotateCount}  shadow=${verdict.shadowCount}  imgCalls=${verdict.callsOnImages}/3  driftFlags=${verdict.driftFlagCount}`);
  console.log(`  parentWidth(bounded?): base=${verdict.parentWidth.base} desktop=${verdict.parentWidth.desktop} laptop=${verdict.parentWidth.laptop} tablet=${verdict.parentWidth.tablet} mobile=${verdict.parentWidth.mobile}`);
  const ps = (msg.content.find(b => b.type === 'tool_use' && b.name === 'set_style' && (b.input as { nodeId?: string }).nodeId === NODE.rightCol) as { input?: Record<string, unknown> } | undefined)?.input;
  if (ps) console.log(`  rightCol raw: width=${JSON.stringify(ps.width)} maxWidth=${JSON.stringify(ps.maxWidth)} mx=${JSON.stringify(ps.mx)} flex=${JSON.stringify(ps.flex)}`);
  for (const n of verdict.notes.slice(0, 30)) console.log(`    ${n}`);
  return verdict;
}

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set. Run with: npx tsx --env-file=.env scripts/exp-validate-styling-intent.ts');

  const samples = Number(process.env.EXP_SAMPLES || 2);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const promptCtx = {
    pages: [{ id: 'page-1', name: 'Home', route: '/' }],
    currentPageName: 'Home',
    currentPageRoute: '/',
    paletteSnapshot: '',
    mood: '',
    appName: '',
    description: '',
    category: 'general',
  };
  const promptParts = buildStylingAgentPrompt(promptCtx);
  const system = `${promptParts.static}\n\n${promptParts.dynamic}`;

  const userMessage = `[Styling Agent — chunk]

[Page Tree Chunk — use exact node UUIDs]
${STRIPPED_CHUNK_TREE}

No variables were created. Do NOT reference variables['UUID'].



Original request:
${ORIGINAL_REQUEST}`;

  console.log('Model:        claude-haiku-4-5');
  console.log('System chars: ' + system.length);
  console.log('User chars:   ' + userMessage.length);
  console.log('Samples:      ' + samples);
  console.log('\nValidating that the new "Original request" block (added to route.ts) is enough\nfor the styling agent to produce a layered collage with rotation/shadow.\n');
  console.log('PASS criteria: absoluteCount > 0  AND  rotateCount > 0  AND  driftFlags === 0');
  console.log('  drift = trailing anchor (right/bottom) on a child whose parent is fluid/unset width in that breakpoint');

  let passed = 0;
  for (let i = 1; i <= samples; i++) {
    const v = await runSample(client, system, userMessage, i);
    if (v.passed) passed++;
  }

  console.log('\n' + '='.repeat(72));
  console.log(`RESULT: ${passed}/${samples} samples passed.`);
  console.log('='.repeat(72));
  if (passed === samples) {
    console.log('Ship it — Haiku now uses absolute positioning + rotation with leading anchors.');
  } else {
    console.log('Investigate — at least one sample missed absolute/rotate, or used trailing anchors.');
  }
}

run().catch(err => { console.error(err); process.exit(1); });
