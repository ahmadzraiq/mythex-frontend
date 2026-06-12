'use client';
/**
 * Views Editor — per-table views with filter/sort/security configurator.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  backendTables,
  backendViews,
  type BackendTable,
  type BackendView,
} from '@/lib/platform/api-client';

interface Props {
  projectId: string;
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
}

const SECURITY_OPTIONS = [
  { value: 'PUBLIC',        label: 'Public',        color: '#22c55e' },
  { value: 'AUTHENTICATED', label: 'Authenticated',  color: '#f59e0b' },
  { value: 'ROLE',          label: 'Role-based',     color: '#ef4444' },
] as const;

type Security = 'PUBLIC' | 'AUTHENTICATED' | 'ROLE';

export function ViewsEditor({ projectId, selectedTableId, onSelectTable }: Props) {
  const [tables, setTables]   = useState<BackendTable[]>([]);
  const [views, setViews]     = useState<BackendView[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedView, setSelectedView] = useState<BackendView | null>(null);
  const [showNewView, setShowNewView]   = useState(false);
  const [newView, setNewView] = useState({ name: '', slug: '', security: 'PUBLIC' as Security });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null;

  useEffect(() => {
    backendTables.list(projectId).then((r) => setTables(r.tables)).catch(() => void 0);
  }, [projectId]);

  useEffect(() => {
    if (!selectedTableId) return;
    setLoading(true);
    backendViews.list(projectId)
      .then((r) => setViews(r.views.filter((v) => v.tableId === selectedTableId)))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId, selectedTableId]);

  const createView = async () => {
    if (!selectedTableId || !newView.name.trim() || !newView.slug.trim()) return;
    setSaving(true);
    try {
      const res = await backendViews.create(projectId, {
        tableId:  selectedTableId,
        name:     newView.name.trim(),
        slug:     newView.slug.trim(),
        security: newView.security,
      });
      setViews((prev) => [...prev, res.view]);
      setSelectedView(res.view);
      setShowNewView(false);
      setNewView({ name: '', slug: '', security: 'PUBLIC' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updateView = async (viewId: string, patch: Partial<BackendView>) => {
    setSaving(true);
    try {
      const res = await backendViews.update(projectId, viewId, patch);
      setViews((prev) => prev.map((v) => v.id === viewId ? res.view : v));
      setSelectedView(res.view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteView = async (viewId: string) => {
    if (!confirm('Delete this view?')) return;
    await backendViews.delete(projectId, viewId);
    setViews((prev) => prev.filter((v) => v.id !== viewId));
    if (selectedView?.id === viewId) setSelectedView(null);
  };

  const inputStyle: React.CSSProperties = {
    background: '#111827',
    border: '1px solid #374151',
    borderRadius: 4,
    padding: '5px 8px',
    fontSize: 12,
    color: 'var(--bld-text-2)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── Table selector + view tabs ────────────────────────────────── */}
      <div style={{ width: 220, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', background: '#0a0f1a', flexShrink: 0 }}>
        {/* Table picker */}
        <div style={{ padding: 10, borderBottom: '1px solid #1e293b' }}>
          <select
            value={selectedTableId ?? ''}
            onChange={(e) => { onSelectTable(e.target.value || null); setSelectedView(null); }}
            style={{ ...inputStyle, fontSize: 11 }}
          >
            <option value="">Select table…</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </select>
        </div>

        {/* View list */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {selectedTableId && (
            <>
              <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Views</span>
                <button
                  onClick={() => setShowNewView(true)}
                  style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: 'none', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                >
                  + New
                </button>
              </div>

              {showNewView && (
                <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input value={newView.name} onChange={(e) => setNewView({ ...newView, name: e.target.value })} placeholder="View name" style={inputStyle} />
                  <input value={newView.slug} onChange={(e) => setNewView({ ...newView, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })} placeholder="slug" style={inputStyle} />
                  <select value={newView.security} onChange={(e) => setNewView({ ...newView, security: e.target.value as Security })} style={inputStyle}>
                    {SECURITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => void createView()} disabled={saving} style={{ flex: 1, padding: '4px 0', fontSize: 11, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                      {saving ? '…' : 'Create'}
                    </button>
                    <button onClick={() => setShowNewView(false)} style={{ padding: '4px 8px', fontSize: 11, background: 'transparent', color: 'var(--bld-text-disabled)', border: '1px solid #374151', borderRadius: 4, cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              )}

              {loading && <div style={{ padding: 12, fontSize: 12, color: 'var(--bld-text-disabled)', textAlign: 'center' }}>Loading…</div>}

              {views.map((view) => {
                const sec = SECURITY_OPTIONS.find((o) => o.value === view.security);
                return (
                  <div
                    key={view.id}
                    onClick={() => setSelectedView(view)}
                    style={{
                      padding: '6px 12px',
                      cursor: 'pointer',
                      background: selectedView?.id === view.id ? 'rgba(59,130,246,0.1)' : 'transparent',
                      borderLeft: `2px solid ${selectedView?.id === view.id ? '#3b82f6' : 'transparent'}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--bld-text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {view.name}
                    </span>
                    <span style={{ fontSize: 9, color: sec?.color ?? '#6b7280' }}>●</span>
                    <button onClick={(e) => { e.stopPropagation(); void deleteView(view.id); }} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 10, opacity: 0, transition: 'opacity 0.15s' }} onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')} onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}>✕</button>
                  </div>
                );
              })}

              {!loading && views.length === 0 && !showNewView && (
                <div style={{ padding: '12px', fontSize: 11, color: 'var(--bld-text-disabled)', textAlign: 'center' }}>No views. Click + New.</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── View configurator ─────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedView && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--bld-text-disabled)', fontSize: 13 }}>
            {selectedTableId ? 'Select a view to configure it' : 'Select a table first'}
          </div>
        )}

        {selectedView && (
          <ViewConfig
            view={selectedView}
            table={selectedTable}
            onUpdate={(patch) => void updateView(selectedView.id, patch)}
            saving={saving}
          />
        )}
      </div>

      {error && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: '#7f1d1d', color: '#fca5a5', padding: '8px 16px', borderRadius: 6, fontSize: 12 }}>
          {error}<button onClick={() => setError('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}

function ViewConfig({ view, table, onUpdate, saving }: {
  view: BackendView;
  table: BackendTable | null;
  onUpdate: (patch: Partial<BackendView>) => void;
  saving: boolean;
}) {
  const sec = SECURITY_OPTIONS.find((o) => o.value === view.security);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: 20, gap: 20 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--bld-text-2)' }}>{view.name}</div>
        <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', fontFamily: 'monospace', marginTop: 2 }}>/{view.slug}</div>
      </div>

      {/* Security */}
      <Section title="Security">
        <div style={{ display: 'flex', gap: 8 }}>
          {SECURITY_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => onUpdate({ security: o.value })}
              style={{
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 5,
                cursor: 'pointer',
                border: `1px solid ${view.security === o.value ? o.color : '#374151'}`,
                background: view.security === o.value ? `${o.color}18` : 'transparent',
                color: view.security === o.value ? o.color : 'var(--bld-text-disabled)',
                transition: 'all 0.15s',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        {view.security === 'ROLE' && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--bld-text-3)' }}>
            Define role-based policies in the Advanced Policy section below.
          </div>
        )}
      </Section>

      {/* Filters */}
      <Section title="Filters">
        <FilterSortEditor
          label="filter"
          items={(view.filters as unknown[]) ?? []}
          onChange={(filters) => onUpdate({ filters })}
          table={table}
        />
      </Section>

      {/* Sort */}
      <Section title="Sort">
        <FilterSortEditor
          label="sort"
          items={(view.sort as unknown[]) ?? []}
          onChange={(sort) => onUpdate({ sort })}
          table={table}
        />
      </Section>

      {/* Fields */}
      <Section title="Visible fields">
        {table ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['id', 'created_at', 'updated_at', ...table.columns.map((c) => c.name)].map((field) => {
              const isSelected = (view.fields as string[]).length === 0 || (view.fields as string[]).includes(field);
              return (
                <button
                  key={field}
                  onClick={() => {
                    const current = (view.fields as string[]).length === 0
                      ? ['id', 'created_at', 'updated_at', ...table.columns.map((c) => c.name)]
                      : view.fields as string[];
                    const next = current.includes(field)
                      ? current.filter((f) => f !== field)
                      : [...current, field];
                    onUpdate({ fields: next });
                  }}
                  style={{
                    padding: '3px 8px',
                    fontSize: 11,
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(59,130,246,0.15)' : 'transparent',
                    border: `1px solid ${isSelected ? '#3b82f6' : '#374151'}`,
                    color: isSelected ? '#60a5fa' : '#6b7280',
                    fontFamily: 'monospace',
                  }}
                >
                  {field}
                </button>
              );
            })}
          </div>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>No table selected</span>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function FilterSortEditor({ label, items, onChange, table }: {
  label: string;
  items: unknown[];
  onChange: (items: unknown[]) => void;
  table: BackendTable | null;
}) {
  return (
    <div>
      {items.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', marginBottom: 6 }}>No {label}s applied. All rows returned.</div>
      )}
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11, color: 'var(--bld-text-2)', fontFamily: 'monospace', background: '#111827', padding: '4px 8px', borderRadius: 4 }}>
          <span style={{ flex: 1 }}>{JSON.stringify(item)}</span>
          <button onClick={() => onChange(items.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer' }}>✕</button>
        </div>
      ))}
      <button
        onClick={() => {
          if (label === 'sort') {
            onChange([...items, { field: 'created_at', dir: 'desc' }]);
          } else {
            onChange([...items, { field: 'id', operator: 'eq', value: '' }]);
          }
        }}
        style={{ fontSize: 11, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2 }}
      >
        + Add {label}
      </button>
    </div>
  );
}
