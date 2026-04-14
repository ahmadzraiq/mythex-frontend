'use client';

/**
 * Shared Components Tab — left panel "Shared" tab.
 *
 * Manages shared component models: components defined once and reusable across pages.
 * Each shared component has:
 *   - A content subtree (edited in-canvas, same pattern as popups)
 *   - A properties list (name, type, defaultValue) — passed as context.component.props.*
 *
 * Shared component instances on other pages use:
 *   { "type": "SharedComponent", "props": { "componentId": "sc-id", "propName": "value" } }
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import {
  getSharedComponentList,
  createSharedComponent,
  updateSharedComponent as updateSCData,
  deleteSharedComponent,
  subscribeSharedComponents,
} from '@/lib/builder/shared-component-data';
import type { SharedComponentModel, SharedComponentProperty } from '@/lib/builder/shared-component-data';

// ─── ID population utility ───────────────────────────────────────────────────

function ensureNodeIds(node: Record<string, unknown>): { node: Record<string, unknown>; changed: boolean } {
  let changed = false;
  let result = node;
  if (!node.id) {
    result = { ...node, id: crypto.randomUUID() };
    changed = true;
  }
  const children = (result.children ?? []) as Record<string, unknown>[];
  if (children.length > 0) {
    const newChildren: Record<string, unknown>[] = [];
    for (const child of children) {
      const r = ensureNodeIds(child);
      newChildren.push(r.node);
      if (r.changed) changed = true;
    }
    if (changed) result = { ...result, children: newChildren };
  }
  return { node: result, changed };
}

// ─── Starter content template ────────────────────────────────────────────────

function makeStarterContent(): Record<string, unknown> {
  return {
    type: 'Box',
    name: 'Component',
    props: { className: 'flex flex-col w-full' },
    children: [
      {
        type: 'Text',
        props: { className: 'text-[16px] font-semibold text-gray-900 dark:text-white' },
        text: 'Shared Component',
      },
    ],
  };
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', borderBottom: '1px solid #1f2937',
  } as React.CSSProperties,
  sectionLabel: {
    fontSize: 10, fontWeight: 700, color: '#9ca3af',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
  } as React.CSSProperties,
  emptyText: {
    fontSize: 11, color: '#4b5563', fontStyle: 'italic', padding: '8px 12px',
  } as React.CSSProperties,
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 12px', borderBottom: '1px solid #111827', cursor: 'default',
  } as React.CSSProperties,
  rowName: {
    fontSize: 11, color: '#d1d5db', flex: 1, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  actionBtn: {
    background: 'none', border: 'none', color: '#6b7280',
    cursor: 'pointer', fontSize: 10, padding: '2px 4px', borderRadius: 3,
  } as React.CSSProperties,
  addBtn: {
    background: 'none', border: '1px solid #374151', borderRadius: 3,
    color: '#9ca3af', cursor: 'pointer', fontSize: 10, padding: '2px 8px',
  } as React.CSSProperties,
  sharedBadge: {
    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
    background: '#1e3a5f', color: '#60a5fa', flexShrink: 0,
    marginRight: 6, textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  } as React.CSSProperties,
};

// ─── Context sync ────────────────────────────────────────────────────────────

function syncSharedComponentContext(props: Record<string, unknown>) {
  getGlobalVariableStore().getState().setState(prev => ({
    ...prev,
    context: { component: { props } },
  }));
}

function clearSharedComponentContext() {
  getGlobalVariableStore().getState().setState(prev => {
    const next = { ...prev };
    delete next.context;
    return next;
  });
}

// ─── Create Form ─────────────────────────────────────────────────────────────

interface CreateFormProps {
  onCreated: (model: SharedComponentModel) => void;
  onCancel: () => void;
}

function CreateForm({ onCreated, onCancel }: CreateFormProps) {
  const [name, setName] = useState('');

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `sc-${crypto.randomUUID()}`;
    const model = createSharedComponent({
      id,
      name: trimmed,
      properties: [],
      content: makeStarterContent(),
    });
    onCreated(model);
  }, [name, onCreated]);

  return (
    <div style={{ padding: '8px 12px 12px', borderBottom: '1px solid #1f2937' }}>
      <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>New shared component name:</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          autoFocus
          data-testid="sc-name-input"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') onCancel(); }}
          placeholder="e.g. Main Navbar"
          style={{
            flex: 1, background: '#111827', border: '1px solid #374151',
            borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 8px',
          }}
        />
        <button data-testid="sc-create-submit" style={{ ...S.addBtn, background: '#1d4ed8', borderColor: '#1d4ed8', color: '#fff' }} onClick={handleCreate}>Create</button>
        <button style={S.addBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Properties Editor ────────────────────────────────────────────────────────

interface PropertiesEditorProps {
  model: SharedComponentModel;
  onUpdate: (updated: SharedComponentModel) => void;
}

function PropertiesEditor({ model, onUpdate }: PropertiesEditorProps) {
  const addProperty = useCallback(() => {
    const newProp: SharedComponentProperty = {
      id: `prop-${crypto.randomUUID()}`,
      name: `prop${model.properties.length + 1}`,
      type: 'string',
      defaultValue: '',
    };
    const updated = { ...model, properties: [...model.properties, newProp] };
    onUpdate(updated);
    updateSCData(updated);
  }, [model, onUpdate]);

  const updateProp = useCallback((propId: string, field: keyof SharedComponentProperty, value: string) => {
    const updated = {
      ...model,
      properties: model.properties.map(p => p.id === propId ? { ...p, [field]: value } : p),
    };
    onUpdate(updated);
    updateSCData(updated);
  }, [model, onUpdate]);

  const removeProp = useCallback((propId: string) => {
    const updated = { ...model, properties: model.properties.filter(p => p.id !== propId) };
    onUpdate(updated);
    updateSCData(updated);
  }, [model, onUpdate]);

  return (
    <div style={{ padding: '0 12px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Properties</span>
        <button style={S.addBtn} onClick={addProperty}>+ New</button>
      </div>
      {model.properties.length === 0 && (
        <div style={S.emptyText}>No properties. Add one to pass dynamic data to this component.</div>
      )}
      {model.properties.map(prop => (
        <div key={prop.id} style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
          <input
            value={prop.name}
            onChange={e => updateProp(prop.id, 'name', e.target.value)}
            placeholder="name"
            style={{ flex: 2, background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 10, padding: '3px 6px' }}
          />
          <select
            value={prop.type}
            onChange={e => updateProp(prop.id, 'type', e.target.value)}
            style={{ flex: 1, background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 10, padding: '3px 4px' }}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="object">object</option>
            <option value="array">array</option>
          </select>
          <input
            value={String(prop.defaultValue ?? '')}
            onChange={e => updateProp(prop.id, 'defaultValue', e.target.value)}
            placeholder="default"
            style={{ flex: 2, background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 10, padding: '3px 6px' }}
          />
          <button style={{ ...S.actionBtn, color: '#ef4444', fontSize: 12 }} onClick={() => removeProp(prop.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── Model Row ────────────────────────────────────────────────────────────────

interface ModelRowProps {
  model: SharedComponentModel;
  isEditing: boolean;
  onDelete: (id: string) => void;
  onUpdate: (updated: SharedComponentModel) => void;
  onEdit: (model: SharedComponentModel) => void;
}

function ModelRow({ model, isEditing, onDelete, onUpdate, onEdit }: ModelRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(model.name);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-sc-menu]')) setMenuOpen(false);
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [menuOpen]);

  const handleRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === model.name) { setRenaming(false); return; }
    const updated = { ...model, name: trimmed };
    onUpdate(updated);
    updateSCData(updated);
    setRenaming(false);
  }, [renameValue, model, onUpdate]);

  return (
    <>
      <div
        style={{ ...S.row }}
        onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        <span style={S.sharedBadge}>SC</span>
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setRenaming(false); setRenameValue(model.name); } }}
            style={{ flex: 1, background: '#111827', border: '1px solid #3b82f6', borderRadius: 3, color: '#f3f4f6', fontSize: 11, padding: '1px 4px' }}
          />
        ) : (
          <span style={{ ...S.rowName, cursor: 'pointer' }} onClick={() => setExpanded(v => !v)}>
            {model.name}
          </span>
        )}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
          {!renaming && (
            <button
              style={{
                ...S.actionBtn, fontSize: 9, borderRadius: 3, padding: '2px 6px',
                border: isEditing ? '1px solid #ef4444' : '1px solid #3b82f6',
                color: isEditing ? '#ef4444' : '#3b82f6',
              }}
              onClick={() => onEdit(model)}
              title={isEditing ? 'Close editor' : 'Edit content in canvas'}
            >
              {isEditing ? 'Close' : 'Edit'}
            </button>
          )}
          <div style={{ position: 'relative' }} data-sc-menu>
            <button
              style={{ ...S.actionBtn, fontSize: 14, padding: '0 4px' }}
              onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
            >
              ⋮
            </button>
            {menuOpen && (
              <div
                data-sc-menu
                style={{ position: 'absolute', right: 0, top: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, zIndex: 9999, minWidth: 100, padding: '4px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#d1d5db', fontSize: 11, padding: '5px 12px', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                  onClick={() => { setRenaming(true); setExpanded(true); setMenuOpen(false); }}
                >
                  Rename
                </button>
                <button
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#d1d5db', fontSize: 11, padding: '5px 12px', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                  onClick={() => { setExpanded(v => !v); setMenuOpen(false); }}
                >
                  {expanded ? 'Hide properties' : 'Show properties'}
                </button>
                <button
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ef4444', fontSize: 11, padding: '5px 12px', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                  onClick={() => { onDelete(model.id); setMenuOpen(false); }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {expanded && (
        <PropertiesEditor model={model} onUpdate={onUpdate} />
      )}
    </>
  );
}

// ─── Draggable instance card for placing on pages ─────────────────────────────

function DraggableInstanceCard({ model }: { model: SharedComponentModel }) {
  const handleDragStart = useCallback((e: React.DragEvent) => {
    const instanceNode: Record<string, unknown> = {
      id: crypto.randomUUID(),
      type: 'SharedComponent',
      name: model.name,
      props: {
        componentId: model.id,
        // Include default values for all declared properties
        ...Object.fromEntries(model.properties.map(p => [p.name, p.defaultValue ?? ''])),
      },
      children: [],
    };
    const data = JSON.stringify(instanceNode);
    e.dataTransfer.setData('text/primitive-node', data);
    e.dataTransfer.effectAllowed = 'copy';
    // CDP/Playwright fallback (same pattern as _components-tab.tsx)
    (window as unknown as Record<string, unknown>).__primitiveDrag = data;
  }, [model]);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 12px', borderBottom: '1px solid #111827',
        cursor: 'grab', userSelect: 'none',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
      title={`Drag to place "${model.name}" on the canvas`}
    >
      <span style={{ fontSize: 12, color: '#6b7280' }}>⠿</span>
      <span style={{ fontSize: 10, color: '#9ca3af', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {model.name}
      </span>
      <span style={{ fontSize: 9, color: '#4b5563' }}>drag</span>
    </div>
  );
}

// ─── Main SharedComponentsTab ─────────────────────────────────────────────────

export function SharedComponentsTab() {
  const [models, setModels] = useState<SharedComponentModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const {
    enterSharedComponentEdit, exitSharedComponentEdit, saveEditingSharedComponent,
    editingSharedComponentIds, pageNodes,
  } = useBuilderStore();

  // Auto-save on canvas changes (debounced 800ms)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingIdsRef = useRef(editingSharedComponentIds);
  const saveRef = useRef(saveEditingSharedComponent);
  useEffect(() => { editingIdsRef.current = editingSharedComponentIds; }, [editingSharedComponentIds]);
  useEffect(() => { saveRef.current = saveEditingSharedComponent; }, [saveEditingSharedComponent]);

  useEffect(() => {
    if (editingIdsRef.current.length === 0) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      editingIdsRef.current.forEach(id => saveRef.current(id));
    }, 800);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNodes]);

  useEffect(() => {
    setModels(getSharedComponentList());
    setLoading(false);
    return subscribeSharedComponents(() => setModels(getSharedComponentList()));
  }, []);

  const handleCreated = useCallback((model: SharedComponentModel) => {
    setModels(prev => [...prev, model]);
    handleEdit(model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (editingSharedComponentIds.includes(id)) {
      exitSharedComponentEdit(id);
    }
    deleteSharedComponent(id);
    setModels(prev => prev.filter(m => m.id !== id));
    const remaining = editingSharedComponentIds.filter(eid => eid !== id);
    if (remaining.length === 0) clearSharedComponentContext();
  }, [editingSharedComponentIds, exitSharedComponentEdit]);

  const handleUpdate = useCallback((updated: SharedComponentModel) => {
    setModels(prev => prev.map(m => m.id === updated.id ? updated : m));
  }, []);

  const handleEdit = useCallback(async (model: SharedComponentModel) => {
    if (editingSharedComponentIds.includes(model.id)) {
      exitSharedComponentEdit(model.id);
      const remaining = editingSharedComponentIds.filter(id => id !== model.id);
      if (remaining.length === 0) clearSharedComponentContext();
      return;
    }

    // Ensure every node has an ID for builder hit-test and layer selection
    const { node: populatedContent, changed } = ensureNodeIds(model.content as Record<string, unknown>);
    let editModel = model;
    if (changed) {
      editModel = { ...model, content: populatedContent as SharedComponentModel['content'] };
      updateSCData(editModel);
      setModels(prev => prev.map(m => m.id === editModel.id ? editModel : m));
    }

    // Build default props from declared properties and sync to variable store
    const defaultProps: Record<string, unknown> = {};
    for (const p of editModel.properties) {
      defaultProps[p.name] = p.defaultValue ?? '';
    }
    syncSharedComponentContext(defaultProps);

    enterSharedComponentEdit(
      editModel.id,
      editModel.content as unknown as SDUINode,
      editModel as unknown as Record<string, unknown>
    );
  }, [editingSharedComponentIds, exitSharedComponentEdit, enterSharedComponentEdit]);

  if (loading) {
    return <div style={S.emptyText}>Loading…</div>;
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={S.sectionHeader}>
        <span style={S.sectionLabel}>Shared Components</span>
        <button data-testid="sc-new-btn" style={S.addBtn} onClick={() => setShowCreate(v => !v)}>+ New</button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateForm
          onCreated={m => { handleCreated(m); setShowCreate(false); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Model list */}
      {models.length === 0 && !showCreate && (
        <div style={S.emptyText}>
          No shared components yet. Create one or select a node on the canvas and use &quot;Make Shared&quot; to add it here.
        </div>
      )}

      <div data-testid="sc-models-list">
        {models.map(model => (
          <ModelRow
            key={model.id}
            model={model}
            isEditing={editingSharedComponentIds.includes(model.id)}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            onEdit={handleEdit}
          />
        ))}
      </div>

      {/* Place instances section */}
      {models.length > 0 && (
        <>
          <div style={{ ...S.sectionHeader, marginTop: 8 }}>
            <span style={S.sectionLabel}>Drag to Place</span>
          </div>
          <div style={{ fontSize: 10, color: '#4b5563', padding: '6px 12px 4px' }}>
            Drag a shared component onto the canvas to place an instance on the current page.
          </div>
          {models.map(model => (
            <DraggableInstanceCard key={model.id} model={model} />
          ))}
        </>
      )}
    </div>
  );
}
