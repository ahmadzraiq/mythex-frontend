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
 *  - DraggablePrimitive    — single draggable component tile (3-col card)
 *  - ComponentsTab         — full components tab panel
 */

import React, { useState } from 'react';
import { PRIMITIVE_COMPONENTS, type PrimitiveComponent } from '@/lib/builder/primitive-components';
import { PrimitiveIcon } from '@/lib/builder/primitive-icons';
import { SearchInput } from './_panel-primitives';
import { Chevron } from './_layers-panel';
import { SharedComponentsTab } from './_shared-components-tab';
import { TemplateLibraryModal } from './_template-library-modal';

// Re-export so existing imports of PRIMITIVE_COMPONENTS from this file keep working
export { PRIMITIVE_COMPONENTS };

// ─── Components tab ───────────────────────────────────────────────────────────

// ─── Components tab ───────────────────────────────────────────────────────────

export function ComponentsTab() {
  const [search, setSearch] = useState('');
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
  const q = search.toLowerCase();

  const flatPrimitives = Object.values(PRIMITIVE_COMPONENTS).flat();
  const filtered = flatPrimitives.filter(
    p => !q || p.label.toLowerCase().includes(q) || p.type.toLowerCase().includes(q)
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* ── Search ── */}
      <div style={{ padding: '8px 8px 6px', flexShrink: 0 }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search components…" />
      </div>

      {/* ── Elements label ── */}
      <div style={{ padding: '2px 10px 4px' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--bld-text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Elements</span>
      </div>

      {/* ── Primitive components grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, padding: '0 8px 4px' }}>
        {filtered.map(p => (
          <DraggablePrimitive key={p.label} primitive={p} />
        ))}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '16px 0', textAlign: 'center', fontSize: 10, color: 'var(--bld-text-3)' }}>
            No results for &ldquo;{search}&rdquo;
          </div>
        )}
      </div>

      {/* ── Shared section ── */}
      <SharedComponentsTab onImport={() => setShowTemplateLibrary(true)} />

      {showTemplateLibrary && (
        <TemplateLibraryModal open={showTemplateLibrary} onClose={() => setShowTemplateLibrary(false)} />
      )}
    </div>
  );
}

export function SectionHeader({
  label, collapsible, collapsed, onToggle,
}: {
  label: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      style={{
        padding: '8px 12px 4px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--bld-text-3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: collapsible ? 'pointer' : 'default',
        borderTop: '1px solid var(--bld-border)',
        marginTop: 4,
        userSelect: 'none',
      }}
      onClick={onToggle}
    >
      <span>{label}</span>
      {collapsible && <Chevron open={!collapsed} size={10} />}
    </div>
  );
}

export function DraggablePrimitive({ primitive }: { primitive: PrimitiveComponent }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      draggable
      onDragStart={e => {
        const data = JSON.stringify(primitive.builderDefaultNode ?? primitive.defaultNode);
        e.dataTransfer.setData('text/primitive-node', data);
        e.dataTransfer.effectAllowed = 'copy';
        (window as unknown as Record<string, unknown>).__primitiveDrag = data;
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: '10px 4px 8px',
        cursor: 'grab',
        borderRadius: 'var(--bld-r-md)',
        border: `1px solid ${hovered ? 'var(--bld-accent)' : 'var(--bld-border)'}`,
        background: hovered ? 'var(--bld-bg-hover)' : 'transparent',
        userSelect: 'none',
        transition: 'border-color 0.12s, background 0.12s',
        minHeight: 62,
      }}
    >
      <span style={{ color: hovered ? 'var(--bld-accent)' : 'var(--bld-text-3)', transition: 'color 0.12s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <PrimitiveIcon type={primitive.type} size={18} />
      </span>
      <span style={{
        fontSize: 9,
        fontWeight: 500,
        color: hovered ? 'var(--bld-text-2)' : 'var(--bld-text-3)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: '100%',
        textAlign: 'center',
        transition: 'color 0.12s',
      }}>
        {primitive.label}
      </span>
    </div>
  );
}
