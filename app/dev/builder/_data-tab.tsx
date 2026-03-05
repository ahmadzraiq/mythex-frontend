'use client';

/**
 * Data Tab — left panel "Data" tab.
 *
 * Sections:
 *   A. Data Sources  — named REST/GraphQL sources with bind-button enabled form
 *   B. Variables     — named typed variables (CustomVars)
 */

import React, { useState, useCallback, useRef, lazy, Suspense } from 'react';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

const CodeMirror = lazy(() => import('@uiw/react-codemirror'));
import ReactDOM from 'react-dom';
import { useBuilderStore, type DataSourceConfig, type DataSourceParam, type CustomVar, type Folder, persistPreviewData } from './_store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL } from './_slide-panel';
import { BindingIcon } from './_formula-panel';

// When a storeIn/id is a bare UUID, data lives under collections.UUID to match the
// {{collections.UUID.data.*}} path convention used in all screen/fragment configs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveStoreKey(key: string): string {
  return UUID_RE.test(key) ? `collections.${key}` : key;
}

// Thin SVG chevron — rotated via CSS transform to point in any direction
function Chevron({ open, size = 12, color = 'currentColor', style }: { open?: boolean; size?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', ...style }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
import {
  FormulaEditor,
  type FormulaValue,
  storedValueToFormula,
  isBoundValue,
  evaluateFormula,
} from './_formula-editor';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';

// Left panel (248px) + slide panel (320px) = formula editor opens right of slide panel
const FORMULA_ANCHOR_LEFT = 248 + 320;
// Width used when the result panel is open
const SLIDE_WITH_RESULT = 660;
const SLIDE_DEFAULT = 320;

// ─── JsonTree — expandable JSON result viewer ─────────────────────────────────

function JsonNode({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);

  if (value === null) return <span style={{ color: '#9ca3af' }}>null</span>;
  if (value === undefined) return <span style={{ color: '#9ca3af' }}>undefined</span>;
  if (typeof value === 'boolean') return <span style={{ color: '#fb923c' }}>{String(value)}</span>;
  if (typeof value === 'number') return <span style={{ color: '#34d399' }}>{value}</span>;
  if (typeof value === 'string') return <span style={{ color: '#f9a8d4' }}>"{value}"</span>;

  const isArr = Array.isArray(value);
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) return <span style={{ color: '#6b7280' }}>{isArr ? '[]' : '{}'}</span>;

  const INDENT = 14;
  const openBrace = isArr ? '[' : '{';
  const closeBrace = isArr ? ']' : '}';
  const previewCount = Math.min(entries.length, 3);
  const preview = entries.slice(0, previewCount).map(([k]) => isArr ? '' : k).filter(Boolean).join(', ');

  return (
    <span>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '0 2px', fontSize: 10, lineHeight: 1, verticalAlign: 'middle' }}
      >
        {open ? '▾' : '▸'}
      </button>
      {!open && (
        <span style={{ color: '#6b7280', fontSize: 10 }}>
          {openBrace}{preview && !isArr ? <span style={{ color: '#9ca3af' }}> {preview}… </span> : <span style={{ color: '#9ca3af' }}> {entries.length} items </span>}{closeBrace}
        </span>
      )}
      {open && (
        <span>
          <span style={{ color: '#6b7280' }}>{openBrace}</span>
          <div style={{ marginLeft: INDENT }}>
            {entries.map(([k, v], i) => (
              <div key={k} style={{ lineHeight: '1.7', fontSize: 11 }}>
                {!isArr && <span style={{ color: '#93c5fd' }}>{k}</span>}
                {!isArr && <span style={{ color: '#6b7280' }}>: </span>}
                <JsonNode value={v} depth={depth + 1} />
                {i < entries.length - 1 && <span style={{ color: '#4b5563' }}>,</span>}
              </div>
            ))}
          </div>
          <span style={{ color: '#6b7280' }}>{closeBrace}</span>
        </span>
      )}
    </span>
  );
}

interface FetchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: unknown;
  error?: string;
}

function FetchResultPanel({ result }: { result: FetchState }) {
  const isSuccess = result.status === 'success';
  return (
    <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid #1f2937', display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a' }}>
      {/* Header */}
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
      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, color: '#f3f4f6' }}>
        {result.status === 'error'
          ? <span style={{ color: '#f87171' }}>{result.error}</span>
          : <JsonNode value={result.data} depth={0} />
        }
      </div>
    </div>
  );
}

// ─── Formula resolution helpers ───────────────────────────────────────────────

/** Extract a nested value by a dot-separated path (e.g. "data.search.items"). */
function extractByPath(data: unknown, path: string): unknown {
  if (!path) return data;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, data);
}

/** Build the current context from Zustand + variable store (same as FormulaEditor). */
function buildContext(): Record<string, unknown> {
  const zustandData = useSduiStore.getState().data;
  const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
  return { ...zustandData, ...vs };
}

/**
 * Resolve a KvEntry value for use in a live fetch.
 * - Unbound plain strings → returned as-is
 * - Bound formula strings (e.g. "{{route.slug}}" or a JSON object string) →
 *   evaluated against the current store state; falls back to raw string on error.
 */
function resolveEntryValue(entry: { value: string; valueBound: boolean }): unknown {
  if (!entry.valueBound) return entry.value;

  const ctx = buildContext();
  // Try to parse as JSON first (object/array variable like the `input` SearchInput)
  try {
    const parsed = JSON.parse(entry.value);
    if (typeof parsed === 'object' && parsed !== null) {
      // Recursively interpolate string values inside the object
      return JSON.parse(
        JSON.stringify(parsed, (_k, v) => {
          if (typeof v !== 'string') return v;
          const match = v.match(/^\{\{([^}]+)\}\}$/);
          if (!match) return v;
          const res = evaluateFormula(match[1].trim(), ctx);
          return res.value !== undefined ? res.value : v;
        })
      );
    }
  } catch { /* not JSON, fall through */ }

  // Plain formula string like "route.slug" or "{{route.slug}}"
  const formula = entry.value.replace(/^\{\{([^}]+)\}\}$/, '$1').trim();
  const res = evaluateFormula(formula, ctx);
  return res.value !== undefined ? res.value : entry.value;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const SECTION_HDR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderBottom: '1px solid #1f2937',
};
const SEC_LABEL: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#d1d5db', whiteSpace: 'nowrap', flexShrink: 0,
};
const EMPTY: React.CSSProperties = {
  fontSize: 11, color: '#4b5563', fontStyle: 'italic',
  padding: '8px 12px',
};
const ADD_BTN: React.CSSProperties = {
  padding: '3px 10px', background: '#1d4ed8', border: 'none',
  borderRadius: 4, color: '#fff', fontSize: 10, cursor: 'pointer',
};
const TYPE_COLOR: Record<string, string> = { rest: '#34d399', graphql: '#f59e0b' };

// ─── A. Data Sources ──────────────────────────────────────────────────────────

interface DataSourceSlidePanelProps {
  initial: Partial<DataSourceConfig>;
  onSave: (cfg: DataSourceConfig) => void;
  onClose: () => void;
}

// ─── Key-value entry with explicit bind tracking ───────────────────────────────

/** A single row in a headers / queryParams / variables list */
interface KvEntry {
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
 *  2. '{"expr":"formatCurrency(...)"}' — complex expr formula (JSON-stringified object)
 *  3. '{"formula":"route.slug"}' — legacy formula object
 */
function isFormulaString(v: string): boolean {
  if (/\{\{[^}]+\}\}/.test(v)) return true;
  try {
    const p = JSON.parse(v);
    return typeof p === 'object' && p !== null && !Array.isArray(p)
      && ('expr' in p || 'formula' in p);
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

function GqlEditor({ value, onChange, placeholder }: {
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

type FormulaFieldState = { open: boolean; fieldId: string } | null;

function useFormulaField(fieldId: string, formulaState: FormulaFieldState, setFormulaState: (s: FormulaFieldState) => void) {
  const isOpen = formulaState?.fieldId === fieldId && formulaState?.open;
  const open = () => setFormulaState({ open: true, fieldId });
  const close = () => setFormulaState(null);
  return { isOpen, open, close };
}

// ─── Shared form primitives ────────────────────────────────────────────────────

/** Section header: label + optional bind icon + Add button */
function SectionRow({
  label, onAdd, addTestId, bindActive, onBind,
}: {
  label: string;
  onAdd?: () => void;
  addTestId?: string;
  bindActive?: boolean;
  onBind?: () => void;
}) {
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
function KvRow({
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
function OnOffRow({
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
function SimpleToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
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

function TypePicker({ onSelect }: { onSelect: (t: 'rest' | 'graphql') => void }) {
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

function RestForm({ initial, onSave, onBack, onWidthChange }: {
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
  const [headers, setHeaders] = useState<KvEntry[]>(() => toKvEntries(initial.headers ?? []));
  const [queryParams, setQueryParams] = useState<KvEntry[]>(() => toKvEntries(initial.queryParams ?? []));
  const [proxy, setProxy] = useState<boolean | FormulaValue>(initial.proxy ?? false);
  const [sendCredentials, setSendCredentials] = useState(initial.sendCredentials ?? false);
  const [dsFolderId, setDsFolderId] = useState<string | undefined>(initial.folderId);
  const [formulaState, setFormulaState] = useState<FormulaFieldState>(null);
  const [headersBound, setHeadersBound] = useState(false);
  const [qsBound, setQsBound] = useState(false);
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
    onSave({
      id,
      name: trimmedName,
      _label: dsLabel.trim() || undefined,
      type: 'rest',
      url: urlStr,
      method: method ?? 'GET',
      headers: headers.filter(h => h.key.trim()).map(h => ({ key: h.key, value: h.value, enabled: true })),
      queryParams: queryParams.filter(p => p.key.trim()).map(p => ({ key: p.key, value: p.value, enabled: true })),
      storeIn: initial.storeIn ?? id,
      proxy: typeof proxy === 'boolean' ? proxy : false,
      sendCredentials,
      folderId: dsFolderId,
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
          <select data-testid="ds-method" value={method} onChange={e => setMethod(e.target.value as DataSourceConfig['method'])} style={{ ...SP_INPUT, cursor: 'pointer' }}>
            {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => <option key={m}>{m}</option>)}
          </select>
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

        {/* Headers */}
        <div style={{ marginBottom: 14 }}>
          <SectionRow label="Headers"
            onAdd={headersBound ? undefined : () => setHeaders(h => [...h, { key: '', value: '', keyBound: false, valueBound: false }])}
            addTestId="ds-add-header"
            bindActive={headersBound}
            onBind={() => { setHeadersBound(true); openHdrsFE(); }}
          />
          {hdrsFEOpen && (
            <FormulaEditor label="Headers (formula)" value={''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => { if (!v && v !== 0) setHeadersBound(false); closeHdrsFE(); }}
              onClose={() => { setHeadersBound(false); closeHdrsFE(); }}
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
            onBind={() => { setQsBound(true); openQsFE(); }}
          />
          {qsFEOpen && (
            <FormulaEditor label="Query string (formula)" value={''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => { if (!v && v !== 0) setQsBound(false); closeQsFE(); }}
              onClose={() => { setQsBound(false); closeQsFE(); }}
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

        {/* Proxy */}
        <OnOffRow label="Proxy request server side (bypass CORS)" value={proxy} onChange={setProxy} formulaState={formulaState} setFormulaState={setFormulaState} fieldId="rest-proxy" />

        {/* Send credentials */}
        <SimpleToggleRow label="Send credentials" value={sendCredentials} onChange={setSendCredentials} />
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

function GraphQLForm({ initial, onSave, onBack, onWidthChange }: {
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
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
        // __bound__ marker: saved by our form to preserve bound state across save/reopen
        if (typeof value === 'object' && value !== null && '__bound__' in value) {
          return { key, value: String((value as { __bound__: unknown }).__bound__), keyBound: false, valueBound: true };
        }
        const strVal = typeof value === 'string' ? value : JSON.stringify(value);
        // Mark as bound if: it's a non-string (object/array from datasources.json), {{...}}, or {expr/formula} JSON
        const valueBound = typeof value !== 'string' || isFormulaString(strVal);
        return { key, value: strVal, keyBound: false, valueBound };
      });
    } catch { return []; }
  });
  const [headers, setHeaders] = useState<KvEntry[]>(() => toKvEntries(initial.headers ?? []));
  const [sendCredentials, setSendCredentials] = useState(initial.sendCredentials ?? false);
  const [gqlFolderId, setGqlFolderId] = useState<string | undefined>(initial.folderId);
  const [returnDataOnly, setReturnDataOnly] = useState(!!initial.responsePath?.trim());
  const [formulaState, setFormulaState] = useState<FormulaFieldState>(null);
  // Restore last fetch result so the result panel reopens when editing
  const [fetchState, setFetchState] = useState<FetchState>(() =>
    initial._lastFetch ? { status: initial._lastFetch.status, data: initial._lastFetch.data, error: initial._lastFetch.error } : { status: 'idle' }
  );
  const [varsBound, setVarsBound] = useState(false);
  const [gqlHdrsBound, setGqlHdrsBound] = useState(false);

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
      // Resolve all variable values — including bound formulas — against current store state
      const varsObj: Record<string, unknown> = {};
      variables.filter(v => v.key.trim()).forEach(v => {
        varsObj[v.key.trim()] = resolveEntryValue(v);
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
    // Preserve bound state: wrap bound values in { __bound__: rawValue } so
    // isFormulaString detects them correctly on next form open (avoids double-stringify loss).
    const varsObj: Record<string, unknown> = {};
    variables.filter(v => v.key.trim()).forEach(v => {
      varsObj[v.key.trim()] = v.valueBound ? { __bound__: v.value } : v.value;
    });
    onSave({
      id,
      name: trimmedName,
      _label: gqlLabel.trim() || undefined,
      type: 'graphql',
      url: urlStr,
      method: 'POST',
      query: query.trim(),
      variables: Object.keys(varsObj).length ? JSON.stringify(varsObj) : undefined,
      headers: headers.filter(h => h.key.trim()).map(h => ({ key: h.key, value: h.value, enabled: true })),
      storeIn: initial.storeIn ?? id,
      sendCredentials,
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
            onBind={() => { setVarsBound(true); openVarsFE(); }}
          />
          {varsFEOpen && (
            <FormulaEditor label="Variables (formula)" value={''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => { if (!v && v !== 0) setVarsBound(false); closeVarsFE(); }}
              onClose={() => { setVarsBound(false); closeVarsFE(); }}
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
            onBind={() => { setGqlHdrsBound(true); openGqlHdrsFE(); }}
          />
          {gqlHdrsFEOpen && (
            <FormulaEditor label="Headers (formula)" value={''} anchorLeft={FORMULA_ANCHOR_LEFT}
              onChange={v => { if (!v && v !== 0) setGqlHdrsBound(false); closeGqlHdrsFE(); }}
              onClose={() => { setGqlHdrsBound(false); closeGqlHdrsFE(); }}
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

function DataSourceSlideContent({ initial, onSave, onClose, onWidthChange }: DataSourceSlideContentProps) {
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

interface FolderPickerProps {
  value: string | undefined;        // selected folderId
  onChange: (id: string | undefined) => void;
  scope: 'var' | 'ds';
}

function FolderPicker({ value, onChange, scope }: FolderPickerProps) {
  const store = useBuilderStore();
  const folders     = scope === 'var' ? store.varFolders     : store.dsFolders;
  const addFolder    = scope === 'var' ? store.addVarFolder    : store.addDsFolder;
  const updateFolder = scope === 'var' ? store.updateVarFolder : store.updateDsFolder;
  const removeFolder = scope === 'var' ? store.removeVarFolder : store.removeDsFolder;
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

// ─── B. Variables ─────────────────────────────────────────────────────────────

interface VarSlidePanelProps {
  initial: Partial<CustomVar> & { isNew?: boolean };
  onSave: (v: CustomVar) => void;
  onClose: () => void;
}

function YesNoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const base: React.CSSProperties = {
    flex: 1, padding: '5px 0', border: '1px solid #374151', fontSize: 11,
    cursor: 'pointer', fontWeight: 500, transition: 'background 0.15s, color 0.15s',
  };
  return (
    <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', width: '100%' }}>
      <button
        onClick={() => onChange(true)}
        style={{ ...base, borderRadius: '5px 0 0 5px', borderRight: 'none',
          background: value ? '#1d4ed8' : 'transparent',
          color: value ? '#fff' : '#6b7280' }}
      >Yes</button>
      <button
        onClick={() => onChange(false)}
        style={{ ...base, borderRadius: '0 5px 5px 0',
          background: !value ? '#1f2937' : 'transparent',
          color: !value ? '#f3f4f6' : '#6b7280' }}
      >No</button>
    </div>
  );
}

function VariableSlideContent({ initial, onSave, onClose }: VarSlidePanelProps) {
  const [varName, setVarName] = useState(initial.name ?? '');
  const [varLabel, setVarLabel] = useState(initial.label ?? '');
  const [varType, setVarType] = useState<CustomVar['type']>(initial.type ?? 'string');
  const [varDesc, setVarDesc] = useState(initial.description ?? '');
  const [folderId, setFolderId] = useState<string | undefined>(initial.folderId);
  const [saveStorage, setSaveStorage] = useState(initial.saveInLocalStorage ?? false);
  const [varValue, setVarValue] = useState(() => {
    if (initial.initialValue === undefined || initial.initialValue === '') return getDefaultForType(initial.type ?? 'string');
    return typeof initial.initialValue === 'string'
      ? initial.initialValue
      : JSON.stringify(initial.initialValue, null, 2);
  });
  const [jsonErr, setJsonErr] = useState<string | null>(() => {
    if ((initial.type === 'object' || initial.type === 'array') && initial.initialValue !== undefined) {
      const raw = typeof initial.initialValue === 'string' ? initial.initialValue : JSON.stringify(initial.initialValue, null, 2);
      try { JSON.parse(raw); return null; } catch (e) { return (e as Error).message; }
    }
    return null;
  });
  const [nameTouched, setNameTouched] = useState(false);

  const isJsonType = varType === 'object' || varType === 'array';
  const canSave = varName.trim().length > 0 && !(isJsonType && jsonErr);

  // Read current live value from variable store
  const currentValue = (() => {
    try {
      const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
      const v = vs[varName.trim()];
      if (v === undefined) return null;
      return typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    } catch { return null; }
  })();

  const save = () => {
    if (!canSave) return;
    let parsed: unknown = varValue;
    if (varType === 'number') parsed = varValue === '' ? 0 : Number(varValue);
    else if (varType === 'boolean') parsed = varValue === 'true';
    else if (varType === 'object' || varType === 'array') {
      try { parsed = JSON.parse(varValue); setJsonErr(null); }
      catch (e) { setJsonErr((e as Error).message); return; }
    }
    onSave({
      name: varName.trim(), label: varLabel.trim() || undefined, type: varType, initialValue: parsed,
      description: varDesc || undefined,
      saveInLocalStorage: saveStorage,
      folderId,
    });
  };

  const handleTypeChange = (t: CustomVar['type']) => {
    setVarType(t);
    const def = getDefaultForType(t);
    setVarValue(def);
    if (t === 'object' || t === 'array') {
      try { JSON.parse(def); setJsonErr(null); } catch (e) { setJsonErr((e as Error).message); }
    } else {
      setJsonErr(null);
    }
  };

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
      {/* Name */}
      <div>
        <label style={SP_LABEL}>Name *</label>
        <input
          data-testid="var-name"
          value={varName}
          onChange={e => { setVarName(e.target.value); setNameTouched(true); }}
          onBlur={() => setNameTouched(true)}
          placeholder="Give a name"
          style={{ ...SP_INPUT, border: `1px solid ${nameTouched && !varName.trim() ? '#f59e0b' : '#374151'}` }}
          disabled={!initial.isNew && !!initial.name}
        />
        {nameTouched && !varName.trim() && (
          <div style={{ marginTop: 4, padding: '5px 8px', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#d97706', fontSize: 12 }}>⚠</span>
            <span style={{ color: '#92400e', fontSize: 11 }}>A name is required.</span>
          </div>
        )}
      </div>

      {/* Label */}
      <div>
        <label style={SP_LABEL}>Label</label>
        <input
          value={varLabel}
          onChange={e => setVarLabel(e.target.value)}
          placeholder="Human-readable name…"
          style={SP_INPUT}
        />
      </div>

      {/* Folder */}
      <div>
        <label style={SP_LABEL}>Folder</label>
        <FolderPicker value={folderId} onChange={setFolderId} scope="var" />
      </div>

      {/* Description */}
      <div>
        <label style={SP_LABEL}>Description</label>
        <textarea
          value={varDesc}
          onChange={e => setVarDesc(e.target.value)}
          placeholder="Describe this variable…"
          rows={3}
          style={{ ...SP_INPUT, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
        />
      </div>

      {/* Type */}
      <div>
        <label style={SP_LABEL}>Type *</label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#818cf8', pointerEvents: 'none', fontFamily: 'monospace' }}>{'<>'}</span>
          <select
            data-testid="var-type"
            value={varType}
            onChange={e => handleTypeChange(e.target.value as CustomVar['type'])}
            style={{ ...SP_INPUT, paddingLeft: 26, cursor: 'pointer' }}
          >
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="object">Object</option>
            <option value="array">Array</option>
          </select>
        </div>
      </div>

      {/* Default value */}
      <div>
        <label style={SP_LABEL}>Default value *</label>
        {varType === 'boolean' ? (
          <YesNoToggle
            value={varValue === 'true'}
            onChange={v => setVarValue(v ? 'true' : 'false')}
          />
        ) : varType === 'number' ? (
          <input
            data-testid="var-value"
            type="number"
            value={varValue}
            onChange={e => setVarValue(e.target.value)}
            style={SP_INPUT}
          />
        ) : varType === 'object' || varType === 'array' ? (
          <>
            <div style={{ borderRadius: 4, overflow: 'hidden', border: `1px solid ${jsonErr ? '#ef4444' : '#374151'}` }}>
              <Suspense fallback={
                <textarea
                  value={varValue}
                  onChange={e => {
                    const v = e.target.value;
                    setVarValue(v);
                    try { JSON.parse(v); setJsonErr(null); } catch (err) { setJsonErr((err as Error).message); }
                  }}
                  rows={6}
                  style={{ ...SP_INPUT, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5, border: 'none' }}
                />
              }>
                <CodeMirror
                  data-testid="var-value"
                  value={varValue}
                  height="160px"
                  extensions={[json()]}
                  theme={oneDark}
                  onChange={v => {
                    setVarValue(v);
                    try { JSON.parse(v); setJsonErr(null); } catch (err) { setJsonErr((err as Error).message); }
                  }}
                  basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, closeBrackets: false, autocompletion: false }}
                  style={{ fontSize: 12 }}
                />
              </Suspense>
            </div>
            {jsonErr && (
              <div style={{ marginTop: 6, padding: '10px 12px', background: '#1f2937', border: '1px solid #374151', borderRadius: 6 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#f3f4f6', margin: '0 0 4px' }}>JSON and JavaScript</p>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: 0, lineHeight: 1.5 }}>
                  {varType === 'array' ? 'Array' : 'Object'} value should be set as JSON. If you entered valid JavaScript, try converting it to valid JSON.
                </p>
              </div>
            )}
          </>
        ) : (
          <input
            data-testid="var-value"
            type="text"
            value={varValue}
            onChange={e => setVarValue(e.target.value)}
            style={SP_INPUT}
          />
        )}
      </div>

      {/* Current value (read-only) */}
      <div>
        <label style={SP_LABEL}>Current value</label>
        <div style={{
          ...SP_INPUT, minHeight: 32, fontFamily: 'monospace', fontSize: 12, color: '#9ca3af',
          display: 'flex', alignItems: 'center', background: '#111827',
        }}>
          {currentValue !== null ? currentValue : varValue || getDefaultForType(varType)}
        </div>
      </div>

      {/* Save in local storage */}
      <div>
        <label style={SP_LABEL}>Save in local storage</label>
        <YesNoToggle value={saveStorage} onChange={setSaveStorage} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4, paddingBottom: 4 }}>
        <button onClick={onClose} style={SP_BTN_SECONDARY}>Cancel</button>
        <button data-testid="var-save" onClick={save} disabled={!canSave}
          style={{ ...SP_BTN_PRIMARY, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'not-allowed' }}>
          Save
        </button>
      </div>
    </div>
  );
}

function getDefaultForType(type: CustomVar['type']): string {
  switch (type) {
    case 'number': return '0';
    case 'boolean': return 'false';
    case 'object': return '{}';
    case 'array': return '[]';
    default: return '';
  }
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  string: '#818cf8', number: '#34d399', boolean: '#f59e0b',
  object: '#f87171', array: '#c084fc',
};

// ─── Slide state types ────────────────────────────────────────────────────────

export type DataTabSlideState =
  | { kind: 'dataSource'; editingId: string | null }
  | { kind: 'variable'; editingName: string | null }
  | null;

// ─── DataSlidePanelContent — rendered inside page.tsx's SlidePanel ────────────

interface DataSlidePanelContentProps {
  slideState: DataTabSlideState;
  onClose: () => void;
  onWidthChange?: (w: number) => void;
}

export function DataSlidePanelContent({ slideState, onClose, onWidthChange }: DataSlidePanelContentProps) {
  const store = useBuilderStore();

  const handleDsSave = useCallback((cfg: DataSourceConfig) => {
    const existing = store.pageDataSources.find(s => s.id === cfg.id);
    if (existing) store.updatePageDataSource(cfg.id, cfg);
    else store.addPageDataSource(cfg);
    onClose();
  }, [store, onClose]);

  const handleVarSave = useCallback((v: CustomVar) => {
    const existing = store.customVars.find(c => c.name === v.name);
    if (existing) store.updateCustomVar(v.name, {
      label: v.label,
      type: v.type,
      initialValue: v.initialValue,
      description: v.description,
      saveInLocalStorage: v.saveInLocalStorage,
      folderId: v.folderId,
    });
    else store.addCustomVar(v);
    onClose();
  }, [store, onClose]);

  if (!slideState) return null;

  if (slideState.kind === 'dataSource') {
    const existing = slideState.editingId
      ? store.pageDataSources.find(s => s.id === slideState.editingId) ?? {}
      : {};
    return <DataSourceSlideContent key={slideState.editingId ?? 'new'} initial={existing} onSave={handleDsSave} onClose={onClose} onWidthChange={onWidthChange} />;
  }

  if (slideState.kind === 'variable') {
    const existing = slideState.editingName
      ? store.customVars.find(v => v.name === slideState.editingName) ?? { isNew: false }
      : { isNew: true };
    return <VariableSlideContent initial={existing} onSave={handleVarSave} onClose={onClose} />;
  }

  return null;
}

export function getDataSlideTitle(slideState: DataTabSlideState): string {
  if (!slideState) return '';
  if (slideState.kind === 'dataSource') return slideState.editingId ? 'Data Source' : 'New Data Source';
  if (slideState.kind === 'variable') return slideState.editingName ? 'Edit Variable' : 'Add Variable';
  return '';
}

// ─── Main DataTab ─────────────────────────────────────────────────────────────

const SEARCH_INPUT: React.CSSProperties = {
  width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 4,
  padding: '4px 8px', fontSize: 10, color: '#d1d5db', outline: 'none', boxSizing: 'border-box',
};

const SUB_HDR: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase' as const,
  letterSpacing: '0.07em', padding: '4px 12px 2px', background: '#0f172a',
};

interface DataTabProps {
  onSetSlide: (s: DataTabSlideState) => void;
  onWidthChange?: (w: number) => void;
}

export function DataTab({ onSetSlide, onWidthChange }: DataTabProps) {
  const [dsSearch, setDsSearch] = useState('');
  const [varSearch, setVarSearch] = useState('');
  const [dsSearchOpen, setDsSearchOpen] = useState(false);
  const [varSearchOpen, setVarSearchOpen] = useState(false);
  const dsSearchRef = useRef<HTMLInputElement>(null);
  const varSearchRef = useRef<HTMLInputElement>(null);
  const [dsOpen, setDsOpen] = useState(true);
  const [varOpen, setVarOpen] = useState(true);
  const [activeDsId, setActiveDsId] = useState<string | null>(null);
  const { pageDataSources, removePageDataSource, addPageDataSource, updatePageDataSource, customVars, removeCustomVar, addCustomVar, updateCustomVar, varFolders, dsFolders } = useBuilderStore();
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const toggleFolder = (id: string) => setExpandedFolders(s => ({ ...s, [id]: !s[id] }));

  const filteredDs = pageDataSources.filter(s => {
    const displayName = (s as { _label?: string })._label ?? s.name ?? s.id ?? '';
    return displayName.toLowerCase().includes(dsSearch.toLowerCase());
  });

  const filteredVars = customVars.filter(v =>
    v.name?.toLowerCase().includes(varSearch.toLowerCase())
  );

  // Build a folder tree renderer for any item list
  function renderFolderGroup<T extends { folderId?: string }>(
    items: T[],
    renderItem: (item: T, depth: number) => React.ReactNode,
    emptyMsg: string,
    section: 'ds' | 'var',
    searchActive = false
  ) {
    const folders = section === 'var' ? varFolders : dsFolders;
    const roots = folders.filter(f => !f.parentId);
    const childFolders = (parentId: string) => folders.filter(f => f.parentId === parentId);
    const folderItems = (folderId: string) => items.filter(i => i.folderId === folderId);
    const unfoldered = items.filter(i => !i.folderId);

    // When searching, a folder should be force-expanded if it (or any descendant) has matching items
    const folderHasMatch = (fId: string): boolean => {
      if (folderItems(fId).length > 0) return true;
      return childFolders(fId).some(k => folderHasMatch(k.id));
    };

    const renderFolderNode = (f: Folder, depth = 0): React.ReactNode => {
      const manuallyExpanded = expandedFolders[`${section}-${f.id}`];
      const autoExpand = searchActive && folderHasMatch(f.id);
      const isExpanded = manuallyExpanded || autoExpand;
      const kids = childFolders(f.id);
      const its = folderItems(f.id);
      if (kids.length === 0 && its.length === 0) return null;
      return (
        <React.Fragment key={f.id}>
          {/* Folder header row */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: `5px 10px 5px ${10 + depth * 14}px`,
              cursor: 'pointer', userSelect: 'none',
            }}
            onClick={() => toggleFolder(`${section}-${f.id}`)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1e293b'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <Chevron open={isExpanded} size={10} color="#6b7280" />
            <span style={{ fontSize: 11, fontWeight: 500, color: '#d1d5db', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          </div>
          {isExpanded && (
            <>
              {its.map(i => renderItem(i, depth + 1))}
              {kids.map(k => renderFolderNode(k, depth + 1))}
            </>
          )}
        </React.Fragment>
      );
    };

    const hasAny = items.length > 0;
    return (
      <>
        {!hasAny && <div style={EMPTY}>{emptyMsg}</div>}
        {unfoldered.map(i => renderItem(i, 0))}
        {roots.map(f => renderFolderNode(f))}
      </>
    );
  }

  return (
    <div data-testid="data-tab-split" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Top: Data Sources ── */}
      <div data-testid="data-sources-column"
        style={{ flex: dsOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, borderBottom: '2px solid #1f2937', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}>
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setDsOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Chevron open={dsOpen} size={10} color="#6b7280" />
            Data Sources
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              title="Search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setDsSearchOpen(o => { const next = !o; if (next) setTimeout(() => dsSearchRef.current?.focus(), 20); else setDsSearch(''); return next; }); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: dsSearchOpen ? '#818cf8' : '#4b5563', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
              onMouseEnter={e => { if (!dsSearchOpen) (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
              onMouseLeave={e => { if (!dsSearchOpen) (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button data-testid="add-datasource-btn"
              onClick={() => onSetSlide({ kind: 'dataSource', editingId: null })}
              style={ADD_BTN}>
              + Add
            </button>
          </div>
        </div>
        {/* Slide-down search row */}
        <div style={{ overflow: 'hidden', maxHeight: dsSearchOpen ? 40 : 0, transition: 'max-height 0.2s ease', flexShrink: 0 }}>
          <div style={{ padding: '5px 10px' }}>
            <input
              ref={dsSearchRef}
              data-testid="ds-search"
              value={dsSearch}
              onChange={e => setDsSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setDsSearch(''); setDsSearchOpen(false); } }}
              placeholder="Search sources…"
              style={{ ...SEARCH_INPUT, width: '100%' }}
            />
          </div>
        </div>
        {dsOpen && (
          <>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {renderFolderGroup(
                filteredDs,
                (src, depth) => (
                  <DsRow
                    key={src.id}
                    src={src}
                    depth={depth}
                    isActive={activeDsId === src.id}
                    onEdit={() => { setActiveDsId(src.id); onWidthChange?.(src._lastFetch ? 660 : 320); onSetSlide({ kind: 'dataSource', editingId: src.id }); }}
                    onDelete={() => { if (activeDsId === src.id) setActiveDsId(null); removePageDataSource(src.id); }}
                    onDuplicate={() => { const newId = `ds-${Date.now()}`; addPageDataSource({ ...src, id: newId, name: src.name ? `${src.name}-copy` : undefined as unknown as string, storeIn: newId, _fromConfig: false }); }}
                    onMove={folderId => updatePageDataSource(src.id, { folderId })}
                  />
                ),
                'No data sources — config sources load automatically.',
                'ds',
                !!dsSearch
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Bottom: Variables ── */}
      <div data-testid="variables-column"
        style={{ flex: varOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}>
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setVarOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Chevron open={varOpen} size={10} color="#6b7280" />
            Variables
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              title="Search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setVarSearchOpen(o => { const next = !o; if (next) setTimeout(() => varSearchRef.current?.focus(), 20); else setVarSearch(''); return next; }); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: varSearchOpen ? '#818cf8' : '#4b5563', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
              onMouseEnter={e => { if (!varSearchOpen) (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
              onMouseLeave={e => { if (!varSearchOpen) (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button data-testid="add-variable-btn"
              onClick={() => onSetSlide({ kind: 'variable', editingName: null })}
              style={ADD_BTN}>
              + Add
            </button>
          </div>
        </div>
        {/* Slide-down search row */}
        <div style={{ overflow: 'hidden', maxHeight: varSearchOpen ? 40 : 0, transition: 'max-height 0.2s ease', flexShrink: 0 }}>
          <div style={{ padding: '5px 10px' }}>
            <input
              ref={varSearchRef}
              data-testid="var-search"
              value={varSearch}
              onChange={e => setVarSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setVarSearch(''); setVarSearchOpen(false); } }}
              placeholder="Search variables…"
              style={{ ...SEARCH_INPUT, width: '100%' }}
            />
          </div>
        </div>
        {varOpen && (
          <>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {renderFolderGroup(
                filteredVars,
                (v, depth) => (
                  <VarRow
                    key={v.name}
                    v={v}
                    depth={depth}
                    onEdit={() => onSetSlide({ kind: 'variable', editingName: v.name })}
                    onDelete={() => removeCustomVar(v.name)}
                    onDuplicate={() => {
                      const base = v.name.replace(/_copy(\d*)$/, '');
                      const existing = customVars.map(c => c.name);
                      let candidate = `${base}_copy`;
                      let i = 2;
                      while (existing.includes(candidate)) candidate = `${base}_copy${i++}`;
                      addCustomVar({ ...v, name: candidate });
                    }}
                    onMove={folderId => updateCustomVar(v.name, { folderId })}
                  />
                ),
                'No variables yet — add one.',
                'var',
                !!varSearch
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── VarRow — variable list item with ⋮ context menu ─────────────────────────

function VarRow({
  v, depth = 0, onEdit, onDelete, onDuplicate, onMove,
}: {
  v: CustomVar;
  depth?: number;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (folderId: string | undefined) => void;
}) {
  const { varFolders: allFolders } = useBuilderStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const col = TYPE_BADGE_COLORS[v.type] ?? '#6b7280';

  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) { setMenuOpen(false); setShowMove(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
    setShowMove(false);
    setMenuOpen(o => !o);
  };

  const MENU_ITEM: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
    fontSize: 12, color: '#d1d5db', cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left',
  };

  const folderTree = (parentId: string | null, indent: number): React.ReactNode[] => {
    return allFolders.filter(f => (f.parentId ?? null) === parentId).flatMap(f => [
      <button
        key={f.id}
        data-testid={`var-menu-move-${v.name}-${f.id}`}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(f.id); }}
        style={{ ...MENU_ITEM, paddingLeft: 12 + indent * 12,
          fontWeight: v.folderId === f.id ? 700 : 400,
          color: v.folderId === f.id ? '#a5b4fc' : '#d1d5db' }}
      >
        {v.folderId === f.id && <span style={{ fontSize: 10 }}>✓</span>}
        {v.folderId !== f.id && <span style={{ fontSize: 10, opacity: 0 }}>✓</span>}
        {f.name}
      </button>,
      ...folderTree(f.id, indent + 1),
    ]);
  };

  return (
    <div
      data-testid={`var-row-${v.name}`}
      onClick={onEdit}
      style={{ paddingLeft: 10 + depth * 14, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: `${col}22`, color: col, border: `1px solid ${col}44`, flexShrink: 0, fontWeight: 600 }}>{v.type.slice(0, 3)}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.label ?? v.name}
        </span>
        {v.label && (
          <span style={{ display: 'block', fontSize: 9, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
            {v.name}
          </span>
        )}
      </span>

      {/* ⋮ menu button */}
      <button
        ref={btnRef}
        data-testid={`var-menu-btn-${v.name}`}
        onClick={openMenu}
        style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 14, cursor: 'pointer', padding: '2px 4px', borderRadius: 3, lineHeight: 1, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
      >⋮</button>

      {/* Dropdown menu (portal) */}
      {menuOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={menuRef}
          data-testid={`var-menu-${v.name}`}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 160, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 99999, overflow: 'hidden' }}
        >
          {!showMove ? (
            <>
              <button
                data-testid={`var-menu-copy-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); navigator.clipboard?.writeText(v.name); }}
                style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>⧉</span> Copy</button>
              <button
                data-testid={`var-menu-duplicate-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDuplicate(); }}
                style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>⧉</span> Duplicate</button>
              <button
                data-testid={`var-menu-move-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(true); }}
                style={{ ...MENU_ITEM, justifyContent: 'space-between' }}
              ><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>📁</span> Move to</span><Chevron open={false} size={10} color="#6b7280" /></button>
              <div style={{ borderTop: '1px solid #374151' }} />
              <button
                data-testid={`var-menu-delete-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                style={{ ...MENU_ITEM, color: '#f87171' }}
              ><span style={{ fontSize: 12 }}>🗑</span> Delete</button>
            </>
          ) : (
            <>
              {/* Back header */}
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(false); }}
                style={{ ...MENU_ITEM, color: '#9ca3af', gap: 6 }}
              ><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Chevron open={false} size={10} color="#9ca3af" style={{ transform: 'rotate(180deg)' }} /> Back</span></button>
              <div style={{ borderTop: '1px solid #374151' }} />
              {/* No folder option */}
              <button
                data-testid={`var-menu-move-${v.name}-none`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(undefined); }}
                style={{ ...MENU_ITEM, color: !v.folderId ? '#a5b4fc' : '#9ca3af', fontStyle: 'italic' }}
              >
                {!v.folderId ? <span style={{ fontSize: 10 }}>✓</span> : <span style={{ fontSize: 10, opacity: 0 }}>✓</span>}
                No folder
              </button>
              {allFolders.length > 0 && <div style={{ borderTop: '1px solid #374151' }} />}
              {/* Folder tree */}
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                {folderTree(null, 0)}
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── DsRow — redesigned list item with ⋮ context menu ────────────────────────

function DsRow({
  src, depth = 0, onEdit, onDelete, onDuplicate, onMove, isActive,
}: {
  src: DataSourceConfig;
  depth?: number;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (folderId: string | undefined) => void;
  isActive?: boolean;
}) {
  const { dsFolders: allFolders } = useBuilderStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const isConfig = !!(src as { _fromConfig?: boolean })._fromConfig;
  const isGraphQL = src.type === 'graphql';
  const typeColor = TYPE_COLOR[src.type] ?? '#6b7280';
  const srcDisplayKey = src.name || src.id;
  const lastFetch = src._lastFetch;
  const hasFetchData = !!lastFetch;
  const fetchDotColor = lastFetch?.status === 'success' ? '#34d399' : lastFetch?.status === 'error' ? '#f87171' : undefined;

  // Close on outside click
  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setShowMove(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
    setShowMove(false);
    setMenuOpen(o => !o);
  };

  const MENU_ITEM: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
    fontSize: 12, color: '#d1d5db', cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left',
  };

  const handleFetch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    window.dispatchEvent(new CustomEvent('sdui:refetch-datasource', { detail: { name: src.name || src.id } }));
  };

  const folderTree = (parentId: string | null, indent: number): React.ReactNode[] =>
    allFolders.filter(f => (f.parentId ?? null) === parentId).flatMap(f => [
      <button key={f.id}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(f.id); }}
        style={{ ...MENU_ITEM, paddingLeft: 12 + indent * 12,
          fontWeight: src.folderId === f.id ? 700 : 400,
          color: src.folderId === f.id ? '#a5b4fc' : '#d1d5db' }}
      >
        <span style={{ fontSize: 10 }}>{src.folderId === f.id ? '✓' : ' '}</span>{f.name}
      </button>,
      ...folderTree(f.id, indent + 1),
    ]);

  return (
    <div data-testid={`ds-card-${srcDisplayKey}`}
      onClick={onEdit}
      style={{ paddingLeft: 10 + depth * 14, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderBottom: '1px solid #0f172a', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: isActive ? '#1e293b' : 'transparent', borderLeft: isActive ? '2px solid #6366f1' : '2px solid transparent' }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 4, background: `${typeColor}18`, border: `1px solid ${typeColor}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: typeColor, fontWeight: 700 }}>
        {isGraphQL ? '⬡' : '⇄'}
      </span>
      <span data-testid={`ds-type-badge-${srcDisplayKey}`} style={{ display: 'none' }}>{src.type}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(src as { _label?: string })._label ?? src.name}
        </span>
        {(src as { _label?: string })._label && src.name && (
          <span style={{ display: 'block', fontSize: 9, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
            {src.name}
          </span>
        )}
      </span>
      {hasFetchData && (
        <span title={lastFetch?.status === 'success' ? `Fetched ${lastFetch.fetchedAt ? new Date(lastFetch.fetchedAt).toLocaleTimeString() : ''}` : 'Last fetch failed'}
          style={{ width: 6, height: 6, borderRadius: '50%', background: fetchDotColor, flexShrink: 0, display: 'inline-block' }} />
      )}
      <button ref={btnRef} data-testid={`ds-menu-btn-${srcDisplayKey}`} onClick={openMenu}
        style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 14, cursor: 'pointer', padding: '2px 4px', borderRadius: 3, lineHeight: 1, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
      >⋮</button>

      {menuOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 160, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 99999, overflow: 'hidden' }}
        >
          {!showMove ? (
            <>
              {hasFetchData && (
                <button data-testid={`ds-menu-view-${srcDisplayKey}`}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}
                  style={MENU_ITEM}
                ><span style={{ fontSize: 11, color: fetchDotColor }}>●</span> View result</button>
              )}
              <button data-testid={`ds-menu-fetch-${srcDisplayKey}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={handleFetch} style={MENU_ITEM}
              ><span style={{ fontSize: 13 }}>↻</span> Fetch</button>
              <button data-testid={`edit-datasource-${src.id}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(); }} style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>✎</span> Edit</button>
              <button data-testid={`ds-menu-copy-${srcDisplayKey}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); navigator.clipboard?.writeText(srcDisplayKey); }} style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>⧉</span> Copy</button>
              <button data-testid={`ds-menu-duplicate-${srcDisplayKey}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDuplicate(); }} style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>⧉</span> Duplicate</button>
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(true); }}
                style={{ ...MENU_ITEM, justifyContent: 'space-between' }}
              ><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>📁</span> Move to</span><Chevron open={false} size={10} color="#6b7280" /></button>
              <div style={{ borderTop: '1px solid #374151' }} />
              <button data-testid={`delete-datasource-${src.id}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                style={{ ...MENU_ITEM, color: '#f87171' }}
              ><span style={{ fontSize: 12 }}>🗑</span> Delete</button>
            </>
          ) : (
            <>
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(false); }}
                style={{ ...MENU_ITEM, color: '#9ca3af', gap: 6 }}
              ><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Chevron open={false} size={10} color="#9ca3af" style={{ transform: 'rotate(180deg)' }} /> Back</span></button>
              <div style={{ borderTop: '1px solid #374151' }} />
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(undefined); }}
                style={{ ...MENU_ITEM, color: !src.folderId ? '#a5b4fc' : '#9ca3af', fontStyle: 'italic' }}
              >
                <span style={{ fontSize: 10 }}>{!src.folderId ? '✓' : ' '}</span> No folder
              </button>
              {allFolders.length > 0 && <div style={{ borderTop: '1px solid #374151' }} />}
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>{folderTree(null, 0)}</div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
