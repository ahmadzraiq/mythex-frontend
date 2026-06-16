'use client';

/**
 * Logic Panel — the "Logic" tab in the right panel.
 *
 * 11 collapsible sections:
 *   1. Data Binding       — bind any prop to a store path / template / expression
 *   2. Component States   — per-state style overrides (loading, error, empty, etc.)
 *   3. Variants           — N conditional subtrees (like Figma variants)
 *   4. Visibility         — node.condition (show when…)
 *   5. Data Source        — node.dataSource (auto-fetch on mount)
 *   6. Interactions       — node.actions (event → action chain)
 *   7. Disabled           — props.disabled expression
 *   8. Repeat / List      — node.map + pagination / infinite scroll config
 *   9. Form & Validation  — form binding + validation rules (context-aware)
 *  10. Stepper            — multi-step flow config
 *  11. Dirty Tracking     — track form dirty state
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { SDUINode } from '@/lib/sdui/types/node';
import { useBuilderStore } from './_store';
import { PathPicker } from './_path-picker';
import { AutocompleteInput } from './_autocomplete';
import { ExprBuilder, SimpleCondition } from './_expr-builder';
import { ActionBuilder, eventsForNodeType } from './_action-builder';

// ─── Shared panel primitives ──────────────────────────────────────────────────

const SECTION_BG = 'var(--bld-bg-panel)';
const BORDER_COLOR = 'var(--bld-bg-input)';
const LABEL: React.CSSProperties = { fontSize: 10, color: 'var(--bld-text-disabled)', textTransform: 'none', display: 'block' };
const INPUT: React.CSSProperties = { background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, padding: '3px 6px', fontSize: 11, color: 'var(--bld-text-1)', outline: 'none', fontFamily: 'monospace', width: '100%' };
const SELECT: React.CSSProperties = { ...INPUT, cursor: 'pointer' };

function Field({ label, children, row = false }: { label: string; children: React.ReactNode; row?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: row ? 'row' : 'column', gap: row ? 8 : 2, alignItems: row ? 'center' : undefined }}>
      {label && <span style={{ ...LABEL, flexShrink: 0 }}>{label}</span>}
      {children}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: 'var(--bld-text-2)' }}>
      <div
        onClick={() => onChange(!value)}
        style={{ width: 28, height: 16, borderRadius: 8, background: value ? 'var(--bld-accent)' : 'var(--bld-border-subtle)', position: 'relative', flexShrink: 0, transition: 'background 0.2s', cursor: 'pointer' }}
      >
        <div style={{ position: 'absolute', top: 2, left: value ? 14 : 2, width: 12, height: 12, borderRadius: 6, background: 'var(--bld-accent-fg)', transition: 'left 0.2s' }} />
      </div>
      {label}
    </label>
  );
}

// ─── Collapsible section ──────────────────────────────────────────────────────

interface SectionProps {
  id: string;
  title: string;
  badge?: string;
  badgeColor?: string;
  hasValue?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
  scrollToRef?: React.RefObject<HTMLDivElement | null>;
}

function Section({ id, title, badge, badgeColor = 'var(--bld-border-subtle)', hasValue = false, defaultOpen = false, children, scrollToRef }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen || hasValue);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollToRef && scrollToRef.current === sectionRef.current) {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setOpen(true);
    }
  });

  return (
    <div ref={sectionRef} data-logic-section={id} style={{ borderBottom: `1px solid ${BORDER_COLOR}` }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '8px 12px',
          color: 'var(--bld-text-2)',
        }}
      >
        <span style={{ color: hasValue ? 'var(--bld-info)' : 'var(--bld-text-disabled)', fontSize: 10 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transition:"transform 0.15s",transform:open?"rotate(0deg)":"rotate(-90deg)"}}><polyline points="6 9 12 15 18 9"/></svg></span>
        <span style={{ fontSize: 11, fontWeight: 500, flex: 1, textAlign: 'left' }}>{title}</span>
        {hasValue && (
          <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--bld-accent)', flexShrink: 0 }} />
        )}
        {badge && (
          <span style={{ fontSize: 9, color: badgeColor, background: `${badgeColor}20`, padding: '1px 5px', borderRadius: 9, flexShrink: 0 }}>
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: 'var(--bld-text-3)', fontStyle: 'italic' }}>{text}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

// ─── 1. DATA BINDING ─────────────────────────────────────────────────────────

function DataBindingSection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const [prop, setProp] = useState('text');
  const [mode, setMode] = useState<'path' | 'template' | 'expression'>('path');
  const [bindPath, setBindPath] = useState('');

  const existingProps = node.props ? Object.keys(node.props) : [];
  const allProps = [...new Set(['text', 'className', 'src', 'alt', 'placeholder', ...existingProps])];

  // Read current bindings from node — any prop with {{}} or expr
  const bindings = useMemo(() => {
    const result: Array<{ prop: string; value: string }> = [];
    if (typeof node.text === 'string' && node.text.includes('{{')) {
      result.push({ prop: 'text', value: node.text });
    }
    if (node.props) {
      for (const [k, v] of Object.entries(node.props)) {
        if (typeof v === 'string' && v.includes('{{')) result.push({ prop: k, value: v });
        else if (typeof v === 'object' && v !== null && 'formula' in v) result.push({ prop: k, value: JSON.stringify(v) });
      }
    }
    return result;
  }, [node]);

  const applyBinding = () => {
    if (!prop || !bindPath) return;
    let value: string | object = '';
    if (mode === 'path') value = `{{${bindPath}}}`;
    else if (mode === 'template') value = bindPath;
    else value = { formula: { var: bindPath } };

    if (prop === 'text') {
      store.patchNodeField(node.id!, 'text', value);
    } else {
      store.patchProp(node.id!, `props.${prop}`, value);
    }
    setBindPath('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {bindings.length === 0 && <Empty text="No bindings — all props are static" />}
      {bindings.map(b => (
        <div key={b.prop} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bld-bg-input)', borderRadius: 4, padding: '4px 8px' }}>
          <span style={{ fontSize: 10, color: 'var(--bld-accent)', fontFamily: 'monospace', flexShrink: 0, width: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.prop}</span>
          <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>→</span>
          <span style={{ fontSize: 10, color: 'var(--bld-success)', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.value}</span>
          <button onClick={() => {
            if (b.prop === 'text') store.patchNodeField(node.id!, 'text', '');
            else store.patchProp(node.id!, `props.${b.prop}`, '');
          }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-error)', fontSize: 12 }}>×</button>
        </div>
      ))}

      <div style={{ borderTop: `1px solid ${BORDER_COLOR}`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Field label="Prop">
          <select value={prop} onChange={e => setProp(e.target.value)} style={SELECT}>
            {allProps.map(p => <option key={p} value={p}>{p}</option>)}
            <option value="__custom__">Custom…</option>
          </select>
        </Field>
        <Field label="Mode">
          <div style={{ display: 'flex', gap: 6 }}>
            {(['path', 'template', 'expression'] as const).map(m => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--bld-text-2)', cursor: 'pointer' }}>
                <input type="radio" checked={mode === m} onChange={() => setMode(m)} style={{ accentColor: 'var(--bld-accent)' }} />
                {m}
              </label>
            ))}
          </div>
        </Field>
        {mode === 'path' && (
          <Field label="Store path">
            <PathPicker value={bindPath} onChange={setBindPath} placeholder="store.product.title" />
          </Field>
        )}
        {mode === 'template' && (
          <Field label="Template">
            <AutocompleteInput value={bindPath} onChange={setBindPath} context="text" placeholder="Hello {{user.name}}" />
          </Field>
        )}
        {mode === 'expression' && (
          <Field label="Path for expression">
            <PathPicker value={bindPath} onChange={setBindPath} />
          </Field>
        )}
        <button
          onClick={applyBinding}
          style={{ background: 'var(--bld-accent-hover)', border: 'none', borderRadius: 4, color: 'var(--bld-accent-fg)', fontSize: 11, padding: '5px 10px', cursor: 'pointer', alignSelf: 'flex-start' }}
        >
          Apply binding
        </button>
      </div>
    </div>
  );
}

// ─── 2. COMPONENT STATES ─────────────────────────────────────────────────────

type ComponentState = 'normal' | 'hover' | 'loading' | 'error' | 'empty' | 'disabled' | 'custom';

const STATE_INFO: Record<ComponentState, { label: string; description: string; color: string }> = {
  normal:   { label: 'Normal',   description: 'Base state',         color: 'var(--bld-text-3)' },
  hover:    { label: 'Hover',    description: 'Mouse over',         color: 'var(--bld-accent)' },
  loading:  { label: 'Loading',  description: '_workflow.loading',  color: 'var(--bld-warning)' },
  error:    { label: 'Error',    description: '_workflow.lastError', color: 'var(--bld-error)' },
  empty:    { label: 'Empty',    description: 'Array is empty',     color: 'var(--bld-success)' },
  disabled: { label: 'Disabled', description: 'Input disabled',     color: 'var(--bld-text-3)' },
  custom:   { label: 'Custom',   description: 'Custom condition',   color: 'var(--bld-accent)' },
};

function ComponentStatesSection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const { activePreviewState } = store;

  const stateOverrides = (node as unknown as { _stateOverrides?: Record<string, { className?: string; condition?: object }> })._stateOverrides ?? {};

  const updateOverride = (state: ComponentState, patch: Partial<{ className: string; condition: object }>) => {
    const updated = { ...stateOverrides, [state]: { ...(stateOverrides[state] ?? {}), ...patch } };
    store.patchNodeField(node.id!, '_stateOverrides', updated);
  };

  const [editState, setEditState] = useState<ComponentState>('hover');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(Object.keys(STATE_INFO) as ComponentState[]).map(state => {
          const info = STATE_INFO[state];
          const hasOverride = !!stateOverrides[state];
          const isPreview = activePreviewState === state;
          return (
            <button
              key={state}
              onClick={() => setEditState(state)}
              style={{
                background: editState === state ? 'var(--bld-accent-hover)' : isPreview ? 'var(--bld-bg-elevated)' : 'var(--bld-bg-input)',
                border: `1px solid ${editState === state ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`,
                borderRadius: 4,
                color: info.color,
                fontSize: 10,
                padding: '3px 7px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              {state === 'normal' ? '●' : hasOverride ? '✓' : '○'} {info.label}
            </button>
          );
        })}
      </div>

      {editState !== 'normal' && (
        <div style={{ background: 'var(--bld-bg-input)', borderRadius: 5, padding: 8, border: `1px solid var(--bld-border-subtle)`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: STATE_INFO[editState].color, fontWeight: 600 }}>{STATE_INFO[editState].label}</span>
            <button
              onClick={() => store.setPreviewState(activePreviewState === editState ? 'normal' : editState)}
              style={{ fontSize: 10, background: activePreviewState === editState ? 'var(--bld-accent-hover)' : 'none', border: '1px solid var(--bld-border-subtle)', borderRadius: 3, color: 'var(--bld-text-3)', padding: '2px 6px', cursor: 'pointer' }}
            >
              {activePreviewState === editState ? '● Previewing' : '▶ Preview'}
            </button>
          </div>
          <Field label="Class name override">
            <AutocompleteInput
              value={stateOverrides[editState]?.className ?? ''}
              onChange={v => updateOverride(editState, { className: v })}
              context="text"
              placeholder="bg-red-500 text-white"
            />
          </Field>
          {editState === 'custom' && (
            <Field label="Show when">
              <ExprBuilder
                value={stateOverrides[editState]?.condition ?? null}
                onChange={v => updateOverride(editState, { condition: v as object })}
                context="condition"
              />
            </Field>
          )}
          <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>{STATE_INFO[editState].description}</div>
        </div>
      )}
    </div>
  );
}

// ─── 3. VARIANTS ─────────────────────────────────────────────────────────────

interface VariantDef { id: string; name: string; condition: object | null; }

function VariantsSection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const variants = ((node as unknown as { _variants?: VariantDef[] })._variants ?? []) as VariantDef[];
  const [enabled, setEnabled] = useState(variants.length > 0);

  const toggle = (on: boolean) => {
    setEnabled(on);
    if (!on) store.patchVariant(node.id!, null);
  };

  const addVariant = () => {
    const newVariants: VariantDef[] = [...variants, { id: `v-${Date.now()}`, name: `Variant ${variants.length + 1}`, condition: null }];
    store.patchVariant(node.id!, newVariants);
  };

  const updateVariant = (id: string, patch: Partial<VariantDef>) => {
    const updated = variants.map(v => v.id === id ? { ...v, ...patch } : v);
    store.patchVariant(node.id!, updated);
  };

  const removeVariant = (id: string) => {
    const updated = variants.filter(v => v.id !== id);
    store.patchVariant(node.id!, updated.length ? updated : null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Toggle value={enabled} onChange={toggle} label="Enable variants" />
      {enabled && (
        <>
          {variants.length === 0 && <Empty text="No variants yet — add a variant to conditionally render different UI" />}
          {variants.map((v, i) => (
            <div key={v.id} style={{ background: 'var(--bld-bg-input)', borderRadius: 5, padding: 8, border: '1px solid var(--bld-border-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: i === 0 ? 'var(--bld-warning)' : 'var(--bld-accent)', fontWeight: 600, width: 32 }}>
                  {i === variants.length - 1 && !variants[i].condition ? 'ELSE' : i === 0 ? 'IF' : 'ELIF'}
                </span>
                <input
                  value={v.name}
                  onChange={e => updateVariant(v.id, { name: e.target.value })}
                  style={{ ...INPUT, flex: 1 }}
                />
                <button onClick={() => removeVariant(v.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-error)', fontSize: 12 }}>×</button>
              </div>
              {i < variants.length - 1 && (
                <ExprBuilder
                  value={v.condition}
                  onChange={val => updateVariant(v.id, { condition: val as object | null })}
                  context="condition"
                  label="Show when"
                />
              )}
            </div>
          ))}
          <button
            onClick={addVariant}
            style={{ background: 'none', border: '1px dashed var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-disabled)', fontSize: 11, padding: '4px 8px', cursor: 'pointer', alignSelf: 'flex-start' }}
          >
            + Add variant
          </button>
        </>
      )}
    </div>
  );
}

// ─── 4. VISIBILITY ────────────────────────────────────────────────────────────

function VisibilitySection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const condition = node.condition ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!condition && <Empty text="Element always visible — add a condition to control when it shows" />}
      <ExprBuilder
        value={condition as object | null}
        onChange={v => {
          if (v === null) store.patchCondition(node.id!, null);
          else store.patchCondition(node.id!, v as object);
        }}
        context="condition"
        label="Show when"
      />
      {condition && (
        <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>
          <button
            onClick={() => store.patchCondition(node.id!, null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-error)', fontSize: 10, padding: 0 }}
          >
            Remove condition
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 5. DATA SOURCE ───────────────────────────────────────────────────────────

function DataSourceSection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const ds = (node as unknown as { dataSource?: Record<string, unknown> }).dataSource;
  const [enabled, setEnabled] = useState(!!ds);
  const [type, setType] = useState<'rest' | 'graphql'>((ds?.query ? 'graphql' : 'rest') as 'rest' | 'graphql');
  const [url, setUrl] = useState((ds?.url as string) ?? '');
  const [method, setMethod] = useState((ds?.method as string) ?? 'GET');
  const [storeIn, setStoreIn] = useState((ds?.key as string) ?? '');
  const [responsePath, setResponsePath] = useState((ds?.responsePath as string) ?? '');
  const [query, setQuery] = useState((ds?.query as string) ?? '');
  const [endpoint, setEndpoint] = useState((ds?.endpoint as string) ?? '');
  const [dependsOn, setDependsOn] = useState((ds?.dependsOn as string) ?? '');
  const [condition, setCondition] = useState<object | null>((ds?.when as object) ?? null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const save = useCallback(() => {
    if (type === 'rest') {
      store.patchDataSource(node.id!, { url, method, key: storeIn, dependsOn: dependsOn || undefined, when: condition ?? undefined });
    } else {
      store.patchDataSource(node.id!, { query, endpoint: endpoint || undefined, key: storeIn, responsePath: responsePath || undefined, dependsOn: dependsOn || undefined, when: condition ?? undefined });
    }
  }, [store, node.id, type, url, method, storeIn, query, endpoint, dependsOn, condition, responsePath]);

  const testRequest = async () => {
    setTesting(true);
    try {
      const res = await fetch(url);
      const data = await res.json();
      setTestResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setTestResult(`Error: ${String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const toggle = (on: boolean) => {
    setEnabled(on);
    if (!on) store.patchDataSource(node.id!, null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Toggle value={enabled} onChange={toggle} label="Enable data source" />
      {enabled && (
        <>
          <Field label="Type">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['rest', 'graphql'] as const).map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--bld-text-2)', cursor: 'pointer' }}>
                  <input type="radio" checked={type === t} onChange={() => setType(t)} style={{ accentColor: 'var(--bld-accent)' }} />
                  {t === 'rest' ? 'REST' : 'GraphQL'}
                </label>
              ))}
            </div>
          </Field>

          {type === 'rest' ? (
            <>
              <Field label="URL">
                <AutocompleteInput value={url} onChange={setUrl} context="text" placeholder="https://api.example.com/products" />
              </Field>
              <Field label="Method">
                <select value={method} onChange={e => setMethod(e.target.value)} style={SELECT}>
                  {['GET','POST','PUT','PATCH','DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Endpoint (blank = engineConventions default)">
                <input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://…/graphql" style={INPUT} />
              </Field>
              <Field label="Query">
                <AutocompleteInput value={query} onChange={setQuery} context="general" multiline placeholder="query GetProducts { products { id name } }" />
              </Field>
            </>
          )}

          <Field label="Store in">
            <PathPicker value={storeIn} onChange={setStoreIn} placeholder="store.products" />
          </Field>
          {type === 'graphql' && (
            <Field label="Response path">
              <input value={responsePath} onChange={e => setResponsePath(e.target.value)} placeholder="data.products" style={INPUT} />
            </Field>
          )}
          <Field label="Refetch when path changes">
            <PathPicker value={dependsOn} onChange={setDependsOn} placeholder="(optional)" />
          </Field>
          <Field label="Fetch only when">
            <ExprBuilder value={condition} onChange={v => setCondition(v as object | null)} context="condition" />
          </Field>

          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={save} style={{ background: 'var(--bld-accent-hover)', border: 'none', borderRadius: 4, color: 'var(--bld-accent-fg)', fontSize: 11, padding: '5px 10px', cursor: 'pointer' }}>
              Save
            </button>
            {type === 'rest' && url && (
              <button onClick={testRequest} disabled={testing} style={{ background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-3)', fontSize: 11, padding: '5px 10px', cursor: 'pointer' }}>
                {testing ? '…' : '▶ Test request'}
              </button>
            )}
          </div>

          {testResult && (
            <div style={{ background: 'var(--bld-bg-base)', borderRadius: 4, padding: 8, border: '1px solid var(--bld-border-subtle)' }}>
              <div style={{ fontSize: 9, color: 'var(--bld-text-disabled)', marginBottom: 4 }}>Response preview</div>
              <pre style={{ fontSize: 10, color: 'var(--bld-success)', margin: 0, overflow: 'auto', maxHeight: 160, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {testResult.length > 2000 ? testResult.slice(0, 2000) + '\n…(truncated)' : testResult}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── 6. INTERACTIONS ─────────────────────────────────────────────────────────

function InteractionsSection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const nodeActions = (node.actions as Record<string, unknown> | undefined) ?? null;
  const events = useMemo(() => eventsForNodeType(node.type), [node.type]);
  const isInMap = !!(node as unknown as { map?: string }).map;

  return (
    <ActionBuilder
      value={nodeActions}
      onChange={actions => store.patchActions(node.id!, actions)}
      availableEvents={events}
      inMapContext={isInMap}
    />
  );
}

// ─── 7. DISABLED ─────────────────────────────────────────────────────────────

function DisabledSection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const disabled = (node.props as Record<string, unknown> | undefined)?.disabled;
  const condition = typeof disabled === 'object' && disabled !== null && 'formula' in disabled
    ? (disabled as { formula: object }).formula
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!condition && <Empty text="Element always enabled — add a condition to disable it" />}
      <ExprBuilder
        value={condition}
        onChange={v => {
          if (!v) store.patchProp(node.id!, 'props.disabled', undefined);
          else store.patchProp(node.id!, 'props.disabled', { formula: v });
        }}
        context="condition"
        label="Disable when"
      />
    </div>
  );
}

// ─── 8. REPEAT / LIST ────────────────────────────────────────────────────────

function RepeatSection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const mapPath = node.map ?? '';
  const keyField = node.key ?? '';
  const [mode, setMode] = useState<'all' | 'paginate' | 'infinite'>('all');
  const [pageSize, setPageSize] = useState(12);
  const [skipPath, setSkipPath] = useState('collectionSkip');
  const [fetchAction, setFetchAction] = useState('');
  const [totalPath, setTotalPath] = useState('');
  const [appendPath, setAppendPath] = useState('');
  const [hasMorePath, setHasMorePath] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!mapPath && <Empty text="No repeat — element renders once. Set a data path to repeat." />}
      <Field label="Repeat over">
        <PathPicker value={mapPath} onChange={v => store.patchMap(node.id!, v || null, keyField)} />
      </Field>
      <Field label="Key field">
        <input value={keyField} onChange={e => store.patchMap(node.id!, mapPath, e.target.value)} placeholder="id" style={INPUT} />
      </Field>

      {mapPath && (
        <>
          <Field label="List mode">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['all', 'paginate', 'infinite'] as const).map(m => (
                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--bld-text-2)', cursor: 'pointer' }}>
                  <input type="radio" checked={mode === m} onChange={() => setMode(m)} style={{ accentColor: 'var(--bld-accent)' }} />
                  {m === 'all' ? 'All' : m === 'paginate' ? 'Paginate' : 'Infinite scroll'}
                </label>
              ))}
            </div>
          </Field>

          {mode === 'paginate' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bld-bg-input)', borderRadius: 4, padding: 8 }}>
              <Field label="Page size">
                <input type="number" value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{ ...INPUT, width: 80 }} />
              </Field>
              <Field label="Skip/offset path">
                <PathPicker value={skipPath} onChange={setSkipPath} />
              </Field>
              <Field label="Fetch action">
                <input value={fetchAction} onChange={e => setFetchAction(e.target.value)} placeholder="fetchCollection" style={INPUT} />
              </Field>
              <Field label="Total count path">
                <PathPicker value={totalPath} onChange={setTotalPath} placeholder="collection.total" />
              </Field>
            </div>
          )}

          {mode === 'infinite' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bld-bg-input)', borderRadius: 4, padding: 8 }}>
              <Field label="Fetch more action">
                <input value={fetchAction} onChange={e => setFetchAction(e.target.value)} placeholder="fetchMore" style={INPUT} />
              </Field>
              <Field label="Append path">
                <PathPicker value={appendPath} onChange={setAppendPath} placeholder="store.items" />
              </Field>
              <Field label="Has more path">
                <PathPicker value={hasMorePath} onChange={setHasMorePath} placeholder="store.hasMore" />
              </Field>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── 9. FORM & VALIDATION ────────────────────────────────────────────────────

const FORM_TYPES = new Set(['Form']);
const INPUT_TYPES = new Set(['Input', 'Textarea', 'TextareaInput', 'Select']);

function FormSection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const isForm = FORM_TYPES.has(node.type);
  const isInput = INPUT_TYPES.has(node.type);

  const [formPath, setFormPath] = useState('');
  const [bindPath, setBindPath] = useState('');
  const [errorPath, setErrorPath] = useState('');
  const [rules, setRules] = useState<Array<{ type: string; value: string; message: string }>>([]);

  if (!isForm && !isInput) {
    return <Empty text="Select a Form or Input node to configure form binding and validation" />;
  }

  if (isForm) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Field label="Form path">
          <PathPicker value={formPath} onChange={setFormPath} placeholder="screens.checkout.form" />
        </Field>
        <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>
          On Submit — configure in the <strong style={{ color: 'var(--bld-text-2)' }}>Interactions</strong> section
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Field label="Bind to">
        <PathPicker value={bindPath} onChange={v => {
          setBindPath(v);
          if (!errorPath) setErrorPath(v.replace('form.', 'errors.form.'));
        }} placeholder="screens.checkout.form.email" />
      </Field>
      {bindPath && (
        <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>
          Auto-generates onChange → setState action
        </div>
      )}
      <div style={{ borderTop: `1px solid ${BORDER_COLOR}`, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={LABEL}>Validation</span>
        {rules.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--bld-bg-input)', borderRadius: 4, padding: '4px 6px' }}>
            <select value={r.type} onChange={e => setRules(rules.map((x, xi) => xi === i ? { ...x, type: e.target.value } : x))} style={{ ...SELECT, flex: 1 }}>
              <option value="required">Required</option>
              <option value="minLength">Min length</option>
              <option value="maxLength">Max length</option>
              <option value="pattern">Pattern</option>
              <option value="equalsField">Equals field</option>
            </select>
            <input value={r.value} onChange={e => setRules(rules.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x))} placeholder="value" style={{ ...INPUT, flex: 1 }} />
            <input value={r.message} onChange={e => setRules(rules.map((x, xi) => xi === i ? { ...x, message: e.target.value } : x))} placeholder="Error message" style={{ ...INPUT, flex: 2 }} />
            <button onClick={() => setRules(rules.filter((_, xi) => xi !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-error)', fontSize: 12 }}>×</button>
          </div>
        ))}
        <button onClick={() => setRules([...rules, { type: 'required', value: '', message: 'Required' }])} style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-disabled)', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>
          + Add rule
        </button>
      </div>
      <Field label="Error display path">
        <PathPicker value={errorPath} onChange={setErrorPath} placeholder="screens.checkout.errors.form.email" />
      </Field>
    </div>
  );
}

// ─── 10. STEPPER ─────────────────────────────────────────────────────────────

interface StepDef { id: string; name: string; condition: object | null; }

function StepperSection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const stepperConfig = (node as unknown as { _stepper?: { currentStepPath: string; steps: StepDef[] } })._stepper;
  const [enabled, setEnabled] = useState(!!stepperConfig);
  const [currentStepPath, setCurrentStepPath] = useState(stepperConfig?.currentStepPath ?? '');
  const [steps, setSteps] = useState<StepDef[]>(stepperConfig?.steps ?? []);

  const toggle = (on: boolean) => {
    setEnabled(on);
    if (!on) store.patchNodeField(node.id!, '_stepper', null);
  };

  const saveConfig = () => {
    store.patchNodeField(node.id!, '_stepper', { currentStepPath, steps });
  };

  const addStep = () => setSteps([...steps, { id: `step-${Date.now()}`, name: `Step ${steps.length + 1}`, condition: null }]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!enabled && (
        <Empty
          text="Not enabled"
          hint="Enable to create a multi-step flow (e.g. checkout). Each step maps a name to an optional show-condition. Set a store path like screens.checkout.currentStep to track which step is active."
        />
      )}
      <Toggle value={enabled} onChange={toggle} label="Enable stepper" />
      {enabled && (
        <>
          <Field label="Current step path">
            <PathPicker value={currentStepPath} onChange={setCurrentStepPath} placeholder="store.currentStep" />
          </Field>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={LABEL}>Steps</span>
            {steps.map((step, i) => (
              <div key={step.id} style={{ background: 'var(--bld-bg-input)', borderRadius: 4, padding: 8, border: '1px solid var(--bld-border-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', width: 20 }}>{i + 1}.</span>
                  <input value={step.name} onChange={e => setSteps(steps.map(s => s.id === step.id ? { ...s, name: e.target.value } : s))} style={{ ...INPUT, flex: 1 }} />
                  <button onClick={() => setSteps(steps.filter(s => s.id !== step.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-error)', fontSize: 12 }}>×</button>
                </div>
              </div>
            ))}
            <button onClick={addStep} style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-disabled)', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>
              + Add step
            </button>
          </div>
          <button onClick={saveConfig} style={{ background: 'var(--bld-accent-hover)', border: 'none', borderRadius: 4, color: 'var(--bld-accent-fg)', fontSize: 11, padding: '5px 10px', cursor: 'pointer', alignSelf: 'flex-start' }}>
            Save
          </button>
        </>
      )}
    </div>
  );
}

// ─── 11. DIRTY TRACKING ──────────────────────────────────────────────────────

function DirtySection({ node }: { node: SDUINode }) {
  const store = useBuilderStore();
  const dirtyConfig = (node as unknown as { _dirty?: { path: string; resetOn: string } })._dirty;
  const [enabled, setEnabled] = useState(!!dirtyConfig);
  const [path, setPath] = useState(dirtyConfig?.path ?? '');
  const [resetOn, setResetOn] = useState<'submit' | 'navigate'>(dirtyConfig?.resetOn as 'submit' ?? 'submit');

  const toggle = (on: boolean) => {
    setEnabled(on);
    if (!on) store.patchNodeField(node.id!, '_dirty', null);
  };

  const save = () => store.patchNodeField(node.id!, '_dirty', { path, resetOn });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!enabled && (
        <Empty
          text="Not enabled"
          hint='Enable to track whether a form has unsaved changes. Set a path like screens.signUp.isDirty. Your actions can read this path to warn the user before navigating away or to enable/disable a "Save" button.'
        />
      )}
      <Toggle value={enabled} onChange={toggle} label="Track dirty state" />
      {enabled && (
        <>
          <Field label="Dirty path">
            <PathPicker value={path} onChange={setPath} placeholder="screens.checkout.isDirty" />
          </Field>
          <Field label="Reset on">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['submit', 'navigate'] as const).map(r => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--bld-text-2)', cursor: 'pointer' }}>
                  <input type="radio" checked={resetOn === r} onChange={() => setResetOn(r)} style={{ accentColor: 'var(--bld-accent)' }} />
                  {r === 'submit' ? 'Submit success' : 'Navigate'}
                </label>
              ))}
            </div>
          </Field>
          <button onClick={save} style={{ background: 'var(--bld-accent-hover)', border: 'none', borderRadius: 4, color: 'var(--bld-accent-fg)', fontSize: 11, padding: '5px 10px', cursor: 'pointer', alignSelf: 'flex-start' }}>
            Save
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main LogicPanel ──────────────────────────────────────────────────────────

interface LogicPanelProps {
  node: SDUINode;
}

export function LogicPanel({ node }: LogicPanelProps) {
  const { activeLogicSection, openLogicSection } = useBuilderStore();

  useEffect(() => {
    if (activeLogicSection) {
      const el = document.querySelector(`[data-logic-section="${activeLogicSection}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      openLogicSection(null);
    }
  }, [activeLogicSection, openLogicSection]);

  const hasActions = !!(node.actions && Object.keys(node.actions).length > 0);
  const hasStates  = !!(node as unknown as { _stateOverrides?: Record<string, unknown> })._stateOverrides;

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: SECTION_BG }}>
      {!hasActions && (
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${BORDER_COLOR}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', fontWeight: 500 }}>No interactions yet</div>
          <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', lineHeight: 1.6 }}>
            Use <span style={{ color: 'var(--bld-accent)' }}>Interactions</span> to wire events to actions.
            Define reusable <span style={{ color: 'var(--bld-accent)' }}>Workflows</span> and{' '}
            <span style={{ color: 'var(--bld-warning)' }}>Global Formulas</span> in the <span style={{ color: 'var(--bld-text-2)' }}>Vars</span> tab on the left.
          </div>
        </div>
      )}

      {/* 1. Interactions */}
      <Section id="interactions" title="Interactions" defaultOpen={hasActions} hasValue={hasActions}
        badge={hasActions ? `${Object.keys(node.actions ?? {}).length} event${Object.keys(node.actions ?? {}).length === 1 ? '' : 's'}` : undefined}
        badgeColor="var(--bld-accent)">
        <InteractionsSection node={node} />
      </Section>

      {/* 2. Component States */}
      <Section id="states" title="Component States" hasValue={hasStates}>
        <ComponentStatesSection node={node} />
      </Section>
    </div>
  );
}

// ─── Workflows section ────────────────────────────────────────────────────────

function WorkflowsSection() {
  const { pageWorkflows, pageWorkflowMeta, setPageWorkflow, removePageWorkflow } = useBuilderStore();
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filter out system workflows and trigger workflows (those belong to the Triggers tab)
  const entries = Object.entries(pageWorkflows)
    .filter(([id]) => !pageWorkflowMeta[id]?.isSystem && !pageWorkflowMeta[id]?.isTrigger);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>
        Named action sequences you can reference from any interaction with <code style={{ color: 'var(--bld-accent)' }}>workflow: "name"</code>.
      </div>

      {entries.length === 0 && <Empty text="No workflows defined — add one below." />}

      {entries.map(([name, actions]) => (
        <div key={name} style={{ background: 'var(--bld-bg-input)', borderRadius: 5, border: '1px solid var(--bld-border-subtle)', overflow: 'hidden' }}>
          <button
            onClick={() => setExpanded(e => e === name ? null : name)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>{expanded === name ? (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>) : (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transform:"rotate(-90deg)"}}><polyline points="6 9 12 15 18 9"/></svg>)}</span>
            <span style={{ fontSize: 11, color: 'var(--bld-accent)', fontWeight: 600, flex: 1, textAlign: 'left' }}>{name}</span>
            <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)' }}>{actions.length} step{actions.length !== 1 ? 's' : ''}</span>
            <button onClick={e => { e.stopPropagation(); removePageWorkflow(name); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-error)', fontSize: 12, padding: '0 2px' }}>×</button>
          </button>
          {expanded === name && (
            <div style={{ borderTop: '1px solid var(--bld-border-subtle)', padding: '8px 10px' }}>
              <ActionBuilder
                value={actions.reduce<Record<string, unknown[]>>((acc, a) => {
                  (acc['run'] ??= []).push(a);
                  return acc;
                }, {})}
                onChange={v => setPageWorkflow(name, Object.values(v ?? {}).flat() as object[])}
                availableEvents={['run']}
              />
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="workflow name…"
          onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { setPageWorkflow(newName.trim(), []); setNewName(''); } }}
          style={{ flex: 1, background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '4px 7px', outline: 'none' }}
        />
        <button
          onClick={() => { if (newName.trim()) { setPageWorkflow(newName.trim(), []); setNewName(''); } }}
          style={{ padding: '4px 12px', background: 'var(--bld-accent-hover)', border: 'none', borderRadius: 4, color: 'var(--bld-accent-fg)', fontSize: 11, cursor: 'pointer' }}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

// ─── Global Formulas section ──────────────────────────────────────────────────

function GlobalFormulasSection() {
  const { globalFormulas, setGlobalFormula, removeGlobalFormula } = useBuilderStore();
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const entries = Object.entries(globalFormulas);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>
        Named JSON Logic expressions usable anywhere as <code style={{ color: 'var(--bld-warning)' }}>{`{{formula.name}}`}</code>.
      </div>

      {entries.length === 0 && <Empty text="No formulas defined — add one below." />}

      {entries.map(([name, expr]) => (
        <div key={name} style={{ background: 'var(--bld-bg-input)', borderRadius: 5, border: '1px solid var(--bld-border-subtle)', overflow: 'hidden' }}>
          <button
            onClick={() => setExpanded(e => e === name ? null : name)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>{expanded === name ? (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>) : (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0,transform:"rotate(-90deg)"}}><polyline points="6 9 12 15 18 9"/></svg>)}</span>
            <span style={{ fontSize: 11, color: 'var(--bld-warning)', fontWeight: 600, flex: 1, textAlign: 'left' }}>{name}</span>
            <button onClick={e => { e.stopPropagation(); removeGlobalFormula(name); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-error)', fontSize: 12, padding: '0 2px' }}>×</button>
          </button>
          {expanded === name && (
            <div style={{ borderTop: '1px solid var(--bld-border-subtle)', padding: '8px 10px' }}>
              <ExprBuilder
                value={expr as object | null}
                onChange={v => setGlobalFormula(name, v as import('./_store-types').GlobalFormulaDef)}
              />
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="formula name…"
          onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { setGlobalFormula(newName.trim(), { name: newName.trim(), params: [], formula: '' }); setNewName(''); } }}
          style={{ flex: 1, background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '4px 7px', outline: 'none' }}
        />
        <button
          onClick={() => { if (newName.trim()) { setGlobalFormula(newName.trim(), { name: newName.trim(), params: [], formula: '' }); setNewName(''); } }}
          style={{ padding: '4px 12px', background: 'var(--bld-accent-hover)', border: 'none', borderRadius: 4, color: 'var(--bld-accent-fg)', fontSize: 11, cursor: 'pointer' }}
        >
          + Add
        </button>
      </div>
    </div>
  );
}
