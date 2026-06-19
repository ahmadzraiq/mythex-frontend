'use client';

/**
 * useWebContainerDsl
 *
 * Browser-side DSL agent hook.
 *
 * Architecture:
 *  - File system: @webcontainer/api (browser WASM, zero server cost)
 *                 Falls back to an in-memory Map if WebContainer fails to boot.
 *  - AI calls:   Streaming fetch to /api/claude-proxy/v1/messages (injects real API key server-side)
 *  - Tool loop:  Runs entirely in browser JS. Tool handlers (Write/Read/Edit/Grep/LS)
 *                call WebContainer's fs API.
 *  - Compilation: After every Write/Edit → POST /api/dsl/compile-all → applyVirtualFile → live canvas update
 *  - History:    Last MAX_HISTORY_MESSAGES messages kept; first user message pinned as anchor.
 *  - Tokens:     Captured from SSE message_start / message_delta events; recorded to backend per round.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DSL_SYSTEM_PROMPT } from '@/lib/dsl/system-prompt';
import { useBuilderStore } from './_store';
import { useDslSourcesStore } from './_dsl-sources-store';
import { applyVirtualFile } from './_virtual-files';
import type { AiChatMessage, AiToolCall } from './_store-types';

// ── WebContainer singleton ────────────────────────────────────────────────────

type BrowserVFS = {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  glob(): Promise<string[]>;
};

let wcBootPromise: Promise<BrowserVFS> | null = null;

async function bootBrowserVFS(): Promise<BrowserVFS> {
  try {
    const { WebContainer } = await import('@webcontainer/api');
    const wc = await WebContainer.boot();
    const allPaths = new Set<string>();

    return {
      async readFile(path) {
        return wc.fs.readFile(path, 'utf-8');
      },
      async writeFile(path, content) {
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) {
          const dir = parts.slice(0, i).join('/');
          try { await wc.fs.mkdir(dir, { recursive: true }); } catch { /* already exists */ }
        }
        await wc.fs.writeFile(path, content);
        allPaths.add(path);
      },
      async readdir(dir) {
        try {
          const entries = await wc.fs.readdir(dir, { withFileTypes: true });
          return entries.map(e => (typeof e === 'string' ? e : e.name));
        } catch {
          return [];
        }
      },
      async glob() { return [...allPaths]; },
    };
  } catch {
    console.warn('[useWebContainerDsl] WebContainer boot failed — using in-memory VFS fallback');
    const mem = new Map<string, string>();
    return {
      async readFile(path) { return mem.get(path) ?? ''; },
      async writeFile(path, content) { mem.set(path, content); },
      async readdir(dir) {
        const prefix = dir.endsWith('/') ? dir : dir + '/';
        const children = new Set<string>();
        for (const k of mem.keys()) {
          if (k.startsWith(prefix)) children.add(k.slice(prefix.length).split('/')[0]!);
        }
        return [...children];
      },
      async glob() { return [...mem.keys()]; },
    };
  }
}

function getVFS(): Promise<BrowserVFS> {
  if (!wcBootPromise) wcBootPromise = bootBrowserVFS();
  return wcBootPromise;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const BROWSER_TOOLS = [
  {
    name: 'Write',
    description: 'Create or overwrite a file with given content. Use relative paths under src/.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Relative path, e.g. src/calculator/page.tsx' },
        content:   { type: 'string', description: 'Full file content' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'Read',
    description: 'Read the content of an existing file.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Relative file path' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Edit',
    description: 'Replace an exact string in an existing file. old_string must match exactly.',
    input_schema: {
      type: 'object',
      properties: {
        file_path:  { type: 'string' },
        old_string: { type: 'string', description: 'Exact text to find' },
        new_string: { type: 'string', description: 'Text to replace it with' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'LS',
    description: 'List files in a directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to list, e.g. src/' },
      },
      required: ['path'],
    },
  },
  {
    name: 'Grep',
    description: 'Search file contents with a regex or plain text pattern.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex or plain text pattern' },
        path:    { type: 'string', description: 'Directory or file to search (optional)' },
      },
      required: ['pattern'],
    },
  },
] as const;

// ── History management ────────────────────────────────────────────────────────

const MAX_HISTORY_MESSAGES = 60;
/** Max characters to inject as file preamble (~20k tokens, well within the 200k window) */
const MAX_PREAMBLE_CHARS = 80_000;

type ConvMessage = {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; [k: string]: unknown }>;
};

/**
 * Trim history to avoid context window overflow.
 * Keeps the very first user message (project anchor) and the most recent messages.
 */
function trimHistory(history: ConvMessage[], max: number): ConvMessage[] {
  if (history.length <= max) return history;
  const anchor = history[0];
  const tail = history.slice(-(max - 1));
  // Ensure tail starts with a user message (never start with an orphaned assistant turn)
  let start = 0;
  while (start < tail.length && tail[start]?.role !== 'user') start++;
  const trimmed = tail.slice(start);
  // Avoid duplicating the anchor if the tail already starts with it
  if (trimmed.length > 0 && anchor && trimmed[0] === anchor) return trimmed;
  return anchor ? [anchor, ...trimmed] : trimmed;
}

/**
 * Build a "here is the current codebase" preamble to inject at the start of a
 * fresh conversation so Claude can continue building on top of existing files.
 * Capped at MAX_PREAMBLE_CHARS to avoid blowing the context window on large projects.
 */
function buildFilePreamble(sources: Record<string, string>): string {
  let out = '## Existing project files — continue building on top of these:\n\n';
  let total = 0;
  for (const [path, content] of Object.entries(sources)) {
    const block = `### ${path}\n\`\`\`\n${content}\n\`\`\`\n\n`;
    if (total + block.length > MAX_PREAMBLE_CHARS) {
      out += `_(remaining files omitted — context limit reached)_\n`;
      break;
    }
    out += block;
    total += block.length;
  }
  return out;
}

// ── Compile all sources and apply to canvas ───────────────────────────────────

export async function compileAllAndApply(
  allSources: Record<string, string>,
  projectId: string | undefined,
): Promise<void> {
  if (!Object.keys(allSources).length) return;
  try {
    const res = await fetch('/api/dsl/compile-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: allSources, projectId }),
    });
    if (!res.ok) {
      console.warn('[DSL compile-all] HTTP', res.status, await res.text().catch(() => ''));
      return;
    }
    const { events } = await res.json() as { events?: Array<{ type: string; path: string; content: string }> };
    if (!Array.isArray(events)) return;
    for (const ev of events) {
      const result = applyVirtualFile(useBuilderStore.getState(), ev.path, ev.content);
      if (!result.ok) console.warn('[DSL compile-all] applyVirtualFile failed:', ev.path, result.error);
    }
    console.log(`[DSL compile-all] applied ${events.length} events`);
  } catch (err) {
    console.warn('[DSL compile-all] failed:', err);
  }
}

// ── Token recording (fire-and-forget) ────────────────────────────────────────

function recordRoundTokens(
  inputTokens: number,
  outputTokens: number,
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  if (!workspaceId || (inputTokens + outputTokens) === 0) return;
  fetch('/api/ai/token-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, projectId, inputTokens, outputTokens, model: 'claude-sonnet-4-5' }),
  }).catch(err => console.warn('[DSL token-record] failed:', err));
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, string>,
  vfs: BrowserVFS,
  onSourceUpdate: (path: string, content: string) => void,
): Promise<string> {
  try {
    switch (name) {
      case 'Write': {
        const { file_path, content } = input;
        await vfs.writeFile(file_path, content);
        onSourceUpdate(file_path, content);
        return `Written: ${file_path}`;
      }
      case 'Read': {
        const { file_path } = input;
        const content = await vfs.readFile(file_path);
        return content || `(empty file: ${file_path})`;
      }
      case 'Edit': {
        const { file_path, old_string, new_string } = input;
        const current = await vfs.readFile(file_path);
        if (!current.includes(old_string)) return `Error: old_string not found in ${file_path}`;
        const updated = current.replace(old_string, new_string);
        await vfs.writeFile(file_path, updated);
        onSourceUpdate(file_path, updated);
        return `Edited: ${file_path}`;
      }
      case 'LS': {
        const { path = 'src' } = input;
        const all = await vfs.glob();
        const filtered = all.filter(p => p.startsWith(path));
        return filtered.length > 0 ? filtered.join('\n') : '(no files)';
      }
      case 'Grep': {
        const { pattern, path: searchPath } = input;
        const all = await vfs.glob();
        const files = searchPath ? all.filter(p => p.startsWith(searchPath)) : all;
        const results: string[] = [];
        try {
          const re = new RegExp(pattern, 'gm');
          for (const fp of files) {
            const content = await vfs.readFile(fp);
            const lines = content.split('\n');
            lines.forEach((line, i) => {
              if (re.test(line)) results.push(`${fp}:${i + 1}: ${line.trim()}`);
              re.lastIndex = 0;
            });
          }
        } catch {
          for (const fp of files) {
            const content = await vfs.readFile(fp);
            content.split('\n').forEach((line, i) => {
              if (line.includes(pattern)) results.push(`${fp}:${i + 1}: ${line.trim()}`);
            });
          }
        }
        return results.length > 0 ? results.join('\n') : '(no matches)';
      }
      default:
        return `Error: unknown tool ${name}`;
    }
  } catch (err) {
    return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Anthropic content block types (minimal) ───────────────────────────────────

type AssistantTextBlock  = { type: 'text'; text: string };
type AssistantToolBlock  = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type AssistantBlock      = AssistantTextBlock | AssistantToolBlock;

// ── Main hook ─────────────────────────────────────────────────────────────────

export interface DslTokenStats {
  input: number;
  output: number;
}

export function useWebContainerDsl(projectId?: string, workspaceId?: string) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [dslSources, setDslSources] = useState<Record<string, string>>({});
  const [tokenStats, setTokenStats] = useState<DslTokenStats>({ input: 0, output: 0 });

  const abortRef         = useRef<AbortController | null>(null);
  const sourcesRef       = useRef<Record<string, string>>({});
  const historyRef       = useRef<ConvMessage[]>([]);
  const sessionTokensRef = useRef<DslTokenStats>({ input: 0, output: 0 });
  // Mirror of messages state — always current so async sendMessage can read it without stale closures
  const messagesRef      = useRef<AiChatMessage[]>([]);

  const { setSources: setSharedSources, setSource: setSharedSource } = useDslSourcesStore();

  useEffect(() => { sourcesRef.current = dslSources; }, [dslSources]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Load persisted sources + chat messages + seed VFS on mount / project switch
  useEffect(() => {
    if (!projectId) return;
    // Clear stale messages immediately when switching projects
    setMessages([]);
    messagesRef.current = [];
    historyRef.current = [];

    fetch(`/api/projects/${projectId}/config/meta`)
      .then(r => r.json())
      .then(async (data: unknown) => {
        const meta = data as Record<string, unknown> | undefined;

        // Seed builder.ts into VFS so the AI can read the DSL API reference
        try {
          const builderRes = await fetch('/api/builder-source');
          if (builderRes.ok) {
            const builderSrc = await builderRes.text();
            const vfs = await getVFS();
            await vfs.writeFile('builder.ts', builderSrc);
          }
        } catch { /* non-critical */ }

        // Restore source files into VFS
        const sources = meta?.dslSources as Record<string, string> | undefined;
        if (sources && Object.keys(sources).length > 0) {
          setDslSources(sources);
          setSharedSources(sources);
          sourcesRef.current = sources;
          const vfs = await getVFS();
          for (const [path, content] of Object.entries(sources)) {
            await vfs.writeFile(path, content);
          }
          // Recompile with the latest compiler so the builder canvas reflects the restored VFS state
          await compileAllAndApply(sources, projectId);
        }

        // Restore persisted chat display messages
        const savedMessages = meta?.dslChatMessages as AiChatMessage[] | undefined;
        if (savedMessages?.length) {
          setMessages(savedMessages);
          messagesRef.current = savedMessages;
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const sendMessage = useCallback(async (userText: string) => {
    if (!userText.trim() || isStreaming) return;

    const now = new Date().toISOString();
    const userMsg: AiChatMessage = { id: `${Date.now()}-u`, role: 'user', content: userText, createdAt: now };
    const assistantId = `${Date.now()}-a`;
    const assistantMsg: AiChatMessage = {
      id: assistantId, role: 'assistant', content: '', toolCalls: [], createdAt: now, streaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      // ── Quota pre-check ─────────────────────────────────────────────────────
      if (workspaceId) {
        try {
          const quotaRes = await fetch(`/api/ai/token-usage?workspaceId=${encodeURIComponent(workspaceId)}`);
          if (quotaRes.ok) {
            const quota = await quotaRes.json() as { isSuperAdmin?: boolean; remaining?: number | null };
            if (!quota.isSuperAdmin && quota.remaining !== null && quota.remaining !== undefined && quota.remaining <= 0) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: 'AI token quota exhausted for this billing period. Please upgrade your plan.', streaming: false }
                  : m
              ));
              setIsStreaming(false);
              return;
            }
          }
        } catch { /* non-critical — allow through if check fails */ }
      }

      const vfs = await getVFS();

      const fileList = await vfs.glob();
      const repoMap = fileList.length > 0
        ? `\n\n## Current files in workspace\n${fileList.map(f => `- ${f}`).join('\n')}`
        : '';
      const systemPrompt = DSL_SYSTEM_PROMPT + repoMap;

      // Append new user turn and trim to context window budget
      const fullHistory: ConvMessage[] = [...historyRef.current, { role: 'user', content: userText }];
      const conversationMessages: ConvMessage[] = trimHistory(fullHistory, MAX_HISTORY_MESSAGES);

      // Build the message list to send to Anthropic.
      // On a fresh conversation (no history) with existing files, prepend a read-only
      // snapshot of all source files so Claude can continue building on top of what exists.
      // These synthetic messages are NOT saved to historyRef — they're re-injected fresh
      // each time so they always reflect the current VFS state.
      const apiMessages: ConvMessage[] = [...conversationMessages];
      if (historyRef.current.length === 0 && Object.keys(sourcesRef.current).length > 0) {
        const preamble = buildFilePreamble(sourcesRef.current);
        // Prepend in reverse order: unshift(assistant) then unshift(user) → [user, assistant, ...rest]
        apiMessages.unshift({
          role: 'assistant',
          content: "I can see the existing project files above. I'll continue building on top of them.",
        });
        apiMessages.unshift({
          role: 'user',
          content: preamble,
        });
      }

      const updateAssistant = (updater: (m: AiChatMessage) => AiChatMessage) => {
        setMessages(prev => prev.map(m => m.id === assistantId ? updater(m) : m));
      };

      const onSourceUpdate = (path: string, content: string) => {
        const next = { ...sourcesRef.current, [path]: content };
        sourcesRef.current = next;
        setDslSources(next);
        setSharedSource(path, content);
      };

      // ── Agentic SSE loop ─────────────────────────────────────────────────────
      // Round 1 uses apiMessages (may include preamble); subsequent rounds use
      // the growing conversationMessages (preamble not repeated in history).
      let currentMessages: ConvMessage[] = apiMessages;

      while (true) {
        if (signal.aborted) break;

        // State for this round
        const assistantContent: AssistantBlock[] = [];
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
        let stopReason = 'end_turn';
        let roundInputTokens  = 0;
        let roundOutputTokens = 0;

        // Per-block accumulator: index → state
        const blockMap = new Map<number, {
          type: 'text' | 'tool_use';
          id?: string;
          name?: string;
          inputAccum: string;
        }>();

        const res = await fetch('/api/claude-proxy/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 8192,
            system: systemPrompt,
            tools: BROWSER_TOOLS,
            messages: currentMessages,
            stream: true,
          }),
          signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          updateAssistant(m => ({ ...m, content: m.content || `Error: ${errText}`, streaming: false }));
          break;
        }

        // ── Read SSE stream ──────────────────────────────────────────────────
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let doneReading = false;

        while (!doneReading) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6);
            if (payload === '[DONE]') { doneReading = true; break; }

            let ev: Record<string, unknown>;
            try { ev = JSON.parse(payload); } catch { continue; }
            const evType = ev.type as string;

            // ── message_start: capture input tokens ──────────────────────────
            if (evType === 'message_start') {
              const msg = ev.message as Record<string, unknown> | undefined;
              const usage = msg?.usage as Record<string, unknown> | undefined;
              roundInputTokens = (usage?.input_tokens as number) ?? 0;
            }

            // ── content_block_start: register new block ──────────────────────
            else if (evType === 'content_block_start') {
              const idx   = ev.index as number;
              const block = ev.content_block as { type: string; id?: string; name?: string } | undefined;
              if (!block) continue;

              if (block.type === 'text') {
                blockMap.set(idx, { type: 'text', inputAccum: '' });
                assistantContent[idx] = { type: 'text', text: '' };
              } else if (block.type === 'tool_use') {
                blockMap.set(idx, { type: 'tool_use', id: block.id, name: block.name, inputAccum: '' });
                assistantContent[idx] = { type: 'tool_use', id: block.id!, name: block.name!, input: {} };
              }
            }

            // ── content_block_delta: stream text / accumulate tool input ──────
            else if (evType === 'content_block_delta') {
              const idx   = ev.index as number;
              const delta = ev.delta as { type: string; text?: string; partial_json?: string } | undefined;
              const state = blockMap.get(idx);
              if (!delta || !state) continue;

              if (delta.type === 'text_delta' && delta.text) {
                const block = assistantContent[idx] as AssistantTextBlock | undefined;
                if (block) block.text += delta.text;
                updateAssistant(m => ({ ...m, content: m.content + delta.text! }));
              } else if (delta.type === 'input_json_delta' && delta.partial_json !== undefined) {
                state.inputAccum += delta.partial_json;
              }
            }

            // ── content_block_stop: execute tool if tool_use ─────────────────
            else if (evType === 'content_block_stop') {
              const idx   = ev.index as number;
              const state = blockMap.get(idx);
              if (!state || state.type !== 'tool_use') continue;

              let toolInput: Record<string, string> = {};
              try { toolInput = JSON.parse(state.inputAccum || '{}') as Record<string, string>; } catch { /* malformed input */ }

              const toolBlock = assistantContent[idx] as AssistantToolBlock | undefined;
              if (toolBlock) toolBlock.input = toolInput;

              // Show pending tool call in UI
              const newCall: AiToolCall = {
                name: state.name!,
                input: toolInput,
                status: 'pending',
                timestamp: Date.now(),
              };
              updateAssistant(m => ({ ...m, toolCalls: [...(m.toolCalls ?? []), newCall] }));

              // Execute tool
              const output = await executeTool(state.name!, toolInput, vfs, onSourceUpdate);

              // Compile immediately after any write/edit to update the canvas live
              if (state.name === 'Write' || state.name === 'Edit') {
                await compileAllAndApply(sourcesRef.current, projectId);
              }

              // Mark tool call resolved
              updateAssistant(m => {
                const calls = [...(m.toolCalls ?? [])];
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i]!.name === state.name && calls[i]!.status === 'pending') {
                    calls[i] = { ...calls[i]!, result: output, status: 'success' };
                    break;
                  }
                }
                return { ...m, toolCalls: calls };
              });

              toolResults.push({ type: 'tool_result', tool_use_id: state.id!, content: output });
            }

            // ── message_delta: capture stop_reason + output tokens ────────────
            else if (evType === 'message_delta') {
              const delta = ev.delta as { stop_reason?: string } | undefined;
              const usage = ev.usage as { output_tokens?: number } | undefined;
              stopReason = delta?.stop_reason ?? 'end_turn';
              roundOutputTokens = usage?.output_tokens ?? 0;
            }

            // ── message_stop: end of this round ──────────────────────────────
            else if (evType === 'message_stop') {
              doneReading = true;
              break;
            }
          }
        }

        // Accumulate session tokens
        sessionTokensRef.current = {
          input:  sessionTokensRef.current.input  + roundInputTokens,
          output: sessionTokensRef.current.output + roundOutputTokens,
        };
        setTokenStats({ ...sessionTokensRef.current });

        // Record tokens to backend (fire-and-forget)
        recordRoundTokens(roundInputTokens, roundOutputTokens, workspaceId, projectId);

        // Build ordered assistant content (filter out sparse-array gaps)
        const contentBlocks = assistantContent.filter(Boolean);

        // Push this round into the working conversation
        conversationMessages.push({ role: 'assistant', content: contentBlocks });
        if (toolResults.length > 0) {
          conversationMessages.push({ role: 'user', content: toolResults });
        }

        // Round 2+ sends conversationMessages directly (no preamble re-injection)
        currentMessages = conversationMessages;

        if (stopReason !== 'tool_use') break;
      }

      // Persist final conversation back to historyRef for next sendMessage call
      historyRef.current = conversationMessages;

      // Persist sources to project DB
      const finalSources = sourcesRef.current;
      if (projectId && Object.keys(finalSources).length > 0) {
        fetch(`/api/projects/${projectId}/config/meta`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dslSources: finalSources }),
        }).catch(() => {});
      }

      // Persist display messages (text-only, last 50) to survive page refresh / project switch
      if (projectId) {
        const displayMessages = messagesRef.current.slice(-50).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          toolCalls: m.toolCalls?.map(tc => ({ name: tc.name, status: tc.status })),
        }));
        if (displayMessages.length > 0) {
          fetch(`/api/projects/${projectId}/config/meta`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dslChatMessages: displayMessages }),
          }).catch(() => {});
        }
      }

    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `Connection error: ${(err as Error).message}`, streaming: false }
            : m
        ));
      }
    } finally {
      setIsStreaming(false);
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m));
    }
  }, [isStreaming, projectId, workspaceId]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    messagesRef.current = [];
    setIsStreaming(false);
    historyRef.current = [];
    sessionTokensRef.current = { input: 0, output: 0 };
    setTokenStats({ input: 0, output: 0 });
  }, []);

  const recompileAll = useCallback(async () => {
    await compileAllAndApply(sourcesRef.current, projectId);
  }, [projectId]);

  return { messages, isStreaming, sendMessage, clear, recompileAll, dslSources, tokenStats };
}
