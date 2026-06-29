'use client';

/**
 * useJsonAgent
 *
 * Browser-side hook for the JSON agent.
 *
 * Architecture:
 *  - AI runs server-side via @anthropic-ai/claude-agent-sdk (POST /api/ai/json-agent)
 *  - Claude uses native Read/Write/Edit/Glob/Grep tools against /tmp/json-agent-{id}/
 *  - On each validated Write/Edit, the server emits { type: 'file', path, content }
 *  - This hook applies those events via applyVirtualFile → live canvas updates
 *  - Each conversation thread maps to its own SDK session_id (persisted per-thread
 *    in project meta so resume survives server restarts).
 *  - Messages are persisted in the backend threads API, not in project meta blobs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBuilderStore } from './_store';
import { applyVirtualFile, serializeVirtualFiles } from './_virtual-files';
import { fetchServerFiles, applyServerFile } from '@/lib/backend-vfs';
import { projects as projectsApi } from '@/lib/platform/api-client';
import type { AiChatMessage, AiAttachment, AiToolCall } from './_store-types';
import { backendStorage } from '@/lib/platform/api-client';

// ── Thread type (mirrors backend schema) ──────────────────────────────────────

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ── Token stats ────────────────────────────────────────────────────────────────

export interface JsonAgentTokenStats {
  input:         number;
  output:        number;
  cacheRead:     number;
  cacheCreation: number;
  totalCostUsd:  number;
}

// ── Module-level workspaceId cache (projectId → workspaceId) ──────────────────

const workspaceIdCache = new Map<string, string>();

async function resolveWorkspaceId(projectId: string): Promise<string | null> {
  if (workspaceIdCache.has(projectId)) return workspaceIdCache.get(projectId)!;
  try {
    const { project } = await projectsApi.get(projectId);
    const wsId = project.workspaceId as string;
    workspaceIdCache.set(projectId, wsId);
    return wsId;
  } catch {
    return null;
  }
}

// ── Debounced event dispatcher ────────────────────────────────────────────────

function makeDebounced(fn: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, delayMs);
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

const THREADS_PAGE = 10;

export function useJsonAgent(projectId?: string) {
  const [messages,    setMessages]    = useState<AiChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [tokenStats,  setTokenStats]  = useState<JsonAgentTokenStats>({
    input: 0, output: 0, cacheRead: 0, cacheCreation: 0, totalCostUsd: 0,
  });

  // ── Thread state ──────────────────────────────────────────────────────────
  const [threads,             setThreads]           = useState<ChatThread[]>([]);
  const [currentThreadId,     setCurrentThreadId]   = useState<string | null>(null);
  const [loadingThreads,      setLoadingThreads]    = useState(false);
  const [hasMoreThreads,      setHasMoreThreads]    = useState(false);
  const [loadingMoreThreads,  setLoadingMoreThreads] = useState(false);
  const [deletingThreadId,    setDeletingThreadId]  = useState<string | null>(null);

  // threadId → SDK session_id (loaded from + persisted to project meta)
  const [threadSessions, setThreadSessions] = useState<Record<string, string>>({});
  const threadSessionsRef = useRef<Record<string, string>>({});

  const abortRef        = useRef<AbortController | null>(null);
  const messagesRef     = useRef<AiChatMessage[]>([]);
  const sessionStatsRef = useRef<JsonAgentTokenStats>({
    input: 0, output: 0, cacheRead: 0, cacheCreation: 0, totalCostUsd: 0,
  });

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { threadSessionsRef.current = threadSessions; }, [threadSessions]);

  // Debounced event to bump AiTokenMeter mid-build (fires at most once / 4s)
  const dispatchTurnDoneRef = useRef(
    makeDebounced(() => window.dispatchEvent(new Event('builder:ai-turn-done')), 4000),
  );

  // ── Load threads ──────────────────────────────────────────────────────────

  const loadThreads = useCallback(async () => {
    if (!projectId) return;
    setLoadingThreads(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chat/threads?limit=${THREADS_PAGE}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const body = await res.json() as { threads: ChatThread[]; total: number; offset: number };
        setThreads(body.threads ?? []);
        setHasMoreThreads((body.offset ?? 0) + (body.threads ?? []).length < (body.total ?? 0));
      }
    } catch { /* silently ignore */ } finally {
      setLoadingThreads(false);
    }
  }, [projectId]);

  const loadMoreThreads = useCallback(async () => {
    if (!projectId || loadingMoreThreads || !hasMoreThreads) return;
    setLoadingMoreThreads(true);
    try {
      const offset = threads.length;
      const res = await fetch(
        `/api/projects/${projectId}/chat/threads?limit=${THREADS_PAGE}&offset=${offset}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const body = await res.json() as { threads: ChatThread[]; total: number; offset: number };
        const data = body.threads ?? [];
        setThreads(prev => {
          const ids = new Set(prev.map(t => t.id));
          return [...prev, ...data.filter(t => !ids.has(t.id))];
        });
        setHasMoreThreads((body.offset ?? 0) + data.length < (body.total ?? 0));
      } else {
        setHasMoreThreads(false);
      }
    } catch {
      setHasMoreThreads(false);
    } finally {
      setLoadingMoreThreads(false);
    }
  }, [projectId, threads.length, loadingMoreThreads, hasMoreThreads]);

  // ── On mount / project switch ─────────────────────────────────────────────

  useEffect(() => {
    if (!projectId) return;
    setMessages([]);
    messagesRef.current = [];
    setCurrentThreadId(null);
    sessionStatsRef.current = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, totalCostUsd: 0 };
    setTokenStats(sessionStatsRef.current);

    // Load threads + persisted session map
    void loadThreads();
    fetch(`/api/projects/${projectId}/config/meta`)
      .then(r => r.json())
      .then((data: unknown) => {
        const meta = data as Record<string, unknown> | undefined;
        const sessions = meta?.threadSessions as Record<string, string> | undefined;
        if (sessions && typeof sessions === 'object') {
          setThreadSessions(sessions);
          threadSessionsRef.current = sessions;
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Select thread — load messages from backend ────────────────────────────

  const selectThread = useCallback(async (threadId: string) => {
    if (!projectId) return;
    setMessages([]);
    messagesRef.current = [];
    setCurrentThreadId(threadId);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chat/threads/${threadId}/messages?limit=50`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const body = await res.json() as {
        messages: Array<{
          id: string; role: string; content: string;
          toolCalls?: unknown; metadata?: Record<string, unknown>; createdAt: string;
        }>;
      };

      // Map messages, then resolve presigned URLs for attachment fileIds in background
      const mapped: AiChatMessage[] = (body.messages ?? []).map(m => ({
        id: m.id,
        role: m.role as AiChatMessage['role'],
        content: m.content,
        toolCalls: Array.isArray(m.toolCalls)
          ? (m.toolCalls as AiToolCall[]).map(tc => ({ ...tc, status: tc.status ?? ('success' as const) }))
          : undefined,
        selectedNodeIds: m.metadata?.selectedNodeIds as string[] | undefined,
        createdAt: m.createdAt,
        attachments: (() => {
          const refs = m.metadata?.attachments as Array<{ fileId: string; name: string; mime: string; size?: number }> | undefined;
          if (!refs?.length) return undefined;
          // Placeholder — previewUrl filled in below once presigned URLs resolve
          return refs.map(r => ({
            fileId: r.fileId, name: r.name, mimeType: r.mime, size: r.size ?? 0,
          } satisfies AiAttachment));
        })(),
      }));
      setMessages(mapped);
      messagesRef.current = mapped;

      // Resolve presigned URLs for attachments in parallel (best-effort)
      const toResolve = mapped.filter(m => m.attachments?.length);
      if (toResolve.length && projectId) {
        void (async () => {
          for (const msg of toResolve) {
            if (!msg.attachments?.length) continue;
            const resolved = await Promise.all(
              msg.attachments.map(async a => {
                try {
                  const { url } = await backendStorage.getPresignedUrl(projectId, a.fileId);
                  return { ...a, previewUrl: url };
                } catch {
                  return a;
                }
              }),
            );
            setMessages(prev => prev.map(m2 =>
              m2.id === msg.id ? { ...m2, attachments: resolved } : m2,
            ));
          }
        })();
      }
    } catch { /* silently ignore */ }
  }, [projectId]);

  // ── Create thread ──────────────────────────────────────────────────────────

  const createThread = useCallback(async (title?: string): Promise<string | null> => {
    if (!projectId) {
      // Offline / dev mode — local-only thread
      const localId = crypto.randomUUID();
      const newThread: ChatThread = {
        id: localId, title: title ?? 'New Chat',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0,
      };
      setThreads(prev => [newThread, ...prev]);
      setCurrentThreadId(localId);
      return localId;
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/chat/threads`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title ?? 'New Chat' }),
      });
      if (!res.ok) return null;
      const { thread } = await res.json() as { thread: { id: string; title: string; createdAt: string; updatedAt: string } };
      const newThread: ChatThread = { ...thread, messageCount: 0 };
      setThreads(prev => [newThread, ...prev]);
      setCurrentThreadId(thread.id);
      return thread.id;
    } catch {
      return null;
    }
  }, [projectId]);

  // ── Delete thread ──────────────────────────────────────────────────────────

  const deleteThread = useCallback(async (threadId: string) => {
    setDeletingThreadId(threadId);
    try {
      if (projectId) {
        await fetch(`/api/projects/${projectId}/chat/threads/${threadId}`, {
          method: 'DELETE', credentials: 'include',
        });
      }
      setThreads(prev => prev.filter(t => t.id !== threadId));
      if (currentThreadId === threadId) {
        setCurrentThreadId(null);
        setMessages([]);
        messagesRef.current = [];
      }
    } catch { /* silently ignore */ } finally {
      setDeletingThreadId(null);
    }
  }, [projectId, currentThreadId]);

  // ── Auto-rename thread from first user message ────────────────────────────

  const autoRenameThread = useCallback(async (threadId: string, firstMessage: string) => {
    const title = firstMessage.slice(0, 60).trim();
    if (!title) return;
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title } : t));
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/chat/threads/${threadId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }, [projectId]);

  // ── Persist message to backend ────────────────────────────────────────────

  const persistMessage = useCallback(async (
    threadId: string,
    msg: Pick<AiChatMessage, 'role' | 'content' | 'toolCalls' | 'selectedNodeIds' | 'attachments'>,
  ) => {
    if (!projectId) return;
    const attachmentRefs = msg.attachments?.map(a => ({ fileId: a.fileId, name: a.name, mime: a.mimeType, size: a.size }));
    const metadata: Record<string, unknown> = {};
    if (msg.selectedNodeIds) metadata.selectedNodeIds = msg.selectedNodeIds;
    if (attachmentRefs?.length) metadata.attachments = attachmentRefs;
    fetch(`/api/projects/${projectId}/chat/threads/${threadId}/messages`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role:      msg.role,
        content:   msg.content,
        toolCalls: msg.toolCalls,
        metadata:  Object.keys(metadata).length ? metadata : undefined,
      }),
    }).catch(() => {});
  }, [projectId]);

  // ── Start new chat (reset without creating a thread yet) ──────────────────

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    messagesRef.current = [];
    setCurrentThreadId(null);
    setIsStreaming(false);
    sessionStatsRef.current = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, totalCostUsd: 0 };
    setTokenStats(sessionStatsRef.current);
  }, []);

  // ── Send ──────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (userText: string, attachments?: AiAttachment[]) => {
    const hasContent = userText.trim() || (attachments && attachments.length > 0);
    if (!hasContent || isStreaming) return;

    const now = new Date().toISOString();

    // Resolve workspace for token recording
    const wsId = projectId ? await resolveWorkspaceId(projectId) : null;

    // Lazily create thread if needed
    let threadId = currentThreadId;
    if (!threadId) {
      threadId = await createThread(userText.slice(0, 60).trim() || 'New Chat');
      if (!threadId) {
        // Couldn't create thread — fallback to threadless send
        threadId = null;
      }
    }

    const userMsg: AiChatMessage = {
      id: `${Date.now()}-u`, role: 'user', content: userText, createdAt: now,
      attachments: attachments?.length ? attachments : undefined,
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

    // Persist user message to thread
    if (threadId) {
      void persistMessage(threadId, userMsg);
      // Auto-rename if this is the first message
      const isFirstMsg = messagesRef.current.filter(m => m.role === 'user').length === 0;
      if (isFirstMsg) void autoRenameThread(threadId, userText);
    }

    const updateAssistant = (updater: (m: AiChatMessage) => AiChatMessage) =>
      setMessages(prev => prev.map(m => m.id === assistantId ? updater(m) : m));

    try {
      const vfsSnapshot = serializeVirtualFiles(useBuilderStore.getState());
      // Merge the backend (server/*) file projection so the agent sees a unified
      // full-stack snapshot (frontend config/ + backend server/).
      if (projectId) {
        try {
          const serverFiles = await fetchServerFiles(projectId);
          Object.assign(vfsSnapshot.files, serverFiles);
        } catch { /* backend snapshot is best-effort */ }
      }
      const resumeSessionId = threadId ? threadSessionsRef.current[threadId] : undefined;

      const res = await fetch('/api/ai/json-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt:          userText,
          projectId,
          workspaceId:     wsId ?? undefined,
          threadId:        threadId ?? undefined,
          resumeSessionId: resumeSessionId ?? undefined,
          vfsFiles:        vfsSnapshot.files,
          attachments:     attachments?.map(a => ({
            fileId:   a.fileId,
            name:     a.name,
            mimeType: a.mimeType,
            data:     a.data,
          })),
        }),
        signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        updateAssistant(m => ({ ...m, content: `Error: ${errText}`, streaming: false }));
        return;
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let filesApplied = 0;
      // Accumulate assistant text for persisting to thread at the end
      let assistantContent = '';
      const assistantToolCalls: AiToolCall[] = [];

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

          if (type === 'text_delta') {
            const text = msg.text as string | undefined;
            if (text) {
              assistantContent += text;
              updateAssistant(m => ({ ...m, content: m.content + text }));
            }
          } else if (type === 'assistant_text') {
            const text = msg.text as string | undefined;
            if (text) {
              assistantContent += text;
              updateAssistant(m => ({ ...m, content: m.content + text }));
            }
          } else if (type === 'tool_call') {
            const call: AiToolCall = {
              id:        msg.id as string | undefined,
              name:      (msg.name as string) ?? 'unknown',
              input:     (msg.input ?? {}) as Record<string, unknown>,
              status:    'pending',
              timestamp: Date.now(),
            };
            assistantToolCalls.push(call);
            updateAssistant(m => ({ ...m, toolCalls: [...(m.toolCalls ?? []), call] }));
          } else if (type === 'tool_result') {
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
                if (idx < assistantToolCalls.length) assistantToolCalls[idx] = calls[idx]!;
              }
              return { ...m, toolCalls: calls };
            });
          } else if (type === 'usage') {
            // Per-round usage — update live stats
            const round = msg.round as { input?: number; output?: number; cacheRead?: number; cacheCreation?: number } | undefined;
            if (round) {
              sessionStatsRef.current = {
                input:         sessionStatsRef.current.input         + (round.input        ?? 0),
                output:        sessionStatsRef.current.output        + (round.output       ?? 0),
                cacheRead:     sessionStatsRef.current.cacheRead     + (round.cacheRead    ?? 0),
                cacheCreation: sessionStatsRef.current.cacheCreation + (round.cacheCreation ?? 0),
                totalCostUsd:  sessionStatsRef.current.totalCostUsd,
              };
              setTokenStats({ ...sessionStatsRef.current });
              // Dispatch mid-build so AiTokenMeter re-fetches (debounced)
              dispatchTurnDoneRef.current();
            }
          } else if (type === 'file') {
            const filePath = msg.path as string | undefined;
            const content  = msg.content as string | undefined;
            if (filePath && content !== undefined) {
              if (filePath.startsWith('server/')) {
                // Backend entity — route to the backend VFS apply (migrations etc.)
                if (projectId) {
                  const result = await applyServerFile(projectId, filePath, content);
                  if (!result.ok) {
                    console.warn('[json-agent] applyServerFile failed:', filePath, result.error);
                  } else {
                    filesApplied++;
                    console.log(`[json-agent] applied (backend) ${filePath}`);
                  }
                }
              } else {
                const state = useBuilderStore.getState();
                const result = applyVirtualFile(state, filePath, content);
                if (!result.ok) {
                  console.warn('[json-agent] applyVirtualFile failed:', filePath, result.error);
                } else {
                  filesApplied++;
                  console.log(`[json-agent] applied ${filePath}`);
                }
              }
            }
          } else if (type === 'persisted') {
            console.log(`[json-agent] ${msg.count} files persisted to project DB`);
          } else if (type === 'result') {
            const usage = msg.usage as {
              input_tokens?: number; output_tokens?: number;
              cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
            } | undefined;
            // Reconcile to authoritative cumulative totals from the result
            sessionStatsRef.current = {
              input:         usage?.input_tokens                  ?? sessionStatsRef.current.input,
              output:        usage?.output_tokens                 ?? sessionStatsRef.current.output,
              cacheRead:     usage?.cache_read_input_tokens       ?? sessionStatsRef.current.cacheRead,
              cacheCreation: usage?.cache_creation_input_tokens   ?? sessionStatsRef.current.cacheCreation,
              totalCostUsd:  (msg.total_cost_usd as number | undefined) ?? sessionStatsRef.current.totalCostUsd,
            };
            setTokenStats({ ...sessionStatsRef.current });

            // Store session_id for this thread so next turn can resume
            const sessionId = msg.session_id as string | undefined;
            if (sessionId && threadId) {
              const updated = { ...threadSessionsRef.current, [threadId]: sessionId };
              setThreadSessions(updated);
              threadSessionsRef.current = updated;
              if (projectId) {
                fetch(`/api/projects/${projectId}/config/meta`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ threadSessions: updated }),
                }).catch(() => {});
              }
            }

            // Final dispatch so meter re-fetches after turn
            window.dispatchEvent(new Event('builder:ai-turn-done'));

            updateAssistant(m => ({
              ...m,
              toolCalls: (m.toolCalls ?? []).map(c =>
                c.status === 'pending' ? { ...c, status: 'success' as const } : c
              ),
            }));
          } else if (type === 'error') {
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

      // Persist assistant message to thread
      if (threadId) {
        const finalMsg = messagesRef.current.find(m => m.id === assistantId);
        void persistMessage(threadId, {
          role:      'assistant',
          content:   finalMsg?.content ?? assistantContent,
          toolCalls: finalMsg?.toolCalls ?? assistantToolCalls,
        });
        // Bump thread's updatedAt / messageCount in local state
        setThreads(prev => prev.map(t =>
          t.id === threadId
            ? { ...t, messageCount: t.messageCount + 2, updatedAt: new Date().toISOString() }
            : t
        ));
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
  }, [isStreaming, projectId, currentThreadId, createThread, persistMessage, autoRenameThread]);

  // ── Stop streaming ────────────────────────────────────────────────────────

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
  }, []);

  // ── Clear ─────────────────────────────────────────────────────────────────

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    messagesRef.current = [];
    setCurrentThreadId(null);
    setIsStreaming(false);
    sessionStatsRef.current = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, totalCostUsd: 0 };
    setTokenStats(sessionStatsRef.current);
  }, []);

  return {
    // Chat
    messages,
    isStreaming,
    sendMessage,
    stopStreaming,
    clear,
    tokenStats,
    // Threads
    threads,
    currentThreadId,
    loadingThreads,
    hasMoreThreads,
    loadingMoreThreads,
    deletingThreadId,
    loadThreads,
    loadMoreThreads,
    selectThread,
    createThread,
    deleteThread,
    startNewChat,
  };
}
