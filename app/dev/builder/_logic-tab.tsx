'use client';

/**
 * Logic Tab — left panel "Logic" tab.
 *
 * Two sections (editing via SlidePanel):
 *   A. Workflows  — named action sequences; triggered from interactions
 *   B. Formulas   — named JSON Logic expressions
 *
 * Page-level "On load" workflow is always pinned at the top of Workflows.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useBuilderStore } from './_store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL, SP_SECTION } from './_slide-panel';
import { ActionBuilder } from './_action-builder';
import { ExprBuilder } from './_expr-builder';
import { toHumanName } from './_workflow-canvas';

// ─── Shared styles ────────────────────────────────────────────────────────────

const SECTION_HDR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderBottom: '1px solid #1f2937',
};
const SEC_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.08em',
};
const EMPTY: React.CSSProperties = {
  fontSize: 11, color: '#4b5563', fontStyle: 'italic',
  padding: '8px 12px',
};
const ADD_BTN: React.CSSProperties = {
  padding: '3px 10px', background: '#1d4ed8', border: 'none',
  borderRadius: 4, color: '#fff', fontSize: 10, cursor: 'pointer',
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
        <span style={{ fontSize: 14, color: '#fbbf24', flexShrink: 0 }}>⚡</span>
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
            style={{ fontSize: 12, fontWeight: 600, color: '#f3f4f6', flex: 1, cursor: 'pointer' }}
            onDoubleClick={() => { setName(workflowId); setNameEditing(true); setTimeout(() => nameRef.current?.select(), 0); }}
            title="Double-click to rename"
          >
            {workflowId}
          </span>
        )}
        {!nameEditing && (
          <button
            onClick={() => { setName(workflowId); setNameEditing(true); setTimeout(() => nameRef.current?.select(), 0); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12, padding: '0 2px' }}
            title="Rename"
          >
            ✎
          </button>
        )}
      </div>

      {/* Info about callDataSource */}
      {dsNames.length > 0 && (
        <div style={{ padding: '5px 12px', fontSize: 10, color: '#4b5563', background: '#0f172a', borderBottom: '1px solid #1f2937' }}>
          Available data sources: {dsNames.map(n => <code key={n} style={{ color: '#34d399', marginLeft: 4 }}>{n}</code>)}
        </div>
      )}

      {/* Steps */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6 }}>
          Add steps — use <code style={{ color: '#34d399' }}>named</code> action type to call a data source by name.
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
      <div style={{ padding: '10px 12px', borderTop: '1px solid #1f2937', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
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
        padding: '10px 14px', borderBottom: '1px solid #1f2937',
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
        background: '#1e293b', border: '1px solid #334155',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: '#94a3b8',
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </div>

      {/* Name + trigger subtitle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: isPinned ? '#60a5fa' : '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {workflowId}
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
          {triggerLabel}{stepsLabel}
        </div>
      </div>

      {/* Delete */}
      {!isPinned && onDelete && (
        <button
          data-testid={`delete-workflow-${workflowId}`}
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, padding: '0 2px', flexShrink: 0, lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          ×
        </button>
      )}
    </div>
  );
}

function WorkflowsSection({ onOpenSlide }: { onOpenSlide: (id: string) => void }) {
  const { pageWorkflows, setPageWorkflow, removePageWorkflow } = useBuilderStore();

  const addWorkflow = () => {
    let name = 'Untitled workflow';
    let i = 1;
    while (pageWorkflows[name]) { name = `Untitled workflow ${i++}`; }
    setPageWorkflow(name, []);
    onOpenSlide(name);
  };

  const allWorkflows = Object.entries(pageWorkflows);

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

interface FormulaSlideContentProps {
  formulaName: string;
  isNew: boolean;
  onClose: () => void;
}

function FormulaSlideContent({ formulaName, isNew, onClose }: FormulaSlideContentProps) {
  const { globalFormulas, setGlobalFormula } = useBuilderStore();
  const [name, setName] = useState(formulaName);
  const [expr, setExpr] = useState<object | null>((globalFormulas[formulaName] as object | null) ?? null);

  const save = useCallback(() => {
    if (!name.trim()) return;
    if (isNew || name !== formulaName) {
      if (!isNew) setGlobalFormula(formulaName, null as unknown as object);
      setGlobalFormula(name.trim(), expr ?? {});
    } else {
      setGlobalFormula(name.trim(), expr ?? {});
    }
    onClose();
  }, [name, expr, formulaName, isNew, setGlobalFormula, onClose]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={SP_SECTION}>
        <label style={SP_LABEL}>Name *</label>
        <input
          data-testid="formula-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="formulaName"
          style={SP_INPUT}
        />
        <div style={{ fontSize: 10, color: '#4b5563', marginTop: 4 }}>
          Reference as <code style={{ color: '#fbbf24' }}>{`{{formula.${name || 'name'}}}`}</code>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        <label style={SP_LABEL}>Expression (JSON Logic)</label>
        <ExprBuilder
          value={expr}
          onChange={v => setExpr(typeof v === 'object' && v !== null ? v as object : null)}
        />
      </div>
      <div style={{ padding: '10px 12px', borderTop: '1px solid #1f2937', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
        <button onClick={onClose} style={SP_BTN_SECONDARY}>Cancel</button>
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

function FormulaRow({
  formulaName,
  onOpen,
  onDelete,
}: { formulaName: string; onOpen: () => void; onDelete: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      data-testid={`formula-row-${formulaName}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid #1f2937',
        cursor: 'pointer',
        background: hovered ? 'rgba(59,130,246,0.08)' : 'transparent',
      }}
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 13, color: '#fbbf24', flexShrink: 0, fontStyle: 'italic', fontFamily: 'serif' }}>ƒ</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
          {formulaName}
        </div>
      </div>
      <button
        data-testid={`delete-formula-${formulaName}`}
        onClick={e => { e.stopPropagation(); onDelete(); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 14, padding: '0 2px', flexShrink: 0 }}
        onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
        onMouseLeave={e => (e.currentTarget.style.color = '#4b5563')}
      >
        ×
      </button>
    </div>
  );
}

function FormulasSection({ onOpenSlide }: { onOpenSlide: (name: string, isNew: boolean) => void }) {
  const { globalFormulas, setGlobalFormula, removeGlobalFormula } = useBuilderStore();
  const entries = Object.keys(globalFormulas);

  const addFormula = () => {
    let name = 'untitled';
    let i = 1;
    while (globalFormulas[name] !== undefined) { name = `untitled${i++}`; }
    setGlobalFormula(name, {});
    onOpenSlide(name, true);
  };

  return (
    <div>
      <div style={SECTION_HDR}>
        <span style={SEC_LABEL}>Formulas</span>
        <button
          data-testid="add-formula-btn"
          onClick={addFormula}
          style={ADD_BTN}
        >
          + New
        </button>
      </div>
      {entries.length === 0 && (
        <div style={EMPTY}>No formulas yet — click + New to add one.</div>
      )}
      {entries.map(name => (
        <FormulaRow
          key={name}
          formulaName={name}
          onOpen={() => onOpenSlide(name, false)}
          onDelete={() => removeGlobalFormula(name)}
        />
      ))}
    </div>
  );
}

// ─── Slide state ──────────────────────────────────────────────────────────────

type LogicSlideState =
  | { kind: 'workflow'; id: string }
  | { kind: 'formula'; name: string; isNew: boolean }
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
    return <FormulaSlideContent formulaName={slideState.name} isNew={slideState.isNew} onClose={onClose} />;
  }
  return null;
}

export function getLogicSlideTitle(slideState: LogicSlideState): string {
  if (!slideState) return '';
  if (slideState.kind === 'workflow') return slideState.id;
  if (slideState.kind === 'formula') return slideState.isNew ? 'New Formula' : slideState.name;
  return '';
}

// ─── Main LogicTab — 50/50 split layout ──────────────────────────────────────

const SEARCH_INPUT: React.CSSProperties = {
  width: '100%',
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 10,
  color: '#d1d5db',
  outline: 'none',
  boxSizing: 'border-box' as const,
};

interface LogicTabProps {
  onSetSlide: (s: LogicSlideState) => void;
}

export function LogicTab({ onSetSlide }: LogicTabProps) {
  const [wfSearch, setWfSearch] = useState('');
  const [fmSearch, setFmSearch] = useState('');
  const [wfOpen, setWfOpen] = useState(true);
  const [fmOpen, setFmOpen] = useState(true);
  const { globalWorkflows, setGlobalWorkflow, removeGlobalWorkflow, globalWorkflowMeta, setGlobalWorkflowMeta, globalFormulas, setGlobalFormula, removeGlobalFormula, openWorkflowCanvas } = useBuilderStore();

  // Only show truly global (project-level) workflows — NOT page-scoped ones
  const filteredGlobalWorkflows = Object.keys(globalWorkflows).filter(id => {
    const meta = globalWorkflowMeta[id];
    const name = meta?.name ?? id;
    return name.toLowerCase().includes(wfSearch.toLowerCase());
  });

  const allFormulas = Object.keys(globalFormulas);
  const filteredFormulas = allFormulas.filter(n => n.toLowerCase().includes(fmSearch.toLowerCase()));

  const addWorkflow = () => {
    const id = crypto.randomUUID();
    setGlobalWorkflow(id, []);
    setGlobalWorkflowMeta(id, { id, name: 'Untitled workflow' });
    openWorkflowCanvas({ kind: 'globalWorkflow', id, isNew: true });
  };

  const addFormula = () => {
    let name = 'untitled';
    let i = 1;
    while (globalFormulas[name] !== undefined) { name = `untitled${i++}`; }
    setGlobalFormula(name, {});
    onSetSlide({ kind: 'formula', name, isNew: true });
  };

  return (
    <div data-testid="logic-tab-split" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Top: Workflows ── */}
      <div
        data-testid="workflows-column"
        style={{ flex: wfOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, borderBottom: '2px solid #1f2937', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}
      >
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setWfOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 8, color: '#6b7280', transition: 'transform 0.15s', transform: wfOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
            Workflows
          </span>
          <button
            data-testid="add-workflow-btn"
            onClick={e => { e.stopPropagation(); addWorkflow(); }}
            style={ADD_BTN}
          >
            + New
          </button>
        </div>
        {wfOpen && (
          <>
            <div style={{ padding: '6px 10px', flexShrink: 0 }}>
              <input
                data-testid="workflow-search"
                value={wfSearch}
                onChange={e => setWfSearch(e.target.value)}
                placeholder="Search workflows…"
                style={SEARCH_INPUT}
              />
            </div>
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

      {/* ── Bottom: Formulas ── */}
      <div
        data-testid="formulas-column"
        style={{ flex: fmOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}
      >
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setFmOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 8, color: '#6b7280', transition: 'transform 0.15s', transform: fmOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
            Formulas
          </span>
          <button
            data-testid="add-formula-btn"
            onClick={e => { e.stopPropagation(); addFormula(); }}
            style={ADD_BTN}
          >
            + New
          </button>
        </div>
        {fmOpen && (
          <>
            <div style={{ padding: '6px 10px', flexShrink: 0 }}>
              <input
                data-testid="formula-search"
                value={fmSearch}
                onChange={e => setFmSearch(e.target.value)}
                placeholder="Search formulas…"
                style={SEARCH_INPUT}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredFormulas.length === 0 && (
                <div style={EMPTY}>
                  {fmSearch ? 'No matching formulas.' : 'No formulas yet — click + New.'}
                </div>
              )}
              {filteredFormulas.map(name => (
                <FormulaRow
                  key={name}
                  formulaName={name}
                  onOpen={() => onSetSlide({ kind: 'formula', name, isNew: false })}
                  onDelete={() => removeGlobalFormula(name)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export type { LogicSlideState };
