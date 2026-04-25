'use client';

/**
 * _component-editor.tsx
 *
 * weWeb-style component authoring UI for the right panel.
 *
 * Phase 2: CreateComponentPopover — shown when "+ New" is clicked in the right panel
 *          top chrome. Collects name / folder / description then calls
 *          createSharedComponent + enterSharedComponentEdit.
 *
 * Phase 3: ComponentEditorChrome — replaces the normal right-panel header when
 *          editingSharedComponentId is set. Shows "Back to instance" + component
 *          name + kebab menu, and a scoped icon tab bar.
 *
 * Phase 4: Scoped section editors inside the component editor:
 *          • Properties  — name, type, default value for context.component.props.*
 *          • Variables   — label, type, initialValue stored on model.variables
 *          • Formulas    — name, expression stored on model.formulas
 *          • Workflows   — list of component workflows; opens WorkflowCanvas
 *
 * Usage:
 *   <NewComponentButton selectedNode={...} />   — rendered in _panel-right.tsx top chrome
 *   <ComponentEditorPanel />                    — rendered in _panel-right.tsx when editing
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useBuilderStore } from './_store';
import { useShallow } from 'zustand/react/shallow';
import {
  getSharedComponents,
  createSharedComponent,
  updateSharedComponent,
} from '@/lib/builder/shared-component-data';
import {
  getSystemComponents,
  updateSystemComponent,
  resetSystemComponent,
} from '@/lib/builder/system-component-data';
import type {
  SharedComponentModel,
  SharedComponentProperty,
  ScopedVarDef,
  ScopedFormulaDef,
  ScopedWorkflow,
  ComponentTrigger,
} from '@/lib/builder/shared-component-data';
import type { SDUINode } from '@/lib/sdui/types/node';
import { WorkflowCanvas } from './_workflow-canvas';
import { FigmaColorPicker } from './_color-picker';
import { ElementWorkflowsTab } from './_panel-right-workflows';
import { VariableSlideContent, getDefaultForType } from './_variable-form';
import { FormulaSlideBase } from './_logic-tab';
import { Chevron } from './_layers-panel';
import { BoundField } from './_workflow-node-configs';
import type { FormulaValue } from '@/lib/sdui/formula-evaluator';
import type { CustomVar } from './_store';
import type { GlobalFormulaParam } from './_store-types';

// ─── Store helpers (kind-aware) ───────────────────────────────────────────────

/**
 * Read the current `editingKind` from the builder store and return the right
 * model-getter / updater. The component editor treats shared and system
 * components identically except for which in-memory store they read/write.
 */
function getEditingModel(modelId: string): SharedComponentModel | null {
  const kind = useBuilderStore.getState().editingKindMap[modelId]
    ?? useBuilderStore.getState().editingKind;
  if (kind === 'system') return (getSystemComponents()[modelId] as SharedComponentModel | undefined) ?? null;
  return (getSharedComponents()[modelId] as SharedComponentModel | undefined) ?? null;
}

function updateEditingModel(patch: Partial<SharedComponentModel> & { id: string }) {
  const kind = useBuilderStore.getState().editingKindMap[patch.id]
    ?? useBuilderStore.getState().editingKind;
  if (kind === 'system') return updateSystemComponent(patch as Partial<SharedComponentModel> & { id: string }) as unknown as SharedComponentModel | null;
  return updateSharedComponent(patch);
}

// ─── Shared palette ───────────────────────────────────────────────────────────

const INPUT_BASE: React.CSSProperties = {
  background: '#1f2937', border: '1px solid #374151', borderRadius: 5,
  color: '#e5e7eb', fontSize: 12, padding: '6px 10px', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: '6px 14px', background: '#3b82f6', border: 'none', borderRadius: 5,
  color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600,
};

const BTN_GHOST: React.CSSProperties = {
  padding: '6px 12px', background: 'none', border: '1px solid #374151', borderRadius: 5,
  color: '#9ca3af', fontSize: 12, cursor: 'pointer',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10, color: '#6b7280', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.07em',
  display: 'block', marginBottom: 4,
};

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconClose = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconPlus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconChevronLeft = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
);

const IconDots = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
  </svg>
);

const IconEdit = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

// ─── Type badge ───────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  text:    { bg: '#374151', text: '#f9fafb' },
  number:  { bg: '#1d4ed8', text: '#dbeafe' },
  boolean: { bg: '#6d28d9', text: '#ede9fe' },
  color:   { bg: '#b45309', text: '#fef3c7' },
  any:     { bg: '#065f46', text: '#d1fae5' },
  string:  { bg: '#374151', text: '#f9fafb' },
  object:  { bg: '#7c3aed', text: '#ede9fe' },
  array:   { bg: '#be185d', text: '#fce7f3' },
};

function TypeBadge({ type }: { type: string }) {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.text;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
      background: c.bg, color: c.text,
      textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
    }}>
      {type}
    </span>
  );
}

// ─── Section header with count + New button ───────────────────────────────────

function SectionBar({
  label, count, onNew, newTestId,
}: {
  label: string; count: number; onNew: (e: React.MouseEvent) => void; newTestId?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        {count > 0 && (
          <span style={{ fontSize: 9, background: '#1f2937', color: '#6b7280', borderRadius: 10, padding: '1px 6px', fontWeight: 600 }}>
            {count}
          </span>
        )}
      </div>
      <button
        data-testid={newTestId}
        onClick={e => { e.stopPropagation(); onNew(e); }}
        title={`Add ${label.toLowerCase()}`}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, background: 'none', border: 'none', borderRadius: 4, color: '#6b7280', cursor: 'pointer' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1f2937'; (e.currentTarget as HTMLElement).style.color = '#e5e7eb'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = '#6b7280'; }}
      >
        <IconPlus />
      </button>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ padding: '4px 12px 8px', fontSize: 11, color: '#4b5563', fontStyle: 'italic' }}>
      No {label} defined
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PHASE 2: Create Component Popover
// ──────────────────────────────────────────────────────────────────────────────

interface CreateComponentPopoverProps {
  anchorRect: DOMRect;
  /** The node to convert into a component */
  sourceNode: SDUINode;
  onClose: () => void;
}

export function CreateComponentPopover({ anchorRect, sourceNode, onClose }: CreateComponentPopoverProps) {
  const store = useBuilderStore();
  const { enterSharedComponentEdit } = useBuilderStore(
    useShallow(s => ({ enterSharedComponentEdit: s.enterSharedComponentEdit }))
  );

  const [name, setName] = useState((sourceNode as unknown as Record<string, unknown>).name as string || (sourceNode.type as string) || 'My Component');
  const [folder, setFolder] = useState('');
  const [description, setDescription] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Collect existing folder names for datalist
  const existingFolders = useMemo(() => {
    const sc = getSharedComponents();
    const folders = new Set<string>();
    Object.values(sc).forEach(m => { if (m.folder) folders.add(m.folder); });
    return Array.from(folders).sort();
  }, []);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [onClose]);

  // Position: below right panel top
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 6,
    right: window.innerWidth - anchorRect.right,
    width: 280,
    background: '#111827',
    border: '1px solid #374151',
    borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    zIndex: 99999,
    display: 'flex',
    flexDirection: 'column',
  };

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const scId = `sc-${crypto.randomUUID()}`;
    // Clone source node content, strip _shared + _overrides metadata
    const content = JSON.parse(JSON.stringify(sourceNode)) as Record<string, unknown>;
    delete content._shared;
    delete content._overrides;
    // Stamp stable _sharedKey on every node in the model content. Mirror the
    // same keys onto the source node (now the first instance) so they share
    // identity 1:1.
    import('./_store-node-helpers').then(nh => {
      nh.stampSharedKeys(content);
      const stampInstance = (inst: Record<string, unknown>, model: Record<string, unknown>) => {
        if (typeof model._sharedKey === 'string') {
          store.patchNodeField(inst.id as string, '_sharedKey', model._sharedKey);
        }
        const iChildren = (inst.children ?? []) as Record<string, unknown>[];
        const mChildren = (model.children ?? []) as Record<string, unknown>[];
        for (let i = 0; i < iChildren.length && i < mChildren.length; i++) stampInstance(iChildren[i], mChildren[i]);
      };
      stampInstance(sourceNode as unknown as Record<string, unknown>, content);
    }).catch(() => {});

    createSharedComponent({
      id: scId,
      name: name.trim(),
      folder: folder.trim() || undefined,
      description: description.trim() || undefined,
      properties: [],
      variables: {},
      formulas: {},
      workflows: {},
      content,
    });

    // Attach _shared marker (and empty override list) to the source node in the page
    const sourceId = (sourceNode as unknown as { id?: string }).id ?? '';
    store.patchNodeField(sourceId, '_shared', { id: scId, name: name.trim() });
    store.patchNodeField(sourceId, '_overrides', []);

    // Enter edit mode — simple mode: no backdrop, component stays in place
    const model = getSharedComponents()[scId];
    if (model) {
      enterSharedComponentEdit(
        scId,
        content as unknown as SDUINode,
        model as unknown as Record<string, unknown>,
        (sourceNode as unknown as { id?: string }).id,
        true, // simple mode: no backdrop/canvas overlay
      );
    }
    onClose();
  }, [name, folder, description, sourceNode, store, enterSharedComponentEdit, onClose]);

  return (
    <div
      ref={ref}
      style={style}
      data-testid="create-component-popover"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e5e7eb' }}>Create Component</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', padding: 2, borderRadius: 3 }}>
          <IconClose />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={SECTION_LABEL}>Name *</label>
          <input
            data-testid="create-component-popover-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Component name"
            autoFocus
            style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 12 }}
            onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
            onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
          />
        </div>
        <div>
          <label style={SECTION_LABEL}>Folder</label>
          <input
            data-testid="create-component-popover-folder"
            list="sc-folders"
            value={folder}
            onChange={e => setFolder(e.target.value)}
            placeholder="e.g. Cards, Layout…"
            style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 12 }}
            onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
            onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
          />
          {existingFolders.length > 0 && (
            <datalist id="sc-folders">
              {existingFolders.map(f => <option key={f} value={f} />)}
            </datalist>
          )}
        </div>
        <div>
          <label style={SECTION_LABEL}>Description</label>
          <textarea
            data-testid="create-component-popover-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What does this component do?"
            rows={2}
            style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 12, resize: 'vertical' }}
            onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
            onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button type="button" onClick={onClose} style={BTN_GHOST}>Cancel</button>
          <button
            type="submit"
            data-testid="create-component-popover-submit"
            disabled={!name.trim()}
            style={{ ...BTN_PRIMARY, opacity: name.trim() ? 1 : 0.5 }}
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PHASE 3: Component Editor Chrome
// ──────────────────────────────────────────────────────────────────────────────

type ComponentEditorTab = 'component' | 'edit' | 'workflow';

interface ComponentEditorPanelProps {
  /** The currently selected node inside the component (used for Workflow tab) */
  selectedNode?: SDUINode | null;
  /** The rendered DesignTab content for the selected node — passed from PanelRight to avoid circular imports */
  editTabContent?: React.ReactNode;
}

export function ComponentEditorPanel({ selectedNode, editTabContent }: ComponentEditorPanelProps) {
  const [tab, setTab] = useState<ComponentEditorTab>('component');
  const [kebabOpen, setKebabOpen] = useState(false);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [openWorkflowId, setOpenWorkflowId] = useState<string | null>(null);

  const {
    editingSharedComponentId,
    saveEditingSharedComponent,
    exitSharedComponentEdit,
    _editEntrySelection,
    select,
  } = useBuilderStore(useShallow(s => ({
    editingSharedComponentId: s.editingSharedComponentId,
    saveEditingSharedComponent: s.saveEditingSharedComponent,
    exitSharedComponentEdit: s.exitSharedComponentEdit,
    _editEntrySelection: s._editEntrySelection,
    select: s.select,
  })));

  const modelId = editingSharedComponentId;
  const [tick, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  // Subscribe to BOTH shared-component and system-component stores so the
  // editor repaints regardless of which data layer the model lives in.
  useEffect(() => {
    const sc = require('@/lib/builder/shared-component-data') as typeof import('@/lib/builder/shared-component-data');
    const sys = require('@/lib/builder/system-component-data') as typeof import('@/lib/builder/system-component-data');
    const unsubSc = sc.subscribeSharedComponents(forceUpdate);
    const unsubSys = sys.subscribeSystemComponents(forceUpdate);
    return () => { unsubSc(); unsubSys(); };
  }, [forceUpdate]);

  // Include `tick` so the model refreshes whenever the model data store updates
  const model: SharedComponentModel | null = useMemo(() => {
    if (!modelId) return null;
    return getEditingModel(modelId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, tick]);

  const handleBackToInstance = useCallback(() => {
    if (!modelId) return;
    saveEditingSharedComponent(modelId);
    exitSharedComponentEdit(modelId);
    // Restore the selection to the instance the user came from
    if (_editEntrySelection?.nodeId) {
      select(_editEntrySelection.nodeId);
    }
  }, [modelId, saveEditingSharedComponent, exitSharedComponentEdit, _editEntrySelection, select]);

  // Close kebab on outside click
  useEffect(() => {
    if (!kebabOpen) return;
    const h = (e: MouseEvent) => {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) setKebabOpen(false);
    };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [kebabOpen]);

  const handleRename = useCallback(() => {
    if (!model || !modelId) return;
    setRenameDraft(model.name);
    setRenaming(true);
    setKebabOpen(false);
  }, [model, modelId]);

  const commitRename = useCallback(() => {
    if (!modelId || !renameDraft.trim()) { setRenaming(false); return; }
    updateEditingModel({ id: modelId, name: renameDraft.trim() });
    setRenaming(false);
  }, [modelId, renameDraft]);

  if (!modelId || !model) return null;

  const PANEL_STYLE: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    background: '#0f172a',
  };

  const tabData: Array<{ id: ComponentEditorTab; label: string; icon: React.ReactNode; testId: string }> = [
    {
      id: 'component',
      label: 'Component',
      testId: 'sc-tab-component',
      icon: (
        // Puzzle piece icon
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      ),
    },
    {
      id: 'edit',
      label: 'Edit',
      testId: 'sc-tab-edit',
      icon: (
        // Pencil icon
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      ),
    },
    {
      id: 'workflow',
      label: 'Workflow',
      testId: 'sc-tab-workflow',
      icon: (
        // Lightning bolt icon
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      ),
    },
  ];

  return (
    <div style={PANEL_STYLE} data-testid="component-editor-panel">
      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
        borderBottom: '1px solid #1f2937', flexShrink: 0,
      }}>
        {/* Back to instance */}
        <button
          data-testid="back-to-instance-btn"
          onClick={handleBackToInstance}
          title="Back to instance"
          style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px',
            background: 'none', border: '1px solid #374151', borderRadius: 5,
            color: '#9ca3af', fontSize: 11, cursor: 'pointer', flexShrink: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#3b82f6'; (e.currentTarget as HTMLElement).style.color = '#60a5fa'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#374151'; (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
        >
          <IconChevronLeft />
          <span>Back</span>
        </button>

        {/* Component name (editable) */}
        {renaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={e => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
            style={{ flex: 1, background: '#1f2937', border: '1px solid #3b82f6', borderRadius: 4, color: '#e5e7eb', fontSize: 11, padding: '2px 6px', outline: 'none', minWidth: 0 }}
          />
        ) : (
          <span
            onClick={handleRename}
            title="Click to rename"
            style={{ flex: 1, fontSize: 11, fontWeight: 600, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', minWidth: 0 }}
          >
            {model.name}
          </span>
        )}

        {/* Kebab menu */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            ref={kebabRef}
            onClick={e => { e.stopPropagation(); setKebabOpen(o => !o); }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, background: 'none', border: 'none', borderRadius: 4, color: '#6b7280', cursor: 'pointer' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#e5e7eb'; (e.currentTarget as HTMLElement).style.background = '#1f2937'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#6b7280'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
          >
            <IconDots />
          </button>
          {kebabOpen && (
            <ComponentKebabMenu
              model={model}
              onRename={handleRename}
              onClose={() => setKebabOpen(false)}
            />
          )}
        </div>
      </div>

      {/* ── Scoped tab bar ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {tabData.map(t => (
          <button
            key={t.id}
            data-testid={t.testId}
            title={t.label}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '8px 0', background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent',
              color: tab === t.id ? '#f3f4f6' : '#6b7280',
              cursor: 'pointer', marginBottom: -1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {/* ── Tab bodies ── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 'component' && (
          <ComponentDefinitionTab
            model={model}
            modelId={modelId}
            openWorkflowId={openWorkflowId}
            onOpenWorkflow={setOpenWorkflowId}
          />
        )}
        {tab === 'edit' && (
          editTabContent ?? (
            <div style={{ padding: 16, fontSize: 11, color: '#4b5563', textAlign: 'center' }}>
              Select a node inside the component to edit
            </div>
          )
        )}
        {tab === 'workflow' && (
          <ElementWorkflowsTab node={selectedNode ?? null} />
        )}
      </div>

      {/* Workflow canvas overlay */}
      {openWorkflowId && (
        <WorkflowCanvas
          target={{ kind: 'componentWorkflow', modelId, workflowId: openWorkflowId }}
          onClose={() => setOpenWorkflowId(null)}
        />
      )}
    </div>
  );
}

// ─── Kebab menu ───────────────────────────────────────────────────────────────

function ComponentKebabMenu({ model, onRename, onClose }: {
  model: SharedComponentModel;
  onRename: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { updateSharedComponent: _u } = { updateSharedComponent }; void _u;

  const exitSharedComponentEdit = useBuilderStore(s => s.exitSharedComponentEdit);
  const editingKind = useBuilderStore(s => s.editingKindMap[model.id] ?? s.editingKind);
  const isSystem = editingKind === 'system';

  const [showDescEditor, setShowDescEditor] = useState(false);
  const [desc, setDesc] = useState(model.description ?? '');

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
    fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none',
    color: '#e5e7eb', width: '100%', textAlign: 'left', borderRadius: 0,
  };

  if (showDescEditor) {
    return (
      <div ref={ref} onClick={e => e.stopPropagation()} style={{
        position: 'absolute', right: 0, top: 26, zIndex: 10001,
        background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)', width: 220, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <label style={SECTION_LABEL}>Description</label>
        <textarea
          autoFocus
          value={desc}
          onChange={e => setDesc(e.target.value)}
          rows={3}
          style={{ ...INPUT_BASE, fontSize: 11, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ ...BTN_GHOST, padding: '4px 10px', fontSize: 11 }}>Cancel</button>
          <button type="button" onClick={() => {
            updateEditingModel({ id: model.id, description: desc.trim() || undefined });
            onClose();
          }} style={{ ...BTN_PRIMARY, padding: '4px 10px', fontSize: 11 }}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} onClick={e => e.stopPropagation()} style={{
      position: 'absolute', right: 0, top: 26, zIndex: 10001,
      background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)', minWidth: 160, overflow: 'hidden',
    }}>
      <button style={itemStyle} onClick={onRename}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#374151'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
      >
        <IconEdit /> Rename
      </button>
      <button style={itemStyle} onClick={() => setShowDescEditor(true)}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#374151'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
      >
        <IconEdit /> Edit description
      </button>
      {isSystem && (
        <button style={{ ...itemStyle, color: '#f59e0b' }}
          onClick={() => {
            if (!window.confirm(`Reset "${model.name}" to the built-in default? All your edits to this system component will be lost.`)) return;
            resetSystemComponent(model.id);
            onClose();
            exitSharedComponentEdit(model.id);
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#374151'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <IconEdit /> Reset to default
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Component tab — merges Properties + Variables + Workflows + Formulas
// ──────────────────────────────────────────────────────────────────────────────

function ComponentDefinitionTab({ model, modelId, openWorkflowId, onOpenWorkflow }: {
  model: SharedComponentModel;
  modelId: string;
  openWorkflowId: string | null;
  onOpenWorkflow: (id: string | null) => void;
}) {
  return (
    <div>
      {/* Component meta header */}
      {(model.description || model.folder) && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #1f2937' }}>
          {model.folder && (
            <div style={{ marginBottom: model.description ? 4 : 0 }}>
              <span style={{ fontSize: 9, background: '#1f2937', color: '#6b7280', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }}>
                {model.folder}
              </span>
            </div>
          )}
          {model.description && (
            <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
              {model.description}
            </div>
          )}
        </div>
      )}

      {/* Properties section */}
      <PropertiesSection model={model} modelId={modelId} />

      <div style={{ borderTop: '1px solid #1f2937' }} />

      {/* Variables section */}
      <VariablesSection model={model} modelId={modelId} />

      <div style={{ borderTop: '1px solid #1f2937' }} />

      {/* Workflows section */}
      <ActionsTab
        model={model}
        modelId={modelId}
        openWorkflowId={openWorkflowId}
        onOpenWorkflow={onOpenWorkflow}
      />

      <div style={{ borderTop: '1px solid #1f2937' }} />

      {/* Triggers (custom component events) */}
      <TriggersSection model={model} modelId={modelId} />

      <div style={{ borderTop: '1px solid #1f2937' }} />

      {/* Formulas section */}
      <FormulasSection model={model} modelId={modelId} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PHASE 4: Settings Tab (Properties) — kept for internal use by ComponentDefinitionTab
// ──────────────────────────────────────────────────────────────────────────────

/** Properties-only section extracted from SettingsTab for use in ComponentDefinitionTab */
function PropertiesSection({ model, modelId }: { model: SharedComponentModel; modelId: string }) {
  const [popupProp, setPopupProp] = useState<{ prop: SharedComponentProperty; anchorY: number } | null>(null);

  const handleNewProperty = useCallback((e: React.MouseEvent) => {
    const newProp: SharedComponentProperty = {
      id: crypto.randomUUID(),
      name: 'newProp',
      type: 'text',
      defaultValue: '',
    };
    const props = [...(model.properties ?? []), newProp];
    updateEditingModel({ id: modelId, properties: props });
    setPopupProp({ prop: newProp, anchorY: e.clientY });
  }, [model, modelId]);

  const handleUpdateProp = useCallback((propId: string, field: keyof SharedComponentProperty, val: unknown) => {
    const props = (model.properties ?? []).map(p => p.id === propId ? { ...p, [field]: val } : p);
    updateEditingModel({ id: modelId, properties: props });
    setPopupProp(prev => prev ? { ...prev, prop: { ...prev.prop, [field]: val } } : null);
  }, [model, modelId]);

  const handleDeleteProp = useCallback((propId: string) => {
    const props = (model.properties ?? []).filter(p => p.id !== propId);
    updateEditingModel({ id: modelId, properties: props });
    setPopupProp(null);
  }, [model, modelId]);

  const properties = model.properties ?? [];

  return (
    <div>
      <SectionBar
        label="Properties"
        count={properties.length}
        onNew={handleNewProperty}
        newTestId="sc-properties-new"
      />
      {properties.length === 0
        ? <EmptyState label="properties" />
        : properties.map(prop => (
          <PropertyRow
            key={prop.id}
            prop={prop}
            onEdit={(y) => setPopupProp({ prop, anchorY: y })}
            onDelete={() => handleDeleteProp(prop.id)}
          />
        ))
      }
      {popupProp && (
        <PropertyEditPopup
          prop={popupProp.prop}
          anchorY={popupProp.anchorY}
          onUpdate={(field, val) => handleUpdateProp(popupProp.prop.id, field, val)}
          onClose={() => setPopupProp(null)}
        />
      )}
    </div>
  );
}

function SettingsTab({ model, modelId, designContent }: {
  model: SharedComponentModel; modelId: string; designContent?: React.ReactNode;
}) {
  const [popupProp, setPopupProp] = useState<{ prop: SharedComponentProperty; anchorY: number } | null>(null);

  const handleNewProperty = useCallback((e: React.MouseEvent) => {
    const newProp: SharedComponentProperty = {
      id: crypto.randomUUID(),
      name: 'newProp',
      type: 'text',
      defaultValue: '',
    };
    const props = [...(model.properties ?? []), newProp];
    updateEditingModel({ id: modelId, properties: props });
    setPopupProp({ prop: newProp, anchorY: e.clientY });
  }, [model, modelId]);

  const handleUpdateProp = useCallback((propId: string, field: keyof SharedComponentProperty, val: unknown) => {
    const props = (model.properties ?? []).map(p => p.id === propId ? { ...p, [field]: val } : p);
    updateEditingModel({ id: modelId, properties: props });
    setPopupProp(prev => prev ? { ...prev, prop: { ...prev.prop, [field]: val } } : null);
  }, [model, modelId]);

  const handleDeleteProp = useCallback((propId: string) => {
    const props = (model.properties ?? []).filter(p => p.id !== propId);
    updateEditingModel({ id: modelId, properties: props });
    setPopupProp(null);
  }, [model, modelId]);

  const properties = model.properties ?? [];

  return (
    <div>
      {/* Component description */}
      {model.description && (
        <div style={{ padding: '8px 12px', fontSize: 11, color: '#6b7280', borderBottom: '1px solid #1f2937', fontStyle: 'italic' }}>
          {model.description}
        </div>
      )}
      {model.folder && (
        <div style={{ padding: '4px 12px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 9, background: '#1f2937', color: '#6b7280', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }}>
            {model.folder}
          </span>
        </div>
      )}

      {/* Properties section */}
      <SectionBar
        label="Properties"
        count={properties.length}
        onNew={handleNewProperty}
        newTestId="sc-properties-new"
      />

      {properties.length === 0
        ? <EmptyState label="properties" />
        : properties.map(prop => (
          <PropertyRow
            key={prop.id}
            prop={prop}
            onEdit={(y) => setPopupProp({ prop, anchorY: y })}
            onDelete={() => handleDeleteProp(prop.id)}
          />
        ))
      }

      {/* Normal design content below */}
      {designContent && (
        <div style={{ borderTop: '1px solid #1f2937', marginTop: 4 }}>
          {designContent}
        </div>
      )}

      {/* Property edit popup */}
      {popupProp && (
        <PropertyEditPopup
          prop={popupProp.prop}
          anchorY={popupProp.anchorY}
          onUpdate={(field, val) => handleUpdateProp(popupProp.prop.id, field, val)}
          onClose={() => setPopupProp(null)}
        />
      )}
    </div>
  );
}

function PropertyRow({ prop, onEdit, onDelete }: {
  prop: SharedComponentProperty;
  onEdit: (y: number) => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 12px' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#0f1929'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
    >
      <TypeBadge type={prop.type} />
      <span
        onClick={e => onEdit(e.clientY)}
        style={{ flex: 1, fontSize: 11, color: '#e5e7eb', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {prop.name}
      </span>
      {prop.defaultValue !== undefined && prop.defaultValue !== '' && (
        <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {typeof prop.defaultValue === 'string' ? `"${prop.defaultValue}"` : String(prop.defaultValue)}
        </span>
      )}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        title="Delete property"
        style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', display: 'flex', padding: 2, borderRadius: 3, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
      >
        <IconTrash />
      </button>
    </div>
  );
}

// ─── Property Edit Popup ──────────────────────────────────────────────────────

function PropertyEditPopup({ prop, anchorY, onUpdate, onClose }: {
  prop: SharedComponentProperty;
  anchorY: number;
  onUpdate: (field: keyof SharedComponentProperty, val: unknown) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorOpenRef = useRef(false);
  useEffect(() => { colorOpenRef.current = colorPickerOpen; }, [colorPickerOpen]);

  const [top, setTop] = useState(anchorY);
  useEffect(() => {
    if (!ref.current) return;
    const h = ref.current.offsetHeight;
    setTop(Math.max(60, Math.min(anchorY - 12, window.innerHeight - h - 12)));
  }, [anchorY, prop.type]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (colorOpenRef.current) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [onClose]);

  return (
    <div
      ref={ref}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', right: 260, top, zIndex: 99999, width: 240,
        background: '#1a2233', border: '1px solid #374151', borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #2d3748' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TypeBadge type={prop.type} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#e5e7eb' }}>{prop.name || 'Untitled'}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', padding: 2, borderRadius: 3 }}>
          <IconClose />
        </button>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Name */}
        <div>
          <label style={SECTION_LABEL}>Name</label>
          <input
            value={prop.name}
            onChange={e => onUpdate('name', e.target.value)}
            placeholder="prop name"
            style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 11 }}
            onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
            onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
          />
          <div style={{ fontSize: 9, color: '#6b7280', marginTop: 3, fontFamily: 'monospace' }}>
            context.component?.props?.[&apos;{prop.name || '…'}&apos;]
          </div>
        </div>
        {/* Type */}
        <div>
          <label style={SECTION_LABEL}>Type</label>
          <select
            value={prop.type}
            onChange={e => onUpdate('type', e.target.value)}
            style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 11 }}
          >
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="color">color</option>
            <option value="any">any (JSON)</option>
          </select>
        </div>
        {/* Default value */}
        <div>
          <label style={SECTION_LABEL}>Default value</label>
          {prop.type === 'boolean' ? (
            <div style={{ display: 'flex', gap: 3, background: '#111827', borderRadius: 6, padding: 3 }}>
              {(['True', 'False'] as const).map(label => {
                const on = prop.defaultValue === true || prop.defaultValue === 'true';
                const active = label === 'True' ? on : !on;
                return (
                  <button key={label} onClick={() => onUpdate('defaultValue', label === 'True')}
                    style={{ flex: 1, fontSize: 11, padding: '4px 0', borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: active ? (label === 'True' ? '#064e3b' : '#7f1d1d') : 'transparent',
                      color: active ? (label === 'True' ? '#6ee7b7' : '#fca5a5') : '#6b7280',
                      fontWeight: active ? 600 : 400 }}
                  >{label}</button>
                );
              })}
            </div>
          ) : prop.type === 'color' ? (
            <FigmaColorPicker
              value={String(prop.defaultValue ?? '#000000')}
              onChange={c => onUpdate('defaultValue', c)}
            />
          ) : (
            <input
              type={prop.type === 'number' ? 'number' : 'text'}
              value={String(prop.defaultValue ?? '')}
              onChange={e => onUpdate('defaultValue', prop.type === 'number' ? Number(e.target.value) : e.target.value)}
              placeholder="Default value…"
              style={{ ...INPUT_BASE, padding: '5px 8px', fontSize: 11 }}
              onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
              onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PHASE 4: Data Tab (Variables + Formulas)
// ──────────────────────────────────────────────────────────────────────────────

const VAR_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;
type VarType = typeof VAR_TYPES[number];

const VAR_TYPE_COLORS: Record<VarType, string> = {
  string: '#3b82f6', number: '#f59e0b', boolean: '#10b981',
  object: '#8b5cf6', array: '#ec4899',
};

// ─── Shared slide-panel overlay (used by Variables + Formulas) ────────────────

function ComponentSlideOverlay({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return ReactDOM.createPortal(
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: 0, right: 260, bottom: 0, width: 300, zIndex: 99998,
        background: '#111827', borderLeft: '1px solid #1f2937', borderRight: '1px solid #1f2937',
        display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 16px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '8px 12px',
        borderBottom: '1px solid #1f2937', flexShrink: 0, gap: 8,
      }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#e5e7eb' }}>{title}</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', display: 'flex', padding: 3, borderRadius: 4 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#e5e7eb'; (e.currentTarget as HTMLElement).style.background = '#1f2937'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#6b7280'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
        >
          <IconClose />
        </button>
      </div>
      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ─── Variable slide form — wraps VariableSlideContent (same as left Data tab) ─

function ComponentVarForm({
  id, varDef, modelId, isNew, onSave, onClose, onRenameFolder, onDeleteFolder,
}: {
  id: string;
  varDef: ScopedVarDef;
  modelId: string;
  isNew: boolean;
  onSave: (v: ScopedVarDef) => void;
  onClose: () => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (name: string) => void;
}) {
  // Derive unique folder names from the component's variables
  const existingFolders = useMemo(() => {
    const vars = (getEditingModel(modelId) as SharedComponentModel | undefined)?.variables ?? {};
    const names = new Set<string>();
    Object.values(vars).forEach(v => { if (v.folder) names.add(v.folder); });
    return Array.from(names).sort();
  }, [modelId]);

  const [folder, setFolder] = useState<string | undefined>(varDef.folder);

  const initial: Partial<CustomVar> & { isNew?: boolean } = {
    id,
    name: varDef.name ?? varDef.label,
    label: varDef.label,
    type: varDef.type as CustomVar['type'],
    initialValue: varDef.initialValue ?? getDefaultForType(varDef.type as CustomVar['type']),
    description: varDef.description,
    saveInLocalStorage: varDef.saveInLocalStorage,
    folderId: undefined,
    isNew,
  };

  const handleSave = useCallback((cv: CustomVar) => {
    onSave({
      label: cv.label ?? cv.name ?? '',
      name: cv.name,
      type: cv.type as ScopedVarDef['type'],
      initialValue: cv.initialValue,
      description: cv.description,
      saveInLocalStorage: cv.saveInLocalStorage,
      folder: folder || undefined,
    });
    onClose();
  }, [onSave, onClose, folder]);

  const folderNode = (
    <ComponentFolderPicker
      value={folder}
      onChange={setFolder}
      folders={existingFolders}
      onRenameFolder={onRenameFolder}
      onDeleteFolder={onDeleteFolder}
    />
  );

  return (
    <>
      <div style={{ padding: '6px 12px 0', fontSize: 9, color: '#4b5563', fontFamily: 'monospace', wordBreak: 'break-all' }}>
        context.component.variables[&apos;{id}&apos;]
      </div>
      <VariableSlideContent
        key={id}
        initial={initial}
        onSave={handleSave}
        onClose={onClose}
        folderNode={folderNode}
      />
    </>
  );
}

// ─── Formula slide form ────────────────────────────────────────────────────────

function ComponentFormulaForm({
  id, formulaDef, isNew, onSave, onDelete, onClose,
}: {
  id: string;
  formulaDef: ScopedFormulaDef;
  isNew: boolean;
  onSave: (v: ScopedFormulaDef) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const handleSave = useCallback((def: { name: string; folder?: string; description?: string; params: GlobalFormulaParam[]; formula: string }) => {
    onSave({
      id,
      name: def.name,
      folder: def.folder,
      description: def.description,
      params: def.params,
      formula: def.formula,
    });
  }, [id, onSave]);

  return (
    <>
      {/* UUID path hint */}
      <div style={{ padding: '6px 12px 0', fontSize: 9, color: '#4b5563', fontFamily: 'monospace', wordBreak: 'break-all' }}>
        context.component.formulas[&apos;{id}&apos;]
      </div>
      <FormulaSlideBase
        key={id}
        initial={{
          name: isNew ? '' : formulaDef.name,
          folder: formulaDef.folder,
          description: formulaDef.description,
          params: (formulaDef.params ?? []) as GlobalFormulaParam[],
          formula: formulaDef.formula ?? '',
        }}
        isNew={isNew}
        onSave={handleSave}
        onDelete={onDelete}
        onClose={onClose}
        anchorRight={560}
        paramsInQuick
      />
    </>
  );
}

/** Standalone Variables section — used in ComponentDefinitionTab */
// ─── Component-scoped folder picker (mirrors global FolderPicker but uses string names) ─

const FP_ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
  fontSize: 12, color: '#d1d5db', cursor: 'pointer', userSelect: 'none',
};
const FP_ICON_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280',
  fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0,
};
const FP_INLINE_INPUT: React.CSSProperties = {
  flex: 1, background: '#374151', border: '1px solid #6366f1', borderRadius: 3,
  color: '#f3f4f6', fontSize: 11, padding: '2px 6px', outline: 'none',
};

function ComponentFolderPicker({
  value, onChange, folders, onRenameFolder, onDeleteFolder,
}: {
  value: string | undefined;
  onChange: (name: string | undefined) => void;
  /** All existing folder names in this component */
  folders: string[];
  onRenameFolder: (oldName: string, newName: string) => void;
  onDeleteFolder: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [creating, setCreating] = useState<string | null>(null); // null = closed, '' = open
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (dropRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const confirmCreate = () => {
    const name = (creating ?? '').trim();
    if (!name) { setCreating(null); return; }
    // Adding a folder just makes it available — user must select it
    onChange(name);
    setCreating(null);
    setOpen(false);
  };

  const confirmRename = (oldName: string) => {
    if (!editingName.trim() || editingName.trim() === oldName) { setEditing(null); return; }
    onRenameFolder(oldName, editingName.trim());
    if (value === oldName) onChange(editingName.trim());
    setEditing(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5,
          color: value ? '#d1d5db' : '#6b7280', fontSize: 12, padding: '6px 10px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          outline: 'none', boxSizing: 'border-box',
        } as React.CSSProperties}
      >
        <span>{value ?? 'No folder'}</span>
        <Chevron open={open} size={10} color="#6b7280" />
      </button>

      {open && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          top: (() => { const r = btnRef.current?.getBoundingClientRect(); return (r?.bottom ?? 0) + 4; })(),
          left: (() => { const r = btnRef.current?.getBoundingClientRect(); return r?.left ?? 0; })(),
          width: btnRef.current?.getBoundingClientRect().width ?? 240,
          background: '#111827', border: '1px solid #374151', borderRadius: 6,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)', zIndex: 99999,
          maxHeight: 280, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* No folder row */}
          <div style={{ padding: '4px 8px 2px', fontSize: 10, color: '#4b5563', fontWeight: 700, letterSpacing: '0.05em' }}>NO FOLDER</div>
          <div
            style={{ ...FP_ROW, background: !value ? '#1e3a5f' : 'transparent' }}
            onClick={() => { onChange(undefined); setOpen(false); }}
            onMouseEnter={e => { if (value) (e.currentTarget as HTMLElement).style.background = '#1f2937'; }}
            onMouseLeave={e => { if (value) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <span style={{ flex: 1, color: '#9ca3af', fontStyle: 'italic' }}>No folder</span>
            {!value && <span style={{ color: '#34d399', fontSize: 12 }}>✓</span>}
          </div>

          {/* Folder list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {folders.map(f => (
              <div key={f}
                style={{ ...FP_ROW, background: value === f ? '#1e3a5f' : 'transparent' }}
                onMouseEnter={e => { if (value !== f) (e.currentTarget as HTMLElement).style.background = '#1f2937'; }}
                onMouseLeave={e => { if (value !== f) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {/* folder icon */}
                <span style={{ fontSize: 11, color: '#6b7280', flexShrink: 0 }}>📁</span>

                {editing === f ? (
                  <>
                    <input
                      autoFocus
                      style={FP_INLINE_INPUT}
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') confirmRename(f); if (e.key === 'Escape') setEditing(null); }}
                      onClick={e => e.stopPropagation()}
                    />
                    <button style={{ ...FP_ICON_BTN, color: '#34d399' }} onClick={e => { e.stopPropagation(); confirmRename(f); }}>✓</button>
                    <button style={{ ...FP_ICON_BTN, color: '#f87171' }} onClick={e => { e.stopPropagation(); setEditing(null); }}>✕</button>
                  </>
                ) : (
                  <>
                    <span
                      style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value === f ? '#a5b4fc' : undefined }}
                      onClick={() => { onChange(f); setOpen(false); }}
                    >{f}</span>
                    <button style={{ ...FP_ICON_BTN, fontSize: 11 }} title="Rename"
                      onClick={e => { e.stopPropagation(); setEditing(f); setEditingName(f); }}>✎</button>
                    <button style={{ ...FP_ICON_BTN, fontSize: 11, color: '#6b7280' }} title="Delete folder"
                      onClick={e => {
                        e.stopPropagation();
                        onDeleteFolder(f);
                        if (value === f) onChange(undefined);
                      }}>🗑</button>
                  </>
                )}
              </div>
            ))}

            {/* Inline create input */}
            {creating !== null && (
              <div style={{ ...FP_ROW }}>
                <span style={{ fontSize: 11, color: '#6b7280', flexShrink: 0 }}>📁</span>
                <input
                  autoFocus
                  style={FP_INLINE_INPUT}
                  placeholder="New folder name"
                  value={creating}
                  onChange={e => setCreating(e.target.value)}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') setCreating(null); }}
                  onClick={e => e.stopPropagation()}
                />
                <button style={{ ...FP_ICON_BTN, color: '#34d399' }} onClick={e => { e.stopPropagation(); confirmCreate(); }}>✓</button>
                <button style={{ ...FP_ICON_BTN, color: '#f87171' }} onClick={e => { e.stopPropagation(); setCreating(null); }}>✕</button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ borderTop: '1px solid #1f2937', padding: '6px 8px' }}>
            <button
              onClick={() => setCreating('')}
              style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 12, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
            >+ Create new folder</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function VariablesSection({ modelId }: { model: SharedComponentModel; modelId: string }) {
  const [slideVar, setSlideVar] = useState<{ id: string; isNew: boolean } | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const liveVars = (): Record<string, ScopedVarDef> =>
    (getEditingModel(modelId) as SharedComponentModel | undefined)?.variables ?? {};

  const [, forceList] = useState(0);
  useEffect(() => {
    const { subscribeSharedComponents } = require('@/lib/builder/shared-component-data') as typeof import('@/lib/builder/shared-component-data');
    return subscribeSharedComponents(() => forceList(n => n + 1));
  }, []);

  const variables = liveVars();
  const varEntries = Object.entries(variables);

  // Derive sorted unique folder names
  const folderNames = useMemo(() => {
    const names = new Set<string>();
    Object.values(variables).forEach(v => { if (v.folder) names.add(v.folder); });
    return Array.from(names).sort();
  }, [variables]);

  const handleNew = useCallback(() => {
    setSlideVar({ id: crypto.randomUUID(), isNew: true });
  }, []);

  const handleDelete = useCallback((varId: string) => {
    const current = liveVars();
    const { [varId]: _removed, ...rest } = current;
    updateEditingModel({ id: modelId, variables: rest });
    setSlideVar(v => (v?.id === varId ? null : v));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const handleSave = useCallback((id: string, v: ScopedVarDef) => {
    const current = liveVars();
    updateEditingModel({ id: modelId, variables: { ...current, [id]: v } });
    setSlideVar(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const handleRenameFolder = useCallback((oldName: string, newName: string) => {
    const current = liveVars();
    const updated = Object.fromEntries(
      Object.entries(current).map(([id, v]) => [id, v.folder === oldName ? { ...v, folder: newName } : v])
    );
    updateEditingModel({ id: modelId, variables: updated });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const handleDeleteFolder = useCallback((name: string) => {
    const current = liveVars();
    const updated = Object.fromEntries(
      Object.entries(current).map(([id, v]) => [id, v.folder === name ? { ...v, folder: undefined } : v])
    );
    updateEditingModel({ id: modelId, variables: updated });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const newVarPlaceholder: ScopedVarDef = { label: '', type: 'string', initialValue: '' };

  const renderRow = (id: string, v: ScopedVarDef, depth = 0) => (
    <VariableRow
      key={id}
      id={id}
      varDef={v}
      depth={depth}
      isEditing={slideVar?.id === id && !slideVar.isNew}
      onEdit={() => setSlideVar({ id, isNew: false })}
      onClose={() => setSlideVar(null)}
      onChange={() => {}}
      onDelete={() => handleDelete(id)}
    />
  );

  const unfolderedEntries = varEntries.filter(([, v]) => !v.folder);

  return (
    <div>
      <SectionBar label="Variables" count={varEntries.length} onNew={handleNew} newTestId="sc-variables-new" />
      {varEntries.length === 0 ? (
        <EmptyState label="variables" />
      ) : (
        <>
          {/* Variables without a folder */}
          {unfolderedEntries.map(([id, v]) => renderRow(id, v))}

          {/* Folder groups */}
          {folderNames.map(folder => {
            const folderVars = varEntries.filter(([, v]) => v.folder === folder);
            const isExpanded = expandedFolders[folder] !== false; // default open
            return (
              <React.Fragment key={folder}>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 10px', cursor: 'pointer', userSelect: 'none',
                  }}
                  onClick={() => setExpandedFolders(s => ({ ...s, [folder]: !isExpanded }))}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1e293b'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <Chevron open={isExpanded} size={10} color="#6b7280" />
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#d1d5db', flex: 1 }}>{folder}</span>
                  <span style={{ fontSize: 10, color: '#6b7280' }}>{folderVars.length}</span>
                </div>
                {isExpanded && folderVars.map(([id, v]) => renderRow(id, v, 1))}
              </React.Fragment>
            );
          })}
        </>
      )}
      {slideVar && (
        <ComponentSlideOverlay
          title={slideVar.isNew ? 'Add Variable' : 'Edit Variable'}
          onClose={() => setSlideVar(null)}
        >
          <ComponentVarForm
            id={slideVar.id}
            varDef={slideVar.isNew ? newVarPlaceholder : (variables[slideVar.id] ?? newVarPlaceholder)}
            modelId={modelId}
            isNew={slideVar.isNew}
            onSave={v => handleSave(slideVar.id, v)}
            onClose={() => setSlideVar(null)}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
          />
        </ComponentSlideOverlay>
      )}
    </div>
  );
}

/** Standalone Formulas section — used in ComponentDefinitionTab */
function FormulasSection({ modelId }: { model: SharedComponentModel; modelId: string }) {
  const [slideFormula, setSlideFormula] = useState<{ id: string; isNew: boolean } | null>(null);

  // Always read directly from the store to avoid stale closure issues
  const liveFormulas = (): Record<string, ScopedFormulaDef> =>
    (getEditingModel(modelId) as SharedComponentModel | undefined)?.formulas ?? {};

  const [, forceList] = useState(0);
  useEffect(() => {
    const { subscribeSharedComponents } = require('@/lib/builder/shared-component-data') as typeof import('@/lib/builder/shared-component-data');
    return subscribeSharedComponents(() => forceList(n => n + 1));
  }, []);

  const formulas = liveFormulas();
  const formulaEntries = Object.entries(formulas);

  const handleNew = useCallback(() => {
    // Don't pre-create — just open the slide with a fresh UUID
    setSlideFormula({ id: crypto.randomUUID(), isNew: true });
  }, []);

  const handleDelete = useCallback((fId: string) => {
    const current = liveFormulas();
    const { [fId]: _removed, ...rest } = current;
    updateEditingModel({ id: modelId, formulas: rest });
    setSlideFormula(f => (f?.id === fId ? null : f));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const handleSave = useCallback((id: string, f: ScopedFormulaDef) => {
    // Read live from store to avoid stale closure
    const current = liveFormulas();
    updateEditingModel({ id: modelId, formulas: { ...current, [id]: f } });
    setSlideFormula(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const newFormulaPlaceholder: ScopedFormulaDef = { id: slideFormula?.id ?? '', name: '', params: [], formula: '' };

  return (
    <div>
      <SectionBar label="Formulas" count={formulaEntries.length} onNew={handleNew} newTestId="sc-formulas-new" />
      {formulaEntries.length === 0
        ? <EmptyState label="formulas" />
        : formulaEntries.map(([id, f]) => (
          <FormulaRow
            key={id}
            id={id}
            formulaDef={f}
            isEditing={slideFormula?.id === id && !slideFormula.isNew}
            onEdit={() => setSlideFormula({ id, isNew: false })}
            onClose={() => setSlideFormula(null)}
            onChange={() => {}}
            onDelete={() => handleDelete(id)}
          />
        ))
      }
      {slideFormula && (
        <ComponentSlideOverlay
          title={slideFormula.isNew ? 'Add Formula' : 'Edit Formula'}
          onClose={() => setSlideFormula(null)}
        >
          <ComponentFormulaForm
            id={slideFormula.id}
            formulaDef={slideFormula.isNew ? newFormulaPlaceholder : (formulas[slideFormula.id] ?? newFormulaPlaceholder)}
            isNew={slideFormula.isNew}
            onSave={f => handleSave(slideFormula.id, f)}
            onDelete={slideFormula.isNew ? undefined : () => handleDelete(slideFormula.id)}
            onClose={() => setSlideFormula(null)}
          />
        </ComponentSlideOverlay>
      )}
    </div>
  );
}

function DataTab({ model, modelId }: { model: SharedComponentModel; modelId: string }) {
  return (
    <div>
      <VariablesSection model={model} modelId={modelId} />
      <div style={{ borderTop: '1px solid #1f2937', marginTop: 6 }} />
      <FormulasSection model={model} modelId={modelId} />
    </div>
  );
}


function VariableRow({ id, varDef, depth = 0, isEditing, onEdit, onClose, onChange, onDelete }: {
  id: string;
  varDef: ScopedVarDef;
  depth?: number;
  isEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onChange: (field: keyof ScopedVarDef, val: unknown) => void;
  onDelete: () => void;
}) {
  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `4px 10px 4px ${12 + depth * 14}px`, cursor: 'pointer' }}
        onClick={isEditing ? onClose : onEdit}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#0f1929'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: VAR_TYPE_COLORS[varDef.type as VarType] ?? '#6b7280',
        }} />
        <span style={{ flex: 1, fontSize: 11, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {varDef.label}
        </span>
        <span style={{ fontSize: 10, color: '#6b7280' }}>{varDef.type}</span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', display: 'flex', padding: 2, borderRadius: 3, flexShrink: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
        >
          <IconTrash />
        </button>
      </div>
      {isEditing && (
        <div style={{ padding: '6px 12px 10px', background: '#060d1a', borderTop: '1px solid #1f2937', borderBottom: '1px solid #1f2937', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <label style={SECTION_LABEL}>Label</label>
            <input
              value={varDef.label}
              onChange={e => onChange('label', e.target.value)}
              style={{ ...INPUT_BASE, padding: '4px 7px', fontSize: 11 }}
              onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
              onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
            />
          </div>
          <div>
            <label style={SECTION_LABEL}>Type</label>
            <select
              value={varDef.type}
              onChange={e => onChange('type', e.target.value)}
              style={{ ...INPUT_BASE, padding: '4px 7px', fontSize: 11 }}
            >
              {VAR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={SECTION_LABEL}>Initial value</label>
            <input
              value={String(varDef.initialValue ?? '')}
              onChange={e => onChange('initialValue', e.target.value)}
              placeholder="Initial value"
              style={{ ...INPUT_BASE, padding: '4px 7px', fontSize: 11 }}
              onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
              onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
            />
          </div>
          <div style={{ fontSize: 9, color: '#4b5563', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            variables[&apos;{id}&apos;]
          </div>
        </div>
      )}
    </div>
  );
}

function FormulaRow({ id, formulaDef, isEditing, onEdit, onClose, onChange, onDelete }: {
  id: string;
  formulaDef: ScopedFormulaDef;
  isEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onChange: (field: keyof ScopedFormulaDef, val: unknown) => void;
  onDelete: () => void;
}) {
  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 12px', cursor: 'pointer' }}
        onClick={isEditing ? onClose : onEdit}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#0f1929'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', flexShrink: 0 }}>ƒ</span>
        <span style={{ flex: 1, fontSize: 11, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {formulaDef.name}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', display: 'flex', padding: 2, borderRadius: 3, flexShrink: 0 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
        >
          <IconTrash />
        </button>
      </div>
      {isEditing && (
        <div style={{ padding: '6px 12px 10px', background: '#060d1a', borderTop: '1px solid #1f2937', borderBottom: '1px solid #1f2937', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <label style={SECTION_LABEL}>Name</label>
            <input
              value={formulaDef.name}
              onChange={e => onChange('name', e.target.value)}
              style={{ ...INPUT_BASE, padding: '4px 7px', fontSize: 11 }}
              onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
              onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
            />
          </div>
          <div>
            <label style={SECTION_LABEL}>Formula expression</label>
            <textarea
              value={formulaDef.formula}
              onChange={e => onChange('formula', e.target.value)}
              placeholder="e.g. variables['uuid'] * 2"
              rows={3}
              style={{ ...INPUT_BASE, padding: '4px 7px', fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
              onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
            />
          </div>
          {formulaDef.description !== undefined && (
            <div>
              <label style={SECTION_LABEL}>Description</label>
              <input
                value={formulaDef.description}
                onChange={e => onChange('description', e.target.value)}
                style={{ ...INPUT_BASE, padding: '4px 7px', fontSize: 11 }}
                onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PHASE 4: Actions Tab (Workflows)
// ──────────────────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  execution:      'On execution',
  created:        'On created',
  mounted:        'On mounted',
  beforeUnmount:  'Before unmount',
  propertyChange: 'On property change',
};

const TRIGGER_ICONS: Record<string, string> = {
  execution:      '⚡',
  created:        '⊕',
  mounted:        '◎',
  beforeUnmount:  '⊟',
  propertyChange: '↻',
};

// Workflows with one of these triggers are component-scoped (surface here,
// in the SC's Actions tab). DOM-event-triggered workflows (click, etc.) are
// element-scoped and surface in the right-panel Workflow tab when the owning
// inner element is selected — they're deliberately hidden here to keep the
// Actions tab focused on component-level lifecycle behaviour.
const LIFECYCLE_TRIGGERS = new Set<string>([
  'execution', 'created', 'mounted', 'beforeUnmount', 'propertyChange',
]);

function ActionsTab({ model, modelId, openWorkflowId, onOpenWorkflow }: {
  model: SharedComponentModel;
  modelId: string;
  openWorkflowId: string | null;
  onOpenWorkflow: (id: string | null) => void;
}) {
  const workflows = model.workflows ?? {};
  const entries = Object.entries(workflows).filter(
    ([, wf]) => LIFECYCLE_TRIGGERS.has(wf.trigger),
  );

  const handleNewWorkflow = useCallback(() => {
    const id = crypto.randomUUID();
    const newWf: ScopedWorkflow = {
      id,
      name: 'onExecution',
      trigger: 'execution',
      params: [],
      steps: [],
    };
    updateEditingModel({ id: modelId, workflows: { ...workflows, [id]: newWf } });
    onOpenWorkflow(id);
  }, [workflows, modelId, onOpenWorkflow]);

  const handleDelete = useCallback((wfId: string) => {
    const { [wfId]: _removed, ...rest } = workflows;
    updateEditingModel({ id: modelId, workflows: rest });
  }, [workflows, modelId]);

  return (
    <div>
      <SectionBar label="Workflows" count={entries.length} onNew={handleNewWorkflow} newTestId="sc-workflows-new" />
      {entries.length === 0
        ? <EmptyState label="workflows" />
        : entries.map(([id, wf]) => (
          <WorkflowRow
            key={id}
            id={id}
            workflow={wf}
            isActive={openWorkflowId === id}
            onOpen={() => onOpenWorkflow(id)}
            onDelete={() => handleDelete(id)}
          />
        ))
      }
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Triggers — WeWeb-parity custom component events
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Section listing the component's custom triggers. A trigger is a named event
 * the component declares and emits (via the `emitComponentTrigger` step) from
 * inside its own workflows. Parent pages bind listener workflows on an
 * instance by setting `workflow.trigger = trigger.id`; those listeners receive
 * the emitted payload as `context.event` in scope.
 */
function TriggersSection({ model, modelId }: { model: SharedComponentModel; modelId: string }) {
  const triggers = model.triggers ?? [];
  const [modalAnchorY, setModalAnchorY] = useState<number | null>(null);
  const [editing, setEditing] = useState<ComponentTrigger | null>(null);

  const handleNew = useCallback((e: React.MouseEvent) => {
    setEditing(null);
    setModalAnchorY(e.clientY);
  }, []);

  const handleEdit = useCallback((t: ComponentTrigger, anchorY: number) => {
    setEditing(t);
    setModalAnchorY(anchorY);
  }, []);

  const handleDelete = useCallback((triggerId: string) => {
    const next = triggers.filter(t => t.id !== triggerId);
    updateEditingModel({ id: modelId, triggers: next.length ? next : undefined });
  }, [triggers, modelId]);

  const handleSave = useCallback((t: ComponentTrigger) => {
    const existingIdx = triggers.findIndex(x => x.id === t.id);
    const next = existingIdx >= 0
      ? triggers.map((x, i) => i === existingIdx ? t : x)
      : [...triggers, t];
    updateEditingModel({ id: modelId, triggers: next });
    setModalAnchorY(null);
    setEditing(null);
  }, [triggers, modelId]);

  return (
    <div>
      <SectionBar label="Triggers" count={triggers.length} onNew={handleNew} newTestId="sc-triggers-new" />
      {triggers.length === 0
        ? <EmptyState label="triggers" />
        : triggers.map(t => (
          <TriggerRow
            key={t.id}
            trigger={t}
            onEdit={e => handleEdit(t, e.clientY)}
            onDelete={() => handleDelete(t.id)}
          />
        ))
      }
      {modalAnchorY !== null && (
        <TriggerEditModal
          initial={editing}
          anchorY={modalAnchorY}
          onSave={handleSave}
          onClose={() => { setModalAnchorY(null); setEditing(null); }}
        />
      )}
    </div>
  );
}

function TriggerRow({ trigger, onEdit, onDelete }: {
  trigger: ComponentTrigger;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-testid={`sc-trigger-row-${trigger.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 12px',
        cursor: 'pointer', background: 'transparent',
        borderLeft: '2px solid transparent',
      }}
      onClick={onEdit}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0a1020'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 12, color: '#a78bfa', flexShrink: 0 }}>⚡</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {trigger.name}
        </div>
        <div style={{ fontSize: 10, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Component event · {(() => {
            const p = trigger.payload;
            if (!p) return 'no payload';
            if (typeof p === 'object' && 'formula' in p) return 'bound payload';
            return 'literal payload';
          })()}
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onEdit(e); }}
        title="Edit trigger"
        style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', display: 'flex', padding: 2, borderRadius: 3, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
      >
        <IconEdit />
      </button>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        title="Delete trigger"
        style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', display: 'flex', padding: 2, borderRadius: 3, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
      >
        <IconTrash />
      </button>
    </div>
  );
}

function TriggerEditModal({ initial, anchorY, onSave, onClose }: {
  initial: ComponentTrigger | null;
  anchorY: number;
  onSave: (t: ComponentTrigger) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [payload, setPayload] = useState<FormulaValue | undefined>(
    (initial?.payload as FormulaValue | undefined) ?? undefined,
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!ref.current || !t) return;
      if (ref.current.contains(t)) return;
      // The Payload BoundField opens a FormulaEditor via createPortal on
      // document.body — clicks inside it are DOM-outside our form ref but
      // logically belong to this modal, so treat them as "inside".
      if ((t as HTMLElement).closest?.('[data-testid="formula-editor"]')) return;
      onClose();
    };
    window.addEventListener('mousedown', h, true);
    return () => window.removeEventListener('mousedown', h, true);
  }, [onClose]);

  const canSave = name.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const normalizedPayload = (() => {
      if (payload == null) return undefined;
      if (typeof payload === 'string') {
        const trimmed = payload.trim();
        return trimmed.length ? trimmed : undefined;
      }
      if (typeof payload === 'object' && payload && 'formula' in (payload as Record<string, unknown>)) {
        const f = (payload as { formula?: unknown }).formula;
        if (typeof f === 'string' && f.trim()) return payload as { formula: string };
        return undefined;
      }
      return undefined;
    })();
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      payload: normalizedPayload,
    });
  };

  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.max(anchorY - 120, 80),
    // Sit flush against the right panel's left edge (panel is 260px wide) so
    // the modal and the FormulaEditor (anchorRight=260 below) form one strip.
    right: 260,
    width: 320,
    background: '#111827',
    border: '1px solid #374151',
    borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    zIndex: 99999,
    display: 'flex',
    flexDirection: 'column',
    padding: 14,
    gap: 10,
  };

  return ReactDOM.createPortal(
    <form ref={ref} style={style} onSubmit={handleSubmit}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }}>
        {initial ? 'Edit trigger' : 'New trigger'}
      </div>

      <div>
        <label style={SECTION_LABEL}>Label *</label>
        <input
          autoFocus
          style={INPUT_BASE}
          value={name}
          placeholder="On login success"
          onChange={e => setName(e.target.value)}
        />
      </div>

      <div>
        <BoundField
          label="Payload"
          value={payload}
          onChange={setPayload}
          code
          expectedType="object"
          placeholder={'{\n  "date": "2026-01-15"\n}'}
          // Anchor the FormulaEditor to the left edge of this modal so it
          // sits adjacent (modal is at right:260, width:320, so its left
          // edge = 260+320 from the viewport right).
          anchorRight={260 + 320}
          // Payloads typically emit from DOM-event (e.g. click) workflows where
          // ancestor `map` / event scope is available — wire `click` so the
          // formula editor chips `context.item.*`, `event.*`, etc.
          workflowTrigger="click"
        />
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
          Payload delivered to listeners as <code style={{ background: '#1f2937', padding: '1px 4px', borderRadius: 3 }}>context.event</code>.
          Bind a formula (e.g. <code style={{ background: '#1f2937', padding: '1px 4px', borderRadius: 3 }}>{'{ date: context?.item?.data?.dateStr }'}</code>)
          so emitting fires with the real runtime value.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
        <button type="button" onClick={onClose} style={BTN_GHOST}>Cancel</button>
        <button
          type="submit"
          disabled={!canSave}
          style={{ ...BTN_PRIMARY, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }}
        >
          {initial ? 'Save' : 'Create'}
        </button>
      </div>
    </form>,
    document.body,
  );
}

function WorkflowRow({ id, workflow, isActive, onOpen, onDelete }: {
  id: string;
  workflow: ScopedWorkflow;
  isActive: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const trigger = workflow.trigger ?? 'execution';
  const stepCount = workflow.steps?.length ?? 0;

  return (
    <div
      data-testid={`sc-workflow-row-${id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 12px',
        cursor: 'pointer', background: isActive ? '#0f1929' : 'transparent',
        borderLeft: isActive ? '2px solid #3b82f6' : '2px solid transparent',
      }}
      onClick={onOpen}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#0a1020'; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 12, color: '#60a5fa', flexShrink: 0 }}>
        {TRIGGER_ICONS[trigger] ?? '⚡'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {workflow.name}
        </div>
        <div style={{ fontSize: 10, color: '#6b7280' }}>
          {TRIGGER_LABELS[trigger] ?? trigger} · {stepCount} step{stepCount !== 1 ? 's' : ''}
          {(workflow.params?.length ?? 0) > 0 && ` · ${workflow.params.length} param${workflow.params.length !== 1 ? 's' : ''}`}
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        title="Delete workflow"
        style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', display: 'flex', padding: 2, borderRadius: 3, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
      >
        <IconTrash />
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// "Create as Component" button — rendered in the right panel top chrome
// ──────────────────────────────────────────────────────────────────────────────

export function NewComponentButton({ selectedNode }: { selectedNode: SDUINode | null }) {
  const [popoverAnchor, setPopoverAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const existingShared = (selectedNode as unknown as Record<string, unknown>)?._shared as { id: string; name: string } | undefined;
  const existingSystem = (selectedNode as unknown as Record<string, unknown>)?._system as { id: string; name: string } | undefined;
  const { enterSharedComponentEdit, enterSystemComponentEdit, detachInstance, resetInstanceToSystem } = useBuilderStore(
    useShallow(s => ({
      enterSharedComponentEdit: s.enterSharedComponentEdit,
      enterSystemComponentEdit: s.enterSystemComponentEdit,
      detachInstance: s.detachInstance,
      resetInstanceToSystem: s.resetInstanceToSystem,
    }))
  );
  const nodeId = (selectedNode as unknown as { id?: string })?.id;

  if (!selectedNode) return null;

  // If this node is a shared or system component instance, show Edit / Detach / Reset buttons.
  if (existingShared || existingSystem) {
    const meta = (existingShared ?? existingSystem)!;
    const isSystem = !!existingSystem;
    const handleEdit = () => {
      const m = isSystem ? getSystemComponents()[meta.id] : getSharedComponents()[meta.id];
      if (!m) return;
      if (isSystem) {
        enterSystemComponentEdit(
          meta.id,
          m.content as unknown as import('@/lib/sdui/types/node').SDUINode,
          m as unknown as Record<string, unknown>,
          nodeId,
          true,
        );
      } else {
        enterSharedComponentEdit(
          meta.id,
          m.content as unknown as import('@/lib/sdui/types/node').SDUINode,
          m as unknown as Record<string, unknown>,
          nodeId,
          true,
        );
      }
    };
    const handleDetach = () => {
      if (!nodeId) return;
      const label = isSystem ? `system component "${meta.name}"` : `instance of "${meta.name}"`;
      if (!window.confirm(`Detach from ${label}? The definition and other instances will remain intact.`)) return;
      detachInstance(nodeId);
    };
    const handleResetToSystem = () => {
      if (!nodeId) return;
      if (!window.confirm(`Reset this "${meta.name}" instance to the system default? Any per-instance overrides will be lost.`)) return;
      resetInstanceToSystem(nodeId);
    };
    const baseBtn: React.CSSProperties = {
      display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
      background: 'none', border: '1px solid #374151', borderRadius: 4,
      color: '#9ca3af', fontSize: 10, cursor: 'pointer', flexShrink: 0,
      fontWeight: 600, letterSpacing: '0.04em',
    };
    return (
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          data-testid="panel-right-edit-component"
          onClick={e => { e.stopPropagation(); handleEdit(); }}
          title={isSystem ? 'Edit system component' : 'Edit component'}
          style={baseBtn}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = '#3b82f6';
            (e.currentTarget as HTMLElement).style.color = '#60a5fa';
            (e.currentTarget as HTMLElement).style.background = '#0f172a';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = '#374151';
            (e.currentTarget as HTMLElement).style.color = '#9ca3af';
            (e.currentTarget as HTMLElement).style.background = 'none';
          }}
        >
          <IconEdit />
          <span>{isSystem ? 'Edit System' : 'Edit'}</span>
        </button>
        {isSystem && (
          <>
            <button
              data-testid="panel-right-reset-to-system"
              onClick={e => { e.stopPropagation(); handleResetToSystem(); }}
              title="Reset to system default"
              style={baseBtn}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = '#f59e0b';
                (e.currentTarget as HTMLElement).style.color = '#fbbf24';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = '#374151';
                (e.currentTarget as HTMLElement).style.color = '#9ca3af';
              }}
            >
              <span>Reset</span>
            </button>
            <button
              data-testid="panel-right-detach-system"
              onClick={e => { e.stopPropagation(); handleDetach(); }}
              title="Detach from system"
              style={baseBtn}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = '#ef4444';
                (e.currentTarget as HTMLElement).style.color = '#f87171';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = '#374151';
                (e.currentTarget as HTMLElement).style.color = '#9ca3af';
              }}
            >
              <span>Detach</span>
            </button>
          </>
        )}
      </div>
    );
  }

  // Regular node — show "+ New" to create a new component.
  return (
    <>
      <button
        ref={btnRef}
        data-testid="panel-right-new-component"
        onClick={e => {
          e.stopPropagation();
          const rect = btnRef.current?.getBoundingClientRect() ?? { bottom: 0, right: 260 } as DOMRect;
          setPopoverAnchor(prev => prev ? null : rect);
        }}
        title="Create as component"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
          background: 'none', border: '1px solid #374151', borderRadius: 4,
          color: '#9ca3af', fontSize: 10, cursor: 'pointer', flexShrink: 0,
          fontWeight: 600, letterSpacing: '0.04em',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.borderColor = '#6366f1';
          (e.currentTarget as HTMLElement).style.color = '#a5b4fc';
          (e.currentTarget as HTMLElement).style.background = '#1e1b4b';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.borderColor = '#374151';
          (e.currentTarget as HTMLElement).style.color = '#9ca3af';
          (e.currentTarget as HTMLElement).style.background = 'none';
        }}
      >
        <IconPlus />
        <span>New</span>
      </button>

      {popoverAnchor && selectedNode && (
        <CreateComponentPopover
          anchorRect={popoverAnchor}
          sourceNode={selectedNode}
          onClose={() => setPopoverAnchor(null)}
        />
      )}
    </>
  );
}
