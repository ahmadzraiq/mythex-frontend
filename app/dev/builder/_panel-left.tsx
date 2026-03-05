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

import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';

function Chevron({ open, size = 10, color = '#6b7280' }: { open?: boolean; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
import { useBuilderStore, findParentNode, findNode } from './_store';
import type { BuilderStore, BuilderPage, CustomVar, PageMeta } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import routes from '@/config/routes.json';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import app from '@/config/app';
import { ExprBuilder } from './_expr-builder';
import { ActionBuilder } from './_action-builder';
import { DataTab, type DataTabSlideState } from './_data-tab';
import { LogicTab, type LogicSlideState } from './_logic-tab';

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

// ─── Layer drag state (shared across the whole tree) ─────────────────────────

// Container types that can receive children in the layers panel
// Keep in sync with isContainer in _panel-right.tsx and CONTAINER_TYPES in _canvas.tsx
const LAYER_CONTAINER_TYPES = new Set([
  'Box', 'VStack', 'HStack', 'Center', 'Grid', 'GridItem',
  'ScrollView', 'View', 'Card', 'SafeAreaView', 'Pressable',
  'Checkbox', 'CheckboxGroup', 'Radio', 'RadioGroup',
  'Badge', 'Avatar', 'Fab', 'Skeleton', 'Alert', 'Link',
  'Modal', 'ModalContent', 'ModalHeader', 'ModalBody', 'ModalFooter',
  'Tooltip', 'AlertDialog', 'AlertDialogContent',
  'AlertDialogHeader', 'AlertDialogBody', 'AlertDialogFooter',
  'FormContainer',
]);

interface LayerDragState {
  dragId: string | null;
  /** ID of the row currently under the cursor */
  dropTargetId: string | null;
  /** 'above' = insert before, 'inside' = nest into container, 'below' = insert after */
  dropPosition: 'above' | 'inside' | 'below';
}

const LAYER_DRAG_KEY = 'text/layer-node-id';

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

const LayerRow = memo(function LayerRow({
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
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(nodeId);
  const inputRef = useRef<HTMLInputElement>(null);

  // Enriched badges with count + tooltip preview
  type BadgeInfo = { key: string; label: string; color: string; bg: string; title: string };
  const badges: BadgeInfo[] = [];

  const condition = (node as { condition?: unknown }).condition;
  if (condition != null) {
    const preview = JSON.stringify(condition);
    const short = preview.length > 40 ? preview.slice(0, 38) + '…' : preview;
    badges.push({ key: 'if', label: 'if', color: '#60a5fa', bg: '#1e3a5f', title: `Condition: ${short}` });
  }

  const mapPath = (node as { map?: unknown }).map;
  if (mapPath != null) {
    const mapLabel = typeof mapPath === 'string'
      ? (mapPath.split('.').pop() ?? mapPath)
      : typeof mapPath === 'object'
        ? JSON.stringify(mapPath).slice(0, 30)
        : String(mapPath);
    const mapTitle = typeof mapPath === 'string' ? mapPath : JSON.stringify(mapPath);
    badges.push({ key: 'map', label: `⟳ ${mapLabel}`, color: '#c084fc', bg: '#2e1065', title: `Repeat over: ${mapTitle}` });
  }

  const nodeActions = (node as { actions?: Record<string, unknown> }).actions;
  if (nodeActions != null) {
    const eventCount = Object.keys(nodeActions).length;
    const preview = Object.keys(nodeActions).join(', ');
    badges.push({ key: 'act', label: `⚡ ${eventCount}`, color: '#818cf8', bg: '#1e1b4b', title: `Events: ${preview}` });
  }

  const ds = (node as { dataSource?: unknown }).dataSource;
  if (ds != null) {
    badges.push({ key: 'ds', label: '↓', color: '#34d399', bg: '#022c22', title: 'Has data source' });
  }

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
      data-layer-row
      data-node-id={nodeId}
      data-node-type={node.type}
      draggable
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        paddingLeft: 8 + depth * 14,
        paddingRight: 4,
        height: 28,
        background: bg,
        cursor: 'grab',
        opacity: isHidden ? 0.4 : 1,
        userSelect: 'none',
        borderRadius: 3,
        margin: '1px 4px',
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
      {/* Expand chevron — bigger, easier to click */}
      <span
        style={{ width: 14, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={e => { e.stopPropagation(); if (hasChildren) onToggleExpand(nodeId); }}
      >
        {hasChildren ? <Chevron open={isExpanded} size={10} color="#9ca3af" /> : null}
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
          <span style={{ fontSize: 11, color: isSelected ? '#fff' : '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {nodeId}
          </span>
        )}
      </span>

      {/* SDUI badges — enriched with counts and tooltips */}
      {badges.map(b => (
        <span
          key={b.key}
          title={b.title}
          style={{
            fontSize: 9,
            background: b.bg,
            color: b.color,
            borderRadius: 3,
            padding: '0 4px',
            marginLeft: 2,
            flexShrink: 0,
            border: `1px solid ${b.color}40`,
            lineHeight: '14px',
            cursor: 'default',
            maxWidth: 52,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {b.label}
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
});

// ─── Recursive layer tree ─────────────────────────────────────────────────────

function LayerTree({
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
        const children = node.children as SDUINode[] | undefined;
        const hasChildren = !!(children?.length);
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
              onRename={store.renameNode}
              onToggleVisibility={store.toggleVisibility}
              onToggleLock={store.toggleLock}
              onLayerDragStart={onLayerDragStart}
              onLayerDragOver={onLayerDragOver}
              onLayerDrop={onLayerDrop}
            />
            {hasChildren && isExpanded && (
              <LayerTree
                nodes={children!}
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

// ─── Primitive components registry ───────────────────────────────────────────

const PRIMITIVE_COMPONENTS: Record<string, { type: string; label: string; icon: string; defaultNode: object }[]> = {
  Layout: [
    { type: 'Box',    label: 'Box',    icon: '□', defaultNode: { type: 'Box',    props: { className: 'flex flex-col p-4 gap-4 w-full min-h-[80px]' } } },
    { type: 'Box',    label: 'Row',    icon: '⬌', defaultNode: { type: 'Box',    props: { className: 'flex flex-row gap-4 p-4 w-full min-h-[60px] items-center' } } },
    { type: 'VStack', label: 'VStack', icon: '⬇', defaultNode: { type: 'VStack', props: { className: 'flex flex-col gap-4 p-4 w-full min-h-[80px]' } } },
    { type: 'HStack', label: 'HStack', icon: '➡', defaultNode: { type: 'HStack', props: { className: 'flex flex-row gap-4 p-4 w-full min-h-[60px] items-center' } } },
    // Center — horizontally & vertically centers children
    { type: 'Center', label: 'Center', icon: '⊕', defaultNode: { type: 'Center', props: { className: 'flex flex-col items-center justify-center p-4 w-full min-h-[60px]' } } },
    // Grid — CSS grid container; children are GridItems
    { type: 'Grid',   label: 'Grid',   icon: '⊞', defaultNode: { type: 'Grid', props: { className: 'grid grid-cols-2 gap-4 w-full min-h-[60px]' } } },
    // Card — bordered surface container
    { type: 'Card',   label: 'Card',   icon: '▣', defaultNode: { type: 'Card', props: { className: 'rounded-lg border border-border bg-card p-4 w-full flex flex-col gap-2' }, children: [{ type: 'Heading', text: 'Card Title', props: { className: 'text-lg font-semibold text-foreground' } }, { type: 'Text', text: 'Card content goes here.', props: { className: 'text-sm text-muted-foreground' } }] } },
    // Divider — horizontal rule
    { type: 'Box',    label: 'Divider', icon: '—', defaultNode: { type: 'Box', props: { className: 'w-full h-px bg-border' } } },
    // ScrollView — scrollable container (overflow-auto)
    { type: 'Box',    label: 'ScrollView', icon: '↕', defaultNode: { type: 'Box', props: { className: 'flex flex-col gap-4 overflow-auto w-full', style: { maxHeight: '200px' } }, children: [{ type: 'Text', text: 'Scroll content here', props: { className: 'text-sm text-foreground' } }] } },
  ],
  Typography: [
    { type: 'Text',    label: 'Text',    icon: 'T', defaultNode: { type: 'Text',    text: 'Text block', props: { className: 'text-base text-foreground' } } },
    { type: 'Heading', label: 'Heading', icon: 'H', defaultNode: { type: 'Heading', text: 'Heading',    props: { className: 'text-2xl font-bold text-foreground' } } },
    { type: 'Text',    label: 'Label',   icon: 'L', defaultNode: { type: 'Text',    text: 'Label',      props: { className: 'text-sm font-medium text-foreground' } } },
    { type: 'Text',    label: 'Caption', icon: 'C', defaultNode: { type: 'Text',    text: 'Caption',    props: { className: 'text-xs text-muted-foreground' } } },
    // Navigable link text
    { type: 'Link',    label: 'Link',    icon: '🔗', defaultNode: { type: 'Link', props: { href: '#' }, children: [{ type: 'LinkText', text: 'Link text', props: { className: 'text-sm text-primary underline' } }] } },
  ],
  Buttons: [
    // Solid — primary fill
    { type: 'Pressable', label: 'Btn Solid',       icon: '◼', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Button' }] } },
    // Destructive — danger fill
    { type: 'Pressable', label: 'Btn Destructive', icon: '⛔', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md bg-destructive' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-destructive-foreground' }, text: 'Delete' }] } },
    // Outline — border only
    { type: 'Pressable', label: 'Btn Outline',     icon: '◻', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md border border-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary' }, text: 'Button' }] } },
    // Ghost — no bg, no border
    { type: 'Pressable', label: 'Btn Ghost',       icon: '○', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center px-5 py-2.5 rounded-md' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary' }, text: 'Button' }] } },
    // Icon + Text (left icon)
    { type: 'Pressable', label: 'Btn + Icon L',    icon: '◀', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'NavIcon', props: { icon: 'Star', size: 16, color: '#ffffff' } }, { type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Button' }] } },
    // Text + Icon (right icon)
    { type: 'Pressable', label: 'Btn + Icon R',    icon: '▶', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Button' }, { type: 'NavIcon', props: { icon: 'ArrowRight', size: 16, color: '#ffffff' } }] } },
    // Icon only — square
    { type: 'Pressable', label: 'Icon Btn',        icon: '⬚', defaultNode: { type: 'Pressable', props: { className: 'flex items-center justify-center w-10 h-10 rounded-md bg-primary' }, children: [{ type: 'NavIcon', props: { icon: 'Star', size: 18, color: '#ffffff' } }] } },
    // Icon only — circular
    { type: 'Pressable', label: 'Icon Btn Round',  icon: '◉', defaultNode: { type: 'Pressable', props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-primary' }, children: [{ type: 'NavIcon', props: { icon: 'Star', size: 18, color: '#ffffff' } }] } },
    // Link-style
    { type: 'Pressable', label: 'Link Btn',        icon: '⇒', defaultNode: { type: 'Pressable', props: { className: 'flex flex-row items-center gap-1' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary underline' }, text: 'Learn more' }, { type: 'NavIcon', props: { icon: 'ArrowRight', size: 14, color: 'currentColor' } }] } },
    // Bare Pressable
    { type: 'Pressable', label: 'Pressable',       icon: '●', defaultNode: { type: 'Pressable', props: { className: 'px-4 py-2 items-center justify-center' }, children: [{ type: 'Text', text: 'Press me' }] } },
    // Floating Action Button — use NavIcon directly (FabIcon wraps Gluestack UIIcon which needs `as` prop, not children)
    { type: 'Fab',       label: 'FAB',             icon: '⊕', defaultNode: { type: 'Fab', props: { className: 'flex flex-row items-center justify-center gap-2 px-5 py-3 rounded-full bg-primary shadow-lg' }, children: [{ type: 'NavIcon', props: { icon: 'Plus', size: 20, color: '#ffffff' } }, { type: 'FabLabel', text: 'Add', props: { className: 'text-sm font-medium text-primary-foreground' } }] } },
  ],
  Form: [
    // FormContainer — wraps inputs and binds to a form variable UUID
    {
      type: 'FormContainer',
      label: 'Form',
      icon: '⊞',
      defaultNode: {
        type: 'FormContainer',
        props: {
          formId: '',
          className: 'flex flex-col gap-4 w-full',
        },
        children: [
          { type: 'Text', props: { className: 'text-sm text-gray-500' }, text: 'Drop inputs here. Set formId to a form variable UUID.' },
        ],
      },
    },
    // Input — plain text
    { type: 'Input',    label: 'Input',       icon: '▭', defaultNode: { type: 'Input', props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-border !bg-background' }, children: [{ type: 'InputField', props: { placeholder: 'Enter text…', className: '!text-foreground' } }] } },
    // Input with leading search icon
    { type: 'Input',    label: 'Input Search', icon: '🔍', defaultNode: { type: 'Input', props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-border !bg-background' }, children: [{ type: 'InputSlot', props: { className: 'pl-3 pointer-events-none' }, children: [{ type: 'NavIcon', props: { icon: 'Search', size: 16, color: '#9ca3af' } }] }, { type: 'InputField', props: { placeholder: 'Search…', className: '!text-foreground' } }] } },
    // Textarea — must include TextareaInput child to render the actual <textarea> element
    { type: 'Textarea', label: 'Textarea',    icon: '≡', defaultNode: { type: 'Textarea', props: { className: 'w-full !rounded-md !border-border !bg-background' }, children: [{ type: 'TextareaInput', props: { placeholder: 'Enter text…', className: '!text-foreground' } }] } },
    // Select — dropdown picker (Gluestack compound)
    { type: 'Select',   label: 'Select',      icon: '▽', defaultNode: { type: 'Select', props: {}, children: [{ type: 'SelectTrigger', props: { className: 'flex flex-row items-center justify-between px-3 py-2 rounded-md border border-border bg-background' }, children: [{ type: 'SelectInput', props: { placeholder: 'Select option…', className: '!text-foreground' } }, { type: 'SelectIcon', children: [{ type: 'NavIcon', props: { icon: 'ChevronDown', size: 16, color: '#6b7280' } }] }] }, { type: 'SelectPortal', children: [{ type: 'SelectBackdrop' }, { type: 'SelectContent', children: [{ type: 'SelectItem', props: { label: 'Option 1', value: 'option1' } }, { type: 'SelectItem', props: { label: 'Option 2', value: 'option2' } }] }] }] } },
    // Slider — range input (Gluestack compound)
    { type: 'Slider',   label: 'Slider',      icon: '⊸', defaultNode: { type: 'Slider', props: { defaultValue: 50, minValue: 0, maxValue: 100, className: 'w-full' }, children: [{ type: 'SliderTrack', children: [{ type: 'SliderFilledTrack' }] }, { type: 'SliderThumb' }] } },
    // RadioGroup — always wrap Radio items in a group to provide required context (standalone Radio crashes)
    { type: 'RadioGroup', label: 'Radio',       icon: '◎', defaultNode: { type: 'RadioGroup', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Radio', props: { value: 'option' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option' }] }] } },
    // RadioGroup — mutually exclusive radio options
    { type: 'RadioGroup', label: 'Radio Group', icon: '⊙', defaultNode: { type: 'RadioGroup', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Radio', props: { value: 'a' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option A' }] }, { type: 'Radio', props: { value: 'b' }, children: [{ type: 'RadioIndicator' }, { type: 'RadioLabel', text: 'Option B' }] }] } },
    // Progress — progress bar (Gluestack compound)
    { type: 'Progress', label: 'Progress',    icon: '▬', defaultNode: { type: 'Progress', props: { value: 60, className: 'w-full h-2 rounded-full bg-muted' }, children: [{ type: 'ProgressFilledTrack', props: { className: 'h-full rounded-full bg-primary' } }] } },
    // Toggle — primitive Pressable (track) + Box (thumb); both parts selectable and fully styleable
    {
      type: 'Pressable',
      label: 'Toggle',
      icon: '⏻',
      defaultNode: {
        type: 'Pressable',
        props: { className: 'relative w-12 h-6 rounded-full bg-gray-300 justify-center px-0.5' },
        children: [
          { type: 'Box', props: { className: 'w-5 h-5 rounded-full bg-white shadow-sm' } },
        ],
      },
    },
    { type: 'Checkbox', label: 'Checkbox',    icon: '☑', defaultNode: { type: 'Checkbox', props: { defaultIsChecked: false }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Label' }] } },
    // CheckboxGroup — group of related checkboxes
    { type: 'CheckboxGroup', label: 'Checkbox Group', icon: '☑☑', defaultNode: { type: 'CheckboxGroup', props: { className: 'flex flex-col gap-3' }, children: [{ type: 'Checkbox', props: { value: 'a' }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Option A' }] }, { type: 'Checkbox', props: { value: 'b' }, children: [{ type: 'CheckboxIndicator', children: [{ type: 'CheckboxIcon' }] }, { type: 'CheckboxLabel', text: 'Option B' }] }] } },
    // Switch — primitive: Pressable track + Box thumb (fully selectable/styleable)
    {
      type: 'Pressable',
      label: 'Switch',
      icon: '⏵',
      defaultNode: {
        type: 'Pressable',
        props: { className: 'relative w-12 h-6 rounded-full bg-gray-300 justify-center' },
        children: [
          { type: 'Box', props: { className: 'absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm' } },
        ],
      },
    },
    // Switch (on) — same but in active state
    {
      type: 'Pressable',
      label: 'Switch On',
      icon: '⏸',
      defaultNode: {
        type: 'Pressable',
        props: { className: 'relative w-12 h-6 rounded-full bg-primary justify-center' },
        children: [
          { type: 'Box', props: { className: 'absolute right-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-sm' } },
        ],
      },
    },
  ],
  Composite: [
    // Chip — removable tag with X button
    {
      type: 'Pressable',
      label: 'Chip',
      icon: '⬡',
      defaultNode: {
        type: 'Pressable',
        props: { className: 'flex flex-row items-center gap-1 px-3 py-1 rounded-full bg-secondary' },
        children: [
          { type: 'Text', props: { className: 'text-sm font-medium text-secondary-foreground' }, text: 'Label' },
          { type: 'NavIcon', props: { icon: 'X', size: 12, color: '#6b7280' } },
        ],
      },
    },
    // Chip (static) — no remove button
    {
      type: 'Box',
      label: 'Tag',
      icon: '🏷',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center px-3 py-1 rounded-full bg-muted' },
        children: [{ type: 'Text', props: { className: 'text-xs font-medium text-foreground' }, text: 'Tag' }],
      },
    },
    // Tabs — HStack tab strip + content area (all primitive)
    {
      type: 'Box',
      label: 'Tabs',
      icon: '⬜',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-col w-full gap-0' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row border-b border-border' },
            children: [
              { type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary' }, text: 'Tab 1' }] },
              { type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-muted-foreground' }, text: 'Tab 2' }] },
              { type: 'Pressable', props: { className: 'px-4 py-2 border-b-2 border-transparent' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-muted-foreground' }, text: 'Tab 3' }] },
            ],
          },
          { type: 'Box', props: { className: 'p-4 w-full' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Tab 1 content goes here.' }] },
        ],
      },
    },
    // Stepper — step progress indicator
    {
      type: 'Box',
      label: 'Stepper',
      icon: '①',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center w-full' },
        children: [
          { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-primary-foreground' }, text: '1' }] }, { type: 'Text', props: { className: 'text-xs text-primary' }, text: 'Step 1' }] },
          { type: 'Box', props: { className: 'flex-1 h-px bg-primary mx-2' } },
          { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-primary-foreground' }, text: '2' }] }, { type: 'Text', props: { className: 'text-xs text-primary' }, text: 'Step 2' }] },
          { type: 'Box', props: { className: 'flex-1 h-px bg-border mx-2' } },
          { type: 'Box', props: { className: 'flex flex-col items-center gap-1' }, children: [{ type: 'Box', props: { className: 'w-8 h-8 rounded-full border-2 border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-bold text-muted-foreground' }, text: '3' }] }, { type: 'Text', props: { className: 'text-xs text-muted-foreground' }, text: 'Step 3' }] },
        ],
      },
    },
    // Pagination bar — prev/next + page numbers
    {
      type: 'Box',
      label: 'Pagination',
      icon: '⟨⟩',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row gap-1 items-center' },
        children: [
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'NavIcon', props: { icon: 'ChevronLeft', size: 14, color: '#6b7280' } }] },
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md bg-primary flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: '1' }] },
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: '2' }] },
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: '3' }] },
          { type: 'Pressable', props: { className: 'w-8 h-8 rounded-md border border-border flex items-center justify-center' }, children: [{ type: 'NavIcon', props: { icon: 'ChevronRight', size: 14, color: '#6b7280' } }] },
        ],
      },
    },
    // Star Rating — 5 star icons
    {
      type: 'Box',
      label: 'Star Rating',
      icon: '★',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row gap-1 items-center' },
        children: [
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#f59e0b' } },
          { type: 'NavIcon', props: { icon: 'Star', size: 20, color: '#d1d5db' } },
        ],
      },
    },
    // Breadcrumbs — nav path
    {
      type: 'Box',
      label: 'Breadcrumbs',
      icon: '›',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center gap-1' },
        children: [
          { type: 'Text', props: { className: 'text-sm text-primary' }, text: 'Home' },
          { type: 'NavIcon', props: { icon: 'ChevronRight', size: 14, color: '#9ca3af' } },
          { type: 'Text', props: { className: 'text-sm text-primary' }, text: 'Category' },
          { type: 'NavIcon', props: { icon: 'ChevronRight', size: 14, color: '#9ca3af' } },
          { type: 'Text', props: { className: 'text-sm text-foreground font-medium' }, text: 'Page' },
        ],
      },
    },
    // Accordion (primitive) — collapsible section
    {
      type: 'Box',
      label: 'Accordion',
      icon: '▾',
      defaultNode: {
        type: 'Box',
        props: { className: 'w-full border border-border rounded-md overflow-hidden' },
        children: [
          {
            type: 'Pressable',
            props: { className: 'flex flex-row items-center justify-between p-4 bg-background' },
            children: [
              { type: 'Text', props: { className: 'text-sm font-medium text-foreground' }, text: 'Section Title' },
              { type: 'NavIcon', props: { icon: 'ChevronDown', size: 16, color: '#6b7280' } },
            ],
          },
          { type: 'Box', props: { className: 'p-4 bg-muted border-t border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Accordion content goes here.' }] },
        ],
      },
    },
    // Table (primitive) — flex-based rows
    {
      type: 'Box',
      label: 'Table',
      icon: '⊞',
      defaultNode: {
        type: 'Box',
        props: { className: 'w-full overflow-hidden rounded-md border border-border' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex flex-row bg-muted' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-foreground uppercase' }, text: 'Name' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-foreground uppercase' }, text: 'Status' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-xs font-semibold text-foreground uppercase' }, text: 'Amount' }] },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row border-t border-border' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Alice' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-green-600' }, text: 'Active' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: '$120' }] },
            ],
          },
          {
            type: 'Box',
            props: { className: 'flex flex-row border-t border-border' },
            children: [
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Bob' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2 border-r border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-yellow-600' }, text: 'Pending' }] },
              { type: 'Box', props: { className: 'flex-1 px-3 py-2' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: '$85' }] },
            ],
          },
        ],
      },
    },
    // Autocomplete — Input + dropdown options (fully primitive)
    {
      type: 'Box',
      label: 'Autocomplete',
      icon: '⌕',
      defaultNode: {
        type: 'Box',
        props: { className: 'relative flex flex-col w-full' },
        children: [
          { type: 'Input', props: { variant: 'outline', size: 'md', className: 'w-full !rounded-md !border-border !bg-background' }, children: [{ type: 'InputSlot', props: { className: 'pl-3 pointer-events-none' }, children: [{ type: 'NavIcon', props: { icon: 'Search', size: 16, color: '#9ca3af' } }] }, { type: 'InputField', props: { placeholder: 'Search…', className: '!text-foreground' } }] },
          {
            type: 'Box',
            props: { className: 'absolute top-full left-0 right-0 z-50 bg-background border border-border rounded-md shadow-md mt-1 overflow-hidden' },
            children: [
              { type: 'Pressable', props: { className: 'px-3 py-2 hover:bg-muted border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Option 1' }] },
              { type: 'Pressable', props: { className: 'px-3 py-2 hover:bg-muted border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Option 2' }] },
              { type: 'Pressable', props: { className: 'px-3 py-2 hover:bg-muted' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Option 3' }] },
            ],
          },
        ],
      },
    },
    // Notification / Snackbar — bottom alert bar
    {
      type: 'Box',
      label: 'Snackbar',
      icon: '🔔',
      defaultNode: {
        type: 'Box',
        props: { className: 'flex flex-row items-center justify-between gap-3 px-4 py-3 rounded-lg bg-gray-900 shadow-lg w-full max-w-sm' },
        children: [
          { type: 'NavIcon', props: { icon: 'CheckCircle', size: 18, color: '#4ade80' } },
          { type: 'Text', props: { className: 'flex-1 text-sm font-medium text-white' }, text: 'Action completed successfully.' },
          { type: 'Pressable', props: { className: 'ml-2' }, children: [{ type: 'NavIcon', props: { icon: 'X', size: 16, color: '#9ca3af' } }] },
        ],
      },
    },
  ],
  Media: [
    // NextImage used instead of Gluestack Image: supports forwardRef (data-builder-id), shows gray placeholder when no src, works with Next.js image optimization on web
    { type: 'NextImage', label: 'Image', icon: '🖼', defaultNode: { type: 'NextImage', props: { className: 'rounded-md', style: { width: '300px', height: '192px' } }, src: 'https://placehold.co/600x400' } },
    { type: 'NavIcon', label: 'Icon',     icon: '✦', defaultNode: { type: 'NavIcon', props: { icon: 'Star', size: 24, color: '#6b7280' } } },
    // Icon inside a tappable circle
    { type: 'Pressable', label: 'Icon Tap', icon: '⊙', defaultNode: { type: 'Pressable', props: { className: 'flex items-center justify-center w-10 h-10 rounded-full bg-secondary' }, children: [{ type: 'NavIcon', props: { icon: 'Star', size: 18, color: '#6b7280' } }] } },
  ],
  'Data & Media': [
    // DatePicker — native HTML date input wrapper
    { type: 'DatePicker',     label: 'Date Picker',     icon: '📅', defaultNode: { type: 'DatePicker',     props: { label: 'Date', style: { width: '220px' } } } },
    // TimePicker — native HTML time input wrapper
    { type: 'TimePicker',     label: 'Time Picker',     icon: '⏱', defaultNode: { type: 'TimePicker',     props: { label: 'Time', style: { width: '220px' } } } },
    // DateTimePicker — native HTML datetime-local input wrapper
    { type: 'DateTimePicker', label: 'Date & Time',     icon: '📆', defaultNode: { type: 'DateTimePicker', props: { label: 'Date & Time', style: { width: '260px' } } } },
    // ColorPicker — color swatch + native input[type=color]
    { type: 'ColorPicker',    label: 'Color Picker',    icon: '🎨', defaultNode: { type: 'ColorPicker',    props: { label: 'Color', value: '#6366f1', style: { width: '220px' } } } },
    // FileUpload — dashed drop zone + hidden file input
    { type: 'FileUpload',     label: 'File Upload',     icon: '📎', defaultNode: { type: 'FileUpload',     props: { label: 'Click or drag to upload', style: { width: '280px', minHeight: '120px' } } } },
    // Iframe — embedded web page with placeholder
    { type: 'Iframe',         label: 'Iframe',          icon: '⬜', defaultNode: { type: 'Iframe',         props: { title: 'Embedded', style: { width: '400px', height: '240px' } } } },
    // SvgViewer — dangerouslySetInnerHTML SVG display with placeholder
    { type: 'SvgViewer',      label: 'SVG Viewer',      icon: '⬡', defaultNode: { type: 'SvgViewer',      props: { style: { width: '120px', height: '120px' } } } },
    // JsonViewer — syntax-colored JSON pretty-printer
    { type: 'JsonViewer',     label: 'JSON Viewer',     icon: '{}', defaultNode: { type: 'JsonViewer',     props: { data: { name: 'Alice', age: 30, active: true }, style: { width: '320px' } } } },
    // Chart — recharts Line / Bar / Pie
    { type: 'Chart',          label: 'Chart',           icon: '📊', defaultNode: { type: 'Chart',          props: { chartType: 'bar', style: { width: '340px', height: '260px' } } } },
    // QR Code — qrcode.react SVG output
    { type: 'QRCodeWidget',   label: 'QR Code',         icon: '▦', defaultNode: { type: 'QRCodeWidget',   props: { value: 'https://example.com', size: 160 } } },
    // Markdown viewer — react-markdown with prose styling
    { type: 'MarkdownViewer', label: 'Markdown',        icon: 'M', defaultNode: { type: 'MarkdownViewer', props: { style: { width: '360px' } } } },
    // Google Map — embedded map (placeholder when no apiKey)
    { type: 'GoogleMap',      label: 'Google Map',      icon: '🗺', defaultNode: { type: 'GoogleMap',      props: { lat: 37.7749, lng: -122.4194, zoom: 13, style: { width: '400px', height: '280px' } } } },
    // Google Map Places — autocomplete input with Places API
    { type: 'GoogleMapPlaces', label: 'Places Search',  icon: '📍', defaultNode: { type: 'GoogleMapPlaces', props: { placeholder: 'Search for a place…', style: { width: '320px' } } } },
  ],
  Display: [
    { type: 'Badge',    label: 'Badge',    icon: '🏷', defaultNode: { type: 'Badge', props: { className: 'flex flex-row items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary' }, children: [{ type: 'BadgeText', props: { className: 'text-xs font-medium text-primary-foreground' }, text: 'Badge' }] } },
    { type: 'Avatar',   label: 'Avatar',   icon: '👤', defaultNode: { type: 'Avatar', props: { className: 'w-12 h-12 rounded-full' }, children: [{ type: 'AvatarFallbackText', text: 'AB', props: { className: 'text-sm font-medium text-primary-foreground' } }] } },
    // Spinner — animated loading indicator
    { type: 'Spinner',  label: 'Spinner',  icon: '↺', defaultNode: { type: 'Spinner', props: { size: 'small', color: '#6b7280' } } },
    // Skeleton — placeholder shimmer for loading states
    { type: 'Skeleton', label: 'Skeleton', icon: '░', defaultNode: { type: 'Skeleton', props: { className: 'rounded-md w-full' }, children: [{ type: 'SkeletonText', props: { _lines: 3, className: 'w-full' } }] } },
    // Alert — informational / warning callout — use NavIcon directly (AlertIcon wraps Gluestack UIIcon which needs `as` prop, not children)
    { type: 'Alert',    label: 'Alert',    icon: '⚠', defaultNode: { type: 'Alert', props: { className: 'flex flex-row items-start gap-3 p-4 rounded-md bg-amber-50 border border-amber-200' }, children: [{ type: 'NavIcon', props: { icon: 'AlertCircle', size: 18, color: '#d97706' } }, { type: 'AlertText', text: 'This is an alert message.', props: { className: 'text-sm text-amber-800' } }] } },
  ],
  Overlays: [
    // Modal — Gluestack portal-based overlay; isOpen must be true to render content in builder
    {
      type: 'Modal',
      label: 'Modal',
      icon: '⬜',
      defaultNode: {
        type: 'Modal',
        props: { isOpen: true, className: '' },
        children: [
          { type: 'ModalBackdrop', props: {} },
          {
            type: 'ModalContent',
            props: { className: 'rounded-lg bg-background p-0 w-full max-w-md' },
            children: [
              { type: 'ModalHeader', props: { className: 'p-4 border-b border-border flex flex-row items-center justify-between' }, children: [{ type: 'Text', props: { className: 'text-lg font-semibold text-foreground' }, text: 'Modal Title' }, { type: 'ModalCloseButton', props: {} }] },
              { type: 'ModalBody', props: { className: 'p-4' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Modal body content goes here.' }] },
              { type: 'ModalFooter', props: { className: 'p-4 border-t border-border flex flex-row gap-2 justify-end' }, children: [{ type: 'Pressable', props: { className: 'px-4 py-2 rounded-md border border-border' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Cancel' }] }, { type: 'Pressable', props: { className: 'px-4 py-2 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-primary-foreground' }, text: 'Confirm' }] }] },
            ],
          },
        ],
      },
    },
    // Tooltip — hover popup label
    {
      type: 'Tooltip',
      label: 'Tooltip',
      icon: '💬',
      defaultNode: {
        type: 'Tooltip',
        props: { isOpen: true, placement: 'top' },
        children: [
          { type: 'Pressable', props: { className: 'px-4 py-2 rounded-md bg-primary' }, children: [{ type: 'Text', props: { className: 'text-sm text-primary-foreground' }, text: 'Hover me' }] },
          { type: 'TooltipContent', props: { className: 'bg-gray-900 rounded px-2 py-1' }, children: [{ type: 'TooltipText', props: { className: 'text-xs text-white' }, text: 'Tooltip text' }] },
        ],
      },
    },
    // AlertDialog — confirmation dialog with portal
    {
      type: 'AlertDialog',
      label: 'Alert Dialog',
      icon: '⚠',
      defaultNode: {
        type: 'AlertDialog',
        props: { isOpen: true },
        children: [
          { type: 'AlertDialogBackdrop', props: {} },
          {
            type: 'AlertDialogContent',
            props: { className: 'rounded-lg bg-background w-full max-w-sm p-0' },
            children: [
              { type: 'AlertDialogHeader', props: { className: 'p-4 border-b border-border' }, children: [{ type: 'Text', props: { className: 'text-lg font-semibold text-foreground' }, text: 'Confirm Action' }] },
              { type: 'AlertDialogBody', props: { className: 'p-4' }, children: [{ type: 'Text', props: { className: 'text-sm text-foreground' }, text: 'Are you sure you want to continue?' }] },
              { type: 'AlertDialogFooter', props: { className: 'p-4 border-t border-border flex flex-row gap-2 justify-end' }, children: [{ type: 'Pressable', props: { className: 'px-4 py-2 rounded-md border border-border' }, children: [{ type: 'Text', props: { className: 'text-sm' }, text: 'Cancel' }] }, { type: 'Pressable', props: { className: 'px-4 py-2 rounded-md bg-destructive' }, children: [{ type: 'Text', props: { className: 'text-sm font-medium text-white' }, text: 'Delete' }] }] },
            ],
          },
        ],
      },
    },
  ],
};

// ─── Components tab ───────────────────────────────────────────────────────────

function ComponentsTab() {
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

function SectionHeader({ label, collapsible, collapsed, onToggle }: { label: string; collapsible?: boolean; collapsed?: boolean; onToggle?: () => void }) {
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

function DraggablePrimitive({ primitive }: { primitive: { type: string; label: string; icon: string; defaultNode: object } }) {
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

// ─── Pages Tab ────────────────────────────────────────────────────────────────

function PagesTab() {
  const { pages, currentPageId, addPage, navigatePage, renamePage, removePage } = useBuilderStore();
  const [showRouteMenu, setShowRouteMenu] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [customRoute, setCustomRoute] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Close route picker on outside click
  useEffect(() => {
    if (!showRouteMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowRouteMenu(false);
        setCustomRoute('');
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [showRouteMenu]);

  const allRoutes = (routes as { routes: Array<{ path: string; config: string }> }).routes;

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      renamePage(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, renamePage]);

  const handleAddCustomRoute = useCallback(() => {
    const r = customRoute.trim();
    if (!r) return;
    const path = r.startsWith('/') ? r : `/${r}`;
    // If this route already exists, navigate to it instead of adding a duplicate
    const existing = pages.find((p: BuilderPage) => p.route === path);
    if (existing) {
      navigatePage(existing.id);
    } else {
      addPage(path, path);
    }
    setCustomRoute('');
    setShowRouteMenu(false);
  }, [customRoute, pages, addPage, navigatePage]);

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Page list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
        {pages.map((page: BuilderPage) => {
          const isActive = page.id === currentPageId;
          const isRenaming = renamingId === page.id;
          return (
            <div
              key={page.id}
              data-testid={`page-row-${page.id}`}
              onClick={() => !isRenaming && navigatePage(page.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                cursor: 'pointer',
                background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
                borderLeft: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                borderRadius: 4,
                margin: '1px 6px',
                userSelect: 'none',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              {/* Page icon */}
              <span style={{ fontSize: 13, flexShrink: 0, opacity: 0.6 }}>📄</span>

              {/* Name / rename input */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                      e.stopPropagation();
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: '100%',
                      background: '#1f2937',
                      border: '1px solid #3b82f6',
                      borderRadius: 3,
                      color: '#f3f4f6',
                      fontSize: 11,
                      padding: '1px 5px',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <>
                    <div style={{
                      fontSize: 11,
                      color: isActive ? '#f3f4f6' : '#d1d5db',
                      fontWeight: isActive ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    onDoubleClick={e => {
                      e.stopPropagation();
                      setRenamingId(page.id);
                      setRenameValue(page.name);
                    }}
                    >
                      {page.name}
                    </div>
                    {page.route && (
                    <div style={{ fontSize: 9, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {page.route}
                    </div>
                    )}
                  </>
                )}
              </div>

              {/* Delete button — only show when >1 page */}
              {pages.length > 1 && !isRenaming && (
                <button
                  title="Remove page"
                  onClick={e => { e.stopPropagation(); removePage(page.id); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#6b7280',
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: 1,
                    padding: '2px 4px',
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add page button + route picker */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid #1f2937', flexShrink: 0, position: 'relative' }} ref={menuRef}>
        <button
          data-testid="add-page-btn"
          onClick={() => setShowRouteMenu(v => !v)}
          style={{
            width: '100%',
            padding: '7px 0',
            background: showRouteMenu ? '#1d4ed8' : '#1f2937',
            border: `1px solid ${showRouteMenu ? '#3b82f6' : '#374151'}`,
            borderRadius: 5,
            color: '#d1d5db',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          Add page
        </button>

        {/* Route picker dropdown */}
        {showRouteMenu && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: 10,
            right: 10,
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 6,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
            zIndex: 9999,
            maxHeight: 300,
            overflow: 'hidden',
            marginBottom: 4,
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Custom route input */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #374151', flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 5, letterSpacing: '0.04em' }}>CUSTOM ROUTE</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  autoFocus
                  placeholder="/my-page"
                  value={customRoute}
                  onChange={e => setCustomRoute(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddCustomRoute();
                    if (e.key === 'Escape') { setShowRouteMenu(false); setCustomRoute(''); }
                    e.stopPropagation();
                  }}
                  style={{
                    flex: 1,
                    background: '#111827',
                    border: '1px solid #374151',
                    borderRadius: 4,
                    color: '#f3f4f6',
                    fontSize: 11,
                    padding: '4px 8px',
                    outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={handleAddCustomRoute}
                  disabled={!customRoute.trim()}
                  style={{
                    padding: '4px 10px',
                    background: customRoute.trim() ? '#1d4ed8' : '#374151',
                    border: 'none',
                    borderRadius: 4,
                    color: customRoute.trim() ? '#fff' : '#6b7280',
                    fontSize: 11,
                    cursor: customRoute.trim() ? 'pointer' : 'default',
                    fontFamily: 'system-ui',
                    flexShrink: 0,
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Predefined routes from routes.json */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ padding: '6px 10px 4px', fontSize: 10, color: '#6b7280', letterSpacing: '0.04em' }}>
                APP ROUTES
              </div>
              {allRoutes.map(r => {
                const alreadyAdded = pages.some((p: BuilderPage) => p.route === r.path);
                return (
                  <button
                    key={r.config}
                    disabled={alreadyAdded}
                    onClick={() => {
                      if (alreadyAdded) return;
                      addPage(r.path, r.config);
                      setShowRouteMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      width: '100%',
                      alignItems: 'baseline',
                      gap: 6,
                      padding: '6px 10px',
                      background: 'none',
                      border: 'none',
                      color: alreadyAdded ? '#4b5563' : '#d1d5db',
                      fontSize: 11,
                      textAlign: 'left',
                      cursor: alreadyAdded ? 'default' : 'pointer',
                      fontFamily: 'system-ui',
                    }}
                    onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; }}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: alreadyAdded ? '#374151' : '#60a5fa', flexShrink: 0 }}>
                      {r.path}
                    </span>
                    <span style={{ opacity: alreadyAdded ? 0.35 : 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.config}
                    </span>
                    {alreadyAdded && <span style={{ marginLeft: 'auto', fontSize: 9, color: '#374151', flexShrink: 0 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

// ─── App Panel (Store / Actions / Sources) ───────────────────────────────────

const ACTION_TYPE_COLORS: Record<string, string> = {
  graphql: '#818cf8',
  fetch: '#34d399',
  set: '#fbbf24',
  setVar: '#f9a8d4',
  validate: '#f87171',
  runMultiple: '#93c5fd',
  navigate: '#a78bfa',
  appendToPath: '#6ee7b7',
  toggle: '#fcd34d',
  default: '#6b7280',
};

function ActionTypeBadge({ type }: { type: string }) {
  const color = ACTION_TYPE_COLORS[type] ?? ACTION_TYPE_COLORS.default;
  return (
    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: color + '33', color, border: `1px solid ${color}55`, fontFamily: 'monospace', flexShrink: 0 }}>
      {type}
    </span>
  );
}

function StoreTab({ embedded = false }: { embedded?: boolean }) {
  const zustandData = useSduiStore(s => s.data);
  const [vsData, setVsData] = useState<Record<string, unknown>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    const vs = getGlobalVariableStore();
    setVsData(vs.getState().getFullState());
    return vs.subscribe(() => setVsData(vs.getState().getFullState()));
  }, []);

  // Build a merged nested-like snapshot from Zustand flat keys + VS nested
  const snapshot = useMemo(() => {
    const groups: Record<string, Record<string, unknown>> = {};
    // Zustand flat keys → group by top-level prefix
    for (const [k, v] of Object.entries(zustandData)) {
      const dot = k.indexOf('.');
      const group = dot >= 0 ? k.slice(0, dot) : k;
      const sub = dot >= 0 ? k.slice(dot + 1) : '__value__';
      if (!groups[group]) groups[group] = {};
      groups[group][sub] = v;
    }
    // VS nested keys
    for (const [k, v] of Object.entries(vsData)) {
      if (!groups[k]) groups[k] = {};
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        Object.assign(groups[k], v);
      } else {
        groups[k]['__value__'] = v;
      }
    }
    return groups;
  }, [zustandData, vsData]);

  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return snapshot;
    return Object.fromEntries(
      Object.entries(snapshot).filter(([k]) => k.toLowerCase().includes(q))
    );
  }, [snapshot, search]);

  const content = (
    <>
      <div style={{ padding: '4px 8px', flexShrink: 0 }}>
        <input
          placeholder="Filter by key…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, color: '#d1d5db', fontSize: 11, padding: '4px 8px', boxSizing: 'border-box' }}
        />
      </div>
      <div style={embedded ? { padding: '4px 0' } : { flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {Object.entries(filteredGroups).map(([group, values]) => (
          <div key={group}>
            <button
              onClick={() => setExpanded(p => ({ ...p, [group]: !p[group] }))}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#d1d5db', fontSize: 11 }}
            >
              <Chevron open={!!expanded[group]} size={10} />
              <span style={{ fontWeight: 600, color: '#e5e7eb' }}>{group}</span>
              <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto' }}>{Object.keys(values).length} key{Object.keys(values).length !== 1 ? 's' : ''}</span>
            </button>
            {expanded[group] && (
              <div style={{ paddingLeft: 20 }}>
                {Object.entries(values).map(([k, v]) => (
                  <div key={k} data-testid={`store-entry-${group}.${k}`} style={{ display: 'flex', gap: 8, padding: '2px 12px 2px 4px', borderBottom: '1px solid #1f293750' }}>
                    <span style={{ color: '#9ca3af', fontSize: 10, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, maxWidth: 90 }}>
                      {k === '__value__' ? group : `${group}.${k}`}
                    </span>
                    <span style={{ color: '#6ee7b7', fontSize: 10, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {JSON.stringify(v).slice(0, 60)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {Object.keys(filteredGroups).length === 0 && (
          <div style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 16 }}>No store data yet</div>
        )}
      </div>
    </>
  );

  if (embedded) return <div style={{ display: 'flex', flexDirection: 'column' }}>{content}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {content}
    </div>
  );
}

function ActionsTab() {
  const actions = app.actions as Record<string, { type: string }>;
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Group by detected prefix
  const groups = useMemo(() => {
    const g: Record<string, Array<[string, { type: string }]>> = {};
    for (const [name, def] of Object.entries(actions)) {
      const prefix = name.replace(/([A-Z])/g, ' $1').split(' ')[0].toLowerCase();
      if (!g[prefix]) g[prefix] = [];
      g[prefix].push([name, def]);
    }
    return g;
  }, [actions]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return groups;
    const out: typeof groups = {};
    for (const [grp, rows] of Object.entries(groups)) {
      const matching = rows.filter(([n]) => n.toLowerCase().includes(q));
      if (matching.length) out[grp] = matching;
    }
    return out;
  }, [groups, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '6px 8px', flexShrink: 0 }}>
        <input
          placeholder="Filter actions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, color: '#d1d5db', fontSize: 11, padding: '4px 8px', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #1f2937', fontSize: 10, color: '#4b5563', lineHeight: 1.6, flexShrink: 0 }}>
        Use named actions in Interactions → select "namedAction" and type the action name.
        Defined in <code style={{ color: '#818cf8' }}>config/actions/</code>.
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {Object.entries(filtered).map(([grp, rows]) => (
          <div key={grp}>
            <div style={{ padding: '3px 12px', fontSize: 10, color: '#6b7280', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', background: '#0f172a' }}>
              {grp}
            </div>
            {rows.map(([name, def]) => (
              <div key={name}>
                <button
                  data-testid={`action-row-${name}`}
                  onClick={() => setExpanded(p => ({ ...p, [name]: !p[name] }))}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid #1f2937' }}
                >
                  <span style={{ color: '#d1d5db', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <ActionTypeBadge type={def.type} />
                  <Chevron open={!!expanded[name]} size={10} />
                </button>
                {expanded[name] && (
                  <pre style={{ margin: 0, padding: '6px 16px', background: '#0f172a', color: '#9ca3af', fontSize: 10, fontFamily: 'monospace', overflow: 'auto', maxHeight: 120 }}>
                    {JSON.stringify(def, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ))}
        {Object.keys(filtered).length === 0 && (
          <div style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 24 }}>No actions match</div>
        )}
      </div>
    </div>
  );
}

function SourcesTab() {
  const actions = app.actions as Record<string, { type: string; url?: string; method?: string; query?: string; endpoint?: string }>;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sources = useMemo(() =>
    Object.entries(actions).filter(([, def]) => def.type === 'graphql' || def.type === 'fetch'),
    [actions]
  );

  if (sources.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 12, textAlign: 'center', padding: 24, flexDirection: 'column', gap: 8 }}>
        <div>No graphql / fetch actions defined</div>
        <div style={{ fontSize: 10, color: '#374151', maxWidth: 180 }}>
          Add fetch/graphql actions in <code style={{ color: '#34d399' }}>config/actions/</code> then use them in Interactions or Data Source sections.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #1f2937', fontSize: 10, color: '#4b5563', lineHeight: 1.6, flexShrink: 0 }}>
        Select an element → Logic tab → <span style={{ color: '#34d399' }}>Data Source</span> to trigger one of these on mount.
        Use them in Interactions to call on click/submit.
      </div>
    <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
      {sources.map(([name, def]) => (
        <div key={name} style={{ borderBottom: '1px solid #1f2937' }}>
          <button
            data-testid={`source-row-${name}`}
            onClick={() => setExpanded(p => ({ ...p, [name]: !p[name] }))}
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '6px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#d1d5db', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <ActionTypeBadge type={def.type} />
            </div>
            <div style={{ color: '#6b7280', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {def.type === 'fetch' ? `${def.method ?? 'GET'} ${def.url ?? ''}` : `${def.endpoint ?? 'convention endpoint'}`}
            </div>
          </button>
          {expanded[name] && def.query && (
            <pre style={{ margin: 0, padding: '6px 16px', background: '#0f172a', color: '#9ca3af', fontSize: 10, fontFamily: 'monospace', overflow: 'auto', maxHeight: 120, whiteSpace: 'pre-wrap' }}>
              {def.query.slice(0, 400)}{def.query.length > 400 ? '\n…' : ''}
            </pre>
          )}
        </div>
      ))}
    </div>
    </div>
  );
}

function AppPreviewDataEditor() {
  const appPreviewData = useBuilderStore(s => s.appPreviewData);
  const setAppPreviewData = useBuilderStore(s => s.setAppPreviewData);
  const [raw, setRaw] = useState(() => JSON.stringify(appPreviewData, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleApply = useCallback(() => {
    try {
      const parsed = JSON.parse(raw);
      setAppPreviewData(parsed);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [raw, setAppPreviewData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '10px 8px', gap: 8 }}>
      <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.5 }}>
        Global mock data shared across all pages. Per-page data (set when &quot;Data&quot; state is active) overrides these values.
      </div>
      <textarea
        data-testid="app-preview-data-textarea"
        value={raw}
        onChange={e => { setRaw(e.target.value); setError(null); }}
        onBlur={handleApply}
        spellCheck={false}
        style={{
          flex: 1,
          resize: 'none',
          background: '#0f172a',
          color: '#e2e8f0',
          border: `1px solid ${error ? '#ef4444' : '#1f2937'}`,
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          padding: '6px 8px',
          outline: 'none',
          minHeight: 180,
        }}
      />
      {error && <div style={{ fontSize: 10, color: '#ef4444' }}>{error}</div>}
      <button
        data-testid="app-preview-data-apply"
        onClick={handleApply}
        style={{ padding: '5px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer', alignSelf: 'flex-end' }}
      >
        Apply
      </button>
    </div>
  );
}

// ─── Vars Panel ───────────────────────────────────────────────────────────────

const VARS_INPUT: React.CSSProperties = {
  background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
  padding: '3px 6px', fontSize: 11, color: '#f3f4f6', outline: 'none', width: '100%',
};
const VARS_SELECT: React.CSSProperties = { ...VARS_INPUT, cursor: 'pointer' };
const VARS_SECTION_LABEL: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
  color: '#4b5563', padding: '10px 12px 4px',
};

function CustomVarsSection() {
  const { customVars, addCustomVar, updateCustomVar, removeCustomVar } = useBuilderStore();
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<CustomVar['type']>('string');

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const defaults: Record<CustomVar['type'], unknown> = {
      string: '', number: 0, boolean: false, object: {}, array: [], form: {},
    };
    addCustomVar({ name: trimmed, type: newType, initialValue: defaults[newType] });
    setNewName('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={VARS_SECTION_LABEL}>Custom Variables</div>
      <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {customVars.length === 0 && (
          <div style={{ fontSize: 10, color: '#4b5563', fontStyle: 'italic', padding: '2px 0' }}>
            No variables yet — add one below
          </div>
        )}
        {customVars.map(v => (
          <div key={v.name} style={{ background: '#1f2937', borderRadius: 4, border: '1px solid #374151', padding: '5px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ flex: 1, fontSize: 11, color: '#c084fc', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
              <span style={{ fontSize: 9, color: '#6b7280', background: '#111827', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{v.type}</span>
              <button
                onClick={() => removeCustomVar(v.name)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 12, padding: '0 2px', flexShrink: 0 }}
              >×</button>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#6b7280', flexShrink: 0 }}>value</span>
              {v.type === 'boolean' ? (
                <select
                  value={String(v.initialValue)}
                  onChange={e => updateCustomVar(v.name, { initialValue: e.target.value === 'true' })}
                  style={{ ...VARS_SELECT, flex: 1 }}
                >
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              ) : v.type === 'number' ? (
                <input
                  type="number"
                  value={String(v.initialValue)}
                  onChange={e => updateCustomVar(v.name, { initialValue: Number(e.target.value) })}
                  style={{ ...VARS_INPUT, flex: 1 }}
                />
              ) : v.type === 'object' || v.type === 'array' ? (
                <textarea
                  value={typeof v.initialValue === 'string' ? v.initialValue : JSON.stringify(v.initialValue, null, 2)}
                  onChange={e => {
                    try { updateCustomVar(v.name, { initialValue: JSON.parse(e.target.value) }); }
                    catch { updateCustomVar(v.name, { initialValue: e.target.value }); }
                  }}
                  rows={2}
                  style={{ ...VARS_INPUT, flex: 1, resize: 'vertical', fontFamily: 'monospace', fontSize: 10 }}
                />
              ) : (
                <input
                  value={String(v.initialValue)}
                  onChange={e => updateCustomVar(v.name, { initialValue: e.target.value })}
                  style={{ ...VARS_INPUT, flex: 1 }}
                />
              )}
            </div>
          </div>
        ))}

        {/* Add row */}
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="variable name…"
            style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none' }}
          />
          <select value={newType} onChange={e => setNewType(e.target.value as CustomVar['type'])} style={{ ...VARS_SELECT, width: 70 }}>
            <option value="string">str</option>
            <option value="number">num</option>
            <option value="boolean">bool</option>
            <option value="object">obj</option>
            <option value="array">arr</option>
          </select>
          <button
            onClick={handleAdd}
            style={{ padding: '3px 10px', background: '#1d4ed8', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
          >+</button>
        </div>
      </div>
    </div>
  );
}

function VarsWorkflowsSection() {
  const { pageWorkflows, setPageWorkflow, removePageWorkflow } = useBuilderStore();
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const entries = Object.entries(pageWorkflows);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={VARS_SECTION_LABEL}>Workflows</div>
      <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.5, marginBottom: 2 }}>
          Named action sequences — reference from any interaction with <code style={{ color: '#c084fc', fontSize: 9 }}>workflow: "name"</code>.
        </div>
        {entries.length === 0 && (
          <div style={{ fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>No workflows yet</div>
        )}
        {entries.map(([name, actions]) => (
          <div key={name} style={{ background: '#1f2937', borderRadius: 5, border: '1px solid #374151', overflow: 'hidden' }}>
            <button
              onClick={() => setExpanded(e => e === name ? null : name)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 8px', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <Chevron open={expanded === name} size={10} />
              <span style={{ fontSize: 11, color: '#c084fc', fontWeight: 600, flex: 1, textAlign: 'left' }}>{name}</span>
              <span style={{ fontSize: 9, color: '#4b5563' }}>{actions.length} step{actions.length !== 1 ? 's' : ''}</span>
              <button
                onClick={e => { e.stopPropagation(); removePageWorkflow(name); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 12, padding: '0 2px' }}
              >×</button>
            </button>
            {expanded === name && (
              <div style={{ borderTop: '1px solid #374151', padding: '8px' }}>
                <ActionBuilder
                  value={actions.reduce<Record<string, unknown[]>>((acc, a) => { (acc['run'] ??= []).push(a); return acc; }, {})}
                  onChange={v => setPageWorkflow(name, Object.values(v ?? {}).flat() as object[])}
                  availableEvents={['run']}
                />
              </div>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="workflow name…"
            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { setPageWorkflow(newName.trim(), []); setNewName(''); } }}
            style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none' }}
          />
          <button
            onClick={() => { if (newName.trim()) { setPageWorkflow(newName.trim(), []); setNewName(''); } }}
            style={{ padding: '3px 10px', background: '#1d4ed8', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
          >+ Add</button>
        </div>
      </div>
    </div>
  );
}

function VarsFormulasSection() {
  const { globalFormulas, setGlobalFormula, removeGlobalFormula } = useBuilderStore();
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const entries = Object.entries(globalFormulas);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={VARS_SECTION_LABEL}>Global Formulas</div>
      <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.5, marginBottom: 2 }}>
          Named JSON Logic expressions — use anywhere as <code style={{ color: '#fbbf24', fontSize: 9 }}>{`{{formula.name}}`}</code>.
        </div>
        {entries.length === 0 && (
          <div style={{ fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>No formulas yet</div>
        )}
        {entries.map(([name, expr]) => (
          <div key={name} style={{ background: '#1f2937', borderRadius: 5, border: '1px solid #374151', overflow: 'hidden' }}>
            <button
              onClick={() => setExpanded(e => e === name ? null : name)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '5px 8px', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <Chevron open={expanded === name} size={10} />
              <span style={{ fontSize: 11, color: '#fbbf24', fontWeight: 600, flex: 1, textAlign: 'left' }}>{name}</span>
              <button
                onClick={e => { e.stopPropagation(); removeGlobalFormula(name); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 12, padding: '0 2px' }}
              >×</button>
            </button>
            {expanded === name && (
              <div style={{ borderTop: '1px solid #374151', padding: '8px' }}>
                <ExprBuilder
                  value={expr as object | null}
                  onChange={v => setGlobalFormula(name, v as object)}
                />
              </div>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="formula name…"
            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { setGlobalFormula(newName.trim(), {}); setNewName(''); } }}
            style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none' }}
          />
          <button
            onClick={() => { if (newName.trim()) { setGlobalFormula(newName.trim(), {}); setNewName(''); } }}
            style={{ padding: '3px 10px', background: '#1d4ed8', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
          >+ Add</button>
        </div>
      </div>
    </div>
  );
}

const DIVIDER = <div style={{ height: 1, background: '#1f2937', margin: '4px 0' }} />;

function VarsPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
      {/* Store viewer */}
      <div style={VARS_SECTION_LABEL}>Live Store</div>
      <StoreTab embedded />
      {DIVIDER}
      <CustomVarsSection />
      {DIVIDER}
      <VarsWorkflowsSection />
      {DIVIDER}
      <VarsFormulasSection />
    </div>
  );
}

// ─── Page Config Slide ────────────────────────────────────────────────────────

const PC_INPUT: React.CSSProperties = {
  width: '100%', background: '#1f2937', border: '1px solid #374151',
  borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '5px 8px',
  outline: 'none', boxSizing: 'border-box',
};
const PC_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  display: 'block', marginBottom: 4,
};
const PC_SECTION: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #1f2937',
  display: 'flex', flexDirection: 'column', gap: 8,
};

export function PageConfigSlidePanelContent({ onClose }: { onClose: () => void }) {
  const { pages, currentPageId, renamePage, setCurrentPageMeta, setCurrentPageInteractions, pageWorkflows } = useBuilderStore();
  const currentPage = pages.find(p => p.id === currentPageId);

  const [pageName, setPageName] = useState(currentPage?.name ?? '');
  const [title, setTitle] = useState(currentPage?.meta?.title ?? '');
  const [description, setDescription] = useState(currentPage?.meta?.description ?? '');
  const [ogImage, setOgImage] = useState(currentPage?.meta?.ogImage ?? '');
  const [mountWorkflow, setMountWorkflow] = useState(currentPage?.pageInteractions?.mount?.workflow ?? '');

  const workflowNames = Object.keys(pageWorkflows);

  const saveMeta = () => {
    const meta: PageMeta = {};
    if (title.trim()) meta.title = title.trim();
    if (description.trim()) meta.description = description.trim();
    if (ogImage.trim()) meta.ogImage = ogImage.trim();
    setCurrentPageMeta(meta);
  };

  const saveInteractions = (newMountWorkflow: string) => {
    const interactions: Record<string, { workflow?: string }> = {};
    if (newMountWorkflow.trim()) {
      interactions.mount = { workflow: newMountWorkflow.trim() };
    }
    setCurrentPageInteractions(interactions);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page name */}
      <div style={PC_SECTION}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Page</div>
        <div>
          <label style={PC_LABEL}>Name</label>
          <input
            data-testid="page-config-name"
            value={pageName}
            onChange={e => setPageName(e.target.value)}
            onBlur={() => { if (pageName.trim() && currentPageId) renamePage(currentPageId, pageName.trim()); }}
            style={PC_INPUT}
          />
        </div>
        {currentPage?.route && (
          <div>
            <label style={PC_LABEL}>Route</label>
            <div style={{ ...PC_INPUT, color: '#6b7280', cursor: 'default' }}>{currentPage.route}</div>
          </div>
        )}
      </div>

      {/* SEO / Meta */}
      <div style={PC_SECTION}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>SEO / Meta</div>
        <div>
          <label style={PC_LABEL}>Page title</label>
          <input
            data-testid="page-config-meta-title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={saveMeta}
            placeholder="My page title"
            style={PC_INPUT}
          />
        </div>
        <div>
          <label style={PC_LABEL}>Description</label>
          <textarea
            data-testid="page-config-meta-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={saveMeta}
            placeholder="Short description for search engines…"
            rows={3}
            style={{ ...PC_INPUT, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
        <div>
          <label style={PC_LABEL}>OG Image URL</label>
          <input
            value={ogImage}
            onChange={e => setOgImage(e.target.value)}
            onBlur={saveMeta}
            placeholder="https://…"
            style={PC_INPUT}
          />
        </div>
      </div>

      {/* Interactions */}
      <div style={PC_SECTION}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Interactions</div>
        <div>
          <label style={PC_LABEL}>On mount (page load)</label>
          <select
            data-testid="page-config-mount-workflow"
            value={mountWorkflow}
            onChange={e => { setMountWorkflow(e.target.value); saveInteractions(e.target.value); }}
            style={{ ...PC_INPUT, cursor: 'pointer' }}
          >
            <option value="">— none —</option>
            {workflowNames.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          {mountWorkflow && (
            <button
              onClick={() => { setMountWorkflow(''); saveInteractions(''); }}
              style={{ marginTop: 4, background: 'none', border: 'none', color: '#f87171', fontSize: 10, cursor: 'pointer', padding: 0 }}
            >
              × Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 'auto', padding: '10px 12px', borderTop: '1px solid #1f2937', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          style={{ padding: '5px 14px', background: '#1d4ed8', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer' }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

interface PanelLeftProps {
  dataSlideState: DataTabSlideState;
  onSetDataSlide: (s: DataTabSlideState) => void;
  logicSlideState: LogicSlideState;
  onSetLogicSlide: (s: LogicSlideState) => void;
  onOpenPageConfig: () => void;
  onWidthChange?: (w: number) => void;
}

export default function PanelLeft({
  dataSlideState,
  onSetDataSlide,
  logicSlideState,
  onSetLogicSlide,
  onOpenPageConfig,
  onWidthChange,
}: PanelLeftProps) {
  const [tab, setTab] = useState<'layers' | 'components' | 'data' | 'logic'>('components');
  const [search, setSearch] = useState('');
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [layerDrag, setLayerDrag] = useState<LayerDragState>({ dragId: null, dropTargetId: null, dropPosition: 'above' });

  const store = useBuilderStore();

  // Auto-expand ancestor nodes and scroll to the selected layer when canvas selection changes
  useEffect(() => {
    if (store.selectedIds.length !== 1) return;
    const targetId = store.selectedIds[0];

    // Walk up ancestry and collect IDs to expand
    const idsToExpand: string[] = [];
    let current: SDUINode | null = findNode(store.pageNodes as SDUINode[], targetId) ?? null;
    while (current) {
      const currentId = (current as { id?: string }).id ?? '';
      const parent = currentId ? findParentNode(store.pageNodes as SDUINode[], currentId) : null;
      if (!parent) break;
      const parentId = (parent as { id?: string }).id ?? '';
      if (parentId && !store.expandedIds.has(parentId)) {
        idsToExpand.push(parentId);
      }
      current = parent as SDUINode;
    }

    if (idsToExpand.length > 0) {
      store.setExpandedIds(new Set([...store.expandedIds, ...idsToExpand]));
    }

    // Switch to layers tab and scroll selected row into view after next paint
    setTab('layers');
    requestAnimationFrame(() => {
      document.querySelector(`[data-node-id="${CSS.escape(targetId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.selectedIds]);

  const handleLayerDragStart = useCallback((id: string) => {
    setLayerDrag({ dragId: id, dropTargetId: null, dropPosition: 'above' });
  }, []);

  const handleLayerDragOver = useCallback((hoverId: string, pos: 'above' | 'inside' | 'below') => {
    setLayerDrag(prev => {
      if (!prev.dragId || prev.dragId === hoverId) return prev;
      if (prev.dropTargetId === hoverId && prev.dropPosition === pos) return prev;
      return { ...prev, dropTargetId: hoverId, dropPosition: pos };
    });
  }, []);

  const handleLayerDrop = useCallback(() => {
    const { dragId, dropTargetId, dropPosition } = layerDrag;
    if (dragId && dropTargetId && dragId !== dropTargetId) {
      const { pageNodes, moveNode, moveNodes, selectedIds } = store;

      if (dropPosition === 'inside') {
        // Nest into the target node as its last child
        const targetNode = findNode(pageNodes, dropTargetId);
        const childCount = (targetNode?.children as SDUINode[] | undefined)?.length ?? 0;
        if (selectedIds.includes(dragId) && selectedIds.length > 1) {
          moveNodes(selectedIds, dropTargetId, childCount);
        } else {
          moveNode(dragId, dropTargetId, childCount);
        }
      } else {
        // Insert before or after target in target's parent
        const targetParent = findParentNode(pageNodes, dropTargetId);
        const siblings: SDUINode[] = targetParent
          ? (targetParent.children as SDUINode[])
          : pageNodes;
        const targetIdx = siblings.findIndex(n => (n as { id?: string }).id === dropTargetId);

        if (targetIdx >= 0) {
          const insertIdx = dropPosition === 'above' ? targetIdx : targetIdx + 1;
          const targetParentId = (targetParent as { id?: string } | null)?.id ?? null;

          if (selectedIds.includes(dragId) && selectedIds.length > 1) {
            moveNodes(selectedIds, targetParentId, insertIdx);
          } else {
            moveNode(dragId, targetParentId, insertIdx);
          }
        }
      }
    }
    setLayerDrag({ dragId: null, dropTargetId: null, dropPosition: 'above' });
  }, [layerDrag, store]);

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

  const pages = useBuilderStore(s => s.pages);
  const currentPageId = useBuilderStore(s => s.currentPageId);
  const currentPageName = pages.find(p => p.id === currentPageId)?.name ?? '';

  return (
    <div data-testid="panel-left" style={{ width: 240, height: '100%', display: 'flex', flexDirection: 'column', background: '#111827', borderRight: '1px solid #1f2937', overflow: 'hidden' }}>
      {/* Page settings bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <span style={{ fontSize: 10, opacity: 0.5, flexShrink: 0 }}>📄</span>
        <span style={{ flex: 1, fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentPageName}
        </span>
        <button
          data-testid="page-config-btn"
          onClick={onOpenPageConfig}
          title="Page settings (name, SEO meta, interactions)"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14, padding: '2px 4px', borderRadius: 3, flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#d1d5db')}
          onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
        >
          ⚙
        </button>
      </div>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {(['layers', 'components', 'data', 'logic'] as const).map(t => (
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
              fontSize: 10,
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
          <div
            data-testid="layers-tree"
            style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}
            onClick={e => {
              // Deselect when clicking on empty space (not on a layer row)
              if (!(e.target as HTMLElement).closest('[data-layer-row]')) {
                store.select(null);
              }
            }}
          >
            <LayerTree
              nodes={filteredNodes as SDUINode[]}
              store={store}
              contextMenuHandlers={ctxHandlers}
              dragState={layerDrag}
              onLayerDragStart={handleLayerDragStart}
              onLayerDragOver={handleLayerDragOver}
              onLayerDrop={handleLayerDrop}
            />
          </div>
        </>
      )}

      {tab === 'components' && <ComponentsTab />}

      {tab === 'data' && <DataTab onSetSlide={onSetDataSlide} onWidthChange={onWidthChange} />}

      {tab === 'logic' && <LogicTab onSetSlide={onSetLogicSlide} />}

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
