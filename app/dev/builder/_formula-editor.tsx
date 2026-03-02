'use client';

/**
 * WeWeb-style Formula Editor
 *
 * Replaces both FormulaPanel (variables/template/expression modes) and
 * ExprBuilder (visual/ifthen/template/raw/preview-JSON modes).
 *
 * Layout (matches screenshot):
 *   Header:   label | Formula ▾ | Unbind | ↗ | ×
 *   Input:    monospace formula textarea
 *   Preview:  Current value  |  Expected format ?
 *   Tabs:     {x} Variables  |  ≡ Data  |  ƒ Formulas
 *   Body:     Searchable collapsible function categories or variable tree
 *   Footer:   Operators bar  =  !=  and  or  +  -  *
 */

import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { useBuilderStore } from './_store';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';

import {
  type FormulaValue,
  type EvalResult,
  evaluateFormula,
  formulaToStoredValue,
  storedValueToFormula,
  FORMULA_FNS,
} from '@/lib/sdui/formula-evaluator';

// Re-export for backward-compat consumers (_formula-panel, _expr-builder)
export type { FormulaValue, EvalResult };
export { evaluateFormula, formulaToStoredValue, storedValueToFormula, FORMULA_FNS };

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'variables' | 'data' | 'formulas';

export interface FormulaEditorProps {
  label: string;
  value: FormulaValue;
  onChange: (v: FormulaValue) => void;
  onClose: () => void;
  expectedType?: 'string' | 'number' | 'boolean' | 'any';
}

// ─── Function Library ─────────────────────────────────────────────────────────

interface FnDef {
  name: string;
  signature: string;
  description: string;
  returnType: string;
  insert: string; // text inserted into formula
}

const FUNCTION_LIBRARY: Record<string, FnDef[]> = {
  CONDITIONAL: [
    { name: 'if', signature: 'if(condition, value1, value2)', description: 'Returns value1 if condition is truthy, otherwise value2.', returnType: 'any', insert: 'if(' },
    { name: 'ifEmpty', signature: 'ifEmpty(value, fallback)', description: 'Returns value if it is not empty, otherwise returns fallback.', returnType: 'any', insert: 'ifEmpty(' },
    { name: 'not', signature: 'not(value)', description: 'Inverts a boolean — true becomes false, false becomes true.', returnType: 'boolean', insert: 'not(' },
    { name: 'switch', signature: 'switch(expression, case1, result1, ...default)', description: 'Tests expression against each case value and returns the matching result. Last argument is the default.', returnType: 'any', insert: 'switch(' },
  ],
  MATH: [
    { name: 'average', signature: 'average(...values)', description: 'Returns the average of all provided numbers or array values.', returnType: 'number', insert: 'average(' },
    { name: 'rollupSum', signature: 'rollupSum(array, key)', description: 'Sums the value of a specific key across all objects in an array.', returnType: 'number', insert: 'rollupSum(' },
    { name: 'round', signature: 'round(number, precision?)', description: 'Rounds a number. Optional precision sets the number of decimal places (default 0).', returnType: 'number', insert: 'round(' },
    { name: 'sum', signature: 'sum(...values)', description: 'Sums all provided numbers or an array of numbers.', returnType: 'number', insert: 'sum(' },
    { name: 'toNumber', signature: 'toNumber(value)', description: 'Converts a string to a number.', returnType: 'number', insert: 'toNumber(' },
  ],
  ARRAY: [
    { name: 'add', signature: 'add(array, ...values)', description: 'Adds one or more values to the end of an array (like push). Returns new array.', returnType: 'array', insert: 'add(' },
    { name: 'contains', signature: 'contains(array, value)', description: 'Returns true if value exists in the array.', returnType: 'boolean', insert: 'contains(' },
    { name: 'createArray', signature: 'createArray(...values)', description: 'Creates a new array from the provided values.', returnType: 'array', insert: 'createArray(' },
    { name: 'compare', signature: 'compare(array1, array2)', description: 'Returns true if both arrays have the same values in the same order.', returnType: 'boolean', insert: 'compare(' },
    { name: 'distinct', signature: 'distinct(array)', description: 'Returns a new array with duplicate values removed.', returnType: 'array', insert: 'distinct(' },
    { name: 'filterByKey', signature: 'filterByKey(array, key, value)', description: 'Returns only objects where array[key] equals value.', returnType: 'array', insert: 'filterByKey(' },
    { name: 'findIndex', signature: 'findIndex(array, value)', description: 'Returns the index of the first matching value, or -1 if not found.', returnType: 'number', insert: 'findIndex(' },
    { name: 'findIndexByKey', signature: 'findIndexByKey(array, key, value)', description: 'Returns the index of the first object where array[key] equals value.', returnType: 'number', insert: 'findIndexByKey(' },
    { name: 'getByIndex', signature: 'getByIndex(array, index)', description: 'Returns the element at the given index.', returnType: 'any', insert: 'getByIndex(' },
    { name: 'groupBy', signature: 'groupBy(array, key)', description: 'Groups array objects by the value of a given key. Returns grouped array.', returnType: 'array', insert: 'groupBy(' },
    { name: 'join', signature: 'join(array, separator?)', description: 'Joins all array elements into a string, separated by the given separator (default ",").', returnType: 'string', insert: 'join(' },
    { name: 'length', signature: 'length(array)', description: 'Returns the number of items in an array.', returnType: 'number', insert: 'length(' },
    { name: 'lookup', signature: 'lookup(array, value, key?)', description: 'Returns the first object where key equals value. Key defaults to "id".', returnType: 'object', insert: 'lookup(' },
    { name: 'lookupArray', signature: 'lookupArray(array, values, key)', description: 'Returns all objects where key is in the values array.', returnType: 'array', insert: 'lookupArray(' },
    { name: 'map', signature: 'map(array, key)', description: 'Returns an array containing only the value of key from each object.', returnType: 'array', insert: 'map(' },
    { name: 'merge', signature: 'merge(...arrays)', description: 'Merges two or more arrays into one.', returnType: 'array', insert: 'merge(' },
    { name: 'prepend', signature: 'prepend(array, ...values)', description: 'Adds values to the beginning of an array. Returns new array.', returnType: 'array', insert: 'prepend(' },
    { name: 'remove', signature: 'remove(array, value)', description: 'Removes the first occurrence of value from the array. Returns new array.', returnType: 'array', insert: 'remove(' },
    { name: 'removeByIndex', signature: 'removeByIndex(array, index)', description: 'Removes the element at the given index. Returns new array.', returnType: 'array', insert: 'removeByIndex(' },
    { name: 'removeByKey', signature: 'removeByKey(array, key, value)', description: 'Removes all objects where array[key] equals value. Returns new array.', returnType: 'array', insert: 'removeByKey(' },
    { name: 'reverse', signature: 'reverse(array)', description: 'Reverses the order of elements in an array.', returnType: 'array', insert: 'reverse(' },
    { name: 'rollup', signature: 'rollup(array, key, distinct?)', description: 'Returns an array of values for a given key from each object. Set distinct=true for unique values only.', returnType: 'array', insert: 'rollup(' },
    { name: 'slice', signature: 'slice(array, startIndex, endIndex?)', description: 'Returns a portion of an array from startIndex up to (but not including) endIndex.', returnType: 'array', insert: 'slice(' },
    { name: 'sort', signature: 'sort(array, order?, key?)', description: 'Sorts an array in "asc" or "desc" order. Provide key for arrays of objects.', returnType: 'array', insert: 'sort(' },
    { name: 'flat', signature: 'flat(array, depth?)', description: 'Flattens nested arrays into a single array up to the given depth (default 1).', returnType: 'array', insert: 'flat(' },
  ],
  TEXT: [
    { name: 'capitalize', signature: 'capitalize(text)', description: 'Capitalizes the first letter of each word in the string.', returnType: 'string', insert: 'capitalize(' },
    { name: 'concatenate', signature: 'concatenate(...values)', description: 'Joins multiple strings into one.', returnType: 'string', insert: 'concatenate(' },
    { name: 'contains', signature: 'contains(text, substring)', description: 'Returns true if substring exists within text.', returnType: 'boolean', insert: 'contains(' },
    { name: 'indexOf', signature: 'indexOf(text, substring)', description: 'Returns the position of substring in text, or -1 if not found.', returnType: 'number', insert: 'indexOf(' },
    { name: 'lower', signature: 'lower(text)', description: 'Converts a string to lowercase.', returnType: 'string', insert: 'lower(' },
    { name: 'split', signature: 'split(text, separator)', description: 'Splits a string into an array using the given separator.', returnType: 'array', insert: 'split(' },
    { name: 'subText', signature: 'subText(text, startIndex, endIndex?)', description: 'Returns part of a string from startIndex up to endIndex.', returnType: 'string', insert: 'subText(' },
    { name: 'textLength', signature: 'textLength(text)', description: 'Returns the number of characters in a string.', returnType: 'number', insert: 'textLength(' },
    { name: 'toText', signature: 'toText(value)', description: 'Converts a number, boolean, or array to a string.', returnType: 'string', insert: 'toText(' },
    { name: 'uppercase', signature: 'uppercase(text)', description: 'Converts a string to uppercase.', returnType: 'string', insert: 'uppercase(' },
  ],
  OBJECT: [
    { name: 'createObject', signature: 'createObject(key1, value1, ...)', description: 'Creates an object from key-value pairs.', returnType: 'object', insert: 'createObject(' },
    { name: 'getKeyValue', signature: 'getKeyValue(object, key)', description: 'Returns the value for a given key in an object.', returnType: 'any', insert: 'getKeyValue(' },
    { name: 'compare', signature: 'compare(object1, object2)', description: 'Returns true if both objects have the same keys and values.', returnType: 'boolean', insert: 'compare(' },
    { name: 'keys', signature: 'keys(object)', description: 'Returns all keys of an object as an array.', returnType: 'array', insert: 'keys(' },
    { name: 'omit', signature: 'omit(object, ...keys)', description: 'Returns the object without the specified keys.', returnType: 'object', insert: 'omit(' },
    { name: 'pick', signature: 'pick(object, ...keys)', description: 'Returns a new object containing only the specified keys.', returnType: 'object', insert: 'pick(' },
    { name: 'setKeyValue', signature: 'setKeyValue(object, key, value)', description: 'Returns a new object with the given key set to value.', returnType: 'object', insert: 'setKeyValue(' },
    { name: 'values', signature: 'values(object)', description: 'Returns all values of an object as an array.', returnType: 'array', insert: 'values(' },
  ],
  UTILS: [
    { name: 'toBool', signature: 'toBool(value)', description: 'Converts a value to boolean based on truthiness or falsiness.', returnType: 'boolean', insert: 'toBool(' },
  ],
};

const OPERATORS = [
  { label: '=', insert: ' === ', description: 'Equal to (strict)' },
  { label: '!=', insert: ' !== ', description: 'Not equal to (strict)' },
  { label: 'and', insert: ' && ', description: 'Logical AND — true only if both sides are true' },
  { label: 'or', insert: ' || ', description: 'Logical OR — true if at least one side is true' },
  { label: '+', insert: ' + ', description: 'Addition or string concatenation' },
  { label: '-', insert: ' - ', description: 'Subtraction' },
  { label: '*', insert: ' * ', description: 'Multiplication' },
];

// ─── Variable entries (shared with formula-panel) ─────────────────────────────

interface VarEntry { path: string; label: string; group: string; subgroup?: string; type: string; }

function buildVariableEntries(): VarEntry[] {
  const zustandData = useSduiStore.getState().data;
  const vs = getGlobalVariableStore().getState().getFullState();
  const entries: VarEntry[] = [];

  for (const key of Object.keys(zustandData)) {
    const prefix = key.split('.')[0];
    let subgroup = 'API Data';
    if (['auth', 'user'].includes(prefix)) subgroup = 'User';
    else if (['nav', 'layout'].includes(prefix)) subgroup = 'UI';
    entries.push({ path: key, label: key, group: 'App Data', subgroup, type: typeof zustandData[key] === 'object' ? 'object' : typeof zustandData[key] });
  }

  const vsObj = vs as Record<string, unknown>;
  for (const key of Object.keys(vsObj)) {
    if (key === 'screens') {
      const screens = vsObj.screens as Record<string, unknown> | undefined ?? {};
      for (const [screen, vals] of Object.entries(screens)) {
        if (vals && typeof vals === 'object') {
          for (const field of Object.keys(vals as object)) {
            entries.push({ path: `screens.${screen}.${field}`, label: `screens.${screen}.${field}`, group: 'App Data', subgroup: 'UI States', type: 'unknown' });
          }
        }
      }
    } else {
      const subgroup = ['nav', 'route', '_workflow'].includes(key) ? 'UI States' : 'UI';
      entries.push({ path: key, label: key, group: 'App Data', subgroup, type: typeof vsObj[key] });
    }
  }

  return entries;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: '130%', left: '50%', transform: 'translateX(-50%)',
          background: '#1e293b', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px',
          fontSize: 11, color: '#d1d5db', whiteSpace: 'pre-wrap', maxWidth: 220,
          zIndex: 100030, boxShadow: '0 4px 16px rgba(0,0,0,0.6)', pointerEvents: 'none',
          lineHeight: 1.5,
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

// ─── Variable Tree ────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  string: '#86efac', number: '#fde68a', boolean: '#c4b5fd',
  array: '#67e8f9', object: '#f9a8d4', unknown: '#9ca3af',
};

function VariableTree({ onSelect, search }: { onSelect: (path: string) => void; search: string }) {
  const entries = useMemo(() => buildVariableEntries(), []);
  const filtered = useMemo(() =>
    search ? entries.filter(e => e.path.toLowerCase().includes(search.toLowerCase())) : entries,
    [entries, search]
  );

  const grouped = useMemo(() => {
    const g: Record<string, Record<string, VarEntry[]>> = {};
    for (const e of filtered) {
      (g[e.group] ??= {})[e.subgroup ?? 'Other'] ??= [];
      g[e.group][e.subgroup ?? 'Other'].push(e);
    }
    return g;
  }, [filtered]);

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(['API Data', 'UI States', 'UI', 'User'])
  );
  const toggle = (k: string) => setExpanded(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {Object.entries(grouped).map(([group, subgroups]) => (
        <div key={group} style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '6px 12px 2px', fontWeight: 700 }}>
            {group}
          </div>
          {Object.entries(subgroups).map(([sg, items]) => {
            const key = `${group}:${sg}`;
            const open = expanded.has(key);
            return (
              <div key={sg}>
                <button onClick={() => toggle(key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: '3px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontSize: 9, color: '#6b7280' }}>{open ? '▾' : '▸'}</span>
                  <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>{sg}</span>
                </button>
                {open && items.map(e => (
                  <button key={e.path} onClick={() => onSelect(e.path)} title={e.path}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 5, padding: '3px 12px 3px 24px', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = '#1f2937')}
                    onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}
                  >
                    <span style={{ fontSize: 8, color: TYPE_COLOR[e.type] ?? '#6b7280', fontFamily: 'monospace', flexShrink: 0 }}>{e.type[0]}</span>
                    <span style={{ fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.path}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      {Object.keys(grouped).length === 0 && (
        <div style={{ padding: '12px', fontSize: 11, color: '#4b5563', fontStyle: 'italic', textAlign: 'center' }}>No variables match</div>
      )}
    </div>
  );
}

// ─── Function Library ─────────────────────────────────────────────────────────

function FunctionLibrary({ onInsert, search, globalFormulas }: {
  onInsert: (text: string) => void;
  search: string;
  globalFormulas: Record<string, unknown>;
}) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    () => new Set(Object.keys(FUNCTION_LIBRARY))
  );
  const toggleCat = (cat: string) =>
    setExpandedCats(p => { const n = new Set(p); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const q = search.toLowerCase();

  const fromProject = Object.keys(globalFormulas).map(name => ({
    name, signature: `${name}(...)`, description: 'Global formula defined in this project.', returnType: 'any', insert: `${name}(`,
  }));

  const allCategories = q
    ? null  // when searching, flatten all
    : null;
  void allCategories;

  const allFns = q
    ? Object.entries({ ...FUNCTION_LIBRARY, 'FROM PROJECT': fromProject })
        .flatMap(([cat, fns]) => fns.filter(f => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)).map(f => ({ ...f, cat })))
    : null;

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {allFns ? (
        // Flat search results
        allFns.map(f => (
          <FnRow key={`${f.cat}:${f.name}`} fn={f} onInsert={onInsert} />
        ))
      ) : (
        // Categorized
        [...Object.entries(FUNCTION_LIBRARY), ['FROM PROJECT', fromProject] as [string, FnDef[]]].map(([cat, fns]) => {
          const open = expandedCats.has(cat as string);
          return (
            <div key={cat as string}>
              <button
                onClick={() => toggleCat(cat as string)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '5px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #0f172a' }}
                onMouseEnter={ev => (ev.currentTarget.style.background = '#0f172a')}
                onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}
              >
                <span style={{ fontSize: 9, color: '#6b7280', width: 10 }}>{open ? '▾' : '▸'}</span>
                <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>{cat as string}</span>
                <span style={{ marginLeft: 'auto', fontSize: 9, color: '#374151' }}>{(fns as FnDef[]).length}</span>
              </button>
              {open && (fns as FnDef[]).map(f => (
                <FnRow key={f.name} fn={f} onInsert={onInsert} />
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function FnRow({ fn, onInsert }: { fn: FnDef; onInsert: (text: string) => void }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 12px 3px 20px' }}
      onMouseEnter={ev => (ev.currentTarget.style.background = '#1f2937')}
      onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}
    >
      <span style={{ fontSize: 10, color: '#a78bfa', fontStyle: 'italic', flexShrink: 0 }}>ƒ</span>
      <button
        onClick={() => onInsert(fn.insert)}
        title={fn.signature}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', flex: 1 }}
      >
        <span style={{ fontSize: 11, color: '#e2e8f0' }}>{fn.name}</span>
      </button>
      <Tooltip text={`${fn.signature}\n\n${fn.description}\nReturns: ${fn.returnType}`}>
        <span style={{ fontSize: 10, color: '#374151', cursor: 'default', border: '1px solid #374151', borderRadius: '50%', width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>?</span>
      </Tooltip>
    </div>
  );
}

// ─── FormulaEditor ────────────────────────────────────────────────────────────

export function FormulaEditor({ label, value, onChange, onClose, expectedType = 'any' }: FormulaEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { globalFormulas } = useBuilderStore();

  const [formula, setFormula] = useState(() => storedValueToFormula(value));
  const [tab, setTab] = useState<Tab>('formulas');
  const [search, setSearch] = useState('');

  // Build context for evaluation
  const context = useMemo(() => {
    const zustandData = useSduiStore.getState().data;
    const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
    return { ...zustandData, ...vs };
  }, []);

  const evalResult = useMemo(() => evaluateFormula(formula, context), [formula, context]);

  const apply = useCallback(() => {
    onChange(formulaToStoredValue(formula));
    onClose();
  }, [formula, onChange, onClose]);

  const unbind = useCallback(() => {
    onChange('');
    onClose();
  }, [onChange, onClose]);

  // Insert text at cursor position in textarea
  const insertAtCursor = useCallback((text: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setFormula(prev => prev + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newVal = formula.slice(0, start) + text + formula.slice(end);
    setFormula(newVal);
    // Restore cursor after inserted text
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    });
  }, [formula]);

  // Insert variable path at cursor
  const insertVar = useCallback((path: string) => {
    insertAtCursor(path);
  }, [insertAtCursor]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, apply]);

  const previewColor = evalResult.error
    ? '#f87171'
    : evalResult.value === undefined
      ? '#6b7280'
      : typeof evalResult.value === 'boolean'
        ? (evalResult.value ? '#86efac' : '#f87171')
        : '#86efac';

  const previewStr = evalResult.error
    ? evalResult.error
    : evalResult.value === undefined
      ? '—'
      : JSON.stringify(evalResult.value);

  const PANEL_W = 360;

  return createPortal(
    <div
      ref={panelRef}
      data-testid="formula-editor"
      style={{
        position: 'fixed',
        top: 52,
        left: 248,
        width: PANEL_W,
        height: 'calc(100vh - 64px)',
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        zIndex: 100020,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#f3f4f6', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <button onClick={unbind} data-testid="formula-unbind"
          style={{ padding: '2px 8px', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#9ca3af', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>
          Unbind
        </button>
        <button onClick={onClose} data-testid="formula-close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 16, lineHeight: 1, padding: '2px' }}>×</button>
      </div>

      {/* ── Formula input ── */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 5 }}>Formula</div>
        <textarea
          ref={textareaRef}
          data-testid="formula-input"
          value={formula}
          onChange={e => setFormula(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); } }}
          rows={3}
          spellCheck={false}
          placeholder="Type a formula or click a function below…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#0f172a', border: '1px solid #374151', borderRadius: 6,
            color: '#f3f4f6', fontSize: 12, padding: '7px 10px',
            fontFamily: '"JetBrains Mono", "Fira Mono", "Cascadia Code", monospace',
            resize: 'none', outline: 'none', lineHeight: 1.6,
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#818cf8')}
          onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
        />
      </div>

      {/* ── Current value + Expected format ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid #0f172a', flexShrink: 0, background: '#0d1420' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#6b7280' }}>Current value</span>
          <span style={{ fontSize: 11, color: previewColor, fontFamily: 'monospace', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {previewStr}
          </span>
        </div>
        <Tooltip text={`Expected return type: ${expectedType}`}>
          <span style={{ fontSize: 10, color: '#ef4444', cursor: 'default', display: 'flex', alignItems: 'center', gap: 3 }}>
            Expected format
            <span style={{ border: '1px solid #ef4444', borderRadius: '50%', width: 13, height: 13, fontSize: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>?</span>
          </span>
        </Tooltip>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {([
          { id: 'variables' as Tab, icon: '{x}', label: 'Variables' },
          { id: 'data' as Tab, icon: '≡', label: 'Data' },
          { id: 'formulas' as Tab, icon: 'ƒ', label: 'Formulas' },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '7px 4px', background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid #818cf8' : '2px solid transparent',
              color: tab === t.id ? '#818cf8' : '#6b7280',
              fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Search ── */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tab === 'formulas' ? 'Search functions…' : 'Search variables…'}
          style={{
            width: '100%', boxSizing: 'border-box', background: '#1f2937',
            border: '1px solid #374151', borderRadius: 4, color: '#d1d5db',
            fontSize: 11, padding: '4px 8px', outline: 'none',
          }}
        />
      </div>

      {/* ── Tab Body ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {tab === 'variables' && (
          <VariableTree onSelect={insertVar} search={search} />
        )}
        {tab === 'data' && (
          <div style={{ padding: '12px', fontSize: 11, color: '#6b7280', textAlign: 'center', marginTop: 16 }}>
            <div style={{ marginBottom: 6 }}>Available data sources</div>
            <div style={{ fontSize: 10, color: '#374151' }}>Run a data source in the Data tab to see its schema here.</div>
          </div>
        )}
        {tab === 'formulas' && (
          <FunctionLibrary onInsert={insertAtCursor} search={search} globalFormulas={globalFormulas} />
        )}
      </div>

      {/* ── Operators bar ── */}
      <div style={{ display: 'flex', borderTop: '1px solid #1f2937', flexShrink: 0, background: '#0f172a' }}>
        {OPERATORS.map(op => (
          <Tooltip key={op.label} text={op.description}>
            <button
              onClick={() => insertAtCursor(op.insert)}
              style={{
                flex: 1, padding: '8px 2px', background: 'none', border: 'none',
                borderRight: '1px solid #1f2937', cursor: 'pointer',
                color: '#9ca3af', fontSize: 11, fontFamily: 'monospace',
              }}
              onMouseEnter={ev => { ev.currentTarget.style.background = '#1f2937'; ev.currentTarget.style.color = '#f3f4f6'; }}
              onMouseLeave={ev => { ev.currentTarget.style.background = 'none'; ev.currentTarget.style.color = '#9ca3af'; }}
            >
              {op.label}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* ── Apply footer ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '8px 12px', borderTop: '1px solid #1f2937', flexShrink: 0 }}>
        <button onClick={onClose}
          style={{ padding: '4px 12px', background: 'transparent', border: '1px solid #374151', borderRadius: 5, color: '#6b7280', fontSize: 11, cursor: 'pointer' }}>
          Cancel
        </button>
        <button data-testid="formula-apply" onClick={apply}
          style={{ padding: '4px 14px', background: '#7c3aed', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
          Apply
        </button>
      </div>
    </div>,
    document.body
  );
}
