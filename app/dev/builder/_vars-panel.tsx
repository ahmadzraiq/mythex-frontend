'use client';

/**
 * _vars-panel.tsx
 *
 * Variables panel for the Builder Left Panel.
 * Extracted from _panel-left.tsx.
 *
 * Exports:
 *  - VarsPanel              — full vars panel with three sections
 *  - CustomVarsSection      — named custom variables section
 *  - VarsWorkflowsSection   — page workflows section
 *  - VarsFormulasSection    — page formulas section
 */

import React, { useState, useRef, useCallback } from 'react';
import { useBuilderStore } from './_store';
import type { BuilderStore, CustomVar } from './_store';
import { DataTab, type DataTabSlideState } from './_data-tab';
import { WorkflowCanvas } from './_workflow-canvas';
import type { WorkflowCanvasTarget } from './_store';

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

export function CustomVarsSection() {
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

export function VarsWorkflowsSection() {
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

export function VarsFormulasSection() {
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

export function VarsPanel() {
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
