'use client';

/**
 * _panel-right-settings.tsx
 *
 * SettingsTab and AlignDistributePanel components for the builder right panel.
 * Extracted from _panel-right.tsx.
 *
 * Exports: SettingsTab, AlignDistributePanel
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense, useSyncExternalStore } from 'react';
import { json as cmJson } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
const CodeMirror = lazy(() => import('@uiw/react-codemirror'));
import { useBuilderStore, findParentNode } from './_store';
import type { SDUINode, PopoverConfig } from '@/lib/sdui/types/node';
import { SECTION_STYLE, LABEL_STYLE, SectionHeader, ToggleBtn } from './_panel-primitives';
import type { CustomVar } from './_store-types';
import { FieldWithBinding, BindingIcon, isBoundValue, type FormulaValue, closeAllEditors, registerEditorClose } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import { FigmaColorPicker } from './_color-picker';
import {
  updateSharedComponent as updateSCData,
  getSharedComponents,
} from '@/lib/builder/shared-component-data';
import type { SharedComponentProperty } from '@/lib/builder/shared-component-data';
import { findSharedRoot, findLinkedRoot } from './_store-node-helpers';
import { STANDALONE_VARIABLE_TYPES } from '@/lib/sdui/controlled-component-registry';
import { ResponsiveDot, DirectChangedLabel } from './_panel-primitives';

// ─── Responsive prop patching helper ─────────────────────────────────────────

/**
 * Returns a responsive-aware prop patcher.
 * At non-desktop breakpoints, writes to responsive[bp].props.<key> so the
 * change is scoped to that breakpoint only, leaving the base node intact.
 */
function useResponsivePropPatch(nodeId: string, nodeProps: Record<string, unknown>) {
  const store = useBuilderStore();
  const abp = useBuilderStore(s => s.activeBreakpoint);

  const patchPropResponsive = useCallback((key: string, value: unknown) => {
    if (abp !== 'desktop') {
      const rbp = abp as 'laptop' | 'tablet' | 'mobile';
      if (value === undefined) store.removeResponsiveOverride(nodeId, rbp, `props.${key}`);
      else store.patchResponsive(nodeId, rbp, `props.${key}`, value);
    } else {
      store.patchNodeField(nodeId, 'props', { ...nodeProps, [key]: value });
    }
  }, [abp, nodeId, nodeProps, store]);

  /** Get breakpoints that have a specific prop key overridden */
  const getPropOverrideBps = useCallback((key: string): string[] => {
    if (!store.pageNodes) return [];
    const node = (store.pageNodes as Array<{ id?: string; responsive?: Record<string, unknown> }>).find(n => n.id === nodeId);
    if (!node?.responsive) return [];
    const bps: string[] = [];
    for (const bp of ['laptop', 'tablet', 'mobile'] as const) {
      const ov = (node.responsive as Record<string, unknown>)[bp] as { props?: Record<string, unknown> } | undefined;
      if (ov?.props && key in ov.props) bps.push(bp);
    }
    return bps;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, store.pageNodes]);

  return { patchPropResponsive, getPropOverrideBps, abp };
}

// ─── Controlled Toggle ────────────────────────────────────────────────────────

function ControlledToggleRow({ node }: { node: SDUINode }) {
  const nodeId = (node as unknown as { id?: string }).id ?? '';
  const nodeType = node.type as string;
  const customVars = useBuilderStore(s => s.customVars) as CustomVar[];
  const addCustomVar = useBuilderStore(s => s.addCustomVar);
  const isInsideScEdit = useBuilderStore(s => !!s.editingSharedComponentId);
  const removeCustomVar = useBuilderStore(s => s.removeCustomVar);
  const patchNodeField = useBuilderStore(s => s.patchNodeField);

  // Read pre-stamped _controlled FIRST so we can use it to derive varId/scValueVariable
  // when the SC model lookup fails (e.g. store not hydrated yet on first render).
  // globalId is no longer stored in JSON — page slot is always ${nodeId}-value.
  const _preStampedControlled = (node as unknown as { _controlled?: { variable?: string } })._controlled;

  // Detect if this is a shared component instance with a declared valueVariable.
  const sharedId = (node as unknown as { _shared?: { id: string } })._shared?.id;
  const scModel = sharedId ? getSharedComponents()[sharedId] : undefined;
  // Fall back to pre-stamped variable name if the model doesn't carry valueVariable yet.
  const scValueVariable = (scModel?.valueVariable ?? _preStampedControlled?.variable) as string | undefined;

  // Input/Textarea always auto-write to `${nodeId}-value` — no toggle needed.
  const isAutoTracked = STANDALONE_VARIABLE_TYPES.has(nodeType);
  // SC nodes that declare a valueVariable can be controlled.
  const isScWithValue = Boolean(scValueVariable);
  const usesValueSlot = isAutoTracked || isScWithValue;
  // Page slot is always ${nodeId}-value for SC/value-bearing nodes, else nodeId.
  const varId = usesValueSlot ? `${nodeId}-value` : nodeId;

  // SC type of the value variable (boolean for checkbox/switch, text otherwise)
  const scVarDef = isScWithValue && scModel?.variables
    ? (scModel.variables as Record<string, { type?: string; initialValue?: unknown }>)[scValueVariable!]
    : undefined;
  // Explicit type stored in _controlled.type takes priority; SC model type is the fallback.
  const controlledType = (_preStampedControlled as { variable?: string; type?: string } | undefined)?.type;
  const inferredType = scVarDef?.type ?? 'text';
  const resolvedType = controlledType ?? inferredType;
  const isBool = resolvedType === 'boolean';

  // A node is "controlled" when a customVar is registered OR when _controlled metadata
  // is present (pre-stamped in JSON or set by a prior toggle-on).
  const isControlled = customVars.some(v => v.id === varId) || _preStampedControlled != null;

  // If the node has a pre-stamped _controlled but the variable isn't in customVars yet
  // (e.g. showcase JSON was hand-authored), auto-register it so it appears in the formula picker.
  const varInStore = customVars.some(v => v.id === varId);
  useEffect(() => {
    if (_preStampedControlled != null && !varInStore && isScWithValue) {
      const displayName = (scModel as { name?: string } | undefined)?.name
        ?? (node as unknown as { name?: string }).name
        ?? nodeType;
      const varName = `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${nodeId.slice(0, 6)}`;
      const varType = scVarDef?.type ?? 'text';
      const varInitial = scVarDef?.initialValue ?? (varType === 'boolean' ? false : varType === 'number' ? 0 : '');
      addCustomVar({ id: varId, name: varName, label: displayName, type: varType as CustomVar['type'], initialValue: varInitial } as CustomVar);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varId, _preStampedControlled != null]);

  // Debounce config stored on the node
  const nodeExtra = node as unknown as Record<string, unknown>;
  const debounce = nodeExtra._debounce as { enabled?: boolean; delay?: number } | undefined;
  const debounceEnabled = debounce?.enabled ?? false;
  const debounceDelay = debounce?.delay ?? 500;
  const initValueRaw = (nodeExtra._initialValue ?? '') as string | boolean | { formula: string };
  const isInitFormula = initValueRaw !== null && typeof initValueRaw === 'object' && 'formula' in (initValueRaw as object);

  // Live value — subscribes to the global variable store so it updates on every change.
  const liveValue = useSyncExternalStore(
    cb => getGlobalVariableStore().subscribe(cb),
    () => getGlobalVariableStore().getState().data[varId],
  );

  const patchDebounce = (patch: Partial<{ enabled: boolean; delay: number }>) => {
    patchNodeField(nodeId, '_debounce' as keyof SDUINode, { ...(debounce ?? {}), ...patch });
  };

  const toggle = () => {
    if (isControlled) {
      const existing = customVars.find(v => v.id === varId);
      if (existing) removeCustomVar(existing.name);
      if (!isAutoTracked) {
        // Clear _controlled for both SC and non-SC nodes
        patchNodeField(nodeId, '_controlled' as keyof SDUINode, undefined);
        if (!isScWithValue) {
          // For non-SC nodes also remove the injected props.value binding
          const nodeProps = (node.props ?? {}) as Record<string, unknown>;
          const cleanedProps = { ...nodeProps };
          delete cleanedProps['value'];
          patchNodeField(nodeId, 'props', cleanedProps);
        }
      }
    } else {
      const displayName = (scModel as { name?: string } | undefined)?.name
        ?? (node as unknown as { name?: string }).name
        ?? nodeType;
      const varName = `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${nodeId.slice(0, 6)}`;
      const varType = resolvedType;
      const varInitial = scVarDef?.initialValue ?? (varType === 'boolean' ? false : varType === 'number' ? 0 : varType === 'array' ? [] : varType === 'object' ? {} : '');

      addCustomVar({ id: varId, name: varName, label: displayName, type: varType, initialValue: varInitial } as CustomVar);

      if (isScWithValue) {
        // For SC nodes: store which internal variable is the value variable + explicit type.
        // Page slot is ${nodeId}-value — derived at runtime, not stored in JSON.
        patchNodeField(nodeId, '_controlled' as keyof SDUINode, { variable: scValueVariable, type: varType });
      } else if (!isAutoTracked) {
        // For non-SC controlled nodes: _controlled: { type } marks the node as controlled.
        // Page slot is ${nodeId}-value — derived at runtime, not stored in JSON.
        // Keep the props.value formula binding so the node's rendering reads the variable.
        patchNodeField(nodeId, '_controlled' as keyof SDUINode, { type: varType });
        const nodeProps = (node.props ?? {}) as Record<string, unknown>;
        patchNodeField(nodeId, 'props', { ...nodeProps, value: { formula: `variables['${varId}']` } });
      }
    }
  };

  // ── SC instance with a declared valueVariable: hide when NOT in SC edit mode ──
  // Outside edit mode, controlled behaviour for SCs is handled through valueVariable + _controlled
  // set in JSON — showing the toggle would be confusing. Inside SC edit mode the user may
  // need to mark internal nodes as controlled, so the toggle is always shown there.
  if (isScWithValue && !isInsideScEdit) return null;

  // ── Auto-tracked (Input / Textarea): always controlled, show read-only badge ──
  if (isAutoTracked) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 12px', borderBottom: '1px solid #1f2937' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 11, color: '#f3f4f6', fontWeight: 500 }}>Controlled</span>
            <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>{`variables['${varId}']`}</span>
          </div>
          <span style={{ fontSize: 10, color: '#34d399', background: '#064e3b', borderRadius: 3, padding: '2px 7px', fontWeight: 700, flexShrink: 0 }}>Auto</span>
        </div>
        <div style={{ fontSize: 10, color: '#6b7280', display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: '#818cf8' }}>Live:</span>
          <span style={{ color: '#f3f4f6', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {liveValue === undefined || liveValue === null ? '—' : String(liveValue)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 12px', borderBottom: '1px solid #1f2937' }}>
      {/* Toggle row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#f3f4f6', fontWeight: 500 }}>Controlled</span>
        <button
          onClick={toggle}
          style={{
            width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
            background: isControlled ? '#3b82f6' : '#374151',
            position: 'relative', transition: 'background 0.15s',
          }}
          title={isControlled ? 'Disable controlled mode' : 'Enable controlled mode — creates a page variable'}
        >
          <span style={{
            position: 'absolute', top: 2, left: isControlled ? 18 : 2, width: 16, height: 16,
            borderRadius: 8, background: 'white', transition: 'left 0.15s',
          }} />
        </button>
      </div>

      {/* Extra rows when controlled is ON — shown for SC nodes and plain controlled nodes alike */}
      {isControlled && !isAutoTracked && (
        <>
          {/* Type selector — full width */}
          <select
            value={resolvedType}
            onChange={e => {
              const t = e.target.value as 'text' | 'boolean' | 'number' | 'array' | 'object';
              const existing = customVars.find(v => v.id === varId);
              if (existing) {
                const newInitial = t === 'boolean' ? false : t === 'number' ? 0 : t === 'array' ? [] : t === 'object' ? {} : '';
                addCustomVar({ ...existing, type: t, initialValue: newInitial } as CustomVar);
              }
              const base = isScWithValue
                ? { variable: scValueVariable, type: t }
                : { type: t };
              patchNodeField(nodeId, '_controlled' as keyof SDUINode, base);
              patchNodeField(nodeId, '_initialValue' as keyof SDUINode,
                t === 'boolean' ? false : t === 'number' ? 0 : t === 'array' ? '[]' : t === 'object' ? '{}' : '');
            }}
            style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
          >
            <option value="text">Text</option>
            <option value="boolean">Boolean</option>
            <option value="number">Number</option>
            <option value="array">Array</option>
            <option value="object">Object</option>
          </select>

          {/* Init value — all types have a bind button via FieldWithBinding */}
          {isBool ? (
            <FieldWithBinding
              label="Init value"
              value={initValueRaw as import('./_formula-panel').FormulaValue}
              onChange={v => {
                patchNodeField(nodeId, '_initialValue' as keyof SDUINode, v);
                getGlobalVariableStore().getState().set(varId, typeof v === 'boolean' ? v : false);
              }}
              expectedType="boolean"
            >
              <button
                onClick={() => {
                  const next = !initValueRaw;
                  patchNodeField(nodeId, '_initialValue' as keyof SDUINode, next);
                  getGlobalVariableStore().getState().set(varId, next);
                }}
                style={{
                  width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
                  background: initValueRaw ? '#3b82f6' : '#374151', position: 'relative', transition: 'background 0.15s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: initValueRaw ? 18 : 2, width: 16, height: 16,
                  borderRadius: 8, background: 'white', transition: 'left 0.15s',
                }} />
              </button>
            </FieldWithBinding>
          ) : resolvedType === 'number' ? (
            <FieldWithBinding
              label="Init value"
              value={initValueRaw as import('./_formula-panel').FormulaValue}
              onChange={v => {
                patchNodeField(nodeId, '_initialValue' as keyof SDUINode, v);
                if (typeof v === 'number') getGlobalVariableStore().getState().set(varId, v);
              }}
              expectedType="number"
            >
              <input
                type="number"
                value={isInitFormula ? '' : String(initValueRaw ?? 0)}
                onChange={e => {
                  const n = Number(e.target.value);
                  patchNodeField(nodeId, '_initialValue' as keyof SDUINode, n);
                  getGlobalVariableStore().getState().set(varId, n);
                }}
                placeholder="0"
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
              />
            </FieldWithBinding>
          ) : resolvedType === 'array' || resolvedType === 'object' ? (
            <FieldWithBinding
              label="Init value"
              value={initValueRaw as import('./_formula-panel').FormulaValue}
              onChange={v => {
                patchNodeField(nodeId, '_initialValue' as keyof SDUINode, v);
                if (typeof v === 'string') { try { getGlobalVariableStore().getState().set(varId, JSON.parse(v)); } catch { /* noop */ } }
              }}
              expectedType="string"
            >
              <Suspense fallback={<div style={{ height: 60, background: '#1f2937', borderRadius: 4 }} />}>
                <div style={{ borderRadius: 4, overflow: 'hidden', border: '1px solid #374151', width: '100%' }}>
                  <CodeMirror
                    value={isInitFormula ? '' : (typeof initValueRaw === 'string' ? initValueRaw : JSON.stringify(initValueRaw ?? (resolvedType === 'array' ? [] : {}), null, 2))}
                    height="80px"
                    extensions={[cmJson()]}
                    theme={oneDark}
                    basicSetup={{ lineNumbers: false, foldGutter: false }}
                    onChange={v => {
                      patchNodeField(nodeId, '_initialValue' as keyof SDUINode, v);
                      try { getGlobalVariableStore().getState().set(varId, JSON.parse(v)); } catch { /* noop */ }
                    }}
                  />
                </div>
              </Suspense>
            </FieldWithBinding>
          ) : (
            <FieldWithBinding
              label="Init value"
              value={initValueRaw as import('./_formula-panel').FormulaValue}
              onChange={v => {
                patchNodeField(nodeId, '_initialValue' as keyof SDUINode, v);
                if (typeof v === 'string') getGlobalVariableStore().getState().set(varId, v);
              }}
              expectedType="string"
            >
              <input
                value={isInitFormula ? '' : String(initValueRaw ?? '')}
                onChange={e => {
                  patchNodeField(nodeId, '_initialValue' as keyof SDUINode, e.target.value);
                  getGlobalVariableStore().getState().set(varId, e.target.value);
                }}
                placeholder="Initial value"
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
              />
            </FieldWithBinding>
          )}

          {/* Debounce toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#d1d5db', flexShrink: 0, minWidth: 80 }}>Debounce</span>
            <button
              onClick={() => patchDebounce({ enabled: !debounceEnabled })}
              style={{
                width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
                background: debounceEnabled ? '#3b82f6' : '#374151', position: 'relative', transition: 'background 0.15s',
              }}
            >
              <span style={{
                position: 'absolute', top: 2, left: debounceEnabled ? 18 : 2, width: 16, height: 16,
                borderRadius: 8, background: 'white', transition: 'left 0.15s',
              }} />
            </button>
          </div>

          {/* Delay (only when debounce on) */}
          {debounceEnabled && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#d1d5db', flexShrink: 0, minWidth: 80 }}>Delay</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
                <input
                  type="number"
                  value={debounceDelay}
                  min={0} max={5000} step={50}
                  onChange={e => patchDebounce({ delay: Math.max(0, Number(e.target.value)) })}
                  style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 5px', outline: 'none', width: 52, textAlign: 'center' }}
                />
                <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>ms</span>
                <input
                  type="range" min={0} max={2000} step={50} value={debounceDelay}
                  onChange={e => patchDebounce({ delay: Number(e.target.value) })}
                  style={{ flex: 1, accentColor: '#3b82f6', width: 60 }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

const SETTINGS_INPUT_TYPES = new Set(['Input', 'Textarea']);

const INPUT_TYPE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Email',    value: 'email' },
  { label: 'Password', value: 'password' },
  { label: 'Number',   value: 'number' },
  { label: 'Decimal',  value: 'decimal' },
  { label: 'Phone',    value: 'tel' },
  { label: 'Currency', value: 'currency' },
];

/** Row layout for settings: label on left, control on right */
function SettingsRow({
  label,
  children,
  indent = false,
}: {
  label: string;
  children: React.ReactNode;
  indent?: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: `5px ${indent ? 12 : 12}px`,
      paddingLeft: indent ? 20 : 12,
    }}>
      <span style={{ fontSize: 11, color: '#d1d5db', flexShrink: 0, minWidth: 80 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
        {children}
      </div>
    </div>
  );
}

/** On/Off segmented toggle reused from design tab style */
function OnOffToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const btnBase: React.CSSProperties = {
    padding: '2px 10px',
    fontSize: 10,
    border: 'none',
    cursor: 'pointer',
    borderRadius: 3,
    fontWeight: 500,
  };
  return (
    <div style={{ display: 'flex', background: '#1f2937', borderRadius: 4, padding: 2, gap: 2 }}>
      <button
        style={{ ...btnBase, background: value ? '#374151' : 'transparent', color: value ? '#f3f4f6' : '#6b7280' }}
        onClick={() => onChange(true)}
      >On</button>
      <button
        style={{ ...btnBase, background: !value ? '#374151' : 'transparent', color: !value ? '#f3f4f6' : '#6b7280' }}
        onClick={() => onChange(false)}
      >Off</button>
    </div>
  );
}

/** Small text input for settings rows */
function SettingsTextInput({ value, onChange, placeholder, expandable = false, testId }: { value: string; onChange: (v: string) => void; placeholder?: string; expandable?: boolean; testId?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'flex-end' }}>
      <input
        data-testid={testId}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); (e.target as HTMLInputElement).blur(); } }}
        placeholder={placeholder}
        style={{
          background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
          color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none',
          width: 130, boxSizing: 'border-box',
        }}
      />
      {expandable && (
        <button style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }} title="Expand">⤢</button>
      )}
    </div>
  );
}

type ValidationRuleType = 'required' | 'email' | 'minLength' | 'maxLength' | 'phone' | 'url' | 'pattern' | 'equalsField' | 'formula';
type ValidationRule = { type: ValidationRuleType; message: string; value?: string; formula?: FormulaValue };
type NodeValidation = { trigger?: 'submit' | 'change'; rules?: ValidationRule[] };

// Local-state text input: shows updates immediately, commits to store only on blur.
// Prevents a Zustand write + re-render on every keystroke.
function RuleMessageInput({ value, onChange, placeholder = 'Error message', style }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      placeholder={placeholder}
      style={style}
    />
  );
}

function RuleValueInput({ value, onChange, placeholder = '', style }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      placeholder={placeholder}
      style={style}
    />
  );
}
type NodeDebounce = { enabled?: boolean; delay?: number };

const RULE_TYPE_OPTIONS: { value: ValidationRuleType; label: string; hasValue?: boolean; valuePlaceholder?: string }[] = [
  { value: 'required',    label: 'Required' },
  { value: 'email',       label: 'Email' },
  { value: 'minLength',   label: 'Min length',    hasValue: true, valuePlaceholder: '2' },
  { value: 'maxLength',   label: 'Max length',    hasValue: true, valuePlaceholder: '100' },
  { value: 'phone',       label: 'Phone' },
  { value: 'url',         label: 'URL' },
  { value: 'pattern',     label: 'Pattern (regex)', hasValue: true, valuePlaceholder: '^[a-z]+$' },
  { value: 'equalsField', label: 'Equals field',  hasValue: true, valuePlaceholder: 'fieldName' },
  { value: 'formula',     label: 'Custom formula' },
];
const RULE_DEFAULTS: Record<ValidationRuleType, Partial<ValidationRule>> = {
  required:    { message: 'This field is required' },
  email:       { message: 'Please enter a valid email address' },
  minLength:   { message: 'Must be at least N characters', value: '2' },
  maxLength:   { message: 'Must be at most N characters', value: '100' },
  phone:       { message: 'Please enter a valid phone number' },
  url:         { message: 'Please enter a valid URL' },
  pattern:     { message: 'Invalid format', value: '' },
  equalsField: { message: 'Fields do not match', value: '' },
  formula:     { message: 'Invalid value' },
};

const ICONIFY_API_BASE = 'https://api.iconify.design';

// ── AnyPropEditor: compact CodeMirror with expand toggle ─────────────────────

function AnyPropEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ position: 'relative', width: 130, boxSizing: 'border-box' as const, borderRadius: 4, overflow: 'hidden', border: '1px solid #374151' }}>
      <Suspense fallback={
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={expanded ? 5 : 1}
          style={{ width: '100%', background: '#1f2937', border: 'none', color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', resize: 'none', fontFamily: 'monospace', boxSizing: 'border-box' as const, height: expanded ? 110 : 26 }}
        />
      }>
        <CodeMirror
          value={value}
          height={expanded ? '110px' : '26px'}
          extensions={[cmJson()]}
          theme={oneDark}
          onChange={v => onChange(v)}
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: expanded, closeBrackets: false, autocompletion: false }}
          style={{ fontSize: 11 }}
        />
      </Suspense>
      {/* Expand / collapse toggle */}
      <button
        onClick={() => setExpanded(e => !e)}
        title={expanded ? 'Collapse' : 'Expand'}
        style={{ position: 'absolute', bottom: 3, right: 3, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#374151', border: 'none', borderRadius: 3, cursor: 'pointer', padding: 0, zIndex: 10 }}
      >
        {expanded ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
            <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
          </svg>
        ) : (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        )}
      </button>
    </div>
  );
}

// ── SpecificRow: SettingsRow label + FieldWithBinding bind button ────────────

/** A settings row that includes a formula-binding button beside every field. */
function SpecificRow({
  label,
  fieldKey,
  value,
  onChange,
  hint,
  expectedType = 'string' as const,
  topAlign = false,
  children,
}: {
  label: string;
  fieldKey: string;
  value: FormulaValue;
  onChange: (v: FormulaValue) => void;
  hint?: string;
  expectedType?: 'string' | 'number' | 'boolean' | 'any';
  topAlign?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: topAlign ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 8, padding: topAlign ? '6px 12px' : '3px 12px' }}>
      <span style={{ fontSize: 11, color: '#d1d5db', flexShrink: 0, minWidth: 80, paddingTop: topAlign ? 4 : 0 }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: topAlign ? 'flex-start' : 'center', justifyContent: 'flex-end' }}>
        <FieldWithBinding label={fieldKey} value={value} onChange={onChange} hint={hint} expectedType={expectedType} topAlign={topAlign}>
          {children}
        </FieldWithBinding>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a CSS color value to hex for display in the FigmaColorPicker.
 *  Handles hex strings, `var(--name)`, and `var(--name, fallback)` syntax.
 *  Theme vars may be "R G B" triplets or plain hex strings on :root. */
function resolveCssVarToHex(color: string): string {
  if (!color || color === 'currentColor') return '#6b7280';
  if (color.startsWith('#')) return color;
  if (typeof document === 'undefined') return '#6b7280';
  // Match both var(--name) and var(--name, fallback)
  const match = color.match(/var\(--([\w-]+)/);
  if (match) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(`--${match[1]}`).trim();
    if (val) {
      if (val.startsWith('#')) return val;
      // "R G B" triplet → hex
      const parts = val.split(/\s+/).map(Number);
      if (parts.length === 3 && parts.every(n => !isNaN(n))) {
        return `#${parts.map(n => n.toString(16).padStart(2, '0')).join('')}`;
      }
      return val;
    }
    // CSS var not defined — extract fallback from var(--name, fallback)
    const fbMatch = color.match(/var\(--[\w-]+,\s*(.+)\)$/);
    if (fbMatch) return resolveCssVarToHex(fbMatch[1].trim());
  }
  return '#6b7280';
}

// ── Icon Settings ───────────────────────────────────────────────────────

function IconifySettings({ nodeId, nodeProps }: { nodeId: string; nodeProps: Record<string, unknown> }) {
  const store = useBuilderStore();
  const { patchPropResponsive, getPropOverrideBps } = useResponsivePropPatch(nodeId, nodeProps);
  const isBoundIcon = isBoundValue(nodeProps.icon as FormulaValue);
  const iconValue = (!isBoundIcon && typeof nodeProps.icon === 'string') ? nodeProps.icon : '';
  // 'currentColor' means inherit surrounding CSS color
  // Guard against formula objects — if color is bound, fall back to 'currentColor'
  const isBoundColor = isBoundValue(nodeProps.color as FormulaValue);
  const rawColor = (!isBoundColor && typeof nodeProps.color === 'string') ? nodeProps.color : 'currentColor';
  // Resolve to hex for FigmaColorPicker display (it only accepts hex)
  const resolvedHex = (rawColor === 'currentColor' || !rawColor) ? '#6b7280' : resolveCssVarToHex(rawColor);
  // For the Iconify preview thumbnail
  const previewColor = resolvedHex;

  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searching,     setSearching]     = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Patch a single prop key with any value — responsive-aware */
  const patchProp = (key: string, value: unknown) => patchPropResponsive(key, value);

  /** Patch multiple prop keys atomically — each key goes through responsive routing */
  const patchProps = (patch: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(patch)) patchPropResponsive(k, v);
  };

  void getPropOverrideBps; // available for future chip display

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`${ICONIFY_API_BASE}/search?query=${encodeURIComponent(q)}&limit=30`);
      if (res.ok) {
        const data = await res.json() as { icons?: string[] };
        setSearchResults(data.icons ?? []);
      }
    } catch { /* ignore */ } finally { setSearching(false); }
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { void doSearch(searchQuery); }, 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, doSearch]);

  const svgPreviewUrl = (!isBoundIcon && iconValue.includes(':'))
    ? `${ICONIFY_API_BASE}/${iconValue.split(':')[0]}/${iconValue.split(':')[1]}.svg?color=${encodeURIComponent(previewColor)}`
    : null;

  return (
    <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
      <div style={{ padding: '0 12px 6px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontWeight: 600 }}>Icon</div>

      {/* Preview + icon identifier (with binding support) */}
      <div style={{ padding: '0 12px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 4, background: '#1f2937', border: '1px solid #374151', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
          {svgPreviewUrl
            ? <img src={svgPreviewUrl} alt="icon" style={{ width: 20, height: 20 }} />
            : <span style={{ fontSize: 14, color: '#4b5563' }}>◈</span>}
        </div>
        <FieldWithBinding
          label="icon"
          value={(nodeProps.icon as FormulaValue) ?? ''}
          onChange={v => patchProp('icon', v)}
          hint="Iconify icon identifier e.g. heroicons:star, lucide:heart"
          expectedType="string"
        >
          <input
            data-testid="specific-icon-name"
            value={iconValue}
            onChange={e => patchProp('icon', e.target.value)}
            placeholder="heroicons:star"
            style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 7px', outline: 'none', width: '100%' }}
          />
        </FieldWithBinding>
      </div>

      {/* Icon color — controls SVG stroke/fill; uses full theme color picker */}
      <SpecificRow
        label="Color"
        fieldKey="color"
        value={(nodeProps.color as FormulaValue) ?? 'currentColor'}
        onChange={v => patchProp('color', v)}
        hint="CSS color or CSS variable e.g. var(--primary), #3b82f6"
        expectedType="string"
      >
        <FigmaColorPicker
          testId="specific-icon-color"
          value={resolvedHex}
          onChange={(hex, cssVar) => {
            // Store the CSS var reference when a theme swatch is picked so the icon
            // reacts to theme changes automatically; otherwise store the raw hex.
            patchProp('color', cssVar ? `var(--${cssVar})` : hex);
          }}
          onCommit={() => store._pushHistory?.()}
        />
      </SpecificRow>

      {/* Icon search picker */}
      <div style={{ padding: '0 12px 6px' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search icons…"
          style={{ width: '100%', boxSizing: 'border-box' as const, background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, padding: '4px 7px', outline: 'none' }}
        />
      </div>

      {(searchResults.length > 0 || searching) && (
        <div style={{ padding: '0 12px 8px' }}>
          {searching ? (
            <div style={{ fontSize: 10, color: '#4b5563', textAlign: 'center' as const, padding: '4px 0' }}>Searching…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
              {searchResults.map(name => {
                const parts = name.split(':');
                const url = `${ICONIFY_API_BASE}/${parts[0]}/${parts[1]}.svg?color=%23d1d5db`;
                return (
                  <button
                    key={name}
                    title={name}
                    onClick={() => {
                      // When picking an icon, also initialize color to primary
                      // if it was never set (currentColor = no explicit color chosen yet).
                      const needsColor = !nodeProps.color || nodeProps.color === 'currentColor';
                      patchProps({ icon: name, ...(needsColor ? { color: 'var(--primary)' } : {}) });
                    }}
                    style={{
                      background: name === iconValue ? '#1d4ed8' : '#1f2937',
                      border: `1px solid ${name === iconValue ? '#3b82f6' : '#374151'}`,
                      borderRadius: 4, padding: 4, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <img src={url} alt={parts[1]} style={{ width: 16, height: 16 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Image Settings ─────────────────────────────────────────────────────────────

function ImageSettings({ nodeId, nodeProps, nodeSrc }: { nodeId: string; nodeProps: Record<string, unknown>; nodeSrc: string }) {
  const store = useBuilderStore();
  const { patchPropResponsive } = useResponsivePropPatch(nodeId, nodeProps);
  const altValue  = (nodeProps.alt       as string | undefined) ?? '';
  // objectFit is a top-level prop on NextImage (read via rest.objectFit inside the img tag)
  const objectFit = (nodeProps.objectFit as string | undefined) ?? '';

  /** Patch one prop key — responsive-aware */
  const patchProp = (key: string, value: unknown) => patchPropResponsive(key, value);
  const patchSrc  = (value: string) =>
    store.patchNodeField(nodeId, 'src', value);

  const SELECT_STYLE: React.CSSProperties = {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
    color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none', width: '100%',
  };

  return (
    <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
      <div style={{ padding: '0 12px 6px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontWeight: 600 }}>Image</div>

      {/* Source URL — with binding support */}
      <SpecificRow
        label="Source URL"
        fieldKey="src"
        value={nodeSrc as FormulaValue}
        onChange={v => patchSrc(typeof v === 'string' ? v : '')}
        hint="Image URL e.g. https://example.com/photo.jpg"
        expectedType="string"
      >
        <SettingsTextInput value={nodeSrc} onChange={patchSrc} placeholder="https://..." testId="specific-image-src" />
      </SpecificRow>

      {/* Preview thumbnail */}
      {nodeSrc && typeof nodeSrc === 'string' && (
        <div style={{ padding: '0 12px 8px' }}>
          <img
            src={nodeSrc} alt="preview"
            style={{ width: '100%', maxHeight: 80, objectFit: 'cover', borderRadius: 4, border: '1px solid #1f2937' }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {/* Alt text — with binding support */}
      <SpecificRow
        label="Alt text"
        fieldKey="alt"
        value={(nodeProps.alt as FormulaValue) ?? ''}
        onChange={v => patchProp('alt', v)}
        hint="Accessible description of the image"
        expectedType="string"
      >
        <SettingsTextInput value={altValue} onChange={v => patchProp('alt', v)} placeholder="Description…" />
      </SpecificRow>

      {/* Object fit — with binding support */}
      <SpecificRow
        label="Object fit"
        fieldKey="objectFit"
        value={(nodeProps.objectFit as FormulaValue) ?? ''}
        onChange={v => patchProp('objectFit', v)}
        hint="CSS object-fit: cover | contain | fill | none | scale-down"
        expectedType="string"
      >
        <select
          value={objectFit}
          onChange={e => patchProp('objectFit', e.target.value || undefined)}
          style={SELECT_STYLE}
        >
          <option value="">Default (cover)</option>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="fill">Fill</option>
          <option value="none">None</option>
          <option value="scale-down">Scale down</option>
        </select>
      </SpecificRow>
    </div>
  );
}

// ── Video Settings ─────────────────────────────────────────────────────────────

function VideoSettings({ nodeId, nodeProps, nodeSrc }: { nodeId: string; nodeProps: Record<string, unknown>; nodeSrc: string }) {
  const store = useBuilderStore();
  const { patchPropResponsive } = useResponsivePropPatch(nodeId, nodeProps);
  const posterVal = (nodeProps.poster   as string  | undefined) ?? '';
  const autoPlay  = (nodeProps.autoPlay as boolean | undefined) ?? false;
  const loop      = (nodeProps.loop     as boolean | undefined) ?? false;
  const muted     = (nodeProps.muted    as boolean | undefined) ?? true;
  const controls  = (nodeProps.controls as boolean | undefined) ?? false;
  const objectFit = (nodeProps.objectFit as string | undefined) ?? '';

  const patchProp = (key: string, value: unknown) => patchPropResponsive(key, value);
  // Video nodes from assets-tab store src in props.src; write back to the same field.
  const patchSrc  = (value: string) => patchPropResponsive('src', value);

  const SELECT_STYLE: React.CSSProperties = {
    background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
    color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none', width: '100%',
  };

  const TOGGLES: { key: 'autoPlay' | 'loop' | 'muted' | 'controls'; label: string; value: boolean }[] = [
    { key: 'autoPlay', label: 'Auto Play', value: autoPlay },
    { key: 'loop',     label: 'Loop',      value: loop     },
    { key: 'muted',    label: 'Muted',     value: muted    },
    { key: 'controls', label: 'Controls',  value: controls },
  ];

  return (
    <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
      <div style={{ padding: '0 12px 6px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontWeight: 600 }}>Video</div>

      {/* Source URL — with binding support */}
      <SpecificRow
        label="Source URL"
        fieldKey="src"
        value={nodeSrc as FormulaValue}
        onChange={v => patchSrc(typeof v === 'string' ? v : '')}
        hint="Video URL e.g. https://example.com/video.mp4"
        expectedType="string"
      >
        <SettingsTextInput value={nodeSrc} onChange={patchSrc} placeholder="https://…mp4" testId="specific-video-src" />
      </SpecificRow>

      {/* Poster — with binding support */}
      <SpecificRow
        label="Poster"
        fieldKey="poster"
        value={(nodeProps.poster as FormulaValue) ?? ''}
        onChange={v => patchProp('poster', v)}
        hint="Thumbnail/poster image URL shown before the video plays"
        expectedType="string"
      >
        <SettingsTextInput value={posterVal} onChange={v => patchProp('poster', v)} placeholder="https://…jpg" />
      </SpecificRow>

      {posterVal && typeof posterVal === 'string' && (
        <div style={{ padding: '0 12px 8px' }}>
          <img src={posterVal} alt="poster" style={{ width: '100%', maxHeight: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid #1f2937' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      )}

      {/* Object fit — with binding support */}
      <SpecificRow
        label="Object fit"
        fieldKey="objectFit"
        value={(nodeProps.objectFit as FormulaValue) ?? ''}
        onChange={v => patchProp('objectFit', v)}
        hint="CSS object-fit: cover | contain | fill"
        expectedType="string"
      >
        <select
          value={objectFit}
          onChange={e => patchProp('objectFit', e.target.value || undefined)}
          style={SELECT_STYLE}
        >
          <option value="">Default (cover)</option>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="fill">Fill</option>
        </select>
      </SpecificRow>

      {/* Playback toggles — with binding support */}
      <div style={{ padding: '6px 12px 4px', borderTop: '1px solid #111827' }}>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Playback</div>
        {TOGGLES.map(({ key, label, value }) => (
          <SpecificRow
            key={key}
            label={label}
            fieldKey={key}
            value={(nodeProps[key] as FormulaValue) ?? value}
            onChange={v => patchProp(key, v)}
            hint={`Boolean — controls video ${key} behaviour`}
            expectedType="boolean"
          >
            <div data-testid={`specific-video-${key}`} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <OnOffToggle value={value} onChange={v => patchProp(key, v)} />
            </div>
          </SpecificRow>
        ))}
      </div>
    </div>
  );
}

function findSubmitButtonInTree(nodes: SDUINode[]): SDUINode | null {
  for (const n of nodes) {
    const actions = (n.actions ?? {}) as Record<string, unknown>;
    if ((actions.click as Record<string, unknown> | undefined)?.type === 'submitForm') return n;
    const child = n.children as SDUINode[] | undefined;
    if (child?.length) { const found = findSubmitButtonInTree(child); if (found) return found; }
  }
  return null;
}

export function SettingsTab({ node, pageNodes }: { node: SDUINode; pageNodes: SDUINode[] }) {
  const store = useBuilderStore();
  const nodeId = (node as { id?: string }).id ?? '';
  const nodeType = node.type as string;

  // ── Node name (shown for all types) ──────────────────────────────────────────
  const currentName = (node as { name?: string }).name ?? '';
  const [nameDraft, setNameDraft] = useState(currentName);
  useEffect(() => { setNameDraft(currentName); }, [currentName]);

  // Captured at focus time to avoid two stale-closure bugs:
  //
  // Bug A — wrong target: When the user clicks a different canvas element while editing,
  // React synchronously re-renders (useSyncExternalStore) with the new element's node prop
  // BEFORE blur fires. nodeId/nodeProps in the closure now refer to the NEW element.
  // Fix: capture nodeId at focus time, always commit to that node.
  //
  // Bug B — wrong value: The same React re-render also updates the controlled input
  // (value={fieldNameDraft}) with the NEW element's field name BEFORE blur fires.
  // So e.target.value in onBlur is the NEW element's name, not what the user typed.
  // Fix: track the typed value in the ref (updated on every onChange), use it at commit.
  const nameEditRef = useRef<{ nodeId: string; currentName: string; draftValue: string } | null>(null);
  const fieldEditRef = useRef<{
    nodeId: string;
    nodeProps: Record<string, unknown>;
    formContainerAncestor: SDUINode | null;
    fieldName: string;
    draftValue: string;
  } | null>(null);

  // Walk up tree to find FormContainer ancestor
  const formContainerAncestor = useMemo(() => {
    let current = findParentNode(pageNodes, nodeId);
    while (current) {
      if ((current.type as string) === 'FormContainer') return current;
      const parentId = (current as { id?: string }).id;
      if (!parentId) break;
      current = findParentNode(pageNodes, parentId);
    }
    return null;
  }, [pageNodes, nodeId]);

  const nodeActions = (node.actions ?? {}) as Record<string, unknown>;
  const nodeProps = (node.props ?? {}) as Record<string, unknown>;
  const nodeExtra = node as unknown as Record<string, unknown>;
  // Video nodes from the assets tab store src in props.src; Image nodes use node.src.
  // Read from both, preferring the top-level node.src.
  const nodeSrc = (nodeExtra.src as string | undefined) ?? (nodeProps.src as string | undefined) ?? '';
  // Normalize bare-array _validation (legacy format) to { trigger, rules } object
  // so all reads below (validation?.rules, validation?.trigger) work correctly.
  const _rawValidation = nodeExtra._validation;
  const validation: NodeValidation | undefined = Array.isArray(_rawValidation)
    ? { trigger: 'submit', rules: _rawValidation as ValidationRule[] }
    : (_rawValidation as NodeValidation | undefined);
  const debounce = nodeExtra._debounce as NodeDebounce | undefined;

  // Extract field name from node.props.name
  const fieldName = useMemo(() => {
    return (nodeProps.name as string | undefined) ?? '';
  }, [nodeProps]);

  const [fieldNameDraft, setFieldNameDraft] = useState(fieldName);
  useEffect(() => { setFieldNameDraft(fieldName); }, [fieldName]);

  // Index of the rule whose formula editor is open (-1 = none)
  const [formulaOpenRuleIdx, setFormulaOpenRuleIdx] = useState(-1);

  useEffect(() => {
    if (formulaOpenRuleIdx < 0) return;
    return registerEditorClose(() => setFormulaOpenRuleIdx(-1));
  }, [formulaOpenRuleIdx]);

  const openRuleFormula = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    if (formulaOpenRuleIdx === idx) { setFormulaOpenRuleIdx(-1); return; }
    closeAllEditors();
    setFormulaOpenRuleIdx(idx);
  };

  // ── helpers ──────────────────────────────────────────────────────────────────

  const commitName = () => {
    const ctx = nameEditRef.current;
    if (!ctx) return;
    nameEditRef.current = null;
    const trimmed = ctx.draftValue.trim() || undefined;
    if (trimmed === ctx.currentName) return;
    store.patchNodeField(ctx.nodeId, 'name', trimmed);
  };

  const syncValidationToAction = (nextValidation: NodeValidation) => {
    const rules = nextValidation.rules ?? [];
    const reqRule = rules.find(r => r.type === 'required');

    // Update the submit button's fieldValidations so submitForm knows about this field's rules
    if (formContainerAncestor && fieldName) {
      const submitBtn = findSubmitButtonInTree((formContainerAncestor.children ?? []) as SDUINode[]);
      if (submitBtn) {
        const sbId = (submitBtn as unknown as { id?: string }).id ?? '';
        if (!sbId) return;
        const sbActions = (submitBtn.actions ?? {}) as Record<string, unknown>;
        const clickAction = sbActions.click as Record<string, unknown> | undefined;
        if (clickAction?.type === 'submitForm') {
          const existingFV = (clickAction.fieldValidations ?? {}) as Record<string, unknown>;
          store.patchNodeField(sbId, 'actions', {
            ...sbActions,
            click: {
              ...clickAction,
              fieldValidations: {
                ...existingFV,
                [fieldName]: { required: !!reqRule, requiredMessage: reqRule?.message, validationRules: rules },
              },
            },
          });
        }
      }
    }
  };

  const patchValidation = (patch: Partial<NodeValidation>) => {
    // Normalize: if the stored _validation is a bare array (legacy format), convert it
    // to { trigger, rules } first so spreading patch doesn't turn array indices into
    // numeric object keys (which would lose the rules array).
    const base: NodeValidation = Array.isArray(validation)
      ? { trigger: 'submit', rules: validation as ValidationRule[] }
      : (validation ?? {});
    const next = { ...base, ...patch } as NodeValidation;
    store.patchNodeField(nodeId, '_validation', next);
    syncValidationToAction(next);
  };

  const validationRules = (validation?.rules ?? []) as ValidationRule[];
  const validationTrigger = (validation?.trigger ?? 'submit') as 'submit' | 'change';

  const addRule = () => {
    const type: ValidationRuleType = 'required';
    const newRule: ValidationRule = { type, ...RULE_DEFAULTS[type] } as ValidationRule;
    patchValidation({ rules: [...validationRules, newRule] });
  };
  const updateRule = (idx: number, patch: Partial<ValidationRule>) => {
    patchValidation({ rules: validationRules.map((r, i) => i === idx ? { ...r, ...patch } : r) });
  };
  const changeRuleType = (idx: number, newType: ValidationRuleType) => {
    patchValidation({ rules: validationRules.map((r, i) => i === idx ? { type: newType, message: r.message || (RULE_DEFAULTS[newType].message ?? ''), ...( RULE_DEFAULTS[newType].value !== undefined ? { value: RULE_DEFAULTS[newType].value } : {} ) } as ValidationRule : r) });
  };
  const removeRule = (idx: number) => {
    if (formulaOpenRuleIdx === idx) setFormulaOpenRuleIdx(-1);
    patchValidation({ rules: validationRules.filter((_, i) => i !== idx) });
  };

  const patchDebounce = (patch: Partial<NodeDebounce>) => {
    const next = { ...(debounce ?? {}), ...patch };
    store.patchNodeField(nodeId, '_debounce', next);
  };

  const { patchPropResponsive: patchPropResp } = useResponsivePropPatch(nodeId, nodeProps);
  const patchProp = (key: string, value: unknown) => patchPropResp(key, value);

  const patchInitialValue = (value: unknown) => {
    store.patchNodeField(nodeId, '_initialValue', value);
    // Immediately reflect in the global variable store so the live preview updates.
    if (typeof value === 'string') {
      getGlobalVariableStore().getState().set(`${nodeId}-value`, value);
    }
    // Sync to FormContainer's initialFormData so the field is pre-populated on mount
    if (formContainerAncestor && fieldName) {
      const fcId = (formContainerAncestor as { id?: string }).id ?? '';
      if (fcId) {
        const fcProps = (formContainerAncestor.props ?? {}) as Record<string, unknown>;
        const current = (fcProps.initialFormData ?? {}) as Record<string, unknown>;
        store.patchNodeField(fcId, 'props', { ...fcProps, initialFormData: { ...current, [fieldName]: value } });
      }
    }
  };

  const commitFieldName = () => {
    // Use ref captured at focus time — the closure might have stale nodeId/nodeProps
    // if the user clicked a different canvas element while this input had focus.
    // draftValue is updated on every onChange, so it always holds what the user typed —
    // NOT e.target.value which React may have overwritten with the new element's name.
    const ctx = fieldEditRef.current;
    if (!ctx) return;
    fieldEditRef.current = null;
    const { nodeId: targetId, nodeProps: targetProps, formContainerAncestor: fc, fieldName: oldName, draftValue } = ctx;

    const trimmed = draftValue.trim();
    if (!trimmed) return;

    // 1. Write the field name to node.props.name (source of truth)
    store.patchNodeField(targetId, 'props', { ...targetProps, name: trimmed });

    // 2. Update node.name (display name) to match the field name
    store.patchNodeField(targetId, 'name', trimmed);

    // 3. Rename the key in FormContainer's initialFormData so the formula path stays in sync
    if (oldName && oldName !== trimmed && fc) {
      const fcId = (fc as { id?: string }).id ?? '';
      const fcProps = (fc.props ?? {}) as Record<string, unknown>;
      const oldData = (fcProps.initialFormData ?? {}) as Record<string, unknown>;
      if (oldName in oldData) {
        const { [oldName]: oldVal, ...rest } = oldData;
        store.patchNodeField(fcId, 'props', { ...fcProps, initialFormData: { ...rest, [trimmed]: oldVal } });
      }

      // 4. Immediately rename the key in the live runtime variable store so the formula
      //    tree and data source panel update without requiring the user to type in the field.
      if (fcId) {
        const runtimeKey = `${fcId}-form`;
        getGlobalVariableStore().getState().setState(vs => {
          const formEntry = (vs[runtimeKey] ?? {}) as Record<string, unknown>;
          const fd    = (formEntry['formData'] ?? {}) as Record<string, unknown>;
          const flds  = (formEntry['fields']   ?? {}) as Record<string, unknown>;
          const { [oldName]: oldFdVal,  ...restFd   } = fd;
          const { [oldName]: oldFldVal, ...restFlds  } = flds;

          const storedLocal = (vs['local'] ?? {}) as Record<string, unknown>;
          const storedData  = (storedLocal['data'] ?? {}) as Record<string, unknown>;
          const storedForm  = (storedData['form']  ?? {}) as Record<string, unknown>;
          const localFd   = (storedForm['formData'] ?? {}) as Record<string, unknown>;
          const localFlds = (storedForm['fields']   ?? {}) as Record<string, unknown>;
          const { [oldName]: oldLocalFdVal,  ...restLocalFd   } = localFd;
          const { [oldName]: oldLocalFldVal, ...restLocalFlds  } = localFlds;

          return {
            ...vs,
            [runtimeKey]: {
              ...formEntry,
              formData: { ...restFd,   [trimmed]: oldFdVal  ?? '' },
              fields:   { ...restFlds, [trimmed]: oldFldVal ?? { value: '', isValid: '' } },
            },
            local: {
              ...storedLocal,
              data: {
                ...storedData,
                form: {
                  ...storedForm,
                  formData: { ...restLocalFd,   [trimmed]: oldLocalFdVal  ?? '' },
                  fields:   { ...restLocalFlds, [trimmed]: oldLocalFldVal ?? { value: '', isValid: '' } },
                },
              },
            },
          };
        });
      }
    }
  };

  const isReadOnly = !!(nodeProps.readOnly ?? nodeProps.isReadOnly);
  const autocomplete = nodeProps.autoComplete as string | undefined;
  const placeholder = (nodeProps.placeholder as string | undefined) ?? '';
  const formatMask   = (nodeProps.format     as string | undefined) ?? '';
  const _initValueRaw = (node as unknown as Record<string, unknown>)._initialValue;
  const _initIsFormula = _initValueRaw != null && typeof _initValueRaw === 'object' && 'formula' in (_initValueRaw as object);
  const initValue = (_initIsFormula ? _initValueRaw : (_initValueRaw as string | undefined) ?? '') as string | { formula: string };
  const debounceEnabled = debounce?.enabled ?? false;
  const debounceDelay = debounce?.delay ?? 500;

  // Input type — map raw prop to option value
  const rawInputType = (nodeProps.type as string | undefined) ?? 'text';
  const currentInputType = rawInputType === 'number' && nodeProps.step === '0.01' ? 'decimal' : rawInputType;

  const selectInputType = (val: string) => {
    if (val === 'decimal' || val === 'currency') {
      store.patchNodeField(nodeId, 'props', { ...nodeProps, type: 'number', step: '0.01' });
    } else {
      const { step: _s, ...rest } = nodeProps as Record<string, unknown>;
      void _s;
      store.patchNodeField(nodeId, 'props', { ...rest, type: val });
    }
  };

  // Keep nodeShared for the Component Properties section below
  const nodeShared = (node as unknown as Record<string, unknown>)._shared as { id: string; name: string } | undefined;

  // True when an SC instance with valueVariable has controlled turned on (_controlled present).
  // Used to show the Form Container section (field name + validation) for SC form inputs
  // like sc-checkbox, sc-switch, sc-datepicker when dropped inside a FormContainer.
  const isScControlled = (node as unknown as { _controlled?: unknown })._controlled != null;

  // Determine if there is anything specific to show for this node type
  const hasSpecific = nodeType === 'Icon' || nodeType === 'Image' || nodeType === 'Video'
    || nodeType === 'FormContainer'
    || SETTINGS_INPUT_TYPES.has(nodeType)
    || isScControlled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: hasSpecific ? '1px solid #374151' : undefined }}>

      {/* ── Name (all types; hidden when inside FormContainer — field name serves as name) ── */}
      {!formContainerAncestor && (
        <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Name</div>
          <input
            data-testid="settings-name-input"
            value={nameDraft}
            onFocus={() => { nameEditRef.current = { nodeId, currentName, draftValue: nameDraft }; }}
            onChange={e => { setNameDraft(e.target.value); if (nameEditRef.current) nameEditRef.current.draftValue = e.target.value; }}
            onBlur={() => commitName()}
            onKeyDown={e => { if (e.key === 'Enter') { commitName(); (e.target as HTMLInputElement).blur(); } }}
            placeholder={`e.g. ${nodeType}`}
            style={{ width: '100%', boxSizing: 'border-box' as const, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 7px', outline: 'none' }}
          />
        </div>
      )}

      {/* ── Controlled toggle (all node types) ── */}
      <ControlledToggleRow node={node} />

      {/* ── Component Properties — shown when inside a _shared tree ── */}
      {(() => {
        const linkedRoot = findLinkedRoot(store.pageNodes as SDUINode[], nodeId, 'shared');
        if (!linkedRoot) return null;
        const rootRec = linkedRoot as unknown as Record<string, unknown>;
        const sharedMeta = rootRec._shared as { id: string; name: string } | undefined;
        const meta = sharedMeta;
        if (!meta) return null;
        const scModel = getSharedComponents()[meta.id];
        if (!scModel || !scModel.properties?.length) return null;
        const rootProps = (linkedRoot.props ?? {}) as Record<string, unknown>;
        return (
          <div style={{ borderBottom: '1px solid #1f2937', overflow: 'hidden' }}>
            <div style={{ padding: '6px 12px 2px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                fontSize: 9,
                color: '#60a5fa',
                background: '#1e3a5f',
                borderRadius: 3, padding: '1px 4px', fontWeight: 700,
              }}>SC</span>
              Component Properties
            </div>
            {(scModel.properties as SharedComponentProperty[]).map(prop => {
              const rawVal = rootProps[prop.name] ?? prop.defaultValue;
              const patchProp = (v: unknown) => { if (linkedRoot?.id) store.patchProp(linkedRoot.id, `props.${prop.name}`, v); };
              const isAny = prop.type === 'any' || prop.type === 'list';
              const strVal = isAny ? (typeof rawVal === 'string' ? rawVal : (rawVal !== undefined ? JSON.stringify(rawVal, null, 2) : '')) : '';

              const inputStyle: React.CSSProperties = { width: 130, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', boxSizing: 'border-box' as const };

              let editor: React.ReactNode;

              if (isAny) {
                editor = <AnyPropEditor value={strVal} onChange={v => patchProp(v)} />;
              } else if (prop.type === 'boolean') {
                editor = (
                  <div style={{ display: 'flex', border: '1px solid #374151', borderRadius: 6, overflow: 'hidden', width: 130, boxSizing: 'border-box' as const }}>
                    {[{ label: 'On', val: true }, { label: 'Off', val: false }].map(({ label, val }) => {
                      const active = (!!rawVal) === val;
                      return (
                        <button key={label}
                          style={{ flex: 1, padding: '5px 0', background: active ? '#1f2937' : 'transparent', border: 'none', fontSize: 12, color: active ? '#f3f4f6' : '#6b7280', cursor: 'pointer', fontWeight: active ? 600 : 400 }}
                          onClick={() => patchProp(val)}
                        >{label}</button>
                      );
                    })}
                  </div>
                );
              } else if (prop.type === 'color') {
                editor = (
                  <div style={{ width: 130, boxSizing: 'border-box' as const }}>
                    <FigmaColorPicker value={String(rawVal ?? '#000000')} onChange={c => patchProp(c)} />
                  </div>
                );
              } else if (prop.type === 'number') {
                editor = (
                  <input type="number" value={rawVal !== undefined ? Number(rawVal) : ''}
                    onChange={e => patchProp(e.target.value === '' ? undefined : Number(e.target.value))}
                    placeholder={String(prop.defaultValue ?? '')}
                    style={inputStyle}
                  />
                );
              } else if (prop.type === 'select') {
                editor = (
                  <select
                    value={String(rawVal ?? '')}
                    onChange={e => patchProp(e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    {(prop.options ?? []).map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                    {!(prop.options ?? []).length && (
                      <option value={String(rawVal ?? '')}>{String(rawVal ?? '(no options)')}</option>
                    )}
                  </select>
                );
              } else if (prop.type === 'icon') {
                const iconStr = String(rawVal ?? '');
                const parts = iconStr.split(':');
                const svgUrl = parts.length === 2
                  ? `https://api.iconify.design/${parts[0]}/${parts[1]}.svg?color=%23d1d5db`
                  : null;
                editor = (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 130, boxSizing: 'border-box' as const }}>
                    {svgUrl && (
                      <div style={{ width: 20, height: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={svgUrl} alt="" style={{ width: 16, height: 16 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </div>
                    )}
                    <input
                      value={iconStr}
                      onChange={e => patchProp(e.target.value)}
                      placeholder="lucide:check"
                      style={{ ...inputStyle, width: undefined, flex: 1 }}
                    />
                  </div>
                );
              } else if (prop.type === 'size') {
                const sizeStr = String(rawVal ?? '');
                const match = sizeStr.match(/^([\d.]+)(.*)$/);
                const num = match ? match[1] : '';
                const unit = match ? match[2] : 'px';
                editor = (
                  <div style={{ display: 'flex', gap: 3, width: 130, boxSizing: 'border-box' as const }}>
                    <input
                      type="number"
                      value={num}
                      onChange={e => patchProp(`${e.target.value}${unit || 'px'}`)}
                      placeholder="0"
                      style={{ ...inputStyle, width: undefined, flex: 1 }}
                    />
                    <select
                      value={unit || 'px'}
                      onChange={e => patchProp(`${num}${e.target.value}`)}
                      style={{ ...inputStyle, width: 48, padding: '3px 3px' }}
                    >
                      {['px', '%', 'vh', 'vw'].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                );
              } else {
                editor = (
                  <input
                    value={String(rawVal ?? '')}
                    onChange={e => patchProp(e.target.value)}
                    placeholder={String(prop.defaultValue ?? '')}
                    style={inputStyle}
                  />
                );
              }

              return (
                <SpecificRow
                  key={prop.id}
                  label={prop.name}
                  fieldKey={`_sc_${prop.name}`}
                  value={(rawVal as FormulaValue)}
                  onChange={v => patchProp(v)}
                  expectedType={isAny ? 'any' : prop.type === 'number' ? 'number' : prop.type === 'boolean' ? 'boolean' : 'string'}
                >
                  {editor}
                </SpecificRow>
              );
            })}
          </div>
        );
      })()}

      {/* ── "Specific" section header — only shown when there IS component-specific content ── */}
      {hasSpecific && (
        <div style={{ padding: '8px 12px 2px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.06em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Specific
        </div>
      )}

      {/* ── FormContainer: registered fields inspector ───────────────────────── */}
      {nodeType === 'FormContainer' && <FormContainerFieldsPanel nodeId={nodeId} />}

      {/* ── Icon settings ─────────────────────────────────────────────── */}
      {nodeType === 'Icon' && (
        <IconifySettings nodeId={nodeId} nodeProps={nodeProps} />
      )}

      {/* ── Image settings ───────────────────────────────────────────────────── */}
      {(nodeType === 'Image' || nodeType === 'Image') && (
        <ImageSettings nodeId={nodeId} nodeProps={nodeProps} nodeSrc={nodeSrc} />
      )}

      {/* ── Video settings ───────────────────────────────────────────────────── */}
      {nodeType === 'Video' && (
        <VideoSettings nodeId={nodeId} nodeProps={nodeProps} nodeSrc={nodeSrc} />
      )}


      {/* ── Form Container Section (input types only) ────────────────────────── */}
      {(SETTINGS_INPUT_TYPES.has(nodeType) || isScControlled) && formContainerAncestor && (
        <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
          <div style={{ padding: '0 12px 4px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 12 11 14 15 10"/><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
            </svg>
            <span style={{ fontSize: 10, color: '#10b981', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Form container</span>
          </div>

          {/* Field name */}
          <SettingsRow label="Field name">
            <FieldWithBinding
              label="Field name"
              value={(nodeProps.name as FormulaValue) ?? fieldNameDraft}
              onChange={v => {
                if (isBoundValue(v)) {
                  patchProp('name', v);
                } else {
                  setFieldNameDraft(v as string);
                  patchProp('name', v as string);
                }
              }}
              expectedType="string"
            >
              <input
                data-testid="settings-field-name-input"
                value={fieldNameDraft}
                onFocus={() => { fieldEditRef.current = { nodeId, nodeProps, formContainerAncestor, fieldName, draftValue: fieldNameDraft }; }}
                onChange={e => { setFieldNameDraft(e.target.value); if (fieldEditRef.current) fieldEditRef.current.draftValue = e.target.value; }}
                onBlur={() => commitFieldName()}
                onKeyDown={e => { if (e.key === 'Enter') { commitFieldName(); (e.target as HTMLInputElement).blur(); } }}
                placeholder="e.g. email"
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: 110, boxSizing: 'border-box' as const }}
              />
            </FieldWithBinding>
          </SettingsRow>

          {/* Validation trigger */}
          <SettingsRow label="Validate">
            <select
              data-testid="settings-validation-trigger"
              value={validationTrigger}
              onChange={e => patchValidation({ trigger: e.target.value as 'submit' | 'change' })}
              style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none', flex: 1, maxWidth: 160 }}
            >
              <option value="submit">On form submit</option>
              <option value="change">On input change</option>
            </select>
          </SettingsRow>

          {/* ── Validation rules list ──────────────────────────────────────────── */}
          <div style={{ padding: '4px 12px 2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rules</span>
              <button
                onClick={addRule}
                style={{ fontSize: 10, color: '#a78bfa', background: 'none', border: '1px solid #4c1d95', borderRadius: 3, padding: '1px 7px', cursor: 'pointer' }}
              >
                + Add rule
              </button>
            </div>

            {validationRules.length === 0 && (
              <div style={{ fontSize: 10, color: '#4b5563', padding: '4px 0 6px', fontStyle: 'italic' }}>No rules — click + Add rule</div>
            )}

            {validationRules.map((rule, idx) => {
              const opt = RULE_TYPE_OPTIONS.find(o => o.value === rule.type);
              const isFormulaOpen = formulaOpenRuleIdx === idx;
              return (
                <div key={idx} style={{ marginBottom: 6, background: '#0f1929', borderRadius: 4, border: '1px solid #1f2937', padding: '5px 6px' }}>
                  {/* Row 1: type + message + remove */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <select
                      value={rule.type}
                      onChange={e => changeRuleType(idx, e.target.value as ValidationRuleType)}
                      style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 3, color: '#f3f4f6', fontSize: 10, padding: '2px 4px', outline: 'none', flexShrink: 0, width: 100 }}
                    >
                      {RULE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {rule.type !== 'formula' && !opt?.hasValue && (
                      <RuleMessageInput
                        value={rule.message}
                        onChange={v => updateRule(idx, { message: v })}
                        style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 3, color: '#d1d5db', fontSize: 10, padding: '2px 5px', outline: 'none', flex: 1, minWidth: 0 }}
                      />
                    )}
                    <button
                      onClick={() => removeRule(idx)}
                      style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                      title="Remove rule"
                    >×</button>
                  </div>

                  {/* Row 2: value input (minLength / maxLength / pattern) */}
                  {opt?.hasValue && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <span style={{ fontSize: 9, color: '#6b7280', flexShrink: 0 }}>Value</span>
                      <RuleValueInput
                        value={rule.value ?? ''}
                        onChange={v => updateRule(idx, { value: v })}
                        placeholder={opt.valuePlaceholder ?? ''}
                        style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 3, color: '#d1d5db', fontSize: 10, padding: '2px 5px', outline: 'none', width: 70 }}
                      />
                      <RuleMessageInput
                        value={rule.message}
                        onChange={v => updateRule(idx, { message: v })}
                        style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 3, color: '#d1d5db', fontSize: 10, padding: '2px 5px', outline: 'none', flex: 1, minWidth: 0 }}
                      />
                    </div>
                  )}

                  {/* Row 2: formula editor (formula type) */}
                  {rule.type === 'formula' && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                          <button
                            onClick={e => openRuleFormula(e, idx)}
                            style={{ padding: '2px 8px', background: isFormulaOpen ? '#3b0764' : '#2e1065', border: '1px solid #7c3aed', borderRadius: 4, color: '#a78bfa', fontSize: 10, cursor: 'pointer', fontWeight: 500, width: '100%', textAlign: 'left' }}
                          >
                            ƒ {(rule.formula || rule.value) ? 'Edit formula' : 'Add formula'}
                          </button>
                          {isFormulaOpen && (
                            <FormulaEditor
                              label="Validation formula"
                              value={rule.formula ?? (rule.value ? { formula: rule.value } : null)}
                              expectedType="any"
                              hint='true = valid · false = invalid · "Error message" = invalid with message'
                              anchor="right"
                              hideUnbind
                              onChange={v => { updateRule(idx, { formula: v }); setFormulaOpenRuleIdx(-1); }}
                              onClose={() => setFormulaOpenRuleIdx(-1)}
                            />
                          )}
                        </div>
                      </div>
                      <RuleMessageInput
                        value={rule.message}
                        onChange={v => updateRule(idx, { message: v })}
                        placeholder="Error message (fallback)"
                        style={{ marginTop: 4, background: '#111827', border: '1px solid #1f2937', borderRadius: 3, color: '#d1d5db', fontSize: 10, padding: '2px 5px', outline: 'none', width: '100%', boxSizing: 'border-box' as const }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Specific section (input types only) ──────────────────────────────── */}
      {SETTINGS_INPUT_TYPES.has(nodeType) && (
        <div style={{ padding: '8px 0 4px' }}>
          <div style={{ padding: '0 12px 6px', fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>Specific</div>

          {nodeType === 'Input' && (
            <SettingsRow label="Input type">
              <select
                data-testid="settings-input-type-select"
                value={currentInputType}
                onChange={e => selectInputType(e.target.value)}
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 6px', outline: 'none', flex: 1, maxWidth: 150 }}
              >
                {INPUT_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </SettingsRow>
          )}

          {/* Init value */}
          <SettingsRow label="Init value">
            <FieldWithBinding
              label="Init value"
              value={initValue as import('./_formula-panel').FormulaValue}
              onChange={v => patchInitialValue(v)}
              expectedType="string"
            >
              <input
                value={_initIsFormula ? '' : (initValue as string)}
                onChange={e => patchInitialValue(e.target.value)}
                placeholder=""
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: 130, boxSizing: 'border-box' as const }}
              />
            </FieldWithBinding>
          </SettingsRow>

          {/* Placeholder */}
          <SettingsRow label="Placeholder">
            <FieldWithBinding
              label="Placeholder"
              value={placeholder as import('./_formula-panel').FormulaValue}
              onChange={v => patchProp('placeholder', v)}
              expectedType="string"
            >
              <input
                value={placeholder}
                onChange={e => patchProp('placeholder', e.target.value)}
                placeholder="Placeholder"
                style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: 130, boxSizing: 'border-box' as const }}
              />
            </FieldWithBinding>
          </SettingsRow>

          {/* Format mask — Input only (Textarea has no masking implementation) */}
          {nodeType === 'Input' && (
            <SettingsRow label="Format">
              <FieldWithBinding
                label="Format"
                value={formatMask as import('./_formula-panel').FormulaValue}
                onChange={v => patchProp('format', v || undefined)}
                expectedType="string"
              >
                <input
                  value={formatMask}
                  onChange={e => patchProp('format', e.target.value || undefined)}
                  placeholder="e.g. ####-##-##"
                  style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 7px', outline: 'none', width: 130, boxSizing: 'border-box' as const }}
                />
              </FieldWithBinding>
            </SettingsRow>
          )}
          {nodeType === 'Input' && formatMask && (
            <div style={{ fontSize: 10, color: '#6b7280', padding: '0 8px 4px', lineHeight: '1.4' }}>
              # digit · A letter · * any char · other = literal
            </div>
          )}

          {/* Read only */}
          <SettingsRow label="Read only">
            <OnOffToggle value={isReadOnly} onChange={v => patchProp('readOnly', v || undefined)} />
          </SettingsRow>

          {/* Autocomplete */}
          <SettingsRow label="Autocomplete">
            <FieldWithBinding
              label="Autocomplete"
              value={(typeof nodeProps.autoComplete === 'object' && nodeProps.autoComplete !== null && 'formula' in (nodeProps.autoComplete as object) ? nodeProps.autoComplete : autocomplete ?? '') as import('./_formula-panel').FormulaValue}
              onChange={v => patchProp('autoComplete', v || undefined)}
              expectedType="string"
            >
              <OnOffToggle value={autocomplete !== 'new-password' && autocomplete !== 'off'} onChange={v => patchProp('autoComplete', v ? 'on' : 'new-password')} />
            </FieldWithBinding>
          </SettingsRow>

          {/* Debounce */}
          <SettingsRow label="Debounce">
            <OnOffToggle value={debounceEnabled} onChange={v => patchDebounce({ enabled: v })} />
          </SettingsRow>

          {/* Delay (only when debounce is on) */}
          {debounceEnabled && (
            <SettingsRow label="Delay">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  value={debounceDelay}
                  min={0}
                  max={5000}
                  step={50}
                  onChange={e => patchDebounce({ delay: Math.max(0, Number(e.target.value)) })}
                  style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '3px 5px', outline: 'none', width: 52, textAlign: 'center' as const }}
                />
                <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>ms</span>
                <input
                  type="range"
                  min={0}
                  max={2000}
                  step={50}
                  value={debounceDelay}
                  onChange={e => patchDebounce({ delay: Number(e.target.value) })}
                  style={{ flex: 1, accentColor: '#3b82f6', width: 60 }}
                />
              </div>
            </SettingsRow>
          )}
        </div>
      )}

      {/* ── Popover section (all node types) ──────────────────────────── */}
      <PopoverSection nodeId={nodeId} node={node} />
    </div>
  );
}

// ─── OpenVariable Picker (searchable, workflow-style) ─────────────────────────

const OV_TYPE_COLOR: Record<string, string> = { string: '#fbbf24', number: '#60a5fa', boolean: '#34d399', object: '#a78bfa', array: '#fb923c' };

function OpenVariablePicker({ value, customVars, onChange }: {
  value: string | undefined;
  customVars: Array<{ id?: string; name: string; label?: string; type: string }>;
  onChange: (varId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const boolVars = useMemo(() => customVars.filter(v => v.type === 'boolean'), [customVars]);
  const filtered = useMemo(() => {
    if (!search) return boolVars;
    const q = search.toLowerCase();
    return boolVars.filter(v => (v.label || v.name).toLowerCase().includes(q));
  }, [boolVars, search]);

  const selected = value ? boolVars.find(v => (v.id ?? v.name) === value) : null;
  const isUnknown = !!value && !selected;

  return (
    <div style={{ fontSize: 10, color: '#6b7280', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Control variable</span>
        {value && (
          <button
            onClick={() => onChange(undefined)}
            style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 9, cursor: 'pointer', textDecoration: 'underline' }}
          >
            unbind
          </button>
        )}
      </div>
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => { setOpen(v => !v); setSearch(''); }}
          style={{
            width: '100%', textAlign: 'left', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
            background: '#1f2937', border: '1px solid #374151', borderRadius: 4,
            color: '#f3f4f6', fontSize: 10, padding: '3px 6px',
          }}
        >
          {selected ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 8, color: OV_TYPE_COLOR.boolean, fontFamily: 'monospace',
                background: 'rgba(255,255,255,0.07)', border: `1px solid ${OV_TYPE_COLOR.boolean}`,
                borderRadius: 3, padding: '0 3px', flexShrink: 0 }}>bool</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selected.label || selected.name}
              </span>
            </span>
          ) : isUnknown ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 8, color: '#f87171', fontFamily: 'monospace',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 3, padding: '0 3px', flexShrink: 0 }}>!</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#f87171' }}>
                Unknown variable
              </span>
            </span>
          ) : (
            <span style={{ color: '#4b5563' }}>(none)</span>
          )}
          <span style={{ color: '#6b7280', fontSize: 9, flexShrink: 0 }}>{open ? '▴' : '▾'}</span>
        </button>

        {open && (
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              background: '#111827', border: '1px solid #374151', borderRadius: 6,
              marginTop: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              maxHeight: 200, display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ padding: '5px 6px', borderBottom: '1px solid #1f2937' }}>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search boolean variables…"
                style={{
                  width: '100%', boxSizing: 'border-box', background: '#1f2937',
                  border: '1px solid #374151', borderRadius: 4, color: '#d1d5db',
                  fontSize: 10, padding: '3px 6px', outline: 'none',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {/* None option */}
              <button
                onClick={() => { onChange(undefined); setOpen(false); setSearch(''); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                  background: !value ? '#1e3a5f' : 'none', border: 'none', cursor: 'pointer',
                  color: !value ? '#93c5fd' : '#9ca3af', fontSize: 10, textAlign: 'left',
                }}
              >
                (none)
              </button>
              {filtered.length === 0 && (
                <div style={{ padding: '8px 10px', fontSize: 10, color: '#6b7280' }}>No boolean variables found</div>
              )}
              {filtered.map(v => {
                const key = v.id ?? v.name;
                const isActive = key === value;
                return (
                  <button
                    key={key}
                    onClick={() => { onChange(key); setOpen(false); setSearch(''); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                      background: isActive ? '#1e3a5f' : 'none', border: 'none', cursor: 'pointer',
                      color: isActive ? '#93c5fd' : '#d1d5db', fontSize: 10, textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 8, color: OV_TYPE_COLOR.boolean, fontFamily: 'monospace',
                      background: 'rgba(255,255,255,0.07)', border: `1px solid ${OV_TYPE_COLOR.boolean}`,
                      borderRadius: 3, padding: '0 3px', flexShrink: 0 }}>bool</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.label || v.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Popover Section ──────────────────────────────────────────────────────────

const PLACEMENT_GRID: Array<{ placement: string; row: number; col: number }> = [
  { placement: 'top-start',    row: 0, col: 0 },
  { placement: 'top',          row: 0, col: 1 },
  { placement: 'top-end',      row: 0, col: 2 },
  { placement: 'left',         row: 1, col: 0 },
  { placement: '',             row: 1, col: 1 },
  { placement: 'right',        row: 1, col: 2 },
  { placement: 'bottom-start', row: 2, col: 0 },
  { placement: 'bottom',       row: 2, col: 1 },
  { placement: 'bottom-end',   row: 2, col: 2 },
];

function PopoverSection({ nodeId, node }: { nodeId: string; node: SDUINode }) {
  const store = useBuilderStore();
  const [expanded, setExpanded] = useState(false);
  const config = node.popover as PopoverConfig | undefined;
  const hasConfig = !!config;
  const pcChildren = ((node.children ?? []) as SDUINode[]).filter(c => c._popoverContent);
  const contentCount = pcChildren.reduce((n, pc) => n + ((pc.children as SDUINode[] | undefined)?.length ?? 0), 0);
  const shownKey = `popover:${nodeId}`;
  const isShown = store.shownPopovers.has(shownKey);

  const handleAdd = useCallback(() => {
    const pcWrapper: SDUINode = {
      type: 'Box' as SDUINode['type'],
      id: crypto.randomUUID(),
      _popoverContent: true,
      props: { className: 'bg-white rounded-lg shadow-lg border border-gray-200 p-2' },
      children: [{
        type: 'Text' as SDUINode['type'],
        id: crypto.randomUUID(),
        text: 'Popover content',
      }],
    };
    store.setPopoverConfig(nodeId, {
      trigger: 'click',
      placement: 'bottom-start',
      offset: 4,
      closeOnOutsideClick: true,
      closeOnEscape: true,
    });
    store.addNode(pcWrapper, nodeId);
    setExpanded(true);
    if (!isShown) store.togglePopoverShown(nodeId);
  }, [store, nodeId, isShown]);

  const handleRemove = useCallback(() => {
    if (!window.confirm('Remove Popover?')) return;
    store.setPopoverConfig(nodeId, null);
    const pcIds = pcChildren.map(c => c.id).filter(Boolean) as string[];
    if (pcIds.length) store.deleteNodes(pcIds);
    if (isShown) store.togglePopoverShown(nodeId);
  }, [store, nodeId, isShown, pcChildren]);

  const patchConfig = useCallback((key: string, value: unknown) => {
    store.setPopoverConfig(nodeId, { ...(config ?? {}), [key]: value });
  }, [store, nodeId, config]);

  // Merge page-scoped custom variables with component-scoped variables from the
  // enclosing _shared root (if any) so the Control Variable picker can
  // resolve UUIDs defined inside a shared component.
  const mergedCustomVars = useMemo(() => {
    const linkedRoot = findLinkedRoot(store.pageNodes as SDUINode[], nodeId, 'shared');
    if (!linkedRoot) return store.customVars;
    const rootRec = linkedRoot as unknown as Record<string, unknown>;
    const sharedMeta = rootRec._shared as { id: string; name: string } | undefined;
    const meta = sharedMeta;
    if (!meta) return store.customVars;
    const scModel = getSharedComponents()[meta.id];
    const vars = scModel?.variables as Record<string, { label?: string; type?: string }> | undefined;
    if (!vars) return store.customVars;
    const componentVars = Object.entries(vars).map(([id, v]) => ({
      id,
      name: v?.label || id,
      label: v?.label || id,
      type: String(v?.type ?? 'any'),
    }));
    return [...componentVars, ...store.customVars];
  }, [store.pageNodes, store.customVars, nodeId]);

  return (
    <div style={{ borderBottom: '1px solid #1f2937' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: hasConfig ? '#60a5fa' : '#9ca3af', fontWeight: hasConfig ? 600 : 400 }}>Popover</span>
          {hasConfig && <span style={{ fontSize: 9, color: '#3b82f6', background: '#1e3a5f', borderRadius: 3, padding: '1px 5px' }}>{contentCount} node{contentCount !== 1 ? 's' : ''}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {hasConfig && (
            <button
              title={isShown ? 'Hide on canvas' : 'Show on canvas'}
              onClick={e => { e.stopPropagation(); store.togglePopoverShown(nodeId); }}
              style={{
                background: isShown ? '#1e3a5f' : 'transparent',
                border: `1px solid ${isShown ? '#3b82f6' : '#374151'}`,
                borderRadius: 4, padding: '2px 6px', cursor: 'pointer', color: isShown ? '#60a5fa' : '#6b7280', fontSize: 10,
              }}
            >
              {isShown ? 'Showing' : 'Show'}
            </button>
          )}
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!hasConfig ? (
            <button
              onClick={handleAdd}
              style={{ width: '100%', padding: '6px 0', background: '#1e293b', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 11, cursor: 'pointer' }}
            >
              + Add Popover
            </button>
          ) : (
            <>
              {/* Trigger */}
              <SettingsRow label="Trigger">
                <select
                  value={(config?.trigger as string) || 'click'}
                  onChange={e => patchConfig('trigger', e.target.value)}
                  style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 10, padding: '2px 4px' }}
                >
                  <option value="click">Click</option>
                  <option value="hover">Hover</option>
                </select>
              </SettingsRow>

              {/* Placement — 3x3 dot matrix */}
              <div>
                <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 3 }}>Placement</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, width: 72 }}>
                  {PLACEMENT_GRID.map(({ placement, row, col }) => {
                    const isCenter = row === 1 && col === 1;
                    const isActive = !isCenter && config?.placement === placement;
                    const dotV = (['flex-start', 'center', 'flex-end'] as const)[row];
                    const dotH = (['flex-start', 'center', 'flex-end'] as const)[col];
                    return (
                      <div
                        key={`${row}-${col}`}
                        onClick={isCenter ? undefined : () => patchConfig('placement', placement)}
                        style={{
                          width: 20, height: 20,
                          background: isCenter ? '#0f172a' : isActive ? '#3b82f6' : '#1f2937',
                          border: `1px solid ${isCenter ? '#1e293b' : isActive ? '#3b82f6' : '#374151'}`,
                          borderRadius: 3,
                          cursor: isCenter ? 'default' : 'pointer',
                          display: 'flex', alignItems: dotV, justifyContent: dotH,
                          padding: 3,
                        }}
                      >
                        <div style={{
                          width: isCenter ? 8 : 4, height: isCenter ? 8 : 4,
                          borderRadius: isCenter ? 2 : '50%', flexShrink: 0,
                          background: isCenter ? '#374151' : isActive ? 'rgba(255,255,255,0.9)' : '#4b5563',
                        }} />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Offset */}
              <SettingsRow label="Offset">
                <input
                  type="number"
                  value={(config?.offset as number) ?? 4}
                  onChange={e => patchConfig('offset', Number(e.target.value))}
                  style={{ width: 48, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 10, padding: '2px 4px', textAlign: 'right' as const }}
                />
              </SettingsRow>

              {/* Options */}
              <SettingsRow label="Match width">
                <input type="checkbox" checked={!!config?.matchTriggerWidth} onChange={e => patchConfig('matchTriggerWidth', e.target.checked)} />
              </SettingsRow>
              <SettingsRow label="Close on outside">
                <input type="checkbox" checked={config?.closeOnOutsideClick !== false} onChange={e => patchConfig('closeOnOutsideClick', e.target.checked)} />
              </SettingsRow>
              <SettingsRow label="Close on Escape">
                <input type="checkbox" checked={config?.closeOnEscape !== false} onChange={e => patchConfig('closeOnEscape', e.target.checked)} />
              </SettingsRow>

              {/* Control variable — programmatic open/close */}
              <OpenVariablePicker
                value={config?.openVariable}
                customVars={mergedCustomVars}
                onChange={varId => {
                  if (varId) patchConfig('openVariable', varId);
                  else {
                    const next = { ...(config ?? {}) };
                    delete (next as Record<string, unknown>).openVariable;
                    store.setPopoverConfig(nodeId, next);
                  }
                }}
              />

              {/* Content summary */}
              <div style={{ fontSize: 10, color: '#6b7280', paddingTop: 4 }}>
                {contentCount} content node{contentCount !== 1 ? 's' : ''}
                {contentCount === 0 && pcChildren.length === 0 && (
                  <button
                    onClick={() => {
                      const pcWrapper: SDUINode = {
                        type: 'Box' as SDUINode['type'],
                        id: crypto.randomUUID(),
                        _popoverContent: true,
                        props: { className: 'p-2' },
                        children: [],
                      };
                      store.addNode(pcWrapper, nodeId);
                    }}
                    style={{ marginLeft: 6, fontSize: 10, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    + Add container
                  </button>
                )}
              </div>

              {/* Remove */}
              <button
                onClick={handleRemove}
                style={{ width: '100%', padding: '4px 0', background: 'transparent', border: '1px solid #7f1d1d', borderRadius: 4, color: '#ef4444', fontSize: 10, cursor: 'pointer', marginTop: 2 }}
              >
                Remove Popover
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Align / Distribute Panel ─────────────────────────────────────────────────

export function AlignDistributePanel({ ids }: { ids: string[] }) {
  const store = useBuilderStore();

  const ALIGN_BTNS: Array<{ label: string; icon: string; edge: Parameters<typeof store.alignNodes>[1]; testId: string }> = [
    { label: 'Align Left',    icon: '⊢', edge: 'left',   testId: 'align-left' },
    { label: 'Align Center H',icon: '↔', edge: 'center', testId: 'align-center-h' },
    { label: 'Align Right',   icon: '⊣', edge: 'right',  testId: 'align-right' },
    { label: 'Align Top',     icon: '⊤', edge: 'top',    testId: 'align-top' },
    { label: 'Align Middle V',icon: '↕', edge: 'middle', testId: 'align-middle-v' },
    { label: 'Align Bottom',  icon: '⊥', edge: 'bottom', testId: 'align-bottom' },
  ];

  const DIST_BTNS: Array<{ label: string; icon: string; axis: 'h' | 'v'; testId: string }> = [
    { label: 'Distribute Horizontal', icon: '⇔', axis: 'h', testId: 'distribute-h' },
    { label: 'Distribute Vertical',   icon: '⇕', axis: 'v', testId: 'distribute-v' },
  ];

  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 8 }}>{ids.length} nodes selected</div>

      <SectionHeader title="Align" />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12, marginTop: 6 }}>
        {ALIGN_BTNS.map(({ label, icon, edge, testId }) => (
          <button
            key={edge}
            title={label}
            data-testid={testId}
            onClick={() => store.alignNodes(ids, edge)}
            style={{ width: 32, height: 28, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', cursor: 'pointer', fontSize: 14 }}
          >
            {icon}
          </button>
        ))}
      </div>

      <SectionHeader title="Distribute" />
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {DIST_BTNS.map(({ label, icon, axis, testId }) => (
          <button
            key={axis}
            title={label}
            data-testid={testId}
            onClick={() => store.distributeNodes(ids, axis)}
            style={{ width: 32, height: 28, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', cursor: 'pointer', fontSize: 14 }}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── FormContainer Fields Inspector ───────────────────────────────────────────

function FormContainerFieldsPanel({ nodeId }: { nodeId: string }) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [fields, setFields] = useState<Record<string, { value?: unknown; isValid?: unknown }>>({});
  const [flags, setFlags] = useState({ isSubmitting: false, isSubmitted: false, isValid: false });
  const formStoreKey = nodeId ? `${nodeId}-form` : null;

  useEffect(() => {
    const read = () => {
      const vs = getGlobalVariableStore().getState().getFullState();
      // Read from per-container key (variables[nodeId-form]) so we only see THIS
      // FormContainer's fields — not fields from other containers on the same page.
      const form = formStoreKey
        ? (vs[formStoreKey] as Record<string, unknown> | undefined)
        : undefined;
      setFormData((form?.['formData'] as Record<string, unknown>) ?? {});
      setFields((form?.['fields'] as Record<string, { value?: unknown; isValid?: unknown }>) ?? {});
      setFlags({
        isSubmitting: Boolean(form?.['isSubmitting']),
        isSubmitted: Boolean(form?.['isSubmitted']),
        isValid: Boolean(form?.['isValid']),
      });
    };
    read();
    return getGlobalVariableStore().subscribe(() => read());
  }, [nodeId, formStoreKey]);

  const fieldNames = Object.keys(formData);

  return (
    <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
      <div style={{ padding: '0 12px 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 10h8M8 14h5"/>
        </svg>
        <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Registered Fields</span>
      </div>

      {/* Formula path hint */}
      {formStoreKey && (
        <div style={{ padding: '0 12px 6px', fontSize: 9, color: '#4b5563', lineHeight: 1.4 }}>
          Formula path:{' '}
          <code style={{ background: '#1f2937', padding: '1px 4px', borderRadius: 3, color: '#6366f1' }}>
            variables[&apos;{formStoreKey}&apos;].formData.fieldName
          </code>
        </div>
      )}
      {!formStoreKey && (
        <div style={{ padding: '4px 12px 6px', fontSize: 9, color: '#f87171' }}>
          Set an <code style={{ background: '#1f2937', padding: '1px 4px', borderRadius: 3 }}>id</code> on this FormContainer to enable per-form tracking.
        </div>
      )}
      {fieldNames.length === 0 ? (
        <div style={{ padding: '4px 12px 8px', fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>
          No fields registered yet — add InputField nodes with a{' '}
          <code style={{ background: '#1f2937', padding: '1px 4px', borderRadius: 3 }}>name</code> prop.
        </div>
      ) : (
        <div style={{ padding: '0 12px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {fieldNames.map(name => {
            const val = formData[name];
            const isValid = fields[name]?.isValid;
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', background: '#0f172a', borderRadius: 4, border: '1px solid #1e293b' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#86efac', minWidth: 80, flexShrink: 0 }}>{name}</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {val === undefined || val === null || val === '' ? <span style={{ color: '#374151' }}>(empty)</span> : String(val)}
                </span>
                {isValid ? (
                  <span style={{ fontSize: 9, color: '#f87171', flexShrink: 0 }}>⚠ {String(isValid)}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Form state flags */}
      <div style={{ padding: '4px 12px 6px', display: 'flex', gap: 8 }}>
        {(['isSubmitting', 'isSubmitted', 'isValid'] as const).map(key => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: flags[key] ? '#86efac' : '#374151', flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: '#6b7280' }}>{key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
