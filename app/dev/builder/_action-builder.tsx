'use client';

/**
 * Action Builder — per-event action chain editor.
 *
 * Renders a list of events (click, change, submit, etc.) with collapsible
 * action chain for each. Each action has a type selector and type-specific
 * param fields. Actions within a trigger are drag-to-reorder. Supports
 * onSuccess chaining (fetch/graphql/validate → Then...).
 */

import React, { useState, useCallback, useRef, createContext, useContext } from 'react';
import { PathPicker } from './_path-picker';
import { AutocompleteInput } from './_autocomplete';
import { ExprBuilder } from './_expr-builder';
import type { DataSourceConfig } from './_store';

// ─── Context to pass availableDataSources down the component tree ─────────────

const DataSourcesContext = createContext<DataSourceConfig[]>([]);
const useDataSources = () => useContext(DataSourcesContext);

// ─── Named actions ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ACTION_FILES: Record<string, Record<string, unknown>> = {
  auth:     require('@/config/actions/auth.json'),
  cart:     require('@/config/actions/cart.json'),
  checkout: require('@/config/actions/checkout.json'),
  layout:   require('@/config/actions/layout.json'),
  products: require('@/config/actions/products.json'),
  account:  require('@/config/actions/account.json'),
};
const ALL_NAMED_ACTIONS: string[] = Object.values(ACTION_FILES).flatMap(f => Object.keys(f));

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionType =
  | 'named'
  | 'navigate'
  | 'setState'
  | 'set'
  | 'setVar'
  | 'toggle'
  | 'increment'
  | 'decrement'
  | 'validate'
  | 'animate'
  | 'runMultiple'
  | 'appendToPath'
  | 'nextStep'
  | 'prevStep'
  | 'goToStep'
  | 'markDirty'
  | 'resetDirty';

export interface ActionDef {
  id: string;
  type: ActionType;
  // named
  actionName?: string;
  // navigate
  navPath?: string;
  navRouteConfig?: string;
  navSlug?: string;
  // setState / set / setVar / toggle
  path?: string;
  value?: string;
  // increment / decrement
  amount?: number;
  min?: number;
  // fetch
  url?: string;
  method?: string;
  body?: string;
  storeIn?: string;
  responsePath?: string;
  // graphql
  query?: string;
  variables?: Array<{ key: string; value: string }>;
  endpoint?: string;
  // validate
  rules?: Array<{ field: string; required?: boolean; minLength?: number; maxLength?: number; pattern?: string; message?: string }>;
  storeErrorsIn?: string;
  // animate
  targetNodeId?: string;
  animation?: string;
  duration?: number;
  // runMultiple
  actions?: ActionDef[];
  // appendToPath
  targetPath?: string;
  appendValue?: string;
  resetFormPath?: string;
  // stepper
  stepperPath?: string;
  step?: number;
  // dirty
  dirtyPath?: string;
  // conditional
  condition?: object | null;
  conditionEnabled?: boolean;
  // onSuccess
  onSuccess?: ActionDef | null;
  onError?: ActionDef | null;
  // data source link (builder only — not serialized to config)
  dataSourceId?: string;
}

export type EventTrigger = 'click' | 'change' | 'focus' | 'blur' | 'submit' | 'mount' | 'mouseEnter' | 'mouseLeave' | 'run';

export interface EventActions {
  event: EventTrigger;
  actions: ActionDef[];
  enabled: boolean;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bld-bg-input)',
  border: '1px solid var(--bld-border-subtle)',
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 11,
  color: 'var(--bld-text-1)',
  outline: 'none',
  fontFamily: 'monospace',
  width: '100%',
};

const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE, cursor: 'pointer' };
const LABEL_STYLE: React.CSSProperties = { fontSize: 10, color: 'var(--bld-text-disabled)', display: 'block', marginBottom: 2 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={LABEL_STYLE}>{label}</span>
      {children}
    </div>
  );
}

// ─── Action type params ───────────────────────────────────────────────────────

function ActionParams({ action, onChange, inMapContext }: {
  action: ActionDef;
  onChange: (patch: Partial<ActionDef>) => void;
  inMapContext?: boolean;
}) {
  const availableDataSources = useDataSources();

  switch (action.type) {
    case 'named':
      return (
        <Field label="Action name">
          <select
            value={action.actionName ?? ''}
            onChange={e => onChange({ actionName: e.target.value })}
            style={SELECT_STYLE}
          >
            <option value="">— select action —</option>
            {ALL_NAMED_ACTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      );

    case 'navigate':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Field label="Type">
            <div style={{ display: 'flex', gap: 8 }}>
              {['path', 'routeConfig'].map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--bld-text-2)', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    checked={(action.navRouteConfig ? 'routeConfig' : 'path') === t}
                    onChange={() => onChange(t === 'path' ? { navRouteConfig: undefined } : { navPath: undefined })}
                    style={{ accentColor: 'var(--bld-accent)' }}
                  />
                  {t === 'path' ? 'Static path' : 'Route config'}
                </label>
              ))}
            </div>
          </Field>
          {!action.navRouteConfig ? (
            <Field label="Path">
              <input value={action.navPath ?? ''} onChange={e => onChange({ navPath: e.target.value })} placeholder="/checkout" style={INPUT_STYLE} />
            </Field>
          ) : (
            <>
              <Field label="Route config">
                <input value={action.navRouteConfig ?? ''} onChange={e => onChange({ navRouteConfig: e.target.value })} placeholder="product" style={INPUT_STYLE} />
              </Field>
              <Field label="Slug">
                <input value={action.navSlug ?? ''} onChange={e => onChange({ navSlug: e.target.value })} placeholder="{{$item.slug}}" style={INPUT_STYLE} />
              </Field>
            </>
          )}
        </div>
      );

    case 'setState':
    case 'set':
    case 'setVar':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Field label="Path">
            <PathPicker value={action.path ?? ''} onChange={v => onChange({ path: v })} inMapContext={inMapContext} />
          </Field>
          <Field label="Value">
            <input value={action.value ?? ''} onChange={e => onChange({ value: e.target.value })} placeholder="value or {{variable}}" style={INPUT_STYLE} />
          </Field>
        </div>
      );

    case 'toggle':
      return (
        <Field label="Path">
          <PathPicker value={action.path ?? ''} onChange={v => onChange({ path: v })} inMapContext={inMapContext} />
        </Field>
      );

    case 'increment':
    case 'decrement':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Field label="Path">
            <PathPicker value={action.path ?? ''} onChange={v => onChange({ path: v })} inMapContext={inMapContext} />
          </Field>
          <div style={{ display: 'flex', gap: 6 }}>
            <Field label="Amount">
              <input type="number" value={action.amount ?? 1} onChange={e => onChange({ amount: Number(e.target.value) })} style={{ ...INPUT_STYLE, width: 60 }} />
            </Field>
            <Field label="Min">
              <input type="number" value={action.min ?? 0} onChange={e => onChange({ min: Number(e.target.value) })} style={{ ...INPUT_STYLE, width: 60 }} />
            </Field>
          </div>
        </div>
      );

    case 'validate': {
      // rules can arrive as an object (from raw JSON config) or array (from builder UI)
      const rulesNormalized: ValidationRule[] = Array.isArray(action.rules)
        ? action.rules as ValidationRule[]
        : Object.entries((action.rules as Record<string, Record<string, unknown>>) ?? {}).map(([field, r]) => ({
            field,
            required: r.required as boolean | undefined,
            minLength: r.minLength as number | undefined,
            maxLength: r.maxLength as number | undefined,
            pattern: r.pattern as string | undefined,
            message: r.message as string | undefined,
          }));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Field label="Rules">
            <ValidationRulesEditor
              rules={rulesNormalized}
              onChange={r => onChange({ rules: r })}
            />
          </Field>
          <Field label="Store errors in">
            <PathPicker value={action.storeErrorsIn ?? ''} onChange={v => onChange({ storeErrorsIn: v })} placeholder="errors" />
          </Field>
        </div>
      );
    }

    case 'animate':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Field label="Target node ID">
            <input value={action.targetNodeId ?? ''} onChange={e => onChange({ targetNodeId: e.target.value })} placeholder="node-id" style={INPUT_STYLE} />
          </Field>
          <Field label="Animation">
            <select value={action.animation ?? 'fadeIn'} onChange={e => onChange({ animation: e.target.value })} style={SELECT_STYLE}>
              {['fadeIn','fadeOut','slideUp','slideDown','shake','pulse','bounce','spin'].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Duration (ms)">
            <input type="number" value={action.duration ?? 300} onChange={e => onChange({ duration: Number(e.target.value) })} style={{ ...INPUT_STYLE, width: 80 }} />
          </Field>
        </div>
      );

    case 'appendToPath':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Field label="Target path">
            <PathPicker value={action.targetPath ?? ''} onChange={v => onChange({ targetPath: v })} inMapContext={inMapContext} />
          </Field>
          <Field label="Value to append">
            <input value={action.appendValue ?? ''} onChange={e => onChange({ appendValue: e.target.value })} placeholder="{{$item.id}}" style={INPUT_STYLE} />
          </Field>
          <Field label="Reset form path (optional)">
            <PathPicker value={action.resetFormPath ?? ''} onChange={v => onChange({ resetFormPath: v })} />
          </Field>
        </div>
      );

    case 'runMultiple':
      return (
        <Field label="Sub-actions">
          <ActionList
            actions={action.actions ?? []}
            onChange={a => onChange({ actions: a })}
            inMapContext={inMapContext}
            depth={1}
          />
        </Field>
      );

    case 'nextStep':
    case 'prevStep':
      return (
        <Field label="Stepper path">
          <PathPicker value={action.stepperPath ?? ''} onChange={v => onChange({ stepperPath: v })} placeholder="screens.checkout.currentStep" />
        </Field>
      );

    case 'goToStep':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Field label="Stepper path">
            <PathPicker value={action.stepperPath ?? ''} onChange={v => onChange({ stepperPath: v })} placeholder="screens.checkout.currentStep" />
          </Field>
          <Field label="Step index (0-based)">
            <input type="number" min={0} value={action.step ?? 0} onChange={e => onChange({ step: Number(e.target.value) })} style={{ ...INPUT_STYLE, width: 80 }} />
          </Field>
        </div>
      );

    case 'markDirty':
    case 'resetDirty':
      return (
        <Field label="Dirty path">
          <PathPicker value={action.dirtyPath ?? ''} onChange={v => onChange({ dirtyPath: v })} placeholder="screens.signUp.isDirty" />
        </Field>
      );

    default:
      return null;
  }
}

// ─── Variables editor ─────────────────────────────────────────────────────────

function VariablesEditor({ variables, onChange, inMapContext }: {
  variables: Array<{ key: string; value: string }>;
  onChange: (v: Array<{ key: string; value: string }>) => void;
  inMapContext?: boolean;
}) {
  const update = (i: number, patch: Partial<{ key: string; value: string }>) => {
    onChange(variables.map((v, idx) => idx === i ? { ...v, ...patch } : v));
  };
  const remove = (i: number) => onChange(variables.filter((_, idx) => idx !== i));
  const add = () => onChange([...variables, { key: '', value: '' }]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {variables.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input value={v.key} onChange={e => update(i, { key: e.target.value })} placeholder="key" style={{ ...INPUT_STYLE, flex: 1 }} />
          <span style={{ color: 'var(--bld-text-disabled)' }}>:</span>
          <input value={v.value} onChange={e => update(i, { value: e.target.value })} placeholder="{{value}}" style={{ ...INPUT_STYLE, flex: 2 }} />
          <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-error)', fontSize: 12 }}>×</button>
        </div>
      ))}
      <button onClick={add} style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-disabled)', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>
        + Add variable
      </button>
    </div>
  );
}

// ─── Validation rules editor ──────────────────────────────────────────────────

type ValidationRule = { field: string; required?: boolean; minLength?: number; maxLength?: number; pattern?: string; message?: string };

function ValidationRulesEditor({ rules, onChange }: {
  rules: ValidationRule[];
  onChange: (r: ValidationRule[]) => void;
}) {
  const update = (i: number, patch: Partial<ValidationRule>) => {
    onChange(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const remove = (i: number) => onChange(rules.filter((_, idx) => idx !== i));
  const add = () => onChange([...rules, { field: '', required: true, message: 'Required' }]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rules.map((r, i) => (
        <div key={i} style={{ background: 'var(--bld-bg-input)', borderRadius: 4, padding: 6, border: '1px solid var(--bld-border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <input value={r.field} onChange={e => update(i, { field: e.target.value })} placeholder="form.email" style={{ ...INPUT_STYLE, flex: 1 }} />
            <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-error)', fontSize: 12, marginLeft: 4 }}>×</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--bld-text-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={r.required ?? false} onChange={e => update(i, { required: e.target.checked })} style={{ accentColor: 'var(--bld-accent)' }} />
              Required
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>Min:</span>
              <input type="number" value={r.minLength ?? ''} onChange={e => update(i, { minLength: e.target.value ? Number(e.target.value) : undefined })} style={{ ...INPUT_STYLE, width: 50 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>Pattern:</span>
              <select value={r.pattern ?? ''} onChange={e => update(i, { pattern: e.target.value || undefined })} style={{ ...SELECT_STYLE, width: 80 }}>
                <option value="">none</option>
                <option value="email">email</option>
                <option value="phone">phone</option>
                <option value="url">url</option>
              </select>
            </div>
          </div>
          <input value={r.message ?? ''} onChange={e => update(i, { message: e.target.value })} placeholder="Error message" style={{ ...INPUT_STYLE, marginTop: 4 }} />
        </div>
      ))}
      <button onClick={add} style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-disabled)', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>
        + Add rule
      </button>
    </div>
  );
}

// ─── Single action row ────────────────────────────────────────────────────────

const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  named:        'Named action',
  navigate:     'Navigate',
  setState:     'Set state (screen)',
  set:          'Set (global)',
  setVar:       'Set variable',
  toggle:       'Toggle',
  increment:    'Increment',
  decrement:    'Decrement',
  validate:     'Validate form',
  animate:      'Animate',
  runMultiple:  'Run multiple',
  appendToPath: 'Append to list',
  nextStep:     'Next step',
  prevStep:     'Previous step',
  goToStep:     'Go to step',
  markDirty:    'Mark dirty',
  resetDirty:   'Reset dirty',
};

let _actionIdCtr = 0;
export function newActionId() { return `action-${++_actionIdCtr}`; }

function ActionRow({ action, onUpdate, onRemove, inMapContext, depth = 0 }: {
  action: ActionDef;
  onUpdate: (patch: Partial<ActionDef>) => void;
  onRemove: () => void;
  inMapContext?: boolean;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showCondition, setShowCondition] = useState(action.conditionEnabled ?? false);
  const [showOnSuccess, setShowOnSuccess] = useState(false);

  const hasChain = ['validate'].includes(action.type);

  return (
    <div style={{
      background: depth === 0 ? 'var(--bld-bg-input)' : 'var(--bld-bg-panel)',
      border: '1px solid var(--bld-border-subtle)',
      borderRadius: 5,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderBottom: expanded ? '1px solid var(--bld-border-subtle)' : 'none' }}>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-3)', fontSize: 10, padding: 0 }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <select
          value={action.type}
          onChange={e => onUpdate({ type: e.target.value as ActionType })}
          style={{ ...SELECT_STYLE, flex: 1, fontSize: 11, fontWeight: 500 }}
        >
          {Object.entries(ACTION_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <button
          onClick={() => setShowCondition(v => !v)}
          title="Add condition (Only if…)"
          style={{ background: showCondition ? 'var(--bld-accent-hover)20' : 'none', border: 'none', cursor: 'pointer', color: showCondition ? 'var(--bld-info)' : 'var(--bld-text-disabled)', fontSize: 10, padding: '2px 5px', borderRadius: 3 }}
        >
          if
        </button>
        <button
          onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-3)', fontSize: 12 }}
          title="Remove action"
        >
          ×
        </button>
      </div>

      {/* Params */}
      {expanded && (
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ActionParams action={action} onChange={onUpdate} inMapContext={inMapContext} />

          {/* Condition */}
          {showCondition && (
            <div style={{ borderTop: '1px solid var(--bld-bg-input)', paddingTop: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--bld-info)', display: 'block', marginBottom: 4 }}>Only if…</span>
              <ExprBuilder
                value={action.condition ?? null}
                onChange={v => onUpdate({ condition: v as object | null })}
                context="condition"
                inMapContext={inMapContext}
              />
            </div>
          )}

          {/* OnSuccess / OnError chain */}
          {hasChain && (
            <div style={{ borderTop: '1px solid var(--bld-bg-input)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={() => setShowOnSuccess(v => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 10, textAlign: 'left', padding: 0 }}
              >
                {showOnSuccess ? '▾ Then…' : '▸ Then…'} (on success)
              </button>
              {showOnSuccess && (
                <ActionList
                  actions={action.onSuccess ? [action.onSuccess] : []}
                  onChange={a => onUpdate({ onSuccess: a[0] ?? null })}
                  inMapContext={inMapContext}
                  depth={depth + 1}
                  max={1}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Action list ──────────────────────────────────────────────────────────────

function ActionList({ actions, onChange, inMapContext, depth = 0, max }: {
  actions: ActionDef[];
  onChange: (a: ActionDef[]) => void;
  inMapContext?: boolean;
  depth?: number;
  max?: number;
}) {
  const dragIdx = useRef<number | null>(null);

  const addAction = () => {
    if (max && actions.length >= max) return;
    onChange([...actions, { id: newActionId(), type: 'named', actionName: '' }]);
  };

  const update = (id: string, patch: Partial<ActionDef>) => {
    onChange(actions.map(a => a.id === id ? { ...a, ...patch } : a));
  };

  const remove = (id: string) => onChange(actions.filter(a => a.id !== id));

  const handleDragStart = (i: number) => { dragIdx.current = i; };
  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === i) return;
    const newActions = [...actions];
    const [moved] = newActions.splice(dragIdx.current, 1);
    newActions.splice(i, 0, moved);
    dragIdx.current = i;
    onChange(newActions);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {actions.map((action, i) => (
        <div
          key={action.id}
          draggable
          onDragStart={() => handleDragStart(i)}
          onDragOver={e => handleDragOver(e, i)}
          style={{ cursor: 'grab' }}
        >
          <ActionRow
            action={action}
            onUpdate={patch => update(action.id, patch)}
            onRemove={() => remove(action.id)}
            inMapContext={inMapContext}
            depth={depth}
          />
        </div>
      ))}
      {(!max || actions.length < max) && (
        <button
          onClick={addAction}
          style={{ background: 'none', border: '1px dashed var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-disabled)', fontSize: 11, padding: '4px 8px', cursor: 'pointer', marginTop: 2 }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--bld-text-disabled)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
        >
          + Add action
        </button>
      )}
    </div>
  );
}

// ─── Event section ────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<EventTrigger, string> = {
  click:      'On Click',
  change:     'On Change',
  focus:      'On Focus',
  blur:       'On Blur',
  submit:     'On Submit',
  mount:      'On Mount',
  mouseEnter: 'On Hover (enter)',
  mouseLeave: 'On Hover (leave)',
  run:        'Run (workflow)',
};

function EventSection({ event, actions, onChange, inMapContext }: {
  event: EventTrigger;
  actions: ActionDef[];
  onChange: (a: ActionDef[]) => void;
  inMapContext?: boolean;
}) {
  const [expanded, setExpanded] = useState(actions.length > 0);

  return (
    <div style={{ borderBottom: '1px solid var(--bld-bg-input)' }}>
      {/* Use div instead of button to avoid <button> inside <button> hydration error */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpanded(v => !v); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '7px 10px',
          color: 'var(--bld-text-2)',
          fontSize: 11,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: actions.length ? 'var(--bld-info)' : 'var(--bld-text-disabled)' }}>{expanded ? '▾' : '▸'}</span>
          <span style={{ fontWeight: 500 }}>{EVENT_LABELS[event]}</span>
          {actions.length > 0 && (
            <span style={{ fontSize: 9, background: 'var(--bld-accent-hover)', color: 'var(--bld-accent)', padding: '1px 5px', borderRadius: 9 }}>
              {actions.length}
            </span>
          )}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onChange([...actions, { id: newActionId(), type: 'named', actionName: '' }]); setExpanded(true); }}
          style={{ background: 'none', border: '1px solid var(--bld-border-subtle)', borderRadius: 3, color: 'var(--bld-text-3)', fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}
        >
          + Add
        </button>
      </div>
      {expanded && (
        <div style={{ padding: '0 10px 10px' }}>
          {actions.length === 0 ? (
            <div style={{ color: 'var(--bld-text-3)', fontSize: 11, fontStyle: 'italic', padding: '4px 0' }}>
              No actions — element has no {EVENT_LABELS[event].toLowerCase()} handler
            </div>
          ) : (
            <ActionList actions={actions} onChange={onChange} inMapContext={inMapContext} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ActionBuilder ───────────────────────────────────────────────────────

/** Convert node.actions (SDUI format) → EventActions[] */
export function parseNodeActions(nodeActions: Record<string, unknown> | null | undefined): EventActions[] {
  if (!nodeActions) return [];
  const events: EventActions[] = [];
  for (const [event, actionDef] of Object.entries(nodeActions)) {
    const actions: ActionDef[] = [];
    const defs = Array.isArray(actionDef) ? actionDef : [actionDef];
    for (const def of defs) {
      const d = def as Record<string, unknown>;
      if (d.action) {
        actions.push({ id: newActionId(), type: 'named', actionName: String(d.action) });
      } else if (d.type) {
        actions.push({ id: newActionId(), type: String(d.type) as ActionType, ...d });
      }
    }
    events.push({ event: event as EventTrigger, actions, enabled: true });
  }
  return events;
}

/** Convert EventActions[] → node.actions (SDUI format) */
export function serializeEventActions(events: EventActions[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const ev of events) {
    if (!ev.actions.length) continue;
    const serialized = ev.actions.map(serializeAction);
    result[ev.event] = serialized.length === 1 ? serialized[0] : { type: 'runMultiple', actions: serialized };
  }
  return result;
}

function serializeAction(a: ActionDef): Record<string, unknown> {
  switch (a.type) {
    case 'named':     return { action: a.actionName };
    case 'navigate':  return a.navRouteConfig
      ? { action: 'navigate', payload: { routeConfig: a.navRouteConfig, slug: a.navSlug } }
      : { action: 'navigate', payload: { path: a.navPath } };
    case 'setState':  return { type: 'setState', payload: { path: a.path, value: a.value } };
    case 'set':       return { type: 'set', path: a.path, value: a.value };
    case 'setVar':    return { type: 'setVar', path: a.path, value: a.value };
    case 'toggle':    return { type: 'toggle', path: a.path };
    case 'increment': return { type: 'increment', path: a.path, amount: a.amount, min: a.min };
    case 'decrement': return { type: 'decrement', path: a.path, amount: a.amount, min: a.min };
    case 'validate':  return { type: 'validate', rules: a.rules?.reduce((acc, r) => ({ ...acc, [r.field]: { required: r.required, minLength: r.minLength, pattern: r.pattern, message: r.message } }), {}), storeErrorsIn: a.storeErrorsIn, ...(a.onSuccess ? { onSuccess: serializeAction(a.onSuccess) } : {}) };
    case 'animate':   return { type: 'animate', targetNodeId: a.targetNodeId, animation: a.animation, duration: a.duration };
    case 'runMultiple': return { type: 'runMultiple', actions: (a.actions ?? []).map(serializeAction) };
    case 'appendToPath': return { type: 'appendToPath', targetPath: a.targetPath, value: a.appendValue, resetFormPath: a.resetFormPath };
    case 'nextStep':    return { type: 'nextStep', stepperPath: a.stepperPath };
    case 'prevStep':    return { type: 'prevStep', stepperPath: a.stepperPath };
    case 'goToStep':    return { type: 'goToStep', stepperPath: a.stepperPath, step: a.step };
    case 'markDirty':   return { type: 'markDirty', dirtyPath: a.dirtyPath };
    case 'resetDirty':  return { type: 'resetDirty', dirtyPath: a.dirtyPath };
    default:          return {};
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ActionBuilderProps {
  /** node.actions (raw SDUI format) */
  value: Record<string, unknown> | null | undefined;
  onChange: (actions: Record<string, unknown>) => void;
  /** Which events to show, based on node type */
  availableEvents: EventTrigger[];
  inMapContext?: boolean;
  /** Data sources available for prefill in fetch/graphql actions */
  availableDataSources?: DataSourceConfig[];
}

export function ActionBuilder({ value, onChange, availableEvents, inMapContext, availableDataSources = [] }: ActionBuilderProps) {
  const [eventActions, setEventActions] = useState<EventActions[]>(() => {
    const parsed = parseNodeActions(value);
    return availableEvents.map(event => {
      const existing = parsed.find(e => e.event === event);
      return existing ?? { event, actions: [], enabled: true };
    });
  });

  const updateEvent = useCallback((event: EventTrigger, actions: ActionDef[]) => {
    const updated = eventActions.map(e => e.event === event ? { ...e, actions } : e);
    setEventActions(updated);
    onChange(serializeEventActions(updated));
  }, [eventActions, onChange]);

  return (
    <DataSourcesContext.Provider value={availableDataSources}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {eventActions.map(ev => (
          <EventSection
            key={ev.event}
            event={ev.event}
            actions={ev.actions}
            onChange={actions => updateEvent(ev.event, actions)}
            inMapContext={inMapContext}
          />
        ))}
      </div>
    </DataSourcesContext.Provider>
  );
}

// ─── Helper: events for a node type ──────────────────────────────────────────

export function eventsForNodeType(type: string): EventTrigger[] {
  const clickable = new Set(['Box', 'Card', 'Image', 'Fab']);
  const inputlike = new Set(['Input', 'Textarea', 'TextareaInput', 'Select', 'Switch', 'Checkbox', 'Radio', 'Slider']);
  const formlike  = new Set(['Form']);

  const events: EventTrigger[] = ['mount'];
  if (clickable.has(type)) events.unshift('click', 'mouseEnter', 'mouseLeave');
  if (inputlike.has(type)) events.unshift('change', 'focus', 'blur');
  if (formlike.has(type))  events.unshift('submit');
  return [...new Set(events)];
}
