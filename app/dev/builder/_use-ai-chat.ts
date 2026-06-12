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
import { getSharedComponents } from '@/lib/builder/shared-component-data';
import themeConfig from '@/config/theme.json';

// Pre-compute default palette from the app's CSS variable defaults (strip '--' prefix).
// Used when the user hasn't applied a theme preset yet so the AI always receives real hex values.
const THEME_DEFAULTS: Record<string, string> = Object.fromEntries(
  Object.entries((themeConfig.cssVariables?.root ?? {}) as Record<string, string>)
    .filter(([k]) => k.startsWith('--'))
    .map(([k, v]) => [k.slice(2), v])
);

// Compact response-schema inference — converts _lastFetch.data into a readable
// type string the AI can use to know field names, nesting, and responsePath.
// Caps object fields at 12, array depth at 2 to keep tokens minimal.
// Defined at module level so it is accessible in both sendMessage and getDebugInfo.
function inferSchema(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]';
    return depth >= 2 ? 'object[]' : `${inferSchema(value[0], depth + 1)}[]`;
  }
  if (typeof value === 'object') {
    if (depth >= 2) return 'object';
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 12);
    const more = Object.keys(value as object).length > 12 ? ', ...' : '';
    return `{${entries.map(([k, v]) => `${k}:${inferSchema(v, depth + 1)}`).join(', ')}${more}}`;
  }
  return typeof value;
}

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
  | { type: 'tool_executed'; id: string; name: string; input: Record<string, unknown>; result?: unknown; error?: string; phase?: string }
  | { type: 'image_results'; images: Array<{ url: string; thumb: string; alt: string; credit: string; photographer?: string }> }
  | { type: 'icon_results'; icons: Array<{ id: string; name: string; prefix: string }> }
  | { type: 'build_phase'; phase: 'planning' | 'editing' | 'building' | 'wiring' | 'structure' | 'parallel'; total?: number; message: string; buildUnits?: Array<{ name: string; description: string; pageRoute: string; sectionCount?: number }> }
  | { type: 'section_progress'; done: number; total: number; name: string }
  | { type: 'phase3_started' }
  | { type: 'agent_context'; agent: string; displayLabel?: string; systemPrompt: string; userMessage?: string; tools: string[]; syntheticMessageCount: number; startedAt: number }
  | { type: 'agent_complete'; agent: string; rounds: number; toolCallCount: number; duration: number; endedAt: number }
  | { type: 'structure_context'; compactTree: string; varRoster: string }
  | { type: 'structure_markers'; markers: Array<{ nodeId: string; loop?: string | boolean; loopKey?: string; showIf?: string; direction?: string }> }
  | { type: 'build_plan'; mode: string; needsStyling?: boolean; needsBinding?: boolean; needsWorkflows?: boolean; editSummary?: string; buildUnits: unknown[] }
  // Phase O — consolidated events
  | { type: 'context_started'; startedAt?: number }
  | { type: 'context_complete'; duration?: number; skippedSearch?: boolean; resolvedNodeCount?: number; resolvedVariableCount?: number; toolCalls?: Array<{ name: string; input: Record<string, unknown>; result: unknown }> }
  | { type: 'planner_started'; startedAt?: number }
  | { type: 'planner_complete'; manifest: { intent?: string; needsClarification?: { question: string; options?: string[] }; operations?: Array<{ id: string; summary: string; pageRoute?: string; pageName?: string; agents?: Record<string, unknown> }> }; duration?: number }
  | { type: 'structure_started'; startedAt?: number }
  | { type: 'structure_complete'; nodes: number; variables: number; formulas: number; workflows: number; dataSources: number; duration?: number }
  | { type: 'agent_phase'; agent: string; phase: 'started' | 'tool_call' | 'complete'; opId?: string; model?: string; rounds?: number; toolCallCount?: number; duration?: number }
  | { type: 'planner_thinking'; round: number; text: string }
  | { type: 'planner_thinking_delta'; round: number; delta: string }
  | { type: 'turn_stats'; totalDurationMs: number; usdEstimate?: number; toolCalls: number; ops: number; agents: number }
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
      const body = await res.json() as {
        messages: Array<{
          id: string;
          role: string;
          content: string;
          toolCalls?: unknown;
          metadata?: Record<string, unknown>;
          createdAt: string;
        }>;
        total: number; limit: number; offset: number;
      };
      const messages = body.messages ?? [];

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
      setHasMoreMessages((body.offset ?? 0) + messages.length < (body.total ?? 0));
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
        const body = await res.json() as { threads: ChatThread[]; total: number; limit: number; offset: number };
        const data = body.threads ?? [];
        setThreads(data);
        setHasMoreThreads((body.offset ?? 0) + data.length < (body.total ?? 0));
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
        const body = await res.json() as { threads: ChatThread[]; total: number; limit: number; offset: number };
        const data = body.threads ?? [];
        setThreads(prev => {
          const existingIds = new Set(prev.map(t => t.id));
          return [...prev, ...data.filter(t => !existingIds.has(t.id))];
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
      const body = await res.json() as {
        messages: Array<{
          id: string;
          role: string;
          content: string;
          toolCalls?: unknown;
          metadata?: Record<string, unknown>;
          createdAt: string;
        }>;
        total: number; limit: number; offset: number;
      };
      const older = body.messages ?? [];
      setHasMoreMessages((body.offset ?? 0) + older.length < (body.total ?? 0));
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
      const { thread } = await res.json() as { thread: { id: string; title: string; createdAt: string; updatedAt: string } };
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
    const turnId = crypto.randomUUID();
    const userMsg: AiChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      selectedNodeIds: selectedNodeIds.length ? selectedNodeIds : undefined,
      createdAt: new Date().toISOString(),
      turnId,
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
      turnId,
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

    // Build flat node index — every node on the page with a searchable blob.
    // Sent alongside pageTreeSnapshot so the server's search_nodes can grep
    // ALL node properties (name, type, text, styles, bindings) without depth limits.
    type NodeRecord = Record<string, unknown>;
    interface NodeFlat {
      id: string;
      name?: string;
      type?: string;
      text?: string;
      path: string;
      parentId?: string;
      blob: string;
    }
    const flattenNodes = (nodes: unknown[], path = '', parentId?: string): NodeFlat[] => {
      const result: NodeFlat[] = [];
      for (const n of nodes as NodeRecord[]) {
        const nodeName = (n.name ?? n.type ?? 'Node') as string;
        const nodePath = path ? `${path} > ${nodeName}` : nodeName;
        // Resolve text: static string → use as-is; formula/object → JSON-stringify so
        // "ahmad" in a {formula:"ahmad"} still matches search_nodes("ahmad")
        const textVal = typeof n.text === 'string'
          ? n.text
          : n.text != null ? JSON.stringify(n.text) : null;
        // Include direct children's text in this node's blob so a parent Box is
        // searchable by its label. e.g. Box[button] > Text["Get Started"] → the
        // Box blob gains "Get Started", so search("Get Started") hits the Box
        // directly rather than only the Text leaf.
        const childrenText = ((n.children ?? []) as NodeRecord[])
          .map(c => (typeof c.text === 'string' ? c.text : null))
          .filter(Boolean)
          .join(' ');

        const blob = [
          n.name, n.type, n.id,
          textVal,
          childrenText,
          // Full props object (superset of className + props.style — captures all bindings)
          JSON.stringify((n.props ?? {}) as Record<string, unknown>),
          JSON.stringify((n.styles ?? {}) as Record<string, unknown>),
          JSON.stringify((n.map ?? {}) as Record<string, unknown>),
          JSON.stringify((n.actions ?? []) as unknown[]),
          // condition — visibility/show-if bindings (contains varIds and formula expressions)
          JSON.stringify((n.condition ?? '') as unknown),
        ].filter(Boolean).join(' ');
        result.push({
          id: n.id as string,
          name: n.name as string | undefined,
          type: n.type as string | undefined,
          text: typeof n.text === 'string' ? (n.text as string).slice(0, 80) : (n.text != null ? JSON.stringify(n.text).slice(0, 80) : undefined),
          path: nodePath,
          parentId,
          blob,
        });
        const children = n.children as unknown[] | undefined;
        if (children?.length) result.push(...flattenNodes(children, nodePath, n.id as string));
      }
      return result;
    };
    const nodeFlat = flattenNodes(store.pageNodes);

    // Compact cross-page index for other pages.
    // Builds the same blob as flattenNodes (props + styles serialized) so color,
    // Tailwind classes, and inline styles are all searchable — just skips the
    // heavier parts (children recursion, map, actions, condition) to keep payload bounded.
    type CompactNode = { id: string; name?: string; type?: string; text?: string; blob?: string };
    const flattenNodesCompact = (nodes: unknown[], acc: CompactNode[] = []): CompactNode[] => {
      for (const n of nodes as NodeRecord[]) {
        const textVal = typeof n.text === 'string' ? (n.text as string).slice(0, 80) : undefined;
        acc.push({
          id: n.id as string,
          name: n.name as string | undefined,
          type: n.type as string | undefined,
          text: textVal,
          blob: [
            n.name, n.type, n.id, textVal,
            JSON.stringify((n.props ?? {}) as Record<string, unknown>),
            JSON.stringify((n.styles ?? {}) as Record<string, unknown>),
          ].filter(Boolean).join(' ').slice(0, 600),
        });
        const children = n.children as unknown[] | undefined;
        if (children?.length) flattenNodesCompact(children, acc);
      }
      return acc;
    };
    const otherPagesIndex = store.pages
      .filter(p => p.id !== store.currentPageId)
      .map(p => ({
        pageId: p.id,
        pageName: p.name,
        pageRoute: (p as unknown as { route?: string }).route,
        nodes: flattenNodesCompact((p as unknown as { nodes?: unknown[] }).nodes ?? []),
      }));

    // Compact global formula index — name + preview (first 80 chars of expression).
    const globalFormulasIndex = Object.values(
      (store as unknown as { globalFormulas?: Record<string, { name: string; formula: string }> }).globalFormulas ?? {}
    ).map(f => ({ name: f.name, preview: f.formula.slice(0, 80) }));

    // Compact shared component index — id + name only.
    const sharedComponentsIndex = Object.values(getSharedComponents()).map(sc => ({
      id: sc.id,
      name: sc.name,
    }));

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
          nodeFlat,
          otherPagesIndex,
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
          workflows: [
            ...Object.entries(store.pageWorkflows ?? {}).map(([name, steps]) => ({
              name,
              trigger: store.pageWorkflowMeta?.[name]?.trigger ?? 'click',
              stepTypes: (steps as { type?: string }[]).map(s => s.type).filter(Boolean),
              steps,
              scope: 'page' as const,
            })),
            ...Object.entries(
              (store as unknown as { globalWorkflowMeta?: Record<string, { name: string; trigger?: string }> }).globalWorkflowMeta ?? {}
            ).map(([id, meta]) => {
              const globalSteps = (store as unknown as { globalWorkflows?: Record<string, { type?: string }[]> }).globalWorkflows?.[id] ?? [];
              return {
                id,
                name: meta.name,
                trigger: meta.trigger,
                stepTypes: globalSteps.map((s) => s.type).filter(Boolean),
                steps: globalSteps,
                scope: 'global' as const,
              };
            }),
          ],
          dataSources: (store.pageDataSources ?? []).map((ds) => ({
            id: ds.id,
            label: ds._label ?? ds.name ?? ds.id,
            path: `collections['${ds.id}'].data`,
            schema: ds._lastFetch?.status === 'success' && ds._lastFetch.data != null
              ? inferSchema(ds._lastFetch.data)
              : undefined,
            // sampleResponse: most recent successful fetch result (capped 2KB).
            // Used by Context Agent to search nested field paths without running a fetch.
            sampleResponse: ds._lastFetch?.status === 'success' && ds._lastFetch.data != null
              ? JSON.stringify(ds._lastFetch.data).slice(0, 2048)
              : undefined,
          })),
          globalFormulas: globalFormulasIndex,
          sharedComponents: sharedComponentsIndex,
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
      let accRoundCount = 0;
      const accPhaseLog: Array<{ phase: string; message: string; at: number }> = [];
      const accSectionsLog: Array<{ done: number; total: number; name: string }> = [];
      const allToolCalls: AiChatMessage['toolCalls'] = [];
      const accAgentDebugInfo: Record<string, import('./_store-types').AgentDebugInfo> = {};
      let accStructureContext: { compactTree: string; varRoster: string } | null = null;
      let accStructureMarkers: AiChatMessage['structureMarkers'] = undefined;
      let accBuildPlan: AiChatMessage['buildPlan'] = undefined;
      // Phase O — debug envelope accumulator
      const turnStartedAt = Date.now();
      const debug: import('./_store-types').PhaseODebugEnvelope = { agents: {} };

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
              accRoundCount = Math.max(accRoundCount, ev.round ?? 1);
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
                    execResult = result.success ? result.data : { error: result.error };
                    execStatus = result.success ? 'success' : 'error';

                    // Belt-and-suspenders: after generate_structure succeeds, ensure every
                    // minted workflow UUID is stored as a direct key in pageWorkflows.
                    // Old client bundles key by human name — this patch adds the UUID key so
                    // add_workflow_step's direct lookup always finds it without needing the
                    // meta.id scan, eliminating the HMR race condition.
                    if (ev.name === 'generate_structure' && execStatus === 'success') {
                      const minted = (execResult as { mintedWorkflows?: Array<{ workflowId: string; name: string; trigger: string }> })?.mintedWorkflows;
                      if (Array.isArray(minted)) {
                        const patchStore = useBuilderStore.getState();
                        const pageId = (ev.input as { _pageId?: string })?._pageId;
                        for (const { workflowId, name, trigger } of minted) {
                          if (!(patchStore.pageWorkflows as Record<string, unknown>)?.[workflowId]) {
                            patchStore.setPageWorkflow(workflowId, []);
                            const meta: Record<string, unknown> = { id: workflowId, name, trigger };
                            if (pageId) meta.pageScope = pageId;
                            patchStore.setPageWorkflowMeta(
                              workflowId,
                              meta as Parameters<typeof patchStore.setPageWorkflowMeta>[1],
                            );
                          }
                        }
                      }
                    }
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
                  phase: ev.phase,
                  timestamp: Date.now(),
                  round: accRoundCount || 1,
                  aiBlind: CLIENT_SIDE_TOOLS.has(ev.name) && execStatus === 'error',
                };
                allToolCalls.push(tc);
                // Group tool call into its agent's debug info
                if (ev.phase && accAgentDebugInfo[ev.phase]) {
                  accAgentDebugInfo[ev.phase].toolCalls.push(tc);
                }
                store.updateLastAiMessage({ toolCalls: [...allToolCalls], agentDebugInfo: { ...accAgentDebugInfo }, isThinking: false, streaming: true });
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
            } else if (ev.type === 'agent_context') {
              accAgentDebugInfo[ev.agent] = {
                agent: ev.agent,
                displayLabel: (ev as { displayLabel?: string }).displayLabel,
                systemPrompt: ev.systemPrompt,
                userMessage: ev.userMessage,
                tools: ev.tools,
                syntheticMessageCount: ev.syntheticMessageCount,
                startedAt: ev.startedAt,
                toolCalls: [],
              };
              // Mirror into the activity-feed envelope so the user sees per-agent rows
              // light up the moment each agent kicks off (status: 'running'). Tool-count
              // and duration get filled in by agent_complete below.
              const ag = (debug.agents ??= {});
              ag[ev.agent] = {
                ...(ag[ev.agent] ?? {}),
                displayLabel: (ev as { displayLabel?: string }).displayLabel,
                tools: ev.tools,
                startedAt: ev.startedAt,
                status: 'running',
              };
              store.updateLastAiMessage({ agentDebugInfo: { ...accAgentDebugInfo }, debug: { ...debug }, streaming: true });
            } else if (ev.type === 'agent_complete') {
              const info = accAgentDebugInfo[ev.agent];
              if (info) {
                info.endedAt = ev.endedAt;
                info.rounds = ev.rounds;
                info.toolCallCount = ev.toolCallCount;
                info.duration = ev.duration;
              }
              // Mirror legacy agent_complete into the new-arch debug.agents map so the
              // Cursor-style activity feed can render every agent (structure / media /
              // styling:hero / styling:about / animation:* / binding / workflows) — not
              // just the new-arch shadow.
              const ag = (debug.agents ??= {});
              ag[ev.agent] = {
                ...(ag[ev.agent] ?? {}),
                rounds: ev.rounds,
                toolCallCount: ev.toolCallCount,
                duration: ev.duration,
                endedAt: ev.endedAt,
                status: ev.toolCallCount > 0 ? 'completed' : 'skipped',
              };
              // When the real LLM structure agent finishes, mark the inline structure
              // row as done and compute total wall-clock time from structure_started.
              if (ev.agent === 'structure' && debug.structure) {
                const totalDuration = debug.structure.startedAt
                  ? Date.now() - debug.structure.startedAt
                  : ev.duration;
                debug.structure = { ...debug.structure, status: 'done', duration: totalDuration };
              }
              store.updateLastAiMessage({ agentDebugInfo: { ...accAgentDebugInfo }, debug: { ...debug }, streaming: true });
            } else if (ev.type === 'structure_context') {
              accStructureContext = { compactTree: ev.compactTree, varRoster: ev.varRoster };
            } else if (ev.type === 'structure_markers') {
              accStructureMarkers = ev.markers;
            } else if (ev.type === 'build_plan') {
              accBuildPlan = { mode: ev.mode, needsStyling: ev.needsStyling, needsBinding: ev.needsBinding, needsWorkflows: ev.needsWorkflows, editSummary: ev.editSummary, buildUnits: ev.buildUnits };
            } else if (ev.type === 'phase3_started') {
              isInPhase3Ref.current = true;
            } else if (ev.type === 'context_started') {
              debug.context = { status: 'running', startedAt: (ev as { startedAt?: number }).startedAt ?? Date.now() };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'context_complete') {
              debug.context = {
                ...debug.context,
                status: 'done',
                duration: ev.duration,
                skippedSearch: ev.skippedSearch,
                resolvedNodeCount: ev.resolvedNodeCount,
                toolCalls: ev.toolCalls,
              };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'planner_started') {
              debug.planner = { status: 'running', startedAt: (ev as { startedAt?: number }).startedAt ?? Date.now(), manifest: {} };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'planner_complete') {
              debug.planner = {
                status: 'done',
                startedAt: debug.planner?.startedAt,
                duration: (ev as { duration?: number }).duration,
                thinking: debug.planner?.thinking,
                thinkingLive: undefined, // clear live stream — full blocks are in thinking[]
                manifest: {
                  intent: ev.manifest.intent,
                  needsClarification: ev.manifest.needsClarification,
                  operations: ev.manifest.operations?.map(op => ({
                    id: op.id,
                    pageRoute: op.pageRoute,
                    pageName: op.pageName,
                    agents: op.agents,
                  })),
                },
              };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'planner_thinking') {
              debug.planner = {
                ...debug.planner,
                manifest: debug.planner?.manifest ?? {},
                thinking: [...(debug.planner?.thinking ?? []), { round: ev.round, text: ev.text }],
              };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'planner_thinking_delta') {
              debug.planner = {
                ...debug.planner,
                manifest: debug.planner?.manifest ?? {},
                thinkingLive: (debug.planner?.thinkingLive ?? '') + ev.delta,
              };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'structure_started') {
              debug.structure = { status: 'running', startedAt: (ev as { startedAt?: number }).startedAt ?? Date.now() };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'structure_complete') {
              // Mark structure done immediately — for styling-only edits the LLM structure
              // agent is skipped entirely so agent_complete:structure never fires. If the LLM
              // agent does run, agent_complete:structure below will overwrite with a more
              // accurate wall-clock duration — no harm done either way.
              const elapsed = debug.structure?.startedAt ? Date.now() - debug.structure.startedAt : 0;
              debug.structure = {
                ...debug.structure,
                nodes: ev.nodes, variables: ev.variables,
                formulas: ev.formulas, workflows: ev.workflows, dataSources: ev.dataSources,
                status: 'done',
                duration: elapsed,
              };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'agent_phase') {
              const ag = (debug.agents ??= {});
              const cur = ag[ev.agent] ?? {};
              ag[ev.agent] = { ...cur, opId: ev.opId, model: ev.model, rounds: ev.rounds ?? cur.rounds, toolCallCount: ev.toolCallCount ?? cur.toolCallCount, duration: ev.duration ?? cur.duration };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'turn_stats') {
              debug.stats = { totalDurationMs: ev.totalDurationMs, usdEstimate: ev.usdEstimate, toolCalls: ev.toolCalls, ops: ev.ops, agents: ev.agents };
              store.updateLastAiMessage({ debug: { ...debug }, streaming: true });
            } else if (ev.type === 'done') {
              store.setAiCurrentTool(null);
              // Read current buildPlanUnits so it is preserved in the final update
              const lastMsg = store.aiChatHistory[store.aiChatHistory.length - 1];
              const existingBuildPlanUnits = lastMsg?.buildPlanUnits;
              if (!debug.stats) {
                debug.stats = {
                  totalDurationMs: Date.now() - turnStartedAt,
                  toolCalls: allToolCalls.length,
                  ops: debug.planner?.manifest?.operations?.length ?? 0,
                  agents: Object.keys(accAgentDebugInfo).length,
                };
              }
              store.updateLastAiMessage({
                content: fullContent,
                toolCalls: allToolCalls.length ? allToolCalls : undefined,
                roundCount: accRoundCount || undefined,
                phaseLog: accPhaseLog.length ? accPhaseLog : undefined,
                sectionsLog: accSectionsLog.length ? accSectionsLog : undefined,
                buildPlanUnits: existingBuildPlanUnits,
                agentDebugInfo: Object.keys(accAgentDebugInfo).length ? accAgentDebugInfo : undefined,
                structureContext: accStructureContext ?? undefined,
                structureMarkers: accStructureMarkers,
                buildPlan: accBuildPlan,
                debug: { ...debug },
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
    planningPrompt: string;
    phase2Prompt: string;
    phase3Prompt: string;
    phaseWPrompt: string;
    phase2Tools: string[];
    phase3Tools: string[];
    phaseWTools: string[];
    mainTools: string[];
  };

  const getDebugInfo = useCallback(async (): Promise<DebugInfo> => {
    // The systemPromptOnly endpoint was removed. New-arch debug data lives in
    // msg.debug (PhaseODebugEnvelope) which is already in the chat history.
    // Return empty stubs so the legacy fallback path in handleCopyToolsLog still
    // compiles; it is never reached when hasNewArchData is true.
    return {
      systemPrompt: '',
      planningPrompt: '',
      phase2Prompt: '',
      phase3Prompt: '',
      phaseWPrompt: '',
      phase2Tools: [],
      phase3Tools: [],
      phaseWTools: [],
      mainTools: [],
    };
  }, []);

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
