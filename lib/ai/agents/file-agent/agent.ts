/**
 * File-based builder agent — Anthropic agentic loop.
 *
 * Operates exclusively on the virtual file system (FsEngine). Read tools return
 * real content from the engine; write tools mutate the engine and emit SSE ops
 * that the client applies via applyVirtualFile / deleteVirtualFile.
 *
 * Loops until the model stops calling tools (stop_reason === 'end_turn') or
 * MAX_ROUNDS is hit.
 */

import Anthropic from '@anthropic-ai/sdk';
import { FsEngine } from '@/lib/ai/vfs/fs-engine';
import type { FsPendingOp } from '@/lib/ai/vfs/fs-engine';
import { codebaseSearch, type EntityHit } from '@/lib/ai/vfs/embed-files';
import type { Entity } from '@/lib/ai/vfs/entities';
import { FILE_AGENT_TOOLS } from './tools';
import { PROMPT_CORE } from './prompt';
import { searchImages, searchPexelsVideos, searchIconify } from '@/lib/ai/media-search';

const MAX_ROUNDS = 30;
export const FILE_AGENT_DEFAULT_MODEL = 'claude-haiku-4-5';


// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileAgentInput {
  files: Record<string, string>;
  message: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  /** Pre-built entity index from embedFiles(). Pass an empty Map if embeddings are unavailable. */
  entityIndex: Map<string, { vector: number[]; entity: Entity }>;
  emit: (event: Record<string, unknown>) => void;
  signal?: AbortSignal;
}

export interface FileAgentResult {
  ops: FsPendingOp[];
  answer: string;
  inputTokens: number;
  outputTokens: number;
  rounds: number;
  toolCallCount: number;
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

export async function runFileAgent(input: FileAgentInput): Promise<FileAgentResult> {
  const {
    files,
    message,
    chatHistory = [],
    model = FILE_AGENT_DEFAULT_MODEL,
    entityIndex,
    emit,
    signal,
  } = input;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });
  const engine = new FsEngine(files);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalRounds = 0;
  let totalToolCalls = 0;

  const messages: Anthropic.Messages.MessageParam[] = [];
  for (const m of chatHistory.slice(-6)) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: message });

  let answer = '';
  const writtenPaths = new Set<string>();

  // ── Path registry (session-scoped) ─────────────────────────────────────────
  // pathToId: VFS paths and datasource/workflow/variable names → internal UUID
  // idToPath: UUID → best human-readable path (for unresolution shown to AI)
  // friendlyToActual: friendly VFS path → actual stored path in FsEngine
  // nodeNameToId: UI node names ONLY — kept separate so they are not globally
  //   substituted by resolvePathRefs (which would corrupt "name": "display" fields)
  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();
  const friendlyToActual = new Map<string, string>();
  const nodeNameToId = new Map<string, string>();
  buildInitialPathMap(files, pathToId, idToPath, friendlyToActual);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.messages.create as unknown as (p: Record<string, unknown>) => Promise<Anthropic.Message>)({
      model,
      max_tokens: 16384,
      system: [
        {
          type: 'text',
          text: PROMPT_CORE,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: FILE_AGENT_TOOLS.map((t, i) =>
        i === FILE_AGENT_TOOLS.length - 1
          ? { ...t, cache_control: { type: 'ephemeral' } }
          : t,
      ),
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    totalRounds++;
    emit({
      type: '_internal_token_usage',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const toolUseBlocks: Anthropic.Messages.ToolUseBlock[] = [];
    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        answer += block.text;
        emit({ type: 'text_delta', content: block.text });
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push(block);
      }
    }

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tool of toolUseBlocks) {
      const inp = tool.input as Record<string, unknown>;
      let resultContent: string;
      let isError = false;
      totalToolCalls++;

      try {
        const prevOpCount = engine.pendingOps.length;
        resultContent = await executeTool(engine, tool.name, inp, entityIndex, writtenPaths, pathToId, idToPath, friendlyToActual, nodeNameToId);
        emit({ type: 'tool_executed', id: tool.id, name: tool.name, input: inp, result: resultContent, phase: 'file-agent' });

        // Stream any new write/delete ops to the client
        for (let i = prevOpCount; i < engine.pendingOps.length; i++) {
          const op = engine.pendingOps[i];
          if (op.kind === 'write') {
            emit({ type: 'file_written', path: op.path, content: op.content });
          } else {
            emit({ type: 'file_deleted', path: op.path });
          }
        }
      } catch (e) {
        resultContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
        isError = true;
        emit({ type: 'tool_executed', id: tool.id, name: tool.name, input: inp, result: resultContent, error: resultContent, phase: 'file-agent' });
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: resultContent,
        is_error: isError,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // ── Post-processing: second-pass path resolution ───────────────────────────
  // The AI sometimes references a workflow/variable path in a page before writing
  // that workflow/variable. By the time all tools have run, pathToId is complete.
  // Re-apply resolvePathRefs to every file written this session so forward-
  // references are resolved even if the file was written out of order.
  // IMPORTANT: must also emit file_written so the client store receives the
  // corrected content — result.ops is never replayed to the client after the loop.
  for (const path of writtenPaths) {
    try {
      const raw = engine.readRaw(path);
      const resolved = resolvePathRefs(raw, pathToId);
      if (resolved !== raw) {
        engine.writeFile(path, resolved);
        emit({ type: 'file_written', path, content: resolved });
      }
    } catch { /* skip unreadable files */ }
  }

  return { ops: engine.pendingOps, answer, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, rounds: totalRounds, toolCallCount: totalToolCalls };
}

// ─── Responsive style helpers ─────────────────────────────────────────────────

type BreakpointKey = 'laptop' | 'tablet' | 'mobile';
type ResponsiveStyles = Partial<Record<BreakpointKey, Record<string, string>>>;

const RESPONSIVE_BPS: BreakpointKey[] = ['laptop', 'tablet', 'mobile'];

/** All shorthand keys handled by resolveStyleParams. Any key in props.style that
 *  matches one of these is passed through resolveStyleParams → className.
 *  Any key that is NOT in this set is treated as a raw CSS property and kept in props.style. */
const SHORTHAND_KEYS = new Set([
  'display','direction','items','justify','self','wrap','flex1','flex',
  'gridCols','gridRows','gridFlow','colSpan','colSpanFull','rowSpan',
  'gap','gapX','gapY',
  'w','h','minW','maxW','minH','maxH',
  'p','px','py','pt','pr','pb','pl',
  'm','mx','my','mt','mr','mb','ml',
  'bg','text','weight','leading','tracking','textAlign','textColor',
  'textDecoration','textTransform','textOverflow','whitespace','wordBreak',
  'border','borderStyle','borderColor',
  'radius','radiusTL','radiusTR','radiusBR','radiusBL',
  'position','inset0','top','right','bottom','left','z',
  'overflow','cursor','opacity','objectFit','extra',
]);

/** Expand a single _style key + value into camelCase CSS properties for responsive output. */
function styleKeyToCssProps(key: string, val: unknown): Record<string, string> {
  if (val == null) return {};
  const px = (v: unknown) => `${v}px`;
  const sizeVal = (v: unknown): string => {
    if (v === 'full') return '100%';
    if (v === 'screen') return (key === 'h' || key === 'minH' || key === 'maxH') ? '100vh' : '100vw';
    if (v === 'fit') return 'fit-content';
    if (v === 'auto') return 'auto';
    if (typeof v === 'string' && /[a-z%]$/i.test(v)) return v;
    return `${v}px`;
  };
  switch (key) {
    case 'text':    return { fontSize: px(val) };
    case 'w':       return { width: sizeVal(val) };
    case 'h':       return { height: sizeVal(val) };
    case 'minW':    return { minWidth: sizeVal(val) };
    case 'maxW':    return { maxWidth: sizeVal(val) };
    case 'minH':    return { minHeight: sizeVal(val) };
    case 'maxH':    return { maxHeight: sizeVal(val) };
    case 'p':       return { paddingTop: px(val), paddingRight: px(val), paddingBottom: px(val), paddingLeft: px(val) };
    case 'px':      return { paddingLeft: px(val), paddingRight: px(val) };
    case 'py':      return { paddingTop: px(val), paddingBottom: px(val) };
    case 'pt':      return { paddingTop: px(val) };
    case 'pr':      return { paddingRight: px(val) };
    case 'pb':      return { paddingBottom: px(val) };
    case 'pl':      return { paddingLeft: px(val) };
    case 'm':       return { marginTop: px(val), marginRight: px(val), marginBottom: px(val), marginLeft: px(val) };
    case 'mx':      return { marginLeft: px(val), marginRight: px(val) };
    case 'my':      return { marginTop: px(val), marginBottom: px(val) };
    case 'mt':      return { marginTop: px(val) };
    case 'mr':      return { marginRight: px(val) };
    case 'mb':      return { marginBottom: px(val) };
    case 'ml':      return { marginLeft: px(val) };
    case 'gap':     return { gap: px(val) };
    case 'gapX':    return { columnGap: px(val) };
    case 'gapY':    return { rowGap: px(val) };
    case 'display': return { display: val === 'hidden' ? 'none' : String(val) };
    case 'direction': {
      const v = String(val);
      return { flexDirection: v === 'col' ? 'column' : v === 'col-reverse' ? 'column-reverse' : v };
    }
    case 'items': {
      const v = String(val);
      return { alignItems: v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : v };
    }
    case 'justify': {
      const v = String(val);
      const m: Record<string, string> = { start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' };
      return { justifyContent: m[v] ?? v };
    }
    case 'bg':          return { backgroundColor: String(val) };
    case 'textColor':   return { color: String(val) };
    case 'radius':      return { borderRadius: px(val) };
    case 'border':      return { borderWidth: px(val) };
    case 'borderColor': return { borderColor: String(val) };
    case 'opacity':     return { opacity: String(val) };
    case 'z':           return { zIndex: String(val) };
    case 'top':         return { top: px(val) };
    case 'right':       return { right: px(val) };
    case 'bottom':      return { bottom: px(val) };
    case 'left':        return { left: px(val) };
    case 'gridCols':    return { gridTemplateColumns: `repeat(${val}, minmax(0, 1fr))` };
    case 'position':    return { position: String(val) };
    case 'overflow':    return { overflow: String(val) };
    case 'cursor':      return { cursor: String(val) };
    default: return {};
  }
}

/**
 * If a _style value is a responsive object { default?, laptop?, tablet?, mobile? },
 * returns the base value (for className) and per-breakpoint overrides.
 * Plain primitives pass through unchanged.
 */
function unwrapResponsive(val: unknown): { base: unknown; bpOverrides: Partial<Record<BreakpointKey, unknown>> } {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    if (RESPONSIVE_BPS.some(k => k in obj) || 'default' in obj) {
      const overrides: Partial<Record<BreakpointKey, unknown>> = {};
      for (const bp of RESPONSIVE_BPS) {
        if (bp in obj) overrides[bp] = obj[bp];
      }
      return { base: 'default' in obj ? obj.default : undefined, bpOverrides: overrides };
    }
  }
  return { base: val, bpOverrides: {} };
}

/**
 * Maps shorthand style keys to their CSS property equivalents for use when the
 * value is a dynamic `{ js: "..." }` binding. These cannot be compiled to static
 * Tailwind class tokens, so they are routed to props.style as raw CSS properties
 * and evaluated at render time by resolveProps().
 *
 * wrapJs transforms the JS expression when the CSS value format differs from the
 * shorthand value (e.g. colSpan: 2 → gridColumn: 'span 2').
 */
const SHORTHAND_JS_CSS_MAP: Record<string, { cssKey: string; wrapJs?: (expr: string) => string }> = {
  bg:           { cssKey: 'backgroundColor' },
  textColor:    { cssKey: 'color' },
  radius:       { cssKey: 'borderRadius',        wrapJs: e => `(${e}) + 'px'` },
  radiusTL:     { cssKey: 'borderTopLeftRadius', wrapJs: e => `(${e}) + 'px'` },
  radiusTR:     { cssKey: 'borderTopRightRadius',wrapJs: e => `(${e}) + 'px'` },
  radiusBR:     { cssKey: 'borderBottomRightRadius', wrapJs: e => `(${e}) + 'px'` },
  radiusBL:     { cssKey: 'borderBottomLeftRadius',  wrapJs: e => `(${e}) + 'px'` },
  border:       { cssKey: 'borderWidth',         wrapJs: e => `(${e}) + 'px'` },
  borderColor:  { cssKey: 'borderColor' },
  opacity:      { cssKey: 'opacity' },
  colSpan:      { cssKey: 'gridColumn',          wrapJs: e => `'span ' + (${e})` },
  gridCols:     { cssKey: 'gridTemplateColumns', wrapJs: e => `'repeat(' + (${e}) + ', minmax(0, 1fr))'` },
  w:            { cssKey: 'width' },
  h:            { cssKey: 'height' },
  minW:         { cssKey: 'minWidth' },
  maxW:         { cssKey: 'maxWidth' },
  minH:         { cssKey: 'minHeight' },
  maxH:         { cssKey: 'maxHeight' },
  text:         { cssKey: 'fontSize',            wrapJs: e => `(${e}) + 'px'` },
  top:          { cssKey: 'top',                 wrapJs: e => `(${e}) + 'px'` },
  right:        { cssKey: 'right',               wrapJs: e => `(${e}) + 'px'` },
  bottom:       { cssKey: 'bottom',              wrapJs: e => `(${e}) + 'px'` },
  left:         { cssKey: 'left',                wrapJs: e => `(${e}) + 'px'` },
  z:            { cssKey: 'zIndex' },
  p:            { cssKey: 'padding',             wrapJs: e => `(${e}) + 'px'` },
  px:           { cssKey: 'paddingInline',        wrapJs: e => `(${e}) + 'px'` },
  py:           { cssKey: 'paddingBlock',         wrapJs: e => `(${e}) + 'px'` },
  pt:           { cssKey: 'paddingTop',           wrapJs: e => `(${e}) + 'px'` },
  pr:           { cssKey: 'paddingRight',         wrapJs: e => `(${e}) + 'px'` },
  pb:           { cssKey: 'paddingBottom',        wrapJs: e => `(${e}) + 'px'` },
  pl:           { cssKey: 'paddingLeft',          wrapJs: e => `(${e}) + 'px'` },
  m:            { cssKey: 'margin',              wrapJs: e => `(${e}) + 'px'` },
  mx:           { cssKey: 'marginInline',         wrapJs: e => `(${e}) + 'px'` },
  my:           { cssKey: 'marginBlock',          wrapJs: e => `(${e}) + 'px'` },
  mt:           { cssKey: 'marginTop',            wrapJs: e => `(${e}) + 'px'` },
  mr:           { cssKey: 'marginRight',          wrapJs: e => `(${e}) + 'px'` },
  mb:           { cssKey: 'marginBottom',         wrapJs: e => `(${e}) + 'px'` },
  ml:           { cssKey: 'marginLeft',           wrapJs: e => `(${e}) + 'px'` },
  gap:          { cssKey: 'gap',                 wrapJs: e => `(${e}) + 'px'` },
  gapX:         { cssKey: 'columnGap',           wrapJs: e => `(${e}) + 'px'` },
  gapY:         { cssKey: 'rowGap',              wrapJs: e => `(${e}) + 'px'` },
  overflow:     { cssKey: 'overflow' },
  cursor:       { cssKey: 'cursor' },
  position:     { cssKey: 'position' },
};

// ─── Style param resolver ─────────────────────────────────────────────────────

function resolveStyleParams(i: Record<string, unknown>): { className: string; responsiveStyles: ResponsiveStyles } {
  const tokens: string[] = [];
  const responsiveStyles: ResponsiveStyles = {};

  const addBp = (key: string, bpOverrides: Partial<Record<BreakpointKey, unknown>>) => {
    for (const bp of RESPONSIVE_BPS) {
      const v = bpOverrides[bp];
      if (v == null) continue;
      const css = styleKeyToCssProps(key, v);
      if (!Object.keys(css).length) continue;
      if (!responsiveStyles[bp]) responsiveStyles[bp] = {};
      Object.assign(responsiveStyles[bp]!, css);
    }
  };

  { const { base: v, bpOverrides } = unwrapResponsive(i.display); if (v) tokens.push(String(v)); addBp('display', bpOverrides); }

  { const { base: v, bpOverrides } = unwrapResponsive(i.direction); if (v) tokens.push(`flex-${v}`); addBp('direction', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.items); if (v) tokens.push(`items-${v}`); addBp('items', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.justify); if (v) tokens.push(`justify-${v}`); addBp('justify', bpOverrides); }
  if (i.self) tokens.push(`self-${i.self}`);
  if (i.wrap) tokens.push(`flex-${i.wrap}`);
  if (i.flex1 || i.flex === 1) tokens.push('flex-1');
  { const { base: v, bpOverrides } = unwrapResponsive(i.gridCols); if (v != null) tokens.push(`grid-cols-${v}`); addBp('gridCols', bpOverrides); }
  if (i.gridRows != null) tokens.push(`grid-rows-${i.gridRows}`);
  if (i.gridFlow) tokens.push(`grid-flow-${i.gridFlow}`);
  if (i.colSpanFull) tokens.push('col-span-full');
  else if (i.colSpan != null) tokens.push(`col-span-${i.colSpan}`);
  if (i.rowSpan != null) tokens.push(`row-span-${i.rowSpan}`);

  { const { base: v, bpOverrides } = unwrapResponsive(i.gap);  if (v != null) tokens.push(`gap-[${v}px]`);   addBp('gap', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.gapX); if (v != null) tokens.push(`gap-x-[${v}px]`); addBp('gapX', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.gapY); if (v != null) tokens.push(`gap-y-[${v}px]`); addBp('gapY', bpOverrides); }

  const sizeToken = (prefix: string, val: unknown, cssKey: string) => {
    const { base: v, bpOverrides } = unwrapResponsive(val);
    if (v != null) {
      if (v === 'full')        tokens.push(`${prefix}-full`);
      else if (v === 'screen') tokens.push(`${prefix}-screen`);
      else if (v === 'fit')    tokens.push(`${prefix}-fit`);
      else if (v === 'auto')   tokens.push(`${prefix}-auto`);
      else if (typeof v === 'string' && /[a-z%]$/i.test(v)) tokens.push(`${prefix}-[${v}]`);
      else tokens.push(`${prefix}-[${v}px]`);
    }
    addBp(cssKey, bpOverrides);
  };
  sizeToken('w', i.w, 'w'); sizeToken('h', i.h, 'h');
  sizeToken('min-w', i.minW, 'minW'); sizeToken('max-w', i.maxW, 'maxW');
  sizeToken('min-h', i.minH, 'minH'); sizeToken('max-h', i.maxH, 'maxH');

  { const { base: v, bpOverrides } = unwrapResponsive(i.p);  if (v != null) tokens.push(`p-[${v}px]`);  addBp('p', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.px); if (v != null) tokens.push(`px-[${v}px]`); addBp('px', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.py); if (v != null) tokens.push(`py-[${v}px]`); addBp('py', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.pt); if (v != null) tokens.push(`pt-[${v}px]`); addBp('pt', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.pr); if (v != null) tokens.push(`pr-[${v}px]`); addBp('pr', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.pb); if (v != null) tokens.push(`pb-[${v}px]`); addBp('pb', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.pl); if (v != null) tokens.push(`pl-[${v}px]`); addBp('pl', bpOverrides); }

  const marginToken = (prefix: string, val: unknown, cssKey: string) => {
    const { base: v, bpOverrides } = unwrapResponsive(val);
    if (v != null) {
      if (v === 'auto') tokens.push(`${prefix}-auto`);
      else tokens.push(`${prefix}-[${v}px]`);
    }
    addBp(cssKey, bpOverrides);
  };
  marginToken('m', i.m, 'm'); marginToken('mx', i.mx, 'mx'); marginToken('my', i.my, 'my');
  marginToken('mt', i.mt, 'mt'); marginToken('mr', i.mr, 'mr'); marginToken('mb', i.mb, 'mb'); marginToken('ml', i.ml, 'ml');

  { const { base: v, bpOverrides } = unwrapResponsive(i.bg); if (v) tokens.push(`bg-[${v}]`); addBp('bg', bpOverrides); }

  { const { base: v, bpOverrides } = unwrapResponsive(i.text); if (v != null) tokens.push(`text-[${v}px]`); addBp('text', bpOverrides); }
  if (i.weight) tokens.push(`font-${i.weight}`);
  if (i.leading) tokens.push(`leading-${i.leading}`);
  if (i.tracking) tokens.push(`tracking-${i.tracking}`);
  if (i.textAlign) tokens.push(`text-${i.textAlign}`);
  { const { base: v, bpOverrides } = unwrapResponsive(i.textColor); if (v) tokens.push(`!text-[${v}]`); addBp('textColor', bpOverrides); }
  if (i.textDecoration) tokens.push(String(i.textDecoration));
  if (i.textTransform) tokens.push(String(i.textTransform));
  if (i.textOverflow) tokens.push(String(i.textOverflow));
  if (i.whitespace) tokens.push(`whitespace-${i.whitespace}`);
  if (i.wordBreak) tokens.push(`break-${i.wordBreak}`);

  {
    const { base: bv, bpOverrides } = unwrapResponsive(i.border);
    if (bv != null) {
      const bw = Number(bv);
      if (bw === 0) tokens.push('border-0');
      else if ([2, 4, 8].includes(bw)) tokens.push(`border-${bw}`);
      else tokens.push(`border-[${bw}px]`);
    }
    addBp('border', bpOverrides);
  }
  if (i.borderStyle) tokens.push(`border-${i.borderStyle}`);
  { const { base: v, bpOverrides } = unwrapResponsive(i.borderColor); if (v) tokens.push(`border-[${v}]`); addBp('borderColor', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.radius); if (v != null) tokens.push(`rounded-[${v}px]`); addBp('radius', bpOverrides); }
  if (i.radiusTL != null) tokens.push(`rounded-tl-[${i.radiusTL}px]`);
  if (i.radiusTR != null) tokens.push(`rounded-tr-[${i.radiusTR}px]`);
  if (i.radiusBR != null) tokens.push(`rounded-br-[${i.radiusBR}px]`);
  if (i.radiusBL != null) tokens.push(`rounded-bl-[${i.radiusBL}px]`);

  { const { base: v, bpOverrides } = unwrapResponsive(i.position); if (v) tokens.push(String(v)); addBp('position', bpOverrides); }
  if (i.inset0) tokens.push('inset-0');
  { const { base: v, bpOverrides } = unwrapResponsive(i.top);    if (v != null) tokens.push(`top-[${v}px]`);    addBp('top', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.right);  if (v != null) tokens.push(`right-[${v}px]`);  addBp('right', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.bottom); if (v != null) tokens.push(`bottom-[${v}px]`); addBp('bottom', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.left);   if (v != null) tokens.push(`left-[${v}px]`);   addBp('left', bpOverrides); }
  { const { base: v, bpOverrides } = unwrapResponsive(i.z);      if (v != null) tokens.push(`z-[${v}]`);        addBp('z', bpOverrides); }

  { const { base: v, bpOverrides } = unwrapResponsive(i.overflow); if (v) tokens.push(`overflow-${v}`); addBp('overflow', bpOverrides); }
  if (i.cursor) tokens.push(`cursor-${i.cursor}`);
  { const { base: v, bpOverrides } = unwrapResponsive(i.opacity); if (v != null) tokens.push(`opacity-[${v}]`); addBp('opacity', bpOverrides); }
  if (i.objectFit) tokens.push(`object-${i.objectFit}`);
  if (i.extra) tokens.push(String(i.extra).trim());

  return { className: tokens.filter(Boolean).join(' '), responsiveStyles };
}

function resolveStyleNodes(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(resolveStyleNodes);
  if (obj && typeof obj === 'object') {
    const node = { ...(obj as Record<string, unknown>) };
    if ('props' in node && node.props && typeof node.props === 'object') {
      const props = { ...(node.props as Record<string, unknown>) };
      // Support both legacy `_style` and new unified `style` key.
      // When `style` is present, split its keys: known shorthand keys go through
      // resolveStyleParams → className; unknown keys stay as raw CSS in props.style.
      const styleInput = ('style' in props ? props.style : ('_style' in props ? props._style : undefined)) as Record<string, unknown> | undefined;
      if (styleInput && typeof styleInput === 'object') {
        const { style: _s, _style: _sl, ...rest } = props;
        void _s; void _sl;
        const shorthand: Record<string, unknown> = {};
        const rawCss: Record<string, unknown> = {};
        const isJsObj = (v: unknown): v is { js: string } =>
          typeof v === 'object' && v !== null && 'js' in (v as object) &&
          typeof (v as Record<string, unknown>).js === 'string';
        for (const [k, v] of Object.entries(styleInput)) {
          if (SHORTHAND_KEYS.has(k) && isJsObj(v)) {
            // Dynamic { js } binding — cannot be compiled to a static Tailwind class.
            // Route to rawCss with the correct CSS property name so the renderer
            // evaluates it as an inline style at runtime.
            const mapping = SHORTHAND_JS_CSS_MAP[k];
            if (mapping) {
              const expr = mapping.wrapJs ? mapping.wrapJs(v.js) : v.js;
              rawCss[mapping.cssKey] = { js: expr };
            }
            // If no mapping defined, skip silently (prevents [object Object] in className)
          } else if (SHORTHAND_KEYS.has(k)) {
            shorthand[k] = v;
          } else {
            rawCss[k] = v;
          }
        }
        const { className, responsiveStyles } = resolveStyleParams(shorthand);
        node.props = {
          ...rest,
          ...(className ? { className } : {}),
          ...(Object.keys(rawCss).length > 0 ? { style: rawCss } : {}),
        };
        // Merge per-breakpoint CSS properties into node.responsive[bp].styles
        const bps = Object.keys(responsiveStyles) as BreakpointKey[];
        if (bps.length > 0) {
          const existingResponsive = (node.responsive ?? {}) as Record<string, Record<string, unknown>>;
          const merged: Record<string, Record<string, unknown>> = { ...existingResponsive };
          for (const bp of bps) {
            const bpStyles = responsiveStyles[bp]!;
            const ex = merged[bp] ?? {};
            merged[bp] = { ...ex, styles: { ...(ex.styles as Record<string, string> ?? {}), ...bpStyles } };
          }
          node.responsive = merged;
        }
      }
    }
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, resolveStyleNodes(v)])
    );
  }
  return obj;
}

// ─── Executor validators ──────────────────────────────────────────────────────

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


// ─── Path-based reference system ─────────────────────────────────────────────

/**
 * Scans the initial VFS snapshot and builds the path registry from existing files.
 * Uses the file's "name" field (for store/data) to build a friendly alias.
 * Falls back to the stored path for workflows and other files.
 */
function buildInitialPathMap(
  files: Record<string, string>,
  pathToId: Map<string, string>,
  idToPath: Map<string, string>,
  friendlyToActual: Map<string, string>,
): void {
  const relevantPrefixes = ['store/', 'workflows/', 'data/', 'pages/'];
  for (const [filePath, content] of Object.entries(files)) {
    if (!relevantPrefixes.some(p => filePath.startsWith(p))) continue;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(content) as Record<string, unknown>; } catch { continue; }
    const id = parsed.id as string | undefined;
    if (!id || !UUID_V4_RE.test(id)) continue;

    // Register the stored path → id (for backward compat resolution)
    pathToId.set(filePath, id);
    friendlyToActual.set(filePath, filePath);

    // Try to build a human-readable friendly path from the "name" field
    const name = parsed.name as string | undefined;
    let friendlyPath: string | null = null;
    if (name && filePath.startsWith('store/')) {
      const prefix = filePath.split('/').slice(0, -1).join('/');
      friendlyPath = `${prefix}/${name}`;
    } else if (name && filePath.startsWith('data/')) {
      friendlyPath = `data/${name}`;
    }

    if (friendlyPath && !pathToId.has(friendlyPath)) {
      pathToId.set(friendlyPath, id);
      idToPath.set(id, friendlyPath);
      friendlyToActual.set(friendlyPath, filePath);
    } else if (!idToPath.has(id)) {
      idToPath.set(id, filePath);
    }
  }
}

/**
 * Resolves a VFS write path to { path: storedPath, id: uuid }.
 * - Trailing slash → auto-assign UUID (anonymous).
 * - Valid UUID segment → preserve (backward compat).
 * - Human-readable name → assign new UUID, store at UUID-based path.
 * Never returns an error — all names are valid.
 */
function resolveNamedPath(
  rawPath: string,
  pathToId: Map<string, string>,
  idToPath: Map<string, string>,
  friendlyToActual: Map<string, string>,
): { path: string; id: string } {
  const trimmed = rawPath.replace(/\/$/, '');
  const segments = trimmed.split('/');
  const last = segments[segments.length - 1];
  const knownFolders = new Set(['store', 'workflows', 'data', 'components', 'pages']);

  // Trailing slash or bare folder → auto-assign UUID
  if (!last || knownFolders.has(last)) {
    const id = crypto.randomUUID();
    const storedPath = `${trimmed}/${id}`;
    pathToId.set(storedPath, id);
    if (!idToPath.has(id)) idToPath.set(id, storedPath);
    friendlyToActual.set(storedPath, storedPath);
    return { path: storedPath, id };
  }

  // Already registered (same friendly path used before)
  if (pathToId.has(trimmed)) {
    const existingId = pathToId.get(trimmed)!;
    const actualPath = friendlyToActual.get(trimmed) ?? trimmed;
    return { path: actualPath, id: existingId };
  }

  // Valid UUID segment → preserve
  if (UUID_V4_RE.test(last)) {
    pathToId.set(trimmed, last);
    if (!idToPath.has(last)) idToPath.set(last, trimmed);
    friendlyToActual.set(trimmed, trimmed);
    return { path: trimmed, id: last };
  }

  // Human-readable name → assign new UUID, store under parent/<uuid>
  const id = crypto.randomUUID();
  const prefix = segments.slice(0, -1).join('/');
  const storedPath = `${prefix}/${id}`;
  pathToId.set(trimmed, id);
  idToPath.set(id, trimmed);
  friendlyToActual.set(trimmed, storedPath);
  // Also register the stored path so it can be looked up by actual path
  pathToId.set(storedPath, id);
  friendlyToActual.set(storedPath, storedPath);
  return { path: storedPath, id };
}

/**
 * After assignNodeIds, walk the node tree and register each node's name → uuid in
 * the SEPARATE nodeNameToId map (NOT in pathToId). This prevents resolvePathRefs from
 * globally substituting short node names like "display" inside "name": "display" fields.
 */
function registerNodeNames(
  nodes: Record<string, unknown>[],
  nodeNameToId: Map<string, string>,
  idToPath: Map<string, string>,
): void {
  for (const node of nodes) {
    const name = node.name as string | undefined;
    const id = node.id as string | undefined;
    if (name && id && !nodeNameToId.has(name)) {
      nodeNameToId.set(name, id);
      if (!idToPath.has(id)) idToPath.set(id, name);
    }
    if (Array.isArray(node.children)) {
      registerNodeNames(node.children as Record<string, unknown>[], nodeNameToId, idToPath);
    }
  }
}

/**
 * Walk a step tree and resolve config.targetNodeId from node names to UUIDs,
 * using the nodeNameToId map (targeted replacement, not global).
 */
function resolveNodeRefsInSteps(
  steps: Record<string, unknown>[],
  nodeNameToId: Map<string, string>,
): void {
  for (const step of steps) {
    const config = step.config as Record<string, unknown> | undefined;
    if (config) {
      if (typeof config.targetNodeId === 'string' && nodeNameToId.has(config.targetNodeId)) {
        config.targetNodeId = nodeNameToId.get(config.targetNodeId);
      }
    }
    for (const key of ['trueBranch', 'falseBranch', 'defaultBranch', 'loopBody'] as const) {
      if (Array.isArray(step[key])) {
        resolveNodeRefsInSteps(step[key] as Record<string, unknown>[], nodeNameToId);
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Record<string, unknown>[]) {
        if (Array.isArray(b.steps)) resolveNodeRefsInSteps(b.steps as Record<string, unknown>[], nodeNameToId);
      }
    }
  }
}


/**
 * Resolve all registered path/name keys → UUIDs in a JSON string.
 * Covers double-quoted JSON strings and single-quoted JS code strings.
 * Sorted longest-first to prevent partial-path substitutions.
 */
function resolvePathRefs(jsonStr: string, pathToId: Map<string, string>): string {
  const sorted = [...pathToId.entries()].sort((a, b) => b[0].length - a[0].length);
  let result = jsonStr;
  for (const [key, uuid] of sorted) {
    if (key === uuid) continue;
    result = result.split(`"${key}"`).join(`"${uuid}"`);
    result = result.split(`'${key}'`).join(`'${uuid}'`);
  }
  return result;
}

/**
 * Reverse of resolvePathRefs: replace UUIDs with human-readable paths in content
 * returned to the AI, so it always sees names instead of UUIDs.
 */
function unresolvePathRefs(content: string, idToPath: Map<string, string>): string {
  let result = content;
  for (const [uuid, path] of idToPath) {
    if (uuid === path) continue;
    result = result.split(`"${uuid}"`).join(`"${path}"`);
    result = result.split(`'${uuid}'`).join(`'${path}'`);
  }
  return result;
}

/**
 * LLMs sometimes serialize large nested fields (steps, ui, changes, routes…) as a
 * JSON string instead of embedding the object natively. This pre-processor walks
 * the top-level tool input and, for any string value that looks like a JSON array
 * or object, attempts JSON.parse. On success the field is replaced with the parsed
 * value; on failure the whole call is rejected with a clear error.
 */
function normalizeInp(
  inp: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; field: string; detail: string } {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inp)) {
    if (typeof v === 'string') {
      const trimmed = v.trimStart();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          result[k] = JSON.parse(v);
          continue;
        } catch (e) {
          return { ok: false, field: k, detail: e instanceof Error ? e.message : String(e) };
        }
      }
    }
    result[k] = v;
  }
  return { ok: true, value: result };
}

/**
 * Translate a stored VFS path to its friendly equivalent for AI-visible output
 * (e.g. list_dir results). If the last segment is a UUID, look it up in idToPath.
 */
function translateToFriendly(storedPath: string, idToPath: Map<string, string>): string {
  const last = storedPath.split('/').pop() ?? '';
  if (UUID_V4_RE.test(last)) {
    const friendly = idToPath.get(last);
    if (friendly) return friendly;
  }
  return storedPath;
}

function assignNodeIds(nodes: Record<string, unknown>[]): void {
  for (const node of nodes) {
    if (!node.id) node.id = crypto.randomUUID();
    if (Array.isArray(node.children)) {
      assignNodeIds(node.children as Record<string, unknown>[]);
    }
  }
}

/**
 * Ensures every workflow step has a valid UUID v4 id.
 * - Valid UUID v4 provided by AI → preserved (supports context.workflow['id'].result).
 * - Invalid or missing id → server generates a new UUID and replaces ALL occurrences
 *   of the old id string throughout the entire steps JSON (covers result-ref strings
 *   like context.workflow['old-id'].result inside runJavaScript code).
 */
function assignStepIds(steps: Record<string, unknown>[]): Record<string, unknown>[] {
  // Phase 1: collect substitutions.
  // - User-set non-UUID id fields (e.g. id: "calcResult") → new UUID (broad replacement)
  // - Steps with no id but a name (AI uses name as context.workflow key) → new UUID
  //   (targeted replacement of context.workflow['name'] patterns only)
  const idMap = new Map<string, string>();          // key → new UUID, both categories
  const nameKeys = new Set<string>();               // keys that came from `name`, not `id`

  function collectSubstitutions(arr: Record<string, unknown>[]) {
    for (const step of arr) {
      const id = step.id as string | undefined;
      const name = step.name as string | undefined;
      if (id && !UUID_V4_RE.test(id) && !idMap.has(id)) {
        idMap.set(id, crypto.randomUUID());
      } else if (!id && name && !idMap.has(name)) {
        // AI used step name as context.workflow key instead of setting an explicit id
        idMap.set(name, crypto.randomUUID());
        nameKeys.add(name);
      }
      if (Array.isArray(step.trueBranch))    collectSubstitutions(step.trueBranch as Record<string, unknown>[]);
      if (Array.isArray(step.falseBranch))   collectSubstitutions(step.falseBranch as Record<string, unknown>[]);
      if (Array.isArray(step.loopBody))      collectSubstitutions(step.loopBody as Record<string, unknown>[]);
      if (Array.isArray(step.defaultBranch)) collectSubstitutions(step.defaultBranch as Record<string, unknown>[]);
      if (Array.isArray(step.branches)) {
        for (const b of step.branches as Record<string, unknown>[]) {
          if (Array.isArray(b.steps)) collectSubstitutions(b.steps as Record<string, unknown>[]);
        }
      }
    }
  }
  collectSubstitutions(steps);

  // Phase 2: bulk-replace in the serialized steps JSON.
  // - Explicit short ids: broad replacement (covers id field + all inline refs)
  // - Name-derived keys: targeted replacement of context.workflow['name'] patterns only
  //   (broad replacement would corrupt other JSON values that happen to share the step name)
  let json = JSON.stringify(steps);
  for (const [key, newId] of idMap) {
    if (nameKeys.has(key)) {
      // Targeted: only rewrite context.workflow references
      json = json.split(`context.workflow['${key}']`).join(`context.workflow['${newId}']`);
      json = json.split(`context.workflow["${key}"]`).join(`context.workflow["${newId}"]`);
      // Also fix the id field assignment itself (both compact and spaced variants)
      json = json.split(`"id":"${key}"`).join(`"id":"${newId}"`);
      json = json.split(`"id": "${key}"`).join(`"id": "${newId}"`);
    } else {
      // Broad: covers id fields + all inline refs (original behaviour for explicit ids)
      json = json.split(key).join(newId);
    }
  }
  const patched = JSON.parse(json) as Record<string, unknown>[];

  // Phase 3: assign UUIDs to steps that still have no id.
  // For steps whose name was registered in Phase 1, reuse the pre-generated UUID so
  // the context.workflow substitution from Phase 2 remains consistent.
  function fillMissing(arr: Record<string, unknown>[]): Record<string, unknown>[] {
    return arr.map(step => {
      const s: Record<string, unknown> = { ...step };
      if (!s.id) {
        const name = s.name as string | undefined;
        s.id = (name && idMap.get(name)) ?? crypto.randomUUID();
      }
      if (Array.isArray(s.trueBranch))    s.trueBranch    = fillMissing(s.trueBranch as Record<string, unknown>[]);
      if (Array.isArray(s.falseBranch))   s.falseBranch   = fillMissing(s.falseBranch as Record<string, unknown>[]);
      if (Array.isArray(s.loopBody))      s.loopBody      = fillMissing(s.loopBody as Record<string, unknown>[]);
      if (Array.isArray(s.defaultBranch)) s.defaultBranch = fillMissing(s.defaultBranch as Record<string, unknown>[]);
      if (Array.isArray(s.branches)) {
        s.branches = (s.branches as Record<string, unknown>[]).map(b => ({
          ...b,
          steps: Array.isArray(b.steps) ? fillMissing(b.steps as Record<string, unknown>[]) : [],
        }));
      }
      return s;
    });
  }
  return fillMissing(patched);
}

// ─── Patch helpers ───────────────────────────────────────────────────────────

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function patchNodeByName(
  nodes: Record<string, unknown>[],
  name: string,
  changes: Record<string, unknown>,
): { nodes: Record<string, unknown>[]; found: boolean } {
  let found = false;
  const result = nodes.map(node => {
    if (found) return node;
    if ((node.name as string) === name) {
      found = true;
      const resolvedChanges = resolveStyleNodes(changes) as Record<string, unknown>;
      return deepMerge(node, resolvedChanges);
    }
    if (Array.isArray(node.children)) {
      const r = patchNodeByName(node.children as Record<string, unknown>[], name, changes);
      if (r.found) { found = true; return { ...node, children: r.nodes }; }
    }
    return node;
  });
  return { nodes: result, found };
}

const STEP_BRANCH_KEYS = ['trueBranch', 'falseBranch', 'defaultBranch', 'loopBody'] as const;

function patchStepByName(
  steps: Record<string, unknown>[],
  name: string,
  changes: Record<string, unknown>,
): { steps: Record<string, unknown>[]; found: boolean } {
  let found = false;
  const result = steps.map(step => {
    if (found) return step;
    if ((step.name as string) === name) {
      found = true;
      const merged = deepMerge(step, changes);
      for (const key of STEP_BRANCH_KEYS) {
        if (Array.isArray(merged[key])) {
          merged[key] = assignStepIds(merged[key] as Record<string, unknown>[]);
        }
      }
      return merged;
    }
    for (const key of STEP_BRANCH_KEYS) {
      if (found) break;
      if (Array.isArray(step[key])) {
        const r = patchStepByName(step[key] as Record<string, unknown>[], name, changes);
        if (r.found) { found = true; return { ...step, [key]: r.steps }; }
      }
    }
    if (!found && Array.isArray(step.branches)) {
      const newBranches = (step.branches as Record<string, unknown>[]).map(b => {
        if (found) return b;
        const r = patchStepByName((b.steps ?? []) as Record<string, unknown>[], name, changes);
        if (r.found) { found = true; return { ...b, steps: r.steps }; }
        return b;
      });
      if (found) return { ...step, branches: newBranches };
    }
    return step;
  });
  return { steps: result, found };
}

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(
  engine: FsEngine,
  name: string,
  inp: Record<string, unknown>,
  entityIndex: Map<string, { vector: number[]; entity: Entity }>,
  writtenPaths: Set<string>,
  pathToId: Map<string, string>,
  idToPath: Map<string, string>,
  friendlyToActual: Map<string, string>,
  nodeNameToId: Map<string, string>,
): Promise<string> {
  // Normalize any top-level field that the AI sent as a JSON string instead of native JSON
  const normResult = normalizeInp(inp);
  if (!normResult.ok) {
    const nr = normResult as { ok: false; field: string; detail: string };
    return `Error: field "${nr.field}" was received as a JSON string but could not be parsed (${nr.detail}). Send it as a native JSON object/array, not a quoted string.`;
  }
  inp = normResult.value;

  switch (name) {
    case 'read_file': {
      const requestedPath = inp.path as string;
      const actualPath = friendlyToActual.get(requestedPath) ?? requestedPath;
      try {
        const raw = engine.readFile(
          actualPath,
          inp.start_line as number | undefined,
          inp.end_line as number | undefined,
        );
        return unresolvePathRefs(raw, idToPath);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes('not found')) {
          return `File not found: "${requestedPath}"`;
        }
        throw e;
      }
    }

    case 'list_dir': {
      const entries = engine.listDir((inp.prefix as string) ?? '');
      const friendly = entries.map(e => translateToFriendly(e, idToPath));
      return friendly.length ? friendly.join('\n') : '(empty)';
    }

    case 'grep': {
      const matches = engine.grep(inp.pattern as string, {
        pathPrefix: inp.path_prefix as string | undefined,
        limit: inp.limit as number | undefined,
      });
      if (matches.length === 0) return `No matches for "${inp.pattern as string}"`;
      const raw = matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n');
      return unresolvePathRefs(raw, idToPath);
    }

    case 'codebase_search': {
      const hits = await codebaseSearch(
        inp.query as string,
        entityIndex,
        0.2,
        inp.top_k as number | undefined,
      );
      if (hits.length === 0) return 'No matches found.';
      const rawHits = hits
        .map((h: EntityHit) => {
          const namePart = h.name ? ` name="${h.name}"` : '';
          const typePart = h.type ? `${h.type}` : h.kind;
          return `[${h.score.toFixed(3)}] ${h.path}:${h.line}  ${typePart}${namePart} — ${h.snippet}`;
        })
        .join('\n');
      return unresolvePathRefs(rawHits, idToPath);
    }

    case 'write_page': {
      const wpPath = inp.path as string;
      if (writtenPaths.has(wpPath)) return `Error: "${wpPath}" was already written this task. Use edit_page for corrections.`;
      const pageObj = {
        ui: inp.ui,
        ...(inp.meta ? { meta: inp.meta } : {}),
      };
      const resolved = resolveStyleNodes(pageObj) as { ui: unknown[]; meta?: unknown };
      assignNodeIds(resolved.ui as Record<string, unknown>[]);
      registerNodeNames(resolved.ui as Record<string, unknown>[], nodeNameToId, idToPath);
      const content = resolvePathRefs(JSON.stringify(resolved, null, 2), pathToId);
      engine.writeFile(wpPath, content);
      writtenPaths.add(wpPath);
      return `Written: ${wpPath}`;
    }

    case 'write_variable': {
      const { path, ...rest } = inp;
      const { path: wvPath, id } = resolveNamedPath(path as string, pathToId, idToPath, friendlyToActual);
      const friendlyWvPath = translateToFriendly(wvPath, idToPath);
      if (writtenPaths.has(wvPath)) return `Error: "${friendlyWvPath}" was already written this task. Use edit_variable for corrections.`;
      const content = resolvePathRefs(JSON.stringify({ id, ...rest }, null, 2), pathToId);
      engine.writeFile(wvPath, content);
      writtenPaths.add(wvPath);
      return `Written: ${friendlyWvPath}`;
    }

    case 'write_workflow': {
      const { path, meta, steps } = inp as { path: string; meta: Record<string, unknown>; steps: unknown[] };
      const { path: wwPath, id } = resolveNamedPath(path, pathToId, idToPath, friendlyToActual);
      const friendlyWwPath = translateToFriendly(wwPath, idToPath);
      if (writtenPaths.has(wwPath)) return `Error: "${friendlyWwPath}" was already written this task. Use edit_workflow for corrections.`;
      const resolvedSteps = assignStepIds(steps as Record<string, unknown>[]);
      resolveNodeRefsInSteps(resolvedSteps, nodeNameToId);
      const content = resolvePathRefs(JSON.stringify({ id, meta: { ...meta, id }, steps: resolvedSteps }, null, 2), pathToId);
      engine.writeFile(wwPath, content);
      writtenPaths.add(wwPath);
      return `Written: ${friendlyWwPath}`;
    }

    case 'write_trigger': {
      const { path, name: triggerName, trigger, pageScope, isAppTrigger, steps } = inp as {
        path: string; name: string; trigger: string; pageScope?: string; isAppTrigger?: boolean; steps: unknown[];
      };
      if (writtenPaths.has(path)) return `Error: "${path}" was already written this task. Use edit_trigger for corrections.`;
      const id = path.split('/').pop()!;
      const resolvedSteps = assignStepIds(steps as Record<string, unknown>[]);
      resolveNodeRefsInSteps(resolvedSteps, nodeNameToId);
      const fileObj: Record<string, unknown> = {
        id,
        meta: {
          id,
          name: triggerName,
          trigger,
          isTrigger: true,
          ...(pageScope ? { pageScope } : {}),
          ...(isAppTrigger ? { isAppTrigger: true } : {}),
        },
        steps: resolvedSteps,
      };
      engine.writeFile(path, resolvePathRefs(JSON.stringify(fileObj, null, 2), pathToId));
      writtenPaths.add(path);
      return `Written: ${path}`;
    }

    case 'write_routes': {
      if (writtenPaths.has('routes')) return 'Error: "routes" was already written this task. Use edit_route for corrections.';
      const { routes, defaultRedirect } = inp as { routes: unknown[]; defaultRedirect?: string };
      const fileObj: Record<string, unknown> = { routes };
      if (defaultRedirect) fileObj.defaultRedirect = defaultRedirect;
      engine.writeFile('routes', JSON.stringify(fileObj, null, 2));
      writtenPaths.add('routes');
      return `Written: routes`;
    }

    case 'write_datasource': {
      const { path, ...rest } = inp;
      const { path: wdPath, id } = resolveNamedPath(path as string, pathToId, idToPath, friendlyToActual);
      const friendlyWdPath = translateToFriendly(wdPath, idToPath);
      if (writtenPaths.has(wdPath)) return `Error: "${friendlyWdPath}" was already written this task. Use edit_datasource for corrections.`;
      const content = resolvePathRefs(JSON.stringify({ id, ...rest }, null, 2), pathToId);
      engine.writeFile(wdPath, content);
      writtenPaths.add(wdPath);
      return `Written: ${friendlyWdPath}`;
    }

    case 'write_formula': {
      const { path, params = [], ...rest } = inp as { path: string; params?: Record<string, unknown>[]; [k: string]: unknown };
      if (writtenPaths.has(path)) return `Error: "${path}" was already written this task. Use edit_formula for corrections.`;
      const resolvedParams = (params as Record<string, unknown>[]).map(p => ({
        id: crypto.randomUUID(),
        ...p,
      }));
      engine.writeFile(path, resolvePathRefs(JSON.stringify({ ...rest, params: resolvedParams }, null, 2), pathToId));
      writtenPaths.add(path);
      return `Written: ${path}`;
    }

    case 'write_component': {
      const { path: compPath, content: compContent, workflows: compWorkflows, formulas: compFormulas, ...compRest } = inp as {
        path: string;
        content: unknown;
        workflows?: Record<string, { steps?: unknown[]; [k: string]: unknown }>;
        formulas?: Record<string, { params?: Record<string, unknown>[]; [k: string]: unknown }>;
        [k: string]: unknown;
      };
      const compFilePath = `${compPath as string}/component`;
      if (writtenPaths.has(compFilePath)) return `Error: "${compFilePath}" was already written this task. Use edit_component for corrections.`;
      const compId = (compPath as string).split('/').pop()!;
      const resolvedContent = resolveStyleNodes(compContent ?? { type: 'Box', props: {}, children: [] });
      const contentArr = Array.isArray(resolvedContent) ? resolvedContent : [resolvedContent];
      assignNodeIds(contentArr as Record<string, unknown>[]);
      registerNodeNames(contentArr as Record<string, unknown>[], nodeNameToId, idToPath);
      const resolvedWorkflows = compWorkflows
        ? Object.fromEntries(Object.entries(compWorkflows).map(([k, wf]) => [
            k, { ...wf, steps: Array.isArray(wf.steps) ? assignStepIds(wf.steps as Record<string, unknown>[]) : [] },
          ]))
        : undefined;
      const resolvedFormulas = compFormulas
        ? Object.fromEntries(Object.entries(compFormulas).map(([k, f]) => [
            k, { ...f, params: Array.isArray(f.params) ? f.params.map((p: Record<string, unknown>) => ({ id: crypto.randomUUID(), ...p })) : [] },
          ]))
        : undefined;
      const compModel: Record<string, unknown> = {
        id: compId,
        content: contentArr.length === 1 ? contentArr[0] : contentArr,
        ...compRest,
        ...(resolvedWorkflows ? { workflows: resolvedWorkflows } : {}),
        ...(resolvedFormulas  ? { formulas: resolvedFormulas }  : {}),
      };
      engine.writeFile(compFilePath, resolvePathRefs(JSON.stringify(compModel, null, 2), pathToId));
      writtenPaths.add(compFilePath);
      return `Written: ${compFilePath}`;
    }

    case 'write_group': {
      const { page, group, ui } = inp as { page: string; group: string; ui: unknown[] };
      const wgPath = `pages/${page}/groups/${group}`;
      if (writtenPaths.has(wgPath)) return `Error: "${wgPath}" was already written this task. Use edit_page to update nodes in this group.`;
      const resolved = resolveStyleNodes({ ui }) as { ui: unknown[] };
      assignNodeIds(resolved.ui as Record<string, unknown>[]);
      registerNodeNames(resolved.ui as Record<string, unknown>[], nodeNameToId, idToPath);
      engine.writeFile(wgPath, resolvePathRefs(JSON.stringify(resolved.ui, null, 2), pathToId));
      writtenPaths.add(wgPath);
      return `Written: ${wgPath}`;
    }

    case 'edit_page': {
      const { path, node_name, changes } = inp as { path: string; node_name: string; changes: Record<string, unknown> };
      const actualPath = friendlyToActual.get(path) ?? path;
      const resolvedChanges = JSON.parse(resolvePathRefs(JSON.stringify(changes), pathToId)) as Record<string, unknown>;
      const raw = engine.readRaw(actualPath);
      const file = JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[];
      const isArray = Array.isArray(file);
      const uiArr = isArray ? (file as Record<string, unknown>[]) : ((file as Record<string, unknown>).ui as Record<string, unknown>[] ?? []);
      const { nodes, found } = patchNodeByName(uiArr, node_name, resolvedChanges);
      if (!found) return `Error: no node named "${node_name}" found in ${path}`;
      const newFile = isArray ? nodes : { ...(file as Record<string, unknown>), ui: nodes };
      engine.writeFile(actualPath, JSON.stringify(newFile, null, 2));
      return `Patched node "${node_name}" in ${path}`;
    }

    case 'edit_workflow': {
      const { path, step_name, changes } = inp as { path: string; step_name: string; changes: Record<string, unknown> };
      const actualPath = friendlyToActual.get(path) ?? path;
      const resolvedChanges = JSON.parse(resolvePathRefs(JSON.stringify(changes), pathToId)) as Record<string, unknown>;
      const raw = engine.readRaw(actualPath);
      const wf = JSON.parse(raw) as { steps?: Record<string, unknown>[] };
      const steps = (wf.steps ?? []) as Record<string, unknown>[];
      const { steps: newSteps, found } = patchStepByName(steps, step_name, resolvedChanges);
      if (!found) return `Error: no step named "${step_name}" found in ${path}`;
      engine.writeFile(actualPath, JSON.stringify({ ...wf, steps: newSteps }, null, 2));
      return `Patched step "${step_name}" in ${path}`;
    }

    case 'edit_trigger': {
      const { path, step_name, changes } = inp as { path: string; step_name: string; changes: Record<string, unknown> };
      const actualPath = friendlyToActual.get(path) ?? path;
      const resolvedChanges = JSON.parse(resolvePathRefs(JSON.stringify(changes), pathToId)) as Record<string, unknown>;
      const raw = engine.readRaw(actualPath);
      const tr = JSON.parse(raw) as { steps?: Record<string, unknown>[] };
      const steps = (tr.steps ?? []) as Record<string, unknown>[];
      const { steps: newSteps, found } = patchStepByName(steps, step_name, resolvedChanges);
      if (!found) return `Error: no step named "${step_name}" found in ${path}`;
      engine.writeFile(actualPath, JSON.stringify({ ...tr, steps: newSteps }, null, 2));
      return `Patched step "${step_name}" in ${path}`;
    }

    case 'edit_variable': {
      const { path, ...changes } = inp as { path: string; [k: string]: unknown };
      const actualPath = friendlyToActual.get(path) ?? path;
      const existing = JSON.parse(engine.readRaw(actualPath));
      const resolvedChanges = JSON.parse(resolvePathRefs(JSON.stringify(changes), pathToId));
      engine.writeFile(actualPath, JSON.stringify({ ...existing, ...resolvedChanges }, null, 2));
      return `Patched: ${path}`;
    }

    case 'edit_datasource': {
      const { path, ...changes } = inp as { path: string; [k: string]: unknown };
      const actualPath = friendlyToActual.get(path) ?? path;
      const existing = JSON.parse(engine.readRaw(actualPath));
      const resolvedChanges = JSON.parse(resolvePathRefs(JSON.stringify(changes), pathToId));
      engine.writeFile(actualPath, JSON.stringify({ ...existing, ...resolvedChanges }, null, 2));
      return `Patched: ${path}`;
    }

    case 'edit_formula': {
      const { path, params, ...rest } = inp as { path: string; params?: Record<string, unknown>[]; [k: string]: unknown };
      const actualPath = friendlyToActual.get(path) ?? path;
      const existing = JSON.parse(engine.readRaw(actualPath));
      const updates: Record<string, unknown> = JSON.parse(resolvePathRefs(JSON.stringify(rest), pathToId));
      if (params) updates.params = params.map(p => ({ id: crypto.randomUUID(), ...p }));
      engine.writeFile(actualPath, JSON.stringify({ ...existing, ...updates }, null, 2));
      return `Patched: ${path}`;
    }

    case 'edit_route': {
      const { route_path, ...changes } = inp as { route_path: string; [k: string]: unknown };
      const routesFile = JSON.parse(engine.readRaw('routes')) as { routes: Record<string, unknown>[]; [k: string]: unknown };
      let found = false;
      const newRoutes = (routesFile.routes ?? []).map(r => {
        if ((r.path as string) === route_path) { found = true; return { ...r, ...changes }; }
        return r;
      });
      if (!found) return `Error: no route with path "${route_path}" found`;
      engine.writeFile('routes', JSON.stringify({ ...routesFile, routes: newRoutes }, null, 2));
      return `Patched route "${route_path}"`;
    }

    case 'edit_component': {
      const { path, node_name, changes } = inp as { path: string; node_name?: string; changes: Record<string, unknown> };
      const resolvedChanges = JSON.parse(resolvePathRefs(JSON.stringify(changes), pathToId)) as Record<string, unknown>;
      const file = JSON.parse(engine.readRaw(path)) as Record<string, unknown>;
      if (node_name) {
        const content = file.content;
        const contentArr = Array.isArray(content)
          ? (content as Record<string, unknown>[])
          : [content as Record<string, unknown>];
        const { nodes, found } = patchNodeByName(contentArr, node_name, resolvedChanges);
        if (!found) return `Error: no node named "${node_name}" found in ${path}`;
        const newContent = Array.isArray(content) ? nodes : nodes[0];
        engine.writeFile(path, JSON.stringify({ ...file, content: newContent }, null, 2));
        return `Patched node "${node_name}" in ${path}`;
      } else {
        engine.writeFile(path, JSON.stringify({ ...file, ...resolvedChanges }, null, 2));
        return `Patched: ${path}`;
      }
    }

    case 'write_theme': {
      if (writtenPaths.has('design/theme')) return 'Error: "design/theme" was already written this task. Use edit_theme for corrections.';
      const { overrides, darkOverrides } = inp as { overrides?: Record<string, string>; darkOverrides?: Record<string, string> };
      engine.writeFile('design/theme', JSON.stringify({ overrides: overrides ?? {}, darkOverrides: darkOverrides ?? {} }, null, 2));
      writtenPaths.add('design/theme');
      return `Written: design/theme`;
    }

    case 'edit_theme': {
      const { overrides, darkOverrides } = inp as { overrides?: Record<string, string>; darkOverrides?: Record<string, string> };
      let existing: { overrides?: Record<string, string>; darkOverrides?: Record<string, string> } = {};
      try { existing = JSON.parse(engine.readRaw('design/theme')); } catch { /* new */ }
      engine.writeFile('design/theme', JSON.stringify({
        overrides:     { ...(existing.overrides     ?? {}), ...(overrides     ?? {}) },
        darkOverrides: { ...(existing.darkOverrides ?? {}), ...(darkOverrides ?? {}) },
      }, null, 2));
      return `Patched: design/theme`;
    }

    case 'write_colors': {
      if (writtenPaths.has('design/colors')) return 'Error: "design/colors" was already written this task. Use edit_color for corrections.';
      const { colors } = inp as { colors: unknown[] };
      engine.writeFile('design/colors', JSON.stringify(colors, null, 2));
      writtenPaths.add('design/colors');
      return `Written: design/colors`;
    }

    case 'edit_color': {
      const { id, ...fields } = inp as { id: string; [k: string]: unknown };
      let colors: Record<string, unknown>[] = [];
      try { colors = JSON.parse(engine.readRaw('design/colors')); } catch { /* new */ }
      const idx = colors.findIndex(c => c.id === id);
      if (idx >= 0) { colors[idx] = { ...colors[idx], ...fields }; } else { colors.push({ id, ...fields }); }
      engine.writeFile('design/colors', JSON.stringify(colors, null, 2));
      return `Patched color "${id}"`;
    }

    case 'write_file': {
      const wfPath = inp.path as string;
      if (writtenPaths.has(wfPath)) return `Error: "${wfPath}" was already written this task.`;
      let content = inp.content as string;
      try {
        const parsed = JSON.parse(content);
        content = resolvePathRefs(JSON.stringify(resolveStyleNodes(parsed), null, 2), pathToId);
      } catch { /* not JSON, write as-is */ }
      engine.writeFile(wfPath, content);
      writtenPaths.add(wfPath);
      return `Written: ${wfPath}`;
    }

    case 'delete_file': {
      const rawPath = inp.path as string;
      const actualPath = friendlyToActual.get(rawPath) ?? rawPath;
      // Block deletion if any written file still references this path
      for (const wp of writtenPaths) {
        if (wp === actualPath) continue;
        try {
          const raw = engine.readRaw(wp);
          if (raw.includes(rawPath)) {
            return `Error: "${rawPath}" is still referenced in ${wp} — update all references before deleting.`;
          }
        } catch { /* file may not exist */ }
      }
      engine.deleteFile(actualPath);
      writtenPaths.delete(actualPath);
      pathToId.delete(rawPath);
      idToPath.delete(actualPath.split('/').pop()!);
      friendlyToActual.delete(rawPath);
      // Cascade: if deleting a page, remove all child files too
      if (/^pages\/[^/]+\/page$/.test(rawPath)) {
        const prefix = rawPath.replace(/\/page$/, '/');
        for (const childPath of [...engine.allPaths]) {
          if (childPath.startsWith(prefix)) {
            try { engine.deleteFile(childPath); } catch { /* already gone */ }
            writtenPaths.delete(childPath);
          }
        }
      }
      return `Deleted: ${rawPath}`;
    }

    case 'search_images': {
      const results = await searchImages(
        inp.query as string,
        inp.count !== undefined ? Math.min(8, Number(inp.count)) : 4,
      );
      return JSON.stringify(results);
    }

    case 'search_videos': {
      const results = await searchPexelsVideos(
        inp.query as string,
        inp.count !== undefined ? Math.min(8, Number(inp.count)) : 4,
      );
      return JSON.stringify(results);
    }

    case 'search_icons': {
      const icons = await searchIconify(
        inp.query as string,
        inp.prefix as string | undefined,
        inp.count !== undefined ? Math.min(20, Number(inp.count)) : 10,
      );
      return JSON.stringify(icons);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
