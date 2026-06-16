'use client';

/**
 * Floating Quick-Actions Toolbar
 *
 * Renders just above the selected element's bounding box on the canvas.
 * Contains:
 *   - Breadcrumb: Page › Section › Box › Button (click to select ancestor)
 *   - Move ↑ / ↓
 *   - Duplicate / Delete
 *   - ⚡ Bind (opens Logic → Data Binding)
 *   - ⚡ Action (opens Logic → Interactions)
 *   - ⋯ More (overflow menu)
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useBuilderStore, findNode, findParentNode } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FloatingToolbarProps {
  /** Bounding rect of the selected element in screen coordinates */
  selectedRect: DOMRect | null;
  /** The selected node */
  node: SDUINode | null;
  /** Canvas container ref for positioning relative to canvas */
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
}

// ─── Btn ──────────────────────────────────────────────────────────────────────

function Btn({
  label,
  title,
  onClick,
  danger = false,
  accent = false,
  disabled = false,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  danger?: boolean;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      disabled={disabled}
      style={{
        background: accent ? '#1d4ed8' : 'none',
        border: 'none',
        borderRadius: 3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: danger ? 'var(--bld-error)' : accent ? '#bfdbfe' : '#d1d5db',
        fontSize: 11,
        padding: '3px 6px',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled) e.currentTarget.style.background = danger ? '#7f1d1d20' : accent ? '#2563eb' : '#374151';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = accent ? '#1d4ed8' : 'none';
      }}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 16, background: 'var(--bld-bg-elevated)', margin: '0 2px', flexShrink: 0 }} />;
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({ nodeId, pageNodes }: { nodeId: string; pageNodes: SDUINode[] }) {
  const store = useBuilderStore();

  // Build ancestor chain: [root, ..., parent, node]
  const chain: SDUINode[] = [];
  let current: SDUINode | null = findNode(pageNodes, nodeId) ?? null;
  if (current) chain.push(current);

  let parentId = nodeId;
  for (let i = 0; i < 10; i++) {
    const parent = findParentNode(pageNodes, parentId);
    if (!parent || parent === null || parent === undefined) break;
    chain.unshift(parent);
    parentId = (parent as SDUINode).id ?? '';
    if (!parentId) break;
  }

  // Limit to 4 ancestors
  const limited = chain.slice(-5);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, maxWidth: 300, overflow: 'hidden' }}>
      {limited.map((node, i) => {
        const isLast = i === limited.length - 1;
        const label = (node.id ?? node.type).slice(0, 16);
        return (
          <React.Fragment key={node.id ?? i}>
            {i > 0 && <span style={{ color: 'var(--bld-text-disabled)', fontSize: 10 }}>›</span>}
            <button
              onClick={() => node.id && store.select(node.id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: isLast ? '#f3f4f6' : 'var(--bld-text-3)',
                fontSize: 10,
                padding: '1px 3px',
                borderRadius: 3,
                fontWeight: isLast ? 600 : 400,
                whiteSpace: 'nowrap',
                maxWidth: 80,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#374151')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              {label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── More menu ────────────────────────────────────────────────────────────────

function MoreMenu({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const store = useBuilderStore();

  const items = [
    { label: 'Group',    action: () => store.groupNodes([nodeId]) },
    { label: 'Lock',     action: () => store.toggleLock(nodeId) },
    { label: 'Hide',     action: () => store.toggleVisibility(nodeId) },
    null,
    { label: 'Copy',     action: () => { store.copyToClipboard(); } },
    { label: 'Paste after', action: () => store.pasteFromClipboard() },
    null,
    { label: 'Select parent', action: () => store.selectParent(nodeId) },
    { label: 'Select first child', action: () => store.selectFirstChild(nodeId) },
  ];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest('[data-more-menu]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      data-more-menu="1"
      style={{
        position: 'fixed',
        background: 'var(--bld-bg-input)',
        border: '1px solid var(--bld-border-subtle)',
        borderRadius: 6,
        zIndex: 100001,
        minWidth: 160,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={i} style={{ height: 1, background: 'var(--bld-bg-elevated)', margin: '2px 0' }} />
        ) : (
          <button
            key={item.label}
            onClick={() => { item.action(); onClose(); }}
            style={{ display: 'block', width: '100%', padding: '6px 14px', background: 'none', border: 'none', color: 'var(--bld-text-2)', fontSize: 11, textAlign: 'left', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#374151')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FloatingToolbar({ selectedRect, node, canvasContainerRef }: FloatingToolbarProps) {
  const store = useBuilderStore();
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [morePos, setMorePos] = useState<{ top: number; left: number } | null>(null);

  const openMore = useCallback(() => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (rect) setMorePos({ top: rect.bottom + 4, left: rect.left });
    setShowMore(true);
  }, []);

  if (!selectedRect || !node || !node.id) return null;

  const nodeId = node.id;
  const { pageNodes } = store;
  const hasChildren = (node.children?.length ?? 0) > 0;

  // Position toolbar just above the element
  const top = selectedRect.top - 38;
  const left = selectedRect.left;

  // Keyboard shortcut indicator
  const openLogicTab = (section: string) => {
    store.openLogicSection(section);
    // Dispatch a custom event to switch to Logic tab in panel-right
    window.dispatchEvent(new CustomEvent('builder:open-logic-tab', { detail: { section } }));
  };

  return (
    <>
      <div
        data-floating-toolbar="1"
        style={{
          position: 'fixed',
          top: Math.max(4, top),
          left: Math.max(4, left),
          zIndex: 99998,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pointerEvents: 'all',
        }}
      >
        {/* Breadcrumb row */}
        <div
          style={{
            background: 'rgba(15,23,42,0.95)',
            border: '1px solid var(--bld-border-subtle)',
            borderRadius: '4px 4px 0 0',
            padding: '3px 8px',
            backdropFilter: 'blur(8px)',
            borderBottom: 'none',
          }}
        >
          <Breadcrumb nodeId={nodeId} pageNodes={pageNodes} />
        </div>

        {/* Actions row */}
        <div
          style={{
            background: 'rgba(15,23,42,0.95)',
            border: '1px solid var(--bld-border-subtle)',
            borderRadius: '0 0 4px 4px',
            padding: '3px 6px',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'nowrap',
          }}
        >
          {/* Move */}
          <Btn label="↑" title="Move up (↑)" onClick={() => store.moveNodeUp(nodeId)} />
          <Btn label="↓" title="Move down (↓)" onClick={() => store.moveNodeDown(nodeId)} />
          <Divider />
          {/* Duplicate / Delete */}
          <Btn label="⧉ Dup" title="Duplicate (Ctrl+D)" onClick={() => store.duplicateNodes([nodeId])} />
          <Btn
            label="⊘ Del"
            title="Delete (Delete)"
            danger
            onClick={() => {
              const idsToDelete = store.selectedIds.includes(nodeId) ? store.selectedIds : [nodeId];
              const multiChild = idsToDelete.some(id => { const n = findNode(store.pageNodes, id); return (n?.children?.length ?? 0) > 0; });
              if (!multiChild || idsToDelete.length > 1 || !hasChildren || window.confirm(`Delete "${nodeId}" and its ${node.children!.length} child(ren)?`)) {
                store.deleteNodes(idsToDelete);
              }
            }}
          />
          <Divider />
          {/* Logic shortcuts */}
          <Btn label="⚡ Bind"   title="Bind variable (B)"  accent onClick={() => openLogicTab('binding')} />
          <Btn label="⚡ Action" title="Add interaction (I)" accent onClick={() => openLogicTab('interactions')} />
          <Btn label="⬇ Fetch"  title="Connect data source" accent onClick={() => openLogicTab('datasource')} />
          <Divider />
          {/* More */}
          <button
            ref={moreRef}
            onClick={openMore}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-3)', fontSize: 11, padding: '3px 4px', borderRadius: 3 }}
            onMouseEnter={e => (e.currentTarget.style.background = '#374151')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            ⋯
          </button>
        </div>
      </div>

      {showMore && morePos && (
        <div style={{ position: 'fixed', top: morePos.top, left: morePos.left, zIndex: 100001 }}>
          <MoreMenu nodeId={nodeId} onClose={() => setShowMore(false)} />
        </div>
      )}
    </>
  );
}
