'use client';

/**
 * Logic Tab — left panel "Logic" tab.
 *
 * Two sections (editing via SlidePanel):
 *   A. Workflows  — named action sequences; triggered from interactions
 *   B. Formulas   — named reusable JS formula functions with typed parameters
 *
 * Page-level "On load" workflow is always pinned at the top of Workflows.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { SearchInput } from './_panel-primitives';
import { useBuilderStore } from './_store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL, SP_SECTION } from './_slide-panel';
import { ActionBuilder } from './_action-builder';
import { toHumanName } from './_workflow-canvas';
import type { GlobalFormulaDef, GlobalFormulaParam } from './_store-types';
import { FormulaEditor } from './_formula-editor';
import type { FormulaValue } from '@/lib/sdui/formula-evaluator';

// ─── Shared styles ────────────────────────────────────────────────────────────

const SECTION_HDR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderBottom: 'none',
};
const SEC_LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--bld-text-2)',
  textTransform: 'none',
};
const EMPTY: React.CSSProperties = {
  fontSize: 11, color: 'var(--bld-text-3)', fontStyle: 'italic',
  padding: '8px 12px',
};
const ADD_BTN: React.CSSProperties = {
  padding: '3px 10px', background: 'var(--bld-accent-hover)', border: 'none',
  borderRadius: 4, color: 'var(--bld-accent-fg)', fontSize: 10, cursor: 'pointer',
};

// ─── A. Workflows ─────────────────────────────────────────────────────────────

interface WorkflowSlideContentProps {
  workflowId: string;
  onClose: () => void;
}

function WorkflowSlideContent({ workflowId, onClose }: WorkflowSlideContentProps) {
  const { pageWorkflows, setPageWorkflow, pageDataSources } = useBuilderStore();

  const currentSteps = pageWorkflows[workflowId] ?? [];
  const [name, setName] = useState(workflowId);
  const [nameEditing, setNameEditing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const eventActions = { run: currentSteps };

  const { removePageWorkflow } = useBuilderStore();

  const handleNameBlur = useCallback(() => {
    setNameEditing(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === workflowId) return;
    const steps = pageWorkflows[workflowId] ?? [];
    setPageWorkflow(trimmed, steps);
    removePageWorkflow(workflowId);
  }, [name, workflowId, pageWorkflows, setPageWorkflow, removePageWorkflow]);

  const dsNames = pageDataSources.map(s => s.name);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header: workflow name */}
      <div style={{ ...SP_SECTION, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, color: 'var(--bld-warning)', flexShrink: 0 }}>⚡</span>
        {nameEditing ? (
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleNameBlur(); if (e.key === 'Escape') { setNameEditing(false); setName(workflowId); } }}
            style={{ ...SP_INPUT, fontSize: 12, fontWeight: 600, flex: 1 }}
            autoFocus
          />
        ) : (
          <span
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-1)', flex: 1, cursor: 'pointer' }}
            onDoubleClick={() => { setName(workflowId); setNameEditing(true); setTimeout(() => nameRef.current?.select(), 0); }}
            title="Double-click to rename"
          >
            {workflowId}
          </span>
        )}
        {!nameEditing && (
          <button
            onClick={() => { setName(workflowId); setNameEditing(true); setTimeout(() => nameRef.current?.select(), 0); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 12, padding: '0 2px' }}
            title="Rename"
          >
            ✎
          </button>
        )}
      </div>

      {/* Info about callDataSource */}
      {dsNames.length > 0 && (
        <div style={{ padding: '5px 12px', fontSize: 10, color: 'var(--bld-text-disabled)', background: 'var(--bld-bg-base)', borderBottom: 'none' }}>
          Available data sources: {dsNames.map(n => <code key={n} style={{ color: 'var(--bld-success)', marginLeft: 4 }}>{n}</code>)}
        </div>
      )}

      {/* Steps */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginBottom: 6 }}>
          Add steps — use <code style={{ color: 'var(--bld-success)' }}>named</code> action type to call a data source by name.
        </div>
        <ActionBuilder
          value={eventActions}
          onChange={v => {
            const steps = (v?.run ?? []) as object[];
            setPageWorkflow(workflowId, steps);
          }}
          availableEvents={['run']}
          availableDataSources={pageDataSources}
        />
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 12px', borderTop: 'none', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
        <button onClick={onClose} style={SP_BTN_SECONDARY}>Done</button>
      </div>
    </div>
  );
}

function WorkflowRow({
  workflowId,
  stepCount,
  trigger,
  onOpen,
  onDelete,
  isPinned,
}: {
  workflowId: string;
  stepCount: number;
  trigger?: string;
  onOpen: () => void;
  onDelete?: () => void;
  isPinned?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const triggerLabel = trigger ? `On ${trigger}` : 'On click';
  const stepsLabel = stepCount === 0 ? '' : ` · ${stepCount} step${stepCount !== 1 ? 's' : ''}`;

  return (
    <div
      data-testid={`workflow-row-${workflowId}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderBottom: 'none',
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
      }}
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Icon */}
      <div style={{
        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
        background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: 'var(--bld-text-3)',
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </div>

      {/* Name + trigger subtitle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: isPinned ? 'var(--bld-info)' : 'var(--bld-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {workflowId}
        </div>
        <div style={{ fontSize: 11, color: 'var(--bld-text-3)', marginTop: 2 }}>
          {triggerLabel}{stepsLabel}
        </div>
      </div>

      {/* Delete */}
      {!isPinned && onDelete && (
        <button
          data-testid={`delete-workflow-${workflowId}`}
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 16, padding: '0 2px', flexShrink: 0, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-error)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
        >
          ×
        </button>
      )}
    </div>
  );
}

function WorkflowsSection({ onOpenSlide }: { onOpenSlide: (id: string) => void }) {
  const { pageWorkflows, pageWorkflowMeta, setPageWorkflow, removePageWorkflow } = useBuilderStore();

  const addWorkflow = () => {
    let name = 'Untitled workflow';
    let i = 1;
    while (pageWorkflows[name]) { name = `Untitled workflow ${i++}`; }
    setPageWorkflow(name, []);
    onOpenSlide(name);
  };

  // Filter out system workflows
  const allWorkflows = Object.entries(pageWorkflows)
    .filter(([id]) => !pageWorkflowMeta[id]?.isSystem);

  return (
    <div>
      <div style={SECTION_HDR}>
        <span style={SEC_LABEL}>Workflows</span>
        <button
          data-testid="add-workflow-btn"
          onClick={addWorkflow}
          style={ADD_BTN}
        >
          + New
        </button>
      </div>

      {allWorkflows.length === 0 && (
        <div style={EMPTY}>No workflows yet — click + New to add one.</div>
      )}

      {allWorkflows.map(([id, steps]) => (
        <WorkflowRow
          key={id}
          workflowId={id}
          stepCount={(steps as object[]).length}
          onOpen={() => onOpenSlide(id)}
          onDelete={() => removePageWorkflow(id)}
        />
      ))}
    </div>
  );
}

// ─── B. Formulas ──────────────────────────────────────────────────────────────

const PARAM_TYPES: GlobalFormulaParam['type'][] = ['Text', 'Number', 'Boolean', 'Object', 'Array'];
const PARAM_TYPE_ICONS: Record<string, string> = {
  Text: 'T', Number: '#', Boolean: '◎', Object: '{ }', Array: '[ ]',
};

function FormulaParamEditor({
  param,
  onUpdate,
  onRemove,
}: {
  param: GlobalFormulaParam;
  onUpdate: (patch: Partial<GlobalFormulaParam>) => void;
  onRemove: () => void;
}) {
  const [typeOpen, setTypeOpen] = useState(false);
  const typeBtnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!typeOpen) return;
    const handler = (e: MouseEvent) => {
      if (typeBtnRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setTypeOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [typeOpen]);

  return (
    <div style={{ background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-bg-input)', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {/* Type button */}
        <div style={{ position: 'relative' }}>
          <button
            ref={typeBtnRef}
            type="button"
            onClick={e => { e.stopPropagation(); setTypeOpen(o => !o); }}
            style={{
              minWidth: 42, padding: '3px 7px', background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)',
              borderRadius: 4, color: 'var(--bld-info)', fontSize: 10, cursor: 'pointer', fontWeight: 700, fontFamily: 'monospace',
            }}
            title="Parameter type"
          >
            {PARAM_TYPE_ICONS[param.type] ?? param.type}
          </button>
          {typeOpen && (
            <div
              ref={dropdownRef}
              style={{
                position: 'fixed', background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)',
                borderRadius: 6, zIndex: 99999, minWidth: 110, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                overflow: 'hidden',
              }}
            >
              {PARAM_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    const patch: Partial<GlobalFormulaParam> = { type: t };
                    if (t === 'Boolean') patch.testValue = false;
                    else if (t === 'Object') patch.testValue = '{}';
                    else if (t === 'Array') patch.testValue = '[]';
                    else patch.testValue = '';
                    onUpdate(patch);
                    setTypeOpen(false);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '7px 12px', background: param.type === t ? 'var(--bld-accent-hover)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    color: param.type === t ? 'var(--bld-accent-fg)' : 'var(--bld-text-2)', fontSize: 11,
                  }}
                >
                  <span style={{ color: 'var(--bld-info)', fontFamily: 'monospace', fontWeight: 700, width: 24 }}>
                    {PARAM_TYPE_ICONS[t]}
                  </span>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Name input */}
        <input
          value={param.name}
          onChange={e => onUpdate({ name: e.target.value })}
          placeholder="paramName"
          style={{
            flex: 1, background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4,
            color: 'var(--bld-text-1)', fontSize: 11, padding: '3px 7px', outline: 'none', fontFamily: 'monospace',
          }}
          onKeyDown={e => e.stopPropagation()}
        />

        {/* Remove */}
        <button
          type="button"
          onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 14, padding: 0, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-error)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
        >
          ×
        </button>
      </div>

      {/* Test value row */}
      <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginBottom: 4 }}>Test value</div>
      {param.type === 'Boolean' ? (
        <div style={{ display: 'flex', background: 'var(--bld-bg-input)', borderRadius: 4, overflow: 'hidden', gap: 1 }}>
          {[true, false].map(v => (
            <button key={String(v)} type="button"
              onClick={() => onUpdate({ testValue: v })}
              style={{
                flex: 1, padding: '4px 0', fontSize: 10, border: 'none', cursor: 'pointer', fontWeight: 600,
                background: (param.testValue === v || String(param.testValue) === String(v)) ? (v ? 'rgba(34,197,94,0.2)' : 'rgba(248,113,113,0.12)') : 'transparent',
                color: (param.testValue === v || String(param.testValue) === String(v)) ? (v ? 'var(--bld-success)' : 'var(--bld-error)') : 'var(--bld-text-disabled)',
              }}
            >{v ? 'true' : 'false'}</button>
          ))}
        </div>
      ) : param.type === 'Number' ? (
        <input
          type="number"
          style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '3px 7px', outline: 'none', boxSizing: 'border-box' as const }}
          value={param.testValue === undefined ? '' : String(param.testValue)}
          placeholder="0"
          onChange={e => onUpdate({ testValue: e.target.value === '' ? '' : Number(e.target.value) })}
          onKeyDown={e => e.stopPropagation()}
        />
      ) : (param.type === 'Object' || param.type === 'Array') ? (
        <textarea
          style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '4px 7px', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'monospace', resize: 'vertical', minHeight: 52 }}
          value={typeof param.testValue === 'string' ? param.testValue : JSON.stringify(param.testValue ?? (param.type === 'Array' ? [] : {}), null, 2)}
          placeholder={param.type === 'Array' ? '[]' : '{}'}
          onChange={e => onUpdate({ testValue: e.target.value })}
          onKeyDown={e => e.stopPropagation()}
        />
      ) : (
        <input
          style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '3px 7px', outline: 'none', boxSizing: 'border-box' as const }}
          value={String(param.testValue ?? '')}
          placeholder="Test text…"
          onChange={e => onUpdate({ testValue: e.target.value })}
          onKeyDown={e => e.stopPropagation()}
        />
      )}
    </div>
  );
}

export { FormulaParamEditor };

interface FormulaSlideContentProps {
  formulaId: string;
  isNew: boolean;
  onClose: () => void;
}

// ─── Exported base form (used by component editor too) ────────────────────────

export interface FormulaSlideBaseProps {
  initial: {
    name?: string;
    folder?: string;
    description?: string;
    params?: GlobalFormulaParam[];
    formula?: string | FormulaValue;
  };
  isNew: boolean;
  onSave: (def: { name: string; folder?: string; description?: string; params: GlobalFormulaParam[]; formula: string }) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** Position for the FormulaEditor popup. Use anchorRight to anchor from the right edge of the viewport. */
  anchorLeft?: number;
  anchorRight?: number;
  /** When true, formula params are shown in the Quick tab instead of the Workflow tab */
  paramsInQuick?: boolean;
}

export function FormulaSlideBase({ initial, isNew, onSave, onDelete, onClose, anchorLeft, anchorRight, paramsInQuick }: FormulaSlideBaseProps) {
  const [name, setName] = useState(initial.name ?? '');
  const [folder, setFolder] = useState(initial.folder ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [params, setParams] = useState<GlobalFormulaParam[]>(initial.params ?? []);
  const [formula, setFormula] = useState<FormulaValue>(initial.formula ?? '');
  const [showFormulaEditor, setShowFormulaEditor] = useState(false);

  const fnName = (name || 'myFormula').replace(/\s+/g, '');
  const paramSig = params.map(p => p.name || '?').join(', ');

  const save = useCallback(() => {
    if (!name.trim()) return;
    onSave({
      name: fnName,
      folder: folder.trim() || undefined,
      description: description.trim() || undefined,
      params,
      formula: typeof formula === 'string' ? formula : (formula as { formula?: string })?.formula ?? '',
    });
    onClose();
  }, [name, folder, description, params, formula, fnName, onSave, onClose]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showFormulaEditor && (
        <FormulaEditor
          label="Formula body"
          value={formula}
          onChange={v => { setFormula(v); }}
          onClose={() => setShowFormulaEditor(false)}
          anchor={anchorRight !== undefined ? 'right' : 'left'}
          anchorLeft={anchorRight === undefined ? (anchorLeft ?? 568) : undefined}
          anchorRight={anchorRight}
          hideUnbind
          formulaParams={params}
          paramsInQuick={paramsInQuick}
        />
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Name */}
        <div style={SP_SECTION}>
          <label style={SP_LABEL}>Function name *</label>
          <input
            data-testid="formula-name"
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="myFormula"
            style={SP_INPUT}
            onKeyDown={e => e.stopPropagation()}
          />
          {name && (
            <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 4 }}>
              Call as <code style={{ color: 'var(--bld-warning)', fontFamily: 'monospace' }}>{fnName}({paramSig})</code>
            </div>
          )}
        </div>

        {/* Folder */}
        <div style={SP_SECTION}>
          <label style={SP_LABEL}>Folder</label>
          <input
            value={folder}
            onChange={e => setFolder(e.target.value)}
            placeholder="e.g. Text, Math, Utils"
            style={SP_INPUT}
            onKeyDown={e => e.stopPropagation()}
          />
        </div>

        {/* Description */}
        <div style={SP_SECTION}>
          <label style={SP_LABEL}>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What does this formula do?"
            style={{ ...SP_INPUT, resize: 'vertical', minHeight: 48, fontFamily: 'inherit' } as React.CSSProperties}
            onKeyDown={e => e.stopPropagation()}
          />
        </div>

        {/* Parameters */}
        <div style={{ ...SP_SECTION, borderBottom: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={SP_LABEL}>Parameters</label>
            <button
              type="button"
              onClick={() => setParams(ps => [...ps, { id: `p-${Date.now()}`, name: '', type: 'Text' }])}
              style={{ padding: '2px 8px', background: 'var(--bld-accent-hover)', border: 'none', borderRadius: 4, color: 'var(--bld-accent-fg)', fontSize: 10, cursor: 'pointer' }}
            >
              + Add
            </button>
          </div>
          {params.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--bld-text-3)', fontStyle: 'italic', marginBottom: 8 }}>No parameters yet.</div>
          )}
          {params.map((param, i) => (
            <FormulaParamEditor
              key={param.id}
              param={param}
              onUpdate={patch => setParams(ps => ps.map((p, idx) => idx === i ? { ...p, ...patch } : p))}
              onRemove={() => setParams(ps => ps.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>

        {/* Formula body */}
        <div style={SP_SECTION}>
          <label style={SP_LABEL}>Formula body</label>
          <div
            style={{
              background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', borderRadius: 5,
              padding: '6px 10px', fontSize: 11, color: formula ? 'var(--bld-warning)' : 'var(--bld-border-subtle)',
              fontFamily: 'monospace', minHeight: 34, cursor: 'pointer',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            onClick={() => setShowFormulaEditor(true)}
            title="Click to edit formula"
          >
            {formula
              ? (typeof formula === 'string' ? formula : (formula as { formula?: string })?.formula ?? '')
              : '(click to add formula body…)'}
          </div>
          <button
            type="button"
            onClick={() => setShowFormulaEditor(true)}
            style={{ marginTop: 5, padding: '4px 10px', background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-info)', fontSize: 10, cursor: 'pointer' }}
          >
            ✎ Edit Formula
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 12px', borderTop: 'none', display: 'flex', gap: 8, flexShrink: 0 }}>
        {!isNew && onDelete && (
          <button
            onClick={() => { onDelete(); onClose(); }}
            style={{ padding: '5px 10px', background: 'none', border: '1px solid rgba(248,113,113,0.12)', borderRadius: 4, color: 'var(--bld-error)', fontSize: 11, cursor: 'pointer' }}
          >
            Delete
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={SP_BTN_SECONDARY}>{isNew ? 'Cancel' : 'Close'}</button>
        <button
          data-testid="formula-save"
          onClick={save}
          disabled={!name.trim()}
          style={{ ...SP_BTN_PRIMARY, opacity: name.trim() ? 1 : 0.4, cursor: name.trim() ? 'pointer' : 'default' }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── Store-connected version (left panel) ─────────────────────────────────────

function FormulaSlideContent({ formulaId, isNew, onClose }: FormulaSlideContentProps) {
  const { globalFormulas, setGlobalFormulaFull, removeGlobalFormula } = useBuilderStore();
  const existing = globalFormulas[formulaId] as GlobalFormulaDef | undefined;

  const handleSave = useCallback((def: { name: string; folder?: string; description?: string; params: GlobalFormulaParam[]; formula: string }) => {
    const full: GlobalFormulaDef = {
      name: def.name,
      folder: def.folder,
      description: def.description,
      params: def.params,
      formula: def.formula,
    };
    setGlobalFormulaFull(formulaId, full);
  }, [formulaId, setGlobalFormulaFull]);

  const handleDelete = useCallback(() => {
    removeGlobalFormula(formulaId);
  }, [formulaId, removeGlobalFormula]);

  return (
    <FormulaSlideBase
      key={formulaId}
      initial={{
        name: existing?.name,
        folder: existing?.folder,
        description: existing?.description,
        params: existing?.params,
        formula: existing?.formula,
      }}
      isNew={isNew}
      onSave={handleSave}
      onDelete={isNew ? undefined : handleDelete}
      onClose={onClose}
    />
  );
}

function FormulaRow({
  formulaId,
  def,
  onOpen,
  onDelete,
}: { formulaId: string; def: GlobalFormulaDef; onOpen: () => void; onDelete: () => void }) {
  const [hovered, setHovered] = useState(false);
  const fnName = def.name || formulaId;
  const paramSig = (def.params ?? []).map(p => p.name || '?').join(', ');

  return (
    <div
      data-testid={`formula-row-${formulaId}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderBottom: 'none',
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
      }}
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Icon */}
      <div style={{
        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
        background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, color: 'var(--bld-warning)', fontStyle: 'italic', fontFamily: 'serif',
      }}>
        ƒ
      </div>

      {/* Name + signature */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-warning)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
          {fnName}({paramSig})
        </div>
        {def.description && (
          <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {def.description}
          </div>
        )}
        {def.folder && (
          <div style={{ fontSize: 9, color: 'var(--bld-text-disabled)', marginTop: 1 }}>{def.folder}</div>
        )}
      </div>

      {/* Delete */}
      <button
        data-testid={`delete-formula-${formulaId}`}
        onClick={e => { e.stopPropagation(); onDelete(); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 16, padding: '0 2px', flexShrink: 0, lineHeight: 1 }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-error)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
      >
        ×
      </button>
    </div>
  );
}

// ─── Slide state ──────────────────────────────────────────────────────────────

type LogicSlideState =
  | { kind: 'workflow'; id: string }
  | { kind: 'formula'; id: string; isNew: boolean }
  | null;

// ─── LogicSlidePanelContent — rendered inside page.tsx's SlidePanel ─────────

interface LogicSlidePanelContentProps {
  slideState: LogicSlideState;
  onClose: () => void;
}

export function LogicSlidePanelContent({ slideState, onClose }: LogicSlidePanelContentProps) {
  if (!slideState) return null;
  if (slideState.kind === 'workflow') {
    return <WorkflowSlideContent workflowId={slideState.id} onClose={onClose} />;
  }
  if (slideState.kind === 'formula') {
    return <FormulaSlideContent formulaId={slideState.id} isNew={slideState.isNew} onClose={onClose} />;
  }
  return null;
}

export function getLogicSlideTitle(slideState: LogicSlideState): string {
  if (!slideState) return '';
  if (slideState.kind === 'workflow') return slideState.id;
  if (slideState.kind === 'formula') return slideState.isNew ? 'New Formula' : 'Edit Formula';
  return '';
}

// ─── Main LogicTab — 50/50 split layout ──────────────────────────────────────

const SEARCH_INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--bld-bg-panel)',
  border: '1px solid var(--bld-border-subtle)',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 10,
  color: 'var(--bld-text-2)',
  outline: 'none',
  boxSizing: 'border-box' as const,
};

interface LogicTabProps {
  onSetSlide: (s: LogicSlideState) => void;
  /** When true the tab renders at natural height inside a scrollable parent. */
  merged?: boolean;
}

export function LogicTab({ onSetSlide, merged = false }: LogicTabProps) {
  const [wfSearch, setWfSearch] = useState('');
  const [fmSearch, setFmSearch] = useState('');
  const [wfOpen, setWfOpen] = useState(false);
  const [fmOpen, setFmOpen] = useState(false);
  const [wfSearchOpen, setWfSearchOpen] = useState(false);
  const [fmSearchOpen, setFmSearchOpen] = useState(false);
  const wfSearchRef = useRef<HTMLInputElement>(null);
  const fmSearchRef = useRef<HTMLInputElement>(null);
  const { globalWorkflows, setGlobalWorkflow, removeGlobalWorkflow, globalWorkflowMeta, setGlobalWorkflowMeta, globalFormulas, setGlobalFormulaFull, removeGlobalFormula, openWorkflowCanvas } = useBuilderStore();

  // Only show truly global (project-level) workflows — NOT page-scoped ones
  const filteredGlobalWorkflows = Object.keys(globalWorkflows).filter(id => {
    const meta = globalWorkflowMeta[id];
    const name = meta?.name ?? id;
    return name.toLowerCase().includes(wfSearch.toLowerCase());
  });

  const filteredFormulas = Object.entries(globalFormulas).filter(([, def]) => {
    const searchLower = fmSearch.toLowerCase();
    return (def as GlobalFormulaDef).name?.toLowerCase().includes(searchLower) ||
      (def as GlobalFormulaDef).folder?.toLowerCase().includes(searchLower) ||
      (def as GlobalFormulaDef).description?.toLowerCase().includes(searchLower);
  });

  const addWorkflow = () => {
    const id = crypto.randomUUID();
    setGlobalWorkflow(id, []);
    setGlobalWorkflowMeta(id, { id, name: 'Untitled workflow' });
    openWorkflowCanvas({ kind: 'globalWorkflow', id, isNew: true });
  };

  const addFormula = () => {
    const id = crypto.randomUUID();
    setGlobalFormulaFull(id, { name: '', folder: '', description: '', params: [], formula: '' });
    onSetSlide({ kind: 'formula', id, isNew: true });
  };

  return (
    <div data-testid="logic-tab-split" style={merged
      ? { flexShrink: 0, display: 'flex', flexDirection: 'column' }
      : { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Top: Workflows ── */}
      <div
        data-testid="workflows-column"
        style={merged
          ? { display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: wfOpen ? 600 : 38, transition: 'max-height 0.22s ease' }
          : { flex: wfOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, borderBottom: '0.5px solid var(--bld-bg-input)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}
      >
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setWfOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bld-text-disabled)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.15s', transform: wfOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}><polyline points="9 18 15 12 9 6" /></svg>
            Workflows
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              title="Search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setWfSearchOpen(o => { const next = !o; if (next) { setWfOpen(true); setTimeout(() => wfSearchRef.current?.focus(), 20); } else setWfSearch(''); return next; }); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: wfSearchOpen ? 'var(--bld-accent)' : 'var(--bld-text-disabled)', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
              onMouseEnter={e => { if (!wfSearchOpen) (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
              onMouseLeave={e => { if (!wfSearchOpen) (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
            {filteredGlobalWorkflows.length > 0 && (
              <button
                title="Delete all workflows"
                onClick={() => { if (confirm('Delete all workflows?')) filteredGlobalWorkflows.forEach(id => removeGlobalWorkflow(id)); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-error)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></svg>
              </button>
            )}
            <button
              data-testid="add-workflow-btn"
              title="New workflow"
              onClick={() => addWorkflow()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 10, fontWeight: 500, padding: '2px 4px', borderRadius: 3 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-accent)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
            >New</button>
          </div>
        </div>
        {/* Slide-down search */}
        <div style={{ overflow: 'hidden', maxHeight: wfSearchOpen ? 40 : 0, transition: 'max-height 0.2s ease', flexShrink: 0 }}>
          <div style={{ padding: '5px 10px' }}>
            <SearchInput value={wfSearch} onChange={setWfSearch} placeholder="Search workflows…" inputRef={wfSearchRef} data-testid="workflow-search" onKeyDown={e => { if (e.key === 'Escape') { setWfSearch(''); setWfSearchOpen(false); } }} />
          </div>
        </div>
        {wfOpen && (
          <>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredGlobalWorkflows.length === 0 && (
                <div style={EMPTY}>
                  {wfSearch ? 'No matching workflows.' : 'No global workflows yet — click + New to create one.'}
                </div>
              )}
              {filteredGlobalWorkflows.map(id => {
                const meta = globalWorkflowMeta[id];
                const displayName = toHumanName(meta?.name ?? id);
                const trigger = meta?.trigger;
                const steps = globalWorkflows[id] ?? [];
                return (
                  <WorkflowRow
                    key={id}
                    workflowId={displayName}
                    stepCount={(steps as object[]).length}
                    trigger={trigger}
                    onOpen={() => openWorkflowCanvas({ kind: 'globalWorkflow', id })}
                    onDelete={() => removeGlobalWorkflow(id)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
      {merged && <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent 0%, var(--bld-border-subtle) 20%, var(--bld-border-subtle) 80%, transparent 100%)', flexShrink: 0 }} />}

      {/* ── Bottom: Formulas ── */}
      <div
        data-testid="formulas-column"
        style={merged
          ? { display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: fmOpen ? 600 : 38, transition: 'max-height 0.22s ease' }
          : { flex: fmOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}
      >
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setFmOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bld-text-disabled)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.15s', transform: fmOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}><polyline points="9 18 15 12 9 6" /></svg>
            Formulas
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              title="Search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setFmSearchOpen(o => { const next = !o; if (next) { setFmOpen(true); setTimeout(() => fmSearchRef.current?.focus(), 20); } else setFmSearch(''); return next; }); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: fmSearchOpen ? 'var(--bld-accent)' : 'var(--bld-text-disabled)', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
              onMouseEnter={e => { if (!fmSearchOpen) (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
              onMouseLeave={e => { if (!fmSearchOpen) (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
            {filteredFormulas.length > 0 && (
              <button
                title="Delete all formulas"
                onClick={() => { if (confirm('Delete all formulas?')) filteredFormulas.forEach(([id]) => removeGlobalFormula(id)); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-error)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" /></svg>
              </button>
            )}
            <button
              data-testid="add-formula-btn"
              title="New formula"
              onClick={() => addFormula()}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 10, fontWeight: 500, padding: '2px 4px', borderRadius: 3 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-accent)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
            >New</button>
          </div>
        </div>
        {/* Slide-down search */}
        <div style={{ overflow: 'hidden', maxHeight: fmSearchOpen ? 40 : 0, transition: 'max-height 0.2s ease', flexShrink: 0 }}>
          <div style={{ padding: '5px 10px' }}>
            <SearchInput value={fmSearch} onChange={setFmSearch} placeholder="Search formulas…" inputRef={fmSearchRef} data-testid="formula-search" onKeyDown={e => { if (e.key === 'Escape') { setFmSearch(''); setFmSearchOpen(false); } }} />
          </div>
        </div>
        {fmOpen && (
          <>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredFormulas.length === 0 && (
                <div style={EMPTY}>
                  {fmSearch ? 'No matching formulas.' : 'No formulas yet — click + New.'}
                </div>
              )}
              {filteredFormulas.map(([id, def]) => (
                <FormulaRow
                  key={id}
                  formulaId={id}
                  def={def as GlobalFormulaDef}
                  onOpen={() => onSetSlide({ kind: 'formula', id, isNew: false })}
                  onDelete={() => removeGlobalFormula(id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {merged && <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent 0%, var(--bld-border-subtle) 20%, var(--bld-border-subtle) 80%, transparent 100%)', flexShrink: 0 }} />}
    </div>
  );
}

export type { LogicSlideState };
