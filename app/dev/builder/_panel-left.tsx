'use client';

/**
 * Builder Left Panel — two tabs: Layers + Components
 *
 * Layers tab:
 *   - Full node tree with type icons
 *   - Expand/collapse tree
 *   - Visibility + lock toggles per row
 *   - Double-click to rename node ID
 *   - Right-click context menu (copy, paste, duplicate, delete, group, move up/down)
 *   - Keyboard: Delete to remove, Escape to deselect
 *   - SDUI badges: condition | map | actions
 *
 * Components tab:
 *   - All section variants, grouped by type
 *   - Draggable onto canvas via HTML5 drag API
 *   - Thumbnail + variant name
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { sectionLibrary } from '@/lib/ai/section-library';

// ─── Icons (inline SVG stubs) ─────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  Box:           '□',
  VStack:        '⬇',
  HStack:        '➡',
  Text:          'T',
  Heading:       'H',
  Image:         '🖼',
  Button:        '◻',
  Pressable:     '●',
  Input:         '▭',
  NavIcon:       '✦',
  default:       '◇',
};

function NodeIcon({ type }: { type: string }) {
  const icon = TYPE_ICONS[type] ?? TYPE_ICONS.default;
  return <span style={{ fontSize: 10, width: 14, display: 'inline-block', textAlign: 'center', opacity: 0.7 }}>{icon}</span>;
}

// ─── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  onClose: () => void;
}

function ContextMenu({ x, y, nodeId, onClose }: ContextMenuProps) {
  const store = useBuilderStore();
  const items = [
    { label: 'Move Up',   action: () => store.moveNodeUp(nodeId) },
    { label: 'Move Down', action: () => store.moveNodeDown(nodeId) },
    null,
    { label: 'Duplicate', action: () => store.duplicateNodes([nodeId]) },
    { label: 'Copy',      action: () => { store.select(nodeId); store.copyToClipboard(); } },
    { label: 'Paste',     action: () => store.pasteFromClipboard() },
    { label: 'Group',     action: () => store.groupNodes(store.selectedIds.includes(nodeId) ? store.selectedIds : [nodeId]) },
    null, // divider
    { label: 'Delete',    action: () => store.deleteNodes([nodeId]), danger: true },
  ];

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [onClose]);

  return (
    <div
      style={{ position: 'fixed', left: x, top: y, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, zIndex: 9999, minWidth: 140, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
      onMouseDown={e => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={i} style={{ height: 1, background: '#374151', margin: '2px 0' }} />
        ) : (
          <button
            key={item.label}
            style={{
              display: 'block',
              width: '100%',
              padding: '7px 14px',
              background: 'none',
              border: 'none',
              color: item.danger ? '#f87171' : '#d1d5db',
              fontSize: 12,
              fontFamily: 'system-ui',
              textAlign: 'left',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#374151')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={() => { item.action(); onClose(); }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ─── Layer Row ────────────────────────────────────────────────────────────────

interface LayerRowProps {
  node: SDUINode;
  depth: number;
  isSelected: boolean;
  isHovered: boolean;
  isExpanded: boolean;
  isHidden: boolean;
  isLocked: boolean;
  hasChildren: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onHover: (id: string | null) => void;
  onToggleExpand: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onRename: (id: string, newId: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
}

function LayerRow({
  node,
  depth,
  isSelected,
  isHovered,
  isExpanded,
  isHidden,
  isLocked,
  hasChildren,
  onSelect,
  onHover,
  onToggleExpand,
  onContextMenu,
  onRename,
  onToggleVisibility,
  onToggleLock,
}: LayerRowProps) {
  const nodeId = (node as { id?: string }).id ?? node.type;
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(nodeId);
  const inputRef = useRef<HTMLInputElement>(null);

  const badges: string[] = [];
  if ((node as { condition?: unknown }).condition != null) badges.push('if');
  if ((node as { map?: unknown }).map != null) badges.push('map');
  if ((node as { actions?: unknown }).actions != null) badges.push('act');

  const startEdit = useCallback(() => {
    setEditVal(nodeId);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [nodeId]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    if (editVal && editVal !== nodeId) {
      onRename(nodeId, editVal);
    }
  }, [editVal, nodeId, onRename]);

  const bg = isSelected
    ? '#1d4ed8'
    : isHovered
    ? 'rgba(59,130,246,0.15)'
    : 'transparent';

  return (
    <div
      data-testid="layer-row"
      data-node-id={nodeId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        paddingLeft: 8 + depth * 14,
        paddingRight: 4,
        height: 28,
        background: bg,
        cursor: 'pointer',
        opacity: isHidden ? 0.4 : 1,
        userSelect: 'none',
        borderRadius: 3,
        margin: '1px 4px',
      }}
      onClick={e => onSelect(nodeId, e.shiftKey || e.metaKey)}
      onMouseEnter={() => onHover(nodeId)}
      onMouseLeave={() => onHover(null)}
      onDoubleClick={startEdit}
      onContextMenu={e => { e.preventDefault(); onContextMenu(nodeId, e.clientX, e.clientY); }}
    >
      {/* Expand chevron */}
      <span
        style={{ fontSize: 8, width: 12, color: '#6b7280', cursor: 'pointer', flexShrink: 0 }}
        onClick={e => { e.stopPropagation(); if (hasChildren) onToggleExpand(nodeId); }}
      >
        {hasChildren ? (isExpanded ? '▾' : '▸') : ''}
      </span>

      <NodeIcon type={node.type} />

      {/* Node label */}
      <span style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        {editing ? (
          <input
            ref={inputRef}
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
            style={{ background: '#111827', border: '1px solid #3b82f6', borderRadius: 3, color: '#f3f4f6', fontSize: 11, padding: '1px 4px', width: '100%' }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span style={{ fontSize: 11, color: isSelected ? '#fff' : '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nodeId}
          </span>
        )}
      </span>

      {/* SDUI badges */}
      {badges.map(b => (
        <span
          key={b}
          style={{ fontSize: 9, background: '#374151', color: '#9ca3af', borderRadius: 3, padding: '0 3px', marginLeft: 2, flexShrink: 0 }}
        >
          {b}
        </span>
      ))}

      {/* Visibility / Lock icons (appear on hover) */}
      <span
        style={{ fontSize: 10, opacity: isHidden ? 1 : 0, marginLeft: 2 }}
        className="layer-vis"
        onClick={e => { e.stopPropagation(); onToggleVisibility(nodeId); }}
        title={isHidden ? 'Show' : 'Hide'}
      >
        {isHidden ? '🙈' : '👁'}
      </span>
      <span
        style={{ fontSize: 10, opacity: isLocked ? 1 : 0, marginLeft: 2 }}
        onClick={e => { e.stopPropagation(); onToggleLock(nodeId); }}
        title={isLocked ? 'Unlock' : 'Lock'}
      >
        {isLocked ? '🔒' : '🔓'}
      </span>
    </div>
  );
}

// ─── Recursive layer tree ─────────────────────────────────────────────────────

function LayerTree({
  nodes,
  depth = 0,
  store,
  contextMenuHandlers,
}: {
  nodes: SDUINode[];
  depth?: number;
  store: ReturnType<typeof useBuilderStore>;
  contextMenuHandlers: {
    show: (id: string, x: number, y: number) => void;
  };
}) {
  if (!nodes?.length) return null;

  return (
    <>
      {nodes.map(node => {
        const nodeId = (node as { id?: string }).id ?? node.type;
        const children = node.children as SDUINode[] | undefined;
        const hasChildren = !!(children?.length);
        const isExpanded = store.expandedIds.has(nodeId);

        return (
          <React.Fragment key={nodeId}>
            <LayerRow
              node={node}
              depth={depth}
              isSelected={store.selectedIds.includes(nodeId)}
              isHovered={store.hoveredId === nodeId}
              isExpanded={isExpanded}
              isHidden={store.hiddenIds.has(nodeId)}
              isLocked={store.lockedIds.has(nodeId)}
              hasChildren={hasChildren}
              onSelect={store.select}
              onHover={store.hover}
              onToggleExpand={store.toggleExpanded}
              onContextMenu={contextMenuHandlers.show}
              onRename={store.renameNode}
              onToggleVisibility={store.toggleVisibility}
              onToggleLock={store.toggleLock}
            />
            {hasChildren && isExpanded && (
              <LayerTree
                nodes={children!}
                depth={depth + 1}
                store={store}
                contextMenuHandlers={contextMenuHandlers}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

// ─── Primitive components registry ───────────────────────────────────────────

const PRIMITIVE_COMPONENTS: Record<string, { type: string; label: string; icon: string; defaultNode: object }[]> = {
  Layout: [
    // Containers keep w-full — they are meant to fill their parent
    { type: 'Box',    label: 'Box',    icon: '□', defaultNode: { type: 'Box',    props: { className: 'flex flex-col p-4 gap-4 w-full min-h-[80px]' } } },
    { type: 'Box',    label: 'Row',    icon: '⬌', defaultNode: { type: 'Box',    props: { className: 'flex flex-row gap-4 p-4 w-full min-h-[60px] items-center' } } },
    { type: 'VStack', label: 'VStack', icon: '⬇', defaultNode: { type: 'VStack', props: { className: 'gap-4 p-4 w-full min-h-[80px]' } } },
    { type: 'HStack', label: 'HStack', icon: '➡', defaultNode: { type: 'HStack', props: { className: 'gap-4 p-4 w-full min-h-[60px] items-center' } } },
  ],
  Typography: [
    // Text elements size to their content
    { type: 'Text',    label: 'Text',    icon: 'T', defaultNode: { type: 'Text',    text: 'Text block', props: { className: 'text-base text-gray-800' } } },
    { type: 'Heading', label: 'Heading', icon: 'H', defaultNode: { type: 'Heading', text: 'Heading',    props: { className: 'text-2xl font-bold text-gray-900' } } },
  ],
  Interactive: [
    // Button/Pressable: natural auto size
    { type: 'Button',    label: 'Button',    icon: '◻', defaultNode: { type: 'Button', props: { size: 'md' }, children: [{ type: 'ButtonText', text: 'Button' }] } },
    { type: 'Pressable', label: 'Pressable', icon: '●', defaultNode: { type: 'Pressable', props: { className: 'px-4 py-2 items-center justify-center' }, children: [{ type: 'Text', text: 'Press me' }] } },
  ],
  Form: [
    // Input: fixed readable width, not full-width
    { type: 'Input',    label: 'Input',    icon: '▭', defaultNode: { type: 'Input', props: { variant: 'outline', size: 'md', className: 'w-64' }, children: [{ type: 'InputField', props: { placeholder: 'Enter text…' } }] } },
    { type: 'Switch',   label: 'Switch',   icon: '⏻', defaultNode: { type: 'Switch',   props: { defaultValue: false } } },
    { type: 'Checkbox', label: 'Checkbox', icon: '☑', defaultNode: { type: 'Checkbox', props: { defaultIsChecked: false }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Label' }] } },
  ],
  Media: [
    // Image stays w-full — images naturally fill their container
    { type: 'Image',   label: 'Image', icon: '🖼', defaultNode: { type: 'Image', props: { className: 'w-full h-48 object-cover rounded-md' }, src: 'https://placehold.co/600x400' } },
    { type: 'NavIcon', label: 'Icon',  icon: '✦', defaultNode: { type: 'NavIcon', props: { icon: 'Star', size: 24, color: '#6b7280' } } },
  ],
};

// ─── Components tab ───────────────────────────────────────────────────────────

const ALL_VARIANTS = (() => {
  const manifest = sectionLibrary.getManifest();
  const grouped: Record<string, { variantId: string; label: string }[]> = {};
  for (const entry of manifest) {
    const group = entry.variantId.split('.')[0]; // 'hero', 'navbar', 'footer', etc.
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push({ variantId: entry.variantId, label: entry.label });
  }
  return grouped;
})();

function ComponentsTab() {
  const [search, setSearch] = useState('');
  const [showSections, setShowSections] = useState(true);
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

      {/* ── Section variants ── */}
      <SectionHeader label="Sections" collapsible collapsed={!showSections} onToggle={() => setShowSections(v => !v)} />
      {showSections && Object.entries(ALL_VARIANTS).map(([group, variants]) => {
        const filtered = (variants as { variantId: string; label: string }[]).filter(
          v => !q || v.label.toLowerCase().includes(q) || v.variantId.toLowerCase().includes(q)
        );
        if (!filtered.length) return null;
        return (
          <div key={group} style={{ marginBottom: 8 }}>
            <div style={{ padding: '4px 12px 2px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              {group}
            </div>
            {filtered.map(v => (
              <DraggableVariant key={v.variantId} variantId={v.variantId} label={v.label} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SectionHeader({ label, collapsible, collapsed, onToggle }: { label: string; collapsible?: boolean; collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div
      style={{ padding: '8px 12px 4px', fontSize: 11, color: '#9ca3af', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: collapsible ? 'pointer' : 'default', borderTop: '1px solid #1f2937', marginTop: 4 }}
      onClick={onToggle}
    >
      <span>{label}</span>
      {collapsible && <span style={{ fontSize: 9 }}>{collapsed ? '▸' : '▾'}</span>}
    </div>
  );
}

function DraggablePrimitive({ primitive }: { primitive: { type: string; label: string; icon: string; defaultNode: object } }) {
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/primitive-node', JSON.stringify(primitive.defaultNode));
        e.dataTransfer.effectAllowed = 'copy';
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

function DraggableVariant({ variantId, label }: { variantId: string; label: string }) {
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/variant-id', variantId);
        e.dataTransfer.effectAllowed = 'copy';
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
      {/* Thumbnail placeholder */}
      <div style={{ width: 36, height: 24, background: '#374151', borderRadius: 3, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function PanelLeft() {
  const [tab, setTab] = useState<'layers' | 'components'>('components');
  const [search, setSearch] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const store = useBuilderStore();

  const filteredNodes = useMemo(() => {
    if (!search.trim()) return store.pageNodes;
    const q = search.toLowerCase();
    const filterTree = (nodes: SDUINode[]): SDUINode[] =>
      nodes.reduce<SDUINode[]>((acc, n) => {
        const id = ((n as { id?: string }).id ?? n.type).toLowerCase();
        const childMatch = filterTree(n.children as SDUINode[] ?? []);
        if (id.includes(q) || childMatch.length) {
          acc.push({ ...n, children: childMatch.length ? childMatch : n.children });
        }
        return acc;
      }, []);
    return filterTree(store.pageNodes as SDUINode[]);
  }, [store.pageNodes, search]);

  const ctxHandlers = useMemo(() => ({
    show: (id: string, x: number, y: number) => setContextMenu({ id, x, y }),
  }), []);

  return (
    <div style={{ width: 240, display: 'flex', flexDirection: 'column', background: '#111827', borderRight: '1px solid #1f2937', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {(['layers', 'components'] as const).map(t => (
          <button
            key={t}
            data-testid={`tab-${t}`}
            style={{
              flex: 1,
              padding: '9px 0',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
              color: tab === t ? '#f3f4f6' : '#6b7280',
              fontSize: 11,
              cursor: 'pointer',
              textTransform: 'capitalize',
              marginBottom: -1,
            }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'layers' && (
        <>
          {/* Search */}
          <div style={{ padding: '6px 8px', flexShrink: 0 }}>
            <input
              placeholder="Search layers…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, color: '#d1d5db', fontSize: 11, padding: '4px 8px', boxSizing: 'border-box' }}
            />
          </div>

          {/* Empty state */}
          {filteredNodes.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 16 }}>
              {store.pageNodes.length === 0
                ? 'Drop a component to get started'
                : 'No layers match your search'}
            </div>
          )}

          {/* Tree */}
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
            <LayerTree
              nodes={filteredNodes as SDUINode[]}
              store={store}
              contextMenuHandlers={ctxHandlers}
            />
          </div>
        </>
      )}

      {tab === 'components' && <ComponentsTab />}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.id}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
