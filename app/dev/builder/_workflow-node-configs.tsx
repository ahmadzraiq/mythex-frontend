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

import React, { useState, useRef, useEffect } from 'react';
import { useBuilderStore } from './_store';
import { BindingIcon, isBoundValue, type FormulaValue } from './_formula-panel';
import { FormulaEditor, storedValueToFormula } from './_formula-editor';
import { GqlEditor } from './_data-source-form';
import { S } from './_workflow-styles';
import {
  type ActionStepType, type BranchDef, type ActionStep,
  ACTION_CATEGORIES, FORM_ACTION_CATEGORY,
  getActionLabel, getActionIcon, isStructural, isConfigured, canTest,
} from './_workflow-types';
import type { WorkflowMeta } from './_store';

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
}

export function WorkflowBindButton({ value, onChange }: WorkflowBindButtonProps) {
  const { pageWorkflowMeta } = useBuilderStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const rawDisplayName = value && pageWorkflowMeta[value]?.name ? pageWorkflowMeta[value].name : value || '';
  const displayName = rawDisplayName ? toHumanName(rawDisplayName) : 'Bind workflow';
  const isBound = Boolean(value);

  const allWorkflows = Object.values(pageWorkflowMeta)
    .filter(w => !w.isSystem)
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
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
      {/* Chain-link bind icon */}
      <button
        type="button"
        title={isBound ? 'Change workflow binding' : 'Bind to a workflow'}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, flexShrink: 0, cursor: 'pointer',
          border: 'none', borderRadius: 6,
          background: isBound ? '#3730a3' : '#1f2937',
          color: isBound ? '#a5b4fc' : '#6b7280',
          transition: 'background 0.15s, color 0.15s',
          padding: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l2-2a3.5 3.5 0 0 0-4.95-4.95l-1.1 1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0l-2 2a3.5 3.5 0 0 0 4.95 4.95l1.1-1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Bound workflow name pill */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          flex: 1, textAlign: 'left', background: isBound ? '#1e1b4b' : '#111827',
          border: `1px solid ${isBound ? '#3730a3' : '#374151'}`,
          borderRadius: 6, padding: '4px 8px', fontSize: 11,
          color: isBound ? '#a5b4fc' : '#6b7280', cursor: 'pointer',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {displayName}
      </button>

      {/* Clear button when bound */}
      {isBound && (
        <button
          type="button"
          title="Unbind workflow"
          onClick={e => { e.stopPropagation(); onChange(''); }}
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
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
            marginTop: 4, background: '#1f2937', border: '1px solid #374151',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
            minWidth: 220,
          }}
        >
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #374151' }}>
            <input
              autoFocus
              style={{ width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#e5e7eb', fontSize: 11, padding: '4px 8px', outline: 'none', boxSizing: 'border-box' }}
              placeholder="Search workflows…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 11, color: '#6b7280' }}>No workflows found</div>
            )}
            {filtered.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={e => { e.stopPropagation(); onChange(w.id); setOpen(false); setSearch(''); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 12px', background: w.id === value ? '#312e81' : 'transparent',
                  border: 'none', color: w.id === value ? '#c7d2fe' : '#e5e7eb',
                  fontSize: 11, cursor: 'pointer',
                }}
                onMouseEnter={e => { if (w.id !== value) (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { if (w.id !== value) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <div style={{ fontWeight: 600 }}>{toHumanName(w.name ?? w.id)}</div>
                {w.trigger && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>On {w.trigger}</div>}
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
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? '#f3f4f6' : '#6b7280' }}>
          {currentLabel}
        </span>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#6b7280', pointerEvents: 'none' }}>
          {open ? '▴' : '▾'}
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
                    if (item.type !== value) (e.currentTarget as HTMLButtonElement).style.background = '#374151';
                  }}
                  onMouseLeave={e => {
                    if (item.type !== value) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }}
                  onClick={() => { onChange(item.type as ActionStepType); setOpen(false); setSearch(''); }}
                  data-testid={`type-option-${item.type}`}
                >
                  <span style={{ fontSize: 12 }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.type === value && <span style={{ color: '#3b82f6', fontSize: 10 }}>✓</span>}
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

// ─── Shared canvas helpers ────────────────────────────────────────────────────

/** Bigger pill-style On/Off toggle matching the right panel's OnOffToggle */
export function CanvasOnOffToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const base: React.CSSProperties = {
    padding: '4px 16px', fontSize: 11, border: 'none', borderRadius: 3,
    cursor: 'pointer', fontWeight: 500,
  };
  return (
    <div style={{ display: 'flex', background: '#1f2937', borderRadius: 4, padding: 2, gap: 2 }}>
      <button style={{ ...base, background: value ? '#374151' : 'transparent', color: value ? '#f3f4f6' : '#6b7280' }}
        onClick={() => onChange(true)}>On</button>
      <button style={{ ...base, background: !value ? '#374151' : 'transparent', color: !value ? '#f3f4f6' : '#6b7280' }}
        onClick={() => onChange(false)}>Off</button>
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
                style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                  borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
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
                style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                  borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
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
                  style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                    borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
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
                <span style={{ fontSize: 12, color: '#9ca3af' }}>Queries</span>
                <BindingIcon
                  isBound={false}
                  onClick={() => setOpenField(f => f === 'queries' ? null : 'queries')}
                />
              </div>
        <button
          style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
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
                          style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                            borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
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
                          style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                            borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
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
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0 }}
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

          <div style={{ marginTop: 8, borderTop: '1px solid #374151', paddingTop: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af' }}>Loader on page change</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>Show page loader</span>
              <CanvasOnOffToggle value={!!(cfg.showLoader)} onChange={v => setCfg('showLoader', v)} />
            </div>
          </div>
        </>
      )}
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
  const [openField, setOpenField] = useState<'isSubmitting' | 'isSubmitted' | null>(null);

  function renderBoolField(key: 'isSubmitting' | 'isSubmitted', label: string) {
    const val = cfg[key] as FormulaValue | boolean | undefined;
    const bound = isBoundValue(val as FormulaValue);
    return (
      <>
        <label style={{ ...S.fieldLabel, marginTop: 10 }}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Bind icon on the LEFT, matching WeWeb reference */}
          <BindingIcon
            isBound={bound}
            onClick={() => setOpenField(f => f === key ? null : key)}
          />
          {bound ? (
            <button
              onClick={() => setOpenField(f => f === key ? null : key)}
              style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                textAlign: 'left' }}
            >ƒ Edit formula</button>
          ) : (
            <CanvasOnOffToggle value={!!val} onChange={v => setCfg(key, v)} />
          )}
        </div>
        {openField === key && (
          <FormulaEditor
            label={label}
            value={(val as FormulaValue) ?? null}
            onChange={v => { setCfg(key, v); setOpenField(null); }}
            onClose={() => setOpenField(null)}
            anchorRight={292}
          />
        )}
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
            style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
              borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
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
  flex: 1, background: '#1e1b4b', border: '1px solid #4338ca',
  color: '#a5b4fc', cursor: 'pointer', textAlign: 'left',
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

  const CELL_LABEL: React.CSSProperties = { fontSize: 9, color: '#6b7280', fontWeight: 500, marginBottom: 2 };

  return (
    <div style={{ marginTop: 10 }}>
      {/* Section header — label + bind icon + Add button (matching data tab SectionRow) */}
      {sectionBound ? (
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#d1d5db', display: 'block', marginBottom: 4 }}>{label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setSectionFEOpen(true)}
              style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed', borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500, textAlign: 'left' }}
            >ƒ Edit formula</button>
            <BindingIcon isBound onClick={() => setSectionFEOpen(true)} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#d1d5db' }}>{label}</span>
          <BindingIcon isBound={false} onClick={() => setSectionFEOpen(true)} />
          <span style={{ flex: 1 }} />
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#1e3a5f', border: '1px solid #2563eb', borderRadius: 6, color: '#93c5fd', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}
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
              style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '2px 4px', fontSize: 14, lineHeight: 1, marginBottom: 2 }}
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
            style={{ flex: 1, ...S.fieldInput, background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: 10, padding: '4px 7px' }}
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
          <span style={{ fontSize: 11, color: '#d1d5db' }}>Send credentials</span>
          <button
            style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
              background: cfg.credentials ? '#3b82f6' : '#374151', transition: 'background 0.2s',
            }}
            onClick={() => setCfg('credentials', !cfg.credentials)}
          >
            <span style={{
              position: 'absolute', top: 2, left: cfg.credentials ? 18 : 2, width: 16, height: 16,
              borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
            }} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#d1d5db' }}>Return data only</span>
          <button
            style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
              background: cfg.returnDataOnly !== false ? '#3b82f6' : '#374151', transition: 'background 0.2s',
            }}
            onClick={() => setCfg('returnDataOnly', cfg.returnDataOnly === false ? true : false)}
          >
            <span style={{
              position: 'absolute', top: 2, left: cfg.returnDataOnly !== false ? 18 : 2, width: 16, height: 16,
              borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
            }} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── FetchDataStepConfig (REST API) ──────────────────────────────────────────

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function FetchDataStepConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [urlOpen, setUrlOpen] = React.useState(false);
  const urlBound = isBoundValue(cfg.url as FormulaValue | undefined);

  return (
    <>
      {/* URL */}
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Url *</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {urlBound ? (
          <button
            style={{ flex: 1, ...S.fieldInput, background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: 10, padding: '4px 7px' }}
            onClick={() => setUrlOpen(true)}
            title={String(cfg.url ?? '')}
          >ƒ formula</button>
        ) : (
          <input
            style={{ ...S.fieldInput, flex: 1 }}
            placeholder="https://api.example.com/endpoint"
            value={(cfg.url as string) ?? ''}
            onChange={e => setCfg('url', e.target.value || undefined)}
          />
        )}
        <BindingIcon isBound={urlBound} onClick={() => setUrlOpen(true)} />
      </div>
      {urlOpen && (
        <FormulaEditor
          label="url"
          value={(cfg.url as FormulaValue) ?? null}
          onChange={v => { setCfg('url', v); setUrlOpen(false); }}
          onClose={() => setUrlOpen(false)}
          anchorRight={292}
        />
      )}

      {/* Method */}
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Method</label>
      <select
        style={S.fieldSelect}
        value={(cfg.method as string) ?? 'GET'}
        onChange={e => setCfg('method', e.target.value)}
      >
        {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
      </select>

      {/* Body (for non-GET methods) */}
      {(cfg.method as string | undefined) && (cfg.method as string) !== 'GET' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Body</label>
          <textarea
            style={{ ...S.fieldInput, minHeight: 72, fontFamily: 'monospace', fontSize: 10, resize: 'vertical' }}
            placeholder={'{\n  "key": "value"\n}'}
            value={(cfg.body as string) ?? ''}
            onChange={e => setCfg('body', e.target.value || undefined)}
          />
        </>
      )}

      {/* Headers */}
      <WorkflowKvEditor
        label="Headers"
        value={cfg.headers as Record<string, unknown> | undefined}
        onChange={v => setCfg('headers', Object.keys(v).length ? v : undefined)}
        testIdPrefix="rest-headers"
      />

      {/* Send credentials toggle */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#d1d5db' }}>Send credentials</span>
        <button
          style={{
            width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
            background: cfg.credentials ? '#3b82f6' : '#374151', transition: 'background 0.2s',
          }}
          onClick={() => setCfg('credentials', !cfg.credentials)}
        >
          <span style={{
            position: 'absolute', top: 2, left: cfg.credentials ? 18 : 2, width: 16, height: 16,
            borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
          }} />
        </button>
      </div>
    </>
  );
}

// ─── ChangeVariableValueConfig ───────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  string: '#fbbf24',
  number: '#60a5fa',
  boolean: '#34d399',
  object: '#a78bfa',
  array: '#fb923c',
  form: '#f472b6',
};

function ChangeVariableValueConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const { customVars } = useBuilderStore();
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [valueEditorOpen, setValueEditorOpen] = React.useState(false);

  const varId = cfg.variableName as string | undefined;
  const selected = customVars.find(v => (v.id ?? v.name) === varId);
  // When varId is a raw path (e.g. screen-scoped "screens.signIn.errors.apiError")
  // that doesn't match any customVars entry, treat it as a path-typed variable
  const rawPathSelected = varId && !selected ? varId : null;
  const filtered = customVars.filter(v => {
    const label = (v.label ?? v.name ?? '').toLowerCase();
    return !search || label.includes(search.toLowerCase());
  });

  const val = cfg.value as FormulaValue | undefined;
  const valueBound = isBoundValue(val as FormulaValue) || (typeof val === 'string' && val.trim().length > 0);

  return (
    <>
      {/* Variable picker */}
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
              <span style={{ fontSize: 9, color: TYPE_COLOR[selected.type] ?? '#9ca3af', fontFamily: 'monospace',
                background: 'rgba(255,255,255,0.07)', border: `1px solid ${TYPE_COLOR[selected.type] ?? '#374151'}`,
                borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>{selected.type}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selected.label ?? selected.name}
              </span>
            </span>
          ) : rawPathSelected ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }} title={rawPathSelected}>
              <span style={{ fontSize: 9, color: '#9ca3af', fontFamily: 'monospace',
                background: 'rgba(255,255,255,0.07)', border: '1px solid #374151',
                borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>path</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#d1d5db' }}>
                {rawPathSelected.split('.').pop()}
              </span>
              <span style={{ color: '#4b5563', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {rawPathSelected.split('.').slice(0, -1).join('.')}
              </span>
            </span>
          ) : (
            <span style={{ color: '#4b5563' }}>Choose a variable</span>
          )}
          <span style={{ color: '#6b7280', fontSize: 10, flexShrink: 0 }}>{open ? '▴' : '▾'}</span>
        </button>

        {open && (
          <div
            data-popover
            style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              background: '#111827', border: '1px solid #374151', borderRadius: 6,
              marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              maxHeight: 240, display: 'flex', flexDirection: 'column',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #1f2937' }}>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search variables…"
                style={{
                  width: '100%', boxSizing: 'border-box', background: '#1f2937',
                  border: '1px solid #374151', borderRadius: 4, color: '#d1d5db',
                  fontSize: 11, padding: '3px 7px', outline: 'none',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {/* Use typed path directly if it looks like a dot-path */}
              {search.includes('.') && (
                <button
                  onClick={() => { setCfg('variableName', search.trim()); setOpen(false); setSearch(''); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#a5b4fc', fontSize: 11, textAlign: 'left',
                  }}
                >
                  <span style={{
                    fontSize: 9, color: '#9ca3af', fontFamily: 'monospace',
                    background: 'rgba(255,255,255,0.07)', border: '1px solid #374151',
                    borderRadius: 3, padding: '0 4px', flexShrink: 0,
                  }}>path</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10 }}>Use &ldquo;{search.trim()}&rdquo;</span>
                </button>
              )}
              {filtered.length === 0 && !search.includes('.') && (
                <div style={{ padding: '10px 12px', fontSize: 11, color: '#6b7280' }}>No variables found</div>
              )}
              {filtered.map(v => {
                const key = v.id ?? v.name;
                const isActive = key === varId;
                return (
                  <button
                    key={key}
                    onClick={() => { setCfg('variableName', key); setOpen(false); setSearch(''); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                      background: isActive ? '#1e3a5f' : 'none', border: 'none', cursor: 'pointer',
                      color: isActive ? '#93c5fd' : '#d1d5db', fontSize: 11, textAlign: 'left',
                    }}
                  >
                    <span style={{
                      fontSize: 9, color: TYPE_COLOR[v.type] ?? '#9ca3af', fontFamily: 'monospace',
                      background: 'rgba(255,255,255,0.07)', border: `1px solid ${TYPE_COLOR[v.type] ?? '#374151'}`,
                      borderRadius: 3, padding: '0 4px', flexShrink: 0,
                    }}>{v.type}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.label ?? v.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Value field */}
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Value</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {valueBound ? (
          <button
            onClick={() => setValueEditorOpen(v => !v)}
            style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
              borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              textAlign: 'left' }}
          >ƒ Edit formula</button>
        ) : (
          <input
            style={{ ...S.fieldInput, flex: 1 }}
            value={typeof val === 'string' ? val : (val == null ? '' : String(val))}
            placeholder="New value or formula"
            onChange={e => setCfg('value', e.target.value || undefined)}
          />
        )}
        <BindingIcon isBound={valueBound} onClick={() => setValueEditorOpen(v => !v)} />
      </div>
      {valueEditorOpen && (
        <FormulaEditor
          label="Value"
          value={(val as FormulaValue) ?? null}
          onChange={v => { setCfg('value', v); setValueEditorOpen(false); }}
          onClose={() => setValueEditorOpen(false)}
          anchorRight={292}
        />
      )}
    </>
  );
}

// ─── Branch condition field (formula-bound) ───────────────────────────────────

function BranchConditionField({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const condition = cfg.condition as FormulaValue | undefined;
  // Branch conditions are always formulas — treat any non-empty string as bound
  // so they show as "ƒ Edit formula" chip instead of a plain text input.
  const isBound = isBoundValue(condition) || (typeof condition === 'string' && condition.trim().length > 0);

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition *</label>
      <p style={{ fontSize: 10, color: '#9ca3af', margin: '0 0 6px' }}>
        Formula that evaluates to true or false. Use{' '}
        <code style={{ background: '#1f2937', padding: '1px 4px', borderRadius: 3 }}>
          {'context.workflow[\'stepId\'].result'}
        </code>
        {' '}to access prior step results.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {isBound ? (
          <button
            onClick={() => setOpen(v => !v)}
            style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
              borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
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
        />
      )}
    </>
  );
}

// ─── NodePropsPanel ────────────────────────────────────────────────────────────

export function NodePropsPanel({
  step,
  onUpdate,
  isFormContext = false,
}: {
  step: ActionStep;
  onUpdate: (patch: Partial<ActionStep>) => void;
  isFormContext?: boolean;
}) {
  const cfg = step.config ?? {};

  function setCfg(key: string, value: unknown) {
    onUpdate({ config: { ...cfg, [key]: value } });
  }

  const isStructuralNode = isStructural(step.type);

  return (
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

      {/* runProjectWorkflow: workflow picker using WorkflowBindButton */}
      {step.type === 'runProjectWorkflow' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Workflow *</label>
          <WorkflowBindButton
            value={(step.config?.workflowId as string) ?? step.action ?? ''}
            onChange={uuid => onUpdate({ action: uuid, config: { ...(step.config ?? {}), workflowId: uuid }, name: uuid })}
          />
        </>
      )}

      {/* Type-specific fields */}
      {step.type === 'branch' && (
        <BranchConditionField cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'multiOptionBranch' && (
        <>
          {/* Branches list */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb' }}>Branches</span>
            <button
              data-testid="branches-add-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#fff', background: '#3b82f6', border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}
              onClick={() => {
                const newBranch: BranchDef = { label: `Value ${(step.branches?.length ?? 0) + 1}`, steps: [{ id: `ph-${Date.now()}`, type: 'graphql' }] };
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
                <div style={{ minWidth: 20, fontSize: 11, color: '#6b7280', textAlign: 'right', flexShrink: 0 }}>
                  {bi + 1}
                </div>
                {/* Value input */}
                <input
                  data-testid={`branch-value-${bi}`}
                  style={{ ...S.fieldInput, flex: 1, color: '#e5e7eb' }}
                  value={branch.label}
                  onChange={e => {
                    const updated = (step.branches ?? []).map((b, i) => i === bi ? { ...b, label: e.target.value } : b);
                    onUpdate({ branches: updated });
                  }}
                />
                {/* Remove button — disabled when only 1 branch remains */}
                <button
                  data-testid={`branch-remove-${bi}`}
                  disabled={(step.branches?.length ?? 0) <= 1}
                  style={{ flexShrink: 0, background: '#fce7f3', border: 'none', borderRadius: '50%', width: 22, height: 22, color: '#db2777', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, cursor: (step.branches?.length ?? 0) <= 1 ? 'not-allowed' : 'pointer', opacity: (step.branches?.length ?? 0) <= 1 ? 0.35 : 1 }}
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
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Items to parse (array) *</label>
          <textarea
            style={{ ...S.fieldInput, minHeight: 64, fontFamily: 'monospace', fontSize: 11 }}
            value={(cfg.items as string) ?? ''}
            placeholder="[]"
            onChange={e => setCfg('items', e.target.value)}
          />
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
          <select style={S.fieldSelect}>
            <option value="home">🏠 Home</option>
          </select>
        </>
      )}

      {step.type === 'pageLoader' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Loader on page change</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Show page loader</span>
            <div style={S.toggleGroup}>
              <button style={S.toggleBtn(!!(cfg.showLoader))} onClick={() => setCfg('showLoader', true)}>On</button>
              <button style={S.toggleBtn(!(cfg.showLoader))} onClick={() => setCfg('showLoader', false)}>Off</button>
            </div>
          </div>
          {cfg.showLoader && (
            <>
              <label style={{ ...S.fieldLabel, marginTop: 10 }}>Loader color</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={(cfg.loaderColor as string) ?? '#000000'} onChange={e => setCfg('loaderColor', e.target.value)} style={{ width: 28, height: 28, border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer' }} />
                <input style={{ ...S.fieldInput, flex: 1 }} value={(cfg.loaderColor as string) ?? '#000000'} onChange={e => setCfg('loaderColor', e.target.value)} />
              </div>
            </>
          )}
        </>
      )}

      {step.type === 'changeLanguage' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Language *</label>
          <select style={S.fieldSelect}><option value="">Select a value</option></select>
        </>
      )}

      {step.type === 'changeVariableValue' && (
        <ChangeVariableValueConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'resetVariableValue' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Variables</span>
            <button style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <select style={{ ...S.fieldSelect, flex: 1 }}><option value="">Choose a variable</option></select>
            <button style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>−</button>
          </div>
        </>
      )}

      {step.type === 'fetchCollection' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Collection *</label>
          <select style={S.fieldSelect}><option value="">Choose a collection</option></select>
        </>
      )}

      {step.type === 'fetchCollectionsParallel' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Collections</span>
            <button style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <select style={{ ...S.fieldSelect, flex: 1 }}><option value="">Choose a collection</option></select>
            <button style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>−</button>
          </div>
        </>
      )}

      {step.type === 'updateCollection' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Collection *</label>
          <select style={S.fieldSelect}><option value="">Choose an collection</option></select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Update type</label>
          <select style={S.fieldSelect}><option value="replaceAll">Replace all</option></select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Data *</label>
          <input style={S.fieldInput} placeholder="New collection data" />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Refresh filters</span>
            <div style={S.toggleGroup}>
              <button style={S.toggleBtn(!!(cfg.refreshFilters))} onClick={() => setCfg('refreshFilters', true)}>On</button>
              <button style={S.toggleBtn(!(cfg.refreshFilters))} onClick={() => setCfg('refreshFilters', false)}>Off</button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Refresh sort</span>
            <div style={S.toggleGroup}>
              <button style={S.toggleBtn(!!(cfg.refreshSort))} onClick={() => setCfg('refreshSort', true)}>On</button>
              <button style={S.toggleBtn(!(cfg.refreshSort))} onClick={() => setCfg('refreshSort', false)}>Off</button>
            </div>
          </div>
        </>
      )}

      {step.type === 'executeComponentAction' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Component</label>
          <select style={S.fieldSelect}><option value="">Component</option></select>
        </>
      )}

      {step.type === 'returnValue' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Type</label>
          <select style={S.fieldSelect} value={(cfg.valueType as string) ?? 'text'} onChange={e => setCfg('valueType', e.target.value)}>
            <option value="text">T Text</option>
            <option value="number">N Number</option>
            <option value="boolean">B Boolean</option>
            <option value="object">O Object</option>
            <option value="array">A Array</option>
          </select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Value *</label>
          <textarea style={{ ...S.fieldInput, minHeight: 56 }} placeholder="Enter a value" value={(cfg.value as string) ?? ''} onChange={e => setCfg('value', e.target.value)} />
        </>
      )}

      {step.type === 'timeDelay' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Time (ms) *</label>
          <input style={S.fieldInput} placeholder="Enter a value" type="number" value={(cfg.time as string) ?? ''} onChange={e => setCfg('time', e.target.value)} />
        </>
      )}

      {step.type === 'uploadFile' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Select upload element from this page *</label>
          <select style={S.fieldSelect}><option value="">Select an upload element</option></select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Tag for this file</label>
          <input style={S.fieldInput} placeholder="Enter a value" value={(cfg.tag as string) ?? ''} onChange={e => setCfg('tag', e.target.value)} />
        </>
      )}

      {step.type === 'stopPropagation' && (
        <div style={S.infoBox}>
          This action is executing Event.stopPropagation() and Event.preventDefault(). The recommended practice is to set this action as the first action of your workflow.
        </div>
      )}

      {step.type === 'copyToClipboard' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Value *</label>
          <textarea style={{ ...S.fieldInput, minHeight: 56 }} placeholder="Enter a value" value={(cfg.value as string) ?? ''} onChange={e => setCfg('value', e.target.value)} />
        </>
      )}

      {step.type === 'downloadFileFromUrl' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>File URL *</label>
          <input style={S.fieldInput} value={(cfg.url as string) ?? ''} onChange={e => setCfg('url', e.target.value)} />
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>File name</label>
          <input style={S.fieldInput} placeholder="Optional filename" value={(cfg.filename as string) ?? ''} onChange={e => setCfg('filename', e.target.value)} />
        </>
      )}

      {step.type === 'createUrlFromBase64' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Base64</label>
          <input style={S.fieldInput} placeholder="Enter a value" value={(cfg.base64 as string) ?? ''} onChange={e => setCfg('base64', e.target.value)} />
        </>
      )}

      {step.type === 'encodeFileAsBase64' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>File object *</label>
          <select style={S.fieldSelect}><option value="">Select a file variable</option></select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Output format</label>
          <div style={S.toggleGroup}>
            <button style={S.toggleBtn((cfg.outputFormat as string) !== 'base64')} onClick={() => setCfg('outputFormat', 'dataUrl')}>Data URL</button>
            <button style={S.toggleBtn((cfg.outputFormat as string) === 'base64')} onClick={() => setCfg('outputFormat', 'base64')}>Base64</button>
          </div>
        </>
      )}

      {step.type === 'openPopup' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Popup model</label>
          <select style={S.fieldSelect}><option value="">Choose a popup model</option></select>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Wait close event</span>
            <div style={S.toggleGroup}>
              <button style={S.toggleBtn(!!(cfg.waitClose))} onClick={() => setCfg('waitClose', true)}>On</button>
              <button style={S.toggleBtn(!(cfg.waitClose))} onClick={() => setCfg('waitClose', false)}>Off</button>
            </div>
          </div>
        </>
      )}

      {step.type === 'closeAllPopups' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Popup model</label>
          <select style={S.fieldSelect}><option value="">Choose a popup model</option></select>
        </>
      )}

      {step.type === 'setFormState' && (
        <SetFormStateConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'submitForm' && (
        <div style={S.infoBox}>Submit the form</div>
      )}

      {step.type === 'resetForm' && (
        <ResetFormConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'graphql' && (
        <GraphQLStepConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'fetchData' && (
        <FetchDataStepConfig cfg={cfg} setCfg={setCfg} />
      )}

      <label style={{ ...S.fieldLabel, marginTop: 12 }}>Description</label>
      <textarea
        style={{ ...S.fieldInput, minHeight: 64, resize: 'vertical' }}
        value={step.description ?? ''}
        placeholder="Description…"
        onChange={e => onUpdate({ description: e.target.value })}
      />
    </div>
  );
}

