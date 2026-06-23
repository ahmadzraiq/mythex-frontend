'use client';

/**
 * _workflow-node-configs.tsx
 *
 * Shared helpers and right-panel config-form components for WorkflowCanvas.
 * Extracted from _workflow-canvas.tsx.
 *
 * Exports:
 *  - toHumanName         — camelCase → human label
 *  - WorkflowBindButton  — dropdown to bind a named workflow
 *  - TypeSearchDropdown  — searchable action-type picker
 *  - WorkflowMetaPanel   — workflow name/description form
 *  - CanvasOnOffToggle   — pill-style boolean toggle
 *  - NavigateToConfig    — navigateTo step config form
 *  - SetFormStateConfig  — setFormState step config form
 *  - ResetFormConfig     — resetForm step config form
 *  - NodePropsPanel      — main per-step config panel
 */

import React, { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { useBuilderStore } from './_store';
import { getSharedComponentList, subscribeSharedComponents } from '@/lib/builder/shared-component-data';
import type { SharedComponentModel } from '@/lib/builder/shared-component-data';
import { FigmaColorPicker } from './_color-picker';
import { BindingIcon, isBoundValue, type FormulaValue } from './_formula-panel';
import { FormulaEditor, storedValueToFormula } from './_formula-editor';
import { collectPageComponents } from './_formula-editor-tabs';
import { GqlEditor } from './_data-source-form';
import { S } from './_workflow-styles';
import {
  type ActionStepType, type BranchDef, type ActionStep,
  ACTION_CATEGORIES, FORM_ACTION_CATEGORY,
  getActionLabel, getActionIcon, isStructural, isConfigured, canTest,
} from './_workflow-types';
import type { WorkflowMeta, WorkflowParam } from './_store';
import type { GlobalFormulaParam } from './_store-types';
import { backendTables } from '@/lib/platform/api-client';
import {
  type FilterCondition, type FilterGroup, type SortSpec,
  FilterPanel, SortPanel, FloatingAnchor, uid,
} from './_filter-sort-panels';

// ─── Workflow params context ──────────────────────────────────────────────────
// Allows NodePropsPanel to broadcast server-workflow context (params + isServer)
// to every nested BoundField without prop-drilling through every config component.

interface WorkflowCtxValue {
  params: GlobalFormulaParam[];
  isServerContext: boolean;
}
const WorkflowParamsCtx = createContext<WorkflowCtxValue>({ params: [], isServerContext: false });

/** Wrap a subtree so all BoundField instances within it receive the params and server flag. */
export function WorkflowParamsProvider({
  params, isServerContext, children,
}: {
  params: GlobalFormulaParam[];
  isServerContext: boolean;
  children: React.ReactNode;
}) {
  return (
    <WorkflowParamsCtx.Provider value={{ params, isServerContext }}>
      {children}
    </WorkflowParamsCtx.Provider>
  );
}

/** Convert camelCase / snake_case / kebab-case names to human-readable text. */
export function toHumanName(name: string): string {
  if (!name) return name;
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// Re-export types consumed by other files in the builder
export type { ActionStepType, BranchDef, ActionStep };


// ─── WorkflowBindButton ───────────────────────────────────────────────────────
// A chain-link button that opens a dropdown list of available named workflows.
// Used in the runProjectWorkflow step config and the right panel's workflow rows.

interface WorkflowBindButtonProps {
  /** Currently bound workflow UUID, or empty string if unbound */
  value: string;
  onChange: (uuid: string) => void;
  /** When true, only shows global workflows and hides the chain-link bind icon */
  globalOnly?: boolean;
}

export function WorkflowBindButton({ value, onChange, globalOnly = false }: WorkflowBindButtonProps) {
  const { workflows } = useBuilderStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Look up name in unified workflows store
  const resolvedMeta = value ? (workflows as Record<string, import('@/config/types').WorkflowDef>)[value] : undefined;
  const rawDisplayName = value && resolvedMeta?.name ? resolvedMeta.name : value || '';
  const displayName = rawDisplayName ? toHumanName(rawDisplayName) : (globalOnly ? 'Select global workflow' : 'Bind workflow');
  const isBound = Boolean(value);
  const isGlobal = Boolean(value && resolvedMeta && !resolvedMeta.pageScope);

  const allWfs = Object.values(workflows as Record<string, import('@/config/types').WorkflowDef>)
    .filter(w => !w.isTrigger && !w.isAppTrigger);
  const projectWfs = allWfs
    .filter(w => !w.pageScope)
    .map(w => ({ ...w, _scope: 'global' as const }))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  const pageWfs = allWfs
    .filter(w => Boolean(w.pageScope))
    .map(w => ({ ...w, _scope: 'page' as const }))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  const allWorkflows = globalOnly ? projectWfs : [...projectWfs, ...pageWfs];
  const filtered = search
    ? allWorkflows.filter(w => (w.name ?? w.id).toLowerCase().includes(search.toLowerCase()))
    : allWorkflows;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      {/* Chain-link bind icon — hidden when globalOnly (not needed for global workflow picker) */}
      {!globalOnly && (
        <button
          type="button"
          title={isBound ? 'Change workflow binding' : 'Bind to a workflow'}
          onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, flexShrink: 0, cursor: 'pointer',
            border: 'none', borderRadius: 6,
            background: isBound ? 'var(--bld-accent)' : 'var(--bld-bg-input)',
            color: isBound ? 'var(--bld-accent)' : 'var(--bld-text-disabled)',
            transition: 'background 0.15s, color 0.15s',
            padding: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l2-2a3.5 3.5 0 0 0-4.95-4.95l-1.1 1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0l-2 2a3.5 3.5 0 0 0 4.95 4.95l1.1-1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {/* Bound workflow name pill / selector */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          flex: 1, textAlign: 'left', background: isBound ? 'rgba(59,130,246,0.1)' : 'var(--bld-bg-panel)',
          border: `1px solid ${isBound ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`,
          borderRadius: 6, padding: '4px 8px', fontSize: 11,
          color: isBound ? 'var(--bld-accent)' : 'var(--bld-text-disabled)', cursor: 'pointer',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
        {isBound && isGlobal && !globalOnly && (
          <span style={{ fontSize: 9, background: 'rgba(34,197,94,0.15)', color: 'var(--bld-success)', borderRadius: 3, padding: '1px 4px', flexShrink: 0, fontWeight: 600 }}>
            Global
          </span>
        )}
        <span style={{ color: 'var(--bld-text-disabled)', fontSize: 10, flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg></span>
      </button>

      {/* Clear button when bound */}
      {isBound && (
        <button
          type="button"
          title="Unbind workflow"
          onClick={e => { e.stopPropagation(); onChange(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
        >
          ×
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
            marginTop: 4, background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
            minWidth: 220,
          }}
        >
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--bld-border-subtle)' }}>
            <input
              autoFocus
              style={{ width: '100%', background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-2)', fontSize: 11, padding: '4px 8px', outline: 'none', boxSizing: 'border-box' }}
              placeholder="Search workflows…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--bld-text-disabled)' }}>No workflows found</div>
            )}
            {/* Global workflows group */}
            {!globalOnly && filtered.some(w => w._scope === 'global') && (
              <div style={{ padding: '4px 12px 2px', fontSize: 9, fontWeight: 700, color: 'var(--bld-text-disabled)', textTransform: 'none' }}>
                Global
              </div>
            )}
            {filtered.filter(w => w._scope === 'global').map(w => (
              <button
                key={w.id}
                type="button"
                onClick={e => { e.stopPropagation(); onChange(w.id); setOpen(false); setSearch(''); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                  padding: '7px 12px', background: w.id === value ? 'var(--bld-accent-subtle)' : 'transparent',
                  border: 'none', color: w.id === value ? 'var(--bld-accent)' : 'var(--bld-text-2)',
                  fontSize: 11, cursor: 'pointer',
                }}
                onMouseEnter={e => { if (w.id !== value) (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { if (w.id !== value) (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-input)'; }}
              >
                <span style={{ flex: 1, fontWeight: 600 }}>{toHumanName(w.name ?? w.id)}</span>
                {(w.params?.length ?? 0) > 0 && (
                  <span style={{ fontSize: 9, background: 'rgba(34,197,94,0.15)', color: 'var(--bld-success)', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }}>
                    {w.params!.length} param{w.params!.length !== 1 ? 's' : ''}
                  </span>
                )}
              </button>
            ))}
            {/* Page workflows group — hidden when globalOnly */}
            {!globalOnly && filtered.some(w => w._scope === 'page') && (
              <div style={{ padding: '4px 12px 2px', fontSize: 9, fontWeight: 700, color: 'var(--bld-text-disabled)', textTransform: 'none' }}>
                Page
              </div>
            )}
            {!globalOnly && filtered.filter(w => w._scope === 'page').map(w => (
              <button
                key={w.id}
                type="button"
                onClick={e => { e.stopPropagation(); onChange(w.id); setOpen(false); setSearch(''); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 12px', background: w.id === value ? 'var(--bld-accent-subtle)' : 'transparent',
                  border: 'none', color: w.id === value ? 'var(--bld-accent)' : 'var(--bld-text-2)',
                  fontSize: 11, cursor: 'pointer',
                }}
                onMouseEnter={e => { if (w.id !== value) (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { if (w.id !== value) (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-input)'; }}
              >
                <div style={{ fontWeight: 600 }}>{toHumanName(w.name ?? w.id)}</div>
                {w.trigger && <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 1 }}>On {w.trigger}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Type search dropdown (used inside NodePropsPanel) ────────────────────────

export function TypeSearchDropdown({
  value,
  onChange,
  isFormContext = false,
}: {
  value: ActionStepType | '';
  onChange: (type: ActionStepType) => void;
  isFormContext?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="type-search"]')) {
        setOpen(false);
        setSearch('');
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  const allCategories = isFormContext
    ? [FORM_ACTION_CATEGORY, ...ACTION_CATEGORIES]
    : ACTION_CATEGORIES;

  const q = search.toLowerCase();
  const filtered = allCategories.map(cat => ({
    ...cat,
    items: cat.items.filter(i => !i.isStructural && i.type !== 'passThroughCondition' && i.label.toLowerCase().includes(q)),
  })).filter(cat => cat.items.length > 0);

  const allItems = allCategories.flatMap(c => c.items);
  const currentLabel = value
    ? allItems.find(i => i.type === value)?.label ?? value
    : 'Choose an action';

  const currentIcon = value
    ? allItems.find(i => i.type === value)?.icon
    : null;

  return (
    <div ref={wrapperRef} data-popover="type-search" style={{ position: 'relative', width: '100%' }}>
      {/* Trigger button — same styling as fieldSelect */}
      <button
        data-testid="type-search-trigger"
        style={{
          ...S.fieldSelect,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          textAlign: 'left',
          paddingRight: 28,
        }}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
      >
        {currentIcon && <span style={{ fontSize: 12, flexShrink: 0 }}>{currentIcon}</span>}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}>
          {currentLabel}
        </span>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--bld-text-disabled)', pointerEvents: 'none' }}>
          {open ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            ...S.dropdown,
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 300,
            minWidth: 'unset',
            width: '100%',
            maxHeight: 320,
          }}
        >
          <input
            ref={searchRef}
            style={S.dropdownSearch}
            placeholder="Search actions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="type-search-input"
          />
          {filtered.map(cat => (
            <div key={cat.category}>
              <div style={S.dropdownCategory}>{cat.category}</div>
              {cat.items.map(item => (
                <button
                  key={item.type}
                  style={S.dropdownItem(item.type === value)}
                  onMouseEnter={e => {
                    if (item.type !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)';
                  }}
                  onMouseLeave={e => {
                    if (item.type !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)';
                  }}
                  onClick={() => { onChange(item.type as ActionStepType); setOpen(false); setSearch(''); }}
                  data-testid={`type-option-${item.type}`}
                >
                  <span style={{ fontSize: 12 }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.type === value && <span style={{ color: 'var(--bld-accent)', fontSize: 10 }}>✓</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── Properties Panel ─────────────────────────────────────────────────────────

export function WorkflowMetaPanel({
  meta,
  onChange,
}: {
  meta: WorkflowMeta;
  onChange: (patch: Partial<WorkflowMeta>) => void;
}) {
  return (
    <div>
      <label style={S.fieldLabel}>Name</label>
      <input
        style={S.fieldInput}
        value={meta.name}
        placeholder="Workflow name"
        onChange={e => onChange({ name: e.target.value })}
      />
      {!meta.name.trim() && (
        <div style={{ ...S.warnBox, marginTop: 4 }}>⊕ A name is required.</div>
      )}

      <label style={{ ...S.fieldLabel, marginTop: 12 }}>Description</label>
      <textarea
        style={{ ...S.fieldInput, minHeight: 64, resize: 'vertical' }}
        value={meta.description ?? ''}
        placeholder="Description…"
        onChange={e => onChange({ description: e.target.value })}
      />
    </div>
  );
}

// ─── ParamsConfigPanel ────────────────────────────────────────────────────────
// Right-panel editor for global workflow parameters (shown when the Parameters
// node is selected on the canvas).

const PARAM_TYPE_ICONS: Record<string, string> = {
  Text: 'T',
  Number: '#',
  Boolean: '◎',
  Object: '{ }',
  Array: '[ ]',
};

export function ParamsConfigPanel({
  params,
  onChange,
}: {
  params: WorkflowParam[];
  onChange: (params: WorkflowParam[]) => void;
}) {
  function updateParam(index: number, patch: Partial<WorkflowParam>) {
    const next = params.map((p, i) => (i === index ? { ...p, ...patch } : p));
    onChange(next);
  }

  function addParam() {
    const newParam: WorkflowParam = {
      id: `p-${Date.now()}`,
      name: '',
      type: 'Text',
    };
    onChange([...params, newParam]);
  }

  function removeParam(index: number) {
    onChange(params.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-1)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, paddingBottom: 8, borderBottom: 'none' }}>
        <span style={{ fontSize: 14 }}>Φ</span>
        <span>Parameters</span>
      </div>

      {params.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--bld-text-3)', marginBottom: 12, fontStyle: 'italic' }}>
          No parameters yet. Add one below.
        </div>
      )}

      {params.map((param, i) => (
        <ParamEditor
          key={param.id}
          param={param}
          onUpdate={patch => updateParam(i, patch)}
          onRemove={() => removeParam(i)}
        />
      ))}

      <button
        type="button"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
          width: '100%', padding: '7px 10px', background: 'var(--bld-bg-input)',
          border: '1px dashed var(--bld-border-subtle)', borderRadius: 6, color: 'var(--bld-info)',
          fontSize: 11, cursor: 'pointer', fontWeight: 600,
        }}
        onClick={addParam}
      >
        + Add Parameter
      </button>
    </div>
  );
}

function ParamEditor({
  param,
  onUpdate,
  onRemove,
}: {
  param: WorkflowParam;
  onUpdate: (patch: Partial<WorkflowParam>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [typeOpen, setTypeOpen] = useState(false);
  // Use a ref for the tag input — avoids stale closure issues entirely.
  // The DOM input is uncontrolled; we only read its value on submit.
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [tagTick, setTagTick] = useState(0); // force re-render after adding a tag
  const typeBtnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const PARAM_TYPES: WorkflowParam['type'][] = ['Text', 'Number', 'Boolean', 'Object', 'Array'];

  // Close dropdown on outside click
  useEffect(() => {
    if (!typeOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        typeBtnRef.current && typeBtnRef.current.contains(e.target as Node)
      ) return;
      if (
        dropdownRef.current && dropdownRef.current.contains(e.target as Node)
      ) return;
      setTypeOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [typeOpen]);

  // Tag list — only used when type=Text and allowMultiple=true
  const testTags: string[] = (param.type === 'Text' && param.allowMultiple)
    ? Array.isArray(param.testValue) ? (param.testValue as string[]) : (param.testValue ? [String(param.testValue)] : [])
    : [];

  function commitTagInput() {
    const raw = tagInputRef.current?.value ?? '';
    const trimmed = raw.trim();
    if (!trimmed) return;
    // Read testTags fresh from param.testValue to avoid stale closure
    const currentTags: string[] = Array.isArray(param.testValue) ? (param.testValue as string[]) : (param.testValue ? [String(param.testValue)] : []);
    onUpdate({ testValue: [...currentTags, trimmed] });
    if (tagInputRef.current) tagInputRef.current.value = '';
    setTagTick(t => t + 1); // force re-render so the input stays clear
  }

  function removeTag(idx: number) {
    onUpdate({ testValue: testTags.filter((_, i) => i !== idx) });
  }

  // When type changes, reset testValue and allowMultiple to sensible defaults
  function handleTypeChange(t: WorkflowParam['type']) {
    const patch: Partial<WorkflowParam> = { type: t };
    if (t === 'Boolean') patch.testValue = false;
    else if (t === 'Object') patch.testValue = '{}';
    else if (t === 'Array') patch.testValue = '[]';
    else patch.testValue = '';
    if (t !== 'Text') patch.allowMultiple = false;
    onUpdate(patch);
    setTypeOpen(false);
  }

  // Render the correct test-value input for each type
  function renderTestValueInput() {
    if (param.type === 'Text' && param.allowMultiple) {
      // tagTick is read here only to force this function to re-run after a tag is added
      void tagTick;
      return (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 6px', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 5, minHeight: 32, alignItems: 'center' }}>
            {testTags.map((tag, ti) => (
              <span key={ti} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'var(--bld-bg-elevated)', color: 'var(--bld-accent)', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
                {tag}
                <button type="button" onClick={e => { e.stopPropagation(); removeTag(ti); }} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              style={{ flex: 1, minWidth: 60, background: 'transparent', border: 'none', outline: 'none', color: 'var(--bld-text-2)', fontSize: 11 }}
              placeholder="Type and press Enter…"
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTagInput();
                } else if (e.key === 'Backspace' && !(e.currentTarget as HTMLInputElement).value && testTags.length > 0) {
                  removeTag(testTags.length - 1);
                }
              }}
            />
            <button
              type="button"
              onClick={e => { e.stopPropagation(); commitTagInput(); tagInputRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
              title="Add tag"
            >+</button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 2 }}>Press Enter or click + to add a chip</div>
        </div>
      );
    }

    if (param.type === 'Text') {
      return (
        <input
          style={S.fieldInput}
          value={String(param.testValue ?? '')}
          placeholder="Test text value…"
          onChange={e => onUpdate({ testValue: e.target.value })}
        />
      );
    }

    if (param.type === 'Number') {
      return (
        <input
          type="number"
          style={S.fieldInput}
          value={param.testValue === undefined || param.testValue === '' ? '' : String(param.testValue)}
          placeholder="0"
          onChange={e => onUpdate({ testValue: e.target.value === '' ? '' : Number(e.target.value) })}
        />
      );
    }

    if (param.type === 'Boolean') {
      const boolVal = param.testValue === true || param.testValue === 'true';
      return (
        <div style={{ display: 'flex', background: 'var(--bld-bg-input)', borderRadius: 5, padding: 2, gap: 2, marginTop: 2 }}>
          {[true, false].map(v => (
            <button
              key={String(v)}
              type="button"
              onClick={() => onUpdate({ testValue: v })}
              style={{
                flex: 1, padding: '5px 0', fontSize: 11, border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                background: boolVal === v ? (v ? 'rgba(34,197,94,0.2)' : 'rgba(248,113,113,0.2)') : 'transparent',
                color: boolVal === v ? (v ? 'var(--bld-success)' : 'var(--bld-error)') : 'var(--bld-text-disabled)',
                transition: 'background 0.1s, color 0.1s',
              }}
            >
              {v ? 'true' : 'false'}
            </button>
          ))}
        </div>
      );
    }

    if (param.type === 'Object' || param.type === 'Array') {
      const strVal = typeof param.testValue === 'string'
        ? param.testValue
        : param.testValue !== undefined ? JSON.stringify(param.testValue, null, 2) : (param.type === 'Array' ? '[]' : '{}');
      return (
        <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid var(--bld-border-subtle)', marginTop: 2 }}>
          <CodeMirror
            value={strVal}
            height="auto"
            minHeight="70px"
            maxHeight="160px"
            extensions={[json()]}
            theme={oneDark}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            style={{ fontSize: 11 }}
            onChange={val => onUpdate({ testValue: val })}
          />
        </div>
      );
    }

    return null;
  }

  return (
    <div style={{ marginBottom: 8, background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-bg-input)', borderRadius: 6, overflow: 'visible', position: 'relative' }}>
      {/* Header row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', cursor: 'pointer', userSelect: 'none', borderRadius: expanded ? '6px 6px 0 0' : 6 }}
        onClick={() => setExpanded(v => !v)}
      >
        <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
        <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--bld-bg-elevated)', color: 'var(--bld-info)', borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace' }}>
          {PARAM_TYPE_ICONS[param.type] ?? 'T'}
        </span>
        <span style={{ flex: 1, fontSize: 11, color: param.name ? 'var(--bld-text-2)' : 'var(--bld-text-disabled)', fontStyle: param.name ? 'normal' : 'italic' }}>
          {param.name || 'Unnamed'}
        </span>
        <button
          type="button"
          title="Remove parameter"
          onClick={e => { e.stopPropagation(); onRemove(); }}
          style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: '0 8px 10px', borderTop: 'none' }}>

          {/* Name */}
          <label style={{ ...S.fieldLabel, marginTop: 8 }}>Name *</label>
          <input
            style={S.fieldInput}
            value={param.name}
            placeholder="e.g. username"
            onChange={e => onUpdate({ name: e.target.value })}
          />

          {/* Type */}
          <label style={{ ...S.fieldLabel, marginTop: 8 }}>Type *</label>
          <div style={{ position: 'relative' }}>
            <button
              ref={typeBtnRef}
              type="button"
              onClick={e => { e.stopPropagation(); setTypeOpen(v => !v); }}
              style={{ ...S.fieldInput, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', width: '100%', textAlign: 'left' }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--bld-bg-elevated)', color: 'var(--bld-info)', borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace' }}>
                {PARAM_TYPE_ICONS[param.type]}
              </span>
              <span style={{ flex: 1, color: 'var(--bld-text-2)', fontSize: 11 }}>{param.type}</span>
              <span style={{ fontSize: 10, color: 'var(--bld-text-3)' }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg></span>
            </button>
            {/* Dropdown — absolute inside a no-overflow wrapper so it escapes the card */}
            {typeOpen && (
              <div
                ref={dropdownRef}
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  zIndex: 99999, marginTop: 2,
                  background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)',
                  borderRadius: 6, overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                }}
              >
                {PARAM_TYPES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 10px', background: param.type === t ? 'var(--bld-accent-subtle)' : 'transparent', border: 'none', color: param.type === t ? 'var(--bld-accent)' : 'var(--bld-text-2)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={e => { if (param.type !== t) (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                    onMouseLeave={e => { if (param.type !== t) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{ fontFamily: 'monospace', fontSize: 10, width: 28, textAlign: 'center', color: 'var(--bld-info)', background: 'var(--bld-bg-elevated)', borderRadius: 3, padding: '1px 4px' }}>{PARAM_TYPE_ICONS[t]}</span>
                    <span style={{ flex: 1 }}>{t}</span>
                    {t === 'Text' && <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)' }}>abc</span>}
                    {t === 'Number' && <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)' }}>123</span>}
                    {t === 'Boolean' && <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)' }}>true/false</span>}
                    {(t === 'Object' || t === 'Array') && <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)' }}>JSON</span>}
                    {param.type === t && <span style={{ marginLeft: 4, color: 'var(--bld-accent)', fontSize: 10 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Allow multiple values — Text only (weWeb-style) */}
          {param.type === 'Text' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, padding: '6px 8px', background: 'var(--bld-bg-base)', borderRadius: 5 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--bld-text-2)', fontWeight: 500 }}>Allow multiple values</div>
                <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 1 }}>Accepts a list of text values</div>
              </div>
              <div
                onClick={() => onUpdate({ allowMultiple: !param.allowMultiple, testValue: param.allowMultiple ? '' : [] })}
                style={{
                  width: 32, height: 18, borderRadius: 9, cursor: 'pointer', flexShrink: 0,
                  background: param.allowMultiple ? 'var(--bld-accent)' : 'var(--bld-border-subtle)',
                  position: 'relative', transition: 'background 0.15s',
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, left: param.allowMultiple ? 16 : 2, width: 14, height: 14,
                  borderRadius: '50%', background: 'var(--bld-accent-fg)', transition: 'left 0.15s',
                }} />
              </div>
            </div>
          )}

          {/* Test value — type-specific input */}
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Test value</label>
          {renderTestValueInput()}

        </div>
      )}
    </div>
  );
}


// ─── Shared canvas helpers ────────────────────────────────────────────────────

/** Bigger pill-style On/Off toggle matching the right panel's OnOffToggle */
export function CanvasOnOffToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const base: React.CSSProperties = {
    padding: '4px 16px', fontSize: 11, border: 'none', borderRadius: 3,
    cursor: 'pointer', fontWeight: 500,
  };
  return (
    <div style={{ display: 'flex', background: 'var(--bld-bg-input)', borderRadius: 4, padding: 2, gap: 2 }}>
      <button style={{ ...base, background: value ? 'var(--bld-border-subtle)' : 'transparent', color: value ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}
        onClick={() => onChange(true)}>On</button>
      <button style={{ ...base, background: !value ? 'var(--bld-border-subtle)' : 'transparent', color: !value ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}
        onClick={() => onChange(false)}>Off</button>
    </div>
  );
}

// ─── PagePickerDropdown ───────────────────────────────────────────────────────
// Searchable dropdown that lists all builder pages (from routes config).
// Matches the exact style of TypeSearchDropdown.

export function PagePickerDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (path: string) => void;
}) {
  const pages = useBuilderStore(s => s.pages);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const options = pages
    .filter(p => p.route)
    .map(p => ({ name: p.name, path: p.route }));

  // Default to first page when no value is set
  const effectiveValue = value || options[0]?.path || '';

  const q = search.toLowerCase();
  const filtered = options.filter(p =>
    !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
  );

  const selected = options.find(p => p.path === effectiveValue);
  const currentLabel = selected ? selected.name : 'Select a page…';

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="page-picker"]')) {
        setOpen(false);
        setSearch('');
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  // Emit the default value on first render so cfg.defaultPath is always set
  useEffect(() => {
    if (!value && options[0]?.path) onChange(options[0].path);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapperRef} data-popover="page-picker" style={{ position: 'relative', width: '100%' }}>
      <button
        style={{
          ...S.fieldSelect,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          textAlign: 'left',
          paddingRight: 28,
        }}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
      >
        <span style={{ fontSize: 12, flexShrink: 0 }}>🔗</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: effectiveValue ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}>
          {currentLabel}
        </span>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--bld-text-disabled)', pointerEvents: 'none' }}>
          {open ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}
        </span>
      </button>

      {open && (
        <div
          style={{
            ...S.dropdown,
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 300,
            minWidth: 'unset',
            width: '100%',
            maxHeight: 320,
          }}
        >
          <input
            ref={searchRef}
            style={S.dropdownSearch}
            placeholder="Search pages…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {filtered.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--bld-text-disabled)' }}>No pages found</div>
          )}
          {filtered.map(p => (
            <button
              key={p.path}
              style={S.dropdownItem(p.path === effectiveValue)}
              onMouseEnter={e => { if (p.path !== effectiveValue) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
              onMouseLeave={e => { if (p.path !== effectiveValue) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
              onClick={() => { onChange(p.path); setOpen(false); setSearch(''); }}
            >
              <span style={{ flex: 1 }}>{p.name}</span>
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>{p.path}</span>
              {p.path === effectiveValue && <span style={{ color: 'var(--bld-accent)', fontSize: 10 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OptionPickerDropdown ─────────────────────────────────────────────────────
// Generic custom dropdown for a fixed list of options.
// Matches the exact style of TypeSearchDropdown / PagePickerDropdown.

export function OptionPickerDropdown({
  value,
  onChange,
  options,
  placeholder = 'Select…',
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="option-picker"]')) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  return (
    <div ref={wrapperRef} data-popover="option-picker" style={{ position: 'relative', width: '100%' }}>
      <button
        style={{
          ...S.fieldSelect,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          textAlign: 'left',
          paddingRight: 28,
        }}
        onClick={() => setOpen(v => !v)}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: value ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}>
          {selected?.label ?? placeholder}
        </span>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          fontSize: 10, color: 'var(--bld-text-disabled)', pointerEvents: 'none' }}>
          {open ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}
        </span>
      </button>

      {open && (
        <div style={{
          ...S.dropdown,
          position: 'absolute', top: '100%', left: 0, right: 0,
          zIndex: 300, minWidth: 'unset', width: '100%',
        }}>
          {options.map(o => (
            <button
              key={o.value}
              style={S.dropdownItem(o.value === value)}
              onMouseEnter={e => { if (o.value !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
              onMouseLeave={e => { if (o.value !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.value === value && <span style={{ color: 'var(--bld-accent)', fontSize: 10 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CollectionPickerDropdown ─────────────────────────────────────────────────
// Searchable dropdown listing all datasources (collections) from the builder store.
// Matches the exact style of TypeSearchDropdown / PagePickerDropdown.

export function CollectionPickerDropdown({
  value,
  onChange,
  placeholder = 'Select a collection…',
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const collections = useBuilderStore(s => s.pageDataSources);
  // dsActionsMap: datasourceUUID → actionUUID (for saving old-format collectionName)
  // actionsByDs: actionUUID → datasourceUUID (for resolving old-format display)
  const dsActionsMap = useBuilderStore(s => s.dsActionsMap);

  // Resolve value: if value is an action UUID (old format), find the corresponding datasource UUID
  const resolvedValue = (() => {
    if (!value) return value;
    // Check if value matches a datasource id directly (new format)
    const direct = (collections as Array<{ id: string }>).find(c => c.id === value);
    if (direct) return value;
    // Check if value is a datasource UUID that has an action (should already match above)
    // Otherwise, it might be an action UUID — check dsActionsMap for reverse lookup
    // dsActionsMap is datasourceUUID→actionUUID, so we need actionUUID→datasourceUUID
    for (const [dsId, actionId] of Object.entries(dsActionsMap)) {
      if (actionId === value) return dsId;
    }
    return value;
  })();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // datasources store label in _label, operationName in _operationName; name may be empty
  type RichDs = typeof collections[number] & { _label?: string; _operationName?: string };
  const getLabel = (c: RichDs) =>
    (c as RichDs)._label || (c as RichDs)._operationName || c.name || c.id;

  const q = search.toLowerCase();
  const filtered = (collections as RichDs[]).filter(c => {
    const lbl = getLabel(c).toLowerCase();
    return !q || lbl.includes(q) || c.id.toLowerCase().includes(q);
  });
  const selected = (collections as RichDs[]).find(c => c.id === resolvedValue);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="collection-picker"]')) {
        setOpen(false);
        setSearch('');
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  return (
    <div ref={wrapperRef} data-popover="collection-picker" style={{ position: 'relative', width: '100%' }}>
      <button
        style={{
          ...S.fieldSelect,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          textAlign: 'left',
          paddingRight: 28,
        }}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
      >
        <span style={{ fontSize: 12, flexShrink: 0 }}>🗄</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}>
          {selected ? getLabel(selected) : placeholder}
        </span>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--bld-text-disabled)', pointerEvents: 'none' }}>
          {open ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}
        </span>
      </button>

      {open && (
        <div
          style={{
            ...S.dropdown,
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 300,
            minWidth: 'unset',
            width: '100%',
            maxHeight: 320,
          }}
        >
          <input
            ref={searchRef}
            style={S.dropdownSearch}
            placeholder="Search collections…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {filtered.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--bld-text-disabled)' }}>No collections found</div>
          )}
          {filtered.map(c => (
            <button
              key={c.id}
              style={S.dropdownItem(c.id === value)}
              onMouseEnter={e => { if (c.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
              onMouseLeave={e => { if (c.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
              onClick={() => { onChange(c.id); setOpen(false); setSearch(''); }}
            >
              <span style={{ flex: 1 }}>{getLabel(c)}</span>
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>{c.type}</span>
              {c.id === value && <span style={{ color: 'var(--bld-accent)', fontSize: 10 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── NavigateToConfig ─────────────────────────────────────────────────────────

type QueryParam = { name: string; value: FormulaValue };



export function NavigateToConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [openField, setOpenField] = useState<'externalUrl' | 'path' | 'queries' | `query-${number}` | `query-name-${number}` | null>(null);
  const queryParams: QueryParam[] = Array.isArray(cfg.queryParams) ? (cfg.queryParams as QueryParam[]) : [];

  function setQueryParam(idx: number, patch: Partial<QueryParam>) {
    const next = queryParams.map((q, i) => i === idx ? { ...q, ...patch } : q);
    setCfg('queryParams', next);
  }

  function addQueryParam() {
    setCfg('queryParams', [...queryParams, { name: '', value: null }]);
  }

  function removeQueryParam(idx: number) {
    setCfg('queryParams', queryParams.filter((_, i) => i !== idx));
  }

  const isExternal = (cfg.linkType as string) === 'external';

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Link type</label>
      <div style={S.toggleGroup}>
        <button style={S.toggleBtn(!isExternal)} onClick={() => setCfg('linkType', 'internal')}>Internal link</button>
        <button style={S.toggleBtn(isExternal)} onClick={() => setCfg('linkType', 'external')}>External link</button>
      </div>

      {isExternal ? (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>External URL *</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {isBoundValue(cfg.externalUrl as FormulaValue) ? (
              <button
                onClick={() => setOpenField(f => f === 'externalUrl' ? null : 'externalUrl')}
                style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
                  borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                  textAlign: 'left' }}
              >ƒ Edit formula</button>
            ) : (
              <input
                style={{ ...S.fieldInput, flex: 1 }}
                placeholder="Enter an URL"
                value={typeof cfg.externalUrl === 'string' ? cfg.externalUrl : ''}
                onChange={e => setCfg('externalUrl', e.target.value)}
              />
            )}
            <BindingIcon
              isBound={isBoundValue(cfg.externalUrl as FormulaValue)}
              onClick={() => setOpenField(f => f === 'externalUrl' ? null : 'externalUrl')}
            />
          </div>
          {openField === 'externalUrl' && (
            <FormulaEditor
              label="External URL"
              value={(cfg.externalUrl as FormulaValue) ?? null}
              onChange={v => { setCfg('externalUrl', v); setOpenField(null); }}
              onClose={() => setOpenField(null)}
              anchorRight={292}
            />
          )}
        </>
      ) : (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Path *</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {isBoundValue(cfg.path as FormulaValue) ? (
              <button
                onClick={() => setOpenField(f => f === 'path' ? null : 'path')}
                style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
                  borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                  textAlign: 'left' }}
              >ƒ Edit formula</button>
            ) : (
              <input
                style={{ ...S.fieldInput, flex: 1 }}
                placeholder="Enter a path"
                value={typeof cfg.path === 'string' ? cfg.path : ''}
                onChange={e => setCfg('path', e.target.value)}
              />
            )}
            <BindingIcon
              isBound={isBoundValue(cfg.path as FormulaValue)}
              onClick={() => setOpenField(f => f === 'path' ? null : 'path')}
            />
          </div>
          {openField === 'path' && (
            <FormulaEditor
              label="Path"
              value={(cfg.path as FormulaValue) ?? null}
              onChange={v => { setCfg('path', v); setOpenField(null); }}
              onClose={() => setOpenField(null)}
              anchorRight={292}
            />
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <label style={S.fieldLabel}>Open in a new tab</label>
            <CanvasOnOffToggle value={!!(cfg.newTab)} onChange={v => setCfg('newTab', v)} />
          </div>

          {/* Queries */}
          {isBoundValue(cfg.queries as FormulaValue) ? (
            <>
              <label style={{ ...S.fieldLabel, marginTop: 12 }}>Queries</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={() => setOpenField(f => f === 'queries' ? null : 'queries')}
                  style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
                    borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                    textAlign: 'left' }}
                >
                  ƒ Edit formula
                </button>
                <BindingIcon
                  isBound
                  onClick={() => setOpenField(f => f === 'queries' ? null : 'queries')}
                />
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--bld-text-3)' }}>Queries</span>
                <BindingIcon
                  isBound={false}
                  onClick={() => setOpenField(f => f === 'queries' ? null : 'queries')}
                />
              </div>
        <button
          style={{ fontSize: 11, color: 'var(--bld-accent)', background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={addQueryParam}
        >
          + Add
        </button>
      </div>
          )}
          {openField === 'queries' && (
            <FormulaEditor
              label="Queries"
              value={(cfg.queries as FormulaValue) ?? null}
              onChange={v => { setCfg('queries', v); setOpenField(null); }}
              onClose={() => setOpenField(null)}
              anchorRight={292}
            />
          )}
          {!isBoundValue(cfg.queries as FormulaValue) && queryParams.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {queryParams.map((qp, idx) => {
                const nameBound = isBoundValue(qp.name as FormulaValue);
                const valBound = isBoundValue(qp.value);
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {/* Name field */}
                      {nameBound ? (
                        <button
                          onClick={() => setOpenField(f => f === `query-name-${idx}` ? null : `query-name-${idx}`)}
                          style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
                            borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                            textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          ƒ Edit formula
                        </button>
                      ) : (
          <input
            style={{ ...S.fieldInput, flex: 1 }}
                          placeholder="Name"
                          value={typeof qp.name === 'string' ? qp.name : ''}
                          onChange={e => setQueryParam(idx, { name: e.target.value })}
                        />
                      )}
                      <BindingIcon
                        isBound={nameBound}
                        onClick={() => setOpenField(f => f === `query-name-${idx}` ? null : `query-name-${idx}`)}
                      />
                      {/* Value field */}
                      {valBound ? (
                        <button
                          onClick={() => setOpenField(f => f === `query-${idx}` ? null : `query-${idx}`)}
                          style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
                            borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                            textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          ƒ Edit formula
                        </button>
                      ) : (
                        <input
                          style={{ ...S.fieldInput, flex: 1 }}
                          placeholder="Value"
                          value={typeof qp.value === 'string' ? qp.value : ''}
                          onChange={e => setQueryParam(idx, { value: e.target.value as FormulaValue })}
                        />
                      )}
                      <BindingIcon
                        isBound={valBound}
                        onClick={() => setOpenField(f => f === `query-${idx}` ? null : `query-${idx}`)}
                      />
          <button
                        style={{ background: 'none', border: 'none', color: 'var(--bld-error)', cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0 }}
                        onClick={() => removeQueryParam(idx)}
          >
                        ×
          </button>
        </div>
                    {openField === `query-name-${idx}` && (
                      <FormulaEditor
                        label={`Query name ${idx + 1}`}
                        value={(qp.name as FormulaValue) ?? null}
                        onChange={v => { setQueryParam(idx, { name: v as string }); setOpenField(null); }}
                        onClose={() => setOpenField(null)}
                        anchorRight={292}
                      />
                    )}
                    {openField === `query-${idx}` && (
                      <FormulaEditor
                        label={`Query value: ${typeof qp.name === 'string' ? qp.name : String(idx)}`}
                        value={qp.value ?? null}
                        onChange={v => { setQueryParam(idx, { value: v as FormulaValue }); setOpenField(null); }}
                        onClose={() => setOpenField(null)}
                        anchorRight={292}
                      />
                    )}
    </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 8, borderTop: '1px solid var(--bld-border-subtle)', paddingTop: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)' }}>Loader on page change</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--bld-text-3)' }}>Show page loader</span>
              <CanvasOnOffToggle value={!!(cfg.showLoader)} onChange={v => setCfg('showLoader', v)} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── AddSharedComponentConfig ─────────────────────────────────────────────────

function SCModelDropdown({
  value,
  models,
  onChange,
}: {
  value: string;
  models: SharedComponentModel[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="sc-model-search"]')) {
        setOpen(false);
        setSearch('');
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  const q = search.toLowerCase();
  const filtered = models.filter(m => m.name.toLowerCase().includes(q));
  const selectedModel = models.find(m => m.id === value);

  return (
    <div data-popover="sc-model-search" style={{ position: 'relative', width: '100%' }}>
      <button
        data-testid="addSC-model-select"
        style={{ ...S.fieldSelect, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textAlign: 'left', paddingRight: 28 }}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); setSearch(''); }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}>
          {selectedModel ? selectedModel.name : 'Choose a shared component'}
        </span>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--bld-text-disabled)', pointerEvents: 'none' }}>
          {open ? '\u25B4' : '\u25BE'}
        </span>
      </button>
      {open && (
        <div style={{ ...S.dropdown, position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, minWidth: 'unset', width: '100%', maxHeight: 260 }}>
          <input ref={searchRef} style={S.dropdownSearch} placeholder="Search components\u2026" value={search} onChange={e => setSearch(e.target.value)} />
          {filtered.length === 0 && <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--bld-text-disabled)' }}>No components found</div>}
          {filtered.map(m => (
            <button
              key={m.id}
              style={S.dropdownItem(m.id === value)}
              onMouseEnter={e => { if (m.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
              onMouseLeave={e => { if (m.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
              onClick={e => { e.stopPropagation(); onChange(m.id); setOpen(false); setSearch(''); }}
            >
              <span style={{ flex: 1 }}>{m.name}</span>
              <span style={{ fontSize: 9, color: 'var(--bld-info)', background: 'var(--bld-bg-elevated)', borderRadius: 3, padding: '1px 5px', fontWeight: 700 }}>SC</span>
              {m.id === value && <span style={{ color: 'var(--bld-accent)', fontSize: 10, marginLeft: 4 }}>{'\u2713'}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SCPropInput({ prop, value, onChange, onFormulaClick, formulaOpen }: {
  prop: SharedComponentModel['properties'][0];
  value: FormulaValue | string | unknown;
  onChange: (v: FormulaValue | string | unknown) => void;
  onFormulaClick: () => void;
  formulaOpen: boolean;
}) {
  const isBound = isBoundValue(value as FormulaValue);

  if (isBound) {
    return (
      <button
        onClick={onFormulaClick}
        style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)', borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500, textAlign: 'left' }}
      >{'\u0192'} Edit formula</button>
    );
  }

  if (prop.type === 'boolean') {
    return (
      <div style={{ ...S.toggleGroup, flex: 1 }}>
        <button style={S.toggleBtn(!!value)} onClick={() => onChange(true)}>On</button>
        <button style={S.toggleBtn(!value)} onClick={() => onChange(false)}>Off</button>
      </div>
    );
  }

  if (prop.type === 'number') {
    return (
      <input
        type="number"
        style={{ ...S.fieldInput, flex: 1 }}
        placeholder={prop.defaultValue != null ? String(prop.defaultValue) : `${prop.name}\u2026`}
        value={typeof value === 'number' ? value : (typeof value === 'string' ? value : '')}
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }

  if (prop.type === 'color') {
    const colorVal = String(value ?? prop.defaultValue ?? '#000000');
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1 }}>
        <FigmaColorPicker value={colorVal} onChange={c => onChange(c)} label="" />
        <input
          style={{ ...S.fieldInput, flex: 1 }}
          value={colorVal}
          onChange={e => onChange(e.target.value)}
          placeholder={String(prop.defaultValue ?? '#000000')}
        />
      </div>
    );
  }

  if (prop.type === 'select') {
    const opts = (prop.options ?? []) as Array<{ label: string; value: string }>;
    return (
      <select
        style={{ ...S.fieldInput, flex: 1, cursor: 'pointer' }}
        value={String(value ?? prop.defaultValue ?? '')}
        onChange={e => onChange(e.target.value)}
      >
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        {!opts.length && <option value={String(value ?? '')}>{String(value ?? '(no options)')}</option>}
      </select>
    );
  }

  if (prop.type === 'size') {
    const sizeStr = String(value ?? prop.defaultValue ?? '');
    const match = sizeStr.match(/^([\d.]+)(.*)$/);
    const num = match ? match[1] : '';
    const unit = match ? match[2] : 'px';
    return (
      <div style={{ display: 'flex', gap: 3, flex: 1 }}>
        <input
          type="number"
          style={{ ...S.fieldInput, flex: 1 }}
          value={num}
          onChange={e => onChange(`${e.target.value}${unit || 'px'}`)}
          placeholder="0"
        />
        <select
          style={{ ...S.fieldInput, width: 52 }}
          value={unit || 'px'}
          onChange={e => onChange(`${num}${e.target.value}`)}
        >
          {['px', '%', 'vh', 'vw'].map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
    );
  }

  if (prop.type === 'icon') {
    const iconStr = String(value ?? prop.defaultValue ?? '');
    return (
      <input
        style={{ ...S.fieldInput, flex: 1 }}
        placeholder="lucide:check"
        value={iconStr}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  if (prop.type === 'list' || prop.type === 'any') {
    const jsonStr = typeof value === 'string' ? value : (value !== undefined ? JSON.stringify(value, null, 2) : '');
    return (
      <input
        style={{ ...S.fieldInput, flex: 1, fontFamily: 'monospace' }}
        placeholder="[]"
        value={jsonStr}
        onChange={e => onChange(e.target.value)}
      />
    );
  }

  return (
    <input
      style={{ ...S.fieldInput, flex: 1 }}
      placeholder={prop.defaultValue != null ? String(prop.defaultValue) : `${prop.name}\u2026`}
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value)}
    />
  );
}

export function AddSharedComponentConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [models, setModels] = useState<SharedComponentModel[]>([]);
  const [openField, setOpenField] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setModels(getSharedComponentList());
    refresh();
    return subscribeSharedComponents(refresh);
  }, []);

  const selectedModel = models.find(m => m.id === cfg.componentId);
  const propValues = (cfg.props ?? {}) as Record<string, FormulaValue | string>;

  const setPropValue = (propName: string, value: FormulaValue | string | unknown) => {
    setCfg('props', { ...propValues, [propName]: value });
  };

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Shared Component</label>
      <SCModelDropdown
        value={(cfg.componentId as string) ?? ''}
        models={models}
        onChange={id => { setCfg('componentId', id); setCfg('props', {}); }}
      />

      {selectedModel && selectedModel.properties.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 10, marginBottom: 2, textTransform: 'none' }}>Properties</div>
          {selectedModel.properties.map(prop => {
            const fieldKey = `prop_${prop.id}`;
            const currentVal = propValues[prop.name];
            return (
              <React.Fragment key={prop.id}>
                <label style={{ ...S.fieldLabel, marginTop: 6 }}>
                  {prop.name}
                  <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', marginLeft: 4 }}>({prop.type})</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <SCPropInput
                    prop={prop}
                    value={currentVal}
                    onChange={v => setPropValue(prop.name, v)}
                    onFormulaClick={() => setOpenField(f => f === fieldKey ? null : fieldKey)}
                    formulaOpen={openField === fieldKey}
                  />
                  <BindingIcon
                    isBound={isBoundValue(currentVal as FormulaValue)}
                    onClick={() => setOpenField(f => f === fieldKey ? null : fieldKey)}
                  />
                </div>
                {openField === fieldKey && (
                  <FormulaEditor
                    label={prop.name}
                    value={(currentVal as FormulaValue) ?? null}
                    onChange={v => { setPropValue(prop.name, v); setOpenField(null); }}
                    onClose={() => setOpenField(null)}
                    anchorRight={292}
                  />
                )}
              </React.Fragment>
            );
          })}
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--bld-text-3)' }}>Wait close</span>
        <div style={{ ...S.toggleGroup, width: 90 }}>
          <button data-testid="addSC-waitClose-on" style={S.toggleBtn(!!(cfg.waitClose))} onClick={() => setCfg('waitClose', true)}>On</button>
          <button data-testid="addSC-waitClose-off" style={S.toggleBtn(!(cfg.waitClose))} onClick={() => setCfg('waitClose', false)}>Off</button>
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 4 }}>
        When on, the workflow pauses until the instance is deleted. The delete step{'\u2019'}s return value becomes this step{'\u2019'}s result.
      </div>
    </>
  );
}

export function DeleteSharedComponentConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [openField, setOpenField] = useState<string | null>(null);
  const currentVal = cfg.returnValue as FormulaValue | string | undefined;
  const isBound = isBoundValue(currentVal as FormulaValue);

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Return value (optional)</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {isBound ? (
          <button
            onClick={() => setOpenField(f => f === 'returnValue' ? null : 'returnValue')}
            style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)', borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500, textAlign: 'left' }}
          >{'\u0192'} Edit formula</button>
        ) : (
          <input
            style={{ ...S.fieldInput, flex: 1 }}
            placeholder="e.g. confirmed"
            value={typeof currentVal === 'string' ? currentVal : ''}
            onChange={e => setCfg('returnValue', e.target.value)}
          />
        )}
        <BindingIcon isBound={isBound} onClick={() => setOpenField(f => f === 'returnValue' ? null : 'returnValue')} />
      </div>
      {openField === 'returnValue' && (
        <FormulaEditor
          label="Return value"
          value={(currentVal as FormulaValue) ?? null}
          onChange={v => { setCfg('returnValue', v); setOpenField(null); }}
          onClose={() => setOpenField(null)}
          anchorRight={292}
        />
      )}
      <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 6 }}>
        Deletes the current shared component instance. If Wait Close was used, the return value is sent back as context.workflow[{'\u2018'}stepId{'\u2019'}].result.
      </div>
    </>
  );
}

export function DeleteAllSharedComponentsConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [models, setModels] = useState<SharedComponentModel[]>([]);

  useEffect(() => {
    const refresh = () => setModels(getSharedComponentList());
    refresh();
    return subscribeSharedComponents(refresh);
  }, []);

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Shared Component (optional)</label>
      <SCModelDropdown
        value={(cfg.componentId as string) ?? ''}
        models={models}
        onChange={id => setCfg('componentId', id || undefined)}
      />
      <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 6 }}>
        If set, only deletes instances of this component. If empty, deletes all dynamic shared component instances.
      </div>
    </>
  );
}

// ─── SetFormStateConfig ───────────────────────────────────────────────────────

export function SetFormStateConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  function renderBoolField(key: 'isSubmitting' | 'isSubmitted', label: string) {
    const val = cfg[key] as boolean | undefined;
    return (
      <>
        <label style={{ ...S.fieldLabel, marginTop: 10 }}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CanvasOnOffToggle value={val === true} onChange={v => setCfg(key, v)} />
        </div>
      </>
    );
  }

  return (
    <>
      <div style={S.infoBox}>Set isSubmitting and isSubmitted</div>
      {renderBoolField('isSubmitting', 'isSubmitting')}
      {renderBoolField('isSubmitted', 'isSubmitted')}
    </>
  );
}

// ─── ResetFormConfig ──────────────────────────────────────────────────────────

export function ResetFormConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const val = cfg.initialValues as FormulaValue | string | undefined;
  const bound = isBoundValue(val as FormulaValue);

  return (
    <>
      <div style={S.infoBox}>Reset the form fields to their initial values</div>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>initialValues</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Bind icon on the LEFT, matching WeWeb reference */}
        <BindingIcon isBound={bound} onClick={() => setOpen(v => !v)} />
        {bound ? (
          <button
            onClick={() => setOpen(v => !v)}
            style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
              borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              textAlign: 'left' }}
          >ƒ Edit formula</button>
        ) : (
          <textarea
            style={{ ...S.fieldInput, flex: 1, minHeight: 72, fontFamily: 'monospace', fontSize: 11 }}
            placeholder={'{\n  "fieldName": "value"\n}'}
            value={typeof val === 'string' ? val : ''}
            onChange={e => setCfg('initialValues', e.target.value || undefined)}
          />
        )}
      </div>
      {open && (
        <FormulaEditor
          label="initialValues"
          value={(val as FormulaValue) ?? null}
          onChange={v => { setCfg('initialValues', v); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRight={292}
        />
      )}
    </>
  );
}

// ─── WorkflowKvEditor ─────────────────────────────────────────────────────────
// Key/value pair editor for step config (variables, headers).
// Both key and value support formula binding via BindingIcon + FormulaEditor.

interface KvPair {
  id: string;
  key: string; keyBound: boolean;
  value: string; valueBound: boolean;
}

// Which field of a pair has the formula editor open: 'key' | 'value'
type KvFormulaTarget = { id: string; field: 'key' | 'value' };

function kvObjToArr(obj: Record<string, unknown> | undefined): KvPair[] {
  if (!obj) return [];
  return Object.entries(obj).map(([k, v], i) => ({
    id: `kv-${i}-${k}`,
    key: typeof k === 'string' ? k : JSON.stringify(k),
    keyBound: false,
    value: typeof v === 'string' ? v : JSON.stringify(v),
    valueBound: isBoundValue(v as FormulaValue),
  }));
}

function kvArrToObj(pairs: KvPair[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const p of pairs) {
    if (!p.key && !p.keyBound) continue;
    const resolvedValue = p.valueBound
      ? (() => { try { return JSON.parse(p.value); } catch { return p.value; } })()
      : p.value;
    result[p.key] = resolvedValue;
  }
  return result;
}

const FORMULA_BTN_STYLE: React.CSSProperties = {
  flex: 1, background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
  color: 'var(--bld-accent)', cursor: 'pointer', textAlign: 'left',
  fontFamily: 'monospace', fontSize: 10, padding: '3px 6px',
  borderRadius: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

function WorkflowKvEditor({
  label,
  value,
  onChange,
  testIdPrefix,
}: {
  label: string;
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown>) => void;
  testIdPrefix: string;
}) {
  // Detect if the incoming value is a section-level formula: { __formula__: "..." }
  const initialFormula = (value && Object.keys(value).length === 1 && '__formula__' in value)
    ? String(value.__formula__)
    : null;

  const [pairs, setPairs] = React.useState<KvPair[]>(() => initialFormula ? [] : kvObjToArr(value));
  const [formulaTarget, setFormulaTarget] = React.useState<KvFormulaTarget | null>(null);
  // Section-level bind: entire value becomes a single formula expression
  const [sectionBound, setSectionBound] = React.useState(!!initialFormula);
  const [sectionFEOpen, setSectionFEOpen] = React.useState(false);
  const [sectionFormula, setSectionFormula] = React.useState<FormulaValue>(initialFormula);

  // Track the last value we sent to the parent so we can ignore echo-backs in the sync effect.
  const lastCommittedRef = React.useRef<string>(JSON.stringify(value ?? {}));

  React.useEffect(() => {
    const incoming = JSON.stringify(value ?? {});
    // Skip if this is just the parent echoing back what we committed
    if (incoming === lastCommittedRef.current) return;
    lastCommittedRef.current = incoming;
    const isFormula = value && Object.keys(value).length === 1 && '__formula__' in value;
    if (isFormula) {
      setSectionBound(true);
      setSectionFormula(String(value.__formula__));
      setPairs([]);
    } else {
      setSectionBound(false);
      setSectionFormula(null);
      setPairs(kvObjToArr(value));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value ?? {})]);

  function commit(updated: KvPair[]) {
    const obj = kvArrToObj(updated);
    lastCommittedRef.current = JSON.stringify(obj);
    setPairs(updated);
    onChange(obj);
  }

  function add() {
    const next = [...pairs, { id: `kv-new-${Date.now()}`, key: '', keyBound: false, value: '', valueBound: false }];
    setPairs(next);
  }

  function updatePair(id: string, patch: Partial<KvPair>) {
    const next = pairs.map(p => p.id === id ? { ...p, ...patch } : p);
    commit(next);
  }

  function removePair(id: string) {
    commit(pairs.filter(p => p.id !== id));
  }

  const openPair = formulaTarget ? pairs.find(p => p.id === formulaTarget.id) : null;
  const openField = formulaTarget?.field;
  const openValue = openPair ? (openField === 'key' ? openPair.key : openPair.value) : '';
  const openBound = openPair ? (openField === 'key' ? openPair.keyBound : openPair.valueBound) : false;

  const CELL_LABEL: React.CSSProperties = { fontSize: 9, color: 'var(--bld-text-disabled)', fontWeight: 500, marginBottom: 2 };

  return (
    <div style={{ marginTop: 10 }}>
      {/* Section header — label + bind icon + Add button (matching data tab SectionRow) */}
      {sectionBound ? (
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--bld-text-2)', display: 'block', marginBottom: 4 }}>{label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setSectionFEOpen(true)}
              style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)', borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500, textAlign: 'left' }}
            >ƒ Edit formula</button>
            <BindingIcon isBound onClick={() => setSectionFEOpen(true)} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--bld-text-2)' }}>{label}</span>
          <BindingIcon isBound={false} onClick={() => setSectionFEOpen(true)} />
          <span style={{ flex: 1 }} />
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-accent)', borderRadius: 6, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}
            onClick={add}
            data-testid={`${testIdPrefix}-add`}
          >+ Add</button>
        </div>
      )}

      {/* KV rows (hidden when section-level bound) */}
      {!sectionBound && pairs.map((pair) => (
        <div key={pair.id} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>

            {/* Key cell */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={CELL_LABEL}>Key</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {pair.keyBound ? (
                  <button style={FORMULA_BTN_STYLE} onClick={() => setFormulaTarget({ id: pair.id, field: 'key' })} title={pair.key}>ƒ Edit formula</button>
                ) : (
                  <input
                    style={{ ...S.fieldInput, flex: 1, padding: '3px 6px', fontSize: 10 }}
                    placeholder="key"
                    value={pair.key}
                    onChange={e => updatePair(pair.id, { key: e.target.value })}
                    data-testid={`${testIdPrefix}-key`}
                  />
                )}
                <BindingIcon isBound={pair.keyBound} onClick={() => setFormulaTarget({ id: pair.id, field: 'key' })} />
              </div>
            </div>

            {/* Value cell */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={CELL_LABEL}>Value</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {pair.valueBound ? (
                  <button style={FORMULA_BTN_STYLE} onClick={() => setFormulaTarget({ id: pair.id, field: 'value' })} title={pair.value}>ƒ Edit formula</button>
                ) : (
                  <input
                    style={{ ...S.fieldInput, flex: 1, padding: '3px 6px', fontSize: 10 }}
                    placeholder="value"
                    value={pair.value}
                    onChange={e => updatePair(pair.id, { value: e.target.value })}
                    data-testid={`${testIdPrefix}-val`}
                  />
                )}
                <BindingIcon isBound={pair.valueBound} onClick={() => setFormulaTarget({ id: pair.id, field: 'value' })} />
              </div>
            </div>

            {/* Remove */}
            <button
              style={{ background: 'transparent', border: 'none', color: 'var(--bld-error)', cursor: 'pointer', padding: '2px 4px', fontSize: 14, lineHeight: 1, marginBottom: 2 }}
              onClick={() => removePair(pair.id)}
              title="Remove"
            >×</button>
          </div>
        </div>
      ))}

      {/* Per-row formula editor */}
      {openPair && openField && (
        <FormulaEditor
          label={openField === 'key' ? `${label} key` : (openPair.key || label)}
          value={openBound ? ((() => { try { return JSON.parse(openValue) as FormulaValue; } catch { return openValue as FormulaValue; } })()) : null}
          onChange={v => {
            if (!v && v !== 0) {
              updatePair(openPair.id, openField === 'key' ? { key: '', keyBound: false } : { value: '', valueBound: false });
            } else {
              const str = storedValueToFormula(v);
              updatePair(openPair.id, openField === 'key' ? { key: str, keyBound: true } : { value: str, valueBound: true });
            }
            setFormulaTarget(null);
          }}
          onClose={() => setFormulaTarget(null)}
          anchorRight={292}
        />
      )}

      {/* Section-level formula editor */}
      {sectionFEOpen && (
        <FormulaEditor
          label={`${label} (formula)`}
          value={sectionFormula}
          onChange={(v) => {
            if (!v && v !== 0) {
              setSectionBound(false);
              setSectionFormula(null);
              onChange({});
            } else {
              setSectionBound(true);
              setSectionFormula(v);
              onChange({ __formula__: storedValueToFormula(v) });
            }
            setSectionFEOpen(false);
          }}
          onClose={() => setSectionFEOpen(false)}
          anchorRight={292}
        />
      )}
    </div>
  );
}

// ─── Shared: NodePickerDropdown ──────────────────────────────────────────────
// Searchable popover dropdown that lists all named canvas nodes.
// Matches the exact style of PagePickerDropdown / TypeSearchDropdown.
// If the configured value isn't in pageNodes (e.g. node lives on another screen)
// it is still shown in the trigger so the configured ID is never silently lost.

function NodePickerDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { pageNodes } = useBuilderStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const namedNodes = React.useMemo(() => {
    const results: { id: string; label: string }[] = [];
    function walk(nodes: unknown[]) {
      for (const n of nodes) {
        const node = n as Record<string, unknown>;
        if (node.id && typeof node.id === 'string' && node.id.length > 0) {
          const label = (node.name as string | undefined) || (node.type as string | undefined) || node.id as string;
          results.push({ id: node.id as string, label });
        }
        if (Array.isArray(node.children)) walk(node.children as unknown[]);
      }
    }
    walk(pageNodes);
    return results;
  }, [pageNodes]);

  const q = search.toLowerCase();
  const filtered = namedNodes.filter(n =>
    !q || n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q),
  );

  const selected = namedNodes.find(n => n.id === value);
  const triggerLabel = selected ? `${selected.label} (${value})` : value || 'Select a node…';

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="node-picker"]')) {
        setOpen(false);
        setSearch('');
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  return (
    <div ref={wrapperRef} data-popover="node-picker" style={{ position: 'relative', width: '100%' }}>
      <button
        style={{
          ...S.fieldSelect,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          textAlign: 'left',
          paddingRight: 28,
        }}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: value ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}>
          {triggerLabel}
        </span>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          fontSize: 10, color: 'var(--bld-text-disabled)', pointerEvents: 'none' }}>
          {open ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}
        </span>
      </button>

      {open && (
        <div style={{
          ...S.dropdown,
          position: 'absolute', top: '100%', left: 0, right: 0,
          zIndex: 300, minWidth: 'unset', width: '100%', maxHeight: 280,
        }}>
          <input
            ref={searchRef}
            style={S.dropdownSearch}
            placeholder="Search nodes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {filtered.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--bld-text-disabled)' }}>
              {namedNodes.length === 0 ? 'No named nodes on this page' : 'No matches'}
            </div>
          )}
          {filtered.map(n => (
            <button
              key={n.id}
              style={S.dropdownItem(n.id === value)}
              onMouseEnter={e => { if (n.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
              onMouseLeave={e => { if (n.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
              onClick={() => { onChange(n.id); setOpen(false); setSearch(''); }}
            >
              <span style={{ flex: 1 }}>{n.label}</span>
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>{n.id}</span>
              {n.id === value && <span style={{ color: 'var(--bld-accent)', fontSize: 10, marginLeft: 4 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ScrollToElementConfig ───────────────────────────────────────────────────

function ScrollToElementConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const elementId = (cfg.elementId ?? cfg.targetId ?? '') as string;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={S.fieldLabel}>Element ID</label>
      <input
        style={S.fieldInput}
        value={elementId}
        placeholder="Node id or data-section-id value"
        onChange={e => setCfg('elementId', e.target.value)}
      />
      <label style={S.fieldLabel}>Or pick from canvas</label>
      <NodePickerDropdown
        value={elementId}
        onChange={id => setCfg('elementId', id)}
      />
      <label style={S.fieldLabel}>Behavior</label>
      <select
        style={S.fieldSelect}
        value={(cfg.behavior as string) ?? 'smooth'}
        onChange={e => setCfg('behavior', e.target.value)}
      >
        <option value="smooth">Smooth</option>
        <option value="instant">Instant</option>
        <option value="auto">Auto</option>
      </select>
      <label style={S.fieldLabel}>Block alignment</label>
      <select
        style={S.fieldSelect}
        value={(cfg.block as string) ?? 'start'}
        onChange={e => setCfg('block', e.target.value)}
      >
        <option value="start">Start</option>
        <option value="center">Center</option>
        <option value="end">End</option>
        <option value="nearest">Nearest</option>
      </select>
    </div>
  );
}

// ─── AnimateStepConfig ────────────────────────────────────────────────────────

const ANIMATION_TYPES = [
  { value: 'fadeIn',    label: 'Fade in' },
  { value: 'fadeOut',   label: 'Fade out' },
  { value: 'slideUp',   label: 'Slide up' },
  { value: 'slideDown', label: 'Slide down' },
  { value: 'shake',     label: 'Shake' },
  { value: 'pulse',     label: 'Pulse' },
  { value: 'bounce',    label: 'Bounce' },
  { value: 'spin',      label: 'Spin' },
  { value: 'heartbeat', label: 'Heartbeat' },
];

function AnimateStepConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={S.fieldLabel}>Target node</label>
      <NodePickerDropdown
        value={(cfg.targetNodeId ?? '') as string}
        onChange={id => setCfg('targetNodeId', id)}
      />
      <label style={S.fieldLabel}>Animation</label>
      <select
        style={S.fieldSelect}
        value={(cfg.animation as string) ?? 'pulse'}
        onChange={e => setCfg('animation', e.target.value)}
      >
        {ANIMATION_TYPES.map(a => (
          <option key={a.value} value={a.value}>{a.label}</option>
        ))}
      </select>
      <label style={S.fieldLabel}>Duration (ms)</label>
      <input
        type="number"
        style={{ ...S.fieldInput, width: 100 }}
        value={(cfg.duration as number) ?? 400}
        min={50}
        max={5000}
        step={50}
        onChange={e => setCfg('duration', Number(e.target.value))}
      />
    </div>
  );
}

// ─── TriggerExitAnimationConfig ──────────────────────────────────────────────

function TriggerExitAnimationConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={S.fieldLabel}>Target node</label>
      <NodePickerDropdown
        value={(cfg.targetNodeId ?? '') as string}
        onChange={id => setCfg('targetNodeId', id)}
      />
      <p style={{ fontSize: 11, color: 'var(--bld-text-disabled)', margin: 0 }}>
        The node must have <code>animation.exit</code> configured. The step awaits the exit animation before continuing.
      </p>
    </div>
  );
}

// ─── StartLoopConfig ──────────────────────────────────────────────────────────

const LOOP_TYPES = [
  { value: 'pulse',        label: 'Pulse (scale)' },
  { value: 'breathe',      label: 'Breathe (gentle scale)' },
  { value: 'float',        label: 'Float (translateY)' },
  { value: 'flash',        label: 'Flash (opacity)' },
  { value: 'ripple',       label: 'Ripple (shadow ring)' },
  { value: 'glowPulse',    label: 'Glow pulse (shadow halo)' },
  { value: 'spin',         label: 'Spin (rotate)' },
  { value: 'ticker',       label: 'Ticker (rotate)' },
  { value: 'shake',        label: 'Shake (translateX seq)' },
  { value: 'bounce',       label: 'Bounce (translateY seq)' },
  { value: 'wiggle',       label: 'Wiggle (rotate seq)' },
  { value: 'swing',        label: 'Swing (rotate seq)' },
  { value: 'wobble',       label: 'Wobble (translateX seq)' },
  { value: 'heartbeat',    label: 'Heartbeat (scale seq)' },
  { value: 'gradientDrift',label: 'Gradient drift (bg position)' },
];

function StartLoopConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={S.fieldLabel}>Target node</label>
      <NodePickerDropdown
        value={(cfg.targetNodeId ?? '') as string}
        onChange={id => setCfg('targetNodeId', id)}
      />
      <label style={S.fieldLabel}>Loop type</label>
      <select
        style={S.fieldSelect}
        value={(cfg.loopType ?? 'pulse') as string}
        onChange={e => setCfg('loopType', e.target.value)}
      >
        {LOOP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <label style={S.fieldLabel}>Duration (ms per cycle)</label>
      <input
        type="number"
        style={{ ...S.fieldInput, width: 100 }}
        value={(cfg.duration ?? 1000) as number}
        min={100}
        max={10000}
        step={100}
        onChange={e => setCfg('duration', Number(e.target.value))}
      />
    </div>
  );
}

// ─── StopLoopConfig ───────────────────────────────────────────────────────────

function StopLoopConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={S.fieldLabel}>Target node</label>
      <NodePickerDropdown
        value={(cfg.targetNodeId ?? '') as string}
        onChange={id => setCfg('targetNodeId', id)}
      />
    </div>
  );
}

// ─── PlayEnterAnimationConfig ─────────────────────────────────────────────────

const ENTER_TYPES = [
  { value: 'fadeIn',          label: 'Fade in' },
  { value: 'slideInUp',       label: 'Slide in up' },
  { value: 'slideInDown',     label: 'Slide in down' },
  { value: 'slideInLeft',     label: 'Slide in left' },
  { value: 'slideInRight',    label: 'Slide in right' },
  { value: 'zoomIn',          label: 'Zoom in' },
  { value: 'bounceIn',        label: 'Bounce in' },
  { value: 'flipInX',         label: 'Flip in X' },
  { value: 'flipInY',         label: 'Flip in Y' },
  { value: 'flipIn3D',        label: 'Flip in 3D' },
  { value: 'rollIn',          label: 'Roll in' },
  { value: 'tiltIn',          label: 'Tilt in' },
  { value: 'dropIn',          label: 'Drop in' },
  { value: 'riseFade',        label: 'Rise fade' },
  { value: 'expandIn',        label: 'Expand in' },
  { value: 'blurIn',          label: 'Blur in' },
  { value: 'skewIn',          label: 'Skew in' },
];

function PlayEnterAnimationConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={S.fieldLabel}>Target node</label>
      <NodePickerDropdown
        value={(cfg.targetNodeId ?? '') as string}
        onChange={id => setCfg('targetNodeId', id)}
      />
      <label style={S.fieldLabel}>Enter type</label>
      <select
        style={S.fieldSelect}
        value={(cfg.enterType ?? 'fadeIn') as string}
        onChange={e => setCfg('enterType', e.target.value)}
      >
        {ENTER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <label style={S.fieldLabel}>Duration (ms)</label>
      <input
        type="number"
        style={{ ...S.fieldInput, width: 100 }}
        value={(cfg.duration ?? 400) as number}
        min={50}
        max={5000}
        step={50}
        onChange={e => setCfg('duration', Number(e.target.value))}
      />
    </div>
  );
}

// ─── PopoverStepConfig ────────────────────────────────────────────────────────

function PopoverStepConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={S.fieldLabel}>Node ID</label>
      <input
        style={S.fieldInput}
        value={(cfg.nodeId as string) ?? ''}
        placeholder="Target node ID (popover trigger)"
        onChange={e => setCfg('nodeId', e.target.value)}
      />
      <label style={S.fieldLabel}>Field</label>
      <select
        style={S.fieldInput}
        value={(cfg.field as string) ?? 'popover'}
        onChange={e => setCfg('field', e.target.value)}
      >
        <option value="popover">Popover</option>
      </select>
    </div>
  );
}

// ─── GraphQLStepConfig ────────────────────────────────────────────────────────

function GraphQLStepConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [endpointOpen, setEndpointOpen] = React.useState(false);
  const endpointBound = isBoundValue(cfg.endpoint as FormulaValue | undefined);

  return (
    <>
      {/* Endpoint */}
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Url *</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {endpointBound ? (
          <button
            style={{ flex: 1, ...S.fieldInput, background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)', color: 'var(--bld-accent)', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: 10, padding: '4px 7px' }}
            onClick={() => setEndpointOpen(true)}
            title={String(cfg.endpoint ?? '')}
          >ƒ formula</button>
        ) : (
          <input
            style={{ ...S.fieldInput, flex: 1 }}
            placeholder="https://api.example.com/graphql"
            value={(cfg.endpoint as string) ?? ''}
            onChange={e => setCfg('endpoint', e.target.value || undefined)}
          />
        )}
        <BindingIcon isBound={endpointBound} onClick={() => setEndpointOpen(true)} />
      </div>
      {endpointOpen && (
        <FormulaEditor
          label="endpoint"
          value={(cfg.endpoint as FormulaValue) ?? null}
          onChange={v => { setCfg('endpoint', v); setEndpointOpen(false); }}
          onClose={() => setEndpointOpen(false)}
          anchorRight={292}
        />
      )}

      {/* Query */}
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Query *</label>
      <GqlEditor
        value={(cfg.query as string) ?? ''}
        onChange={v => setCfg('query', v || undefined)}
        placeholder={'query {\n  viewer {\n    id\n  }\n}'}
      />

      {/* Variables */}
      <WorkflowKvEditor
        label="Variables"
        value={cfg.variables as Record<string, unknown> | undefined}
        onChange={v => setCfg('variables', Object.keys(v).length ? v : undefined)}
        testIdPrefix="gql-vars"
      />

      {/* Headers */}
      <WorkflowKvEditor
        label="Headers"
        value={cfg.headers as Record<string, unknown> | undefined}
        onChange={v => setCfg('headers', Object.keys(v).length ? v : undefined)}
        testIdPrefix="gql-headers"
      />

      {/* Toggles */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--bld-text-2)' }}>Send credentials</span>
          <button
            style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
              background: cfg.credentials ? 'var(--bld-accent)' : 'var(--bld-border-subtle)', transition: 'background 0.2s',
            }}
            onClick={() => setCfg('credentials', !cfg.credentials)}
          >
            <span style={{
              position: 'absolute', top: 2, left: cfg.credentials ? 18 : 2, width: 16, height: 16,
              borderRadius: '50%', background: 'var(--bld-accent-fg)', transition: 'left 0.2s',
            }} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--bld-text-2)' }}>Proxy request server side</span>
          <button
            style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
              background: cfg.useProxy ? 'var(--bld-accent)' : 'var(--bld-border-subtle)', transition: 'background 0.2s',
            }}
            onClick={() => setCfg('useProxy', !cfg.useProxy)}
          >
            <span style={{
              position: 'absolute', top: 2, left: cfg.useProxy ? 18 : 2, width: 16, height: 16,
              borderRadius: '50%', background: 'var(--bld-accent-fg)', transition: 'left 0.2s',
            }} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--bld-text-2)' }}>Return data only</span>
          <button
            style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
              background: cfg.returnDataOnly !== false ? 'var(--bld-accent)' : 'var(--bld-border-subtle)', transition: 'background 0.2s',
            }}
            onClick={() => setCfg('returnDataOnly', cfg.returnDataOnly === false ? true : false)}
          >
            <span style={{
              position: 'absolute', top: 2, left: cfg.returnDataOnly !== false ? 18 : 2, width: 16, height: 16,
              borderRadius: '50%', background: 'var(--bld-accent-fg)', transition: 'left 0.2s',
            }} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── FetchDataStepConfig (REST API) ──────────────────────────────────────────

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function PillToggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
      <span style={{ fontSize: 11, color: 'var(--bld-text-2)' }}>{label}</span>
      <button
        style={{
          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
          background: value ? 'var(--bld-accent)' : 'var(--bld-border-subtle)', transition: 'background 0.2s', flexShrink: 0,
        }}
        onClick={() => onChange(!value)}
      >
        <span style={{
          position: 'absolute', top: 2, left: value ? 18 : 2, width: 16, height: 16,
          borderRadius: '50%', background: 'var(--bld-accent-fg)', transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}

const CONTENT_TYPES = [
  { value: '', label: 'Default (application/json)' },
  { value: 'application/x-www-form-urlencoded', label: 'Form URL-encoded' },
  { value: 'multipart/form-data', label: 'Multipart/Form-data' },
  { value: 'text/plain', label: 'Text' },
  { value: 'application/xml', label: 'XML' },
];

function FetchDataStepConfig({
  cfg,
  setCfg,
  workflowTrigger,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
  workflowTrigger?: string;
}) {
  const [bodyTab, setBodyTab] = React.useState<'parsed' | 'raw'>((cfg.bodyMode as 'parsed' | 'raw') ?? 'parsed');
  const isGet = ((cfg.method as string) ?? 'POST').toUpperCase() === 'GET';

  const switchTab = (tab: 'parsed' | 'raw') => {
    setBodyTab(tab);
    setCfg('bodyMode', tab);
  };

  return (
    <>
      {/* Method */}
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Method *</label>
      <OptionPickerDropdown
        value={(cfg.method as string) ?? 'POST'}
        onChange={v => setCfg('method', v)}
        options={HTTP_METHODS.map(m => ({ value: m, label: m }))}
      />

      {/* URL */}
      <BoundField
        label="URL"
        required
        value={cfg.url as FormulaValue | undefined}
        onChange={v => setCfg('url', v)}
        placeholder="https://api-url.com/endpoint"
        workflowTrigger={workflowTrigger}
      />

      {/* Parsed fields / Raw body tabs — only for non-GET methods */}
      {!isGet && (
        <>
          <div style={{ ...S.toggleGroup, marginTop: 14 }}>
            <button style={S.toggleBtn(bodyTab === 'parsed')} onClick={() => switchTab('parsed')}>Parsed fields</button>
            <button style={S.toggleBtn(bodyTab === 'raw')} onClick={() => switchTab('raw')}>Raw body</button>
          </div>

          {bodyTab === 'parsed' ? (
            <>
              <WorkflowKvEditor
                label="Fields"
                value={cfg.fields as Record<string, unknown> | undefined}
                onChange={v => setCfg('fields', Object.keys(v).length ? v : undefined)}
                testIdPrefix="rest-fields"
              />
              <WorkflowKvEditor
                label="Headers"
                value={cfg.headers as Record<string, unknown> | undefined}
                onChange={v => setCfg('headers', Object.keys(v).length ? v : undefined)}
                testIdPrefix="rest-headers"
              />
              <WorkflowKvEditor
                label="Query string"
                value={cfg.query as Record<string, unknown> | undefined}
                onChange={v => setCfg('query', Object.keys(v).length ? v : undefined)}
                testIdPrefix="rest-query"
              />
              <label style={{ ...S.fieldLabel, marginTop: 10 }}>Content type</label>
              <OptionPickerDropdown
                value={(cfg.contentType as string) ?? ''}
                onChange={v => setCfg('contentType', v)}
                options={CONTENT_TYPES}
                placeholder="Default (application/json)"
              />
            </>
          ) : (
            <>
              <BoundField
                label="Body"
                value={cfg.body as FormulaValue | undefined}
                onChange={v => setCfg('body', v)}
                placeholder=""
                workflowTrigger={workflowTrigger}
              />
              <WorkflowKvEditor
                label="Headers"
                value={cfg.headers as Record<string, unknown> | undefined}
                onChange={v => setCfg('headers', Object.keys(v).length ? v : undefined)}
                testIdPrefix="rest-headers"
              />
              <WorkflowKvEditor
                label="Query string"
                value={cfg.query as Record<string, unknown> | undefined}
                onChange={v => setCfg('query', Object.keys(v).length ? v : undefined)}
                testIdPrefix="rest-query"
              />
              <label style={{ ...S.fieldLabel, marginTop: 10 }}>Content type</label>
              <OptionPickerDropdown
                value={(cfg.contentType as string) ?? ''}
                onChange={v => setCfg('contentType', v)}
                options={CONTENT_TYPES}
                placeholder="Default (application/json)"
              />
            </>
          )}
        </>
      )}

      {/* For GET: still show Headers and Query string */}
      {isGet && (
        <>
          <WorkflowKvEditor
            label="Headers"
            value={cfg.headers as Record<string, unknown> | undefined}
            onChange={v => setCfg('headers', Object.keys(v).length ? v : undefined)}
            testIdPrefix="rest-headers"
          />
          <WorkflowKvEditor
            label="Query string"
            value={cfg.query as Record<string, unknown> | undefined}
            onChange={v => setCfg('query', Object.keys(v).length ? v : undefined)}
            testIdPrefix="rest-query"
          />
        </>
      )}

      {/* Proxy server side */}
      <BoundToggleField
        label="Proxy request server side (bypass CORS)"
        value={cfg.proxy as FormulaValue | undefined}
        onChange={v => setCfg('proxy', v)}
        workflowTrigger={workflowTrigger}
      />

      {/* Send credentials */}
      <PillToggle
        label="Send credentials"
        value={!!(cfg.credentials)}
        onChange={v => setCfg('credentials', v)}
      />

      {/* Stream response */}
      <PillToggle
        label="Stream response"
        value={!!(cfg.stream)}
        onChange={v => setCfg('stream', v)}
      />
    </>
  );
}

// ─── EmitComponentTriggerConfig ──────────────────────────────────────────────
// Configures an `emitComponentTrigger` step. The only knob is the trigger id:
// the payload template is authored on the trigger declaration itself (Component
// Editor → Triggers → Payload). At emit time the engine resolves the trigger on
// the ambient model, evaluates its `payload` (literal or formula) against the
// current workflow scope, and delivers the result to every matching listener
// as `context.event`. Keeping the payload in one place prevents it drifting
// from the declared shape and keeps emit sites boilerplate-free.

function EmitComponentTriggerConfig({
  cfg,
  onUpdate,
  componentTriggers,
}: {
  cfg: Record<string, unknown>;
  onUpdate: (patch: Record<string, unknown>) => void;
  workflowTrigger?: string;
  componentTriggers: Array<{ id: string; name: string }>;
}) {
  const triggerId = (cfg.triggerId as string | undefined) ?? '';
  const selected = componentTriggers.find(t => t.id === triggerId);

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Trigger *</label>
      {componentTriggers.length === 0 ? (
        <div style={S.infoBox}>
          No triggers defined. Declare a trigger in the Component Editor
          (Triggers section) to expose it here.
        </div>
      ) : (
        <OptionPickerDropdown
          value={triggerId}
          onChange={v => onUpdate({ ...cfg, triggerId: v })}
          options={[
            { value: '', label: 'Select a trigger…' },
            ...componentTriggers.map(t => ({ value: t.id, label: t.name })),
          ]}
        />
      )}

      {selected && (
        <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 6 }}>
          Fires <span style={{ color: 'var(--bld-accent)', fontWeight: 600 }}>{selected.name}</span>.
          The payload is defined on the trigger declaration and delivered to listeners as
          <code style={{ background: 'var(--bld-bg-input)', padding: '1px 4px', borderRadius: 3, margin: '0 3px' }}>context.event</code>.
        </div>
      )}
    </>
  );
}

// ─── ExecuteComponentActionConfig ────────────────────────────────────────────
// Searchable dropdown listing workflows from every shared-component model,
// grouped by component. Selecting a row writes BOTH {workflowId, modelId} so
// the runtime handler can resolve the workflow without relying on the ambient
// component scope. Also exposes an optional Instance ID input so a page-level
// workflow can target a specific SC instance on the page.
//
// Backwards-compat: reads selection from cfg.workflowId first, falling back to
// cfg.action. If only a workflow name is stored (no modelId), the picker tries
// to infer the model by matching the name across all shared components — when
// the match is unique we pre-select that row; otherwise the picker stays
// unbound until the user picks explicitly.

function ExecuteComponentActionConfig({
  cfg,
  onUpdate,
  workflowTrigger,
}: {
  cfg: Record<string, unknown>;
  onUpdate: (patch: Record<string, unknown>) => void;
  workflowTrigger?: string;
}) {
  // Subscribe to shared-component store so the dropdown refreshes when workflows
  // are added/removed/renamed while the right panel is open.
  const [, forceTick] = useState(0);
  useEffect(() => subscribeSharedComponents(() => forceTick(n => n + 1)), []);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  type Row = {
    key: string;         // `${modelId}::${workflowId}`
    modelId: string;
    modelName: string;
    workflowId: string;  // the workflow key within model.workflows (also its runtime name)
    workflowName: string;
    trigger?: string;
    paramCount: number;
  };

  // Flatten every shared component's workflows into a single list of rows.
  const models = getSharedComponentList();
  const rows: Row[] = [];
  for (const m of models) {
    const wfs = (m.workflows ?? {}) as Record<string, { name?: string; trigger?: string; params?: unknown[] }>;
    for (const [wid, w] of Object.entries(wfs)) {
      rows.push({
        key: `${m.id}::${wid}`,
        modelId: m.id,
        modelName: m.name ?? m.id,
        workflowId: wid,
        workflowName: w?.name ?? wid,
        trigger: w?.trigger,
        paramCount: Array.isArray(w?.params) ? w!.params!.length : 0,
      });
    }
  }
  rows.sort((a, b) => (a.modelName + a.workflowName).localeCompare(b.modelName + b.workflowName));

  // Resolve the currently-bound selection. Prefer explicit modelId; otherwise
  // try to unique-match the workflow name across all shared components.
  const storedWorkflowId = (cfg.workflowId as string | undefined) ?? (cfg.action as string | undefined) ?? '';
  const storedModelId = (cfg.modelId as string | undefined) ?? '';
  let selected: Row | undefined;
  if (storedWorkflowId) {
    if (storedModelId) {
      selected = rows.find(r => r.modelId === storedModelId && r.workflowId === storedWorkflowId);
    } else {
      const matches = rows.filter(r => r.workflowId === storedWorkflowId);
      if (matches.length === 1) selected = matches[0];
    }
  }

  const q = search.toLowerCase();
  const filtered = q
    ? rows.filter(r => (`${r.modelName} ${r.workflowName}`).toLowerCase().includes(q))
    : rows;

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="component-action-picker"]')) {
        setOpen(false);
        setSearch('');
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  // Write {workflowId, modelId} on select. Keeps legacy `action` field in
  // sync for older readers but the new canonical field is `workflowId`.
  const selectRow = (r: Row) => {
    const next: Record<string, unknown> = {
      ...cfg,
      workflowId: r.workflowId,
      modelId: r.modelId,
      action: r.workflowId,
    };
    onUpdate(next);
    setOpen(false);
    setSearch('');
  };

  // Group filtered rows by model for the dropdown UI.
  const byModel = new Map<string, { modelName: string; items: Row[] }>();
  for (const r of filtered) {
    if (!byModel.has(r.modelId)) byModel.set(r.modelId, { modelName: r.modelName, items: [] });
    byModel.get(r.modelId)!.items.push(r);
  }

  const displayLabel = selected
    ? `${selected.modelName} › ${selected.workflowName}`
    : (storedWorkflowId
        ? `${storedWorkflowId}  (not found — pick again)`
        : 'Choose a component workflow…');

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Component workflow *</label>
      <div ref={wrapperRef} data-popover="component-action-picker" style={{ position: 'relative', width: '100%' }}>
        <button
          style={{ ...S.fieldSelect, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textAlign: 'left', paddingRight: 28 }}
          onClick={() => { setOpen(v => !v); setSearch(''); }}
        >
          <span style={{ fontSize: 12, flexShrink: 0 }}>⚡</span>
          <span style={{
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: selected ? 'var(--bld-text-1)' : (storedWorkflowId ? 'var(--bld-warning)' : 'var(--bld-text-disabled)'),
          }}>
            {displayLabel}
          </span>
          {selected && selected.paramCount > 0 && (
            <span style={{ fontSize: 9, background: 'rgba(34,197,94,0.15)', color: 'var(--bld-success)', borderRadius: 3, padding: '1px 5px', fontWeight: 600, flexShrink: 0 }}>
              {selected.paramCount} param{selected.paramCount !== 1 ? 's' : ''}
            </span>
          )}
          <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--bld-text-disabled)', pointerEvents: 'none' }}>
            {open ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}
          </span>
        </button>

        {open && (
          <div style={{ ...S.dropdown, position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, minWidth: 'unset', width: '100%', maxHeight: 320 }}>
            <input
              ref={searchRef}
              style={S.dropdownSearch}
              placeholder="Search component workflows…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {filtered.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--bld-text-disabled)' }}>
                {rows.length === 0 ? 'No shared-component workflows defined' : 'No results'}
              </div>
            )}
            {Array.from(byModel.entries()).map(([modelId, { modelName, items }]) => (
              <div key={modelId}>
                <div style={{ padding: '4px 12px 2px', fontSize: 9, fontWeight: 700, color: 'var(--bld-text-disabled)', textTransform: 'none' }}>
                  {modelName}
                </div>
                {items.map(r => {
                  const isActive = selected?.key === r.key;
                  return (
                    <button
                      key={r.key}
                      style={{ ...S.dropdownItem(isActive), flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}
                      onMouseEnter={ev => { if (!isActive) (ev.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
                      onMouseLeave={ev => { if (!isActive) (ev.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
                      onClick={() => selectRow(r)}
                    >
                      <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                        {r.workflowName}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>
                        {r.trigger ?? 'execution'}{r.paramCount ? ` · ${r.paramCount} param${r.paramCount !== 1 ? 's' : ''}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <label style={{ ...S.fieldLabel, marginTop: 10 }}>
        Instance ID <span style={{ color: 'var(--bld-text-disabled)', fontWeight: 400 }}>(optional — target a specific instance)</span>
      </label>
      <input
        style={S.fieldInput}
        placeholder="e.g. wftest-sc-inst-1"
        value={(cfg.instanceId as string) ?? (cfg.componentId as string) ?? ''}
        onChange={e => {
          const v = e.target.value || undefined;
          onUpdate({ ...cfg, instanceId: v, componentId: v });
        }}
      />

      {/* Declared-parameter inputs — shown when the selected SC workflow has a
          non-empty `params` array. Values are stored under cfg.args and passed
          to the workflow as `parameters` at runtime. */}
      {(() => {
        if (!selected) return null;
        const model = models.find(m => m.id === selected.modelId) as SharedComponentModel | undefined;
        const declared = (model?.workflows?.[selected.workflowId]?.params ?? []) as WorkflowParam[];
        if (!declared.length) return null;
        const savedArgs = (cfg.args as Record<string, unknown>) ?? {};
        return (
          <div style={{ marginTop: 14, borderTop: 'none', paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-3)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 12 }}>Φ</span> Arguments
            </div>
            {declared.map(p => (
              <ParamBoundField
                key={p.id}
                param={p}
                value={savedArgs[p.name] as FormulaValue | undefined}
                onChange={v => {
                  const next = { ...savedArgs, [p.name]: v };
                  onUpdate({ ...cfg, args: next });
                }}
                workflowTrigger={workflowTrigger}
              />
            ))}
          </div>
        );
      })()}
    </>
  );
}

const TYPE_COLOR: Record<string, string> = {
  string: 'var(--bld-warning)',
  number: 'var(--bld-info)',
  boolean: 'var(--bld-success)',
  object: 'var(--bld-accent)',
  array: 'var(--bld-warning)',
  form: 'var(--bld-badge-boolean)',
};

// ─── ResetVariableValueConfig ────────────────────────────────────────────────
// List of variable pickers — user can add / remove rows.
// Each row has a searchable variable dropdown. Starts with one empty row.

type ResetRow = { varId: string; search: string; open: boolean };

function initRows(cfg: Record<string, unknown>): ResetRow[] {
  const ids: string[] = Array.isArray(cfg.variableNames)
    ? (cfg.variableNames as string[])
    : cfg.variableName ? [(cfg.variableName as string)] : [];
  // Always at least one empty row
  const source = ids.length > 0 ? ids : [''];
  return source.map(varId => ({ varId, search: '', open: false }));
}

function ResetVariableValueConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const { customVars, pageNodes } = useBuilderStore();
  const [rows, setRows] = React.useState<ResetRow[]>(() => initRows(cfg));

  const { standalones, formContainers } = React.useMemo(
    () => collectPageComponents(pageNodes, false),
    [pageNodes],
  );
  const pageVars = React.useMemo(() => {
    const entries: Array<{ id: string; label: string; type: string }> = [];
    for (const { node, insideForm } of standalones) {
      const nodeId = (node as { id?: string }).id;
      if (!nodeId) continue;
      const name = ((node as { name?: string }).name || node.type).trim() || 'Input';
      entries.push({ id: `${nodeId}-value`, label: insideForm ? `Form - ${name}` : name, type: 'string' });
    }
    for (const { node } of formContainers) {
      const nodeId = (node as { id?: string }).id;
      if (!nodeId) continue;
      const name = ((node as { name?: string }).name || 'Form').trim();
      entries.push({ id: `${nodeId}-form`, label: `Form Container - ${name}`, type: 'object' });
    }
    return entries;
  }, [standalones, formContainers]);

  const allVars = React.useMemo(() => {
    const pageVarIds = new Set(pageVars.map(v => v.id));
    return [...pageVars, ...customVars.filter(v => !pageVarIds.has(v.id ?? (v as { name?: string }).name ?? ''))];
  }, [pageVars, customVars]);

  // Commit rows → cfg whenever rows change
  const commitRows = React.useCallback((next: ResetRow[]) => {
    const ids = next.map(r => r.varId);
    setCfg('variableNames', ids);
    setCfg('variableName', ids[0] ?? undefined);
  }, [setCfg]);

  function addRow() {
    const next = [...rows, { varId: '', search: '', open: false }];
    setRows(next);
    commitRows(next);
  }

  function removeRow(idx: number) {
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    commitRows(next);
  }

  function setRowOpen(idx: number, val: boolean) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, open: val, search: val ? r.search : '' } : r));
  }

  function setRowSearch(idx: number, val: string) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, search: val } : r));
  }

  function setRowVar(idx: number, varId: string) {
    const next = rows.map((r, i) => i === idx ? { ...r, varId, open: false, search: '' } : r);
    setRows(next);
    commitRows(next);
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <span style={{ ...S.fieldLabel, marginTop: 0 }}>Variables</span>
        <button
          style={{ fontSize: 11, color: 'var(--bld-accent)', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); addRow(); }}
        >+ Add</button>
      </div>

      {rows.map((row, idx) => {
        const selected = allVars.find(v => (v.id ?? (v as { name?: string }).name) === row.varId);
        const filtered = allVars.filter(v => {
          if (!row.search) return true;
          const lbl = (('label' in v ? v.label : undefined) ?? ('name' in v ? (v as { name?: string }).name : undefined) ?? '').toLowerCase();
          return lbl.includes(row.search.toLowerCase());
        });

        return (
          <div key={idx} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <button
                onClick={e => { e.stopPropagation(); setRowOpen(idx, !row.open); }}
                style={{ ...S.fieldInput, width: '100%', textAlign: 'left', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
              >
                {selected ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 9, color: TYPE_COLOR[selected.type] ?? 'var(--bld-text-3)', fontFamily: 'monospace',
                      background: 'rgba(255,255,255,0.07)', border: `1px solid ${TYPE_COLOR[selected.type] ?? 'var(--bld-border-subtle)'}`,
                      borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>{selected.type}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {('label' in selected ? selected.label : undefined) ?? ('name' in selected ? (selected as { name?: string }).name : undefined)}
                    </span>
                  </span>
                ) : (
                  <span style={{ color: 'var(--bld-text-disabled)' }}>Choose a variable</span>
                )}
                <span style={{ color: 'var(--bld-text-disabled)', fontSize: 10, flexShrink: 0 }}>{row.open ? (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transform:"rotate(180deg)"}}><polyline points="6 9 12 15 18 9"/></svg>) : (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>)}</span>
              </button>

              {row.open && (
                <div
                  data-popover
                  onClick={e => e.stopPropagation()}
                  style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                    background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6,
                    marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    maxHeight: 200, display: 'flex', flexDirection: 'column' }}
                >
                  <div style={{ padding: '6px 8px', borderBottom: 'none' }}>
                    <input
                      autoFocus
                      value={row.search}
                      onChange={e => setRowSearch(idx, e.target.value)}
                      placeholder="Search variables…"
                      style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bld-bg-input)',
                        border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-2)',
                        fontSize: 11, padding: '3px 7px', outline: 'none' }}
                    />
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {filtered.length === 0 && (
                      <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--bld-text-disabled)' }}>No variables found</div>
                    )}
                    {filtered.map(v => {
                      const key = v.id ?? (v as { name?: string }).name;
                      const isActive = key === row.varId;
                      return (
                        <button
                          key={key}
                          onClick={e => { e.stopPropagation(); setRowVar(idx, key ?? ''); }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                            background: isActive ? 'var(--bld-bg-elevated)' : 'none', border: 'none', cursor: 'pointer',
                            color: isActive ? 'var(--bld-accent)' : 'var(--bld-text-2)', fontSize: 11, textAlign: 'left' }}
                        >
                          <span style={{ fontSize: 9, color: TYPE_COLOR[v.type] ?? 'var(--bld-text-3)', fontFamily: 'monospace',
                            background: 'rgba(255,255,255,0.07)', border: `1px solid ${TYPE_COLOR[v.type] ?? 'var(--bld-border-subtle)'}`,
                            borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>{v.type}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {('label' in v ? v.label : undefined) ?? ('name' in v ? (v as { name?: string }).name : undefined)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <button
              style={{ background: 'none', border: 'none', color: 'var(--bld-error)', cursor: 'pointer', fontSize: 18, flexShrink: 0, lineHeight: 1 }}
              onClick={e => { e.stopPropagation(); removeRow(idx); }}
            >−</button>
          </div>
        );
      })}
    </>
  );
}

// ─── PickFileConfig ──────────────────────────────────────────────────────────
// Step config for `pickFile`: opens the OS file picker and writes selected files
// into a target variable. Must run inside a click-triggered workflow (browser
// gesture requirement). The step writes an array of `{ name, size, type, lastModified, file }`
// — same shape FileList produces — so downstream formulas can read primitive fields
// directly (e.g. `<storeIn>[0]?.name`).

function PickFileConfig({
  cfg,
  setCfg,
  workflowTrigger,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
  workflowTrigger?: string;
}) {
  const { customVars } = useBuilderStore();
  const storeIn = (cfg.storeIn as string | undefined) ?? '';

  return (
    <>
      <BoundField
        label="Accept"
        value={cfg.accept as FormulaValue | undefined}
        onChange={v => setCfg('accept', v)}
        placeholder='e.g. "image/*" or ".pdf,.csv"'
        workflowTrigger={workflowTrigger}
      />
      <BoundField
        label="Multiple"
        value={cfg.multiple as FormulaValue | undefined}
        onChange={v => setCfg('multiple', v)}
        placeholder="false"
        workflowTrigger={workflowTrigger}
        expectedType="boolean"
      />
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Store files in *</label>
      <select
        style={S.fieldSelect}
        value={storeIn}
        onChange={e => setCfg('storeIn', e.target.value || undefined)}
      >
        <option value="">Choose a variable…</option>
        {customVars.map(v => (
          <option key={v.id ?? v.name} value={(v.id ?? v.name) as string}>
            {(v.label ?? v.name) as string}
          </option>
        ))}
      </select>
      <div style={{ ...S.infoBox, marginTop: 8 }}>
        Opens the OS file picker. Must be invoked from a user click (browser gesture
        requirement). The selected files are written to the chosen variable as an
        array of {`{ name, size, type, lastModified, file }`}.
      </div>
    </>
  );
}

// ─── ChangeVariableValueConfig ───────────────────────────────────────────────

const ARRAY_OPS = [
  { value: 'replace', label: 'Replace all items' },
  { value: 'updateOne', label: 'Update one item' },
  { value: 'insertEnd', label: 'Insert at end' },
  { value: 'insertStart', label: 'Insert at start' },
  { value: 'insertAt', label: 'Insert at index' },
  { value: 'removeAt', label: 'Remove at index' },
  { value: 'removeFirst', label: 'Remove first' },
  { value: 'removeLast', label: 'Remove last' },
];

/**
 * Bind button (LEFT) + On/Off toggle — for boolean fields that can also be formula-bound.
 * When formula-bound shows the "ƒ Edit formula" chip instead of the toggle.
 */
export function BoundToggleField({
  label,
  value,
  onChange,
  workflowTrigger,
}: {
  label: string;
  value: FormulaValue | undefined;
  onChange: (v: FormulaValue | undefined) => void;
  workflowTrigger?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const isBound = isBoundValue(value);
  const boolVal = !isBound && (value === true || value === 'true');

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <BindingIcon isBound={isBound} onClick={() => setOpen(v => !v)} />
        {isBound ? (
          <button
            onClick={() => setOpen(v => !v)}
            style={{ flex: 1, padding: '5px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
              borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              textAlign: 'left' }}
          >ƒ Edit formula</button>
        ) : (
          <div style={{ flex: 1, display: 'flex', background: 'var(--bld-bg-input)', borderRadius: 4, padding: 2, gap: 2 }}>
            <button
              style={{ flex: 1, padding: '4px 0', fontSize: 11, border: 'none', cursor: 'pointer', borderRadius: 3, fontWeight: 500,
                background: boolVal ? 'var(--bld-border-subtle)' : 'transparent', color: boolVal ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}
              onClick={() => onChange(true)}
            >On</button>
            <button
              style={{ flex: 1, padding: '4px 0', fontSize: 11, border: 'none', cursor: 'pointer', borderRadius: 3, fontWeight: 500,
                background: !boolVal ? 'var(--bld-border-subtle)' : 'transparent', color: !boolVal ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}
              onClick={() => onChange(false)}
            >Off</button>
          </div>
        )}
      </div>
      {open && (
        <FormulaEditor
          label={label}
          value={value ?? null}
          onChange={v => { onChange(v ?? undefined); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRight={292}
          expectedType="boolean"
          workflowTrigger={workflowTrigger}
        />
      )}
    </>
  );
}

/** Segmented On/Off toggle — matches the Debounce/Autocomplete style in the design panel. */
function OnOffToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const btn = (active: boolean): React.CSSProperties => ({
    padding: '2px 10px', fontSize: 10, border: 'none', cursor: 'pointer', borderRadius: 3, fontWeight: 500,
    background: active ? 'var(--bld-border-subtle)' : 'transparent',
    color: active ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)',
  });
  return (
    <div style={{ display: 'flex', background: 'var(--bld-bg-input)', borderRadius: 4, padding: 2, gap: 2 }}>
      <button style={btn(value)} onClick={() => onChange(true)}>On</button>
      <button style={btn(!value)} onClick={() => onChange(false)}>Off</button>
    </div>
  );
}

/** Bind button on the LEFT of a field, then the input on the right. */
export function BoundField({
  label,
  required,
  value,
  onChange,
  placeholder,
  multiline,
  code,
  numeric,
  workflowTrigger,
  expectedType,
  anchorRight,
  serverContext,
  formulaParams,
  paramsInQuick,
}: {
  label: string;
  required?: boolean;
  value: FormulaValue | undefined;
  onChange: (v: FormulaValue | undefined) => void;
  placeholder?: string;
  multiline?: boolean;
  /** Show a monospace code editor textarea (for JSON objects / arrays) */
  code?: boolean;
  numeric?: boolean;
  workflowTrigger?: string;
  expectedType?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';
  /**
   * Pixels the FormulaEditor's right edge sits from the viewport right edge.
   * Defaults to 292 (the workflow canvas's right-config-panel width). Override
   * to 260 when mounting inside the standard right panel so the editor sits
   * flush against its left edge instead of leaving a visible gap.
   */
  anchorRight?: number;
  /** When true, only the Workflow tab is shown in the FormulaEditor (server workflow context). */
  serverContext?: boolean;
  /** Declared workflow/formula parameters — surfaced in the formula editor's Parameters section. */
  formulaParams?: GlobalFormulaParam[];
  /** When true, params appear in the Quick tab (not the Workflow tab). */
  paramsInQuick?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  // Must be called unconditionally — used by CodeMirror when code=true
  const handleCodeChange = useCallback((val: string) => onChange(val || undefined), [onChange]);

  // Merge explicit props with context values (server workflow params + isServerContext flag).
  const ctx = useContext(WorkflowParamsCtx);
  const effectiveServerContext = serverContext ?? ctx.isServerContext;
  const effectiveParams = (formulaParams?.length ? formulaParams : ctx.params.length ? ctx.params : undefined);
  const effectiveParamsInQuick = paramsInQuick ?? (effectiveParams && effectiveParams.length > 0 ? true : undefined);

  // Auto-migrate legacy $input.xxx plain strings to formula objects.
  // This is necessary for seeded/old workflows that stored bare "$input.password" etc.
  const migratedValue = React.useMemo<FormulaValue | undefined>(() => {
    if (typeof value === 'string') {
      const m = value.match(/^\$input\.(\w+)$/);
      if (m) return { formula: `parameters?.['${m[1]}']` };
    }
    return value;
  }, [value]);
  // Persist the migration back to the config so it gets saved on next canvas save.
  useEffect(() => {
    if (migratedValue !== value) onChange(migratedValue);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Only formula objects (e.g. { formula: "..." }) are truly "bound" — plain text strings are not.
  // Using any non-empty string as isBound=true was making the icon appear active for plain text values.
  const isBound = isBoundValue(migratedValue);
  // strVal is the plain-text string shown in the textarea/input — only populated when not a formula object
  const strVal = !isBoundValue(migratedValue) ? (migratedValue as string) ?? '' : '';
  const isMultiline = multiline || code;

  // Save the value at the moment the formula editor opens.
  // When the user clicks "Unbind" (which fires onChange('')), we restore this saved value
  // if the original was plain text — preventing accidental loss of plain-text values.
  const preEditValueRef = useRef<FormulaValue | undefined>(migratedValue);
  const handleOpenEditor = useCallback(() => {
    preEditValueRef.current = migratedValue;
    setOpen(v => !v);
  }, [migratedValue]);

  const handleFormulaChange = useCallback((v: FormulaValue | null) => {
    // Unbind fires onChange('') — if the original value was plain text (not a formula object),
    // restore it instead of clearing, so the user doesn't lose their text by clicking Unbind.
    if ((v === '' || v == null) && typeof preEditValueRef.current === 'string' && !isBoundValue(preEditValueRef.current)) {
      onChange(preEditValueRef.current || undefined);
    } else {
      onChange(v ?? undefined);
    }
    setOpen(false);
  }, [onChange]);

  return (
    <>
      {label && <label style={{ ...S.fieldLabel, marginTop: 10 }}>{label}{required ? ' *' : ''}</label>}
      <div style={{ display: 'flex', alignItems: isMultiline ? 'flex-start' : 'center', gap: 6 }}>
        <BindingIcon isBound={isBound} onClick={handleOpenEditor} />
        {isBoundValue(migratedValue) ? (
          <button
            type="button"
            onClick={handleOpenEditor}
            style={{ flex: 1, padding: '5px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
              borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              textAlign: 'left' }}
          >ƒ Edit formula</button>
        ) : code ? (
          <div style={{ flex: 1, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--bld-border-subtle)', minHeight: 80 }}>
            <CodeMirror
              value={strVal}
              height="auto"
              minHeight="80px"
              extensions={[json()]}
              theme={oneDark}
              basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
              style={{ fontSize: 11 }}
              onChange={handleCodeChange}
            />
          </div>
        ) : multiline ? (
          <textarea
            style={{ ...S.fieldInput, flex: 1, resize: 'vertical', minHeight: 60 }}
            value={strVal}
            placeholder={placeholder ?? 'Enter a value'}
            onChange={e => onChange(e.target.value || undefined)}
          />
        ) : numeric ? (
          <input
            type="number"
            style={{ ...S.fieldInput, flex: 1 }}
            value={strVal}
            placeholder={placeholder ?? '0'}
            onChange={e => onChange(e.target.value || undefined)}
          />
        ) : (
          <input
            style={{ ...S.fieldInput, flex: 1 }}
            value={strVal}
            placeholder={placeholder ?? 'Enter a value'}
            onChange={e => onChange(e.target.value || undefined)}
          />
        )}
      </div>
      {open && (
        <FormulaEditor
          label={label}
          value={migratedValue ?? null}
          onChange={handleFormulaChange}
          onClose={() => setOpen(false)}
          anchorRight={anchorRight ?? 292}
          expectedType={expectedType}
          workflowTrigger={workflowTrigger}
          serverContext={effectiveServerContext}
          formulaParams={effectiveParams}
          paramsInQuick={effectiveParamsInQuick}
        />
      )}
    </>
  );
}

function ChangeVariableValueConfig({
  cfg,
  setCfg,
  workflowTrigger,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
  workflowTrigger?: string;
}) {
  const { customVars, pageNodes } = useBuilderStore();
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);

  // Build page-component variable entries (standalone inputs + form containers)
  const { standalones, formContainers } = React.useMemo(
    () => collectPageComponents(pageNodes, false),
    [pageNodes],
  );
  const pageVars = React.useMemo(() => {
    const entries: Array<{ id: string; label: string; type: string }> = [];
    for (const { node, insideForm } of standalones) {
      const nodeId = (node as { id?: string }).id;
      if (!nodeId) continue;
      const name = ((node as { name?: string }).name || node.type).trim() || 'Input';
      entries.push({ id: `${nodeId}-value`, label: insideForm ? `Form - ${name}` : name, type: 'string' });
    }
    for (const { node } of formContainers) {
      const nodeId = (node as { id?: string }).id;
      if (!nodeId) continue;
      const name = ((node as { name?: string }).name || 'Form').trim();
      entries.push({ id: `${nodeId}-form`, label: `Form Container - ${name}`, type: 'object' });
    }
    return entries;
  }, [standalones, formContainers]);

  const allVars = React.useMemo(() => {
    const pageVarIds = new Set(pageVars.map(v => v.id));
    return [
      ...pageVars,
      ...customVars.filter(v => !pageVarIds.has(v.id ?? v.name ?? '')),
    ];
  }, [pageVars, customVars]);

  const varId = cfg.variableName as string | undefined;
  const selectedPageVar = pageVars.find(v => v.id === varId);
  const selected = selectedPageVar ?? customVars.find(v => (v.id ?? v.name) === varId);
  const rawPathSelected = varId && !selected ? varId : null;
  const varType = selected?.type ?? 'string';

  const filtered = allVars.filter(v => {
    const label = (('label' in v ? v.label : undefined) ?? ('name' in v ? (v as { name?: string }).name : undefined) ?? '').toLowerCase();
    return !search || label.includes(search.toLowerCase());
  });

  const val = cfg.value as FormulaValue | undefined;

  // Array operation (default: replace)
  const arrayOp = (cfg.arrayOperation as string) || 'replace';
  const needsIndex = arrayOp === 'insertAt' || arrayOp === 'removeAt' || arrayOp === 'updateOne';
  const needsValue = !['removeAt', 'removeFirst', 'removeLast'].includes(arrayOp);

  // Object partial update
  const partialUpdate = cfg.partialUpdate !== false && varType === 'object';

  return (
    <>
      {/* ── Variable picker ── */}
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Variable *</label>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            ...S.fieldInput, width: '100%', textAlign: 'left', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
          }}
        >
          {selected ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 9, color: TYPE_COLOR[selected.type] ?? 'var(--bld-text-3)', fontFamily: 'monospace',
                background: 'rgba(255,255,255,0.07)', border: `1px solid ${TYPE_COLOR[selected.type] ?? 'var(--bld-border-subtle)'}`,
                borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>{selected.type}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selected.label ?? (selected as { name?: string }).name}
              </span>
            </span>
          ) : rawPathSelected ? (
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(rawPathSelected) ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }} title={rawPathSelected}>
                <span style={{ fontSize: 9, color: 'var(--bld-error)', fontFamily: 'monospace',
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>!</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--bld-error)', fontSize: 11 }}>
                  Unknown variable
                </span>
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }} title={rawPathSelected}>
                <span style={{ fontSize: 9, color: 'var(--bld-text-3)', fontFamily: 'monospace',
                  background: 'rgba(255,255,255,0.07)', border: '1px solid var(--bld-border-subtle)',
                  borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>path</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--bld-text-2)' }}>
                  {rawPathSelected.split('.').pop()}
                </span>
                <span style={{ color: 'var(--bld-text-disabled)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {rawPathSelected.split('.').slice(0, -1).join('.')}
                </span>
              </span>
            )
          ) : (
            <span style={{ color: 'var(--bld-text-disabled)' }}>Choose a variable</span>
          )}
          <span style={{ color: 'var(--bld-text-disabled)', fontSize: 10, flexShrink: 0 }}>{open ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}</span>
        </button>

        {open && (
          <div
            data-popover
            style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6,
              marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              maxHeight: 240, display: 'flex', flexDirection: 'column',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '6px 8px', borderBottom: 'none' }}>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search variables…"
                style={{
                  width: '100%', boxSizing: 'border-box', background: 'var(--bld-bg-input)',
                  border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-2)',
                  fontSize: 11, padding: '3px 7px', outline: 'none',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {search.includes('.') && (
                <button
                  onClick={() => { setCfg('variableName', search.trim()); setOpen(false); setSearch(''); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-accent)', fontSize: 11, textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 9, color: 'var(--bld-text-3)', fontFamily: 'monospace',
                    background: 'rgba(255,255,255,0.07)', border: '1px solid var(--bld-border-subtle)',
                    borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>path</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10 }}>Use &ldquo;{search.trim()}&rdquo;</span>
                </button>
              )}
              {filtered.length === 0 && !search.includes('.') && (
                <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--bld-text-disabled)' }}>No variables found</div>
              )}
              {filtered.map(v => {
                const key = v.id ?? (v as { name?: string }).name;
                const isActive = key === varId;
                return (
                  <button
                    key={key}
                    onClick={() => { setCfg('variableName', key); setOpen(false); setSearch(''); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                      background: isActive ? 'var(--bld-bg-elevated)' : 'none', border: 'none', cursor: 'pointer',
                      color: isActive ? 'var(--bld-accent)' : 'var(--bld-text-2)', fontSize: 11, textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 9, color: TYPE_COLOR[v.type] ?? 'var(--bld-text-3)', fontFamily: 'monospace',
                      background: 'rgba(255,255,255,0.07)', border: `1px solid ${TYPE_COLOR[v.type] ?? 'var(--bld-border-subtle)'}`,
                      borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>{v.type}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.label ?? (v as { name?: string }).name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Only show type-specific fields once a variable is selected ── */}
      {varId && (
        <>
          {/* Object type: Partial Update */}
          {varType === 'object' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-bg-input)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'var(--bld-text-2)' }}>Partial Update</span>
                <OnOffToggle value={partialUpdate} onChange={v => setCfg('partialUpdate', v)} />
              </div>
              {partialUpdate && (
                <BoundField
                  label="Path"
                  value={cfg.path as FormulaValue | undefined}
                  onChange={v => setCfg('path', v)}
                  placeholder="property"
                  workflowTrigger={workflowTrigger}
                />
              )}
            </div>
          )}

          {/* Array type: Update array operation */}
          {varType === 'array' && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-bg-input)', borderRadius: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-2)' }}>Update array</span>
              <div style={{ marginTop: 8 }}>
                <OptionPickerDropdown
                  value={arrayOp}
                  onChange={v => setCfg('arrayOperation', v)}
                  options={ARRAY_OPS}
                />
              </div>
              {needsIndex && (
                <BoundField
                  label="Index"
                  required
                  numeric
                  value={cfg.index as FormulaValue | undefined}
                  onChange={v => setCfg('index', v)}
                  placeholder="0"
                  workflowTrigger={workflowTrigger}
                  expectedType={'number' as const}
                />
              )}
            </div>
          )}

          {/* Boolean type: True / False dropdown */}
          {varType === 'boolean' && (
            <>
              <label style={{ ...S.fieldLabel, marginTop: 10 }}>Value *</label>
              <OptionPickerDropdown
                value={val === true || val === 'true' ? 'true' : val === false || val === 'false' ? 'false' : ''}
                onChange={v => setCfg('value', v === 'true' ? true : v === 'false' ? false : undefined)}
                options={[
                  { value: '', label: 'Select a value' },
                  { value: 'true', label: 'True' },
                  { value: 'false', label: 'False' },
                ]}
                placeholder="Select a value"
              />
            </>
          )}

          {/* String / number / object / array value field */}
          {varType !== 'boolean' && (varType !== 'array' || needsValue) && (
            <BoundField
              label="Value"
              required
              value={val}
              onChange={v => setCfg('value', v)}
              placeholder={varType === 'number' ? '0' : 'Enter a value'}
              multiline={varType !== 'number'}
              numeric={varType === 'number'}
              workflowTrigger={workflowTrigger}
              expectedType={varType === 'number' ? 'number' : 'string' as const}
            />
          )}
        </>
      )}
    </>
  );
}

// ─── Branch condition field (formula-bound) ───────────────────────────────────

function BranchConditionField({
  cfg,
  setCfg,
  workflowTrigger,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
  workflowTrigger?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const condition = cfg.condition as FormulaValue | undefined;
  // Branch conditions are always formulas — treat any non-empty string as bound
  // so they show as "ƒ Edit formula" chip instead of a plain text input.
  const isBound = isBoundValue(condition) || (typeof condition === 'string' && condition.trim().length > 0);

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition *</label>
      <p style={{ fontSize: 10, color: 'var(--bld-text-3)', margin: '0 0 6px' }}>
        Formula that evaluates to true or false. Use{' '}
        <code style={{ background: 'var(--bld-bg-input)', padding: '1px 4px', borderRadius: 3 }}>
          {'context.workflow[\'stepId\'].result'}
        </code>
        {' '}to access prior step results.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {isBound ? (
          <button
            onClick={() => setOpen(v => !v)}
            style={{ flex: 1, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
              borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              textAlign: 'left' }}
          >ƒ Edit formula</button>
        ) : (
          <input
            data-testid="branch-condition-input"
            style={{ ...S.fieldInput, flex: 1, fontFamily: 'monospace', fontSize: 11 }}
            value={typeof condition === 'string' ? condition : ''}
            placeholder="e.g. context.workflow['step-1'].result?.success"
            onChange={e => setCfg('condition', e.target.value)}
          />
        )}
        <BindingIcon
          isBound={isBound}
          onClick={() => setOpen(v => !v)}
        />
      </div>
      {open && (
        <FormulaEditor
          label="Branch Condition"
          value={condition ?? null}
          onChange={v => { setCfg('condition', v); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRight={292}
          workflowTrigger={workflowTrigger}
        />
      )}
    </>
  );
}

// ─── ParamBoundField ──────────────────────────────────────────────────────────
// A typed field for a single global-workflow parameter in the caller's config.
// Shows a type-appropriate input (toggle for Boolean, number for Number,
// CodeMirror for Object/Array, text for Text) plus a bind button that opens
// the formula editor — identical UX to BoundField but with type awareness.

function ParamBoundField({
  param,
  value,
  onChange,
  workflowTrigger,
}: {
  param: WorkflowParam;
  value: FormulaValue | undefined;
  onChange: (v: FormulaValue | undefined) => void;
  workflowTrigger?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const isBound = isBoundValue(value);
  const strVal = !isBound ? (value as string) ?? '' : '';
  const preEditRef = useRef<FormulaValue | undefined>(value);

  // Tag-chip input for Text + allowMultiple (uncontrolled ref, same as ParamEditor)
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [tagTick, setTagTick] = React.useState(0);
  void tagTick; // consumed to trigger re-render after tag commit
  const currentTagsFromValue = (): string[] => {
    if (!isBound && param.type === 'Text' && param.allowMultiple) {
      try {
        const parsed = JSON.parse(strVal);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch { /* not JSON */ }
      return strVal ? strVal.split(',').map(s => s.trim()).filter(Boolean) : [];
    }
    return [];
  };
  const tags = currentTagsFromValue();

  function commitTag() {
    const raw = tagInputRef.current?.value ?? '';
    const trimmed = raw.trim();
    if (!trimmed) return;
    const next = [...tags, trimmed];
    onChange(JSON.stringify(next));
    if (tagInputRef.current) tagInputRef.current.value = '';
    setTagTick(t => t + 1);
  }
  function removeTag(idx: number) {
    const next = tags.filter((_, i) => i !== idx);
    onChange(next.length ? JSON.stringify(next) : undefined);
  }

  const handleOpenEditor = useCallback(() => {
    preEditRef.current = value;
    setOpen(v => !v);
  }, [value]);

  const handleFormulaChange = useCallback((v: FormulaValue | null) => {
    if ((v === '' || v == null) && typeof preEditRef.current === 'string' && !isBoundValue(preEditRef.current)) {
      onChange(preEditRef.current || undefined);
    } else {
      onChange(v ?? undefined);
    }
    setOpen(false);
  }, [onChange]);

  const expectedType =
    param.type === 'Number' ? 'number'
      : param.type === 'Boolean' ? 'boolean'
      : param.type === 'Object' ? 'object'
      : param.type === 'Array' ? 'array'
      : 'string';

  const isBlock = !isBound && (param.type === 'Object' || param.type === 'Array' || param.allowMultiple);

  return (
    <>
      {/* Label row with type badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 10, marginBottom: 3 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, background: 'var(--bld-bg-elevated)', color: 'var(--bld-info)',
          borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace', flexShrink: 0,
        }}>
          {PARAM_TYPE_ICONS[param.type] ?? 'T'}
        </span>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-3)', flex: 1, margin: 0 }}>
          {param.name || 'Unnamed'}
          {param.allowMultiple && (
            <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--bld-text-disabled)' }}>(multi)</span>
          )}
        </label>
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', alignItems: isBlock ? 'flex-start' : 'center', gap: 6 }}>
        <BindingIcon isBound={isBound} onClick={handleOpenEditor} />

        {isBound ? (
          /* Formula chip — click to re-open editor */
          <button
            onClick={handleOpenEditor}
            style={{
              flex: 1, padding: '5px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid var(--bld-accent)',
              borderRadius: 5, color: 'var(--bld-accent)', fontSize: 11, cursor: 'pointer',
              fontWeight: 500, textAlign: 'left',
            }}
          >
            ƒ Edit formula
          </button>

        ) : param.type === 'Boolean' ? (
          /* Boolean toggle */
          <div style={{
            flex: 1, display: 'flex', background: 'var(--bld-bg-input)',
            borderRadius: 5, padding: 2, gap: 2,
          }}>
            {(['true', 'false'] as const).map(opt => {
              const boolStr = strVal === '' ? 'false' : String(strVal);
              const active = boolStr === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onChange(opt)}
                  style={{
                    flex: 1, padding: '5px 0', fontSize: 11, border: 'none',
                    borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                    background: active
                      ? (opt === 'true' ? 'rgba(34,197,94,0.2)' : 'rgba(248,113,113,0.2)')
                      : 'transparent',
                    color: active
                      ? (opt === 'true' ? 'var(--bld-success)' : 'var(--bld-error)')
                      : 'var(--bld-text-disabled)',
                    transition: 'background 0.1s, color 0.1s',
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>

        ) : param.type === 'Number' ? (
          /* Number input */
          <input
            type="number"
            style={{ ...S.fieldInput, flex: 1 }}
            value={strVal}
            placeholder="0"
            onChange={e => onChange(e.target.value || undefined)}
          />

        ) : param.type === 'Object' || param.type === 'Array' ? (
          /* CodeMirror JSON editor */
          <div style={{ flex: 1, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--bld-border-subtle)', minHeight: 70 }}>
            <CodeMirror
              value={strVal || (param.type === 'Array' ? '[]' : '{}')}
              height="auto"
              minHeight="70px"
              maxHeight="160px"
              extensions={[json()]}
              theme={oneDark}
              basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
              style={{ fontSize: 11 }}
              onChange={val => onChange(val || undefined)}
            />
          </div>

        ) : param.allowMultiple ? (
          /* Tag-chip input for Text + allowMultiple — Enter adds a chip */
          <div style={{ flex: 1 }}>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 5 }} onClick={e => e.stopPropagation()}>
                {tags.map((tag, i) => (
                  <span
                    key={`${tag}-${i}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-accent)',
                      borderRadius: 4, padding: '2px 6px', fontSize: 11, color: 'var(--bld-accent)',
                    }}
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); removeTag(i); }}
                      style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 12 }}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
              <input
                ref={tagInputRef}
                style={{ ...S.fieldInput, flex: 1 }}
                placeholder="Type and press Enter…"
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commitTag(); } }}
              />
              <button
                type="button"
                onClick={e => { e.stopPropagation(); commitTag(); tagInputRef.current?.focus(); }}
                style={{
                  background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-accent)', borderRadius: 5,
                  color: 'var(--bld-accent)', fontSize: 12, cursor: 'pointer', padding: '4px 8px', flexShrink: 0,
                }}
              >+</button>
            </div>
          </div>

        ) : (
          /* Plain text input */
          <input
            style={{ ...S.fieldInput, flex: 1 }}
            value={strVal}
            placeholder="Enter text…"
            onChange={e => onChange(e.target.value || undefined)}
          />
        )}
      </div>

      {open && (
        <FormulaEditor
          label={param.name}
          value={value ?? null}
          onChange={handleFormulaChange}
          onClose={() => setOpen(false)}
          anchorRight={292}
          expectedType={expectedType}
          workflowTrigger={workflowTrigger}
        />
      )}
    </>
  );
}

// ─── GlobalWorkflowPicker ─────────────────────────────────────────────────────
// Dropdown for selecting a global workflow — styled identically to TypeSearchDropdown.

function GlobalWorkflowPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { workflows } = useBuilderStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="global-wf-picker"]')) {
        setOpen(false);
        setSearch('');
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  const all = Object.values(workflows as Record<string, import('@/config/types').WorkflowDef>)
    .filter(w => !w.isTrigger && !w.isAppTrigger && !w.pageScope)
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  const filtered = search
    ? all.filter(w => (w.name ?? w.id).toLowerCase().includes(search.toLowerCase()))
    : all;

  const selected = value ? (workflows as Record<string, import('@/config/types').WorkflowDef>)[value] : undefined;
  const label = selected ? toHumanName(selected.name ?? value) : 'Choose a global workflow';

  return (
    <div ref={wrapperRef} data-popover="global-wf-picker" style={{ position: 'relative', width: '100%' }}>
      <button
        style={{
          ...S.fieldSelect,
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', textAlign: 'left', paddingRight: 28,
        }}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
      >
        {selected && <span style={{ fontSize: 12, flexShrink: 0 }}>Φ</span>}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}>
          {label}
        </span>
        {selected && (selected.params?.length ?? 0) > 0 && (
          <span style={{ fontSize: 9, background: 'rgba(34,197,94,0.15)', color: 'var(--bld-success)', borderRadius: 3, padding: '1px 5px', fontWeight: 600, flexShrink: 0 }}>
            {selected.params!.length} param{selected.params!.length !== 1 ? 's' : ''}
          </span>
        )}
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--bld-text-disabled)', pointerEvents: 'none' }}>
          {open ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}
        </span>
      </button>

      {open && (
        <div style={{
          ...S.dropdown,
          position: 'absolute', top: '100%', left: 0, right: 0,
          zIndex: 300, minWidth: 'unset', width: '100%', maxHeight: 280,
        }}>
          <input
            ref={searchRef}
            style={S.dropdownSearch}
            placeholder="Search global workflows…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {filtered.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--bld-text-disabled)' }}>No global workflows found</div>
          )}
          {filtered.map(w => (
            <button
              key={w.id}
              style={S.dropdownItem(w.id === value)}
              onMouseEnter={e => { if (w.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
              onMouseLeave={e => { if (w.id !== value) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
              onClick={() => { onChange(w.id); setOpen(false); setSearch(''); }}
            >
              <span style={{ fontSize: 12 }}>Φ</span>
              <span style={{ flex: 1 }}>{toHumanName(w.name ?? w.id)}</span>
              {(w.params?.length ?? 0) > 0 && (
                <span style={{ fontSize: 9, background: 'rgba(34,197,94,0.15)', color: 'var(--bld-success)', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }}>
                  {w.params!.length} param{w.params!.length !== 1 ? 's' : ''}
                </span>
              )}
              {w.id === value && <span style={{ color: 'var(--bld-accent)', fontSize: 10 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── RunProjectWorkflowConfig ─────────────────────────────────────────────────
// Config section for runProjectWorkflow steps — shows the workflow picker
// and dynamic param input fields when the selected workflow has params.
// Resolves the bound workflow from store.workflows
// (any named workflow — page or global — can be called via runProjectWorkflow)
// at runtime (the engine merges both into a single action map).

function RunProjectWorkflowConfig({
  step,
  onUpdate,
  workflowTrigger,
}: {
  step: ActionStep;
  onUpdate: (patch: Partial<ActionStep>) => void;
  workflowTrigger?: string;
}) {
  const { workflows } = useBuilderStore();
  const workflowId = (step.config?.workflowId as string) ?? step.action ?? '';
  const selectedMeta = workflowId
    ? (workflows as Record<string, import('@/config/types').WorkflowDef>)[workflowId]
    : undefined;
  const params: WorkflowParam[] = selectedMeta?.params ?? [];
  const savedParams = (step.config?.params as Record<string, unknown>) ?? {};

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Workflow *</label>
      <WorkflowBindButton
        value={workflowId}
        onChange={uuid => onUpdate({ action: uuid, config: { ...(step.config ?? {}), workflowId: uuid }, name: uuid })}
        globalOnly={false}
      />

      {/* Param input fields — only shown when the selected workflow has declared params */}
      {params.length > 0 && (
        <div style={{ marginTop: 14, borderTop: 'none', paddingTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-3)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12 }}>Φ</span> Parameters
          </div>
          {params.map(p => (
            <ParamBoundField
              key={p.id}
              param={p}
              value={savedParams[p.name] as FormulaValue | undefined}
              onChange={v => {
                const next = { ...savedParams, [p.name]: v };
                onUpdate({ config: { ...(step.config ?? {}), params: next } });
              }}
              workflowTrigger={workflowTrigger}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ─── RunJavaScriptConfig ──────────────────────────────────────────────────────
// Config section for the runJavaScript step type. Renders an "Edit code" tile
// that opens the full FormulaEditor locked into JavaScript mode, mirroring
// WeWeb's Custom JavaScript action. The side tabs (Variables / Data / Formulas /
// Quick) are still available so the user can insert WeWeb-style identifiers
// (e.g. `variables.cartCount`, `collections.products.data`) at the cursor.
//
// The editor's body runs as an async function with access to wwLib (variables,
// collections, workflow context, parameters). Return value is stored at
// context.workflow[stepId].result.

function RunJavaScriptConfig({
  step,
  onUpdate,
  workflowTrigger,
}: {
  step: ActionStep;
  onUpdate: (patch: Partial<ActionStep>) => void;
  workflowTrigger?: string;
}) {
  const code = (step.config?.code as string | undefined) ?? '';
  const [open, setOpen] = React.useState(false);

  // Wrap the raw code string as a `{ js: code }` FormulaValue when handing it
  // to the FormulaEditor, and unwrap on save so we keep persisting a plain
  // string at step.config.code (the runtime in workflow-steps-handler.ts
  // expects a string).
  const value: FormulaValue = code ? ({ js: code } as unknown as FormulaValue) : null;
  const handleChange = (next: FormulaValue) => {
    let nextCode = '';
    if (next && typeof next === 'object' && 'js' in next && typeof (next as { js?: unknown }).js === 'string') {
      nextCode = (next as { js: string }).js;
    } else if (typeof next === 'string') {
      nextCode = next;
    }
    onUpdate({ config: { ...(step.config ?? {}), code: nextCode } });
  };

  // Compact preview of the first non-blank line of the code, shown on the tile
  // so users can see what's bound at a glance.
  const previewLine = (code.split('\n').map(l => l.trim()).find(Boolean) ?? '').slice(0, 56);

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>JavaScript code *</label>
      <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginBottom: 4, lineHeight: 1.5 }}>
        Async function body. Available globals: <code style={{ color: 'var(--bld-accent)' }}>variables</code>, <code style={{ color: 'var(--bld-accent)' }}>collections</code>,{' '}
        <code style={{ color: 'var(--bld-accent)' }}>context</code>, <code style={{ color: 'var(--bld-accent)' }}>parameters</code>, <code style={{ color: 'var(--bld-accent)' }}>wwLib</code>.
        Return value is stored at <code style={{ color: 'var(--bld-warning)' }}>{`context.workflow["${step.id}"].result`}</code>.
      </div>
      <button
        type="button"
        data-testid="run-javascript-edit"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          width: '100%', padding: '6px 8px',
          background: code ? 'rgba(139, 92, 246, 0.12)' : 'var(--bld-bg-base)',
          border: `1px solid ${code ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`,
          borderRadius: 5,
          color: code ? 'var(--bld-accent)' : 'var(--bld-text-3)',
          fontSize: 11,
          fontFamily: '"JetBrains Mono","Fira Mono",monospace',
          textAlign: 'left',
          cursor: 'pointer',
          minHeight: 30,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, borderRadius: 3,
            background: 'var(--bld-warning)', color: 'var(--bld-text-2)',
            fontSize: 9, fontWeight: 800, flexShrink: 0,
          }}
        >JS</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {code ? (previewLine || `${code.length} characters`) : 'Edit code'}
        </span>
      </button>
      {open && (
        <FormulaEditor
          label="JavaScript code"
          value={value}
          onChange={handleChange}
          onClose={() => setOpen(false)}
          anchorRight={292}
          workflowTrigger={workflowTrigger}
          lockToJs
          hideUnbind
        />
      )}
    </>
  );
}

// ─── Server action config panels ─────────────────────────────────────────────

/** Shared server config field label style */
const SL = { ...S.fieldLabel, marginTop: 12 } as React.CSSProperties;

/** Collapsible section with optional/incomplete status label */
function CollapsibleSection({
  title, status = 'Optional', defaultOpen = false, children,
}: {
  title: string; status?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const color = status === 'Incomplete' ? 'var(--bld-warning)' : status === 'Optional' ? 'var(--bld-text-disabled)' : 'var(--bld-success)';
  return (
    <div style={{ marginTop: 14, border: '1px solid var(--bld-bg-elevated)', borderRadius: 6, overflow: 'hidden' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', cursor: 'pointer', background: 'var(--bld-bg-base)' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--bld-text-2)' }}>{title}</span>
        <span style={{ fontSize: 11, color, marginRight: 8 }}>{status}</span>
        <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>{open ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(180deg)":"rotate(0deg)"}}><polyline points="6 9 12 15 18 9"/></svg>}</span>
      </div>
      {open && (
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--bld-bg-elevated)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Table picker dropdown — loads project tables on mount */
function TablePicker({
  projectId, value, onChange,
}: {
  projectId: string; value: string; onChange: (v: string) => void;
}) {
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!projectId) return;
    backendTables.list(projectId).then(res => {
      setTables((res.tables ?? []).map((t: { id: string; name: string }) => ({ id: t.name, name: t.name })));
    }).catch(() => {});
  }, [projectId]);

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ ...S.fieldInput, marginTop: 4, cursor: 'pointer' }}
    >
      <option value="">Select a table…</option>
      {tables.map(t => (
        <option key={t.id} value={t.name}>
          public • {t.name}
        </option>
      ))}
    </select>
  );
}

/** Key-value builder row editor */
function KeyValueBuilderField({
  label, value, onChange,
}: {
  label?: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(value ?? {});
  const addRow = () => onChange({ ...value, '': '' });
  const updateKey = (oldKey: string, newKey: string) => {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value ?? {})) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
  };
  const updateVal = (key: string, newVal: string) => onChange({ ...value, [key]: newVal });
  const removeRow = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  return (
    <div>
      {label && <label style={SL}>{label}</label>}
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
          <button
            onClick={() => removeRow(k)}
            style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--bld-error)', cursor: 'pointer', fontSize: 14 }}
          >−</button>
          <input
            style={{ ...S.fieldInput, flex: 1 }}
            value={k}
            placeholder="Key"
            onChange={e => updateKey(k, e.target.value)}
          />
          <input
            style={{ ...S.fieldInput, flex: 1 }}
            value={typeof v === 'string' ? v : JSON.stringify(v)}
            placeholder="Value"
            onChange={e => updateVal(k, e.target.value)}
          />
        </div>
      ))}
      <button
        onClick={addRow}
        style={{ marginTop: 6, fontSize: 11, color: 'var(--bld-accent)', background: 'none', border: 'none', cursor: 'pointer' }}
      >+ Add Property</button>
    </div>
  );
}

// ─── Filter format helpers ────────────────────────────────────────────────────
// Workflows seeded/created in code use `cfg.filters` (interpreter format):
//   [{ column, operator, value }]
// The UI panels use `cfg.filterConditions` (FilterCondition[] format):
//   [{ id, field, operator, value, active }]
// These helpers bridge the two so existing step configs display correctly.

type RawFilter = { column?: string; field?: string; operator?: string; value?: unknown };

function migrateFilterValue(v: unknown): FormulaValue {
  if (typeof v === 'string') {
    // Auto-migrate old $input.xxx syntax → parameters formula object
    const m = v.match(/^\$input\.(\w+)$/);
    if (m) return { formula: `parameters?.['${m[1]}']` };
    return v;
  }
  if (v != null && typeof v === 'object' && 'formula' in v) return v as { formula: string };
  if (v != null) return JSON.stringify(v);
  return '';
}

function filtersToConditions(raw: RawFilter[] | undefined): FilterCondition[] {
  if (!raw?.length) return [];
  return raw.map(f => ({
    id:       uid(),
    field:    f.column ?? f.field ?? '',
    operator: f.operator ?? '=',
    value:    migrateFilterValue(f.value),
    active:   true,
  }));
}

function conditionsToFilters(conditions: FilterCondition[]): RawFilter[] {
  return conditions.filter(c => c.active).map(c => ({ column: c.field, operator: c.operator, value: c.value }));
}

function initConditions(cfg: Record<string, unknown>): FilterCondition[] {
  const ui = cfg.filterConditions as FilterCondition[] | undefined;
  if (ui?.length) return ui;
  return filtersToConditions(cfg.filters as RawFilter[] | undefined);
}

// ─── TablesListConfig (Get rows) ──────────────────────────────────────────────

function TablesListConfig({
  cfg, setCfg, step, projectId, workflowTrigger, formulaParams,
}: {
  cfg: Record<string, unknown>;
  setCfg: (k: string, v: unknown) => void;
  step: ActionStep;
  projectId?: string;
  workflowTrigger?: string;
  formulaParams?: GlobalFormulaParam[];
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [conditions, setConditions] = useState<FilterCondition[]>(() => initConditions(cfg));
  const [groups, setGroups] = useState<FilterGroup[]>((cfg.filterGroups as FilterGroup[]) ?? []);
  const [sorts, setSorts] = useState<SortSpec[]>((cfg.sorts as SortSpec[]) ?? []);
  const [pendingConditions, setPendingConditions] = useState<FilterCondition[]>([]);
  const [pendingGroups, setPendingGroups] = useState<FilterGroup[]>([]);
  const [pendingSorts, setPendingSorts] = useState<SortSpec[]>([]);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const pagEnabled = (cfg.paginationEnabled as boolean) ?? false;

  return (
    <>
      <label style={SL}>Table *</label>
      <TablePicker
        projectId={projectId ?? ''}
        value={(cfg.table as string) ?? ''}
        onChange={v => setCfg('table', v)}
      />

      <CollapsibleSection title="Data" status="Optional">
        <label style={SL}>Columns</label>
        <select style={{ ...S.fieldInput, marginTop: 4, cursor: 'pointer' }} value={(cfg.columns as string) ?? 'all'} onChange={e => setCfg('columns', e.target.value)}>
          <option value="all">All columns</option>
          <option value="custom">Custom selection</option>
        </select>
      </CollapsibleSection>

      <CollapsibleSection title="Filters & Sort" status="Optional">
        <div style={{ marginBottom: 6 }}>
          <button
            ref={filterBtnRef}
            onClick={() => { setPendingConditions([...conditions]); setPendingGroups([...groups]); setFilterOpen(o => !o); setSortOpen(false); }}
            style={{ ...S.toggleBtn(conditions.length > 0 || groups.length > 0), width: '100%', justifyContent: 'flex-start' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg> Configure Filter {conditions.length + groups.length > 0 ? `(${conditions.length + groups.length})` : ''}
          </button>
          <FloatingAnchor open={filterOpen} anchorRef={filterBtnRef} minWidth={560}>
            <FilterPanel
              conditions={pendingConditions}
              groups={pendingGroups}
              allCols={[]}
              onChange={setPendingConditions}
              onChangeGroups={setPendingGroups}
              onReset={() => { setPendingConditions([]); setPendingGroups([]); }}
              onSave={() => {
                setConditions(pendingConditions);
                setGroups(pendingGroups);
                setCfg('filterConditions', pendingConditions);
                setCfg('filterGroups', pendingGroups);
                setCfg('filters', conditionsToFilters(pendingConditions));
                setFilterOpen(false);
              }}
              renderValue={formulaParams?.length
                ? (val, onChg) => (
                    <BoundField
                      label=""
                      value={val}
                      onChange={onChg}
                      workflowTrigger={workflowTrigger}
                      serverContext
                      formulaParams={formulaParams}
                      paramsInQuick
                      anchorRight={292}
                    />
                  )
                : undefined}
            />
          </FloatingAnchor>
        </div>
        <div>
          <button
            ref={sortBtnRef}
            onClick={() => { setPendingSorts([...sorts]); setSortOpen(o => !o); setFilterOpen(false); }}
            style={{ ...S.toggleBtn(sorts.length > 0), width: '100%', justifyContent: 'flex-start' }}
          >
            ↕ Configure Sort {sorts.length > 0 ? `(${sorts.length})` : ''}
          </button>
          <FloatingAnchor open={sortOpen} anchorRef={sortBtnRef} minWidth={400}>
            <SortPanel
              pending={pendingSorts}
              allCols={[]}
              onChange={setPendingSorts}
              onReset={() => setPendingSorts([])}
              onSave={() => {
                setSorts(pendingSorts);
                setCfg('sorts', pendingSorts);
                setSortOpen(false);
              }}
            />
          </FloatingAnchor>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Pagination" status={pagEnabled ? 'Optional' : 'Optional'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--bld-text-3)' }}>Enable pagination</span>
          <OnOffToggle value={pagEnabled} onChange={v => setCfg('paginationEnabled', v)} />
        </div>
        {pagEnabled && (
          <>
            <BoundField
              label="Limit"
              value={cfg.limit as FormulaValue | undefined}
              onChange={v => setCfg('limit', v)}
              placeholder="Number of records to return"
              workflowTrigger={workflowTrigger}
            />
            <BoundField
              label="Offset"
              value={cfg.offset as FormulaValue | undefined}
              onChange={v => setCfg('offset', v)}
              placeholder="Number of records to skip"
              workflowTrigger={workflowTrigger}
            />
            <label style={SL}>Include Total Count</label>
            <OnOffToggle
              value={(cfg.includeTotalCount as boolean) ?? false}
              onChange={v => setCfg('includeTotalCount', v)}
            />
          </>
        )}
      </CollapsibleSection>
    </>
  );
}

// ─── TablesInsertConfig ───────────────────────────────────────────────────────

function TablesInsertConfig({
  cfg, setCfg, projectId, workflowTrigger,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void;
  projectId?: string; workflowTrigger?: string;
}) {
  const insertMode = (cfg.insertMode as string) ?? 'single';
  return (
    <>
      <label style={SL}>Table *</label>
      <TablePicker projectId={projectId ?? ''} value={(cfg.table as string) ?? ''} onChange={v => setCfg('table', v)} />

      <label style={SL}>Insert mode</label>
      <div style={S.toggleGroup}>
        <button style={S.toggleBtn(insertMode === 'single')} onClick={() => setCfg('insertMode', 'single')}>Single</button>
        <button style={S.toggleBtn(insertMode === 'multiple')} onClick={() => setCfg('insertMode', 'multiple')}>Multiple</button>
      </div>

      <CollapsibleSection title="Data" status={cfg.data ? 'Optional' : 'Incomplete'} defaultOpen>
        <BoundField
          label="Data"
          required
          value={cfg.data as FormulaValue | undefined}
          onChange={v => setCfg('data', v)}
          placeholder="Record data as object / array"
          workflowTrigger={workflowTrigger}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Options" status="Optional">
        <label style={SL}>Return Inserted Data</label>
        <OnOffToggle value={(cfg.returnData as boolean) ?? false} onChange={v => setCfg('returnData', v)} />
        <label style={SL}>Upsert Mode</label>
        <OnOffToggle value={(cfg.upsert as boolean) ?? false} onChange={v => setCfg('upsert', v)} />
      </CollapsibleSection>
    </>
  );
}

// ─── TablesUpdateConfig ───────────────────────────────────────────────────────

function TablesUpdateConfig({
  cfg, setCfg, projectId, workflowTrigger, formulaParams,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void;
  projectId?: string; workflowTrigger?: string;
  formulaParams?: GlobalFormulaParam[];
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [conditions, setConditions] = useState<FilterCondition[]>(() => initConditions(cfg));
  const [groups, setGroups] = useState<FilterGroup[]>((cfg.filterGroups as FilterGroup[]) ?? []);
  const [pendingConditions, setPendingConditions] = useState<FilterCondition[]>([]);
  const [pendingGroups, setPendingGroups] = useState<FilterGroup[]>([]);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const updateMode = (cfg.updateMode as string) ?? 'byId';

  return (
    <>
      <label style={SL}>Table *</label>
      <TablePicker projectId={projectId ?? ''} value={(cfg.table as string) ?? ''} onChange={v => setCfg('table', v)} />

      <label style={SL}>Update mode</label>
      <div style={S.toggleGroup}>
        <button style={S.toggleBtn(updateMode === 'byId')} onClick={() => setCfg('updateMode', 'byId')}>By ID</button>
        <button style={S.toggleBtn(updateMode === 'byFilters')} onClick={() => setCfg('updateMode', 'byFilters')}>By Filters</button>
      </div>

      {updateMode === 'byId' && (
        <BoundField
          label="Row ID *"
          required
          value={cfg.rowId as FormulaValue | undefined}
          onChange={v => setCfg('rowId', v)}
          placeholder="Enter ID to identify record"
          workflowTrigger={workflowTrigger}
        />
      )}

      {updateMode === 'byFilters' && (
        <div style={{ marginTop: 8 }}>
          <button
            ref={filterBtnRef}
            onClick={() => { setPendingConditions([...conditions]); setPendingGroups([...groups]); setFilterOpen(o => !o); }}
            style={{ ...S.toggleBtn(conditions.length > 0 || groups.length > 0), width: '100%', justifyContent: 'flex-start' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg> Configure Filter *
          </button>
          <FloatingAnchor open={filterOpen} anchorRef={filterBtnRef} minWidth={560}>
            <FilterPanel
              conditions={pendingConditions}
              groups={pendingGroups}
              allCols={[]}
              onChange={setPendingConditions}
              onChangeGroups={setPendingGroups}
              onReset={() => { setPendingConditions([]); setPendingGroups([]); }}
              onSave={() => {
                setConditions(pendingConditions);
                setGroups(pendingGroups);
                setCfg('filterConditions', pendingConditions);
                setCfg('filterGroups', pendingGroups);
                setCfg('filters', conditionsToFilters(pendingConditions));
                setFilterOpen(false);
              }}
              renderValue={formulaParams?.length
                ? (val, onChg) => (
                    <BoundField
                      label=""
                      value={val}
                      onChange={onChg}
                      workflowTrigger={workflowTrigger}
                      serverContext
                      formulaParams={formulaParams}
                      paramsInQuick
                      anchorRight={292}
                    />
                  )
                : undefined}
            />
          </FloatingAnchor>
        </div>
      )}

      <CollapsibleSection title="Data" status="Optional">
        <BoundField
          label="Data"
          value={cfg.data as FormulaValue | undefined}
          onChange={v => setCfg('data', v)}
          placeholder="Fields to update as object"
          workflowTrigger={workflowTrigger}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Options" status="Optional">
        <label style={SL}>Return Updated Data</label>
        <OnOffToggle value={(cfg.returnData as boolean) ?? false} onChange={v => setCfg('returnData', v)} />
      </CollapsibleSection>
    </>
  );
}

// ─── TablesDeleteConfig ───────────────────────────────────────────────────────

function TablesDeleteConfig({
  cfg, setCfg, projectId, workflowTrigger, formulaParams,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void;
  projectId?: string; workflowTrigger?: string;
  formulaParams?: GlobalFormulaParam[];
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [conditions, setConditions] = useState<FilterCondition[]>(() => initConditions(cfg));
  const [groups, setGroups] = useState<FilterGroup[]>((cfg.filterGroups as FilterGroup[]) ?? []);
  const [pendingConditions, setPendingConditions] = useState<FilterCondition[]>([]);
  const [pendingGroups, setPendingGroups] = useState<FilterGroup[]>([]);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const deleteMode = (cfg.deleteMode as string) ?? 'byId';

  return (
    <>
      <label style={SL}>Table *</label>
      <TablePicker projectId={projectId ?? ''} value={(cfg.table as string) ?? ''} onChange={v => setCfg('table', v)} />

      <label style={SL}>Delete mode</label>
      <div style={S.toggleGroup}>
        <button style={S.toggleBtn(deleteMode === 'byId')} onClick={() => setCfg('deleteMode', 'byId')}>By ID</button>
        <button style={S.toggleBtn(deleteMode === 'byFilters')} onClick={() => setCfg('deleteMode', 'byFilters')}>By Filters</button>
      </div>

      {deleteMode === 'byId' && (
        <BoundField
          label="Row ID *"
          required
          value={cfg.rowId as FormulaValue | undefined}
          onChange={v => setCfg('rowId', v)}
          placeholder="Enter the ID of the record to delete"
          workflowTrigger={workflowTrigger}
        />
      )}

      {deleteMode === 'byFilters' && (
        <div style={{ marginTop: 8 }}>
          <button
            ref={filterBtnRef}
            onClick={() => { setPendingConditions([...conditions]); setPendingGroups([...groups]); setFilterOpen(o => !o); }}
            style={{ ...S.toggleBtn(conditions.length > 0 || groups.length > 0), width: '100%', justifyContent: 'flex-start' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg> Configure Filter * (required)
          </button>
          <FloatingAnchor open={filterOpen} anchorRef={filterBtnRef} minWidth={560}>
            <FilterPanel
              conditions={pendingConditions}
              groups={pendingGroups}
              allCols={[]}
              onChange={setPendingConditions}
              onChangeGroups={setPendingGroups}
              onReset={() => { setPendingConditions([]); setPendingGroups([]); }}
              onSave={() => {
                setConditions(pendingConditions);
                setGroups(pendingGroups);
                setCfg('filterConditions', pendingConditions);
                setCfg('filterGroups', pendingGroups);
                setCfg('filters', conditionsToFilters(pendingConditions));
                setFilterOpen(false);
              }}
              renderValue={formulaParams?.length
                ? (val, onChg) => (
                    <BoundField
                      label=""
                      value={val}
                      onChange={onChg}
                      workflowTrigger={workflowTrigger}
                      serverContext
                      formulaParams={formulaParams}
                      paramsInQuick
                      anchorRight={292}
                    />
                  )
                : undefined}
            />
          </FloatingAnchor>
        </div>
      )}

      <CollapsibleSection title="Options" status="Optional">
        <label style={SL}>Return Deleted Data</label>
        <OnOffToggle value={(cfg.returnData as boolean) ?? false} onChange={v => setCfg('returnData', v)} />
      </CollapsibleSection>
    </>
  );
}

// ─── ExecuteSQLConfig ─────────────────────────────────────────────────────────

function ExecuteSQLConfig({
  cfg, setCfg, workflowTrigger,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void; workflowTrigger?: string;
}) {
  // Accept both cfg.sql (primary) and cfg.query (legacy) — keep both in sync on change.
  const sqlValue = (cfg.sql ?? cfg.query) as FormulaValue | undefined;
  return (
    <BoundField
      label="SQL Query *"
      required
      value={sqlValue}
      onChange={v => { setCfg('sql', v); setCfg('query', v); }}
      placeholder="SELECT * FROM ..."
      multiline
      workflowTrigger={workflowTrigger}
    />
  );
}

// ─── HashPasswordConfig ───────────────────────────────────────────────────────

function HashPasswordConfig({
  cfg, setCfg,
}: { cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void }) {
  return (
    <>
      <BoundField
        label="Password *"
        required
        value={cfg.password as FormulaValue | undefined}
        onChange={v => setCfg('password', v)}
        placeholder="Plain-text password to hash"
      />
      <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(124,58,237,0.08)', borderRadius: 6, fontSize: 11, color: 'var(--bld-accent)' }}>
        Result: <code style={{ color: 'var(--bld-accent)' }}>result.hash</code> — bcrypt hash (cost 10)
      </div>
    </>
  );
}

// ─── VerifyPasswordConfig ─────────────────────────────────────────────────────

function VerifyPasswordConfig({
  cfg, setCfg,
}: { cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void }) {
  return (
    <>
      <BoundField
        label="Password *"
        required
        value={cfg.password as FormulaValue | undefined}
        onChange={v => setCfg('password', v)}
        placeholder="Plain-text password to verify"
      />
      <BoundField
        label="Hash *"
        required
        value={cfg.hash as FormulaValue | undefined}
        onChange={v => setCfg('hash', v)}
        placeholder="Stored bcrypt hash to compare against"
      />
      <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(124,58,237,0.08)', borderRadius: 6, fontSize: 11, color: 'var(--bld-accent)' }}>
        Result: <code style={{ color: 'var(--bld-accent)' }}>result.match</code> — boolean
      </div>
    </>
  );
}

// ─── GenerateTokenConfig ──────────────────────────────────────────────────────

function GenerateTokenConfig({
  cfg, setCfg,
}: { cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void }) {
  return (
    <>
      <BoundField
        label="Payload *"
        required
        value={cfg.payload as FormulaValue | undefined}
        onChange={v => setCfg('payload', v)}
        placeholder='e.g. { userId: ..., role: "admin" }'
      />
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: 'var(--bld-text-3)', display: 'block', marginBottom: 4 }}>Expires in</label>
        <input
          style={{ width: '100%', background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6, padding: '5px 8px', fontSize: 12, color: 'var(--bld-text-2)', outline: 'none', boxSizing: 'border-box' }}
          value={(cfg.expiresIn as string | undefined) ?? '7d'}
          onChange={e => setCfg('expiresIn', e.target.value)}
          placeholder="7d, 1h, 30m …"
        />
      </div>
      <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(124,58,237,0.08)', borderRadius: 6, fontSize: 11, color: 'var(--bld-accent)' }}>
        Result: <code style={{ color: 'var(--bld-accent)' }}>result.token</code> — signed JWT<br />
        All payload fields are also echoed on the result (e.g. <code style={{ color: 'var(--bld-accent)' }}>result.userId</code>)
      </div>
    </>
  );
}

// ─── VerifyTokenConfig ────────────────────────────────────────────────────────

function VerifyTokenConfig({
  cfg, setCfg,
}: { cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void }) {
  return (
    <>
      <BoundField
        label="Token *"
        required
        value={cfg.token as FormulaValue | undefined}
        onChange={v => setCfg('token', v)}
        placeholder="JWT to verify (e.g. from Authorization header)"
      />
      <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(124,58,237,0.08)', borderRadius: 6, fontSize: 11, color: 'var(--bld-accent)' }}>
        Result: full decoded payload (all fields you put in <code style={{ color: 'var(--bld-accent)' }}>generateToken</code>)<br />
        e.g. <code style={{ color: 'var(--bld-accent)' }}>result.userId</code>, <code style={{ color: 'var(--bld-accent)' }}>result.role</code>, …<br />
        <span style={{ color: 'var(--bld-accent)' }}>result.valid</span> — always <code>true</code>; throws 401 on invalid/expired
      </div>
    </>
  );
}

// ─── SendResponseConfig ───────────────────────────────────────────────────────

const HTTP_STATUS_OPTIONS = [
  { value: '200', label: '200 - OK' },
  { value: '201', label: '201 - Created' },
  { value: '204', label: '204 - No Content' },
  { value: '400', label: '400 - Bad Request' },
  { value: '401', label: '401 - Unauthorized' },
  { value: '403', label: '403 - Forbidden' },
  { value: '404', label: '404 - Not Found' },
  { value: '418', label: "418 - I'm a teapot" },
  { value: '422', label: '422 - Unprocessable Entity' },
  { value: '500', label: '500 - Internal Server Error' },
];

const BODY_TYPES = ['JSON', 'Plain Text', 'HTML', 'XML', 'CSV'];

function SendResponseConfig({
  cfg, setCfg, isServerContext,
}: {
  cfg: Record<string, unknown>;
  setCfg: (k: string, v: unknown) => void;
  workflowTrigger?: string;
  isServerContext?: boolean;
  priorSteps?: ActionStep[];
}) {
  return (
    <>
      <label style={SL}>Status *</label>
      <select
        style={{ ...S.fieldInput, marginTop: 4, cursor: 'pointer', borderColor: !cfg.status ? 'var(--bld-error)' : 'var(--bld-border-subtle)' }}
        value={(cfg.status as string) ?? ''}
        onChange={e => setCfg('status', e.target.value)}
      >
        <option value="">Select status…</option>
        {HTTP_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {!cfg.status && <span style={{ fontSize: 11, color: 'var(--bld-error)' }}>This field is required</span>}

      <CollapsibleSection title="Data" status={cfg.bodyType ? 'Optional' : 'Incomplete'} defaultOpen>
        <label style={SL}>Type *</label>
        <select
          style={{ ...S.fieldInput, marginTop: 4, cursor: 'pointer', borderColor: !cfg.bodyType ? 'var(--bld-error)' : 'var(--bld-border-subtle)' }}
          value={(cfg.bodyType as string) ?? ''}
          onChange={e => setCfg('bodyType', e.target.value)}
        >
          <option value="">Select type…</option>
          {BODY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {!cfg.bodyType && <span style={{ fontSize: 11, color: 'var(--bld-error)' }}>This field is required</span>}

        <BoundField
          label="Body"
          value={cfg.body as FormulaValue | undefined}
          onChange={v => setCfg('body', v)}
          anchorRight={292}
          serverContext={isServerContext}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Headers" status="Optional">
        <KeyValueBuilderField
          value={(cfg.headers as Record<string, unknown>) ?? {}}
          onChange={v => setCfg('headers', v)}
        />
      </CollapsibleSection>
    </>
  );
}

// ─── SendStreamingResponseConfig ─────────────────────────────────────────────

function SendStreamingResponseConfig({
  cfg, setCfg, workflowTrigger,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void; workflowTrigger?: string;
}) {
  return (
    <KeyValueBuilderField
      label="Event Data"
      value={(cfg.eventData as Record<string, unknown>) ?? {}}
      onChange={v => setCfg('eventData', v)}
    />
  );
}

// ─── ThrowErrorConfig ─────────────────────────────────────────────────────────

function ThrowErrorConfig({
  cfg, setCfg, workflowTrigger,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void; workflowTrigger?: string;
}) {
  return (
    <>
      <BoundField
        label="Message"
        value={cfg.message as FormulaValue | undefined}
        onChange={v => setCfg('message', v)}
        placeholder="Error message"
        workflowTrigger={workflowTrigger}
      />
      <BoundField
        label="Cause"
        value={cfg.cause as FormulaValue | undefined}
        onChange={v => setCfg('cause', v)}
        placeholder="Error cause (optional)"
        workflowTrigger={workflowTrigger}
      />
    </>
  );
}

// ─── TryCatchConfig ───────────────────────────────────────────────────────────

function TryCatchConfig({
  step, onUpdate,
}: {
  step: ActionStep; onUpdate: (patch: Partial<ActionStep>) => void;
}) {
  const cfg = step.config ?? {};
  const catchEnabled = (cfg.catchEnabled as boolean) !== false;
  const finallyEnabled = (cfg.finallyEnabled as boolean) === true;

  const updateCfg = (key: string, v: unknown) => onUpdate({ config: { ...cfg, [key]: v } });

  return (
    <>
      <label style={SL}>Catch branch</label>
      <OnOffToggle value={catchEnabled} onChange={v => updateCfg('catchEnabled', v)} />
      <label style={SL}>Finally branch</label>
      <OnOffToggle value={finallyEnabled} onChange={v => updateCfg('finallyEnabled', v)} />
    </>
  );
}

// ─── CreateWorkflowVariableConfig ─────────────────────────────────────────────

function CreateWorkflowVariableConfig({
  cfg, setCfg, workflowTrigger,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void; workflowTrigger?: string;
}) {
  return (
    <>
      <label style={SL}>Variable name *</label>
      <input
        style={{ ...S.fieldInput, marginTop: 4, borderColor: !cfg.variableName ? 'var(--bld-error)' : 'var(--bld-border-subtle)' }}
        value={(cfg.variableName as string) ?? ''}
        placeholder="myVariable"
        onChange={e => setCfg('variableName', e.target.value)}
      />
      {!cfg.variableName && <span style={{ fontSize: 11, color: 'var(--bld-error)' }}>This field is required</span>}
      <label style={SL}>Type *</label>
      <select
        style={{ ...S.fieldInput, marginTop: 4, cursor: 'pointer', borderColor: !cfg.variableType ? 'var(--bld-error)' : 'var(--bld-border-subtle)' }}
        value={(cfg.variableType as string) ?? ''}
        onChange={e => setCfg('variableType', e.target.value)}
      >
        <option value="">Select type…</option>
        {['String', 'Number', 'Boolean', 'Object', 'Array'].map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <BoundField
        label="Initial value"
        value={cfg.initialValue as FormulaValue | undefined}
        onChange={v => setCfg('initialValue', v)}
        placeholder="Enter a value"
        workflowTrigger={workflowTrigger}
      />
    </>
  );
}

// ─── WorkflowResultConfig ─────────────────────────────────────────────────────

function WorkflowResultConfig({
  cfg, setCfg, workflowTrigger,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void; workflowTrigger?: string;
}) {
  const resultType = (cfg.resultType as string) ?? 'Object';
  return (
    <>
      <label style={SL}>Type</label>
      <select
        style={{ ...S.fieldInput, marginTop: 4, cursor: 'pointer' }}
        value={resultType}
        onChange={e => setCfg('resultType', e.target.value)}
      >
        {['Object', 'String', 'Number', 'Boolean', 'Array'].map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {resultType === 'Object' ? (
        <KeyValueBuilderField
          label="Result"
          value={(cfg.result as Record<string, unknown>) ?? {}}
          onChange={v => setCfg('result', v)}
        />
      ) : (
        <BoundField
          label="Result"
          value={cfg.result as FormulaValue | undefined}
          onChange={v => setCfg('result', v)}
          placeholder="Return value"
          workflowTrigger={workflowTrigger}
        />
      )}
    </>
  );
}

// ─── RunServerFunctionConfig ──────────────────────────────────────────────────

function RunServerFunctionConfig({
  cfg, setCfg, workflowTrigger, serverFunctions = [],
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void;
  workflowTrigger?: string; serverFunctions?: { id: string; name: string }[];
}) {
  return (
    <>
      <label style={SL}>Function *</label>
      <select
        style={{ ...S.fieldInput, marginTop: 4, cursor: 'pointer', borderColor: !cfg.functionId ? 'var(--bld-error)' : 'var(--bld-border-subtle)' }}
        value={(cfg.functionId as string) ?? ''}
        onChange={e => setCfg('functionId', e.target.value)}
      >
        <option value="">Select a function…</option>
        {serverFunctions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {!cfg.functionId && <span style={{ fontSize: 11, color: 'var(--bld-error)' }}>This field is required</span>}
    </>
  );
}

// ─── RunFormulaConfig (stub) ──────────────────────────────────────────────────

function RunFormulaConfig({
  cfg, setCfg, workflowTrigger,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void; workflowTrigger?: string;
}) {
  return (
    <BoundField
      label="Formula"
      value={cfg.formula as FormulaValue | undefined}
      onChange={v => setCfg('formula', v)}
      placeholder="Enter formula expression"
      workflowTrigger={workflowTrigger}
    />
  );
}

// ─── ServerFetchDataConfig (HTTP Request for server context) ──────────────────

const SERVER_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const RETRY_TYPES = ['Linear', 'Exponential'];

function ServerFetchDataConfig({
  cfg, setCfg, workflowTrigger,
}: {
  cfg: Record<string, unknown>; setCfg: (k: string, v: unknown) => void; workflowTrigger?: string;
}) {
  const authType = (cfg.authType as string) ?? 'None';
  return (
    <>
      <label style={SL}>Method</label>
      <select
        style={{ ...S.fieldInput, marginTop: 4, cursor: 'pointer' }}
        value={(cfg.method as string) ?? 'GET'}
        onChange={e => setCfg('method', e.target.value)}
      >
        {SERVER_HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
      </select>

      <BoundField
        label="URL *"
        required
        value={cfg.url as FormulaValue | undefined}
        onChange={v => setCfg('url', v)}
        placeholder="https://example.com/api/endpoint"
        workflowTrigger={workflowTrigger}
      />

      <CollapsibleSection title="Data" status="Optional">
        <KeyValueBuilderField
          label="Query Parameters"
          value={(cfg.queryParams as Record<string, unknown>) ?? {}}
          onChange={v => setCfg('queryParams', v)}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Authentication" status="Optional">
        <label style={SL}>Type</label>
        <div style={S.toggleGroup}>
          {['None', 'Basic', 'Bearer'].map(t => (
            <button key={t} style={S.toggleBtn(authType === t)} onClick={() => setCfg('authType', t)}>{t}</button>
          ))}
        </div>
        {authType === 'Basic' && (
          <>
            <BoundField label="Username" value={cfg.authUsername as FormulaValue | undefined} onChange={v => setCfg('authUsername', v)} placeholder="Username" workflowTrigger={workflowTrigger} />
            <BoundField label="Password" value={cfg.authPassword as FormulaValue | undefined} onChange={v => setCfg('authPassword', v)} placeholder="Password" workflowTrigger={workflowTrigger} />
          </>
        )}
        {authType === 'Bearer' && (
          <BoundField label="Token" value={cfg.authToken as FormulaValue | undefined} onChange={v => setCfg('authToken', v)} placeholder="Bearer token" workflowTrigger={workflowTrigger} />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Headers" status="Optional">
        <KeyValueBuilderField
          value={(cfg.headers as Record<string, unknown>) ?? {}}
          onChange={v => setCfg('headers', v)}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Retry Configuration" status="Optional">
        <label style={SL}>Max Attempts</label>
        <input style={{ ...S.fieldInput, marginTop: 4 }} type="number" value={(cfg.retryMaxAttempts as number) ?? ''} placeholder="e.g. 0" onChange={e => setCfg('retryMaxAttempts', e.target.valueAsNumber)} />
        <label style={SL}>Retry Type</label>
        <select style={{ ...S.fieldInput, marginTop: 4, cursor: 'pointer' }} value={(cfg.retryType as string) ?? 'Linear'} onChange={e => setCfg('retryType', e.target.value)}>
          {RETRY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label style={SL}>Delay (ms)</label>
        <input style={{ ...S.fieldInput, marginTop: 4 }} type="number" value={(cfg.retryDelay as number) ?? ''} placeholder="1000" onChange={e => setCfg('retryDelay', e.target.valueAsNumber)} />
      </CollapsibleSection>

      <CollapsibleSection title="Advanced Options" status="Optional">
        <label style={SL}>Throw on Error</label>
        <OnOffToggle value={(cfg.throwOnError as boolean) ?? false} onChange={v => setCfg('throwOnError', v)} />
        <label style={SL}>Timeout (ms)</label>
        <input style={{ ...S.fieldInput, marginTop: 4 }} type="number" value={(cfg.timeout as number) ?? ''} placeholder="30000" onChange={e => setCfg('timeout', e.target.valueAsNumber)} />
      </CollapsibleSection>
    </>
  );
}

// ─── NodePropsPanel ────────────────────────────────────────────────────────────

export function NodePropsPanel({
  step,
  onUpdate,
  isFormContext = false,
  workflowTrigger,
  componentTriggers,
  isServerContext = false,
  projectId,
  serverFunctions = [],
  priorSteps = [],
  formulaParams = [],
}: {
  step: ActionStep;
  onUpdate: (patch: Partial<ActionStep>) => void;
  isFormContext?: boolean;
  workflowTrigger?: string;
  componentTriggers?: Array<{ id: string; name: string }>;
  /** True when the canvas is in server workflow context */
  isServerContext?: boolean;
  /** Project ID for server-context table pickers */
  projectId?: string;
  /** Available FUNCTION-kind workflows for runServerFunction picker */
  serverFunctions?: { id: string; name: string }[];
  /** Steps that appear before this one — used for server-side output binding */
  priorSteps?: ActionStep[];
  /** Declared workflow parameters (for server workflows) — enables formula bind in filter rows. */
  formulaParams?: GlobalFormulaParam[];
}) {
  const cfg = step.config ?? {};

  function setCfg(key: string, value: unknown) {
    onUpdate({ config: { ...cfg, [key]: value } });
  }

  function setCfgBatch(updates: Record<string, unknown>) {
    onUpdate({ config: { ...cfg, ...updates } });
  }

  const isStructuralNode = isStructural(step.type);

  return (
    <WorkflowParamsProvider params={formulaParams} isServerContext={isServerContext}>
    <div>
      <label style={S.fieldLabel}>Name</label>
      <input
        style={S.fieldInput}
        value={step.name ?? ''}
        placeholder="Action"
        onChange={e => onUpdate({ name: e.target.value })}
      />

      {/* Type dropdown — shown for action-type nodes, NOT for structural nodes, NOT for pass-through */}
      {!isStructuralNode && step.type !== 'passThroughCondition' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Type</label>
          <TypeSearchDropdown
            value={step.type}
            onChange={type => onUpdate({ type })}
            isFormContext={isFormContext}
          />
        </>
      )}

      {/* runProjectWorkflow: workflow picker using WorkflowBindButton + param inputs */}
      {step.type === 'runProjectWorkflow' && (
        <RunProjectWorkflowConfig
          step={step}
          onUpdate={onUpdate}
          workflowTrigger={workflowTrigger}
        />
      )}

      {/* runJavaScript: opens full FormulaEditor locked to JavaScript mode */}
      {step.type === 'runJavaScript' && (
        <RunJavaScriptConfig step={step} onUpdate={onUpdate} workflowTrigger={workflowTrigger} />
      )}

      {/* Type-specific fields */}
      {step.type === 'branch' && (
        <BranchConditionField cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}

      {step.type === 'multiOptionBranch' && (
        <>
          {/* Branches list */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-2)' }}>Branches</span>
            <button
              data-testid="branches-add-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--bld-accent-fg)', background: 'var(--bld-accent)', border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}
              onClick={() => {
                const newBranch: BranchDef = { match: `Value ${(step.branches?.length ?? 0) + 1}`, steps: [{ id: `ph-${Date.now()}`, type: 'graphql' }] };
                onUpdate({ branches: [...(step.branches ?? []), newBranch] });
              }}
            >
              + Add
            </button>
          </div>
          {(step.branches ?? []).map((branch, bi) => (
            <div key={bi} style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {/* Line-number gutter */}
                <div style={{ minWidth: 20, fontSize: 11, color: 'var(--bld-text-disabled)', textAlign: 'right', flexShrink: 0 }}>
                  {bi + 1}
                </div>
                {/* Value input */}
                <input
                  data-testid={`branch-value-${bi}`}
                  style={{ ...S.fieldInput, flex: 1, color: 'var(--bld-text-2)' }}
                  value={branch.match}
                  onChange={e => {
                    const updated = (step.branches ?? []).map((b, i) => i === bi ? { ...b, match: e.target.value } : b);
                    onUpdate({ branches: updated });
                  }}
                />
                {/* Remove button — disabled when only 1 branch remains */}
                <button
                  data-testid={`branch-remove-${bi}`}
                  disabled={(step.branches?.length ?? 0) <= 1}
                  style={{ flexShrink: 0, background: 'rgba(219,39,119,0.15)', border: 'none', borderRadius: '50%', width: 22, height: 22, color: '#db2777', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, cursor: (step.branches?.length ?? 0) <= 1 ? 'not-allowed' : 'pointer', opacity: (step.branches?.length ?? 0) <= 1 ? 0.35 : 1 }}
                  title="Remove branch"
                  onClick={() => {
                    const updated = (step.branches ?? []).filter((_, i) => i !== bi);
                    onUpdate({ branches: updated });
                  }}
                >
                  −
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {step.type === 'forEach' && (
        <>
          <BoundField
            label="Items to parse (array)"
            required
            value={(() => {
              // cfg.items is the canonical field set by this editor (FormulaValue)
              if (cfg.items !== undefined) return cfg.items as FormulaValue;
              // cfg.list: inline array literal — serialize to JSON string for CodeMirror display
              if (Array.isArray(cfg.list)) return JSON.stringify(cfg.list) as FormulaValue;
              // Legacy: itemsPath / listPath store a variable UUID as a plain string.
              // Wrap as a formula binding so the field shows "ƒ Edit formula" (not raw UUID).
              const legacyId = (cfg.itemsPath ?? cfg.listPath) as string | undefined;
              if (legacyId) return { formula: `variables['${legacyId}']` } as FormulaValue;
              return undefined;
            })()}
            onChange={v => setCfg('items', v)}
            placeholder="e.g. collections['UUID'].data.items"
            code
            expectedType="array"
            workflowTrigger={workflowTrigger}
          />
          <div style={S.helpText}>
            Expression that evaluates to an array. Each element is accessible inside the loop as{' '}
            <code style={{ background: 'var(--bld-bg-input)', padding: '1px 4px', borderRadius: 3 }}>context.item.data.value</code>
            {' '}and the index as{' '}
            <code style={{ background: 'var(--bld-bg-input)', padding: '1px 4px', borderRadius: 3 }}>context.item.data.index</code>.
          </div>
        </>
      )}

      {step.type === 'whileLoop' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition to check (boolean) *</label>
          <select style={S.fieldSelect} value={(cfg.condition as string) ?? 'false'}
            onChange={e => setCfg('condition', e.target.value)}>
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
          <div style={S.helpText}>
            The condition is evaluated before each iteration, if it is true, the actions inside the loop are executed. If the condition is false, the loop is exited, and the program continues with the next actions
          </div>
        </>
      )}

      {step.type === 'breakLoop' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition to check (boolean) *</label>
          <select style={S.fieldSelect} value={(cfg.condition as string) ?? 'false'}
            onChange={e => setCfg('condition', e.target.value)}>
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
          <div style={S.helpText}>
            This action needs to be inside a loop (Iterator for loop or while loop), the loop is immediately terminated, and the workflow jumps to the next action
          </div>
        </>
      )}

      {step.type === 'continueLoop' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition to check (boolean) *</label>
          <select style={S.fieldSelect} value={(cfg.condition as string) ?? 'false'}
            onChange={e => setCfg('condition', e.target.value)}>
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
          <div style={S.helpText}>
            This action needs to be inside a loop (Iterator for loop or while loop), the remaining actions in the loop, for the current iteration, are skipped. The workflow then proceeds to the next iteration of the loop, re-evaluating the loop condition
          </div>
        </>
      )}

      {step.type === 'passThroughCondition' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition *</label>
          <select style={S.fieldSelect} value={(cfg.condition as string) ?? 'true'}
            onChange={e => setCfg('condition', e.target.value)}>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </>
      )}

      {step.type === 'navigateTo' && (
        <NavigateToConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'navigatePrev' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Default Redirect Page</label>
          <PagePickerDropdown
            value={(cfg.defaultPath as string) ?? ''}
            onChange={v => setCfg('defaultPath', v)}
          />
        </>
      )}

      {step.type === 'changeVariableValue' && (
        <ChangeVariableValueConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}

      {step.type === 'resetVariableValue' && (
        <ResetVariableValueConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'fetchCollection' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Collection *</label>
          <CollectionPickerDropdown
            value={(cfg.collectionId as string) ?? (cfg.collectionName as string) ?? ''}
            onChange={v => {
              setCfgBatch({ collectionId: v, collectionName: undefined });
            }}
          />
        </>
      )}

      {step.type === 'fetchCollectionsParallel' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ ...S.fieldLabel, marginTop: 0 }}>Collections</span>
            <button
              style={{ fontSize: 11, color: 'var(--bld-accent)', background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => {
                // Use cfg.collections (new format) or fall back to cfg.collectionNames (old format)
                const prev = Array.isArray(cfg.collections)
                  ? (cfg.collections as string[])
                  : Array.isArray(cfg.collectionNames) ? (cfg.collectionNames as string[]) : [];
                setCfg('collections', [...prev, '']);
                setCfg('collectionNames', undefined);
              }}
            >+ Add</button>
          </div>
          {(Array.isArray(cfg.collections)
            ? (cfg.collections as string[])
            : Array.isArray(cfg.collectionNames) ? (cfg.collectionNames as string[]) : []
          ).map((colId, idx) => {
            const currentList = Array.isArray(cfg.collections)
              ? (cfg.collections as string[])
              : Array.isArray(cfg.collectionNames) ? (cfg.collectionNames as string[]) : [];
            return (
              <div key={idx} style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <CollectionPickerDropdown
                    value={colId}
                    onChange={v => {
                      const next = [...currentList];
                      next[idx] = v;
                      setCfg('collections', next);
                      setCfg('collectionNames', undefined);
                    }}
                  />
                </div>
                <button
                  style={{ background: 'none', border: 'none', color: 'var(--bld-error)', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}
                  onClick={() => {
                    const next = currentList.filter((_, i) => i !== idx);
                    setCfg('collections', next);
                    setCfg('collectionNames', undefined);
                  }}
                >−</button>
              </div>
            );
          })}
          {!((Array.isArray(cfg.collections) && (cfg.collections as string[]).length > 0) ||
             (Array.isArray(cfg.collectionNames) && (cfg.collectionNames as string[]).length > 0)) && (
            <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', marginTop: 6 }}>No collections added yet</div>
          )}
        </>
      )}

      {step.type === 'updateCollection' && (() => {
        // Normalize legacy "replace" value to "replaceAll"
        const rawUpdateType = (cfg.updateType as string) ?? '';
        const updateType = rawUpdateType === 'replace' ? 'replaceAll' : rawUpdateType || 'replaceAll';
        const byId = (cfg.findBy as string) === 'id';
        const needsFindBy = updateType === 'update' || updateType === 'delete';
        // Insert always uses position (no By index/By id toggle); update/delete use it only when By index
        const needsPosition = updateType === 'insert' || (!byId && (updateType === 'update' || updateType === 'delete'));
        const needsIdFields = byId && needsFindBy;
        const needsMerge = updateType === 'update';
        const needsData = updateType !== 'delete';
        // data is required only for insert/update; replaceAll treats it as optional (triggers refetch when absent)
        const dataRequired = updateType === 'insert' || updateType === 'update';
        const dataPlaceholder = updateType === 'insert' ? 'Data to insert' : updateType === 'update' ? 'Data to update' : 'New collection data (optional)';

        return (
          <>
            <label style={{ ...S.fieldLabel, marginTop: 10 }}>Collection *</label>
            <CollectionPickerDropdown
              value={(cfg.collectionId as string) ?? (cfg.collectionName as string) ?? (cfg.name as string) ?? ''}
              onChange={v => {
                setCfgBatch({ collectionId: v, collectionName: undefined, name: undefined });
              }}
            />

            <label style={{ ...S.fieldLabel, marginTop: 10 }}>Update type</label>
            <OptionPickerDropdown
              value={updateType}
              onChange={v => {
                setCfg('updateType', v);
                // If legacy "replace" was stored, normalize it now
                if (rawUpdateType === 'replace') setCfg('updateType', v);
              }}
              options={[
                { value: 'replaceAll', label: 'Replace all' },
                { value: 'update', label: 'Update' },
                { value: 'insert', label: 'Insert' },
                { value: 'delete', label: 'Delete' },
              ]}
            />

            {/* By index / By id sub-toggle for Update and Delete */}
            {needsFindBy && (
              <div style={{ display: 'flex', background: 'var(--bld-bg-input)', borderRadius: 4, padding: 2, gap: 2, marginTop: 10 }}>
                <button
                  style={{ flex: 1, padding: '4px 0', fontSize: 11, border: 'none', cursor: 'pointer', borderRadius: 3, fontWeight: 500,
                    background: !byId ? 'var(--bld-border-subtle)' : 'transparent', color: !byId ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}
                  onClick={() => setCfg('findBy', 'index')}
                >By index</button>
                <button
                  style={{ flex: 1, padding: '4px 0', fontSize: 11, border: 'none', cursor: 'pointer', borderRadius: 3, fontWeight: 500,
                    background: byId ? 'var(--bld-border-subtle)' : 'transparent', color: byId ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)' }}
                  onClick={() => setCfg('findBy', 'id')}
                >By id</button>
              </div>
            )}

            {/* Position (index) */}
            {needsPosition && (
              <BoundField
                label="Position (index)"
                numeric
                value={cfg.position as FormulaValue | undefined}
                onChange={v => setCfg('position', v)}
                placeholder="0"
                workflowTrigger={workflowTrigger}
                expectedType={'number' as const}
              />
            )}

            {/* ID key + ID value */}
            {needsIdFields && (
              <>
                <BoundField
                  label="ID key"
                  value={cfg.idKey as FormulaValue | undefined}
                  onChange={v => setCfg('idKey', v)}
                  placeholder="id"
                  workflowTrigger={workflowTrigger}
                />
                <BoundField
                  label="ID value"
                  value={cfg.idValue as FormulaValue | undefined}
                  onChange={v => setCfg('idValue', v)}
                  placeholder="123"
                  workflowTrigger={workflowTrigger}
                />
              </>
            )}

            {/* Merge toggle (Update only) */}
            {needsMerge && (
              <BoundToggleField
                label="Merge"
                value={cfg.merge as FormulaValue | undefined}
                onChange={v => setCfg('merge', v)}
                workflowTrigger={workflowTrigger}
              />
            )}

            {/* Data field (not for Delete) */}
            {needsData && (
              <BoundField
                label="Data"
                required={dataRequired}
                value={cfg.data as FormulaValue | undefined}
                onChange={v => setCfg('data', v)}
                placeholder={dataPlaceholder}
                code
                expectedType="object"
                workflowTrigger={workflowTrigger}
              />
            )}

            {/* Refresh filters */}
            <BoundToggleField
              label="Refresh filters"
              value={cfg.refreshFilters as FormulaValue | undefined}
              onChange={v => setCfg('refreshFilters', v)}
              workflowTrigger={workflowTrigger}
            />

            {/* Refresh sort */}
            <BoundToggleField
              label="Refresh sort"
              value={cfg.refreshSort as FormulaValue | undefined}
              onChange={v => setCfg('refreshSort', v)}
              workflowTrigger={workflowTrigger}
            />
          </>
        );
      })()}

      {step.type === 'executeComponentAction' && (
        <ExecuteComponentActionConfig
          cfg={cfg}
          onUpdate={patch => onUpdate({ config: patch })}
          workflowTrigger={workflowTrigger}
        />
      )}

      {step.type === 'emitComponentTrigger' && (
        <EmitComponentTriggerConfig
          cfg={cfg}
          onUpdate={patch => onUpdate({ config: patch })}
          workflowTrigger={workflowTrigger}
          componentTriggers={componentTriggers ?? []}
        />
      )}

      {step.type === 'returnValue' && (() => {
        const valueType = (cfg.valueType as string) ?? 'text';
        return (
          <>
            <label style={{ ...S.fieldLabel, marginTop: 10 }}>Type</label>
            <OptionPickerDropdown
              value={valueType}
              onChange={v => setCfg('valueType', v)}
              options={[
                { value: 'text',    label: 'Text' },
                { value: 'number',  label: 'Number' },
                { value: 'boolean', label: 'Boolean' },
                { value: 'object',  label: 'Object' },
                { value: 'array',   label: 'Array' },
              ]}
            />

            {valueType === 'boolean' ? (
              <BoundToggleField
                label="Value"
                value={cfg.value as FormulaValue | undefined}
                onChange={v => setCfg('value', v)}
                workflowTrigger={workflowTrigger}
              />
            ) : (
              <BoundField
                label="Value"
                required
                value={cfg.value as FormulaValue | undefined}
                onChange={v => setCfg('value', v)}
                placeholder={
                  valueType === 'number'  ? '0' :
                  valueType === 'object'  ? '{\n  "key": "value"\n}' :
                  valueType === 'array'   ? '[\n  \n]' :
                  'Enter a value'
                }
                code={valueType === 'object' || valueType === 'array'}
                numeric={valueType === 'number'}
                workflowTrigger={workflowTrigger}
                expectedType={valueType === 'number' ? 'number' : 'string'}
              />
            )}
          </>
        );
      })()}

      {step.type === 'timeDelay' && (
        <BoundField
          label="Time (ms)"
          required
          numeric
          value={(cfg.time ?? cfg.delay ?? cfg.ms) as FormulaValue | undefined}
          onChange={v => {
            setCfg('time', v);
            // Clear legacy field names on edit
            if (cfg.delay !== undefined) setCfg('delay', undefined);
            if (cfg.ms !== undefined) setCfg('ms', undefined);
          }}
          placeholder="1000"
          workflowTrigger={workflowTrigger}
          expectedType="number"
        />
      )}

      {step.type === 'pickFile' && (
        <PickFileConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}

      {step.type === 'stopPropagation' && (
        <div style={S.infoBox}>
          This action is executing Event.stopPropagation() and Event.preventDefault(). The recommended practice is to set this action as the first action of your workflow.
        </div>
      )}

      {step.type === 'copyToClipboard' && (
        <BoundField
          label="Value"
          required
          value={cfg.value as FormulaValue | undefined}
          onChange={v => setCfg('value', v)}
          placeholder="Enter a value"
          workflowTrigger={workflowTrigger}
        />
      )}

      {step.type === 'downloadFileFromUrl' && (
        <>
          <BoundField
            label="File URL"
            required
            value={cfg.url as FormulaValue | undefined}
            onChange={v => setCfg('url', v)}
            placeholder="https://example.com/file.pdf"
            workflowTrigger={workflowTrigger}
          />
          <BoundField
            label="File name"
            value={cfg.filename as FormulaValue | undefined}
            onChange={v => setCfg('filename', v)}
            placeholder="Optional filename"
            workflowTrigger={workflowTrigger}
          />
        </>
      )}

      {step.type === 'createUrlFromBase64' && (
        <BoundField
          label="Base64"
          value={cfg.base64 as FormulaValue | undefined}
          onChange={v => setCfg('base64', v)}
          placeholder="Enter a value"
          workflowTrigger={workflowTrigger}
        />
      )}

      {step.type === 'encodeFileAsBase64' && (
        <>
          <BoundField
            label="File object"
            required
            value={(cfg.fileObject ?? cfg.dataUrl ?? cfg.value) as FormulaValue | undefined}
            onChange={v => { setCfg('fileObject', v); setCfg('dataUrl', undefined); setCfg('value', undefined); }}
            placeholder="File variable or data URL"
            workflowTrigger={workflowTrigger}
          />
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Output format</label>
          <div style={S.toggleGroup}>
            <button style={S.toggleBtn((cfg.outputFormat as string) !== 'base64')} onClick={() => setCfg('outputFormat', 'dataUrl')}>Data URL</button>
            <button style={S.toggleBtn((cfg.outputFormat as string) === 'base64')} onClick={() => setCfg('outputFormat', 'base64')}>Base64</button>
          </div>
        </>
      )}

      {step.type === 'addSharedComponent' && (
        <AddSharedComponentConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'deleteSharedComponent' && (
        <DeleteSharedComponentConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'deleteAllSharedComponents' && (
        <DeleteAllSharedComponentsConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'setFormState' && (
        <SetFormStateConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'resetForm' && (
        <ResetFormConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'graphql' && (
        <GraphQLStepConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'fetchData' && (
        <FetchDataStepConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}

      {(step.type === 'openPopover' || step.type === 'closePopover' || step.type === 'togglePopover') && (
        <PopoverStepConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'scrollToElement' && (
        <ScrollToElementConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'animate' && (
        <AnimateStepConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'triggerExitAnimation' && (
        <TriggerExitAnimationConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'startLoop' && (
        <StartLoopConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'stopLoop' && (
        <StopLoopConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'playEnterAnimation' && (
        <PlayEnterAnimationConfig cfg={cfg} setCfg={setCfg} />
      )}

      {/* ── Server action config panels ─────────────────────────────────── */}
      {step.type === 'tablesList' && (
        <TablesListConfig cfg={cfg} setCfg={setCfg} step={step} projectId={projectId} workflowTrigger={workflowTrigger} formulaParams={formulaParams} />
      )}
      {step.type === 'tablesInsert' && (
        <TablesInsertConfig cfg={cfg} setCfg={setCfg} projectId={projectId} workflowTrigger={workflowTrigger} />
      )}
      {step.type === 'tablesUpdate' && (
        <TablesUpdateConfig cfg={cfg} setCfg={setCfg} projectId={projectId} workflowTrigger={workflowTrigger} formulaParams={formulaParams} />
      )}
      {step.type === 'tablesDelete' && (
        <TablesDeleteConfig cfg={cfg} setCfg={setCfg} projectId={projectId} workflowTrigger={workflowTrigger} formulaParams={formulaParams} />
      )}
      {step.type === 'executeSQL' && (
        <ExecuteSQLConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}
      {step.type === 'hashPassword' && (
        <HashPasswordConfig cfg={cfg} setCfg={setCfg} />
      )}
      {step.type === 'verifyPassword' && (
        <VerifyPasswordConfig cfg={cfg} setCfg={setCfg} />
      )}
      {step.type === 'generateToken' && (
        <GenerateTokenConfig cfg={cfg} setCfg={setCfg} />
      )}
      {step.type === 'verifyToken' && (
        <VerifyTokenConfig cfg={cfg} setCfg={setCfg} />
      )}
      {step.type === 'sendResponse' && (
        <SendResponseConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} isServerContext={isServerContext} priorSteps={priorSteps} />
      )}
      {step.type === 'sendStreamingResponse' && (
        <SendStreamingResponseConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}
      {step.type === 'throwError' && (
        <ThrowErrorConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}
      {step.type === 'tryCatch' && (
        <TryCatchConfig step={step} onUpdate={onUpdate} />
      )}
      {step.type === 'createWorkflowVariable' && (
        <CreateWorkflowVariableConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}
      {step.type === 'workflowResult' && (
        <WorkflowResultConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}
      {step.type === 'runServerFunction' && (
        <RunServerFunctionConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} serverFunctions={serverFunctions} />
      )}
      {step.type === 'runFormula' && (
        <RunFormulaConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}
      {/* serverJavaScript reuses the same RunJavaScriptConfig */}
      {step.type === 'serverJavaScript' && (
        <RunJavaScriptConfig step={step} onUpdate={onUpdate} workflowTrigger={workflowTrigger} />
      )}
      {/* For server context, fetchData uses the enhanced HTTP Request form */}
      {step.type === 'fetchData' && isServerContext && (
        <ServerFetchDataConfig cfg={cfg} setCfg={setCfg} workflowTrigger={workflowTrigger} />
      )}

      <label style={{ ...S.fieldLabel, marginTop: 12 }}>Description</label>
      <textarea
        style={{ ...S.fieldInput, minHeight: 64, resize: 'vertical' }}
        value={step.description ?? ''}
        placeholder="Description…"
        onChange={e => onUpdate({ description: e.target.value })}
      />
    </div>
    </WorkflowParamsProvider>
  );
}

