'use client';

/**
 * _variable-form.tsx
 *
 * Variable configuration form and related helpers for the DataTab.
 * Extracted from _data-tab.tsx.
 *
 * Exports:
 *  - YesNoToggle          — boolean toggle used in variable form
 *  - VariableSlideContent — full variable create/edit form
 *  - getDefaultForType    — returns default value string for a CustomVar type
 *  - TYPE_BADGE_COLORS    — badge color mapping by type
 */

import React, { useState, useRef, useCallback, lazy, Suspense, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';

const CodeMirror = lazy(() => import('@uiw/react-codemirror'));
import { useBuilderStore, type CustomVar } from './_store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL } from './_slide-panel';
import { BindingIcon } from './_formula-panel';
import { FolderPicker, SectionRow, KvRow, OnOffRow, useFormulaField, type FormulaFieldState, type KvEntry } from './_data-source-form';

export const TYPE_BADGE_COLORS: Record<string, string> = {
  string: '#3b82f6', number: '#f59e0b', boolean: '#10b981',
  object: '#8b5cf6', array: '#ec4899', any: '#6b7280',
};

// ─── B. Variables ─────────────────────────────────────────────────────────────

interface VarSlidePanelProps {
  initial: Partial<CustomVar> & { isNew?: boolean };
  onSave: (v: CustomVar) => void;
  onClose: () => void;
  onDelete?: () => void;
  /** When provided, replaces the global FolderPicker with a custom folder UI (e.g. component-scoped text input) */
  folderNode?: React.ReactNode;
}

export function YesNoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
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

export function VariableSlideContent({ initial, onSave, onClose, onDelete, folderNode }: VarSlidePanelProps) {
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

  // Reactive live value — subscribes to the global variable store so the
  // "Current value" display updates whenever the store changes (e.g. after
  // a workflow step runs).
  const lookupKey = initial.id ?? (varName.trim() || null);
  const [liveValue, setLiveValue] = useState<string>(() => {
    try {
      if (!lookupKey) return '';
      const v = getGlobalVariableStore().getState().data[lookupKey];
      if (v === undefined || v === null) return '';
      return typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    } catch { return ''; }
  });
  useEffect(() => {
    if (!lookupKey) return;
    const unsub = getGlobalVariableStore().subscribe((state: { data: Record<string, unknown> }) => {
      const v = state.data[lookupKey];
      const next = (v === undefined || v === null) ? '' : (typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v));
      setLiveValue(next);
    });
    return unsub;
  }, [lookupKey]);

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
        {folderNode !== undefined ? folderNode : <FolderPicker value={folderId} onChange={setFolderId} scope="var" />}
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

      {/* Current value (reactive) */}
      <div>
        <label style={SP_LABEL}>Current value</label>
        <div style={{
          ...SP_INPUT, minHeight: 32, fontFamily: 'monospace', fontSize: 12,
          color: liveValue ? '#e5e7eb' : '#4b5563',
          display: 'flex', alignItems: 'flex-start', background: '#111827',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {liveValue || <span style={{ fontStyle: 'italic', color: '#4b5563' }}>{varValue || getDefaultForType(varType)}</span>}
        </div>
      </div>

      {/* Save in local storage */}
      <div>
        <label style={SP_LABEL}>Save in local storage</label>
        <YesNoToggle value={saveStorage} onChange={setSaveStorage} />
        {saveStorage && (
          <div style={{ marginTop: 6, fontSize: 10, color: '#6b7280', lineHeight: 1.5 }}>
            Value is only saved when it differs from the default. Reverting to the default clears the stored key.
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4, paddingBottom: 4 }}>
        {onDelete && !initial.isNew && (
          <button
            data-testid="var-delete"
            onClick={onDelete}
            style={{ ...SP_BTN_SECONDARY, color: '#f87171', borderColor: '#7f1d1d', marginRight: 'auto' }}
          >Delete</button>
        )}
        <button onClick={onClose} style={SP_BTN_SECONDARY}>Cancel</button>
        <button data-testid="var-save" onClick={save} disabled={!canSave}
          style={{ ...SP_BTN_PRIMARY, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'not-allowed' }}>
          Save
        </button>
      </div>
    </div>
  );
}

export function getDefaultForType(type: CustomVar['type']): string {
  switch (type) {
    case 'number': return '0';
    case 'boolean': return 'false';
    case 'object': return '{}';
    case 'array': return '[]';
    default: return '';
  }
}
