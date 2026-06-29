'use client';
/**
 * Models Designer — the schema source of truth.
 *
 * A model is authored here; saving runs the backend migration engine which
 * creates/alters the physical table (model -> table, field -> column). Field
 * ids are stable across renames so the engine emits ALTER ... RENAME COLUMN
 * instead of drop+add. Destructive migrations require explicit confirmation.
 *
 * Layout: model list (left) | tabs [Fields | Config | Seeds] (center)
 * | field editor drawer (right, when editing a field).
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  backendModels, backendEnums, backendSeeds,
  type ModelDefinitionJson, type ModelFieldJson, type ModelEnumJson,
  type ModelRelationKind, type BackendWorkflow,
} from '@/lib/platform/api-client';
import { useBackendConfig, patchCachedModels } from '@/lib/builder/use-backend-config';
import { EmptyModels } from './_icons';
import { useBuilderStore } from './_store';
import type { DataSourceConfig } from './_store-types';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_TYPES = ['text', 'int', 'bigint', 'decimal', 'float', 'bool', 'json', 'uuid', 'timestamp', 'date', 'file', 'enum', 'money', 'relation'] as const;
const RELATION_KINDS: ModelRelationKind[] = ['manyToOne', 'oneToMany', 'oneToOne', 'manyToMany'];
const ON_DELETE = ['cascade', 'setNull', 'restrict', 'noAction'] as const;
const HOOK_EVENTS = ['beforeCreate', 'afterCreate', 'beforeUpdate', 'afterUpdate', 'beforeDelete', 'afterDelete'] as const;
const TRIGGER_EVENTS = ['onCreate', 'onUpdate', 'onDelete'] as const;
const ACCESS_OPS = ['list', 'read', 'create', 'update', 'delete', '*'] as const;

type Tab = 'fields' | 'config' | 'seeds';

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}
function newId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const BTN: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, fontWeight: 500,
  background: 'transparent', color: 'var(--bld-text-3)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
};
const BTN_PRIMARY: React.CSSProperties = { ...BTN, background: 'var(--bld-accent-hover)', color: '#fff', border: '1px solid #4f46e5', fontWeight: 600 };
const INPUT: React.CSSProperties = {
  background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6,
  padding: '7px 10px', fontSize: 13, color: 'var(--bld-text-2)', outline: 'none', width: '100%', boxSizing: 'border-box',
};
const SELECT: React.CSSProperties = { ...INPUT, cursor: 'pointer' };
const LABEL: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 6 };
const SECTION_TITLE: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--bld-text-disabled)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '20px 0 10px' };

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: 36, height: 20, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
      background: on ? 'var(--bld-accent)' : 'var(--bld-bg-elevated)', transition: 'background 0.15s',
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
    </button>
  );
}

function ToggleRow({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '6px 0' }} onClick={() => onChange(!on)}>
      <span>
        <span style={{ fontSize: 13, color: 'var(--bld-text-2)' }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)', display: 'block' }}>{hint}</span>}
      </span>
      <Toggle on={on} onClick={() => onChange(!on)} />
    </label>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

interface Props { projectId: string }

export function ModelsDesigner({ projectId }: Props) {
  // Use the shared backend config cache — one request for all panels.
  const { models, enums, workflows, loading } = useBackendConfig(projectId);

  const [search, setSearch] = useState('');

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelDefinitionJson | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('fields');

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [creating, setCreating] = useState(false);
  const [newModelName, setNewModelName] = useState('');

  const addPageDataSource = useBuilderStore((s) => s.addPageDataSource);

  const selectModel = (m: ModelDefinitionJson) => {
    setSelectedName(m.name);
    setDraft(JSON.parse(JSON.stringify(m)));
    setDirty(false);
    setEditingFieldId(null);
    setTab('fields');
    setError(''); setNotice('');
  };

  const patchDraft = (patch: Partial<ModelDefinitionJson>) => {
    setDraft((d) => d ? { ...d, ...patch } : d);
    setDirty(true);
  };

  const middlewareWfs = workflows.filter((w) => w.kind === 'MIDDLEWARE');
  const functionWfs = workflows.filter((w) => w.kind === 'FUNCTION');

  // ── Save (with destructive confirm) ──────────────────────────────────────────
  const save = async (confirmDestructive = false) => {
    if (!draft) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const res = await backendModels.upsert(projectId, draft, confirmDestructive);
      const warn = res.migration?.warnings ?? [];
      setNotice(warn.length ? `Saved. Warnings: ${warn.join('; ')}` : 'Saved & migrated.');
      patchCachedModels(projectId, (prev) => {
        const exists = prev.some((m) => m.name === res.model.name);
        return exists ? prev.map((m) => m.name === res.model.name ? res.model : m) : [...prev, res.model];
      });
      setDirty(false);
    } catch (e) {
      const err = e as Error & { code?: string; status?: number };
      if (err.code === 'DESTRUCTIVE' || err.status === 409) {
        if (confirm(`This change is destructive:\n\n${err.message}\n\nApply anyway? Data in dropped columns/tables will be lost.`)) {
          await save(true);
          return;
        }
        setError('Save cancelled (destructive change).');
      } else {
        setError(err.message);
      }
    } finally { setSaving(false); }
  };

  // After createModel, auto-select the new model once the config reloads.
  const [pendingSelectName, setPendingSelectName] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingSelectName) return;
    const created = models.find((m) => m.name === pendingSelectName);
    if (created) { selectModel(created); setPendingSelectName(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, pendingSelectName]);

  const createModel = async () => {
    const name = newModelName.trim();
    if (!name) return;
    const def: ModelDefinitionJson = { id: newId(), name, table: camelToSnake(name), timestamps: true, fields: [] };
    setSaving(true); setError('');
    try {
      const created = await backendModels.upsert(projectId, def);
      patchCachedModels(projectId, (prev) => [...prev, created.model]);
      setPendingSelectName(name);
      setNewModelName(''); setCreating(false);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const deleteModel = async () => {
    if (!draft) return;
    if (!confirm(`Delete model "${draft.name}" and DROP its table + all data? This cannot be undone.`)) return;
    try {
      await backendModels.delete(projectId, draft.name, true);
      patchCachedModels(projectId, (prev) => prev.filter((m) => m.name !== draft.name));
      setSelectedName(null); setDraft(null);
    } catch (e) { setError((e as Error).message); }
  };

  const createDatasource = () => {
    if (!draft) return;
    const cfg: DataSourceConfig = {
      id: newId(),
      name: `${draft.name} (model)`,
      type: 'rest',
      url: `/api/db/${projectId}/${draft.name}`,
      method: 'GET',
      storeIn: draft.name,
      proxy: false,
      sendCredentials: true,
      trigger: 'mount',
    };
    addPageDataSource(cfg);
    setNotice(`Datasource "${cfg.name}" created → bind pages to it in the Data tab (stores in ${draft.name}).`);
  };

  // ── Field ops ────────────────────────────────────────────────────────────────
  const addField = () => {
    if (!draft) return;
    const f: ModelFieldJson = { id: newId(), name: '', type: 'text' };
    patchDraft({ fields: [...(draft.fields ?? []), f] });
    setEditingFieldId(f.id);
  };
  const updateField = (id: string, patch: Partial<ModelFieldJson>) => {
    if (!draft) return;
    patchDraft({ fields: (draft.fields ?? []).map((f) => f.id === id ? { ...f, ...patch } : f) });
  };
  const removeField = (id: string) => {
    if (!draft) return;
    patchDraft({ fields: (draft.fields ?? []).filter((f) => f.id !== id) });
    if (editingFieldId === id) setEditingFieldId(null);
  };

  const filteredModels = models.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));
  const editingField = draft?.fields?.find((f) => f.id === editingFieldId) ?? null;

  return (
    <div style={{
      flex: 1, display: 'flex', height: '100%', overflow: 'hidden', position: 'relative',
    }}>
      {/* ── Left sidebar: model list ───────────────────────────────────────── */}
      <div style={{
        width: 240, borderRight: '1px solid var(--bld-bg-elevated)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        backgroundColor: 'var(--bld-bg-panel)',
        backgroundImage: 'radial-gradient(ellipse 160% 40% at 50% 100%, rgba(99,102,241,0.07) 0%, transparent 60%)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 14px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--bld-glass-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2"/>
              <line x1="2" y1="7" x2="14" y2="7"/>
              <line x1="2" y1="11" x2="14" y2="11"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--bld-text-2)', letterSpacing: 0.3 }}>Models</span>
            {models.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', background: 'var(--bld-bg-elevated)', borderRadius: 10, padding: '1px 7px' }}>
                {models.length}
              </span>
            )}
          </div>
          <button onClick={() => setCreating((v) => !v)} style={{ ...BTN_PRIMARY, padding: '4px 10px', fontSize: 11, gap: 4 }}>
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
            Add
          </button>
        </div>

        {/* New model form */}
        {creating && (
          <div style={{ padding: 12, borderBottom: '1px solid var(--bld-bg-elevated)', background: 'rgba(79,70,229,0.06)' }}>
            <input autoFocus value={newModelName} onChange={(e) => setNewModelName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void createModel(); if (e.key === 'Escape') setCreating(false); }}
              placeholder="ModelName" style={{ ...INPUT, fontSize: 12, padding: '6px 10px' }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => void createModel()} disabled={!newModelName.trim() || saving}
                style={{ ...BTN_PRIMARY, flex: 1, justifyContent: 'center', fontSize: 11 }}>Create</button>
              <button onClick={() => setCreating(false)} style={{ ...BTN, padding: '5px 10px', fontSize: 11 }}>✕</button>
            </div>
          </div>
        )}

        {/* Search */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
          <div style={{ position: 'relative' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--bld-text-disabled)" strokeWidth="1.8" strokeLinecap="round" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }}>
              <circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search models…"
              style={{ ...INPUT, fontSize: 11, padding: '5px 8px 5px 28px' }} />
          </div>
        </div>

        {/* Model list */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--bld-text-disabled)' }}>Loading…</div>
          )}
          {!loading && models.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <EmptyModels />
              <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>No models yet.<br />Click <strong style={{ color: 'var(--bld-text-3)' }}>+ Add</strong> to create one.</div>
            </div>
          )}
          {filteredModels.map((m) => {
            const active = m.name === selectedName;
            return (
              <div key={m.id ?? m.name} onClick={() => selectModel(m)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer',
                background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                borderLeft: `2px solid ${active ? 'var(--bld-accent)' : 'transparent'}`,
                transition: 'background 0.12s',
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={active ? 'var(--bld-accent)' : 'var(--bld-text-disabled)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect x="2" y="2" width="12" height="12" rx="2"/>
                  <line x1="2" y1="7" x2="14" y2="7"/>
                </svg>
                <span style={{ flex: 1, fontSize: 12, color: active ? '#e2e8f0' : 'var(--bld-text-3)', fontWeight: active ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}
                </span>
                <span style={{
                  fontSize: 10, color: active ? 'var(--bld-accent)' : 'var(--bld-text-disabled)',
                  background: active ? 'rgba(99,102,241,0.15)' : 'var(--bld-bg-elevated)',
                  borderRadius: 8, padding: '1px 6px', flexShrink: 0,
                }}>
                  {(m.fields ?? []).length}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Center: model editor ────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bld-bg-canvas)', backgroundImage: 'radial-gradient(ellipse 70% 45% at 85% 8%, rgba(99,102,241,0.08) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 10% 95%, rgba(124,58,237,0.07) 0%, transparent 55%)' }}>
        {!draft && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
              boxShadow: '0 0 32px rgba(99,102,241,0.12)',
            }}>
              <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="2"/>
                <line x1="2" y1="7" x2="14" y2="7"/>
                <line x1="2" y1="11" x2="14" y2="11"/>
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--bld-text-2)', marginBottom: 6 }}>Select a model</div>
              <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)', maxWidth: 280, lineHeight: 1.6 }}>
                Choose a model from the list or create a new one. Physical database tables are generated from models.
              </div>
            </div>
          </div>
        )}
        {draft && (
          <>
            {/* Glass header */}
            <div style={{
              padding: '11px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
              background: 'var(--bld-glass-bg)', backdropFilter: 'blur(12px)',
              borderBottom: '1px solid var(--bld-glass-border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--bld-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{draft.name}</span>
                <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)', background: 'var(--bld-bg-elevated)', borderRadius: 5, padding: '2px 8px', flexShrink: 0 }}>
                  {draft.table}
                </span>
                {dirty && (
                  <span style={{ fontSize: 10, color: 'var(--bld-warning, #f59e0b)', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}/>unsaved
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => void save()} disabled={saving || !dirty}
                  style={{ ...BTN_PRIMARY, opacity: saving || !dirty ? 0.5 : 1, gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 8 5 12 15 3"/></svg>
                  {saving ? 'Saving…' : 'Save & migrate'}
                </button>
                <button onClick={createDatasource} title="Create a REST datasource bound to this model" style={{ ...BTN, gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8" cy="8" r="5"/><line x1="8" y1="5" x2="8" y2="11"/><line x1="5" y1="8" x2="11" y2="8"/></svg>
                  Datasource
                </button>
                <button onClick={() => void deleteModel()} title="Delete model"
                  style={{ ...BTN, color: 'var(--bld-error)', borderColor: 'rgba(239,68,68,0.25)', padding: '5px 9px' }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2 5 4 5 14 5"/><path d="M6 5V3h4v2"/><path d="M5 5l1 8h4l1-8"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--bld-bg-elevated)', flexShrink: 0, background: 'var(--bld-bg-canvas)', paddingLeft: 20 }}>
              {(['fields', 'config', 'seeds'] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)} style={{
                  padding: '9px 16px', fontSize: 12, cursor: 'pointer', background: 'transparent', border: 'none',
                  borderBottom: `2px solid ${tab === t ? 'var(--bld-accent)' : 'transparent'}`,
                  color: tab === t ? 'var(--bld-text-1)' : 'var(--bld-text-3)', fontWeight: tab === t ? 600 : 400,
                  textTransform: 'capitalize', transition: 'color 0.12s',
                }}>{t}</button>
              ))}
            </div>

            {(error || notice) && (
              <div style={{
                padding: '9px 20px', fontSize: 12, flexShrink: 0,
                color: error ? 'var(--bld-error)' : '#34d399',
                background: error ? 'rgba(239,68,68,0.08)' : 'rgba(52,211,153,0.07)',
                borderBottom: `1px solid ${error ? 'rgba(239,68,68,0.2)' : 'rgba(52,211,153,0.2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>{error || notice}</span>
                <button onClick={() => { setError(''); setNotice(''); }} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
              </div>
            )}

            <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
              {tab === 'fields' && (
                <FieldsTab fields={draft.fields ?? []} onAdd={addField} onEdit={setEditingFieldId} onRemove={removeField} />
              )}
              {tab === 'config' && (
                <ConfigTab draft={draft} patch={patchDraft} middlewareWfs={middlewareWfs} functionWfs={functionWfs} />
              )}
              {tab === 'seeds' && (
                <SeedsTab projectId={projectId} model={draft.name} />
              )}
            </div>
          </>
        )}
      </div>

      {/* Field editor drawer */}
      {editingField && draft && (
        <FieldEditor
          field={editingField}
          model={draft}
          enums={enums}
          models={models}
          onChange={(patch) => updateField(editingField.id, patch)}
          onValidationChange={(expr) => {
            const v = { ...(draft.validations ?? {}) };
            if (expr) v[editingField.name] = expr; else delete v[editingField.name];
            patchDraft({ validations: v });
          }}
          validation={draft.validations?.[editingField.name] ?? ''}
          onClose={() => setEditingFieldId(null)}
          onRemove={() => removeField(editingField.id)}
        />
      )}
    </div>
  );
}

// ─── Fields tab ──────────────────────────────────────────────────────────────

function FieldsTab({ fields, onAdd, onEdit, onRemove }: {
  fields: ModelFieldJson[]; onAdd: () => void; onEdit: (id: string) => void; onRemove: (id: string) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>Fields ({fields.length})</span>
        <button onClick={onAdd} style={BTN_PRIMARY}>+ Add field</button>
      </div>
      <div style={{ border: '1px solid var(--bld-bg-elevated)', borderRadius: 8, overflow: 'hidden' }}>
        {fields.length === 0 && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--bld-text-disabled)' }}>No fields. Add one to create columns.</div>}
        {fields.map((f) => (
          <div key={f.id} onClick={() => onEdit(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--bld-bg-elevated)', cursor: 'pointer' }}>
            <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, minWidth: 140 }}>{f.name || <em style={{ color: 'var(--bld-text-disabled)' }}>unnamed</em>}</span>
            <span style={{ fontSize: 11, color: 'var(--bld-text-3)', background: 'var(--bld-bg-elevated)', borderRadius: 4, padding: '2px 8px' }}>
              {f.type}{f.type === 'relation' && f.relation ? ` → ${f.relation.to}` : ''}{f.type === 'enum' && f.enum ? ` (${f.enum})` : ''}
            </span>
            <div style={{ flex: 1 }} />
            {f.required && <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>required</span>}
            {f.unique && <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>unique</span>}
            {f.computed && <span style={{ fontSize: 10, color: 'var(--bld-badge-text)' }}>computed</span>}
            <button onClick={(e) => { e.stopPropagation(); onRemove(f.id); }} style={{ ...BTN, padding: '3px 8px', color: 'var(--bld-error)', borderColor: 'transparent' }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Field editor drawer ─────────────────────────────────────────────────────

function FieldEditor({ field, model, enums, models, onChange, validation, onValidationChange, onClose, onRemove }: {
  field: ModelFieldJson;
  model: ModelDefinitionJson;
  enums: ModelEnumJson[];
  models: ModelDefinitionJson[];
  onChange: (patch: Partial<ModelFieldJson>) => void;
  validation: string;
  onValidationChange: (expr: string) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 360, zIndex: 60, background: '#0d1526', borderLeft: '1px solid var(--bld-bg-elevated)', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.4)' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bld-bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>Edit field</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <label style={LABEL}>Name <span style={{ color: 'var(--bld-error)' }}>*</span></label>
        <input value={field.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="fieldName" style={INPUT} />

        <label style={{ ...LABEL, marginTop: 14 }}>Type</label>
        <select value={field.type} onChange={(e) => onChange({ type: e.target.value as ModelFieldJson['type'] })} style={SELECT}>
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        {field.type === 'enum' && (
          <>
            <label style={{ ...LABEL, marginTop: 14 }}>Enum</label>
            <select value={field.enum ?? ''} onChange={(e) => onChange({ enum: e.target.value || undefined })} style={SELECT}>
              <option value="">Select enum…</option>
              {enums.map((en) => <option key={en.name} value={en.name}>{en.name}</option>)}
            </select>
          </>
        )}

        {field.type === 'relation' && (
          <div style={{ marginTop: 14, border: '1px solid var(--bld-bg-elevated)', borderRadius: 6, padding: 12 }}>
            <label style={LABEL}>Target model</label>
            <select value={field.relation?.to ?? ''} onChange={(e) => onChange({ relation: { ...(field.relation ?? { kind: 'manyToOne' }), to: e.target.value } })} style={SELECT}>
              <option value="">Select model…</option>
              {models.filter((m) => m.name !== model.name).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
            <label style={{ ...LABEL, marginTop: 10 }}>Kind</label>
            <select value={field.relation?.kind ?? 'manyToOne'} onChange={(e) => onChange({ relation: { ...(field.relation ?? { to: '' }), kind: e.target.value as ModelRelationKind } })} style={SELECT}>
              {RELATION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <label style={{ ...LABEL, marginTop: 10 }}>On delete</label>
            <select value={field.relation?.onDelete ?? 'noAction'} onChange={(e) => onChange({ relation: { ...(field.relation ?? { to: '', kind: 'manyToOne' }), onDelete: e.target.value as 'cascade' } })} style={SELECT}>
              {ON_DELETE.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}

        {field.type !== 'relation' && (
          <>
            <label style={{ ...LABEL, marginTop: 14 }}>Default (SQL expression)</label>
            <input value={field.default ?? ''} onChange={(e) => onChange({ default: e.target.value || undefined })} placeholder="e.g. 0, 'draft', now()" style={INPUT} />
          </>
        )}

        <div style={SECTION_TITLE}>Constraints</div>
        <ToggleRow label="Required (NOT NULL)" on={!!field.required} onChange={(v) => onChange({ required: v })} />
        <ToggleRow label="Unique" on={!!field.unique} onChange={(v) => onChange({ unique: v })} />
        <ToggleRow label="Indexed" on={!!field.indexed} onChange={(v) => onChange({ indexed: v })} />
        {(field.type === 'text') && <ToggleRow label="Searchable (full-text)" on={!!field.searchable} onChange={(v) => onChange({ searchable: v })} />}

        <div style={SECTION_TITLE}>Computed</div>
        <ToggleRow label="Computed field" on={!!field.computed} onChange={(v) => onChange({ computed: v ? { expr: '', persisted: false } : undefined })} />
        {field.computed && (
          <>
            <label style={{ ...LABEL, marginTop: 8 }}>Expression (reference columns via <code>row.</code>)</label>
            <textarea value={field.computed.expr} onChange={(e) => onChange({ computed: { ...field.computed!, expr: e.target.value } })}
              placeholder="upper(row.title)" rows={2} style={{ ...INPUT, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
            <ToggleRow label="Persisted (generated column)" on={!!field.computed.persisted} onChange={(v) => onChange({ computed: { ...field.computed!, persisted: v } })} />
          </>
        )}

        <div style={SECTION_TITLE}>Validation</div>
        <label style={LABEL}>Boolean expression enforced on write (use <code>row.</code>)</label>
        <textarea value={validation} onChange={(e) => onValidationChange(e.target.value)}
          placeholder="row.price >= 0" rows={2} style={{ ...INPUT, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />

        <label style={{ ...LABEL, marginTop: 14 }}>Description</label>
        <textarea value={field.description ?? ''} onChange={(e) => onChange({ description: e.target.value || undefined })} rows={2} style={{ ...INPUT, resize: 'vertical' }} />
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--bld-bg-elevated)', display: 'flex', gap: 8 }}>
        <button onClick={onClose} style={{ ...BTN_PRIMARY, flex: 1, justifyContent: 'center' }}>Done</button>
        <button onClick={onRemove} style={{ ...BTN, color: 'var(--bld-error)', borderColor: 'rgba(239,68,68,0.3)' }}>Remove</button>
      </div>
    </div>
  );
}

// ─── Config tab ──────────────────────────────────────────────────────────────

function ConfigTab({ draft, patch, middlewareWfs, functionWfs }: {
  draft: ModelDefinitionJson;
  patch: (p: Partial<ModelDefinitionJson>) => void;
  middlewareWfs: BackendWorkflow[];
  functionWfs: BackendWorkflow[];
}) {
  const textFields = (draft.fields ?? []).filter((f) => f.type === 'text').map((f) => f.name);
  const search = draft.search ?? [];
  const indexes = draft.indexes ?? [];

  return (
    <div style={{ maxWidth: 620 }}>
      <label style={LABEL}>Table name (physical)</label>
      <input value={draft.table} onChange={(e) => patch({ table: e.target.value })} style={INPUT} />

      <div style={SECTION_TITLE}>Options</div>
      <ToggleRow label="Timestamps" hint="created_at / updated_at columns" on={draft.timestamps !== false} onChange={(v) => patch({ timestamps: v })} />
      <ToggleRow label="Soft delete" hint="deleted_at column + auto-filter" on={!!draft.softDelete} onChange={(v) => patch({ softDelete: v })} />
      <ToggleRow label="Actor tracking" hint="created_by / updated_by from identity" on={!!draft.actorTracking} onChange={(v) => patch({ actorTracking: v })} />
      {!!draft.actorTracking && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 4px 12px' }}>
          <span style={{ fontSize: 12, color: 'var(--bld-text-secondary)', flexShrink: 0 }}>Actor ID field:</span>
          <input
            value={(draft.actorIdField ?? 'userId') as string}
            onChange={(e) => patch({ actorIdField: e.target.value || undefined })}
            placeholder="userId"
            title="Name of the context variable that holds the acting user's ID (set by middleware via changeVariableValue)"
            style={{ flex: 1, fontSize: 12, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--bld-border)', background: 'var(--bld-bg-input, var(--bld-bg-2))', color: 'var(--bld-text)' }}
          />
        </div>
      )}

      <div style={SECTION_TITLE}>Full-text search</div>
      {textFields.length === 0 && <p style={{ fontSize: 12, color: 'var(--bld-text-disabled)' }}>Add text fields to enable search.</p>}
      {textFields.map((name) => (
        <ToggleRow key={name} label={name} on={search.includes(name)} onChange={(v) => patch({ search: v ? [...search, name] : search.filter((s) => s !== name) })} />
      ))}

      <div style={SECTION_TITLE}>Indexes</div>
      {indexes.map((idx, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input value={idx.fields.join(', ')} onChange={(e) => {
            const next = [...indexes]; next[i] = { ...idx, fields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }; patch({ indexes: next });
          }} placeholder="field1, field2" style={{ ...INPUT, flex: 1 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--bld-text-3)' }}>
            <input type="checkbox" checked={!!idx.unique} onChange={(e) => { const next = [...indexes]; next[i] = { ...idx, unique: e.target.checked }; patch({ indexes: next }); }} /> unique
          </label>
          <button onClick={() => patch({ indexes: indexes.filter((_, j) => j !== i) })} style={{ ...BTN, padding: '5px 9px' }}>✕</button>
        </div>
      ))}
      <button onClick={() => patch({ indexes: [...indexes, { fields: [] }] })} style={BTN}>+ Add index</button>

      <div style={SECTION_TITLE}>Access (middleware per operation)</div>
      <p style={{ fontSize: 11, color: 'var(--bld-text-disabled)', marginTop: -4, marginBottom: 8 }}>MIDDLEWARE workflows run before the ORM call on /v1/db.</p>
      {ACCESS_OPS.map((op) => (
        <MultiPicker key={op} label={op} options={middlewareWfs.map((w) => w.name)} selected={draft.access?.[op] ?? []}
          onChange={(vals) => { const a = { ...(draft.access ?? {}) }; if (vals.length) a[op] = vals; else delete a[op]; patch({ access: a }); }} />
      ))}

      <div style={SECTION_TITLE}>Hooks (run inline in write tx)</div>
      {HOOK_EVENTS.map((ev) => (
        <FnPicker key={ev} label={ev} options={functionWfs.map((w) => w.name)} value={draft.hooks?.[ev] ?? ''}
          onChange={(v) => { const h = { ...(draft.hooks ?? {}) }; if (v) h[ev] = v; else delete h[ev]; patch({ hooks: h }); }} />
      ))}

      <div style={SECTION_TITLE}>Events (enqueued async after commit)</div>
      {TRIGGER_EVENTS.map((ev) => (
        <FnPicker key={ev} label={ev} options={functionWfs.map((w) => w.name)} value={draft.events?.[ev] ?? ''}
          onChange={(v) => { const e = { ...(draft.events ?? {}) }; if (v) e[ev] = v; else delete e[ev]; patch({ events: e }); }} />
      ))}
    </div>
  );
}

function FnPicker({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--bld-text-3)', width: 120 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...SELECT, flex: 1 }}>
        <option value="">— none —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function MultiPicker({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--bld-text-3)', width: 60, paddingTop: 4 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.length === 0 && <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>No middleware workflows</span>}
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button key={o} onClick={() => onChange(on ? selected.filter((s) => s !== o) : [...selected, o])} style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 12, cursor: 'pointer',
              background: on ? 'rgba(99,102,241,0.2)' : 'transparent', border: `1px solid ${on ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`,
              color: on ? 'var(--bld-badge-text)' : 'var(--bld-text-3)',
            }}>{o}</button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Seeds tab ───────────────────────────────────────────────────────────────

function SeedsTab({ projectId, model }: { projectId: string; model: string }) {
  const [text, setText] = useState('[]');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    backendSeeds.list(projectId)
      .then((r) => { const s = r.seeds.find((x) => x.model === model); setText(JSON.stringify(s?.rows ?? [], null, 2)); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId, model]);

  const parseRows = (): Record<string, unknown>[] | null => {
    try { const v = JSON.parse(text); return Array.isArray(v) ? v : null; } catch { return null; }
  };

  const saveSeeds = async () => {
    const rows = parseRows();
    if (!rows) { setErr('Seed data must be a JSON array of row objects.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try { await backendSeeds.set(projectId, model, rows); setMsg('Seeds saved.'); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const applySeeds = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { const r = await backendSeeds.apply(projectId, model); setMsg(`Applied ${r.applied} rows.${r.errors.length ? ' Errors: ' + r.errors.join('; ') : ''}`); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const deleteSeeds = async () => {
    if (!confirm('Delete seed data for this model?')) return;
    setBusy(true); setErr(''); setMsg('');
    try { await backendSeeds.delete(projectId, model); setText('[]'); setMsg('Seeds deleted.'); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (loading) return <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 640 }}>
      <p style={{ fontSize: 12, color: 'var(--bld-text-disabled)', marginBottom: 10 }}>
        Seed rows are stored per model and inserted on demand. Define an array of row objects (field → value).
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16}
        style={{ ...INPUT, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', lineHeight: 1.5 }} />
      {(msg || err) && <div style={{ marginTop: 10, fontSize: 12, color: err ? 'var(--bld-error)' : '#34d399' }}>{err || msg}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button onClick={() => void saveSeeds()} disabled={busy} style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}>Save seeds</button>
        <button onClick={() => void applySeeds()} disabled={busy} style={BTN}>Apply seeds</button>
        <button onClick={() => void deleteSeeds()} disabled={busy} style={{ ...BTN, color: 'var(--bld-error)', borderColor: 'rgba(239,68,68,0.3)' }}>Delete</button>
      </div>
    </div>
  );
}

