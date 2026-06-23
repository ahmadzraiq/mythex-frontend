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
import { useSearchParams, usePathname } from 'next/navigation';
import { useBuilderStore } from './_store';
import { applyVirtualFile } from './_virtual-files';
import type { AiChatMessage, AiToolCall, AiImageResult, AiIconResult } from './_store-types';
import { type BuilderModelId } from './_store-types';
import { useJsonAgent } from './_use-json-agent';
import type { ChatThread } from './_use-json-agent';

// ---------------------------------------------------------------------------
// AnimatedDots
// ---------------------------------------------------------------------------

function AnimatedDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', marginLeft: 4 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 3, height: 3, borderRadius: '50%', background: 'var(--bld-ai-accent)',
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
      background: 'var(--bld-ai-accent)',
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
        background: isGenerating ? 'var(--bld-ai-accent)' : 'var(--bld-bg-elevated)',
        animation: isGenerating ? 'toolDotSpin 1.4s linear infinite' : 'none',
      }
    : isError
    ? { background: 'var(--bld-error)' }
    : { background: 'var(--bld-success)', animation: 'toolDotPop 0.35s cubic-bezier(0.34,1.56,0.64,1)' };

  const labelAnim = (isPending || isGenerating) ? 'toolLabelShimmer 1.8s ease-in-out infinite' : 'none';
  const labelColor = (isGenerating || isPending) ? 'var(--bld-text-disabled)' : isError ? 'var(--bld-error)' : 'var(--bld-text-3)';

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
        <span style={{ color: 'var(--bld-text-disabled)', fontSize: 10, flexShrink: 0, minWidth: 18, textAlign: 'right' }}>
          {stepNumber}
        </span>
        {/* Label — shimmer while pending/generating */}
        <span style={{
          color: labelColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          animation: labelAnim,
        }}>
          {label}
        </span>
        {/* Checkmark + optional duration on done */}
        {isDone && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, animation: 'toolDotPop 0.35s ease-out' }}>
            <span style={{ fontSize: 9, color: 'var(--bld-success)' }}>✓</span>
            {tool.duration != null && (
              <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)' }}>
                {tool.duration < 1000 ? `${tool.duration}ms` : `${(tool.duration / 1000).toFixed(1)}s`}
              </span>
            )}
          </span>
        )}
        {/* AI blind badge — tool failed client-side but AI was told "ok" */}
        {tool.aiBlind && (
          <span
            title="AI unaware — this tool failed on the client but the AI was told it succeeded"
            style={{
              fontSize: 8, color: 'var(--bld-warning)', background: 'rgba(245,158,11,0.15)',
              borderRadius: 3, padding: '1px 4px', flexShrink: 0,
              fontWeight: 600, letterSpacing: 0.3,
            }}
          >
            BLIND
          </span>
        )}
      </button>
      {open && (
        <pre style={{
          margin: '3px 0 3px 30px', padding: '5px 8px', borderRadius: 5,
          borderLeft: '1px solid var(--bld-ai-border)',
          fontSize: 10, color: 'var(--bld-text-disabled)', overflow: 'auto', maxHeight: 100, fontFamily: 'monospace',
        }}>
          {JSON.stringify({ input: tool.input, result: tool.result }, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase grouping helpers
// ---------------------------------------------------------------------------

const PHASE_ORDER: Array<AiToolCall['phase'] | undefined> = ['planning', 'structure', 'binding', 'media', 'styling', 'animation', 'styling:layout', 'styling:colors', 'styling:typo', 'workflows', undefined];
const PHASE_LABELS: Record<string, string> = {
  planning: 'Planning',
  structure: 'Structure',
  binding: 'Binding',
  media: 'Media',
  styling: 'Styling',
  animation: 'Animation',
  'styling:layout': 'Layout',
  'styling:colors': 'Colors',
  'styling:typo': 'Typo + Anim',
  workflows: 'Workflows',
};

/** Convert a dynamic phase tag like "combined:home-navigation-button" to a display label. */
function phaseToLabel(phase: string | undefined): string {
  if (!phase) return 'Assistant';
  if (PHASE_LABELS[phase]) return PHASE_LABELS[phase];
  // combined:<slug> → title-case the slug
  if (phase.startsWith('combined:')) {
    const slug = phase.slice('combined:'.length);
    return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // sc:<slug>, styling:<slug>, workflows:<slug> etc.
  const colon = phase.indexOf(':');
  if (colon !== -1) {
    const family = phase.slice(0, colon);
    const slug = phase.slice(colon + 1).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `${family.charAt(0).toUpperCase() + family.slice(1)}: ${slug}`;
  }
  return phase;
}

function groupToolsByPhase(tools: AiToolCall[]) {
  // 1. Collect static phases in predefined order
  const staticGroups = PHASE_ORDER
    .map(p => ({
      phase: p,
      label: phaseToLabel(p),
      tools: tools.filter(t => t.phase === p),
    }))
    .filter(g => g.tools.length > 0);

  // 2. Collect dynamic phases (e.g. combined:home, sc:button) not in PHASE_ORDER
  const coveredPhases = new Set<string | undefined>(PHASE_ORDER);
  const dynamicPhases: string[] = [];
  for (const t of tools) {
    if (!coveredPhases.has(t.phase) && t.phase !== undefined) {
      coveredPhases.add(t.phase);
      dynamicPhases.push(t.phase);
    }
  }
  const dynamicGroups = dynamicPhases.map(p => ({
    phase: p,
    label: phaseToLabel(p),
    tools: tools.filter(t => t.phase === p),
  }));

  return [...staticGroups, ...dynamicGroups];
}

// ---------------------------------------------------------------------------
// RoundDivider — subtle separator between Anthropic API rounds
// ---------------------------------------------------------------------------

function RoundDivider({ round }: { round: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '3px 0', margin: '2px 0',
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--bld-bg-elevated)' }} />
      <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', whiteSpace: 'nowrap', fontWeight: 500 }}>
        Round {round}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--bld-bg-elevated)' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseGroupSection — one collapsible phase (Structure / Media / Styling / Workflows)
// ---------------------------------------------------------------------------

function PhaseGroupSection({ label, tools, active }: {
  label: string;
  tools: AiToolCall[];
  active: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasError = tools.some(t => t.status === 'error');
  const blindCount = tools.filter(t => t.aiBlind).length;
  const n = tools.length;

  useEffect(() => {
    if (active) {
      const startTs = tools[0]?.timestamp ?? Date.now();
      timerRef.current = setInterval(
        () => setLiveElapsed(Math.floor((Date.now() - startTs) / 1000)),
        500,
      );
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const firstTs = tools[0]?.timestamp;
  const lastTs = tools[tools.length - 1]?.timestamp;
  const doneLabel = (!active && firstTs && lastTs && lastTs > firstTs)
    ? `${((lastTs - firstTs) / 1000).toFixed(1)}s`
    : null;
  const timeDisplay = active ? `${liveElapsed}s` : doneLabel;

  const dotColor = active
    ? 'var(--bld-ai-accent)'
    : hasError ? 'var(--bld-error)' : blindCount > 0 ? 'var(--bld-warning)' : 'var(--bld-success)';
  const dotAnim = active ? 'toolDotSpin 1.4s linear infinite' : 'none';

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setExpanded(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '2px 0', border: 'none', background: 'transparent',
          fontSize: 11, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: dotColor, animation: dotAnim }} />
        <span style={{ color: 'var(--bld-text-3)', fontWeight: 500, flex: 1 }}>
          {label}
        </span>
        {active ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--bld-text-disabled)', fontSize: 10 }}>{liveElapsed}s</span>
            <AnimatedDots />
          </span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--bld-text-disabled)', fontSize: 10 }}>
            {n} step{n !== 1 ? 's' : ''}{doneLabel ? ` · ${doneLabel}` : ''}
            {blindCount > 0 && (
              <span style={{ color: 'var(--bld-warning)', fontSize: 8, fontWeight: 600 }}>{blindCount} blind</span>
            )}
            {expanded ? ' <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle",transform:"rotate(180deg)"}}><polyline points="6 9 12 15 18 9"/></svg>' : ' <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg>'}
          </span>
        )}
      </button>
      {expanded && (
        <div style={{ borderLeft: '1px solid var(--bld-ai-border)', paddingLeft: 8, paddingRight: 14, marginTop: 3, maxHeight: 180, overflowY: 'auto' }}>
          {tools.map((t, i) => {
            const prevRound = i > 0 ? tools[i - 1].round : undefined;
            const showRoundDivider = t.round !== undefined && prevRound !== undefined && t.round !== prevRound;
            return (
              <React.Fragment key={i}>
                {showRoundDivider && <RoundDivider round={t.round!} />}
                <ToolRow tool={t} stepNumber={i + 1} />
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallsGroup — live during streaming, collapsed summary when done
// ---------------------------------------------------------------------------

const LIVE_MAX = 5;

function ToolCallsGroup({ tools, streaming, isThinking, agentDebugInfo }: {
  tools: AiToolCall[];
  streaming: boolean;
  isThinking?: boolean;
  agentDebugInfo?: Record<string, { startedAt?: number; endedAt?: number }>;
}) {
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

  // Prefer server-side agent duration (includes LLM thinking time before first tool call).
  // Client-side totalMs only tracks from when the first tool call appeared in the UI.
  const serverDurationMs = (!streaming && agentDebugInfo)
    ? (() => {
        const durations = Object.values(agentDebugInfo)
          .map(a => (a.endedAt != null && a.startedAt != null) ? a.endedAt - a.startedAt : 0)
          .filter(d => d > 0);
        return durations.length > 0 ? Math.max(...durations) : null;
      })()
    : null;
  const timeLabel = serverDurationMs != null
    ? `${(serverDurationMs / 1000).toFixed(1)}s`
    : totalMs !== null ? `${(totalMs / 1000).toFixed(1)}s` : null;

  // Sum of individual tool durations (only available after tool_result events are received)
  const toolTotalMs = !streaming
    ? tools.reduce<number | null>((acc, t) => {
        if (t.duration == null) return acc;
        return (acc ?? 0) + t.duration;
      }, null)
    : null;

  // Check whether any tool has a phase tag — if so use grouped display
  const hasPhases = tools.some(t => t.phase !== undefined);
  const groups = hasPhases ? groupToolsByPhase(tools) : null;
  // Compute all currently active phases — agents that have started but not yet completed.
  // When parallel agents run, multiple phase groups show spinners simultaneously.
  const activePhases = new Set<string>();
  if (streaming) {
    if (agentDebugInfo) {
      for (const [agent, info] of Object.entries(agentDebugInfo)) {
        if (info.startedAt && !info.endedAt) activePhases.add(agent);
      }
    }
    // Fallback: if agentDebugInfo isn't populated yet, use the last received tool's phase.
    // Guard: only fire when agentDebugInfo is absent/empty — once it has entries, an empty
    // activePhases means all agents are done, not that tracking hasn't started yet.
    if (activePhases.size === 0 && (!agentDebugInfo || Object.keys(agentDebugInfo).length === 0)) {
      const last = tools[tools.length - 1]?.phase;
      if (last) activePhases.add(last);
    }
  }

  // ── Streaming state ──────────────────────────────────────────────────────
  if (streaming) {
    if (groups) {
      // Phase-grouped streaming view
      return (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <AnimatedDots />
            <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>
              {isThinking
                ? <span style={{ color: 'var(--bld-text-3)', fontStyle: 'italic' }}>Planning next steps…</span>
                : <>{n} step{n !== 1 ? 's' : ''}</>
              }
            </span>
          </div>
          <div style={{ borderLeft: '1px solid var(--bld-ai-border)', paddingLeft: 8 }}>
            {groups.map(g => (
              <PhaseGroupSection
                key={g.phase ?? 'other'}
                label={g.label}
                tools={g.tools}
                active={streaming && activePhases.has(g.phase ?? '')}
              />
            ))}
          </div>
        </div>
      );
    }
    // Flat streaming view (no phase tags — edit mode or main loop)
    const live = tools.slice(-LIVE_MAX);
    const hidden = n - live.length;
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <AnimatedDots />
          <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>
            {isThinking
              ? <span style={{ color: 'var(--bld-text-3)', fontStyle: 'italic' }}>Planning next steps…</span>
              : <>{n} step{n !== 1 ? 's' : ''}</>
            }
          </span>
        </div>
        <div ref={listRef}
          style={{ borderLeft: '1px solid var(--bld-ai-border)', paddingLeft: 8, paddingRight: 14, maxHeight: 130, overflowY: 'auto' }}>
          {hidden > 0 && (
            <div style={{ fontSize: 10, color: 'var(--bld-text-3)', marginBottom: 2 }}>+{hidden} earlier</div>
          )}
          {live.map(t => (
            <ToolRow key={tools.indexOf(t)} tool={t} stepNumber={tools.indexOf(t) + 1} />
          ))}
        </div>
      </div>
    );
  }

  // ── Done state ───────────────────────────────────────────────────────────
  const doneDotColor = hasError ? 'var(--bld-error)' : 'var(--bld-success)';
  return (
    <div style={{ marginBottom: 10 }}>
      {/* Summary line: dot · N steps · Xs <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg> */}
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
        <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>
          {n} step{n !== 1 ? 's' : ''}
        </span>
        {timeLabel && (
          <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>· {timeLabel}</span>
        )}
        {toolTotalMs != null && (
          <span
            title="Total time spent in tool execution (excludes LLM thinking time)"
            style={{ fontSize: 11, color: 'var(--bld-text-disabled)', opacity: 0.7 }}
          >
            · {toolTotalMs < 1000 ? `${toolTotalMs}ms` : `${(toolTotalMs / 1000).toFixed(1)}s`} tools
          </span>
        )}
        <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)' }}>{expanded ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:expanded?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:expanded?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}</span>
      </button>

      {/* Expanded: phase-grouped or flat */}
      {expanded && (
        <div style={{
          borderLeft: '1px solid var(--bld-ai-border)', paddingLeft: 8, paddingRight: 14,
          marginTop: 5, maxHeight: 320, overflowY: 'auto',
        }}>
          {groups
            ? groups.map(g => (
                <PhaseGroupSection
                  key={g.phase ?? 'other'}
                  label={g.label}
                  tools={g.tools}
                  active={false}
                />
              ))
            : tools.map((t, i) => {
                const prevRound = i > 0 ? tools[i - 1].round : undefined;
                const showRoundDivider = t.round !== undefined && prevRound !== undefined && t.round !== prevRound;
                return (
                  <React.Fragment key={i}>
                    {showRoundDivider && <RoundDivider round={t.round!} />}
                    <ToolRow tool={t} stepNumber={i + 1} />
                  </React.Fragment>
                );
              })
          }
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BuildStats — collapsible summary of rounds, blind failures, and build plan
// ---------------------------------------------------------------------------

const AGENT_COLORS: Record<string, string> = {
  structure: 'var(--bld-info)',
  binding: 'var(--bld-success)',
  styling: '#f472b6',
  animation: 'var(--bld-ai-accent)',
  'styling:layout': '#e879f9',
  'styling:colors': '#f472b6',
  'styling:typo': '#c084fc',
  workflows: 'var(--bld-warning)',
  media: '#fb923c',
};

function BuildStats({ msg }: { msg: AiChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const tools = msg.toolCalls ?? [];
  const blindCount = tools.filter(t => t.aiBlind).length;
  const errorCount = tools.filter(t => t.status === 'error').length;
  const maxRound = tools.reduce((m, t) => Math.max(m, t.round ?? 0), 0);
  const rounds = msg.roundCount ?? maxRound;
  const plan = msg.buildPlanUnits;
  const agents = msg.agentDebugInfo;
  const agentList = agents
    ? Object.values(agents).filter(a => a.agent !== 'structure')
    : [];

  const hasStats = rounds > 0 || blindCount > 0 || (plan && plan.length > 0) || agentList.length > 0;
  if (!hasStats) return null;

  const toggleAgent = (name: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const totalDuration = agentList.length > 0
    ? Math.max(...agentList.map(a => (a.endedAt ?? a.startedAt) - a.startedAt))
    : 0;
  const earliestStart = agentList.length > 0
    ? Math.min(...agentList.map(a => a.startedAt))
    : 0;
  const totalTurnMs = msg.debug?.stats?.totalDurationMs;

  return (
    <div style={{ marginTop: 4, marginBottom: 6 }}>
      <button
        onClick={() => setExpanded(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: 0, border: 'none', background: 'transparent',
          fontFamily: 'inherit', cursor: 'pointer',
          fontSize: 10, color: 'var(--bld-text-disabled)',
        }}
      >
        <span style={{ color: 'var(--bld-text-disabled)' }}>
          {agentList.length > 0 ? `${agentList.length} agents` : rounds > 0 ? `${rounds} round${rounds !== 1 ? 's' : ''}` : ''}
          {errorCount > 0 ? ` · ${errorCount} error${errorCount !== 1 ? 's' : ''}` : ''}
          {blindCount > 0 ? ` · ${blindCount} blind` : ''}
          {totalDuration > 0 ? ` · ${(totalDuration / 1000).toFixed(1)}s` : ''}
          {totalTurnMs != null ? ` · total ${(totalTurnMs / 1000).toFixed(1)}s` : ''}
        </span>
        <span style={{ fontSize: 9, color: blindCount > 0 ? 'var(--bld-warning)' : 'var(--bld-text-disabled)' }}>
          {expanded ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle",transform:"rotate(180deg)"}}><polyline points="6 9 12 15 18 9"/></svg> Stats' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg> Stats'}
        </span>
      </button>
      {expanded && (
        <div style={{
          marginTop: 4, padding: '6px 8px', borderRadius: 5,
          background: 'var(--bld-bg-base)', border: '1px solid var(--bld-ai-border)',
          fontSize: 10, color: 'var(--bld-text-3)',
        }}>
          {errorCount > 0 && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--bld-text-3)' }}>Errors: </span>
              <span style={{ color: 'var(--bld-error)' }}>{errorCount}</span>
              {blindCount > 0 && (
                <span style={{ color: 'var(--bld-warning)', marginLeft: 6 }}>
                  ({blindCount} blind — AI unaware)
                </span>
              )}
            </div>
          )}
          {msg.phaseLog && msg.phaseLog.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--bld-text-3)' }}>Phases: </span>
              {msg.phaseLog.map((p, i) => (
                <span key={i} style={{ color: 'var(--bld-text-3)' }}>
                  {i > 0 && ' → '}
                  {p.phase}
                </span>
              ))}
            </div>
          )}
          {plan && plan.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: 'var(--bld-text-3)' }}>Build plan: </span>
              {plan.map((u, i) => (
                <div key={i} style={{ paddingLeft: 8, color: 'var(--bld-text-3)' }}>
                  {u.name}
                  {u.sectionCount ? ` (${u.sectionCount} section${u.sectionCount !== 1 ? 's' : ''})` : ''}
                  <span style={{ color: 'var(--bld-text-disabled)' }}> — {u.pageRoute}</span>
                </div>
              ))}
            </div>
          )}
          {/* Per-agent timeline bars */}
          {agentList.length > 0 && totalDuration > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: 'var(--bld-text-3)', marginBottom: 3 }}>Agent Timeline:</div>
              {agentList.map(a => {
                const offsetPct = earliestStart > 0 ? ((a.startedAt - earliestStart) / totalDuration) * 100 : 0;
                const widthPct = a.duration ? (a.duration / totalDuration) * 100 : 5;
                const color = AGENT_COLORS[a.agent] ?? 'var(--bld-text-3)';
                return (
                  <div key={a.agent} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <span style={{ width: 60, textAlign: 'right', color, fontSize: 9, flexShrink: 0 }}>{a.agent}</span>
                    <div style={{ flex: 1, height: 8, background: 'var(--bld-bg-elevated)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                      <div style={{
                        position: 'absolute', left: `${offsetPct}%`, width: `${Math.max(widthPct, 2)}%`,
                        height: '100%', background: color, borderRadius: 3, opacity: 0.8,
                      }} />
                    </div>
                    <span style={{ fontSize: 9, color: 'var(--bld-text-3)', width: 40, flexShrink: 0 }}>
                      {a.duration ? `${(a.duration / 1000).toFixed(1)}s` : '...'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {/* Per-agent details */}
          {agentList.map(a => {
            const isExpanded = expandedAgents.has(a.agent);
            const color = AGENT_COLORS[a.agent] ?? 'var(--bld-text-3)';
            const agentErrors = a.toolCalls.filter(t => t.status === 'error').length;
            return (
              <div key={a.agent} style={{ marginBottom: 4, borderLeft: `2px solid ${color}`, paddingLeft: 6 }}>
                <button
                  onClick={() => toggleAgent(a.agent)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: 0, border: 'none', background: 'transparent',
                    fontFamily: 'inherit', cursor: 'pointer', fontSize: 10,
                    color, width: '100%',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{a.agent}</span>
                  <span style={{ color: 'var(--bld-text-3)', fontSize: 9 }}>
                    {a.rounds != null ? `${a.rounds}r` : ''} · {a.toolCalls.length} tools
                    {a.duration ? ` · ${(a.duration / 1000).toFixed(1)}s` : ''}
                    {agentErrors > 0 ? ` · ${agentErrors} err` : ''}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--bld-text-disabled)' }}>
                    {isExpanded ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:isExpanded?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:isExpanded?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}
                  </span>
                </button>
                {isExpanded && (
                  <div style={{ paddingLeft: 4, paddingTop: 3, fontSize: 9, color: 'var(--bld-text-3)' }}>
                    <div style={{ marginBottom: 3 }}>
                      <span style={{ color: 'var(--bld-text-disabled)' }}>Tools: </span>
                      {a.tools.join(', ')}
                    </div>
                    <details style={{ marginBottom: 3 }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--bld-text-disabled)' }}>
                        System prompt ({a.systemPrompt.length} chars)
                      </summary>
                      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--bld-text-3)', maxHeight: 200, overflow: 'auto', fontSize: 8, marginTop: 2, padding: 4, background: 'var(--bld-bg-base)', borderRadius: 3 }}>
                        {a.systemPrompt}
                      </pre>
                    </details>
                    {a.toolCalls.length > 0 && (
                      <div>
                        <span style={{ color: 'var(--bld-text-disabled)' }}>Tool calls:</span>
                        {a.toolCalls.map((tc, i) => (
                          <div key={i} style={{ paddingLeft: 6, color: tc.status === 'error' ? 'var(--bld-error)' : 'var(--bld-text-3)' }}>
                            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: tc.status === 'error' ? 'var(--bld-error)' : tc.aiBlind ? 'var(--bld-warning)' : 'var(--bld-success)', marginRight: 3, verticalAlign: 'middle' }} />
                            {tc.name}({tc.input.nodeId ? String(tc.input.nodeId).slice(0, 8) + '...' : ''})
                            {tc.aiBlind ? ' BLIND' : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThinkingBlock — collapsible extended-thinking display (debug only; Haiku via STYLING_DEBUG_LOG=1)
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
          color: 'var(--bld-ai-accent)', fontSize: 10, fontWeight: 500,
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
            <span style={{ fontSize: 8, opacity: 0.7 }}>{expanded ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:expanded?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:expanded?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}</span>
          </>
        )}
      </button>

      {(expanded || streaming) && content && (
        <div style={{
          marginTop: 5, padding: '8px 10px',
          borderLeft: '2px solid rgba(124,58,237,0.4)',
          borderRadius: '0 6px 6px 0',
          background: 'rgba(124,58,237,0.05)',
          fontSize: 11, color: 'var(--bld-text-3)', lineHeight: 1.6,
          maxHeight: expanded ? 320 : 120, overflowY: 'auto',
          whiteSpace: 'pre-wrap', fontFamily: 'inherit',
          transition: 'max-height 0.2s',
        }}>
          {content}
          {streaming && (
            <span style={{ display: 'inline-block', marginLeft: 2, animation: 'pulse 1s infinite', color: 'var(--bld-ai-accent)' }}>▌</span>
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
            width: 60, height: 44, border: '1px solid var(--bld-ai-border)', flexShrink: 0,
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
          background: 'var(--bld-accent-subtle)', color: 'var(--bld-accent)',
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
  h1: ({...p}) => <h1 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, marginTop: 8, color: 'var(--bld-text-1)' }} {...p} />,
  h2: ({...p}) => <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, marginTop: 6, color: 'var(--bld-text-1)' }} {...p} />,
  h3: ({...p}) => <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, marginTop: 4, color: 'var(--bld-text-2)' }} {...p} />,
  p:  ({...p}) => <p  style={{ margin: '4px 0', lineHeight: 1.65 }} {...p} />,
  ul: ({...p}) => <ul style={{ paddingLeft: 18, margin: '4px 0' }} {...p} />,
  ol: ({...p}) => <ol style={{ paddingLeft: 18, margin: '4px 0' }} {...p} />,
  li: ({...p}) => <li style={{ marginBottom: 2, lineHeight: 1.5 }} {...p} />,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code: (({ inline, ...p }: { inline?: boolean } & React.HTMLAttributes<HTMLElement>) =>
    inline
      ? <code style={{ background: 'var(--bld-bg-base)', borderRadius: 4, padding: '1px 5px', fontSize: 11, color: '#7dd3fc', fontFamily: 'monospace' }} {...p} />
      : <pre style={{ background: 'var(--bld-ai-bg)', borderRadius: 8, padding: '8px 10px', overflowX: 'auto', fontSize: 11, color: 'var(--bld-text-3)', fontFamily: 'monospace', margin: '6px 0', border: '1px solid var(--bld-ai-border)' }}><code {...p} /></pre>
  ) as React.ComponentType<React.HTMLAttributes<HTMLElement>>,
  a:  ({...p}) => <a  style={{ color: 'var(--bld-ai-accent)', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer" {...p} />,
  strong: ({...p}) => <strong style={{ fontWeight: 700, color: 'var(--bld-text-2)' }} {...p} />,
  em: ({...p}) => <em style={{ fontStyle: 'italic', color: 'var(--bld-text-2)' }} {...p} />,
  blockquote: ({...p}) => <blockquote style={{ borderLeft: '2px solid var(--bld-ai-accent)', paddingLeft: 10, margin: '6px 0', color: 'var(--bld-text-3)', fontStyle: 'italic' }} {...p} />,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--bld-ai-border)', margin: '8px 0' }} />,
  table: ({...p}) => <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, margin: '6px 0' }} {...p} />,
  th: ({...p}) => <th style={{ padding: '4px 8px', background: 'var(--bld-bg-base)', borderBottom: '1px solid var(--bld-border-subtle)', color: 'var(--bld-text-3)', textAlign: 'left', fontWeight: 600 }} {...p} />,
  td: ({...p}) => <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--bld-ai-border)', color: 'var(--bld-text-2)' }} {...p} />,
};

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function CopyMsgLogBtn({ msg }: { msg: AiChatMessage }) {
  const [label, setLabel] = useState<'idle' | 'copied'>('idle');

  const handleCopy = () => {
    const payload = {
      role: msg.role,
      turnId: msg.turnId,
      content: msg.content ?? '',
      tools: (msg.toolCalls ?? []).map(t => ({
        name: t.name,
        status: t.status,
        agent: t.phase,
        round: t.round,
        input: t.input,
        result: t.result,
      })),
      // Phase O — typed debug envelope (planner/structure/agents/stats).
      debug: msg.debug,
      structureContext: msg.structureContext,
      agentDebugInfo: msg.agentDebugInfo,
      buildPlan: msg.buildPlan,
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
        border: `1px solid ${label === 'copied' ? 'var(--bld-success)' : 'var(--bld-bg-elevated)'}`,
        background: label === 'copied' ? 'rgba(52,211,153,0.1)' : 'transparent',
        color: label === 'copied' ? 'var(--bld-success)' : 'var(--bld-text-disabled)',
        fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
        transition: 'all 0.2s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-text-3)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--bld-border-subtle)'; }}
      onMouseLeave={e => { if (label !== 'copied') { (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-text-disabled)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--bld-bg-elevated)'; } }}
    >
      {label === 'copied' ? '✓ Copied' : '⎘ Copy log'}
    </button>
  );
}

// Phase K — Cursor-style @-mention typeahead. Lists pages + currently-selected
// canvas nodes; consumers receive a free-form `label` they paste back into the
// composer (e.g. "@Pricing", "@hero-image").
function MentionTypeahead({
  query, pages, selectedNodeIds, onPick, onClose,
}: {
  query: string;
  pages: Array<{ id: string; name: string; route: string }>;
  selectedNodeIds: string[];
  onPick: (label: string) => void;
  onClose: () => void;
}) {
  const q = query.toLowerCase();
  const pageMatches = pages.filter(p => !q || p.name.toLowerCase().includes(q) || p.route.toLowerCase().includes(q)).slice(0, 6);
  const nodeMatches = selectedNodeIds.filter(id => !q || id.toLowerCase().includes(q)).slice(0, 4);
  const hasAny = pageMatches.length + nodeMatches.length > 0;

  return (
    <div
      data-testid="mention-typeahead"
      style={{
        position: 'absolute', bottom: 'calc(100% + 6px)', left: 12,
        background: 'var(--bld-bg-base)', border: '1px solid var(--bld-ai-border)',
        borderRadius: 6, padding: 4, minWidth: 180,
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        zIndex: 50,
      }}
      onMouseDown={e => e.preventDefault()}
    >
      {!hasAny && (
        <div style={{ padding: 8, color: 'var(--bld-text-disabled)', fontSize: 11 }}>No matches</div>
      )}
      {pageMatches.length > 0 && (
        <>
          <div style={{ padding: '4px 8px', fontSize: 9, color: 'var(--bld-text-disabled)', textTransform: 'none', letterSpacing: 0.5 }}>Pages</div>
          {pageMatches.map(p => (
            <button
              key={p.id}
              onClick={() => onPick(p.name)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '4px 8px', color: 'var(--bld-text-2)', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bld-bg-elevated)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {p.name} <span style={{ color: 'var(--bld-text-disabled)' }}>· {p.route}</span>
            </button>
          ))}
        </>
      )}
      {nodeMatches.length > 0 && (
        <>
          <div style={{ padding: '4px 8px', fontSize: 9, color: 'var(--bld-text-disabled)', textTransform: 'none', letterSpacing: 0.5 }}>Selected nodes</div>
          {nodeMatches.map(id => (
            <button
              key={id}
              onClick={() => onPick(id.slice(0, 8))}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '4px 8px', color: 'var(--bld-text-2)', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bld-bg-elevated)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {id.slice(0, 12)}…
            </button>
          ))}
        </>
      )}
      <button
        onClick={onClose}
        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '4px 8px', color: 'var(--bld-text-3)', fontSize: 10, cursor: 'pointer' }}
      >
        ↵ close
      </button>
    </div>
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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: isUser ? '92%' : '100%', width: isUser ? 'auto' : '100%', minWidth: 0 }}>
        {/* AI avatar — kept only as a small marker since the assistant bubble itself is gone */}
        {!isUser && (
          <div style={{
            width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 2,
            background: 'linear-gradient(135deg, var(--bld-ai-accent), var(--bld-ai-accent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
          }}>✦</div>
        )}

        {/* Bubble — Cursor-style:
         *   • Assistant turns have NO background bubble; the activity feed below is the
         *     real "answer" surface, with the model's prose flowing as plain text.
         *   • User turns keep a subtle pill (rounded, soft slate background, no purple
         *     gradient or thick border) so they're still visually distinct from the AI.
         *   • While editing, we revert to a colored panel so the textarea is obvious.
         */}
        <div style={{
          flex: isUser ? 'none' : 1,
          minWidth: 0,
          maxWidth: '100%',
          padding: isUser ? '8px 13px' : '2px 0 0 0',
          paddingRight: isUser && !isEditing ? 36 : isUser ? 13 : 0,
          paddingBottom: isUser ? (timeLabel ? 20 : 8) : 0,
          borderRadius: isUser ? 14 : 0,
          background: isEditing ? 'rgba(124,58,237,0.12)' : isUser ? 'rgba(124,58,237,0.10)' : 'transparent',
          border: isEditing
            ? '1px solid var(--bld-ai-accent)'
            : isUser
              ? '1px solid rgba(124,58,237,0.22)'
              : 'none',
          color: isEditing ? 'var(--bld-ai-accent)' : 'var(--bld-text-1)',
          fontSize: 13, lineHeight: 1.65, wordBreak: 'break-word',
          overflowWrap: 'anywhere', position: 'relative',
        }}>
          {/* Node chips inside bubble */}
          {isUser && nodeNames.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
              {nodeNames.map((name, i) => (
                <span key={i} onClick={() => store.select(msg.selectedNodeIds?.[i] ?? null)}
                  style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 4, cursor: 'pointer',
                    background: 'var(--bld-accent-subtle)', color: 'var(--bld-accent)',
                    border: '1px solid rgba(99,102,241,0.3)',
                  }}>◈ {name}</span>
              ))}
            </div>
          )}

          {/* Editing badge */}
          {isEditing && (
            <div style={{ fontSize: 10, color: 'var(--bld-ai-accent)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>⤺</span><span style={{ fontWeight: 500 }}>Editing this message…</span>
            </div>
          )}

          {/* Extended thinking block (debug only) — shown only for AI messages */}
          {!isUser && msg.thinkingContent && (
            <ThinkingBlock content={msg.thinkingContent} streaming={isThisStreaming && !renderedContent} />
          )}

          {isUser ? (
            <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', display: 'block' }}>{msg.content}</span>
          ) : isThisStreaming && !visibleContent && !msg.thinkingContent && !msg.debug?.planner ? (
            /* No text yet — tools running or between rounds (hidden once Planner row appears) */
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--bld-text-3)' }}>
                {msg.isThinking ? 'Planning next steps…' : 'Thinking…'}
              </span>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--bld-ai-accent)', animation: `bounce 1.2s infinite ${i * 0.2}s` }} />
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

          {/* Timestamp — bottom corner of the user bubble; suppressed for the assistant
           *  to keep its surface bubble-free in the new Cursor-style layout. */}
          {timeLabel && isUser && (
            <div style={{
              position: 'absolute', bottom: 4, right: 10,
              fontSize: 9, color: 'rgba(167,139,250,0.5)',
              pointerEvents: 'none', userSelect: 'none',
            }}>{timeLabel}</div>
          )}

          {/* Edit pencil — absolute, CSS hover */}
          {isUser && !isEditing && onEdit && (
            <button className="ai-edit-btn" title="Edit & rewind" onClick={() => onEdit(msg.content)}
              style={{
                position: 'absolute', top: 6, right: 8,
                background: 'none', border: 'none', color: 'var(--bld-ai-accent)',
                cursor: 'pointer', padding: '2px 4px', fontSize: 13, borderRadius: 4,
                opacity: 0, transition: 'opacity 0.15s',
              }}>✎</button>
          )}
        </div>
      </div>

      {/* Tool calls + per-message copy — below the message bubble */}
      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
        <div style={{ width: '100%' }}>
          {/* Context Agent status — only shown for EDIT requests where search actually ran */}
          {msg.debug?.context && !msg.debug.context.skippedSearch && (
            <div style={{ paddingBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                  background: msg.debug.context.status === 'running' ? 'var(--bld-ai-accent)' : 'var(--bld-success)',
                }} />
                <span style={{ color: msg.debug.context.status === 'running' ? 'var(--bld-ai-accent)' : 'var(--bld-success)', fontWeight: 500 }}>
                  Context
                </span>
                <span style={{ color: 'var(--bld-text-3)' }}>
                  · {msg.debug.context.status === 'running' ? 'searching…' : (
                    msg.debug.context.resolvedNodeCount != null && msg.debug.context.resolvedNodeCount > 0
                      ? `found ${msg.debug.context.resolvedNodeCount} node${msg.debug.context.resolvedNodeCount !== 1 ? 's' : ''}`
                      : 'searched'
                  )}
                  {msg.debug.context.duration != null && ` · ${(msg.debug.context.duration / 1000).toFixed(1)}s`}
                  {msg.debug.context.toolCalls && msg.debug.context.toolCalls.length > 0 && ` · ${msg.debug.context.toolCalls.length} call${msg.debug.context.toolCalls.length !== 1 ? 's' : ''}`}
                </span>
              </div>
              {msg.debug.context.toolCalls && msg.debug.context.toolCalls.length > 0 && (
                <div style={{ paddingLeft: 13, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {msg.debug.context.toolCalls.map((tc, i) => {
                    const query = tc.name === 'search' ? String((tc.input as Record<string, unknown>).query ?? '') : String((tc.input as Record<string, unknown>).id ?? tc.name);
                    const res = tc.result as { results?: unknown[]; totalMatches?: number; note?: string; error?: string } | null;
                    const isRead = tc.name === 'read';
                    const hits = res?.results?.length ?? res?.totalMatches ?? 0;
                    const note = res?.note;
                    const displayLabel = isRead
                      ? (res && !res.error ? 'found' : 'not found')
                      : (note ? '0 (no match)' : `${hits} hit${hits !== 1 ? 's' : ''}`);
                    const displayColor = isRead
                      ? (res && !res.error ? 'var(--bld-success)' : 'var(--bld-error)')
                      : (note ? 'var(--bld-error)' : hits > 0 ? 'var(--bld-success)' : 'var(--bld-text-3)');
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--bld-text-disabled)' }}>
                        <span style={{ color: 'var(--bld-ai-accent)', fontWeight: 500 }}>{tc.name}</span>
                        <span style={{ color: 'var(--bld-text-disabled)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{query}</span>
                        <span style={{ color: displayColor }}>
                          → {displayLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* Planner status — appears immediately on planner_started, before any tool calls fire */}
          {msg.debug?.planner && (
            <div style={{ paddingBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                  background: msg.debug.planner.status === 'running' ? 'var(--bld-info)' : 'var(--bld-success)',
                }} />
                <span style={{ color: msg.debug.planner.status === 'running' ? 'var(--bld-info)' : 'var(--bld-success)', fontWeight: 500 }}>
                  Planner
                </span>
                <span style={{ color: 'var(--bld-text-3)' }}>
                  · {msg.debug.planner.status === 'running' ? 'thinking…' : 'plan assembled'}
                  {msg.debug.planner.duration != null && ` · ${(msg.debug.planner.duration / 1000).toFixed(1)}s`}
                </span>
              </div>
              {msg.debug.planner.status === 'running' && msg.debug.planner.thinkingLive && (
                <div style={{ paddingLeft: 11, marginTop: 4, fontSize: 10, color: 'var(--bld-text-3)', opacity: 0.65, maxWidth: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {msg.debug.planner.thinkingLive}
                </div>
              )}
            </div>
          )}
          <ToolCallsGroup tools={msg.toolCalls} streaming={isThisStreaming} isThinking={msg.isThinking} agentDebugInfo={msg.agentDebugInfo} />
          {!isThisStreaming && (
            <CopyMsgLogBtn msg={msg} />
          )}
        </div>
      )}
      {/* Planner-only state — when planner is thinking but no tool calls have fired yet */}
      {!isUser && (!msg.toolCalls || msg.toolCalls.length === 0) && (msg.debug?.context || msg.debug?.planner || msg.debug?.structure) && (
        <div style={{ width: '100%' }}>
          {/* Context Agent status — only shown for EDIT requests where search actually ran */}
          {msg.debug?.context && !msg.debug.context.skippedSearch && (
            <div style={{ paddingBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                  background: msg.debug.context.status === 'running' ? 'var(--bld-ai-accent)' : 'var(--bld-success)',
                }} />
                <span style={{ color: msg.debug.context.status === 'running' ? 'var(--bld-ai-accent)' : 'var(--bld-success)', fontWeight: 500 }}>
                  Context
                </span>
                <span style={{ color: 'var(--bld-text-3)' }}>
                  · {msg.debug.context.status === 'running' ? 'searching…' : (
                    msg.debug.context.resolvedNodeCount != null && msg.debug.context.resolvedNodeCount > 0
                      ? `found ${msg.debug.context.resolvedNodeCount} node${msg.debug.context.resolvedNodeCount !== 1 ? 's' : ''}`
                      : 'searched'
                  )}
                  {msg.debug.context.duration != null && ` · ${(msg.debug.context.duration / 1000).toFixed(1)}s`}
                  {msg.debug.context.toolCalls && msg.debug.context.toolCalls.length > 0 && ` · ${msg.debug.context.toolCalls.length} call${msg.debug.context.toolCalls.length !== 1 ? 's' : ''}`}
                </span>
              </div>
              {msg.debug.context.toolCalls && msg.debug.context.toolCalls.length > 0 && (
                <div style={{ paddingLeft: 13, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {msg.debug.context.toolCalls.map((tc, i) => {
                    const query = tc.name === 'search' ? String((tc.input as Record<string, unknown>).query ?? '') : String((tc.input as Record<string, unknown>).id ?? tc.name);
                    const res = tc.result as { results?: unknown[]; totalMatches?: number; note?: string; error?: string } | null;
                    const isRead = tc.name === 'read';
                    const hits = res?.results?.length ?? res?.totalMatches ?? 0;
                    const note = res?.note;
                    const displayLabel = isRead
                      ? (res && !res.error ? 'found' : 'not found')
                      : (note ? '0 (no match)' : `${hits} hit${hits !== 1 ? 's' : ''}`);
                    const displayColor = isRead
                      ? (res && !res.error ? 'var(--bld-success)' : 'var(--bld-error)')
                      : (note ? 'var(--bld-error)' : hits > 0 ? 'var(--bld-success)' : 'var(--bld-text-3)');
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--bld-text-disabled)' }}>
                        <span style={{ color: 'var(--bld-ai-accent)', fontWeight: 500 }}>{tc.name}</span>
                        <span style={{ color: 'var(--bld-text-disabled)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{query}</span>
                        <span style={{ color: displayColor }}>
                          → {displayLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {msg.debug?.planner && (
            <div style={{ paddingBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                  background: msg.debug.planner.status === 'running' ? 'var(--bld-info)' : 'var(--bld-success)',
                }} />
                <span style={{ color: msg.debug.planner.status === 'running' ? 'var(--bld-info)' : 'var(--bld-success)', fontWeight: 500 }}>
                  Planner
                </span>
                <span style={{ color: 'var(--bld-text-3)' }}>
                  · {msg.debug.planner.status === 'running' ? 'thinking…' : 'plan assembled'}
                  {msg.debug.planner.duration != null && ` · ${(msg.debug.planner.duration / 1000).toFixed(1)}s`}
                </span>
              </div>
              {msg.debug.planner.status === 'running' && msg.debug.planner.thinkingLive && (
                <div style={{ paddingLeft: 11, marginTop: 4, fontSize: 10, color: 'var(--bld-text-3)', opacity: 0.65, maxWidth: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {msg.debug.planner.thinkingLive}
                </div>
              )}
            </div>
          )}
          {msg.debug?.structure && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 4, fontSize: 11 }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                background: msg.debug.structure.status === 'running' ? 'var(--bld-info)' : 'var(--bld-success)',
              }} />
              <span style={{ color: msg.debug.structure.status === 'running' ? 'var(--bld-info)' : 'var(--bld-success)', fontWeight: 500 }}>
                Structure
              </span>
              <span style={{ color: 'var(--bld-text-3)' }}>
                · {msg.debug.structure.status === 'running' ? 'building…' : 'done'}
                {msg.debug.structure.status === 'done' && msg.debug.structure.duration != null && ` · ${(msg.debug.structure.duration / 1000).toFixed(1)}s`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

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
// Project ID hook
// ---------------------------------------------------------------------------

function useDslProjectId(): string | null {
  const searchParams = useSearchParams();
  const pathname = usePathname() ?? '';
  const fromSearch = searchParams.get('projectId');
  const fromPath = pathname.startsWith('/builder/') ? (pathname.split('/')[2] ?? null) : null;
  return fromSearch ?? fromPath;
}

// ---------------------------------------------------------------------------
// ThreadMenu dropdown
// ---------------------------------------------------------------------------

function ThreadMenu({
  threads, currentThreadId, loadingThreads, hasMoreThreads, loadingMoreThreads,
  deletingThreadId, onSelect, onDelete, onLoadMore, onClose,
}: {
  threads: ChatThread[];
  currentThreadId: string | null;
  loadingThreads: boolean;
  hasMoreThreads: boolean;
  loadingMoreThreads: boolean;
  deletingThreadId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onLoadMore: () => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const lastLoadedOffsetRef = useRef(-1);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || loadingMoreThreads || !hasMoreThreads) return;
    const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distToBottom >= 80) return;
    if (lastLoadedOffsetRef.current >= threads.length) return;
    lastLoadedOffsetRef.current = threads.length;
    onLoadMore();
  }, [hasMoreThreads, loadingMoreThreads, threads.length, onLoadMore]);

  return (
    <div
      data-testid="ai-thread-menu"
      style={{
        position: 'fixed', top: 48, right: 8, zIndex: 1000,
        background: 'var(--bld-ai-bg)', border: '1px solid var(--bld-ai-border)',
        borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        minWidth: 260, maxWidth: 300,
        display: 'flex', flexDirection: 'column',
      }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bld-ai-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ClockIcon size={13} color="var(--bld-text-disabled)" />
          <span style={{ fontSize: 11, color: 'var(--bld-text-3)', fontWeight: 600 }}>Chat History</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}>×</button>
      </div>

      <div ref={listRef} onScroll={handleScroll} style={{ overflowY: 'auto', maxHeight: 340 }}>
        {loadingThreads && (
          <div style={{ padding: '14px', color: 'var(--bld-text-3)', fontSize: 12, textAlign: 'center' }}>Loading…</div>
        )}
        {!loadingThreads && threads.length === 0 && (
          <div style={{ padding: '20px 14px', color: 'var(--bld-text-disabled)', fontSize: 12, textAlign: 'center' }}>
            No conversations yet
          </div>
        )}
        {threads.map(t => (
          <div key={t.id} data-testid="ai-thread-item"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
              background: t.id === currentThreadId ? 'var(--bld-bg-active)' : 'transparent',
              borderBottom: '1px solid var(--bld-ai-border)', cursor: 'pointer', transition: 'background 0.1s',
            }}
            onClick={() => { onSelect(t.id); onClose(); }}
            onMouseEnter={e => { if (t.id !== currentThreadId) (e.currentTarget as HTMLDivElement).style.background = 'var(--bld-bg-hover)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = t.id === currentThreadId ? 'var(--bld-bg-active)' : 'transparent'; }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: t.id === currentThreadId ? 'var(--bld-ai-accent)' : 'var(--bld-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: t.id === currentThreadId ? 600 : 400 }}>
                {t.title}
              </div>
              <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 2 }}>
                {t.messageCount} msg{t.messageCount !== 1 ? 's' : ''}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onDelete(t.id); }}
              disabled={deletingThreadId === t.id}
              style={{
                background: 'none', border: 'none',
                color: deletingThreadId === t.id ? 'var(--bld-ai-accent)' : 'var(--bld-bg-elevated)',
                cursor: deletingThreadId === t.id ? 'wait' : 'pointer',
                fontSize: 15, padding: '2px 5px', borderRadius: 4, flexShrink: 0, transition: 'color 0.15s',
              }}
              title="Delete"
              onMouseEnter={e => { if (deletingThreadId !== t.id) (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-error)'; }}
              onMouseLeave={e => { if (deletingThreadId !== t.id) (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-bg-elevated)'; }}
            >
              {deletingThreadId === t.id ? '…' : '×'}
            </button>
          </div>
        ))}
        {loadingMoreThreads && (
          <div style={{ padding: '8px 14px', textAlign: 'center', fontSize: 11, color: 'var(--bld-text-disabled)' }}>Loading more…</div>
        )}
        {!hasMoreThreads && threads.length > 0 && !loadingThreads && (
          <div style={{ padding: '6px 14px', textAlign: 'center', fontSize: 10, color: 'var(--bld-text-3)' }}>— end —</div>
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

  // ── DSL chat ──────────────────────────────────────────────────────────────
  const [inputValue, setInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const projectId = useDslProjectId() ?? undefined;
  const {
    messages, isStreaming, sendMessage, stopStreaming, tokenStats,
    threads, currentThreadId, loadingThreads, hasMoreThreads, loadingMoreThreads,
    deletingThreadId, loadMoreThreads, selectThread, deleteThread, startNewChat,
  } = useJsonAgent(projectId);

  // Close history menu when clicking outside
  useEffect(() => {
    if (!historyOpen) return;
    const handler = (e: MouseEvent) => {
      const menu = document.querySelector('[data-testid="ai-thread-menu"]');
      if (menu && !menu.contains(e.target as Node)) setHistoryOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [historyOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;
    setInputValue('');
    void sendMessage(text);
  }, [inputValue, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleNewChat = useCallback(() => {
    startNewChat();
    setInputValue('');
    setHistoryOpen(false);
  }, [startNewChat]);

  const handleSelectThread = useCallback((id: string) => {
    void selectThread(id);
    setInputValue('');
  }, [selectThread]);

  return (
    <>
    <div
      style={{
        width: 440, display: 'flex', flexDirection: 'column',
        backgroundColor: 'var(--bld-ai-bg)',
        backgroundImage: [
          'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(99,102,241,0.11) 0%, transparent 60%)',
          'radial-gradient(ellipse 60% 50% at 10% 100%, rgba(99,102,241,0.07) 0%, transparent 55%)',
          'radial-gradient(circle, rgba(255,255,255,0.028) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: 'auto, auto, 22px 22px',
        borderLeft: '1px solid var(--bld-ai-border)', overflow: 'hidden', height: '100%',
      }}
      data-testid="ai-chat-panel"
      onKeyDown={e => e.stopPropagation()}
      onKeyUp={e => e.stopPropagation()}>

      {/* ── Header ── */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--bld-ai-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
        data-testid="ai-chat-header">
        {/* Logo */}
        <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg, var(--bld-ai-accent), var(--bld-ai-accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✦</div>

        {/* Title + cache hit indicator */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-1)' }}>AI Assistant</div>
          {tokenStats.cacheRead > 0 ? (
            <div style={{ fontSize: 10, color: '#34d399', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={`${tokenStats.cacheRead.toLocaleString()} cached tokens read`}>
              ⚡ {Math.round(tokenStats.cacheRead / 1000)}K cached
            </div>
          ) : (
            <div style={{ fontSize: 10, color: 'var(--bld-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>JSON / SDUI</div>
          )}
        </div>

        {/* History button */}
        <button
          data-testid="ai-history-btn"
          onClick={() => setHistoryOpen(v => !v)}
          title="Chat history"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 30, height: 30, borderRadius: 7,
            border: `1px solid ${historyOpen ? 'var(--bld-ai-accent)' : 'var(--bld-ai-border)'}`,
            background: historyOpen ? 'rgba(99,102,241,0.15)' : 'var(--bld-bg-elevated)',
            color: historyOpen ? 'var(--bld-ai-accent)' : 'var(--bld-text-2)',
            cursor: 'pointer', transition: 'all 0.15s', position: 'relative',
          }}
          onMouseEnter={e => { if (!historyOpen) { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--bld-ai-accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-ai-accent)'; } }}
          onMouseLeave={e => { if (!historyOpen) { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--bld-ai-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-text-2)'; } }}
        >
          <ClockIcon size={13} />
          {threads.length > 0 && (
            <span style={{ position: 'absolute', top: -3, right: -3, fontSize: 8, fontWeight: 700, background: 'var(--bld-ai-accent)', color: '#fff', borderRadius: 10, padding: '1px 3px', lineHeight: 1.2, minWidth: 12, textAlign: 'center' }}>
              {threads.length > 9 ? '9+' : threads.length}
            </span>
          )}
        </button>

        {/* New chat */}
        <button
          data-testid="ai-new-thread-btn"
          onClick={handleNewChat}
          title="New conversation"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 12px', borderRadius: 7,
            border: '1px solid var(--bld-ai-border)', background: 'var(--bld-bg-elevated)',
            color: 'var(--bld-text-2)', fontSize: 11, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'inherit', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--bld-ai-accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-ai-accent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--bld-ai-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-text-2)'; }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 2v12M2 8h12"/></svg>
          New
        </button>

        {/* Close */}
        <button data-testid="ai-close-btn" onClick={store.toggleAiMode}
          style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 18, padding: '2px 4px', lineHeight: 1 }}
          title="Close AI panel">×</button>
      </div>

      {/* ── Thread history dropdown ── */}
      {historyOpen && (
        <ThreadMenu
          threads={threads}
          currentThreadId={currentThreadId}
          loadingThreads={loadingThreads}
          hasMoreThreads={hasMoreThreads}
          loadingMoreThreads={loadingMoreThreads}
          deletingThreadId={deletingThreadId}
          onSelect={handleSelectThread}
          onDelete={id => void deleteThread(id)}
          onLoadMore={loadMoreThreads}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* ── Messages ── */}
      <div ref={messagesRef} style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}
        data-testid="ai-message-list">
        {messages.length === 0 && !isStreaming && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 16px', gap: 10 }}>
            <div style={{ fontSize: 28, color: 'var(--bld-ai-accent)', filter: 'drop-shadow(0 0 14px rgba(124,58,237,0.6))' }}>✦</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--bld-text-1)', textAlign: 'center' }}>What can I build for you?</div>
            <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)', lineHeight: 1.7, textAlign: 'center', maxWidth: 260 }}>
              Describe a page, component, or change and I&apos;ll write the TypeScript/JSX files directly.
            </div>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input — same gradient-border design ── */}
      <div style={{ padding: '10px 12px 12px', borderTop: '1px solid var(--bld-ai-border)', flexShrink: 0 }}>
        <div className="ai-border-wrap">
          <div className="ai-gradient-ring" />
          <div style={{
            position: 'relative', zIndex: 1,
            borderRadius: 14.5, background: 'var(--bld-bg-panel)', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: inputFocused ? '0 2px 16px rgba(124,58,237,0.15)' : 'none',
            transition: 'box-shadow 0.3s',
          }}>
            <textarea
              ref={textareaRef}
              data-testid="ai-chat-input"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              disabled={isStreaming}
              placeholder={isStreaming ? 'Claude is working…' : 'Describe the app or change you want…'}
              style={{
                width: '100%', minHeight: 68, maxHeight: 160,
                padding: '12px 14px 8px',
                background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--bld-text-1)', fontSize: 13.5, resize: 'none',
                fontFamily: 'inherit', lineHeight: 1.55, boxSizing: 'border-box',
                caretColor: 'var(--bld-ai-accent)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px 10px' }}>
              <span style={{ fontSize: 10, color: 'var(--bld-text-3)' }}>
                {isStreaming ? 'Claude is working…' : 'Enter to send · Shift+Enter for new line'}
              </span>
              {isStreaming ? (
                <button
                  data-testid="ai-stop-btn"
                  onClick={stopStreaming}
                  style={{
                    width: 34, height: 34, borderRadius: '50%',
                    border: '2px solid var(--bld-error, #ef4444)',
                    cursor: 'pointer', background: 'transparent',
                    color: 'var(--bld-error, #ef4444)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s', flexShrink: 0,
                  }}
                  title="Stop generation"
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-error, #ef4444)';
                    (e.currentTarget as HTMLButtonElement).style.color = '#fff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--bld-error, #ef4444)';
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <rect x="2" y="2" width="8" height="8" rx="1.5" />
                  </svg>
                </button>
              ) : (
                <button
                  data-testid="ai-send-btn"
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  style={{
                    width: 34, height: 34, borderRadius: '50%',
                    border: 'none', cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                    background: inputValue.trim()
                      ? 'linear-gradient(135deg, var(--bld-ai-accent), var(--bld-ai-accent))'
                      : 'var(--bld-bg-elevated)',
                    color: inputValue.trim() ? '#fff' : 'var(--bld-text-disabled)',
                    fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s', flexShrink: 0,
                    boxShadow: inputValue.trim() ? '0 2px 12px rgba(124,58,237,0.4)' : 'none',
                  }}
                  title="Send message"
                >
                  ↑
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

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
        [data-testid="ai-message-list"]::-webkit-scrollbar-thumb { background: var(--bld-ai-border); border-radius: 2px; }
        [data-testid="ai-message-list"]::-webkit-scrollbar-thumb:hover { background: var(--bld-border-subtle); }
        [data-testid="ai-thread-menu"]::-webkit-scrollbar { width: 3px; }
        [data-testid="ai-thread-menu"] > div::-webkit-scrollbar { width: 3px; }
      `}</style>
    </div>
    </>
  );
}
