'use client';

/**
 * _components-tab.tsx
 *
 * Components tab for the Builder Left Panel.
 * Contains the draggable primitives registry and the ComponentsTab UI.
 * Extracted from _panel-left.tsx.
 *
 * Exports:
 *  - PRIMITIVE_COMPONENTS  — re-exported from lib/builder/primitive-components (single source of truth)
 *  - SectionHeader         — collapsible section header
 *  - DraggablePrimitive    — single draggable component tile
 *  - ComponentsTab         — full components tab panel
 */

import React, { useState } from 'react';
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { PRIMITIVE_COMPONENTS } from '@/lib/builder/primitive-components';
import { Chevron } from './_layers-panel';

// Re-export so existing imports of PRIMITIVE_COMPONENTS from this file keep working
export { PRIMITIVE_COMPONENTS };

// ─── Components tab ───────────────────────────────────────────────────────────

export function ComponentsTab() {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
      {/* Search */}
      <div style={{ padding: '0 10px 8px' }}>
        <input
          placeholder="Search components…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 5, color: '#d1d5db', fontSize: 11, padding: '5px 8px', boxSizing: 'border-box' }}
        />
      </div>

      {/* ── Primitive components ── */}
      <SectionHeader label="Primitives" />
      {Object.entries(PRIMITIVE_COMPONENTS).map(([group, items]) => {
        const filtered = items.filter(
          it => !q || it.label.toLowerCase().includes(q) || it.type.toLowerCase().includes(q)
        );
        if (!filtered.length) return null;
        return (
          <div key={group} style={{ marginBottom: 4 }}>
            <div style={{ padding: '4px 12px 2px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              {group}
            </div>
            {filtered.map(p => (
              <DraggablePrimitive key={p.label} primitive={p} />
            ))}
          </div>
        );
      })}

    </div>
  );
}

export function SectionHeader({ label, collapsible, collapsed, onToggle }: { label: string; collapsible?: boolean; collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div
      style={{ padding: '8px 12px 4px', fontSize: 11, color: '#9ca3af', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: collapsible ? 'pointer' : 'default', borderTop: '1px solid #1f2937', marginTop: 4 }}
      onClick={onToggle}
    >
      <span>{label}</span>
      {collapsible && <Chevron open={!collapsed} size={10} />}
    </div>
  );
}

export function DraggablePrimitive({ primitive }: { primitive: { type: string; label: string; icon: string; defaultNode: object } }) {
  return (
    <div
      draggable
      onDragStart={e => {
        const data = JSON.stringify(primitive.defaultNode);
        e.dataTransfer.setData('text/primitive-node', data);
        e.dataTransfer.effectAllowed = 'copy';
        // Fallback for CDP-simulated drags (e.g. Playwright headless) where
        // subsequent dragover/drop events may receive an empty dataTransfer.
        (window as unknown as Record<string, unknown>).__primitiveDrag = data;
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        cursor: 'grab',
        borderRadius: 4,
        margin: '1px 4px',
        userSelect: 'none',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.15)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ width: 36, height: 24, background: '#1f2937', borderRadius: 3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#9ca3af', border: '1px solid #374151' }}>
        {primitive.icon}
      </div>
      <span style={{ fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {primitive.label}
      </span>
    </div>
  );
}

