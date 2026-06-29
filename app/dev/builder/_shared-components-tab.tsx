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

import { IcoGrip as IconGrip, IcoEdit as IconEdit, IcoEye as IconEye, IcoEyeOff as IconEyeOff, IcoClose as IconClose, IcoDots as IconDots, IcoPlus as IconPlus, IcoChevron as IconChevron } from './_icons';

// ─── Icon button ──────────────────────────────────────────────────────────────

function IconBtn({ icon, onClick, title, active, danger, activeColor }: {
  icon: React.ReactNode; onClick: (e: React.MouseEvent) => void;
  title?: string; active?: boolean; danger?: boolean; activeColor?: string;
}) {
  const color = danger ? 'var(--bld-error)' : active ? (activeColor ?? 'var(--bld-accent)') : 'var(--bld-text-3)';
  return (
    <button
      onClick={onClick} title={title}
      style={{ background: active ? 'var(--bld-accent-subtle)' : 'none', border: 'none', borderRadius: 4, color, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, padding: 0, flexShrink: 0, transition: 'all 120ms' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-elevated)'; (e.currentTarget as HTMLElement).style.color = danger ? 'var(--bld-error)' : 'var(--bld-text-2)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? 'var(--bld-accent-subtle)' : 'none'; (e.currentTarget as HTMLElement).style.color = color; }}
    >
      {icon}
    </button>
  );
}

// ─── Default Value Input ──────────────────────────────────────────────────────

const INPUT_BASE: React.CSSProperties = {
  background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 5,
  color: 'var(--bld-text-1)', fontSize: 12, padding: '6px 10px', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};

function DefaultValueInput({ type, value, onChange }: { type: string; value: unknown; onChange: (v: unknown) => void }) {
  const s = String(value ?? '');

  if (type === 'boolean') {
    const on = value === true || value === 'true';
    return (
      <div style={{ display: 'flex', gap: 3, background: 'var(--bld-bg-base)', borderRadius: 6, padding: 3 }}>
        {(['True', 'False'] as const).map(label => {
          const active = label === 'True' ? on : !on;
          return (
            <button key={label} onClick={() => onChange(label === 'True')}
              style={{ flex: 1, fontSize: 11, padding: '5px 0', borderRadius: 4, border: 'none', cursor: 'pointer', transition: 'all 120ms',
                background: active ? (label === 'True' ? 'rgba(34,197,94,0.15)' : 'rgba(248,113,113,0.15)') : 'transparent',
                color: active ? (label === 'True' ? 'var(--bld-success)' : 'var(--bld-error)') : 'var(--bld-text-disabled)',
                fontWeight: active ? 600 : 400 }}
            >{label}</button>
          );
        })}
      </div>
    );
  }

  if (type === 'color') return <FigmaColorPicker value={s || '#000000'} onChange={c => onChange(c)} />;

  if (type === 'any' || type === 'list') {
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

  if (type === 'size') {
    const match = s.match(/^([\d.]+)(.*)$/);
    const num = match ? match[1] : '';
    const unit = match ? match[2] : 'px';
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="number"
          value={num}
          onChange={e => onChange(`${e.target.value}${unit || 'px'}`)}
          placeholder="0"
          style={{ ...INPUT_BASE, flex: 1 }}
        />
        <select
          value={unit || 'px'}
          onChange={e => onChange(`${num}${e.target.value}`)}
          style={{ ...INPUT_BASE, width: 52 }}
        >
          {['px', '%', 'vh', 'vw'].map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
    );
  }

  return (
    <input
      value={s}
      onChange={e => onChange(e.target.value)}
      placeholder={type === 'icon' ? 'lucide:check' : type === 'link' ? 'https://…' : 'Default value…'}
      style={INPUT_BASE}
    />
  );
}

// ─── Type badge ───────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  text:    { bg: 'var(--bld-bg-elevated)', color: 'var(--bld-text-2)' },
  number:  { bg: 'rgba(59,130,246,0.25)', color: 'var(--bld-info)' },
  boolean: { bg: 'rgba(124,58,237,0.25)', color: '#c084fc' },
  color:   { bg: 'rgba(245,158,11,0.2)', color: 'var(--bld-warning)' },
  any:     { bg: 'rgba(34,197,94,0.15)', color: 'var(--bld-success)' },
  size:    { bg: 'rgba(96,165,250,0.2)', color: 'var(--bld-info)' },
  select:  { bg: 'rgba(109,40,217,0.2)', color: '#c084fc' },
  icon:    { bg: 'var(--bld-bg-elevated)', color: 'var(--bld-text-3)' },
  list:    { bg: 'rgba(34,197,94,0.15)', color: 'var(--bld-success)' },
};

function TypeBadge({ type }: { type: string }) {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.text;
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: c.bg, color: c.color, textTransform: 'none', flexShrink: 0 }}>
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
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-2)' }}>{prop.name || 'Untitled'}</span>
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--bld-text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, padding: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-input)'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
        ><IconClose /></button>
      </div>

      {/* Fields */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Name */}
        <div>
          <label style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 600, textTransform: 'none', display: 'block', marginBottom: 4 }}>Name</label>
          <input value={prop.name} onChange={e => onUpdate('name', e.target.value)} placeholder="prop name"
            style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 11 }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
          />
          <div style={{ fontSize: 9, color: 'var(--bld-text-disabled)', marginTop: 4, fontFamily: 'monospace' }}>
            context.component?.props?.[&apos;{prop.name || '…'}&apos;]
          </div>
        </div>
        {/* Type */}
        <div>
          <label style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 600, textTransform: 'none', display: 'block', marginBottom: 4 }}>Type</label>
          <select
            value={prop.type}
            onChange={e => {
              onUpdate('type', e.target.value);
              if (e.target.value === 'select' && !prop.options?.length) {
                onUpdate('options', [{ label: 'Option 1', value: 'option-1' }]);
              }
            }}
            style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 11 }}
          >
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="size">size</option>
            <option value="boolean">boolean</option>
            <option value="select">select</option>
            <option value="icon">icon</option>
            <option value="color">color</option>
            <option value="list">list</option>
            <option value="any">any (JSON)</option>
          </select>
        </div>

        {/* Select options editor */}
        {prop.type === 'select' && (
          <div>
            <label style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 600, textTransform: 'none', display: 'block', marginBottom: 4 }}>Options</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(prop.options ?? []).map((opt, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    value={opt.label}
                    onChange={e => {
                      const next = [...(prop.options ?? [])];
                      next[i] = { ...next[i], label: e.target.value };
                      onUpdate('options', next);
                    }}
                    placeholder="Label"
                    style={{ ...INPUT_BASE, padding: '3px 6px', fontSize: 10, flex: 1 }}
                  />
                  <input
                    value={opt.value}
                    onChange={e => {
                      const next = [...(prop.options ?? [])];
                      next[i] = { ...next[i], value: e.target.value };
                      onUpdate('options', next);
                    }}
                    placeholder="value"
                    style={{ ...INPUT_BASE, padding: '3px 6px', fontSize: 10, flex: 1, fontFamily: 'monospace' }}
                  />
                  <button
                    onClick={() => onUpdate('options', (prop.options ?? []).filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                  >×</button>
                </div>
              ))}
              <button
                onClick={() => onUpdate('options', [...(prop.options ?? []), { label: '', value: '' }])}
                style={{ fontSize: 10, color: 'var(--bld-info)', background: 'none', border: '1px dashed #374151', borderRadius: 4, padding: '3px 0', cursor: 'pointer', marginTop: 2 }}
              >+ Add option</button>
            </div>
          </div>
        )}

        {/* Default value — color gets controlled picker to suppress outside-click */}
        <div>
          <label style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 600, textTransform: 'none', display: 'block', marginBottom: 4 }}>Default value</label>
          {prop.type === 'color' ? (
            <FigmaColorPicker
              value={s || '#000000'}
              onChange={c => onUpdate('defaultValue', c)}
              open={colorPickerOpen}
              onOpenChange={setColorPickerOpen}
            />
          ) : prop.type === 'select' && prop.options?.length ? (
            <select
              value={String(prop.defaultValue ?? '')}
              onChange={e => onUpdate('defaultValue', e.target.value)}
              style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 11 }}
            >
              <option value="">— none —</option>
              {prop.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <DefaultValueInput type={prop.type} value={prop.defaultValue} onChange={v => onUpdate('defaultValue', v as string)} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function ContextMenu({ pos, expanded, onRename, onToggleProps, onDelete, onClose, onEdit, onPreview }:
  { pos: { x: number; y: number }; expanded: boolean; onRename: () => void; onToggleProps: () => void; onDelete: () => void; onClose: () => void; onEdit?: () => void; onPreview?: () => void }
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [onClose]);

  const item = (label: string, action: () => void, red?: boolean): React.ReactNode => (
    <button key={label}
      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: red ? 'var(--bld-error)' : 'var(--bld-text-2)', fontSize: 12, padding: '6px 14px', cursor: 'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; (e.currentTarget as HTMLElement).style.color = red ? 'var(--bld-error)' : 'var(--bld-text-1)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; (e.currentTarget as HTMLElement).style.color = red ? 'var(--bld-error)' : 'var(--bld-text-2)'; }}
      onClick={() => { action(); onClose(); }}
    >{label}</button>
  );

  return (
    <div ref={ref} style={{ position: 'fixed', top: pos.y, left: pos.x, background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 8, zIndex: 99999, minWidth: 168, padding: '4px 0', boxShadow: 'var(--bld-shadow-lg)' }} onClick={e => e.stopPropagation()}>
      {onEdit && item('Edit in canvas', onEdit)}
      {onPreview && item('Place on page', onPreview)}
      {item('Rename', onRename)}
      {item(expanded ? 'Hide properties' : 'Properties', onToggleProps)}
      <div style={{ margin: '3px 0', borderTop: 'none' }} />
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
    <div style={{ padding: '12px', borderBottom: '1px solid #374151', background: 'var(--bld-bg-panel)' }}>
      <div style={{ fontSize: 10, color: 'var(--bld-text-3)', marginBottom: 6, fontWeight: 500 }}>Component name</div>
      <input autoFocus data-testid="sc-name-input" value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') onCancel(); }}
        placeholder="e.g. Modal, Card, Drawer…"
        style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 5, color: 'var(--bld-text-1)', fontSize: 12, padding: '6px 10px', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button data-testid="sc-create-submit" onClick={create}
          style={{ flex: 1, background: 'var(--bld-accent)', border: 'none', borderRadius: 5, color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '6px 0' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bld-accent-hover)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--bld-accent)'}
        >Create</button>
        <button onClick={onCancel}
          style={{ flex: 1, background: 'none', border: '1px solid var(--bld-border-subtle)', borderRadius: 5, color: 'var(--bld-text-3)', cursor: 'pointer', fontSize: 11, padding: '6px 0' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--bld-text-3)'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--bld-border-subtle)'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
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

// ─── Properties floating panel ────────────────────────────────────────────────

function PropertiesPanel({ model, onUpdate, onClose }: {
  model: SharedComponentModel;
  onUpdate: (m: SharedComponentModel) => void;
  onClose: () => void;
}) {
  const LEFT_PANEL_WIDTH = 240;
  const [editingPropId, setEditingPropId] = useState<string | null>(null);
  const [editingPropAnchorY, setEditingPropAnchorY] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [onClose]);

  const addProp = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const p: SharedComponentProperty = {
      id: `prop-${crypto.randomUUID()}`,
      name: `prop${model.properties.length + 1}`,
      type: 'text',
      defaultValue: '',
    };
    const u = { ...model, properties: [...model.properties, p] };
    onUpdate(u); updateSCData(u);
    setEditingPropId(p.id);
    setEditingPropAnchorY(r.top);
  };

  const deleteProp = (propId: string) => {
    useBuilderStore.getState()._pushHistory();
    const u = { ...model, properties: model.properties.filter(p => p.id !== propId) };
    onUpdate(u); updateSCData(u);
    if (editingPropId === propId) setEditingPropId(null);
  };

  return (
    <div
      ref={ref}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: LEFT_PANEL_WIDTH + 8,
        top: 80,
        zIndex: 99999,
        width: 260,
        background: 'var(--bld-bg-elevated)',
        border: '1px solid var(--bld-border)',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        maxHeight: 'calc(100vh - 100px)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 9px', borderBottom: 'none', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--bld-accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-2)' }}>{model.name}</span>
          <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 400 }}>· Properties</span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, padding: 0, flexShrink: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-input)'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
        ><IconClose /></button>
      </div>

      {/* Property list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {model.properties.length === 0 && (
          <div style={{ padding: '16px 12px', fontSize: 10, color: 'var(--bld-text-3)', fontStyle: 'italic', textAlign: 'center', lineHeight: 1.6 }}>
            No properties yet.<br />Add one below.
          </div>
        )}
        {model.properties.map(prop => (
          <div
            key={prop.id}
            style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--bld-border-subtle)', background: editingPropId === prop.id ? 'var(--bld-bg-input)' : 'none' }}
            onMouseEnter={e => { if (editingPropId !== prop.id) (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
            onMouseLeave={e => { if (editingPropId !== prop.id) (e.currentTarget as HTMLElement).style.background = 'none'; }}
          >
            <button
              onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setEditingPropId(prop.id); setEditingPropAnchorY(r.top); }}
              style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 12px', background: 'none', border: 'none', cursor: 'pointer', minWidth: 0 }}
            >
              <span style={{ flex: 1, fontSize: 11, color: 'var(--bld-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{prop.name}</span>
              <TypeBadge type={prop.type} />
            </button>
            <button
              onClick={() => deleteProp(prop.id)}
              title="Delete property"
              style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', padding: '0 10px', height: 32, flexShrink: 0, fontSize: 12, display: 'flex', alignItems: 'center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-error)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
            >✕</button>
          </div>
        ))}
      </div>

      {/* Add property */}
      <button
        onClick={addProp}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 12px', background: 'none', border: 'none', borderTop: '1px solid var(--bld-border-subtle)', cursor: 'pointer', color: 'var(--bld-text-3)', fontSize: 11, fontWeight: 500, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-accent)'; (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
      >
        <IconPlus /> <span>Add property</span>
      </button>

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
    </div>
  );
}

// ─── Model Card ────────────────────────────────────────────────────────────────

function ModelRow({ model, isEditing, isPreviewing, onDelete, onUpdate, onEdit, onPreview }: ModelRowProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(model.name);
  const [showProps, setShowProps] = useState(false);
  const [cardHovered, setCardHovered] = useState(false);

  const handleRename = () => {
    const t = renameValue.trim();
    if (t && t !== model.name) { const u = { ...model, name: t }; onUpdate(u); updateSCData(u); }
    setRenaming(false);
  };

  const handleDragStart = useCallback((e: React.DragEvent) => {
    const modelContent = JSON.parse(JSON.stringify(model.content)) as Record<string, unknown>;
    stampSharedKeys(modelContent);
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
    setMenuPos({ x: Math.max(8, r.left - 168), y: r.bottom + 4 });
  };

  // Deterministic color from component name
  const thumbColor = (() => {
    const palette = ['var(--bld-accent)', '#8b5cf6', '#ec4899', 'var(--bld-success)', 'var(--bld-warning)', 'var(--bld-error)', '#06b6d4', 'var(--bld-accent)'];
    let h = 0;
    for (let i = 0; i < model.name.length; i++) h = (h * 31 + model.name.charCodeAt(i)) & 0xffff;
    return palette[h % palette.length];
  })();

  return (
    <>
      <div
        draggable onDragStart={handleDragStart}
        onMouseEnter={() => setCardHovered(true)}
        onMouseLeave={() => setCardHovered(false)}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 5,
          padding: '10px 4px 8px',
          cursor: 'grab',
          borderRadius: 'var(--bld-r-md)',
          border: `1px solid ${isEditing ? 'var(--bld-accent)' : cardHovered ? 'var(--bld-accent)' : 'var(--bld-border)'}`,
          background: isEditing ? 'var(--bld-bg-active)' : cardHovered ? 'var(--bld-bg-hover)' : 'transparent',
          userSelect: 'none',
          transition: 'border-color 0.12s, background 0.12s',
          minHeight: 64,
          overflow: 'hidden',
        }}
      >
        {/* Thumbnail */}
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: `${thumbColor}20`,
          border: `1px solid ${thumbColor}50`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: thumbColor, flexShrink: 0,
        }}>
          {model.name.slice(0, 1).toUpperCase()}
        </div>

        {/* Name / rename input */}
        {renaming ? (
          <input autoFocus value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setRenaming(false); setRenameValue(model.name); } }}
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-accent)', borderRadius: 3, color: 'var(--bld-text-1)', fontSize: 9, padding: '2px 4px', outline: 'none', textAlign: 'center', boxSizing: 'border-box' }}
          />
        ) : (
          <span style={{ fontSize: 9, fontWeight: 500, color: isEditing ? 'var(--bld-accent)' : 'var(--bld-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center', display: 'block' }}>
            {model.name}
          </span>
        )}

        {/* Hover ⋮ button */}
        {cardHovered && !renaming && (
          <div style={{ position: 'absolute', top: 3, right: 3 }}>
            <button
              onClick={openMenu}
              title="Options"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 3, background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', color: 'var(--bld-text-3)', cursor: 'pointer', padding: 0 }}
            >
              <IconDots />
            </button>
          </div>
        )}

        {/* State indicator dots */}
        {isEditing && <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: 'var(--bld-accent)' }} />}
        {isPreviewing && <div style={{ position: 'absolute', bottom: 4, left: isEditing ? 'calc(50% + 7px)' : '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: 'var(--bld-success)' }} />}
      </div>

      {/* Properties floating panel */}
      {showProps && (
        <PropertiesPanel
          model={model}
          onUpdate={m => onUpdate(m)}
          onClose={() => setShowProps(false)}
        />
      )}

      {/* Context menu */}
      {menuPos && (
        <ContextMenu
          pos={menuPos} expanded={showProps}
          onEdit={() => onEdit(model)}
          onPreview={() => onPreview(model)}
          onRename={() => { setRenaming(true); }}
          onToggleProps={() => { setShowProps(v => !v); }}
          onDelete={() => onDelete(model.id)}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function SharedComponentsTab({ onImport }: { onImport?: () => void } = {}) {
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

  if (loading) return <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', padding: 12 }}>Loading…</div>;

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px 6px 10px', borderTop: '0.5px solid var(--bld-bg-input)', borderBottom: 'none', gap: 4 }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--bld-text-2)', textTransform: 'none' }}>Shared</span>
        {/* Browse template library */}
        {onImport && (
          <button
            onClick={onImport}
            title="Browse template library"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: 'none', border: '1px solid var(--bld-border-subtle)', borderRadius: 6, color: 'var(--bld-text-3)', cursor: 'pointer', padding: 0, flexShrink: 0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--bld-accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-accent)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--bld-border-subtle)'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
          >
            {/* Stacked-layers / template library icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </button>
        )}
        {/* New shared component */}
        <button
          data-testid="sc-new-btn"
          onClick={() => setShowCreate(v => !v)}
          title="New shared component"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, background: showCreate ? 'var(--bld-accent)' : 'none', border: `1px solid ${showCreate ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`, borderRadius: 6, color: showCreate ? '#fff' : 'var(--bld-text-3)', cursor: 'pointer', padding: 0, flexShrink: 0 }}
          onMouseEnter={e => { if (!showCreate) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--bld-accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-accent)'; } }}
          onMouseLeave={e => { if (!showCreate) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--bld-border-subtle)'; (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; } }}
        >
          <IconPlus />
        </button>
      </div>

      {/* Create form */}
      {showCreate && <CreateForm onCreated={m => { handleCreated(m); setShowCreate(false); }} onCancel={() => setShowCreate(false)} />}

      {/* Empty state */}
      {models.length === 0 && !showCreate && (
        <div style={{ padding: '24px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--bld-text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
          <div style={{ fontSize: 11, color: 'var(--bld-text-2)', fontWeight: 500 }}>No shared components</div>
          <div style={{ fontSize: 10, color: 'var(--bld-text-3)', lineHeight: 1.6, maxWidth: 180 }}>Create one, or select a node on the canvas and toggle &quot;Make Shared&quot; in the right panel.</div>
        </div>
      )}

      {/* List */}
      <div data-testid="sc-models-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: '4px 8px 8px' }}>
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
