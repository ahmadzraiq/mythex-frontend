'use client';

/**
 * DSL Chat Panel — right-side panel for the builder DSL mode.
 *
 * Uses @anthropic-ai/sdk via /api/ai/dsl-chat with an in-memory VFS.
 * Claude writes DSL files using write_file / read_file / edit_file tools.
 * After each turn, compiled pages are pushed directly to the builder canvas
 * via applyVirtualFile(). DSL sources are persisted to the project DB so
 * sessions can be restored on refresh.
 *
 * Tabs:
 *   Chat — streaming conversation with Claude
 *   Files — browse/view DSL files from the in-memory VFS
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBuilderStore } from './_store';
import { applyVirtualFile } from './_virtual-files';

function useProjectId(): string | null {
  const searchParams = useSearchParams();
  const pathname = usePathname() ?? '';
  const fromSearch = searchParams.get('projectId');
  const fromPath = pathname.startsWith('/builder/')
    ? (pathname.split('/')[2] ?? null)
    : null;
  return fromSearch ?? fromPath;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DslMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: string[];
  isStreaming?: boolean;
}

// ─── useNDJsonStream — reads streaming NDJSON from /api/ai/dsl-chat ──────────

function useNDJsonStream(projectId?: string) {
  const [messages, setMessages] = useState<DslMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  // DSL sources returned by the server — persisted to project DB and restored on reload
  const [dslSources, setDslSources] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  // Restore DSL sources from project DB on mount so the AI has context on page refresh
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/config/meta`)
      .then(r => r.json())
      .then((data: unknown) => {
        const sources = (data as Record<string, unknown>)?.dslSources as Record<string, string> | undefined;
        if (sources && Object.keys(sources).length > 0) {
          setDslSources(sources);
        }
      })
      .catch(() => { /* non-critical — session starts fresh */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const sendMessage = useCallback(async (userText: string) => {
    if (!userText.trim() || isStreaming) return;

    const userMsg: DslMessage = { id: Date.now() + '-u', role: 'user', content: userText };
    const assistantId = Date.now() + '-a';
    const assistantMsg: DslMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolEvents: [],
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/ai/dsl-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          projectId,
          dslSources,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: `Error: ${errText}`, isStreaming: false } : m
        ));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;

            // var_written / page_written / workflow_written / routes_written: push to builder store
            if (
              event.type === 'var_written' ||
              event.type === 'page_written' ||
              event.type === 'workflow_written' ||
              event.type === 'routes_written'
            ) {
              const store = useBuilderStore.getState();
              const result = applyVirtualFile(store, event.path as string, event.content as string);
              if (!result.ok) {
                console.warn(`[DSL] applyVirtualFile failed for ${event.path as string}:`, result.error);
              }
              continue;
            }

            // dsl_sources: persist to project DB and keep in local state
            if (event.type === 'dsl_sources') {
              const sources = event.sources as Record<string, string>;
              setDslSources(sources);
              if (projectId) {
                fetch(`/api/projects/${projectId}/config/meta`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ dslSources: sources }),
                }).catch(() => { /* best-effort */ });
              }
              continue;
            }

            setMessages(prev => prev.map(m => {
              if (m.id !== assistantId) return m;
              if (event.type === 'text') {
                return { ...m, content: m.content + (event.content as string) };
              }
              if (event.type === 'tool_use') {
                return { ...m, toolEvents: [...(m.toolEvents ?? []), `→ ${event.toolName as string}`] };
              }
              if (event.type === 'tool_result') {
                return m;
              }
              if (event.type === 'result') {
                const resultContent = event.content && m.content === '' ? event.content as string : m.content;
                return { ...m, content: resultContent, isStreaming: false };
              }
              if (event.type === 'done') {
                return { ...m, isStreaming: false };
              }
              if (event.type === 'error') {
                return { ...m, content: m.content || `Error: ${event.error as string}`, isStreaming: false };
              }
              return m;
            }));
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `Connection error: ${(err as Error).message}`, isStreaming: false }
            : m
        ));
      }
    } finally {
      setIsStreaming(false);
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, isStreaming: false } : m
      ));
    }
  }, [isStreaming, projectId, dslSources]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsStreaming(false);
  }, []);

  return { messages, isStreaming, sendMessage, clear, dslSources };
}

// ─── FilesView — shows DSL files from the in-memory VFS ──────────────────────

function FilesView({ sources }: { sources: Record<string, string> }) {
  const [selected, setSelected] = useState<string | null>(null);

  // Auto-select first file when sources arrive
  useEffect(() => {
    const keys = Object.keys(sources);
    if (keys.length > 0 && (!selected || !sources[selected])) {
      setSelected(keys[0]);
    }
  }, [sources, selected]);

  const fileNames = Object.keys(sources);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* File list */}
      <div style={{
        display: 'flex', gap: 4, flexWrap: 'wrap', padding: '8px 12px',
        borderBottom: '1px solid var(--bld-border)',
        background: 'var(--bld-bg-elevated)',
      }}>
        {fileNames.length === 0 && (
          <span style={{ fontSize: 11, color: 'var(--bld-text-3)' }}>
            No DSL files yet. Ask the AI to create a page.
          </span>
        )}
        {fileNames.map(f => (
          <button
            key={f}
            onClick={() => setSelected(f)}
            style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
              background: selected === f ? 'rgba(124,58,237,0.15)' : 'var(--bld-bg-input)',
              border: `1px solid ${selected === f ? 'rgba(124,58,237,0.4)' : 'var(--bld-border)'}`,
              color: selected === f ? '#a78bfa' : 'var(--bld-text-2)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* CodeMirror editor */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {selected && sources[selected] !== undefined ? (
          <CodeMirror
            value={sources[selected]}
            theme={oneDark}
            extensions={[javascript({ jsx: true, typescript: true })]}
            editable={false}
            basicSetup={{ lineNumbers: true, foldGutter: false }}
            style={{ fontSize: 12, height: '100%' }}
          />
        ) : (
          <div style={{
            padding: 24, color: 'var(--bld-text-3)', fontSize: 12, fontFamily: 'monospace',
            textAlign: 'center', paddingTop: 48,
          }}>
            Select a file above to view its source
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function DslChatPanel() {
  const projectId = useProjectId() ?? undefined;
  const { messages, isStreaming, sendMessage, clear, dslSources } = useNDJsonStream(projectId);
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<'chat' | 'files'>('chat');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void sendMessage(text);
  }, [input, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const tabStyle = (active: boolean) => ({
    padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
    color: active ? '#a78bfa' : 'var(--bld-text-2)',
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid #7c3aed' : '2px solid transparent',
    outline: 'none', transition: 'color 0.15s',
  } as React.CSSProperties);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bld-bg)', color: 'var(--bld-text-1)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--bld-border)',
        background: 'var(--bld-bg-elevated)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
            background: 'rgba(124,58,237,0.15)', color: '#a78bfa', letterSpacing: 1,
            border: '1px solid rgba(124,58,237,0.25)',
          }}>DSL</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Builder DSL</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={clear} title="Clear conversation" style={{
            fontSize: 16, padding: '2px 6px', background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--bld-text-3)',
          }}>⊘</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid var(--bld-border)',
        background: 'var(--bld-bg-elevated)', flexShrink: 0,
      }}>
        <button style={tabStyle(tab === 'chat')} onClick={() => setTab('chat')}>Chat</button>
        <button style={tabStyle(tab === 'files')} onClick={() => setTab('files')}>Files</button>
      </div>

      {/* Content */}
      {tab === 'files' ? (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FilesView sources={dslSources} />
        </div>
      ) : (
        <>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 0' }}>
            {messages.length === 0 && (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--bld-text-3)', fontSize: 13 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✦</div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>Builder DSL Mode</div>
                <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                  Claude writes TypeScript/JSX files directly.<br />
                  No stringify, no schema issues.
                </div>
                <div style={{ marginTop: 16, fontSize: 11, color: 'var(--bld-text-3)' }}>
                  Try: "Build an Apple calculator app"
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} style={{
                marginBottom: 12,
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                {/* Tool events */}
                {msg.role === 'assistant' && (msg.toolEvents ?? []).length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    {(msg.toolEvents ?? []).map((ev, i) => (
                      <div key={i} style={{
                        fontSize: 10, color: '#a78bfa', fontFamily: 'monospace',
                        padding: '1px 6px', background: 'rgba(124,58,237,0.08)',
                        borderRadius: 4, marginBottom: 2, display: 'inline-block',
                      }}>
                        {ev}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{
                  maxWidth: '90%', padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: msg.role === 'user' ? 'rgba(124,58,237,0.12)' : 'var(--bld-bg-elevated)',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(124,58,237,0.2)' : 'var(--bld-border)'}`,
                  fontSize: 13, lineHeight: 1.5,
                }}>
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: ({ children, className, ...props }) => {
                          const isInline = !className;
                          return isInline ? (
                            <code style={{ background: 'rgba(124,58,237,0.1)', padding: '1px 4px', borderRadius: 3, fontSize: '0.9em', fontFamily: 'monospace' }} {...props}>{children}</code>
                          ) : (
                            <pre style={{ background: 'var(--bld-bg)', padding: 10, borderRadius: 6, overflow: 'auto', margin: '6px 0' }}>
                              <code style={{ fontFamily: 'monospace', fontSize: 11 }} {...props}>{children}</code>
                            </pre>
                          );
                        },
                        p: ({ children }) => <p style={{ margin: '4px 0' }}>{children}</p>,
                      }}
                    >
                      {msg.content || (msg.isStreaming ? '…' : '')}
                    </ReactMarkdown>
                  ) : (
                    <span>{msg.content}</span>
                  )}
                  {msg.isStreaming && (
                    <span style={{
                      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                      background: '#7c3aed', marginLeft: 4, verticalAlign: 'middle',
                      animation: 'aiCursorPulse 1s ease-in-out infinite',
                    }} />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '8px 10px 10px',
            borderTop: '1px solid var(--bld-border)',
            background: 'var(--bld-bg-elevated)',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 6,
              border: '1px solid var(--bld-border)', borderRadius: 10,
              background: 'var(--bld-bg)',
              padding: '8px 10px',
              boxShadow: isStreaming ? '0 0 0 1px rgba(124,58,237,0.3)' : 'none',
              transition: 'box-shadow 0.2s',
            }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                placeholder={isStreaming ? 'Claude is working…' : 'Describe the app or change you want…'}
                rows={3}
                style={{
                  resize: 'none', background: 'none', border: 'none', outline: 'none',
                  color: 'var(--bld-text-1)', fontSize: 13, lineHeight: 1.5,
                  fontFamily: 'inherit', width: '100%',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleSend}
                  disabled={isStreaming || !input.trim()}
                  style={{
                    padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: (isStreaming || !input.trim()) ? 'var(--bld-bg-input)' : '#7c3aed',
                    color: (isStreaming || !input.trim()) ? 'var(--bld-text-3)' : '#fff',
                    border: 'none', cursor: (isStreaming || !input.trim()) ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  {isStreaming ? '…' : '↑ Send'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
