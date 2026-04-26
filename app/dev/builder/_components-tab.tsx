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
import { PRIMITIVE_COMPONENTS, type PrimitiveComponent } from '@/lib/builder/primitive-components';
import { getSystemComponents } from '@/lib/builder/system-component-data';
import { cloneWithFreshIdsKeepSharedKey, stampSharedKeys } from './_store-node-helpers';
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

export function DraggablePrimitive({ primitive }: { primitive: PrimitiveComponent }) {
  return (
    <div
      draggable
      onDragStart={e => {
        // System-component-backed palette entries drop as linked instances
        // (same pattern as Shared Components, but using _system metadata).
        // Primitives keep the existing builder/defaultNode fall-through.
        let data: string;
        if (primitive.systemComponentId) {
          const model = getSystemComponents()[primitive.systemComponentId];
          if (model) {
            // Mirror the Shared Component drop pipeline so each instance gets
            // fresh descendant ids (avoids DOM `[data-builder-id]` collisions
            // between two instances) while preserving `_sharedKey` on every
            // node so `_syncSharedInstances` can pair instance ↔ model.
            const modelContent = JSON.parse(JSON.stringify(model.content)) as Record<string, unknown>;
            stampSharedKeys(modelContent);
            const cloned = cloneWithFreshIdsKeepSharedKey(modelContent);
            cloned._system = { id: model.id, name: model.name };
            cloned._overrides = [];
            // Per-tile prop overrides: when the palette tile's defaultNode carries a
            // `props` bag, merge it onto the cloned SC root so e.g. `Btn Solid` and
            // `Btn Destructive` both drop a `sys-button` instance with different
            // initial `variant` / `label` / `iconLeft` / etc. SC-specific overrides
            // (anything that's a declared SC property) live on `cloned.props`; pure
            // styling props like `className` are deliberately not merged because the
            // SC content template owns its className via formula.
            const tileProps = (primitive.defaultNode as { props?: Record<string, unknown> } | undefined)?.props;
            if (tileProps && typeof tileProps === 'object') {
              const declared = new Set((model.properties ?? []).map(p => p.name));
              const incoming: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(tileProps)) {
                if (declared.has(key)) incoming[key] = value;
              }
              if (Object.keys(incoming).length > 0) {
                const existing = (cloned.props as Record<string, unknown> | undefined) ?? {};
                cloned.props = { ...existing, ...incoming };
              }
            }
            data = JSON.stringify(cloned);
          } else {
            data = JSON.stringify(primitive.builderDefaultNode ?? primitive.defaultNode);
          }
        } else {
          data = JSON.stringify(primitive.builderDefaultNode ?? primitive.defaultNode);
        }
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

