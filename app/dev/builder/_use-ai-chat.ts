'use client';

/**
 * _use-ai-chat.ts
 *
 * Hook that bridges:
 * 1. Builder Zustand store (aiChatHistory, aiGenerating, aiCurrentThreadId)
 * 2. Backend chat persistence (threads + messages via /api/projects/:id/chat/)
 * 3. AI Chat API (POST /api/ai/builder-chat) — handles tool calls, streaming
 *
 * The hook is designed so the AI panel component only calls:
 *   const { threads, sendMessage, createThread, deleteThread, selectThread, loadingThreads } = useAiChat();
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBuilderStore } from './_store';
import type { AiChatMessage } from './_store-types';
import { executeTool, CLIENT_SIDE_TOOLS } from '@/lib/ai/tool-executor';
import themeConfig from '@/config/theme.json';

// Pre-compute default palette from the app's CSS variable defaults (strip '--' prefix).
// Used when the user hasn't applied a theme preset yet so the AI always receives real hex values.
const THEME_DEFAULTS: Record<string, string> = Object.fromEntries(
  Object.entries((themeConfig.cssVariables?.root ?? {}) as Record<string, string>)
    .filter(([k]) => k.startsWith('--'))
    .map(([k, v]) => [k.slice(2), v])
);

// ---------------------------------------------------------------------------
// Thread type (from backend)
// ---------------------------------------------------------------------------

export interface ChatThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ---------------------------------------------------------------------------
// SSE events from /api/ai/builder-chat
// ---------------------------------------------------------------------------

type BuilderChatSSE =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'round_start'; round: number }
  | { type: 'tool_executed'; id: string; name: string; input: Record<string, unknown>; result?: unknown; error?: string }
  | { type: 'image_results'; images: Array<{ url: string; thumb: string; alt: string; credit: string; photographer?: string }> }
  | { type: 'icon_results'; icons: Array<{ id: string; name: string; prefix: string }> }
  | { type: 'build_phase'; phase: 'planning' | 'editing' | 'building' | 'wiring'; total?: number; message: string; buildUnits?: Array<{ name: string; description: string; pageRoute: string; sectionCount?: number }> }
  | { type: 'section_progress'; done: number; total: number; name: string }
  | { type: 'phase3_started' }
  | { type: 'done'; tools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }> }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAiChat() {
  const store = useBuilderStore();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Tracks whether the current streaming session has entered Phase 3 (styling).
  // Passed as isPhase3Continuation in any subsequent requests so the server can
  // restore PHASE3_BUILDER_TOOLS tool restrictions across HTTP request boundaries.
  const isInPhase3Ref = useRef(false);

  const THREADS_PAGE = 10;

  // Derive project ID from builder URL.
  // Two URL formats: /builder/<id> (path-based, browser URL) and /dev/builder?projectId=<id> (query param).
  const getProjectId = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const fromSearch = params.get('projectId') ?? params.get('project');
    const pathname = window.location.pathname;
    const fromPath = pathname.startsWith('/builder/')
      ? (pathname.split('/')[2] ?? null)
      : null;
    return fromSearch ?? fromPath;
  }, []);

  // ── Load threads ──────────────────────────────────────────────────────────

  const selectThread = useCallback(async (threadId: string) => {
    const projectId = getProjectId();
    if (!projectId) return;
    // Reset pagination on every thread switch
    setHasMoreMessages(false);
    useBuilderStore.getState().clearAiChat();
    useBuilderStore.getState().setAiCurrentThreadId(threadId);

    try {
      const res = await fetch(`/api/projects/${projectId}/chat/threads/${threadId}/messages?limit=50`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const { items: messages, hasNextPage } = await res.json() as {
        items: Array<{
          id: string;
          role: string;
          content: string;
          toolCalls?: unknown;
          metadata?: Record<string, unknown>;
          createdAt: string;
        }>;
        hasNextPage: boolean;
      };

      for (const m of messages) {
        useBuilderStore.getState().addAiChatMessage({
          id: m.id,
          role: m.role as AiChatMessage['role'],
          content: m.content,
          toolCalls: Array.isArray(m.toolCalls)
            ? (m.toolCalls as AiChatMessage['toolCalls'])!.map(tc => ({ ...tc, status: tc.status ?? 'success' as const }))
            : undefined,
          selectedNodeIds: m.metadata?.selectedNodeIds as string[] | undefined,
          createdAt: m.createdAt,
        });
      }
      setHasMoreMessages(hasNextPage);
    } catch {
      // silently ignore
    }
  }, [getProjectId]);

  const loadThreads = useCallback(async () => {
    const projectId = getProjectId();
    if (!projectId) return;
    setLoadingThreads(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/chat/threads?limit=${THREADS_PAGE}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const { items: data, hasNextPage } = await res.json() as { items: ChatThread[]; hasNextPage: boolean };
        setThreads(data);
        setHasMoreThreads(hasNextPage);
      }
    } catch {
      // silently ignore
    } finally {
      setLoadingThreads(false);
    }
  }, [getProjectId, THREADS_PAGE]);

  // Load the next page of threads (appends to the existing list)
  const loadMoreThreads = useCallback(async () => {
    const projectId = getProjectId();
    if (!projectId || loadingMoreThreads || !hasMoreThreads) return;
    setLoadingMoreThreads(true);
    try {
      const offset = threads.length;
      const res = await fetch(
        `/api/projects/${projectId}/chat/threads?limit=${THREADS_PAGE}&offset=${offset}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const { items: data, hasNextPage } = await res.json() as { items: ChatThread[]; hasNextPage: boolean };
        setThreads(prev => {
          const existingIds = new Set(prev.map(t => t.id));
          return [...prev, ...data.filter(t => !existingIds.has(t.id))];
        });
        setHasMoreThreads(hasNextPage);
      } else {
        setHasMoreThreads(false);
      }
    } catch {
      setHasMoreThreads(false);
    } finally {
      setLoadingMoreThreads(false);
    }
  }, [getProjectId, threads.length, loadingMoreThreads, hasMoreThreads, THREADS_PAGE]);

  // ── Load older messages (infinite scroll) ─────────────────────────────────

  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);

  const loadMoreMessages = useCallback(async () => {
    const threadId = useBuilderStore.getState().aiCurrentThreadId;
    const projectId = getProjectId();
    const history = useBuilderStore.getState().aiChatHistory;
    if (!threadId || !projectId || history.length === 0 || loadingMoreMessages || !hasMoreMessages) return;

    setLoadingMoreMessages(true);
    const oldest = history[0];
    try {
      const url = `/api/projects/${projectId}/chat/threads/${threadId}/messages?limit=50&before=${encodeURIComponent(oldest.createdAt ?? '')}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) { setHasMoreMessages(false); return; }
      const { items: older, hasNextPage } = await res.json() as {
        items: Array<{
          id: string;
          role: string;
          content: string;
          toolCalls?: unknown;
          metadata?: Record<string, unknown>;
          createdAt: string;
        }>;
        hasNextPage: boolean;
      };
      setHasMoreMessages(hasNextPage);
      if (older.length === 0) return;
      const mapped: AiChatMessage[] = older.map(m => ({
        id: m.id,
        role: m.role as AiChatMessage['role'],
        content: m.content,
        toolCalls: Array.isArray(m.toolCalls)
          ? (m.toolCalls as AiChatMessage['toolCalls'])!.map(tc => ({ ...tc, status: tc.status ?? 'success' as const }))
          : undefined,
        selectedNodeIds: m.metadata?.selectedNodeIds as string[] | undefined,
        createdAt: m.createdAt,
      }));
      useBuilderStore.getState().prependAiChatMessages(mapped);
    } catch {
      setHasMoreMessages(false);
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [getProjectId, loadingMoreMessages, hasMoreMessages]);

  // ── Start new chat (UI-only reset — thread is created lazily on first send) ──

  const startNewChat = useCallback(() => {
    store.clearAiChat();
    store.setAiCurrentThreadId(null);
  }, [store]);

  // ── Create thread (backend) — called lazily from sendMessage ─────────────

  const createThread = useCallback(async (title?: string): Promise<string | null> => {
    const projectId = getProjectId();

    // No project ID — create a local-only thread so the chat works in dev mode
    if (!projectId) {
      const localId = crypto.randomUUID();
      const newThread: ChatThread = {
        id: localId,
        title: title ?? 'New Chat',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
      };
      setThreads(prev => [newThread, ...prev]);
      store.setAiCurrentThreadId(localId);
      return localId;
    }

    try {
      const res = await fetch(`/api/projects/${projectId}/chat/threads`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title ?? 'New Chat' }),
      });
      if (!res.ok) return null;
      const thread = await res.json() as { id: string; title: string; createdAt: string; updatedAt: string };
      const newThread: ChatThread = { ...thread, messageCount: 0 };
      setThreads(prev => [newThread, ...prev]);
      store.setAiCurrentThreadId(thread.id);
      return thread.id;
    } catch {
      return null;
    }
  }, [getProjectId, store]);

  // ── Delete thread ─────────────────────────────────────────────────────────

  const deleteThread = useCallback(async (threadId: string) => {
    const projectId = getProjectId();
    setDeletingThreadId(threadId);
    try {
      if (projectId) {
        await fetch(`/api/projects/${projectId}/chat/threads/${threadId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      }
      setThreads(prev => prev.filter(t => t.id !== threadId));
      if (store.aiCurrentThreadId === threadId) {
        store.setAiCurrentThreadId(null);
        store.clearAiChat();
      }
    } catch {
      // silently ignore
    } finally {
      setDeletingThreadId(null);
    }
  }, [getProjectId, store]);

  // ── Persist message to backend ────────────────────────────────────────────

  const persistMessage = useCallback(async (
    threadId: string,
    msg: Omit<AiChatMessage, 'id' | 'createdAt'>,
  ) => {
    const projectId = getProjectId();
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/chat/threads/${threadId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: msg.role,
          content: msg.content,
          toolCalls: msg.toolCalls,
          metadata: msg.selectedNodeIds ? { selectedNodeIds: msg.selectedNodeIds } : undefined,
        }),
      });
    } catch {
      // silently ignore persistence errors (chat still works locally)
    }
  }, [getProjectId]);

  // ── Auto-rename thread after first user message ───────────────────────────

  const autoRenameThread = useCallback(async (threadId: string, firstMessage: string) => {
    const title = firstMessage.slice(0, 60).trim();
    if (!title) return;

    // Always update local state
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title } : t));

    const projectId = getProjectId();
    if (!projectId) return; // local-only thread, no backend
    try {
      await fetch(`/api/projects/${projectId}/chat/threads/${threadId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    } catch {
      // ignore
    }
  }, [getProjectId]);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string, selectedNodeIds: string[] = []) => {
    if (store.aiGenerating) return;

    // Reset Phase 3 tracking for each new user message
    isInPhase3Ref.current = false;

    // Show the user message and streaming placeholder in the UI immediately —
    // before any network calls so there is zero perceived delay.
    const userMsg: AiChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      selectedNodeIds: selectedNodeIds.length ? selectedNodeIds : undefined,
      createdAt: new Date().toISOString(),
    };
    store.addAiChatMessage(userMsg);
    store.setAiGenerating(true);

    const assistantMsgId = crypto.randomUUID();
    store.addAiChatMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      streaming: true,
      createdAt: new Date().toISOString(),
    });

    // Ensure a thread exists — create lazily after messages are already visible.
    let threadId = store.aiCurrentThreadId;
    const isNewThread = !threadId;
    if (!threadId) {
      threadId = await createThread(text.slice(0, 60));
      if (!threadId) {
        // Thread creation failed — roll back the optimistic UI
        store.setAiGenerating(false);
        store.clearAiChat();
        return;
      }
    }

    // Persist user message now that we have a threadId
    void persistMessage(threadId, userMsg);

    // Auto-rename thread on first message
    if (isNewThread) {
      void autoRenameThread(threadId, text);
    }

    // Abort any in-flight request
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    // Build deep context snapshot for AI (3 levels deep for good structure understanding)
    const summarizeNode = (n: unknown, depth: number): unknown => {
      const node = n as Record<string, unknown>;
      const base: Record<string, unknown> = {
        id: node.id,
        type: node.type,
        name: node.name,
        text: typeof node.text === 'string' ? (node.text as string).slice(0, 60) : undefined,
        className: (node.props as { className?: string } | undefined)?.className?.slice(0, 100),
      };
      const children = node.children as unknown[] | undefined;
      if (depth > 0 && children?.length) {
        base.children = children.map(c => summarizeNode(c, depth - 1));
      } else if (children?.length) {
        base.childCount = children.length;
      }
      return base;
    };

    const pageTreeSnapshot = store.pageNodes.map(n => summarizeNode(n, 3));

    const findNodeById = (nodes: typeof store.pageNodes, tid: string): unknown => {
      for (const n of nodes) {
        if ((n as { id?: string }).id === tid) return n;
        const children = (n as { children?: typeof store.pageNodes }).children;
        if (Array.isArray(children)) {
          const found = findNodeById(children, tid);
          if (found) return found;
        }
      }
      return null;
    };

    // Merge manually-pinned chips with currently canvas-selected nodes (deduped)
    const canvasSelectedIds = store.selectedIds ?? [];
    const mergedSelectedIds = [...new Set([...selectedNodeIds, ...canvasSelectedIds])];

    const selectedNodesDetails = mergedSelectedIds
      .map(id => findNodeById(store.pageNodes, id))
      .filter(Boolean);

    try {
      const res = await fetch('/api/ai/builder-chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          selectedNodeIds: mergedSelectedIds,
          selectedNodesDetails,
          pageTreeSnapshot,
          pageId: store.currentPageId,
          pages: store.pages.map(p => ({ id: p.id, name: p.name, route: p.route })),
          theme: { ...THEME_DEFAULTS, ...store.themeOverrides },
          mood: store.projectMood,
          animationLevel: store.projectAnimationLevel,
          layoutStructure: store.projectLayoutStructure,
          appName: store.projectAppName,
          description: store.projectDescription,
          category: store.projectCategory,
          variables: (store.customVars ?? []).map((v) => ({ id: v.id ?? v.name, name: v.name, label: v.label, type: v.type, initialValue: v.initialValue })),
          workflows: Object.entries(store.pageWorkflows ?? {}).map(([name]) => ({
            name,
            trigger: store.pageWorkflowMeta?.[name]?.trigger ?? 'click',
          })),
          dataSources: (store.pageDataSources ?? []).map((ds) => ({
            id: ds.id,
            label: ds._label ?? ds.name ?? ds.id,
            path: `collections['${ds.id}'].data`,
          })),
          threadId,
          chatHistory: store.aiChatHistory.slice(-10).map(m => ({ role: m.role, content: m.content })),
          model: store.aiSelectedModel,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        store.updateLastAiMessage({ content: 'Failed to connect to AI. Please try again.', streaming: false });
        store.setAiGenerating(false);
        return;
      }

      // Stream the response
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let fullContent = '';
      let accThinking = '';
      const allToolCalls: AiChatMessage['toolCalls'] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const ev = JSON.parse(json) as BuilderChatSSE;

            if (ev.type === 'round_start') {
              // New Anthropic call starting — show "Planning…" between rounds (round > 1 only)
              if (ev.round > 1) {
                store.updateLastAiMessage({ isThinking: true, streaming: true });
              }
            } else if (ev.type === 'thinking_delta') {
              accThinking += ev.content;
              store.updateLastAiMessage({ thinkingContent: accThinking, streaming: true });
            } else if (ev.type === 'text_delta') {
              fullContent += ev.content;
              store.updateLastAiMessage({ content: fullContent, isThinking: false, streaming: true });
            } else if (ev.type === 'tool_executed') {
              {
                store.setAiCurrentTool(ev.name);
                let execResult: unknown = ev.result;
                let execStatus: 'success' | 'error' = ev.error ? 'error' : 'success';

                // Execute client-side mutation tools against the Zustand store
                if (CLIENT_SIDE_TOOLS.has(ev.name)) {
                  try {
                    const result = await executeTool(
                      ev.name,
                      ev.input,
                      () => useBuilderStore.getState(),
                    );
                    execResult = result.data;
                    execStatus = result.success ? 'success' : 'error';
                  } catch (e) {
                    execResult = { error: String(e) };
                    execStatus = 'error';
                  }
                }

                const tc = {
                  name: ev.name,
                  input: ev.input,
                  result: execResult,
                  status: execStatus,
                };
                allToolCalls.push(tc);
                store.updateLastAiMessage({ toolCalls: [...allToolCalls], isThinking: false, streaming: true });
              }
            } else if (ev.type === 'image_results') {
              store.updateLastAiMessage({
                imageResults: ev.images.map(img => ({
                  url: img.url,
                  alt: img.alt,
                  thumbUrl: img.thumb,
                  photographer: img.credit,
                })),
                streaming: true,
              });
            } else if (ev.type === 'icon_results') {
              store.updateLastAiMessage({
                iconResults: Array.isArray(ev.icons)
                  ? ev.icons.map(ic => {
                      // Support both old string[] and new {id,name,prefix}[] shapes
                      if (typeof ic === 'string') return { id: ic, name: ic, prefix: '' };
                      return ic as import('./_store-types').AiIconResult;
                    })
                  : [],
                streaming: true,
              });
            } else if (ev.type === 'build_phase') {
              accPhaseLog.push({ phase: ev.phase, message: ev.message, at: Date.now() });
              const buildPhaseUpdate: Parameters<typeof store.updateLastAiMessage>[0] = {
                content: fullContent || ev.message,
                buildPhase: ev.phase,
                buildTotal: ev.total,
                isThinking: ev.phase === 'planning',
                phaseLog: [...accPhaseLog],
                streaming: true,
              };
              // Capture the AI's build plan when the 'building' phase starts.
              if (ev.phase === 'building' && ev.buildUnits) {
                buildPhaseUpdate.buildPlanUnits = ev.buildUnits;
              }
              store.updateLastAiMessage(buildPhaseUpdate);
            } else if (ev.type === 'section_progress') {
              accSectionsLog.push({ done: ev.done, total: ev.total, name: ev.name });
              store.updateLastAiMessage({
                buildDone: ev.done,
                buildTotal: ev.total,
                buildCurrentName: ev.name,
                sectionsLog: [...accSectionsLog],
                streaming: true,
              });
            } else if (ev.type === 'phase3_started') {
              // Server has switched to Phase 3 styling mode. Track this so any
              // subsequent requests (e.g. continuation with toolResults) can restore
              // PHASE3_BUILDER_TOOLS restrictions on the server side.
              isInPhase3Ref.current = true;
            } else if (ev.type === 'done') {
              store.setAiCurrentTool(null);
              // Read current buildPlanUnits so it is preserved in the final update
              const lastMsg = store.aiChatHistory[store.aiChatHistory.length - 1];
              const existingBuildPlanUnits = lastMsg?.buildPlanUnits;
              store.updateLastAiMessage({
                content: fullContent,
                toolCalls: allToolCalls.length ? allToolCalls : undefined,
                roundCount: accRoundCount || undefined,
                phaseLog: accPhaseLog.length ? accPhaseLog : undefined,
                sectionsLog: accSectionsLog.length ? accSectionsLog : undefined,
                buildPlanUnits: existingBuildPlanUnits,
                streaming: false,
              });

              // Persist assistant message
              void persistMessage(threadId!, {
                role: 'assistant',
                content: fullContent,
                toolCalls: allToolCalls.length ? allToolCalls : undefined,
              });
            } else if (ev.type === 'error') {
              store.updateLastAiMessage({ content: `Error: ${ev.message}`, streaming: false });
            }
          } catch {
            // skip malformed
          }
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        store.updateLastAiMessage({ content: `Error: ${msg}`, streaming: false });
      }
    } finally {
      store.setAiGenerating(false);
      store.setAiCurrentTool(null);
      store.updateLastAiMessage({ streaming: false });
    }
  }, [store, createThread, persistMessage, autoRenameThread]);

  // Auto-send pending message queued by the wizard (set via store.aiPendingMessage)
  useEffect(() => {
    const pending = useBuilderStore.getState().aiPendingMessage;
    if (!pending) return;
    useBuilderStore.getState().setAiPendingMessage(null);
    void sendMessage(pending);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Get full debug info (all phase prompts + tool lists) ─────────────────
  type DebugInfo = {
    systemPrompt: string;
    phase2Prompt: string;
    phase3Prompt: string;
    phase2Tools: string[];
    phase3Tools: string[];
    mainTools: string[];
  };

  const getDebugInfo = useCallback(async (): Promise<DebugInfo> => {
    const summarizeNode = (n: unknown, depth: number): unknown => {
      const node = n as Record<string, unknown>;
      const base: Record<string, unknown> = {
        id: node.id,
        type: node.type,
        name: node.name,
        text: typeof node.text === 'string' ? (node.text as string).slice(0, 60) : undefined,
        className: (node.props as { className?: string } | undefined)?.className?.slice(0, 100),
      };
      const children = node.children as unknown[] | undefined;
      if (depth > 0 && children?.length) {
        base.children = children.map(c => summarizeNode(c, depth - 1));
      } else if (children?.length) {
        base.childCount = children.length;
      }
      return base;
    };

    const pageTreeSnapshot = store.pageNodes.map(n => summarizeNode(n, 3));
    const res = await fetch('/api/ai/builder-chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '',
        pageTreeSnapshot,
        pages: store.pages.map(p => ({ id: p.id, name: p.name, route: p.route })),
        theme: { ...THEME_DEFAULTS, ...store.themeOverrides },
        mood: store.projectMood,
        animationLevel: store.projectAnimationLevel,
        layoutStructure: store.projectLayoutStructure,
        appName: store.projectAppName,
        description: store.projectDescription,
        category: store.projectCategory,
        variables: (store.customVars ?? []).map((v) => ({ id: v.id ?? v.name, name: v.name, label: v.label, type: v.type, initialValue: v.initialValue })),
        workflows: Object.entries(store.pageWorkflows ?? {}).map(([name]) => ({
          name,
          trigger: store.pageWorkflowMeta?.[name]?.trigger ?? 'click',
        })),
        dataSources: (store.pageDataSources ?? []).map((ds) => ({
          id: ds.id,
          label: ds._label ?? ds.name ?? ds.id,
          path: `collections['${ds.id}'].data`,
        })),
        model: store.aiSelectedModel,
        systemPromptOnly: true,
      }),
    });
    const data = await res.json() as Partial<DebugInfo>;
    return {
      systemPrompt: data.systemPrompt ?? '(no system prompt)',
      phase2Prompt: data.phase2Prompt ?? '(unavailable)',
      phase3Prompt: data.phase3Prompt ?? '(unavailable)',
      phase2Tools: data.phase2Tools ?? [],
      phase3Tools: data.phase3Tools ?? [],
      mainTools: data.mainTools ?? [],
    };
  }, [store]);

  // Convenience wrapper that returns only the main system prompt string (used by copy-prompt button)
  const getSystemPrompt = useCallback(async (): Promise<string> => {
    const info = await getDebugInfo();
    return info.systemPrompt;
  }, [getDebugInfo]);

  return {
    threads,
    loadingThreads,
    hasMoreThreads,
    loadingMoreThreads,
    loadMoreThreads,
    deletingThreadId,
    sendMessage,
    getSystemPrompt,
    getDebugInfo,
    startNewChat,
    createThread,
    deleteThread,
    selectThread,
    reloadThreads: loadThreads,
    loadMoreMessages,
    hasMoreMessages,
    loadingMoreMessages,
  };
}
