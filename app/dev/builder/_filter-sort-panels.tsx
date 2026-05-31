'use client';

/**
 * _filter-sort-panels.tsx
 *
 * Shared FilterPanel, SortPanel, and associated types/components
 * extracted from _tables-designer.tsx for reuse in workflow config panels.
 *
 * Exports:
 *  - FilterCondition, FilterGroup, SortSpec (types)
 *  - FilterPanel, SortPanel (components)
 *  - FILTER_OPERATORS (constant)
 *  - filterPanelStyles (shared style constants)
 */

import React from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FilterCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
  active: boolean;
}

export interface FilterGroup {
  id: string;
  logic: 'And' | 'Or';
  conditions: FilterCondition[];
}

export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const FILTER_OPERATORS = [
  'Is', 'Is not', 'Contains', 'Does not contain',
  'Starts with', 'Ends with', 'Is empty', 'Is not empty',
];

export function uid() { return Math.random().toString(36).slice(2, 9); }

// ─── Style constants ──────────────────────────────────────────────────────────

export const filterPanelStyles = {
  BTN: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', fontSize: 12, fontWeight: 500,
    background: 'transparent', color: '#94a3b8',
    border: '1px solid transparent', borderRadius: 5,
    cursor: 'pointer', whiteSpace: 'nowrap',
  } as React.CSSProperties,

  BTN_PRIMARY: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', fontSize: 12, fontWeight: 600,
    background: '#4f46e5', color: '#fff',
    border: '1px solid #4f46e5', borderRadius: 5,
    cursor: 'pointer', whiteSpace: 'nowrap',
  } as React.CSSProperties,

  INPUT_STYLE: {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
    padding: '8px 12px', fontSize: 13, color: '#e2e8f0', outline: 'none',
    width: '100%', boxSizing: 'border-box',
  } as React.CSSProperties,

  SELECT_STYLE: {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
    padding: '8px 12px', fontSize: 13, color: '#e2e8f0', outline: 'none',
    width: '100%', boxSizing: 'border-box', cursor: 'pointer',
  } as React.CSSProperties,

  PANEL_STYLE: {
    position: 'absolute', zIndex: 50,
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    minWidth: 280,
  } as React.CSSProperties,
};

// ─── Toggle ───────────────────────────────────────────────────────────────────

export function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 28, height: 15, borderRadius: 8,
        cursor: onClick ? 'pointer' : 'default',
        background: on ? '#4f46e5' : '#374151',
        position: 'relative', flexShrink: 0, transition: 'background 0.15s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 14 : 2,
        width: 11, height: 11, borderRadius: '50%',
        background: '#fff', transition: 'left 0.15s',
      }} />
    </div>
  );
}

// ─── PanelFooter ──────────────────────────────────────────────────────────────

export function PanelFooter({ onReset, onSave }: { onReset: () => void; onSave: () => void }) {
  const { BTN, BTN_PRIMARY } = filterPanelStyles;
  return (
    <div style={{ padding: '8px 14px', borderTop: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
      <button onClick={onReset} style={{ ...BTN, fontSize: 12 }}>Reset</button>
      <button onClick={onSave} style={{ ...BTN_PRIMARY, padding: '5px 16px' }}>Save</button>
    </div>
  );
}

// ─── FilterRow ────────────────────────────────────────────────────────────────

function FilterRow({
  cond, allCols, prefix, onChange, onRemove,
}: {
  cond: FilterCondition; allCols: string[]; prefix: string;
  onChange: (p: Partial<FilterCondition>) => void; onRemove: () => void;
}) {
  const { SELECT_STYLE, INPUT_STYLE } = filterPanelStyles;
  const s: React.CSSProperties = { ...SELECT_STYLE, fontSize: 11, padding: '3px 6px' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px' }}>
      <span style={{ fontSize: 11, color: '#475569', width: 40 }}>{prefix}</span>
      <select value={cond.field} onChange={(e) => onChange({ field: e.target.value })} style={{ ...s, width: 110 }}>
        {allCols.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={cond.operator} onChange={(e) => onChange({ operator: e.target.value })} style={{ ...s, width: 110 }}>
        {FILTER_OPERATORS.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {!['Is empty', 'Is not empty'].includes(cond.operator) && (
        <input
          value={cond.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="Enter a value"
          style={{ ...INPUT_STYLE, flex: 1, fontSize: 11, padding: '3px 6px' }}
        />
      )}
      <Toggle on={cond.active} onClick={() => onChange({ active: !cond.active })} />
      <button onClick={onRemove} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13 }}>⋮</button>
    </div>
  );
}

// ─── FilterPanel ──────────────────────────────────────────────────────────────

export function FilterPanel({
  conditions, groups, allCols, onChange, onChangeGroups, onReset, onSave,
}: {
  conditions: FilterCondition[];
  groups: FilterGroup[];
  allCols: string[];
  onChange: (v: FilterCondition[]) => void;
  onChangeGroups: (v: FilterGroup[]) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const { BTN, PANEL_STYLE, SELECT_STYLE } = filterPanelStyles;
  const addCondition = () =>
    onChange([...conditions, { id: uid(), field: allCols[0] ?? 'id', operator: 'Is', value: '', active: true }]);
  const addGroup = () =>
    onChangeGroups([...groups, {
      id: uid(), logic: 'And',
      conditions: [{ id: uid(), field: allCols[0] ?? 'id', operator: 'Is', value: '', active: true }],
    }]);
  const empty = conditions.length === 0 && groups.length === 0;

  return (
    <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 560, maxHeight: 440, overflow: 'auto' }}>
      {empty && (
        <div style={{ padding: '14px 16px', fontSize: 12, color: '#475569' }}>
          <strong style={{ color: '#94a3b8' }}>Use a filter to:</strong><br />
          - Show only data with a certain tag.<br />
          - Hide data with no value.
        </div>
      )}
      {conditions.map((cond) => (
        <FilterRow key={cond.id} cond={cond} allCols={allCols} prefix="Where"
          onChange={(p) => onChange(conditions.map((c) => c.id === cond.id ? { ...c, ...p } : c))}
          onRemove={() => onChange(conditions.filter((c) => c.id !== cond.id))}
        />
      ))}
      {groups.map((group) => (
        <div key={group.id} style={{ margin: '4px 12px', border: '1px solid #1e3a5f', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(79,70,229,0.05)' }}>
            <select
              value={group.logic}
              onChange={(e) => onChangeGroups(groups.map((g) => g.id === group.id ? { ...g, logic: e.target.value as 'And' | 'Or' } : g))}
              style={{ ...SELECT_STYLE, width: 70, fontSize: 11, padding: '2px 4px' }}
            >
              <option>And</option><option>Or</option>
            </select>
            <span style={{ fontSize: 12, color: '#60a5fa', flex: 1 }}>⚷ Condition group ({group.conditions.length} conditions)</span>
            <button onClick={() => onChangeGroups(groups.filter((g) => g.id !== group.id))} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer' }}>⋮</button>
          </div>
          {group.conditions.map((cond) => (
            <FilterRow key={cond.id} cond={cond} allCols={allCols} prefix="Where"
              onChange={(p) => onChangeGroups(groups.map((g) => g.id === group.id ? {
                ...g, conditions: g.conditions.map((c) => c.id === cond.id ? { ...c, ...p } : c),
              } : g))}
              onRemove={() => onChangeGroups(groups.map((g) => g.id === group.id ? {
                ...g, conditions: g.conditions.filter((c) => c.id !== cond.id),
              } : g))}
            />
          ))}
          <div style={{ padding: '6px 12px' }}>
            <button
              onClick={() => onChangeGroups(groups.map((g) => g.id === group.id ? {
                ...g, conditions: [...g.conditions, { id: uid(), field: allCols[0] ?? 'id', operator: 'Is', value: '', active: true }],
              } : g))}
              style={{ ...BTN, fontSize: 11, color: '#6366f1', padding: '2px 0' }}
            >+ Add condition</button>
          </div>
        </div>
      ))}
      <div style={{ padding: '8px 14px', display: 'flex', gap: 16, borderTop: empty ? 'none' : '1px solid #1e293b' }}>
        <button onClick={addCondition} style={{ ...BTN, fontSize: 11, color: '#94a3b8', padding: '2px 0' }}>+ Add condition</button>
        <button onClick={addGroup} style={{ ...BTN, fontSize: 11, color: '#94a3b8', padding: '2px 0' }}>+ Add condition group</button>
      </div>
      <PanelFooter onReset={onReset} onSave={onSave} />
    </div>
  );
}

// ─── SortPanel ────────────────────────────────────────────────────────────────

export function SortPanel({
  pending, allCols, onChange, onReset, onSave,
}: {
  pending: SortSpec[];
  allCols: string[];
  onChange: (v: SortSpec[]) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const { BTN, PANEL_STYLE, SELECT_STYLE } = filterPanelStyles;
  const s: React.CSSProperties = { ...SELECT_STYLE, fontSize: 11, padding: '3px 6px' };
  return (
    <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 400 }}>
      <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pending.length === 0 && <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>No sorts applied.</p>}
        {pending.map((spec, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#475569', width: 44 }}>Sort by</span>
            <select value={spec.field} onChange={(e) => onChange(pending.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} style={{ ...s, flex: 1 }}>
              {allCols.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={spec.dir} onChange={(e) => onChange(pending.map((x, j) => j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x))} style={{ ...s, width: 80 }}>
              <option value="asc">↑ Asc</option>
              <option value="desc">↓ Desc</option>
            </select>
            <button onClick={() => onChange(pending.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14 }}>×</button>
          </div>
        ))}
        <button
          onClick={() => onChange([...pending, { field: allCols[0] ?? 'id', dir: 'asc' }])}
          style={{ ...BTN, fontSize: 11, color: '#94a3b8', padding: '3px 0', alignSelf: 'flex-start' }}
        >+ Add sort</button>
      </div>
      <PanelFooter onReset={onReset} onSave={onSave} />
    </div>
  );
}
