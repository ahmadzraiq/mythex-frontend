'use client';

import type { GenerationState } from './_use-ai-generation';

interface AIGeneratePanelProps {
  appName: string;
  genState: GenerationState;
  onCancel: () => void;
}

export function AIGeneratePanel({ appName, genState, onCancel }: AIGeneratePanelProps) {
  const { totalSections, doneSections, totalNodes, progress, error } = genState;
  const progressPct = totalSections > 0 ? Math.round((doneSections / totalSections) * 100) : 0;

  // Group progress by page
  const pageGroups = progress.reduce<Record<string, typeof progress>>((acc, item) => {
    const key = item.pageId === 'shared' ? '__shared__' : item.pageId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 300,
        background: '#0f1117',
        borderLeft: '1px solid #1f2937',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9500,
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div style={{ padding: '20px 18px 14px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <AISparkIcon />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f9fafb' }}>Building your app</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{appName}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ background: '#1f2937', borderRadius: 4, height: 4, overflow: 'hidden', marginBottom: 8 }}>
          <div
            style={{
              width: `${progressPct}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
              borderRadius: 4,
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {doneSections}/{totalSections} sections
          </span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {totalNodes} nodes
          </span>
        </div>
      </div>

      {/* Section list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
        {error && (
          <div style={{ margin: '8px 14px', padding: '10px 12px', background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, fontSize: 12, color: '#fca5a5' }}>
            {error}
          </div>
        )}

        {Object.entries(pageGroups).map(([key, items]) => {
          const isShared = key === '__shared__';
          const pageName = isShared ? 'Shared (all pages)' : (items[0]?.pageName ?? key);

          return (
            <div key={key} style={{ marginBottom: 4 }}>
              <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {pageName}
              </div>
              {items.map(item => (
                <SectionRow key={`${item.pageId}-${item.sectionName}`} item={item} />
              ))}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid #1f2937', flexShrink: 0 }}>
        <button
          onClick={onCancel}
          style={{
            width: '100%',
            padding: '8px 0',
            borderRadius: 8,
            border: '1px solid #374151',
            background: 'transparent',
            color: '#9ca3af',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Cancel generation
        </button>
        <div style={{ fontSize: 10, color: '#4b5563', textAlign: 'center', marginTop: 8 }}>
          You can edit once generation completes
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section row
// ---------------------------------------------------------------------------

function SectionRow({ item }: { item: { sectionName: string; status: string; nodeCount: number } }) {
  const isGenerating = item.status === 'generating';
  const isDone = item.status === 'done';
  const isError = item.status === 'error';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 14px',
        opacity: item.status === 'pending' ? 0.4 : 1,
      }}
    >
      <div style={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isGenerating && <SpinnerIcon />}
        {isDone && <CheckIcon />}
        {isError && <ErrorIcon />}
        {item.status === 'pending' && <PendingDot />}
      </div>
      <span style={{ fontSize: 12, color: isDone ? '#d1d5db' : isGenerating ? '#f9fafb' : '#6b7280', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.sectionName}
      </span>
      {isDone && item.nodeCount > 0 && (
        <span style={{ fontSize: 10, color: '#4b5563' }}>{item.nodeCount}n</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function AISparkIcon() {
  return (
    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L9.5 9.5L2 12L9.5 14.5L12 22L14.5 14.5L22 12L14.5 9.5L12 2Z" />
      </svg>
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#3b82f6"
      strokeWidth="2.5"
      strokeLinecap="round"
      style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function PendingDot() {
  return <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#374151' }} />;
}
