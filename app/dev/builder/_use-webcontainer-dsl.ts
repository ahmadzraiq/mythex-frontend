'use client';

/**
 * useWebContainerDsl
 *
 * Browser-side hook for the DSL agent.
 *
 * Architecture:
 *  - AI runs server-side via @anthropic-ai/claude-agent-sdk (POST /api/ai/dsl-agent)
 *  - Claude uses native Read/Write/Edit/Glob/Grep tools against /tmp/dsl-{projectId}/
 *  - This hook is a simple SSE consumer — no WebContainer, no tool executor
 *  - Compilation happens inline on the server after the agent finishes
 *  - Browser receives a `compiled` event and applies canvas updates via applyVirtualFile
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBuilderStore } from './_store';
import { useDslSourcesStore } from './_dsl-sources-store';
import { applyVirtualFile } from './_virtual-files';
import type { AiChatMessage, AiToolCall } from './_store-types';

// ── Compile helper (kept for _files-panel.tsx compatibility) ─────────────────

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

// ── Token stats ───────────────────────────────────────────────────────────────

export interface DslTokenStats {
  input: number;
  output: number;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useWebContainerDsl(projectId?: string, workspaceId?: string) {
  const [messages,   setMessages]   = useState<AiChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [dslSources,  setDslSources] = useState<Record<string, string>>({});
  const [tokenStats,  setTokenStats] = useState<DslTokenStats>({ input: 0, output: 0 });

  const abortRef         = useRef<AbortController | null>(null);
  const messagesRef      = useRef<AiChatMessage[]>([]);
  const sessionTokensRef = useRef<DslTokenStats>({ input: 0, output: 0 });

  const { setSources: setSharedSources } = useDslSourcesStore();

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ── Load persisted sources + messages on mount / project switch ──────────────
  useEffect(() => {
    if (!projectId) return;
    setMessages([]);
    messagesRef.current = [];

    fetch(`/api/projects/${projectId}/config/meta`)
      .then(r => r.json())
      .then((data: unknown) => {
        const meta = data as Record<string, unknown> | undefined;

        const sources = meta?.dslSources as Record<string, string> | undefined;
        if (sources && Object.keys(sources).length > 0) {
          setDslSources(sources);
          setSharedSources(sources);
          // Recompile so canvas reflects restored state
          compileAllAndApply(sources, projectId).catch(() => {});
        }

        const savedMessages = meta?.dslChatMessages as AiChatMessage[] | undefined;
        if (savedMessages?.length) {
          setMessages(savedMessages);
          messagesRef.current = savedMessages;
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Send ─────────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (userText: string) => {
    if (!userText.trim() || isStreaming) return;

    const now = new Date().toISOString();
    const userMsg: AiChatMessage = {
      id: `${Date.now()}-u`, role: 'user', content: userText, createdAt: now,
    };
    const assistantId = `${Date.now()}-a`;
    const assistantMsg: AiChatMessage = {
      id: assistantId, role: 'assistant', content: '', toolCalls: [], createdAt: now, streaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    const updateAssistant = (updater: (m: AiChatMessage) => AiChatMessage) =>
      setMessages(prev => prev.map(m => m.id === assistantId ? updater(m) : m));

    try {
      const res = await fetch('/api/ai/dsl-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userText, projectId, workspaceId }),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        updateAssistant(m => ({ ...m, content: `Error: ${errText}`, streaming: false }));
        return;
      }

      // ── Read SSE stream ────────────────────────────────────────────────────
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data: ')) continue;

          let msg: Record<string, unknown>;
          try { msg = JSON.parse(line.slice(6)); } catch { continue; }

          const type = msg.type as string;

          // ── Assistant text block ───────────────────────────────────────────
          if (type === 'assistant_text') {
            const text = msg.text as string | undefined;
            if (text) updateAssistant(m => ({ ...m, content: m.content + text }));
          }

          // ── Tool call — show in UI ─────────────────────────────────────────
          else if (type === 'tool_call') {
            const call: AiToolCall = {
              name: (msg.name as string) ?? 'unknown',
              input: (msg.input ?? {}) as Record<string, unknown>,
              status: 'pending',
              timestamp: Date.now(),
            };
            updateAssistant(m => ({ ...m, toolCalls: [...(m.toolCalls ?? []), call] }));
          }

          // ── Tool result — mark previous pending call as done ───────────────
          else if (type === 'tool_result') {
            const toolName = msg.name as string;
            updateAssistant(m => {
              const calls = [...(m.toolCalls ?? [])];
              for (let i = calls.length - 1; i >= 0; i--) {
                if (calls[i]!.name === toolName && calls[i]!.status === 'pending') {
                  calls[i] = { ...calls[i]!, result: msg.output as string, status: 'success' };
                  break;
                }
              }
              return { ...m, toolCalls: calls };
            });
          }

          // ── Result event — token usage recorded server-side ────────────────
          else if (type === 'result') {
            const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            const inputTok  = (usage?.input_tokens  as number | undefined) ?? 0;
            const outputTok = (usage?.output_tokens as number | undefined) ?? 0;
            sessionTokensRef.current = {
              input:  sessionTokensRef.current.input  + inputTok,
              output: sessionTokensRef.current.output + outputTok,
            };
            setTokenStats({ ...sessionTokensRef.current });
          }

          // ── Our custom compiled event — apply canvas + update sources ────────
          else if (type === 'compiled') {
            const events  = msg.events  as Array<{ type: string; path: string; content: string }> | undefined;
            const sources = msg.sources as Record<string, string> | undefined;

            if (sources) {
              setDslSources(sources);
              setSharedSources(sources);
            }

            if (Array.isArray(events)) {
              const state = useBuilderStore.getState();
              for (const ev of events) {
                const result = applyVirtualFile(state, ev.path, ev.content);
                if (!result.ok) console.warn('[DSL agent] applyVirtualFile failed:', ev.path, result.error);
              }
              console.log(`[DSL agent] applied ${events.length} compilation events`);
            }
          }

          // ── Error from server ──────────────────────────────────────────────
          else if (type === 'error' || type === 'compile_error') {
            const errorText = msg.error as string | undefined;
            if (errorText) {
              updateAssistant(m => ({
                ...m,
                content: m.content + (m.content ? '\n\n' : '') + `[Error: ${errorText}]`,
              }));
            }
          }
        }
      }

      // Persist display messages to survive page refresh
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
        updateAssistant(m => ({
          ...m,
          content: `Connection error: ${(err as Error).message}`,
          streaming: false,
        }));
      }
    } finally {
      setIsStreaming(false);
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m));
    }
  }, [isStreaming, projectId, workspaceId, setSharedSources]);

  // ── Clear ────────────────────────────────────────────────────────────────────
  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    messagesRef.current = [];
    setIsStreaming(false);
    sessionTokensRef.current = { input: 0, output: 0 };
    setTokenStats({ input: 0, output: 0 });
  }, []);

  // ── Recompile ────────────────────────────────────────────────────────────────
  const recompileAll = useCallback(async () => {
    if (!Object.keys(dslSources).length) return;
    await compileAllAndApply(dslSources, projectId);
  }, [dslSources, projectId]);

  return { messages, isStreaming, sendMessage, clear, recompileAll, dslSources, tokenStats };
}
