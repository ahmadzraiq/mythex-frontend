'use client';

/**
 * Cursor-style activity feed for AI turns. The chat panel renders this feed
 * below the message bubble for every assistant turn that produced tool calls
 * or carries a debug envelope.
 *
 * Renders a vertical activity timeline using the debug envelope:
 *  - Planner status (inline row — thinking… or done)
 *  - Structure step counts
 *  - Per-agent phases (rounds + tool calls + live elapsed / final duration)
 *  - Turn stats
 */

import { memo, useEffect, useState } from 'react';
import type { AiChatMessage, PhaseODebugEnvelope } from './_store-types';

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  fontSize: 11,
  color: 'var(--bld-text-3)',
  fontFamily: 'inherit',
};

const DOT: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 3,
  background: '#475569',
};

function Row({ tone, label, value }: { tone?: 'ok' | 'warn' | 'err' | 'info'; label: string; value?: string }) {
  const color =
    tone === 'ok' ? '#34d399' : tone === 'warn' ? '#fbbf24' : tone === 'err' ? '#f87171' : '#94a3b8';
  return (
    <div style={ROW_STYLE}>
      <span style={{ ...DOT, background: color }} />
      <span style={{ color, fontWeight: 500 }}>{label}</span>
      {value && <span style={{ color: 'var(--bld-text-3)' }}>· {value}</span>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--bld-text-3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{title}</div>
      {children}
    </div>
  );
}


export const AiActivityFeed = memo(function AiActivityFeed({ msg }: { msg: AiChatMessage }) {
  const debug: PhaseODebugEnvelope | undefined = msg.debug;

  // Live ticker — re-renders every second while any agent is still running,
  // so elapsed time stays accurate without needing parent re-renders.
  const [, setTick] = useState(0);
  const anyRunning =
    (debug?.planner?.status === 'running') ||
    !!(debug?.agents && Object.values(debug.agents).some(a => a.status === 'running')) ||
    false;
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  if (!debug) return null;

  const agentKeys = debug.agents ? Object.keys(debug.agents) : [];
  const totalRunning = debug.agents
    ? Object.values(debug.agents).filter(a => a.status === 'running').length
    : 0;

  return (
    <div
      style={{
        marginTop: 8,
        padding: '8px 10px',
        borderLeft: '2px solid #1e293b',
        background: 'rgba(15,23,42,0.4)',
        borderRadius: 4,
      }}
      data-testid="ai-activity-feed"
    >
      {/*
       * The new-arch shadow's structure-step counts every empty resource it would have
       * scaffolded; on the current single-pass pipeline that's always zero (the real
       * structure work is done by the legacy structure agent and surfaces under
       * "Agents · Structure" instead). Render only when there's actually something
       * to show, so the user doesn't see a confusing "Empty resources created" row.
       */}
      {debug.structure && (debug.structure.nodes + debug.structure.variables + debug.structure.formulas + debug.structure.workflows + debug.structure.dataSources) > 0 && (
        <Section title="Structure step">
          <Row
            tone="ok"
            label="Resources scaffolded"
            value={`${debug.structure.nodes} nodes · ${debug.structure.variables} vars · ${debug.structure.formulas} formulas · ${debug.structure.workflows} workflows · ${debug.structure.dataSources} data sources`}
          />
        </Section>
      )}

      {(debug.planner || agentKeys.length > 0) && (() => {
        // Group agents by family — `styling:hero` and `styling:about` collapse under
        // a single "Styling" sub-heading so multi-page builds don't blow up the feed.
        const families = new Map<string, Array<[string, NonNullable<typeof debug.agents>[string]]>>();
        for (const [name, info] of Object.entries(debug.agents ?? {})) {
          const colonIdx = name.indexOf(':');
          const family = colonIdx > 0 ? name.slice(0, colonIdx) : name;
          if (!families.has(family)) families.set(family, []);
          families.get(family)!.push([name, info]);
        }
        // Friendly family display order.
        const FAMILY_ORDER = ['structure', 'data', 'media', 'sharedComponents', 'binding', 'styling', 'animation', 'workflows'];
        const sortedFamilies = [...families.entries()].sort(([a], [b]) => {
          const ai = FAMILY_ORDER.indexOf(a);
          const bi = FAMILY_ORDER.indexOf(b);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
        return (
          <Section title={`Agents${totalRunning > 0 ? ` · ${totalRunning} running` : ''}`}>
            {/* Planner inline row — shown at top of agents section */}
            {debug.planner?.status === 'running' && (() => {
              const live = debug.planner?.thinkingLive;
              return (
                <>
                  <Row tone="info" label="Planner · thinking…" />
                  {live && (
                    <div style={{ paddingLeft: 14, fontSize: 10, color: 'var(--bld-text-3)', opacity: 0.65, maxWidth: 320, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {live}
                    </div>
                  )}
                </>
              );
            })()}
            {debug.planner?.status === 'done' && (
              <Row tone="ok" label="Planner" value="plan assembled" />
            )}

            {sortedFamilies.map(([family, members]) => {
              const totalTools = members.reduce((s, [, i]) => s + (i.toolCallCount ?? 0), 0);
              const maxDuration = Math.max(0, ...members.map(([, i]) => i.duration ?? 0));
              const familyLabel = family.charAt(0).toUpperCase() + family.slice(1);
              const familyRunning = members.some(([, i]) => i.status === 'running');
              const familyTone: 'ok' | 'info' | 'warn' = familyRunning ? 'info' : totalTools > 0 ? 'ok' : 'warn';

              // For running families, show live elapsed from the earliest startedAt
              const earliestStart = familyRunning
                ? Math.min(...members.filter(([, i]) => i.status === 'running' && i.startedAt).map(([, i]) => i.startedAt!))
                : 0;
              const familyDurStr = familyRunning && earliestStart > 0
                ? `${Math.round((Date.now() - earliestStart) / 1000)}s`
                : maxDuration > 0 ? `${(maxDuration / 1000).toFixed(1)}s` : '';

              const showSplit = members.length > 1 || (members[0]?.[1].displayLabel);
              return (
                <div key={family} style={{ marginBottom: 4 }}>
                  <Row
                    tone={familyTone}
                    label={`${familyLabel}${familyRunning ? ' · running…' : ''}`}
                    value={`${totalTools} tool${totalTools === 1 ? '' : 's'}${familyDurStr ? ` · ${familyDurStr}` : ''}${members.length > 1 ? ` · ${members.length} parallel agents` : ''}`}
                  />
                  {showSplit && (
                    <div style={{ paddingLeft: 14 }}>
                      {members.map(([name, info]) => {
                        const label = info.displayLabel ?? name.split(':')[1] ?? name;
                        const tone: 'ok' | 'info' | 'warn' = info.status === 'running' ? 'info' : (info.toolCallCount ?? 0) > 0 ? 'ok' : 'warn';
                        const durStr = info.status === 'running' && info.startedAt
                          ? `${Math.round((Date.now() - info.startedAt) / 1000)}s`
                          : info.duration ? `${(info.duration / 1000).toFixed(1)}s` : '';
                        const tools = info.tools && info.tools.length > 0 ? ` · tools: ${info.tools.join(', ')}` : '';
                        return (
                          <Row
                            key={name}
                            tone={tone}
                            label={label}
                            value={`${info.toolCallCount ?? 0} call${info.toolCallCount === 1 ? '' : 's'}${info.rounds ? ` · ${info.rounds} round${info.rounds === 1 ? '' : 's'}` : ''}${durStr ? ` · ${durStr}` : ''}${tools}`}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        );
      })()}

      {debug.stats && (
        <Section title="Turn stats">
          <Row
            tone="info"
            label="Summary"
            value={`${debug.stats.toolCalls ?? 0} tools · ${debug.stats.ops ?? 0} ops · ${debug.stats.agents ?? 0} agents${typeof debug.stats.totalDurationMs === 'number' ? ` · ${Math.round(debug.stats.totalDurationMs)}ms` : ''}`}
          />
        </Section>
      )}
    </div>
  );
});
