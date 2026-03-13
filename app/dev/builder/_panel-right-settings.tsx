'use client';

/**
 * _panel-right-settings.tsx
 *
 * SettingsTab and AlignDistributePanel components for the builder right panel.
 * Extracted from _panel-right.tsx.
 *
 * Exports: SettingsTab, AlignDistributePanel
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useBuilderStore, findParentNode } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { SECTION_STYLE, LABEL_STYLE, SectionHeader, ToggleBtn } from './_panel-primitives';
import { FieldWithBinding, BindingIcon, type FormulaValue, closeAllEditors, registerEditorClose } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';

// ─── Settings Tab ─────────────────────────────────────────────────────────────

const SETTINGS_INPUT_TYPES = new Set(['Input', 'InputField', 'Select', 'TextArea', 'Checkbox', 'Radio', 'Switch', 'Button']);

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
function SettingsTextInput({ value, onChange, placeholder, expandable = false }: { value: string; onChange: (v: string) => void; placeholder?: string; expandable?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'flex-end' }}>
      <input
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
  const validation = nodeExtra._validation as NodeValidation | undefined;
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
    const next = { ...(validation ?? {}), ...patch } as NodeValidation;
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

  const patchProp = (key: string, value: unknown) => {
    store.patchNodeField(nodeId, 'props', { ...nodeProps, [key]: value });
  };

  const patchInitialValue = (value: unknown) => {
    store.patchNodeField(nodeId, '_initialValue', value);
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
  const initValue = ((node as Record<string, unknown>)._initialValue as string | undefined) ?? '';
  const debounceEnabled = debounce?.enabled ?? false;
  const debounceDelay = debounce?.delay ?? 500;

  // Input type — map raw prop to option value
  const rawInputType = (nodeProps.type as string | undefined) ?? 'text';
  const currentInputType = rawInputType === 'number' && nodeProps.step === '0.01' ? 'decimal' : rawInputType;

  // Button submit detection — renderer uses props.type === 'submit' to wire the button to formCtx.submit()
  const isSubmitButton = (nodeProps as unknown as Record<string, unknown>).type === 'submit';

  const selectInputType = (val: string) => {
    if (val === 'decimal' || val === 'currency') {
      store.patchNodeField(nodeId, 'props', { ...nodeProps, type: 'number', step: '0.01' });
    } else {
      const { step: _s, ...rest } = nodeProps as Record<string, unknown>;
      void _s;
      store.patchNodeField(nodeId, 'props', { ...rest, type: val });
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

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

      {/* ── Button-specific: Submit toggle ───────────────────────────────────── */}
      {nodeType === 'Button' && (
        <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
          <div style={{ padding: '0 12px 4px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Button</div>
          <SettingsRow label="Submit">
            <div data-testid="submit-toggle" style={{ display: 'flex', background: '#1f2937', borderRadius: 4, padding: 2, gap: 2 }}>
              {[true, false].map(val => (
                <button
                  key={String(val)}
                  data-testid={val ? 'submit-toggle-on' : 'submit-toggle-off'}
                  style={{
                    padding: '2px 10px', fontSize: 10, border: 'none', cursor: 'pointer',
                    borderRadius: 3, fontWeight: 500,
                    background: isSubmitButton === val ? '#374151' : 'transparent',
                    color: isSubmitButton === val ? '#f3f4f6' : '#6b7280',
                  }}
                  onClick={() => {
                    if (val) {
                      store.patchNodeField(nodeId, 'props', { ...(nodeProps as unknown as Record<string, unknown>), type: 'submit' });
                    } else {
                      const { type: _t, ...rest } = nodeProps as unknown as Record<string, unknown>;
                      void _t;
                      store.patchNodeField(nodeId, 'props', rest);
                    }
                  }}
                >
                  {val ? 'On' : 'Off'}
                </button>
              ))}
            </div>
          </SettingsRow>
        </div>
      )}

      {/* ── FormContainer: registered fields inspector ───────────────────────── */}
      {nodeType === 'FormContainer' && <FormContainerFieldsPanel nodeId={nodeId} />}

      {/* ── For non-input, non-button types: show nothing more ───────────────── */}
      {!SETTINGS_INPUT_TYPES.has(nodeType) && nodeType !== 'Button' && nodeType !== 'FormContainer' && (
        <div style={{ padding: 16, color: '#4b5563', fontSize: 11, textAlign: 'center' }}>
          No specific settings for this element
        </div>
      )}

      {/* ── Form Container Section (input types only) ────────────────────────── */}
      {SETTINGS_INPUT_TYPES.has(nodeType) && nodeType !== 'Button' && formContainerAncestor && (
        <div style={{ borderBottom: '1px solid #1f2937', padding: '8px 0 4px' }}>
          <div style={{ padding: '0 12px 4px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 12 11 14 15 10"/><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
            </svg>
            <span style={{ fontSize: 10, color: '#10b981', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Form container</span>
          </div>

          {/* Field name */}
          <SettingsRow label="Field name">
            <BindingIcon isBound={false} onClick={() => {}} />
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
      {SETTINGS_INPUT_TYPES.has(nodeType) && nodeType !== 'Button' && (
        <div style={{ padding: '8px 0 4px' }}>
          <div style={{ padding: '0 12px 6px', fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>Specific</div>

          {/* Input type (Input and InputField only) */}
          {(nodeType === 'Input' || nodeType === 'InputField') && (
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
                value={initValue}
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

          {/* Autocomplete */}
          <SettingsRow label="Autocomplete">
            <BindingIcon isBound={false} onClick={() => {}} />
            <OnOffToggle value={autocomplete !== 'new-password' && autocomplete !== 'off'} onChange={v => patchProp('autoComplete', v ? 'on' : 'new-password')} />
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
