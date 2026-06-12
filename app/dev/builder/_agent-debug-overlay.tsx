'use client';

/**
 * Agent Debug Overlay
 *
 * Full-screen React Flow overlay — click ⬡ Debug in the AI chat header.
 * Each agent is a node; click to inspect full system prompt, user message,
 * and every tool call (input + output).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Panel,
  type Node,
  type Edge,
  type NodeProps,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DebugToolCall {
  name: string;
  status?: string;
  input?: unknown;
  result?: unknown;
  round?: number;
  aiBlind?: boolean;
}

export interface DebugAgentData {
  agent: string;
  displayLabel?: string;
  systemPrompt?: string;
  userMessage?: string;
  tools?: string[];
  rounds?: number;
  toolCallCount?: number;
  duration?: number;
  status?: string;
  toolCalls?: DebugToolCall[];
  /** Planner-specific: structured build manifest */
  manifest?: {
    intent?: string;
    operations?: Array<{
      id: string;
      pageRoute?: string;
      pageName?: string;
      agents?: Record<string, Record<string, unknown>>;
    }>;
    needsClarification?: { question: string; options?: string[] };
  };
  /** Context agent extras */
  extra?: Record<string, unknown>;
}

export interface DebugSnapshot {
  agents?: Record<string, DebugAgentData>;
  timing?: { totalDurationMs?: number };
  stats?: { totalTools?: number; agents?: number; blindFailures?: number };
}

// ── Colours ────────────────────────────────────────────────────────────────────

const FAMILY_COLORS: Record<string, { bg: string; border: string; title: string; sub: string }> = {
  context:          { bg: '#161b22', border: '#8b949e', title: '#c9d1d9', sub: '#8b949e' },
  planner:          { bg: '#1a1f6e', border: '#818cf8', title: '#c7d2fe', sub: '#a5b4fc' },
  structure:        { bg: '#0a3622', border: '#3fb950', title: '#56d364', sub: '#3fb950' },
  styling:          { bg: '#2d1a00', border: '#f97316', title: '#fb923c', sub: '#ea580c' },
  animation:        { bg: '#2a1060', border: '#c084fc', title: '#d8b4fe', sub: '#a855f7' },
  binding:          { bg: '#031d2e', border: '#38bdf8', title: '#7dd3fc', sub: '#0ea5e9' },
  workflows:        { bg: '#2d1a00', border: '#f59e0b', title: '#fcd34d', sub: '#d97706' },
  media:            { bg: '#00201f', border: '#2dd4bf', title: '#5eead4', sub: '#14b8a6' },
  sharedComponents: { bg: '#1a1f6e', border: '#a5b4fc', title: '#c7d2fe', sub: '#818cf8' },
  data:             { bg: '#161b22', border: '#8b949e', title: '#c9d1d9', sub: '#6e7681' },
  default:          { bg: '#161b22', border: '#30363d', title: '#8b949e', sub: '#484f58' },
};

const AGENT_ORDER = [
  'context', 'planner', 'structure', 'data',
  'styling', 'animation', 'binding', 'workflows', 'media', 'sharedComponents',
];

const SEQUENTIAL = new Set(['context', 'planner', 'structure', 'data']);

function familyOf(agent: string) {
  const i = agent.indexOf(':');
  return i > 0 ? agent.slice(0, i) : agent;
}
function colorOf(agent: string) {
  return FAMILY_COLORS[familyOf(agent)] ?? FAMILY_COLORS.default;
}
function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Collapsible text block ─────────────────────────────────────────────────────

function TextBlock({ label, text, charCount }: { label: string; text: string; charCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Header row */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          userSelect: 'none', marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--bld-text-disabled)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
          {label}
        </span>
        <span style={{ fontSize: 10, color: '#334155' }}>
          {charCount ?? text.length} chars
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--bld-text-disabled)' }}>
          {expanded ? '▾ collapse' : '▸ expand'}
        </span>
      </div>

      {/* Collapsed preview */}
      {!expanded && (
        <div
          onClick={() => setExpanded(true)}
          style={{
            background: '#020617', borderRadius: 6, padding: '8px 10px',
            fontSize: 11, lineHeight: 1.7, color: 'var(--bld-text-3)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 90, overflow: 'hidden', cursor: 'pointer',
            fontFamily: 'ui-monospace, monospace',
            borderLeft: '2px solid #1e293b',
            position: 'relative',
          }}
        >
          {text.slice(0, 400)}
          {text.length > 400 && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: 40,
              background: 'linear-gradient(to bottom, transparent, #020617)',
            }} />
          )}
        </div>
      )}

      {/* Expanded — full text in a textarea for easy copy */}
      {expanded && (
        <textarea
          ref={textareaRef}
          readOnly
          defaultValue={text}
          style={{
            width: '100%', boxSizing: 'border-box',
            height: Math.min(Math.max(200, text.split('\n').length * 18), 600),
            background: '#020617', borderRadius: 6,
            border: '1px solid #1e293b', padding: '10px 12px',
            fontSize: 11, lineHeight: 1.7, color: 'var(--bld-text-2)',
            fontFamily: 'ui-monospace, monospace',
            resize: 'vertical', outline: 'none',
            whiteSpace: 'pre', overflowWrap: 'normal',
          }}
          onFocus={() => textareaRef.current?.select()}
        />
      )}
    </div>
  );
}

// ── JSON tree ──────────────────────────────────────────────────────────────────

function JsonTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (value === null || value === undefined) return <span style={{ color: 'var(--bld-text-disabled)' }}>null</span>;
  if (typeof value === 'boolean') return <span style={{ color: '#fb923c' }}>{String(value)}</span>;
  if (typeof value === 'number') return <span style={{ color: '#34d399' }}>{value}</span>;
  if (typeof value === 'string') {
    return (
      <span style={{ color: '#f472b6', wordBreak: 'break-all' }}>
        "{value.length > 500 ? value.slice(0, 500) + '…' : value}"
      </span>
    );
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span style={{ color: 'var(--bld-text-disabled)' }}>[]</span>;
    return (
      <span>
        <button onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 'none', color: 'var(--bld-text-3)', cursor: 'pointer', fontSize: 11, padding: 0 }}>
          {open ? '▾' : '▸'} [{value.length}]
        </button>
        {open && (
          <div style={{ paddingLeft: 16, borderLeft: '1px solid #1e293b', marginTop: 2 }}>
            {value.map((v, i) => (
              <div key={i} style={{ margin: '3px 0' }}>
                <span style={{ color: '#334155', marginRight: 6, fontSize: 10 }}>{i}</span>
                <JsonTree value={v} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (!keys.length) return <span style={{ color: 'var(--bld-text-disabled)' }}>{'{}'}</span>;
    return (
      <span>
        <button onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 'none', color: 'var(--bld-text-3)', cursor: 'pointer', fontSize: 11, padding: 0 }}>
          {open ? '▾' : '▸'} {'{…}'}
        </button>
        {open && (
          <div style={{ paddingLeft: 16, borderLeft: '1px solid #1e293b', marginTop: 2 }}>
            {keys.map(k => (
              <div key={k} style={{ margin: '3px 0' }}>
                <span style={{ color: '#7dd3fc', marginRight: 6 }}>{k}:</span>
                <JsonTree value={(value as Record<string, unknown>)[k]} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }
  return <span style={{ color: 'var(--bld-text-3)' }}>{String(value)}</span>;
}

// ── Tool call row ──────────────────────────────────────────────────────────────

function ToolCallRow({ tc, idx }: { tc: DebugToolCall; idx: number }) {
  const [open, setOpen] = useState(false);
  const statusColor = tc.status === 'success' ? '#34d399' : tc.status === 'error' ? '#f87171' : '#64748b';
  return (
    <div style={{
      background: '#020617', borderRadius: 6, marginBottom: 6,
      border: `1px solid ${open ? '#334155' : '#0f172a'}`,
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 10, color: '#334155', minWidth: 22, textAlign: 'right' }}>#{idx + 1}</span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--bld-text-2)', fontWeight: 600, flex: 1, fontFamily: 'ui-monospace, monospace' }}>
          {tc.name}
        </span>
        {tc.round !== undefined && (
          <span style={{ fontSize: 10, color: '#334155', background: '#0f172a', padding: '1px 5px', borderRadius: 4 }}>
            r{tc.round}
          </span>
        )}
        {tc.aiBlind && (
          <span style={{ fontSize: 9, color: '#f87171', background: '#450a0a', borderRadius: 3, padding: '1px 5px' }}>
            blind
          </span>
        )}
        <span style={{ fontSize: 10, color: '#334155' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 10px 12px', fontSize: 11 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Input
            </div>
            <div style={{ background: '#0f172a', borderRadius: 5, padding: '8px 10px', lineHeight: 1.6 }}>
              <JsonTree value={tc.input} depth={0} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Result
            </div>
            <div style={{ background: '#0f172a', borderRadius: 5, padding: '8px 10px', lineHeight: 1.6 }}>
              <JsonTree value={tc.result} depth={0} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

// ── Manifest view (planner) ────────────────────────────────────────────────────

function ManifestView({ manifest }: { manifest: NonNullable<DebugAgentData['manifest']> }) {
  return (
    <div>
      {/* Intent */}
      {manifest.intent && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
            Intent
          </div>
          <div style={{
            background: '#0f172a', borderRadius: 6, padding: '10px 12px',
            fontSize: 12, color: '#a5b4fc', lineHeight: 1.6, borderLeft: '2px solid #6366f1',
          }}>
            {manifest.intent}
          </div>
        </div>
      )}

      {/* Clarification needed */}
      {manifest.needsClarification && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
            Needs Clarification
          </div>
          <div style={{ background: '#0f172a', borderRadius: 6, padding: '10px 12px', borderLeft: '2px solid #f59e0b' }}>
            <div style={{ fontSize: 12, color: '#fcd34d', marginBottom: 8 }}>{manifest.needsClarification.question}</div>
            {(manifest.needsClarification.options ?? []).map((o, i) => (
              <div key={i} style={{ fontSize: 11, color: '#92400e', padding: '2px 0' }}>• {o}</div>
            ))}
          </div>
        </div>
      )}

      {/* Operations */}
      {(manifest.operations ?? []).length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--bld-text-disabled)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
            Operations ({manifest.operations!.length})
          </div>
          {manifest.operations!.map((op, i) => (
            <OperationCard key={op.id ?? i} op={op} idx={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function OperationCard({ op, idx }: {
  op: NonNullable<NonNullable<DebugAgentData['manifest']>['operations']>[number];
  idx: number;
}) {
  const [open, setOpen] = useState(true);
  const agentKeys = Object.keys(op.agents ?? {});

  return (
    <div style={{
      background: '#0f172a', borderRadius: 7, marginBottom: 8,
      border: '1px solid #1e293b', overflow: 'hidden',
    }}>
      {/* Op header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{
          fontSize: 10, fontWeight: 700, color: '#6366f1',
          background: '#1e1b4b', borderRadius: 4, padding: '2px 7px', flexShrink: 0,
        }}>#{idx + 1}</span>
        <span style={{ fontSize: 12, color: 'var(--bld-text-2)', fontWeight: 600, flex: 1 }}>{op.id}</span>
        {op.pageName && (
          <span style={{ fontSize: 10, color: '#334155', background: '#020617', borderRadius: 4, padding: '2px 6px' }}>
            {op.pageName}
          </span>
        )}
        <span style={{ fontSize: 10, color: '#334155' }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && agentKeys.length > 0 && (
        <div style={{ padding: '0 12px 10px', display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {agentKeys.map(agentName => {
            const col = colorOf(agentName);
            return (
              <span key={agentName} style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                color: col.border, background: `${col.border}18`, borderRadius: 4, padding: '2px 7px',
                border: `1px solid ${col.border}33`,
              }}>
                {agentName}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ agent, onClose }: { agent: DebugAgentData; onClose: () => void }) {
  const col = colorOf(agent.agent);
  const family = familyOf(agent.agent);
  const label = agent.displayLabel && agent.displayLabel !== agent.agent
    ? agent.displayLabel
    : capitalize(family);
  const durationStr = typeof agent.duration === 'number' ? `${(agent.duration / 1000).toFixed(1)}s` : '—';
  const toolCount = agent.toolCallCount ?? agent.toolCalls?.length ?? 0;

  const hasManifest = !!agent.manifest;
  const hasPrompts = !!(agent.systemPrompt || agent.userMessage || agent.extra);
  const hasTools = (agent.toolCalls ?? []).length > 0;

  type Tab = 'manifest' | 'prompts' | 'tools';
  const availableTabs: Tab[] = [
    ...(hasManifest ? ['manifest' as Tab] : []),
    ...(hasPrompts ? ['prompts' as Tab] : []),
    'tools' as Tab,
  ];
  const [tab, setTab] = useState<Tab>(availableTabs[0] ?? 'tools');

  const TAB_LABELS: Record<Tab, string> = {
    manifest: 'Manifest',
    prompts: 'Prompts',
    tools: `Calls (${toolCount})`,
  };

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0,
      width: 580, height: '100%',
      background: '#080f1f',
      borderLeft: `2px solid ${col.border}`,
      zIndex: 20,
      display: 'flex', flexDirection: 'column',
      boxShadow: '-8px 0 32px rgba(0,0,0,0.7)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: col.bg,
        borderBottom: `1px solid ${col.border}`,
        display: 'flex', alignItems: 'flex-start', gap: 12, flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: `${col.border}22`, border: `1px solid ${col.border}55`,
            borderRadius: 5, padding: '2px 8px', marginBottom: 5,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: col.border, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              {family}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: col.title, lineHeight: 1.3 }}>
            {label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', marginTop: 3 }}>
            {toolCount} call{toolCount !== 1 ? 's' : ''}
            {agent.rounds ? ` · ${agent.rounds} rounds` : ''}
            {' · '}{durationStr}
            {agent.status === 'skipped' && <span style={{ color: '#fbbf24', marginLeft: 6 }}>skipped</span>}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: '1px solid #1e293b', borderRadius: 6,
          color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 16, padding: '3px 10px',
          lineHeight: 1, flexShrink: 0,
        }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #0f172a', flexShrink: 0 }}>
        {availableTabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '9px 4px', background: 'none', border: 'none',
            borderBottom: `2px solid ${tab === t ? col.border : 'transparent'}`,
            color: tab === t ? col.title : '#475569',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            transition: 'color 0.15s',
          }}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

        {tab === 'manifest' && agent.manifest && (
          <ManifestView manifest={agent.manifest} />
        )}

        {tab === 'prompts' && (
          <>
            {/* Extra info (context agent) */}
            {agent.extra && Object.keys(agent.extra).length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--bld-text-disabled)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                  Context Info
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 10px', fontSize: 11 }}>
                  {Object.entries(agent.extra).map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 4 }}>
                      <span style={{ color: 'var(--bld-text-disabled)', marginRight: 6 }}>{k}:</span>
                      <span style={{ color: 'var(--bld-text-3)' }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Tool badges */}
            {(agent.tools ?? []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                {(agent.tools ?? []).map(t => (
                  <span key={t} style={{
                    fontSize: 10, background: '#0f172a', color: 'var(--bld-text-3)',
                    borderRadius: 4, padding: '2px 7px', border: '1px solid #1e293b',
                    fontFamily: 'ui-monospace, monospace',
                  }}>{t}</span>
                ))}
              </div>
            )}
            {agent.systemPrompt
              ? <TextBlock label="System Prompt" text={agent.systemPrompt} />
              : <div style={{ fontSize: 11, color: '#334155', marginBottom: 10 }}>No system prompt recorded.</div>
            }
            {agent.userMessage
              ? <TextBlock label="User Message" text={agent.userMessage} />
              : <div style={{ fontSize: 11, color: '#334155' }}>No user message recorded.</div>
            }
          </>
        )}

        {tab === 'tools' && (
          <>
            {hasTools ? (
              (agent.toolCalls ?? []).map((tc, i) => <ToolCallRow key={i} tc={tc} idx={i} />)
            ) : (
              <div style={{ fontSize: 11, color: '#334155' }}>No tool calls recorded.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── React Flow node ────────────────────────────────────────────────────────────

function AgentNode({ data }: NodeProps) {
  const d = data as { agent: DebugAgentData; onClick: (a: DebugAgentData) => void };
  const col = colorOf(d.agent.agent);
  const family = familyOf(d.agent.agent);
  const toolCount = d.agent.toolCallCount ?? d.agent.toolCalls?.length ?? 0;
  const durationStr = typeof d.agent.duration === 'number' ? `${(d.agent.duration / 1000).toFixed(1)}s` : '';
  const statusColor = toolCount > 0 ? '#34d399' : d.agent.status === 'running' ? '#60a5fa' : '#475569';

  // Subtitle: short displayLabel if it differs from the agent key, otherwise nothing
  const sub = d.agent.displayLabel && !d.agent.displayLabel.startsWith(family)
    ? d.agent.displayLabel.length > 28 ? d.agent.displayLabel.slice(0, 28) + '…' : d.agent.displayLabel
    : null;

  return (
    <div
      onClick={() => d.onClick(d.agent)}
      style={{
        background: col.bg,
        border: `1.5px solid ${col.border}`,
        borderRadius: 10,
        padding: '10px 14px',
        width: 175,
        cursor: 'pointer',
        boxShadow: `0 0 0 0 ${col.border}`,
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = `0 0 0 3px ${col.border}55`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = `0 0 0 0 ${col.border}`;
      }}
    >
      {/* Status dot + family name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: col.title, letterSpacing: -0.2 }}>
          {capitalize(family)}
        </span>
      </div>

      {/* Short subtitle — only if different from family and short enough */}
      {sub && (
        <div style={{ fontSize: 10, color: col.sub, marginBottom: 4, paddingLeft: 15, lineHeight: 1.4 }}>
          {sub}
        </div>
      )}

      {/* Stats */}
      <div style={{ fontSize: 10, color: '#484f58', paddingLeft: 15 }}>
        {toolCount} tool{toolCount !== 1 ? 's' : ''}
        {d.agent.rounds ? ` · ${d.agent.rounds}r` : ''}
        {durationStr ? ` · ${durationStr}` : ''}
      </div>
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

// ── Graph builder ──────────────────────────────────────────────────────────────
//
// Layout (vertical sequential chain, then horizontal parallel row):
//
//                  [Context]
//                      │
//                  [Planner]
//                      │
//                  [Structure]
//                      │
//    ┌──────┬──────┬───┴────┬──────┬──────┐
// [Style] [Anim] [Bind] [Flows] [Media]
//

function buildGraph(snapshot: DebugSnapshot): { nodes: Node[]; edges: Edge[] } {
  const agents = snapshot.agents ?? {};

  const families = new Map<string, string[]>();
  for (const key of Object.keys(agents)) {
    const fam = familyOf(key);
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(key);
  }

  const sorted = [...families.entries()].sort(([a], [b]) => {
    const ai = AGENT_ORDER.indexOf(a);
    const bi = AGENT_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const seqFamilies = sorted.filter(([f]) => SEQUENTIAL.has(f));
  const parFamilies = sorted.filter(([f]) => !SEQUENTIAL.has(f));

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const NODE_W = 190;
  const NODE_H = 95;
  const SEQ_H_GAP = 60;   // vertical gap between sequential nodes
  const PAR_H_GAP = 30;   // horizontal gap between parallel columns
  const PAR_V_GAP = 16;   // gap between stacked siblings in a column
  const SEQ_X = 300;      // x center for the sequential chain

  // ── Vertical sequential chain ─────────────────────────────────────────────
  let seqY = 40;
  const seqIds: string[] = [];

  for (const [, members] of seqFamilies) {
    for (const key of members) {
      nodes.push({
        id: key, type: 'agent',
        position: { x: SEQ_X, y: seqY },
        data: { agent: { ...agents[key], agent: key }, onClick: () => {} },
      });
      seqIds.push(key);
      seqY += NODE_H + SEQ_H_GAP;
    }
  }

  // ── Horizontal parallel row ───────────────────────────────────────────────
  const parColumns: string[][] = parFamilies.map(([, members]) => members);
  const totalParWidth = parColumns.length * NODE_W + (parColumns.length - 1) * PAR_H_GAP;

  // Center the parallel row under the sequential chain
  const parRowStartX = SEQ_X + NODE_W / 2 - totalParWidth / 2;
  const PAR_TOP_Y = seqY + 20; // just below the last sequential node

  const familyFirstIds: string[] = [];

  let colX = parRowStartX;
  for (const col of parColumns) {
    let rowY = PAR_TOP_Y;
    for (const key of col) {
      nodes.push({
        id: key, type: 'agent',
        position: { x: colX, y: rowY },
        data: { agent: { ...agents[key], agent: key }, onClick: () => {} },
      });
      rowY += NODE_H + PAR_V_GAP;
    }
    familyFirstIds.push(col[0]);
    colX += NODE_W + PAR_H_GAP;
  }

  // ── Edges ─────────────────────────────────────────────────────────────────

  const ARROW = { type: MarkerType.ArrowClosed, width: 14, height: 14 };

  // Sequential vertical chain — bright white so always visible
  for (let i = 1; i < seqIds.length; i++) {
    edges.push({
      id: `seq-${i}`,
      source: seqIds[i - 1],
      target: seqIds[i],
      type: 'smoothstep',
      style: { stroke: 'var(--bld-text-3)', strokeWidth: 2 },
      markerEnd: { ...ARROW, color: 'var(--bld-text-3)' },
    });
  }

  // Last sequential → each parallel column (fan-out) — use family accent colour
  if (seqIds.length > 0) {
    const lastSeq = seqIds[seqIds.length - 1];
    for (const firstId of familyFirstIds) {
      const c = colorOf(firstId);
      edges.push({
        id: `fan-${firstId}`,
        source: lastSeq,
        target: firstId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: c.border, strokeWidth: 2 },
        markerEnd: { ...ARROW, color: c.border },
      });
    }
  }

  // Within each parallel column — chain stacked siblings
  for (const col of parColumns) {
    for (let i = 1; i < col.length; i++) {
      const c = colorOf(col[i]);
      edges.push({
        id: `sib-${col[i]}`,
        source: col[i - 1],
        target: col[i],
        type: 'smoothstep',
        style: { stroke: c.border, strokeWidth: 1.5 },
        markerEnd: { ...ARROW, color: c.border },
      });
    }
  }

  return { nodes, edges };
}

// ── Overlay ────────────────────────────────────────────────────────────────────

interface AgentDebugOverlayProps {
  snapshot: DebugSnapshot;
  onClose: () => void;
}

export function AgentDebugOverlay({ snapshot, onClose }: AgentDebugOverlayProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selected, setSelected] = useState<DebugAgentData | null>(null);

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(snapshot);
    setNodes(n.map(node => ({
      ...node,
      data: {
        ...(node.data as object),
        onClick: (agent: DebugAgentData) => setSelected(agent),
      },
    })));
    setEdges(e);
  }, [snapshot, setNodes, setEdges]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (selected) setSelected(null); else onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, onClose]);

  const agentCount = Object.keys(snapshot.agents ?? {}).length;
  const totalMs = snapshot.timing?.totalDurationMs;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#0d1117',
        display: 'flex', flexDirection: 'column',
      }}
      onKeyDown={e => e.stopPropagation()}
      onKeyUp={e => e.stopPropagation()}
    >
      {/* Override React Flow CSS variables so edge strokes are visible */}
      <style>{`
        .agent-debug-flow {
          --xy-edge-stroke-default: #94a3b8;
          --xy-edge-stroke-width-default: 2;
          --xy-edge-stroke-selected-default: #f0f6fc;
          --xy-attribution-background-color-default: transparent;
          --xy-background-color-default: #0d1117;
          --xy-background-pattern-color-default: #21262d;
          --xy-node-border-radius-default: 10px;
          --xy-node-boxshadow-hover-default: none;
          --xy-node-boxshadow-selected-default: none;
        }
        .agent-debug-flow .react-flow__edge-path,
        .agent-debug-flow .react-flow__edge .react-flow__edge-path,
        .agent-debug-flow .react-flow__connection-path {
          stroke-opacity: 1 !important;
        }
        .agent-debug-flow .react-flow__edges {
          overflow: visible;
        }
        .agent-debug-flow .react-flow__controls {
          background: #161b22 !important;
          border: 1px solid #21262d !important;
          border-radius: 6px !important;
        }
        .agent-debug-flow .react-flow__controls-button {
          background: #161b22 !important;
          border-bottom-color: #21262d !important;
          fill: #8b949e !important;
        }
        .agent-debug-flow .react-flow__controls-button:hover {
          background: #21262d !important;
        }
        .agent-debug-flow .react-flow__node {
          cursor: default !important;
        }
        .agent-debug-flow .react-flow__node.selected > div,
        .agent-debug-flow .react-flow__node.selected {
          box-shadow: none !important;
          outline: none !important;
        }
      `}</style>

      {/* Top bar */}
      <div style={{
        height: 46, background: '#161b22', borderBottom: '1px solid #21262d',
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f6fc', letterSpacing: -0.3 }}>
          ⬡ Agent Debug
        </span>
        <div style={{ width: 1, height: 18, background: '#21262d' }} />
        <span style={{ fontSize: 11, color: '#8b949e' }}>
          {agentCount} agent{agentCount !== 1 ? 's' : ''}
          {totalMs ? ` · ${Math.round(totalMs)}ms total` : ''}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: '#30363d' }}>Click a node to inspect · Esc to close</span>
        <button
          onClick={onClose}
          style={{
            background: '#21262d', border: '1px solid #30363d', borderRadius: 6,
            color: '#8b949e', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            padding: '5px 14px', fontFamily: 'inherit',
          }}
        >
          ✕ Close
        </button>
      </div>

      {/* Canvas + detail — explicit height so React Flow's ResizeObserver gets a real px value */}
      <div style={{ flex: 1, position: 'relative', height: 'calc(100vh - 46px)', minHeight: 0 }} className="agent-debug-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          nodesDraggable={false}
          nodesConnectable={false}
          panOnDrag={true}
          zoomOnScroll={true}
          proOptions={{ hideAttribution: true }}
          style={{ background: '#0d1117', width: '100%', height: '100%' }}
          defaultEdgeOptions={{
            type: 'smoothstep',
            style: { stroke: 'var(--bld-text-3)', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--bld-text-3)', width: 16, height: 16 },
          }}
        >
          <Background color="#21262d" gap={28} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={n => colorOf((n.data as { agent: DebugAgentData }).agent.agent).border}
            maskColor="rgba(13,17,23,0.88)"
            style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 6 }}
          />
          {agentCount === 0 && (
            <Panel position="top-center">
              <div style={{
                background: '#161b22', border: '1px solid #21262d', borderRadius: 8,
                padding: '12px 20px', fontSize: 12, color: '#8b949e',
              }}>
                No agent data — run a build first, then click ⬡ Debug
              </div>
            </Panel>
          )}
        </ReactFlow>

        {selected && (
          <DetailPanel agent={selected} onClose={() => setSelected(null)} />
        )}
      </div>
    </div>
  );
}
