'use client';
/**
 * Data & API tab — top-level section in the builder.
 *
 * Sub-navigation (left sidebar):
 *   Tables            → _tables-designer.tsx
 *   Backend Workflows → _server-workflows-panel.tsx
 *   Storage           → _storage-browser.tsx
 */
import React, { useState } from 'react';
import { TablesDesigner } from './_tables-designer';
import { StorageBrowser } from './_storage-browser';
import { ServerWorkflowsPanel } from './_server-workflows-panel';

export type DataApiSection =
  | 'tables'
  | 'backend-workflows'
  | 'storage';

interface DataApiTabProps {
  projectId: string;
}

const NAV_ITEMS: { id: DataApiSection; label: string; icon: string }[] = [
  { id: 'tables',            label: 'Tables',            icon: '⊞' },
  { id: 'backend-workflows', label: 'Backend Workflows', icon: 'ƒ' },
  { id: 'storage',           label: 'Storage',           icon: '🗄' },
];

const SECTION_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
  flexDirection: 'column',
  background: '#0f172a',
};

const NAV_WIDTH = 160;

export function DataApiTab({ projectId }: DataApiTabProps) {
  const [section, setSection] = useState<DataApiSection>('tables');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>
      {/* ── Left sub-nav ────────────────────────────────────────────────── */}
      <div style={{
        width: NAV_WIDTH,
        background: '#0a0f1a',
        borderRight: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 0',
        flexShrink: 0,
      }}>
        <div style={{ padding: '8px 12px 12px', fontSize: 10, color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Backend
        </div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setSection(item.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px',
              fontSize: 12,
              fontWeight: section === item.id ? 600 : 400,
              color: section === item.id ? '#e2e8f0' : '#94a3b8',
              background: section === item.id ? 'rgba(59,130,246,0.12)' : 'transparent',
              borderLeft: `2px solid ${section === item.id ? '#3b82f6' : 'transparent'}`,
              cursor: 'pointer',
              border: 'none',
              textAlign: 'left',
              width: '100%',
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: 13, opacity: 0.8 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* ── Main content area ──────────────────────────────────────────── */}
      {/* All sections stay mounted so switching tabs never triggers a re-fetch. */}
      <div style={{ ...SECTION_STYLE, display: section === 'tables' ? 'flex' : 'none' }}>
        <TablesDesigner
          projectId={projectId}
          onSelectTable={setSelectedTableId}
          selectedTableId={selectedTableId}
        />
      </div>
      <div style={{ ...SECTION_STYLE, display: section === 'backend-workflows' ? 'flex' : 'none' }}>
        <ServerWorkflowsPanel projectId={projectId} />
      </div>
      <div style={{ ...SECTION_STYLE, display: section === 'storage' ? 'flex' : 'none' }}>
        <StorageBrowser projectId={projectId} />
      </div>
    </div>
  );
}
