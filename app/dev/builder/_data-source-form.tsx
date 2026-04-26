'use client';

/**
 * _data-source-form.tsx
 *
 * Data source configuration forms (REST & GraphQL) for the DataTab.
 * Extracted from _data-tab.tsx.
 *
 * Exports:
 *  - TypePicker             — choose REST vs GraphQL
 *  - RestForm               — REST datasource config form
 *  - GraphQLForm            — GraphQL datasource config form
 *  - DataSourceSlideContent — orchestrates type picker + form
 *  - FolderPicker           — folder selector for datasources and variables
 *  - SECTION_HDR, DS_FORM_BTN (shared styles)
 *  - SectionRow, KvRow, OnOffRow, SimpleToggleRow (shared primitives)
 *  - useFormulaField, FormulaFieldState
 */

import React, { useState, useCallback, useRef, lazy, Suspense } from 'react';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
const CodeMirror = lazy(() => import('@uiw/react-codemirror'));
import ReactDOM from 'react-dom';
import { useBuilderStore, type DataSourceConfig, type DataSourceParam, type Folder, persistPreviewData } from './_store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL } from './_slide-panel';
import { BindingIcon, isBoundValue } from './_formula-panel';
import { FormulaEditor, type FormulaValue, storedValueToFormula, evaluateFormula } from './_formula-editor';
import { Chevron } from './_layers-panel';
import { OptionPickerDropdown, BoundField, BoundToggleField, PillToggle } from './_workflow-node-configs';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';

// ─── Fetch result helpers ─────────────────────────────────────────────────────

export const SLIDE_WITH_RESULT = 660;

export interface FetchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: unknown;
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function resolveStoreKey(key: string): string {
  return UUID_RE.test(key) ? `collections.${key}` : key;
}

export function extractByPath(data: unknown, path: string): unknown {
  if (!path) return data;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, data);
}

// ─── JSON result tree viewer ──────────────────────────────────────────────────

function JsonNode({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = React.useState(depth < 2);
  if (value === null) return <span style={{ color: '#9ca3af' }}>null</span>;
  if (value === undefined) return <span style={{ color: '#9ca3af' }}>undefined</span>;
  if (typeof value === 'string') return <span style={{ color: '#86efac' }}>"{value}"</span>;
  if (typeof value === 'number') return <span style={{ color: '#93c5fd' }}>{value}</span>;
  if (typeof value === 'boolean') return <span style={{ color: '#fcd34d' }}>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: '#6b7280' }}>[]</span>;
    return (
      <span>
        <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#9ca3af', fontSize: 11 }}>
          {open ? '▾' : '▸'} Array({value.length})
        </button>
        {open && (
          <div style={{ paddingLeft: 14 }}>
            {value.slice(0, 20).map((item, i) => (
              <div key={i}><span style={{ color: '#6b7280' }}>{i}: </span><JsonNode value={item} depth={depth + 1} /></div>
            ))}
            {value.length > 20 && <div style={{ color: '#6b7280' }}>… {value.length - 20} more</div>}
          </div>
        )}
      </span>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span style={{ color: '#6b7280' }}>{'{}'}</span>;
    return (
      <span>
        <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#9ca3af', fontSize: 11 }}>
          {open ? '▾' : '▸'} Object({entries.length})
        </button>
        {open && (
          <div style={{ paddingLeft: 14 }}>
            {entries.slice(0, 30).map(([k, v]) => (
              <div key={k}><span style={{ color: '#c4b5fd' }}>{k}: </span><JsonNode value={v} depth={depth + 1} /></div>
            ))}
            {entries.length > 30 && <div style={{ color: '#6b7280' }}>… {entries.length - 30} more</div>}
          </div>
        )}
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

export function FetchResultPanel({ result }: { result: FetchState }) {
  const isSuccess = result.status === 'success';
  return (
    <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid #1f2937', display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>Result</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          background: isSuccess ? '#064e3b' : '#7f1d1d',
          color: isSuccess ? '#34d399' : '#f87171',
        }}>
          {isSuccess ? 'Success' : 'Error'}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, color: '#f3f4f6' }}>
        {result.status === 'error'
          ? <span style={{ color: '#f87171' }}>{result.error}</span>
          : <JsonNode value={result.data} depth={0} />
        }
      </div>
    </div>
  );
}

// ─── Shared constants ─────────────────────────────────────────────────────────

export const SLIDE_DEFAULT = 320;
// Horizontal anchor for FormulaEditor popovers: data-tab left panel (248px) + slide width (320px)
export const FORMULA_ANCHOR_LEFT = 248 + 320;

// ─── Shared styles ────────────────────────────────────────────────────────────

export const SECTION_HDR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderBottom: '1px solid #1f2937',
};
export const SEC_LABEL: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#d1d5db', whiteSpace: 'nowrap', flexShrink: 0,
};
export const EMPTY: React.CSSProperties = {
  fontSize: 11, color: '#4b5563', fontStyle: 'italic',
  padding: '8px 12px',
};
export const ADD_BTN: React.CSSProperties = {
  padding: '3px 10px', background: '#1d4ed8', border: 'none',
  borderRadius: 4, color: '#fff', fontSize: 10, cursor: 'pointer',
};
export const TYPE_COLOR: Record<string, string> = { rest: '#34d399', graphql: '#f59e0b' };

// ─── A. Data Sources ──────────────────────────────────────────────────────────

interface DataSourceSlidePanelProps {
  initial: Partial<DataSourceConfig>;
  onSave: (cfg: DataSourceConfig) => void;
  onClose: () => void;
}

// ─── Key-value entry with explicit bind tracking ───────────────────────────────

/** A single row in a headers / queryParams / variables list */
export interface KvEntry {
  key: string;
  value: string;
  /** whether the VALUE field is in formula mode */
  valueBound: boolean;
  /** whether the KEY field is in formula mode */
  keyBound: boolean;
}

/**
 * Detect if a string is a stored formula value. Handles three formats:
 *  1. "{{route.slug}}"           — simple interpolation
 *  2. '{"formula":"formatCurrency(...)"}' — complex formula (JSON-stringified object)
 *  3. '{"formula":"route.slug"}' — legacy formula object
 */
// ─── Context & entry resolution helpers ──────────────────────────────────────

export function buildContext(): Record<string, unknown> {
  const zustandData = useSduiStore.getState().data;
  const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
  return { ...zustandData, ...vs };
}

export function resolveEntryValue(entry: { value: string; valueBound: boolean }): unknown {
  if (!entry.valueBound) return entry.value;
  const ctx = buildContext();
  try {
    const parsed = JSON.parse(entry.value);
    if (typeof parsed === 'object' && parsed !== null) {
      return JSON.parse(JSON.stringify(parsed, (_k, v) => {
        if (typeof v !== 'string') return v;
        const match = v.match(/^\{\{([^}]+)\}\}$/);
        if (!match) return v;
        const res = evaluateFormula(match[1].trim(), ctx);
        return res.value !== undefined ? res.value : v;
      }));
    }
  } catch { /* not JSON */ }
  const formula = entry.value.replace(/^\{\{([^}]+)\}\}$/, '$1').trim();
  const res = evaluateFormula(formula, ctx);
  return res.value !== undefined ? res.value : entry.value;
}

function isFormulaString(v: string): boolean {
  if (/\{\{[^}]+\}\}/.test(v)) return true;
  try {
    const p = JSON.parse(v);
    return typeof p === 'object' && p !== null && !Array.isArray(p)
      && 'formula' in p;
  } catch { return false; }
}

function toKvEntries(items: { key: string; value: string }[]): KvEntry[] {
  return items.map(i => ({
    key: i.key,
    value: i.value,
    valueBound: isFormulaString(i.value),
    keyBound: isFormulaString(i.key),
  }));
}

// ─── GraphQL query formatter ───────────────────────────────────────────────────

function formatGql(raw: string): string {
  const lines = raw
    .replace(/\{/g, ' {\n')
    .replace(/\}/g, '\n}\n')
    .replace(/,\s*/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  let depth = 0;
  const out: string[] = [];
  for (const line of lines) {
    if (line === '}') depth = Math.max(0, depth - 1);
    out.push('  '.repeat(depth) + line);
    if (line.endsWith('{')) depth++;
  }
  return out.join('\n');
}

// ─── GraphQL syntax-highlighted editor ────────────────────────────────────────

function highlightGql(code: string): string {
  const esc = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/(#[^\n]*)/g, '<span style="color:#6b7280;font-style:italic">$1</span>')
    .replace(/\b(query|mutation|subscription|fragment|on|true|false|null)\b/g,
      '<span style="color:#60a5fa;font-weight:600">$1</span>')
    .replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g,
      '<span style="color:#34d399">$1</span>')
    .replace(/(&quot;[^&]*&quot;)/g, '<span style="color:#fbbf24">$1</span>')
    .replace(/([{}()[\]!|])/g, '<span style="color:#94a3b8">$1</span>')
    .replace(/(\$[a-zA-Z_][a-zA-Z0-9_]*)/g, '<span style="color:#c084fc">$1</span>');
}

export function GqlEditor({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const lines = value.split('\n').length;
  const displayLines = Math.max(lines, 8);

  const syncScroll = () => {
    if (taRef.current && preRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const FONT: React.CSSProperties = {
    fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
    fontSize: 12, lineHeight: '1.7', tabSize: 2,
  };
  const lineNumbers = Array.from({ length: displayLines }, (_, i) => i + 1).join('\n');

  return (
    <div style={{ position: 'relative', background: '#0a0e1a', border: '1px solid #1e3050', borderRadius: 6, overflow: 'hidden', display: 'flex' }}>
      {/* Line numbers */}
      <pre aria-hidden style={{ ...FONT, margin: 0, padding: '10px 8px', background: '#060a14', color: '#334155', borderRight: '1px solid #1e3050', userSelect: 'none', minWidth: 34, textAlign: 'right', flexShrink: 0, overflowY: 'hidden', pointerEvents: 'none' }}>{lineNumbers}</pre>
      {/* Syntax highlight layer */}
      <pre ref={preRef} aria-hidden
        style={{ ...FONT, position: 'absolute', left: 42, top: 0, right: 0, bottom: 0, margin: 0, padding: '10px 10px', color: '#e2e8f0', pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'pre', wordBreak: 'normal' }}
        dangerouslySetInnerHTML={{ __html: highlightGql(value) || `<span style="color:#334155">${placeholder ?? ''}</span>` }}
      />
      {/* Editable textarea */}
      <textarea
        ref={taRef}
        data-testid="ds-gql-query"
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        rows={displayLines}
        style={{ ...FONT, position: 'relative', zIndex: 1, flex: 1, margin: 0, padding: '10px 10px', background: 'transparent', color: 'transparent', caretColor: '#e2e8f0', border: 'none', outline: 'none', resize: 'none', overflowY: 'auto', whiteSpace: 'pre', wordBreak: 'normal' }}
      />
    </div>
  );
}

// ─── Formula field state — one open at a time ──────────────────────────────────

export type FormulaFieldState = { open: boolean; fieldId: string } | null;

export function useFormulaField(fieldId: string, formulaState: FormulaFieldState, setFormulaState: (s: FormulaFieldState) => void) {
  const isOpen = formulaState?.fieldId === fieldId && formulaState?.open;
  const open = () => setFormulaState({ open: true, fieldId });
  const close = () => setFormulaState(null);
  return { isOpen, open, close };
}

// ─── Shared form primitives ────────────────────────────────────────────────────

/** Section header: label + optional bind icon + Add button */
export function SectionRow({
  label, onAdd, addTestId, bindActive, onBind, onEditFormula,
}: {
  label: string;
  onAdd?: () => void;
  addTestId?: string;
  bindActive?: boolean;
  onBind?: () => void;
  /** Called when clicking the ƒ Edit formula button in the bound state. */
  onEditFormula?: () => void;
}) {
  if (bindActive && onEditFormula) {
    // Bound state: show label + ƒ Edit formula button + active BindingIcon
    return (
      <div style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#d1d5db', display: 'block', marginBottom: 4 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={onEditFormula}
            style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
              borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              textAlign: 'left' }}
          >
            ƒ Edit formula
          </button>
          <BindingIcon isBound onClick={onEditFormula} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#d1d5db' }}>{label}</span>
      {onBind && <BindingIcon isBound={!!bindActive} onClick={onBind} />}
      <span style={{ flex: 1 }} />
      {onAdd && (
        <button
          data-testid={addTestId}
          onClick={onAdd}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#1e3a5f', border: '1px solid #2563eb', borderRadius: 6, color: '#93c5fd', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}
        >
          + Add
        </button>
      )}
    </div>
  );
}

/**
 * Key-value row — key and value side-by-side, each with its own bind icon.
 */
export function KvRow({
  index, entry, onEntryChange, onRemove,
  formulaState, setFormulaState, fieldSuffix,
  testIdPrefix,
}: {
  index: number;
  entry: KvEntry;
  onEntryChange: (patch: Partial<KvEntry>) => void;
  onRemove: () => void;
  formulaState: FormulaFieldState;
  setFormulaState: (s: FormulaFieldState) => void;
  fieldSuffix: string;
  testIdPrefix: string;
}) {
  const keyFieldId = `${fieldSuffix}-key-${index}`;
  const valFieldId = `${fieldSuffix}-val-${index}`;
  const { isOpen: keyFEOpen, open: openKeyFE, close: closeKeyFE } = useFormulaField(keyFieldId, formulaState, setFormulaState);
  const { isOpen: valFEOpen, open: openValFE, close: closeValFE } = useFormulaField(valFieldId, formulaState, setFormulaState);

  const CELL: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 };
  const CELL_LABEL: React.CSSProperties = { fontSize: 10, color: '#6b7280', fontWeight: 500 };
  const FIELD_ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 3 };
  const FORMULA_BTN: React.CSSProperties = { flex: 1, ...SP_INPUT, background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: 10, padding: '3px 6px' };

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>

        {/* Key cell */}
        <div style={CELL}>
          <span style={CELL_LABEL}>Key</span>
          <div style={FIELD_ROW}>
            <BindingIcon data-testid={`${testIdPrefix}-key-bind-${index}`} isBound={entry.keyBound} onClick={openKeyFE} />
            {entry.keyBound ? (
              <button data-testid={`${testIdPrefix}-key-formula-${index}`} onClick={openKeyFE} style={FORMULA_BTN} title={entry.key}>ƒ Edit formula</button>
            ) : (
                <input
                data-testid={`${testIdPrefix}-key-${index}`}
                value={entry.key}
                onChange={e => onEntryChange({ key: e.target.value })}
                placeholder="key"
                style={{ ...SP_INPUT, flex: 1, padding: '4px 6px' }}
              />
            )}
              </div>
            </div>

        {/* Value cell */}
        <div style={CELL}>
          <span style={CELL_LABEL}>Value</span>
          <div style={FIELD_ROW}>
            <BindingIcon data-testid={`${testIdPrefix}-val-bind-${index}`} isBound={entry.valueBound} onClick={openValFE} />
            {entry.valueBound ? (
              <button data-testid={`${testIdPrefix}-val-formula-${index}`} onClick={openValFE} style={FORMULA_BTN} title={entry.value}>ƒ Edit formula</button>
            ) : (
                <input
                data-testid={`${testIdPrefix}-val-${index}`}
                value={entry.value}
                onChange={e => onEntryChange({ value: e.target.value })}
                  placeholder="value"
                style={{ ...SP_INPUT, flex: 1, padding: '4px 6px' }}
                />
            )}
              </div>
          </div>

        {/* Remove */}
        <button onClick={onRemove} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 16, padding: '0 2px', flexShrink: 0, lineHeight: 1, marginBottom: 2 }}>×</button>
            </div>

      {/* Formula editors
          IMPORTANT: FormulaEditor.apply() calls both onChange(v) AND onClose().
          So onClose must NOT reset the bound state — it just closes the UI.
          Unbind is handled by onChange('') which the editor's "Unbind" button sends. */}
      {keyFEOpen && (
        <FormulaEditor
          label={`${entry.key || 'key'} (key)`}
          value={entry.keyBound ? entry.key as unknown as FormulaValue : ''}
          anchorLeft={FORMULA_ANCHOR_LEFT}
          onChange={v => {
            if (!v && v !== 0) {
              // Unbind: editor sent empty value
              onEntryChange({ key: '', keyBound: false });
            } else {
              const raw = typeof v === 'string' ? v : JSON.stringify(v);
              onEntryChange({ key: raw, keyBound: true });
            }
            closeKeyFE();
          }}
          onClose={closeKeyFE}
        />
      )}
      {valFEOpen && (
        <FormulaEditor
          label={`${entry.key || 'value'} (value)`}
          value={entry.valueBound ? entry.value as unknown as FormulaValue : ''}
          anchorLeft={FORMULA_ANCHOR_LEFT}
          onChange={v => {
            if (!v && v !== 0) {
              // Unbind: editor sent empty value
              onEntryChange({ value: '', valueBound: false });
            } else {
              const raw = typeof v === 'string' ? v : JSON.stringify(v);
              onEntryChange({ value: raw, valueBound: true });
            }
            closeValFE();
          }}
          onClose={closeValFE}
        />
      )}
                </div>
  );
}

/** On/Off pill toggle + bind button (for proxy field) */
export function OnOffRow({
  label, value, onChange, formulaState, setFormulaState, fieldId,
}: {
  label: string; value: boolean | FormulaValue; onChange: (v: boolean | FormulaValue) => void;
  formulaState: FormulaFieldState; setFormulaState: (s: FormulaFieldState) => void;
  fieldId: string;
}) {
  const isBound = isBoundValue(value as FormulaValue);
  const { isOpen, open, close } = useFormulaField(fieldId, formulaState, setFormulaState);

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#d1d5db', flex: 1 }}>{label}</span>
        <BindingIcon isBound={isBound} onClick={open} />
        {!isBound && (
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #374151' }}>
            <button onClick={() => onChange(true)} style={{ padding: '4px 12px', fontSize: 11, cursor: 'pointer', border: 'none', background: value === true ? '#1e3a5f' : 'transparent', color: value === true ? '#93c5fd' : '#6b7280', fontWeight: value === true ? 600 : 400 }}>On</button>
            <button onClick={() => onChange(false)} style={{ padding: '4px 12px', fontSize: 11, cursor: 'pointer', border: 'none', borderLeft: '1px solid #374151', background: value !== true ? '#1f2937' : 'transparent', color: value !== true ? '#d1d5db' : '#6b7280', fontWeight: value !== true ? 600 : 400 }}>Off</button>
                </div>
            )}
        {isBound && (
          <button onClick={open} style={{ ...SP_INPUT, background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace' }}>ƒ Edit formula</button>
            )}
          </div>
      {isOpen && (
        <FormulaEditor
          label={label}
          value={isBound ? value as FormulaValue : ''}
          anchorLeft={FORMULA_ANCHOR_LEFT}
          expectedType="boolean"
          onChange={v => { onChange(v); close(); }}
          onClose={() => { if (isBound) onChange(false); close(); }}
        />
      )}
    </div>
  );
}

/** Simple toggle row */
export function SimpleToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#d1d5db' }}>{label}</span>
      <button type="button" onClick={() => onChange(!value)}
        style={{ width: 40, height: 22, borderRadius: 11, flexShrink: 0, background: value ? '#3b82f6' : '#374151', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.15s' }}>
        <span style={{ position: 'absolute', top: 3, left: value ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
                  </button>
            </div>
  );
}

// ─── Step 1: Type Picker ───────────────────────────────────────────────────────

export function TypePicker({ onSelect }: { onSelect: (t: 'rest' | 'graphql') => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px 16px', gap: 12 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Choose a data source type:</div>
      <button data-testid="ds-pick-rest" onClick={() => onSelect('rest')}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px', background: '#0f172a', border: '1px solid #1f2937', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s' }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = '#34d399')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = '#1f2937')}>
        <span style={{ marginTop: 2, flexShrink: 0, width: 28, height: 28, borderRadius: 6, background: '#06301e', border: '1px solid #34d39955', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#34d399', fontWeight: 700 }}>⇄</span>
            <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6', marginBottom: 4 }}>REST</div>
          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>Connect to any HTTP endpoint — GET, POST, PUT, DELETE. Supports query params, headers, and body.</div>
              </div>
                  </button>
      <button data-testid="ds-pick-graphql" onClick={() => onSelect('graphql')}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px', background: '#0f172a', border: '1px solid #1f2937', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s' }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = '#f59e0b')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = '#1f2937')}>
        <span style={{ marginTop: 2, flexShrink: 0, width: 28, height: 28, borderRadius: 6, background: '#2a1a00', border: '1px solid #f59e0b55', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#f59e0b', fontWeight: 700 }}>⬡</span>
            <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6', marginBottom: 4 }}>GraphQL</div>
          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>Write a query or mutation. Variables support <code style={{ color: '#818cf8' }}>{'{{formulas}}'}</code> for dynamic values.</div>
              </div>
      </button>
            </div>
  );
}

// ─── REST Configuration Form ──────────────────────────────────────────────────

export function RestForm({ initial, onSave, onBack, onWidthChange }: {
  initial: Partial<DataSourceConfig>;
  onSave: (cfg: DataSourceConfig) => void;
  onBack: () => void;
  onWidthChange?: (w: number) => void;
}) {
  const store = useBuilderStore();
  const [name, setName] = useState(initial.name ?? '');
  const [dsLabel, setDsLabel] = useState((initial as { _label?: string })._label ?? '');
  const [url, setUrl] = useState<string | FormulaValue>(initial.url ?? '');
  const [urlBound, setUrlBound] = useState(false);
  const [method, setMethod] = useState<DataSourceConfig['method']>(initial.method ?? 'GET');
  const [bodyMode, setBodyMode] = useState<'parsed' | 'raw'>((initial as { bodyMode?: 'parsed' | 'raw' }).bodyMode ?? 'parsed');
  const [fields, setFields] = useState<KvEntry[]>(() => toKvEntries(((initial as { fields?: { key: string; value: string }[] }).fields) ?? []));
  const [body, setBody] = useState<string | FormulaValue>((initial as { body?: string | FormulaValue }).body ?? '');
  const [contentType, setContentType] = useState<string>((initial as { contentType?: string }).contentType ?? '');
  const [headers, setHeaders] = useState<KvEntry[]>(() => toKvEntries(initial.headers ?? []));
  const [queryParams, setQueryParams] = useState<KvEntry[]>(() => toKvEntries(initial.queryParams ?? []));
  const [proxy, setProxy] = useState<boolean | FormulaValue>(initial.proxy ?? false);
  const [sendCredentials, setSendCredentials] = useState(initial.sendCredentials ?? false);
  const [streamResponse, setStreamResponse] = useState<boolean>((initial as { streamResponse?: boolean }).streamResponse ?? false);
  const [dsFolderId, setDsFolderId] = useState<string | undefined>(initial.folderId);
  const [formulaState, setFormulaState] = useState<FormulaFieldState>(null);
  const [headersBound, setHeadersBound] = useState(false);
  const [restHeadersFormula, setRestHeadersFormula] = useState<FormulaValue | null>(null);
  const [qsBound, setQsBound] = useState(false);
  const [qsFormula, setQsFormula] = useState<FormulaValue | null>(null);
  // Restore last fetch result so the result panel reopens when editing
  const [fetchState, setFetchState] = useState<FetchState>(() =>
    initial._lastFetch ? { status: initial._lastFetch.status, data: initial._lastFetch.data, error: initial._lastFetch.error } : { status: 'idle' }
  );
  const { isOpen: urlFEOpen, open: openUrlFE, close: closeUrlFE } = useFormulaField('rest-url', formulaState, setFormulaState);
  const { isOpen: hdrsFEOpen, open: openHdrsFE, close: closeHdrsFE } = useFormulaField('rest-headers', formulaState, setFormulaState);
  const { isOpen: qsFEOpen, open: openQsFE, close: closeQsFE } = useFormulaField('rest-qs', formulaState, setFormulaState);

  const isEditingExisting = !!initial.id;
  const canSave = (isEditingExisting || name.trim().length > 0) && (urlBound || (typeof url === 'string' && url.trim().length > 0));

  const fetchData = async () => {
    const urlStr = urlBound
      ? String(resolveEntryValue({ value: typeof url === 'string' ? url : storedValueToFormula(url as FormulaValue), valueBound: true }))
      : (typeof url === 'string' ? url.trim() : '');
    if (!urlStr) return;
    setFetchState({ status: 'loading' });
    onWidthChange?.(SLIDE_WITH_RESULT);
    try {
      const targetUrl = new URL(urlStr);
      queryParams.filter(p => p.key.trim()).forEach(p => {
        const val = String(resolveEntryValue(p));
        targetUrl.searchParams.set(p.key, val);
      });
      const hdrs: Record<string, string> = {};
      headers.filter(h => h.key.trim()).forEach(h => { hdrs[h.key] = String(resolveEntryValue(h)); });
      const res = await fetch(targetUrl.toString(), {
        method: method ?? 'GET',
        headers: hdrs,
        credentials: sendCredentials ? 'include' : 'same-origin',
      });
      const rawData = await res.json().catch(() => res.text());
      const nextState: FetchState = { status: 'success', data: rawData };
      setFetchState(nextState);
      onWidthChange?.(SLIDE_WITH_RESULT);
      // Use responsePath to extract the right slice; store under storeIn key so page bindings update.
      // Fall back to initial.id (UUID) for config datasources that have no storeIn or name.
      // Apply collections.UUID prefix when the key is a bare UUID so {{collections.UUID.data.*}} bindings work.
      const storeKey = resolveStoreKey(initial.storeIn ?? initial.id ?? name.trim());
      const pageData = initial.responsePath ? extractByPath(rawData, initial.responsePath) ?? rawData : rawData;
      useSduiStore.getState().setData(storeKey, pageData);
      persistPreviewData(storeKey, pageData);
      // Persist result so the panel reopens on next edit
      if (initial.id) store.updatePageDataSource(initial.id, { ...initial as DataSourceConfig, _lastFetch: { status: 'success', data: rawData, fetchedAt: Date.now() } });
    } catch (e) {
      const err = (e as Error).message;
      const nextState: FetchState = { status: 'error', error: err };
      setFetchState(nextState);
      onWidthChange?.(SLIDE_WITH_RESULT);
      if (initial.id) store.updatePageDataSource(initial.id, { ...initial as DataSourceConfig, _lastFetch: { status: 'error', error: err, fetchedAt: Date.now() } });
    }
  };

  // Expand panel when there's a cached result on first render
  React.useEffect(() => {
    if (initial._lastFetch) onWidthChange?.(SLIDE_WITH_RESULT);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (!canSave) return;
    const id = initial.id ?? `ds-${Date.now()}`;
    const trimmedName = name.trim() || initial.id || id;
    const urlStr = typeof url === 'string' ? url.trim() : storedValueToFormula(url as FormulaValue);
    const restSerializedHeaders = headersBound && restHeadersFormula
      ? [{ key: '__formula__', value: storedValueToFormula(restHeadersFormula), enabled: true }]
      : headers.filter(h => h.key.trim()).map(h => ({ key: h.key, value: h.value, enabled: true }));
    const restSerializedQs = qsBound && qsFormula
      ? [{ key: '__formula__', value: storedValueToFormula(qsFormula), enabled: true }]
      : queryParams.filter(p => p.key.trim()).map(p => ({ key: p.key, value: p.value, enabled: true }));
    const isGet = (method ?? 'GET').toUpperCase() === 'GET';
    const restSerializedFields = fields.filter(f => f.key.trim()).map(f => ({ key: f.key, value: f.value, enabled: true }));
    onSave({
      id,
      name: trimmedName,
      _label: dsLabel.trim() || undefined,
      type: 'rest',
      url: urlStr,
      method: method ?? 'GET',
      ...((!isGet && bodyMode === 'parsed' && restSerializedFields.length) ? { fields: restSerializedFields } : {}),
      ...((!isGet && bodyMode === 'raw' && body && (typeof body !== 'string' || (body as string).trim())) ? { body: typeof body === 'string' ? (body as string).trim() : body } : {}),
      ...((!isGet && contentType) ? { contentType } : {}),
      bodyMode: isGet ? undefined : bodyMode,
      headers: restSerializedHeaders,
      queryParams: restSerializedQs,
      storeIn: initial.storeIn ?? id,
      proxy: typeof proxy === 'boolean' ? proxy : false,
      sendCredentials,
      streamResponse: streamResponse || undefined,
      folderId: dsFolderId,
    } as DataSourceConfig);
  };

  const DIVIDER: React.CSSProperties = { borderTop: '1px solid #1f2937', margin: '4px 0 12px' };

  const hasResult = fetchState.status !== 'idle';
  const isEditing = !!initial.id;

  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
      {/* ── Form column ── */}
      <div style={{ width: SLIDE_DEFAULT, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* Name — only shown when creating new; header shows it for existing */}
        {!isEditing && (
          <div style={{ marginBottom: 14 }}>
            <label style={SP_LABEL}>Name *</label>
            <input data-testid="ds-name" value={name} onChange={e => setName(e.target.value)} placeholder="my-api" style={SP_INPUT} />
          </div>
        )}

        {/* Label */}
        <div style={{ marginBottom: 14 }}>
          <label style={SP_LABEL}>Label</label>
          <input value={dsLabel} onChange={e => setDsLabel(e.target.value)} placeholder="Human-readable name…" style={SP_INPUT} />
        </div>

        {/* Folder */}
        <div style={{ marginBottom: 14 }}>
          <label style={SP_LABEL}>Folder</label>
          <FolderPicker value={dsFolderId} onChange={setDsFolderId} scope="ds" />
        </div>

        {/* Method */}
        <div style={{ marginBottom: 14 }}>
          <label style={SP_LABEL}>Method *</label>
          <div data-testid="ds-method">
            <OptionPickerDropdown
              value={method ?? 'GET'}
              onChange={v => setMethod(v as DataSourceConfig['method'])}
              options={[
                { value: 'GET',    label: 'GET' },
                { value: 'POST',   label: 'POST' },
                { value: 'PUT',    label: 'PUT' },
                { value: 'DELETE', label: 'DELETE' },
                { value: 'PATCH',  label: 'PATCH' },
              ]}
            />
          </div>
        </div>

        {/* URL */}
        <div style={{ marginBottom: 14 }}>
          <label style={SP_LABEL}>URL *</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <BindingIcon isBound={urlBound} onClick={openUrlFE} />
            {urlBound ? (
              <button onClick={openUrlFE} style={{ flex: 1, ...SP_INPUT, background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: 11 }}>ƒ Edit formula</button>
            ) : (
              <input data-testid="ds-url" value={url as string} onChange={e => setUrl(e.target.value)} placeholder="https://api-url.com/endpoint" style={{ ...SP_INPUT, flex: 1 }} />
            )}
          </div>
          {urlFEOpen && (
            <FormulaEditor label="URL" value={urlBound ? url as FormulaValue : ''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => {
                if (!v && v !== 0) { setUrlBound(false); setUrl(''); }
                else { setUrl(typeof v === 'string' ? v : JSON.stringify(v)); setUrlBound(true); }
                closeUrlFE();
              }}
              onClose={closeUrlFE}
            />
          )}
        </div>

        <div style={DIVIDER} />

        {/* Body tabs — only for non-GET */}
        {(method ?? 'GET') !== 'GET' && (
          <>
            <div style={{ display: 'flex', background: '#1f2937', borderRadius: 6, padding: 2, gap: 2, marginBottom: 12 }}>
              <button style={{ flex: 1, padding: '4px 0', fontSize: 11, border: 'none', cursor: 'pointer', borderRadius: 4, fontWeight: 500,
                background: bodyMode === 'parsed' ? '#374151' : 'transparent', color: bodyMode === 'parsed' ? '#f3f4f6' : '#6b7280' }}
                onClick={() => setBodyMode('parsed')}>Parsed fields</button>
              <button style={{ flex: 1, padding: '4px 0', fontSize: 11, border: 'none', cursor: 'pointer', borderRadius: 4, fontWeight: 500,
                background: bodyMode === 'raw' ? '#374151' : 'transparent', color: bodyMode === 'raw' ? '#f3f4f6' : '#6b7280' }}
                onClick={() => setBodyMode('raw')}>Raw body</button>
            </div>

            {bodyMode === 'parsed' ? (
              <div style={{ marginBottom: 14 }}>
                <SectionRow label="Fields"
                  onAdd={() => setFields(f => [...f, { key: '', value: '', keyBound: false, valueBound: false }])}
                  addTestId="ds-add-field"
                  bindActive={false}
                  onBind={undefined}
                />
                {fields.map((f, i) => (
                  <KvRow key={i} index={i} entry={f}
                    onEntryChange={patch => setFields(ff => ff.map((x, xi) => xi === i ? { ...x, ...patch } : x))}
                    onRemove={() => setFields(ff => ff.filter((_, xi) => xi !== i))}
                    testIdPrefix="ds-field" formulaState={formulaState} setFormulaState={setFormulaState} fieldSuffix="rest-field"
                  />
                ))}
              </div>
            ) : (
              <BoundField
                label="Body"
                value={body as FormulaValue | undefined}
                onChange={v => setBody(v ?? '')}
                placeholder={'{"key": "value"}'}
              />
            )}
            <div style={DIVIDER} />
          </>
        )}

        {/* Headers */}
        <div style={{ marginBottom: 14 }}>
          <SectionRow label="Headers"
            onAdd={headersBound ? undefined : () => setHeaders(h => [...h, { key: '', value: '', keyBound: false, valueBound: false }])}
            addTestId="ds-add-header"
            bindActive={headersBound}
            onBind={() => { openHdrsFE(); }}
            onEditFormula={headersBound ? openHdrsFE : undefined}
          />
          {hdrsFEOpen && (
            <FormulaEditor label="Headers (formula)" value={restHeadersFormula ?? ''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => { if (!v && v !== 0) { setHeadersBound(false); setRestHeadersFormula(null); } else { setHeadersBound(true); setRestHeadersFormula(v as FormulaValue); } closeHdrsFE(); }}
              onClose={closeHdrsFE}
            />
          )}
          {!headersBound && headers.map((h, i) => (
            <KvRow key={i} index={i} entry={h}
              onEntryChange={patch => setHeaders(hh => hh.map((x, xi) => xi === i ? { ...x, ...patch } : x))}
              onRemove={() => setHeaders(hh => hh.filter((_, xi) => xi !== i))}
              testIdPrefix="ds-header" formulaState={formulaState} setFormulaState={setFormulaState} fieldSuffix="rest-hdr"
            />
          ))}
        </div>

        <div style={DIVIDER} />

        {/* Query string */}
        <div style={{ marginBottom: 14 }}>
          <SectionRow label="Query string"
            onAdd={qsBound ? undefined : () => setQueryParams(p => [...p, { key: '', value: '', keyBound: false, valueBound: false }])}
            addTestId="ds-add-param"
            bindActive={qsBound}
            onBind={() => { openQsFE(); }}
            onEditFormula={qsBound ? openQsFE : undefined}
          />
          {qsFEOpen && (
            <FormulaEditor label="Query string (formula)" value={qsFormula ?? ''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => { if (!v && v !== 0) { setQsBound(false); setQsFormula(null); } else { setQsBound(true); setQsFormula(v as FormulaValue); } closeQsFE(); }}
              onClose={closeQsFE}
            />
          )}
          {!qsBound && queryParams.map((p, i) => (
            <KvRow key={i} index={i} entry={p}
              onEntryChange={patch => setQueryParams(pp => pp.map((x, xi) => xi === i ? { ...x, ...patch } : x))}
              onRemove={() => setQueryParams(pp => pp.filter((_, xi) => xi !== i))}
              testIdPrefix="ds-param" formulaState={formulaState} setFormulaState={setFormulaState} fieldSuffix="rest-qs"
            />
          ))}
        </div>

        <div style={DIVIDER} />

        {/* Content type — only for non-GET, after Query string */}
        {(method ?? 'GET') !== 'GET' && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={SP_LABEL}>Content type</label>
              <OptionPickerDropdown
                value={contentType || ''}
                onChange={v => setContentType(v)}
                options={[
                  { value: '',                                  label: 'Default (application/json)' },
                  { value: 'application/x-www-form-urlencoded', label: 'Form URL-encoded' },
                  { value: 'multipart/form-data',               label: 'Multipart/Form-data' },
                  { value: 'text/plain',                        label: 'Text' },
                  { value: 'application/xml',                   label: 'XML' },
                ]}
              />
            </div>
            <div style={DIVIDER} />
          </>
        )}

        {/* Proxy */}
        <BoundToggleField label="Proxy request server side (bypass CORS)" value={proxy as FormulaValue | undefined} onChange={v => setProxy(v ?? false)} />

        {/* Send credentials */}
        <PillToggle label="Send credentials" value={sendCredentials} onChange={setSendCredentials} />

        {/* Stream response */}
        <PillToggle label="Stream response" value={streamResponse} onChange={setStreamResponse} />
      </div>

      {/* Footer — compact: Fetch | Save */}
      <div style={{ padding: '7px 10px', borderTop: '1px solid #1f2937', flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          data-testid="ds-fetch"
          onClick={fetchData}
          disabled={fetchState.status === 'loading' || !canSave}
          style={{ padding: '4px 10px', background: 'none', border: '1px solid #374151', borderRadius: 5, color: canSave ? '#9ca3af' : '#4b5563', fontSize: 11, cursor: canSave ? 'pointer' : 'default', flexShrink: 0 }}
        >
          {fetchState.status === 'loading' ? 'Fetching…' : 'Fetch'}
        </button>
        <div style={{ flex: 1 }} />
        <button data-testid="ds-save" onClick={save} disabled={!canSave}
          style={{ ...SP_BTN_PRIMARY, padding: '4px 14px', fontSize: 11, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'default', flexShrink: 0 }}>
          Save
        </button>
      </div>
      </div>{/* end form column */}

      {/* ── Result column — always visible when data exists ── */}
      {hasResult && <FetchResultPanel result={fetchState} />}
    </div>
  );
}

// ─── GraphQL Configuration Form ────────────────────────────────────────────────

export function GraphQLForm({ initial, onSave, onBack, onWidthChange }: {
  initial: Partial<DataSourceConfig>;
  onSave: (cfg: DataSourceConfig) => void;
  onBack: () => void;
  onWidthChange?: (w: number) => void;
}) {
  const store = useBuilderStore();
  const [name, setName] = useState(initial.name ?? '');
  const [gqlLabel, setGqlLabel] = useState((initial as { _label?: string })._label ?? '');
  const [url, setUrl] = useState<string | FormulaValue>(initial.url ?? initial.endpoint ?? '');
  const [urlBound, setUrlBound] = useState(false);
  const [query, setQuery] = useState(() => formatGql(initial.query ?? ''));
  const [variables, setVariables] = useState<KvEntry[]>(() => {
    if (!initial.variables) return [];
    try {
      const parsed = typeof initial.variables === 'string' ? JSON.parse(initial.variables) : initial.variables;
      // Recursively flatten nested objects into dot-notation keys so each leaf
      // formula gets its own KvRow with proper token-chip display.
      const entries: KvEntry[] = [];
      const walk = (obj: Record<string, unknown>, prefix: string) => {
        for (const [k, value] of Object.entries(obj)) {
          const dotKey = prefix ? `${prefix}.${k}` : k;
          if (typeof value === 'object' && value !== null && '__bound__' in value) {
            entries.push({ key: dotKey, value: String((value as { __bound__: unknown }).__bound__), keyBound: false, valueBound: true });
          } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const o = value as Record<string, unknown>;
            if (typeof o.formula === 'string') {
              entries.push({ key: dotKey, value: o.formula, keyBound: false, valueBound: true });
            } else {
              walk(o, dotKey);
            }
          } else {
            const strVal = typeof value === 'string' ? value : JSON.stringify(value ?? '');
            const valueBound = typeof value !== 'string' || isFormulaString(strVal);
            entries.push({ key: dotKey, value: strVal, keyBound: false, valueBound });
          }
        }
      };
      walk(parsed as Record<string, unknown>, '');
      return entries;
    } catch { return []; }
  });
  const [headers, setHeaders] = useState<KvEntry[]>(() => toKvEntries(initial.headers ?? []));
  const [sendCredentials, setSendCredentials] = useState(initial.sendCredentials ?? false);
  const [useProxy, setUseProxy] = useState(!!(initial as { proxy?: boolean }).proxy);
  const [gqlFolderId, setGqlFolderId] = useState<string | undefined>(initial.folderId);
  const [returnDataOnly, setReturnDataOnly] = useState(!!initial.responsePath?.trim());
  const [formulaState, setFormulaState] = useState<FormulaFieldState>(null);
  // Restore last fetch result so the result panel reopens when editing
  const [fetchState, setFetchState] = useState<FetchState>(() =>
    initial._lastFetch ? { status: initial._lastFetch.status, data: initial._lastFetch.data, error: initial._lastFetch.error } : { status: 'idle' }
  );
  const [varsBound, setVarsBound] = useState(false);
  const [variablesFormula, setVariablesFormula] = useState<FormulaValue | null>(null);
  const [gqlHdrsBound, setGqlHdrsBound] = useState(false);
  const [headersFormula, setHeadersFormula] = useState<FormulaValue | null>(null);

  const { isOpen: urlFEOpen, open: openUrlFE, close: closeUrlFE } = useFormulaField('gql-url', formulaState, setFormulaState);
  const { isOpen: varsFEOpen, open: openVarsFE, close: closeVarsFE } = useFormulaField('gql-vars', formulaState, setFormulaState);
  const { isOpen: gqlHdrsFEOpen, open: openGqlHdrsFE, close: closeGqlHdrsFE } = useFormulaField('gql-headers', formulaState, setFormulaState);

  const isEditingExisting = !!initial.id;
  const canSave = (isEditingExisting || name.trim().length > 0) && (urlBound || (typeof url === 'string' && url.trim().length > 0)) && query.trim().length > 0;

  const fetchData = async () => {
    const urlStr = urlBound
      ? String(resolveEntryValue({ value: typeof url === 'string' ? url : storedValueToFormula(url as FormulaValue), valueBound: true }))
      : (typeof url === 'string' ? url.trim() : '');
    if (!urlStr || !query.trim()) return;
    setFetchState({ status: 'loading' });
    onWidthChange?.(SLIDE_WITH_RESULT);
    try {
      // Resolve all variable values — including bound formulas — against current store state.
      // Unflatten dot-notation keys into nested objects for the GraphQL query.
      const varsObj: Record<string, unknown> = {};
      variables.filter(v => v.key.trim()).forEach(v => {
        const key = v.key.trim();
        const resolved = resolveEntryValue(v);
        const parts = key.split('.');
        let cur = varsObj;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) {
            cur[parts[i]] = {};
          }
          cur = cur[parts[i]] as Record<string, unknown>;
        }
        cur[parts[parts.length - 1]] = resolved;
      });
      const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
      headers.filter(h => h.key.trim()).forEach(h => { hdrs[h.key] = String(resolveEntryValue(h)); });
      const res = await fetch(urlStr, {
        method: 'POST',
        headers: hdrs,
        credentials: sendCredentials ? 'include' : 'same-origin',
        body: JSON.stringify({ query: query.trim(), variables: Object.keys(varsObj).length ? varsObj : undefined }),
      });
      const rawData = await res.json().catch(() => res.text());
      const nextState: FetchState = { status: 'success', data: rawData };
      setFetchState(nextState);
      onWidthChange?.(SLIDE_WITH_RESULT);
      // Fall back to initial.id (UUID) for config datasources that have no storeIn or name.
      // Apply collections.UUID prefix when the key is a bare UUID so {{collections.UUID.data.*}} bindings work.
      const storeKey = resolveStoreKey(initial.storeIn ?? initial.id ?? name.trim());
      const pageData = initial.responsePath
        ? extractByPath(rawData, initial.responsePath) ?? rawData
        : rawData;
      useSduiStore.getState().setData(storeKey, pageData);
      // Persist to localStorage so data survives page refresh
      persistPreviewData(storeKey, pageData);
      // Persist so the result panel reopens on next edit
      if (initial.id) store.updatePageDataSource(initial.id, { ...initial as DataSourceConfig, _lastFetch: { status: 'success', data: rawData, fetchedAt: Date.now() } });
    } catch (e) {
      const err = (e as Error).message;
      const nextState: FetchState = { status: 'error', error: err };
      setFetchState(nextState);
      onWidthChange?.(SLIDE_WITH_RESULT);
      if (initial.id) store.updatePageDataSource(initial.id, { ...initial as DataSourceConfig, _lastFetch: { status: 'error', error: err, fetchedAt: Date.now() } });
    }
  };

  // Expand panel when there's a cached result on first render
  React.useEffect(() => {
    if (initial._lastFetch) onWidthChange?.(SLIDE_WITH_RESULT);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (!canSave) return;
    const id = initial.id ?? `ds-${Date.now()}`;
    const trimmedName = name.trim() || initial.id || id;
    const urlStr = typeof url === 'string' ? url.trim() : storedValueToFormula(url as FormulaValue);
    // Unflatten dot-notation keys back into a nested object.
    // Bound formula values are wrapped in { formula: "..." } so the runtime
    // engine evaluates them; plain values are stored as-is (string or parsed number/bool).
    let serializedVariables: string | undefined;
    if (varsBound && variablesFormula) {
      serializedVariables = storedValueToFormula(variablesFormula);
    } else {
      const varsObj: Record<string, unknown> = {};
      variables.filter(v => v.key.trim()).forEach(v => {
        const key = v.key.trim();
        const leaf = v.valueBound
          ? { formula: v.value }
          : (() => { const n = Number(v.value); if (v.value === 'true') return true; if (v.value === 'false') return false; if (!isNaN(n) && v.value.trim() !== '') return n; return v.value; })();
        // Set nested path using dot-notation (e.g. "input.take" → { input: { take: 12 } })
        const parts = key.split('.');
        let cur = varsObj;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) {
            cur[parts[i]] = {};
          }
          cur = cur[parts[i]] as Record<string, unknown>;
        }
        cur[parts[parts.length - 1]] = leaf;
      });
      serializedVariables = Object.keys(varsObj).length ? JSON.stringify(varsObj) : undefined;
    }
    const serializedHeaders = gqlHdrsBound && headersFormula
      ? [{ key: '__formula__', value: storedValueToFormula(headersFormula), enabled: true }]
      : headers.filter(h => h.key.trim()).map(h => ({ key: h.key, value: h.value, enabled: true }));
    onSave({
      id,
      name: trimmedName,
      _label: gqlLabel.trim() || undefined,
      type: 'graphql',
      url: urlStr,
      method: 'POST',
      query: query.trim(),
      variables: serializedVariables,
      headers: serializedHeaders,
      storeIn: initial.storeIn ?? id,
      sendCredentials,
      proxy: useProxy || undefined,
      responsePath: initial.responsePath ?? (returnDataOnly ? 'data' : undefined),
      folderId: gqlFolderId,
    });
  };

  const DIVIDER: React.CSSProperties = { borderTop: '1px solid #1f2937', margin: '4px 0 12px' };

  const hasResult = fetchState.status !== 'idle';
  const isEditing = !!initial.id;

  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
      {/* ── Form column ── */}
      <div style={{ width: SLIDE_DEFAULT, flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* Name — only shown when creating new; header shows it for existing */}
        {!isEditing && (
          <div style={{ marginBottom: 14 }}>
            <label style={SP_LABEL}>Name *</label>
            <input data-testid="ds-name" value={name} onChange={e => setName(e.target.value)} placeholder="my-query" style={SP_INPUT} />
          </div>
        )}

        {/* Folder */}
        <div style={{ marginBottom: 14 }}>
          <label style={SP_LABEL}>Label</label>
          <input value={gqlLabel} onChange={e => setGqlLabel(e.target.value)} placeholder="Human-readable name…" style={{ ...SP_INPUT, marginBottom: 14 }} />
          <label style={SP_LABEL}>Folder</label>
          <FolderPicker value={gqlFolderId} onChange={setGqlFolderId} scope="ds" />
        </div>

        {/* URL */}
        <div style={{ marginBottom: 14 }}>
          <label style={SP_LABEL}>URL *</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <BindingIcon isBound={urlBound} onClick={openUrlFE} />
            {urlBound ? (
              <button onClick={openUrlFE} style={{ flex: 1, ...SP_INPUT, background: '#1e1b4b', border: '1px solid #4338ca', color: '#a5b4fc', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: 11 }}>ƒ Edit formula</button>
            ) : (
              <input data-testid="ds-url" value={url as string} onChange={e => setUrl(e.target.value)} placeholder="https://api-url.com/graphql" style={{ ...SP_INPUT, flex: 1 }} />
              )}
            </div>
          {urlFEOpen && (
            <FormulaEditor label="URL" value={urlBound ? url as FormulaValue : ''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => {
                if (!v && v !== 0) { setUrlBound(false); setUrl(''); }
                else { setUrl(typeof v === 'string' ? v : JSON.stringify(v)); setUrlBound(true); }
                closeUrlFE();
              }}
              onClose={closeUrlFE}
            />
          )}
        </div>

        {/* Query — syntax-highlighted editor with format button */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <label style={{ ...SP_LABEL, flex: 1, marginBottom: 0 }}>Query *</label>
                      <button
                      type="button"
              onClick={() => setQuery(formatGql(query))}
              title="Auto-format GraphQL query"
              style={{ padding: '2px 8px', background: 'none', border: '1px solid #374151', borderRadius: 4, color: '#9ca3af', fontSize: 9, cursor: 'pointer' }}
            >
              Format
                      </button>
                    </div>
          <GqlEditor value={query} onChange={setQuery} placeholder={'query GetItems {\n  items { id name }\n}'} />
          </div>

        <div style={DIVIDER} />

        {/* Variables — bind button on section header + per-field binds */}
        <div style={{ marginBottom: 14 }}>
          <SectionRow
            label="Variables"
            onAdd={varsBound ? undefined : () => setVariables(v => [...v, { key: '', value: '', keyBound: false, valueBound: false }])}
            addTestId="ds-add-variable"
            bindActive={varsBound}
            onBind={() => { openVarsFE(); }}
            onEditFormula={varsBound ? openVarsFE : undefined}
          />
          {varsFEOpen && (
            <FormulaEditor label="Variables (formula)" value={variablesFormula ?? ''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => { if (!v && v !== 0) { setVarsBound(false); setVariablesFormula(null); } else { setVarsBound(true); setVariablesFormula(v as FormulaValue); } closeVarsFE(); }}
              onClose={closeVarsFE}
            />
          )}
          {!varsBound && variables.map((v, i) => (
            <KvRow key={i} index={i} entry={v}
              onEntryChange={patch => setVariables(vv => vv.map((x, xi) => xi === i ? { ...x, ...patch } : x))}
              onRemove={() => setVariables(vv => vv.filter((_, xi) => xi !== i))}
              testIdPrefix="ds-var" formulaState={formulaState} setFormulaState={setFormulaState} fieldSuffix="gql-var"
            />
          ))}
            </div>

        <div style={DIVIDER} />

        {/* Headers */}
        <div style={{ marginBottom: 14 }}>
          <SectionRow label="Headers"
            onAdd={gqlHdrsBound ? undefined : () => setHeaders(h => [...h, { key: '', value: '', keyBound: false, valueBound: false }])}
            addTestId="ds-add-header"
            bindActive={gqlHdrsBound}
            onBind={() => { openGqlHdrsFE(); }}
            onEditFormula={gqlHdrsBound ? openGqlHdrsFE : undefined}
          />
          {gqlHdrsFEOpen && (
            <FormulaEditor label="Headers (formula)" value={headersFormula ?? ''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => { if (!v && v !== 0) { setGqlHdrsBound(false); setHeadersFormula(null); } else { setGqlHdrsBound(true); setHeadersFormula(v as FormulaValue); } closeGqlHdrsFE(); }}
              onClose={closeGqlHdrsFE}
            />
          )}
          {!gqlHdrsBound && headers.map((h, i) => (
            <KvRow key={i} index={i} entry={h}
              onEntryChange={patch => setHeaders(hh => hh.map((x, xi) => xi === i ? { ...x, ...patch } : x))}
              onRemove={() => setHeaders(hh => hh.filter((_, xi) => xi !== i))}
              testIdPrefix="ds-header" formulaState={formulaState} setFormulaState={setFormulaState} fieldSuffix="gql-hdr"
            />
          ))}
                </div>

        <div style={DIVIDER} />

        {/* Send credentials */}
        <SimpleToggleRow label="Send credentials" value={sendCredentials} onChange={setSendCredentials} />

        {/* Proxy request server side */}
        <SimpleToggleRow label="Proxy request server side" value={useProxy} onChange={setUseProxy} />

        {/* Return data only */}
        <SimpleToggleRow label="Return data only" value={returnDataOnly} onChange={setReturnDataOnly} />
          </div>

      {/* Footer — compact: Fetch | Save */}
      <div style={{ padding: '7px 10px', borderTop: '1px solid #1f2937', flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          data-testid="ds-fetch"
          onClick={fetchData}
          disabled={fetchState.status === 'loading' || !canSave}
          style={{ padding: '4px 10px', background: 'none', border: '1px solid #374151', borderRadius: 5, color: canSave ? '#9ca3af' : '#4b5563', fontSize: 11, cursor: canSave ? 'pointer' : 'default', flexShrink: 0 }}
        >
          {fetchState.status === 'loading' ? 'Fetching…' : 'Fetch'}
        </button>
        <div style={{ flex: 1 }} />
        <button data-testid="ds-save" onClick={save} disabled={!canSave}
          style={{ ...SP_BTN_PRIMARY, padding: '4px 14px', fontSize: 11, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'default', flexShrink: 0 }}>
          Save
        </button>
      </div>
      </div>{/* end form column */}

      {/* ── Result column — always visible when data exists ── */}
      {hasResult && <FetchResultPanel result={fetchState} />}
    </div>
  );
}

// ─── DataSourceSlideContent — orchestrates type picker + form ─────────────────

interface DataSourceSlideContentProps extends DataSourceSlidePanelProps {
  onWidthChange?: (w: number) => void;
}

export function DataSourceSlideContent({ initial, onSave, onClose, onWidthChange }: DataSourceSlideContentProps) {
  const initialType = (initial as { type?: string }).type as 'rest' | 'graphql' | undefined;
  const isEditing = !!(initial as { id?: string }).id;
  const [type, setType] = useState<'rest' | 'graphql' | null>(isEditing ? (initialType ?? 'rest') : null);

  const handleBack = () => {
    if (isEditing) { onClose(); } else { setType(null); }
  };

  if (type === null) return <TypePicker onSelect={setType} />;
  if (type === 'rest') return <RestForm initial={initial} onSave={onSave} onBack={handleBack} onWidthChange={onWidthChange} />;
  return <GraphQLForm initial={initial} onSave={onSave} onBack={handleBack} onWidthChange={onWidthChange} />;
}

// ─── FolderPicker ─────────────────────────────────────────────────────────────

export interface FolderPickerProps {
  value: string | undefined;        // selected folderId
  onChange: (id: string | undefined) => void;
  scope: 'var' | 'ds' | 'color';
}

export function FolderPicker({ value, onChange, scope }: FolderPickerProps) {
  const store = useBuilderStore();
  const folders =
    scope === 'var'   ? store.varFolders :
    scope === 'color' ? store.colorFolders :
                        store.dsFolders;
  const addFolder =
    scope === 'var'   ? store.addVarFolder :
    scope === 'color' ? store.addColorFolder :
                        store.addDsFolder;
  const updateFolder =
    scope === 'var'   ? store.updateVarFolder :
    scope === 'color' ? store.updateColorFolder :
                        store.updateDsFolder;
  const removeFolder =
    scope === 'var'   ? store.removeVarFolder :
    scope === 'color' ? store.removeColorFolder :
                        store.removeDsFolder;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null); // inline rename
  const [creating, setCreating] = useState<{ parentId: string | null; name: string } | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (dropRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const selectedFolder = folders.find(f => f.id === value);
  const label = selectedFolder ? selectedFolder.name : 'No folder';

  const roots = folders.filter(f => !f.parentId);
  const children = (parentId: string) => folders.filter(f => f.parentId === parentId);

  const confirmCreate = () => {
    if (!creating || !creating.name.trim()) { setCreating(null); return; }
    const id = `folder_${Date.now()}`;
    addFolder({ id, name: creating.name.trim(), parentId: creating.parentId });
    if (creating.parentId) setExpanded(e => ({ ...e, [creating.parentId!]: true }));
    setCreating(null);
  };

  const confirmRename = () => {
    if (!editing || !editing.name.trim()) { setEditing(null); return; }
    updateFolder(editing.id, editing.name.trim());
    setEditing(null);
  };

  const handleSelect = (id: string | undefined) => {
    onChange(id);
    setOpen(false);
  };

  const ROW: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
    fontSize: 12, color: '#d1d5db', cursor: 'pointer', userSelect: 'none',
  };
  const ICON_BTN: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280',
    fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0,
  };
  const INLINE_INPUT: React.CSSProperties = {
    flex: 1, background: '#374151', border: '1px solid #6366f1', borderRadius: 3,
    color: '#f3f4f6', fontSize: 11, padding: '2px 6px', outline: 'none',
  };

  const renderFolder = (f: Folder, depth = 0) => {
    // Show as expanded when explicitly expanded OR when we're actively creating a child
    const isExpanded = expanded[f.id] || creating?.parentId === f.id;
    const kids = children(f.id);
    const isSelected = value === f.id;

    return (
      <React.Fragment key={f.id}>
        <div
          style={{ ...ROW, paddingLeft: 8 + depth * 16,
            background: isSelected ? '#1e3a5f' : 'transparent' }}
          onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#1f2937'; }}
          onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {/* chevron */}
          <button style={{ ...ICON_BTN, width: 12, display: 'flex', alignItems: 'center' }}
            onClick={e => { e.stopPropagation(); setExpanded(x => ({ ...x, [f.id]: !x[f.id] })); }}>
            <Chevron open={isExpanded} size={10} color="#6b7280" />
          </button>

          {editing?.id === f.id ? (
            <>
              <input autoFocus style={INLINE_INPUT} value={editing.name}
                onChange={e => setEditing(ev => ev ? { ...ev, name: e.target.value } : ev)}
                onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setEditing(null); }}
                onClick={e => e.stopPropagation()} />
              <button style={{ ...ICON_BTN, color: '#34d399' }} onClick={e => { e.stopPropagation(); confirmRename(); }}>✓</button>
              <button style={{ ...ICON_BTN, color: '#f87171' }} onClick={e => { e.stopPropagation(); setEditing(null); }}>✕</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSelected ? '#a5b4fc' : undefined }}
                onClick={() => handleSelect(f.id)}>{f.name}</span>
              {/* rename */}
              <button style={{ ...ICON_BTN, fontSize: 11 }} title="Rename"
                onClick={e => { e.stopPropagation(); setEditing({ id: f.id, name: f.name }); }}>✎</button>
              {/* add sub-folder */}
              <button style={ICON_BTN} title="Add sub-folder"
                onClick={e => { e.stopPropagation(); setCreating({ parentId: f.id, name: '' }); setExpanded(x => ({ ...x, [f.id]: true })); }}>+</button>
              {/* delete folder */}
              <button style={{ ...ICON_BTN, color: '#6b7280', fontSize: 11 }} title="Delete folder"
                onClick={e => {
                  e.stopPropagation();
                  removeFolder(f.id);
                  if (value === f.id) onChange(undefined);
                }}>🗑</button>
            </>
          )}
        </div>

        {/* children — show when expanded, or when we're actively creating inside */}
        {(isExpanded || creating?.parentId === f.id) && kids.map(k => renderFolder(k, depth + 1))}

        {/* inline create under this folder — show whenever creating targets this folder */}
        {creating?.parentId === f.id && (
          <div style={{ ...ROW, paddingLeft: 8 + (depth + 1) * 16 }}>
            <span style={{ width: 12 }} />
            <input autoFocus style={INLINE_INPUT} placeholder="New folder" value={creating.name}
              onChange={e => setCreating(c => c ? { ...c, name: e.target.value } : c)}
              onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') setCreating(null); }}
              onClick={e => e.stopPropagation()} />
            <button style={{ ...ICON_BTN, color: '#34d399' }} onClick={e => { e.stopPropagation(); confirmCreate(); }}>✓</button>
            <button style={{ ...ICON_BTN, color: '#f87171' }}
              onClick={e => { e.stopPropagation(); setCreating(null); }}>🗑</button>
          </div>
        )}
      </React.Fragment>
    );
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ ...SP_INPUT, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties}
      >
        <span style={{ color: value ? '#d1d5db' : '#6b7280' }}>{label}</span>
        <Chevron open={open} size={10} color="#6b7280" />
      </button>

      {/* Dropdown */}
      {open && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          top: (() => { const r = btnRef.current?.getBoundingClientRect(); return (r?.bottom ?? 0) + 4; })(),
          left: (() => { const r = btnRef.current?.getBoundingClientRect(); return r?.left ?? 0; })(),
          width: btnRef.current?.getBoundingClientRect().width ?? 280,
          background: '#111827', border: '1px solid #374151', borderRadius: 6,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)', zIndex: 99999,
          maxHeight: 300, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* No folder option */}
          <div style={{ padding: '4px 8px 2px', fontSize: 10, color: '#4b5563', fontWeight: 700, letterSpacing: '0.05em' }}>
            NO FOLDER
          </div>
          <div
            style={{ ...ROW, background: !value ? '#1e3a5f' : 'transparent' }}
            onClick={() => handleSelect(undefined)}
            onMouseEnter={e => { if (value) (e.currentTarget as HTMLElement).style.background = '#1f2937'; }}
            onMouseLeave={e => { if (value) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <span style={{ flex: 1, color: '#9ca3af', fontStyle: 'italic' }}>No folder</span>
            {!value && <span style={{ color: '#34d399', fontSize: 12 }}>✓</span>}
          </div>

          {/* Folder tree */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {roots.map(f => renderFolder(f))}
            {/* top-level create */}
            {creating?.parentId === null && (
              <div style={{ ...ROW }}>
                <span style={{ width: 12 }} />
                <input autoFocus style={INLINE_INPUT} placeholder="New folder" value={creating.name}
                  onChange={e => setCreating(c => c ? { ...c, name: e.target.value } : c)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') setCreating(null); }}
                  onClick={e => e.stopPropagation()} />
                <button style={{ ...ICON_BTN, color: '#34d399' }} onClick={e => { e.stopPropagation(); confirmCreate(); }}>✓</button>
                <button style={{ ...ICON_BTN, color: '#f87171' }}
                  onClick={e => { e.stopPropagation(); setCreating(null); }}>🗑</button>
              </div>
            )}
          </div>

          {/* Footer — create new folder */}
          <div style={{ borderTop: '1px solid #1f2937', padding: '6px 8px' }}>
            <button
              onClick={() => setCreating({ parentId: null, name: '' })}
              style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 12, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
            >+ Create new folder</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
