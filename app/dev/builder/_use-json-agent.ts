'use client';

/**
 * useJsonAgent
 *
 * Browser-side hook for the JSON agent (replaces useWebContainerDsl).
 *
 * Architecture:
 *  - AI runs server-side via @anthropic-ai/claude-agent-sdk (POST /api/ai/json-agent)
 *  - Claude uses native Read/Write/Edit/Glob/Grep tools against /tmp/json-agent-{id}/
 *  - On each validated Write/Edit, the server emits { type: 'file', path, content }
 *  - This hook applies those events via applyVirtualFile → live canvas updates
 *  - The current VFS snapshot is sent with every request so the agent sees the
 *    full project state without needing a server-side config restore.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBuilderStore } from './_store';
import { applyVirtualFile, serializeVirtualFiles } from './_virtual-files';
import type { AiChatMessage, AiToolCall } from './_store-types';

// ── No-op compile helper (kept for _files-panel.tsx compatibility) ────────────
// The JSON agent writes entity files directly — no compilation needed.
export async function compileAllAndApply(
  _allSources: Record<string, string>,
  _projectId: string | undefined,
): Promise<void> {
  // No-op: compilation is gone. Files are applied directly via applyVirtualFile.
}

// ── Token stats ───────────────────────────────────────────────────────────────

export interface JsonAgentTokenStats {
  input: number;
  output: number;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useJsonAgent(projectId?: string, workspaceId?: string) {
  const [messages,    setMessages]    = useState<AiChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [tokenStats,  setTokenStats]  = useState<JsonAgentTokenStats>({ input: 0, output: 0 });

  // Track count of entity files written this session (used for the badge)
  const [writtenFileCount, setWrittenFileCount] = useState(0);

  const abortRef          = useRef<AbortController | null>(null);
  const messagesRef       = useRef<AiChatMessage[]>([]);
  const sessionTokensRef  = useRef<JsonAgentTokenStats>({ input: 0, output: 0 });

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ── Restore chat messages on mount / project switch ──────────────────────────
  useEffect(() => {
    if (!projectId) return;
    setMessages([]);
    messagesRef.current = [];

    fetch(`/api/projects/${projectId}/config/meta`)
      .then(r => r.json())
      .then((data: unknown) => {
        const meta = data as Record<string, unknown> | undefined;
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
      // Serialize the current VFS snapshot to send as context for the agent
      const vfsSnapshot = serializeVirtualFiles(useBuilderStore.getState());

      const res = await fetch('/api/ai/json-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userText,
          projectId,
          workspaceId,
          vfsFiles: vfsSnapshot.files,
        }),
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
      let filesApplied = 0;

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

          // ── Partial token delta ──────────────────────────────────────────────
          if (type === 'text_delta') {
            const text = msg.text as string | undefined;
            if (text) updateAssistant(m => ({ ...m, content: m.content + text }));
          }

          // ── Assistant text (fallback) ──────────────────────────────────────
          else if (type === 'assistant_text') {
            const text = msg.text as string | undefined;
            if (text) updateAssistant(m => ({ ...m, content: m.content + text }));
          }

          // ── Tool call ─────────────────────────────────────────────────────
          else if (type === 'tool_call') {
            const call: AiToolCall = {
              id: msg.id as string | undefined,
              name: (msg.name as string) ?? 'unknown',
              input: (msg.input ?? {}) as Record<string, unknown>,
              status: 'pending',
              timestamp: Date.now(),
            };
            updateAssistant(m => ({ ...m, toolCalls: [...(m.toolCalls ?? []), call] }));
          }

          // ── Tool result ───────────────────────────────────────────────────
          else if (type === 'tool_result') {
            const id = msg.id as string | undefined;
            const endTime = (msg.endTime as number | undefined) ?? Date.now();
            updateAssistant(m => {
              const calls = [...(m.toolCalls ?? [])];
              let idx = id ? calls.findIndex(c => c.id === id && c.status === 'pending') : -1;
              if (idx === -1) {
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i]!.status === 'pending') { idx = i; break; }
                }
              }
              if (idx !== -1) {
                const duration = calls[idx]!.timestamp != null ? endTime - calls[idx]!.timestamp! : undefined;
                calls[idx] = { ...calls[idx]!, status: 'success', duration };
              }
              return { ...m, toolCalls: calls };
            });
          }

          // ── Entity file written — apply to canvas ─────────────────────────
          else if (type === 'file') {
            const filePath = msg.path as string | undefined;
            const content  = msg.content as string | undefined;
            if (filePath && content !== undefined) {
              const state = useBuilderStore.getState();
              const result = applyVirtualFile(state, filePath, content);
              if (!result.ok) {
                console.warn('[json-agent] applyVirtualFile failed:', filePath, result.error);
              } else {
                filesApplied++;
                setWrittenFileCount(c => c + 1);
                console.log(`[json-agent] applied ${filePath}`);
              }
            }
          }

          // ── Persisted confirmation ────────────────────────────────────────
          else if (type === 'persisted') {
            console.log(`[json-agent] ${msg.count} files persisted to project DB`);
          }

          // ── Final result (usage) ──────────────────────────────────────────
          else if (type === 'result') {
            const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            const inputTok  = (usage?.input_tokens  as number | undefined) ?? 0;
            const outputTok = (usage?.output_tokens as number | undefined) ?? 0;
            sessionTokensRef.current = {
              input:  sessionTokensRef.current.input  + inputTok,
              output: sessionTokensRef.current.output + outputTok,
            };
            setTokenStats({ ...sessionTokensRef.current });
            if (msg.session_id) console.log('[json-agent] session_id:', msg.session_id);
            updateAssistant(m => ({
              ...m,
              toolCalls: (m.toolCalls ?? []).map(c =>
                c.status === 'pending' ? { ...c, status: 'success' as const } : c
              ),
            }));
          }

          // ── Error ─────────────────────────────────────────────────────────
          else if (type === 'error') {
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

      if (filesApplied > 0) {
        console.log(`[json-agent] total ${filesApplied} files applied to canvas`);
      }

      // Persist display messages
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
  }, [isStreaming, projectId, workspaceId]);

  // ── Clear ─────────────────────────────────────────────────────────────────────
  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    messagesRef.current = [];
    setIsStreaming(false);
    setWrittenFileCount(0);
    sessionTokensRef.current = { input: 0, output: 0 };
    setTokenStats({ input: 0, output: 0 });
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    clear,
    tokenStats,
    /** Number of entity files written this session (used for the files badge). */
    writtenFileCount,
    /** Backward-compat alias — always empty, no DSL source files anymore. */
    dslSources: {} as Record<string, string>,
  };
}

// ── Named alias used by _ai-chat-panel.tsx ────────────────────────────────────
export const useWebContainerDsl = useJsonAgent;
