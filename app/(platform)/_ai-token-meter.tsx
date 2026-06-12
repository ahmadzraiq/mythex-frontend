'use client';

import { useEffect, useState, useCallback } from 'react';
import { workspaces as workspacesApi, type WorkspaceUsage } from '@/lib/platform/api-client';
import PricingModal from './_pricing-modal';

interface Props {
  workspaceId: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  /** Pass a refreshKey that changes after each AI turn to re-fetch usage */
  refreshKey?: number;
  superAdmin?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export default function AiTokenMeter({ workspaceId, plan, refreshKey = 0, superAdmin = false }: Props) {
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [showPricing, setShowPricing] = useState(false);

  const fetchUsage = useCallback(() => {
    workspacesApi.getUsage(workspaceId)
      .then(setUsage)
      .catch(() => {}); // silently fail
  }, [workspaceId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage, refreshKey]);

  if (plan === 'FREE' && !superAdmin) {
    return (
      <>
        <button
          onClick={() => setShowPricing(true)}
          title="AI builder requires Pro plan"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 20,
            border: '1px solid #374151', background: '#1f2937',
            color: '#4b5563', fontSize: 11.5, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 13 }}>🔒</span>
          AI locked
        </button>
        {showPricing && (
          <PricingModal
            workspaceId={workspaceId}
            currentPlan={plan}
            onClose={() => setShowPricing(false)}
            triggerFeature="AI builder"
          />
        )}
      </>
    );
  }

  if (superAdmin && plan === 'FREE') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 20,
        border: '1px solid #6366f133', background: '#1e1b4b',
        color: '#a5b4fc', fontSize: 11.5, fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>
        <span style={{ fontSize: 13 }}>⚡</span>
        Unlimited
      </div>
    );
  }

  if (!usage) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 20,
        border: '1px solid #374151', background: '#1f2937',
        color: '#4b5563', fontSize: 11.5, fontWeight: 600,
      }}>
        <span style={{ fontSize: 13 }}>⚡</span>
        Loading…
      </div>
    );
  }

  const { used, limit, remaining } = usage.usage.aiTokens;
  const pct = limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const isExhausted = remaining <= 0;
  const isLow = pct >= 80;
  const isMid = pct >= 50;

  const color = isExhausted || isLow ? '#ef4444' : isMid ? '#f59e0b' : '#10b981';
  const bg = isExhausted || isLow ? '#1f0707' : isMid ? '#1f1507' : '#071f10';

  return (
    <>
      <button
        onClick={() => (isExhausted || isLow) && setShowPricing(true)}
        title={`AI tokens: ${formatTokens(used)} used of ${formatTokens(limit)}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 20,
          border: `1px solid ${color}33`,
          background: bg,
          color,
          fontSize: 11.5, fontWeight: 600,
          cursor: (isExhausted || isLow) ? 'pointer' : 'default',
          whiteSpace: 'nowrap',
          transition: 'all 200ms',
        }}
      >
        <span style={{ fontSize: 13 }}>⚡</span>
        {isExhausted ? (
          <span>Tokens exhausted — upgrade</span>
        ) : (
          <span>{formatTokens(used)} / {formatTokens(limit)}</span>
        )}
        {/* Mini progress bar */}
        <div style={{ width: 36, height: 3, background: '#374151', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 400ms' }} />
        </div>
      </button>

      {showPricing && (
        <PricingModal
          workspaceId={workspaceId}
          currentPlan={plan}
          onClose={() => setShowPricing(false)}
          triggerFeature={isExhausted ? 'AI tokens exhausted' : undefined}
        />
      )}
    </>
  );
}
