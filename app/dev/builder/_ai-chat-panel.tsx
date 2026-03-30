'use client';

/**
 * AI Chat Panel — right-side drawer that replaces the design panel when aiMode is true.
 *
 * Features:
 * - New Chat button in the header (lazy — thread created only on first send)
 * - History dropdown (thread list) with max-height, 10 items/page, infinite scroll, delete spinner
 * - Collapsible ToolCallsGroup with animated dots while streaming
 * - Thinking dots + blinking cursor inside the streaming bubble
 * - Character-by-character typewriter animation for streaming text
 * - Node chips inside the input container (above textarea)
 * - Rewind/edit banner inside the input container
 * - Modern AI-style input with glow on focus
 * - Cancel edit restores isEditing: false (message stays visible)
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBuilderStore } from './_store';
import { useAiChat } from './_use-ai-chat';
import type { AiChatMessage, AiToolCall, AiImageResult, AiIconResult } from './_store-types';
import { BUILDER_MODELS, type BuilderModelId } from './_store-types';

// ---------------------------------------------------------------------------
// AnimatedDots
// ---------------------------------------------------------------------------

function AnimatedDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', marginLeft: 4 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 3, height: 3, borderRadius: '50%', background: '#7c3aed',
          display: 'inline-block', animation: `bounce 1.2s infinite ${i * 0.2}s`,
        }} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StreamCursor — pulsing inline circle that sits at the end of streamed text
// ---------------------------------------------------------------------------

function StreamCursor() {
  return (
    <span style={{
      display: 'inline-block',
      width: 7, height: 7,
      borderRadius: '50%',
      background: '#7c3aed',
      marginLeft: 4,
      verticalAlign: 'middle',
      animation: 'aiCursorPulse 1s ease-in-out infinite',
      boxShadow: '0 0 8px rgba(124,58,237,0.7)',
      flexShrink: 0,
    }} />
  );
}

// ---------------------------------------------------------------------------
// ToolRow — compact single-line with expandable detail
// ---------------------------------------------------------------------------

function ToolRow({ tool, stepNumber }: { tool: AiToolCall; stepNumber: number }) {
  const [open, setOpen] = useState(false);
  const isError = tool.status === 'error';
  const isGenerating = (tool.status as string) === 'generating';
  const isPending = !tool.status || (tool.status as string) === 'pending';
  const isDone = !isPending && !isGenerating && !isError;
  const label = tool.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const dotStyle: React.CSSProperties = (isGenerating || isPending)
    ? {
        background: isGenerating ? '#4f46e5' : '#1e293b',
        animation: isGenerating ? 'toolDotSpin 1.4s linear infinite' : 'none',
      }
    : isError
    ? { background: '#ef4444' }
    : { background: '#34d399', animation: 'toolDotPop 0.35s cubic-bezier(0.34,1.56,0.64,1)' };

  const labelAnim = (isPending || isGenerating) ? 'toolLabelShimmer 1.8s ease-in-out infinite' : 'none';
  const labelColor = (isGenerating || isPending) ? '#475569' : isError ? '#fca5a5' : '#94a3b8';

  return (
    <div style={{ animation: 'toolSlideIn 0.18s ease-out both' }}>
      <button
        data-testid="tool-badge"
        data-tool-name={tool.name}
        data-tool-status={tool.status ?? 'success'}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, width: '100%',
          padding: '2px 0', border: 'none', background: 'transparent',
          fontSize: 11, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        {/* Status dot — pops on success, spins on generating */}
        <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, ...dotStyle }} />
        {/* Step number */}
        <span style={{ color: '#334155', fontSize: 10, flexShrink: 0, minWidth: 18, textAlign: 'right' }}>
          {stepNumber}
        </span>
        {/* Label — shimmer while pending/generating */}
        <span style={{
          color: labelColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          animation: labelAnim,
        }}>
          {label}
        </span>
        {/* Checkmark badge on done */}
        {isDone && (
          <span style={{ fontSize: 9, color: '#34d399', flexShrink: 0, animation: 'toolDotPop 0.35s ease-out' }}>✓</span>
        )}
      </button>
      {open && (
        <pre style={{
          margin: '3px 0 3px 30px', padding: '5px 8px', borderRadius: 5,
          borderLeft: '1px solid #1e293b',
          fontSize: 10, color: '#475569', overflow: 'auto', maxHeight: 100, fontFamily: 'monospace',
        }}>
          {JSON.stringify({ input: tool.input, result: tool.result }, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallsGroup — live during streaming, collapsed summary when done
// ---------------------------------------------------------------------------

const LIVE_MAX = 5;

function ToolCallsGroup({ tools, streaming, isThinking }: { tools: AiToolCall[]; streaming: boolean; isThinking?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const startRef = useRef(Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const hasError = tools.some(t => t.status === 'error');
  const n = tools.length;

  useEffect(() => {
    if (!streaming) return;
    startRef.current = Date.now() - elapsed * 1000;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 500);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  useEffect(() => {
    if (!streaming && totalMs === null && elapsed > 0) setTotalMs(Date.now() - startRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  useEffect(() => {
    if (streaming && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [streaming, n]);

  const timeLabel = totalMs !== null ? `${(totalMs / 1000).toFixed(1)}s` : null;

  // ── Streaming state ──────────────────────────────────────────────────────
  if (streaming) {
    const live = tools.slice(-LIVE_MAX);
    const hidden = n - live.length;
    return (
      <div style={{ marginBottom: 10 }}>
        {/* Live header: animated dots + count, or "Planning…" between rounds */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <AnimatedDots />
          <span style={{ fontSize: 11, color: '#475569' }}>
            {isThinking
              ? <span style={{ color: '#334155', fontStyle: 'italic' }}>Planning next steps…</span>
              : <>{n} step{n !== 1 ? 's' : ''}</>
            }
          </span>
        </div>
        {/* Rows — paddingRight leaves room so scrollbar never covers step numbers */}
        <div ref={listRef}
          style={{ borderLeft: '1px solid #1e293b', paddingLeft: 8, paddingRight: 14, maxHeight: 130, overflowY: 'auto' }}>
          {hidden > 0 && (
            <div style={{ fontSize: 10, color: '#1e293b', marginBottom: 2 }}>+{hidden} earlier</div>
          )}
          {live.map(t => (
            <ToolRow key={tools.indexOf(t)} tool={t} stepNumber={tools.indexOf(t) + 1} />
          ))}
        </div>
      </div>
    );
  }

  // ── Done state ───────────────────────────────────────────────────────────
  // Status dot: green = success, red = has errors
  const doneDotColor = hasError ? '#ef4444' : '#34d399';
  return (
    <div style={{ marginBottom: 10 }}>
      {/* Summary line: dot · N steps · Xs ▼ */}
      <button
        data-testid="tool-calls-group-btn"
        onClick={() => setExpanded(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: 0, border: 'none', background: 'transparent',
          fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: doneDotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: '#475569' }}>
          {n} step{n !== 1 ? 's' : ''}
        </span>
        {timeLabel && (
          <span style={{ fontSize: 11, color: '#334155' }}>· {timeLabel}</span>
        )}
        <span style={{ fontSize: 9, color: '#334155' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded list — paddingRight prevents scrollbar overlap */}
      {expanded && (
        <div style={{
          borderLeft: '1px solid #1e293b', paddingLeft: 8, paddingRight: 14,
          marginTop: 5, maxHeight: 220, overflowY: 'auto',
        }}>
          {tools.map((t, i) => <ToolRow key={i} tool={t} stepNumber={i + 1} />)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThinkingBlock — collapsible extended-thinking display (Sonnet only)
// ---------------------------------------------------------------------------

function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setExpanded(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 8px', borderRadius: 6,
          border: '1px solid rgba(124,58,237,0.3)',
          background: 'rgba(124,58,237,0.1)',
          color: '#c4b5fd', fontSize: 10, fontWeight: 500,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: 9 }}>✦</span>
        {streaming ? (
          <>
            <span>Reasoning</span>
            <AnimatedDots />
          </>
        ) : (
          <>
            <span>{expanded ? 'Hide reasoning' : 'View reasoning'}</span>
            <span style={{ fontSize: 8, opacity: 0.7 }}>{expanded ? '▲' : '▼'}</span>
          </>
        )}
      </button>

      {(expanded || streaming) && content && (
        <div style={{
          marginTop: 5, padding: '8px 10px',
          borderLeft: '2px solid rgba(124,58,237,0.4)',
          borderRadius: '0 6px 6px 0',
          background: 'rgba(124,58,237,0.05)',
          fontSize: 11, color: '#94a3b8', lineHeight: 1.6,
          maxHeight: expanded ? 320 : 120, overflowY: 'auto',
          whiteSpace: 'pre-wrap', fontFamily: 'inherit',
          transition: 'max-height 0.2s',
        }}>
          {content}
          {streaming && (
            <span style={{ display: 'inline-block', marginLeft: 2, animation: 'pulse 1s infinite', color: '#7c3aed' }}>▌</span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageResultChips — thumbnail strip for image search results
// ---------------------------------------------------------------------------

function ImageResultChips({ images }: { images: AiImageResult[] }) {
  if (!images?.length) return null;
  return (
    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {images.slice(0, 6).map((img, i) => (
        <a key={i} href={img.url} target="_blank" rel="noopener noreferrer"
          title={img.alt ?? img.photographer ?? ''}
          style={{
            display: 'block', borderRadius: 6, overflow: 'hidden',
            width: 60, height: 44, border: '1px solid #1e293b', flexShrink: 0,
            transition: 'transform 0.1s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1.05)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.transform = 'scale(1)'; }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.thumbUrl ?? img.url} alt={img.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IconResultChips — small pill strip for icon search results
// ---------------------------------------------------------------------------

function IconResultChips({ icons }: { icons: AiIconResult[] }) {
  if (!icons?.length) return null;
  return (
    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {icons.slice(0, 12).map((ic, i) => (
        <span key={i} style={{
          fontSize: 10, padding: '2px 7px', borderRadius: 20,
          background: 'rgba(79,70,229,0.12)', color: '#a5b4fc',
          border: '1px solid rgba(79,70,229,0.25)',
        }}>
          {ic.prefix ? `${ic.prefix}:${ic.name}` : ic.name}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown components
// ---------------------------------------------------------------------------

const MD_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  h1: ({...p}) => <h1 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, marginTop: 8, color: '#f1f5f9' }} {...p} />,
  h2: ({...p}) => <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, marginTop: 6, color: '#f1f5f9' }} {...p} />,
  h3: ({...p}) => <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 4, color: '#e2e8f0' }} {...p} />,
  p:  ({...p}) => <p  style={{ margin: '4px 0', lineHeight: 1.65 }} {...p} />,
  ul: ({...p}) => <ul style={{ paddingLeft: 18, margin: '4px 0' }} {...p} />,
  ol: ({...p}) => <ol style={{ paddingLeft: 18, margin: '4px 0' }} {...p} />,
  li: ({...p}) => <li style={{ marginBottom: 2, lineHeight: 1.5 }} {...p} />,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code: (({ inline, ...p }: { inline?: boolean } & React.HTMLAttributes<HTMLElement>) =>
    inline
      ? <code style={{ background: '#0f172a', borderRadius: 4, padding: '1px 5px', fontSize: 11, color: '#7dd3fc', fontFamily: 'monospace' }} {...p} />
      : <pre style={{ background: '#0a0f1a', borderRadius: 8, padding: '8px 10px', overflowX: 'auto', fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', margin: '6px 0', border: '1px solid #1e293b' }}><code {...p} /></pre>
  ) as React.ComponentType<React.HTMLAttributes<HTMLElement>>,
  a:  ({...p}) => <a  style={{ color: '#818cf8', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer" {...p} />,
  strong: ({...p}) => <strong style={{ fontWeight: 700, color: '#e2e8f0' }} {...p} />,
  em: ({...p}) => <em style={{ fontStyle: 'italic', color: '#cbd5e1' }} {...p} />,
  blockquote: ({...p}) => <blockquote style={{ borderLeft: '2px solid #4f46e5', paddingLeft: 10, margin: '6px 0', color: '#94a3b8', fontStyle: 'italic' }} {...p} />,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #1e293b', margin: '8px 0' }} />,
  table: ({...p}) => <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, margin: '6px 0' }} {...p} />,
  th: ({...p}) => <th style={{ padding: '4px 8px', background: '#0f172a', borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left', fontWeight: 600 }} {...p} />,
  td: ({...p}) => <td style={{ padding: '4px 8px', borderBottom: '1px solid #1e293b', color: '#cbd5e1' }} {...p} />,
};

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function CopyMsgLogBtn({ msg }: { msg: AiChatMessage }) {
  const [label, setLabel] = useState<'idle' | 'copied'>('idle');

  const handleCopy = () => {
    const payload = {
      role: msg.role,
      content: msg.content ?? '',
      tools: (msg.toolCalls ?? []).map(t => ({
        name: t.name,
        status: t.status,
        input: t.input,
        result: t.result,
      })),
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
      setLabel('copied');
      setTimeout(() => setLabel('idle'), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy this message's tools log"
      style={{
        marginTop: 4,
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 5,
        border: `1px solid ${label === 'copied' ? '#34d399' : '#1e293b'}`,
        background: label === 'copied' ? 'rgba(52,211,153,0.1)' : 'transparent',
        color: label === 'copied' ? '#34d399' : '#334155',
        fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
        transition: 'all 0.2s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#334155'; }}
      onMouseLeave={e => { if (label !== 'copied') { (e.currentTarget as HTMLButtonElement).style.color = '#334155'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#1e293b'; } }}
    >
      {label === 'copied' ? '✓ Copied' : '⎘ Copy log'}
    </button>
  );
}

function MessageBubble({
  msg, onEdit, isEditing,
}: {
  msg: AiChatMessage;
  onEdit?: (text: string) => void;
  isEditing?: boolean;
}) {
  const isUser = msg.role === 'user';
  const store = useBuilderStore();
  const isThisStreaming = msg.streaming === true;
  const renderedContent = msg.content;

  // ── Typewriter effect — reveals characters progressively while streaming ──
  const [displayedLen, setDisplayedLen] = useState(() => isThisStreaming ? 0 : renderedContent.length);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isThisStreaming) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      setDisplayedLen(renderedContent.length);
      return;
    }
    const target = renderedContent.length;
    const step = () => {
      setDisplayedLen(prev => {
        const next = Math.min(prev + 18, target); // ~18 chars per frame ≈ fast but visible
        if (next < target) rafRef.current = requestAnimationFrame(step);
        return next;
      });
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  }, [renderedContent, isThisStreaming]);

  const visibleContent = isThisStreaming ? renderedContent.slice(0, displayedLen) : renderedContent;

  const nodeNames = (msg.selectedNodeIds ?? []).map(id => {
    const findName = (nodes: typeof store.pageNodes, tid: string): string | null => {
      for (const n of nodes) {
        if ((n as { id?: string }).id === tid)
          return (n as { name?: string; type?: string }).name ?? (n as { type?: string }).type ?? id;
        if (Array.isArray((n as { children?: unknown[] }).children)) {
          const found = findName((n as { children: typeof store.pageNodes }).children, tid);
          if (found) return found;
        }
      }
      return null;
    };
    return findName(store.pageNodes, id) ?? id.slice(0, 8);
  });

  const timeLabel = msg.createdAt
    ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div
      data-testid={isUser ? 'ai-user-message' : 'ai-assistant-message'}
      className="ai-msg-row"
      style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 3 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: '92%', width: isUser ? 'auto' : '100%', minWidth: 0 }}>
        {/* AI avatar */}
        {!isUser && (
          <div style={{
            width: 24, height: 24, borderRadius: 6, flexShrink: 0, marginTop: 1,
            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
          }}>✦</div>
        )}

        {/* Bubble */}
        <div style={{
          flex: isUser ? 'none' : 1,
          minWidth: 0,
          maxWidth: '100%',
          padding: '9px 13px',
          paddingRight: isUser && !isEditing ? 36 : 13,
          paddingBottom: timeLabel ? 20 : 9,
          borderRadius: isUser ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
          background: isEditing ? '#160e28' : isUser ? '#2d2278' : '#1e293b',
          border: `1px solid ${isEditing ? '#5b21b6' : isUser ? '#4338ca' : '#334155'}`,
          color: isEditing ? '#c4b5fd' : '#f1f5f9',
          fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word',
          overflowWrap: 'anywhere', position: 'relative',
        }}>
          {/* Node chips inside bubble */}
          {isUser && nodeNames.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
              {nodeNames.map((name, i) => (
                <span key={i} onClick={() => store.select(msg.selectedNodeIds?.[i] ?? null)}
                  style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 4, cursor: 'pointer',
                    background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
                    border: '1px solid rgba(99,102,241,0.3)',
                  }}>◈ {name}</span>
              ))}
            </div>
          )}

          {/* Editing badge */}
          {isEditing && (
            <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>⤺</span><span style={{ fontWeight: 500 }}>Editing this message…</span>
            </div>
          )}

          {/* Extended thinking block (Sonnet) — shown only for AI messages */}
          {!isUser && msg.thinkingContent && (
            <ThinkingBlock content={msg.thinkingContent} streaming={isThisStreaming && !renderedContent} />
          )}

          {isUser ? (
            <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', display: 'block' }}>{msg.content}</span>
          ) : isThisStreaming && !visibleContent && !msg.thinkingContent ? (
            /* No text yet — tools running or between rounds */
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {msg.isThinking ? 'Planning next steps…' : 'Thinking…'}
              </span>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: '#7c3aed', animation: `bounce 1.2s infinite ${i * 0.2}s` }} />
              ))}
            </div>
          ) : isThisStreaming ? (
            /* Streaming: typewriter plain-text + inline circle cursor at the exact end */
            <span style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, fontSize: 13 }}>
              {visibleContent}<StreamCursor />
            </span>
          ) : (
            /* Done: render full markdown with a fade-in transition */
            <div className="ai-md-done">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{renderedContent}</ReactMarkdown>
            </div>
          )}

          {/* Image / icon search result chips */}
          {!isUser && msg.imageResults && msg.imageResults.length > 0 && (
            <ImageResultChips images={msg.imageResults} />
          )}
          {!isUser && msg.iconResults && msg.iconResults.length > 0 && (
            <IconResultChips icons={msg.iconResults} />
          )}

          {/* Timestamp — inside bubble, bottom corner */}
          {timeLabel && (
            <div style={{
              position: 'absolute', bottom: 5, right: isUser ? 10 : 8,
              fontSize: 9, color: isUser ? 'rgba(167,139,250,0.5)' : '#334155',
              pointerEvents: 'none', userSelect: 'none',
            }}>{timeLabel}</div>
          )}

          {/* Edit pencil — absolute, CSS hover */}
          {isUser && !isEditing && onEdit && (
            <button className="ai-edit-btn" title="Edit & rewind" onClick={() => onEdit(msg.content)}
              style={{
                position: 'absolute', top: 6, right: 8,
                background: 'none', border: 'none', color: '#818cf8',
                cursor: 'pointer', padding: '2px 4px', fontSize: 13, borderRadius: 4,
                opacity: 0, transition: 'opacity 0.15s',
              }}>✎</button>
          )}
        </div>
      </div>

      {/* Tool calls + per-message copy — below the message bubble */}
      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
        <div style={{ width: '100%', paddingLeft: 32 }}>
          <ToolCallsGroup tools={msg.toolCalls} streaming={isThisStreaming} isThinking={msg.isThinking} />
          {!isThisStreaming && (
            <CopyMsgLogBtn msg={msg} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelSelector — small pill dropdown in the chat header
// ---------------------------------------------------------------------------

function ModelSelector({ value, onChange }: { value: BuilderModelId; onChange: (id: BuilderModelId) => void }) {
  const [open, setOpen] = useState(false);
  const current = BUILDER_MODELS.find(m => m.id === value) ?? BUILDER_MODELS[0];

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title={`Model: ${current.label} — ${current.description}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 8px', borderRadius: 6,
          border: `1px solid ${current.supportsThinking ? '#5b21b6' : '#334155'}`,
          background: current.supportsThinking ? 'rgba(91,33,182,0.18)' : '#1e293b',
          color: current.supportsThinking ? '#c4b5fd' : '#94a3b8',
          fontSize: 10, fontWeight: 500, cursor: 'pointer',
          fontFamily: 'inherit', transition: 'all 0.15s',
        }}
      >
        {current.supportsThinking && (
          <span style={{ fontSize: 9, opacity: 0.8 }}>✦</span>
        )}
        {current.label}
        <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'fixed', zIndex: 1001,
            top: 44, right: 48,
            background: '#0a0f1e', border: '1px solid #1e293b',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            minWidth: 180,
          }}
          onClick={e => e.stopPropagation()}
        >
          {BUILDER_MODELS.map(m => (
            <button key={m.id}
              onClick={() => { onChange(m.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '9px 12px',
                border: 'none', borderBottom: '1px solid #0a1220',
                background: m.id === value ? '#1a2744' : 'transparent',
                color: '#e2e8f0', fontSize: 11, cursor: 'pointer',
                textAlign: 'left', fontFamily: 'inherit', transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (m.id !== value) (e.currentTarget as HTMLButtonElement).style.background = '#121e30'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = m.id === value ? '#1a2744' : 'transparent'; }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {m.supportsThinking && <span style={{ fontSize: 9, color: '#c4b5fd' }}>✦</span>}
                  <span style={{ fontWeight: 600 }}>{m.label}</span>
                  {m.id === value && <span style={{ fontSize: 8, color: '#a78bfa', marginLeft: 'auto' }}>✓</span>}
                </div>
                <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>{m.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} onClick={() => setOpen(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clock icon SVG
// ---------------------------------------------------------------------------

function ClockIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Thread History dropdown
// ---------------------------------------------------------------------------

function ThreadMenu({
  threads, loadingThreads, hasMoreThreads, loadingMoreThreads,
  deletingThreadId, aiCurrentThreadId,
  onSelect, onDelete, onLoadMore, onClose,
}: {
  threads: import('./_use-ai-chat').ChatThread[];
  loadingThreads: boolean;
  hasMoreThreads: boolean;
  loadingMoreThreads: boolean;
  deletingThreadId: string | null;
  aiCurrentThreadId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onLoadMore: () => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // Tracks the thread count at the time of the last triggered load.
  // A new load only fires when threads.length has grown past this value,
  // which makes it structurally impossible to double-trigger for the same page.
  const lastLoadedOffsetRef = useRef(-1);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || loadingMoreThreads || !hasMoreThreads) return;

    const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distToBottom >= 80) return;

    // Already fired a load for this exact thread count — wait for new data to arrive
    if (lastLoadedOffsetRef.current >= threads.length) return;

    lastLoadedOffsetRef.current = threads.length;
    onLoadMore();
  }, [hasMoreThreads, loadingMoreThreads, threads.length, onLoadMore]);

  return (
    <div
      data-testid="ai-thread-menu"
      style={{
        position: 'fixed', top: 48, right: 8, zIndex: 1000,
        background: '#0a0f1e', border: '1px solid #1e293b',
        borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        minWidth: 260, maxWidth: 300,
        display: 'flex', flexDirection: 'column',
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ClockIcon size={13} color="#64748b" />
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Chat History
          </span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}>×</button>
      </div>

      {/* Thread list — exactly 10 per page, scroll-to-load-more */}
      <div ref={listRef} onScroll={handleScroll}
        style={{ overflowY: 'auto', maxHeight: 340 }}
      >
        {loadingThreads && (
          <div style={{ padding: '14px', color: '#64748b', fontSize: 12, textAlign: 'center' }}>Loading…</div>
        )}
        {!loadingThreads && threads.length === 0 && (
          <div style={{ padding: '20px 14px', color: '#334155', fontSize: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>💬</div>
            No conversations yet
          </div>
        )}
        {threads.map(t => (
          <div key={t.id} data-testid="ai-thread-item"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
              background: t.id === aiCurrentThreadId ? '#1a2744' : 'transparent',
              borderBottom: '1px solid #0a1220', cursor: 'pointer', transition: 'background 0.1s',
            }}
            onClick={() => { onSelect(t.id); onClose(); }}
            onMouseEnter={e => { if (t.id !== aiCurrentThreadId) (e.currentTarget as HTMLDivElement).style.background = '#121e30'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = t.id === aiCurrentThreadId ? '#1a2744' : 'transparent'; }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: t.id === aiCurrentThreadId ? '#c4b5fd' : '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: t.id === aiCurrentThreadId ? 600 : 400 }}>
                {t.title}
              </div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>
                {t.messageCount} msg{t.messageCount !== 1 ? 's' : ''}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onDelete(t.id); }}
              disabled={deletingThreadId === t.id}
              style={{
                background: 'none', border: 'none',
                color: deletingThreadId === t.id ? '#7c3aed' : '#1e293b',
                cursor: deletingThreadId === t.id ? 'wait' : 'pointer',
                fontSize: 15, padding: '2px 5px', borderRadius: 4, flexShrink: 0, transition: 'color 0.15s',
              }}
              title="Delete"
              onMouseEnter={e => { if (deletingThreadId !== t.id) (e.currentTarget as HTMLButtonElement).style.color = '#f87171'; }}
              onMouseLeave={e => { if (deletingThreadId !== t.id) (e.currentTarget as HTMLButtonElement).style.color = '#1e293b'; }}
            >
              {deletingThreadId === t.id ? '…' : '×'}
            </button>
          </div>
        ))}
        {/* Loading more spinner */}
        {loadingMoreThreads && (
          <div style={{ padding: '8px 14px', textAlign: 'center', fontSize: 11, color: '#475569' }}>Loading more…</div>
        )}
        {/* End of list */}
        {!hasMoreThreads && threads.length > 0 && !loadingThreads && (
          <div style={{ padding: '6px 14px', textAlign: 'center', fontSize: 10, color: '#1e293b' }}>— end —</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AiChatPanel() {
  const store = useBuilderStore();
  const {
    threads, loadingThreads, hasMoreThreads, loadingMoreThreads, loadMoreThreads,
    deletingThreadId,
    sendMessage, getSystemPrompt, startNewChat, deleteThread, selectThread, reloadThreads,
    loadMoreMessages, hasMoreMessages, loadingMoreMessages,
  } = useAiChat();

  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [showThreadMenu, setShowThreadMenu] = useState(false);
  const [rewindLabel, setRewindLabel] = useState<string | null>(null);
  // ID of the message being edited — truncation happens at send time, NOT on click
  const [editTargetId, setEditTargetId] = useState<string | null>(null);

  const { aiChatHistory, aiGenerating, aiSelectedNodeIds, aiCurrentThreadId, aiSelectedModel, pages, currentPageId } = store;
  const currentPageName = pages.find(p => p.id === currentPageId)?.name ?? 'Home';

  // Text is buffered during streaming and revealed all at once when done —
  // no typewriter needed. MessageBubble reads msg.content directly.

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  const lastLengthRef = useRef(aiChatHistory.length);
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    const newMessages = aiChatHistory.length > lastLengthRef.current;
    lastLengthRef.current = aiChatHistory.length;
    if (isNearBottom || newMessages) el.scrollTop = el.scrollHeight;
  }, [aiChatHistory.length, aiGenerating]);

  // ── Infinite scroll ───────────────────────────────────────────────────────
  const loadingMoreRef = useRef(false);
  const handleMessagesScroll = useCallback(async (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop > 40 || !hasMoreMessages || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    const prevHeight = el.scrollHeight;
    await loadMoreMessages();
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight - prevHeight;
      loadingMoreRef.current = false;
    });
  }, [hasMoreMessages, loadMoreMessages]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || aiGenerating) return;
    // If editing, truncate history to that point NOW (just before sending)
    if (editTargetId) {
      store.truncateAiChatAt(editTargetId);
      setEditTargetId(null);
    }
    setInputValue('');
    setRewindLabel(null);
    await sendMessage(text, aiSelectedNodeIds);
    store.setAiSelectedNodeIds([]);
  }, [inputValue, aiGenerating, aiSelectedNodeIds, sendMessage, store, editTargetId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  }, [handleSend]);

  const handleRemoveNode = useCallback((id: string) => {
    store.setAiSelectedNodeIds(aiSelectedNodeIds.filter(n => n !== id));
  }, [store, aiSelectedNodeIds]);

  // ── Edit message ──────────────────────────────────────────────────────────
  const handleEditMessage = useCallback((msg: AiChatMessage) => {
    if (aiGenerating) return;
    // Only prepare — do NOT touch the store yet. Truncation happens when user sends.
    setEditTargetId(msg.id);
    setInputValue(msg.content);
    setRewindLabel(msg.content.slice(0, 40) + (msg.content.length > 40 ? '…' : ''));
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [aiGenerating]);

  const handleCancelEdit = useCallback(() => {
    setEditTargetId(null);
    setRewindLabel(null);
    setInputValue('');
  }, []);

  // ── Node name resolver ────────────────────────────────────────────────────
  const getNodeName = useCallback((id: string): string => {
    const search = (nodes: typeof store.pageNodes, tid: string): string | null => {
      for (const n of nodes) {
        if ((n as { id?: string }).id === tid)
          return (n as { name?: string; type?: string }).name ?? (n as { type?: string }).type ?? tid.slice(0, 8);
        if (Array.isArray((n as { children?: unknown[] }).children)) {
          const found = search((n as { children: typeof store.pageNodes }).children, tid);
          if (found) return found;
        }
      }
      return null;
    };
    return search(store.pageNodes, id) ?? id.slice(0, 8);
  }, [store.pageNodes]);

  const currentTitle = threads.find(t => t.id === aiCurrentThreadId)?.title;

  // ── Copy tools log ─────────────────────────────────────────────────────────
  const [copyToolsLabel, setCopyToolsLabel] = useState<'copy' | 'copied' | 'none'>('none');

  useEffect(() => {
    const hasCalls = aiChatHistory.some(m => m.toolCalls && m.toolCalls.length > 0);
    setCopyToolsLabel(hasCalls ? 'copy' : 'none');
  }, [aiChatHistory]);

  const handleCopyToolsLog = useCallback(() => {
    const log = aiChatHistory.map(m => ({
      role: m.role,
      content: m.content ?? '',
      ...(m.toolCalls && m.toolCalls.length > 0
        ? {
            tools: m.toolCalls.map(t => ({
              name: t.name,
              status: t.status,
              input: t.input,
              result: t.result,
            })),
          }
        : {}),
    }));
    const text = JSON.stringify(log, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setCopyToolsLabel('copied');
      setTimeout(() => setCopyToolsLabel('copy'), 2000);
    });
  }, [aiChatHistory]);

  // ── Copy system prompt ──────────────────────────────────────────────────────
  const [copyPromptLabel, setCopyPromptLabel] = useState<'idle' | 'loading' | 'copied'>('idle');

  const handleCopySystemPrompt = useCallback(async () => {
    if (copyPromptLabel === 'loading') return;
    setCopyPromptLabel('loading');
    try {
      const prompt = await getSystemPrompt();
      await navigator.clipboard.writeText(prompt);
      setCopyPromptLabel('copied');
      setTimeout(() => setCopyPromptLabel('idle'), 2000);
    } catch {
      setCopyPromptLabel('idle');
    }
  }, [copyPromptLabel, getSystemPrompt]);

  return (
    <div
      style={{ width: 440, display: 'flex', flexDirection: 'column', background: '#0a0f1e', borderLeft: '1px solid #1e293b', overflow: 'hidden', height: '100%' }}
      data-testid="ai-chat-panel"
      onKeyDown={e => e.stopPropagation()}
      onKeyUp={e => e.stopPropagation()}>

      {/* ── Header ── */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
        data-testid="ai-chat-header">
        {/* Logo */}
        <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✦</div>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>AI Assistant</div>
          <div style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentTitle ?? 'New Conversation'}
          </div>
        </div>

        {/* Model selector */}
        <ModelSelector value={aiSelectedModel} onChange={id => store.setAiSelectedModel(id)} />

        {/* Copy tools log button — only when there are tool calls */}
        {copyToolsLabel !== 'none' && (
          <button
            data-testid="ai-copy-tools-btn"
            onClick={handleCopyToolsLog}
            title="Copy all tool calls from this conversation to clipboard (for debugging)"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 9px', borderRadius: 6,
              border: `1px solid ${copyToolsLabel === 'copied' ? '#34d399' : '#334155'}`,
              background: copyToolsLabel === 'copied' ? 'rgba(52,211,153,0.12)' : '#1e293b',
              color: copyToolsLabel === 'copied' ? '#34d399' : '#64748b',
              fontSize: 11, fontWeight: 500, cursor: 'pointer',
              fontFamily: 'inherit', transition: 'all 0.2s',
            }}
            onMouseEnter={e => { if (copyToolsLabel !== 'copied') { (e.currentTarget as HTMLButtonElement).style.borderColor = '#4f46e5'; (e.currentTarget as HTMLButtonElement).style.color = '#a5b4fc'; } }}
            onMouseLeave={e => { if (copyToolsLabel !== 'copied') { (e.currentTarget as HTMLButtonElement).style.borderColor = '#334155'; (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; } }}
          >
            {copyToolsLabel === 'copied' ? '✓ Copied' : '⎘ Copy Log'}
          </button>
        )}

        {/* Copy system prompt button — always visible */}
        <button
          data-testid="ai-copy-prompt-btn"
          onClick={() => void handleCopySystemPrompt()}
          title="Copy the full system prompt to clipboard"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 9px', borderRadius: 6,
            border: `1px solid ${copyPromptLabel === 'copied' ? '#34d399' : '#334155'}`,
            background: copyPromptLabel === 'copied' ? 'rgba(52,211,153,0.12)' : '#1e293b',
            color: copyPromptLabel === 'copied' ? '#34d399' : copyPromptLabel === 'loading' ? '#7c3aed' : '#64748b',
            fontSize: 11, fontWeight: 500, cursor: copyPromptLabel === 'loading' ? 'wait' : 'pointer',
            fontFamily: 'inherit', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { if (copyPromptLabel === 'idle') { (e.currentTarget as HTMLButtonElement).style.borderColor = '#4f46e5'; (e.currentTarget as HTMLButtonElement).style.color = '#a5b4fc'; } }}
          onMouseLeave={e => { if (copyPromptLabel === 'idle') { (e.currentTarget as HTMLButtonElement).style.borderColor = '#334155'; (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; } }}
        >
          {copyPromptLabel === 'copied' ? '✓ Copied' : copyPromptLabel === 'loading' ? '…' : '⎘ Prompt'}
        </button>

        {/* New Chat button */}
        <button
          data-testid="ai-new-thread-btn"
          onClick={() => { startNewChat(); setRewindLabel(null); setInputValue(''); }}
          title="Start a new conversation"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 6,
            border: '1px solid #334155', background: '#1e293b',
            color: '#a5b4fc', fontSize: 11, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'inherit', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#2d3f5a'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#4f46e5'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1e293b'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#334155'; }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>＋</span> New
        </button>

        {/* History menu button */}
        <div style={{ position: 'relative' }}>
          <button
            data-testid="ai-thread-menu-btn"
            onClick={() => {
              const opening = !showThreadMenu;
              setShowThreadMenu(opening);
              if (opening) void reloadThreads();
            }}
            title="Chat history"
            style={{
              padding: '5px 7px', borderRadius: 6, display: 'flex', alignItems: 'center',
              border: '1px solid #334155', background: showThreadMenu ? '#1e293b' : 'transparent',
              color: '#64748b', cursor: 'pointer', lineHeight: 1,
            }}
          >
            <ClockIcon size={14} color={showThreadMenu ? '#a5b4fc' : '#64748b'} />
          </button>
          {showThreadMenu && (
            <ThreadMenu
              threads={threads}
              loadingThreads={loadingThreads}
              hasMoreThreads={hasMoreThreads}
              loadingMoreThreads={loadingMoreThreads}
              deletingThreadId={deletingThreadId}
              aiCurrentThreadId={aiCurrentThreadId}
              onSelect={id => void selectThread(id)}
              onDelete={id => void deleteThread(id)}
              onLoadMore={() => void loadMoreThreads()}
              onClose={() => setShowThreadMenu(false)}
            />
          )}
        </div>

        {/* Close */}
        <button data-testid="ai-close-btn" onClick={store.toggleAiMode}
          style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 18, padding: '2px 4px', lineHeight: 1 }}
          title="Close AI panel">×</button>
      </div>

      {/* ── Messages ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}
        ref={messagesRef} data-testid="ai-message-list" onScroll={handleMessagesScroll}>

        {loadingMoreMessages && (
          <div style={{ textAlign: 'center', padding: '4px', fontSize: 11, color: '#475569' }}>Loading older messages…</div>
        )}
        {!hasMoreMessages && aiChatHistory.length > 0 && (
          <div style={{ textAlign: 'center', padding: '4px', fontSize: 10, color: '#1e293b' }}>— beginning of conversation —</div>
        )}

        {/* Empty state */}
        {aiChatHistory.length === 0 && !aiGenerating && (
          <div style={{ padding: '20px 8px', color: '#475569' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8, filter: 'drop-shadow(0 0 12px #7c3aed88)' }}>✦</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#c4b5fd', marginBottom: 4 }}>What can I build for you?</div>
              <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6 }}>Describe a page, section, or change — I'll do the rest.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { icon: '🎨', text: 'Make the hero more vibrant' },
                { icon: '💰', text: 'Add a pricing section' },
                { icon: '📬', text: 'Build a contact form' },
                { icon: '🔐', text: 'Create a login page' },
                { icon: '🛒', text: 'Design a product card' },
                { icon: '✨', text: 'Add animations to buttons' },
              ].map(({ icon, text }) => (
                <button key={text} data-testid="ai-prompt-suggestion" data-prompt={text}
                  onClick={() => setInputValue(text)}
                  style={{
                    padding: '9px 10px', borderRadius: 10, border: '1px solid #1e293b',
                    background: '#0d1526', color: '#94a3b8', fontSize: 11, cursor: 'pointer',
                    textAlign: 'left', fontFamily: 'inherit', display: 'flex',
                    alignItems: 'center', gap: 6, lineHeight: 1.4, transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#111d35'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#2d3f5a'; (e.currentTarget as HTMLButtonElement).style.color = '#c4b5fd'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#0d1526'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#1e293b'; (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {aiChatHistory.map((msg) => (
          <MessageBubble key={msg.id} msg={msg}
            onEdit={msg.role === 'user' ? () => handleEditMessage(msg) : undefined}
            isEditing={editTargetId === msg.id}
          />
        ))}
      </div>

      {/* ── AI-style input area ── */}
      <div style={{ padding: '10px 12px 12px', borderTop: '1px solid #1e293b', flexShrink: 0 }}>
        {/* Gradient-border wrapper — @property animated conic-gradient */}
        <div className="ai-border-wrap">
          {/* Rotating gradient that fills the wrapper (shows as 1.5px border via padding) */}
          <div className="ai-gradient-ring" />

          {/* Inner content card */}
          <div
            style={{
              position: 'relative', zIndex: 1,
              borderRadius: 14.5, background: '#111827', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              boxShadow: inputFocused ? '0 2px 16px rgba(124,58,237,0.15)' : 'none',
              transition: 'box-shadow 0.3s',
            }}
          >
          {/* Rewind banner — inside the input container */}
          {rewindLabel && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px 0',
            }}>
              <span style={{ fontSize: 11, color: '#7c3aed', flexShrink: 0 }}>⤺</span>
              <span style={{ fontSize: 11, color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Editing: <em style={{ color: '#a78bfa' }}>{rewindLabel}</em>
              </span>
              <button onClick={handleCancelEdit}
                style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 15, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                title="Cancel edit">×</button>
            </div>
          )}

          {/* Active page indicator — always visible, non-removable */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 12px 0', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#475569' }}>Page:</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 10, padding: '2px 7px', borderRadius: 20,
              background: 'rgba(16,185,129,0.15)', color: '#6ee7b7',
              border: '1px solid rgba(16,185,129,0.3)',
            }}>
              ⬡ {currentPageName}
            </span>
          </div>

          {/* Node chips — inside container */}
          {aiSelectedNodeIds.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 12px 0', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#475569' }}>Referencing:</span>
              {aiSelectedNodeIds.map(id => (
                <span key={id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontSize: 10, padding: '2px 7px', borderRadius: 20,
                  background: 'rgba(79,70,229,0.18)', color: '#a5b4fc',
                  border: '1px solid rgba(79,70,229,0.3)',
                }}>
                  ◈ {getNodeName(id)}
                  <button onClick={() => handleRemoveNode(id)}
                    style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1, marginLeft: 2 }}>×</button>
                </span>
              ))}
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            data-testid="ai-chat-input"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Ask AI anything about your design…"
            disabled={aiGenerating}
            style={{
              width: '100%', minHeight: 68, maxHeight: 160,
              padding: '12px 14px 8px',
              background: 'transparent', border: 'none', outline: 'none',
              color: '#f1f5f9', fontSize: 13.5, resize: 'none',
              fontFamily: 'inherit', lineHeight: 1.55, boxSizing: 'border-box',
              caretColor: '#7c3aed',
            }}
          />

          {/* Bottom bar: hint + send button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px 10px' }}>
            <span style={{ fontSize: 10, color: '#1e293b' }}>
              Enter to send · Shift+Enter for new line
            </span>
            <button
              data-testid="ai-send-btn"
              onClick={() => void handleSend()}
              disabled={!inputValue.trim() || aiGenerating}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                border: 'none', cursor: inputValue.trim() && !aiGenerating ? 'pointer' : 'not-allowed',
                background: inputValue.trim() && !aiGenerating
                  ? 'linear-gradient(135deg, #7c3aed, #4f46e5)'
                  : '#1e293b',
                color: inputValue.trim() && !aiGenerating ? '#fff' : '#334155',
                fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s', flexShrink: 0,
                boxShadow: inputValue.trim() && !aiGenerating ? '0 2px 12px rgba(124,58,237,0.4)' : 'none',
              }}
              title="Send message"
            >
              {aiGenerating ? <span style={{ fontSize: 12 }}>…</span> : '↑'}
            </button>
          </div>
          </div>{/* end inner card */}
        </div>{/* end gradient wrapper */}
      </div>

      {/* Close thread menu on outside click */}
      {showThreadMenu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowThreadMenu(false)} />
      )}

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes spin-step {
          to { transform: rotate(360deg); }
        }
        /* ── Streaming cursor circle ── */
        @keyframes aiCursorPulse {
          0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 8px rgba(124,58,237,0.7); }
          50% { opacity: 0.4; transform: scale(0.7); box-shadow: 0 0 2px rgba(124,58,237,0.3); }
        }
        /* ── Markdown fade-in when streaming ends ── */
        .ai-md-done {
          animation: mdFadeIn 0.25s ease-out both;
        }
        @keyframes mdFadeIn {
          from { opacity: 0.4; }
          to   { opacity: 1; }
        }
        /* ── Tool row animations ── */
        @keyframes toolSlideIn {
          from { opacity: 0; transform: translateX(-10px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes toolDotPop {
          0%   { transform: scale(0.4); opacity: 0.5; }
          60%  { transform: scale(1.5); opacity: 1; }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes toolDotSpin {
          0%   { transform: rotate(0deg) scale(1); opacity: 0.5; }
          50%  { transform: rotate(180deg) scale(1.3); opacity: 1; }
          100% { transform: rotate(360deg) scale(1); opacity: 0.5; }
        }
        @keyframes toolLabelShimmer {
          0%, 100% { opacity: 0.35; }
          50%       { opacity: 0.75; }
        }
        /* ── Rainbow border — @property rotates the conic-gradient angle ── */
        @property --border-angle {
          syntax: '<angle>';
          inherits: false;
          initial-value: 0deg;
        }
        @keyframes rainbow-border {
          to { --border-angle: 360deg; }
        }
        .ai-border-wrap {
          position: relative;
          border-radius: 16px;
          padding: 1.5px;
          overflow: hidden;
        }
        .ai-gradient-ring {
          position: absolute;
          inset: 0;
          border-radius: 16px;
          background: conic-gradient(
            from var(--border-angle),
            #ff6b6b, #ffa726, #ffee58,
            #66bb6a, #26c6da, #5c6bc0,
            #ab47bc, #ef5350, #ff6b6b
          );
          animation: rainbow-border 3s linear infinite;
          z-index: 0;
        }
        .ai-msg-row:hover .ai-edit-btn { opacity: 1 !important; }
        .ai-edit-btn:hover { background: rgba(99,102,241,0.15) !important; }
        [data-testid="ai-message-list"]::-webkit-scrollbar { width: 3px; }
        [data-testid="ai-message-list"]::-webkit-scrollbar-track { background: transparent; }
        [data-testid="ai-message-list"]::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
        [data-testid="ai-message-list"]::-webkit-scrollbar-thumb:hover { background: #334155; }
        [data-testid="ai-thread-menu"]::-webkit-scrollbar { width: 3px; }
        [data-testid="ai-thread-menu"] > div::-webkit-scrollbar { width: 3px; }
      `}</style>
    </div>
  );
}
