'use client';

/**
 * _layers-panel.tsx
 *
 * Layer tree components for the Builder Left Panel.
 * Extracted from _panel-left.tsx.
 *
 * Exports:
 *  - Chevron         — animated expand chevron
 *  - NodeIcon        — stub icon per node type
 *  - ContextMenu     — right-click context menu for layer rows
 *  - LayerRow        — single row in the layer tree
 *  - LayerTree       — recursive tree renderer
 */

import React, { useState, useRef, useCallback, useEffect, memo, useMemo } from 'react';
import { useBuilderStore, findParentNode, findNode, isNonDraggable } from './_store';
import type { BuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';

export function Chevron({ open, size = 10, color = '#6b7280' }: { open?: boolean; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ─── Icons (inline SVG stubs) ─────────────────────────────────────────────────

export function NodeIcon(_: { type: string }) {
  return null;
}

// ─── Context menu ─────────────────────────────────────────────────────────────

export interface ContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  onClose: () => void;
}

export function ContextMenu({ x, y, nodeId, onClose }: ContextMenuProps) {
  const store = useBuilderStore();

  // Resolve the selected node to check _shared metadata
  const targetNode = useMemo(() => {
    return findNode(store.pageNodes as SDUINode[], nodeId)
      ?? findNode(store.canvasNodes as SDUINode[], nodeId);
  }, [store.pageNodes, store.canvasNodes, nodeId]);

  const nodeShared = (targetNode as unknown as Record<string, unknown> | null)?._shared as { id: string; name: string } | undefined;
  const isShared = !!nodeShared;

  const handleToggleShared = () => {
    if (isShared && nodeShared) {
      // PER-INSTANCE DETACH (Figma-style):
      // Strip ALL shared-component metadata from THIS instance's subtree only.
      // The SC model and other instances remain untouched.
      if (!window.confirm(`Detach this instance of "${nodeShared.name}"? The shared component and other instances will remain intact.`)) return;
      store.detachInstance(nodeId);
    } else if (targetNode) {
      const scId = `sc-${crypto.randomUUID()}`;
      const scName = (targetNode as unknown as { name?: string }).name || targetNode.type || 'Shared Component';
      const content = JSON.parse(JSON.stringify(targetNode)) as Record<string, unknown>;
      delete content._shared;
      delete content._overrides;
      // Stamp stable _sharedKey on every node of the model content. We then
      // mirror the same keys onto the now-instance subtree so that model and
      // instance can be walked in parallel by _sharedKey for future merges.
      import('./_store-node-helpers').then(nh => {
        nh.stampSharedKeys(content);
        import('@/lib/builder/shared-component-data').then(m => {
          m.createSharedComponent({ id: scId, name: String(scName), properties: [], content });
        }).catch(() => {});
        // Walk targetNode and content in lockstep by structural position,
        // copying model _sharedKey onto the instance. They are structurally
        // identical at this point (content was cloned from targetNode).
        const stampInstance = (instNode: Record<string, unknown>, modelNode: Record<string, unknown>) => {
          if (typeof modelNode._sharedKey === 'string') {
            store.patchNodeField(instNode.id as string, '_sharedKey', modelNode._sharedKey);
          }
          const iChildren = (instNode.children ?? []) as Record<string, unknown>[];
          const mChildren = (modelNode.children ?? []) as Record<string, unknown>[];
          for (let i = 0; i < iChildren.length && i < mChildren.length; i++) {
            stampInstance(iChildren[i], mChildren[i]);
          }
        };
        stampInstance(targetNode as unknown as Record<string, unknown>, content);
      }).catch(() => {});
      store.patchNodeField(nodeId, '_shared', { id: scId, name: scName });
      store.patchNodeField(nodeId, '_overrides', []);
    }
  };

  const items = [
    { label: 'Move Up',   action: () => store.moveNodeUp(nodeId) },
    { label: 'Move Down', action: () => store.moveNodeDown(nodeId) },
    null,
    { label: 'Duplicate', action: () => store.duplicateNodes([nodeId]) },
    { label: 'Copy',      action: () => { store.select(nodeId); store.copyToClipboard(); } },
    { label: 'Paste',     action: () => store.pasteFromClipboard() },
    { label: 'Group',     action: () => store.groupNodes(store.selectedIds.includes(nodeId) ? store.selectedIds : [nodeId]) },
    null, // divider
    {
      label: isShared ? `Detach from Shared "${nodeShared?.name}"` : 'Make Shared',
      action: handleToggleShared,
      shared: true,
    },
    null, // divider
    { label: 'Delete',    action: () => store.deleteNodes(store.selectedIds.includes(nodeId) ? store.selectedIds : [nodeId]), danger: true },
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
              color: item.danger ? '#f87171' : (item as { shared?: boolean }).shared ? '#60a5fa' : '#d1d5db',
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

// ─── Layer drag state (shared across the whole tree) ─────────────────────────

// Container types that can receive children in the layers panel
// Keep in sync with isContainer in _panel-right.tsx and CONTAINER_TYPES in _canvas.tsx
const LAYER_CONTAINER_TYPES = new Set([
  'Box',
  'Checkbox', 'CheckboxGroup', 'Radio', 'RadioGroup',
  'Skeleton',
  'Tooltip',
  'FormContainer',
]);

export interface LayerDragState {
  dragId: string | null;
  /** ID of the row currently under the cursor */
  dropTargetId: string | null;
  /** 'above' = insert before, 'inside' = nest into container, 'below' = insert after */
  dropPosition: 'above' | 'inside' | 'below';
}

const LAYER_DRAG_KEY = 'text/layer-node-id';

// ─── Layer Row ────────────────────────────────────────────────────────────────

export interface LayerRowProps {
  node: SDUINode;
  depth: number;
  isSelected: boolean;
  isHovered: boolean;
  isExpanded: boolean;
  isHidden: boolean;
  isLocked: boolean;
  hasChildren: boolean;
  isContainer: boolean;        // can receive children
  isDragOverAbove: boolean;    // blue insert-line above this row
  isDragOverBelow: boolean;    // blue insert-line below this row
  isDragOverInside: boolean;   // blue outline = drop inside (empty container)
  onSelect: (id: string, multi: boolean) => void;
  onHover: (id: string | null) => void;
  onToggleExpand: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onRename: (id: string, newId: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onLayerDragStart: (id: string) => void;
  onLayerDragOver: (id: string, pos: 'above' | 'inside' | 'below') => void;
  onLayerDrop: () => void;
}

export const LayerRow = memo(function LayerRow_({
  node,
  depth,
  isSelected,
  isHovered,
  isExpanded,
  isHidden,
  isLocked,
  hasChildren,
  isContainer,
  isDragOverAbove,
  isDragOverBelow,
  isDragOverInside,
  onSelect,
  onHover,
  onToggleExpand,
  onContextMenu,
  onRename,
  onToggleVisibility,
  onToggleLock,
  onLayerDragStart,
  onLayerDragOver,
  onLayerDrop,
}: LayerRowProps) {
  const nodeId = (node as { id?: string }).id ?? node.type;
  const nodeName = (node as { name?: string }).name;
  const displayLabel = nodeName || (node._popoverContent ? 'PopoverContent' : node.type);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(displayLabel);
  const inputRef = useRef<HTMLInputElement>(null);

  // Enriched badges with count + tooltip preview
  type BadgeInfo = { key: string; label: string; icon: string; color: string; bg: string; title: string };
  const badges: BadgeInfo[] = [];

  const condition = (node as { condition?: unknown }).condition;
  if (condition != null) {
    const preview = JSON.stringify(condition);
    const short = preview.length > 40 ? preview.slice(0, 38) + '…' : preview;
    badges.push({ key: 'if', label: 'if', icon: 'if', color: '#60a5fa', bg: '#1e3a5f', title: `Condition: ${short}` });
  }

  const mapPath = (node as { map?: unknown }).map;
  if (mapPath != null) {
    const mapLabel = typeof mapPath === 'string'
      ? (mapPath.split('.').pop() ?? mapPath)
      : typeof mapPath === 'object'
        ? JSON.stringify(mapPath).slice(0, 30)
        : String(mapPath);
    const mapTitle = typeof mapPath === 'string' ? mapPath : JSON.stringify(mapPath);
    badges.push({ key: 'map', label: `⟳ ${mapLabel}`, icon: '⟳', color: '#c084fc', bg: '#2e1065', title: `Repeat over: ${mapTitle}` });
  }

  const nodeActions = (node as { actions?: Record<string, unknown> }).actions;
  if (nodeActions != null) {
    const eventCount = Object.keys(nodeActions).length;
    const preview = Object.keys(nodeActions).join(', ');
    badges.push({ key: 'act', label: `⚡ ${eventCount}`, icon: '⚡', color: '#818cf8', bg: '#1e1b4b', title: `Events: ${preview}` });
  }

  const ds = (node as { dataSource?: unknown }).dataSource;
  if (ds != null) {
    badges.push({ key: 'ds', label: '↓', icon: '↓', color: '#34d399', bg: '#022c22', title: 'Has data source' });
  }

  const nodeSharedMeta = (node as unknown as Record<string, unknown>)._shared as { id: string; name: string } | undefined;
  if (nodeSharedMeta) {
    badges.push({ key: 'shared', label: 'SC', icon: 'SC', color: '#60a5fa', bg: '#1e3a5f', title: `Shared component: ${nodeSharedMeta.name}` });
  }

  const responsive = (node as unknown as Record<string, unknown>).responsive as Record<string, unknown> | undefined;
  if (responsive && typeof responsive === 'object') {
    const bps = Object.keys(responsive);
    if (bps.length > 0) {
      const bpIcons: Record<string, string> = { laptop: '💻', tablet: '📱', mobile: '📲' };
      const bpLabels = bps.map(b => bpIcons[b] ?? b).join(' ');
      badges.push({ key: 'resp', label: bpLabels, icon: '📐', color: '#f59e0b', bg: '#451a03', title: `Responsive: ${bps.join(', ')}` });
    }
  }

  if (node.popover) {
    badges.push({ key: 'pop', label: 'Popover', icon: '◱', color: '#a78bfa', bg: '#312e81', title: 'Has popover config' });
  }

  const stateTag = (node as unknown as Record<string, unknown>)._stateTag as string | undefined;
  if (stateTag === 'loading') {
    badges.push({ key: 'state', label: 'loading', icon: '⟳', color: '#fbbf24', bg: '#451a03', title: 'State: Loading' });
  } else if (stateTag === 'empty') {
    badges.push({ key: 'state', label: 'empty', icon: '○', color: '#6ee7b7', bg: '#022c22', title: 'State: Empty' });
  } else if (stateTag === 'default') {
    badges.push({ key: 'state', label: 'default', icon: '◉', color: '#9ca3af', bg: '#1f2937', title: 'State: Default' });
  } else if (stateTag) {
    badges.push({ key: 'state', label: stateTag, icon: '◈', color: '#c084fc', bg: '#2e1065', title: `State: ${stateTag}` });
  }

  const startEdit = useCallback(() => {
    setEditVal(displayLabel);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [displayLabel]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const trimmed = editVal.trim();
    if (trimmed && trimmed !== displayLabel) {
      onRename(nodeId, trimmed);
    }
  }, [editVal, displayLabel, nodeId, onRename]);

  const bg = isSelected
    ? '#1d4ed8'
    : isHovered
    ? 'rgba(59,130,246,0.15)'
    : 'transparent';

  const isDragLocked = isNonDraggable(node);

  return (
    <div
      data-testid="layer-row"
      data-layer-row
      data-node-id={nodeId}
      data-node-type={node.type}
      draggable={!isDragLocked}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        paddingLeft: 2 + depth * 8,
        paddingRight: 4,
        height: 22,
        background: bg,
        cursor: isDragLocked ? 'default' : 'grab',
        opacity: isHidden ? 0.4 : 1,
        userSelect: 'none',
        borderRadius: 2,
        margin: '0 2px',
        position: 'relative',
        borderTop:    isDragOverAbove  ? '2px solid #3b82f6' : '2px solid transparent',
        borderBottom: isDragOverBelow  ? '2px solid #3b82f6' : '2px solid transparent',
        outline:      isDragOverInside ? '2px solid #3b82f6' : 'none',
        outlineOffset: '-2px',
      }}
      onClick={e => onSelect(nodeId, e.shiftKey || e.metaKey)}
      onMouseEnter={() => onHover(nodeId)}
      onMouseLeave={() => onHover(null)}
      onDoubleClick={startEdit}
      onContextMenu={e => { e.preventDefault(); onContextMenu(nodeId, e.clientX, e.clientY); }}
      onDragStart={e => {
        e.dataTransfer.setData(LAYER_DRAG_KEY, nodeId);
        e.dataTransfer.effectAllowed = 'move';
        onLayerDragStart(nodeId);
      }}
      onDragOver={e => {
        if (!e.dataTransfer.types.includes(LAYER_DRAG_KEY)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        // For containers: top-third = above, middle = inside, bottom-third = below.
        // For leaf nodes: top-half = above, bottom-half = below.
        let pos: 'above' | 'inside' | 'below';
        if (isContainer) {
          pos = relY < 0.33 ? 'above' : relY < 0.67 ? 'inside' : 'below';
        } else {
          pos = relY < 0.5 ? 'above' : 'below';
        }
        onLayerDragOver(nodeId, pos);
      }}
      onDrop={e => {
        e.preventDefault();
        onLayerDrop();
      }}
      onDragEnd={() => onLayerDrop()}
    >
      {/* Expand chevron */}
      <span
        style={{ width: 16, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={e => { e.stopPropagation(); if (hasChildren) onToggleExpand(nodeId); }}
      >
        {hasChildren ? <Chevron open={isExpanded} size={8} color="#6b7280" /> : null}
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
            style={{ background: '#111827', border: '1px solid #3b82f6', borderRadius: 2, color: '#f3f4f6', fontSize: 10, padding: '0 4px', width: '100%' }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            style={{ fontSize: 10, color: isSelected ? '#fff' : '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
            title={`${displayLabel}  [${nodeId}]`}
          >
            {displayLabel}
          </span>
        )}
      </span>

      {/* SDUI badges — icon-only at rest, labeled when hovered/selected */}
      {badges.map(b => (
        <span
          key={b.key}
          title={b.title}
          style={{
            fontSize: 8,
            background: b.bg,
            color: b.color,
            borderRadius: 2,
            padding: '0 3px',
            marginLeft: 1,
            flexShrink: 0,
            border: `1px solid ${b.color}40`,
            lineHeight: '13px',
            cursor: 'default',
            whiteSpace: 'nowrap',
          }}
        >
          {isHovered || isSelected ? b.label : b.icon}
        </span>
      ))}

      {/* Visibility — only shown when hidden (always) or hovered */}
      {isHidden && (
        <span
          style={{ fontSize: 9, opacity: 0.7, marginLeft: 2, cursor: 'pointer', flexShrink: 0, color: '#f87171', lineHeight: 1 }}
          onClick={e => { e.stopPropagation(); onToggleVisibility(nodeId); }}
          title="Show"
        >
          ⊘
        </span>
      )}
      {/* Lock — only shown when locked */}
      {isLocked && (
        <span
          style={{ fontSize: 9, opacity: 0.7, marginLeft: 1, cursor: 'pointer', flexShrink: 0, color: '#fbbf24', lineHeight: 1 }}
          onClick={e => { e.stopPropagation(); onToggleLock(nodeId); }}
          title="Unlock"
        >
          ⊠
        </span>
      )}
    </div>
  );
});

// ─── Recursive layer tree ─────────────────────────────────────────────────────

export function LayerTree({
  nodes,
  depth = 0,
  store,
  contextMenuHandlers,
  dragState,
  onLayerDragStart,
  onLayerDragOver,
  onLayerDrop,
}: {
  nodes: SDUINode[];
  depth?: number;
  store: BuilderStore;
  contextMenuHandlers: { show: (id: string, x: number, y: number) => void };
  dragState: LayerDragState;
  onLayerDragStart: (id: string) => void;
  onLayerDragOver: (id: string, pos: 'above' | 'inside' | 'below') => void;
  onLayerDrop: () => void;
}) {
  if (!nodes?.length) return null;

  return (
    <>
      {nodes.map(node => {
        const nodeId = (node as { id?: string }).id ?? node.type;
        const allChildren = (node.children ?? []) as SDUINode[];
        const hasChildren = allChildren.length > 0;
        const isExpanded = store.expandedIds.has(nodeId);
        const isContainer = LAYER_CONTAINER_TYPES.has(node.type) || hasChildren;
        const isDragOverAbove  = dragState.dropTargetId === nodeId && dragState.dropPosition === 'above';
        const isDragOverBelow  = dragState.dropTargetId === nodeId && dragState.dropPosition === 'below';
        const isDragOverInside = dragState.dropTargetId === nodeId && dragState.dropPosition === 'inside';

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
              isContainer={isContainer}
              isDragOverAbove={isDragOverAbove}
              isDragOverBelow={isDragOverBelow}
              isDragOverInside={isDragOverInside}
              onSelect={store.select}
              onHover={store.hover}
              onToggleExpand={store.toggleExpanded}
              onContextMenu={contextMenuHandlers.show}
              onRename={(id, newName) => store.patchNodeField(id, 'name', newName || undefined)}
              onToggleVisibility={store.toggleVisibility}
              onToggleLock={store.toggleLock}
              onLayerDragStart={onLayerDragStart}
              onLayerDragOver={onLayerDragOver}
              onLayerDrop={onLayerDrop}
            />
            {hasChildren && isExpanded && (
              <LayerTree
                nodes={allChildren}
                depth={depth + 1}
                store={store}
                contextMenuHandlers={contextMenuHandlers}
                dragState={dragState}
                onLayerDragStart={onLayerDragStart}
                onLayerDragOver={onLayerDragOver}
                onLayerDrop={onLayerDrop}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}
