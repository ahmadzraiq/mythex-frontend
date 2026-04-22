'use client';

/**
 * Shared Components Tab — left panel "Shared" tab.
 */

import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { cloneWithFreshIds, cloneWithFreshIdsKeepSharedKey, stampSharedKeys } from './_store-node-helpers';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import {
  getSharedComponentList, createSharedComponent,
  updateSharedComponent as updateSCData, deleteSharedComponent, subscribeSharedComponents,
} from '@/lib/builder/shared-component-data';
import type { SharedComponentModel, SharedComponentProperty } from '@/lib/builder/shared-component-data';
import { FigmaColorPicker } from './_color-picker';
import { json as cmJson } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
const CodeMirror = lazy(() => import('@uiw/react-codemirror'));

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureNodeIds(node: Record<string, unknown>): { node: Record<string, unknown>; changed: boolean } {
  let changed = false;
  let result = node;
  if (!node.id) { result = { ...node, id: crypto.randomUUID() }; changed = true; }
  const children = (result.children ?? []) as Record<string, unknown>[];
  if (children.length > 0) {
    const nc: Record<string, unknown>[] = [];
    for (const c of children) { const r = ensureNodeIds(c); nc.push(r.node); if (r.changed) changed = true; }
    if (changed) result = { ...result, children: nc };
  }
  return { node: result, changed };
}

function makeStarterContent(): Record<string, unknown> {
  return { type: 'Box', name: 'Component', props: { className: 'flex flex-col w-full' }, children: [{ type: 'Text', props: { className: 'text-base font-semibold text-gray-900 dark:text-white' }, text: 'Shared Component' }] };
}

function syncCtx(props: Record<string, unknown>) {
  getGlobalVariableStore().getState().setState(prev => ({ ...prev, context: { component: { props } } }));
}
function clearCtx() {
  getGlobalVariableStore().getState().setState(prev => { const n = { ...prev }; delete n.context; return n; });
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconGrip = () => (
  <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
    <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
    <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
    <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
  </svg>
);

const IconEdit = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const IconEye = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconEyeOff = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const IconClose = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconDots = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
  </svg>
);

const IconPlus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ─── Icon button ──────────────────────────────────────────────────────────────

function IconBtn({ icon, onClick, title, active, danger, activeColor }: {
  icon: React.ReactNode; onClick: (e: React.MouseEvent) => void;
  title?: string; active?: boolean; danger?: boolean; activeColor?: string;
}) {
  const color = danger ? '#ef4444' : active ? (activeColor ?? '#3b82f6') : '#9ca3af';
  return (
    <button
      onClick={onClick} title={title}
      style={{ background: active ? `${color}22` : 'none', border: 'none', borderRadius: 4, color, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, flexShrink: 0, transition: 'all 120ms' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = active ? `${color}33` : '#1f2937'; (e.currentTarget as HTMLElement).style.color = danger ? '#f87171' : active ? color : '#e5e7eb'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? `${color}22` : 'none'; (e.currentTarget as HTMLElement).style.color = color; }}
    >
      {icon}
    </button>
  );
}

// ─── Default Value Input ──────────────────────────────────────────────────────

const INPUT_BASE: React.CSSProperties = {
  background: '#1f2937', border: '1px solid #374151', borderRadius: 5,
  color: '#e5e7eb', fontSize: 12, padding: '6px 10px', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};

function DefaultValueInput({ type, value, onChange }: { type: string; value: unknown; onChange: (v: unknown) => void }) {
  const s = String(value ?? '');

  if (type === 'boolean') {
    const on = value === true || value === 'true';
    return (
      <div style={{ display: 'flex', gap: 3, background: '#111827', borderRadius: 6, padding: 3 }}>
        {(['True', 'False'] as const).map(label => {
          const active = label === 'True' ? on : !on;
          return (
            <button key={label} onClick={() => onChange(label === 'True')}
              style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 4, border: 'none', cursor: 'pointer', transition: 'all 120ms',
                background: active ? (label === 'True' ? '#064e3b' : '#7f1d1d') : 'transparent',
                color: active ? (label === 'True' ? '#6ee7b7' : '#fca5a5') : '#6b7280',
                fontWeight: active ? 600 : 400 }}
            >{label}</button>
          );
        })}
      </div>
    );
  }

  if (type === 'color') return <FigmaColorPicker value={s || '#000000'} onChange={c => onChange(c)} />;

  if (type === 'any') {
  return (
      <div style={{ borderRadius: 5, overflow: 'hidden', border: '1px solid #374151' }}>
        <Suspense fallback={<textarea value={s} onChange={e => onChange(e.target.value)} rows={4} style={{ ...INPUT_BASE, border: 'none', fontFamily: 'monospace', resize: 'vertical' }} />}>
          <CodeMirror value={s} height="110px" extensions={[cmJson()]} theme={oneDark}
            onChange={v => onChange(v)}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: true, closeBrackets: false, autocompletion: false }}
            style={{ fontSize: 12 }}
          />
        </Suspense>
    </div>
  );
}

  if (type === 'number') return <input type="number" value={s} onChange={e => onChange(e.target.value)} placeholder="0" style={INPUT_BASE} />;
  return <input value={s} onChange={e => onChange(e.target.value)} placeholder="Default value…" style={INPUT_BASE} />;
}

// ─── Type badge ───────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  text:    { bg: '#374151', color: '#f9fafb' },
  number:  { bg: '#1d4ed8', color: '#dbeafe' },
  boolean: { bg: '#6d28d9', color: '#ede9fe' },
  color:   { bg: '#b45309', color: '#fef3c7' },
  any:     { bg: '#065f46', color: '#d1fae5' },
};

function TypeBadge({ type }: { type: string }) {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.text;
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: c.bg, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
      {type}
    </span>
  );
}

// ─── Property Edit Popup (side panel, anchored to right of left panel) ────────

function PropertyEditPopup({ prop, anchorY, onUpdate, onClose }: {
  prop: SharedComponentProperty;
  anchorY: number;
  onUpdate: (field: keyof SharedComponentProperty, val: unknown) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const LEFT_PANEL_WIDTH = 240;

  // Track color picker open state so we don't close the popup while it's open
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerOpenRef = useRef(false);
  useEffect(() => { colorPickerOpenRef.current = colorPickerOpen; }, [colorPickerOpen]);

  // Clamp top so popup stays within viewport
  const [top, setTop] = useState(anchorY);
  useEffect(() => {
    if (!ref.current) return;
    const h = ref.current.offsetHeight;
    const clamped = Math.max(60, Math.min(anchorY - 12, window.innerHeight - h - 12));
    setTop(clamped);
  }, [anchorY, prop.type]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      // Don't close while the color picker floating panel is open
      if (colorPickerOpenRef.current) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [onClose]);

  const s = String(prop.defaultValue ?? '');

  return (
    <div
      ref={ref}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: LEFT_PANEL_WIDTH + 8,
        top,
        zIndex: 99999,
        width: 260,
        background: '#1a2233',
        border: '1px solid #374151',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #2d3748' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TypeBadge type={prop.type} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#e5e7eb' }}>{prop.name || 'Untitled'}</span>
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, padding: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1f2937'; (e.currentTarget as HTMLElement).style.color = '#e5e7eb'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
        ><IconClose /></button>
      </div>

      {/* Fields */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Name */}
        <div>
          <label style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 4 }}>Name</label>
          <input value={prop.name} onChange={e => onUpdate('name', e.target.value)} placeholder="prop name"
            style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 11 }}
            onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
            onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
          />
          <div style={{ fontSize: 9, color: '#6b7280', marginTop: 4, fontFamily: 'monospace' }}>
            context.component?.props?.[&apos;{prop.name || '…'}&apos;]
          </div>
        </div>
        {/* Type */}
        <div>
          <label style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 4 }}>Type</label>
          <select value={prop.type} onChange={e => onUpdate('type', e.target.value)}
            style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 11 }}>
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="color">color</option>
            <option value="any">any (JSON)</option>
          </select>
        </div>
        {/* Default value — color gets controlled picker to suppress outside-click */}
        <div>
          <label style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 4 }}>Default value</label>
          {prop.type === 'color' ? (
            <FigmaColorPicker
              value={s || '#000000'}
              onChange={c => onUpdate('defaultValue', c)}
              open={colorPickerOpen}
              onOpenChange={setColorPickerOpen}
            />
          ) : (
            <DefaultValueInput type={prop.type} value={prop.defaultValue} onChange={v => onUpdate('defaultValue', v as string)} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function ContextMenu({ pos, expanded, onRename, onToggleProps, onDelete, onClose }:
  { pos: { x: number; y: number }; expanded: boolean; onRename: () => void; onToggleProps: () => void; onDelete: () => void; onClose: () => void }
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [onClose]);

  const item = (label: string, action: () => void, red?: boolean): React.ReactNode => (
    <button key={label}
      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: red ? '#f87171' : '#d1d5db', fontSize: 12, padding: '6px 14px', cursor: 'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1f2937'; (e.currentTarget as HTMLElement).style.color = red ? '#fca5a5' : '#f3f4f6'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; (e.currentTarget as HTMLElement).style.color = red ? '#f87171' : '#d1d5db'; }}
      onClick={() => { action(); onClose(); }}
    >{label}</button>
  );

  return (
    <div ref={ref} style={{ position: 'fixed', top: pos.y, left: pos.x, background: '#1e2533', border: '1px solid #374151', borderRadius: 8, zIndex: 99999, minWidth: 160, padding: '4px 0', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
      {item('Rename', onRename)}
      {item(expanded ? 'Hide properties' : 'Edit properties', onToggleProps)}
      <div style={{ margin: '3px 0', borderTop: '1px solid #374151' }} />
      {item('Delete', onDelete, true)}
    </div>
  );
}

// ─── Create Form ─────────────────────────────────────────────────────────────

function CreateForm({ onCreated, onCancel }: { onCreated: (m: SharedComponentModel) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const create = () => {
    const t = name.trim(); if (!t) return;
    const content = makeStarterContent();
    stampSharedKeys(content);
    onCreated(createSharedComponent({ id: `sc-${crypto.randomUUID()}`, name: t, properties: [], content }));
  };
  return (
    <div style={{ padding: '12px', borderBottom: '1px solid #374151', background: '#111827' }}>
      <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6, fontWeight: 500 }}>Component name</div>
      <input autoFocus data-testid="sc-name-input" value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') onCancel(); }}
        placeholder="e.g. Modal, Card, Drawer…"
        style={{ width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, color: '#f3f4f6', fontSize: 12, padding: '6px 10px', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
        onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
        onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button data-testid="sc-create-submit" onClick={create}
          style={{ flex: 1, background: '#2563eb', border: 'none', borderRadius: 5, color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '6px 0' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#3b82f6'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#2563eb'}
        >Create</button>
        <button onClick={onCancel}
          style={{ flex: 1, background: 'none', border: '1px solid #374151', borderRadius: 5, color: '#9ca3af', cursor: 'pointer', fontSize: 11, padding: '6px 0' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#6b7280'; (e.currentTarget as HTMLElement).style.color = '#e5e7eb'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#374151'; (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ─── Model Row ────────────────────────────────────────────────────────────────

interface ModelRowProps {
  model: SharedComponentModel; isEditing: boolean; isPreviewing: boolean;
  onDelete: (id: string) => void; onUpdate: (m: SharedComponentModel) => void;
  onEdit: (m: SharedComponentModel) => void; onPreview: (m: SharedComponentModel) => void;
}

function ModelRow({ model, isEditing, isPreviewing, onDelete, onUpdate, onEdit, onPreview }: ModelRowProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(model.name);
  const [expanded, setExpanded] = useState(false);
  const [editingPropId, setEditingPropId] = useState<string | null>(null);
  const [editingPropAnchorY, setEditingPropAnchorY] = useState(0);

  const handleRename = () => {
    const t = renameValue.trim();
    if (t && t !== model.name) { const u = { ...model, name: t }; onUpdate(u); updateSCData(u); }
    setRenaming(false);
  };

  const handleDragStart = useCallback((e: React.DragEvent) => {
    // Ensure the model content has _sharedKey stamped (self-heal for legacy).
    const modelContent = JSON.parse(JSON.stringify(model.content)) as Record<string, unknown>;
    stampSharedKeys(modelContent);
    // Keep _sharedKey on the instance so it can be walked in parallel with the model.
    const cloned = cloneWithFreshIdsKeepSharedKey(modelContent);
    cloned._shared = { id: model.id, name: model.name };
    cloned._overrides = [];
    const data = JSON.stringify(cloned);
    e.dataTransfer.setData('text/primitive-node', data);
    e.dataTransfer.effectAllowed = 'copy';
    (window as unknown as Record<string, unknown>).__primitiveDrag = data;
  }, [model]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ x: r.left - 158, y: r.bottom + 4 });
  };

  return (
    <>
      <div
        draggable onDragStart={handleDragStart}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 8px 7px 10px',
          borderBottom: '1px solid #1f2937',
          borderLeft: isEditing ? '2px solid #3b82f6' : '2px solid transparent',
          background: isEditing ? '#111827' : 'transparent',
          cursor: 'grab',
        }}
        onMouseEnter={e => { if (!isEditing) (e.currentTarget as HTMLElement).style.background = '#111827'; }}
        onMouseLeave={e => { if (!isEditing) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Drag grip */}
        <span style={{ color: '#6b7280', flexShrink: 0, display: 'flex', alignItems: 'center', cursor: 'grab' }}>
          <IconGrip />
        </span>

        {/* Name */}
        {renaming ? (
          <input autoFocus value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setRenaming(false); setRenameValue(model.name); } }}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, minWidth: 0, background: '#1f2937', border: '1px solid #3b82f6', borderRadius: 4, color: '#f3f4f6', fontSize: 12, padding: '2px 6px', outline: 'none' }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, color: isEditing ? '#93c5fd' : '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {model.name}
          </span>
        )}

        {/* Action icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <IconBtn
            icon={isPreviewing ? <IconEyeOff /> : <IconEye />}
            onClick={e => { e.stopPropagation(); onPreview(model); }}
            title={isPreviewing ? 'Remove from page' : 'Place on page'}
            active={isPreviewing}
            activeColor="#10b981"
          />
          <IconBtn
            icon={isEditing ? <IconClose /> : <IconEdit />}
            onClick={e => { e.stopPropagation(); onEdit(model); }}
            title={isEditing ? 'Close editor' : 'Edit in canvas'}
            active={isEditing}
            activeColor="#3b82f6"
          />
          <IconBtn
            icon={<IconDots />}
            onClick={openMenu}
            title="More options"
          />
          {/* Chevron — expands property list */}
            <button
            onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
            title={expanded ? 'Hide properties' : 'Show properties'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, padding: 0, color: expanded ? '#60a5fa' : '#6b7280', position: 'relative' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1f2937'; (e.currentTarget as HTMLElement).style.color = '#d1d5db'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = expanded ? '#60a5fa' : '#6b7280'; }}
          >
            <IconChevron open={expanded} />
            {model.properties.length > 0 && (
              <span style={{ position: 'absolute', top: 1, right: 1, width: 5, height: 5, borderRadius: '50%', background: '#3b82f6' }} />
            )}
          </button>
        </div>
      </div>

      {/* Expanded property list */}
      {expanded && (
        <div style={{ background: '#0f1624', borderBottom: '1px solid #1f2937' }}>
          {model.properties.length === 0 && (
            <div style={{ padding: '8px 14px 8px 32px', fontSize: 10, color: '#6b7280', fontStyle: 'italic' }}>No properties yet.</div>
          )}
          {model.properties.map(prop => (
            <div key={prop.id}
              style={{
                display: 'flex', alignItems: 'center',
                background: editingPropId === prop.id ? '#1f2937' : 'none',
                borderBottom: '1px solid #1a2030',
              }}
              onMouseEnter={e => { if (editingPropId !== prop.id) (e.currentTarget as HTMLElement).style.background = '#111827'; }}
              onMouseLeave={e => { if (editingPropId !== prop.id) (e.currentTarget as HTMLElement).style.background = 'none'; }}
            >
              {/* Clickable area opens popup */}
            <button
                onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setEditingPropId(prop.id); setEditingPropAnchorY(r.top); }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px 5px 28px', background: 'none', border: 'none', cursor: 'pointer', minWidth: 0 }}
              >
                <span style={{ flex: 1, fontSize: 11, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{prop.name}</span>
                <TypeBadge type={prop.type} />
                </button>
              {/* Delete button inline */}
                <button
                onClick={e => {
                  e.stopPropagation();
                  useBuilderStore.getState()._pushHistory();
                  const u = { ...model, properties: model.properties.filter(p => p.id !== prop.id) };
                  onUpdate(u); updateSCData(u);
                  if (editingPropId === prop.id) setEditingPropId(null);
                }}
                style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: '0 10px', height: '100%', minHeight: 28, flexShrink: 0, fontSize: 12, display: 'flex', alignItems: 'center' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#6b7280'; }}
                title="Delete property"
              >✕</button>
            </div>
          ))}
          {/* Add property row */}
                <button
            onClick={e => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const p: SharedComponentProperty = { id: `prop-${crypto.randomUUID()}`, name: `prop${model.properties.length + 1}`, type: 'text', defaultValue: '' };
              const u = { ...model, properties: [...model.properties, p] }; onUpdate(u); updateSCData(u);
              setEditingPropId(p.id);
              setEditingPropAnchorY(r.top);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '6px 12px 6px 28px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 11, fontWeight: 500 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#60a5fa'; (e.currentTarget as HTMLElement).style.background = '#111827'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
          >
            <IconPlus /> <span>Add property</span>
                </button>
              </div>
            )}

      {/* Property edit popup */}
      {editingPropId && (() => {
        const prop = model.properties.find(p => p.id === editingPropId);
        if (!prop) return null;
        return (
          <PropertyEditPopup
            key={editingPropId}
            prop={prop}
            anchorY={editingPropAnchorY}
            onUpdate={(field, val) => {
              const u = { ...model, properties: model.properties.map(p => p.id === prop.id ? { ...p, [field]: val } : p) };
              onUpdate(u); updateSCData(u);
            }}
            onClose={() => setEditingPropId(null)}
          />
        );
      })()}

      {/* Context menu */}
      {menuPos && (
        <ContextMenu
          pos={menuPos} expanded={expanded}
          onRename={() => { setRenaming(true); }}
          onToggleProps={() => setExpanded(v => !v)}
          onDelete={() => onDelete(model.id)}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function SharedComponentsTab() {
  const [models, setModels] = useState<SharedComponentModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [previewIds, setPreviewIds] = useState<Record<string, string>>({});

  const { enterSharedComponentEdit, exitSharedComponentEdit, saveEditingSharedComponent, editingSharedComponentIds, pageNodes } = useBuilderStore();

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingIdsRef = useRef(editingSharedComponentIds);
  const saveRef = useRef(saveEditingSharedComponent);
  useEffect(() => { editingIdsRef.current = editingSharedComponentIds; }, [editingSharedComponentIds]);
  useEffect(() => { saveRef.current = saveEditingSharedComponent; }, [saveEditingSharedComponent]);
  useEffect(() => {
    if (editingIdsRef.current.length === 0) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { editingIdsRef.current.forEach(id => saveRef.current(id)); }, 800);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNodes]);

  useEffect(() => {
    setModels(getSharedComponentList()); setLoading(false);
    return subscribeSharedComponents(() => setModels(getSharedComponentList()));
  }, []);

  const handleCreated = useCallback((model: SharedComponentModel) => {
    useBuilderStore.getState()._pushHistory();
    setModels(prev => [...prev, model]);
    handleEdit(model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = useCallback((id: string) => {
    useBuilderStore.getState()._pushHistory();
    if (editingSharedComponentIds.includes(id)) exitSharedComponentEdit(id);
    deleteSharedComponent(id);
    setModels(prev => prev.filter(m => m.id !== id));
    if (editingSharedComponentIds.filter(e => e !== id).length === 0) clearCtx();
  }, [editingSharedComponentIds, exitSharedComponentEdit]);

  const handleUpdate = useCallback((u: SharedComponentModel) => {
    useBuilderStore.getState()._pushHistory();
    setModels(prev => prev.map(m => m.id === u.id ? u : m));
  }, []);

  const handlePreview = useCallback((model: SharedComponentModel) => {
    const existing = previewIds[model.id];
    if (existing) {
      useBuilderStore.getState().deleteNodes([existing]);
      setPreviewIds(prev => { const n = { ...prev }; delete n[model.id]; return n; });
      return;
    }
    if (editingSharedComponentIds.includes(model.id)) saveEditingSharedComponent(model.id);
    const modelContent = JSON.parse(JSON.stringify(model.content)) as Record<string, unknown>;
    stampSharedKeys(modelContent);
    const cloned = cloneWithFreshIdsKeepSharedKey(modelContent);
    cloned._shared = { id: model.id, name: model.name };
    cloned._overrides = [];
    const nodeId = cloned.id as string;
    useBuilderStore.getState().addNode(cloned as unknown as SDUINode, null, 0);
    setPreviewIds(prev => ({ ...prev, [model.id]: nodeId }));
  }, [previewIds, editingSharedComponentIds, saveEditingSharedComponent]);

  const handleEdit = useCallback(async (model: SharedComponentModel) => {
    if (editingSharedComponentIds.includes(model.id)) {
      exitSharedComponentEdit(model.id);
      if (editingSharedComponentIds.filter(id => id !== model.id).length === 0) clearCtx();
      return;
    }
    const { node: pop, changed } = ensureNodeIds(model.content as Record<string, unknown>);
    let em = model;
    if (changed) { em = { ...model, content: pop as SharedComponentModel['content'] }; updateSCData(em); setModels(prev => prev.map(m => m.id === em.id ? em : m)); }
    const dp: Record<string, unknown> = {};
    for (const p of em.properties) dp[p.name] = p.defaultValue ?? '';
    syncCtx(dp);
    enterSharedComponentEdit(em.id, em.content as unknown as SDUINode, em as unknown as Record<string, unknown>);
  }, [editingSharedComponentIds, exitSharedComponentEdit, enterSharedComponentEdit]);

  if (loading) return <div style={{ fontSize: 11, color: '#6b7280', padding: 12 }}>Loading…</div>;

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 10px 10px 12px', borderBottom: '1px solid #1f2937' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Shared</span>
        <button data-testid="sc-new-btn" onClick={() => setShowCreate(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: showCreate ? '#1e3a8a' : '#2563eb', border: 'none', borderRadius: 5, color: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '4px 10px' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#3b82f6'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = showCreate ? '#1e3a8a' : '#2563eb'}
        >
          <IconPlus /> New
        </button>
      </div>

      {/* Create form */}
      {showCreate && <CreateForm onCreated={m => { handleCreated(m); setShowCreate(false); }} onCancel={() => setShowCreate(false)} />}

      {/* Empty state */}
      {models.length === 0 && !showCreate && (
        <div style={{ padding: '32px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
          <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>No shared components</div>
          <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.6, maxWidth: 180 }}>Create one, or select a node on the canvas and toggle &quot;Make Shared&quot; in the right panel.</div>
        </div>
      )}

      {/* List */}
      <div data-testid="sc-models-list" style={{ flex: 1 }}>
        {models.map(model => (
          <ModelRow
            key={model.id} model={model}
            isEditing={editingSharedComponentIds.includes(model.id)}
            isPreviewing={!!previewIds[model.id]}
            onDelete={handleDelete} onUpdate={handleUpdate}
            onEdit={handleEdit} onPreview={handlePreview}
          />
        ))}
      </div>
    </div>
  );
}
